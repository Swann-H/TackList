// ==================== 视图调度入口（从原 views.js 精简） ====================
// 本文件仅保留视图切换与渲染的调度逻辑，具体视图实现已拆分至：
//   - sidebarViews.js    : 侧边栏（清单/标签/过滤器）+ updateSidebarHighlight/Counts
//   - calendarViews.js   : 周视图 & 月视图
//   - quadrantView.js    : 四象限视图
//   - taskListView.js    : 任务列表视图 & 日程视图
//   - summaryView.js     : 摘要视图（统计/图表/动画）
// 公共工具函数（isTaskOverdue/isTaskOverdueToday/renderFocusButton/OVERDUE_TEXT_CLASS）已移至 utils.js

// 平滑过渡动画：视图切换方向性滑动过渡
// 切换到右侧/左侧的视图时，内容整体向左/右流动：旧视图向左/右滑出淡出，新视图自右/左接续滑入
function _playViewSwitchTransition(fxCtx, prevView, newView) {
    const order = (typeof getViewOrder === 'function'
        ? getViewOrder().map(v => v.id)
        : VIEW_ORDER_DEFAULT.slice()).concat(['summary', 'countdown', 'holiday']);
    const fromIdx = order.indexOf(prevView);
    const toIdx = order.indexOf(newView);
    if (fromIdx === -1 || toIdx === -1) return;
    const dir = toIdx > fromIdx ? 1 : -1;
    const container = fxCtx.el;
    // 清理上一次未完成的过渡残留
    container.querySelectorAll('.fx-view-ghost').forEach(g => g.remove());
    // 旧视图幽灵层：使用渲染前 cloneNode 的 DOM 快照（单遍克隆，避免 innerHTML 序列化+重新解析的双重开销）
    const ghost = fxCtx.ghost;
    ghost.className = 'fx-view-ghost ' + (dir > 0 ? 'fx-ghost-out-left' : 'fx-ghost-out-right');
    // 剥离幽灵层内所有 id，避免过渡期间 getElementById 命中幽灵层副本
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    // 同步旧视图滚动位置，避免幽灵层跳回顶部
    const ghostScrolls = ghost.querySelectorAll('.task-list-view');
    fxCtx.scrolls.forEach((s, i) => { if (ghostScrolls[i]) ghostScrolls[i].scrollTop = s; });
    // 过渡期间裁剪溢出并建立幽灵层定位上下文
    container.style.overflow = 'hidden';
    container.style.position = 'relative';
    container.appendChild(ghost);
    // 新视图自反方向接续滑入
    container.classList.remove('fx-enter-from-left', 'fx-enter-from-right');
    void container.offsetWidth; // 强制重排以重新触发动画
    container.classList.add(dir > 0 ? 'fx-enter-from-right' : 'fx-enter-from-left');
    setTimeout(() => {
        ghost.remove();
        container.style.overflow = '';
        container.style.position = '';
        container.classList.remove('fx-enter-from-left', 'fx-enter-from-right');
    }, 240);
}

function switchView(view) {
    const prevView = currentView;
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
    // 平滑过渡动画：渲染前捕获旧视图 DOM 快照（cloneNode 单遍克隆 + 滚动位置），用于方向性滑动过渡
    let fxCtx = null;
    const fxReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof settings !== 'undefined' && settings.smoothAnimations === true && prevView !== view && !fxReducedMotion) {
        const vc = document.getElementById('view-container');
        if (vc && vc.firstChild) {
            fxCtx = {
                el: vc,
                ghost: vc.cloneNode(true),
                scrolls: Array.from(vc.querySelectorAll('.task-list-view')).map(s => s.scrollTop)
            };
        }
    }
    renderView();
    if (fxCtx) {
        _playViewSwitchTransition(fxCtx, prevView, view);
    }
    renderLists();
    updateViewButtons();
    updateSidebarHighlight();
}

// 平滑过渡动画：视图切换按钮高亮指示条
// fx-smooth 开启时，激活态高亮由独立的指示条（#view-tab-indicator）呈现，
// 切换视图时指示条从旧按钮位置平滑滑动到新按钮位置
let _fxTabIndicatorResizeBound = false;
function _updateViewTabIndicator() {
    const viewTabs = document.getElementById('view-tabs');
    if (!viewTabs) return;
    const smoothFx = typeof settings !== 'undefined' && settings.smoothAnimations === true;
    const active = viewTabs.querySelector('.view-btn-active');
    let pill = document.getElementById('view-tab-indicator');
    if (!smoothFx || !active) {
        if (pill) pill.remove();
        return;
    }
    const isFirstPlace = !pill;
    if (isFirstPlace) {
        pill = document.createElement('div');
        pill.id = 'view-tab-indicator';
        pill.className = 'fx-no-trans'; // 首次定位不做过渡，避免从 (0,0) 飞入
        viewTabs.insertBefore(pill, viewTabs.firstChild);
        if (!_fxTabIndicatorResizeBound) {
            window.addEventListener('resize', _updateViewTabIndicator);
            _fxTabIndicatorResizeBound = true;
        }
    }
    pill.style.width = active.offsetWidth + 'px';
    pill.style.height = active.offsetHeight + 'px';
    pill.style.transform = 'translate(' + active.offsetLeft + 'px,' + active.offsetTop + 'px)';
    if (isFirstPlace) {
        void pill.offsetWidth; // 强制重排后恢复过渡能力
        pill.classList.remove('fx-no-trans');
    }
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
        // fx-smooth 开启时激活态高亮由指示条呈现，按钮仅保留文字反色（避免双层高亮）
        const smoothFx = typeof settings !== 'undefined' && settings.smoothAnimations === true;
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
                btn.className = smoothFx
                    ? 'px-4 py-2 rounded-lg text-white view-btn-active'
                    : 'px-4 py-2 rounded-lg bg-accent text-white shadow-md view-btn-active';
            } else if (v.enabled) {
                btn.className = 'px-4 py-2 rounded-lg hover:bg-theme-tertiary transition text-theme-primary';
            } else {
                btn.className = 'px-4 py-2 rounded-lg hover:bg-theme-tertiary transition text-theme-primary hidden';
            }
        });
    }
    // 平滑过渡动画：更新视图切换按钮高亮指示条位置
    _updateViewTabIndicator();

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
