// ==================== 摘要视图：状态变量与渲染（从 views.js 拆分） ====================

let summaryViewMode = 'list';
let summaryTimeRange = 'week';
let summaryPriority = 'all';
let summaryList = 'all';
let summaryStatus = 'all';

function renderSummaryView(container) {
    // 重新渲染前停止旧的彗星动画
    stopSummaryCometAnimation();
    const timeRangeOptions = [
        { value: 'today', label: '今天' },
        { value: 'yesterday', label: '昨天' },
        { value: 'last3days', label: '最近三天' },
        { value: 'week', label: '本周' },
        { value: 'lastweek', label: '上周' },
        { value: 'month', label: '本月' },
        { value: 'lastmonth', label: '上月' }
    ];

    const priorityOptions = [
        { value: 'all', label: '所有优先级' },
        { value: 'urgent-important', label: '重要紧急' },
        { value: 'urgent-not-important', label: '紧急不重要' },
        { value: 'important-not-urgent', label: '重要不紧急' },
        { value: 'not-urgent-not-important', label: '不紧急不重要' }
    ];

    const statusOptions = [
        { value: 'all', label: '所有完成状态' },
        { value: 'completed', label: '已完成' },
        { value: 'uncompleted', label: '未完成' }
    ];

    const filteredTasks = filterTasksForSummary();
    const { title, dateRangeStr } = getSummaryHeaderInfo();
    const content = summaryViewMode === 'time'
        ? generateTimeBasedContent(filteredTasks)
        : generateListBasedContent(filteredTasks);

    // 左栏数据：今日完成率（始终今日，仅受清单筛选影响）
    const todayData = getTodayCompletionData();
    // 左栏数据：完成趋势（跟随时间范围，仅显示已过日期，仅受清单筛选影响）
    const trendData = getCompletionTrendData();

    // 保存右侧文本摘要区滚动位置，避免定时刷新时跳回顶部
    let _savedSummaryScrollTop = 0;
    const _prevSummaryScroll = container.querySelector('#summary-content-scroll');
    if (_prevSummaryScroll) _savedSummaryScrollTop = _prevSummaryScroll.scrollTop;

    container.innerHTML = `
        <div class="summary-container h-full flex flex-col">
            <div class="flex items-center justify-between p-4 pb-2">
                <div class="flex items-center gap-4 flex-wrap">
                    <select id="summary-time-range" class="px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary">
                        ${timeRangeOptions.map(opt => `<option value="${opt.value}" ${summaryTimeRange === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                    </select>

                    <select id="summary-priority" class="px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary">
                        ${priorityOptions.map(opt => `<option value="${opt.value}" ${summaryPriority === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                    </select>

                    <select id="summary-list" class="px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary">
                        <option value="all" ${summaryList === 'all' ? 'selected' : ''}>所有清单</option>
                        ${lists.filter(l => !l.archived).map(list => `<option value="${list.id}" ${summaryList === list.id ? 'selected' : ''}>${list.name}</option>`).join('')}
                    </select>

                    <select id="summary-status" class="px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary">
                        ${statusOptions.map(opt => `<option value="${opt.value}" ${summaryStatus === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                    </select>
                </div>

                <div class="flex items-center gap-4">
                    <div class="flex bg-theme-tertiary rounded-lg p-1">
                        <button id="summary-view-time" class="px-4 py-1.5 rounded-md transition ${summaryViewMode === 'time' ? 'bg-blue-500 text-white summary-view-toggle-active' : 'text-theme-primary hover:text-theme-secondary'}">
                            按时间排布
                        </button>
                        <button id="summary-view-list" class="px-4 py-1.5 rounded-md transition ${summaryViewMode === 'list' ? 'bg-blue-500 text-white summary-view-toggle-active' : 'text-theme-primary hover:text-theme-secondary'}">
                            按清单排布
                        </button>
                    </div>
                </div>
            </div>

            <div class="flex-1 min-h-0 flex gap-4 px-4 pb-4">
                <!-- 左栏：数据洞察与可视化 (45%) -->
                <div class="flex flex-col gap-4" style="width: 45%; min-width: 0;">
                    <!-- 模块一：今日概况（整合任务+专注） -->
                    <div class="bg-theme-secondary rounded-xl shadow-theme p-5 flex-shrink-0">
                        ${renderTodayOverviewCard(todayData)}
                    </div>
                    <!-- 模块二：完成趋势 -->
                    <div class="bg-theme-secondary rounded-xl shadow-theme p-5 flex-1 min-h-0 flex flex-col">
                        ${renderCompletionTrendCard(trendData)}
                    </div>
                </div>

                <!-- 右栏：文本摘要区 (55%) -->
                <div id="summary-content-scroll" class="bg-theme-secondary rounded-xl shadow-theme p-6 flex-1 min-h-0 overflow-y-auto">
                    <div class="flex items-center justify-between mb-4">
                        <div>
                            <h1 class="text-2xl font-bold text-theme-primary mb-1">${title}</h1>
                            <h2 class="text-theme-muted">${dateRangeStr}</h2>
                        </div>
                        <button id="summary-copy-btn" class="w-9 h-9 rounded-full border-2 border-blue-500 text-blue-500 flex items-center justify-center hover:bg-blue-500 hover:text-white transition" title="复制文本">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>

                    <div id="summary-content" class="max-w-none text-sm">
                        ${content}
                    </div>
                </div>
            </div>
        </div>
    `;

    // 同步恢复滚动位置，避免刷新时跳回顶部（无感知刷新）
    const _newSummaryScroll = container.querySelector('#summary-content-scroll');
    if (_newSummaryScroll && _savedSummaryScrollTop > 0) {
        _newSummaryScroll.scrollTop = _savedSummaryScrollTop;
    }

    setTimeout(() => {
        document.getElementById('summary-time-range').addEventListener('change', handleSummaryFilterChange);
        document.getElementById('summary-priority').addEventListener('change', handleSummaryFilterChange);
        document.getElementById('summary-list').addEventListener('change', handleSummaryFilterChange);
        document.getElementById('summary-status').addEventListener('change', handleSummaryFilterChange);
        document.getElementById('summary-view-time').addEventListener('click', () => {
            summaryViewMode = 'time';
            renderSummaryView(container);
        });
        document.getElementById('summary-view-list').addEventListener('click', () => {
            summaryViewMode = 'list';
            renderSummaryView(container);
        });
        document.getElementById('summary-copy-btn').addEventListener('click', copySummaryText);
        // 今日完成圆环启动动画
        animateSummaryRingStart();
        // 彗星拖尾动画：等待圆环填充完成后启动
        setTimeout(() => animateSummaryComet(), 1000);
    }, 50);
}

// ==================== 摘要左栏：今日完成率 ====================

// 今日完成率数据口径：
// 今日总任务 = 今天新创建且已完成的任务 + 截止日期是今天的任务（无论是否完成） + 从过去延期到今天的未完成任务
// 排除未来日期的任务，以及没有设置日期且不在今天执行的任务
// 仅受清单筛选影响，不受优先级/状态/时间范围筛选影响
function getTodayCompletionData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTasks = tasks.filter(task => {
        // 清单筛选
        if (summaryList !== 'all' && task.listId !== summaryList) return false;
        // 排除已归档清单
        const taskList = lists.find(l => l.id === task.listId);
        if (taskList && taskList.archived) return false;

        // 今天新创建且已完成
        if (task.createdAt) {
            const created = new Date(task.createdAt);
            created.setHours(0, 0, 0, 0);
            if (created.getTime() === today.getTime() && task.completed) return true;
        }

        // 截止日期是今天（无论是否完成）
        if (task.startTime) {
            const start = new Date(task.startTime);
            start.setHours(0, 0, 0, 0);
            if (start.getTime() === today.getTime()) return true;
            // 从过去延期到今天的未完成任务
            if (start.getTime() < today.getTime() && !task.completed) return true;
        }

        return false;
    });

    const completed = todayTasks.filter(t => t.completed).length;
    const total = todayTasks.length;
    const remaining = total - completed;
    const importantCompleted = todayTasks.filter(t => t.completed && t.important).length;

    // 今日新增任务数（按 createdAt 统计，仅受清单筛选影响）
    const todayKey = today.getTime();
    let newCount = 0;
    tasks.forEach(task => {
        if (summaryList !== 'all' && task.listId !== summaryList) return;
        const taskList = lists.find(l => l.id === task.listId);
        if (taskList && taskList.archived) return;
        if (task.createdAt) {
            const created = new Date(task.createdAt);
            created.setHours(0, 0, 0, 0);
            if (created.getTime() === todayKey) newCount++;
        }
    });

    return { completed, total, remaining, importantCompleted, newCount };
}

function renderTodayOverviewCard(data) {
    const percent = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
    const isAllClear = data.total > 0 && data.completed === data.total;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    // 基础参数
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - percent / 100);
    // 启动动画：圆环从 0% 填充到实际进度，百分比数字从 0% 递增到实际值
    const startOffset = circumference; // 0% 时的 dashoffset

    // 颜色设定：圆环使用主题强调色，彗星用白色高亮以区别于圆环底色
    // （全清状态保留金黄色庆祝效果）
    const baseColor = isAllClear ? '#fbbf24' : 'var(--accent-color)';
    const brightColor = isAllClear ? '#fef3c7' : '#ffffff';

    // 彗星几何参数（JS rAF 驱动，长度动态变化）：
    // dasharray = "L C"，图案总长 PL = L + C
    // dashoffset = 2*L + C - H 时，彗星头部在圆位 H，尾部在 H-L
    const progressLength = (circumference * percent) / 100;
    // 彗星峰值长度：进度很短时收缩，避免越过进度末端落到灰色轨道上
    let maxCometLength = circumference * 0.15;
    if (progressLength > 0 && progressLength < maxCometLength) {
        maxCometLength = Math.max(progressLength, 6);
    }
    // 最短长度（周期起止时的长度）
    const minCometLength = Math.max(maxCometLength * 0.25, 4);

    // 专注数据
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const history = typeof pomodoroHistory !== 'undefined' ? pomodoroHistory : [];
    const todayPomodoros = history.filter(p => {
        const pDate = new Date(p.date);
        pDate.setHours(0, 0, 0, 0);
        return pDate.getTime() === today.getTime();
    }).length;
    const focusDuration = (typeof pomodoroState !== 'undefined' && pomodoroState.focusDuration)
        ? pomodoroState.focusDuration
        : (settings.focusDuration || 25);
    const todayMinutes = todayPomodoros * focusDuration;

    // 信息项：统一使用数字在上、标签在下的样式，无独立底色
    const infoItem = (value, label, extraAttrs = '') =>
        `<div class="text-center" ${extraAttrs}>
            <div class="text-lg font-bold text-theme-primary">${value}</div>
            <div class="text-xs text-theme-muted mt-0.5">${label}</div>
        </div>`;

    let html = `
        <div class="flex items-center justify-between mb-3">
            <h3 class="text-base font-semibold text-theme-primary">今日概况</h3>
            ${data.importantCompleted > 0 ? `<span class="text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 flex items-center gap-1"><i class="fas fa-bolt text-xs"></i> 高优 ${data.importantCompleted}</span>` : ''}
        </div>
    `;

    // 圆环 SVG
    let ringSvg = '';
    if (data.total === 0) {
        ringSvg = `
            <svg viewBox="0 0 120 120" class="w-24 h-24">
                <circle cx="60" cy="60" r="${radius}" fill="none" stroke="var(--bg-tertiary)" stroke-width="8"/>
                <text x="60" y="60" text-anchor="middle" dy=".3em" font-size="22" font-weight="bold" fill="var(--text-muted)">0%</text>
            </svg>
        `;
    } else {
        const showComet = !isAllClear && percent > 0;
        ringSvg = `
            <svg viewBox="0 0 120 120" class="w-24 h-24 ${isAllClear ? 'ring-complete-glow' : ''}">
                <defs>
                    <filter id="pulse-glow" x="-30%" y="-30%" width="160%" height="160%">
                        <feGaussianBlur stdDeviation="4" result="blur"/>
                        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
                    </filter>
                    <filter id="comet-head-glow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="blur"/>
                        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
                    </filter>
                </defs>
                <circle cx="60" cy="60" r="${radius}" fill="none" stroke="var(--bg-tertiary)" stroke-width="8" transform="rotate(-90 60 60)"/>
                <circle id="summary-progress-ring" cx="60" cy="60" r="${radius}" fill="none" stroke="${baseColor}" stroke-width="8"
                    stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${startOffset.toFixed(2)}"
                    stroke-linecap="round" transform="rotate(-90 60 60)"
                    data-target-offset="${dashOffset.toFixed(2)}"
                    data-target-percent="${percent}"
                    style="transition: stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)"/>
                ${showComet ? `
                <circle id="summary-comet-tail" cx="60" cy="60" r="${radius}" fill="none" stroke="${brightColor}" stroke-width="5"
                    stroke-dasharray="${minCometLength.toFixed(2)} ${circumference.toFixed(2)}" stroke-linecap="round"
                    transform="rotate(-90 60 60)"
                    data-circumference="${circumference.toFixed(2)}"
                    data-progress-length="${progressLength.toFixed(2)}"
                    data-min-length="${minCometLength.toFixed(2)}"
                    data-max-length="${maxCometLength.toFixed(2)}"
                    style="opacity: 0;"/>
                <circle id="summary-comet-head" cx="60" cy="60" r="${radius}" fill="none" stroke="#ffffff" stroke-width="6"
                    stroke-dasharray="0.1 ${circumference.toFixed(2)}" stroke-linecap="round" filter="url(#comet-head-glow)"
                    transform="rotate(-90 60 60)"
                    data-circumference="${circumference.toFixed(2)}"
                    data-progress-length="${progressLength.toFixed(2)}"
                    style="opacity: 0;"/>
                ` : ''}
                <text id="summary-ring-percent" x="60" y="60" text-anchor="middle" dy=".3em" font-size="24" font-weight="bold" fill="${isAllClear ? '#fbbf24' : 'var(--text-primary)'}">0%</text>
            </svg>
        `;
    }

    html += `
        <div class="flex items-center gap-4">
            <div class="relative flex-shrink-0">
                ${ringSvg}
            </div>
            <div class="flex-1 min-w-0 grid grid-cols-3 gap-x-2 gap-y-3">
                ${infoItem(data.completed + '<span class="text-xs text-theme-muted"> / ' + data.total + '</span>', '已完成')}
                ${infoItem(data.remaining, '剩余待办')}
                ${infoItem(data.newCount || 0, '新增任务')}
                ${infoItem(todayPomodoros, '今日专注', 'onclick="openPomodoroStats()" style="cursor:pointer" title="查看番茄专注统计"')}
                ${infoItem(formatFocusMinutes(todayMinutes), '今日时长', 'onclick="openPomodoroStats()" style="cursor:pointer" title="查看番茄专注统计"')}
            </div>
        </div>
    `;

    return html;
}

/**
 * 今日完成圆环启动动画
 * 圆环从 0% 填充到实际进度，百分比数字从 0% 递增到实际值，持续 1 秒
 * 每次打开摘要界面都会触发
 */
function animateSummaryRingStart() {
    const ring = document.getElementById('summary-progress-ring');
    const textEl = document.getElementById('summary-ring-percent');
    if (!ring || !textEl) return;

    const targetOffset = parseFloat(ring.getAttribute('data-target-offset'));
    const targetPercent = parseInt(ring.getAttribute('data-target-percent'), 10);

    // 强制重绘，确保初始 0% 状态已渲染
    void ring.getBoundingClientRect();

    // 启动圆环填充动画（CSS transition 处理）
    ring.style.strokeDashoffset = targetOffset;

    // 数字递增动画
    const duration = 1000; // 1秒
    const startTime = performance.now();
    function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out 缓动，与圆环过渡节奏一致
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(targetPercent * eased);
        textEl.textContent = current + '%';
        if (progress < 1) requestAnimationFrame(tick);
        else textEl.textContent = targetPercent + '%';
    }
    requestAnimationFrame(tick);
}

/**
 * 彗星拖尾动态长度动画（JS rAF 驱动）
 * 采用"图层叠加法 (Layer Stacking)"解决 SVG 无法沿弧线渐变的物理限制：
 * JS 自动克隆 4 层彗尾（共 5 层），长度依次递减、透明度依次叠加，形成沿弧线消散的渐变。
 * 彗头为高亮圆点 + 发光滤镜，顶在最前端。
 *
 * 节奏：彗星扫过（随机 2-4s）→ 5s 空闲周期 → 下一轮
 */
let _summaryCometRafId = null;
let _summaryCometCycleStart = 0; // 当前周期起点（含空闲期）
let _summaryCometSweepDuration = 0; // 当前扫过时长（2-4s 随机）
let _summaryCometLayers = null; // 图层叠加法：缓存的彗尾图层节点数组

function animateSummaryComet() {
    const cometTail = document.getElementById('summary-comet-tail');
    const cometHead = document.getElementById('summary-comet-head');
    const comet = cometTail || document.getElementById('summary-comet');
    if (!comet) return;

    const C = parseFloat(comet.getAttribute('data-circumference'));
    const progressLength = parseFloat(comet.getAttribute('data-progress-length'));
    const minL = parseFloat(comet.getAttribute('data-min-length'));
    const maxL = parseFloat(comet.getAttribute('data-max-length'));

    if (!C || !progressLength || progressLength <= 0) return;

    // --- 图层叠加法初始化 ---
    // 每次启动时检查并构建叠加图层（避免重复构建）
    let tailLayers = [];
    if (cometTail) {
        // 清理旧图层（防止 SVG 重建后引用游离节点）
        if (_summaryCometLayers) {
            _summaryCometLayers.forEach(layer => {
                if (layer !== cometTail && layer.parentNode) layer.parentNode.removeChild(layer);
            });
            _summaryCometLayers = null;
        }
        // 构建新的叠加图层：原始彗尾 + 4 个克隆，共 5 层
        tailLayers.push(cometTail);
        const parent = cometTail.parentNode;
        for (let i = 0; i < 4; i++) {
            const clone = cometTail.cloneNode(true);
            clone.removeAttribute('id'); // 移除 id 避免冲突
            // 克隆图层插入到彗尾之后、彗头之前，确保彗头在最上层
            parent.insertBefore(clone, cometHead || cometTail.nextSibling);
            tailLayers.push(clone);
        }
        _summaryCometLayers = tailLayers;
    }

    const IDLE_DURATION = 5000; // 空闲周期 5 秒
    // 首轮立即开始扫过，不等待空闲
    _summaryCometCycleStart = performance.now();
    _summaryCometSweepDuration = 2000 + Math.random() * 2000; // 2-4 秒随机

    // Quart Ease-in-out：起始和结束更慢，中段爆发速度更强
    function easeInOut(t) {
        return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    }

    function tick(now) {
        const elapsed = now - _summaryCometCycleStart;

        if (elapsed < _summaryCometSweepDuration) {
            // 扫过阶段
            const p = elapsed / _summaryCometSweepDuration; // 0 → 1
            const headP = easeInOut(p);
            const H = headP * progressLength;

            // 速度与长度挂钩：速度最快时（p=0.5 附近）彗尾最长
            const speedFactor = Math.sin(p * Math.PI);
            const lengthFactor = Math.pow(speedFactor, 0.5);
            const baseL = minL + (maxL - minL) * lengthFactor;

            // 整体透明度：首尾 20% 渐隐渐现，中段保持满亮
            const globalOpacity = p < 0.2 ? (p / 0.2) : (p > 0.8 ? (1 - p) / 0.2 : 1);

            // 1. 更新彗尾（多图层叠加渐变）
            if (tailLayers.length > 0) {
                const numLayers = tailLayers.length;
                for (let i = 0; i < numLayers; i++) {
                    // currentRatio 从 1.0 (最长，i=0) 到 0.2 (最短，i=4)
                    const currentRatio = 1 - (i / numLayers);
                    // 当前图层长度
                    const layerL = baseL * currentRatio;
                    const tailOffset = 2 * layerL + C - H;
                    // 透明度：越长的图层（拖尾末端）透明度越低，越短的（靠近头部）越高
                    // currentRatio=1.0 → 0.1；currentRatio=0.2 → 0.5
                    const layerBaseOpacity = 0.6 - (currentRatio * 0.5);
                    const finalOpacity = globalOpacity * layerBaseOpacity;

                    const layerEl = tailLayers[i];
                    layerEl.setAttribute('stroke-dasharray', `${layerL.toFixed(2)} ${C.toFixed(2)}`);
                    layerEl.style.strokeDashoffset = tailOffset.toFixed(2);
                    layerEl.style.opacity = finalOpacity.toFixed(3);
                }
            } else {
                // 回退兼容：单一元素同时承担头尾
                const dashoffset = 2 * baseL + C - H;
                comet.setAttribute('stroke-dasharray', `${baseL.toFixed(2)} ${C.toFixed(2)}`);
                comet.style.strokeDashoffset = dashoffset.toFixed(2);
                comet.style.opacity = (globalOpacity * Math.min(1, speedFactor * 1.8)).toFixed(3);
            }

            // 2. 更新彗头（极短高亮圆点，顶在彗尾最前端）
            if (cometHead) {
                const headDotLength = 0.1; // 极短长度 + stroke-linecap="round" = 圆点
                const headOffset = 2 * headDotLength + C - H;
                cometHead.setAttribute('stroke-dasharray', `${headDotLength} ${C.toFixed(2)}`);
                cometHead.style.strokeDashoffset = headOffset.toFixed(2);
                cometHead.style.opacity = globalOpacity.toFixed(3);
            }

        } else if (elapsed < _summaryCometSweepDuration + IDLE_DURATION) {
            // 空闲周期：隐藏所有图层
            if (tailLayers.length > 0) {
                tailLayers.forEach(layer => layer.style.opacity = '0');
            } else {
                comet.style.opacity = '0';
            }
            if (cometHead) cometHead.style.opacity = '0';
        } else {
            // 进入下一轮：随机新的扫过时长
            _summaryCometCycleStart = now;
            _summaryCometSweepDuration = 2000 + Math.random() * 2000; // 2-4 秒随机
        }

        _summaryCometRafId = requestAnimationFrame(tick);
    }
    _summaryCometRafId = requestAnimationFrame(tick);
}

function stopSummaryCometAnimation() {
    if (_summaryCometRafId) {
        cancelAnimationFrame(_summaryCometRafId);
        _summaryCometRafId = null;
    }
    // 清理图层叠加法生成的克隆节点，避免 SVG 重建后残留游离节点
    if (_summaryCometLayers) {
        const cometTail = document.getElementById('summary-comet-tail');
        _summaryCometLayers.forEach(layer => {
            if (layer !== cometTail && layer.parentNode) layer.parentNode.removeChild(layer);
        });
        _summaryCometLayers = null;
    }
}

// ==================== 摘要左栏：完成趋势 ====================

// 完成趋势数据口径：
// 严格跟随顶部时间范围筛选，仅显示已过日期（包括今天）
// 柱状：每天实际完成任务数（按 completedAt 统计）
// 折线：每天新创建任务数（按 createdAt 统计）
// 仅受清单筛选影响，不受优先级/状态筛选影响
function getCompletionTrendData() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const today = new Date(now);

    let dates = [];
    let labels = [];

    switch (summaryTimeRange) {
        case 'today':
        case 'yesterday':
        case 'last3days':
        case 'week':
            // 这些选项统一展示过去 7 天（到今天）的统计信息
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                dates.push(d);
                labels.push((d.getMonth() + 1) + '/' + d.getDate());
            }
            break;
        case 'lastweek': {
            const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
            let weekStart = new Date(today);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
            if (today.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
            weekStart.setDate(weekStart.getDate() - 7);
            const dayNames = settings.weekStart === 'monday'
                ? ['一', '二', '三', '四', '五', '六', '日']
                : ['日', '一', '二', '三', '四', '五', '六'];
            for (let i = 0; i < 7; i++) {
                const d = new Date(weekStart);
                d.setDate(d.getDate() + i);
                dates.push(d);
                labels.push(dayNames[i]);
            }
            break;
        }
        case 'month':
        case 'lastmonth': {
            const refDate = summaryTimeRange === 'lastmonth'
                ? new Date(today.getFullYear(), today.getMonth() - 1, 1)
                : new Date(today.getFullYear(), today.getMonth(), 1);
            const daysInMonth = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0).getDate();
            for (let i = 1; i <= daysInMonth; i++) {
                const d = new Date(refDate.getFullYear(), refDate.getMonth(), i);
                // 上月全部显示；本月仅显示到今天
                if (summaryTimeRange === 'lastmonth' || d <= today) {
                    dates.push(d);
                    labels.push(i + '');
                }
            }
            break;
        }
    }

    // 统计每天完成数、创建数和完成率
    // 完成率口径：当天到期（startTime 落在当天）的任务中已完成的占比
    const dailyData = dates.map(date => {
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        let completedCount = 0;
        let createdCount = 0;
        let dueCount = 0;
        let completedOfDue = 0;

        tasks.forEach(task => {
            // 清单筛选
            if (summaryList !== 'all' && task.listId !== summaryList) return;
            // 排除已归档清单
            const taskList = lists.find(l => l.id === task.listId);
            if (taskList && taskList.archived) return;

            // 完成数（按 completedAt）
            if (task.completed && task.completedAt) {
                const completedDate = new Date(task.completedAt);
                if (completedDate >= dayStart && completedDate < dayEnd) {
                    completedCount++;
                }
            }

            // 创建数（按 createdAt）
            if (task.createdAt) {
                const createdDate = new Date(task.createdAt);
                if (createdDate >= dayStart && createdDate < dayEnd) {
                    createdCount++;
                }
            }

            // 当天到期任务（按 startTime 落在当天）
            if (task.startTime) {
                const startDate = new Date(task.startTime);
                if (startDate >= dayStart && startDate < dayEnd) {
                    dueCount++;
                    if (task.completed) completedOfDue++;
                }
            }
        });

        const completionRate = dueCount > 0 ? Math.round((completedOfDue / dueCount) * 100) : null;
        return { completedCount, createdCount, completionRate };
    });

    return { dates, labels, dailyData };
}

function renderCompletionTrendCard(trendData) {
    const { dates, labels, dailyData } = trendData;

    let html = `
        <div class="flex items-center justify-between mb-3">
            <h3 class="text-base font-semibold text-theme-primary">完成趋势</h3>
        </div>
    `;

    if (dates.length === 0 || dailyData.every(d => d.completedCount === 0 && d.createdCount === 0 && d.completionRate === null)) {
        html += '<div class="flex-1 flex items-center justify-center text-theme-muted text-sm">暂无数据</div>';
        return html;
    }

    function generateSmoothPath(points) {
        if (points.length < 2) return '';
        if (points.length === 2) {
            return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
        }
        const minY = padding.top;
        const maxY = padding.top + innerHeight;
        let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = i === 0 ? points[0] : points[i - 1];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = i + 2 < points.length ? points[i + 2] : points[i + 1];
            const tension = 0.33;
            const cp1x = p1.x + (p2.x - p0.x) * tension;
            const cp1y = p1.y + (p2.y - p0.y) * tension;
            const cp2x = p2.x - (p3.x - p1.x) * tension;
            const cp2y = p2.y - (p3.y - p1.y) * tension;
            const clampedCp1y = Math.max(minY, Math.min(maxY, cp1y));
            const clampedCp2y = Math.max(minY, Math.min(maxY, cp2y));
            path += ` C ${cp1x.toFixed(1)} ${clampedCp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${clampedCp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
        }
        return path;
    }

    // 通用图表参数
    // viewBox 宽高比尽量接近容器实际比例（约 2.5:1），减少 meet 模式下的留白
    const chartHeight = 200;
    const padding = { top: 20, right: 16, bottom: 26, left: 32 };
    const innerHeight = chartHeight - padding.top - padding.bottom;
    // 保证最小宽高比为 2.5:1，使图表横向充分展开
    const minChartWidth = chartHeight * 2.5;
    const chartWidth = Math.max(dates.length * 40 + 48, minChartWidth);
    const innerWidth = chartWidth - padding.left - padding.right;
    const colWidth = innerWidth / dates.length;

    // === 1. 折线图（已完成任务） ===
    const maxCompleted = Math.max(...dailyData.map(d => d.completedCount), 0);
    const displayMaxCompleted = Math.max(maxCompleted, 3);

    let barSvg = '';
    barSvg += `<defs><linearGradient id="trend-completed-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent-color)" stop-opacity="0.4"/><stop offset="100%" stop-color="var(--accent-color)" stop-opacity="0"/></linearGradient></defs>`;
    for (let i = 0; i <= 2; i++) {
        const y = padding.top + innerHeight * (1 - i / 2);
        const value = Math.round(displayMaxCompleted * i / 2);
        barSvg += `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(chartWidth - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border-color)" stroke-width="0.5" stroke-dasharray="2,2"/>`;
        barSvg += `<text x="${padding.left - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-muted)">${value}</text>`;
    }
    const completedPoints = dailyData.map((d, i) => {
        const x = padding.left + colWidth * (i + 0.5);
        const y = padding.top + innerHeight * (1 - d.completedCount / displayMaxCompleted);
        return { x, y, value: d.completedCount };
    });
    if (completedPoints.length >= 2) {
        const smoothPath = generateSmoothPath(completedPoints);
        const baselineY = padding.top + innerHeight;
        const areaPath = smoothPath + ` L ${completedPoints[completedPoints.length - 1].x.toFixed(1)} ${baselineY.toFixed(1)} L ${completedPoints[0].x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
        barSvg += `<path d="${areaPath}" fill="url(#trend-completed-gradient)"/>`;
        barSvg += `<path d="${smoothPath}" fill="none" stroke="var(--accent-color)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    completedPoints.forEach(p => {
        if (p.value > 0) {
            barSvg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="var(--accent-color)" stroke="var(--bg-secondary)" stroke-width="1.5"/>`;
            barSvg += `<text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--accent-color)" font-weight="600">${p.value}</text>`;
        }
    });
    labels.forEach((label, i) => {
        const x = padding.left + colWidth * (i + 0.5);
        barSvg += `<text x="${x.toFixed(1)}" y="${(chartHeight - 6).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${label}</text>`;
    });

    // === 2. 柱状图（完成率趋势） ===
    const barWidth = Math.min(18, colWidth * 0.5);
    let rateSvg = '';
    [0, 50, 100].forEach(value => {
        const y = padding.top + innerHeight * (1 - value / 100);
        rateSvg += `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(chartWidth - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border-color)" stroke-width="0.5" stroke-dasharray="2,2"/>`;
        rateSvg += `<text x="${padding.left - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-muted)">${value}%</text>`;
    });
    dailyData.forEach((d, i) => {
        const x = padding.left + colWidth * (i + 0.5);
        const barH = d.completionRate != null ? (d.completionRate / 100) * innerHeight : 0;
        const barY = padding.top + innerHeight - barH;
        if (d.completionRate != null) {
            rateSvg += `<rect x="${(x - barWidth / 2).toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" rx="3" fill="var(--accent-secondary)" opacity="0.85"/>`;
            rateSvg += `<text x="${x.toFixed(1)}" y="${(barY - 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-secondary)" font-weight="600">${d.completionRate}%</text>`;
        }
        rateSvg += `<text x="${x.toFixed(1)}" y="${(chartHeight - 6).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${labels[i]}</text>`;
    });

    // === 3. 折线图（新建任务）——已移除，仅保留柱状图和完成率折线图 ===

    // 两个图表上下堆叠，各占一半高度，自适应填满容器
    html += `
        <div class="flex-1 min-h-0 flex flex-col gap-2">
            <div class="flex flex-col flex-1 min-h-0">
                <div class="text-xs text-theme-secondary mb-1 flex items-center gap-1 flex-shrink-0">
                    <span class="inline-block w-4 h-0.5" style="background: var(--accent-color)"></span>已完成任务
                </div>
                <div class="flex-1 min-h-0 overflow-hidden">
                    <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="w-full h-full" preserveAspectRatio="xMidYMid meet">
                        ${barSvg}
                    </svg>
                </div>
            </div>
            <div class="flex flex-col flex-1 min-h-0">
                <div class="text-xs text-theme-secondary mb-1 flex items-center gap-1 flex-shrink-0">
                    <span class="inline-block w-3 h-3 rounded-sm" style="background: var(--accent-secondary)"></span>完成率趋势
                </div>
                <div class="flex-1 min-h-0 overflow-hidden">
                    <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="w-full h-full" preserveAspectRatio="xMidYMid meet">
                        ${rateSvg}
                    </svg>
                </div>
            </div>
        </div>
    `;

    return html;
}

function handleSummaryFilterChange() {
    summaryTimeRange = document.getElementById('summary-time-range').value;
    summaryPriority = document.getElementById('summary-priority').value;
    summaryList = document.getElementById('summary-list').value;
    summaryStatus = document.getElementById('summary-status').value;
    renderSummaryView(document.getElementById('view-container'));
}

function getSummaryHeaderInfo() {
    const now = new Date();
    let title = '';
    let startDate = null;
    let endDate = null;

    switch (summaryTimeRange) {
        case 'today':
            title = '今天';
            startDate = now;
            endDate = now;
            break;
        case 'yesterday':
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            title = '昨天';
            startDate = yesterday;
            endDate = yesterday;
            break;
        case 'last3days':
            title = '最近三天';
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 2);
            endDate = now;
            break;
        case 'week':
            title = '本周';
            const weekStart = new Date(now);
            const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
            weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
            if (now.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
            startDate = weekStart;
            endDate = new Date(weekStart);
            endDate.setDate(endDate.getDate() + 6);
            break;
        case 'lastweek':
            title = '上周';
            const lastWeekStart = new Date(now);
            lastWeekStart.setDate(lastWeekStart.getDate() - lastWeekStart.getDay() + (settings.weekStart === 'monday' ? 1 : 0) - 7);
            if (now.getDay() === 0 && settings.weekStart === 'monday') lastWeekStart.setDate(lastWeekStart.getDate() - 7);
            startDate = lastWeekStart;
            endDate = new Date(lastWeekStart);
            endDate.setDate(endDate.getDate() + 6);
            break;
        case 'month':
            title = '本月';
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            break;
        case 'lastmonth':
            title = '上月';
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), 0);
            break;
    }

    const formatDateRange = (date) => `${(date.getMonth() + 1)}月${date.getDate()}日`;
    const dateRangeStr = startDate && endDate
        ? (startDate.getTime() === endDate.getTime() ? formatDateRange(startDate) : `${formatDateRange(startDate)} - ${formatDateRange(endDate)}`)
        : '';

    return { title, dateRangeStr };
}

function filterTasksForSummary() {
    const now = new Date();
    let startDate = null;
    let endDate = null;

    switch (summaryTimeRange) {
        case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            break;
        case 'yesterday':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        case 'last3days':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            break;
        case 'week':
            const weekStart = new Date(now);
            const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
            weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
            if (now.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
            startDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
            endDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
            break;
        case 'lastweek':
            const lastWeekStart = new Date(now);
            lastWeekStart.setDate(lastWeekStart.getDate() - lastWeekStart.getDay() + (settings.weekStart === 'monday' ? 1 : 0) - 7);
            if (now.getDay() === 0 && settings.weekStart === 'monday') lastWeekStart.setDate(lastWeekStart.getDate() - 7);
            startDate = new Date(lastWeekStart.getFullYear(), lastWeekStart.getMonth(), lastWeekStart.getDate());
            endDate = new Date(lastWeekStart.getFullYear(), lastWeekStart.getMonth(), lastWeekStart.getDate() + 7);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            break;
        case 'lastmonth':
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
    }

    return tasks.filter(task => {
        // 过滤已归档清单的任务
        const taskList = lists.find(l => l.id === task.listId);
        if (taskList && taskList.archived) return false;

        if (summaryStatus === 'completed' && !task.completed) return false;
        if (summaryStatus === 'uncompleted' && task.completed) return false;

        if (summaryPriority !== 'all') {
            const taskPriority = getTaskPriority(task);
            if (taskPriority !== summaryPriority) return false;
        }

        if (summaryList !== 'all' && task.listId !== summaryList) return false;

        if (!startDate || !endDate) return true;

        const taskDate = getTaskDate(task);
        return taskDate >= startDate && taskDate < endDate;
    });
}

function getTaskPriority(task) {
    const important = task.important;
    const urgent = task.urgent;
    if (important && urgent) return 'urgent-important';
    if (urgent && !important) return 'urgent-not-important';
    if (important && !urgent) return 'important-not-urgent';
    return 'not-urgent-not-important';
}

function getTaskDate(task) {
    if (task.completedAt) {
        return new Date(task.completedAt);
    }
    if (task.startTime) {
        return new Date(task.startTime);
    }
    return new Date(task.createdAt);
}

function generateTimeBasedContent(filteredTasks) {
    if (filteredTasks.length === 0) {
        return '<p class="text-theme-muted text-center py-8">暂无符合条件的摘要内容，请调整筛选条件。</p>';
    }

    const completedTasks = filteredTasks.filter(t => t.completed);
    const uncompletedTasks = filteredTasks.filter(t => !t.completed);

    let html = '';

    if (summaryStatus !== 'uncompleted' && completedTasks.length > 0) {
        html += '<div class="mb-4"><div class="font-bold text-theme-primary mb-2">已完成</div>';
        html += formatTaskListHtml(completedTasks);
        html += '</div>';
    }

    if (summaryStatus !== 'completed' && uncompletedTasks.length > 0) {
        if (html) html += '<div class="mb-6"></div>';
        html += '<div class="mb-4"><div class="font-bold text-theme-primary mb-2">未完成</div>';
        html += formatTaskListHtml(uncompletedTasks);
        html += '</div>';
    }

    return html;
}

function generateListBasedContent(filteredTasks) {
    if (filteredTasks.length === 0) {
        return '<p class="text-theme-muted text-center py-8">暂无符合条件的摘要内容，请调整筛选条件。</p>';
    }

    const listGroups = {};
    const allLists = [...lists].filter(l => !l.archived);
    if (summaryList === 'all') {
        allLists.forEach(list => {
            listGroups[list.id] = { name: list.name, tasks: [] };
        });
    } else {
        const selectedList = lists.find(l => l.id === summaryList);
        if (selectedList) {
            listGroups[summaryList] = { name: selectedList.name, tasks: [] };
        }
    }

    filteredTasks.forEach(task => {
        if (listGroups[task.listId]) {
            listGroups[task.listId].tasks.push(task);
        }
    });

    const sortedListIds = Object.keys(listGroups).sort((a, b) => {
        const listA = lists.find(l => l.id === a);
        const listB = lists.find(l => l.id === b);
        return (listA?.name || '').localeCompare(listB?.name || '');
    });

    let html = '';
    let first = true;
    sortedListIds.forEach(listId => {
        const group = listGroups[listId];
        if (group.tasks.length === 0) return;

        if (!first) html += '<div class="mb-6"></div>';
        first = false;

        html += '<div class="mb-4"><div class="font-bold text-theme-primary mb-2">' + group.name + '</div>';
        html += formatTaskListHtml(group.tasks);
        html += '</div>';
    });

    return html;
}

function formatTaskListHtml(taskList) {
    const sorted = [...taskList].sort((a, b) => {
        return getTaskDate(b) - getTaskDate(a);
    });

    let html = '';
    sorted.forEach((task, idx) => {
        const date = getTaskDate(task);
        const displayDate = (date.getMonth() + 1) + '月' + date.getDate() + '日';
        html += '<div class="flex items-baseline gap-2 py-0.5 text-theme-primary">' +
            '<span class="text-theme-muted flex-shrink-0">' + (idx + 1) + '.</span>' +
            '<span class="text-theme-secondary flex-shrink-0">[' + displayDate + ']</span>' +
            '<span>' + (task.title || '未命名任务') + '</span>' +
            '</div>';
    });
    return html;
}

function copySummaryText() {
    const filteredTasks = filterTasksForSummary();
    let text = '';

    if (summaryViewMode === 'time') {
        const completedTasks = filteredTasks.filter(t => t.completed);
        const uncompletedTasks = filteredTasks.filter(t => !t.completed);

        if (summaryStatus !== 'uncompleted' && completedTasks.length > 0) {
            text += '已完成\n';
            completedTasks.sort((a, b) => getTaskDate(b) - getTaskDate(a)).forEach((task, idx) => {
                const date = getTaskDate(task);
                const displayDate = (date.getMonth() + 1) + '月' + date.getDate() + '日';
                text += (idx + 1) + '. [' + displayDate + '] ' + (task.title || '未命名任务') + '\n';
            });
        }

        if (summaryStatus !== 'completed' && uncompletedTasks.length > 0) {
            if (text) text += '\n';
            text += '未完成\n';
            uncompletedTasks.sort((a, b) => getTaskDate(b) - getTaskDate(a)).forEach((task, idx) => {
                const date = getTaskDate(task);
                const displayDate = (date.getMonth() + 1) + '月' + date.getDate() + '日';
                text += (idx + 1) + '. [' + displayDate + '] ' + (task.title || '未命名任务') + '\n';
            });
        }
    } else {
        const listGroups = {};
        const allLists = [...lists].filter(l => !l.archived);
        if (summaryList === 'all') {
            allLists.forEach(list => {
                listGroups[list.id] = { name: list.name, tasks: [] };
            });
        } else {
            const selectedList = lists.find(l => l.id === summaryList);
            if (selectedList) {
                listGroups[summaryList] = { name: selectedList.name, tasks: [] };
            }
        }
        filteredTasks.forEach(task => {
            if (listGroups[task.listId]) {
                listGroups[task.listId].tasks.push(task);
            }
        });
        const sortedListIds = Object.keys(listGroups).sort((a, b) => {
            const listA = lists.find(l => l.id === a);
            const listB = lists.find(l => l.id === b);
            return (listA?.name || '').localeCompare(listB?.name || '');
        });
        let first = true;
        sortedListIds.forEach(listId => {
            const group = listGroups[listId];
            if (group.tasks.length === 0) return;
            if (!first) text += '\n';
            first = false;
            text += group.name + '\n';
            group.tasks.sort((a, b) => getTaskDate(b) - getTaskDate(a)).forEach((task, idx) => {
                const date = getTaskDate(task);
                const displayDate = (date.getMonth() + 1) + '月' + date.getDate() + '日';
                text += (idx + 1) + '. [' + displayDate + '] ' + (task.title || '未命名任务') + '\n';
            });
        });
    }

    navigator.clipboard.writeText(text.trim()).then(() => {
        showToast('已复制', 'success');
    }).catch(() => {
        showToast('复制失败', 'error');
    });
}
