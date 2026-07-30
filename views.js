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
    // 清空顶部导航栏（由各视图自行填充）
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
