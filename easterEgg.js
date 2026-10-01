/**
 * 彩蛋系统 - easterEgg.js
 * 纯原生 JS + Canvas 实现，支持离线，高性能，零外部依赖
 */

// ==================== 样式注入 (离线可用) ====================
(function injectEasterEggStyles() {
    if (document.getElementById('ee-styles')) return;
    const style = document.createElement('style');
    style.id = 'ee-styles';
    style.innerHTML = `
        /* 传说级成就横幅容器：顶部居中，增加3D透视感 */
        #ee-toast-container { position: fixed; top: 70px; left: 0; right: 0; z-index: 9999; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 16px; overflow: hidden; perspective: 1000px; }

        /* 传说级成就横幅样式 */
        .ee-toast {
            position: relative;
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            color: #fff;
            padding: 12px 36px 12px 24px;
            display: flex; align-items: center; gap: 16px;
            white-space: normal;
            max-width: 420px;
            clip-path: polygon(15px 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%, 0 15px);
            border-left: 4px solid #fbbf24;
            box-shadow: inset 0 0 20px rgba(251, 191, 36, 0.15), 0 10px 30px rgba(0,0,0,0.5);
            animation: ee-dash-in 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards,
                       ee-breathe 3.5s ease-in-out 0.8s forwards,
                       ee-dash-out 0.7s cubic-bezier(0.55, 0.085, 0.68, 0.53) 5.3s forwards;
        }

        /* 横向扫过的金色金属光泽 */
        .ee-toast::after {
            content: '';
            position: absolute;
            top: 0; left: -100px;
            width: 60px; height: 100%;
            background: linear-gradient(90deg, transparent, rgba(251, 191, 36, 0.6), transparent);
            transform: skewX(-30deg);
            animation: ee-sweep-light 3s ease-in-out 0.5s infinite;
        }

        /* 光速倾斜冲刺入场，带刹车回弹感 */
        @keyframes ee-dash-in {
            0% { opacity: 0; transform: translateX(100vw) skewX(-20deg); filter: blur(5px); }
            60% { opacity: 1; transform: translateX(-15px) skewX(10deg); filter: blur(0); }
            80% { transform: translateX(10px) skewX(-5deg); }
            100% { transform: translateX(0) skewX(0); }
        }

        /* 停留时的金色呼吸发光 */
        @keyframes ee-breathe {
            0%, 100% { box-shadow: inset 0 0 20px rgba(251, 191, 36, 0.15), 0 10px 30px rgba(0,0,0,0.5); }
            50% { box-shadow: inset 0 0 40px rgba(251, 191, 36, 0.4), 0 10px 30px rgba(251, 191, 36, 0.2); }
        }

        /* 蓄力后光速倾斜冲刺出场 */
        @keyframes ee-dash-out {
            0% { transform: translateX(0) skewX(0); opacity: 1; }
            20% { transform: translateX(20px) skewX(15deg); opacity: 1; }
            100% { transform: translateX(-100vw) skewX(-30deg); opacity: 0; filter: blur(4px); }
        }

        /* 表面扫光效果 */
        @keyframes ee-sweep-light {
            0% { left: -100px; }
            50%, 100% { left: 150%; }
        }

        /* 图标徽章：金色渐变底 + 发光 + 俏皮倾斜 */
        .ee-icon-box {
            display: flex; justify-content: center; align-items: center;
            width: 44px; height: 44px;
            background: linear-gradient(135deg, #f59e0b, #d97706);
            border-radius: 8px;
            color: #fff; font-size: 20px;
            box-shadow: 0 0 15px rgba(245, 158, 11, 0.6);
            transform: rotate(-5deg);
        }

        /* 番茄钟波纹特效（已废弃，保留样式以防外部引用） */
        .ee-ripple-box { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 100%; height: 100%; pointer-events: none; z-index: 10; }
        .ee-ripple-circle { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); border-radius: 50%; border: 3px solid #ff6b6b; box-shadow: 0 0 20px #ff6b6b, inset 0 0 10px #ff6b6b; animation: ee-ripple-anim 1.5s cubic-bezier(0.1, 0.8, 0.3, 1) forwards; opacity: 0; }
        @keyframes ee-ripple-anim { 0% { width: 100%; height: 100%; opacity: 0.8; border-width: 4px; } 100% { width: 220%; height: 220%; opacity: 0; border-width: 0px; } }

        /* 统一的全屏特效画布 */
        #ee-canvas { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 9998; }

        /* 心流极光效果（已废弃，改用Canvas实现） */
        .ee-aurora-glow {
            border-radius: 50% !important;
            box-shadow: 0 0 25px 5px rgba(0, 255, 170, 0.4), inset 0 0 15px rgba(0, 200, 255, 0.3) !important;
            border-color: rgba(0, 255, 170, 0.6) !important;
            animation: ee-aurora-anim 3s infinite alternate ease-in-out !important;
            transition: all 1s ease;
        }
        @keyframes ee-aurora-anim {
            0% { filter: hue-rotate(0deg); box-shadow: 0 0 25px 5px rgba(0, 255, 170, 0.4); }
            100% { filter: hue-rotate(60deg); box-shadow: 0 0 25px 5px rgba(0, 170, 255, 0.4); }
        }

        /* 禅意屏幕呼吸变白（已废弃，改用Canvas实现） */
        #ee-zen-overlay {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background-color: rgba(255, 255, 255, 0); pointer-events: none; z-index: 9997;
            animation: ee-zen-breath 3s ease-out forwards;
        }
        @keyframes ee-zen-breath {
            0% { background-color: rgba(255, 255, 255, 0); }
            30% { background-color: rgba(255, 255, 255, 0.5); }
            100% { background-color: rgba(255, 255, 255, 0); }
        }

        /* 星铸徽章：操作行一次性金色描边脉冲 */
        .ee-row-pulse { animation: ee-row-pulse-anim 0.65s ease-out 1; }
        @keyframes ee-row-pulse-anim {
            0% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.55); }
            100% { box-shadow: 0 0 0 12px rgba(251, 191, 36, 0); }
        }
    `;
    document.head.appendChild(style);
})();

// ==================== 锚点系统 ====================
// 彩蛋特效不再铺满全屏：触发瞬间捕获操作元素在视口中的中心坐标，
// 粒子的生成域与绘制域收敛到锚点附近（画布仍为 fixed 全屏层，粒子可自由飞出锚点区）。
// 坐标为触发帧快照，后续行塌陷/重渲染/DOM 删除均不影响已入队彩蛋的播放位置。

function ee_fallbackAnchor() {
    return { x: window.innerWidth / 2, y: window.innerHeight * 0.35 };
}

// 捕获元素中心点（fixed 视口坐标）
function ee_captureAnchor(el) {
    try {
        if (el && el.getBoundingClientRect && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 || r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
    } catch (e) { /* 元素可能已脱离 DOM，静默回退 */ }
    return null;
}

// 归一化锚点参数：坐标快照直接透传；元素在调用时刻捕获。
// 调用方若在 DOM 重建后才触发彩蛋（如子任务面板 renderSubtasks 先于彩蛋触发），
// 应提前用 ee_captureAnchor 捕获快照后传坐标对象。
function ee_normalizeAnchor(x) {
    if (x && typeof x.x === 'number' && typeof x.y === 'number') return x;
    return ee_captureAnchor(x);
}

// 解析任务类彩蛋锚点：调用方直传的操作元素（点击源）优先；
// 其次主视图中该任务第一个可见条目（与 _playTaskDoneCollapseFx 的 anchors 口径一致）；
// 兜底视口中心偏上（覆盖改日期触发等非点击路径）
function ee_resolveTaskAnchor(taskId, sourceEl) {
    const fromSrc = ee_normalizeAnchor(sourceEl);
    if (fromSrc) return fromSrc;
    if (taskId) {
        try {
            const anchors = document.querySelectorAll(`[onclick*="toggleTaskComplete('${taskId}')"]`);
            for (const el of anchors) {
                if (el.offsetParent !== null) {
                    const a = ee_captureAnchor(el);
                    if (a) return a;
                }
            }
        } catch (e) { /* 选择器异常时走兜底 */ }
    }
    return ee_fallbackAnchor();
}

// 番茄类彩蛋锚点：番茄钟圆环（回主视图播放时必然可见，播放时实时取位）
function ee_resolvePomodoroAnchor() {
    return ee_captureAnchor(document.getElementById('pomodoro-circle')) || ee_fallbackAnchor();
}

// 星铸徽章：为操作行加一次性金色描边脉冲（DOM 层微反馈；性能分级为 0 时不播）
function ee_pulseRow(taskId, sourceEl) {
    if (ee_getFxTier() === 0) return;
    let row = null;
    if (sourceEl && sourceEl.closest) row = sourceEl.closest('.task-row');
    if (!row && taskId) {
        try {
            document.querySelectorAll(`[onclick*="toggleTaskComplete('${taskId}')"]`).forEach(el => {
                if (!row && el.offsetParent !== null) row = el.closest('.task-row');
            });
        } catch (e) { /* 忽略，脉冲为可选增强 */ }
    }
    if (!row) return;
    row.classList.add('ee-row-pulse');
    setTimeout(() => row.classList.remove('ee-row-pulse'), 700);
}

// ==================== 性能分级 ====================
// 0 = 不播 canvas 特效（仅 toast）：系统级「减弱动态效果」
// 1 = 低配档：核心数 ≤4 或内存 ≤4GB —— 粒子约减半、时长 -30%、禁用 lighter 混合与 shadowBlur
// 2 = 完整档
// 注意：smoothAnimations 是「平滑过渡动画」开关（视图过渡/塌陷类 fx），
// 彩蛋自有 easterEggEnabled 开关，此处不跨界联动，保证默认体验不变
let ee_fxTierCache = null;
function ee_getFxTier() {
    if (ee_fxTierCache !== null) return ee_fxTierCache;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return (ee_fxTierCache = 0);
    }
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
    const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;
    if (cores <= 4 || mem <= 4) return (ee_fxTierCache = 1);
    return (ee_fxTierCache = 2);
}

// ==================== 核心状态管理 ====================
let eeState = {
    date: '',
    completedTasks: 0,
    focusMinutes: 0,
    consecutivePomodoros: 0,
    lastPomodoroTime: 0,
    lastPomodoroEndTime: 0,  // 记录上一个番茄钟结束的时间戳（心流大师）
    recentDeletes: [],       // 记录最近删除的任务时间（断舍离）
    triggered: { firstTask: false, threePomodoros: false, twoHours: false, sunsetHorizon: false },
    pendingEffects: [],       // 待显示的彩蛋效果队列 {type, icon, message, effectFn}
    voidStateTriggeredTasks: new Set(),  // 已触发坐忘无我的taskId集合
    supernovaTriggeredTasks: new Set(),  // 已触发超新星爆发的taskId集合
    recentSubtaskCompletes: [],          // 最近子任务完成时间戳（多线程大师）
};

function ee_checkDate() {
    const today = new Date().toLocaleDateString();
    if (eeState.date !== today) {
        eeState = { date: today, completedTasks: 0, focusMinutes: 0, consecutivePomodoros: 0, lastPomodoroTime: 0, lastPomodoroEndTime: 0, recentDeletes: [], triggered: { firstTask: false, threePomodoros: false, twoHours: false, sunsetHorizon: false }, pendingEffects: [], voidStateTriggeredTasks: new Set(), supernovaTriggeredTasks: new Set(), recentSubtaskCompletes: [] };
    }
}

// ==================== UI 展现层 ====================

// 1. 显示文字吐司
function ee_showToast(icon, message, desc) {
    // 设置项 easterEggEnabled：关闭时不显示彩蛋提示
    if (settings && settings.easterEggEnabled === false) return;
    let container = document.getElementById('ee-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'ee-toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'ee-toast';
    // 使用 FontAwesome 图标替代 emoji，避免跨平台显示问题
    const iconMap = {
        '🎉': 'fa-gift',
        '⚡': 'fa-bolt',
        '🏆': 'fa-trophy',
        '🍵': 'fa-mug-hot',
        '🍅': 'fa-pepper-hot',
        '🍃': 'fa-leaf',
        '🌊': 'fa-water',
        '🍂': 'fa-fan',
        '🌄': 'fa-mountain',
        '🌌': 'fa-moon',
        '🌟': 'fa-star',
        '🏅': 'fa-medal'
    };
    const iconClass = iconMap[icon] || 'fa-star';
    toast.innerHTML = `
        <div class="ee-icon-box relative z-10 flex-shrink-0">
            <i class="fas ${iconClass}"></i>
        </div>
        <div class="flex flex-col justify-center relative z-10">
            <span class="text-[10px] font-black text-amber-400 tracking-[0.25em] uppercase leading-none mb-1 drop-shadow-md">
                SECRET UNLOCKED
            </span>
            <span class="text-base font-bold text-slate-100 tracking-wide leading-none drop-shadow-lg">
                ${message}
            </span>
            ${desc ? `<span class="text-[11px] text-slate-400 mt-1 leading-tight">${desc}</span>` : ''}
        </div>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 6500);
}

// ==================== Canvas 物理特效引擎 ====================
let ee_canvas, ee_ctx, ee_particles = [], ee_animId;

function ee_initCanvas() {
    if (ee_canvas) return;
    ee_canvas = document.createElement('canvas');
    ee_canvas.id = 'ee-canvas';
    // 确保画布永远在最上层且不阻挡任何点击
    ee_canvas.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 9998;';
    document.body.appendChild(ee_canvas);
    ee_ctx = ee_canvas.getContext('2d');

    const resize = () => { ee_canvas.width = window.innerWidth; ee_canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize);
    resize();
}

// 运行时掉帧守护：连续 5 帧间隔 >34ms（约低于 30fps）时，当前批次粒子运行时减半（每批仅一次），
// 防止低性能终端因彩蛋卡顿；批次结束（粒子清空）后自动复位
let _eeLastFrameTs = 0, _eeSlowFrames = 0, _eeThinned = false;
function _eeThinOutActive() {
    _eeThinned = true;
    for (const p of ee_particles) {
        if (typeof p.thinOut === 'function') p.thinOut();
    }
    // 独立小粒子（礼花等）直接减半；容器型粒子已由 thinOut 处理内部元素
    if (ee_particles.length > 1) {
        ee_particles.length = Math.max(1, Math.ceil(ee_particles.length / 2));
    }
}

function ee_animate() {
    if (ee_particles.length === 0) {
        ee_ctx.clearRect(0, 0, ee_canvas.width, ee_canvas.height);
        cancelAnimationFrame(ee_animId);
        ee_animId = null;
        _eeLastFrameTs = 0; _eeSlowFrames = 0; _eeThinned = false; // 复位守护状态
        return;
    }
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (_eeLastFrameTs) {
        if (now - _eeLastFrameTs > 34) {
            if (++_eeSlowFrames >= 5 && !_eeThinned) _eeThinOutActive();
        } else {
            _eeSlowFrames = 0;
        }
    }
    _eeLastFrameTs = now;
    // 每次绘制前清空画布，拖尾依靠粒子自带的历史数组实现，保持背景完全透明
    ee_ctx.clearRect(0, 0, ee_canvas.width, ee_canvas.height);
    for (let i = ee_particles.length - 1; i >= 0; i--) {
        const p = ee_particles[i];
        p.update();
        p.draw(ee_ctx);
        if (p.isDead()) ee_particles.splice(i, 1);
    }
    ee_animId = requestAnimationFrame(ee_animate);
}

// 预渲染发光精灵缓存：用离屏 canvas 一次性生成径向渐变，后续用 drawImage 复用
// 避免 per-particle shadowBlur / createRadialGradient 导致的严重卡顿
const ee_glowCache = {};
function ee_glow(color) {
    if (ee_glowCache[color]) return ee_glowCache[color];
    const size = 48;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const cx = c.getContext('2d');
    const grad = cx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    grad.addColorStop(0, color);
    grad.addColorStop(0.4, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, size, size);
    ee_glowCache[color] = c;
    return c;
}

// ==================== 粒子特效类 ====================

// 抛物线礼花粒子 (首战告捷)
class ConfettiParticle {
    constructor(isLeft) {
        this.x = isLeft ? 0 : window.innerWidth;
        this.y = window.innerHeight * 0.6;
        this.vx = (Math.random() * 15 + 5) * (isLeft ? 1 : -1);
        this.vy = -(Math.random() * 15 + 10);
        this.gravity = 0.6;
        this.size = Math.random() * 8 + 6;
        this.color = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4'][Math.floor(Math.random() * 7)];
        this.rotation = Math.random() * 360;
        this.rotationSpeed = (Math.random() - 0.5) * 20;
        this.life = 100;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += this.gravity;
        this.rotation += this.rotationSpeed;
        this.life--;
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation * Math.PI / 180);
        ctx.fillStyle = this.color;
        ctx.globalAlpha = Math.max(0, this.life / 30);
        ctx.fillRect(-this.size/2, -this.size/2, this.size, this.size);
        ctx.restore();
    }
    isDead() { return this.life <= 0 || this.y > window.innerHeight; }
}

// 飘叶粒子 (专注力爆棚) - 围绕番茄部件盘旋上升的小旋涡（锚点：番茄部件；Canvas路径绘制叶子，避免离线模式emoji渲染为黑色方块）
class LeafParticle {
    constructor(anchor) {
        const a = anchor || ee_resolvePomodoroAnchor();
        const low = ee_getFxTier() <= 1;
        // 生成于锚点周围半径 ~160px 的圆域内，缓缓盘旋上升
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.random() * 160;
        this.x = a.x + Math.cos(ang) * dist;
        this.y = a.y + Math.sin(ang) * dist;
        this.vy = -(Math.random() * 1.2 + 0.6);   // 缓缓上升
        this.angle = Math.random() * Math.PI * 2;
        this.spin = (Math.random() - 0.5) * 0.1;
        this.size = Math.random() * 12 + 14;
        this.life = low ? 140 : 200;
        this.maxLife = this.life;
        const greens = ['#4caf50', '#66bb6a', '#43a047', '#388e3c', '#2e7d32', '#81c784'];
        this.color = greens[Math.floor(Math.random() * greens.length)];
    }
    update() {
        this.life--;
        this.y += this.vy;
        this.angle += this.spin;
        // 水平正弦摆动，与上升叠加形成盘旋轨迹
        this.x += Math.sin(this.angle) * 1.6;
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(Math.sin(this.angle));
        const p = 1 - this.life / this.maxLife;
        ctx.globalAlpha = Math.sin(p * Math.PI) * 0.85;
        // 绘制叶子形状（纺锤形）
        const s = this.size;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.moveTo(0, -s / 2);
        ctx.bezierCurveTo(s * 0.4, -s * 0.3, s * 0.4, s * 0.3, 0, s / 2);
        ctx.bezierCurveTo(-s * 0.4, s * 0.3, -s * 0.4, -s * 0.3, 0, -s / 2);
        ctx.fill();
        // 叶脉
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -s / 2);
        ctx.lineTo(0, s / 2);
        ctx.stroke();
        ctx.restore();
    }
    isDead() { return this.life <= 0; }
}

// ---- 粒子通用缓动 / 颜色工具 ----
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
const _EE_HEX_CACHE = {};
function hexToRgbaString(hex, alpha) {
    if (!hex) return `rgba(255, 255, 255, ${alpha})`;
    let v = _EE_HEX_CACHE[hex];
    if (!v) {
        const h = hex.replace('#', '');
        v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        _EE_HEX_CACHE[hex] = v;
    }
    return `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${alpha})`;
}

// 百步穿杨粒子 - 金矢自右上飞入命中锚点，冲击环 + 金屑迸溅 (0 shadowBlur)
class GoldenBullseyeParticle {
    constructor(anchor) {
        const a = anchor || ee_fallbackAnchor();
        const low = ee_getFxTier() <= 1;
        this.low = low;
        this.ax = a.x; this.ay = a.y; // 靶心（锚点）
        this.life = low ? 110 : 150;
        this.maxLife = this.life;
        this.aimFrames = 16; // 前 16 帧金矢飞入
        // 金矢自右上入场，指向锚点
        this.sx = a.x + 200;
        this.sy = a.y - 160;
        // 命中后迸溅的金屑（抛物线）
        this.sparks = [];
        const n = low ? 24 : 50;
        for (let i = 0; i < n; i++) {
            const ang = -Math.PI + Math.random() * Math.PI; // 上半圆抛洒
            const speed = Math.random() * 6 + 2;
            this.sparks.push({
                x: this.ax, y: this.ay,
                vx: Math.cos(ang) * speed,
                vy: Math.sin(ang) * speed - 2,
                size: Math.random() * 3 + 1.5,
                color: ['#FFD700', '#DAA520', '#F0E68C', '#FFA500'][Math.floor(Math.random() * 4)]
            });
        }
    }
    update() {
        this.life--;
        const timeSpent = this.maxLife - this.life;
        if (timeSpent > this.aimFrames) {
            // 金屑抛物线：重力下坠
            this.sparks.forEach(s => {
                s.x += s.vx; s.y += s.vy;
                s.vy += 0.18;
            });
        }
    }
    draw(ctx) {
        const timeSpent = this.maxLife - this.life;
        const p = Math.min(1, timeSpent / this.aimFrames); // 飞入进度
        const ease = 1 - Math.pow(1 - p, 3); // ease-out 减速命中
        ctx.save();
        ctx.globalCompositeOperation = this.low ? 'source-over' : 'lighter';

        // 阶段 1：金矢飞入（描边拖尾 + 矢头）
        if (p < 1) {
            const tipX = this.sx + (this.ax - this.sx) * ease;
            const tipY = this.sy + (this.ay - this.sy) * ease;
            const ang = Math.atan2(this.ay - this.sy, this.ax - this.sx);
            const trailLen = 46;
            const tailX = tipX - Math.cos(ang) * trailLen;
            const tailY = tipY - Math.sin(ang) * trailLen;
            // 拖尾两层（Fake Glow）
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tipX, tipY);
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.25)'; ctx.lineWidth = 8; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tipX, tipY);
            ctx.strokeStyle = 'rgba(255, 240, 180, 0.95)'; ctx.lineWidth = 2.5; ctx.stroke();
            // 矢头（发光精灵）
            const sz = 26;
            ctx.drawImage(ee_glow('#FFD700'), tipX - sz / 2, tipY - sz / 2, sz, sz);
        }

        // 阶段 2：命中冲击环（自锚点扩散）
        if (timeSpent >= this.aimFrames) {
            const hitT = (timeSpent - this.aimFrames) / (this.maxLife - this.aimFrames);
            const ringAlpha = Math.max(0, 1 - hitT);
            const maxR = this.low ? 70 : 100;
            const r = easeOutCubic(hitT) * maxR + 8;
            // 双层冲击环
            ctx.beginPath(); ctx.arc(this.ax, this.ay, r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 215, 0, ${ringAlpha * 0.3})`; ctx.lineWidth = 14; ctx.stroke();
            ctx.beginPath(); ctx.arc(this.ax, this.ay, r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 245, 200, ${ringAlpha * 0.9})`; ctx.lineWidth = 3; ctx.stroke();

            // 金屑（外层光晕 + 核心亮点）
            const sparkAlpha = Math.max(0, this.life / (this.maxLife * 0.4));
            this.sparks.forEach(s => {
                ctx.fillStyle = hexToRgbaString(s.color, sparkAlpha * 0.35);
                ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 2.5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = `rgba(255, 255, 255, ${sparkAlpha * 0.9})`;
                ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 0.8, 0, Math.PI * 2); ctx.fill();
            });
        }
        ctx.restore();
    }
    thinOut() { this.sparks = this.sparks.slice(0, Math.ceil(this.sparks.length / 2)); }
    isDead() { return this.life <= 0; }
}

// 莲花心境粒子 (清空禅意) - 多重青色柔和涟漪 + Canvas内全局白光呼吸，无DOM依赖（全屏版）
class ZenRippleParticle {
    constructor() {
        this.x = window.innerWidth / 2;
        this.y = window.innerHeight / 2;
        this.life = 180; // 3秒
        this.maxLife = 180;
        // 生成三个错开的涟漪
        this.ripples = Array.from({length: 3}, (_, i) => ({
            r: 0,
            targetR: Math.max(window.innerWidth, window.innerHeight) * (0.5 + i * 0.2),
            delay: i * 25 // 延迟触发时间
        }));
    }
    update() {
        this.life--;
        const timeSpent = this.maxLife - this.life;
        this.ripples.forEach(rip => {
            if (timeSpent > rip.delay) {
                rip.r += (rip.targetR - rip.r) * 0.02; // 极其缓慢、平和的扩张
            }
        });
    }
    draw(ctx) {
        const timeSpent = this.maxLife - this.life;
        ctx.save();

        // 1. 绘制禅意涟漪 (Fake Glow：双层圆环叠加替代 shadowBlur)
        this.ripples.forEach(rip => {
            if (timeSpent > rip.delay) {
                const alpha = Math.max(0, 1 - rip.r / rip.targetR) * 0.5;
                // 外层光晕：大宽度、低透明度
                ctx.beginPath();
                ctx.arc(this.x, this.y, rip.r, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(167, 216, 222, ${alpha * 0.25})`;
                ctx.lineWidth = 40;
                ctx.stroke();
                // 核心环：小宽度、高透明度
                ctx.beginPath();
                ctx.arc(this.x, this.y, rip.r, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(224, 247, 250, ${alpha * 0.9})`; // 柔和的青玉色
                ctx.lineWidth = 6;
                ctx.stroke();
            }
        });

        // 2. 绘制全屏呼吸白光 (直接在 Canvas 层实现，性能更好)
        // 前1.5秒渐白，后1.5秒渐暗
        let flashAlpha = 0;
        if (this.life > 90) flashAlpha = (180 - this.life) / 90 * 0.85;
        else flashAlpha = this.life / 90 * 0.85;

        ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

        ctx.restore();
    }
    isDead() { return this.life <= 0; }
}

// 1. 清算旧账 - 小闪电自锚点上方劈落命中锚点 + 紫/蓝能量碎片炸开 (0 shadowBlur, 纯 Fake Glow)
class ThunderStrikeParticle {
    constructor(anchor) {
        const a = anchor || ee_fallbackAnchor();
        const low = ee_getFxTier() <= 1;
        this.low = low;
        this.life = low ? 110 : 150;
        this.maxLife = this.life;
        const topY = Math.max(-40, a.y - 160); // 闪电起点（允许出屏少许，营造天降感）

        // 1. 生成曲折的闪电主干路径：自上方劈落至锚点
        this.lightningPath = [];
        let currentX = a.x + (Math.random() - 0.5) * 60; // 顶部随机偏移
        let currentY = topY;
        this.lightningPath.push({ x: currentX, y: currentY });

        while (currentY < a.y - 10) {
            currentX += (Math.random() - 0.5) * 50; // 左右折跃（幅度收敛到锚点邻域）
            currentY += Math.random() * 35 + 15;    // 向下延伸
            this.lightningPath.push({ x: currentX, y: currentY });
        }
        // 终点精确命中锚点
        this.lightningPath.push({ x: a.x, y: a.y });

        // 2. 锚点处炸开的能量碎片
        this.sparks = [];
        const n = low ? 12 : 24;
        for (let i = 0; i < n; i++) {
            this.sparks.push({
                x: a.x,
                y: a.y,
                vx: (Math.random() - 0.5) * 12, // 爆发速度（局部化后收敛）
                vy: (Math.random() - 0.5) * 8 - 2,
                size: Math.random() * 3 + 1.5,
                color: Math.random() > 0.5 ? '180, 100, 255' : '100, 220, 255' // 电光紫与荧光蓝交织
            });
        }
    }

    update() {
        this.life--;
        this.sparks.forEach(s => {
            s.x += s.vx;
            s.y += s.vy;
            s.vx *= 0.9; // 空气阻力，模拟"爆开后迅速减速"
            s.vy *= 0.9;
            s.vy += 0.25;  // 附加轻微重力使其缓缓下坠
        });
    }

    draw(ctx) {
        const timeSpent = this.maxLife - this.life;

        ctx.save();
        if (!this.low) ctx.globalCompositeOperation = 'lighter'; // 叠加发光

        // ================= 阶段 1：雷霆劈落 (前 15 帧) =================
        if (timeSpent < 15) {
            const strikeAlpha = 1 - (timeSpent / 15);

            // 落点局部径向光斑（替代全屏闪白，收敛于 r=90）
            const flash = ctx.createRadialGradient(
                this.lightningPath[this.lightningPath.length - 1].x,
                this.lightningPath[this.lightningPath.length - 1].y, 0,
                this.lightningPath[this.lightningPath.length - 1].x,
                this.lightningPath[this.lightningPath.length - 1].y, 90);
            flash.addColorStop(0, `rgba(220, 200, 255, ${strikeAlpha * 0.55})`);
            flash.addColorStop(1, 'rgba(220, 200, 255, 0)');
            ctx.fillStyle = flash;
            const fx = this.lightningPath[this.lightningPath.length - 1].x;
            const fy = this.lightningPath[this.lightningPath.length - 1].y;
            ctx.fillRect(fx - 90, fy - 90, 180, 180);

            // 绘制闪电本体 (Fake Glow 替代 shadowBlur)
            const drawLightningLayer = (width, alpha, color) => {
                ctx.beginPath();
                ctx.moveTo(this.lightningPath[0].x, this.lightningPath[0].y);
                for (let i = 1; i < this.lightningPath.length; i++) {
                    ctx.lineTo(this.lightningPath[i].x, this.lightningPath[i].y);
                }
                ctx.strokeStyle = `rgba(${color}, ${strikeAlpha * alpha})`;
                ctx.lineWidth = width;
                ctx.lineJoin = 'miter';
                ctx.stroke();
            };

            // 三层叠加，瞬间产生极强的发光质感
            drawLightningLayer(16, 0.25, '150, 0, 255');  // 底层：宽厚的紫色环境光晕
            drawLightningLayer(6, 0.6, '200, 150, 255');  // 中层：明亮的电光紫
            drawLightningLayer(2, 1.0, '255, 255, 255');  // 顶层：纯白锐利的核心
        }

        // ================= 阶段 2：能量碎片消散 (全程) =================
        let sparkAlpha = 1;
        if (timeSpent < 5) sparkAlpha = timeSpent / 5; // 头 5 帧碎片渐入
        else sparkAlpha = Math.max(0, this.life / (this.maxLife - 5)); // 随后平滑淡出

        this.sparks.forEach(s => {
            // Fake Glow 碎片渲染法
            // 第一层：外圈柔和光晕
            ctx.fillStyle = `rgba(${s.color}, ${sparkAlpha * 0.35})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size * 3.5, 0, Math.PI * 2);
            ctx.fill();

            // 第二层：纯白/高亮核心
            ctx.fillStyle = `rgba(255, 255, 255, ${sparkAlpha * 0.95})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size * 0.8, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();
    }

    thinOut() { this.sparks = this.sparks.slice(0, Math.ceil(this.sparks.length / 2)); }
    isDead() { return this.life <= 0; }
}

// 4. 番茄三连 - 精灵之森魔法阵围绕番茄圈绽放 (蓝绿色基调，几何魔法光环)
class FocusRippleParticle {
    constructor(anchor) {
        const a = anchor || ee_resolvePomodoroAnchor();
        const low = ee_getFxTier() <= 1;
        this.low = low;
        this.life = low ? 160 : 260; this.maxLife = this.life;
        const offset = low ? 55 : 75;

        // 品字形三个魔法阵中心（低配档收敛为单阵）
        this.circles = low
            ? [{ x: a.x, y: a.y, delay: 0 }]
            : [
                { x: a.x, y: a.y - offset, delay: 0 },
                { x: a.x - offset * 0.9, y: a.y + offset * 0.6, delay: 40 },
                { x: a.x + offset * 0.9, y: a.y + offset * 0.6, delay: 80 }
            ];
        this.maxR = low ? 50 : 70;
    }
    update() { this.life--; }
    drawMagicCircle(ctx, x, y, radius, rotation, alpha) {
        ctx.save();
        ctx.translate(x, y); ctx.rotate(rotation);

        // 外圈符文虚线 (Fake Glow：外层粗描边光晕 + 内层细描边核心)
        // 光晕层
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI*2);
        ctx.setLineDash([15, 20]); ctx.lineWidth = 14;
        ctx.strokeStyle = `rgba(0, 255, 170, ${alpha * 0.2})`;
        ctx.stroke();
        // 核心层
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI*2);
        ctx.setLineDash([15, 20]); ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(0, 255, 170, ${alpha})`; ctx.stroke();

        // 内圈实线与几何三角形
        ctx.setLineDash([]);
        // 光晕层
        ctx.beginPath(); ctx.arc(0, 0, radius * 0.8, 0, Math.PI*2);
        ctx.lineWidth = 8; ctx.strokeStyle = `rgba(0, 200, 255, ${alpha * 0.2})`; ctx.stroke();
        // 核心层
        ctx.beginPath(); ctx.arc(0, 0, radius * 0.8, 0, Math.PI*2);
        ctx.lineWidth = 2; ctx.strokeStyle = `rgba(0, 200, 255, ${alpha * 0.8})`; ctx.stroke();

        ctx.beginPath();
        for(let i=0; i<3; i++) {
            const a = (Math.PI*2/3) * i - Math.PI/2;
            ctx.lineTo(Math.cos(a)*radius*0.8, Math.sin(a)*radius*0.8);
        }
        ctx.closePath(); ctx.stroke();
        ctx.restore();
    }
    draw(ctx) {
        const timeSpent = this.maxLife - this.life;
        ctx.save();
        ctx.globalCompositeOperation = this.low ? 'source-over' : 'screen';

        this.circles.forEach(c => {
            if (timeSpent > c.delay) {
                const cLife = timeSpent - c.delay;
                const cDuration = this.maxLife - c.delay;
                if (cLife < cDuration) {
                    const progress = cLife / cDuration;
                    // 弹簧阻尼放大效果
                    const r = (1 - Math.pow(1 - progress, 4)) * this.maxR;
                    const alpha = Math.sin(progress * Math.PI); // 0->1->0
                    const rotation = timeSpent * 0.02; // 魔法阵旋转

                    this.drawMagicCircle(ctx, c.x, c.y, r, rotation, alpha);

                    // 绽放的生命荧光（低配档跳过，每帧随机点开销可省）
                    if (!this.low) {
                        for(let i=0; i<3; i++) {
                            const a = Math.random() * Math.PI * 2;
                            const dist = Math.random() * r;
                            ctx.fillStyle = `rgba(100, 255, 200, ${alpha})`;
                            ctx.beginPath(); ctx.arc(c.x + Math.cos(a)*dist, c.y + Math.sin(a)*dist, Math.random()*3+1, 0, Math.PI*2);
                            ctx.fill();
                        }
                    }
                }
            }
        });
        ctx.restore();
    }
    isDead() { return this.life <= 0; }
}

// 心流极光波纹粒子 (全屏Canvas) - 三条波浪线从右向左入场展开（全屏版）
class AuroraWaveParticle {
    constructor() {
        this.time = 0;
        this.life = 360;
        this.maxLife = 360;
        // 入场动画进度：0 -> 1，约1秒完成
        this.entry = 0;
        this.entryDuration = 60; // 1秒 (60fps)
    }
    update() {
        this.time += 0.02;
        if (this.entry < 1) {
            this.entry = Math.min(1, this.entry + 1 / this.entryDuration);
        }
        this.life--;
    }
    draw(ctx) {
        const w = ee_canvas.width;
        const h = ee_canvas.height;
        // 入场期间透明度也随进度淡入
        const alpha = Math.min(1, this.life / 60) * 0.4 * this.entry;
        const colors = [[0, 255, 170], [0, 200, 255], [100, 255, 150]];
        // 入场期间可见宽度从右向左逐渐展开
        const visibleWidth = w * this.entry;
        for (let band = 0; band < 3; band++) {
            const [r, g, b] = colors[band];
            const offset = band * 40;
            ctx.save();
            // 裁剪区域：从右侧边缘向左逐渐展开
            ctx.beginPath();
            ctx.rect(w - visibleWidth, 0, visibleWidth, h);
            ctx.clip();
            // 生成波浪路径
            const path = new Path2D();
            for (let x = 0; x <= w; x += 8) {
                const y = h * 0.25 + Math.sin(x * 0.006 + this.time + band * 1.5) * 40 + offset;
                if (x === 0) path.moveTo(x, y);
                else path.lineTo(x, y);
            }
            // Fake Glow：外层粗描边光晕
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.25})`;
            ctx.lineWidth = 12;
            ctx.stroke(path);
            // 核心层：细描边高亮度
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            ctx.lineWidth = 3;
            ctx.stroke(path);
            ctx.restore();
        }
    }
    isDead() { return this.life <= 0; }
}

// 2. 落日归山 - 绝美晚霞与动态重峦叠嶂 (群山剪影+体积光霞，全屏版)
class SunsetHorizonParticle {
    constructor() {
        this.life = 260; this.maxLife = 260; // 约4.3秒，符合4-5秒时长要求
        // 生成远中近三层山脉的多边形节点
        this.mountains = [
            { points: this.genMountain(0.005, 0.4), color: 'rgba(50, 20, 60, ', speed: 0.25 },
            { points: this.genMountain(0.008, 0.6), color: 'rgba(30, 10, 40, ', speed: 0.6 },
            { points: this.genMountain(0.015, 0.8), color: 'rgba(15, 5, 20, ', speed: 1.2 }
        ];
    }
    genMountain(freq, heightPerc) {
        const pts = [];
        for(let x = 0; x <= window.innerWidth + 200; x += 20) {
            pts.push({x: x, y: window.innerHeight * heightPerc + Math.sin(x * freq) * 100 + Math.cos(x * freq * 2) * 30});
        }
        return pts;
    }
    update() {
        this.life--;
        this.mountains.forEach(m => m.points.forEach(p => p.x -= m.speed));
    }
    draw(ctx) {
        const timeSpent = this.maxLife - this.life;
        const alpha = Math.sin((timeSpent / this.maxLife) * Math.PI);
        const w = window.innerWidth, h = window.innerHeight;
        ctx.save();

        // 1. 晚霞天空 (带体积光)
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, `rgba(255, 80, 80, ${alpha * 0.7})`);
        sky.addColorStop(0.5, `rgba(255, 150, 50, ${alpha * 0.9})`);
        sky.addColorStop(1, `rgba(255, 220, 100, ${alpha * 0.8})`);
        ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

        // 2. 巨型落日 (极强光晕) - 退场时间提前，先于山脉消失
        ctx.globalCompositeOperation = 'lighter';
        const sunY = h * 0.4 + (timeSpent * 0.58); // 太阳缓缓落下（略提速以适配更短时长）
        // 太阳在动画 60%~80% 阶段提前淡出，山脉随主 alpha 在 80%~100% 阶段消失
        const sunFade = Math.max(0, Math.min(1, (0.8 * this.maxLife - timeSpent) / (0.2 * this.maxLife)));
        const sunAlpha = alpha * sunFade;
        const sunGrad = ctx.createRadialGradient(w/2, sunY, 0, w/2, sunY, 300);
        sunGrad.addColorStop(0, `rgba(255, 255, 255, ${sunAlpha})`);
        sunGrad.addColorStop(0.2, `rgba(255, 200, 0, ${sunAlpha * 0.8})`);
        sunGrad.addColorStop(1, `rgba(255, 50, 0, 0)`);
        ctx.fillStyle = sunGrad; ctx.fillRect(0, 0, w, h);

        // 3. 层峦叠嶂 (正常混合模式)
        ctx.globalCompositeOperation = 'source-over';
        this.mountains.forEach(m => {
            ctx.beginPath();
            ctx.moveTo(m.points[0].x, h);
            m.points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.lineTo(m.points[m.points.length-1].x, h);
            ctx.closePath();
            // 山顶受光面模拟
            const mGrad = ctx.createLinearGradient(0, h*0.4, 0, h);
            mGrad.addColorStop(0, m.color + `${alpha})`);
            mGrad.addColorStop(1, `rgba(0,0,0,${alpha})`);
            ctx.fillStyle = mGrad; ctx.fill();
        });
        ctx.restore();
    }
    isDead() { return this.life <= 0; }
}

// 坐忘无我粒子 (单任务专注超3小时) - 浅蓝氛围 + 缓慢上浮发光微粒（全屏版）
class VoidStateParticle {
    constructor() {
        this.life = 240; // 4秒（在5秒内，保留深沉的时间流逝感）
        this.maxLife = 240;
        this.motes = Array.from({length: 50}, () => ({
            x: Math.random() * window.innerWidth,
            y: window.innerHeight + Math.random() * 200,
            vx: (Math.random() - 0.5) * 0.4,
            vy: -(Math.random() * 1.5 + 0.5),
            size: Math.random() * 2.5 + 1,
            phase: Math.random() * Math.PI * 2
        }));
    }
    update() {
        this.life--;
        this.motes.forEach(m => {
            m.x += m.vx + Math.sin(m.phase) * 0.6; // 水平正弦摇摆
            m.y += m.vy;
            m.phase += 0.015;
        });
    }
    draw(ctx) {
        const alpha = Math.sin((1 - this.life / this.maxLife) * Math.PI);
        const w = window.innerWidth;
        const h = window.innerHeight;

        ctx.save();
        // 1. 绘制浅蓝氛围 (径向渐变，中心透明边缘浅蓝，替代原暗角)
        const grad = ctx.createRadialGradient(w/2, h/2, h*0.2, w/2, h/2, h);
        grad.addColorStop(0, `rgba(180, 220, 255, 0)`);
        grad.addColorStop(1, `rgba(120, 180, 255, ${alpha * 0.5})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // 2. 绘制深蓝微光粒子 (Fake Glow：双层透明圆叠加，避免 per-particle createRadialGradient)
        ctx.globalCompositeOperation = 'screen';
        this.motes.forEach(m => {
            const glowRadius = m.size * 4;
            // 外层光晕：大半径、低透明度
            ctx.fillStyle = `rgba(100, 200, 255, ${alpha * 0.25})`;
            ctx.beginPath();
            ctx.arc(m.x, m.y, glowRadius, 0, Math.PI * 2);
            ctx.fill();
            // 核心高亮：小半径、高透明度
            ctx.fillStyle = `rgba(200, 230, 255, ${alpha * 0.9})`;
            ctx.beginPath();
            ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }
    isDead() { return this.life <= 0; }
}

// 3. 超新星爆发 - 锚点处星系坍缩与大爆炸 (蓄力环→粒子迸发，绘制域收敛于锚点 ±shockR)
class SupernovaParticle {
    constructor(anchor) {
        const a = anchor || ee_fallbackAnchor();
        const low = ee_getFxTier() <= 1;
        this.low = low;
        this.cx = a.x; this.cy = a.y;
        this.life = low ? 180 : 260;
        this.maxLife = this.life;
        this.chargeFrames = low ? 45 : 70; // 坍缩蓄力帧数
        this.shockR = low ? 180 : 250;     // 冲击星云半径上限

        // 爆发粒子
        const n = low ? 32 : 70;
        this.particles = Array.from({length: n}, () => {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 22 + 5; // 局部化后速度收敛
            return {
                x: this.cx, y: this.cy,
                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                history: [], trailLen: low ? 3 : 6, size: Math.random() * 3 + 1,
                color: ['#ffffff', '#00ffff', '#ffdd00', '#ff5500'][Math.floor(Math.random()*4)]
            };
        });
    }
    update() {
        this.life--;
        const timeSpent = this.maxLife - this.life;
        if (timeSpent > this.chargeFrames) { // 蓄力后爆炸
            this.particles.forEach(p => {
                p.history.push({x: p.x, y: p.y});
                if (p.history.length > p.trailLen) p.history.shift();
                p.x += p.vx; p.y += p.vy;
                p.vx *= 0.94; p.vy *= 0.94;
            });
        }
    }
    draw(ctx) {
        const timeSpent = this.maxLife - this.life;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        if (timeSpent <= this.chargeFrames) {
            // 阶段一：引力坍缩环（纯描边环收敛，无 shadowBlur）
            const progress = timeSpent / this.chargeFrames;
            const r = (1 - Math.pow(progress, 3)) * this.shockR * 0.7 + 12;
            ctx.beginPath(); ctx.arc(this.cx, this.cy, r, 0, Math.PI*2);
            ctx.lineWidth = 12 * progress;
            ctx.strokeStyle = `rgba(0, 200, 255, ${progress * 0.7})`; ctx.stroke();
            // 内层亮环
            ctx.beginPath(); ctx.arc(this.cx, this.cy, r, 0, Math.PI*2);
            ctx.lineWidth = 3;
            ctx.strokeStyle = `rgba(200, 250, 255, ${progress})`; ctx.stroke();

            // 核心高能聚集 (发光精灵替代shadowBlur)
            ctx.globalAlpha = Math.pow(progress, 4);
            const coreSize = progress * 64;
            ctx.drawImage(ee_glow('#ffffff'), this.cx - coreSize/2, this.cy - coreSize/2, coreSize, coreSize);
            ctx.globalAlpha = 1;
        } else {
            // 阶段二：超新星绚丽大爆炸
            const expProgress = (timeSpent - this.chargeFrames) / (this.maxLife - this.chargeFrames);
            const alpha = 1 - Math.pow(expProgress, 2);

            // 冲击星云（径向渐变收敛于 shockR，非全屏）
            const nebula = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.shockR * expProgress + 20);
            nebula.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.8})`);
            nebula.addColorStop(0.1, `rgba(0, 255, 255, ${alpha * 0.6})`);
            nebula.addColorStop(0.4, `rgba(150, 0, 255, ${alpha * 0.3})`);
            nebula.addColorStop(1, `rgba(0, 0, 0, 0)`);
            ctx.fillStyle = nebula;
            const R = this.shockR + 20;
            ctx.fillRect(this.cx - R, this.cy - R, R * 2, R * 2);

            // 绘制流星拖尾 (无shadowBlur，依靠 lighter 混合发光)
            ctx.lineCap = 'round';
            this.particles.forEach(p => {
                if (p.history.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(p.history[0].x, p.history[0].y);
                    for (let i = 1; i < p.history.length; i++) ctx.lineTo(p.history[i].x, p.history[i].y);
                    ctx.lineTo(p.x, p.y);
                    ctx.globalAlpha = alpha * 0.8;
                    ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
                    ctx.stroke();
                }
                // 粒子头部发光 (预渲染精灵替代shadowBlur)
                ctx.globalAlpha = alpha;
                const sz = p.size * 8;
                ctx.drawImage(ee_glow(p.color), p.x - sz/2, p.y - sz/2, sz, sz);
            });
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }
    thinOut() {
        this.particles = this.particles.slice(0, Math.ceil(this.particles.length / 2));
        this.particles.forEach(p => p.trailLen = Math.max(1, p.trailLen - 2));
    }
    isDead() { return this.life <= 0; }
}

// 6. 多线程大师 - 锚点邻域的全息神经网络与数据狂潮 (批量连线+预渲染发光节点)
class JugglerParticle {
    constructor(anchor) {
        const a = anchor || ee_fallbackAnchor();
        const low = ee_getFxTier() <= 1;
        this.low = low;
        this.cx = a.x; this.cy = a.y;
        this.fieldR = low ? 140 : 200; // 神经元游走域半径
        this.linkDist = low ? 180 : 240; // 连线阈值
        this.life = low ? 160 : 240; this.maxLife = this.life;
        // 神经元节点在锚点邻域生成
        const n = low ? 5 : 8;
        this.nodes = Array.from({length: n}, () => {
            const ang = Math.random() * Math.PI * 2;
            const r = Math.random() * this.fieldR;
            return {
                x: this.cx + Math.cos(ang) * r,
                y: this.cy + Math.sin(ang) * r,
                vx: (Math.random()-0.5)*2, vy: (Math.random()-0.5)*2,
                size: Math.random() * 4 + 2
            };
        });
        this.packets = [];
    }
    update() {
        this.life--;
        this.nodes.forEach(n => {
            n.x += n.vx; n.y += n.vy;
            // 越出锚点邻域则向锚点回拉，保持网络聚拢
            const dx = n.x - this.cx, dy = n.y - this.cy;
            const d = Math.hypot(dx, dy);
            if (d > this.fieldR) {
                n.vx -= dx / d * 0.1;
                n.vy -= dy / d * 0.1;
            }
        });
        if (this.life % 6 === 0) {
            const n1 = this.nodes[Math.floor(Math.random()*this.nodes.length)];
            const n2 = this.nodes[Math.floor(Math.random()*this.nodes.length)];
            this.packets.push({ n1, n2, progress: 0, speed: Math.random()*0.05 + 0.02 });
        }
        this.packets.forEach(p => p.progress += p.speed);
        this.packets = this.packets.filter(p => p.progress < 1);
    }
    draw(ctx) {
        const alpha = Math.sin(((this.maxLife - this.life) / this.maxLife) * Math.PI);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // 批量绘制神经元连线 (单一路径+单次stroke)
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(0, 255, 255, ${alpha * 0.25})`;
        ctx.beginPath();
        for (let i = 0; i < this.nodes.length; i++) {
            for (let j = i + 1; j < this.nodes.length; j++) {
                const n1 = this.nodes[i], n2 = this.nodes[j];
                const dist = Math.hypot(n1.x - n2.x, n1.y - n2.y);
                if (dist < this.linkDist) {
                    ctx.moveTo(n1.x, n1.y);
                    ctx.lineTo(n2.x, n2.y);
                }
            }
        }
        ctx.stroke();

        // 数据流光 (发光精灵替代shadowBlur)
        const pktSprite = ee_glow('#ff00ff');
        this.packets.forEach(p => {
            const x = p.n1.x + (p.n2.x - p.n1.x) * p.progress;
            const y = p.n1.y + (p.n2.y - p.n1.y) * p.progress;
            ctx.globalAlpha = alpha;
            ctx.drawImage(pktSprite, x - 8, y - 8, 16, 16);
        });

        // 节点发光 (发光精灵替代shadowBlur)
        const nodeSprite = ee_glow('#00ffff');
        this.nodes.forEach(n => {
            ctx.globalAlpha = alpha;
            const sz = n.size * 6;
            ctx.drawImage(nodeSprite, n.x - sz/2, n.y - sz/2, sz, sz);
            // 节点核心
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.beginPath(); ctx.arc(n.x, n.y, n.size, 0, Math.PI*2); ctx.fill();
        });
        ctx.globalAlpha = 1;
        ctx.restore();
    }
    thinOut() { this.nodes = this.nodes.slice(0, Math.ceil(this.nodes.length / 2)); }
    isDead() { return this.life <= 0; }
}

// 7. 断舍离 - "叶落辞行"（重设计版）：
//    触发条件是"10秒内删除3个任务"，动画与之严格对应——
//    ① 锚点（最后被删的行原位）扬起微尘（扫除感）
//    ② 三片秋叶剪影自原位依次飘起、旋转着升空渐隐（数量呼应删除的3个任务，"已随风而去"）
//    ③ 收尾一道暖柔光自下而上掠过原位（清理归位的仪式感）
//    性能：3 片叶（2 段二次贝塞尔叶形+叶脉）+ 20/10 颗微尘 + 1 条光带渐变，
//    绘制域收敛于锚点 ±160px，无 shadowBlur、无 lighter、无拖尾历史数组。
class LetGoParticle {
    constructor(anchor) {
        const a = anchor || ee_fallbackAnchor();
        const low = ee_getFxTier() <= 1;
        this.low = low;
        this.life = low ? 140 : 200;
        this.maxLife = this.life;
        this.ax = a.x; this.ay = a.y;
        // 三片辞行叶（对应删除的3个任务），依次延迟 14 帧飘起
        const leafColors = ['rgba(205, 170, 120, 0.9)', 'rgba(190, 150, 110, 0.9)', 'rgba(215, 185, 140, 0.9)'];
        this.leaves = [0, 14, 28].map((delay, i) => ({
            delay,
            x: a.x + (Math.random() - 0.5) * 70,
            y: a.y + (Math.random() - 0.5) * 16,
            swayPhase: Math.random() * Math.PI * 2,
            swayAmp: 14 + Math.random() * 10, // 水平摆幅
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.08,
            size: 7 + Math.random() * 4,
            color: leafColors[i]
        }));
        // 微尘（扫除扬起的细尘）
        const n = low ? 10 : 20;
        this.dust = Array.from({length: n}, () => ({
            x: a.x + (Math.random() - 0.5) * 90,
            y: a.y + (Math.random() - 0.5) * 24,
            vx: (Math.random() - 0.5) * 1.2,
            vy: -(Math.random() * 0.9 + 0.3),
            size: Math.random() * 2 + 0.8,
            phase: Math.random() * Math.PI * 2
        }));
    }
    update() {
        this.life--;
        const t = this.maxLife - this.life;
        // 辞行叶：缓缓上浮 + 摆动相位推进 + 自转
        this.leaves.forEach(l => {
            if (t < l.delay) return;
            l.y -= 0.85;
            l.swayPhase += 0.045;
            l.rot += l.rotSpeed;
        });
        // 微尘：轻飘上扬
        this.dust.forEach(d => {
            d.x += d.vx + Math.sin(d.phase) * 0.3;
            d.y += d.vy;
            d.phase += 0.03;
        });
    }
    draw(ctx) {
        const t = this.maxLife - this.life;
        const progress = t / this.maxLife;
        ctx.save();

        // 1. 微尘扬起（前 60% 衰减殆尽）
        if (progress < 0.6) {
            const dustA = (1 - progress / 0.6) * 0.8;
            this.dust.forEach(d => {
                ctx.fillStyle = `rgba(200, 190, 175, ${dustA * 0.5})`;
                ctx.beginPath(); ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = `rgba(255, 250, 240, ${dustA * 0.7})`;
                ctx.beginPath(); ctx.arc(d.x, d.y, d.size * 0.45, 0, Math.PI * 2); ctx.fill();
            });
        }

        // 2. 三片辞行叶（各自淡入淡出，旋转飘升）
        this.leaves.forEach(l => {
            const lt = t - l.delay;
            if (lt < 0) return;
            const lp = lt / (this.maxLife - l.delay); // 该叶生命周期进度 0→1
            const la = Math.sin(Math.min(1, lp) * Math.PI) * 0.95;
            if (la <= 0.01) return;
            const x = l.x + Math.sin(l.swayPhase) * l.swayAmp;
            ctx.save();
            ctx.translate(x, l.y);
            ctx.rotate(l.rot + Math.sin(l.swayPhase) * 0.3); // 摆动连带俯仰
            ctx.globalAlpha = la;
            ctx.fillStyle = l.color;
            // 叶形：两段二次贝塞尔构成的纺锤
            ctx.beginPath();
            ctx.moveTo(0, -l.size);
            ctx.quadraticCurveTo(l.size * 0.7, 0, 0, l.size);
            ctx.quadraticCurveTo(-l.size * 0.7, 0, 0, -l.size);
            ctx.fill();
            // 叶脉
            ctx.strokeStyle = 'rgba(120, 90, 60, 0.6)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(0, -l.size * 0.8); ctx.lineTo(0, l.size * 0.8);
            ctx.stroke();
            ctx.restore();
        });

        // 3. 收尾柔光：一道窄光带自下而上掠过原位（清理归位）
        if (progress > 0.7) {
            const k = (progress - 0.7) / 0.3;
            const bandH = 90;
            const gy = this.ay + 20 - k * 130; // 光带中心上移
            const gAlpha = Math.sin(k * Math.PI) * 0.35;
            const g = ctx.createLinearGradient(0, gy - bandH / 2, 0, gy + bandH / 2);
            g.addColorStop(0, 'rgba(255, 240, 210, 0)');
            g.addColorStop(0.5, `rgba(255, 240, 210, ${gAlpha})`);
            g.addColorStop(1, 'rgba(255, 240, 210, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(this.ax - 70, gy - bandH / 2, 140, bandH);
        }
        ctx.restore();
    }
    thinOut() { this.dust = this.dust.slice(0, Math.ceil(this.dust.length / 2)); }
    isDead() { return this.life <= 0; }
}

// 星铸徽章 - 五瓣玫瑰线光阵以勾选框为心绽放 (多层透明圆 Fake Glow 替代 shadowBlur)
class StarforgedCrestParticle {
    constructor(anchor) {
        const a = anchor || ee_fallbackAnchor();
        const low = ee_getFxTier() <= 1;
        this.low = low;
        this.cx = a.x;
        this.cy = a.y;
        this.life = 240; // 4秒 (60fps)
        this.maxLife = 240;
        this.time = 0;
        this.maxR = low ? 56 : 80; // 玫瑰线最大半径

        // 生成围绕徽章旋转的星尘火花
        const n = low ? 16 : 40;
        this.sparks = Array.from({length: n}, () => ({
            angle: Math.random() * Math.PI * 2,
            radius: Math.random() * 20, // 初始半径很小
            speed: (Math.random() - 0.5) * 0.08,
            size: Math.random() * 2 + 1,
            color: Math.random() > 0.5 ? '255, 215, 0' : '0, 255, 255' // 金色与青蓝交织
        }));
    }

    update() {
        this.life--;
        this.time += 0.03; // 控制几何图形的旋转速度

        this.sparks.forEach(s => {
            s.angle += s.speed;
            // 限制火花的扩散范围，最高不超过 maxR*1.1
            if (s.radius < this.maxR * 1.1) s.radius += 0.5;
        });
    }

    draw(ctx) {
        // 使用正弦波控制全局透明度，实现完美的平滑淡入淡出
        const progress = this.life / this.maxLife;
        const alpha = Math.sin(progress * Math.PI);

        ctx.save();
        ctx.translate(this.cx, this.cy);
        ctx.globalCompositeOperation = 'lighter'; // 叠加发光混合模式

        const maxR = this.maxR * alpha;

        // 1. 绘制极坐标 5 瓣玫瑰线 (魔法阵核心) — 仅 1 次 shadowBlur（低配档禁用）
        ctx.save();
        ctx.rotate(this.time);
        ctx.beginPath();
        for (let i = 0; i <= Math.PI * 2.01; i += 0.05) {
            // 核心数学公式：r = a * cos(k * theta)，k=5 画出5瓣
            const r = maxR * Math.cos(5 * i);
            const x = r * Math.cos(i);
            const y = r * Math.sin(i);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(255, 215, 0, ${alpha * 0.9})`; // 灿烂的金色
        ctx.lineWidth = 3;
        if (!this.low) {
            ctx.shadowColor = '#FF8C00';
            ctx.shadowBlur = 15;
        }
        ctx.stroke();
        ctx.shadowBlur = 0; // 立即归零，避免影响后续绘制
        ctx.restore();

        // 2. 绘制内嵌的逆向旋转几何圆环
        ctx.save();
        ctx.rotate(-this.time * 1.5);
        ctx.beginPath();
        ctx.arc(0, 0, maxR * 0.5, 0, Math.PI * 2);
        // 使用青蓝色形成冷暖对比，增加华丽感
        ctx.strokeStyle = `rgba(0, 255, 255, ${alpha * 0.6})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 15]); // 虚线圆环
        ctx.stroke();
        ctx.restore();

        // 3. 绘制星尘火花 (Fake Glow：多层透明圆叠加，渲染成本≈0)
        // 【关键】确保在循环前彻底关闭 shadow 效果
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';

        this.sparks.forEach(s => {
            const sx = s.radius * alpha * Math.cos(s.angle);
            const sy = s.radius * alpha * Math.sin(s.angle);

            // 第一层：外圈柔和光晕（大半径，低透明度）
            ctx.fillStyle = `rgba(${s.color}, ${alpha * 0.25})`;
            ctx.beginPath();
            ctx.arc(sx, sy, s.size * 3, 0, Math.PI * 2);
            ctx.fill();

            // 第二层：核心高亮（小半径，高透明度，使用纯白）
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
            ctx.beginPath();
            ctx.arc(sx, sy, s.size * 0.8, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();
    }

    thinOut() { this.sparks = this.sparks.slice(0, Math.ceil(this.sparks.length / 2)); }
    isDead() { return this.life <= 0; }
}

// ==================== 特效触发函数 ====================

function ee_fireConfetti() {
    ee_initCanvas();
    for (let i = 0; i < 40; i++) {
        ee_particles.push(new ConfettiParticle(true));
        ee_particles.push(new ConfettiParticle(false));
    }
    if (!ee_animId) ee_animate();
}

function ee_dropLeaves(anchor) {
    ee_initCanvas();
    // 锚点化：围绕番茄圈分批飘叶（低配档总量减半）
    const low = ee_getFxTier() <= 1;
    const batches = low ? 4 : 5, perBatch = low ? 2 : 3;
    let count = 0;
    const interval = setInterval(() => {
        for(let i=0; i<perBatch; i++) ee_particles.push(new LeafParticle(anchor));
        if (!ee_animId) ee_animate();
        if (++count > batches) clearInterval(interval);
    }, 110);
    if (!ee_animId) ee_animate();
}

// 百步穿杨：金矢穿靶（原全屏金色雨的锚点化重设计）
function ee_fireGoldenBullseye(anchor) {
    ee_initCanvas();
    ee_particles.push(new GoldenBullseyeParticle(anchor));
    if (!ee_animId) ee_animate();
}

function ee_playZenRipple() {
    ee_initCanvas();
    ee_particles.push(new ZenRippleParticle());
    if (!ee_animId) ee_animate();
}

// 心流极光：全屏流动极光波纹
function ee_playAurora() {
    ee_initCanvas();
    ee_particles.push(new AuroraWaveParticle());
    if (!ee_animId) ee_animate();
}

// 清算旧账：闪电与能量碎片
function ee_playSettleOldScores(anchor) {
    ee_initCanvas();
    ee_particles.push(new ThunderStrikeParticle(anchor));
    if (!ee_animId) ee_animate();
}

// 断舍离：叶落辞行（三片秋叶自删除行原位飘起，呼应删除的3个任务）
function ee_spawnDust(anchor) {
    ee_initCanvas();
    ee_particles.push(new LetGoParticle(anchor));
    if (!ee_animId) ee_animate();
}

// 落日归山：今日任务清空时触发（全屏晚霞）
function ee_playSunsetHorizon() {
    ee_initCanvas();
    ee_particles.push(new SunsetHorizonParticle());
    if (!ee_animId) ee_animate();
}

/** 统计今日未完成任务数 */
function ee_countTodayIncomplete() {
    if (typeof tasks === 'undefined') return 0;
    const todayStr = new Date().toDateString();
    return tasks.filter(t => {
        if (t.completed) return false;
        if (!t.startTime) return false;
        return new Date(t.startTime).toDateString() === todayStr;
    }).length;
}

/**
 * 检查并触发"落日归山"彩蛋（今日任务全部清空时）
 * 可在任务完成或任务日期修改后调用
 */
function ee_checkSunsetHorizon() {
    if (eeState.triggered.sunsetHorizon) return;
    if (typeof tasks === 'undefined') return;
    if (ee_countTodayIncomplete() === 0) {
        eeState.triggered.sunsetHorizon = true;
        ee_trigger({
            icon: '🌄',
            message: '落日归山',
            desc: '今日任务已全数清空，享受宁静时刻',
            effectFn: ee_playSunsetHorizon
        });
    }
}

// 坐忘无我：单任务专注超3小时触发（全屏浅蓝氛围，toast由调用方通过队列处理）
function ee_playVoidState() {
    ee_initCanvas();
    ee_particles.push(new VoidStateParticle());
    if (!ee_animId) ee_animate();
}

// 超新星爆发：耗时超3小时任务完成时触发
function ee_playSupernova(anchor) {
    ee_initCanvas();
    ee_particles.push(new SupernovaParticle(anchor));
    if (!ee_animId) ee_animate();
}

// 番茄三连：精灵之森魔法阵
function ee_playRipple(anchor) {
    ee_initCanvas();
    ee_particles.push(new FocusRippleParticle(anchor));
    if (!ee_animId) ee_animate();
}

// 多线程大师：10分钟内完成5个子任务时触发
function ee_playJuggler(anchor) {
    ee_initCanvas();
    ee_particles.push(new JugglerParticle(anchor));
    if (!ee_animId) ee_animate();
}

// 星铸徽章：当日完成5个任务（及其整数倍）时触发
function ee_playStarforgedCrest(anchor) {
    ee_initCanvas();
    ee_particles.push(new StarforgedCrestParticle(anchor));
    if (!ee_animId) ee_animate();
}

// ==================== 彩蛋触发核心逻辑 ====================

/**
 * 任务完成时调用
 * @param {Object} task - 完成的任务对象
 * @param {HTMLElement|Object} sourceEl - 用户实际点击的操作元素（主视图复选框 /
 *   详情面板完成按钮），或提前捕获的锚点坐标快照（子任务全完成路径，
 *   面板重渲染后原元素已脱离 DOM）。缺省时按 taskId 找可见行，最后回退视口中心。
 */
function easterEgg_onTaskComplete(task, sourceEl) {
    ee_checkDate();
    // 锚点在触发瞬间捕获（视口坐标快照）：主视图勾选→实际点击的复选框；
    // 详情面板勾选→面板完成按钮；子任务全完成→子任务复选框（调用方透传）
    const anchor = ee_resolveTaskAnchor(task ? task.id : null, sourceEl);

    // 1. 首战告捷 (今日第1个) —— 保持全屏礼花（刻意不带锚点）
    eeState.completedTasks++;
    if (eeState.completedTasks === 1 && !eeState.triggered.firstTask) {
        eeState.triggered.firstTask = true;
        ee_trigger({
            icon: '🎉',
            message: '首战告捷！',
            desc: '今日完成第一个任务',
            effectFn: ee_fireConfetti
        });
    }

    // 1.5 星铸徽章 (今日完成5个任务及其整数倍) —— 行金色描边脉冲 + 玫瑰线在勾选框绽放
    if (eeState.completedTasks > 0 && eeState.completedTasks % 5 === 0) {
        ee_pulseRow(task ? task.id : null, sourceEl);
        ee_trigger({
            icon: '🏅',
            message: '星铸徽章',
            desc: `行云流水！今日已累计攻克 ${eeState.completedTasks} 个任务`,
            effectFn: ee_playStarforgedCrest
        }, anchor);
    }

    // 2. 清算旧账 (逾期7天以上)
    if (task && task.startTime) {
        const daysDiff = (new Date() - new Date(task.startTime)) / (1000 * 60 * 60 * 24);
        if (daysDiff > 7) {
            ee_trigger({
                icon: '⚡',
                message: '清算旧账！',
                desc: '完成了逾期7天以上的任务',
                effectFn: ee_playSettleOldScores
            }, anchor);
        }
    }

    // 3. 百步穿杨 (累计完成100的整数倍)
    if (typeof tasks !== 'undefined') {
        const totalCompleted = tasks.filter(t => t.completed).length;
        if (totalCompleted > 0 && totalCompleted % 100 === 0) {
            ee_trigger({
                icon: '🏆',
                message: `史诗成就：击破 ${totalCompleted} 个任务！`,
                desc: '累计完成任务的百次里程碑',
                effectFn: ee_fireGoldenBullseye
            }, anchor);
        }
    }

    // 4. 清空禅意 (清单被清零，全屏涟漪)
    if (task && task.listId && typeof tasks !== 'undefined' && typeof lists !== 'undefined') {
        const listTasks = tasks.filter(t => t.listId === task.listId);
        const remaining = listTasks.filter(t => !t.completed).length;
        const total = listTasks.length;
        if (total >= 5 && remaining === 0) {
            ee_trigger({
                icon: '🍵',
                message: '任务清空，享受禅意与宁静',
                desc: '清单中所有任务已完成',
                effectFn: ee_playZenRipple
            });
        }
    }

    // 5. 落日归山 (今日任务全部清空，全屏晚霞)
    ee_checkSunsetHorizon();

    // 6. 超新星爆发 (耗时超3小时的任务完成)
    if (task && task.id && !eeState.supernovaTriggeredTasks.has(task.id)) {
        const taskFocusMinutes = ee_getTaskFocusMinutes(task.id);
        if (taskFocusMinutes >= 180) {
            eeState.supernovaTriggeredTasks.add(task.id);
            ee_trigger({
                icon: '🌟',
                message: '超新星爆发！',
                desc: '史诗级肝帝成就：完成了耗时超3小时的巨型任务',
                effectFn: ee_playSupernova
            }, anchor);
        }
    }
}

/**
 * 番茄完成时调用
 * @param {number} duration - 专注时长（分钟）
 */
function easterEgg_onPomodoroComplete(duration = 25) {
    ee_checkDate();
    const now = Date.now();

    // 1. 番茄三连 (间隔小于 200分钟 视为连续)
    if (eeState.lastPomodoroTime === 0 || (now - eeState.lastPomodoroTime) < 200 * 60 * 1000) {
        eeState.consecutivePomodoros++;
    } else {
        eeState.consecutivePomodoros = 1;
    }
    eeState.lastPomodoroTime = now;

    if (eeState.consecutivePomodoros === 3 && !eeState.triggered.threePomodoros) {
        eeState.triggered.threePomodoros = true;
        ee_enqueueOrShow({
            icon: '🍅',
            message: '番茄三连！',
            desc: '连续完成3个番茄（间隔小于200分钟）',
            effectFn: ee_playRipple
        });
    }

    // 2. 专注力爆棚 (总时长超2小时)
    eeState.focusMinutes += duration;
    if (eeState.focusMinutes >= 120 && !eeState.triggered.twoHours) {
        eeState.triggered.twoHours = true;
        ee_enqueueOrShow({
            icon: '🍃',
            message: '专注力爆棚！',
            desc: '今日专注总时长已超过2小时',
            effectFn: ee_dropLeaves
        });
    }

    // 3. 坐忘无我 (单任务累计专注超3小时)
    if (typeof pomodoroState !== 'undefined' && pomodoroState.currentTaskId) {
        const taskId = pomodoroState.currentTaskId;
        if (!eeState.voidStateTriggeredTasks.has(taskId)) {
            const taskFocusMinutes = ee_getTaskFocusMinutes(taskId);
            if (taskFocusMinutes >= 180) {
                eeState.voidStateTriggeredTasks.add(taskId);
                ee_enqueueOrShow({
                    icon: '🌌',
                    message: '坐忘无我',
                    desc: '深潜专注3小时，世界为你屏息',
                    effectFn: ee_playVoidState
                });
            }
        }
    }

    // 4. 记录番茄结束时间（供心流大师判断）
    eeState.lastPomodoroEndTime = now;
}

/**
 * 心流大师：番茄钟开始时调用
 */
function easterEgg_onPomodoroStart() {
    ee_checkDate();
    const now = Date.now();

    // 仅在专注阶段开始时检测心流（休息阶段不触发）
    if (pomodoroState.phase !== 'focus') return;

    // 上一个番茄钟结束距今小于3分钟，触发心流
    if (eeState.lastPomodoroEndTime > 0 && (now - eeState.lastPomodoroEndTime) < 180000) {
        ee_enqueueOrShow({
            icon: '🌊',
            message: '沉浸心流，势不可挡！',
            desc: '上一个番茄结束3分钟内开始新专注',
            effectFn: ee_playAurora
        });
    }
}

/**
 * 刷新待显示的彩蛋效果队列（顺序播放）
 * 当主视图（默认首页视图）被打开时调用，也会在直接触发彩蛋时被调用
 */
let ee_flushing = false; // 是否正在顺序播放彩蛋
// 特效主时长：锚点动画的最长持续（低配档更短）。特效起播是渲染压力峰值
// （粒子满额 + 画布初始化），横幅须等特效主体完成后才入场，错开两处峰值。
const EE_FX_LEAD_MS = 3600;
// 队列步进：特效先播 EE_FX_LEAD_MS → 横幅弹出（生命周期约 6.5s，入场+停留）→
// 再等横幅停留主体播完进入下一个。此时横幅仅剩 CSS 退场（transform/opacity），
// 与下一个特效起播并存压力可忽略。
const EE_QUEUE_STEP_MS = 7600;

function ee_flushPendingEffects() {
    if (eeState.pendingEffects.length === 0) return;
    // 设置项 easterEggEnabled：关闭时不显示任何彩蛋效果
    if (settings && settings.easterEggEnabled === false) {
        eeState.pendingEffects = [];
        return;
    }
    if (ee_flushing) return; // 已在播放中，新加入的彩蛋会在当前流程结束后被处理
    ee_flushing = true;

    const playNext = () => {
        if (eeState.pendingEffects.length === 0) {
            ee_flushing = false;
            return;
        }
        const effect = eeState.pendingEffects.shift();
        // 1. 先播放锚点特效（渲染压力峰值：粒子满额起播）
        if (effect.effectFn && ee_getFxTier() > 0) {
            try { effect.effectFn(effect.anchor); } catch (e) { /* 特效失败不影响队列 */ }
        }
        // 2. 特效主体完成后（粒子已衰减过半）横幅才入场，避免与特效起播同帧竞争渲染
        setTimeout(() => ee_showToast(effect.icon, effect.message, effect.desc), EE_FX_LEAD_MS);
        // 3. 等横幅停留主体播完，进入下一个
        setTimeout(playNext, EE_QUEUE_STEP_MS);
    };
    playNext();
}

/**
 * 将彩蛋效果加入待显示队列
 * 番茄专注类彩蛋统一在返回默认视图时显示，确保用户一定可见
 * @param {Object} effect - 彩蛋效果描述
 * @param {Object} anchor - 操作点视口坐标快照（可选；专注类彩蛋播放时自行解析番茄圈锚点）
 */
function ee_enqueueOrShow(effect, anchor) {
    // 设置项 easterEggEnabled：关闭时不入队
    if (settings && settings.easterEggEnabled === false) return;
    if (anchor) effect.anchor = anchor;
    eeState.pendingEffects.push(effect);
}

/**
 * 直接触发彩蛋效果（入队并立即尝试刷新队列）
 * 用于任务完成等场景，保证多个彩蛋按顺序播放而非同时
 * @param {Object} effect - 彩蛋效果描述
 * @param {Object} anchor - 操作点视口坐标快照（可选，缺省时粒子内自行兜底）
 */
function ee_trigger(effect, anchor) {
    if (settings && settings.easterEggEnabled === false) return;
    if (anchor) effect.anchor = anchor;
    eeState.pendingEffects.push(effect);
    ee_flushPendingEffects();
}

/**
 * 计算指定任务的累计专注时长（分钟）
 * 复用 pomodoro.js 中已有的 getTaskFocusMinutes 函数，此处仅作为兼容包装
 * @param {string} taskId - 任务ID
 * @returns {number} 累计专注分钟数
 */
function ee_getTaskFocusMinutes(taskId) {
    if (typeof getTaskFocusMinutes === 'function') {
        return getTaskFocusMinutes(taskId);
    }
    // 离线或异常情况下的兜底实现
    if (typeof pomodoroHistory === 'undefined' || !taskId) return 0;
    return pomodoroHistory
        .filter(p => p.taskId === taskId)
        .reduce((sum, p) => sum + (p.duration || 0), 0);
}

/**
 * 子任务完成时调用（多线程大师触发）
 * 在10分钟内连续完成5个子任务时触发
 * @param {HTMLElement|Object} sourceEl - 被勾选的子任务复选框元素，或提前捕获的锚点坐标快照
 */
function easterEgg_onSubtaskComplete(sourceEl) {
    ee_checkDate();
    const now = Date.now();
    // 清理10分钟前的记录
    eeState.recentSubtaskCompletes = eeState.recentSubtaskCompletes.filter(t => now - t < 10 * 60 * 1000);
    eeState.recentSubtaskCompletes.push(now);

    // 10分钟内完成5个子任务时触发（锚点=最后勾选的子任务复选框，即用户指尖）
    if (eeState.recentSubtaskCompletes.length >= 5) {
        eeState.recentSubtaskCompletes = []; // 触发后清空，避免短时间内重复触发
        const anchor = ee_normalizeAnchor(sourceEl) || ee_fallbackAnchor();
        ee_trigger({
            icon: '⚡',
            message: '多线程大师！',
            desc: '10分钟内连破5关，绝佳的节奏感',
            effectFn: ee_playJuggler
        }, anchor);
    }
}

/**
 * 断舍离：任务删除时调用
 * @param {HTMLElement} taskElement - 被删除的任务 DOM 节点（在删除前捕获锚点）
 */
function easterEgg_onTaskDelete(taskElement) {
    const now = Date.now();
    // 锚点在元素移除前捕获（风卷余烬自原位飘散）
    const anchor = ee_captureAnchor(taskElement) || ee_fallbackAnchor();
    eeState.recentDeletes = eeState.recentDeletes.filter(time => now - time < 10000);
    eeState.recentDeletes.push(now);

    if (eeState.recentDeletes.length >= 3) {
        eeState.recentDeletes = [];
        ee_trigger({
            icon: '🍂',
            message: '懂得放下，也是极简的智慧',
            desc: '10秒内删除了3个任务',
            effectFn: ee_spawnDust
        }, anchor);
    }
}

/**
 * 页面加载/刷新时恢复历史数据
 */
function easterEgg_restoreFromHistory() {
    ee_checkDate();

    // 恢复任务完成计数
    if (typeof tasks !== 'undefined') {
        const today = new Date();
        const todayStr = today.toDateString();
        const todayCompleted = tasks.filter(t => {
            if (!t.completed || !t.completedAt) return false;
            return new Date(t.completedAt).toDateString() === todayStr;
        });
        eeState.completedTasks = todayCompleted.length;
        if (eeState.completedTasks >= 1) eeState.triggered.firstTask = true;
    }

    // 恢复番茄专注相关状态
    if (typeof pomodoroHistory !== 'undefined' && pomodoroHistory.length > 0) {
        const todayStr = new Date().toDateString();
        const todayRecords = pomodoroHistory.filter(p => new Date(p.startedAt || p.date).toDateString() === todayStr);
        eeState.focusMinutes = todayRecords.reduce((sum, p) => sum + (p.duration || 25), 0);
        if (eeState.focusMinutes >= 120) eeState.triggered.twoHours = true;

        // 恢复连续番茄计数：检查最近的番茄记录是否在45分钟内连续
        if (todayRecords.length > 0) {
            const sortedRecords = [...todayRecords].sort((a, b) => {
                return new Date(b.endedAt || b.date) - new Date(a.endedAt || a.date);
            });
            let consecutive = 1;
            for (let i = 0; i < sortedRecords.length - 1; i++) {
                const curr = new Date(sortedRecords[i].endedAt || sortedRecords[i].date).getTime();
                const prev = new Date(sortedRecords[i + 1].endedAt || sortedRecords[i + 1].date).getTime();
                if (curr - prev < 45 * 60 * 1000) {
                    consecutive++;
                } else {
                    break;
                }
            }
            eeState.consecutivePomodoros = consecutive;
            if (consecutive >= 3) eeState.triggered.threePomodoros = true;

            // 恢复 lastPomodoroTime 和 lastPomodoroEndTime
            const lastRecord = sortedRecords[0];
            const lastEndTime = new Date(lastRecord.endedAt || lastRecord.date).getTime();
            eeState.lastPomodoroTime = lastEndTime;
            eeState.lastPomodoroEndTime = lastEndTime;
        }

        // 恢复坐忘无我和超新星爆发已触发状态：累计专注超3小时的任务标记为已触发
        const taskFocusMinutes = {};
        pomodoroHistory.forEach(p => {
            if (p.taskId) {
                taskFocusMinutes[p.taskId] = (taskFocusMinutes[p.taskId] || 0) + (p.duration || 25);
            }
        });
        Object.entries(taskFocusMinutes).forEach(([taskId, minutes]) => {
            if (minutes >= 180) {
                eeState.voidStateTriggeredTasks.add(taskId);
                // 超新星：如果任务已完成且专注超3小时，标记为已触发
                if (typeof tasks !== 'undefined') {
                    const task = tasks.find(t => t.id === taskId);
                    if (task && task.completed) {
                        eeState.supernovaTriggeredTasks.add(taskId);
                    }
                }
            }
        });
    }

    // 恢复落日归山已触发状态：如果今日任务已清空，标记为已触发
    if (typeof tasks !== 'undefined' && !eeState.triggered.sunsetHorizon) {
        const todayStr = new Date().toDateString();
        const todayIncomplete = tasks.filter(t => {
            if (t.completed) return false;
            if (!t.startTime) return false;
            return new Date(t.startTime).toDateString() === todayStr;
        }).length;
        if (todayIncomplete === 0 && eeState.completedTasks >= 1) {
            eeState.triggered.sunsetHorizon = true;
        }
    }
}

/**
 * 初始化彩蛋系统（供 app.js 调用）
 */
function easterEgg_init() {
    ee_checkDate();
    easterEgg_restoreFromHistory();
}

// 初始化
document.addEventListener('DOMContentLoaded', easterEgg_restoreFromHistory);
document.addEventListener('visibilitychange', () => { if (!document.hidden) ee_checkDate(); });
