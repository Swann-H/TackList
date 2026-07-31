async function init() {
    await loadData();
    easterEgg_init();
    applyTheme();
    applyBackgroundImage();
    renderLists();
    renderTags();
    renderFilters();
    renderView();
    updateViewButtons();
    updateSidebarHighlight();
    initFormHandlers();
    initTaskTitleHandler();
    setupDetailPanelCloseHandler();
    setupDetailPickerCloseHandler();
    initScrollbarHandler();

    performAutoBackup();

    await loadHolidayData();
    checkHolidayDataUpdate();
    updateHolidayCountdown();
    applyDisplaySettings();
    await registerUploadedFontOnLoad();
    applyFontFamily();
    applyThemePalette(settings.themePalette || 'none');
    syncPomodoroFromServer();
    startDataRefreshTimer();
    requestNotificationPermission();
    detectPlatform();
    setInterval(checkBrowserNotifications, 5000);

    // 网页模式处理：离线版入口检测是否需要跳转到在线版
    initWebMode();

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshDataFromServer();
            syncPomodoroFromServer();
            checkBrowserNotifications();
            flushPendingNotifications();
        }
    });
}

function openSettingsModal() {
    document.getElementById('settings-default-list').value = settings.defaultListId || 'default';
    document.getElementById('settings-default-important').checked = settings.defaultImportant || false;
    document.getElementById('settings-default-urgent').checked = settings.defaultUrgent || false;
    document.getElementById('settings-default-duration').value = settings.defaultDuration !== undefined ? settings.defaultDuration : 30;
    document.getElementById('settings-default-view').value = settings.defaultView || 'task';
    document.getElementById('settings-week-start').value = settings.weekStart || 'monday';
    document.getElementById('settings-show-completed').checked = settings.showCompleted !== false;
    document.getElementById('settings-show-lunar').checked = settings.showLunar !== false;
    document.getElementById('settings-show-holiday-countdown').checked = settings.showHolidayCountdown !== false;
    document.getElementById('settings-show-sidebar-extras').checked = settings.showSidebarExtras !== false;
    document.getElementById('settings-easter-egg').checked = settings.easterEggEnabled !== false;
    document.getElementById('settings-cmd-remove-time').checked = settings.cmdRemoveTimeText !== false;
    document.getElementById('settings-priority-task-bg').checked = settings.priorityTaskBg !== false;
    document.getElementById('settings-show-focus-button').checked = settings.showFocusButton !== false;
    document.getElementById('settings-cmd-default-date').value = settings.cmdDefaultDate || 'none';
    document.getElementById('settings-focus-duration').value = settings.focusDuration || 25;
    document.getElementById('settings-short-break-duration').value = settings.shortBreakDuration || 5;
    document.getElementById('settings-long-break-duration').value = settings.longBreakDuration || 15;
    document.getElementById('settings-long-break-interval').value = settings.longBreakInterval || 4;
    document.getElementById('settings-auto-break').checked = settings.autoBreak || false;
    document.getElementById('settings-auto-focus').checked = settings.autoFocus || false;
    document.getElementById('settings-bg-flow-effect').checked = settings.bgFlowEffect === true;
    document.getElementById('settings-advanced-particle').checked = settings.advancedParticleAnimation !== false;
    document.getElementById('settings-auto-create').checked = settings.autoCreateTask !== false;
    document.getElementById('settings-toast-duration').value = settings.toastDuration || 5;
    document.getElementById('settings-snooze-delay').value = settings.snoozeDelay || 15;
    document.getElementById('settings-refresh-interval').value = settings.refreshInterval || 30;
    updateNotificationPermButton();
    document.getElementById('settings-bg-opacity').value = settings.bgOpacity || 100;
    document.getElementById('bg-opacity-value').textContent = settings.bgOpacity || 100;
    document.getElementById('settings-bg-blur').value = settings.bgBlur ?? 10;
    document.getElementById('bg-blur-value').textContent = settings.bgBlur ?? 10;
    
    // 初始化备份设置
    document.getElementById('backup-enabled').checked = settings.backupEnabled || false;
    document.getElementById('backup-interval').value = settings.backupInterval || 7;
    document.getElementById('retention-period').value = settings.retentionPeriod || 30;

    // 初始化网络配置
    document.getElementById('settings-bind-address').value = settings.bindAddress || '127.0.0.1';
    _originalBindAddress = settings.bindAddress || '127.0.0.1';
    document.getElementById('settings-port').value = settings.port || 14438;
    _originalPort = settings.port || 14438;
    document.getElementById('settings-web-mode').value = settings.webMode || 'offline';
    onPortChange();
    loadNetworkInfo();

    // 初始化字体选择器（异步检测系统字体）
    initFontFamilySelector();

    // 初始化动态主题色预览
    initThemePalettePreview();

    // 初始化节假日抓取设置
    const holidayYearInput = document.getElementById('settings-holiday-fetch-year');
    if (holidayYearInput) holidayYearInput.value = new Date().getFullYear();
    const holidayApiInput = document.getElementById('settings-holiday-api-url');
    if (holidayApiInput) holidayApiInput.value = settings.holidayApiUrl || '';

    // 初始化开机自启状态
    loadAutoStartStatus();

    // 更新背景图片预览
    const previewContainer = document.getElementById('bg-image-preview');
    const previewImg = document.getElementById('bg-preview-img');
    if (settings.bgImage) {
        previewImg.src = settings.bgImage;
        previewContainer.classList.remove('hidden');
    } else {
        previewContainer.classList.add('hidden');
    }
    
    updateSettingsListSelect();
    updateThemeButtons();
    
    // 初始化快捷键设置
    if (typeof renderShortcutsSettings === 'function') {
        renderShortcutsSettings();
    }

    document.getElementById('settings-modal').classList.remove('hidden');
    document.getElementById('settings-modal').classList.add('flex');

    // 初始化左侧快速导航（仅首次）+ 重置高亮与滚动位置
    if (!_settingsNavObserver) {
        setTimeout(initSettingsNav, 50);
    } else {
        _resetSettingsNavState();
    }
}

function closeSettingsModal() {
    // 取消快捷键录入状态
    if (typeof _recordingShortcut !== 'undefined') {
        _recordingShortcut = null;
    }
    document.getElementById('settings-modal').classList.add('hidden');
    document.getElementById('settings-modal').classList.remove('flex');
}

// ==================== 设置面板左侧快速导航 ====================
let _settingsNavObserver = null;
let _settingsNavClickLock = false; // 点击跳转期间暂停滚动联动，避免高亮抖动

function initSettingsNav() {
    const nav = document.getElementById('settings-nav');
    const scrollEl = document.getElementById('settings-content-scroll');
    if (!nav || !scrollEl) return;

    // 点击跳转
    nav.querySelectorAll('.settings-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.dataset.target;
            const target = document.getElementById(targetId);
            if (!target) return;
            _settingsNavClickLock = true;
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // 立即高亮，并锁定一段时间防止滚动事件覆盖
            nav.querySelectorAll('.settings-nav-item').forEach(n => n.classList.remove('settings-nav-active'));
            item.classList.add('settings-nav-active');
            setTimeout(() => { _settingsNavClickLock = false; }, 700);
        });
    });

    // 滚动联动高亮：IntersectionObserver 监听各 section 可见性
    const sections = [...nav.querySelectorAll('.settings-nav-item')]
        .map(n => document.getElementById(n.dataset.target))
        .filter(Boolean);
    if (sections.length === 0) return;

    _settingsNavObserver = new IntersectionObserver((entries) => {
        if (_settingsNavClickLock) return;
        // 找到当前最靠近顶部的可见 section
        let best = null;
        let bestTop = Infinity;
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const top = entry.boundingClientRect.top;
                if (top < bestTop) {
                    bestTop = top;
                    best = entry.target;
                }
            }
        });
        if (best) {
            const id = best.id;
            nav.querySelectorAll('.settings-nav-item').forEach(n => {
                n.classList.toggle('settings-nav-active', n.dataset.target === id);
            });
        }
    }, {
        root: scrollEl,
        rootMargin: '0px 0px -70% 0px', // 顶部进入视口即算活跃
        threshold: 0
    });
    sections.forEach(s => _settingsNavObserver.observe(s));
}

function _resetSettingsNavState() {
    const nav = document.getElementById('settings-nav');
    const scrollEl = document.getElementById('settings-content-scroll');
    if (!nav) return;
    // 高亮第一项
    const firstItem = nav.querySelector('.settings-nav-item');
    if (firstItem) {
        nav.querySelectorAll('.settings-nav-item').forEach(n => n.classList.remove('settings-nav-active'));
        firstItem.classList.add('settings-nav-active');
    }
    // 滚动到顶部
    if (scrollEl) scrollEl.scrollTop = 0;
}

let _resetConfirming = false;

function resetAllData() {
    if (_resetConfirming) {
        // 第二次点击：执行重置
        _resetConfirming = false;

        // 先检查是否有今天的备份
        fetch('/api/backups').then(r => r.json()).then(data => {
            const today = new Date().toISOString().split('T')[0];
            const hasTodayBackup = data.backups && data.backups.some(b => b.filename && b.filename.includes(today));

            if (!hasTodayBackup) {
                // 没有今天的备份，询问用户是否先备份
                showConfirmToast('今日尚无数据备份，是否先备份再重置？', () => {
                    // 用户选择先备份
                    fetch('/api/backup', { method: 'POST' })
                        .then(r => r.json().catch(() => ({ success: false })))
                        .then(result => {
                            if (result.success) {
                                showToast('备份完成，正在重置数据...', 'success');
                            } else {
                                showToast('备份失败：' + (result.error || '未知错误') + '，直接重置数据', 'warning');
                            }
                            doResetData();
                        }).catch(err => {
                            showToast('备份失败：' + (err.message || '网络错误') + '，直接重置数据', 'warning');
                            doResetData();
                        });
                }, () => {
                    // 用户选择不备份，直接重置
                    doResetData();
                });
            } else {
                doResetData();
            }
        }).catch(() => {
            doResetData();
        });

        // 恢复按钮状态
        const btn = document.getElementById('reset-data-btn');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>重置数据';
            btn.style.cssText = '';
        }
        return;
    }

    // 第一次点击：进入确认状态
    _resetConfirming = true;
    const btn = document.getElementById('reset-data-btn');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>确认重置数据';
        btn.style.backgroundColor = '#dc2626';
        btn.style.color = '#fff';
        btn.style.borderColor = '#dc2626';
    }

    setTimeout(() => {
        _resetConfirming = false;
        if (btn) {
            btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>重置数据';
            btn.style.cssText = '';
        }
    }, 3000);
}

function doResetData() {
    tasks = [];
    lists = [{ id: 'default', name: '默认', color: '#6366f1' }];
    pomodoroHistory = [];
    settings = Object.assign({}, DEFAULT_SETTINGS);
    quadrantOrder = ['urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important'];
    saveDataImmediate();
    // 清除 IndexedDB 缓存
    if (typeof cacheToIndexedDB === 'function') {
        cacheToIndexedDB({ tasks: [], lists: [{ id: 'default', name: '默认', color: '#6366f1' }], settings: {}, pomodoroHistory: [] });
    }
    // 停止番茄计时器并重置到初始状态
    if (pomodoroState.timerId) {
        clearInterval(pomodoroState.timerId);
        pomodoroState.timerId = null;
    }
    stopFlowAnimation();
    pomodoroState.state = 'idle';
    pomodoroState.phase = 'focus';
    pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
    pomodoroState.totalDuration = pomodoroState.focusDuration * 60;
    pomodoroState.currentTaskId = null;
    pomodoroState.startedAt = null;
    pomodoroState.originalStartedAt = null;
    pomodoroState.taskName = '';
    pomodoroState.continuousTomatoCount = 0;
    pomodoroState.completedPomodoros = 0;
    _pomodoroPaused = false;
    _pomodoroCompletionHandled = false;
    _pomodoroPhaseTransition = false;
    // 通知服务端重置番茄状态为idle
    fetch('/api/pomodoro/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});
    updateSidebarPomodoroTimer();
    updatePomodoroDisplay();
    updateMainViewBackground();
    clearMainContentBackground();
    renderLists();
    renderTags();
    renderFilters();
    renderView();
    closeSettingsModal();
    showToast('所有数据已重置', 'success');
    // 自动刷新页面，清除背景图片等残留样式
    setTimeout(() => { location.reload(); }, 500);
}

function shutdownServer() {
    const btn = document.getElementById('shutdown-btn');
    if (btn.dataset.confirming === 'true') {
        // 第二次点击：执行关闭
        fetch('/api/shutdown', { method: 'POST' }).then(() => {
            showToast('服务已关闭，可关闭此页面', 'info', 10000);
            document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#666"><div style="text-align:center"><h2>服务已关闭</h2><p>您可以关闭此页面</p></div></div>';
        }).catch(err => {
            showToast('关闭服务失败: ' + err.message, 'error');
        });
        return;
    }
    // 第一次点击：显示确认
    btn.dataset.confirming = 'true';
    btn.innerHTML = '<i class="fas fa-power-off mr-1"></i>确认结束服务';
    btn.style.backgroundColor = '#dc2626';
    btn.style.color = '#fff';
    btn.style.borderColor = '#dc2626';
    setTimeout(() => {
        btn.dataset.confirming = 'false';
        btn.innerHTML = '<i class="fas fa-power-off mr-1"></i>结束服务';
        btn.style.cssText = '';
    }, 3000);
}

function restartServer() {
    const btn = document.getElementById('restart-btn');
    if (btn.dataset.confirming === 'true') {
        executeRestart();
        return;
    }
    // 第一次点击：显示确认
    btn.dataset.confirming = 'true';
    btn.innerHTML = '<i class="fas fa-redo mr-1"></i>确认重启服务';
    btn.style.backgroundColor = '#d97706';
    btn.style.color = '#fff';
    btn.style.borderColor = '#d97706';
    setTimeout(() => {
        btn.dataset.confirming = 'false';
        btn.innerHTML = '<i class="fas fa-redo mr-1"></i>重启服务';
        btn.style.cssText = '';
    }, 3000);
}

// 执行服务重启：保存未保存的网络配置，发起重启并重连
function executeRestart() {
    const bindAddress = document.getElementById('settings-bind-address').value;
    const port = parseInt(document.getElementById('settings-port').value) || 14438;
    const networkChanged = (bindAddress !== _originalBindAddress || port !== _originalPort);

    if (networkChanged) {
        // 网络配置有变更，自动保存设置后再重启
        saveSettings(true); // silent=true，不弹Toast
    }

    fetch('/api/restart', { method: 'POST' }).then(() => {
        showToast('服务正在重启，请稍候...', 'info', 10000);
        setTimeout(() => {
            let retries = 0;
            const tryReconnect = () => {
                fetch('/api/data').then(r => {
                    if (r.ok) {
                        location.reload();
                    } else {
                        throw new Error('not ready');
                    }
                }).catch(() => {
                    retries++;
                    if (retries < 20) {
                        setTimeout(tryReconnect, 1000);
                    } else {
                        showToast('重启超时，请手动刷新页面', 'error', 10000);
                    }
                });
            };
            setTimeout(tryReconnect, 2000);
        }, 1000);
    }).catch(err => {
        showToast('重启服务失败: ' + err.message, 'error');
    });
}

function saveSettings(silent) {
    settings.defaultListId = document.getElementById('settings-default-list').value;
    settings.defaultImportant = document.getElementById('settings-default-important').checked;
    settings.defaultUrgent = document.getElementById('settings-default-urgent').checked;
    settings.defaultDuration = parseInt(document.getElementById('settings-default-duration').value) || 30;
    settings.defaultView = document.getElementById('settings-default-view').value;
    settings.weekStart = document.getElementById('settings-week-start').value;
    settings.showCompleted = document.getElementById('settings-show-completed').checked;
    settings.showLunar = document.getElementById('settings-show-lunar').checked;
    settings.showHolidayCountdown = document.getElementById('settings-show-holiday-countdown').checked;
    settings.showSidebarExtras = document.getElementById('settings-show-sidebar-extras').checked;
    settings.easterEggEnabled = document.getElementById('settings-easter-egg').checked;
    settings.cmdRemoveTimeText = document.getElementById('settings-cmd-remove-time').checked;
    settings.priorityTaskBg = document.getElementById('settings-priority-task-bg').checked;
    settings.showFocusButton = document.getElementById('settings-show-focus-button').checked;
    settings.cmdDefaultDate = document.getElementById('settings-cmd-default-date').value;
    settings.focusDuration = parseInt(document.getElementById('settings-focus-duration').value);
    settings.shortBreakDuration = parseInt(document.getElementById('settings-short-break-duration').value);
    settings.longBreakDuration = parseInt(document.getElementById('settings-long-break-duration').value);
    settings.longBreakInterval = parseInt(document.getElementById('settings-long-break-interval').value);
    settings.autoBreak = document.getElementById('settings-auto-break').checked;
    settings.autoFocus = document.getElementById('settings-auto-focus').checked;
    settings.bgFlowEffect = document.getElementById('settings-bg-flow-effect').checked;
    settings.advancedParticleAnimation = document.getElementById('settings-advanced-particle').checked;
    settings.autoCreateTask = document.getElementById('settings-auto-create').checked;
    settings.toastDuration = parseInt(document.getElementById('settings-toast-duration').value) || 5;
    settings.snoozeDelay = parseInt(document.getElementById('settings-snooze-delay').value) || 15;
    if (settings.snoozeDelay < 1) settings.snoozeDelay = 1;
    if (settings.snoozeDelay > 120) settings.snoozeDelay = 120;
    settings.refreshInterval = parseInt(document.getElementById('settings-refresh-interval').value) || 30;
    if (settings.refreshInterval < 5) settings.refreshInterval = 5;
    if (settings.refreshInterval > 300) settings.refreshInterval = 300;
    settings.bgOpacity = parseInt(document.getElementById('settings-bg-opacity').value) || 100;
    settings.bgBlur = parseInt(document.getElementById('settings-bg-blur').value) ?? 10;
    settings.bindAddress = document.getElementById('settings-bind-address').value;
    const portVal = parseInt(document.getElementById('settings-port').value);
    settings.port = (portVal >= 1024 && portVal <= 65535) ? portVal : 14438;
    // webMode 不在此处保存，由 onWebModeChange() 单独处理（涉及联网检测与页面跳转）
    // fontFamily 不在此处保存，由 submitFontInput()/handleFontFileUpload() 单独处理
    // themePalette 不在此处保存，由 selectThemePalette() 单独处理
    const holidayApiEl = document.getElementById('settings-holiday-api-url');
    if (holidayApiEl) settings.holidayApiUrl = holidayApiEl.value.trim();

    pomodoroState.autoBreak = settings.autoBreak;
    pomodoroState.autoFocus = settings.autoFocus;
    pomodoroState.longBreakInterval = settings.longBreakInterval;
    // focusing 时保留当前会话的 focusDuration（用于准确计算已专注时长），新时长在下个专注生效
    if (pomodoroState.state !== 'focusing') {
        pomodoroState.focusDuration = settings.focusDuration;
    }
    // resting 时保留当前会话的休息时长，新时长在下个休息生效
    if (pomodoroState.state !== 'resting') {
        pomodoroState.shortBreakDuration = settings.shortBreakDuration;
        pomodoroState.longBreakDuration = settings.longBreakDuration;
    }
    // 非运行状态（idle/pause/completed/rest_ended）下立即应用新时长到 timeLeft
    // focusing/resting 状态下保持当前倒计时不变，新时长在当前阶段结束后生效
    if (pomodoroState.state !== 'focusing' && pomodoroState.state !== 'resting') {
        if (pomodoroState.phase === 'focus') {
            pomodoroState.timeLeft = pomodoroState.focusDuration * 60;
        } else if (pomodoroState.phase === 'longBreak') {
            pomodoroState.timeLeft = pomodoroState.longBreakDuration * 60;
            pomodoroState.breakDuration = pomodoroState.longBreakDuration;
        } else {
            pomodoroState.timeLeft = pomodoroState.shortBreakDuration * 60;
            pomodoroState.breakDuration = pomodoroState.shortBreakDuration;
        }
        updatePomodoroDisplay();
    }
    
    saveData();
    startDataRefreshTimer();

    // 检查网络配置是否变更
    const newBindAddress = settings.bindAddress;
    const newPort = settings.port;
    if (newBindAddress !== _originalBindAddress || newPort !== _originalPort) {
        _originalBindAddress = newBindAddress;
        _originalPort = newPort;
        closeSettingsModal();
        renderView();
        if (!silent) {
            setTimeout(() => {
                showConfirmToast(
                    '网络配置已更改，是否重启服务以生效？',
                    () => { executeRestart(); },
                    () => { showToast('网络配置将在下一次重启服务时生效', 'info', 5000); }
                );
            }, 100);
        }
        return;
    }

    closeSettingsModal();
    applyDisplaySettings();
    renderView();
    if (!silent) {
        setTimeout(() => {
            showToast('设置已保存！', 'success');
        }, 100);
    }
}

// 应用显示类设置（节假日倒计时可见性等）
function applyDisplaySettings() {
    const holidayBox = document.getElementById('holiday-countdown');
    if (holidayBox) {
        holidayBox.style.display = settings.showHolidayCountdown !== false ? '' : 'none';
    }
    // 侧边栏功能按钮（正念小事、答案之书）显隐
    const showExtras = settings.showSidebarExtras !== false;
    const boringBtn = document.getElementById('sidebar-boring-btn');
    if (boringBtn) boringBtn.style.display = showExtras ? '' : 'none';
    const answerBtn = document.getElementById('sidebar-answer-book-btn');
    if (answerBtn) answerBtn.style.display = showExtras ? '' : 'none';

    // 番茄专注：背景流动效果开关（开启时 body.bg-flow-strong 触发 background-position 强动画）
    document.body.classList.toggle('bg-flow-strong', settings.bgFlowEffect === true);
    // 番茄专注：高级粒子动画开关（关闭时 body.no-particles 隐藏粒子容器并阻止 JS 创建）
    document.body.classList.toggle('no-particles', settings.advancedParticleAnimation === false);

    // 若番茄页面可见，立即刷新动画以应用新设置
    const pomodoroPage = document.getElementById('pomodoro-page');
    if (pomodoroPage && !pomodoroPage.classList.contains('hidden') && typeof updatePomodoroBackground === 'function') {
        updatePomodoroBackground();
    }
}

function updateNotificationPermButton() {
    const btn = document.getElementById('settings-notification-perm-btn');
    if (!btn) return;
    btn.textContent = '通知测试';
    btn.disabled = false;
    btn.style.cssText = '';
}

function loadAutoStartStatus() {
    const checkbox = document.getElementById('settings-autostart');
    if (!checkbox) return;
    fetch('/api/autostart')
        .then(r => r.json())
        .then(data => {
            checkbox.checked = data.enabled || false;
        })
        .catch(() => {
            checkbox.checked = false;
        });
}

function toggleAutoStart() {
    const checkbox = document.getElementById('settings-autostart');
    if (!checkbox) return;
    const enabled = checkbox.checked;

    fetch('/api/autostart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            showToast(enabled ? '已开启开机自动启动' : '已关闭开机自动启动', 'success');
        } else {
            checkbox.checked = !enabled;
            showToast('设置失败：' + (data.error || '未知错误'), 'error');
        }
    })
    .catch(err => {
        checkbox.checked = !enabled;
        showToast('设置失败', 'error');
    });
}

let _currentPlatform = null;

function detectPlatform() {
    fetch('/api/platform').then(r => r.json()).then(data => {
        _currentPlatform = data.platform || 'linux';
    }).catch(() => {
        _currentPlatform = 'linux';
    });
}

function testNotification() {
    const btn = document.getElementById('settings-notification-perm-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '发送中...';
    }
    fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: '通知测试',
            body: _currentPlatform === 'windows'
                ? 'Windows系统通知测试成功！'
                : 'Linux系统通知测试成功！'
        })
    }).then(r => r.json()).then(() => {
        showToast('系统通知已发送，请查看桌面通知', 'success');
    }).catch(err => {
        showToast('通知发送失败: ' + err.message, 'error');
    }).finally(() => {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '通知测试';
        }
    });
}

function goToToday() {
    currentDate = new Date();
    if (currentView === 'schedule') {
        scheduleMonthOffset = 0;
        _scheduleAutoScroll = true;
    }
    renderView();
    if (currentView === 'task') {
        setTimeout(() => {
            const todayGroup = document.querySelector('[data-task-group="today"]');
            if (todayGroup) {
                todayGroup.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    }
}

// ==================== 网络配置 ====================

let _originalBindAddress = '127.0.0.1';
let _originalPort = 14438;
let _networkInfo = null;

// 高危/常用冲突端口列表
const DANGEROUS_PORTS = {
    20: 'FTP 数据端口',
    21: 'FTP 控制端口',
    22: 'SSH',
    23: 'Telnet',
    25: 'SMTP',
    53: 'DNS',
    69: 'TFTP',
    80: 'HTTP',
    110: 'POP3',
    111: 'NFS/RPC',
    135: 'RPC',
    137: 'NetBIOS 名称服务',
    138: 'NetBIOS 数据报文',
    139: 'NetBIOS 会话服务',
    143: 'IMAP',
    161: 'SNMP',
    389: 'LDAP',
    443: 'HTTPS',
    445: 'SMB',
    512: 'Linux rexec',
    513: 'Linux rlogin',
    514: 'Linux rsh',
    587: 'SMTP(S)',
    873: 'Rsync',
    993: 'IMAPS',
    995: 'POP3S',
    1433: 'SQL Server',
    1521: 'Oracle',
    2049: 'NFS',
    3306: 'MySQL',
    3389: 'RDP',
    5000: 'Sybase/DB2',
    5432: 'PostgreSQL',
    5900: 'VNC',
    5901: 'VNC',
    5902: 'VNC',
    6379: 'Redis',
    8000: 'HTTP 备用',
    8080: 'HTTP 代理/备用',
    8888: 'HTTP 备用',
    9090: 'WebSocket/代理',
    27017: 'MongoDB',
    27018: 'MongoDB',
};

function onPortChange() {
    const portInput = document.getElementById('settings-port');
    const warningEl = document.getElementById('port-warning');
    const port = parseInt(portInput.value);
    
    if (isNaN(port) || port < 1024 || port > 65535) {
        warningEl.textContent = '端口号必须在 1024-65535 范围内';
        warningEl.classList.remove('hidden');
        return;
    }
    
    if (DANGEROUS_PORTS[port]) {
        warningEl.textContent = '端口 ' + port + ' 为' + DANGEROUS_PORTS[port] + '常用端口，可能导致冲突或安全风险，建议更换';
        warningEl.classList.remove('hidden');
        return;
    }
    
    warningEl.classList.add('hidden');
    
    // 更新重启提示
    updateNetworkRestartHint();
}

function updateNetworkRestartHint() {
    const bindAddress = document.getElementById('settings-bind-address').value;
    const port = parseInt(document.getElementById('settings-port').value) || 14438;
    const restartHint = document.getElementById('network-restart-hint');
    
    if (bindAddress !== _originalBindAddress || port !== _originalPort) {
        restartHint.classList.remove('hidden');
    } else {
        restartHint.classList.add('hidden');
    }
}

function loadNetworkInfo() {
    fetch('/api/network-info').then(r => r.json()).then(info => {
        _networkInfo = info;
        updateNetworkInfoDisplay();
    }).catch(err => {
        console.error('Load network info error:', err);
    });
}

function updateNetworkInfoDisplay() {
    if (!_networkInfo) return;
    const bindAddress = document.getElementById('settings-bind-address').value;
    const networkInfoContainer = document.getElementById('network-info-container');
    const localhostInfoContainer = document.getElementById('localhost-info-container');
    const lanUrlEl = document.getElementById('lan-access-url');
    const localhostUrlEl = document.getElementById('localhost-access-url');

    const currentPort = parseInt(document.getElementById('settings-port').value) || _networkInfo.port;
    localhostUrlEl.textContent = 'http://127.0.0.1:' + currentPort;

    if (bindAddress === '0.0.0.0') {
        networkInfoContainer.classList.remove('hidden');
        lanUrlEl.textContent = 'http://' + _networkInfo.localIp + ':' + currentPort;
    } else {
        networkInfoContainer.classList.add('hidden');
    }

    // 更新重启提示
    updateNetworkRestartHint();

    // 更新备份目录路径
    const backupDirEl = document.getElementById('backup-dir-path');
    if (backupDirEl && _networkInfo.backupDir) {
        backupDirEl.textContent = _networkInfo.backupDir;
    }
}

function onBindAddressChange() {
    updateNetworkInfoDisplay();
}

function copyLanUrl() {
    const el = document.getElementById('lan-access-url');
    if (el && el.textContent) {
        navigator.clipboard.writeText(el.textContent).then(() => {
            showToast('已复制局域网地址', 'success');
        }).catch(() => {
            // 降级：选择文本
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            showToast('请手动复制选中的地址', 'info');
        });
    }
}

function copyLocalhostUrl() {
    const el = document.getElementById('localhost-access-url');
    if (el && el.textContent) {
        navigator.clipboard.writeText(el.textContent).then(() => {
            showToast('已复制本机地址', 'success');
        }).catch(() => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            showToast('请手动复制选中的地址', 'info');
        });
    }
}

// ==================== 网页模式（在线/离线）切换 ====================
let _cdnHeartbeatTimerId = null;
let _cdnHeartbeatFailCount = 0;
const CDN_HEARTBEAT_URL = 'https://cdn.tailwindcss.com';
const CDN_HEARTBEAT_INTERVAL = 60000; // 60秒
const CDN_HEARTBEAT_FAIL_THRESHOLD = 2; // 连续2次失败则回退

// 检测 CDN 可达性（3秒超时）
function checkOnlineConnectivity() {
    return new Promise((resolve) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        fetch(CDN_HEARTBEAT_URL, {
            method: 'HEAD',
            mode: 'no-cors',
            cache: 'no-cache',
            signal: controller.signal
        }).then(() => {
            clearTimeout(timeoutId);
            resolve(true);
        }).catch(() => {
            clearTimeout(timeoutId);
            resolve(false);
        });
    });
}

// 初始化网页模式：离线版入口检测是否需要跳转到在线版
function initWebMode() {
    const currentVersion = window._WEB_VERSION || 'offline';
    const savedMode = settings.webMode || 'offline';

    if (currentVersion === 'offline' && savedMode === 'online') {
        // 离线版入口但用户设置为在线版：检测 CDN 后决定是否跳转
        checkOnlineConnectivity().then(online => {
            if (online) {
                window.location.href = '/index.html';
            } else {
                // CDN 不可达，保持离线版并提示
                showToast('互联网不可达，已保持在离线版', 'warning', 5000);
            }
        });
    } else if (currentVersion === 'online') {
        // 在线版运行：启动 CDN 心跳检测
        startCdnHeartbeat();
    }
}

// 启动 CDN 心跳（仅在线版运行时）
function startCdnHeartbeat() {
    if (_cdnHeartbeatTimerId) clearInterval(_cdnHeartbeatTimerId);
    _cdnHeartbeatFailCount = 0;
    _cdnHeartbeatTimerId = setInterval(async () => {
        const online = await checkOnlineConnectivity();
        if (online) {
            _cdnHeartbeatFailCount = 0;
        } else {
            _cdnHeartbeatFailCount++;
            if (_cdnHeartbeatFailCount >= CDN_HEARTBEAT_FAIL_THRESHOLD) {
                // 连续失败达阈值：回退到离线版
                stopCdnHeartbeat();
                settings.webMode = 'offline';
                saveDataImmediate();
                showToast('CDN 不可达，已自动切换回离线版', 'warning', 5000);
                setTimeout(() => {
                    window.location.href = '/index_offline.html';
                }, 1500);
            }
        }
    }, CDN_HEARTBEAT_INTERVAL);
}

function stopCdnHeartbeat() {
    if (_cdnHeartbeatTimerId) {
        clearInterval(_cdnHeartbeatTimerId);
        _cdnHeartbeatTimerId = null;
    }
    _cdnHeartbeatFailCount = 0;
}

// 设置面板中切换网页模式
async function onWebModeChange() {
    const selectEl = document.getElementById('settings-web-mode');
    if (!selectEl) return;
    const newMode = selectEl.value;
    const currentVersion = window._WEB_VERSION || 'offline';

    // 如果与当前运行版本一致，无需操作
    if ((newMode === 'online' && currentVersion === 'online') ||
        (newMode === 'offline' && currentVersion === 'offline')) {
        settings.webMode = newMode;
        saveData();
        return;
    }

    // 切换到在线版：先检测 CDN
    if (newMode === 'online') {
        showToast('正在检测网络连通性...', 'info', 3000);
        const online = await checkOnlineConnectivity();
        if (!online) {
            // CDN 不可达，回退选择项并提示
            selectEl.value = 'offline';
            showToast('无法连接 CDN，已保持在离线版', 'warning', 5000);
            return;
        }
        // CDN 可达：保存设置并跳转
        settings.webMode = 'online';
        saveDataImmediate();
        showToast('正在切换到在线版...', 'success', 2000);
        setTimeout(() => {
            window.location.href = '/index.html';
        }, 800);
    } else {
        // 切换到离线版：直接保存并跳转
        settings.webMode = 'offline';
        saveDataImmediate();
        showToast('正在切换到离线版...', 'success', 2000);
        setTimeout(() => {
            window.location.href = '/index_offline.html';
        }, 800);
    }
}

// ==================== 字体选择 ====================
let _detectedSystemFonts = null;
let _fontDropdownOpen = false;

function initFontFamilySelector() {
    const inputEl = document.getElementById('settings-font-family-input');
    if (!inputEl) return;

    const isOnline = window._WEB_VERSION === 'online';

    // 更新提示文案
    const hintEl = document.getElementById('font-hint-text');
    if (hintEl) {
        hintEl.textContent = isOnline
            ? '可手动输入或点击右侧箭头选择已安装字体；在线版还可选择 Google 字体；也可上传 TTF 字体文件'
            : '可手动输入或点击右侧箭头选择已安装字体；也可上传 TTF 字体文件';
    }

    // 回填当前字体名到输入框
    inputEl.value = settings.fontFamily || '';

    // 异步检测系统字体并初始化下拉列表
    if (!_detectedSystemFonts) {
        setTimeout(() => {
            _detectedSystemFonts = detectSystemFonts();
        }, 100);
    }

    // 绑定输入框交互
    _bindFontComboboxEvents(inputEl);

    // 显示/隐藏清除按钮
    _updateClearFontButton();
}

function _bindFontComboboxEvents(inputEl) {
    // 点击输入框时展开下拉
    inputEl.addEventListener('focus', () => {
        _openFontDropdown();
    });
    // 输入时过滤
    inputEl.addEventListener('input', () => {
        if (_fontDropdownOpen) {
            _filterFontDropdown(inputEl.value);
        } else {
            _openFontDropdown();
        }
    });
    // Enter 键提交
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            _closeFontDropdown();
            submitFontInput();
        } else if (e.key === 'Escape') {
            _closeFontDropdown();
            inputEl.value = settings.fontFamily || '';
        }
    });
}

function toggleFontDropdown(event) {
    if (event) event.stopPropagation();
    if (_fontDropdownOpen) {
        _closeFontDropdown();
    } else {
        const inputEl = document.getElementById('settings-font-family-input');
        if (inputEl) inputEl.focus();
    }
}

function _openFontDropdown() {
    const listEl = document.getElementById('font-dropdown-list');
    if (!listEl) return;
    _renderFontDropdown(listEl, '');
    listEl.classList.remove('hidden');
    _fontDropdownOpen = true;
}

function _closeFontDropdown() {
    const listEl = document.getElementById('font-dropdown-list');
    if (listEl) listEl.classList.add('hidden');
    _fontDropdownOpen = false;
}

function _renderFontDropdown(listEl, filter) {
    const isOnline = window._WEB_VERSION === 'online';
    listEl.innerHTML = '';

    // "系统默认"选项
    if (!filter || '系统默认'.includes(filter) || 'default'.toLowerCase().includes(filter.toLowerCase())) {
        const item = document.createElement('div');
        item.className = 'px-3 py-2 cursor-pointer hover:bg-theme-tertiary text-sm text-theme-primary border-b border-theme';
        item.textContent = '系统默认';
        item.onclick = () => {
            _selectFontFromDropdown('');
        };
        listEl.appendChild(item);
    }

    // 已上传字体（如果有）
    if (settings.uploadedFont && settings.uploadedFont.name) {
        const uf = settings.uploadedFont;
        if (!filter || uf.name.toLowerCase().includes(filter.toLowerCase())) {
            const header = document.createElement('div');
            header.className = 'px-3 py-1 text-xs font-semibold text-theme-muted bg-theme-tertiary';
            header.textContent = '已上传字体';
            listEl.appendChild(header);
            const item = document.createElement('div');
            item.className = 'px-3 py-2 cursor-pointer hover:bg-theme-tertiary text-sm text-theme-primary';
            item.textContent = uf.name + '（上传）';
            item.style.fontFamily = '"' + uf.name + '", sans-serif';
            item.onclick = () => { _selectFontFromDropdown(uf.name); };
            listEl.appendChild(item);
        }
    }

    // 系统已安装字体
    if (_detectedSystemFonts && _detectedSystemFonts.length > 0) {
        const filtered = filter
            ? _detectedSystemFonts.filter(f => f.toLowerCase().includes(filter.toLowerCase()))
            : _detectedSystemFonts;
        if (filtered.length > 0) {
            const header = document.createElement('div');
            header.className = 'px-3 py-1 text-xs font-semibold text-theme-muted bg-theme-tertiary';
            header.textContent = '系统已安装';
            listEl.appendChild(header);
            for (const font of filtered) {
                const item = document.createElement('div');
                item.className = 'px-3 py-2 cursor-pointer hover:bg-theme-tertiary text-sm text-theme-primary';
                item.textContent = font;
                item.style.fontFamily = '"' + font + '", sans-serif';
                item.onclick = () => { _selectFontFromDropdown(font); };
                listEl.appendChild(item);
            }
        }
    }

    // Google 字体（仅在线版）
    if (isOnline && typeof GOOGLE_FONTS_LIST !== 'undefined') {
        const filtered = filter
            ? GOOGLE_FONTS_LIST.filter(f =>
                f.family.toLowerCase().includes(filter.toLowerCase()) ||
                f.label.includes(filter))
            : GOOGLE_FONTS_LIST;
        if (filtered.length > 0) {
            const header = document.createElement('div');
            header.className = 'px-3 py-1 text-xs font-semibold text-theme-muted bg-theme-tertiary';
            header.textContent = 'Google 字体（在线加载）';
            listEl.appendChild(header);
            for (const f of filtered) {
                const item = document.createElement('div');
                item.className = 'px-3 py-2 cursor-pointer hover:bg-theme-tertiary text-sm text-theme-primary';
                item.textContent = f.label + ' (' + f.family + ')';
                item.style.fontFamily = '"' + f.family + '", sans-serif';
                item.onclick = () => { _selectFontFromDropdown(f.family); };
                listEl.appendChild(item);
            }
        }
    }

    // 无匹配结果
    if (listEl.children.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'px-3 py-2 text-sm text-theme-muted';
        empty.textContent = '无匹配字体，可直接输入字体名后按 Enter';
        listEl.appendChild(empty);
    }
}

function _filterFontDropdown(query) {
    const listEl = document.getElementById('font-dropdown-list');
    if (listEl) _renderFontDropdown(listEl, query);
}

function _selectFontFromDropdown(font) {
    _closeFontDropdown();
    const inputEl = document.getElementById('settings-font-family-input');
    if (inputEl) inputEl.value = font;
    // 下拉选择的字体直接应用（已通过检测或为 Google 字体/上传字体）
    _applyFontName(font);
}

// 提交手动输入的字体名
function submitFontInput() {
    const inputEl = document.getElementById('settings-font-family-input');
    if (!inputEl) return;
    const font = (inputEl.value || '').trim();
    if (!font) {
        // 输入为空时，恢复系统默认
        _applyFontName('');
        return;
    }
    // 已上传字体或 Google 字体不需要 canvas 检测
    const isUploaded = settings.uploadedFont && settings.uploadedFont.name === font;
    const isGoogle = typeof isGoogleFont === 'function' && isGoogleFont(font);
    if (isUploaded || isGoogle) {
        _applyFontName(font);
        return;
    }
    // 通过 canvas 检测字体是否已安装
    const isAvailable = typeof _isFontAvailable === 'function' && _isFontAvailable(font);
    if (!isAvailable) {
        // 未检测到安装，不应用，仅提示
        showToast('未检测到该字体已安装：' + font, 'warning', 3000);
        // 恢复输入框为当前实际使用的字体
        inputEl.value = settings.fontFamily || '';
        return;
    }
    _applyFontName(font);
}

// 应用字体名（已通过验证）
function _applyFontName(font) {
    settings.fontFamily = font;
    const applyAndSave = () => {
        applyFontFamily();
        saveData();
        showToast(font ? '已切换字体：' + font : '已恢复系统默认字体', 'success', 2000);
        _updateClearFontButton();
    };
    // Google 字体需先加载样式表再应用
    if (font && typeof isGoogleFont === 'function' && isGoogleFont(font)) {
        const isOnline = window._WEB_VERSION === 'online';
        if (isOnline) {
            loadGoogleFont(font, applyAndSave);
        } else {
            showToast('离线版不支持 Google 字体', 'warning', 3000);
        }
    } else {
        applyAndSave();
    }
}

// ==================== 上传字体文件 ====================
const _UPLOADED_FONT_PREFIX = 'UserUploaded_';
const _MAX_FONT_SIZE = 20 * 1024 * 1024; // 20MB 限制

function handleFontFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = ''; // 允许重复上传同一文件

    // 文件大小限制
    if (file.size > _MAX_FONT_SIZE) {
        showToast('字体文件过大（超过 20MB），请选择更小的文件', 'error', 4000);
        return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
        showToast('仅支持 TTF/OTF/WOFF/WOFF2 格式', 'error', 3000);
        return;
    }

    // 生成字体名（去除扩展名，加前缀确保唯一）
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const fontName = _UPLOADED_FONT_PREFIX + baseName;

    const reader = new FileReader();
    reader.onload = function(e) {
        const fontDataUrl = e.target.result;
        // 注册字体
        _registerUploadedFont(fontName, fontDataUrl, () => {
            // 保存到设置（只保留最后一个）
            settings.uploadedFont = {
                name: fontName,
                originalName: file.name,
                data: fontDataUrl
            };
            settings.fontFamily = fontName;
            applyFontFamily();
            saveData();

            // 更新输入框
            const inputEl = document.getElementById('settings-font-family-input');
            if (inputEl) inputEl.value = fontName;
            _updateClearFontButton();

            showToast('字体已上传并应用：' + baseName, 'success', 3000);
        });
    };
    reader.onerror = function() {
        showToast('字体文件读取失败', 'error', 3000);
    };
    reader.readAsDataURL(file);
}

// 注册上传的字体到文档
function _registerUploadedFont(fontName, fontDataUrl, callback) {
    // 先移除已注册的同名字体样式
    const existing = document.getElementById('uploaded-font-style');
    if (existing) existing.remove();

    const style = document.createElement('style');
    style.id = 'uploaded-font-style';
    style.textContent = '@font-face { font-family: "' + fontName + '"; src: url("' + fontDataUrl + '") format("truetype"); }';
    document.head.appendChild(style);

    // 使用 FontFace API 确保字体加载完成
    if (typeof FontFace !== 'undefined') {
        try {
            const face = new FontFace(fontName, 'url(' + fontDataUrl + ')');
            face.load().then(() => {
                document.fonts.add(face);
                if (callback) callback();
            }).catch(err => {
                console.warn('FontFace load failed, fallback to style injection:', err);
                if (callback) callback();
            });
        } catch (e) {
            if (callback) callback();
        }
    } else {
        setTimeout(() => { if (callback) callback(); }, 100);
    }
}

// 在应用启动时注册已上传的字体
function registerUploadedFontOnLoad() {
    if (settings.uploadedFont && settings.uploadedFont.name && settings.uploadedFont.data) {
        return new Promise(resolve => {
            _registerUploadedFont(settings.uploadedFont.name, settings.uploadedFont.data, resolve);
        });
    }
    return Promise.resolve();
}

// 清除已上传的字体
function clearUploadedFont() {
    if (!settings.uploadedFont) return;
    const oldName = settings.uploadedFont.originalName || settings.uploadedFont.name;
    settings.uploadedFont = null;
    // 如果当前正在使用上传的字体，恢复系统默认
    if (settings.fontFamily && settings.fontFamily.startsWith(_UPLOADED_FONT_PREFIX)) {
        settings.fontFamily = '';
    }
    // 移除样式
    const existing = document.getElementById('uploaded-font-style');
    if (existing) existing.remove();
    applyFontFamily();
    saveData();

    // 更新输入框
    const inputEl = document.getElementById('settings-font-family-input');
    if (inputEl) inputEl.value = settings.fontFamily || '';
    _updateClearFontButton();

    showToast('已清除上传的字体：' + oldName, 'info', 2000);
}

function _updateClearFontButton() {
    const btn = document.getElementById('font-clear-btn');
    if (!btn) return;
    if (settings.uploadedFont) {
        btn.classList.remove('hidden');
        btn.title = '清除已上传字体：' + (settings.uploadedFont.originalName || settings.uploadedFont.name);
    } else {
        btn.classList.add('hidden');
    }
}

// 点击外部关闭下拉
document.addEventListener('click', (e) => {
    if (!_fontDropdownOpen) return;
    const wrapper = document.getElementById('font-combobox-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        _closeFontDropdown();
        // 同时提交输入
        const inputEl = document.getElementById('settings-font-family-input');
        if (inputEl && inputEl.value.trim() !== (settings.fontFamily || '')) {
            submitFontInput();
        }
    }
});

function applyFontFamily() {
    const root = document.documentElement;
    if (settings.fontFamily) {
        const isOnline = window._WEB_VERSION === 'online';
        // Google 字体仅在线版可用；离线版遇到 Google 字体选择时回退到系统默认
        if (typeof isGoogleFont === 'function' && isGoogleFont(settings.fontFamily)) {
            if (!isOnline) {
                root.style.removeProperty('--app-font-family');
                return;
            }
            if (typeof loadGoogleFont === 'function') {
                loadGoogleFont(settings.fontFamily);
            }
        }
        root.style.setProperty('--app-font-family', '"' + settings.fontFamily + '", sans-serif');
    } else {
        root.style.removeProperty('--app-font-family');
    }
}

// ==================== 动态主题色 ====================
function initThemePalettePreview() {
    // 渲染内置配色预览（始终显示）
    _renderBuiltinPalettePreviews();

    // 若已有背景图提取的调色板数据，显示预览
    const container = document.getElementById('palette-preview-container');
    const hint = document.getElementById('palette-hint-text');
    if (container) {
        if (settings.themePaletteColors) {
            container.classList.remove('hidden');
            if (hint) hint.classList.remove('hidden');
            _renderPalettePreviews(settings.themePaletteColors);
        } else {
            container.classList.add('hidden');
            if (hint) hint.classList.add('hidden');
        }
    }

    // 恢复自定义强调色输入框值
    const customInput = document.getElementById('custom-accent-input');
    const customText = document.getElementById('custom-accent-text');
    if (settings.customAccent) {
        if (customInput) customInput.value = settings.customAccent;
        if (customText) customText.value = settings.customAccent;
    }

    _highlightActivePalette(settings.themePalette || 'none');
    _renderPaletteResetButtons();
}

// 渲染内置配色预览色条（根据当前主题选择 light/dark 变体）
// 每个色条段可悬停显示编辑图标，点击后直接弹出系统调色板（input[type=color]）实时保存
function _renderBuiltinPalettePreviews() {
    const isDark = isDarkThemeActive();
    // 色条显示的字段顺序：accent, bgPrimary, bgSecondary, textPrimary, textMuted, border
    const fields = ['accent', 'bgPrimary', 'bgSecondary', 'textPrimary', 'textMuted', 'border'];
    Object.keys(BUILTIN_PALETTES).forEach(key => {
        const paletteKey = 'builtin:' + key;
        // 优先使用用户编辑后的调色板，其次内置
        const palette = resolvePaletteObject(paletteKey) || BUILTIN_PALETTES[key];
        if (!palette) return;
        const variant = (palette.light && palette.dark) ? (isDark ? palette.dark : palette.light) : palette;
        const bar = document.querySelector('.palette-color-bar[data-palette="builtin-' + key + '"]');
        if (bar) {
            bar.innerHTML = '';
            fields.forEach(field => {
                const color = variant[field];
                const span = document.createElement('span');
                span.style.backgroundColor = color;
                span.dataset.field = field;
                span.dataset.paletteKey = paletteKey;
                // 阻止 mousedown 冒泡到父 button，避免触发 startPalettePreview 应用配色
                span.onmousedown = function(e) { e.stopPropagation(); e.preventDefault(); };
                span.onclick = function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                    _openColorPicker(paletteKey, field, color, span);
                };
                const icon = document.createElement('i');
                icon.className = 'fas fa-pen palette-edit-icon';
                span.appendChild(icon);
                bar.appendChild(span);
            });
        }
    });
}

function _renderPalettePreviews(palettes) {
    const fields = ['accent', 'bgPrimary', 'bgSecondary', 'textPrimary', 'textMuted', 'border'];
    ['vibrant', 'muted', 'dark'].forEach(name => {
        // 优先使用用户编辑后的调色板，其次背景图提取的
        const p = (settings.customPalettes && settings.customPalettes[name]) || palettes[name];
        if (!p) return;
        const bar = document.querySelector('.palette-color-bar[data-palette="' + name + '"]');
        if (bar) {
            bar.innerHTML = '';
            fields.forEach(field => {
                const color = p[field];
                const span = document.createElement('span');
                span.style.backgroundColor = color;
                span.dataset.field = field;
                span.dataset.paletteKey = name;
                // 阻止 mousedown 冒泡到父 button，避免触发 startPalettePreview 应用配色
                span.onmousedown = function(e) { e.stopPropagation(); e.preventDefault(); };
                span.onclick = function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                    _openColorPicker(name, field, color, span);
                };
                const icon = document.createElement('i');
                icon.className = 'fas fa-pen palette-edit-icon';
                span.appendChild(icon);
                bar.appendChild(span);
            });
        }
    });
}

// 配色显示名称映射
const PALETTE_DISPLAY_NAMES = {
    'builtin:blue': '蓝色',
    'builtin:green': '绿色',
    'builtin:rose': '玫红',
    'vibrant': '鲜艳',
    'muted': '柔和',
    'dark': '深色'
};

// 基于当前颜色生成5个相近预设色（原色、稍亮、稍暗、色相+、色相-）
function _generateRelatedColors(hex) {
    function toHsl(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h *= 60;
        }
        return [h, s * 100, l * 100];
    }
    function toHex(h, s, l) {
        h = ((h % 360) + 360) % 360;
        s = Math.max(0, Math.min(100, s)) / 100;
        l = Math.max(0, Math.min(100, l)) / 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
        const to2 = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
        return '#' + to2(r) + to2(g) + to2(b);
    }
    const [h, s, l] = toHsl(hex);
    return [
        hex,
        toHex(h, s, Math.min(85, l + 15)),
        toHex(h, s, Math.max(15, l - 15)),
        toHex(h + 25, s, l),
        toHex(h - 25, s, l)
    ];
}

// 弹出内联颜色选择器：定位在色条段下方，包含标题、可见调色板、hex输入、预设色、保存/取消按钮
// 使用可见的 input[type=color] 使浏览器原生调色板在正确位置弹出
function _openColorPicker(paletteKey, field, currentColor, anchorEl) {
    _closeInlineColorPicker();
    if (!anchorEl) return;

    const paletteName = PALETTE_DISPLAY_NAMES[paletteKey] || paletteKey;
    const fieldLabel = PALETTE_FIELD_LABELS[field] || field;
    const originalColor = (currentColor && currentColor.startsWith('#')) ? currentColor : '#3b82f6';
    let currentHex = originalColor;

    const picker = document.createElement('div');
    picker.id = 'palette-inline-picker';
    picker.className = 'fixed z-[10000] bg-theme-primary border-2 border-blue-500 rounded-lg p-3 shadow-2xl';
    picker.style.cssText = 'min-width:200px;';

    // 基于当前颜色生成5个相近预设色
    const presets = _generateRelatedColors(originalColor);

    picker.innerHTML =
        '<div class="text-xs font-semibold text-theme-primary mb-2">编辑' + paletteName + ' · ' + fieldLabel + '</div>' +
        '<div class="flex gap-2 items-center mb-2">' +
            '<input type="color" id="inline-color-input" value="' + originalColor + '" class="w-12 h-9 rounded cursor-pointer border-2 border-theme" style="padding:0;background:transparent;">' +
            '<input type="text" id="inline-hex-input" value="' + originalColor + '" class="flex-1 px-2 py-1.5 text-sm border-2 border-theme rounded bg-theme-tertiary text-theme-primary focus:outline-none focus:border-blue-500" maxlength="7" spellcheck="false">' +
        '</div>' +
        '<div class="flex gap-1 mb-3">' +
            presets.map(function(c) { return '<div class="preset-color flex-1 h-6 rounded cursor-pointer border border-theme hover:scale-110 transition" style="background-color:' + c + ';" data-color="' + c + '" title="' + c + '"></div>'; }).join('') +
        '</div>' +
        '<div class="flex justify-end gap-2">' +
            '<button id="inline-cancel-btn" class="flex items-center justify-center w-8 h-8 rounded-lg border border-theme text-theme-secondary hover:bg-theme-secondary transition" title="取消"><i class="fas fa-times text-sm"></i></button>' +
            '<button id="inline-save-btn" class="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition" title="保存"><i class="fas fa-check text-sm"></i></button>' +
        '</div>';

    document.body.appendChild(picker);

    // 定位：在 anchorEl 下方，做视口边界检查
    const rect = anchorEl.getBoundingClientRect();
    const pickerW = picker.offsetWidth;
    const pickerH = picker.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8;
    if (left < 8) left = 8;
    if (top + pickerH > window.innerHeight - 8) top = rect.top - pickerH - 4;
    if (top < 8) top = 8;
    picker.style.left = left + 'px';
    picker.style.top = top + 'px';

    const colorInput = picker.querySelector('#inline-color-input');
    const hexInput = picker.querySelector('#inline-hex-input');
    const saveBtn = picker.querySelector('#inline-save-btn');
    const cancelBtn = picker.querySelector('#inline-cancel-btn');

    // 更新颜色（内部）：同步控件 + 实时预览色条段 + 预览应用到CSS变量
    function updateColor(hex, syncColorInput, syncHexInput) {
        currentHex = hex;
        if (syncColorInput) colorInput.value = hex;
        if (syncHexInput) hexInput.value = hex;
        if (anchorEl) anchorEl.style.backgroundColor = hex;
        _applyPaletteColor(paletteKey, field, hex, true);
    }

    // 可见 color input 变化 -> 更新文本框 + 预览
    colorInput.addEventListener('input', function(e) {
        updateColor(e.target.value, false, true);
    });

    // hex 文本框输入 -> 验证后同步
    hexInput.addEventListener('input', function(e) {
        let val = e.target.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
            updateColor(val, true, false);
        }
    });

    // 预设色点击
    picker.querySelectorAll('.preset-color').forEach(function(el) {
        el.addEventListener('click', function() {
            updateColor(this.dataset.color, true, true);
        });
    });

    // 保存
    saveBtn.addEventListener('click', function() {
        _applyPaletteColor(paletteKey, field, currentHex, false);
        _closeInlineColorPicker();
    });

    // 取消：恢复原始颜色
    cancelBtn.addEventListener('click', function() {
        _applyPaletteColor(paletteKey, field, originalColor, false);
        if (anchorEl) anchorEl.style.backgroundColor = originalColor;
        _closeInlineColorPicker();
    });

    // 点击外部关闭（等同于取消）
    setTimeout(function() {
        document.addEventListener('mousedown', _inlinePickerOutsideHandler);
    }, 0);
}

function _closeInlineColorPicker() {
    const picker = document.getElementById('palette-inline-picker');
    if (picker) picker.remove();
    document.removeEventListener('mousedown', _inlinePickerOutsideHandler);
}

function _inlinePickerOutsideHandler(e) {
    const picker = document.getElementById('palette-inline-picker');
    if (picker && !picker.contains(e.target)) {
        // 排除点击其他色条段的情况（会自行调 _openColorPicker）
        if (e.target && e.target.closest && e.target.closest('.palette-color-bar span')) return;
        const cancelBtn = picker.querySelector('#inline-cancel-btn');
        if (cancelBtn) cancelBtn.click();
        else _closeInlineColorPicker();
    }
}

// 将颜色应用到调色板并保存（实时）
// isPreview=true 时仅更新内存和视觉，不触发 saveData（避免高频写入）
// isPreview=false 时执行最终保存
let _paletteColorSaveTimer = null;
function _applyPaletteColor(paletteKey, field, hex, isPreview) {
    const isDark = isDarkThemeActive();
    const currentPalette = resolvePaletteObject(paletteKey);
    if (!currentPalette) return;
    const newPalette = JSON.parse(JSON.stringify(currentPalette));

    // 更新对应变体的字段
    if (newPalette.light && newPalette.dark) {
        // 双变体：仅更新当前主题对应的变体
        if (isDark) {
            newPalette.dark[field] = hex;
        } else {
            newPalette.light[field] = hex;
        }
    } else {
        // 扁平结构（背景图提取的）
        newPalette[field] = hex;
        // 同步 RGB 字段
        if (field === 'bgPrimary') {
            const [r, g, b] = _hexToRgb(hex);
            newPalette.bgPrimaryRgb = r + ',' + g + ',' + b;
        } else if (field === 'bgSecondary') {
            const [r, g, b] = _hexToRgb(hex);
            newPalette.bgSecondaryRgb = r + ',' + g + ',' + b;
        } else if (field === 'bgTertiary') {
            const [r, g, b] = _hexToRgb(hex);
            newPalette.bgTertiaryRgb = r + ',' + g + ',' + b;
        }
    }

    // 保存到 customPalettes
    if (!settings.customPalettes) settings.customPalettes = {};
    settings.customPalettes[paletteKey] = newPalette;

    // 如果当前正在使用该调色板，立即应用到 CSS 变量
    if (settings.themePalette === paletteKey) {
        applyThemePalette(paletteKey);
    }

    // 节流保存：预览时 300ms 节流，最终保存时立即保存
    if (!isPreview) {
        if (_paletteColorSaveTimer) {
            clearTimeout(_paletteColorSaveTimer);
            _paletteColorSaveTimer = null;
        }
        saveData();
        _renderPaletteResetButtons();
    } else {
        if (_paletteColorSaveTimer) clearTimeout(_paletteColorSaveTimer);
        _paletteColorSaveTimer = setTimeout(() => {
            saveData();
            _renderPaletteResetButtons();
        }, 400);
    }
}

// ==================== 配色编辑弹窗 ====================
// 字段中文名映射
const PALETTE_FIELD_LABELS = {
    accent: '强调色',
    accentHover: '强调色悬停',
    accentSecondary: '辅助色',
    accentBg: '强调色背景',
    accentBgStrong: '强调色背景（深）',
    accentTextDark: '强调色文字',
    accentLight: '强调色浅色',
    bgPrimary: '主背景',
    bgSecondary: '次级背景',
    bgTertiary: '三级背景',
    textPrimary: '主文字',
    textSecondary: '次级文字',
    textMuted: '辅助文字',
    border: '边框'
};

// 撤销编辑：删除该调色板的 customPalettes 记录，恢复原始配色
// 从设置界面配色卡片上的撤销按钮触发
function resetPaletteEdit(paletteKey) {
    if (settings.customPalettes && settings.customPalettes[paletteKey]) {
        delete settings.customPalettes[paletteKey];
        // 如果 customPalettes 为空，置为 null 保持干净
        if (Object.keys(settings.customPalettes).length === 0) {
            settings.customPalettes = null;
        }
        saveData();
        // 如果当前正在使用该调色板，立即应用原始配色
        if (settings.themePalette === paletteKey) {
            applyThemePalette(paletteKey);
        }
        // 重新渲染色条预览和撤销按钮
        _renderBuiltinPalettePreviews();
        if (settings.themePaletteColors) {
            _renderPalettePreviews(settings.themePaletteColors);
        }
        _renderPaletteResetButtons();
        showToast('已恢复原始配色', 'success', 2000);
    } else {
        showToast('该配色未做编辑', 'info', 2000);
    }
}

// 渲染配色卡片上的撤销按钮（仅当该配色有编辑记录时显示）
function _renderPaletteResetButtons() {
    const paletteKeys = ['builtin:blue', 'builtin:green', 'builtin:rose', 'vibrant', 'muted', 'dark'];
    paletteKeys.forEach(key => {
        const btn = document.querySelector('.palette-reset-btn[data-palette-key="' + key + '"]');
        if (btn) {
            const hasEdit = settings.customPalettes && settings.customPalettes[key];
            btn.style.display = hasEdit ? '' : 'none';
        }
    });
}

// 高亮当前选中的调色板卡片（扫描所有 data-palette-key 属性的卡片）
function _highlightActivePalette(name) {
    document.querySelectorAll('.palette-card[data-palette-key]').forEach(btn => {
        btn.classList.toggle('palette-active', btn.dataset.paletteKey === name);
    });
    const noneBtn = document.getElementById('palette-none-btn');
    if (noneBtn) {
        noneBtn.classList.toggle('palette-active', name === 'none');
    }
}

// 应用自定义强调色：从输入框读取 hex，生成调色板并应用
function applyCustomAccent() {
    const textInput = document.getElementById('custom-accent-text');
    const colorInput = document.getElementById('custom-accent-input');
    let hex = (textInput ? textInput.value : '') || (colorInput ? colorInput.value : '');
    if (!hex) {
        showToast('请输入或选择强调色', 'warning', 3000);
        return;
    }
    if (!/^#?[0-9a-fA-F]{6}$/.test(hex.replace('#', '')) && !/^#?[0-9a-fA-F]{3}$/.test(hex.replace('#', ''))) {
        showToast('请输入有效的十六进制颜色（如 #3b82f6）', 'error', 3000);
        return;
    }
    if (!hex.startsWith('#')) hex = '#' + hex;
    const paletteKey = 'custom:' + hex;
    settings.customAccent = hex;
    settings.themePalette = paletteKey;
    applyThemePalette(paletteKey);
    _highlightActivePalette(paletteKey);
    saveData();
}

// 自定义强调色输入框同步（color picker 与 text input 联动）
function syncCustomAccentInputs(source) {
    const colorInput = document.getElementById('custom-accent-input');
    const textInput = document.getElementById('custom-accent-text');
    if (source === 'color' && colorInput && textInput) {
        textInput.value = colorInput.value;
    } else if (source === 'text' && textInput && colorInput) {
        if (/^#?[0-9a-fA-F]{6}$/.test(textInput.value.replace('#', ''))) {
            colorInput.value = textInput.value.startsWith('#') ? textInput.value : '#' + textInput.value;
        }
    }
}

function generatePalettePreview() {
    if (!settings.bgImage) {
        showToast('请先上传背景图片', 'warning', 3000);
        return;
    }
    showToast('正在提取主题色...', 'info', 2000);
    extractThemePalettes(settings.bgImage, function(palettes) {
        if (!palettes) {
            showToast('主题色提取失败，请检查背景图', 'error', 3000);
            return;
        }
        settings.themePaletteColors = palettes;
        const container = document.getElementById('palette-preview-container');
        const hint = document.getElementById('palette-hint-text');
        if (container) container.classList.remove('hidden');
        if (hint) hint.classList.remove('hidden');
        _renderPalettePreviews(palettes);
        showToast('调色板提取成功，请选择风格', 'success', 2000);
    });
}

// 重新生成调色板（带随机扰动，结果会有小幅变化）
function regeneratePalettePreview() {
    if (!settings.bgImage) {
        showToast('请先上传背景图片', 'warning', 3000);
        return;
    }
    const btn = document.getElementById('palette-regenerate-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>生成中...';
    }
    extractThemePalettes(settings.bgImage, function(palettes) {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-dice mr-1"></i>重新生成配色';
        }
        if (!palettes) {
            showToast('调色板重新生成失败', 'error', 3000);
            return;
        }
        settings.themePaletteColors = palettes;
        _renderPalettePreviews(palettes);
        // 若当前已选中某套调色板，自动应用新版本
        if (settings.themePalette && settings.themePalette !== 'none') {
            applyThemePalette(settings.themePalette);
        }
        showToast('已生成新调色板', 'success', 2000);
    }, { randomPerturb: true });
}

function selectThemePalette(name) {
    settings.themePalette = name;
    applyThemePalette(name);
    _highlightActivePalette(name);
    saveData();
    // 切换调色板时不弹 toast，避免遮挡主视图预览效果
}

// ==================== 按住预览调色板（不保存） ====================
// 交互：短按（<300ms）= 保存应用；长按 = 预览（隐藏设置面板），松开恢复
let _palettePreviewSaved = null;  // 预览前状态：null 表示当前未在预览
let _palettePreviewActiveName = null;  // 当前预览的调色板名
let _palettePreviewDownTime = 0;  // mousedown 时间戳，用于区分短按/长按
let _palettePreviewLongPress = false;  // 是否已进入长按预览状态（已隐藏设置面板）
let _palettePreviewLongPressTimer = null;  // 长按判定定时器
const PALETTE_PREVIEW_CLICK_THRESHOLD = 300;

// 全局 mouseup 监听：长按预览状态下，鼠标在面板外松开也能正确恢复
document.addEventListener('mouseup', function(e) {
    if (_palettePreviewSaved !== null || _palettePreviewLongPress) {
        endPalettePreview(_palettePreviewActiveName);
    }
});

// 鼠标按下：仅启动长按判定定时器，不立即应用调色板。
// 按下即应用会改变 CSS 变量，在有背景图/大数据量时引发毛玻璃重排与瞬时 mouseleave，
// 进而干扰短按判定。改为：短按由 onclick 应用，长按由定时器在阈值后应用。
function startPalettePreview(name) {
    _palettePreviewLongPress = false;
    _palettePreviewActiveName = name;
    if (_palettePreviewSaved === null) {
        _palettePreviewSaved = settings.themePalette || 'none';
    }
    clearTimeout(_palettePreviewLongPressTimer);
    _palettePreviewLongPressTimer = setTimeout(() => {
        const palette = resolvePaletteObject(name);
        if (!palette) return;
        _palettePreviewLongPress = true;
        applyPaletteToCssVars(palette);
        _highlightActivePalette(name);
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.add('hidden');
    }, PALETTE_PREVIEW_CLICK_THRESHOLD);
}

// 单击配色卡片：由 onclick 触发，可靠应用（与 mouseleave/响应时间完全无关）。
// 长按预览结束时设置面板处于 hidden(display:none)，mouseup/click 不会命中卡片，
// 故长按后不会误触发此处，无需额外抑制。
function onPaletteCardClick(name) {
    selectThemePalette(name);
}

// 鼠标松开：长按预览恢复原配色；短按不在此应用（交由后续 onclick 应用）
function endPalettePreview(name) {
    clearTimeout(_palettePreviewLongPressTimer);
    if (_palettePreviewLongPress) {
        const saved = _palettePreviewSaved;
        _palettePreviewSaved = null;
        _palettePreviewActiveName = null;
        _palettePreviewLongPress = false;
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.remove('hidden');
        applyThemePalette(saved);
        _highlightActivePalette(settings.themePalette || 'none');
    } else {
        _palettePreviewSaved = null;
        _palettePreviewActiveName = null;
    }
}

// 鼠标离开：取消长按判定定时器（不影响 onclick 的应用）
function cancelPalettePreview() {
    if (_palettePreviewLongPress) return; // 长按预览中，忽略
    clearTimeout(_palettePreviewLongPressTimer);
    _palettePreviewSaved = null;
    _palettePreviewActiveName = null;
}

// ==================== 节假日数据抓取 ====================
async function fetchHolidayData() {
    const yearInput = document.getElementById('settings-holiday-fetch-year');
    const apiInput = document.getElementById('settings-holiday-api-url');
    const btn = document.getElementById('holiday-fetch-btn');
    if (!yearInput || !btn) return;

    const year = parseInt(yearInput.value) || new Date().getFullYear();
    const apiUrl = apiInput ? apiInput.value.trim() : '';

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>抓取中...';

    try {
        const response = await fetch('/api/holiday-fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year: String(year), apiUrl: apiUrl })
        });
        const result = await response.json();
        if (response.ok && result.status === 'ok') {
            // 更新本地 holidayData
            holidayData[String(year)] = result.data;
            // 同步到 localStorage
            try {
                localStorage.setItem('holidayData', JSON.stringify(holidayData));
            } catch (e) { console.error('Cache holiday data error:', e); }
            updateHolidayCountdown();
            const holidayCount = Object.keys(result.data.holidays || {}).length;
            const workdayCount = Object.keys(result.data.workdays || {}).length;
            showToast(year + '年抓取成功：' + holidayCount + '个假日，' + workdayCount + '个调休日', 'success', 5000);
        } else {
            const errMsg = result.error || '抓取失败';
            showToast('节假日抓取失败：' + errMsg, 'error', 6000);
        }
    } catch (err) {
        showToast('网络错误：' + err.message, 'error', 5000);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-download mr-1"></i>立即抓取';
    }
}

init();
