async function init() {
    await loadData();
    easterEgg_init();
    applyTheme();
    // 先拉取轮播状态再应用背景图：避免先渲染单张图又立刻换成轮播图造成闪变
    await initBgCarousel();
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
    // 跨天自动刷新侧边栏倒计时（日期变更时重算 days，避免挂着过夜后停在昨天）
    if (typeof startCountdownDayRolloverWatch === 'function') startCountdownDayRolloverWatch();
    applyDisplaySettings();
    await registerUploadedFontOnLoad();
    applyFontFamily();
    applyThemePalette(settings.themePalette || 'none');
    syncPomodoroFromServer();
    startDataRefreshTimer();
    requestNotificationPermission();
    detectPlatform();

    // 首次使用引导：未看过且当前无任务时自动启动
    if (typeof maybeStartOnboarding === 'function') maybeStartOnboarding();
    setInterval(function () {
        checkBrowserNotifications();
        // 背景轮播状态轮询与通知同拍（5s）：switchId 变化时被动应用新图
        checkBgCarouselUpdate();
    }, 5000);

    // 网页模式处理：离线版入口检测是否需要跳转到在线版
    initWebMode();

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshDataFromServer();
            syncPomodoroFromServer();
            checkBrowserNotifications();
            checkBgCarouselUpdate();
            flushPendingNotifications();
        }
    });
}

// ==================== 视图自定义（设置面板） ====================
// 延迟保存：所有操作在临时状态上修改并即时刷新 UI 反馈，点「保存设置」后才应用到 settings 并持久化，
// 点「关闭」则丢弃临时状态（settings 从未被修改，无需回退）。
// 拖拽使用 pointer events 自行实现（pointermove 每帧触发，比 HTML5 drag API 的 dragover 更跟手）。
let _vcClickTimer = null;
let _vcTempOrder = null;  // 临时视图顺序（设置面板打开时创建）
let _vcTempHome = null;   // 临时首页视图
let _vcStyleInjected = false;
let _vcDropHintEl = null;   // 当前显示指示器的元素
let _vcDropHintSide = null; // 当前指示器方向：'before' | 'after'
let _vcPointerDown = null;  // pointerdown 状态：{ id, startX, startY, el }
let _vcDragging = false;    // 是否已进入拖拽模式（移动距离超过阈值后置 true）
let _vcSuppressClick = false; // 拖拽松手后阻止同次操作的 click 事件
let _vcDocListenersBound = false;

// 注入拖拽指示器样式（仅注入一次），颜色跟随主题 --accent-color
function _vcEnsureStyle() {
    if (_vcStyleInjected) return;
    _vcStyleInjected = true;
    const style = document.createElement('style');
    style.textContent =
        '.vc-drop-before{box-shadow:-3px 0 0 0 var(--accent-color,#3b82f6);}' +
        '.vc-drop-after{box-shadow:3px 0 0 0 var(--accent-color,#3b82f6);}';
    document.head.appendChild(style);
}

// 绑定 document 级 pointer 监听器（仅绑定一次），用于拖拽时全局跟踪鼠标
function _vcEnsureDocListeners() {
    if (_vcDocListenersBound) return;
    _vcDocListenersBound = true;
    document.addEventListener('pointermove', _vcDocPointerMove);
    document.addEventListener('pointerup', _vcDocPointerUp);
    document.addEventListener('pointercancel', _vcDocPointerUp);
}

// 清除拖拽指示器
function _vcClearDropHint() {
    if (_vcDropHintEl) {
        _vcDropHintEl.classList.remove('vc-drop-before', 'vc-drop-after');
        _vcDropHintEl = null;
        _vcDropHintSide = null;
    }
}

// 更新指示器到指定 chip 的左/右侧（状态无变化时跳过，避免不必要 DOM 写）
function _vcUpdateDropHint(chip, clientX) {
    if (!chip) { _vcClearDropHint(); return; }
    var rect = chip.getBoundingClientRect();
    var isAfter = (clientX - rect.left) > rect.width / 2;
    var side = isAfter ? 'after' : 'before';
    if (_vcDropHintEl === chip && _vcDropHintSide === side) return;
    _vcClearDropHint();
    chip.classList.add(isAfter ? 'vc-drop-after' : 'vc-drop-before');
    _vcDropHintEl = chip;
    _vcDropHintSide = side;
}

function renderViewCustomize() {
    const enabledBox = document.getElementById('view-customize-enabled');
    const disabledBox = document.getElementById('view-customize-disabled');
    if (!enabledBox || !disabledBox) return;
    _vcEnsureStyle();
    _vcEnsureDocListeners();
    // 清空容器前重置指示器引用（旧 chip 即将脱离 DOM）
    _vcDropHintEl = null;
    _vcDropHintSide = null;
    // 优先读取临时状态（设置面板内），否则读取实际 settings
    const order = _vcTempOrder || getViewOrder();
    const home = _vcTempHome || settings.defaultHomeView;
    enabledBox.innerHTML = '';
    disabledBox.innerHTML = '';
    order.forEach(function (v) {
        const def = VIEW_DEFS[v.id] || { label: v.id };
        const chip = document.createElement('div');
        chip.className = 'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-theme cursor-pointer select-none transition ' +
            (v.enabled ? 'bg-theme text-theme-primary hover:border-accent' : 'bg-theme-secondary text-theme-secondary opacity-70');
        chip.setAttribute('data-vc-id', v.id);
        chip.setAttribute('onclick', "onVCClick('" + v.id + "')");
        if (v.enabled) {
            // 仅已启用视图支持拖拽排序和设首页
            chip.setAttribute('onpointerdown', "onVCPointerDown(event, '" + v.id + "')");
            chip.setAttribute('ondblclick', "onVCDblClick('" + v.id + "')");
        }
        let html = '<span>' + def.label + '</span>';
        // 首页标识：仅保留小房子图标，去掉「首页」文字；未启用视图不显示任何右侧图标/提示
        if (v.enabled && v.id === home) {
            html += '<i class="fas fa-home text-accent ml-1"></i>';
        }
        chip.innerHTML = html;
        if (v.enabled) enabledBox.appendChild(chip);
        else disabledBox.appendChild(chip);
    });
}

// 初始化临时视图自定义状态（openSettingsModal 时调用）
function initVCTemp() {
    _vcTempOrder = JSON.parse(JSON.stringify(getViewOrder()));
    _vcTempHome = getHomeView();
}

// 丢弃临时状态（closeSettingsModal 时调用）
function discardVCTemp() {
    _vcTempOrder = null;
    _vcTempHome = null;
}

// 应用临时状态到 settings（saveSettings 时调用）
function applyVCFromTemp() {
    if (!_vcTempOrder) return;
    settings.viewOrder = _vcTempOrder;
    settings.defaultHomeView = _vcTempHome;
    settings.defaultView = _vcTempHome;
    _vcTempOrder = null;
    _vcTempHome = null;
}

// 临时状态上的视图启用/禁用（含「至少保留一个」校验 + 首页自动迁移）
function _vcSetViewEnabled(id, enabled) {
    const item = _vcTempOrder.find(function (v) { return v.id === id; });
    if (!item) return false;
    item.enabled = enabled;
    if (!_vcTempOrder.some(function (v) { return v.enabled; })) {
        item.enabled = !enabled; // 撤销：至少保留一个启用视图
        showToast('至少需保留一个视图', 'warning');
        return false;
    }
    if (!enabled && _vcTempHome === id) {
        const first = _vcTempOrder.find(function (v) { return v.enabled; });
        if (first) _vcTempHome = first.id;
    }
    return true;
}

// pointerdown：记录起始位置，不立即进入拖拽模式（等待移动距离超过阈值）
function onVCPointerDown(e, id) {
    if (e.button !== 0) return; // 仅响应主键
    _vcPointerDown = { id: id, startX: e.clientX, startY: e.clientY, el: e.currentTarget };
    _vcDragging = false;
}

// document 级 pointermove：移动距离超过阈值后进入拖拽模式，用 elementFromPoint 定位目标 chip
function _vcDocPointerMove(e) {
    if (!_vcPointerDown) return;
    var dx = e.clientX - _vcPointerDown.startX;
    var dy = e.clientY - _vcPointerDown.startY;
    if (!_vcDragging) {
        // 移动距离超过 5px 才进入拖拽模式（避免点击误触）
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        _vcDragging = true;
        _vcPointerDown.el.style.opacity = '0.4'; // 被拖拽的 chip 变半透明
    }
    // 临时禁用被拖拽 chip 的 pointer-events，让 elementFromPoint 能穿透到下方元素
    _vcPointerDown.el.style.pointerEvents = 'none';
    var target = document.elementFromPoint(e.clientX, e.clientY);
    _vcPointerDown.el.style.pointerEvents = '';
    var chip = target ? target.closest('[data-vc-id]') : null;
    // 仅在「已启用视图」容器内才显示指示器（排除被拖拽的自身）
    if (chip && chip !== _vcPointerDown.el && chip.parentElement && chip.parentElement.id === 'view-customize-enabled') {
        _vcUpdateDropHint(chip, e.clientX);
    } else {
        _vcClearDropHint();
    }
}

// document 级 pointerup：拖拽模式下执行排序，否则放行 click
function _vcDocPointerUp(e) {
    if (!_vcPointerDown) return;
    if (_vcDragging) {
        // 找到松手位置下方的目标 chip
        _vcPointerDown.el.style.pointerEvents = 'none';
        var target = document.elementFromPoint(e.clientX, e.clientY);
        _vcPointerDown.el.style.pointerEvents = '';
        var chip = target ? target.closest('[data-vc-id]') : null;
        if (chip && chip !== _vcPointerDown.el && chip.parentElement && chip.parentElement.id === 'view-customize-enabled') {
            _vcPerformReorder(_vcPointerDown.id, chip.getAttribute('data-vc-id'), e.clientX);
        }
        _vcPointerDown.el.style.opacity = '';
        // 阻止本次操作产生的 click 事件（避免拖拽后误触发启用/禁用）
        _vcSuppressClick = true;
    }
    _vcPointerDown = null;
    _vcDragging = false;
    _vcClearDropHint();
}

// 执行排序：将 fromId 移动到 toId 的前面或后面（取决于鼠标水平位置）
function _vcPerformReorder(fromId, toId, clientX) {
    var from = _vcTempOrder.findIndex(function (v) { return v.id === fromId; });
    var to = _vcTempOrder.findIndex(function (v) { return v.id === toId; });
    if (from < 0 || to < 0) return;
    var chip = document.querySelector('#view-customize-enabled > [data-vc-id="' + toId + '"]');
    var rect = chip.getBoundingClientRect();
    var isAfter = (clientX - rect.left) > rect.width / 2;
    var moved = _vcTempOrder.splice(from, 1)[0];
    var insertAt;
    if (from < to) {
        insertAt = isAfter ? to : to - 1; // from 在前，删除后 to 已前移 1
    } else {
        insertAt = isAfter ? to + 1 : to;  // from 在后，删除后 to 不变
    }
    _vcTempOrder.splice(insertAt, 0, moved);
    // 延迟保存：即时刷新 UI 反馈，但不写入 settings
    renderViewCustomize();
}

function onVCClick(id) {
    // 拖拽松手后的同次操作不触发 click
    if (_vcSuppressClick) { _vcSuppressClick = false; return; }
    // 防抖区分单击（启用/禁用）与双击（设首页）
    if (_vcClickTimer) { clearTimeout(_vcClickTimer); _vcClickTimer = null; }
    _vcClickTimer = setTimeout(function () {
        _vcClickTimer = null;
        const item = _vcTempOrder.find(function (v) { return v.id === id; });
        if (!item) return;
        if (item.enabled) {
            _vcSetViewEnabled(id, false);
        } else {
            _vcSetViewEnabled(id, true);
        }
        // 延迟保存：即时刷新 UI 反馈，但不写入 settings（点「保存设置」才生效）
        renderViewCustomize();
    }, 220);
}

function onVCDblClick(id) {
    if (_vcClickTimer) { clearTimeout(_vcClickTimer); _vcClickTimer = null; }
    const item = _vcTempOrder.find(function (v) { return v.id === id; });
    if (!item) return;
    if (item.enabled) {
        _vcTempHome = id; // 已启用：设为首页
    } else {
        _vcSetViewEnabled(id, true); // 可添加：双击亦可启用
    }
    // 延迟保存：即时刷新 UI 反馈，但不写入 settings
    renderViewCustomize();
}

// ==================== 侧边栏清单配置（设置面板） ====================
// 与「新建任务默认值」等配置项一致：打开面板时回填，点「保存设置」时才写入 settings
const SIDEBAR_ITEM_SETTING_IDS = {
    allTasks: 'settings-sidebar-all-tasks',
    today: 'settings-sidebar-today',
    tomorrow: 'settings-sidebar-tomorrow',
    recent3days: 'settings-sidebar-recent3days',
    recent7days: 'settings-sidebar-recent7days',
    summary: 'settings-sidebar-summary',
    tags: 'settings-sidebar-tags',
    filters: 'settings-sidebar-filters'
};

function _sidebarItemDefaultOf(key) {
    const def = (typeof SIDEBAR_ITEM_DEFAULTS === 'object' && SIDEBAR_ITEM_DEFAULTS) ? SIDEBAR_ITEM_DEFAULTS : {};
    return def[key] || 'show';
}

function loadSidebarItemsSettings() {
    const cfg = settings.sidebarItems || {};
    Object.keys(SIDEBAR_ITEM_SETTING_IDS).forEach(function (key) {
        const el = document.getElementById(SIDEBAR_ITEM_SETTING_IDS[key]);
        if (!el) return;
        const v = cfg[key];
        el.value = (v === 'show' || v === 'auto' || v === 'hide') ? v : _sidebarItemDefaultOf(key);
    });
}

function saveSidebarItemsSettings() {
    const cfg = {};
    Object.keys(SIDEBAR_ITEM_SETTING_IDS).forEach(function (key) {
        const el = document.getElementById(SIDEBAR_ITEM_SETTING_IDS[key]);
        if (!el) return;
        cfg[key] = (el.value === 'show' || el.value === 'auto' || el.value === 'hide')
            ? el.value : _sidebarItemDefaultOf(key);
    });
    settings.sidebarItems = cfg;
}

function openSettingsModal() {
    document.getElementById('settings-default-list').value = settings.defaultListId || 'default';
    document.getElementById('settings-default-important').checked = settings.defaultImportant || false;
    document.getElementById('settings-default-urgent').checked = settings.defaultUrgent || false;
    document.getElementById('settings-default-duration').value = settings.defaultDuration !== undefined ? settings.defaultDuration : 30;
    document.getElementById('settings-week-start').value = settings.weekStart || 'monday';
    document.getElementById('settings-show-holiday-countdown').checked = settings.showHolidayCountdown !== false;
    document.getElementById('settings-show-sidebar-extras').checked = settings.showSidebarExtras !== false;
    document.getElementById('settings-easter-egg').checked = settings.easterEggEnabled !== false;
    document.getElementById('settings-cmd-remove-time').checked = settings.cmdRemoveTimeText !== false;
    document.getElementById('settings-priority-display-mode').value = getPriorityDisplayMode();
    // 注：原「全局默认」（显示已完成/农历/专注按钮/无日期位置）已移至各视图配置面板，
    // 旧数据由 applySettings 内的迁移逻辑无感升级到各视图配置
    document.getElementById('settings-default-task-date').value = settings.defaultTaskDate || 'today';
    loadSidebarItemsSettings();
    document.getElementById('settings-focus-duration').value = settings.focusDuration || 25;
    document.getElementById('settings-short-break-duration').value = settings.shortBreakDuration || 5;
    document.getElementById('settings-long-break-duration').value = settings.longBreakDuration || 15;
    document.getElementById('settings-long-break-interval').value = settings.longBreakInterval || 4;
    document.getElementById('settings-auto-break').checked = settings.autoBreak || false;
    document.getElementById('settings-auto-focus').checked = settings.autoFocus || false;
    document.getElementById('settings-pomodoro-state-bg').checked = settings.pomodoroStateBg !== false;
    document.getElementById('settings-pomodoro-sound').checked = settings.pomodoroSound !== false;
    document.getElementById('settings-bg-flow-effect').checked = settings.bgFlowEffect === true;
    document.getElementById('settings-advanced-particle').checked = settings.advancedParticleAnimation !== false;
    document.getElementById('settings-smooth-animations').checked = settings.smoothAnimations === true;
    document.getElementById('settings-feature-animations').checked = settings.featureAnimations === true;
    document.getElementById('settings-auto-create').checked = settings.autoCreateTask !== false;
    document.getElementById('settings-toast-duration').value = settings.toastDuration || 5;
    document.getElementById('settings-snooze-delay').value = settings.snoozeDelay || 15;
    document.getElementById('settings-refresh-interval').value = settings.refreshInterval || 30;
    // 外部日历开关（仅离线版设置面板含此元素）
    const _showExtCalEl = document.getElementById('settings-show-external-calendars');
    if (_showExtCalEl) _showExtCalEl.checked = settings.showExternalCalendars !== false;
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

    // 初始化背景图模式 Tab / 轮播设置区回填 / 填充方式（目录轮播 PRD 4.2/4.3）
    updateBgImageModeTabs();
    updateBgFillModeButtons();
    updateBgCarouselStatusUI();

    updateSettingsListSelect();
    initVCTemp();
    renderViewCustomize();
    updateThemeButtons();
    
    // 初始化快捷键设置
    if (typeof renderShortcutsSettings === 'function') {
        renderShortcutsSettings();
    }

    // 页面切换过渡动画：中性浮现（fx-feature 开启时播放，与番茄专注等页面共用开关）
    _fxOpenModal('settings-modal');

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
    // 丢弃视图自定义临时状态（未保存的修改不生效）
    discardVCTemp();
    // 页面切换过渡动画：反向收起后再隐藏
    _fxCloseModal('settings-modal');
}

// ==================== 背景图目录轮播（设置面板 UI） ====================
// 文档：《背景图目录自动轮播功能 PRD 需求说明书.md》4（用户界面）/ 6（边界处理）
// 轮播配置全部由服务端持有并持久化（bg_carousel.json），此处仅乐观切换 + 提交 + 回填。
const BG_EXTRACTED_PALETTE_KEYS = ['vibrant', 'muted', 'steady'];

// Tab 视觉与区块显隐（mode 缺省时按服务端状态推导）
function updateBgImageModeTabs(mode) {
    if (!mode) mode = (bgCarouselState && bgCarouselState.enabled) ? 'carousel' : 'single';
    const singleBtn = document.getElementById('bg-mode-single-btn');
    const carouselBtn = document.getElementById('bg-mode-carousel-btn');
    const singleSection = document.getElementById('bg-single-section');
    const carouselSection = document.getElementById('bg-carousel-section');
    if (!singleBtn || !carouselBtn || !singleSection || !carouselSection) return;
    const isCarousel = mode === 'carousel';
    _setBgModeTabActive(singleBtn, !isCarousel);
    _setBgModeTabActive(carouselBtn, isCarousel);
    singleSection.classList.toggle('hidden', isCarousel);
    carouselSection.classList.toggle('hidden', !isCarousel);
}

function _setBgModeTabActive(btn, active) {
    if (active) {
        btn.classList.add('border-accent', 'bg-accent-soft', 'text-accent-dark');
        btn.classList.remove('border-theme', 'text-theme-secondary', 'hover:bg-theme-secondary');
    } else {
        btn.classList.remove('border-accent', 'bg-accent-soft', 'text-accent-dark');
        btn.classList.add('border-theme', 'text-theme-secondary', 'hover:bg-theme-secondary');
    }
}

// Tab 点击：先乐观切换外观，POST 响应后由服务端真实状态纠正（服务端不可用/目录无效则回退）
function switchBgImageMode(mode) {
    const enable = mode === 'carousel';
    updateBgImageModeTabs(enable ? 'carousel' : 'single');
    bgCarouselUpdateConfig({ enabled: enable }).then(state => {
        if (!state || state.success === false) {
            updateBgImageModeTabs();
            return;
        }
        // 切回单张模式：按单张背景图重新取色并自适应深浅（与换图口径一致，PRD 5.3）
        if (!enable && settings.bgImage) {
            _resyncPaletteForBgSrc(settings.bgImage);
        }
    });
}

// 按指定背景图重新取色：更新 themePaletteColors + 深浅模式自适应；
// 当前为背景图取色方案时沿用同一风格重应用（切回单张模式时使用）
function _resyncPaletteForBgSrc(src) {
    if (!src) return;
    extractThemePalettes(src, function (palettes) {
        if (!palettes) return;
        settings.themePaletteColors = palettes;
        const brightness = (typeof palettes._brightness === 'number') ? palettes._brightness : bgImageBrightness;
        const detectedTheme = brightness < 0.45 ? 'dark' : 'light';
        if (settings.theme !== detectedTheme) {
            setTheme(detectedTheme);
        }
        if (BG_EXTRACTED_PALETTE_KEYS.indexOf(settings.themePalette) !== -1) {
            applyThemePalette(settings.themePalette);
            const container = document.getElementById('palette-preview-container');
            if (container && !container.classList.contains('hidden') && typeof _renderPalettePreviews === 'function') {
                _renderPalettePreviews(palettes);
            }
        }
        saveData();
    });
}

// 轮播设置区状态刷新（轮询/配置响应后调用，幂等）。
// 输入框聚焦时不覆盖用户正在输入的值，避免 5s 轮询打断编辑。
function updateBgCarouselStatusUI() {
    if (!document.getElementById('bg-mode-carousel-btn')) return;
    updateBgImageModeTabs();
    const state = bgCarouselState || {};
    const dirInput = document.getElementById('bg-carousel-directory-input');
    if (dirInput && document.activeElement !== dirInput) dirInput.value = state.directory || '';
    const intervalInput = document.getElementById('bg-carousel-interval-input');
    if (intervalInput && document.activeElement !== intervalInput) intervalInput.value = state.interval || 30;
    const unitSel = document.getElementById('bg-carousel-interval-unit');
    if (unitSel && document.activeElement !== unitSel) unitSel.value = state.intervalUnit || 'minutes';
    const orderSel = document.getElementById('bg-carousel-order-select');
    if (orderSel && document.activeElement !== orderSel) orderSel.value = state.order || 'sequential';

    // 当前状态卡：缩略图 + 文件名 + 张数/顺序/下次切换倒计时
    const statusCard = document.getElementById('bg-carousel-status');
    const emptyHint = document.getElementById('bg-carousel-empty-hint');
    if (state.enabled && state.currentFile) {
        if (statusCard) {
            statusCard.classList.remove('hidden');
            const thumb = document.getElementById('bg-carousel-thumb');
            const imgSrc = '/api/bg-carousel/image?v=' + state.switchId;
            if (thumb && thumb.getAttribute('src') !== imgSrc) thumb.src = imgSrc;
            const nameEl = document.getElementById('bg-carousel-filename');
            if (nameEl) nameEl.textContent = state.currentFile;
            const metaEl = document.getElementById('bg-carousel-meta');
            if (metaEl) {
                const parts = [(state.imageCount || 0) + ' 张'];
                parts.push(state.order === 'random' ? '随机' : '顺序');
                const remain = _bgCarouselRemainSeconds(state);
                if (remain !== null) parts.push(_bgCarouselFormatCountdown(remain) + '后切换');
                metaEl.textContent = parts.join(' · ');
            }
        }
        if (emptyHint) emptyHint.classList.add('hidden');
    } else {
        if (statusCard) statusCard.classList.add('hidden');
        if (emptyHint) emptyHint.classList.remove('hidden');
    }

    // 固定配色 + 轮播：低对比度图可读性风险提示（PRD 6）
    const warn = document.getElementById('bg-carousel-contrast-warning');
    if (warn) {
        const usingExtracted = BG_EXTRACTED_PALETTE_KEYS.indexOf(settings.themePalette) !== -1;
        warn.classList.toggle('hidden', !(state.enabled && !usingExtracted));
    }
}

function _bgCarouselRemainSeconds(state) {
    const nextAt = parseFloat(state && state.nextSwitchAt);
    if (!isFinite(nextAt) || nextAt <= 0) return null;
    return Math.max(0, Math.round(nextAt - Date.now() / 1000));
}

function _bgCarouselFormatCountdown(sec) {
    if (sec < 60) return sec + ' 秒';
    if (sec < 3600) return Math.floor(sec / 60) + ' 分钟';
    if (sec < 86400) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return m ? (h + ' 小时 ' + m + ' 分') : (h + ' 小时');
    }
    const d = Math.floor(sec / 86400);
    const h2 = Math.floor((sec % 86400) / 3600);
    return h2 ? (d + ' 天 ' + h2 + ' 小时') : (d + ' 天');
}

// 目录输入框 change/回车提交（目录无效时服务端拒绝并提示，状态回填为原值）
function applyBgCarouselDirectory(value) {
    const dir = (value || '').trim();
    if (!dir) {
        showToast('请输入或选择图片目录', 'warning', 3000);
        return;
    }
    bgCarouselUpdateConfig({ directory: dir }).then(state => {
        if (state && state.success !== false) {
            showToast('轮播目录已更新', 'success', 2000);
        }
    });
}

// 「选择目录」：优先服务端系统对话框（tkinter / Qt / zenity 等）；
// 服务端没有可用的图形对话框时（Linux 缺 python3-tk、无图形会话等），
// 自动降级到内置目录浏览器——保证该按钮在任何环境下都能用。
async function bgCarouselSelectDirectory() {
    const btn = document.getElementById('bg-carousel-pick-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>选择中...';
    }
    try {
        const result = await bgCarouselPickDirectory();
        if (result && result.success && result.path) {
            const dirInput = document.getElementById('bg-carousel-directory-input');
            if (dirInput) dirInput.value = result.path;
            const state = await bgCarouselUpdateConfig({ directory: result.path });
            if (state && state.success !== false) showToast('轮播目录已更新', 'success', 2000);
        } else if (result && (result.reason === 'unavailable' || result.reason === 'error')) {
            showToast(result.message || (result.reason === 'error'
                ? '系统目录对话框调用失败，已切换为内置浏览器'
                : '当前系统没有可用的目录选择对话框，已切换为内置浏览器'), 'info', 4000);
            const dirInput = document.getElementById('bg-carousel-directory-input');
            openBgDirBrowser(dirInput ? dirInput.value.trim() : '');
        } else if (result && result.success === false) {
            showToast('未选择目录', 'info', 2000);
        }
    } catch (e) {
        showToast('目录选择服务不可用', 'error', 3000);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-folder-open mr-2"></i>选择目录';
        }
    }
}

// ==================== 内置目录浏览器（零依赖兜底） ====================
// 只列服务端目录下的子目录，不需要任何系统图形组件，Linux 上一定能用。
let _dirBrowserState = { path: '', parent: '', shortcuts: [], entries: [] };
let _dirBrowserSeq = 0;      // 请求序号：丢弃过期响应，避免慢请求覆盖新结果
let _dirBrowserBound = false;

function openBgDirBrowser(startPath) {
    const modal = document.getElementById('bg-dir-browser-modal');
    if (!modal) return;
    if (!_dirBrowserBound) {
        const list = document.getElementById('bg-dir-browser-list');
        if (list) {
            list.addEventListener('click', e => {
                const row = e.target.closest('[data-dir-path]');
                if (row) _dirBrowserLoad(row.getAttribute('data-dir-path'));
            });
        }
        const shortcuts = document.getElementById('bg-dir-browser-shortcuts');
        if (shortcuts) {
            shortcuts.addEventListener('click', e => {
                const chip = e.target.closest('[data-dir-path]');
                if (chip) _dirBrowserLoad(chip.getAttribute('data-dir-path'));
            });
        }
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            const m = document.getElementById('bg-dir-browser-modal');
            if (m && !m.classList.contains('hidden')) closeBgDirBrowser();
        });
        _dirBrowserBound = true;
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    _dirBrowserLoad(startPath || '', true);
}

function closeBgDirBrowser() {
    const modal = document.getElementById('bg-dir-browser-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// 确认：把当前所在目录写入轮播配置
async function bgDirBrowserConfirm() {
    const path = _dirBrowserState.path;
    if (!path) {
        showToast('请先进入一个目录', 'warning', 2500);
        return;
    }
    const dirInput = document.getElementById('bg-carousel-directory-input');
    if (dirInput) dirInput.value = path;
    closeBgDirBrowser();
    const state = await bgCarouselUpdateConfig({ directory: path });
    if (state && state.success !== false) showToast('轮播目录已更新', 'success', 2000);
}

function _dirBrowserStatus(text) {
    const el = document.getElementById('bg-dir-browser-status');
    if (!el) return;
    if (text) {
        el.textContent = text;
        el.classList.remove('hidden');
    } else {
        el.textContent = '';
        el.classList.add('hidden');
    }
}

function _dirBrowserLoad(path, allowFallback) {
    const seq = ++_dirBrowserSeq;
    _dirBrowserStatus('加载中…');
    bgCarouselBrowseDirectory(path).then(state => {
        if (seq !== _dirBrowserSeq) return;
        if (!state || state.success === false) {
            // 首次带路径进来且该路径不可用：退回主目录，别让用户一进来就是死路
            if (allowFallback) {
                showToast((state && state.message) || '该目录不可用，已回到主目录', 'warning', 3000);
                _dirBrowserLoad('', false);
                return;
            }
            _dirBrowserStatus((state && state.message) || '无法读取该目录');
            _dirBrowserRender({ path: path || '', parent: '', shortcuts: [], entries: [] });
            return;
        }
        _dirBrowserState = state;
        _dirBrowserStatus('');
        _dirBrowserRender(state);
    }).catch(() => {
        if (seq !== _dirBrowserSeq) return;
        _dirBrowserStatus('服务端不可用');
    });
}

function _dirBrowserRender(state) {
    const pathInput = document.getElementById('bg-dir-browser-path');
    if (pathInput) pathInput.value = state.path || '';

    const shortcuts = document.getElementById('bg-dir-browser-shortcuts');
    if (shortcuts) {
        shortcuts.innerHTML = (state.shortcuts || []).map(s =>
            '<button type="button" data-dir-path="' + escapeHtml(s.path) + '" ' +
            'class="px-2 py-1 text-xs rounded-md border border-theme bg-theme-tertiary ' +
            'text-theme-secondary hover:border-accent hover:text-accent-dark transition">' +
            escapeHtml(s.name) + '</button>'
        ).join('');
    }

    const list = document.getElementById('bg-dir-browser-list');
    if (!list) return;
    const rows = [];
    if (state.parent) {
        rows.push('<div data-dir-path="' + escapeHtml(state.parent) + '" ' +
            'class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-theme-tertiary text-theme-secondary">' +
            '<i class="fas fa-level-up-alt w-4 text-center"></i><span class="text-sm">返回上一级</span></div>');
    }
    (state.entries || []).forEach(e => {
        rows.push('<div data-dir-path="' + escapeHtml(e.path) + '" ' +
            'class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-theme-tertiary text-theme-primary">' +
            '<i class="fas fa-folder w-4 text-center text-amber-500"></i>' +
            '<span class="text-sm truncate">' + escapeHtml(e.name) + '</span></div>');
    });
    if (!rows.length) {
        rows.push('<p class="px-3 py-8 text-center text-sm text-theme-muted">该目录下没有子目录，可直接选择此目录</p>');
    }
    list.innerHTML = rows.join('');
    list.scrollTop = 0;
}

// 切换间隔（数字 + 单位）：变更后以新间隔重启节奏（clamp 与服务端一致 1..365）
function onBgCarouselIntervalChange() {
    const input = document.getElementById('bg-carousel-interval-input');
    const unitSel = document.getElementById('bg-carousel-interval-unit');
    if (!input || !unitSel) return;
    let val = parseInt(input.value, 10);
    if (!isFinite(val) || val < 1) val = 1;
    if (val > 365) val = 365;
    input.value = val;
    bgCarouselUpdateConfig({ interval: val, intervalUnit: unitSel.value });
}

function onBgCarouselOrderChange() {
    const sel = document.getElementById('bg-carousel-order-select');
    if (!sel) return;
    bgCarouselUpdateConfig({ order: sel.value });
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
    settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    quadrantOrder = ['urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important'];
    saveDataImmediate();
    // 背景轮播配置独立持久化于服务端 bg_carousel.json（不随 data.json 重置），
    // 需单独通知服务端整体还原默认，否则重置后轮播背景图依旧生效
    fetch('/api/bg-carousel/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true })
    }).catch(() => {});
    // 本地轮播缓存同步清空，让背景立即回退默认（页面稍后自动刷新兜底）
    bgCarouselState = null;
    _bgCarouselAppliedKey = null;
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
    // 轮播缓存已清空 + settings.bgImage 已还原默认：立即重算生效背景，
    // 避免 500ms 后刷新前页面仍显示旧轮播图
    applyBackgroundImage();
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
    settings.weekStart = document.getElementById('settings-week-start').value;
    settings.showHolidayCountdown = document.getElementById('settings-show-holiday-countdown').checked;
    settings.showSidebarExtras = document.getElementById('settings-show-sidebar-extras').checked;
    settings.easterEggEnabled = document.getElementById('settings-easter-egg').checked;
    settings.cmdRemoveTimeText = document.getElementById('settings-cmd-remove-time').checked;
    settings.priorityDisplayMode = document.getElementById('settings-priority-display-mode').value;
    // 注：原「全局默认」4 项已移至各视图配置面板，此处不再读写
    settings.defaultTaskDate = document.getElementById('settings-default-task-date').value;
    saveSidebarItemsSettings();
    settings.focusDuration = parseInt(document.getElementById('settings-focus-duration').value);
    settings.shortBreakDuration = parseInt(document.getElementById('settings-short-break-duration').value);
    settings.longBreakDuration = parseInt(document.getElementById('settings-long-break-duration').value);
    settings.longBreakInterval = parseInt(document.getElementById('settings-long-break-interval').value);
    settings.autoBreak = document.getElementById('settings-auto-break').checked;
    settings.autoFocus = document.getElementById('settings-auto-focus').checked;
    settings.pomodoroStateBg = document.getElementById('settings-pomodoro-state-bg').checked;
    settings.pomodoroSound = document.getElementById('settings-pomodoro-sound').checked;
    settings.bgFlowEffect = document.getElementById('settings-bg-flow-effect').checked;
    settings.advancedParticleAnimation = document.getElementById('settings-advanced-particle').checked;
    settings.smoothAnimations = document.getElementById('settings-smooth-animations').checked;
    settings.featureAnimations = document.getElementById('settings-feature-animations').checked;
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
    // bgFillMode 由 setBgFillMode 即时写入 settings，此处仅随整体设置持久化，无需再读控件
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
    
    // 应用视图自定义临时状态（完全延迟保存：点保存时才生效）
    applyVCFromTemp();
    saveData();
    startDataRefreshTimer();

    // 刷新番茄状态背景色（开关变更后立即生效）
    if (typeof updateMainContentBackground === 'function') {
        updateMainContentBackground();
    }

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
    // 侧边栏清单配置：若当前激活项被隐藏（或「有内容时显示」但无内容），自动切回「所有任务」
    if (typeof redirectIfActiveSidebarItemHidden === 'function') redirectIfActiveSidebarItemHidden();
    renderView();
    updateViewButtons();
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

    // 侧边栏清单配置：固定项（所有任务/今天/明天/最近3天/最近7天/摘要）与分组（标签/过滤器）显隐
    if (typeof applySidebarItemsConfig === 'function') applySidebarItemsConfig();

    // 番茄专注：背景流动效果开关（开启时 body.bg-flow-strong 触发 background-position 强动画）
    document.body.classList.toggle('bg-flow-strong', settings.bgFlowEffect === true);
    // 番茄专注：高级粒子动画开关（关闭时 body.no-particles 隐藏粒子容器并阻止 JS 创建）
    document.body.classList.toggle('no-particles', settings.advancedParticleAnimation === false);
    // 平滑过渡动画开关（开启时 body.fx-smooth 激活界面交互过渡动画）
    document.body.classList.toggle('fx-smooth', settings.smoothAnimations === true);
    // 场景过渡动效开关（开启时 body.fx-feature 激活番茄专注/正念小事/答案之书/设置弹窗的主题化过渡）
    document.body.classList.toggle('fx-feature', settings.featureAnimations === true);
    // 开关切换后刷新视图按钮（激活态高亮在指示条/背景色两种形态间切换）
    if (typeof updateViewButtons === 'function') updateViewButtons();

    // 若番茄页面可见，立即刷新动画以应用新设置
    const pomodoroPage = document.getElementById('pomodoro-page');
    if (pomodoroPage && !pomodoroPage.classList.contains('hidden') && typeof updatePomodoroBackground === 'function') {
        updatePomodoroBackground();
    }
    // 侧栏番茄倒计时背景流动效果同样受开关影响，需立即刷新
    if (typeof updateSidebarPomodoroTimer === 'function') {
        updateSidebarPomodoroTimer();
    }
    // 任务详情面板打开时，同步刷新完成勾选框配色（跟随优先级显示方式变更）
    const detailPanel = document.getElementById('task-detail-panel');
    if (detailPanel && !detailPanel.classList.contains('hidden') && currentDetailTaskId) {
        const task = tasks.find(t => t.id === currentDetailTaskId);
        if (task && typeof updateDetailCompleteButton === 'function') {
            updateDetailCompleteButton(task.completed);
        }
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
    const fxReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fxOn = typeof settings !== 'undefined' && settings.smoothAnimations === true && !fxReducedMotion;
    const prevDate = new Date(currentDate);
    currentDate = new Date();
    // 平滑过渡动画：按各视图特点接管"今天"定位
    if (fxOn && currentView === 'schedule' && scheduleMonthOffset === 0) {
        // 渲染窗口已包含今天：不重渲染，直接平滑滚动到今天卡片（时间轴连续滚动语义）
        const sc = document.querySelector('.schedule-container');
        const todayCard = sc ? sc.querySelector('.schedule-day-drop.ring-2') : null;
        if (todayCard) {
            const cRect = sc.getBoundingClientRect();
            const tRect = todayCard.getBoundingClientRect();
            sc.scrollTo({ top: sc.scrollTop + (tRect.top - cRect.top) - 20, behavior: 'smooth' });
            return;
        }
    }
    if (fxOn && (currentView === 'month' || currentView === 'week')) {
        // 月/周视图：与时间导航一致的方向性滑动（今天在当前展示周期之后 → 旧内容左移、新内容自右滑入）
        let dir = 0;
        if (currentView === 'month') {
            const sameMonth = prevDate.getFullYear() === currentDate.getFullYear() && prevDate.getMonth() === currentDate.getMonth();
            if (!sameMonth) dir = prevDate.getTime() < currentDate.getTime() ? 1 : -1;
        } else {
            const off = settings.weekStart === 'monday' ? 1 : 0;
            const weekStartTs = d => {
                const x = new Date(d);
                x.setDate(x.getDate() - x.getDay() + off);
                if (d.getDay() === 0 && off === 1) x.setDate(x.getDate() - 7);
                return x.getTime();
            };
            const a = weekStartTs(prevDate), b = weekStartTs(currentDate);
            if (a !== b) dir = a < b ? 1 : -1;
        }
        if (dir !== 0) {
            _playCalendarNavTransition(dir, renderView);
            return;
        }
    }
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

    _highlightActivePalette(settings.themePalette || 'none');
    _renderPaletteCardButtons();
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
    const isDark = isDarkThemeActive();
    const fields = ['accent', 'bgPrimary', 'bgSecondary', 'textPrimary', 'textMuted', 'border'];
    ['vibrant', 'muted', 'steady'].forEach(name => {
        // 优先使用用户编辑后的调色板，其次背景图提取的
        const p = (settings.customPalettes && settings.customPalettes[name]) || palettes[name];
        if (!p) return;
        // 双变体结构（{light, dark}）：根据当前主题选择对应变体
        const variant = (p.light && p.dark) ? (isDark ? p.dark : p.light) : p;
        const bar = document.querySelector('.palette-color-bar[data-palette="' + name + '"]');
        if (bar) {
            bar.innerHTML = '';
            fields.forEach(field => {
                const color = variant[field];
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
    'builtin:blue': '星夜',
    'builtin:green': '春野',
    'builtin:amber': '夕照',
    'vibrant': '鲜艳',
    'muted': '柔和',
    'steady': '沉稳'
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
    picker.className = 'fixed z-[10000] bg-theme-primary border-2 border-accent rounded-lg p-3 shadow-2xl';
    picker.style.cssText = 'min-width:200px;';

    // 基于当前颜色生成5个相近预设色
    const presets = _generateRelatedColors(originalColor);

    picker.innerHTML =
        '<div class="text-xs font-semibold text-theme-primary mb-2">编辑' + paletteName + ' · ' + fieldLabel + '</div>' +
        '<div class="flex gap-2 items-center mb-2">' +
            '<input type="color" id="inline-color-input" value="' + originalColor + '" class="w-12 h-9 rounded cursor-pointer border-2 border-theme" style="padding:0;background:transparent;">' +
            '<input type="text" id="inline-hex-input" value="' + originalColor + '" class="flex-1 px-2 py-1.5 text-sm border-2 border-theme rounded bg-theme-tertiary text-theme-primary focus:outline-none focus:border-accent" maxlength="7" spellcheck="false">' +
        '</div>' +
        '<div class="flex gap-1 mb-3">' +
            presets.map(function(c) { return '<div class="preset-color flex-1 h-6 rounded cursor-pointer border border-theme hover:scale-110 transition" style="background-color:' + c + ';" data-color="' + c + '" title="' + c + '"></div>'; }).join('') +
        '</div>' +
        '<div class="flex justify-end gap-2">' +
            '<button id="inline-cancel-btn" class="flex items-center justify-center w-8 h-8 rounded-lg border border-theme text-theme-secondary hover:bg-theme-secondary transition" title="取消"><i class="fas fa-times text-sm"></i></button>' +
            '<button id="inline-save-btn" class="flex items-center justify-center w-8 h-8 rounded-lg bg-accent text-white hover:bg-accent-hover transition" title="保存"><i class="fas fa-check text-sm"></i></button>' +
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
        const variant = isDark ? newPalette.dark : newPalette.light;
        variant[field] = hex;
        // 同步 RGB 字段（写入对应变体）
        if (field === 'bgPrimary') {
            const [r, g, b] = _hexToRgb(hex);
            variant.bgPrimaryRgb = r + ',' + g + ',' + b;
        } else if (field === 'bgSecondary') {
            const [r, g, b] = _hexToRgb(hex);
            variant.bgSecondaryRgb = r + ',' + g + ',' + b;
        } else if (field === 'bgTertiary') {
            const [r, g, b] = _hexToRgb(hex);
            variant.bgTertiaryRgb = r + ',' + g + ',' + b;
        }
    } else {
        // 扁平结构（旧版背景图提取的，迁移后通常不会进入此分支）
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
        _renderPaletteCardButtons();
    } else {
        if (_paletteColorSaveTimer) clearTimeout(_paletteColorSaveTimer);
        _paletteColorSaveTimer = setTimeout(() => {
            saveData();
            _renderPaletteCardButtons();
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
        _renderPaletteCardButtons();
        showToast('已恢复原始配色', 'success', 2000);
    } else {
        showToast('该配色未做编辑', 'info', 2000);
    }
}

// 配色卡片上的操作按钮（撤销编辑 / 按强调色重新派生其他层次）
// - 撤销按钮：该配色存在任意编辑记录时显示（没有编辑就无从撤销）
// - 派生按钮：仅当「强调色」被改过时显示。只改了背景/文字/边框时，用户并没有
//   「按强调色把其余层次对齐」的诉求，此时露出派生按钮只会造成困惑。
function _renderPaletteCardButtons() {
    const paletteKeys = ['builtin:blue', 'builtin:green', 'builtin:amber', 'vibrant', 'muted', 'steady'];
    paletteKeys.forEach(key => {
        const hasEdit = !!(settings.customPalettes && settings.customPalettes[key]);
        const btn = document.querySelector('.palette-reset-btn[data-palette-key="' + key + '"]');
        if (btn) btn.style.display = hasEdit ? '' : 'none';
        const deriveBtn = document.querySelector('.palette-derive-btn[data-palette-key="' + key + '"]');
        if (deriveBtn) {
            const accentEdited = _paletteAccentEdited(key);
            deriveBtn.style.display = accentEdited ? '' : 'none';
            // 强调色与背景层次色相已脱节时高亮提示（用户只改了强调色段、忘了派生其余层次）
            deriveBtn.classList.toggle('palette-derive-suggested', accentEdited && _paletteHueMismatch(key));
        }
    });
}

// 取某配色的「基准」调色板（用户未编辑时的原始值），用于比对强调色是否被改过。
// builtin:xxx → BUILTIN_PALETTES；vibrant/muted/steady → themePaletteColors（背景图提取结果）
function _basePaletteForKey(paletteKey) {
    if (paletteKey.indexOf('builtin:') === 0) return BUILTIN_PALETTES[paletteKey.substring(8)] || null;
    return (settings.themePaletteColors && settings.themePaletteColors[paletteKey]) || null;
}

// 当前主题变体下，强调色是否被用户改过（与基准值不同）。
// 只比当前变体：_applyPaletteColor 只改当前主题那一半，未改过的那半保持原样，
// 此时露出派生按钮点了也不会有变化，属于无效入口。
function _paletteAccentEdited(paletteKey) {
    try {
        if (!settings.customPalettes || !settings.customPalettes[paletteKey]) return false;
        const base = _basePaletteForKey(paletteKey);
        if (!base) return false;
        const isDark = isDarkThemeActive();
        const pick = p => (p && p.light && p.dark) ? (isDark ? p.dark : p.light) : p;
        const cur = pick(settings.customPalettes[paletteKey]);
        const ref = pick(base);
        if (!cur || !ref || !cur.accent || !ref.accent) return false;
        return String(cur.accent).toLowerCase() !== String(ref.accent).toLowerCase();
    } catch (e) {
        return false;
    }
}

// 判断某配色的强调色与背景层次是否「色相脱节」。
// 用户在配色卡上只改强调色段时，hover/背景/文字/边框仍是旧色相，此时应提示可重新派生。
function _paletteHueMismatch(paletteKey) {
    try {
        const palette = resolvePaletteObject(paletteKey);
        if (!palette) return false;
        const isDark = isDarkThemeActive();
        const v = (palette.light && palette.dark) ? (isDark ? palette.dark : palette.light) : palette;
        if (!v || !v.accent || !v.bgTertiary) return false;
        if (!String(v.accent).startsWith('#') || !String(v.bgTertiary).startsWith('#')) return false;
        const [ar, ag, ab] = _hexToRgb(v.accent);
        const [ah, as] = _rgbToHsl(ar, ag, ab);
        if (as < 0.12) return false;   // 无彩色强调色没有可比的色相
        const [br, bg, bb] = _hexToRgb(v.bgTertiary);
        const [bh, bs] = _rgbToHsl(br, bg, bb);
        if (bs < 0.08) return false;   // 背景接近中性灰，不会显得不搭
        let d = Math.abs(ah - bh);
        if (d > 180) d = 360 - d;
        return d > 30;
    } catch (e) {
        return false;
    }
}

// 按当前强调色重新派生该配色的其他层次（各级背景、各级文字、边框、hover 等）。
// 用途：用户只改了强调色段时一键把其余层次对齐到新色相，消除「紫按钮配绿背景」这类脱节。
// 强调色本身原样保留，不会改动用户选定的颜色。
function rederivePaletteLayers(paletteKey) {
    const palette = resolvePaletteObject(paletteKey);
    if (!palette) {
        showToast('未找到该配色', 'warning', 2500);
        return;
    }
    const dual = !!(palette.light && palette.dark);
    const variant = dual ? (isDarkThemeActive() ? palette.dark : palette.light) : palette;
    if (!variant || !variant.accent) {
        showToast('该配色缺少强调色，无法重新派生', 'warning', 3000);
        return;
    }

    const newPalette = JSON.parse(JSON.stringify(palette));
    // 用派生结果覆盖除 accent 外的所有层次，再把 accent 写回用户当前值
    const applyVariant = (target, src, keepAccent) => {
        Object.keys(src).forEach(k => { if (k !== 'accent') target[k] = src[k]; });
        target.accent = keepAccent;
    };
    if (dual) {
        // 浅色/深色两个变体各自按自己的强调色派生，保证切换主题后依然协调
        const la = newPalette.light.accent, da = newPalette.dark.accent;
        const dl = generatePaletteFromAccent(la), dd = generatePaletteFromAccent(da);
        if (!dl || !dd) { showToast('重新派生失败', 'error', 3000); return; }
        applyVariant(newPalette.light, dl.light, la);
        applyVariant(newPalette.dark, dd.dark, da);
    } else {
        const d = generatePaletteFromAccent(newPalette.accent);
        if (!d) { showToast('重新派生失败', 'error', 3000); return; }
        applyVariant(newPalette, d.light, newPalette.accent);
    }

    if (!settings.customPalettes) settings.customPalettes = {};
    settings.customPalettes[paletteKey] = newPalette;
    if (settings.themePalette === paletteKey) applyThemePalette(paletteKey);
    saveData();
    _renderBuiltinPalettePreviews();
    if (settings.themePaletteColors) _renderPalettePreviews(settings.themePaletteColors);
    _renderPaletteCardButtons();
    showToast('已按强调色重新派生其他层次', 'success', 2500);
}

// 高亮当前选中的调色板卡片（扫描所有 data-palette-key 属性的卡片）
function _highlightActivePalette(name) {
    // 'none'（恢复默认主题色）在视觉上等价于默认内置配色「星夜」(builtin:blue)：
    // 点击重置后高亮星夜卡片
    const active = (name === 'none') ? 'builtin:blue' : name;
    document.querySelectorAll('.palette-card[data-palette-key]').forEach(btn => {
        btn.classList.toggle('palette-active', btn.dataset.paletteKey === active);
    });
    const noneBtn = document.getElementById('palette-none-btn');
    if (noneBtn) {
        noneBtn.classList.toggle('palette-active', name === 'none');
    }
}

function generatePalettePreview(autoSwitchTheme) {
    const bgSrc = _getEffectiveBgImageSrc();
    if (!bgSrc) {
        showToast('请先上传背景图片', 'warning', 3000);
        return;
    }
    showToast('正在提取主题色...', 'info', 2000);
    extractThemePalettes(bgSrc, function(palettes) {
        if (!palettes) {
            showToast('主题色提取失败，请检查背景图', 'error', 3000);
            return;
        }
        settings.themePaletteColors = palettes;
        // 上传背景图时根据图片明暗自动切换深色/浅色模式
        // （仅在上传流程中触发；手动点击"提取调色板"按钮不自动切换）
        // 优先使用 extractThemePalettes 同步计算出的 _brightness，避免与
        // analyzeBgImageBrightness 的异步全局变量产生竞态
        if (autoSwitchTheme) {
            const brightness = (typeof palettes._brightness === 'number') ? palettes._brightness : bgImageBrightness;
            const detectedTheme = brightness < 0.45 ? 'dark' : 'light';
            if (settings.theme !== detectedTheme) {
                setTheme(detectedTheme);
            }
        }
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
    const bgSrc = _getEffectiveBgImageSrc();
    if (!bgSrc) {
        showToast('请先上传背景图片', 'warning', 3000);
        return;
    }
    const btn = document.getElementById('palette-regenerate-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>生成中...';
    }
    extractThemePalettes(bgSrc, function(palettes) {
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
        applyPaletteToCssVars(palette, name);
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
