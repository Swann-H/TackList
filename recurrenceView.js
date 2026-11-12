// ==================== 重复任务后续只读投影 ====================
// 设计约定：
// 1. 真实实例仍是唯一可编辑/可完成/可提醒的对象；后续只做「渲染期投影」，不写入 tasks，也不落库。
// 2. 投影对象带 `_projected` 标记，所有写链路、统计、搜索、提醒、撤销栈都必须排除它们。
// 3. 仅为「按设定时间」模式生成；「按完成时间」的下次日期取决于完成时刻，无法预测。
// 4. 生成窗口由设置决定（2 周 / 1 个月 / 3 个月），每系列最多 10 条。
// 5. 视图层各自决定如何展示：任务列表按日期分组内联、日程/周/月只读块。
// 6. 投影与真实任务共用 filterTasks 的筛选语义（清单/标签/时间筛选/自定义过滤器/归档），保证各上下文可见性一致。

const RECURRING_GHOST_ID_PREFIX = 'ghost:';
const RECURRING_MAX_PER_SERIES = 10;
const RECURRING_RANGE_DAYS = { '2w': 14, '1m': 30, '3m': 90 };

// 投影缓存：按「视图 + 筛选上下文 + 设置 + 数据版本」分键
let _recurringGhostCache = { key: '', map: null };
let _recurringGhostRevision = 0;

function invalidateRecurringGhostCache() {
    _recurringGhostRevision++;
    _recurringGhostCache = { key: '', map: null };
}

function getRecurringRangeKey() {
    const v = settings && settings.recurringFutureRange;
    return (v === '2w' || v === '1m' || v === '3m') ? v : '1m';
}

function getRecurringRangeDays() {
    return RECURRING_RANGE_DAYS[getRecurringRangeKey()] || 30;
}

// 各视图是否启用后续安排：统一由设置面板「视图与外观」的全局开关控制。
// 视图级 / 清单级的历史 showRecurringFuture 字段已在 applySettings 迁移中删除，不再读取。
// 默认关闭：用 === true 白名单，字段缺失或异常值一律视为关闭。
// 保留 view 参数以兼容各视图调用点，当前所有视图返回同一结果。
function isRecurringFutureEnabled(view) {
    if (typeof isBatchSelectActive === 'function' && isBatchSelectActive()) return false;
    return !!(settings && settings.showRecurringFuture === true);
}

// 重复类型名 → 用于行内图标 hover 的一句话
// 口径与详情面板单选框一致：具体日期用「日」，农历 / 节假日前一天沿用 UI 名称，
// custom 用「每隔X天/周/月/年」。只依赖 repeat 对象本身，不读 DOM、不依赖任务日期，
// 保证任务列表 / 看板 / 四象限 / 各日历视图的提示完全一致。
const RECURRING_WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const RECURRING_UNIT_NAMES = { days: '天', weeks: '周', months: '月', years: '年' };

function getRecurringRuleName(r) {
    if (!r || !r.type) return '';
    const t = r.type;
    if (t === 'custom') {
        const interval = parsePositiveInt(r.interval);
        return interval > 0 ? '每隔' + interval + (RECURRING_UNIT_NAMES[r.unit] || '天') : '';
    }
    if (t === 'daily') return r.workdayOnly ? '每个工作日' : '每天';
    if (t === 'dailyWorkday') return '每个工作日'; // 旧模板形态
    if (t === 'weekly') {
        if (typeof r.dayOfWeek === 'number' && RECURRING_WEEKDAY_NAMES[r.dayOfWeek]) {
            return '每' + RECURRING_WEEKDAY_NAMES[r.dayOfWeek];
        }
        return '每周';
    }
    if (t === 'weeklyFirstWorkday') return '每周首个工作日';
    if (t === 'weeklyLastWorkday') return '工作周期最后一个工作日';
    if (t === 'monthly') {
        if (r.lunar) return '每月（农历）';
        const dayOfMonth = parsePositiveInt(r.dayOfMonth);
        return (dayOfMonth >= 1 && dayOfMonth <= 31) ? '每月' + dayOfMonth + '日' : '每月';
    }
    if (t === 'monthlyFirstWorkday') return '每月首个工作日';
    if (t === 'monthlyLastWorkday') return '每月最后一个工作日';
    if (t === 'yearly') {
        if (r.beforeHoliday) return '每个节假日前一天';
        if (r.lunar) return '每年（农历）';
        const month = parsePositiveInt(r.month);
        const day = parsePositiveInt(r.day);
        return (month >= 1 && month <= 12 && day >= 1 && day <= 31)
            ? '每年' + month + '月' + day + '日' : '每年';
    }
    if (t === 'yearlyBeforeHoliday') return '每个节假日前一天';
    return ''; // 未知类型：宁可省略类型名，也不要谎称「自定义重复」
}

// 重复规则短提示（用于行内标识的 title / aria-label）
// 格式：<类型名><按设定时间 | 按完成时间>重复，例如「每周五按设定时间重复」
function getRecurringRuleLabel(task) {
    const r = task && task.repeat;
    if (!r || !r.type) return '';
    const mode = r.repeatMode === 'completeTime' ? '按完成时间' : '按设定时间';
    return getRecurringRuleName(r) + mode + '重复';
}

// 未来预览行图标的 hover：规则一句话 + 「未来第 N 次」
// 序号取 _futureIndex（可见预览的次序），不要用 _occurrenceIndex —— 后者会把
// 生成时跳过的过期周期也计进去，导致第一条可见预览被显示成「第 11 次」。
function getRecurringGhostLabel(task) {
    const base = getRecurringRuleLabel(task);
    if (!base) return '';
    const n = parsePositiveInt(task && task._futureIndex);
    return n > 0 ? base + '（未来第 ' + n + ' 次）' : base;
}

// 预览行最左侧的重复图标（顶替勾选框位置）：只有这个图标带 hover，整行不带
function renderRecurringGhostIcon(task, extraClasses) {
    const label = getRecurringGhostLabel(task);
    const cls = 'fa-solid fa-repeat text-[10px]' + (extraClasses ? ' ' + extraClasses : '');
    return `<i class="${cls}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></i>`;
}

// 「预览」常驻标签：中性灰，不引入新颜色语义（与 renderRecurringTaskBadge 的约定一致）
const RECURRING_PREVIEW_BADGE = '<span class="flex-shrink-0 px-1 rounded border border-theme text-theme-muted" style="font-size:11px;line-height:1.3;">预览</span>';

// 预览行左侧色条：几何完全沿用 .task-list-color-bar（4px / left:0 / top,bottom:-1px），
// 只把实色填充换成竖向虚线渐变，保证粗细与位置和普通任务行一致。
// 不能设 background-color（会把虚线空隙填实），也不能用 border-left: dashed（会改盒模型）。
function recurringDashedBarStyle(color, solid, gap) {
    const c = color || '#9ca3af';
    const a = solid || 6;
    const b = gap || 4;
    return 'background-color:transparent;background-image:repeating-linear-gradient(to bottom,'
        + c + ' 0px,' + c + ' ' + a + 'px,transparent ' + a + 'px,transparent ' + (a + b) + 'px);';
}

// 任务行内的重复标识（只做轻量图标，不新增颜色语义）
function renderRecurringTaskBadge(task) {
    if (!task || !task.repeat || !task.repeat.type) return '';
    const label = getRecurringRuleLabel(task);
    return `<i class="fa-solid fa-repeat text-[10px] text-theme-muted flex-shrink-0 ml-1.5" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></i>`;
}

// 收集每条重复链路的锚点（取该系列中最晚的真实未完成实例）
function _collectRecurringAnchors(source) {
    const map = new Map();
    for (let i = 0; i < source.length; i++) {
        const t = source[i];
        if (!t || t._projected || t.completed || !t.repeat || !t.repeat.type || !t.startTime) continue;
        if (t.extSourceId) continue;
        if ((t.repeat.repeatMode || 'startTime') === 'completeTime') continue;
        const key = t.seriesId || t.id;
        const prev = map.get(key);
        if (!prev || new Date(t.startTime).getTime() > new Date(prev.startTime).getTime()) {
            map.set(key, t);
        }
    }
    return Array.from(map.values());
}

// 生成单个锚点的后续投影（严格镜像 createNextRepeatTask 的日期/时间推导）
function _buildRecurringGhosts(anchor) {
    if (!anchor || !anchor.startTime || !anchor.repeat || !anchor.repeat.type) return [];
    const repeatMode = anchor.repeat.repeatMode || 'startTime';
    if (repeatMode === 'completeTime') return [];

    const baseDate = new Date(anchor._originalStartTime || anchor.startTime);
    const bounds = getDateBounds();
    const todayKey = formatDate(bounds.todayStart);
    const rangeEnd = new Date(bounds.todayStart);
    rangeEnd.setDate(rangeEnd.getDate() + getRecurringRangeDays());
    const endKey = formatDate(rangeEnd);
    const endDiff = anchor.endTime
        ? new Date(anchor.endTime).getTime() - new Date(anchor.startTime).getTime()
        : null;

    const result = [];
    let cursor = anchor;
    // 最多探测 24 个周期，避免异常重复规则造成死循环；输出再截断到上限
    for (let i = 0; i < 24 && result.length < RECURRING_MAX_PER_SERIES; i++) {
        const nextDate = getNextRepeatOccurrence(cursor, { skipCatchUp: i > 0 });
        if (!nextDate) break;

        const next = new Date(nextDate);
        if (anchor.isAllDay) {
            next.setHours(0, 0, 0, 0);
        } else {
            next.setHours(baseDate.getHours(), baseDate.getMinutes(), 0, 0);
        }
        const dateKey = formatDate(next);
        if (dateKey > endKey) break;
        if (dateKey < todayKey) {
            cursor = Object.assign({}, anchor, { startTime: next.toISOString() });
            delete cursor._originalStartTime;
            continue;
        }

        const ghost = Object.assign({}, anchor, {
            id: RECURRING_GHOST_ID_PREFIX + anchor.id + ':' + (i + 1),
            completed: false,
            completedAt: null,
            progress: 0,
            subtasks: [],
            startTime: next.toISOString(),
            _projected: true,
            _projectedFrom: anchor.id,
            _seriesId: anchor.seriesId || anchor.id,
            _occurrenceIndex: (i + 1),
            _futureIndex: result.length + 1,
            _dateKey: dateKey
        });
        delete ghost._originalStartTime;
        if (endDiff !== null) {
            ghost.endTime = new Date(next.getTime() + endDiff).toISOString();
        }
        result.push(ghost);
        cursor = ghost;
    }
    return result;
}

function _recurringGhostCacheKey(view) {
    return [
        view,
        _recurringGhostRevision,
        getRecurringRangeKey(),
        isRecurringFutureEnabled(view) ? '1' : '0',
        currentListId || '',
        (currentTagIds || []).join(','),
        currentFilter || '',
        currentFilterId || '',
        new Date().toDateString()
    ].join('|');
}

// 某视图窗口内的投影日期索引：{ 'YYYY-MM-DD': ghost[] }
function getRecurringGhostMap(view) {
    if (!isRecurringFutureEnabled(view)) return {};
    if (currentListId === '__archived__') return {};

    const key = _recurringGhostCacheKey(view);
    if (_recurringGhostCache.key === key && _recurringGhostCache.map) return _recurringGhostCache.map;

    // 锚点不按日期型筛选（特殊时间筛选/自定义过滤器的时间范围）收集：
    // 窗口之外的未完成锚点仍可能产生落在窗口内的下一次实例
    // （如昨天未完成的每日任务 → 今天/明天），否则时间筛选视图会漏掉这些投影。
    // 投影生成后再复用 filterTasks 同一套条件过滤投影本身（清单/标签/时间窗/自定义条件/归档），
    // 保证投影与真实任务在各类筛选上下文中的可见性完全一致。
    const candidates = tasks.filter(t =>
        !t.deletedAt
        && !(typeof shouldHideExternalTasks === 'function' && shouldHideExternalTasks() && t.extSourceId)
    );
    const anchors = _collectRecurringAnchors(candidates);
    const ghostList = [];
    anchors.forEach(anchor => {
        _buildRecurringGhosts(anchor).forEach(ghost => ghostList.push(ghost));
    });
    const visible = (typeof filterTasks === 'function')
        ? filterTasks(ghostList, { includeCompleted: true })
        : ghostList;
    const map = Object.create(null);
    visible.forEach(ghost => {
        if (!map[ghost._dateKey]) map[ghost._dateKey] = [];
        map[ghost._dateKey].push(ghost);
    });
    _recurringGhostCache = { key, map };
    return map;
}

function getRecurringGhostsForDate(date, view) {
    const map = getRecurringGhostMap(view);
    const key = typeof date === 'string' ? date : formatDate(date);
    return map[key] || [];
}

// 日程视图分组以 Date#toDateString() 为键，这里统一转换后再合并
function mergeRecurringGhostsIntoGrouped(grouped, view) {
    if (!grouped || !isRecurringFutureEnabled(view)) return grouped;
    const map = getRecurringGhostMap(view);
    Object.keys(map).forEach(ymd => {
        const dateKey = new Date(ymd + 'T00:00:00').toDateString();
        if (!grouped[dateKey]) grouped[dateKey] = [];
        map[ymd].forEach(ghost => grouped[dateKey].push(ghost));
    });
    return grouped;
}

// 任务列表：投影以虚线任务行直接显示在对应日期分组内（信息与普通任务行一致，仅外框虚线）
function renderRecurringGhostTaskListHtml(task, useShortTime) {
    const listMap = (typeof _getListsByIdMap === 'function') ? _getListsByIdMap() : new Map();
    const list = listMap.get(task.listId);
    const listColor = list ? list.color : '#9ca3af';
    const listName = list ? list.name : '';
    const timeDisplay = useShortTime
        ? formatTaskListTimeShort(task)
        : formatTaskListTime(task, { withAllDayTag: false });
    const quadColors = getQuadrantColorClass(task);
    const tvcShowDetails = (typeof getTaskViewConfig === 'function') && getTaskViewConfig().showDetails;
    // 虚线外框用独立覆盖层绘制（不参与布局、不压住色条）：
    // 若直接给行加 border，绝对定位色条的包含块会变成 padding box 且边框可能覆盖色条边缘，
    // 导致色条与普通任务行的粗细/位置不一致；覆盖层 + 色条默认定位可保持完全一致
    return `
        <div class="task-list-item recurring-ghost-row relative flex items-center gap-3 py-2.5 px-3 rounded-r-lg ${quadColors.bg} hover:opacity-85 transition cursor-pointer"
             onclick="event.stopPropagation(); openRecurringGhostPreview('${task._projectedFrom}')">
            <div class="absolute inset-0 rounded-r-lg border border-dashed border-theme pointer-events-none" aria-hidden="true"></div>
            <div class="task-list-color-bar" style="${recurringDashedBarStyle(getTaskBarColor(task, listColor))}"></div>
            <span class="w-5 h-5 flex items-center justify-center flex-shrink-0 text-theme-muted">${renderRecurringGhostIcon(task)}</span>
            <div class="flex-1 min-w-0 flex flex-col">
                <span class="${tvcShowDetails ? 'font-medium' : 'text-sm'} text-theme-primary truncate min-w-0">${escapeHtml(task.title || '新任务')}</span>
                ${tvcShowDetails && typeof renderTaskDetailsBlock === 'function' ? `<div>${renderTaskDetailsBlock(task)}</div>` : ''}
            </div>
            <div class="flex items-center gap-2 flex-shrink-0 text-xs text-theme-primary whitespace-nowrap">
                ${RECURRING_PREVIEW_BADGE}
                ${typeof renderAttachmentBadge === 'function' ? renderAttachmentBadge(task) : ''}
                ${typeof renderTagCapsules === 'function' ? renderTagCapsules(task, 2, 'right') : ''}
                ${listName ? `<span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background-color: ${listColor}"></span><span class="hidden sm:inline">${escapeHtml(listName)}</span></span>` : ''}
            </div>
            ${timeDisplay ? `<span class="flex-shrink-0 text-xs text-theme-primary whitespace-nowrap" style="min-width: 50px; text-align: right;"><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
        </div>`;
}

// 点击投影：打开当前真实实例（不提供编辑投影的入口）
function openRecurringGhostPreview(anchorId) {
    const anchor = tasks.find(t => t.id === anchorId);
    if (!anchor) {
        showToast('该重复任务的当前实例已不存在', 'error');
        return;
    }
    openTaskDetailPanel(anchor.id, false, true);
}

// 日程视图 / 月视图单天详情中的只读投影卡片：沿用日程任务卡片结构（时间/清单/标签/标题），
// 仅把卡片外框改为虚线只读样式；opts.simple 用于移动端月视图的紧凑行，保持与其相邻行一致
function renderRecurringGhostScheduleHtml(task, timeDisplay, opts) {
    const listMap = (typeof _getListsByIdMap === 'function') ? _getListsByIdMap() : new Map();
    const list = listMap.get(task.listId);
    const listColor = list ? list.color : '#9ca3af';
    const listName = list ? list.name : '';
    const tagCapsules = (typeof renderTagCapsules === 'function') ? renderTagCapsules(task, 2, 'right') : '';
    if (opts && opts.simple) {
        return `<div class="recurring-ghost-row task-row flex items-center gap-2 py-2.5 border-b border-theme/50 last:border-b-0 cursor-pointer"
                    onclick="event.stopPropagation(); openRecurringGhostPreview('${task._projectedFrom}')">
            <span class="flex-shrink-0 w-1 h-4 rounded-full" style="${recurringDashedBarStyle(listColor, 3, 2)}"></span>
            <span class="flex-shrink-0 text-theme-muted">${renderRecurringGhostIcon(task)}</span>
            <span class="flex-1 min-w-0 truncate text-sm text-theme-primary" title="${escapeHtml(task.title || '新任务')}">${escapeHtml(task.title || '新任务')}</span>
            ${RECURRING_PREVIEW_BADGE}
            ${timeDisplay ? `<span class="flex-shrink-0 text-xs text-theme-muted">${timeDisplay}</span>` : ''}
        </div>`;
    }
    const quadColors = getQuadrantColorClass(task);
    const barColor = getTaskBarColor(task, listColor);
    return `<div class="schedule-task-item task-row group flex items-start gap-4 mb-2.5 task-item recurring-ghost-row cursor-pointer"
                onclick="event.stopPropagation(); openRecurringGhostPreview('${task._projectedFrom}')">
        <div class="w-8 flex-shrink-0 flex flex-col items-center self-stretch relative">
            <span class="w-5 h-5 flex items-center justify-center text-theme-muted">${renderRecurringGhostIcon(task)}</span>
        </div>
        <div class="${quadColors.bg} rounded-r-lg p-2.5 flex-1 schedule-task-card border border-dashed border-theme" style="border-left: 4px dashed ${barColor}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
            <div class="flex items-center gap-2 text-sm mb-1 text-theme-secondary flex-wrap">
                ${RECURRING_PREVIEW_BADGE}
                ${timeDisplay ? `<span>${timeDisplay}</span>` : ''}
                ${listName ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${listColor}"></span>${escapeHtml(listName)}</span>` : ''}
                ${tagCapsules}
            </div>
            <div class="font-medium text-theme-primary">${escapeHtml(task.title || '新任务')}</div>
            ${(typeof getScheduleConfig === 'function' && getScheduleConfig().showDetails !== false && typeof renderTaskDetailsBlock === 'function') ? renderTaskDetailsBlock(task) : ''}
        </div>
    </div>`;
}

// 月视图网格中的只读投影条目（沿用普通月任务条的时间显示，仅外框虚线）
function renderRecurringGhostMonthItemHtml(task, timeStr) {
    const listMap = (typeof _getListsByIdMap === 'function') ? _getListsByIdMap() : new Map();
    const list = listMap.get(task.listId);
    const listColor = list ? list.color : '#9ca3af';
    return `<div class="recurring-ghost-row text-xs p-1 rounded-r truncate month-task-item flex items-center justify-between gap-1 border border-dashed border-theme text-theme-primary cursor-pointer"
                style="background-color: ${listColor}15; border-left: 2px dashed ${listColor};"
                onclick="event.stopPropagation(); openRecurringGhostPreview('${task._projectedFrom}')">
            <span class="flex items-center gap-1 min-w-0 flex-1">
                ${renderRecurringGhostIcon(task, 'text-theme-muted flex-shrink-0')}
                <span class="truncate">${escapeHtml(task.title || '新任务')}</span>
            </span>
            ${timeStr ? `<span class="flex-shrink-0 text-theme-muted">${timeStr}</span>` : ''}
        </div>`;
}

// 周视图全天区中的只读投影条目（沿用普通全天条底色与信息，仅外框虚线）
function renderRecurringGhostWeekAllDayHtml(task) {
    const listMap = (typeof _getListsByIdMap === 'function') ? _getListsByIdMap() : new Map();
    const list = listMap.get(task.listId);
    const listColor = list ? list.color : '#9ca3af';
    return `<div class="recurring-ghost-row text-xs px-1 py-0.5 rounded-r cursor-pointer week-allday-task relative text-theme-primary flex items-center gap-1 min-w-0 border border-dashed border-theme"
                style="background-color: ${listColor}20; border-left: 2px dashed ${listColor};"
                onclick="event.stopPropagation(); openRecurringGhostPreview('${task._projectedFrom}')">
            ${renderRecurringGhostIcon(task, 'text-theme-muted flex-shrink-0')}
            <span class="week-fit-title truncate flex-1 min-w-0">${escapeHtml(task.title || '新任务')}</span>
        </div>`;
}
