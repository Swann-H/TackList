// trash.js — FR-01 撤销栈（命令式）+ FR-02 回收站（软删除视图、还原/永久删除、自动清理）
// 依赖（均为运行时解析，脚本加载顺序不构成约束）：
//   utils.js   : showToast / showUndoToast / escapeHtml / getList
//   data.js    : saveData / settings
//   views.js   : renderView / switchView / currentView
//   sidebarViews.js : renderLists / renderTags / updateSidebarCounts
// ⚠️ 与 calendar_sync.js 的 deletedAt 字段区分：那是外部订阅删除黑名单的快照对象
//    {uid, title, startTime, deletedAt}，不在 tasks 数组内；本文件的 task.deletedAt
//    是 tasks 内任务实体的软删除标记，二者结构不同、不会混淆。

// ==================== FR-01 撤销栈 ====================
// 命令式撤销（Command 模式，不做整树快照）：data.json 约 9MB 且 saveData 为全量 PUT，
// 快照式撤销的复制/序列化开销不可接受。栈为纯运行时内存对象，不写入 data.json、不参与导出。
const UNDO_STACK_MAX = 20;
let _undoStack = [];

// 入栈并返回该条目（供 Toast 按钮闭包引用）
function pushUndoEntry(entry) {
    if (!entry || typeof entry.undo !== 'function') return null;
    entry._done = false;
    _undoStack.push(entry);
    if (_undoStack.length > UNDO_STACK_MAX) _undoStack.shift(); // 超出丢弃最旧项
    return entry;
}

// 栈失效时机（FR-01-4）：视图切换、清单/标签/过滤器切换、数据导入、
// settings 变更保存后、服务端刷新覆盖本地 tasks。由各调用方触发。
// FR-03：多选态与撤销上下文同生命周期，在此统一收口退出（各失效点随后均有全量刷新）。
function clearUndoStack() {
    _undoStack = [];
    if (typeof exitBatchSelectMode === 'function') exitBatchSelectMode(false);
}

// 执行单条撤销（幂等守卫：Toast 按钮 / Ctrl+Z / 命令面板任一入口先执行即失效，
// 其余入口再触发时静默跳过，避免重复回滚）
// 返回 { ok, reason }；reason 仅失败时出现：
//   'already-done' 该条目此前已被其他入口撤销——数据确已恢复，UI 层按成功态展示；
//   'invalid'      条目无效（空 / undo 非函数）；
//   'exception'    undo() 抛错——半途状态不落盘、不重渲，交由调用方提示「撤销失败」。
function _executeUndoEntry(entry) {
    if (!entry || typeof entry.undo !== 'function') return { ok: false, reason: 'invalid' };
    if (entry._done) return { ok: false, reason: 'already-done' };
    entry._done = true;
    const i = _undoStack.indexOf(entry);
    if (i !== -1) _undoStack.splice(i, 1);
    try {
        entry.undo();
    } catch (e) {
        console.error('[undo] 回滚函数执行异常：', e);
        return { ok: false, reason: 'exception' };
    }
    saveData();
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    if (typeof updateSidebarCounts === 'function') updateSidebarCounts();
    renderView();
    if (typeof planPanelOpen !== 'undefined' && planPanelOpen && typeof renderPlanPanel === 'function') {
        renderPlanPanel();
    }
    return { ok: true };
}

// 弹栈撤销（Ctrl+Z / /undo 入口）。返回是否实际撤销；栈空时无副作用、不报错（V1-3）
function performUndo() {
    while (_undoStack.length) {
        const entry = _undoStack[_undoStack.length - 1];
        const r = _executeUndoEntry(entry);
        if (r.ok) {
            // 撤销类通知统一走简洁通知条：单行、绿边、short 档（同 UNDO 结果态视觉语言）
            showCompactToast('已撤销：' + (entry.label || '操作'), { tone: 'success' });
            return true;
        }
        _undoStack.pop(); // 防御：已被其他入口执行的残留项，跳过继续弹
    }
    return false;
}

// Ctrl+Z / Cmd+Z 全局快捷键：输入框/可编辑区域内不拦截（避免打断文本编辑自身的撤销）
let _undoHotkeyBound = false;
function initUndoHotkey() {
    if (_undoHotkeyBound) return;
    _undoHotkeyBound = true;
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'z' && e.key !== 'Z') return;
        if (!(e.ctrlKey || e.metaKey)) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        performUndo();
    });
}

// ==================== FR-02 回收站视图 ====================

let _trashReturnView = null;      // 进入回收站前的视图（返回按钮回到正确入口，参照节假日视图）
let _trashSearchQuery = '';
let _trashPermConfirmId = null;   // 单条「永久删除」两段式确认中的任务 id
let _trashPermConfirmTimer = null;
let _trashEmptyConfirming = false; // 「清空回收站」两段式确认
let _trashRestoreAllConfirming = false; // 「还原全部」两段式确认
let _trashSearchVisible = false;   // 搜索框显示开关（默认隐藏，工具栏按钮切换）
let _trashRestoreConfirmId = null; // 单条「还原」两段式确认中的任务 id
let _trashRestoreConfirmTimer = null;

// ==================== CSS：工具栏「还原全部 / 清空回收站」三态按钮 ====================
// 口径严格照搬任务详情栏「紧急」圆钮（#detail-task-urgent，见 index.html 样式表）：
//   默认态 = 2px 描边 + 同色图标；
//   悬浮态 = 15% 淡底预览（不再是原先的实心填充，实心留给确认态）；
//   二次确认态 = 实心填充 + 白图标 + 一圈同色外环 —— 与「已标记」的选定态完全一致。
// CSS 由脚本注入而非写进双 HTML（同 batchSelect.js 的做法），避免两份 HTML 再对齐一次。
let _trashCssInjected = false;
function _ensureTrashCss() {
    if (_trashCssInjected) return;
    _trashCssInjected = true;
    const style = document.createElement('style');
    style.id = 'trash-view-css';
    style.textContent = `
.trash-tool-btn {
    flex: none; width: 40px; height: 40px; padding: 0;
    border-radius: 9999px; border: 2px solid; background: transparent;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; cursor: pointer;
    transition: background-color .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease;
}
.trash-tool-btn i { margin: 0 !important; color: inherit !important; }
.trash-tool-btn.trash-tool-restore { border-color: #22c55e; color: #22c55e; }
.trash-tool-btn.trash-tool-restore:hover { background: rgba(34, 197, 94, 0.15); border-color: #22c55e; color: #22c55e; }
.trash-tool-btn.trash-tool-restore.is-confirm,
.trash-tool-btn.trash-tool-restore.is-confirm:hover {
    background: #16a34a; border-color: #16a34a; color: #fff;
    box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.20);
}
.trash-tool-btn.trash-tool-empty { border-color: #ef4444; color: #ef4444; }
.trash-tool-btn.trash-tool-empty:hover { background: rgba(239, 68, 68, 0.15); border-color: #ef4444; color: #ef4444; }
.trash-tool-btn.trash-tool-empty.is-confirm,
.trash-tool-btn.trash-tool-empty.is-confirm:hover {
    background: #ef4444; border-color: #ef4444; color: #fff;
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.20);
}
`;
    document.head.appendChild(style);
}

// 侧边栏/命令面板入口：清空筛选上下文并切换到回收站视图
function openTrashView() {
    if (currentView !== 'trash') _trashReturnView = currentView;
    _trashSearchVisible = false; // 每次进入回收站恢复默认：搜索框隐藏
    _trashSearchQuery = '';
    currentListId = null;
    currentFilter = null;
    currentTagIds = [];
    currentFilterId = null;
    if (currentView === 'trash') {
        renderView();
    } else {
        switchView('trash');
    }
}

// 返回按钮：回到进入前的视图（无记录时回默认首页）
function closeTrashView() {
    const back = (_trashReturnView && _trashReturnView !== 'trash')
        ? _trashReturnView
        : (settings.defaultHomeView || 'task');
    _trashReturnView = null;
    switchView(back);
}

// 搜索框显示开关：隐藏时清空搜索词，避免残留过滤条件
function toggleTrashSearch() {
    _trashSearchVisible = !_trashSearchVisible;
    if (!_trashSearchVisible) _trashSearchQuery = '';
    renderView();
    if (_trashSearchVisible) {
        const input = document.getElementById('trash-search-input');
        if (input) input.focus();
    }
}

// 软删除时间 → 相对时间文案
function _trashRelativeTime(iso) {
    const ts = new Date(iso).getTime();
    if (!isFinite(ts)) return '';
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
}

function _getTrashedTasks() {
    return tasks.filter(function (t) { return !!t.deletedAt; })
        .sort(function (a, b) { return new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime(); });
}

// 回收站列表主体（单独抽出：搜索输入 oninput 时只重建列表、不动输入框，保持焦点）
function _renderTrashList() {
    const container = document.getElementById('trash-list-container');
    if (!container) return;

    const all = _getTrashedTasks();
    const q = _trashSearchQuery.trim().toLowerCase();
    const visible = q
        ? all.filter(function (t) {
            return ((t.title || '') + '\n' + (t.notes || '') + '\n' + (t.description || '')).toLowerCase().indexOf(q) !== -1;
        })
        : all;

    if (visible.length === 0) {
        container.innerHTML = '<div class="px-5 py-10 text-center text-theme-muted text-sm">' +
            (q ? '没有匹配「' + escapeHtml(_trashSearchQuery.trim()) + '」的已删除任务' :
                 '<i class="fas fa-trash-restore mr-2"></i>回收站是空的') +
            '</div>';
        return;
    }

    container.innerHTML = visible.map(function (task) {
        const list = typeof getList === 'function' ? getList(task.listId) : null;
        const listColor = (list && list.color) || '#9ca3af';
        const listName = (list && list.name) || '未知清单';
        const rel = _trashRelativeTime(task.deletedAt);
        const confirming = _trashPermConfirmId === task.id;
        const restoreConfirming = _trashRestoreConfirmId === task.id;
        const quadColors = (typeof getQuadrantColorClass === 'function') ? getQuadrantColorClass(task) : { bg: '' };
        const barColor = (typeof getTaskBarColor === 'function') ? getTaskBarColor(task, listColor) : listColor;
        // ⚠️ 回收站不渲染完成勾选框：完成态在此不可修改，只看不改（还原后才回到清单继续操作）。
        const progress = task.progress || 0;
        const focusMinutes = (typeof getTaskFocusMinutes === 'function') ? getTaskFocusMinutes(task.id) : 0;
        const tagCapsules = (typeof renderTagCapsules === 'function') ? renderTagCapsules(task, 2, 'right') : '';
        const timeDisplay = (typeof formatTaskListTime === 'function') ? formatTaskListTime(task, { withAllDayTag: false }) : '';
        const timeTextClass = ((typeof isTaskOverdue === 'function') && isTaskOverdue(task)) ? 'text-red-500' : 'text-theme-primary';
        // 详情行（备注/子任务列表）与任务视图一致
        let taskDetailsLine = '';
        const subtaskHtml = (typeof renderSubtaskListDisplay === 'function') ? renderSubtaskListDisplay(task) : '';
        taskDetailsLine = subtaskHtml
            ? subtaskHtml
            : (task.notes ? '<div class="text-xs ' + (task.completed ? 'text-theme-secondary' : 'text-theme-muted') + ' mt-1">' + escapeHtml(task.notes) + '</div>' : '');

        return '<div class="task-list-item task-row relative flex items-center gap-3 py-2.5 px-3 rounded-r-lg ' + quadColors.bg + ' hover:opacity-85 transition group ' + (task.completed ? 'opacity-55' : '') + '"' +
            ' data-list-id="' + (task.listId || 'default') + '">' +
            '<div class="task-list-color-bar" style="background-color: ' + barColor + ';"></div>' +
            '<div class="flex-1 min-w-0 flex flex-col">' +
                '<span class="text-sm ' + (task.completed ? 'text-theme-secondary' : 'text-theme-primary') + ' truncate min-w-0 flex items-center">' + escapeHtml(task.title || '新任务') + '</span>' +
                (taskDetailsLine ? '<div>' + taskDetailsLine + '</div>' : '') +
            '</div>' +
            '<div class="flex items-center gap-2 flex-shrink-0 text-xs text-theme-primary whitespace-nowrap">' +
                tagCapsules +
                (progress > 0 ? '<span class="flex items-center gap-1"><i class="fas fa-flag text-accent-light"></i>' + progress + '%</span>' : '') +
                (focusMinutes > 0 ? '<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-400"></i>' + ((typeof formatFocusMinutes === 'function') ? formatFocusMinutes(focusMinutes) : focusMinutes + 'm') + '</span>' : '') +
                (listName ? '<span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background-color: ' + listColor + '"></span><span class="hidden sm:inline">' + escapeHtml(listName) + '</span></span>' : '') +
                (rel ? '<span class="flex items-center gap-1 text-theme-muted"><i class="fas fa-trash"></i>' + rel + '</span>' : '') +
            '</div>' +
            (timeDisplay ? '<span class="flex-shrink-0 text-xs ' + timeTextClass + ' whitespace-nowrap" style="min-width: 50px; text-align: right;"><i class="fas fa-clock mr-1"></i>' + timeDisplay + '</span>' : '') +
            // 右侧操作图标：还原 / 永久删除（两段式确认；悬浮仅图标变浅，确认态图标变绿/红、无闪烁动画）
            '<button onclick="event.stopPropagation(); requestRestoreTrashTask(\'' + task.id + '\')" ' +
                'class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition ' +
                (restoreConfirming
                    ? 'text-green-500'
                    : 'text-theme-muted hover:opacity-40') + '" ' +
                'title="' + (restoreConfirming ? '再次点击确认还原' : '还原') + '">' +
                '<i class="fas fa-trash-can-arrow-up text-sm"></i>' +
            '</button>' +
            '<button onclick="event.stopPropagation(); requestPermDeleteTrashTask(\'' + task.id + '\')" ' +
                'class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition ' +
                (confirming
                    ? 'text-red-500'
                    : 'text-theme-muted hover:opacity-40') + '" ' +
                'title="' + (confirming ? '再次点击确认永久删除（不可恢复）' : '永久删除') + '">' +
                '<i class="fas fa-trash text-sm"></i>' +
            '</button>' +
        '</div>';
    }).join('');
}

function renderTrashView(container) {
    const count = _getTrashedTasks().length;
    const emptyConfirming = _trashEmptyConfirming;
    const restoreConfirming = _trashRestoreAllConfirming;
    const isMobile = typeof isMobileView === 'function' && isMobileView();

    // 返回按钮（样式与「倒计时」右上角返回一致），悬浮实底填充+图标变白（与工具栏其他按钮一致）
    const backBtn = '<button onclick="closeTrashView()" class="w-10 h-10 rounded-full border-2 border-slate-400 text-slate-500 flex items-center justify-center hover:bg-slate-500 hover:text-white active:bg-slate-600 active:scale-95 transition" title="返回"><i class="fas fa-arrow-left"></i></button>';
    // 搜索开关按钮：单击显示/隐藏搜索框（悬浮沿用按下态样式：实底填充+图标变白）
    const searchBtn = '<button onclick="toggleTrashSearch()" class="w-10 h-10 rounded-full flex items-center justify-center transition ' +
        (_trashSearchVisible
            ? 'bg-cyan-500 text-white'
            : 'border-2 border-cyan-500 text-cyan-500 hover:bg-cyan-500 hover:text-white') + '" ' +
        'title="' + (_trashSearchVisible ? '隐藏搜索' : '搜索') + '">' +
        '<i class="fas fa-search"></i>' +
    '</button>';
    _ensureTrashCss();
    // 还原全部 / 清空回收站：三态（默认描边 / 悬浮淡底 / 二次确认实心+外环），
    // 与详情栏「紧急」按钮的三态同口径；上一版「悬浮即实心」会让默认态与确认态撞脸，故改掉。
    // 确认态只换色不换图标（用户 2026-10-17 明确不要 fa-exclamation-triangle），图标恒为原图标。
    const restoreAllBtn = '<button onclick="requestRestoreAllTrashTasks()" ' +
        'class="trash-tool-btn trash-tool-restore' + (restoreConfirming ? ' is-confirm' : '') +
        (count === 0 ? ' opacity-40 pointer-events-none' : '') + '" ' +
        'title="' + (restoreConfirming ? '再次点击确认还原全部（3 秒后自动取消）' : '还原全部') + '">' +
        '<i class="fas fa-trash-can-arrow-up"></i>' +
    '</button>';
    const emptyBtn = '<button onclick="requestEmptyTrash()" ' +
        'class="trash-tool-btn trash-tool-empty' + (emptyConfirming ? ' is-confirm' : '') +
        (count === 0 ? ' opacity-40 pointer-events-none' : '') + '" ' +
        'title="' + (emptyConfirming ? '再次点击确认清空（不可恢复）' : '清空回收站') + '">' +
        '<i class="fas fa-trash"></i>' +
    '</button>';
    // 标题字号/位置与「倒计时」视图统一（桌面 text-2xl / 移动端 text-lg，左上；计数随标题）
    const titleHtml = '<h1 class="' + (isMobile ? 'text-lg font-bold' : 'text-2xl font-bold') + ' text-theme-primary whitespace-nowrap">回收站</h1>' +
        (count > 0 ? '<span class="text-xs font-normal text-theme-muted whitespace-nowrap self-end mb-1 leading-none">' + count + '</span>' : '');
    const toolbarBtns = '<div class="flex items-center gap-3 flex-shrink-0">' + searchBtn + restoreAllBtn + emptyBtn + backBtn + '</div>';
    const header = isMobile
        ? '<div class="flex items-center justify-between px-4 py-3 border-b border-theme/30 flex-shrink-0 gap-3">' +
              '<div class="flex items-center gap-2 min-w-0">' + titleHtml + '</div>' + toolbarBtns + '</div>'
        : '<div class="flex items-center justify-between p-4 pb-2 flex-shrink-0 gap-3">' +
              '<div class="flex items-center gap-2 min-w-0">' + titleHtml + '</div>' + toolbarBtns + '</div>';

    container.innerHTML =
        '<div class="h-full flex flex-col">' +
            header +
            '<div class="flex-1 overflow-y-auto min-h-0 px-4 pb-6">' +
                (_trashSearchVisible
                    ? '<div class="my-3">' +
                        '<input id="trash-search-input" type="text" value="' + escapeHtml(_trashSearchQuery) + '" placeholder="搜索回收站中的任务…" oninput="_trashSearchQuery=this.value;_renderTrashList()" ' +
                            'class="w-full px-3 py-2 border-2 border-theme rounded-lg bg-theme-secondary text-theme-primary text-sm focus:outline-none focus:border-accent">' +
                      '</div>'
                    : '') +
                '<div id="trash-list-container" class="space-y-1"></div>' +
            '</div>' +
        '</div>';
    _renderTrashList();
}

// ==================== 回收站操作 ====================

// 单条还原：清空软删除标记，回到原清单（来源清单已被删则回落默认清单）
function restoreTrashTask(taskId) {
    const task = tasks.find(function (t) { return t.id === taskId; });
    if (!task || !task.deletedAt) return;
    task.deletedAt = null;
    task.deletedFrom = null;
    if (typeof getList === 'function' && !getList(task.listId)) task.listId = 'default';
    saveData();
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    if (currentView === 'trash') renderView();
    showToast('已还原「' + (task.title || '任务') + '」', 'success');
}

// 单条还原：两段式确认（与「永久删除」同款 3 秒确认模式，二者互斥）
function requestRestoreTrashTask(taskId) {
    if (_trashRestoreConfirmId !== taskId) {
        _trashRestoreConfirmId = taskId;
        _trashPermConfirmId = null;
        if (_trashPermConfirmTimer) { clearTimeout(_trashPermConfirmTimer); _trashPermConfirmTimer = null; }
        _renderTrashList();
        if (_trashRestoreConfirmTimer) clearTimeout(_trashRestoreConfirmTimer);
        _trashRestoreConfirmTimer = setTimeout(function () {
            _trashRestoreConfirmId = null;
            _renderTrashList();
        }, 3000);
        return;
    }
    if (_trashRestoreConfirmTimer) { clearTimeout(_trashRestoreConfirmTimer); _trashRestoreConfirmTimer = null; }
    _trashRestoreConfirmId = null;
    restoreTrashTask(taskId);
}

// 单条永久删除：两段式确认（复用详情面板删除的 3 秒确认模式，与「还原」确认互斥）
function requestPermDeleteTrashTask(taskId) {
    if (_trashPermConfirmId !== taskId) {
        _trashPermConfirmId = taskId;
        _trashRestoreConfirmId = null;
        if (_trashRestoreConfirmTimer) { clearTimeout(_trashRestoreConfirmTimer); _trashRestoreConfirmTimer = null; }
        _renderTrashList();
        if (_trashPermConfirmTimer) clearTimeout(_trashPermConfirmTimer);
        _trashPermConfirmTimer = setTimeout(function () {
            _trashPermConfirmId = null;
            _renderTrashList();
        }, 3000);
        return;
    }
    if (_trashPermConfirmTimer) { clearTimeout(_trashPermConfirmTimer); _trashPermConfirmTimer = null; }
    _trashPermConfirmId = null;
    permanentlyDeleteTrashTask(taskId);
}

function permanentlyDeleteTrashTask(taskId) {
    const i = tasks.findIndex(function (t) { return t.id === taskId; });
    if (i === -1 || !tasks[i].deletedAt) return;
    const title = tasks[i].title || '任务';
    tasks.splice(i, 1);
    // FR-06（C6-3）：永久删除任务时级联清理 attachments/<taskId>/，否则磁盘持续增长
    if (typeof cascadeDeleteAttachments === 'function') cascadeDeleteAttachments(taskId);
    saveData();
    if (currentView === 'trash') renderView(); else renderLists();
    showToast('已永久删除「' + title + '」', 'success');
}

function restoreAllTrashTasks() {
    const trashed = _getTrashedTasks();
    if (trashed.length === 0) {
        showToast('回收站是空的', 'info');
        return;
    }
    trashed.forEach(function (task) {
        task.deletedAt = null;
        task.deletedFrom = null;
        if (typeof getList === 'function' && !getList(task.listId)) task.listId = 'default';
    });
    saveData();
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    if (currentView === 'trash') renderView();
    showToast('已还原 ' + trashed.length + ' 个任务', 'success');
}

// 还原全部：两段式确认（工具栏按钮），3 秒未确认自动复位
function requestRestoreAllTrashTasks() {
    if (!_trashRestoreAllConfirming) {
        _trashRestoreAllConfirming = true;
        if (currentView === 'trash') renderView();
        setTimeout(function () {
            _trashRestoreAllConfirming = false;
            if (currentView === 'trash') renderView();
        }, 3000);
        return;
    }
    _trashRestoreAllConfirming = false;
    restoreAllTrashTasks();
}

// 清空回收站：两段式确认（工具栏按钮）
function requestEmptyTrash() {
    if (!_trashEmptyConfirming) {
        _trashEmptyConfirming = true;
        if (currentView === 'trash') renderView();
        setTimeout(function () {
            _trashEmptyConfirming = false;
            if (currentView === 'trash') renderView();
        }, 3000);
        return;
    }
    _trashEmptyConfirming = false;
    emptyTrash();
}

function emptyTrash() {
    const n = _getTrashedTasks().length;
    if (n === 0) {
        showToast('回收站是空的', 'info');
        return;
    }
    // FR-06（C6-3）：清空回收站同样级联清理附件目录
    if (typeof cascadeDeleteAttachments === 'function') {
        _getTrashedTasks().forEach(function (t) { cascadeDeleteAttachments(t.id); });
    }
    tasks = tasks.filter(function (t) { return !t.deletedAt; });
    saveData();
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    if (currentView === 'trash') renderView();
    showToast('已清空回收站（' + n + ' 条）', 'success');
}

// ==================== FR-02-4 自动清理 ====================
// 保留期独立于备份保留期（C2-4）：settings.trashRetentionDays，默认 30，0 = 永久保留。
// 启动时 + 跨天各执行一次（前端执行，统一走 saveData；服务端零改动）。
function cleanupTrashedTasks() {
    const days = settings.trashRetentionDays;
    if (!days || days <= 0) return 0;
    const cutoff = Date.now() - days * 86400000;
    let removed = 0;
    const kept = [];
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (t.deletedAt) {
            const ts = new Date(t.deletedAt).getTime();
            if (isFinite(ts) && ts < cutoff) { removed++; continue; }
        }
        kept.push(t);
    }
    if (removed > 0) {
        tasks = kept;
        saveData();
        renderLists();
        if (typeof renderTags === 'function') renderTags();
        renderView();
        showToast('回收站已自动清理 ' + removed + ' 条超过保留期的任务', 'success');
    }
    return removed;
}

// 跨天检查（复用 countdown.js 的 rollover 观察模式：30s 轮询 + visibilitychange 补查；
// 后台标签页 setInterval 被节流，回前台时补一次）。刻意不做顶层副作用，由 app.js:init 启动。
let _trashDayWatchBound = false;
let _trashLastCleanupDay = null;
function startTrashDayRolloverWatch() {
    if (_trashDayWatchBound) return;
    _trashDayWatchBound = true;
    _trashLastCleanupDay = new Date().toDateString(); // 启动那次的清理由 init 显式调用
    function check() {
        const today = new Date().toDateString();
        if (_trashLastCleanupDay === today) return;
        _trashLastCleanupDay = today;
        clearUndoStack(); // 跨天后撤销上下文失效
        cleanupTrashedTasks();
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    setInterval(check, 30000);
}
