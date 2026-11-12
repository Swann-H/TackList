// ==================== 任务列表视图 & 日程视图（从 views.js 拆分） ====================

let scheduleMonthOffset = 0;
let _scheduleAutoScroll = true;
// 分组折叠状态：记录每个分组的折叠状态（true=已折叠）。默认仅"已完成"折叠。
// per-list 隔离：每个清单（含"所有任务"）独立维护折叠态，切换清单时保存/恢复
let taskListGroupCollapsed = { completed: true };
let _taskListGroupCollapsedByList = {}; // { listKey: { completed: true, ... } }
let _lastCollapseListKey = null; // 上次渲染时的清单 key，用于检测清单切换
let _groupCollapseSaveTimer = null; // 折叠态 localStorage 持久化防抖计时器
const GROUP_COLLAPSE_KEY = 'tacklist_group_collapsed';
let taskListCompletedShowAll = false;
// 「已完成任务独立分组」关闭（separateCompleted=false）时，已完成任务留在各自分组内并置底，
// 组内已完成段落只显示前 5 条；这里的 Set 记录哪些分组已就地展开（仅会话内，不落盘）。
// key = 分组 key（today / day_2026-11-01 / prio:both / tag:xxx ...），切换清单·筛选·分组依据时清空。
let _taskGroupCompletedExpanded = {};
// 筛选上下文签名：用于检测筛选条件变化，变化时重置分组折叠状态为默认值
let _lastTaskListFilterSig = null;
let _scheduleIntersectionObserver = null; // 当前日程视图的 IO，重渲染前 disconnect 防泄漏
let _scheduleNavObserver = null; // 顶部导航栏月份指示器 IO（替代 scroll 监听，避免高频 reflow）
let _scheduleGroupedTasks = null; // 日程视图按日期分组的缓存，供局部更新复用
let _scheduleFilteredCache = null; // filterTasks 结果缓存，避免每次渲染全量扫描
let _scheduleStickyResizeBound = false; // 日期块吸顶位置的 resize 监听只绑定一次
let _scheduleNavMonthLabel = null; // 当前锚点月份（YYYY-MM），由导航月份指示 IO 实时维护
let _scheduleScrollTargetMonth = null; // 窗口平移重渲染后的滚动定位目标月份（YYYY-MM）
let _scheduleScrollTargetDir = 1; // 定位目标的导航方向（目标月份为空月份时就近查找用）
let _scheduleRestoreFilling = false; // 滚动锚点恢复期间填充月份时，跳过填充锚定补偿（位置由恢复逻辑显式设定）
let _scheduleLastViewport = null; // 离开日程视图时的视口锚点 { scrollTop, anchorMonth, anchorOffset }，跨视图切回时恢复
let _scheduleSessionEntered = false; // 本次页面会话是否已进入过日程视图（仅首次进入自动跳今天）

// 计算日程视图日期块吸顶位置：使其在滚动时常驻滚动容器视口的垂直中部。
// sticky 的 top 百分比相对包含块（整张卡片）解析，无法直接写 50%，故由 JS 换算成像素
// 写入 CSS 变量 --schedule-date-sticky-top（.schedule-date-block 消费）。
function updateScheduleDateStickyTop() {
    const scrollContainer = document.querySelector('.schedule-container');
    if (!scrollContainer) return;
    // 优先用"今天"卡片的日期块测量（今天所在月份始终同步渲染，必然存在）
    const dateBlock = scrollContainer.querySelector('.schedule-day-drop.ring-2 .schedule-date-block')
        || scrollContainer.querySelector('.schedule-date-block');
    if (!dateBlock) return;
    const top = Math.max((scrollContainer.clientHeight - dateBlock.offsetHeight) / 2, 0);
    scrollContainer.style.setProperty('--schedule-date-sticky-top', top + 'px');
}

// 离开日程视图时记录视口锚点：视图 DOM 会被整体替换，仅靠 scrollTop 无法跨视图还原位置。
// 记录视口顶线所在月份及其相对偏移，切回后按锚点恢复，不受月份懒加载填充影响。
function captureScheduleViewport() {
    // 只认主视图容器下的真实日程 DOM；排除视图切换过渡期的 .fx-view-ghost 克隆
    const scrollContainer = document.querySelector('#view-container > .schedule-container');
    if (!scrollContainer) return null;
    const containerRect = scrollContainer.getBoundingClientRect();
    let anchorMonth = null;
    let anchorOffset = 0;
    const sections = scrollContainer.querySelectorAll('[data-schedule-month]');
    for (const sec of sections) {
        const r = sec.getBoundingClientRect();
        if (r.bottom > containerRect.top) {
            anchorMonth = sec.getAttribute('data-schedule-month');
            anchorOffset = r.top - containerRect.top;
            break;
        }
    }
    return { scrollTop: scrollContainer.scrollTop, anchorMonth, anchorOffset };
}
// 任务列表视图：filter+分组结果签名缓存，折叠/展开等纯状态变更时复用，避免全量扫描
let _taskListGroupsCache = null;
// 虚拟滚动相关状态：行级窗口化——每个分组只保留视口附近的任务行，其余用等高占位撑住滚动条。
// 旧实现以「分组」为最小渲染单位（单组可达 5000+ 行），且用空占位容器的位置判定视口，
// 导致所有分组在首次渲染时一次性填充；现改为按 scrollTop 计算窗口并增量替换。
let _taskListVirtualState = null; // { groups, useShortTime, container, scrollEl }
let _taskListVirtualIO = null; // 兼容旧调用点的 IO 引用（新链路不再创建）
let _taskListVirtualScrollEl = null; // 滚动容器引用
const TASK_LIST_WINDOW_MIN = 40;       // 每个展开分组的最小渲染行数
const TASK_LIST_WINDOW_OVERSCAN = 12;  // 视口上下各多渲染的行数（滚动迟滞，减少重建次数）
const TASK_LIST_ROW_ESTIMATE = 44;     // 初始行高估算（px），首次渲染后按实测自适应
let _taskListRowEstimate = TASK_LIST_ROW_ESTIMATE;
let _taskListScrollCleanup = null;     // 滚动/尺寸监听的清理函数
// 预构建索引：消除 buildTaskListItemHtml 内的 lists.find 线性查找
// （_tagsByIdMap/_tagsByIdSig 定义在 utils.js，供 renderTagCapsules 使用）
let _listsByIdMap = null; // Map<listId, list>
let _listsByIdSig = null; // 签名（长度+末尾ID），变化时重建

// ==================== 任务视图配置（分组依据 / 排序依据 / 排序方式） ====================
// 与看板视图配置同范式：默认值与任务视图原有行为一致（按时间状态桶分组、组内按时间升序）。
// 看板复用本文件的 getTaskListGroup / kanbanDateBucketOf 等判定；此处同样复用 kanbanView.js 的
// priorityLevelOf / kanbanCreatedBucketOf（全局函数）做优先级/创建时间分桶。
function getTaskViewConfig() {
    if (!settings.taskViewConfig || typeof settings.taskViewConfig !== 'object') {
        settings.taskViewConfig = { groupBy: 'time', sortBy: 'time', sortDir: 'asc' };
    }
    const c = settings.taskViewConfig;
    if (!c.groupBy) c.groupBy = 'time';
    if (!c.sortBy) c.sortBy = 'time';
    if (!c.sortDir) c.sortDir = 'asc';
    // 回退读取：视图配置未显式设置时，继承全局默认值（无感升级）
    if (typeof c.showCompleted !== 'boolean') c.showCompleted = settings.showCompleted !== false;
    if (!c.noDateTaskPosition) c.noDateTaskPosition = settings.noDateTaskPosition || 'last';
    if (typeof c.showFocusButton !== 'boolean') c.showFocusButton = settings.showFocusButton !== false;
    if (typeof c.showDetails !== 'boolean') c.showDetails = false;
    if (!c.groupCollapseStrategy) c.groupCollapseStrategy = 'only-completed-collapsed';
    // 「已完成任务独立分组」：true=已完成独立成组置底（原行为，默认）；false=留在原分组内并置底。
    // 旧数据无此字段时归一为 true，保证升级后行为不变。
    if (typeof c.separateCompleted !== 'boolean') c.separateCompleted = true;
    // per-list 回退链：当前清单有覆盖配置时，合并返回（不修改全局配置）
    const listPrefs = _getCurrentListViewPrefs('task');
    if (listPrefs) return Object.assign({}, c, listPrefs);
    return c;
}

// 日程视图配置（迁移自全局的可分离项）
function getScheduleConfig() {
    if (!settings.scheduleConfig || typeof settings.scheduleConfig !== 'object') {
        settings.scheduleConfig = {};
    }
    const c = settings.scheduleConfig;
    // 回退读取：视图配置未显式设置时，继承全局默认值（无感升级）
    if (typeof c.showCompleted !== 'boolean') c.showCompleted = settings.showCompleted !== false;
    // 「显示无日期任务」开关：未显式设置时，旧配置里选过「不显示」的迁移为关，其余默认开
    if (typeof c.showNoDateTasks !== 'boolean') c.showNoDateTasks = c.noDateTaskPosition !== 'none';
    if (!c.noDateTaskPosition || c.noDateTaskPosition === 'none') c.noDateTaskPosition = 'last';
    if (typeof c.showLunar !== 'boolean') c.showLunar = settings.showLunar !== false;
    if (typeof c.showFocusButton !== 'boolean') c.showFocusButton = settings.showFocusButton !== false;
    if (typeof c.showDetails !== 'boolean') c.showDetails = true; // 原行为始终显示详情，默认开启
    // per-list 回退链
    const listPrefs = _getCurrentListViewPrefs('schedule');
    if (listPrefs) return Object.assign({}, c, listPrefs);
    return c;
}

// 日程视图配置面板（右侧滑出）
_registerViewConfig('schedule', 'scheduleConfigPanel', 'schedule-config-btn');
function toggleScheduleConfig() {
    if (_viewConfigPanels.schedule && _viewConfigPanels.schedule.open) closeViewConfigPanel('schedule');
    else openScheduleConfig();
}
function openScheduleConfig() {
    const cfg = getScheduleConfig();
    const scEl = document.getElementById('sc-showcompleted');
    const sndEl = document.getElementById('sc-shownodate');
    const ndEl = document.getElementById('sc-nodatepos');
    const slEl = document.getElementById('sc-showlunar');
    const sfEl = document.getElementById('sc-showfocus');
    const sdEl = document.getElementById('sc-showdetails');
    if (scEl) scEl.checked = cfg.showCompleted !== false;
    if (sndEl) sndEl.checked = cfg.showNoDateTasks !== false;
    if (ndEl) ndEl.value = cfg.noDateTaskPosition === 'first' ? 'first' : 'last';
    updateScheduleNoDatePosVisibility();
    if (slEl) slEl.checked = cfg.showLunar !== false;
    if (sfEl) sfEl.checked = cfg.showFocusButton !== false;
    if (sdEl) sdEl.checked = cfg.showDetails !== false;
    openViewConfigPanel('schedule', (forSwitch) => {
        saveData(); // 延迟保存：变更实时预览，关闭面板时统一落盘
        if (!forSwitch) renderView(); // 切换视图场景由切换方渲染，跳过冗余渲染
    });
}
function closeScheduleConfig() {
    closeViewConfigPanel('schedule');
}
// 「显示无日期任务」关闭时隐藏「无日期任务显示位置」配置项
function updateScheduleNoDatePosVisibility() {
    const sndEl = document.getElementById('sc-shownodate');
    const wrap = document.getElementById('sc-nodatepos-wrap');
    if (sndEl && wrap) wrap.classList.toggle('hidden', !sndEl.checked);
}
function onScheduleConfigChange() {
    const target = _ensureListViewPrefs('schedule') || settings.scheduleConfig;
    const scEl = document.getElementById('sc-showcompleted');
    const sndEl = document.getElementById('sc-shownodate');
    const ndEl = document.getElementById('sc-nodatepos');
    const slEl = document.getElementById('sc-showlunar');
    const sfEl = document.getElementById('sc-showfocus');
    const sdEl = document.getElementById('sc-showdetails');
    if (scEl) target.showCompleted = scEl.checked;
    if (sndEl) target.showNoDateTasks = sndEl.checked;
    if (ndEl) target.noDateTaskPosition = ndEl.value === 'first' ? 'first' : 'last';
    updateScheduleNoDatePosVisibility();
    if (slEl) target.showLunar = slEl.checked;
    if (sfEl) target.showFocusButton = sfEl.checked;
    if (sdEl) target.showDetails = sdEl.checked;
    if (typeof invalidateRecurringGhostCache === 'function') invalidateRecurringGhostCache();
    renderView(); // 实时预览；保存延迟到面板关闭
}

// 恢复默认配置（面板内「恢复默认」按钮）
function resetScheduleViewConfig() {
    if (_resetCurrentListViewPrefs('schedule')) {
        saveData();
        renderView();
        openScheduleConfig();
        showToast('已恢复该清单的日程视图配置（继承全局）', 'success');
    } else {
        _resetViewConfigToDefault('scheduleConfig', { showCompleted: true, showNoDateTasks: true, noDateTaskPosition: 'last', showLunar: true, showFocusButton: true, showDetails: true });
        saveData();
        renderView();
        openScheduleConfig();
        showToast('已恢复日程视图默认配置', 'success');
    }
}

// 任务视图内任务排序（供各分组桶复用）。completed 始终置底（分组已先行切分，桶内基本同态，保留兼容）。
function sortTaskListTasks(arr, cfg) {
    // FR-05（C5-3）：手动排序下 sortDir 无意义，固定升序，避免用户此前选的「降序」把手工顺序整体翻转
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
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const va = getVal(a), vb = getVal(b);
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
    });
}

const TASKVIEW_TIME_LABEL = { nodate: '无日期', overdue: '已过期', today: '今天', tomorrow: '明天', dayAfterTomorrow: '后天', recent7: '最近7天', later: '更远' };
// 合入模式（separateCompleted=false）专用排序：
// 未完成在前，按「排序依据」排；已完成一律置底，且段内固定按完成时间倒序（最近完成的在最上），
// 与独立「已完成」组口径一致 —— 这样「已完成只显示前 5 条」截出来的就是最近完成的 5 条。
function sortTaskListTasksWithCompletedBottom(arr, cfg) {
    const inc = [], comp = [];
    arr.forEach(t => (t.completed ? comp : inc).push(t));
    comp.sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));
    return sortTaskListTasks(inc, cfg).concat(comp);
}
// 「无日期」桶在合入模式下的排序：未完成沿用原行为（创建时间倒序），已完成置底按完成时间倒序。
function sortNoDateTasksWithCompletedBottom(arr) {
    const inc = [], comp = [];
    arr.forEach(t => (t.completed ? comp : inc).push(t));
    inc.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    comp.sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));
    return inc.concat(comp);
}
const TASKVIEW_CREATED_LABEL = { today: '今天创建', past7: '过去7天创建', past30: '过去30天创建', earlier: '更早创建' };
const TASKVIEW_PRIORITY_DEFS = [
    { level: 'both', name: '重要且紧急' },
    { level: 'important', name: '重要' },
    { level: 'urgent', name: '紧急' },
    { level: 'none', name: '普通' }
];

// 按配置构建任务视图分组。
// 完成态归属由 cfg.separateCompleted 决定（视图配置「已完成任务独立分组」）：
// - true（默认）：已完成独立成组并置底，独立于分组依据（原行为）。
// - false（合入）：已完成不再抽离，留在其所属分组内并置底；组内已完成段固定按完成时间倒序，
//   组标题计数只统计未完成（与独立模式的计数口径一致，避免开关切换时数字跳变）。
// 分组依据：
// - groupBy='time'：沿用原有状态桶分组（与看板 kanbanDateBucketOf 同判定，忽略完成态），
//   无日期桶保持按创建时间倒序（原行为），其余桶按配置排序；默认值即与原任务视图完全一致。
// - groupBy='createdTime'：今天/过去7天/过去30天/更早（创建时间桶）。
// - groupBy='priority'：重要且紧急 / 重要 / 紧急 / 普通。
// - groupBy='tag'：每个标签一列，无标签单列（任务可同时出现在多个标签列）。
// - groupBy='custom'：与看板一致，按清单的自定义分组（list.groups + task.groupId）展示，
//   仅侧边栏选中单个清单时生效；文件夹/全部清单时降级为按清单分组。
// - groupBy='none'：单一「全部任务」列。
function _buildTaskListGroupsByConfig(cfg, filteredArg) {
    const filtered = filteredArg || filterTasks(tasks, { includeCompleted: cfg.showCompleted !== false });
    // sep=true 时 pool 只含未完成任务；sep=false 时 pool 含全部任务（完成态在组内排序时处理）
    const sep = cfg.separateCompleted !== false;
    const completed = sep ? filtered.filter(t => t.completed) : [];
    const incomplete = sep ? filtered.filter(t => !t.completed) : filtered;
    // 组内排序：独立模式沿用 sortTaskListTasks；合入模式走「未完成在前 + 已完成置底（完成时间倒序）」
    const orderTasks = (arr) => sep ? sortTaskListTasks(arr, cfg) : sortTaskListTasksWithCompletedBottom(arr, cfg);
    // 组标题计数：独立模式下 pool 全为未完成，直接取长度；合入模式需排除已完成
    const countOf = (arr) => {
        if (sep) return arr.length;
        let n = 0;
        for (let i = 0; i < arr.length; i++) if (!arr[i].completed) n++;
        return n;
    };

    let groups = [];

    if (cfg.groupBy === 'custom') {
        const list = currentListId ? getList(currentListId) : null;
        if (list && !list.isFolder) {
            // 单清单：按该清单的自定义分组展示（含空分组，与看板空列可见一致），
            // 列顺序复用看板的 list.customColumnOrder（含 'ungrouped' 末位）
            const groupById = {};
            (list.groups || []).forEach(g => { groupById[g.id] = g; });
            const order = getKanbanColumnOrder(list);
            order.forEach(token => {
                if (token === 'ungrouped') {
                    const arr = incomplete.filter(t => !t.groupId || !groupById[t.groupId]);
                    groups.push({
                        key: 'cgrp:__ungrouped__', dataGroup: 'cgrp-ungrouped', label: '默认',
                        tasks: orderTasks(arr), count: countOf(arr), isCompleted: false, overdue: false
                    });
                } else if (groupById[token]) {
                    const g = groupById[token];
                    const arr = incomplete.filter(t => t.groupId === g.id);
                    groups.push({
                        key: 'cgrp:' + g.id, dataGroup: g.id, label: g.name || '未命名分组',
                        tasks: orderTasks(arr), count: countOf(arr), isCompleted: false, overdue: false
                    });
                }
            });
        } else {
            // 文件夹/全部清单：降级为按清单分组（与看板多清单降级一致）
            _appendTaskListGroupsByList(groups, incomplete, cfg);
        }
    } else if (cfg.groupBy === 'createdTime') {
        const buckets = { today: [], past7: [], past30: [], earlier: [] };
        incomplete.forEach(t => { const g = kanbanCreatedBucketOf(t); if (buckets[g]) buckets[g].push(t); });
        ['today', 'past7', 'past30', 'earlier'].forEach(k => {
            const arr = buckets[k];
            if (arr.length) groups.push({
                key: 'cb:' + k, dataGroup: k, label: TASKVIEW_CREATED_LABEL[k],
                tasks: orderTasks(arr), count: countOf(arr), isCompleted: false, overdue: false
            });
        });
    } else if (cfg.groupBy === 'priority') {
        TASKVIEW_PRIORITY_DEFS.forEach(p => {
            const arr = incomplete.filter(t => priorityLevelOf(t) === p.level);
            if (arr.length) groups.push({
                key: 'prio:' + p.level, dataGroup: p.level, label: p.name,
                tasks: orderTasks(arr), count: countOf(arr), isCompleted: false, overdue: false
            });
        });
    } else if (cfg.groupBy === 'tag') {
        const tagDefs = settings.tags || [];
        const byTag = {};
        incomplete.forEach(t => {
            const tags = t.tags || [];
            if (tags.length === 0) {
                (byTag.__none = byTag.__none || []).push(t);
            } else {
                tags.forEach(tid => { (byTag[tid] = byTag[tid] || []).push(t); });
            }
        });
        tagDefs.forEach(def => {
            const arr = byTag[def.id];
            if (arr && arr.length) groups.push({
                key: 'tag:' + def.id, dataGroup: def.id, label: def.name,
                tasks: orderTasks(arr), count: countOf(arr), isCompleted: false, overdue: false
            });
        });
        if (byTag.__none && byTag.__none.length) groups.push({
            key: 'tag:none', dataGroup: 'none', label: '无标签',
            tasks: orderTasks(byTag.__none), count: countOf(byTag.__none), isCompleted: false, overdue: false
        });
    } else if (cfg.groupBy === 'none') {
        if (incomplete.length) groups.push({
            key: 'all', dataGroup: 'all', label: '全部任务',
            tasks: orderTasks(incomplete), count: countOf(incomplete), isCompleted: false, overdue: false
        });
    } else if (cfg.groupBy === 'list') {
        // 按所属清单分组：遍历 lists（非归档、非文件夹），收集各清单任务
        _appendTaskListGroupsByList(groups, incomplete, cfg);
    } else {
        // 默认：时间状态桶分组（与原任务视图一致）
        const buckets = { overdue: [], today: [], tomorrow: [], dayAfterTomorrow: [], recent7: [], later: [], nodate: [] };
        // 合入模式下 pool 含已完成任务，必须用忽略完成态的判定（kanbanDateBucketOf）分桶；
        // getTaskListGroup 会把已完成任务一律判为 'completed'，直接用会让它们掉出所有桶。
        incomplete.forEach(t => {
            const g = sep ? getTaskListGroup(t) : kanbanDateBucketOf(t);
            if (buckets[g]) buckets[g].push(t);
        });
        // 重复任务的未来实例：按发生日期直接归入对应日期桶（只读投影，不落库、不计入统计）
        const _batchOn = (typeof isBatchSelectActive === 'function') && isBatchSelectActive();
        if (!_batchOn && typeof getRecurringGhostMap === 'function') {
            const ghostMap = getRecurringGhostMap('task');
            Object.keys(ghostMap).forEach(dateKey => {
                ghostMap[dateKey].forEach(ghost => {
                    const g = kanbanDateBucketOf(ghost);
                    if (g !== 'nodate' && g !== 'overdue' && buckets[g]) buckets[g].push(ghost);
                });
            });
        }
        const noDateFirst = (cfg.noDateTaskPosition || 'last') === 'first';
        const order = noDateFirst
            ? ['nodate', 'overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'recent7', 'later']
            : ['overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'recent7', 'later', 'nodate'];
        order.forEach(k => {
            const arr = buckets[k];
            if (!arr.length) return;
            // 无日期桶无 startTime，时间排序无意义，沿用原行为（按创建时间倒序，合入模式下已完成置底）；
            // 其余桶按配置排序（默认 time/asc 即原行为，按 startTime 升序）。
            const sorted = k === 'nodate'
                ? (sep
                    ? arr.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                    : sortNoDateTasksWithCompletedBottom(arr))
                : orderTasks(arr);
            groups.push({
                key: k, dataGroup: k, label: TASKVIEW_TIME_LABEL[k],
                tasks: sorted, count: countOf(arr), isCompleted: false, overdue: k === 'overdue'
            });
        });
    }

    // 已完成组：按完成时间倒序（最近完成在前），独立于分组配置
    if (completed.length) {
        completed.sort((a, b) => {
            const at = a.completedAt || a.createdAt, bt = b.completedAt || b.createdAt;
            return new Date(bt) - new Date(at);
        });
        groups.push({
            key: 'completed', dataGroup: 'completed', label: '已完成',
            tasks: completed, count: completed.length, isCompleted: true, overdue: false
        });
    }

    return _finalizeTaskGroups(groups);
}

// 分组收尾（_buildTaskListGroupsByConfig / 时间窗筛选分支共用）：
// 预切分「未完成段 / 已完成段」，供渲染层做「已完成只显示前 5 条」的截断与按组展开；
// 并生成 labelHtml（已自带 labelHtml 的分组，如按天视图，保持调用方给的标题）。
function _finalizeTaskGroups(groups) {
    groups.forEach(g => {
        if (!g.isCompleted) {
            let compCount = 0;
            for (let i = 0; i < g.tasks.length; i++) if (g.tasks[i].completed) compCount++;
            g.completedCount = compCount;
            if (compCount) {
                g.incompleteTasks = g.tasks.filter(t => !t.completed);
                g.completedTasks = g.tasks.filter(t => t.completed);
            }
        } else {
            g.completedCount = g.tasks.length;
        }
        if (!g.labelHtml) {
            g.labelHtml = `${g.label}<span class="ml-1 text-xs text-theme-muted font-normal">${g.count}</span>`;
        }
    });
    return groups;
}

// 组内「本次实际渲染」的任务列表：
// - 独立「已完成」组：沿用全局「查看更多」开关（taskListCompletedShowAll），未展开只显示最近完成的 5 条；
// - 合入模式的分组：未完成全显示，已完成段默认只显示最近完成的 5 条，按组展开后全显示；
// - 其他分组：原样返回。
function _taskGroupVisibleTasks(group) {
    if (group.isCompleted) {
        return taskListCompletedShowAll ? group.tasks : group.tasks.slice(0, 5);
    }
    if (group.completedCount > 0) {
        const list = _taskGroupCompletedExpanded[group.key] ? group.completedTasks : group.completedTasks.slice(0, 5);
        return group.incompleteTasks.concat(list);
    }
    return group.tasks;
}

// 是否需要在分组底部显示「查看更多」（独立已完成组走全局展开，合入分组走按组展开）
function _taskGroupHasMoreCompleted(group) {
    if (group.isCompleted) return group.tasks.length > 5 && !taskListCompletedShowAll;
    return !!group.completedCount && group.completedCount > 5 && !_taskGroupCompletedExpanded[group.key];
}

// 分组底部展开条：独立已完成组用「查看更多」打开全量页；合入模式按组展开/收起（就地重填，不整页重渲）
function _renderTaskGroupMoreHtml(group) {
    if (group.isCompleted) {
        if (!_taskGroupHasMoreCompleted(group)) return '';
        return `<div class="py-2 px-3" data-group-more="${group.key}">
                    <button onclick="event.stopPropagation(); showCompletedTasksPage()" class="text-sm text-accent hover:text-accent-hover transition">查看更多</button>
                </div>`;
    }
    if (!group.completedCount || group.completedCount <= 5) return '';
    const expanded = !!_taskGroupCompletedExpanded[group.key];
    return `<div class="py-2 px-3" data-group-more="${group.key}">
                <button onclick="event.stopPropagation(); toggleTaskGroupCompletedExpand('${group.key}')" class="text-sm text-accent hover:text-accent-hover transition">${expanded ? '收起' : '查看更多'}</button>
            </div>`;
}

// 合入模式：展开/收起某组的已完成段落（会话内状态，不落盘）
// 就地重填该组内容与底部按钮，避免整页重渲导致滚动跳动
function toggleTaskGroupCompletedExpand(groupKey) {
    if (!_taskListVirtualState) return;
    const groups = _taskListVirtualState.groups || [];
    const group = groups.find(g => g.key === groupKey);
    if (!group) return;
    if (_taskGroupCompletedExpanded[groupKey]) delete _taskGroupCompletedExpanded[groupKey];
    else _taskGroupCompletedExpanded[groupKey] = true;

    const lazyEl = document.querySelector(`.task-list-group-lazy[data-group-key="${groupKey}"]`);
    if (lazyEl) {
        lazyEl.dataset.populated = 'false';
        _populateTaskListGroupContent(lazyEl, groups, _taskListVirtualState.useShortTime);
    }
    const contentEl = document.querySelector(`[data-task-group-content="${groupKey}"]`);
    if (contentEl) contentEl.dataset.taskCount = _taskGroupVisibleTasks(group).length;
    const moreEl = document.querySelector(`[data-group-more="${groupKey}"]`);
    if (moreEl) moreEl.outerHTML = _renderTaskGroupMoreHtml(group);
}

// 按所属清单分组（groupBy='list' 与 groupBy='custom' 的多清单降级共用）：
// 遍历 lists（非归档、非文件夹），收集各清单任务（合入模式下含已完成，置底显示）
function _appendTaskListGroupsByList(groups, incomplete, cfg) {
    const sep = cfg.separateCompleted !== false;
    (lists || []).forEach(def => {
        if (def.archived || def.isFolder) return;
        const arr = incomplete.filter(t => t.listId === def.id);
        if (arr.length) groups.push({
            key: 'list:' + def.id, dataGroup: def.id, label: def.name,
            tasks: sep ? sortTaskListTasks(arr, cfg) : sortTaskListTasksWithCompletedBottom(arr, cfg),
            count: sep ? arr.length : arr.filter(t => !t.completed).length,
            isCompleted: false, overdue: false
        });
    });
}

function getTaskListGroup(task) {
    const b = getDateBounds();

    if (task.completed) return 'completed';

    if (task.startTime) {
        const taskDate = new Date(task.startTime);

        // 跨天任务：如果当前日期在 [startTime, endTime] 范围内，显示在"今天"
        if (task.endTime) {
            const taskEndDate = new Date(task.endTime);
            const taskEndDayStart = new Date(taskEndDate.getFullYear(), taskEndDate.getMonth(), taskEndDate.getDate());
            const taskEndTomorrow = new Date(taskEndDayStart);
            taskEndTomorrow.setDate(taskEndTomorrow.getDate() + 1);
            // 当前日期在任务时间范围内 → 显示在"今天"
            if (b.now >= taskDate && b.now < taskEndTomorrow) {
                return 'today';
            }
            // 当前日期超过截止日期 → 已过期
            if (taskEndTomorrow <= b.todayStart) {
                return 'overdue';
            }
        }

        if (taskDate < b.todayStart) return 'overdue';
        if (taskDate < b.tomorrowStart) return 'today';
        if (taskDate < b.dayAfterTomorrowStart) return 'tomorrow';
        if (taskDate < b.threeDaysLaterStart) return 'dayAfterTomorrow';
        if (taskDate <= b.sevenDaysLaterEnd) return 'recent7';
        return 'later';
    }

    return 'nodate';
}

// 任务视图列表、看板、命令面板搜索、计划面板、回收站、重复任务投影共用的任务时间格式化。
// 统一口径：过期任务不能再只显示「11:23」这样的时间点，必须带出日期归属。
// - 今天：分组头/卡片头已提供日期上下文，只显示 HH:MM（含 - 结束时刻）；
// - 昨天/前天/明天/后天：相对词 + 空格 + HH:MM，如「昨天 11:23」「前天 11:23」；
// - 其余（更早的已过期、已完成旧任务、更远日期）：绝对日期 + 空格 + HH:MM，
//   如「11月5日 11:23」；日期非今年时由 fmtMD 自动带年份「2025年12月31日 11:23」；
// - 全天任务交由 getAllDayLabel：同一套相对词规则，远端用 fmtMD（可带年份）；
// - 按天分组的筛选视图（今天/明天/最近3天/最近7天）走 formatTaskListTimeShort，
//   卡片头已含日期，仍只显示 HH:MM。
// opts.withAllDayTag=false 时全天任务省略「(全天)」后缀；
// 历史参数 opts.fullDate 已移除：所有非今天任务一律带日期，调用方无需再区分场景。
// 全天任务标签：近端（今天/昨天/前天/明天/后天）用相对词并去掉"全天"，更远才显示实际日期。
// 任务视图列表、命令面板搜索、看板与详情栏统一使用本函数，保证显示一致。
function getAllDayLabel(task, withAllDayTag = true) {
    if (!task.startTime) return '';
    // 跨天全天任务：显示范围，不出现 00:00，与任务详情栏一致
    if (task.isAllDay && task.endTime && isMultiDayTask(task)) {
        return fmtMDRange(new Date(task.startTime), new Date(task.endTime)) + (withAllDayTag ? ' (全天)' : '');
    }
    const b = getDateBounds();
    const taskDate = new Date(task.startTime);
    if (taskDate >= b.todayStart && taskDate < b.tomorrowStart) return '今天';
    if (taskDate >= b.yesterdayStart && taskDate < b.todayStart) return '昨天';
    if (taskDate >= b.dayBeforeYesterdayStart && taskDate < b.yesterdayStart) return '前天';
    if (taskDate >= b.tomorrowStart && taskDate < b.dayAfterTomorrowStart) return '明天';
    if (taskDate >= b.dayAfterTomorrowStart && taskDate < b.threeDaysLaterStart) return '后天';
    // 远端全天任务：非今年由 fmtMD 带出年份；视图可去掉 (全天) 标记，仅详情栏/搜索等保留
    return fmtMD(taskDate) + (withAllDayTag ? ' (全天)' : '');
}

// 带时间任务的"结束部分"串：无结束时间返回空；同日返回 " - HH:MM"；跨天返回
// " - {相对词/M月D日} HH:MM"（相对词以当前时间为基准，非今年自动带年份），
// 供任务列表与命令面板统一追加结束时间，与象限/看板/详情栏一致。
function buildTimedEndPart(task) {
    if (!task.endTime) return '';
    const start = new Date(task.startTime);
    const end = new Date(task.endTime);
    const eTime = formatTime(end);
    if (isSameDay(start, end)) return ` - ${eTime}`;
    return ` - ${relativeDayLabelForNow(end)} ${eTime}`;
}

function formatTaskListTime(task, opts = {}) {
    if (!task.startTime) return '';
    const b = getDateBounds();
    const taskDate = new Date(task.startTime);
    const withAllDayTag = opts.withAllDayTag !== false;

    // 全天任务：近端用相对词并去掉"全天"，更远用实际日期（非今年带年份）
    if (task.isAllDay) return getAllDayLabel(task, withAllDayTag);

    const hours = taskDate.getHours().toString().padStart(2, '0');
    const mins = taskDate.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${mins}`;
    const endPart = buildTimedEndPart(task);

    // 今天的已过时刻仍只显示时刻：分组头/卡片头已提供日期上下文
    if (taskDate >= b.todayStart && taskDate < b.tomorrowStart) return timeStr + endPart;
    if (taskDate >= b.yesterdayStart && taskDate < b.todayStart) return `昨天 ${timeStr}` + endPart;
    if (taskDate >= b.dayBeforeYesterdayStart && taskDate < b.yesterdayStart) return `前天 ${timeStr}` + endPart;
    if (taskDate >= b.tomorrowStart && taskDate < b.dayAfterTomorrowStart) return `明天 ${timeStr}` + endPart;
    if (taskDate >= b.dayAfterTomorrowStart && taskDate < b.threeDaysLaterStart) return `后天 ${timeStr}` + endPart;

    // 更早的过期任务、已完成旧任务、远期任务一律带绝对日期（非今年自动带年份），
    // 不再依赖所属分组或 fullDate 开关，避免「已过期」组里只剩 11:23 丢失日期归属。
    return `${fmtMD(taskDate)} ${timeStr}` + endPart;
}

// 构建任务列表分组。返回归一化的分组数组，供 renderTaskListView 统一渲染。
// - 默认视图：按状态桶分组（已过期/今天/明天/后天/最近7天/更远/无日期/已完成）
// - 最近7天筛选视图：按天分组（未完成），已完成单独成组
// 带签名缓存：折叠/展开等纯状态变更不会改变分组结果，可直接复用缓存，避免全量 filter+分组+排序。
function buildTaskListGroups() {
    // 缓存签名：筛选上下文 + tasks/lists 引用与长度 + 影响分组的设置项 + 当天日期签名
    // + 任务视图配置（分组依据/排序依据/排序方式，变化须失效重建）
    const dateSig = getDateBounds()._sig;
    const tvc = getTaskViewConfig();
    // 自定义分组指纹：分组新增/改名/删除/顺序调整时须失效重建（仅 custom 模式依赖）
    let customGroupSig = '';
    if (tvc.groupBy === 'custom' && currentListId) {
        const l = getList(currentListId);
        if (l && !l.isFolder) {
            customGroupSig = ((l.groups || []).map(g => g.id + ':' + (g.name || '')).join(','))
                + '/' + (getKanbanColumnOrder(l).join(','));
        }
    }
    const sig = [
        currentFilter || '', currentListId || '',
        (currentTagIds || []).join(','), currentFilterId || '',
        tasks.length, lists.length, dateSig,
        shouldHideExternalTasks() ? '1' : '0',  // 离线「显示外部日历」开关变化须失效重建
        tvc.noDateTaskPosition,
        tvc.showCompleted ? '1' : '0',
        tvc.separateCompleted !== false ? '1' : '0',
        tvc.groupBy + '|' + tvc.sortBy + '|' + tvc.sortDir + '|' + tvc.groupCollapseStrategy,
        (typeof isBatchSelectActive === 'function' && isBatchSelectActive() ? '1' : '0'),
        (typeof isRecurringFutureEnabled === 'function' && isRecurringFutureEnabled('task') ? '1' : '0'),
        (typeof getRecurringRangeKey === 'function' ? getRecurringRangeKey() : ''),
        customGroupSig
    ].join('|');
    if (_taskListGroupsCache && _taskListGroupsCache.sig === sig) {
        return _taskListGroupsCache.groups;
    }

    const groups = _buildTaskListGroupsUncached();
    _taskListGroupsCache = { sig, groups };
    return groups;
}

// 失效任务列表分组缓存（数据结构性变更时调用）
function invalidateTaskListGroupsCache() {
    _taskListGroupsCache = null;
    if (typeof invalidateRecurringGhostCache === 'function') invalidateRecurringGhostCache();
}

function _buildTaskListGroupsUncached() {
    const cfg = getTaskViewConfig();
    const filtered = filterTasks(tasks, { includeCompleted: cfg.showCompleted !== false });

    // 时间窗筛选视图（今天/明天/最近3天/最近7天）：按天分组
    if (isSpecialTimeFilter()) {
        const b = getDateBounds();
        // 合入模式（separateCompleted=false）：已完成按自身日期留在当天分组内并置底；
        // 无 startTime 的已完成为历史数据，无处归日，仍落到「已完成」兜底组
        const merged = cfg.separateCompleted === false;

        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        const dayBuckets = {};
        const completedTasks = [];

        filtered.forEach(task => {
            if (task.completed && (!merged || !task.startTime)) { completedTasks.push(task); return; }
            if (!task.startTime) return;
            const d = new Date(task.startTime);
            const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const dateKey = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
            if (!dayBuckets[dateKey]) dayBuckets[dateKey] = { date: dayStart, tasks: [] };
            dayBuckets[dateKey].tasks.push(task);
        });

        // 重复任务的未来实例：投影已按当前筛选语义（含时间窗/自定义过滤器）过滤，
        // 直接归入对应日期分组；只读投影，不落库、不计入统计
        const _batchOn = (typeof isBatchSelectActive === 'function') && isBatchSelectActive();
        if (!_batchOn && typeof getRecurringGhostMap === 'function') {
            const ghostMap = getRecurringGhostMap('task');
            Object.keys(ghostMap).forEach(dateKey => {
                if (!dayBuckets[dateKey]) {
                    dayBuckets[dateKey] = { date: new Date(dateKey + 'T00:00:00'), tasks: [] };
                }
                ghostMap[dateKey].forEach(ghost => dayBuckets[dateKey].tasks.push(ghost));
            });
        }

        const groups = Object.keys(dayBuckets)
            .sort((a, b) => dayBuckets[a].date - dayBuckets[b].date)
            .map(dateKey => {
                const g = dayBuckets[dateKey];
                const date = g.date;
                const dow = weekDays[date.getDay()];
                const month = date.getMonth() + 1;
                const day = date.getDate();
                // 相对日标签仅"今天/明天/后天"显示
                let relPrefix = '';
                if (date.toDateString() === b.todayStart.toDateString()) relPrefix = '今天';
                else if (date.toDateString() === b.tomorrowStart.toDateString()) relPrefix = '明天';
                else if (date.toDateString() === b.dayAfterTomorrowStart.toDateString()) relPrefix = '后天';
                // 各段以不换行空格分隔；计数值样式与"所有任务"视图保持一致
                const _daySep = '&nbsp;&nbsp;&nbsp;';
                const titleCore = relPrefix
                    ? `${relPrefix}${_daySep}周${dow}${_daySep}${month}月${day}日`
                    : `周${dow}${_daySep}${month}月${day}日`;
                const sorted = merged
                    ? sortTaskListTasksWithCompletedBottom(g.tasks, { sortBy: 'time', sortDir: 'asc' })
                    : g.tasks.slice().sort((a, b) => {
                        if (a.completed !== b.completed) return a.completed ? 1 : -1;
                        return new Date(a.startTime) - new Date(b.startTime);
                    });
                // 合入模式下组标题只计未完成（与「所有任务」视图口径一致）
                const dayCount = merged ? sorted.filter(t => !t.completed).length : sorted.length;
                return {
                    key: `day_${dateKey}`,
                    dataGroup: date.toDateString() === b.todayStart.toDateString() ? 'today' : `day_${dateKey}`,
                    labelHtml: `${titleCore}<span class="ml-1 text-xs text-theme-muted font-normal">${dayCount}</span>`,
                    tasks: sorted,
                    isCompleted: false,
                    count: dayCount,
                    overdue: false
                };
            });

        completedTasks.sort((a, b) => {
            const aTime = a.completedAt || a.createdAt;
            const bTime = b.completedAt || b.createdAt;
            return new Date(bTime) - new Date(aTime);
        });
        if (completedTasks.length > 0) {
            groups.push({
                key: 'completed',
                dataGroup: 'completed',
                labelHtml: `已完成<span class="ml-1 text-xs text-theme-muted font-normal">${completedTasks.length}</span>`,
                tasks: completedTasks,
                isCompleted: true,
                count: completedTasks.length,
                overdue: false
            });
        }
        return _finalizeTaskGroups(groups);
    }

    // 默认视图：按任务视图配置分组（分组依据/排序依据/排序方式），默认值与原时间桶分组一致
    return _buildTaskListGroupsByConfig(getTaskViewConfig(), filtered);
}

// 按天视图使用的精简时间显示（仅 HH:MM / 相对词），全天任务沿用 getAllDayLabel 的相对词规则
function formatTaskListTimeShort(task) {
    if (!task.startTime) return '';
    if (task.isAllDay) return getAllDayLabel(task, false);
    const taskDate = new Date(task.startTime);
    const hours = taskDate.getHours().toString().padStart(2, '0');
    const mins = taskDate.getMinutes().toString().padStart(2, '0');
    return `${hours}:${mins}` + buildTimedEndPart(task);
}

// 预构建 listsById Map，消除 buildTaskListItemHtml 内 lists.find 的 O(N×L) 线性查找
function _getListsByIdMap() {
    // 签名：长度 + 末尾清单ID，捕获 push/splice/filter 等原地修改与重新赋值
    const last = lists.length > 0 ? lists[lists.length - 1].id : '';
    const sig = lists.length + '|' + last;
    if (_listsByIdMap && _listsByIdSig === sig) return _listsByIdMap;
    const m = new Map();
    for (let i = 0; i < lists.length; i++) m.set(lists[i].id, lists[i]);
    _listsByIdMap = m;
    _listsByIdSig = sig;
    return m;
}

// 构建单个任务卡片 HTML（抽出供统一渲染复用）
function buildTaskListItemHtml(task, useShortTime, opts) {
    if (task && task._projected && typeof renderRecurringGhostTaskListHtml === 'function') {
        return renderRecurringGhostTaskListHtml(task, useShortTime);
    }
    const list = _getListsByIdMap().get(task.listId);
    const listColor = list ? list.color : '#9ca3af';
    const listName = list ? list.name : '';
    // 外部订阅任务视觉标识（3.3.1）：色条改用订阅色，标题前加日历图标（复用 utils.js 共享工具）
    const barColor = _extTaskBarColor(task, listColor);
    const extIcon = _extTaskIconHtml(task);
    const focusMinutes = getTaskFocusMinutes(task.id);
    const timeDisplay = useShortTime ? formatTaskListTimeShort(task) : formatTaskListTime(task, { withAllDayTag: false });
    const progress = task.progress || 0;
    const quadColors = getQuadrantColorClass(task);
    const isOverdue = isTaskOverdue(task);
    const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary';
    const tagCapsules = renderTagCapsules(task, 2, 'right');
    // 显示任务详情（备注/子任务）：由任务视图配置 showDetails 控制
    // 备注/描述与子任务的行数分配见 renderTaskDetailsBlock（方案 C：描述 4-n 行 + 子任务 n 条）
    const tvcShowDetails = getTaskViewConfig().showDetails;
    let taskDetailsLine = '';
    if (tvcShowDetails) {
        taskDetailsLine = renderTaskDetailsBlock(task);
    }

    // FR-03 多选态：行点击切换为「选中」语义（V3-5），完成勾选框替换为选择指示器，
    // 隐藏专注按钮避免误触；选中行高亮由 batch-select-mode CSS 控制（batchSelect.js）
    const batchMode = (typeof isBatchSelectActive === 'function') && isBatchSelectActive();
    const rowOnclick = batchMode
        ? `event.stopPropagation(); onBatchTaskRowClick(event, '${task.id}')`
        : `event.stopPropagation(); openTaskDetailPanel('${task.id}', false, true)`;
    const leftControl = batchMode
        ? renderBatchSelectIndicator(task)
        : renderTaskCheckbox(task, { taskId: task.id, extraClass: 'flex-shrink-0' });
    return `
        <div class="task-list-item task-row relative flex items-center gap-3 py-2.5 px-3 rounded-r-lg ${quadColors.bg} hover:opacity-85 transition cursor-pointer group ${task.completed ? 'opacity-55' : ''}"
             data-list-id="${task.listId || 'default'}"
             data-task-id="${task.id}"
             onclick="${rowOnclick}"
             >
            <div class="task-list-color-bar" style="background-color: ${getTaskBarColor(task, barColor)};"></div>
            ${leftControl}
            <div class="flex-1 min-w-0 flex flex-col">
                <span class="${tvcShowDetails ? 'font-medium' : 'text-sm'} ${task.completed ? 'text-theme-secondary' : 'text-theme-primary'} truncate min-w-0 flex items-center">${extIcon}${task.title || '新任务'}</span>
                ${taskDetailsLine ? `<div>${taskDetailsLine}</div>` : ''}
            </div>
            ${batchMode ? '' : renderFocusButton(task.id, getTaskViewConfig().showFocusButton)}
            <div class="flex items-center gap-2 flex-shrink-0 text-xs text-theme-primary whitespace-nowrap">
                ${(typeof renderAttachmentBadge === 'function') ? renderAttachmentBadge(task) : ''}
                ${tagCapsules}
                ${progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-accent-light"></i>${progress}%</span>` : ''}
                ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-400"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                ${listName ? `<span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background-color: ${listColor}"></span><span class="hidden sm:inline">${listName}</span></span>` : ''}
                ${typeof renderRecurringTaskBadge === 'function' ? renderRecurringTaskBadge(task) : ''}
            </div>
            ${timeDisplay ? `<span class="flex-shrink-0 text-xs ${timeTextClass} whitespace-nowrap" style="min-width: 50px; text-align: right;"><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
        </div>
    `;
}

// ==================== 任务视图配置面板（统一框架：utils.js _registerViewConfig） ====================
_registerViewConfig('task', 'taskConfigPanel', 'task-config-btn');

function toggleTaskConfig() {
    if (_viewConfigPanels.task && _viewConfigPanels.task.open) closeViewConfigPanel('task');
    else openTaskConfig();
}

function openTaskConfig() {
    const cfg = getTaskViewConfig();
    const g = document.getElementById('tc-groupby');
    const sb = document.getElementById('tc-sortby');
    const sdAsc = document.getElementById('tc-sortdir-asc');
    const sdDesc = document.getElementById('tc-sortdir-desc');
    const sc = document.getElementById('tc-showcompleted');
    const sep = document.getElementById('tc-separatecompleted');
    const ndp = document.getElementById('tc-nodatepos');
    const sf = document.getElementById('tc-showfocus');
    const sd = document.getElementById('tc-showdetails');
    const col = document.getElementById('tc-collapse');
    if (g) g.value = cfg.groupBy;
    if (sb) sb.value = cfg.sortBy;
    if (sdAsc) sdAsc.checked = cfg.sortDir !== 'desc';
    if (sdDesc) sdDesc.checked = cfg.sortDir === 'desc';
    if (sc) sc.checked = cfg.showCompleted !== false;
    if (sep) sep.checked = cfg.separateCompleted !== false;
    if (ndp) ndp.value = cfg.noDateTaskPosition === 'first' ? 'first' : 'last'; // tc-nodatepos 仅 first|last，'none' 等异常值归一为 last
    if (sf) sf.checked = cfg.showFocusButton !== false;
    if (sd) sd.checked = cfg.showDetails === true;
    if (col) col.value = cfg.groupCollapseStrategy || 'only-completed-collapsed';
    updateTaskGroupConfigEntry();
    updateTaskSeparateCompletedVisibility();
    openViewConfigPanel('task', (forSwitch) => {
        if (typeof _kanbanGroupConfigOpen !== 'undefined' && _kanbanGroupConfigOpen) closeKanbanGroupConfig(); // 子面板打开时先关子面板，避免成孤儿
        saveData(); // 延迟保存：变更实时预览，关闭面板时统一落盘
        if (!forSwitch) renderView(); // 切换视图场景由切换方渲染，跳过冗余渲染
    });
}

// 「显示已完成任务」关闭时隐藏「已完成任务独立分组」——看不到已完成，摆放规则无从设置
// （与日程视图「显示无日期任务」→「显示位置」的联动同范式）
function updateTaskSeparateCompletedVisibility() {
    const scEl = document.getElementById('tc-showcompleted');
    const wrap = document.getElementById('tc-separatecompleted-wrap');
    // 用 style.display 而非 .hidden：该行本身带 flex，避免 hidden 与 flex 的优先顺序冲突
    if (scEl && wrap) wrap.style.display = scEl.checked ? '' : 'none';
}

// 「分组配置」入口显隐：仅分组依据=自定义且侧边栏选中单个清单时显示（与看板入口条件一致）
function updateTaskGroupConfigEntry() {
    const cfg = getTaskViewConfig();
    const list = currentListId ? getList(currentListId) : null;
    const entry = document.getElementById('tc-groupconfig-entry');
    if (entry) entry.classList.toggle('hidden', !(cfg.groupBy === 'custom' && list && !list.isFolder));
}

function closeTaskConfig() {
    closeViewConfigPanel('task');
}

// 恢复默认配置（面板内「恢复默认」按钮）
function resetTaskViewConfig() {
    if (_resetCurrentListViewPrefs('task')) {
        saveData();
        renderView();
        openTaskConfig();
        showToast('已恢复该清单的任务视图配置（继承全局）', 'success');
    } else {
        _resetViewConfigToDefault('taskViewConfig', { showCompleted: true, separateCompleted: true, noDateTaskPosition: 'last', showFocusButton: true });
        saveData();
        renderView();
        openTaskConfig();
        showToast('已恢复任务视图默认配置', 'success');
    }
}

// 控件变更：实时写入配置并预览（延迟保存：关闭面板时统一落盘）
function onTaskConfigChange() {
    const target = _ensureListViewPrefs('task') || settings.taskViewConfig;
    const g = document.getElementById('tc-groupby');
    const sb = document.getElementById('tc-sortby');
    const sdDesc = document.getElementById('tc-sortdir-desc');
    const sc = document.getElementById('tc-showcompleted');
    const sep = document.getElementById('tc-separatecompleted');
    const ndp = document.getElementById('tc-nodatepos');
    const sf = document.getElementById('tc-showfocus');
    const sd = document.getElementById('tc-showdetails');
    const col = document.getElementById('tc-collapse');
    if (g) target.groupBy = g.value;
    if (sb) target.sortBy = sb.value;
    if (sdDesc) target.sortDir = sdDesc.checked ? 'desc' : 'asc';
    if (sc) target.showCompleted = sc.checked;
    if (sep) target.separateCompleted = sep.checked;
    if (ndp) target.noDateTaskPosition = ndp.value;
    if (sf) target.showFocusButton = sf.checked;
    if (sd) target.showDetails = sd.checked;
    if (col) target.groupCollapseStrategy = col.value;
    if (typeof invalidateRecurringGhostCache === 'function') invalidateRecurringGhostCache();
    updateTaskGroupConfigEntry();
    updateTaskSeparateCompletedVisibility();
    renderView();
}

// 初始化分组折叠状态（per-list）：按策略设置默认值并同步到内存缓存
function _initTaskListGroupCollapse(strat, listKey) {
    // 折叠策略重算意味着筛选/分组依据/清单都换了，先前按组展开的已完成段落一起作废
    _taskGroupCompletedExpanded = {};
    if (strat === 'all-expanded') {
        taskListGroupCollapsed = {};
    } else if (strat === 'all-collapsed') {
        taskListGroupCollapsed = { __pendingAllCollapsed: true };
    } else {
        // only-completed-collapsed（默认）：仅折叠"已完成"组
        taskListGroupCollapsed = { completed: true };
    }
    _taskListGroupCollapsedByList[listKey] = taskListGroupCollapsed;
}
// 从 localStorage 读取指定清单的折叠态（null = 无保存）
function _loadGroupCollapseFromStorage(listKey) {
    try {
        const all = JSON.parse(localStorage.getItem(GROUP_COLLAPSE_KEY) || '{}');
        return all[listKey] || null;
    } catch (e) { return null; }
}
// 防抖写入折叠态到 localStorage（500ms 内多次修改只写一次）
function _scheduleGroupCollapseSave(listKey) {
    if (_groupCollapseSaveTimer) clearTimeout(_groupCollapseSaveTimer);
    _groupCollapseSaveTimer = setTimeout(function () {
        try {
            const all = JSON.parse(localStorage.getItem(GROUP_COLLAPSE_KEY) || '{}');
            all[listKey] = taskListGroupCollapsed;
            localStorage.setItem(GROUP_COLLAPSE_KEY, JSON.stringify(all));
        } catch (e) { /* 忽略 quota 错误 */ }
    }, 500);
}

function renderTaskListView(container) {
    // 筛选上下文 / 分组依据 / 折叠策略变化时重置分组折叠状态
    const tvc = getTaskViewConfig();
    const strat = tvc.groupCollapseStrategy || 'only-completed-collapsed';
    const listKey = currentListId || '__all__';
    // per-list 折叠态隔离：清单切换时保存旧清单折叠态，恢复新清单折叠态
    if (_lastCollapseListKey !== listKey) {
        if (_lastCollapseListKey) {
            _taskListGroupCollapsedByList[_lastCollapseListKey] = taskListGroupCollapsed;
        }
        const saved = _taskListGroupCollapsedByList[listKey] || _loadGroupCollapseFromStorage(listKey);
        if (saved) {
            taskListGroupCollapsed = saved;
            _taskListGroupCollapsedByList[listKey] = saved;
        } else {
            _initTaskListGroupCollapse(strat, listKey);
        }
        _lastCollapseListKey = listKey;
        _lastTaskListFilterSig = null; // 强制重置签名，避免下方重复初始化
    }
    // filterSig 不含 currentListId（已通过 listKey 隔离折叠态）
    const filterSig = (currentFilter || '') + '|' + (currentTagIds || []).join(',') + '|' + (currentFilterId || '') + '|' + tvc.groupBy + '|' + strat;
    if (filterSig !== _lastTaskListFilterSig) {
        _initTaskListGroupCollapse(strat, listKey);
        _lastTaskListFilterSig = filterSig;
    }

    const groups = buildTaskListGroups();
    // all-collapsed：分组构建后把所有分组标记为折叠
    if (taskListGroupCollapsed.__pendingAllCollapsed) {
        const m = {};
        groups.forEach(g => { m[g.key] = true; });
        taskListGroupCollapsed = m;
    }
    // 按天分组视图：任务时间只显示 HH:MM，避免与分组标题中的日期重复
    const useShortTime = isSpecialTimeFilter();
    // 多选态：分组标题前加整组选择指示器（batchSelect.js）
    const batchMode = (typeof isBatchSelectActive === 'function') && isBatchSelectActive();

    if (groups.length === 0) {
        _teardownTaskListVirtualScroll();
        // 空态快捷键提示：键位从 commandPalette.js 的注册表派生（用户自定义过也跟随），
        // 避免与帮助浮层 / 设置面板里的键位对不上。取不到才回落到写死的默认串。
        const _scHint = (actionKey, fallback) => {
            if (typeof getShortcutCombo === 'function' && typeof formatShortcut === 'function') {
                const combo = getShortcutCombo(actionKey);
                if (combo && combo.key) return formatShortcut(combo).replace(/\+/g, ' + ');
            }
            return fallback;
        };
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-16 text-theme-muted">
                <i class="fas fa-clipboard-list text-6xl mb-4 opacity-30"></i>
                <p class="text-lg text-theme-primary">欢迎使用TackList日程管理！</p>
                <div class="flex flex-wrap items-center justify-center gap-3 mt-6">
                    <button onclick="openAddTaskModal()" class="px-4 py-2 rounded-lg border-2 border-purple-500 text-purple-500 hover:bg-purple-500 hover:text-white transition text-sm font-medium">＋ 添加第一个任务</button>
                    <button onclick="openTaskTemplatePicker()" class="px-4 py-2 rounded-lg border border-purple-500 text-purple-500 hover:bg-purple-500 hover:text-white transition text-sm font-medium"><i class="fas fa-layer-group mr-1"></i>从模板开始</button>
                    <button onclick="openCommandPalette()" class="px-4 py-2 rounded-lg border border-theme text-theme-secondary hover:bg-theme-tertiary hover:text-theme-primary transition text-sm">命令面板快速添加</button>
                    <button onclick="event.stopPropagation(); showAddListInput()" class="px-4 py-2 rounded-lg border border-theme text-theme-secondary hover:bg-theme-tertiary hover:text-theme-primary transition text-sm">新建清单</button>
                    <button onclick="if (typeof startOnboarding === 'function') startOnboarding(true)" class="px-4 py-2 rounded-lg border border-theme text-theme-secondary hover:bg-theme-tertiary hover:text-theme-primary transition text-sm">重看新手引导</button>
                </div>
                <p class="text-xs mt-5">${_scHint('newTask', 'Ctrl + Alt + K')} 新建任务，${_scHint('commandPalette', 'Ctrl + Alt + N')} 打开命令面板；也可输入 * 调用模板。</p>
            </div>
        `;
        updateToggleAllGroupsButton(groups);
        return;
    }

    let html = '<div class="task-list-view" style="height: 100%; overflow-y: auto; overflow-x: hidden; padding-bottom: 40px;">';
    html += '<div class="bg-theme-secondary rounded-xl shadow-theme p-4">';

    groups.forEach(group => {
        const isCollapsed = !!taskListGroupCollapsed[group.key];
        // 已完成段落截断：独立「已完成」组走全局开关；合入模式的分组按组展开（见 _taskGroupVisibleTasks）
        const visibleTasks = _taskGroupVisibleTasks(group);

        html += `
            <div class="mb-3 last:mb-0" data-task-group="${group.dataGroup}">
                <div class="flex items-center justify-between mb-2 cursor-pointer select-none task-list-group-header"
                     onclick="toggleTaskListGroup('${group.key}')">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'} w-3 text-center text-xs text-theme-muted mr-1"></i>
                        ${batchMode ? renderBatchGroupIndicator(group.key) : ''}
                        <h3 class="text-base font-semibold ${group.overdue ? 'text-red-500' : 'text-theme-primary'}">${group.labelHtml}</h3>
                    </div>
                </div>
                <div class="fx-collapse ${isCollapsed ? 'hidden fx-collapsed' : ''}" data-task-group-content="${group.key}" data-group-key="${group.key}" data-task-count="${visibleTasks.length}">
                    <div class="fx-collapse-inner">
        `;

        // 折叠分组跳过 HTML 构建（Lazy Rendering）：折叠态不构建任务项 HTML，
        // 仅保留容器占位；展开时由 _syncTaskListWindows 局部注入，避免全量重渲染。
        if (!isCollapsed) {
            // 行级窗口化：占位高度按「总行数 × 行高」撑住滚动条与后续分组的几何位置，
            // 这样未填充分组不会再因空容器（56px）全部落进视口而被一次性填充。
            const total = visibleTasks.length;
            html += `<div class="task-list-group-lazy" data-group-key="${group.key}" data-populated="false" data-total="${total}" data-window-start="-1" data-window-end="-1" style="min-height:${Math.round(total * _taskListRowEstimate)}px"></div>`;
        }

        // 组底「查看更多/收起」：独立已完成组 → 全量页；合入分组 → 就地按组展开（见 _renderTaskGroupMoreHtml）
        html += _renderTaskGroupMoreHtml(group);
        html += `
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div></div>';

    html += '</div>';

    // 保存旧滚动位置（自动刷新等重渲染场景），避免跳回顶部
    const prevScrollView = container.querySelector('.task-list-view');
    const savedScrollTop = prevScrollView ? prevScrollView.scrollTop : 0;

    container.innerHTML = html;

    // 同步恢复滚动位置，实现自动刷新无感
    const newScrollView = container.querySelector('.task-list-view');
    if (newScrollView && savedScrollTop > 0) {
        newScrollView.scrollTop = savedScrollTop;
    }

    // 启动虚拟滚动：立即填充视口附近分组，远端分组懒加载
    _setupTaskListVirtualScroll(container, groups, useShortTime);

    // 计划面板共享折叠态：筛选/清单切换会重置折叠策略，同步计划面板避免两侧不一致
    if (typeof syncPlanPanelGroupCollapse === 'function') syncPlanPanelGroupCollapse();

    updateToggleAllGroupsButton(groups);
}

// ==================== 行级窗口化渲染 ====================
// 旧实现按「分组」整体注入 HTML：单个「更远」分组可达 5000+ 行，一次勾选完成触发
// 全量 renderView 就要重建 5000+ 行 / 9 万 DOM 节点，主线程被占满数秒。
// 现在每个分组只保留 [start,end) 区间的真实行，前后用等高占位撑住总高度，
// 滚动时按 scrollTop 重算窗口并增量替换；离屏分组释放行 DOM，仅留占位。
function _renderTaskListGroupWindow(lazyEl, group, start, end, useShortTime) {
    const visibleTasks = _taskGroupVisibleTasks(group);
    const total = visibleTasks.length;
    start = Math.max(0, Math.min(start, total));
    end = Math.max(start, Math.min(end, total));
    let inner = '';
    for (let i = start; i < end; i++) {
        inner += buildTaskListItemHtml(visibleTasks[i], useShortTime, { taskList: true });
    }
    lazyEl.dataset.total = String(total);
    lazyEl.dataset.populated = 'true';
    lazyEl.dataset.windowStart = String(start);
    lazyEl.dataset.windowEnd = String(end);
    lazyEl.style.minHeight = '0px';
    lazyEl.innerHTML =
        `<div class="tl-window-top" style="height:${Math.round(start * _taskListRowEstimate)}px"></div>` +
        `<div class="tl-window-rows">${inner}</div>` +
        `<div class="tl-window-bottom" style="height:${Math.round((total - end) * _taskListRowEstimate)}px"></div>`;
    // 用实测行高校正估算值（showDetails / 子任务预览会让行变高），随后同步修正占位高度
    if (end > start) {
        const rowsEl = lazyEl.querySelector('.tl-window-rows');
        const measured = rowsEl ? rowsEl.getBoundingClientRect().height / (end - start) : 0;
        if (measured >= 28 && measured <= 160) {
            _taskListRowEstimate = Math.round((_taskListRowEstimate * 0.7 + measured * 0.3) * 10) / 10;
            const topEl = lazyEl.querySelector('.tl-window-top');
            const bottomEl = lazyEl.querySelector('.tl-window-bottom');
            if (topEl) topEl.style.height = Math.round(start * _taskListRowEstimate) + 'px';
            if (bottomEl) bottomEl.style.height = Math.round((total - end) * _taskListRowEstimate) + 'px';
        }
    }
    // 多选态：新注入的行是「未选中」骨架，按当前选中集补上 .batch-selected（含分组指示器三态）
    if (typeof isBatchSelectActive === 'function' && isBatchSelectActive()
        && typeof _refreshBatchSelectionDom === 'function') {
        _refreshBatchSelectionDom();
    }
}

function _releaseTaskListGroupWindow(lazyEl) {
    const total = Number(lazyEl.dataset.total || 0);
    lazyEl.dataset.populated = 'false';
    lazyEl.dataset.windowStart = '-1';
    lazyEl.dataset.windowEnd = '-1';
    lazyEl.style.minHeight = Math.round(total * _taskListRowEstimate) + 'px';
    lazyEl.innerHTML = '';
}

// 未填充分组的占位高度必须与「当前行高估算」一致：首帧用 44px 撑开，实测校正到 42px 后
// 若不回写，5000 行分组会差上万像素，填充瞬间滚动条跳动、深滚动时窗口索引也会偏移。
function _normalizeTaskListPlaceholders(lazyEls) {
    for (const el of lazyEls) {
        if (el.dataset.populated === 'true') continue;
        const total = Number(el.dataset.total || 0);
        el.style.minHeight = Math.round(total * _taskListRowEstimate) + 'px';
    }
}

// 按当前滚动位置同步所有分组的渲染窗口；force=true 时强制按最新分组数据重绘（局部更新用）
function _syncTaskListWindows(force) {
    const st = _taskListVirtualState;
    if (!st || !st.scrollEl || !st.container || !st.scrollEl.isConnected) return;
    const scrollEl = st.scrollEl;
    const sTop = scrollEl.scrollTop;
    const viewH = scrollEl.clientHeight || 600;
    const est = _taskListRowEstimate;
    const viewTop = sTop - TASK_LIST_WINDOW_OVERSCAN * est;
    const viewBottom = sTop + viewH + TASK_LIST_WINDOW_OVERSCAN * est;
    const sRect = scrollEl.getBoundingClientRect();
    const lazyEls = st.container.querySelectorAll('.task-list-group-lazy');
    _normalizeTaskListPlaceholders(lazyEls);
    for (const el of lazyEls) {
        // 折叠分组的容器高度为 0，几何计算会失真；释放行 DOM，展开时由 _populateTaskListGroupContent 重建
        const contentEl = el.closest('[data-task-group-content]');
        if (!contentEl || contentEl.classList.contains('hidden')) {
            if (el.dataset.populated === 'true') _releaseTaskListGroupWindow(el);
            continue;
        }
        const group = st.groups.find(g => g.key === el.dataset.groupKey);
        if (!group) continue;
        const total = Number(el.dataset.total || 0);
        const r = el.getBoundingClientRect();
        const groupTop = r.top - sRect.top + sTop;
        const groupBottom = groupTop + Math.max(total * est, r.height);
        if (total === 0) {
            if (force && el.dataset.populated === 'true') _renderTaskListGroupWindow(el, group, 0, 0, st.useShortTime);
            continue;
        }
        if (groupBottom < viewTop - est || groupTop > viewBottom + est) {
            // 完全离屏：释放行 DOM，仅留等高占位，避免 DOM 随滚动无限累积
            if (el.dataset.populated === 'true') _releaseTaskListGroupWindow(el);
            continue;
        }
        let dStart = Math.max(0, Math.floor((viewTop - groupTop) / est));
        let dEnd = Math.min(total, Math.ceil((viewBottom - groupTop) / est));
        let start = Math.max(0, Math.min(dStart - TASK_LIST_WINDOW_OVERSCAN, Math.max(0, total - TASK_LIST_WINDOW_MIN)));
        let end = Math.min(total, Math.max(dEnd + TASK_LIST_WINDOW_OVERSCAN, start + TASK_LIST_WINDOW_MIN));
        const curStart = Number(el.dataset.windowStart);
        const curEnd = Number(el.dataset.windowEnd);
        // 当前窗口已覆盖目标窗口时跳过重建（迟滞），避免每滚动一像素就重排 DOM
        if (!force && el.dataset.populated === 'true' && curStart <= start && curEnd >= end) continue;
        _renderTaskListGroupWindow(el, group, start, end, st.useShortTime);
    }
    // 本轮渲染可能校正了行高估算，收尾时把仍未填充分组的占位同步到最新值
    _normalizeTaskListPlaceholders(lazyEls);
}

// 兼容入口：展开分组 / 就地展开已完成段等旧调用点仍走这里，统一交给窗口同步
function _populateTaskListGroupContent(lazyEl, groups, useShortTime) {
    if (!lazyEl || lazyEl.dataset.populated === 'true') return;
    const group = (groups || []).find(g => g.key === lazyEl.dataset.groupKey);
    if (!group) return;
    const total = _taskGroupVisibleTasks(group).length;
    lazyEl.dataset.total = String(total);
    lazyEl.dataset.windowStart = '-1';
    lazyEl.dataset.windowEnd = '-1';
    lazyEl.style.minHeight = Math.round(total * _taskListRowEstimate) + 'px';
    if (_taskListVirtualState && _taskListVirtualState.scrollEl) {
        _syncTaskListWindows(true);
    } else {
        _renderTaskListGroupWindow(lazyEl, group, 0, Math.min(total, TASK_LIST_WINDOW_MIN), useShortTime);
    }
}

// 绑定滚动/尺寸监听，首帧同步一次窗口
function _setupTaskListVirtualScroll(container, groups, useShortTime) {
    const scrollEl = container.querySelector('.task-list-view');
    if (!scrollEl) return;
    _teardownTaskListVirtualScroll();
    _taskListVirtualScrollEl = scrollEl;
    _taskListVirtualState = { groups, useShortTime, container, scrollEl };
    let raf = 0;
    const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; _syncTaskListWindows(false); });
    };
    const onResize = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { raf = 0; _syncTaskListWindows(true); });
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    _taskListScrollCleanup = () => {
        scrollEl.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
    };
    _syncTaskListWindows(true);
}

// 销毁虚拟滚动资源（视图切换/空态/重渲染前调用）
function _teardownTaskListVirtualScroll() {
    if (_taskListVirtualIO) {
        _taskListVirtualIO.disconnect();
        _taskListVirtualIO = null;
    }
    if (_taskListScrollCleanup) {
        _taskListScrollCleanup();
        _taskListScrollCleanup = null;
    }
    _taskListVirtualScrollEl = null;
    _taskListVirtualState = null;
}

// 勾选任务后局部更新：仅刷新该任务项的 DOM（复选框/透明度/时间样式），
// 避免全量 renderView 导致虚拟滚动重置与滚动跳动。
// 返回 true 表示已局部处理；false 表示需调用方全量渲染（任务跨分组移动等结构性变更）。
// 注意：完成态切换通常会让任务跨分组移动（→已完成 / ←原分组），属结构性变更，直接返回 false。
// 仅当任务完成后仍留在原分组（如"无日期"分组的任务被勾选，仍在该分组内排序变化）时才局部更新。
function refreshTaskListItemForToggle(taskId) {
    if (currentView !== 'task' || currentListId === '__archived__') return false;
    if (!_taskListVirtualState) return false;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;

    // 时间窗筛选视图（今天/明天/最近3天/最近7天）：完成态切换必然跨分组（→已完成），走全量渲染
    if (isSpecialTimeFilter()) {
        invalidateTaskListGroupsCache();
        return false;
    }

    // 设置了隐藏已完成任务时，勾选完成会让任务从列表消失，属结构性变更，走全量渲染
    if (!getTaskViewConfig().showCompleted && task.completed) {
        invalidateTaskListGroupsCache();
        return false;
    }

    // 合入模式（已完成不独立成组）：勾选完成会让任务在本组内从「未完成段」掉到「已完成段」，
    // 顺序与「已完成前 5 条」的截断都可能变化，局部替换不安全，走全量渲染
    if (getTaskViewConfig().separateCompleted === false) {
        invalidateTaskListGroupsCache();
        return false;
    }

    // 重复任务的完成态变化会改变「后续 N 次」投影，局部替换无法同步隐藏的 ghost 区，走全量渲染
    if (task.repeat && task.repeat.type) {
        invalidateTaskListGroupsCache();
        return false;
    }

    const newGroupKey = getTaskListGroup(task);

    // 在当前 DOM 中查找该任务项
    const itemEl = document.querySelector(`.task-list-item[onclick*="${taskId}"]`);
    if (!itemEl) return false; // 不在可见 DOM 中（可能在未填充的懒加载分组）

    // 若任务分组发生变化，局部更新不安全，交由全量渲染
    const parentContent = itemEl.closest('[data-task-group-content]');
    if (!parentContent) return false;
    const currentGroupKey = parentContent.dataset.groupKey;
    if (currentGroupKey !== newGroupKey) {
        // 分组变化：失效缓存并全量渲染
        invalidateTaskListGroupsCache();
        return false;
    }

    // 局部重建该任务项 HTML 并替换
    const useShortTime = _taskListVirtualState.useShortTime;
    const newHtml = buildTaskListItemHtml(task, useShortTime, { taskList: true });
    const tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    const newItem = tmp.firstElementChild;
    if (newItem && itemEl.parentNode) {
        itemEl.parentNode.replaceChild(newItem, itemEl);
        return true;
    }
    return false;
}

/**
 * 勾选完成 / 取消完成后的「增量刷新」（不整页重建）。
 * 只在任务视图可用；跨分组移动、已完成段截断、分组计数、查看更多按钮都由分组数据统一重算，
 * 再强制同步一次窗口（每个分组只重绘数十行）。不满足条件时返回 false，由调用方回退 renderView。
 * 与 refreshTaskListItemForToggle 的区别：后者只处理「任务仍在原分组且行在 DOM 中」的窄场景，
 * 本函数覆盖最常见的「完成 → 移入已完成组 / 取消完成 → 回到时间桶」。
 */
function applyTaskToggleIncremental(taskId) {
    if (currentView !== 'task' || currentListId === '__archived__') return false;
    const st = _taskListVirtualState;
    if (!st || !st.scrollEl || !st.container || !st.scrollEl.isConnected) return false;
    const task = tasks.find(t => t.id === taskId);
    // 投影出来的重复任务实例不在 tasks 中，结构性变更（重复任务派生）也不走增量
    if (!task || task._projected || (task.repeat && task.repeat.type)) return false;
    if (typeof isBatchSelectActive === 'function' && isBatchSelectActive()) return false;

    // 1) 失效分组缓存并按最新任务状态重建分组，窗口状态随后指向新数据
    invalidateTaskListGroupsCache();
    const groups = buildTaskListGroups();
    st.groups = groups;

    // 2) 塌陷动画结束后清掉旧行（动画期间它可能已被设为 0 高），避免局部重绘把它恢复成正常高度
    const oldRow = st.container.querySelector(`.task-list-item[data-task-id="${taskId}"]`);
    if (oldRow && oldRow.parentNode) oldRow.parentNode.removeChild(oldRow);

    // 3) 同步分组标题计数 / 占位总行数 / 「查看更多」按钮
    for (const g of groups) {
        const contentEl = st.container.querySelector(`[data-task-group-content="${g.key}"]`);
        if (!contentEl) continue;
        const visible = _taskGroupVisibleTasks(g);
        contentEl.dataset.taskCount = String(visible.length);
        const groupEl = contentEl.closest('[data-task-group]');
        if (groupEl) {
            const h3 = groupEl.querySelector('.task-list-group-header h3');
            if (h3) h3.innerHTML = g.labelHtml;
        }
        const innerEl = contentEl.querySelector('.fx-collapse-inner');
        const moreEl = contentEl.querySelector('[data-group-more]');
        const moreHtml = _renderTaskGroupMoreHtml(g);
        if (moreHtml) {
            if (moreEl) moreEl.outerHTML = moreHtml;
            else if (innerEl) innerEl.insertAdjacentHTML('beforeend', moreHtml);
        } else if (moreEl) {
            moreEl.remove();
        }
        const lazyEl = contentEl.querySelector('.task-list-group-lazy');
        if (lazyEl) {
            lazyEl.dataset.total = String(visible.length);
            if (lazyEl.dataset.populated !== 'true') {
                lazyEl.style.minHeight = Math.round(visible.length * _taskListRowEstimate) + 'px';
            }
        }
    }

    // 4) 按新分组数据强制重绘可见窗口（离屏分组顺带释放行 DOM）
    _syncTaskListWindows(true);
    if (typeof updatePostponeButton === 'function') updatePostponeButton();
    if (typeof updateToggleAllGroupsButton === 'function') updateToggleAllGroupsButton(groups);
    return true;
}

// 切换任意分组的折叠状态（今天/明天/最近7天/更远/已完成 等通用）
// 局部更新：仅修改该分组的 DOM（图标/显隐 + 懒加载注入内容），不触发全量 renderView，
// 避免虚拟滚动已填充的分组被重置、滚动位置丢失。
// groupKey 折叠切换。opts.skipRender=true 时，任务视图未渲染该分组也不回退全量渲染
// （计划面板与任务视图共享折叠态，从计划面板触发时当前视图可能不是任务视图）。
function toggleTaskListGroup(groupKey, opts) {
    opts = opts || {};
    const nowCollapsed = !taskListGroupCollapsed[groupKey];
    taskListGroupCollapsed[groupKey] = nowCollapsed;
    // per-list 折叠态持久化：防抖写入 localStorage
    const _listKey = currentListId || '__all__';
    _taskListGroupCollapsedByList[_listKey] = taskListGroupCollapsed;
    _scheduleGroupCollapseSave(_listKey);

    const contentEl = document.querySelector(`[data-task-group-content="${groupKey}"]`);
    if (!contentEl) {
        // DOM 中找不到（如当前非任务视图，或由计划面板触发）：仅同步计划面板折叠态，
        // 避免无谓的全量重渲染（重渲染会丢失滚动位置）
        if (typeof syncPlanPanelGroupCollapse === 'function') syncPlanPanelGroupCollapse(groupKey);
        if (!opts.skipRender) renderView();
        return;
    }

    // 切换内容容器显隐（fx-collapsed 配合平滑过渡动画做高度过渡，未开启时仅 hidden 生效）
    if (nowCollapsed) {
        contentEl.classList.add('hidden', 'fx-collapsed');
    } else {
        contentEl.classList.remove('hidden', 'fx-collapsed');
        // 展开时局部注入任务项 HTML（若尚未填充）
        let lazyEl = contentEl.querySelector('.task-list-group-lazy');
        // 折叠态渲染时未创建 lazy 占位，展开时补建（需插入 fx-collapse-inner 内，保持单子元素结构）
        if (!lazyEl) {
            lazyEl = document.createElement('div');
            lazyEl.className = 'task-list-group-lazy';
            lazyEl.dataset.groupKey = groupKey;
            lazyEl.dataset.populated = 'false';
            const innerEl = contentEl.querySelector('.fx-collapse-inner');
            if (innerEl) {
                innerEl.insertBefore(lazyEl, innerEl.firstChild);
            } else {
                contentEl.insertBefore(lazyEl, contentEl.firstChild);
            }
        }
        if (lazyEl.dataset.populated !== 'true') {
            const groups = _taskListVirtualState ? _taskListVirtualState.groups : buildTaskListGroups();
            const useShortTime = _taskListVirtualState ? _taskListVirtualState.useShortTime : isSpecialTimeFilter();
            _populateTaskListGroupContent(lazyEl, groups, useShortTime);
            // 若该分组在 IO 观察中，填充后取消观察
            if (_taskListVirtualIO) _taskListVirtualIO.unobserve(lazyEl);
        }
    }

    // 更新分组标题的折叠图标（须限定 chevron：多选态下分组标题里还有整组选择指示器的 i.fas）
    const groupWrapper = contentEl.closest('[data-task-group]');
    if (groupWrapper) {
        const icon = groupWrapper.querySelector('.task-list-group-header i.fa-chevron-down, .task-list-group-header i.fa-chevron-right');
        if (icon) {
            icon.className = `fas fa-chevron-${nowCollapsed ? 'right' : 'down'} w-3 text-center text-xs text-theme-muted mr-1`;
        }
    }

    // 与计划面板共享折叠态：同步计划面板中同 key 的分组
    if (typeof syncPlanPanelGroupCollapse === 'function') syncPlanPanelGroupCollapse(groupKey);

    // 同步顶部"全部展开/收起"按钮状态
    const groups = _taskListVirtualState ? _taskListVirtualState.groups : buildTaskListGroups();
    updateToggleAllGroupsButton(groups);
}

// 全部展开/收起：全展开时收起所有分组，否则（全收起或混合态）展开所有分组
// 此操作影响所有分组，走全量渲染最稳妥（会重新建立虚拟滚动状态）。
function toggleAllTaskListGroups() {
    const groups = buildTaskListGroups();
    if (groups.length === 0) return;
    const allExpanded = groups.every(g => !taskListGroupCollapsed[g.key]);
    if (allExpanded) {
        groups.forEach(g => { taskListGroupCollapsed[g.key] = true; });
    } else {
        groups.forEach(g => { delete taskListGroupCollapsed[g.key]; });
    }
    renderView();
    // 计划面板共享折叠态：全部展开/收起后同步其分组显隐
    if (typeof syncPlanPanelGroupCollapse === 'function') syncPlanPanelGroupCollapse();
}

// 同步顶部"全部展开/收起"按钮的图标与标题，反映当前分组折叠状态
// - 全展开（无任何分组折叠）→ 显示"全部收起"+双向上箭头
// - 全收起或混合态 → 显示"全部展开"+双向下箭头
function updateToggleAllGroupsButton(groups) {
    const btn = document.getElementById('toggle-all-groups-btn');
    if (!btn) return;
    const allExpanded = groups.length > 0 && groups.every(g => !taskListGroupCollapsed[g.key]);
    const iconName = allExpanded ? 'fa-angles-up' : 'fa-angles-down';
    const label = allExpanded ? '全部收起' : '全部展开';
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'fas ' + iconName;
    btn.title = label;
    // 同步「更多」面板中同一操作的文案与图标（不重建节点，避免打断正在进行的点击）
    const menuItem = document.querySelector('#mobile-more-menu .header-more-item[data-action-id="toggle-all-groups-btn"]');
    if (menuItem) {
        const menuIcon = menuItem.querySelector('.header-more-icon i');
        if (menuIcon) menuIcon.className = 'fas ' + iconName;
        const menuLabel = menuItem.querySelector('.header-more-label');
        if (menuLabel) menuLabel.textContent = label;
    }
}


function showCompletedTasksPage() {
    taskListCompletedShowAll = true;
    renderView();
}

// 日程视图单条「带时间」任务的时间显示（不带时间/全天任务由调用方另行处理）：
// - 无结束时间：仅显示开始时刻（卡片头部已含日期）
// - 同日带结束：卡片已含日期，省略为 "5:00 - 17:00"
// - 跨天（开始日卡片）：显示开始时刻 + " - " + 结束日相对词/日期 + 结束时刻
//   相对词以"当前时间"为基准（今天/明天/后天，超出用 M月D日，非今年带年份）
// - 跨天（结束日卡片，进行中任务）：显示开始日相对词/日期 + 开始时刻 + " - " + 结束时刻
function formatScheduleTimedLabel(task, cardDate) {
    const start = new Date(task.startTime);
    const sTime = formatTime(start);
    if (!task.endTime) return sTime;
    const end = new Date(task.endTime);
    const eTime = formatTime(end);
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const cardDay = new Date(cardDate.getFullYear(), cardDate.getMonth(), cardDate.getDate());
    if (startDay.getTime() === cardDay.getTime()) {
        if (startDay.getTime() === endDay.getTime()) return `${sTime} - ${eTime}`;
        return `${sTime} - ${relativeDayLabelForNow(end)} ${eTime}`;
    }
    if (endDay.getTime() === cardDay.getTime()) {
        return `${relativeDayLabelForNow(start)} ${sTime} - ${eTime}`;
    }
    return sTime;
}

// 今天卡片内「已完成的未排期任务」展开状态（会话内保持；勾选局部更新重建卡片时沿用）
let _scheduleTodayNoDateCompletedExpanded = false;
// 展开/收起今天卡片内已完成的未排期任务（按钮与容器同在任务列表内，就近定位）
function toggleScheduleTodayNoDateCompleted(e) {
    e.stopPropagation();
    _scheduleTodayNoDateCompletedExpanded = !_scheduleTodayNoDateCompletedExpanded;
    const btn = e.currentTarget;
    const wrap = btn.parentElement && btn.parentElement.querySelector('[data-schedule-nodate-completed-wrap]');
    if (wrap) wrap.classList.toggle('hidden', !_scheduleTodayNoDateCompletedExpanded);
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'fas fa-chevron-' + (_scheduleTodayNoDateCompletedExpanded ? 'down' : 'right') + ' text-xs';
}

// 构建单个日期卡片 HTML（抽出供懒加载与勾选局部更新复用）
function buildScheduleDayCardHtml(date, dayTasks) {
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const day = date.getDate();
    const dayOfWeek = weekDays[date.getDay()];
    const year = date.getFullYear();
    const month = date.getMonth();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const tasks = dayTasks || [];

    // 今天卡片：已完成的未排期任务默认折叠为一行，避免长期积累影响阅读
    let visibleTasks = tasks;
    let noDateCompleted = [];
    if (isToday) {
        noDateCompleted = tasks.filter(t => t.completed && !t.startTime);
        if (noDateCompleted.length > 0) visibleTasks = tasks.filter(t => !(t.completed && !t.startTime));
    }

    // 单个日程任务的行 HTML（主列表与折叠区共用）
    const renderScheduleTaskHtml = (task, taskIndex) => {
        const startTime = task.startTime ? new Date(task.startTime) : null;
        const colors = getQuadrantColorClass(task);
        const list = lists.find(l => l.id === task.listId);

        let timeDisplay;
        if (!startTime) {
            timeDisplay = '未排期';
        } else if (task.isAllDay) {
            if (task.endTime && isMultiDayTask(task)) {
                timeDisplay = fmtMDRange(startTime, new Date(task.endTime));
            } else {
                timeDisplay = getAllDayLabel(task, false);
            }
        } else {
            timeDisplay = formatScheduleTimedLabel(task, date);
        }
        if (task._projected && typeof renderRecurringGhostScheduleHtml === 'function') {
            return renderRecurringGhostScheduleHtml(task, timeDisplay);
        }
        const focusMinutes = getTaskFocusMinutes(task.id);
        const isOverdue = isTaskOverdue(task);
        const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-secondary';

        return `
            <div class="schedule-task-item task-row group flex items-start gap-4 mb-2.5 task-item ${task.completed ? 'opacity-55' : ''}" onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}', false, true)" draggable="true" ondragstart="handleScheduleDragStart(event, '${task.id}')">
                <div class="w-8 flex-shrink-0 flex flex-col items-center justify-between self-stretch relative">
                    ${renderTaskCheckbox(task, { taskId: task.id })}
                    ${renderFocusButton(task.id, getScheduleConfig().showFocusButton)}
                </div>
                <div class="${colors.bg} rounded-r-lg p-2.5 flex-1 hover:opacity-80 transition schedule-task-card" style="border-left: 4px solid ${getTaskBarColor(task, list && list.color ? list.color : '#9ca3af')}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
                    <div class="flex items-center gap-2 text-sm mb-1 text-theme-secondary">
                        <span class="${timeTextClass}">${timeDisplay}</span>
                        ${list ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${list.color}"></span>${list.name}</span>` : ''}
                        ${typeof renderRecurringTaskBadge === 'function' ? renderRecurringTaskBadge(task) : ''}
                        ${renderTagCapsules(task, 2, 'right')}
                        ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-500"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                        ${task.progress && task.progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-accent"></i>${task.progress}%</span>` : ''}
                    </div>
                    <div class="font-medium ${task.completed ? 'text-theme-secondary' : 'text-theme-primary'}">
                        ${task.title || '新任务'}
                    </div>
                    ${getScheduleConfig().showDetails !== false ? renderTaskDetailsBlock(task) : ''}
                </div>
            </div>
        `;
    };

    const noDateCompletedHtml = noDateCompleted.length > 0 ? `
        <button onclick="toggleScheduleTodayNoDateCompleted(event)" class="flex items-center gap-1.5 mb-2.5 text-xs text-theme-muted hover:text-theme-primary transition">
            <i class="fas fa-chevron-${_scheduleTodayNoDateCompletedExpanded ? 'down' : 'right'} text-xs"></i>已完成未排期任务 ${noDateCompleted.length}
        </button>
        <div data-schedule-nodate-completed-wrap class="${_scheduleTodayNoDateCompletedExpanded ? '' : 'hidden'}">
            ${noDateCompleted.map((t, i) => renderScheduleTaskHtml(t, i)).join('')}
        </div>` : '';

    return `
                    <div class="bg-theme-secondary rounded-xl shadow-theme p-4 ${isToday ? 'ring-2 ring-accent' : ''} schedule-day-drop" data-drop-date="${dateStr}" ondragover="handleScheduleDragOver(event)" ondragleave="handleScheduleDragLeave(event)" ondrop="handleScheduleDrop(event)">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="text-center min-w-[60px] schedule-date-block">
                                <div class="${isToday ? 'text-accent-dark font-bold' : 'text-theme-secondary'} text-2xl">${day}</div>
                                <div class="text-sm text-theme-muted">周${dayOfWeek}</div>
                                ${isToday ? '<div class="text-xs text-accent font-medium mt-1">今天</div>' : ''}
                                ${(() => { const lt = getLunarDisplayText(date, getScheduleConfig().showLunar); return lt ? `<div class="text-[10px] text-theme-muted leading-none mt-1">${lt}</div>` : ''; })()}
                            </div>
                            <div class="flex-1">
                                <div class="relative pl-6">
                                    <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-theme"></div>
                                    ${visibleTasks.map((t, i) => renderScheduleTaskHtml(t, i)).join('')}
                                    ${noDateCompletedHtml}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
}

// 构建单个月份的日卡片 HTML（供懒加载按需调用）
function buildScheduleMonthDaysHtml(year, month, groupedTasks) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    let monthHtml = '';

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateKey = date.toDateString();
        const dayTasks = groupedTasks[dateKey] || [];
        const isToday = date.toDateString() === today.toDateString();
        if (dayTasks.length > 0 || isToday) {
            monthHtml += buildScheduleDayCardHtml(date, dayTasks);
        }
    }
    return monthHtml;
}

// 局部刷新：重渲染指定日期的日卡片（仅当该月已懒加载填充时）
function refreshScheduleDayCard(dateKey) {
    if (!_scheduleGroupedTasks) return;
    const dayTasks = _scheduleGroupedTasks[dateKey];
    const date = new Date(dateKey);
    if (isNaN(date.getTime())) return;
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const el = document.querySelector(`.schedule-day-drop[data-drop-date="${dateStr}"]`);
    if (!el) return; // 所在月份尚未懒加载填充，无需更新
    el.outerHTML = buildScheduleDayCardHtml(date, dayTasks || []);
}

// 勾选任务后局部更新：重排受影响日期分组并重渲染其日卡片，避免全量 renderView
function refreshScheduleDayCardsForTask(taskId) {
    if (!_scheduleGroupedTasks) return false; // 日程视图尚未渲染，交由调用方全量渲染
    const task = tasks.find(t => t.id === taskId);
    if (!task) return true;
    // 无日期任务挂在"今天"分组下；其勾选会改变是否注入的状态，缓存失效+全量重渲染最稳妥
    if (!task.startTime) {
        invalidateScheduleFilterCache();
        return false;
    }
    const keys = new Set();
    const startKey = new Date(task.startTime).toDateString();
    if (_scheduleGroupedTasks[startKey]) keys.add(startKey);
    if (task.endTime) {
        const endKey = new Date(task.endTime).toDateString();
        if (_scheduleGroupedTasks[endKey]) keys.add(endKey);
    }
    const todayKey = new Date().toDateString();
    const noDateMode = getScheduleConfig().noDateTaskPosition || 'last';
    keys.forEach(k => {
        _scheduleGroupedTasks[k] = sortScheduleDayGroup(_scheduleGroupedTasks[k], k, todayKey, noDateMode);
        refreshScheduleDayCard(k);
    });
    return true; // 已处理：任务不在可见分组时也无需全量渲染
}


// 缓存 filter+排序+分组 的整条流水线结果，按筛选状态 + 当天日期签名复用。
// 勾选任务（仅 completed 变化）不会失效，因任务对象引用共享、completed 已实时更新；
// 结构性变更（增删/改期/服务端刷新）由 invalidateScheduleFilterCache 主动失效。
function invalidateScheduleFilterCache() {
    _scheduleFilteredCache = null;
    if (typeof invalidateRecurringGhostCache === 'function') invalidateRecurringGhostCache();
}

// 日程视图某日分组排序：先按完成状态（sortTasksByCompletion：未完成在前、已完成在后），
// "今天"分组内再按设置调整无日期任务位置，且严格保持各分组（未完成/已完成）内部相对顺序：
// - noDateMode='first'：无日期任务提到各自分组最前（未完成最前、已完成最前）
// - noDateMode='last'（默认）：无日期任务放到各自分组最末（未完成最末、已完成最末）
// - noDateMode='none'：不应有无日期任务注入，本函数仅做常规排序
function sortScheduleDayGroup(taskList, dateKey, todayKey, noDateMode) {
    let arr = sortTasksByCompletion(taskList);
    if (dateKey === todayKey && (noDateMode === 'first' || noDateMode === 'last')) {
        // 在各自分组（未完成/已完成）内，把无日期任务移到最前(first)或最末(last)，并保留有日期任务的相对顺序
        const place = function (section) {
            const noDate = section.filter(function (t) { return !t.startTime; });
            const dated = section.filter(function (t) { return t.startTime; });
            return noDateMode === 'first' ? noDate.concat(dated) : dated.concat(noDate);
        };
        const incomplete = arr.filter(function (t) { return !t.completed; });
        const completed = arr.filter(function (t) { return t.completed; });
        arr = place(incomplete).concat(place(completed));
    }
    return arr;
}

function getScheduleGroupedTasks() {
    const tagKey = (currentTagIds || []).join(',');
    const todayKey = new Date().toDateString();
    const scfg = getScheduleConfig();
    const showNoDate = scfg.showNoDateTasks !== false; // 「显示无日期任务」开关：关时不注入今天分组
    const noDateMode = showNoDate ? (scfg.noDateTaskPosition || 'last') : 'none';
    const sig = (currentListId || '') + '|' + tagKey + '|' + (currentFilter || '') + '|' + (currentFilterId || '') + '|' + todayKey + '|' + (noDateMode === 'first' ? 'f' : (noDateMode === 'none' ? 'n' : 'l')) + '|' + (scfg.showCompleted ? '1' : '0') + '|' + (shouldHideExternalTasks() ? '1' : '0') + '|' + (typeof isRecurringFutureEnabled === 'function' && isRecurringFutureEnabled('schedule') ? '1' : '0') + '|' + (typeof getRecurringRangeKey === 'function' ? getRecurringRangeKey() : '');
    if (_scheduleFilteredCache && _scheduleFilteredCache.sig === sig) {
        return _scheduleFilteredCache.grouped;
    }

    const allFiltered = filterTasks(tasks, { includeCompleted: getScheduleConfig().showCompleted !== false });
    // 无日期任务（含未完成与已完成，受 showCompleted 过滤）单独收集，按创建时间正序（最早在前）排列，注入"今天"分组下按设置定位；有日期任务走原有按天分桶逻辑
    const noDateTasks = allFiltered.filter(t => !t.startTime).sort((a, b) => {
        const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return at - bt;
    });
    const filteredTasks = allFiltered.filter(t => t.startTime);
    // startTime 为 ISO 字符串，直接字典序比较，避免反复 new Date
    const sortedTasks = [...filteredTasks].sort((a, b) => {
        const sa = a.startTime || '';
        const sb = b.startTime || '';
        if (sa < sb) return -1;
        if (sa > sb) return 1;
        return 0;
    });

    const groupedTasks = {};
    sortedTasks.forEach(task => {
        const date = new Date(task.startTime);
        const dateKey = date.toDateString();
        if (!groupedTasks[dateKey]) groupedTasks[dateKey] = [];
        groupedTasks[dateKey].push(task);

        // 跨天任务：开始日期已过但截止日期未过 → 也加入截止日期分组
        if (task.endTime) {
            const now = new Date();
            const startDate = new Date(task.startTime);
            const endDate = new Date(task.endTime);
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startDayStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDayStart = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            const endDayTomorrow = new Date(endDayStart);
            endDayTomorrow.setDate(endDayTomorrow.getDate() + 1);
            if (startDayStart < todayStart && now < endDayTomorrow) {
                const endDateKey = endDayStart.toDateString();
                if (endDateKey !== dateKey) {
                    if (!groupedTasks[endDateKey]) groupedTasks[endDateKey] = [];
                    groupedTasks[endDateKey].push(task);
                }
            }
        }
    });

    // 无日期任务注入"今天"分组（含未完成与已完成，按设置在分组内定位；"不显示"时跳过）
    if (noDateMode !== 'none' && noDateTasks.length > 0) {
        if (!groupedTasks[todayKey]) groupedTasks[todayKey] = [];
        noDateTasks.forEach(t => groupedTasks[todayKey].push(t));
    }

    // 只读后续投影：仅参与展示，不进入 _scheduleGroupedTasks 的写操作路径
    if (typeof mergeRecurringGhostsIntoGrouped === 'function') {
        mergeRecurringGhostsIntoGrouped(groupedTasks, 'schedule');
    }

    Object.keys(groupedTasks).forEach(dateKey => {
        groupedTasks[dateKey] = sortScheduleDayGroup(groupedTasks[dateKey], dateKey, todayKey, noDateMode);
    });

    _scheduleFilteredCache = { sig: sig, grouped: groupedTasks };
    return groupedTasks;
}

function renderScheduleView(container) {
    _scheduleSessionEntered = true;
    // 数据准备（filter+排序+分组）走缓存，避免每次全量扫描 5518 条
    const groupedTasks = getScheduleGroupedTasks();
    _scheduleGroupedTasks = groupedTasks; // 供勾选任务的局部更新复用

    // 计算月份范围（当前月 - 3个月 到 当前月 + 9个月，共约1年）
    const currentDate = new Date();
    const today = new Date();
    const startMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 3 + scheduleMonthOffset, 1);
    const endMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 9 + scheduleMonthOffset, 0);

    // 预计算哪些月份含有任务，避免为空月份构建日卡片 HTML
    const monthsWithTasks = new Set();
    Object.keys(groupedTasks).forEach(dateKey => {
        const d = new Date(dateKey);
        monthsWithTasks.add(d.getFullYear() + '-' + d.getMonth());
    });
    const _todayMonthKey = today.getFullYear() + '-' + today.getMonth();

    let html = `
        <div class="schedule-container" style="height: 100%; overflow-y: auto; padding-bottom: 100px;">
            <div class="space-y-8">
    `;

    // 生成月份外壳：日卡片 HTML 延迟到接近视口时再构建（IntersectionObserver 懒加载），
    // 避免一次性渲染数千个 DOM 节点。今天所在月份及相邻月份稍后立即填充，保证"滚动到今天"可用。
    const currentMonth = new Date(startMonth);
    while (currentMonth <= endMonth) {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const monthKey = year + '-' + month;
        const isCurrentMonth = monthKey === _todayMonthKey;

        if (monthsWithTasks.has(monthKey) || isCurrentMonth) {
            const monthLabel = `${year}-${(month + 1).toString().padStart(2, '0')}`;
            html += `
                <div class="mb-6" data-schedule-month="${monthLabel}">
                    <h3 class="text-xl font-bold text-theme-primary mb-4">
                        ${year}年${month + 1}月
                    </h3>
                    <div class="space-y-4 schedule-month-content" data-sm-year="${year}" data-sm-month="${month}" data-populated="false"></div>
                </div>
            `;
        }

        // 移动到下个月
        currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    html += `
            </div>
        </div>
    `;

    // 只认主视图下的真实日程容器；切换过渡期的 .fx-view-ghost 克隆里也可能有同名容器
    const prevScrollContainer = container.querySelector(':scope > .schedule-container');
    const savedScrollTop = prevScrollContainer ? prevScrollContainer.scrollTop : 0;
    // 滚动锚点：记录旧 DOM 中视口顶线所处的月份区块及其相对视口偏移。
    // 重渲染后上方曾懒加载填充的月份会退回空壳（高度≈0），旧 DOM 的绝对像素 scrollTop
    // 在新 DOM 中会指向更晚的日期甚至被钳到已填充内容末尾，表现为"关闭详情面板后
    // 跳到明天/未来某天"。改为按锚点元素恢复可对任意填充状态保持视觉位置稳定。
    let savedAnchorMonth = null;
    let savedAnchorOffset = 0;
    if (prevScrollContainer && savedScrollTop > 0) {
        const cRect = prevScrollContainer.getBoundingClientRect();
        const sections = prevScrollContainer.querySelectorAll('[data-schedule-month]');
        for (const sec of sections) {
            const r = sec.getBoundingClientRect();
            if (r.bottom > cRect.top) {
                savedAnchorMonth = sec.getAttribute('data-schedule-month');
                savedAnchorOffset = r.top - cRect.top;
                break;
            }
        }
    }
    // 跨视图切回：旧 DOM 已不在，使用离开时记录的视口锚点恢复上次位置
    const pendingViewport = (!prevScrollContainer && _scheduleLastViewport) ? _scheduleLastViewport : null;
    _scheduleLastViewport = null;

    container.innerHTML = html;

    // 日程视图懒加载：仅构建接近视口的月份日卡片，减少初始 DOM 节点
    const scheduleScrollContainer = container.querySelector('.schedule-container');
    const _populateScheduleMonth = (contentEl) => {
        if (!contentEl || contentEl.dataset.populated === 'true') return;
        const y = parseInt(contentEl.dataset.smYear, 10);
        const m = parseInt(contentEl.dataset.smMonth, 10);

        // 滚动锚定：若被填充月份位于视口上方，填充后其高度增长会下推可见内容，
        // 导致滚动位置"跳动"。记录其后继月份位置，填充后补偿 scrollTop 使可见内容保持不动。
        // 注意：这里只做一次“读”，写入 innerHTML 后的第二次“读+写”必须延后到下一帧，
        // 否则在同一 JS 执行周期内“写完 DOM 立刻读几何属性”会触发强制同步布局（Layout Thrashing）。
        let needAnchor = false, anchorEl = null, anchorTopBefore = 0, selfHeightBefore = 0;
        if (scheduleScrollContainer) {
            const containerTop = scheduleScrollContainer.getBoundingClientRect().top;
            if (contentEl.getBoundingClientRect().top < containerTop) {
                needAnchor = true;
                selfHeightBefore = contentEl.getBoundingClientRect().height;
                anchorEl = contentEl.parentElement ? contentEl.parentElement.nextElementSibling : null;
                if (anchorEl) anchorTopBefore = anchorEl.getBoundingClientRect().top;
            }
        }

        const daysHtml = buildScheduleMonthDaysHtml(y, m, groupedTasks);
        contentEl.innerHTML = daysHtml || '<div class="text-center text-theme-muted py-8">本月暂无日程</div>';
        contentEl.dataset.populated = 'true';

        // 视口上方月份填充后，按内容下移量补偿 scrollTop，消除跳动。
        // 将“读取新几何属性 + 修正 scrollTop”放到 requestAnimationFrame 中执行，
        // 与上面的 innerHTML 写入分离到不同帧，避免强制同步布局导致的卡顿。
        // 滚动锚点恢复期间填充的月份不补偿：其最终位置由恢复逻辑按锚点元素显式设定。
        if (needAnchor && scheduleScrollContainer && !_scheduleRestoreFilling) {
            const anchorRef = anchorEl;
            const anchorTopRef = anchorTopBefore;
            const selfHeightRef = selfHeightBefore;
            const containerRef = scheduleScrollContainer;
            requestAnimationFrame(() => {
                let delta;
                if (anchorRef) {
                    delta = anchorRef.getBoundingClientRect().top - anchorTopRef;
                } else {
                    delta = contentEl.getBoundingClientRect().height - selfHeightRef;
                }
                if (delta) containerRef.scrollTop += delta;
            });
        }
    };
    const _scheduleMonthEls = container.querySelectorAll('.schedule-month-content');
    // 始终立即填充今天所在月份及相邻月份（保证"滚动到今天"与初始可见区域有内容）
    _scheduleMonthEls.forEach(el => {
        const y = parseInt(el.dataset.smYear, 10);
        const m = parseInt(el.dataset.smMonth, 10);
        const sameYear = y === today.getFullYear();
        if (sameYear && Math.abs((m - today.getMonth() + 12) % 12) <= 1) {
            _populateScheduleMonth(el);
        }
    });

    // 填充底部导航栏（年月分段快速跳转，三视图共用同一渲染）。
    // 初始标题：有待定位的跳转目标时用目标月（避免先闪今天再被 IO 纠正），否则用今天所在月。
    const _navAnchor = /^\d{4}-\d{2}$/.test(_scheduleScrollTargetMonth || '')
        ? _scheduleScrollTargetMonth
        : `${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, '0')}`;
    renderNavTimeBar({
        year: parseInt(_navAnchor.substring(0, 4), 10),
        month: parseInt(_navAnchor.substring(5), 10) - 1,
        prev: 'navigateScheduleMonth(-1)',
        next: 'navigateScheduleMonth(1)',
        titleId: 'schedule-nav-month'
    });
    // 初始锚点（IO 异步触发前点击导航时使用，触发后由 IO 持续校正）
    _scheduleNavMonthLabel = _navAnchor;

    // 顶部导航栏月份指示：使用 IntersectionObserver 替代 scroll 监听。
    // scroll 事件每秒可触发 60+ 次，原实现每次都遍历所有月份并调用 getBoundingClientRect()，
    // 会强制同步布局（Layout Thrashing），在大量月份下导致明显卡顿。
    // IO 在浏览器内部以非主线程方式计算可见性，性能极高。
    if (scheduleScrollContainer) {
        // 定位辅助：先同步填充到目标月份（含），避免目标上方月份还是高度≈0的空壳。
        // 否则跳转时文档总高不足，目标 scrollTop 会被浏览器钳到顶部（稀疏月份下表现为
        // 切到日程视图却停在最前面的往期月份）。
        const _populateMonthsThrough = (monthLabel) => {
            if (!monthLabel) return;
            _scheduleRestoreFilling = true;
            try {
                for (const el of _scheduleMonthEls) {
                    if (el.dataset.populated !== 'true') _populateScheduleMonth(el);
                    const sec = el.parentElement;
                    if (sec && sec.getAttribute('data-schedule-month') === monthLabel) break;
                }
            } finally {
                _scheduleRestoreFilling = false;
            }
        };
        const _scrollToScheduleMonth = (monthLabel, offset = 0) => {
            if (!monthLabel || !/^\d{4}-\d{2}$/.test(monthLabel)) return null;
            const y = parseInt(monthLabel.substring(0, 4), 10);
            const m = parseInt(monthLabel.substring(5), 10) - 1;
            const sec = scheduleScrollContainer.querySelector(`[data-schedule-month="${monthLabel}"]`)
                || _findScheduleMonthSection(scheduleScrollContainer, y, m, 1)
                || _findScheduleMonthSection(scheduleScrollContainer, y, m, -1);
            if (!sec) return null;
            _populateMonthsThrough(sec.getAttribute('data-schedule-month'));
            const cRect = scheduleScrollContainer.getBoundingClientRect();
            const r = sec.getBoundingClientRect();
            scheduleScrollContainer.scrollTop += r.top - cRect.top - offset;
            _scheduleNavMonthLabel = sec.getAttribute('data-schedule-month');
            return sec;
        };
        // 懒加载会在定位后继续增加内容高度（尤其未来月份填充后可用滚动距离变大），
        // 下一帧再校一次，避免停在被钳制的旧位置；此时用户通常还未开始滚动。
        const _settleScheduleScroll = (anchorEl, offset) => {
            requestAnimationFrame(() => {
                if (!anchorEl || !document.body.contains(anchorEl) || !document.body.contains(scheduleScrollContainer)) return;
                const cRect = scheduleScrollContainer.getBoundingClientRect();
                const r = anchorEl.getBoundingClientRect();
                const diff = r.top - cRect.top - offset;
                if (Math.abs(diff) > 2) scheduleScrollContainer.scrollTop += diff;
            });
        };

        // 同步恢复滚动位置，消除刷新时从顶部（往期任务）跳到今天的跳动
        if (!_scheduleAutoScroll) {
            // 视图内重渲染优先按旧 DOM 锚点恢复；跨视图切回用离开时保存的视口锚点。
            // 锚点月份在新 DOM 中缺失（如勾选完成后该月变为空月份不再生成外壳）时，
            // 就近查找相邻月份，仍找不到才回退像素恢复。
            const restoreAnchorMonth = savedScrollTop > 0 ? savedAnchorMonth : (pendingViewport ? pendingViewport.anchorMonth : null);
            const restoreAnchorOffset = savedScrollTop > 0 ? savedAnchorOffset : (pendingViewport ? pendingViewport.anchorOffset : 0);
            const restoreScrollTop = savedScrollTop > 0 ? savedScrollTop : (pendingViewport ? pendingViewport.scrollTop : 0);
            const restoredSec = restoreAnchorMonth
                ? _scrollToScheduleMonth(restoreAnchorMonth, restoreAnchorOffset)
                : null;
            if (restoredSec) {
                _settleScheduleScroll(restoredSec, restoreAnchorOffset);
            } else if (restoreScrollTop > 0) {
                scheduleScrollContainer.scrollTop = restoreScrollTop;
            }
        } else if (_scheduleAutoScroll) {
            // 自动定位"今天"：同步执行（今天所在月份已在上文同步填充，卡片必然存在）。
            // 原实现用 200ms 延时定位，会与懒加载填充的滚动锚定补偿（rAF）产生竞态：
            // 若某次上方月份的填充恰好横跨该定时器，定位先按"已增长"的布局计算位置，
            // rAF 补偿再叠加一次增量，导致今天被推离视口顶部。改为同步定位后，
            // 它先于任何 IO 回调与 rAF 执行，后续填充的锚定补偿会保持今天位置不变，
            // 从根本上消除竞态。
            _scheduleAutoScroll = false;
            // 优先定位月份导航的目标月份（窗口平移场景，目标可能为空月份：先沿导航方向就近查找，再反向）
            let anchorEl = null;
            if (_scheduleScrollTargetMonth && /^\d{4}-\d{2}$/.test(_scheduleScrollTargetMonth)) {
                const ty = parseInt(_scheduleScrollTargetMonth.substring(0, 4), 10);
                const tm = parseInt(_scheduleScrollTargetMonth.substring(5), 10) - 1;
                const dir = _scheduleScrollTargetDir || 1;
                _scheduleScrollTargetMonth = null;
                anchorEl = _findScheduleMonthSection(scheduleScrollContainer, ty, tm, dir)
                    || _findScheduleMonthSection(scheduleScrollContainer, ty, tm, -dir);
            }
            if (anchorEl) {
                if (_scrollToScheduleMonth(anchorEl.getAttribute('data-schedule-month'), 0)) {
                    _settleScheduleScroll(anchorEl, 0);
                }
            } else {
                // 默认定位"今天"
                const todayCard = scheduleScrollContainer.querySelector('.schedule-day-drop.ring-2');
                const now = new Date();
                const todayMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
                if (todayCard) {
                    _populateMonthsThrough(todayMonth);
                    const containerRect = scheduleScrollContainer.getBoundingClientRect();
                    const cardRect = todayCard.getBoundingClientRect();
                    scheduleScrollContainer.scrollTop += cardRect.top - containerRect.top - 20;
                    _settleScheduleScroll(todayCard, 20);
                }
                // 没能定位到指定月份（窗口内该月无任务、无外壳）：锚点同步回落到今天，
                // 否则 _scheduleNavMonthLabel 会停留在「目标月」而实际显示的是今天所在月，
                // 让上层（快速跳转的落地提示）误判成跳转成功。
                _scheduleNavMonthLabel = todayMonth;
            }
        }
        // 滚动恢复 / 自动定位完成后，用真实锚点校正标题：
        // 上方两处分支已同步更新 _scheduleNavMonthLabel，这里补一次即可避免
        // 「先显示今天、等 IO 异步回调再纠正」的一帧闪烁。
        if (typeof updateNavTimeBar === 'function'
            && typeof _scheduleNavMonthLabel === 'string'
            && /^\d{4}-\d{2}$/.test(_scheduleNavMonthLabel)) {
            updateNavTimeBar(parseInt(_scheduleNavMonthLabel.substring(0, 4), 10),
                             parseInt(_scheduleNavMonthLabel.substring(5), 10) - 1);
        }
        const navMonth = document.getElementById('schedule-nav-month');
        const monthSections = scheduleScrollContainer.querySelectorAll('[data-schedule-month]');
        if (navMonth && monthSections.length > 0 && 'IntersectionObserver' in window) {
            // 断开上一次渲染的 nav observer，避免累积泄漏
            if (_scheduleNavObserver) {
                _scheduleNavObserver.disconnect();
                _scheduleNavObserver = null;
            }
            // rootMargin 在容器顶部构造一条 20px 高的“探测线”，
            // 与原 scroll 实现的 containerRect.top + 20 阈值等价：
            // 只有跨越该探测线的月份才会触发回调，避免1/3处误判到下一个月。
            // 上边距 0px：从视口顶部开始；下边距 -(容器高-20)px 等价于只保留顶部 20px 高的探测带。
            const lineObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const monthLabel = entry.target.getAttribute('data-schedule-month');
                        if (monthLabel) {
                            const [y, m] = monthLabel.split('-');
                            updateNavTimeBar(parseInt(y, 10), parseInt(m, 10) - 1);
                            _scheduleNavMonthLabel = monthLabel; // 维护锚点，供月份导航使用
                        }
                    }
                });
            }, {
                root: scheduleScrollContainer,
                rootMargin: `0px 0px -${Math.max((scheduleScrollContainer.clientHeight || 400) - 20, 0)}px 0px`,
                threshold: 0
            });
            _scheduleNavObserver = lineObserver;
            monthSections.forEach(sec => lineObserver.observe(sec));
        } else if (navMonth && monthSections.length > 0) {
            // 不支持 IO 时回退：直接显示第一个月份
            const monthLabel = monthSections[0].getAttribute('data-schedule-month');
            if (monthLabel) {
                const [y, m] = monthLabel.split('-');
                updateNavTimeBar(parseInt(y, 10), parseInt(m, 10) - 1);
                _scheduleNavMonthLabel = monthLabel;
            }
        }
        // 注：IO 在初始 observe 后会异步触发首次回调，无需像旧 scroll 监听那样手动 dispatch。

        // 视口附近（含已恢复的滚动位置）的月份立即填充，其余由 IntersectionObserver 懒加载
        const cRect = scheduleScrollContainer.getBoundingClientRect();
        const buffer = scheduleScrollContainer.clientHeight || 400;
        _scheduleMonthEls.forEach(el => {
            if (el.dataset.populated === 'true') return;
            const r = el.getBoundingClientRect();
            if (r.bottom > cRect.top - buffer && r.top < cRect.bottom + buffer) {
                _populateScheduleMonth(el);
            }
        });
        if ('IntersectionObserver' in window) {
            // 断开上一次渲染的 observer，避免频繁重渲染累积泄漏
            if (_scheduleIntersectionObserver) {
                _scheduleIntersectionObserver.disconnect();
                _scheduleIntersectionObserver = null;
            }
            const scheduleIO = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        _populateScheduleMonth(entry.target);
                        scheduleIO.unobserve(entry.target);
                    }
                });
            }, { root: scheduleScrollContainer, rootMargin: '600px 0px 600px 0px' });
            _scheduleIntersectionObserver = scheduleIO;
            _scheduleMonthEls.forEach(el => {
                if (el.dataset.populated !== 'true') scheduleIO.observe(el);
            });
        } else {
            // 不支持 IntersectionObserver：全部填充（降级保证功能可用）
            _scheduleMonthEls.forEach(el => _populateScheduleMonth(el));
        }
    }

    // 日期块吸顶位置：常驻视口垂直中部（今天卡片已同步渲染，可直接测量）。
    // resize 监听全局只绑定一次，回调每次现查 .schedule-container，视图切走时自动空转。
    updateScheduleDateStickyTop();
    if (!_scheduleStickyResizeBound) {
        _scheduleStickyResizeBound = true;
        window.addEventListener('resize', updateScheduleDateStickyTop);
    }
    // 自动滚动定位已在上方与滚动位置恢复同步完成；非自动滚动时滚动位置也已同步恢复
}

// 查找目标月份的 DOM 节点；目标为空月份（无任务无外壳）时沿导航方向就近取最近存在的月份块
function _findScheduleMonthSection(scrollContainer, year, month, direction) {
    for (let i = 0; i < 15; i++) {
        const d = new Date(year, month + direction * i, 1);
        const label = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        const sec = scrollContainer.querySelector(`[data-schedule-month="${label}"]`);
        if (sec) return sec;
    }
    return null;
}

function navigateScheduleMonth(direction) {
    // 平滑过渡动画开启时：时间轴连续滚动语义——不重建 DOM，直接平滑滚动到相邻月份
    const fxReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollContainer = document.querySelector('.schedule-container');
    if (typeof settings !== 'undefined' && settings.smoothAnimations === true && !fxReducedMotion && scrollContainer) {
        // 当前锚点月份：由月份指示 IO 实时维护；缺失时回退今天
        let y, m;
        if (_scheduleNavMonthLabel && /^\d{4}-\d{2}$/.test(_scheduleNavMonthLabel)) {
            y = parseInt(_scheduleNavMonthLabel.substring(0, 4), 10);
            m = parseInt(_scheduleNavMonthLabel.substring(5), 10) - 1;
        } else {
            const now = new Date();
            y = now.getFullYear();
            m = now.getMonth();
        }
        const target = new Date(y, m + direction, 1);
        const sec = _findScheduleMonthSection(scrollContainer, target.getFullYear(), target.getMonth(), direction);
        if (sec) {
            // 目标月份在当前渲染窗口内：平滑滚动到该月份标题处
            _scheduleNavMonthLabel = sec.getAttribute('data-schedule-month');
            const containerRect = scrollContainer.getBoundingClientRect();
            const secRect = sec.getBoundingClientRect();
            scrollContainer.scrollTo({ top: scrollContainer.scrollTop + (secRect.top - containerRect.top), behavior: 'smooth' });
            return;
        }
        // 目标月份超出当前渲染窗口（-3~+9 月）：平移窗口重渲染，渲染后同步定位到目标月份
        _scheduleScrollTargetMonth = `${target.getFullYear()}-${(target.getMonth() + 1).toString().padStart(2, '0')}`;
        _scheduleScrollTargetDir = direction;
        _scheduleAutoScroll = true;
        scheduleMonthOffset += direction;
        renderScheduleView(document.getElementById('view-container'));
        return;
    }
    scheduleMonthOffset += direction;
    _scheduleAutoScroll = true;
    renderScheduleView(document.getElementById('view-container'));
}

