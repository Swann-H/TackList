// batchSelect.js — FR-03 批量管理（任务视图多选态 + 底部居中浮动操作条 + 暂存-应用模型 + 单条 batch 撤销）
// 依赖（均为运行时解析，脚本加载顺序不构成约束）：
//   utils.js        : showToast / showUndoToast / escapeHtml / isAnyOverlayOpen
//   data.js         : saveData / settings
//   views.js        : renderView / switchView / currentView
//   taskListView.js : buildTaskListGroups / taskListCompletedShowAll
//   tasks.js        : createNextRepeatTask / currentDetailTaskId / exitDetailWriteMode
//   trash.js        : pushUndoEntry / _executeUndoEntry（撤销栈）
//   sidebarViews.js : renderLists / renderTags / updateSidebarCounts
// 选中态为运行时内存 Set<taskId>，无持久化（FR-03 3.5）。
// 生命周期：clearUndoStack()（trash.js）统一收口退出——视图/筛选切换、导入、设置保存、
// 服务端刷新、跨天等撤销上下文失效场景，多选态同步失效。

// ==================== 提示口径 ====================
// 批量管理是「快进快出」的连续操作场景：状态提示只需确认动作已被接收（守卫拦截 / 暂存已放弃 /
// 无可应用项等），不必按全局默认的中档停留 5 秒，否则连点几下就堆一屏。
// 统一走 short 档（随设置「消息显示时长」缩放：快速 1.5s / 标准 2.5s / 舒缓 4s）。
// ⚠️ 只收口状态提示（showToast）。以下两类刻意不走本函数：
//   撤销条 showUndoToast —— 本身已是 short 档，且必须留出点 UNDO 的时间；
//   确认卡 showConfirmToast —— 30s 功能性时长，等用户二选一。
function _batchToast(message, type) {
    return showToast(message, type || 'info', 'short');
}

// ==================== 状态 ====================
let _batchSelectActive = false;
const _batchSelectedIds = new Set();
let _batchLastClickedId = null;   // Shift 区间选择锚点
let _batchCurrentTaskId = null;   // FR-04 E/Space 的「当前选中任务」（多选态下最近点击）
let _batchCssInjected = false;
let _batchExitArmed = false;      // 「退出管理」二次确认态（三态：默认 / 悬浮 / 确认中）
let _batchExitArmTimer = null;
let _batchConfirmKind = null;     // 即时按钮（标记完成 / 删除）的二次确认态：'complete' / 'delete' / null
let _batchConfirmTimer = null;
let _batchSavedDetailId = null;   // 进入多选前右侧详情栏展示的任务 id（退出时按需恢复）

// ==================== 暂存修改（设置类操作不再即刻生效） ====================
// 分层规则（对用户可自我表达）：**要开弹层挑的走暂存，单击即决策的走即时**。
//   暂存：标签 / 清单 / 重要 / 紧急 / 时间 —— 只改 _batchPending，不动 task，
//         由操作条中段「应用 N 项修改」按钮一次性写入（batchApplyPending）， toast 给出文字总结。
//   ⚠️ 重要 / 紧急虽是二态 toggle，但其弹层/多字段同族的口径统一性优先于即时反馈，故留在暂存组。
//   即时：标记完成 / 删除 —— 单击即执行（含重复派生等副作用），并把暂存项合并进同一次提交
//         （见 _mergePendingIntoLabel：这两个操作会退出多选，不合并且丢弃暂存等于静默丢失）。
// 退出多选时若仍有暂存：走系统确认卡二选一「应用并退出 / 直接退出」（见 onBatchExitClick）。
// time 草稿字段与详情栏 #detail-time-menu 表单一一对应（按字段独立写入，未填=不动）：
//   date/time/endDate/endTime 表单值；range 时间段开关；
//   reminders null=未动 / []=已设为空 / [..]=已选提前量（分钟）；
//   repeatValue/repeatProps/repeatMode/repeatCustom* 重复配置；repeatTouched 是否动过重复；
//   clear 暂存「清除时间」（同详情栏 clearTaskTime：清日期+提醒，不动重复）。
const _batchPending = {
    tagsAdd: new Set(),
    tagsRemove: new Set(),
    listId: null,
    important: null,
    urgent: null,
    time: null
};

function _batchResetPending() {
    _batchPending.tagsAdd.clear();
    _batchPending.tagsRemove.clear();
    _batchPending.listId = null;
    _batchPending.important = null;
    _batchPending.urgent = null;
    _batchPending.time = null;
}

// 时间草稿是否含「会写入任务」的内容（仅切换时间段开关不算）
function _batchTimeHasContent(d) {
    return !!d && (d.clear || !!d.date || d.reminders !== null || d.repeatTouched);
}

function _batchHasPending() {
    if (_batchPending.tagsAdd.size || _batchPending.tagsRemove.size) return true;
    if (_batchPending.listId) return true;
    if (_batchPending.important !== null || _batchPending.urgent !== null) return true;
    return _batchTimeHasContent(_batchPending.time);
}

// 暂存的「修改类别」计数：标签 / 清单 / 重要 / 紧急 / 时间 各记 1（与 _batchHasPending 同口径）。
// 只服务于界面表达（「应用 N 项修改」文案、退出拦截提示），不参与写入判定——
// 实际写入仍由 _collectPendingUndo 逐字段比较任务原值后决定。
function _batchPendingCount() {
    let n = 0;
    if (_batchPending.tagsAdd.size || _batchPending.tagsRemove.size) n++;
    if (_batchPending.listId) n++;
    if (_batchPending.important !== null) n++;
    if (_batchPending.urgent !== null) n++;
    if (_batchTimeHasContent(_batchPending.time)) n++;
    return n;
}

function _batchEnsureTimeDraft() {
    if (!_batchPending.time) {
        _batchPending.time = {
            date: '', time: '', endDate: '', endTime: '', range: false,
            reminders: null,
            repeatValue: '', repeatProps: null, repeatMode: 'startTime',
            repeatCustomInterval: '', repeatCustomUnit: 'days', repeatTouched: false,
            clear: false
        };
    }
    return _batchPending.time;
}

// ==================== CSS（一次性注入；动画只动 transform / opacity，遵守性能红线） ====================
function _ensureBatchCss() {
    if (_batchCssInjected) return;
    _batchCssInjected = true;
    const style = document.createElement('style');
    style.id = 'batch-select-css';
    style.textContent = `
/* 行选择指示器：圆角矩形 —— 与圆形的「完成勾选框」区分两种勾选语义 */
.batch-select-indicator {
    width: 20px; height: 20px; border-radius: 6px;
    border: 2px solid rgba(148,163,184,0.55);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; color: transparent;
    transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}
.task-list-item.batch-selected { background-color: var(--accent-bg); }
.task-list-item.batch-selected .batch-select-indicator {
    background-color: var(--accent-color); border-color: var(--accent-color); color: #fff;
}
/* 分组标题前的整组选择指示器：三态（未选 / 部分选中 / 全选） */
.batch-group-indicator {
    width: 18px; height: 18px; border-radius: 5px;
    border: 2px solid rgba(148,163,184,0.55);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; color: transparent;
    transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}
.batch-group-indicator.is-partial { border-color: var(--accent-color); color: var(--accent-color); }
.batch-group-indicator.is-on { background-color: var(--accent-color); border-color: var(--accent-color); color: #fff; }
/* 多选态：header-actions 只留编辑态工具条 */
body.batch-select-mode #header-actions > *:not(#batch-edit-toolbar) { display: none !important; }
/* 「退出多选」三态：默认描边红 / 悬浮淡底 / 二次确认态（与详情栏「紧急」的 .is-on 一致） */
#batch-exit-btn { border-color: #ef4444 !important; color: #ef4444 !important; }
#batch-exit-btn:hover { background: rgba(239,68,68,0.15) !important; border-color: #ef4444 !important; color: #ef4444 !important; }
#batch-exit-btn.is-confirm { background: #ef4444 !important; border-color: #ef4444 !important; color: #fff !important; box-shadow: 0 0 0 3px rgba(239,68,68,0.20); }
#batch-exit-btn.is-confirm:hover { background: #dc2626 !important; border-color: #dc2626 !important; color: #fff !important; }
/* 「重要 / 紧急」三态：与详情栏 #detail-task-important / #detail-task-urgent 同款口径 */
#batch-btn-important { border-color: #eab308 !important; color: #eab308 !important; }
#batch-btn-important:hover { background: rgba(234,179,8,0.15) !important; border-color: #eab308 !important; color: #eab308 !important; }
#batch-btn-important.is-on { background: #eab308 !important; border-color: #eab308 !important; color: #fff !important; box-shadow: 0 0 0 3px rgba(234,179,8,0.20); }
#batch-btn-important.is-on:hover { background: #ca9a06 !important; border-color: #ca9a06 !important; color: #fff !important; }
#batch-btn-urgent { border-color: #f97316 !important; color: #f97316 !important; }
#batch-btn-urgent:hover { background: rgba(249,115,22,0.15) !important; border-color: #f97316 !important; color: #f97316 !important; }
#batch-btn-urgent.is-on { background: #ef4444 !important; border-color: #ef4444 !important; color: #fff !important; box-shadow: 0 0 0 3px rgba(239,68,68,0.20); }
#batch-btn-urgent.is-on:hover { background: #dc2626 !important; border-color: #dc2626 !important; color: #fff !important; }
/* 其余操作条按钮三态（默认描边 / 悬浮 15% 淡底 / 选中实底+外环）：口径同「紧急 / 重要」。
   选中态（.is-on）= 该项有暂存修改，提示用户点「应用」后生效 */
#batch-btn-complete { border-color: #22c55e !important; color: #22c55e !important; }
#batch-btn-complete:hover { background: rgba(34,197,94,0.15) !important; border-color: #22c55e !important; color: #22c55e !important; }
#batch-btn-tag { border-color: #a855f7 !important; color: #a855f7 !important; }
#batch-btn-tag:hover { background: rgba(168,85,247,0.15) !important; border-color: #a855f7 !important; color: #a855f7 !important; }
#batch-btn-tag.is-on { background: #a855f7 !important; border-color: #a855f7 !important; color: #fff !important; box-shadow: 0 0 0 3px rgba(168,85,247,0.20); }
#batch-btn-tag.is-on:hover { background: #9333ea !important; border-color: #9333ea !important; color: #fff !important; }
#batch-btn-move { border-color: #6366f1 !important; color: #6366f1 !important; }
#batch-btn-move:hover { background: rgba(99,102,241,0.15) !important; border-color: #6366f1 !important; color: #6366f1 !important; }
#batch-btn-move.is-on { background: #6366f1 !important; border-color: #6366f1 !important; color: #fff !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.20); }
#batch-btn-move.is-on:hover { background: #4f46e5 !important; border-color: #4f46e5 !important; color: #fff !important; }
#batch-btn-time { border-color: #f97316 !important; color: #f97316 !important; }
#batch-btn-time:hover { background: rgba(249,115,22,0.15) !important; border-color: #f97316 !important; color: #f97316 !important; }
#batch-btn-time.is-on { background: #f97316 !important; border-color: #f97316 !important; color: #fff !important; box-shadow: 0 0 0 3px rgba(249,115,22,0.20); }
#batch-btn-time.is-on:hover { background: #ea580c !important; border-color: #ea580c !important; color: #fff !important; }
#batch-btn-delete { border-color: #ef4444 !important; color: #ef4444 !important; }
#batch-btn-delete:hover { background: rgba(239,68,68,0.15) !important; border-color: #ef4444 !important; color: #ef4444 !important; }
/* 即时按钮（标记完成 / 删除）二次确认态：实底+白图标+外环，与回收站工具栏三态、
   详情栏「紧急」激活态同口径；只换色不换图标（用户 2026-10-17 明确不要 fa-exclamation-triangle） */
#batch-btn-complete.is-confirm,
#batch-btn-complete.is-confirm:hover {
    background: #22c55e !important; border-color: #22c55e !important; color: #fff !important;
    box-shadow: 0 0 0 3px rgba(34,197,94,0.20);
}
#batch-btn-delete.is-confirm,
#batch-btn-delete.is-confirm:hover {
    background: #ef4444 !important; border-color: #ef4444 !important; color: #fff !important;
    box-shadow: 0 0 0 3px rgba(239,68,68,0.20);
}
/* 圆钮内图标跟随按钮色（同 .wm-circle i），避免激活态白底压黄图标 */
#batch-action-bar .batch-act-btn i { margin: 0 !important; color: inherit !important; }
/* 底部浮动操作条：靠右下角，为中部 toast 让位；进出只动 transform / opacity */
#batch-action-bar {
    position: fixed; left: 50%; bottom: 24px; z-index: 40;
    transform: translate(-50%, 16px); opacity: 0; pointer-events: none;
    transition: transform .2s ease, opacity .2s ease;
}
#batch-action-bar.batch-bar-in { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
@media (max-width: 768px) {
    /* 移动端：避开底部导航栏，不溢出（C3-4） */
    #batch-action-bar { left: 10px; right: 10px; bottom: calc(64px + env(safe-area-inset-bottom)); transform: translateY(16px); }
    #batch-action-bar.batch-bar-in { transform: translateY(0); }
}
/* 多选态：toast 抬到操作条上方。条高由 JS 实测写入 --batch-bar-h（按钮折行/窄屏自适应），
   toast 底边 = 操作条底边(24) + 条高 + 12px 间距，保证不遮挡操作条 */
body.batch-select-mode #toast-container { bottom: calc(24px + var(--batch-bar-h, 56px) + 12px); }
@media (max-width: 768px) {
    body.batch-select-mode #toast-container { bottom: calc(64px + env(safe-area-inset-bottom) + var(--batch-bar-h, 56px) + 12px); }
}
/* 批量选择弹层（标签 / 清单 / 时间）：锚在右下角操作条正上方。
   遮罩保持透明，且弹层打开时把操作条 z-index 抬到遮罩之上（见 _openBatchPopover），
   否则点操作条会先被遮罩吃掉、变成「关弹层」。 */
#batch-popover-overlay {
    position: fixed; inset: 0; z-index: 60;
    opacity: 0; transition: opacity .15s ease;
}
#batch-popover-overlay.batch-popover-in { opacity: 1; }
#batch-popover-card {
    position: absolute; left: 50%; bottom: 88px;
    transform: translate(-50%, 8px); transition: transform .15s ease;
}
#batch-popover-overlay.batch-popover-in #batch-popover-card { transform: translate(-50%, 0); }
@media (max-width: 768px) {
    #batch-popover-card { left: 10px; right: 10px; width: auto; bottom: calc(64px + 84px); transform: translateY(8px); }
    #batch-popover-overlay.batch-popover-in #batch-popover-card { transform: translateY(0); }
}
/* 弹层内下拉（日期/时间/提醒/重复）统一向上展开：卡片锚在操作条正上方，
   向下展开会被操作条（弹层打开时 z-index 抬到 61）盖住 */
#batch-popover-card .batch-picker-up { top: auto; bottom: 100%; margin-top: 0; margin-bottom: 4px; }
/* 弹层正文不裁剪：提醒/重复下拉（360px+）需要溢出卡片显示 */
.batch-popover-body { overflow: visible; }
/* 弹层内日期/时间输入框：与「提前提醒/重复」按钮统一为「透明底+描边+次级文字色」。
   必须显式 transparent：原生 input[type=date|time] 的 UA 默认底色是 field（本主题下解析为白色），
   背景图片模式下会透出白底，与同级 button（preflight 已重置 transparent）不一致 —— 同 #detail-time-menu 规则。
   outline:none：原生 date/time 恒匹配 :focus-visible，鼠标单击也会画 UA 焦点环，与按钮观感不一致。 */
#batch-popover-card input[type="date"],
#batch-popover-card input[type="time"] {
    background-color: transparent;
    outline: none;
}
/* 批量标签胶囊「部分选中」态：同详情栏 pill 骨架，只换底色表达部分命中 */
.detail-tag-pill.batch-pill-partial { background-color: var(--tag-color); opacity: .55; }
@supports (background-color: color-mix(in srgb, red 50%, transparent)) {
    .detail-tag-pill.batch-pill-partial {
        background-color: color-mix(in srgb, var(--tag-color) 28%, transparent);
        opacity: 1; color: var(--tag-color);
    }
}
`;
    document.head.appendChild(style);
}

// ==================== 状态查询（供 taskListView.js / commandPalette.js 调用） ====================
function isBatchSelectActive() { return _batchSelectActive; }
function getBatchCurrentTaskId() {
    if (_batchCurrentTaskId && tasks.some(function (t) { return t.id === _batchCurrentTaskId && !t.deletedAt; })) {
        return _batchCurrentTaskId;
    }
    if (typeof currentDetailTaskId !== 'undefined' && currentDetailTaskId) return currentDetailTaskId;
    return null;
}

// 当前渲染源中的可见任务 id 序列（与 renderTaskListView 的 visibleTasks 口径一致：
// 已完成分组未展开"查看更多"时仅前 5 条；Shift 区间以此为连续序）
function _getVisibleTaskIds() {
    if (typeof buildTaskListGroups !== 'function') return [];
    const groups = buildTaskListGroups();
    const ids = [];
    groups.forEach(function (g) {
        const visible = (g.isCompleted && !taskListCompletedShowAll) ? g.tasks.slice(0, 5) : g.tasks;
        visible.forEach(function (t) { ids.push(t.id); });
    });
    return ids;
}

// ==================== 进入 / 退出多选态 ====================
// initialIds：可选，进入时预选中的任务 id 列表（/select 命令面板入口）
function enterBatchSelectMode(initialIds) {
    if (_batchSelectActive) {
        if (Array.isArray(initialIds) && initialIds.length) {
            _batchSelectedIds.clear();
            initialIds.forEach(function (id) { _batchSelectedIds.add(id); });
            _refreshBatchSelectionDom();
            _renderBatchActionBar();
        }
        return;
    }
    // 仅任务视图（非归档）支持；从其他视图进入时先切换
    if (currentView !== 'task' || currentListId === '__archived__') {
        if (currentListId === '__archived__') { _batchToast('归档清单不支持多选', 'warning'); return; }
        switchView('task'); // 内部 clearUndoStack → exitBatchSelectMode(false)，此时尚未激活，无副作用
    }
    // 与沉浸式书写态互斥：共用 #main-content transform 通道（wm-morph-in），同时触发会冲突
    if (typeof isDetailWriteMode === 'function' && isDetailWriteMode()
        && typeof exitDetailWriteMode === 'function') {
        exitDetailWriteMode();
    }
    // 进入多选前收起右侧任务详情栏（含沉浸书写态下由命令面板进入多选的场景），
    // 记录任务 id 供主动退出时恢复
    _batchSavedDetailId = null;
    const detailEl = document.getElementById('task-detail-panel');
    if (detailEl && !detailEl.classList.contains('hidden')
        && typeof currentDetailTaskId !== 'undefined' && currentDetailTaskId
        && typeof closeTaskDetailPanel === 'function') {
        _batchSavedDetailId = currentDetailTaskId;
        closeTaskDetailPanel();
    }
    _batchSelectActive = true;
    _batchSelectedIds.clear();
    _batchLastClickedId = null;
    _batchResetPending(); // 每次进入多选都是全新暂存上下文
    _batchResetConfirm(); // 确认态不跨进入周期保留
    if (Array.isArray(initialIds) && initialIds.length) {
        initialIds.forEach(function (id) { _batchSelectedIds.add(id); });
    }
    _ensureBatchCss();
    document.body.classList.add('batch-select-mode');
    _injectBatchEditToolbar();
    _injectBatchActionBar();
    renderView(); // 重建任务行（onclick 切换为选中语义）
    _renderBatchActionBar();
}

// rerender=false：调用方（clearUndoStack 各失效点）保证随后全量刷新，跳过重复渲染
// restoreDetail=true：主动退出时恢复进入前右侧详情栏展示的任务（批量操作 / 上下文失效场景不恢复）
function exitBatchSelectMode(rerender, restoreDetail) {
    if (!_batchSelectActive) return;
    _batchSelectActive = false;
    _batchSelectedIds.clear();
    _batchLastClickedId = null;
    _batchResetPending(); // 暂存修改尚未写入任务，随多选态一并失效
    _batchResetConfirm(); // 即时按钮确认态随多选态失效
    const savedDetailId = _batchSavedDetailId;
    _batchSavedDetailId = null;
    _batchExitArmed = false;
    clearTimeout(_batchExitArmTimer);
    document.body.classList.remove('batch-select-mode');
    document.body.style.removeProperty('--batch-bar-h');
    _removeBatchEditToolbar();
    _removeBatchActionBar();
    _closeBatchPopover();
    if (rerender !== false && currentView === 'task') {
        renderView(); // 重建任务行（onclick 恢复详情语义）
    }
    if (restoreDetail && savedDetailId && typeof openTaskDetailPanel === 'function') {
        const still = tasks.find(function (t) { return t.id === savedDetailId && !t.deletedAt; });
        if (still) {
            // 延后一帧：先让上面的 renderView / DOM 拆除落地，再挂详情面板
            setTimeout(function () { openTaskDetailPanel(savedDetailId, false, false); }, 0);
        }
    }
}

// ==================== 编辑态工具条（注入 header-actions，双 HTML 免改） ====================
function _injectBatchEditToolbar() {
    _removeBatchEditToolbar();
    const host = document.getElementById('header-actions');
    if (!host) return;
    const bar = document.createElement('div');
    bar.id = 'batch-edit-toolbar';
    bar.className = 'flex items-center gap-2';
    // 纯文字按钮（不带前置图标）；「全选」在全选 / 取消全选两态间切换
    bar.innerHTML =
        // 「全选」与「退出管理」同为描边按钮（无实心底），仅用 accent 色区分主/次语义
        '<button type="button" id="batch-select-all-btn" onclick="toggleSelectAllBatchTasks()" title="全选当前列表可见任务" ' +
            'class="px-3 h-10 rounded-full border-2 border-accent text-accent text-sm font-medium hover:bg-accent-bg transition">全选</button>' +
        '<button type="button" id="batch-exit-btn" onclick="onBatchExitClick()" title="退出管理（Esc）" ' +
            'class="px-3 h-10 rounded-full border-2 border-red-400 text-red-400 text-sm transition">退出管理</button>';
    host.appendChild(bar);
    _bindBatchExitOutsideReset();
}

function _removeBatchEditToolbar() {
    const bar = document.getElementById('batch-edit-toolbar');
    if (bar) bar.remove();
}

// ==================== 底部浮动操作条 ====================
function _injectBatchActionBar() {
    _removeBatchActionBar();
    _ensureBatchCss();
    _bindBatchBarResize();
    const bar = document.createElement('div');
    bar.id = 'batch-action-bar';
    document.body.appendChild(bar);
    _renderBatchActionBar();
    // 双 rAF：先落地初始态（translate+opacity 0），再切换到位，保证过渡动画起播
    requestAnimationFrame(function () {
        requestAnimationFrame(function () { bar.classList.add('batch-bar-in'); });
    });
}

function _removeBatchActionBar() {
    const bar = document.getElementById('batch-action-bar');
    if (bar) bar.remove();
}

// 选中任务集合（按 tasks 数组顺序，跳过已不存在的）
function _batchTargets() {
    return tasks.filter(function (t) { return _batchSelectedIds.has(t.id) && !t.deletedAt; });
}

function _renderBatchActionBar() {
    const bar = document.getElementById('batch-action-bar');
    if (!bar) return;
    const targets = _batchTargets();
    const n = targets.length;
    const extCount = targets.filter(function (t) { return !!t.extSourceId; }).length;
    // C3-2 / V3-4：选中含外部订阅任务时写类操作禁用
    const disabled = extCount > 0;
    const disAttr = disabled ? ' disabled' : '';
    if (n === 0) _batchResetConfirm(); // 选择清空时确认态一并复位
    const confirmKind = _batchConfirmKind;
    const btn = function (id, fn, icon, label, colorCls, extraCls) {
        const title = disabled ? '选中包含外部订阅任务，不支持批量编辑' : label;
        return '<button type="button" id="' + id + '" onclick="' + fn + '()"' + disAttr + ' title="' + title + '" ' +
            'class="batch-act-btn w-9 h-9 rounded-full border-2 ' + colorCls + ' flex items-center justify-center text-sm transition ' +
            (extraCls || '') + (disabled ? ' opacity-40 cursor-not-allowed' : '') + '">' +
            '<i class="fas ' + icon + '"></i></button>';
    };
    // 暂存态（.is-on = 该项有未应用的修改，图标实心即提示，不再加文字后缀）
    const stagedTag = _batchPending.tagsAdd.size > 0 || _batchPending.tagsRemove.size > 0;
    const stagedMove = !!_batchPending.listId;
    const stagedTime = _batchTimeHasContent(_batchPending.time);
    // 重要 / 紧急：点亮（.is-on）**只反映用户是否点选过本按钮**（即有暂存），
    // 不再混入「选中项当前已全部标记」的状态——否则用户点一下星标，列表里的星不亮、
    // 按钮却因现状而亮，会被读成「点了没反应」。
    // 但「点一下会发生什么」仍须看现状（全已标记 → 点击=取消），所以拆成两个量：
    //   impStaged / urgStaged → 只驱动点亮；impAction / urgAction → 只驱动悬浮提示。
    const allImportant = n > 0 && targets.every(function (t) { return !!t.important; });
    const allUrgent = n > 0 && targets.every(function (t) { return !!t.urgent; });
    const impStaged = _batchPending.important !== null;
    const urgStaged = _batchPending.urgent !== null;
    const impAction = impStaged ? _batchPending.important : !allImportant;
    const urgAction = urgStaged ? _batchPending.urgent : !allUrgent;
    const hasPending = _batchHasPending();
    // 「应用」：圆角矩形实心底（accent）；有暂存时实心可点，无暂存时描边+禁用。
    // ⚠️ 文案恒定两字「应用」，不跟暂存数——按钮宽度必须稳定，否则每加一项暂存整条都要重排；
    //    「还有多少项没写入」改由退出确认卡（「有 N 项修改尚未应用」）承担，那里有完整句子可说清。
    const applyBtn = '<button type="button" id="batch-apply-btn" onclick="batchApplyPending()"' +
        (hasPending ? '' : ' disabled') + disAttr +
        ' class="' + (hasPending
            ? 'h-8 px-3 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover'
            : 'h-8 px-3 rounded-lg border-2 border-theme text-theme-muted text-sm font-medium cursor-not-allowed') +
        ' transition' + (disabled ? ' opacity-40 cursor-not-allowed' : '') + '">应用</button>';
    // 三段式分组：三块独立玻璃（各自带底/边/圆角/阴影），段间留 gap —— 段界由「块」承担，
    // 不再靠一条竖线暗示。三组语义：①选中计数 ②暂存类（需点「应用」才写入）③即时执行类。
    // 外层用 items-stretch：三块等高（由含 36px 圆钮的那块定高），避免计数块矮一截。
    const glass = 'bg-theme-secondary border border-theme rounded-2xl shadow-theme px-3 py-2 flex items-center gap-2';
    bar.innerHTML =
        '<div class="flex items-stretch gap-2.5 flex-wrap justify-end max-w-[92vw]">' +
            // ① 选中计数
            '<div class="' + glass + '">' +
                '<span class="text-sm font-semibold text-theme-primary whitespace-nowrap">已选 <span id="batch-count-label">' + n + '</span> 项</span>' +
                (extCount > 0 ? '<span class="text-xs text-orange-400 whitespace-nowrap"><i class="fas fa-cloud mr-1"></i>含 ' + extCount + ' 项外部任务</span>' : '') +
            '</div>' +
            // ② 暂存类：开弹层挑选的都进草稿，由「应用」一次性写入
            '<div class="' + glass + '">' +
                btn('batch-btn-tag', 'batchTagsOpenPicker', 'fa-tag', '设置标签', 'border-purple-500 text-purple-500', stagedTag ? 'is-on' : '') +
                btn('batch-btn-move', 'batchMoveOpenPicker', 'fa-inbox', '移动到清单', 'border-indigo-500 text-indigo-500', stagedMove ? 'is-on' : '') +
                btn('batch-btn-time', 'batchTimeOpenPicker', 'fa-clock', '设置任务时间', 'border-orange-500 text-orange-500', stagedTime ? 'is-on' : '') +
                btn('batch-btn-important', 'batchToggleImportant', 'fa-star', (impAction ? '标记重要' : '取消重要'), 'border-yellow-500 text-yellow-500', impStaged ? 'is-on' : '') +
                btn('batch-btn-urgent', 'batchToggleUrgent', 'fa-fire', (urgAction ? '标记紧急' : '取消紧急'), 'border-orange-500 text-orange-500', urgStaged ? 'is-on' : '') +
                applyBtn +
            '</div>' +
            // ③ 即时执行类：单击即生效（删除走二次确认三态——确认中实底+外环，只换色不换图标）
            '<div class="' + glass + '">' +
                btn('batch-btn-complete', 'batchMarkComplete', 'fa-check',
                    confirmKind === 'complete' ? '再次单击确认标记任务完成' : '标记完成',
                    'border-green-500 text-green-500', confirmKind === 'complete' ? 'is-confirm' : '') +
                btn('batch-btn-delete', 'batchDeleteSelected', 'fa-trash',
                    confirmKind === 'delete' ? '再次单击确认删除任务' : '删除任务',
                    'border-red-500 text-red-500', confirmKind === 'delete' ? 'is-confirm' : '') +
            '</div>' +
        '</div>';
    // 同步右上角「全选 / 取消全选」文案（两态共用一个按钮）
    const selAllBtn = document.getElementById('batch-select-all-btn');
    if (selAllBtn) {
        const ids = _getVisibleTaskIds();
        const allSel = ids.length > 0 && ids.every(function (id) { return _batchSelectedIds.has(id); });
        selAllBtn.textContent = allSel ? '取消全选' : '全选';
        selAllBtn.title = allSel ? '取消当前全部选中' : '全选当前列表可见任务';
    }
    _scheduleBatchBarHeight();
}

// 实测操作条高度 → 写入 --batch-bar-h，驱动 toast 底边避让（折行/窄屏/移动端自适应）。
// 注意：Tailwind Play CDN 对动态 DOM 的样式生成是异步的，注入当帧量到的是未生效布局，
// 必须延后到 rAF + 300ms 再量（入场动画 200ms 也在其中收敛）。
function _syncBatchBarHeight() {
    const bar = document.getElementById('batch-action-bar');
    if (!bar) return;
    const h = bar.offsetHeight;
    if (h > 0) document.body.style.setProperty('--batch-bar-h', h + 'px');
}

function _scheduleBatchBarHeight() {
    requestAnimationFrame(_syncBatchBarHeight);
    setTimeout(_syncBatchBarHeight, 300);
}

// 视口变化时重测条高（按钮折行会改变高度；监听只注册一次）
let _batchBarResizeBound = false;
function _bindBatchBarResize() {
    if (_batchBarResizeBound) return;
    _batchBarResizeBound = true;
    window.addEventListener('resize', function () {
        if (_batchSelectActive) _syncBatchBarHeight();
    });
}

// ==================== 行点击（普通 / Shift 区间 / Ctrl 离散） ====================
function onBatchTaskRowClick(event, taskId) {
    if (!_batchSelectActive) return;
    _batchResetConfirm(); // 选择集变化即解除即时按钮的确认态（避免「武装后改选集再点=误删新选集」）
    if (event && event.shiftKey && _batchLastClickedId && _batchLastClickedId !== taskId) {
        // V3-1：Shift 区间选择（追加不清除已有选中）
        const seq = _getVisibleTaskIds();
        const a = seq.indexOf(_batchLastClickedId);
        const b = seq.indexOf(taskId);
        if (a !== -1 && b !== -1) {
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) _batchSelectedIds.add(seq[i]);
        } else {
            _batchSelectedIds.add(taskId);
        }
    } else {
        // 普通 / Ctrl+点击均为切换（Ctrl 语义上等同于离散补选，与 V3-5 一致：点行=选中而非打开详情）
        if (_batchSelectedIds.has(taskId)) _batchSelectedIds.delete(taskId);
        else _batchSelectedIds.add(taskId);
    }
    _batchLastClickedId = taskId;
    _batchCurrentTaskId = taskId;
    _refreshBatchSelectionDom();
    _renderBatchActionBar();
}

// 指示器按钮与行点击共用（taskListView.js 行渲染引用）
function renderBatchSelectIndicator(task) {
    return '<button type="button" class="batch-select-indicator" title="选择此任务"' +
        ' onclick="event.stopPropagation(); onBatchTaskRowClick(null, \'' + task.id + '\')">' +
        '<i class="fas fa-check text-[10px]"></i></button>';
}

// 分组标题前的整组选择指示器（taskListView.js 分组渲染引用）
function renderBatchGroupIndicator(groupKey) {
    return '<button type="button" class="batch-group-indicator" data-batch-group="' + escapeHtml(groupKey) + '" title="选择整组"' +
        ' onclick="event.stopPropagation(); onBatchGroupToggle(\'' + _batchJsQuote(groupKey) + '\')">' +
        '<i class="fas fa-check text-[9px]"></i></button>';
}

// 分组 key 进入 onclick 内联串前做最小转义（key 可能含清单 / 标签 id）
function _batchJsQuote(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// 各分组「可见任务 id」映射（与 _getVisibleTaskIds 同口径：已完成分组未展开时仅前 5 条）
function _getGroupVisibleIdsMap() {
    const map = {};
    if (typeof buildTaskListGroups !== 'function') return map;
    buildTaskListGroups().forEach(function (g) {
        const visible = (g.isCompleted && !taskListCompletedShowAll) ? g.tasks.slice(0, 5) : g.tasks;
        map[g.key] = visible.map(function (t) { return t.id; });
    });
    return map;
}

// 整组勾选 / 取消（三态指示器：全选=实心对勾，部分=减号描边）
function onBatchGroupToggle(groupKey) {
    if (!_batchSelectActive) return;
    _batchResetConfirm(); // 同上：整组选择变化也解除确认态
    const ids = _getGroupVisibleIdsMap()[groupKey] || [];
    if (ids.length === 0) return;
    const allSel = ids.every(function (id) { return _batchSelectedIds.has(id); });
    ids.forEach(function (id) {
        if (allSel) _batchSelectedIds.delete(id);
        else _batchSelectedIds.add(id);
    });
    _refreshBatchSelectionDom();
    _renderBatchActionBar();
}

// 选择变化：只切 DOM 类，不整块重渲（虚拟滚动 / 滚动位置不受影响）
function _refreshBatchSelectionDom() {
    document.querySelectorAll('.task-list-item[data-task-id]').forEach(function (el) {
        el.classList.toggle('batch-selected', _batchSelectedIds.has(el.dataset.taskId));
    });
    // 分组指示器三态同步（一次性取分组 id 映射，避免逐组重复构建）
    const groupMap = _getGroupVisibleIdsMap();
    document.querySelectorAll('.batch-group-indicator[data-batch-group]').forEach(function (el) {
        const ids = groupMap[el.dataset.batchGroup] || [];
        const hit = ids.filter(function (id) { return _batchSelectedIds.has(id); }).length;
        const on = ids.length > 0 && hit === ids.length;
        const partial = !on && hit > 0;
        el.classList.toggle('is-on', on);
        el.classList.toggle('is-partial', partial);
        const icon = el.querySelector('i');
        if (icon) icon.className = partial ? 'fas fa-minus text-[9px]' : 'fas fa-check text-[9px]';
    });
}

// 全选 / 取消全选（编辑工具条 + Ctrl+A）：已全选时再点=清空
function toggleSelectAllBatchTasks() {
    if (!_batchSelectActive) return;
    _batchResetConfirm(); // 同上：全选/取消全选也解除确认态
    const ids = _getVisibleTaskIds();
    const allSel = ids.length > 0 && ids.every(function (id) { return _batchSelectedIds.has(id); });
    if (allSel) {
        _batchSelectedIds.clear();
        _batchLastClickedId = null;
    } else {
        ids.forEach(function (id) { _batchSelectedIds.add(id); });
    }
    _refreshBatchSelectionDom();
    _renderBatchActionBar();
}

// 兼容旧入口（命令面板 Ctrl+A 等）：统一走 toggle 语义
function selectAllBatchTasks() { toggleSelectAllBatchTasks(); }

function clearBatchSelection() {
    if (!_batchSelectActive) return;
    _batchSelectedIds.clear();
    _batchLastClickedId = null;
    _refreshBatchSelectionDom();
    _renderBatchActionBar();
}

// ==================== 退出管理：二次确认（三态按钮） ====================
// 第一次点击进入「确认中」（实心红，同详情栏「紧急」激活态），再点一次才真正退出；
// 3 秒无操作或点击按钮外任意处自动回到默认态。
function onBatchExitClick() {
    if (!_batchSelectActive) return;
    // 有暂存修改：走系统确认卡二选一（复用 showConfirmToast，不新造弹层样式）。
    // 退出会清空 _batchPending，所以必须先问，否则就是「丢完之后才告知」。
    if (_batchHasPending() && typeof showConfirmToast === 'function') {
        _closeBatchPopover(); // 弹层与确认卡同屏会互相遮挡
        // onExpire: null —— 超时只收起卡片，**不退出**（与 Esc 关闭同口径）。
        // 「没响应」不等于「选择直接退出」，否则用户走神 30 秒就白丢一批暂存修改。
        showConfirmToast(
            '有 ' + _batchPendingCount() + ' 项修改尚未应用，退出后将丢失。',
            _batchExitApplyPending,
            _batchExitDiscardPending,
            { confirmLabel: '应用并退出', cancelLabel: '直接退出', onExpire: null }
        );
        return;
    }
    if (!_batchExitArmed) {
        _batchExitArmed = true;
        _renderBatchExitBtn();
        clearTimeout(_batchExitArmTimer);
        _batchExitArmTimer = setTimeout(function () {
            _batchExitArmed = false;
            _renderBatchExitBtn();
        }, 3000);
        return;
    }
    clearTimeout(_batchExitArmTimer);
    _batchExitArmed = false;
    const hadPending = _batchHasPending();
    exitBatchSelectMode(true, true); // 主动退出：恢复进入前的详情栏
    if (hadPending) _batchToast('已放弃未应用的修改', 'info');
}

// 确认卡「应用并退出」：先写入全部暂存，随即退出（_commitBatchOperation 内部已退出多选）。
// 与 batchApplyPending 的唯一差别是「无可写入内容」时：这里静默退出而不是弹「没有需要应用的修改」——
// 用户此刻的意图是退出，卡住不退就变成「点了没反应」。
function _batchExitApplyPending() {
    const targets = _guardWritable('应用');
    if (!targets) return;
    const collected = _collectPendingUndo(targets);
    if (collected.undoFns.length === 0) { exitBatchSelectMode(true, true); return; }
    _commitBatchOperation('批量应用 ' + collected.affected.size + ' 项：' + collected.parts.join('、'), collected.undoFns);
}

// 确认卡「直接退出」：丢弃暂存（exitBatchSelectMode 内部 _batchResetPending），事后给一条确认
function _batchExitDiscardPending() {
    exitBatchSelectMode(true, true);
    _batchToast('已放弃未应用的修改', 'info');
}

function _renderBatchExitBtn() {
    const btn = document.getElementById('batch-exit-btn');
    if (!btn) return;
    btn.textContent = _batchExitArmed ? '确认退出' : '退出管理';
    btn.classList.toggle('is-confirm', _batchExitArmed);
    btn.title = _batchExitArmed ? '再次点击确认退出（3 秒后自动取消）' : '退出管理（Esc）';
}

// 点击「退出管理」按钮之外的地方 → 取消确认态；即时按钮（标记完成/删除）的确认态同样复位
// （document 级监听只注册一次）
let _batchExitOutsideBound = false;
function _bindBatchExitOutsideReset() {
    if (_batchExitOutsideBound) return;
    _batchExitOutsideBound = true;
    document.addEventListener('click', function (e) {
        if (!_batchExitArmed && !_batchConfirmKind) return;
        if (e.target && e.target.closest) {
            if (e.target.closest('#batch-exit-btn')) return;
            // 点在当前武装的即时按钮上：由其自身 onclick 处理（执行或改武装别的），不在此处复位
            if (_batchConfirmKind && e.target.closest('#batch-btn-complete, #batch-btn-delete')) return;
        }
        _batchExitArmed = false;
        clearTimeout(_batchExitArmTimer);
        _renderBatchExitBtn();
        _batchClearConfirm();
    });
}

// ==================== 批量选择弹层（标签 / 清单 / 时间） ====================
let _batchPopoverKind = null;   // 当前展开的面板类型（tags/move/time）：同钮再点=收起
function _openBatchPopover(title, bodyHtml, kind) {
    // 同一按钮再次点击 = 收起（展开/收起切换）；点其他按钮 = 切换面板
    if (kind && _batchPopoverKind === kind) { _closeBatchPopover(); return; }
    _closeBatchPopover();
    _batchPopoverKind = kind || null;
    const ov = document.createElement('div');
    ov.id = 'batch-popover-overlay';
    ov.innerHTML =
        '<div id="batch-popover-card" class="bg-theme-secondary border border-theme rounded-xl shadow-theme w-[min(92vw,380px)] flex flex-col" onclick="event.stopPropagation(); _batchPopoverInsideClick(event)">' +
            '<div class="flex items-center justify-between px-4 py-3 border-b border-theme">' +
                '<h3 class="text-sm font-semibold text-theme-primary">' + escapeHtml(title) + '</h3>' +
                '<button type="button" onclick="_closeBatchPopover()" class="w-7 h-7 rounded-lg text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary transition"><i class="fas fa-xmark"></i></button>' +
            '</div>' +
            '<div class="p-4 batch-popover-body">' + bodyHtml + '</div>' +
        '</div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) _closeBatchPopover(); });
    document.body.appendChild(ov);
    // 浮层打开时把操作条抬到遮罩之上，点操作条按钮不会被遮罩吞掉
    const bar = document.getElementById('batch-action-bar');
    if (bar) bar.style.zIndex = '61';
    requestAnimationFrame(function () { ov.classList.add('batch-popover-in'); });
}

// 点击弹层内非下拉区域 → 收起全部下拉（日期/时间/提醒/重复互斥展开）
function _batchPopoverInsideClick(e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('#batch-reminder-picker, #batch-repeat-picker, [data-batch-pptoggle]')) return;
    if (e.target.closest('#batch-task-date, #batch-task-time, #batch-task-end-date, #batch-task-end-time, ' +
        '#batch-task-date-picker, #batch-task-time-picker, #batch-task-end-date-picker, #batch-task-end-time-picker')) return;
    _batchCloseAllPickers();
}

// 收起弹层内全部下拉（日期/时间选择器由 openDatePicker/openTimePicker 管理类名，此处只补 hidden）
function _batchCloseAllPickers() {
    ['batch-reminder-picker', 'batch-repeat-picker',
        'batch-task-date-picker', 'batch-task-time-picker',
        'batch-task-end-date-picker', 'batch-task-end-time-picker'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}

function _closeBatchPopover() {
    _batchPopoverKind = null;
    const ov = document.getElementById('batch-popover-overlay');
    if (ov) ov.remove();
    const bar = document.getElementById('batch-action-bar');
    if (bar) bar.style.zIndex = '';
}

// Esc：浮层打开时先关浮层；无浮层时退出多选态（收口在 batchSelect.js，对齐 trash.js 范式）
let _batchEscBound = false;
function initBatchSelectEsc() {
    if (_batchEscBound) return;
    _batchEscBound = true;
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (!_batchSelectActive) return;
        const pop = document.getElementById('batch-popover-overlay');
        if (pop) { _closeBatchPopover(); return; } // 弹层优先关闭，多选态保留
        if (typeof isAnyOverlayOpen === 'function' && isAnyOverlayOpen()) return; // 其他浮层的 Esc 由各自处理
        onBatchExitClick(); // 与按钮同一入口：首次 Esc 进入确认态，再按一次才退出
    });
}

// ==================== 批量操作核心 ====================
// 统一收口：单条 batch 撤销记录（FR-03-3）+ 一次 saveData（C3-3）+ 退出多选 + 全量刷新
function _commitBatchOperation(label, undoFns) {
    if (typeof pushUndoEntry === 'function') {
        const entry = pushUndoEntry({
            kind: 'batch',
            label: label,
            undo: function () {
                // 逆序回滚各子命令；批量删除为软删除标记，任务原下标不变（V3-3）
                for (let i = undoFns.length - 1; i >= 0; i--) undoFns[i]();
            }
        });
        if (typeof showUndoToast === 'function') {
            showUndoToast(label, function () {
                if (typeof _executeUndoEntry === 'function') return _executeUndoEntry(entry);
                return { ok: false, reason: 'invalid' };
            });
        }
    }
    if (typeof invalidateTaskListGroupsCache === 'function') invalidateTaskListGroupsCache();
    saveData(); // C3-3：先改完 tasks 再调用一次 saveData
    exitBatchSelectMode(); // 操作后选中集合失效，统一退出（内部 renderView）
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    if (typeof updateSidebarCounts === 'function') updateSidebarCounts();
    if (typeof updatePostponeButton === 'function') updatePostponeButton();
}

// 外部任务守卫（双保险：按钮已禁用，此处再拦截）
function _guardWritable(label) {
    const targets = _batchTargets();
    if (targets.length === 0) { _batchToast('没有选中的任务', 'info'); return null; }
    if (targets.some(function (t) { return !!t.extSourceId; })) {
        _batchToast('选中包含外部订阅任务，' + (label || '该操作') + '不可用', 'warning');
        return null;
    }
    return targets;
}

// ---------- 即时操作：二次确认（三态：默认描边 / 悬浮淡底 / 确认实底+外环） ----------
// 与回收站工具栏「还原全部 / 清空回收站」同口径（只换色不换图标）：首点进入确认态
// （3 秒无操作或点按钮外自动复位），再点一次才真正执行。
// skipConfirm=true 供命令面板 Ctrl+Backspace 等入口直接执行
// （组合键本身已是 deliberate 门槛，无需二次确认）。
function _batchConfirmArm(kind) {
    if (_batchConfirmKind === kind) return true;   // 已武装 → 放行执行
    _batchConfirmKind = kind;
    _renderBatchActionBar();                        // 切到确认态（实底 + 警示图标）
    clearTimeout(_batchConfirmTimer);
    _batchConfirmTimer = setTimeout(_batchClearConfirm, 3000);
    return false;
}

// 只清状态+定时器，不触发重渲（供 render / exit 等内部路径调用，避免递归）
function _batchResetConfirm() {
    if (_batchConfirmKind === null) return;
    _batchConfirmKind = null;
    clearTimeout(_batchConfirmTimer);
}

function _batchClearConfirm() {
    if (_batchConfirmKind === null) return;
    _batchResetConfirm();
    _renderBatchActionBar();
}

// ---------- 标记完成（复用单条完成的副作用口径，含重复任务派生，V1-2 撤销联动） ----------
// 「标记未完成」按钮已移除（多选态只保留单向完成，反向操作走单条任务或撤销）
function batchMarkComplete() {
    if (!_batchConfirmArm('complete')) return;
    _batchSetCompleted(true);
}

function _batchSetCompleted(state) {
    const targets = _guardWritable('批量标记');
    if (!targets) return;
    const affected = targets.filter(function (t) { return t.completed !== state; });
    if (affected.length === 0) { _batchToast('选中的任务已是该状态', 'info'); return; }
    const undoFns = [];
    affected.forEach(function (task) {
        const pre = { completed: task.completed, completedAt: task.completedAt };
        task.completed = state;
        task.completedAt = state ? new Date().toISOString() : null;
        let derivedId = null;
        if (state && task.repeat && task.repeat.type && typeof createNextRepeatTask === 'function') {
            const next = createNextRepeatTask(task);
            if (next) { tasks.push(next); derivedId = next.id; }
        }
        undoFns.push(function () {
            task.completed = pre.completed;
            task.completedAt = pre.completedAt;
            if (derivedId) {
                const di = tasks.findIndex(function (t) { return t.id === derivedId; });
                if (di !== -1) tasks.splice(di, 1);
            }
        });
    });
    // 即时操作执行时若还有暂存修改，合并进同一次提交（一个撤销条目、一条 toast），避免静默丢失
    const merged = _mergePendingIntoLabel('批量' + (state ? '完成 ' : '取消完成 ') + affected.length + ' 项', undoFns);
    _commitBatchOperation(merged.label, merged.undoFns);
}

// ---------- 删除（软删除进回收站，原下标不变；外部任务禁用） ----------
function batchDeleteSelected(skipConfirm) {
    if (!skipConfirm && !_batchConfirmArm('delete')) return;
    _batchResetConfirm();
    const targets = _guardWritable('批量删除');
    if (!targets) return;
    const undoFns = targets.map(function (task) {
        const pre = { deletedAt: task.deletedAt || null, deletedFrom: task.deletedFrom || null };
        task.deletedAt = new Date().toISOString();
        task.deletedFrom = task.listId || 'default';
        return function () {
            task.deletedAt = pre.deletedAt;
            task.deletedFrom = pre.deletedFrom;
        };
    });
    const merged = _mergePendingIntoLabel('批量删除 ' + targets.length + ' 项', undoFns);
    _commitBatchOperation(merged.label, merged.undoFns);
}

// ---------- 移动到清单（目标选择器排除 isFolder 容器 / 归档 / 外部清单） ----------
// 暂存模式：点胶囊只记目标清单（按钮亮选中态），由「应用」统一写入
function batchMoveOpenPicker() {
    const targets = _guardWritable('移动到清单');
    if (!targets) return;
    const available = lists.filter(function (l) {
        return !l.archived && !l.isFolder && !(typeof shouldHideExternalList === 'function' && shouldHideExternalList(l));
    });
    if (available.length === 0) { _batchToast('没有可用的目标清单', 'info'); return; }
    _openBatchPopover('移动 ' + targets.length + ' 项到清单', _batchListPillsHtml(available), 'move');
}

// 与右侧详情栏「所属清单」面板同款胶囊（detail-tag-pill）；已暂存的目标呈实心选中态
function _batchListPillsHtml(available) {
    let body = '<div class="flex flex-wrap gap-1.5">';
    available.forEach(function (l) {
        const color = l.color || '#6b7280';
        const on = _batchPending.listId === l.id;
        body += '<button type="button" onclick="batchStageList(\'' + l.id + '\')" ' +
            'class="detail-tag-pill' + (on ? ' detail-tag-pill-selected' : '') + '" style="--tag-color:' + color + '" ' +
            'title="' + (on ? '已暂存，点击取消' : '移动到「' + escapeHtml(l.name) + '」') + '">' + escapeHtml(l.name) + '</button>';
    });
    return body + '</div>';
}

function batchStageList(listId) {
    const targets = _guardWritable('移动到清单');
    if (!targets) return;
    _batchPending.listId = (_batchPending.listId === listId) ? null : listId;
    _batchRefreshListPills();
    _renderBatchActionBar();
}

// 只重渲染弹层内的清单胶囊（不重开弹层，避免淡入动画重放）
function _batchRefreshListPills() {
    const bodyEl = document.querySelector('#batch-popover-overlay .batch-popover-body');
    if (!bodyEl) return;
    const available = lists.filter(function (l) {
        return !l.archived && !l.isFolder && !(typeof shouldHideExternalList === 'function' && shouldHideExternalList(l));
    });
    bodyEl.innerHTML = _batchListPillsHtml(available);
}

// ---------- 设置任务时间（面板与详情栏 #detail-time-menu 完全一致） ----------
// 日期/时间/时间段/提前提醒/重复全部镜像详情栏；暂存模式：表单即草稿，任何改动写
// _batchPending.time（按字段独立写入，未填=不动），由「应用」统一提交。
// 面板内不再有单项「应用到 N 项」按钮；「清除时间」同样只是暂存。
// 详情栏顶部行的「跳过此周期 / 撤销」是单任务重复周期操作，批量场景无意义，不镜像。
function batchTimeOpenPicker() {
    const targets = _guardWritable('设置任务时间');
    if (!targets) return;
    const d = _batchPending.time;
    const dateVal = d ? d.date : '';
    const timeVal = d ? d.time : '';
    const endDateVal = d ? d.endDate : '';
    const endTimeVal = d ? d.endTime : '';
    const rangeOn = !!(d && d.range);
    // input 样式与详情栏 #detail-task-date / #detail-task-time 完全一致（无底色，透出面板底）
    const inputCls = 'w-full px-2 py-1.5 text-sm border border-theme rounded-lg text-theme-secondary cursor-pointer';
    // 下拉统一向上展开（batch-picker-up）：卡片锚在操作条正上方，向下会被操作条盖住
    const pickerCls = 'batch-picker-up hidden absolute left-0 right-0 mt-1 bg-theme-tertiary rounded-lg border border-theme z-20 shadow-lg max-h-48 overflow-y-auto';
    const smallBtn = 'text-xs px-2 py-1 rounded border border-theme text-theme-secondary hover:bg-theme-tertiary transition';
    const body =
        '<div class="space-y-3">' +
            '<div class="flex items-center justify-between">' +
                '<span class="text-xs font-medium text-theme-secondary">时间</span>' +
                '<div class="flex items-center gap-3">' +
                    '<button type="button" id="batch-time-range-btn" onclick="batchToggleTimeRange()" class="' + smallBtn + '">' + (rangeOn ? '时间' : '时间段') + '</button>' +
                    '<button type="button" onclick="batchStageClearTime()" class="' + smallBtn + '">清除时间</button>' +
                '</div>' +
            '</div>' +
            '<div class="grid grid-cols-2 gap-2">' +
                '<div class="relative">' +
                    '<input type="date" id="batch-task-date" value="' + dateVal + '" class="' + inputCls + '" ' +
                        'onclick="openDatePicker(this, \'batch-task-date-picker\', batchTimeInputPicked)" onchange="_batchStageTimeInputs()">' +
                    '<div id="batch-task-date-picker" class="' + pickerCls + '"></div>' +
                '</div>' +
                '<div class="relative">' +
                    '<input type="time" id="batch-task-time" value="' + timeVal + '" class="' + inputCls + '" ' +
                        'onclick="openTimePicker(this, \'batch-task-time-picker\', batchTimeInputPicked)" onchange="_batchStageTimeInputs()">' +
                    '<div id="batch-task-time-picker" class="' + pickerCls + '"></div>' +
                '</div>' +
            '</div>' +
            '<div id="batch-end-time-container" class="' + (rangeOn ? '' : 'hidden') + ' grid grid-cols-2 gap-2">' +
                '<div class="relative">' +
                    '<input type="date" id="batch-task-end-date" value="' + endDateVal + '" class="' + inputCls + '" ' +
                        'onclick="openDatePicker(this, \'batch-task-end-date-picker\', batchTimeInputPicked)" onchange="_batchStageTimeInputs()">' +
                    '<div id="batch-task-end-date-picker" class="' + pickerCls + '"></div>' +
                '</div>' +
                '<div class="relative">' +
                    '<input type="time" id="batch-task-end-time" value="' + endTimeVal + '" class="' + inputCls + '" ' +
                        'onclick="openTimePicker(this, \'batch-task-end-time-picker\', batchTimeInputPicked)" onchange="_batchStageTimeInputs()">' +
                    '<div id="batch-task-end-time-picker" class="' + pickerCls + '"></div>' +
                '</div>' +
            '</div>' +
            '<div class="grid grid-cols-2 gap-2">' +
                // 提前提醒：复选列表 + 自定义提前量（渲染复用详情栏 renderAdvanceReminderOptions）
                '<div class="relative">' +
                    '<button type="button" data-batch-pptoggle onclick="batchToggleReminderPicker()" ' +
                        'class="w-full px-3 py-1.5 text-sm text-theme-secondary border border-theme rounded-lg hover:bg-theme-tertiary flex items-center justify-between gap-1">' +
                        '<span class="flex items-center min-w-0"><i class="fas fa-bell mr-2 flex-shrink-0"></i><span id="batch-reminder-text" class="truncate">不提前提醒</span></span>' +
                        '<span class="flex items-center gap-1 flex-shrink-0">' +
                            '<span id="batch-reminder-badge" class="hidden text-[10px] leading-4 px-1 rounded bg-theme-secondary text-theme-muted">0</span>' +
                            '<i class="fas fa-chevron-down text-xs"></i>' +
                        '</span>' +
                    '</button>' +
                    '<div id="batch-reminder-picker" class="batch-picker-up hidden absolute left-0 right-0 mb-1 p-2 bg-theme-tertiary rounded-lg border border-theme z-20 shadow-lg" style="max-height: 380px; overflow-y: auto;">' +
                        '<div id="batch-reminder-options" class="space-y-0.5"></div>' +
                        '<div class="flex items-center gap-1 border-t border-theme mt-1 pt-1">' +
                            '<input type="number" id="batch-custom-reminder" min="1" max="10080" placeholder="提前分钟数" class="flex-1 min-w-0 px-2 py-1 text-sm border border-theme rounded bg-theme-secondary text-theme-primary">' +
                            '<button type="button" onclick="batchAddCustomReminder()" class="px-2 py-1 text-xs rounded border border-theme text-theme-secondary hover:bg-theme-secondary transition whitespace-nowrap">+ 添加</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // 重复：radio + 子菜单 + 自定义间隔 + 重复方式（结构与取值同详情栏）
                '<div class="relative">' +
                    '<button type="button" data-batch-pptoggle onclick="batchToggleRepeatPicker()" ' +
                        'class="w-full px-3 py-1.5 text-sm text-theme-secondary border border-theme rounded-lg hover:bg-theme-tertiary flex items-center justify-between">' +
                        '<span><i class="fas fa-redo mr-2"></i><span id="batch-repeat-text">不重复</span></span>' +
                        '<i class="fas fa-chevron-down text-xs"></i>' +
                    '</button>' +
                    '<div id="batch-repeat-picker" class="batch-picker-up hidden absolute left-0 right-0 mb-1 p-2 bg-theme-tertiary rounded-lg border border-theme z-10 shadow-lg" style="max-height: 360px; overflow-y: auto;">' +
                        _batchRepeatOptionsHtml(d) +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    _openBatchPopover('为 ' + targets.length + ' 项设置任务时间', body, 'time');
    // 弹层入 DOM 后再渲染提醒列表与两处摘要文案
    batchRenderReminderOptions();
    batchUpdateReminderText();
    batchUpdateRepeatText();
}

// ---------- 时间段开关（口径同详情栏 toggleTimeRange：按开始时间 + 任务块默认时长预填结束） ----------
function batchToggleTimeRange() {
    const d = _batchEnsureTimeDraft();
    d.range = !d.range;
    const btn = document.getElementById('batch-time-range-btn');
    const container = document.getElementById('batch-end-time-container');
    if (btn) btn.textContent = d.range ? '时间' : '时间段';
    if (container) container.classList.toggle('hidden', !d.range);
    if (d.range) {
        const duration = (typeof getWeekTaskBlockMinutes === 'function') ? getWeekTaskBlockMinutes() : 30;
        const startDate = document.getElementById('batch-task-date').value;
        const startTime = document.getElementById('batch-task-time').value;
        if (startDate && startTime) {
            const s = new Date(startDate + 'T' + startTime);
            s.setMinutes(s.getMinutes() + duration);
            document.getElementById('batch-task-end-date').value = _batchDateKey(s);
            document.getElementById('batch-task-end-time').value =
                String(s.getHours()).padStart(2, '0') + ':' + String(s.getMinutes()).padStart(2, '0');
        } else if (startDate) {
            document.getElementById('batch-task-end-date').value = startDate;
            document.getElementById('batch-task-end-time').value = '';
        }
    }
    _batchStageTimeInputs();
    _renderBatchActionBar();
}

// 表单日期/时间 → 草稿（date/time picker 选中与手动输入都走这里）
function _batchStageTimeInputs() {
    const dateEl = document.getElementById('batch-task-date');
    const timeEl = document.getElementById('batch-task-time');
    if (!dateEl && !timeEl) return;
    const endDateEl = document.getElementById('batch-task-end-date');
    const endTimeEl = document.getElementById('batch-task-end-time');
    const d = _batchEnsureTimeDraft();
    d.date = dateEl ? dateEl.value : '';
    d.time = timeEl ? timeEl.value : '';
    d.endDate = endDateEl ? endDateEl.value : '';
    d.endTime = endTimeEl ? endTimeEl.value : '';
    if (d.date) d.clear = false; // 设了日期即取消「清除时间」暂存（二者互斥）
    _renderBatchActionBar();
}

// openDatePicker / openTimePicker 的 onPicked：绕开详情栏的 onDetailAllDayChange
function batchTimeInputPicked() { _batchStageTimeInputs(); }

// 暂存「清除时间」（操作条按钮与面板内「清除时间」共用）：
// 口径同详情栏 clearTaskTime —— 清日期+时间段+提前提醒，不动重复；同步清空表单可见值
function batchStageClearTime() {
    const targets = _guardWritable('清除时间');
    if (!targets) return;
    const d = _batchEnsureTimeDraft();
    d.clear = true;
    d.date = ''; d.time = ''; d.endDate = ''; d.endTime = ''; d.range = false;
    d.reminders = [];
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.value = v; };
    set('batch-task-date', ''); set('batch-task-time', '');
    set('batch-task-end-date', ''); set('batch-task-end-time', '');
    const container = document.getElementById('batch-end-time-container');
    if (container) container.classList.add('hidden');
    const rangeBtn = document.getElementById('batch-time-range-btn');
    if (rangeBtn) rangeBtn.textContent = '时间段';
    batchRenderReminderOptions();
    batchUpdateReminderText();
    _renderBatchActionBar();
}

// ---------- 提前提醒（复选列表 + 自定义；渲染复用详情栏 renderAdvanceReminderOptions） ----------
function batchToggleReminderPicker() {
    const picker = document.getElementById('batch-reminder-picker');
    if (!picker) return;
    const willOpen = picker.classList.contains('hidden');
    _batchCloseAllPickers();
    if (willOpen) {
        picker.classList.remove('hidden');
        batchRenderReminderOptions();
    }
}

function batchRenderReminderOptions() {
    const container = document.getElementById('batch-reminder-options');
    if (!container || typeof renderAdvanceReminderOptions !== 'function') return;
    const d = _batchPending.time;
    const selected = (d && d.reminders) ? d.reminders.slice() : [];
    renderAdvanceReminderOptions(container, selected, null, function (next) {
        const dd = _batchEnsureTimeDraft();
        dd.reminders = next;
        if (next.length > 0) dd.clear = false; // 又设了提醒 → 取消清除暂存
        batchUpdateReminderText();
        batchRenderReminderOptions();
        _renderBatchActionBar();
    }, document.getElementById('batch-reminder-picker'), { showAbsolute: false });
    // 自定义输入框回车添加（只绑一次）
    const input = document.getElementById('batch-custom-reminder');
    if (input && !input.dataset.enterBound) {
        input.dataset.enterBound = '1';
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); batchAddCustomReminder(); }
        });
    }
}

// 自定义提前量：校验 + 加入草稿（口径同详情栏 addDetailCustomReminder）
function batchAddCustomReminder() {
    const input = document.getElementById('batch-custom-reminder');
    if (!input) return;
    const d = _batchEnsureTimeDraft();
    const cur = d.reminders || [];
    const val = parseInt(input.value, 10);
    const reject = function (msg) {
        input.classList.add('border-red-500');
        setTimeout(function () { input.classList.remove('border-red-500'); }, 1200);
        if (msg) _batchToast(msg, 'warning');
    };
    if (isNaN(val) || val < 1 || val > REMINDER_MAX_MINUTES) {
        reject('请输入 1 ~ ' + REMINDER_MAX_MINUTES + ' 之间的分钟数'); return;
    }
    if (cur.indexOf(val) !== -1) { reject('该提前量已存在'); return; }
    if (cur.length >= REMINDER_MAX_COUNT) {
        shakeReminderLimit(document.getElementById('batch-reminder-picker'));
        _batchToast('最多 ' + REMINDER_MAX_COUNT + ' 个提前提醒', 'warning');
        return;
    }
    d.reminders = normalizeReminderMinutes(cur.concat([val]));
    if (d.reminders.length) d.clear = false;
    input.value = '';
    batchRenderReminderOptions();
    batchUpdateReminderText();
    _renderBatchActionBar();
}

// 提醒摘要文案 + 计数徽标（口径同详情栏 updateDetailReminderText）
function batchUpdateReminderText() {
    const textEl = document.getElementById('batch-reminder-text');
    if (!textEl) return;
    const d = _batchPending.time;
    const minutes = (d && d.reminders) ? d.reminders : [];
    textEl.textContent = formatReminderSummary(minutes);
    textEl.title = minutes.length ? minutes.map(formatReminderMinute).join('、') : REMINDER_EMPTY_LABEL;
    const badge = document.getElementById('batch-reminder-badge');
    if (badge) {
        badge.textContent = String(minutes.length);
        badge.classList.toggle('hidden', minutes.length <= 1);
    }
}

// ---------- 重复（radio + 子菜单 + 自定义间隔 + 重复方式；取值同详情栏） ----------
const BATCH_REPEAT_LABELS = {
    daily: '每天', dailyWorkday: '每个工作日',
    weekly: '每周', weeklyFirstWorkday: '每周首个工作日', weeklyLastWorkday: '工作周期最后一个工作日',
    monthly: '每月', monthlyFirstWorkday: '每月首个工作日', monthlyLastWorkday: '每月最后一个工作日',
    yearly: '每年', yearlyBeforeHoliday: '每个节假日前一天',
    custom: '自定义'
};

// 重复选项 HTML（name 用 batch 前缀避免与详情栏 radio 冲突；子菜单展开复用 toggleRepeatSubmenu）
function _batchRepeatOptionsHtml(d) {
    const val = d ? d.repeatValue : '';
    const mode = (d && d.repeatMode) || 'startTime';
    const customInterval = d ? d.repeatCustomInterval : '';
    const customUnit = (d && d.repeatCustomUnit) || 'days';
    const opt = function (value, label, props, checked) {
        return '<label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">' +
            '<input type="radio" name="batch-repeat" value="' + value + '" class="batch-repeat-option"' +
            (props ? ' data-repeat-props=\'' + props + '\'' : '') +
            (checked ? ' checked' : '') + ' onchange="batchStageRepeat()"> ' + label + '</label>';
    };
    const group = function (title, values, innerHtml) {
        // values: 该组包含的 radio value；草稿命中其一则展开子菜单
        const expanded = values.indexOf(val) !== -1;
        return '<div class="repeat-group">' +
            '<div class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1" onclick="toggleRepeatSubmenu(this)">' +
                '<i class="fas fa-chevron-right text-[10px] transition-transform duration-200 repeat-submenu-arrow"' + (expanded ? ' style="transform: rotate(90deg)"' : '') + '></i>' +
                '<span>' + title + '</span>' +
            '</div>' +
            '<div class="' + (expanded ? '' : 'hidden') + ' pl-5 repeat-submenu space-y-0">' + innerHtml + '</div>' +
        '</div>';
    };
    const rowCls = 'flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1';
    const radioRow = function (name, value, label, checked) {
        return '<label class="' + rowCls + '">' +
            '<input type="radio" name="' + name + '" value="' + value + '"' + (checked ? ' checked' : '') +
            ' onchange="batchStageRepeat()"> ' + label + '</label>';
    };
    return '<label class="' + rowCls + '">' +
            '<input type="radio" name="batch-repeat" value="" class="batch-repeat-option"' + (val === '' ? ' checked' : '') + ' onchange="batchStageRepeat()"> 不重复' +
        '</label>' +
        group('每天', ['daily', 'dailyWorkday'],
            opt('daily', '每天', null, val === 'daily') +
            opt('dailyWorkday', '每个工作日', '{"type":"daily","workdayOnly":true}', val === 'dailyWorkday')) +
        group('每周', ['weekly', 'weeklyFirstWorkday', 'weeklyLastWorkday'],
            opt('weekly', '每周', null, val === 'weekly') +
            '<div class="border-t border-theme my-1"></div>' +
            opt('weeklyFirstWorkday', '每周首个工作日', null, val === 'weeklyFirstWorkday') +
            opt('weeklyLastWorkday', '工作周期最后一个工作日', null, val === 'weeklyLastWorkday')) +
        group('每月', ['monthly', 'monthlyFirstWorkday', 'monthlyLastWorkday'],
            opt('monthly', '每月', null, val === 'monthly') +
            '<div class="border-t border-theme my-1"></div>' +
            opt('monthlyFirstWorkday', '每月首个工作日', null, val === 'monthlyFirstWorkday') +
            opt('monthlyLastWorkday', '每月最后一个工作日', null, val === 'monthlyLastWorkday')) +
        group('每年', ['yearly', 'yearlyBeforeHoliday'],
            opt('yearly', '每年', null, val === 'yearly') +
            '<div class="border-t border-theme my-1"></div>' +
            opt('yearlyBeforeHoliday', '每个节假日前一天', '{"type":"yearly","beforeHoliday":true}', val === 'yearlyBeforeHoliday')) +
        opt('custom', '自定义', null, val === 'custom') +
        '<div id="batch-custom-repeat-container" class="' + (val === 'custom' ? '' : 'hidden') + ' space-y-2 pl-5">' +
            '<input type="number" id="batch-custom-repeat-interval" value="' + customInterval + '" placeholder="间隔" ' +
                'class="w-full px-2 py-1 text-sm border border-theme rounded bg-theme-secondary text-theme-primary" onchange="batchStageRepeat()">' +
            '<select id="batch-custom-repeat-unit" class="w-full px-2 py-1 text-sm border border-theme rounded bg-theme-secondary text-theme-primary" onchange="batchStageRepeat()">' +
                '<option value="days"' + (customUnit === 'days' ? ' selected' : '') + '>天</option>' +
                '<option value="weeks"' + (customUnit === 'weeks' ? ' selected' : '') + '>周</option>' +
                '<option value="months"' + (customUnit === 'months' ? ' selected' : '') + '>月</option>' +
                '<option value="years"' + (customUnit === 'years' ? ' selected' : '') + '>年</option>' +
            '</select>' +
        '</div>' +
        '<div id="batch-repeat-mode-container" class="border-t border-theme pt-2 mt-2 space-y-1">' +
            '<label class="text-xs font-medium text-theme-secondary">重复方式</label>' +
            radioRow('batch-repeat-mode', 'startTime', '按设定时间', mode === 'startTime') +
            radioRow('batch-repeat-mode', 'completeTime', '按完成时间', mode === 'completeTime') +
        '</div>';
}

function batchToggleRepeatPicker() {
    const picker = document.getElementById('batch-repeat-picker');
    if (!picker) return;
    const willOpen = picker.classList.contains('hidden');
    _batchCloseAllPickers();
    if (willOpen) picker.classList.remove('hidden');
}

// 任何重复相关变更 → 写入草稿（含选「不重复」= 显式清除重复）
function batchStageRepeat() {
    const d = _batchEnsureTimeDraft();
    const sel = document.querySelector('input[name="batch-repeat"]:checked');
    d.repeatTouched = true;
    d.repeatValue = sel ? sel.value : '';
    d.repeatProps = null;
    if (sel) {
        const propsAttr = sel.getAttribute('data-repeat-props');
        if (propsAttr) {
            try { d.repeatProps = JSON.parse(propsAttr); } catch (e) { /* 非法 JSON 回落 type 值 */ }
        }
    }
    const mode = document.querySelector('input[name="batch-repeat-mode"]:checked');
    d.repeatMode = mode ? mode.value : 'startTime';
    if (d.repeatValue === 'custom') {
        const intervalEl = document.getElementById('batch-custom-repeat-interval');
        const unitEl = document.getElementById('batch-custom-repeat-unit');
        d.repeatCustomInterval = intervalEl ? intervalEl.value : '';
        d.repeatCustomUnit = unitEl ? unitEl.value : 'days';
    }
    batchUpdateRepeatText();
    _renderBatchActionBar();
}

// 重复摘要文案（口径同详情栏 updateDetailRepeatText）
function batchUpdateRepeatText() {
    const textEl = document.getElementById('batch-repeat-text');
    if (!textEl) return;
    const d = _batchPending.time;
    const customContainer = document.getElementById('batch-custom-repeat-container');
    let label = '不重复';
    if (d && d.repeatTouched && d.repeatValue) {
        if (d.repeatValue === 'custom') {
            label = '自定义';
            if (customContainer) customContainer.classList.remove('hidden');
            if (d.repeatCustomInterval) {
                const unitName = { days: '天', weeks: '周', months: '月', years: '年' };
                label = '每' + d.repeatCustomInterval + (unitName[d.repeatCustomUnit] || '天');
            }
        } else {
            label = BATCH_REPEAT_LABELS[d.repeatValue] || '不重复';
        }
    }
    if (customContainer && !(d && d.repeatTouched && d.repeatValue === 'custom')) customContainer.classList.add('hidden');
    textEl.textContent = label;
}

function _batchDateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---------- 设置标签（胶囊复用详情栏 detail-tag-pill；三态=当前+暂存的有效态） ----------
function batchTagsOpenPicker() {
    const targets = _guardWritable('标签');
    if (!targets) return;
    if ((settings.tags || []).length === 0) { _batchToast('没有标签：请先在侧边栏新建', 'info'); return; }
    _openBatchPopover('为 ' + targets.length + ' 项设置标签', _batchTagsPillsHtml(targets), 'tags');
}

// 有效态：暂存「加」优先，「减」次之，最后看任务现有标签
function _batchEffHasTag(task, tagId) {
    if (_batchPending.tagsAdd.has(tagId)) return true;
    if (_batchPending.tagsRemove.has(tagId)) return false;
    return (task.tags || []).indexOf(tagId) !== -1;
}

function _batchTagsPillsHtml(targets) {
    let body = '<div class="flex flex-wrap gap-1.5">';
    (settings.tags || []).forEach(function (tag) {
        const id = tag.id;
        const effAll = targets.every(function (t) { return _batchEffHasTag(t, id); });
        const rawCount = targets.filter(function (t) { return (t.tags || []).indexOf(id) !== -1; }).length;
        const partial = !effAll && rawCount > 0;
        const cls = effAll ? 'detail-tag-pill-selected' : (partial ? 'detail-tag-pill batch-pill-partial' : 'detail-tag-pill');
        const title = effAll ? '全部已含，点击移除' : (partial ? rawCount + ' 项已含，点击为全部添加' : '点击为全部添加');
        body += '<button type="button" class="' + cls + '" style="--tag-color:' + (tag.color || '#6b7280') + '"' +
            ' onclick="batchStageTag(\'' + id + '\')" title="' + title + '">' +
            escapeHtml(tag.name) + (rawCount > 0 ? ' · ' + rawCount : '') + '</button>';
    });
    return body + '</div>';
}

// 点胶囊 = 在「全部添加 / 全部移除」间切换暂存（不再即刻生效）
function batchStageTag(tagId) {
    const targets = _guardWritable('标签');
    if (!targets) return;
    const effAll = targets.every(function (t) { return _batchEffHasTag(t, tagId); });
    if (effAll) {
        _batchPending.tagsAdd.delete(tagId);
        _batchPending.tagsRemove.add(tagId);
    } else {
        _batchPending.tagsRemove.delete(tagId);
        _batchPending.tagsAdd.add(tagId);
    }
    _batchRefreshTagPills();
    _renderBatchActionBar();
}

// 只重渲染弹层内的标签胶囊（不重开弹层，避免淡入动画重放）
function _batchRefreshTagPills() {
    const bodyEl = document.querySelector('#batch-popover-overlay .batch-popover-body');
    if (bodyEl) bodyEl.innerHTML = _batchTagsPillsHtml(_batchTargets());
}

// ---------- 重要 / 紧急（两个图标按钮；暂存「全部标记 / 全部取消」） ----------
function batchToggleImportant() { _batchTogglePriority('important', '重要'); }
function batchToggleUrgent() { _batchTogglePriority('urgent', '紧急'); }

// 口径同详情栏：选中项已全部标记时点击=暂存「取消」；否则=暂存「标记」。
// 再次点击若候选值与现状一致 → 取消暂存（按钮回到仅反映当前态）。
function _batchTogglePriority(key, label) {
    const targets = _guardWritable(label);
    if (!targets) return;
    const allOn = targets.every(function (t) { return !!t[key]; });
    const cur = _batchPending[key];
    const candidate = !(cur !== null ? cur : allOn);
    _batchPending[key] = (candidate === allOn) ? null : candidate;
    _renderBatchActionBar();
}

// ---------- 应用：把全部暂存修改一次性写入所选任务 ----------
function batchApplyPending() {
    const targets = _guardWritable('应用');
    if (!targets) return;
    const collected = _collectPendingUndo(targets);
    if (collected.undoFns.length === 0) { _batchToast('没有需要应用的修改', 'info'); return; }
    _commitBatchOperation('批量应用 ' + collected.affected.size + ' 项：' + collected.parts.join('、'), collected.undoFns);
}

// 即时操作（标记完成 / 删除）执行时合并暂存项：同一撤销条目、一条 toast，避免静默丢失
function _mergePendingIntoLabel(label, undoFns) {
    if (!_batchHasPending()) return { label: label, undoFns: undoFns };
    const p = _collectPendingUndo(_batchTargets());
    if (p.undoFns.length === 0) return { label: label, undoFns: undoFns };
    return {
        label: label + '（含暂存修改：' + p.parts.join('、') + '）',
        undoFns: p.undoFns.concat(undoFns)
    };
}

// 收集暂存修改 → { undoFns, parts, affected }；直接改 task 对象（调用方随后 commit）
function _collectPendingUndo(targets) {
    const undoFns = [];
    const parts = [];
    const affected = new Set();
    const mark = function (task) { affected.add(task.id); };

    // 标签（单任务 5 个上限，超限跳过并在摘要中说明）
    if (_batchPending.tagsAdd.size || _batchPending.tagsRemove.size) {
        let n = 0, skipped = 0;
        targets.forEach(function (task) {
            if (!Array.isArray(task.tags)) task.tags = [];
            const pre = task.tags.slice();
            let changed = false;
            _batchPending.tagsAdd.forEach(function (id) {
                if (task.tags.indexOf(id) === -1) {
                    if (task.tags.length >= 5) { skipped++; return; } // 单任务标签上限（同详情栏）
                    task.tags.push(id); changed = true;
                }
            });
            _batchPending.tagsRemove.forEach(function (id) {
                const i = task.tags.indexOf(id);
                if (i !== -1) { task.tags.splice(i, 1); changed = true; }
            });
            if (changed) {
                n++; mark(task);
                undoFns.push(function () { task.tags = pre; });
            }
        });
        if (n > 0) parts.push('更新了任务标签' + (skipped > 0 ? '（' + skipped + ' 项超 5 个上限跳过）' : ''));
    }

    // 移动到清单
    if (_batchPending.listId) {
        const list = lists.find(function (l) { return l.id === _batchPending.listId; });
        if (list && !list.isFolder && !list.archived) {
            let n = 0;
            targets.forEach(function (task) {
                if (task.listId === list.id) return;
                const pre = { listId: task.listId, groupId: ('groupId' in task) ? task.groupId : undefined, hadGroupId: ('groupId' in task) };
                task.listId = list.id;
                if ('groupId' in task) task.groupId = ''; // 自定义分组属于原清单，跨清单移动后失效
                n++; mark(task);
                undoFns.push(function () {
                    task.listId = pre.listId;
                    if (pre.hadGroupId) task.groupId = pre.groupId;
                });
            });
            if (n > 0) parts.push('移动到「' + (list.name || '清单') + '」');
        }
    }

    // 重要 / 紧急
    [['important', '重要'], ['urgent', '紧急']].forEach(function (pair) {
        const key = pair[0], label = pair[1];
        if (_batchPending[key] === null) return;
        const next = _batchPending[key];
        let n = 0;
        targets.forEach(function (task) {
            if (!!task[key] === next) return;
            const pre = !!task[key];
            task[key] = next;
            n++; mark(task);
            undoFns.push(function () { task[key] = pre; });
        });
        if (n > 0) parts.push((next ? '标记' : '取消') + label);
    });

    // 时间（按字段独立写入）
    const timePart = _batchApplyTimePending(targets, undoFns, mark);
    if (timePart) parts.push(timePart);

    return { undoFns: undoFns, parts: parts, affected: affected };
}

// 时间字段写入（按字段独立：未填的字段不动任务原值）；返回摘要片段或 null
function _batchApplyTimePending(targets, undoFns, mark) {
    const d = _batchPending.time;
    if (!_batchTimeHasContent(d)) return null;
    // 重复配置对象（undefined=不动；null=设为不重复）
    let repeatObj;
    if (d.repeatTouched) repeatObj = _batchBuildRepeat(d);
    targets.forEach(function (task) {
        const pre = {
            startTime: task.startTime || null,
            endTime: task.endTime || null,
            isAllDay: !!task.isAllDay,
            origStart: task._originalStartTime || null,
            reminders: task.reminders || null,
            reminder: task.reminder || 0,
            repeat: task.repeat || null
        };
        let changed = false;
        if (d.clear) {
            // 同详情栏 clearTaskTime：清日期 + 提醒，不动重复
            if (task.startTime || task.endTime || task.isAllDay) changed = true;
            delete task.startTime; delete task.endTime; task.isAllDay = false;
            if (pre.reminders) { task.reminders = []; task.reminder = 0; changed = true; }
        } else {
            if (d.date) {
                const start = d.time
                    ? new Date(d.date + 'T' + d.time).toISOString()
                    : new Date(d.date + 'T00:00:00').toISOString();
                if (task.startTime !== start || task.isAllDay !== !d.time) changed = true;
                task.startTime = start;
                task.isAllDay = !d.time;
                delete task._originalStartTime; // 手动改时间后不再保留顺延基准
                if (d.range && d.endDate) {
                    const end = d.endTime
                        ? new Date(d.endDate + 'T' + d.endTime).toISOString()
                        : new Date(d.endDate + 'T00:00:00').toISOString();
                    if (task.endTime !== end) changed = true;
                    task.endTime = end;
                }
            }
            if (d.reminders !== null) {
                const nextRem = d.reminders.slice();
                const curRem = task.reminders || [];
                if (nextRem.join(',') !== curRem.join(',')) changed = true;
                task.reminders = nextRem;
                task.reminder = nextRem.length ? Math.max.apply(null, nextRem) : 0;
            }
        }
        if (repeatObj !== undefined) {
            if (JSON.stringify(task.repeat || null) !== JSON.stringify(repeatObj)) changed = true;
            task.repeat = repeatObj;
        }
        if (changed) {
            mark(task);
            undoFns.push(function () {
                if (pre.startTime) task.startTime = pre.startTime; else delete task.startTime;
                if (pre.endTime) task.endTime = pre.endTime; else delete task.endTime;
                task.isAllDay = pre.isAllDay;
                if (pre.origStart) task._originalStartTime = pre.origStart; else delete task._originalStartTime;
                if (pre.reminders) { task.reminders = pre.reminders; task.reminder = pre.reminder; }
                else { delete task.reminders; task.reminder = 0; }
                if (pre.repeat) task.repeat = pre.repeat; else delete task.repeat;
            });
        }
    });
    // 摘要片段
    const sub = [];
    if (d.clear) {
        sub.push('清除时间');
    } else if (d.date) {
        let label = fmtMD(new Date(d.date)) + (d.time ? ' ' + d.time : '（全天）');
        if (d.range && d.endDate) {
            label += ' - ' + fmtMD(new Date(d.endDate)) + (d.endTime ? ' ' + d.endTime : '（全天）');
        }
        sub.push('设置任务时间为 ' + label);
    }
    if (!d.clear && d.reminders !== null) {
        sub.push(d.reminders.length ? '提前提醒 ' + formatReminderSummary(d.reminders) : '清除提前提醒');
    }
    if (d.repeatTouched) {
        sub.push(repeatObj ? '重复 ' + _batchRepeatLabel(repeatObj) : '不重复');
    }
    return sub.length ? sub.join('、') : null;
}

// 草稿 → repeat 配置对象（undefined=不动；null=不重复；非法自定义=不重复）
function _batchBuildRepeat(d) {
    if (!d.repeatTouched) return undefined;
    if (!d.repeatValue) return null;
    if (d.repeatValue === 'custom') {
        const interval = parseInt(d.repeatCustomInterval, 10);
        if (interval && interval > 0) {
            return { type: 'custom', interval: interval, unit: d.repeatCustomUnit || 'days', repeatMode: d.repeatMode || 'startTime' };
        }
        return null;
    }
    if (d.repeatProps) return Object.assign({}, d.repeatProps, { repeatMode: d.repeatMode || 'startTime' });
    return { type: d.repeatValue, repeatMode: d.repeatMode || 'startTime' };
}

function _batchRepeatLabel(repeatObj) {
    if (!repeatObj || !repeatObj.type) return '不重复';
    if (repeatObj.type === 'custom') {
        const unitName = { days: '天', weeks: '周', months: '月', years: '年' };
        return '每' + (repeatObj.interval || '?') + (unitName[repeatObj.unit] || '天');
    }
    return BATCH_REPEAT_LABELS[repeatObj.type] || repeatObj.type;
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', function () {
    initBatchSelectEsc();
});
