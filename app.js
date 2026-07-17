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
        // 第二次点击：先保存未保存的设置，再执行重启
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
                showToast('网络配置已更改，请点击底部「重启服务」按钮使其生效', 'warning', 8000);
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
}

// 渲染内置配色预览色条（根据当前主题选择 light/dark 变体）
function _renderBuiltinPalettePreviews() {
    const isDark = isDarkThemeActive();
    Object.keys(BUILTIN_PALETTES).forEach(key => {
        const palette = BUILTIN_PALETTES[key];
        const variant = isDark ? palette.dark : palette.light;
        const bar = document.querySelector('.palette-color-bar[data-palette="builtin-' + key + '"]');
        if (bar) {
            bar.innerHTML = '';
            [variant.accent, variant.bgPrimary, variant.bgSecondary, variant.textPrimary, variant.border].forEach(color => {
                const span = document.createElement('span');
                span.style.backgroundColor = color;
                bar.appendChild(span);
            });
        }
    });
}

function _renderPalettePreviews(palettes) {
    ['vibrant', 'muted', 'dark'].forEach(name => {
        const p = palettes[name];
        if (!p) return;
        const bar = document.querySelector('.palette-color-bar[data-palette="' + name + '"]');
        if (bar) {
            bar.innerHTML = '';
            [p.accent, p.bgPrimary, p.bgSecondary, p.textPrimary, p.border].forEach(color => {
                const span = document.createElement('span');
                span.style.backgroundColor = color;
                bar.appendChild(span);
            });
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
    if (_palettePreviewSaved !== null && _palettePreviewActiveName !== null) {
        endPalettePreview(_palettePreviewActiveName);
    }
});

// 鼠标按下：记录时间 + 临时应用调色板（不写 settings）
function startPalettePreview(name) {
    const palette = resolvePaletteObject(name);
    if (!palette) return;
    _palettePreviewDownTime = Date.now();
    _palettePreviewActiveName = name;
    if (_palettePreviewSaved === null) {
        _palettePreviewSaved = settings.themePalette || 'none';
    }
    applyPaletteToCssVars(palette);
    _highlightActivePalette(name);
    // 延迟判定长按：超过阈值则隐藏设置面板进入预览模式
    clearTimeout(_palettePreviewLongPressTimer);
    _palettePreviewLongPressTimer = setTimeout(() => {
        if (_palettePreviewSaved !== null) {
            _palettePreviewLongPress = true;
            const modal = document.getElementById('settings-modal');
            if (modal) modal.classList.add('hidden');
        }
    }, PALETTE_PREVIEW_CLICK_THRESHOLD);
}

// 鼠标松开：短按视为单击 → 保存应用；长按 → 恢复原配色 + 恢复设置面板
function endPalettePreview(name) {
    if (_palettePreviewSaved === null) {
        // 未进入预览状态（如已被 cancelPalettePreview 清空，或 startPalettePreview 未生效）
        // 直接返回，避免长按移出后松开误触发保存
        return;
    }
    clearTimeout(_palettePreviewLongPressTimer);
    const duration = Date.now() - _palettePreviewDownTime;
    const saved = _palettePreviewSaved;
    const wasLongPress = _palettePreviewLongPress;
    _palettePreviewSaved = null;
    _palettePreviewActiveName = null;
    _palettePreviewLongPress = false;
    // 长按预览后，先恢复设置面板
    if (wasLongPress) {
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.remove('hidden');
    }
    if (duration < PALETTE_PREVIEW_CLICK_THRESHOLD) {
        // 短按 = 保存应用
        selectThemePalette(name);
    } else {
        // 长按 = 恢复原配色
        applyThemePalette(saved);
        _highlightActivePalette(settings.themePalette || 'none');
    }
}

// 鼠标离开：仅短按状态下取消（长按预览状态下忽略，由全局mouseup处理）
function cancelPalettePreview() {
    // 长按预览状态下不响应 mouseleave（设置面板已隐藏，鼠标离开是预期行为）
    if (_palettePreviewLongPress) return;
    if (_palettePreviewSaved === null) return;
    clearTimeout(_palettePreviewLongPressTimer);
    const saved = _palettePreviewSaved;
    _palettePreviewSaved = null;
    _palettePreviewActiveName = null;
    applyThemePalette(saved);
    _highlightActivePalette(settings.themePalette || 'none');
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
