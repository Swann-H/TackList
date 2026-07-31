let _dataRefreshPending = false;
let _dataRefreshTimerId = null;
let _dataVersion = -1; // 数据版本号，-1表示未初始化
let _initialLoadDone = false; // 是否已完成首次加载
let _saveDataTimerId = null; // 节流保存定时器
let _saveInFlight = false; // 保存请求是否正在发送中（含节流等待期和网络传输期）
let _forceNextRefreshRender = false; // 冲突合并后强制下次刷新重渲染，绕过版本号检测

// ==================== IndexedDB 冗余缓存 ====================
const IDB_NAME = 'tacklistBackup';
const IDB_VERSION = 1;
const IDB_STORE = 'snapshots';
let _idb = null; // 缓存已打开的数据库实例

function _openIDB() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('IndexedDB not available')); return; }
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: 'key' });
            }
        };
        req.onsuccess = (e) => { _idb = e.target.result; resolve(_idb); };
        req.onerror = (e) => { reject(e.target.error); };
    });
}

// 将数据快照写入 IndexedDB
async function cacheToIndexedDB(data) {
    try {
        const db = await _openIDB();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.put({
            key: 'latest',
            data: data,
            cachedAt: new Date().toISOString()
        });
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        console.warn('IndexedDB cache write failed:', err);
    }
}

// 从 IndexedDB 读取最近快照
async function loadFromIndexedDB() {
    try {
        const db = await _openIDB();
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get('latest');
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        console.warn('IndexedDB cache read failed:', err);
        return null;
    }
}

// 数据变更的 BroadcastChannel，通知其他标签页
const _dataChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('data_sync') : null;
if (_dataChannel) {
    _dataChannel.onmessage = function(event) {
        if (event.data && event.data.action === 'DATA_UPDATED') {
            refreshDataFromServer();
        }
    };
}
function notifyDataChange() {
    if (_dataChannel) {
        try { _dataChannel.postMessage({ action: 'DATA_UPDATED' }); } catch(e) {}
    }
}

async function refreshDataFromServer() {
    // 当任务详情面板打开或有保存正在进行时，延迟刷新，避免覆盖本地未保存的数据
    if (currentDetailTaskId || _saveInFlight) {
        _dataRefreshPending = true;
        return;
    }
    // 视图感知：标签页隐藏时不做后台全量渲染（主线程开销大且用户看不见），
    // 标签页重新可见时由 visibilitychange 监听器触发刷新。
    if (document.hidden) {
        _dataRefreshPending = true;
        return;
    }
    _dataRefreshPending = false;
    try {
        const response = await fetch('/api/data');
        if (!response.ok) return;
        const data = await response.json();

        // 变更检测：服务端版本号未变则跳过全量渲染（消除后台每 30s 一次的卡顿）
        // _forceNextRefreshRender 用于冲突合并后强制刷新
        const serverVersion = data._version;
        if (!_forceNextRefreshRender && serverVersion !== undefined && serverVersion === _dataVersion) {
            return; // 数据未变，无需重建 DOM
        }
        _forceNextRefreshRender = false;

        // 更新版本号
        if (serverVersion !== undefined) {
            _dataVersion = serverVersion;
            delete data._version;
        }
        lists = data.taskLists || lists;
        tasks = data.tasks || tasks;
        applySettings(data.settings);
        quadrantOrder = data.quadrantOrder || quadrantOrder;
        pomodoroHistory = deduplicatePomodoroHistory(data.pomodoroHistory || pomodoroHistory);
        // 数据实际变化后才重建派生缓存
        if (typeof rebuildFocusMinutesCache === 'function') rebuildFocusMinutesCache();
        if (typeof rebuildSearchIndex === 'function') rebuildSearchIndex();
        if (typeof invalidateScheduleFilterCache === 'function') invalidateScheduleFilterCache();
        // 多标签页同步过来的新 tasks 会让番茄任务推荐列表缓存失效，必须清空。
        // 否则面板打开时仍展示旧数据，违反“多标签页任务同步”的一致性预期。
        if (typeof invalidatePomodoroTaskCache === 'function') invalidatePomodoroTaskCache();
        renderLists();
        renderView();
        updateViewButtons();
        if (planPanelOpen) renderPlanPanel();
        // 修复盲区：原实现同步完成后未刷新“已打开的专注任务面板”，
        // 导致面板中显示的推荐任务列表与其他标签页的最新数据不一致。
        // 这里在缓存已失效的前提下，若面板正开着则立即重新渲染（会用最新 tasks 重新三重排序）。
        const _pomodoroTaskOverlay = document.getElementById('pomodoro-task-panel-overlay');
        if (_pomodoroTaskOverlay && !_pomodoroTaskOverlay.classList.contains('hidden') &&
            typeof renderPomodoroTaskList === 'function') {
            renderPomodoroTaskList(
                (taskId) => `selectPomodoroTask(${taskId ? `'${taskId}'` : 'null'})`,
                (typeof pomodoroState !== 'undefined') ? pomodoroState.currentTaskId : null
            );
        }
    } catch (err) {
        console.error('Refresh data error:', err);
    }
}

function startDataRefreshTimer() {
    if (_dataRefreshTimerId) clearInterval(_dataRefreshTimerId);
    const interval = (settings.refreshInterval || 30) * 1000;
    _dataRefreshTimerId = setInterval(refreshDataFromServer, interval);
}

async function loadHolidayData() {
    // 优先从 localStorage 读取（用户编辑后的数据）
    try {
        const stored = localStorage.getItem('holidayData');
        if (stored) {
            holidayData = JSON.parse(stored);
            console.log('Holiday data loaded from localStorage:', Object.keys(holidayData).join(', '));
            return;
        }
    } catch (e) {
        console.error('Read holiday data from localStorage error:', e);
    }
    // 回退：从服务端获取并缓存到 localStorage
    try {
        const response = await fetch('/api/holiday-data');
        if (!response.ok) {
            console.error('Load holiday data: HTTP', response.status);
            return;
        }
        holidayData = await response.json();
        console.log('Holiday data loaded from server:', Object.keys(holidayData).join(', '));
        try {
            localStorage.setItem('holidayData', JSON.stringify(holidayData));
        } catch (e) {
            console.error('Cache holiday data to localStorage error:', e);
        }
    } catch (err) {
        console.error('Load holiday data error:', err);
    }
}

// 保存节假日数据到 localStorage 并同步到服务端
function saveHolidayData(data) {
    holidayData = data;
    try {
        localStorage.setItem('holidayData', JSON.stringify(data));
    } catch (e) {
        console.error('Save holiday data to localStorage error:', e);
        showToast('数据保存失败，请检查存储空间', 'error');
        return false;
    }
    // 同步到服务端文件（离线模式下静默失败）
    fetch('/api/holiday-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).catch(err => console.error('Sync holiday data to server error:', err));
    return true;
}

function getHolidayInfo(dateStr) {
    const parts = dateStr.split('-');
    const year = parts[0];
    const md = parts[1] + '-' + parts[2];
    const yearData = holidayData[year];
    if (!yearData) return null;
    if (yearData.workdays && yearData.workdays[md]) {
        return { type: 'work', name: yearData.workdays[md], isActualDay: false };
    }
    if (yearData.holidays && yearData.holidays[md]) {
        const holidayName = yearData.holidays[md];
        let isActualDay = false;
        const solarActualDays = { '01-01': '元旦', '05-01': '劳动节', '10-01': '国庆节' };
        if (solarActualDays[md] === holidayName) {
            isActualDay = true;
        }
        if (!isActualDay && typeof LunarCalendar !== 'undefined') {
            const lunar = LunarCalendar.solarToLunar(parseInt(year), parseInt(parts[1]), parseInt(parts[2]));
            if (lunar) {
                const lunarFestival = LunarCalendar.getLunarFestival(lunar.lMonth, lunar.lDay, lunar.isLeap, lunar.lYear);
                if (lunarFestival === holidayName) {
                    isActualDay = true;
                }
            }
        }
        if (!isActualDay && holidayName === '清明节' && typeof LunarCalendar !== 'undefined') {
            const solarTerms = LunarCalendar.getSolarTerms(parseInt(year));
            if (solarTerms[md] === '清明') {
                isActualDay = true;
            }
        }
        return { type: 'holiday', name: holidayName, isActualDay: isActualDay };
    }
    return null;
}

function isWorkday(date) {
    const dateStr = formatDate(date);
    const info = getHolidayInfo(dateStr);
    if (info) {
        return info.type === 'work';
    }
    const day = date.getDay();
    return day !== 0 && day !== 6;
}

function findFirstWorkdayOfWeek(weekStart, weekStartsOnMonday) {
    const d = new Date(weekStart);
    for (let i = 0; i < 7; i++) {
        const checkDate = new Date(d);
        checkDate.setDate(d.getDate() + i);
        if (isWorkday(checkDate)) {
            return checkDate;
        }
    }
    return null;
}

function findLastWorkdayOfWeek(weekStart, weekStartsOnMonday) {
    const d = new Date(weekStart);
    let lastWorkday = null;
    let lastHolidayOrWeekend = null;
    for (let i = 0; i < 7; i++) {
        const checkDate = new Date(d);
        checkDate.setDate(d.getDate() + i);
        if (isWorkday(checkDate)) {
            lastWorkday = new Date(checkDate);
        } else {
            lastHolidayOrWeekend = new Date(checkDate);
        }
    }
    return lastWorkday;
}

function findFirstWorkdayOfMonth(year, month) {
    for (let day = 1; day <= 31; day++) {
        const d = new Date(year, month, day);
        if (d.getMonth() !== month) break;
        if (isWorkday(d)) return d;
    }
    return null;
}

function findLastWorkdayOfMonth(year, month) {
    let lastWorkday = null;
    for (let day = 1; day <= 31; day++) {
        const d = new Date(year, month, day);
        if (d.getMonth() !== month) break;
        if (isWorkday(d)) lastWorkday = new Date(d);
    }
    return lastWorkday;
}

function getWeekStartDate(date, weekStartsOnMonday) {
    const d = new Date(date);
    const day = d.getDay();
    const offset = weekStartsOnMonday ? (day === 0 ? 6 : day - 1) : day;
    d.setDate(d.getDate() - offset);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getWeekNumber(date, weekStartsOnMonday) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    if (weekStartsOnMonday) {
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    } else {
        d.setUTCDate(d.getUTCDate() + 4 - (dayNum === 7 ? 0 : dayNum));
    }
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function checkHolidayDataUpdate() {
    const currentYear = new Date().getFullYear().toString();
    const yearData = holidayData[currentYear];
    console.log('Check holiday data for year', currentYear, ':', yearData ? 'found' : 'not found');
    if (!yearData || !yearData.holidays || Object.keys(yearData.holidays).length === 0) {
        showToast('调休日数据未更新，请更新 holiday_data.json 中 ' + currentYear + ' 年的数据', 'warning', 10000);
    }
}

function updateHolidayCountdown() {
    const labelEl = document.getElementById('holiday-countdown-label');
    const numberEl = document.getElementById('holiday-countdown-number');
    const dateEl = document.getElementById('holiday-countdown-date');
    if (!labelEl || !numberEl || !dateEl) return;

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const currentYear = now.getFullYear().toString();
    const currentYearData = holidayData[currentYear];
    const nextYearData = holidayData[(now.getFullYear() + 1).toString()];

    let holidayGroups = {};

    function collectGroups(yearStr, yearData) {
        if (!yearData || !yearData.holidays) return;
        const holidays = yearData.holidays;
        const sortedDates = Object.keys(holidays).sort();
        let i = 0;
        while (i < sortedDates.length) {
            const name = holidays[sortedDates[i]];
            const groupDates = [sortedDates[i]];
            let j = i + 1;
            while (j < sortedDates.length && holidays[sortedDates[j]] === name) {
                const prevDate = new Date(parseInt(yearStr), parseInt(sortedDates[j - 1].split('-')[0]) - 1, parseInt(sortedDates[j - 1].split('-')[1]));
                const currDate = new Date(parseInt(yearStr), parseInt(sortedDates[j].split('-')[0]) - 1, parseInt(sortedDates[j].split('-')[1]));
                const diff = (currDate - prevDate) / 86400000;
                if (diff === 1) {
                    groupDates.push(sortedDates[j]);
                    j++;
                } else {
                    break;
                }
            }
            if (groupDates.length > 2) {
                if (!holidayGroups[name] || new Date(yearStr + '-' + groupDates[0]) < holidayGroups[name].startDate) {
                    holidayGroups[name] = {
                        startDate: new Date(yearStr + '-' + groupDates[0]),
                        firstDateStr: groupDates[0],
                        count: groupDates.length
                    };
                }
            }
            i = j;
        }
    }

    collectGroups(currentYear, currentYearData);
    collectGroups((now.getFullYear() + 1).toString(), nextYearData);

    let nextHoliday = null;
    let minDiff = Infinity;
    for (const name in holidayGroups) {
        const group = holidayGroups[name];
        const diff = (group.startDate - now) / 86400000;
        if (diff > 0 && diff < minDiff) {
            minDiff = Math.ceil(diff);
            nextHoliday = { name: name, startDate: group.startDate, days: Math.max(0, minDiff - 1) };
        }
    }

    if (nextHoliday) {
        labelEl.textContent = '距' + nextHoliday.name + '还有';
        numberEl.textContent = nextHoliday.days;
        const m = nextHoliday.startDate.getMonth() + 1;
        const d = nextHoliday.startDate.getDate();
        dateEl.textContent = m + '月' + d + '日起';
        
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (nextHoliday.days === 3) {
            numberEl.style.color = isDark ? '#FFB74D' : '#E67E22';
        } else if (nextHoliday.days === 2) {
            numberEl.style.color = isDark ? '#FF8A65' : '#E65100';
        } else if (nextHoliday.days === 1) {
            numberEl.style.color = isDark ? '#EF5350' : '#C62828';
        } else {
            numberEl.style.color = '';
        }
    } else {
        labelEl.textContent = '暂无假期信息';
        numberEl.textContent = '-';
        dateEl.textContent = '';
    }
}

function saveData() {
    // 结构性变更（增删/改期/设置等）经此保存，令日程视图流水线缓存失效
    if (typeof invalidateScheduleFilterCache === 'function') invalidateScheduleFilterCache();
    // 本地 tasks 已变更，番茄任务推荐列表缓存同样需要失效，下次打开面板时重新排序
    if (typeof invalidatePomodoroTaskCache === 'function') invalidatePomodoroTaskCache();
    // 节流：500ms 内只发送一次，避免高频写入冲突
    _saveInFlight = true; // 标记保存正在进行（含节流等待期），防止 refreshDataFromServer 覆盖本地数据
    if (_saveDataTimerId) {
        clearTimeout(_saveDataTimerId);
    }
    _saveDataTimerId = setTimeout(_doSaveData, 500);
}

function _doSaveData() {
    _saveDataTimerId = null;
    const data = {
        taskLists: lists,
        tasks: tasks,
        settings: settings,
        quadrantOrder: quadrantOrder,
        pomodoroHistory: pomodoroHistory,
        _version: _dataVersion
    };
    return fetch('/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(r => r.json()).then(result => {
        if (result.status === 'conflict') {
            // 版本冲突：服务器返回了最新数据，合并后重试
            console.warn('Data version conflict, merging and retrying...');
            const serverData = result.currentData || {};
            if (serverData._version !== undefined) {
                _dataVersion = serverData._version;
                delete serverData._version;
            }
            // 智能合并：以服务器数据为基础，将本地修改过的任务覆盖上去
            _mergeServerData(serverData);
            // 合并后本地数据已变化，下次刷新需强制重渲染（绕过版本号变更检测）
            _forceNextRefreshRender = true;
            // 重试保存
            return _doSaveData();
        } else if (result.version !== undefined) {
            _dataVersion = result.version;
        }
        // 服务端保存成功，同步写入 IndexedDB 冗余缓存
        cacheToIndexedDB(data);
        // 通知其他标签页数据已变更
        notifyDataChange();
    }).catch(err => {
        console.error('Save data error:', err);
        // 服务端保存失败，仍写入 IndexedDB 作为本地备份
        cacheToIndexedDB(data);
    }).finally(() => {
        _saveInFlight = false;
        // 保存完成后，如有被延迟的刷新，立即执行
        if (_dataRefreshPending) {
            _dataRefreshPending = false;
            refreshDataFromServer();
        }
    });
}

// 立即保存（不走节流），用于导入等一次性操作
function saveDataImmediate() {
    if (typeof invalidateScheduleFilterCache === 'function') invalidateScheduleFilterCache();
    // 本地 tasks 已变更，番茄任务推荐列表缓存同样需要失效
    if (typeof invalidatePomodoroTaskCache === 'function') invalidatePomodoroTaskCache();
    _saveInFlight = true; // 标记保存正在进行，防止 refreshDataFromServer 覆盖本地数据
    if (_saveDataTimerId) {
        clearTimeout(_saveDataTimerId);
        _saveDataTimerId = null;
    }
    return _doSaveData();
}

// 增量保存单个任务：仅发送该任务对象，避免序列化/传输全量数据（5510 任务）。
// 适用于勾选完成、编辑单个任务等高频操作。失败时回退到全量 saveData。
function saveTaskPatch(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return Promise.resolve();
    // 单任务变更（如完成/取消完成）同样会影响番茄任务推荐列表的排序，需失效缓存
    if (typeof invalidatePomodoroTaskCache === 'function') invalidatePomodoroTaskCache();
    _saveInFlight = true; // 防止刷新覆盖本地未持久化的变更
    return fetch('/api/tasks/' + encodeURIComponent(taskId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task)
    }).then(r => r.json()).then(result => {
        if (result.version !== undefined) {
            _dataVersion = result.version;
        }
        notifyDataChange();
        _saveInFlight = false;
        if (_dataRefreshPending) {
            _dataRefreshPending = false;
            refreshDataFromServer();
        }
    }).catch(err => {
        console.error('Task patch failed, falling back to full save:', err);
        // 离线模式或网络失败：回退到全量保存（saveData 自行管理 _saveInFlight 生命周期）
        saveData();
    });
}

function _mergeServerData(serverData) {
    // 以服务器数据为基础，将本地当前打开的详情面板任务合并进去
    const serverTasks = serverData.tasks || [];
    const serverLists = serverData.taskLists || [];
    
    // 如果有正在编辑的详情面板，保留该任务的本地版本
    if (currentDetailTaskId) {
        const localTask = tasks.find(t => t.id === currentDetailTaskId);
        if (localTask) {
            const serverIdx = serverTasks.findIndex(t => t.id === currentDetailTaskId);
            if (serverIdx >= 0) {
                serverTasks[serverIdx] = localTask;
            } else {
                serverTasks.push(localTask);
            }
        }
    }
    
    tasks = serverTasks;
    lists = serverLists.length > 0 ? serverLists : lists;
    applySettings(serverData.settings);
    quadrantOrder = serverData.quadrantOrder || quadrantOrder;
    pomodoroHistory = deduplicatePomodoroHistory(serverData.pomodoroHistory || pomodoroHistory);
    if (typeof rebuildFocusMinutesCache === 'function') rebuildFocusMinutesCache();
    if (typeof invalidateScheduleFilterCache === 'function') invalidateScheduleFilterCache();
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);

            const hasLists = data.taskLists || data.lists;
            const hasTasks = data.tasks;

            if (data.version && hasLists && hasTasks) {
                // 应用导入的数据（使用 DEFAULT_SETTINGS 确保所有字段都有默认值）
                lists = data.taskLists || data.lists;
                tasks = data.tasks;
                settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});

                quadrantOrder = data.quadrantOrder || quadrantOrder;
                pomodoroHistory = deduplicatePomodoroHistory(data.pomodoroHistory || []);

                applySettings(settings);
                // 先确保数据写入服务端，再重新初始化（避免 init 的 loadData 读到旧数据）
                await saveDataImmediate();
                await init();

                if (typeof closeSettingsModal === 'function') {
                    closeSettingsModal();
                }

                showToast('数据导入成功', 'success');
            } else {
                showToast('无效的数据格式', 'error');
            }
        } catch (error) {
            showToast('数据解析失败', 'error');
        }
    };
    reader.readAsText(file);
}

// 自动备份功能
function performAutoBackup() {
    if (!settings.backupEnabled) return;
    
    const now = new Date();
    const lastBackup = settings._lastBackupDate;
    
    const backupEnabledDate = settings._backupEnabledDate;
    if (backupEnabledDate) {
        const enabledDate = new Date(backupEnabledDate);
        const today = new Date();
        enabledDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        if (enabledDate.getTime() === today.getTime()) {
            return;
        }
    }
    
    if (lastBackup) {
        const lastDate = new Date(lastBackup);
        const daysSinceLast = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
        if (daysSinceLast < settings.backupInterval) {
            return;
        }
    }
    
    // 自动备份：直接保存到服务器，无需弹窗
    serverBackup();
}

function showBackupReminder() {
    const reminder = document.createElement('div');
    reminder.id = 'backup-reminder';
    reminder.className = 'fixed bottom-4 right-4 bg-theme-secondary rounded-xl shadow-lg p-4 max-w-sm z-50 border border-theme';
    reminder.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="p-2 bg-blue-100 rounded-full">
                <i class="fas fa-cloud-arrow-down text-blue-600"></i>
            </div>
            <div class="flex-1">
                <h4 class="font-medium text-theme-primary">备份提醒</h4>
                <p class="text-sm text-theme-secondary mt-1">已到备份时间，是否下载配置文件？</p>
                <div class="flex gap-2 mt-3">
                    <button onclick="confirmBackup()" class="flex-1 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">下载</button>
                    <button onclick="skipBackup()" class="flex-1 px-3 py-2 border border-theme text-theme-secondary rounded-lg hover:bg-theme-tertiary transition">这次不要</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(reminder);
}

function confirmBackup() {
    serverBackup();
    
    const reminder = document.getElementById('backup-reminder');
    if (reminder) {
        reminder.remove();
    }
}

function skipBackup() {
    settings._lastBackupDate = new Date().toISOString();
    saveData();
    
    const reminder = document.getElementById('backup-reminder');
    if (reminder) {
        reminder.remove();
    }
}

function toggleAutoBackup() {
    const enabled = document.getElementById('backup-enabled').checked;
    settings.backupEnabled = enabled;
    
    if (enabled) {
        settings._backupEnabledDate = new Date().toISOString();
        showToast('自动备份已启用', 'success');
    } else {
        showToast('自动备份已关闭', 'info');
    }
    saveData();
}

function updateBackupSettings() {
    const interval = parseInt(document.getElementById('backup-interval').value) || 7;
    const retention = parseInt(document.getElementById('retention-period').value) || 30;
    
    settings.backupInterval = interval;
    settings.retentionPeriod = retention;
    saveData();
}

function setRetentionToForever() {
    document.getElementById('retention-period').value = 0;
    settings.retentionPeriod = 0;
    saveData();
    showToast('已设置为永久保存', 'success');
}

function cleanupOldBackups() {
    if (settings.retentionPeriod <= 0) return;
    
    fetch('/api/backups/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: settings.retentionPeriod })
    }).then(r => r.json()).then(result => {
        if (result.deleted > 0) {
            console.log('已清理 %d 个过期备份', result.deleted);
        }
    }).catch(err => {
        console.error('清理备份失败:', err);
    });
}

function serverBackup() {
    fetch('/api/backup', { method: 'POST' })
        .then(r => {
            if (!r.ok) return r.json().catch(() => ({ success: false, error: 'HTTP ' + r.status }));
            return r.json();
        })
        .then(result => {
            if (result.success) {
                settings._lastBackupDate = new Date().toISOString();
                saveData();
                cleanupOldBackups();
                showToast('自动备份已完成', 'success');
            } else {
                showToast('备份失败：' + (result.error || '未知错误'), 'error');
            }
        })
        .catch(err => {
            console.error('备份失败:', err);
            showToast('备份失败：' + (err.message || '网络错误'), 'error');
        });
}

function exportData() {
    const a = document.createElement('a');
    a.href = '/api/export';
    a.download = 'schedule-backup-' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    showToast('数据导出成功！', 'success');
}

const DEFAULT_SETTINGS = {
    defaultListId: 'default',
    defaultImportant: false,
    defaultUrgent: false,
    defaultDuration: 30,
    defaultView: 'task',
    weekStart: 'monday',
    showCompleted: true,
    showLunar: true,
    focusDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    longBreakInterval: 4,
    autoBreak: false,
    autoFocus: false,
    autoCreateTask: true,
    toastDuration: 5,
    snoozeDelay: 15,
    refreshInterval: 30,
    cmdRemoveTimeText: true,
    cmdDefaultDate: 'none',
    easterEggEnabled: true,
    showHolidayCountdown: true,
    priorityTaskBg: true,
    showSidebarExtras: true,
    showFocusButton: true,
    bgFlowEffect: false,
    advancedParticleAnimation: true,
    theme: 'light',
    bgImage: '',
    bgOpacity: 100,
    bgBlur: 10,
    backupEnabled: false,
    backupInterval: 7,
    retentionPeriod: 30,
    bindAddress: '127.0.0.1',
    port: 14438,
    webMode: 'offline',
    fontFamily: '',
    uploadedFont: null,
    themePalette: 'none',
    themePaletteColors: null,
    customAccent: '',
    customPalettes: null, // 用户编辑后的自定义调色板 { builtin:blue: {light:{...}, dark:{...}}, ... }
    holidayApiUrl: '',
    tags: [],
    filters: []
};

function applySettings(parsed) {
    settings = Object.assign({}, DEFAULT_SETTINGS, parsed || {});
    pomodoroState.focusDuration = settings.focusDuration;
    pomodoroState.shortBreakDuration = settings.shortBreakDuration || 5;
    pomodoroState.longBreakDuration = settings.longBreakDuration || 15;
    pomodoroState.longBreakInterval = settings.longBreakInterval || 4;
    // 正在运行/暂停时不同步 breakDuration，避免覆盖长休息的实际时长导致圆环显示异常
    if (pomodoroState.state !== 'focusing' && pomodoroState.state !== 'resting' && pomodoroState.state !== 'pause') {
        pomodoroState.breakDuration = pomodoroState.phase === 'longBreak'
            ? pomodoroState.longBreakDuration : pomodoroState.shortBreakDuration;
    }
    pomodoroState.autoBreak = settings.autoBreak || false;
    pomodoroState.autoFocus = settings.autoFocus || false;
    if (pomodoroState.state === 'idle' || !pomodoroState.state) {
        pomodoroState.timeLeft = settings.focusDuration * 60;
    }
    if (typeof applyDisplaySettings === 'function') {
        applyDisplaySettings();
    }
}

async function migrateFromLocalStorage() {
    const savedLists = localStorage.getItem('taskLists');
    const savedTasks = localStorage.getItem('tasks');
    if (!savedLists && !savedTasks) return false;
    
    const data = {
        taskLists: savedLists ? JSON.parse(savedLists) : [{ id: 'default', name: '默认', color: '#3b82f6' }],
        tasks: savedTasks ? JSON.parse(savedTasks) : [],
        settings: localStorage.getItem('settings') ? JSON.parse(localStorage.getItem('settings')) : Object.assign({}, DEFAULT_SETTINGS),
        quadrantOrder: localStorage.getItem('quadrantOrder') ? JSON.parse(localStorage.getItem('quadrantOrder')) : ['urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important'],
        pomodoroHistory: localStorage.getItem('pomodoroHistory') ? JSON.parse(localStorage.getItem('pomodoroHistory')) : []
    };
    
    try {
        await fetch('/api/migrate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        localStorage.removeItem('taskLists');
        localStorage.removeItem('tasks');
        localStorage.removeItem('settings');
        localStorage.removeItem('quadrantOrder');
        localStorage.removeItem('pomodoroHistory');
        localStorage.removeItem('lastBackupDate');
        localStorage.removeItem('lastBackupVersion');
        localStorage.removeItem('backupEnabledDate');
        localStorage.removeItem('backupHistory');
        return true;
    } catch (err) {
        console.error('Migration error:', err);
        return false;
    }
}

function deduplicatePomodoroHistory(history) {
    if (!history || history.length <= 1) return history;
    const seen = new Map();
    const result = [];
    // 优先保留有 taskId 的记录
    const sorted = [...history].sort((a, b) => {
        const aHasTask = a.taskId ? 1 : 0;
        const bHasTask = b.taskId ? 1 : 0;
        return bHasTask - aHasTask;
    });
    for (const entry of sorted) {
        const key = entry.startedAt || entry.date;
        if (!seen.has(key)) {
            seen.set(key, true);
            result.push(entry);
        }
    }
    // 恢复原始顺序
    result.sort((a, b) => new Date(a.date) - new Date(b.date));
    return result;
}

async function loadData() {
    try {
        const response = await fetch('/api/data');
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        
        // 记录服务器版本号
        if (data._version !== undefined) {
            _dataVersion = data._version;
            delete data._version;
        }
        
        lists = data.taskLists && data.taskLists.length > 0 ? data.taskLists : [{ id: 'default', name: '默认', color: '#3b82f6' }];
        tasks = data.tasks || [];
        applySettings(data.settings);
        quadrantOrder = data.quadrantOrder || ['urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important'];
        pomodoroHistory = deduplicatePomodoroHistory(data.pomodoroHistory || []);

        // 服务端加载成功，同步缓存到 IndexedDB
        cacheToIndexedDB(data);
    } catch (err) {
        console.error('Load data error:', err);

        // 优先从 IndexedDB 恢复
        const idbSnapshot = await loadFromIndexedDB();
        if (idbSnapshot && idbSnapshot.data) {
            console.warn('Restored from IndexedDB cache (cached at ' + idbSnapshot.cachedAt + ')');
            const data = idbSnapshot.data;
            if (data._version !== undefined) {
                _dataVersion = data._version;
                delete data._version;
            }
            lists = data.taskLists && data.taskLists.length > 0 ? data.taskLists : [{ id: 'default', name: '默认', color: '#3b82f6' }];
            tasks = data.tasks || [];
            applySettings(data.settings);
            quadrantOrder = data.quadrantOrder || ['urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important'];
            pomodoroHistory = deduplicatePomodoroHistory(data.pomodoroHistory || []);
            showToast('服务端不可用，已从本地缓存恢复数据', 'warning', 5000);
        } else {
            // 降级：尝试从 LocalStorage 迁移
            const migrated = await migrateFromLocalStorage();
            if (migrated) {
                try {
                    const response = await fetch('/api/data');
                    if (!response.ok) throw new Error('API error');
                    const data = await response.json();
                    lists = data.taskLists && data.taskLists.length > 0 ? data.taskLists : [{ id: 'default', name: '默认', color: '#3b82f6' }];
                    tasks = data.tasks || [];
                    applySettings(data.settings);
                    quadrantOrder = data.quadrantOrder || ['urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important'];
                    pomodoroHistory = deduplicatePomodoroHistory(data.pomodoroHistory || []);
                } catch (err2) {
                    applySettings(null);
                }
            } else {
                applySettings(null);
            }
        }
    }
    
    if (settings.defaultView && !_initialLoadDone) {
        currentView = settings.defaultView;
    }
    _initialLoadDone = true;
    // 数据加载完成后重建专注时长缓存与搜索索引（覆盖上方所有恢复分支）
    if (typeof rebuildFocusMinutesCache === 'function') rebuildFocusMinutesCache();
    if (typeof invalidateScheduleFilterCache === 'function') invalidateScheduleFilterCache();
}

// 主题系统
function setTheme(theme) {
    settings.theme = theme;
    applyTheme();
    updateThemeButtons();
    saveData();
}

function applyTheme() {
    if (settings.theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    updateBgTextAdaptation();
    // 内置/自定义调色板含 light/dark 双变体，切换主题时需重新应用以选择正确变体
    if (settings.themePalette && settings.themePalette !== 'none') {
        applyThemePalette(settings.themePalette);
    }
    // 切换主题时刷新番茄统计页面（热力图等缓存了主题色）
    const statsPage = document.getElementById('pomodoro-stats-page');
    if (statsPage && !statsPage.classList.contains('hidden') && typeof renderPomodoroStats === 'function') {
        renderPomodoroStats();
    }
}

function updateThemeButtons() {
    const lightBtn = document.getElementById('theme-light-btn');
    const darkBtn = document.getElementById('theme-dark-btn');
    
    if (settings.theme === 'dark') {
        lightBtn.classList.remove('border-blue-500', 'bg-blue-50');
        lightBtn.classList.add('text-theme-primary');
        lightBtn.classList.remove('text-blue-700');
        darkBtn.classList.add('border-blue-500', 'bg-blue-50');
        darkBtn.classList.remove('text-theme-primary');
        darkBtn.classList.add('text-blue-700');
    } else {
        lightBtn.classList.add('border-blue-500', 'bg-blue-50');
        lightBtn.classList.remove('text-theme-primary');
        lightBtn.classList.add('text-blue-700');
        darkBtn.classList.remove('border-blue-500', 'bg-blue-50');
        darkBtn.classList.add('text-theme-primary');
        darkBtn.classList.remove('text-blue-700');
    }
}

// 背景图片系统
function updateBgOpacity() {
    const opacity = document.getElementById('settings-bg-opacity').value;
    document.getElementById('bg-opacity-value').textContent = opacity;
    const bgImage = document.getElementById('background-image');
    bgImage.style.opacity = opacity / 100;
}

function updateBgBlur() {
    const blur = document.getElementById('settings-bg-blur').value;
    document.getElementById('bg-blur-value').textContent = blur;
    document.documentElement.style.setProperty('--bg-blur', blur + 'px');
}

function applyBackgroundImage() {
    const bgImage = document.getElementById('background-image');
    if (!bgImage) return;

    if (settings.bgImage) {
        bgImage.style.backgroundImage = `url(${settings.bgImage})`;
        bgImage.style.opacity = (settings.bgOpacity || 100) / 100;
        bgImage.classList.remove('hidden');
        document.body.classList.add('has-bg-image');
        document.documentElement.style.setProperty('--bg-blur', (settings.bgBlur ?? 10) + 'px');
        analyzeBgImageBrightness();
    } else {
        bgImage.style.backgroundImage = 'none';
        bgImage.style.opacity = 1;
        bgImage.classList.add('hidden');
        document.body.classList.remove('has-bg-image');
        document.documentElement.style.removeProperty('--bg-blur');
        bgImageBrightness = 0.5;
        updateBgTextAdaptation();
    }
}

function updateBgTextAdaptation() {
    // 毛玻璃效果已为文本提供足够对比度，不再需要文本颜色自适应
    const root = document.documentElement;
    root.style.removeProperty('--text-primary');
    root.style.removeProperty('--text-secondary');
    root.style.removeProperty('--text-muted');
    // 若已启用主题配色，需重新应用以恢复调色板定义的文字颜色
    // （避免被上面的 removeProperty 误清除，例如异步背景图亮度分析回调触发本函数时）
    if (settings.themePalette && settings.themePalette !== 'none') {
        applyThemePalette(settings.themePalette);
    }
}

// 处理背景图片上传
function handleBgImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const imageDataUrl = e.target.result;
            settings.bgImage = imageDataUrl;
            applyBackgroundImage();
            saveData();

            // 更新预览
            const previewContainer = document.getElementById('bg-image-preview');
            const previewImg = document.getElementById('bg-preview-img');
            previewImg.src = imageDataUrl;
            previewContainer.classList.remove('hidden');

            showToast('背景图片已设置', 'success');

            // 自动触发调色板提取（仅在设置面板已渲染该 UI 时执行）
            if (typeof generatePalettePreview === 'function') {
                setTimeout(generatePalettePreview, 400);
            }
        };
        reader.readAsDataURL(file);
    }
}

// 清除背景图片
function clearBgImage() {
    settings.bgImage = '';
    applyBackgroundImage();
    saveData();
    
    // 隐藏预览
    const previewContainer = document.getElementById('bg-image-preview');
    previewContainer.classList.add('hidden');
    
    // 重置文件输入
    const fileInput = document.getElementById('bg-image-upload');
    fileInput.value = '';
    
    showToast('背景图片已清除', 'info');
}
