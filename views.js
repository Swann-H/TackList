// ==================== 视图调度入口（从原 views.js 精简） ====================
// 本文件仅保留视图切换与渲染的调度逻辑，具体视图实现已拆分至：
//   - sidebarViews.js    : 侧边栏（清单/标签/过滤器）+ updateSidebarHighlight/Counts
//   - calendarViews.js   : 周视图 & 月视图
//   - quadrantView.js    : 四象限视图
//   - taskListView.js    : 任务列表视图 & 日程视图
//   - summaryView.js     : 摘要视图（统计/图表/动画）
// 公共工具函数（isTaskOverdue/isTaskOverdueToday/renderFocusButton/OVERDUE_TEXT_CLASS）已移至 utils.js

function switchView(view) {
    if (currentDetailTaskId) {
        closeTaskDetailPanel();
    }
    if (currentView === 'month' && view !== 'month') {
        closeMonthDayPopover();
    }
    currentView = view;
    const mainHeader = document.querySelector('#main-content > header');
    if (mainHeader) {
        if (view === 'summary' || view === 'filterEdit') {
            mainHeader.classList.add('hidden');
        } else {
            mainHeader.classList.remove('hidden');
        }
    }
    if (view === 'schedule') {
        _scheduleAutoScroll = true;
    }
    if (!['schedule', 'week', 'month'].includes(view)) {
        closePlanPanel();
    }
    // 当切换到默认首页视图时，刷新待显示的彩蛋效果
    if (typeof settings !== 'undefined' && view === (settings.defaultView || 'task')) {
        if (typeof ee_flushPendingEffects === 'function') {
            ee_flushPendingEffects();
        }
    }
    renderView();
    renderLists();
    updateViewButtons();
    updateSidebarHighlight();
}

function updateViewButtons() {
    const views = ['task', 'schedule', 'week', 'month', 'quadrant', 'summary'];
    views.forEach(view => {
        const btn = document.getElementById(`view-btn-${view}`);
        if (btn) {
            if (view === currentView) {
                btn.className = 'px-4 py-2 rounded-lg bg-blue-500 text-white shadow-md view-btn-active';
            } else {
                btn.className = 'px-4 py-2 rounded-lg hover:bg-theme-tertiary transition text-theme-primary';
            }
        }
    });

    const planBtn = document.getElementById('plan-btn');
    if (planBtn) {
        if (['schedule', 'week', 'month'].includes(currentView)) {
            planBtn.classList.remove('hidden');
        } else {
            planBtn.classList.add('hidden');
            closePlanPanel();
        }
    }

    const todayBtn = document.getElementById('today-btn');
    if (todayBtn) {
        if (['schedule', 'week', 'month'].includes(currentView)) {
            todayBtn.classList.remove('hidden');
        } else {
            todayBtn.classList.add('hidden');
        }
    }
}

function renderView() {
    const container = document.getElementById('view-container');
    // 离开摘要页时停止彗星动画，防止 rAF 泄漏
    if (currentView !== 'summary') stopSummaryCometAnimation();

    switch (currentView) {
        case 'task':
            if (currentListId === '__archived__') {
                renderArchivedView(container);
            } else {
                renderTaskListView(container);
            }
            break;
        case 'schedule':
            renderScheduleView(container);
            break;
        case 'week':
            renderWeekView(container);
            break;
        case 'month':
            renderMonthView(container);
            break;
        case 'quadrant':
            renderQuadrantView(container);
            break;
        case 'summary':
            renderSummaryView(container);
            break;
        case 'filterEdit':
            renderFilterEditView(container);
            break;
        default:
            renderTaskListView(container);
            break;
    }

    updatePostponeButton();
}

function renderTaskCard(task) {
    const list = lists.find(l => l.id === task.listId);
    const timeDisplay = task.startTime ? formatDateTime(task.startTime) : '';

    return `
        <div class="task-item bg-theme-secondary rounded-xl p-4 shadow-theme card-hover border border-theme ${task.completed ? 'task-complete' : ''}"
             draggable="true"
             data-task-id="${task.id}"
             ondragstart="handleTaskDragStart(event, '${task.id}')"
             ondragover="handleTaskDragOver(event)"
             ondrop="handleTaskDrop(event, '${task.id}')"
             ondragend="handleTaskDragEnd(event)"
             onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')">
            <div class="flex items-start gap-4">
                <button onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" class="mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-blue-500 dark:border-white hover:border-blue-600 dark:hover:border-blue-300'}">
                    ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                </button>
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <h3 class="font-medium ${task.completed ? 'text-theme-muted' : 'text-theme-primary'} cursor-pointer hover:text-accent transition">${task.title || '新任务'}</h3>
                        ${task.important ? '<i class="fas fa-star text-yellow-500 text-sm"></i>' : ''}
                        ${task.urgent ? '<i class="fas fa-fire text-red-500 text-sm"></i>' : ''}
                        <span class="ml-auto">${renderTagCapsules(task, 2, 'right')}</span>
                    </div>
                    <div class="flex items-center gap-3 text-sm text-theme-secondary">
                        ${list ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${list.color}"></span><span class="sidebar-text">${list.name}</span></span>` : ''}
                        ${timeDisplay ? `<span class="sidebar-text cursor-pointer hover:text-accent transition"><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
                    </div>
                    ${renderSubtaskListDisplay(task) || (task.notes ? `<p class="mt-2 text-sm text-theme-secondary cursor-pointer hover:text-accent transition">${task.notes}</p>` : '')}

                    <div class="flex items-center gap-2 mt-3 pt-3 border-t border-theme">
                        <button onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')" class="flex items-center gap-1 px-3 py-1 text-xs text-theme-secondary hover:bg-theme-tertiary rounded-lg transition">
                            <i class="fas fa-clock"></i>
                            <span class="sidebar-text">${timeDisplay || '设置时间'}</span>
                        </button>
                        <button onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')" class="flex items-center gap-1 px-3 py-1 text-xs ${task.important || task.urgent ? 'text-yellow-600' : 'text-theme-secondary'} hover:bg-theme-tertiary rounded-lg transition">
                            <i class="fas fa-star"></i>
                            <span class="sidebar-text">${task.important || task.urgent ? (task.important ? '重要' : '') + (task.important && task.urgent ? ' / ' : '') + (task.urgent ? '紧急' : '') : '设置优先级'}</span>
                        </button>
                        <button onclick="event.stopPropagation(); startPomodoroForTask('${task.id}')" class="flex items-center gap-1 px-3 py-1 text-xs text-green-600 hover:bg-green-50 rounded-lg transition">
                            <i class="fas fa-stopwatch"></i>
                            <span class="sidebar-text">专注</span>
                        </button>
                        <button onclick="event.stopPropagation(); confirmDeleteTask('${task.id}')" class="ml-auto p-1 text-theme-muted hover:text-red-500 transition">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}
