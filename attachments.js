// attachments.js — FR-06 任务附件
// 设计约束（《需求说明书_任务操作增强》FR-06）：
//   · 二进制只落盘（attachments/<taskId>/<fileId>_<name>），data.json 只存元数据 —— 全量 PUT + 5MB PATCH 上限
//     决定了 base64 内联不可行；
//   · 附件不进 data.json（二进制太大），但会随「导出 / 服务端备份」的 ZIP 包
//     一并打包（attachments/<taskId>/<fileId>_<name>），导入 ZIP 时整体还原；
//     旧版纯 JSON 备份不含附件文件，导入后附件条目降级为占位（见 V6-6）；
//   · 永久删除任务时级联删除附件目录（C6-3）；
//   · 离线版（无服务端）隐藏上传入口：两个入口都由本地服务提供，故用 /api/attachments/capabilities 实测（C6-1 之外的必要修正）。
// 依赖（运行时解析）：tasks / settings / saveData / renderView / escapeHtml / showToast / isAnyOverlayOpen

const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_INLINE_MIME = /^image\/(png|jpeg|jpg|gif|webp|bmp|avif)$/i;

let _attachmentsSupported = null;   // null = 尚未探测
let _attachmentsProbing = null;     // 探测中的 Promise（避免并发重复请求）
let _attachmentsCollapsed = false;  // 详情面板附件区折叠态（会话级，不持久化）
let _attachmentsExpanded = false;   // 「显示全部」展开态（>9 张时生效，切换任务复位）
let _attachmentsTaskId = null;      // 上次渲染的任务 id（切换任务时复位展开态）
const ATTACHMENT_GRID_LIMIT = 9;    // V6-8：超过 9 张先给「显示更多」，避免首屏过长
let _attLightboxEl = null;
let _attObserver = null;

// ---- 能力探测 ----
function probeAttachmentSupport() {
    if (_attachmentsSupported !== null) return Promise.resolve(_attachmentsSupported);
    if (_attachmentsProbing) return _attachmentsProbing;
    _attachmentsProbing = fetch('/api/attachments/capabilities', { method: 'GET' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { _attachmentsSupported = !!(j && j.enabled); return _attachmentsSupported; })
        .catch(function () { _attachmentsSupported = false; return false; })
        .finally(function () { _attachmentsProbing = null; });
    return _attachmentsProbing;
}

function isAttachmentSupported() {
    return _attachmentsSupported === true;
}

// ---- 工具 ----
function attachmentUrl(taskId, attId) {
    return '/api/attachments/' + encodeURIComponent(taskId) + '/' + encodeURIComponent(attId);
}

function formatAttachmentSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function isInlineImage(att) {
    return !!(att && ATTACHMENT_INLINE_MIME.test(att.mime || ''));
}

function _attachmentsOf(task) {
    return (task && Array.isArray(task.attachments)) ? task.attachments : [];
}

// ---- 详情面板渲染 ----
let _attTriggerLayoutRaf = null;
let _attTriggerObserver = null;
let _attTriggerHostWidth = 0;

function _attachmentsReadOnly(task) {
    return (typeof detailReadOnly !== 'undefined' && detailReadOnly) || !!task.extSourceId;
}

function _attachmentsCanUpload(task) {
    return isAttachmentSupported() && !_attachmentsReadOnly(task);
}

function _setAttachmentGridOpen(open) {
    const panel = document.getElementById('task-detail-panel');
    if (panel) panel.classList.toggle('att-grid-open', !!open);
}

// 由 openTaskDetailPanel 在设置完标签后调用（见 tasks.js）
function renderAttachmentsSection(task) {
    const host = document.getElementById('detail-attachments');
    if (!host || !task) return;
    const list = _attachmentsOf(task);
    // 切换任务时复位「显示全部」
    if (_attachmentsTaskId !== task.id) {
        _attachmentsTaskId = task.id;
        _attachmentsExpanded = false;
    }
    // C6-4：外部订阅任务只读、详情面板只读态，均不提供上传入口
    const canUpload = _attachmentsCanUpload(task);
    const canEdit = !_attachmentsReadOnly(task);
    const hasList = list.length > 0;
    const collapsed = _attachmentsCollapsed && hasList;
    const showGrid = hasList && !collapsed;

    // 无附件且不支持上传（离线/无服务端）：整块隐藏，不占面板高度
    if (!hasList && !canUpload) {
        host.innerHTML = '';
        host.classList.add('hidden');
        _setAttachmentGridOpen(false);
        refreshDetailAttachmentTrigger(task);
        return;
    }

    // 网格只负责展开内容；折叠时清空，避免缩略图懒加载在隐藏态继续跑
    host.innerHTML = showGrid ? _attachmentGridHtml(task, list, canUpload, canEdit) : '';
    host.classList.toggle('hidden', !showGrid);
    _setAttachmentGridOpen(showGrid);
    if (showGrid) _observeAttachmentImages(host);

    refreshDetailAttachmentTrigger(task);
    _bindDetailPanelDropZone();
}

// 按钮挂在标签行内：能放下就与标签同行左侧，放不下则独占一行压在标签上方。
function refreshDetailAttachmentTrigger(task) {
    if (!task) task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;
    const host = document.getElementById('detail-tags-display');
    if (!host) return;
    const old = document.getElementById('detail-attachment-trigger');
    const restoreFocus = !!old && document.activeElement === old;
    if (old) old.remove();

    const list = _attachmentsOf(task);
    const hasList = list.length > 0;
    const canUpload = _attachmentsCanUpload(task);
    if (!hasList && !canUpload) {
        host.classList.remove('att-trigger-above');
        if (!host.querySelector('.detail-tag-chip')) host.classList.add('hidden');
        return;
    }

    host.classList.remove('hidden');
    const collapsed = _attachmentsCollapsed && hasList;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'detail-attachment-trigger';
    btn.className = 'detail-attachment-trigger';
    btn.title = hasList ? (collapsed ? '展开附件' : '收起附件') : '添加附件';
    btn.setAttribute('aria-expanded', hasList && !collapsed ? 'true' : 'false');
    btn.innerHTML =
        '<i class="fas fa-paperclip"></i><span>附件</span>' +
        (hasList
            ? '<span class="att-count">(' + list.length + ')</span>' +
              '<i class="fas fa-chevron-' + (collapsed ? 'right' : 'down') + ' att-chevron"></i>'
            : '');
    btn.addEventListener('click', onDetailAttachmentTrigger);
    // 面板级 keydown 会对非输入框的回车直接关闭面板；阻止冒泡让按钮保留原生激活
    btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') e.stopPropagation();
    });
    host.insertBefore(btn, host.firstChild);
    if (restoreFocus) btn.focus({ preventScroll: true });

    _ensureAttachmentTriggerObserver();
    _scheduleAttachmentTriggerLayout();
}

function onDetailAttachmentTrigger(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;
    // 有附件 → 折叠/展开；无附件 → 直接走添加（与旧标题入口一致）
    if (_attachmentsOf(task).length > 0) {
        toggleAttachmentsSection();
    } else if (_attachmentsCanUpload(task)) {
        openAttachmentUpload();
    }
}

function _ensureAttachmentTriggerObserver() {
    if (_attTriggerObserver || typeof ResizeObserver === 'undefined') return;
    const host = document.getElementById('detail-tags-display');
    if (!host) return;
    _attTriggerObserver = new ResizeObserver(function (entries) {
        const w = entries[0] ? entries[0].contentRect.width : 0;
        // 只响应宽度变化：上方/同行切换会改高度，避免自我触发形成循环
        if (Math.abs(w - _attTriggerHostWidth) < 0.5) return;
        _attTriggerHostWidth = w;
        _scheduleAttachmentTriggerLayout();
    });
    _attTriggerObserver.observe(host);
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(_scheduleAttachmentTriggerLayout);
    }
}

function _scheduleAttachmentTriggerLayout() {
    if (_attTriggerLayoutRaf) cancelAnimationFrame(_attTriggerLayoutRaf);
    _attTriggerLayoutRaf = requestAnimationFrame(_layoutAttachmentTrigger);
}

function _layoutAttachmentTrigger() {
    _attTriggerLayoutRaf = null;
    const host = document.getElementById('detail-tags-display');
    const btn = document.getElementById('detail-attachment-trigger');
    if (!host || !btn) return;
    // 先回到「同行」态再量自然宽度；同一帧内完成，不会产生可见闪动
    host.classList.remove('att-trigger-above');
    const cs = getComputedStyle(host);
    const avail = host.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const chips = host.querySelectorAll('.detail-tag-chip');
    if (avail <= 0 || chips.length === 0) return;
    let tagsWidth = 0;
    chips.forEach(function (chip) {
        tagsWidth += chip.getBoundingClientRect().width + (parseFloat(getComputedStyle(chip).marginRight) || 0);
    });
    const btnWidth = btn.getBoundingClientRect().width;
    if (tagsWidth > avail || tagsWidth + btnWidth + 12 > avail) {
        host.classList.add('att-trigger-above');
    }
}

function _attachmentGridHtml(task, list, canUpload, canEdit) {
    const shown = (_attachmentsExpanded || list.length <= ATTACHMENT_GRID_LIMIT)
        ? list
        : list.slice(0, ATTACHMENT_GRID_LIMIT);
    const more = list.length - shown.length;
    const cells = shown.map(function (att) {
        const url = attachmentUrl(task.id, att.id);
        const name = escapeHtml(att.name || '文件');
        const size = formatAttachmentSize(att.size);
        const inner = isInlineImage(att)
            ? '<img data-att-src="' + url + '" alt="' + name + '" class="w-full h-full object-cover" style="opacity:0;transition:opacity .18s ease">'
            : '<div class="w-full h-full flex flex-col items-center justify-center text-theme-muted gap-1">' +
                  '<i class="fas ' + _attachmentFileIcon(att.mime) + ' text-lg"></i>' +
                  '<span class="text-[10px]">' + size + '</span>' +
              '</div>';
        const removeBtn = canEdit
            ? '<button type="button" class="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white text-[10px] opacity-0 group-hover:opacity-100 transition flex items-center justify-center" ' +
                'onclick="event.stopPropagation(); removeAttachment(\'' + task.id + '\',\'' + att.id + '\')" title="移除附件"><i class="fas fa-times"></i></button>'
            : '';
        return '<div class="relative group rounded-lg overflow-hidden border border-theme bg-theme-tertiary" style="aspect-ratio:1/1">' +
            '<button type="button" class="w-full h-full block" onclick="openAttachmentPreview(\'' + task.id + '\',\'' + att.id + '\')" title="' + name + '">' + inner + '</button>' +
            removeBtn +
            '<div class="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/65 to-transparent text-[10px] text-white truncate pointer-events-none">' + name + '</div>' +
        '</div>';
    });
    // 列表末尾的虚线「+」卡片（与倒计时界面「添加倒计时」卡片同一套交互语言）
    if (canUpload) {
        cells.push('<button type="button" class="flex items-center justify-center rounded-lg border border-dashed border-theme text-theme-muted hover:bg-theme-tertiary hover:text-theme-primary transition" ' +
            'style="aspect-ratio:1/1" onclick="openAttachmentUpload()" title="添加附件"><i class="fas fa-plus text-lg"></i></button>');
    }
    const grid = '<div class="grid grid-cols-3 gap-2">' + cells.join('') + '</div>';
    if (more > 0) {
        return grid + '<button type="button" class="mt-1.5 w-full py-1 text-[11px] rounded border border-theme text-theme-secondary hover:bg-theme-tertiary transition" onclick="expandAttachmentsGrid()">显示全部 ' + list.length + ' 个（还有 ' + more + ' 个）</button>';
    }
    return grid;
}

function expandAttachmentsGrid() {
    _attachmentsExpanded = true;
    const task = tasks.find(function (t) { return t.id === currentDetailTaskId; });
    if (task) renderAttachmentsSection(task);
}

function _attachmentFileIcon(mime) {
    const m = (mime || '').toLowerCase();
    if (m.indexOf('pdf') !== -1) return 'fa-file-pdf text-red-400';
    if (m.indexOf('zip') !== -1) return 'fa-file-zipper text-amber-400';
    if (m.indexOf('word') !== -1) return 'fa-file-word text-blue-400';
    if (m.indexOf('sheet') !== -1 || m.indexOf('excel') !== -1) return 'fa-file-excel text-green-400';
    if (m.indexOf('presentation') !== -1 || m.indexOf('powerpoint') !== -1) return 'fa-file-powerpoint text-orange-400';
    if (m.indexOf('text') !== -1) return 'fa-file-lines text-theme-secondary';
    return 'fa-file text-theme-muted';
}

// 缩略图懒加载（C6-8）：复用项目既有 IntersectionObserver 范式
function _observeAttachmentImages(root) {
    const imgs = root.querySelectorAll('img[data-att-src]');
    if (!imgs.length) return;
    if (!('IntersectionObserver' in window)) {
        imgs.forEach(function (img) { img.src = img.dataset.attSrc; img.style.opacity = '1'; });
        return;
    }
    if (_attObserver) _attObserver.disconnect();
    _attObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            const img = entry.target;
            _attObserver.unobserve(img);
            img.onload = function () { img.style.opacity = '1'; };
            img.onerror = function () {
                // V6-6：附件目录被清掉（只拷了 data.json）时降级为占位，不白屏
                img.style.opacity = '1';
                const ph = document.createElement('div');
                ph.className = 'w-full h-full flex items-center justify-center text-theme-muted';
                ph.innerHTML = '<i class="fas fa-image-slash text-lg"></i>';
                img.parentNode.replaceChild(ph, img);
            };
            img.src = img.dataset.attSrc;
        });
    }, { root: root.closest('#detail-body') || null, rootMargin: '200px 0px' });
    imgs.forEach(function (img) { _attObserver.observe(img); });
}

function toggleAttachmentsSection() {
    _attachmentsCollapsed = !_attachmentsCollapsed;
    const task = tasks.find(function (t) { return t.id === currentDetailTaskId; });
    if (task) renderAttachmentsSection(task);
}

// ---- 上传 ----
function openAttachmentUpload() {
    const taskId = currentDetailTaskId; // 选择器可能跨任务切换，固定点击时的任务
    if (!taskId) return;
    if (!isAttachmentSupported()) { showToast('当前环境不支持附件', 'info'); return; }
    const task = tasks.find(function (t) { return t.id === taskId; });
    if (!task || _attachmentsReadOnly(task)) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = function () {
        const files = Array.prototype.slice.call(input.files || []);
        uploadAttachmentFiles(taskId, files);
    };
    input.click();
}

function _setAttachmentUploadingUi(taskId, on) {
    if (currentDetailTaskId !== taskId) return;
    const zone = document.getElementById('detail-attachments');
    const trigger = document.getElementById('detail-attachment-trigger');
    if (zone) zone.style.opacity = on ? '0.55' : '';
    if (trigger) trigger.style.opacity = on ? '0.55' : '';
}

function _uploadAttachmentRaw(taskId, file) {
    const url = '/api/attachments/upload?taskId=' + encodeURIComponent(taskId) +
        '&name=' + encodeURIComponent(file.name || 'file');
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
    }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    }).then(function (meta) {
        if (!meta || !meta.id) throw new Error('bad response');
        return meta;
    });
}

// 多文件合并为一次落盘/重绘，避免 N 个文件触发 N 次全量 PUT 与 renderView
async function uploadAttachmentFiles(taskId, files) {
    if (!taskId || !Array.isArray(files) || files.length === 0) return;
    if (!isAttachmentSupported()) { showToast('当前环境不支持附件', 'info'); return; }
    const existingTask = tasks.find(function (t) { return t.id === taskId; });
    if (!existingTask) { showToast('任务不存在，附件未上传', 'warning'); return; }
    if (_attachmentsReadOnly(existingTask)) { showToast('只读任务不能上传附件', 'info'); return; }
    const accepted = [];
    files.forEach(function (file) {
        if (!file) return;
        if (file.size > ATTACHMENT_MAX_BYTES) {
            showToast('「' + file.name + '」超过 20MB，未上传', 'warning');
            return;
        }
        accepted.push(file);
    });
    if (accepted.length === 0) return;
    _setAttachmentUploadingUi(taskId, true);
    let results;
    try {
        results = await Promise.all(accepted.map(async function (file) {
            try {
                return { meta: await _uploadAttachmentRaw(taskId, file) };
            } catch (err) {
                console.error('[attachments] upload failed:', file.name, err);
                return { error: err };
            }
        }));
    } finally {
        _setAttachmentUploadingUi(taskId, false);
    }
    const task = tasks.find(function (t) { return t.id === taskId; });
    if (!task) {
        showToast('任务已被删除，已上传的附件未关联', 'error');
        return;
    }
    const metas = results.map(function (r) { return r.meta; }).filter(Boolean);
    if (metas.length) {
        if (!Array.isArray(task.attachments)) task.attachments = [];
        metas.forEach(function (meta) {
            task.attachments.push({
                id: meta.id, name: meta.name, size: meta.size, mime: meta.mime, addedAt: meta.addedAt
            });
        });
        if (typeof touchTask === 'function') touchTask(task);
        saveData();
        if (currentDetailTaskId === taskId) renderAttachmentsSection(task);
        if (typeof renderView === 'function') renderView();
    }
    const failed = accepted.length - metas.length;
    if (metas.length) {
        const addedText = metas.length === 1
            ? '「' + (metas[0].name || '') + '」'
            : metas.length + ' 个附件';
        showToast('已添加' + addedText + (failed ? '，' + failed + ' 个失败' : ''),
            failed ? 'warning' : 'success');
    } else {
        const err = results.find(function (r) { return r.error; });
        showToast('附件上传失败：' + (err && err.error && err.error.message ? err.error.message : '未知错误'), 'error');
    }
}

function removeAttachment(taskId, attId) {
    const task = tasks.find(function (t) { return t.id === taskId; });
    if (!task || !Array.isArray(task.attachments)) return;
    if (_attachmentsReadOnly(task)) {
        showToast('只读任务不能移除附件', 'info');
        return;
    }
    const att = task.attachments.find(function (a) { return a.id === attId; });
    if (!att) return;
    const doRemove = function () {
        task.attachments = task.attachments.filter(function (a) { return a.id !== attId; });
        if (typeof touchTask === 'function') touchTask(task);
        saveData();
        if (currentDetailTaskId === taskId) renderAttachmentsSection(task);
        if (typeof renderView === 'function') renderView();
        showToast('已移除附件「' + (att.name || '') + '」', 'success');
    };
    const message = '移除附件「' + (att.name || '文件') + '」？文件会从服务器删除。';
    const run = function () {
        // 先删磁盘再改元数据；磁盘失败（文件已不存在）也照常清理元数据
        fetch(attachmentUrl(taskId, attId), { method: 'DELETE' })
            .catch(function () { /* 忽略：本地元数据仍需清理 */ })
            .finally(doRemove);
    };
    if (typeof showConfirmToast === 'function') {
        showConfirmToast(message, run, null, { confirmLabel: '移除', cancelLabel: '取消' });
    } else if (window.confirm(message)) {
        run();
    }
}

// ==================== 整面板拖放上传 ====================
// 拖放目标＝整个右侧任务详情面板（不再局限附件区）：拖到面板任意位置都能添加，
// 面板加 inset 描边 + 底部提示气泡。约束：
//   · 只有 dataTransfer.types 含 'Files' 才接管，避免把面板内文字拖拽/选中误判成上传；
//   · 外部订阅任务、只读态、无服务端能力时不接管（浏览器保持默认行为）。
let _attPanelCssInjected = false;
function _ensureAttachmentPanelCss() {
    if (_attPanelCssInjected) return;
    _attPanelCssInjected = true;
    const style = document.createElement('style');
    style.id = 'attachment-drop-css';
    style.textContent = `
#task-detail-panel.att-drop-active { box-shadow: inset 0 0 0 2px var(--accent-color, #3b82f6); }
#task-detail-panel.att-drop-active::after {
    content: '松开即可添加到当前任务';
    position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%);
    padding: 6px 14px; border-radius: 9999px; font-size: 12px; line-height: 1.4;
    background: var(--accent-color, #3b82f6); color: #fff;
    pointer-events: none; z-index: 6; white-space: nowrap;
}
`;
    document.head.appendChild(style);
}

function _canAcceptAttachmentDrop() {
    if (!currentDetailTaskId || !isAttachmentSupported()) return false;
    if (typeof detailReadOnly !== 'undefined' && detailReadOnly) return false;
    const task = tasks.find(function (t) { return t.id === currentDetailTaskId; });
    return !!task && !task.extSourceId;
}

function _dragHasFiles(e) {
    const types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
    return false;
}

function _bindDetailPanelDropZone() {
    const panel = document.getElementById('task-detail-panel');
    if (!panel || panel._attDropBound) return;
    panel._attDropBound = true;
    _ensureAttachmentPanelCss();
    panel.addEventListener('dragover', onDetailPanelDragOver);
    panel.addEventListener('dragleave', onDetailPanelDragLeave);
    panel.addEventListener('drop', onDetailPanelDrop);
}

function onDetailPanelDragOver(e) {
    if (!_canAcceptAttachmentDrop() || !_dragHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const panel = document.getElementById('task-detail-panel');
    if (panel) panel.classList.add('att-drop-active');
}

function onDetailPanelDragLeave(e) {
    const panel = document.getElementById('task-detail-panel');
    if (!panel) return;
    // dragleave 会在子元素间反复冒泡：relatedTarget 仍在面板内则忽略
    if (e.relatedTarget && panel.contains(e.relatedTarget)) return;
    panel.classList.remove('att-drop-active');
}

function onDetailPanelDrop(e) {
    const panel = document.getElementById('task-detail-panel');
    if (panel) panel.classList.remove('att-drop-active');
    if (!_canAcceptAttachmentDrop() || !_dragHasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
    uploadAttachmentFiles(currentDetailTaskId, files);
}

// 粘贴上传：备注框内 Ctrl+V 有图片时上传为附件（FR-10 落地前先走这条通道）
function handleAttachmentPaste(e) {
    const taskId = currentDetailTaskId;
    if (!taskId || !isAttachmentSupported()) return;
    const task = tasks.find(function (t) { return t.id === taskId; });
    if (!task || _attachmentsReadOnly(task)) return;
    const items = (e.clipboardData && e.clipboardData.items) ? Array.prototype.slice.call(e.clipboardData.items) : [];
    const imgs = items.filter(function (it) { return it.kind === 'file' && /^image\//.test(it.type); });
    if (!imgs.length) return;
    e.preventDefault();
    const files = [];
    imgs.forEach(function (it, i) {
        const f = it.getAsFile();
        if (!f) return;
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        files.push(new File([f], '粘贴图片-' + Date.now() + (i ? '-' + i : '') + '.' + ext, { type: f.type }));
    });
    uploadAttachmentFiles(taskId, files);
}

// ---- 预览浮层 ----
function openAttachmentPreview(taskId, attId) {
    const task = tasks.find(function (t) { return t.id === taskId; });
    const att = task && (task.attachments || []).find(function (a) { return a.id === attId; });
    if (!att) return;
    closeAttachmentPreview();
    const url = attachmentUrl(taskId, attId);
    const overlay = document.createElement('div');
    overlay.id = 'attachment-lightbox';
    // modal-overlay：自动纳入 isAnyOverlayOpen()，Esc/快捷键让位
    overlay.className = 'modal-overlay fixed inset-0 flex items-center justify-center';
    overlay.style.zIndex = '80';
    overlay.style.background = 'rgba(0,0,0,.72)';
    const isImg = isInlineImage(att);
    overlay.innerHTML =
        '<div class="max-w-[92vw] max-h-[90vh] flex flex-col items-center gap-3" onclick="event.stopPropagation()">' +
            (isImg
                ? '<img src="' + url + '" alt="' + escapeHtml(att.name || '') + '" class="max-w-[92vw] max-h-[80vh] rounded-lg shadow-2xl object-contain">'
                : '<div class="px-8 py-10 rounded-xl bg-theme-secondary text-theme-primary flex flex-col items-center gap-2"><i class="fas ' + _attachmentFileIcon(att.mime) + ' text-3xl"></i><span class="text-sm">' + escapeHtml(att.name || '') + '</span></div>') +
            '<div class="flex items-center gap-3 text-xs text-white/85">' +
                '<span class="truncate max-w-[60vw]">' + escapeHtml(att.name || '') + ' · ' + formatAttachmentSize(att.size) + '</span>' +
                '<a href="' + url + '" download="' + escapeHtml(att.name || 'file') + '" class="px-2 py-1 rounded border border-white/40 hover:bg-white/15 transition">下载</a>' +
                '<button type="button" onclick="closeAttachmentPreview()" class="px-2 py-1 rounded border border-white/40 hover:bg-white/15 transition">关闭</button>' +
            '</div>' +
        '</div>';
    overlay.addEventListener('click', closeAttachmentPreview);
    document.body.appendChild(overlay);
    _attLightboxEl = overlay;
}

function closeAttachmentPreview() {
    if (_attLightboxEl && _attLightboxEl.parentNode) _attLightboxEl.parentNode.removeChild(_attLightboxEl);
    _attLightboxEl = null;
}

// ---- 永久删除级联（C6-3 / C6-7）----
function cascadeDeleteAttachments(taskId) {
    if (!taskId || !isAttachmentSupported()) return;
    fetch('/api/attachments/task/' + encodeURIComponent(taskId), { method: 'DELETE' })
        .catch(function (err) { console.warn('[attachments] cascade delete failed:', err); });
}

// ---- 任务行角标（V6-2：不改变行高）----
function renderAttachmentBadge(task) {
    const n = _attachmentsOf(task).length;
    if (!n) return '';
    return '<i class="fas fa-paperclip text-[10px] text-theme-muted ml-1.5 flex-shrink-0" title="' + n + ' 个附件"></i>';
}
