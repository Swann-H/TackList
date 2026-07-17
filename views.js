// 当前正在编辑/新建的清单ID（null=新建，id=编辑）
let editingListId = null;

// 判断任务是否在今天已过期（非全天任务，startTime在今天且早于当前时刻，未完成）
function isTaskOverdueToday(task) {
    if (!task.startTime || task.isAllDay || task.completed) return false;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const taskDate = new Date(task.startTime);
    return taskDate >= todayStart && taskDate < tomorrowStart && taskDate < now;
}

// 渲染"开始专注"按钮（受 settings.showFocusButton 开关控制）
function renderFocusButton(taskId, extraClasses = '') {
    if (settings && settings.showFocusButton === false) return '';
    return `<button onclick="event.stopPropagation(); startPomodoroForTask('${taskId}')"
            class="pomodoro-focus-btn flex-shrink-0 opacity-0 group-hover:opacity-100 text-green-600 w-5 h-5 flex items-center justify-center transition duration-200 ${extraClasses}"
            title="开始专注">
        <i class="far fa-clock text-xs pf-icon-outline"></i>
        <i class="fas fa-clock text-xs pf-icon-solid"></i>
    </button>`;
}

// 判断任务是否已过期（未完成、非全天、startTime早于当前时刻，跨天任务进行中除外）
function isTaskOverdue(task) {
    if (!task.startTime || task.isAllDay || task.completed) return false;
    const now = new Date();
    const taskDate = new Date(task.startTime);
    // 跨天任务：当前在[startTime, endTime]范围内算"进行中"，不算过期
    if (task.endTime) {
        const taskEndDate = new Date(task.endTime);
        if (now >= taskDate && now <= taskEndDate) return false;
    }
    return taskDate < now;
}

// 过期红色样式类名
const OVERDUE_TEXT_CLASS = 'text-red-500';

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
    
    if (archivedViewListId) {
        // 查看某个归档清单的任务
        const list = lists.find(l => l.id === archivedViewListId);
        if (!list) { archivedViewListId = null; renderView(); return; }
        
        const listTasks = tasks.filter(t => t.listId === archivedViewListId);
        
        container.innerHTML = `
            <div class="p-4">
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
                <div class="space-y-2">
                    ${listTasks.map(task => renderArchivedTaskCard(task)).join('')}
                </div>
            </div>
        `;
    } else {
        // 显示所有归档清单列表
        container.innerHTML = `
            <div class="p-4">
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
}

function renderArchivedTaskCard(task) {
    const list = lists.find(l => l.id === task.listId);
    const listName = list ? list.name : '';
    const listColor = list ? list.color : '#999';
    
    let timeDisplay = '';
    if (task.startTime) {
        const d = new Date(task.startTime);
        timeDisplay = `${d.getMonth()+1}月${d.getDate()}日`;
        if (task.endTime && task.endTime !== task.startTime) {
            const ed = new Date(task.endTime);
            timeDisplay += ` - ${ed.getMonth()+1}月${ed.getDate()}日`;
        }
    }
    
    return `
        <div class="p-3 rounded-lg border border-theme bg-theme-secondary">
            <div class="flex items-start gap-3">
                <div class="mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-blue-500 dark:border-white'}">
                    ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                </div>
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <h3 class="font-medium ${task.completed ? 'text-theme-muted line-through' : 'text-theme-primary'}">${task.title || '新任务'}</h3>
                        ${task.important ? '<i class="fas fa-star text-yellow-500 text-sm"></i>' : ''}
                        ${task.urgent ? '<i class="fas fa-fire text-red-500 text-sm"></i>' : ''}
                    </div>
                    <div class="flex items-center gap-3 text-sm text-theme-secondary">
                        <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${listColor}"></span>${listName}</span>
                        ${timeDisplay ? `<span><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
                    </div>
                    ${task.tags && task.tags.length > 0 ? `<div class="mt-1">${renderTagCapsules(task, 5)}</div>` : ''}
                    ${task.notes ? `<p class="mt-2 text-sm text-theme-secondary">${task.notes}</p>` : ''}
                </div>
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

// 视图切换
function switchView(view) {
    if (currentDetailTaskId) {
        closeTaskDetailPanel();
    }
    if (currentView === 'month' && view !== 'month') {
        _expandedMonthDay = null;
        document.removeEventListener('click', _monthCollapseHandler);
    }
    currentView = view;
    const mainHeader = document.querySelector('#main-content > header');
    if (mainHeader) {
        if (view === 'summary' || view === 'filterEdit') {
            mainHeader.classList.add('hidden');
        } else {
            mainHeader.classList.remove('hidden');
        }
    }
    if (view === 'schedule') {
        _scheduleAutoScroll = true;
    }
    if (!['schedule', 'week', 'month'].includes(view)) {
        closePlanPanel();
    }
    // 当切换到默认首页视图时，刷新待显示的彩蛋效果
    if (typeof settings !== 'undefined' && view === (settings.defaultView || 'task')) {
        if (typeof ee_flushPendingEffects === 'function') {
            ee_flushPendingEffects();
        }
    }
    renderView();
    renderLists();
    updateViewButtons();
    updateSidebarHighlight();
}

function updateViewButtons() {
    const views = ['task', 'schedule', 'week', 'month', 'quadrant', 'summary'];
    views.forEach(view => {
        const btn = document.getElementById(`view-btn-${view}`);
        if (btn) {
            if (view === currentView) {
                btn.className = 'px-4 py-2 rounded-lg bg-blue-500 text-white shadow-md view-btn-active';
            } else {
                btn.className = 'px-4 py-2 rounded-lg hover:bg-theme-tertiary transition text-theme-primary';
            }
        }
    });

    const planBtn = document.getElementById('plan-btn');
    if (planBtn) {
        if (['schedule', 'week', 'month'].includes(currentView)) {
            planBtn.classList.remove('hidden');
        } else {
            planBtn.classList.add('hidden');
            closePlanPanel();
        }
    }

    const todayBtn = document.getElementById('today-btn');
    if (todayBtn) {
        if (['schedule', 'week', 'month'].includes(currentView)) {
            todayBtn.classList.remove('hidden');
        } else {
            todayBtn.classList.add('hidden');
        }
    }
}

function renderView() {
    const container = document.getElementById('view-container');
    // 离开摘要页时停止彗星动画，防止 rAF 泄漏
    if (currentView !== 'summary') stopSummaryCometAnimation();
    
    switch (currentView) {
        case 'task':
            if (currentListId === '__archived__') {
                renderArchivedView(container);
            } else {
                renderTaskListView(container);
            }
            break;
        case 'schedule':
            renderScheduleView(container);
            break;
        case 'week':
            renderWeekView(container);
            break;
        case 'month':
            renderMonthView(container);
            break;
        case 'quadrant':
            renderQuadrantView(container);
            break;
        case 'summary':
            renderSummaryView(container);
            break;
        case 'filterEdit':
            renderFilterEditView(container);
            break;
        default:
            renderTaskListView(container);
            break;
    }
    
    updatePostponeButton();
}

function renderTaskCard(task) {
    const list = lists.find(l => l.id === task.listId);
    const timeDisplay = task.startTime ? formatDateTime(task.startTime) : '';
    
    return `
        <div class="task-item bg-theme-secondary rounded-xl p-4 shadow-theme card-hover border border-theme ${task.completed ? 'task-complete' : ''}" 
             draggable="true" 
             data-task-id="${task.id}"
             ondragstart="handleTaskDragStart(event, '${task.id}')"
             ondragover="handleTaskDragOver(event)"
             ondrop="handleTaskDrop(event, '${task.id}')"
             ondragend="handleTaskDragEnd(event)"
             onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')">
            <div class="flex items-start gap-4">
                <button onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" class="mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-blue-500 dark:border-white hover:border-blue-600 dark:hover:border-blue-300'}">
                    ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                </button>
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <h3 class="font-medium ${task.completed ? 'text-theme-muted' : 'text-theme-primary'} cursor-pointer hover:text-accent transition">${task.title || '新任务'}</h3>
                        ${task.important ? '<i class="fas fa-star text-yellow-500 text-sm"></i>' : ''}
                        ${task.urgent ? '<i class="fas fa-fire text-red-500 text-sm"></i>' : ''}
                        <span class="ml-auto">${renderTagCapsules(task, 2, 'right')}</span>
                    </div>
                    <div class="flex items-center gap-3 text-sm text-theme-secondary">
                        ${list ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${list.color}"></span><span class="sidebar-text">${list.name}</span></span>` : ''}
                        ${timeDisplay ? `<span class="sidebar-text cursor-pointer hover:text-accent transition"><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
                    </div>
                    ${task.notes ? `<p class="mt-2 text-sm text-theme-secondary cursor-pointer hover:text-accent transition">${task.notes}</p>` : ''}
                    
                    <div class="flex items-center gap-2 mt-3 pt-3 border-t border-theme">
                        <button onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')" class="flex items-center gap-1 px-3 py-1 text-xs text-theme-secondary hover:bg-theme-tertiary rounded-lg transition">
                            <i class="fas fa-clock"></i>
                            <span class="sidebar-text">${timeDisplay || '设置时间'}</span>
                        </button>
                        <button onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')" class="flex items-center gap-1 px-3 py-1 text-xs ${task.important || task.urgent ? 'text-yellow-600' : 'text-theme-secondary'} hover:bg-theme-tertiary rounded-lg transition">
                            <i class="fas fa-star"></i>
                            <span class="sidebar-text">${task.important || task.urgent ? (task.important ? '重要' : '') + (task.important && task.urgent ? ' / ' : '') + (task.urgent ? '紧急' : '') : '设置优先级'}</span>
                        </button>
                        <button onclick="event.stopPropagation(); startPomodoroForTask('${task.id}')" class="flex items-center gap-1 px-3 py-1 text-xs text-green-600 hover:bg-green-50 rounded-lg transition">
                            <i class="fas fa-stopwatch"></i>
                            <span class="sidebar-text">专注</span>
                        </button>
                        <button onclick="event.stopPropagation(); confirmDeleteTask('${task.id}')" class="ml-auto p-1 text-theme-muted hover:text-red-500 transition">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

let weekViewHourStart = 6;
let weekViewHourEnd = 22;
let weekAllDayCollapsed = {};

function renderWeekView(container) {
    const weekStart = new Date(currentDate);
    const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
    if (weekStart.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
    
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        weekDays.push(date);
    }
    
    const now = new Date();
    const todayStr = formatDate(now);
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    const weekNum = getWeekNumber(weekDays[0]);
    
    const allDayTasks = {};
    const timedTasks = {};
    weekDays.forEach(date => {
        const dateStr = formatDate(date);
        const dayAllTasks = getTasksForDate(date);
        allDayTasks[dateStr] = dayAllTasks.filter(t => t.isAllDay || isMultiDayTask(t));
        timedTasks[dateStr] = dayAllTasks.filter(t => !t.isAllDay && !isMultiDayTask(t) && t.startTime);
    });
    
    const hasAnyTasks = weekDays.some(date => {
        const dateStr = formatDate(date);
        return allDayTasks[dateStr].length > 0 || timedTasks[dateStr].length > 0;
    });
    
    const hourHeight = 60;
    const totalHours = weekViewHourEnd - weekViewHourStart;
    
    let headerHtml = '';

    
    let allDayHtml = '';
    allDayHtml += '<div class="flex-shrink-0 flex week-header-sticky" style="position: sticky; top: 0; z-index: 15;">';
    allDayHtml += `<div class="flex-shrink-0" style="width: 52px;"><div class="text-xs text-theme-muted text-right pr-2 pt-1">${weekNum}周</div></div>`;
    allDayHtml += '<div class="flex-1 flex min-w-0">';
    weekDays.forEach(date => {
        const dateStr = formatDate(date);
        const isToday = dateStr === todayStr;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const dayAllDay = allDayTasks[dateStr] || [];
        const collapsed = weekAllDayCollapsed[dateStr] !== false;
        const visibleTasks = collapsed ? dayAllDay.slice(0, 2) : dayAllDay;
        
        allDayHtml += `
            <div class="flex-1 min-w-0 border-l border-theme ${isWeekend ? 'week-weekend-bg bg-gray-50 dark:bg-gray-700/15' : ''}">
                <div class="text-center py-1 border-b border-theme">
                    <div class="text-xs text-theme-secondary">${formatWeekdayShort(date)}</div>
                    <div class="h-6 flex items-center justify-center"><span class="text-sm font-bold ${isToday ? 'w-6 h-6 inline-flex items-center justify-center rounded-full bg-blue-500 text-white' : 'text-theme-primary'}">${date.getDate()}</span></div>
                    ${(() => { const lt = getLunarDisplayText(date); return lt ? `<div class="text-[10px] text-theme-muted leading-none mt-0.5 truncate">${lt}</div>` : ''; })()}
                </div>
                <div class="p-1 min-h-[28px]"
                     ondragover="event.preventDefault()"
                     ondrop="handleWeekAllDayDrop(event, '${dateStr}')">
                    ${visibleTasks.map(task => {
                        const list = lists.find(l => l.id === task.listId);
                        const isOverdue = isTaskOverdue(task);
                        const titleClass = task.completed ? 'opacity-55 text-theme-muted' : (isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary');
                        return `<div class="text-xs px-1 py-0.5 rounded-r truncate cursor-pointer ${titleClass}"
                                     style="background-color: ${list?.color || '#3b82f6'}20; border-left: 2px solid ${list?.color || '#3b82f6'};"
                                     title="${escapeHtml(task.title || '新任务')}"
                                     onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')"
                                     draggable="true"
                                     ondragstart="handleTaskDragStart(event, '${task.id}')"
                                     ondragend="handleTaskDragEnd(event)">${task.title || '新任务'}</div>`;
                    }).join('')}
                    ${dayAllDay.length > 2 && collapsed ? `<div class="text-xs text-blue-500 cursor-pointer px-1" onclick="toggleWeekAllDay('${dateStr}')">+${dayAllDay.length - 2}更多</div>` : ''}
                    ${dayAllDay.length > 2 && !collapsed ? `<div class="text-xs text-blue-500 cursor-pointer px-1" onclick="toggleWeekAllDay('${dateStr}')">收起</div>` : ''}
                </div>
            </div>
        `;
    });
    allDayHtml += '</div></div>';
    
    let timeGridHtml = `<div class="week-time-grid" style="height: 100%; overflow-y: auto; position: relative; padding-bottom: 80px;" id="week-time-grid">`;
    
    timeGridHtml += allDayHtml;
    
    timeGridHtml += '<div class="flex">';
    
    timeGridHtml += `<div class="flex-shrink-0" style="width: 52px;">`;
    for (let h = weekViewHourStart; h < weekViewHourEnd; h++) {
        timeGridHtml += `<div style="height: ${hourHeight}px;" class="text-xs text-theme-muted text-right pr-2 pt-0">${h.toString().padStart(2, '0')}:00</div>`;
    }
    timeGridHtml += '</div>';
    
    timeGridHtml += '<div class="flex-1 flex relative">';
    
    for (let h = weekViewHourStart; h < weekViewHourEnd; h++) {
        timeGridHtml += `<div class="absolute left-0 right-0 border-t border-theme" style="top: ${(h - weekViewHourStart) * hourHeight}px;"></div>`;
        timeGridHtml += `<div class="absolute left-0 right-0 border-t border-dashed border-theme" style="top: ${(h - weekViewHourStart) * hourHeight + 30}px; opacity: 0.4;"></div>`;
    }
    
    if (isCurrentWeek(weekDays)) {
        const topPx = (currentHour - weekViewHourStart) * hourHeight + (currentMinute / 60) * hourHeight;
        if (currentHour >= weekViewHourStart && currentHour < weekViewHourEnd) {
            timeGridHtml += `<div class="absolute left-0 right-0 z-10 pointer-events-none" style="top: ${topPx}px;">
                <div class="flex items-center">
                    <div class="w-2 h-2 rounded-full bg-red-500 -ml-1"></div>
                    <div class="flex-1 border-t-2 border-red-500" style="border-style: dashed;"></div>
                </div>
            </div>`;
        }
    }
    
    weekDays.forEach(date => {
        const dateStr = formatDate(date);
        const isToday = dateStr === todayStr;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const dayTimed = timedTasks[dateStr] || [];
        
        const columnTasks = layoutDayTasks(dayTimed, hourHeight);
        
        timeGridHtml += `
            <div class="flex-1 min-w-0 relative ${isWeekend ? 'week-weekend-bg bg-gray-50/50' : ''} ${isToday ? 'bg-blue-50/30 dark:bg-blue-900/15' : ''} border-l border-theme"
                 style="height: ${totalHours * hourHeight}px;"
                 onclick="handleWeekGridClick(event, '${dateStr}')"
                 onmousemove="handleWeekGridMouseMove(event, '${dateStr}')"
                 onmouseleave="handleWeekGridMouseLeave(event)"
                 ondragover="handleWeekDragOver(event)"
                 ondrop="handleWeekTimeDrop(event, '${dateStr}')">
                <div class="week-hover-indicator absolute left-0 right-0 h-6 rounded flex items-center justify-between px-2 bg-blue-50/80 dark:bg-blue-900/30 pointer-events-none" style="display: none; top: 0px; z-index: 6;">
                    <span class="week-hover-time text-xs text-blue-500 dark:text-blue-300 font-medium"></span>
                    <span class="text-blue-500 dark:text-blue-300 font-bold text-sm">+</span>
                </div>
                ${columnTasks.map(taskLayout => {
                    const list = lists.find(l => l.id === taskLayout.task.listId);
                    const color = list?.color || '#3b82f6';
                    const topPx = taskLayout.top;
                    const heightPx = Math.max(taskLayout.height, 20);
                    const widthPercent = taskLayout.width;
                    const leftPercent = taskLayout.left;
                    const isOverdue = isTaskOverdue(taskLayout.task);
                    const titleClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary';

                    return `<div class="absolute rounded-r px-1 py-0.5 overflow-hidden cursor-pointer task-item week-task-item ${taskLayout.task.completed ? 'opacity-55' : ''}"
                                 style="top: ${topPx}px; height: ${heightPx}px; width: ${widthPercent}%; left: ${leftPercent}%; background-color: ${color}20; border-left: 3px solid ${color}; z-index: 5;"
                                 onclick="event.stopPropagation(); openTaskDetailPanel('${taskLayout.task.id}')"
                                 draggable="true"
                                 ondragstart="handleTaskDragStart(event, '${taskLayout.task.id}')"
                                 ondragend="handleTaskDragEnd(event)">
                        <div class="text-xs font-medium truncate ${titleClass}" title="${escapeHtml(taskLayout.task.title || '新任务')}">${taskLayout.task.title || '新任务'}</div>
                        ${heightPx > 30 ? `<div class="text-xs text-theme-muted truncate">${formatTime(taskLayout.task.startTime)}${taskLayout.task.endTime ? ' - ' + formatTime(taskLayout.task.endTime) : ''}</div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        `;
    });
    
    timeGridHtml += '</div></div></div>';
    
    if (!hasAnyTasks) {
        timeGridHtml = `<div class="flex flex-col items-center justify-center py-20 text-theme-muted">
            <i class="fas fa-calendar-week text-6xl mb-4 opacity-30"></i>
            <p class="text-lg">本周暂无任务，点击空白区域添加任务</p>
        </div>`;
    }
    
    const weekTitle = weekDays[0].getMonth() !== weekDays[6].getMonth()
        ? `${formatMonthYear(weekDays[0])} - ${formatMonthYear(weekDays[6])}`
        : formatMonthYear(weekDays[0]);

    const bottomNavHtml = `
        <div class="fixed bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-theme-secondary/80 backdrop-blur-md rounded-xl shadow-lg px-6 py-3 z-50">
            <button onclick="navigateWeek(-1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                <i class="fas fa-chevron-left"></i>
            </button>
            <h2 class="text-xl font-bold text-theme-primary min-w-[240px] text-center">${weekTitle}</h2>
            <button onclick="navigateWeek(1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;

    // 保存旧网格的滚动位置（若存在），用于拖动后等重渲染场景保持视图位置
    const existingGrid = container.querySelector('#week-time-grid');
    const savedScrollTop = existingGrid ? existingGrid.scrollTop : null;

    container.innerHTML = `<div class="h-full flex flex-col">${headerHtml}${hasAnyTasks ? timeGridHtml : ''}${bottomNavHtml}</div>`;

    if (hasAnyTasks && isCurrentWeek(weekDays)) {
        setTimeout(() => {
            const grid = document.getElementById('week-time-grid');
            if (grid) {
                if (savedScrollTop !== null) {
                    // 重渲染（如拖动任务后）：恢复之前的滚动位置
                    grid.scrollTop = savedScrollTop;
                } else {
                    // 首次渲染/切换到周视图：滚动到当前时刻
                    const scrollTarget = Math.max(0, (currentHour - weekViewHourStart - 1) * hourHeight);
                    grid.scrollTop = scrollTarget;
                }
            }
        }, 50);
    }
}

function layoutDayTasks(dayTasks, hourHeight) {
    const layouts = [];

    if (dayTasks.length === 0) return layouts;

    const sorted = [...dayTasks].sort((a, b) => {
        const aStart = new Date(a.startTime);
        const bStart = new Date(b.startTime);
        if (aStart.getTime() !== bStart.getTime()) return aStart - bStart;
        const aDuration = getTaskDurationMinutes(a);
        const bDuration = getTaskDurationMinutes(b);
        return bDuration - aDuration;
    });

    // 预计算每个任务的起止分钟数与位置
    const taskInfo = sorted.map(task => {
        const start = new Date(task.startTime);
        const startMinutes = start.getHours() * 60 + start.getMinutes();
        const durationMinutes = getTaskDurationMinutes(task);
        return {
            task,
            top: (startMinutes / 60 - weekViewHourStart) * hourHeight,
            height: (durationMinutes / 60) * hourHeight,
            startMinutes,
            endMinutes: startMinutes + durationMinutes
        };
    });

    // 按时间重叠关系分组为簇：仅相互重叠的任务进入同一簇，不重叠的任务各自独立
    const clusters = [];
    let currentCluster = [];
    let clusterEnd = -Infinity;
    taskInfo.forEach(info => {
        if (currentCluster.length === 0 || info.startMinutes < clusterEnd) {
            currentCluster.push(info);
            clusterEnd = Math.max(clusterEnd, info.endMinutes);
        } else {
            clusters.push(currentCluster);
            currentCluster = [info];
            clusterEnd = info.endMinutes;
        }
    });
    if (currentCluster.length > 0) clusters.push(currentCluster);

    // 每个簇独立计算列数和宽度：单任务占满全天宽度，多任务并列时按列均分
    clusters.forEach(cluster => {
        if (cluster.length === 1) {
            const info = cluster[0];
            layouts.push({ ...info, width: 100, left: 0 });
            return;
        }

        const columns = [];
        cluster.forEach(info => {
            let placed = false;
            for (let col = 0; col < columns.length; col++) {
                const lastInCol = columns[col][columns[col].length - 1];
                if (info.startMinutes >= lastInCol.endMinutes) {
                    columns[col].push(info);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                columns.push([info]);
            }
        });

        const totalCols = columns.length;
        columns.forEach((col, colIndex) => {
            col.forEach(info => {
                layouts.push({
                    ...info,
                    width: 100 / totalCols,
                    left: colIndex * 100 / totalCols
                });
            });
        });
    });

    return layouts;
}

function getTaskDurationMinutes(task) {
    if (task.endTime) {
        const start = new Date(task.startTime);
        const end = new Date(task.endTime);
        return Math.max(15, (end - start) / (1000 * 60));
    }
    return settings.defaultDuration || 30;
}

function isCurrentWeek(weekDays) {
    const today = new Date();
    return weekDays.some(d => isSameDay(d, today));
}

function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function formatWeekdayShort(date) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return '周' + weekdays[date.getDay()];
}

// 获取某天的农历显示文本（用于周/日程视图日期头）
// 返回空字符串表示不显示；优先级：节假日 > 农历节日 > 节气 > 农历日名
function getLunarDisplayText(date) {
    if (!settings.showLunar || typeof LunarCalendar === 'undefined') return '';
    const lunar = LunarCalendar.solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
    if (!lunar) return '';
    const dateStr = formatDate(date);
    const holidayInfo = getHolidayInfo(dateStr);
    if (holidayInfo && holidayInfo.type === 'holiday' && holidayInfo.isActualDay) {
        return holidayInfo.name;
    }
    const lunarFestival = LunarCalendar.getLunarFestival(lunar.lMonth, lunar.lDay, lunar.isLeap, lunar.lYear);
    if (lunarFestival) return lunarFestival;
    const md = dateStr.substring(5);
    const solarTerms = LunarCalendar.getSolarTerms(date.getFullYear());
    if (solarTerms && solarTerms[md]) return solarTerms[md];
    return lunar.lDayName || '';
}

function toggleWeekAllDay(dateStr) {
    weekAllDayCollapsed[dateStr] = weekAllDayCollapsed[dateStr] === false;
    renderView();
}

function handleWeekGridClick(event, dateStr) {
    event.stopPropagation();
    const grid = event.currentTarget;
    const rect = grid.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const hour = weekViewHourStart + Math.floor(y / 60);
    const minute = Math.round((y % 60) / 15) * 15;
    
    if (hour < weekViewHourStart || hour >= weekViewHourEnd) return;
    
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    
    // 如果当前有打开的空任务详情，先删除空任务
    if (currentDetailTaskId) {
        const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
        if (taskIndex !== -1) {
            const task = tasks[taskIndex];
            const titleEl = document.getElementById('detail-task-title');
            const notesEl = document.getElementById('detail-task-notes');
            const currentTitle = titleEl ? titleEl.value : (task.title || '');
            const currentNotes = notesEl ? notesEl.value : (task.notes || '');
            if ((!currentTitle || !currentTitle.trim()) && (!currentNotes || !currentNotes.trim())) {
                tasks.splice(taskIndex, 1);
                saveData();
                document.getElementById('task-detail-panel').classList.add('hidden');
                currentDetailTaskId = null;
            } else {
                closeTaskDetailPanel();
            }
        } else {
            closeTaskDetailPanel();
        }
    }
    
    // 直接创建带指定时间的非全天任务
    const startTime = new Date(`${dateStr}T${timeStr}`);
    const newTask = {
        id: generateId(),
        title: '',
        listId: settings.defaultListId || 'default',
        important: settings.defaultImportant || false,
        urgent: settings.defaultUrgent || false,
        notes: '',
        tags: [],
        startTime: startTime.toISOString(),
        endTime: null,
        isAllDay: false,
        reminder: 0,
        repeat: null,
        completed: false,
        createdAt: new Date().toISOString(),
        mode: 'text',
        subtasks: [{ id: generateId(), text: '', completed: false, originalOrder: 0 }],
        progress: 0
    };
    
    tasks.push(newTask);
    saveData();
    renderLists();
    renderView();
    openTaskDetailPanel(newTask.id);
    
    setTimeout(() => {
        const titleInput = document.getElementById('detail-task-title');
        if (titleInput) {
            titleInput.focus();
            titleInput.select();
        }
    }, 100);
}

function handleWeekGridMouseMove(event, dateStr) {
    const grid = event.currentTarget;
    const indicator = grid.querySelector('.week-hover-indicator');
    if (!indicator) return;
    
    if (event.target.closest('.task-item')) {
        indicator.style.display = 'none';
        return;
    }
    
    const rect = grid.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const snappedY = Math.round(y / 15) * 15;
    const hour = weekViewHourStart + Math.floor(snappedY / 60);
    const minute = snappedY % 60;
    
    if (hour < weekViewHourStart || hour >= weekViewHourEnd) {
        indicator.style.display = 'none';
        return;
    }
    
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    
    indicator.style.display = 'flex';
    indicator.style.top = `${snappedY - 12}px`;
    indicator.querySelector('.week-hover-time').textContent = timeStr;
}

function handleWeekGridMouseLeave(event) {
    const grid = event.currentTarget;
    const indicator = grid.querySelector('.week-hover-indicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
}

function navigateWeek(direction) {
    currentDate.setDate(currentDate.getDate() + direction * 7);
    renderView();
}

let _expandedMonthDay = null;

function renderMonthView(container) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
    const weekdayNames = settings.weekStart === 'monday' ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    let startOffset = firstDay.getDay() - dayOffset;
    if (startOffset < 0) startOffset += 7;
    
    const days = [];
    for (let i = startOffset - 1; i >= 0; i--) {
        days.push(new Date(year, month, -i));
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
        days.push(new Date(year, month, i));
    }
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
        days.push(new Date(year, month + 1, i));
    }
    
    container.innerHTML = `
        <div id="month-view-container">
            <div class="grid grid-cols-7 gap-2" id="month-grid">
                ${weekdayNames.map(d => `
                    <div class="text-center text-sm font-medium text-theme-secondary py-2">${d}</div>
                `).join('')}
                ${days.map(date => {
                    const dateStr = formatDate(date);
                    const dayTasks = getTasksForDate(date);
                    const isToday = isSameDay(date, new Date());
                    const isCurrentMonth = date.getMonth() === month;
                    const isExpanded = _expandedMonthDay === dateStr;
                    const displayTasks = isExpanded ? dayTasks : dayTasks.slice(0, 3);
                    
                    let lunarHtml = '';
                    let holidayBadge = '';
                    let weekBadge = '';
                    const holidayInfo = getHolidayInfo(dateStr);
                    const isWeekStartsOnMonday = settings.weekStart === 'monday';
                    const isWeekFirstDay = isWeekStartsOnMonday ? date.getDay() === 1 : date.getDay() === 0;
                    if (isWeekFirstDay) {
                        const weekNum = getWeekNumber(date, isWeekStartsOnMonday);
                        weekBadge = `<span class="text-[10px] text-theme-muted leading-none">${weekNum}周</span>`;
                    }
                    if (settings.showLunar && typeof LunarCalendar !== 'undefined') {
                        const lunar = LunarCalendar.solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
                        if (lunar) {
                            let displayText = lunar.lDayName;
                            if (holidayInfo && holidayInfo.type === 'holiday' && holidayInfo.isActualDay) {
                                displayText = holidayInfo.name;
                            } else {
                                const lunarFestival = LunarCalendar.getLunarFestival(lunar.lMonth, lunar.lDay, lunar.isLeap, lunar.lYear);
                                if (lunarFestival) {
                                    displayText = lunarFestival;
                                } else {
                                    const md = dateStr.substring(5);
                                    const solarTerms = LunarCalendar.getSolarTerms(date.getFullYear());
                                    if (solarTerms[md]) {
                                        displayText = solarTerms[md];
                                    }
                                }
                            }
                            lunarHtml = `<span class="text-[10px] text-theme-muted leading-none">${displayText}</span>`;
                        }
                    }
                    
                    if (holidayInfo) {
                        if (holidayInfo.type === 'work') {
                            holidayBadge = `<span class="text-[10px] text-red-500 font-bold leading-none" title="${holidayInfo.name}">班</span>`;
                        } else {
                            holidayBadge = `<span class="text-[10px] text-green-500 font-bold leading-none" title="${holidayInfo.name}">休</span>`;
                        }
                    }
                    
                    return `
                        <div class="calendar-day bg-theme-secondary rounded-xl shadow-theme p-2 ${isExpanded ? 'relative z-20 ring-2 ring-blue-400' : 'min-h-[100px] relative'} ${isToday ? 'today' : ''} ${!isCurrentMonth ? 'opacity-40' : ''} border border-theme drop-zone group"
                             data-date="${dateStr}"
                             ondragover="handleTaskDragOver(event)"
                             ondrop="handleMonthDrop(event, '${dateStr}')">
                            <div class="grid items-center mb-2" style="grid-template-columns: 1fr auto 1fr">
                                <div class="flex justify-start">${holidayBadge || weekBadge || ''}</div>
                                <span class="${isToday ? 'w-7 h-7 inline-flex items-center justify-center rounded-full bg-blue-500 text-white font-bold' : 'font-medium text-theme-primary'}">${date.getDate()}</span>
                                <div class="flex justify-end">${lunarHtml || ''}</div>
                            </div>
                            <div class="space-y-1 ${isExpanded ? 'max-h-[200px] overflow-y-auto' : ''}">
                                ${displayTasks.map(task => {
                                    const list = lists.find(l => l.id === task.listId);
                                    const startTime = task.startTime ? new Date(task.startTime) : null;
                                    const timeStr = task.isAllDay ? '' : (startTime ? `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}` : '');
                                    const isOverdue = isTaskOverdue(task);
                                    const titleClass = task.completed ? 'opacity-55 text-theme-muted' : (isOverdue ? OVERDUE_TEXT_CLASS : '');
                                    return `
                                        <div draggable="true" data-task-id="${task.id}"
                                             ondragstart="handleTaskDragStart(event, '${task.id}')"
                                             ondragend="handleTaskDragEnd(event)"
                                             onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')"
                                             class="text-xs p-1 rounded-r cursor-pointer truncate task-item month-task-item ${task.completed ? '' : 'hover:bg-theme-tertiary'} flex items-center justify-between gap-1"
                                             style="background-color: ${list?.color}15; border-left: 2px solid ${list?.color || '#3b82f6'}">
                                            <span class="truncate ${titleClass}" title="${escapeHtml(task.title || '新任务')}">${task.title || '新任务'}</span>
                                            ${timeStr ? `<span class="flex-shrink-0 text-theme-muted ${task.completed ? 'opacity-55' : ''}">${timeStr}</span>` : ''}
                                        </div>
                                    `;
                                }).join('')}
                                ${dayTasks.length > 3 && !isExpanded ? `<div class="relative text-xs"><span class="text-blue-500 cursor-pointer hover:underline block text-center" onclick="event.stopPropagation(); expandMonthDay('${dateStr}')">+${dayTasks.length - 3}更多</span><span class="text-blue-500 cursor-pointer hover:underline font-bold opacity-0 group-hover:opacity-100 transition-opacity absolute right-0 top-0" onclick="event.stopPropagation(); openAddTaskModal('${dateStr}')">+</span></div>` : ''}
                                ${isExpanded ? `<div class="text-xs text-blue-500 text-center cursor-pointer hover:underline pt-1" onclick="event.stopPropagation(); collapseMonthDay()">收起</div>` : ''}
                            </div>
                            ${dayTasks.length <= 3 || isExpanded ? `<button class="absolute bottom-1 right-1 text-blue-500 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity z-10" onclick="event.stopPropagation(); openAddTaskModal('${dateStr}')">+</button>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="fixed bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-theme-secondary/80 backdrop-blur-md rounded-xl shadow-lg px-6 py-3 z-50">
                <button onclick="navigateMonth(-1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <h2 class="text-xl font-bold text-theme-primary min-w-[240px] text-center">${year}年${month + 1}月</h2>
                <button onclick="navigateMonth(1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        </div>
    `;
    
    setTimeout(() => {
        if (_expandedMonthDay) {
            const expandedCell = document.querySelector(`.calendar-day[data-date="${_expandedMonthDay}"]`);
            if (expandedCell) {
                const grid = document.getElementById('month-grid');
                if (grid) {
                    const gridRect = grid.getBoundingClientRect();
                    const cellRect = expandedCell.getBoundingClientRect();
                    const cellHeight = cellRect.height;
                    const overflow = (cellRect.bottom) - gridRect.bottom;
                    if (overflow > 0) {
                        expandedCell.style.marginBottom = `-${Math.min(overflow + 8, cellHeight)}px`;
                    }
                }
            }
        }
        document.addEventListener('click', _monthCollapseHandler);
    }, 50);
}

function _monthCollapseHandler(e) {
    if (_expandedMonthDay === null) return;
    const expandedCell = document.querySelector(`.calendar-day[data-date="${_expandedMonthDay}"]`);
    if (expandedCell && !expandedCell.contains(e.target)) {
        collapseMonthDay();
    }
}

function expandMonthDay(dateStr) {
    document.removeEventListener('click', _monthCollapseHandler);
    _expandedMonthDay = dateStr;
    renderMonthView(document.getElementById('view-container'));
}

function collapseMonthDay() {
    document.removeEventListener('click', _monthCollapseHandler);
    _expandedMonthDay = null;
    renderMonthView(document.getElementById('view-container'));
}

function navigateMonth(direction) {
    _expandedMonthDay = null;
    document.removeEventListener('click', _monthCollapseHandler);
    currentDate.setMonth(currentDate.getMonth() + direction);
    renderView();
}

function renderQuadrantView(container) {
    const filteredTasks = filterTasks(tasks);
    
    const quadrants = {
        'urgent-important': {
            title: '重要且紧急',
            color: 'red',
            tasks: sortTasksByCompletion(filteredTasks.filter(t => t.important && t.urgent)),
            icon: 'fa-exclamation-triangle'
        },
        'important-not-urgent': {
            title: '重要不紧急',
            color: 'blue',
            tasks: sortTasksByCompletion(filteredTasks.filter(t => t.important && !t.urgent)),
            icon: 'fa-star'
        },
        'urgent-not-important': {
            title: '紧急不重要',
            color: 'yellow',
            tasks: sortTasksByCompletion(filteredTasks.filter(t => !t.important && t.urgent)),
            icon: 'fa-clock'
        },
        'not-urgent-not-important': {
            title: '不重要不紧急',
            color: 'gray',
            tasks: sortTasksByCompletion(filteredTasks.filter(t => !t.important && !t.urgent)),
            icon: 'fa-circle'
        }
    };
    
    // WIP Limit: 重要且紧急象限未完成任务数
    const urgentImportantIncomplete = quadrants['urgent-important'].tasks.filter(t => !t.completed).length;
    const isOverloaded = urgentImportantIncomplete > 5;
    
    const colorClasses = {
        red: isOverloaded 
            ? 'border-red-400 bg-red-100 dark:border-red-500 dark:bg-red-900/50' 
            : 'border-red-300 bg-red-50 dark:border-red-600 dark:bg-red-900/30',
        blue: 'border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/30',
        yellow: 'border-yellow-300 bg-yellow-50 dark:border-yellow-600 dark:bg-yellow-900/30',
        gray: 'border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-700/50'
    };
    
    const iconColors = {
        red: 'text-red-600',
        blue: 'text-blue-600',
        yellow: 'text-yellow-600',
        gray: 'text-gray-600'
    };
    
    container.innerHTML = `
        <div class="h-full flex flex-col">
            <div class="flex items-center justify-between mb-6 flex-shrink-0">
                <h2 class="text-2xl font-bold text-theme-primary">四象限视图</h2>
                <button onclick="resetQuadrantOrder()" class="text-sm text-blue-500 hover:text-blue-600">
                    <i class="fas fa-redo mr-1"></i>恢复默认
                </button>
            </div>
            <div class="grid grid-cols-2 gap-4 flex-1 min-h-0" id="quadrants-container">
                ${quadrantOrder.map((key, index) => {
                    const q = quadrants[key];
                    return `
                        <div class="quadrant-card bg-theme-secondary rounded-xl shadow-theme border-2 ${colorClasses[q.color]} p-4 flex flex-col min-h-0" 
                             data-quadrant="${key}"
                             ondragover="handleTaskDragOver(event)"
                             ondrop="handleQuadrantCardDrop(event, '${key}')">
                            <div class="flex items-center justify-between mb-3 cursor-move quadrant-drag-handle" 
                                 draggable="true"
                                 ondragstart="handleQuadrantDragStart(event, '${key}')">
                                <h3 class="font-bold ${iconColors[q.color]} flex items-center gap-2">
                                    <i class="fas ${q.icon}"></i>
                                    ${q.title}
                                    <span class="bg-theme-secondary px-2 py-0.5 rounded-full text-sm text-theme-primary">${q.tasks.filter(t => !t.completed).length}</span>
                                </h3>
                                <div class="flex items-center gap-2">
                                    <button onclick="openAddTaskForQuadrant('${key}')" class="text-theme-muted hover:text-theme-primary">
                                        <i class="fas fa-plus"></i>
                                    </button>
                                    <i class="fas fa-arrows-alt text-theme-muted text-xs"></i>
                                </div>
                            </div>
                            ${key === 'urgent-important' && isOverloaded ? `
                                <div class="mb-2 px-3 py-2 bg-red-200/60 dark:bg-red-800/40 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                                    <i class="fas fa-exclamation-circle"></i>
                                    <span>当前核心焦虑源过多（${urgentImportantIncomplete}个），建议拆解或降级部分任务。</span>
                                </div>
                            ` : ''}
                            <div class="space-y-2 max-h-[300px] overflow-y-auto quadrant-drop-zone"
                                 ondragover="handleTaskDragOver(event)"
                                 ondrop="handleTaskDrop(event, null, '${key}')">
                                ${q.tasks.length === 0 ? `
                                    <div class="text-center py-6 text-theme-muted text-sm border-2 border-dashed border-theme rounded-lg">暂无任务（拖拽任务到此处）</div>
                                ` : q.tasks.map(task => {
                                    const list = lists.find(l => l.id === task.listId);
                                    let timeDisplay = '';
                                    if (task.startTime) {
                                        if (isMultiDayTask(task)) {
                                            const start = new Date(task.startTime);
                                            const end = new Date(task.endTime);
                                            timeDisplay = `${start.getMonth()+1}月${start.getDate()}日 ${formatTime(start)} - ${end.getMonth()+1}月${end.getDate()}日 ${formatTime(end)}`;
                                        } else if (task.isAllDay) {
                                            const start = new Date(task.startTime);
                                            timeDisplay = `${start.getMonth()+1}月${start.getDate()}日`;
                                        } else if (task.endTime) {
                                            timeDisplay = `${formatTime(new Date(task.startTime))} - ${formatTime(new Date(task.endTime))}`;
                                        } else {
                                            timeDisplay = formatDateTime(task.startTime);
                                        }
                                    }
                                    const listColor = list ? list.color : '#9ca3af';
                                    const focusMinutes = getTaskFocusMinutes(task.id);
                                    // 第二象限任务停留天数标记
                                    const stagnationDays = getQuadrantStagnationDays(task);
                                    const isStagnant = stagnationDays > 7;
                                    const isOverdue = isTaskOverdue(task);
                                    const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-secondary';
                                    return `
                                        <div class="flex items-start gap-3 mb-3 group ${task.completed ? 'opacity-60' : ''} ${isStagnant && key === 'important-not-urgent' ? 'ring-1 ring-amber-400/50 rounded-lg' : ''}" onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')" draggable="true" data-task-id="${task.id}"
                                             ondragstart="handleTaskDragStart(event, '${task.id}')"
                                             ondragover="handleTaskDragOver(event)"
                                             ondrop="handleTaskDrop(event, '${task.id}', '${key}')">
                                            <div class="w-8 flex-shrink-0 flex flex-col items-center justify-between self-stretch relative">
                                                <button onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-blue-500 dark:border-white hover:border-blue-600 dark:hover:border-blue-300'}">
                                                    ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                                                </button>
                                                ${renderFocusButton(task.id)}
                                            </div>
                                            <div class="flex-1 bg-theme-tertiary rounded-r-lg p-3 cursor-pointer hover:opacity-80 transition" style="border-left: 4px solid ${listColor}; border-top-left-radius: 0; border-bottom-left-radius: 0;">
                                                <div class="flex items-center gap-2 text-sm mb-1 text-theme-secondary">
                                                    ${timeDisplay ? `<span class="${timeTextClass}">${timeDisplay}</span>` : ''}
                                                    ${list ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${listColor}"></span>${list.name}</span>` : ''}
                                                    ${renderTagCapsules(task, 2, 'right')}
                                                    ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-500"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                                                    ${task.progress && task.progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-blue-500"></i>${task.progress}%</span>` : ''}
                                                    ${isStagnant && key === 'important-not-urgent' ? `<span class="flex items-center gap-1 text-amber-500"><i class="fas fa-hourglass-half"></i>已停留${stagnationDays}天</span>` : ''}
                                                </div>
                                                <div class="font-medium ${task.completed ? 'text-theme-muted' : 'text-theme-primary'}">
                                                    ${task.title || '新任务'}
                                                </div>
                                                ${task.notes ? `<div class="text-xs text-theme-muted mt-1">${task.notes}</div>` : ''}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    // 第二象限激活推进器：检查是否有停留超过7天的未完成任务
    checkQuadrantStagnation();
}

function resetQuadrantOrder() {
    quadrantOrder = ['urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important'];
    saveData();
    renderView();
    showToast('已恢复默认顺序', 'success');
}

// 第二象限激活推进器：检查停留超过7天的未完成任务并弹窗提醒
let _stagnationNotified = false;

function checkQuadrantStagnation() {
    if (_stagnationNotified) return;
    
    const stagnantTasks = filterTasks(tasks).filter(t => {
        if (!t.important || t.urgent || t.completed) return false;
        return getQuadrantStagnationDays(t) > 7;
    });
    
    if (stagnantTasks.length === 0) return;
    
    _stagnationNotified = true;
    
    const task = stagnantTasks[0]; // 提醒第一个滞留任务
    const days = getQuadrantStagnationDays(task);
    
    showQuadrantStagnationModal(task, days, stagnantTasks.length);
}

function showQuadrantStagnationModal(task, days, totalCount) {
    const existing = document.getElementById('quadrant-stagnation-modal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'quadrant-stagnation-modal';
    modal.className = 'fixed bottom-6 right-6 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-amber-300 dark:border-amber-600 p-5 z-50 max-w-sm';
    modal.style.animation = 'fadeInUp 0.3s ease-out';
    modal.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                <i class="fas fa-hourglass-half text-amber-600"></i>
            </div>
            <div class="flex-1">
                <h4 class="font-bold text-gray-800 dark:text-gray-100 mb-1">重要任务长期未推进</h4>
                <p class="text-sm text-gray-600 dark:text-gray-300 mb-1">「${task.title || '新任务'}」已在"重要不紧急"象限停留 <span class="font-bold text-amber-600">${days}</span> 天。</p>
                ${totalCount > 1 ? `<p class="text-xs text-gray-500 dark:text-gray-400 mb-2">另有 ${totalCount - 1} 个类似任务</p>` : ''}
                <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">是否将其临时调整为"紧急"以加速推进？</p>
                <div class="flex gap-2">
                    <button onclick="promoteStagnantTask('${task.id}')" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-sm rounded-lg transition">
                        <i class="fas fa-bolt mr-1"></i>设为紧急
                    </button>
                    <button onclick="focusStagnantTask('${task.id}')" class="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg transition">
                        <i class="fas fa-clock mr-1"></i>开始专注
                    </button>
                    <button onclick="dismissStagnationModal()" class="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition">
                        稍后
                    </button>
                </div>
            </div>
            <button onclick="dismissStagnationModal()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex-shrink-0">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    document.body.appendChild(modal);
    
    // 30秒后自动消失
    setTimeout(() => {
        if (document.getElementById('quadrant-stagnation-modal')) {
            dismissStagnationModal();
        }
    }, 30000);
}

function promoteStagnantTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        task.urgent = true;
        saveData();
        renderView();
        showToast(buildTaskToastMessage(task), 'success', null, '已调整为紧急');
    }
    dismissStagnationModal();
}

function focusStagnantTask(taskId) {
    dismissStagnationModal();
    startPomodoroForTask(taskId);
}

function dismissStagnationModal() {
    const modal = document.getElementById('quadrant-stagnation-modal');
    if (modal) {
        modal.style.animation = 'fadeOutDown 0.3s ease-in';
        setTimeout(() => modal.remove(), 300);
    }
}

function openAddTaskForQuadrant(quadrantKey) {
    const important = quadrantKey.includes('important') && !quadrantKey.includes('not-important');
    const urgent = quadrantKey.includes('urgent') && !quadrantKey.includes('not-urgent');
    
    openAddTaskModal();
    document.getElementById('task-important').checked = important;
    document.getElementById('task-urgent').checked = urgent;
}

let scheduleMonthOffset = 0;
let _scheduleAutoScroll = true;
let taskListCompletedCollapsed = true;
let taskListCompletedShowAll = false;

function getTaskListGroup(task) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const dayAfterTomorrowStart = new Date(todayStart);
    dayAfterTomorrowStart.setDate(dayAfterTomorrowStart.getDate() + 2);
    const threeDaysLaterStart = new Date(todayStart);
    threeDaysLaterStart.setDate(threeDaysLaterStart.getDate() + 3);
    const sevenDaysLaterEnd = new Date(todayStart);
    sevenDaysLaterEnd.setDate(sevenDaysLaterEnd.getDate() + 7);
    sevenDaysLaterEnd.setHours(23, 59, 59, 999);

    if (task.completed) return 'completed';

    if (task.startTime) {
        const taskDate = new Date(task.startTime);
        
        // 跨天任务：如果当前日期在 [startTime, endTime] 范围内，显示在"今天"
        if (task.endTime) {
            const taskEndDate = new Date(task.endTime);
            const taskEndDayStart = new Date(taskEndDate.getFullYear(), taskEndDate.getMonth(), taskEndDate.getDate());
            const taskEndTomorrow = new Date(taskEndDayStart);
            taskEndTomorrow.setDate(taskEndTomorrow.getDate() + 1);
            // 当前日期在任务时间范围内 → 显示在"今天"
            if (now >= taskDate && now < taskEndTomorrow) {
                return 'today';
            }
            // 当前日期超过截止日期 → 已过期
            if (taskEndTomorrow <= todayStart) {
                return 'overdue';
            }
        }
        
        if (taskDate < todayStart) return 'overdue';
        if (taskDate < tomorrowStart) return 'today';
        if (taskDate < dayAfterTomorrowStart) return 'tomorrow';
        if (taskDate < threeDaysLaterStart) return 'dayAfterTomorrow';
        if (taskDate <= sevenDaysLaterEnd) return 'recent7';
        return 'later';
    }

    return 'nodate';
}

function formatTaskListTime(task) {
    if (!task.startTime) return '';
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const dayAfterTomorrowStart = new Date(todayStart);
    dayAfterTomorrowStart.setDate(dayAfterTomorrowStart.getDate() + 2);

    const taskDate = new Date(task.startTime);
    const month = taskDate.getMonth() + 1;
    const day = taskDate.getDate();

    const threeDaysLaterStart = new Date(todayStart);
    threeDaysLaterStart.setDate(threeDaysLaterStart.getDate() + 3);

    if (task.isAllDay) {
        if (taskDate >= todayStart && taskDate < tomorrowStart) return '全天';
        if (taskDate >= yesterdayStart && taskDate < todayStart) return '昨天 全天';
        if (taskDate >= tomorrowStart && taskDate < dayAfterTomorrowStart) return '明天 全天';
        if (taskDate >= dayAfterTomorrowStart && taskDate < threeDaysLaterStart) return '后天 全天';
        const group = getTaskListGroup(task);
        if (group === 'recent7' || group === 'later') {
            return `${month}月${day}日 全天`;
        }
        return '全天';
    }

    const hours = taskDate.getHours().toString().padStart(2, '0');
    const mins = taskDate.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${mins}`;

    if (taskDate >= todayStart && taskDate < tomorrowStart) return timeStr;
    if (taskDate >= yesterdayStart && taskDate < todayStart) return `昨天 ${timeStr}`;
    if (taskDate >= tomorrowStart && taskDate < dayAfterTomorrowStart) return `明天 ${timeStr}`;
    if (taskDate >= dayAfterTomorrowStart && taskDate < threeDaysLaterStart) return `后天 ${timeStr}`;

    const group = getTaskListGroup(task);
    if (group === 'recent7' || group === 'later') {
        return `${month}月${day}日, ${timeStr}`;
    }

    return timeStr;
}

function renderTaskListView(container) {
    const filtered = filterTasks(tasks);
    const groups = {
        overdue: { label: '已过期', tasks: [] },
        today: { label: '今天', tasks: [] },
        tomorrow: { label: '明天', tasks: [] },
        dayAfterTomorrow: { label: '后天', tasks: [] },
        recent7: { label: '最近7天', tasks: [] },
        later: { label: '更远', tasks: [] },
        nodate: { label: '无日期', tasks: [] },
        completed: { label: '已完成', tasks: [] }
    };

    filtered.forEach(task => {
        const group = getTaskListGroup(task);
        groups[group].tasks.push(task);
    });

    groups.overdue.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.today.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.tomorrow.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.dayAfterTomorrow.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.recent7.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.later.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(a.startTime) - new Date(b.startTime);
    });
    groups.nodate.tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });
    groups.completed.tasks.sort((a, b) => {
        const aTime = a.completedAt || a.createdAt;
        const bTime = b.completedAt || b.createdAt;
        return new Date(bTime) - new Date(aTime);
    });

    const groupOrder = ['overdue', 'today', 'tomorrow', 'dayAfterTomorrow', 'recent7', 'later', 'nodate', 'completed'];
    const hasAnyTasks = groupOrder.slice(0, 7).some(g => groups[g].tasks.length > 0);

    if (!hasAnyTasks && groups.completed.tasks.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 text-theme-muted">
                <i class="fas fa-clipboard-list text-6xl mb-4 opacity-30"></i>
                <p class="text-lg">欢迎使用日程管理！</p>
                <p class="text-sm mt-2">点击右上角"+"来添加任务</p>
                <p class="text-sm mt-1">或使用快捷键Ctrl + Alt + N呼出命令面板快速添加任务</p>
            </div>
        `;
        return;
    }

    let html = '<div class="task-list-view" style="height: 100%; overflow-y: auto; overflow-x: hidden; padding-bottom: 40px;">';
    html += '<div class="bg-theme-secondary rounded-xl shadow-theme p-4">';

    groupOrder.forEach(groupKey => {
        const group = groups[groupKey];
        if (group.tasks.length === 0 && groupKey !== 'completed') return;
        if (groupKey === 'completed' && group.tasks.length === 0) return;

        const isCompletedGroup = groupKey === 'completed';
        const isCollapsed = isCompletedGroup && taskListCompletedCollapsed;
        const visibleTasks = isCompletedGroup && !taskListCompletedShowAll
            ? group.tasks.slice(0, 5)
            : group.tasks;
        const hasMore = isCompletedGroup && group.tasks.length > 5 && !taskListCompletedShowAll;

        html += `
            <div class="mb-3 last:mb-0" data-task-group="${groupKey}">
                <div class="flex items-center justify-between mb-2 cursor-pointer select-none ${isCompletedGroup ? 'task-list-group-header' : ''}"
                     ${isCompletedGroup ? `onclick="toggleTaskListCompletedGroup()"` : ''}>
                    <div class="flex items-center gap-2">
                        ${isCompletedGroup ? `<i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'} text-xs text-theme-muted mr-1"></i>` : ''}
                        <h3 class="text-base font-semibold ${groupKey === 'overdue' ? 'text-red-500' : 'text-theme-primary'}">${group.label}</h3>
                        <span class="text-sm text-theme-muted">(${group.tasks.length})</span>
                    </div>
                </div>
                <div class="${isCollapsed ? 'hidden' : ''}" id="task-list-completed-content">
        `;

        visibleTasks.forEach(task => {
            const list = lists.find(l => l.id === task.listId);
            const listColor = list ? list.color : '#9ca3af';
            const listName = list ? list.name : '';
            const focusMinutes = getTaskFocusMinutes(task.id);
            const timeDisplay = formatTaskListTime(task);
            const progress = task.progress || 0;
            const quadColors = getQuadrantColorClass(task);
            const isOverdue = isTaskOverdue(task);
            const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary';
            const tagCapsules = renderTagCapsules(task, 2, 'right');

            html += `
                <div class="task-list-item relative flex items-center gap-3 py-2.5 px-3 rounded-r-lg ${quadColors.bg} hover:opacity-85 transition cursor-pointer group ${task.completed ? 'opacity-55' : ''}"
                     data-list-id="${task.listId || 'default'}"
                     onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')"
                     >
                    <div class="task-list-color-bar" style="background-color: ${listColor};"></div>
                    <button onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" class="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-blue-500 dark:border-white hover:border-blue-600 dark:hover:border-blue-300'}">
                        ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                    </button>
                    <span class="flex-1 text-sm ${task.completed ? 'text-theme-muted' : 'text-theme-primary'} truncate min-w-0">${task.title || '新任务'}</span>
                    ${renderFocusButton(task.id)}
                    <div class="flex items-center gap-2 flex-shrink-0 text-xs text-theme-primary whitespace-nowrap">
                        ${tagCapsules}
                        ${progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-blue-400"></i>${progress}%</span>` : ''}
                        ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-400"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                        ${listName ? `<span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background-color: ${listColor}"></span><span class="hidden sm:inline">${listName}</span></span>` : ''}
                    </div>
                    ${timeDisplay ? `<span class="flex-shrink-0 text-xs ${timeTextClass} whitespace-nowrap" style="min-width: 50px; text-align: right;"><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
                </div>
            `;
        });

        if (hasMore) {
            html += `
                <div class="py-2 px-3">
                    <button onclick="event.stopPropagation(); showCompletedTasksPage()" class="text-sm text-blue-500 hover:text-blue-600 transition">
                        查看更多
                    </button>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;
    });

    html += '</div></div>';

    html += '</div>';
    container.innerHTML = html;
}

function toggleTaskListCompletedGroup() {
    taskListCompletedCollapsed = !taskListCompletedCollapsed;
    renderView();
}

function showCompletedTasksPage() {
    taskListCompletedShowAll = true;
    renderView();
}

function renderScheduleView(container) {
    const filteredTasks = filterTasks(tasks).filter(t => t.startTime);
    
    // 按日期和时间排序任务
    const sortedTasks = [...filteredTasks].sort((a, b) => {
        return new Date(a.startTime) - new Date(b.startTime);
    });
    
    // 按日期分组任务
    const groupedTasks = {};
    sortedTasks.forEach(task => {
        const date = new Date(task.startTime);
        const dateKey = date.toDateString();
        if (!groupedTasks[dateKey]) {
            groupedTasks[dateKey] = [];
        }
        groupedTasks[dateKey].push(task);
        
        // 跨天任务：如果开始日期已过但截止日期未过，也添加到截止日期的分组
        if (task.endTime) {
            const now = new Date();
            const startDate = new Date(task.startTime);
            const endDate = new Date(task.endTime);
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startDayStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDayStart = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            const endDayTomorrow = new Date(endDayStart);
            endDayTomorrow.setDate(endDayTomorrow.getDate() + 1);
            
            // 开始日期已过，截止日期未过 → 显示在截止日期列表
            if (startDayStart < todayStart && now < endDayTomorrow) {
                const endDateKey = endDayStart.toDateString();
                if (endDateKey !== dateKey) {
                    if (!groupedTasks[endDateKey]) {
                        groupedTasks[endDateKey] = [];
                    }
                    groupedTasks[endDateKey].push(task);
                }
            }
        }
    });
    
    Object.keys(groupedTasks).forEach(dateKey => {
        groupedTasks[dateKey] = sortTasksByCompletion(groupedTasks[dateKey]);
    });
    
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    
    // 计算月份范围（当前月 - 3个月 到 当前月 + 9个月，共1年）
    const currentDate = new Date();
    const today = new Date();
    const startMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 3 + scheduleMonthOffset, 1);
    const endMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 9 + scheduleMonthOffset, 0);
    
    let html = `
        <div class="schedule-container" style="height: 100%; overflow-y: auto; padding-bottom: 100px;">
            <div class="space-y-8">
    `;
    
    // 按月份生成日期列表
    const currentMonth = new Date(startMonth);
    while (currentMonth <= endMonth) {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        let monthHasTasks = false;
        let monthHtml = '';
        
        // 遍历这个月的每一天
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateKey = date.toDateString();
            const dayTasks = groupedTasks[dateKey] || [];
            
            // 只显示有任务的日期或今天
            const today = new Date();
            const isToday = date.toDateString() === today.toDateString();
            
            if (dayTasks.length > 0 || isToday) {
                monthHasTasks = true;
                const dayOfWeek = weekDays[date.getDay()];
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                
                monthHtml += `
                    <div class="bg-theme-secondary rounded-xl shadow-theme p-4 ${isToday ? 'ring-2 ring-blue-500' : ''} schedule-day-drop" data-drop-date="${dateStr}" ondragover="handleScheduleDragOver(event)" ondragleave="handleScheduleDragLeave(event)" ondrop="handleScheduleDrop(event)">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="text-center min-w-[60px]">
                                <div class="${isToday ? 'text-blue-600 font-bold' : 'text-theme-secondary'} text-2xl">${day}</div>
                                <div class="text-sm text-theme-muted">周${dayOfWeek}</div>
                                ${isToday ? '<div class="text-xs text-blue-500 font-medium mt-1">今天</div>' : ''}
                                ${(() => { const lt = getLunarDisplayText(date); return lt ? `<div class="text-[10px] text-theme-muted leading-none mt-1">${lt}</div>` : ''; })()}
                            </div>
                            <div class="flex-1">
                                <div class="relative pl-6">
                                    <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-theme"></div>
                                    ${dayTasks.map((task, taskIndex) => {
                                        const startTime = new Date(task.startTime);
                                        const startHour = startTime.getHours().toString().padStart(2, '0');
                                        const startMin = startTime.getMinutes().toString().padStart(2, '0');
                                        const colors = getQuadrantColorClass(task);
                                        const list = lists.find(l => l.id === task.listId);

                                        const timeDisplay = task.isAllDay ? '全天' : `${startHour}:${startMin}`;
                                        const focusMinutes = getTaskFocusMinutes(task.id);
                                        const isOverdue = isTaskOverdue(task);
                                        const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-secondary';

                                        return `
                                            <div class="schedule-task-item group flex items-start gap-4 mb-3 task-item ${taskIndex > 0 ? 'pt-3' : ''} ${task.completed ? 'opacity-60' : ''}" onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')" draggable="true" ondragstart="handleScheduleDragStart(event, '${task.id}')">
                                                <div class="w-8 flex-shrink-0 flex flex-col items-center justify-between self-stretch relative">
                                                    <button onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-blue-500 dark:border-white hover:border-blue-600 dark:hover:border-blue-300'}">
                                                        ${task.completed ? '<i class="fas fa-check text-xs"></i>' : ''}
                                                    </button>
                                                    ${renderFocusButton(task.id)}
                                                </div>
                                                <div class="${colors.bg} rounded-r-lg p-3 flex-1 hover:opacity-80 transition schedule-task-card" style="${list && list.color ? `border-left: 4px solid ${list.color};` : 'border-left: 4px solid #9ca3af;'} border-top-left-radius: 0; border-bottom-left-radius: 0;">
                                                    <div class="flex items-center gap-2 text-sm mb-1 text-theme-secondary">
                                                        <span class="${timeTextClass}">${timeDisplay}</span>
                                                        ${list ? `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${list.color}"></span>${list.name}</span>` : ''}
                                                        ${renderTagCapsules(task, 2, 'right')}
                                                        ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-500"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                                                        ${task.progress && task.progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-blue-500"></i>${task.progress}%</span>` : ''}
                                                    </div>
                                                    <div class="font-medium ${task.completed ? 'text-theme-muted' : 'text-theme-primary'}">
                                                        ${task.title || '新任务'}
                                                    </div>
                                                    ${task.notes ? `<div class="text-xs text-theme-secondary mt-1">${task.notes}</div>` : ''}
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
        
        // 只添加有内容的月份
        if (monthHasTasks || monthNames[month] === monthNames[today.getMonth()]) {
            html += `
                <div class="mb-6" data-schedule-month="${year}-${(month + 1).toString().padStart(2, '0')}">
                    <h3 class="text-xl font-bold text-theme-primary mb-4">
                        ${year}年${month + 1}月
                    </h3>
                    <div class="space-y-4">
                        ${monthHtml || '<div class="text-center text-theme-muted py-8">本月暂无日程</div>'}
                    </div>
                </div>
            `;
        }
        
        // 移动到下个月
        currentMonth.setMonth(currentMonth.getMonth() + 1);
    }
    
    html += `
            </div>
            
            <!-- 底部悬浮导航 -->
            <div class="fixed bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-theme-secondary/80 backdrop-blur-md rounded-xl shadow-lg px-6 py-3 z-50">
                <button onclick="navigateScheduleMonth(-1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <h2 id="schedule-nav-month" class="text-xl font-bold text-theme-primary min-w-[160px] text-center">
                    ${new Date().getFullYear()}年${new Date().getMonth() + 1}月
                </h2>
                <button onclick="navigateScheduleMonth(1)" class="p-2 hover:bg-theme-tertiary rounded-lg transition text-theme-secondary">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        </div>
    `;
    
    const savedScrollTop = container.querySelector('.schedule-container')
        ? container.querySelector('.schedule-container').scrollTop : 0;

    container.innerHTML = html;

    // 添加滚动监听，更新底部导航栏显示当前可见月份
    const scheduleScrollContainer = container.querySelector('.schedule-container');
    if (scheduleScrollContainer) {
        // 同步恢复滚动位置，消除刷新时从顶部（往期任务）跳到今天的跳动
        if (!_scheduleAutoScroll && savedScrollTop > 0) {
            scheduleScrollContainer.scrollTop = savedScrollTop;
        }
        scheduleScrollContainer.addEventListener('scroll', function() {
            const navMonth = document.getElementById('schedule-nav-month');
            if (!navMonth) return;
            const monthSections = scheduleScrollContainer.querySelectorAll('[data-schedule-month]');
            if (monthSections.length === 0) return;
            const containerRect = scheduleScrollContainer.getBoundingClientRect();
            const centerY = containerRect.top + containerRect.height / 3;
            let visibleMonth = null;
            for (let i = monthSections.length - 1; i >= 0; i--) {
                const rect = monthSections[i].getBoundingClientRect();
                if (rect.top <= centerY) {
                    visibleMonth = monthSections[i].getAttribute('data-schedule-month');
                    break;
                }
            }
            if (!visibleMonth) {
                visibleMonth = monthSections[0].getAttribute('data-schedule-month');
            }
            if (visibleMonth) {
                const [y, m] = visibleMonth.split('-');
                navMonth.textContent = `${y}年${parseInt(m)}月`;
            }
        });
        // 初始触发一次
        setTimeout(() => scheduleScrollContainer.dispatchEvent(new Event('scroll')), 100);
    }

    if (_scheduleAutoScroll) {
        _scheduleAutoScroll = false;
        setTimeout(() => {
            const todayCard = container.querySelector('.schedule-day-drop.ring-2');
            if (todayCard) {
                const scrollContainer = todayCard.closest('.schedule-container');
                if (scrollContainer) {
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const cardRect = todayCard.getBoundingClientRect();
                    scrollContainer.scrollTop += cardRect.top - containerRect.top - 20;
                }
            }
        }, 200);
    }
    // 非自动滚动时，滚动位置已在上方同步恢复，无需额外处理
}

function navigateScheduleMonth(direction) {
    scheduleMonthOffset += direction;
    _scheduleAutoScroll = true;
    renderScheduleView(document.getElementById('view-container'));
}

function resetScheduleView() {
    scheduleMonthOffset = 0;
    _scheduleAutoScroll = true;
    renderScheduleView(document.getElementById('view-container'));
}

let summaryViewMode = 'list';
let summaryTimeRange = 'week';
let summaryPriority = 'all';
let summaryList = 'all';
let summaryStatus = 'all';

// ==================== 最近7天筛选 ====================

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

// ==================== 侧边栏高亮 ====================

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
                if (weekStart.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
                const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
                if (!task.startTime || new Date(task.startTime) < weekStart || new Date(task.startTime) >= weekEnd) return false;
                break;
            case 'lastweek':
                const lastWeekStart = new Date(todayStart);
                lastWeekStart.setDate(lastWeekStart.getDate() - lastWeekStart.getDay() + dayOffset - 7);
                if (lastWeekStart.getDay() === 0 && dayOffset === 1) lastWeekStart.setDate(lastWeekStart.getDate() - 7);
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

function renderSummaryView(container) {
    // 重新渲染前停止旧的彗星动画
    stopSummaryCometAnimation();
    const timeRangeOptions = [
        { value: 'today', label: '今天' },
        { value: 'yesterday', label: '昨天' },
        { value: 'last3days', label: '最近三天' },
        { value: 'week', label: '本周' },
        { value: 'lastweek', label: '上周' },
        { value: 'month', label: '本月' },
        { value: 'lastmonth', label: '上月' }
    ];

    const priorityOptions = [
        { value: 'all', label: '所有优先级' },
        { value: 'urgent-important', label: '重要紧急' },
        { value: 'urgent-not-important', label: '紧急不重要' },
        { value: 'important-not-urgent', label: '重要不紧急' },
        { value: 'not-urgent-not-important', label: '不紧急不重要' }
    ];

    const statusOptions = [
        { value: 'all', label: '所有完成状态' },
        { value: 'completed', label: '已完成' },
        { value: 'uncompleted', label: '未完成' }
    ];

    const filteredTasks = filterTasksForSummary();
    const { title, dateRangeStr } = getSummaryHeaderInfo();
    const content = summaryViewMode === 'time'
        ? generateTimeBasedContent(filteredTasks)
        : generateListBasedContent(filteredTasks);

    // 左栏数据：今日完成率（始终今日，仅受清单筛选影响）
    const todayData = getTodayCompletionData();
    // 左栏数据：完成趋势（跟随时间范围，仅显示已过日期，仅受清单筛选影响）
    const trendData = getCompletionTrendData();

    // 保存右侧文本摘要区滚动位置，避免定时刷新时跳回顶部
    let _savedSummaryScrollTop = 0;
    const _prevSummaryScroll = container.querySelector('#summary-content-scroll');
    if (_prevSummaryScroll) _savedSummaryScrollTop = _prevSummaryScroll.scrollTop;

    container.innerHTML = `
        <div class="summary-container h-full flex flex-col">
            <div class="flex items-center justify-between p-4 pb-2">
                <div class="flex items-center gap-4 flex-wrap">
                    <select id="summary-time-range" class="px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary">
                        ${timeRangeOptions.map(opt => `<option value="${opt.value}" ${summaryTimeRange === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                    </select>
                    
                    <select id="summary-priority" class="px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary">
                        ${priorityOptions.map(opt => `<option value="${opt.value}" ${summaryPriority === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                    </select>
                    
                    <select id="summary-list" class="px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary">
                        <option value="all" ${summaryList === 'all' ? 'selected' : ''}>所有清单</option>
                        ${lists.filter(l => !l.archived).map(list => `<option value="${list.id}" ${summaryList === list.id ? 'selected' : ''}>${list.name}</option>`).join('')}
                    </select>
                    
                    <select id="summary-status" class="px-3 py-2 border border-theme rounded-lg bg-theme-secondary text-theme-primary">
                        ${statusOptions.map(opt => `<option value="${opt.value}" ${summaryStatus === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                    </select>
                </div>
                
                <div class="flex items-center gap-4">
                    <div class="flex bg-theme-tertiary rounded-lg p-1">
                        <button id="summary-view-time" class="px-4 py-1.5 rounded-md transition ${summaryViewMode === 'time' ? 'bg-blue-500 text-white summary-view-toggle-active' : 'text-theme-primary hover:text-theme-secondary'}">
                            按时间排布
                        </button>
                        <button id="summary-view-list" class="px-4 py-1.5 rounded-md transition ${summaryViewMode === 'list' ? 'bg-blue-500 text-white summary-view-toggle-active' : 'text-theme-primary hover:text-theme-secondary'}">
                            按清单排布
                        </button>
                    </div>
                </div>
            </div>

            <div class="flex-1 min-h-0 flex gap-4 px-4 pb-4">
                <!-- 左栏：数据洞察与可视化 (45%) -->
                <div class="flex flex-col gap-4" style="width: 45%; min-width: 0;">
                    <!-- 模块一：今日完成率 -->
                    <div class="bg-theme-secondary rounded-xl shadow-theme p-5 flex-shrink-0">
                        ${renderTodayCompletionCard(todayData)}
                    </div>
                    <!-- 模块二：完成趋势 -->
                    <div class="bg-theme-secondary rounded-xl shadow-theme p-5 flex-1 min-h-0 flex flex-col">
                        ${renderCompletionTrendCard(trendData)}
                    </div>
                </div>

                <!-- 右栏：文本摘要区 (55%) -->
                <div id="summary-content-scroll" class="bg-theme-secondary rounded-xl shadow-theme p-6 flex-1 min-h-0 overflow-y-auto">
                    <div class="flex items-center justify-between mb-4">
                        <div>
                            <h1 class="text-2xl font-bold text-theme-primary mb-1">${title}</h1>
                            <h2 class="text-theme-muted">${dateRangeStr}</h2>
                        </div>
                        <button id="summary-copy-btn" class="w-9 h-9 rounded-full border-2 border-blue-500 text-blue-500 flex items-center justify-center hover:bg-blue-500 hover:text-white transition" title="复制文本">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>

                    <div id="summary-content" class="max-w-none text-sm">
                        ${content}
                    </div>
                </div>
            </div>
        </div>
    `;

    // 同步恢复滚动位置，避免刷新时跳回顶部（无感知刷新）
    const _newSummaryScroll = container.querySelector('#summary-content-scroll');
    if (_newSummaryScroll && _savedSummaryScrollTop > 0) {
        _newSummaryScroll.scrollTop = _savedSummaryScrollTop;
    }

    setTimeout(() => {
        document.getElementById('summary-time-range').addEventListener('change', handleSummaryFilterChange);
        document.getElementById('summary-priority').addEventListener('change', handleSummaryFilterChange);
        document.getElementById('summary-list').addEventListener('change', handleSummaryFilterChange);
        document.getElementById('summary-status').addEventListener('change', handleSummaryFilterChange);
        document.getElementById('summary-view-time').addEventListener('click', () => {
            summaryViewMode = 'time';
            renderSummaryView(container);
        });
        document.getElementById('summary-view-list').addEventListener('click', () => {
            summaryViewMode = 'list';
            renderSummaryView(container);
        });
        document.getElementById('summary-copy-btn').addEventListener('click', copySummaryText);
        // 今日完成圆环启动动画
        animateSummaryRingStart();
        // 彗星拖尾动画：等待圆环填充完成后启动
        setTimeout(() => animateSummaryComet(), 1000);
    }, 50);
}

// ==================== 摘要左栏：今日完成率 ====================

// 今日完成率数据口径：
// 今日总任务 = 今天新创建且已完成的任务 + 截止日期是今天的任务（无论是否完成） + 从过去延期到今天的未完成任务
// 排除未来日期的任务，以及没有设置日期且不在今天执行的任务
// 仅受清单筛选影响，不受优先级/状态/时间范围筛选影响
function getTodayCompletionData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTasks = tasks.filter(task => {
        // 清单筛选
        if (summaryList !== 'all' && task.listId !== summaryList) return false;
        // 排除已归档清单
        const taskList = lists.find(l => l.id === task.listId);
        if (taskList && taskList.archived) return false;

        // 今天新创建且已完成
        if (task.createdAt) {
            const created = new Date(task.createdAt);
            created.setHours(0, 0, 0, 0);
            if (created.getTime() === today.getTime() && task.completed) return true;
        }

        // 截止日期是今天（无论是否完成）
        if (task.startTime) {
            const start = new Date(task.startTime);
            start.setHours(0, 0, 0, 0);
            if (start.getTime() === today.getTime()) return true;
            // 从过去延期到今天的未完成任务
            if (start.getTime() < today.getTime() && !task.completed) return true;
        }

        return false;
    });

    const completed = todayTasks.filter(t => t.completed).length;
    const total = todayTasks.length;
    const remaining = total - completed;
    const importantCompleted = todayTasks.filter(t => t.completed && t.important).length;

    // 今日专注番茄数（复用 pomodoroHistory）
    const todayKey = today.getTime();
    const todayPomodoros = (typeof pomodoroHistory !== 'undefined' ? pomodoroHistory : []).filter(p => {
        const pDate = new Date(p.date);
        pDate.setHours(0, 0, 0, 0);
        return pDate.getTime() === todayKey;
    }).length;

    return { completed, total, remaining, importantCompleted, pomodoros: todayPomodoros };
}

function renderTodayCompletionCard(data) {
    const percent = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
    const isAllClear = data.total > 0 && data.completed === data.total;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    // 基础参数
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - percent / 100);
    // 启动动画：圆环从 0% 填充到实际进度，百分比数字从 0% 递增到实际值
    const startOffset = circumference; // 0% 时的 dashoffset

    // 颜色设定
    const baseColor = isAllClear ? '#fbbf24' : (isDark ? '#60a5fa' : '#3b82f6');
    const brightColor = isAllClear ? '#fef3c7' : '#bfdbfe';

    // 彗星几何参数（JS rAF 驱动，长度动态变化）：
    // dasharray = "L C"，图案总长 PL = L + C
    // dashoffset = 2*L + C - H 时，彗星头部在圆位 H，尾部在 H-L
    const progressLength = (circumference * percent) / 100;
    // 彗星峰值长度：进度很短时收缩，避免越过进度末端落到灰色轨道上
    let maxCometLength = circumference * 0.15;
    if (progressLength > 0 && progressLength < maxCometLength) {
        maxCometLength = Math.max(progressLength, 6);
    }
    // 最短长度（周期起止时的长度）
    const minCometLength = Math.max(maxCometLength * 0.25, 4);

    let html = `
        <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-semibold text-theme-primary flex items-center gap-2">
                <span>🎯</span> 今日完成率
            </h3>
            ${data.importantCompleted > 0 ? `<span class="text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 flex items-center gap-1"><i class="fas fa-bolt text-xs"></i> 高优攻坚 ${data.importantCompleted}</span>` : ''}
        </div>
    `;

    if (data.total === 0) {
        html += `
            <div class="flex items-center gap-5">
                <div class="relative flex-shrink-0">
                    <svg viewBox="0 0 120 120" class="w-28 h-28">
                        <circle cx="60" cy="60" r="${radius}" fill="none" stroke="var(--bg-tertiary)" stroke-width="8"/>
                        <text x="60" y="60" text-anchor="middle" dy=".3em" font-size="22" font-weight="bold" fill="var(--text-muted)">0%</text>
                    </svg>
                </div>
                <div class="flex-1 space-y-2">
                    <div class="flex items-baseline justify-between">
                        <span class="text-sm text-theme-secondary">已完成</span>
                        <span class="text-lg font-semibold text-theme-muted">0 <span class="text-sm text-theme-muted">/ 0</span></span>
                    </div>
                    <div class="flex items-baseline justify-between">
                        <span class="text-sm text-theme-secondary">剩余待办</span>
                        <span class="text-lg font-semibold text-theme-muted">0</span>
                    </div>
                    <div class="flex items-baseline justify-between">
                        <span class="text-sm text-theme-secondary">今日专注</span>
                        <span onclick="openPomodoroStats()" class="text-lg font-semibold text-theme-primary cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 transition" title="查看番茄专注统计">${data.pomodoros} <span class="text-sm text-theme-muted">番茄钟</span></span>
                    </div>
                </div>
            </div>
        `;
    } else {
        // 100% 时不显示彗星脉冲，改用整环呼吸发光；进度>0且非100%时显示彗星
        const showComet = !isAllClear && percent > 0;
        html += `
            <div class="flex items-center gap-5">
                <div class="relative flex-shrink-0">
                    <svg viewBox="0 0 120 120" class="w-28 h-28 ${isAllClear ? 'ring-complete-glow' : ''}">
                        <defs>
                            <filter id="pulse-glow" x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur stdDeviation="2.5" result="blur"/>
                                <feComposite in="SourceGraphic" in2="blur" operator="over"/>
                            </filter>
                        </defs>
                        <circle cx="60" cy="60" r="${radius}" fill="none" stroke="var(--bg-tertiary)" stroke-width="8" transform="rotate(-90 60 60)"/>
                        <circle id="summary-progress-ring" cx="60" cy="60" r="${radius}" fill="none" stroke="${baseColor}" stroke-width="8"
                            stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${startOffset.toFixed(2)}"
                            stroke-linecap="round" transform="rotate(-90 60 60)"
                            data-target-offset="${dashOffset.toFixed(2)}"
                            data-target-percent="${percent}"
                            style="transition: stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)"/>
                        ${showComet ? `<circle id="summary-comet" class="pulse-comet" cx="60" cy="60" r="${radius}" fill="none" stroke="${brightColor}" stroke-width="6"
                            stroke-dasharray="${minCometLength.toFixed(2)} ${circumference.toFixed(2)}" stroke-linecap="round" filter="url(#pulse-glow)"
                            transform="rotate(-90 60 60)"
                            data-circumference="${circumference.toFixed(2)}"
                            data-progress-length="${progressLength.toFixed(2)}"
                            data-min-length="${minCometLength.toFixed(2)}"
                            data-max-length="${maxCometLength.toFixed(2)}"
                            style="opacity: 0;"/>` : ''}
                        <text id="summary-ring-percent" x="60" y="60" text-anchor="middle" dy=".3em" font-size="24" font-weight="bold" fill="${isAllClear ? '#fbbf24' : 'var(--text-primary)'}">0%</text>
                    </svg>
                </div>
                <div class="flex-1 space-y-2">
                    <div class="flex items-baseline justify-between">
                        <span class="text-sm text-theme-secondary">已完成</span>
                        <span class="text-lg font-semibold text-theme-primary">${data.completed} <span class="text-sm text-theme-muted">/ ${data.total}</span></span>
                    </div>
                    <div class="flex items-baseline justify-between">
                        <span class="text-sm text-theme-secondary">剩余待办</span>
                        <span class="text-lg font-semibold ${data.remaining > 0 ? 'text-theme-primary' : 'text-theme-muted'}">${data.remaining}</span>
                    </div>
                    <div class="flex items-baseline justify-between">
                        <span class="text-sm text-theme-secondary">今日专注</span>
                        <span onclick="openPomodoroStats()" class="text-lg font-semibold text-theme-primary cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 transition" title="查看番茄专注统计">${data.pomodoros} <span class="text-sm text-theme-muted">番茄钟</span></span>
                    </div>
                </div>
            </div>
        `;
    }

    return html;
}

/**
 * 今日完成圆环启动动画
 * 圆环从 0% 填充到实际进度，百分比数字从 0% 递增到实际值，持续 1 秒
 * 每次打开摘要界面都会触发
 */
function animateSummaryRingStart() {
    const ring = document.getElementById('summary-progress-ring');
    const textEl = document.getElementById('summary-ring-percent');
    if (!ring || !textEl) return;

    const targetOffset = parseFloat(ring.getAttribute('data-target-offset'));
    const targetPercent = parseInt(ring.getAttribute('data-target-percent'), 10);

    // 强制重绘，确保初始 0% 状态已渲染
    void ring.getBoundingClientRect();

    // 启动圆环填充动画（CSS transition 处理）
    ring.style.strokeDashoffset = targetOffset;

    // 数字递增动画
    const duration = 1000; // 1秒
    const startTime = performance.now();
    function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out 缓动，与圆环过渡节奏一致
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(targetPercent * eased);
        textEl.textContent = current + '%';
        if (progress < 1) requestAnimationFrame(tick);
        else textEl.textContent = targetPercent + '%';
    }
    requestAnimationFrame(tick);
}

/**
 * 彗星拖尾动态长度动画（JS rAF 驱动）
 * 每一轮彗星长度从短→长→短（正弦曲线），头部沿进度弧滑动
 * 周期起止时透明度降为0，避免回跳闪烁
 */
let _summaryCometRafId = null;

function animateSummaryComet() {
    const comet = document.getElementById('summary-comet');
    if (!comet) return;

    const C = parseFloat(comet.getAttribute('data-circumference'));
    const progressLength = parseFloat(comet.getAttribute('data-progress-length'));
    const minL = parseFloat(comet.getAttribute('data-min-length'));
    const maxL = parseFloat(comet.getAttribute('data-max-length'));

    if (!C || !progressLength || progressLength <= 0) return;

    const cycleDuration = 3500; // 每轮 3.5 秒
    const startTime = performance.now();

    function tick(now) {
        const elapsed = (now - startTime) % cycleDuration;
        const p = elapsed / cycleDuration; // 0 → 1

        // 彗星长度：正弦曲线 短→长→短
        const sinVal = Math.sin(p * Math.PI);
        const L = minL + (maxL - minL) * sinVal;
        // 彗星头部位置：沿进度弧从 0 滑到 progressLength
        const H = p * progressLength;
        // dashoffset = 2L + C - H → 彗星头部在圆位 H
        const dashoffset = 2 * L + C - H;
        // 透明度：周期起止为0，中间为1，避免回跳闪烁
        const opacity = Math.min(1, sinVal * 1.5);

        comet.setAttribute('stroke-dasharray', `${L.toFixed(2)} ${C.toFixed(2)}`);
        comet.style.strokeDashoffset = dashoffset.toFixed(2);
        comet.style.opacity = opacity.toFixed(3);

        _summaryCometRafId = requestAnimationFrame(tick);
    }
    _summaryCometRafId = requestAnimationFrame(tick);
}

function stopSummaryCometAnimation() {
    if (_summaryCometRafId) {
        cancelAnimationFrame(_summaryCometRafId);
        _summaryCometRafId = null;
    }
}

// ==================== 摘要左栏：完成趋势 ====================

// 完成趋势数据口径：
// 严格跟随顶部时间范围筛选，仅显示已过日期（包括今天）
// 柱状：每天实际完成任务数（按 completedAt 统计）
// 折线：每天新创建任务数（按 createdAt 统计）
// 仅受清单筛选影响，不受优先级/状态筛选影响
function getCompletionTrendData() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const today = new Date(now);

    let dates = [];
    let labels = [];

    switch (summaryTimeRange) {
        case 'today':
            dates = [new Date(today)];
            labels = ['今天'];
            break;
        case 'yesterday': {
            const d = new Date(today);
            d.setDate(d.getDate() - 1);
            dates = [d];
            labels = ['昨天'];
            break;
        }
        case 'last3days':
            for (let i = 2; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                dates.push(d);
                labels.push((d.getMonth() + 1) + '/' + d.getDate());
            }
            break;
        case 'week':
        case 'lastweek': {
            const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
            let weekStart = new Date(today);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
            if (weekStart.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
            if (summaryTimeRange === 'lastweek') weekStart.setDate(weekStart.getDate() - 7);
            const dayNames = settings.weekStart === 'monday'
                ? ['一', '二', '三', '四', '五', '六', '日']
                : ['日', '一', '二', '三', '四', '五', '六'];
            for (let i = 0; i < 7; i++) {
                const d = new Date(weekStart);
                d.setDate(d.getDate() + i);
                // 仅显示已过日期（包括今天）；上周全部显示
                if (summaryTimeRange === 'lastweek' || d <= today) {
                    dates.push(d);
                    labels.push(dayNames[i]);
                }
            }
            break;
        }
        case 'month':
        case 'lastmonth': {
            const refDate = summaryTimeRange === 'lastmonth'
                ? new Date(today.getFullYear(), today.getMonth() - 1, 1)
                : new Date(today.getFullYear(), today.getMonth(), 1);
            const daysInMonth = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0).getDate();
            for (let i = 1; i <= daysInMonth; i++) {
                const d = new Date(refDate.getFullYear(), refDate.getMonth(), i);
                // 上月全部显示；本月仅显示到今天
                if (summaryTimeRange === 'lastmonth' || d <= today) {
                    dates.push(d);
                    labels.push(i + '');
                }
            }
            break;
        }
    }

    // 统计每天完成数和创建数
    const dailyData = dates.map(date => {
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        let completedCount = 0;
        let createdCount = 0;

        tasks.forEach(task => {
            // 清单筛选
            if (summaryList !== 'all' && task.listId !== summaryList) return;
            // 排除已归档清单
            const taskList = lists.find(l => l.id === task.listId);
            if (taskList && taskList.archived) return;

            // 完成数（按 completedAt）
            if (task.completed && task.completedAt) {
                const completedDate = new Date(task.completedAt);
                if (completedDate >= dayStart && completedDate < dayEnd) {
                    completedCount++;
                }
            }

            // 创建数（按 createdAt）
            if (task.createdAt) {
                const createdDate = new Date(task.createdAt);
                if (createdDate >= dayStart && createdDate < dayEnd) {
                    createdCount++;
                }
            }
        });

        return { completedCount, createdCount };
    });

    return { dates, labels, dailyData };
}

function renderCompletionTrendCard(trendData) {
    const { dates, labels, dailyData } = trendData;

    let html = `
        <div class="flex items-center justify-between mb-3">
            <h3 class="text-base font-semibold text-theme-primary flex items-center gap-2">
                <span>📊</span> 完成趋势
            </h3>
            <div class="flex items-center gap-3 text-xs text-theme-secondary">
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm" style="background: var(--accent-color)"></span>已完成</span>
                <span class="flex items-center gap-1"><span class="inline-block w-4 h-0.5" style="background: #f59e0b"></span><span class="inline-block w-1.5 h-1.5 rounded-full" style="background: #f59e0b"></span>新建</span>
            </div>
        </div>
    `;

    if (dates.length === 0 || dailyData.every(d => d.completedCount === 0 && d.createdCount === 0)) {
        html += '<div class="flex-1 flex items-center justify-center text-theme-muted text-sm">暂无数据</div>';
        return html;
    }

    const maxCount = Math.max(...dailyData.map(d => Math.max(d.completedCount, d.createdCount)), 0);
    const displayMax = Math.max(maxCount, 3); // 至少显示3格刻度

    // SVG 尺寸
    const chartWidth = Math.max(dates.length * 50 + 50, 320);
    const chartHeight = 200;
    const padding = { top: 20, right: 15, bottom: 28, left: 32 };
    const innerWidth = chartWidth - padding.left - padding.right;
    const innerHeight = chartHeight - padding.top - padding.bottom;
    const colWidth = innerWidth / dates.length;
    const barWidth = Math.min(22, colWidth * 0.45);

    let svgContent = '';

    // Y 轴网格线（0, 中间, 最大值）
    for (let i = 0; i <= 2; i++) {
        const y = padding.top + innerHeight * (1 - i / 2);
        const value = Math.round(displayMax * i / 2);
        svgContent += `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(chartWidth - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border-color)" stroke-width="0.5" stroke-dasharray="2,2"/>`;
        svgContent += `<text x="${padding.left - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-muted)">${value}</text>`;
    }

    // 柱状（已完成）和折线（新建）
    const linePoints = [];
    dailyData.forEach((d, i) => {
        const x = padding.left + colWidth * (i + 0.5);

        // 柱状：已完成
        const barH = displayMax > 0 ? (d.completedCount / displayMax) * innerHeight : 0;
        const barY = padding.top + innerHeight - barH;
        if (d.completedCount > 0) {
            svgContent += `<rect x="${(x - barWidth / 2).toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" rx="3" fill="var(--accent-color)" opacity="0.85"/>`;
            svgContent += `<text x="${x.toFixed(1)}" y="${(barY - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--text-secondary)" font-weight="600">${d.completedCount}</text>`;
        }

        // 折线点：新建
        const lineY = padding.top + innerHeight - (displayMax > 0 ? (d.createdCount / displayMax) * innerHeight : 0);
        linePoints.push({ x, y: lineY, value: d.createdCount });
    });

    // 折线连接
    if (linePoints.length > 1) {
        const polylinePoints = linePoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        svgContent += `<polyline points="${polylinePoints}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
    }

    // 折线点圆圈和数值
    linePoints.forEach(p => {
        svgContent += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#f59e0b" stroke="var(--bg-secondary)" stroke-width="1.5"/>`;
        if (p.value > 0) {
            svgContent += `<text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="#f59e0b" font-weight="600">${p.value}</text>`;
        }
    });

    // X 轴标签
    labels.forEach((label, i) => {
        const x = padding.left + colWidth * (i + 0.5);
        svgContent += `<text x="${x.toFixed(1)}" y="${(chartHeight - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${label}</text>`;
    });

    html += `
        <div class="flex-1 min-h-0 overflow-hidden">
            <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="w-full h-full" preserveAspectRatio="xMidYMid meet">
                ${svgContent}
            </svg>
        </div>
    `;

    return html;
}

function handleSummaryFilterChange() {
    summaryTimeRange = document.getElementById('summary-time-range').value;
    summaryPriority = document.getElementById('summary-priority').value;
    summaryList = document.getElementById('summary-list').value;
    summaryStatus = document.getElementById('summary-status').value;
    renderSummaryView(document.getElementById('view-container'));
}

function getSummaryHeaderInfo() {
    const now = new Date();
    let title = '';
    let startDate = null;
    let endDate = null;

    switch (summaryTimeRange) {
        case 'today':
            title = '今天';
            startDate = now;
            endDate = now;
            break;
        case 'yesterday':
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            title = '昨天';
            startDate = yesterday;
            endDate = yesterday;
            break;
        case 'last3days':
            title = '最近三天';
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 2);
            endDate = now;
            break;
        case 'week':
            title = '本周';
            const weekStart = new Date(now);
            const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
            weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
            if (weekStart.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
            startDate = weekStart;
            endDate = new Date(weekStart);
            endDate.setDate(endDate.getDate() + 6);
            break;
        case 'lastweek':
            title = '上周';
            const lastWeekStart = new Date(now);
            lastWeekStart.setDate(lastWeekStart.getDate() - lastWeekStart.getDay() + (settings.weekStart === 'monday' ? 1 : 0) - 7);
            if (lastWeekStart.getDay() === 0 && settings.weekStart === 'monday') lastWeekStart.setDate(lastWeekStart.getDate() - 7);
            startDate = lastWeekStart;
            endDate = new Date(lastWeekStart);
            endDate.setDate(endDate.getDate() + 6);
            break;
        case 'month':
            title = '本月';
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            break;
        case 'lastmonth':
            title = '上月';
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), 0);
            break;
    }

    const formatDateRange = (date) => `${(date.getMonth() + 1)}月${date.getDate()}日`;
    const dateRangeStr = startDate && endDate 
        ? (startDate.getTime() === endDate.getTime() ? formatDateRange(startDate) : `${formatDateRange(startDate)} - ${formatDateRange(endDate)}`)
        : '';

    return { title, dateRangeStr };
}

function filterTasksForSummary() {
    const now = new Date();
    let startDate = null;
    let endDate = null;

    switch (summaryTimeRange) {
        case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            break;
        case 'yesterday':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        case 'last3days':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            break;
        case 'week':
            const weekStart = new Date(now);
            const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
            weekStart.setDate(weekStart.getDate() - weekStart.getDay() + dayOffset);
            if (weekStart.getDay() === 0 && dayOffset === 1) weekStart.setDate(weekStart.getDate() - 7);
            startDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
            endDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
            break;
        case 'lastweek':
            const lastWeekStart = new Date(now);
            lastWeekStart.setDate(lastWeekStart.getDate() - lastWeekStart.getDay() + (settings.weekStart === 'monday' ? 1 : 0) - 7);
            if (lastWeekStart.getDay() === 0 && settings.weekStart === 'monday') lastWeekStart.setDate(lastWeekStart.getDate() - 7);
            startDate = new Date(lastWeekStart.getFullYear(), lastWeekStart.getMonth(), lastWeekStart.getDate());
            endDate = new Date(lastWeekStart.getFullYear(), lastWeekStart.getMonth(), lastWeekStart.getDate() + 7);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            break;
        case 'lastmonth':
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
    }

    return tasks.filter(task => {
        // 过滤已归档清单的任务
        const taskList = lists.find(l => l.id === task.listId);
        if (taskList && taskList.archived) return false;

        if (summaryStatus === 'completed' && !task.completed) return false;
        if (summaryStatus === 'uncompleted' && task.completed) return false;

        if (summaryPriority !== 'all') {
            const taskPriority = getTaskPriority(task);
            if (taskPriority !== summaryPriority) return false;
        }

        if (summaryList !== 'all' && task.listId !== summaryList) return false;

        if (!startDate || !endDate) return true;

        const taskDate = getTaskDate(task);
        return taskDate >= startDate && taskDate < endDate;
    });
}

function getTaskPriority(task) {
    const important = task.important;
    const urgent = task.urgent;
    if (important && urgent) return 'urgent-important';
    if (urgent && !important) return 'urgent-not-important';
    if (important && !urgent) return 'important-not-urgent';
    return 'not-urgent-not-important';
}

function getTaskDate(task) {
    if (task.completedAt) {
        return new Date(task.completedAt);
    }
    if (task.startTime) {
        return new Date(task.startTime);
    }
    return new Date(task.createdAt);
}

function generateTimeBasedContent(filteredTasks) {
    if (filteredTasks.length === 0) {
        return '<p class="text-theme-muted text-center py-8">暂无符合条件的摘要内容，请调整筛选条件。</p>';
    }

    const completedTasks = filteredTasks.filter(t => t.completed);
    const uncompletedTasks = filteredTasks.filter(t => !t.completed);

    let html = '';

    if (summaryStatus !== 'uncompleted' && completedTasks.length > 0) {
        html += '<div class="mb-4"><div class="font-bold text-theme-primary mb-2">已完成</div>';
        html += formatTaskListHtml(completedTasks);
        html += '</div>';
    }

    if (summaryStatus !== 'completed' && uncompletedTasks.length > 0) {
        if (html) html += '<div class="mb-6"></div>';
        html += '<div class="mb-4"><div class="font-bold text-theme-primary mb-2">未完成</div>';
        html += formatTaskListHtml(uncompletedTasks);
        html += '</div>';
    }

    return html;
}

function generateListBasedContent(filteredTasks) {
    if (filteredTasks.length === 0) {
        return '<p class="text-theme-muted text-center py-8">暂无符合条件的摘要内容，请调整筛选条件。</p>';
    }

    const listGroups = {};
    const allLists = [...lists].filter(l => !l.archived);
    if (summaryList === 'all') {
        allLists.forEach(list => {
            listGroups[list.id] = { name: list.name, tasks: [] };
        });
    } else {
        const selectedList = lists.find(l => l.id === summaryList);
        if (selectedList) {
            listGroups[summaryList] = { name: selectedList.name, tasks: [] };
        }
    }

    filteredTasks.forEach(task => {
        if (listGroups[task.listId]) {
            listGroups[task.listId].tasks.push(task);
        }
    });

    const sortedListIds = Object.keys(listGroups).sort((a, b) => {
        const listA = lists.find(l => l.id === a);
        const listB = lists.find(l => l.id === b);
        return (listA?.name || '').localeCompare(listB?.name || '');
    });

    let html = '';
    let first = true;
    sortedListIds.forEach(listId => {
        const group = listGroups[listId];
        if (group.tasks.length === 0) return;

        if (!first) html += '<div class="mb-6"></div>';
        first = false;

        html += '<div class="mb-4"><div class="font-bold text-theme-primary mb-2">' + group.name + '</div>';
        html += formatTaskListHtml(group.tasks);
        html += '</div>';
    });

    return html;
}

function formatTaskListHtml(taskList) {
    const sorted = [...taskList].sort((a, b) => {
        return getTaskDate(b) - getTaskDate(a);
    });

    let html = '';
    sorted.forEach((task, idx) => {
        const date = getTaskDate(task);
        const displayDate = (date.getMonth() + 1) + '月' + date.getDate() + '日';
        html += '<div class="flex items-baseline gap-2 py-0.5 text-theme-primary">' +
            '<span class="text-theme-muted flex-shrink-0">' + (idx + 1) + '.</span>' +
            '<span class="text-theme-secondary flex-shrink-0">[' + displayDate + ']</span>' +
            '<span>' + (task.title || '未命名任务') + '</span>' +
            '</div>';
    });
    return html;
}

function copySummaryText() {
    const filteredTasks = filterTasksForSummary();
    let text = '';

    if (summaryViewMode === 'time') {
        const completedTasks = filteredTasks.filter(t => t.completed);
        const uncompletedTasks = filteredTasks.filter(t => !t.completed);

        if (summaryStatus !== 'uncompleted' && completedTasks.length > 0) {
            text += '已完成\n';
            completedTasks.sort((a, b) => getTaskDate(b) - getTaskDate(a)).forEach((task, idx) => {
                const date = getTaskDate(task);
                const displayDate = (date.getMonth() + 1) + '月' + date.getDate() + '日';
                text += (idx + 1) + '. [' + displayDate + '] ' + (task.title || '未命名任务') + '\n';
            });
        }

        if (summaryStatus !== 'completed' && uncompletedTasks.length > 0) {
            if (text) text += '\n';
            text += '未完成\n';
            uncompletedTasks.sort((a, b) => getTaskDate(b) - getTaskDate(a)).forEach((task, idx) => {
                const date = getTaskDate(task);
                const displayDate = (date.getMonth() + 1) + '月' + date.getDate() + '日';
                text += (idx + 1) + '. [' + displayDate + '] ' + (task.title || '未命名任务') + '\n';
            });
        }
    } else {
        const listGroups = {};
        const allLists = [...lists].filter(l => !l.archived);
        if (summaryList === 'all') {
            allLists.forEach(list => {
                listGroups[list.id] = { name: list.name, tasks: [] };
            });
        } else {
            const selectedList = lists.find(l => l.id === summaryList);
            if (selectedList) {
                listGroups[summaryList] = { name: selectedList.name, tasks: [] };
            }
        }
        filteredTasks.forEach(task => {
            if (listGroups[task.listId]) {
                listGroups[task.listId].tasks.push(task);
            }
        });
        const sortedListIds = Object.keys(listGroups).sort((a, b) => {
            const listA = lists.find(l => l.id === a);
            const listB = lists.find(l => l.id === b);
            return (listA?.name || '').localeCompare(listB?.name || '');
        });
        let first = true;
        sortedListIds.forEach(listId => {
            const group = listGroups[listId];
            if (group.tasks.length === 0) return;
            if (!first) text += '\n';
            first = false;
            text += group.name + '\n';
            group.tasks.sort((a, b) => getTaskDate(b) - getTaskDate(a)).forEach((task, idx) => {
                const date = getTaskDate(task);
                const displayDate = (date.getMonth() + 1) + '月' + date.getDate() + '日';
                text += (idx + 1) + '. [' + displayDate + '] ' + (task.title || '未命名任务') + '\n';
            });
        });
    }

    navigator.clipboard.writeText(text.trim()).then(() => {
        showToast('已复制', 'success');
    }).catch(() => {
        showToast('复制失败', 'error');
    });
}
