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

function renderLists() {
    const container = document.getElementById('lists-container');
    if (!container) return;

    container.innerHTML = '';

    // 只显示未归档的清单
    const activeLists = lists.filter(l => !l.archived);
    const archivedLists = lists.filter(l => l.archived);

    activeLists.forEach(list => {
        const listItem = document.createElement('button');
        listItem.dataset.listId = list.id;
        const uncompletedCount = tasks.filter(t => t.listId === list.id && !t.completed).length;
        listItem.className = `w-full text-left px-3 py-2 rounded-lg hover:bg-theme-tertiary transition text-theme-primary flex items-center justify-center gap-2 ${currentListId === list.id ? 'bg-blue-50 text-blue-600' : ''}`;
        listItem.innerHTML = `
            <span class="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-blue-400 transition" style="background-color: ${list.color}" onclick="event.stopPropagation(); editList('${list.id}')"></span>
            <span class="sidebar-text flex-1">${list.name}</span>
            ${uncompletedCount > 0 ? `<span class="sidebar-count text-xs text-theme-muted w-5 text-right">${uncompletedCount}</span>` : '<span class="sidebar-count w-5"></span>'}
        `;
        listItem.onclick = () => {
            currentListId = list.id;
            currentFilter = null;
            currentTagIds = [];
            currentFilterId = null;
            // 在摘要/过滤器编辑视图下点击清单，切换到默认任务视图并按清单筛选
            if (currentView === 'summary' || currentView === 'filterEdit') {
                switchView('task');
            } else {
                renderView();
            }
            renderLists();
            renderTags();
            renderFilters();
            updateSidebarHighlight();
        };
        container.appendChild(listItem);

        // 如果正在编辑此清单，在其下方插入编辑表单
        if (editingListId === list.id) {
            const editForm = createListEditForm(list);
            container.appendChild(editForm);
        }
    });

    // 已归档清单入口（放在清单分组末位，"新建清单"按钮之前）
    if (archivedLists.length > 0) {
        const archivedBtn = document.createElement('button');
        archivedBtn.id = 'sidebar-archived-btn';
        archivedBtn.className = `w-full text-left px-3 py-2 rounded-lg hover:bg-theme-tertiary transition text-theme-muted flex items-center justify-center gap-2 ${currentListId === '__archived__' ? 'bg-theme-tertiary font-semibold' : ''}`;
        archivedBtn.innerHTML = `
            <i class="fas fa-archive w-3 text-center text-xs"></i>
            <span class="sidebar-text flex-1">已归档</span>
        `;
        archivedBtn.onclick = () => viewArchivedLists();
        container.appendChild(archivedBtn);
    }

    // 如果正在新建清单，在"新建清单"按钮前插入表单
    if (editingListId === '__new__') {
        const newForm = createListEditForm(null);
        container.appendChild(newForm);
    }

    updateTaskListSelect();
    updateSettingsListSelect();
}

let listDeleteConfirming = false;
let listArchiveConfirming = false;

function createListEditForm(existingList) {
    const form = document.createElement('div');
    form.className = 'mt-1 mb-1 p-3 bg-theme-tertiary rounded-lg border border-theme';
    form.setAttribute('data-edit-form', 'list');
    const isDefault = existingList && existingList.id === 'default';
    form.innerHTML = `
        <input type="hidden" id="edit-list-id" value="${existingList ? existingList.id : ''}">
        <input type="text" id="new-list-name" placeholder="清单名称" class="w-full px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary mb-2 ${isDefault ? 'opacity-50 cursor-not-allowed' : ''}" value="${existingList ? existingList.name : ''}" ${isDefault ? 'readonly' : ''}>
        <div class="flex items-center gap-2">
            <input type="color" id="new-list-color" value="${existingList ? existingList.color : '#3b82f6'}" class="w-8 h-8 rounded cursor-pointer flex-shrink-0">
            ${existingList && existingList.id !== 'default' ? `
                <button onclick="deleteListInput()" id="list-delete-inline-btn" class="flex items-center justify-center w-8 h-8 rounded-lg border ${listDeleteConfirming ? 'bg-red-600 text-white border-red-600' : 'border-red-500 text-red-500 hover:bg-red-50'} transition" title="${listDeleteConfirming ? '确认删除' : '删除清单'}">
                    <i class="fas fa-trash text-sm"></i>
                </button>
            ` : ''}
            ${existingList && existingList.id !== 'default' && !existingList.archived ? `
                <button onclick="archiveListConfirm()" id="list-archive-inline-btn" class="flex items-center justify-center w-8 h-8 rounded-lg border ${listArchiveConfirming ? 'bg-amber-600 text-white border-amber-600' : 'border-amber-500 text-amber-500 hover:bg-amber-50'} transition" title="${listArchiveConfirming ? '确认归档' : '归档清单'}">
                    <i class="fas fa-archive text-sm"></i>
                </button>
            ` : ''}
            <div class="flex-1"></div>
            <button onclick="saveListInput()" id="list-save-btn" class="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition" title="${existingList ? '保存' : '添加'}">
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

    if (listDeleteConfirming) {
        // 第二次点击：确认删除
        const list = lists.find(l => l.id === listId);
        const listName = list ? list.name : '该清单';

        // 将任务移入默认清单
        tasks.forEach(t => { if (t.listId === listId) t.listId = 'default'; });
        lists = lists.filter(l => l.id !== listId);

        if (currentListId === listId) currentListId = null;

        listDeleteConfirming = false;
        editingListId = null;
        saveData();
        renderLists();
        renderTags();
        renderFilters();
        renderView();
        updateSidebarHighlight();
        showToast(`清单"${listName}"已删除，任务已移至默认清单`, 'success');
        return;
    }

    listDeleteConfirming = true;
    const btn = document.getElementById('list-delete-inline-btn');
    if (btn) {
        btn.classList.add('bg-red-600', 'border-red-600', 'text-white');
        btn.classList.remove('border-red-500', 'text-red-500', 'hover:bg-red-50');
        btn.title = '确认删除';
    }

    setTimeout(() => {
        listDeleteConfirming = false;
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

    if (listArchiveConfirming) {
        listArchiveConfirming = false;
        editingListId = null;
        archiveList(listId);
        return;
    }

    listArchiveConfirming = true;
    const btn = document.getElementById('list-archive-inline-btn');
    if (btn) {
        btn.classList.add('bg-amber-600', 'border-amber-600', 'text-white');
        btn.classList.remove('border-amber-500', 'text-amber-500', 'hover:bg-amber-50');
        btn.title = '确认归档';
    }

    setTimeout(() => {
        listArchiveConfirming = false;
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
                <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-blue-500 dark:border-white'}">
                    ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                </div>
            </div>
            <div class="${colors.bg} rounded-r-lg p-3 flex-1 hover:opacity-80 transition" style="border-left: 4px solid ${listColor}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
                <div class="flex items-center gap-2 text-sm mb-1 text-theme-secondary">
                    ${timeDisplay ? `<span><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
                    ${listName ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${listColor}"></span>${listName}</span>` : ''}
                    ${renderTagCapsules(task, 2, 'right')}
                    ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-500"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                    ${progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-blue-500"></i>${progress}%</span>` : ''}
                </div>
                <div class="font-medium ${task.completed ? 'text-theme-muted' : 'text-theme-primary'}">
                    ${task.title || '新任务'}
                    ${task.important ? '<i class="fas fa-star text-yellow-500 text-sm ml-1"></i>' : ''}
                    ${task.urgent ? '<i class="fas fa-fire text-red-500 text-sm ml-1"></i>' : ''}
                </div>
                ${task.notes ? `<div class="text-xs text-theme-secondary mt-1">${task.notes}</div>` : ''}
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
    currentListId = listId;
    currentFilter = null;
    // 在摘要/过滤器编辑视图下点击清单，切换到默认任务视图并按清单筛选
    if (currentView === 'summary' || currentView === 'filterEdit') {
        switchView('task'); // 内部已调用 renderView/renderLists/updateSidebarHighlight
    } else {
        renderView();
        renderLists();
        updateSidebarHighlight();
    }
    renderTags();
}

function updateTaskListSelect() {
    const select = document.getElementById('task-list');
    if (select) {
        select.innerHTML = '';
        lists.filter(l => !l.archived).forEach(list => {
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
        lists.filter(l => !l.archived).forEach(list => {
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
    if (currentView === 'summary') {
        switchView('task');
    } else if (currentView !== 'task' && currentView !== 'schedule' && currentView !== 'week' && currentView !== 'month' && currentView !== 'quadrant') {
        switchView('task');
    } else {
        renderView();
        renderLists();
        renderTags();
        renderFilters();
        updateSidebarHighlight();
    }
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
        btn.classList.remove('bg-blue-50', 'text-blue-600', 'bg-theme-tertiary', 'font-semibold');
    });

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
    } else if (currentView === 'task' && currentListId) {
        if (currentListId === '__archived__') {
            const btn = document.getElementById('sidebar-archived-btn');
            if (btn) btn.classList.add('bg-theme-tertiary', 'font-semibold');
        } else {
            // 清单选中时，高亮对应的清单按钮
            const listBtn = document.querySelector(`#lists-container button[data-list-id="${currentListId}"]`);
            if (listBtn) listBtn.classList.add('bg-blue-50', 'text-blue-600');
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

function renderTags() {
    const section = document.getElementById('sidebar-tags-section');
    const container = document.getElementById('sidebar-tags-container');
    if (!section || !container) return;

    const tags = settings.tags || [];

    // 始终显示标签区域（方便创建新标签）
    section.classList.remove('hidden');

    container.innerHTML = '';

    tags.forEach(tag => {
        const uncompletedCount = tasks.filter(t => (t.tags || []).includes(tag.id) && !t.completed).length;
        const isActive = currentTagIds && currentTagIds.includes(tag.id);
        const btn = document.createElement('button');
        btn.id = `sidebar-tag-${tag.id}`;
        btn.className = `w-full text-left px-3 py-2 rounded-lg hover:bg-theme-tertiary transition text-theme-primary flex items-center justify-center gap-2 sidebar-tag-btn ${isActive ? 'bg-theme-tertiary font-semibold' : ''}`;
        btn.innerHTML = `
            <span class="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-green-400 transition" style="background-color: ${tag.color}" onclick="event.stopPropagation(); showAddTagInput('${tag.id}')"></span>
            <span class="sidebar-text flex-1">${tag.name}</span>
            ${uncompletedCount > 0 ? `<span class="sidebar-count text-xs text-theme-muted w-5 text-right">${uncompletedCount}</span>` : '<span class="sidebar-count w-5"></span>'}
        `;
        btn.onclick = () => toggleTagFilter(tag.id);
        container.appendChild(btn);

        // 如果正在编辑此标签，在其下方插入编辑表单
        if (editingTagId === tag.id) {
            const editForm = createTagEditForm(tag);
            container.appendChild(editForm);
        }
    });

    // 如果正在新建标签，在所有标签之后插入新建表单
    if (editingTagId === '__new__') {
        const newForm = createTagEditForm(null);
        container.appendChild(newForm);
    }
}

function createTagEditForm(existingTag) {
    const form = document.createElement('div');
    form.className = 'mt-1 mb-1 p-3 bg-theme-tertiary rounded-lg border border-theme';
    form.setAttribute('data-edit-form', 'tag');
    form.innerHTML = `
        <input type="hidden" id="edit-tag-id" value="${existingTag ? existingTag.id : ''}">
        <input type="text" id="new-tag-name" placeholder="标签名称" maxlength="20" class="w-full px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary mb-2" value="${existingTag ? existingTag.name : ''}">
        <div class="flex items-center gap-2">
            <input type="color" id="new-tag-color" value="${existingTag ? existingTag.color : '#10b981'}" class="w-8 h-8 rounded cursor-pointer flex-shrink-0">
            ${existingTag ? `
                <button onclick="deleteTagInput()" id="tag-delete-inline-btn" class="flex items-center justify-center w-8 h-8 rounded-lg border border-red-500 text-red-500 hover:bg-red-50 transition" title="删除标签">
                    <i class="fas fa-trash text-sm"></i>
                </button>
            ` : ''}
            <div class="flex-1"></div>
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

    // 确保在五个视图中
    if (currentView === 'summary' || currentView === 'filterEdit') {
        switchView('task');
    } else if (!['task', 'schedule', 'week', 'month', 'quadrant'].includes(currentView)) {
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
    renderView();
    renderLists();
    renderTags();
    renderFilters();
    updateSidebarHighlight();
}

// ==================== 过滤器渲染与筛选 ====================

let editingFilterId = null; // null | filterId | '__new__'
let filterDeleteConfirming = false;

function renderFilters() {
    const section = document.getElementById('sidebar-filters-section');
    const container = document.getElementById('sidebar-filters-container');
    if (!section || !container) return;

    const filters = settings.filters || [];

    // 始终显示过滤器区域（至少显示"新建过滤器"按钮）
    section.classList.remove('hidden');

    container.innerHTML = '';

    filters.forEach(filter => {
        const isActive = currentFilterId === filter.id;
        const uncompletedCount = tasks.filter(t => {
            // 简单计数：检查任务是否满足过滤条件
            return !t.completed && matchFilterConditions(t, filter);
        }).length;

        const btn = document.createElement('button');
        btn.id = `sidebar-filter-${filter.id}`;
        btn.className = `w-full text-left px-3 py-2 rounded-lg hover:bg-theme-tertiary transition text-theme-primary flex items-center justify-center gap-2 sidebar-filter-btn ${isActive ? 'bg-theme-tertiary font-semibold' : ''}`;
        btn.innerHTML = `
            <span class="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-blue-400 transition" style="background-color: ${filter.color}" onclick="event.stopPropagation(); editFilter('${filter.id}')"></span>
            <span class="sidebar-text flex-1">${filter.name}</span>
            ${uncompletedCount > 0 ? `<span class="sidebar-count text-xs text-theme-muted w-5 text-right">${uncompletedCount}</span>` : '<span class="sidebar-count w-5"></span>'}
        `;
        btn.onclick = () => applyFilter(filter.id);
        container.appendChild(btn);
    });
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

    const c = existingFilter ? (existingFilter.conditions || {}) : {};
    const activeLists = lists.filter(l => !l.archived);
    const allTags = settings.tags || [];

    form.innerHTML = `
        <input type="hidden" id="edit-filter-id" value="${existingFilter ? existingFilter.id : ''}">
        <div class="mb-2">
            <input type="text" id="new-filter-name" placeholder="过滤器名称" class="w-full px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary text-sm" value="${existingFilter ? existingFilter.name : ''}">
        </div>
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
                    <label class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer hover:bg-theme-secondary transition ${c.listIds && c.listIds.includes(list.id) ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600' : 'text-theme-secondary'}">
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
            <button onclick="saveFilterInput()" class="flex-1 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm">${existingFilter ? '保存' : '添加'}</button>
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
                    label.classList.add('bg-blue-100', 'dark:bg-blue-900/40', 'text-blue-600');
                    label.classList.remove('text-theme-secondary');
                } else {
                    label.classList.remove('bg-blue-100', 'dark:bg-blue-900/40', 'text-blue-600');
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

    if (currentView === 'summary') {
        switchView('task');
    } else if (!['task', 'schedule', 'week', 'month', 'quadrant'].includes(currentView)) {
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
    filterDeleteConfirming = false;
    currentView = 'filterEdit';
    renderView();
    renderFilters();
}

function editFilter(filterId) {
    editingFilterId = filterId;
    filterDeleteConfirming = false;
    currentView = 'filterEdit';
    renderView();
    renderFilters();
}

function hideFilterInput() {
    editingFilterId = null;
    filterDeleteConfirming = false;
    currentView = 'task';
    renderView();
    renderFilters();
    updateSidebarHighlight();
}

function saveFilterInput() {
    const name = document.getElementById('new-filter-name').value.trim();
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
        currentView = 'task';
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
        currentView = 'task';
        renderFilters();
        renderView();
        updateSidebarHighlight();
        showToast('过滤器添加成功', 'success');
    }
}

function deleteFilterInput() {
    const filterId = document.getElementById('edit-filter-id').value;
    if (!filterId) return;

    if (filterDeleteConfirming) {
        settings.filters = (settings.filters || []).filter(f => f.id !== filterId);
        if (currentFilterId === filterId) {
            currentFilterId = null;
        }
        saveData();
        editingFilterId = null;
        filterDeleteConfirming = false;
        currentView = 'task';
        renderFilters();
        renderView();
        updateSidebarHighlight();
        showToast('过滤器已删除', 'success');
        return;
    }

    filterDeleteConfirming = true;
    const btn = document.getElementById('filter-delete-inline-btn');
    if (btn) {
        btn.textContent = '确认删除';
        btn.classList.add('bg-red-600', 'text-white', 'border-red-600');
        btn.classList.remove('text-red-500', 'border-red-500', 'hover:bg-red-50');
    }

    setTimeout(() => {
        filterDeleteConfirming = false;
        if (btn) {
            btn.textContent = '删除过滤器';
            btn.classList.remove('bg-red-600', 'text-white', 'border-red-600');
            btn.classList.add('text-red-500', 'border-red-500', 'hover:bg-red-50');
        }
    }, 3000);
}

function renderFilterEditView(container) {
    const existingFilter = editingFilterId && editingFilterId !== '__new__'
        ? (settings.filters || []).find(f => f.id === editingFilterId)
        : null;
    const c = existingFilter ? (existingFilter.conditions || {}) : {};
    const activeLists = lists.filter(l => !l.archived);
    const allTags = settings.tags || [];
    const isEditing = !!existingFilter;

    // 保存表单滚动位置（自动刷新等重渲染场景），避免跳回顶部
    const prevFormScroll = container.querySelector('.bg-theme-secondary.rounded-xl.shadow-theme');
    const savedFormScrollTop = prevFormScroll ? prevFormScroll.scrollTop : 0;

    container.innerHTML = `
        <div class="h-full flex flex-col">
            <div class="flex items-center justify-between p-4 pb-2">
                <h1 class="text-2xl font-bold text-theme-primary">${isEditing ? '编辑过滤器' : '新建过滤器'}</h1>
            </div>
            <div class="bg-theme-secondary rounded-xl shadow-theme p-6 flex-1 min-h-0 overflow-y-auto mx-4 mb-4">
                <input type="hidden" id="edit-filter-id" value="${existingFilter ? existingFilter.id : ''}">

                <div class="max-w-2xl space-y-6">
                    <!-- 名称和颜色 -->
                    <div>
                        <label class="text-sm font-medium text-theme-primary block mb-2">名称</label>
                        <div class="flex items-center gap-3">
                            <input type="color" id="new-filter-color" value="${existingFilter ? existingFilter.color : '#8b5cf6'}" class="w-10 h-10 rounded-lg cursor-pointer flex-shrink-0 border border-theme">
                            <input type="text" id="new-filter-name" placeholder="过滤器名称" class="flex-1 px-4 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary" value="${existingFilter ? existingFilter.name : ''}">
                        </div>
                    </div>

                    <!-- 时间范围 -->
                    <div>
                        <label class="text-sm font-medium text-theme-primary block mb-2">时间范围</label>
                        <select id="new-filter-timeRange" class="w-full px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary" onchange="toggleCustomDateRange()">
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
                        <div id="custom-date-range-inputs" class="mt-3 ${c.timeRange === 'custom' ? '' : 'hidden'}">
                            <div class="flex gap-4">
                                <div class="flex-1">
                                    <label class="text-xs text-theme-muted block mb-1">开始日期</label>
                                    <input type="date" id="new-filter-customStart" class="w-full px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary" value="${c.customStartDate || ''}">
                                </div>
                                <div class="flex-1">
                                    <label class="text-xs text-theme-muted block mb-1">结束日期</label>
                                    <input type="date" id="new-filter-customEnd" class="w-full px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary" value="${c.customEndDate || ''}">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 清单 -->
                    <div>
                        <label class="text-sm font-medium text-theme-primary block mb-2">清单</label>
                        <div class="flex flex-wrap gap-2">
                            ${activeLists.map(list => `
                                <label class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm cursor-pointer hover:bg-theme-tertiary transition border border-theme ${c.listIds && c.listIds.includes(list.id) ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 border-blue-300' : 'text-theme-secondary'}">
                                    <input type="checkbox" class="filter-list-check hidden" value="${list.id}" ${c.listIds && c.listIds.includes(list.id) ? 'checked' : ''}>
                                    <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${list.color}"></span>
                                    ${list.name}
                                </label>
                            `).join('')}
                        </div>
                    </div>

                    <!-- 标签 -->
                    <div>
                        <label class="text-sm font-medium text-theme-primary block mb-2">标签</label>
                        <div class="flex flex-wrap gap-2">
                            ${allTags.length > 0 ? allTags.map(tag => `
                                <label class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm cursor-pointer hover:bg-theme-tertiary transition border border-theme ${c.tagIds && c.tagIds.includes(tag.id) ? 'text-white border-transparent' : 'text-theme-secondary'}" style="${c.tagIds && c.tagIds.includes(tag.id) ? `background-color: ${tag.color}` : ''}">
                                    <input type="checkbox" class="filter-tag-check hidden" value="${tag.id}" ${c.tagIds && c.tagIds.includes(tag.id) ? 'checked' : ''}>
                                    ${tag.name}
                                </label>
                            `).join('') : '<span class="text-sm text-theme-muted">暂无标签</span>'}
                        </div>
                    </div>

                    <!-- 优先级 -->
                    <div>
                        <label class="text-sm font-medium text-theme-primary block mb-2">优先级</label>
                        <div class="flex flex-wrap gap-3">
                            <label class="inline-flex items-center gap-1.5 text-sm cursor-pointer text-theme-secondary">
                                <input type="radio" name="filter-important" value="" ${c.important === null || c.important === undefined ? 'checked' : ''}> 重要不限
                            </label>
                            <label class="inline-flex items-center gap-1.5 text-sm cursor-pointer text-theme-secondary">
                                <input type="radio" name="filter-important" value="true" ${c.important === true ? 'checked' : ''}> 重要
                            </label>
                            <label class="inline-flex items-center gap-1.5 text-sm cursor-pointer text-theme-secondary">
                                <input type="radio" name="filter-important" value="false" ${c.important === false ? 'checked' : ''}> 不重要
                            </label>
                        </div>
                        <div class="flex flex-wrap gap-3 mt-2">
                            <label class="inline-flex items-center gap-1.5 text-sm cursor-pointer text-theme-secondary">
                                <input type="radio" name="filter-urgent" value="" ${c.urgent === null || c.urgent === undefined ? 'checked' : ''}> 紧急不限
                            </label>
                            <label class="inline-flex items-center gap-1.5 text-sm cursor-pointer text-theme-secondary">
                                <input type="radio" name="filter-urgent" value="true" ${c.urgent === true ? 'checked' : ''}> 紧急
                            </label>
                            <label class="inline-flex items-center gap-1.5 text-sm cursor-pointer text-theme-secondary">
                                <input type="radio" name="filter-urgent" value="false" ${c.urgent === false ? 'checked' : ''}> 不紧急
                            </label>
                        </div>
                    </div>

                    <!-- 操作按钮 -->
                    <div class="flex gap-3 pt-4 border-t border-theme">
                        <button onclick="saveFilterInput()" class="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition font-medium">${isEditing ? '保存' : '添加'}</button>
                        ${isEditing ? `<button onclick="deleteFilterInput()" id="filter-delete-inline-btn" class="px-6 py-2 border border-red-500 text-red-500 rounded-lg hover:bg-red-50 transition font-medium">删除</button>` : ''}
                        <button onclick="hideFilterInput()" class="px-6 py-2 border border-theme rounded-lg hover:bg-theme-tertiary transition font-medium text-theme-secondary">取消</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 同步恢复表单滚动位置，实现自动刷新无感
    const newFormScroll = container.querySelector('.bg-theme-secondary.rounded-xl.shadow-theme');
    if (newFormScroll && savedFormScrollTop > 0) {
        newFormScroll.scrollTop = savedFormScrollTop;
    }

    // 清单标签点击切换样式
    setTimeout(() => {
        container.querySelectorAll('.filter-list-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const label = cb.closest('label');
                if (cb.checked) {
                    label.classList.add('bg-blue-100', 'dark:bg-blue-900/40', 'text-blue-600', 'border-blue-300');
                    label.classList.remove('text-theme-secondary');
                } else {
                    label.classList.remove('bg-blue-100', 'dark:bg-blue-900/40', 'text-blue-600', 'border-blue-300');
                    label.classList.add('text-theme-secondary');
                }
            });
        });
        container.querySelectorAll('.filter-tag-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const label = cb.closest('label');
                const tagId = cb.value;
                const tag = (settings.tags || []).find(t => t.id === tagId);
                if (cb.checked && tag) {
                    label.style.backgroundColor = tag.color;
                    label.classList.add('text-white', 'border-transparent');
                    label.classList.remove('text-theme-secondary');
                } else {
                    label.style.backgroundColor = '';
                    label.classList.remove('text-white', 'border-transparent');
                    label.classList.add('text-theme-secondary');
                }
            });
        });

        const nameInput = document.getElementById('new-filter-name');
        if (nameInput) nameInput.focus();
    }, 50);
}
