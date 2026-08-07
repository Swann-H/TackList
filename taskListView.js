// ==================== 任务列表视图 & 日程视图（从 views.js 拆分） ====================

let scheduleMonthOffset = 0;
let _scheduleAutoScroll = true;
// 分组折叠状态：记录每个分组的折叠状态（true=已折叠）。默认仅"已完成"折叠。
let taskListGroupCollapsed = { completed: true };
let taskListCompletedShowAll = false;
// 筛选上下文签名：用于检测筛选条件变化，变化时重置分组折叠状态为默认值
let _lastTaskListFilterSig = null;
let _scheduleIntersectionObserver = null; // 当前日程视图的 IO，重渲染前 disconnect 防泄漏
let _scheduleNavObserver = null; // 顶部导航栏月份指示器 IO（替代 scroll 监听，避免高频 reflow）
let _scheduleGroupedTasks = null; // 日程视图按日期分组的缓存，供局部更新复用
let _scheduleFilteredCache = null; // filterTasks 结果缓存，避免每次渲染全量扫描
// 任务列表视图：filter+分组结果签名缓存，折叠/展开等纯状态变更时复用，避免全量扫描
let _taskListGroupsCache = null;
// 虚拟滚动相关状态：分组级懒加载，远端分组由 IntersectionObserver 触发填充
let _taskListVirtualState = null; // { groups, useShortTime }
let _taskListVirtualIO = null; // IntersectionObserver 实例
let _taskListVirtualScrollEl = null; // 滚动容器引用
// 预构建索引：消除 buildTaskListItemHtml 内的 lists.find 线性查找
// （_tagsByIdMap/_tagsByIdSig 定义在 utils.js，供 renderTagCapsules 使用）
let _listsByIdMap = null; // Map<listId, list>
let _listsByIdSig = null; // 签名（长度+末尾ID），变化时重建

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

// 任务视图列表 & 命令面板 /s 搜索结果 共用的任务时间格式化。
// - 全天任务：近端（今天/昨天/明天/后天）用相对词并去掉"全天"字样，更远才显示实际日期；
//   任务视图与搜索用同一函数，故两边一致。
// - 带时间任务：今天/昨天/明天/后天 用相对词；更远或过期任务，任务视图仅在"最近7天/以后"
//   分组带日期，而搜索结果（跨任意日期）用 fullDate:true 始终带出日期，避免丢失所属日期。
//   日期与时间之间统一用空格分隔（不再使用逗号）。
// opts.fullDate=true 时，非近端带时间任务也强制带日期（供搜索结果使用）。
// 全天任务标签：近端（今天/昨天/明天/后天）用相对词并去掉"全天"，更远才显示实际日期。
// 任务视图列表、命令面板搜索、以及"最近7天"筛选视图统一使用本函数，保证显示一致。
function getAllDayLabel(task) {
    if (!task.startTime) return '';
    const b = getDateBounds();
    const taskDate = new Date(task.startTime);
    const month = taskDate.getMonth() + 1;
    const day = taskDate.getDate();
    if (taskDate >= b.todayStart && taskDate < b.tomorrowStart) return '今天';
    if (taskDate >= b.yesterdayStart && taskDate < b.todayStart) return '昨天';
    if (taskDate >= b.tomorrowStart && taskDate < b.dayAfterTomorrowStart) return '明天';
    if (taskDate >= b.dayAfterTomorrowStart && taskDate < b.threeDaysLaterStart) return '后天';
    return `${month}月${day}日`;
}

function formatTaskListTime(task, opts = {}) {
    if (!task.startTime) return '';
    const b = getDateBounds();
    const taskDate = new Date(task.startTime);
    const month = taskDate.getMonth() + 1;
    const day = taskDate.getDate();
    const dateLabel = `${month}月${day}日`;

    // 全天任务：近端用相对词并去掉"全天"，更远用实际日期
    if (task.isAllDay) return getAllDayLabel(task);

    const hours = taskDate.getHours().toString().padStart(2, '0');
    const mins = taskDate.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${mins}`;

    if (taskDate >= b.todayStart && taskDate < b.tomorrowStart) return timeStr;
    if (taskDate >= b.yesterdayStart && taskDate < b.todayStart) return `昨天 ${timeStr}`;
    if (taskDate >= b.tomorrowStart && taskDate < b.dayAfterTomorrowStart) return `明天 ${timeStr}`;
    if (taskDate >= b.dayAfterTomorrowStart && taskDate < b.threeDaysLaterStart) return `后天 ${timeStr}`;

    // 远端/过期任务：搜索结果需带日期；任务视图仅在"最近7天/以后"分组带日期（统一空格分隔）
    if (opts.fullDate) return `${dateLabel} ${timeStr}`;
    const group = getTaskListGroup(task);
    if (group === 'recent7' || group === 'later') return `${dateLabel} ${timeStr}`;
    return timeStr;
}

// 构建任务列表分组。返回归一化的分组数组，供 renderTaskListView 统一渲染。
// - 默认视图：按状态桶分组（已过期/今天/明天/后天/最近7天/更远/无日期/已完成）
// - 最近7天筛选视图：按天分组（未完成），已完成单独成组
// 带签名缓存：折叠/展开等纯状态变更不会改变分组结果，可直接复用缓存，避免全量 filter+分组+排序。
function buildTaskListGroups() {
    // 缓存签名：筛选上下文 + tasks/lists 引用与长度 + 影响分组的设置项 + 当天日期签名
    const dateSig = getDateBounds()._sig;
    const sig = [
        currentFilter || '', currentListId || '',
        (currentTagIds || []).join(','), currentFilterId || '',
        tasks.length, lists.length, dateSig,
        (settings.noDateTaskPosition || 'last'),
        (!settings.showCompleted && settings.showCompleted !== undefined) ? '1' : '0'
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
}

function _buildTaskListGroupsUncached() {
    const filtered = filterTasks(tasks);

    // 最近7天筛选视图：按天分组
    if (currentFilter === 'recent7days') {
        const b = getDateBounds();

        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        const dayBuckets = {};
        const completedTasks = [];

        filtered.forEach(task => {
            if (task.completed) { completedTasks.push(task); return; }
            if (!task.startTime) return;
            const d = new Date(task.startTime);
            const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const dateKey = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
            if (!dayBuckets[dateKey]) dayBuckets[dateKey] = { date: dayStart, tasks: [] };
            dayBuckets[dateKey].tasks.push(task);
        });

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
                const sorted = g.tasks.slice().sort((a, b) => {
                    if (a.completed !== b.completed) return a.completed ? 1 : -1;
                    return new Date(a.startTime) - new Date(b.startTime);
                });
                return {
                    key: `day_${dateKey}`,
                    dataGroup: date.toDateString() === b.todayStart.toDateString() ? 'today' : `day_${dateKey}`,
                    labelHtml: `${titleCore}<span class="ml-1 text-xs text-theme-muted font-normal">${sorted.length}</span>`,
                    tasks: sorted,
                    isCompleted: false,
                    count: sorted.length,
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
        return groups;
    }

    // 默认视图：按状态桶分组
    const groups = {
        overdue: { label: '已过期', tasks: [] },
        today: { label: '今天', tasks: [] },
        tomorrow: { label: '明天', tasks: [] },
        dayAfterTomorrow: { label: '后天', tasks: [] },
        recent7: { label: '最近7天', tasks: [] },
        later: { label: '更远', tasks: [] },
        nodate: { label: '无日期', tasks: [] },
        completed: { label: '已完成', tasks: [] }
    };

    filtered.forEach(task => {
        const group = getTaskListGroup(task);
        if (groups[group]) groups[group].tasks.push(task);
    });

    ['overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'recent7', 'later'].forEach(k => {
        groups[k].tasks.sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            return new Date(a.startTime) - new Date(b.startTime);
        });
    });
    groups.nodate.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });
    groups.completed.tasks.sort((a, b) => {
        const aTime = a.completedAt || a.createdAt;
        const bTime = b.completedAt || b.createdAt;
        return new Date(bTime) - new Date(aTime);
    });

    // 无日期任务分组位置由设置 noDateTaskPosition 决定：first=前置（已过期之前），last=后置（更远之后，默认）
    const noDateFirst = (settings.noDateTaskPosition || 'last') === 'first';
    const groupOrder = noDateFirst
        ? ['nodate', 'overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'recent7', 'later', 'completed']
        : ['overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'recent7', 'later', 'nodate', 'completed'];
    return groupOrder
        .filter(k => groups[k].tasks.length > 0)
        .map(k => ({
            key: k,
            dataGroup: k,
            labelHtml: `${groups[k].label}<span class="ml-1 text-xs text-theme-muted font-normal">${groups[k].tasks.length}</span>`,
            tasks: groups[k].tasks,
            isCompleted: k === 'completed',
            count: groups[k].tasks.length,
            overdue: k === 'overdue'
        }));
}

// 按天视图使用的精简时间显示（仅 HH:MM / 相对词），全天任务沿用 getAllDayLabel 的相对词规则
function formatTaskListTimeShort(task) {
    if (!task.startTime) return '';
    if (task.isAllDay) return getAllDayLabel(task);
    const taskDate = new Date(task.startTime);
    const hours = taskDate.getHours().toString().padStart(2, '0');
    const mins = taskDate.getMinutes().toString().padStart(2, '0');
    return `${hours}:${mins}`;
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
function buildTaskListItemHtml(task, useShortTime) {
    const list = _getListsByIdMap().get(task.listId);
    const listColor = list ? list.color : '#9ca3af';
    const listName = list ? list.name : '';
    const focusMinutes = getTaskFocusMinutes(task.id);
    const timeDisplay = useShortTime ? formatTaskListTimeShort(task) : formatTaskListTime(task);
    const progress = task.progress || 0;
    const quadColors = getQuadrantColorClass(task);
    const isOverdue = isTaskOverdue(task);
    const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary';
    const tagCapsules = renderTagCapsules(task, 2, 'right');

    return `
        <div class="task-list-item relative flex items-center gap-3 py-2.5 px-3 rounded-r-lg ${quadColors.bg} hover:opacity-85 transition cursor-pointer group ${task.completed ? 'opacity-55' : ''}"
             data-list-id="${task.listId || 'default'}"
             onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')"
             >
            <div class="task-list-color-bar" style="background-color: ${listColor};"></div>
            <button onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" class="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-blue-500 dark:border-white hover:border-blue-600 dark:hover:border-blue-300'}">
                ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
            </button>
            <span class="flex-1 text-sm ${task.completed ? 'text-theme-secondary' : 'text-theme-primary'} truncate min-w-0">${task.title || '新任务'}</span>
            ${renderFocusButton(task.id)}
            <div class="flex items-center gap-2 flex-shrink-0 text-xs text-theme-primary whitespace-nowrap">
                ${tagCapsules}
                ${progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-blue-400"></i>${progress}%</span>` : ''}
                ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-400"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                ${listName ? `<span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background-color: ${listColor}"></span><span class="hidden sm:inline">${listName}</span></span>` : ''}
            </div>
            ${timeDisplay ? `<span class="flex-shrink-0 text-xs ${timeTextClass} whitespace-nowrap" style="min-width: 50px; text-align: right;"><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
        </div>
    `;
}

function renderTaskListView(container) {
    // 筛选上下文变化时重置分组折叠状态为默认值
    const filterSig = (currentFilter || '') + '|' + (currentListId || '') + '|' + (currentTagIds || []).join(',') + '|' + (currentFilterId || '');
    if (filterSig !== _lastTaskListFilterSig) {
        if (currentFilter === 'recent7days') {
            taskListGroupCollapsed = {};
        } else {
            taskListGroupCollapsed = { completed: true };
        }
        _lastTaskListFilterSig = filterSig;
    }

    const groups = buildTaskListGroups();
    // 最近7天按天视图：任务时间只显示 HH:MM，避免与分组标题中的日期重复
    const useShortTime = currentFilter === 'recent7days';

    if (groups.length === 0) {
        _teardownTaskListVirtualScroll();
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 text-theme-muted">
                <i class="fas fa-clipboard-list text-6xl mb-4 opacity-30"></i>
                <p class="text-lg">欢迎使用日程管理！</p>
                <p class="text-sm mt-2">点击右上角"+"来添加任务</p>
                <p class="text-sm mt-1">或使用快捷键Ctrl + Alt + N呼出命令面板快速添加任务</p>
            </div>
        `;
        updateToggleAllGroupsButton(groups);
        return;
    }

    let html = '<div class="task-list-view" style="height: 100%; overflow-y: auto; overflow-x: hidden; padding-bottom: 40px;">';
    html += '<div class="bg-theme-secondary rounded-xl shadow-theme p-4">';

    groups.forEach(group => {
        const isCollapsed = !!taskListGroupCollapsed[group.key];
        // 已完成分组在未展开"查看更多"时仅显示前5条
        const visibleTasks = group.isCompleted && !taskListCompletedShowAll
            ? group.tasks.slice(0, 5)
            : group.tasks;
        const hasMore = group.isCompleted && group.tasks.length > 5 && !taskListCompletedShowAll;

        html += `
            <div class="mb-3 last:mb-0" data-task-group="${group.dataGroup}">
                <div class="flex items-center justify-between mb-2 cursor-pointer select-none task-list-group-header"
                     onclick="toggleTaskListGroup('${group.key}')">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'} text-xs text-theme-muted mr-1"></i>
                        <h3 class="text-base font-semibold ${group.overdue ? 'text-red-500' : 'text-theme-primary'}">${group.labelHtml}</h3>
                    </div>
                </div>
                <div class="${isCollapsed ? 'hidden' : ''}" data-task-group-content="${group.key}" data-group-key="${group.key}" data-task-count="${visibleTasks.length}">
        `;

        // 折叠分组跳过 HTML 构建（Lazy Rendering）：折叠态不构建任务项 HTML，
        // 仅保留容器占位；展开时由 _populateTaskListGroupContent 局部注入，避免全量重渲染。
        if (!isCollapsed) {
            // 虚拟滚动：仅立即构建接近视口分组的任务项，其余由 IntersectionObserver 懒加载。
            // 占位容器高度由 data-task-count 估算，避免懒加载分组高度塌陷导致滚动跳动。
            html += `<div class="task-list-group-lazy" data-group-key="${group.key}" data-populated="false"></div>`;
        }

        if (hasMore) {
            html += `
                <div class="py-2 px-3">
                    <button onclick="event.stopPropagation(); showCompletedTasksPage()" class="text-sm text-blue-500 hover:text-blue-600 transition">
                        查看更多
                    </button>
                </div>
            `;
        }

        html += `
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

    updateToggleAllGroupsButton(groups);
}

// 虚拟滚动：填充单个分组的任务项 HTML（懒加载/展开时复用）
function _populateTaskListGroupContent(lazyEl, groups, useShortTime) {
    if (!lazyEl || lazyEl.dataset.populated === 'true') return;
    const groupKey = lazyEl.dataset.groupKey;
    const group = groups.find(g => g.key === groupKey);
    if (!group) return;
    const visibleTasks = group.isCompleted && !taskListCompletedShowAll
        ? group.tasks.slice(0, 5)
        : group.tasks;
    let inner = '';
    for (let i = 0; i < visibleTasks.length; i++) {
        inner += buildTaskListItemHtml(visibleTasks[i], useShortTime);
    }
    lazyEl.innerHTML = inner;
    lazyEl.dataset.populated = 'true';
}

// 设置任务列表虚拟滚动：视口附近分组立即填充，远端分组由 IO 懒加载
function _setupTaskListVirtualScroll(container, groups, useShortTime) {
    const scrollEl = container.querySelector('.task-list-view');
    if (!scrollEl) return;
    _taskListVirtualScrollEl = scrollEl;
    _taskListVirtualState = { groups, useShortTime };

    // 断开上一次渲染的 IO，避免累积泄漏
    if (_taskListVirtualIO) {
        _taskListVirtualIO.disconnect();
        _taskListVirtualIO = null;
    }

    const lazyEls = container.querySelectorAll('.task-list-group-lazy');
    const cRect = scrollEl.getBoundingClientRect();
    const buffer = scrollEl.clientHeight || 400;
    // 立即填充视口附近（含已恢复的滚动位置）的分组
    lazyEls.forEach(el => {
        if (el.dataset.populated === 'true') return;
        const r = el.getBoundingClientRect();
        if (r.bottom > cRect.top - buffer && r.top < cRect.bottom + buffer) {
            _populateTaskListGroupContent(el, groups, useShortTime);
        }
    });

    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    _populateTaskListGroupContent(entry.target, groups, useShortTime);
                    io.unobserve(entry.target);
                }
            });
        }, { root: scrollEl, rootMargin: '600px 0px 600px 0px' });
        _taskListVirtualIO = io;
        lazyEls.forEach(el => {
            if (el.dataset.populated !== 'true') io.observe(el);
        });
    } else {
        // 不支持 IO：全部填充（降级保证功能可用）
        lazyEls.forEach(el => _populateTaskListGroupContent(el, groups, useShortTime));
    }
}

// 销毁虚拟滚动资源（视图切换/空态时调用）
function _teardownTaskListVirtualScroll() {
    if (_taskListVirtualIO) {
        _taskListVirtualIO.disconnect();
        _taskListVirtualIO = null;
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

    // 最近7天视图：完成态切换必然跨分组（→已完成），走全量渲染
    if (currentFilter === 'recent7days') {
        invalidateTaskListGroupsCache();
        return false;
    }

    // 设置了隐藏已完成任务时，勾选完成会让任务从列表消失，属结构性变更，走全量渲染
    if (!settings.showCompleted && settings.showCompleted !== undefined && task.completed) {
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
    const newHtml = buildTaskListItemHtml(task, useShortTime);
    const tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    const newItem = tmp.firstElementChild;
    if (newItem && itemEl.parentNode) {
        itemEl.parentNode.replaceChild(newItem, itemEl);
        return true;
    }
    return false;
}

// 切换任意分组的折叠状态（今天/明天/最近7天/更远/已完成 等通用）
// 局部更新：仅修改该分组的 DOM（图标/显隐 + 懒加载注入内容），不触发全量 renderView，
// 避免虚拟滚动已填充的分组被重置、滚动位置丢失。
function toggleTaskListGroup(groupKey) {
    const nowCollapsed = !taskListGroupCollapsed[groupKey];
    taskListGroupCollapsed[groupKey] = nowCollapsed;

    const contentEl = document.querySelector(`[data-task-group-content="${groupKey}"]`);
    if (!contentEl) {
        // DOM 中找不到（如视图未在任务视图），回退全量渲染
        renderView();
        return;
    }

    // 切换内容容器显隐
    if (nowCollapsed) {
        contentEl.classList.add('hidden');
    } else {
        contentEl.classList.remove('hidden');
        // 展开时局部注入任务项 HTML（若尚未填充）
        let lazyEl = contentEl.querySelector('.task-list-group-lazy');
        // 折叠态渲染时未创建 lazy 占位，展开时补建
        if (!lazyEl) {
            lazyEl = document.createElement('div');
            lazyEl.className = 'task-list-group-lazy';
            lazyEl.dataset.groupKey = groupKey;
            lazyEl.dataset.populated = 'false';
            contentEl.appendChild(lazyEl);
        }
        if (lazyEl.dataset.populated !== 'true') {
            const groups = _taskListVirtualState ? _taskListVirtualState.groups : buildTaskListGroups();
            const useShortTime = _taskListVirtualState ? _taskListVirtualState.useShortTime : (currentFilter === 'recent7days');
            _populateTaskListGroupContent(lazyEl, groups, useShortTime);
            // 若该分组在 IO 观察中，填充后取消观察
            if (_taskListVirtualIO) _taskListVirtualIO.unobserve(lazyEl);
        }
    }

    // 更新分组标题的折叠图标
    const groupWrapper = contentEl.closest('[data-task-group]');
    if (groupWrapper) {
        const icon = groupWrapper.querySelector('.task-list-group-header i.fas');
        if (icon) {
            icon.className = `fas fa-chevron-${nowCollapsed ? 'right' : 'down'} text-xs text-theme-muted mr-1`;
        }
    }

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
    // 同步移动端"更多"菜单中的按钮
    const mobileBtn = document.getElementById('mobile-more-toggle-groups');
    if (mobileBtn) {
        mobileBtn.innerHTML = '<i class="fas ' + iconName + ' w-5"></i>' + label;
    }
}

// 兼容旧调用入口
function toggleTaskListCompletedGroup() {
    toggleTaskListGroup('completed');
}

function showCompletedTasksPage() {
    taskListCompletedShowAll = true;
    renderView();
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

    return `
                    <div class="bg-theme-secondary rounded-xl shadow-theme p-4 ${isToday ? 'ring-2 ring-blue-500' : ''} schedule-day-drop" data-drop-date="${dateStr}" ondragover="handleScheduleDragOver(event)" ondragleave="handleScheduleDragLeave(event)" ondrop="handleScheduleDrop(event)">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="text-center min-w-[60px]">
                                <div class="${isToday ? 'text-blue-600 font-bold' : 'text-theme-secondary'} text-2xl">${day}</div>
                                <div class="text-sm text-theme-muted">周${dayOfWeek}</div>
                                ${isToday ? '<div class="text-xs text-blue-500 font-medium mt-1">今天</div>' : ''}
                                ${(() => { const lt = getLunarDisplayText(date); return lt ? `<div class="text-[10px] text-theme-muted leading-none mt-1">${lt}</div>` : ''; })()}
                            </div>
                            <div class="flex-1">
                                <div class="relative pl-6">
                                    <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-theme"></div>
                                    ${tasks.map((task, taskIndex) => {
                                        const startTime = task.startTime ? new Date(task.startTime) : null;
                                        const startHour = startTime ? startTime.getHours().toString().padStart(2, '0') : '';
                                        const startMin = startTime ? startTime.getMinutes().toString().padStart(2, '0') : '';
                                        const colors = getQuadrantColorClass(task);
                                        const list = lists.find(l => l.id === task.listId);

                                        const timeDisplay = !startTime ? '未排期' : (task.isAllDay ? getAllDayLabel(task) : `${startHour}:${startMin}`);
                                        const focusMinutes = getTaskFocusMinutes(task.id);
                                        const isOverdue = isTaskOverdue(task);
                                        const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-secondary';

                                        return `
                                            <div class="schedule-task-item group flex items-start gap-4 mb-3 task-item ${taskIndex > 0 ? 'pt-3' : ''} ${task.completed ? 'opacity-60' : ''}" onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')" draggable="true" ondragstart="handleScheduleDragStart(event, '${task.id}')">
                                                <div class="w-8 flex-shrink-0 flex flex-col items-center justify-between self-stretch relative">
                                                    <button onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-blue-500 dark:border-white hover:border-blue-600 dark:hover:border-blue-300'}">
                                                        ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                                                    </button>
                                                    ${renderFocusButton(task.id)}
                                                </div>
                                                <div class="${colors.bg} rounded-r-lg p-3 flex-1 hover:opacity-80 transition schedule-task-card" style="${list && list.color ? `border-left: 4px solid ${list.color};` : 'border-left: 4px solid #9ca3af;'} border-top-left-radius: 0; border-bottom-left-radius: 0;">
                                                    <div class="flex items-center gap-2 text-sm mb-1 text-theme-secondary">
                                                        <span class="${timeTextClass}">${timeDisplay}</span>
                                                        ${list ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${list.color}"></span>${list.name}</span>` : ''}
                                                        ${renderTagCapsules(task, 2, 'right')}
                                                        ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-500"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                                                        ${task.progress && task.progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-blue-500"></i>${task.progress}%</span>` : ''}
                                                    </div>
                                                    <div class="font-medium ${task.completed ? 'text-theme-secondary' : 'text-theme-primary'}">
                                                        ${task.title || '新任务'}
                                                    </div>
                                                    ${renderSubtaskListDisplay(task) || (task.notes ? `<div class="text-xs ${task.completed ? 'text-theme-muted' : 'text-theme-secondary'} mt-1">${task.notes}</div>` : '')}
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
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
    const noDateFirst = (settings.noDateTaskPosition || 'last') === 'first';
    keys.forEach(k => {
        _scheduleGroupedTasks[k] = sortScheduleDayGroup(_scheduleGroupedTasks[k], k, todayKey, noDateFirst);
        refreshScheduleDayCard(k);
    });
    return true; // 已处理：任务不在可见分组时也无需全量渲染
}


// 缓存 filter+排序+分组 的整条流水线结果，按筛选状态 + 当天日期签名复用。
// 勾选任务（仅 completed 变化）不会失效，因任务对象引用共享、completed 已实时更新；
// 结构性变更（增删/改期/服务端刷新）由 invalidateScheduleFilterCache 主动失效。
function invalidateScheduleFilterCache() {
    _scheduleFilteredCache = null;
}

// 日程视图某日分组排序：先按完成状态，"今天"分组内再按设置调整无日期任务位置
// - noDateFirst=true 时把无日期未完成任务提到今天分组最前；其余情况沿用 sortTasksByCompletion（无日期默认排在未完成末尾、已完成之前）
function sortScheduleDayGroup(taskList, dateKey, todayKey, noDateFirst) {
    let arr = sortTasksByCompletion(taskList);
    if (noDateFirst && dateKey === todayKey) {
        const noDate = arr.filter(t => !t.startTime && !t.completed);
        if (noDate.length > 0) {
            const noDateSet = new Set(noDate);
            arr = [...noDate, ...arr.filter(t => !noDateSet.has(t))];
        }
    }
    return arr;
}

function getScheduleGroupedTasks() {
    const tagKey = (currentTagIds || []).join(',');
    const todayKey = new Date().toDateString();
    const noDateFirst = (settings.noDateTaskPosition || 'last') === 'first';
    const sig = (currentListId || '') + '|' + tagKey + '|' + (currentFilter || '') + '|' + (currentFilterId || '') + '|' + todayKey + '|' + (noDateFirst ? 'f' : 'l');
    if (_scheduleFilteredCache && _scheduleFilteredCache.sig === sig) {
        return _scheduleFilteredCache.grouped;
    }

    const allFiltered = filterTasks(tasks);
    // 无日期任务（未完成）单独收集，注入"今天"分组下按设置定位；有日期任务走原有按天分桶逻辑
    const noDateTasks = allFiltered.filter(t => !t.startTime && !t.completed);
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

    // 无日期任务注入"今天"分组（仅未完成，按设置在分组内定位）
    if (noDateTasks.length > 0) {
        if (!groupedTasks[todayKey]) groupedTasks[todayKey] = [];
        noDateTasks.forEach(t => groupedTasks[todayKey].push(t));
    }

    Object.keys(groupedTasks).forEach(dateKey => {
        groupedTasks[dateKey] = sortScheduleDayGroup(groupedTasks[dateKey], dateKey, todayKey, noDateFirst);
    });

    _scheduleFilteredCache = { sig: sig, grouped: groupedTasks };
    return groupedTasks;
}

function renderScheduleView(container) {
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

    const savedScrollTop = container.querySelector('.schedule-container')
        ? container.querySelector('.schedule-container').scrollTop : 0;

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
        if (needAnchor && scheduleScrollContainer) {
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

    // 填充底部导航栏
    const _navBar = document.getElementById('view-nav-bar');
    if (_navBar) {
        _navBar.innerHTML = `
            <div class="flex items-center gap-4 bg-theme-secondary/80 backdrop-blur-md rounded-xl shadow-lg px-6 py-3">
                <button onclick="navigateScheduleMonth(-1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <h2 id="schedule-nav-month" class="text-xl font-bold text-theme-primary min-w-[240px] text-center">
                    ${new Date().getFullYear()}年${new Date().getMonth() + 1}月
                </h2>
                <button onclick="navigateScheduleMonth(1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;
    }

    // 顶部导航栏月份指示：使用 IntersectionObserver 替代 scroll 监听。
    // scroll 事件每秒可触发 60+ 次，原实现每次都遍历所有月份并调用 getBoundingClientRect()，
    // 会强制同步布局（Layout Thrashing），在大量月份下导致明显卡顿。
    // IO 在浏览器内部以非主线程方式计算可见性，性能极高。
    if (scheduleScrollContainer) {
        // 同步恢复滚动位置，消除刷新时从顶部（往期任务）跳到今天的跳动
        if (!_scheduleAutoScroll && savedScrollTop > 0) {
            scheduleScrollContainer.scrollTop = savedScrollTop;
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
                            navMonth.textContent = `${y}年${parseInt(m)}月`;
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
                navMonth.textContent = `${y}年${parseInt(m)}月`;
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

    if (_scheduleAutoScroll) {
        _scheduleAutoScroll = false;
        setTimeout(() => {
            const todayCard = container.querySelector('.schedule-day-drop.ring-2');
            if (todayCard) {
                const scrollContainer = todayCard.closest('.schedule-container');
                if (scrollContainer) {
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const cardRect = todayCard.getBoundingClientRect();
                    scrollContainer.scrollTop += cardRect.top - containerRect.top - 20;
                }
            }
            // 滚动到今天后，IntersectionObserver 会异步捕捉到新可见月份并更新导航栏。
            // 旧实现此处 dispatch scroll 事件是为了触发手动监听器，IO 化后已无需手动触发。
        }, 200);
    }
    // 非自动滚动时，滚动位置已在上方同步恢复，无需额外处理
}

function navigateScheduleMonth(direction) {
    scheduleMonthOffset += direction;
    _scheduleAutoScroll = true;
    renderScheduleView(document.getElementById('view-container'));
}

function resetScheduleView() {
    scheduleMonthOffset = 0;
    _scheduleAutoScroll = true;
    renderScheduleView(document.getElementById('view-container'));
}
