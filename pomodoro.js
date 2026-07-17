// ==================== 多标签页同步 ====================
// visibilitychange 已在 app.js init() 中统一注册，此处不再重复

// BroadcastChannel：解决双显示器/多标签页脑裂问题
const _pomodoroChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pomodoro_sync') : null;

// 结束专注时暂存原任务ID（用于显示退回"一般专注"但保存时仍关联原任务）
let _endedTaskId = null;
// 专注过程中任务被完成时的拆分信息 {taskId, taskName, elapsedSeconds}
let _completedTaskInfo = null;
// 标记客户端刚启动新专注/休息，syncPomodoroFromServer 应跳过旧状态覆盖
let _pomodoroStartPending = false;
// 超时保护定时器：防止网络异常导致 _pomodoroStartPending 永久保持
let _pomodoroStartPendingTimer = null;
// 记录进入 rest_ended 状态的时间戳，用于多标签页同步超时
let _restEndedAt = 0;

if (_pomodoroChannel) {
    _pomodoroChannel.onmessage = function(event) {
        if (event.data && event.data.action === 'SYNC_NEEDED') {
            syncPomodoroFromServer();
        }
    };
}

// 任何改变状态的操作后，通知其他标签页
function notifyOtherTabs() {
    if (_pomodoroChannel) {
        try { _pomodoroChannel.postMessage({ action: 'SYNC_NEEDED' }); } catch(e) {}
    }
}

// ==================== 用户活跃心跳（隐患二：防止幽灵循环） ====================
let _lastUserActivityAt = Date.now();
let _heartbeatTimerId = null;

function _throttle(fn, delay) {
    let lastCall = 0;
    return function(...args) {
        const now = Date.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            fn.apply(this, args);
        }
    };
}

function _onUserActivity() {
    _lastUserActivityAt = Date.now();
}

function initUserActivityTracking() {
    const throttledHandler = _throttle(_onUserActivity, 10000);
    document.addEventListener('mousemove', throttledHandler, { passive: true });
    document.addEventListener('keydown', throttledHandler, { passive: true });
    document.addEventListener('click', throttledHandler, { passive: true });

    // 每30秒向服务器发送一次活跃心跳
    _heartbeatTimerId = setInterval(() => {
        if (Date.now() - _lastUserActivityAt < 60000) {
            fetch('/api/pomodoro/heartbeat', { method: 'POST' }).catch(() => {});
        }
    }, 30000);
}

// 页面加载后初始化心跳
initUserActivityTracking();

// ==================== 键盘快捷键 ====================
document.addEventListener('keydown', function(e) {
    // 仅在番茄页面可见时响应
    const pomodoroPage = document.getElementById('pomodoro-page');
    if (!pomodoroPage || pomodoroPage.classList.contains('hidden')) return;
    
    // 如果焦点在输入框中，不拦截
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    
    // End_Settlement 状态的特殊键盘约束
    if (pomodoroState.state === 'end_settlement') {
        // Esc = 继续专注 (CANCEL)
        if (e.key === 'Escape') {
            e.preventDefault();
            handleCancelSettlement();
            return;
        }
        // Space/Enter = 计入任务并结束（仅当按钮可见时）
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            const btnSaveTime = document.getElementById('btn-save-time');
            if (btnSaveTime && !btnSaveTime.classList.contains('hidden')) {
                handleSaveTime();
            }
            return;
        }
        return;
    }
    
    // Space 主操作快捷键
    if (e.key === ' ') {
        e.preventDefault();
        switch (pomodoroState.state) {
            case 'idle':
                handleStartFocus();
                break;
            case 'focusing':
                handlePause();
                break;
            case 'pause':
                handleResume();
                break;
            case 'resting':
                handleSkipRest();
                break;
            case 'completed':
                handleClickRest();
                break;
        }
    }
});

// ==================== 番茄计时器核心函数 ====================

function shouldAskAboutFocusTime() {
    if (pomodoroState.state !== 'focusing' && pomodoroState.state !== 'pause') return false;
    if (pomodoroState.phase !== 'focus') return false;
    if (!pomodoroState.currentTaskId) return false;
    
    const elapsed = pomodoroState.totalDuration - pomodoroState.timeLeft;
    return elapsed >= 5 * 60; // 5 minutes
}

function stopFlowAnimation() {
    const leftPanel = document.getElementById('pomodoro-left-panel');
    if (leftPanel) {
        leftPanel.parentElement.classList.add('pomodoro-animations-paused');
        // 暂停所有 Web Animations API 驱动的动画
        leftPanel.querySelectorAll('.focus-particle, .nebula-cloud, .light-ray, .zenith-orb, .zen-firefly').forEach(el => {
            el.getAnimations().forEach(a => a.pause());
        });
    }
}

function startFlowAnimation() {
    const leftPanel = document.getElementById('pomodoro-left-panel');
    if (leftPanel) {
        leftPanel.parentElement.classList.remove('pomodoro-animations-paused');
        // 恢复所有 Web Animations API 驱动的动画
        leftPanel.querySelectorAll('.focus-particle, .nebula-cloud, .light-ray, .zenith-orb, .zen-firefly').forEach(el => {
            el.getAnimations().forEach(a => a.play());
        });
    }
}

function switchToPomodoroPage() {
    // 关闭任务详情栏（避免在番茄页面上显示）
    if (typeof closeTaskDetailPanel === 'function') closeTaskDetailPanel();
    document.getElementById('pomodoro-page').classList.remove('hidden');
    document.getElementById('sidebar-bottom-buttons').classList.add('hidden');
    document.getElementById('main-content').classList.add('hidden');
    // 仅在圆环处于初始状态（offset=0，完整圆环）时禁用过渡动画，
    // 避免从完整圆环动画滑到正确偏移位置；其他情况下保留0.3s平滑过渡
    const progressEl = document.getElementById('pomodoro-progress');
    if (progressEl && (progressEl.style.strokeDashoffset === '' || progressEl.style.strokeDashoffset === '0')) {
        _pomodoroPhaseTransition = true;
    }
    renderPomodoroPage();
    updatePomodoroBackground();
    // 确保进度环和按钮状态正确更新（修复从侧边栏进入时圆环显示不正确的问题）
    updatePomodoroDisplay();
    // 从服务器同步最新状态，确保resting等状态的timeLeft准确
    syncPomodoroFromServer();
}

function closePomodoroPage() {
    document.getElementById('pomodoro-page').classList.add('hidden');
    document.getElementById('sidebar-bottom-buttons').classList.remove('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    clearMainViewBackground();
    // 从番茄专注页面返回主视图时，刷新待显示的彩蛋效果
    if (typeof ee_flushPendingEffects === 'function') {
        ee_flushPendingEffects();
    }
}

function updatePomodoroBackground() {
    const leftPanel = document.getElementById('pomodoro-left-panel');
    const rightPanel = document.getElementById('pomodoro-right-panel');
    // 左右栏分离：各自独立持有渐变背景类，互不影响（消除 backdrop-filter 卡顿）
    const bgPanels = [leftPanel, rightPanel].filter(Boolean);
    const bgClassList = ['pomodoro-focus-bg', 'pomodoro-break-bg', 'pomodoro-longbreak-bg', 'pomodoro-completed-break-bg', 'pomodoro-completed-longbreak-bg'];
    const progressRing = document.getElementById('pomodoro-progress');
    const pomodoroCircle = document.getElementById('pomodoro-circle');

    // 移除所有背景类
    bgPanels.forEach(p => p.classList.remove(...bgClassList));

    // 辅助函数：为所有面板添加背景类
    const applyBg = (cls) => bgPanels.forEach(p => p.classList.add(cls));

    // completed 状态使用静态绿色背景（不播放渐变动画，等开始休息后才播放）
    if (pomodoroState.state === 'completed' && pomodoroState.phase !== 'focus') {
        if (pomodoroState.phase === 'longBreak') {
            applyBg('pomodoro-completed-longbreak-bg');
        } else {
            applyBg('pomodoro-completed-break-bg');
        }
        progressRing.style.stroke = 'white';
        removeFocusAnimations();
        removeLongBreakFloaters();
        removeShortBreakEffects();
        stopFlowAnimation();
        return;
    }

    if (pomodoroState.phase === 'focus') {
        applyBg('pomodoro-focus-bg');
        progressRing.style.stroke = 'white';
        removeLongBreakFloaters();
        removeShortBreakEffects();
        addFocusAnimations();
    } else if (pomodoroState.phase === 'longBreak') {
        applyBg('pomodoro-longbreak-bg');
        progressRing.style.stroke = 'white';
        removeFocusAnimations();
        removeShortBreakEffects();
        addLongBreakFloaters();
    } else {
        applyBg('pomodoro-break-bg');
        progressRing.style.stroke = 'white';
        removeLongBreakFloaters();
        removeFocusAnimations();
        addShortBreakEffects();
    }

    // focusing/resting 状态运行动画，其他状态暂停
    if (pomodoroState.state === 'focusing' || pomodoroState.state === 'resting') {
        startFlowAnimation();
    } else {
        stopFlowAnimation();
    }
}

// ==================== 长休息放空动画 (Deep Zenith) ====================
// 视觉暗示：浩瀚、深呼吸、彻底放松。使用大色块模糊星云和极其缓慢的巨大气泡。

function addLongBreakFloaters() {
    const leftPanel = document.getElementById('pomodoro-left-panel');
    if (!leftPanel) return;
    // 高级粒子动画开关关闭时不创建任何粒子容器
    if (document.body.classList.contains('no-particles')) return;
    // 立即移除正在淡出的旧容器，避免守卫条件误判
    const oldContainer = leftPanel.querySelector('.longbreak-float-container');
    if (oldContainer) oldContainer.remove();

    const container = document.createElement('div');
    container.className = 'longbreak-float-container';

    // 1. 生成星云柔光 (Nebula Clouds) - 大面积缓慢呼吸
    const cloudCount = 5;
    for (let i = 0; i < cloudCount; i++) {
        const cloud = document.createElement('div');
        cloud.className = 'nebula-cloud';

        const size = Math.random() * 25 + 35; // 35vw - 60vw 巨大
        const top = Math.random() * 100;
        const left = Math.random() * 100;
        const moveX = (Math.random() - 0.5) * 80;
        const moveY = (Math.random() - 0.5) * 80;
        const duration = (Math.random() * 10 + 15) * 1000; // 15s - 25s
        const delay = Math.random() * -20000;
        const maxOpacity = Math.random() * 0.15 + 0.1;

        cloud.style.width = `${size}vw`;
        cloud.style.height = `${size}vw`;
        cloud.style.top = `${top}%`;
        cloud.style.left = `${left}%`;

        cloud.animate([
            { transform: 'scale(1) translate(0, 0)', opacity: 0.05 },
            { transform: `scale(1.3) translate(${moveX}px, ${moveY}px)`, opacity: maxOpacity }
        ], {
            duration: duration,
            easing: 'ease-in-out',
            iterations: Infinity,
            direction: 'alternate',
            delay: delay
        });

        container.appendChild(cloud);
    }

    // 2. 生成流光射线 (Light Rays) - 增加纵深感
    const rayCount = 6;
    for (let i = 0; i < rayCount; i++) {
        const ray = document.createElement('div');
        ray.className = 'light-ray';

        const width = Math.random() * 60 + 20;
        const startX = Math.random() * 100;
        const duration = (Math.random() * 8 + 8) * 1000; // 8s - 16s
        const delay = Math.random() * -10000;
        const maxOpacity = Math.random() * 0.08 + 0.02;

        ray.style.width = `${width}px`;

        ray.animate([
            { left: `${startX}%`, opacity: 0, transform: 'skewX(-15deg) translateY(10%)' },
            { left: `${startX}%`, opacity: maxOpacity, offset: 0.5 },
            { left: `${startX + 10}%`, opacity: 0, transform: 'skewX(-15deg) translateY(-10%)' }
        ], {
            duration: duration,
            easing: 'linear',
            iterations: Infinity,
            delay: delay
        });

        container.appendChild(ray);
    }

    // 3. 生成空灵气泡 (Zenith Orbs) - 具有微弱毛玻璃质感，缓慢上升
    const orbCount = 15;
    for (let i = 0; i < orbCount; i++) {
        const orb = document.createElement('div');
        orb.className = 'zenith-orb';

        const size = Math.random() * 50 + 25; // 25px - 75px
        const startX = Math.random() * 100;
        const duration = (Math.random() * 15 + 20) * 1000; // 20s - 35s
        const delay = Math.random() * -30000;
        const maxOpacity = Math.random() * 0.25 + 0.15;

        orb.style.left = `${startX}%`;
        orb.style.width = `${size}px`;
        orb.style.height = `${size}px`;

        orb.animate([
            { transform: 'translateY(0) scale(0.8) rotate(0deg)', opacity: 0 },
            { opacity: maxOpacity, offset: 0.2 },
            { opacity: maxOpacity, offset: 0.8 },
            { transform: 'translateY(-120vh) scale(1.2) rotate(180deg)', opacity: 0 }
        ], {
            duration: duration,
            easing: 'ease-in-out',
            iterations: Infinity,
            delay: delay
        });

        container.appendChild(orb);
    }

    leftPanel.appendChild(container);

    // 非运行状态下立即暂停动画
    if (pomodoroState.state !== 'resting') {
        container.querySelectorAll('.nebula-cloud, .light-ray, .zenith-orb').forEach(el => {
            el.getAnimations().forEach(a => a.pause());
        });
        leftPanel.parentElement.classList.add('pomodoro-animations-paused');
    }

    container.style.opacity = '0';
    container.style.transition = 'opacity 2s ease-in';
    setTimeout(() => container.style.opacity = '1', 50);
}

function removeLongBreakFloaters() {
    const leftPanel = document.getElementById('pomodoro-left-panel');
    if (!leftPanel) return;
    const container = leftPanel.querySelector('.longbreak-float-container');
    if (container) {
        container.style.transition = 'opacity 1.5s ease-out';
        container.style.opacity = '0';
        setTimeout(() => container.remove(), 1500);
    }
}

// ==================== 短休息聚能动画 (灵动流光版) ====================
// 短休息时，背景呈现流动的光束与灵动的能量火花(类似萤火虫)，象征快速充电与唤醒
// 整体更显华丽，但透明度受控，不会遮挡文字和番茄钟主体

function addShortBreakEffects() {
    const leftPanel = document.getElementById('pomodoro-left-panel');
    if (!leftPanel) return;
    // 高级粒子动画开关关闭时不创建任何粒子容器
    if (document.body.classList.contains('no-particles')) return;
    // 立即移除正在淡出的旧容器，避免守卫条件误判
    const oldContainer = leftPanel.querySelector('.shortbreak-effect-container');
    if (oldContainer) oldContainer.remove();

    const container = document.createElement('div');
    container.className = 'shortbreak-effect-container';

    // 1. 添加背景微光脉冲 (模拟能量呼吸)
    const ambientPulse = document.createElement('div');
    ambientPulse.className = 'shortbreak-ambient-pulse';
    container.appendChild(ambientPulse);

    // 2. 生成极光/流光射线 (Light Rays) - 增加华丽感与纵深感
    const rayCount = 6;
    for (let i = 0; i < rayCount; i++) {
        const ray = document.createElement('div');
        ray.className = 'light-ray';

        const width = Math.random() * 60 + 20;
        const startX = Math.random() * 100;
        const duration = (Math.random() * 4 + 4) * 1000; // 4s - 8s
        const delay = Math.random() * -6000;
        const maxOpacity = Math.random() * 0.08 + 0.02;

        ray.style.width = `${width}px`;

        ray.animate([
            { left: `${startX}%`, opacity: 0, transform: 'skewX(-15deg) translateY(10%)' },
            { left: `${startX}%`, opacity: maxOpacity, offset: 0.5 },
            { left: `${startX + 10}%`, opacity: 0, transform: 'skewX(-15deg) translateY(-10%)' }
        ], {
            duration: duration,
            easing: 'linear',
            iterations: Infinity,
            delay: delay
        });

        container.appendChild(ray);
    }

    // 3. 生成灵动萤火 (Zen Fireflies) - S型不规则上升轨迹，伴随呼吸缩放
    const fireflyCount = 25;
    for (let i = 0; i < fireflyCount; i++) {
        const firefly = document.createElement('div');
        firefly.className = 'zen-firefly';

        const size = Math.random() * 3 + 1.5;
        const startX = Math.random() * 100;
        const sway = (Math.random() - 0.5) * 120;
        const duration = (Math.random() * 6 + 6) * 1000;
        const delay = Math.random() * -15000;
        const maxOpacity = Math.random() * 0.6 + 0.2;

        firefly.style.left = `${startX}%`;
        firefly.style.width = `${size}px`;
        firefly.style.height = `${size}px`;

        firefly.animate([
            { transform: 'translate(0, 0) scale(0.3)', opacity: 0 },
            { transform: `translate(${sway * 0.6}px, -15vh) scale(1)`, opacity: maxOpacity, offset: 0.15 },
            { transform: `translate(${sway}px, -40vh) scale(1.2)`, offset: 0.35 },
            { transform: `translate(${sway * -0.5}px, -70vh) scale(0.8)`, offset: 0.65 },
            { transform: `translate(${sway * 0.3}px, -90vh) scale(1.1)`, opacity: maxOpacity * 0.8, offset: 0.85 },
            { transform: `translate(${sway * 1.2}px, -115vh) scale(0.2)`, opacity: 0 }
        ], {
            duration: duration,
            easing: 'ease-in-out',
            iterations: Infinity,
            delay: delay
        });

        container.appendChild(firefly);
    }

    leftPanel.appendChild(container);

    // 非运行状态下立即暂停动画
    if (pomodoroState.state !== 'resting') {
        container.querySelectorAll('.light-ray, .zen-firefly').forEach(el => {
            el.getAnimations().forEach(a => a.pause());
        });
        leftPanel.parentElement.classList.add('pomodoro-animations-paused');
    }
}

function removeShortBreakEffects() {
    const leftPanel = document.getElementById('pomodoro-left-panel');
    if (!leftPanel) return;
    const container = leftPanel.querySelector('.shortbreak-effect-container');
    if (container) {
        container.style.transition = 'opacity 0.8s ease-out';
        container.style.opacity = '0';
        setTimeout(() => container.remove(), 800);
    }
}

// ==================== 专注心流场动画 (Deep Flow Matrix) ====================
// 视觉暗示：向内收拢、聚集。生成向中心汇聚的微光和微弱外扩的同心圆涟漪。

function addFocusAnimations() {
    const leftPanel = document.getElementById('pomodoro-left-panel');
    if (!leftPanel) return;
    // 高级粒子动画开关关闭时不创建任何粒子容器
    if (document.body.classList.contains('no-particles')) return;
    // 立即移除正在淡出的旧容器，避免守卫条件误判
    const oldContainer = leftPanel.querySelector('.focus-flow-container');
    if (oldContainer) oldContainer.remove();

    const container = document.createElement('div');
    container.className = 'focus-flow-container';

    // 判断当前是否处于运行状态（非运行状态下创建动画后需立即暂停）
    const shouldRun = pomodoroState.state === 'focusing' || pomodoroState.state === 'resting';

    // 1. 生成向心粒子 (Focus Particles) - 从四周边缘诞生，向中心汇聚
    const particleCount = 24;
    const panelRect = leftPanel.getBoundingClientRect();

    // 防御：面板尺寸为0时延迟重试（重试前校验阶段，避免阶段已切换时仍创建旧动画）
    if (panelRect.width === 0 || panelRect.height === 0) {
        setTimeout(() => {
            if (pomodoroState.phase === 'focus') addFocusAnimations();
        }, 200);
        return;
    }

    const centerX = panelRect.width / 2;
    const centerY = panelRect.height / 2;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'focus-particle';

        // 随机分配在面板的四个边缘
        let startX, startY;
        const edge = Math.floor(Math.random() * 4);
        if (edge === 0) { startX = Math.random() * panelRect.width; startY = -20; } // 上
        else if (edge === 1) { startX = Math.random() * panelRect.width; startY = panelRect.height + 20; } // 下
        else if (edge === 2) { startX = -20; startY = Math.random() * panelRect.height; } // 左
        else { startX = panelRect.width + 20; startY = Math.random() * panelRect.height; } // 右

        const dx = centerX - startX; // 水平位移量（向中心）
        const dy = centerY - startY; // 垂直位移量（向中心）

        const size = Math.random() * 3 + 2; // 2px - 5px
        const duration = (Math.random() * 8 + 10) * 1000; // 10s - 18s (ms)
        const delay = Math.random() * -15000; // ms
        const maxOpacity = Math.random() * 0.35 + 0.15; // 15% - 50%

        // 使用内联样式设置初始位置和大小（避免 @keyframes 中使用 var() 的兼容性问题）
        particle.style.left = `${startX}px`;
        particle.style.top = `${startY}px`;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;

        // 使用 Web Animations API 驱动动画（兼容性优于 @keyframes 中的 var()）
        const anim = particle.animate([
            { transform: 'translate(0, 0) scale(0.5)', opacity: 0 },
            { transform: `translate(${dx * 0.15}px, ${dy * 0.15}px) scale(1)`, opacity: maxOpacity, offset: 0.15 },
            { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(0.8)`, opacity: maxOpacity, offset: 0.7 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0 }
        ], {
            duration: duration,
            easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            iterations: Infinity,
            delay: delay
        });

        container.appendChild(particle);
    }

    leftPanel.appendChild(container);

    // 非运行状态下立即暂停动画，防止idle时粒子短暂运动
    if (!shouldRun) {
        container.querySelectorAll('.focus-particle').forEach(el => {
            el.getAnimations().forEach(a => a.pause());
        });
        leftPanel.parentElement.classList.add('pomodoro-animations-paused');
    }

    // 淡入效果
    container.style.opacity = '0';
    container.style.transition = 'opacity 2s ease-in';
    setTimeout(() => container.style.opacity = '1', 50);
}

function removeFocusAnimations() {
    const leftPanel = document.getElementById('pomodoro-left-panel');
    if (!leftPanel) return;
    const container = leftPanel.querySelector('.focus-flow-container');
    if (container) {
        container.style.transition = 'opacity 1.5s ease-out';
        container.style.opacity = '0';
        setTimeout(() => container.remove(), 1500);
    }
}

// 全屏切换后面板尺寸变化，重新生成当前阶段的动画效果
function refreshPomodoroAnimations() {
    // 双重 rAF 确保浏览器已完成布局重计算（退出全屏时 flex 变化需要一帧才能生效）
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const leftPanel = document.getElementById('pomodoro-left-panel');
            if (!leftPanel) return;

            // 立即移除所有动画容器（不做淡出，因为是尺寸变化的即时刷新）
            leftPanel.querySelectorAll('.focus-flow-container, .longbreak-float-container, .shortbreak-effect-container').forEach(el => el.remove());

            if (pomodoroState.phase === 'focus') {
                addFocusAnimations();
            } else if (pomodoroState.phase === 'longBreak') {
                addLongBreakFloaters();
            } else if (pomodoroState.phase === 'break') {
                addShortBreakEffects();
            }

            // 如果当前处于暂停状态，重新暂停动画
            if (pomodoroState.state === 'pause' || pomodoroState.state === 'end_settlement') {
                stopFlowAnimation();
            }
        });
    });
}

function updateMainViewBackground() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;
    if (mainContent.classList.contains('hidden')) return;
    
    const isRunning = pomodoroState.state === 'focusing' || pomodoroState.state === 'resting';
    if (isRunning && pomodoroState.phase === 'focus') {
        mainContent.classList.remove('view-break');
        mainContent.classList.add('view-focus');
    } else if (isRunning && (pomodoroState.phase === 'break' || pomodoroState.phase === 'longBreak')) {
        mainContent.classList.remove('view-focus');
        mainContent.classList.add('view-break');
    } else {
        mainContent.classList.remove('view-focus', 'view-break');
    }
}

function clearMainViewBackground() {
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.classList.remove('view-focus', 'view-break');
    }
}

function updateMainContentBackground() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;
    
    const isRunning = pomodoroState.state === 'focusing' || pomodoroState.state === 'resting';
    if (!isRunning) {
        mainContent.classList.remove('view-focus', 'view-break');
        return;
    }
    
    if (pomodoroState.phase === 'focus') {
        mainContent.classList.remove('view-break');
        mainContent.classList.add('view-focus');
    } else {
        mainContent.classList.remove('view-focus');
        mainContent.classList.add('view-break');
    }
}

function clearMainContentBackground() {
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.classList.remove('view-focus', 'view-break');
    }
}

function renderPomodoroPage() {
    // 更新统计数据
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayPomodoros = pomodoroHistory.filter(p => {
        const pDate = new Date(p.date);
        pDate.setHours(0, 0, 0, 0);
        return pDate.getTime() === today.getTime();
    }).length;
    
    const todayMinutes = todayPomodoros * pomodoroState.focusDuration;
    const totalPomodoros = pomodoroHistory.length;
    const totalMinutes = totalPomodoros * pomodoroState.focusDuration;
    
    document.getElementById('today-pomodoros').textContent = todayPomodoros;
    document.getElementById('today-minutes').textContent = formatFocusMinutes(todayMinutes);
    document.getElementById('total-pomodoros').textContent = totalPomodoros;
    document.getElementById('total-minutes').textContent = formatFocusMinutes(totalMinutes);

    // 渲染历史记录
    const historyContainer = document.getElementById('pomodoro-history');
    
    if (pomodoroHistory.length === 0) {
        historyContainer.innerHTML = '<div class="text-center py-4 text-theme-muted">暂无历史记录</div>';
    } else {
        const grouped = {};
        pomodoroHistory.forEach(record => {
            const recordDate = record.startedAt ? new Date(record.startedAt) : new Date(record.date);
            const d = new Date(recordDate.getFullYear(), recordDate.getMonth(), recordDate.getDate());
            const key = d.getTime();
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(record);
        });

        const sortedKeys = Object.keys(grouped).map(Number).sort((a, b) => b - a);
        const currentYear = new Date().getFullYear();
        const allHistory = [];

        sortedKeys.forEach(key => {
            grouped[key].sort((a, b) => {
                const aStart = a.startedAt ? new Date(a.startedAt) : new Date(a.date);
                const bStart = b.startedAt ? new Date(b.startedAt) : new Date(b.date);
                return bStart - aStart;
            });
            const dateObj = new Date(key);
            const year = dateObj.getFullYear();
            const dateLabel = year === currentYear
                ? `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`
                : `${year}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
            allHistory.push({ dateLabel, records: grouped[key] });
        });

        historyContainer.innerHTML = allHistory.map(group => {
            const recordsHtml = group.records.map((record, idx) => {
                const startDate = record.startedAt ? new Date(record.startedAt) : new Date(record.date);
                const endDate = record.endedAt ? new Date(record.endedAt) : new Date(startDate.getTime() + (record.duration || 25) * 60000);
                const startStr = `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`;
                const endStr = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
                let taskDesc = record.taskName || '一般专注';
                if (taskDesc.length > 30) taskDesc = taskDesc.substring(0, 30) + '...';
                
                const task = record.taskId ? tasks.find(t => t.id === record.taskId) : null;
                const list = task ? lists.find(l => l.id === task.listId) : null;
                const listColor = list ? list.color : '#9ca3af';
                const listName = list ? list.name : '';
                
                const duration = record.duration || 25;
                const recordIdx = pomodoroHistory.indexOf(record);
                
                return `
                <div class="pomodoro-glass-item flex items-start gap-2 py-2.5 px-3 rounded-r-lg cursor-pointer group relative"
                     data-record-idx="${recordIdx}"
                     style="border-left: 4px solid ${listColor}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
                    <i class="fas fa-clock text-sm text-theme-muted flex-shrink-0" style="width: 0.875rem; margin-top: 0.125rem;"></i>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between">
                            <span class="text-sm text-theme-secondary">${startStr} - ${endStr}</span>
                            <div class="flex items-center gap-1 flex-shrink-0">
                                <button onclick="event.stopPropagation(); openRelinkTaskPanel(${recordIdx})" class="hidden group-hover:flex items-center justify-center w-5 h-5 rounded hover:bg-white/15 text-white/40 hover:text-white transition" title="关联任务">
                                    <i class="fas fa-link text-xs"></i>
                                </button>
                                <span class="text-xs text-theme-muted">${duration}m</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                            <span class="text-sm text-theme-primary truncate">${taskDesc}</span>
                            ${listName ? `<span class="flex items-center gap-1 flex-shrink-0 text-xs text-theme-secondary"><span class="w-2 h-2 rounded-full" style="background-color: ${listColor}"></span><span>${listName}</span></span>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('');
            return `
            <div class="mb-4">
                <div class="flex items-center gap-2 mb-2">
                    <h3 class="text-sm font-semibold text-theme-primary">${group.dateLabel}</h3>
                    <span class="text-xs text-theme-muted">(${group.records.length})</span>
                </div>
                ${recordsHtml}
            </div>`;
        }).join('');
    }
    
    // 更新任务按钮显示
    updatePomodoroTaskButton();
}

function renderPomodoroTaskList(onClickFn, currentTaskId) {
    const taskListContainer = document.getElementById('pomodoro-task-list');

    // 排序顺序：一般专注 → 已设置时间的未完成任务 → 未设置时间的未完成任务 → 已完成的任务
    // 组内保持原有时间排序（已设置时间组按时间升序；未设置时间组按 createdAt 升序；已完成组按 completedAt 倒序）
    const getTaskTime = (t) => t.startTime ? new Date(t.startTime).getTime() : (t.dueDate ? new Date(t.dueDate).getTime() : 0);
    const hasTime = (t) => !!(t.startTime || t.dueDate);

    const timedIncompleteTasks = tasks.filter(t => !t.completed && hasTime(t))
        .sort((a, b) => getTaskTime(a) - getTaskTime(b));
    const untimedIncompleteTasks = tasks.filter(t => !t.completed && !hasTime(t))
        .sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return aTime - bTime;
        });
    const completedTasks = tasks.filter(t => t.completed)
        .sort((a, b) => {
            const aTime = a.completedAt ? new Date(a.completedAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const bTime = b.completedAt ? new Date(b.completedAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            return bTime - aTime;
        });
    const allTasks = [...timedIncompleteTasks, ...untimedIncompleteTasks, ...completedTasks].slice(0, 15);

    // "一般专注"选项 - 取消关联任务
    const isGeneralFocus = !currentTaskId;
    const generalFocusHtml = `
        <div onclick="${onClickFn(null)}"
             class="flex items-start gap-3 py-2.5 px-3 rounded-r-lg transition cursor-pointer ${isGeneralFocus ? 'pomodoro-task-selected' : 'hover:brightness-95'}"
             style="border-left: 4px solid #9ca3af; border-top-left-radius: 0; border-bottom-left-radius: 0;">
            <button onclick="event.stopPropagation();" class="mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition border-theme">
            </button>
            <div class="flex-1 min-w-0">
                <div class="text-sm text-theme-primary truncate">一般专注</div>
            </div>
        </div>
    `;

    if (allTasks.length === 0) {
        taskListContainer.innerHTML = generalFocusHtml + '<div class="text-center py-4 text-theme-muted">暂无任务</div>';
    } else {
        const taskListHtml = allTasks.map(task => {
            const list = task.listId ? lists.find(l => l.id === task.listId) : null;
            const listColor = list ? list.color : '#9ca3af';
            const isCurrent = currentTaskId === task.id;
            const timeDisplay = task.startTime ? formatDateTime(task.startTime) : '未设置时间';
            const focusMinutes = getTaskFocusMinutes(task.id);

            return `
            <div onclick="${onClickFn(task.id)}"
                 class="flex items-start gap-3 py-2.5 px-3 rounded-r-lg transition cursor-pointer ${isCurrent ? 'pomodoro-task-selected' : 'hover:brightness-95'} ${task.completed ? 'opacity-55' : ''}"
                 style="border-left: 4px solid ${listColor}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
                <button onclick="event.stopPropagation();" class="mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-theme'}">
                    ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                </button>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 text-xs text-theme-secondary mb-0.5">
                        <span>${timeDisplay}</span>
                        ${list ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${listColor}"></span>${list.name}</span>` : ''}
                        ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-400"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                    </div>
                    <div class="text-sm ${task.completed ? 'text-theme-muted' : 'text-theme-primary'} truncate">${task.title || '新任务'}</div>
                </div>
            </div>
            `;
        }).join('');

        taskListContainer.innerHTML = generalFocusHtml + taskListHtml;
    }
}

function openPomodoroTaskPanel() {
    document.getElementById('pomodoro-task-panel-title').textContent = '专注任务';
    renderPomodoroTaskList(
        (taskId) => `selectPomodoroTask(${taskId ? `'${taskId}'` : 'null'})`,
        pomodoroState.currentTaskId
    );
    document.getElementById('pomodoro-task-panel').classList.remove('translate-x-full');
    document.getElementById('pomodoro-task-panel-overlay').classList.remove('hidden');
}

function closePomodoroTaskPanel() {
    document.getElementById('pomodoro-task-panel').classList.add('translate-x-full');
    document.getElementById('pomodoro-task-panel-overlay').classList.add('hidden');
}

function selectPomodoroTask(taskId) {
    _recordTaskSwitch(taskId);
    pomodoroState.currentTaskId = taskId || null;
    updatePomodoroTaskButton();
    closePomodoroTaskPanel();

    // 运行中、暂停中或结算中切换任务时，同步到服务器
    if (pomodoroState.state === 'focusing' || pomodoroState.state === 'resting' || pomodoroState.state === 'pause' || pomodoroState.state === 'end_settlement') {
        const task = taskId ? tasks.find(t => t.id === taskId) : null;
        pomodoroState.taskName = task ? task.title : '';
        fetch('/api/pomodoro/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentTaskId: taskId || null,
                taskName: task ? task.title : ''
            })
        }).catch(err => console.error('Update pomodoro task error:', err));
    }

    // 仅在非运行且非暂停状态下自动开始
    // 运行中(focusing/resting)或暂停中(pause)：只切换任务，不重置倒计时
    if (!taskId) {
        // 选择"一般专注"：取消任务关联，不自动开始
        return;
    }
    if (pomodoroState.state === 'idle') {
        // idle状态：保持原有行为，下次开始时使用新任务
    } else if (pomodoroState.state === 'end_settlement' || pomodoroState.state === 'completed' || pomodoroState.state === 'rest_ended') {
        // 结算/完成/休息结束状态：不自动开始，仅切换任务关联
    } else if (!isPomodoroRunning() && pomodoroState.state !== 'pause') {
        // 非运行且非暂停：自动开始（当前不会进入此分支，预留扩展）
        setPomodoroPhase('focus');
        startPomodoro();
    }
    // focusing/resting/pause: 仅切换任务关联，不重置计时器
    if (pomodoroState.state === 'focusing' || pomodoroState.state === 'resting' || pomodoroState.state === 'pause') {
        showToast('已切换专注任务', 'info');
    }
}

function updatePomodoroTaskButton() {
    const selectText = document.getElementById('pomodoro-select-task-text');
    const currentDisplay = document.getElementById('pomodoro-current-task-display');
    const currentTaskText = document.getElementById('pomodoro-current-task-text');
    
    if (pomodoroState.currentTaskId) {
        const task = tasks.find(t => t.id === pomodoroState.currentTaskId);
        if (task) {
            selectText.classList.add('hidden');
            currentDisplay.classList.remove('hidden');
            currentTaskText.textContent = task.title;
        } else {
            // 任务已删除，回退到一般专注
            pomodoroState.currentTaskId = null;
            selectText.classList.remove('hidden');
            currentDisplay.classList.add('hidden');
        }
    } else {
        selectText.classList.remove('hidden');
        currentDisplay.classList.add('hidden');
    }
}

function setPomodoroPhase(phase) {
    if (pomodoroState.state === 'focusing' || pomodoroState.state === 'resting') {
        stopPomodoro();
    }
    _pomodoroPaused = false;
    _pomodoroPhaseTransition = false;
    pomodoroState.phase = phase;
    if (phase === 'focus') {
        pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
    } else if (phase === 'longBreak') {
        pomodoroState.timeLeft = pomodoroState.longBreakDuration * 60;
        pomodoroState.breakDuration = pomodoroState.longBreakDuration;
    } else {
        pomodoroState.timeLeft = pomodoroState.shortBreakDuration * 60;
        pomodoroState.breakDuration = pomodoroState.shortBreakDuration;
    }
    pomodoroState.state = 'idle';
    updatePomodoroDisplay();
    updatePomodoroBackground();
}

function startPomodoroForTask(taskId) {
    pomodoroState.currentTaskId = taskId;
    _recordTaskSwitch(taskId);

    const isRunning = pomodoroState.state === 'focusing' || pomodoroState.state === 'resting' || pomodoroState.state === 'pause';
    if (!isRunning) {
        setPomodoroPhase('focus');
        pomodoroState.state = 'focusing';
        pomodoroState.originalStartedAt = new Date().toISOString();
        _restEndedAt = 0;  // 离开 rest_ended 状态
        startPomodoro();   // 内部统一设置 _pomodoroStartPending
        closePomodoroPage();
        switchToPomodoroPage();
        updatePomodoroDisplay();
    } else {
        // 暂停状态下切换任务后恢复计时
        if (pomodoroState.state === 'pause') {
            pomodoroState.state = 'focusing';
            startPomodoro(); // startPomodoro已包含服务端同步
        } else {
            // 专注/休息中切换任务，同步到服务器
            const task = taskId ? tasks.find(t => t.id === taskId) : null;
            pomodoroState.taskName = task ? task.title : '';
            fetch('/api/pomodoro/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentTaskId: taskId || null,
                    taskName: task ? task.title : ''
                })
            }).catch(err => console.error('Update pomodoro task error:', err));
        }
        closePomodoroPage();
        switchToPomodoroPage();
        updatePomodoroDisplay();
        showToast('已切换专注任务', 'info');
    }
}

function startPomodoroForTaskFromDetail() {
    if (currentDetailTaskId) {
        const taskId = currentDetailTaskId;
        closeTaskDetailPanel();
        startPomodoroForTask(taskId);
    }
}

// ==================== 专注中任务完成处理 ====================

// 当专注中的任务被勾选完成时调用
function onFocusTaskCompleted(taskId) {
    // 仅在专注/暂停状态下处理，且必须是当前关联的任务
    if (!taskId || taskId !== pomodoroState.currentTaskId) return;
    const currentState = pomodoroState.state;
    if (currentState !== 'focusing' && currentState !== 'pause') return;

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // 计算已专注的秒数
    let elapsedSeconds = 0;
    if (currentState === 'focusing') {
        elapsedSeconds = pomodoroState.totalDuration - pomodoroState.timeLeft;
    } else {
        // 暂停状态：totalDuration已重置为0，用原始总时长减去剩余时间
        elapsedSeconds = (pomodoroState.focusDuration * 60) - pomodoroState.timeLeft;
    }

    // 存储拆分信息
    _completedTaskInfo = {
        taskId: taskId,
        taskName: task.title,
        elapsedSeconds: elapsedSeconds
    };

    // 通知服务器记录拆分点
    fetch('/api/pomodoro/task_completed_during_focus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            taskId: taskId,
            taskName: task.title,
            elapsedSeconds: elapsedSeconds
        })
    }).catch(err => console.error('Task completed during focus error:', err));

    // 显示切换为"一般专注"，允许用户选择新任务
    pomodoroState.currentTaskId = null;
    // 同步到服务器，确保其他浏览器/tab能看到任务已解绑
    fetch('/api/pomodoro/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            currentTaskId: null,
            taskName: ''
        })
    }).catch(err => console.error('Update pomodoro task error:', err));
    updatePomodoroTaskButton();
}

// 记录切换到新任务B的时刻（用于拆分时计算B的实际专注时长和B的开始时间）
function _recordTaskSwitch(taskId) {
    if (!_completedTaskInfo) return;
    if (!taskId || taskId === _completedTaskInfo.taskId) return;
    if (pomodoroState.state !== 'focusing' && pomodoroState.state !== 'pause' && pomodoroState.state !== 'end_settlement') return;

    // 总专注时长 = 原始专注时长 - 剩余时长（跨暂停/恢复周期仍然正确）
    const elapsedSeconds = (pomodoroState.focusDuration * 60) - pomodoroState.timeLeft;
    _completedTaskInfo.taskBSwitchElapsedSeconds = elapsedSeconds;
}

// 构建拆分信息（用于abandon/complete时传递给服务器）
function _buildSplitInfo(activeTaskId, totalElapsedSeconds) {
    if (!_completedTaskInfo) return null;

    // 不切换任务（null或仍是已完成任务）：整个时长归已完成任务，不拆分
    if (!activeTaskId || activeTaskId === _completedTaskInfo.taskId) {
        return {
            completedTaskId: _completedTaskInfo.taskId,
            completedTaskName: _completedTaskInfo.taskName,
            completedElapsedSeconds: null  // null表示不拆分，整个时长归该任务
        };
    }

    // 切换到了新任务B：使用B的实际切换时间计算B的专注时长
    // taskBSwitchElapsedSeconds记录了切换到B的时刻（若未记录则回退到A完成时刻）
    const switchElapsed = (_completedTaskInfo.taskBSwitchElapsedSeconds != null)
        ? _completedTaskInfo.taskBSwitchElapsedSeconds
        : _completedTaskInfo.elapsedSeconds;
    const taskBSeconds = totalElapsedSeconds - switchElapsed;
    // B的专注时间不足2分钟（120秒）时不拆分，整个时长归已完成任务A
    if (taskBSeconds < 120) {
        return {
            completedTaskId: _completedTaskInfo.taskId,
            completedTaskName: _completedTaskInfo.taskName,
            completedElapsedSeconds: null
        };
    }

    // B的专注时间超过2分钟：拆分，B的开始时间=切换时间
    return {
        completedTaskId: _completedTaskInfo.taskId,
        completedTaskName: _completedTaskInfo.taskName,
        completedElapsedSeconds: switchElapsed
    };
}

// ==================== 新状态机事件处理 ====================

// 辅助：判断是否正在运行（倒计时进行中）
function isPomodoroRunning() {
    return pomodoroState.state === 'focusing' || pomodoroState.state === 'resting';
}

// 辅助：开始新专注前检查关联任务，若已完成或被删除则退回"一般专注"
function clearCompletedTaskBinding() {
    if (pomodoroState.currentTaskId) {
        const task = tasks.find(t => t.id === pomodoroState.currentTaskId);
        if (!task || task.completed) {
            pomodoroState.currentTaskId = null;
        }
    }
}

// 【事件】START_FOCUS - Idle → Focusing
function handleStartFocus() {
    if (pomodoroState.state !== 'idle' && pomodoroState.state !== 'rest_ended') return;
    // 休息完成后开始新专注：若原关联任务已被标记完成，则退回"一般专注"
    clearCompletedTaskBinding();
    pomodoroState.phase = 'focus';
    pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
    pomodoroState.state = 'focusing';
    pomodoroState.originalStartedAt = new Date().toISOString();
    _completedTaskInfo = null;
    _endedTaskId = null;
    _restEndedAt = 0;  // 离开 rest_ended 状态
    startPomodoro();   // 内部统一设置 _pomodoroStartPending
    notifyOtherTabs();
}

// 【事件】PAUSE - Focusing → Pause
function handlePause() {
    if (pomodoroState.state !== 'focusing') return;
    stopPomodoro();
    pomodoroState.state = 'pause';
    _pomodoroPaused = true;
    updatePomodoroDisplay();
    updatePomodoroBackground();
    // 暂停/恢复操作在页面内进行，不需要系统级通知
    showToast('专注已暂停', 'warning');
    notifyOtherTabs();
}

// 【事件】RESUME - Pause → Focusing
function handleResume() {
    if (pomodoroState.state !== 'pause') return;
    pomodoroState.state = pomodoroState.phase === 'focus' ? 'focusing' : 'resting';
    _pomodoroPaused = false;
    resumePomodoro();
    notifyOtherTabs();
}

// 【事件】CLICK_END - Pause/Resting → End_Settlement
function handleClickEnd() {
    if (pomodoroState.state === 'rest_ended') {
        // 休息结束后的结束：直接回到idle，退回"一般专注"
        pomodoroState.state = 'idle';
        pomodoroState.phase = 'focus';
        pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
        pomodoroState.continuousTomatoCount = 0;
        pomodoroState.currentTaskId = null;
        _endedTaskId = null;
        _completedTaskInfo = null;
        _restEndedAt = 0;  // 离开 rest_ended 状态
        updatePomodoroDisplay();
        updatePomodoroBackground();
        updatePomodoroTaskButton();
        notifyOtherTabs();
        return;
    }
    if (pomodoroState.state !== 'pause' && pomodoroState.state !== 'resting') return;
    // 如果从 Resting 状态进入，需要先停止倒计时
    if (pomodoroState.state === 'resting') {
        stopPomodoro();
    }
    // 暂存原任务ID，显示退回"一般专注"
    _endedTaskId = pomodoroState.currentTaskId;
    pomodoroState.currentTaskId = null;
    _previousState = pomodoroState.state;
    pomodoroState.state = 'end_settlement';
    updatePomodoroDisplay();
    updatePomodoroBackground();
    updatePomodoroTaskButton();
}

// 【事件】SAVE_TIME - End_Settlement → Ended (计入时长)
function handleSaveTime() {
    // 优先使用当前选中的任务，否则使用结束前暂存的任务
    const activeTaskId = pomodoroState.currentTaskId || _endedTaskId;
    const task = activeTaskId ? tasks.find(t => t.id === activeTaskId) : null;
    pomodoroState.continuousTomatoCount = 0;

    // 构建拆分信息（总专注时长 = 原始专注时长 - 剩余时长）
    const totalElapsedSeconds = (pomodoroState.focusDuration * 60) - pomodoroState.timeLeft;
    const splitInfo = _buildSplitInfo(activeTaskId, totalElapsedSeconds);

    fetch('/api/pomodoro/abandon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            saveTime: true,
            currentTaskId: activeTaskId,
            taskName: task ? task.title : '一般专注',
            splitInfo: splitInfo
        })
    }).catch(err => console.error('Abandon pomodoro error:', err));

    _endedTaskId = null;
    _completedTaskInfo = null;
    doAutoForward();
    loadData().then(() => { renderView(); renderPomodoroPage(); });
    notifyOtherTabs();
}

// 【事件】DROP_ALL - End_Settlement → Ended (直接作废)
function handleDropAll() {
    pomodoroState.continuousTomatoCount = 0;
    _endedTaskId = null;
    _completedTaskInfo = null;

    fetch('/api/pomodoro/abandon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saveTime: false })
    }).catch(err => console.error('Abandon pomodoro error:', err));

    doAutoForward();
    notifyOtherTabs();
}

// 【事件】CANCEL - End_Settlement → Pause/Resting
function handleCancelSettlement() {
    const prevState = _previousState || 'pause';
    pomodoroState.state = prevState;
    // 恢复原任务ID
    if (_endedTaskId) {
        pomodoroState.currentTaskId = _endedTaskId;
        _endedTaskId = null;
    }
    if (prevState === 'resting') {
        startPomodoro();
        updatePomodoroBackground();
    } else {
        updatePomodoroDisplay();
        updatePomodoroBackground();
    }
    updatePomodoroTaskButton();
}

// 【事件】CLICK_REST - Completed → Resting
function handleClickRest() {
    if (pomodoroState.state !== 'completed') return;
    pomodoroState.timeLeft = pomodoroState.breakDuration * 60;
    pomodoroState.state = 'resting';
    _pomodoroCompletionHandled = false;
    // 休息不需要 originalStartedAt
    startPomodoro();
    updatePomodoroBackground();
    notifyOtherTabs();
}

// 【事件】SKIP_REST - Completed/Resting → Ended
function handleSkipRest() {
    if (pomodoroState.state !== 'completed' && pomodoroState.state !== 'resting') return;
    // 严格保留 continuousTomatoCount 不变
    if (pomodoroState.state === 'resting') {
        stopPomodoro();
    }
    _pomodoroCompletionHandled = false;
    
    // 必须通知服务器，确保双端状态对齐
    fetch('/api/pomodoro/skip_rest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }).catch(err => console.error('Skip rest error:', err));
    
    doAutoForward();
    notifyOtherTabs();
}

// 【事件】AUTO_FORWARD - Ended → Idle (自动清理路由站)
function doAutoForward() {
    // 局部环境清理：仅重置定时器相关参数，绝对不重置 continuousTomatoCount
    if (pomodoroState.timerId) {
        clearInterval(pomodoroState.timerId);
        pomodoroState.timerId = null;
    }
    pomodoroState.phase = 'focus';
    pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
    pomodoroState.state = 'idle';
    _pomodoroPaused = false;
    _pomodoroPhaseTransition = false;
    _endedTaskId = null;
    _completedTaskInfo = null;
    _restEndedAt = 0;  // 清理 rest_ended 时间戳
    clearMainViewBackground();
    updatePomodoroDisplay();
    updatePomodoroBackground();
    updatePomodoroTaskButton();
}

// 兼容旧接口：togglePomodoro 仍被侧栏等调用
function togglePomodoro() {
    switch (pomodoroState.state) {
        case 'idle':
            handleStartFocus();
            break;
        case 'focusing':
            handlePause();
            break;
        case 'pause':
            handleResume();
            break;
        case 'resting':
            handleSkipRest();
            break;
        case 'completed':
            handleClickRest();
            break;
    }
}

// 兼容旧接口：endPomodoro
function endPomodoro() {
    handleClickEnd();
}

// ==================== 核心计时器函数 ====================

function syncPomodoroFromServer() {
    fetch('/api/pomodoro').then(r => r.json()).then(state => {
        // 客户端刚启动新专注，服务器可能还是旧状态，跳过本次同步
        if (_pomodoroStartPending) return;
        
        // 检测休眠自动暂停：如果服务器状态变为pause但客户端之前在运行
        if (state.state === 'pause' && (pomodoroState.state === 'focusing' || pomodoroState.state === 'resting')) {
            showInAppNotification('系统休眠检测', '检测到系统休眠，专注已自动暂停');
        }
        // 检测休眠期间专注完成：客户端之前在运行，服务器已完成结算
        if (state.state === 'completed' && (pomodoroState.state === 'focusing' || pomodoroState.state === 'resting')) {
            if (state.phase !== 'focus') {
                showInAppNotification('专注完成', '系统休眠期间专注已自动完成');
            }
        }
        
        if (_pomodoroCompletionHandled && state.state !== 'completed' && state.state !== 'idle') {
            // 服务器已完成结算但客户端还在处理中，强制重置
            _pomodoroCompletionHandled = false;
        }
        
        // 同步服务器状态
        pomodoroState.phase = state.phase || 'focus';
        pomodoroState.continuousTomatoCount = state.continuousTomatoCount || 0;
        pomodoroState.completedPomodoros = state.completedPomodoros || 0;
        pomodoroState.currentTaskId = state.currentTaskId || null;
        pomodoroState.autoBreak = state.autoBreak || false;
        pomodoroState.autoFocus = state.autoFocus || false;
        pomodoroState.taskName = state.taskName || '';
        if (state.originalStartedAt) {
            pomodoroState.originalStartedAt = state.originalStartedAt;
        }

        // 使用服务器计算的 timeLeft（用 !== undefined 避免 timeLeft=0 被误判为 falsy）
        pomodoroState.timeLeft = state.timeLeft !== undefined ? state.timeLeft : 0;

        const serverState = state.state || 'idle';

        // 时长设置同步策略：
        // - 正在运行（focusing/resting/pause）时使用服务器的值，保持当前会话一致性
        // - 非运行状态（idle/completed）时使用 settings 中的最新值，确保用户修改设置后立即生效
        if (serverState === 'focusing' || serverState === 'resting' || serverState === 'pause') {
            pomodoroState.focusDuration = state.focusDuration || settings.focusDuration || 25;
            pomodoroState.shortBreakDuration = state.shortBreakDuration || settings.shortBreakDuration || 5;
            pomodoroState.longBreakDuration = state.longBreakDuration || settings.longBreakDuration || 15;
            pomodoroState.longBreakInterval = state.longBreakInterval || settings.longBreakInterval || 4;
            pomodoroState.breakDuration = state.breakDuration || settings.shortBreakDuration || 5;
        } else {
            // idle/completed：使用 settings 中的最新值，防止服务器旧值覆盖用户刚修改的设置
            pomodoroState.focusDuration = settings.focusDuration || 25;
            pomodoroState.shortBreakDuration = settings.shortBreakDuration || 5;
            pomodoroState.longBreakDuration = settings.longBreakDuration || 15;
            pomodoroState.longBreakInterval = settings.longBreakInterval || 4;
            pomodoroState.breakDuration = pomodoroState.phase === 'longBreak'
                ? pomodoroState.longBreakDuration : pomodoroState.shortBreakDuration;
        }
        
        if (serverState === 'focusing' || serverState === 'resting') {
            // 服务器正在运行：用服务器 timeLeft 启动本地倒计时
            pomodoroState.state = serverState;
            pomodoroState.totalDuration = pomodoroState.timeLeft;
            pomodoroState.startedAt = Date.now(); // 本地时间戳，仅用于本地倒计时
            
            if (pomodoroState.timerId) clearInterval(pomodoroState.timerId);
            pomodoroState.timerId = setInterval(() => {
                const elapsed = Math.floor((Date.now() - pomodoroState.startedAt) / 1000);
                pomodoroState.timeLeft = Math.max(0, pomodoroState.totalDuration - elapsed);
                updatePomodoroDisplay();
                if (pomodoroState.timeLeft <= 0) {
                    onPomodoroComplete();
                }
            }, 1000);
            
            startFlowAnimation();
            _pomodoroPaused = false;
        } else if (serverState === 'pause') {
            pomodoroState.state = 'pause';
            _pomodoroPaused = true;
            if (pomodoroState.timerId) {
                clearInterval(pomodoroState.timerId);
                pomodoroState.timerId = null;
            }
            stopFlowAnimation();
        } else if (serverState === 'completed') {
            pomodoroState.state = 'completed';
            if (pomodoroState.timerId) {
                clearInterval(pomodoroState.timerId);
                pomodoroState.timerId = null;
            }
            // 专注完成且开启了自动休息：直接进入休息，不显示过渡界面
            const currentPhase = pomodoroState.phase;
            if (currentPhase !== 'focus' && pomodoroState.autoBreak) {
                pomodoroState.timeLeft = pomodoroState.breakDuration * 60;
                _pomodoroCompletionHandled = false;
                pomodoroState.state = 'resting';
                startPomodoro();
                updatePomodoroBackground();
                // 服务器已发送通知，此处不再重复
                // 实时刷新右侧专注概况/历史记录
                loadData().then(() => { renderPomodoroPage(); });
            } else if (currentPhase === 'focus' && pomodoroState.autoFocus) {
                // 休息完成且开启了自动专注：直接进入专注
                clearCompletedTaskBinding();
                pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
                _pomodoroCompletionHandled = false;
                pomodoroState.state = 'focusing';
                pomodoroState.phase = 'focus';
                startPomodoro();
                updatePomodoroBackground();
                // 服务器已发送通知
            } else {
                _pomodoroPhaseTransition = true;
                // 非自动路径也刷新数据（completed/rest_ended状态需要显示最新记录）
                loadData().then(() => { renderPomodoroPage(); });
            }
        } else {
            // idle - 保护本地 completed/rest_ended 状态不被服务端覆盖
            // rest_ended 和 completed 都是等待用户操作的终端状态，服务端只存 idle，
            // 必须保持到用户点击按钮为止；多标签页场景下若其他标签开始新专注，
            // 服务端状态会变为 focusing/resting，由上方分支处理，不会进入此处
            if (pomodoroState.state === 'rest_ended' || pomodoroState.state === 'completed') {
                // 保持当前等待状态，不覆盖
            } else {
                pomodoroState.state = 'idle';
                if (pomodoroState.phase === 'focus') {
                    pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
                } else {
                    pomodoroState.timeLeft = pomodoroState.breakDuration * 60;
                }
            }
            if (pomodoroState.timerId) {
                clearInterval(pomodoroState.timerId);
                pomodoroState.timerId = null;
            }
        }
        
        updatePomodoroDisplay();
        updateSidebarPomodoroTimer();
        updatePomodoroBackground();
        updateMainViewBackground();
    }).catch(err => {
        console.error('Sync pomodoro error:', err);
    });
}

function startPomodoro() {
    startFlowAnimation();
    _pomodoroCompletionHandled = false;
    _pomodoroPaused = false;
    _pomodoroPhaseTransition = false;

    // 移除可能残留的确认弹窗
    const confirmModal = document.getElementById('pomodoro-confirm-modal');
    if (confirmModal) confirmModal.remove();

    updateMainViewBackground();
    updateMainContentBackground();
    pomodoroState.startedAt = Date.now();
    // 使用当前timeLeft作为totalDuration（暂停恢复或阶段切换时已正确设置）
    pomodoroState.totalDuration = pomodoroState.timeLeft;
    // 设置 originalStartedAt（如果是 focus 阶段且没有原值，设为当前时间）
    if (pomodoroState.phase === 'focus' && !pomodoroState.originalStartedAt) {
        pomodoroState.originalStartedAt = new Date().toISOString();
    }
    updateSidebarPomodoroTimer();

    // 彩蛋：心流大师检测
    easterEgg_onPomodoroStart();

    updatePomodoroDisplay();

    // 先清除可能残留的旧定时器，防止多个 setInterval 叠加
    if (pomodoroState.timerId) {
        clearInterval(pomodoroState.timerId);
        pomodoroState.timerId = null;
    }

    pomodoroState.timerId = setInterval(() => {
        const elapsed = Math.floor((Date.now() - pomodoroState.startedAt) / 1000);
        pomodoroState.timeLeft = Math.max(0, pomodoroState.totalDuration - elapsed);
        updatePomodoroDisplay();
        updateMainContentBackground();
        if (pomodoroState.timeLeft <= 0) {
            onPomodoroComplete();
        }
    }, 1000);

    const task = tasks.find(t => t.id === pomodoroState.currentTaskId);
    pomodoroState.taskName = task ? task.title : '一般专注';

    // 统一设置标志：防止后续 syncPomodoroFromServer 用旧状态覆盖（保护所有调用路径）
    _pomodoroStartPending = true;
    // 超时保护：10秒后强制清除，防止网络异常导致标志永久保持
    if (_pomodoroStartPendingTimer) {
        clearTimeout(_pomodoroStartPendingTimer);
    }
    _pomodoroStartPendingTimer = setTimeout(() => {
        _pomodoroStartPending = false;
        _pomodoroStartPendingTimer = null;
    }, 10000);

    fetch('/api/pomodoro/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            totalDuration: pomodoroState.totalDuration,
            phase: pomodoroState.phase,
            currentTaskId: pomodoroState.currentTaskId,
            taskName: task ? task.title : '',
            completedPomodoros: pomodoroState.completedPomodoros,
            focusDuration: pomodoroState.focusDuration,
            shortBreakDuration: pomodoroState.shortBreakDuration,
            longBreakDuration: pomodoroState.longBreakDuration,
            longBreakInterval: pomodoroState.longBreakInterval,
            breakDuration: pomodoroState.breakDuration,
            continuousTomatoCount: pomodoroState.continuousTomatoCount,
            autoBreak: settings.autoBreak || false,
            autoFocus: settings.autoFocus || false,
            originalStartedAt: pomodoroState.originalStartedAt || null
        })
    }).then(() => {
        // 服务器已处理 start 请求，允许后续 syncPomodoroFromServer 正常同步
        _pomodoroStartPending = false;
        if (_pomodoroStartPendingTimer) {
            clearTimeout(_pomodoroStartPendingTimer);
            _pomodoroStartPendingTimer = null;
        }
    }).catch(err => {
        _pomodoroStartPending = false;
        if (_pomodoroStartPendingTimer) {
            clearTimeout(_pomodoroStartPendingTimer);
            _pomodoroStartPendingTimer = null;
        }
        console.error('Start pomodoro error:', err);
    });
}

function stopPomodoro() {
    const wasRunning = isPomodoroRunning();
    
    if (wasRunning) {
        _pomodoroPaused = true;
        _pomodoroPhaseTransition = false;
    }
    updateMainViewBackground();
    clearMainContentBackground();
    
    if (pomodoroState.timerId) {
        clearInterval(pomodoroState.timerId);
        pomodoroState.timerId = null;
    }
    
    stopFlowAnimation();
    updateSidebarPomodoroTimer();
    
    fetch('/api/pomodoro/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeLeft: pomodoroState.timeLeft })
    }).catch(err => console.error('Stop pomodoro error:', err));
}

function resumePomodoro() {
    startFlowAnimation();
    _pomodoroCompletionHandled = false;
    _pomodoroPaused = false;
    _pomodoroPhaseTransition = false;

    updateMainViewBackground();
    updateMainContentBackground();
    pomodoroState.startedAt = Date.now();
    pomodoroState.totalDuration = pomodoroState.timeLeft;
    updateSidebarPomodoroTimer();

    easterEgg_onPomodoroStart();

    // 先清除可能残留的旧定时器，防止多个 setInterval 叠加
    if (pomodoroState.timerId) {
        clearInterval(pomodoroState.timerId);
        pomodoroState.timerId = null;
    }

    pomodoroState.timerId = setInterval(() => {
        const elapsed = Math.floor((Date.now() - pomodoroState.startedAt) / 1000);
        pomodoroState.timeLeft = Math.max(0, pomodoroState.totalDuration - elapsed);
        updatePomodoroDisplay();
        updateMainContentBackground();
        if (pomodoroState.timeLeft <= 0) {
            onPomodoroComplete();
        }
    }, 1000);

    // 设置标志：防止解锁屏幕时并发的 syncPomodoroFromServer 用旧 pause 状态覆盖刚恢复的 focusing 状态
    _pomodoroStartPending = true;
    if (_pomodoroStartPendingTimer) {
        clearTimeout(_pomodoroStartPendingTimer);
    }
    _pomodoroStartPendingTimer = setTimeout(() => {
        _pomodoroStartPending = false;
        _pomodoroStartPendingTimer = null;
    }, 10000);

    fetch('/api/pomodoro/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeLeft: pomodoroState.timeLeft })
    }).then(() => {
        _pomodoroStartPending = false;
        if (_pomodoroStartPendingTimer) {
            clearTimeout(_pomodoroStartPendingTimer);
            _pomodoroStartPendingTimer = null;
        }
    }).catch(err => {
        _pomodoroStartPending = false;
        if (_pomodoroStartPendingTimer) {
            clearTimeout(_pomodoroStartPendingTimer);
            _pomodoroStartPendingTimer = null;
        }
        console.error('Resume pomodoro error:', err);
    });
}

// 旧接口兼容：doEndPomodoro 已被 doAutoForward 替代，保留空函数以防引用
function doEndPomodoro() {
    pomodoroState.continuousTomatoCount = 0;
    doAutoForward();
}

// 旧接口兼容：三按钮操作已被新状态机事件替代
function startBreakFromTransition() { handleClickRest(); }
function skipBreakFromTransition() { handleSkipRest(); }
function endPomodoroFromTransition() { pomodoroState.continuousTomatoCount = 0; doAutoForward(); }

function onPomodoroComplete() {
    if (_pomodoroCompletionHandled) return;
    _pomodoroCompletionHandled = true;

    if (pomodoroState.timerId) {
        clearInterval(pomodoroState.timerId);
        pomodoroState.timerId = null;
    }

    const completedPhase = pomodoroState.phase;

    // 构建拆分信息（专注完成时才需要，此时timeLeft=0，总时长=focusDuration*60）
    const totalElapsedSeconds = pomodoroState.focusDuration * 60;
    const splitInfo = (completedPhase === 'focus') ? _buildSplitInfo(pomodoroState.currentTaskId, totalElapsedSeconds) : null;

    // 客户端倒计时归零时，通过 /sync_now 强制服务器立即执行Tick
    // 服务器Tick检测到时间到会直接完成结算，返回最新状态
    fetch('/api/pomodoro/sync_now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ splitInfo: splitInfo, completedPhase: completedPhase })
    }).then(r => r.json()).then(state => {
        // 从服务器响应更新状态
        if (state.continuousTomatoCount !== undefined) {
            pomodoroState.continuousTomatoCount = state.continuousTomatoCount;
        }
        if (state.completedPomodoros !== undefined) {
            pomodoroState.completedPomodoros = state.completedPomodoros;
        }
        if (state.phase !== undefined) {
            pomodoroState.phase = state.phase;
        }
        if (state.breakDuration !== undefined) {
            pomodoroState.breakDuration = state.breakDuration;
        }
        if (state.state !== undefined) {
            pomodoroState.state = state.state;
        }
        if (state.timeLeft !== undefined) {
            pomodoroState.timeLeft = state.timeLeft;
        }
        if (state.autoBreak !== undefined) {
            pomodoroState.autoBreak = state.autoBreak;
        }
        if (state.autoFocus !== undefined) {
            pomodoroState.autoFocus = state.autoFocus;
        }
        
        updatePomodoroDisplay();
        updateSidebarPomodoroTimer();
        updatePomodoroBackground();

        // 客户端只是"播放器"：完全依据服务器返回的权威状态决定下一步。
        // 彩蛋触发：仅当服务端确认由本次 sync_now 强制结算了专注阶段时才触发，
        // 避免客户端时钟快于服务端时，服务端已在休息阶段而客户端误触发专注完成彩蛋。
        const isFocusComplete = state.forceCompletedPhase === 'focus';

        // 触发彩蛋（仅在确实完成了一次专注时）
        if (isFocusComplete) {
            easterEgg_onPomodoroComplete(pomodoroState.focusDuration || 25);
        }

        const serverStateNow = state.state;

        if (serverStateNow === 'resting') {
            // 服务器已自动启动休息：直接作为播放器同步倒计时
            pomodoroState.state = 'resting';
            pomodoroState.totalDuration = pomodoroState.timeLeft;
            pomodoroState.startedAt = Date.now();
            _pomodoroCompletionHandled = false;
            if (pomodoroState.timerId) clearInterval(pomodoroState.timerId);
            pomodoroState.timerId = setInterval(() => {
                const elapsed = Math.floor((Date.now() - pomodoroState.startedAt) / 1000);
                pomodoroState.timeLeft = Math.max(0, pomodoroState.totalDuration - elapsed);
                updatePomodoroDisplay();
                if (pomodoroState.timeLeft <= 0) {
                    onPomodoroComplete();
                }
            }, 1000);
            startFlowAnimation();
            _pomodoroPaused = false;
            updatePomodoroBackground();
            loadData().then(() => { renderPomodoroPage(); });
        } else if (serverStateNow === 'focusing') {
            // 服务器已自动启动专注：直接作为播放器同步倒计时
            pomodoroState.state = 'focusing';
            pomodoroState.phase = 'focus';
            pomodoroState.totalDuration = pomodoroState.timeLeft;
            pomodoroState.startedAt = Date.now();
            _pomodoroCompletionHandled = false;
            if (pomodoroState.timerId) clearInterval(pomodoroState.timerId);
            pomodoroState.timerId = setInterval(() => {
                const elapsed = Math.floor((Date.now() - pomodoroState.startedAt) / 1000);
                pomodoroState.timeLeft = Math.max(0, pomodoroState.totalDuration - elapsed);
                updatePomodoroDisplay();
                if (pomodoroState.timeLeft <= 0) {
                    onPomodoroComplete();
                }
            }, 1000);
            startFlowAnimation();
            _pomodoroPaused = false;
            updatePomodoroBackground();
        } else if (serverStateNow === 'completed') {
            // 专注完成、未开启自动休息：进入过渡界面等待用户操作
            pomodoroState.state = 'completed';
            _pomodoroPhaseTransition = true;
            updatePomodoroDisplay();
            updatePomodoroBackground();
        } else if (serverStateNow === 'idle') {
            // 休息结束、无自动专注（或自动专注被拦截）：进入 rest_ended 等待用户确认
            pomodoroState.state = 'rest_ended';
            pomodoroState.phase = 'focus';
            pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
            _restEndedAt = Date.now();  // 记录进入时间（调试用）
            updatePomodoroDisplay();
            updatePomodoroBackground();
        }
        // 注：原 autoFocusBlocked 显式分支已合并到 idle 分支（服务器拦截后 state 即为 idle）

        // 重新加载数据同步历史记录
        _completedTaskInfo = null;
        loadData().then(() => {
            renderView();
            renderPomodoroPage();
        });
    }).catch(err => {
        console.error('Sync now error:', err);
        // 降级处理：通过 /complete 告知服务器完成
        const task = tasks.find(t => t.id === pomodoroState.currentTaskId);
        const fallbackSplitInfo = (completedPhase === 'focus') ? _buildSplitInfo(pomodoroState.currentTaskId, totalElapsedSeconds) : null;
        fetch('/api/pomodoro/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentTaskId: pomodoroState.currentTaskId,
                taskName: task ? task.title : '一般专注',
                splitInfo: fallbackSplitInfo
            })
        }).catch(() => {});
        _completedTaskInfo = null;
        // 降级UI
        const autoBreak = pomodoroState.autoBreak || false;
        const autoFocus = pomodoroState.autoFocus || false;
        if (completedPhase === 'focus') {
            // 专注完成：本地计算长/短休息
            pomodoroState.continuousTomatoCount = (pomodoroState.continuousTomatoCount || 0) + 1;
            const isLongBreak = pomodoroState.continuousTomatoCount % (pomodoroState.longBreakInterval || 4) === 0;
            if (isLongBreak) {
                pomodoroState.phase = 'longBreak';
                pomodoroState.breakDuration = pomodoroState.longBreakDuration || 15;
            } else {
                pomodoroState.phase = 'break';
                pomodoroState.breakDuration = pomodoroState.shortBreakDuration || 5;
            }
            // 降级路径也由服务器发送通知，此处不再重复
            if (autoBreak) {
                pomodoroState.timeLeft = pomodoroState.breakDuration * 60;
                pomodoroState.state = 'resting';
                startPomodoro();
                loadData().then(() => { renderPomodoroPage(); });
            } else {
                pomodoroState.state = 'completed';
            }
        } else {
            // 休息完成（降级路径也由服务器发送通知）
            if (autoFocus) {
                clearCompletedTaskBinding();
                pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
                pomodoroState.state = 'focusing';
                pomodoroState.phase = 'focus';
                startPomodoro();
            } else {
                pomodoroState.state = 'rest_ended';
                pomodoroState.phase = 'focus';
                pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
                _restEndedAt = Date.now();  // 记录进入时间（调试用）
            }
        }
        updatePomodoroDisplay();
        updatePomodoroBackground();
    });
}

function getTaskFocusMinutes(taskId) {
    const taskHistory = pomodoroHistory.filter(p => p.taskId === taskId);
    return taskHistory.reduce((total, record) => total + (record.duration || 0), 0);
}

function formatFocusMinutes(minutes) {
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

function showPomodoroConfirmModal(phase) {
    // 已废弃：右下角确认弹窗被新状态机按钮替代
    // 保留空函数以防旧代码引用
}

function confirmPomodoroAction(confirm) {
    // 已废弃：右下角确认弹窗被新状态机按钮替代
}

function updatePomodoroDisplay() {
    const minutes = Math.floor(pomodoroState.timeLeft / 60);
    const seconds = pomodoroState.timeLeft % 60;
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    document.getElementById('pomodoro-time').textContent = timeStr;
    
    const phaseIcon = document.getElementById('pomodoro-phase-icon');
    const phaseText = document.getElementById('pomodoro-phase-text');
    
    // 获取所有按钮元素
    const btnStartFocus = document.getElementById('btn-start-focus');
    const btnPause = document.getElementById('btn-pause');
    const btnResume = document.getElementById('btn-resume');
    const btnEnd = document.getElementById('btn-end');
    const btnStartRest = document.getElementById('btn-start-rest');
    const btnSkipRest = document.getElementById('btn-skip-rest');
    const btnSaveTime = document.getElementById('btn-save-time');
    const btnDropAll = document.getElementById('btn-drop-all');
    const btnCancelSettlement = document.getElementById('btn-cancel-settlement');
    const settlementBtns = document.getElementById('pomodoro-settlement-btns');
    const mainBtns = document.getElementById('pomodoro-main-btns');
    const settlementInfoText = document.getElementById('settlement-info-text');
    
    // 默认隐藏所有按钮
    const allBtns = [btnStartFocus, btnPause, btnResume, btnEnd, btnStartRest, btnSkipRest];
    allBtns.forEach(btn => { if (btn) btn.classList.add('hidden'); });
    // 隐藏结算按钮组
    if (settlementBtns) settlementBtns.classList.add('hidden');
    // 默认显示主按钮行
    if (mainBtns) mainBtns.classList.remove('hidden');
    
    const isFocus = pomodoroState.phase === 'focus';
    let phaseTextContent = '';
    
    switch (pomodoroState.state) {
        case 'idle':
            // 【状态1: Idle】显示"开始专注"（选择任务已集成到上方任务面板）
            if (btnStartFocus) btnStartFocus.classList.remove('hidden');
            if (phaseIcon) phaseIcon.className = 'fas fa-bullseye';
            phaseTextContent = '';
            break;
            
        case 'focusing':
            // 【状态2: Focusing】显示"暂停"
            if (btnPause) btnPause.classList.remove('hidden');
            if (phaseIcon) phaseIcon.className = isFocus ? 'fas fa-bullseye' : 'fas fa-mug-hot';
            phaseTextContent = isFocus ? '专注中' : '休息中';
            break;
            
        case 'pause':
            // 【状态3: Pause】显示"恢复专注"+"结束"
            if (btnResume) btnResume.classList.remove('hidden');
            if (btnEnd) btnEnd.classList.remove('hidden');
            if (phaseIcon) phaseIcon.className = isFocus ? 'fas fa-bullseye' : 'fas fa-mug-hot';
            phaseTextContent = isFocus ? '暂停中，去处理紧急事情吧' : '休息暂停';
            break;
            
        case 'end_settlement':
            // 【状态2.5: End_Settlement】显示内联结算按钮
            if (mainBtns) mainBtns.classList.add('hidden');
            if (settlementBtns) settlementBtns.classList.remove('hidden');
            if (phaseIcon) phaseIcon.className = 'fas fa-bullseye';
            
            // 根据已专注时长决定显示哪些按钮
            const isFromFocus = _previousState === 'pause' && pomodoroState.phase === 'focus';
            const elapsedSeconds = pomodoroState.totalDuration - pomodoroState.timeLeft;
            const elapsedMin = Math.floor(elapsedSeconds / 60);
            const elapsedSec = elapsedSeconds % 60;
            const timeStr = elapsedMin > 0 ? `${elapsedMin}分${elapsedSec > 0 ? elapsedSec + '秒' : '钟'}` : `${elapsedSec}秒`;
            const canSave = isFromFocus && elapsedSeconds >= 300; // 5分钟 = 300秒
            
            if (canSave) {
                // >= 5分钟：显示"计入任务并结束"+"直接作废"+"继续专注"
                if (btnSaveTime) btnSaveTime.classList.remove('hidden');
                if (settlementInfoText) {
                    if (pomodoroState.currentTaskId) {
                        settlementInfoText.textContent = `已专注 ${timeStr}，是否将该时长记录到任务中？`;
                    } else {
                        settlementInfoText.textContent = `已专注 ${timeStr}，是否记录该时长？`;
                    }
                }
            } else {
                // < 5分钟：只显示"直接作废"+"继续专注"
                if (btnSaveTime) btnSaveTime.classList.add('hidden');
                if (settlementInfoText) {
                    if (isFromFocus) {
                        settlementInfoText.textContent = `专注不足5分钟，无法计入时长`;
                    } else {
                        settlementInfoText.textContent = `中断将重置连续番茄数`;
                    }
                }
            }
            
            phaseTextContent = '确认结束';
            break;
            
        case 'completed':
            // 【状态4: Completed】显示"开始休息"+"跳过休息"
            if (btnStartRest) btnStartRest.classList.remove('hidden');
            if (btnSkipRest) btnSkipRest.classList.remove('hidden');
            if (phaseIcon) phaseIcon.className = 'fas fa-seedling';
            const isLongBreak = pomodoroState.phase === 'longBreak';
            const breakMinutes = isLongBreak ? pomodoroState.longBreakDuration : pomodoroState.shortBreakDuration;
            const breakType = isLongBreak ? '长休息' : '短休息';
            phaseTextContent = `番茄完成！接下来休息一下吧（${breakType} ${breakMinutes} 分钟）`;
            break;
            
        case 'resting':
            // 【状态6: Resting】显示"跳过休息"+"结束"
            if (btnSkipRest) btnSkipRest.classList.remove('hidden');
            if (btnEnd) btnEnd.classList.remove('hidden');
            if (phaseIcon) phaseIcon.className = 'fas fa-mug-hot';
            phaseTextContent = '休息中';
            break;
            
        case 'rest_ended':
            // 【状态7: Rest_Ended】休息结束，等待用户确认是否开始专注
            if (btnStartFocus) btnStartFocus.classList.remove('hidden');
            if (btnEnd) btnEnd.classList.remove('hidden');
            if (phaseIcon) phaseIcon.className = 'fas fa-bullseye';
            phaseTextContent = '休息结束！准备好开始新的专注了吗？';
            break;
            
        case 'ended':
            // 【状态5: Ended】瞬间流转，不显示按钮
            phaseTextContent = '';
            break;
    }
    
    if (phaseText) phaseText.textContent = phaseTextContent;
    if (phaseIcon) phaseIcon.style.display = phaseTextContent ? '' : 'none';
    
    // 更新进度环
    const totalSeconds = pomodoroState.phase === 'focus' ? pomodoroState.focusDuration * 60 : pomodoroState.breakDuration * 60;
    const rawProgress = totalSeconds > 0 ? pomodoroState.timeLeft / totalSeconds : 1;
    const progress = Math.min(1, Math.max(0, rawProgress)); // 钳制在 [0, 1]
    const circumference = 2 * Math.PI * 150;
    const offset = circumference * (1 - progress);
    const progressEl = document.getElementById('pomodoro-progress');
    // 阶段切换时（如专注→休息）禁用过渡，防止圆环从空到满的动画
    if (_pomodoroPhaseTransition || (_lastProgressPhase !== null && _lastProgressPhase !== pomodoroState.phase)) {
        progressEl.style.transition = 'none';
        progressEl.style.strokeDashoffset = offset;
        // 强制重绘后恢复过渡
        void progressEl.offsetHeight;
        progressEl.style.transition = 'stroke-dashoffset 0.3s ease';
        _pomodoroPhaseTransition = false;
    } else {
        progressEl.style.strokeDashoffset = offset;
    }
    _lastProgressPhase = pomodoroState.phase;
    const isRunning = pomodoroState.state === 'focusing' || pomodoroState.state === 'resting';
    if (isRunning) {
        if (pomodoroState.phase === 'focus') {
            progressEl.style.stroke = 'white';
            progressEl.classList.add('running-focus');
            progressEl.classList.remove('running-break');
        } else {
            progressEl.style.stroke = 'white';
            progressEl.classList.add('running-break');
            progressEl.classList.remove('running-focus');
        }
    } else {
        progressEl.style.stroke = 'white';
        progressEl.classList.remove('running-focus', 'running-break');
    }
    
    updateSidebarPomodoroTimer();
    updateMainViewBackground();
}

function updatePomodoroToggleBtn() {
    // 已废弃：按钮由 updatePomodoroDisplay 根据状态控制
    // 保留空函数以防旧代码引用
    updateSidebarPomodoroTimer();
}

// 更新侧栏番茄倒计时显示
function updateSidebarPomodoroTimer() {
    const sidebarTimer = document.getElementById('sidebar-pomodoro');
    const timerDisplay = document.getElementById('sidebar-pomodoro-time');
    const taskNameDisplay = document.getElementById('sidebar-pomodoro-task');
    
    if (!sidebarTimer) return;
    
    // 显示侧边栏计时器的条件：正在专注/休息、暂停、已完成(等待休息)、休息结束(等待专注)
    const shouldShow = pomodoroState.state === 'focusing' || 
                       pomodoroState.state === 'resting' || 
                       pomodoroState.state === 'pause' ||
                       pomodoroState.state === 'completed' ||
                       pomodoroState.state === 'rest_ended';
    
    if (shouldShow) {
        sidebarTimer.classList.remove('hidden');
        
        if (timerDisplay) {
            const minutes = Math.floor(pomodoroState.timeLeft / 60);
            const seconds = pomodoroState.timeLeft % 60;
            timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        
        if (taskNameDisplay) {
            if (pomodoroState.currentTaskId) {
                const task = tasks.find(t => t.id === pomodoroState.currentTaskId);
                if (task) {
                    taskNameDisplay.textContent = task.title;
                } else {
                    taskNameDisplay.textContent = '一般专注';
                }
            } else {
                taskNameDisplay.textContent = '一般专注';
            }
        }
        
        // 根据阶段和状态设置背景色
        if (pomodoroState.phase === 'focus') {
            if (pomodoroState.state === 'rest_ended') {
                // rest_ended 状态：静态蓝色背景，不播放动画
                sidebarTimer.style.background = 'linear-gradient(135deg, #0A1628 0%, #1A3562 50%, #2F5A9C 100%)';
                sidebarTimer.style.backgroundSize = '100% 100%';
                sidebarTimer.style.animation = 'none';
                sidebarTimer.style.animationPlayState = '';
            } else {
                sidebarTimer.style.background = 'linear-gradient(135deg, #0A1628 0%, #122543 14%, #1A3562 28%, #234780 42%, #2F5A9C 57%, #3D6DB5 71%, #4B7EC9 85%, #3D6DB5 100%)';
                sidebarTimer.style.backgroundSize = '400% 400%';
                sidebarTimer.style.animation = 'pomodoro-focus-flow 25s ease-in-out infinite';
                sidebarTimer.style.animationPlayState = (pomodoroState.state === 'focusing') ? 'running' : 'paused';
            }
        } else if (pomodoroState.state === 'completed') {
            // completed 状态：静态绿色背景，不播放动画
            sidebarTimer.style.background = 'linear-gradient(135deg, #1F5A43 0%, #266950 25%, #2D795C 50%, #348869 75%, #3C9876 100%)';
            sidebarTimer.style.backgroundSize = '100% 100%';
            sidebarTimer.style.animation = 'none';
            sidebarTimer.style.animationPlayState = '';
        } else {
            // resting 状态：播放绿色渐变动画
            sidebarTimer.style.background = 'linear-gradient(135deg, #184A36 0%, #1F5A43 14%, #266950 28%, #2D795C 42%, #348869 57%, #3C9876 71%, #40A37F 85%, #3C9876 100%)';
            sidebarTimer.style.backgroundSize = '400% 400%';
            sidebarTimer.style.animation = 'pomodoro-break-flow 25s ease-in-out infinite';
            sidebarTimer.style.animationPlayState = (pomodoroState.state === 'resting') ? 'running' : 'paused';
        }
    } else {
        // idle / end_settlement / ended 状态：隐藏
        sidebarTimer.classList.add('hidden');
    }
}

function openPomodoroSettings() {
    openSettingsModal();
    setTimeout(() => {
        const pomodoroSection = document.getElementById('settings-focus-duration');
        if (pomodoroSection) {
            pomodoroSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);
}

function sendBackendNotification(title, body) {
    fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title, body: body || '' })
    }).catch(err => {
        console.error('Notify error:', err);
    });
}

let _relinkRecordIdx = -1;

function openRelinkTaskPanel(recordIdx) {
    const record = pomodoroHistory[recordIdx];
    if (!record) return;
    _relinkRecordIdx = recordIdx;

    document.getElementById('pomodoro-task-panel-title').textContent = '关联到任务';
    renderPomodoroTaskList(
        (taskId) => `relinkTask(${recordIdx}, ${taskId ? `'${taskId}'` : 'null'})`,
        record.taskId
    );
    document.getElementById('pomodoro-task-panel').classList.remove('translate-x-full');
    document.getElementById('pomodoro-task-panel-overlay').classList.remove('hidden');
}

function relinkTask(recordIdx, taskId) {
    closePomodoroTaskPanel();

    if (recordIdx < 0 || recordIdx >= pomodoroHistory.length) return;
    const record = pomodoroHistory[recordIdx];

    if (taskId) {
        const task = tasks.find(t => t.id === taskId);
        record.taskId = taskId;
        record.taskName = task ? task.title : '一般专注';
    } else {
        record.taskId = null;
        record.taskName = '一般专注';
    }

    saveData();
    renderPomodoroPage();
    showToast('专注记录已重新关联', 'success');
}

function openBoringModal() {
    boringState.shownThings = [];
    boringState.swapCount = 0;
    showRandomThing();
    document.getElementById('boring-modal').classList.remove('hidden');
    document.getElementById('boring-modal').classList.add('flex');
}

function closeBoringModal() {
    document.getElementById('boring-modal').classList.add('hidden');
    document.getElementById('boring-modal').classList.remove('flex');
}

function showRandomThing() {
    const availableThings = mindfulThings.filter(t => !boringState.shownThings.some(s => s.id === t.id));
    const thing = availableThings[Math.floor(Math.random() * availableThings.length)];
    boringState.currentThing = thing;
    boringState.shownThings.push(thing);
    renderBoringContent();
}

function renderBoringContent() {
    const container = document.getElementById('boring-content');
    
    // 当已经显示了4个事情时，进入选择列表
    if (boringState.shownThings.length >= 4) {
        container.innerHTML = `
            <div class="space-y-4">
                <p class="text-theme-secondary text-center mb-4">你已经换了3次啦，请从以下选择一个：</p>
                <div class="space-y-3">
                    ${boringState.shownThings.map(thing => `
                        <div class="bg-purple-50 dark:bg-purple-900/30 rounded-xl p-4 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 transition border border-purple-200 dark:border-purple-700/50" onclick="acceptBoringThing('${thing.id}')">
                            <div class="font-medium text-purple-900 dark:text-purple-100">${thing.description}</div>
                            <div class="text-sm text-purple-700 dark:text-purple-300 mt-1">预计 ${thing.durationMinutes} 分钟</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else {
        const remaining = 3 - boringState.swapCount;
        container.innerHTML = `
            <div class="text-center">
                <div class="text-6xl mb-4 text-purple-500"><i class="fas fa-leaf"></i></div>
                <p class="text-xl font-medium text-theme-primary mb-2">${boringState.currentThing.description}</p>
                <p class="text-theme-muted mb-8">预计 ${boringState.currentThing.durationMinutes} 分钟</p>
                <div class="space-y-3">
                    <button onclick="acceptCurrentThing()" class="w-full py-3 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-xl font-medium hover:shadow-lg transition">
                        <i class="fas fa-leaf mr-2"></i>接受，去正念
                    </button>
                    <button onclick="swapBoringThing()" class="w-full py-3 border-2 border-theme text-theme-secondary rounded-xl font-medium hover:bg-theme-tertiary transition">
                        <i class="fas fa-sync-alt mr-2"></i>换一个${remaining > 0 ? `（还能换${remaining}次）` : ''}
                    </button>
                </div>
            </div>
        `;
    }
}

function swapBoringThing() {
    if (boringState.swapCount < 3) {
        boringState.swapCount++;
        showRandomThing();
    }
}

function acceptCurrentThing() {
    if (boringState.currentThing) {
        acceptBoringThing(boringState.currentThing.id);
    }
}

function acceptBoringThing(thingId) {
    const thing = mindfulThings.find(t => t.id === thingId);
    if (!thing) return;
    
    if (settings.autoCreateTask) {
        const todayStr = formatDate(new Date());
        tasks.push({
            id: generateId(),
            title: thing.description,
            listId: settings.defaultListId || 'default',
            important: settings.defaultImportant || false,
            urgent: settings.defaultUrgent || false,
            notes: '',
            tags: [],
            startTime: new Date(todayStr + 'T00:00:00').toISOString(),
            endTime: null,
            isAllDay: true,
            completed: false,
            createdAt: new Date().toISOString()
        });
        saveData();
        renderLists();
        renderView();
        showToast('已添加到今日任务！', 'success');
    } else {
        showToast('好的，去做吧！', 'info');
    }
    
    closeBoringModal();
}

let answerBookState = {
    isOpen: false,
    currentAnswer: null
};

function openAnswerBookModal() {
    answerBookState.isOpen = false;
    answerBookState.currentAnswer = null;
    const cover = document.getElementById('answer-book-cover');
    cover.classList.remove('flipping', 'closing');
    cover.style.transform = '';
    cover.style.pointerEvents = '';
    document.getElementById('answer-book-text').textContent = '';
    document.getElementById('answer-book-hint').classList.remove('hidden');
    document.getElementById('answer-book-revealed').classList.add('hidden');
    document.getElementById('answer-book-buttons').classList.add('hidden');
    document.getElementById('answer-book-modal').classList.remove('hidden');
    document.getElementById('answer-book-modal').classList.add('flex');
}

function closeAnswerBookModal() {
    document.getElementById('answer-book-modal').classList.add('hidden');
    document.getElementById('answer-book-modal').classList.remove('flex');
}

function flipAnswerBook() {
    const cover = document.getElementById('answer-book-cover');
    if (cover.classList.contains('flipping') || cover.classList.contains('closing')) return;
    
    cover.classList.add('flipping');
    cover.style.pointerEvents = 'none';
    
    const answer = bookAnswers[Math.floor(Math.random() * bookAnswers.length)];
    answerBookState.currentAnswer = answer;
    
    setTimeout(() => {
        cover.style.transform = 'rotateY(-170deg)';
        cover.classList.remove('flipping');
        
        const textEl = document.getElementById('answer-book-text');
        textEl.classList.remove('answer-book-answer');
        void textEl.offsetHeight;
        textEl.classList.add('answer-book-answer');
        textEl.textContent = answer;
        
        document.getElementById('answer-book-hint').classList.add('hidden');
        document.getElementById('answer-book-revealed').classList.remove('hidden');
        document.getElementById('answer-book-buttons').classList.remove('hidden');
        answerBookState.isOpen = true;
    }, 800);
}

function askAgain() {
    const cover = document.getElementById('answer-book-cover');
    cover.classList.add('closing');
    
    document.getElementById('answer-book-text').textContent = '';
    document.getElementById('answer-book-hint').classList.remove('hidden');
    document.getElementById('answer-book-revealed').classList.add('hidden');
    document.getElementById('answer-book-buttons').classList.add('hidden');
    
    answerBookState.isOpen = false;
    answerBookState.currentAnswer = null;
    
    setTimeout(() => {
        cover.style.transform = '';
        cover.classList.remove('closing');
        cover.style.pointerEvents = '';
    }, 600);
}

let statsSelectedDate = null;
let statsRecordsMonth = null; // 专注记录月份导航 { year, month }

function openPomodoroStats() {
    statsSelectedDate = new Date();
    statsSelectedDate.setHours(0, 0, 0, 0);
    // 默认当前月
    const now = new Date();
    statsRecordsMonth = { year: now.getFullYear(), month: now.getMonth() };
    document.getElementById('pomodoro-stats-page').classList.remove('hidden');
    renderPomodoroStats();
}

function openPomodoroStatsRecords() {
    // 从主界面跳转到统计界面的专注记录部分
    const now = new Date();
    statsSelectedDate = new Date();
    statsSelectedDate.setHours(0, 0, 0, 0);
    statsRecordsMonth = { year: now.getFullYear(), month: now.getMonth() };
    document.getElementById('pomodoro-stats-page').classList.remove('hidden');
    renderPomodoroStats();
    // 滚动到专注记录部分
    setTimeout(() => {
        const recordsSection = document.getElementById('stats-records');
        if (recordsSection) {
            recordsSection.closest('.bg-white')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 100);
}

function closePomodoroStats() {
    document.getElementById('pomodoro-stats-page').classList.add('hidden');
}

function formatMinutes(m) {
    if (!m || m <= 0) return '0m';
    const h = Math.floor(m / 60);
    const min = m % 60;
    return h > 0 ? h + 'h' + min + 'm' : min + 'm';
}

function getDayKey(d) {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt.getTime();
}

function getWeekDates(refDate) {
    const d = new Date(refDate);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const dt = new Date(monday);
        dt.setDate(monday.getDate() + i);
        dates.push(dt);
    }
    return dates;
}

function getStatsPeriod() {
    return document.getElementById('stats-period').value;
}

function getStatsPeriodLabel() {
    const period = getStatsPeriod();
    if (period === 'month') return '本月';
    if (period === 'last_month') return '上月';
    if (period === 'last_week') return '上周';
    if (period === 'year') return '本年';
    return '本周';
}

function getStatsDateRange() {
    const period = getStatsPeriod();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start, end;

    if (period === 'week') {
        start = getWeekDates(today)[0];
        end = new Date(today);
        end.setDate(end.getDate() + 1);
    } else if (period === 'last_week') {
        const thisMonday = getWeekDates(today)[0];
        start = new Date(thisMonday);
        start.setDate(start.getDate() - 7);
        end = new Date(thisMonday);
    } else if (period === 'month') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    } else if (period === 'last_month') {
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 1);
    } else {
        start = new Date(today.getFullYear(), 0, 1);
        end = new Date(today.getFullYear() + 1, 0, 1);
    }

    return { start, end };
}

function filterHistoryByPeriod() {
    const { start, end } = getStatsDateRange();
    return pomodoroHistory.filter(p => {
        const d = new Date(p.date);
        d.setHours(0, 0, 0, 0);
        return d >= start && d < end;
    });
}

function renderPomodoroStats() {
    const label = getStatsPeriodLabel();
    document.getElementById('stats-trend-period').textContent = label;
    document.getElementById('stats-timeline-period').textContent = label;
    document.getElementById('stats-best-time-period').textContent = label;
    
    renderStatsOverview();
    renderStatsTrendChart();
    renderStatsBestTimeChart();
    renderStatsTimeline();
    renderStatsHeatmap();
    renderStatsRecords();
}

function renderStatsOverview() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = today.getTime();
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.getTime();
    
    const todayRecords = pomodoroHistory.filter(p => getDayKey(p.date) === todayKey);
    const yesterdayRecords = pomodoroHistory.filter(p => getDayKey(p.date) === yesterdayKey);
    
    const todayCount = todayRecords.length;
    const yesterdayCount = yesterdayRecords.length;
    const todayMinutes = todayRecords.reduce((s, p) => s + (p.duration || 25), 0);
    const yesterdayMinutes = yesterdayRecords.reduce((s, p) => s + (p.duration || 25), 0);
    
    const periodRecords = filterHistoryByPeriod();
    const periodCount = periodRecords.length;
    const periodMinutes = periodRecords.reduce((s, p) => s + (p.duration || 25), 0);
    
    document.getElementById('stats-today-count').textContent = todayCount;
    document.getElementById('stats-total-count').textContent = periodCount;
    document.getElementById('stats-today-time').textContent = formatMinutes(todayMinutes);
    document.getElementById('stats-total-time').textContent = formatMinutes(periodMinutes);
    
    const countDiff = todayCount - yesterdayCount;
    const countDiffEl = document.getElementById('stats-today-count-diff');
    if (countDiff > 0) {
        countDiffEl.innerHTML = '<span class="text-green-500">↑ 比前一天多' + countDiff + '个</span>';
    } else if (countDiff < 0) {
        countDiffEl.innerHTML = '<span class="text-red-500">↓ 比前一天少' + Math.abs(countDiff) + '个</span>';
    } else {
        countDiffEl.innerHTML = '<span class="text-theme-muted">与前一天持平</span>';
    }

    const timeDiff = todayMinutes - yesterdayMinutes;
    const timeDiffEl = document.getElementById('stats-today-time-diff');
    if (timeDiff > 0) {
        timeDiffEl.innerHTML = '<span class="text-green-500">↑ 比前一天多' + formatMinutes(timeDiff) + '</span>';
    } else if (timeDiff < 0) {
        timeDiffEl.innerHTML = '<span class="text-red-500">↓ 比前一天少' + formatMinutes(Math.abs(timeDiff)) + '</span>';
    } else {
        timeDiffEl.innerHTML = '<span class="text-theme-muted">与前一天持平</span>';
    }
}

function renderStatsTrendChart() {
    const container = document.getElementById('stats-trend-chart');
    const period = getStatsPeriod();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let dates, dayLabels;
    
    if (period === 'week' || period === 'last_week') {
        if (period === 'last_week') {
            const thisMonday = getWeekDates(today)[0];
            const lastMonday = new Date(thisMonday);
            lastMonday.setDate(lastMonday.getDate() - 7);
            dates = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(lastMonday);
                d.setDate(lastMonday.getDate() + i);
                dates.push(d);
            }
        } else {
            dates = getWeekDates(today);
        }
        dayLabels = dates.map(d => {
            const day = d.getDay();
            return '周' + ['日','一','二','三','四','五','六'][day];
        });
    } else if (period === 'month' || period === 'last_month') {
        const refDate = period === 'last_month' ? new Date(today.getFullYear(), today.getMonth() - 1, 1) : today;
        const daysInMonth = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0).getDate();
        dates = [];
        dayLabels = [];
        for (let i = 1; i <= daysInMonth; i++) {
            const d = new Date(refDate.getFullYear(), refDate.getMonth(), i);
            dates.push(d);
            dayLabels.push(i + '');
        }
    } else {
        dates = [];
        dayLabels = [];
        for (let m = 0; m < 12; m++) {
            dates.push(new Date(today.getFullYear(), m, 1));
            dayLabels.push((m + 1) + '月');
        }
    }
    
    const dailyMinutes = dates.map(d => {
        if (period === 'year') {
            const month = d.getMonth();
            const year = d.getFullYear();
            return pomodoroHistory
                .filter(p => { const pd = new Date(p.date); return pd.getFullYear() === year && pd.getMonth() === month; })
                .reduce((s, p) => s + (p.duration || 25), 0);
        }
        const key = getDayKey(d);
        return pomodoroHistory
            .filter(p => getDayKey(p.date) === key)
            .reduce((s, p) => s + (p.duration || 25), 0);
    });
    
    const maxMin = Math.max(...dailyMinutes, 1);
    const daysWithFocus = dailyMinutes.filter(m => m > 0).length;
    const avgMinutes = daysWithFocus > 0 ? Math.round(dailyMinutes.reduce((a, b) => a + b, 0) / daysWithFocus) : 0;
    
    document.getElementById('stats-trend-avg').textContent = '每日平均：' + formatMinutes(avgMinutes);

    let html = '<div class="flex items-end justify-between h-full gap-' + (period === 'month' || period === 'last_month' ? '0.5' : '2') + ' pb-6 relative">';
    html += '<div class="absolute bottom-6 left-0 right-0 border-t border-theme"></div>';

    dailyMinutes.forEach((mins, i) => {
        const height = maxMin > 0 ? Math.max((mins / maxMin) * 100, 0) : 0;
        const isToday = (period === 'week' || period === 'month') && dates[i].getTime() === today.getTime();
        const barColor = isToday ? 'background: var(--accent-color)' : 'background: #93c5fd';
        html += '<div class="flex-1 flex flex-col items-center justify-end h-full' + (period === 'month' || period === 'last_month' ? ' group' : '') + '">';
        if (mins > 0 && period !== 'month' && period !== 'last_month') {
            html += '<div class="text-xs text-theme-secondary mb-1">' + mins + 'm</div>';
        }
        if ((period === 'month' || period === 'last_month') && mins > 0) {
            html += '<div class="text-xs text-theme-secondary mb-1 opacity-0 group-hover:opacity-100 transition">' + mins + 'm</div>';
        }
        html += '<div class="stats-bar w-full" style="height: ' + Math.max(height, 2) + '%; ' + barColor + '"></div>';
        const showLabel = period === 'week' || period === 'last_week' || ((period === 'month' || period === 'last_month') && (i % 5 === 0 || i === dates.length - 1)) || period === 'year';
        html += '<div class="text-xs mt-2 ' + (isToday ? 'font-bold text-theme-primary' : 'text-theme-muted') + (showLabel ? '' : ' hidden') + '">' + dayLabels[i] + '</div>';
        html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

function renderStatsBestTimeChart() {
    const container = document.getElementById('stats-best-time-chart');
    const periodRecords = filterHistoryByPeriod();
    const hourSlots = [];
    for (let i = 0; i < 24; i += 3) {
        hourSlots.push(i);
    }
    
    const hourMinutes = new Array(8).fill(0);
    periodRecords.forEach(p => {
        const h = new Date(p.date).getHours();
        const slot = Math.floor(h / 3);
        if (slot >= 0 && slot < 8) {
            hourMinutes[slot] += (p.duration || 25);
        }
    });
    
    const maxMin = Math.max(...hourMinutes, 1);

    let html = '<div class="flex items-end justify-between h-full gap-1 pb-6 relative">';
    html += '<div class="absolute bottom-6 left-0 right-0 border-t border-theme"></div>';

    hourMinutes.forEach((mins, i) => {
        const height = maxMin > 0 ? (mins / maxMin) * 100 : 0;
        html += '<div class="flex-1 flex flex-col items-center justify-end h-full group">';
        if (mins > 0) {
            html += '<div class="text-xs text-theme-secondary mb-1 opacity-0 group-hover:opacity-100 transition">' + mins + 'm</div>';
        }
        html += '<div class="stats-bar w-full" style="height: ' + Math.max(height, 2) + '%; background: #a78bfa"></div>';
        html += '<div class="text-xs mt-2 text-theme-muted">' + String(hourSlots[i]).padStart(2, '0') + ':00</div>';
        html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

function renderStatsTimeline() {
    const container = document.getElementById('stats-timeline-chart');
    const period = getStatsPeriod();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let dates, dayLabels, colors;
    
    if (period === 'week' || period === 'last_week') {
        if (period === 'last_week') {
            const thisMonday = getWeekDates(today)[0];
            const lastMonday = new Date(thisMonday);
            lastMonday.setDate(lastMonday.getDate() - 7);
            dates = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(lastMonday);
                d.setDate(lastMonday.getDate() + i);
                dates.push(d);
            }
        } else {
            dates = getWeekDates(today);
        }
        dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
    } else if (period === 'month' || period === 'last_month') {
        const refDate = period === 'last_month' ? new Date(today.getFullYear(), today.getMonth() - 1, 1) : today;
        const daysInMonth = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0).getDate();
        dates = [];
        dayLabels = [];
        for (let i = 1; i <= daysInMonth; i++) {
            dates.push(new Date(refDate.getFullYear(), refDate.getMonth(), i));
            dayLabels.push(i + '');
        }
        const palette = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
        colors = dates.map((_, i) => palette[i % palette.length]);
    } else {
        dates = [];
        dayLabels = [];
        for (let m = 0; m < 12; m++) {
            dates.push(new Date(today.getFullYear(), m, 1));
            dayLabels.push((m + 1) + '月');
        }
        const palette = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
        colors = dates.map((_, i) => palette[i % palette.length]);
    }
    
    const timeLabels = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'];

    let html = '<div style="min-width: 600px;">';
    html += '<div class="flex mb-2">';
    html += '<div style="width: 40px" class="flex-shrink-0"></div>';
    html += '<div class="flex-1 flex justify-between text-xs text-theme-muted px-1">';
    timeLabels.forEach(l => { html += '<span>' + l + '</span>'; });
    html += '</div></div>';

    dates.forEach((date, di) => {
        let dayRecords;
        if (period === 'year') {
            const month = date.getMonth();
            const year = date.getFullYear();
            dayRecords = pomodoroHistory.filter(p => {
                const pd = new Date(p.date);
                return pd.getFullYear() === year && pd.getMonth() === month;
            });
        } else {
            const key = getDayKey(date);
            dayRecords = pomodoroHistory.filter(p => getDayKey(p.date) === key);
        }

        html += '<div class="flex items-center mb-1">';
        html += '<div style="width: 40px" class="flex-shrink-0 text-xs text-theme-secondary">' + dayLabels[di] + '</div>';
        html += '<div class="flex-1 relative" style="height: 22px; background: var(--bg-tertiary); border-radius: 4px;">';

        dayRecords.forEach(record => {
            const start = record.startedAt ? new Date(record.startedAt) : new Date(record.date);
            const startMin = start.getHours() * 60 + start.getMinutes();
            const dur = record.duration || 25;
            const leftPct = (startMin / 1440) * 100;
            const widthPct = (dur / 1440) * 100;
            html += '<div class="stats-timeline-bar" style="left: ' + leftPct + '%; width: ' + Math.max(widthPct, 0.5) + '%; background: ' + colors[di] + ';" title="' + record.taskName + ' ' + dur + '分钟"></div>';
        });

        html += '</div></div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

function renderStatsHeatmap() {
    const container = document.getElementById('stats-heatmap');
    const now = new Date();
    const year = now.getFullYear();
    const startDate = new Date(year, 0, 1);
    startDate.setHours(0, 0, 0, 0);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    const dayMap = {};
    pomodoroHistory.forEach(p => {
        const d = new Date(p.date);
        d.setHours(0, 0, 0, 0);
        const key = d.toISOString().slice(0, 10);
        dayMap[key] = (dayMap[key] || 0) + (p.duration || 25);
    });

    // 深色模式使用更暗的空格 + 更亮的绿色，浅色模式保持原配色
    function heatColor(mins) {
        if (mins === 0) return isDark ? '#374151' : '#ebedf0';
        if (mins < 60) return isDark ? '#0e4429' : '#9be9a8';
        if (mins < 180) return isDark ? '#006d32' : '#40c463';
        if (mins < 300) return isDark ? '#26a641' : '#30a14e';
        return isDark ? '#39d353' : '#216e39';
    }

    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    let html = '<div style="min-width: 700px;">';

    html += '<div class="flex mb-2">';
    html += '<div style="width: 30px" class="flex-shrink-0"></div>';
    let lastMonth = -1;
    const totalDays = Math.floor((new Date(year, 11, 31) - startDate) / 86400000) + 1;
    const startDow = startDate.getDay();
    const weekCount = Math.ceil((totalDays + startDow) / 7);
    for (let w = 0; w < weekCount; w++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + w * 7 - startDow);
        const m = d.getMonth();
        if (m !== lastMonth) {
            html += '<div class="text-xs text-theme-muted" style="width: 14px; margin-right: 2px;">' + monthNames[m] + '</div>';
            lastMonth = m;
        } else {
            html += '<div style="width: 16px;"></div>';
        }
    }
    html += '</div>';

    const dayLabels = ['', '一', '', '三', '', '五', ''];
    for (let dow = 0; dow < 7; dow++) {
        html += '<div class="flex items-center">';
        html += '<div style="width: 30px" class="flex-shrink-0 text-xs text-theme-muted text-right pr-2">' + dayLabels[dow] + '</div>';

        for (let w = 0; w < weekCount; w++) {
            const dayIndex = w * 7 + dow - startDow;
            const cellDate = new Date(startDate);
            cellDate.setDate(startDate.getDate() + dayIndex);

            if (cellDate.getFullYear() !== year || cellDate < startDate) {
                html += '<div style="width: 14px; height: 14px; margin: 1px;"></div>';
                continue;
            }

            if (cellDate > now) {
                html += '<div style="width: 14px; height: 14px; margin: 1px;"></div>';
                continue;
            }

            const key = cellDate.toISOString().slice(0, 10);
            const mins = dayMap[key] || 0;
            const dateStr = (cellDate.getMonth() + 1) + '月' + cellDate.getDate() + '日';

            html += '<div class="stats-heatmap-cell" style="background: ' + heatColor(mins) + '; margin: 1px;" title="' + dateStr + ', ' + formatMinutes(mins) + '"></div>';
        }

        html += '</div>';
    }

    html += '<div class="flex items-center gap-1 mt-3 justify-end">';
    html += '<span class="text-xs text-theme-muted">少</span>';
    html += '<div class="stats-heatmap-cell" style="background: ' + heatColor(0) + ';"></div>';
    html += '<div class="stats-heatmap-cell" style="background: ' + heatColor(30) + ';"></div>';
    html += '<div class="stats-heatmap-cell" style="background: ' + heatColor(120) + ';"></div>';
    html += '<div class="stats-heatmap-cell" style="background: ' + heatColor(240) + ';"></div>';
    html += '<div class="stats-heatmap-cell" style="background: ' + heatColor(400) + ';"></div>';
    html += '<span class="text-xs text-theme-muted">多</span>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
}

function renderStatsRecords() {
    const navContainer = document.getElementById('stats-date-nav');
    const recordsContainer = document.getElementById('stats-records');

    if (!statsRecordsMonth) {
        const now = new Date();
        statsRecordsMonth = { year: now.getFullYear(), month: now.getMonth() };
    }

    const { year, month } = statsRecordsMonth;
    const monthLabel = year + '年' + (month + 1) + '月';

    // 月导航栏
    navContainer.innerHTML =
        '<button onclick="navigateStatsRecordsMonth(-1)" class="w-7 h-7 flex items-center justify-center rounded hover:bg-theme-tertiary text-theme-muted hover:text-theme-primary transition"><i class="fas fa-chevron-left text-xs"></i></button>' +
        '<span class="text-sm font-medium text-theme-primary min-w-[100px] text-center">' + monthLabel + '</span>' +
        '<button onclick="navigateStatsRecordsMonth(1)" class="w-7 h-7 flex items-center justify-center rounded hover:bg-theme-tertiary text-theme-muted hover:text-theme-primary transition"><i class="fas fa-chevron-right text-xs"></i></button>';

    // 筛选该月所有记录
    const monthRecords = pomodoroHistory.filter(p => {
        const d = p.startedAt ? new Date(p.startedAt) : new Date(p.date);
        return d.getFullYear() === year && d.getMonth() === month;
    });

    if (monthRecords.length === 0) {
        recordsContainer.innerHTML = '<div class="text-center py-8 text-theme-muted">' + monthLabel + '暂无专注记录</div>';
        return;
    }

    // 按日期分组（与主界面历史记录格式一致）
    const grouped = {};
    monthRecords.forEach(record => {
        const recordDate = record.startedAt ? new Date(record.startedAt) : new Date(record.date);
        const d = new Date(recordDate.getFullYear(), recordDate.getMonth(), recordDate.getDate());
        const key = d.getTime();
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(record);
    });

    const sortedKeys = Object.keys(grouped).map(Number).sort((a, b) => b - a);
    const currentYear = new Date().getFullYear();

    recordsContainer.innerHTML = sortedKeys.map(key => {
        const dateObj = new Date(key);
        const recordYear = dateObj.getFullYear();
        const dateLabel = recordYear === currentYear
            ? (dateObj.getMonth() + 1) + '月' + dateObj.getDate() + '日'
            : recordYear + '年' + (dateObj.getMonth() + 1) + '月' + dateObj.getDate() + '日';

        // 同一天内按开始时间倒序
        grouped[key].sort((a, b) => {
            const aStart = a.startedAt ? new Date(a.startedAt) : new Date(a.date);
            const bStart = b.startedAt ? new Date(b.startedAt) : new Date(b.date);
            return bStart - aStart;
        });

        const recordsHtml = grouped[key].map(record => {
            const startDate = record.startedAt ? new Date(record.startedAt) : new Date(record.date);
            const endDate = record.endedAt ? new Date(record.endedAt) : new Date(startDate.getTime() + (record.duration || 25) * 60000);
            const startStr = startDate.getHours().toString().padStart(2, '0') + ':' + startDate.getMinutes().toString().padStart(2, '0');
            const endStr = endDate.getHours().toString().padStart(2, '0') + ':' + endDate.getMinutes().toString().padStart(2, '0');
            let taskDesc = record.taskName || '一般专注';
            if (taskDesc.length > 30) taskDesc = taskDesc.substring(0, 30) + '...';

            const task = record.taskId ? tasks.find(t => t.id === record.taskId) : null;
            const list = task ? lists.find(l => l.id === task.listId) : null;
            const listColor = list ? list.color : '#9ca3af';
            const listName = list ? list.name : '';
            const duration = record.duration || 25;
            const recordIdx = pomodoroHistory.indexOf(record);

            return '<div class="flex items-center gap-3 py-2.5 px-3 rounded-r-lg hover:bg-theme-tertiary transition cursor-pointer group relative" ' +
                'data-record-idx="' + recordIdx + '" ' +
                'style="border-left: 4px solid ' + listColor + ';">' +
                '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center justify-between">' +
                '<span class="text-sm text-theme-secondary"><i class="fas fa-clock mr-1"></i>' + startStr + ' - ' + endStr + '</span>' +
                '<div class="flex items-center gap-1 flex-shrink-0">' +
                '<button onclick="event.stopPropagation(); openRelinkTaskPanel(' + recordIdx + ')" class="hidden group-hover:flex items-center justify-center w-5 h-5 rounded hover:bg-theme-primary text-theme-muted hover:text-blue-500 transition" title="关联任务"><i class="fas fa-link text-xs"></i></button>' +
                '<span class="text-xs text-theme-muted">' + duration + 'm</span>' +
                '</div></div>' +
                '<div class="flex items-center gap-2 mt-0.5">' +
                '<span class="text-sm text-theme-primary truncate">' + taskDesc + '</span>' +
                (listName ? '<span class="flex items-center gap-1 flex-shrink-0 text-xs text-theme-secondary"><span class="w-2 h-2 rounded-full" style="background-color: ' + listColor + '"></span><span>' + listName + '</span></span>' : '') +
                '</div></div></div>';
        }).join('');

        return '<div class="mb-4">' +
            '<div class="flex items-center gap-2 mb-2">' +
            '<h4 class="text-sm font-semibold text-theme-primary">' + dateLabel + '</h4>' +
            '<span class="text-xs text-theme-muted">(' + grouped[key].length + ')</span>' +
            '</div>' +
            recordsHtml +
            '</div>';
    }).join('');
}

function navigateStatsRecordsMonth(delta) {
    if (!statsRecordsMonth) return;
    statsRecordsMonth.month += delta;
    if (statsRecordsMonth.month > 11) {
        statsRecordsMonth.month = 0;
        statsRecordsMonth.year++;
    } else if (statsRecordsMonth.month < 0) {
        statsRecordsMonth.month = 11;
        statsRecordsMonth.year--;
    }
    renderStatsRecords();
}
