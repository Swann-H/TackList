// ==================== 四象限视图（从 views.js 拆分） ====================

// 第二象限逾期徽章分档配色：只用文字+图标着色，不叠加底色/描边，
// 颜色随逾期时长由琥珀渐深至红（第三档与「重要且紧急」标题同色）
const QUADRANT_STAGNATION_COLORS = {
    1: 'text-amber-500 dark:text-amber-400',
    2: 'text-orange-600 dark:text-orange-400',
    3: 'text-red-600 dark:text-red-400'
};

// 四象限视图配置：迁移自全局「视图偏好」
function getQuadrantConfig() {
    if (!settings.quadrantConfig || typeof settings.quadrantConfig !== 'object') {
        settings.quadrantConfig = {};
    }
    const c = settings.quadrantConfig;
    // 回退读取：视图配置未显式设置时，继承全局默认值（无感升级）
    if (typeof c.showCompleted !== 'boolean') c.showCompleted = settings.showCompleted !== false;
    if (typeof c.showFocusButton !== 'boolean') c.showFocusButton = settings.showFocusButton !== false;
    if (typeof c.showDetails !== 'boolean') c.showDetails = true;
    if (typeof c.compact !== 'boolean') c.compact = false;
    // per-list 回退链
    const listPrefs = _getCurrentListViewPrefs('quadrant');
    if (listPrefs) return Object.assign({}, c, listPrefs);
    return c;
}
_registerViewConfig('quadrant', 'quadrantConfigPanel', 'quadrant-config-btn');

// ==================== 单象限展开（PRD《四象限展开改造prd.md》FR1~FR10） ====================
// 展开态：被展开象限恒占第 1 列整列（q-main），其余三格进第 2 列缩略（q-thumb）。
// 状态存模块级变量，由 renderQuadrantView 每次全量重建（innerHTML 重渲染架构下状态必须可由数据重建）。
let _quadrantExpandedKey = null; // null = 折叠态；不持久化（FR5-2）

// 已知象限 key：拦截非法值，避免 _quadrantExpandedKey 脏状态让 renderCard 取 undefined
// 导致整个视图渲染中断（表现为点击无响应）
const QUADRANT_KEYS = ['urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important'];

function _isQuadrantMobile() {
    return typeof isMobileView === 'function' && isMobileView();
}

// ==================== 动效编排（FR7 v4：View Transitions API） ====================
// 展开/收起/切换 与 展开态详情呼出/收回，统一用 View Transitions API 驱动：
// 给 4 张象限卡分配稳定 view-transition-name（按 data-quadrant），浏览器对同名元素自动做
// 位置 + 尺寸补间（真实内容 morph，非空盒子飞），其余内容（详情面板等）随 root 交叉淡入。
// 性能：浏览器在合成层对快照补间，无需 WAAPI 测量/定时器链；仅「场景过渡动效」开启 +
// 非 reduced-motion + 非移动端 + 浏览器支持 view-transition-name 时启用，否则直接 mutateFn() 瞬切
// （单一降级路径，零维护成本）。快速连点：在途过渡先 skipTransition 再起新过渡，避免布局来回抖动。

// 场景过渡动效档位（独立于「界面交互动效」）：开关开启且系统未请求减少动态
function _qSceneFxOn() {
    return typeof settings !== 'undefined' && settings.featureAnimations === true
        && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// 浏览器是否支持 View Transitions
function _qVtSupported() {
    return typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
        && (typeof CSS === 'undefined' || !CSS.supports || CSS.supports('view-transition-name', 'x'));
}

// 统一门控：场景过渡动效 + 非 reduced-motion + 非移动端 + 浏览器支持
function _qVtOn() {
    return _qSceneFxOn() && !_isQuadrantMobile() && _qVtSupported();
}

// 模块级持有当前在途过渡，便于快速连点时 skip 后重起
let _qActiveTransition = null;
// 在途的详情面板切换目标状态（true=呼出 / false=收回 / null=无），用于吞掉同向重复请求
let _qPanelTogglePending = null;

// 过渡期 root 标记（必须挂在 documentElement：::view-transition 伪元素树隶属 :root）：
//   fx-q-vt         —— 统一时长/缓动，并关闭整页交叉淡入（露出实时新状态，消除主区收缩前后的重影）
//   q-panel-enter/exit —— 详情面板本次为「呼出」/「收回」，由独立分组播放滑入/滑出
//   q-panel-named   —— 面板 view-transition-name 的开关：仅在需要它参与的那一次快照前挂上。
//     呼出：旧快照尚未捕获完的面板已可见（后续 renderSubtasks 需测量高度，不能延迟取消 hidden），
//           故命名延后到过渡回调内添加 → 旧快照无该分组、新快照有 → 纯 enter（滑入）；
//     收回：命名在起过渡前就挂上 → 旧快照有分组、回调内取消命名并 hidden → 纯 exit（滑出）。
function _qSetVtFlags(panelMode) {
    const r = document.documentElement;
    if (!r) return;
    r.classList.add('fx-q-vt');
    if (panelMode === 'enter') r.classList.add('q-panel-enter');
    else if (panelMode === 'exit') r.classList.add('q-panel-exit', 'q-panel-named');
}
function _qClearVtFlags() {
    const r = document.documentElement;
    if (r) r.classList.remove('fx-q-vt', 'q-panel-enter', 'q-panel-exit', 'q-panel-named');
}

// 统一入口：mutateFn 内部完成 DOM 变更（renderView / class 切换等）。
// 条件不满足或浏览器不支持时直接 mutateFn() 瞬切（降级）。
// opts.panel：'enter' | 'exit' | null —— 本次过渡是否伴随详情面板的呼出/收回
// opts.onDone：过渡（或降级瞬切）结束后回调，供调用方清理在途标记
function qStartTransition(mutateFn, opts) {
    const panelMode = (opts && opts.panel) || null;
    const onDone = (opts && typeof opts.onDone === 'function') ? opts.onDone : null;
    const settle = () => { if (onDone) { try { onDone(); } catch (e) {} } };
    // 有全屏浮层在场时禁用过渡：::view-transition 伪元素树位于 top layer，恒绘制于弹窗之上，
    // 否则（如设置面板内误触关闭详情面板）整页快照动画会盖在浮层上，出现层级倒挂
    if (currentView !== 'quadrant' || !_qVtOn()
        || (typeof isAnyOverlayOpen === 'function' && isAnyOverlayOpen())) {
        mutateFn();
        settle();
        return;
    }
    try {
        if (_qActiveTransition && typeof _qActiveTransition.skipTransition === 'function') {
            try { _qActiveTransition.skipTransition(); } catch (e) {}
        }
        _qSetVtFlags(panelMode);
        const vt = document.startViewTransition(() => {
            // 面板命名开关在回调内翻转（旧快照已捕获），详见 _qSetVtFlags 注释
            if (panelMode === 'enter') document.documentElement.classList.add('q-panel-named');
            else if (panelMode === 'exit') document.documentElement.classList.remove('q-panel-named');
            mutateFn();
        });
        _qActiveTransition = vt;
        // 过渡被 skip（连点/被新过渡顶替）时 ready 会以 AbortError 拒绝，静默兜底避免控制台噪声
        if (vt && vt.ready && typeof vt.ready.catch === 'function') vt.ready.catch(() => {});
        // 仅当自己仍是当前过渡时才清标记：快速连点时旧过渡的 finished 晚于新过渡置位，
        // 若无条件清理会把新过渡的标记一并抹掉
        const clear = () => {
            if (_qActiveTransition !== vt) return;
            _qClearVtFlags();
            _qActiveTransition = null;
            settle();
        };
        if (vt && vt.finished && typeof vt.finished.finally === 'function') {
            vt.finished.finally(clear);
        } else {
            setTimeout(clear, 800);
        }
    } catch (e) {
        _qClearVtFlags();
        try { mutateFn(); } catch (e2) {}
        settle();
    }
}

// 展开态详情呼出/收回联动（PRD FR4 方案 B）：接管 detail-panel-open 与面板 hidden 的切换时机，
// 与象限展开/收起/切换统一走 qStartTransition，浏览器一次性 morph 全部卡片、面板与主区 margin
// （同帧起跑 + 同一 --q-vt-dur/--q-vt-ease，避免"面板先到位、卡片后收拢"的割裂感）。
// - 状态去重：面板已在目标状态时（换看另一条任务）不动象限，仅面板内容更新（返回 false 交由默认路径）；
// - 象限跟随：点击缩略格任务呼出面板时，先切换展开象限到该任务所属象限，与面板呼出同场过渡。
// 返回 true = 已接管（调用方跳过默认的立即切换）
function qHookDetailPanelToggle(open, applyClassChange, taskId) {
    if (currentView !== 'quadrant' || !_quadrantExpandedKey) return false;
    if (_isQuadrantMobile()) return false;
    // 象限跟随：点击的任务属于未展开象限（缩略格任务）→ 先切换展开状态
    let switched = false;
    if (open && taskId) {
        const t = (typeof tasks !== 'undefined') ? tasks.find(x => x.id === taskId) : null;
        if (t) {
            const tq = (t.important && t.urgent) ? 'urgent-important'
                : t.important ? 'important-not-urgent'
                : t.urgent ? 'urgent-not-important'
                : 'not-urgent-not-important';
            if (tq !== _quadrantExpandedKey && QUADRANT_KEYS.indexOf(tq) !== -1) {
                _quadrantExpandedKey = tq;
                switched = true;
            }
        }
    }
    // 接管条件：展开态 + 两档动效开关 + 非移动端 + 浏览器支持 VT；
    // 不满足时象限跟随仍需生效（立即渲染），其余交由默认路径
    const container = document.getElementById('quadrants-container');
    if (!container || !container.classList.contains('quadrant-expanded')
        || settings.smoothAnimations !== true || !_qVtOn()) {
        if (switched) renderView();
        return false;
    }
    // 状态去重：面板已在目标状态且无象限切换需求 → 不重播（换看任务仅更新面板内容）
    const hasClass = document.body.classList.contains('detail-panel-open');
    if (open === hasClass && !switched) return false;
    // 面板分组出入方向：仅「呼出 / 收回」时标记；象限跟随时面板两端都在，保持默认交叉淡入
    // （以 detail-panel-open 为准：与上面的状态去重同源，避免与 hidden 的 200ms 延迟态打架）
    const panelMode = open ? (hasClass ? null : 'enter') : (hasClass ? 'exit' : null);
    // 在途去重：关闭面板时 saveTaskDetail() 与 closeTaskDetailPanel() 会连调两次 hideDetailPanel，
    // 同向重复请求直接吞掉（返回 true 让调用方跳过），否则第二场过渡会把第一场 skip 掉，
    // 表现为收回动画先跳到终点再重播一次
    if (_qPanelTogglePending === open) return true;
    _qPanelTogglePending = open;
    // 接管：在 View Transition 内完成「（跟随时）重渲染 + 面板显隐 + class 切换 + 主区 margin 收缩」，
    // 浏览器同一场快照补间内 morph 全部卡片、面板与主区，三者同帧起跑、同时长同缓动
    qStartTransition(() => {
        if (switched) renderView();
        applyClassChange();
        if (settings.smoothAnimations === true) {
            if (open) document.body.classList.add('fx-detail-open');
            else document.body.classList.remove('fx-detail-open');
        }
    }, {
        panel: panelMode,
        onDone: function () { if (_qPanelTogglePending === open) _qPanelTogglePending = null; }
    });
    return true;
}

// 展开/收起（FR2）：折叠态卡上的 fa-expand-alt 与展开卡上的 fa-compress-alt 共用；同键再按一次收起。
// 统一走 qStartTransition：支持 View Transitions 时浏览器 morph，否则瞬切。
function toggleQuadrantExpand(key) {
    if (_isQuadrantMobile()) return; // FR8-1：移动端不进入展开态
    if (QUADRANT_KEYS.indexOf(key) === -1) return; // 非法 key 直接忽略
    const next = (_quadrantExpandedKey === key) ? null : key;
    qStartTransition(() => { _quadrantExpandedKey = next; renderView(); });
}

// 切换展开对象（FR2）：点击缩略格/窄轨格标题栏
function switchQuadrantExpand(key) {
    if (_isQuadrantMobile()) return;
    if (QUADRANT_KEYS.indexOf(key) === -1 || _quadrantExpandedKey === key) return;
    qStartTransition(() => { _quadrantExpandedKey = key; renderView(); });
}

// 收起展开态（FR5-5 切换视图 / FR6-3 恢复默认顺序 / FR8-4 断点清理共用；rerender 省略时仅清状态）。
// 进行中的过渡由 qStartTransition 的 skipTransition 接管，无需手动清定时器。
function collapseQuadrantExpand(rerender) {
    const was = _quadrantExpandedKey !== null;
    if (was && rerender) {
        qStartTransition(() => { _quadrantExpandedKey = null; renderView(); });
    } else if (was) {
        _quadrantExpandedKey = null; // 切视图等场景仅清状态
    }
}

// Esc 收起 + 数字键 1~4 展开（Q7/Q8：编号按 quadrantOrder 当前顺序，屏幕所见即所得）。
// 模块级注册一次（不随 innerHTML 重渲染反复绑定）；焦点在输入框/番茄页/命令面板时让位（FR2）。
document.addEventListener('keydown', function (e) {
    if (currentView !== 'quadrant') return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isComposing) return;
    const pomoPage = document.getElementById('pomodoro-page');
    if (pomoPage && !pomoPage.classList.contains('hidden')) return; // pomodoro.js 已占用 Esc（含子面板让位）
    const paletteOpen = !!document.getElementById('command-palette-overlay');
    if (e.key === 'Escape') {
        if (!_quadrantExpandedKey || paletteOpen) return; // 命令面板开着时 Esc 只关面板；详情面板不受 Esc 影响
        e.preventDefault();
        collapseQuadrantExpand(true);
        return;
    }
    if (e.key >= '1' && e.key <= '4' && !e.ctrlKey && !e.metaKey && !e.altKey && !paletteOpen) {
        const key = quadrantOrder[parseInt(e.key, 10) - 1];
        if (key) toggleQuadrantExpand(key);
    }
});

// ==================== 缩略格懒加载（参考任务视图/看板的哨兵 IO 模式） ====================
const Q_THUMB_BATCH = 30; // 每批渲染条数：先渲染首批，滚动接近哨兵时按批追加
let _qThumbLazyIO = null; // 哨兵 IntersectionObserver（重渲染前 disconnect 防泄漏）
let _qThumbQuadrants = null; // 当前渲染的象限数据快照，供懒加载追加行复用

// 缩略格任务行（紧凑单行，参考任务视图）：色条 + 勾选框 + 标题截断 + 短时间；
// 保留点击开详情与拖拽换象限绑定，只裁剪视觉元素
function _qThumbRowHtml(task, key) {
    const timeDisplay = (typeof formatTaskListTimeShort === 'function') ? formatTaskListTimeShort(task) : '';
    const isOverdue = isTaskOverdue(task);
    const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-secondary';
    const list = lists.find(l => l.id === task.listId);
    const barColor = _extTaskBarColor(task, list ? list.color : '#9ca3af');
    return `
        <div class="task-row flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-r-lg bg-theme-tertiary cursor-pointer group ${task.completed ? 'opacity-55' : ''} hover:opacity-80 transition"
             style="border-left: 3px solid ${barColor};"
             onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}', false, true)" draggable="true" data-task-id="${task.id}"
             ondragstart="handleTaskDragStart(event, '${task.id}')"
             ondragover="handleTaskDragOver(event)"
             ondrop="handleTaskDrop(event, '${task.id}', '${key}')">
            ${renderTaskCheckbox(task, { taskId: task.id })}
            <span class="flex-1 min-w-0 truncate text-[13px] font-medium ${task.completed ? 'text-theme-muted' : 'text-theme-primary'} flex items-center">${_extTaskIconHtml(task)}<span class="truncate">${task.title || '新任务'}</span></span>
            ${timeDisplay ? `<span class="flex-shrink-0 text-xs ${timeTextClass} whitespace-nowrap">${timeDisplay}</span>` : ''}
        </div>
    `;
}

// 向哨兵前追加一批（局部 DOM 更新，不整板重渲染，保持缩略格滚动位置）
function _loadQThumbBatch(sentinel) {
    const key = sentinel.dataset.quadrant;
    const q = _qThumbQuadrants ? _qThumbQuadrants[key] : null;
    if (!q || !Array.isArray(q.tasks)) { sentinel.remove(); return; }
    const total = q.tasks.length;
    const cur = Math.min(total, parseInt(sentinel.dataset.rendered, 10) || Q_THUMB_BATCH);
    if (cur >= total) {
        if (_qThumbLazyIO) _qThumbLazyIO.unobserve(sentinel);
        sentinel.remove();
        return;
    }
    const next = Math.min(total, cur + Q_THUMB_BATCH);
    sentinel.insertAdjacentHTML('beforebegin', q.tasks.slice(cur, next).map(t => _qThumbRowHtml(t, key)).join(''));
    sentinel.dataset.rendered = next;
    if (next >= total) {
        if (_qThumbLazyIO) _qThumbLazyIO.unobserve(sentinel);
        sentinel.remove();
        return;
    }
    // 追加后哨兵仍接近视口（列表未撑满可视高度）：下一帧继续加载，直至撑满或全部显示
    if (sentinel.getBoundingClientRect().top < window.innerHeight + 300) {
        requestAnimationFrame(() => { if (sentinel.isConnected) _loadQThumbBatch(sentinel); });
    }
}

// 渲染后挂载哨兵观察：接近视口即追加下一批
function _setupQThumbLazyIO(container) {
    if (_qThumbLazyIO) { _qThumbLazyIO.disconnect(); _qThumbLazyIO = null; }
    const sentinels = container.querySelectorAll('.q-thumb-sentinel');
    if (!sentinels.length) return;
    if (!('IntersectionObserver' in window)) {
        // 不支持 IO：一次性填充剩余（降级保证功能可用）
        sentinels.forEach(s => {
            const q = _qThumbQuadrants ? _qThumbQuadrants[s.dataset.quadrant] : null;
            if (q && Array.isArray(q.tasks)) {
                const cur = parseInt(s.dataset.rendered, 10) || Q_THUMB_BATCH;
                s.insertAdjacentHTML('beforebegin', q.tasks.slice(cur).map(t => _qThumbRowHtml(t, s.dataset.quadrant)).join(''));
            }
            s.remove();
        });
        return;
    }
    _qThumbLazyIO = new IntersectionObserver((entries) => {
        entries.forEach(en => { if (en.isIntersecting) _loadQThumbBatch(en.target); });
    }, { rootMargin: '300px 0px' });
    sentinels.forEach(s => _qThumbLazyIO.observe(s));
}

// 紧凑显示模式下的任务卡片：复用任务视图（buildTaskListItemHtml）的横向单行布局，
// 但沿用四象限自身的 showDetails / showFocusButton 配置，并保留象限专属徽章
// （如「重要不紧急」象限的「逾期 N 天」），与确认的方案一致。
function quadrantCompactTaskHtml(task, key, cfg) {
    const list = lists.find(l => l.id === task.listId);
    const listColor = list ? list.color : '#9ca3af';
    const listName = list ? list.name : '';
    const barColor = _extTaskBarColor(task, listColor);
    const extIcon = _extTaskIconHtml(task);
    const timeDisplay = formatTaskListTimeShort(task);
    const isOverdue = isTaskOverdue(task);
    const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary';
    const focusMinutes = getTaskFocusMinutes(task.id);
    const progress = task.progress || 0;
    const tagCapsules = renderTagCapsules(task, 2, 'right');
    // 第二象限逾期档位徽章（保留并融合进任务视图卡片样式）
    const stagnationDays = getQuadrantStagnationDays(task);
    const stagLevel = getQuadrantStagnationLevel(task);
    const stagBadge = (stagLevel > 0 && key === 'important-not-urgent')
        ? `<span class="flex items-center gap-1 ${QUADRANT_STAGNATION_COLORS[stagLevel]}"><i class="fas fa-hourglass-half"></i>逾期${stagnationDays}天</span>`
        : '';
    // 详情行：沿用四象限自身的「显示任务详情」开关
    let detailsLine = '';
    if (cfg.showDetails !== false) {
        const subtaskHtml = renderSubtaskListDisplay(task);
        detailsLine = subtaskHtml
            ? subtaskHtml
            : (task.notes ? `<div class="text-xs ${task.completed ? 'text-theme-secondary' : 'text-theme-muted'} mt-1">${escapeHtml(task.notes)}</div>` : '');
    }
    return `
        <div class="task-list-item task-row relative flex items-center gap-3 py-2 px-3 rounded-r-lg bg-theme-tertiary hover:opacity-85 transition cursor-pointer group ${task.completed ? 'opacity-55' : ''}"
             style="border-left: 4px solid ${barColor}; border-top-left-radius: 0; border-bottom-left-radius: 0;"
             onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}', false, true)" draggable="true" data-task-id="${task.id}"
             ondragstart="handleTaskDragStart(event, '${task.id}')"
             ondragover="handleTaskDragOver(event)"
             ondrop="handleTaskDrop(event, '${task.id}', '${key}')">
            ${renderTaskCheckbox(task, { taskId: task.id, extraClass: 'flex-shrink-0' })}
            <div class="flex-1 min-w-0 flex flex-col">
                <span class="${getTaskViewConfig().showDetails ? 'font-medium' : 'text-sm'} ${task.completed ? 'text-theme-secondary' : 'text-theme-primary'} truncate min-w-0 flex items-center">${extIcon}${task.title || '新任务'}</span>
                ${detailsLine ? `<div>${detailsLine}</div>` : ''}
            </div>
            ${renderFocusButton(task.id, cfg.showFocusButton !== false)}
            <div class="flex items-center gap-2 flex-shrink-0 text-xs text-theme-primary whitespace-nowrap">
                ${tagCapsules}
                ${progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-accent-light"></i>${progress}%</span>` : ''}
                ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-400"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                ${listName ? `<span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background-color: ${listColor}"></span>${listName}</span>` : ''}
                ${stagBadge}
            </div>
            ${timeDisplay ? `<span class="flex-shrink-0 text-xs ${timeTextClass} whitespace-nowrap" style="min-width: 50px; text-align: right;"><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
        </div>
    `;
}

function renderQuadrantView(container) {
    // 渲染前无需收敛在途动画：View Transitions 通过快照隔离，外部触发的重渲染只更新底层实时 DOM，
    // 不影响正在播放的过渡（动画编排自身触发的重渲染发生在 startViewTransition 回调内，不会嵌套触发新过渡）
    const quadrantCfg = getQuadrantConfig();
    const filteredTasks = filterTasks(tasks, { includeCompleted: quadrantCfg.showCompleted !== false });

    const quadrants = {
        'urgent-important': {
            title: '重要且紧急',
            color: 'red',
            tasks: sortTasksByCompletion(filteredTasks.filter(t => t.important && t.urgent)),
            icon: 'fa-exclamation-triangle'
        },
        'important-not-urgent': {
            title: '重要不紧急',
            color: 'blue',
            tasks: sortTasksByCompletion(filteredTasks.filter(t => t.important && !t.urgent)),
            icon: 'fa-star'
        },
        'urgent-not-important': {
            title: '紧急不重要',
            color: 'yellow',
            tasks: sortTasksByCompletion(filteredTasks.filter(t => !t.important && t.urgent)),
            icon: 'fa-clock'
        },
        'not-urgent-not-important': {
            title: '不重要不紧急',
            color: 'gray',
            tasks: sortTasksByCompletion(filteredTasks.filter(t => !t.important && !t.urgent)),
            icon: 'fa-circle'
        }
    };

    // WIP Limit: 重要且紧急象限未完成任务数
    const urgentImportantIncomplete = quadrants['urgent-important'].tasks.filter(t => !t.completed).length;
    const isOverloaded = urgentImportantIncomplete > 5;

    const colorClasses = {
        red: isOverloaded
            ? 'border-red-400 bg-red-100 dark:border-red-500 dark:bg-red-900/50'
            : 'border-red-300 bg-red-50 dark:border-red-600 dark:bg-red-900/30',
        blue: 'border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/30',
        yellow: 'border-yellow-300 bg-yellow-50 dark:border-yellow-600 dark:bg-yellow-900/30',
        gray: 'border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-700/50'
    };

    const iconColors = {
        red: 'text-red-600',
        blue: 'text-blue-600',
        yellow: 'text-yellow-600',
        gray: 'text-gray-600'
    };

    // 移动端强制折叠态（FR8-1 兜底：断点切换回调未及时清空状态时按折叠渲染）
    if (_quadrantExpandedKey && _isQuadrantMobile()) _quadrantExpandedKey = null;
    const expandedKey = _quadrantExpandedKey;
    const isExpanded = !!expandedKey;

    // 保存各象限滚动位置：按象限 key 存取（FR10），重排/展开切换后不再串位
    const savedScrolls = {};
    container.querySelectorAll('.quadrant-drop-zone').forEach(zone => {
        const card = zone.closest('.quadrant-card');
        if (card && card.dataset.quadrant) savedScrolls[card.dataset.quadrant] = zone.scrollTop;
    });

    // 渲染顺序：展开态把展开卡放 DOM 首位（= 第 1 列），其余按 quadrantOrder 相对顺序（FR1）
    const renderOrder = isExpanded
        ? [expandedKey].concat(quadrantOrder.filter(k => k !== expandedKey))
        : quadrantOrder.slice();

    // 缩略格任务列表（FR3 v2）：紧凑单行 + 滚动浏览 + 哨兵懒加载（参考任务视图）
    const renderThumbTasks = (q, key) => {
        if (q.tasks.length === 0) {
            return `<div class="text-center py-3 text-theme-muted text-xs border-2 border-dashed border-theme rounded-lg">暂无任务</div>`;
        }
        const shown = q.tasks.slice(0, Q_THUMB_BATCH);
        return shown.map(t => _qThumbRowHtml(t, key)).join('')
            + (q.tasks.length > shown.length
                ? `<div class="q-thumb-sentinel" data-quadrant="${key}" data-rendered="${shown.length}"></div>`
                : '');
    };

    // 单张象限卡渲染：isThumb 决定缩略/完整模式
    const renderCard = (key) => {
        const q = quadrants[key];
        if (!q) return ''; // 未知 key（如 quadrantOrder 被外部数据污染）跳过而非中断整个视图渲染
        const isMain = isExpanded && key === expandedKey;
        const isThumb = isExpanded && !isMain;
        const incompleteCount = q.tasks.filter(t => !t.completed).length;
        const expandNum = quadrantOrder.indexOf(key) + 1; // 快捷键编号（Q8）
        const headerCursor = isThumb ? 'cursor-pointer' : 'cursor-move';
        return `
            <div class="quadrant-card ${isMain ? 'q-main' : ''}${isThumb ? 'q-thumb' : ''} bg-theme-secondary rounded-xl shadow-theme border-2 ${colorClasses[q.color]} ${isThumb ? 'p-3' : 'p-4'} flex flex-col min-h-0"
                 data-quadrant="${key}"
                 style="view-transition-name: quadrant-${key}"
                 ondragover="handleTaskDragOver(event)"
                 ondrop="handleQuadrantCardDrop(event, '${key}')">
                <div class="flex items-center justify-between ${isThumb ? 'mb-2' : 'mb-3'} ${headerCursor} quadrant-drag-handle"
                     ${isThumb ? `title="${q.title}" onclick="switchQuadrantExpand('${key}')"` : ''}
                     draggable="true"
                     ondragstart="handleQuadrantDragStart(event, '${key}')">
                    <h3 class="font-bold ${iconColors[q.color]} flex items-center ${isThumb ? 'text-sm' : ''} gap-2 min-w-0">
                        <i class="fas ${q.icon}"></i>
                        <span class="q-title-text truncate">${q.title}</span>
                        <span class="q-count bg-theme-secondary px-2 py-0.5 rounded-full ${isThumb ? 'text-xs' : 'text-sm'} text-theme-primary flex-shrink-0">${incompleteCount}</span>
                    </h3>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <button onclick="event.stopPropagation(); openAddTaskForQuadrant('${key}')" class="text-theme-muted hover:text-theme-primary${isThumb ? ' q-thumb-plus' : ''}" title="新增任务">
                            <i class="fas fa-plus"></i>
                        </button>
                        ${!isExpanded ? `
                            <button onclick="event.stopPropagation(); toggleQuadrantExpand('${key}')" class="text-theme-muted hover:text-theme-primary" title="展开该象限（快捷键 ${expandNum}）">
                                <i class="fas fa-expand-alt"></i>
                            </button>
                        ` : ''}
                        ${isMain ? `
                            <button onclick="event.stopPropagation(); toggleQuadrantExpand('${key}')" class="text-theme-muted hover:text-theme-primary" title="收起（Esc）">
                                <i class="fas fa-compress-alt"></i>
                            </button>
                        ` : ''}
                        ${isThumb ? `
                            <button onclick="event.stopPropagation(); switchQuadrantExpand('${key}')" class="q-thumb-expand text-theme-muted hover:text-theme-primary" title="展开该象限（快捷键 ${expandNum}）">
                                <i class="fas fa-expand-alt"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
                ${key === 'urgent-important' && isOverloaded && !isThumb ? `
                    <div class="mb-2 px-3 py-2 bg-red-200/60 dark:bg-red-800/40 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                        <i class="fas fa-exclamation-circle"></i>
                        <span>当前核心焦虑源过多（${urgentImportantIncomplete}个），建议拆解或降级部分任务。</span>
                    </div>
                ` : ''}
                <div class="flex-1 min-h-0 overflow-y-auto${isThumb ? ' q-thumb-list space-y-1' : (quadrantCfg.compact ? '' : ' space-y-2')} quadrant-drop-zone"
                     ondragover="handleTaskDragOver(event)"
                     ondrop="handleTaskDrop(event, null, '${key}')">
                    ${q.tasks.length === 0 ? (isThumb
                        ? `<div class="text-center py-3 text-theme-muted text-xs border-2 border-dashed border-theme rounded-lg">暂无任务</div>`
                        : `<div class="text-center py-6 text-theme-muted text-sm border-2 border-dashed border-theme rounded-lg">暂无任务（拖拽任务到此处）</div>`)
                    : (isThumb ? renderThumbTasks(q, key) : q.tasks.map(task => {
                        if (quadrantCfg.compact) return quadrantCompactTaskHtml(task, key, quadrantCfg);
                        const list = lists.find(l => l.id === task.listId);
                        const timeDisplay = formatTaskTimeLabel(task, false);
                        const listColor = list ? list.color : '#9ca3af';
                        const _extBarColor = _extTaskBarColor(task, listColor);
                        const _extIcon = _extTaskIconHtml(task);
                        const focusMinutes = getTaskFocusMinutes(task.id);
                        // 第二象限任务逾期档位（0=未逾期 1=7~30天 2=30~90天 3=>90天）
                        const stagnationDays = getQuadrantStagnationDays(task);
                        const stagLevel = getQuadrantStagnationLevel(task);
                        const isOverdue = isTaskOverdue(task);
                        const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-secondary';
                        return `
                            <div class="task-row flex items-start gap-3 mb-3 group ${task.completed ? 'opacity-55' : ''}" onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}', false, true)" draggable="true" data-task-id="${task.id}"
                                 ondragstart="handleTaskDragStart(event, '${task.id}')"
                                 ondragover="handleTaskDragOver(event)"
                                 ondrop="handleTaskDrop(event, '${task.id}', '${key}')">
                                <div class="w-8 flex-shrink-0 flex flex-col items-center justify-between self-stretch relative">
                                    ${renderTaskCheckbox(task, { taskId: task.id })}
                                    ${renderFocusButton(task.id, quadrantCfg.showFocusButton !== false)}
                                </div>
                                <div class="flex-1 bg-theme-tertiary rounded-r-lg p-3 cursor-pointer hover:opacity-80 transition" style="border-left: 4px solid ${_extBarColor}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
                                    <div class="flex items-center gap-2 text-sm mb-1 text-theme-secondary">
                                        ${timeDisplay ? `<span class="${timeTextClass}">${timeDisplay}</span>` : ''}
                                        ${list ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${listColor}"></span>${list.name}</span>` : ''}
                                        ${renderTagCapsules(task, 2, 'right')}
                                        ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-500"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                                        ${task.progress && task.progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-accent"></i>${task.progress}%</span>` : ''}
                                        ${stagLevel > 0 && key === 'important-not-urgent' ? `<span class="flex items-center gap-1 ${QUADRANT_STAGNATION_COLORS[stagLevel]}"><i class="fas fa-hourglass-half"></i>逾期${stagnationDays}天</span>` : ''}
                                    </div>
                                    <div class="font-medium ${task.completed ? 'text-theme-muted' : 'text-theme-primary'} flex items-center">
                                        ${_extIcon}${task.title || '新任务'}
                                    </div>
                                    ${(quadrantCfg.showDetails !== false) ? (renderSubtaskListDisplay(task) || (task.notes ? `<div class="text-xs ${task.completed ? 'text-theme-secondary' : 'text-theme-muted'} mt-1">${task.notes}</div>` : '')) : ''}
                                </div>
                            </div>
                        `;
                    }).join(''))}
                </div>
            </div>
        `;
    };

    container.innerHTML = `
        <div class="h-full flex flex-col">
            <div class="flex-1 min-h-0 q-exp-wrap">
                <div class="grid grid-cols-2 gap-4 h-full min-h-0${isExpanded ? ' quadrant-expanded q-collapse-detail' : ''}" id="quadrants-container">
                    ${renderOrder.map(renderCard).join('')}
                </div>
            </div>
        </div>
    `;

    // 同步恢复各象限滚动位置（按 data-quadrant，FR10）
    container.querySelectorAll('.quadrant-drop-zone').forEach(zone => {
        const card = zone.closest('.quadrant-card');
        if (card && card.dataset.quadrant && savedScrolls[card.dataset.quadrant] > 0) {
            zone.scrollTop = savedScrolls[card.dataset.quadrant];
        }
    });

    // 缩略格懒加载：记录数据快照并挂载哨兵观察（接近视口时按批追加任务行）
    _qThumbQuadrants = quadrants;
    _setupQThumbLazyIO(container);

    // 第二象限激活推进器：检查是否有停留超过7天的未完成任务
    checkQuadrantStagnation();
}

function resetQuadrantOrder() {
    _quadrantExpandedKey = null; // FR6-3：恢复默认顺序先收起展开态
    quadrantOrder = ['urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important'];
    saveData();
    renderView();
    showToast('已恢复默认顺序', 'success');
}

// 第二象限激活推进器：检查逾期超过阈值的未完成任务并弹窗提醒
let _stagnationNotified = false;

function checkQuadrantStagnation() {
    if (_stagnationNotified) return;

    const stagnantTasks = filterTasks(tasks).filter(t => {
        if (!t.important || t.urgent || t.completed) return false;
        return getQuadrantStagnationDays(t) > QUADRANT_STAGNATION_ALERT_DAYS;
    });

    if (stagnantTasks.length === 0) return;

    _stagnationNotified = true;

    // 逾期最久的排在最前，优先提醒最该处理的那条
    stagnantTasks.sort((a, b) => getQuadrantStagnationDays(b) - getQuadrantStagnationDays(a));
    const task = stagnantTasks[0];
    const days = getQuadrantStagnationDays(task);

    showQuadrantStagnationModal(task, days, stagnantTasks.length);
}

function showQuadrantStagnationModal(task, days, totalCount) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const existing = document.getElementById('quadrant-stagnation-modal');
    if (existing) existing.remove();

    const theme = {
        color: 'text-amber-400', border: 'border-amber-500', bg: 'bg-amber-500',
        shadow: 'shadow-[0_0_15px_rgba(245,158,11,0.3)]', icon: 'fa-hourglass-half'
    };
    const duration = 30000;

    const toast = document.createElement('div');
    toast.id = 'quadrant-stagnation-modal';
    toast.className = `quest-toast flex flex-col p-4 bg-slate-900/95 backdrop-blur-sm border-l-4 ${theme.border} text-slate-200 ${theme.shadow} w-full`;

    toast.innerHTML = `
        <div class="flex items-center">
            <div class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full border-2 ${theme.border} ${theme.color} bg-slate-900 shadow-[0_0_10px_currentColor] mr-4 relative z-10">
                <i class="fas ${theme.icon} text-lg"></i>
            </div>
            <div class="flex-1 relative z-10 flex flex-col justify-center">
                <div class="${theme.color} text-xs font-black tracking-[0.15em] uppercase mb-0.5 drop-shadow-md">
                    WARNING
                </div>
                <div class="text-sm font-medium text-slate-300 leading-snug">
                    「${escapeHtml(task.title || '新任务')}」在"重要不紧急"象限已逾期 <span class="font-bold text-amber-400">${days}</span> 天。${totalCount > 1 ? ` 另有 ${totalCount - 1} 个类似任务。` : ''}
                </div>
            </div>
        </div>
        <div class="flex gap-2 mt-3 relative z-10 justify-end">
            <button class="stagnation-promote-btn px-3 py-1.5 bg-amber-500/20 text-amber-400 border border-amber-500 rounded font-bold hover:bg-amber-500/30 transition text-xs tracking-wider">设为紧急</button>
            <button class="stagnation-focus-btn px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500 rounded font-bold hover:bg-green-500/30 transition text-xs tracking-wider">开始专注</button>
            <button class="stagnation-dismiss-btn px-3 py-1.5 bg-slate-700/50 text-slate-400 border border-slate-600 rounded font-bold hover:bg-slate-600/50 transition text-xs tracking-wider">稍后</button>
        </div>
        <div class="absolute bottom-0 left-0 h-1 ${theme.bg} opacity-80"
             style="animation: progressShrink ${duration}ms linear forwards;">
        </div>
    `;

    container.appendChild(toast);

    let isRemoved = false;
    function removeToast() {
        if (isRemoved) return;
        isRemoved = true;
        toast.classList.add('quest-toast-out');
        setTimeout(() => toast.remove(), 400);
    }

    toast.querySelector('.stagnation-promote-btn').addEventListener('click', () => {
        clearTimeout(autoRemoveTimer);
        removeToast();
        promoteStagnantTask(task.id);
    });
    toast.querySelector('.stagnation-focus-btn').addEventListener('click', () => {
        clearTimeout(autoRemoveTimer);
        removeToast();
        focusStagnantTask(task.id);
    });
    toast.querySelector('.stagnation-dismiss-btn').addEventListener('click', () => {
        clearTimeout(autoRemoveTimer);
        removeToast();
    });

    const autoRemoveTimer = setTimeout(() => {
        removeToast();
    }, duration);
}

function promoteStagnantTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        task.urgent = true;
        saveData();
        renderView();
        showToast(buildTaskToastMessage(task), 'success', null, '已调整为紧急');
    }
}

function focusStagnantTask(taskId) {
    startPomodoroForTask(taskId);
}

function openAddTaskForQuadrant(quadrantKey) {
    const important = quadrantKey.includes('important') && !quadrantKey.includes('not-important');
    const urgent = quadrantKey.includes('urgent') && !quadrantKey.includes('not-urgent');

    openAddTaskModal();
    document.getElementById('task-important').checked = important;
    document.getElementById('task-urgent').checked = urgent;
}

// ---------- 四象限视图配置面板 ----------
function toggleQuadrantConfig() {
    if (_viewConfigPanels.quadrant && _viewConfigPanels.quadrant.open) closeViewConfigPanel('quadrant');
    else openQuadrantConfig();
}
function openQuadrantConfig() {
    const cfg = getQuadrantConfig();
    const scEl = document.getElementById('qc-showcompleted');
    const sfEl = document.getElementById('qc-showfocus');
    const sdEl = document.getElementById('qc-showdetails');
    if (scEl) scEl.checked = cfg.showCompleted !== false;
    if (sfEl) sfEl.checked = cfg.showFocusButton !== false;
    if (sdEl) sdEl.checked = cfg.showDetails !== false;
    const cpEl = document.getElementById('qc-compact');
    if (cpEl) cpEl.checked = cfg.compact === true;
    openViewConfigPanel('quadrant', (forSwitch) => {
        saveData(); // 延迟保存：变更实时预览，关闭面板时统一落盘
        if (!forSwitch) renderView(); // 切换视图场景由切换方渲染，跳过冗余渲染
    });
}
function closeQuadrantConfig() {
    closeViewConfigPanel('quadrant');
}
function onQuadrantConfigChange() {
    const target = _ensureListViewPrefs('quadrant') || settings.quadrantConfig;
    const scEl = document.getElementById('qc-showcompleted');
    const sfEl = document.getElementById('qc-showfocus');
    const sdEl = document.getElementById('qc-showdetails');
    if (scEl) target.showCompleted = scEl.checked;
    if (sfEl) target.showFocusButton = sfEl.checked;
    if (sdEl) target.showDetails = sdEl.checked;
    const cpEl = document.getElementById('qc-compact');
    if (cpEl) target.compact = cpEl.checked;
    renderView(); // 实时预览；保存延迟到面板关闭
}

// 恢复默认配置（面板内「恢复默认」按钮）
function resetQuadrantViewConfig() {
    if (_resetCurrentListViewPrefs('quadrant')) {
        saveData();
        renderView();
        openQuadrantConfig();
        showToast('已恢复该清单的四象限视图配置（继承全局）', 'success');
    } else {
        _resetViewConfigToDefault('quadrantConfig', { showCompleted: true, showFocusButton: true, compact: false });
        saveData();
        renderView();
        openQuadrantConfig();
        showToast('已恢复四象限视图默认配置', 'success');
    }
}
