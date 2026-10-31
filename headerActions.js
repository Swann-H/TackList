// ==================== 视图右上角操作按钮溢出与「更多」面板 ====================
// 规则：
// - 显示数量上限含「更多」按钮；「添加任务」与「从模板添加」共用 add-task-group，算 1 个。
// - 「更多」按钮固定在该级按钮最左侧；超出时按 DOM 顺序从最左侧收起，右侧按钮优先保留。
// - 窄屏（≤768px）固定只显示「更多」，面板列出窄屏下被收起的操作。
// - 桌面/鼠标设备悬浮展开（与「从模板添加」一致），触摸设备点击展开。

let _headerOverflowResizeTimer = null;
let _headerOverflowMainTimer = null;
let _headerOverflowPanelTimer = null;

// 头部按钮的语义色与图标由 utils.js 的 VIEW_ACTION_COLOR_HEX / VIEW_ACTION_DEFS 统一维护，设置面板与「更多」面板保持一致。

// 逻辑操作 id → 头部实际元素。「视图配置」聚合 6 个视图各自的配置按钮，占同一个排序槽位。
// 「同步」聚合外部日历订阅同步与 WebDAV 云同步，按钮本体包在 #header-sync-group 内（含悬浮面板），
// 因此按整组计为一个操作单位。
const _HEADER_ACTION_SELECTORS = {
    sync: ['header-sync-group'],
    today: ['today-btn'],
    plan: ['plan-btn'],
    postpone: ['postpone-btn'],
    toggleAll: ['toggle-all-groups-btn'],
    batch: ['batch-select-btn'],
    viewConfig: ['kanban-config-btn', 'task-config-btn', 'schedule-config-btn', 'week-config-btn', 'month-config-btn', 'quadrant-config-btn'],
    addTask: ['add-task-group']
};

function _headerActionElsForId(id) {
    return (_HEADER_ACTION_SELECTORS[id] || []).map(function (elId) {
        return document.getElementById(elId);
    }).filter(Boolean);
}

// 供设置面板过滤当前入口不存在的操作（如离线版没有外部日历同步）
function headerActionExists(id) {
    return _headerActionElsForId(id).length > 0;
}

// 当前视图下该操作是否可用（用于设置面板标出将收进「更多」的操作）
function headerActionAvailable(id) {
    return _headerActionElsForId(id).some(function (el) {
        return !el.classList.contains('hidden');
    });
}

function _getViewActionOrderSafe() {
    if (typeof getViewActionOrder === 'function') return getViewActionOrder();
    return (typeof VIEW_ACTION_DEFAULT_ORDER !== 'undefined') ? VIEW_ACTION_DEFAULT_ORDER.slice() : [];
}

// 按配置顺序物理重排头部操作按钮（「更多」固定最左）。顺序未变时直接返回，避免无谓 DOM 移动。
function applyHeaderActionOrder() {
    const host = document.getElementById('header-actions');
    const more = document.getElementById('header-more-group');
    if (!host || !more) return;

    const desired = [];
    _getViewActionOrderSafe().forEach(function (id) {
        _headerActionElsForId(id).forEach(function (el) {
            if (desired.indexOf(el) === -1) desired.push(el);
        });
    });
    // 兜底：未来新增但未登记的操作按钮仍保持可用，追加在末尾
    Array.prototype.forEach.call(host.children, function (el) {
        if (el === more) return;
        if (!el.matches || !el.matches('button, .add-task-group, .header-sync-group')) return;
        if (desired.indexOf(el) === -1) desired.push(el);
    });

    const current = Array.prototype.filter.call(host.children, function (el) {
        return el !== more && el.matches && el.matches('button, .add-task-group, .header-sync-group');
    });
    const same = current.length === desired.length && current.every(function (el, i) { return el === desired[i]; });
    if (same && host.firstElementChild === more) return;

    if (host.firstElementChild !== more) host.insertBefore(more, host.firstElementChild);
    const frag = document.createDocumentFragment();
    desired.forEach(function (el) { frag.appendChild(el); });
    host.appendChild(frag);
}

function _headerIsNarrow() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function getViewActionLimit() {
    const n = (typeof settings !== 'undefined' && settings)
        ? parseInt(settings.viewActionLimit, 10) : 8;
    return isNaN(n) ? 8 : Math.max(1, Math.min(10, n));
}

// 头部可收纳的操作元素：header-actions 的直接子按钮 + 添加任务组 + 同步组（批量工具条等容器不计）
function _headerActionEls() {
    const host = document.getElementById('header-actions');
    if (!host) return [];
    return Array.prototype.filter.call(host.children, function (el) {
        return el.matches && el.matches('button, .add-task-group, .header-sync-group');
    });
}

function _headerActionColor(el) {
    const m = String(el.className || '').match(/border-(blue|green|orange|teal|cyan|indigo|purple|red|amber|pink|slate)-500/);
    return m ? m[1] : '';
}

function _makeHeaderMoreItem(iconClass, label, color, disabled, run) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'header-more-item';
    btn.setAttribute('role', 'menuitem');

    const circle = document.createElement('span');
    circle.className = 'header-more-icon';
    circle.setAttribute('aria-hidden', 'true');
    const colorValue = VIEW_ACTION_COLOR_HEX[color] || '';
    if (colorValue) circle.style.setProperty('--more-color', colorValue);

    const icon = document.createElement('i');
    icon.className = iconClass;
    circle.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'header-more-label';
    text.textContent = label;

    btn.appendChild(circle);
    btn.appendChild(text);

    if (disabled) {
        btn.disabled = true;
        btn.classList.add('is-disabled');
    } else {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeHeaderMoreMenu();
            try {
                run();
            } catch (err) {
                console.error('更多面板操作失败:', err);
            }
        });
    }
    return btn;
}

function _appendHeaderMoreEntries(frag, el) {
    // 添加任务组：显示上算 1 个按钮，面板内拆成两个操作
    if (el.id === 'add-task-group') {
        frag.appendChild(_makeHeaderMoreItem('fas fa-plus', '添加任务', 'purple', false, function () {
            if (typeof openAddTaskModal === 'function') openAddTaskModal();
        }));
        frag.appendChild(_makeHeaderMoreItem('fas fa-layer-group', '从模板添加', 'purple', false, function () {
            if (typeof openTaskTemplatePicker === 'function') openTaskTemplatePicker();
        }));
        return;
    }

    // 同步组：被收进「更多」时面板无法锚定，改为直达配置页（窄屏与桌面溢出均走这里）
    if (el.id === 'header-sync-group') {
        frag.appendChild(_makeHeaderMoreItem(
            'fas fa-cloud-arrow-down',
            '外部日历同步',
            el.dataset.syncColor || 'cyan',
            false,
            function () {
                if (typeof gotoSyncSettingsFromHeader === 'function') gotoSyncSettingsFromHeader();
            }
        ));
        return;
    }

    const iconEl = el.querySelector('i');
    let iconClass = iconEl ? iconEl.className : 'fas fa-circle';
    // 去掉布局类，仅保留图标类
    iconClass = iconClass.replace(/\b[wh]-\S+/g, '').replace(/\s+/g, ' ').trim();

    let label = el.getAttribute('title') || '';
    if (!label) label = (el.textContent || '').trim() || '操作';

    const item = _makeHeaderMoreItem(
        iconClass,
        label,
        _headerActionColor(el),
        !!el.disabled,
        function () { el.click(); }
    );
    item.dataset.actionId = el.id;
    frag.appendChild(item);
}

function renderHeaderMoreMenu() {
    const menu = document.getElementById('mobile-more-menu');
    if (!menu) return;
    let items;
    if (_headerIsNarrow()) {
        // 窄屏固定只显示「更多」：列出被 CSS 隐藏的操作；仍可见的按钮（如视图配置）不重复收录
        items = _headerActionEls().filter(function (el) {
            return !el.classList.contains('hidden') && getComputedStyle(el).display === 'none';
        });
    } else {
        items = _headerActionEls().filter(function (el) {
            return el.classList.contains('header-action-collapsed');
        });
    }

    const frag = document.createDocumentFragment();
    items.forEach(function (el) { _appendHeaderMoreEntries(frag, el); });
    menu.innerHTML = '';
    menu.appendChild(frag);
    menu.classList.toggle('is-empty', items.length === 0);
    _updateHeaderMoreAlign();
}

// 「更多」位于按钮组最左侧：默认面板左对齐；右侧空间不足时改为右对齐，避免超出视口
function _updateHeaderMoreAlign() {
    const group = document.getElementById('header-more-group');
    const menu = document.getElementById('mobile-more-menu');
    if (!group || !menu) return;
    group.classList.remove('align-right');
    const width = menu.offsetWidth || 190;
    const left = group.getBoundingClientRect().left;
    if (left + width > window.innerWidth - 12) group.classList.add('align-right');
}

// 面板打开瞬间主区还可能处于过渡起点（宽度未减 384px），按最终宽度预判一次，
// 避免「先溢出、等过渡结束才收纳」的闪烁。
function _headerEffectiveWidth(header) {
    let width = header.clientWidth;
    const panelOpen = document.body.classList.contains('detail-panel-open')
        || document.body.classList.contains('fx-detail-open');
    if (!panelOpen) return width;
    const main = document.getElementById('main-content');
    const sidebar = document.getElementById('sidebar');
    if (!main || !sidebar) return width;
    const fullMain = window.innerWidth - sidebar.offsetWidth;
    // 主区还没缩窄 → 预判两个 384px 面板中的一个
    if (main.clientWidth >= fullMain - 4) width -= 384;
    return width;
}

// 当前宽度下 Tab 或 Header 是否已经放不下：用于在数量上限之外继续提前收纳动作按钮。
// 直接比较「左侧内容宽 + 间距 + 动作组宽」与 Header 可用宽，避免依赖 Tab 容器自身的收缩结果。
function _headerNeedsMoreRoom() {
    const header = document.getElementById('main-header');
    const tabs = document.getElementById('view-tabs');
    const menu = document.getElementById('mobile-menu-btn');
    const actions = document.getElementById('header-actions');
    if (!header || !tabs || !actions) return false;
    const gap = 16; // #main-header 左右两组 / 菜单与 Tab 之间的间距
    let leftContent = tabs.scrollWidth; // Tab 的内容宽（不含被 flex-grow 拉出的空白）
    if (menu && getComputedStyle(menu).display !== 'none') {
        leftContent += menu.offsetWidth + gap;
    }
    // 用 clientWidth 而非 scrollWidth：动作组里的「更多」浮层是绝对定位，
    // scrollWidth 会把浮层宽度算进来，导致误判为一直放不下。
    return (leftContent + gap + actions.clientWidth) > _headerEffectiveWidth(header) + 1;
}

function scheduleHeaderActionOverflow(delay) {
    setTimeout(function () { applyHeaderActionOverflow(); }, delay || 0);
}

function applyHeaderActionOverflow() {
    // 先按用户配置的顺序落位，再做数量裁剪
    applyHeaderActionOrder();
    const group = document.getElementById('header-more-group');
    if (!group) return;

    const els = _headerActionEls();
    els.forEach(function (el) { el.classList.remove('header-action-collapsed'); });

    const available = els.filter(function (el) {
        return !el.classList.contains('hidden') && el.getClientRects().length > 0;
    });
    const narrow = _headerIsNarrow();
    const limit = getViewActionLimit();

    if (narrow) {
        group.classList.add('overflow-active');
        _syncHeaderMoreAria();
        renderHeaderMoreMenu();
        return;
    }

    // keep = 右侧保留的按钮数；「更多」出现时占一个名额
    // 先按实际宽度一次性算出能保留几个，避免逐次收起时读到过渡中的布局。
    const header = document.getElementById('main-header');
    const tabs = document.getElementById('view-tabs');
    const actionGap = 12; // #header-actions gap-3
    const headerGap = 16; // #main-header 左右两组间距
    const moreWidth = 40 + actionGap;
    const maxLeft = (header && tabs)
        ? _headerEffectiveWidth(header) - tabs.scrollWidth - headerGap
        : 0;
    const widths = available.map(function (el) {
        return el.getBoundingClientRect().width + actionGap;
    });
    const totalNoMore = widths.reduce(function (sum, w) { return sum + w; }, 0)
        - (widths.length ? actionGap : 0);

    let keep;
    if (totalNoMore <= maxLeft) {
        keep = available.length;
    } else {
        // 预留「更多」，从右往左保留能放下的按钮
        let used = moreWidth;
        keep = 0;
        for (let i = available.length - 1; i >= 0; i--) {
            if (used + widths[i] <= maxLeft) {
                used += widths[i];
                keep += 1;
            } else {
                break;
            }
        }
    }

    // 用户设置的显示数量上限（含「更多」）
    if (keep === available.length) {
        if (available.length > limit) keep = Math.max(0, limit - 1);
    } else {
        keep = Math.min(keep, Math.max(0, limit - 1));
    }

    function applyKeep(count) {
        available.forEach(function (el, i) {
            el.classList.toggle('header-action-collapsed', i < available.length - count);
        });
        // 测量可用宽度前就让「更多」占位，否则会少算它自身的 40px
        group.classList.toggle('overflow-active', count < available.length);
    }
    applyKeep(keep);

    // 兜底：字体/滚动条等造成的几像素误差，再收 1–2 个
    let guard = 0;
    while (keep > 0 && _headerNeedsMoreRoom() && guard++ < 2) {
        keep -= 1;
        applyKeep(keep);
    }

    if (keep < available.length) {
        group.classList.add('overflow-active');
    } else {
        group.classList.remove('overflow-active');
        group.classList.remove('more-open');
    }

    _syncHeaderMoreAria();
    renderHeaderMoreMenu();
}

function _setHeaderMoreExpanded(expanded) {
    const btn = document.getElementById('mobile-more-btn');
    if (btn) btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function _syncHeaderMoreAria() {
    const group = document.getElementById('header-more-group');
    _setHeaderMoreExpanded(!!group && group.classList.contains('more-open'));
}

function toggleHeaderMoreMenu() {
    const group = document.getElementById('header-more-group');
    if (!group || !group.classList.contains('overflow-active')) return;
    // 与同步面板互斥：两个浮层同层叠放，同时展开会互相遮挡
    if (!group.classList.contains('more-open') && typeof closeSyncMenu === 'function') closeSyncMenu();
    const open = group.classList.toggle('more-open');
    if (open) renderHeaderMoreMenu();
    _syncHeaderMoreAria();
}

function closeHeaderMoreMenu() {
    const group = document.getElementById('header-more-group');
    if (!group) return;
    group.classList.remove('more-open');
    _syncHeaderMoreAria();
}

(function initHeaderMoreMenu() {
    const group = document.getElementById('header-more-group');
    if (!group) return;

    // 捕获阶段监听：即使点击目标调用了 stopPropagation，也能关闭已展开的面板
    document.addEventListener('pointerdown', function (e) {
        if (!group.classList.contains('more-open')) return;
        if (!e.target.closest('#header-more-group')) closeHeaderMoreMenu();
    }, true);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeHeaderMoreMenu();
    });

    // 桌面端悬浮展开不经过 click，需要单独同步 aria-expanded
    group.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'mouse') {
            // 悬浮展开「更多」时收起已固定展开的同步面板
            if (typeof closeSyncMenu === 'function') closeSyncMenu();
            if (group.classList.contains('overflow-active')) {
                _setHeaderMoreExpanded(true);
            }
        }
    });
    group.addEventListener('pointerleave', function (e) {
        if (e.pointerType === 'mouse') _syncHeaderMoreAria();
    });

    window.addEventListener('resize', function () {
        if (_headerOverflowResizeTimer) clearTimeout(_headerOverflowResizeTimer);
        _headerOverflowResizeTimer = setTimeout(applyHeaderActionOverflow, 150);
    });

    // 详情面板 / 计划面板开关会改变主区宽度（-384px），窗口本身不 resize；
    // 监听主区宽度变化，延迟重算收纳，保证 1280 宽 + 面板打开时 Header 仍单行。
    const mainContent = document.getElementById('main-content');
    if (mainContent && typeof ResizeObserver !== 'undefined') {
        let lastWidth = mainContent.clientWidth;
        new ResizeObserver(function () {
            const width = mainContent.clientWidth;
            if (Math.abs(width - lastWidth) < 4) return;
            lastWidth = width;
            if (_headerOverflowMainTimer) clearTimeout(_headerOverflowMainTimer);
            _headerOverflowMainTimer = setTimeout(applyHeaderActionOverflow, 120);
        }).observe(mainContent);
    }

    // 面板的滑入/滑出有 300ms 过渡；等过渡结束后再算一次，避免只依赖
    // ResizeObserver 在过渡中的中间宽度而漏掉最终状态。
    ['task-detail-panel', 'plan-panel'].forEach(function (id) {
        const panel = document.getElementById(id);
        if (!panel || typeof MutationObserver === 'undefined') return;
        new MutationObserver(function () {
            if (_headerOverflowPanelTimer) clearTimeout(_headerOverflowPanelTimer);
            _headerOverflowPanelTimer = setTimeout(applyHeaderActionOverflow, 360);
        }).observe(panel, { attributes: true, attributeFilter: ['class', 'style'] });
    });

    // 字体加载完成后按钮宽度会变化，重新收纳一次
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { applyHeaderActionOverflow(); });
    }

    applyHeaderActionOverflow();
})();
