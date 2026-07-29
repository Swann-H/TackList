// ==================== 任务列表视图 & 日程视图（从 views.js 拆分） ====================

let scheduleMonthOffset = 0;
let _scheduleAutoScroll = true;
let taskListCompletedCollapsed = true;
let taskListCompletedShowAll = false;

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

function renderScheduleView(container) {
    const filteredTasks = filterTasks(tasks).filter(t => t.startTime);

    // 按日期和时间排序任务
    const sortedTasks = [...filteredTasks].sort((a, b) => {
        return new Date(a.startTime) - new Date(b.startTime);
    });

    // 按日期分组任务
    const groupedTasks = {};
    sortedTasks.forEach(task => {
        const date = new Date(task.startTime);
        const dateKey = date.toDateString();
        if (!groupedTasks[dateKey]) {
            groupedTasks[dateKey] = [];
        }
        groupedTasks[dateKey].push(task);

        // 跨天任务：如果开始日期已过但截止日期未过，也添加到截止日期的分组
        if (task.endTime) {
            const now = new Date();
            const startDate = new Date(task.startTime);
            const endDate = new Date(task.endTime);
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startDayStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDayStart = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            const endDayTomorrow = new Date(endDayStart);
            endDayTomorrow.setDate(endDayTomorrow.getDate() + 1);

            // 开始日期已过，截止日期未过 → 显示在截止日期列表
            if (startDayStart < todayStart && now < endDayTomorrow) {
                const endDateKey = endDayStart.toDateString();
                if (endDateKey !== dateKey) {
                    if (!groupedTasks[endDateKey]) {
                        groupedTasks[endDateKey] = [];
                    }
                    groupedTasks[endDateKey].push(task);
                }
            }
        }
    });

    Object.keys(groupedTasks).forEach(dateKey => {
        groupedTasks[dateKey] = sortTasksByCompletion(groupedTasks[dateKey]);
    });

    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

    // 计算月份范围（当前月 - 3个月 到 当前月 + 9个月，共1年）
    const currentDate = new Date();
    const today = new Date();
    const startMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 3 + scheduleMonthOffset, 1);
    const endMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 9 + scheduleMonthOffset, 0);

    let html = `
        <div class="schedule-container" style="height: 100%; overflow-y: auto; padding-bottom: 100px;">
            <div class="space-y-8">
    `;

    // 按月份生成日期列表
    const currentMonth = new Date(startMonth);
    while (currentMonth <= endMonth) {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let monthHasTasks = false;
        let monthHtml = '';

        // 遍历这个月的每一天
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateKey = date.toDateString();
            const dayTasks = groupedTasks[dateKey] || [];

            // 只显示有任务的日期或今天
            const today = new Date();
            const isToday = date.toDateString() === today.toDateString();

            if (dayTasks.length > 0 || isToday) {
                monthHasTasks = true;
                const dayOfWeek = weekDays[date.getDay()];
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                monthHtml += `
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
                                    ${dayTasks.map((task, taskIndex) => {
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
        }

        // 只添加有内容的月份
        if (monthHasTasks || monthNames[month] === monthNames[today.getMonth()]) {
            html += `
                <div class="mb-6" data-schedule-month="${year}-${(month + 1).toString().padStart(2, '0')}">
                    <h3 class="text-xl font-bold text-theme-primary mb-4">
                        ${year}年${month + 1}月
                    </h3>
                    <div class="space-y-4">
                        ${monthHtml || '<div class="text-center text-theme-muted py-8">本月暂无日程</div>'}
                    </div>
                </div>
            `;
        }

        // 移动到下个月
        currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    html += `
            </div>

            <!-- 底部悬浮导航 -->
            <div class="fixed bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-theme-secondary/80 backdrop-blur-md rounded-xl shadow-lg px-6 py-3 z-50">
                <button onclick="navigateScheduleMonth(-1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <h2 id="schedule-nav-month" class="text-xl font-bold text-theme-primary min-w-[160px] text-center">
                    ${new Date().getFullYear()}年${new Date().getMonth() + 1}月
                </h2>
                <button onclick="navigateScheduleMonth(1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        </div>
    `;

    const savedScrollTop = container.querySelector('.schedule-container')
        ? container.querySelector('.schedule-container').scrollTop : 0;

    container.innerHTML = html;

    // 添加滚动监听，更新底部导航栏显示当前可见月份
    const scheduleScrollContainer = container.querySelector('.schedule-container');
    if (scheduleScrollContainer) {
        // 同步恢复滚动位置，消除刷新时从顶部（往期任务）跳到今天的跳动
        if (!_scheduleAutoScroll && savedScrollTop > 0) {
            scheduleScrollContainer.scrollTop = savedScrollTop;
        }
        scheduleScrollContainer.addEventListener('scroll', function() {
            const navMonth = document.getElementById('schedule-nav-month');
            if (!navMonth) return;
            const monthSections = scheduleScrollContainer.querySelectorAll('[data-schedule-month]');
            if (monthSections.length === 0) return;
            const containerRect = scheduleScrollContainer.getBoundingClientRect();
            const centerY = containerRect.top + containerRect.height / 3;
            let visibleMonth = null;
            for (let i = monthSections.length - 1; i >= 0; i--) {
                const rect = monthSections[i].getBoundingClientRect();
                if (rect.top <= centerY) {
                    visibleMonth = monthSections[i].getAttribute('data-schedule-month');
                    break;
                }
            }
            if (!visibleMonth) {
                visibleMonth = monthSections[0].getAttribute('data-schedule-month');
            }
            if (visibleMonth) {
                const [y, m] = visibleMonth.split('-');
                navMonth.textContent = `${y}年${parseInt(m)}月`;
            }
        });
        // 初始触发一次
        setTimeout(() => scheduleScrollContainer.dispatchEvent(new Event('scroll')), 100);
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
