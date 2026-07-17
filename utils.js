// 数据模型
let lists = [];
let tasks = [];
let settings = {};
let currentView = 'task';
let currentListId = null;
let currentFilter = null;
let currentTagIds = []; // 当前标签筛选（并集）
let currentFilterId = null; // 当前自定义过滤器ID
let currentDate = new Date();
let currentTaskMode = 'text';
let holidayData = {};

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

// Toast通知 - 游戏任务提示风格
function showToast(message, type = 'info', customDuration = null, title = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');

    const themes = {
        success: {
            color: 'text-green-400', border: 'border-green-500', bg: 'bg-green-500',
            shadow: 'shadow-[0_0_15px_rgba(34,197,94,0.3)]', icon: 'fa-check-double', defaultTitle: 'QUEST COMPLETE'
        },
        error: {
            color: 'text-red-500', border: 'border-red-600', bg: 'bg-red-600',
            shadow: 'shadow-[0_0_15px_rgba(220,38,38,0.3)]', icon: 'fa-skull', defaultTitle: 'MISSION FAILED'
        },
        info: {
            color: 'text-cyan-400', border: 'border-cyan-500', bg: 'bg-cyan-500',
            shadow: 'shadow-[0_0_15px_rgba(6,182,212,0.3)]', icon: 'fa-scroll', defaultTitle: 'NEW QUEST'
        },
        warning: {
            color: 'text-amber-400', border: 'border-amber-500', bg: 'bg-amber-500',
            shadow: 'shadow-[0_0_15px_rgba(245,158,11,0.3)]', icon: 'fa-exclamation-triangle', defaultTitle: 'WARNING'
        }
    };

    const theme = themes[type] || themes.info;
    const displayTitle = title || theme.defaultTitle;
    const duration = customDuration || (settings?.toastDuration || 5) * 1000;

    toast.className = `quest-toast flex items-center p-4 bg-slate-900/95 backdrop-blur-sm border-l-4 ${theme.border} text-slate-200 ${theme.shadow} w-full cursor-pointer hover:bg-slate-800 transition-colors`;

    toast.innerHTML = `
        <div class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full border-2 ${theme.border} ${theme.color} bg-slate-900 shadow-[0_0_10px_currentColor] mr-4 relative z-10">
            <i class="fas ${theme.icon} text-lg"></i>
        </div>
        <div class="flex-1 relative z-10 flex flex-col justify-center">
            <div class="${theme.color} text-xs font-black tracking-[0.15em] uppercase mb-0.5 drop-shadow-md">
                ${displayTitle}
            </div>
            <div class="text-sm font-medium text-slate-300 leading-snug">
                ${message}
            </div>
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

    toast.addEventListener('click', () => {
        removeToast();
    });

    setTimeout(() => {
        removeToast();
    }, duration);
}

function showConfirmToast(message, onConfirm, onCancel) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const theme = {
        color: 'text-cyan-400', border: 'border-cyan-500', bg: 'bg-cyan-500',
        shadow: 'shadow-[0_0_15px_rgba(6,182,212,0.3)]', icon: 'fa-question-circle', defaultTitle: 'CONFIRM'
    };

    toast.className = `quest-toast flex items-center p-4 bg-slate-900/95 backdrop-blur-sm border-l-4 ${theme.border} text-slate-200 ${theme.shadow} w-full`;

    toast.innerHTML = `
        <div class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full border-2 ${theme.border} ${theme.color} bg-slate-900 shadow-[0_0_10px_currentColor] mr-4 relative z-10">
            <i class="fas ${theme.icon} text-lg"></i>
        </div>
        <div class="flex-1 relative z-10 flex flex-col justify-center">
            <div class="${theme.color} text-xs font-black tracking-[0.15em] uppercase mb-0.5 drop-shadow-md">
                ${theme.defaultTitle}
            </div>
            <div class="text-sm font-medium text-slate-300 leading-snug">
                ${message}
            </div>
        </div>
        <div class="flex gap-2 relative z-10 flex-shrink-0">
            <button class="confirm-yes-btn px-3 py-1.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500 rounded font-bold hover:bg-cyan-500/30 transition text-xs tracking-wider">YES</button>
            <button class="confirm-no-btn px-3 py-1.5 bg-slate-700/50 text-slate-400 border border-slate-600 rounded font-bold hover:bg-slate-600/50 transition text-xs tracking-wider">NO</button>
        </div>
    `;

    container.appendChild(toast);

    const yesBtn = toast.querySelector('.confirm-yes-btn');
    const noBtn = toast.querySelector('.confirm-no-btn');

    let isRemoved = false;
    const remove = () => {
        if (isRemoved) return;
        isRemoved = true;
        toast.classList.add('quest-toast-out');
        setTimeout(() => toast.remove(), 400);
    };

    yesBtn.addEventListener('click', () => { clearTimeout(autoRemoveTimer); remove(); if (onConfirm) onConfirm(); });
    noBtn.addEventListener('click', () => { clearTimeout(autoRemoveTimer); remove(); if (onCancel) onCancel(); });

    const autoRemoveTimer = setTimeout(() => {
        remove();
        if (onCancel) onCancel();
    }, 30000);
}

// 任务提醒Toast - 带Focus/Done/Later/OK四个按钮，不自动消失
function showReminderToast(title, message, taskId) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // 从message中提取任务名称（格式可能是"清单名 | 任务名"或纯任务名）
    const taskTitle = message.includes(' | ') ? message.split(' | ').pop() : message;

    const toast = document.createElement('div');
    const theme = {
        color: 'text-amber-400', border: 'border-amber-500', bg: 'bg-amber-500',
        shadow: 'shadow-[0_0_15px_rgba(245,158,11,0.3)]', icon: 'fa-bell'
    };

    toast.className = `quest-toast flex flex-col p-4 bg-slate-900/95 backdrop-blur-sm border-l-4 ${theme.border} text-slate-200 ${theme.shadow} w-full`;

    toast.innerHTML = `
        <div class="flex items-center">
            <div class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full border-2 ${theme.border} ${theme.color} bg-slate-900 shadow-[0_0_10px_currentColor] mr-4 relative z-10">
                <i class="fas ${theme.icon} text-lg"></i>
            </div>
            <div class="flex-1 relative z-10 flex flex-col justify-center">
                <div class="${theme.color} text-xs font-black tracking-[0.15em] uppercase mb-0.5 drop-shadow-md">
                    ${title}
                </div>
                <div class="text-sm font-medium text-slate-300 leading-snug">
                    ${message}
                </div>
            </div>
        </div>
        <div class="flex gap-2 mt-3 relative z-10 justify-end">
            <button class="reminder-focus-btn px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500 rounded font-bold hover:bg-green-500/30 transition text-xs tracking-wider">FOCUS</button>
            <button class="reminder-done-btn px-3 py-1.5 bg-amber-500/20 text-amber-400 border border-amber-500 rounded font-bold hover:bg-amber-500/30 transition text-xs tracking-wider">DONE</button>
            <button class="reminder-later-btn px-3 py-1.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500 rounded font-bold hover:bg-cyan-500/30 transition text-xs tracking-wider">LATER</button>
            <button class="reminder-ok-btn px-3 py-1.5 bg-slate-700/50 text-slate-400 border border-slate-600 rounded font-bold hover:bg-slate-600/50 transition text-xs tracking-wider">OK</button>
        </div>
    `;

    container.appendChild(toast);

    const focusBtn = toast.querySelector('.reminder-focus-btn');
    const doneBtn = toast.querySelector('.reminder-done-btn');
    const laterBtn = toast.querySelector('.reminder-later-btn');
    const okBtn = toast.querySelector('.reminder-ok-btn');

    let isRemoved = false;
    const remove = () => {
        if (isRemoved) return;
        isRemoved = true;
        toast.classList.add('quest-toast-out');
        setTimeout(() => toast.remove(), 400);
    };

    // Focus: 开始/切换番茄专注
    focusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        remove();
        if (taskId && typeof startPomodoroForTask === 'function') {
            startPomodoroForTask(taskId);
        }
    });

    // Done: 标记任务完成
    doneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        remove();
        if (taskId && typeof toggleTaskComplete === 'function') {
            const task = (typeof tasks !== 'undefined') ? tasks.find(t => t.id === taskId) : null;
            if (task && !task.completed) {
                toggleTaskComplete(taskId);
            }
        }
    });

    // Later: 稍后提醒
    laterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        remove();
        if (taskId) {
            const delayMinutes = (typeof settings !== 'undefined' && settings.snoozeDelay) ? settings.snoozeDelay : 15;
            fetch('/api/reminder/snooze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: taskId, delayMinutes: delayMinutes })
            }).catch(err => console.error('Snooze error:', err));
            if (typeof showToast === 'function') {
                const snoozeTask = (typeof tasks !== 'undefined') ? tasks.find(t => t.id === taskId) : null;
                const snoozeMsg = snoozeTask ? buildTaskToastMessage(snoozeTask) : taskTitle;
                showToast(snoozeMsg, 'info', null, delayMinutes + '分钟后再次提醒');
            }
        }
    });

    // OK: 仅关闭
    okBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        remove();
    });

    // 点击Toast非按钮区域：关闭Toast并打开任务详情栏
    toast.addEventListener('click', (e) => {
        // 检查是否点击在按钮上（按钮已通过stopPropagation阻止冒泡，这里做二次保险）
        if (e.target.closest('button')) return;
        remove();
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

        // 打开任务详情栏
        if (typeof openTaskDetailPanel === 'function') {
            // 等待视图切换渲染完成后再打开详情面板
            setTimeout(() => openTaskDetailPanel(taskId), 0);
        }
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

function showInAppNotification(title, body) {
    if (typeof sendBackendNotification === 'function') {
        sendBackendNotification(title, body);
    }
    if (!document.hidden) {
        showToast(body || '', 'info', 8000, title);
        // 页面可见时已直接显示Toast，标记该通知为已展示，避免checkBrowserNotifications重复弹出
        _displayedNotificationKeys.add(title + ':' + body);
    }
}

// 记录已直接展示过的通知，避免checkBrowserNotifications重复弹出
let _displayedNotificationKeys = new Set();

// 页面不可见时缓存的通知，等页面可见时再显示
let _pendingDisplayNotifs = [];

function _displayNotification(n) {
    if (n.taskId) {
        showReminderToast(n.title || 'REMINDER', n.body || '', n.taskId);
    } else {
        showToast(n.body || '', 'info', 8000, n.title);
    }
}

function checkBrowserNotifications() {
    fetch('/api/notifications').then(r => r.json()).then(notifs => {
        if (!notifs || notifs.length === 0) return;
        notifs.forEach(n => {
            const key = (n.title || '') + ':' + (n.body || '');
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
                _displayNotification(n);
            } else {
                // 页面不可见时缓存通知，等页面可见时再显示
                _pendingDisplayNotifs.push(n);
            }
        });
    }).catch(err => {
        console.error('Check notifications error:', err);
    });
}

// 页面变为可见时，显示缓存的通知
function flushPendingNotifications() {
    const notifs = _pendingDisplayNotifs.slice();
    _pendingDisplayNotifs = [];
    notifs.forEach(n => {
        const key = (n.title || '') + ':' + (n.body || '');
        if (_displayedNotificationKeys.has(key)) {
            _displayedNotificationKeys.delete(key);
            return;
        }
        _displayNotification(n);
    });
}

let bgImageBrightness = 0.5;
function analyzeBgImageBrightness() {
    if (!settings.bgImage) {
        bgImageBrightness = 0.5;
        updateBgTextAdaptation();
        return;
    }
    const img = new Image();
    if (!settings.bgImage.startsWith('data:')) {
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
    img.src = settings.bgImage;
}

function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function shouldUseLightText() {
    if (isDarkMode()) return true;
    if (settings.bgImage && bgImageBrightness < 0.45) return true;
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

// 获取任务的四象限颜色类
function getQuadrantColorClass(task) {
    const isDark = isDarkMode();
    const hasBg = !!settings.bgImage;
    // 优先级底色开关：开启时按优先级使用不同底色；关闭时所有任务使用与「不紧急不重要」一致的底色（border/dot 仍区分优先级）
    const usePriority = settings && settings.priorityTaskBg !== false;
    const neutralBg = hasBg ? 'bg-slate-300/25' : (isDark ? 'bg-gray-700/30' : 'bg-gray-50');
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
        if (hasBg) return { bg: 'bg-slate-300/25', border: 'border-l-slate-400', dot: 'bg-slate-400', light: '#f3f4f6' };
        return isDark
            ? { bg: 'bg-gray-700/30', border: 'border-l-gray-400', dot: 'bg-gray-400', light: '#374151' }
            : { bg: 'bg-gray-50', border: 'border-l-gray-400', dot: 'bg-gray-400', light: '#f3f4f6' };
    }
}

// 工具函数
function filterTasks(taskList) {
    let filtered = taskList;
    
    if (currentListId) {
        filtered = filtered.filter(t => t.listId === currentListId);
    }
    
    if (currentFilter === 'recent7days') {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStartTimestamp = todayStart.getTime();
        const day7End = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(task => {
            if (!task.startTime) return false;
            const taskDate = new Date(task.startTime);
            return taskDate.getTime() >= todayStartTimestamp && taskDate.getTime() < day7End.getTime();
        });
    }
    
    // 标签筛选（并集：任务的tagIds与currentTagIds有交集即通过）
    if (currentTagIds && currentTagIds.length > 0) {
        filtered = filtered.filter(task => {
            const taskTags = task.tags || task.tagIds || [];
            return taskTags.some(tagId => currentTagIds.includes(tagId));
        });
    }
    
    // 自定义过滤器筛选
    if (currentFilterId) {
        const customFilter = (settings.filters || []).find(f => f.id === currentFilterId);
        if (customFilter && customFilter.conditions) {
            const c = customFilter.conditions;
            
            // 清单筛选
            if (c.listIds && c.listIds.length > 0) {
                filtered = filtered.filter(t => c.listIds.includes(t.listId));
            }
            
            // 标签筛选（交集）
            if (c.tagIds && c.tagIds.length > 0) {
                filtered = filtered.filter(task => {
                    const taskTags = task.tags || [];
                    return taskTags.some(tagId => c.tagIds.includes(tagId));
                });
            }
            
            // 重要筛选
            if (c.important === true) {
                filtered = filtered.filter(t => t.important);
            } else if (c.important === false) {
                filtered = filtered.filter(t => !t.important);
            }
            
            // 紧急筛选
            if (c.urgent === true) {
                filtered = filtered.filter(t => t.urgent);
            } else if (c.urgent === false) {
                filtered = filtered.filter(t => !t.urgent);
            }
            
            // 时间范围筛选
            if (c.timeRange) {
                const now = new Date();
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const todayEnd = new Date(todayStart.getTime() + 86400000);
                const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
                
                switch (c.timeRange) {
                    case 'today':
                        filtered = filtered.filter(t => t.startTime && new Date(t.startTime) >= todayStart && new Date(t.startTime) < todayEnd);
                        break;
                    case 'yesterday':
                        const yesterdayStart = new Date(todayStart.getTime() - 86400000);
                        filtered = filtered.filter(t => t.startTime && new Date(t.startTime) >= yesterdayStart && new Date(t.startTime) < todayStart);
                        break;
                    case 'last3days':
                        const last3Start = new Date(todayStart.getTime() - 2 * 86400000);
                        filtered = filtered.filter(t => t.startTime && new Date(t.startTime) >= last3Start && new Date(t.startTime) < todayEnd);
                        break;
                    case 'week':
                        const weekStart = new Date(todayStart);
                        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
                        if (weekStart.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
                        const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
                        filtered = filtered.filter(t => t.startTime && new Date(t.startTime) >= weekStart && new Date(t.startTime) < weekEnd);
                        break;
                    case 'lastweek':
                        const lastWeekStart = new Date(todayStart);
                        lastWeekStart.setDate(lastWeekStart.getDate() - lastWeekStart.getDay() + dayOffset - 7);
                        if (lastWeekStart.getDay() === 0 && dayOffset === 1) lastWeekStart.setDate(lastWeekStart.getDate() - 7);
                        const lastWeekEnd = new Date(lastWeekStart.getTime() + 7 * 86400000);
                        filtered = filtered.filter(t => t.startTime && new Date(t.startTime) >= lastWeekStart && new Date(t.startTime) < lastWeekEnd);
                        break;
                    case 'month':
                        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                        filtered = filtered.filter(t => t.startTime && new Date(t.startTime) >= monthStart && new Date(t.startTime) < monthEnd);
                        break;
                    case 'lastmonth':
                        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
                        filtered = filtered.filter(t => t.startTime && new Date(t.startTime) >= lastMonthStart && new Date(t.startTime) < lastMonthEnd);
                        break;
                    case 'overdue':
                        filtered = filtered.filter(t => t.startTime && !t.completed && new Date(t.startTime) < todayStart);
                        break;
                    case 'nodate':
                        filtered = filtered.filter(t => !t.startTime);
                        break;
                    case 'custom':
                        if (c.customStartDate && c.customEndDate) {
                            const customStart = new Date(c.customStartDate);
                            const customEnd = new Date(c.customEndDate);
                            customEnd.setHours(23, 59, 59, 999);
                            filtered = filtered.filter(t => t.startTime && new Date(t.startTime) >= customStart && new Date(t.startTime) <= customEnd);
                        }
                        break;
                }
            }
        }
    }
    
    // 过滤已归档清单的任务
    const archivedListIds = lists.filter(l => l.archived).map(l => l.id);
    if (archivedListIds.length > 0) {
        filtered = filtered.filter(t => !archivedListIds.includes(t.listId));
    }

    if (!settings.showCompleted && settings.showCompleted !== undefined) {
        filtered = filtered.filter(t => !t.completed);
    }
    
    return filtered;
}

// 生成标签胶囊HTML（用于各视图中的任务项）
// maxDisplay: 最多显示几个标签胶囊，超出显示+N
// position: 'left' 或 'right'，决定胶囊在任务标题的哪一侧
function renderTagCapsules(task, maxDisplay = 2, position = 'left') {
    const taskTags = task.tags || [];
    if (taskTags.length === 0) return '';
    
    const allTags = settings.tags || [];
    const displayTags = taskTags.slice(0, maxDisplay);
    const remaining = taskTags.length - maxDisplay;
    
    const capsules = displayTags.map(tagId => {
        const tag = allTags.find(t => t.id === tagId);
        if (!tag) return '';
        const displayName = tag.name.length > 8 ? tag.name.substring(0, 8) + '…' : tag.name;
        return `<span class="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] leading-tight" style="background-color: ${tag.color}33; color: ${tag.color}">${displayName}</span>`;
    }).filter(Boolean).join('');
    
    const moreHtml = remaining > 0 ? `<span class="text-[10px] text-theme-muted cursor-pointer hover:text-theme-primary transition" onclick="event.stopPropagation(); expandTagCapsules(this, '${task.id}')" title="点击展开全部标签">+${remaining}</span>` : '';
    
    // 隐藏的完整标签列表
    const allCapsules = taskTags.map(tagId => {
        const tag = allTags.find(t => t.id === tagId);
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
    return [...incomplete, ...completed];
}

function getTasksForDate(date) {
    const dateTasks = filterTasks(tasks).filter(t => {
        return isTaskVisibleOnDate(t, date);
    });
    return sortTasksByCompletion(dateTasks);
}

function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

function formatDate(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function formatDateTime(date) {
    const d = new Date(date);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatTime(date) {
    const d = new Date(date);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// 格式化任务时间用于toast显示（如"2026年1月1日 13:00~15:00"），无startTime返回空串
function formatTaskTimeForToast(task) {
    if (!task.startTime) return '';
    const start = new Date(task.startTime);
    const dateStr = `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日`;
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

// 计算任务在第二象限（重要不紧急）的停留天数
function getQuadrantStagnationDays(task) {
    if (!task.important || task.urgent || task.completed) return 0;
    // 使用 createdAt 或 startTime 作为起始时间
    const startDate = task.startTime ? new Date(task.startTime) : (task.createdAt ? new Date(task.createdAt) : null);
    if (!startDate) return 0;
    const now = new Date();
    const diffMs = now.getTime() - startDate.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
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
function _isFontAvailable(fontName) {
    if (!fontName || typeof fontName !== 'string') return false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
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
//   - 内置/自定义：{ light: {...}, dark: {...} }，根据当前主题自动选择变体
//   - 背景图提取：{ vibrant: {...}, muted: {...}, dark: {...} }，扁平结构，固定配色

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
            bgPrimary: '#f0fdf9', bgPrimaryRgb: '240,253,249',
            bgSecondary: '#ffffff', bgSecondaryRgb: '255,255,255',
            bgTertiary: '#dcfce7', bgTertiaryRgb: '220,252,231',
            textPrimary: '#06341e', textSecondary: '#4b5563', textMuted: '#6b7280',
            border: '#bbf7d0'
        },
        dark: {
            accent: '#10B981', accentHover: '#059669',
            accentSecondary: '#34D399', accentBg: 'rgba(16,185,129,0.15)', accentBgStrong: 'rgba(16,185,129,0.25)',
            accentTextDark: '#6ee7b7', accentLight: '#6ee7b7',
            bgPrimary: '#0f1a17', bgPrimaryRgb: '15,26,23',
            bgSecondary: '#182722', bgSecondaryRgb: '24,39,34',
            bgTertiary: '#23322c', bgTertiaryRgb: '35,50,44',
            textPrimary: '#ecfdf5', textSecondary: '#a7f3d0', textMuted: '#6ee7b7',
            border: '#23322c'
        }
    },
    rose: {
        light: {
            accent: '#F43F5E', accentHover: '#e11d48',
            accentSecondary: '#FB7185', accentBg: '#fff1f2', accentBgStrong: '#ffe4e6',
            accentTextDark: '#e11d48', accentLight: '#FB7185',
            bgPrimary: '#fef7f8', bgPrimaryRgb: '254,247,248',
            bgSecondary: '#ffffff', bgSecondaryRgb: '255,255,255',
            bgTertiary: '#ffe4e6', bgTertiaryRgb: '255,228,230',
            textPrimary: '#4c0519', textSecondary: '#6b7280', textMuted: '#78716c',
            border: '#fecdd3'
        },
        dark: {
            accent: '#F43F5E', accentHover: '#e11d48',
            accentSecondary: '#FB7185', accentBg: 'rgba(244,63,94,0.15)', accentBgStrong: 'rgba(244,63,94,0.25)',
            accentTextDark: '#fda4af', accentLight: '#fda4af',
            bgPrimary: '#1a1014', bgPrimaryRgb: '26,16,20',
            bgSecondary: '#241319', bgSecondaryRgb: '36,19,25',
            bgTertiary: '#331c24', bgTertiaryRgb: '51,28,36',
            textPrimary: '#fef2f5', textSecondary: '#fda4af', textMuted: '#f87171',
            border: '#331c24'
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
        const [h, s] = _rgbToHsl(r, g, b);

        // Light 变体：浅色背景 + 高饱和强调色
        const lAccent = _hslToRgb(h, Math.min(1, s + 0.15), 0.5);
        const lAccentHover = _hslToRgb(h, Math.min(1, s + 0.15), 0.42);
        const lAccentSecondary = _hslToRgb(h, Math.min(1, s + 0.15), 0.6);
        const lAccentBg = _hslToRgb(h, 0.3, 0.95);
        const lAccentBgStrong = _hslToRgb(h, 0.4, 0.9);
        const lAccentTextDark = _hslToRgb(h, Math.min(1, s + 0.1), 0.35);
        const lAccentLight = _hslToRgb(h, Math.min(1, s + 0.1), 0.6);
        const lBgPrimary = _hslToRgb(h, 0.15, 0.97);
        const lBgSecondary = _hslToRgb(h, 0.08, 1.0);
        const lBgTertiary = _hslToRgb(h, 0.18, 0.93);
        const lTextPrimary = _ensureContrast([h, 0.2, 0.12], lBgPrimary, 4.5);
        const lTextSecondary = _ensureContrast([h, 0.1, 0.4], lBgPrimary, 3.0);
        const lTextMuted = _ensureContrast([h, 0.08, 0.5], lBgPrimary, 3.0);
        const lBorder = _hslToRgb(h, 0.15, 0.88);

        // Dark 变体：深色背景 + 明亮强调色
        const dAccent = _hslToRgb(h, Math.min(1, s + 0.1), 0.62);
        const dAccentHover = _hslToRgb(h, Math.min(1, s + 0.1), 0.72);
        const dAccentSecondary = _hslToRgb(h, Math.min(1, s + 0.1), 0.7);
        const dAccentBgRgb = _hslToRgb(h, Math.min(1, s + 0.1), 0.3);
        const dAccentBgStrongRgb = _hslToRgb(h, Math.min(1, s + 0.1), 0.35);
        const dAccentTextDark = _hslToRgb(h, Math.min(1, s + 0.05), 0.75);
        const dAccentLight = _hslToRgb(h, Math.min(1, s + 0.05), 0.7);
        const dBgPrimary = _hslToRgb(h, 0.15, 0.1);
        const dBgSecondary = _hslToRgb(h, 0.18, 0.15);
        const dBgTertiary = _hslToRgb(h, 0.15, 0.22);
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
// 支持的 key：none / builtin:blue / builtin:green / builtin:rose / custom:<hex> / vibrant / muted / dark
function resolvePaletteObject(name) {
    if (!name || name === 'none') return null;
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

// ==================== 背景图主题色提取（从背景图生成 3 套调色板） ====================
// 三种风格：vibrant（鲜艳）/ muted（柔和）/ dark（深色）
// 每套包含：accent（强调色）、bgPrimary/bgSecondary/bgTertiary（背景）、textPrimary/textSecondary/textMuted（文字）、border（边框）

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

// 根据主色调生成 3 套调色板
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

    // 生成 3 套调色板
    const palettes = {};

    // 1. Vibrant 鲜艳风格：高饱和、明亮强调色 + 浅色背景
    const vAccent = _hslToRgb(hue, Math.min(1, s + 0.2), 0.5);
    const vAccentHover = _hslToRgb(hue, Math.min(1, s + 0.2), 0.42);
    const vBgPrimary = _hslToRgb(hue, 0.15, 0.97);
    const vBgSecondary = _hslToRgb(hue, 0.1, 1.0);
    const vBgTertiary = _hslToRgb(hue, 0.18, 0.94);
    // 文字色经 WCAG 对比度验证（正文 4.5:1，次要 3.0:1）
    const vTextPrimary = _ensureContrast([hue, 0.2, 0.12], vBgPrimary, 4.5);
    const vTextSecondary = _ensureContrast([hue, 0.1, 0.4], vBgPrimary, 3.0);
    const vTextMuted = _ensureContrast([hue, 0.08, 0.5], vBgPrimary, 3.0);
    const vBorder = _hslToRgb(hue, 0.15, 0.88);
    palettes.vibrant = {
        accent: _rgbToHex(...vAccent),
        accentHover: _rgbToHex(...vAccentHover),
        bgPrimary: _rgbToHex(...vBgPrimary),
        bgPrimaryRgb: _rgbToRgbStr(...vBgPrimary),
        bgSecondary: _rgbToHex(...vBgSecondary),
        bgSecondaryRgb: _rgbToRgbStr(...vBgSecondary),
        bgTertiary: _rgbToHex(...vBgTertiary),
        bgTertiaryRgb: _rgbToRgbStr(...vBgTertiary),
        textPrimary: _rgbToHex(...vTextPrimary),
        textSecondary: _rgbToHex(...vTextSecondary),
        textMuted: _rgbToHex(...vTextMuted),
        border: _rgbToHex(...vBorder)
    };

    // 2. Muted 柔和风格：低饱和、温和色调
    const mAccent = _hslToRgb(hue, Math.max(0.3, s * 0.7), 0.5);
    const mAccentHover = _hslToRgb(hue, Math.max(0.3, s * 0.7), 0.42);
    const mBgPrimary = _hslToRgb(hue, 0.08, 0.96);
    const mBgSecondary = _hslToRgb(hue, 0.05, 0.99);
    const mBgTertiary = _hslToRgb(hue, 0.1, 0.93);
    const mTextPrimary = _ensureContrast([hue, 0.1, 0.18], mBgPrimary, 4.5);
    const mTextSecondary = _ensureContrast([hue, 0.06, 0.42], mBgPrimary, 3.0);
    const mTextMuted = _ensureContrast([hue, 0.05, 0.5], mBgPrimary, 3.0);
    const mBorder = _hslToRgb(hue, 0.08, 0.87);
    palettes.muted = {
        accent: _rgbToHex(...mAccent),
        accentHover: _rgbToHex(...mAccentHover),
        bgPrimary: _rgbToHex(...mBgPrimary),
        bgPrimaryRgb: _rgbToRgbStr(...mBgPrimary),
        bgSecondary: _rgbToHex(...mBgSecondary),
        bgSecondaryRgb: _rgbToRgbStr(...mBgSecondary),
        bgTertiary: _rgbToHex(...mBgTertiary),
        bgTertiaryRgb: _rgbToRgbStr(...mBgTertiary),
        textPrimary: _rgbToHex(...mTextPrimary),
        textSecondary: _rgbToHex(...mTextSecondary),
        textMuted: _rgbToHex(...mTextMuted),
        border: _rgbToHex(...mBorder)
    };

    // 3. Dark 深色风格：深色背景 + 高对比强调色
    const dAccent = _hslToRgb(hue, Math.min(1, s + 0.15), 0.62);
    const dAccentHover = _hslToRgb(hue, Math.min(1, s + 0.15), 0.52);
    const dBgPrimary = _hslToRgb(hue, 0.15, 0.1);
    const dBgSecondary = _hslToRgb(hue, 0.18, 0.15);
    const dBgTertiary = _hslToRgb(hue, 0.15, 0.22);
    const dTextPrimary = _ensureContrast([hue, 0.1, 0.95], dBgPrimary, 4.5);
    const dTextSecondary = _ensureContrast([hue, 0.08, 0.75], dBgPrimary, 3.0);
    const dTextMuted = _ensureContrast([hue, 0.06, 0.55], dBgPrimary, 3.0);
    const dBorder = _hslToRgb(hue, 0.12, 0.28);
    palettes.dark = {
        accent: _rgbToHex(...dAccent),
        accentHover: _rgbToHex(...dAccentHover),
        bgPrimary: _rgbToHex(...dBgPrimary),
        bgPrimaryRgb: _rgbToRgbStr(...dBgPrimary),
        bgSecondary: _rgbToHex(...dBgSecondary),
        bgSecondaryRgb: _rgbToRgbStr(...dBgSecondary),
        bgTertiary: _rgbToHex(...dBgTertiary),
        bgTertiaryRgb: _rgbToRgbStr(...dBgTertiary),
        textPrimary: _rgbToHex(...dTextPrimary),
        textSecondary: _rgbToHex(...dTextSecondary),
        textMuted: _rgbToHex(...dTextMuted),
        border: _rgbToHex(...dBorder)
    };

    return palettes;
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
        applyPaletteToCssVars(palette);
    } else {
        clearThemePaletteVars();
    }
}

// 直接应用某套调色板对象到 CSS 变量（不依赖 settings，用于按住预览）
// 支持 {light, dark} 双变体（自动根据当前主题选择）和扁平结构
function applyPaletteToCssVars(palette) {
    if (!palette) return;
    // 内置/自定义调色板含 light/dark 双变体，根据当前主题选择
    if (palette.light && palette.dark) {
        palette = isDarkThemeActive() ? palette.dark : palette.light;
    }
    const root = document.documentElement;
    root.style.setProperty('--accent-color', palette.accent);
    root.style.setProperty('--accent-hover', palette.accentHover);
    // 色阶变量（仅当调色板提供时设置，背景图提取的扁平结构可能没有）
    if (palette.accentSecondary) root.style.setProperty('--accent-secondary', palette.accentSecondary);
    if (palette.accentBg) root.style.setProperty('--accent-bg', palette.accentBg);
    if (palette.accentBgStrong) root.style.setProperty('--accent-bg-strong', palette.accentBgStrong);
    if (palette.accentTextDark) root.style.setProperty('--accent-text-dark', palette.accentTextDark);
    if (palette.accentLight) root.style.setProperty('--accent-light', palette.accentLight);
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
}

// 清除动态主题色覆盖（恢复默认）
function clearThemePaletteVars() {
    const root = document.documentElement;
    const keys = ['--accent-color', '--accent-hover', '--accent-secondary',
        '--accent-bg', '--accent-bg-strong', '--accent-text-dark', '--accent-light',
        '--bg-primary', '--bg-primary-rgb',
        '--bg-secondary', '--bg-secondary-rgb', '--bg-tertiary', '--bg-tertiary-rgb',
        '--text-primary', '--text-secondary', '--text-muted', '--border-color'];
    keys.forEach(k => root.style.removeProperty(k));
}
