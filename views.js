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
    // 切换视图前关闭所有已打开的视图配置面板，避免面板叠加
    if (typeof closeAllViewConfigPanels === 'function') closeAllViewConfigPanels();
    // 离开看板视图时，兜底清理「新增分组」后未命名即切走的残留空名分组
    if (currentView === 'kanban' && view !== 'kanban' && typeof leaveKanbanView === 'function') {
        leaveKanbanView();
    }
    if (currentView === 'month' && view !== 'month') {
        closeMonthDayPopover();
    }
    currentView = view;
    const mainHeader = document.querySelector('#main-content > header');
    if (mainHeader) {
        if (view === 'summary' || view === 'countdown' || view === 'holiday') {
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
    // 视图自定义：若当前为六可定制视图之一且已被隐藏，则回退默认首页（summary/countdown/holiday 不受影响）
    const _enabledNow = getEnabledViews();
    if (VIEW_ORDER_DEFAULT.indexOf(currentView) !== -1 && !_enabledNow.includes(currentView)) {
        currentView = getHomeView();
        // currentView 已变化，需重新渲染视图内容以匹配高亮
        renderView();
    }

    // 视图自定义：依据 viewOrder 动态重排 / 显隐桌面顶部导航
    const viewTabs = document.getElementById('view-tabs');
    if (viewTabs) {
        const order = getViewOrder();
        // 先按 order 顺序重排（appendChild 会把节点移到末尾，循环后即得到 order 顺序）
        order.forEach(function (v) {
            const btn = document.getElementById('view-btn-' + v.id);
            if (btn) viewTabs.appendChild(btn);
        });
        // 再设置显隐与激活态
        order.forEach(function (v) {
            const btn = document.getElementById('view-btn-' + v.id);
            if (!btn) return;
            if (v.enabled && v.id === currentView) {
                btn.className = 'px-4 py-2 rounded-lg bg-accent text-white shadow-md view-btn-active';
            } else if (v.enabled) {
                btn.className = 'px-4 py-2 rounded-lg hover:bg-theme-tertiary transition text-theme-primary';
            } else {
                btn.className = 'px-4 py-2 rounded-lg hover:bg-theme-tertiary transition text-theme-primary hidden';
            }
        });
    }

    const planBtn = document.getElementById('plan-btn');
    if (planBtn) {
        // 计划任务按钮：日程/周/月视图常驻；任务视图中仅当「分组依据」不为「时间」时显示
        const showPlan = ['schedule', 'week', 'month'].includes(currentView) ||
            (currentView === 'task' && currentListId !== '__archived__' && getTaskViewConfig().groupBy !== 'time');
        if (showPlan) {
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

    const toggleGroupsBtn = document.getElementById('toggle-all-groups-btn');
    if (toggleGroupsBtn) {
        if (currentView === 'task' && currentListId !== '__archived__') {
            toggleGroupsBtn.classList.remove('hidden');
        } else {
            toggleGroupsBtn.classList.add('hidden');
        }
    }

    // 看板视图配置按钮：仅看板视图显示
    const kbBtn = document.getElementById('kanban-config-btn');
    if (kbBtn) {
        if (currentView === 'kanban') kbBtn.classList.remove('hidden');
        else kbBtn.classList.add('hidden');
    }

    // 任务视图配置按钮：仅任务视图（非归档）显示
    const taskCfgBtn = document.getElementById('task-config-btn');
    if (taskCfgBtn) {
        if (currentView === 'task' && currentListId !== '__archived__') taskCfgBtn.classList.remove('hidden');
        else taskCfgBtn.classList.add('hidden');
    }

    // 象限/日程/周/月 视图配置按钮：仅各自视图显示
    [
        { id: 'quadrant-config-btn', view: 'quadrant' },
        { id: 'schedule-config-btn', view: 'schedule' },
        { id: 'week-config-btn', view: 'week' },
        { id: 'month-config-btn', view: 'month' }
    ].forEach(({ id, view }) => {
        const btn = document.getElementById(id);
        if (btn) {
            if (currentView === view) btn.classList.remove('hidden');
            else btn.classList.add('hidden');
        }
    });

    // 移动端底部导航栏激活状态同步
    if (typeof updateMobileBottomNav === 'function') updateMobileBottomNav();
}

function renderView() {
    const container = document.getElementById('view-container');
    // 清空底部导航栏（由各视图自行填充）
    const navBar = document.getElementById('view-nav-bar');
    if (navBar) navBar.innerHTML = '';
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
        case 'kanban':
            if (typeof renderKanbanView === 'function') {
                renderKanbanView(container);
            } else {
                renderTaskListView(container);
            }
            break;
        case 'summary':
            renderSummaryView(container);
            break;
        case 'countdown':
            if (typeof renderCountdownView === 'function') {
                renderCountdownView(container);
            } else {
                renderTaskListView(container);
            }
            break;
        case 'holiday':
            if (typeof renderHolidayView === 'function') {
                renderHolidayView(container);
            } else {
                renderTaskListView(container);
            }
            break;
        default:
            renderTaskListView(container);
            break;
    }

    updatePostponeButton();
}
