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
let _lastDragOver = null; // 当前高亮的拖拽落点（仅其显示虚线，移出/换列即清除，避免划过的列残留选定样式）

function handleTaskDragStart(e, taskId) {
    draggedTaskId = taskId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    e.target.classList.add('dragging');
}

function handleTaskDragOver(e) {
    e.preventDefault();
    const zone = e.target.closest('.task-item, .calendar-day, .quadrant-card, .drop-zone');
    if (!zone) return;
    if (zone === _lastDragOver) return; // 同一落点无需重复处理
    if (_lastDragOver) _lastDragOver.classList.remove('drag-over'); // 清除上一个落点的虚线
    _lastDragOver = zone;
    zone.classList.add('drag-over');
}

function handleTaskDragEnd(e) {
    document.querySelectorAll('.dragging, .drag-over').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
    _lastDragOver = null;
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
/**
 * 将 task.endTime 按 startTime 的平移天数同步平移（跨天任务保持跨度）。
 * 供周视图/月视图拖拽（handleWeekAllDayDrop / handleWeekDrop / handleMonthDrop）共用。
 * 注意：日程视图 handleScheduleDrop 用时长差语义，不适用此函数。
 * @param {object} task - 任务对象（task.startTime 应为新值）
 * @param {Date} oldStartDate - 平移前的开始时间
 */
function shiftEndTimeByDays(task, oldStartDate) {
    const daysDiff = Math.floor((new Date(task.startTime) - oldStartDate) / (1000 * 60 * 60 * 24));
    const newEnd = new Date(task.endTime);
    newEnd.setDate(newEnd.getDate() + daysDiff);
    task.endTime = newEnd.toISOString();
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
        shiftEndTimeByDays(task, oldDate);
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
        shiftEndTimeByDays(task, oldDate);
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
        shiftEndTimeByDays(task, oldDate);
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
        // 仅对调 A 与 B 两个象限的位置，不影响其他象限的顺序
        [quadrantOrder[fromIndex], quadrantOrder[toIndex]] = [quadrantOrder[toIndex], quadrantOrder[fromIndex]];
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
        dayEl.classList.add('ring-2', 'ring-accent-secondary');
    }
}

function handleScheduleDragLeave(event) {
    const dayEl = event.target.closest('.schedule-day-drop');
    if (dayEl) {
        dayEl.classList.remove('ring-2', 'ring-accent-secondary');
    }
}

function handleScheduleDrop(event) {
    event.preventDefault();
    const dayEl = event.target.closest('.schedule-day-drop');
    if (!dayEl || !draggedTaskId) return;
    
    dayEl.classList.remove('ring-2', 'ring-accent-secondary');
    
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
            // 子任务模式：描述或任一子任务文本有内容时，不算空任务
            const hasSubtaskContent = task.mode === 'subtasks'
                && (!!((task.description || '').trim())
                    || (task.subtasks || []).some(st => st.text && st.text.trim()));
            if ((!currentTitle || !currentTitle.trim()) && (!currentNotes || !currentNotes.trim()) && !hasSubtaskContent) {
                tasks.splice(taskIndex, 1);
                saveData();
                hideDetailPanel();
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
        // 根据设置项 defaultTaskDate 决定默认日期
        startTime = getDefaultTaskDate(settings.defaultTaskDate);
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
        description: '',
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
    
    const timeDisplay = task.startTime ? formatTaskTimeLabel(task) : '设置时间';
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
// 任务详情面板只读模式（如归档清单中的任务）
let detailReadOnly = false;

function onDetailAllDayChange() {
    const detailPanel = document.getElementById('task-detail-panel');
    if (!detailPanel || detailPanel.classList.contains('hidden')) return;
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

// 方案C：任务详情模态浮层模式（从命令面板打开时使用，避免被命令面板遮挡）
let _taskDetailModalMode = false;
let _taskDetailSavedClassName = '';
let _taskDetailSavedStyle = '';

// 应用模态浮层布局：宽屏固定右侧、窄屏模态居中
function _applyTaskDetailModalLayout(panel) {
    panel.classList.remove('h-screen', 'relative', 'z-40');
    panel.classList.add('fixed', 'shadow-2xl');
    if (window.innerWidth < 768) {
        // 窄屏：模态居中
        panel.classList.add('border', 'rounded-xl');
        panel.style.zIndex = '10001';
        panel.style.top = '50%';
        panel.style.left = '50%';
        panel.style.right = 'auto';
        panel.style.transform = 'translate(-50%, -50%)';
        panel.style.height = 'auto';
        panel.style.maxHeight = '85vh';
    } else {
        // 宽屏：固定屏幕右侧，与命令面板互不重叠
        panel.classList.add('border-l');
        panel.style.zIndex = '10001';
        panel.style.top = '0';
        panel.style.right = '0';
        panel.style.left = 'auto';
        panel.style.transform = 'none';
        panel.style.height = '100vh';
        panel.style.maxHeight = 'none';
        // 命令面板向左偏移，腾出详情面板空间，避免重叠
        _adjustCommandPaletteForDetail(true);
    }
    panel.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.5)';
    panel.style.transition = 'none';
}

// 调整命令面板位置，为详情面板腾出空间（宽屏右侧布局时）
function _adjustCommandPaletteForDetail(open) {
    const overlay = document.getElementById('command-palette-overlay');
    if (!overlay) return;
    overlay.style.transition = 'padding 0.2s ease';
    overlay.style.paddingRight = open ? '400px' : '';
}

function openTaskDetailModal(taskId) {
    const panel = document.getElementById('task-detail-panel');
    if (!panel) return;

    // 首次进入模态模式时，保存原始样式（此时面板含 hidden，仍不可见）
    if (!_taskDetailModalMode) {
        _taskDetailSavedClassName = panel.className;
        _taskDetailSavedStyle = panel.style.cssText;
    }
    _taskDetailModalMode = true;

    // 在下一帧渲染：让点击的视觉反馈先绘制，避免同步阻塞造成卡顿；
    // 同时检查 _taskDetailModalMode，处理点击后立即 ESC 关闭的竞态
    requestAnimationFrame(() => {
        if (!_taskDetailModalMode) return;
        const p = document.getElementById('task-detail-panel');
        if (!p) return;
        // 先应用浮层布局（面板仍 hidden，不会闪烁），再渲染内容
        _applyTaskDetailModalLayout(p);
        openTaskDetailPanel(taskId);
    });
}

// 平滑过渡动画：任务详情面板显示/隐藏的统一入口（设置项 smoothAnimations 开启时播放过渡动画）
let _detailPanelHideTimer = null;
function showDetailPanel() {
    const panel = document.getElementById('task-detail-panel');
    if (!panel) return;
    // 取消尚未完成的关闭动画，避免面板被延迟 hidden
    if (_detailPanelHideTimer) {
        clearTimeout(_detailPanelHideTimer);
        _detailPanelHideTimer = null;
    }
    panel.classList.remove('hidden');
    if (settings.smoothAnimations === true) {
        // 主界面（含顶部右侧按钮）跟随面板收缩：CSS 过渡 margin-right
        document.body.classList.add('fx-detail-open');
        panel.classList.remove('panel-fade-out');
        panel.classList.add('panel-fade-in');
    } else {
        document.body.classList.remove('fx-detail-open');
    }
}
function hideDetailPanel() {
    const panel = document.getElementById('task-detail-panel');
    if (!panel) return;
    // 移除跟随类，主界面平滑回弹（与面板滑出动画同时进行）
    document.body.classList.remove('fx-detail-open');
    if (settings.smoothAnimations === true && !panel.classList.contains('hidden')) {
        panel.classList.remove('panel-fade-in');
        panel.classList.add('panel-fade-out');
        if (_detailPanelHideTimer) clearTimeout(_detailPanelHideTimer);
        _detailPanelHideTimer = setTimeout(() => {
            _detailPanelHideTimer = null;
            panel.classList.remove('panel-fade-out');
            panel.classList.add('hidden');
        }, 200);
    } else {
        panel.classList.remove('panel-fade-in', 'panel-fade-out');
        panel.classList.add('hidden');
    }
}

function openTaskDetailPanel(taskId, readOnly = false) {
    if (planPanelOpen && !detailOpenedFromPlan) {
        const detailPanel = document.getElementById('task-detail-panel');
        if (detailPanel && !detailPanel.classList.contains('hidden')) {
            closeTaskDetailPanel();
        }
        closePlanPanel();
        return;
    }
    detailOpenedFromPlan = false;
    // 面板正展示其他任务时，先将当前任务尚未落盘的修改（重要/紧急、标题、备注、清单、提醒、重复等）保存到任务对象，避免直接切换丢失
    if (currentDetailTaskId && currentDetailTaskId !== taskId && !detailReadOnly) {
        const visiblePanel = document.getElementById('task-detail-panel');
        if (visiblePanel && !visiblePanel.classList.contains('hidden')) {
            saveTaskDetailWithoutClose();
        }
    }
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    currentDetailTaskId = taskId;
    isTimeRangeMode = !!task.endTime;
    detailReadOnly = readOnly;
    
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
    // 默认选中「按设定时间」：新配置重复周期时用户能看到默认重复方式；
    // 已有重复配置的任务会在下方按 task.repeat.repeatMode 覆盖选中
    const defaultModeOpt = document.querySelector('.detail-repeat-mode-option[value="startTime"]');
    if (defaultModeOpt) defaultModeOpt.checked = true;
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
    
    // 设置分组（清单的自定义分组），须在 populateDetailListSelect 之前，其内部会带出分组行
    detailSelectedGroupId = task.groupId || '';

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

    // 切换任务后：清理过期的跳过撤销快照（仅同一任务有效），刷新跳过按钮可见性
    if (_detailSkipUndoSnapshot && _detailSkipUndoSnapshot.taskId !== taskId) {
        _detailSkipUndoSnapshot = null;
        _clearDetailSkipUndoTimer();
    }
    refreshDetailSkipCycleButton();
    
    // 更新清单按钮文本
    updateDetailListBtnText();
    
    // 初始化任务进度显示
    updateProgressDisplay();

    // 已完成任务显示创建/完成时间
    updateDetailTimestamps(task);
    
    // 初始化任务模式
    currentTaskMode = task.mode || 'text';
    const descInput = document.getElementById('detail-task-description');
    descInput.value = task.description || '';
    if (currentTaskMode === 'subtasks') {
        document.getElementById('detail-task-notes').classList.add('hidden');
        descInput.classList.remove('hidden');
        document.getElementById('subtasks-container').classList.remove('hidden');
        document.getElementById('toggle-mode-btn').innerHTML = '<i class="fas fa-edit"></i>';
        document.getElementById('toggle-mode-btn').title = '文本模式';
    } else {
        document.getElementById('detail-task-notes').classList.remove('hidden');
        descInput.classList.add('hidden');
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
    showDetailPanel();
    
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

    // 添加子任务模式描述框的输入监听（高度自适应 + 实时写入任务对象）
    setupDetailDescriptionInput();

    // 在面板显示后再调整标题高度（延迟确保DOM已渲染）
    setTimeout(() => {
        autoResizeTextarea(titleInput);
        if (currentTaskMode === 'subtasks') {
            autoResizeDetailDescription(document.getElementById('detail-task-description'));
        }
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

    // 应用只读模式：禁用所有可编辑控件，隐藏操作按钮
    applyDetailReadOnly(detailReadOnly);
}

// 应用/取消任务详情面板的只读模式
function applyDetailReadOnly(readOnly) {
    const titleInput = document.getElementById('detail-task-title');
    const notesInput = document.getElementById('detail-task-notes');
    const descInput = document.getElementById('detail-task-description');
    const completeBtn = document.getElementById('detail-task-complete-btn');
    const toggleModeBtn = document.getElementById('toggle-mode-btn');
    const timeMenuBtn = document.querySelector('[onclick*="toggleDetailTimeMenu"]');
    const progressContainer = document.getElementById('progress-container');
    // 底部快捷按钮容器（重要/紧急/标签/清单 + 删除/专注/保存）
    const bottomActions = document.querySelector('#task-detail-panel > div:last-child');

    if (readOnly) {
        if (titleInput) titleInput.readOnly = true;
        if (notesInput) notesInput.readOnly = true;
        if (descInput) descInput.readOnly = true;
        if (completeBtn) completeBtn.style.display = 'none';
        if (toggleModeBtn) toggleModeBtn.style.display = 'none';
        if (timeMenuBtn) timeMenuBtn.style.display = 'none';
        if (progressContainer) progressContainer.style.cursor = 'default';
        if (bottomActions) bottomActions.style.display = 'none';
    } else {
        if (titleInput) titleInput.readOnly = false;
        if (notesInput) notesInput.readOnly = false;
        if (descInput) descInput.readOnly = false;
        if (completeBtn) completeBtn.style.display = '';
        if (toggleModeBtn) toggleModeBtn.style.display = '';
        if (timeMenuBtn) timeMenuBtn.style.display = '';
        if (progressContainer) progressContainer.style.cursor = 'pointer';
        if (bottomActions) bottomActions.style.display = '';
    }
}

// 更新已完成任务的创建/完成时间显示
function updateDetailTimestamps(task) {
    const container = document.getElementById('detail-timestamps-display');
    if (!container) return;

    if (!task.completed) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    const formatTs = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        const pad = (n) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    let html = '';
    if (task.createdAt) {
        html += `<div class="flex items-center gap-1"><i class="fas fa-plus-circle"></i><span>创建：${formatTs(task.createdAt)}</span></div>`;
    }
    if (task.completedAt) {
        html += `<div class="flex items-center gap-1"><i class="fas fa-check-circle"></i><span>完成：${formatTs(task.completedAt)}</span></div>`;
    }
    if (html) {
        container.innerHTML = html;
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
        container.innerHTML = '';
    }
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
        // 手动修改时间后，清除顺延保留的原始时间
        delete task._originalStartTime;
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
    
    syncDetailRepeatInputToTask(task);
    
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
        // 按第一个空行拆分：空行前为任务详情描述（独立字段，不转为子任务），空行后按行拆为子任务
        const { description, body } = splitNotesIntoDescriptionAndBody(notesValue);
        task.description = description;
        document.getElementById('detail-task-description').value = description;
        if (body.trim()) {
            const lines = body.split('\n');
            // 总是用当前文本重新生成子任务
            task.subtasks = lines.map((line, i) => ({ id: generateId(), text: line, completed: false, originalOrder: i }));
        }
        if (!task.subtasks || task.subtasks.length === 0) {
            task.subtasks = [{ id: generateId(), text: '', completed: false, originalOrder: 0 }];
        }
        // 先切换显示，再渲染子任务（确保scrollHeight正确计算）
        document.getElementById('detail-task-notes').classList.add('hidden');
        document.getElementById('detail-task-description').classList.remove('hidden');
        autoResizeDetailDescription(document.getElementById('detail-task-description'));
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
        // 描述置于文本最顶端，与子任务转来的文本以一行空行分隔
        const descValue = document.getElementById('detail-task-description').value;
        task.description = descValue;
        const joined = sortedForText.map(st => st.text).join('\n');
        task.notes = descValue.trim() ? descValue + '\n\n' + joined : joined;
        document.getElementById('detail-task-notes').value = task.notes || '';
        document.getElementById('detail-task-notes').classList.remove('hidden');
        document.getElementById('detail-task-description').classList.add('hidden');
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

// ==================== 子任务拖拽排序（长按 300ms 激活 + Pointer Events 驱动） ====================
// 性能设计对齐侧边栏清单拖拽：激活时一次性缓存各行视口坐标，热路径零布局读取；
// 高亮经 rAF 收敛到每帧一次；反馈仅用 opacity / box-shadow 等非布局属性。
// 为什么不用原生 HTML5 DnD：按压起点落在 textarea 内时，浏览器引擎一律按"拖选文本"处理，
// dragstart 永远不会触发（多行子任务按住后往上拖即表现为选中文字），故由指针事件自行驱动。
let draggingSubtaskId = null;
let activeSubtaskEl = null;
let subtaskDragRAF = null;
let subtaskRects = []; // 拖拽开始时缓存各子任务行视口坐标，避免热路径里 getBoundingClientRect

// —— 删除二次确认（参考清单/过滤器删除逻辑）：首次点击变红待确认，再点删除，3 秒超时自动复位 ——
let subtaskDeleteConfirmingId = null;
let subtaskDeleteConfirmTimer = null;

function resetSubtaskDeleteConfirm() {
    subtaskDeleteConfirmingId = null;
    if (subtaskDeleteConfirmTimer) { clearTimeout(subtaskDeleteConfirmTimer); subtaskDeleteConfirmTimer = null; }
    document.querySelectorAll('.subtask-item .subtask-delete-confirm').forEach(btn => {
        btn.classList.remove('subtask-delete-confirm', 'text-red-500');
        btn.classList.add('text-theme-muted');
    });
}

// 悬停黑色、确认态红色由 CSS 类控制（text-theme-muted → hover:text-theme-primary / 确认时 text-red-500）
function requestSubtaskDelete(subtaskId, btn) {
    if (subtaskDeleteConfirmingId === subtaskId) {
        // 第二次点击：执行删除
        resetSubtaskDeleteConfirm();
        deleteSubtask(subtaskId);
        return;
    }
    // 第一次点击：进入确认态
    resetSubtaskDeleteConfirm(); // 互斥：同时只允许一行处于确认态
    subtaskDeleteConfirmingId = subtaskId;
    btn.classList.remove('text-theme-muted');
    btn.classList.add('subtask-delete-confirm', 'text-red-500');
    subtaskDeleteConfirmTimer = setTimeout(resetSubtaskDeleteConfirm, 3000);
}

// —— 长按判定 ——
const SUBTASK_HOLD_MS = 300;        // 长按激活阈值
const SUBTASK_HOLD_TOLERANCE = 6;   // 判定期位移容差：超过视为普通点击/划选文本，立即取消
let subtaskHoldTimer = null;
let subtaskHoldRow = null;
let subtaskHoldPointerId = null;
let subtaskHoldStartX = 0;
let subtaskHoldStartY = 0;

// —— 拖拽进行时 ——
let subtaskDragActive = false;
let subtaskDraggedEl = null;
let subtaskDragPointerId = null;
let subtaskDragTarget = null; // { id, insertAfter }

function cancelSubtaskHold() {
    if (subtaskHoldTimer) { clearTimeout(subtaskHoldTimer); subtaskHoldTimer = null; }
    if (subtaskHoldRow) {
        subtaskHoldRow.classList.remove('subtask-holding');
        subtaskHoldRow = null;
    }
}

function clearSubtaskHighlight() {
    if (subtaskDragRAF) { cancelAnimationFrame(subtaskDragRAF); subtaskDragRAF = null; }
    if (activeSubtaskEl) {
        activeSubtaskEl.style.boxShadow = '';
        activeSubtaskEl.style.transition = '';
        activeSubtaskEl = null;
    }
}

// 插入线用 inset box-shadow 指示，不触发布局
function applySubtaskHighlight(el, side) {
    if (!el || el === activeSubtaskEl) return;
    clearSubtaskHighlight();
    activeSubtaskEl = el;
    el.style.transition = 'none';
    el.style.boxShadow = side === 'top' ? 'inset 0 3px 0 -1px #3b82f6' : 'inset 0 -3px 0 -1px #3b82f6';
}

function scheduleSubtaskHighlight(el, side) {
    if (subtaskDragRAF) return;
    subtaskDragRAF = requestAnimationFrame(() => {
        subtaskDragRAF = null;
        applySubtaskHighlight(el, side);
    });
}

// 激活拖拽：捕获指针 + 失焦并清除选区（阻断按压起点的"拖选文本"默认行为）+ 缓存行坐标
function startSubtaskDrag(row, subtaskId, container) {
    subtaskDragActive = true;
    draggingSubtaskId = subtaskId;
    subtaskDraggedEl = row;
    subtaskDragPointerId = subtaskHoldPointerId;
    subtaskDragTarget = null;
    row.classList.remove('subtask-holding');
    row.classList.add('subtask-drag-ready');
    try { if (subtaskDragPointerId !== null) row.setPointerCapture(subtaskDragPointerId); } catch (_) {}
    // 关键修复：按压若起始于 textarea，引擎会带着"拖选"意图；失焦 + 清空选区将其掐断
    const ta = row.querySelector('textarea');
    if (ta) ta.blur();
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
    subtaskRects = [...container.querySelectorAll('.subtask-item')].map(el => {
        const r = el.getBoundingClientRect();
        return { el, top: r.top, bottom: r.bottom, midY: r.top + r.height / 2 };
    });
}

function endSubtaskDrag() {
    cancelSubtaskHold();
    if (subtaskDraggedEl) {
        subtaskDraggedEl.classList.remove('subtask-drag-ready');
        try {
            if (subtaskDragPointerId !== null && subtaskDraggedEl.hasPointerCapture(subtaskDragPointerId)) {
                subtaskDraggedEl.releasePointerCapture(subtaskDragPointerId);
            }
        } catch (_) {}
    }
    subtaskDragActive = false;
    subtaskDraggedEl = null;
    subtaskDragPointerId = null;
    draggingSubtaskId = null;
    subtaskDragTarget = null;
    subtaskRects = [];
    clearSubtaskHighlight();
}

// 拖拽热路径：仅查缓存坐标数组 + rAF 高亮 + 兜底清文本选区，零布局读取
function updateSubtaskDragPosition(clientY) {
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
    const hit = subtaskRects.find(r => clientY >= r.top && clientY <= r.bottom);
    // 落点无效：不在任何行上 / 在拖拽行自身 / 跨组（未完成↔已完成不可互拖）
    if (!hit || hit.el === subtaskDraggedEl || hit.el.dataset.completed !== subtaskDraggedEl.dataset.completed) {
        subtaskDragTarget = null;
        clearSubtaskHighlight();
        return;
    }
    const insertAfter = clientY >= hit.midY;
    subtaskDragTarget = { id: hit.el.dataset.subtaskId, insertAfter: insertAfter };
    scheduleSubtaskHighlight(hit.el, insertAfter ? 'bottom' : 'top');
}

function finishSubtaskDrag() {
    const draggedId = draggingSubtaskId;
    const target = subtaskDragTarget;
    endSubtaskDrag();
    if (draggedId && target && target.id !== draggedId) {
        handleSubtaskReorder(draggedId, target.id, target.insertAfter);
    }
}

// 全局统一监听（仅绑定一次；非拖拽态时一两次属性判断即返回，开销可忽略）
document.addEventListener('pointermove', (e) => {
    if (subtaskDragActive) {
        if (e.pointerId !== subtaskDragPointerId) return;
        if (!(e.buttons & 1)) { endSubtaskDrag(); return; } // 按键已释放（如窗口外松开）则中止
        updateSubtaskDragPosition(e.clientY);
        return;
    }
    if (!subtaskHoldTimer) return;
    if (Math.abs(e.clientX - subtaskHoldStartX) > SUBTASK_HOLD_TOLERANCE ||
        Math.abs(e.clientY - subtaskHoldStartY) > SUBTASK_HOLD_TOLERANCE) {
        cancelSubtaskHold(); // 判定期移动超容差：视为点击/划选文本，静默取消
    }
}, { passive: true });
document.addEventListener('pointerup', () => {
    if (subtaskDragActive) finishSubtaskDrag();
    else cancelSubtaskHold();
});
document.addEventListener('pointercancel', () => {
    if (subtaskDragActive) endSubtaskDrag();
    else cancelSubtaskHold();
});
// 拖拽中滚动容器会使缓存坐标失效，直接中止以避免错误落点
document.addEventListener('wheel', () => {
    if (subtaskDragActive) endSubtaskDrag();
}, { passive: true });

// 已有子任务文本时，隐藏描述框的"任务详情描述"默认提示字样，只保留输入框
function updateDetailDescriptionPlaceholder() {
    const descInput = document.getElementById('detail-task-description');
    if (!descInput) return;
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    const hasSubtaskText = (task.subtasks || []).some(st => st.text && st.text.trim());
    descInput.placeholder = hasSubtaskText ? '' : '任务详情描述';
}

function renderSubtasks() {
    const container = document.getElementById('subtasks-container');
    if (!container) return;

    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];

    updateDetailDescriptionPlaceholder();

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

    sortedSubtasks.forEach((subtask) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex items-center gap-2 py-1 group subtask-item relative';
        wrapper.dataset.subtaskId = subtask.id;
        wrapper.dataset.completed = subtask.completed ? 'true' : 'false';
        if (subtask.completed) {
            wrapper.classList.add('opacity-60');
        }
        
        const checkbox = document.createElement('button');
        checkbox.className = 'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition border-accent hover:border-accent-hover';
        if (subtask.completed) {
            checkbox.classList.add('bg-gray-400', 'border-gray-400');
            checkbox.classList.remove('border-accent');
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
        input.oninput = () => { autoResizeTextarea(input); saveSubtasksToTask(); updateDetailDescriptionPlaceholder(); };
        
        // 长按行任意位置 300ms 激活拖拽（Pointer Events 驱动，见上方模块说明）；
        // 判定期内移动超过容差或提前松开则静默取消，不影响点击聚焦、双击选词、拖选文本
        wrapper.onpointerdown = (e) => {
            if (e.pointerType === 'touch') return; // 触摸端保持原生滚动，不启用拖拽
            if (e.button !== undefined && e.button !== 0) return;
            if (e.target.closest('button')) return; // 勾选框/删除按钮不参与长按
            cancelSubtaskHold();
            subtaskHoldRow = wrapper;
            subtaskHoldPointerId = e.pointerId;
            subtaskHoldStartX = e.clientX;
            subtaskHoldStartY = e.clientY;
            wrapper.classList.add('subtask-holding');
            subtaskHoldTimer = setTimeout(() => {
                subtaskHoldTimer = null;
                startSubtaskDrag(wrapper, subtask.id, container);
            }, SUBTASK_HOLD_MS);
        };

        const deleteBtn = document.createElement('button');
        // 默认灰色，悬停变深色（hover:text-theme-primary），确认态由 JS 切换为 text-red-500
        deleteBtn.className = 'text-theme-muted hover:text-theme-primary transition flex-shrink-0 p-1 invisible group-hover:visible';
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt text-xs"></i>';
        deleteBtn.title = '删除';
        deleteBtn.onclick = () => requestSubtaskDelete(subtask.id, deleteBtn);

        wrapper.appendChild(checkbox);
        wrapper.appendChild(input);
        wrapper.appendChild(deleteBtn);
        container.appendChild(wrapper);

        // 初始化textarea高度
        autoResizeTextarea(input);
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
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && input.selectionStart === input.selectionEnd) {
        // 上下键在子任务间切换：光标位于首行按↑（或末行按↓）时切换到上/下一个子任务，
        // 光标置于其文本末尾；多行子任务内部仍正常在行间移动光标
        const currentLine = input.value.substring(0, input.selectionStart).split('\n').length;
        const totalLines = input.value.split('\n').length;
        const atFirstLine = event.key === 'ArrowUp' && currentLine === 1;
        const atLastLine = event.key === 'ArrowDown' && currentLine === totalLines;
        if (atFirstLine || atLastLine) {
            const container = document.getElementById('subtasks-container');
            const inputs = container.querySelectorAll('textarea[data-subtask-id]');
            let currentDomIndex = -1;
            inputs.forEach((inp, i) => { if (inp.dataset.subtaskId === subtaskId) currentDomIndex = i; });
            const targetIndex = atFirstLine ? currentDomIndex - 1 : currentDomIndex + 1;
            if (targetIndex >= 0 && targetIndex < inputs.length) {
                event.preventDefault();
                event.stopPropagation();
                const targetInput = inputs[targetIndex];
                targetInput.focus();
                const pos = targetInput.value.length;
                targetInput.setSelectionRange(pos, pos);
            }
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
        const wasTaskCompleted = task.completed;
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

        // 因子任务全部完成而标记任务完成时，与手动完成（toggleTaskComplete）保持一致：生成下一周期重复任务
        if (task.completed && !wasTaskCompleted && task.repeat && task.repeat.type) {
            const nextTask = createNextRepeatTask(task);
            if (nextTask) tasks.push(nextTask);
        }

        saveData();
        renderView();

        // 触发彩蛋效果（子任务完成时）
        if (completed && !wasCompleted) {
            if (typeof easterEgg_onSubtaskComplete === 'function') {
                easterEgg_onSubtaskComplete();
            }
        }

        // 子任务全部完成导致父任务标记为已完成时，通知番茄专注退回"一般专注"
        if (task.completed && !wasTaskCompleted) {
            easterEgg_onTaskComplete(task);
            if (typeof onFocusTaskCompleted === 'function') {
                onFocusTaskCompleted(task.id);
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

// 子任务模式下"任务详情描述"输入框的高度自适应（上限高于标题）
function autoResizeDetailDescription(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

// 将文本按第一个空行拆分：空行前为任务详情描述，空行后为子任务文本
function splitNotesIntoDescriptionAndBody(notes) {
    const text = notes || '';
    const sepIdx = text.indexOf('\n\n');
    if (sepIdx === -1) {
        return { description: '', body: text };
    }
    return { description: text.substring(0, sepIdx), body: text.substring(sepIdx + 2) };
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

// 子任务模式下"任务详情描述"输入框：高度自适应，并实时同步到任务对象
function setupDetailDescriptionInput() {
    const descInput = document.getElementById('detail-task-description');

    // 移除旧的监听器
    descInput.oninput = null;

    descInput.oninput = function() {
        autoResizeDetailDescription(this);
        const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
        if (taskIndex !== -1) {
            tasks[taskIndex].description = this.value;
        }
    };
}

function updateDetailCompleteButton(completed) {
    const btn = document.getElementById('detail-task-complete-btn');
    if (!btn) return;
    const icon = btn.querySelector('i');

    // 移除上一次动态写入的边框/底色类（含优先级配色、完成态灰色与主题色回退），避免切换后残留
    if (Array.isArray(btn._detailBorderClasses) && btn._detailBorderClasses.length) {
        btn.classList.remove(...btn._detailBorderClasses);
    }
    btn._detailBorderClasses = null;

    if (completed) {
        btn._detailBorderClasses = ['bg-gray-400', 'border-gray-400'];
        btn.classList.add(...btn._detailBorderClasses);
        icon.classList.remove('hidden');
        icon.classList.add('text-white');
        icon.classList.remove('text-gray-500');
    } else {
        // 未完成态与任务视图勾选框配色同步：'checkbox' 优先级模式按任务优先级着色，其他模式回退主题色
        const task = tasks.find(t => t.id === currentDetailTaskId);
        btn._detailBorderClasses = (task ? getTaskCheckboxClass(task) : 'border-accent hover:border-accent-hover')
            .split(/\s+/).filter(Boolean);
        btn.classList.add(...btn._detailBorderClasses);
        icon.classList.add('hidden');
        icon.classList.remove('text-white');
    }
}

function toggleTaskDetailComplete() {
    if (!currentDetailTaskId) return;

    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;

    const { structuralChange } = applyTaskCompletionToggle(task);

    updateDetailCompleteButton(task.completed);
    // 完成状态变更后：若已完成则隐藏跳过按钮，撤销快照也一并失效
    refreshDetailSkipCycleButton();
    if (task.completed) {
        _detailSkipUndoSnapshot = null;
        _clearDetailSkipUndoTimer();
    }
    // 日程视图下非结构性变更走局部更新
    if (structuralChange
        || currentView !== 'schedule'
        || typeof refreshScheduleDayCardsForTask !== 'function'
        || !refreshScheduleDayCardsForTask(currentDetailTaskId)) {
        renderView();
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

    // 注意：newTimeInput 的 click 处理已由 HTML 内联 onclick（cloneNode 保留）承担，
    // 不再通过 addEventListener 重复绑定，否则 openTimePicker 会被调用两次，
    // 与 toggle 关闭逻辑组合后会"打开再关闭"，表现为面板不弹出。
    // change 时同步刷新「跳过此周期」按钮：清除时间后重新选日期，按钮需立即恢复显示
    // （快速选择面板选值后也会派发 change 事件，两种输入途径均覆盖）
    newDateInput.addEventListener('change', function() {
        updateDetailTimeBtnText();
        refreshDetailSkipCycleButton();
    });
    newTimeInput.addEventListener('change', function() {
        updateDetailTimeBtnText();
        onDetailAllDayChange();
        refreshDetailSkipCycleButton();
    });

    const endDateInput = document.getElementById('detail-task-end-date');
    const endTimeInput = document.getElementById('detail-task-end-time');
    // 用覆盖式赋值（而非 addEventListener）绑定 change，避免每次打开详情面板都累积一个监听器
    if (endDateInput) endDateInput.onchange = updateDetailTimeBtnText;
    if (endTimeInput) {
        // 同上：endTimeInput DOM 已自带 onclick="openTimePicker(...)"，不重复 addEventListener click
        endTimeInput.onchange = function() {
            updateDetailTimeBtnText();
        };
    }
}

function closeTaskDetailPanel() {
    // 模态浮层模式：关闭时恢复原样式
    if (_taskDetailModalMode) {
        const modalPanel = document.getElementById('task-detail-panel');
        if (modalPanel) {
            modalPanel.className = _taskDetailSavedClassName;
            modalPanel.style.cssText = _taskDetailSavedStyle;
        }
        _taskDetailModalMode = false;
        // 恢复命令面板位置
        _adjustCommandPaletteForDetail(false);
    }
    // 只读模式下不保存任何修改（归档清单中的任务）
    if (detailReadOnly) {
        detailReadOnly = false;
        hideDetailPanel();
        currentDetailTaskId = null;
        detailOpenedFromPlan = false;
        if (_dataRefreshPending) {
            refreshDataFromServer();
        }
        if (planPanelOpen) renderPlanPanel();
        return;
    }
    if (currentDetailTaskId) {
        const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
        if (taskIndex !== -1) {
            const titleFromPanel = document.getElementById('detail-task-title').value;
            if (!titleFromPanel || !titleFromPanel.trim()) {
                const notesFromPanel = document.getElementById('detail-task-notes');
                let hasNotes = !!(notesFromPanel && notesFromPanel.value && notesFromPanel.value.trim());
                // 子任务模式：描述或任一子任务文本有内容时，不算空任务
                if (!hasNotes && currentTaskMode === 'subtasks') {
                    const descValue = document.getElementById('detail-task-description').value;
                    hasNotes = !!(descValue && descValue.trim())
                        || (tasks[taskIndex].subtasks || []).some(st => st.text && st.text.trim());
                }
                if (!hasNotes) {
                    tasks.splice(taskIndex, 1);
                    saveDataImmediate();
                    renderLists();
                    renderView();
                    hideDetailPanel();
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
    hideDetailPanel();
    currentDetailTaskId = null;
    detailOpenedFromPlan = false;
    // 关闭面板：跳过撤销快照与倒计时一并失效
    _detailSkipUndoSnapshot = null;
    _clearDetailSkipUndoTimer();
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
let detailSelectedGroupId = ''; // 详情面板中为任务选中的自定义分组 id（'' 表示未分组）

function populateDetailListSelect(selectedListId) {
    detailSelectedListId = selectedListId || 'default';
    const pillsContainer = document.getElementById('detail-list-pills');
    if (!pillsContainer) return;
    pillsContainer.innerHTML = '';

    lists.filter(l => !l.archived && !l.isFolder).forEach(list => {
        const isSelected = list.id === detailSelectedListId;
        const color = list.color || '#6b7280';
        const btn = document.createElement('button');
        btn.className = isSelected ? 'detail-tag-pill-selected' : 'detail-tag-pill';
        btn.style.setProperty('--tag-color', color);
        btn.title = isSelected ? '当前所属清单' : '点击选择此清单';
        btn.textContent = list.name;
        btn.onclick = (e) => {
            e.stopPropagation();
            const changed = list.id !== detailSelectedListId;
            detailSelectedListId = list.id;
            if (changed) detailSelectedGroupId = ''; // 仅当切换清单时才复位分组；重选同一清单保留已选分组
            populateDetailListSelect(list.id);
            updateDetailListBtnText();
            // 若该清单有自定义分组，保持面板展开以等待用户选择分组；无分组时才收起
            const hasGroups = Array.isArray(list.groups) && list.groups.length > 0;
            if (!hasGroups) {
                document.getElementById('detail-list-picker').classList.add('hidden');
            }
        };
        pillsContainer.appendChild(btn);
    });
    populateDetailGroupSelect();
}

function populateDetailGroupSelect() {
    const row = document.getElementById('detail-group-row');
    if (!row) return;
    const list = getList(detailSelectedListId);
    const groups = (list && Array.isArray(list.groups)) ? list.groups : [];
    row.innerHTML = '';
    if (groups.length === 0) {
        row.classList.add('hidden');
        return;
    }
    row.classList.remove('hidden');
    const color = (list && list.color) || '#6b7280';
    const opts = [{ id: '', name: '默认' }].concat(groups.map(g => ({ id: g.id, name: g.name || '未命名分组' })));
    opts.forEach(opt => {
        const isSel = opt.id === detailSelectedGroupId;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = isSel ? 'detail-group-chip-selected' : 'detail-group-chip';
        btn.style.setProperty('--tag-color', color);
        btn.title = isSel ? '当前分组' : '点击选择此分组';
        btn.textContent = opt.name;
        btn.onclick = (e) => {
            e.stopPropagation();
            detailSelectedGroupId = opt.id;
            populateDetailGroupSelect();
            // 选择分组后收起清单选择面板
            document.getElementById('detail-list-picker').classList.add('hidden');
        };
        row.appendChild(btn);
    });
}

/**
 * 将详情面板当前输入写入任务对象（标题→模式→备注→清单/分组→优先级→提醒→重复→时间）。
 * 供 saveTaskDetail（保存并关闭）/ saveTaskDetailWithoutClose（静默落盘）共用。
 * 三段式结构：先只读 DOM 收集全部待写入值，再做唯一校验，最后统一写入——
 * 校验失败时 task 完全未被触碰，避免「半保存」修改被后续任意 saveData 连带持久化。
 * @param {object} task - 任务对象
 * @param {{fallbackTitle: boolean}} options - fallbackTitle：面板即将关闭时为 true，
 *        空标题且有备注则兜底生成「未命名任务」；面板保持打开时为 false，空标题跳过不写（用户可能继续输入）
 * @returns {boolean} 时间校验失败返回 false（task 未被修改）
 */
function applyDetailInputsToTask(task, options = {}) {
    const fallbackTitle = options.fallbackTitle !== false;

    // ── 第一段：只读 DOM，收集全部待写入值（不触碰 task）──
    // 标题：undefined 表示「不写」（空标题且面板保持打开）；空字符串表示「写空标题」（关闭时兜底）
    let newTitle;
    const titleValue = document.getElementById('detail-task-title').value;
    if (titleValue && titleValue.trim()) {
        newTitle = titleValue;
    } else if (fallbackTitle) {
        const notesValue = document.getElementById('detail-task-notes')?.value;
        newTitle = (notesValue && notesValue.trim()) ? generateUntitledName() : titleValue;
    }

    const mode = currentTaskMode;

    // text 模式：notes 无条件取输入框值；子任务模式：description 无条件取值，
    // notes 仅在有子任务时由排序拼接生成（无子任务时保持原值不动）→ 用 undefined 哨兵区分
    let notes;
    let description;
    if (mode === 'text') {
        notes = document.getElementById('detail-task-notes')?.value ?? '';
    } else {
        description = document.getElementById('detail-task-description')?.value ?? '';
        if (task.subtasks && task.subtasks.length > 0) {
            const sorted = [...task.subtasks].sort((a, b) => {
                if (!a.completed && b.completed) return -1;
                if (a.completed && !b.completed) return 1;
                return (a.originalOrder || 0) - (b.originalOrder || 0);
            });
            notes = sorted.map(st => st.text).join('\n');
        }
    }

    const listId = detailSelectedListId;
    const groupId = detailSelectedGroupId || null;
    const important = detailImportantState;
    const urgent = detailUrgentState;

    // 提醒
    let reminder = 0;
    const reminderSelected = document.querySelector('input[name="detail-reminder"]:checked');
    if (reminderSelected) {
        if (reminderSelected.value === 'custom') {
            const customVal = parseInt(document.getElementById('detail-custom-reminder')?.value);
            reminder = customVal > 0 ? customVal : 0;
        } else if (reminderSelected.value !== '0') {
            reminder = parseInt(reminderSelected.value) || 0;
        }
    }

    // 重复（读取版，不写 task）
    const repeat = getDetailRepeatValueFromForm();

    // 时间解析
    const dateValue = document.getElementById('detail-task-date').value;
    const timeValue = document.getElementById('detail-task-time').value;
    const isAllDay = !timeValue;

    let newStartTime = null;
    if (dateValue && timeValue) {
        newStartTime = new Date(`${dateValue}T${timeValue}`).toISOString();
    } else if (dateValue) {
        newStartTime = new Date(dateValue + 'T00:00:00').toISOString();
    }

    let newEndTime = null;
    if (isTimeRangeMode) {
        const endDateValue = document.getElementById('detail-task-end-date').value;
        const endTimeValue = document.getElementById('detail-task-end-time').value;
        if (endDateValue && endTimeValue && !isAllDay) {
            newEndTime = new Date(`${endDateValue}T${endTimeValue}`).toISOString();
        } else if (endDateValue) {
            newEndTime = new Date(endDateValue + 'T00:00:00').toISOString();
        }
    }

    // ── 第二段：唯一校验点（此刻 task 仍完全未被修改）──
    if (newEndTime && newStartTime && new Date(newEndTime) < new Date(newStartTime)) {
        showToast('结束时间不能早于开始时间', 'warning');
        return false;
    }

    // ── 第三段：校验通过，统一写入 ──
    if (newTitle !== undefined) task.title = newTitle;
    task.mode = mode;
    if (description !== undefined) task.description = description;
    if (notes !== undefined) task.notes = notes;
    task.listId = listId;
    task.groupId = groupId;
    task.important = important;
    task.urgent = urgent;
    task.reminder = reminder;
    task.repeat = repeat;

    if (newStartTime) {
        task.startTime = newStartTime;
        task.isAllDay = isAllDay;
    } else {
        delete task.startTime;
        task.isAllDay = false;
    }
    // 手动修改时间后，清除顺延保留的原始时间
    delete task._originalStartTime;

    if (newEndTime) {
        task.endTime = newEndTime;
    } else {
        delete task.endTime;
    }
    return true;
}

function saveTaskDetail() {
    if (!currentDetailTaskId) return false;

    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return false;

    const task = tasks[taskIndex];
    // 记录修改前今日未完成任务数（用于检测是否因修改日期清空今日任务）
    const beforeTodayIncomplete = (typeof ee_countTodayIncomplete === 'function') ? ee_countTodayIncomplete() : -1;

    // 面板即将关闭：空标题兜底生成「未命名任务」
    if (!applyDetailInputsToTask(task, { fallbackTitle: true })) return false;

    saveData();
    renderView();
    if (typeof renderTags === 'function') renderTags();
    if (typeof renderLists === 'function') renderLists();
    hideDetailPanel();
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
            const quadColors = getQuadrantColorClass(task, { forceBg: true });
            const timeDisplay = task.startTime ? formatTaskListTime(task, { withAllDayTag: false }) : '';

            html += `
                <div class="plan-task-item flex items-center gap-2 py-2 px-2.5 rounded-r-lg ${quadColors.bg} hover:brightness-95 transition cursor-pointer group mb-1"
                     draggable="true"
                     ondragstart="handleTaskDragStart(event, '${task.id}')"
                     ondragend="handlePlanDragEnd(event)"
                     onclick="event.stopPropagation(); detailOpenedFromPlan=true; openTaskDetailPanel('${task.id}')"
                     style="border-left: 3px solid ${listColor}; overflow: hidden;">
                    <span class="flex-1 text-sm text-theme-primary truncate min-w-0 group-hover:text-accent transition-colors duration-150">${task.title || '新任务'}</span>
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
    // 重新渲染面板前，先同步面板中尚未保存的输入（标题、备注等），避免被任务对象的旧值覆盖
    syncDetailPanelInputsToTask(task);
    delete task.startTime;
    delete task.endTime;
    task.isAllDay = false;
    task.reminder = 0;
    saveData();
    openTaskDetailPanel(task.id);
    renderView();
}

// 将详情面板中的日期/时间输入同步到任务对象（不处理 _originalStartTime，由调用方决定是否清除）
// 与 saveTaskDetail 的时间处理逻辑保持一致
function syncDetailTimeInputsToTask(task) {
    if (!task) return;
    const dateValue = document.getElementById('detail-task-date').value;
    const timeValue = document.getElementById('detail-task-time').value;
    const isAllDay = !timeValue;

    if (dateValue && timeValue) {
        task.startTime = new Date(`${dateValue}T${timeValue}`).toISOString();
        task.isAllDay = false;
    } else if (dateValue) {
        task.startTime = new Date(dateValue + 'T00:00:00').toISOString();
        task.isAllDay = true;
    } else {
        delete task.startTime;
        task.isAllDay = false;
    }

    const endContainer = document.getElementById('detail-end-time-container');
    const isRange = endContainer && !endContainer.classList.contains('hidden');
    if (isRange) {
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
}

// 将详情面板中的重复配置选择同步到任务对象（与保存路径的解析逻辑一致）
/**
 * 读取详情面板的重复配置（只读不写）。
 * @returns {object|null} repeat 配置对象；未选择或自定义间隔非法时返回 null
 */
function getDetailRepeatValueFromForm() {
    const repeatSelected = document.querySelector('input[name="detail-repeat"]:checked');
    if (!repeatSelected || !repeatSelected.value || repeatSelected.value === '') {
        return null;
    }
    const repeatModeSelected = document.querySelector('input[name="detail-repeat-mode"]:checked');
    const repeatMode = repeatModeSelected ? repeatModeSelected.value : 'startTime';
    if (repeatSelected.value === 'custom') {
        const interval = parseInt(document.getElementById('detail-custom-repeat-interval').value);
        const unit = document.getElementById('detail-custom-repeat-unit').value;
        if (interval && interval > 0) {
            return { type: 'custom', interval: interval, unit: unit, repeatMode: repeatMode };
        }
        return null;
    }
    const propsAttr = repeatSelected.getAttribute('data-repeat-props');
    if (propsAttr) {
        try {
            const props = JSON.parse(propsAttr);
            return Object.assign({}, props, { repeatMode: repeatMode });
        } catch (e) {
            return { type: repeatSelected.value, repeatMode: repeatMode };
        }
    }
    return { type: repeatSelected.value, repeatMode: repeatMode };
}

// 写入版兼容入口：其余调用点（toggleTaskMode、跳过周期）直接写 task.repeat 后立即使用
function syncDetailRepeatInputToTask(task) {
    if (!task) return;
    task.repeat = getDetailRepeatValueFromForm();
}

// 将详情面板中尚未保存的输入同步到任务对象（不处理时间字段，由调用方自行处理）
function syncDetailPanelInputsToTask(task) {
    if (!task) return;
    const titleValue = document.getElementById('detail-task-title').value;
    if (titleValue && titleValue.trim()) {
        task.title = titleValue;
    }
    task.mode = currentTaskMode;
    if (currentTaskMode === 'text') {
        task.notes = document.getElementById('detail-task-notes').value;
    } else {
        // 子任务模式：同步描述框内容，避免 openTaskDetailPanel 重渲染时被旧值覆盖
        task.description = document.getElementById('detail-task-description').value;
    }
    task.listId = detailSelectedListId;
    task.groupId = detailSelectedGroupId || null;
    task.important = detailImportantState;
    task.urgent = detailUrgentState;
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
        const dateStr = fmtMD(date);
        if (isAllDay) {
            const isRange = !document.getElementById('detail-end-time-container').classList.contains('hidden');
            if (isRange) {
                const endDateValue = document.getElementById('detail-task-end-date').value;
                if (endDateValue && endDateValue !== dateValue) {
                    const endDate = new Date(endDateValue);
                    btnText.textContent = fmtMDRange(date, endDate) + ' (全天)';
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
                        endStr = fmtMD(endDate);
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

    // 已打开时再次点击输入框，关闭面板（与日期选择器的 toggle 行为一致）
    if (!picker.classList.contains('hidden')) {
        picker.classList.add('hidden');
        return;
    }

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
    // 重复配置变化时同步刷新「跳过此周期」按钮（新任务配置重复后立即出现，取消重复后立即隐藏）
    refreshDetailSkipCycleButton();
}

let deleteDetailConfirming = false;

function deleteTaskFromDetail() {
    if (!currentDetailTaskId) return;
    
    if (deleteDetailConfirming) {
        // 彩蛋：断舍离检测（在DOM移除前获取位置）
        const taskEl = document.querySelector(`[onclick*="toggleTaskComplete('${currentDetailTaskId}')"]`) ||
                       document.querySelector(`[onclick*="openTaskDetailPanel('${currentDetailTaskId}')"]`);
        easterEgg_onTaskDelete(taskEl);

        const deletedId = currentDetailTaskId;
        tasks = tasks.filter(t => t.id !== currentDetailTaskId);
        saveData();
        hideDetailPanel();
        currentDetailTaskId = null;
        detailOpenedFromPlan = false;
        deleteDetailConfirming = false;
        if (_detailSkipUndoSnapshot && _detailSkipUndoSnapshot.taskId === deletedId) {
            _detailSkipUndoSnapshot = null;
            _clearDetailSkipUndoTimer();
        }
        renderLists();
        if (typeof renderTags === 'function') renderTags();
        renderView();
        if (planPanelOpen) renderPlanPanel();
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

    // 面板保持打开：空标题跳过不写（用户可能继续输入）
    if (!applyDetailInputsToTask(task, { fallbackTitle: false })) return;

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
                reminderText.textContent = '提醒';
                customInput.classList.add('hidden');
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
                customContainer.classList.add('hidden');
                break;
            case 'weekly':
                repeatText.textContent = '每周';
                customContainer.classList.add('hidden');
                break;
            case 'monthly':
                repeatText.textContent = '每月';
                customContainer.classList.add('hidden');
                break;
            case 'yearly':
                repeatText.textContent = '每年';
                customContainer.classList.add('hidden');
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
                customContainer.classList.add('hidden');
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
        hideDetailPanel();
        currentDetailTaskId = null;
        detailOpenedFromPlan = false;
    }
    if (_detailSkipUndoSnapshot && _detailSkipUndoSnapshot.taskId === taskId) {
        _detailSkipUndoSnapshot = null;
        _clearDetailSkipUndoTimer();
    }
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    renderView();
    showToast('任务已删除', 'success');
}

/**
 * 计算某重复任务「下一个周期」的日期时间
 * @param {object} task - 任务对象（需含 repeat 与 startTime）
 * @param {object} opts
 * @param {boolean} [opts.skipCatchUp=false] - 跳过操作时使用：禁用 startTime 模式下的「追赶周期」逻辑，
 *                                              只推进一个周期（因为用户明确要跳过本期）。
 *                                              false 则保留 createNextRepeatTask 的原行为。
 * @returns {Date|null} 下一周期的 Date（保留原任务时分秒）；无法计算返回 null
 */
function getNextRepeatOccurrence(task, opts = {}) {
    if (!task || !task.repeat || !task.repeat.type) return null;
    if (!task.startTime) return null;

    const skipCatchUp = !!opts.skipCatchUp;
    const repeatMode = task.repeat.repeatMode || 'startTime';
    const baseDate = repeatMode === 'completeTime'
        ? new Date()
        : new Date(task._originalStartTime || task.startTime);
    const completeTime = new Date();

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
                const holidays = [
                    { month: 1, day: 1 },
                    { month: 5, day: 1 },
                    { month: 10, day: 1 },
                ];
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

    let nextDate = computeNextOccurrence(baseDate);

    // 跳过操作时：严格只推进一个周期，不做「追赶」——用户明确要跳过本期。
    if (!skipCatchUp && repeatMode === 'startTime' && nextDate) {
        const completeDateOnly = new Date(completeTime.getFullYear(), completeTime.getMonth(), completeTime.getDate());
        let safetyCount = 0;
        while (nextDate < completeDateOnly && safetyCount < 365) {
            const advanced = computeNextOccurrence(nextDate);
            if (!advanced || advanced.getTime() === nextDate.getTime()) break;
            nextDate = advanced;
            safetyCount++;
        }
    }

    return nextDate;
}

function createNextRepeatTask(task) {
    if (!task.repeat || !task.repeat.type) return null;
    if (!task.startTime) return null;

    const repeatMode = task.repeat.repeatMode || 'startTime';
    const baseDate = repeatMode === 'completeTime'
        ? new Date()
        : new Date(task._originalStartTime || task.startTime);
    const nextDate = getNextRepeatOccurrence(task);
    if (!nextDate) return null;

    const newTask = JSON.parse(JSON.stringify(task));
    newTask.id = generateId();
    newTask.completed = false;
    newTask.completedAt = null;
    newTask.createdAt = new Date().toISOString();
    // 新任务的 startTime 即为新的重复基准，清除顺延保留的原始时间
    delete newTask._originalStartTime;

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

// -------------------- 跳过此周期 / 撤销 --------------------
// 详情面板中当前任务「跳过」后的撤销快照（仅记录最近一次，切换任务/关闭面板/再次跳过即过期）
let _detailSkipUndoSnapshot = null;
let _detailSkipUndoTimerId = null;

/**
 * 根据任务状态刷新详情顶栏的「跳过此周期 / 撤销」按钮可见性
 * - 未完成 + 重复 + 有日期 → 显示跳过按钮（无撤销快照时）
 * - 同一任务有撤销快照 → 显示撤销按钮
 * - 其他 → 两者都隐藏
 */
function refreshDetailSkipCycleButton() {
    const skipBtn = document.getElementById('detail-skip-cycle-btn');
    const undoBtn = document.getElementById('detail-skip-undo-btn');
    if (!skipBtn || !undoBtn) return;

    const hasSnapshot = _detailSkipUndoSnapshot && _detailSkipUndoSnapshot.taskId === currentDetailTaskId;
    const task = tasks.find(t => t.id === currentDetailTaskId);
    // 按钮跟随面板实际状态而非任务对象：新任务尚未保存时，repeat 只存在于面板单选框
    // （面板初始化自任务对象，二者始终一致，以面板为准）。
    // 只要配置了重复就显示按钮，不要求已设置时间（如清除时间后重复配置仍在）；
    // 无时间时点击跳过会提示先设置时间
    const repeatRadio = document.querySelector('input[name="detail-repeat"]:checked');
    let panelHasRepeat = false;
    if (repeatRadio && repeatRadio.value) {
        if (repeatRadio.value === 'custom') {
            // 自定义需间隔有效才算已配置重复
            const interval = parseInt(document.getElementById('detail-custom-repeat-interval').value);
            panelHasRepeat = !!(interval && interval > 0);
        } else {
            panelHasRepeat = true;
        }
    }
    const canSkip = task && !task.completed && panelHasRepeat;

    if (hasSnapshot) {
        skipBtn.classList.add('hidden');
        undoBtn.classList.remove('hidden');
    } else if (canSkip) {
        undoBtn.classList.add('hidden');
        skipBtn.classList.remove('hidden');
    } else {
        skipBtn.classList.add('hidden');
        undoBtn.classList.add('hidden');
    }
}

function _clearDetailSkipUndoTimer() {
    if (_detailSkipUndoTimerId) {
        clearTimeout(_detailSkipUndoTimerId);
        _detailSkipUndoTimerId = null;
    }
}

/**
 * 刷新详情面板（openTaskDetailPanel 会收起时间菜单），刷新后恢复时间菜单原展开状态。
 * 供「跳过此周期 / 撤销」使用：操作后面板内容更新，但设置时间面板不应自动收起。
 */
function reopenTaskDetailPanelKeepTimeMenu(taskId) {
    const timeMenu = document.getElementById('detail-time-menu');
    const menuWasOpen = !!(timeMenu && !timeMenu.classList.contains('hidden'));
    openTaskDetailPanel(taskId);
    if (menuWasOpen) {
        const menu = document.getElementById('detail-time-menu');
        if (menu) menu.classList.remove('hidden');
    }
}

/**
 * 把任务的 startTime / endTime（如有）推进到下一个重复周期（同一条任务，不新建），
 * 并保存撤销快照，供「撤销」按钮恢复。
 */
function skipDetailRepeatCycle() {
    if (!currentDetailTaskId) return;
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    if (task.completed) return;

    // 先同步面板中的日期时间与重复配置到任务对象。覆盖三种情况：
    // 1) 新任务尚未保存（repeat/startTime 仅存在于面板控件）；
    // 2) 清除时间后重新选了日期（任务对象尚无 startTime）；
    // 3) 用户刚在面板修改过日期/重复但尚未保存（跳过应基于用户当前所见配置）。
    const prevStartTimeIso = task.startTime || null;
    syncDetailTimeInputsToTask(task);
    syncDetailRepeatInputToTask(task);
    if (!task.repeat || !task.repeat.type) return;
    // 无时间时无法确定重复基准（如清除时间后重复配置仍在），提示先设置时间
    if (!task.startTime) {
        showToast('请先设置时间，再跳过周期', 'warning');
        return;
    }
    // 面板时间与任务原时间不一致（用户手动改过日期），视为手动设定了新基准，清除顺延锚点
    if (prevStartTimeIso && task.startTime !== prevStartTimeIso) {
        delete task._originalStartTime;
    }

    const nextDate = getNextRepeatOccurrence(task, { skipCatchUp: true });
    if (!nextDate) {
        showToast('无法计算下一个重复周期', 'warning');
        return;
    }

    // 构造撤销快照：保留变更前的关键字段
    const snapshot = {
        taskId: task.id,
        startTime: task.startTime,
        endTime: task.endTime || null,
        isAllDay: !!task.isAllDay,
        originalStartTime: task._originalStartTime || null,
        reminder: task.reminder,
    };

    // 1. 若之前已有顺延的原始基准时间（_originalStartTime），
    //    跳过的「基准日期」应该是该原始时间推进后，而不是本次 startTime 推进。
    //    所以以「基准日期」（_originalStartTime 或 startTime）计算 nextDate 已在 getNextRepeatOccurrence 中处理，
    //    但本次只改任务的显示时间 startTime/endTime，不动 _originalStartTime。
    const isAllDay = !!task.isAllDay;
    const baseTime = new Date(task._originalStartTime || task.startTime);
    const hours = baseTime.getHours();
    const minutes = baseTime.getMinutes();

    let newStartTimeDate;
    if (isAllDay) {
        newStartTimeDate = new Date(formatDate(nextDate) + 'T00:00:00');
    } else {
        newStartTimeDate = new Date(nextDate);
        newStartTimeDate.setHours(hours, minutes, 0, 0);
    }
    task.startTime = newStartTimeDate.toISOString();

    if (task.endTime) {
        const diffMs = new Date(snapshot.endTime).getTime() - new Date(snapshot.startTime).getTime();
        task.endTime = new Date(newStartTimeDate.getTime() + diffMs).toISOString();
    } else {
        delete task.endTime;
    }
    // 不改变 _originalStartTime：顺延+跳过的后续重复周期都应围绕最初设定时间
    // 不改变 task.isAllDay（从 timeInput 判空逻辑可推出，但保持原字段不变更稳）

    // 保存 + 重渲染
    saveData();
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    renderView();

    // 把详情面板输入框和顶部「时间」按钮文本同步到新的日期时间（保持时间菜单展开，操作后不收起）
    reopenTaskDetailPanelKeepTimeMenu(task.id);

    // 记录快照 + 启动撤销倒计时（默认 10s，与 toast 风格一致的时间窗口）
    _clearDetailSkipUndoTimer();
    _detailSkipUndoSnapshot = snapshot;
    _detailSkipUndoTimerId = setTimeout(() => {
        _detailSkipUndoSnapshot = null;
        _detailSkipUndoTimerId = null;
        if (currentDetailTaskId === task.id) {
            refreshDetailSkipCycleButton();
        }
    }, 10000);

    refreshDetailSkipCycleButton();
    const targetDisplay = isAllDay
        ? formatDate(newStartTimeDate) + ' (全天)'
        : formatDateTime(newStartTimeDate);
    showToast(`已跳过此周期，时间调整至 ${targetDisplay}`, 'info', 10);
}

/**
 * 撤销最近一次「跳过此周期」——把 startTime/endTime/_originalStartTime/reminder 等还原到快照。
 */
function undoDetailSkipRepeatCycle() {
    if (!_detailSkipUndoSnapshot) return;
    const snap = _detailSkipUndoSnapshot;
    const taskIndex = tasks.findIndex(t => t.id === snap.taskId);
    if (taskIndex === -1) {
        _detailSkipUndoSnapshot = null;
        _clearDetailSkipUndoTimer();
        return;
    }
    const task = tasks[taskIndex];

    task.startTime = snap.startTime;
    if (snap.endTime) {
        task.endTime = snap.endTime;
    } else {
        delete task.endTime;
    }
    task.isAllDay = snap.isAllDay;
    task.reminder = snap.reminder;
    if (snap.originalStartTime) {
        task._originalStartTime = snap.originalStartTime;
    } else {
        delete task._originalStartTime;
    }

    saveData();
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    renderView();

    // 清理快照
    _detailSkipUndoSnapshot = null;
    _clearDetailSkipUndoTimer();

    if (currentDetailTaskId === task.id) {
        // 撤销后刷新面板输入框，保持时间菜单展开
        reopenTaskDetailPanelKeepTimeMenu(task.id);
        refreshDetailSkipCycleButton();
    }

    showToast('已撤销跳过周期，恢复原时间', 'success');
}

/**
 * 切换任务完成状态的核心逻辑（不含 UI 刷新）。
 * 供 toggleTaskComplete / toggleTaskDetailComplete 共用，锁住保存口径与完成通知的一致性。
 * @param {object} task - 任务对象
 * @returns {{wasCompleted: boolean, structuralChange: boolean}}
 */
function applyTaskCompletionToggle(task) {
    const wasCompleted = task.completed;
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;

    let structuralChange = false;
    if (task.completed && task.repeat && task.repeat.type) {
        const nextTask = createNextRepeatTask(task);
        if (nextTask) {
            tasks.push(nextTask);
        }
        // 新增了重复任务，需全量保存
        saveData();
        structuralChange = true;
    } else {
        // 仅本任务状态变更，增量保存
        saveTaskPatch(task.id);
    }

    // 触发彩蛋效果 + 通知番茄专注（任务完成时）
    if (task.completed && !wasCompleted) {
        easterEgg_onTaskComplete(task);
        if (typeof onFocusTaskCompleted === 'function') {
            onFocusTaskCompleted(task.id);
        }
    }
    return { wasCompleted, structuralChange };
}

function toggleTaskComplete(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        const willComplete = !task.completed;
        // 平滑过渡动画：标记完成时旧条目从左侧勾选框向右擦除、高度塌陷（下方任务向上平移补位），再延迟刷新视图
        let playFx = false;
        if (willComplete && settings.smoothAnimations === true) {
            const anchor = document.querySelector(`[onclick*="toggleTaskComplete('${taskId}')"]`);
            // 各视图任务条目容器已统一附加 task-row 语义类（含看板外层整行），塌陷时整行消失
            const item = anchor ? anchor.closest('.task-row') : null;
            if (item) {
                playFx = true;
                const cs = getComputedStyle(item);
                // 先固定当前尺寸，再加类并塌陷到 0，使 height/margin/padding 可过渡（下方任务上移）
                item.style.height = item.offsetHeight + 'px';
                item.style.marginTop = cs.marginTop;
                item.style.marginBottom = cs.marginBottom;
                item.style.paddingTop = cs.paddingTop;
                item.style.paddingBottom = cs.paddingBottom;
                void item.offsetWidth;
                item.classList.add('fx-task-done');
                item.style.height = '0px';
                item.style.marginTop = '0px';
                item.style.marginBottom = '0px';
                item.style.paddingTop = '0px';
                item.style.paddingBottom = '0px';
            }
        }
        const { structuralChange } = applyTaskCompletionToggle(task);
        renderLists();
        if (typeof renderTags === 'function') renderTags();
        const refresh = () => {
            // 播放过塌陷动画后必须全量重渲染：局部更新会把塌陷条目替换回正常高度，导致下方任务瞬间回弹下移
            if (playFx) {
                renderView();
                return;
            }
            // 日程视图下非结构性变更走局部更新，避免全量重渲染（保持滚动位置、消除跳动）
            if (structuralChange) {
                // 结构性变更（如重复任务生成）必然全量重渲染
                renderView();
            } else if (currentView === 'schedule'
                && typeof refreshScheduleDayCardsForTask === 'function'
                && refreshScheduleDayCardsForTask(taskId)) {
                // 日程视图局部更新成功
            } else if (currentView === 'task'
                && typeof refreshTaskListItemForToggle === 'function'
                && refreshTaskListItemForToggle(taskId)) {
                // 任务列表视图局部更新成功
            } else {
                renderView();
            }
        };
        if (playFx) {
            setTimeout(refresh, 320);
        } else {
            refresh();
        }
    }
}

function editList(listId) {
    editingListId = listId;
    if (typeof listDeleteConfirming !== 'undefined') listDeleteConfirming = null;
    if (typeof listArchiveConfirming !== 'undefined') listArchiveConfirming = null;
    renderLists(true);
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
        // 保留原始设定时间，供 startTime 重复模式计算下次周期使用
        // （顺延只改本次显示日期，不应偏移重复基准）
        if (!task._originalStartTime) {
            task._originalStartTime = task.startTime;
        }
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
    if (typeof listDeleteConfirming !== 'undefined') listDeleteConfirming = null;
    if (typeof listArchiveConfirming !== 'undefined') listArchiveConfirming = null;
    renderLists(true);
}

function hideAddListInput() {
    if (typeof pendingNewFolder !== 'undefined' && pendingNewFolder) {
        if (typeof revertNewFolder === 'function') revertNewFolder();
    }
    editingListId = null;
    if (typeof listDeleteConfirming !== 'undefined') listDeleteConfirming = null;
    if (typeof listArchiveConfirming !== 'undefined') listArchiveConfirming = null;
    renderLists();
}

function saveListInput() {
    const nameEl = document.getElementById('new-list-name');
    if (!nameEl) return;
    const name = nameEl.value.trim();
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
        if (typeof pendingNewFolder !== 'undefined') pendingNewFolder = null;
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

// 点击"所有任务"按钮 - 清除筛选和清单
function filterAllTasks() {
    currentListId = null;
    currentFilter = null;
    currentTagIds = [];
    currentFilterId = null;
    // 视图偏好：「全部任务」有偏好视图时切换到该视图
    const prefView = _getSpecialViewPrefView('allTasks');
    if (prefView && currentView !== prefView) {
        switchView(prefView); // 内部已调用 renderView/renderLists/updateSidebarHighlight
    } else if (!prefView && VIEW_ORDER_DEFAULT.indexOf(currentView) === -1) {
        switchView('task');
    } else {
        // 偏好视图已是当前视图，或无偏好视图但在任务筛选视图中：仅刷新当前视图
        renderView();
        renderLists();
        if (typeof updateSidebarHighlight === 'function') updateSidebarHighlight();
    }
    _saveFilterState();
    if (typeof renderTags === 'function') renderTags();
    if (typeof renderFilters === 'function') renderFilters();
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
