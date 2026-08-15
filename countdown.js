// ==================== 倒计时管理（自定义倒计时 / 侧边栏 Pin） ====================
// 入口：点击侧边栏"节假日倒计时"区域 → switchView('countdown') → 本视图
// 与"设置节假日与调休"(holiday.js) 相互独立；管理页风格参考 holiday.js 统一化处理

// 状态变量（与 holiday.js 的编辑/删除二次确认模式一致）
let countdownEditing = null;            // { isAdd:true, id:null } | { isAdd:false, id }
let countdownDeleteConfirming = null;   // 正在二次确认的自定义倒计时 id
let countdownDeleteTimer = null;

// 系统默认项的固定 key
const COUNTDOWN_AUTO_KEY = '__auto_holiday__';
const COUNTDOWN_MAX_PIN = 2;

// ---------------------------------------------------------------- 计算工具

function parseYmd(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    const dt = new Date(y, m - 1, d);
    // 校验真实存在（排除 2 月 30 日等非法日期）
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
}

// 计算距离目标日期的剩余天数（每天 0 点对齐）
// repeat==='yearly'：取今年/明年最近的该月日；repeat==='once'：固定日期，过期返回负数
function getCountdownDays(dateStr, repeat) {
    const dt = parseYmd(dateStr);
    if (!dt) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (repeat === 'yearly') {
        const y = today.getFullYear();
        let target = new Date(y, dt.getMonth(), dt.getDate());
        if (target < today) {
            target = new Date(y + 1, dt.getMonth(), dt.getDate());
        }
        return Math.round((target - today) / 86400000);
    }
    return Math.round((dt - today) / 86400000);
}

// 获取下一个法定节假日（复刻原 updateHolidayCountdown 的聚合逻辑）
function getNextHoliday() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const currentYear = now.getFullYear().toString();
    const nextYear = (now.getFullYear() + 1).toString();

    let holidayGroups = {};

    function collect(yearStr, yearData) {
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
                if (Math.round(diff) === 1) {
                    groupDates.push(sortedDates[j]);
                    j++;
                } else {
                    break;
                }
            }
            if (groupDates.length > 2) {
                const groupStart = new Date(parseInt(yearStr), parseInt(groupDates[0].split('-')[0]) - 1, parseInt(groupDates[0].split('-')[1]));
                if (!holidayGroups[name] || groupStart < holidayGroups[name].startDate) {
                    holidayGroups[name] = {
                        startDate: groupStart,
                        firstDateStr: groupDates[0],
                        count: groupDates.length
                    };
                }
            }
            i = j;
        }
    }

    collect(currentYear, holidayData[currentYear]);
    collect(nextYear, holidayData[nextYear]);

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
    return nextHoliday;
}

// 解析某个固定 key 对应的侧边栏展示项
function resolveCountdownItem(key) {
    if (key === COUNTDOWN_AUTO_KEY) {
        const nh = getNextHoliday();
        if (!nh) return null;
        return {
            key: key,
            isHoliday: true,
            name: nh.name,
            days: nh.days,
            dateLabel: (nh.startDate.getMonth() + 1) + '月' + nh.startDate.getDate() + '日起'
        };
    }
    const cd = (settings.countdowns || []).find(c => c.id === key);
    if (!cd) return null;
    const days = getCountdownDays(cd.date, cd.repeat);
    const dt = parseYmd(cd.date);
    const dateLabel = dt ? (dt.getMonth() + 1) + '月' + dt.getDate() + '日' : '';
    return { key: key, isHoliday: false, name: cd.name, days: days, dateLabel: dateLabel };
}

// ---------------------------------------------------------------- 侧边栏展示

// 中间数字行 HTML（含 data-days 供温暖色判断）
function cdDaysHtml(days) {
    if (days === null || days === undefined) return '';
    if (days < 0) {
        // 已过期：天数绝对值 +1（含两端，与未来分组保持一致）
        const passed = (-days) + 1;
        return '<span class="holiday-countdown-unit">已过</span>' +
            '<span class="holiday-countdown-number">' + passed + '</span>' +
            '<span class="holiday-countdown-unit">天</span>';
    }
    if (days === 0) {
        // 今天：不渲染数字行，由 cdItemInner 改用放大名称布局
        return '';
    }
    // 未来：天数 +1（含两端），data-days 仍保留真实剩余天数以维持临近高亮逻辑
    const remaining = days + 1;
    return '<span class="holiday-countdown-number" data-days="' + days + '">' + remaining + '</span><span class="holiday-countdown-unit">天后</span>';
}

// 单个展示项的内部 HTML（侧边栏与卡片共用）
function cdItemInner(item) {
    if (item.days === 0) {
        // 今天：放大名称（与数字相同的衬线字体）占据原名称+数字两行，第二行直接显示日期
        return '<div class="holiday-countdown-name-today">' + escapeHtml(item.name) + '</div>' +
            '<div class="holiday-countdown-date">' + escapeHtml(item.dateLabel) + '</div>';
    }
    return '<div class="holiday-countdown-label">' + escapeHtml(item.name) + '</div>' +
        '<div>' + cdDaysHtml(item.days) + '</div>' +
        '<div class="holiday-countdown-date">' + escapeHtml(item.dateLabel) + '</div>';
}

// 温暖色（临近假期时数字变橙红）
function applyCountdownWarmth() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('#holiday-countdown .holiday-countdown-number[data-days], .cd-slot .holiday-countdown-number[data-days], .cd-card .holiday-countdown-number[data-days]').forEach(el => {
        const days = parseInt(el.getAttribute('data-days'), 10);
        if (days === 3) el.style.color = isDark ? '#FFB74D' : '#E67E22';
        else if (days === 2) el.style.color = isDark ? '#FF8A65' : '#E65100';
        else if (days === 1) el.style.color = isDark ? '#EF5350' : '#C62828';
        else el.style.color = '';
    });
}

// 渲染侧边栏倒计区块（替代原 updateHolidayCountdown 的纯展示职责）
function renderSidebarCountdown() {
    const box = document.getElementById('holiday-countdown');
    if (!box) return;

    const pinned = (settings.pinnedCountdowns || []).slice();
    const items = [];
    for (const key of pinned) {
        const it = resolveCountdownItem(key);
        if (it) items.push(it);
    }

    if (items.length === 0) {
        // 未固定任何项：保留默认"下一个节假日"居中展示（向后兼容）
        const nh = getNextHoliday();
        if (!nh) {
            box.innerHTML = '<div class="holiday-countdown-label">暂无假期信息</div><div><span class="holiday-countdown-number">-</span></div>';
            return;
        }
        const m = nh.startDate.getMonth() + 1;
        const d = nh.startDate.getDate();
        box.innerHTML =
            '<div class="holiday-countdown-label">' + escapeHtml(nh.name) + '</div>' +
            '<div>' + cdDaysHtml(nh.days) + '</div>' +
            '<div class="holiday-countdown-date">' + m + '月' + d + '日起</div>';
    } else if (items.length === 1) {
        box.innerHTML = cdItemInner(items[0]);
    } else {
        // 最多 2 个：左右展示，中间虚线分割
        box.innerHTML =
            '<div class="cd-dual">' +
            '<div class="cd-dual-item">' + cdItemInner(items[0]) + '</div>' +
            '<div class="cd-divider"></div>' +
            '<div class="cd-dual-item">' + cdItemInner(items[1]) + '</div>' +
            '</div>';
    }
    applyCountdownWarmth();
}

// ---------------------------------------------------------------- Pin 开关

function toggleCountdownPin(key) {
    if (!settings.pinnedCountdowns) settings.pinnedCountdowns = [];
    const pinned = settings.pinnedCountdowns;
    const idx = pinned.indexOf(key);
    if (idx >= 0) {
        pinned.splice(idx, 1);
    } else {
        if (pinned.length >= COUNTDOWN_MAX_PIN) {
            showToast('最多只能在侧边栏展示2个倒计时信息', 'warning');
            return;
        }
        pinned.push(key);
    }
    saveData();
    renderCountdownView(document.getElementById('view-container'));
    renderSidebarCountdown();
}

// ---------------------------------------------------------------- 管理页渲染

function renderCountdownView(container) {
    if (!container) return;

    container.innerHTML =
        '<div class="countdown-container">' +
            (typeof isMobileView === 'function' && isMobileView()
                ? '<div class="flex items-center justify-between px-4 py-3 border-b border-theme/30 flex-shrink-0">' +
                      '<h1 class="text-lg font-bold text-theme-primary">倒计时</h1>' +
                      '<button onclick="switchView(\'task\')" class="w-9 h-9 rounded-full border-2 border-theme text-theme-secondary flex items-center justify-center hover:bg-theme-tertiary transition" title="返回"><i class="fas fa-arrow-left"></i></button>' +
                  '</div>'
                : '<div class="flex items-center p-4 pb-2 flex-shrink-0">' +
                      '<h1 class="text-2xl font-bold text-theme-primary">倒计时</h1>' +
                  '</div>'
            ) +
            '<div class="px-4 pb-6 space-y-6">' +

                // 顶部：两个固定槽（槽位即侧边栏预览，全宽并排）
                '<section>' +
                    '<h2 class="text-sm font-semibold text-theme-secondary mb-2">侧边栏展示</h2>' +
                    '<div class="cd-slots">' +
                        renderSlotHtml(0) +
                        renderSlotHtml(1) +
                    '</div>' +
                '</section>' +

                // 全部倒计时：拆分为「未来」与「过去」两个分组
                (function () {
                    const allItems = buildPoolItems();
                    const future = [];
                    const past = [];
                    allItems.forEach(it => {
                        // 系统默认 / 每年重复 → 未来；仅一次且日期过去 → 过去
                        const isPast = !it.isHoliday && it.repeat === 'once' && it.days < 0;
                        (isPast ? past : future).push(it);
                    });
                    const isAdding = !!(countdownEditing && countdownEditing.isAdd);
                    const total = allItems.length;

                    const futureHint = (future.length === 0 && !isAdding)
                        ? '<div class="text-center text-theme-muted py-4 text-sm col-span-full">' +
                          (total === 0 ? '暂无倒计时，点击下方“+”添加' : '暂无未来的倒计时') + '</div>'
                        : '';

                    const futureSection =
                        '<section>' +
                            '<h2 class="text-sm font-semibold text-theme-secondary mb-2">未来</h2>' +
                            '<div id="cd-pool-future" class="cd-grid" ondragover="cdAllowDrop(event)" ondragleave="cdDragLeave(event)" ondrop="cdDropOnPool(event)">' +
                                renderPoolInner(future, true) + futureHint +
                            '</div>' +
                        '</section>';

                    // “过去”分组仅在存在卡片时显示（无卡片则不显示标题栏）
                    const pastSection = (past.length > 0)
                        ? '<section>' +
                            '<h2 class="text-sm font-semibold text-theme-secondary mb-2">过去</h2>' +
                            '<div id="cd-pool-past" class="cd-grid" ondragover="cdAllowDrop(event)" ondragleave="cdDragLeave(event)" ondrop="cdDropOnPool(event)">' +
                                renderPoolInner(past, false) +
                            '</div>' +
                          '</section>'
                        : '';

                    return futureSection + pastSection;
                })() +

            '</div>' +
        '</div>';

    applyCountdownWarmth();

    setTimeout(() => {
        const nameInput = document.getElementById('cd-edit-name');
        if (nameInput) nameInput.focus();
    }, 50);
}

// 顶部固定槽渲染（每个槽即侧边栏预览框，全宽并排）
function renderSlotHtml(index) {
    const pinned = settings.pinnedCountdowns || [];
    const key = pinned[index];
    let inner, draggableAttr = '';
    if (key) {
        const it = resolveCountdownItem(key);
        if (it) {
            inner = cdItemInner(it);
            draggableAttr = ' draggable="true" ondragstart="cdDragStart(event,\'' + key + '\',\'slot\')" ondragend="cdDragEnd(event)"';
        } else {
            inner = '<span class="cd-slot-empty">（已失效）</span>';
        }
    } else {
        inner = '<span class="cd-slot-empty">拖到此处固定到侧边栏</span>';
    }
    return '<div id="cd-slot-' + index + '" class="holiday-countdown-box cd-slot" data-slot="' + index + '"' +
        ' ondragover="cdAllowDrop(event)" ondragleave="cdDragLeave(event)" ondrop="cdDropOnSlot(event,' + index + ')"' + draggableAttr + '>' +
        inner + '</div>';
}

// 卡片池数据（系统默认 + 自定义；含已固定项，系统默认始终排第一）
function buildPoolItems() {
    const items = [];
    const nh = getNextHoliday();
    if (nh) {
        items.push({
            key: COUNTDOWN_AUTO_KEY, isHoliday: true, name: nh.name, days: nh.days,
            dateLabel: (nh.startDate.getMonth() + 1) + '月' + nh.startDate.getDate() + '日起',
            editable: false, deletable: false
        });
    }
    (settings.countdowns || []).forEach(c => {
        const days = getCountdownDays(c.date, c.repeat);
        const dt = parseYmd(c.date);
        items.push({
            key: c.id, isHoliday: false, name: c.name, days: days, repeat: c.repeat,
            dateLabel: dt ? (dt.getMonth() + 1) + '月' + dt.getDate() + '日' : c.date,
            editable: true, deletable: true
        });
    });
    return items;
}

// 卡片池内部 HTML（编辑中卡片原位变为配置区；includeAdd 时末尾追加添加卡片/添加表单）
function renderPoolInner(items, includeAdd) {
    let html = '';
    const editingId = (countdownEditing && !countdownEditing.isAdd) ? countdownEditing.id : null;
    items.forEach(it => {
        if (it.key === editingId) {
            const real = (settings.countdowns || []).find(c => c.id === editingId);
            html += cdEditFormHtml(real);
        } else {
            html += cdCardHtml(it);
        }
    });
    if (includeAdd) {
        if (countdownEditing && countdownEditing.isAdd) {
            html += cdEditFormHtml(null);
        } else {
            html += cdAddCardHtml();
        }
    }
    return html;
}

function cdCardHtml(it) {
    const pinned = (settings.pinnedCountdowns || []).includes(it.key);
    const pinnedCls = pinned ? ' cd-pinned' : '';
    const pinActive = pinned ? ' active' : '';
    let rightHtml = '';
    if (it.editable) {
        rightHtml = '<button type="button" onclick="editCountdown(\'' + it.key + '\')" ' +
            'class="cd-icon-btn cd-edit-btn" title="编辑"><i class="fas fa-edit"></i></button>';
    } else if (it.isHoliday) {
        rightHtml = '<button type="button" onclick="switchToHolidayPage(\'countdown\')" ' +
            'class="cd-icon-btn cd-settings-btn" title="设置节假日与调休"><i class="fas fa-cog"></i></button>';
    }
    return '<div class="holiday-countdown-box cd-card' + pinnedCls + '" ' +
        'data-key="' + it.key + '" draggable="true" ondragstart="cdDragStart(event,\'' + it.key + '\',\'pool\')" ondragend="cdDragEnd(event)" ' +
        'ondragover="cdAllowDrop(event)" ondragleave="cdDragLeave(event)" ondrop="cdDropOnCard(event,\'' + it.key + '\')">' +
            '<button type="button" onclick="toggleCountdownPin(\'' + it.key + '\')" ' +
                'class="cd-icon-btn cd-pin-btn' + pinActive + '" title="' + (pinned ? '已在侧边栏显示，点击取消' : '固定到侧边栏') + '">' +
                '<i class="fas fa-thumbtack"></i></button>' +
            '<div class="cd-side-body">' + cdItemInner(it) + '</div>' +
            rightHtml +
        '</div>';
}

// 末尾的“添加”卡片（虚线框 + 号，与卡片等宽）
function cdAddCardHtml() {
    return '<div class="cd-add-card flex items-center justify-center p-3 rounded-lg border border-dashed border-theme cursor-pointer hover:bg-theme-tertiary transition" onclick="openAddCountdown()" title="添加倒计时">' +
        '<i class="fas fa-plus text-xl text-theme-secondary"></i></div>';
}

// ---------------------------------------------------------------- 拖拽（固定槽 / 卡片池）
let cdDragKey = null;
let cdDragFrom = null; // 'slot' | 'pool' —— 标记拖拽来源，避免从卡片池拖拽时误解除固定

function cdDragStart(event, key, from) {
    cdDragKey = key;
    cdDragFrom = from || null;
    event.dataTransfer.effectAllowed = 'move';
    try { event.dataTransfer.setData('text/plain', key); } catch (e) {}
    const el = event.currentTarget;
    if (el) el.classList.add('dragging');
}

function cdDragEnd(event) {
    const el = event.currentTarget;
    if (el) el.classList.remove('dragging');
    cdDragKey = null;
    cdDragFrom = null;
    document.querySelectorAll('.cd-dragover').forEach(e => e.classList.remove('cd-dragover'));
}

function cdAllowDrop(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const t = event.currentTarget;
    if (t && t.classList) t.classList.add('cd-dragover');
}

function cdDragLeave(event) {
    const t = event.currentTarget;
    if (t && t.classList) t.classList.remove('cd-dragover');
}

function cdDropOnSlot(event, index) {
    event.preventDefault();
    const key = cdDragKey || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
    if (!key) return;
    pinToSlot(key, index);
}

function cdDropOnPool(event) {
    event.preventDefault();
    const key = cdDragKey || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
    if (!key) return;
    // 只有从"固定槽"拖入卡片池才解除固定；从卡片池自身拖拽（含落回原处）不做任何改变
    if (cdDragFrom === 'slot') unpin(key);
}

function cdDropOnCard(event, targetKey) {
    event.preventDefault();
    event.stopPropagation();
    const key = cdDragKey || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
    if (!key) return;
    const pinned = settings.pinnedCountdowns || [];
    // 从"固定槽"拖到卡片池卡片 → 解除固定
    if (cdDragFrom === 'slot' && pinned.includes(key)) { unpin(key); return; }
    // 其它情况（卡片池内拖动 / 落回原处）→ 仅重排，不影响固定状态
    if (key !== targetKey) reorderWithinPool(key, targetKey);
}

function pinToSlot(key, index) {
    let pinned = (settings.pinnedCountdowns || []).slice();
    const oldIdx = pinned.indexOf(key);

    if (oldIdx >= 0) {
        // 已在固定槽内：仅做位置交换/重排，不要把被替换的卡片丢掉（期望 [B,A] 而非 [B,]）
        pinned.splice(oldIdx, 1);
        if (index < 0) index = 0;
        if (index > pinned.length) index = pinned.length;
        pinned.splice(index, 0, key);
    } else {
        // 来自卡片池：插入到目标槽位；若槽位已被占用则替换（被替换卡片解除固定），而非报错
        if (index < 0) index = 0;
        if (index > pinned.length) index = pinned.length;
        if (index < pinned.length) pinned.splice(index, 1);
        pinned.splice(index, 0, key);
    }
    settings.pinnedCountdowns = pinned.slice(0, COUNTDOWN_MAX_PIN);
    saveData();
    renderCountdownView(document.getElementById('view-container'));
    renderSidebarCountdown();
}

function unpin(key) {
    if (!(settings.pinnedCountdowns || []).includes(key)) return;
    settings.pinnedCountdowns = (settings.pinnedCountdowns || []).filter(k => k !== key);
    saveData();
    renderCountdownView(document.getElementById('view-container'));
    renderSidebarCountdown();
}

function reorderWithinPool(fromKey, toKey) {
    // 系统默认卡片不在 settings.countdowns 中，无法重排；
    // 拖动它或拖到它上面都不应触发解除固定，直接忽略
    if (fromKey === COUNTDOWN_AUTO_KEY || toKey === COUNTDOWN_AUTO_KEY) return;
    const arr = settings.countdowns || [];
    const fromIdx = arr.findIndex(c => c.id === fromKey);
    const toIdx = arr.findIndex(c => c.id === toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    const moved = arr.splice(fromIdx, 1)[0];
    const newTo = arr.findIndex(c => c.id === toKey);
    arr.splice(newTo, 0, moved);
    saveData();
    renderCountdownView(document.getElementById('view-container'));
}

function cdEditFormHtml(c) {
    const isAdd = !c;
    const nameVal = c ? escapeHtml(c.name) : '';
    const dateVal = c ? c.date : '';
    const repeatVal = c ? c.repeat : 'once';
    const showDelete = !!c;
    return '' +
        '<div class="cd-edit-card p-3 bg-theme-tertiary rounded-lg border border-theme border-l-4 border-l-accent">' +
            '<div class="space-y-2">' +
                '<input type="text" id="cd-edit-name" maxlength="20" value="' + nameVal + '" placeholder="名称（最多 20 字）" ' +
                    'class="w-full px-2 py-1.5 text-sm border border-theme rounded-lg bg-theme-primary text-theme-primary">' +
                '<input type="date" id="cd-edit-date" value="' + dateVal + '" ' +
                    'class="w-full px-2 py-1.5 text-sm border border-theme rounded-lg bg-theme-tertiary text-theme-primary cursor-pointer">' +
                '<div class="flex items-center gap-2">' +
                    '<button type="button" onclick="setCdEditRepeat(\'once\')" data-repeat="once" class="cd-repeat-btn detail-tag-pill ' + (repeatVal === 'once' ? 'detail-tag-pill-selected' : '') + '" style="--tag-color:#3b82f6">仅一次</button>' +
                    '<button type="button" onclick="setCdEditRepeat(\'yearly\')" data-repeat="yearly" class="cd-repeat-btn detail-tag-pill ' + (repeatVal === 'yearly' ? 'detail-tag-pill-selected' : '') + '" style="--tag-color:#22c55e">每年重复</button>' +
                    '<input type="hidden" id="cd-edit-repeat" value="' + repeatVal + '">' +
                    '<div class="flex-1"></div>' +
                    (showDelete ? (function() {
                        const confirming = countdownDeleteConfirming === c.id;
                        const cls = confirming
                            ? 'bg-red-600 text-white border-red-600'
                            : 'border-red-500 text-red-500 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/30';
                        const icon = confirming ? 'fa-check' : 'fa-trash';
                        const title = confirming ? '再次点击确认删除' : '删除';
                        return '<button type="button" onclick="deleteCountdown(\'' + c.id + '\')" class="flex items-center justify-center w-8 h-8 rounded-lg border transition ' + cls + '" title="' + title + '"><i class="fas ' + icon + ' text-sm"></i></button>';
                    })() : '') +
                    '<button type="button" onclick="saveCountdown(' + isAdd + ', \'' + (c ? c.id : '') + '\')" class="flex items-center justify-center w-8 h-8 rounded-lg border border-green-500 text-green-500 hover:bg-green-500 hover:text-white transition" title="保存"><i class="fas fa-check text-sm"></i></button>' +
                    '<button type="button" onclick="cancelCountdownEdit()" class="flex items-center justify-center w-8 h-8 rounded-lg border border-theme text-theme-secondary hover:bg-theme-primary transition" title="取消"><i class="fas fa-times text-sm"></i></button>' +
                '</div>' +
            '</div>' +
        '</div>';
}

function setCdEditRepeat(repeat) {
    const hidden = document.getElementById('cd-edit-repeat');
    if (hidden) hidden.value = repeat;
    document.querySelectorAll('.cd-repeat-btn').forEach(btn => {
        if (btn.dataset.repeat === repeat) {
            btn.classList.remove('detail-tag-pill');
            btn.classList.add('detail-tag-pill-selected');
        } else {
            btn.classList.remove('detail-tag-pill-selected');
            btn.classList.add('detail-tag-pill');
        }
    });
}

// ---------------------------------------------------------------- 编辑/新增/删除

function openAddCountdown() {
    countdownEditing = { isAdd: true, id: null };
    countdownDeleteConfirming = null;
    if (countdownDeleteTimer) { clearTimeout(countdownDeleteTimer); countdownDeleteTimer = null; }
    renderCountdownView(document.getElementById('view-container'));
}

function editCountdown(id) {
    countdownEditing = { isAdd: false, id: id };
    countdownDeleteConfirming = null;
    if (countdownDeleteTimer) { clearTimeout(countdownDeleteTimer); countdownDeleteTimer = null; }
    renderCountdownView(document.getElementById('view-container'));
}

function cancelCountdownEdit() {
    countdownEditing = null;
    countdownDeleteConfirming = null;
    if (countdownDeleteTimer) { clearTimeout(countdownDeleteTimer); countdownDeleteTimer = null; }
    renderCountdownView(document.getElementById('view-container'));
}

function saveCountdown(isAdd, id) {
    const nameInput = document.getElementById('cd-edit-name');
    const dateInput = document.getElementById('cd-edit-date');
    const repeatInput = document.getElementById('cd-edit-repeat');
    if (!nameInput || !dateInput || !repeatInput) return;

    const name = nameInput.value.trim();
    const date = dateInput.value;
    const repeat = repeatInput.value;

    if (!name) { showToast('请输入名称', 'error'); return; }
    if (name.length > 20) { showToast('名称最多 20 字', 'error'); return; }
    if (!date) { showToast('请选择目标日期', 'error'); return; }
    const dt = parseYmd(date);
    if (!dt) { showToast('日期不存在，请重新选择', 'error'); return; }

    if (!settings.countdowns) settings.countdowns = [];
    if (!isAdd) {
        const c = settings.countdowns.find(x => x.id === id);
        if (c) { c.name = name; c.date = date; c.repeat = repeat; }
    } else {
        settings.countdowns.push({ id: generateId(), name: name, date: date, repeat: repeat });
    }

    countdownEditing = null;
    saveData();
    renderCountdownView(document.getElementById('view-container'));
    renderSidebarCountdown();
    showToast(isAdd ? '添加成功' : '保存成功', 'success');
}

function deleteCountdown(id) {
    if (countdownDeleteConfirming !== id) {
        // 第一次点击：进入确认状态（点击变红，3 秒内再次点击确认）
        countdownDeleteConfirming = id;
        renderCountdownView(document.getElementById('view-container'));
        if (countdownDeleteTimer) clearTimeout(countdownDeleteTimer);
        countdownDeleteTimer = setTimeout(() => {
            countdownDeleteConfirming = null;
            renderCountdownView(document.getElementById('view-container'));
        }, 3000);
        return;
    }
    // 第二次点击：确认删除
    settings.countdowns = (settings.countdowns || []).filter(c => c.id !== id);
    settings.pinnedCountdowns = (settings.pinnedCountdowns || []).filter(k => k !== id);
    countdownDeleteConfirming = null;
    countdownEditing = null;
    if (countdownDeleteTimer) { clearTimeout(countdownDeleteTimer); countdownDeleteTimer = null; }
    saveData();
    renderCountdownView(document.getElementById('view-container'));
    renderSidebarCountdown();
    showToast('删除成功', 'success');
}
