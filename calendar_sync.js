// ==================== 外部日历订阅(ICS)同步 前端逻辑 ====================
// 仅在线版(index.html)加载；详见《外部日历订阅同步需求说明书.md》3.1/3.2/3.3.3
// 数据模型：settings.calendarSubscriptions = [{id,name,url,color,enabled,lastSyncAt,lastSyncError,extDeletedUids}]
// v2(2026-09-08 一致性改造)：设置面板仅保留按钮入口；管理界面改为独立视图(仿节假日视图)；
//                           标识色改为原生 type=color 色板(存 hex)；删除/清空改 inline 两次点击(无系统弹窗)。

// 预设色：仅作为新订阅默认色与色板兜底；用户可输入任意 hex
const CAL_SUB_COLORS = {
    blue:   { name: '蓝色', hex: '#3b82f6' },
    green:  { name: '绿色', hex: '#10b981' },
    red:    { name: '红色', hex: '#ef4444' },
    purple: { name: '紫色', hex: '#8b5cf6' },
    orange: { name: '橙色', hex: '#f59e0b' },
    teal:   { name: '青色', hex: '#14b8a6' },
    pink:   { name: '粉色', hex: '#ec4899' },
    gray:   { name: '灰色', hex: '#9ca3af' }
};

// 视图返回来源与进入前视图（用于"返回"时回到正确入口）
let calSyncReturnSource = 'settings';   // 'settings' | 其它
let calSyncPrevView = 'task';

// 删除订阅的 inline 两次点击确认状态：{ id } 或 null
let calSyncDeleteConfirming = null;
let calSyncDeleteTimer = null;
// 清空屏蔽名单的 inline 两次点击确认状态：{ id } 或 null
let calSyncBlacklistConfirming = null;
let calSyncBlacklistTimer = null;
// 当前处于编辑模式的订阅 id（null=无编辑，所有卡片展示态）
let calSyncEditingId = null;
// 新增订阅的「草稿」：点「+ 新增日历订阅」只进入编辑态，保存时才真正写入 settings
let calSyncDraft = null;
// 进入编辑态/草稿时的数据快照，用于判断「是否有未保存改动」（无改动时取消不二次确认）
let calSyncEditSnapshot = null;
// 取消编辑的 inline 两次点击确认状态：{ key }（key = 订阅 id 或 'draft'）或 null
let calSyncCancelConfirming = null;
let calSyncCancelTimer = null;
// 第二部分「各订阅源 ICS 链接获取方式」折叠状态：仅会话内记忆，不写入数据文件
let calSyncHelpCollapsed = true;

function _calSubs() {
    if (!settings) return [];
    if (!Array.isArray(settings.calendarSubscriptions)) settings.calendarSubscriptions = [];
    return settings.calendarSubscriptions;
}

function _genSubId() {
    return 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 兼容 hex 字符串与预设色键名：hex 直接返回；键名查表；空值兜底蓝色
function _calColorHex(c) {
    if (!c) return CAL_SUB_COLORS.blue.hex;
    if (typeof c === 'string' && c.charAt(0) === '#') return c;
    return (CAL_SUB_COLORS[c] || CAL_SUB_COLORS.blue).hex;
}

function _fmtLastSync(sub) {
    if (!sub.lastSyncAt) return '从未同步';
    try {
        const d = new Date(sub.lastSyncAt);
        const s = d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        return sub.lastSyncError ? (s + '（失败：' + sub.lastSyncError + '）') : (s + '（成功）');
    } catch (e) {
        return sub.lastSyncAt;
    }
}

// ==================== 独立视图(仿节假日视图) ====================

// 切换到外部日历订阅管理视图：关闭设置弹窗 + switchView('calendarsync')
function switchToCalendarSyncPage(source) {
    calSyncReturnSource = source || 'settings';
    calSyncPrevView = (typeof currentView !== 'undefined') ? currentView : 'task';
    // 侧边栏入口：设置面板本就未打开，直接切视图（避免 closeSettingsModal 触发"瞬间跳出设置面板"动画）
    if (calSyncReturnSource === 'settings') {
        if (typeof closeSettingsModal === 'function') closeSettingsModal();
    }
    if (typeof closeTaskDetailPanel === 'function') closeTaskDetailPanel();
    calSyncDeleteConfirming = null;
    calSyncBlacklistConfirming = null;
    calSyncCancelConfirming = null;
    calSyncDraft = null;
    calSyncEditSnapshot = null;
    if (calSyncDeleteTimer) { clearTimeout(calSyncDeleteTimer); calSyncDeleteTimer = null; }
    if (calSyncBlacklistTimer) { clearTimeout(calSyncBlacklistTimer); calSyncBlacklistTimer = null; }
    if (calSyncCancelTimer) { clearTimeout(calSyncCancelTimer); calSyncCancelTimer = null; }
    if (typeof switchView === 'function') switchView('calendarsync');
}

// 渲染整个外部日历订阅视图(渲染进 #view-container，与节假日视图同机制)
// 布局分两部分：
//   部分1（.calsync-section-main）：标题 + 说明 + 订阅卡片区 + 立即同步按钮；
//        占满剩余空间（flex-1），卡片区内容超出时内部滚动；帮助区收起时本部分自动变高。
//   间隔（.calsync-section-gap）：纯透明留白，壁纸模式下连同容器毛玻璃一起取消 → 直接透出壁纸。
//   部分2（.calsync-section-help）：各订阅源 ICS 链接获取方式，固定在最底部，可折叠（默认收起）。
function renderCalendarSyncView(container) {
    const helpHidden = calSyncHelpCollapsed ? 'hidden' : '';
    const chevRotate = calSyncHelpCollapsed ? '' : 'rotate-180';
    container.innerHTML =
        '<div class="holiday-view-container calendarsync-view">' +
            '<div class="h-full flex flex-col">' +
                '<div class="calsync-section-main flex-1 min-h-0 flex flex-col">' +
                    '<div class="flex items-center justify-between p-4 pb-2 flex-shrink-0">' +
                        '<h1 class="text-2xl font-bold text-theme-primary">外部日历订阅</h1>' +
                        '<button onclick="closeCalendarSyncView()" class="w-10 h-10 rounded-full border-2 border-slate-400 text-slate-500 flex items-center justify-center hover:bg-slate-500 hover:text-white active:bg-slate-600 active:scale-95 transition" title="返回"><i class="fas fa-arrow-left"></i></button>' +
                    '</div>' +
                    '<div class="px-4 flex flex-col min-h-0 flex-1">' +
                        '<p class="text-sm text-theme-secondary mb-4 flex-shrink-0">添加外部日历的 .ics 订阅链接，将外部日程任务拉取到本系统中作为只读任务展示。支持滴答清单、Outlook日历、Google日历、iCloud日历等主流日程管理软件的订阅源。</p>' +
                        '<div class="holiday-list-wrap flex-1 min-h-0 overflow-y-auto">' +
                            '<div id="calendarsync-list"></div>' +
                        '</div>' +
                        '<div class="flex justify-center pt-4 flex-shrink-0">' +
                            '<button onclick="triggerCalendarSync(true)" id="calsync-view-sync-btn" class="px-6 py-2.5 border-2 border-cyan-500 text-cyan-500 rounded-lg hover:bg-cyan-500 hover:text-white transition flex items-center gap-2 text-sm font-medium" title="立即同步所有已启用的订阅">' +
                                '<i class="fas fa-cloud-arrow-down"></i><span id="calsync-view-sync-label">立即同步</span>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="calsync-section-gap flex-shrink-0" aria-hidden="true"></div>' +
                '<div class="calsync-section-help flex-shrink-0 px-4 pb-4">' +
                    '<div class="calsync-help-panel rounded-lg border border-theme">' +
                        '<button id="calsync-help-toggle" onclick="toggleCalendarSyncHelp()" class="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-theme-tertiary transition" title="展开 / 收起">' +
                            '<span class="text-xs font-medium text-theme-muted">各订阅源 ICS 链接获取方式</span>' +
                            '<i id="calsync-help-chevron" class="fas fa-chevron-down text-xs text-theme-muted transition-transform duration-200 ' + chevRotate + '"></i>' +
                        '</button>' +
                        '<div id="calsync-help-body" class="' + helpHidden + ' px-3 pb-3">' +
                            '<div id="calsync-help-cols" class="holiday-cols"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    renderCalendarSubscriptions();
    _renderHelpSteps();
}

// 展开 / 收起「各订阅源 ICS 链接获取方式」（仅切换 DOM，不重绘，避免闪烁）
function toggleCalendarSyncHelp() {
    calSyncHelpCollapsed = !calSyncHelpCollapsed;
    const body = document.getElementById('calsync-help-body');
    const chev = document.getElementById('calsync-help-chevron');
    if (body) body.classList.toggle('hidden', calSyncHelpCollapsed);
    if (chev) chev.classList.toggle('rotate-180', !calSyncHelpCollapsed);
}

// 渲染下方"各订阅源 ICS 链接获取方式"两栏帮助卡片（仿订阅卡片两栏样式）
function _renderHelpSteps() {
    const container = document.getElementById('calsync-help-cols');
    if (!container) return;
    const steps = [
        { name: '滴答清单', scope: '网页版 / PC端', path: '头像 → 设置 → 关联与导入 → 订阅滴答清单 → 创建 ICS 订阅链接' },
        { name: 'Outlook 日历', scope: '网页版 / PC端', path: '设置 → 日历 → 共享日历 → 发布日历 → 创建 ICS 订阅链接' },
        { name: 'Google 日历', scope: '网页版', path: '侧边栏指定日历 → 设置和共享（或设置） → 集成日历 → 以 iCal 格式显示的不公开网址' },
        { name: 'iCloud 日历', scope: 'Mac 端', path: '侧边栏指定日历 → 共享日历 → 勾选公共日历 → 复制 URL 链接' }
    ];
    // 帮助区沿用原「i%2 分两列」分配（左列 0/2、右列 1/3）；订阅卡片区另走行优先 grid
    container.innerHTML = '<div class="holiday-col" id="calsync-help-col-1"></div><div class="holiday-col" id="calsync-help-col-2"></div>';
    const col1 = document.getElementById('calsync-help-col-1');
    const col2 = document.getElementById('calsync-help-col-2');
    steps.forEach((s, i) => {
        const card = document.createElement('div');
        card.className = 'holiday-section calendarsync-card flex flex-col gap-1 px-3 py-2 rounded-r-lg border border-theme border-l-2 border-l-accent';
        card.innerHTML =
            '<div class="flex items-center gap-2">' +
                '<span class="text-sm font-medium text-theme-primary">' + escapeHtml(s.name) + '</span>' +
                '<span class="text-xs text-theme-muted">(' + escapeHtml(s.scope) + ')</span>' +
            '</div>' +
            '<p class="text-xs text-theme-secondary leading-relaxed">' + escapeHtml(s.path) + '</p>';
        (i % 2 === 0 ? col1 : col2).appendChild(card);
    });
}

// 关闭/返回外部日历订阅视图
function closeCalendarSyncView() {
    calSyncDeleteConfirming = null;
    calSyncBlacklistConfirming = null;
    calSyncCancelConfirming = null;
    calSyncDraft = null;              // 离开视图即丢弃未保存的新增草稿
    calSyncEditSnapshot = null;
    calSyncEditingId = null;
    if (calSyncDeleteTimer) { clearTimeout(calSyncDeleteTimer); calSyncDeleteTimer = null; }
    if (calSyncBlacklistTimer) { clearTimeout(calSyncBlacklistTimer); calSyncBlacklistTimer = null; }
    if (calSyncCancelTimer) { clearTimeout(calSyncCancelTimer); calSyncCancelTimer = null; }
    if (calSyncReturnSource === 'settings') {
        if (typeof switchView === 'function') switchView(calSyncPrevView || 'task');
        if (typeof openSettingsModal === 'function') openSettingsModal();
    } else {
        if (typeof switchView === 'function') switchView(calSyncPrevView || 'task');
    }
}

// 进入编辑模式（双击卡片触发）
function enterCalendarSubEditMode(id) {
    // 存在未保存的新增草稿时：有改动则先要求处理草稿，无改动则直接丢弃草稿
    if (calSyncDraft) {
        if (_editHasChanges()) {
            showToast('请先保存或取消正在新增的订阅', 'warning');
            return;
        }
        calSyncDraft = null;
    }
    const sub = _calSubs().find(s => s.id === id);
    calSyncEditingId = id;
    calSyncEditSnapshot = sub ? _snapshotOf(sub) : null;
    _clearCancelConfirm();
    calSyncDeleteConfirming = null;
    calSyncBlacklistConfirming = null;
    renderCalendarSubscriptions();
    setTimeout(() => {
        const nameInput = document.querySelector('[data-edit-name]');
        if (nameInput) { nameInput.focus(); nameInput.select(); }
    }, 50);
}

// 读取编辑态输入框当前值（编辑态全局唯一，取第一组即可）
function _currentEditValues() {
    const n = document.querySelector('[data-edit-name]');
    const u = document.querySelector('[data-edit-url]');
    const c = document.querySelector('[data-edit-color]');
    return {
        name: n ? (n.value || '').trim() : '',
        url: u ? (u.value || '').trim() : '',
        color: c ? c.value : ''
    };
}

// 生成订阅数据快照（用于「是否有未保存改动」比对）
function _snapshotOf(sub) {
    return {
        name: (sub.name || '').trim(),
        url: (sub.url || '').trim(),
        color: _calColorHex(sub.color)
    };
}

// 当前编辑内容是否相对快照有改动（名称/URL/标识色任一变化）
function _editHasChanges() {
    if (!calSyncEditSnapshot) return false;
    const cur = _currentEditValues();
    const base = calSyncEditSnapshot;
    return cur.name !== base.name || cur.url !== base.url || cur.color !== base.color;
}

function _clearCancelConfirm() {
    calSyncCancelConfirming = null;
    if (calSyncCancelTimer) { clearTimeout(calSyncCancelTimer); calSyncCancelTimer = null; }
}

// 丢弃编辑内容（草稿或已有订阅编辑态）
function _discardEdit(key) {
    _clearCancelConfirm();
    calSyncEditSnapshot = null;
    if (key === 'draft') calSyncDraft = null;
    else calSyncEditingId = null;
    renderCalendarSubscriptions();
}

// 取消按钮 / Esc：无改动直接退出；有改动走 inline 两次点击确认（3 秒超时自动取消确认态）
// 确认态样式与卡片删除按钮一致：默认描边红 → 悬浮浅红底 → 确认态实心红底白字
function requestCancelCalendarSubEdit(key) {
    // 第二次点击：确认丢弃（不保存）
    if (calSyncCancelConfirming && calSyncCancelConfirming.key === key) {
        _discardEdit(key);
        return;
    }
    // 未做任何改动：无需二次确认，直接退出
    if (!_editHasChanges()) {
        _discardEdit(key);
        return;
    }
    calSyncCancelConfirming = { key };
    if (calSyncCancelTimer) clearTimeout(calSyncCancelTimer);
    calSyncCancelTimer = setTimeout(() => {
        calSyncCancelConfirming = null;
        renderCalendarSubscriptions();
    }, 3000);
    renderCalendarSubscriptions();
}

// 兼容旧调用（无参）：按当前编辑对象推导 key
function cancelCalendarSubEdit() {
    requestCancelCalendarSubEdit(calSyncDraft ? 'draft' : (calSyncEditingId || 'draft'));
}

// 保存编辑（保存按钮 / Enter）
function saveCalendarSubEdit(id) {
    const sub = _calSubs().find(s => s.id === id);
    if (!sub) { calSyncEditingId = null; renderCalendarSubscriptions(); return; }
    const v = _currentEditValues();
    if (!v.url) {
        showToast('请填写订阅 URL 后再保存', 'warning');
        const u = document.querySelector('[data-edit-url]');
        if (u) u.focus();
        return;
    }
    sub.name = v.name || '未命名订阅';
    sub.url = v.url;
    sub.color = v.color;  // hex 直接存
    calSyncEditingId = null;
    calSyncEditSnapshot = null;
    _clearCancelConfirm();
    saveData();
    renderCalendarSubscriptions();
    if (typeof renderLists === 'function') renderLists();
    if (typeof renderView === 'function') renderView();
    updateCalendarSyncBtnVisibility();
    showToast('订阅已保存', 'success');
}

// 保存「新增订阅」草稿：校验通过后才真正写入 settings 并提示
function saveCalendarSubDraft() {
    if (!calSyncDraft) return;
    const v = _currentEditValues();
    if (!v.url) {
        showToast('请填写订阅 URL 后再保存', 'warning');
        const u = document.querySelector('[data-edit-url]');
        if (u) u.focus();
        return;
    }
    const sub = Object.assign({}, calSyncDraft, {
        name: v.name || '未命名订阅',
        url: v.url,
        color: v.color
    });
    _calSubs().push(sub);
    calSyncDraft = null;
    calSyncEditSnapshot = null;
    _clearCancelConfirm();
    saveData();
    renderCalendarSubscriptions();
    if (typeof renderLists === 'function') renderLists();
    if (typeof renderView === 'function') renderView();
    updateCalendarSyncBtnVisibility();
    showToast('已添加新订阅', 'success');
}

// 渲染订阅列表到视图内 #calendarsync-list
// 顺序：先从左到右、再从上到下（单个 grid 容器自然行优先填充，不再按 i%2 分列）
function renderCalendarSubscriptions() {
    const container = document.getElementById('calendarsync-list');
    if (!container) return;
    const subs = _calSubs();

    // 收集所有卡片（末尾为"新增日历订阅"虚线框卡片，或新增中的草稿编辑卡片）
    const allCards = subs.map(sub => _renderSubCard(sub));
    if (calSyncDraft) allCards.push(_renderSubCard(calSyncDraft, true));
    else allCards.push(_renderAddCard());

    container.innerHTML = '<div class="holiday-cols calsync-grid"></div>';
    const grid = container.firstChild;
    allCards.forEach(card => grid.appendChild(card));
}

// 统一的「二次确认」按钮样式（删除 / 清空屏蔽 / 取消编辑共用）：
// 默认态描边红字 → 鼠标悬浮浅红底 → 二次确认态实心红底白字
function _confirmBtnClass(isConfirming) {
    return isConfirming
        ? 'bg-red-600 text-white border-red-600 dark:bg-red-700 dark:border-red-700'
        : 'border border-red-500 text-red-500 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/30';
}

// 统一的删除按钮样式（与清单 deleteListInput 一致：默认红边框红字+浅红悬浮；二次确认实心红底白字；图标始终 fa-trash）
function _delBtnClass(isConfirming) {
    return _confirmBtnClass(isConfirming);
}

// 渲染单个订阅卡片（展示态或编辑态）；
// isDraft=true 表示这是尚未写入 settings 的「新增订阅」草稿
function _renderSubCard(sub, isDraft) {
    const div = document.createElement('div');
    const hex = _calColorHex(sub.color);
    const isEditing = !!isDraft || calSyncEditingId === sub.id;
    const deletedCount = (sub.extDeletedUids || []).length;
    const isDelConfirming = calSyncDeleteConfirming && calSyncDeleteConfirming.id === sub.id;
    const isBlConfirming = calSyncBlacklistConfirming && calSyncBlacklistConfirming.id === sub.id;
    const cancelKey = isDraft ? 'draft' : sub.id;
    const isCancelConfirming = calSyncCancelConfirming && calSyncCancelConfirming.key === cancelKey;

    div.className = 'holiday-section calendarsync-card group flex flex-col gap-2 px-3 py-3 rounded-r-lg border border-theme border-l-4' +
        (isEditing ? ' bg-theme-tertiary calsync-card-editing' : '');
    div.style.borderLeftColor = hex;
    if (!isDraft) div.dataset.subId = sub.id;

    if (isEditing) {
        // 编辑态：色板 + 名称 input + 保存/取消；URL input；状态开关（草稿默认启用，无开关行）
        const saveCall = isDraft ? 'saveCalendarSubDraft()' : "saveCalendarSubEdit('" + sub.id + "')";
        const keyHandler = "if(event.key==='Enter'){event.preventDefault();" + saveCall +
            "}else if(event.key==='Escape'){event.preventDefault();requestCancelCalendarSubEdit('" + cancelKey + "')}";
        div.innerHTML = `
            <div class="flex items-center gap-2">
                <input type="color" value="${hex}" data-edit-color class="w-8 h-8 rounded cursor-pointer flex-shrink-0 border border-theme" title="订阅标识色">
                <input type="text" value="${escapeHtml(sub.name || '')}" placeholder="订阅名称" data-edit-name class="flex-1 min-w-0 px-2 py-1.5 border border-theme rounded-lg bg-theme-primary text-theme-primary text-sm" onkeydown="${keyHandler}">
                <button onclick="${saveCall}" class="flex items-center justify-center w-8 h-8 rounded-lg bg-accent text-white hover:bg-accent-hover transition" title="保存"><i class="fas fa-check text-sm"></i></button>
                <button onclick="requestCancelCalendarSubEdit('${cancelKey}')" class="flex items-center justify-center w-8 h-8 rounded-lg ${_confirmBtnClass(isCancelConfirming)} transition" title="${isCancelConfirming ? '再次点击确认取消' : '取消'}"><i class="fas fa-times text-sm"></i></button>
            </div>
            <div class="space-y-1.5 text-xs ml-1">
                <div class="flex items-center gap-2">
                    <span class="w-16 text-theme-muted flex-shrink-0">URL</span>
                    <input type="text" value="${escapeHtml(sub.url || '')}" placeholder="https://...（webcal:// 自动转 https://）" data-edit-url class="flex-1 min-w-0 px-2 py-1 border border-theme rounded-lg bg-theme-primary text-theme-primary text-xs font-mono" onkeydown="${keyHandler}">
                </div>
                ${isDraft ? '' : `
                <div class="flex items-center gap-2">
                    <span class="w-16 text-theme-muted flex-shrink-0">状态</span>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" ${sub.enabled ? 'checked' : ''} data-edit-enabled onchange="toggleCalendarSubscription('${sub.id}', this.checked)" class="sr-only peer">
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                    </label>
                </div>`}
            </div>
        `;
    } else {
        // 展示态：首行[色圆点 名称 开关(右上角)] + URL/上次同步/已屏蔽行(右侧悬浮清空+删除按钮)
        const syncClass = sub.lastSyncError ? 'text-red-400' : 'text-theme-secondary';
        div.ondblclick = () => enterCalendarSubEditMode(sub.id);
        div.title = '双击编辑';
        const blBtn = deletedCount
            ? `<button onclick="clearCalendarSubscriptionBlacklist('${sub.id}')" class="flex items-center justify-center w-7 h-7 rounded-lg border ${isBlConfirming ? 'bg-amber-600 text-white border-amber-600' : 'border-amber-500 text-amber-600 hover:bg-amber-50 dark:border-amber-400 dark:text-amber-400 dark:hover:bg-amber-900/30'} opacity-0 group-hover:opacity-100 transition" title="${isBlConfirming ? '再次点击确认清空' : '清空屏蔽名单'}"><i class="fas fa-broom text-xs"></i></button>`
            : '';
        div.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color:${hex}" title="订阅标识色"></span>
                <span class="flex-1 min-w-0 text-sm font-medium text-theme-primary truncate">${escapeHtml(sub.name || '未命名订阅')}</span>
                <label class="relative inline-flex items-center cursor-pointer" title="${sub.enabled ? '已启用' : '已停用'}">
                    <input type="checkbox" ${sub.enabled ? 'checked' : ''} onchange="toggleCalendarSubscription('${sub.id}', this.checked)" class="sr-only peer">
                    <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                </label>
            </div>
            <div class="space-y-1.5 text-xs ml-1">
                <div class="flex items-start gap-2">
                    <span class="w-16 text-theme-muted flex-shrink-0">URL</span>
                    <span class="flex-1 min-w-0 text-theme-secondary break-all font-mono">${escapeHtml(sub.url || '（未设置）')}</span>
                </div>
                <div class="flex items-start gap-2">
                    <span class="w-16 text-theme-muted flex-shrink-0">上次同步</span>
                    <span class="${syncClass} break-all">${_fmtLastSync(sub)}</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="w-16 text-theme-muted flex-shrink-0">已屏蔽</span>
                    <span class="${deletedCount ? 'text-accent cursor-pointer hover:underline' : 'text-theme-secondary'}" ${deletedCount ? `onclick="showCalendarSyncBlacklist('${sub.id}')" title="点击查看屏蔽的日程"` : ''}>${deletedCount} 条日程</span>
                    <div class="flex-1"></div>
                    ${blBtn}
                    <button onclick="deleteCalendarSubscription('${sub.id}')" class="flex items-center justify-center w-7 h-7 rounded-lg border ${_delBtnClass(isDelConfirming)} opacity-0 group-hover:opacity-100 transition" title="${isDelConfirming ? '确认删除' : '删除'}">
                        <i class="fas fa-trash text-xs"></i>
                    </button>
                </div>
            </div>
        `;
    }
    return div;
}

// 渲染末尾"新增日历订阅"虚线框卡片（与标准卡片同尺寸）
function _renderAddCard() {
    const div = document.createElement('div');
    div.className = 'holiday-section calendarsync-card flex items-center justify-center px-3 py-3 rounded-r-lg border-2 border-dashed border-theme hover:border-accent hover:bg-accent-soft transition cursor-pointer';
    div.title = '点击添加新的日历订阅';
    div.onclick = () => addCalendarSubscription();
    div.innerHTML = `
        <div class="flex items-center gap-2 text-theme-secondary hover:text-accent transition">
            <i class="fas fa-plus"></i>
            <span class="text-sm">新增日历订阅</span>
        </div>
    `;
    return div;
}

// 点「+ 新增日历订阅」：只创建一个未落库的草稿并进入编辑态（保存时才写入并提示）
function addCalendarSubscription() {
    if (calSyncDraft) {
        // 已有草稿：不重复创建，聚焦到它
        renderCalendarSubscriptions();
        setTimeout(() => {
            const nameInput = document.querySelector('[data-edit-name]');
            if (nameInput) { nameInput.focus(); nameInput.select(); }
        }, 50);
        return;
    }
    calSyncEditingId = null;
    calSyncDeleteConfirming = null;
    calSyncBlacklistConfirming = null;
    _clearCancelConfirm();
    calSyncDraft = {
        id: _genSubId(),
        name: '',
        url: '',
        color: '#3b82f6',  // 直接存 hex（与清单颜色选择一致）
        enabled: true,
        lastSyncAt: '',
        lastSyncError: '',
        extDeletedUids: []
    };
    calSyncEditSnapshot = _snapshotOf(calSyncDraft);
    renderCalendarSubscriptions();
    setTimeout(() => {
        const nameInput = document.querySelector('[data-edit-name]');
        if (nameInput) { nameInput.focus(); nameInput.select(); }
    }, 50);
}

// inline 两次点击删除订阅：首次点击进入确认态（3 秒超时自动取消），再次点击才真删
function deleteCalendarSubscription(id) {
    const subs = _calSubs();
    const sub = subs.find(s => s.id === id);
    if (!sub) return;

    if (!calSyncDeleteConfirming || calSyncDeleteConfirming.id !== id) {
        // 第一次点击：进入确认态
        calSyncDeleteConfirming = { id };
        if (calSyncDeleteTimer) clearTimeout(calSyncDeleteTimer);
        calSyncDeleteTimer = setTimeout(() => {
            calSyncDeleteConfirming = null;
            renderCalendarSubscriptions();
        }, 3000);
        renderCalendarSubscriptions();
        return;
    }

    // 第二次点击：确认删除
    calSyncDeleteConfirming = null;
    if (calSyncDeleteTimer) { clearTimeout(calSyncDeleteTimer); calSyncDeleteTimer = null; }

    // 统计该订阅的任务数（含已移动到其他清单的）
    const taskCount = tasks.filter(t => t.extSourceId === id).length;
    // 清理任务与专属清单（附录 A-3）
    tasks = tasks.filter(t => t.extSourceId !== id);
    lists = lists.filter(l => l.extSourceId !== id && l.id !== 'extlist_' + id);
    // 移除订阅
    settings.calendarSubscriptions = subs.filter(s => s.id !== id);
    saveData();
    if (typeof renderLists === 'function') renderLists();
    if (typeof renderView === 'function') renderView();
    renderCalendarSubscriptions();
    updateCalendarSyncBtnVisibility();
    showToast(`订阅「${sub.name || '未命名'}」已删除，含 ${taskCount} 条任务与专属清单`, 'success');
}

function toggleCalendarSubscription(id, enabled) {
    const sub = _calSubs().find(s => s.id === id);
    if (sub) { sub.enabled = enabled; saveData(); updateCalendarSyncBtnVisibility(); if (typeof renderLists === 'function') renderLists(); }
}

function updateCalendarSubscriptionField(id, field, value) {
    const sub = _calSubs().find(s => s.id === id);
    if (!sub) return;
    value = (value || '').trim();
    if (field === 'url') {
        // webcal:// 自动改写提示（实际改写在后端）
        sub[field] = value;
    } else {
        sub[field] = value;
    }
    saveData();
    if (field === 'color') {
        renderCalendarSubscriptions(); // 颜色变更需重绘色条
        if (typeof renderLists === 'function') renderLists(); // 侧边栏圆点同步
        if (typeof renderView === 'function') renderView();    // 任务视图色条同步
    }
    updateCalendarSyncBtnVisibility();
}

// inline 两次点击清空屏蔽名单
function clearCalendarSubscriptionBlacklist(id) {
    const sub = _calSubs().find(s => s.id === id);
    if (!sub) return;

    if (!calSyncBlacklistConfirming || calSyncBlacklistConfirming.id !== id) {
        calSyncBlacklistConfirming = { id };
        if (calSyncBlacklistTimer) clearTimeout(calSyncBlacklistTimer);
        calSyncBlacklistTimer = setTimeout(() => {
            calSyncBlacklistConfirming = null;
            renderCalendarSubscriptions();
        }, 3000);
        renderCalendarSubscriptions();
        return;
    }

    calSyncBlacklistConfirming = null;
    if (calSyncBlacklistTimer) { clearTimeout(calSyncBlacklistTimer); calSyncBlacklistTimer = null; }
    sub.extDeletedUids = [];
    saveData();
    renderCalendarSubscriptions();
    showToast('屏蔽名单已清空，下次同步将重新拉取', 'success');
}

// 展示已屏蔽的日程条目浮层（仿番茄专注任务列表样式：左色条+标题+时间）
function showCalendarSyncBlacklist(subId) {
    const sub = _calSubs().find(s => s.id === subId);
    if (!sub) return;
    const hex = _calColorHex(sub.color);
    const raw = Array.isArray(sub.extDeletedUids) ? sub.extDeletedUids : [];
    // 兼容旧字符串格式和新对象格式
    const items = raw.map(d => {
        if (typeof d === 'string') return { uid: d, title: d, startTime: '', deletedAt: '' };
        return { uid: d.uid || '', title: d.title || d.uid || '', startTime: d.startTime || '', deletedAt: d.deletedAt || '' };
    });
    const count = items.length;

    // 移除已有浮层
    closeCalendarSyncBlacklist();

    const overlay = document.createElement('div');
    overlay.id = 'calsync-blacklist-overlay';
    overlay.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4';
    overlay.onclick = function (e) { if (e.target === overlay) closeCalendarSyncBlacklist(); };

    const itemsHtml = items.length === 0
        ? '<div class="text-center py-8 text-theme-muted text-sm">暂无屏蔽条目</div>'
        : items.map(item => {
            const timeText = item.startTime ? (typeof formatDateTime === 'function' ? formatDateTime(item.startTime) : item.startTime) : '无时间';
            const delText = item.deletedAt ? '屏蔽于 ' + (typeof formatDateTime === 'function' ? formatDateTime(item.deletedAt) : item.deletedAt) : '';
            return `
            <div class="flex items-start gap-3 py-2 px-3 rounded-r-lg" style="border-left: 4px solid ${hex}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
                <div class="flex-1 min-w-0">
                    <div class="text-sm text-theme-primary truncate">${escapeHtml(item.title || '未命名日程')}</div>
                    <div class="flex items-center gap-2 text-xs text-theme-secondary mt-0.5">
                        <span>${timeText}</span>
                        ${delText ? `<span class="text-theme-muted">· ${delText}</span>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

    overlay.innerHTML = `
        <div class="bg-theme rounded-lg shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col">
            <div class="flex items-center justify-between p-4 border-b border-theme flex-shrink-0">
                <h3 class="text-base font-semibold text-theme-primary flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full" style="background-color:${hex}"></span>
                    ${escapeHtml(sub.name || '订阅')} · 已屏蔽 ${count} 条
                </h3>
                <button onclick="closeCalendarSyncBlacklist()" class="w-8 h-8 rounded-lg hover:bg-theme-tertiary flex items-center justify-center text-theme-secondary transition" title="关闭"><i class="fas fa-times"></i></button>
            </div>
            <div class="flex-1 overflow-y-auto p-2 space-y-0.5">${itemsHtml}</div>
            <div class="p-3 border-t border-theme flex-shrink-0 text-xs text-theme-muted">
                清空屏蔽名单后，下次同步将重新拉取这些日程
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function closeCalendarSyncBlacklist() {
    const overlay = document.getElementById('calsync-blacklist-overlay');
    if (overlay) overlay.remove();
}

// 右上角同步按钮显隐：至少一个启用订阅时显示（3.1）
function updateCalendarSyncBtnVisibility() {
    const btn = document.getElementById('calendar-sync-btn');
    if (!btn) return;
    const hasEnabled = _calSubs().some(s => s.enabled);
    btn.classList.toggle('hidden', !hasEnabled);
}

// 触发同步（3.1）；fromSettings 区分入口用于 toast 文案
// 视图内「立即同步」按钮：图标保持不变，文字切换为「同步中…」，完成后恢复；右上角图标按钮用放大缩小脉动反馈
async function triggerCalendarSync(fromSettings) {
    const btn = document.getElementById('calendar-sync-btn');
    const viewBtn = document.getElementById('calsync-view-sync-btn');
    const allBtn = document.getElementById('calendarsync-sync-all-btn');
    const viewLabel = document.getElementById('calsync-view-sync-label');
    const icon = btn ? btn.querySelector('i') : null;
    if (icon) icon.classList.add('calsync-icon-pulse');
    if (viewLabel) viewLabel.textContent = '同步中…';
    if (btn) btn.disabled = true;
    if (viewBtn) viewBtn.disabled = true;
    if (allBtn) { allBtn.disabled = true; allBtn.classList.add('opacity-50'); }
    try {
        const resp = await fetch('/api/calendar-sync', { method: 'POST' });
        const data = await resp.json();
        if (data.status === 'ok') {
            const s = data.sync || {};
            const errResults = (s.results || []).filter(r => r.error);
            const main = `同步完成：新增 ${s.added || 0}，更新 ${s.updated || 0}，移除 ${s.removed || 0}`;
            showToast(main, 'success');
            if (errResults.length) {
                setTimeout(() => showToast(`${errResults.length} 个源失败：${errResults.map(r => r.name + '（' + r.error + '）').join('；')}`, 'warning'), 1200);
            }
            refreshDataFromServer();
            renderCalendarSubscriptions();
        } else {
            showToast(data.error || '同步失败', 'error');
        }
    } catch (e) {
        showToast('同步请求失败：' + e.message, 'error');
    } finally {
        if (icon) icon.classList.remove('calsync-icon-pulse');
        if (viewLabel) viewLabel.textContent = '立即同步';
        if (btn) btn.disabled = false;
        if (viewBtn) viewBtn.disabled = false;
        if (allBtn) { allBtn.disabled = false; allBtn.classList.remove('opacity-50'); }
    }
}

// 删除外部任务时写黑名单：复用 utils.js 共享版 recordExternalTaskDeletion（双入口生效）

// 零侵入钩子：包装 refreshDataFromServer，数据刷新后同步更新按钮显隐与面板内容
(function _wrapRefreshForCalSync() {
    if (typeof window.refreshDataFromServer !== 'function') return;
    if (window._calSyncRefreshWrapped) return;
    window._calSyncRefreshWrapped = true;
    const _orig = window.refreshDataFromServer;
    window.refreshDataFromServer = async function () {
        const r = _orig.apply(this, arguments);
        if (r && typeof r.then === 'function') {
            r.then(() => {
                updateCalendarSyncBtnVisibility();
                if (document.getElementById('calendarsync-list')) renderCalendarSubscriptions();
            }).catch(() => {});
        } else {
            updateCalendarSyncBtnVisibility();
        }
        return r;
    };
})();
