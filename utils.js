// 数据模型
let lists = [];
let tasks = [];
let settings = {};
let currentView = 'task';
let currentListId = null;
let currentFilter = null;
let currentTagIds = []; // 当前标签筛选（并集）
let currentFilterId = null;
let currentDate = new Date();
let currentTaskMode = 'text';
let holidayData = {};

// 日期边界缓存：避免每个任务都重复构造 todayStart/tomorrowStart 等 7 个 Date 对象。
// 跨天失效：缓存中记录计算时的日期签名（年-月-日），若取用时发现已跨天则自动重建。
let _dateBoundsCache = null;
function getDateBounds() {
    const now = new Date();
    const todaySig = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (_dateBoundsCache && _dateBoundsCache._sig === todaySig) {
        return _dateBoundsCache;
    }
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
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    _dateBoundsCache = {
        _sig: todaySig,
        now, todayStart, tomorrowStart, dayAfterTomorrowStart,
        threeDaysLaterStart, sevenDaysLaterEnd, yesterdayStart
    };
    return _dateBoundsCache;
}

// ==================== 侧边栏特殊筛选项（固定清单） ====================
// 这些筛选由侧边栏固定项触发，在任务视图中按「天」分组展示、时间列只显示 HH:MM，
// 且各自拥有独立的偏好视图（settings.specialViewPrefs[filter]）。
const SPECIAL_TIME_FILTERS = ['today', 'tomorrow', 'recent3days', 'recent7days'];

// 侧边栏固定筛选项/分组的显隐默认值（settings.sidebarItems）
// show = 显示 | auto = 有内容时显示 | hide = 隐藏
const SIDEBAR_ITEM_DEFAULTS = {
    allTasks: 'show',
    today: 'hide',
    tomorrow: 'hide',
    recent3days: 'hide',
    recent7days: 'show',
    summary: 'show',
    tags: 'show',
    filters: 'show',
    trash: 'show'
};

// 当前（或给定）筛选是否为侧边栏特殊时间筛选
function isSpecialTimeFilter(filter) {
    const f = arguments.length ? filter : currentFilter;
    return SPECIAL_TIME_FILTERS.indexOf(f) !== -1;
}

// 返回特殊时间筛选的 [start, end) 毫秒区间；非特殊筛选返回 null
// 今天 = [今天0点, 明天0点)；明天 = [明天0点, 后天0点)
// 最近3天 = [今天0点, 后天24点)；最近7天 = [今天0点, 第7天24点)
function getSpecialTimeFilterRange(filter) {
    const f = arguments.length ? filter : currentFilter;
    if (SPECIAL_TIME_FILTERS.indexOf(f) === -1) return null;
    const b = getDateBounds();
    switch (f) {
        case 'today':
            return [b.todayStart.getTime(), b.tomorrowStart.getTime()];
        case 'tomorrow':
            return [b.tomorrowStart.getTime(), b.dayAfterTomorrowStart.getTime()];
        case 'recent3days':
            return [b.todayStart.getTime(), b.threeDaysLaterStart.getTime()];
        case 'recent7days':
            return [b.todayStart.getTime(), b.sevenDaysLaterEnd.getTime()];
    }
    return null;
}

// 读取侧边栏项的显隐配置（非法值回退默认值）
function getSidebarItemVisibility(key) {
    const cfg = settings.sidebarItems || {};
    const v = cfg[key];
    return (v === 'show' || v === 'auto' || v === 'hide') ? v : (SIDEBAR_ITEM_DEFAULTS[key] || 'show');
}

// 番茄计时器状态
let pomodoroState = {
    state: 'idle',  // idle | focusing | pause | end_settlement | completed | resting | ended
    phase: 'focus',
    timeLeft: 25 * 60,
    focusDuration: 25,
    breakDuration: 5,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    longBreakInterval: 4,
    continuousTomatoCount: 0,
    completedPomodoros: 0,
    timerId: null,
    currentTaskId: null,
    startedAt: null,
    totalDuration: 25 * 60,
    originalStartedAt: null,  // 首次开始时间
    taskName: '',
};
let _pomodoroCompletionHandled = false;
let _pomodoroPaused = false;
let _pomodoroPhaseTransition = false;
let _previousState = null;
let _lastProgressPhase = null;

// 正念小事状态
let boringState = {
    shownThings: [],
    currentThing: null,
    swapCount: 0
};


// 四象限顺序
let quadrantOrder = ['urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important'];

// 番茄历史记录
let pomodoroHistory = [];

function isDarkThemeActive() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

// ==================== 全屏浮层判定（详情面板「点击外部关闭」与四象限过渡共用） ====================
// 选择器覆盖：.modal-overlay = 所有居中弹窗（新增任务/设置/正念小事/答案之书/番茄补录/移动端侧边栏遮罩等）；
// #pomodoro-page = 番茄专注全屏页；#command-palette-overlay = 命令面板（动态创建，存在即打开）。
// 注意不能只用 :not(.hidden) 判定：部分浮层（如 #sidebar-overlay）以 display:none 隐藏而不带 hidden 类，
// 会被误判为「已打开」，故统一走 _isOverlayVisible 的可见性判定。
const OPEN_OVERLAY_SELECTOR = '.modal-overlay, #pomodoro-page, #command-palette-overlay';

// 浮层是否真正可见（display/visibility 双判；元素数量为个位数，开销可忽略）
function _isOverlayVisible(el) {
    if (!el) return false;
    try {
        if (el.classList && el.classList.contains('hidden')) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    } catch (e) { return false; }
}

// 是否存在任意已打开的全屏浮层
function isAnyOverlayOpen() {
    if (typeof document === 'undefined') return false;
    try {
        const els = document.querySelectorAll(OPEN_OVERLAY_SELECTOR);
        for (let i = 0; i < els.length; i++) { if (_isOverlayVisible(els[i])) return true; }
    } catch (e) {}
    return false;
}

// 点击事件是否落在已打开的全屏浮层内部（用于区分「点击外部」与「浮层内交互」）
function isEventInsideOpenOverlay(e) {
    const t = e && e.target;
    if (!t || typeof t.closest !== 'function') return false;
    try { return _isOverlayVisible(t.closest(OPEN_OVERLAY_SELECTOR)); } catch (err) { return false; }
}

// 方案A：子任务逐行列表展示（最多3行，超出显示"……(已完成/总数)"）
// colorMode: 'theme'（默认，跟随主题）| 'dark'（深色背景，如 Toast）
function renderSubtaskListDisplay(task, colorMode = 'theme', highlightId = null) {
    // 文本模式下不显示子任务，回退到 notes 显示
    if (task.mode === 'text') return '';
    let validSubtasks = (task.subtasks || []).filter(st => st.text && st.text.trim());
    if (validSubtasks.length === 0) return '';

    // 与任务详情栏保持一致：未完成的子任务排在已完成子任务之前，
    // 每组内部再按 originalOrder（创建/拖拽顺序）排序。
    // 缺失 originalOrder 时回退到在数组中的相对位置，保证排序稳定。
    validSubtasks.forEach((st, i) => {
        if (st.originalOrder === undefined) st.originalOrder = i;
    });
    validSubtasks = [...validSubtasks].sort((a, b) => {
        if (!a.completed && b.completed) return -1;
        if (a.completed && !b.completed) return 1;
        return (a.originalOrder || 0) - (b.originalOrder || 0);
    });

    const total = validSubtasks.length;
    const completedCount = validSubtasks.filter(st => st.completed).length;
    const maxShow = 3;
    // 高亮的子任务（本次到点的那一个）必须出现在列表中，即使排序上排在 3 条之后
    let showItems = validSubtasks.slice(0, maxShow);
    if (highlightId && !showItems.some(st => st.id === highlightId)) {
        const target = validSubtasks.find(st => st.id === highlightId);
        if (target) showItems = [...showItems.slice(0, maxShow - 1), target];
    }

    // 颜色规则（全视图统一）：未完成跟随主题色（textMuted 带主题色相），已完成用中性灰（textSecondary）作区分
    const colors = colorMode === 'dark'
        ? { completed: 'text-slate-500', uncompleted: 'text-slate-300', muted: 'text-slate-500' }
        : { completed: 'text-theme-secondary', uncompleted: 'text-theme-muted', muted: 'text-theme-muted' };

    let html = '<div class="text-xs mt-1 space-y-0.5">';
    showItems.forEach(st => {
        const icon = st.completed ? 'fa-check-circle' : 'fa-circle';
        const isActive = highlightId && st.id === highlightId;
        // 到点的子任务：前置 caret 图标 + 高亮，一眼定位到是哪一步
        // ⚠️ dark（Toast 深色底）不能用 text-accent：它是深蓝，压在 bg-slate-900 上对比度不足，
        //    改用 sky-300（同为蓝系、亮度高），并加粗一档
        const activeCls = colorMode === 'dark'
            ? 'text-sky-300 font-semibold'
            : 'text-accent font-medium';
        const cls = isActive ? activeCls : (st.completed ? colors.completed : colors.uncompleted);
        const caret = isActive ? '<i class="fas fa-caret-right mt-0.5 flex-shrink-0"></i>' : '';
        html += `<div class="${cls} flex items-start gap-1">${caret}<i class="far ${icon} mt-0.5 flex-shrink-0"></i><span>${escapeHtml(st.text)}</span></div>`;
    });

    if (total > maxShow) {
        html += `<div class="${colors.muted}">…… [ ${completedCount}/${total} ]</div>`;
    }

    html += '</div>';
    return html;
}

// ==================== Toast 标题词表（方案 A） ====================
// 口径：标题行只表达「状态」，不描述具体动作；一律由 type 派生，调用点不得手写自由文本。
//   历史问题：四个默认词语法各不相同（名词+后置形容词 QUEST COMPLETE / 名词+过去式 MISSION FAILED
//   / 形容词+名词 NEW QUEST / 单个名词 WARNING），且 QUEST 与 MISSION 指同一个「任务」，
//   属于同一概念两套说法——标题既不成体系，又常与语义错位（删除撤销弹的是 NEW QUEST）。
//   现收敛为「单词状态词」：四个词同词性、同长度，结构上不会再跑偏。
// ⚠️ 需要表达「对象 / 时间 / 原因」时写进正文（message），不要塞回标题。
// ⚠️ 唯一例外是 showReminderToast：它的标题行是「时间 · 对象」头部，属 actionable 通道，
//    不是状态标签，故不参与本词表（见 utils.js:buildReminderDisplayTitle）。
const TOAST_TITLES = Object.freeze({
    success: 'SUCCESS',
    error:   'FAILED',
    info:    'NOTICE',
    warning: 'CAUTION',
    confirm: 'CONFIRM'   // 仅 showConfirmToast 使用：交互询问，不是状态
});

// 严格模式（URL 带 ?toastdebug=1，或 localStorage['tacklist.toastDebug']='1'）下，
// 任何不在词表内的标题会 console.warn 并回落为 type 默认词——用于防止规范回退。
const _TOAST_TITLE_STRICT = (function () {
    try {
        return /[?&]toastdebug\b/.test(location.search)
            || localStorage.getItem('tacklist.toastDebug') === '1';
    } catch (e) { return false; }
})();

function resolveToastTitle(title, type) {
    const fallback = TOAST_TITLES[type] || TOAST_TITLES.info;
    if (!title) return fallback;
    const t = String(title).trim();
    if (Object.values(TOAST_TITLES).includes(t)) return t;
    if (_TOAST_TITLE_STRICT) console.warn('[toast] 标题不在词表内，已回落为 ' + fallback + '：', title);
    return fallback;
}

// ==================== Toast 内核 ====================
// 四个公开函数只负责「配参数」；卡片 DOM / 类名 / 进出场 / 计时 / 关闭收敛到这里。
// ⚠️ 配色只有这一张表。历史上 showToast 与 showUndoToast 各存一份逐字节相同的副本，
//    提醒卡又自带 sky/amber 两套，改色要改四处——调色一律改这里。

const TOAST_THEMES = Object.freeze({
    success: {
        color: 'text-green-400', border: 'border-green-500', bg: 'bg-green-500',
        shadow: 'shadow-[0_0_15px_rgba(34,197,94,0.3)]', shadowSoft: 'shadow-[0_0_12px_rgba(34,197,94,0.25)]', icon: 'fa-check-double'
    },
    error: {
        color: 'text-red-500', border: 'border-red-600', bg: 'bg-red-600',
        shadow: 'shadow-[0_0_15px_rgba(220,38,38,0.3)]', shadowSoft: 'shadow-[0_0_12px_rgba(220,38,38,0.25)]', icon: 'fa-skull'
    },
    info: {
        color: 'text-cyan-400', border: 'border-cyan-500', bg: 'bg-cyan-500',
        shadow: 'shadow-[0_0_15px_rgba(6,182,212,0.3)]', shadowSoft: 'shadow-[0_0_12px_rgba(6,182,212,0.25)]', icon: 'fa-scroll'
    },
    warning: {
        color: 'text-amber-400', border: 'border-amber-500', bg: 'bg-amber-500',
        shadow: 'shadow-[0_0_15px_rgba(245,158,11,0.3)]', shadowSoft: 'shadow-[0_0_12px_rgba(245,158,11,0.25)]', icon: 'fa-exclamation-triangle'
    },
    // 提醒卡两态：主任务琥珀 / 子任务蓝。不属于 type 体系，但同样登记在此。
    reminder: {
        color: 'text-amber-400', border: 'border-amber-500', bg: 'bg-amber-500',
        shadow: 'shadow-[0_0_15px_rgba(245,158,11,0.3)]', icon: 'fa-bell'
    },
    'reminder-subtask': {
        color: 'text-sky-400', border: 'border-sky-500', bg: 'bg-sky-500',
        shadow: 'shadow-[0_0_15px_rgba(14,165,233,0.3)]', icon: 'fa-list-check'
    }
});

// 正文默认转义。内核自己拼的 HTML 片段（子任务列表 / 聚合提示 / 徽标）走 raw，不经过这里。
function _toastEscape(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// 时长三档：由 settings.toastPace 选一组固定值（不做乘法，便于断言与解释）
const TOAST_LIFE = Object.freeze({
    fast:   { short: 1500, normal: 3000, long: 5000 },
    normal: { short: 2500, normal: 5000, long: 8000 },
    slow:   { short: 4000, normal: 7000, long: 12000 }
});

function _toastPace() {
    const p = (typeof settings !== 'undefined' && settings && settings.toastPace) ? settings.toastPace : 'normal';
    return TOAST_LIFE[p] ? p : 'normal';
}

// life：'short'|'normal'|'long' 走节奏表；数字 = 功能性时长（撤销/确认），不随节奏缩放；0 = 常驻
function _resolveToastLife(life) {
    if (life === 0) return 0;
    if (typeof life === 'number' && life > 0) return life;
    const table = TOAST_LIFE[_toastPace()];
    return table[life] || table.normal;
}

// 堆叠档：同类提示过多时挤掉最旧的，避免刷屏。
//   flash  = success / info（最多 1 条，后来的顶掉前面的）
//   notice = error / warning（最多 3 条）
//   action = 提醒 / 撤销 / 确认（不限，需要用户处理）
const TOAST_PROFILES = Object.freeze({
    flash: { stack: 1 },
    notice: { stack: 3 },
    action: { stack: 0 }
});

function _toastProfileOfTone(tone) {
    return (tone === 'error' || tone === 'warning') ? 'notice' : 'flash';
}

function _trimToastStack(container, stackKey, max) {
    if (!max) return;
    const same = Array.prototype.filter.call(
        container.children,
        el => el.getAttribute('data-stack') === stackKey && !el.hasAttribute('data-closing')
    );
    const overflow = same.length - max + 1;
    for (let i = 0; i < overflow; i++) {
        const old = same[i];
        if (!old) break;
        old.setAttribute('data-closing', '1');
        old.style.transition = 'opacity .18s';
        old.style.opacity = '0';
        setTimeout(() => old.remove(), 200);
    }
}

// Esc 关闭最上面一张带按钮的卡（只有存在时才处理，不干扰弹窗自身的 Esc）
let _toastEscBound = false;
function _bindToastEsc() {
    if (_toastEscBound) return;
    _toastEscBound = true;
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const list = document.querySelectorAll('#toast-container [data-toast-esc]');
        const last = list[list.length - 1];
        if (!last) return;
        // 不 stopPropagation：应用自身的 Esc（关弹窗/详情栏）应照常生效
        last.dispatchEvent(new CustomEvent('toast:close'));
    });
}

// 内核：渲染一张卡并接管生命周期，返回 { el, close, isClosed }
// cfg = {
//   tone, title, titleRaw, titleCls,
//   body, bodyCls, extraHtml, badge, icon,
//   actions: [{ label, variant, cls, onClick }],
//   layout: 'row' | 'col', variant: 'compact',
//   life: 毫秒 | 0（常驻）,
//   clickToClose, onBodyClick, onExpire
// }
function _toast(cfg) {
    const container = document.getElementById('toast-container');
    if (!container) return null;

    const tone = cfg.tone || 'info';
    const theme = TOAST_THEMES[tone] || TOAST_THEMES.info;
    const compact = cfg.variant === 'compact';
    const life = _resolveToastLife(cfg.life);
    const titleText = compact ? '' : (cfg.titleRaw ? String(cfg.title || '') : resolveToastTitle(cfg.title, tone));

    const actions = Array.isArray(cfg.actions) ? cfg.actions : [];
    const actHtml = (a, i) =>
        `<button data-toast-act="${i}" class="toast-btn toast-btn-${a.variant || 'primary'} ${a.cls || ''} relative z-10">${a.label}</button>`;

    // 堆叠档：同类提示超过上限时先挤掉最旧的
    const stackKey = cfg.stackKey || 'action';
    const stackMax = (TOAST_PROFILES[stackKey] || TOAST_PROFILES.action).stack;
    _trimToastStack(container, stackKey, stackMax);

    const el = document.createElement('div');
    el.setAttribute('data-stack', stackKey);
    // 读屏：错误用 alert（立即播报），其余用 status（排队播报）
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');

    if (compact) {
        el.className = `undo-toast flex items-center justify-between gap-3 px-3.5 py-2 bg-slate-900/95 backdrop-blur-sm border-l-4 ${theme.border} text-slate-200 ${theme.shadowSoft || theme.shadow} rounded-r-md w-full cursor-pointer hover:bg-slate-800 opacity-0`;
        el.innerHTML = `
        <span class="undo-msg flex-1 min-w-0 text-sm font-medium text-slate-300 truncate select-none leading-snug">${_toastEscape(cfg.body)}</span>
        ${actions.map((a, i) => actHtml(a, i)).join('')}
    `;
        // 单行 truncate 会截掉长文案，用原生 tooltip 补回全文（属性赋值，不拼 HTML）
        const msgEl = el.querySelector('.undo-msg');
        if (msgEl && cfg.body) msgEl.title = String(cfg.body);
    } else {
        const cls = ['quest-toast', 'flex', 'p-4', 'bg-slate-900/95', 'backdrop-blur-sm', 'border-l-4',
            theme.border, 'text-slate-200', theme.shadow, 'w-full'];
        if (cfg.layout === 'col') cls.push('flex-col');
        else cls.push('items-center');
        if (cfg.clickToClose) cls.push('cursor-pointer', 'hover:bg-slate-800', 'transition-colors');
        el.className = cls.join(' ');

        const orb = `
        <div class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full border-2 ${theme.border} ${theme.color} bg-slate-900 shadow-[0_0_10px_currentColor] mr-4 relative z-10">
            <i class="fas ${cfg.icon || theme.icon} text-lg"></i>${cfg.badge || ''}
        </div>`;
        const titleHtml = titleText
            ? `<div class="${theme.color} text-sm font-black tracking-[0.15em] uppercase mb-0.5 drop-shadow-md${cfg.titleCls ? ' ' + cfg.titleCls : ''}">${cfg.titleRaw ? _toastEscape(titleText) : titleText}</div>`
            : '';
        const bodyText = cfg.html ? (cfg.body || '') : _toastEscape(cfg.body);
        const bodyHtml = bodyText
            ? `<div class="text-sm font-medium text-slate-300 leading-snug break-words${cfg.bodyCls ? ' ' + cfg.bodyCls : ''}">${bodyText}</div>`
            : '';
        const info = `<div class="flex-1 min-w-0 relative z-10 flex flex-col justify-center">${titleHtml}${bodyHtml}${cfg.extraHtml || ''}</div>`;

        if (cfg.layout === 'col') {
            el.innerHTML = `
        <div class="flex items-center">${orb}${info}</div>
        ${actions.length ? `<div class="flex gap-2 mt-3 relative z-10 justify-end">${actions.map((a, i) => actHtml(a, i)).join('')}</div>` : ''}
    `;
        } else {
            el.innerHTML = `
        ${orb}${info}
        ${actions.length ? `<div class="flex gap-2 relative z-10 flex-shrink-0">${actions.map((a, i) => actHtml(a, i)).join('')}</div>` : ''}
        ${life > 0 && cfg.progress !== false
                    ? `<div class="toast-progress absolute bottom-0 left-0 h-1 ${theme.bg} opacity-80" style="animation: progressShrink ${life}ms linear forwards;"></div>`
                    : ''}
    `;
        }
    }

    container.appendChild(el);

    // 单行条走透明度渐变，必须先强制一次样式计算，否则首帧与目标帧合并、渐变不触发
    if (compact) {
        void el.offsetWidth;
        requestAnimationFrame(() => {
            el.classList.remove('opacity-0');
            el.classList.add('opacity-100');
        });
    }

    let closed = false;
    let timer = null, remaining = life, startedAt = 0;

    function close() {
        if (closed) return;
        closed = true;
        if (timer) { clearTimeout(timer); timer = null; }
        if (compact) {
            el.classList.remove('opacity-100');
            el.classList.add('opacity-0');
            setTimeout(() => el.remove(), 300);
        } else {
            el.classList.add('quest-toast-out');
            setTimeout(() => el.remove(), 400);
        }
    }

    function startTimer() {
        if (!remaining) return;
        startedAt = Date.now();
        timer = setTimeout(() => {
            close();
            if (typeof cfg.onExpire === 'function') cfg.onExpire();
        }, remaining);
    }

    // 重置计时：给「结果态」条子（如 UNDO 原地改写后）续一段可读时长。
    // 悬停中调用会顺带解除暂停态，与 mouseleave 后的重启口径一致。
    function renew(nextLife) {
        if (closed) return;
        if (timer) { clearTimeout(timer); timer = null; }
        remaining = _resolveToastLife(nextLife);
        el.classList.remove('toast-paused');
        startTimer();
    }

    if (life > 0) {
        startTimer();
        // 悬停暂停：进度条与计时器一起停（只停 CSS 会出现「条停住、卡照走」）
        el.addEventListener('mouseenter', () => {
            if (!timer) return;
            clearTimeout(timer); timer = null;
            remaining = Math.max(600, remaining - (Date.now() - startedAt));
            el.classList.add('toast-paused');
        });
        el.addEventListener('mouseleave', () => {
            if (closed || timer) return;
            el.classList.remove('toast-paused');
            startTimer();
        });
    }

    // 带按钮的卡可用 Esc 关闭（最上面那张）
    if (actions.length) {
        el.setAttribute('data-toast-esc', '1');
        el.tabIndex = 0;
        el.addEventListener('toast:close', close);
        _bindToastEsc();
    }

    actions.forEach((a, i) => {
        const btn = el.querySelector('[data-toast-act="' + i + '"]');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // keepOpen：点击后不自动关闭，由 onClick 自行处置
            // （撤销条结果态原地改写：UNDO → 状态文字，条子续显后自然淡出）
            if (a.keepOpen) {
                if (typeof a.onClick === 'function') a.onClick({ el: el, close: close, renew: renew });
                return;
            }
            close();
            if (typeof a.onClick === 'function') a.onClick();
        });
    });

    if (cfg.onBodyClick) {
        el.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            close();
            cfg.onBodyClick();
        });
    } else if (cfg.clickToClose) {
        el.addEventListener('click', () => close());
    }

    return { el, close, isClosed: () => closed, renew: renew };
}

// Toast通知 - 游戏任务提示风格
// 堆叠档由 type 自动决定：success/info → flash（同类顶替），error/warning → notice（最多 3 条）
function showToast(message, type = 'info', customDuration = null, title = null) {
    return _toast({
        tone: type,
        title: title,
        body: message,
        life: customDuration,
        stackKey: _toastProfileOfTone(type),
        clickToClose: true
    });
}

// 带动作按钮的 Toast（精简单行版）：FR-01 撤销入口
// 设计意图：它是「可操作提示」而不是「状态播报」，视觉权重应当低于 showToast。
//   砍掉大图标 / 大写状态标题 / 倒计时条，只保留单行「文本 + 撤销按钮」，
//   内边距由 p-4 收到 px-3.5 py-2，进出场改为 0.3s 纯淡入淡出（无位移关键帧）。
// ⚠️ 不带 .quest-toast 类，所以没有切角 / 入场位移 / 扫光 / 进度条；
//    而 #toast-container 是 pointer-events-none，**必须**靠 .undo-toast 单独开启
//    pointer-events，否则整条（含 UNDO 按钮）点不动（规则见 index_offline.html）。
// ⚠️ 消息单行 truncate：超长文案（如外部订阅删除的那段说明）会被截断，这是单行设计的代价，
//    内核会给文本加原生 title 补回全文。
// 使用最低一档时长（short，随「消息显示时长」缩放），到点只关 Toast、不清撤销栈。
// 点击 UNDO：执行 undoFn()（内部完成数据回滚 + 保存 + 重渲染）→ **不弹新提示**，
//   在本条内原地改写为结果态——UNDO 按钮位置换成状态文字（已撤销 / 撤销失败），
//   并 renew('short') 续一次最短档时长后自然淡出。
//   undoFn 必须返回 _executeUndoEntry 的结果对象 { ok, reason }（见 trash.js）：
//     ok=true           成功。reason==='already-done' 表示该操作此前已被其他入口撤销过，
//                      数据确已恢复，仍按成功态展示（绿字），仅 title 补一句说明；
//     ok=false, reason  失败，reason 映射为短文案显示在正文位置：
//                        invalid    → 操作已失效
//                        exception  → 撤销时出错（异常详情进 console.error 与 title）
// 点击卡片其余区域：仅关闭（栈由 undoFn 侧自行管理，不在此清空）。
function showUndoToast(message, undoFn, opts = {}) {
    return _toast({
        variant: 'compact',
        tone: opts.type || 'info',
        body: message,
        life: 'short',
        clickToClose: true,
        actions: [{
            label: opts.actionLabel || 'UNDO',
            variant: 'primary',
            cls: 'toast-action-btn flex-shrink-0 text-xs !py-1 !px-2.5 uppercase tracking-wider',
            keepOpen: true,
            onClick: function (ctx) {
                // 结果态原地改写：UNDO 按钮 → 状态文字；失败时正文换为原因短语
                let r = null;
                try {
                    r = (typeof undoFn === 'function') ? undoFn() : null;
                } catch (e) {
                    console.error('[toast] 撤销回调执行异常：', e);
                    r = { ok: false, reason: 'exception' };
                }
                const ok = !!(r && r.ok);
                const el = (ctx && ctx.el) || null;
                if (!el) return;
                // 颜色走行内样式：Tailwind JIT 对运行时新增类有首帧延迟，
                // 左边框变色会闪一帧（历史教训见 index.html .undo-toast 注释）
                el.style.borderLeftColor = ok ? '#22c55e' : '#f59e0b';
                if (ok) {
                    _setUndoToastStatus(el, '已撤销', '#4ade80',
                        (r && r.reason === 'already-done') ? '该操作此前已撤销过' : '');
                } else {
                    const reasonText = { invalid: '操作已失效', exception: '撤销时出错' }[r && r.reason] || '撤销失败';
                    _setUndoToastStatus(el, '撤销失败', '#fbbf24', '');
                    // 失败原因写到正文位置（flex-1 比按钮位宽，truncate 前可读）
                    const msg = el.querySelector('.undo-msg');
                    if (msg) {
                        msg.textContent = reasonText;
                        msg.title = '撤销失败：' + reasonText;
                    }
                }
                // 结果态续一次最短档时长，保证「已撤销 / 撤销失败」读得完
                if (ctx && typeof ctx.renew === 'function') ctx.renew('short');
            }
        }]
    });
}

// 撤销条结果态：把 UNDO 按钮替换为纯文字状态（无交互）。
// ⚠️ 盒模型必须复刻 UNDO 按钮（padding 6px 12px + 1px 透明边框，与 .toast-btn 一致）：
//    条高由最高 flex 子元素决定，芯片若只写文字会比按钮矮一截、整条塌陷；
//    复刻盒模型后芯片与按钮等高（实测均 30px），正文截断边界也与点击前一致。
//    颜色走行内样式（防 JIT 首帧闪色）。
function _setUndoToastStatus(el, text, color, tip) {
    const btn = el.querySelector('.toast-action-btn');
    if (!btn) return;
    const span = document.createElement('span');
    span.className = 'flex-shrink-0 text-xs font-bold tracking-wider select-none';
    span.style.padding = '6px 12px';
    span.style.border = '1px solid transparent';
    span.style.color = color;
    span.textContent = text;
    if (tip) span.title = tip;
    btn.replaceWith(span);
}

// 精简单行状态条（无按钮）：与 showUndoToast 同骨架（.undo-toast 单行条），
// 省去动作按钮，只播报状态。供撤销类通知使用：
//   Ctrl+Z / 命令面板 /undo 的成功结果（tone:'success'）、空栈提示（tone:'info'）、
//   以及「撤销跳过周期 / 撤销配色编辑」等独立撤销操作的结果。
function showCompactToast(message, opts = {}) {
    return _toast({
        variant: 'compact',
        tone: opts.tone || 'info',
        body: message,
        life: opts.life || 'short',
        clickToClose: true
    });
}

// 确认卡：常驻直到用户选择；30s 未响应走 onExpire（默认 = onCancel）
// 第 4 参 opts 可选：
//   confirmLabel / cancelLabel —— 覆盖默认 YES / NO 文案；
//   onExpire —— 覆盖超时动作。⚠️ 用 hasOwnProperty 判存，传 **null 表示「超时什么都不做」**
//     （只收起卡片）；当 onCancel 具有破坏性（如丢弃未保存的修改）时必须传 null，
//     否则「用户只是走神了」会被判定成「用户选了取消」。不传则沿用 onCancel（旧行为）。
// 布局固定 layout:'col'：两个按钮排在正文下方，而不是挤在正文右侧——
//   中文动作名比 YES / NO 长得多，右侧横排会把卡片撑宽并压扁正文。
// ⚠️ 只改按钮文字与位置，不新增弹层样式——按钮仍走 .toast-btn primary / ghost 两个 variant，
//    需要中文动作名（如「应用并退出」/「直接退出」）的调用方一律复用本卡，不要另造弹层。
function showConfirmToast(message, onConfirm, onCancel, opts) {
    opts = opts || {};
    const onExpire = Object.prototype.hasOwnProperty.call(opts, 'onExpire') ? opts.onExpire : onCancel;
    return _toast({
        tone: 'info',
        icon: 'fa-question-circle',
        title: TOAST_TITLES.confirm,
        body: message,
        layout: 'col',
        life: 30000,
        progress: false,
        onExpire: onExpire,
        actions: [
            { label: opts.confirmLabel || 'YES', variant: 'primary', cls: 'confirm-yes-btn', onClick: onConfirm },
            { label: opts.cancelLabel || 'NO', variant: 'ghost', cls: 'confirm-no-btn', onClick: onCancel }
        ]
    });
}

// 构造提醒Toast第2行显示文本
// 有子任务：默认清单只显示正文；非默认清单显示"清单名 | 正文"
//   正文优先取子任务模式的「详情描述」（task.description），未填写描述时回落任务名。
//   ⚠️ 描述非空时任务名就不会出现在 Toast 里了（第 1 行是服务端拼的"时间 · 子任务名"）——
//      这是用户确认过的口径：第 1 行保留子任务名，第 2 行让位给详情描述。
// 无子任务：显示 message 原样（含notes或任务名）
function buildReminderDisplayMessage(message, task, taskTitle, subtaskHtml) {
    if (!subtaskHtml) {
        // 无子任务：message 正常显示（可能含 notes 或任务名）
        return message;
    }
    const taskName = task ? (task.title || taskTitle) : taskTitle;
    // 仅子任务模式（mode !== 'text'）才有详情描述；文本模式即使残留 description 字段也不参与展示
    const description = (task && task.mode !== 'text') ? (task.description || '').trim() : '';
    const body = description || taskName;
    if (message.includes(' | ')) {
        // 非默认清单：显示"清单名 | 正文"
        return message.split(' | ')[0] + ' | ' + body;
    }
    // 默认清单：仅显示正文
    return body;
}

// 剥掉服务端标题里的提前量时机段（「 · 30 分钟后 / · 1 小时后 / · 1 天」）。
// 该段只为系统通知栏服务（桌面通知只有一行标题，必须自带"还有多久"）；
// 应用内 Toast 的标题行要与准点提醒保持同一套规整格式，时机改由图标徽标承载。
// ⚠️ 只剥「时长」段：`09-23 09:00` 里的日期属于「任务时间」，必须保留。
// ⚠️ 提前 ≥1 天那一档服务端不带「后」（`09-23 09:00 · 1 天`），所以「后」是可选后缀。
// ⚠️ 只剥第一段（`[^·]*` 不允许跨过 ·），避免把任务名/子任务名里恰好出现的
//    「· 30 分钟后」字样一并吃掉。
function _stripAdvanceSuffix(title) {
    // 捕获组用惰性匹配，避免把「·」前的空格一起吃进 $1 而留下双空格
    return (title || '').replace(/^([^·]*?)\s*·\s*\d+\s*(?:分钟|小时|天)后?/, '$1').trim();
}

// 提前量中文全称：5 分钟 / 1 小时 / 1 天（与 server.py:_humanize_minute 同语义）
// ⚠️ 只用于徽标的 title 悬浮提示语——紧凑徽标里塞中文会把徽标撑宽，但提示语读起来要自然。
function _humanizeAdvance(minute) {
    const m = parseInt(minute, 10);
    if (!m || m <= 0) return '';
    if (m >= 1440 && m % 1440 === 0) return (m / 1440) + ' 天';
    if (m >= 60 && m % 60 === 0) return (m / 60) + ' 小时';
    return m + ' 分钟';
}

// 提前量徽标文案（原方案 A 的紧凑写法）：30′ / 1h / 1d
// ⚠️ 分钟档用 PRIME（U+2032）而不是撇号 ' / 反引号 ` / 单引号：
//    只有它是有排版语义的「分」符号，字形窄且带斜度，10px 下也不会糊成一团。
function _formatAdvanceBadge(minute) {
    const m = parseInt(minute, 10);
    if (!m || m <= 0) return '';
    if (m >= 1440 && m % 1440 === 0) return (m / 1440) + 'd';
    if (m >= 60 && m % 60 === 0) return (m / 60) + 'h';
    return m + '\u2032';
}

// 构造提醒Toast第1行
// 规则：若第2行(displayMessage)已包含任务名，则第1行只显示时间，避免重复；
//       若第2行不含任务名（如显示notes），则第1行显示"时间 任务名"
// 提前提醒标题形如 "08:30 · 30 分钟后"：先剥掉时机段 → 与准点提醒同格式（"08:30"）。
// 子任务提醒标题形如 "08:50 · 10 分钟后 · 冻结代码分支"：剥掉后为 "08:50 · 冻结代码分支"，
// 与子任务准点提醒完全一致，故含 · 时整段保留。
function buildReminderDisplayTitle(title, task, taskTitle, displayMessage) {
    const raw = _stripAdvanceSuffix(title);
    // 含 · 的标题（子任务提醒）整段显示，不做裁剪
    if (raw.includes('·')) {
        return raw;
    }
    // 提取纯时间部分
    const timeMatch = raw.match(/^(\d{1,2}:\d{2})/);
    const timeOnly = timeMatch ? timeMatch[1] : raw;
    const taskName = task ? (task.title || taskTitle) : taskTitle;

    // 判断第2行是否已包含任务名
    // 子任务模式：displayMessage 为 "任务名" 或 "清单名 | 任务名"，均含任务名
    // 文本模式无notes：displayMessage 为 "任务名" 或 "清单名 | 任务名"，均含任务名
    // 文本模式有notes：displayMessage 为 "notes" 或 "清单名 | notes"，不含任务名
    const messageIncludesTaskName = displayMessage === taskName
        || (taskName && displayMessage.endsWith(' | ' + taskName));

    if (messageIncludesTaskName) {
        // 第2行已含任务名，第1行只显示时间
        return timeOnly;
    }
    // 第2行不含任务名，第1行显示"时间 任务名"
    return taskName ? `${timeOnly} ${taskName}` : timeOnly;
}

// 任务提醒Toast - 带Focus/Done/Later/OK四个按钮，不自动消失
// opts（可选）：{ subtaskId, pendingSubtasks, reminderKind, reminderMinute }
//   subtaskId 存在时进入「子任务提醒」模式：
//     - 视觉与主任务区分（蓝色 + fa-list-check）
//     - 到点的子任务在列表中高亮
//     - DONE 语义变为「勾选该子任务」而非完成整个任务
//     - 展示 5 秒窗口内同时到点的其他子任务
//   reminderKind === 'advance' 时在图标正下方（6 点钟方向）挂提前量徽标，
//   与准点提醒（无徽标）区分——标题行保持「时间 [任务名]」的规整格式，不放时机语义。
// ⚠️ 卡片由 _toast 渲染，这里只负责「算文案 + 配动作」。
//    标题行是「时间 · 对象」头部而不是状态词，故用 titleRaw 跳过方案 A 的词表校验。
// ⚠️ 第 2 行保留 .reminder-toast-body（纯 CSS，-webkit-line-clamp:2）：
//    详情描述是自由文本，不设上限时 400 字能把 Toast 撑到 534px（基线 149px）。
//    该类同时是测试脚本定位第 2 行的稳定锚点——**别用 .text-sm 定位**，
//    因为第 1 行现在也是 text-sm，querySelector 会先命中标题行。
function showReminderToast(title, message, taskId, opts = {}) {
    const subtaskId = opts.subtaskId || null;
    const pendingSubtasks = Array.isArray(opts.pendingSubtasks) ? opts.pendingSubtasks : [];
    // 提前提醒徽标文案（准点/稍后提醒为空串 → 不渲染徽标）
    const advanceBadge = opts.reminderKind === 'advance'
        ? _formatAdvanceBadge(opts.reminderMinute) : '';

    // 从message中提取任务名称（格式可能是"清单名 | 任务名"或纯任务名）
    const taskTitle = message.includes(' | ') ? message.split(' | ').pop() : message;

    // 查找任务以获取子任务信息
    const task = (typeof tasks !== 'undefined') ? tasks.find(t => t.id === taskId) : null;
    // 子任务逐行展示（深色背景模式），到点的子任务高亮
    const subtaskHtml = task ? renderSubtaskListDisplay(task, 'dark', subtaskId) : '';

    // 第2行：根据子任务情况构造显示文本（需先计算，供第1行判断是否显示任务名）
    const displayMessage = buildReminderDisplayMessage(message, task, taskTitle, subtaskHtml);

    // 第1行：若第2行已含任务名则只显示时间，否则显示"时间 任务名"
    const displayTitle = buildReminderDisplayTitle(title, task, taskTitle, displayMessage);

    // 同时到点的其他子任务（聚合提示，避免多条 Toast 糊满屏幕）
    const pendingHtml = (subtaskId && pendingSubtasks.length)
        ? `<div class="text-xs text-slate-400 mt-1 relative z-10">另有 ${pendingSubtasks.length} 个子任务同时到点：${escapeHtml(pendingSubtasks.join('、'))}</div>`
        : '';
    const badgeHtml = advanceBadge
        ? `<span class="reminder-advance-badge" title="提前 ${escapeHtml(_humanizeAdvance(opts.reminderMinute))}提醒">${escapeHtml(advanceBadge)}</span>`
        : '';

    // 点击卡片非按钮区域：关闭 Toast 并打开任务详情栏
    const openDetail = function () {
        if (!taskId) return;
        // 若处于番茄专注页面或其他非默认视图，先切换回默认视图
        const pomodoroPage = document.getElementById('pomodoro-page');
        if (pomodoroPage && !pomodoroPage.classList.contains('hidden')) {
            if (typeof closePomodoroPage === 'function') closePomodoroPage();
        }
        // 确保处于默认任务视图
        if (typeof currentView !== 'undefined' && currentView !== 'task') {
            if (typeof switchToTaskView === 'function') {
                switchToTaskView();
            } else {
                currentView = 'task';
                if (typeof renderView === 'function') renderView();
                if (typeof updateSidebarHighlight === 'function') updateSidebarHighlight();
            }
        }
        if (typeof openTaskDetailPanel === 'function') {
            // 等待视图切换渲染完成后再打开详情面板
            setTimeout(() => openTaskDetailPanel(taskId), 0);
        }
    };

    _toast({
        layout: 'col',
        tone: subtaskId ? 'reminder-subtask' : 'reminder',
        titleRaw: true,
        title: displayTitle,
        titleCls: 'truncate',
        body: displayMessage,
        bodyCls: 'reminder-toast-body',
        extraHtml: subtaskHtml + pendingHtml,
        badge: badgeHtml,
        life: 0,
        onBodyClick: openDetail,
        actions: [
            {
                // Focus: 开始/切换番茄专注
                label: 'FOCUS', variant: 'primary', cls: 'reminder-focus-btn',
                onClick: function () {
                    if (taskId && typeof startPomodoroForTask === 'function') {
                        startPomodoroForTask(taskId);
                    }
                }
            },
            {
                // Done: 主任务提醒 → 标记任务完成；子任务提醒 → 勾选该子任务
                // （子任务场景下若沿用"完成整个任务"会造成误操作，语义必须区分）
                label: 'DONE', variant: 'success', cls: 'reminder-done-btn',
                onClick: function () {
                    if (!taskId) return;
                    if (subtaskId) {
                        if (typeof toggleSubtaskComplete === 'function') {
                            const t = (typeof tasks !== 'undefined') ? tasks.find(x => x.id === taskId) : null;
                            const st = t ? (t.subtasks || []).find(x => x.id === subtaskId) : null;
                            if (st && !st.completed) {
                                // 显式传 taskId：提醒弹出时详情面板可能未打开或显示别的任务
                                toggleSubtaskComplete(subtaskId, true, taskId);
                            }
                        }
                        return;
                    }
                    if (typeof toggleTaskComplete === 'function') {
                        const t = (typeof tasks !== 'undefined') ? tasks.find(x => x.id === taskId) : null;
                        if (t && !t.completed) toggleTaskComplete(taskId);
                    }
                }
            },
            {
                // Later: 稍后提醒（子任务场景下延迟的是该子任务）
                // 灰色 = 关闭/推迟，与 FOCUS 的青色主操作区分（一卡只留一个 primary）
                label: 'LATER', variant: 'ghost', cls: 'reminder-later-btn',
                onClick: function () {
                    if (!taskId) return;
                    const delayMinutes = (typeof settings !== 'undefined' && settings.snoozeDelay) ? settings.snoozeDelay : 15;
                    const payload = { taskId: taskId, delayMinutes: delayMinutes };
                    if (subtaskId) payload.subtaskId = subtaskId;
                    fetch('/api/reminder/snooze', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    }).catch(err => console.error('Snooze error:', err));
                    if (typeof showToast === 'function') {
                        const snoozeTask = (typeof tasks !== 'undefined') ? tasks.find(t => t.id === taskId) : null;
                        const snoozeMsg = snoozeTask ? buildTaskToastMessage(snoozeTask) : taskTitle;
                        // 方案 A：标题只表达状态，时机信息并入正文
                        showToast(snoozeMsg + ' · ' + delayMinutes + ' 分钟后再次提醒', 'info');
                    }
                }
            },
            {
                // OK: 仅关闭（内核已负责关闭）
                label: 'OK', variant: 'ghost', cls: 'reminder-ok-btn',
                onClick: function () { }
            }
        ]
    });
}

let _browserNotificationPermission = 'default';

function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        _browserNotificationPermission = 'granted';
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(perm => {
            _browserNotificationPermission = perm;
        });
    } else {
        _browserNotificationPermission = Notification.permission;
    }
}

function sendBrowserNotification(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        const notif = new Notification(title, {
            body: body || '',
            icon: '/favicon.ico',
            requireInteraction: true
        });
        notif.onclick = () => {
            window.focus();
            notif.close();
        };
    } catch (e) {
        console.error('Browser notification error:', e);
    }
}

// 系统通知（番茄阶段 / 休眠检测等）的 title 是「信息」而非「状态」。
// 方案 A 下标题行只放状态词，故把标题并入正文首段；系统通知栏仍用原标题（那里只有一行，必须有标题）。
function _mergeNoticeTitle(title, body) {
    const t = (title || '').trim();
    const b = (body || '').trim();
    if (!t) return b;
    if (!b) return t;
    return t + '：' + b;
}

// type 由调用方按语义指定（如「专注完成」→ success、「系统休眠检测」→ warning），
// 标题行统一交给 type 派生，不再透传自由文本。
function showInAppNotification(title, body, type = 'info') {
    if (typeof sendBackendNotification === 'function') {
        sendBackendNotification(title, body);
    }
    if (!document.hidden) {
        showToast(_mergeNoticeTitle(title, body), type, 'long');
        // 页面可见时已直接显示Toast，标记该通知为已展示，避免checkBrowserNotifications重复弹出
        // 键格式与 _notifKey 保持一致（末尾空 subtaskId）
        _displayedNotificationKeys.add(title + ':' + body + ':');
    }
}

// 记录已直接展示过的通知，避免checkBrowserNotifications重复弹出
let _displayedNotificationKeys = new Set();

// 页面不可见时缓存的通知，等页面可见时再显示
let _pendingDisplayNotifs = [];

function _displayNotification(n) {
    if (n.taskId) {
        showReminderToast(n.title || 'REMINDER', n.body || '', n.taskId, {
            subtaskId: n.subtaskId || null,
            reminderKind: n.reminderKind || null,
            reminderMinute: n.reminderMinute || 0
        });
    } else {
        showToast(_mergeNoticeTitle(n.title, n.body), 'info', 'long');
    }
}

// 通知去重键：加入 subtaskId，避免同一任务同一时刻的多个子任务通知被误判为重复而丢弃
function _notifKey(n) {
    return (n.title || '') + ':' + (n.body || '') + ':' + (n.subtaskId || '');
}

// 取子任务文本（用于聚合提示）
function _subtaskTextOf(taskId, subtaskId) {
    if (typeof tasks === 'undefined') return '';
    const task = tasks.find(t => t.id === taskId);
    if (!task) return '';
    const st = (task.subtasks || []).find(s => s.id === subtaskId);
    return st ? (st.text || '') : '';
}

// 批量展示通知：同一主任务的多个子任务提醒聚合为一个 Toast，避免刷屏
function _displayNotificationBatch(notifs) {
    const subtaskGroups = new Map(); // taskId -> [notif, ...]
    notifs.forEach(n => {
        if (n.taskId && n.subtaskId) {
            if (!subtaskGroups.has(n.taskId)) subtaskGroups.set(n.taskId, []);
            subtaskGroups.get(n.taskId).push(n);
        } else {
            _displayNotification(n);
        }
    });
    subtaskGroups.forEach((group, taskId) => {
        const first = group[0];
        const pendingSubtasks = group.slice(1)
            .map(n => _subtaskTextOf(taskId, n.subtaskId))
            .filter(t => t);
        showReminderToast(first.title || 'REMINDER', first.body || '', taskId, {
            subtaskId: first.subtaskId,
            pendingSubtasks,
            reminderKind: first.reminderKind || null,
            reminderMinute: first.reminderMinute || 0
        });
    });
}

function checkBrowserNotifications() {
    fetch('/api/notifications').then(r => r.json()).then(notifs => {
        if (!notifs || notifs.length === 0) return;
        const fresh = [];
        notifs.forEach(n => {
            const key = _notifKey(n);
            if (_displayedNotificationKeys.has(key)) {
                // 已直接展示过，跳过
                _displayedNotificationKeys.delete(key);
                return;
            }
            // 番茄阶段通知覆盖：新通知到达时清除同类的缓存旧通知
            // 确保用户切回页面时只看到最新阶段的状态（如休息结束覆盖专注完成）
            if (n.category === 'pomodoro') {
                _pendingDisplayNotifs = _pendingDisplayNotifs.filter(pn => pn.category !== 'pomodoro');
            }
            if (!document.hidden) {
                fresh.push(n);
            } else {
                // 页面不可见时缓存通知，等页面可见时再显示
                _pendingDisplayNotifs.push(n);
            }
        });
        if (fresh.length) _displayNotificationBatch(fresh);
    }).catch(err => {
        console.error('Check notifications error:', err);
    });
}

// 页面变为可见时，显示缓存的通知
function flushPendingNotifications() {
    const notifs = _pendingDisplayNotifs.slice();
    _pendingDisplayNotifs = [];
    const fresh = [];
    notifs.forEach(n => {
        const key = _notifKey(n);
        if (_displayedNotificationKeys.has(key)) {
            _displayedNotificationKeys.delete(key);
            return;
        }
        fresh.push(n);
    });
    if (fresh.length) _displayNotificationBatch(fresh);
}

let bgImageBrightness = 0.5;
function analyzeBgImageBrightness() {
    const src = _getEffectiveBgImageSrc();
    if (!src) {
        bgImageBrightness = 0.5;
        updateBgTextAdaptation();
        return;
    }
    const img = new Image();
    if (!src.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
    }
    img.onload = function() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const sampleSize = 50;
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
        try {
            const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
            let totalBrightness = 0;
            const pixelCount = data.length / 4;
            for (let i = 0; i < data.length; i += 4) {
                totalBrightness += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
            }
            bgImageBrightness = totalBrightness / pixelCount;
        } catch (e) {
            bgImageBrightness = 0.5;
        }
        updateBgTextAdaptation();
        renderView();
    };
    img.onerror = function() {
        bgImageBrightness = 0.5;
        updateBgTextAdaptation();
    };
    img.src = src;
}

function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function shouldUseLightText() {
    if (isDarkMode()) return true;
    if (typeof _getEffectiveBgImageSrc === 'function' && _getEffectiveBgImageSrc() && bgImageBrightness < 0.45) return true;
    return false;
}

function getAdaptiveTextColor(baseColor) {
    if (shouldUseLightText()) {
        return lightenColor(baseColor, 40);
    }
    return baseColor;
}

function lightenColor(hex, amount) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    r = Math.min(255, r + amount);
    g = Math.min(255, g + amount);
    b = Math.min(255, b + amount);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// 获取优先级显示模式（含旧数据兼容）
// 'bg'=任务底色 / 'checkbox'=复选框边框(默认) / 'bar'=左侧色条 / 'none'=不显示
function getPriorityDisplayMode() {
    if (settings && settings.priorityDisplayMode) return settings.priorityDisplayMode;
    // 向后兼容旧布尔值 priorityTaskBg
    if (settings && settings.priorityTaskBg === false) return 'none';
    if (settings && settings.priorityTaskBg === true) return 'bg';
    return 'checkbox';
}

// 获取任务的四象限颜色类
// opts.forceBg=true 时强制使用优先级底色（供计划面板等不响应模式的视图使用）
function getQuadrantColorClass(task, opts) {
    const isDark = isDarkMode();
    // 有无背景图按「当前生效背景」判断（轮播模式取轮播图，单张模式取 settings.bgImage），
    // 避免轮播模式下误走无图分支导致浅色模式卡片使用不透明 bg-gray-50
    const hasBg = (typeof _getEffectiveBgImageSrc === 'function')
        ? !!_getEffectiveBgImageSrc()
        : !!settings.bgImage;
    // 底色仅在 'bg' 模式启用；forceBg 可强制开启（计划面板等保持现状的视图）
    const usePriority = (opts && opts.forceBg) || getPriorityDisplayMode() === 'bg';
    // 有背景图时，中性底色跟随图片明暗（复用 shouldUseLightText 的亮度分析），
    // 暗图用深色叠加、亮图用浅色叠加，避免固定浅灰在暗图上发雾、与自适应文字错配。
    const neutralBg = hasBg
        ? (shouldUseLightText() ? 'bg-black/25' : 'bg-white/25')
        : (isDark ? 'bg-gray-700/30' : 'bg-gray-50');
    if (task.important && task.urgent) {
        if (hasBg) return { bg: usePriority ? 'bg-red-500/25' : neutralBg, border: 'border-l-red-400', dot: 'bg-red-400', light: '#fee2e2' };
        return isDark
            ? { bg: usePriority ? 'bg-red-900/20' : neutralBg, border: 'border-l-red-400', dot: 'bg-red-400', light: '#7f1d1d' }
            : { bg: usePriority ? 'bg-red-50' : neutralBg, border: 'border-l-red-400', dot: 'bg-red-400', light: '#fee2e2' };
    } else if (task.important && !task.urgent) {
        if (hasBg) return { bg: usePriority ? 'bg-blue-500/25' : neutralBg, border: 'border-l-blue-400', dot: 'bg-blue-400', light: '#dbeafe' };
        return isDark
            ? { bg: usePriority ? 'bg-blue-900/20' : neutralBg, border: 'border-l-blue-400', dot: 'bg-blue-400', light: '#1e3a5f' }
            : { bg: usePriority ? 'bg-blue-50' : neutralBg, border: 'border-l-blue-400', dot: 'bg-blue-400', light: '#dbeafe' };
    } else if (!task.important && task.urgent) {
        if (hasBg) return { bg: usePriority ? 'bg-amber-500/25' : neutralBg, border: 'border-l-amber-400', dot: 'bg-amber-400', light: '#fef9c3' };
        return isDark
            ? { bg: usePriority ? 'bg-yellow-900/20' : neutralBg, border: 'border-l-yellow-400', dot: 'bg-yellow-400', light: '#713f12' }
            : { bg: usePriority ? 'bg-yellow-50' : neutralBg, border: 'border-l-yellow-400', dot: 'bg-yellow-400', light: '#fef9c3' };
    } else {
        // 不重要不紧急：始终用中性底色，与复选框边框/左侧色条/不显示模式保持一致（不按优先级单独上灰底）
        if (hasBg) return { bg: neutralBg, border: 'border-l-slate-400', dot: 'bg-slate-400', light: '#f3f4f6' };
        return isDark
            ? { bg: neutralBg, border: 'border-l-gray-400', dot: 'bg-gray-400', light: '#374151' }
            : { bg: neutralBg, border: 'border-l-gray-400', dot: 'bg-gray-400', light: '#f3f4f6' };
    }
}

// 统一获取任务复选框边框类（未完成态）
// 'checkbox' 模式按优先级着色；其他模式回退主题色
function getTaskCheckboxClass(task) {
    if (getPriorityDisplayMode() !== 'checkbox') {
        return 'border-accent hover:border-accent-hover';
    }
    if (task.important && task.urgent)
        return 'border-red-500 dark:border-red-400 hover:border-red-600 dark:hover:border-red-500';
    if (task.important && !task.urgent)
        return 'border-blue-500 dark:border-blue-400 hover:border-blue-600 dark:hover:border-blue-500';
    if (!task.important && task.urgent)
        return 'border-yellow-500 dark:border-yellow-400 hover:border-yellow-600 dark:hover:border-yellow-500';
    return 'border-gray-400 dark:border-gray-500 hover:border-gray-500 dark:hover:border-gray-400';
}

// 统一渲染任务勾选框（各视图共享）
// opts: {
//   taskId:     string           - 勾选回调参数（缺省时渲染为静态 div，无点击行为，用于归档列表等只读场景）
//   iconSize:   'text-xs'|'text-[10px]' - 对勾图标尺寸（默认 text-[10px]，与看板/周月视图统一）
//   boxClass:   'w-5 h-5'        - 勾选框尺寸类（默认 w-5 h-5；月/周视图等紧凑场景用 w-4 h-4）
//   draggable:  false            - 看板场景需显式 draggable="false" 防止拖拽冒泡
//   title:      '标记完成'        - 悬浮提示
//   extraClass: string           - 附加类（如看板的 flex-shrink-0、番茄页的 mt-1）
// }
function renderTaskCheckbox(task, opts = {}) {
    const {
        taskId = null,
        iconSize = 'text-[10px]',
        boxClass = 'w-5 h-5',
        draggable = false,
        title = '标记完成',
        extraClass = ''
    } = opts;
    const colorClass = task.completed ? 'bg-gray-400 border-gray-400 text-white' : getTaskCheckboxClass(task);
    const icon = task.completed ? `<i class="fas fa-check ${iconSize}"></i>` : '';
    // 无 taskId：只读静态展示（div）；有 taskId：可点击按钮
    if (taskId === null) {
        return `<div class="${boxClass} rounded-full border-2 flex items-center justify-center ${extraClass} ${colorClass}">${icon}</div>`;
    }
    return `<button onclick="event.stopPropagation(); toggleTaskComplete('${taskId}')" draggable="${draggable}" title="${title}" class="${boxClass} rounded-full border-2 flex items-center justify-center ${extraClass} transition ${colorClass}">${icon}</button>`;
}

// 统一获取左侧色条颜色（hex）
// 'bar' 模式按优先级着色；其他模式回退 fallbackColor（清单色）
function getTaskBarColor(task, fallbackColor) {
    if (getPriorityDisplayMode() !== 'bar') return fallbackColor;
    if (!task) return fallbackColor;
    if (task.important && task.urgent) return '#ef4444';
    if (task.important && !task.urgent) return '#3b82f6';
    if (!task.important && task.urgent) return '#eab308';
    return '#9ca3af';
}

// ==================== 外部日历订阅任务工具（共享层，双入口生效）====================
// 详见《外部日历订阅同步需求说明书.md》3.3 / 4.1 / 附录 A-1
const _CAL_SUB_COLOR_HEX = {
    blue: '#3b82f6', green: '#10b981', red: '#ef4444', purple: '#8b5cf6',
    orange: '#f59e0b', teal: '#14b8a6', pink: '#ec4899', gray: '#9ca3af'
};

function isExternalTask(task) {
    return !!(task && task.extSourceId);
}

// 外部任务色条色（订阅色）；非外部任务返回 fallbackColor
function _extTaskBarColor(task, fallbackColor) {
    if (!isExternalTask(task)) return fallbackColor;
    return (typeof getCalendarSubscriptionColorHex === 'function')
        ? getCalendarSubscriptionColorHex(task.extSourceId)
        : fallbackColor;
}

// 外部任务标题前图标 HTML（fa-calendar-day 染订阅色）；非外部任务返回空串
function _extTaskIconHtml(task) {
    if (!isExternalTask(task)) return '';
    const hex = (typeof getCalendarSubscriptionColorHex === 'function')
        ? getCalendarSubscriptionColorHex(task.extSourceId)
        : '#9ca3af';
    const name = (typeof getCalendarSubscriptionName === 'function')
        ? getCalendarSubscriptionName(task.extSourceId)
        : '外部日历';
    return `<i class="fas fa-calendar-day text-xs mr-1 flex-shrink-0" style="color:${hex}" title="来自 ${escapeHtml(name)}"></i>`;
}

// 离线版「显示外部日历」关闭时，视图数据管线须过滤外部任务；在线版始终显示（见 DEFAULT_SETTINGS 注释）
function shouldHideExternalTasks() {
    return window._WEB_VERSION !== 'online' && !!(settings && settings.showExternalCalendars === false);
}

// 清单级判定：订阅专属清单（带 extSourceId 标记）在各清单入口（侧边栏/下拉/看板列等）始终隐藏，
// 订阅入口由"外部日历"分组统一承载，避免同一订阅源在"清单"分组中重复出现
function shouldHideExternalList(list) {
    return !!(list && list.extSourceId);
}

// 开关：是否在侧边栏显示外部日历分组（离线版设置面板提供；默认 true）
function toggleShowExternalCalendars(checked) {
    if (!settings) return;
    settings.showExternalCalendars = !!checked;
    // 关闭时若正停留在订阅聚合视图（__extsrc__:）或订阅专属清单（extlist_），其任务已全部被过滤且清单入口隐藏，重置回全部任务避免空视图
    const _curList = (typeof getList === 'function' && currentListId) ? getList(currentListId) : null;
    if (!checked && currentListId && (currentListId.indexOf('__extsrc__:') === 0 || !!(_curList && _curList.extSourceId))) {
        currentListId = null;
        currentTagIds = [];
        currentFilter = '';
        currentFilterId = null;
    }
    if (typeof saveData === 'function') saveData();
    if (typeof renderLists === 'function') renderLists();  // 立即生效：侧边栏显隐切换
    if (typeof renderView === 'function') renderView();    // 立即生效：各视图外部任务显隐（分组缓存签名含本开关）
}

function getCalendarSubscription(id) {
    if (!settings || !Array.isArray(settings.calendarSubscriptions)) return null;
    return settings.calendarSubscriptions.find(function (s) { return s.id === id; }) || null;
}

function getCalendarSubscriptionColorHex(id) {
    const sub = getCalendarSubscription(id);
    if (!sub) return '#9ca3af';
    return _CAL_SUB_COLOR_HEX[sub.color] || sub.color || '#3b82f6';
}

function getCalendarSubscriptionName(id) {
    const sub = getCalendarSubscription(id);
    return (sub && sub.name) || '外部日历';
}

// 删除外部任务时写黑名单（详见 3.3.3 / 附录 A-2）；由共享层 deleteTask 调用
function recordExternalTaskDeletion(task) {
    if (!task || !task.extSourceId || !task.extEventUid) return;
    if (!settings || !Array.isArray(settings.calendarSubscriptions)) return;
    const sub = settings.calendarSubscriptions.find(function (s) { return s.id === task.extSourceId; });
    if (!sub) return;
    if (!Array.isArray(sub.extDeletedUids)) sub.extDeletedUids = [];
    // 去重：兼容旧字符串格式和新对象格式
    const exists = sub.extDeletedUids.some(function (d) {
        const uid = typeof d === 'string' ? d : (d && d.uid);
        return uid === task.extEventUid;
    });
    if (!exists) {
        // 存对象快照（标题/时间/删除时刻），供展示浮层使用
        sub.extDeletedUids.push({
            uid: task.extEventUid,
            title: task.title || '',
            startTime: task.startTime || '',
            deletedAt: new Date().toISOString()
        });
    }
}

// 撤销外部订阅任务的删除（FR-01，V1-7）：把黑名单记录移除，使下次同步允许该 UID 重建。
// 与 recordExternalTaskDeletion 对称，仅由撤销栈调用。
function removeExternalTaskDeletion(task) {
    if (!task || !task.extSourceId || !task.extEventUid) return;
    if (!settings || !Array.isArray(settings.calendarSubscriptions)) return;
    const sub = settings.calendarSubscriptions.find(function (s) { return s.id === task.extSourceId; });
    if (!sub || !Array.isArray(sub.extDeletedUids)) return;
    sub.extDeletedUids = sub.extDeletedUids.filter(function (d) {
        const uid = typeof d === 'string' ? d : (d && d.uid);
        return uid !== task.extEventUid;
    });
}

// 工具函数
// filterTasks：单次遍历合并所有条件，避免链式 .filter() 重复扫描与中间数组分配。
// 取得某文件夹的全部子孙清单 id（递归，含嵌套文件夹），用于按文件夹筛选其下所有任务。
// 仅纳入未归档清单；嵌套子文件夹本身不持有任务，但其子清单需一并计入。
function getDescendantListIds(folderId) {
    const acc = new Set();
    const stack = [folderId];
    while (stack.length) {
        const pid = stack.pop();
        for (let i = 0; i < lists.length; i++) {
            const l = lists[i];
            if (!l.archived && l.parentId === pid) {
                acc.add(l.id);
                if (l.isFolder) stack.push(l.id);
            }
        }
    }
    return acc;
}

// 各条件被预计算为闭包/集合，循环内一次判断全部通过才入结果数组。
function filterTasks(taskList, opts) {
    // 预计算各筛选条件（在循环外完成，避免每任务重复计算）
    // 订阅筛选视图（3.4）：currentListId 形如 __extsrc__:<subId>，按 task.extSourceId 聚合过滤（跨清单）
    const _isExtSrcFilter = currentListId && currentListId.indexOf('__extsrc__:') === 0;
    // 离线版「显示外部日历」关闭：过滤外部订阅任务（在线版始终显示；各视图均经由本管线取数）
    const _hideExtTasks = shouldHideExternalTasks();
    const _extSrcId = _isExtSrcFilter ? currentListId.slice('__extsrc__:'.length) : null;
    const hasListFilter = !!currentListId && !_isExtSrcFilter;
    // 当前清单若为文件夹，则筛选范围扩展到其所有子孙清单（递归）
    let listFilterSet = null;
    if (hasListFilter) {
        const fl = lists.find(l => l.id === currentListId);
        if (fl && fl.isFolder) listFilterSet = getDescendantListIds(currentListId);
    }
    const hasTagFilter = currentTagIds && currentTagIds.length > 0;
    const tagSet = hasTagFilter ? new Set(currentTagIds) : null;

    // 侧边栏特殊时间筛选（今天/明天/最近3天/最近7天）的时间边界
    const specialRange = getSpecialTimeFilterRange();

    // 自定义过滤器条件预解析
    let cf = null; // { listSet?, tagSet?, important?, urgent?, timeCheck?: (task)=>bool }
    if (currentFilterId) {
        const customFilter = (settings.filters || []).find(f => f.id === currentFilterId);
        if (customFilter && customFilter.conditions) {
            const c = customFilter.conditions;
            cf = {};
            if (c.listIds && c.listIds.length > 0) cf.listSet = new Set(c.listIds);
            if (c.tagIds && c.tagIds.length > 0) cf.tagSet = new Set(c.tagIds);
            if (c.important === true) cf.important = true;
            else if (c.important === false) cf.important = false;
            if (c.urgent === true) cf.urgent = true;
            else if (c.urgent === false) cf.urgent = false;
            if (c.timeRange) {
                const b = getDateBounds();
                const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
                const todayEnd = new Date(b.todayStart.getTime() + 86400000);
                let rangeStart = null, rangeEnd = null, mode = 'range'; // 'range' | 'overdue' | 'nodate'
                switch (c.timeRange) {
                    case 'today':
                        rangeStart = b.todayStart; rangeEnd = todayEnd; break;
                    case 'yesterday':
                        rangeStart = b.yesterdayStart; rangeEnd = b.todayStart; break;
                    case 'last3days':
                        rangeStart = new Date(b.todayStart.getTime() - 2 * 86400000); rangeEnd = todayEnd; break;
                    case 'week': {
                        const ws = new Date(b.todayStart);
                        ws.setDate(ws.getDate() - ws.getDay() + dayOffset);
                        if (b.todayStart.getDay() === 0 && dayOffset === 1) ws.setDate(ws.getDate() - 7);
                        rangeStart = ws; rangeEnd = new Date(ws.getTime() + 7 * 86400000); break;
                    }
                    case 'lastweek': {
                        const lws = new Date(b.todayStart);
                        lws.setDate(lws.getDate() - lws.getDay() + dayOffset - 7);
                        if (b.todayStart.getDay() === 0 && dayOffset === 1) lws.setDate(lws.getDate() - 7);
                        rangeStart = lws; rangeEnd = new Date(lws.getTime() + 7 * 86400000); break;
                    }
                    case 'month':
                        rangeStart = new Date(b.now.getFullYear(), b.now.getMonth(), 1);
                        rangeEnd = new Date(b.now.getFullYear(), b.now.getMonth() + 1, 1); break;
                    case 'lastmonth':
                        rangeStart = new Date(b.now.getFullYear(), b.now.getMonth() - 1, 1);
                        rangeEnd = new Date(b.now.getFullYear(), b.now.getMonth(), 1); break;
                    case 'overdue':
                        mode = 'overdue'; rangeEnd = b.todayStart; break;
                    case 'nodate':
                        mode = 'nodate'; break;
                    case 'custom':
                        if (c.customStartDate && c.customEndDate) {
                            rangeStart = new Date(c.customStartDate);
                            rangeEnd = new Date(c.customEndDate);
                            rangeEnd.setHours(23, 59, 59, 999);
                        }
                        break;
                }
                const _rs = rangeStart, _re = rangeEnd, _mode = mode;
                cf.timeCheck = (task) => {
                    if (_mode === 'nodate') return !task.startTime;
                    if (!task.startTime) return false;
                    const d = new Date(task.startTime);
                    if (_mode === 'overdue') return !task.completed && d < _re;
                    return d >= _rs && d < _re;
                };
            }
        }
    }

    // 归档清单集合
    const archivedSet = new Set();
    lists.forEach(l => { if (l.archived) archivedSet.add(l.id); });
    const hasArchived = archivedSet.size > 0;

    // 完成态过滤：优先使用视图级传入的 includeCompleted 覆盖；否则回退全局 settings.showCompleted
    const includeCompleted = (opts && typeof opts.includeCompleted === 'boolean')
        ? opts.includeCompleted
        : (settings.showCompleted !== false);
    const hideCompleted = !includeCompleted;

    // FR-02 回收站：默认排除软删除任务（task.deletedAt 非空）；回收站视图自身传 { includeTrashed: true }
    const _hideTrashed = !opts || opts.includeTrashed !== true;

    // 单次遍历合并所有条件
    const filtered = [];
    for (let i = 0; i < taskList.length; i++) {
        const task = taskList[i];

        // 回收站任务不进入任何常规视图（七个视图均经本管线取数）
        if (_hideTrashed && task.deletedAt) continue;

        // 离线版「显示外部日历」关闭：跳过外部订阅任务
        if (_hideExtTasks && task.extSourceId) continue;

        // 清单筛选：订阅聚合 / 普通清单 / 文件夹子孙集合
        if (_isExtSrcFilter) {
            if (task.extSourceId !== _extSrcId) continue;
        } else if (hasListFilter) {
            if (listFilterSet) {
                if (!listFilterSet.has(task.listId)) continue;
            } else if (task.listId !== currentListId) continue;
        }

        // 标签筛选（并集）
        if (hasTagFilter) {
            const taskTags = task.tags || task.tagIds || [];
            let pass = false;
            for (let j = 0; j < taskTags.length; j++) {
                if (tagSet.has(taskTags[j])) { pass = true; break; }
            }
            if (!pass) continue;
        }

        // 侧边栏特殊时间筛选（今天/明天/最近3天/最近7天）
        if (specialRange) {
            if (!task.startTime) continue;
            const t = new Date(task.startTime).getTime();
            if (t < specialRange[0] || t >= specialRange[1]) continue;
        }

        // 自定义过滤器
        if (cf) {
            if (cf.listSet && !cf.listSet.has(task.listId)) continue;
            if (cf.tagSet) {
                const taskTags = task.tags || [];
                let pass = false;
                for (let j = 0; j < taskTags.length; j++) {
                    if (cf.tagSet.has(taskTags[j])) { pass = true; break; }
                }
                if (!pass) continue;
            }
            if (cf.important === true && !task.important) continue;
            if (cf.important === false && task.important) continue;
            if (cf.urgent === true && !task.urgent) continue;
            if (cf.urgent === false && task.urgent) continue;
            if (cf.timeCheck && !cf.timeCheck(task)) continue;
        }

        // 归档清单
        if (hasArchived && archivedSet.has(task.listId)) continue;

        // 完成态
        if (hideCompleted && task.completed) continue;

        filtered.push(task);
    }
    return filtered;
}

// 生成标签胶囊HTML（用于各视图中的任务项）
// maxDisplay: 最多显示几个标签胶囊，超出显示+N
// position: 'left' 或 'right'，决定胶囊在任务标题的哪一侧
// 使用 _getTagsByIdMap() 预构建索引，消除每任务 allTags.find 的 O(N×M) 线性查找
let _tagsByIdMapCache = null;
let _tagsByIdMapSig = null;
function _getTagsByIdMap() {
    const allTags = settings.tags || [];
    // 签名：长度 + 末尾标签ID，捕获 push/splice 等原地修改（引用不变但内容已变）
    const last = allTags.length > 0 ? allTags[allTags.length - 1].id : '';
    const sig = allTags.length + '|' + last;
    if (_tagsByIdMapCache && _tagsByIdMapSig === sig) return _tagsByIdMapCache;
    const m = new Map();
    for (let i = 0; i < allTags.length; i++) m.set(allTags[i].id, allTags[i]);
    _tagsByIdMapCache = m;
    _tagsByIdMapSig = sig;
    return m;
}

function renderTagCapsules(task, maxDisplay = 2, position = 'left') {
    const taskTags = task.tags || [];
    if (taskTags.length === 0) return '';

    const tagMap = _getTagsByIdMap();
    const displayTags = taskTags.slice(0, maxDisplay);
    const remaining = taskTags.length - maxDisplay;

    const capsules = displayTags.map(tagId => {
        const tag = tagMap.get(tagId);
        if (!tag) return '';
        const displayName = tag.name.length > 8 ? tag.name.substring(0, 8) + '…' : tag.name;
        return `<span class="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] leading-tight" style="background-color: ${tag.color}33; color: ${tag.color}">${displayName}</span>`;
    }).filter(Boolean).join('');

    const moreHtml = remaining > 0 ? `<span class="text-[10px] text-theme-muted cursor-pointer hover:text-theme-primary transition" onclick="event.stopPropagation(); expandTagCapsules(this, '${task.id}')" title="点击展开全部标签">+${remaining}</span>` : '';

    // 隐藏的完整标签列表
    const allCapsules = taskTags.map(tagId => {
        const tag = tagMap.get(tagId);
        if (!tag) return '';
        const displayName = tag.name.length > 8 ? tag.name.substring(0, 8) + '…' : tag.name;
        return `<span class="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] leading-tight" style="background-color: ${tag.color}33; color: ${tag.color}">${displayName}</span>`;
    }).filter(Boolean).join('');

    const hiddenFull = taskTags.length > maxDisplay ? `<span class="hidden tag-capsules-full">${allCapsules}</span>` : '';

    return `<span class="inline-flex items-center gap-1 flex-shrink-0 tag-capsules-container" data-task-id="${task.id}">${capsules}${moreHtml}${hiddenFull}</span>`;
}

function expandTagCapsules(el, taskId) {
    const container = el.closest('.tag-capsules-container');
    if (!container) return;
    const full = container.querySelector('.tag-capsules-full');
    if (full) {
        full.classList.remove('hidden');
        // 隐藏前面的部分胶囊和+N
        const capsules = container.querySelectorAll(':scope > span:not(.tag-capsules-full)');
        capsules.forEach(s => s.classList.add('hidden'));
    }
}

function sortTasksByCompletion(taskList) {
    const incomplete = taskList.filter(t => !t.completed);
    const completed = taskList.filter(t => t.completed);
    // 未完成：按日期升序（最早在前），无日期的放最后（ISO 字符串字典序比较，避免 new Date）
    incomplete.sort((a, b) => {
        if (!a.startTime && !b.startTime) return 0;
        if (!a.startTime) return 1;
        if (!b.startTime) return -1;
        if (a.startTime < b.startTime) return -1;
        if (a.startTime > b.startTime) return 1;
        return 0;
    });
    // 已完成：按完成时间降序（最近完成在前），无完成时间的按 createdAt 降序
    completed.sort((a, b) => {
        const aTime = a.completedAt || a.createdAt || '';
        const bTime = b.completedAt || b.createdAt || '';
        if (!aTime && !bTime) return 0;
        if (!aTime) return 1;
        if (!bTime) return -1;
        if (bTime < aTime) return -1;
        if (bTime > aTime) return 1;
        return 0;
    });
    return [...incomplete, ...completed];
}

function getTasksForDate(date, opts) {
    const includeCompleted = (opts && typeof opts.includeCompleted === 'boolean') ? opts.includeCompleted : (settings.showCompleted !== false);
    const dateTasks = filterTasks(tasks, { includeCompleted }).filter(t => {
        return isTaskVisibleOnDate(t, date);
    });
    return sortTasksByCompletion(dateTasks);
}

// ---------- 视图自定义（增删 / 排序 / 默认首页）----------
// 六个可自定义视图的元数据。id 与 switchView 的视图名一致；icon 用于移动端底部导航。
const VIEW_DEFS = {
    task:     { label: '任务',   icon: 'fas fa-list-check' },
    schedule: { label: '日程',   icon: 'fas fa-calendar-day' },
    week:     { label: '周',     icon: 'fas fa-calendar-week' },
    month:    { label: '月',     icon: 'fas fa-calendar' },
    quadrant: { label: '四象限', icon: 'fas fa-th-large' },
    kanban:   { label: '看板',   icon: 'fas fa-columns' }
};
const VIEW_ORDER_DEFAULT = ['task', 'schedule', 'week', 'month', 'quadrant', 'kanban'];

// 读取/规范化视图顺序数组（[{id, enabled}]）；保证六个视图齐全、顺序合法。
function getViewOrder() {
    if (!settings.viewOrder || !Array.isArray(settings.viewOrder) || settings.viewOrder.length === 0) {
        settings.viewOrder = VIEW_ORDER_DEFAULT.map(function (id) { return { id: id, enabled: true }; });
    }
    const existing = settings.viewOrder.map(function (v) { return v.id; });
    VIEW_ORDER_DEFAULT.forEach(function (id) {
        if (!existing.includes(id)) settings.viewOrder.push({ id: id, enabled: true });
    });
    // 去重：相同 id 仅保留首次出现，避免 viewOrder 出现重复项导致视图被重复渲染
    // （典型表现：禁用某视图后，「已启用」区仍多出一份同名视图）
    const _seen = {};
    settings.viewOrder = settings.viewOrder.filter(function (v) {
        if (!v || !v.id || _seen[v.id]) return false;
        _seen[v.id] = true;
        return true;
    });
    return settings.viewOrder;
}

// 已启用的视图 id（按设置顺序）
function getEnabledViews() {
    return getViewOrder().filter(function (v) { return v.enabled; }).map(function (v) { return v.id; });
}

// 默认首页视图：优先 settings.defaultHomeView（须为已启用项），否则回退到第一个启用项
function getHomeView() {
    const order = getViewOrder();
    if (settings.defaultHomeView && order.some(function (v) { return v.id === settings.defaultHomeView && v.enabled; })) {
        return settings.defaultHomeView;
    }
    const first = order.find(function (v) { return v.enabled; });
    return first ? first.id : VIEW_ORDER_DEFAULT[0];
}

function setHomeView(id) {
    settings.defaultHomeView = id;
    settings.defaultView = id; // 兼容旧读取方
}

// ---------- per-list 视图偏好 ----------
// 清单级视图偏好：每个清单可独立记录「偏好视图」和「各视图内配置覆盖」。
// 存储于 list.viewPrefs = { view: 'kanban', task: {...}, kanban: {...}, ... }
// 读取链：list.viewPrefs[viewName] → settings.xxxConfig（全局默认）

// 获取当前选中清单的 per-list 视图配置覆盖（null = 无清单或无覆盖）
function _getCurrentListViewPrefs(viewName) {
    if (!currentListId || currentListId === '__archived__') return null;
    const list = getList(currentListId);
    if (!list || !list.viewPrefs || !list.viewPrefs[viewName]) return null;
    return list.viewPrefs[viewName];
}

// 确保 per-list 视图配置覆盖对象存在（用户主动修改配置时调用）
// 返回写入目标对象；null = 无当前清单（调用方应写全局 settings）
function _ensureListViewPrefs(viewName) {
    if (!currentListId || currentListId === '__archived__') return null;
    const list = getList(currentListId);
    if (!list) return null;
    if (!list.viewPrefs) list.viewPrefs = {};
    if (!list.viewPrefs[viewName]) list.viewPrefs[viewName] = {};
    return list.viewPrefs[viewName];
}

// 获取当前清单的偏好视图（null = 无偏好，沿用全局默认）
function _getCurrentListViewPrefView() {
    if (!currentListId || currentListId === '__archived__') return null;
    const list = getList(currentListId);
    if (!list || !list.viewPrefs || !list.viewPrefs.view) return null;
    const v = list.viewPrefs.view;
    return VIEW_ORDER_DEFAULT.indexOf(v) !== -1 ? v : null;
}

// 用户主动切换视图：记录当前上下文（清单/全部任务/最近7天）的偏好视图并切换
function userSwitchView(view) {
    if (VIEW_ORDER_DEFAULT.indexOf(view) !== -1) {
        if (currentListId && currentListId !== '__archived__') {
            const list = getList(currentListId);
            if (list) {
                if (!list.viewPrefs) list.viewPrefs = {};
                list.viewPrefs.view = view;
                saveData();
            }
        } else if (!currentListId && !currentFilterId && !(currentTagIds && currentTagIds.length)) {
            // 无清单/标签/过滤器：处于「全部任务」或侧边栏特殊时间筛选上下文，记录对应偏好视图
            _setSpecialViewPrefView(isSpecialTimeFilter() ? currentFilter : 'allTasks', view);
        }
    }
    switchView(view);
    _saveFilterState();
}

// ---------- 特殊侧边栏项（全部任务/最近7天）的视图偏好 ----------
// 仅记录「偏好视图类型」，视图内配置沿用全局设置。
// 存储于 settings.specialViewPrefs = { allTasks: 'kanban', recent7days: 'month' }

function _getSpecialViewPrefView(key) {
    const v = settings.specialViewPrefs && settings.specialViewPrefs[key];
    return (v && VIEW_ORDER_DEFAULT.indexOf(v) !== -1) ? v : null;
}

function _setSpecialViewPrefView(key, view) {
    if (VIEW_ORDER_DEFAULT.indexOf(view) === -1) return;
    if (!settings.specialViewPrefs) settings.specialViewPrefs = {};
    settings.specialViewPrefs[key] = view;
    saveData();
}

// 重置当前清单的 per-list 视图配置覆盖（删除覆盖，回退全局）
// 返回 true = 已删除 per-list 覆盖；false = 无 per-list 覆盖（调用方应重置全局）
function _resetCurrentListViewPrefs(viewName) {
    if (!currentListId || currentListId === '__archived__') return false;
    const list = getList(currentListId);
    if (!list || !list.viewPrefs || !list.viewPrefs[viewName]) return false;
    delete list.viewPrefs[viewName];
    // 清理空 viewPrefs（保留 view 字段：偏好视图不因重置视图内配置而丢失）
    const hasOther = Object.keys(list.viewPrefs).some(k => k !== 'view' && list.viewPrefs[k] !== undefined);
    if (!hasOther && !list.viewPrefs.view) delete list.viewPrefs;
    return true;
}

// ---------- 筛选状态持久化（刷新后恢复上次选中的清单/标签/过滤器）----------
// 注意：视图不随筛选状态恢复——每次启动（新标签）显示设置中的默认视图
const FILTER_STATE_KEY = 'tacklist_filter_state';
function _saveFilterState() {
    try {
        localStorage.setItem(FILTER_STATE_KEY, JSON.stringify({
            currentListId: currentListId,
            currentFilter: currentFilter,
            currentTagIds: currentTagIds,
            currentFilterId: currentFilterId
        }));
    } catch (e) { /* 忽略 quota 错误 */ }
}
function _loadFilterState() {
    try {
        const s = localStorage.getItem(FILTER_STATE_KEY);
        return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
}

// ---------- 通用「视图配置」右侧滑出面板管理 ----------
// 六个视图（任务/看板/四象限/日程/周/月）+ 看板分组子面板复用同一套显隐与
// 「点击外部关闭」逻辑，避免分散实现。嵌套面板（看板分组配置覆盖于看板配置
// 面板之上）按打开顺序只关闭最上层，保持「子面板优先关闭」的交互。
function _showKanbanPanel(id) { const el = document.getElementById(id); if (el) { el.classList.remove('translate-x-full'); el.classList.add('shadow-2xl'); el.classList.remove('shadow-none'); } }
function _hideKanbanPanel(id) { const el = document.getElementById(id); if (el) { el.classList.add('translate-x-full'); el.classList.remove('shadow-2xl'); el.classList.add('shadow-none'); } }
const _viewConfigPanels = {};
let _viewConfigOpenSeq = 0;
function _registerViewConfig(key, panelId, btnId) {
    // key 字段供 onViewConfigPanelOutside 反查（closeViewConfigPanel(top.key)），缺失会导致点击外部无法关闭
    _viewConfigPanels[key] = { key: key, panelId: panelId, btnId: btnId || null, open: false, onClose: null, seq: 0 };
}

// ---------- 视图配置「恢复默认」类按钮的行内二次确认 ----------
// 交互参考清单删除：第一次点击→按钮变红「确认…？」；再次点击→执行 actionFn；3s 未确认自动还原。
// 按钮状态存在自身 dataset 上，各按钮互不影响；还原定时器以 WeakMap 按钮为键管理。
const _resetConfirmTimers = new WeakMap();
function resetViewConfigWithConfirm(btn, actionFn, confirmText) {
    if (typeof actionFn !== 'function') return;
    if (!btn) { actionFn(); return; } // 找不到按钮（异常场景）：直接执行，保证功能可用
    if (btn.dataset.confirming !== 'true') {
        btn.dataset.confirming = 'true';
        btn.dataset.origHtml = btn.innerHTML;
        btn.dataset.origClass = btn.className;
        btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>' + (confirmText || '确认恢复默认配置？');
        btn.className = 'w-full px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition text-sm';
        clearTimeout(_resetConfirmTimers.get(btn));
        _resetConfirmTimers.set(btn, setTimeout(() => _restoreResetConfirmBtn(btn), 3000));
        return;
    }
    _restoreResetConfirmBtn(btn);
    actionFn();
}
function _restoreResetConfirmBtn(btn) {
    if (!btn) return;
    clearTimeout(_resetConfirmTimers.get(btn));
    if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    if (btn.dataset.origClass) btn.className = btn.dataset.origClass;
    delete btn.dataset.confirming;
    delete btn.dataset.origHtml;
    delete btn.dataset.origClass;
}
let _viewConfigOutsideBound = false;
function openViewConfigPanel(key, onClose) {
    const st = _viewConfigPanels[key];
    if (!st) return;
    if (st.open) { st.onClose = onClose || st.onClose; return; } // 已打开：仅更新回调（如恢复默认后重填控件）
    st.open = true;
    st.seq = ++_viewConfigOpenSeq;
    st.onClose = onClose || null;
    _showKanbanPanel(st.panelId);
    if (!_viewConfigOutsideBound) {
        // 同时监听 mousedown 与 click：看板卡片/列标题等 draggable 元素被按下拖动时，
        // 浏览器可能以拖拽取代点击（不派发 click），mousedown 先于拖拽触发可兜住该场景
        document.addEventListener('mousedown', onViewConfigPanelOutside, true);
        document.addEventListener('click', onViewConfigPanelOutside, true);
        _viewConfigOutsideBound = true;
    }
}
function closeViewConfigPanel(key, forSwitch) {
    const st = _viewConfigPanels[key];
    if (!st || !st.open) return;
    st.open = false;
    const cb = st.onClose;
    st.onClose = null;
    _hideKanbanPanel(st.panelId);
    let anyOpen = false;
    for (const k in _viewConfigPanels) { if (_viewConfigPanels[k].open) { anyOpen = true; break; } }
    if (!anyOpen && _viewConfigOutsideBound) {
        document.removeEventListener('mousedown', onViewConfigPanelOutside, true);
        document.removeEventListener('click', onViewConfigPanelOutside, true);
        _viewConfigOutsideBound = false;
    }
    // 回调入参 forSwitch：由切换视图（closeAllViewConfigPanels）触发时，回调内应
    // 保存但跳过 renderView，避免对旧视图冗余渲染（切换方随后会渲染新视图）
    if (cb) cb(forSwitch);
}
function onViewConfigPanelOutside(e) {
    // 只处理最上层（最近打开）的面板：看板分组子面板打开时，点击外部先关子面板
    let top = null;
    for (const k in _viewConfigPanels) {
        const st = _viewConfigPanels[k];
        if (st.open && (!top || st.seq > top.seq)) top = st;
    }
    if (!top) return;
    const panel = document.getElementById(top.panelId);
    if (panel && panel.contains(e.target)) return;
    if (top.btnId && e.target.closest && e.target.closest('#' + top.btnId)) return;
    closeViewConfigPanel(top.key);
}

// 关闭所有已打开的视图配置面板（切换视图时调用）
function closeAllViewConfigPanels() {
    for (const k in _viewConfigPanels) {
        if (_viewConfigPanels[k].open) closeViewConfigPanel(k, true);
    }
}

// 各视图配置「恢复默认」：以 DEFAULT_SETTINGS 中该视图的默认配置为基础，
// 补齐原全局默认项（显示已完成/专注按钮/无日期位置/农历）的内置默认值后整体替换
function _resetViewConfigToDefault(configKey, extraDefaults) {
    const base = (DEFAULT_SETTINGS[configKey] && typeof DEFAULT_SETTINGS[configKey] === 'object')
        ? JSON.parse(JSON.stringify(DEFAULT_SETTINGS[configKey])) : {};
    Object.assign(base, extraDefaults || {});
    settings[configKey] = base;
}

function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

/**
 * 根据设置项 defaultTaskDate 的值，返回对应的默认任务日期（00:00:00）。
 * @param {string} mode - 'none' | 'today' | 'tomorrow' | 'nextmonday'
 * @returns {Date|null} 对应的日期，或 null（无日期）
 */
function getDefaultTaskDate(mode) {
    if (!mode || mode === 'none') return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (mode === 'today') return today;
    if (mode === 'tomorrow') {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
    }
    if (mode === 'nextmonday') {
        const dayOfWeek = today.getDay(); // 0=周日, 1=周一, ..., 6=周六
        let daysUntilMonday = (8 - dayOfWeek) % 7;
        if (daysUntilMonday === 0) daysUntilMonday = 7;
        const nextMonday = new Date(today);
        nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
        return nextMonday;
    }
    return null;
}

function formatDate(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function formatDateTime(date) {
    const d = new Date(date);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ---- 任务时间统一显示（与任务详情栏一致，非今年自动加年份） ----
// 年份前缀：任务时间所在年份 != 今年时返回 "YYYY年"，否则空串
function _mdYearPrefix(d) {
    const cur = new Date().getFullYear();
    return d.getFullYear() !== cur ? `${d.getFullYear()}年` : '';
}
// 单日标签："M月D日" 或 "YYYY年M月D日"（非今年带年份）
function fmtMD(date) {
    const d = new Date(date);
    return `${_mdYearPrefix(d)}${d.getMonth() + 1}月${d.getDate()}日`;
}
// 跨天日期范围串（跨年时两端都带年份，避免歧义）
function fmtMDRange(start, end) {
    const s = new Date(start), e = new Date(end);
    const cur = new Date().getFullYear();
    const crossYear = s.getFullYear() !== e.getFullYear();
    const sShow = crossYear || s.getFullYear() !== cur;
    const eShow = crossYear || e.getFullYear() !== cur;
    const sStr = sShow ? `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日` : `${s.getMonth() + 1}月${s.getDate()}日`;
    const eStr = eShow ? `${e.getFullYear()}年${e.getMonth() + 1}月${e.getDate()}日` : `${e.getMonth() + 1}月${e.getDate()}日`;
    return `${sStr} - ${eStr}`;
}
// 相对"今天"的日期标签：今天/昨天/明天/后天，超出范围则用 fmtMD（非今年自动带年份）。
// 以"当前时间"为基准计算，供日程视图跨天任务以相对词表述结束/开始日。
function relativeDayLabelForNow(date) {
    const d = new Date(date);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - todayStart) / 86400000);
    if (diffDays === 0) return '今天';
    if (diffDays === -1) return '昨天';
    if (diffDays === 1) return '明天';
    if (diffDays === 2) return '后天';
    return fmtMD(d);
}
// 任务时间统一显示（与任务详情栏一致）：
// 全天(跨天) → "M月D日 - M月D日 (全天)"；全天(单天) → 相对词或 "M月D日 (全天)"；
// 带时间(跨天) → "M月D日 HH:MM - M月D日 HH:MM"；带时间(同天) → "M月D日 HH:MM - HH:MM"；单时间点 → "M月D日 HH:MM"。
// 日期非今年时自动加年份。
function formatTaskTimeLabel(task, withAllDayTag = true) {
    if (!task.startTime) return '';
    const start = new Date(task.startTime);
    if (task.isAllDay) {
        if (task.endTime && isMultiDayTask(task)) {
            return fmtMDRange(start, new Date(task.endTime)) + (withAllDayTag ? ' (全天)' : '');
        }
        return getAllDayLabel(task, withAllDayTag);
    }
    const sTime = formatTime(start);
    if (task.endTime) {
        const end = new Date(task.endTime);
        if (isMultiDayTask(task)) {
            // 跨天带时间 → "M月D日 HH:MM - M月D日 HH:MM"（与任务详情栏一致，非今年自动带年份）
            return `${fmtMD(start)} ${sTime} - ${fmtMD(end)} ${formatTime(end)}`;
        }
        return `${fmtMD(start)} ${sTime} - ${formatTime(end)}`;
    }
    return `${fmtMD(start)} ${sTime}`;
}

function formatTime(date) {
    const d = new Date(date);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// 格式化任务时间用于toast显示（如"2026年1月1日 13:00~15:00"），无startTime返回空串
function formatTaskTimeForToast(task) {
    if (!task.startTime) return '';
    const start = new Date(task.startTime);
    const dateStr = `${_mdYearPrefix(start)}${start.getMonth() + 1}月${start.getDate()}日`;
    if (task.isAllDay) return dateStr;
    const timeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
    if (task.endTime) {
        const end = new Date(task.endTime);
        const endTimeStr = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
        return `${dateStr} ${timeStr}~${endTimeStr}`;
    }
    return `${dateStr} ${timeStr}`;
}

// 构造带任务时间的toast消息：有时间显示"标题（时间）"，无时间只显示标题
function buildTaskToastMessage(task) {
    const title = task.title || '新任务';
    const timeStr = formatTaskTimeForToast(task);
    return timeStr ? `${title}（${timeStr}）` : title;
}

// 判断任务是否跨天（有startTime和endTime，且不在同一天）
function isMultiDayTask(task) {
    if (!task.startTime || !task.endTime) return false;
    const start = new Date(task.startTime);
    const end = new Date(task.endTime);
    return !isSameDay(start, end);
}

// 判断任务在指定日期是否可见（跨天任务在每一天都可见）
function isTaskVisibleOnDate(task, date) {
    if (!task.startTime) {
        return isSameDay(new Date(task.createdAt), date);
    }
    const start = new Date(task.startTime);
    if (isMultiDayTask(task)) {
        // 跨天任务：在开始日期到结束日期之间的每一天都可见
        const end = new Date(task.endTime);
        const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const startOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        return dateOnly >= startOnly && dateOnly <= endOnly;
    }
    return isSameDay(start, date);
}

// 获取跨天任务在指定日期的显示时间文本
function getMultiDayTimeDisplay(task, date) {
    if (!task.startTime) return '';
    const start = new Date(task.startTime);
    const end = new Date(task.endTime);
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const startOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    
    if (isMultiDayTask(task)) {
        if (isSameDay(dateOnly, startOnly)) {
            // 开始日期：显示开始时间
            return formatTime(start) + ' - ...';
        } else if (isSameDay(dateOnly, endOnly)) {
            // 结束日期：显示结束时间
            return '... - ' + formatTime(end);
        } else {
            // 中间日期
            return '全天';
        }
    }
    // 非跨天任务
    if (task.endTime) {
        return formatTime(start) + ' - ' + formatTime(end);
    }
    return formatTime(start);
}

function formatMonthYear(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

// 第二象限（重要不紧急）逾期判定阈值
// 7 天：卡片开始显示「逾期 N 天」徽章；30 天：进视图时弹出提醒（避免新导入数据一进视图就弹）
const QUADRANT_STAGNATION_DAYS = 7;
const QUADRANT_STAGNATION_ALERT_DAYS = 30;

// 计算任务在第二象限（重要不紧急）的逾期天数
// 基准取 startTime 与 createdAt 中「较晚」的一个：若直接用 startTime，
// 日程日期早于创建时间的任务（如 8 月创建、排期在 1 月）会被算成已逾期数百天
function getQuadrantStagnationDays(task) {
    if (!task.important || task.urgent || task.completed) return 0;
    const startTs = task.startTime ? new Date(task.startTime).getTime() : null;
    const createdTs = task.createdAt ? new Date(task.createdAt).getTime() : null;
    let baseTs;
    if (startTs === null && createdTs === null) return 0;
    else if (startTs === null) baseTs = createdTs;
    else if (createdTs === null) baseTs = startTs;
    else baseTs = Math.max(startTs, createdTs);
    const diffMs = new Date().getTime() - baseTs;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// 逾期档位：0=未达阈值 1=7~30 天 2=30~90 天 3=超过 90 天
function getQuadrantStagnationLevel(task) {
    const days = getQuadrantStagnationDays(task);
    if (days <= QUADRANT_STAGNATION_DAYS) return 0;
    if (days <= 30) return 1;
    if (days <= 90) return 2;
    return 3;
}

function formatWeekday(date) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return weekdays[date.getDay()];
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ==================== 系统字体检测 ====================
// 常见系统字体列表（按平台分组），通过 canvas 渲染对比检测是否已安装
// 注意：浏览器无法枚举系统已安装字体，只能检测已知字体名是否存在。
// 用户自行安装的字体（如"汉仪有圆"）若不在列表中，需通过手动输入功能添加。
const SYSTEM_FONT_CANDIDATES = [
    // Windows 系统字体
    'Microsoft YaHei', 'Microsoft YaHei UI', 'SimSun', 'SimHei', 'KaiTi', 'FangSong',
    'Microsoft JhengHei', 'Microsoft JhengHei UI', 'DFKai-SB',
    // macOS 系统字体
    'PingFang SC', 'PingFang TC', 'PingFang HK', 'Hiragino Sans GB', 'STHeiti', 'STHeiti Light',
    'STKaiti', 'STSong', 'STFangsong', 'Songti SC', 'Kaiti SC', 'Heiti SC', 'Apple SD Gothic Neo',
    // Linux 常见
    'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei', 'Source Han Sans SC', 'Source Han Sans CN',
    'Source Han Serif SC', 'Noto Sans CJK SC', 'Noto Sans CJK TC', 'Noto Serif CJK SC',
    'Droid Sans Fallback', 'AR PL UMing CN', 'AR PL UKai CN',
    // 通用西文/无衬线
    'Arial', 'Helvetica', 'Helvetica Neue', 'Times New Roman', 'Georgia', 'Tahoma',
    'Verdana', 'Trebuchet MS', 'Segoe UI', 'Roboto', 'Ubuntu', 'Cantarell',
    // 思源系列
    'Source Han Sans', 'Source Han Serif', 'Noto Sans', 'Noto Serif',
    // 汉仪系列（常见）
    'HYQiHei', 'HYRuiYuanW', 'HYYuanLong', 'HYZhuanKai', 'HYYouRounded', 'HYSongKeBen',
    'HYYouYu', 'HYYoYo', 'HYSenSen', 'HYShuSongEr', 'HYZongYi', 'HYLeiSu',
    // 方正系列（常见）
    'FZShuTi', 'FZKai-Z03', 'FZLiShu', 'FZXiHei', 'FZCuHei', 'FZDaHei-B02S', 'FZXiaoBiaoSong',
    'FZYaoTi', 'FZXiYuanSong', 'FZWeiBei', 'FZNewShuSong', 'FZHei-B01', 'FZSong-B01',
    // 华康系列（常见）
    'DFKai-SB', 'DFPingJu', 'DFGothic', 'DFSong', 'DFMing', 'DFYuan', 'DFKanYu',
    // 其他常见中文商用字体
    'YouYuan', 'HuaWenKaiTi', 'HuaWenSongTi', 'HuaWenHeiTi', 'STXihei', 'STZhongsong',
    'STKaiti', 'STSong', 'STFangsong', 'STXingkai', 'STHupo', 'STLiti', 'STXinwei',
    'LiSu', 'YouYuan', 'HuaWenCaiYun', 'HuaWenLiShu', 'HuaWenXingKai',
    // 系统英文装饰字体
    'Consolas', 'Courier New', 'Monaco', 'Menlo', 'Cascadia Code', 'JetBrains Mono',
    'Fira Code', 'Source Code Pro', 'Crimson Text', 'Playfair Display'
];

// 用 canvas 检测单个字体是否已安装
// 复用同一个 canvas：旧实现每个候选字体新建 canvas + 2 次 measureText，
// 110 个候选累计 ~400ms，是设置面板打开卡顿的来源之一
let _fontProbeCanvas = null;
function _isFontAvailable(fontName) {
    if (!fontName || typeof fontName !== 'string') return false;
    if (!_fontProbeCanvas) _fontProbeCanvas = document.createElement('canvas');
    const ctx = _fontProbeCanvas.getContext('2d');
    const testText = '测试字体mmmwWW1234中文';
    // 基准字体（普遍存在的 monospace）
    const baselineFont = 'monospace';
    ctx.font = '72px ' + baselineFont;
    const baselineWidth = ctx.measureText(testText).width;
    ctx.font = '72px "' + fontName + '", ' + baselineFont;
    const testWidth = ctx.measureText(testText).width;
    // 若宽度变化，说明字体已安装（fallback 不会被触发）
    return Math.abs(testWidth - baselineWidth) > 0.1;
}

// 返回系统已安装的字体列表（去重，按候选顺序）
// 若传入 extraFonts 参数，会额外检测这些字体名
function detectSystemFonts(extraFonts) {
    const available = [];
    const seen = new Set();
    const allCandidates = extraFonts && Array.isArray(extraFonts)
        ? [...extraFonts, ...SYSTEM_FONT_CANDIDATES]
        : SYSTEM_FONT_CANDIDATES;
    for (const font of allCandidates) {
        if (seen.has(font)) continue;
        if (_isFontAvailable(font)) {
            available.push(font);
            seen.add(font);
        }
    }
    return available;
}

// ==================== Google Fonts（仅在线版使用） ====================
// 精选中文友好的 Google Fonts 字体目录
const GOOGLE_FONTS_LIST = [
    { family: 'Noto Sans SC', label: '思源黑体（简）', weights: '400;500;700' },
    { family: 'Noto Serif SC', label: '思源宋体（简）', weights: '400;500;700' },
    { family: 'Noto Sans TC', label: '思源黑体（繁）', weights: '400;500;700' },
    { family: 'Noto Serif TC', label: '思源宋体（繁）', weights: '400;500;700' },
    { family: 'ZCOOL XiaoWei', label: '站酷小薇', weights: '400' },
    { family: 'ZCOOL KuaiLe', label: '站酷快乐体', weights: '400' },
    { family: 'ZCOOL QingKe HuangYou', label: '站酷庆科黄油', weights: '400' },
    { family: 'Ma Shan Zheng', label: '马善政楷书', weights: '400' },
    { family: 'Long Cang', label: '龙藏行书', weights: '400' },
    { family: 'Liu Jian Mao Cao', label: '柳建毛草', weights: '400' },
    { family: 'Zhi Mang Xing', label: '志莽行书', weights: '400' }
];

const _loadedGoogleFonts = new Set();

// 判断字体名是否属于 Google Fonts 目录
function isGoogleFont(fontFamily) {
    if (!fontFamily) return false;
    return GOOGLE_FONTS_LIST.some(f => f.family === fontFamily);
}

// 动态加载 Google Font 样式表，加载完成后回调
function loadGoogleFont(fontFamily, callback) {
    if (!fontFamily || !isGoogleFont(fontFamily)) {
        if (callback) callback();
        return;
    }
    if (_loadedGoogleFonts.has(fontFamily)) {
        if (callback) callback();
        return;
    }
    // 仅在线版加载；离线版无互联网，直接回调
    if (typeof window !== 'undefined' && window._WEB_VERSION !== 'online') {
        if (callback) callback();
        return;
    }
    const entry = GOOGLE_FONTS_LIST.find(f => f.family === fontFamily);
    const familyParam = fontFamily.replace(/ /g, '+');
    const weightSpec = entry && entry.weights ? ':wght@' + entry.weights : '';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + familyParam + weightSpec + '&display=swap';
    link.onload = function() {
        _loadedGoogleFonts.add(fontFamily);
        if (callback) callback();
    };
    link.onerror = function() {
        console.warn('Failed to load Google Font:', fontFamily);
        if (callback) callback();
    };
    document.head.appendChild(link);
}

// ==================== 主题配色系统 ====================
// 包含：内置配色（3套，适配深色/浅色）、自定义强调色生成、背景图提取（3套）
// 调色板结构：
//   - 内置/自定义/背景图提取：均采用 { light: {...}, dark: {...} } 双变体结构，
//     根据当前主题自动选择变体，确保文字与背景对比度始终达标
//   - 背景图提取的 3 套：vibrant（鲜艳）/ muted（柔和）/ steady（沉稳）

// 内置配色方案（每套含 light/dark 双变体）
const BUILTIN_PALETTES = {
    blue: {
        light: {
            accent: '#3b82f6', accentHover: '#2563eb',
            accentSecondary: '#60a5fa', accentBg: '#eff6ff', accentBgStrong: '#dbeafe',
            accentTextDark: '#2563eb', accentLight: '#60a5fa',
            bgPrimary: '#f9fafb', bgPrimaryRgb: '249,250,251',
            bgSecondary: '#ffffff', bgSecondaryRgb: '255,255,255',
            bgTertiary: '#f3f4f6', bgTertiaryRgb: '243,244,246',
            textPrimary: '#111827', textSecondary: '#6b7280', textMuted: '#78716c',
            border: '#e5e7eb'
        },
        dark: {
            accent: '#60a5fa', accentHover: '#3b82f6',
            accentSecondary: '#93c5fd', accentBg: 'rgba(59,130,246,0.15)', accentBgStrong: 'rgba(59,130,246,0.25)',
            accentTextDark: '#93c5fd', accentLight: '#93c5fd',
            bgPrimary: '#111827', bgPrimaryRgb: '17,24,39',
            bgSecondary: '#1f2937', bgSecondaryRgb: '31,41,55',
            bgTertiary: '#374151', bgTertiaryRgb: '55,65,81',
            textPrimary: '#f9fafb', textSecondary: '#d1d5db', textMuted: '#a8a29e',
            border: '#374151'
        }
    },
    green: {
        light: {
            accent: '#10B981', accentHover: '#059669',
            accentSecondary: '#34D399', accentBg: '#ecfdf5', accentBgStrong: '#d1fae5',
            accentTextDark: '#059669', accentLight: '#34D399',
            bgPrimary: '#f8faf9', bgPrimaryRgb: '248,250,249',
            bgSecondary: '#ffffff', bgSecondaryRgb: '255,255,255',
            bgTertiary: '#dcfce7', bgTertiaryRgb: '220,252,231',
            textPrimary: '#06341e', textSecondary: '#4b5563', textMuted: '#6b7280',
            border: '#bbf7d0'
        },
        dark: {
            accent: '#10B981', accentHover: '#059669',
            accentSecondary: '#34D399', accentBg: 'rgba(16,185,129,0.15)', accentBgStrong: 'rgba(16,185,129,0.25)',
            accentTextDark: '#6ee7b7', accentLight: '#6ee7b7',
            bgPrimary: '#0f1411', bgPrimaryRgb: '15,20,17',
            bgSecondary: '#182722', bgSecondaryRgb: '24,39,34',
            bgTertiary: '#23322c', bgTertiaryRgb: '35,50,44',
            textPrimary: '#ecfdf5', textSecondary: '#a7f3d0', textMuted: '#6ee7b7',
            border: '#23322c'
        }
    },
    amber: {
        light: {
            accent: '#F59E0B', accentHover: '#D97706',
            accentSecondary: '#FBBF24', accentBg: '#FEF3C7', accentBgStrong: '#FDE68A',
            accentTextDark: '#B45309', accentLight: '#FBBF24',
            bgPrimary: '#faf9f5', bgPrimaryRgb: '250,249,245',
            bgSecondary: '#ffffff', bgSecondaryRgb: '255,255,255',
            bgTertiary: '#FEF3C7', bgTertiaryRgb: '254,243,199',
            textPrimary: '#451A03', textSecondary: '#57534E', textMuted: '#92400E',
            border: '#FDE68A'
        },
        dark: {
            accent: '#FBBF24', accentHover: '#FCD34D',
            accentSecondary: '#F59E0B', accentBg: 'rgba(245,158,11,0.15)', accentBgStrong: 'rgba(245,158,11,0.25)',
            accentTextDark: '#FCD34D', accentLight: '#FCD34D',
            bgPrimary: '#14110a', bgPrimaryRgb: '20,17,10',
            bgSecondary: '#261D0A', bgSecondaryRgb: '38,29,10',
            bgTertiary: '#322510', bgTertiaryRgb: '50,37,16',
            textPrimary: '#FEF3C7', textSecondary: '#FCD34D', textMuted: '#FBBF24',
            border: '#322510'
        }
    }
};

// hex 转 RGB
function _hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)];
}

// 根据强调色 hex 生成完整调色板（含 light/dark 双变体，WCAG 对比度验证）
function generatePaletteFromAccent(hex) {
    try {
        const [r, g, b] = _hexToRgb(hex);
        const [h, s, l] = _rgbToHsl(r, g, b);

        // ---- Light 变体：浅色背景 + 强调色 ----
        const lBgPrimary = _hslToRgb(h, 0.15, 0.97);
        const lBgSecondary = _hslToRgb(h, 0.08, 1.0);
        const lBgTertiary = _hslToRgb(h, 0.18, 0.93);
        // 强调色：**原样保留传入的颜色**（旧行为会重写为 HSL(h, s+0.15, 0.5)，
        // 导致「输入色 ≠ 得到色」，例如 #8b5cf6 变成 #4e00ff）；
        // 仅当它与背景对比度不足（<3:1）时才做最小幅度的明度修正。
        const lAccent = _ensureContrast([h, s, l], lBgPrimary, 3.0);
        const lAccentHover = _ensureContrast([h, Math.min(1, s + 0.05), Math.max(0, l - 0.08)], lBgPrimary, 3.0);
        const lAccentSecondary = _ensureContrast([h, Math.min(1, s + 0.05), Math.min(1, l + 0.12)], lBgPrimary, 3.0);
        const lAccentBg = _hslToRgb(h, 0.3, 0.95);
        const lAccentBgStrong = _hslToRgb(h, 0.4, 0.9);
        const lAccentTextDark = _ensureContrast([h, Math.min(1, s + 0.05), Math.max(0, l - 0.15)], lBgPrimary, 4.5);
        const lAccentLight = _ensureContrast([h, Math.min(1, s + 0.05), Math.min(1, l + 0.12)], lBgPrimary, 3.0);
        const lTextPrimary = _ensureContrast([h, 0.2, 0.12], lBgPrimary, 4.5);
        const lTextSecondary = _ensureContrast([h, 0.1, 0.4], lBgPrimary, 3.0);
        const lTextMuted = _ensureContrast([h, 0.08, 0.5], lBgPrimary, 3.0);
        const lBorder = _hslToRgb(h, 0.15, 0.88);

        // ---- Dark 变体：深色背景 + 强调色 ----
        const dBgPrimary = _hslToRgb(h, 0.15, 0.1);
        const dBgSecondary = _hslToRgb(h, 0.18, 0.15);
        const dBgTertiary = _hslToRgb(h, 0.15, 0.22);
        // 同上：深色变体的强调色同样以传入颜色为准，仅在对比度不足时提亮
        const dAccent = _ensureContrast([h, s, l], dBgPrimary, 3.0);
        const dAccentHover = _ensureContrast([h, Math.min(1, s + 0.05), Math.min(1, l + 0.08)], dBgPrimary, 3.0);
        const dAccentSecondary = _ensureContrast([h, Math.min(1, s + 0.05), Math.min(1, l + 0.06)], dBgPrimary, 3.0);
        const dAccentBgRgb = _hslToRgb(h, Math.min(1, s + 0.1), 0.3);
        const dAccentBgStrongRgb = _hslToRgb(h, Math.min(1, s + 0.1), 0.35);
        const dAccentTextDark = _ensureContrast([h, Math.min(1, s + 0.05), Math.min(1, l + 0.2)], dBgPrimary, 4.5);
        const dAccentLight = _ensureContrast([h, Math.min(1, s + 0.05), Math.min(1, l + 0.15)], dBgPrimary, 3.0);
        const dTextPrimary = _ensureContrast([h, 0.1, 0.95], dBgPrimary, 4.5);
        const dTextSecondary = _ensureContrast([h, 0.08, 0.75], dBgPrimary, 3.0);
        const dTextMuted = _ensureContrast([h, 0.06, 0.6], dBgPrimary, 3.0);
        const dBorder = _hslToRgb(h, 0.12, 0.28);

        return {
            light: {
                accent: _rgbToHex(...lAccent), accentHover: _rgbToHex(...lAccentHover),
                accentSecondary: _rgbToHex(...lAccentSecondary),
                accentBg: _rgbToHex(...lAccentBg), accentBgStrong: _rgbToHex(...lAccentBgStrong),
                accentTextDark: _rgbToHex(...lAccentTextDark), accentLight: _rgbToHex(...lAccentLight),
                bgPrimary: _rgbToHex(...lBgPrimary), bgPrimaryRgb: _rgbToRgbStr(...lBgPrimary),
                bgSecondary: _rgbToHex(...lBgSecondary), bgSecondaryRgb: _rgbToRgbStr(...lBgSecondary),
                bgTertiary: _rgbToHex(...lBgTertiary), bgTertiaryRgb: _rgbToRgbStr(...lBgTertiary),
                textPrimary: _rgbToHex(...lTextPrimary), textSecondary: _rgbToHex(...lTextSecondary),
                textMuted: _rgbToHex(...lTextMuted), border: _rgbToHex(...lBorder)
            },
            dark: {
                accent: _rgbToHex(...dAccent), accentHover: _rgbToHex(...dAccentHover),
                accentSecondary: _rgbToHex(...dAccentSecondary),
                accentBg: 'rgba(' + _rgbToRgbStr(...dAccentBgRgb) + ',0.15)',
                accentBgStrong: 'rgba(' + _rgbToRgbStr(...dAccentBgStrongRgb) + ',0.25)',
                accentTextDark: _rgbToHex(...dAccentTextDark), accentLight: _rgbToHex(...dAccentLight),
                bgPrimary: _rgbToHex(...dBgPrimary), bgPrimaryRgb: _rgbToRgbStr(...dBgPrimary),
                bgSecondary: _rgbToHex(...dBgSecondary), bgSecondaryRgb: _rgbToRgbStr(...dBgSecondary),
                bgTertiary: _rgbToHex(...dBgTertiary), bgTertiaryRgb: _rgbToRgbStr(...dBgTertiary),
                textPrimary: _rgbToHex(...dTextPrimary), textSecondary: _rgbToHex(...dTextSecondary),
                textMuted: _rgbToHex(...dTextMuted), border: _rgbToHex(...dBorder)
            }
        };
    } catch (e) {
        console.error('generatePaletteFromAccent failed:', e);
        return null;
    }
}

// 根据调色板名解析出调色板对象（用于应用和预览）
// 支持的 key：none / builtin:blue / builtin:green / builtin:amber / custom:<hex> / vibrant / muted / steady
// 优先级：用户编辑后的 customPalettes > 内置 BUILTIN_PALETTES / themePaletteColors
// 返回的对象可能是 {light, dark} 双变体结构或扁平结构，由 applyPaletteToCssVars 统一处理
function resolvePaletteObject(name) {
    if (!name || name === 'none') return null;
    // 用户编辑后的调色板优先（含内置和背景图提取的）
    if (settings.customPalettes && settings.customPalettes[name]) {
        return settings.customPalettes[name];
    }
    if (name.startsWith('builtin:')) {
        const key = name.substring(8);
        return BUILTIN_PALETTES[key] || null;
    }
    if (name.startsWith('custom:')) {
        const hex = name.substring(7);
        return generatePaletteFromAccent(hex);
    }
    if (settings.themePaletteColors && settings.themePaletteColors[name]) {
        return settings.themePaletteColors[name];
    }
    return null;
}

// 根据当前配色（背景图取色方案）的强调色，查找色相最接近的内置配色方案
// 用于删除背景图时的自动回退：vibrant/muted/steady 失效后，
// 切换到与原强调色色相最接近的内置配色（星夜/春野/夕照），尽量保持视觉延续
function findClosestBuiltinPalette(paletteName) {
    const FALLBACK = 'builtin:blue';
    try {
        const palette = resolvePaletteObject(paletteName);
        if (!palette) return FALLBACK;
        const isDark = isDarkThemeActive();
        const variant = (palette.light && palette.dark)
            ? (isDark ? palette.dark : palette.light)
            : palette;
        if (!variant || !variant.accent) return FALLBACK;
        const [r, g, b] = _hexToRgb(variant.accent);
        const [hue, sat] = _rgbToHsl(r, g, b);
        // 近似无彩色（低饱和）时色相无参考意义，直接回退默认
        if (sat < 0.12) return FALLBACK;
        let best = FALLBACK, bestDist = Infinity;
        Object.keys(BUILTIN_PALETTES).forEach(function (key) {
            const builtin = BUILTIN_PALETTES[key];
            const bv = (builtin.light && builtin.dark)
                ? (isDark ? builtin.dark : builtin.light)
                : builtin;
            const [br, bg, bb] = _hexToRgb(bv.accent);
            const [bh] = _rgbToHsl(br, bg, bb);
            let dist = Math.abs(hue - bh);
            if (dist > 180) dist = 360 - dist;
            if (dist < bestDist) { bestDist = dist; best = 'builtin:' + key; }
        });
        return best;
    } catch (e) {
        console.error('findClosestBuiltinPalette failed:', e);
        return FALLBACK;
    }
}

// 修复旧版本遗留数据：内置配色被用户编辑后，深色变体(dark)的次级背景
// 可能被误存为白色(#fff)，导致深色模式下出现白色面板。此类纯白的次级背景
// 对深色变体而言必然是错误的，直接丢弃该内置配色的自定义记录，回退到修正后的内置值。
function repairStalePaletteCustoms() {
    if (!settings.customPalettes) return;
    const WHITE_VALUES = ['#ffffff', '#fff', 'rgb(255,255,255)', 'rgba(255,255,255,1)'];
    Object.keys(BUILTIN_PALETTES).forEach(function (key) {
        const name = 'builtin:' + key;
        const p = settings.customPalettes[name];
        if (p && p.dark && WHITE_VALUES.indexOf(String(p.dark.bgSecondary).toLowerCase()) !== -1) {
            delete settings.customPalettes[name];
        }
    });
    if (settings.customPalettes && Object.keys(settings.customPalettes).length === 0) {
        settings.customPalettes = null;
    }
}

// 背景图取色调色板数据迁移：
// 旧版本 vibrant/muted/dark 为扁平结构（无 light/dark 双变体），且 'dark' 键在新版本中
// 已重命名为 'steady'。本函数：
//   1. 检测 themePaletteColors 是否为旧扁平格式，若是则清空（用户需重新提取）
//   2. 同时清空 customPalettes 中遗留的 vibrant/muted/dark/steady 编辑记录
//   3. 若 themePalette 仍指向 'dark'，迁移为 'steady'（仅当 themePaletteColors 为新格式时才有效）
//   4. 若 themePalette 指向已被清空的 vibrant/muted/steady，重置为 'none'
function migrateBgImagePalettes() {
    var BG_PALETTE_KEYS = ['vibrant', 'muted', 'dark', 'steady'];
    var tp = settings.themePaletteColors;
    var hasOldFormat = false;
    if (tp) {
        // 旧扁平格式：vibrant/muted/dark 任一存在但不包含 light/dark 子键
        BG_PALETTE_KEYS.forEach(function (key) {
            if (tp[key] && !tp[key].light && !tp[key].dark) {
                hasOldFormat = true;
            }
        });
    }
    if (hasOldFormat) {
        // 旧格式无法直接迁移到双变体结构，清空让用户重新提取
        settings.themePaletteColors = null;
        // themePalette 若指向任意背景图调色板，重置为 none（避免悬空引用）
        if (BG_PALETTE_KEYS.indexOf(settings.themePalette) !== -1) {
            settings.themePalette = 'none';
        }
    } else if (tp) {
        // 新格式：将 'dark' 键重命名为 'steady'
        if (tp.dark && !tp.steady) {
            tp.steady = tp.dark;
            delete tp.dark;
        }
        if (settings.themePalette === 'dark') {
            settings.themePalette = 'steady';
        }
    } else {
        // 无 themePaletteColors：仅做 themePalette 命名迁移
        if (settings.themePalette === 'dark') {
            settings.themePalette = 'steady';
        }
    }
    // 丢弃 customPalettes 中遗留的背景图调色板编辑记录
    // （旧扁平结构与新双变体结构不兼容，按用户确认直接丢弃）
    if (settings.customPalettes) {
        BG_PALETTE_KEYS.forEach(function (key) {
            delete settings.customPalettes[key];
        });
        if (Object.keys(settings.customPalettes).length === 0) {
            settings.customPalettes = null;
        }
    }
}

// 「自定义主题色」入口下线后的数据迁移（2026-09-24）：
// 旧版本允许用户输入任意 hex 一键生成整套配色，key 为 'custom:<hex>'。
// 该入口已移除（能力下沉为内置配色卡上的「按强调色重新派生其他层次」），故：
//   1. 把当前选中的 custom:<hex> 迁移到**色相最接近的内置配色**，并把当时的配色对象
//      原样写入 customPalettes[builtin:xxx]，保证迁移前后视觉不跳变；
//   2. 清除 settings.customAccent 与所有 custom:<hex> 残留记录 —— 否则重新输入同一 hex
//      会静默沿用旧编辑（旧实现「改 hex 就重新派生」约定里的漏洞）。
function migrateCustomAccentToBuiltin() {
    var tp = settings.themePalette;
    if (tp && tp.indexOf('custom:') === 0) {
        var target = findClosestBuiltinPalette(tp);
        // 必须在清理前读取：resolvePaletteObject 会优先返回用户编辑过的 custom 调色板
        var pal = resolvePaletteObject(tp);
        if (target && pal) {
            if (!settings.customPalettes) settings.customPalettes = {};
            // 当前生效的是 custom:<hex>，故以内置配色为容器时以它为准（覆盖该内置配色的同名记录）
            settings.customPalettes[target] = pal;
        }
        settings.themePalette = target || 'none';
    }
    settings.customAccent = null;
    if (settings.customPalettes) {
        Object.keys(settings.customPalettes).forEach(function (key) {
            if (key.indexOf('custom:') === 0) delete settings.customPalettes[key];
        });
        if (Object.keys(settings.customPalettes).length === 0) settings.customPalettes = null;
    }
}

// ==================== 背景图主题色提取（从背景图生成 3 套调色板） ====================
// 三种风格：vibrant（鲜艳）/ muted（柔和）/ steady（沉稳）
// 每套含 light/dark 双变体，根据当前主题自动选择，确保文字与背景对比度始终达标。
// 每个变体包含：accent（强调色）、bgPrimary/bgSecondary/bgTertiary（背景）、textPrimary/textSecondary/textMuted（文字）、border（边框）

// RGB 转 HSL
function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s, l];
}

// HSL 转 RGB（返回 [r,g,b] 0-255）
function _hslToRgb(h, s, l) {
    h /= 360;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// RGB 转十六进制
function _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// 将 [r,g,b] 转为 "r,g,b" 字符串（用于 CSS 变量 -xxx-rgb）
function _rgbToRgbStr(r, g, b) {
    return r + ',' + g + ',' + b;
}

// WCAG 相对亮度（输入 0-255 RGB，返回 0-1 亮度值）
function _relativeLuminance(r, g, b) {
    const toLinear = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// WCAG 对比度比（输入两组 [r,g,b]，返回 1-21）
function _contrastRatio(rgb1, rgb2) {
    const l1 = _relativeLuminance(rgb1[0], rgb1[1], rgb1[2]);
    const l2 = _relativeLuminance(rgb2[0], rgb2[1], rgb2[2]);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

// 在 HSL 空间中调整文字色亮度以满足 WCAG 对比度阈值
// textHsl: [h, s, l]；bgRgb: [r,g,b]；threshold: 4.5（正文）或 3.0（次要文字）
// 返回 [r, g, b]
function _ensureContrast(textHsl, bgRgb, threshold) {
    let [h, s, l] = textHsl;
    const bgLum = _relativeLuminance(bgRgb[0], bgRgb[1], bgRgb[2]);
    const bgIsLight = bgLum > 0.5;
    let candidate = _hslToRgb(h, s, l);
    let attempts = 0;
    while (_contrastRatio(candidate, bgRgb) < threshold && attempts < 30) {
        if (bgIsLight) {
            // 背景亮 → 文字变深
            l = Math.max(0.02, l - 0.04);
        } else {
            // 背景暗 → 文字变浅
            l = Math.min(0.98, l + 0.04);
        }
        candidate = _hslToRgb(h, s, l);
        attempts++;
    }
    return candidate;
}

// 从图片像素数据提取主色调（简化版 K-Means 聚类，返回最多 5 种主色）
function _extractDominantColors(imageData, maxColors) {
    const data = imageData.data;
    // 采样：每隔 N 个像素取一个，避免数据量过大
    const step = Math.max(4, Math.floor(data.length / 4000) * 4);
    const samples = [];
    for (let i = 0; i < data.length; i += step) {
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        if (a < 128) continue; // 跳过透明像素
        // 量化以减少颜色种类（每通道压缩到 16 级）
        samples.push([Math.round(r/16)*16, Math.round(g/16)*16, Math.round(b/16)*16]);
    }
    // 频率统计，取 Top N
    const freq = new Map();
    for (const c of samples) {
        const key = c.join(',');
        freq.set(key, (freq.get(key) || 0) + 1);
    }
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColors);
    return sorted.map(e => e[0].split(',').map(Number));
}

// 根据主色调生成 3 套调色板（每套含 light/dark 双变体）
// options.randomPerturb: 是否对色相/饱和度/亮度加随机扰动（用于"重新生成"按钮）
function generateThemePalettes(dominantColors, options) {
    if (!dominantColors || dominantColors.length === 0) return null;
    options = options || {};

    // 选最饱和的颜色作为主色参考
    let mainColor = dominantColors[0];
    let maxSat = -1;
    for (const c of dominantColors) {
        const [h, s, l] = _rgbToHsl(c[0], c[1], c[2]);
        if (s > maxSat && l > 0.15 && l < 0.85) {
            maxSat = s;
            mainColor = c;
        }
    }
    let [h, s, l] = _rgbToHsl(mainColor[0], mainColor[1], mainColor[2]);
    let hue = h;

    // 随机扰动（仅在"重新生成"时启用，幅度 ±5%）
    if (options.randomPerturb) {
        hue = (hue + (Math.random() - 0.5) * 18 + 360) % 360; // ±9°
        s = Math.max(0.1, Math.min(1, s + (Math.random() - 0.5) * 0.1));
        l = Math.max(0.15, Math.min(0.85, l + (Math.random() - 0.5) * 0.1));
    }

    const palettes = {};

    // ---- 1. Vibrant 鲜艳风格：高饱和强调色 ----
    palettes.vibrant = {
        light: _buildVibrantLight(hue, s),
        dark: _buildVibrantDark(hue, s)
    };

    // ---- 2. Muted 柔和风格：低饱和、温和色调 ----
    palettes.muted = {
        light: _buildMutedLight(hue, s),
        dark: _buildMutedDark(hue, s)
    };

    // ---- 3. Steady 沉稳风格：中性、低饱和、稳定 ----
    palettes.steady = {
        light: _buildSteadyLight(hue, s),
        dark: _buildSteadyDark(hue, s)
    };

    return palettes;
}

// ---- Vibrant 鲜艳：高饱和强调色 ----
// Light 变体：浅色背景 + 高饱和强调色 + 深色文字
function _buildVibrantLight(hue, s) {
    const accent = _hslToRgb(hue, Math.min(1, s + 0.2), 0.5);
    const accentHover = _hslToRgb(hue, Math.min(1, s + 0.2), 0.42);
    const bgPrimary = _hslToRgb(hue, 0.15, 0.97);
    const bgSecondary = _hslToRgb(hue, 0.1, 1.0);
    const bgTertiary = _hslToRgb(hue, 0.18, 0.94);
    const textPrimary = _ensureContrast([hue, 0.2, 0.12], bgPrimary, 4.5);
    const textSecondary = _ensureContrast([hue, 0.1, 0.4], bgPrimary, 3.0);
    const textMuted = _ensureContrast([hue, 0.08, 0.5], bgPrimary, 3.0);
    const border = _hslToRgb(hue, 0.15, 0.88);
    return _assemblePalette(accent, accentHover, bgPrimary, bgSecondary, bgTertiary,
        textPrimary, textSecondary, textMuted, border);
}

// Dark 变体：深色背景 + 高饱和明亮强调色 + 浅色文字
function _buildVibrantDark(hue, s) {
    const accent = _hslToRgb(hue, Math.min(1, s + 0.2), 0.62);
    const accentHover = _hslToRgb(hue, Math.min(1, s + 0.2), 0.72);
    const bgPrimary = _hslToRgb(hue, 0.15, 0.1);
    const bgSecondary = _hslToRgb(hue, 0.18, 0.15);
    const bgTertiary = _hslToRgb(hue, 0.15, 0.22);
    const textPrimary = _ensureContrast([hue, 0.1, 0.95], bgPrimary, 4.5);
    const textSecondary = _ensureContrast([hue, 0.08, 0.75], bgPrimary, 3.0);
    const textMuted = _ensureContrast([hue, 0.06, 0.6], bgPrimary, 3.0);
    const border = _hslToRgb(hue, 0.12, 0.28);
    return _assemblePalette(accent, accentHover, bgPrimary, bgSecondary, bgTertiary,
        textPrimary, textSecondary, textMuted, border);
}

// ---- Muted 柔和：低饱和、温和色调 ----
// Light 变体：柔和浅色背景 + 低饱和强调色
function _buildMutedLight(hue, s) {
    const accent = _hslToRgb(hue, Math.max(0.3, s * 0.7), 0.5);
    const accentHover = _hslToRgb(hue, Math.max(0.3, s * 0.7), 0.42);
    const bgPrimary = _hslToRgb(hue, 0.08, 0.96);
    const bgSecondary = _hslToRgb(hue, 0.05, 0.99);
    const bgTertiary = _hslToRgb(hue, 0.1, 0.93);
    const textPrimary = _ensureContrast([hue, 0.1, 0.18], bgPrimary, 4.5);
    const textSecondary = _ensureContrast([hue, 0.06, 0.42], bgPrimary, 3.0);
    const textMuted = _ensureContrast([hue, 0.05, 0.5], bgPrimary, 3.0);
    const border = _hslToRgb(hue, 0.08, 0.87);
    return _assemblePalette(accent, accentHover, bgPrimary, bgSecondary, bgTertiary,
        textPrimary, textSecondary, textMuted, border);
}

// Dark 变体：柔和深色背景 + 低饱和强调色
function _buildMutedDark(hue, s) {
    const accent = _hslToRgb(hue, Math.max(0.3, s * 0.7), 0.6);
    const accentHover = _hslToRgb(hue, Math.max(0.3, s * 0.7), 0.7);
    const bgPrimary = _hslToRgb(hue, 0.1, 0.13);
    const bgSecondary = _hslToRgb(hue, 0.12, 0.18);
    const bgTertiary = _hslToRgb(hue, 0.1, 0.24);
    const textPrimary = _ensureContrast([hue, 0.08, 0.92], bgPrimary, 4.5);
    const textSecondary = _ensureContrast([hue, 0.06, 0.7], bgPrimary, 3.0);
    const textMuted = _ensureContrast([hue, 0.05, 0.55], bgPrimary, 3.0);
    const border = _hslToRgb(hue, 0.1, 0.3);
    return _assemblePalette(accent, accentHover, bgPrimary, bgSecondary, bgTertiary,
        textPrimary, textSecondary, textMuted, border);
}

// ---- Steady 沉稳：中性、低饱和、稳定 ----
// Light 变体：中性浅色背景 + 中等饱和强调色
function _buildSteadyLight(hue, s) {
    const accent = _hslToRgb(hue, Math.max(0.25, s * 0.5), 0.45);
    const accentHover = _hslToRgb(hue, Math.max(0.25, s * 0.5), 0.38);
    const bgPrimary = _hslToRgb(hue, 0.05, 0.96);
    const bgSecondary = _hslToRgb(hue, 0.03, 0.99);
    const bgTertiary = _hslToRgb(hue, 0.06, 0.92);
    const textPrimary = _ensureContrast([hue, 0.05, 0.15], bgPrimary, 4.5);
    const textSecondary = _ensureContrast([hue, 0.04, 0.4], bgPrimary, 3.0);
    const textMuted = _ensureContrast([hue, 0.03, 0.5], bgPrimary, 3.0);
    const border = _hslToRgb(hue, 0.05, 0.86);
    return _assemblePalette(accent, accentHover, bgPrimary, bgSecondary, bgTertiary,
        textPrimary, textSecondary, textMuted, border);
}

// Dark 变体：中性深色背景 + 中等饱和强调色
function _buildSteadyDark(hue, s) {
    const accent = _hslToRgb(hue, Math.max(0.25, s * 0.5), 0.58);
    const accentHover = _hslToRgb(hue, Math.max(0.25, s * 0.5), 0.68);
    const bgPrimary = _hslToRgb(hue, 0.08, 0.11);
    const bgSecondary = _hslToRgb(hue, 0.1, 0.16);
    const bgTertiary = _hslToRgb(hue, 0.08, 0.22);
    const textPrimary = _ensureContrast([hue, 0.05, 0.93], bgPrimary, 4.5);
    const textSecondary = _ensureContrast([hue, 0.04, 0.72], bgPrimary, 3.0);
    const textMuted = _ensureContrast([hue, 0.03, 0.58], bgPrimary, 3.0);
    const border = _hslToRgb(hue, 0.08, 0.27);
    return _assemblePalette(accent, accentHover, bgPrimary, bgSecondary, bgTertiary,
        textPrimary, textSecondary, textMuted, border);
}

// 装配调色板对象（含 RGB 字符串字段）
function _assemblePalette(accent, accentHover, bgPrimary, bgSecondary, bgTertiary,
    textPrimary, textSecondary, textMuted, border) {
    return {
        accent: _rgbToHex(...accent),
        accentHover: _rgbToHex(...accentHover),
        bgPrimary: _rgbToHex(...bgPrimary),
        bgPrimaryRgb: _rgbToRgbStr(...bgPrimary),
        bgSecondary: _rgbToHex(...bgSecondary),
        bgSecondaryRgb: _rgbToRgbStr(...bgSecondary),
        bgTertiary: _rgbToHex(...bgTertiary),
        bgTertiaryRgb: _rgbToRgbStr(...bgTertiary),
        textPrimary: _rgbToHex(...textPrimary),
        textSecondary: _rgbToHex(...textSecondary),
        textMuted: _rgbToHex(...textMuted),
        border: _rgbToHex(...border)
    };
}

// 主入口：从背景图提取 3 套调色板
// 回调形式：extractThemePalettes(imageSrc, callback(palettes), options)
// palettes 为 null 表示提取失败
// options.randomPerturb: 是否对色相/饱和度/亮度加随机扰动（用于"重新生成"按钮）
function extractThemePalettes(imageSrc, callback, options) {
    if (!imageSrc) {
        callback(null);
        return;
    }
    const img = new Image();
    if (!imageSrc.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
    }
    img.onload = function() {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const sampleSize = 100;
            canvas.width = sampleSize;
            canvas.height = sampleSize;
            ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
            const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
            const dominant = _extractDominantColors(imageData, 5);
            const palettes = generateThemePalettes(dominant, options);
            // 同时计算图片整体亮度，供调用方据此自动切换深色/浅色主题
            // 使用与 analyzeBgImageBrightness 一致的感知亮度公式（Rec.601）
            if (palettes) {
                const data = imageData.data;
                let totalBrightness = 0;
                const pixelCount = data.length / 4;
                for (let i = 0; i < data.length; i += 4) {
                    totalBrightness += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
                }
                palettes._brightness = totalBrightness / pixelCount;
            }
            callback(palettes);
        } catch (e) {
            console.error('Theme palette extraction failed:', e);
            callback(null);
        }
    };
    img.onerror = function() {
        callback(null);
    };
    img.src = imageSrc;
}

// 应用调色板到 CSS 变量（palette 为 null 时恢复默认）
function applyThemePalette(paletteName) {
    const root = document.documentElement;
    if (paletteName === 'none' || !paletteName) {
        clearThemePaletteVars();
        return;
    }
    const palette = resolvePaletteObject(paletteName);
    if (palette) {
        applyPaletteToCssVars(palette, paletteName);
    } else {
        clearThemePaletteVars();
    }
}

// 直接应用某套调色板对象到 CSS 变量（不依赖 settings，用于按住预览）
// 支持 {light, dark} 双变体（自动根据当前主题选择）和扁平结构
// 仅暴露 6 个核心可编辑字段：accent / bgPrimary / bgSecondary / textPrimary / textMuted / border
// 其余字段（accentHover, accentSecondary, accentBg, accentBgStrong, accentTextDark,
// accentLight, bgTertiary, textSecondary）若调色板未提供，则自动从核心字段派生
function applyPaletteToCssVars(palette, paletteName) {
    if (!palette) return;
    // 内置/自定义调色板含 light/dark 双变体，根据当前主题选择
    if (palette.light && palette.dark) {
        palette = isDarkThemeActive() ? palette.dark : palette.light;
    }
    const root = document.documentElement;
    const isDark = isDarkThemeActive();

    // ---- 自动派生缺失字段 ----
    // accent 衍生色：从 accent 派生
    if (!palette.accentHover) palette.accentHover = _deriveColor(palette.accent, { dL: -0.08 });
    if (!palette.accentTextDark) palette.accentTextDark = palette.accentHover;
    if (!palette.accentLight) palette.accentLight = _deriveColor(palette.accent, { dL: 0.12 });
    if (!palette.accentSecondary) palette.accentSecondary = palette.accentLight;
    if (!palette.accentBg) {
        // 浅色态用浅色 hex，深色态用 rgba 透明度
        palette.accentBg = isDark
            ? _hexToRgba(palette.accent, 0.15)
            : _deriveColor(palette.accent, { dL: 0.42, dS: -0.45 });
    }
    if (!palette.accentBgStrong) {
        palette.accentBgStrong = isDark
            ? _hexToRgba(palette.accent, 0.25)
            : _deriveColor(palette.accent, { dL: 0.36, dS: -0.38 });
    }
    // bg 衍生：bgTertiary 从 bgSecondary 派生（亮度微调）
    if (!palette.bgTertiary) {
        palette.bgTertiary = _deriveColor(palette.bgSecondary, { dL: isDark ? 0.05 : -0.04, dS: 0.05 });
    }
    if (!palette.bgTertiaryRgb) palette.bgTertiaryRgb = _hexToRgbStr(palette.bgTertiary);
    // text 衍生：textSecondary 从 textPrimary 派生（亮度向中灰偏移）
    if (!palette.textSecondary) {
        palette.textSecondary = _deriveColor(palette.textPrimary, {
            targetL: isDark ? 0.75 : 0.4, dS: -0.1
        });
    }
    if (!palette.bgPrimaryRgb) palette.bgPrimaryRgb = _hexToRgbStr(palette.bgPrimary);
    if (!palette.bgSecondaryRgb) palette.bgSecondaryRgb = _hexToRgbStr(palette.bgSecondary);

    // ---- 写入 CSS 变量 ----
    root.style.setProperty('--accent-color', palette.accent);
    root.style.setProperty('--accent-hover', palette.accentHover);
    root.style.setProperty('--accent-secondary', palette.accentSecondary);
    root.style.setProperty('--accent-bg', palette.accentBg);
    root.style.setProperty('--accent-bg-strong', palette.accentBgStrong);
    root.style.setProperty('--accent-text-dark', palette.accentTextDark);
    root.style.setProperty('--accent-light', palette.accentLight);
    root.style.setProperty('--bg-primary', palette.bgPrimary);
    root.style.setProperty('--bg-primary-rgb', palette.bgPrimaryRgb);
    root.style.setProperty('--bg-secondary', palette.bgSecondary);
    root.style.setProperty('--bg-secondary-rgb', palette.bgSecondaryRgb);
    root.style.setProperty('--bg-tertiary', palette.bgTertiary);
    root.style.setProperty('--bg-tertiary-rgb', palette.bgTertiaryRgb);
    root.style.setProperty('--text-primary', palette.textPrimary);
    root.style.setProperty('--text-secondary', palette.textSecondary);
    root.style.setProperty('--text-muted', palette.textMuted);
    root.style.setProperty('--border-color', palette.border);

    // 中间视图区域背景跟随调色板，避免固定深蓝色与暖色主题不搭
    root.style.setProperty('--view-bg-default', palette.bgPrimary);
    // 番茄专注/休息状态色：保持很浅的色调，不喧宾夺主
    // - 星夜(builtin:blue)：保留原始蓝/绿方案（focus 偏蓝、break 偏绿）
    // - 其他配色：focus 向 accent 色相加强（饱和度略提），break 向 accent 色相减弱（饱和度降低）
    if (paletteName === 'builtin:blue') {
        // 星夜主题：不覆盖 focus/break，保留 CSS 默认的蓝/绿值
        root.style.removeProperty('--view-bg-focus');
        root.style.removeProperty('--view-bg-break');
    } else {
        root.style.setProperty('--view-bg-focus', _deriveViewBgFocus(palette.bgPrimary, palette.accent, isDark));
        root.style.setProperty('--view-bg-break', _deriveViewBgBreak(palette.bgPrimary, palette.accent, isDark));
    }
}

// 派生番茄专注状态背景：向 accent 色相加强（饱和度小幅提升，亮度微降，保持浅淡）
function _deriveViewBgFocus(bgHex, accentHex, isDark) {
    try {
        const [bgR, bgG, bgB] = _hexToRgb(bgHex);
        const [, bgS, bgL] = _rgbToHsl(bgR, bgG, bgB);
        const [aR, aG, aB] = _hexToRgb(accentHex);
        const [aH] = _rgbToHsl(aR, aG, aB);
        // 饱和度小幅提升——浅色态可稍高，深色态更克制避免显脏
        const targetS = isDark ? Math.min(0.15, bgS + 0.03) : Math.min(0.20, bgS + 0.06);
        // 亮度微降，保持整体浅淡不抢眼
        const targetL = Math.max(0, bgL - (isDark ? 0.015 : 0.008));
        return _rgbToHex(..._hslToRgb(aH, targetS, targetL));
    } catch (e) {
        return bgHex;
    }
}

// 派生番茄休息状态背景：向 accent 色相减弱（饱和度降低，趋于中性灰，亮度微升）
function _deriveViewBgBreak(bgHex, accentHex, isDark) {
    try {
        const [bgR, bgG, bgB] = _hexToRgb(bgHex);
        const [bgH, bgS, bgL] = _rgbToHsl(bgR, bgG, bgB);
        // 休息态：饱和度降低，趋于中性，视觉上"退后"
        const targetS = Math.max(0, bgS - (isDark ? 0.02 : 0.03));
        // 亮度微升，营造放松感
        const targetL = Math.min(1, bgL + (isDark ? 0.015 : 0.008));
        // 色相保持与 bgPrimary 一致（不引入新色相），仅通过饱和度/亮度区分
        return _rgbToHex(..._hslToRgb(bgH || 0, targetS, targetL));
    } catch (e) {
        return bgHex;
    }
}

// 辅助：hex 转 rgba 字符串
function _hexToRgba(hex, alpha) {
    const [r, g, b] = _hexToRgb(hex);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// 辅助：hex 转 "r,g,b" 字符串
function _hexToRgbStr(hex) {
    const [r, g, b] = _hexToRgb(hex);
    return r + ',' + g + ',' + b;
}

// 辅助：从 hex 派生新颜色
// options: { dL: 亮度增量, dS: 饱和度增量, targetL: 目标亮度(0-1), targetS: 目标饱和度(0-1) }
function _deriveColor(hex, options) {
    options = options || {};
    try {
        const [r, g, b] = _hexToRgb(hex);
        let [h, s, l] = _rgbToHsl(r, g, b);
        if (options.targetL !== undefined) l = options.targetL;
        else if (options.dL !== undefined) l = Math.max(0, Math.min(1, l + options.dL));
        if (options.targetS !== undefined) s = options.targetS;
        else if (options.dS !== undefined) s = Math.max(0, Math.min(1, s + options.dS));
        const newRgb = _hslToRgb(h, s, l);
        return _rgbToHex(...newRgb);
    } catch (e) {
        return hex;
    }
}

// 清除动态主题色覆盖（恢复默认）
function clearThemePaletteVars() {
    const root = document.documentElement;
    const keys = ['--accent-color', '--accent-hover', '--accent-secondary',
        '--accent-bg', '--accent-bg-strong', '--accent-text-dark', '--accent-light',
        '--bg-primary', '--bg-primary-rgb',
        '--bg-secondary', '--bg-secondary-rgb', '--bg-tertiary', '--bg-tertiary-rgb',
        '--text-primary', '--text-secondary', '--text-muted', '--border-color',
        '--view-bg-default', '--view-bg-focus', '--view-bg-break'];
    keys.forEach(k => root.style.removeProperty(k));
}

// ==================== 任务过期判断与专注按钮（从 views.js 拆分） ====================

// 过期红色样式类名
const OVERDUE_TEXT_CLASS = 'text-red-500';

// 判断任务是否在今天已过期（非全天任务，startTime在今天且早于当前时刻，未完成）
function isTaskOverdueToday(task) {
    if (!task.startTime || task.isAllDay || task.completed) return false;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const taskDate = new Date(task.startTime);
    return taskDate >= todayStart && taskDate < tomorrowStart && taskDate < now;
}

// 判断任务是否已过期（未完成、startTime早于当前时刻，跨天任务进行中除外）
// 全天任务：日期早于今天即为过期
function isTaskOverdue(task) {
    if (!task.startTime || task.completed) return false;
    const now = new Date();
    const taskDate = new Date(task.startTime);
    if (task.isAllDay) {
        // 全天任务：按日期比较，日期早于今天即为过期
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const taskDayStart = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());
        // 跨天全天任务：当前在[startDate, endDate]范围内算"进行中"，不算过期
        if (task.endTime) {
            const taskEndDate = new Date(task.endTime);
            const taskEndDayStart = new Date(taskEndDate.getFullYear(), taskEndDate.getMonth(), taskEndDate.getDate());
            if (todayStart >= taskDayStart && todayStart <= taskEndDayStart) return false;
        }
        return taskDayStart < todayStart;
    }
    // 非全天任务：startTime 早于当前时刻，跨天任务进行中除外
    if (task.endTime) {
        const taskEndDate = new Date(task.endTime);
        if (now >= taskDate && now <= taskEndDate) return false;
    }
    return taskDate < now;
}

// 渲染"开始专注"按钮（受 showFocusButton 开关控制；视图级可传布尔覆盖，不传则回退全局 settings.showFocusButton）
function renderFocusButton(taskId, showFocusButton, extraClasses = '') {
    const visible = (typeof showFocusButton === 'boolean')
        ? showFocusButton
        : (settings.showFocusButton !== false);
    if (!visible) return '';
    return `<button onclick="event.stopPropagation(); startPomodoroForTask('${taskId}')"
            class="pomodoro-focus-btn flex-shrink-0 opacity-0 group-hover:opacity-100 text-green-600 w-5 h-5 flex items-center justify-center transition duration-200 ${extraClasses}"
            title="开始专注">
        <i class="far fa-clock text-xs pf-icon-outline"></i>
        <i class="fas fa-clock text-xs pf-icon-solid"></i>
    </button>`;
}
