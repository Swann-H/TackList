// ==================== WebDAV 手动同步 ====================
// 设置面板「WebDAV 云同步」分区的前端逻辑：配置读写、连接测试、上传到云端、从云端下载。
// 后端接口见 server.py 的 /api/webdav/*，配置与凭据保存在服务器本地的 webdav_config.json。
//
// 使用场景：电脑与手机各运行一份本系统，两端配置同一个 WebDAV 地址（坚果云、Nextcloud 等），
// 在任意一端上传、在另一端下载，即可完成数据同步。

function setWebdavStatusMsg(html, type) {
    const el = document.getElementById('webdav-status');
    if (!el) return;
    el.innerHTML = html;
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

// 打开设置面板时加载配置与云端状态
async function loadWebdavStatus() {
    const urlEl = document.getElementById('webdav-url');
    if (!urlEl) return;
    try {
        const resp = await fetch('/api/webdav/status');
        if (!resp.ok) {
            setWebdavStatusMsg('获取 WebDAV 状态失败 (HTTP ' + resp.status + ')', 'error');
            return;
        }
        const data = await resp.json();
        if (data.config) {
            urlEl.value = data.config.url || '';
            document.getElementById('webdav-username').value = data.config.username || '';
            const pwdEl = document.getElementById('webdav-password');
            if (!data.config.hasPassword) pwdEl.value = '';
            pwdEl.placeholder = data.config.hasPassword ? '已保存，留空则不修改' : '应用密码';
        }
        if (!data.configured) {
            setWebdavStatusMsg('尚未配置 WebDAV。填写地址、用户名和应用密码后点击「保存配置」，即可上传或下载。', '');
            return;
        }
        let html = '配置已保存。';
        if (data.cloudReachable === true) {
            html += ' 云端文件：' + (data.cloudExists ? '存在' : '不存在');
            if (data.cloudExists && data.cloudModified) {
                html += '（修改于 ' + formatWebdavTime(data.cloudModified) + '）';
            }
            if (data.cloudExists && data.cloudModified && data.localModified) {
                const t1 = new Date(data.cloudModified).getTime();
                const t2 = new Date(data.localModified).getTime();
                if (!isNaN(t1) && !isNaN(t2)) {
                    if (Math.abs(t1 - t2) > 60000) {
                        html += '\n' + (t1 > t2
                            ? '⚠ 云端数据比本地新，建议「从云端下载」'
                            : '⚠ 本地数据比云端新，建议「上传到云端」');
                    } else {
                        html += '\n两端数据时间接近，状态一致。';
                    }
                }
            }
            if (data.localModified) html += '\n本地数据修改于 ' + formatWebdavTime(data.localModified) + '。';
        } else if (data.cloudReachable === false) {
            html += ' 云端连接失败' + (data.message ? '：' + data.message : '') + '，请检查网络或配置。';
        }
        if (data.lastPushAt) html += '\n上次上传：' + formatWebdavTime(data.lastPushAt);
        if (data.lastPullAt) html += '\n上次下载：' + formatWebdavTime(data.lastPullAt);
        setWebdavStatusMsg(html, '');
    } catch (err) {
        setWebdavStatusMsg('获取 WebDAV 状态失败：' + (err.message || '网络错误'), 'error');
    }
}

function _webdavFormValues() {
    return {
        url: (document.getElementById('webdav-url').value || '').trim(),
        username: (document.getElementById('webdav-username').value || '').trim(),
        password: document.getElementById('webdav-password').value || ''
    };
}

async function saveWebdavConfig() {
    const { url, username, password } = _webdavFormValues();
    if (!url) { setWebdavStatusMsg('请填写 WebDAV 地址', 'error'); return; }
    if (!username) { setWebdavStatusMsg('请填写用户名', 'error'); return; }
    try {
        const resp = await fetch('/api/webdav/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, username, password })
        });
        const result = await resp.json();
        if (result.ok) {
            const pwdEl = document.getElementById('webdav-password');
            pwdEl.value = '';
            pwdEl.placeholder = '已保存，留空则不修改';
            setWebdavStatusMsg(result.message, 'success');
            loadWebdavStatus();
        } else {
            setWebdavStatusMsg(result.message || result.error || '保存失败', 'error');
        }
    } catch (err) {
        setWebdavStatusMsg('保存失败：' + (err.message || '网络错误'), 'error');
    }
}

async function webdavTest() {
    const { url, username, password } = _webdavFormValues();
    if (!url) { setWebdavStatusMsg('请填写 WebDAV 地址', 'error'); return; }
    if (!username) { setWebdavStatusMsg('请填写用户名', 'error'); return; }
    setWebdavStatusMsg('正在测试连接…', '');
    try {
        const resp = await fetch('/api/webdav/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, username, password })
        });
        const result = await resp.json();
        setWebdavStatusMsg(result.message || '测试完成', result.ok ? 'success' : 'error');
    } catch (err) {
        setWebdavStatusMsg('测试失败：' + (err.message || '网络错误'), 'error');
    }
}

async function webdavPush() {
    setWebdavStatusMsg('正在上传到云端…', '');
    try {
        const resp = await fetch('/api/webdav/push', { method: 'POST' });
        const result = await resp.json();
        if (result.ok) {
            setWebdavStatusMsg(result.message, 'success');
            loadWebdavStatus();
        } else {
            setWebdavStatusMsg((result.message || '上传失败') +
                '\n\n排查建议：\n' +
                '1. 先点「测试连接」确认地址与凭据正确\n' +
                '2. 确认 WebDAV 地址中的上级目录已在云端创建\n' +
                '3. 坚果云等服务需使用「应用密码」而非登录密码', 'error');
        }
    } catch (err) {
        setWebdavStatusMsg('上传失败：' + (err.message || '网络错误') +
            '\n\n可能原因：本地服务未启动、网络中断或请求超时。', 'error');
    }
}

// 拉取前让排队的本地保存落定：避免刚下载的数据被本地旧快照携带旧版本号反向覆盖
async function _webdavSettleLocalSaves() {
    if (typeof _saveDataTimerId !== 'undefined' && _saveDataTimerId) {
        clearTimeout(_saveDataTimerId);
        _saveDataTimerId = null;
    }
    for (let i = 0; i < 30 && typeof _saveInFlight !== 'undefined' && _saveInFlight; i++) {
        await new Promise(r => setTimeout(r, 100));
    }
}

async function webdavPull() {
    if (!window.confirm('从云端下载会用云端数据覆盖本机数据。\n服务器会先把当前数据备份到 backups 目录，是否继续？')) {
        return;
    }
    setWebdavStatusMsg('正在从云端下载…', '');
    await _webdavSettleLocalSaves();
    try {
        const resp = await fetch('/api/webdav/pull', { method: 'POST' });
        const result = await resp.json();
        if (result.ok) {
            setWebdavStatusMsg(result.message + '\n正在重新载入页面…', 'success');
            // 拉取会整体替换数据（含设置、节假日、背景轮播），整页重载最稳妥
            setTimeout(() => window.location.reload(), 800);
        } else {
            setWebdavStatusMsg((result.message || '下载失败') +
                '\n\n排查建议：\n' +
                '1. 先点「测试连接」确认地址与凭据正确\n' +
                '2. 确认云端已存在数据文件（需先在任意一端执行「上传到云端」）\n' +
                '3. 确认云端文件是本系统导出的有效数据', 'error');
        }
    } catch (err) {
        setWebdavStatusMsg('下载失败：' + (err.message || '网络错误') +
            '\n\n可能原因：本地服务未启动、网络中断或请求超时。', 'error');
    }
}
