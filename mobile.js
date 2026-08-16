// ==================== 移动端适配（依据《移动端显示适配.md》v3.0） ====================
// 断点：768px（移动端/桌面端分界），640px 手机精细适配由 CSS 完成。
// 本文件职责：
//   1. 侧边栏抽屉（遮罩、关闭、点击导航后自动收起、分组折叠）
//   2. 顶部"更多"菜单（今天/计划/顺延）
//   3. 添加任务 FAB（滚动缩小变淡、软键盘弹出隐藏、番茄页隐藏）
//   4. Android 物理返回键拦截（history.pushState/popstate 层栈）
//   5. 周视图单日模式、月/周视图左右滑动切换、月视图点日期开全屏详情
//   6. 四象限卡片展开/折叠
//   7. 软键盘弹出时输入框 scrollIntoView 居中
//   8. 高频 API 操作防抖（完成任务）
//   9. 移动端使用原生日期/时间选择器（跳过自定义下拉）
//  10. 任务项长按弹出底部动作面板（Action Sheet）

// ---------- 设备判定 ----------
const _mobileMQ = window.matchMedia('(max-width: 768px)');
function isMobileView() { return _mobileMQ.matches; }

// ==================== 4. 返回键层栈 ====================
// 打开全屏页/抽屉时 pushState 推入虚拟状态；物理返回触发 popstate 时关闭顶层 UI。
const _mobileLayerStack = [];
let _mobileSuppressPopstate = false;

function mobilePushLayer(name, closeFn) {
    if (!isMobileView()) return;
    if (_mobileLayerStack.some(l => l.name === name)) return;
    _mobileLayerStack.push({ name, closeFn });
    try { history.pushState({ __tackLayer: name }, ''); } catch (e) { /* file:// 等场景降级 */ }
}

// UI 主动关闭时调用：把该层从栈中移除并同步 history（触发一次被抑制的 popstate）
function mobilePopLayer(name) {
    const idx = _mobileLayerStack.map(l => l.name).lastIndexOf(name);
    if (idx === -1) return;
    _mobileLayerStack.splice(idx, 1);
    _mobileSuppressPopstate = true;
    try { history.back(); } catch (e) { _mobileSuppressPopstate = false; }
}

window.addEventListener('popstate', function () {
    if (_mobileSuppressPopstate) { _mobileSuppressPopstate = false; return; }
    const layer = _mobileLayerStack.pop();
    if (layer) {
        try { layer.closeFn(); } catch (e) { console.error('关闭层级失败:', e); }
    }
    // 栈空时浏览器执行默认回退（离开页面），不做拦截
});

// ==================== 1. 侧边栏抽屉 ====================
function openMobileSidebar() {
    if (!isMobileView()) return;
    if (document.body.classList.contains('sidebar-open')) return;
    document.body.classList.add('sidebar-open');
    mobilePushLayer('sidebar', closeMobileSidebar);
}

function closeMobileSidebar() {
    if (!document.body.classList.contains('sidebar-open')) return;
    document.body.classList.remove('sidebar-open');
    mobilePopLayer('sidebar');
}

function toggleMobileSidebar() {
    if (document.body.classList.contains('sidebar-open')) closeMobileSidebar();
    else openMobileSidebar();
}

// 抽屉内点击导航项后自动收起（折叠分组头除外）
document.addEventListener('click', function (e) {
    if (!isMobileView() || !document.body.classList.contains('sidebar-open')) return;
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !sidebar.contains(e.target)) return;
    if (e.target.closest('.mobile-collapse-header')) return; // 分组折叠头：仅折叠，不收起
    const btn = e.target.closest('button, a');
    if (!btn) return;
    setTimeout(closeMobileSidebar, 120);
});

// ---------- 侧边栏分组折叠（清单默认展开，标签/过滤器默认折叠） ----------
const _mobileSidebarSections = [
    { selector: '#lists-container', defaultCollapsed: false },
    { selector: '#sidebar-tags-container', defaultCollapsed: true },
    { selector: '#sidebar-filters-container', defaultCollapsed: true }
];

function _initSidebarCollapsible() {
    _mobileSidebarSections.forEach(sec => {
        const content = document.querySelector(sec.selector);
        if (!content) return;
        const wrapper = content.closest('.mt-4');
        if (!wrapper) return;
        const header = wrapper.querySelector(':scope > .group');
        if (!header) return;
        content.classList.add('mobile-collapse-content');
        header.classList.add('mobile-collapse-header');
        // 注入折叠箭头（仅移动端显示，由 CSS 控制）
        if (!header.querySelector('.mobile-collapse-arrow')) {
            const label = header.querySelector('span');
            const arrow = document.createElement('i');
            arrow.className = 'fas fa-chevron-down text-xs text-theme-muted mobile-collapse-arrow';
            if (label) label.parentElement.insertBefore(arrow, label);
            else header.prepend(arrow);
        }
        header.addEventListener('click', function (e) {
            if (!isMobileView()) return;
            if (e.target.closest('button')) return; // 新建按钮不触发折叠
            const collapsed = content.classList.toggle('mobile-collapsed');
            header.classList.toggle('mobile-collapsed', collapsed);
            content.dataset.userToggled = '1';
        });
    });
    _applySidebarCollapseDefaults();
}

function _applySidebarCollapseDefaults() {
    if (!isMobileView()) return;
    _mobileSidebarSections.forEach(sec => {
        const content = document.querySelector(sec.selector);
        if (!content || content.dataset.userToggled) return;
        const wrapper = content.closest('.mt-4');
        const header = wrapper ? wrapper.querySelector(':scope > .group') : null;
        content.classList.toggle('mobile-collapsed', sec.defaultCollapsed);
        if (header) header.classList.toggle('mobile-collapsed', sec.defaultCollapsed);
    });
}

// ==================== 2. 顶部"更多"菜单 ====================
function toggleMobileMoreMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('mobile-more-menu');
    if (!menu) return;
    if (menu.classList.contains('hidden')) {
        _syncMobileMoreMenu();
        menu.classList.remove('hidden');
    } else {
        menu.classList.add('hidden');
    }
}

function closeMobileMoreMenu() {
    const menu = document.getElementById('mobile-more-menu');
    if (menu) menu.classList.add('hidden');
}

// 与原头部按钮（今天/计划/顺延）的显隐状态保持同步
function _syncMobileMoreMenu() {
    const pairs = [
        ['today-btn', 'mobile-more-today'],
        ['plan-btn', 'mobile-more-plan'],
        ['postpone-btn', 'mobile-more-postpone'],
        ['toggle-all-groups-btn', 'mobile-more-toggle-groups']
    ];
    pairs.forEach(([srcId, dstId]) => {
        const src = document.getElementById(srcId);
        const dst = document.getElementById(dstId);
        if (src && dst) dst.classList.toggle('hidden', src.classList.contains('hidden'));
    });
}

// 点击菜单外部关闭
document.addEventListener('click', function (e) {
    const menu = document.getElementById('mobile-more-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (!e.target.closest('#mobile-more-menu') && !e.target.closest('#mobile-more-btn')) {
        menu.classList.add('hidden');
    }
});

// ==================== 3. 添加任务 FAB ====================
let _fabScrollTimer = null;
let _fabLastScrollTop = 0;

function _getFab() { return document.getElementById('mobile-fab'); }

function updateMobileFabVisibility() {
    const fab = _getFab();
    if (!fab) return;
    const pomodoroPage = document.getElementById('pomodoro-page');
    const pomodoroOpen = pomodoroPage && !pomodoroPage.classList.contains('hidden');
    const keyboardOpen = document.activeElement && document.activeElement.matches &&
        document.activeElement.matches('input, textarea, select');
    fab.classList.toggle('fab-hidden', !!(pomodoroOpen || keyboardOpen));
}

// 监听视图内部滚动（scroll 不冒泡，用捕获阶段监听）
document.addEventListener('scroll', function (e) {
    if (!isMobileView()) return;
    const fab = _getFab();
    if (!fab || fab.classList.contains('fab-hidden')) return;
    const target = e.target;
    if (!target || !target.closest || !target.closest('#view-container')) return;
    const st = target.scrollTop || 0;
    if (st > _fabLastScrollTop + 4) {
        fab.classList.add('fab-mini'); // 向下滚动：缩小变淡
    } else if (st < _fabLastScrollTop - 4) {
        fab.classList.remove('fab-mini'); // 向上滚动：恢复
    }
    _fabLastScrollTop = st;
    if (_fabScrollTimer) clearTimeout(_fabScrollTimer);
    _fabScrollTimer = setTimeout(() => fab.classList.remove('fab-mini'), 300);
}, true);

// 软键盘弹出时隐藏 FAB，收起后恢复
document.addEventListener('focusin', function (e) {
    if (!isMobileView()) return;
    if (e.target && e.target.matches && e.target.matches('input, textarea, select')) {
        const fab = _getFab();
        if (fab) fab.classList.add('fab-hidden');
    }
});
document.addEventListener('focusout', function () {
    setTimeout(updateMobileFabVisibility, 120);
});

// ==================== 7. 软键盘弹出时输入框滚动居中 ====================
document.addEventListener('focusin', function (e) {
    if (!isMobileView()) return;
    const el = e.target;
    if (!el || !el.matches || !el.matches('input, textarea, select')) return;
    if (!el.closest('#task-detail-panel, #plan-panel, #add-task-modal, #settings-modal, #month-day-popover, #command-palette-overlay, #pomodoro-task-panel')) return;
    setTimeout(function () {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) { /* 忽略 */ }
    }, 350);
});

// ==================== 5. 周视图单日模式 ====================
let _mobileWeekSelectedDate = null; // 当前选中日期的 ISO 字符串

// 与 renderWeekView 相同的周起止计算逻辑
function _mobileComputeWeekDays() {
    const weekStart = new Date(currentDate);
    const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
    if (currentDate.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        days.push(d);
    }
    return days;
}

function enhanceWeekViewMobile() {
    const grid = document.getElementById('week-time-grid');
    if (!grid) return;
    const headerRow = grid.querySelector('.week-header-sticky > .flex-1.flex.min-w-0');
    const colRow = grid.querySelector(':scope > .flex > .flex-1.flex.relative');
    if (!headerRow || !colRow) return;
    const headerDays = Array.from(headerRow.children).filter(el => el.classList.contains('flex-1'));
    const colDays = Array.from(colRow.children).filter(el =>
        el.classList.contains('flex-1') && el.classList.contains('min-w-0') && el.classList.contains('relative'));
    if (headerDays.length !== 7 || colDays.length !== 7) return;

    const weekStrs = _mobileComputeWeekDays().map(d => formatDate(d));
    const todayStr = formatDate(new Date());
    if (!_mobileWeekSelectedDate || !weekStrs.includes(_mobileWeekSelectedDate)) {
        _mobileWeekSelectedDate = weekStrs.includes(todayStr) ? todayStr : weekStrs[0];
    }

    if (!isMobileView()) {
        colDays.forEach(el => el.classList.remove('mobile-week-hidden'));
        headerDays.forEach(el => el.classList.remove('mobile-week-selected'));
        return;
    }

    headerDays.forEach((el, i) => {
        const dateStr = weekStrs[i];
        el.dataset.mweekDate = dateStr;
        el.classList.add('mobile-week-day-header');
        el.classList.toggle('mobile-week-selected', dateStr === _mobileWeekSelectedDate);
        colDays[i].classList.toggle('mobile-week-hidden', dateStr !== _mobileWeekSelectedDate);
        if (!el.dataset.mweekBound) {
            el.dataset.mweekBound = '1';
            el.addEventListener('click', function () {
                // 全天任务/"+N" 等带有 stopPropagation 的点击不会到达这里
                _mobileWeekSelectedDate = el.dataset.mweekDate;
                enhanceWeekViewMobile();
            });
        }
    });

    // 左右滑动切换上一周/下一周
    _mobileBindSwipe(grid, function () { navigateWeek(1); }, function () { navigateWeek(-1); });
}

// ==================== 5. 月视图增强 ====================
function enhanceMonthViewMobile() {
    if (!isMobileView()) return;
    const mv = document.getElementById('month-view-container');
    if (!mv) return;
    _mobileBindSwipe(mv, function () { navigateMonth(1); }, function () { navigateMonth(-1); });
}

// 移动端点击日期格：打开当天全屏详情浮层（任务项/按钮自带 stopPropagation，不会触发）
document.addEventListener('click', function (e) {
    if (!isMobileView() || currentView !== 'month') return;
    const day = e.target.closest('.calendar-day');
    if (!day || !day.dataset.date) return;
    if (typeof openMonthDayPopover === 'function') openMonthDayPopover(day.dataset.date);
});

// ---------- 滑动手势封装（避开系统边缘返回手势区域） ----------
function _mobileBindSwipe(el, onSwipeLeft, onSwipeRight) {
    if (!el || el.dataset.mswipeBound) return;
    el.dataset.mswipeBound = '1';
    let sx = 0, sy = 0, st = 0, edge = false;
    el.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) { sx = 0; return; }
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        st = Date.now();
        // 起始位置在屏幕左右 24px 内时不拦截，让位给系统边缘返回手势
        edge = sx < 24 || sx > (window.innerWidth - 24);
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
        if (!sx || edge) { sx = 0; return; }
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;
        sx = 0;
        if (Date.now() - st > 600) return;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (dx < 0) { if (onSwipeLeft) onSwipeLeft(); }
        else { if (onSwipeRight) onSwipeRight(); }
    }, { passive: true });
}

// ==================== 6. 四象限卡片折叠 ====================
const _mobileQuadrantCollapsed = {}; // 用户折叠状态记忆（跨重渲染保持）

function enhanceQuadrantViewMobile() {
    const container = document.getElementById('quadrants-container');
    if (!container) return;
    container.querySelectorAll('.quadrant-card').forEach(card => {
        const key = card.dataset.quadrant;
        if (!key) return;
        if (!isMobileView()) {
            card.classList.remove('mobile-q-collapsed');
            return;
        }
        const collapsed = (key in _mobileQuadrantCollapsed)
            ? _mobileQuadrantCollapsed[key]
            : (key !== 'urgent-important'); // 默认仅展开"重要且紧急"
        card.classList.toggle('mobile-q-collapsed', collapsed);
        const header = card.querySelector('.quadrant-drag-handle');
        if (!header) return;
        // 注入折叠箭头
        const titleWrap = header.querySelector('h3');
        if (titleWrap && !titleWrap.querySelector('.mobile-q-arrow')) {
            const arrow = document.createElement('i');
            arrow.className = 'fas fa-chevron-down text-xs mobile-q-arrow';
            titleWrap.appendChild(arrow);
        }
        if (!header.dataset.mquadBound) {
            header.dataset.mquadBound = '1';
            header.addEventListener('click', function (e) {
                if (!isMobileView()) return;
                if (e.target.closest('button')) return; // "+" 添加按钮不触发折叠
                const c = card.classList.toggle('mobile-q-collapsed');
                _mobileQuadrantCollapsed[key] = c;
            });
        }
    });
}

// ==================== 10. 长按动作面板（Action Sheet） ====================
let _mobileActionSheetTaskId = null;
let _mobileLongPressTimer = null;

function _mobileShowActionSheet(taskId) {
    _mobileActionSheetTaskId = taskId;
    _mobileRemoveActionSheet();
    const task = (typeof tasks !== 'undefined') ? tasks.find(t => t.id === taskId) : null;
    if (!task) return;
    const overlay = document.createElement('div');
    overlay.id = 'mobile-action-sheet';
    overlay.innerHTML = `
        <div class="mobile-as-mask"></div>
        <div class="mobile-as-panel">
            <div class="mobile-as-title">${(task.title || '新任务').replace(/</g, '&lt;')}</div>
            <button class="mobile-as-item" data-act="edit"><i class="fas fa-pen w-5"></i>编辑</button>
            <button class="mobile-as-item" data-act="focus"><i class="fas fa-clock w-5 text-green-500"></i>开始专注</button>
            <button class="mobile-as-item mobile-as-danger" data-act="delete"><i class="fas fa-trash w-5"></i>删除</button>
            <button class="mobile-as-item mobile-as-cancel" data-act="cancel">取消</button>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
        const item = e.target.closest('.mobile-as-item');
        if (!item || item.dataset.act === 'cancel' || e.target.closest('.mobile-as-mask')) {
            _mobileRemoveActionSheet();
            return;
        }
        const id = _mobileActionSheetTaskId;
        _mobileRemoveActionSheet();
        if (item.dataset.act === 'edit') {
            openTaskDetailPanel(id);
        } else if (item.dataset.act === 'focus') {
            if (typeof startPomodoroForTask === 'function') startPomodoroForTask(id);
        } else if (item.dataset.act === 'delete') {
            if (typeof deleteTask === 'function') deleteTask(id);
        }
    });
    mobilePushLayer('actionSheet', _mobileRemoveActionSheet);
}

function _mobileRemoveActionSheet() {
    const el = document.getElementById('mobile-action-sheet');
    if (el) el.remove();
    mobilePopLayer('actionSheet');
}

// 长按任务项（任务列表/日程/象限/计划）弹出动作面板；滑动或短时间松开则取消
document.addEventListener('touchstart', function (e) {
    if (!isMobileView()) return;
    const item = e.target.closest('.task-list-item, .schedule-task-item, .plan-task-item, .month-task-item, .quadrant-drop-zone .task-item, .quadrant-drop-zone > div[onclick]');
    if (!item) return;
    const onclickAttr = item.getAttribute('onclick') || '';
    const m = onclickAttr.match(/openTaskDetailPanel\('([^']+)'\)/);
    if (!m) return;
    const taskId = m[1];
    const startX = e.touches[0].clientX, startY = e.touches[0].clientY;
    if (_mobileLongPressTimer) clearTimeout(_mobileLongPressTimer);
    _mobileLongPressTimer = setTimeout(function () {
        _mobileLongPressTimer = null;
        if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) { /* 忽略 */ } }
        _mobileShowActionSheet(taskId);
    }, 550);
    const cancel = function (ev) {
        if (ev.type === 'touchmove') {
            const t = ev.touches[0];
            if (Math.abs(t.clientX - startX) < 10 && Math.abs(t.clientY - startY) < 10) return;
        }
        if (_mobileLongPressTimer) { clearTimeout(_mobileLongPressTimer); _mobileLongPressTimer = null; }
        document.removeEventListener('touchmove', cancel);
        document.removeEventListener('touchend', cancel);
        document.removeEventListener('touchcancel', cancel);
    };
    document.addEventListener('touchmove', cancel, { passive: true });
    document.addEventListener('touchend', cancel);
    document.addEventListener('touchcancel', cancel);
}, { passive: true });

// ==================== 11. 任务列表侧滑手势（右滑完成 / 左滑删除，§5.3） ====================
// 仅作用于任务列表视图的 .task-list-item；桌面端无 touch 事件且 isMobileView() 守卫，不受影响。
// 与 §6.3 长按动作面板共存：侧滑锁定后取消长按计时器，避免双重触发。
(function () {
    const SWIPE_ACTION = 72;     // 触发完成的水平位移阈值（px）
    const LOCK_MIN = 8;          // 判定为水平滑动的最小位移（px）
    const EDGE = 24;             // 屏幕左右避让区，让位给系统级边缘返回手势
    const MAX_PULL = 140;        // 最大视觉位移
    let _sw = null;              // 当前滑动状态
    let _swipeSuppressClick = false;

    function _swipeTaskId(item) {
        const cb = item.querySelector('button[onclick*="toggleTaskComplete"]');
        if (cb) {
            const m = (cb.getAttribute('onclick') || '').match(/toggleTaskComplete\('([^']+)'\)/);
            if (m) return m[1];
        }
        const m = (item.getAttribute('onclick') || '').match(/openTaskDetailPanel\('([^']+)'\)/);
        return m ? m[1] : null;
    }

    function _containerOf(item) {
        const c = item.closest('.task-list-view') || item.parentElement;
        if (c && getComputedStyle(c).position === 'static') c.style.position = 'relative';
        return c;
    }

    function _offsetTopWithin(el, ancestor) {
        let t = 0, node = el;
        while (node && node !== ancestor) { t += node.offsetTop; node = node.offsetParent; }
        return t;
    }

    function _makeReveal(item, dx) {
        const c = _containerOf(item);
        const reveal = document.createElement('div');
        reveal.className = 'task-swipe-reveal ' + (dx > 0 ? 'sr-complete' : 'sr-delete');
        reveal.style.top = _offsetTopWithin(item, c) + 'px';
        reveal.style.left = '0';
        reveal.style.right = '0';
        reveal.style.height = item.offsetHeight + 'px';
        reveal.innerHTML = dx > 0
            ? '<span class="sr-icon"><i class="fas fa-check"></i></span><span>完成</span>'
            : '<span>删除</span><span class="sr-icon"><i class="fas fa-trash"></i></span>';
        c.appendChild(reveal);
        return reveal;
    }

    function _refreshReveal(item, dx) {
        let reveal = item._swipeReveal;
        if (!reveal) { reveal = _makeReveal(item, dx); item._swipeReveal = reveal; }
        reveal.className = 'task-swipe-reveal ' + (dx > 0 ? 'sr-complete' : 'sr-delete');
        reveal.innerHTML = dx > 0
            ? '<span class="sr-icon"><i class="fas fa-check"></i></span><span>完成</span>'
            : '<span>删除</span><span class="sr-icon"><i class="fas fa-trash"></i></span>';
        // 仅展示与位移成比例的那一段，其余裁剪
        if (dx > 0) { reveal.style.clipPath = 'inset(0 ' + (100 - Math.min(100, dx / MAX_PULL * 100)) + '% 0 0)'; }
        else { reveal.style.clipPath = 'inset(0 0 0 ' + (100 - Math.min(100, -dx / MAX_PULL * 100)) + '%)'; }
    }

    function _clearReveal(item) {
        if (item && item._swipeReveal) { item._swipeReveal.remove(); item._swipeReveal = null; }
    }

    function _translate(item, dx) {
        let tx = dx;
        if (tx > MAX_PULL) tx = MAX_PULL + (tx - MAX_PULL) * 0.2;
        if (tx < -MAX_PULL) tx = -MAX_PULL + (tx + MAX_PULL) * 0.2;
        item.style.transition = 'none';
        item.style.transform = 'translateX(' + tx + 'px)';
    }

    function _reset(item) {
        if (!item) return;
        item.style.transition = 'transform 0.2s ease';
        item.style.transform = '';
        _clearReveal(item);
    }

    function _onSwipeStart(e) {
        if (!isMobileView() || e.touches.length !== 1) { _sw = null; return; }
        const item = e.target.closest('.task-list-item');
        if (!item) { _sw = null; return; }
        if (_mobileLongPressTimer) { clearTimeout(_mobileLongPressTimer); _mobileLongPressTimer = null; }
        const id = _swipeTaskId(item);
        if (!id) { _sw = null; return; }
        const sx = e.touches[0].clientX, sy = e.touches[0].clientY;
        _sw = { item, id, sx, sy, dx: 0, dy: 0, locked: false,
                edge: sx < EDGE || sx > (window.innerWidth - EDGE) };
        document.addEventListener('touchmove', _onSwipeMove, { passive: false });
        document.addEventListener('touchend', _onSwipeEnd);
        document.addEventListener('touchcancel', _onSwipeEnd);
    }

    function _onSwipeMove(e) {
        if (!_sw) return;
        const t = e.touches[0];
        const dx = t.clientX - _sw.sx, dy = t.clientY - _sw.sy;
        _sw.dx = dx; _sw.dy = dy;
        if (!_sw.locked) {
            if (Math.abs(dx) > LOCK_MIN && Math.abs(dx) > Math.abs(dy)) _sw.locked = true;
            else if (Math.abs(dy) > LOCK_MIN && Math.abs(dy) >= Math.abs(dx)) { _endSwipe(false); return; }
            else return;
        }
        if (_sw.edge) { _endSwipe(false); return; }
        if (e.cancelable) e.preventDefault(); // 阻止页面横向滚动/橡皮筋
        _sw.item.style.zIndex = '2';
        _translate(_sw.item, dx);
        _refreshReveal(_sw.item, dx);
    }

    function _onSwipeEnd() {
        if (!_sw) return;
        const s = _sw, dx = s.dx;
        if (s.locked && !s.edge && Math.abs(dx) > SWIPE_ACTION) {
            const dir = dx > 0 ? 1 : -1;
            const id = s.id;
            // 滑动飞出动画
            s.item.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
            s.item.style.transform = 'translateX(' + (dir * (window.innerWidth + 60)) + 'px)';
            s.item.style.opacity = '0';
            _swipeSuppressClick = true;
            setTimeout(() => { _swipeSuppressClick = false; }, 350);
            if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
            if (dx > 0) { if (typeof toggleTaskComplete === 'function') toggleTaskComplete(id); }
            else { if (typeof deleteTask === 'function') deleteTask(id); }
            _clearReveal(s.item);
        } else {
            _reset(s.item);
        }
        _endSwipe(true);
    }

    function _endSwipe(keepTransform) {
        if (_sw && !keepTransform) _reset(_sw.item);
        if (_sw) { _sw.item.style.zIndex = ''; }
        _sw = null;
        document.removeEventListener('touchmove', _onSwipeMove, { passive: false });
        document.removeEventListener('touchend', _onSwipeEnd);
        document.removeEventListener('touchcancel', _onSwipeEnd);
    }

    // 侧滑触发动作后抑制随后的 click（避免误开详情）
    document.addEventListener('click', function (e) {
        if (_swipeSuppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    document.addEventListener('touchstart', _onSwipeStart, { passive: true });
})();

// ==================== 8. 高频操作防抖（防止网络不佳时重复点击） ====================
const _mobileApiGuard = {};
function _mobileDebounced(taskId, fn, args) {
    const now = Date.now();
    if (_mobileApiGuard[taskId] && now - _mobileApiGuard[taskId] < 600) return;
    _mobileApiGuard[taskId] = now;
    fn.apply(null, args || []);
}

// ==================== 9. 渲染/开关函数包装 ====================
// —— 周视图 ——
if (typeof renderWeekView === 'function') {
    const _origRenderWeekView = renderWeekView;
    renderWeekView = function (container) {
        _origRenderWeekView(container);
        enhanceWeekViewMobile();
    };
}

// —— 月视图 ——
if (typeof renderMonthView === 'function') {
    const _origRenderMonthView = renderMonthView;
    renderMonthView = function (container) {
        _origRenderMonthView(container);
        enhanceMonthViewMobile();
    };
}

// —— 四象限 ——
if (typeof renderQuadrantView === 'function') {
    const _origRenderQuadrantView = renderQuadrantView;
    renderQuadrantView = function (container) {
        _origRenderQuadrantView(container);
        enhanceQuadrantViewMobile();
    };
}

// —— 计划面板：移动端取消拖拽排序 ——
if (typeof renderPlanPanel === 'function') {
    const _origRenderPlanPanel = renderPlanPanel;
    renderPlanPanel = function () {
        _origRenderPlanPanel.apply(this, arguments);
        if (isMobileView()) {
            document.querySelectorAll('#plan-panel .plan-task-item[draggable]').forEach(el => {
                el.removeAttribute('draggable');
            });
        }
    };
}

// —— 任务详情面板：返回键层 ——
if (typeof openTaskDetailPanel === 'function') {
    const _origOpenTaskDetailPanel = openTaskDetailPanel;
    openTaskDetailPanel = function () {
        const panel = document.getElementById('task-detail-panel');
        const wasHidden = panel ? panel.classList.contains('hidden') : true;
        _origOpenTaskDetailPanel.apply(this, arguments);
        if (isMobileView() && panel && wasHidden && !panel.classList.contains('hidden')) {
            mobilePushLayer('detail', function () { closeTaskDetailPanel(); });
        }
    };
}
if (typeof closeTaskDetailPanel === 'function') {
    const _origCloseTaskDetailPanel = closeTaskDetailPanel;
    closeTaskDetailPanel = function () {
        _origCloseTaskDetailPanel.apply(this, arguments);
        mobilePopLayer('detail');
    };
}

// —— 计划面板：返回键层 ——
if (typeof togglePlanPanel === 'function') {
    const _origTogglePlanPanel = togglePlanPanel;
    togglePlanPanel = function () {
        _origTogglePlanPanel.apply(this, arguments);
        if (typeof planPanelOpen !== 'undefined' && planPanelOpen) {
            mobilePushLayer('plan', function () { closePlanPanel(); });
        } else {
            mobilePopLayer('plan');
        }
    };
}
if (typeof closePlanPanel === 'function') {
    const _origClosePlanPanel = closePlanPanel;
    closePlanPanel = function () {
        _origClosePlanPanel.apply(this, arguments);
        mobilePopLayer('plan');
    };
}

// —— 设置弹窗：返回键层 ——
if (typeof openSettingsModal === 'function') {
    const _origOpenSettingsModal = openSettingsModal;
    openSettingsModal = function () {
        _origOpenSettingsModal.apply(this, arguments);
        mobilePushLayer('settings', function () { closeSettingsModal(); });
    };
}
if (typeof closeSettingsModal === 'function') {
    const _origCloseSettingsModal = closeSettingsModal;
    closeSettingsModal = function () {
        _origCloseSettingsModal.apply(this, arguments);
        mobilePopLayer('settings');
    };
}

// —— 番茄专注页：返回键层 + FAB 隐藏 + 移动端默认收起概况为顶部紧凑条 ——
if (typeof switchToPomodoroPage === 'function') {
    const _origSwitchToPomodoroPage = switchToPomodoroPage;
    switchToPomodoroPage = function () {
        _origSwitchToPomodoroPage.apply(this, arguments);
        mobilePushLayer('pomodoro', function () { closePomodoroPage(); });
        if (isMobileView()) {
            // 概况面板移动端默认收起为顶部紧凑条（仅标题行），点击把手或上滑展开
            const rightPanel = document.getElementById('pomodoro-right-panel');
            if (rightPanel && !rightPanel.classList.contains('mobile-overview-collapsed')) {
                rightPanel.classList.add('mobile-overview-collapsed');
                const icon = document.getElementById('pomodoro-overview-toggle-icon');
                if (icon) icon.className = 'fas fa-chevron-down text-sm';
            }
            _initPomodoroOverviewGesture();
            closeMobileSidebar();
        }
        updateMobileFabVisibility();
    };
}

// 专注概况面板：移动端顶部紧凑条 展开/收起 切换
function togglePomodoroOverviewMobile() {
    const panel = document.getElementById('pomodoro-right-panel');
    if (!panel || !isMobileView()) return;
    const collapsed = panel.classList.toggle('mobile-overview-collapsed');
    const icon = document.getElementById('pomodoro-overview-toggle-icon');
    if (icon) icon.className = collapsed ? 'fas fa-chevron-down text-sm' : 'fas fa-chevron-up text-sm';
}

// 专注概况面板：下滑收起 / 上滑展开 手势（历史记录区独立滚动，不触发）
let _pomodoroGestureInited = false;
function _initPomodoroOverviewGesture() {
    if (_pomodoroGestureInited) return;
    const panel = document.getElementById('pomodoro-right-panel');
    if (!panel) return;
    _pomodoroGestureInited = true;
    let startY = null, startX = null;
    panel.addEventListener('touchstart', function (e) {
        // 历史记录区：交由其自身滚动，不处理收起手势
        if (e.target.closest('#pomodoro-history')) { startY = null; return; }
        if (e.touches.length !== 1) { startY = null; return; }
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
    }, { passive: true });
    panel.addEventListener('touchend', function (e) {
        if (startY === null) return;
        const t = e.changedTouches[0];
        const dy = t.clientY - startY;
        const dx = t.clientX - startX;
        startY = null;
        if (Math.abs(dx) > Math.abs(dy)) return; // 横向滑动忽略
        if (dy > 50) {
            // 下滑 → 收起
            panel.classList.add('mobile-overview-collapsed');
            const icon = document.getElementById('pomodoro-overview-toggle-icon');
            if (icon) icon.className = 'fas fa-chevron-down text-sm';
        } else if (dy < -50) {
            // 上滑 → 展开
            panel.classList.remove('mobile-overview-collapsed');
            const icon = document.getElementById('pomodoro-overview-toggle-icon');
            if (icon) icon.className = 'fas fa-chevron-up text-sm';
        }
    }, { passive: true });
}
if (typeof closePomodoroPage === 'function') {
    const _origClosePomodoroPage = closePomodoroPage;
    closePomodoroPage = function () {
        _origClosePomodoroPage.apply(this, arguments);
        mobilePopLayer('pomodoro');
        updateMobileFabVisibility();
    };
}

// —— 命令面板：返回键层 ——
if (typeof openCommandPalette === 'function') {
    const _origOpenCommandPalette = openCommandPalette;
    openCommandPalette = function () {
        _origOpenCommandPalette.apply(this, arguments);
        mobilePushLayer('palette', function () { closeCommandPalette(); });
    };
}
if (typeof closeCommandPalette === 'function') {
    const _origCloseCommandPalette = closeCommandPalette;
    closeCommandPalette = function () {
        _origCloseCommandPalette.apply(this, arguments);
        mobilePopLayer('palette');
    };
}

// —— 月视图日期浮层：返回键层 ——
if (typeof openMonthDayPopover === 'function') {
    const _origOpenMonthDayPopover = openMonthDayPopover;
    openMonthDayPopover = function () {
        _origOpenMonthDayPopover.apply(this, arguments);
        mobilePushLayer('monthPopover', function () { closeMonthDayPopover(); });
    };
}
if (typeof closeMonthDayPopover === 'function') {
    const _origCloseMonthDayPopover = closeMonthDayPopover;
    closeMonthDayPopover = function () {
        _origCloseMonthDayPopover.apply(this, arguments);
        mobilePopLayer('monthPopover');
    };
}

// —— 完成任务：移动端防抖 ——
if (typeof toggleTaskComplete === 'function') {
    const _origToggleTaskComplete = toggleTaskComplete;
    toggleTaskComplete = function (taskId) {
        if (isMobileView()) {
            _mobileDebounced('toggle_' + taskId, _origToggleTaskComplete, [taskId]);
        } else {
            _origToggleTaskComplete.apply(this, arguments);
        }
    };
}
if (typeof toggleTaskDetailComplete === 'function') {
    const _origToggleTaskDetailComplete = toggleTaskDetailComplete;
    toggleTaskDetailComplete = function () {
        if (isMobileView()) {
            _mobileDebounced('toggle_detail_' + currentDetailTaskId, _origToggleTaskDetailComplete, []);
        } else {
            _origToggleTaskDetailComplete.apply(this, arguments);
        }
    };
}

// —— 日期/时间选择器：移动端使用原生控件，跳过自定义下拉 ——
if (typeof openDatePicker === 'function') {
    const _origOpenDatePicker = openDatePicker;
    openDatePicker = function (inputEl, pickerId) {
        if (isMobileView()) return; // 让浏览器弹出原生 date picker
        _origOpenDatePicker.apply(this, arguments);
    };
}
if (typeof openTimePicker === 'function') {
    const _origOpenTimePicker = openTimePicker;
    openTimePicker = function (inputEl, pickerId) {
        if (isMobileView()) return; // 让浏览器弹出原生 time picker
        _origOpenTimePicker.apply(this, arguments);
    };
}

// ==================== 断点切换处理 ====================
function _onMobileBreakpointChange() {
    if (isMobileView()) {
        _applySidebarCollapseDefaults();
        enhanceWeekViewMobile();
        enhanceMonthViewMobile();
        enhanceQuadrantViewMobile();
        if (typeof renderMobileBottomNav === 'function') renderMobileBottomNav();
    } else {
        // 还原桌面端状态
        document.body.classList.remove('sidebar-open');
        document.querySelectorAll('#sidebar .mobile-collapsed').forEach(el => el.classList.remove('mobile-collapsed'));
        document.querySelectorAll('.mobile-week-hidden').forEach(el => el.classList.remove('mobile-week-hidden'));
        document.querySelectorAll('.mobile-week-selected').forEach(el => el.classList.remove('mobile-week-selected'));
        document.querySelectorAll('.mobile-q-collapsed').forEach(el => el.classList.remove('mobile-q-collapsed'));
        closeMobileMoreMenu();
        _mobileRemoveActionSheet();
        // 清理移动端层栈，避免桌面端浏览器返回键误触发移动端关闭逻辑
        _mobileLayerStack.length = 0;
        _mobileSuppressPopstate = false;
    }
    updateMobileFabVisibility();
}
if (_mobileMQ.addEventListener) {
    _mobileMQ.addEventListener('change', _onMobileBreakpointChange);
} else if (_mobileMQ.addListener) { // 旧版 Safari 兜底
    _mobileMQ.addListener(_onMobileBreakpointChange);
}

// ==================== 12. 底部视图切换导航栏 ====================
const _mobileNavViewMap = {
    task: 'task', schedule: 'schedule', week: 'week', month: 'month',
    quadrant: 'quadrant', kanban: 'kanban', summary: 'summary', countdown: 'countdown',
    holiday: 'holiday'
};

function toggleMobileNavMore(event) {
    if (!isMobileView()) return;
    event.stopPropagation();
    const menu = document.getElementById('mobile-nav-more-menu');
    if (!menu) return;
    const hidden = menu.classList.contains('hidden');
    if (hidden) {
        menu.classList.remove('hidden');
        // 点击其他区域关闭
        setTimeout(() => {
            document.addEventListener('click', closeMobileNavMore, { once: true });
        }, 0);
    } else {
        menu.classList.add('hidden');
    }
}

function closeMobileNavMore() {
    const menu = document.getElementById('mobile-nav-more-menu');
    if (menu) menu.classList.add('hidden');
}

function renderMobileBottomNav() {
    const main = document.getElementById('mobile-nav-main');
    if (!main) return;
    const moreBtn = document.getElementById('mobile-nav-more-btn');
    // 移除既有的动态视图项（保留「更多」按钮）
    Array.from(main.querySelectorAll('.mobile-nav-item')).forEach(function (btn) {
        if (btn.id !== 'mobile-nav-more-btn') btn.remove();
    });
    // 按 viewOrder 的启用项重建主视图按钮
    getEnabledViews().forEach(function (id) {
        const def = VIEW_DEFS[id];
        if (!def) return;
        const btn = document.createElement('button');
        btn.setAttribute('onclick', "switchView('" + id + "')");
        btn.setAttribute('data-mnav', id);
        btn.className = 'mobile-nav-item flex flex-col items-center justify-center w-12 h-full text-theme-secondary';
        btn.innerHTML = '<i class="' + def.icon + ' text-lg"></i><span class="text-[10px] mt-0.5">' + def.label + '</span>';
        if (moreBtn) main.insertBefore(btn, moreBtn);
        else main.appendChild(btn);
    });
}

function updateMobileBottomNav() {
    if (!isMobileView()) return;
    // 检查是否需要重建（按钮数量或顺序变化）；「更多」按钮（mobile-nav-more-btn）常驻，不计入比较
    const order = getViewOrder().filter(v => v.enabled);
    const existingBtns = document.querySelectorAll('#mobile-bottom-nav .mobile-nav-item:not(#mobile-nav-more-btn)');
    let needsRebuild = existingBtns.length !== order.length;
    if (!needsRebuild) {
        existingBtns.forEach((btn, i) => {
            if (btn.dataset.mnav !== _mobileNavViewMap[order[i].id]) needsRebuild = true;
        });
    }
    if (needsRebuild && typeof renderMobileBottomNav === 'function') renderMobileBottomNav();
    // 切换 active 状态
    document.querySelectorAll('#mobile-bottom-nav .mobile-nav-item').forEach(btn => {
        const key = btn.dataset.mnav;
        btn.classList.toggle('active', key === _mobileNavViewMap[currentView]);
    });
}

// ==================== 初始化 ====================
_initSidebarCollapsible();
_applySidebarCollapseDefaults();
updateMobileFabVisibility();
