// ==================== 看板视图（Kanban）+ 清单自定义分组 ====================
// 入口：views.js 的 renderView() 在 currentView==='kanban' 时调用 renderKanbanView(container)
// 数据：所有任务通过 filterTasks(tasks) 取（继承清单/标签/过滤器全局条件；显示已完成由 kanbanConfig 控制）
// 配置：settings.kanbanConfig（DEFAULT_SETTINGS 已含默认值，applySettings 自动合并）
// 自定义分组：存储在清单对象 list.groups = [{id, name}]；任务用 task.groupId 关联

let _kanbanExpanded = {};      // colKey -> true 表示已展开（查看更多）
let _draggedKanbanCol = null;  // 正在拖拽的自定义分组列 key
let _kanbanLeafMap = {};       // colKey -> 列元数据（含 type / listId / groupId / tagId / bucket / priorityLevel）
// 视图配置面板的开关状态由 utils.js _viewConfigPanels 统一管理（_registerViewConfig）
let _kanbanGroupConfigOpen = false;    // 分组配置子面板是否打开
let _kgCfgDragToken = null;    // 分组配置面板内正在拖拽的分组 token
let _kanbanNewGroupIds = new Set(); // 刚由「新增分组」创建、尚未命名（正在编辑）的分组 id 集合（失焦/关闭未命名则视为误操作删除）
let _kanbanEditingGroupId = null; // 当前正在进行行内改名（input 编辑中）的分组 id；编辑期间禁用该列拖拽并阻止看板整板重渲染销毁输入框

const KANBAN_GROUP_BY_LABEL = {
    custom: '自定义', time: '时间', createdTime: '创建时间', tag: '标签', priority: '优先级', none: '无'
};
const KANBAN_TIME_TITLE = { nodate: '无日期', overdue: '已过期', today: '今天', tomorrow: '明天', dayAfterTomorrow: '后天', recent7: '最近7天', later: '更远' };
const KANBAN_CREATED_TITLE = { today: '今天', past7: '过去7天', past30: '过去30天', earlier: '更早' };
// 自定义模式下列顺序：list.customColumnOrder（groupId 或 'ungrouped'）；缺省按 groups 顺序 + 末位未分组
function getKanbanColumnOrder(list) {
    if (list && Array.isArray(list.customColumnOrder)) return list.customColumnOrder;
    const ids = (list && list.groups || []).map(g => g.id);
    return ids.concat(['ungrouped']);
}
function setKanbanColumnOrder(list, order) {
    if (!list) return;
    list.customColumnOrder = order;
    saveData();
}
// colKey → 列顺序 token（groupId 或 'ungrouped'）
function colKeyToOrderToken(colKey, listId) {
    if (colKey === `ungrp:${listId}`) return 'ungrouped';
    if (colKey.startsWith(`grp:${listId}:`)) return colKey.slice(`grp:${listId}:`.length);
    return null;
}
const KANBAN_PRIORITY_DEFS = [
    { level: 'both', name: '重要且紧急' },
    { level: 'important', name: '重要' },
    { level: 'urgent', name: '紧急' },
    { level: 'none', name: '普通' }
];

function getKanbanConfig() {
    if (!settings.kanbanConfig || typeof settings.kanbanConfig !== 'object') {
        settings.kanbanConfig = {};
    }
    const c = settings.kanbanConfig;
    if (!c.groupBy) c.groupBy = 'custom';
    if (!c.sortBy) c.sortBy = 'time';
    if (!c.sortDir) c.sortDir = 'asc';
    if (typeof c.showDetails !== 'boolean') c.showDetails = false;
    if (!c.tagSubGroup) c.tagSubGroup = 'list';
    // 回退读取：视图配置未显式设置时，继承全局默认值（无感升级）
    if (typeof c.showCompleted !== 'boolean') c.showCompleted = settings.showCompleted !== false;
    if (typeof c.showFocusButton !== 'boolean') c.showFocusButton = settings.showFocusButton !== false;
    if (typeof c.countOnlyUncompleted !== 'boolean') c.countOnlyUncompleted = true;
    // 无日期任务位置（first=最左侧优先显示，last=最右侧最末显示）
    if (c.noDateTaskPosition !== 'first' && c.noDateTaskPosition !== 'last') c.noDateTaskPosition = 'last';
    return c;
}

// ---------- 列上下文 ----------
function kanbanDescendantListIds(folderId, acc) {
    acc = acc || new Set();
    lists.forEach(l => {
        if (!l.archived && l.parentId === folderId) {
            acc.add(l.id);
            if (l.isFolder) kanbanDescendantListIds(l.id, acc);
        }
    });
    return acc;
}

function kanbanListContext() {
    if (currentListId) {
        const list = getList(currentListId);
        if (list && list.isFolder) {
            const set = kanbanDescendantListIds(currentListId);
            return { mode: 'lists', selectedList: list, listSet: set };
        }
        if (list) {
            return { mode: 'groups', selectedList: list, listSet: new Set([list.id]) };
        }
    }
    const set = new Set();
    lists.forEach(l => { if (!l.archived && !l.isFolder) set.add(l.id); });
    return { mode: 'lists', selectedList: null, listSet: set };
}

// 取得看板的基础任务集：复用 filterTasks 的标签/过滤器/显示已完成逻辑，
// 仅用 listSet 覆盖 currentListId 的清单条件（文件夹场景下 currentListId 无法被 filterTasks 展开）。
function kanbanBaseTasks(listSet) {
    const saved = currentListId;
    currentListId = null;
    try {
        const all = filterTasks(tasks, { includeCompleted: getKanbanConfig().showCompleted !== false });
        return all.filter(t => listSet.has(t.listId));
    } finally {
        currentListId = saved;
    }
}

// ---------- 分组判定 ----------
// 时间分组桶：复用任务视图 getTaskListGroup 的日期判定，但忽略完成态
// （看板内已完成任务混入各列并置底，不应被单独归到 completed 桶）。
// 顺序：无日期 / 已过期 / 今天 / 明天 / 后天 / 最近7天 / 更远
function kanbanDateBucketOf(task) {
    if (!task.startTime) return 'nodate';
    const b = getDateBounds();
    const taskDate = new Date(task.startTime);
    if (task.endTime) {
        const taskEndDate = new Date(task.endTime);
        const taskEndDayStart = new Date(taskEndDate.getFullYear(), taskEndDate.getMonth(), taskEndDate.getDate());
        const taskEndTomorrow = new Date(taskEndDayStart);
        taskEndTomorrow.setDate(taskEndTomorrow.getDate() + 1);
        if (b.now >= taskDate && b.now < taskEndTomorrow) return 'today';
        if (taskEndTomorrow <= b.todayStart) return 'overdue';
    }
    if (taskDate < b.todayStart) return 'overdue';
    if (taskDate < b.tomorrowStart) return 'today';
    if (taskDate < b.dayAfterTomorrowStart) return 'tomorrow';
    if (taskDate < b.threeDaysLaterStart) return 'dayAfterTomorrow';
    if (taskDate <= b.sevenDaysLaterEnd) return 'recent7';
    return 'later';
}

// 创建时间分组桶：今天 / 过去7天(1~7天前) / 过去30天(8~30天前) / 更早(30天前)
function kanbanCreatedBucketOf(task) {
    const now = new Date();
    const todayS = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = new Date(task.createdAt || now.toISOString());
    if (d >= todayS && d < new Date(todayS.getTime() + 86400000)) return 'today';
    const past7Start = new Date(todayS); past7Start.setDate(past7Start.getDate() - 7);
    if (d >= past7Start && d < todayS) return 'past7';
    const past30Start = new Date(todayS); past30Start.setDate(past30Start.getDate() - 30);
    if (d >= past30Start && d < past7Start) return 'past30';
    return 'earlier';
}

function priorityLevelOf(task) {
    if (task.important && task.urgent) return 'both';
    if (task.important) return 'important';
    if (task.urgent) return 'urgent';
    return 'none';
}

// ---------- 列生成 ----------
function kanbanTimeColumns(base) {
    // 无日期分组位置跟随看板配置 noDateTaskPosition：first=最左侧(优先显示)，last=最右侧(最末显示，默认)
    // 与任务/日程视图（taskListView.js）保持一致
    const noDateFirst = getKanbanConfig().noDateTaskPosition === 'first';
    const order = noDateFirst
        ? ['nodate', 'overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'recent7', 'later']
        : ['overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'recent7', 'later', 'nodate'];
    return order.map(b => ({
        key: `tb:${b}`, title: KANBAN_TIME_TITLE[b], type: 'timeBucket', bucket: b,
        tasks: base.filter(t => kanbanDateBucketOf(t) === b)
    }));
}

function kanbanCreatedColumns(base) {
    return ['today', 'past7', 'past30', 'earlier'].map(b => ({
        key: `cb:${b}`, title: KANBAN_CREATED_TITLE[b], type: 'createdBucket', bucket: b,
        tasks: base.filter(t => kanbanCreatedBucketOf(t) === b)
    }));
}

function kanbanPriorityColumns(base) {
    return KANBAN_PRIORITY_DEFS.map(p => ({
        key: `prio:${p.level}`, title: p.name, type: 'priority', priorityLevel: p.level,
        tasks: base.filter(t => priorityLevelOf(t) === p.level)
    }));
}

function kanbanTagSubColumns(parentCol, tagTasks, cfg) {
    const sub = cfg.tagSubGroup;
    if (sub === 'list') {
        return lists.filter(l => !l.archived && !l.isFolder).map(l => ({
            key: `${parentCol.key}|sub:sublist:${l.id}`, title: l.name, type: 'tagSubList',
            tagId: parentCol.tagId, listId: l.id, tasks: tagTasks.filter(t => t.listId === l.id)
        }));
    }
    if (sub === 'time') {
        return ['nodate', 'overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'recent7', 'later'].map(b => ({
            key: `${parentCol.key}|sub:subtb:${b}`, title: KANBAN_TIME_TITLE[b], type: 'tagSubTime',
            tagId: parentCol.tagId, bucket: b, tasks: tagTasks.filter(t => kanbanDateBucketOf(t) === b)
        }));
    }
    if (sub === 'priority') {
        return KANBAN_PRIORITY_DEFS.map(p => ({
            key: `${parentCol.key}|sub:subprio:${p.level}`, title: p.name, type: 'tagSubPriority',
            tagId: parentCol.tagId, priorityLevel: p.level, tasks: tagTasks.filter(t => priorityLevelOf(t) === p.level)
        }));
    }
    if (sub === 'createdTime') {
        return ['today', 'past7', 'past30', 'earlier'].map(b => ({
            key: `${parentCol.key}|sub:subcb:${b}`, title: KANBAN_CREATED_TITLE[b], type: 'tagSubCreated',
            tagId: parentCol.tagId, bucket: b, tasks: tagTasks.filter(t => kanbanCreatedBucketOf(t) === b)
        }));
    }
    return [];
}

function kanbanTagColumns(base, cfg) {
    const tagDefs = settings.tags || [];
    const cols = tagDefs.map(t => ({
        key: `tag:${t.id}`, title: t.name, type: 'tag', tagId: t.id, color: t.color,
        tasks: base.filter(x => (x.tags || []).includes(t.id))
    }));
    const noTag = base.filter(x => (x.tags || []).length === 0);
    if (noTag.length > 0 || tagDefs.length === 0) {
        cols.push({ key: 'tag:none', title: '无标签', type: 'tag', tagId: 'none', tasks: noTag });
    }
    if (cfg.tagSubGroup && cfg.tagSubGroup !== 'none' && cfg.tagSubGroup !== 'off') {
        cols.forEach(c => { c.children = kanbanTagSubColumns(c, c.tasks, cfg); });
    }
    return cols;
}

function computeKanbanColumns() {
    const cfg = getKanbanConfig();
    const ctx = kanbanListContext();
    let base;
    if (ctx.mode === 'groups') {
        base = filterTasks(tasks, { includeCompleted: cfg.showCompleted !== false }); // 已按 currentListId 收窄到该清单
    } else {
        base = kanbanBaseTasks(ctx.listSet);
    }

    let columns = [];
    if (cfg.groupBy === 'custom' && ctx.mode === 'groups') {
        const list = ctx.selectedList;
        const groupById = {};
        (list.groups || []).forEach(g => { groupById[g.id] = g; });
        const order = getKanbanColumnOrder(list);
        const ungroupedTasks = base.filter(t => !t.groupId || !groupById[t.groupId]);
        order.forEach(token => {
            if (token === 'ungrouped') {
                columns.push({ key: `ungrp:${list.id}`, title: '未分组', type: 'ungrouped', listId: list.id, tasks: ungroupedTasks });
            } else if (groupById[token]) {
                const g = groupById[token];
                columns.push({ key: `grp:${list.id}:${g.id}`, title: g.name, type: 'customGroup', listId: list.id, groupId: g.id, tasks: base.filter(t => t.groupId === g.id) });
            }
        });
        // 兜底：确保未分组列始终存在（作为拖拽落点）
        if (!order.includes('ungrouped')) {
            columns.push({ key: `ungrp:${list.id}`, title: '未分组', type: 'ungrouped', listId: list.id, tasks: ungroupedTasks });
        }
    } else if (cfg.groupBy === 'custom') {
        lists.filter(l => !l.archived && !l.isFolder && ctx.listSet.has(l.id)).forEach(l => {
            columns.push({ key: `list:${l.id}`, title: l.name, type: 'list', listId: l.id, color: l.color, tasks: base.filter(t => t.listId === l.id) });
        });
    } else if (cfg.groupBy === 'time') {
        columns = kanbanTimeColumns(base);
    } else if (cfg.groupBy === 'createdTime') {
        columns = kanbanCreatedColumns(base);
    } else if (cfg.groupBy === 'priority') {
        columns = kanbanPriorityColumns(base);
    } else if (cfg.groupBy === 'tag') {
        columns = kanbanTagColumns(base, cfg);
    } else {
        columns = [{ key: 'all', title: '全部任务', type: 'all', tasks: base }];
    }

    columns.forEach(col => { col.tasks = sortKanbanTasks(col.tasks, cfg); });
    return { columns, ctx, cfg };
}

// ---------- 排序 ----------
function sortKanbanTasks(arr, cfg) {
    const dir = cfg.sortDir === 'desc' ? -1 : 1;
    const getVal = (t) => {
        switch (cfg.sortBy) {
            case 'time': return t.startTime ? new Date(t.startTime).getTime() : (cfg.sortDir === 'asc' ? Infinity : -Infinity);
            case 'createdTime': return t.createdAt ? new Date(t.createdAt).getTime() : 0;
            case 'modifiedTime': return new Date(t.modifiedAt || t.createdAt).getTime();
            case 'title': return (t.title || '').toLowerCase();
            case 'tag': {
                const tg = (t.tags || [])[0];
                const def = (settings.tags || []).find(x => x.id === tg);
                return def ? def.name.toLowerCase() : '';
            }
            case 'priority': return (t.important ? 2 : 0) + (t.urgent ? 1 : 0);
            default: return 0;
        }
    };
    return arr.slice().sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1; // 已完成置底
        const va = getVal(a), vb = getVal(b);
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
    });
}

// ---------- 卡片 ----------
// 看板卡片：完成勾选框置于卡片【外】左侧（整行 items-center 竖向居中），卡片本身无左侧色条、宽度相应收窄。
// 信息顺序：第1行 元信息(时间/清单/专注/进度) → 第2行 标题 → 第3行 详情(子任务/备注) → 第4行 标签；各行间距统一 mt-1.5。
// 「显示任务详情」开启时展示子任务列表（renderSubtaskListDisplay，参照日程视图）与备注文本；关闭时二者均不展示。
// 完成圆环配色跟随「优先级显示方式」（getTaskCheckboxClass）。
function renderKanbanCard(task, showDetails, showList, showFocusButton) {
    const showFocus = (typeof showFocusButton === 'boolean') ? showFocusButton : (getKanbanConfig().showFocusButton !== false);
    const list = getList(task.listId);
    const listColor = list ? list.color : '#9ca3af';
    let timeDisplay = '';
    if (task.startTime) {
        if (isMultiDayTask(task)) {
            const start = new Date(task.startTime);
            const end = new Date(task.endTime);
            timeDisplay = `${start.getMonth() + 1}月${start.getDate()}日 ${formatTime(start)} - ${end.getMonth() + 1}月${end.getDate()}日 ${formatTime(end)}`;
        } else if (task.isAllDay) {
            const start = new Date(task.startTime);
            timeDisplay = `${start.getMonth() + 1}月${start.getDate()}日`;
        } else if (task.endTime) {
            timeDisplay = `${formatTime(new Date(task.startTime))} - ${formatTime(new Date(task.endTime))}`;
        } else {
            timeDisplay = formatDateTime(task.startTime);
        }
    }
    const focusMinutes = getTaskFocusMinutes(task.id);
    const isOverdue = isTaskOverdue(task);
    const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-secondary';
    // 「显示任务详情」关闭时，既不显示子任务列表，也不显示备注文本
    let details = '';
    if (showDetails) {
        const subtaskHtml = renderSubtaskListDisplay(task);
        details = subtaskHtml
            ? subtaskHtml
            : (task.notes ? `<div class="text-xs text-theme-muted mt-1 whitespace-pre-wrap break-words">${escapeHtml(task.notes)}</div>` : '');
    }
    const listBadge = (showList && list)
        ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color:${listColor}"></span>${escapeHtml(list.name)}</span>`
        : '';
    const tagHtml = renderTagCapsules(task, 3, 'left');
    const colors = getQuadrantColorClass(task);
    const meta = `
        ${listBadge}
        ${timeDisplay ? `<span class="${timeTextClass} flex items-center gap-1"><i class="far fa-clock"></i>${timeDisplay}</span>` : ''}
        ${focusMinutes > 0 ? `<span class="flex items-center gap-1 text-red-500/90"><i class="fas fa-stopwatch"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
        ${task.progress && task.progress > 0 ? `<span class="flex items-center gap-1 text-accent"><i class="fas fa-flag"></i>${task.progress}%</span>` : ''}`;
    return `
        <div class="flex items-center gap-2 mb-2.5">
            <button onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" draggable="false" title="标记完成" class="w-5 h-5 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : getTaskCheckboxClass(task)}">
                ${task.completed ? '<i class="fas fa-check text-[10px]"></i>' : ''}
            </button>
            <div class="kanban-card group relative ${colors.bg} border border-theme rounded-lg p-2.5 flex-1 min-w-0 cursor-pointer hover:border-accent hover:shadow-sm transition ${task.completed ? 'opacity-60' : ''}"
                 onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')"
                 draggable="true" data-task-id="${task.id}"
                 ondragstart="handleTaskDragStart(event, '${task.id}')"
                 ondragover="handleTaskDragOver(event)">
                <div class="flex items-start gap-2">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap text-xs text-theme-muted mb-1.5">${meta}</div>
                        <div class="text-sm font-medium leading-snug break-words ${task.completed ? 'line-through text-theme-muted' : 'text-theme-primary'}">${escapeHtml(task.title || '新任务')}</div>
                        ${details ? `<div class="mt-1.5">${details}</div>` : ''}
                        ${tagHtml ? `<div class="mt-1.5">${tagHtml}</div>` : ''}
                    </div>
                    ${renderFocusButton(task.id, showFocus, 'ml-auto self-center')}
                </div>
            </div>
        </div>`;
}

// ---------- 列渲染 ----------
// 计数辅助：根据 cfg.countOnlyUncompleted 决定统计未完成数或全部任务数（子列与主列共用）
function getKanbanCount(tasks, cfg) {
    return cfg.countOnlyUncompleted ? tasks.filter(t => !t.completed).length : tasks.length;
}
function renderKanbanSubColumn(ch, cfg, showList) {
    const showDetails = cfg.showDetails;
    const expanded = _kanbanExpanded[ch.key];
    const total = ch.tasks.length;
    const visible = expanded ? total : Math.min(5, total);
    const visibleTasks = ch.tasks.slice(0, visible);
    const remaining = total - visible;
    return `
        <div class="mb-2 rounded-lg border border-theme bg-theme-tertiary/40" data-col-key="${ch.key}">
            <div class="flex items-center justify-between px-2 py-1.5">
                <span class="text-xs font-medium text-theme-secondary truncate">${escapeHtml(ch.title)}</span>
                <span class="text-xs text-theme-muted">${getKanbanCount(ch.tasks, cfg)}</span>
            </div>
            <div class="px-2 pb-2 kanban-col-body drop-zone" ondragover="handleTaskDragOver(event)" ondrop="handleKanbanDrop(event, '${ch.key}')">
                ${visibleTasks.length === 0
                    ? `<div class="text-center py-3 text-theme-muted text-xs">空</div>`
                    : visibleTasks.map(t => renderKanbanCard(t, showDetails, showList)).join('') +
                      (remaining > 0 ? `<button onclick="toggleKanbanExpand('${ch.key}')" class="w-full mt-1 mb-1 py-1 text-xs text-accent hover:text-accent-hover rounded hover:bg-theme-secondary transition">+${remaining}更多</button>` : '')}
            </div>
        </div>`;
}

function renderKanbanColumn(col, cfg, showList) {
    const showDetails = cfg.showDetails;
    const expanded = _kanbanExpanded[col.key];
    const total = col.tasks.length;
    const visible = expanded ? total : Math.min(5, total);
    const visibleTasks = col.tasks.slice(0, visible);
    const remaining = total - visible;
    const count = getKanbanCount(col.tasks, cfg);

    const isCustomMode = col.type === 'customGroup' || col.type === 'ungrouped';
    const showMenu = cfg.groupBy === 'custom';   // 改进6：仅自定义分组保留「…」更多菜单
    const draggableAttrs = isCustomMode
        ? `draggable="true" ondragstart="handleKanbanColumnDragStart(event, '${col.key}')" ondragend="handleKanbanColumnDragEnd(event)"`
        : '';
    const dot = (col.color) ? `<span class="w-2.5 h-2.5 rounded-full" style="background-color: ${col.color}"></span>` : '';

    // 改进5：整行（标题 + 计数，除「+」「…」按钮）作为拖拽手柄，按住任一位置即可拖拽
    // 改进6：去掉拖拽图标（grip），保留按住标题栏任一位置（除按钮外）可拖拽
    // 改进5：customGroup 列标题支持双击改名（双击事件留在标题元素上）
    const titleHandle = `
        <div class="flex items-center gap-2 min-w-0 ${isCustomMode ? 'cursor-move' : ''}"
             ${isCustomMode && col.type === 'customGroup' ? `ondblclick="startKanbanColumnRename(event, '${col.key}')"` : ''}>
            ${dot}
            <span class="kanban-col-title font-semibold text-theme-primary truncate" ${col.color ? `style="color:${col.color}"` : ''}>${escapeHtml(col.title)}</span>
            <span class="text-xs text-theme-muted bg-theme-tertiary rounded-full px-2 py-0.5">${count}</span>
        </div>`;

    const headerHtml = `
        <div class="flex items-center justify-between mb-2 px-1 ${isCustomMode ? 'cursor-move' : ''}" ${draggableAttrs}>
            ${titleHandle}
            <div class="flex items-center gap-1">
                <button onclick="kanbanQuickAdd('${col.key}')" draggable="false" class="w-6 h-6 rounded hover:bg-theme-tertiary text-theme-muted hover:text-theme-primary flex items-center justify-center cursor-pointer" title="新建任务"><i class="fas fa-plus text-xs"></i></button>
                ${showMenu ? `<button onclick="openKanbanColumnMenu(event, '${col.key}')" draggable="false" class="w-6 h-6 rounded hover:bg-theme-tertiary text-theme-muted hover:text-theme-primary flex items-center justify-center cursor-pointer" title="更多"><i class="fas fa-ellipsis-h text-xs"></i></button>` : ''}
            </div>
        </div>`;

    let bodyHtml = `<div class="flex-1 overflow-y-auto kanban-col-body drop-zone px-4" ondragover="handleTaskDragOver(event)" ondrop="handleKanbanDrop(event, '${col.key}')">`;
    if (col.children && col.children.length) {
        bodyHtml += col.children.map(ch => renderKanbanSubColumn(ch, cfg, showList)).join('');
    } else if (visibleTasks.length === 0) {
        bodyHtml += `<div class="text-center py-6 text-theme-muted text-sm border-2 border-dashed border-theme rounded-lg">暂无任务</div>`;
    } else {
        bodyHtml += visibleTasks.map(t => renderKanbanCard(t, showDetails, showList)).join('');
        if (remaining > 0) {
            bodyHtml += `<button onclick="toggleKanbanExpand('${col.key}')" class="w-full mt-1 mb-2 py-1.5 text-xs text-accent hover:text-accent-hover rounded-lg hover:bg-theme-tertiary transition">+${remaining}更多</button>`;
        }
    }
    bodyHtml += `</div>`;

    return `
        <div class="flex flex-col w-72 flex-shrink-0 bg-theme-secondary rounded-xl shadow-theme border border-theme max-h-full" data-col-key="${col.key}"
             ${isCustomMode ? `ondragover="kanbanColumnDragOverProxy(event)" ondrop="kanbanColumnDropProxy(event, '${col.key}')"` : ''}>
            <div class="p-3 pb-2 flex-shrink-0 kanban-col-header">
                ${headerHtml}
            </div>
            ${bodyHtml}
        </div>`;
}

function startKanbanColumnRename(e, colKey) {
    if (e && e.stopPropagation) e.stopPropagation();
    const leaf = _kanbanLeafMap[colKey];
    if (!leaf || leaf.type !== 'customGroup') return;
    const sel = '[data-col-key="' + (window.CSS && CSS.escape ? CSS.escape(colKey) : colKey) + '"]';
    const colEl = document.querySelector(sel);
    if (!colEl) return;
    const titleSpan = colEl.querySelector('.kanban-col-title');
    if (!titleSpan || titleSpan.querySelector('input')) return; // 已在编辑态则忽略
    const oldName = leaf.title;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.placeholder = '分组名称';
    input.draggable = false;
    input.setAttribute('draggable', 'false');
    input.ondragstart = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); }; // 输入框本身不参与拖拽
    input.onmousedown = (ev) => { ev.stopPropagation(); }; // 编辑时避免触发列拖拽
    input.className = 'kanban-col-title-input flex-1 min-w-0 px-1 py-0.5 text-sm font-semibold rounded bg-theme-secondary text-theme-primary border border-accent focus:outline-none';
    input.id = 'kginput-' + leaf.groupId; // 与配置面板 input 同 id，使 leaveKanbanView/closeKanbanGroupConfig 能读取行内改名的值
    input.onkeydown = (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); input.value = oldName; input.blur(); }
    };
    input.onblur = () => {
        const name = input.value.trim() || oldName;
        commitKanbanColumnRename(leaf, name);
    };
    titleSpan.replaceWith(input);
    // 行内改名期间：禁用整列拖拽，避免输入框位于 draggable 列内时因鼠标微动触发列拖拽、
    // 导致输入框失焦/被重渲染销毁而丢失已输入的命名（表现为「新增分组」偶发消失）。
    // draggable 属性绑定在 header div 上（见 renderKanbanColumn 的 draggableAttrs），故需定位 header div。
    _kanbanEditingGroupId = leaf.groupId;
    const headerDiv = colEl.querySelector('.kanban-col-header > div');
    if (headerDiv) {
        headerDiv.setAttribute('draggable', 'false');
        headerDiv.removeAttribute('ondragstart');
        headerDiv.removeAttribute('ondragend');
    }
    input.focus(); input.select();
}
// 同清单内是否存在同名分组（忽略自身；大小写不敏感、去空格）
function kanbanGroupExists(list, name, exceptGroupId) {
    const n = (name || '').trim().toLowerCase();
    if (!n) return false;
    return (list.groups || []).some(g => g.id !== exceptGroupId && (g.name || '').trim().toLowerCase() === n);
}
function commitKanbanColumnRename(leaf, name) {
    _kanbanEditingGroupId = null; // 改名结束：恢复看板正常重渲染与列的拖拽能力
    // 显式恢复 header div 的拖拽能力（renderView 也会重建 DOM 恢复，此处兜底以应对渲染被跳过的边界情况）
    const colKey = 'grp:' + leaf.listId + ':' + leaf.groupId;
    const sel = '[data-col-key="' + (window.CSS && CSS.escape ? CSS.escape(colKey) : colKey) + '"]';
    const colEl = document.querySelector(sel);
    if (colEl) {
        const headerDiv = colEl.querySelector('.kanban-col-header > div');
        if (headerDiv) {
            headerDiv.setAttribute('draggable', 'true');
            headerDiv.setAttribute('ondragstart', "handleKanbanColumnDragStart(event, '" + colKey + "')");
            headerDiv.setAttribute('ondragend', 'handleKanbanColumnDragEnd(event)');
        }
    }
    const list = getList(leaf.listId);
    if (!list) { renderView(); return; }
    const g = (list.groups || []).find(x => x.id === leaf.groupId);
    if (!g) { renderView(); return; }
    const trimmed = (name || '').trim();
    const isNew = _kanbanNewGroupIds.has(leaf.groupId);
    if (!trimmed) {
        // 未填名称：新分组视为误操作删除；已有分组回退原名
        if (isNew) {
            _kanbanNewGroupIds.delete(leaf.groupId);
            removeKanbanGroup(list, leaf.groupId, true);
        } else {
            renderView();
        }
        return;
    }
    if (kanbanGroupExists(list, trimmed, leaf.groupId)) {
        if (isNew) {
            _kanbanNewGroupIds.delete(leaf.groupId);
            removeKanbanGroup(list, leaf.groupId, true);
            showToast('分组名称已存在，已取消新增', 'error');
        } else {
            showToast('分组名称已存在', 'error');
            renderView(); // 回退原名
        }
        return;
    }
    g.name = trimmed;
    if (isNew) _kanbanNewGroupIds.delete(leaf.groupId);
    saveData();
    renderView();
    if (_kanbanGroupConfigOpen) renderKanbanGroupConfigPanel();
    // 改进6：分组命名更新不再弹 toast
}
// 新增分组：直接渲染新分组并进入编辑态（不再弹窗），修复「新增 2 个 / 出现在最左」的 bug
function addKanbanGroup(listId, opts) {
    opts = opts || {};
    const list = getList(listId);
    if (!list) return;
    const ng = { id: generateId(), name: '' };
    list.groups = list.groups || [];
    list.groups.push(ng);
    _kanbanNewGroupIds.add(ng.id); // 标记为新分组：失焦/关闭未命名则视为误操作删除
    const order = getKanbanColumnOrder(list).slice().filter(t => t !== ng.id); // 去除由 groups 推导带入的自身 token（首次新增且无 customColumnOrder 时），避免重复列
    const ui = order.indexOf('ungrouped');
    let insertAt;
    if (opts.pos === 'left' && opts.refGroupId) {
        const i = order.indexOf(opts.refGroupId);
        insertAt = i > -1 ? i : (ui > -1 ? ui : order.length);
    } else if (opts.pos === 'right' && opts.refGroupId) {
        const i = order.indexOf(opts.refGroupId);
        insertAt = i > -1 ? i + 1 : (ui > -1 ? ui : order.length);
    } else {
        insertAt = order.length; // 简单新增（看板右下「新增分组」）：置于最右列之后=最右侧显示
    }
    order.splice(insertAt, 0, ng.id);
    setKanbanColumnOrder(list, order);
    saveData();
    renderView();
    if (_kanbanGroupConfigOpen) {
        renderKanbanGroupConfigPanel();
        setTimeout(() => { const el = document.getElementById('kginput-' + ng.id); if (el) { el.focus(); el.select(); } }, 50);
    } else {
        setTimeout(() => startKanbanColumnRename({ stopPropagation() {} }, 'grp:' + listId + ':' + ng.id), 50);
    }
}
function renderKanbanView(container) {
    // 行内改名输入编辑中：跳过整板重渲染，避免销毁正在输入的输入框（改名结束/取消时会清标志并主动重渲染）
    if (_kanbanEditingGroupId) return;
    const { columns, ctx, cfg } = computeKanbanColumns();
    _kanbanLeafMap = {};
    (function indexLeaves(cols) {
        cols.forEach(c => { _kanbanLeafMap[c.key] = c; if (c.children) indexLeaves(c.children); });
    })(columns);

    // 改进1：去掉「阅读 · 看板」这类标题栏，让看板铺满整屏
    const showList = ctx.mode !== 'groups';          // 单清单(自定义分组)场景下卡片无需重复显示清单名
    const canAddGroup = cfg.groupBy === 'custom' && ctx.mode === 'groups';
    const boardHtml = columns.length
        ? columns.map(c => renderKanbanColumn(c, cfg, showList)).join('')
        : '<div class="text-theme-muted py-10">暂无清单，请先在左侧创建清单。</div>';

    // 改进3：看板界面直接提供「新增分组」按钮（仅自定义分组且选中单清单时显示）
    const addGroupHtml = canAddGroup ? `
        <button onclick="addKanbanGroup('${ctx.selectedList.id}', {})"
                class="flex-shrink-0 w-44 self-start mt-1 flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed border-theme text-theme-muted hover:text-accent hover:border-accent transition bg-theme-secondary/40">
            <i class="fas fa-plus text-lg"></i>
            <span class="text-sm font-medium">新增分组</span>
        </button>` : '';

    container.innerHTML = `
        <div class="h-full flex flex-col">
            <div class="flex-1 min-h-0 flex gap-4 overflow-x-auto pb-2 pt-1" id="kanban-board">
                ${boardHtml}
                ${addGroupHtml}
            </div>
        </div>`;

    // 清理 _kanbanExpanded 中的陈旧条目（切换清单后旧 colKey 不再有效；含子列 key）
    const validKeys = new Set(Object.keys(_kanbanLeafMap));
    Object.keys(_kanbanExpanded).forEach(k => { if (!validKeys.has(k)) delete _kanbanExpanded[k]; });
}

// ---------- 拖拽落点（任务改派） ----------
function addTagToTask(task, tagId) {
    if (!tagId || tagId === 'none') return false;
    task.tags = task.tags || [];
    if (!task.tags.includes(tagId)) { task.tags.push(tagId); return true; }
    return false;
}
// 设置任务标签：tagId='none' 时清除所有标签（拖入「无标签」列），否则追加标签
function setTaskTags(task, tagId) {
    if (tagId === 'none') {
        if (task.tags && task.tags.length > 0) { task.tags = []; return true; }
        return false;
    }
    return addTagToTask(task, tagId);
}

function setPriority(task, level) {
    const imp = level === 'both' || level === 'important';
    const urg = level === 'both' || level === 'urgent';
    const changed = task.important !== imp || task.urgent !== urg;
    task.important = imp;
    task.urgent = urg;
    return changed;
}

function setTaskTimeBucket(task, bucket) {
    if (bucket === 'nodate') {
        if (task.startTime !== null) { task.startTime = null; delete task.endTime; return true; }
        return false;
    }
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let d;
    if (bucket === 'overdue') { d = new Date(startOfToday); d.setDate(d.getDate() - 1); }
    else if (bucket === 'today') { d = new Date(startOfToday); }
    else if (bucket === 'tomorrow') { d = new Date(startOfToday); d.setDate(d.getDate() + 1); }
    else if (bucket === 'dayAfterTomorrow') { d = new Date(startOfToday); d.setDate(d.getDate() + 2); }
    else if (bucket === 'recent7') { d = new Date(startOfToday); d.setDate(d.getDate() + 3); }
    else if (bucket === 'later') { d = new Date(startOfToday); d.setDate(d.getDate() + 14); }
    else return false;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), now.getHours(), now.getMinutes());
    if (task.startTime !== d.toISOString()) {
        task.startTime = d.toISOString();
        task.isAllDay = false;
        return true;
    }
    return false;
}

function handleKanbanDrop(e, colKey) {
    e.preventDefault();
    if (!draggedTaskId) return;
    const task = tasks.find(t => t.id === draggedTaskId);
    if (!task) { handleTaskDragEnd(e); return; }
    const leaf = _kanbanLeafMap[colKey];
    if (!leaf) { handleTaskDragEnd(e); return; }

    let changed = false;
    switch (leaf.type) {
        case 'list':
            if (task.listId !== leaf.listId) { task.listId = leaf.listId; task.groupId = null; changed = true; }
            break;
        case 'customGroup':
            if (task.listId !== leaf.listId || task.groupId !== leaf.groupId) { task.listId = leaf.listId; task.groupId = leaf.groupId; changed = true; }
            break;
        case 'ungrouped':
            if (task.listId !== leaf.listId || task.groupId) { task.listId = leaf.listId; task.groupId = null; changed = true; }
            break;
        case 'timeBucket':
            changed = setTaskTimeBucket(task, leaf.bucket);
            break;
        case 'priority':
            changed = setPriority(task, leaf.priorityLevel);
            break;
        case 'tag':
            changed = setTaskTags(task, leaf.tagId);
            break;
        case 'tagSubList':
            if (setTaskTags(task, leaf.tagId)) changed = true;
            if (task.listId !== leaf.listId) { task.listId = leaf.listId; task.groupId = null; changed = true; }
            break;
        case 'tagSubTime':
            if (setTaskTags(task, leaf.tagId)) changed = true;
            if (setTaskTimeBucket(task, leaf.bucket)) changed = true;
            break;
        case 'tagSubPriority':
            if (setTaskTags(task, leaf.tagId)) changed = true;
            if (setPriority(task, leaf.priorityLevel)) changed = true;
            break;
        case 'tagSubCreated':
            // 创建时间不可修改，仅添加/清除标签；任务无变化时提示用户
            changed = setTaskTags(task, leaf.tagId);
            if (!changed) showToast('任务已有该标签，创建时间不可修改', 'info');
            break;
        default:
            changed = false;
    }

    if (changed) {
        task.modifiedAt = new Date().toISOString();
        saveData();
        renderView();
        if (typeof renderLists === 'function') renderLists();
    }
    handleTaskDragEnd(e);
    e.stopPropagation(); // 阻止 drop 冒泡到列容器的 kanbanColumnDropProxy，避免子列与主列双次处理
}

// ---------- 列拖拽排序（自定义分组 + 未分组） ----------
function handleKanbanColumnDragStart(e, colKey) {
    const leaf = _kanbanLeafMap[colKey];
    if (!leaf || (leaf.type !== 'customGroup' && leaf.type !== 'ungrouped')) return;
    _draggedKanbanCol = colKey;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', colKey);
    e.target.classList.add('dragging');
}

function handleKanbanColumnDragOver(e) {
    e.preventDefault();
}

function handleKanbanColumnDragEnd(e) {
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    _draggedKanbanCol = null;
}

// 整列作为列拖拽落点：仅在「正在拖拽列」(_draggedKanbanCol 非空) 时生效，
// 否则放行给卡片自身的任务拖拽逻辑（handleKanbanDrop 在 draggedTaskId 为空时已早退且不阻止冒泡）。
function kanbanColumnDragOverProxy(e) {
    if (_draggedKanbanCol) handleKanbanColumnDragOver(e);
}
function kanbanColumnDropProxy(e, colKey) {
    if (_draggedKanbanCol) handleKanbanColumnDrop(e, colKey);
}

function handleKanbanColumnDrop(e, targetColKey) {
    e.preventDefault();
    if (!_draggedKanbanCol || _draggedKanbanCol === targetColKey) { _draggedKanbanCol = null; return; }
    const src = _kanbanLeafMap[_draggedKanbanCol];
    const tgt = _kanbanLeafMap[targetColKey];
    const reorderable = src && tgt && src.listId === tgt.listId &&
        (src.type === 'customGroup' || src.type === 'ungrouped') &&
        (tgt.type === 'customGroup' || tgt.type === 'ungrouped');
    if (reorderable) {
        const list = getList(src.listId);
        if (list) {
            const order = getKanbanColumnOrder(list).slice();
            const srcToken = colKeyToOrderToken(_draggedKanbanCol, list.id);
            const tgtToken = colKeyToOrderToken(targetColKey, list.id);
            const from = order.indexOf(srcToken);
            const to = order.indexOf(tgtToken);
            if (from > -1 && to > -1 && from !== to) {
                order.splice(from, 1);
                order.splice(to, 0, srcToken);
                setKanbanColumnOrder(list, order);
                renderView();
                // 改进6：分组顺序更新不再弹 toast
            }
        }
    }
    _draggedKanbanCol = null;
    handleKanbanColumnDragEnd(e);
}

// ---------- 展开 / 收起 ----------
function toggleKanbanExpand(colKey) {
    _kanbanExpanded[colKey] = !_kanbanExpanded[colKey];
    renderView();
}

// ---------- 快速新建 ----------
function kanbanQuickAdd(colKey) {
    const leaf = _kanbanLeafMap[colKey];
    if (!leaf) return;
    const listObj = currentListId && getList(currentListId) && !getList(currentListId).isFolder ? getList(currentListId) : null;
    let listId, groupId = null, presetTags = [];

    if (leaf.type === 'list') { listId = leaf.listId; }
    else if (leaf.type === 'customGroup') { listId = leaf.listId; groupId = leaf.groupId; }
    else if (leaf.type === 'ungrouped') { listId = leaf.listId; }
    else if (leaf.type === 'tagSubList') { listId = leaf.listId; if (leaf.tagId && leaf.tagId !== 'none') presetTags = [leaf.tagId]; }
    else if (leaf.type === 'tag' || leaf.type === 'tagSubTime' || leaf.type === 'tagSubPriority' || leaf.type === 'tagSubCreated') {
        listId = listObj ? listObj.id : (settings.defaultListId || 'default');
        if (leaf.tagId && leaf.tagId !== 'none') presetTags = [leaf.tagId];
    } else {
        listId = listObj ? listObj.id : (settings.defaultListId || 'default');
    }

    const now = new Date();
    const startTime = getDefaultTaskDate(settings.defaultTaskDate);
    const newTask = {
        id: generateId(),
        title: '',
        listId: listId,
        important: settings.defaultImportant || false,
        urgent: settings.defaultUrgent || false,
        notes: '',
        tags: presetTags,
        startTime: startTime ? startTime.toISOString() : null,
        endTime: null,
        isAllDay: true,
        reminder: 0,
        repeat: null,
        completed: false,
        createdAt: now.toISOString(),
        mode: 'text',
        subtasks: [{ id: generateId(), text: '', completed: false, originalOrder: 0 }],
        progress: 0,
        groupId: groupId
    };
    tasks.push(newTask);
    saveData();
    renderLists();
    renderView();
    openTaskDetailPanel(newTask.id);
    setTimeout(() => {
        const ti = document.getElementById('detail-task-title');
        if (ti) { ti.focus(); ti.select(); }
    }, 100);
}

// ---------- 列头菜单 ----------
let _kanbanMenuEl = null;

function closeKanbanColumnMenu() {
    if (_kanbanMenuEl) { _kanbanMenuEl.remove(); _kanbanMenuEl = null; }
    kanbanMenuDeleteConfirming = null; // 关闭菜单时重置删除二次确认状态，避免跨菜单残留
}

function buildKanbanMenu(items, x, y) {
    closeKanbanColumnMenu();
    const menu = document.createElement('div');
    menu.className = 'fixed z-50 bg-theme-secondary border border-theme rounded-xl shadow-2xl py-1 min-w-[180px] text-sm';
    menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - (items.length * 38 + 20)) + 'px';
    items.forEach(it => {
        const btn = document.createElement('button');
        btn.className = `w-full text-left px-3 py-2 flex items-center gap-2 transition ${it.danger ? 'text-red-500 hover:bg-red-500/10' : 'text-theme-primary hover:bg-theme-tertiary'}`;
        btn.innerHTML = `<i class="fas ${it.icon} w-4 text-center"></i><span>${escapeHtml(it.label)}</span>`;
        btn.onclick = (ev) => { ev.stopPropagation(); it.onClick(); if (!it.keepOpen && !it.nav) closeKanbanColumnMenu(); };
        menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    _kanbanMenuEl = menu;
    setTimeout(() => document.addEventListener('click', closeKanbanColumnMenu, { once: true }), 0);
}

function openKanbanColumnMenu(e, colKey) {
    e.stopPropagation();
    kanbanMenuDeleteConfirming = null; // 打开菜单时重置删除二次确认状态，避免跨菜单残留
    const leaf = _kanbanLeafMap[colKey];
    if (!leaf) return;

    const baseItems = [];

    if (leaf.type === 'customGroup') {
        baseItems.push({ label: '重命名分组', icon: 'fa-pen', onClick: () => setTimeout(() => startKanbanColumnRename(null, colKey), 0) });
        baseItems.push({ label: '在左侧增加分组', icon: 'fa-arrow-left', onClick: () => addKanbanGroup(leaf.listId, { pos: 'left', refGroupId: leaf.groupId }) });
        baseItems.push({ label: '在右侧增加分组', icon: 'fa-arrow-right', onClick: () => addKanbanGroup(leaf.listId, { pos: 'right', refGroupId: leaf.groupId }) });
        baseItems.push({ label: '删除该分组', icon: 'fa-trash', danger: true, keepOpen: true, onClick: () => deleteKanbanGroup(leaf.listId, leaf.groupId) });
    } else if (leaf.type === 'ungrouped') {
        baseItems.push({ label: '在右侧增加分组', icon: 'fa-arrow-right', onClick: () => addKanbanGroup(leaf.listId, {}) });
    } else if (leaf.type === 'list') {
        baseItems.push({ label: '重命名清单', icon: 'fa-pen', onClick: () => renameKanbanList(leaf.listId) });
        const targetLists = lists.filter(l => !l.archived && l.id !== leaf.listId);
        if (targetLists.length) {
            baseItems.push({
                label: '移动到…', icon: 'fa-arrow-right', nav: true,
                onClick: () => buildKanbanMenu(
                    [{ label: '‹ 返回', icon: 'fa-arrow-left', nav: true, onClick: () => openKanbanColumnMenu(e, colKey) }].concat(
                        targetLists.map(l => ({ label: l.name, icon: 'fa-list', onClick: () => moveKanbanList(leaf.listId, l.id) }))
                    ), e.clientX, e.clientY)
            });
        }
        baseItems.push({ label: '删除清单', icon: 'fa-trash', danger: true, onClick: () => deleteKanbanList(leaf.listId) });
    }

    buildKanbanMenu(baseItems, e.clientX, e.clientY);
}

// ---------- 分组 / 清单 新增与重命名：统一用配置弹窗，不再使用浏览器 prompt ----------
let _kgCtx = null;
function openKanbanGroupModal(mode, opts) {
    _kgCtx = Object.assign({ mode }, opts);
    const modal = document.getElementById('kanbanGroupModal');
    const titleEl = document.getElementById('kanbanGroupModalTitle');
    const input = document.getElementById('kanbanGroupInput');
    if (!modal || !input) return;
    const kind = opts.kind || 'group';
    let title = '新增分组';
    if (mode === 'rename') title = kind === 'list' ? '重命名清单' : '重命名分组';
    else if (kind === 'list') title = '新增清单';
    if (titleEl) titleEl.textContent = title;
    input.value = (mode === 'rename' && opts.oldName) ? opts.oldName : '';
    input.placeholder = mode === 'rename' ? '输入名称' : (kind === 'list' ? '输入清单名称' : '输入分组名称');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => { input.focus(); input.select(); }, 50);
}
function closeKanbanGroupModal() {
    const modal = document.getElementById('kanbanGroupModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    _kgCtx = null;
}
function confirmKanbanGroupModal() {
    if (!_kgCtx) return;
    const input = document.getElementById('kanbanGroupInput');
    const name = input ? input.value.trim() : '';
    if (!name) { if (input) input.focus(); return; }
    const { mode, kind, listId, pos, refGroupId, groupId } = _kgCtx;
    const list = getList(listId);
    if (!list) { closeKanbanGroupModal(); return; }
    if (kind === 'list' && mode === 'rename') {
        list.name = name; saveData(); renderView();
        if (typeof renderLists === 'function') renderLists();
    } else if (mode === 'rename') {
        const g = (list.groups || []).find(x => x.id === groupId);
        if (g) {
            if (kanbanGroupExists(list, name, groupId)) { showToast('分组名称已存在', 'error'); return; } // 保持弹窗打开，便于重新输入
            g.name = name; saveData(); renderView();
            if (_kanbanGroupConfigOpen) renderKanbanGroupConfigPanel();
            // 改进6：分组命名更新不再弹 toast
        }
    } else {
        if (kind !== 'list' && kanbanGroupExists(list, name, null)) { showToast('分组名称已存在', 'error'); return; } // 保持弹窗打开，便于重新输入
        const ng = { id: generateId(), name };
        list.groups = list.groups || [];
        if (pos === 'left' && refGroupId) {
            const i = list.groups.findIndex(g => g.id === refGroupId);
            list.groups.splice(i > -1 ? i : list.groups.length, 0, ng);
        } else if (pos === 'right' && refGroupId) {
            const i = list.groups.findIndex(g => g.id === refGroupId);
            list.groups.splice(i > -1 ? i + 1 : list.groups.length, 0, ng);
        } else {
            list.groups.push(ng);
        }
        // 同步列顺序：新分组插入到「未分组」之前，保持「命名分组→未分组」默认视觉
        const order = getKanbanColumnOrder(list).slice();
        const ui = order.indexOf('ungrouped');
        if (ui > -1) order.splice(ui, 0, ng.id); else order.push(ng.id);
        setKanbanColumnOrder(list, order);
        saveData(); renderView();
        if (_kanbanGroupConfigOpen) renderKanbanGroupConfigPanel();
    }
    closeKanbanGroupModal();
}

// ---------- 删除 / 合并确认：用自定义弹窗替代浏览器 confirm ----------
let _kgConfirmCb = null;
function openKanbanConfirm(message, onConfirm) {
    _kgConfirmCb = onConfirm;
    const modal = document.getElementById('kanbanConfirmModal');
    const msg = document.getElementById('kanbanConfirmMsg');
    if (msg) msg.textContent = message;
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
}
function confirmKanbanConfirm() {
    const cb = _kgConfirmCb; _kgConfirmCb = null;
    const modal = document.getElementById('kanbanConfirmModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    if (cb) cb();
}
function cancelKanbanConfirm() {
    _kgConfirmCb = null;
    const modal = document.getElementById('kanbanConfirmModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

// ---------- 自定义分组 / 清单管理 ----------
// 真正执行删除分组（含其内部任务、分组顺序、列顺序）。silent=true 时不弹 toast（如「新增分组」误操作静默删除）
function removeKanbanGroup(list, groupId, silent) {
    for (let i = tasks.length - 1; i >= 0; i--) {
        if (tasks[i].listId === list.id && tasks[i].groupId === groupId) tasks.splice(i, 1);
    }
    if (list.groups) list.groups = list.groups.filter(g => g.id !== groupId);
    const order = getKanbanColumnOrder(list).filter(t => t !== groupId);
    setKanbanColumnOrder(list, order);
    saveData();
    renderKanbanGroupConfigPanel();
    if (typeof renderLists === 'function') renderLists();
    renderView();
}
function doDeleteKanbanGroup(list, groupId) {
    removeKanbanGroup(list, groupId, false);
}

// 清理清单中「名称为空」的分组（仅发生在「新增分组」后未命名即关闭的误操作残留）。
// 跳过仍在编辑中的新分组（_kanbanNewGroupIds 中的 id），避免误删用户正在输入的分组。
// 轻量实现：仅改数据 + 保存，不触发渲染，可在 renderKanbanView 入口安全调用（避免重入）。
function pruneEmptyKanbanGroups(list) {
    if (!list || !Array.isArray(list.groups)) return;
    const empties = list.groups
        .filter(g => !(g.name || '').trim() && !_kanbanNewGroupIds.has(g.id))
        .map(g => g.id);
    if (empties.length === 0) return;
    const emptySet = new Set(empties);
    // 顺手清理被删分组下可能残留的任务，避免 groupId 悬空
    for (let i = tasks.length - 1; i >= 0; i--) {
        if (tasks[i].listId === list.id && emptySet.has(tasks[i].groupId)) tasks.splice(i, 1);
    }
    list.groups = list.groups.filter(g => !emptySet.has(g.id));
    if (Array.isArray(list.customColumnOrder)) {
        list.customColumnOrder = list.customColumnOrder.filter(t => !emptySet.has(t));
    }
    saveData();
}

// 离开看板视图时调用：先把仍在编辑中的新分组提交名称/标记删除，再清理任意清单里残留的空名分组。
// 作为「切换视图」场景下「失焦删除」未触发时的兜底（如程序化切视图、未产生 blur 的边界情况）。
function leaveKanbanView() {
    _kanbanEditingGroupId = null; // 离开看板：若有未结束的行内改名，复位标志，避免卡死后续重渲染
    const ctx = kanbanListContext();
    const list = ctx && ctx.selectedList;
    const pending = Array.from(_kanbanNewGroupIds);
    _kanbanNewGroupIds.clear();
    if (list) {
        pending.forEach(id => {
            const input = document.getElementById('kginput-' + id);
            const val = input ? input.value.trim() : '';
            if (val) {
                const g = (list.groups || []).find(x => x.id === id);
                if (g && !kanbanGroupExists(list, val, id)) g.name = val; // 命名（重名则留空，交给下方 prune 删除）
            }
            // 空值/重名：保持空名，由下方 pruneEmptyKanbanGroups 删除
        });
        saveData();
    }
    // 清理所有清单里残留的空名分组（含被放弃的新分组、上一会话遗留）
    (typeof lists !== 'undefined' ? lists : []).forEach(l => pruneEmptyKanbanGroups(l));
}

// 列菜单「删除该分组」：仿照 deleteTask 行内二次确认（点击→变「确认删除」→再点执行→3s 还原）
let kanbanMenuDeleteConfirming = null;
function deleteKanbanGroup(listId, groupId) {
    const list = getList(listId);
    if (!list) return;
    if (kanbanMenuDeleteConfirming === groupId) {
        kanbanMenuDeleteConfirming = null;
        doDeleteKanbanGroup(list, groupId);
        closeKanbanColumnMenu();
        return;
    }
    kanbanMenuDeleteConfirming = groupId;
    const menu = _kanbanMenuEl;
    const delBtn = menu && Array.from(menu.querySelectorAll('button')).find(b => b.querySelector('.fa-trash'));
    if (delBtn) {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'w-full text-left px-3 py-2 flex items-center gap-2 transition text-white bg-red-500 hover:bg-red-600';
        confirmBtn.innerHTML = '<i class="fas fa-trash w-4 text-center"></i><span>确认删除</span>';
        confirmBtn.onclick = (e) => { e.stopPropagation(); deleteKanbanGroup(listId, groupId); };
        delBtn.parentNode.replaceChild(confirmBtn, delBtn);
        setTimeout(() => {
            kanbanMenuDeleteConfirming = null;
            const m2 = _kanbanMenuEl;
            const cb = m2 && Array.from(m2.querySelectorAll('button')).find(b => b.textContent.trim() === '确认删除');
            if (cb) {
                const restore = document.createElement('button');
                restore.className = 'w-full text-left px-3 py-2 flex items-center gap-2 transition text-red-500 hover:bg-red-500/10';
                restore.innerHTML = '<i class="fas fa-trash w-4 text-center"></i><span>删除该分组</span>';
                restore.onclick = (e) => { e.stopPropagation(); deleteKanbanGroup(listId, groupId); };
                cb.parentNode.replaceChild(restore, cb);
            }
        }, 3000);
    }
}

function renameKanbanList(listId) {
    const list = getList(listId);
    if (!list) return;
    openKanbanGroupModal('rename', { kind: 'list', listId, oldName: list.name });
}

function moveKanbanList(srcId, tgtId) {
    const src = getList(srcId);
    const tgt = getList(tgtId);
    if (!src || !tgt) return;
    openKanbanConfirm(`将「${src.name}」的任务合并到「${tgt.name}」并删除「${src.name}」？`, () => {
        tasks.forEach(t => { if (t.listId === srcId) { t.listId = tgtId; t.groupId = null; } });
        lists = lists.filter(l => l.id !== srcId);
        saveData();
        renderView();
        if (typeof renderLists === 'function') renderLists();
    });
}

function deleteKanbanList(listId) {
    if (lists.length <= 1) { showToast('至少需保留一个清单', 'error'); return; }
    const list = getList(listId);
    if (!list) return;
    if (list.isFolder) { showToast('请到侧边栏删除清单集', 'warning'); return; }
    const taskCount = tasks.filter(t => t.listId === listId).length;
    openKanbanListDeleteChoice(listId, list.name, taskCount);
}

// ---------- 删除清单：统一选择弹窗（移入默认清单 / 删除任务） ----------
let _kanbanListDeleteCtx = null;
function openKanbanListDeleteChoice(listId, listName, taskCount) {
    _kanbanListDeleteCtx = { listId, listName, taskCount };
    const modal = document.getElementById('kanbanListDeleteModal');
    const titleEl = document.getElementById('kanbanListDeleteTitle');
    const msgEl = document.getElementById('kanbanListDeleteMsg');
    const moveBtn = document.getElementById('kanbanListDeleteMoveBtn');
    const purgeBtn = document.getElementById('kanbanListDeletePurgeBtn');
    if (titleEl) titleEl.textContent = `删除清单「${listName}」`;
    if (msgEl) msgEl.textContent = taskCount > 0
        ? `该清单内有 ${taskCount} 个任务，请选择处理方式：`
        : '该清单内没有任务，确认删除？';
    if (moveBtn) moveBtn.classList.toggle('hidden', taskCount === 0);
    if (purgeBtn) purgeBtn.textContent = taskCount > 0 ? '删除所有任务' : '确认删除';
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
}
function closeKanbanListDeleteChoice() {
    const modal = document.getElementById('kanbanListDeleteModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    _kanbanListDeleteCtx = null;
}
function confirmKanbanListDelete(moveToDefault) {
    if (!_kanbanListDeleteCtx) return;
    const { listId, listName } = _kanbanListDeleteCtx;
    _kanbanListDeleteCtx = null;
    closeKanbanListDeleteChoice();
    doDeleteList(listId, listName, moveToDefault);
}
function doDeleteList(listId, listName, moveToDefault) {
    if (moveToDefault) {
        tasks.forEach(t => { if (t.listId === listId) { t.listId = 'default'; t.groupId = null; } });
    } else {
        for (let i = tasks.length - 1; i >= 0; i--) {
            if (tasks[i].listId === listId) tasks.splice(i, 1);
        }
    }
    lists = lists.filter(l => l.id !== listId);
    if (currentListId === listId) currentListId = null;
    saveData();
    renderView();
    if (typeof renderLists === 'function') renderLists();
    showToast(`清单"${listName}"已删除${moveToDefault ? '，任务已移至默认清单' : ''}`, 'success');
}

// ---------- 视图配置面板（统一框架：utils.js _registerViewConfig） ----------
// _showKanbanPanel/_hideKanbanPanel 已移至 utils.js 通用显隐
_registerViewConfig('kanban', 'kanbanConfigPanel', 'kanban-config-btn');
// 分组配置子面板：无独立开关按钮（由看板配置面板内入口打开），点击外部只关最上层
_registerViewConfig('kanbanGroup', 'kanbanGroupConfigPanel', null);

function toggleKanbanConfig() {
    if (_viewConfigPanels.kanban && _viewConfigPanels.kanban.open) closeViewConfigPanel('kanban');
    else openKanbanConfig();
}

function openKanbanConfig() {
    const cfg = getKanbanConfig();
    const g = document.getElementById('kc-groupby');
    const sb = document.getElementById('kc-sortby');
    const sdAsc = document.getElementById('kc-sortdir-asc');
    const sdDesc = document.getElementById('kc-sortdir-desc');
    const sdEl = document.getElementById('kc-showdetails');
    const ts = document.getElementById('kc-tagsub');
    const scEl = document.getElementById('kc-showcompleted');
    const sfEl = document.getElementById('kc-showfocus');
    const cuEl = document.getElementById('kc-countuncompleted');
    const ndp = document.getElementById('kc-nodatepos');
    if (g) g.value = cfg.groupBy;
    if (sb) sb.value = cfg.sortBy;
    if (sdAsc) sdAsc.checked = cfg.sortDir !== 'desc';
    if (sdDesc) sdDesc.checked = cfg.sortDir === 'desc';
    if (sdEl) sdEl.checked = !!cfg.showDetails;
    if (scEl) scEl.checked = cfg.showCompleted !== false;
    if (sfEl) sfEl.checked = cfg.showFocusButton !== false;
    if (cuEl) cuEl.checked = cfg.countOnlyUncompleted !== false;
    if (ts) ts.value = cfg.tagSubGroup || 'list';
    if (ndp) ndp.value = cfg.noDateTaskPosition === 'first' ? 'first' : 'last';
    updateKanbanTagSubVisibility();
    updateKanbanGroupConfigEntry();
    openViewConfigPanel('kanban', _onKanbanConfigClosed);
}

function closeKanbanConfig() {
    closeViewConfigPanel('kanban');
}

// 关闭回调：提交行内改名、保存配置并刷新（forSwitch=切换视图场景仅保存不渲染）
function _onKanbanConfigClosed(forSwitch) {
    if (_kanbanGroupConfigOpen) closeKanbanGroupConfig();
    // 行内改名期间关闭配置面板：先提交行内改名，避免 renderView 被 _kanbanEditingGroupId 跳过
    // commitKanbanColumnRename 内部已调用 renderView，此处通过 skipRender 避免双重渲染
    let skipRender = false;
    if (_kanbanEditingGroupId) {
        const inp = document.querySelector('.kanban-col-title-input');
        if (inp) { inp.blur(); skipRender = true; } else { _kanbanEditingGroupId = null; }
    }
    saveData(); // 延迟保存：配置变更实时预览，关闭面板时统一落盘
    if (!forSwitch && !skipRender) renderView();
}

// 恢复默认配置（面板内「恢复默认」按钮）
function resetKanbanViewConfig() {
    _resetViewConfigToDefault('kanbanConfig', { showCompleted: true, showFocusButton: true, noDateTaskPosition: 'last' });
    _kanbanExpanded = {}; // 分组依据等重置后，旧的列展开状态可能失配
    saveData();
    renderView();
    openKanbanConfig(); // 重填面板控件
    showToast('已恢复看板默认配置', 'success');
}

function updateKanbanTagSubVisibility() {
    const g = document.getElementById('kc-groupby');
    const wrap = document.getElementById('kc-tagsub-wrap');
    if (g && wrap) wrap.style.display = g.value === 'tag' ? 'block' : 'none';
}

function updateKanbanGroupConfigEntry() {
    const cfg = getKanbanConfig();
    const ctx = kanbanListContext();
    const entry = document.getElementById('kc-groupconfig-entry');
    if (entry) entry.classList.toggle('hidden', !(cfg.groupBy === 'custom' && ctx.mode === 'groups'));
}

// 控件变更：实时写入配置并预览（延迟保存：关闭面板时统一落盘）
function onKanbanConfigChange() {
    const cfg = getKanbanConfig();
    const prevGroupBy = cfg.groupBy;
    const g = document.getElementById('kc-groupby');
    const sb = document.getElementById('kc-sortby');
    const sdDesc = document.getElementById('kc-sortdir-desc');
    const sdEl = document.getElementById('kc-showdetails');
    const ts = document.getElementById('kc-tagsub');
    const scEl = document.getElementById('kc-showcompleted');
    const sfEl = document.getElementById('kc-showfocus');
    const cuEl = document.getElementById('kc-countuncompleted');
    const ndp = document.getElementById('kc-nodatepos');
    if (g) cfg.groupBy = g.value;
    if (sb) cfg.sortBy = sb.value;
    if (sdDesc) cfg.sortDir = sdDesc.checked ? 'desc' : 'asc';
    if (sdEl) cfg.showDetails = sdEl.checked;
    if (scEl) cfg.showCompleted = scEl.checked;
    if (sfEl) cfg.showFocusButton = sfEl.checked;
    if (cuEl) cfg.countOnlyUncompleted = cuEl.checked;
    if (ts) cfg.tagSubGroup = ts.value;
    if (ndp) cfg.noDateTaskPosition = ndp.value === 'first' ? 'first' : 'last';
    // 切换分组依据时重置「查看更多」展开状态，避免旧 colKey 在会话内累积
    if (cfg.groupBy !== prevGroupBy) _kanbanExpanded = {};
    updateKanbanTagSubVisibility();
    updateKanbanGroupConfigEntry();
    renderView();
}

// ---------- 分组配置子面板（覆盖于视图配置面板上，统一框架管理点击外部关闭） ----------
function openKanbanGroupConfig() {
    const cfg = getKanbanConfig();
    const ctx = kanbanListContext();
    if (!(cfg.groupBy === 'custom' && ctx.mode === 'groups')) return;
    _kanbanGroupConfigOpen = true;
    renderKanbanGroupConfigPanel();
    openViewConfigPanel('kanbanGroup', _onKanbanGroupConfigClosed);
}

function closeKanbanGroupConfig() {
    closeViewConfigPanel('kanbanGroup');
}

// 关闭回调：提交未命名的「新增分组」、清理空名分组并保存
function _onKanbanGroupConfigClosed() {
    const ctx = kanbanListContext();
    const list = ctx && ctx.selectedList;
    const pending = Array.from(_kanbanNewGroupIds);
    _kanbanNewGroupIds.clear();
    if (list) {
        pending.forEach(id => {
            const input = document.getElementById('kginput-' + id);
            const val = input ? input.value.trim() : '';
            if (val) {
                const g = (list.groups || []).find(x => x.id === id);
                if (g && !kanbanGroupExists(list, val, id)) g.name = val; // 命名（重名则留空，交给下方 prune 删除）
            }
            // 空值/重名：保持空名，由下方 pruneEmptyKanbanGroups 删除
        });
        saveData();
        pruneEmptyKanbanGroups(list); // 删除所有空名分组（含被放弃的新分组）
    }
    _kanbanGroupConfigOpen = false;
    kanbanGroupDeleteConfirming = null; // 关闭分组配置面板时重置删除二次确认状态，避免残留
}

function renderKanbanGroupConfigPanel() {
    const ctx = kanbanListContext();
    const list = ctx.selectedList;
    const body = document.getElementById('kanbanGroupConfigBody');
    if (!body || !list) return;
    const order = getKanbanColumnOrder(list);
    const groupById = {};
    (list.groups || []).forEach(g => { groupById[g.id] = g; });
    let html = '';
    order.forEach(token => {
        const isUngrouped = token === 'ungrouped';
        const name = isUngrouped ? '未分组' : (groupById[token] ? groupById[token].name : '');
        if (!isUngrouped && !groupById[token]) return; // 跳过已删除的分组 token
        html += `
            <div class="flex items-center gap-2 p-2 rounded-lg bg-theme-tertiary border border-theme" draggable="true"
                 data-kg-token="${token}"
                 ondragstart="kanbanGroupCfgDragStart(event, '${token}')"
                 ondragover="kanbanGroupCfgDragOver(event)"
                 ondrop="kanbanGroupCfgDrop(event, '${token}')"
                 ondragend="kanbanGroupCfgDragEnd(event)">
                ${isUngrouped
                    ? `<span class="flex-1 text-sm text-theme-primary font-medium">${name}</span>`
                    : `<input id="kginput-${token}" type="text" value="${escapeHtml(name)}" placeholder="分组名称" draggable="false" ondragstart="event.preventDefault()" onfocus="this.parentElement.setAttribute('draggable','false')" onblur="this.parentElement.setAttribute('draggable','true'); kanbanGroupCfgRename('${token}', this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}" class="flex-1 px-2 py-1 text-sm rounded bg-theme-secondary text-theme-primary border border-theme focus:outline-none focus:border-accent" />`}
                ${isUngrouped ? '' : `<button onclick="kanbanGroupCfgDelete('${token}')" class="kg-del-btn w-7 h-7 rounded hover:bg-red-500/10 text-red-500 flex items-center justify-center" title="删除分组"><i class="fas fa-trash text-xs"></i></button>`}
            </div>`;
    });
    body.innerHTML = html || '<div class="text-center text-theme-muted text-sm py-6">暂无分组</div>';
}

function kanbanGroupCfgDragStart(e, token) {
    _kgCfgDragToken = token;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', token);
}
function kanbanGroupCfgDragOver(e) { e.preventDefault(); }
function kanbanGroupCfgDragEnd(e) {
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    _kgCfgDragToken = null;
}
function kanbanGroupCfgDrop(e, targetToken) {
    e.preventDefault();
    if (!_kgCfgDragToken || _kgCfgDragToken === targetToken) { _kgCfgDragToken = null; return; }
    const ctx = kanbanListContext();
    const list = ctx.selectedList;
    if (!list) { _kgCfgDragToken = null; return; }
    const order = getKanbanColumnOrder(list).slice();
    const from = order.indexOf(_kgCfgDragToken);
    const to = order.indexOf(targetToken);
    if (from > -1 && to > -1 && from !== to) {
        order.splice(from, 1);
        order.splice(to, 0, _kgCfgDragToken);
        setKanbanColumnOrder(list, order);
        renderKanbanGroupConfigPanel();
        renderView();
    }
    _kgCfgDragToken = null;
    kanbanGroupCfgDragEnd(e);
}
function kanbanGroupCfgRename(token, name) {
    const ctx = kanbanListContext();
    const list = ctx.selectedList;
    const g = list && (list.groups || []).find(x => x.id === token);
    if (!g) return;
    const trimmed = (name || '').trim();
    const isNew = _kanbanNewGroupIds.has(token);
    if (!trimmed) {
        // 未填名称：新分组视为误操作删除；已有分组保持不变
        if (isNew) {
            _kanbanNewGroupIds.delete(token);
            removeKanbanGroup(list, token, true);
        }
        return;
    }
    if (kanbanGroupExists(list, trimmed, token)) {
        if (isNew) {
            _kanbanNewGroupIds.delete(token);
            removeKanbanGroup(list, token, true);
            showToast('分组名称已存在，已取消新增', 'error');
        } else {
            showToast('分组名称已存在', 'error');
            renderKanbanGroupConfigPanel(); // 回退输入框显示
        }
        return;
    }
    g.name = trimmed;
    if (isNew) _kanbanNewGroupIds.delete(token);
    saveData();
    renderKanbanGroupConfigPanel();
    renderView();
}
// 分组配置面板删除按钮：仿照 deleteTask 行内二次确认（点击→变「确认删除」→再点执行→3s 还原）
let kanbanGroupDeleteConfirming = null;
function kanbanGroupCfgDelete(token) {
    const ctx = kanbanListContext();
    const list = ctx.selectedList;
    if (!list) return;
    const panelBody = document.getElementById('kanbanGroupConfigBody');
    if (!panelBody) return;
    const row = panelBody.querySelector(`[data-kg-token="${token}"]`);
    if (!row) return;

    if (kanbanGroupDeleteConfirming === token) {
        kanbanGroupDeleteConfirming = null;
        doDeleteKanbanGroup(list, token);   // 内部已调用 renderKanbanGroupConfigPanel，删除后该行自然消失
        return;
    }

    kanbanGroupDeleteConfirming = token;
    const delBtn = row.querySelector('.kg-del-btn');
    if (!delBtn) return;
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'kg-del-btn px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 flex items-center justify-center';
    confirmBtn.textContent = '确认删除';
    confirmBtn.onclick = (e) => { e.stopPropagation(); kanbanGroupCfgDelete(token); };
    delBtn.parentNode.replaceChild(confirmBtn, delBtn);
    setTimeout(() => {
        kanbanGroupDeleteConfirming = null;
        const r2 = panelBody.querySelector(`[data-kg-token="${token}"]`);
        const cb = r2 && r2.querySelector('.kg-del-btn');
        if (cb && cb.textContent === '确认删除') {
            const restore = document.createElement('button');
            restore.className = 'kg-del-btn w-7 h-7 rounded hover:bg-red-500/10 text-red-500 flex items-center justify-center';
            restore.title = '删除分组';
            restore.innerHTML = '<i class="fas fa-trash text-xs"></i>';
            restore.onclick = () => kanbanGroupCfgDelete(token);
            cb.parentNode.replaceChild(restore, cb);
        }
    }, 3000);
}
function kanbanGroupCfgAdd() {
    const ctx = kanbanListContext();
    const list = ctx.selectedList;
    if (!list) return;
    addKanbanGroup(list.id, {});
}
