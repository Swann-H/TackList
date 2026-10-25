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
        applyWebdavStatusState(syncState);
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
