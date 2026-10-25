// ==================== 视图右上角操作按钮溢出与「更多」面板 ====================
// 规则：
// - 显示数量上限含「更多」按钮；「添加任务」与「从模板添加」共用 add-task-group，算 1 个。
// - 「更多」按钮固定在该级按钮最左侧；超出时按 DOM 顺序从最左侧收起，右侧按钮优先保留。
// - 窄屏（≤768px）固定只显示「更多」，面板列出窄屏下被收起的操作。
// - 桌面/鼠标设备悬浮展开（与「从模板添加」一致），触摸设备点击展开。

let _headerOverflowResizeTimer = null;

// 头部按钮的语义色与图标由 utils.js 的 VIEW_ACTION_COLOR_HEX / VIEW_ACTION_DEFS 统一维护，设置面板与「更多」面板保持一致。

// 逻辑操作 id → 头部实际元素。「视图配置」聚合 6 个视图各自的配置按钮，占同一个排序槽位。
const _HEADER_ACTION_SELECTORS = {
    sync: ['calendar-sync-btn'],
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
        if (!el.matches || !el.matches('button, .add-task-group')) return;
        if (desired.indexOf(el) === -1) desired.push(el);
    });

    const current = Array.prototype.filter.call(host.children, function (el) {
        return el !== more && el.matches && el.matches('button, .add-task-group');
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

// 头部可收纳的操作元素：header-actions 的直接子按钮 + 添加任务组（批量工具条等容器不计）
function _headerActionEls() {
    const host = document.getElementById('header-actions');
    if (!host) return [];
    return Array.prototype.filter.call(host.children, function (el) {
        return el.matches && el.matches('button, .add-task-group');
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

function applyHeaderActionOverflow() {
    // 先按用户配置的顺序落位，再做数量裁剪
    applyHeaderActionOrder();
    const group = document.getElementById('header-more-group');
    if (!group) return;

    const els = _headerActionEls();
    els.forEach(function (el) { el.classList.remove('header-action-collapsed'); });

    const available = els.filter(function (el) { return !el.classList.contains('hidden'); });
    const narrow = _headerIsNarrow();
    const limit = getViewActionLimit();

    if (narrow) {
        group.classList.add('overflow-active');
    } else if (available.length > limit) {
        // 「更多」占一个名额，右侧保留 limit-1 个操作，其余从最左侧收起
        const keep = Math.max(0, limit - 1);
        available.slice(0, available.length - keep).forEach(function (el) {
            el.classList.add('header-action-collapsed');
        });
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
        if (e.pointerType === 'mouse' && group.classList.contains('overflow-active')) {
            _setHeaderMoreExpanded(true);
        }
    });
    group.addEventListener('pointerleave', function (e) {
        if (e.pointerType === 'mouse') _syncHeaderMoreAria();
    });

    window.addEventListener('resize', function () {
        if (_headerOverflowResizeTimer) clearTimeout(_headerOverflowResizeTimer);
        _headerOverflowResizeTimer = setTimeout(applyHeaderActionOverflow, 150);
    });

    applyHeaderActionOverflow();
})();
