// ==================== WebDAV 手动同步 ====================
// 「外部日历同步」配置页中「WebDAV 云同步」子页的前端逻辑：配置读写、连接测试、
// 上传到云端、从云端下载。后端接口见 server.py 的 /api/webdav/*，
// 配置与凭据保存在服务器本地的 webdav_config.json。
//
// 使用场景：电脑与手机各运行一份本系统，两端配置同一个 WebDAV 地址（坚果云、Nextcloud 等），
// 在任意一端上传、在另一端下载，即可完成数据同步。

let _webdavConfigured = false;
let _webdavHasPassword = false;
let webdavHelpCollapsed = true;

// 主视图「同步」入口使用的状态缓存：不联网，仅用于按钮配色与面板内容
let _webdavState = 'unknown';
let _webdavLastPushAt = null;
let _webdavLastPullAt = null;

function _webdavToast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
}

// 当前是否已有确认 Toast（避免反复点击叠加多个确认框）
function _webdavConfirmOpen() {
    return !!document.querySelector('.confirm-yes-btn');
}

// 已保存配置或表单已填写内容时，才允许重置；空配置时按钮置灰
function updateWebdavResetState() {
    const btn = document.getElementById('webdav-reset-btn');
    if (!btn) return;
    const hasInput = ['webdav-url', 'webdav-username', 'webdav-password'].some(function (id) {
        const el = document.getElementById(id);
        return !!(el && (el.value || '').trim());
    });
    const enabled = _webdavConfigured || _webdavHasPassword || hasInput;
    btn.disabled = !enabled;
    btn.className = 'flex items-center justify-center w-8 h-8 rounded-lg border transition ' +
        (enabled
            ? 'border-red-500 text-red-500 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/30'
            : 'border-theme text-theme-muted opacity-40 cursor-not-allowed');
}

// 云端状态 → 色条颜色 + 文字徽标
const WEBDAV_STATUS_STATES = {
    loading: { label: '读取中', color: '#9ca3af' },
    unconfigured: { label: '未配置', color: '#9ca3af' },
    'cloud-missing': { label: '待上传', color: '#3b82f6' },
    'in-sync': { label: '已同步', color: '#10b981' },
    'local-newer': { label: '待上传', color: '#f59e0b' },
    'cloud-newer': { label: '待下载', color: '#f59e0b' },
    'auth-error': { label: '认证异常', color: '#ef4444' },
    'connect-error': { label: '连接异常', color: '#ef4444' },
    'http-error': { label: '连接异常', color: '#ef4444' },
    'status-error': { label: '状态异常', color: '#ef4444' },
    'sync-error': { label: '同步异常', color: '#ef4444' },
    uploading: { label: '上传中', color: '#06b6d4' },
    downloading: { label: '下载中', color: '#06b6d4' },
    unknown: { label: '无法判断', color: '#9ca3af' }
};

function applyWebdavStatusState(state) {
    const cfg = WEBDAV_STATUS_STATES[state] || WEBDAV_STATUS_STATES.unknown;
    const card = document.getElementById('webdav-status-card');
    if (card) {
        card.style.borderLeftColor = cfg.color;
        card.style.transition = 'border-left-color .2s ease';
    }
    const badge = document.getElementById('webdav-status-badge');
    if (badge) {
        badge.textContent = cfg.label;
        badge.style.color = cfg.color;
        badge.style.borderColor = cfg.color;
        badge.style.backgroundColor = cfg.color + '1a';
    }
}

// 兼容旧版服务端（未返回 state 字段）时由前端推导
function _deriveWebdavState(data) {
    if (!data.configured) return 'unconfigured';
    if (data.cloudReachable === false) {
        return (data.message && (data.message.indexOf('401') !== -1 || data.message.indexOf('认证') !== -1))
            ? 'auth-error' : 'connect-error';
    }
    if (data.cloudReachable === true) {
        if (data.cloudExists === null || data.cloudExists === undefined) return 'http-error';
        if (data.cloudExists === false) return 'cloud-missing';
        if (data.cloudModified && data.localModified) {
            const tCloud = new Date(data.cloudModified).getTime();
            const tLocal = new Date(data.localModified).getTime();
            if (!isNaN(tCloud) && !isNaN(tLocal)) {
                const tPush = data.lastPushAt ? new Date(data.lastPushAt).getTime() : NaN;
                const tPull = data.lastPullAt ? new Date(data.lastPullAt).getTime() : NaN;
                let lastKind = '';
                let lastTime = NaN;
                if (!isNaN(tPush) && (isNaN(tPull) || tPush >= tPull)) {
                    lastKind = 'push';
                    lastTime = tPush;
                } else if (!isNaN(tPull)) {
                    lastKind = 'pull';
                    lastTime = tPull;
                }
                if (lastKind) {
                    if (lastKind === 'push'
                        && tCloud <= lastTime + 5000
                        && tLocal <= lastTime + 1000) return 'in-sync';
                    if (lastKind === 'pull'
                        && tLocal <= lastTime + 1000 && tLocal >= lastTime - 120000
                        && tCloud <= lastTime + 5000) return 'in-sync';
                    return tCloud > tLocal ? 'cloud-newer' : 'local-newer';
                }
                if (Math.abs(tCloud - tLocal) <= 60000) return 'in-sync';
                return tCloud > tLocal ? 'cloud-newer' : 'local-newer';
            }
        }
        return 'unknown';
    }
    return 'unknown';
}

// 右上角「上传 / 下载」仅在有完整配置且当前处于 WebDAV 子页时显示
function updateWebdavHeaderActions() {
    const el = document.getElementById('webdav-header-actions');
    if (!el) return;
    const onWebdavTab = (typeof calSyncTab === 'undefined' || calSyncTab === 'webdav');
    const show = _webdavConfigured && onWebdavTab;
    el.classList.toggle('hidden', !show);
    el.classList.toggle('flex', show);
}

function toggleWebdavHelp() {
    webdavHelpCollapsed = !webdavHelpCollapsed;
    const body = document.getElementById('webdav-help-body');
    const chev = document.getElementById('webdav-help-chevron');
    if (body) body.classList.toggle('hidden', webdavHelpCollapsed);
    if (chev) chev.classList.toggle('rotate-180', !webdavHelpCollapsed);
}

// 渲染 WebDAV 子页（与 ICS 订阅页共用 .calendarsync-card 卡片样式）
// 仅支持一组 WebDAV 配置，故连接配置与云端状态改为上下两张全宽卡片
function renderWebdavSyncPanel() {
    const cardClass = 'holiday-section calendarsync-card flex flex-col gap-2 px-3 py-3 rounded-r-lg border border-theme border-l-4';
    const cardStyle = ' style="border-left-color: var(--accent-color, #3b82f6);"';
    const labelClass = 'w-16 text-theme-muted flex-shrink-0';
    const inputClass = 'flex-1 min-w-0 px-2 py-1.5 border border-theme rounded-lg bg-theme-primary text-theme-primary text-xs focus:outline-none focus:border-accent';
    const iconBtn = 'flex items-center justify-center w-8 h-8 rounded-lg border transition';
    const testBtn = iconBtn + ' border-accent text-accent hover:bg-accent hover:text-white';
    const refreshBtn = iconBtn + ' border-accent text-accent hover:bg-accent hover:text-white';
    const actionBtn = iconBtn + ' border-cyan-500 text-cyan-500 hover:bg-cyan-500 hover:text-white';
    const actionTextBtn = 'flex items-center justify-center gap-1 px-3 h-8 rounded-lg border border-cyan-500 text-cyan-500 hover:bg-cyan-500 hover:text-white transition text-xs font-medium whitespace-nowrap';
    const saveBtn = 'flex items-center justify-center w-8 h-8 rounded-lg border border-green-500 text-green-500 hover:bg-green-500 hover:text-white transition';
    const resetBtn = 'flex items-center justify-center w-8 h-8 rounded-lg border transition border-theme text-theme-muted opacity-40 cursor-not-allowed';
    const helpHidden = webdavHelpCollapsed ? 'hidden' : '';
    const helpChev = webdavHelpCollapsed ? '' : 'rotate-180';
    return '<div class="calsync-section-main flex-1 min-h-0 flex flex-col">' +
        '<div class="px-4 flex flex-col min-h-0 flex-1">' +
            '<div class="holiday-list-wrap flex-1 min-h-0 overflow-y-auto">' +
                '<div class="space-y-3 w-full md:w-1/2">' +
                    '<div class="' + cardClass + '"' + cardStyle + '>' +
                        '<div class="flex items-center gap-2">' +
                            '<i class="fas fa-cloud text-accent text-sm"></i>' +
                            '<span class="flex-1 text-sm font-medium text-theme-primary">连接配置</span>' +
                        '</div>' +
                        '<div class="space-y-2 text-xs ml-1">' +
                            '<div class="flex items-center gap-2">' +
                                '<span class="' + labelClass + '">地址</span>' +
                                '<input type="url" id="webdav-url" placeholder="https://dav.jianguoyun.com/dav/TackList/tacklist-data.json" autocomplete="off" oninput="updateWebdavResetState()" class="' + inputClass + ' font-mono">' +
                            '</div>' +
                            '<div class="flex items-center gap-2">' +
                                '<span class="' + labelClass + '">用户名</span>' +
                                '<input type="text" id="webdav-username" autocomplete="off" oninput="updateWebdavResetState()" class="' + inputClass + '">' +
                            '</div>' +
                            '<div class="flex items-center gap-2">' +
                                '<span class="' + labelClass + '">应用密码</span>' +
                                '<input type="password" id="webdav-password" autocomplete="new-password" placeholder="应用密码" oninput="updateWebdavResetState()" class="' + inputClass + '">' +
                            '</div>' +
                            '<label class="flex items-start gap-2 pt-0.5 text-[11px] text-theme-muted cursor-pointer select-none">' +
                                '<input type="checkbox" id="webdav-allow-insecure" class="mt-0.5 w-3.5 h-3.5 flex-shrink-0 accent-cyan-500">' +
                                '<span>允许不安全连接（自签证书 / HTTP 明文）。仅自建 WebDAV 确需时勾选，HTTP 会明文传输凭据。</span>' +
                            '</label>' +
                        '</div>' +
                        '<div class="flex justify-end gap-1 mt-1">' +
                            '<button onclick="saveWebdavConfig()" class="' + saveBtn + '" title="保存配置"><i class="fas fa-check text-sm"></i></button>' +
                            '<button id="webdav-reset-btn" onclick="webdavReset()" disabled class="' + resetBtn + '" title="重置配置（清空本机配置）"><i class="fas fa-trash text-sm"></i></button>' +
                        '</div>' +
                    '</div>' +
                    '<div id="webdav-status-card" class="' + cardClass + '"' + cardStyle + '>' +
                        '<div class="flex items-center gap-2">' +
                            '<i class="fas fa-arrows-rotate text-accent text-sm"></i>' +
                            '<span class="flex-1 text-sm font-medium text-theme-primary">云端状态</span>' +
                            '<span id="webdav-status-badge" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap" style="color:#9ca3af;border-color:#9ca3af;background-color:#9ca3af1a;transition:color .2s,border-color .2s,background-color .2s;">读取中</span>' +
                        '</div>' +
                        '<div id="webdav-status" class="text-xs bg-theme-tertiary text-theme-secondary rounded-lg px-3 py-2 whitespace-pre-line break-words">正在读取同步状态…</div>' +
                        '<div class="flex items-center gap-1 mt-1">' +
                            '<button onclick="webdavTest()" class="' + testBtn + '" title="测试连接"><i class="fas fa-plug text-sm"></i></button>' +
                            '<button onclick="loadWebdavStatus()" class="' + refreshBtn + '" title="刷新状态"><i class="fas fa-rotate text-sm"></i></button>' +
                            '<div class="flex-1"></div>' +
                            '<button onclick="webdavPush()" class="' + actionTextBtn + '" title="上传到云端"><i class="fas fa-cloud-arrow-up text-sm"></i>上传到云端</button>' +
                            '<button onclick="webdavPull()" class="' + actionTextBtn + '" title="从云端下载"><i class="fas fa-cloud-arrow-down text-sm"></i>从云端下载</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>' +
    '</div>' +
    '<div class="calsync-section-gap flex-shrink-0" aria-hidden="true"></div>' +
    '<div class="calsync-section-help flex-shrink-0 px-4 pb-20 sm:pb-4">' +
        '<div class="calsync-help-panel rounded-lg border border-theme">' +
            '<button id="webdav-help-toggle" onclick="toggleWebdavHelp()" class="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-theme-tertiary transition" title="展开 / 收起">' +
                '<span class="text-xs font-medium text-theme-muted">帮助说明</span>' +
                '<i id="webdav-help-chevron" class="fas fa-chevron-down text-xs text-theme-muted transition-transform duration-200 ' + helpChev + '"></i>' +
            '</button>' +
            '<div id="webdav-help-body" class="' + helpHidden + ' px-3 pb-3 space-y-2 max-h-[40vh] overflow-y-auto">' +
                '<p class="text-xs text-theme-secondary leading-relaxed">使用方式：电脑和手机各运行一份本系统时，两端配置同一个 WebDAV 地址（支持坚果云、Nextcloud 等），在一端「上传到云端」、在另一端「从云端下载」即可同步数据。配置与凭据保存在服务器本地，不随数据导出。</p>' +
                '<p class="text-xs text-theme-muted leading-relaxed">说明：上传时会同时在同目录生成 <code class="font-mono">tacklist-reminders.ics</code>，可在手机系统日历中订阅该地址，把未完成的日程同步到手机日历。从云端下载会覆盖本机数据，覆盖前会自动备份到 backups 目录；备份失败会中止下载。</p>' +
                '<p class="text-xs text-theme-muted leading-relaxed">排查建议：上传失败先点「测试连接」确认地址与凭据；HTTP 409 通常表示上级目录未创建；坚果云等服务需使用「应用密码」。下载失败请确认云端已存在数据文件，且为本系统导出的有效 JSON。</p>' +
            '</div>' +
        '</div>' +
    '</div>';
}

function setWebdavStatusMsg(text, type) {
    const el = document.getElementById('webdav-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'text-xs rounded-lg px-3 py-2 whitespace-pre-line ' + (type === 'error'
        ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
        : type === 'success'
            ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-theme-tertiary text-theme-secondary');
}

function formatWebdavTime(t) {
    if (!t) return '';
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// 打开「WebDAV 云同步」子页时加载配置与云端状态
async function loadWebdavStatus() {
    const urlEl = document.getElementById('webdav-url');
    if (!urlEl) return;
    try {
        const resp = await fetch('/api/webdav/status');
        if (!resp.ok) {
            applyWebdavStatusState('status-error');
            setWebdavStatusMsg('获取 WebDAV 状态失败 (HTTP ' + resp.status + ')', 'error');
            _webdavToast('获取 WebDAV 状态失败 (HTTP ' + resp.status + ')', 'error');
            return;
        }
        const data = await resp.json();
        if (data.config) {
            urlEl.value = data.config.url || '';
            document.getElementById('webdav-username').value = data.config.username || '';
            const pwdEl = document.getElementById('webdav-password');
            if (!data.config.hasPassword) pwdEl.value = '';
            pwdEl.placeholder = data.config.hasPassword ? '已保存，留空不修改' : '应用密码';
            const insecureEl = document.getElementById('webdav-allow-insecure');
            if (insecureEl) insecureEl.checked = !!data.config.allowInsecure;
        }
        _webdavConfigured = !!data.configured;
        _webdavHasPassword = !!(data.config && data.config.hasPassword);
        updateWebdavHeaderActions();
        updateWebdavResetState();
        const syncState = data.state || _deriveWebdavState(data);
        _webdavState = syncState;
        _webdavLastPushAt = data.lastPushAt || null;
        _webdavLastPullAt = data.lastPullAt || null;
        applyWebdavStatusState(syncState);
        if (typeof updateSyncBtnState === 'function') updateSyncBtnState();
        if (!data.configured) {
            setWebdavStatusMsg('尚未配置 WebDAV地址', '');
            return;
        }
        let html = '配置已保存。';
        if (data.cloudReachable === true) {
            if (data.cloudExists === null || data.cloudExists === undefined) {
                html += ' 云端状态异常' + (data.message ? '：' + data.message : '');
            } else {
                html += ' 云端文件：' + (data.cloudExists ? '存在' : '不存在');
                if (data.cloudExists && data.cloudModified) {
                    html += '（修改于 ' + formatWebdavTime(data.cloudModified) + '）';
                }
                if (data.cloudExists && data.cloudModified && data.localModified) {
                    if (syncState === 'cloud-newer') {
                        html += '\n⚠ 云端数据比本地新，建议「从云端下载」';
                    } else if (syncState === 'local-newer') {
                        html += '\n⚠ 本地数据比云端新，建议「上传到云端」';
                    } else if (syncState === 'in-sync') {
                        html += '\n两端数据已同步。';
                    }
                } else if (data.cloudExists) {
                    html += '\n无法比较修改时间，请手动确认后上传或下载。';
                }
            }
            if (data.localModified) html += '\n本地数据修改于 ' + formatWebdavTime(data.localModified) + '。';
        } else if (data.cloudReachable === false) {
            const errMsg = (data.message || '').trim();
            html += ' 云端连接失败' + (errMsg ? '：' + errMsg : '（网络不可达）') + '，请检查网络或配置。';
        }
        if (data.lastPushAt) html += '\n上次上传：' + formatWebdavTime(data.lastPushAt);
        if (data.lastPullAt) html += '\n上次下载：' + formatWebdavTime(data.lastPullAt);
        setWebdavStatusMsg(html, '');
    } catch (err) {
        applyWebdavStatusState('status-error');
        setWebdavStatusMsg('获取 WebDAV 状态失败：' + (err.message || '网络错误'), 'error');
        _webdavToast('获取 WebDAV 状态失败：' + (err.message || '网络错误'), 'error');
    }
}

function _webdavFormValues() {
    const insecureEl = document.getElementById('webdav-allow-insecure');
    return {
        url: (document.getElementById('webdav-url').value || '').trim(),
        username: (document.getElementById('webdav-username').value || '').trim(),
        password: document.getElementById('webdav-password').value || '',
        allowInsecure: !!(insecureEl && insecureEl.checked)
    };
}

async function saveWebdavConfig() {
    const { url, username, password, allowInsecure } = _webdavFormValues();
    if (!url) { _webdavToast('请填写 WebDAV 地址', 'warning'); return; }
    if (!username) { _webdavToast('请填写用户名', 'warning'); return; }
    if (!password && !_webdavHasPassword) { _webdavToast('请填写应用密码', 'warning'); return; }
    try {
        const resp = await fetch('/api/webdav/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, username, password, allowInsecure })
        });
        const result = await resp.json();
        if (result.ok) {
            const pwdEl = document.getElementById('webdav-password');
            pwdEl.value = '';
            pwdEl.placeholder = '已保存，留空不修改';
            _webdavHasPassword = true;
            _webdavToast(result.message || 'WebDAV 配置已保存', 'success');
            loadWebdavStatus();
        } else {
            _webdavToast(result.message || result.error || '保存失败', 'error');
        }
    } catch (err) {
        _webdavToast('保存失败：' + (err.message || '网络错误'), 'error');
    }
}

async function webdavTest() {
    const { url, username, password, allowInsecure } = _webdavFormValues();
    if (!url) { _webdavToast('请填写 WebDAV 地址', 'warning'); return; }
    if (!username) { _webdavToast('请填写用户名', 'warning'); return; }
    if (!password && !_webdavHasPassword) { _webdavToast('请填写应用密码', 'warning'); return; }
    try {
        const resp = await fetch('/api/webdav/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, username, password, allowInsecure })
        });
        const result = await resp.json();
        _webdavToast(result.message || '测试完成', result.ok ? 'success' : 'error');
        if (result.ok) loadWebdavStatus();
    } catch (err) {
        _webdavToast('测试失败：' + (err.message || '网络错误'), 'error');
    }
}

async function webdavPush() {
    if (!_webdavConfigured) { _webdavToast('请先保存 WebDAV 配置', 'warning'); return; }
    setWebdavStatusMsg('正在上传到云端…', '');
    applyWebdavStatusState('uploading');
    try {
        // 先落定 500ms 防抖内的本地修改，避免服务端从磁盘读到旧快照
        if (typeof saveDataImmediate === 'function') await saveDataImmediate();
        const resp = await fetch('/api/webdav/push', { method: 'POST' });
        const result = await resp.json();
        if (result.ok) {
            _webdavState = 'in-sync';
            _webdavLastPushAt = new Date().toISOString();
            if (typeof updateSyncBtnState === 'function') updateSyncBtnState();
            _webdavToast(result.message || '上传成功', 'success');
            loadWebdavStatus();
        } else {
            const msg = result.message || result.error || '上传失败';
            setWebdavStatusMsg(msg, 'error');
            applyWebdavStatusState('sync-error');
            _webdavToast(msg, 'error');
        }
    } catch (err) {
        const msg = '上传失败：' + (err.message || '网络错误');
        setWebdavStatusMsg(msg, 'error');
        applyWebdavStatusState('sync-error');
        _webdavToast(msg, 'error');
    }
}

// 拉取前让排队的本地保存落定：避免刚下载的数据被本地旧快照携带旧版本号反向覆盖
async function _webdavSettleLocalSaves() {
    if (typeof _saveDataTimerId !== 'undefined' && _saveDataTimerId) {
        clearTimeout(_saveDataTimerId);
        _saveDataTimerId = null;
        // 待保存定时器被丢弃后，_saveInFlight 若仍为 true 会永久阻塞后台刷新
        if (typeof _savePutInFlight === 'undefined' || !_savePutInFlight) {
            _saveInFlight = false;
        }
    }
    for (let i = 0; i < 30 && typeof _saveInFlight !== 'undefined' && _saveInFlight; i++) {
        await new Promise(r => setTimeout(r, 100));
    }
}

async function _doWebdavPull() {
    setWebdavStatusMsg('正在从云端下载…', '');
    applyWebdavStatusState('downloading');
    await _webdavSettleLocalSaves();
    try {
        const resp = await fetch('/api/webdav/pull', { method: 'POST' });
        const result = await resp.json();
        if (result.ok) {
            _webdavToast(result.message + '，正在重新载入页面…', 'success');
            // 拉取会整体替换数据（含设置、节假日、背景轮播），整页重载最稳妥
            setTimeout(() => window.location.reload(), 1200);
        } else {
            const msg = result.message || result.error || '下载失败';
            setWebdavStatusMsg(msg, 'error');
            applyWebdavStatusState('sync-error');
            _webdavToast(msg, 'error');
        }
    } catch (err) {
        const msg = '下载失败：' + (err.message || '网络错误');
        setWebdavStatusMsg(msg, 'error');
        applyWebdavStatusState('sync-error');
        _webdavToast(msg, 'error');
    }
}

function webdavPull() {
    if (!_webdavConfigured) { _webdavToast('请先保存 WebDAV 配置', 'warning'); return; }
    if (_webdavConfirmOpen()) return;
    const msg = '从云端下载会用云端数据覆盖本机数据，服务器会先备份到 backups 目录。是否继续？';
    if (typeof showConfirmToast === 'function') {
        showConfirmToast(msg, () => { _doWebdavPull(); }, null, {
            confirmLabel: '继续下载',
            cancelLabel: '取消'
        });
    } else if (window.confirm(msg)) {
        _doWebdavPull();
    }
}

function webdavReset() {
    if (_webdavConfirmOpen()) return;
    const doReset = async () => {
        try {
            const resp = await fetch('/api/webdav/config/reset', { method: 'POST' });
            let result = {};
            try { result = await resp.json(); } catch (e) {}
            if (!resp.ok) {
                const fallback = resp.status === 404
                    ? '重置接口不可用（HTTP 404），请重启服务后重试'
                    : '重置失败（HTTP ' + resp.status + '）';
                _webdavToast(result.message || result.error || fallback, 'error');
                return;
            }
            if (result.ok) {
                ['webdav-url', 'webdav-username', 'webdav-password'].forEach(function (id) {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
                const insecureEl = document.getElementById('webdav-allow-insecure');
                if (insecureEl) insecureEl.checked = false;
                const pwdEl = document.getElementById('webdav-password');
                if (pwdEl) pwdEl.placeholder = '应用密码';
                _webdavConfigured = false;
                _webdavHasPassword = false;
                _webdavState = 'unconfigured';
                _webdavLastPushAt = null;
                _webdavLastPullAt = null;
                if (typeof updateSyncBtnState === 'function') updateSyncBtnState();
                updateWebdavHeaderActions();
                updateWebdavResetState();
                applyWebdavStatusState('unconfigured');
                setWebdavStatusMsg('尚未配置 WebDAV地址', '');
                _webdavToast(result.message || 'WebDAV 配置已重置', 'success');
            } else {
                _webdavToast(result.message || result.error || '重置失败', 'error');
            }
        } catch (err) {
            _webdavToast('重置失败：' + (err.message || '网络错误'), 'error');
        }
    };
    const msg = '重置会清空本机 WebDAV 地址、用户名、应用密码与同步记录，不会删除云端文件。是否继续？';
    if (typeof showConfirmToast === 'function') {
        showConfirmToast(msg, doReset, null, { confirmLabel: '确认重置', cancelLabel: '取消' });
    } else if (window.confirm(msg)) {
        doReset();
    }
}

// ==================== 主视图「同步」入口 ====================
// 一个按钮聚合两条同步通道：外部日历订阅（拉取外部日程）与 WebDAV 云同步（整包上传 / 下载）。
// 面板复用「更多」面板的样式与展开规则（桌面悬浮、触摸点击、贴边对齐），
// 条目复用 .header-more-item / .header-more-icon / .header-more-label，仅额外追加时间勋章。

const _SYNC_BTN_STATE_CLASSES = ['sync-state-cyan', 'sync-state-green', 'sync-state-amber', 'sync-state-red'];
// 状态 → 按钮配色：绿=已同步，橙=有待同步，红=异常，青=正常 / 未探测
const _SYNC_STATE_COLOR = {
    'in-sync': 'green',
    'local-newer': 'amber',
    'cloud-newer': 'amber',
    'cloud-missing': 'amber',
    'auth-error': 'red',
    'connect-error': 'red',
    'http-error': 'red',
    'status-error': 'red',
    'sync-error': 'red'
};

let _webdavSummaryAt = 0;       // 轻量状态最近一次拉取时间（节流）
let _webdavProbeAt = 0;         // 联网探测最近一次时间（节流）
let _webdavProbePromise = null;
let _syncMenuHoverOpen = false; // 桌面悬浮展开中（与点击固定的 .sync-open 区分）
let _syncMenuKey = '';          // 上次渲染的内容指纹，状态未变时不重绘，避免打断悬浮中的点击

function _syncStateColor(state) {
    return _SYNC_STATE_COLOR[state] || 'cyan';
}

// 时间勋章文案：沿用任务列表的相对时间词（今天 / 昨天），更早的日期用「M月D日」
function _syncTimeText(value) {
    if (!value) return '';
    const d = (value instanceof Date) ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    const label = (typeof relativeDayLabelForNow === 'function') ? relativeDayLabelForNow(d) : '';
    if (label === '今天' || label === '昨天' || label === '明天' || label === '后天') {
        const pad = n => String(n).padStart(2, '0');
        return label + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    return label;
}

// 已启用订阅中最近一次同步时间（含失败记录，用于表达"上次尝试过"）
function _icsLastSyncDate() {
    if (typeof _calSubs !== 'function') return null;
    let latest = 0;
    _calSubs().forEach(function (sub) {
        if (!sub.enabled || !sub.lastSyncAt) return;
        const t = new Date(sub.lastSyncAt).getTime();
        if (!isNaN(t) && t > latest) latest = t;
    });
    return latest ? new Date(latest) : null;
}

function _setSyncMenuExpanded(expanded) {
    const btn = document.getElementById('calendar-sync-btn');
    if (btn) btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

// 按钮圆圈与图标同色绘制；「更多」面板里的同步项颜色同步更新
function updateSyncBtnState() {
    const btn = document.getElementById('calendar-sync-btn');
    const group = document.getElementById('header-sync-group');
    if (!btn || !group) return;
    const color = _syncStateColor(_webdavState);
    _SYNC_BTN_STATE_CLASSES.forEach(function (c) { btn.classList.remove(c); });
    btn.classList.add('sync-state-' + color);
    group.dataset.syncColor = color;
    // 面板可见时（点击固定或桌面悬浮）随状态重绘条目
    if (group.classList.contains('sync-open') || _syncMenuHoverOpen) renderSyncMenu();
}

// 轻量状态：只读服务器本地配置，不联网，用于首屏决定按钮显隐与初始配色
async function fetchWebdavSummary() {
    const now = Date.now();
    if (now - _webdavSummaryAt < 10000) {
        // 节流命中：仍补一次 UI 同步，避免首屏调用早于 calendar_sync.js 时显隐未落地
        if (typeof updateCalendarSyncBtnVisibility === 'function') updateCalendarSyncBtnVisibility();
        return;
    }
    _webdavSummaryAt = now;
    try {
        const resp = await fetch('/api/webdav/config/summary');
        if (!resp.ok) return;
        const data = await resp.json();
        _webdavConfigured = !!data.configured;
        _webdavLastPushAt = data.lastPushAt || null;
        _webdavLastPullAt = data.lastPullAt || null;
        _webdavState = data.cachedState || (_webdavConfigured ? 'unknown' : 'unconfigured');
        if (typeof updateCalendarSyncBtnVisibility === 'function') updateCalendarSyncBtnVisibility();
        else updateSyncBtnState();
    } catch (e) {
        // 主视图入口不应因状态查询失败而打断页面
    }
}

// 联网探测（展开面板时触发）：30s 内复用上次结果，8s 超时；失败保留上次已知状态避免误报
async function refreshWebdavState(force) {
    if (!_webdavConfigured) return;
    const now = Date.now();
    if (!force && now - _webdavProbeAt < 30000) return;
    if (_webdavProbePromise) return _webdavProbePromise;
    _webdavProbeAt = now;
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    _webdavProbePromise = (async function () {
        try {
            const resp = await fetch('/api/webdav/status', ctrl ? { signal: ctrl.signal } : undefined);
            if (!resp.ok) return;
            const data = await resp.json();
            _webdavLastPushAt = data.lastPushAt || null;
            _webdavLastPullAt = data.lastPullAt || null;
            _webdavState = data.state || _deriveWebdavState(data);
        } catch (e) {
            // 探测失败保持原状态
        } finally {
            if (timer) clearTimeout(timer);
            _webdavProbePromise = null;
            updateSyncBtnState();
        }
    })();
    return _webdavProbePromise;
}

// 直达同步配置页：窄屏「更多」列表与面板底部入口共用
function gotoSyncSettingsFromHeader() {
    if (typeof switchToCalendarSyncPage !== 'function') return;
    const hasIcs = (typeof _calSubs === 'function') && _calSubs().some(function (s) { return s.enabled; });
    // 有订阅且未配云同步时落在 ICS 子页，否则落在 WebDAV 子页（配置页头部有上传 / 下载圆钮）
    const tab = (_webdavConfigured || !hasIcs) ? 'webdav' : 'ics';
    switchToCalendarSyncPage('header', tab);
}

function _syncMenuSep() {
    const sep = document.createElement('div');
    sep.className = 'sync-menu-sep';
    return sep;
}

// 条目结构与「更多」面板完全一致：圆图标 + 文字，右侧追加时间勋章
function _syncMenuItem(opts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'header-more-item';
    btn.setAttribute('role', 'menuitem');

    const circle = document.createElement('span');
    circle.className = 'header-more-icon';
    circle.setAttribute('aria-hidden', 'true');
    const colorValue = (typeof VIEW_ACTION_COLOR_HEX === 'object' && VIEW_ACTION_COLOR_HEX[opts.color]) || '';
    if (colorValue) circle.style.setProperty('--more-color', colorValue);
    const icon = document.createElement('i');
    icon.className = opts.icon;
    circle.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'header-more-label';
    label.textContent = opts.label;

    btn.appendChild(circle);
    btn.appendChild(label);

    if (opts.time) {
        const badge = document.createElement('span');
        badge.className = 'sync-menu-time';
        badge.textContent = opts.time;
        btn.appendChild(badge);
        if (opts.attention) btn.classList.add('is-attention');
    }

    if (opts.disabled) {
        btn.disabled = true;
        btn.classList.add('is-disabled');
    } else if (typeof opts.run === 'function') {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeSyncMenu();
            try {
                opts.run();
            } catch (err) {
                console.error('同步面板操作失败:', err);
            }
        });
    }
    return btn;
}

function renderSyncMenu() {
    const menu = document.getElementById('sync-menu');
    if (!menu) return;
    const hasIcs = (typeof _calSubs === 'function') && _calSubs().some(function (s) { return s.enabled; });
    const rows = [];

    // 顺序与配置页子页签一致：WebDAV 云同步在前，ICS 订阅在后
    if (!_webdavConfigured) {
        // 未配置时两条通道合并为一条引导，避免出现两个永远不可点的按钮
        rows.push({
            icon: 'fas fa-cloud',
            label: '云同步未配置',
            color: 'slate',
            time: '去设置',
            run: gotoSyncSettingsFromHeader
        });
    } else {
        rows.push({
            icon: 'fas fa-cloud-arrow-up',
            label: '上传到云端',
            color: 'cyan',
            time: _syncTimeText(_webdavLastPushAt) || '未同步',
            attention: (_webdavState === 'local-newer' || _webdavState === 'cloud-missing'),
            run: function () { webdavPush(); }
        });
        rows.push({
            icon: 'fas fa-cloud-arrow-down',
            label: '从云端下载',
            color: 'cyan',
            time: _syncTimeText(_webdavLastPullAt) || '未同步',
            attention: (_webdavState === 'cloud-newer'),
            run: function () { webdavPull(); }
        });
    }

    rows.push({ sep: true });

    // ICS 订阅：拉取外部日程进本系统（只读导入，风险低）
    rows.push({
        icon: 'fas fa-calendar-plus',
        label: '立即同步外部日历',
        color: 'cyan',
        time: hasIcs ? (_syncTimeText(_icsLastSyncDate()) || '未同步') : '未启用',
        disabled: !hasIcs,
        run: function () {
            if (typeof triggerCalendarSync === 'function') triggerCalendarSync();
        }
    });

    rows.push({ sep: true });
    rows.push({
        icon: 'fas fa-gear',
        label: '打开外部日历同步设置',
        color: 'slate',
        run: gotoSyncSettingsFromHeader
    });

    // 内容指纹：状态未变时不重绘，避免悬浮中重绘把鼠标下的条目换掉导致点击丢失
    const key = rows.map(function (r) {
        return r.sep ? '#' : [r.icon, r.label, r.time || '', r.attention ? 1 : 0, r.disabled ? 1 : 0].join('~');
    }).join('|');
    if (key === _syncMenuKey && menu.childElementCount) return;
    _syncMenuKey = key;

    const frag = document.createDocumentFragment();
    rows.forEach(function (r) {
        frag.appendChild(r.sep ? _syncMenuSep() : _syncMenuItem(r));
    });
    menu.innerHTML = '';
    menu.appendChild(frag);
}

function toggleSyncMenu(e) {
    if (e) e.stopPropagation();
    const group = document.getElementById('header-sync-group');
    if (!group) return;
    if (group.classList.contains('sync-open')) { closeSyncMenu(); return; }
    if (typeof closeHeaderMoreMenu === 'function') closeHeaderMoreMenu();
    renderSyncMenu();
    group.classList.add('sync-open');
    _setSyncMenuExpanded(true);
    refreshWebdavState(false);
}

function closeSyncMenu() {
    const group = document.getElementById('header-sync-group');
    if (!group) return;
    group.classList.remove('sync-open');
    _setSyncMenuExpanded(false);
}

(function initSyncMenuEntry() {
    const group = document.getElementById('header-sync-group');
    if (!group) return;

    // 桌面悬浮展开（与「更多」一致）：展开前重算内容，并顺带刷新一次云端状态
    group.addEventListener('pointerenter', function (e) {
        if (e.pointerType !== 'mouse') return;
        if (typeof closeHeaderMoreMenu === 'function') closeHeaderMoreMenu();
        _syncMenuHoverOpen = true;
        renderSyncMenu();
        _setSyncMenuExpanded(true);
        refreshWebdavState(false);
    });
    group.addEventListener('pointerleave', function (e) {
        if (e.pointerType !== 'mouse') return;
        _syncMenuHoverOpen = false;
        if (!group.classList.contains('sync-open')) _setSyncMenuExpanded(false);
    });

    // 点击固定展开后，点击面板外任意位置收起
    document.addEventListener('pointerdown', function (e) {
        if (!group.classList.contains('sync-open')) return;
        if (e.target && e.target.closest && e.target.closest('#header-sync-group')) return;
        closeSyncMenu();
    }, true);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeSyncMenu();
    });

    fetchWebdavSummary();
})();
