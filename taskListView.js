// ==================== 任务列表视图 & 日程视图（从 views.js 拆分） ====================

let scheduleMonthOffset = 0;
let _scheduleAutoScroll = true;
let taskListCompletedCollapsed = true;
let taskListCompletedShowAll = false;
let _scheduleIntersectionObserver = null; // 当前日程视图的 IO，重渲染前 disconnect 防泄漏
let _scheduleNavObserver = null; // 顶部导航栏月份指示器 IO（替代 scroll 监听，避免高频 reflow）
let _scheduleGroupedTasks = null; // 日程视图按日期分组的缓存，供局部更新复用
let _scheduleFilteredCache = null; // filterTasks 结果缓存，避免每次渲染全量扫描

function getTaskListGroup(task) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const dayAfterTomorrowStart = new Date(todayStart);
    dayAfterTomorrowStart.setDate(dayAfterTomorrowStart.getDate() + 2);
    const threeDaysLaterStart = new Date(todayStart);
    threeDaysLaterStart.setDate(threeDaysLaterStart.getDate() + 3);
    const sevenDaysLaterEnd = new Date(todayStart);
    sevenDaysLaterEnd.setDate(sevenDaysLaterEnd.getDate() + 7);
    sevenDaysLaterEnd.setHours(23, 59, 59, 999);

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
            if (now >= taskDate && now < taskEndTomorrow) {
                return 'today';
            }
            // 当前日期超过截止日期 → 已过期
            if (taskEndTomorrow <= todayStart) {
                return 'overdue';
            }
        }

        if (taskDate < todayStart) return 'overdue';
        if (taskDate < tomorrowStart) return 'today';
        if (taskDate < dayAfterTomorrowStart) return 'tomorrow';
        if (taskDate < threeDaysLaterStart) return 'dayAfterTomorrow';
        if (taskDate <= sevenDaysLaterEnd) return 'recent7';
        return 'later';
    }

    return 'nodate';
}

function formatTaskListTime(task) {
    if (!task.startTime) return '';
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const dayAfterTomorrowStart = new Date(todayStart);
    dayAfterTomorrowStart.setDate(dayAfterTomorrowStart.getDate() + 2);

    const taskDate = new Date(task.startTime);
    const month = taskDate.getMonth() + 1;
    const day = taskDate.getDate();

    const threeDaysLaterStart = new Date(todayStart);
    threeDaysLaterStart.setDate(threeDaysLaterStart.getDate() + 3);

    if (task.isAllDay) {
        if (taskDate >= todayStart && taskDate < tomorrowStart) return '全天';
        if (taskDate >= yesterdayStart && taskDate < todayStart) return '昨天 全天';
        if (taskDate >= tomorrowStart && taskDate < dayAfterTomorrowStart) return '明天 全天';
        if (taskDate >= dayAfterTomorrowStart && taskDate < threeDaysLaterStart) return '后天 全天';
        const group = getTaskListGroup(task);
        if (group === 'recent7' || group === 'later') {
            return `${month}月${day}日 全天`;
        }
        return '全天';
    }

    const hours = taskDate.getHours().toString().padStart(2, '0');
    const mins = taskDate.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${mins}`;

    if (taskDate >= todayStart && taskDate < tomorrowStart) return timeStr;
    if (taskDate >= yesterdayStart && taskDate < todayStart) return `昨天 ${timeStr}`;
    if (taskDate >= tomorrowStart && taskDate < dayAfterTomorrowStart) return `明天 ${timeStr}`;
    if (taskDate >= dayAfterTomorrowStart && taskDate < threeDaysLaterStart) return `后天 ${timeStr}`;

    const group = getTaskListGroup(task);
    if (group === 'recent7' || group === 'later') {
        return `${month}月${day}日, ${timeStr}`;
    }

    return timeStr;
}

function renderTaskListView(container) {
    const filtered = filterTasks(tasks);
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
        groups[group].tasks.push(task);
    });

    groups.overdue.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.today.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.tomorrow.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.dayAfterTomorrow.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.recent7.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.later.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
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

    const groupOrder = ['overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'recent7', 'later', 'nodate', 'completed'];
    const hasAnyTasks = groupOrder.slice(0, 7).some(g => groups[g].tasks.length > 0);

    if (!hasAnyTasks && groups.completed.tasks.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 text-theme-muted">
                <i class="fas fa-clipboard-list text-6xl mb-4 opacity-30"></i>
                <p class="text-lg">欢迎使用日程管理！</p>
                <p class="text-sm mt-2">点击右上角"+"来添加任务</p>
                <p class="text-sm mt-1">或使用快捷键Ctrl + Alt + N呼出命令面板快速添加任务</p>
            </div>
        `;
        return;
    }

    let html = '<div class="task-list-view" style="height: 100%; overflow-y: auto; overflow-x: hidden; padding-bottom: 40px;">';
    html += '<div class="bg-theme-secondary rounded-xl shadow-theme p-4">';

    groupOrder.forEach(groupKey => {
        const group = groups[groupKey];
        if (group.tasks.length === 0 && groupKey !== 'completed') return;
        if (groupKey === 'completed' && group.tasks.length === 0) return;

        const isCompletedGroup = groupKey === 'completed';
        const isCollapsed = isCompletedGroup && taskListCompletedCollapsed;
        const visibleTasks = isCompletedGroup && !taskListCompletedShowAll
            ? group.tasks.slice(0, 5)
            : group.tasks;
        const hasMore = isCompletedGroup && group.tasks.length > 5 && !taskListCompletedShowAll;

        html += `
            <div class="mb-3 last:mb-0" data-task-group="${groupKey}">
                <div class="flex items-center justify-between mb-2 cursor-pointer select-none ${isCompletedGroup ? 'task-list-group-header' : ''}"
                     ${isCompletedGroup ? `onclick="toggleTaskListCompletedGroup()"` : ''}>
                    <div class="flex items-center gap-2">
                        ${isCompletedGroup ? `<i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'} text-xs text-theme-muted mr-1"></i>` : ''}
                        <h3 class="text-base font-semibold ${groupKey === 'overdue' ? 'text-red-500' : 'text-theme-primary'}">${group.label}</h3>
                        <span class="text-sm text-theme-muted">(${group.tasks.length})</span>
                    </div>
                </div>
                <div class="${isCollapsed ? 'hidden' : ''}" id="task-list-completed-content">
        `;

        visibleTasks.forEach(task => {
            const list = lists.find(l => l.id === task.listId);
            const listColor = list ? list.color : '#9ca3af';
            const listName = list ? list.name : '';
            const focusMinutes = getTaskFocusMinutes(task.id);
            const timeDisplay = formatTaskListTime(task);
            const progress = task.progress || 0;
            const quadColors = getQuadrantColorClass(task);
            const isOverdue = isTaskOverdue(task);
            const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary';
            const tagCapsules = renderTagCapsules(task, 2, 'right');

            html += `
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
        });

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
}

function toggleTaskListCompletedGroup() {
    taskListCompletedCollapsed = !taskListCompletedCollapsed;
    renderView();
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
                                        const startTime = new Date(task.startTime);
                                        const startHour = startTime.getHours().toString().padStart(2, '0');
                                        const startMin = startTime.getMinutes().toString().padStart(2, '0');
                                        const colors = getQuadrantColorClass(task);
                                        const list = lists.find(l => l.id === task.listId);

                                        const timeDisplay = task.isAllDay ? '全天' : `${startHour}:${startMin}`;
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
    if (!task || !task.startTime) return true; // 无开始时间任务不在日程视图，无需更新
    const keys = new Set();
    const startKey = new Date(task.startTime).toDateString();
    if (_scheduleGroupedTasks[startKey]) keys.add(startKey);
    if (task.endTime) {
        const endKey = new Date(task.endTime).toDateString();
        if (_scheduleGroupedTasks[endKey]) keys.add(endKey);
    }
    keys.forEach(k => {
        _scheduleGroupedTasks[k] = sortTasksByCompletion(_scheduleGroupedTasks[k]);
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

function getScheduleGroupedTasks() {
    const tagKey = (currentTagIds || []).join(',');
    const todayKey = new Date().toDateString();
    const sig = (currentListId || '') + '|' + tagKey + '|' + (currentFilter || '') + '|' + (currentFilterId || '') + '|' + todayKey;
    if (_scheduleFilteredCache && _scheduleFilteredCache.sig === sig) {
        return _scheduleFilteredCache.grouped;
    }

    const filteredTasks = filterTasks(tasks).filter(t => t.startTime);
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

    Object.keys(groupedTasks).forEach(dateKey => {
        groupedTasks[dateKey] = sortTasksByCompletion(groupedTasks[dateKey]);
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
