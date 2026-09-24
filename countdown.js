// ==================== 倒计时管理（自定义倒计时 / 侧边栏 Pin） ====================
// 入口：点击侧边栏"节假日倒计时"区域 → switchView('countdown') → 本视图
// 与"设置节假日与调休"(holiday.js) 相互独立；管理页风格参考 holiday.js 统一化处理

// 状态变量（与 holiday.js 的编辑/删除二次确认模式一致）
let countdownEditing = null;            // { isAdd:true, id:null } | { isAdd:false, id }
let countdownDeleteConfirming = null;   // 正在二次确认的自定义倒计时 id
let countdownDeleteTimer = null;

// 系统默认项的固定 key
const COUNTDOWN_AUTO_KEY = '__auto_holiday__';
const COUNTDOWN_MAX_PIN = 2;
// 「当天」放大名称布局的字数上限。双栏单列可用宽仅 98px，1.75rem 衬线下
// 3 个汉字 ≈ 87.4px 刚好容纳，第 4 个字起必然换行 → 名称统一截断到 3 字。
// ⚠️ 不能改成「前 3 字 + 省略号」：CJK 的「…」是全角，4 字宽 ≈ 116px 会撑破双栏。
// 系统假期名已核实全部 ≤3 字（元旦/春节/清明节/劳动节/端午节/中秋节/国庆节），
// 故只对自定义倒计时名做截断；外部抓取的假期名不在保证范围内（见 CD 复核记录）。
const COUNTDOWN_TODAY_NAME_MAX = 3;
// 系统假期连休段含多个节日名（如「国庆节·中秋节」）时改为交替展示，间隔与淡入淡出时长
const COUNTDOWN_NAME_CYCLE_MS = 30000;
const COUNTDOWN_NAME_SWAP_MS = 420;
let cdNameCycleTimer = null;

// ---------------------------------------------------------------- 计算工具

function parseYmd(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    const dt = new Date(y, m - 1, d);
    // 校验真实存在（排除 2 月 30 日等非法日期）
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
}

// 计算距离目标日期的剩余天数（每天 0 点对齐）
// repeat==='yearly'：取今年/明年最近的该月日；repeat==='once'：固定日期，过期返回负数
function getCountdownDays(dateStr, repeat) {
    const dt = parseYmd(dateStr);
    if (!dt) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (repeat === 'yearly') {
        const y = today.getFullYear();
        let target = new Date(y, dt.getMonth(), dt.getDate());
        if (target < today) {
            target = new Date(y + 1, dt.getMonth(), dt.getDate());
        }
        return Math.round((target - today) / 86400000);
    }
    return Math.round((dt - today) / 86400000);
}

// 获取「进行中 / 下一个」法定节假日（复刻原 updateHolidayCountdown 的聚合逻辑）
// 天数口径：days = 假期首日 − 今天（真实相差天数，不再做 "−1 / +1" 偏移）
//
// 2026-09-25 约定：假期进行中（首日 ≤ 今天 ≤ 末日）**持续展示本假期**，不走倒计时——
//   - 假期名沿用「今天」放大名称布局，第二行显示假期持续区间（如「10月1日 - 10月8日」）；
//   - 连休段内的节日当天（按 holiday_data.json 当天映射名，如 2025-10-05 = 中秋节）
//     只静态显示该节日名，不参与交替；
//   - 其余天在段内各节日名之间交替展示（如国庆中秋连休轮换「国庆节 / 中秋节」）；
//   - 假期结束（次日起）才让位给下一个假期，恢复「N 天后」倒计时。
// 未来假期的 days = 假期首日 − 今天；首日当天即视为进行中（days = 0）。
//
// 基准日 = **连续放假段的第一天**（不看节日名）：节日当天常落在假期第 2、3 天
// （如 2026 春节假期 2/15 起、正月初一在 2/17），倒计时应以假期首日为基准。
// 一段连休里出现多个节日名时（如 2025 国庆中秋连休 10/1-10/8 内含中秋 10/5），
// 段名按日期顺序并列显示为「国庆节·中秋节」，基准日仍是该段首日。
function getNextHoliday() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const currentYear = now.getFullYear().toString();
    const nextYear = (now.getFullYear() + 1).toString();

    const runs = [];

    function collect(yearStr, yearData) {
        if (!yearData || !yearData.holidays) return;
        const holidays = yearData.holidays;
        const sortedDates = Object.keys(holidays).sort();
        let i = 0;
        while (i < sortedDates.length) {
            const runDates = [sortedDates[i]];
            const names = [holidays[sortedDates[i]]];
            let j = i + 1;
            while (j < sortedDates.length) {
                const prevDate = new Date(parseInt(yearStr), parseInt(sortedDates[j - 1].split('-')[0]) - 1, parseInt(sortedDates[j - 1].split('-')[1]));
                const currDate = new Date(parseInt(yearStr), parseInt(sortedDates[j].split('-')[0]) - 1, parseInt(sortedDates[j].split('-')[1]));
                if (Math.round((currDate - prevDate) / 86400000) !== 1) break;
                runDates.push(sortedDates[j]);
                const nm = holidays[sortedDates[j]];
                if (names.indexOf(nm) < 0) names.push(nm);
                j++;
            }
            const lastParts = runDates[runDates.length - 1].split('-');
            // 短假（1~2 天）同样参与评选；同名假期跨年各成一段，不做同名去重
            runs.push({
                name: names.join('·'),
                names: names.slice(),   // 各节日名单独保留，供交替展示
                dates: runDates.slice(),                    // 段内各日期（MM-DD），供「节日当天」判定
                dateNames: runDates.map(d => holidays[d]),  // 各日期原始映射名（未去重）
                startDate: new Date(parseInt(yearStr), parseInt(runDates[0].split('-')[0]) - 1, parseInt(runDates[0].split('-')[1])),
                endDate: new Date(parseInt(yearStr), parseInt(lastParts[0]) - 1, parseInt(lastParts[1])),
                count: runDates.length
            });
            i = j;
        }
    }

    collect(currentYear, holidayData[currentYear]);
    collect(nextYear, holidayData[nextYear]);

    const _md = d => (d.getMonth() + 1) + '月' + d.getDate() + '日';
    const pad2 = n => String(n).padStart(2, '0');

    // 1) 假期进行中：优先于一切未来假期（假期结束次日起才让位）
    for (const run of runs) {
        if (now >= run.startDate && now <= run.endDate) {
            // 当天映射名（MM-DD 须补零对齐 holidayData 的键格式）
            const todayKey = pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
            const idx = run.dates.indexOf(todayKey);
            const todayName = idx >= 0 ? run.dateNames[idx] : null;
            return {
                name: todayName || run.name,
                // 节日当天只留一个名字 → cdNameHtml 走静态路径；其余天整段名字交替展示
                names: todayName ? [todayName] : run.names,
                startDate: run.startDate,
                endDate: run.endDate,
                days: 0,        // 走「今天」放大名称布局，假期期间持续显示假期名
                ongoing: true,
                dateLabel: _md(run.startDate) + ' - ' + _md(run.endDate)
            };
        }
    }

    // 2) 无进行中假期：最近的未来假期倒计时
    let nextHoliday = null;
    let minDiff = Infinity;
    for (const run of runs) {
        const diff = Math.round((run.startDate - now) / 86400000);
        // 首日当天已被上面的进行中分支命中，这里只会命中 diff > 0；
        // 保留 >= 0 兜底（数据异常导致进行中判定漏掉时，首日当天仍可显示）
        if (diff >= 0 && diff < minDiff) {
            minDiff = diff;
            nextHoliday = { name: run.name, names: run.names, startDate: run.startDate, endDate: run.endDate, days: diff, ongoing: false, dateLabel: _md(run.startDate) + '起' };
        }
    }
    return nextHoliday;
}

// 解析某个固定 key 对应的侧边栏展示项
function resolveCountdownItem(key) {
    if (key === COUNTDOWN_AUTO_KEY) {
        const nh = getNextHoliday();
        if (!nh) return null;
        return {
            key: key,
            isHoliday: true,
            name: nh.name,
            names: nh.names,        // 多节日名时供交替展示（节日当天只含一个名字 → 静态）
            days: nh.days,
            ongoing: nh.ongoing,    // 假期进行中（days=0 放大名称布局 + 区间文案）
            dateLabel: nh.dateLabel // 未来「X月X日起」；进行中「X月X日 - X月X日」
        };
    }
    const cd = (settings.countdowns || []).find(c => c.id === key);
    if (!cd) return null;
    const days = getCountdownDays(cd.date, cd.repeat);
    const dt = parseYmd(cd.date);
    const dateLabel = dt ? (dt.getMonth() + 1) + '月' + dt.getDate() + '日' : '';
    return { key: key, isHoliday: false, name: cd.name, days: days, dateLabel: dateLabel };
}

// ---------------------------------------------------------------- 侧边栏展示

// 中间数字行 HTML（含 data-days 供临近色判断）
// 天数口径：显示值 = 真实相差天数（明天 = "1天后"；当天/假期进行中 = 0，走放大名称布局，无数字行）
function cdDaysHtml(days) {
    if (days === null || days === undefined) return '';
    if (days < 0) {
        // 已过期：显示已过天数（同样用真实相差天数，不再 +1）
        return '<span class="holiday-countdown-unit">已过</span>' +
            '<span class="holiday-countdown-number">' + (-days) + '</span>' +
            '<span class="holiday-countdown-unit">天</span>';
    }
    if (days === 0) {
        // 今天：不渲染数字行，由 cdItemInner 改用放大名称布局
        return '';
    }
    // 未来：数字即真实剩余天数，data-days 与显示值一致（临近高亮与数字同档）
    return '<span class="holiday-countdown-number" data-days="' + days + '">' + days + '</span><span class="holiday-countdown-unit">天后</span>';
}

// 名称行 HTML。
// 系统假期连休段可能含多个节日名（如「国庆节·中秋节」），合并成一个长名称既易被裁切、
// 也撑高双栏布局；改为交替展示：外层带 .cd-name-cycle，内层 .cd-name-cycle-text 由定时器轮换。
// nameOverride：仅「当天」布局使用，传入已截断的名称（见 cdItemInner）。
function cdNameHtml(item, baseCls, nameOverride) {
    const names = (item.names && item.names.length > 1) ? item.names : null;
    if (!names) {
        const text = (nameOverride === undefined || nameOverride === null) ? item.name : nameOverride;
        return '<div class="' + baseCls + '">' + escapeHtml(text) + '</div>';
    }
    return '<div class="' + baseCls + ' cd-name-cycle" data-cd-names="' +
        escapeHtml(JSON.stringify(names)) + '"><span class="cd-name-cycle-text">' +
        escapeHtml(names[0]) + '</span></div>';
}

// 单个展示项的内部 HTML（侧边栏 / 固定槽 / 卡片池共用）
// todayNameMax：仅对「当天」放大名称生效的字数上限。
//   侧边栏与固定槽传 COUNTDOWN_TODAY_NAME_MAX（固定槽即侧边栏预览，须一致）；
//   卡片池不传（卡片可用宽 195.2px，够放下完整名称，截断只会丢信息）。
function cdItemInner(item, todayNameMax) {
    if (item.days === 0) {
        // 今天 / 假期进行中：放大名称（与数字相同的衬线字体）占据原名称+数字两行，
        // 第二行显示日期行——节日当天「X月X日起」，假期进行中为持续区间「X月X日 - X月X日」
        let nm = item.name;
        if (!item.isHoliday && todayNameMax && nm && nm.length > todayNameMax) {
            nm = nm.slice(0, todayNameMax);
        }
        return cdNameHtml(item, 'holiday-countdown-name-today', nm) +
            '<div class="holiday-countdown-date">' + escapeHtml(item.dateLabel) + '</div>';
    }
    return cdNameHtml(item, 'holiday-countdown-label') +
        '<div>' + cdDaysHtml(item.days) + '</div>' +
        '<div class="holiday-countdown-date">' + escapeHtml(item.dateLabel) + '</div>';
}

function cdCycleNames(host) {
    try {
        const n = JSON.parse(host.getAttribute('data-cd-names') || '[]');
        return Array.isArray(n) ? n : [];
    } catch (e) {
        return [];
    }
}

// 启动名称交替（每 COUNTDOWN_NAME_CYCLE_MS 切换一次：淡出 → 换字 → 淡入）。
// 每次重渲染后都要调用：先清掉旧定时器，再按当前 DOM 重新收集轮换宿主，避免多定时器叠加。
function startCountdownNameCycle(root) {
    if (cdNameCycleTimer) { clearInterval(cdNameCycleTimer); cdNameCycleTimer = null; }
    const active = Array.from((root || document).querySelectorAll('.cd-name-cycle'))
        .filter(h => cdCycleNames(h).length > 1 && h.querySelector('.cd-name-cycle-text'));
    if (!active.length) return;
    let idx = 0;
    cdNameCycleTimer = setInterval(() => {
        idx += 1;
        active.forEach(h => {
            const names = cdCycleNames(h);
            if (names.length < 2) return;
            const t = h.querySelector('.cd-name-cycle-text');
            if (!t) return;
            const next = names[idx % names.length];
            t.classList.add('is-swapping');
            setTimeout(() => {
                if (!t.isConnected) return;   // 期间被重渲染掉了，放弃这次换字
                t.textContent = next;
                t.classList.remove('is-swapping');
            }, COUNTDOWN_NAME_SWAP_MS);
        });
    }, COUNTDOWN_NAME_CYCLE_MS);
}

// 临近色（临近假期时数字渐变：蓝 → 青 → 绿，更契合假期意味；用户 2026-09-25 指定）
// 仅作用于未来倒计时数字（data-days ≥ 1）；当天/假期进行中无数字行，不着色
function applyCountdownWarmth() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('#holiday-countdown .holiday-countdown-number[data-days], .cd-slot .holiday-countdown-number[data-days], .cd-card .holiday-countdown-number[data-days]').forEach(el => {
        const days = parseInt(el.getAttribute('data-days'), 10);
        if (days === 3) el.style.color = isDark ? '#64B5F6' : '#1E88E5';    // 3 天：蓝
        else if (days === 2) el.style.color = isDark ? '#4DD0E1' : '#00ACC1'; // 2 天：青
        else if (days === 1) el.style.color = isDark ? '#66BB6A' : '#43A047'; // 1 天：绿
        else el.style.color = '';
    });
}

// 渲染侧边栏倒计区块（替代原 updateHolidayCountdown 的纯展示职责）
function renderSidebarCountdown() {
    const box = document.getElementById('holiday-countdown');
    if (!box) return;
    // 记下本次渲染所依据的日期，供跨天轮询比对（见 checkCountdownDayRollover）
    cdRenderedDayKey = cdDayKey();

    const pinned = (settings.pinnedCountdowns || []).slice();
    const items = [];
    for (const key of pinned) {
        const it = resolveCountdownItem(key);
        if (it) items.push(it);
    }

    if (items.length === 0) {
        // 未固定任何项：保留默认"下一个节假日"居中展示（向后兼容）
        // 走 cdItemInner 以便 days === 0（假期首日）时同样用放大名称布局，而不是留下空数字行
        const auto = resolveCountdownItem(COUNTDOWN_AUTO_KEY);
        if (!auto) {
            box.innerHTML = '<div class="holiday-countdown-label">暂无假期信息</div><div><span class="holiday-countdown-number">-</span></div>';
            startCountdownNameCycle();   // 清掉可能残留的轮换定时器
            return;
        }
        box.innerHTML = cdItemInner(auto, COUNTDOWN_TODAY_NAME_MAX);
    } else if (items.length === 1) {
        box.innerHTML = cdItemInner(items[0], COUNTDOWN_TODAY_NAME_MAX);
    } else {
        // 最多 2 个：左右展示，中间虚线分割
        box.innerHTML =
            '<div class="cd-dual">' +
            '<div class="cd-dual-item">' + cdItemInner(items[0], COUNTDOWN_TODAY_NAME_MAX) + '</div>' +
            '<div class="cd-divider"></div>' +
            '<div class="cd-dual-item">' + cdItemInner(items[1], COUNTDOWN_TODAY_NAME_MAX) + '</div>' +
            '</div>';
    }
    applyCountdownWarmth();
    startCountdownNameCycle();
}

// ---------------------------------------------------------------- 跨天自动刷新

// days 只在重渲染时重算，而本模块此前只在「初始化 / 抓取节假日 / Pin 开关 / 增删改」
// 时重渲染 —— 页面挂着过夜会让「N 天后」一直停在昨天的值（30s 数据轮询不覆盖此块）。
// 这里做轻量轮询：30s 比一次日期字符串，变更即重渲染侧边栏；管理页开着也一并刷新。
let cdRenderedDayKey = null;

function cdDayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function checkCountdownDayRollover() {
    const key = cdDayKey();
    if (cdRenderedDayKey === null) { cdRenderedDayKey = key; return; }
    if (key === cdRenderedDayKey) return;
    cdRenderedDayKey = key;
    renderSidebarCountdown();
    if (typeof currentView !== 'undefined' && currentView === 'countdown') {
        renderCountdownView(document.getElementById('view-container'));
    }
}

// 后台标签页的 setInterval 会被节流，故回前台时再补一次检查。
// ⚠️ 刻意不做顶层副作用：tmp/test_countdown_days.js 会把本文件前半段放进
//    无 DOM 的沙箱里 new Function 求值，顶层碰 document / setInterval 会直接抛错，
//    在 Node 里 setInterval 还会挂住进程。故由 app.js:init() 显式调用本函数启动。
let cdDayRolloverWatching = false;

function startCountdownDayRolloverWatch() {
    if (cdDayRolloverWatching) return;
    cdDayRolloverWatching = true;
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkCountdownDayRollover();
    });
    setInterval(checkCountdownDayRollover, 30000);
}

// ---------------------------------------------------------------- Pin 开关

function toggleCountdownPin(key) {
    if (!settings.pinnedCountdowns) settings.pinnedCountdowns = [];
    const pinned = settings.pinnedCountdowns;
    const idx = pinned.indexOf(key);
    if (idx >= 0) {
        pinned.splice(idx, 1);
    } else {
        if (pinned.length >= COUNTDOWN_MAX_PIN) {
            showToast('最多只能在侧边栏展示2个倒计时信息', 'warning');
            return;
        }
        pinned.push(key);
    }
    saveData();
    renderCountdownView(document.getElementById('view-container'));
    renderSidebarCountdown();
}

// ---------------------------------------------------------------- 管理页渲染

function renderCountdownView(container) {
    if (!container) return;

    container.innerHTML =
        '<div class="countdown-container">' +
            (typeof isMobileView === 'function' && isMobileView()
                ? '<div class="flex items-center justify-between px-4 py-3 border-b border-theme/30 flex-shrink-0">' +
                      '<h1 class="text-lg font-bold text-theme-primary">倒计时</h1>' +
                      '<button onclick="switchView(\'task\')" class="w-9 h-9 rounded-full border-2 border-theme text-theme-secondary flex items-center justify-center hover:bg-theme-tertiary transition" title="返回"><i class="fas fa-arrow-left"></i></button>' +
                  '</div>'
                : '<div class="flex items-center p-4 pb-2 flex-shrink-0">' +
                      '<h1 class="text-2xl font-bold text-theme-primary">倒计时</h1>' +
                  '</div>'
            ) +
            '<div class="px-4 pb-6 space-y-6">' +

                // 顶部：两个固定槽（槽位即侧边栏预览，全宽并排）
                '<section>' +
                    '<h2 class="text-sm font-semibold text-theme-secondary mb-2">侧边栏展示</h2>' +
                    '<div class="cd-slots">' +
                        renderSlotHtml(0) +
                        renderSlotHtml(1) +
                    '</div>' +
                '</section>' +

                // 全部倒计时：拆分为「未来」与「过去」两个分组
                (function () {
                    const allItems = buildPoolItems();
                    const future = [];
                    const past = [];
                    allItems.forEach(it => {
                        // 系统默认 / 每年重复 → 未来；仅一次且日期过去 → 过去
                        const isPast = !it.isHoliday && it.repeat === 'once' && it.days < 0;
                        (isPast ? past : future).push(it);
                    });
                    const isAdding = !!(countdownEditing && countdownEditing.isAdd);
                    const total = allItems.length;

                    const futureHint = (future.length === 0 && !isAdding)
                        ? '<div class="text-center text-theme-muted py-4 text-sm col-span-full">' +
                          (total === 0 ? '暂无倒计时，点击下方“+”添加' : '暂无未来的倒计时') + '</div>'
                        : '';

                    const futureSection =
                        '<section>' +
                            '<h2 class="text-sm font-semibold text-theme-secondary mb-2">未来</h2>' +
                            '<div id="cd-pool-future" class="cd-grid" ondragover="cdAllowDrop(event)" ondragleave="cdDragLeave(event)" ondrop="cdDropOnPool(event)">' +
                                renderPoolInner(future, true) + futureHint +
                            '</div>' +
                        '</section>';

                    // “过去”分组仅在存在卡片时显示（无卡片则不显示标题栏）
                    const pastSection = (past.length > 0)
                        ? '<section>' +
                            '<h2 class="text-sm font-semibold text-theme-secondary mb-2">过去</h2>' +
                            '<div id="cd-pool-past" class="cd-grid" ondragover="cdAllowDrop(event)" ondragleave="cdDragLeave(event)" ondrop="cdDropOnPool(event)">' +
                                renderPoolInner(past, false) +
                            '</div>' +
                          '</section>'
                        : '';

                    return futureSection + pastSection;
                })() +

            '</div>' +
        '</div>';

    applyCountdownWarmth();
    startCountdownNameCycle();

    setTimeout(() => {
        const nameInput = document.getElementById('cd-edit-name');
        if (nameInput) nameInput.focus();
    }, 50);
}

// 顶部固定槽渲染（每个槽即侧边栏预览框，全宽并排）
function renderSlotHtml(index) {
    const pinned = settings.pinnedCountdowns || [];
    const key = pinned[index];
    let inner, draggableAttr = '';
    if (key) {
        const it = resolveCountdownItem(key);
        if (it) {
            // 固定槽＝侧边栏预览，名称上限与侧边栏保持一致
            inner = cdItemInner(it, COUNTDOWN_TODAY_NAME_MAX);
            draggableAttr = ' draggable="true" ondragstart="cdDragStart(event,\'' + key + '\',\'slot\')" ondragend="cdDragEnd(event)"';
        } else {
            inner = '<span class="cd-slot-empty">（已失效）</span>';
        }
    } else {
        inner = '<span class="cd-slot-empty">拖到此处固定到侧边栏</span>';
    }
    return '<div id="cd-slot-' + index + '" class="holiday-countdown-box cd-slot" data-slot="' + index + '"' +
        ' ondragover="cdAllowDrop(event)" ondragleave="cdDragLeave(event)" ondrop="cdDropOnSlot(event,' + index + ')"' + draggableAttr + '>' +
        inner + '</div>';
}

// 卡片池数据（系统默认 + 自定义；含已固定项，系统默认始终排第一）
function buildPoolItems() {
    const items = [];
    const nh = getNextHoliday();
    if (nh) {
        items.push({
            key: COUNTDOWN_AUTO_KEY, isHoliday: true, name: nh.name, names: nh.names, days: nh.days,
            ongoing: nh.ongoing,
            dateLabel: nh.dateLabel,    // 与侧边栏同源：未来「起」/ 进行中「区间」
            editable: false, deletable: false
        });
    }
    (settings.countdowns || []).forEach(c => {
        const days = getCountdownDays(c.date, c.repeat);
        const dt = parseYmd(c.date);
        items.push({
            key: c.id, isHoliday: false, name: c.name, days: days, repeat: c.repeat,
            dateLabel: dt ? (dt.getMonth() + 1) + '月' + dt.getDate() + '日' : c.date,
            editable: true, deletable: true
        });
    });
    return items;
}

// 卡片池内部 HTML（编辑中卡片原位变为配置区；includeAdd 时末尾追加添加卡片/添加表单）
function renderPoolInner(items, includeAdd) {
    let html = '';
    const editingId = (countdownEditing && !countdownEditing.isAdd) ? countdownEditing.id : null;
    items.forEach(it => {
        if (it.key === editingId) {
            const real = (settings.countdowns || []).find(c => c.id === editingId);
            html += cdEditFormHtml(real);
        } else {
            html += cdCardHtml(it);
        }
    });
    if (includeAdd) {
        if (countdownEditing && countdownEditing.isAdd) {
            html += cdEditFormHtml(null);
        } else {
            html += cdAddCardHtml();
        }
    }
    return html;
}

function cdCardHtml(it) {
    const pinned = (settings.pinnedCountdowns || []).includes(it.key);
    const pinnedCls = pinned ? ' cd-pinned' : '';
    const pinActive = pinned ? ' active' : '';
    let rightHtml = '';
    if (it.editable) {
        rightHtml = '<button type="button" onclick="editCountdown(\'' + it.key + '\')" ' +
            'class="cd-icon-btn cd-edit-btn" title="编辑"><i class="fas fa-edit"></i></button>';
    } else if (it.isHoliday) {
        rightHtml = '<button type="button" onclick="switchToHolidayPage(\'countdown\')" ' +
            'class="cd-icon-btn cd-settings-btn" title="设置节假日与调休"><i class="fas fa-cog"></i></button>';
    }
    return '<div class="holiday-countdown-box cd-card' + pinnedCls + '" ' +
        'data-key="' + it.key + '" draggable="true" ondragstart="cdDragStart(event,\'' + it.key + '\',\'pool\')" ondragend="cdDragEnd(event)" ' +
        'ondragover="cdAllowDrop(event)" ondragleave="cdDragLeave(event)" ondrop="cdDropOnCard(event,\'' + it.key + '\')">' +
            '<button type="button" onclick="toggleCountdownPin(\'' + it.key + '\')" ' +
                'class="cd-icon-btn cd-pin-btn' + pinActive + '" title="' + (pinned ? '已在侧边栏显示，点击取消' : '固定到侧边栏') + '">' +
                '<i class="fas fa-thumbtack"></i></button>' +
            '<div class="cd-side-body">' + cdItemInner(it) + '</div>' +
            rightHtml +
        '</div>';
}

// 末尾的“添加”卡片（虚线框 + 号，与卡片等宽）
function cdAddCardHtml() {
    return '<div class="cd-add-card flex items-center justify-center p-3 rounded-lg border border-dashed border-theme cursor-pointer hover:bg-theme-tertiary transition" onclick="openAddCountdown()" title="添加倒计时">' +
        '<i class="fas fa-plus text-xl text-theme-secondary"></i></div>';
}

// ---------------------------------------------------------------- 拖拽（固定槽 / 卡片池）
let cdDragKey = null;
let cdDragFrom = null; // 'slot' | 'pool' —— 标记拖拽来源，避免从卡片池拖拽时误解除固定

function cdDragStart(event, key, from) {
    cdDragKey = key;
    cdDragFrom = from || null;
    event.dataTransfer.effectAllowed = 'move';
    try { event.dataTransfer.setData('text/plain', key); } catch (e) {}
    const el = event.currentTarget;
    if (el) el.classList.add('dragging');
}

function cdDragEnd(event) {
    const el = event.currentTarget;
    if (el) el.classList.remove('dragging');
    cdDragKey = null;
    cdDragFrom = null;
    document.querySelectorAll('.cd-dragover').forEach(e => e.classList.remove('cd-dragover'));
}

function cdAllowDrop(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const t = event.currentTarget;
    if (t && t.classList) t.classList.add('cd-dragover');
}

function cdDragLeave(event) {
    const t = event.currentTarget;
    if (t && t.classList) t.classList.remove('cd-dragover');
}

function cdDropOnSlot(event, index) {
    event.preventDefault();
    const key = cdDragKey || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
    if (!key) return;
    pinToSlot(key, index);
}

function cdDropOnPool(event) {
    event.preventDefault();
    const key = cdDragKey || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
    if (!key) return;
    // 只有从"固定槽"拖入卡片池才解除固定；从卡片池自身拖拽（含落回原处）不做任何改变
    if (cdDragFrom === 'slot') unpin(key);
}

function cdDropOnCard(event, targetKey) {
    event.preventDefault();
    event.stopPropagation();
    const key = cdDragKey || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
    if (!key) return;
    const pinned = settings.pinnedCountdowns || [];
    // 从"固定槽"拖到卡片池卡片 → 解除固定
    if (cdDragFrom === 'slot' && pinned.includes(key)) { unpin(key); return; }
    // 其它情况（卡片池内拖动 / 落回原处）→ 仅重排，不影响固定状态
    if (key !== targetKey) reorderWithinPool(key, targetKey);
}

function pinToSlot(key, index) {
    let pinned = (settings.pinnedCountdowns || []).slice();
    const oldIdx = pinned.indexOf(key);

    if (oldIdx >= 0) {
        // 已在固定槽内：仅做位置交换/重排，不要把被替换的卡片丢掉（期望 [B,A] 而非 [B,]）
        pinned.splice(oldIdx, 1);
        if (index < 0) index = 0;
        if (index > pinned.length) index = pinned.length;
        pinned.splice(index, 0, key);
    } else {
        // 来自卡片池：插入到目标槽位；若槽位已被占用则替换（被替换卡片解除固定），而非报错
        if (index < 0) index = 0;
        if (index > pinned.length) index = pinned.length;
        if (index < pinned.length) pinned.splice(index, 1);
        pinned.splice(index, 0, key);
    }
    settings.pinnedCountdowns = pinned.slice(0, COUNTDOWN_MAX_PIN);
    saveData();
    renderCountdownView(document.getElementById('view-container'));
    renderSidebarCountdown();
}

function unpin(key) {
    if (!(settings.pinnedCountdowns || []).includes(key)) return;
    settings.pinnedCountdowns = (settings.pinnedCountdowns || []).filter(k => k !== key);
    saveData();
    renderCountdownView(document.getElementById('view-container'));
    renderSidebarCountdown();
}

function reorderWithinPool(fromKey, toKey) {
    // 系统默认卡片不在 settings.countdowns 中，无法重排；
    // 拖动它或拖到它上面都不应触发解除固定，直接忽略
    if (fromKey === COUNTDOWN_AUTO_KEY || toKey === COUNTDOWN_AUTO_KEY) return;
    const arr = settings.countdowns || [];
    const fromIdx = arr.findIndex(c => c.id === fromKey);
    const toIdx = arr.findIndex(c => c.id === toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    const moved = arr.splice(fromIdx, 1)[0];
    const newTo = arr.findIndex(c => c.id === toKey);
    arr.splice(newTo, 0, moved);
    saveData();
    renderCountdownView(document.getElementById('view-container'));
}

function cdEditFormHtml(c) {
    const isAdd = !c;
    const nameVal = c ? escapeHtml(c.name) : '';
    const dateVal = c ? c.date : '';
    const repeatVal = c ? c.repeat : 'once';
    const showDelete = !!c;
    return '' +
        '<div class="cd-edit-card p-3 bg-theme-tertiary rounded-lg border border-theme border-l-4 border-l-accent">' +
            '<div class="space-y-2">' +
                '<input type="text" id="cd-edit-name" maxlength="20" value="' + nameVal + '" placeholder="名称（最多 20 字）" ' +
                    'class="w-full px-2 py-1.5 text-sm border border-theme rounded-lg bg-theme-primary text-theme-primary">' +
                '<input type="date" id="cd-edit-date" value="' + dateVal + '" ' +
                    'class="w-full px-2 py-1.5 text-sm border border-theme rounded-lg bg-theme-tertiary text-theme-primary cursor-pointer">' +
                '<div class="flex items-center gap-2">' +
                    '<button type="button" onclick="setCdEditRepeat(\'once\')" data-repeat="once" class="cd-repeat-btn detail-tag-pill ' + (repeatVal === 'once' ? 'detail-tag-pill-selected' : '') + '" style="--tag-color:#3b82f6">仅一次</button>' +
                    '<button type="button" onclick="setCdEditRepeat(\'yearly\')" data-repeat="yearly" class="cd-repeat-btn detail-tag-pill ' + (repeatVal === 'yearly' ? 'detail-tag-pill-selected' : '') + '" style="--tag-color:#22c55e">每年重复</button>' +
                    '<input type="hidden" id="cd-edit-repeat" value="' + repeatVal + '">' +
                    '<div class="flex-1"></div>' +
                    (showDelete ? (function() {
                        const confirming = countdownDeleteConfirming === c.id;
                        const cls = confirming
                            ? 'bg-red-600 text-white border-red-600'
                            : 'border-red-500 text-red-500 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/30';
                        const icon = confirming ? 'fa-check' : 'fa-trash';
                        const title = confirming ? '再次点击确认删除' : '删除';
                        return '<button type="button" onclick="deleteCountdown(\'' + c.id + '\')" class="flex items-center justify-center w-8 h-8 rounded-lg border transition ' + cls + '" title="' + title + '"><i class="fas ' + icon + ' text-sm"></i></button>';
                    })() : '') +
                    '<button type="button" onclick="saveCountdown(' + isAdd + ', \'' + (c ? c.id : '') + '\')" class="flex items-center justify-center w-8 h-8 rounded-lg border border-green-500 text-green-500 hover:bg-green-500 hover:text-white transition" title="保存"><i class="fas fa-check text-sm"></i></button>' +
                    '<button type="button" onclick="cancelCountdownEdit()" class="flex items-center justify-center w-8 h-8 rounded-lg border border-theme text-theme-secondary hover:bg-theme-primary transition" title="取消"><i class="fas fa-times text-sm"></i></button>' +
                '</div>' +
            '</div>' +
        '</div>';
}

function setCdEditRepeat(repeat) {
    const hidden = document.getElementById('cd-edit-repeat');
    if (hidden) hidden.value = repeat;
    document.querySelectorAll('.cd-repeat-btn').forEach(btn => {
        if (btn.dataset.repeat === repeat) {
            btn.classList.remove('detail-tag-pill');
            btn.classList.add('detail-tag-pill-selected');
        } else {
            btn.classList.remove('detail-tag-pill-selected');
            btn.classList.add('detail-tag-pill');
        }
    });
}

// ---------------------------------------------------------------- 编辑/新增/删除

function openAddCountdown() {
    countdownEditing = { isAdd: true, id: null };
    countdownDeleteConfirming = null;
    if (countdownDeleteTimer) { clearTimeout(countdownDeleteTimer); countdownDeleteTimer = null; }
    renderCountdownView(document.getElementById('view-container'));
}

function editCountdown(id) {
    countdownEditing = { isAdd: false, id: id };
    countdownDeleteConfirming = null;
    if (countdownDeleteTimer) { clearTimeout(countdownDeleteTimer); countdownDeleteTimer = null; }
    renderCountdownView(document.getElementById('view-container'));
}

function cancelCountdownEdit() {
    countdownEditing = null;
    countdownDeleteConfirming = null;
    if (countdownDeleteTimer) { clearTimeout(countdownDeleteTimer); countdownDeleteTimer = null; }
    renderCountdownView(document.getElementById('view-container'));
}

function saveCountdown(isAdd, id) {
    const nameInput = document.getElementById('cd-edit-name');
    const dateInput = document.getElementById('cd-edit-date');
    const repeatInput = document.getElementById('cd-edit-repeat');
    if (!nameInput || !dateInput || !repeatInput) return;

    const name = nameInput.value.trim();
    const date = dateInput.value;
    const repeat = repeatInput.value;

    if (!name) { showToast('请输入名称', 'error'); return; }
    if (name.length > 20) { showToast('名称最多 20 字', 'error'); return; }
    if (!date) { showToast('请选择目标日期', 'error'); return; }
    const dt = parseYmd(date);
    if (!dt) { showToast('日期不存在，请重新选择', 'error'); return; }

    if (!settings.countdowns) settings.countdowns = [];
    if (!isAdd) {
        const c = settings.countdowns.find(x => x.id === id);
        if (c) { c.name = name; c.date = date; c.repeat = repeat; }
    } else {
        settings.countdowns.push({ id: generateId(), name: name, date: date, repeat: repeat });
    }

    countdownEditing = null;
    saveData();
    renderCountdownView(document.getElementById('view-container'));
    renderSidebarCountdown();
    showToast(isAdd ? '添加成功' : '保存成功', 'success');
}

function deleteCountdown(id) {
    if (countdownDeleteConfirming !== id) {
        // 第一次点击：进入确认状态（点击变红，3 秒内再次点击确认）
        countdownDeleteConfirming = id;
        renderCountdownView(document.getElementById('view-container'));
        if (countdownDeleteTimer) clearTimeout(countdownDeleteTimer);
        countdownDeleteTimer = setTimeout(() => {
            countdownDeleteConfirming = null;
            renderCountdownView(document.getElementById('view-container'));
        }, 3000);
        return;
    }
    // 第二次点击：确认删除
    settings.countdowns = (settings.countdowns || []).filter(c => c.id !== id);
    settings.pinnedCountdowns = (settings.pinnedCountdowns || []).filter(k => k !== id);
    countdownDeleteConfirming = null;
    countdownEditing = null;
    if (countdownDeleteTimer) { clearTimeout(countdownDeleteTimer); countdownDeleteTimer = null; }
    saveData();
    renderCountdownView(document.getElementById('view-container'));
    renderSidebarCountdown();
    showToast('删除成功', 'success');
}
