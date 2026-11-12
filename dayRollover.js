// ==================== 跨天刷新（统一 Day Rollover Watcher） ====================
// 背景：分组桶 / 「今天」高亮 / 相对时间词都按 getDateBounds() 或 new Date() 计算，
// 但 renderView() 只由用户交互、数据写入、视图切换、服务端版本变化触发。锁屏过夜时
// 数据没变，refreshDataFromServer() 会因 _version 未变提前 return，已渲染的 DOM
// 就一直停在昨天。各视图的日期缓存签名其实都含「今天」，缺的只是「重绘」这个动作。
//
// 本模块只负责发现日期变化并驱动一次静默重绘，不改任何视图的渲染逻辑。
// 五路触发信号共用同一个 checkDayRollover()：30s 轮询、visibilitychange、window focus、
// pageshow、refreshDataFromServer 通道。每个信号都只做一次 getTodayKey() 字符串比对
// （常量级开销），只有日期真的变化才执行重绘，且一天最多一次；重绘走 requestIdleCallback
// 让出唤醒瞬间的主线程，因此多路信号在低性能设备上也不会叠加出可感知的开销。
//
// 参考：countdown.js 的「30s 轮询 + 回前台补查」跨天观察模式，以及 calendarViews.js
// _bindWeekNowLineVisibility 的单例守卫（init() 会被导入数据重复调用）。

const DAY_ROLLOVER_CHECK_MS = 30 * 1000;
const DAY_ROLLOVER_EVENT = 'tacklist:daychange';

let _drLastDayKey = null;
let _drLastTodayStartMs = 0;
let _drWatchStarted = false;
let _drPending = false;
let _drRenderScheduled = false;
let _drApplying = false;

function _drTodayStartMs() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

// 「今天」的日期键由 utils.js:getTodayKey() 统一提供（与 getDateBounds()._sig 同源）
function _drKey() {
    return (typeof getTodayKey === 'function') ? getTodayKey() : new Date().toDateString();
}

// 是否处于「重绘会破坏用户上下文」的状态。
// 详情面板是 #view-container 之外的 in-flow 兄弟节点，重绘主区不会动它，故不单独设卡点；
// 只有焦点落在主区自己的输入控件、保存请求在途、拖拽中、批量多选时才延后。
function _drIsBusy() {
    if (typeof _saveInFlight !== 'undefined' && _saveInFlight) return true;
    if (typeof isBatchSelectActive === 'function' && isBatchSelectActive()) return true;
    if (typeof draggedTaskId !== 'undefined' && draggedTaskId) return true;
    if (typeof _draggedKanbanCol !== 'undefined' && _draggedKanbanCol) return true;
    const ae = document.activeElement;
    if (ae) {
        const tag = ae.tagName;
        const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable;
        const vc = document.getElementById('view-container');
        if (editing && vc && vc.contains(ae)) return true;
    }
    return false;
}

// 跨天后修正全局翻页锚点 currentDate（utils.js 顶层，原本是页面加载时固定的 Date）。
// · 周视图：按需求自动跳回本周 → 无条件回到今天。
// · 其它视图：锚点原本就等于「旧今天」时推进到新今天；用户主动翻过页（月视图翻月、
//   快速跳转面板选过日期）则保留位置，避免静默刷新打断上下文。
function _drShiftAnchor(prevTodayStartMs) {
    // 不用 instanceof Date：跨 realm（iframe / 测试沙箱）的 Date 实例会误判，
    // 用能力检测更稳。
    if (typeof currentDate === 'undefined' || !currentDate
        || typeof currentDate.getFullYear !== 'function'
        || typeof currentDate.getDate !== 'function') return;
    const now = new Date();
    if (typeof currentView !== 'undefined' && currentView === 'week') {
        currentDate = now;
        return;
    }
    const anchorDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime();
    if (anchorDay === prevTodayStartMs) currentDate = now;
}

// 日期相关缓存的签名本就含「今天」，重算时天然失效；显式失效用于清掉持有旧引用的
// 派生缓存（重复任务投影、周窗口聚合、日程分组），并顺带让 _dateBoundsCache 按新日期重建。
function _drInvalidateDateCaches() {
    if (typeof invalidateTaskListGroupsCache === 'function') invalidateTaskListGroupsCache();
    if (typeof invalidateScheduleFilterCache === 'function') invalidateScheduleFilterCache();
    if (typeof invalidateWeekViewCache === 'function') invalidateWeekViewCache();
    if (typeof invalidateRecurringGhostCache === 'function') invalidateRecurringGhostCache();
    if (typeof getDateBounds === 'function') getDateBounds();
}

function _drScheduleRender() {
    if (_drRenderScheduled) return;
    _drRenderScheduled = true;
    const run = function () {
        _drRenderScheduled = false;
        if (_drIsBusy()) { _drPending = true; return; }
        _drPending = false;
        try {
            // 各视图内部已自带滚动位置 / 折叠态 / 多选态恢复（taskListView.js:1107、
            // :1886、calendarViews.js:863、kanbanView.js:624 等），直接重绘即可。
            if (typeof renderView === 'function') renderView();
        } catch (err) {
            console.error('[dayRollover] renderView failed:', err);
        }
    };
    // 唤醒瞬间常与 refreshDataFromServer / syncPomodoroFromServer 同拍，空闲时再重绘；
    // 不支持 requestIdleCallback 的浏览器退化为下一轮宏任务。
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1200 });
    else setTimeout(run, 0);
}

function flushPendingDayRollover() {
    if (!_drPending) return;
    if (_drIsBusy()) return;
    _drScheduleRender();
}

function _drApply(fromKey, toKey, prevTodayStartMs, opts) {
    if (_drApplying) return;
    _drApplying = true;
    try {
        _drShiftAnchor(prevTodayStartMs);
        _drInvalidateDateCaches();
        // 各模块自行订阅：侧边栏固定项计数、彩蛋当日状态、四象限停滞提醒。
        // 事件在重绘前派发，订阅者拿到的已是新的日期上下文。
        document.dispatchEvent(new CustomEvent(DAY_ROLLOVER_EVENT, {
            detail: { from: fromKey, to: toKey }
        }));
        if (!(opts && opts.render === false)) {
            if (_drIsBusy()) _drPending = true;
            else _drScheduleRender();
        }
    } finally {
        _drApplying = false;
    }
}

// 返回本次是否检测到跨天。opts.render === false 用于 renderView() 开头的上下文同步：
// 仍推进日期状态与派发事件，但当前正在重绘，不再触发第二次重绘。
function checkDayRollover(opts) {
    const key = _drKey();
    if (_drLastDayKey === null) {
        _drLastDayKey = key;
        _drLastTodayStartMs = _drTodayStartMs();
        return false;
    }
    if (key === _drLastDayKey) {
        // 同一天内：若有因「编辑/保存中」被延后的刷新，条件一满足就补上（最多每 30s 试一次）
        if (_drPending && !(opts && opts.render === false)) flushPendingDayRollover();
        return false;
    }
    // 后台不可见时不吞掉变化（不更新 baseline），留到回前台 / 唤醒后再处理，
    // 避免在用户看不见的时候做全量重绘。
    if (document.hidden && !(opts && opts.force)) return false;
    const fromKey = _drLastDayKey;
    const prevTodayStartMs = _drLastTodayStartMs;
    _drLastDayKey = key;
    _drLastTodayStartMs = _drTodayStartMs();
    _drApply(fromKey, key, prevTodayStartMs, opts);
    return true;
}

// renderView() 开头调用：若用户交互先于 watcher 触发了重绘，也要对齐「今天」上下文。
function syncRenderDayContext() {
    if (_drApplying) return;
    checkDayRollover({ render: false });
}

function startDayRolloverWatch() {
    // init() 会被导入数据重复调用，监听器与定时器只注册一次
    if (_drWatchStarted) return;
    _drWatchStarted = true;
    checkDayRollover();
    setInterval(function () { checkDayRollover(); }, DAY_ROLLOVER_CHECK_MS);
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) checkDayRollover();
    });
    window.addEventListener('focus', function () { checkDayRollover(); });
    window.addEventListener('pageshow', function () { checkDayRollover(); });
}
