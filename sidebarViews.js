// ==================== 侧边栏：清单、标签、过滤器（从 views.js 拆分） ====================

// 当前正在编辑/新建的清单ID（null=新建，id=编辑）
let editingListId = null;

// 点击编辑框外部时保存并关闭
document.addEventListener('click', function(e) {
    // 清单编辑框
    if (editingListId !== null) {
        const listEditForm = document.querySelector('#lists-container [data-edit-form="list"]');
        if (listEditForm && !listEditForm.contains(e.target)) {
            const nameInput = document.getElementById('new-list-name');
            if (nameInput && nameInput.value.trim()) {
                saveListInput();
            } else {
                hideAddListInput();
            }
        }
    }
    // 标签编辑框
    if (editingTagId !== null) {
        const tagEditForm = document.querySelector('#sidebar-tags-container [data-edit-form="tag"]');
        if (tagEditForm && !tagEditForm.contains(e.target)) {
            const nameInput = document.getElementById('new-tag-name');
            if (nameInput && nameInput.value.trim()) {
                saveTagInput();
            } else {
                hideAddTagInput();
            }
        }
    }
});

// ==================== 清单渲染与归档管理 ====================

// ==================== 清单树（多级层级）辅助 ====================
function getList(id) { return lists.find(l => l.id === id); }

// 将 lists 重排为树的前序遍历，保证父节点总在其子节点之前；
// 同时把 parentId 指向不存在节点的孤儿回退顶层，避免悬空引用。
function normalizeListsOrder() {
    lists.forEach(l => { if (l.parentId && !getList(l.parentId)) l.parentId = null; });
    const byParent = {};
    lists.forEach(l => { const p = l.parentId || null; (byParent[p] = byParent[p] || []).push(l); });
    const result = [];
    (function emit(pid) {
        (byParent[pid] || []).forEach(ch => { result.push(ch); if (ch.isFolder) emit(ch.id); });
    })(null);
    // 安全兜底：任何未被发出的节点（理论上不会发生）补到末尾
    lists.forEach(l => { if (result.indexOf(l) === -1) result.push(l); });
    lists = result;
}

// ancestorId 是否为 nodeId 的祖先（含间接）
function isAncestor(ancestorId, nodeId) {
    let cur = getList(nodeId);
    while (cur && cur.parentId) {
        if (cur.parentId === ancestorId) return true;
        cur = getList(cur.parentId);
    }
    return false;
}

function isAncestorOfCurrent(folderId) {
    if (!currentListId) return false;
    return isAncestor(folderId, currentListId);
}

// 文件夹是否应展开：默认展开；但若其为当前选中清单的祖先则强制展开（保证可见/高亮）
function shouldExpandFolder(folderId) {
    const f = getList(folderId);
    if (!f) return false;
    if (isAncestorOfCurrent(folderId)) return true;
    return f.collapsed !== true;
}

// 递归统计某清单集下所有叶子清单的未完成任务数（map: listId -> 未完成数）
function folderUncompleted(map, folderId) {
    let c = 0;
    lists.filter(l => l.parentId === folderId && !l.archived).forEach(ch => {
        if (ch.isFolder) c += folderUncompleted(map, ch.id);
        else c += (map[ch.id] || 0);
    });
    return c;
}

// ==================== 清单渲染与归档管理 ====================

let draggingListId = null;     // 当前正在拖拽的清单/清单集 id
let pendingNewFolder = null;   // 刚由"合并"新建、仍在命名中的清单集（取消时回退）

function renderLists(force) {
    const container = document.getElementById('lists-container');
    if (!container) return;

    // 编辑中跳过自动刷新触发的重建（避免行内编辑焦点丢失）；force=true 时强制重建（editList/showAddListInput 等显式调用）
    if (!force && editingListId !== null) return;

    container.innerHTML = '';

    // 未完成任务按清单预聚合，避免递归计数时重复遍历 tasks
    const uncompletedMap = {};
    tasks.forEach(t => { if (!t.completed) uncompletedMap[t.listId] = (uncompletedMap[t.listId] || 0) + 1; });

    const topLevel = lists.filter(l => !l.archived && (!l.parentId || !getList(l.parentId)));
    for (let i = 0; i < topLevel.length; i++) {
        appendListGap(container, null, i);
        renderListNode(topLevel[i], 0, container, uncompletedMap);
    }
    appendListGap(container, null, topLevel.length);

    // 已归档清单入口（放在清单分组末位，"新建清单"按钮之前）
    const archivedLists = lists.filter(l => l.archived);
    if (archivedLists.length > 0) {
        const archivedBtn = document.createElement('button');
        archivedBtn.id = 'sidebar-archived-btn';
        archivedBtn.className = `w-full text-left px-3 py-1 rounded-lg hover:bg-theme-tertiary transition text-theme-muted flex items-center justify-center gap-2 ${currentListId === '__archived__' ? 'bg-theme-tertiary font-semibold' : ''}`;
        archivedBtn.innerHTML = `
            <i class="fas fa-archive w-3 text-center text-xs"></i>
            <span class="sidebar-text flex-1">已归档</span>
        `;
        archivedBtn.onclick = () => viewArchivedLists();
        container.appendChild(archivedBtn);
    }

    // 如果正在新建清单，在末位插入表单
    if (editingListId === '__new__') {
        container.appendChild(createListEditForm(null));
    }

    updateTaskListSelect();
    updateSettingsListSelect();
    updateSidebarHighlight();
    applySectionCollapse();
    if (editingListId) ensureSectionVisible('lists');
}

// 在兄弟节点之间插入一个"落点空隙"，用于排序/同级移动/移入文件夹
function appendListGap(parentEl, parentId, index) {
    const gap = document.createElement('div');
    gap.className = '';
    gap.style.height = '3px';
    gap.style.borderRadius = '4px';
    gap.addEventListener('dragover', e => handleListDragOver(e, 'gap'));
    gap.addEventListener('drop', e => handleListDrop(e, null, 'gap', parentId, index));
    parentEl.appendChild(gap);
}

// 行内名称输入框：编辑态下替换行内名称文本为 input（方案A：名称原地编辑，其余控件留在下方表单）
// saveCall / cancelCall 为内联 JS 表达式（如 saveListInput() / editingListId=null; renderLists();）
function inlineNameInput(id, value, saveCall, cancelCall) {
    // onblur 时先确认自身仍存在（避免 Enter 保存后元素被移除再次触发 blur 导致二次保存报错）
    return `<input id="${id}" type="text" value="${escapeHtml(value)}" maxlength="20" class="flex-1 min-w-0 px-1 py-0 rounded border border-accent bg-theme-secondary text-theme-primary text-sm" onkeydown="if(event.key==='Enter'){event.preventDefault(); ${saveCall}} else if(event.key==='Escape'){event.preventDefault(); ${cancelCall}}" onblur="if(document.getElementById('${id}') && !(event.relatedTarget && event.relatedTarget.closest('[data-edit-form]'))){ ${saveCall} }">`;
}

function renderListNode(node, depth, container, uncompletedMap) {
    const isFolder = !!node.isFolder;
    const row = document.createElement('button');
    row.dataset.listId = node.id;
    row.className = `w-full text-left px-3 py-1 rounded-lg hover:bg-theme-tertiary transition text-theme-primary flex items-center justify-center gap-2 group ${currentListId === node.id ? 'bg-accent-soft text-accent-dark' : ''}`;
    row.style.cursor = 'pointer';

    // 默认清单不可拖拽、不可作为合并目标
    if (node.id !== 'default') {
        row.draggable = true;
        row.addEventListener('dragstart', e => handleListDragStart(e, node.id));
        row.addEventListener('dragend', handleListDragEnd);
        row.addEventListener('dragover', e => handleListDragOver(e, 'merge'));
        row.addEventListener('drop', e => handleListDrop(e, node.id, 'merge', null, null));
    }

    if (isFolder) {
        const expanded = shouldExpandFolder(node.id);
        // 改进：去掉展开箭头，文件夹图标直接作为展开/收起开关（fa-folder-open=展开 / fa-folder=收起），
        // 名称与普通清单/标签同竖线对齐（文件夹图标占 w-3，与普通清单圆点 w-3 同宽）
        const nameHtml = editingListId === node.id && node.id !== 'default'
            ? inlineNameInput('new-list-name', node.name || '', 'saveListInput()', 'editingListId=null; renderLists();')
            : `<span class="sidebar-text flex-1 truncate cursor-pointer" ondblclick="event.stopPropagation(); editList('${node.id}')" title="双击编辑清单集">${node.name || '未命名清单集'}</span>`;
        row.innerHTML = `
            <i class="fas ${expanded ? 'fa-folder-open' : 'fa-folder'} w-3 text-center text-sm flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-accent-secondary transition" style="color:${node.color || '#f59e0b'}" onclick="event.stopPropagation(); toggleFolder('${node.id}')" ondblclick="event.stopPropagation(); editList('${node.id}')" title="${expanded ? '收起' : '展开'}清单集（双击编辑）"></i>
            ${nameHtml}
            ${folderUncompleted(uncompletedMap, node.id) > 0 ? `<span class="sidebar-count text-xs text-theme-muted w-5 text-right">${folderUncompleted(uncompletedMap, node.id)}</span>` : '<span class="sidebar-count w-5"></span>'}
        `;
        // 单击清单集整行 = 筛选其内部所有清单的任务（复用 selectList，与普通清单行为一致）；
        // 展开/收起仅由前面的文件夹图标触发（见上方 <i> 的 onclick，已 stopPropagation）。
        row.onclick = () => selectList(node.id);
    } else {
        const uncompletedCount = uncompletedMap[node.id] || 0;
        const nameHtml = editingListId === node.id && node.id !== 'default'
            ? inlineNameInput('new-list-name', node.name || '', 'saveListInput()', 'editingListId=null; renderLists();')
            : `<span class="sidebar-text flex-1 truncate cursor-pointer" ondblclick="event.stopPropagation(); editList('${node.id}')" title="双击编辑名称">${node.name}</span>`;
        row.innerHTML = `
            <span class="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-accent-secondary transition" style="background-color: ${node.color}" onclick="event.stopPropagation(); editList('${node.id}')"></span>
            ${nameHtml}
            ${uncompletedCount > 0 ? `<span class="sidebar-count text-xs text-theme-muted w-5 text-right">${uncompletedCount}</span>` : '<span class="sidebar-count w-5"></span>'}
        `;
        row.onclick = () => selectList(node.id);
    }
    container.appendChild(row);

    // 正在编辑此节点时，在其下方插入编辑表单
    if (editingListId === node.id) {
        container.appendChild(createListEditForm(node));
    }

    // 文件夹且展开时，递归渲染其子节点：取消左侧缩进（paddingLeft=0），
    // 使清单集内的清单与一级清单左对齐（行内 px-3 一致），仅保留左侧竖线以区分是否在清单集内。
    // 注意：用 inset box-shadow 画竖线而非 border-left —— border 会占用 3px 布局宽度，导致子清单内容右移 3px 与一级清单错位；
    // inset 阴影不占布局，内容仍对齐，同时保留 3px 竖线。
    if (isFolder && shouldExpandFolder(node.id)) {
        const childContainer = document.createElement('div');
        childContainer.className = 'mt-1';
        childContainer.style.paddingLeft = '0px';
        childContainer.style.boxShadow = 'inset 3px 0 0 0 var(--border-color, rgba(128,128,128,0.25))';
        const children = lists.filter(l => l.parentId === node.id && !l.archived);
        for (let i = 0; i < children.length; i++) {
            appendListGap(childContainer, node.id, i);
            renderListNode(children[i], depth + 1, childContainer, uncompletedMap);
        }
        appendListGap(childContainer, node.id, children.length);
        container.appendChild(childContainer);
    }
}

// ==================== 清单拖拽 / 合并 / 排序 ====================

// 当前高亮的元素（仅一个）+ rAF 收敛，避免每次 dragover 全文档扫描与反复重排
let activeDragEl = null;
let dragOverRAF = null;
let pendingDragEl = null;
let pendingDragMode = null;

function clearListDragHighlight() {
    if (dragOverRAF) { cancelAnimationFrame(dragOverRAF); dragOverRAF = null; }
    if (activeDragEl) {
        activeDragEl.style.background = '';
        activeDragEl.style.boxShadow = '';
        activeDragEl.style.transform = '';
        activeDragEl.style.transition = '';
        activeDragEl = null;
    }
}

// 仅当目标元素变化时才写 DOM；gap 用 transform（合成层）而非改 height，避免重排卡顿
function applyDragHighlight(el, mode) {
    if (el === activeDragEl) return;
    if (activeDragEl) {
        activeDragEl.style.background = '';
        activeDragEl.style.boxShadow = '';
        activeDragEl.style.transform = '';
        activeDragEl.style.transition = '';
    }
    activeDragEl = el;
    el.style.transition = 'none'; // 高亮期间关闭补间，消除动画拖影
    if (mode === 'gap') {
        el.style.background = '#3b82f6';
        el.style.transform = 'scaleY(2.4)';
    } else {
        el.style.boxShadow = 'inset 0 0 0 2px #3b82f6';
    }
}

function handleListDragStart(e, id) {
    if (id === 'default') { e.preventDefault(); return; }
    draggingListId = id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
    // 让被拖拽行变淡提示"已拿起"；opacity 走合成层，不触发重排
    const src = e.currentTarget;
    if (src && src.style) src.style.opacity = '0.4';
}

function handleListDragEnd(e) {
    if (e) { const src = e.currentTarget; if (src && src.style) src.style.opacity = ''; }
    clearListDragHighlight();
    draggingListId = null;
}

function handleListDragOver(e, mode) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    // 记录最新目标，再用 rAF 把高亮收敛到每帧一次、与绘制对齐，避免高频事件丢帧/不跟手
    pendingDragEl = e.currentTarget;
    pendingDragMode = mode;
    if (dragOverRAF) return;
    dragOverRAF = requestAnimationFrame(() => {
        dragOverRAF = null;
        applyDragHighlight(pendingDragEl, pendingDragMode);
    });
}

function handleListDrop(e, targetId, mode, parentId, index) {
    e.preventDefault();
    const draggedId = draggingListId;
    clearListDragHighlight();
    draggingListId = null;
    if (!draggedId) return;
    if (mode === 'gap') doReorderToGap(draggedId, parentId, index);
    else doMerge(draggedId, targetId);
}

function toggleFolder(folderId) {
    const f = getList(folderId);
    if (!f) return;
    f.collapsed = (f.collapsed === true) ? false : true;
    saveData();
    renderLists();
}

// ==================== 侧边栏分区（清单/标签/过滤器）展开/收起 ====================
// 折叠状态持久化到 localStorage，刷新后保持
const SECTION_COLLAPSE_KEY = 'tacklist_section_collapsed';
let sectionCollapsed = { lists: false, tags: false, filters: false };
(function loadSectionCollapse() {
    try {
        const saved = JSON.parse(localStorage.getItem(SECTION_COLLAPSE_KEY) || '{}');
        if (saved && typeof saved === 'object') {
            sectionCollapsed.lists = !!saved.lists;
            sectionCollapsed.tags = !!saved.tags;
            sectionCollapsed.filters = !!saved.filters;
        }
    } catch (_) {}
})();
function saveSectionCollapse() {
    try { localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(sectionCollapsed)); } catch (_) {}
}
function toggleSectionCollapse(key) {
    if (!(key in sectionCollapsed)) return;
    sectionCollapsed[key] = !sectionCollapsed[key];
    saveSectionCollapse();
    applySectionCollapse();
}
// 依据状态设置各分区容器可见性与头部箭头
function applySectionCollapse() {
    const containers = { lists: 'lists-container', tags: 'sidebar-tags-container', filters: 'sidebar-filters-container' };
    const headers = { lists: 'sidebar-lists-header', tags: 'sidebar-tags-section', filters: 'sidebar-filters-section' };
    ['lists', 'tags', 'filters'].forEach(key => {
        const c = document.getElementById(containers[key]);
        if (c) c.classList.toggle('hidden', !!sectionCollapsed[key]);
        const h = document.getElementById(headers[key]);
        if (h) {
            const chev = h.querySelector('.section-chevron');
            if (chev) chev.className = `section-chevron fas ${sectionCollapsed[key] ? 'fa-chevron-right' : 'fa-chevron-down'} w-3 text-xs text-theme-muted flex-shrink-0 opacity-0 group-hover:opacity-100 transition`;
        }
    });
}
// 编辑某分区时强制展开（不影响已保存的折叠状态）
function ensureSectionVisible(key) {
    const containers = { lists: 'lists-container', tags: 'sidebar-tags-container', filters: 'sidebar-filters-container' };
    const headers = { lists: 'sidebar-lists-header', tags: 'sidebar-tags-section', filters: 'sidebar-filters-section' };
    const c = document.getElementById(containers[key]);
    if (c) c.classList.remove('hidden');
    const h = document.getElementById(headers[key]);
    if (h) {
        const chev = h.querySelector('.section-chevron');
        if (chev) chev.className = 'section-chevron fas fa-chevron-down w-3 text-xs text-theme-muted flex-shrink-0 opacity-0 group-hover:opacity-100 transition';
    }
    if (key in sectionCollapsed && sectionCollapsed[key]) {
        sectionCollapsed[key] = false;
        saveSectionCollapse();
    }
}

// 拖到清单/清单集"行上"：合并成清单集
function doMerge(draggedId, targetId) {
    if (!draggedId || !targetId) return;
    if (draggedId === targetId) return;
    // 若上一个合并产生的清单集尚未命名/取消，先回退它，避免叠加
    if (pendingNewFolder) { revertNewFolder(); }
    if (targetId === 'default') { showToast('默认清单不能放入清单集', 'warning'); return; }
    const dragged = getList(draggedId), target = getList(targetId);
    if (!dragged || !target) return;
    // 防循环：不能把清单集放入自身或其子孙
    if (isAncestor(draggedId, targetId) || isAncestor(targetId, draggedId)) {
        showToast('不能将清单集放入自身的子级', 'warning');
        return;
    }
    if (target.isFolder) {
        // 加入已有清单集（不再询问名称）
        dragged.parentId = targetId;
        normalizeListsOrder();
        saveData();
        renderLists();
        showToast('已加入清单集', 'success');
        return;
    }
    // 首次合并：新建清单集，并把双方归入，随后内联输入名称
    const newFolder = {
        id: generateId(),
        name: '',
        color: target.color || '#f59e0b',
        isFolder: true,
        parentId: dragged.parentId || null
    };
    const draggedOldParent = dragged.parentId || null;
    const targetOldParent = target.parentId || null;
    const idx = lists.findIndex(l => l.id === draggedId);
    lists.splice(idx, 0, newFolder);
    dragged.parentId = newFolder.id;
    target.parentId = newFolder.id;
    normalizeListsOrder();
    pendingNewFolder = {
        id: newFolder.id,
        revert: { [draggedId]: draggedOldParent, [targetId]: targetOldParent, folderParent: newFolder.parentId }
    };
    editingListId = newFolder.id;
    saveData();
    renderLists(true); // 正处于编辑态（editingListId 已设置），须强制重建以立即显示清单集与命名输入框
    setTimeout(() => { const inp = document.getElementById('new-list-name'); if (inp) inp.focus(); }, 50);
}

// 拖到"空隙"：排序 / 移出原集 / 移入某集（reparent）
function doReorderToGap(draggedId, parentId, index) {
    if (!draggedId) return;
    if (parentId && (parentId === draggedId || isAncestor(draggedId, parentId))) {
        showToast('不能将清单集拖入自身或其子级', 'warning');
        return;
    }
    const dragged = getList(draggedId);
    if (!dragged) return;
    if (draggedId === 'default' && parentId) { showToast('默认清单必须保持在顶层', 'warning'); return; }
    const newParent = parentId || null;
    const siblings = lists.filter(l => (l.parentId || null) === newParent && !l.archived);
    const targetSibling = siblings[index];
    if (targetSibling && targetSibling.id === draggedId) return; // 落入自身原位，无变化
    lists = lists.filter(l => l.id !== draggedId);
    let insertAt;
    if (targetSibling) {
        insertAt = lists.findIndex(l => l.id === targetSibling.id);
    } else {
        const childrenNow = lists.filter(l => (l.parentId || null) === newParent);
        if (childrenNow.length > 0) {
            insertAt = lists.findIndex(l => l.id === childrenNow[childrenNow.length - 1].id) + 1;
        } else if (newParent) {
            insertAt = lists.findIndex(l => l.id === newParent) + 1;
        } else {
            insertAt = lists.length;
        }
    }
    if (insertAt < 0) insertAt = lists.length;
    dragged.parentId = newParent;
    lists.splice(insertAt, 0, dragged);
    normalizeListsOrder();
    saveData();
    renderLists(true); // drop 属显式操作，强制重建确保即时反馈（编辑态守卫会拦截非强制渲染）
}

// 取消新建清单集的命名时，回退到合并前状态
function revertNewFolder() {
    const pf = pendingNewFolder;
    pendingNewFolder = null;
    if (!pf) return;
    const folder = getList(pf.id);
    if (folder) lists = lists.filter(l => l.id !== pf.id);
    Object.keys(pf.revert).forEach(id => {
        if (id === 'folderParent') return;
        const l = getList(id);
        if (l) l.parentId = pf.revert[id];
    });
    normalizeListsOrder();
    saveData();
}

let listDeleteConfirming = null;
let listArchiveConfirming = null;

function createListEditForm(existingList) {
    const form = document.createElement('div');
    form.className = 'mt-1 mb-1 p-3 bg-theme-tertiary rounded-lg border border-theme';
    form.setAttribute('data-edit-form', 'list');
    const isDefault = existingList && existingList.id === 'default';
    const isFolder = existingList && existingList.isFolder;
    form.innerHTML = `
        <input type="hidden" id="edit-list-id" value="${existingList ? existingList.id : ''}">
        <div class="flex items-center gap-2">
            ${!existingList ? `<input id="new-list-name" type="text" value="" maxlength="20" class="flex-1 min-w-0 px-1 py-0 rounded border border-accent bg-theme-secondary text-theme-primary text-sm" onkeydown="if(event.key==='Enter'){event.preventDefault(); saveListInput()}">` : ''}
            <input type="color" id="new-list-color" value="${existingList ? existingList.color : '#3b82f6'}" class="w-8 h-8 rounded cursor-pointer flex-shrink-0">
            ${existingList && existingList.id !== 'default' ? `
                <button onclick="deleteListInput()" id="list-delete-inline-btn" class="flex items-center justify-center w-8 h-8 rounded-lg border ${listDeleteConfirming === existingList.id ? 'bg-red-600 text-white border-red-600' : 'border-red-500 text-red-500 hover:bg-red-50'} transition" title="${listDeleteConfirming === existingList.id ? '确认删除' : (isFolder ? '删除清单集' : '删除清单')}">
                    <i class="fas fa-trash text-sm"></i>
                </button>
            ` : ''}
            ${existingList && existingList.id !== 'default' && !existingList.archived && !existingList.isFolder ? `
                <button onclick="archiveListConfirm()" id="list-archive-inline-btn" class="flex items-center justify-center w-8 h-8 rounded-lg border ${listArchiveConfirming === existingList.id ? 'bg-amber-600 text-white border-amber-600' : 'border-amber-500 text-amber-500 hover:bg-amber-50'} transition" title="${listArchiveConfirming === existingList.id ? '确认归档' : '归档清单'}">
                    <i class="fas fa-archive text-sm"></i>
                </button>
            ` : ''}
            ${existingList ? '<div class="flex-1"></div>' : ''}
            <button onclick="saveListInput()" id="list-save-btn" class="flex items-center justify-center w-8 h-8 rounded-lg bg-accent text-white hover:bg-accent-hover transition" title="${existingList ? '保存' : '添加'}">
                <i class="fas fa-check text-sm"></i>
            </button>
            <button onclick="hideAddListInput()" class="flex items-center justify-center w-8 h-8 rounded-lg border border-theme text-theme-secondary hover:bg-theme-secondary transition" title="取消">
                <i class="fas fa-times text-sm"></i>
            </button>
        </div>
    `;
    setTimeout(() => {
        const nameInput = document.getElementById('new-list-name');
        if (nameInput && !isDefault) nameInput.focus();
    }, 50);
    return form;
}

function deleteListInput() {
    const listId = document.getElementById('edit-list-id').value;
    if (!listId || listId === 'default') return;

    if (listDeleteConfirming === listId) {
        // 第二次点击：确认删除
        const list = lists.find(l => l.id === listId);
        const listName = list ? list.name : '该清单';
        const isFolder = list && list.isFolder;

        if (isFolder) {
            // 清单集：子清单回退顶层（不删除其中的任务）
            lists.forEach(l => { if (l.parentId === listId) l.parentId = null; });
            lists = lists.filter(l => l.id !== listId);
            if (currentListId === listId) {
                currentListId = null;
                _saveFilterState();
            }
            listDeleteConfirming = null;
            editingListId = null;
            normalizeListsOrder();
            saveData();
            renderLists();
            renderTags();
            renderFilters();
            renderView();
            updateSidebarHighlight();
            showToast(`清单集"${listName}"已删除，子清单已移回顶层`, 'success');
            return;
        }

        // 普通清单：弹出选择弹窗，让用户决定任务处理方式
        const taskCount = tasks.filter(t => t.listId === listId).length;
        listDeleteConfirming = null;
        editingListId = null;
        renderLists(); // 先关闭编辑表单
        openKanbanListDeleteChoice(listId, listName, taskCount);
        return;
    }

    listDeleteConfirming = listId;
    const btn = document.getElementById('list-delete-inline-btn');
    if (btn) {
        btn.classList.add('bg-red-600', 'border-red-600', 'text-white');
        btn.classList.remove('border-red-500', 'text-red-500', 'hover:bg-red-50');
        btn.title = '确认删除';
    }

    setTimeout(() => {
        listDeleteConfirming = null;
        if (btn) {
            btn.classList.remove('bg-red-600', 'border-red-600', 'text-white');
            btn.classList.add('border-red-500', 'text-red-500', 'hover:bg-red-50');
            btn.title = '删除清单';
        }
    }, 3000);
}

function archiveListConfirm() {
    const listId = document.getElementById('edit-list-id').value;
    if (!listId || listId === 'default') return;

    if (listArchiveConfirming === listId) {
        listArchiveConfirming = null;
        editingListId = null;
        archiveList(listId);
        return;
    }

    listArchiveConfirming = listId;
    const btn = document.getElementById('list-archive-inline-btn');
    if (btn) {
        btn.classList.add('bg-amber-600', 'border-amber-600', 'text-white');
        btn.classList.remove('border-amber-500', 'text-amber-500', 'hover:bg-amber-50');
        btn.title = '确认归档';
    }

    setTimeout(() => {
        listArchiveConfirming = null;
        if (btn) {
            btn.classList.remove('bg-amber-600', 'border-amber-600', 'text-white');
            btn.classList.add('border-amber-500', 'text-amber-500', 'hover:bg-amber-50');
            btn.title = '归档清单';
        }
    }, 3000);
}

// ==================== 已归档清单 ====================

let archivedDeleteConfirming = null;
let archivedViewListId = null; // 当前查看的归档清单ID

function viewArchivedLists() {
    // 切换到归档清单视图
    currentListId = '__archived__';
    currentFilter = null;
    currentTagIds = [];
    currentFilterId = null;
    archivedViewListId = null;
    archivedDeleteConfirming = null;

    if (currentView !== 'task') {
        switchView('task');
    } else {
        renderView();
    }
    renderLists();
    renderTags();
    renderFilters();
    updateSidebarHighlight();
}

function viewArchivedListTasks(listId) {
    archivedViewListId = listId;
    renderView();
}

function renderArchivedView(container) {
    const archivedLists = lists.filter(l => l.archived);

    // 保存旧滚动位置（自动刷新等重渲染场景），避免跳回顶部
    const prevArchivedScroll = container.querySelector('.archived-view-scroll');
    const savedScrollTop = prevArchivedScroll ? prevArchivedScroll.scrollTop : 0;

    if (archivedViewListId) {
        // 查看某个归档清单的任务
        const list = lists.find(l => l.id === archivedViewListId);
        if (!list) { archivedViewListId = null; renderView(); return; }

        const listTasks = tasks.filter(t => t.listId === archivedViewListId);

        container.innerHTML = `
            <div class="archived-view-scroll p-4 h-full overflow-y-auto">
                <div class="flex items-center gap-2 mb-4">
                    <button onclick="archivedViewListId=null; renderView();" class="text-theme-secondary hover:text-theme-primary transition">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                    <span class="w-3 h-3 rounded-full opacity-50" style="background-color: ${list.color}"></span>
                    <h2 class="text-lg font-semibold text-theme-primary">${list.name}</h2>
                    <span class="text-sm text-theme-muted">${listTasks.length} 个任务</span>
                    <div class="ml-auto flex gap-2">
                        <button onclick="restoreList('${list.id}')" class="px-3 py-1.5 text-sm text-green-600 border border-green-500 rounded-lg hover:bg-green-50 transition">
                            <i class="fas fa-undo mr-1"></i>恢复
                        </button>
                        <button onclick="deleteArchivedList('${list.id}')" class="px-3 py-1.5 text-sm text-red-500 border border-red-500 rounded-lg hover:bg-red-50 transition" id="archived-delete-btn-${list.id}">
                            <i class="fas fa-trash mr-1"></i>彻底删除
                        </button>
                    </div>
                </div>
                ${listTasks.length === 0 ? '<p class="text-theme-muted text-center py-8">该清单下没有任务</p>' : ''}
                <div class="relative pl-6">
                    <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-theme"></div>
                    ${listTasks.map(task => renderArchivedTaskCard(task)).join('')}
                </div>
            </div>
        `;
    } else {
        // 显示所有归档清单列表
        container.innerHTML = `
            <div class="archived-view-scroll p-4 h-full overflow-y-auto">
                <div class="flex items-center gap-2 mb-4">
                    <button onclick="currentListId=null; renderLists(); renderView(); updateSidebarHighlight();" class="text-theme-secondary hover:text-theme-primary transition">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                    <h2 class="text-lg font-semibold text-theme-primary">已归档的清单</h2>
                </div>
                ${archivedLists.length === 0 ? '<p class="text-theme-muted text-center py-8">没有已归档的清单</p>' : ''}
                <div class="space-y-2">
                    ${archivedLists.map(list => {
                        const taskCount = tasks.filter(t => t.listId === list.id).length;
                        return `
                            <div class="flex items-center gap-3 p-3 rounded-lg border border-theme hover:bg-theme-tertiary transition cursor-pointer" onclick="viewArchivedListTasks('${list.id}')">
                                <span class="w-3 h-3 rounded-full flex-shrink-0 opacity-50" style="background-color: ${list.color}"></span>
                                <span class="flex-1 text-theme-primary">${list.name}</span>
                                <span class="text-sm text-theme-muted">${taskCount} 个任务</span>
                                <i class="fas fa-chevron-right text-xs text-theme-muted"></i>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // 同步恢复滚动位置，实现自动刷新无感
    const newArchivedScroll = container.querySelector('.archived-view-scroll');
    if (newArchivedScroll && savedScrollTop > 0) {
        newArchivedScroll.scrollTop = savedScrollTop;
    }
}

function renderArchivedTaskCard(task) {
    const list = lists.find(l => l.id === task.listId);
    const listName = list ? list.name : '';
    const listColor = list ? list.color : '#9ca3af';
    const colors = getQuadrantColorClass(task);

    let timeDisplay = '';
    if (task.startTime) {
        const d = new Date(task.startTime);
        const startHour = d.getHours().toString().padStart(2, '0');
        const startMin = d.getMinutes().toString().padStart(2, '0');
        if (task.isAllDay) {
            timeDisplay = `${d.getMonth() + 1}月${d.getDate()}日 全天`;
        } else {
            timeDisplay = `${startHour}:${startMin}`;
        }
        if (task.endTime && task.endTime !== task.startTime) {
            const ed = new Date(task.endTime);
            if (task.isAllDay) {
                timeDisplay += ` - ${ed.getMonth() + 1}月${ed.getDate()}日`;
            } else {
                const endHour = ed.getHours().toString().padStart(2, '0');
                const endMin = ed.getMinutes().toString().padStart(2, '0');
                timeDisplay += ` - ${endHour}:${endMin}`;
            }
        }
    }

    const focusMinutes = getTaskFocusMinutes(task.id);
    const progress = task.progress || 0;

    return `
        <div class="archived-task-item group flex items-start gap-4 mb-3 task-item ${task.completed ? 'opacity-60' : ''}"
             onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}', true)">
            <div class="w-8 flex-shrink-0 flex flex-col items-center justify-between self-stretch relative">
                <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : getTaskCheckboxClass(task)}">
                    ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                </div>
            </div>
            <div class="${colors.bg} rounded-r-lg p-3 flex-1 hover:opacity-80 transition" style="border-left: 4px solid ${getTaskBarColor(task, listColor)}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
                <div class="flex items-center gap-2 text-sm mb-1 text-theme-secondary">
                    ${timeDisplay ? `<span><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
                    ${listName ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${listColor}"></span>${listName}</span>` : ''}
                    ${renderTagCapsules(task, 2, 'right')}
                    ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-500"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                    ${progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-accent"></i>${progress}%</span>` : ''}
                </div>
                <div class="font-medium ${task.completed ? 'text-theme-muted' : 'text-theme-primary'}">
                    ${task.title || '新任务'}
                    ${task.important ? '<i class="fas fa-star text-yellow-500 text-sm ml-1"></i>' : ''}
                    ${task.urgent ? '<i class="fas fa-fire text-red-500 text-sm ml-1"></i>' : ''}
                </div>
                ${renderSubtaskListDisplay(task) || (task.notes ? `<div class="text-xs text-theme-secondary mt-1">${task.notes}</div>` : '')}
            </div>
        </div>
    `;
}

function archiveList(listId) {
    if (listId === 'default') {
        showToast('默认清单不能归档', 'warning');
        return;
    }

    const list = lists.find(l => l.id === listId);
    if (!list) return;

    list.archived = true;
    list.archivedAt = new Date().toISOString();

    // 如果当前正在查看此清单，清除筛选
    if (currentListId === listId) {
        currentListId = null;
        _saveFilterState();
    }

    editingListId = null;
    saveData();
    renderLists();
    renderTags();
    renderFilters();
    renderView();
    showToast(`清单"${list.name}"已归档`, 'success');
}

function restoreList(listId) {
    const list = lists.find(l => l.id === listId);
    if (!list) return;

    delete list.archived;
    delete list.archivedAt;

    archivedDeleteConfirming = null;
    archivedViewListId = null;
    if (currentListId === '__archived__') currentListId = null;
    saveData();
    renderLists();
    renderTags();
    renderFilters();
    renderView();
    updateSidebarHighlight();
    showToast(`清单"${list.name}"已恢复`, 'success');
}

function deleteArchivedList(listId) {
    if (archivedDeleteConfirming === listId) {
        // 第二次点击：彻底删除
        const list = lists.find(l => l.id === listId);
        const listName = list ? list.name : '该清单';

        // 删除该清单下的所有任务
        tasks = tasks.filter(t => t.listId !== listId);
        // 删除清单
        lists = lists.filter(l => l.id !== listId);

        if (currentListId === listId || currentListId === '__archived__') {
            currentListId = null;
        }

        archivedDeleteConfirming = null;
        archivedViewListId = null;
        saveData();
        renderLists();
        renderTags();
        renderFilters();
        renderView();
        updateSidebarHighlight();
        showToast(`已彻底删除清单"${listName}"及其所有任务`, 'success');
        return;
    }

    // 第一次点击：进入确认状态
    archivedDeleteConfirming = listId;
    const btn = document.getElementById(`archived-delete-btn-${listId}`);
    if (btn) {
        btn.style.cssText = 'padding: 0.375rem 0.75rem; font-size: 0.875rem; color: #ffffff; background-color: #dc2626; border: 1px solid #dc2626; border-radius: 0.5rem; cursor: pointer; transition: all 0.2s;';
        btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>确认彻底删除';
    }

    setTimeout(() => {
        if (archivedDeleteConfirming === listId) {
            archivedDeleteConfirming = null;
            if (btn) {
                btn.style.cssText = '';
                btn.innerHTML = '<i class="fas fa-trash mr-1"></i>彻底删除';
            }
        }
    }, 3000);
}

function selectList(listId) {
    // 看板内切换清单时，先提交/清理行内改名和未命名分组
    if (currentView === 'kanban' && typeof leaveKanbanView === 'function') {
        leaveKanbanView();
    }
    currentListId = listId;
    currentFilter = null;
    // per-list 视图偏好：清单有偏好视图时切换到该视图
    const prefView = _getCurrentListViewPrefView();
    if (prefView && currentView !== prefView) {
        switchView(prefView); // 内部已调用 renderView/renderLists/updateSidebarHighlight
    } else if (!prefView && VIEW_ORDER_DEFAULT.indexOf(currentView) === -1) {
        // 无偏好视图且当前不在任务筛选视图中，切换到默认任务视图
        switchView('task');
    } else {
        // 偏好视图已是当前视图，或无偏好视图但在任务筛选视图中：仅刷新当前视图
        renderView();
        renderLists();
        updateSidebarHighlight();
    }
    _saveFilterState();
    renderTags();
}

function updateTaskListSelect() {
    const select = document.getElementById('task-list');
    if (select) {
        select.innerHTML = '';
        lists.filter(l => !l.archived && !l.isFolder).forEach(list => {
            const option = document.createElement('option');
            option.value = list.id;
            option.textContent = list.name;
            select.appendChild(option);
        });
    }
}

function updateSettingsListSelect() {
    const select = document.getElementById('settings-default-list');
    if (select) {
        select.innerHTML = '';
        lists.filter(l => !l.archived && !l.isFolder).forEach(list => {
            const option = document.createElement('option');
            option.value = list.id;
            option.textContent = list.name;
            if (list.id === settings.defaultListId) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    }
}

// ==================== 最近7天筛选 & 侧边栏高亮 ====================

function filterNext7Days() {
    currentListId = null;
    currentFilter = 'recent7days';
    currentTagIds = [];
    currentFilterId = null;
    // 视图偏好：「最近7天」有偏好视图时切换到该视图
    const prefView = _getSpecialViewPrefView('recent7days');
    if (prefView && currentView !== prefView) {
        switchView(prefView); // 内部已调用 renderView/renderLists/updateSidebarHighlight
    } else if (!prefView && VIEW_ORDER_DEFAULT.indexOf(currentView) === -1) {
        switchView('task');
    } else {
        // 偏好视图已是当前视图，或无偏好视图但在任务筛选视图中：仅刷新当前视图
        renderView();
        renderLists();
        updateSidebarHighlight();
    }
    _saveFilterState();
    renderTags();
    renderFilters();
}

function updateSidebarHighlight() {
    // 更新侧边栏计数
    updateSidebarCounts();

    // 清除所有侧边栏按钮的高亮
    const sidebarBtns = ['sidebar-all-tasks-btn', 'sidebar-next7days-btn', 'sidebar-summary-btn'];
    sidebarBtns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.classList.remove('bg-theme-tertiary', 'font-semibold');
        }
    });

    // 清除标签按钮高亮
    document.querySelectorAll('.sidebar-tag-btn').forEach(btn => {
        btn.classList.remove('bg-theme-tertiary', 'font-semibold');
    });

    // 清除过滤器按钮高亮
    document.querySelectorAll('.sidebar-filter-btn').forEach(btn => {
        btn.classList.remove('bg-theme-tertiary', 'font-semibold');
    });

    // 清除清单按钮高亮
    document.querySelectorAll('#lists-container button').forEach(btn => {
        btn.classList.remove('bg-accent-soft', 'text-accent-dark', 'bg-theme-tertiary', 'font-semibold');
    });

    // 清除侧边栏倒计时框高亮
    const cdBox = document.getElementById('holiday-countdown');
    if (cdBox) cdBox.classList.remove('cd-active');

    // 高亮当前视图对应的按钮
    if (currentFilterId) {
        // 自定义过滤器激活时
        const btn = document.getElementById(`sidebar-filter-${currentFilterId}`);
        if (btn) btn.classList.add('bg-theme-tertiary', 'font-semibold');
    } else if (currentTagIds && currentTagIds.length > 0) {
        // 标签筛选激活时，高亮对应的标签按钮
        currentTagIds.forEach(tagId => {
            const btn = document.getElementById(`sidebar-tag-${tagId}`);
            if (btn) btn.classList.add('bg-theme-tertiary', 'font-semibold');
        });
    } else if (currentFilter === 'recent7days') {
        const btn = document.getElementById('sidebar-next7days-btn');
        if (btn) btn.classList.add('bg-theme-tertiary', 'font-semibold');
    } else if (currentView === 'summary') {
        const btn = document.getElementById('sidebar-summary-btn');
        if (btn) btn.classList.add('bg-theme-tertiary', 'font-semibold');
    } else if (currentView === 'countdown') {
        if (cdBox) cdBox.classList.add('cd-active');
    } else if (currentView === 'holiday') {
        // 独立管理视图：不与侧边栏任何导航项（含“所有任务”）联动高亮
    } else if (currentListId && VIEW_ORDER_DEFAULT.indexOf(currentView) !== -1) {
        // 六个任务筛选视图（任务/日程/周/月/四象限/看板）中选中清单时，跨视图保持清单高亮
        if (currentListId === '__archived__') {
            const btn = document.getElementById('sidebar-archived-btn');
            if (btn) btn.classList.add('bg-theme-tertiary', 'font-semibold');
        } else {
            // 清单选中时，高亮对应的清单按钮
            const listBtn = document.querySelector(`#lists-container button[data-list-id="${currentListId}"]`);
            if (listBtn) listBtn.classList.add('bg-accent-soft', 'text-accent-dark');
        }
    } else if (!currentListId) {
        // "所有任务"：不依赖 currentView，跨视图保持高亮（与"最近7天"逻辑一致）
        const btn = document.getElementById('sidebar-all-tasks-btn');
        if (btn) btn.classList.add('bg-theme-tertiary', 'font-semibold');
    }
}

function updateSidebarCounts() {
    // 所有任务：未完成且未归档的任务数
    const archivedListIds = lists.filter(l => l.archived).map(l => l.id);
    const allUncompleted = tasks.filter(t => !t.completed && !archivedListIds.includes(t.listId)).length;
    const allCountEl = document.getElementById('sidebar-all-tasks-count');
    if (allCountEl) allCountEl.textContent = allUncompleted > 0 ? allUncompleted : '';

    // 最近7天：未完成且未归档，7天内有开始时间的任务数
    const now = new Date();
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
    sevenDaysLater.setHours(23, 59, 59, 999);
    const recent7Uncompleted = tasks.filter(t => {
        if (t.completed || archivedListIds.includes(t.listId)) return false;
        if (!t.startTime) return false;
        const taskDate = new Date(t.startTime);
        return taskDate >= now && taskDate <= sevenDaysLater;
    }).length;
    const recent7CountEl = document.getElementById('sidebar-next7days-count');
    if (recent7CountEl) recent7CountEl.textContent = recent7Uncompleted > 0 ? recent7Uncompleted : '';
}

// ==================== 标签渲染与筛选 ====================

let editingTagId = null;

// ==================== 标签 / 过滤器拖拽排序（扁平数组重排，无清单集概念） ====================
let draggingTagId = null;
let draggingFilterId = null;

// 通用：在扁平数组内把 draggedId 移动到 gap 位置（gap index = 插入到 arr[index] 之前）
function reorderFlatArray(arr, draggedId, index) {
    const from = arr.findIndex(x => x.id === draggedId);
    if (from === -1) return false;
    if (index === from) return false; // 落在自身原位，无变化
    const target = arr[index];
    const item = arr[from];
    arr.splice(from, 1);
    let insertAt;
    if (target && target.id !== draggedId) insertAt = arr.findIndex(x => x.id === target.id);
    else insertAt = arr.length;
    if (insertAt < 0) insertAt = arr.length;
    arr.splice(insertAt, 0, item);
    return true;
}

function doReorderTags(draggedId, index) {
    const tags = settings.tags || [];
    if (reorderFlatArray(tags, draggedId, index)) { saveData(); renderTags(); }
}
function doReorderFilters(draggedId, index) {
    const filters = settings.filters || [];
    if (reorderFlatArray(filters, draggedId, index)) { saveData(); renderFilters(); }
}

// 在容器内插入一个"排序落点"（复用清单的同款高亮机制：handleListDragOver / clearListDragHighlight）
function appendFlatGap(container, index, onDrop) {
    const gap = document.createElement('div');
    gap.className = '';
    gap.style.height = '3px';
    gap.style.borderRadius = '4px';
    gap.addEventListener('dragover', e => handleListDragOver(e, 'gap'));
    gap.addEventListener('drop', e => {
        e.preventDefault();
        clearListDragHighlight();
        onDrop();
    });
    container.appendChild(gap);
}

function renderTags() {
    const section = document.getElementById('sidebar-tags-section');
    const container = document.getElementById('sidebar-tags-container');
    if (!section || !container) return;

    const tags = settings.tags || [];

    // 始终显示标签区域（方便创建新标签）
    section.classList.remove('hidden');

    container.innerHTML = '';

    tags.forEach((tag, i) => {
        // 排序落点（插入到当前标签之前）
        appendFlatGap(container, i, () => { if (draggingTagId) doReorderTags(draggingTagId, i); draggingTagId = null; });

        const uncompletedCount = tasks.filter(t => (t.tags || []).includes(tag.id) && !t.completed).length;
        const isActive = currentTagIds && currentTagIds.includes(tag.id);
        const btn = document.createElement('button');
        btn.id = `sidebar-tag-${tag.id}`;
        btn.className = `w-full text-left px-3 py-1 rounded-lg hover:bg-theme-tertiary transition text-theme-primary flex items-center justify-center gap-2 sidebar-tag-btn ${isActive ? 'bg-theme-tertiary font-semibold' : ''}`;
        const tagNameHtml = editingTagId === tag.id
            ? inlineNameInput('new-tag-name', tag.name || '', 'saveTagInput()', 'editingTagId=null; renderTags();')
            : `<span class="sidebar-text flex-1 cursor-pointer" ondblclick="event.stopPropagation(); showAddTagInput('${tag.id}')" title="双击编辑名称">${tag.name}</span>`;
        btn.innerHTML = `
            <span class="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-green-400 transition" style="background-color: ${tag.color}" onclick="event.stopPropagation(); showAddTagInput('${tag.id}')"></span>
            ${tagNameHtml}
            ${uncompletedCount > 0 ? `<span class="sidebar-count text-xs text-theme-muted w-5 text-right">${uncompletedCount}</span>` : '<span class="sidebar-count w-5"></span>'}
        `;
        btn.onclick = () => toggleTagFilter(tag.id);
        // 拖拽排序（仅重排顺序，不使用清单集概念）
        btn.draggable = true;
        btn.addEventListener('dragstart', e => {
            draggingTagId = tag.id;
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', tag.id); } catch (_) {}
            btn.style.opacity = '0.4';
        });
        btn.addEventListener('dragend', e => {
            if (e) { const s = e.currentTarget; if (s && s.style) s.style.opacity = ''; }
            clearListDragHighlight();
            draggingTagId = null;
        });
        container.appendChild(btn);

        // 如果正在编辑此标签，在其下方插入编辑表单
        if (editingTagId === tag.id) {
            const editForm = createTagEditForm(tag);
            container.appendChild(editForm);
        }
    });

    // 末尾排序落点（插入到所有标签之后）
    appendFlatGap(container, tags.length, () => { if (draggingTagId) doReorderTags(draggingTagId, tags.length); draggingTagId = null; });

    // 如果正在新建标签，在所有标签之后插入新建表单
    if (editingTagId === '__new__') {
        const newForm = createTagEditForm(null);
        container.appendChild(newForm);
    }
    applySectionCollapse();
    if (editingTagId) ensureSectionVisible('tags');
}

function createTagEditForm(existingTag) {
    const form = document.createElement('div');
    form.className = 'mt-1 mb-1 p-3 bg-theme-tertiary rounded-lg border border-theme';
    form.setAttribute('data-edit-form', 'tag');
    form.innerHTML = `
        <input type="hidden" id="edit-tag-id" value="${existingTag ? existingTag.id : ''}">
        <div class="flex items-center gap-2">
            ${!existingTag ? `<input id="new-tag-name" type="text" value="" maxlength="20" class="flex-1 min-w-0 px-1 py-0 rounded border border-accent bg-theme-secondary text-theme-primary text-sm" onkeydown="if(event.key==='Enter'){event.preventDefault(); saveTagInput()}">` : ''}
            <input type="color" id="new-tag-color" value="${existingTag ? existingTag.color : '#10b981'}" class="w-8 h-8 rounded cursor-pointer flex-shrink-0">
            ${existingTag ? `
                <button onclick="deleteTagInput()" id="tag-delete-inline-btn" class="flex items-center justify-center w-8 h-8 rounded-lg border border-red-500 text-red-500 hover:bg-red-50 transition" title="删除标签">
                    <i class="fas fa-trash text-sm"></i>
                </button>
            ` : ''}
            ${existingTag ? '<div class="flex-1"></div>' : ''}
            <button onclick="saveTagInput()" id="tag-save-btn" class="flex items-center justify-center w-8 h-8 rounded-lg bg-green-500 text-white hover:bg-green-600 transition" title="${existingTag ? '保存' : '添加'}">
                <i class="fas fa-check text-sm"></i>
            </button>
            <button onclick="hideAddTagInput()" class="flex items-center justify-center w-8 h-8 rounded-lg border border-theme text-theme-secondary hover:bg-theme-secondary transition" title="取消">
                <i class="fas fa-times text-sm"></i>
            </button>
        </div>
    `;
    setTimeout(() => {
        const nameInput = document.getElementById('new-tag-name');
        if (nameInput) nameInput.focus();
    }, 50);
    return form;
}

// 标签筛选切换（单选模式：点击已选标签取消，点击新标签替换）
function toggleTagFilter(tagId) {
    if (currentTagIds && currentTagIds.includes(tagId)) {
        // 再次点击取消选中
        currentTagIds = [];
    } else {
        // 单选：替换为当前标签
        currentTagIds = [tagId];
        // 清除清单和过滤器筛选
        currentListId = null;
        currentFilter = null;
        currentFilterId = null;
    }
    _saveFilterState();

    // 确保在支持任务筛选的视图中
    if (VIEW_ORDER_DEFAULT.indexOf(currentView) === -1) {
        switchView('task');
    } else {
        renderView();
        renderLists();
    }

    renderTags();
    updateSidebarHighlight();
}

// 清除标签筛选
function clearTagFilter() {
    currentTagIds = [];
    currentFilterId = null;
    _saveFilterState();
    renderView();
    renderLists();
    renderTags();
    renderFilters();
    updateSidebarHighlight();
}

// ==================== 过滤器渲染与筛选 ====================

let editingFilterId = null; // null | filterId | '__new__'
let filterDeleteConfirming = null;

function renderFilters() {
    const section = document.getElementById('sidebar-filters-section');
    const container = document.getElementById('sidebar-filters-container');
    if (!section || !container) return;

    const filters = settings.filters || [];

    // 始终显示过滤器区域（至少显示"新建过滤器"按钮）
    section.classList.remove('hidden');

    container.innerHTML = '';

    filters.forEach((filter, i) => {
        // 排序落点（插入到当前过滤器之前）
        appendFlatGap(container, i, () => { if (draggingFilterId) doReorderFilters(draggingFilterId, i); draggingFilterId = null; });

        const isActive = currentFilterId === filter.id;
        const uncompletedCount = tasks.filter(t => {
            // 简单计数：检查任务是否满足过滤条件
            return !t.completed && matchFilterConditions(t, filter);
        }).length;

        const btn = document.createElement('button');
        btn.id = `sidebar-filter-${filter.id}`;
        btn.className = `w-full text-left px-3 py-1 rounded-lg hover:bg-theme-tertiary transition text-theme-primary flex items-center justify-center gap-2 sidebar-filter-btn ${isActive ? 'bg-theme-tertiary font-semibold' : ''}`;
        const filterNameHtml = editingFilterId === filter.id
            ? inlineNameInput('new-filter-name', filter.name || '', 'saveFilterInput()', 'editingFilterId=null; renderFilters();')
            : `<span class="sidebar-text flex-1 cursor-pointer" ondblclick="event.stopPropagation(); editFilter('${filter.id}')" title="双击编辑名称">${filter.name}</span>`;
        btn.innerHTML = `
            <span class="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-accent-secondary transition" style="background-color: ${filter.color}" onclick="event.stopPropagation(); editFilter('${filter.id}')"></span>
            ${filterNameHtml}
            ${uncompletedCount > 0 ? `<span class="sidebar-count text-xs text-theme-muted w-5 text-right">${uncompletedCount}</span>` : '<span class="sidebar-count w-5"></span>'}
        `;
        btn.onclick = () => applyFilter(filter.id);
        // 拖拽排序（仅重排顺序，不使用清单集概念）
        btn.draggable = true;
        btn.addEventListener('dragstart', e => {
            draggingFilterId = filter.id;
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', filter.id); } catch (_) {}
            btn.style.opacity = '0.4';
        });
        btn.addEventListener('dragend', e => {
            if (e) { const s = e.currentTarget; if (s && s.style) s.style.opacity = ''; }
            clearListDragHighlight();
            draggingFilterId = null;
        });
        container.appendChild(btn);
        if (editingFilterId === filter.id) {
            container.appendChild(createFilterEditForm(filter));
        }
    });

    // 新建过滤器时，在末尾插入编辑表单（与标签一致，名称原地编辑）
    if (editingFilterId === '__new__') {
        container.appendChild(createFilterEditForm(null));
    }

    // 末尾排序落点（插入到所有过滤器之后）
    appendFlatGap(container, filters.length, () => { if (draggingFilterId) doReorderFilters(draggingFilterId, filters.length); draggingFilterId = null; });
    applySectionCollapse();
    if (editingFilterId) ensureSectionVisible('filters');
}

function matchFilterConditions(task, filter) {
    if (!filter.conditions) return true;
    const c = filter.conditions;

    // 过滤已归档清单
    const taskList = lists.find(l => l.id === task.listId);
    if (taskList && taskList.archived) return false;

    if (c.listIds && c.listIds.length > 0) {
        if (!c.listIds.includes(task.listId)) return false;
    }
    if (c.tagIds && c.tagIds.length > 0) {
        const taskTags = task.tags || [];
        if (!taskTags.some(tagId => c.tagIds.includes(tagId))) return false;
    }
    if (c.important === true && !task.important) return false;
    if (c.important === false && task.important) return false;
    if (c.urgent === true && !task.urgent) return false;
    if (c.urgent === false && task.urgent) return false;

    if (c.timeRange) {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart.getTime() + 86400000);
        const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
        switch (c.timeRange) {
            case 'today':
                if (!task.startTime || new Date(task.startTime) < todayStart || new Date(task.startTime) >= todayEnd) return false;
                break;
            case 'yesterday':
                const yesterdayStart = new Date(todayStart.getTime() - 86400000);
                if (!task.startTime || new Date(task.startTime) < yesterdayStart || new Date(task.startTime) >= todayStart) return false;
                break;
            case 'last3days':
                const last3Start = new Date(todayStart.getTime() - 2 * 86400000);
                if (!task.startTime || new Date(task.startTime) < last3Start || new Date(task.startTime) >= todayEnd) return false;
                break;
            case 'week':
                const weekStart = new Date(todayStart);
                weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
                if (todayStart.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
                const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
                if (!task.startTime || new Date(task.startTime) < weekStart || new Date(task.startTime) >= weekEnd) return false;
                break;
            case 'lastweek':
                const lastWeekStart = new Date(todayStart);
                lastWeekStart.setDate(lastWeekStart.getDate() - lastWeekStart.getDay() + dayOffset - 7);
                if (todayStart.getDay() === 0 && dayOffset === 1) lastWeekStart.setDate(lastWeekStart.getDate() - 7);
                const lastWeekEnd = new Date(lastWeekStart.getTime() + 7 * 86400000);
                if (!task.startTime || new Date(task.startTime) < lastWeekStart || new Date(task.startTime) >= lastWeekEnd) return false;
                break;
            case 'month':
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                if (!task.startTime || new Date(task.startTime) < monthStart || new Date(task.startTime) >= monthEnd) return false;
                break;
            case 'lastmonth':
                const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
                if (!task.startTime || new Date(task.startTime) < lastMonthStart || new Date(task.startTime) >= lastMonthEnd) return false;
                break;
            case 'overdue':
                if (!task.startTime || task.completed || new Date(task.startTime) >= todayStart) return false;
                break;
            case 'nodate':
                if (task.startTime) return false;
                break;
            case 'custom':
                if (!c.customStartDate || !c.customEndDate) return false;
                const customStart = new Date(c.customStartDate);
                const customEnd = new Date(c.customEndDate);
                customEnd.setHours(23, 59, 59, 999);
                if (!task.startTime || new Date(task.startTime) < customStart || new Date(task.startTime) > customEnd) return false;
                break;
        }
    }
    return true;
}

function createFilterEditForm(existingFilter) {
    const form = document.createElement('div');
    form.className = 'mt-1 mb-1 p-3 bg-theme-tertiary rounded-lg border border-theme';
    form.setAttribute('data-edit-form', 'filter');

    const c = existingFilter ? (existingFilter.conditions || {}) : {};
    const activeLists = lists.filter(l => !l.archived && !l.isFolder);
    const allTags = settings.tags || [];

    form.innerHTML = `
        <input type="hidden" id="edit-filter-id" value="${existingFilter ? existingFilter.id : ''}">
        <div class="flex gap-2 mb-3">
            <input type="color" id="new-filter-color" value="${existingFilter ? existingFilter.color : '#8b5cf6'}" class="w-8 h-8 rounded cursor-pointer flex-shrink-0">
            <div class="flex-1">
                <label class="text-xs text-theme-muted block mb-1">时间范围</label>
                <select id="new-filter-timeRange" class="w-full px-2 py-1 border border-theme rounded bg-theme-secondary text-theme-primary text-sm" onchange="toggleCustomDateRange()">
                    <option value="" ${!c.timeRange ? 'selected' : ''}>不限</option>
                    <option value="today" ${c.timeRange === 'today' ? 'selected' : ''}>今天</option>
                    <option value="yesterday" ${c.timeRange === 'yesterday' ? 'selected' : ''}>昨天</option>
                    <option value="last3days" ${c.timeRange === 'last3days' ? 'selected' : ''}>最近三天</option>
                    <option value="week" ${c.timeRange === 'week' ? 'selected' : ''}>本周</option>
                    <option value="lastweek" ${c.timeRange === 'lastweek' ? 'selected' : ''}>上周</option>
                    <option value="month" ${c.timeRange === 'month' ? 'selected' : ''}>本月</option>
                    <option value="lastmonth" ${c.timeRange === 'lastmonth' ? 'selected' : ''}>上月</option>
                    <option value="overdue" ${c.timeRange === 'overdue' ? 'selected' : ''}>已过期</option>
                    <option value="nodate" ${c.timeRange === 'nodate' ? 'selected' : ''}>无日期</option>
                    <option value="custom" ${c.timeRange === 'custom' ? 'selected' : ''}>自定义</option>
                </select>
            </div>
        </div>
        <div id="custom-date-range-inputs" class="mb-3 ${c.timeRange === 'custom' ? '' : 'hidden'}">
            <div class="flex gap-2">
                <div class="flex-1">
                    <label class="text-xs text-theme-muted block mb-1">开始日期</label>
                    <input type="date" id="new-filter-customStart" class="w-full px-2 py-1 border border-theme rounded bg-theme-secondary text-theme-primary text-sm" value="${c.customStartDate || ''}">
                </div>
                <div class="flex-1">
                    <label class="text-xs text-theme-muted block mb-1">结束日期</label>
                    <input type="date" id="new-filter-customEnd" class="w-full px-2 py-1 border border-theme rounded bg-theme-secondary text-theme-primary text-sm" value="${c.customEndDate || ''}">
                </div>
            </div>
        </div>
        <div class="mb-2">
            <label class="text-xs text-theme-muted block mb-1">清单</label>
            <div class="flex flex-wrap gap-1">
                ${activeLists.map(list => `
                    <label class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer hover:bg-theme-secondary transition ${c.listIds && c.listIds.includes(list.id) ? 'bg-accent-strong dark:bg-accent-strong text-accent-dark' : 'text-theme-secondary'}">
                        <input type="checkbox" class="filter-list-check hidden" value="${list.id}" ${c.listIds && c.listIds.includes(list.id) ? 'checked' : ''}>
                        <span class="w-2 h-2 rounded-full" style="background-color: ${list.color}"></span>
                        ${list.name}
                    </label>
                `).join('')}
            </div>
        </div>
        <div class="mb-2">
            <label class="text-xs text-theme-muted block mb-1">标签</label>
            <div class="flex flex-wrap gap-1">
                ${allTags.length > 0 ? allTags.map(tag => `
                    <label class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer hover:bg-theme-secondary transition ${c.tagIds && c.tagIds.includes(tag.id) ? 'text-white' : 'text-theme-secondary'}" style="${c.tagIds && c.tagIds.includes(tag.id) ? `background-color: ${tag.color}` : ''}">
                        <input type="checkbox" class="filter-tag-check hidden" value="${tag.id}" ${c.tagIds && c.tagIds.includes(tag.id) ? 'checked' : ''}>
                        ${tag.name}
                    </label>
                `).join('') : '<span class="text-xs text-theme-muted">暂无标签</span>'}
            </div>
        </div>
        <div class="mb-3">
            <label class="text-xs text-theme-muted block mb-1">优先级</label>
            <div class="flex gap-2">
                <label class="inline-flex items-center gap-1 text-xs cursor-pointer text-theme-secondary">
                    <input type="radio" name="filter-important" value="" ${c.important === null || c.important === undefined ? 'checked' : ''}> 不限
                </label>
                <label class="inline-flex items-center gap-1 text-xs cursor-pointer text-theme-secondary">
                    <input type="radio" name="filter-important" value="true" ${c.important === true ? 'checked' : ''}> 重要
                </label>
                <label class="inline-flex items-center gap-1 text-xs cursor-pointer text-theme-secondary">
                    <input type="radio" name="filter-important" value="false" ${c.important === false ? 'checked' : ''}> 不重要
                </label>
            </div>
            <div class="flex gap-2 mt-1">
                <label class="inline-flex items-center gap-1 text-xs cursor-pointer text-theme-secondary">
                    <input type="radio" name="filter-urgent" value="" ${c.urgent === null || c.urgent === undefined ? 'checked' : ''}> 不限
                </label>
                <label class="inline-flex items-center gap-1 text-xs cursor-pointer text-theme-secondary">
                    <input type="radio" name="filter-urgent" value="true" ${c.urgent === true ? 'checked' : ''}> 紧急
                </label>
                <label class="inline-flex items-center gap-1 text-xs cursor-pointer text-theme-secondary">
                    <input type="radio" name="filter-urgent" value="false" ${c.urgent === false ? 'checked' : ''}> 不紧急
                </label>
            </div>
        </div>
        <div class="flex gap-2">
            <button onclick="saveFilterInput()" class="flex-1 px-3 py-1.5 bg-accent text-white rounded-lg hover:bg-accent-hover text-sm">${existingFilter ? '保存' : '添加'}</button>
            <button onclick="hideFilterInput()" class="px-3 py-1.5 border border-theme rounded-lg hover:bg-theme-tertiary text-sm">取消</button>
        </div>
        ${existingFilter ? `<button onclick="deleteFilterInput()" id="filter-delete-inline-btn" class="w-full mt-2 px-3 py-1.5 border border-red-500 text-red-500 rounded-lg hover:bg-red-50 transition text-sm">删除过滤器</button>` : ''}
    `;

    // 清单标签点击切换样式
    setTimeout(() => {
        form.querySelectorAll('.filter-list-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const label = cb.closest('label');
                if (cb.checked) {
                    label.classList.add('bg-accent-strong', 'dark:bg-accent-strong', 'text-accent-dark');
                    label.classList.remove('text-theme-secondary');
                } else {
                    label.classList.remove('bg-accent-strong', 'dark:bg-accent-strong', 'text-accent-dark');
                    label.classList.add('text-theme-secondary');
                }
            });
        });
        form.querySelectorAll('.filter-tag-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const label = cb.closest('label');
                const tagId = cb.value;
                const tag = (settings.tags || []).find(t => t.id === tagId);
                if (cb.checked && tag) {
                    label.style.backgroundColor = tag.color;
                    label.classList.add('text-white');
                    label.classList.remove('text-theme-secondary');
                } else {
                    label.style.backgroundColor = '';
                    label.classList.remove('text-white');
                    label.classList.add('text-theme-secondary');
                }
            });
        });

        const nameInput = document.getElementById('new-filter-name');
        if (nameInput) nameInput.focus();
    }, 50);

    return form;
}

function toggleCustomDateRange() {
    const select = document.getElementById('new-filter-timeRange');
    const customInputs = document.getElementById('custom-date-range-inputs');
    if (!select || !customInputs) return;
    if (select.value === 'custom') {
        customInputs.classList.remove('hidden');
    } else {
        customInputs.classList.add('hidden');
    }
}

function applyFilter(filterId) {
    if (currentFilterId === filterId) {
        // 再次点击取消过滤器
        currentFilterId = null;
    } else {
        currentFilterId = filterId;
        // 清除其他筛选
        currentListId = null;
        currentFilter = null;
        currentTagIds = [];
    }
    _saveFilterState();

    if (VIEW_ORDER_DEFAULT.indexOf(currentView) === -1) {
        switchView('task');
    } else {
        renderView();
        renderLists();
        renderTags();
    }

    renderFilters();
    updateSidebarHighlight();
}

function showAddFilterInput() {
    editingFilterId = '__new__';
    filterDeleteConfirming = null;
    renderFilters();
}

function editFilter(filterId) {
    editingFilterId = filterId;
    filterDeleteConfirming = null;
    renderFilters();
}

function hideFilterInput() {
    editingFilterId = null;
    filterDeleteConfirming = null;
    renderFilters();
}

function saveFilterInput() {
    const nameEl = document.getElementById('new-filter-name');
    if (!nameEl) return;
    const name = nameEl.value.trim();
    const color = document.getElementById('new-filter-color').value;
    const editId = document.getElementById('edit-filter-id').value;
    const timeRange = document.getElementById('new-filter-timeRange').value;

    if (!name) {
        showToast('请输入过滤器名称', 'warning');
        return;
    }

    // 自定义时间范围校验
    if (timeRange === 'custom') {
        const customStart = document.getElementById('new-filter-customStart')?.value;
        const customEnd = document.getElementById('new-filter-customEnd')?.value;
        if (!customStart || !customEnd) {
            showToast('请选择自定义时间范围的开始和结束日期', 'warning');
            return;
        }
        if (customStart > customEnd) {
            showToast('开始日期不能晚于结束日期', 'warning');
            return;
        }
    }

    // 收集清单选择
    const listIds = [];
    document.querySelectorAll('.filter-list-check:checked').forEach(cb => {
        listIds.push(cb.value);
    });

    // 收集标签选择
    const tagIds = [];
    document.querySelectorAll('.filter-tag-check:checked').forEach(cb => {
        tagIds.push(cb.value);
    });

    // 收集优先级
    const importantRadio = document.querySelector('input[name="filter-important"]:checked');
    const urgentRadio = document.querySelector('input[name="filter-urgent"]:checked');
    const important = importantRadio ? (importantRadio.value === '' ? null : importantRadio.value === 'true') : null;
    const urgent = urgentRadio ? (urgentRadio.value === '' ? null : urgentRadio.value === 'true') : null;

    const conditions = {
        listIds: listIds,
        tagIds: tagIds,
        important: important,
        urgent: urgent,
        timeRange: timeRange || null,
        customStartDate: timeRange === 'custom' ? (document.getElementById('new-filter-customStart')?.value || null) : null,
        customEndDate: timeRange === 'custom' ? (document.getElementById('new-filter-customEnd')?.value || null) : null
    };

    if (!settings.filters) settings.filters = [];

    if (editId) {
        const filter = settings.filters.find(f => f.id === editId);
        if (filter) {
            filter.name = name;
            filter.color = color;
            filter.conditions = conditions;
        }
        saveData();
        editingFilterId = null;
        renderFilters();
        renderView();
        updateSidebarHighlight();
        showToast('过滤器已更新', 'success');
    } else {
        if (settings.filters.length >= 10) {
            showToast('过滤器数量已达上限（10个）', 'warning');
            return;
        }
        const newFilter = {
            id: generateId(),
            name: name,
            color: color,
            conditions: conditions,
            createdAt: new Date().toISOString()
        };
        settings.filters.push(newFilter);
        saveData();
        editingFilterId = null;
        renderFilters();
        renderView();
        updateSidebarHighlight();
        showToast('过滤器添加成功', 'success');
    }
}

function deleteFilterInput() {
    const filterId = document.getElementById('edit-filter-id').value;
    if (!filterId) return;

    if (filterDeleteConfirming === filterId) {
        settings.filters = (settings.filters || []).filter(f => f.id !== filterId);
        if (currentFilterId === filterId) {
            currentFilterId = null;
        }
        saveData();
        editingFilterId = null;
        filterDeleteConfirming = null;
        renderFilters();
        renderView();
        updateSidebarHighlight();
        showToast('过滤器已删除', 'success');
        return;
    }

    filterDeleteConfirming = filterId;
    const btn = document.getElementById('filter-delete-inline-btn');
    if (btn) {
        btn.textContent = '确认删除';
        btn.classList.add('bg-red-600', 'text-white', 'border-red-600');
        btn.classList.remove('text-red-500', 'border-red-500', 'hover:bg-red-50');
    }

    setTimeout(() => {
        filterDeleteConfirming = null;
        if (btn) {
            btn.textContent = '删除过滤器';
            btn.classList.remove('bg-red-600', 'text-white', 'border-red-600');
            btn.classList.add('text-red-500', 'border-red-500', 'hover:bg-red-50');
        }
    }, 3000);
}
