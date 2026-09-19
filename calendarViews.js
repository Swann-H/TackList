// ==================== 周视图 & 月视图（从 views.js 拆分） ====================

let weekViewHourStart = 6;
let weekViewHourEnd = 22;
let weekAllDayCollapsed = {};

// 移动端月视图：选中的日期（默认今天）
let _mobileMonthSelectedDate = null;
// 月视图滚动位置保持：跨重渲染保存/恢复 transform 偏移量
let _monthSavedScrollTop = null;

// 周/月视图配置：迁移自全局「视图偏好」，作用于周视图与月视图各自独立
function getWeekConfig() {
    if (!settings.weekConfig || typeof settings.weekConfig !== 'object') {
        settings.weekConfig = {};
    }
    const c = settings.weekConfig;
    // 回退读取：视图配置未显式设置时，继承全局默认值（无感升级）
    if (typeof c.showCompleted !== 'boolean') c.showCompleted = settings.showCompleted !== false;
    if (typeof c.showLunar !== 'boolean') c.showLunar = settings.showLunar !== false;
    // per-list 回退链
    const listPrefs = _getCurrentListViewPrefs('week');
    if (listPrefs) return Object.assign({}, c, listPrefs);
    return c;
}
function getMonthConfig() {
    if (!settings.monthConfig || typeof settings.monthConfig !== 'object') {
        settings.monthConfig = {};
    }
    const c = settings.monthConfig;
    // 回退读取：视图配置未显式设置时，继承全局默认值（无感升级）
    if (typeof c.showCompleted !== 'boolean') c.showCompleted = settings.showCompleted !== false;
    if (typeof c.showLunar !== 'boolean') c.showLunar = settings.showLunar !== false;
    // 显示调休信息：月视图日期数字左侧的「班/休」标记（新配置项，默认显示）
    if (typeof c.showSwapInfo !== 'boolean') c.showSwapInfo = true;
    // per-list 回退链
    const listPrefs = _getCurrentListViewPrefs('month');
    if (listPrefs) return Object.assign({}, c, listPrefs);
    return c;
}

// 周视图配置面板（右侧滑出）
_registerViewConfig('week', 'weekConfigPanel', 'week-config-btn');
function toggleWeekConfig() {
    if (_viewConfigPanels.week && _viewConfigPanels.week.open) closeViewConfigPanel('week');
    else openWeekConfig();
}
function openWeekConfig() {
    const cfg = getWeekConfig();
    const scEl = document.getElementById('wc-showcompleted');
    const slEl = document.getElementById('wc-showlunar');
    if (scEl) scEl.checked = cfg.showCompleted !== false;
    if (slEl) slEl.checked = cfg.showLunar !== false;
    openViewConfigPanel('week', (forSwitch) => {
        saveData(); // 延迟保存：变更实时预览，关闭面板时统一落盘
        if (!forSwitch) renderView(); // 切换视图场景由切换方渲染，跳过冗余渲染
    });
}
function closeWeekConfig() { closeViewConfigPanel('week'); }
function onWeekConfigChange() {
    const target = _ensureListViewPrefs('week') || settings.weekConfig;
    const scEl = document.getElementById('wc-showcompleted');
    const slEl = document.getElementById('wc-showlunar');
    if (scEl) target.showCompleted = scEl.checked;
    if (slEl) target.showLunar = slEl.checked;
    renderView(); // 实时预览；保存延迟到面板关闭
}

// 恢复默认配置（面板内「恢复默认」按钮）
function resetWeekViewConfig() {
    if (_resetCurrentListViewPrefs('week')) {
        saveData();
        renderView();
        openWeekConfig();
        showToast('已恢复该清单的周视图配置（继承全局）', 'success');
    } else {
        _resetViewConfigToDefault('weekConfig', { showCompleted: true, showLunar: true });
        saveData();
        renderView();
        openWeekConfig();
        showToast('已恢复周视图默认配置', 'success');
    }
}

// 月视图配置面板（右侧滑出）
_registerViewConfig('month', 'monthConfigPanel', 'month-config-btn');
function toggleMonthConfig() {
    if (_viewConfigPanels.month && _viewConfigPanels.month.open) closeViewConfigPanel('month');
    else openMonthConfig();
}
function openMonthConfig() {
    const cfg = getMonthConfig();
    const scEl = document.getElementById('mc-showcompleted');
    const slEl = document.getElementById('mc-showlunar');
    const ssEl = document.getElementById('mc-showswapinfo');
    if (scEl) scEl.checked = cfg.showCompleted !== false;
    if (slEl) slEl.checked = cfg.showLunar !== false;
    if (ssEl) ssEl.checked = cfg.showSwapInfo !== false;
    openViewConfigPanel('month', (forSwitch) => {
        saveData(); // 延迟保存：变更实时预览，关闭面板时统一落盘
        if (!forSwitch) renderView(); // 切换视图场景由切换方渲染，跳过冗余渲染
    });
}
function closeMonthConfig() { closeViewConfigPanel('month'); }
function onMonthConfigChange() {
    const target = _ensureListViewPrefs('month') || settings.monthConfig;
    const scEl = document.getElementById('mc-showcompleted');
    const slEl = document.getElementById('mc-showlunar');
    const ssEl = document.getElementById('mc-showswapinfo');
    if (scEl) target.showCompleted = scEl.checked;
    if (slEl) target.showLunar = slEl.checked;
    if (ssEl) target.showSwapInfo = ssEl.checked;
    renderView(); // 实时预览；保存延迟到面板关闭
}

// 恢复默认配置（面板内「恢复默认」按钮）
function resetMonthViewConfig() {
    if (_resetCurrentListViewPrefs('month')) {
        saveData();
        renderView();
        openMonthConfig();
        showToast('已恢复该清单的月视图配置（继承全局）', 'success');
    } else {
        _resetViewConfigToDefault('monthConfig', { showCompleted: true, showLunar: true });
        saveData();
        renderView();
        openMonthConfig();
        showToast('已恢复月视图默认配置', 'success');
    }
}

// 月视图网格单元格内的任务条目（渲染循环与完成揭示动画共用，保证两处 HTML 完全一致）
function buildMonthGridTaskItemHtml(task) {
    const list = lists.find(l => l.id === task.listId);
    const startTime = task.startTime ? new Date(task.startTime) : null;
    const timeStr = task.isAllDay ? '' : (startTime ? `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}` : '');
    const isOverdue = isTaskOverdue(task);
    const titleClass = task.completed ? 'text-theme-secondary' : (isOverdue ? OVERDUE_TEXT_CLASS : '');
    // 外部任务色条改订阅色（统一标识 3.3.1）
    const barColor = _extTaskBarColor(task, list?.color || '#3b82f6');
    const extIcon = _extTaskIconHtml(task).replace('text-xs', 'text-[10px]');
    return `
        <div draggable="true" data-task-id="${task.id}"
             ondragstart="handleTaskDragStart(event, '${task.id}')"
             ondragend="handleTaskDragEnd(event)"
             onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}', false, true)"
             class="text-xs p-1 rounded-r cursor-pointer truncate task-item month-task-item task-row ${task.completed ? 'opacity-55' : 'hover:bg-theme-tertiary'} flex items-center justify-between gap-1"
             style="background-color: ${list?.color}15; border-left: 2px solid ${barColor}">
            <div class="flex items-center gap-1 min-w-0 flex-1">
                ${renderTaskCheckbox(task, { taskId: task.id, iconSize: 'text-[10px]', boxClass: 'w-4 h-4', extraClass: 'flex-shrink-0' })}
                ${extIcon}<span class="truncate ${titleClass}" title="${escapeHtml(task.title || '新任务')}">${task.title || '新任务'}</span>
            </div>
            ${timeStr ? `<span class="flex-shrink-0 text-theme-muted">${timeStr}</span>` : ''}
        </div>
    `;
}

// 周视图全天区任务条目（渲染循环与完成揭示动画共用）
function buildWeekAllDayTaskItemHtml(task) {
    const list = lists.find(l => l.id === task.listId);
    const isOverdue = isTaskOverdue(task);
    const titleClass = task.completed ? 'opacity-55 text-theme-secondary' : (isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary');
    // 外部任务色条改订阅色 + 标题前图标（统一标识 3.3.1）
    const barColor = _extTaskBarColor(task, list?.color || '#3b82f6');
    const extIcon = _extTaskIconHtml(task).replace('text-xs', 'text-[10px]');
    return `<div class="text-xs px-1 py-0.5 rounded-r cursor-pointer task-row ${titleClass} flex items-center gap-1 min-w-0"
                 style="background-color: ${list?.color || '#3b82f6'}20; border-left: 2px solid ${barColor};"
                 title="${escapeHtml(task.title || '新任务')}"
                 onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}', false, true)"
                 draggable="true"
                 ondragstart="handleTaskDragStart(event, '${task.id}')"
                 ondragend="handleTaskDragEnd(event)">
                 ${renderTaskCheckbox(task, { taskId: task.id, iconSize: 'text-[10px]', boxClass: 'w-4 h-4', extraClass: 'flex-shrink-0' })}
                 ${extIcon}<span class="truncate">${task.title || '新任务'}</span>
             </div>`;
}

// ==================== 周视图数据层缓存（懒加载 + 相邻周预热） ====================
// 设计要点：
// 1. 以「周起始日」为 key，缓存该周 7 天的任务分组（全天/定时）与时间块布局结果。
//    空周（0 任务）同样落缓存并带 hasAnyTasks=false —— 「无日程」是一等状态，
//    而不是「取不到数据」。这正是旧实现出问题的根源：把空周当成「无需渲染」，
//    直接丢弃整周网格，导致周视图一片空白。
// 2. 缓存签名覆盖所有影响 getTasksForDate 结果的筛选/设置状态（清单、标签、
//    过滤器、周起始日、显示已完成、隐藏外部日历、当天日期）；签名变化即整体丢弃。
// 3. 任务数据的结构性变更（增删/改期/导入/多标签页同步/服务端刷新/版本冲突合并）
//    由 invalidateWeekViewCache() 主动失效，与 invalidateScheduleFilterCache、
//    invalidateTaskListGroupsCache 同一约定（见 data.js 各写入漏斗）。
// 4. 渲染完成后延迟预热 ±1 周：只填充缓存、不触碰 DOM，用户翻页时直接命中；
//    若用户在预热前就翻页，目标周按需计算，行为与预热前一致（无功能回退）。
// 5. 缓存值只持有任务对象引用（不复制），单条开销极小；仍设上限并按插入顺序淘汰，
//    避免长会话下跨周浏览导致 Map 无限增长。
let _weekAggCache = new Map();   // weekStartStr -> 周聚合结果
let _weekAggSig = null;          // 当前缓存对应的筛选签名
let _weekPrewarmTimer = null;    // 相邻周预热定时器（重渲染前清除，避免定时器堆积）
const WEEK_AGG_CACHE_MAX = 15;   // 缓存条目上限（约 ±7 周）

// 周起始日：直接复用 data.js 的全局 getWeekStartDate(date, weekStartsOnMonday)
// （pomodoro.js / tasks.js 亦共用），不在此另建同名函数，避免覆盖既有实现。
// 签名与语义：周一起始时，周日归属「上一个周一」开始的周，与原内联算法一致。

// 缓存签名：任一影响取数结果的状态变化都会改变签名，从而整体丢弃旧缓存
function _getWeekAggSig() {
    return [
        currentListId || '',
        (currentTagIds || []).join(','),
        currentFilter || '',
        currentFilterId || '',
        settings.weekStart === 'monday' ? 'mon' : 'sun',
        getWeekConfig().showCompleted !== false ? '1' : '0',
        (typeof shouldHideExternalTasks === 'function' && shouldHideExternalTasks()) ? '1' : '0',
        new Date().toDateString() // 跨零点后「今天」基准与特殊时间筛选边界变化
    ].join('|');
}

// 失效周视图数据缓存（任务数据结构性变更时调用）
function invalidateWeekViewCache() {
    _weekAggCache.clear();
    _weekAggSig = null;
}

// 取某周的聚合结果：7 天 × { 全天任务、定时任务、时间块布局 } + hasAnyTasks。
// 命中缓存直接返回；未命中才做 7 次 getTasksForDate（O(7 × 任务数)，大数据量下
// 是周视图渲染的主要开销）与 layoutDayTasks，并把结果（含空周）写入缓存。
// 注意：时间块布局依赖 weekViewHourStart / hourHeight，二者为常量（6 / 60，全项目无赋值点），
// 因此无需纳入签名；若将来做成可配置，必须一并加入 _getWeekAggSig。
function getWeekAggregate(weekStartDate) {
    const sig = _getWeekAggSig();
    if (sig !== _weekAggSig) {
        _weekAggCache.clear();
        _weekAggSig = sig;
    }

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStartDate);
        d.setDate(d.getDate() + i);
        weekDays.push(d);
    }
    const weekStartStr = formatDate(weekDays[0]);
    const cached = _weekAggCache.get(weekStartStr);
    if (cached) return cached;

    const showCompleted = getWeekConfig().showCompleted !== false;
    const hourHeight = 60;
    const allDayTasks = {};
    const timedTasks = {};
    const layouts = {};
    let hasAnyTasks = false;

    weekDays.forEach(date => {
        const dateStr = formatDate(date);
        const dayAllTasks = getTasksForDate(date, { includeCompleted: showCompleted });
        const allDay = dayAllTasks.filter(t => t.isAllDay || isMultiDayTask(t));
        const timed = dayAllTasks.filter(t => !t.isAllDay && !isMultiDayTask(t) && t.startTime);
        allDayTasks[dateStr] = allDay;
        timedTasks[dateStr] = timed;
        layouts[dateStr] = layoutDayTasks(timed, hourHeight);
        if (allDay.length > 0 || timed.length > 0) hasAnyTasks = true;
    });

    const result = { weekStartStr, weekDays, allDayTasks, timedTasks, layouts, hasAnyTasks };
    _weekAggCache.set(weekStartStr, result);
    if (_weekAggCache.size > WEEK_AGG_CACHE_MAX) {
        // Map 保持插入顺序：淘汰最旧条目（连续翻页场景下正好淘汰最远的周）
        _weekAggCache.delete(_weekAggCache.keys().next().value);
    }
    return result;
}

// 预热相邻周（±1 周）：延迟到本次渲染结束后执行，只填缓存不动 DOM
function _prewarmAdjacentWeeks(weekStartDate) {
    if (_weekPrewarmTimer) { clearTimeout(_weekPrewarmTimer); _weekPrewarmTimer = null; }
    _weekPrewarmTimer = setTimeout(() => {
        _weekPrewarmTimer = null;
        [-1, 1].forEach(step => {
            const ws = new Date(weekStartDate);
            ws.setDate(ws.getDate() + step * 7);
            getWeekAggregate(ws); // 命中缓存则为空操作
        });
    }, 120);
}

// 完整展示一行提示文案所需的最小宽度（与当前可用宽度无关）。
// 取「文案自然宽 + 非文本占位」：文案节点虽然被 ellipsis 截断，但 scrollWidth 仍返回完整内容宽度，
// 而 chrome（水平内边距 + 图标 + 间距）不随可用宽度变化，因此该值在两种布局下都等于并排布局所需宽度，
// 判断结果是一个稳定不动点，不会出现「布局来回抖动」。
function _weekHintNeedWidth(hint) {
    const pill = hint.firstElementChild;
    const textEl = hint.querySelector('.week-empty-hint-text');
    if (!pill || !textEl) return 0;
    const chrome = pill.clientWidth - textEl.clientWidth; // 水平内边距 + 图标 + 间距
    return textEl.scrollWidth + Math.max(0, chrome);
}

// 空周提示条落位：贴到周视图底部，与底部导航栏同一水平线、同一高度；
// 左边缘以「周一」列为基准（跳过左侧时刻信息列，不遮挡时间轴），再向右微调 HINT_LEFT_OFFSET；
// 右边缘停在导航栏左侧留出间隙，确保两者不重叠。
// 数值全部按真实布局测量：导航栏宽度随周标题长度（「2026年9月」/「2026年8月 - 2026年9月」）变化，
// 故不能写死；任一测量缺失时保留 HTML 上的兜底值。
function _placeWeekEmptyHint() {
    const hint = document.querySelector('.week-empty-hint');
    if (!hint) return;
    _bindWeekHintResize();
    _observeWeekNavPill();
    const wrapper = hint.parentElement;
    const grid = document.getElementById('week-time-grid');
    if (!wrapper || !grid) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    if (!wrapperRect.width) return;

    // 左边界：「周一」列左边缘 = 左侧时刻信息列（桌面 52px / 移动端由 CSS 覆盖为 40px）的右边缘
    // HINT_LEFT_OFFSET：在「与周一列对齐」的基础上再向右的视觉微调量
    const HINT_LEFT_OFFSET = 10;
    const labelCol = grid.querySelector(':scope > div.flex:not(.week-header-sticky) > div.flex-shrink-0');
    const labelRight = labelCol ? labelCol.getBoundingClientRect().right : (wrapperRect.left + 52);
    const left = Math.max(0, Math.round(labelRight - wrapperRect.left) + HINT_LEFT_OFFSET);

    // 以底部导航栏胶囊为基准：同高、底边对齐、右边缘停在导航栏左侧
    const navPill = document.querySelector('#view-nav-bar > *');
    const navRect = navPill ? navPill.getBoundingClientRect() : null;
    const GAP = 12;
    // 并排布局至少要留出的宽度（测量失败时的保守下限）。低于此值宁可换布局，
    // 也不要把提示文案压成「本…」这种毫无信息量的碎片。
    const MIN_SIDE_W = 180;

    let height = 48;   // 兜底：与导航栏 px-6 py-3 单行高度接近
    let bottom = 16;   // 兜底：与导航栏 bottom-4 一致
    let right = GAP;

    if (navRect && navRect.width > 0) {
        height = Math.round(navRect.height);
        bottom = Math.max(0, Math.round(wrapperRect.bottom - navRect.bottom));
        right = Math.round(wrapperRect.right - navRect.left) + GAP;
    }

    // 并排所需宽度实测：导航栏是居中的，左侧可用空间 ≈ (容器宽 - 导航栏宽)/2，
    // 因此在 1440 / 1366 / 1280 / 1024 这类常见笔记本宽度下都放不下一整行文案。
    // 旧实现固定阈值 96px 会让提示条被压成「本…」，故改为「放不下就换布局」。
    const needW = Math.max(MIN_SIDE_W, _weekHintNeedWidth(hint));

    // 空间不足（窄屏 / 移动端导航栏较宽）：改为停在导航栏上方整行显示，保证提示完整可读
    if (wrapperRect.width - left - right < needW) {
        right = GAP;
        bottom = Math.min(wrapperRect.height - height - 8, bottom + height + 8);
    }

    hint.style.left = left + 'px';
    hint.style.right = Math.max(GAP, right) + 'px';
    hint.style.bottom = Math.max(0, bottom) + 'px';
    hint.style.height = height + 'px';
}

// 窗口尺寸变化后重新落位（导航栏会随宽度重新居中，提示条需同步跟随）
let _weekHintResizeBound = false;
function _bindWeekHintResize() {
    if (_weekHintResizeBound) return;
    _weekHintResizeBound = true;
    window.addEventListener('resize', () => {
        if (document.querySelector('.week-empty-hint')) _placeWeekEmptyHint();
    });
}

// 跟随底部导航栏的实际尺寸变化重新落位。
// 必要性：在线版走 CDN Tailwind 的异步 JIT，innerHTML 写入后任意值类（如 min-w-[240px]）
// 尚未生成对应 CSS，此刻测量到的是「变窄」的导航栏（居中 → 左边缘偏右），
// 落位会随之偏右并压住导航栏。ResizeObserver 在样式真正生效后触发，可自愈；
// 同时覆盖字体加载完成、周标题变长等导致导航栏宽度变化的场景。
let _weekHintRO = null;
let _weekHintROPill = null;
function _observeWeekNavPill() {
    const pill = document.querySelector('#view-nav-bar > *');
    if (!pill || typeof ResizeObserver === 'undefined') return;
    if (_weekHintRO && _weekHintROPill === pill) return; // 已在观察同一个胶囊，避免重复创建
    if (_weekHintRO) _weekHintRO.disconnect();
    _weekHintROPill = pill;
    // 提示条为绝对定位、不影响导航栏尺寸，故不会触发观察回调自激
    _weekHintRO = new ResizeObserver(() => _placeWeekEmptyHint());
    _weekHintRO.observe(pill);
}

function renderWeekView(container) {
    // 周聚合（含空周）统一走缓存：命中则零开销复用，未命中才计算并落缓存
    const weekStart = getWeekStartDate(currentDate, settings.weekStart === 'monday');
    const agg = getWeekAggregate(weekStart);
    const weekDays = agg.weekDays;
    const allDayTasks = agg.allDayTasks;
    const layouts = agg.layouts;
    const hasAnyTasks = agg.hasAnyTasks;

    const now = new Date();
    const todayStr = formatDate(now);
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    const weekNum = getWeekNumber(weekDays[0], settings.weekStart === 'monday');
    
    const hourHeight = 60;
    const totalHours = weekViewHourEnd - weekViewHourStart;
    
    let allDayHtml = '';
    allDayHtml += '<div class="flex-shrink-0 flex week-header-sticky" style="position: sticky; top: 0; z-index: 15;">';
    allDayHtml += `<div class="flex-shrink-0" style="width: 52px;"><div class="text-xs text-theme-muted text-right pr-2 pt-1">${weekNum}周</div></div>`;
    allDayHtml += '<div class="flex-1 flex min-w-0">';
    weekDays.forEach(date => {
        const dateStr = formatDate(date);
        const isToday = dateStr === todayStr;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const dayAllDay = allDayTasks[dateStr] || [];
        const collapsed = weekAllDayCollapsed[dateStr] !== false;
        const visibleTasks = collapsed ? dayAllDay.slice(0, 2) : dayAllDay;
        
        allDayHtml += `
            <div class="flex-1 min-w-0 border-l border-theme ${isWeekend ? 'week-weekend-bg bg-gray-50 dark:bg-gray-700/15' : ''}">
                <div class="text-center py-1 border-b border-theme">
                    <div class="text-xs text-theme-secondary">${formatWeekdayShort(date)}</div>
                    <div class="h-6 flex items-center justify-center"><span class="text-sm font-bold ${isToday ? 'w-6 h-6 inline-flex items-center justify-center rounded-full bg-accent text-white' : 'text-theme-primary'}">${date.getDate()}</span></div>
                    ${(() => { const lt = getLunarDisplayText(date, getWeekConfig().showLunar); return lt ? `<div class="text-[10px] text-theme-muted leading-none mt-0.5 truncate">${lt}</div>` : ''; })()}
                </div>
                <div class="p-1 min-h-[28px]"
                     data-weekallday="${dateStr}"
                     ondragover="event.preventDefault()"
                     ondrop="handleWeekAllDayDrop(event, '${dateStr}')">
                    ${visibleTasks.map(task => buildWeekAllDayTaskItemHtml(task)).join('')}
                    ${dayAllDay.length > 2 && collapsed ? `<div class="text-xs text-accent cursor-pointer px-1" onclick="toggleWeekAllDay('${dateStr}')">+${dayAllDay.length - 2}更多</div>` : ''}
                    ${dayAllDay.length > 2 && !collapsed ? `<div class="text-xs text-accent cursor-pointer px-1" onclick="toggleWeekAllDay('${dateStr}')">收起</div>` : ''}
                </div>
            </div>
        `;
    });
    allDayHtml += '</div></div>';
    
    let timeGridHtml = `<div class="week-time-grid" style="height: 100%; overflow-y: auto; position: relative; padding-bottom: 180px;" id="week-time-grid">`;
    
    timeGridHtml += allDayHtml;
    
    timeGridHtml += '<div class="flex">';
    
    timeGridHtml += `<div class="flex-shrink-0" style="width: 52px;">`;
    for (let h = weekViewHourStart; h < weekViewHourEnd; h++) {
        timeGridHtml += `<div style="height: ${hourHeight}px;" class="text-xs text-theme-muted text-right pr-2 pt-0">${h.toString().padStart(2, '0')}:00</div>`;
    }
    timeGridHtml += '</div>';
    
    timeGridHtml += '<div class="flex-1 flex relative">';
    
    for (let h = weekViewHourStart; h < weekViewHourEnd; h++) {
        timeGridHtml += `<div class="absolute left-0 right-0 border-t border-theme" style="top: ${(h - weekViewHourStart) * hourHeight}px;"></div>`;
        timeGridHtml += `<div class="absolute left-0 right-0 border-t border-dashed border-theme" style="top: ${(h - weekViewHourStart) * hourHeight + 30}px; opacity: 0.4;"></div>`;
    }
    
    if (isCurrentWeek(weekDays)) {
        const topPx = (currentHour - weekViewHourStart) * hourHeight + (currentMinute / 60) * hourHeight;
        if (currentHour >= weekViewHourStart && currentHour < weekViewHourEnd) {
            timeGridHtml += `<div class="absolute left-0 right-0 z-10 pointer-events-none" style="top: ${topPx}px;">
                <div class="flex items-center">
                    <div class="w-2 h-2 rounded-full bg-red-500 -ml-1"></div>
                    <div class="flex-1 border-t-2 border-red-500" style="border-style: dashed;"></div>
                </div>
            </div>`;
        }
    }
    
    weekDays.forEach(date => {
        const dateStr = formatDate(date);
        const isToday = dateStr === todayStr;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        // 时间块布局已在聚合层算好并随周缓存复用（见 getWeekAggregate）
        const columnTasks = layouts[dateStr] || [];
        
        timeGridHtml += `
            <div class="flex-1 min-w-0 relative ${isWeekend ? 'week-weekend-bg bg-gray-50/50' : ''} ${isToday ? 'bg-accent-soft dark:bg-accent-strong' : ''} border-l border-theme"
                 style="height: ${totalHours * hourHeight}px;"
                 onclick="handleWeekGridClick(event, '${dateStr}')"
                 onmousemove="handleWeekGridMouseMove(event, '${dateStr}')"
                 onmouseleave="handleWeekGridMouseLeave(event)"
                 ondragover="handleWeekDragOver(event)"
                 ondrop="handleWeekTimeDrop(event, '${dateStr}')">
                <div class="week-hover-indicator absolute left-0 right-0 h-6 rounded flex items-center justify-between px-2 bg-accent-soft dark:bg-accent-strong pointer-events-none" style="display: none; top: 0px; z-index: 6;">
                    <span class="week-hover-time text-xs text-accent dark:text-accent-secondary font-medium"></span>
                    <span class="text-accent dark:text-accent-secondary font-bold text-sm">+</span>
                </div>
                ${columnTasks.map(taskLayout => {
                    const list = lists.find(l => l.id === taskLayout.task.listId);
                    const color = list?.color || '#3b82f6';
                    // 外部任务色条改订阅色 + 标题前图标（统一标识 3.3.1）
                    const _extBarColor = _extTaskBarColor(taskLayout.task, color);
                    const _extIcon = _extTaskIconHtml(taskLayout.task).replace('text-xs', 'text-[10px]');
                    const topPx = taskLayout.top;
                    const heightPx = Math.max(taskLayout.height, 20);
                    const widthPercent = taskLayout.width;
                    const leftPercent = taskLayout.left;
                    const isOverdue = isTaskOverdue(taskLayout.task);
                    const titleClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary';

                    return `<div class="absolute rounded-r px-1 py-0.5 overflow-hidden cursor-pointer task-item week-task-item ${taskLayout.task.completed ? 'opacity-55' : ''}"
                                 style="top: ${topPx}px; height: ${heightPx}px; width: ${widthPercent}%; left: ${leftPercent}%; background-color: ${color}20; border-left: 3px solid ${_extBarColor}; z-index: 5;"
                                 onclick="event.stopPropagation(); openTaskDetailPanel('${taskLayout.task.id}', false, true)"
                                 draggable="true"
                                 ondragstart="handleTaskDragStart(event, '${taskLayout.task.id}')"
                                 ondragend="handleTaskDragEnd(event)">
                        <div class="flex items-center gap-1 min-w-0">
                            ${renderTaskCheckbox(taskLayout.task, { taskId: taskLayout.task.id, iconSize: 'text-[10px]', boxClass: 'w-4 h-4', extraClass: 'flex-shrink-0' })}
                            ${_extIcon}<div class="text-xs font-medium truncate ${titleClass}" title="${escapeHtml(taskLayout.task.title || '新任务')}">${taskLayout.task.title || '新任务'}</div>
                        </div>
                        ${heightPx > 30 ? `<div class="text-xs text-theme-muted truncate pl-5">${formatTime(taskLayout.task.startTime)}${taskLayout.task.endTime ? ' - ' + formatTime(taskLayout.task.endTime) : ''}</div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        `;
    });
    
    timeGridHtml += '</div></div></div>';
    
    // 空周：网格照常完整渲染（日期表头 / 农历节假日 / 全天区 / 时间网格全部保留），
    // 只额外叠加一条悬浮提示条。这样空周依然可以点击空白新建任务、可以拖拽、
    // 移动端单日模式也能正常增强（其依赖 #week-time-grid 存在）。
    // 旧实现把整段 timeGridHtml 替换成空态卡片，又因下方 `hasAnyTasks ? timeGridHtml : ''`
    // 把空态卡片一并丢弃，最终只剩空 div —— 这就是「周视图一片空白」的直接原因。
    // pointer-events:none 让点击穿透到网格，保证「点击空白区域添加任务」可用。
    // 初始 left/right/bottom/height 只是兜底值，真实像素由 _placeWeekEmptyHint()
    // 在导航栏渲染后按实际布局测量覆盖：与导航栏同高同线、以「周一」列为基准向右偏移 10px、
    // 右边缘停在导航栏左侧（不遮挡左侧时刻信息，也不压住导航栏）。
    const emptyHintHtml = hasAnyTasks ? '' : `
        <div class="week-empty-hint" style="position: absolute; left: 62px; right: 50%; bottom: 16px; height: 48px; display: flex; align-items: center; min-width: 0; pointer-events: none; user-select: none; z-index: 20;">
            <!-- 视觉规格与周视图底部导航条完全对齐：直接复用导航条那一组类
                 （bg-theme-secondary/80 + backdrop-blur-md + rounded-xl + shadow-lg + px-6 + text-theme-primary），
                 不再另写内联背景/边框/文字色。这样导航条样式一旦调整，提示条自动跟随，两者不会再出现观感不一致。
                 高度由 _placeWeekEmptyHint() 按导航条实测高度设定；字号沿用继承值（与导航条胶囊一致）。
                 图标用 text-theme-secondary，对应导航条左右按钮的色阶。 -->
            <div class="week-empty-hint-pill flex items-center gap-2 bg-theme-secondary/80 backdrop-blur-md rounded-xl shadow-lg px-6 text-theme-primary"
                 style="height: 100%; min-width: 0; max-width: 100%;">
                <i class="fas fa-calendar-week text-theme-secondary flex-shrink-0"></i>
                <span class="week-empty-hint-text" style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">本周暂无任务，点击空白区域添加任务</span>
            </div>
        </div>`;
    
    // 底部导航栏标题：与其他视图统一为「年 + 月」表达，取该周「中间日」所在月。
    // weekDays[0] 即周起始日（getWeekAggregate 由 getWeekStartDate 展开而来）。
    // 不再显示「8月 - 9月」跨月形式：标题宽度恒定，_placeWeekEmptyHint() 的落位不再随标题长度抖动。
    const navAnchor = getWeekAnchorDate(weekDays[0]);
    const navYear = navAnchor.getFullYear();
    const navMonth = navAnchor.getMonth();

    // 保存旧网格的滚动位置（若存在），用于拖动后等重渲染场景保持视图位置
    const existingGrid = container.querySelector('#week-time-grid');
    const savedScrollTop = existingGrid ? existingGrid.scrollTop : null;

    // 外层 flex 容器让出剩余高度；内层 relative 容器为悬浮提示提供定位上下文
    // （提示固定在视口内，不随网格内部滚动而移动），并裁剪溢出。
    container.innerHTML = `<div class="h-full flex flex-col"><div class="relative" style="flex: 1 1 0%; min-height: 0; overflow: hidden;">${timeGridHtml}${emptyHintHtml}</div></div>`;

    // 填充底部导航栏（年月分段快速跳转，三视图共用同一渲染）
    renderNavTimeBar({ year: navYear, month: navMonth, prev: 'navigateWeek(-1)', next: 'navigateWeek(1)' });

    // 空周提示条落位：读取真实布局，与底部导航栏同高同线、左对齐「周一」列、右停于导航栏左侧
    _placeWeekEmptyHint();

    // 同步恢复滚动位置，消除自动刷新时的跳动
    const newGrid = document.getElementById('week-time-grid');
    if (newGrid) {
        if (savedScrollTop !== null) {
            // 重渲染（如数据同步、拖动任务后）：恢复之前的滚动位置
            newGrid.scrollTop = savedScrollTop;
        } else if (isCurrentWeek(weekDays)) {
            // 首次渲染/切换到当前周：滚动到当前时刻（空周同样定位，不落在 06:00 顶部）
            const scrollTarget = Math.max(0, (currentHour - weekViewHourStart - 1) * hourHeight);
            setTimeout(() => { newGrid.scrollTop = scrollTarget; }, 50);
        }
    }

    // 相邻周预热：延迟填充 ±1 周缓存，翻页时直接命中（只填缓存，不触碰 DOM）
    _prewarmAdjacentWeeks(weekStart);
}

function layoutDayTasks(dayTasks, hourHeight) {
    const layouts = [];

    if (dayTasks.length === 0) return layouts;

    const sorted = [...dayTasks].sort((a, b) => {
        const aStart = new Date(a.startTime);
        const bStart = new Date(b.startTime);
        if (aStart.getTime() !== bStart.getTime()) return aStart - bStart;
        const aDuration = getTaskDurationMinutes(a);
        const bDuration = getTaskDurationMinutes(b);
        return bDuration - aDuration;
    });

    // 预计算每个任务的起止分钟数与位置
    const taskInfo = sorted.map(task => {
        const start = new Date(task.startTime);
        const startMinutes = start.getHours() * 60 + start.getMinutes();
        const durationMinutes = getTaskDurationMinutes(task);
        return {
            task,
            top: (startMinutes / 60 - weekViewHourStart) * hourHeight,
            height: (durationMinutes / 60) * hourHeight,
            startMinutes,
            endMinutes: startMinutes + durationMinutes
        };
    });

    // 按时间重叠关系分组为簇：仅相互重叠的任务进入同一簇，不重叠的任务各自独立
    const clusters = [];
    let currentCluster = [];
    let clusterEnd = -Infinity;
    taskInfo.forEach(info => {
        if (currentCluster.length === 0 || info.startMinutes < clusterEnd) {
            currentCluster.push(info);
            clusterEnd = Math.max(clusterEnd, info.endMinutes);
        } else {
            clusters.push(currentCluster);
            currentCluster = [info];
            clusterEnd = info.endMinutes;
        }
    });
    if (currentCluster.length > 0) clusters.push(currentCluster);

    // 每个簇独立计算列数和宽度：单任务占满全天宽度，多任务并列时按列均分
    clusters.forEach(cluster => {
        if (cluster.length === 1) {
            const info = cluster[0];
            layouts.push({ ...info, width: 100, left: 0 });
            return;
        }

        const columns = [];
        cluster.forEach(info => {
            let placed = false;
            for (let col = 0; col < columns.length; col++) {
                const lastInCol = columns[col][columns[col].length - 1];
                if (info.startMinutes >= lastInCol.endMinutes) {
                    columns[col].push(info);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                columns.push([info]);
            }
        });

        const totalCols = columns.length;
        columns.forEach((col, colIndex) => {
            col.forEach(info => {
                layouts.push({
                    ...info,
                    width: 100 / totalCols,
                    left: colIndex * 100 / totalCols
                });
            });
        });
    });

    return layouts;
}

function getTaskDurationMinutes(task) {
    if (task.endTime) {
        const start = new Date(task.startTime);
        const end = new Date(task.endTime);
        return Math.max(15, (end - start) / (1000 * 60));
    }
    return settings.defaultDuration || 30;
}

function isCurrentWeek(weekDays) {
    const today = new Date();
    return weekDays.some(d => isSameDay(d, today));
}

function formatWeekdayShort(date) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return '周' + weekdays[date.getDay()];
}

// 获取某天的农历显示文本（用于周/日程视图日期头）
// 返回空字符串表示不显示；优先级：节假日 > 农历节日 > 节气 > 农历日名
function getLunarDisplayText(date, showLunar) {
    const enabled = (typeof showLunar === 'boolean') ? showLunar : (settings.showLunar !== false);
    if (!enabled || typeof LunarCalendar === 'undefined') return '';
    const lunar = LunarCalendar.solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
    if (!lunar) return '';
    const dateStr = formatDate(date);
    const holidayInfo = getHolidayInfo(dateStr);
    if (holidayInfo && holidayInfo.type === 'holiday' && holidayInfo.isActualDay) {
        return holidayInfo.name;
    }
    const lunarFestival = LunarCalendar.getLunarFestival(lunar.lMonth, lunar.lDay, lunar.isLeap, lunar.lYear);
    if (lunarFestival) return lunarFestival;
    const md = dateStr.substring(5);
    const solarTerms = LunarCalendar.getSolarTerms(date.getFullYear());
    if (solarTerms && solarTerms[md]) return solarTerms[md];
    return lunar.lDayName || '';
}

function toggleWeekAllDay(dateStr) {
    weekAllDayCollapsed[dateStr] = weekAllDayCollapsed[dateStr] === false;
    renderView();
}

function handleWeekGridClick(event, dateStr) {
    event.stopPropagation();
    const grid = event.currentTarget;
    const rect = grid.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const hour = weekViewHourStart + Math.floor(y / 60);
    const minute = Math.round((y % 60) / 15) * 15;
    
    if (hour < weekViewHourStart || hour >= weekViewHourEnd) return;
    
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    
    // 如果当前有打开的空任务详情，先删除空任务
    if (currentDetailTaskId) {
        const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
        if (taskIndex !== -1) {
            const task = tasks[taskIndex];
            const titleEl = document.getElementById('detail-task-title');
            const notesEl = document.getElementById('detail-task-notes');
            const currentTitle = titleEl ? titleEl.value : (task.title || '');
            const currentNotes = notesEl ? notesEl.value : (task.notes || '');
            if ((!currentTitle || !currentTitle.trim()) && (!currentNotes || !currentNotes.trim())) {
                tasks.splice(taskIndex, 1);
                saveData();
                hideDetailPanel();
                currentDetailTaskId = null;
            } else {
                closeTaskDetailPanel();
            }
        } else {
            closeTaskDetailPanel();
        }
    }
    
    // 直接创建带指定时间的非全天任务
    const startTime = new Date(`${dateStr}T${timeStr}`);
    const newTask = {
        id: generateId(),
        title: '',
        listId: settings.defaultListId || 'default',
        important: settings.defaultImportant || false,
        urgent: settings.defaultUrgent || false,
        notes: '',
        tags: [],
        startTime: startTime.toISOString(),
        endTime: null,
        isAllDay: false,
        reminder: 0,
        repeat: null,
        completed: false,
        createdAt: new Date().toISOString(),
        mode: 'text',
        subtasks: [{ id: generateId(), text: '', completed: false, originalOrder: 0 }],
        progress: 0
    };
    
    tasks.push(newTask);
    saveData();
    renderLists();
    renderView();
    openTaskDetailPanel(newTask.id);
    
    setTimeout(() => {
        const titleInput = document.getElementById('detail-task-title');
        if (titleInput) {
            titleInput.focus();
            titleInput.select();
        }
    }, 100);
}

function handleWeekGridMouseMove(event, dateStr) {
    const grid = event.currentTarget;
    const indicator = grid.querySelector('.week-hover-indicator');
    if (!indicator) return;
    
    if (event.target.closest('.task-item')) {
        indicator.style.display = 'none';
        return;
    }
    
    const rect = grid.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const snappedY = Math.round(y / 15) * 15;
    const hour = weekViewHourStart + Math.floor(snappedY / 60);
    const minute = snappedY % 60;
    
    if (hour < weekViewHourStart || hour >= weekViewHourEnd) {
        indicator.style.display = 'none';
        return;
    }
    
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    
    indicator.style.display = 'flex';
    indicator.style.top = `${snappedY - 12}px`;
    indicator.querySelector('.week-hover-time').textContent = timeStr;
}

function handleWeekGridMouseLeave(event) {
    const grid = event.currentTarget;
    const indicator = grid.querySelector('.week-hover-indicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
}

// 平滑过渡动画：月/周视图时间导航的方向性滑动过渡
// 仿照视图切换逻辑：direction=1（切向未来）时旧内容向左滑出、新内容自右侧接续滑入；-1 相反
function _playCalendarNavTransition(direction, render) {
    const fxReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fxEnabled = typeof settings !== 'undefined' && settings.smoothAnimations === true && !fxReducedMotion;
    const container = document.getElementById('view-container');
    if (!fxEnabled || !container || !container.firstChild) { render(); return; }
    // 清理上一次未完成的过渡（快速连续切换时避免幽灵层叠加/定时器互踩）
    if (container._fxNavTimer) { clearTimeout(container._fxNavTimer); container._fxNavTimer = null; }
    container.querySelectorAll('.fx-view-ghost').forEach(g => g.remove());
    container.classList.remove('fx-enter-from-left', 'fx-enter-from-right');
    // 渲染前快照旧内容（cloneNode 单遍克隆）
    const ghost = container.cloneNode(true);
    // 同步周视图时间网格滚动位置，避免幽灵层跳回顶部
    const liveScrolls = container.querySelectorAll('#week-time-grid');
    const ghostScrolls = ghost.querySelectorAll('#week-time-grid');
    liveScrolls.forEach((s, i) => { if (ghostScrolls[i]) ghostScrolls[i].scrollTop = s.scrollTop; });
    // 剥离幽灵层内所有 id，避免过渡期间 getElementById 命中幽灵层副本
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    render();
    ghost.className = 'fx-view-ghost ' + (direction > 0 ? 'fx-ghost-out-left' : 'fx-ghost-out-right');
    // 过渡期间裁剪溢出并建立幽灵层定位上下文
    container.style.overflow = 'hidden';
    container.style.position = 'relative';
    container.appendChild(ghost);
    container.classList.remove('fx-enter-from-left', 'fx-enter-from-right');
    void container.offsetWidth; // 强制重排以重新触发动画
    container.classList.add(direction > 0 ? 'fx-enter-from-right' : 'fx-enter-from-left');
    container._fxNavTimer = setTimeout(() => {
        ghost.remove();
        container.style.overflow = '';
        container.style.position = '';
        container.classList.remove('fx-enter-from-left', 'fx-enter-from-right');
        container._fxNavTimer = null;
    }, 240);
}

function navigateWeek(direction) {
    currentDate.setDate(currentDate.getDate() + direction * 7);
    _playCalendarNavTransition(direction, renderView);
}

// ==================== 月视图 ====================

function renderMonthView(container) {
    // 移动端：使用上下分栏布局（日历 + 任务列表）
    if (typeof isMobileView === 'function' && isMobileView()) {
        return renderMonthViewMobile(container);
    }

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
    const weekdayNames = settings.weekStart === 'monday' ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    let startOffset = firstDay.getDay() - dayOffset;
    if (startOffset < 0) startOffset += 7;
    
    const days = [];
    for (let i = startOffset - 1; i >= 0; i--) {
        days.push(new Date(year, month, -i));
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
        days.push(new Date(year, month, i));
    }
    // 动态计算尾部填充：仅填充到当月最后一天所在周的末尾，不强制6行
    const lastDayOfWeek = lastDay.getDay();
    let tailFill;
    if (dayOffset === 1) {
        // 周一开始：一周为周一→周日，最后一天之后填充到周日
        tailFill = (7 - lastDayOfWeek) % 7;
    } else {
        // 周日开始：一周为周日→周六，最后一天之后填充到周六
        tailFill = (6 - lastDayOfWeek + 7) % 7;
    }
    for (let i = 1; i <= tailFill; i++) {
        days.push(new Date(year, month + 1, i));
    }

    container.innerHTML = `
        <div id="month-view-container" class="h-full flex flex-col overflow-hidden relative">
            <div class="grid grid-cols-7 gap-2 flex-shrink-0">
                ${weekdayNames.map(d => `
                    <div class="text-center text-sm font-medium text-theme-secondary py-2">${d}</div>
                `).join('')}
            </div>
            <div id="month-scroll" class="flex-1 min-h-0" style="overflow: hidden; position: relative;">
            <div class="grid grid-cols-7 gap-2" id="month-grid" style="grid-auto-rows: 150px;">
                ${days.map(date => {
                    const dateStr = formatDate(date);
                    const dayTasks = getTasksForDate(date, { includeCompleted: getMonthConfig().showCompleted !== false });
                    const isToday = isSameDay(date, new Date());
                    const isCurrentMonth = date.getMonth() === month;
                    const displayCount = 3;
                    const displayTasks = dayTasks.slice(0, displayCount);

                    let lunarHtml = '';
                    let holidayBadge = '';
                    let weekBadge = '';
                    const holidayInfo = getHolidayInfo(dateStr);
                    const isWeekStartsOnMonday = settings.weekStart === 'monday';
                    const isWeekFirstDay = isWeekStartsOnMonday ? date.getDay() === 1 : date.getDay() === 0;
                    if (isWeekFirstDay) {
                        const weekNum = getWeekNumber(date, isWeekStartsOnMonday);
                        weekBadge = `<span class="text-[10px] text-theme-muted leading-none">${weekNum}周</span>`;
                    }
                    if (getMonthConfig().showLunar && typeof LunarCalendar !== 'undefined') {
                        const lunar = LunarCalendar.solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
                        if (lunar) {
                            let displayText = lunar.lDayName;
                            if (holidayInfo && holidayInfo.type === 'holiday' && holidayInfo.isActualDay) {
                                displayText = holidayInfo.name;
                            } else {
                                const lunarFestival = LunarCalendar.getLunarFestival(lunar.lMonth, lunar.lDay, lunar.isLeap, lunar.lYear);
                                if (lunarFestival) {
                                    displayText = lunarFestival;
                                } else {
                                    const md = dateStr.substring(5);
                                    const solarTerms = LunarCalendar.getSolarTerms(date.getFullYear());
                                    if (solarTerms[md]) {
                                        displayText = solarTerms[md];
                                    }
                                }
                            }
                            lunarHtml = `<span class="text-[10px] text-theme-muted leading-none">${displayText}</span>`;
                        }
                    }

                    // 「班/休」标记受月视图配置 showSwapInfo 控制（默认显示）
                    if (holidayInfo && getMonthConfig().showSwapInfo !== false) {
                        if (holidayInfo.type === 'work') {
                            holidayBadge = `<span class="text-[10px] text-red-500 font-bold leading-none" title="${holidayInfo.name}">班</span>`;
                        } else {
                            holidayBadge = `<span class="text-[10px] text-green-500 font-bold leading-none" title="${holidayInfo.name}">休</span>`;
                        }
                    }

                    return `
                        <div class="calendar-day bg-theme-secondary rounded-xl shadow-theme p-2 relative ${isToday ? 'today' : ''} ${!isCurrentMonth ? 'opacity-40' : ''} border border-theme drop-zone group"
                             data-date="${dateStr}"
                             ondragover="handleTaskDragOver(event)"
                             ondrop="handleMonthDrop(event, '${dateStr}')">
                            <div class="grid items-center mb-2" style="grid-template-columns: 1fr auto 1fr">
                                <div class="flex justify-start">${holidayBadge || weekBadge || ''}</div>
                                <span class="${isToday ? 'w-7 h-7 inline-flex items-center justify-center rounded-full bg-accent text-white font-bold' : 'font-medium text-theme-primary'} ${dayTasks.length > displayCount ? (isToday ? 'cursor-pointer hover:bg-accent-hover' : 'cursor-pointer hover:text-accent') : ''}" ${dayTasks.length > displayCount ? `onclick="event.stopPropagation(); openMonthDayPopover('${dateStr}')"` : ''}>${date.getDate()}</span>
                                <div class="flex justify-end">${lunarHtml || ''}</div>
                            </div>
                            <div class="space-y-1">
                                ${displayTasks.map(task => buildMonthGridTaskItemHtml(task)).join('')}
                                ${dayTasks.length > displayCount ? `<div class="relative text-xs"><span class="month-more-link text-accent cursor-pointer hover:underline block text-center" onclick="event.stopPropagation(); openMonthDayPopover('${dateStr}')"><span class="month-more-count">+${dayTasks.length - displayCount}</span><span class="month-more-word"> 更多</span></span><span class="text-accent cursor-pointer hover:underline font-bold opacity-0 group-hover:opacity-100 transition-opacity absolute right-0 top-0" onclick="event.stopPropagation(); openAddTaskModal('${dateStr}')">+</span></div>` : ''}
                            </div>
                            ${dayTasks.length <= displayCount ? `<button class="absolute bottom-1 right-1 text-accent text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-10" onclick="event.stopPropagation(); openAddTaskModal('${dateStr}')">+</button>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
            </div>
        </div>
    `;

    // 填充底部导航栏（年月分段快速跳转，三视图共用同一渲染）
    renderNavTimeBar({ year: year, month: month, prev: 'navigateMonth(-1)', next: 'navigateMonth(1)' });

    // 手动滚动：用 transform 替代 CSS overflow，确保跨浏览器兼容
    const monthScroll = container.querySelector('#month-scroll');
    const monthGrid = container.querySelector('#month-grid');
    if (monthScroll && monthGrid) {
        // 基于已知参数计算高度，不依赖 offsetHeight（可能被父容器压缩）
        const numRows = Math.ceil(monthGrid.children.length / 7);
        const rowHeight = 150;
        const gap = 8;
        const gridHeight = numRows * rowHeight + (numRows - 1) * gap + 80; // +80px底部空间，避免最末行被导航栏遮挡
        // 显式设置grid高度，防止被父容器压缩
        monthGrid.style.height = gridHeight + 'px';

        // 恢复上次滚动位置（用于数据同步等重渲染场景，避免跳动）
        let scrollTop = _monthSavedScrollTop !== null ? _monthSavedScrollTop : 0;

        function applyScroll() {
            monthGrid.style.transform = `translateY(${-scrollTop}px)`;
        }

        function getMaxScroll() {
            return Math.max(0, gridHeight - monthScroll.clientHeight);
        }

        monthScroll.addEventListener('wheel', function(e) {
            const maxScroll = getMaxScroll();
            if (maxScroll <= 0) return;
            e.preventDefault();
            scrollTop = Math.max(0, Math.min(maxScroll, scrollTop + e.deltaY));
            _monthSavedScrollTop = scrollTop;
            applyScroll();
        }, { passive: false });

        // 如果当前查看的月份包含今日，且无保存的滚动位置，自动定位到今日所在行
        const todayCell = monthGrid.querySelector('.calendar-day.today');
        if (todayCell && _monthSavedScrollTop === null) {
            setTimeout(() => {
                const maxScroll = getMaxScroll();
                if (maxScroll <= 0) return;
                const cellTop = todayCell.offsetTop;
                const cellHeight = todayCell.offsetHeight;
                const viewHeight = monthScroll.clientHeight;
                scrollTop = Math.max(0, Math.min(maxScroll, cellTop - (viewHeight - cellHeight) / 2));
                _monthSavedScrollTop = scrollTop;
                applyScroll();
            }, 50);
        } else {
            // 恢复保存的滚动位置
            const maxScroll = getMaxScroll();
            scrollTop = Math.max(0, Math.min(maxScroll, scrollTop));
            _monthSavedScrollTop = scrollTop;
            applyScroll();
        }
    }

}

// ==================== 月视图日期浮层（替代内联展开） ====================

let _monthPopoverEscHandler = null;
let _monthPopoverOutsideHandler = null;

function openMonthDayPopover(dateStr) {
    // 先关闭已有浮层
    closeMonthDayPopover();

    const date = new Date(dateStr + 'T00:00:00');
    const dayTasks = getTasksForDate(date, { includeCompleted: getMonthConfig().showCompleted !== false });
    const isToday = isSameDay(date, new Date());
    const weekDayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const lunarText = getLunarDisplayText(date, getMonthConfig().showLunar);

    // 节假日徽章
    const holidayInfo = getHolidayInfo(dateStr);
    let holidayBadge = '';
    if (holidayInfo) {
        if (holidayInfo.type === 'work') {
            holidayBadge = `<span class="text-xs text-red-500 font-bold px-2 py-0.5 rounded bg-red-50 dark:bg-red-900/20" title="${holidayInfo.name}">班</span>`;
        } else {
            holidayBadge = `<span class="text-xs text-green-500 font-bold px-2 py-0.5 rounded bg-green-50 dark:bg-green-900/20" title="${holidayInfo.name}">休</span>`;
        }
    }

    // 任务列表（使用日程视图样式）。点击任务不关闭浮层，方便切换查看
    const tasksHtml = dayTasks.length > 0 ? dayTasks.map((task, taskIndex) => {
        const startTime = task.startTime ? new Date(task.startTime) : null;
        const colors = getQuadrantColorClass(task);
        const list = lists.find(l => l.id === task.listId);
        const timeDisplay = task.isAllDay ? '全天' : (startTime ? `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}` : '');
        const focusMinutes = getTaskFocusMinutes(task.id);
        const isOverdue = isTaskOverdue(task);
        const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-secondary';

        return `
            <div class="schedule-task-item task-row group flex items-start gap-4 mb-3 task-item ${taskIndex > 0 ? 'pt-3' : ''} ${task.completed ? 'opacity-55' : ''}" onclick="event.stopPropagation(); _openTaskDetailFromMonthPopover('${task.id}')">
                <div class="w-8 flex-shrink-0 flex flex-col items-center justify-between self-stretch relative">
                    ${renderTaskCheckbox(task, { taskId: task.id })}
                    ${renderFocusButton(task.id)}
                </div>
                <div class="${colors.bg} rounded-r-lg p-3 flex-1 hover:opacity-80 transition schedule-task-card" style="border-left: 4px solid ${_extTaskBarColor(task, getTaskBarColor(task, list && list.color ? list.color : '#9ca3af'))}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
                    <div class="flex items-center gap-2 text-sm mb-1 text-theme-secondary flex-wrap">
                        ${timeDisplay ? `<span class="${timeTextClass}">${timeDisplay}</span>` : ''}
                        ${list ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${list.color}"></span>${list.name}</span>` : ''}
                        ${renderTagCapsules(task, 2, 'right')}
                        ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-500"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                        ${task.progress && task.progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-accent"></i>${task.progress}%</span>` : ''}
                    </div>
                    <div class="font-medium ${task.completed ? 'text-theme-secondary' : 'text-theme-primary'} flex items-center">
                        ${_extTaskIconHtml(task)}${escapeHtml(task.title || '新任务')}
                    </div>
                    ${renderSubtaskListDisplay(task) || (task.notes ? `<div class="text-xs ${task.completed ? 'text-theme-secondary' : 'text-theme-muted'} mt-1">${escapeHtml(task.notes)}</div>` : '')}
                </div>
            </div>
        `;
    }).join('') : `<div class="text-center text-theme-muted py-12">当日暂无任务</div>`;

    // 浮层 HTML：不使用全屏遮罩（避免遮挡任务详情栏 z-40），改用 document click 监听外部点击
    // z-[55] 高于底部导航栏(z-50)，低于 toast(z-60)
    const popoverHtml = `
        <div id="month-day-popover" class="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[55] w-[92%] max-w-lg bg-theme-secondary rounded-2xl shadow-2xl border border-theme flex flex-col" style="max-height: 75vh;">
            <!-- 头部：日期 + 农历 + 添加按钮 + 关闭按钮 -->
            <div class="flex items-center justify-between p-4 border-b border-theme flex-shrink-0">
                <div class="flex items-center gap-3">
                    <div class="text-center">
                        <div class="${isToday ? 'text-accent-dark font-bold' : 'text-theme-primary'} text-2xl">${date.getDate()}</div>
                        <div class="text-xs text-theme-muted">周${weekDayNames[date.getDay()]}</div>
                    </div>
                    <div class="flex flex-col gap-1">
                        <div class="text-sm text-theme-secondary">${date.getFullYear()}年${date.getMonth() + 1}月</div>
                        ${lunarText ? `<div class="text-xs text-theme-muted">${lunarText}</div>` : ''}
                        ${holidayBadge}
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="event.stopPropagation(); closeMonthDayPopover(); openAddTaskModal('${dateStr}')" class="w-8 h-8 rounded-full border-2 border-purple-500 text-purple-500 flex items-center justify-center hover:bg-purple-500 hover:text-white transition" title="添加任务">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button onclick="event.stopPropagation(); closeMonthDayPopover()" class="w-8 h-8 rounded-full hover:bg-theme-tertiary text-theme-secondary flex items-center justify-center transition" title="关闭">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
            <!-- 任务列表 -->
            <div class="flex-1 overflow-y-auto p-4">
                <div class="relative pl-6">
                    <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-theme"></div>
                    ${tasksHtml}
                </div>
            </div>
        </div>
    `;

    // 插入到 body 末尾（脱离 main 的 overflow-hidden 限制）
    const wrapper = document.createElement('div');
    wrapper.id = 'month-day-popover-wrapper';
    wrapper.innerHTML = popoverHtml;
    document.body.appendChild(wrapper);

    // ESC 关闭
    _monthPopoverEscHandler = (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            closeMonthDayPopover();
        }
    };
    document.addEventListener('keydown', _monthPopoverEscHandler, true);

    // 外部点击关闭（延迟添加，避免当前点击事件触发）
    setTimeout(() => {
        _monthPopoverOutsideHandler = (e) => {
            const popover = document.getElementById('month-day-popover');
            if (!popover) return;
            // 点击浮层内：不关闭
            if (popover.contains(e.target)) return;
            // 点击任务详情栏内：不关闭（方便操作详情）
            const detailPanel = document.getElementById('task-detail-panel');
            if (detailPanel && !detailPanel.classList.contains('hidden') && detailPanel.contains(e.target)) return;
            // 其他区域：关闭浮层 + 关闭任务详情栏
            closeMonthDayPopover();
        };
        document.addEventListener('click', _monthPopoverOutsideHandler, true);
    }, 0);
}

// 浮层内点击任务：直接打开新详情（切换前的保存已由 openTaskDetailPanel 内部统一处理），浮层保持打开
function _openTaskDetailFromMonthPopover(taskId) {
    openTaskDetailPanel(taskId, false, true);
}

function closeMonthDayPopover() {
    const wrapper = document.getElementById('month-day-popover-wrapper');
    if (wrapper) wrapper.remove();
    if (_monthPopoverEscHandler) {
        document.removeEventListener('keydown', _monthPopoverEscHandler, true);
        _monthPopoverEscHandler = null;
    }
    if (_monthPopoverOutsideHandler) {
        document.removeEventListener('click', _monthPopoverOutsideHandler, true);
        _monthPopoverOutsideHandler = null;
    }
    // 关闭浮层时，如有展开的任务详情栏，保存并收起
    if (currentDetailTaskId) {
        closeTaskDetailPanel();
    }
}

// ==================== 任务完成动效预案（月视图网格 / 周视图全天区） ====================
// 勾选完成时由 tasks.js 的 _playTaskDoneCollapseFx 调用（在任务状态翻转前）：
// - 任务完成后仍在该容器可见切片内 → 计入 skip（跳过塌陷，避免"消失后闪回"）
// - 任务被挤出切片 → 计入 reveals（塌陷同时在 +N 按钮前"生长"出被顶入的下一条任务）
// 返回 { skip: Set<Element>, reveals: [{ container, refEl, html, gap }] }
function planCalendarTaskDoneFx(taskId) {
    const skip = new Set();
    const reveals = [];
    const anchors = document.querySelectorAll(`[onclick*="toggleTaskComplete('${taskId}')"]`);
    for (const anchor of anchors) {
        const row = anchor.closest('.task-row');
        if (!row || row.offsetParent === null) continue;
        const dayCell = row.closest('.calendar-day');
        if (dayCell && dayCell.dataset.date) {
            _planMonthGridCellDoneFx(taskId, row, dayCell, skip, reveals);
            continue;
        }
        const weekCol = row.closest('[data-weekallday]');
        if (weekCol) {
            _planWeekAllDayDoneFx(taskId, row, weekCol, skip, reveals);
        }
    }
    return { skip, reveals };
}

// 模拟任务完成后的当日可见切片（与渲染同口径：getTasksForDate + 过滤 + sortTasksByCompletion + slice）
// includeCompleted 关闭时完成任务会整体离开当日列表
function _simDayVisibleAfterComplete(dateStr, taskId, includeCompleted, filterFn, count) {
    const date = new Date(dateStr + 'T00:00:00');
    let dayTasks = getTasksForDate(date, { includeCompleted });
    if (filterFn) dayTasks = dayTasks.filter(filterFn);
    let sim;
    if (includeCompleted) {
        const now = new Date().toISOString();
        sim = dayTasks.map(t => t.id === taskId ? { ...t, completed: true, completedAt: now } : t);
    } else {
        sim = dayTasks.filter(t => t.id !== taskId);
    }
    return sortTasksByCompletion(sim).slice(0, count);
}

// 月视图网格格：displayCount = 3（与 renderMonthView 一致）
function _planMonthGridCellDoneFx(taskId, row, dayCell, skip, reveals) {
    const count = 3;
    const newVisible = _simDayVisibleAfterComplete(dayCell.dataset.date, taskId, getMonthConfig().showCompleted !== false, null, count);
    // 仍在切片内：仅变灰/格内重排，不塌陷
    if (newVisible.some(t => t.id === taskId)) { skip.add(row); return; }
    // 切片未满（如隐藏已完成任务被关闭）：无新行顶入，仅塌陷
    const entering = (newVisible.length === count) ? newVisible[count - 1] : null;
    if (!entering) return;
    const listEl = row.parentElement;
    const realTask = tasks.find(t => t.id === entering.id);
    if (!listEl || !realTask) return;
    // 揭示行插入参照：+N 更多按钮；gap 对齐 space-y-1 的 4px 子项边距
    const moreLink = listEl.querySelector('.month-more-link');
    reveals.push({ container: listEl, refEl: moreLink ? moreLink.parentElement : null, html: buildMonthGridTaskItemHtml(realTask), gap: '4px' });
}

// 周视图全天列：收起态显示前 2 条（与 renderWeekView 一致）；展开态显示全部（任务仍在列内重排，跳过）
function _planWeekAllDayDoneFx(taskId, row, weekCol, skip, reveals) {
    const dateStr = weekCol.dataset.weekallday;
    if (!dateStr) return;
    if (weekAllDayCollapsed[dateStr] === false) { skip.add(row); return; }
    const count = 2;
    const newVisible = _simDayVisibleAfterComplete(dateStr, taskId, getWeekConfig().showCompleted !== false, t => t.isAllDay || isMultiDayTask(t), count);
    if (newVisible.some(t => t.id === taskId)) { skip.add(row); return; }
    const entering = (newVisible.length === count) ? newVisible[count - 1] : null;
    if (!entering) return;
    const realTask = tasks.find(t => t.id === entering.id);
    if (!realTask) return;
    // 揭示行插入参照：+N 更多/收起按钮；周全天区子项无边距
    const refEl = weekCol.querySelector('[onclick^="toggleWeekAllDay("]');
    reveals.push({ container: weekCol, refEl, html: buildWeekAllDayTaskItemHtml(realTask), gap: '0px' });
}

// ==================== 移动端月视图：上下分栏（日历网格 + 任务列表） ====================
function renderMonthViewMobile(container) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // 初始化选中日期为今天（如果在本月）或本月1号
    if (!_mobileMonthSelectedDate || !isSameMonth(_mobileMonthSelectedDate, currentDate)) {
        _mobileMonthSelectedDate = new Date();
        if (_mobileMonthSelectedDate.getMonth() !== month) {
            _mobileMonthSelectedDate = new Date(year, month, 1);
        }
    }

    const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
    const weekdayNames = settings.weekStart === 'monday'
        ? ['一', '二', '三', '四', '五', '六', '日']
        : ['日', '一', '二', '三', '四', '五', '六'];
    let startOffset = firstDay.getDay() - dayOffset;
    if (startOffset < 0) startOffset += 7;

    const days = [];
    for (let i = startOffset - 1; i >= 0; i--) {
        days.push(new Date(year, month, -i));
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
        days.push(new Date(year, month, i));
    }
    const lastDayOfWeek = lastDay.getDay();
    let tailFill;
    if (dayOffset === 1) {
        tailFill = (7 - lastDayOfWeek) % 7;
    } else {
        tailFill = (6 - lastDayOfWeek + 7) % 7;
    }
    for (let i = 1; i <= tailFill; i++) {
        days.push(new Date(year, month + 1, i));
    }

    const today = new Date();
    const sel = _mobileMonthSelectedDate;
    const selStr = formatDate(sel);
    const selTasks = getTasksForDate(sel, { includeCompleted: getMonthConfig().showCompleted !== false }).sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (a.originalOrder || 0) - (b.originalOrder || 0);
    });
    const activeTasks = selTasks.filter(t => !t.completed);
    const doneTasks = selTasks.filter(t => t.completed);

    // 日历网格 HTML
    const gridHtml = days.map(date => {
        const dateStr = formatDate(date);
        const dayTasks = getTasksForDate(date, { includeCompleted: getMonthConfig().showCompleted !== false });
        const isToday = isSameDay(date, today);
        const isSelected = isSameDay(date, sel);
        const isCurrentMonth = date.getMonth() === month;

        // 任务点（最多4个点）
        const dotCount = Math.min(dayTasks.length, 4);
        const dotsHtml = Array.from({ length: dotCount }, (_, i) => {
            const t = dayTasks[i];
            const list = lists.find(l => l.id === t.listId);
            return `<span class="w-1.5 h-1.5 rounded-full inline-block" style="background:${list?.color || '#3b82f6'}"></span>`;
        }).join('');

        let lunarText = '';
        if (getMonthConfig().showLunar && typeof LunarCalendar !== 'undefined') {
            const lunar = LunarCalendar.solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
            if (lunar) {
                const holidayInfo = getHolidayInfo(dateStr);
                let displayText = lunar.lDayName;
                if (holidayInfo && holidayInfo.type === 'holiday' && holidayInfo.isActualDay) {
                    displayText = holidayInfo.name;
                }
                lunarText = `<div class="text-[9px] text-theme-muted leading-none scale-90">${displayText}</div>`;
            }
        }

        return `
            <button class="mobile-month-day relative flex flex-col items-center justify-center py-1.5 rounded-lg transition ${isToday ? 'bg-accent text-white' : ''} ${isSelected && !isToday ? 'ring-2 ring-accent' : ''} ${!isCurrentMonth ? 'opacity-35' : 'hover:bg-theme-tertiary'}"
                    onclick="_mobileMonthSelectDate('${dateStr}')"
                    data-date="${dateStr}">
                <span class="text-sm font-medium leading-none ${isToday ? 'text-white' : (isSelected ? 'text-accent' : 'text-theme-primary')}">${date.getDate()}</span>
                ${lunarText}
                ${dotCount > 0 ? `<div class="flex gap-0.5 mt-0.5">${dotsHtml}</div>` : ''}
            </button>
        `;
    }).join('');

    // 任务列表项渲染
    function renderMobileTaskItem(task) {
        const list = lists.find(l => l.id === task.listId);
        const startTime = task.startTime ? new Date(task.startTime) : null;
        const timeStr = task.isAllDay ? '' : (startTime ? `${startTime.getHours().toString().padStart(2,'0')}:${startTime.getMinutes().toString().padStart(2,'0')}` : '');
        const isOverdue = isTaskOverdue(task);
        const titleCls = task.completed ? 'text-theme-secondary' : (isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary');
        const checked = task.completed ? 'checked' : '';
        return `
            <div class="task-row flex items-center gap-2 py-2.5 border-b border-theme/50 last:border-b-0 ${task.completed ? 'opacity-55' : ''}" onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}', false, true)">
                <span class="flex-shrink-0 w-1 h-4 rounded-full" style="background-color:${_extTaskBarColor(task, list?.color || '#9ca3af')}"></span>
                <label class="flex-shrink-0" onclick="event.stopPropagation()">
                    <input type="checkbox" ${checked} onchange="toggleTaskComplete('${task.id}')" class="w-5 h-5 rounded border-theme accent-color">
                </label>
                ${_extTaskIconHtml(task)}<span class="flex-1 min-w-0 truncate text-sm ${titleCls}" title="${escapeHtml(task.title || '新任务')}">${task.title || '新任务'}</span>
                ${timeStr ? `<span class="flex-shrink-0 text-xs text-theme-muted">${timeStr}</span>` : ''}
            </div>
        `;
    }

    container.innerHTML = `
        <div id="month-view-container" class="h-full flex flex-col overflow-hidden relative bg-theme-primary">
            <!-- 月份标题栏 -->
            <div class="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b border-theme/30">
                <h2 class="text-xl font-bold text-theme-primary">${month + 1}月</h2>
                <div class="flex items-center gap-2">
                    <button onclick="userSwitchView('week')" class="w-9 h-9 rounded-lg flex items-center justify-center text-theme-secondary hover:bg-theme-tertiary transition" title="周视图">
                        <i class="fas fa-calendar-week"></i>
                    </button>
                    <button onclick="toggleMobileMoreMenu(event)" class="w-9 h-9 rounded-lg flex items-center justify-center text-theme-secondary hover:bg-theme-tertiary transition">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                </div>
            </div>

            <!-- 星期头 -->
            <div class="grid grid-cols-7 px-2 py-1.5 flex-shrink-0 border-b border-theme/20">
                ${weekdayNames.map(d => `<div class="text-center text-xs font-medium text-theme-secondary">${d}</div>`).join('')}
            </div>

            <!-- 紧凑日历网格 -->
            <div id="mobile-month-grid" class="grid grid-cols-7 gap-0.5 px-2 py-2 flex-shrink-0">
                ${gridHtml}
            </div>

            <!-- 选中日期的任务列表 -->
            <div id="mobile-month-task-list" class="flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-3">
                <!-- 今天 / 选中日期 -->
                <div class="bg-theme-secondary rounded-xl overflow-hidden shadow-theme">
                    <div class="px-4 py-2.5 border-b border-theme/30 flex items-center justify-between">
                        <h3 class="text-sm font-semibold text-theme-primary">${isSameDay(sel, today) ? '今天' : `${sel.getMonth() + 1}月${sel.getDate()}日`}</h3>
                        <span class="text-xs text-theme-muted">${activeTasks.length} 项待办</span>
                    </div>
                    <div class="divide-y divide-theme/40">
                        ${activeTasks.length > 0 ? activeTasks.map(renderMobileTaskItem).join('') : '<div class="px-4 py-6 text-center text-sm text-theme-muted">暂无任务</div>'}
                    </div>
                </div>

                <!-- 已完成 -->
                ${doneTasks.length > 0 ? `
                <div class="bg-theme-secondary rounded-xl overflow-hidden shadow-theme">
                    <div class="px-4 py-2.5 border-b border-theme/30">
                        <h3 class="text-sm font-semibold text-theme-muted">已完成</h3>
                    </div>
                    <div class="divide-y divide-theme/40">
                        ${doneTasks.map(renderMobileTaskItem).join('')}
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
    `;

    // 填充底部导航栏（年月分段快速跳转，三视图共用同一渲染）
    renderNavTimeBar({ year: year, month: month, prev: 'navigateMonth(-1)', next: 'navigateMonth(1)' });
}

// 移动端月视图：选中日期
function _mobileMonthSelectDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (!isNaN(d.getTime())) {
        _mobileMonthSelectedDate = d;
        const vc = document.getElementById('view-container');
        if (vc) renderMonthView(vc);
    }
}

// 辅助：判断同月
function isSameMonth(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
}

function navigateMonth(direction) {
    closeMonthDayPopover();
    // 修复日期溢出：直接 setMonth 会在 "31日 + 目标月无31天" 时跳到下下月
    // （如 1月31日 +1 → 3月3日）。改为先计算目标月的天数上限，
    // 取 min(原日期, 目标月天数) 作为目标日期，避免溢出。
    const origDay = currentDate.getDate();
    const year = currentDate.getFullYear();
    const targetMonth = currentDate.getMonth() + direction;
    // 目标月的最后一天：下个月的第0天
    const lastDayOfTargetMonth = new Date(year, targetMonth + 1, 0).getDate();
    const safeDay = Math.min(origDay, lastDayOfTargetMonth);
    currentDate = new Date(year, targetMonth, safeDay);
    _monthSavedScrollTop = null; // 切换月份时重置滚动位置
    _playCalendarNavTransition(direction, renderView);
}

// ==================== 底部导航栏：年月快速跳转（日程 / 周 / 月 三视图共用） ====================
// 标题拆成「年段 ｜ 月段」两个可点元素：点年段弹年份网格，点月段弹月份网格，
// 选中后统一走 jumpToMonth()。
// 周视图的语义：currentDate 设为该月 1 日，getWeekStartDate 天然得到
// 「包含该月 1 日的那一周」＝该月第 1 周，之后由左右箭头继续翻周。
//
// 面板挂在 body 上而不是 #view-nav-bar 内部，两个原因：
//   1. renderView()（views.js）每次渲染开头就执行 navBar.innerHTML = ''，
//      挂在内部的节点会被当场销毁；
//   2. #view-nav-bar 的 z-index 是 20，低于移动端底部导航栏的 30，挂在内部会被压住。

let _qtpEl = null;
let _qtpKind = 'month';
let _qtpPageStart = 2000; // 年份面板当前页首年（12 年一屏）
let _qtpHandlersBound = false;

function _qtpWeekStartsOnMonday() {
    return typeof settings !== 'undefined' && settings.weekStart === 'monday';
}

// 周所属年月：取该周「中间日」（第 4 天）所在年月。
// 为什么不用「周起始日所在月」：2026-03-01 是周日，其所在周为 2/23–3/1，周起始日落在 2 月，
// 于是「选 3 月」却显示「2026年2月」，与用户刚选的月份对不上。
// 改用中间日后：一个 7 天周里中间日所在月恒占 4~7 天（多数），且每个周唯一归属一个月，
// 无重叠无遗漏，「标题显示的是多数天数所在月」也便于解释。
function getWeekAnchorDate(weekStart) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 3);
    return d;
}

// 该月「第 1 周」的周起始日：中间日落在该月的第一周（与 getWeekAnchorDate 同口径）。
function getFirstWeekStartOfMonth(year, month, weekStartsOnMonday) {
    let ws = getWeekStartDate(new Date(year, month, 1), weekStartsOnMonday);
    const mid = getWeekAnchorDate(ws);
    if (mid.getFullYear() !== year || mid.getMonth() !== month) {
        ws = new Date(ws);
        ws.setDate(ws.getDate() + 7);
    }
    return ws;
}

// 标题/面板的「当前年月」。
// 日程视图的标题由 IntersectionObserver 维护（显示的是滚动到的月份），与 currentDate 无关，
// 必须读 _scheduleNavMonthLabel；周视图取周中间日所在月，与标题取值保持一致。
function _qtpCurrentContext() {
    if (typeof currentView !== 'undefined' && currentView === 'schedule'
        && typeof _scheduleNavMonthLabel === 'string'
        && /^\d{4}-\d{2}$/.test(_scheduleNavMonthLabel)) {
        return {
            year: parseInt(_scheduleNavMonthLabel.substring(0, 4), 10),
            month: parseInt(_scheduleNavMonthLabel.substring(5), 10) - 1
        };
    }
    let d = currentDate;
    if (typeof currentView !== 'undefined' && currentView === 'week') {
        d = getWeekAnchorDate(getWeekStartDate(currentDate, _qtpWeekStartsOnMonday()));
    }
    return { year: d.getFullYear(), month: d.getMonth() };
}

function _qtpIsOpen() {
    return !!(_qtpEl && _qtpEl.style.visibility === 'visible');
}

// 统一的导航栏渲染。prev / next 传导航函数名（字符串），三视图各自传自己的。
// titleId 用于日程视图：它的月份指示 IO 需要按 id 找到标题节点。
function renderNavTimeBar(opts) {
    const bar = document.getElementById('view-nav-bar');
    if (!bar) return;
    const year = opts.year;
    const month = opts.month; // 0-based
    const titleId = opts.titleId ? ` id="${opts.titleId}"` : '';
    bar.innerHTML = `
        <div class="flex items-center gap-4 bg-theme-secondary/80 backdrop-blur-md rounded-xl shadow-lg px-6 py-3">
            <button onclick="${opts.prev}" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                <i class="fas fa-chevron-left"></i>
            </button>
            <h2${titleId} class="text-xl font-bold text-theme-primary text-center flex items-center justify-center gap-0" style="min-width: 190px;">
                <button type="button" data-nav-year class="nav-seg" onclick="openQuickTimePanel('year', event)">${year}年</button>
                <button type="button" data-nav-month class="nav-seg" onclick="openQuickTimePanel('month', event)">${month + 1}月</button>
            </h2>
            <button onclick="${opts.next}" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                <i class="fas fa-chevron-right"></i>
            </button>
        </div>`;
    // 面板开着时导航栏被重渲染（如后台数据同步）：补回置灰状态并跟随新胶囊重新定位
    if (_qtpIsOpen()) {
        bar.classList.add('qtp-open');
        _qtpPosition();
    }
}

// 只改标题文字、不重建 DOM。
// 日程视图的月份指示 IntersectionObserver 原先是直接写 #schedule-nav-month 的 textContent，
// 那会把两个分段按钮一并抹掉，故改走这里。
function updateNavTimeBar(year, month) {
    const bar = document.getElementById('view-nav-bar');
    if (!bar) return;
    const y = bar.querySelector('[data-nav-year]');
    const m = bar.querySelector('[data-nav-month]');
    if (y) y.textContent = `${year}年`;
    if (m) m.textContent = `${month + 1}月`;
}

// 三个视图唯一的跳转入口
function jumpToMonth(year, month) {
    // 日程视图是滚动容器（不是重渲染）：先把目标月平移进渲染窗口，再交给渲染后的滚动定位。
    // 窗口是 -3 ~ +9 共 13 个月（taskListView.js renderScheduleView），
    // offset 取 (目标月 - 基准月) 后目标正好落在窗口第 4 个位置，与「今天」的常态位置一致。
    //
    // 基准月必须取「今天」而不是全局 currentDate：renderScheduleView 内部是
    // `const currentDate = new Date();`（局部变量，遮蔽了全局），窗口始终以今天为锚点。
    // 若按全局 currentDate 算 offset，在周/月视图里翻过页后再切到日程视图跳转，
    // 会因为两套基准相差若干月而把目标月推出窗口（实测：选 2026-06 落到 2027-01）。
    if (typeof currentView !== 'undefined' && currentView === 'schedule'
        && typeof scheduleMonthOffset !== 'undefined'
        && typeof renderScheduleView === 'function') {
        const nowForBase = new Date();
        const baseIdx = nowForBase.getFullYear() * 12 + nowForBase.getMonth();
        const targetIdx = year * 12 + month;
        const wanted = `${year}-${String(month + 1).padStart(2, '0')}`;
        scheduleMonthOffset = targetIdx - baseIdx;
        _scheduleScrollTargetMonth = wanted;
        _scheduleScrollTargetDir = targetIdx >= baseIdx ? 1 : -1;
        _scheduleAutoScroll = true;
        renderScheduleView(document.getElementById('view-container'));
        // 日程视图只为「有任务的月份」生成外壳（taskListView.js 的 monthsWithTasks 判断），
        // 目标月无任务时会就近落到最近有内容的月份 —— 明确告知，避免用户以为跳错了。
        if (typeof _scheduleNavMonthLabel === 'string'
            && /^\d{4}-\d{2}$/.test(_scheduleNavMonthLabel)
            && _scheduleNavMonthLabel !== wanted
            && typeof showToast === 'function') {
            showToast(`${year}年${month + 1}月暂无任务，已定位到 `
                + `${_scheduleNavMonthLabel.substring(0, 4)}年${parseInt(_scheduleNavMonthLabel.substring(5), 10)}月`,
                'info', 3000);
        }
        return;
    }

    // 周视图：落到该月「第 1 周」＝中间日落在该月的第一周（见 getFirstWeekStartOfMonth）。
    // 不能简单地设成该月 1 日：1 日若落在周中，其所在周的中间日可能仍在上个月，
    // 标题就会显示成上个月，与用户刚选的月份对不上。
    if (typeof currentView !== 'undefined' && currentView === 'week') {
        const monday = _qtpWeekStartsOnMonday();
        const newWeekStart = getFirstWeekStartOfMonth(year, month, monday);

        // 移动端周视图的单日模式：选中日期平移 N*7 天以保持原来的「星期几」，
        // 否则重渲染时 mobile.js 会因该日不在本周而回落到 weekStrs[0]（周一）。
        if (typeof isMobileView === 'function' && isMobileView()
            && typeof _mobileWeekSelectedDate === 'string'
            && /^\d{4}-\d{2}-\d{2}$/.test(_mobileWeekSelectedDate)) {
            const oldSel = new Date(_mobileWeekSelectedDate + 'T00:00:00');
            if (!isNaN(oldSel.getTime())) {
                const weekdayOffset = Math.round((oldSel - getWeekStartDate(oldSel, monday)) / 86400000);
                const newSel = new Date(newWeekStart);
                newSel.setDate(newSel.getDate() + weekdayOffset);
                _mobileWeekSelectedDate = formatDate(newSel);
            }
        }

        currentDate = newWeekStart;
        renderView();
        return;
    }

    // 月视图只用到年月（renderMonthView / renderMonthViewMobile 均只读 getFullYear/getMonth）
    currentDate = new Date(year, month, 1);
    renderView();
}

function _qtpEnsure() {
    if (_qtpEl) return _qtpEl;
    const el = document.createElement('div');
    el.id = 'quick-time-panel';
    el.className = 'bg-theme-secondary border border-theme rounded-xl shadow-xl p-2 text-theme-primary';
    el.style.position = 'fixed';
    el.style.zIndex = '60';
    el.style.visibility = 'hidden';
    el.style.left = '0px';
    el.style.top = '0px';
    document.body.appendChild(el);
    _qtpEl = el;
    _qtpBindHandlers();
    return el;
}

function _qtpBindHandlers() {
    if (_qtpHandlersBound) return;
    _qtpHandlersBound = true;
    // 冒泡阶段：段按钮自己的 onclick 先执行（切换/关闭），这里只处理「点到面板外」
    document.addEventListener('click', (e) => {
        if (!_qtpIsOpen()) return;
        if (_qtpEl.contains(e.target)) return;
        if (e.target && e.target.closest && e.target.closest('#view-nav-bar .nav-seg')) return;
        closeQuickTimePanel();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _qtpIsOpen()) closeQuickTimePanel();
    });
    window.addEventListener('resize', () => { if (_qtpIsOpen()) _qtpPosition(); });
}

function closeQuickTimePanel() {
    if (_qtpEl) { _qtpEl.remove(); _qtpEl = null; }
    const bar = document.getElementById('view-nav-bar');
    if (bar) bar.classList.remove('qtp-open');
}

function openQuickTimePanel(kind, ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    const next = kind === 'year' ? 'year' : 'month';
    // 再点同一段 = 关闭
    if (_qtpIsOpen() && _qtpKind === next) { closeQuickTimePanel(); return; }

    const wasOpen = _qtpIsOpen();
    _qtpKind = next;
    const ctx = _qtpCurrentContext();
    // 仅在从关闭态打开时重置年份页（面板内 年↔月 互切时保留翻页位置）
    if (!wasOpen) _qtpPageStart = Math.floor(ctx.year / 12) * 12;

    _qtpEnsure();
    _qtpRenderContent();
    _qtpPosition();
}

function _qtpRenderContent() {
    const el = _qtpEl;
    if (!el) return;
    const ctx = _qtpCurrentContext();
    const cellBase = 'display:flex;align-items:center;justify-content:center;height:32px;border-radius:6px;font-size:13px;cursor:pointer;border:none;background:transparent;transition:background-color .15s ease;';
    const cellIdle = 'color:var(--text-secondary);';
    const cellActive = 'background:var(--accent-color, #3b82f6);color:#fff;font-weight:500;';
    const gridStyle = 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;width:176px;';
    const navBtn = 'padding:2px 8px;border-radius:6px;font-size:12px;cursor:pointer;border:none;background:transparent;color:var(--text-muted);';

    if (_qtpKind === 'year') {
        const start = _qtpPageStart;
        let cells = '';
        for (let i = 0; i < 12; i++) {
            const y = start + i;
            cells += `<button type="button" class="qtp-cell" style="${cellBase}${y === ctx.year ? cellActive : cellIdle}" onclick="qtpPickYear(${y})">${y}</button>`;
        }
        el.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:0 2px 6px;">
                <button type="button" class="qtp-nav" style="${navBtn}" onclick="qtpPage(-1)">‹</button>
                <span style="font-size:12px;color:var(--text-muted);">${start} – ${start + 11}</span>
                <button type="button" class="qtp-nav" style="${navBtn}" onclick="qtpPage(1)">›</button>
            </div>
            <div style="${gridStyle}">${cells}</div>
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-color);text-align:center;">
                <button type="button" class="qtp-nav" style="${navBtn}color:var(--accent-color, #3b82f6);" onclick="qtpPickToday()">今年</button>
            </div>`;
    } else {
        let cells = '';
        for (let m = 0; m < 12; m++) {
            cells += `<button type="button" class="qtp-cell" style="${cellBase}${m === ctx.month ? cellActive : cellIdle}" onclick="qtpPickMonth(${m})">${m + 1}月</button>`;
        }
        el.innerHTML = `
            <div style="text-align:center;padding:0 2px 6px;">
                <button type="button" class="qtp-nav" style="${navBtn}color:var(--text-secondary);" onclick="openQuickTimePanel('year', event)">${ctx.year}年</button>
            </div>
            <div style="${gridStyle}">${cells}</div>`;
    }
}

function _qtpPosition() {
    const el = _qtpEl;
    if (!el) return;
    el.style.visibility = 'hidden';
    el.style.left = '0px';
    el.style.top = '0px';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pill = document.querySelector('#view-nav-bar > *');
    let left = vw / 2 - w / 2;
    let top = vh / 2 - h / 2;
    if (pill) {
        const r = pill.getBoundingClientRect();
        if (r.width > 0) {
            left = r.left + r.width / 2 - w / 2;
            top = r.top - h - 8;               // 优先向上弹（胶囊贴在底部）
            if (top < 8) top = r.bottom + 8;   // 上方确实放不下才落到下方
        }
    }
    left = Math.max(8, Math.min(left, vw - w - 8));
    top = Math.max(8, Math.min(top, vh - h - 8));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.style.visibility = 'visible';
    const bar = document.getElementById('view-nav-bar');
    if (bar) bar.classList.add('qtp-open');
}

function qtpPage(direction) {
    _qtpPageStart += direction * 12;
    _qtpRenderContent();
    _qtpPosition();
}

function qtpPickYear(year) {
    // 只改年，月保持不变
    const ctx = _qtpCurrentContext();
    _qtpCommit(year, ctx.month);
}

function qtpPickMonth(month) {
    // 只改月，年保持不变
    const ctx = _qtpCurrentContext();
    _qtpCommit(ctx.year, month);
}

function qtpPickToday() {
    const now = new Date();
    _qtpCommit(now.getFullYear(), now.getMonth());
}

function _qtpCommit(year, month) {
    // 先关面板再跳转：跳转会触发 renderView()，而它会清空 #view-nav-bar
    closeQuickTimePanel();
    jumpToMonth(year, month);
}
