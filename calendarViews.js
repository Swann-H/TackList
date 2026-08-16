// ==================== 周视图 & 月视图（从 views.js 拆分） ====================

let weekViewHourStart = 6;
let weekViewHourEnd = 22;
let weekAllDayCollapsed = {};

// 移动端月视图：选中的日期（默认今天）
let _mobileMonthSelectedDate = null;
// 月视图滚动位置保持：跨重渲染保存/恢复 transform 偏移量
let _monthSavedScrollTop = null;

// 周/月视图配置：迁移自全局「视图偏好」，作用于周视图与月视图各自独立
function getWeekConfig() {
    if (!settings.weekConfig || typeof settings.weekConfig !== 'object') {
        settings.weekConfig = {};
    }
    const c = settings.weekConfig;
    // 回退读取：视图配置未显式设置时，继承全局默认值（无感升级）
    if (typeof c.showCompleted !== 'boolean') c.showCompleted = settings.showCompleted !== false;
    if (typeof c.showLunar !== 'boolean') c.showLunar = settings.showLunar !== false;
    return c;
}
function getMonthConfig() {
    if (!settings.monthConfig || typeof settings.monthConfig !== 'object') {
        settings.monthConfig = {};
    }
    const c = settings.monthConfig;
    // 回退读取：视图配置未显式设置时，继承全局默认值（无感升级）
    if (typeof c.showCompleted !== 'boolean') c.showCompleted = settings.showCompleted !== false;
    if (typeof c.showLunar !== 'boolean') c.showLunar = settings.showLunar !== false;
    // 显示调休信息：月视图日期数字左侧的「班/休」标记（新配置项，默认显示）
    if (typeof c.showSwapInfo !== 'boolean') c.showSwapInfo = true;
    return c;
}

// 周视图配置面板（右侧滑出）
_registerViewConfig('week', 'weekConfigPanel', 'week-config-btn');
function toggleWeekConfig() {
    if (_viewConfigPanels.week && _viewConfigPanels.week.open) closeViewConfigPanel('week');
    else openWeekConfig();
}
function openWeekConfig() {
    const cfg = getWeekConfig();
    const scEl = document.getElementById('wc-showcompleted');
    const slEl = document.getElementById('wc-showlunar');
    if (scEl) scEl.checked = cfg.showCompleted !== false;
    if (slEl) slEl.checked = cfg.showLunar !== false;
    openViewConfigPanel('week', (forSwitch) => {
        saveData(); // 延迟保存：变更实时预览，关闭面板时统一落盘
        if (!forSwitch) renderView(); // 切换视图场景由切换方渲染，跳过冗余渲染
    });
}
function closeWeekConfig() { closeViewConfigPanel('week'); }
function onWeekConfigChange() {
    const cfg = getWeekConfig();
    const scEl = document.getElementById('wc-showcompleted');
    const slEl = document.getElementById('wc-showlunar');
    if (scEl) cfg.showCompleted = scEl.checked;
    if (slEl) cfg.showLunar = slEl.checked;
    renderView(); // 实时预览；保存延迟到面板关闭
}

// 恢复默认配置（面板内「恢复默认」按钮）
function resetWeekViewConfig() {
    _resetViewConfigToDefault('weekConfig', { showCompleted: true, showLunar: true });
    saveData();
    renderView();
    openWeekConfig(); // 重填面板控件
    showToast('已恢复周视图默认配置', 'success');
}

// 月视图配置面板（右侧滑出）
_registerViewConfig('month', 'monthConfigPanel', 'month-config-btn');
function toggleMonthConfig() {
    if (_viewConfigPanels.month && _viewConfigPanels.month.open) closeViewConfigPanel('month');
    else openMonthConfig();
}
function openMonthConfig() {
    const cfg = getMonthConfig();
    const scEl = document.getElementById('mc-showcompleted');
    const slEl = document.getElementById('mc-showlunar');
    const ssEl = document.getElementById('mc-showswapinfo');
    if (scEl) scEl.checked = cfg.showCompleted !== false;
    if (slEl) slEl.checked = cfg.showLunar !== false;
    if (ssEl) ssEl.checked = cfg.showSwapInfo !== false;
    openViewConfigPanel('month', (forSwitch) => {
        saveData(); // 延迟保存：变更实时预览，关闭面板时统一落盘
        if (!forSwitch) renderView(); // 切换视图场景由切换方渲染，跳过冗余渲染
    });
}
function closeMonthConfig() { closeViewConfigPanel('month'); }
function onMonthConfigChange() {
    const cfg = getMonthConfig();
    const scEl = document.getElementById('mc-showcompleted');
    const slEl = document.getElementById('mc-showlunar');
    const ssEl = document.getElementById('mc-showswapinfo');
    if (scEl) cfg.showCompleted = scEl.checked;
    if (slEl) cfg.showLunar = slEl.checked;
    if (ssEl) cfg.showSwapInfo = ssEl.checked;
    renderView(); // 实时预览；保存延迟到面板关闭
}

// 恢复默认配置（面板内「恢复默认」按钮）
function resetMonthViewConfig() {
    _resetViewConfigToDefault('monthConfig', { showCompleted: true, showLunar: true });
    saveData();
    renderView();
    openMonthConfig(); // 重填面板控件
    showToast('已恢复月视图默认配置', 'success');
}

function renderWeekView(container) {
    const weekStart = new Date(currentDate);
    const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
    if (currentDate.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
    
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        weekDays.push(date);
    }
    
    const now = new Date();
    const todayStr = formatDate(now);
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    const weekNum = getWeekNumber(weekDays[0], settings.weekStart === 'monday');
    
    const allDayTasks = {};
    const timedTasks = {};
    weekDays.forEach(date => {
        const dateStr = formatDate(date);
        const dayAllTasks = getTasksForDate(date, { includeCompleted: getWeekConfig().showCompleted !== false });
        allDayTasks[dateStr] = dayAllTasks.filter(t => t.isAllDay || isMultiDayTask(t));
        timedTasks[dateStr] = dayAllTasks.filter(t => !t.isAllDay && !isMultiDayTask(t) && t.startTime);
    });
    
    const hasAnyTasks = weekDays.some(date => {
        const dateStr = formatDate(date);
        return allDayTasks[dateStr].length > 0 || timedTasks[dateStr].length > 0;
    });
    
    const hourHeight = 60;
    const totalHours = weekViewHourEnd - weekViewHourStart;
    
    let headerHtml = '';

    
    let allDayHtml = '';
    allDayHtml += '<div class="flex-shrink-0 flex week-header-sticky" style="position: sticky; top: 0; z-index: 15;">';
    allDayHtml += `<div class="flex-shrink-0" style="width: 52px;"><div class="text-xs text-theme-muted text-right pr-2 pt-1">${weekNum}周</div></div>`;
    allDayHtml += '<div class="flex-1 flex min-w-0">';
    weekDays.forEach(date => {
        const dateStr = formatDate(date);
        const isToday = dateStr === todayStr;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const dayAllDay = allDayTasks[dateStr] || [];
        const collapsed = weekAllDayCollapsed[dateStr] !== false;
        const visibleTasks = collapsed ? dayAllDay.slice(0, 2) : dayAllDay;
        
        allDayHtml += `
            <div class="flex-1 min-w-0 border-l border-theme ${isWeekend ? 'week-weekend-bg bg-gray-50 dark:bg-gray-700/15' : ''}">
                <div class="text-center py-1 border-b border-theme">
                    <div class="text-xs text-theme-secondary">${formatWeekdayShort(date)}</div>
                    <div class="h-6 flex items-center justify-center"><span class="text-sm font-bold ${isToday ? 'w-6 h-6 inline-flex items-center justify-center rounded-full bg-accent text-white' : 'text-theme-primary'}">${date.getDate()}</span></div>
                    ${(() => { const lt = getLunarDisplayText(date, getWeekConfig().showLunar); return lt ? `<div class="text-[10px] text-theme-muted leading-none mt-0.5 truncate">${lt}</div>` : ''; })()}
                </div>
                <div class="p-1 min-h-[28px]"
                     ondragover="event.preventDefault()"
                     ondrop="handleWeekAllDayDrop(event, '${dateStr}')">
                    ${visibleTasks.map(task => {
                        const list = lists.find(l => l.id === task.listId);
                        const isOverdue = isTaskOverdue(task);
                        const titleClass = task.completed ? 'opacity-55 text-theme-muted' : (isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary');
                        return `<div class="text-xs px-1 py-0.5 rounded-r truncate cursor-pointer ${titleClass}"
                                     style="background-color: ${list?.color || '#3b82f6'}20; border-left: 2px solid ${list?.color || '#3b82f6'};"
                                     title="${escapeHtml(task.title || '新任务')}"
                                     onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')"
                                     draggable="true"
                                     ondragstart="handleTaskDragStart(event, '${task.id}')"
                                     ondragend="handleTaskDragEnd(event)">${task.title || '新任务'}</div>`;
                    }).join('')}
                    ${dayAllDay.length > 2 && collapsed ? `<div class="text-xs text-accent cursor-pointer px-1" onclick="toggleWeekAllDay('${dateStr}')">+${dayAllDay.length - 2}更多</div>` : ''}
                    ${dayAllDay.length > 2 && !collapsed ? `<div class="text-xs text-accent cursor-pointer px-1" onclick="toggleWeekAllDay('${dateStr}')">收起</div>` : ''}
                </div>
            </div>
        `;
    });
    allDayHtml += '</div></div>';
    
    let timeGridHtml = `<div class="week-time-grid" style="height: 100%; overflow-y: auto; position: relative; padding-bottom: 180px;" id="week-time-grid">`;
    
    timeGridHtml += allDayHtml;
    
    timeGridHtml += '<div class="flex">';
    
    timeGridHtml += `<div class="flex-shrink-0" style="width: 52px;">`;
    for (let h = weekViewHourStart; h < weekViewHourEnd; h++) {
        timeGridHtml += `<div style="height: ${hourHeight}px;" class="text-xs text-theme-muted text-right pr-2 pt-0">${h.toString().padStart(2, '0')}:00</div>`;
    }
    timeGridHtml += '</div>';
    
    timeGridHtml += '<div class="flex-1 flex relative">';
    
    for (let h = weekViewHourStart; h < weekViewHourEnd; h++) {
        timeGridHtml += `<div class="absolute left-0 right-0 border-t border-theme" style="top: ${(h - weekViewHourStart) * hourHeight}px;"></div>`;
        timeGridHtml += `<div class="absolute left-0 right-0 border-t border-dashed border-theme" style="top: ${(h - weekViewHourStart) * hourHeight + 30}px; opacity: 0.4;"></div>`;
    }
    
    if (isCurrentWeek(weekDays)) {
        const topPx = (currentHour - weekViewHourStart) * hourHeight + (currentMinute / 60) * hourHeight;
        if (currentHour >= weekViewHourStart && currentHour < weekViewHourEnd) {
            timeGridHtml += `<div class="absolute left-0 right-0 z-10 pointer-events-none" style="top: ${topPx}px;">
                <div class="flex items-center">
                    <div class="w-2 h-2 rounded-full bg-red-500 -ml-1"></div>
                    <div class="flex-1 border-t-2 border-red-500" style="border-style: dashed;"></div>
                </div>
            </div>`;
        }
    }
    
    weekDays.forEach(date => {
        const dateStr = formatDate(date);
        const isToday = dateStr === todayStr;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const dayTimed = timedTasks[dateStr] || [];
        
        const columnTasks = layoutDayTasks(dayTimed, hourHeight);
        
        timeGridHtml += `
            <div class="flex-1 min-w-0 relative ${isWeekend ? 'week-weekend-bg bg-gray-50/50' : ''} ${isToday ? 'bg-accent-soft dark:bg-accent-strong' : ''} border-l border-theme"
                 style="height: ${totalHours * hourHeight}px;"
                 onclick="handleWeekGridClick(event, '${dateStr}')"
                 onmousemove="handleWeekGridMouseMove(event, '${dateStr}')"
                 onmouseleave="handleWeekGridMouseLeave(event)"
                 ondragover="handleWeekDragOver(event)"
                 ondrop="handleWeekTimeDrop(event, '${dateStr}')">
                <div class="week-hover-indicator absolute left-0 right-0 h-6 rounded flex items-center justify-between px-2 bg-accent-soft dark:bg-accent-strong pointer-events-none" style="display: none; top: 0px; z-index: 6;">
                    <span class="week-hover-time text-xs text-accent dark:text-accent-secondary font-medium"></span>
                    <span class="text-accent dark:text-accent-secondary font-bold text-sm">+</span>
                </div>
                ${columnTasks.map(taskLayout => {
                    const list = lists.find(l => l.id === taskLayout.task.listId);
                    const color = list?.color || '#3b82f6';
                    const topPx = taskLayout.top;
                    const heightPx = Math.max(taskLayout.height, 20);
                    const widthPercent = taskLayout.width;
                    const leftPercent = taskLayout.left;
                    const isOverdue = isTaskOverdue(taskLayout.task);
                    const titleClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary';

                    return `<div class="absolute rounded-r px-1 py-0.5 overflow-hidden cursor-pointer task-item week-task-item ${taskLayout.task.completed ? 'opacity-55' : ''}"
                                 style="top: ${topPx}px; height: ${heightPx}px; width: ${widthPercent}%; left: ${leftPercent}%; background-color: ${color}20; border-left: 3px solid ${color}; z-index: 5;"
                                 onclick="event.stopPropagation(); openTaskDetailPanel('${taskLayout.task.id}')"
                                 draggable="true"
                                 ondragstart="handleTaskDragStart(event, '${taskLayout.task.id}')"
                                 ondragend="handleTaskDragEnd(event)">
                        <div class="text-xs font-medium truncate ${titleClass}" title="${escapeHtml(taskLayout.task.title || '新任务')}">${taskLayout.task.title || '新任务'}</div>
                        ${heightPx > 30 ? `<div class="text-xs text-theme-muted truncate">${formatTime(taskLayout.task.startTime)}${taskLayout.task.endTime ? ' - ' + formatTime(taskLayout.task.endTime) : ''}</div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        `;
    });
    
    timeGridHtml += '</div></div></div>';
    
    if (!hasAnyTasks) {
        timeGridHtml = `<div class="flex flex-col items-center justify-center py-20 text-theme-muted">
            <i class="fas fa-calendar-week text-6xl mb-4 opacity-30"></i>
            <p class="text-lg">本周暂无任务，点击空白区域添加任务</p>
        </div>`;
    }
    
    const weekTitle = weekDays[0].getMonth() !== weekDays[6].getMonth()
        ? `${formatMonthYear(weekDays[0])} - ${formatMonthYear(weekDays[6])}`
        : formatMonthYear(weekDays[0]);

    // 保存旧网格的滚动位置（若存在），用于拖动后等重渲染场景保持视图位置
    const existingGrid = container.querySelector('#week-time-grid');
    const savedScrollTop = existingGrid ? existingGrid.scrollTop : null;

    container.innerHTML = `<div class="h-full flex flex-col">${headerHtml}${hasAnyTasks ? timeGridHtml : ''}</div>`;

    // 填充底部导航栏
    const _navBar = document.getElementById('view-nav-bar');
    if (_navBar) {
        _navBar.innerHTML = `
            <div class="flex items-center gap-4 bg-theme-secondary/80 backdrop-blur-md rounded-xl shadow-lg px-6 py-3">
                <button onclick="navigateWeek(-1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <h2 class="text-xl font-bold text-theme-primary min-w-[240px] text-center">${weekTitle}</h2>
                <button onclick="navigateWeek(1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;
    }

    // 同步恢复滚动位置，消除自动刷新时的跳动
    const newGrid = document.getElementById('week-time-grid');
    if (newGrid) {
        if (savedScrollTop !== null) {
            // 重渲染（如数据同步、拖动任务后）：恢复之前的滚动位置
            newGrid.scrollTop = savedScrollTop;
        } else if (hasAnyTasks && isCurrentWeek(weekDays)) {
            // 首次渲染/切换到当前周：滚动到当前时刻
            const scrollTarget = Math.max(0, (currentHour - weekViewHourStart - 1) * hourHeight);
            setTimeout(() => { newGrid.scrollTop = scrollTarget; }, 50);
        }
    }
}

function layoutDayTasks(dayTasks, hourHeight) {
    const layouts = [];

    if (dayTasks.length === 0) return layouts;

    const sorted = [...dayTasks].sort((a, b) => {
        const aStart = new Date(a.startTime);
        const bStart = new Date(b.startTime);
        if (aStart.getTime() !== bStart.getTime()) return aStart - bStart;
        const aDuration = getTaskDurationMinutes(a);
        const bDuration = getTaskDurationMinutes(b);
        return bDuration - aDuration;
    });

    // 预计算每个任务的起止分钟数与位置
    const taskInfo = sorted.map(task => {
        const start = new Date(task.startTime);
        const startMinutes = start.getHours() * 60 + start.getMinutes();
        const durationMinutes = getTaskDurationMinutes(task);
        return {
            task,
            top: (startMinutes / 60 - weekViewHourStart) * hourHeight,
            height: (durationMinutes / 60) * hourHeight,
            startMinutes,
            endMinutes: startMinutes + durationMinutes
        };
    });

    // 按时间重叠关系分组为簇：仅相互重叠的任务进入同一簇，不重叠的任务各自独立
    const clusters = [];
    let currentCluster = [];
    let clusterEnd = -Infinity;
    taskInfo.forEach(info => {
        if (currentCluster.length === 0 || info.startMinutes < clusterEnd) {
            currentCluster.push(info);
            clusterEnd = Math.max(clusterEnd, info.endMinutes);
        } else {
            clusters.push(currentCluster);
            currentCluster = [info];
            clusterEnd = info.endMinutes;
        }
    });
    if (currentCluster.length > 0) clusters.push(currentCluster);

    // 每个簇独立计算列数和宽度：单任务占满全天宽度，多任务并列时按列均分
    clusters.forEach(cluster => {
        if (cluster.length === 1) {
            const info = cluster[0];
            layouts.push({ ...info, width: 100, left: 0 });
            return;
        }

        const columns = [];
        cluster.forEach(info => {
            let placed = false;
            for (let col = 0; col < columns.length; col++) {
                const lastInCol = columns[col][columns[col].length - 1];
                if (info.startMinutes >= lastInCol.endMinutes) {
                    columns[col].push(info);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                columns.push([info]);
            }
        });

        const totalCols = columns.length;
        columns.forEach((col, colIndex) => {
            col.forEach(info => {
                layouts.push({
                    ...info,
                    width: 100 / totalCols,
                    left: colIndex * 100 / totalCols
                });
            });
        });
    });

    return layouts;
}

function getTaskDurationMinutes(task) {
    if (task.endTime) {
        const start = new Date(task.startTime);
        const end = new Date(task.endTime);
        return Math.max(15, (end - start) / (1000 * 60));
    }
    return settings.defaultDuration || 30;
}

function isCurrentWeek(weekDays) {
    const today = new Date();
    return weekDays.some(d => isSameDay(d, today));
}

function formatWeekdayShort(date) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return '周' + weekdays[date.getDay()];
}

// 获取某天的农历显示文本（用于周/日程视图日期头）
// 返回空字符串表示不显示；优先级：节假日 > 农历节日 > 节气 > 农历日名
function getLunarDisplayText(date, showLunar) {
    const enabled = (typeof showLunar === 'boolean') ? showLunar : (settings.showLunar !== false);
    if (!enabled || typeof LunarCalendar === 'undefined') return '';
    const lunar = LunarCalendar.solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
    if (!lunar) return '';
    const dateStr = formatDate(date);
    const holidayInfo = getHolidayInfo(dateStr);
    if (holidayInfo && holidayInfo.type === 'holiday' && holidayInfo.isActualDay) {
        return holidayInfo.name;
    }
    const lunarFestival = LunarCalendar.getLunarFestival(lunar.lMonth, lunar.lDay, lunar.isLeap, lunar.lYear);
    if (lunarFestival) return lunarFestival;
    const md = dateStr.substring(5);
    const solarTerms = LunarCalendar.getSolarTerms(date.getFullYear());
    if (solarTerms && solarTerms[md]) return solarTerms[md];
    return lunar.lDayName || '';
}

function toggleWeekAllDay(dateStr) {
    weekAllDayCollapsed[dateStr] = weekAllDayCollapsed[dateStr] === false;
    renderView();
}

function handleWeekGridClick(event, dateStr) {
    event.stopPropagation();
    const grid = event.currentTarget;
    const rect = grid.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const hour = weekViewHourStart + Math.floor(y / 60);
    const minute = Math.round((y % 60) / 15) * 15;
    
    if (hour < weekViewHourStart || hour >= weekViewHourEnd) return;
    
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    
    // 如果当前有打开的空任务详情，先删除空任务
    if (currentDetailTaskId) {
        const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
        if (taskIndex !== -1) {
            const task = tasks[taskIndex];
            const titleEl = document.getElementById('detail-task-title');
            const notesEl = document.getElementById('detail-task-notes');
            const currentTitle = titleEl ? titleEl.value : (task.title || '');
            const currentNotes = notesEl ? notesEl.value : (task.notes || '');
            if ((!currentTitle || !currentTitle.trim()) && (!currentNotes || !currentNotes.trim())) {
                tasks.splice(taskIndex, 1);
                saveData();
                document.getElementById('task-detail-panel').classList.add('hidden');
                currentDetailTaskId = null;
            } else {
                closeTaskDetailPanel();
            }
        } else {
            closeTaskDetailPanel();
        }
    }
    
    // 直接创建带指定时间的非全天任务
    const startTime = new Date(`${dateStr}T${timeStr}`);
    const newTask = {
        id: generateId(),
        title: '',
        listId: settings.defaultListId || 'default',
        important: settings.defaultImportant || false,
        urgent: settings.defaultUrgent || false,
        notes: '',
        tags: [],
        startTime: startTime.toISOString(),
        endTime: null,
        isAllDay: false,
        reminder: 0,
        repeat: null,
        completed: false,
        createdAt: new Date().toISOString(),
        mode: 'text',
        subtasks: [{ id: generateId(), text: '', completed: false, originalOrder: 0 }],
        progress: 0
    };
    
    tasks.push(newTask);
    saveData();
    renderLists();
    renderView();
    openTaskDetailPanel(newTask.id);
    
    setTimeout(() => {
        const titleInput = document.getElementById('detail-task-title');
        if (titleInput) {
            titleInput.focus();
            titleInput.select();
        }
    }, 100);
}

function handleWeekGridMouseMove(event, dateStr) {
    const grid = event.currentTarget;
    const indicator = grid.querySelector('.week-hover-indicator');
    if (!indicator) return;
    
    if (event.target.closest('.task-item')) {
        indicator.style.display = 'none';
        return;
    }
    
    const rect = grid.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const snappedY = Math.round(y / 15) * 15;
    const hour = weekViewHourStart + Math.floor(snappedY / 60);
    const minute = snappedY % 60;
    
    if (hour < weekViewHourStart || hour >= weekViewHourEnd) {
        indicator.style.display = 'none';
        return;
    }
    
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    
    indicator.style.display = 'flex';
    indicator.style.top = `${snappedY - 12}px`;
    indicator.querySelector('.week-hover-time').textContent = timeStr;
}

function handleWeekGridMouseLeave(event) {
    const grid = event.currentTarget;
    const indicator = grid.querySelector('.week-hover-indicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
}

function navigateWeek(direction) {
    currentDate.setDate(currentDate.getDate() + direction * 7);
    renderView();
}

// ==================== 月视图 ====================

function renderMonthView(container) {
    // 移动端：使用上下分栏布局（日历 + 任务列表）
    if (typeof isMobileView === 'function' && isMobileView()) {
        return renderMonthViewMobile(container);
    }

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
    const weekdayNames = settings.weekStart === 'monday' ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    let startOffset = firstDay.getDay() - dayOffset;
    if (startOffset < 0) startOffset += 7;
    
    const days = [];
    for (let i = startOffset - 1; i >= 0; i--) {
        days.push(new Date(year, month, -i));
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
        days.push(new Date(year, month, i));
    }
    // 动态计算尾部填充：仅填充到当月最后一天所在周的末尾，不强制6行
    const lastDayOfWeek = lastDay.getDay();
    let tailFill;
    if (dayOffset === 1) {
        // 周一开始：一周为周一→周日，最后一天之后填充到周日
        tailFill = (7 - lastDayOfWeek) % 7;
    } else {
        // 周日开始：一周为周日→周六，最后一天之后填充到周六
        tailFill = (6 - lastDayOfWeek + 7) % 7;
    }
    for (let i = 1; i <= tailFill; i++) {
        days.push(new Date(year, month + 1, i));
    }

    container.innerHTML = `
        <div id="month-view-container" class="h-full flex flex-col overflow-hidden relative">
            <div class="grid grid-cols-7 gap-2 flex-shrink-0">
                ${weekdayNames.map(d => `
                    <div class="text-center text-sm font-medium text-theme-secondary py-2">${d}</div>
                `).join('')}
            </div>
            <div id="month-scroll" class="flex-1 min-h-0" style="overflow: hidden; position: relative;">
            <div class="grid grid-cols-7 gap-2" id="month-grid" style="grid-auto-rows: 150px;">
                ${days.map(date => {
                    const dateStr = formatDate(date);
                    const dayTasks = getTasksForDate(date, { includeCompleted: getMonthConfig().showCompleted !== false });
                    const isToday = isSameDay(date, new Date());
                    const isCurrentMonth = date.getMonth() === month;
                    const displayCount = 3;
                    const displayTasks = dayTasks.slice(0, displayCount);

                    let lunarHtml = '';
                    let holidayBadge = '';
                    let weekBadge = '';
                    const holidayInfo = getHolidayInfo(dateStr);
                    const isWeekStartsOnMonday = settings.weekStart === 'monday';
                    const isWeekFirstDay = isWeekStartsOnMonday ? date.getDay() === 1 : date.getDay() === 0;
                    if (isWeekFirstDay) {
                        const weekNum = getWeekNumber(date, isWeekStartsOnMonday);
                        weekBadge = `<span class="text-[10px] text-theme-muted leading-none">${weekNum}周</span>`;
                    }
                    if (getMonthConfig().showLunar && typeof LunarCalendar !== 'undefined') {
                        const lunar = LunarCalendar.solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
                        if (lunar) {
                            let displayText = lunar.lDayName;
                            if (holidayInfo && holidayInfo.type === 'holiday' && holidayInfo.isActualDay) {
                                displayText = holidayInfo.name;
                            } else {
                                const lunarFestival = LunarCalendar.getLunarFestival(lunar.lMonth, lunar.lDay, lunar.isLeap, lunar.lYear);
                                if (lunarFestival) {
                                    displayText = lunarFestival;
                                } else {
                                    const md = dateStr.substring(5);
                                    const solarTerms = LunarCalendar.getSolarTerms(date.getFullYear());
                                    if (solarTerms[md]) {
                                        displayText = solarTerms[md];
                                    }
                                }
                            }
                            lunarHtml = `<span class="text-[10px] text-theme-muted leading-none">${displayText}</span>`;
                        }
                    }

                    // 「班/休」标记受月视图配置 showSwapInfo 控制（默认显示）
                    if (holidayInfo && getMonthConfig().showSwapInfo !== false) {
                        if (holidayInfo.type === 'work') {
                            holidayBadge = `<span class="text-[10px] text-red-500 font-bold leading-none" title="${holidayInfo.name}">班</span>`;
                        } else {
                            holidayBadge = `<span class="text-[10px] text-green-500 font-bold leading-none" title="${holidayInfo.name}">休</span>`;
                        }
                    }

                    return `
                        <div class="calendar-day bg-theme-secondary rounded-xl shadow-theme p-2 relative ${isToday ? 'today' : ''} ${!isCurrentMonth ? 'opacity-40' : ''} border border-theme drop-zone group"
                             data-date="${dateStr}"
                             ondragover="handleTaskDragOver(event)"
                             ondrop="handleMonthDrop(event, '${dateStr}')">
                            <div class="grid items-center mb-2" style="grid-template-columns: 1fr auto 1fr">
                                <div class="flex justify-start">${holidayBadge || weekBadge || ''}</div>
                                <span class="${isToday ? 'w-7 h-7 inline-flex items-center justify-center rounded-full bg-accent text-white font-bold' : 'font-medium text-theme-primary'} ${dayTasks.length > displayCount ? (isToday ? 'cursor-pointer hover:bg-accent-hover' : 'cursor-pointer hover:text-accent') : ''}" ${dayTasks.length > displayCount ? `onclick="event.stopPropagation(); openMonthDayPopover('${dateStr}')"` : ''}>${date.getDate()}</span>
                                <div class="flex justify-end">${lunarHtml || ''}</div>
                            </div>
                            <div class="space-y-1">
                                ${displayTasks.map(task => {
                                    const list = lists.find(l => l.id === task.listId);
                                    const startTime = task.startTime ? new Date(task.startTime) : null;
                                    const timeStr = task.isAllDay ? '' : (startTime ? `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}` : '');
                                    const isOverdue = isTaskOverdue(task);
                                    const titleClass = task.completed ? 'opacity-55 text-theme-muted' : (isOverdue ? OVERDUE_TEXT_CLASS : '');
                                    return `
                                        <div draggable="true" data-task-id="${task.id}"
                                             ondragstart="handleTaskDragStart(event, '${task.id}')"
                                             ondragend="handleTaskDragEnd(event)"
                                             onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')"
                                             class="text-xs p-1 rounded-r cursor-pointer truncate task-item month-task-item ${task.completed ? '' : 'hover:bg-theme-tertiary'} flex items-center justify-between gap-1"
                                             style="background-color: ${list?.color}15; border-left: 2px solid ${list?.color || '#3b82f6'}">
                                            <span class="truncate ${titleClass}" title="${escapeHtml(task.title || '新任务')}">${task.title || '新任务'}</span>
                                            ${timeStr ? `<span class="flex-shrink-0 text-theme-muted ${task.completed ? 'opacity-55' : ''}">${timeStr}</span>` : ''}
                                        </div>
                                    `;
                                }).join('')}
                                ${dayTasks.length > displayCount ? `<div class="relative text-xs"><span class="month-more-link text-accent cursor-pointer hover:underline block text-center" onclick="event.stopPropagation(); openMonthDayPopover('${dateStr}')"><span class="month-more-count">+${dayTasks.length - displayCount}</span><span class="month-more-word"> 更多</span></span><span class="text-accent cursor-pointer hover:underline font-bold opacity-0 group-hover:opacity-100 transition-opacity absolute right-0 top-0" onclick="event.stopPropagation(); openAddTaskModal('${dateStr}')">+</span></div>` : ''}
                            </div>
                            ${dayTasks.length <= displayCount ? `<button class="absolute bottom-1 right-1 text-accent text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-10" onclick="event.stopPropagation(); openAddTaskModal('${dateStr}')">+</button>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
            </div>
        </div>
    `;

    // 填充底部导航栏
    const _navBar = document.getElementById('view-nav-bar');
    if (_navBar) {
        _navBar.innerHTML = `
            <div class="flex items-center gap-4 bg-theme-secondary/80 backdrop-blur-md rounded-xl shadow-lg px-6 py-3">
                <button onclick="navigateMonth(-1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <h2 class="text-xl font-bold text-theme-primary min-w-[240px] text-center">${year}年${month + 1}月</h2>
                <button onclick="navigateMonth(1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;
    }

    // 手动滚动：用 transform 替代 CSS overflow，确保跨浏览器兼容
    const monthScroll = container.querySelector('#month-scroll');
    const monthGrid = container.querySelector('#month-grid');
    if (monthScroll && monthGrid) {
        // 基于已知参数计算高度，不依赖 offsetHeight（可能被父容器压缩）
        const numRows = Math.ceil(monthGrid.children.length / 7);
        const rowHeight = 150;
        const gap = 8;
        const gridHeight = numRows * rowHeight + (numRows - 1) * gap + 80; // +80px底部空间，避免最末行被导航栏遮挡
        // 显式设置grid高度，防止被父容器压缩
        monthGrid.style.height = gridHeight + 'px';

        // 恢复上次滚动位置（用于数据同步等重渲染场景，避免跳动）
        let scrollTop = _monthSavedScrollTop !== null ? _monthSavedScrollTop : 0;

        function applyScroll() {
            monthGrid.style.transform = `translateY(${-scrollTop}px)`;
        }

        function getMaxScroll() {
            return Math.max(0, gridHeight - monthScroll.clientHeight);
        }

        monthScroll.addEventListener('wheel', function(e) {
            const maxScroll = getMaxScroll();
            if (maxScroll <= 0) return;
            e.preventDefault();
            scrollTop = Math.max(0, Math.min(maxScroll, scrollTop + e.deltaY));
            _monthSavedScrollTop = scrollTop;
            applyScroll();
        }, { passive: false });

        // 如果当前查看的月份包含今日，且无保存的滚动位置，自动定位到今日所在行
        const todayCell = monthGrid.querySelector('.calendar-day.today');
        if (todayCell && _monthSavedScrollTop === null) {
            setTimeout(() => {
                const maxScroll = getMaxScroll();
                if (maxScroll <= 0) return;
                const cellTop = todayCell.offsetTop;
                const cellHeight = todayCell.offsetHeight;
                const viewHeight = monthScroll.clientHeight;
                scrollTop = Math.max(0, Math.min(maxScroll, cellTop - (viewHeight - cellHeight) / 2));
                _monthSavedScrollTop = scrollTop;
                applyScroll();
            }, 50);
        } else {
            // 恢复保存的滚动位置
            const maxScroll = getMaxScroll();
            scrollTop = Math.max(0, Math.min(maxScroll, scrollTop));
            _monthSavedScrollTop = scrollTop;
            applyScroll();
        }
    }

}

// ==================== 月视图日期浮层（替代内联展开） ====================

let _monthPopoverEscHandler = null;
let _monthPopoverOutsideHandler = null;

function openMonthDayPopover(dateStr) {
    // 先关闭已有浮层
    closeMonthDayPopover();

    const date = new Date(dateStr + 'T00:00:00');
    const dayTasks = getTasksForDate(date, { includeCompleted: getMonthConfig().showCompleted !== false });
    const isToday = isSameDay(date, new Date());
    const weekDayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const lunarText = getLunarDisplayText(date, getMonthConfig().showLunar);

    // 节假日徽章
    const holidayInfo = getHolidayInfo(dateStr);
    let holidayBadge = '';
    if (holidayInfo) {
        if (holidayInfo.type === 'work') {
            holidayBadge = `<span class="text-xs text-red-500 font-bold px-2 py-0.5 rounded bg-red-50 dark:bg-red-900/20" title="${holidayInfo.name}">班</span>`;
        } else {
            holidayBadge = `<span class="text-xs text-green-500 font-bold px-2 py-0.5 rounded bg-green-50 dark:bg-green-900/20" title="${holidayInfo.name}">休</span>`;
        }
    }

    // 任务列表（使用日程视图样式）。点击任务不关闭浮层，方便切换查看
    const tasksHtml = dayTasks.length > 0 ? dayTasks.map((task, taskIndex) => {
        const startTime = task.startTime ? new Date(task.startTime) : null;
        const colors = getQuadrantColorClass(task);
        const list = lists.find(l => l.id === task.listId);
        const timeDisplay = task.isAllDay ? '全天' : (startTime ? `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}` : '');
        const focusMinutes = getTaskFocusMinutes(task.id);
        const isOverdue = isTaskOverdue(task);
        const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-secondary';

        return `
            <div class="schedule-task-item group flex items-start gap-4 mb-3 task-item ${taskIndex > 0 ? 'pt-3' : ''} ${task.completed ? 'opacity-60' : ''}" onclick="event.stopPropagation(); _openTaskDetailFromMonthPopover('${task.id}')">
                <div class="w-8 flex-shrink-0 flex flex-col items-center justify-between self-stretch relative">
                    <button onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : getTaskCheckboxClass(task)}">
                        ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                    </button>
                    ${renderFocusButton(task.id)}
                </div>
                <div class="${colors.bg} rounded-r-lg p-3 flex-1 hover:opacity-80 transition schedule-task-card" style="border-left: 4px solid ${getTaskBarColor(task, list && list.color ? list.color : '#9ca3af')}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
                    <div class="flex items-center gap-2 text-sm mb-1 text-theme-secondary flex-wrap">
                        ${timeDisplay ? `<span class="${timeTextClass}">${timeDisplay}</span>` : ''}
                        ${list ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${list.color}"></span>${list.name}</span>` : ''}
                        ${renderTagCapsules(task, 2, 'right')}
                        ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-500"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                        ${task.progress && task.progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-accent"></i>${task.progress}%</span>` : ''}
                    </div>
                    <div class="font-medium ${task.completed ? 'text-theme-secondary' : 'text-theme-primary'}">
                        ${escapeHtml(task.title || '新任务')}
                    </div>
                    ${renderSubtaskListDisplay(task) || (task.notes ? `<div class="text-xs ${task.completed ? 'text-theme-muted' : 'text-theme-secondary'} mt-1">${escapeHtml(task.notes)}</div>` : '')}
                </div>
            </div>
        `;
    }).join('') : `<div class="text-center text-theme-muted py-12">当日暂无任务</div>`;

    // 浮层 HTML：不使用全屏遮罩（避免遮挡任务详情栏 z-40），改用 document click 监听外部点击
    // z-[55] 高于底部导航栏(z-50)，低于 toast(z-60)
    const popoverHtml = `
        <div id="month-day-popover" class="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[55] w-[92%] max-w-lg bg-theme-secondary rounded-2xl shadow-2xl border border-theme flex flex-col" style="max-height: 75vh;">
            <!-- 头部：日期 + 农历 + 添加按钮 + 关闭按钮 -->
            <div class="flex items-center justify-between p-4 border-b border-theme flex-shrink-0">
                <div class="flex items-center gap-3">
                    <div class="text-center">
                        <div class="${isToday ? 'text-accent-dark font-bold' : 'text-theme-primary'} text-2xl">${date.getDate()}</div>
                        <div class="text-xs text-theme-muted">周${weekDayNames[date.getDay()]}</div>
                    </div>
                    <div class="flex flex-col gap-1">
                        <div class="text-sm text-theme-secondary">${date.getFullYear()}年${date.getMonth() + 1}月</div>
                        ${lunarText ? `<div class="text-xs text-theme-muted">${lunarText}</div>` : ''}
                        ${holidayBadge}
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="event.stopPropagation(); closeMonthDayPopover(); openAddTaskModal('${dateStr}')" class="w-8 h-8 rounded-full border-2 border-purple-500 text-purple-500 flex items-center justify-center hover:bg-purple-500 hover:text-white transition" title="添加任务">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button onclick="event.stopPropagation(); closeMonthDayPopover()" class="w-8 h-8 rounded-full hover:bg-theme-tertiary text-theme-secondary flex items-center justify-center transition" title="关闭">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
            <!-- 任务列表 -->
            <div class="flex-1 overflow-y-auto p-4">
                <div class="relative pl-6">
                    <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-theme"></div>
                    ${tasksHtml}
                </div>
            </div>
        </div>
    `;

    // 插入到 body 末尾（脱离 main 的 overflow-hidden 限制）
    const wrapper = document.createElement('div');
    wrapper.id = 'month-day-popover-wrapper';
    wrapper.innerHTML = popoverHtml;
    document.body.appendChild(wrapper);

    // ESC 关闭
    _monthPopoverEscHandler = (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            closeMonthDayPopover();
        }
    };
    document.addEventListener('keydown', _monthPopoverEscHandler, true);

    // 外部点击关闭（延迟添加，避免当前点击事件触发）
    setTimeout(() => {
        _monthPopoverOutsideHandler = (e) => {
            const popover = document.getElementById('month-day-popover');
            if (!popover) return;
            // 点击浮层内：不关闭
            if (popover.contains(e.target)) return;
            // 点击任务详情栏内：不关闭（方便操作详情）
            const detailPanel = document.getElementById('task-detail-panel');
            if (detailPanel && !detailPanel.classList.contains('hidden') && detailPanel.contains(e.target)) return;
            // 其他区域：关闭浮层 + 关闭任务详情栏
            closeMonthDayPopover();
        };
        document.addEventListener('click', _monthPopoverOutsideHandler, true);
    }, 0);
}

// 浮层内点击任务：先保存当前详情（不关闭），再打开新详情，浮层保持打开
function _openTaskDetailFromMonthPopover(taskId) {
    if (currentDetailTaskId && currentDetailTaskId !== taskId) {
        saveTaskDetailWithoutClose();
    }
    openTaskDetailPanel(taskId);
}

function closeMonthDayPopover() {
    const wrapper = document.getElementById('month-day-popover-wrapper');
    if (wrapper) wrapper.remove();
    if (_monthPopoverEscHandler) {
        document.removeEventListener('keydown', _monthPopoverEscHandler, true);
        _monthPopoverEscHandler = null;
    }
    if (_monthPopoverOutsideHandler) {
        document.removeEventListener('click', _monthPopoverOutsideHandler, true);
        _monthPopoverOutsideHandler = null;
    }
    // 关闭浮层时，如有展开的任务详情栏，保存并收起
    if (currentDetailTaskId) {
        closeTaskDetailPanel();
    }
}

// ==================== 移动端月视图：上下分栏（日历网格 + 任务列表） ====================
function renderMonthViewMobile(container) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // 初始化选中日期为今天（如果在本月）或本月1号
    if (!_mobileMonthSelectedDate || !isSameMonth(_mobileMonthSelectedDate, currentDate)) {
        _mobileMonthSelectedDate = new Date();
        if (_mobileMonthSelectedDate.getMonth() !== month) {
            _mobileMonthSelectedDate = new Date(year, month, 1);
        }
    }

    const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
    const weekdayNames = settings.weekStart === 'monday'
        ? ['一', '二', '三', '四', '五', '六', '日']
        : ['日', '一', '二', '三', '四', '五', '六'];
    let startOffset = firstDay.getDay() - dayOffset;
    if (startOffset < 0) startOffset += 7;

    const days = [];
    for (let i = startOffset - 1; i >= 0; i--) {
        days.push(new Date(year, month, -i));
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
        days.push(new Date(year, month, i));
    }
    const lastDayOfWeek = lastDay.getDay();
    let tailFill;
    if (dayOffset === 1) {
        tailFill = (7 - lastDayOfWeek) % 7;
    } else {
        tailFill = (6 - lastDayOfWeek + 7) % 7;
    }
    for (let i = 1; i <= tailFill; i++) {
        days.push(new Date(year, month + 1, i));
    }

    const today = new Date();
    const sel = _mobileMonthSelectedDate;
    const selStr = formatDate(sel);
    const selTasks = getTasksForDate(sel, { includeCompleted: getMonthConfig().showCompleted !== false }).sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (a.originalOrder || 0) - (b.originalOrder || 0);
    });
    const activeTasks = selTasks.filter(t => !t.completed);
    const doneTasks = selTasks.filter(t => t.completed);

    // 日历网格 HTML
    const gridHtml = days.map(date => {
        const dateStr = formatDate(date);
        const dayTasks = getTasksForDate(date, { includeCompleted: getMonthConfig().showCompleted !== false });
        const isToday = isSameDay(date, today);
        const isSelected = isSameDay(date, sel);
        const isCurrentMonth = date.getMonth() === month;

        // 任务点（最多4个点）
        const dotCount = Math.min(dayTasks.length, 4);
        const dotsHtml = Array.from({ length: dotCount }, (_, i) => {
            const t = dayTasks[i];
            const list = lists.find(l => l.id === t.listId);
            return `<span class="w-1.5 h-1.5 rounded-full inline-block" style="background:${list?.color || '#3b82f6'}"></span>`;
        }).join('');

        let lunarText = '';
        if (getMonthConfig().showLunar && typeof LunarCalendar !== 'undefined') {
            const lunar = LunarCalendar.solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
            if (lunar) {
                const holidayInfo = getHolidayInfo(dateStr);
                let displayText = lunar.lDayName;
                if (holidayInfo && holidayInfo.type === 'holiday' && holidayInfo.isActualDay) {
                    displayText = holidayInfo.name;
                }
                lunarText = `<div class="text-[9px] text-theme-muted leading-none scale-90">${displayText}</div>`;
            }
        }

        return `
            <button class="mobile-month-day relative flex flex-col items-center justify-center py-1.5 rounded-lg transition ${isToday ? 'bg-accent text-white' : ''} ${isSelected && !isToday ? 'ring-2 ring-accent' : ''} ${!isCurrentMonth ? 'opacity-35' : 'hover:bg-theme-tertiary'}"
                    onclick="_mobileMonthSelectDate('${dateStr}')"
                    data-date="${dateStr}">
                <span class="text-sm font-medium leading-none ${isToday ? 'text-white' : (isSelected ? 'text-accent' : 'text-theme-primary')}">${date.getDate()}</span>
                ${lunarText}
                ${dotCount > 0 ? `<div class="flex gap-0.5 mt-0.5">${dotsHtml}</div>` : ''}
            </button>
        `;
    }).join('');

    // 任务列表项渲染
    function renderMobileTaskItem(task) {
        const list = lists.find(l => l.id === task.listId);
        const startTime = task.startTime ? new Date(task.startTime) : null;
        const timeStr = task.isAllDay ? '' : (startTime ? `${startTime.getHours().toString().padStart(2,'0')}:${startTime.getMinutes().toString().padStart(2,'0')}` : '');
        const isOverdue = isTaskOverdue(task);
        const titleCls = task.completed ? 'text-theme-muted line-through' : (isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary');
        const checked = task.completed ? 'checked' : '';
        return `
            <div class="flex items-center gap-3 py-2.5 border-b border-theme/50 last:border-b-0" onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')">
                <label class="flex-shrink-0" onclick="event.stopPropagation()">
                    <input type="checkbox" ${checked} onchange="toggleTaskComplete('${task.id}')" class="w-5 h-5 rounded border-theme accent-color">
                </label>
                <span class="flex-1 min-w-0 truncate text-sm ${titleCls}" title="${escapeHtml(task.title || '新任务')}">${task.title || '新任务'}</span>
                ${timeStr ? `<span class="flex-shrink-0 text-xs text-theme-muted">${timeStr}</span>` : ''}
            </div>
        `;
    }

    container.innerHTML = `
        <div id="month-view-container" class="h-full flex flex-col overflow-hidden relative bg-theme-primary">
            <!-- 月份标题栏 -->
            <div class="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b border-theme/30">
                <h2 class="text-xl font-bold text-theme-primary">${month + 1}月</h2>
                <div class="flex items-center gap-2">
                    <button onclick="switchView('week')" class="w-9 h-9 rounded-lg flex items-center justify-center text-theme-secondary hover:bg-theme-tertiary transition" title="周视图">
                        <i class="fas fa-calendar-week"></i>
                    </button>
                    <button onclick="toggleMobileMoreMenu(event)" class="w-9 h-9 rounded-lg flex items-center justify-center text-theme-secondary hover:bg-theme-tertiary transition">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                </div>
            </div>

            <!-- 星期头 -->
            <div class="grid grid-cols-7 px-2 py-1.5 flex-shrink-0 border-b border-theme/20">
                ${weekdayNames.map(d => `<div class="text-center text-xs font-medium text-theme-secondary">${d}</div>`).join('')}
            </div>

            <!-- 紧凑日历网格 -->
            <div id="mobile-month-grid" class="grid grid-cols-7 gap-0.5 px-2 py-2 flex-shrink-0">
                ${gridHtml}
            </div>

            <!-- 选中日期的任务列表 -->
            <div id="mobile-month-task-list" class="flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-3">
                <!-- 今天 / 选中日期 -->
                <div class="bg-theme-secondary rounded-xl overflow-hidden shadow-theme">
                    <div class="px-4 py-2.5 border-b border-theme/30 flex items-center justify-between">
                        <h3 class="text-sm font-semibold text-theme-primary">${isSameDay(sel, today) ? '今天' : `${sel.getMonth() + 1}月${sel.getDate()}日`}</h3>
                        <span class="text-xs text-theme-muted">${activeTasks.length} 项待办</span>
                    </div>
                    <div class="divide-y divide-theme/40">
                        ${activeTasks.length > 0 ? activeTasks.map(renderMobileTaskItem).join('') : '<div class="px-4 py-6 text-center text-sm text-theme-muted">暂无任务</div>'}
                    </div>
                </div>

                <!-- 已完成 -->
                ${doneTasks.length > 0 ? `
                <div class="bg-theme-secondary rounded-xl overflow-hidden shadow-theme">
                    <div class="px-4 py-2.5 border-b border-theme/30">
                        <h3 class="text-sm font-semibold text-theme-muted">已完成</h3>
                    </div>
                    <div class="divide-y divide-theme/40">
                        ${doneTasks.map(renderMobileTaskItem).join('')}
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
    `;

    // 填充底部月份导航
    const _navBar = document.getElementById('view-nav-bar');
    if (_navBar) {
        _navBar.innerHTML = `
            <div class="flex items-center gap-4 bg-theme-secondary/80 backdrop-blur-md rounded-xl shadow-lg px-6 py-3">
                <button onclick="navigateMonth(-1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <h2 class="text-base font-bold text-theme-primary min-w-0 text-center">${year}年${month + 1}月</h2>
                <button onclick="navigateMonth(1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;
    }
}

// 移动端月视图：选中日期
function _mobileMonthSelectDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (!isNaN(d.getTime())) {
        _mobileMonthSelectedDate = d;
        const vc = document.getElementById('view-container');
        if (vc) renderMonthView(vc);
    }
}

// 辅助：判断同月
function isSameMonth(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
}

function navigateMonth(direction) {
    closeMonthDayPopover();
    // 修复日期溢出：直接 setMonth 会在 "31日 + 目标月无31天" 时跳到下下月
    // （如 1月31日 +1 → 3月3日）。改为先计算目标月的天数上限，
    // 取 min(原日期, 目标月天数) 作为目标日期，避免溢出。
    const origDay = currentDate.getDate();
    const year = currentDate.getFullYear();
    const targetMonth = currentDate.getMonth() + direction;
    // 目标月的最后一天：下个月的第0天
    const lastDayOfTargetMonth = new Date(year, targetMonth + 1, 0).getDate();
    const safeDay = Math.min(origDay, lastDayOfTargetMonth);
    currentDate = new Date(year, targetMonth, safeDay);
    _monthSavedScrollTop = null; // 切换月份时重置滚动位置
    renderView();
}
