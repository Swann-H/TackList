let deleteConfirmTaskId = null;
function confirmDeleteTask(taskId) {
    const taskElements = document.querySelectorAll(`[data-task-id="${taskId}"]`);
    taskElements.forEach(el => {
        const deleteBtn = el.querySelector('.fa-trash').parentElement;
        if (deleteBtn && !deleteBtn.classList.contains('delete-confirm-btn')) {
            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'delete-confirm-btn px-3 py-1 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600';
            confirmBtn.textContent = '确认删除';
            confirmBtn.onclick = (e) => {
                e.stopPropagation();
                deleteTask(taskId);
            };
            deleteBtn.parentNode.replaceChild(confirmBtn, deleteBtn);
            
            setTimeout(() => {
                const newDeleteBtn = document.createElement('button');
                newDeleteBtn.className = 'p-1 text-theme-muted hover:text-red-500 transition';
                newDeleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                newDeleteBtn.onclick = () => confirmDeleteTask(taskId);
                confirmBtn.parentNode.replaceChild(newDeleteBtn, confirmBtn);
            }, 3000);
        }
    });
}

let deleteConfirmListId = null;
let listDeleteConfirmListId = null;

function confirmDeleteList(listId) {
    if (listId === 'default') {
        showToast('默认清单不能删除', 'warning');
        return;
    }
    
    if (listDeleteConfirmListId === listId) {
        tasks = tasks.map(t => {
            if (t.listId === listId) {
                t.listId = 'default';
            }
            return t;
        });
        lists = lists.filter(l => l.id !== listId);
        if (currentListId === listId) {
            currentListId = null;
        }
        saveData();
        renderLists();
        if (typeof renderTags === 'function') renderTags();
        renderView();
        showToast('清单已删除', 'success');
        listDeleteConfirmListId = null;
        return;
    }
    
    listDeleteConfirmListId = listId;

    setTimeout(() => {
        listDeleteConfirmListId = null;
    }, 3000);
}

let draggedTaskId = null;
let dragTargetType = null;

function handleTaskDragStart(e, taskId) {
    draggedTaskId = taskId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    e.target.classList.add('dragging');
}

function handleTaskDragOver(e) {
    e.preventDefault();
    e.target.closest('.task-item, .calendar-day, .quadrant-card, .drop-zone')?.classList.add('drag-over');
}

function handleTaskDragEnd(e) {
    document.querySelectorAll('.dragging, .drag-over').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
    draggedTaskId = null;
}

function handleTaskDrop(e, targetId, targetQuadrant = null) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedTaskId || draggedTaskId === targetId) return;
    
    const task = tasks.find(t => t.id === draggedTaskId);
    if (!task) return;
    
    // 判断目标类型
    if (currentView === 'month') {
        // 月视图拖拽 - 改变日期
        const targetDate = e.target.closest('.calendar-day')?.dataset.date;
        if (targetDate) {
            const oldDate = task.startTime ? new Date(task.startTime) : new Date(task.createdAt);
            const time = `${oldDate.getHours().toString().padStart(2, '0')}:${oldDate.getMinutes().toString().padStart(2, '0')}`;
            task.startTime = new Date(`${targetDate}T${time}`).toISOString();
            if (task.endTime) {
                const oldEnd = new Date(task.endTime);
                const daysDiff = Math.floor((new Date(task.startTime) - oldDate) / (1000 * 60 * 60 * 24));
                const newEnd = new Date(oldEnd);
                newEnd.setDate(newEnd.getDate() + daysDiff);
                task.endTime = newEnd.toISOString();
            }
            saveData();
            renderView();
            showToast('任务时间已更新', 'success');
        }
    } else if (currentView === 'quadrant' && targetQuadrant) {
        task.important = targetQuadrant.includes('important') && !targetQuadrant.includes('not-important');
        task.urgent = targetQuadrant.includes('urgent') && !targetQuadrant.includes('not-urgent');
        saveData();
        renderView();
        if (planPanelOpen) renderPlanPanel();
    }
    
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function initTaskDragDrop() {
    // 已经在HTML属性中处理
}

function handleWeekDragOver(event) {
    event.preventDefault();
}
function handleWeekTimeDrop(event, dateStr) {
    event.preventDefault();
    if (!draggedTaskId) return;
    
    const task = tasks.find(t => t.id === draggedTaskId);
    if (!task) return;
    
    const grid = event.currentTarget;
    const rect = grid.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const hour = weekViewHourStart + Math.floor(y / 60);
    const minute = Math.round((y % 60) / 15) * 15;
    
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    task.startTime = new Date(`${dateStr}T${timeStr}`).toISOString();
    task.isAllDay = false;
    
    if (task.endTime) {
        const duration = getTaskDurationMinutes(task);
        const newEnd = new Date(task.startTime);
        newEnd.setMinutes(newEnd.getMinutes() + duration);
        task.endTime = newEnd.toISOString();
    }
    
    saveData();
    renderView();
    if (planPanelOpen) renderPlanPanel();
}
function handleWeekAllDayDrop(event, dateStr) {
    event.preventDefault();
    event.stopPropagation();
    if (!draggedTaskId) return;
    
    const task = tasks.find(t => t.id === draggedTaskId);
    if (!task) return;
    
    const oldDate = task.startTime ? new Date(task.startTime) : null;
    
    task.startTime = new Date(dateStr + 'T00:00:00').toISOString();
    task.isAllDay = true;
    
    if (task.endTime && oldDate) {
        const daysDiff = Math.floor((new Date(task.startTime) - oldDate) / (1000 * 60 * 60 * 24));
        if (daysDiff !== 0) {
            const oldEnd = new Date(task.endTime);
            const newEnd = new Date(oldEnd);
            newEnd.setDate(newEnd.getDate() + daysDiff);
            task.endTime = newEnd.toISOString();
        }
    } else {
        delete task.endTime;
    }
    
    saveData();
    renderView();
    if (planPanelOpen) renderPlanPanel();
    handleTaskDragEnd(event);
}
function handleWeekDrop(e, dateStr) {
    e.preventDefault();
    if (!draggedTaskId) return;
    
    const task = tasks.find(t => t.id === draggedTaskId);
    if (!task) return;
    
    const wasNoDate = !task.startTime;
    const oldDate = task.startTime ? new Date(task.startTime) : new Date(task.createdAt);
    const time = (!wasNoDate && !task.isAllDay) ? `${oldDate.getHours().toString().padStart(2, '0')}:${oldDate.getMinutes().toString().padStart(2, '0')}` : '';
    
    if (time) {
        task.startTime = new Date(`${dateStr}T${time}`).toISOString();
    } else {
        task.startTime = new Date(dateStr + 'T00:00:00').toISOString();
        task.isAllDay = true;
    }
    
    if (wasNoDate) {
        delete task.endTime;
    } else if (task.endTime && !task.isAllDay) {
        const oldEnd = new Date(task.endTime);
        const daysDiff = Math.floor((new Date(task.startTime) - oldDate) / (1000 * 60 * 60 * 24));
        const newEnd = new Date(oldEnd);
        newEnd.setDate(newEnd.getDate() + daysDiff);
        task.endTime = newEnd.toISOString();
    }
    
    saveData();
    renderView();
    if (planPanelOpen) renderPlanPanel();
}

function handleMonthDrop(e, dateStr) {
    e.preventDefault();
    if (!draggedTaskId) return;
    
    const task = tasks.find(t => t.id === draggedTaskId);
    if (!task) return;
    
    const wasNoDate = !task.startTime;
    const oldDate = task.startTime ? new Date(task.startTime) : new Date(task.createdAt);
    if (wasNoDate) {
        task.startTime = new Date(dateStr + 'T00:00:00').toISOString();
        task.isAllDay = true;
        delete task.endTime;
    } else if (task.isAllDay) {
        task.startTime = new Date(dateStr + 'T00:00:00').toISOString();
    } else {
        const time = `${oldDate.getHours().toString().padStart(2, '0')}:${oldDate.getMinutes().toString().padStart(2, '0')}`;
        task.startTime = new Date(`${dateStr}T${time}`).toISOString();
    }
    
    if (task.endTime && !task.isAllDay && !wasNoDate) {
        const oldEnd = new Date(task.endTime);
        const daysDiff = Math.floor((new Date(task.startTime) - oldDate) / (1000 * 60 * 60 * 24));
        const newEnd = new Date(oldEnd);
        newEnd.setDate(newEnd.getDate() + daysDiff);
        task.endTime = newEnd.toISOString();
    }
    
    saveData();
    renderView();
    if (planPanelOpen) renderPlanPanel();
}

let draggedQuadrant = null;

function handleQuadrantDragStart(e, key) {
    draggedQuadrant = key;
    e.target.classList.add('dragging');
}

function handleQuadrantCardDrop(e, targetKey) {
    e.preventDefault();
    if (draggedTaskId) {
        const task = tasks.find(t => t.id === draggedTaskId);
        if (task) {
            task.important = targetKey.includes('important') && !targetKey.includes('not-important');
            task.urgent = targetKey.includes('urgent') && !targetKey.includes('not-urgent');
            saveData();
            renderView();
            if (planPanelOpen) renderPlanPanel();
        }
    } else if (draggedQuadrant && draggedQuadrant !== targetKey) {
        const fromIndex = quadrantOrder.indexOf(draggedQuadrant);
        const toIndex = quadrantOrder.indexOf(targetKey);
        quadrantOrder.splice(fromIndex, 1);
        quadrantOrder.splice(toIndex, 0, draggedQuadrant);
        saveData();
        renderView();
        showToast('象限顺序已更新', 'success');
    }
    document.querySelectorAll('.quadrant-card').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    draggedQuadrant = null;
    draggedTaskId = null;
}

function handleScheduleDragStart(event, taskId) {
    draggedTaskId = taskId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId);
    event.target.style.opacity = '0.5';
    event.target.addEventListener('dragend', function() {
        this.style.opacity = '1';
    }, { once: true });
}

function handleScheduleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const dayEl = event.target.closest('.schedule-day-drop');
    if (dayEl) {
        dayEl.classList.add('ring-2', 'ring-blue-400');
    }
}

function handleScheduleDragLeave(event) {
    const dayEl = event.target.closest('.schedule-day-drop');
    if (dayEl) {
        dayEl.classList.remove('ring-2', 'ring-blue-400');
    }
}

function handleScheduleDrop(event) {
    event.preventDefault();
    const dayEl = event.target.closest('.schedule-day-drop');
    if (!dayEl || !draggedTaskId) return;
    
    dayEl.classList.remove('ring-2', 'ring-blue-400');
    
    const newDateStr = dayEl.dataset.dropDate;
    const task = tasks.find(t => t.id === draggedTaskId);
    if (!task) return;
    
    const wasNoDate = !task.startTime;
    const newDate = new Date(newDateStr);
    
    if (wasNoDate) {
        task.startTime = newDate.toISOString();
        task.isAllDay = true;
        delete task.endTime;
    } else if (task.isAllDay) {
        task.startTime = newDate.toISOString();
    } else {
        const oldStart = new Date(task.startTime);
        newDate.setHours(oldStart.getHours(), oldStart.getMinutes(), oldStart.getSeconds());
        task.startTime = newDate.toISOString();
    }
    
    if (task.endTime && !task.isAllDay && !wasNoDate) {
        const oldStart = task.startTime ? new Date(task.startTime) : new Date();
        const oldEnd = new Date(task.endTime);
        const duration = oldEnd.getTime() - oldStart.getTime();
        const newEnd = new Date(newDate.getTime() + duration);
        task.endTime = newEnd.toISOString();
    }
    
    draggedTaskId = null;
    
    saveData();
    renderView();
    if (planPanelOpen) renderPlanPanel();
}

function showRecent7DaysTasks() {
    const now = new Date();
    
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const sevenDaysLater = new Date(todayStart);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
    sevenDaysLater.setHours(23, 59, 59, 999);
    
    const todayStartTimestamp = todayStart.getTime();
    const sevenDaysLaterTimestamp = sevenDaysLater.getTime();
    
    const recentTasks = tasks.filter(task => {
        if (!task.startTime) return false;
        const taskDate = new Date(task.startTime);
        const taskTimestamp = taskDate.getTime();
        
        return taskTimestamp >= todayStartTimestamp && taskTimestamp <= sevenDaysLaterTimestamp;
    });
    
    currentListId = null;
    currentFilter = 'recent7days';
    
    renderLists();
    renderViewWithTasks(recentTasks);
}
function renderViewWithTasks(filteredTasks) {
    const container = document.getElementById('view-container');
    
    switch (currentView) {
        case 'task':
            renderTaskListView(container);
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
        case 'schedule':
        default:
            renderScheduleView(container);
            break;
    }
}

function clearRecentFilter() {
    currentFilter = null;
    currentListId = null;
    renderLists();
    renderView();
}

function openAddTaskModal(presetDate = null) {
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

    const now = new Date();
    
    let startTime = null;
    let isAllDay = true;
    if (presetDate) {
        startTime = new Date(presetDate + 'T00:00:00');
    } else {
        // 默认今日全天任务
        const today = new Date();
        startTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    }
    
    const newTask = {
        id: generateId(),
        title: '',
        listId: settings.defaultListId || 'default',
        important: settings.defaultImportant || false,
        urgent: settings.defaultUrgent || false,
        notes: '',
        tags: [],
        startTime: startTime ? startTime.toISOString() : null,
        endTime: null,
        isAllDay: isAllDay,
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

function closeAddTaskModal() {
    document.getElementById('add-task-modal').classList.add('hidden');
    document.getElementById('add-task-modal').classList.remove('flex');
}

function openEditTaskModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    document.getElementById('task-modal-title').textContent = '编辑任务';
    document.getElementById('task-id').value = task.id;
    document.getElementById('task-title').value = task.title;
    document.getElementById('task-list').value = task.listId;
    document.getElementById('task-important').checked = task.important;
    document.getElementById('task-urgent').checked = task.urgent;
    document.getElementById('task-notes').value = task.notes || '';
    
    if (task.notes) {
        document.getElementById('task-details-section').classList.remove('hidden');
    } else {
        document.getElementById('task-details-section').classList.add('hidden');
    }
    
    // 重置选择器状态
    document.getElementById('time-picker').classList.add('hidden');
    document.getElementById('priority-picker').classList.add('hidden');
    document.getElementById('list-picker').classList.add('hidden');
    document.getElementById('reminder-picker').classList.add('hidden');
    document.getElementById('repeat-picker').classList.add('hidden');
    
    // 重置提醒和重复选项
    document.querySelectorAll('.reminder-option').forEach(opt => opt.checked = false);
    document.querySelectorAll('.repeat-option').forEach(opt => opt.checked = false);
    document.getElementById('custom-reminder').classList.add('hidden');
    document.getElementById('custom-repeat-container').classList.add('hidden');
    document.getElementById('reminder-text').textContent = '提醒';
    document.getElementById('repeat-text').textContent = '重复';
    
    // 更新按钮文本
    const list = lists.find(l => l.id === task.listId);
    document.getElementById('list-btn-text').textContent = list?.name || '选择清单';
    
    const timeDisplay = task.startTime ? formatDateTime(task.startTime) : '设置时间';
    document.getElementById('time-btn-text').textContent = timeDisplay;
    
    const priorityText = (task.important ? '重要' : '') + (task.important && task.urgent ? ' / ' : '') + (task.urgent ? '紧急' : '');
    document.getElementById('priority-btn-text').textContent = priorityText || '设置优先级';
    
    if (task.startTime) {
        const date = new Date(task.startTime);
        document.getElementById('task-selected-date').value = formatDate(date);
        initCalendar(date);
        document.getElementById('task-start-time').value = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        
        if (task.endTime) {
            setTimeMode('range');
            const endDate = new Date(task.endTime);
            document.getElementById('task-end-time').value = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        }
    } else {
        document.getElementById('task-selected-date').value = formatDate(new Date());
        initCalendar(new Date());
    }
    
    document.getElementById('add-task-modal').classList.remove('hidden');
    document.getElementById('add-task-modal').classList.add('flex');
    
    setTimeout(() => {
        document.getElementById('task-title').focus();
    }, 100);
}

function openEditTaskPriority(taskId) {
    openEditTaskModal(taskId);
    setTimeout(() => {
        toggleImportantUrgent();
    }, 100);
}

let currentDetailTaskId = null;
let isTimeRangeMode = false;

function onDetailAllDayChange() {
    const timeInput = document.getElementById('detail-task-time');
    const endTimeInput = document.getElementById('detail-task-end-time');
    const timeValue = timeInput.value;
    const isAllDay = !timeValue;

    if (isAllDay) {
        timeInput.value = '';
        endTimeInput.value = '';
    }
    updateDetailTimeBtnText();
}

function toggleTimeRange() {
    isTimeRangeMode = !isTimeRangeMode;
    const toggleBtn = document.getElementById('time-toggle-btn');
    const endTimeContainer = document.getElementById('detail-end-time-container');
    const timeValue = document.getElementById('detail-task-time').value;
    const isAllDay = !timeValue;
    
    if (isTimeRangeMode) {
        toggleBtn.textContent = '时间';
        endTimeContainer.classList.remove('hidden');
        
        const duration = settings.defaultDuration || 30;
        const startDate = document.getElementById('detail-task-date').value;
        const startTime = document.getElementById('detail-task-time').value;
        if (startDate && startTime && !isAllDay) {
            const startDateTime = new Date(`${startDate}T${startTime}`);
            startDateTime.setMinutes(startDateTime.getMinutes() + duration);
            document.getElementById('detail-task-end-date').value = formatDate(startDateTime);
            document.getElementById('detail-task-end-time').value = `${startDateTime.getHours().toString().padStart(2, '0')}:${startDateTime.getMinutes().toString().padStart(2, '0')}`;
        } else if (startDate) {
            document.getElementById('detail-task-end-date').value = startDate;
            document.getElementById('detail-task-end-time').value = '';
        }
    } else {
        toggleBtn.textContent = '时间段';
        endTimeContainer.classList.add('hidden');
    }
    updateDetailTimeBtnText();
}

function openTaskDetailPanel(taskId) {
    if (planPanelOpen && !detailOpenedFromPlan) {
        const detailPanel = document.getElementById('task-detail-panel');
        if (detailPanel && !detailPanel.classList.contains('hidden')) {
            closeTaskDetailPanel();
        }
        closePlanPanel();
        return;
    }
    detailOpenedFromPlan = false;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    currentDetailTaskId = taskId;
    isTimeRangeMode = !!task.endTime;
    
    const titleInput = document.getElementById('detail-task-title');
    titleInput.value = task.title;
    document.getElementById('detail-task-notes').value = task.notes || '';
    
    updateDetailCompleteButton(task.completed);
    
    const timeInput = document.getElementById('detail-task-time');
    const endTimeInput = document.getElementById('detail-task-end-time');
    
    if (task.startTime) {
        const date = new Date(task.startTime);
        document.getElementById('detail-task-date').value = formatDate(date);
        if (task.isAllDay) {
            timeInput.value = '';
        } else {
            timeInput.value = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }
    } else {
        document.getElementById('detail-task-date').value = '';
        timeInput.value = '';
    }
    
    onDetailAllDayChange();
    
    // 设置结束时间
    const toggleBtn = document.getElementById('time-toggle-btn');
    const endTimeContainer = document.getElementById('detail-end-time-container');
    if (isTimeRangeMode && task.endTime) {
        const endDate = new Date(task.endTime);
        document.getElementById('detail-task-end-date').value = formatDate(endDate);
        if (task.isAllDay) {
            document.getElementById('detail-task-end-time').value = '';
        } else {
            document.getElementById('detail-task-end-time').value = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
        }
        toggleBtn.textContent = '时间';
        endTimeContainer.classList.remove('hidden');
    } else {
        toggleBtn.textContent = '时间段';
        endTimeContainer.classList.add('hidden');
        document.getElementById('detail-task-end-date').value = '';
        document.getElementById('detail-task-end-time').value = '';
    }
    
    // 设置优先级
    detailImportantState = task.important || false;
    detailUrgentState = task.urgent || false;
    updateDetailPriorityButtons();
    
    // 设置提醒
    document.querySelectorAll('.detail-reminder-option').forEach(opt => opt.checked = false);
    document.getElementById('detail-custom-reminder').classList.add('hidden');
    if (task.reminder && task.reminder > 0) {
        let matched = false;
        document.querySelectorAll('.detail-reminder-option').forEach(opt => {
            if (opt.value === String(task.reminder)) {
                opt.checked = true;
                matched = true;
            }
        });
        if (!matched) {
            const customOpt = document.querySelector('.detail-reminder-option[value="custom"]');
            if (customOpt) {
                customOpt.checked = true;
                document.getElementById('detail-custom-reminder').classList.remove('hidden');
                document.getElementById('detail-custom-reminder').value = task.reminder;
            }
        }
        updateDetailReminderText();
    } else {
        const noReminderOpt = document.querySelector('.detail-reminder-option[value="0"]');
        if (noReminderOpt) noReminderOpt.checked = true;
        updateDetailReminderText();
    }
    
    // 设置重复
    document.querySelectorAll('.detail-repeat-option').forEach(opt => opt.checked = false);
    document.getElementById('detail-custom-repeat-container').classList.add('hidden');
    const modeContainer = document.getElementById('detail-repeat-mode-container');
    document.querySelectorAll('.detail-repeat-mode-option').forEach(opt => opt.checked = false);
    if (modeContainer) modeContainer.classList.remove('hidden');
    // 折叠所有子菜单
    document.querySelectorAll('.repeat-submenu').forEach(sm => sm.classList.add('hidden'));
    document.querySelectorAll('.repeat-submenu-arrow').forEach(a => a.style.transform = '');

    if (task.repeat && task.repeat.type) {
        let matchedRadio = null;
        let needExpandGroup = null;

        if (task.repeat.type === 'custom') {
            matchedRadio = document.querySelector('.detail-repeat-option[value="custom"]');
            if (matchedRadio) {
                matchedRadio.checked = true;
                document.getElementById('detail-custom-repeat-container').classList.remove('hidden');
                document.getElementById('detail-custom-repeat-interval').value = task.repeat.interval || '';
                document.getElementById('detail-custom-repeat-unit').value = task.repeat.unit || 'days';
            }
        } else if (task.repeat.type === 'daily' && task.repeat.workdayOnly) {
            matchedRadio = document.querySelector('.detail-repeat-option[value="dailyWorkday"]');
            needExpandGroup = matchedRadio ? matchedRadio.closest('.repeat-group') : null;
        } else if (task.repeat.type === 'daily') {
            matchedRadio = document.querySelector('.detail-repeat-option[value="daily"]');
            needExpandGroup = matchedRadio ? matchedRadio.closest('.repeat-group') : null;
        } else if (task.repeat.type === 'weekly') {
            matchedRadio = document.querySelector('.detail-repeat-option[value="weekly"]');
            needExpandGroup = matchedRadio ? matchedRadio.closest('.repeat-group') : null;
        } else if (task.repeat.type === 'monthly') {
            matchedRadio = document.querySelector('.detail-repeat-option[value="monthly"]');
            needExpandGroup = matchedRadio ? matchedRadio.closest('.repeat-group') : null;
        } else if (task.repeat.type === 'yearly' && task.repeat.beforeHoliday) {
            matchedRadio = document.querySelector('.detail-repeat-option[value="yearlyBeforeHoliday"]');
            needExpandGroup = matchedRadio ? matchedRadio.closest('.repeat-group') : null;
        } else if (task.repeat.type === 'yearly') {
            matchedRadio = document.querySelector('.detail-repeat-option[value="yearly"]');
            needExpandGroup = matchedRadio ? matchedRadio.closest('.repeat-group') : null;
        } else {
            // 其他类型（如 weeklyFirstWorkday, monthlyFirstWorkday 等）直接按value匹配
            matchedRadio = document.querySelector(`.detail-repeat-option[value="${task.repeat.type}"]`);
            if (matchedRadio) {
                needExpandGroup = matchedRadio.closest('.repeat-group');
            }
        }

        if (matchedRadio) {
            matchedRadio.checked = true;
            // 展开对应的子菜单
            if (needExpandGroup) {
                const submenu = needExpandGroup.querySelector('.repeat-submenu');
                const arrow = needExpandGroup.querySelector('.repeat-submenu-arrow');
                if (submenu) {
                    submenu.classList.remove('hidden');
                    if (arrow) arrow.style.transform = 'rotate(90deg)';
                }
            }
        }

        const repeatMode = task.repeat.repeatMode || 'startTime';
        const modeOpt = document.querySelector(`.detail-repeat-mode-option[value="${repeatMode}"]`);
        if (modeOpt) modeOpt.checked = true;
        updateDetailRepeatText();
    } else {
        const noRepeatOpt = document.querySelector('.detail-repeat-option[value=""]');
        if (noRepeatOpt) noRepeatOpt.checked = true;
        updateDetailRepeatText();
    }
    
    // 设置清单
    populateDetailListSelect(task.listId);
    
    // 显示原清单信息
    const prevListEl = document.getElementById('detail-previous-list');
    const prevListNameEl = document.getElementById('detail-previous-list-name');
    if (task.previousListName && prevListEl && prevListNameEl) {
        prevListNameEl.textContent = task.previousListName;
        prevListEl.classList.remove('hidden');
    } else if (prevListEl) {
        prevListEl.classList.add('hidden');
    }
    
    // 更新顶栏时间按钮文本
    updateDetailTimeBtnText();
    
    // 更新清单按钮文本
    updateDetailListBtnText();
    
    // 初始化任务进度显示
    updateProgressDisplay();
    
    // 初始化任务模式
    currentTaskMode = task.mode || 'text';
    if (currentTaskMode === 'subtasks') {
        document.getElementById('detail-task-notes').classList.add('hidden');
        document.getElementById('subtasks-container').classList.remove('hidden');
        document.getElementById('toggle-mode-btn').innerHTML = '<i class="fas fa-edit"></i>';
        document.getElementById('toggle-mode-btn').title = '文本模式';
    } else {
        document.getElementById('detail-task-notes').classList.remove('hidden');
        document.getElementById('subtasks-container').classList.add('hidden');
        document.getElementById('toggle-mode-btn').innerHTML = '<i class="fas fa-list-ul"></i>';
        document.getElementById('toggle-mode-btn').title = '切换任务模式';
    }
    
    // 收起时间菜单和清单选择器
    document.getElementById('detail-time-menu').classList.add('hidden');
    document.getElementById('detail-list-picker').classList.add('hidden');
    document.getElementById('detail-tag-picker').classList.add('hidden');
    document.getElementById('detail-reminder-picker').classList.add('hidden');
    document.getElementById('detail-repeat-picker').classList.add('hidden');
    closeAllTimePickers();
    
    // 初始化标签显示
    renderDetailTags(task);
    
    // 显示面板（必须在renderSubtasks之前，否则scrollHeight为0导致文本不显示）
    document.getElementById('task-detail-panel').classList.remove('hidden');
    
    // 渲染子任务（在面板可见后，确保autoResizeTextarea能正确计算高度）
    if (currentTaskMode === 'subtasks') {
        renderSubtasks();
    }
    
    deleteDetailConfirming = false;
    const deleteBtn = document.getElementById('detail-delete-btn');
    if (deleteBtn) {
        deleteBtn.textContent = '删除任务';
        deleteBtn.style.cssText = '';
    }
    
    // 添加日期和时间的交互
    setupDateTimeInteractions();
    
    // 添加标题自动调整高度
    setupTitleAutoResize();
    
    // 在面板显示后再调整标题高度（延迟确保DOM已渲染）
    setTimeout(() => {
        autoResizeTextarea(titleInput);
    }, 50);
    
    const detailPanel = document.getElementById('task-detail-panel');
    detailPanel.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            const tag = e.target.tagName.toLowerCase();
            if (tag === 'textarea') return;
            e.preventDefault();
            closeTaskDetailPanel();
        }
    };
    
    document.removeEventListener('click', handleDetailTimeMenuOutsideClick);
    document.addEventListener('click', handleDetailTimeMenuOutsideClick);
}

function handleDetailTimeMenuOutsideClick(e) {
    const timeMenu = document.getElementById('detail-time-menu');
    const timeBtn = e.target.closest('[onclick*="toggleDetailTimeMenu"]');
    const insideMenu = e.target.closest('#detail-time-menu');
    const insideTimePicker = e.target.closest('.time-picker-dropdown');
    const insideDatePicker = e.target.closest('.date-picker-dropdown');
    const insideDateInput = e.target.closest('input[type="date"]');
    const insideTimeInput = e.target.closest('input[type="time"]');

    // 如果点击在日期/时间选择器或输入框内，不关闭
    if (insideTimePicker || insideDatePicker || insideDateInput || insideTimeInput) return;

    // 关闭所有日期和时间选择器
    closeAllTimePickers();

    // 如果时间菜单可见且点击在外部，也关闭它
    if (!timeMenu.classList.contains('hidden')) {
        if (timeBtn || insideMenu) return;
        saveDetailTimeConfig();
        timeMenu.classList.add('hidden');
        document.getElementById('detail-reminder-picker').classList.add('hidden');
        document.getElementById('detail-repeat-picker').classList.add('hidden');
    }
}

function saveDetailTimeConfig() {
    if (!currentDetailTaskId) return;
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];

    // 记录修改前今日未完成任务数（用于检测是否因修改日期清空今日任务）
    const beforeTodayIncomplete = (typeof ee_countTodayIncomplete === 'function') ? ee_countTodayIncomplete() : -1;

    const dateValue = document.getElementById('detail-task-date').value;
    const timeValue = document.getElementById('detail-task-time').value;
    const isAllDay = !timeValue;

    let newStartTime = null;
    let newEndTime = null;

    if (dateValue && timeValue && !isAllDay) {
        newStartTime = new Date(`${dateValue}T${timeValue}`).toISOString();
    } else if (dateValue) {
        newStartTime = new Date(dateValue + 'T00:00:00').toISOString();
    }

    if (isTimeRangeMode) {
        const endDateValue = document.getElementById('detail-task-end-date').value;
        const endTimeValue = document.getElementById('detail-task-end-time').value;
        if (endDateValue && endTimeValue && !isAllDay) {
            newEndTime = new Date(`${endDateValue}T${endTimeValue}`).toISOString();
        } else if (endDateValue) {
            newEndTime = new Date(endDateValue + 'T00:00:00').toISOString();
        }
    }

    if (newEndTime && newStartTime && new Date(newEndTime) < new Date(newStartTime)) {
        showToast('结束时间不能早于开始时间', 'warning');
        return;
    }

    if (newStartTime) {
        task.startTime = newStartTime;
        task.isAllDay = isAllDay;
    } else {
        delete task.startTime;
        task.isAllDay = false;
    }

    if (newEndTime) {
        task.endTime = newEndTime;
    } else {
        delete task.endTime;
    }
    
    const reminderSelected = document.querySelector('input[name="detail-reminder"]:checked');
    if (reminderSelected) {
        if (reminderSelected.value === '0') {
            task.reminder = 0;
        } else if (reminderSelected.value === 'custom') {
            const customVal = parseInt(document.getElementById('detail-custom-reminder').value);
            task.reminder = customVal > 0 ? customVal : 0;
        } else {
            task.reminder = parseInt(reminderSelected.value) || 0;
        }
    } else {
        task.reminder = 0;
    }
    
    const repeatSelected = document.querySelector('input[name="detail-repeat"]:checked');
    if (repeatSelected && repeatSelected.value && repeatSelected.value !== '') {
        const repeatModeSelected = document.querySelector('input[name="detail-repeat-mode"]:checked');
        const repeatMode = repeatModeSelected ? repeatModeSelected.value : 'startTime';
        if (repeatSelected.value === 'custom') {
            const interval = parseInt(document.getElementById('detail-custom-repeat-interval').value);
            const unit = document.getElementById('detail-custom-repeat-unit').value;
            if (interval && interval > 0) {
                task.repeat = { type: 'custom', interval: interval, unit: unit, repeatMode: repeatMode };
            } else {
                task.repeat = null;
            }
        } else {
            const propsAttr = repeatSelected.getAttribute('data-repeat-props');
            if (propsAttr) {
                try {
                    const props = JSON.parse(propsAttr);
                    task.repeat = Object.assign({}, props, { repeatMode: repeatMode });
                } catch (e) {
                    task.repeat = { type: repeatSelected.value, repeatMode: repeatMode };
                }
            } else {
                task.repeat = { type: repeatSelected.value, repeatMode: repeatMode };
            }
        }
    } else {
        task.repeat = null;
    }
    
    saveData();
    renderView();

    // 修改日期可能导致今日任务清空，检查并触发"落日归山"彩蛋
    if (beforeTodayIncomplete > 0 && typeof ee_checkSunsetHorizon === 'function') {
        ee_checkSunsetHorizon();
    }
}

function toggleTaskMode(event) {
    if (event) event.stopPropagation();
    if (!currentDetailTaskId) return;
    
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    
    if (currentTaskMode === 'text') {
        const notesValue = document.getElementById('detail-task-notes').value;
        task.notes = notesValue;
        currentTaskMode = 'subtasks';
        const notes = notesValue || '';
        if (notes.trim()) {
            const lines = notes.split('\n');
            // 总是用当前文本重新生成子任务
            task.subtasks = lines.map((line, i) => ({ id: generateId(), text: line, completed: false, originalOrder: i }));
        }
        if (!task.subtasks || task.subtasks.length === 0) {
            task.subtasks = [{ id: generateId(), text: '', completed: false, originalOrder: 0 }];
        }
        // 先切换显示，再渲染子任务（确保scrollHeight正确计算）
        document.getElementById('detail-task-notes').classList.add('hidden');
        document.getElementById('subtasks-container').classList.remove('hidden');
        renderSubtasks();
        document.getElementById('toggle-mode-btn').innerHTML = '<i class="fas fa-edit"></i>';
        document.getElementById('toggle-mode-btn').title = '文本模式';
        setTimeout(() => {
            const firstInput = document.querySelector('#subtasks-container textarea[data-subtask-id]');
            if (firstInput) firstInput.focus();
        }, 50);
    } else {
        saveSubtasksToTask();
        currentTaskMode = 'text';
        // 按排序顺序（未完成在前、已完成在后，组内按originalOrder）生成文本
        const sortedForText = [...task.subtasks].sort((a, b) => {
            if (!a.completed && b.completed) return -1;
            if (a.completed && !b.completed) return 1;
            return (a.originalOrder || 0) - (b.originalOrder || 0);
        });
        task.notes = sortedForText.map(st => st.text).join('\n');
        document.getElementById('detail-task-notes').value = task.notes || '';
        document.getElementById('detail-task-notes').classList.remove('hidden');
        document.getElementById('subtasks-container').classList.add('hidden');
        document.getElementById('toggle-mode-btn').innerHTML = '<i class="fas fa-list-ul"></i>';
        document.getElementById('toggle-mode-btn').title = '切换任务模式';
    }
    // 立即写入 task.mode，确保面板打开期间的中间保存（saveData）携带正确的 mode，
    // 避免版本冲突合并时被服务器旧 mode 覆盖
    task.mode = currentTaskMode;
}

function saveSubtasksToTask() {
    const container = document.getElementById('subtasks-container');
    if (!container) return;
    const inputs = container.querySelectorAll('textarea[data-subtask-id]');
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    
    const newSubtasks = [];
    inputs.forEach((input, i) => {
        const text = input.value;
        const id = input.dataset.subtaskId;
        const existing = task.subtasks.find(st => st.id === id);
        newSubtasks.push({
            id: id,
            text: text,
            completed: existing ? existing.completed : false,
            originalOrder: existing && existing.originalOrder !== undefined ? existing.originalOrder : i,
            completedAt: existing ? existing.completedAt : null
        });
    });
    if (newSubtasks.length === 0) {
        newSubtasks.push({ id: generateId(), text: '', completed: false, originalOrder: 0 });
    }
    task.subtasks = newSubtasks;
    updateTaskProgressFromSubtasks(task);
}

function renderSubtasks() {
    const container = document.getElementById('subtasks-container');
    if (!container) return;
    
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    
    container.innerHTML = '';
    const subtasks = task.subtasks || [{ id: generateId(), text: '', completed: false, originalOrder: 0 }];
    
    subtasks.forEach((st, i) => {
        if (st.originalOrder === undefined) {
            st.originalOrder = i;
        }
    });
    
    const sortedSubtasks = [...subtasks].sort((a, b) => {
        if (!a.completed && b.completed) return -1;
        if (a.completed && !b.completed) return 1;
        return (a.originalOrder || 0) - (b.originalOrder || 0);
    });
    
    // 创建拖放区域
    function createDropZone(completed, position) {
        const zone = document.createElement('div');
        zone.className = 'subtask-drop-zone';
        zone.dataset.completed = completed ? 'true' : 'false';
        zone.dataset.position = position; // 'top' or 'bottom'
        zone.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        };
        zone.ondragenter = (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        };
        zone.ondragleave = () => {
            zone.classList.remove('drag-over');
        };
        zone.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const draggedId = e.dataTransfer.getData('text/plain');
            // 找到该组的第一个或最后一个子任务
            const groupItems = sortedSubtasks.filter(st => st.completed === completed);
            if (groupItems.length === 0) return;
            const targetSubtask = position === 'top' ? groupItems[0] : groupItems[groupItems.length - 1];
            if (draggedId === targetSubtask.id) return;
            handleSubtaskReorder(draggedId, targetSubtask.id, position === 'bottom');
        };
        return zone;
    }

    // 找到未完成和已完成组的边界索引
    let lastUncompletedIdx = -1;
    let firstCompletedIdx = -1;
    for (let i = 0; i < sortedSubtasks.length; i++) {
        if (!sortedSubtasks[i].completed) lastUncompletedIdx = i;
        if (sortedSubtasks[i].completed && firstCompletedIdx === -1) firstCompletedIdx = i;
    }

    sortedSubtasks.forEach((subtask, index) => {
        // 在未完成组第一个子任务前添加顶部拖放区域
        if (index === 0 && !subtask.completed) {
            container.appendChild(createDropZone(false, 'top'));
        }
        // 在已完成组第一个子任务前添加顶部拖放区域
        if (index === firstCompletedIdx && firstCompletedIdx !== -1) {
            container.appendChild(createDropZone(true, 'top'));
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'flex items-center gap-2 py-1 group subtask-item';
        wrapper.draggable = false;
        wrapper.dataset.subtaskId = subtask.id;
        wrapper.dataset.completed = subtask.completed ? 'true' : 'false';
        if (subtask.completed) {
            wrapper.classList.add('opacity-60');
        }
        
        const checkbox = document.createElement('button');
        checkbox.className = 'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition border-blue-500 dark:border-white hover:border-blue-600 dark:hover:border-blue-300';
        if (subtask.completed) {
            checkbox.classList.add('bg-gray-400', 'border-gray-400');
            checkbox.classList.remove('border-blue-500', 'dark:border-white');
            checkbox.innerHTML = '<i class="fas fa-check text-[8px] text-white"></i>';
        }
        checkbox.onclick = () => toggleSubtaskComplete(subtask.id, !subtask.completed);
        
        const input = document.createElement('textarea');
        input.value = subtask.text;
        input.dataset.subtaskId = subtask.id;
        input.className = 'flex-1 bg-transparent border-none outline-none text-theme-primary resize-none overflow-hidden';
        input.rows = 1;
        if (subtask.completed) {
            input.classList.add('text-theme-muted');
        }
        input.placeholder = '输入子任务...';
        input.onkeydown = (e) => handleSubtaskKeydown(e, subtask.id);
        input.oninput = () => { autoResizeTextarea(input); saveSubtasksToTask(); };
        
        const dragBtn = document.createElement('button');
        dragBtn.className = 'text-theme-muted hover:text-theme-primary transition flex-shrink-0 p-1 invisible group-hover:visible cursor-grab active:cursor-grabbing';
        dragBtn.innerHTML = '<i class="fas fa-grip-vertical text-xs"></i>';
        dragBtn.title = '拖拽排序';
        dragBtn.onmousedown = () => {
            wrapper.draggable = true;
        };
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'text-theme-muted hover:text-red-500 transition flex-shrink-0 p-1 invisible group-hover:visible';
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt text-xs"></i>';
        deleteBtn.onmousedown = (e) => {
            e.preventDefault();
            deleteSubtask(subtask.id);
        };
        
        wrapper.ondragstart = (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', subtask.id);
            wrapper.classList.add('opacity-50');
            container.querySelectorAll('.subtask-drop-zone').forEach(el => {
                el.classList.add('active');
            });
        };
        wrapper.ondragend = () => {
            wrapper.draggable = false;
            container.querySelectorAll('.subtask-item').forEach(el => {
                el.classList.remove('opacity-50', 'border-t-2', 'border-b-2', 'border-blue-400');
            });
            container.querySelectorAll('.subtask-drop-zone').forEach(el => {
                el.classList.remove('active');
            });
        };
        wrapper.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        };
        wrapper.ondragenter = (e) => {
            e.preventDefault();
            const draggedEl = container.querySelector('.subtask-item.opacity-50');
            if (draggedEl && draggedEl !== wrapper) {
                const rect = wrapper.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (e.clientY < midY) {
                    wrapper.classList.add('border-t-2', 'border-blue-400');
                    wrapper.classList.remove('border-b-2', 'border-blue-400');
                } else {
                    wrapper.classList.add('border-b-2', 'border-blue-400');
                    wrapper.classList.remove('border-t-2', 'border-blue-400');
                }
            }
        };
        wrapper.ondragleave = () => {
            wrapper.classList.remove('border-t-2', 'border-b-2', 'border-blue-400');
        };
        wrapper.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId === subtask.id) return;
            const rect = wrapper.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const insertAfter = e.clientY >= midY;
            handleSubtaskReorder(draggedId, subtask.id, insertAfter);
        };
        
        wrapper.appendChild(checkbox);
        wrapper.appendChild(input);
        wrapper.appendChild(dragBtn);
        wrapper.appendChild(deleteBtn);
        container.appendChild(wrapper);
        
        // 初始化textarea高度
        autoResizeTextarea(input);

        // 在未完成组最后一个子任务后添加底部拖放区域
        if (index === lastUncompletedIdx && !subtask.completed) {
            container.appendChild(createDropZone(false, 'bottom'));
        }
        // 在已完成组最后一个子任务后添加底部拖放区域
        if (index === sortedSubtasks.length - 1 && subtask.completed) {
            container.appendChild(createDropZone(true, 'bottom'));
        }
    });
}

function handleSubtaskReorder(draggedId, targetId, insertAfter = false) {
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];

    const draggedSubtask = task.subtasks.find(st => st.id === draggedId);
    const targetSubtask = task.subtasks.find(st => st.id === targetId);
    if (!draggedSubtask || !targetSubtask) return;

    // 不允许跨组拖拽：已完成不能拖到未完成区域，未完成不能拖到已完成区域
    if (draggedSubtask.completed !== targetSubtask.completed) return;

    // 获取同组的子任务（按当前排序顺序）
    const sameGroup = task.subtasks
        .filter(st => st.completed === draggedSubtask.completed)
        .sort((a, b) => (a.originalOrder || 0) - (b.originalOrder || 0));

    const draggedIdx = sameGroup.findIndex(st => st.id === draggedId);
    const targetIdx = sameGroup.findIndex(st => st.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    // 移除拖拽项，插入到目标位置
    sameGroup.splice(draggedIdx, 1);
    const newTargetIdx = sameGroup.findIndex(st => st.id === targetId);
    const insertIdx = insertAfter ? newTargetIdx + 1 : newTargetIdx;
    sameGroup.splice(insertIdx, 0, draggedSubtask);

    // 重新分配 originalOrder
    sameGroup.forEach((st, i) => {
        st.originalOrder = i;
    });

    saveData();
    renderSubtasks();
}

function handleSubtaskKeydown(event, subtaskId) {
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    const subtaskIndex = task.subtasks.findIndex(st => st.id === subtaskId);
    if (subtaskIndex === -1) return;
    
    const subtask = task.subtasks[subtaskIndex];
    const input = event.target;
    
    if (event.key === 'Enter' && !event.shiftKey) {
        // Shift+Enter 换行（textarea默认），Enter 创建新子任务
        event.preventDefault();
        event.stopPropagation();
        const cursorPos = input.selectionStart;
        const textBefore = input.value.substring(0, cursorPos);
        const textAfter = input.value.substring(cursorPos);
        
        // 更新当前子任务为光标前的文本
        subtask.text = textBefore;
        input.value = textBefore;
        
        const currentOrder = subtask.originalOrder !== undefined ? subtask.originalOrder : subtaskIndex;
        const nextUncompleted = task.subtasks.find(st => !st.completed && (st.originalOrder !== undefined ? st.originalOrder : task.subtasks.indexOf(st)) > currentOrder);
        const nextOrder = nextUncompleted ? (nextUncompleted.originalOrder !== undefined ? nextUncompleted.originalOrder : task.subtasks.indexOf(nextUncompleted)) : currentOrder + 1;
        const newOriginalOrder = (currentOrder + nextOrder) / 2;
        // 新子任务包含光标后的文本
        const newSubtask = { id: generateId(), text: textAfter, completed: false, originalOrder: newOriginalOrder };
        task.subtasks.splice(subtaskIndex + 1, 0, newSubtask);
        saveData();
        renderSubtasks();
        setTimeout(() => {
            const newInput = document.querySelector(`#subtasks-container textarea[data-subtask-id="${newSubtask.id}"]`);
            if (newInput) {
                newInput.focus();
                newInput.setSelectionRange(0, 0);
            }
        }, 10);
    } else if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        saveSubtasksToTask();
        const container = document.getElementById('subtasks-container');
        const inputs = container.querySelectorAll('textarea[data-subtask-id]');
        let currentDomIndex = -1;
        inputs.forEach((inp, i) => { if (inp.dataset.subtaskId === subtaskId) currentDomIndex = i; });
        if (currentDomIndex < inputs.length - 1) {
            const nextInput = inputs[currentDomIndex + 1];
            nextInput.focus();
            nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        } else {
            const maxOrder = Math.max(...task.subtasks.map(st => st.originalOrder !== undefined ? st.originalOrder : 0));
            const newSubtask = { id: generateId(), text: '', completed: false, originalOrder: maxOrder + 1 };
            task.subtasks.push(newSubtask);
            saveData();
            renderSubtasks();
            setTimeout(() => {
                const newInput = document.querySelector(`#subtasks-container textarea[data-subtask-id="${newSubtask.id}"]`);
                if (newInput) newInput.focus();
            }, 10);
        }
    } else if (event.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0 && task.subtasks.length > 1) {
        event.preventDefault();
        event.stopPropagation();
        // 找到DOM中当前子任务的前一个子任务
        const container = document.getElementById('subtasks-container');
        const inputs = container.querySelectorAll('textarea[data-subtask-id]');
        let currentDomIndex = -1;
        inputs.forEach((inp, i) => { if (inp.dataset.subtaskId === subtaskId) currentDomIndex = i; });
        
        if (currentDomIndex > 0) {
            // 有前一个子任务，合并
            const prevInput = inputs[currentDomIndex - 1];
            const prevSubtaskId = prevInput.dataset.subtaskId;
            const prevSubtaskIndex = task.subtasks.findIndex(st => st.id === prevSubtaskId);
            if (prevSubtaskIndex !== -1) {
                const prevSubtask = task.subtasks[prevSubtaskIndex];
                const prevText = prevSubtask.text || '';
                const currentText = input.value || '';
                const mergePos = prevText.length;
                // 合并文本到前一个子任务
                prevSubtask.text = prevText + currentText;
                // 删除当前子任务
                task.subtasks.splice(subtaskIndex, 1);
                saveData();
                renderSubtasks();
                setTimeout(() => {
                    const mergedInput = document.querySelector(`#subtasks-container textarea[data-subtask-id="${prevSubtaskId}"]`);
                    if (mergedInput) {
                        mergedInput.focus();
                        mergedInput.setSelectionRange(mergePos, mergePos);
                    }
                }, 10);
            }
        } else {
            // 没有前一个子任务，直接删除
            task.subtasks.splice(subtaskIndex, 1);
            saveData();
            renderSubtasks();
            setTimeout(() => {
                const newInputs = document.querySelectorAll('#subtasks-container textarea[data-subtask-id]');
                if (newInputs.length > 0) {
                    newInputs[0].focus();
                    newInputs[0].setSelectionRange(0, 0);
                }
            }, 10);
        }
    }
}

function toggleSubtaskComplete(subtaskId, completed) {
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    const subtask = task.subtasks.find(st => st.id === subtaskId);
    if (subtask) {
        const wasCompleted = subtask.completed;
        subtask.completed = completed;
        if (completed) {
            subtask.completedAt = new Date().toISOString();
        } else {
            subtask.completedAt = null;
        }
        updateTaskProgressFromSubtasks(task);
        updateDetailCompleteButton(task.completed);
        renderSubtasks();
        updateProgressDisplay();
        saveData();
        renderView();

        // 触发彩蛋效果（子任务完成时）
        if (completed && !wasCompleted) {
            if (typeof easterEgg_onSubtaskComplete === 'function') {
                easterEgg_onSubtaskComplete();
            }
        }
    }
}

function deleteSubtask(subtaskId) {
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    task.subtasks = task.subtasks.filter(st => st.id !== subtaskId);
    if (task.subtasks.length === 0) {
        task.subtasks = [{ id: generateId(), text: '', completed: false, originalOrder: 0 }];
    }
    updateTaskProgressFromSubtasks(task);
    renderSubtasks();
    updateProgressDisplay();
    saveData();
    renderView();
}

function updateTaskProgressFromSubtasks(task) {
    if (!task.subtasks || task.subtasks.length === 0) {
        return;
    }
    const completed = task.subtasks.filter(st => st.completed).length;
    const total = task.subtasks.length;
    task.progress = Math.round((completed / total) * 100);
    if (completed === total && total > 0) {
        if (!task.completed) {
            task.completed = true;
            task.completedAt = new Date().toISOString();
        }
    } else {
        if (task.completed) {
            task.completed = false;
            task.completedAt = null;
        }
    }
}

function setTaskProgress(event) {
    if (!currentDetailTaskId) return;
    
    const container = document.getElementById('progress-container');
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = rect.width;
    let percentage = Math.round((x / width) * 100);
    percentage = Math.max(0, Math.min(100, percentage));
    
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex !== -1) {
        const task = tasks[taskIndex];
        task.progress = percentage;
        updateProgressDisplay();
        saveData();
        renderView();
    }
}

// Progress bar drag support
let _progressDragging = false;

function startProgressDrag(event) {
    if (!currentDetailTaskId) return;
    event.preventDefault();
    _progressDragging = true;
    updateProgressFromEvent(event);

    function onMouseMove(e) {
        if (!_progressDragging) return;
        e.preventDefault();
        updateProgressFromEvent(e);
    }

    function onMouseUp(e) {
        if (!_progressDragging) return;
        _progressDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        // Final save on release
        const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
        if (taskIndex !== -1) {
            saveData();
            renderView();
        }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function updateProgressFromEvent(event) {
    const container = document.getElementById('progress-container');
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = rect.width;
    let percentage = Math.round((x / width) * 100);
    percentage = Math.max(0, Math.min(100, percentage));

    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex !== -1) {
        const task = tasks[taskIndex];
        task.progress = percentage;
        // Update display only (no save during drag)
        document.getElementById('progress-bar').style.width = `${percentage}%`;
        document.getElementById('progress-text').textContent = `${percentage}%`;
    }
}

function updateProgressDisplay() {
    if (!currentDetailTaskId) return;
    
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    
    const progress = task.progress || 0;
    document.getElementById('progress-bar').style.width = `${progress}%`;
    document.getElementById('progress-text').textContent = `${progress}%`;
    
    const focusMinutes = getTaskFocusMinutes(currentDetailTaskId);
    const focusEl = document.getElementById('detail-focus-duration');
    if (focusMinutes > 0) {
        focusEl.style.display = '';
        document.getElementById('focus-duration-text').textContent = formatFocusMinutes(focusMinutes);
    } else {
        focusEl.style.display = 'none';
    }
}

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function setupTitleAutoResize() {
    const titleInput = document.getElementById('detail-task-title');
    
    // 移除旧的监听器
    titleInput.oninput = null;
    
    // 添加新的监听器
    titleInput.oninput = function() {
        autoResizeTextarea(this);
    };
}

function updateDetailCompleteButton(completed) {
    const btn = document.getElementById('detail-task-complete-btn');
    const icon = btn.querySelector('i');
    
    if (completed) {
        btn.classList.add('bg-gray-400', 'border-gray-400');
        btn.classList.remove('border-blue-500', 'dark:border-white');
        icon.classList.remove('hidden');
        icon.classList.add('text-white');
        icon.classList.remove('text-gray-500');
    } else {
        btn.classList.remove('bg-gray-400', 'border-gray-400');
        btn.classList.add('border-blue-500', 'dark:border-white');
        icon.classList.add('hidden');
        icon.classList.remove('text-white');
    }
}

function toggleTaskDetailComplete() {
    if (!currentDetailTaskId) return;

    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;

    const wasCompleted = task.completed;
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    if (task.completed && task.repeat && task.repeat.type) {
        const nextTask = createNextRepeatTask(task);
        if (nextTask) {
            tasks.push(nextTask);
        }
    }
    updateDetailCompleteButton(task.completed);
    saveData();
    renderView();

    // 触发彩蛋效果（任务完成时）
    if (task.completed && !wasCompleted) {
        easterEgg_onTaskComplete(task);
        // 通知番茄专注：当前任务已完成
        if (typeof onFocusTaskCompleted === 'function') {
            onFocusTaskCompleted(task.id);
        }
    }
}

function setupDateTimeInteractions() {
    const dateInput = document.getElementById('detail-task-date');
    const timeInput = document.getElementById('detail-task-time');
    
    const dateParent = dateInput.parentElement;
    const newDateInput = dateInput.cloneNode(true);
    dateParent.replaceChild(newDateInput, dateInput);
    
    const timeParent = timeInput.parentElement;
    const newTimeInput = timeInput.cloneNode(true);
    timeParent.replaceChild(newTimeInput, timeInput);

    newTimeInput.addEventListener('click', function(e) {
        openTimePicker(this, 'detail-task-time-picker');
    });

    newDateInput.addEventListener('change', updateDetailTimeBtnText);
    newTimeInput.addEventListener('change', function() {
        updateDetailTimeBtnText();
        onDetailAllDayChange();
    });

    const endDateInput = document.getElementById('detail-task-end-date');
    const endTimeInput = document.getElementById('detail-task-end-time');
    if (endDateInput) endDateInput.addEventListener('change', updateDetailTimeBtnText);
    if (endTimeInput) {
        endTimeInput.addEventListener('click', function(e) {
            openTimePicker(this, 'detail-task-end-time-picker');
        });
        endTimeInput.addEventListener('change', function() {
            updateDetailTimeBtnText();
        });
    }
}

function closeTaskDetailPanel() {
    if (currentDetailTaskId) {
        const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
        if (taskIndex !== -1) {
            const titleFromPanel = document.getElementById('detail-task-title').value;
            if (!titleFromPanel || !titleFromPanel.trim()) {
                const notesFromPanel = document.getElementById('detail-task-notes');
                const hasNotes = notesFromPanel && notesFromPanel.value && notesFromPanel.value.trim();
                if (!hasNotes) {
                    tasks.splice(taskIndex, 1);
                    saveDataImmediate();
                    renderLists();
                    renderView();
                    document.getElementById('task-detail-panel').classList.add('hidden');
                    currentDetailTaskId = null;
                    detailOpenedFromPlan = false;
                    if (planPanelOpen) renderPlanPanel();
                    return;
                }
                const defaultTitle = generateUntitledName();
                document.getElementById('detail-task-title').value = defaultTitle;
            }
        }
        const saved = saveTaskDetail();
        if (!saved) return;
        // 立即保存到服务器，确保数据在refreshDataFromServer之前已同步
        saveDataImmediate().then(() => {
            if (_dataRefreshPending) {
                refreshDataFromServer();
            }
        });
    } else {
        if (_dataRefreshPending) {
            refreshDataFromServer();
        }
    }
    document.getElementById('task-detail-panel').classList.add('hidden');
    currentDetailTaskId = null;
    detailOpenedFromPlan = false;
    if (planPanelOpen) renderPlanPanel();
}

function generateUntitledName() {
    const existingNames = tasks.map(t => t.title || '');
    if (!existingNames.includes('未命名任务')) return '未命名任务';
    let idx = 2;
    while (existingNames.includes(`未命名任务${idx}`)) idx++;
    return `未命名任务${idx}`;
}

let detailSelectedListId = 'default';

function populateDetailListSelect(selectedListId) {
    detailSelectedListId = selectedListId || 'default';
    const pillsContainer = document.getElementById('detail-list-pills');
    if (!pillsContainer) return;
    pillsContainer.innerHTML = '';

    lists.filter(l => !l.archived).forEach(list => {
        const isSelected = list.id === detailSelectedListId;
        const color = list.color || '#6b7280';
        const btn = document.createElement('button');
        btn.className = isSelected ? 'detail-tag-pill-selected' : 'detail-tag-pill';
        btn.style.setProperty('--tag-color', color);
        btn.title = isSelected ? '当前所属清单' : '点击选择此清单';
        btn.textContent = list.name;
        btn.onclick = (e) => {
            e.stopPropagation();
            detailSelectedListId = list.id;
            populateDetailListSelect(list.id);
            updateDetailListBtnText();
            // 清单为单选，选择后收起选择器
            document.getElementById('detail-list-picker').classList.add('hidden');
        };
        pillsContainer.appendChild(btn);
    });
}

function saveTaskDetail() {
    if (!currentDetailTaskId) return false;

    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return false;

    const task = tasks[taskIndex];
    // 记录修改前今日未完成任务数（用于检测是否因修改日期清空今日任务）
    const beforeTodayIncomplete = (typeof ee_countTodayIncomplete === 'function') ? ee_countTodayIncomplete() : -1;

    const titleValue = document.getElementById('detail-task-title').value;
    if (titleValue && titleValue.trim()) {
        task.title = titleValue;
    } else {
        const notesValue = document.getElementById('detail-task-notes').value;
        if (notesValue && notesValue.trim()) {
            task.title = generateUntitledName();
        } else {
            task.title = titleValue;
        }
    }
    
    // 保存任务模式
    task.mode = currentTaskMode;
    
    if (currentTaskMode === 'text') {
        task.notes = document.getElementById('detail-task-notes').value;
    } else {
        if (task.subtasks && task.subtasks.length > 0) {
            const sorted = [...task.subtasks].sort((a, b) => {
                if (!a.completed && b.completed) return -1;
                if (a.completed && !b.completed) return 1;
                return (a.originalOrder || 0) - (b.originalOrder || 0);
            });
            task.notes = sorted.map(st => st.text).join('\n');
        }
    }
    
    task.listId = detailSelectedListId;
    task.important = detailImportantState;
    task.urgent = detailUrgentState;
    
    // 处理提醒
    const reminderSelected = document.querySelector('input[name="detail-reminder"]:checked');
    if (reminderSelected) {
        if (reminderSelected.value === '0') {
            task.reminder = 0;
        } else if (reminderSelected.value === 'custom') {
            const customVal = parseInt(document.getElementById('detail-custom-reminder').value);
            task.reminder = customVal > 0 ? customVal : 0;
        } else {
            task.reminder = parseInt(reminderSelected.value) || 0;
        }
    } else {
        task.reminder = 0;
    }
    
    // 处理重复
    const repeatSelected = document.querySelector('input[name="detail-repeat"]:checked');
    if (repeatSelected && repeatSelected.value && repeatSelected.value !== '') {
        const repeatModeSelected = document.querySelector('input[name="detail-repeat-mode"]:checked');
        const repeatMode = repeatModeSelected ? repeatModeSelected.value : 'startTime';
        if (repeatSelected.value === 'custom') {
            const interval = parseInt(document.getElementById('detail-custom-repeat-interval').value);
            const unit = document.getElementById('detail-custom-repeat-unit').value;
            if (interval && interval > 0) {
                task.repeat = { type: 'custom', interval: interval, unit: unit, repeatMode: repeatMode };
            } else {
                task.repeat = null;
            }
        } else {
            const propsAttr = repeatSelected.getAttribute('data-repeat-props');
            if (propsAttr) {
                try {
                    const props = JSON.parse(propsAttr);
                    task.repeat = Object.assign({}, props, { repeatMode: repeatMode });
                } catch (e) {
                    task.repeat = { type: repeatSelected.value, repeatMode: repeatMode };
                }
            } else {
                task.repeat = { type: repeatSelected.value, repeatMode: repeatMode };
            }
        }
    } else {
        task.repeat = null;
    }
    
    // 处理时间
    const dateValue = document.getElementById('detail-task-date').value;
    const timeValue = document.getElementById('detail-task-time').value;
    const isAllDay = !timeValue;
    
    if (dateValue && timeValue && !isAllDay) {
        task.startTime = new Date(`${dateValue}T${timeValue}`).toISOString();
        task.isAllDay = false;
    } else if (dateValue) {
        task.startTime = new Date(dateValue + 'T00:00:00').toISOString();
        task.isAllDay = true;
    } else {
        delete task.startTime;
        task.isAllDay = false;
    }
    
    if (isTimeRangeMode) {
        const endDateValue = document.getElementById('detail-task-end-date').value;
        const endTimeValue = document.getElementById('detail-task-end-time').value;
        
        if (endDateValue && endTimeValue && !isAllDay) {
            task.endTime = new Date(`${endDateValue}T${endTimeValue}`).toISOString();
        } else if (endDateValue) {
            task.endTime = new Date(endDateValue + 'T00:00:00').toISOString();
        } else {
            delete task.endTime;
        }
    } else {
        delete task.endTime;
    }
    
    if (task.endTime && task.startTime && new Date(task.endTime) < new Date(task.startTime)) {
        showToast('结束时间不能早于开始时间', 'warning');
        return false;
    }
    
    saveData();
    renderView();
    if (typeof renderTags === 'function') renderTags();
    if (typeof renderLists === 'function') renderLists();
    document.getElementById('task-detail-panel').classList.add('hidden');
    currentDetailTaskId = null;
    detailOpenedFromPlan = false;
    if (planPanelOpen) renderPlanPanel();

    // 修改日期可能导致今日任务清空，检查并触发"落日归山"彩蛋
    if (beforeTodayIncomplete > 0 && typeof ee_checkSunsetHorizon === 'function') {
        ee_checkSunsetHorizon();
    }
    return true;
}

let detailImportantState = false;
let detailUrgentState = false;

let planPanelOpen = false;
let detailOpenedFromPlan = false;

function togglePlanPanel() {
    const panel = document.getElementById('plan-panel');
    if (planPanelOpen) {
        closePlanPanel();
    } else {
        panel.classList.remove('hidden');
        planPanelOpen = true;
        renderPlanPanel();
    }
}

function closePlanPanel() {
    const panel = document.getElementById('plan-panel');
    if (panel) {
        panel.classList.add('hidden');
    }
    planPanelOpen = false;
    detailOpenedFromPlan = false;
}

function renderPlanPanel() {
    const container = document.getElementById('plan-panel-content');
    if (!container) return;

    const filtered = filterTasks(tasks);
    const groups = {
        overdue: { label: '已过期', tasks: [] },
        nodate: { label: '无日期', tasks: [] },
        today: { label: '今天', tasks: [] },
        tomorrow: { label: '明天', tasks: [] },
        recent7: { label: '最近7天', tasks: [] },
        later: { label: '更远', tasks: [] }
    };

    filtered.forEach(task => {
        if (task.completed) return;
        const group = getTaskListGroup(task);
        if (groups[group]) groups[group].tasks.push(task);
    });

    groups.overdue.tasks.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    groups.nodate.tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    groups.today.tasks.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    groups.tomorrow.tasks.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    groups.recent7.tasks.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    groups.later.tasks.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    const groupOrder = ['overdue', 'nodate', 'today', 'tomorrow', 'recent7', 'later'];
    const hasAnyTasks = groupOrder.some(g => groups[g].tasks.length > 0);

    if (!hasAnyTasks) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-theme-muted">
                <i class="fas fa-clipboard-check text-4xl mb-3 opacity-30"></i>
                <p class="text-sm">暂无需要计划的任务</p>
            </div>
        `;
        return;
    }

    let html = '';
    groupOrder.forEach(groupKey => {
        const group = groups[groupKey];
        if (group.tasks.length === 0) return;

        html += `
            <div class="mb-5">
                <div class="flex items-center gap-2 mb-2">
                    <h4 class="text-sm font-semibold ${groupKey === 'overdue' ? 'text-red-500' : 'text-theme-primary'}">${group.label}</h4>
                    <span class="text-xs text-theme-muted">(${group.tasks.length})</span>
                </div>
        `;

        group.tasks.forEach(task => {
            const list = lists.find(l => l.id === task.listId);
            const listColor = list ? list.color : '#9ca3af';
            const listName = list ? list.name : '';
            const quadColors = getQuadrantColorClass(task);
            const timeDisplay = task.startTime ? formatTaskListTime(task) : '';

            html += `
                <div class="plan-task-item flex items-center gap-2 py-2 px-2.5 rounded-r-lg ${quadColors.bg} hover:brightness-95 transition cursor-pointer group mb-1"
                     draggable="true"
                     ondragstart="handleTaskDragStart(event, '${task.id}')"
                     ondragend="handlePlanDragEnd(event)"
                     onclick="event.stopPropagation(); detailOpenedFromPlan=true; openTaskDetailPanel('${task.id}')"
                     style="border-left: 3px solid ${listColor}; overflow: hidden;">
                    <span class="flex-1 text-sm text-theme-primary truncate min-w-0 group-hover:text-blue-500 transition-colors duration-150">${task.title || '新任务'}</span>
                    <div class="flex items-center gap-1.5 flex-shrink-0 text-xs text-theme-secondary whitespace-nowrap">
                        ${listName ? `<span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background-color: ${listColor}"></span></span>` : ''}
                        ${timeDisplay ? `<span><i class="fas fa-clock mr-0.5"></i>${timeDisplay}</span>` : ''}
                    </div>
                </div>
            `;
        });

        html += '</div>';
    });

    container.innerHTML = html;
}

function handlePlanDragEnd(event) {
    document.querySelectorAll('.dragging, .drag-over').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
    draggedTaskId = null;
    if (planPanelOpen) {
        setTimeout(() => renderPlanPanel(), 100);
    }
}

function clearTaskTime() {
    if (!currentDetailTaskId) return;
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    delete task.startTime;
    delete task.endTime;
    task.isAllDay = false;
    task.reminder = 0;
    saveData();
    openTaskDetailPanel(task.id);
    renderView();
}

function toggleDetailTimeMenu() {
    const menu = document.getElementById('detail-time-menu');
    menu.classList.toggle('hidden');
}

function toggleDetailListPicker() {
    const picker = document.getElementById('detail-list-picker');
    if (picker.classList.contains('hidden')) {
        // 关闭标签选择器
        document.getElementById('detail-tag-picker').classList.add('hidden');
        picker.classList.remove('hidden');
    } else {
        picker.classList.add('hidden');
    }
}

function updateDetailTimeBtnText() {
    const dateValue = document.getElementById('detail-task-date').value;
    const timeValue = document.getElementById('detail-task-time').value;
    const isAllDay = !timeValue;
    const btnText = document.getElementById('detail-time-btn-text');
    
    if (dateValue) {
        const date = new Date(dateValue);
        const dateStr = `${date.getMonth() + 1}月${date.getDate()}日`;
        if (isAllDay) {
            const isRange = !document.getElementById('detail-end-time-container').classList.contains('hidden');
            if (isRange) {
                const endDateValue = document.getElementById('detail-task-end-date').value;
                if (endDateValue && endDateValue !== dateValue) {
                    const endDate = new Date(endDateValue);
                    btnText.textContent = dateStr + ' - ' + `${endDate.getMonth() + 1}月${endDate.getDate()}日` + ' (全天)';
                } else {
                    btnText.textContent = dateStr + ' (全天)';
                }
            } else {
                btnText.textContent = dateStr + ' (全天)';
            }
        } else if (timeValue) {
            const isRange = !document.getElementById('detail-end-time-container').classList.contains('hidden');
            if (isRange) {
                const endDateValue = document.getElementById('detail-task-end-date').value;
                const endTimeValue = document.getElementById('detail-task-end-time').value;
                let endStr = '';
                if (endDateValue) {
                    const endDate = new Date(endDateValue);
                    const sameDay = dateValue === endDateValue;
                    if (sameDay) {
                        endStr = endTimeValue || '';
                    } else {
                        endStr = `${endDate.getMonth() + 1}月${endDate.getDate()}日`;
                        if (endTimeValue) {
                            endStr += ' ' + endTimeValue;
                        }
                    }
                }
                btnText.textContent = dateStr + ' ' + timeValue + ' - ' + (endStr || '...');
            } else {
                btnText.textContent = dateStr + ' ' + timeValue;
            }
        } else {
            btnText.textContent = dateStr;
        }
    } else {
        btnText.textContent = '设置时间';
    }
}

function updateDetailListBtnText() {
    const listIcon = document.getElementById('detail-list-icon');
    const listNameEl = document.getElementById('detail-list-name');
    const selectedList = lists.find(l => l.id === detailSelectedListId);
    if (selectedList) {
        if (listIcon && selectedList.color) {
            listIcon.style.color = selectedList.color;
        }
        if (listNameEl) {
            listNameEl.textContent = selectedList.name;
        }
    } else {
        if (listNameEl) {
            listNameEl.textContent = '';
        }
    }
}

function toggleDetailImportant() {
    detailImportantState = !detailImportantState;
    updateDetailPriorityButtons();
}

function toggleDetailUrgent() {
    detailUrgentState = !detailUrgentState;
    updateDetailPriorityButtons();
}

function updateDetailPriorityButtons() {
    const importantBtn = document.getElementById('detail-task-important');
    const urgentBtn = document.getElementById('detail-task-urgent');
    if (importantBtn) {
        if (detailImportantState) {
            importantBtn.style.cssText = 'background-color: rgba(234, 179, 8, 0.15); border-color: #eab308; color: #eab308;';
        } else {
            importantBtn.style.cssText = '';
        }
    }
    if (urgentBtn) {
        if (detailUrgentState) {
            urgentBtn.style.cssText = 'background-color: rgba(239, 68, 68, 0.15); border-color: #ef4444; color: #ef4444;';
        } else {
            urgentBtn.style.cssText = '';
        }
    }
}

function toggleDetailReminderPicker() {
    const picker = document.getElementById('detail-reminder-picker');
    picker.classList.toggle('hidden');
}

function openTimePicker(inputEl, pickerId) {
    const picker = document.getElementById(pickerId);
    if (!picker) return;

    document.querySelectorAll('.time-picker-dropdown').forEach(p => {
        if (p.id !== pickerId) p.classList.add('hidden');
    });
    // 同时关闭日期选择器
    document.querySelectorAll('.date-picker-dropdown').forEach(p => {
        p.classList.add('hidden');
    });

    if (!picker.classList.contains('hidden')) return;

    picker.innerHTML = '';
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    let nextSlotMinute = Math.ceil(currentMinute / 15) * 15;
    let nextSlotHour = currentHour;
    if (nextSlotMinute >= 60) {
        nextSlotMinute = 0;
        nextSlotHour++;
    }
    if (nextSlotHour >= 24) {
        nextSlotHour = 0;
    }

    const currentValue = inputEl.value;
    let scrollToValue = null;
    if (currentValue) {
        scrollToValue = currentValue;
    } else {
        scrollToValue = `${String(nextSlotHour).padStart(2, '0')}:${String(nextSlotMinute).padStart(2, '0')}`;
    }

    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 15) {
            const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            const item = document.createElement('div');
            item.className = 'px-3 py-1.5 text-sm cursor-pointer text-theme-secondary hover:bg-theme-secondary hover:text-theme-primary transition';
            item.textContent = timeStr;
            item.dataset.value = timeStr;
            item.onclick = (e) => {
                e.stopPropagation();
                inputEl.value = timeStr;
                picker.classList.add('hidden');
                inputEl.dispatchEvent(new Event('change'));
                onDetailAllDayChange();
            };
            picker.appendChild(item);
        }
    }

    picker.classList.remove('hidden');
    picker.classList.add('time-picker-dropdown');

    requestAnimationFrame(() => {
        const targetItem = picker.querySelector(`[data-value="${scrollToValue}"]`);
        if (targetItem) {
            targetItem.scrollIntoView({ block: 'center' });
        }
    });
}

function openDatePicker(inputEl, pickerId) {
    const picker = document.getElementById(pickerId);
    if (!picker) return;

    document.querySelectorAll('.date-picker-dropdown').forEach(p => {
        if (p.id !== pickerId) p.classList.add('hidden');
    });
    // 同时关闭时间选择器
    document.querySelectorAll('.time-picker-dropdown').forEach(p => {
        p.classList.add('hidden');
    });

    if (!picker.classList.contains('hidden')) {
        picker.classList.add('hidden');
        return;
    }

    picker.innerHTML = '';
    const now = new Date();
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const currentDay = now.getDay(); // 0=周日, 1=周一, ...

    function formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function addDateOption(label, date) {
        const dateStr = formatDate(date);
        const item = document.createElement('div');
        item.className = 'px-3 py-1.5 text-sm cursor-pointer text-theme-secondary hover:bg-theme-secondary hover:text-theme-primary transition flex justify-between items-center';
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        const dateSpan = document.createElement('span');
        dateSpan.className = 'text-xs opacity-60';
        dateSpan.textContent = dateStr;
        item.appendChild(labelSpan);
        item.appendChild(dateSpan);
        item.dataset.value = dateStr;
        item.onclick = (e) => {
            e.stopPropagation();
            inputEl.value = dateStr;
            picker.classList.add('hidden');
            inputEl.dispatchEvent(new Event('change'));
            onDetailAllDayChange();
        };
        picker.appendChild(item);
    }

    // 1. 今天
    addDateOption('今天', now);

    // 2. 明天
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    addDateOption('明天', tomorrow);

    // 3. 本周/下周最后一个工作日（根据调休日历计算）
    const shortDayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const weekStartsOnMonday = settings.weekStart === 'monday';
    const currentWeekStart = getWeekStartDate(now, weekStartsOnMonday);
    const thisWeekLastWorkday = findLastWorkdayOfWeek(currentWeekStart, weekStartsOnMonday);
    let lastWorkdayDate = null;
    let lastWorkdayLabel = '';
    if (thisWeekLastWorkday && thisWeekLastWorkday >= now) {
        lastWorkdayDate = thisWeekLastWorkday;
        lastWorkdayLabel = '本周' + shortDayNames[thisWeekLastWorkday.getDay()];
        addDateOption(lastWorkdayLabel, thisWeekLastWorkday);
    } else {
        const nextWeekStart = new Date(currentWeekStart);
        nextWeekStart.setDate(nextWeekStart.getDate() + 7);
        const nextWeekLastWorkday = findLastWorkdayOfWeek(nextWeekStart, weekStartsOnMonday);
        if (nextWeekLastWorkday) {
            lastWorkdayDate = nextWeekLastWorkday;
            lastWorkdayLabel = '下周' + shortDayNames[nextWeekLastWorkday.getDay()];
            addDateOption(lastWorkdayLabel, nextWeekLastWorkday);
        }
    }

    // 4. 下周一
    const daysUntilNextMonday = (8 - currentDay) % 7 || 7;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilNextMonday);
    addDateOption('下周一', nextMonday);

    // 5. 下周X（当天星期数，如果今天是周一则隐藏；与第3项去重）
    if (currentDay !== 1) {
        const nextWeekSameDay = new Date(now);
        nextWeekSameDay.setDate(now.getDate() + 7);
        const nextWeekSameDayStr = formatDate(nextWeekSameDay);
        // 如果第3项的日期与此项相同，则跳过（去重）
        if (!lastWorkdayDate || formatDate(lastWorkdayDate) !== nextWeekSameDayStr) {
            addDateOption('下周' + shortDayNames[currentDay], nextWeekSameDay);
        }
    }

    // 6. 下月1日
    const nextMonth1st = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    addDateOption('下月1日', nextMonth1st);

    // 7. 下月X日（X为当天日期，处理月末特殊情况）
    const todayDate = now.getDate();
    const nextMonth = now.getMonth() + 1;
    const nextMonthYear = now.getFullYear() + (nextMonth > 11 ? 1 : 0);
    const nextMonthIndex = nextMonth > 11 ? 0 : nextMonth;
    // 获取下个月的最后一天
    const lastDayOfNextMonth = new Date(nextMonthYear, nextMonthIndex + 1, 0).getDate();
    const actualDay = Math.min(todayDate, lastDayOfNextMonth);
    const nextMonthSameDate = new Date(nextMonthYear, nextMonthIndex, actualDay);
    const dayLabel = actualDay !== todayDate
        ? `下月${actualDay}日`
        : `下月${todayDate}日`;
    addDateOption(dayLabel, nextMonthSameDate);

    picker.classList.remove('hidden');
    picker.classList.add('date-picker-dropdown');

    // 滚动到当前选中的日期
    requestAnimationFrame(() => {
        const currentValue = inputEl.value;
        if (currentValue) {
            const targetItem = picker.querySelector(`[data-value="${currentValue}"]`);
            if (targetItem) {
                targetItem.scrollIntoView({ block: 'center' });
            }
        }
    });
}

function closeAllTimePickers() {
    document.querySelectorAll('.time-picker-dropdown').forEach(p => {
        p.classList.add('hidden');
    });
    document.querySelectorAll('.date-picker-dropdown').forEach(p => {
        p.classList.add('hidden');
    });
}

function toggleDetailRepeatPicker() {
    const picker = document.getElementById('detail-repeat-picker');
    picker.classList.toggle('hidden');
}

function toggleRepeatSubmenu(el) {
    const group = el.closest('.repeat-group');
    if (!group) return;
    const submenu = group.querySelector('.repeat-submenu');
    const arrow = group.querySelector('.repeat-submenu-arrow');
    if (submenu) {
        submenu.classList.toggle('hidden');
        if (arrow) {
            if (submenu.classList.contains('hidden')) {
                arrow.style.transform = '';
            } else {
                arrow.style.transform = 'rotate(90deg)';
            }
        }
    }
}

function updateDetailReminderText() {
    const selected = document.querySelector('input[name="detail-reminder"]:checked');
    const reminderText = document.getElementById('detail-reminder-text');
    const customInput = document.getElementById('detail-custom-reminder');
    
    if (selected) {
        switch (selected.value) {
            case '0':
                reminderText.textContent = '不提醒';
                customInput.classList.add('hidden');
                break;
            case '5':
                reminderText.textContent = '提前5分钟';
                customInput.classList.add('hidden');
                break;
            case '1440':
                reminderText.textContent = '提前1天';
                customInput.classList.add('hidden');
                break;
            case 'custom':
                reminderText.textContent = '自定义';
                customInput.classList.remove('hidden');
                const customValue = customInput.value;
                if (customValue) {
                    reminderText.textContent = `提前${customValue}分钟`;
                }
                break;
            default:
                reminderText.textContent = '不提醒';
        }
    }
}

function updateDetailRepeatText() {
    const selected = document.querySelector('input[name="detail-repeat"]:checked');
    const repeatText = document.getElementById('detail-repeat-text');
    const customContainer = document.getElementById('detail-custom-repeat-container');
    const modeContainer = document.getElementById('detail-repeat-mode-container');
    
    if (selected) {
        customContainer.classList.add('hidden');
        const val = selected.value;
        if (!val || val === '') {
            repeatText.textContent = '不重复';
        } else if (val === 'daily') {
            repeatText.textContent = '每天';
        } else if (val === 'dailyWorkday') {
            repeatText.textContent = '每个工作日';
        } else if (val === 'weekly') {
            repeatText.textContent = '每周';
        } else if (val === 'weeklyFirstWorkday') {
            repeatText.textContent = '每周首个工作日';
        } else if (val === 'weeklyLastWorkday') {
            repeatText.textContent = '每周最后一个工作日';
        } else if (val === 'monthly') {
            repeatText.textContent = '每月';
        } else if (val === 'monthlyFirstWorkday') {
            repeatText.textContent = '每月首个工作日';
        } else if (val === 'monthlyLastWorkday') {
            repeatText.textContent = '每月最后一个工作日';
        } else if (val === 'yearly') {
            repeatText.textContent = '每年';
        } else if (val === 'yearlyBeforeHoliday') {
            repeatText.textContent = '每个节假日前一天';
        } else if (val === 'custom') {
            repeatText.textContent = '自定义';
            customContainer.classList.remove('hidden');
            const interval = document.getElementById('detail-custom-repeat-interval').value;
            const unit = document.getElementById('detail-custom-repeat-unit').value;
            if (interval) {
                const unitName = { 'days': '天', 'weeks': '周', 'months': '月', 'years': '年' };
                repeatText.textContent = `每${interval}${unitName[unit]}`;
            }
        } else {
            repeatText.textContent = '不重复';
        }
    }
}

let deleteDetailConfirming = false;

function deleteTaskFromDetail() {
    if (!currentDetailTaskId) return;
    
    if (deleteDetailConfirming) {
        // 彩蛋：断舍离检测（在DOM移除前获取位置）
        const taskEl = document.querySelector(`[onclick*="toggleTaskComplete('${currentDetailTaskId}')"]`) ||
                       document.querySelector(`[onclick*="openTaskDetailPanel('${currentDetailTaskId}')"]`);
        easterEgg_onTaskDelete(taskEl);

        tasks = tasks.filter(t => t.id !== currentDetailTaskId);
        saveData();
        document.getElementById('task-detail-panel').classList.add('hidden');
        currentDetailTaskId = null;
        detailOpenedFromPlan = false;
        deleteDetailConfirming = false;
        renderLists();
        renderView();
        showToast('任务已删除', 'success');
        return;
    }
    
    deleteDetailConfirming = true;
    const btn = document.getElementById('detail-delete-btn');
    if (btn) {
        btn.textContent = '确认删除';
        btn.style.cssText = 'flex: 1 1 0%; padding: 0.5rem 1rem; background-color: #dc2626 !important; color: #ffffff !important; border: none !important; border-radius: 0.5rem; cursor: pointer; transition: all 0.15s;';
    }
    
    setTimeout(() => {
        deleteDetailConfirming = false;
        if (btn) {
            btn.textContent = '删除任务';
            btn.style.cssText = '';
        }
    }, 3000);
}

function closeDetailPickers() {
    const reminderPicker = document.getElementById('detail-reminder-picker');
    const repeatPicker = document.getElementById('detail-repeat-picker');
    let changed = false;
    
    if (reminderPicker && !reminderPicker.classList.contains('hidden')) {
        reminderPicker.classList.add('hidden');
        changed = true;
    }
    if (repeatPicker && !repeatPicker.classList.contains('hidden')) {
        repeatPicker.classList.add('hidden');
        changed = true;
    }
    closeAllTimePickers();
    
    if (changed) {
        saveTaskDetailWithoutClose();
    }
}

function saveTaskDetailWithoutClose() {
    if (!currentDetailTaskId) return;

    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;

    const task = tasks[taskIndex];
    // 记录修改前今日未完成任务数（用于检测是否因修改日期清空今日任务）
    const beforeTodayIncomplete = (typeof ee_countTodayIncomplete === 'function') ? ee_countTodayIncomplete() : -1;

    const titleValue = document.getElementById('detail-task-title').value;
    if (titleValue && titleValue.trim()) {
        task.title = titleValue;
    }
    
    task.mode = currentTaskMode;
    
    if (currentTaskMode === 'text') {
        task.notes = document.getElementById('detail-task-notes').value;
    } else {
        if (task.subtasks && task.subtasks.length > 0) {
            const sorted = [...task.subtasks].sort((a, b) => {
                if (!a.completed && b.completed) return -1;
                if (a.completed && !b.completed) return 1;
                return (a.originalOrder || 0) - (b.originalOrder || 0);
            });
            task.notes = sorted.map(st => st.text).join('\n');
        }
    }
    
    task.listId = detailSelectedListId;
    task.important = detailImportantState;
    task.urgent = detailUrgentState;
    
    const reminderSelected = document.querySelector('input[name="detail-reminder"]:checked');
    if (reminderSelected) {
        if (reminderSelected.value === '0') {
            task.reminder = 0;
        } else if (reminderSelected.value === 'custom') {
            const customVal = parseInt(document.getElementById('detail-custom-reminder').value);
            task.reminder = customVal > 0 ? customVal : 0;
        } else {
            task.reminder = parseInt(reminderSelected.value) || 0;
        }
    } else {
        task.reminder = 0;
    }
    
    const repeatSelected = document.querySelector('input[name="detail-repeat"]:checked');
    if (repeatSelected && repeatSelected.value && repeatSelected.value !== '') {
        const repeatModeSelected = document.querySelector('input[name="detail-repeat-mode"]:checked');
        const repeatMode = repeatModeSelected ? repeatModeSelected.value : 'startTime';
        if (repeatSelected.value === 'custom') {
            const interval = parseInt(document.getElementById('detail-custom-repeat-interval').value);
            const unit = document.getElementById('detail-custom-repeat-unit').value;
            if (interval && interval > 0) {
                task.repeat = { type: 'custom', interval: interval, unit: unit, repeatMode: repeatMode };
            } else {
                task.repeat = null;
            }
        } else {
            const propsAttr = repeatSelected.getAttribute('data-repeat-props');
            if (propsAttr) {
                try {
                    const props = JSON.parse(propsAttr);
                    task.repeat = Object.assign({}, props, { repeatMode: repeatMode });
                } catch (e) {
                    task.repeat = { type: repeatSelected.value, repeatMode: repeatMode };
                }
            } else {
                task.repeat = { type: repeatSelected.value, repeatMode: repeatMode };
            }
        }
    } else {
        task.repeat = null;
    }
    
    const dateValue = document.getElementById('detail-task-date').value;
    const timeValue = document.getElementById('detail-task-time').value;
    const isAllDay = !timeValue;
    
    if (dateValue && timeValue && !isAllDay) {
        task.startTime = new Date(`${dateValue}T${timeValue}`).toISOString();
        task.isAllDay = false;
    } else if (dateValue) {
        task.startTime = new Date(dateValue + 'T00:00:00').toISOString();
        task.isAllDay = true;
    } else {
        delete task.startTime;
        task.isAllDay = false;
    }
    
    if (isTimeRangeMode) {
        const endDateValue = document.getElementById('detail-task-end-date').value;
        const endTimeValue = document.getElementById('detail-task-end-time').value;
        if (endDateValue && endTimeValue && !isAllDay) {
            task.endTime = new Date(`${endDateValue}T${endTimeValue}`).toISOString();
        } else if (endDateValue) {
            task.endTime = new Date(endDateValue + 'T00:00:00').toISOString();
        } else {
            delete task.endTime;
        }
    } else {
        delete task.endTime;
    }
    
    if (task.endTime && task.startTime && new Date(task.endTime) < new Date(task.startTime)) {
        return;
    }
    
    saveData();
    renderView();
    if (typeof renderTags === 'function') renderTags();
    if (typeof renderLists === 'function') renderLists();

    // 修改日期可能导致今日任务清空，检查并触发"落日归山"彩蛋
    if (beforeTodayIncomplete > 0 && typeof ee_checkSunsetHorizon === 'function') {
        ee_checkSunsetHorizon();
    }
}

function setupDetailPickerCloseHandler() {
    // 点击任务详情面板内非选择器区域时，关闭清单/标签选择器
    const detailPanel = document.getElementById('task-detail-panel');
    if (detailPanel) {
        detailPanel.addEventListener('click', (e) => {
            const listPicker = document.getElementById('detail-list-picker');
            const tagPicker = document.getElementById('detail-tag-picker');
            const hasOpen = (listPicker && !listPicker.classList.contains('hidden')) ||
                            (tagPicker && !tagPicker.classList.contains('hidden'));
            if (!hasOpen) return;
            
            // 点击在选择器内部不关闭
            if (e.target.closest('#detail-list-picker') || e.target.closest('#detail-tag-picker')) return;
            // 点击切换按钮不关闭（由按钮自己处理）
            if (e.target.closest('button[onclick*="toggleDetailListPicker"]') || e.target.closest('button[onclick*="toggleDetailTagPicker"]')) return;
            
            if (listPicker) listPicker.classList.add('hidden');
            if (tagPicker) tagPicker.classList.add('hidden');
        });
    }
    
    document.addEventListener('click', (e) => {
        const reminderPicker = document.getElementById('detail-reminder-picker');
        const repeatPicker = document.getElementById('detail-repeat-picker');
        const timePickers = document.querySelectorAll('.time-picker-dropdown:not(.hidden)');
        const datePickers = document.querySelectorAll('.date-picker-dropdown:not(.hidden)');
        const hasOpenPicker = (reminderPicker && !reminderPicker.classList.contains('hidden')) ||
                              (repeatPicker && !repeatPicker.classList.contains('hidden')) ||
                              timePickers.length > 0 ||
                              datePickers.length > 0;
        if (!hasOpenPicker) return;

        const clickedInsidePicker = e.target.closest('#detail-reminder-picker') ||
                                     e.target.closest('#detail-repeat-picker') ||
                                     e.target.closest('.time-picker-dropdown') ||
                                     e.target.closest('.date-picker-dropdown');
        const clickedReminderBtn = e.target.closest('button[onclick*="toggleDetailReminderPicker"]');
        const clickedRepeatBtn = e.target.closest('button[onclick*="toggleDetailRepeatPicker"]');
        const clickedTimeInput = e.target.closest('input[onclick*="openTimePicker"]');
        const clickedDateInput = e.target.closest('input[onclick*="openDatePicker"]');

        if (clickedInsidePicker) return;

        if (clickedReminderBtn) {
            if (repeatPicker && !repeatPicker.classList.contains('hidden')) {
                repeatPicker.classList.add('hidden');
            }
            closeAllTimePickers();
            return;
        }

        if (clickedRepeatBtn) {
            if (reminderPicker && !reminderPicker.classList.contains('hidden')) {
                reminderPicker.classList.add('hidden');
            }
            closeAllTimePickers();
            return;
        }

        if (clickedTimeInput) {
            if (reminderPicker && !reminderPicker.classList.contains('hidden')) {
                reminderPicker.classList.add('hidden');
            }
            if (repeatPicker && !repeatPicker.classList.contains('hidden')) {
                repeatPicker.classList.add('hidden');
            }
            return;
        }

        if (clickedDateInput) {
            if (reminderPicker && !reminderPicker.classList.contains('hidden')) {
                reminderPicker.classList.add('hidden');
            }
            if (repeatPicker && !repeatPicker.classList.contains('hidden')) {
                repeatPicker.classList.add('hidden');
            }
            return;
        }

        closeDetailPickers();
    });
}

function setupDetailPanelCloseHandler() {
    document.addEventListener('click', (e) => {
        const reminderPicker = document.getElementById('detail-reminder-picker');
        const repeatPicker = document.getElementById('detail-repeat-picker');
        const timePickers = document.querySelectorAll('.time-picker-dropdown:not(.hidden)');
        const datePickers = document.querySelectorAll('.date-picker-dropdown:not(.hidden)');
        const hasOpenPicker = (reminderPicker && !reminderPicker.classList.contains('hidden')) ||
                              (repeatPicker && !repeatPicker.classList.contains('hidden')) ||
                              timePickers.length > 0 ||
                              datePickers.length > 0;
        
        if (hasOpenPicker && e.target.closest('#task-detail-panel')) {
            return;
        }
        
        if (e.target.closest('#task-detail-panel')) {
            return;
        }
        
        if (e.target.closest('button')) {
            return;
        }
        
        if (e.target.closest('input') || e.target.closest('textarea') || e.target.closest('select')) {
            return;
        }
        
        const detailPanel = document.getElementById('task-detail-panel');
        const detailHidden = detailPanel && detailPanel.classList.contains('hidden');
        
        if (e.target.closest('.plan-task-item')) {
            return;
        }
        
        if (e.target.closest('#plan-panel')) {
            if (!detailHidden) {
                closeTaskDetailPanel();
            }
            return;
        }
        
        if (!detailHidden) {
            closeTaskDetailPanel();
        }
        if (planPanelOpen) {
            closePlanPanel();
        }
    });
}

function initScrollbarHandler() {
    let scrollTimers = new WeakMap();
    
    document.addEventListener('scroll', (e) => {
        const target = e.target;
        if (target === document) return;
        if (target.scrollHeight <= target.clientHeight) return;
        
        target.classList.add('scrollbar-visible');
        
        if (scrollTimers.has(target)) {
            clearTimeout(scrollTimers.get(target));
        }
        scrollTimers.set(target, setTimeout(() => {
            target.classList.remove('scrollbar-visible');
            scrollTimers.delete(target);
        }, 1000));
    }, true);
}

function initTaskTitleHandler() {
    const titleInput = document.getElementById('task-title');
    if (titleInput) {
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                const detailsSection = document.getElementById('task-details-section');
                if (detailsSection.classList.contains('hidden')) {
                    detailsSection.classList.remove('hidden');
                    setTimeout(() => {
                        document.getElementById('task-notes').focus();
                    }, 100);
                }
            }
        });
    }
}

// 切换选择器
function toggleTimePicker() {
    const picker = document.getElementById('time-picker');
    picker.classList.toggle('hidden');
    document.getElementById('priority-picker').classList.add('hidden');
    document.getElementById('list-picker').classList.add('hidden');
}

function toggleImportantUrgent() {
    const picker = document.getElementById('priority-picker');
    picker.classList.toggle('hidden');
    document.getElementById('time-picker').classList.add('hidden');
    document.getElementById('list-picker').classList.add('hidden');
}

function toggleListPicker() {
    const picker = document.getElementById('list-picker');
    picker.classList.toggle('hidden');
    document.getElementById('time-picker').classList.add('hidden');
    document.getElementById('priority-picker').classList.add('hidden');
}

function toggleReminderPicker() {
    const picker = document.getElementById('reminder-picker');
    picker.classList.toggle('hidden');
}

function toggleRepeatPicker() {
    const picker = document.getElementById('repeat-picker');
    picker.classList.toggle('hidden');
}

function updateReminderText() {
    const selected = document.querySelector('input[name="reminder"]:checked');
    const reminderText = document.getElementById('reminder-text');
    const customInput = document.getElementById('custom-reminder');
    
    if (selected) {
        switch (selected.value) {
            case '5':
                reminderText.textContent = '提前5分钟';
                break;
            case '1440':
                reminderText.textContent = '提前1天';
                break;
            case 'custom':
                reminderText.textContent = '自定义';
                customInput.classList.remove('hidden');
                const customValue = customInput.value;
                if (customValue) {
                    reminderText.textContent = `提前${customValue}分钟`;
                }
                break;
            default:
                reminderText.textContent = '提醒';
        }
    }
}

// 更新重复按钮文本
function updateRepeatText() {
    const selected = document.querySelector('input[name="repeat"]:checked');
    const repeatText = document.getElementById('repeat-text');
    const customContainer = document.getElementById('custom-repeat-container');
    
    if (selected) {
        switch (selected.value) {
            case '':
                repeatText.textContent = '重复';
                customContainer.classList.add('hidden');
                break;
            case 'daily':
                repeatText.textContent = '每天';
                break;
            case 'weekly':
                repeatText.textContent = '每周';
                break;
            case 'monthly':
                repeatText.textContent = '每月';
                break;
            case 'yearly':
                repeatText.textContent = '每年';
                break;
            case 'custom':
                repeatText.textContent = '自定义';
                customContainer.classList.remove('hidden');
                const interval = document.getElementById('custom-repeat-interval').value;
                const unit = document.getElementById('custom-repeat-unit').value;
                if (interval) {
                    const unitName = {
                        'days': '天',
                        'weeks': '周',
                        'months': '月',
                        'years': '年'
                    };
                    repeatText.textContent = `每${interval}${unitName[unit]}`;
                }
                break;
            default:
                repeatText.textContent = '重复';
        }
    }
}

function getReminderValueFromForm() {
    const selected = document.querySelector('input[name="reminder"]:checked');
    if (!selected) return 0;
    if (selected.value === 'custom') {
        const customVal = parseInt(document.getElementById('custom-reminder').value);
        return customVal > 0 ? customVal : 0;
    }
    return parseInt(selected.value) || 0;
}

function getRepeatValueFromForm() {
    const selected = document.querySelector('input[name="repeat"]:checked');
    if (!selected) return null;
    if (selected.value === '' || selected.value === undefined) return null;
    if (selected.value === 'custom') {
        const interval = parseInt(document.getElementById('custom-repeat-interval').value);
        const unit = document.getElementById('custom-repeat-unit').value;
        if (!interval || interval <= 0) return null;
        return { type: 'custom', interval: interval, unit: unit };
    }
    return { type: selected.value };
}

let calendarMonth = new Date();

function initCalendar(date = new Date()) {
    calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    renderCalendar();
}

function renderCalendar() {
    const container = document.getElementById('calendar-container');
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date();
    
    const dayOffset = settings.weekStart === 'monday' ? 1 : 0;
    let startOffset = firstDay.getDay() - dayOffset;
    if (startOffset < 0) startOffset += 7;
    
    let html = `
        <div class="col-span-7 flex items-center justify-between mb-2">
            <button onclick="prevCalendarMonth()" class="p-1 hover:bg-gray-200 rounded text-theme-secondary">
                <i class="fas fa-chevron-left"></i>
            </button>
            <span class="font-medium text-theme-primary">${year}年${month + 1}月</span>
            <button onclick="nextCalendarMonth()" class="p-1 hover:bg-gray-200 rounded text-theme-secondary">
                <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;
    
    const weekdays = settings.weekStart === 'monday' ? ['一', '二', '三', '四', '五', '六', '日'] : ['日', '一', '二', '三', '四', '五', '六'];
    weekdays.forEach(d => {
        html += `<div class="text-center text-xs text-theme-muted py-1">${d}</div>`;
    });
    
    for (let i = startOffset - 1; i >= 0; i--) {
        html += `<div class="calendar-day disabled opacity-40"></div>`;
    }
    
    const selectedDate = document.getElementById('task-selected-date')?.value;
    
    for (let i = 1; i <= lastDay.getDate(); i++) {
        const date = new Date(year, month, i);
        const dateStr = formatDate(date);
        const isToday = isSameDay(date, today);
        const isSelected = dateStr === selectedDate;
        
        html += `
            <div class="calendar-day text-center py-2 rounded cursor-pointer text-theme-primary ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" 
                 data-date="${dateStr}"
                 onclick="selectCalendarDate('${dateStr}')">
                ${i}
            </div>
        `;
    }
    
    container.innerHTML = html;
}

function prevCalendarMonth() {
    calendarMonth.setMonth(calendarMonth.getMonth() - 1);
    renderCalendar();
}

function nextCalendarMonth() {
    calendarMonth.setMonth(calendarMonth.getMonth() + 1);
    renderCalendar();
}

function selectCalendarDate(dateStr) {
    document.getElementById('task-selected-date').value = dateStr;
    renderCalendar();
    updateTimeButtonText();
}

let timeMode = 'single';

function setTimeMode(mode) {
    timeMode = mode;
    document.querySelectorAll('.time-mode-btn').forEach(btn => {
        if (btn.dataset.mode === mode) {
            btn.className = 'time-mode-btn px-4 py-2 rounded-lg';
            btn.style.backgroundColor = 'var(--accent-color)';
            btn.style.color = 'white';
        } else {
            btn.className = 'time-mode-btn px-4 py-2 rounded-lg bg-gray-200 text-gray-700';
        }
    });
    
    document.getElementById('end-time-container').classList.toggle('hidden', mode !== 'range');
}

function updateTimeButtonText() {
    const dateStr = document.getElementById('task-selected-date')?.value;
    const startTime = document.getElementById('task-start-time')?.value;
    const endTime = document.getElementById('task-end-time')?.value;
    
    if (dateStr) {
        const date = new Date(dateStr);
        const dateText = `${date.getMonth() + 1}月${date.getDate()}日`;
        
        if (startTime) {
            let text = dateText + ' ' + startTime;
            if (timeMode === 'range' && endTime) {
                text += ' - ' + endTime;
            }
            document.getElementById('time-btn-text').textContent = text;
        } else {
            document.getElementById('time-btn-text').textContent = dateText;
        }
    }
}

function initFormHandlers() {
    const taskForm = document.getElementById('task-form');
    if (taskForm) {
        taskForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const id = document.getElementById('task-id').value;
            const title = document.getElementById('task-title').value;
            const listId = document.getElementById('task-list').value;
            const important = document.getElementById('task-important').checked;
            const urgent = document.getElementById('task-urgent').checked;
            const notes = document.getElementById('task-notes').value;
            const selectedDate = document.getElementById('task-selected-date').value;
            const startTime = document.getElementById('task-start-time').value;
            const endTime = document.getElementById('task-end-time').value;
            const reminder = getReminderValueFromForm();
            const repeat = getRepeatValueFromForm();
            
            let startDateTime = null;
            let endDateTime = null;
            
            if (selectedDate && startTime) {
                startDateTime = new Date(`${selectedDate}T${startTime}:00`);
                if (timeMode === 'range' && endTime) {
                    endDateTime = new Date(`${selectedDate}T${endTime}:00`);
                }
            }
            
            if (id) {
                const task = tasks.find(t => t.id === id);
                if (task) {
                    task.title = title;
                    task.listId = listId;
                    task.important = important;
                    task.urgent = urgent;
                    task.notes = notes;
                    task.startTime = startDateTime ? startDateTime.toISOString() : null;
                    task.endTime = endDateTime ? endDateTime.toISOString() : null;
                    task.reminder = reminder;
                    task.repeat = repeat;
                }
            } else {
                tasks.push({
                    id: generateId(),
                    title,
                    listId,
                    important,
                    urgent,
                    notes,
                    tags: [],
                    startTime: startDateTime ? startDateTime.toISOString() : null,
                    endTime: endDateTime ? endDateTime.toISOString() : null,
                    reminder,
                    repeat,
                    completed: false,
                    createdAt: new Date().toISOString()
                });
            }
            
            saveData();
            closeAddTaskModal();
            renderLists();
            renderView();
            showToast(id ? '任务已更新' : '任务已添加', 'success');
        });
    }
    
    // 监听时间变化
    const startTimeInput = document.getElementById('task-start-time');
    const endTimeInput = document.getElementById('task-end-time');
    if (startTimeInput) {
        startTimeInput.addEventListener('change', updateTimeButtonText);
    }
    if (endTimeInput) {
        endTimeInput.addEventListener('change', updateTimeButtonText);
    }
    
    // 清单选择变化
    const taskListSelect = document.getElementById('task-list');
    if (taskListSelect) {
        taskListSelect.addEventListener('change', () => {
            const list = lists.find(l => l.id === taskListSelect.value);
            document.getElementById('list-btn-text').textContent = list?.name || '选择清单';
        });
    }
    
    // 重要/紧急变化
    const importantCheckbox = document.getElementById('task-important');
    const urgentCheckbox = document.getElementById('task-urgent');
    if (importantCheckbox && urgentCheckbox) {
        importantCheckbox.addEventListener('change', updatePriorityButtonText);
        urgentCheckbox.addEventListener('change', updatePriorityButtonText);
    }
}

function updatePriorityButtonText() {
    const important = document.getElementById('task-important')?.checked;
    const urgent = document.getElementById('task-urgent')?.checked;
    
    const text = (important ? '重要' : '') + (important && urgent ? ' / ' : '') + (urgent ? '紧急' : '');
    document.getElementById('priority-btn-text').textContent = text || '设置优先级';
}

function deleteTask(taskId) {
    // 彩蛋：断舍离检测（在DOM移除前获取位置）
    const taskEl = document.querySelector(`[onclick*="toggleTaskComplete('${taskId}')"]`) ||
                   document.querySelector(`[onclick*="openTaskDetailPanel('${taskId}')"]`);
    easterEgg_onTaskDelete(taskEl);

    tasks = tasks.filter(t => t.id !== taskId);
    saveData();
    if (currentDetailTaskId === taskId) {
        document.getElementById('task-detail-panel').classList.add('hidden');
        currentDetailTaskId = null;
        detailOpenedFromPlan = false;
    }
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    renderView();
    showToast('任务已删除', 'success');
}

function createNextRepeatTask(task) {
    if (!task.repeat || !task.repeat.type) return null;
    if (!task.startTime) return null;

    const repeatMode = task.repeat.repeatMode || 'startTime';
    const baseDate = repeatMode === 'completeTime' ? new Date() : new Date(task.startTime);
    const completeTime = new Date();
    let nextDate = null;

    /**
     * 计算从 fromDate 开始的下一个重复日期（仅推进一个周期）
     * @param {Date} fromDate - 基准日期
     * @returns {Date|null}
     */
    function computeNextOccurrence(fromDate) {
        let result = null;
        if (task.repeat.type === 'custom' && task.repeat.interval && task.repeat.unit) {
            result = new Date(fromDate);
            const interval = task.repeat.interval;
            const unit = task.repeat.unit;
            if (unit === 'days') result.setDate(result.getDate() + interval);
            else if (unit === 'weeks') result.setDate(result.getDate() + interval * 7);
            else if (unit === 'months') result.setMonth(result.getMonth() + interval);
            else if (unit === 'years') result.setFullYear(result.getFullYear() + interval);
        } else if (task.repeat.type === 'daily') {
            result = new Date(fromDate);
            if (task.repeat.workdayOnly) {
                // 每个工作日：跳过周末
                result.setDate(result.getDate() + 1);
                while (result.getDay() === 0 || result.getDay() === 6) {
                    result.setDate(result.getDate() + 1);
                }
            } else {
                result.setDate(result.getDate() + 1);
            }
        } else if (task.repeat.type === 'weekly') {
            result = new Date(fromDate);
            if (task.repeat.dayOfWeek !== undefined) {
                // 每周X：跳到下一个指定星期
                result.setDate(result.getDate() + 1);
                while (result.getDay() !== task.repeat.dayOfWeek) {
                    result.setDate(result.getDate() + 1);
                }
            } else {
                result.setDate(result.getDate() + 7);
            }
        } else if (task.repeat.type === 'monthly') {
            result = new Date(fromDate);
            result.setMonth(result.getMonth() + 1);
            if (task.repeat.dayOfMonth) {
                result.setDate(task.repeat.dayOfMonth);
            }
        } else if (task.repeat.type === 'yearly') {
            result = new Date(fromDate);
            result.setFullYear(result.getFullYear() + 1);
            if (task.repeat.month && task.repeat.day) {
                result.setMonth(task.repeat.month - 1);
                result.setDate(task.repeat.day);
            }
            if (task.repeat.beforeHoliday) {
                // 节假日假期前一天：在每年主要法定假日前一天创建任务
                const holidays = [
                    { month: 1, day: 1 },   // 元旦
                    { month: 5, day: 1 },   // 劳动节
                    { month: 10, day: 1 },  // 国庆
                ];
                // 找到 fromDate 之后下一个假期的前一天
                let found = false;
                for (const h of holidays) {
                    const holidayDate = new Date(fromDate.getFullYear(), h.month - 1, h.day);
                    const dayBefore = new Date(holidayDate);
                    dayBefore.setDate(dayBefore.getDate() - 1);
                    if (dayBefore > fromDate) {
                        result = dayBefore;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    // 跨年：取明年元旦前一天
                    result = new Date(fromDate.getFullYear() + 1, 0, 0);
                }
            }
        } else if (task.repeat.type === 'weeklyFirstWorkday') {
            const weekStartsOnMonday = settings.weekStart === 'monday';
            const currentWeekStart = getWeekStartDate(fromDate, weekStartsOnMonday);
            const nextWeekStart = new Date(currentWeekStart);
            nextWeekStart.setDate(nextWeekStart.getDate() + 7);
            const firstWorkday = findFirstWorkdayOfWeek(nextWeekStart, weekStartsOnMonday);
            result = firstWorkday || new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        } else if (task.repeat.type === 'weeklyLastWorkday') {
            const weekStartsOnMonday = settings.weekStart === 'monday';
            const currentWeekStart = getWeekStartDate(fromDate, weekStartsOnMonday);
            const nextWeekStart = new Date(currentWeekStart);
            nextWeekStart.setDate(nextWeekStart.getDate() + 7);
            const lastWorkday = findLastWorkdayOfWeek(nextWeekStart, weekStartsOnMonday);
            result = lastWorkday || new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        } else if (task.repeat.type === 'monthlyFirstWorkday') {
            let nextMonth = fromDate.getMonth() + 1;
            let nextYear = fromDate.getFullYear();
            if (nextMonth > 11) {
                nextMonth = 0;
                nextYear++;
            }
            const firstWorkday = findFirstWorkdayOfMonth(nextYear, nextMonth);
            result = firstWorkday || new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, fromDate.getDate());
        } else if (task.repeat.type === 'monthlyLastWorkday') {
            let nextMonth = fromDate.getMonth() + 1;
            let nextYear = fromDate.getFullYear();
            if (nextMonth > 11) {
                nextMonth = 0;
                nextYear++;
            }
            const lastWorkday = findLastWorkdayOfMonth(nextYear, nextMonth);
            result = lastWorkday || new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, fromDate.getDate());
        }
        return result;
    }

    // 计算首次下一个日期
    nextDate = computeNextOccurrence(baseDate);

    // 关键修复：startTime模式下，如果任务被顺延/超时完成，原计划的下次时间可能已经过去
    // 此时需要持续向前推进重复周期，直到找到不早于当前时间的下次时间
    // （避免漏掉本周/本月的重复周期，将下次任务错误地推到下下周/下下月）
    if (repeatMode === 'startTime' && nextDate) {
        // 比较时仅保留日期部分（避免因小时/分钟差异导致误判）
        const completeDateOnly = new Date(completeTime.getFullYear(), completeTime.getMonth(), completeTime.getDate());
        let safetyCount = 0;
        while (nextDate < completeDateOnly && safetyCount < 365) {
            const advanced = computeNextOccurrence(nextDate);
            if (!advanced || advanced.getTime() === nextDate.getTime()) break;
            nextDate = advanced;
            safetyCount++;
        }
    }

    if (!nextDate) return null;

    const newTask = JSON.parse(JSON.stringify(task));
    newTask.id = generateId();
    newTask.completed = false;
    newTask.completedAt = null;
    newTask.createdAt = new Date().toISOString();

    if (task.isAllDay) {
        newTask.startTime = new Date(formatDate(nextDate) + 'T00:00:00').toISOString();
    } else {
        const hours = baseDate.getHours();
        const minutes = baseDate.getMinutes();
        nextDate.setHours(hours, minutes, 0, 0);
        newTask.startTime = nextDate.toISOString();
    }

    if (task.endTime) {
        const endDiff = new Date(task.endTime).getTime() - new Date(task.startTime).getTime();
        newTask.endTime = new Date(new Date(newTask.startTime).getTime() + endDiff).toISOString();
    }

    if (newTask.subtasks && newTask.subtasks.length > 0) {
        newTask.subtasks = newTask.subtasks.map((st, i) => ({
            id: generateId(),
            text: st.text,
            completed: false,
            originalOrder: i
        }));
    }
    newTask.progress = 0;

    return newTask;
}

function toggleTaskComplete(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        const wasCompleted = task.completed;
        task.completed = !task.completed;
        task.completedAt = task.completed ? new Date().toISOString() : null;
        if (task.completed && task.repeat && task.repeat.type) {
            const nextTask = createNextRepeatTask(task);
            if (nextTask) {
                tasks.push(nextTask);
            }
        }
        saveData();
        renderLists();
        if (typeof renderTags === 'function') renderTags();
        renderView();

        // 触发彩蛋效果（任务完成时）
        if (task.completed && !wasCompleted) {
            easterEgg_onTaskComplete(task);
            // 通知番茄专注：当前任务已完成
            if (typeof onFocusTaskCompleted === 'function') {
                onFocusTaskCompleted(task.id);
            }
        }
    }
}

function editList(listId) {
    editingListId = listId;
    if (typeof listDeleteConfirming !== 'undefined') listDeleteConfirming = false;
    if (typeof listArchiveConfirming !== 'undefined') listArchiveConfirming = false;
    renderLists();
}

function postponeOverdueTasks() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const overdueTasks = tasks.filter(task => {
        if (!task.startTime || task.completed) return false;
        const taskDate = new Date(task.startTime);
        taskDate.setHours(0, 0, 0, 0);
        return taskDate.getTime() < now.getTime();
    });
    
    if (overdueTasks.length === 0) {
        showToast('没有需要顺延的任务', 'info');
        return;
    }
    
    const today = new Date();
    overdueTasks.forEach(task => {
        const oldStart = new Date(task.startTime);
        oldStart.setFullYear(today.getFullYear(), today.getMonth(), today.getDate());
        task.startTime = oldStart.toISOString();
        
        if (task.endTime) {
            const oldEnd = new Date(task.endTime);
            oldEnd.setFullYear(today.getFullYear(), today.getMonth(), today.getDate());
            task.endTime = oldEnd.toISOString();
        }
    });
    
    saveData();
    renderView();
    updatePostponeButton();
    showToast(`已将 ${overdueTasks.length} 个过期任务顺延至今天`, 'success');
}

function updatePostponeButton() {
    const postponeBtn = document.getElementById('postpone-btn');
    if (!postponeBtn) return;
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const hasOverdue = tasks.some(task => {
        if (!task.startTime || task.completed) return false;
        const taskDate = new Date(task.startTime);
        taskDate.setHours(0, 0, 0, 0);
        return taskDate.getTime() < now.getTime();
    });
    
    if (hasOverdue) {
        postponeBtn.classList.remove('hidden');
    } else {
        postponeBtn.classList.add('hidden');
    }
}

function showAddListInput() {
    editingListId = '__new__';
    if (typeof listDeleteConfirming !== 'undefined') listDeleteConfirming = false;
    if (typeof listArchiveConfirming !== 'undefined') listArchiveConfirming = false;
    renderLists();
}

function hideAddListInput() {
    editingListId = null;
    if (typeof listDeleteConfirming !== 'undefined') listDeleteConfirming = false;
    if (typeof listArchiveConfirming !== 'undefined') listArchiveConfirming = false;
    renderLists();
}

function saveListInput() {
    const name = document.getElementById('new-list-name').value.trim();
    const color = document.getElementById('new-list-color').value;
    const editId = document.getElementById('edit-list-id').value;
    
    if (!name) {
        showToast('请输入清单名称', 'error');
        return;
    }
    
    // 清单名称唯一性校验
    const existingList = lists.find(l => l.name === name && l.id !== editId);
    if (existingList) {
        showToast('清单名称已存在', 'error');
        return;
    }
    
    if (editId) {
        const list = lists.find(l => l.id === editId);
        if (list) {
            // 默认清单只允许更改颜色
            if (editId === 'default') {
                list.color = color;
            } else {
                list.name = name;
                list.color = color;
            }
        }
        saveData();
        editingListId = null;
        renderLists();
        renderView();
        showToast('清单已更新', 'success');
    } else {
        const newList = {
            id: generateId(),
            name: name,
            color: color,
            createdAt: new Date().toISOString()
        };
        
        lists.push(newList);
        saveData();
        editingListId = null;
        renderLists();
        showToast('清单添加成功！', 'success');
    }
}

// 筛选清单函数
function filterByList(listId) {
    if (listId === 'recent') {
        currentListId = null;
        currentFilter = 'recent7days';
    } else {
        currentListId = listId;
        currentFilter = null;
    }
    currentTagIds = [];
    currentFilterId = null;
    
    if (currentView === 'summary') {
        switchView('task');
        renderLists();
    } else {
        renderLists();
        renderView();
        if (typeof renderTags === 'function') renderTags();
        if (typeof renderFilters === 'function') renderFilters();
        if (typeof updateSidebarHighlight === 'function') updateSidebarHighlight();
    }
}

// 点击"所有任务"按钮 - 清除筛选和清单
function filterAllTasks() {
    currentListId = null;
    currentFilter = null;
    currentTagIds = [];
    currentFilterId = null;
    if (currentView === 'summary') {
        switchView('task');
    } else if (currentView !== 'task' && currentView !== 'schedule' && currentView !== 'week' && currentView !== 'month' && currentView !== 'quadrant') {
        switchView('task');
    } else {
        renderView();
        renderLists();
        if (typeof renderTags === 'function') renderTags();
        if (typeof renderFilters === 'function') renderFilters();
        if (typeof updateSidebarHighlight === 'function') updateSidebarHighlight();
    }
}

// ==================== 任务详情标签编辑 ====================

function toggleDetailTagPicker() {
    const picker = document.getElementById('detail-tag-picker');
    if (picker.classList.contains('hidden')) {
        // 关闭其他选择器
        document.getElementById('detail-list-picker').classList.add('hidden');
        picker.classList.remove('hidden');
        // 隐藏新建标签表单（每次打开默认收起）
        const form = document.getElementById('detail-new-tag-form');
        if (form) { form.classList.add('hidden'); form.classList.remove('flex'); }
        renderDetailTagPills();
    } else {
        picker.classList.add('hidden');
    }
}

function renderDetailTags(task) {
    if (!task) {
        task = tasks.find(t => t.id === currentDetailTaskId);
    }
    if (!task) return;

    const taskTags = task.tags || [];
    const allTags = settings.tags || [];

    // 更新进度上方的标签显示区域（悬停显示删除按钮，×叠加在胶囊右上角）
    const displayContainer = document.getElementById('detail-tags-display');
    if (displayContainer) {
        if (taskTags.length === 0) {
            displayContainer.innerHTML = '';
            displayContainer.classList.add('hidden');
        } else {
            displayContainer.classList.remove('hidden');
            displayContainer.innerHTML = taskTags.map(tagId => {
                const tag = allTags.find(t => t.id === tagId);
                if (!tag) return '';
                return `<span class="detail-tag-chip inline-flex items-center px-2 py-0.5 rounded-full text-xs text-white" style="background-color: ${tag.color}">
                    ${tag.name}
                    <button onclick="event.stopPropagation(); removeTagFromTask('${tagId}')" class="tag-remove-btn inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white/30 hover:bg-black/30 transition text-white" title="删除标签">
                        <i class="fas fa-times text-[9px]"></i>
                    </button>
                </span>`;
            }).join('');
        }
    }
}

function renderDetailTagPills() {
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;

    const pillsContainer = document.getElementById('detail-tag-pills');
    if (!pillsContainer) return;

    const taskTags = task.tags || [];
    const allTags = settings.tags || [];

    let html = allTags.map(tag => {
        const isSelected = taskTags.includes(tag.id);
        const isDisabled = !isSelected && taskTags.length >= 5;
        const cls = isSelected ? 'detail-tag-pill-selected' : (isDisabled ? 'detail-tag-pill detail-tag-pill-disabled' : 'detail-tag-pill');
        const onclickAttr = isDisabled ? '' : `onclick="event.stopPropagation(); toggleTaskTag('${tag.id}')"`;
        const title = isSelected ? '点击取消选择' : (isDisabled ? '标签数量已达上限' : '点击选择');
        return `<button class="${cls}" style="--tag-color: ${tag.color}" ${onclickAttr} title="${title}">${tag.name}</button>`;
    }).join('');

    // 最后一个"+"按钮：展开新建标签表单
    html += `<button onclick="event.stopPropagation(); toggleDetailNewTagForm()" class="inline-flex items-center justify-center w-5 h-5 rounded-full border-1.5 border-dashed border-theme text-theme-secondary hover:bg-theme-secondary transition" style="border-width: 1.5px" title="新建标签">
        <i class="fas fa-plus text-[10px]"></i>
    </button>`;

    pillsContainer.innerHTML = html;
}

// 显示/隐藏新建标签表单
function toggleDetailNewTagForm() {
    const form = document.getElementById('detail-new-tag-form');
    if (!form) return;
    if (form.classList.contains('hidden')) {
        form.classList.remove('hidden');
        form.classList.add('flex');
        const nameInput = document.getElementById('detail-new-tag-name');
        if (nameInput) nameInput.focus();
    } else {
        form.classList.add('hidden');
        form.classList.remove('flex');
    }
}

function toggleTaskTag(tagId) {
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;
    
    if (!task.tags) task.tags = [];
    
    if (task.tags.includes(tagId)) {
        task.tags = task.tags.filter(id => id !== tagId);
    } else {
        if (task.tags.length >= 5) {
            showToast('每个任务最多5个标签', 'warning');
            return;
        }
        task.tags.push(tagId);
    }
    
    saveData();
    renderDetailTags(task);
    renderDetailTagPills();
    if (typeof renderTags === 'function') renderTags();
    renderView();
}

function removeTagFromTask(tagId) {
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;

    if (task.tags) {
        task.tags = task.tags.filter(id => id !== tagId);
        saveData();
        renderDetailTags(task);
        renderDetailTagPills();
        if (typeof renderTags === 'function') renderTags();
        renderView();
    }
}

function createTagFromDetail() {
    const nameInput = document.getElementById('detail-new-tag-name');
    const colorInput = document.getElementById('detail-new-tag-color');
    const name = nameInput.value.trim();
    const color = colorInput.value;
    
    if (!name) {
        showToast('请输入标签名称', 'error');
        return;
    }
    
    if (name.length > 20) {
        showToast('标签名称最多20个字符', 'error');
        return;
    }
    
    if (!settings.tags) settings.tags = [];
    
    // 标签名称唯一性校验
    if (settings.tags.find(t => t.name === name)) {
        showToast('标签名称已存在', 'error');
        return;
    }
    
    if (settings.tags.length >= 20) {
        showToast('标签数量已达上限（20个）', 'error');
        return;
    }
    
    const newTag = {
        id: generateId(),
        name: name,
        color: color,
        createdAt: new Date().toISOString()
    };
    
    settings.tags.push(newTag);
    
    // 自动将新标签添加到当前任务
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (task) {
        if (!task.tags) task.tags = [];
        if (task.tags.length < 5) {
            task.tags.push(newTag.id);
        }
    }
    
    saveData();
    nameInput.value = '';
    // 创建成功后收起新建表单
    const form = document.getElementById('detail-new-tag-form');
    if (form) { form.classList.add('hidden'); form.classList.remove('flex'); }
    renderDetailTags(task);
    renderDetailTagPills();
    if (typeof renderTags === 'function') renderTags();
    renderView();
    showToast('标签创建成功', 'success');
}

// ==================== 标签CRUD ====================

function showAddTagInput(editTagId) {
    if (editTagId) {
        editingTagId = editTagId;
    } else {
        editingTagId = '__new__';
    }
    tagDeleteConfirming = false;
    renderTags();
}

function hideAddTagInput() {
    editingTagId = null;
    tagDeleteConfirming = false;
    renderTags();
}

let tagDeleteConfirming = false;

function saveTagInput() {
    const name = document.getElementById('new-tag-name').value.trim();
    const color = document.getElementById('new-tag-color').value;
    const editId = document.getElementById('edit-tag-id').value;
    
    if (!name) {
        showToast('请输入标签名称', 'error');
        return;
    }
    
    // 标签名称长度限制
    if (name.length > 20) {
        showToast('标签名称最多20个字符', 'error');
        return;
    }
    
    if (!settings.tags) settings.tags = [];
    
    // 标签名称唯一性校验
    const existingTag = settings.tags.find(t => t.name === name && t.id !== editId);
    if (existingTag) {
        showToast('标签名称已存在', 'error');
        return;
    }
    
    if (editId) {
        // 编辑标签
        const tag = settings.tags.find(t => t.id === editId);
        if (tag) {
            tag.name = name;
            tag.color = color;
            saveData();
            if (typeof renderTags === 'function') renderTags();
            if (typeof renderView === 'function') renderView();
            hideAddTagInput();
            showToast('标签已更新', 'success');
        }
    } else {
        // 检查标签数量上限
        if (settings.tags.length >= 20) {
            showToast('标签数量已达上限（20个）', 'warning');
            return;
        }
        
        const newTag = {
            id: generateId(),
            name: name,
            color: color,
            createdAt: new Date().toISOString()
        };
        
        settings.tags.push(newTag);
        saveData();
        if (typeof renderTags === 'function') renderTags();
        hideAddTagInput();
        showToast('标签添加成功！', 'success');
    }
}

function deleteTagInput() {
    const tagId = document.getElementById('edit-tag-id').value;
    if (!tagId) return;
    
    if (tagDeleteConfirming) {
        // 从设置中删除标签
        settings.tags = (settings.tags || []).filter(t => t.id !== tagId);
        
        // 从所有任务中移除该标签
        tasks.forEach(task => {
            if (task.tags) {
                task.tags = task.tags.filter(id => id !== tagId);
            }
        });
        
        // 从当前筛选中移除
        if (currentTagIds) {
            currentTagIds = currentTagIds.filter(id => id !== tagId);
        }
        
        saveData();
        if (typeof renderTags === 'function') renderTags();
        if (typeof renderView === 'function') renderView();
        if (typeof renderLists === 'function') renderLists();
        if (typeof updateSidebarHighlight === 'function') updateSidebarHighlight();
        hideAddTagInput();
        showToast('标签已删除', 'success');
        tagDeleteConfirming = false;
        return;
    }
    
    tagDeleteConfirming = true;
    const btn = document.getElementById('tag-delete-inline-btn');
    if (btn) {
        btn.classList.add('bg-red-600', 'border-red-600', 'text-white');
        btn.classList.remove('border-red-500', 'text-red-500', 'hover:bg-red-50');
        btn.title = '确认删除';
    }

    setTimeout(() => {
        tagDeleteConfirming = false;
        if (btn) {
            btn.classList.remove('bg-red-600', 'border-red-600', 'text-white');
            btn.classList.add('border-red-500', 'text-red-500', 'hover:bg-red-50');
            btn.title = '删除标签';
        }
    }, 3000);
}
