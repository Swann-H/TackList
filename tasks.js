// ==================== 提前提醒（多选）常量 ====================
// 提醒分两层：准点提醒（任务/子任务时间到达时必然弹出，系统固有行为，不可配置、不在面板中展示）
//             提前提醒（用户配置，相对时间点的提前量，最多 5 个）。
// 因此 reminders 数组只存提前量，恒 > 0；准点不走这个数组。
const REMINDER_PRESETS = [
    { minute: 5,    label: '提前 5 分钟' },
    { minute: 15,   label: '提前 15 分钟' },
    { minute: 30,   label: '提前 30 分钟' },
    { minute: 60,   label: '提前 1 小时' },
    { minute: 120,  label: '提前 2 小时' },
    { minute: 1440, label: '提前 1 天' },
];
const REMINDER_MAX_COUNT = 5;
const REMINDER_MAX_MINUTES = 10080; // 7 天
const REMINDER_EMPTY_LABEL = '不提前提醒';

// 当前展开的子任务提醒面板 id（互斥，同一时刻最多展开一个）
let openSubtaskReminderPanelId = null;
// 子任务「管理模式」：开启后每行右侧显示删除按钮（桌面端平时不显示删除按钮）。
// 临时状态，不持久化；关闭面板 / 切换任务 / 切换任务模式 / 按 Esc 都会退出。
let subtaskManageMode = false;

// 归一化提前量数组：过滤非正整数/越界值、去重、降序、截断 5 个
function normalizeReminderMinutes(raw) {
    const out = [];
    if (Array.isArray(raw)) {
        raw.forEach(v => {
            const m = parseInt(v, 10);
            if (!isNaN(m) && m >= 1 && m <= REMINDER_MAX_MINUTES && !out.includes(m)) {
                out.push(m);
            }
        });
    }
    return out.sort((a, b) => b - a).slice(0, REMINDER_MAX_COUNT);
}

// 读取任务/子任务的提前量（兼容旧字段 reminder）
function getAdvanceMinutes(entity) {
    if (!entity) return [];
    if (Array.isArray(entity.reminders)) return normalizeReminderMinutes(entity.reminders);
    const old = parseInt(entity.reminder, 10);
    return (!isNaN(old) && old > 0) ? [old] : [];
}

// 提前量文案：5 分钟 / 1 小时 / 1 天
function formatReminderMinute(minute) {
    const m = parseInt(minute, 10);
    if (isNaN(m)) return '';
    if (m >= 1440 && m % 1440 === 0) {
        const d = m / 1440;
        return d === 1 ? '提前 1 天' : `提前 ${d} 天`;
    }
    if (m >= 60 && m % 60 === 0) {
        const h = m / 60;
        return h === 1 ? '提前 1 小时' : `提前 ${h} 小时`;
    }
    return `提前 ${m} 分钟`;
}

// 提前量列表文案：首项带「提前」，其余只留量词，避免摘要过长
// 例：[30, 5] -> "提前 30 分钟、5 分钟"
function formatAdvanceList(minutes) {
    const list = normalizeReminderMinutes(minutes);
    if (list.length === 0) return '';
    const short = m => formatReminderMinute(m).replace(/^提前\s*/, '');
    return '提前 ' + list.map(short).join('、');
}

// 折叠态摘要：超过 2 项折叠为「提前 X、Y 等 N 项」；无提前量时为「不提前提醒」
function formatReminderSummary(minutes) {
    const list = normalizeReminderMinutes(minutes);
    if (list.length === 0) return REMINDER_EMPTY_LABEL;
    if (list.length <= 2) return formatAdvanceList(list);
    const short = m => formatReminderMinute(m).replace(/^提前\s*/, '');
    return `提前 ${short(list[0])}、${short(list[1])} 等 ${list.length} 项`;
}

// 计算某个提前量的绝对触发时刻文案（无任务时间时返回 '--:--'）
function formatReminderAbsolute(baseIso, minute) {
    if (!baseIso) return '--:--';
    const base = new Date(baseIso);
    if (isNaN(base.getTime())) return '--:--';
    const t = new Date(base.getTime() - minute * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
    const sameDay = t.getFullYear() === base.getFullYear()
        && t.getMonth() === base.getMonth()
        && t.getDate() === base.getDate();
    if (sameDay) return hm;
    return `${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${hm}`;
}

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
    // 象限标题栏拖拽（无 draggedTaskId）：不拦截冒泡，交给卡片级 handleQuadrantCardDrop 调换象限位置
    if (!draggedTaskId) return;
    e.stopPropagation();
    if (draggedTaskId === targetId) return;
    
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
// 外部订阅任务拖拽改期统一拦截（3.3.2）；外部覆盖字段不可本地改期
function _blockExtTaskTimeEdit(task, ev) {
    if (isExternalTask(task)) {
        if (typeof showToast === 'function') showToast('外部订阅日程的时间请在原日历中修改', 'warning');
        if (ev && typeof handleTaskDragEnd === 'function') handleTaskDragEnd(ev);
        return true;
    }
    return false;
}

function handleWeekTimeDrop(event, dateStr) {
    event.preventDefault();
    if (!draggedTaskId) return;

    const task = tasks.find(t => t.id === draggedTaskId);
    if (!task) return;
    if (_blockExtTaskTimeEdit(task, event)) return;

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
    if (_blockExtTaskTimeEdit(task, event)) return;

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
    if (_blockExtTaskTimeEdit(task, e)) return;

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
    if (_blockExtTaskTimeEdit(task, e)) return;

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
    // 拖拽取消（未在有效目标释放）时清理半透明态，避免残留到下次渲染
    e.target.addEventListener('dragend', function () {
        this.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    }, { once: true });
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
    if (_blockExtTaskTimeEdit(task, event)) return;

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
    // 如果当前有打开的空任务详情，先删除空任务（判定统一走面板档 isPanelTaskContentless）
    if (currentDetailTaskId) {
        if (discardEmptyDetailTask()) {
            // 空任务已删除：必须收起面板并清空 id，否则下面 openTaskDetailPanel(newTask.id)
            // 会走进「切换任务」分支，对一个已不存在的 id 再走一次判定与保存
            hideDetailPanel();
            currentDetailTaskId = null;
        } else {
            // 非空任务：走正常关闭流程（内含「标题为空则兜底生成未命名任务」）
            closeTaskDetailPanel();
        }
    }

    const now = new Date();
    
    // 侧边栏上下文（当前选中的清单/标签/过滤器）→ 新任务的默认清单与标签
    const ctx = (typeof getSidebarNewTaskDefaults === 'function') ? getSidebarNewTaskDefaults() : null;
    
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
        listId: (ctx && ctx.listId) || settings.defaultListId || 'default',
        important: (ctx && ctx.important === true) ? true : (settings.defaultImportant || false),
        urgent: (ctx && ctx.urgent === true) ? true : (settings.defaultUrgent || false),
        notes: '',
        tags: (ctx && ctx.tagIds) ? ctx.tagIds.slice() : [],
        startTime: startTime ? startTime.toISOString() : null,
        endTime: null,
        isAllDay: isAllDay,
        reminder: 0,
        repeat: null,
        completed: false,
        createdAt: new Date().toISOString(),
        mode: 'text',
        description: '',
        subtasks: [createSubtask('', 0)],
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
function showDetailPanel(taskId) {
    const panel = document.getElementById('task-detail-panel');
    if (!panel) return;
    // 取消尚未完成的关闭动画，避免面板被延迟 hidden
    if (_detailPanelHideTimer) {
        clearTimeout(_detailPanelHideTimer);
        _detailPanelHideTimer = null;
    }
    // 本次是否真的需要播入场动画：只有「由隐藏变可见」或「正在淡出途中被重新打开」才播。
    // 面板已完整可见时（换看另一条任务）只是换内容，若再补一次 panel-fade-in，
    // fxPanelIn 会整段重播 → 面板从右侧再滑入一次。
    // 该 bug 在四象限展开态尤其明显：接管路径会摘掉 panel-fade-in（改由 VT 补间），
    // 于是下一次「非接管」的换看就成了唯一一次 class 从无到有，动画必播一遍。
    const wasHidden = panel.classList.contains('hidden');
    const wasExiting = panel.classList.contains('panel-fade-out');
    // 同步解除 hidden：后续 renderSubtasks()/autoResizeTextarea 需面板可见才能测量高度
    panel.classList.remove('hidden');
    // 四象限展开态窄轨联动（PRD FR4 方案 B）：「象限重排 + 主区 margin 收缩」交给 qHookDetailPanelToggle，
    // 与面板入场并入同一场 View Transition，同帧起跑、同时长同缓动
    // （taskId 供其实现象限跟随与状态去重：点击缩略格任务时同步切换展开象限，换看任务时不重播象限动画）
    const taken = typeof qHookDetailPanelToggle === 'function'
        && qHookDetailPanelToggle(true, function () { document.body.classList.add('detail-panel-open'); }, taskId);
    if (taken) {
        // 面板入场由过渡的 panel 分组接管（滑入），避免 CSS 关键帧与快照补间相互叠加/相互遮蔽；
        // fx-detail-open 亦由过渡回调内添加，保证主区收缩与卡片 morph 同步
        panel.classList.remove('panel-fade-in', 'panel-fade-out');
        return;
    }
    document.body.classList.add('detail-panel-open');
    if (settings.smoothAnimations === true) {
        // 主界面（含顶部右侧按钮）跟随面板收缩：CSS 过渡 margin-right
        document.body.classList.add('fx-detail-open');
        panel.classList.remove('panel-fade-out');
        if (wasHidden || wasExiting) {
            // 强制重排后再加类，保证同一元素上入场动画必定从头播放
            panel.classList.remove('panel-fade-in');
            void panel.offsetWidth;
            panel.classList.add('panel-fade-in');
        }
    } else {
        document.body.classList.remove('fx-detail-open');
        panel.classList.remove('panel-fade-in', 'panel-fade-out');
    }
}
function hideDetailPanel() {
    _clearExtTaskDetailGuard(); // 关闭面板时移除横幅并恢复控件可编辑（3.3.2）
    openSubtaskReminderPanelId = null; // 收起子任务提醒面板展开态
    subtaskManageMode = false;         // 关闭面板时退出子任务管理模式（临时状态，不残留）
    const panel = document.getElementById('task-detail-panel');
    if (!panel) return;
    // 四象限展开态窄轨联动（PRD FR4 方案 B）：面板的移除同样交给 qHookDetailPanelToggle，
    // 与「象限重排 + 主区 margin 回弹」同场过渡；fx-detail-open 的摘除时机也交给回调，
    // 保证 margin 过渡与卡片 morph 同帧起跑（此前同步摘除会让回弹早于快照补间，收尾出现跳变）
    let taken = false;
    if (typeof qHookDetailPanelToggle === 'function') {
        taken = qHookDetailPanelToggle(false, function () {
            // 旧快照已捕获（面板仍在其中）→ 立即退出实时 DOM，由旧快照分组滑出
            panel.classList.add('hidden');
            document.body.classList.remove('detail-panel-open');
        });
    }
    if (taken) {
        panel.classList.remove('panel-fade-in', 'panel-fade-out');
        return;
    }
    // 移除跟随类，主界面平滑回弹（与面板滑出动画同时进行）
    document.body.classList.remove('fx-detail-open');
    document.body.classList.remove('detail-panel-open');
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

// ==================== 外部订阅任务详情面板守卫（3.3.2 分字段权限）====================
const _EXT_DETAIL_LOCKED_IDS = ['detail-task-title', 'detail-task-notes', 'detail-task-description',
    'detail-task-date', 'detail-task-time', 'detail-task-end-date', 'detail-task-end-time'];

function _applyExtTaskDetailGuard(task) {
    _clearExtTaskDetailGuard();
    if (!task || !task.extSourceId) return;
    // 信息横幅（动态注入，不依赖 HTML 静态结构，双入口自动一致）
    const titleEl = document.getElementById('detail-task-title');
    if (titleEl) {
        const host = titleEl.closest('.p-4');
        if (host && host.parentNode) {
            const banner = document.createElement('div');
            banner.id = 'detail-ext-banner';
            banner.className = 'px-4 py-2 bg-cyan-50 dark:bg-cyan-900/20 border-b border-cyan-200 dark:border-cyan-800 text-xs text-cyan-700 dark:text-cyan-300 flex items-center gap-2 flex-shrink-0';
            banner.innerHTML = '<i class="fas fa-lock"></i><span>外部订阅日程 · 来自 ' +
                escapeHtml(getCalendarSubscriptionName(task.extSourceId)) +
                '，任务标题、时间请在原日历中更改。</span>';
            host.parentNode.insertBefore(banner, host);
        }
    }
    // 锁定外部覆盖字段（readonly + 灰化；文字仍可选中复制，readonly 不阻止选择）
    _EXT_DETAIL_LOCKED_IDS.forEach(function (id) {
        const el = document.getElementById(id);
        if (el) {
            el.setAttribute('readonly', '');
            el.classList.add('opacity-60', 'cursor-not-allowed');
        }
    });
    // 禁用「设置时间」按钮（外部任务不允许展开时间设置面板）
    const timeBtnText = document.getElementById('detail-time-btn-text');
    if (timeBtnText) {
        const timeBtn = timeBtnText.closest('button');
        if (timeBtn) {
            timeBtn.setAttribute('data-ext-locked', '1');
            timeBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }
}

function _clearExtTaskDetailGuard() {
    const banner = document.getElementById('detail-ext-banner');
    if (banner) banner.remove();
    _EXT_DETAIL_LOCKED_IDS.forEach(function (id) {
        const el = document.getElementById(id);
        if (el) {
            el.removeAttribute('readonly');
            el.classList.remove('opacity-60', 'cursor-not-allowed');
        }
    });
    // 恢复「设置时间」按钮
    const timeBtnText = document.getElementById('detail-time-btn-text');
    if (timeBtnText) {
        const timeBtn = timeBtnText.closest('button');
        if (timeBtn) {
            timeBtn.removeAttribute('data-ext-locked');
            timeBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
}

// 详情面板此刻是否正在展示指定任务。
// 必须同时校验 currentDetailTaskId 与面板可见性：淡出动画期间 currentDetailTaskId 已置空但面板尚未加 hidden，
// 只判可见性会误判为「展示中」。
function isDetailPanelShowingTask(taskId) {
    if (!taskId || currentDetailTaskId !== taskId) return false;
    const panel = document.getElementById('task-detail-panel');
    return !!panel && !panel.classList.contains('hidden');
}

// ==================== 「空任务」判定（统一口径） ====================
// 分两档。它们的数据来源与误删代价都不同，不能混用：
//   · 面板档 isPanelTaskContentless()：判断「用户刚新建、还没填东西就放弃了」的任务。
//     标题与备注是 DOM 唯一权威 —— 它们没有实时写回任务对象（setupTitleAutoResize 只做高度自适应，
//     task.notes 只在 saveTaskDetail 里赋值），所以必须读 DOM；而 mode / description / subtasks
//     是实时写回的，读任务对象即可。
//     调用前提：面板正在展示该任务（函数内部会校验，不满足时退回对象档）。
//   · 对象档 isPersistedTaskContentless(task)：判断「持久化数据里的垃圾任务」，供启动清理使用。
//     此时没有任何 DOM 可依赖，且误删不可逆，故取最保守口径：不看 mode，四类内容全查。
// 删除动作与删除后的副作用**不在此统一** —— 四处调用方的落盘方式（节流 / 立即）、是否收起面板、
// 是否重渲染各不相同，属于调用方契约，硬统一会破坏它们。

/** 纯子判定：任务对象层面是否含子任务内容（描述或任一子任务文本）。 */
function hasSubtaskContent(task) {
    if (!task) return false;
    if ((task.description || '').trim()) return true;
    return (task.subtasks || []).some(st => st && st.text && st.text.trim());
}

/**
 * 面板档：详情面板当前展示的任务是否「无任何内容」。
 * 标题/备注读 DOM（权威）；子任务模式分支用 task.mode —— 不用 currentTaskMode，
 * 那是全局面板状态，在没有面板的上下文里恒为 'text'，会漏判子任务内容。
 * @returns {boolean} true = 可安全丢弃
 */
function isPanelTaskContentless() {
    if (!currentDetailTaskId) return false;
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return false;
    // DOM 只在「确认面板正展示该任务」时才可信；否则退回对象档（更保守：宁可留下垃圾，也不误删）
    if (!isDetailPanelShowingTask(task.id)) return isPersistedTaskContentless(task);

    const titleEl = document.getElementById('detail-task-title');
    const currentTitle = titleEl ? titleEl.value : (task.title || '');
    if (currentTitle && currentTitle.trim()) return false;

    const notesEl = document.getElementById('detail-task-notes');
    if (notesEl && notesEl.value && notesEl.value.trim()) return false;

    if ((task.mode || 'text') === 'subtasks') {
        const descEl = document.getElementById('detail-task-description');
        const descValue = descEl ? descEl.value : (task.description || '');
        if (descValue && descValue.trim()) return false;
        if ((task.subtasks || []).some(st => st && st.text && st.text.trim())) return false;
    }
    return true;
}

/**
 * 对象档：这条持久化数据是否「无任何内容」。
 * 不看 mode（保守：文本模式但子任务里有文本的历史数据也不删）；外部日历任务不参与。
 * @returns {boolean} true = 可安全丢弃
 */
function isPersistedTaskContentless(task) {
    if (!task || task.extSourceId) return false;
    if (task.title && task.title.trim()) return false;
    if (task.notes && task.notes.trim()) return false;
    if (hasSubtaskContent(task)) return false;
    return true;
}

/**
 * 丢弃详情面板当前展示的空任务（走面板档判定）。
 * 供「切换任务」等「面板不关闭但当前任务被换掉」的场景复用 —— 这些场景原先只调用
 * saveTaskDetailWithoutClose()，空任务会被当作普通任务保存下来，永久留在列表里。
 * @returns {boolean} true 表示已删除并刷新视图（调用方不要再保存该任务）；
 *                    false 表示任务非空、任务不存在或面板无当前任务。
 * 注意：只负责删掉这个空任务，不隐藏面板、不清 currentDetailTaskId ——
 *       调用方紧接着要展示目标任务；关闭面板仍请走 closeTaskDetailPanel。
 */
function discardEmptyDetailTask() {
    if (!isPanelTaskContentless()) return false;
    const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
    if (taskIndex === -1) return false;

    tasks.splice(taskIndex, 1);
    saveData();
    renderLists();
    renderView();
    return true;
}

/**
 * 启动时清理「残留空任务」（走对象档判定）。
 * 新建任务在创建瞬间就已 push + saveData 落盘（见 openAddTaskModal / kanbanQuickAdd / 周视图网格新建），
 * 若用户不关面板而直接刷新或关闭页面，这个空任务会留在数据里，下次打开就是一张空白卡片。
 * 只在首次加载时调用（见 data.js loadData），不能在 refreshDataFromServer 里调用：
 * 那会把用户正在编辑、尚未落盘内容的空任务删掉。
 * @returns {number} 被删除的任务数
 */
function pruneLeftoverEmptyTasks() {
    if (!Array.isArray(tasks) || !tasks.length) return 0;
    const before = tasks.length;
    for (let i = tasks.length - 1; i >= 0; i--) {
        if (isPersistedTaskContentless(tasks[i])) tasks.splice(i, 1);
    }
    const removed = before - tasks.length;
    if (removed > 0) console.info('[启动清理] 移除 ' + removed + ' 个残留空任务');
    return removed;
}

function openTaskDetailPanel(taskId, readOnly = false, fromClick = false) {
    // 计划面板打开时，主视图点击任务一律先收起计划面板（计划面板内任务项已不再呼出详情面板）
    if (planPanelOpen) {
        const detailPanel = document.getElementById('task-detail-panel');
        if (detailPanel && !detailPanel.classList.contains('hidden')) {
            closeTaskDetailPanel();
        }
        closePlanPanel();
        return;
    }
    // 再次单击同一任务 → 收起详情面板（再点一次重新呼出，如此往复）。
    // fromClick 用于区分「视图内任务项单击」与程序化调用：新建任务后自动呼出、
    // clearTaskTime/reopenTaskDetailPanelKeepTimeMenu 这类重开同一任务、通知点击跳转等一律不参与收起。
    if (fromClick && isDetailPanelShowingTask(taskId)) {
        closeTaskDetailPanel();
        return;
    }
    // 面板正展示其他任务时，先将当前任务尚未落盘的修改（重要/紧急、标题、备注、清单、提醒、重复等）保存到任务对象，避免直接切换丢失
    if (currentDetailTaskId && currentDetailTaskId !== taskId && !detailReadOnly) {
        const visiblePanel = document.getElementById('task-detail-panel');
        if (visiblePanel && !visiblePanel.classList.contains('hidden')) {
            // 当前任务若是「新建后什么都没填」的空任务，切换时按关闭面板的口径直接删除，
            // 而不是当作普通任务保存下来（否则空任务会永久留在列表里）。
            // 目标任务不存在时保持原逻辑：只保存、不删除。
            const targetExists = tasks.some(t => t.id === taskId);
            if (!targetExists || !discardEmptyDetailTask()) {
                saveTaskDetailWithoutClose();
            }
        }
    }
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    currentDetailTaskId = taskId;
    isTimeRangeMode = !!task.endTime;
    detailReadOnly = readOnly;
    // 切换任务时退出子任务管理模式（临时状态，不跨任务残留）
    exitSubtaskManageMode();
    _applyExtTaskDetailGuard(task); // 外部任务：注入横幅 + 锁定外部覆盖字段（3.3.2）
    
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
    
    // 设置提前提醒（准点提醒为系统固有行为，无需回填）
    document.getElementById('detail-custom-reminder').value = '';
    document.getElementById('detail-custom-reminder').classList.remove('border-red-500');
    renderDetailReminderPanel();
    
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
        _setSubtasksAreaVisible(true);
        document.getElementById('toggle-mode-btn').innerHTML = '<i class="fas fa-edit"></i>';
        document.getElementById('toggle-mode-btn').title = '文本模式';
    } else {
        document.getElementById('detail-task-notes').classList.remove('hidden');
        descInput.classList.add('hidden');
        _setSubtasksAreaVisible(false);
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
    showDetailPanel(taskId);
    
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
    
    // 提前提醒：选择时已即时写回，这里只做归一化与旧字段镜像同步
    // （准点提醒为系统固有行为，不参与配置；外部日历任务强制清空）
    const _isExt = !!task.extSourceId;
    const remindersNow = _isExt ? [] : getDetailRemindersFromForm();
    task.reminders = remindersNow;
    task.reminder = remindersNow.length ? Math.max(...remindersNow) : 0;
    
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
            // 总是用当前文本重新生成子任务；文本未变的行沿用原对象，
            // 避免切换模式时丢失已设置的时间与提前提醒（按文本配对，插入行不会整体错位）
            const pool = new Map();
            (task.subtasks || []).forEach(st => {
                const k = (st.text || '').trim();
                if (k) pool.set(k, (pool.get(k) || []).concat([st]));
            });
            task.subtasks = lines.map((line, i) => {
                const bucket = pool.get(line.trim());
                if (bucket && bucket.length) {
                    return { ...bucket.shift(), text: line, originalOrder: i };
                }
                return createSubtask(line, i);
            });
        }
        if (!task.subtasks || task.subtasks.length === 0) {
            task.subtasks = [createSubtask('', 0)];
        }
        // 先切换显示，再渲染子任务（确保scrollHeight正确计算）
        document.getElementById('detail-task-notes').classList.add('hidden');
        document.getElementById('detail-task-description').classList.remove('hidden');
        autoResizeDetailDescription(document.getElementById('detail-task-description'));
        _setSubtasksAreaVisible(true);
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
        _setSubtasksAreaVisible(false);
        document.getElementById('toggle-mode-btn').innerHTML = '<i class="fas fa-list-ul"></i>';
        document.getElementById('toggle-mode-btn').title = '切换任务模式';
    }
    // 立即写入 task.mode，确保面板打开期间的中间保存（saveData）携带正确的 mode，
    // 避免版本冲突合并时被服务器旧 mode 覆盖
    task.mode = currentTaskMode;
}

// 新建子任务的统一构造（含时间与提前提醒字段，缺省为无时间、无提前量）
function createSubtask(text, order) {
    return {
        id: generateId(),
        text: text || '',
        completed: false,
        originalOrder: order || 0,
        completedAt: null,
        startTime: null,   // 子任务独立时间；null = 无时间（不提醒）
        reminders: []      // 仅存提前量，恒 > 0；空数组 = 仅准点提醒
    };
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
            completedAt: existing ? existing.completedAt : null,
            // 白名单重建：新增字段必须在此同步，否则失焦即丢
            startTime: existing ? (existing.startTime || null) : null,
            reminders: existing ? normalizeReminderMinutes(existing.reminders) : []
        });
    });
    if (newSubtasks.length === 0) {
        newSubtasks.push(createSubtask('', 0));
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
    const subtasks = task.subtasks || [createSubtask('', 0)];

    // 展开的面板若对应的子任务已不存在（被删除/切换任务），清除展开状态
    if (openSubtaskReminderPanelId && !subtasks.some(st => st.id === openSubtaskReminderPanelId)) {
        openSubtaskReminderPanelId = null;
    }
    
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
        // 外层容器：垂直堆叠「内层操作行 + 内联提醒面板」
        // 注意：拖拽逻辑以 .subtask-item 为「行元素」（缓存 rect 画插入线），故外层必须是 .subtask-item
        const wrapper = document.createElement('div');
        wrapper.className = 'subtask-item relative';
        // 面板展开态：让该行右侧保持显示铃铛（而不是回落到时间文本）
        if (openSubtaskReminderPanelId === subtask.id) {
            wrapper.classList.add('panel-open');
        }
        if (subtask.completed) {
            wrapper.classList.add('subtask-completed', 'opacity-60');
        }
        wrapper.dataset.subtaskId = subtask.id;
        wrapper.dataset.completed = subtask.completed ? 'true' : 'false';

        // 内层操作行：勾选 + 文本 + 铃铛 + 删除（group 用于删除按钮的 hover 显隐）
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 py-1 group';

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
        // 铃铛/删除按钮、右侧时间文字、提醒面板不参与长按
        wrapper.onpointerdown = (e) => {
            if (e.pointerType === 'touch') return; // 触摸端保持原生滚动，不启用拖拽
            if (e.button !== undefined && e.button !== 0) return;
            if (e.target.closest('button, .subtask-slot, .subtask-reminder-panel')) return;
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

        // 右侧「共用位置」：时间文本与铃铛。
        // 有时间文本 → 常显，悬浮到文本上只变蓝提示可点击（点击即打开提醒面板），不换显铃铛；
        // 没有时间文本 → 未悬浮什么都不显示，悬浮该行才出铃铛。
        // 两者都固定 20×20 高，避免悬浮时行高变化导致下方内容跳动（见 CSS 注释）。
        const slot = document.createElement('span');
        slot.className = 'subtask-slot';

        const timeLabel = document.createElement('span');
        timeLabel.className = 'subtask-time-label text-theme-muted';
        _fillSubtaskTimeLabel(timeLabel, subtask.startTime);
        timeLabel.onclick = (e) => { e.stopPropagation(); toggleSubtaskReminderPanel(subtask.id); };

        // 铃铛：只在「该行没有时间文本」时作为悬浮入口出现。
        // 不再区分「是否已配提前提醒」（原先的蓝色 + 右上角圆点已去掉）。
        const bellBtn = document.createElement('button');
        bellBtn.className = 'subtask-bell-btn';
        bellBtn.innerHTML = '<i class="fas fa-bell text-xs"></i>';
        bellBtn.title = '设置时间与提醒';
        bellBtn.onclick = (e) => { e.stopPropagation(); toggleSubtaskReminderPanel(subtask.id); };

        slot.appendChild(timeLabel);
        slot.appendChild(bellBtn);

        const deleteBtn = document.createElement('button');
        // 桌面端平时不显示（CSS display:none），仅在「管理模式」出现；
        // 触摸设备由 @media (hover: none) 常显。subtask-delete-btn 同时是这两条规则的钩子。
        deleteBtn.className = 'subtask-delete-btn';
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt text-xs"></i>';
        deleteBtn.title = '删除';
        deleteBtn.onclick = () => requestSubtaskDelete(subtask.id, deleteBtn);

        row.appendChild(checkbox);
        row.appendChild(input);
        row.appendChild(slot);
        row.appendChild(deleteBtn);
        wrapper.appendChild(row);

        // 若该行处于展开态，重建提醒面板（保证重渲染后不丢失展开状态）
        if (openSubtaskReminderPanelId === subtask.id) {
            wrapper.appendChild(buildSubtaskReminderPanel(subtask));
        }

        container.appendChild(wrapper);

        // 初始化textarea高度
        autoResizeTextarea(input);
    });
}

// ==================== 子任务：时间与提前提醒面板 ====================
// 本地日期/时间字符串（YYYY-MM-DD / HH:MM），用于 input[type=date|time]
function _toLocalDateStr(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function _toLocalTimeStr(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 子任务时间的行内文案（显示在子任务行右侧），返回两段：{ date, clock }。
// 渲染成两行：上行是日期/相对标签（小一号、更淡），下行是时刻（主信息）。
// 按「距今天数」分级，越近越具体：
//   今天            → date 空 + 08:00（只显示时刻，见文档 §15）
//   明天 / 后天      → 明天 / 08:00
//   本周内（未过去） → 周日 / 18:00
//   已过去 / 下周及以后 → 9/21 / 18:00；**不在本年度时带年份** → 2027/1/5 / 18:00
// 「本周」按设置里的周起始日（settings.weekStart）划定，与项目其它周视图口径一致。
// 已过去的日期一律带月日：否则「周三 18:00」会让人分不清是本周三还是上周三。
// 非本年度的日期必须带年份（否则「1/5」分不清今年还是明年）；
// 跨年那一周也不用「周X」（如 12/31 与次年 1/2 同周，写「周五」会分不清哪一年）。
function parseSubtaskTimeLabel(iso) {
    if (!iso) return { date: '', clock: '' };
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: '', clock: '' };

    const pad = n => String(n).padStart(2, '0');
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const now = new Date();
    // 非本年度的日期必须带年份：只写「1/5」分不清是今年还是明年
    const sameYear = d.getFullYear() === now.getFullYear();
    const md = sameYear
        ? `${d.getMonth() + 1}/${d.getDate()}`
        : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;

    // 用 UTC 化的年月日算天数差，避免夏令时导致 23/25 小时误差
    const dayDiff = Math.round(
        (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
            - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000
    );

    // 今天只给时刻（日期行留空）；其余档位都给「日期行 + 时刻行」两段
    if (dayDiff === 0) return { date: '', clock: hm };
    if (dayDiff === 1) return { date: '明天', clock: hm };
    if (dayDiff === 2) return { date: '后天', clock: hm };
    if (dayDiff < 0) return { date: md, clock: hm };   // 已过去：带月日，避免「本周三 / 上周三」歧义

    const weekStartsOnMonday = (typeof settings !== 'undefined' && settings.weekStart === 'monday');
    const weekStart = getWeekStartDate(now, weekStartsOnMonday);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    // 本周内**且同年**才用「周X」：跨年那一周（如 12/31 与 1/2 同周）用「周五」会分不清哪一年
    if (sameYear && target >= weekStart && target <= weekEnd) {
        return { date: `周${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}`, clock: hm };
    }
    return { date: md, clock: hm };
}

// 兼容用：拼成一行字符串（测试与需要纯文本的场景）
function formatSubtaskTimeLabel(iso) {
    const p = parseSubtaskTimeLabel(iso);
    return p.date ? `${p.date} ${p.clock}` : p.clock;
}

// 把时间文案填成两行（方案 B 主次）：上行日期/相对标签（小一号、更淡），下行时刻。
// 「今天」没有日期段 → 只有时刻一行；靠 CSS 的 min-height + flex-end 与其他行底部对齐。
function _fillSubtaskTimeLabel(el, iso) {
    if (!el) return;
    const parts = parseSubtaskTimeLabel(iso);
    el.textContent = '';
    if (!parts.clock) {
        el.classList.add('hidden');
        return;
    }
    el.classList.remove('hidden');
    if (parts.date) {
        const dateEl = document.createElement('span');
        dateEl.className = 'subtask-time-date';
        dateEl.textContent = parts.date;
        el.appendChild(dateEl);
    }
    const clockEl = document.createElement('span');
    clockEl.className = 'subtask-time-clock';
    clockEl.textContent = parts.clock;
    el.appendChild(clockEl);
}

// 构建子任务提醒面板（时间选择 + 提前提醒多选）
function buildSubtaskReminderPanel(subtask) {
    const panel = document.createElement('div');
    // advance-collapsed：提前提醒配置区默认折叠（见下方 toggle），只留标题行 + N/5 计数
    panel.className = 'subtask-reminder-panel advance-collapsed';
    panel.dataset.subtaskId = subtask.id;

    // —— 时间 ——
    const timeLabel = document.createElement('div');
    timeLabel.className = 'text-xs font-medium text-theme-secondary mb-1';
    timeLabel.textContent = '时间';
    panel.appendChild(timeLabel);

    const timeRow = document.createElement('div');
    timeRow.className = 'flex items-center gap-1';

    // 每个输入框各自套一层 relative 容器，让快速选择下拉定位到「该输入框正下方」。
    // 与详情面板 #detail-task-date / #detail-task-time 的结构完全一致
    // （不能把下拉直接放进 flex 行里：absolute 元素在 flex 容器中的静态位置会跑到行尾，
    //   导致下拉盖住输入框本身）。
    const dateWrap = document.createElement('div');
    dateWrap.className = 'relative flex-1 min-w-0';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'subtask-date-input w-full px-2 py-1 text-xs border border-theme rounded bg-theme-secondary text-theme-primary cursor-pointer';

    const datePicker = document.createElement('div');
    datePicker.id = `subtask-date-picker-${subtask.id}`;
    datePicker.className = 'hidden absolute left-0 right-0 mt-1 bg-theme-tertiary rounded-lg border border-theme z-30 shadow-lg max-h-48 overflow-y-auto';

    const timeWrap = document.createElement('div');
    timeWrap.className = 'relative w-20 flex-shrink-0';

    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.className = 'subtask-time-input w-full px-2 py-1 text-xs border border-theme rounded bg-theme-secondary text-theme-primary cursor-pointer';

    const timePicker = document.createElement('div');
    timePicker.id = `subtask-time-picker-${subtask.id}`;
    timePicker.className = 'hidden absolute left-0 right-0 mt-1 bg-theme-tertiary rounded-lg border border-theme z-30 shadow-lg max-h-48 overflow-y-auto';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'flex-shrink-0 px-2 py-1 text-xs rounded border border-theme text-theme-secondary hover:bg-theme-secondary transition whitespace-nowrap';
    clearBtn.textContent = '清除';
    clearBtn.onclick = (e) => { e.stopPropagation(); clearSubtaskTime(subtask.id); };

    // 回填：优先用子任务自己的时间；子任务尚未设时间时，默认带出所属任务的日期，
    // 省去用户重复选择（子任务时间独立不继承，这里只是「默认值」，不写库——
    // 时刻仍为空，所以不会因此产生提醒）
    if (subtask.startTime) {
        const d = new Date(subtask.startTime);
        if (!isNaN(d.getTime())) {
            dateInput.value = _toLocalDateStr(d);
            timeInput.value = _toLocalTimeStr(d);
        }
    } else {
        const ownerTask = tasks.find(t => t.id === currentDetailTaskId);
        if (ownerTask && ownerTask.startTime) {
            const td = new Date(ownerTask.startTime);
            if (!isNaN(td.getTime())) dateInput.value = _toLocalDateStr(td);
        }
    }

    dateInput.onclick = (e) => {
        e.stopPropagation();
        openDatePicker(dateInput, datePicker.id, () => saveSubtaskTimeFromPanel(subtask.id));
    };
    timeInput.onclick = (e) => {
        e.stopPropagation();
        openTimePicker(timeInput, timePicker.id, () => saveSubtaskTimeFromPanel(subtask.id));
    };
    // 移动端 mobile.js 会让 openDatePicker/openTimePicker 直接返回、改用浏览器原生控件
    // （原生控件不会调用上面的 onPicked），因此必须靠 change 事件提交。
    // 桌面端自定义选择器也会派发 change，重复提交是幂等的。
    dateInput.onchange = () => saveSubtaskTimeFromPanel(subtask.id);
    timeInput.onchange = () => saveSubtaskTimeFromPanel(subtask.id);

    dateWrap.appendChild(dateInput);
    dateWrap.appendChild(datePicker);
    timeWrap.appendChild(timeInput);
    timeWrap.appendChild(timePicker);
    timeRow.appendChild(dateWrap);
    timeRow.appendChild(timeWrap);
    timeRow.appendChild(clearBtn);
    panel.appendChild(timeRow);

    // —— 提前提醒 ——
    // 提前提醒标题行：同时是折叠开关（默认折叠，只留标题 + N/5 计数）。
    // 用 <button> 以便键盘可达；点击冒泡到面板的 click 监听，顺带收起已展开的下拉。
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'subtask-advance-toggle w-full flex items-center justify-between border-t border-theme mt-2 pt-1 mb-1 text-left';
    head.setAttribute('aria-expanded', 'false');
    head.title = '展开/收起提前提醒配置';

    const headLeft = document.createElement('span');
    headLeft.className = 'flex items-center gap-1 text-xs font-medium text-theme-secondary';
    const chevron = document.createElement('i');
    chevron.className = 'fas fa-chevron-right subtask-advance-chevron text-[10px] transition-transform duration-150';
    const headLabel = document.createElement('span');
    headLabel.textContent = '提前提醒';
    headLeft.appendChild(chevron);
    headLeft.appendChild(headLabel);

    const countEl = document.createElement('span');
    countEl.className = 'subtask-reminder-count text-xs text-theme-muted';
    countEl.textContent = `0/${REMINDER_MAX_COUNT}`;

    head.appendChild(headLeft);
    head.appendChild(countEl);
    head.onclick = () => {
        const collapsed = panel.classList.toggle('advance-collapsed');
        head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };
    panel.appendChild(head);

    const optionsEl = document.createElement('div');
    optionsEl.className = 'subtask-reminder-options space-y-0.5';
    panel.appendChild(optionsEl);

    // —— 自定义提前量 ——
    const customRow = document.createElement('div');
    customRow.className = 'subtask-reminder-custom-row flex items-center gap-1 border-t border-theme mt-1 pt-1';
    const customInput = document.createElement('input');
    customInput.type = 'number';
    customInput.min = '1';
    customInput.max = String(REMINDER_MAX_MINUTES);
    customInput.placeholder = '提前分钟数';
    customInput.className = 'subtask-custom-reminder flex-1 min-w-0 px-2 py-1 text-xs border border-theme rounded bg-theme-secondary text-theme-primary';
    const customAdd = document.createElement('button');
    customAdd.type = 'button';
    customAdd.className = 'px-2 py-1 text-xs rounded border border-theme text-theme-secondary hover:bg-theme-secondary transition whitespace-nowrap';
    customAdd.textContent = '+ 添加';
    customAdd.onclick = (e) => { e.stopPropagation(); addSubtaskCustomReminder(subtask.id); };
    customInput.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addSubtaskCustomReminder(subtask.id); }
    };
    customRow.appendChild(customInput);
    customRow.appendChild(customAdd);
    panel.appendChild(customRow);

    // 面板内点击：阻止冒泡到 document（避免触发"点击面板外关闭面板"以及详情面板的浮层关闭逻辑），
    // 但同时收起面板内已展开的快速选择下拉——与详情面板"点击选择器外即收起"的口径一致。
    // 注意：日期/时间输入框与其下拉项自身的 onclick 已 stopPropagation，不会走到这里。
    panel.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllTimePickers();
    });

    _fillSubtaskPanelOptions(panel, subtask);
    return panel;
}

// 渲染面板内的提前量多选列表 + 计数
function _fillSubtaskPanelOptions(panel, subtask) {
    const optionsEl = panel.querySelector('.subtask-reminder-options');
    const countEl = panel.querySelector('.subtask-reminder-count');
    const selected = getAdvanceMinutes(subtask);
    updateAdvanceReminderCount(countEl, selected);
    renderAdvanceReminderOptions(optionsEl, selected, subtask.startTime || null, (next) => {
        const task = tasks.find(t => t.id === currentDetailTaskId);
        if (!task) return;
        const st = (task.subtasks || []).find(x => x.id === subtask.id);
        if (!st) return;
        st.reminders = next;
        saveSubtasksToTask();
        saveData();
        refreshSubtaskReminderPanel(subtask.id);
    }, countEl);
}

// 局部刷新：铃铛 active 态 + 右侧时间文字 + 面板内容（不动时间输入框，避免打断编辑）
function refreshSubtaskReminderPanel(subtaskId) {
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;
    const subtask = (task.subtasks || []).find(st => st.id === subtaskId);
    if (!subtask) return;

    const item = document.querySelector(`#subtasks-container .subtask-item[data-subtask-id="${subtaskId}"]`);
    if (!item) return;

    const panel = item.querySelector('.subtask-reminder-panel');

    // 右侧「共用位置」里的时间文字（铃铛是否显示由 CSS 按 hover / 展开态决定，不在这里管）
    _fillSubtaskTimeLabel(item.querySelector('.subtask-time-label'), subtask.startTime);

    if (panel) _fillSubtaskPanelOptions(panel, subtask);
}

// 展开/收起子任务提醒面板（互斥：同时只展开一个）
function toggleSubtaskReminderPanel(subtaskId) {
    const container = document.getElementById('subtasks-container');
    if (!container) return;
    const item = container.querySelector(`.subtask-item[data-subtask-id="${subtaskId}"]`);
    if (!item) return;

    const existing = item.querySelector('.subtask-reminder-panel');
    if (existing) {
        closeSubtaskReminderPanel();
        return;
    }

    // 互斥：折叠其他行已展开的面板
    container.querySelectorAll('.subtask-reminder-panel').forEach(p => {
        if (p.dataset.subtaskId !== subtaskId) {
            p.remove();
            _setSubtaskPanelOpen(p.dataset.subtaskId, false);
        }
    });

    // 打开前收起详情面板的其它浮层，避免叠加
    const rp = document.getElementById('detail-reminder-picker');
    if (rp) rp.classList.add('hidden');
    const rpp = document.getElementById('detail-repeat-picker');
    if (rpp) rpp.classList.add('hidden');
    closeAllTimePickers();

    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;
    const subtask = (task.subtasks || []).find(st => st.id === subtaskId);
    if (!subtask) return;

    item.appendChild(buildSubtaskReminderPanel(subtask));
    openSubtaskReminderPanelId = subtaskId;
    _setSubtaskPanelOpen(subtaskId, true);
}

// 面板展开期间让该行保持显示铃铛（而不是回落到时间文本）：
// 否则鼠标移进面板后铃铛消失，用户看不出是哪一行处于展开态。
function _setSubtaskPanelOpen(subtaskId, open) {
    const container = document.getElementById('subtasks-container');
    if (!container) return;
    const item = container.querySelector(`.subtask-item[data-subtask-id="${subtaskId}"]`);
    if (item) item.classList.toggle('panel-open', open);
}

// ==================== 子任务「管理模式」 ====================
// 桌面端平时不显示每行的删除按钮（行右侧只留「时间文本 / 铃铛」共用位置），
// 点开管理入口后才把所有删除按钮放出来，避免按钮过多。
// 触摸设备不走这套：那边删除按钮本来就常显（见 @media (hover: none)），入口也不显示。

function _setSubtasksAreaVisible(visible) {
    // 子任务模式涉及两块内容，必须同步显隐：
    //   #subtask-desc-row —— 详情说明行（右端挂着「编辑/管理」入口）
    //   #subtasks-area    —— 子任务列表
    // 二者都靠 .hidden 控制；入口本身用 opacity 占位，所以行高/宽度不会因显隐变化。
    const area = document.getElementById('subtasks-area');
    const descRow = document.getElementById('subtask-desc-row');
    if (area) area.classList.toggle('hidden', !visible);
    if (descRow) descRow.classList.toggle('hidden', !visible);
    if (!visible) exitSubtaskManageMode(); // 离开子任务模式即退出管理态
}

function toggleSubtaskManageMode() {
    subtaskManageMode = !subtaskManageMode;
    _applySubtaskManageMode();
}

function exitSubtaskManageMode() {
    if (!subtaskManageMode) return;
    subtaskManageMode = false;
    _applySubtaskManageMode();
}

function _applySubtaskManageMode() {
    const container = document.getElementById('subtasks-container');
    const btn = document.getElementById('subtask-manage-btn');
    if (container) container.classList.toggle('subtask-manage', subtaskManageMode);
    if (btn) {
        btn.classList.toggle('on', subtaskManageMode);
        btn.title = subtaskManageMode ? '完成管理' : '批量管理子任务';
    }
    if (subtaskManageMode) {
        // 进入管理模式时收起已展开的提醒面板：
        // 否则「行右侧被删除按钮替换」与「面板内的时间输入」并存，状态容易混淆
        closeSubtaskReminderPanel();
        resetSubtaskDeleteConfirm();
    }
}

// 管理模式是临时状态：这些入口都必须退出，避免状态残留
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && subtaskManageMode) exitSubtaskManageMode();
});

// 关闭子任务提醒面板：先提交面板中可能被直接键入的时间，再移除面板。
// 提前提醒是勾选即时写回的，无需在此保存。
function closeSubtaskReminderPanel() {
    const id = openSubtaskReminderPanelId;
    if (!id) return;
    commitSubtaskTimeInputs(id);          // 必须在移除面板之前读值
    const panel = document.querySelector(`.subtask-reminder-panel[data-subtask-id="${id}"]`);
    if (panel) panel.remove();
    openSubtaskReminderPanelId = null;
    _setSubtaskPanelOpen(id, false);
}

// 把面板里的日期/时间输入写回子任务（只写数据，不刷新 UI）
// 子任务必须带确切时刻：只有日期没有时间视为「无时间」
function commitSubtaskTimeInputs(subtaskId) {
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return false;
    const subtask = (task.subtasks || []).find(st => st.id === subtaskId);
    if (!subtask) return false;

    const panel = document.querySelector(`.subtask-reminder-panel[data-subtask-id="${subtaskId}"]`);
    if (!panel) return false;
    const dateEl = panel.querySelector('.subtask-date-input');
    const timeEl = panel.querySelector('.subtask-time-input');
    if (!dateEl || !timeEl) return false;

    const dateStr = dateEl.value;
    const timeStr = timeEl.value;
    let next = null;
    if (dateStr && timeStr) {
        const d = new Date(`${dateStr}T${timeStr}`);
        next = isNaN(d.getTime()) ? null : d.toISOString();
    }

    const changed = (subtask.startTime || null) !== next;
    subtask.startTime = next;
    saveSubtasksToTask();
    saveData();
    return changed;
}

// 快速选择器选中后：写入 + 局部刷新（右侧时间文字与绝对时间）
function saveSubtaskTimeFromPanel(subtaskId) {
    commitSubtaskTimeInputs(subtaskId);
    refreshSubtaskReminderPanel(subtaskId);
}

// 清除子任务的时间与提前提醒
function clearSubtaskTime(subtaskId) {
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;
    const subtask = (task.subtasks || []).find(st => st.id === subtaskId);
    if (!subtask) return;

    subtask.startTime = null;
    subtask.reminders = [];

    // 清空时一并收起面板内已展开的快速选择下拉
    closeAllTimePickers();

    const panel = document.querySelector(`.subtask-reminder-panel[data-subtask-id="${subtaskId}"]`);
    if (panel) {
        const di = panel.querySelector('.subtask-date-input');
        const ti = panel.querySelector('.subtask-time-input');
        if (di) di.value = '';
        if (ti) ti.value = '';
        const ci = panel.querySelector('.subtask-custom-reminder');
        if (ci) ci.value = '';
    }

    saveSubtasksToTask();
    saveData();
    refreshSubtaskReminderPanel(subtaskId);
}

// 自定义提前量：校验 + 添加
function addSubtaskCustomReminder(subtaskId) {
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;
    const subtask = (task.subtasks || []).find(st => st.id === subtaskId);
    if (!subtask) return;

    const panel = document.querySelector(`.subtask-reminder-panel[data-subtask-id="${subtaskId}"]`);
    if (!panel) return;
    const input = panel.querySelector('.subtask-custom-reminder');
    const countEl = panel.querySelector('.subtask-reminder-count');
    if (!input) return;

    const val = parseInt(input.value, 10);
    const cur = getAdvanceMinutes(subtask);
    const reject = (msg) => {
        input.classList.add('border-red-500');
        setTimeout(() => input.classList.remove('border-red-500'), 1200);
        if (msg) showToast(msg, 'warning');
    };

    if (isNaN(val) || val < 1 || val > REMINDER_MAX_MINUTES) {
        reject(`请输入 1 ~ ${REMINDER_MAX_MINUTES} 之间的分钟数`);
        return;
    }
    if (cur.includes(val)) {
        reject('该提前量已存在');
        return;
    }
    if (cur.length >= REMINDER_MAX_COUNT) {
        shakeReminderLimit(countEl);
        showToast(`最多 ${REMINDER_MAX_COUNT} 个提前提醒`, 'warning');
        return;
    }

    subtask.reminders = normalizeReminderMinutes([...cur, val]);
    input.value = '';
    saveSubtasksToTask();
    saveData();
    refreshSubtaskReminderPanel(subtaskId);
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
        const newSubtask = createSubtask(textAfter, newOriginalOrder);
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
            const newSubtask = createSubtask('', maxOrder + 1);
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

// 勾选/取消勾选子任务。
// taskId 可选：提醒 Toast 触发时详情面板可能未打开（或显示别的任务），
// 此时不能依赖 currentDetailTaskId，必须由调用方显式传入。
function toggleSubtaskComplete(subtaskId, completed, taskId) {
    const targetTaskId = taskId || currentDetailTaskId;
    const taskIndex = tasks.findIndex(t => t.id === targetTaskId);
    if (taskIndex === -1) return;
    const task = tasks[taskIndex];
    const subtask = (task.subtasks || []).find(st => st.id === subtaskId);
    if (subtask) {
        // 详情面板相关 UI 仅在目标任务正是面板当前任务时刷新，避免串台
        const isDetailTarget = (currentDetailTaskId === task.id);
        const wasCompleted = subtask.completed;
        const wasTaskCompleted = task.completed;
        subtask.completed = completed;
        if (completed) {
            subtask.completedAt = new Date().toISOString();
        } else {
            subtask.completedAt = null;
        }
        updateTaskProgressFromSubtasks(task);
        if (isDetailTarget) {
            updateDetailCompleteButton(task.completed);
            renderSubtasks();
            updateProgressDisplay();
        }

        // 因子任务全部完成而标记任务完成时，与手动完成（toggleTaskComplete）保持一致：生成下一周期重复任务
        if (task.completed && !wasTaskCompleted && task.repeat && task.repeat.type) {
            const nextTask = createNextRepeatTask(task);
            if (nextTask) tasks.push(nextTask);
        }

        // 子任务全部完成导致父任务被标记完成时，与手动完成一致：在当前视图中播放父任务条目的塌陷动画
        const playFx = task.completed && !wasTaskCompleted && _playTaskDoneCollapseFx(task.id);

        // 父任务完成状态变化时，与手动完成口径一致：刷新侧栏清单计数与标签
        if (task.completed !== wasTaskCompleted) {
            renderLists();
            if (typeof renderTags === 'function') renderTags();
        }

        saveData();
        if (playFx) {
            // 播放过塌陷动画后延迟全量重渲染（与 toggleTaskComplete 口径一致）
            setTimeout(() => renderView(), 320);
        } else {
            renderView();
        }

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

    // 与主视图勾选一致：标记完成时在当前视图中对该任务条目播放塌陷动画（下方任务上移补位）
    const playFx = !task.completed && _playTaskDoneCollapseFx(task.id);

    const { structuralChange } = applyTaskCompletionToggle(task);

    updateDetailCompleteButton(task.completed);
    // 完成状态变更后：若已完成则隐藏跳过按钮，撤销快照也一并失效
    refreshDetailSkipCycleButton();
    if (task.completed) {
        _detailSkipUndoSnapshot = null;
        _clearDetailSkipUndoTimer();
    }
    // 与主视图勾选（toggleTaskComplete）口径一致：完成状态变更后刷新侧栏清单计数与标签
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    if (playFx) {
        // 播放过塌陷动画后必须延迟全量重渲染：局部更新会把塌陷条目替换回正常高度，导致下方任务瞬间回弹下移
        setTimeout(() => renderView(), 320);
        return;
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
        if (_dataRefreshPending) {
            refreshDataFromServer();
        }
        if (planPanelOpen) renderPlanPanel();
        return;
    }
    if (currentDetailTaskId) {
        const taskIndex = tasks.findIndex(t => t.id === currentDetailTaskId);
        if (taskIndex !== -1) {
            // 空任务判定统一走面板档：标题/备注读 DOM（唯一权威），子任务模式下再看描述与子任务文本
            if (isPanelTaskContentless()) {
                tasks.splice(taskIndex, 1);
                saveDataImmediate();
                renderLists();
                renderView();
                hideDetailPanel();
                currentDetailTaskId = null;
                if (planPanelOpen) renderPlanPanel();
                return;
            }
            // 非空任务：标题仍为空时兜底生成「未命名任务」
            const titleInput = document.getElementById('detail-task-title');
            if (!titleInput.value || !titleInput.value.trim()) {
                titleInput.value = generateUntitledName();
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

    lists.filter(l => !l.archived && !l.isFolder && !shouldHideExternalList(l)).forEach(list => {
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
    const _isExtTask = !!task.extSourceId; // 外部任务：保护外部覆盖字段（5.2 字段合并表，UI 已 readonly，此为防御性兜底）

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

    // 提前提醒（多选）；准点提醒为系统固有行为，不参与配置
    const reminders = getDetailRemindersFromForm();

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
    // 外部任务（_isExtTask）保护外部覆盖字段：title/notes/startTime/endTime/isAllDay/repeat 保留原值，
    // 本地保留字段（mode/description/listId/groupId/important/urgent）仍写；reminder 强制 0（附录 A-5）。
    // 变更追踪（changeFlag）：仅记录真实变化；无修改的换看任务由调用方跳过保存与整板重渲染
    const _cf = options.changeFlag;
    const _setIf = (cond, apply) => { if (cond) { apply(); if (_cf) _cf.changed = true; } };
    if (!_isExtTask) {
        if (newTitle !== undefined) _setIf(task.title !== newTitle, () => { task.title = newTitle; });
        if (notes !== undefined) _setIf(task.notes !== notes, () => { task.notes = notes; });
        _setIf(JSON.stringify(task.repeat || null) !== JSON.stringify(repeat || null), () => { task.repeat = repeat; });

        if (newStartTime) {
            _setIf(task.startTime !== newStartTime || task.isAllDay !== isAllDay, () => {
                task.startTime = newStartTime;
                task.isAllDay = isAllDay;
            });
        } else {
            _setIf(task.startTime !== undefined || task.isAllDay !== false, () => {
                delete task.startTime;
                task.isAllDay = false;
            });
        }
        // 手动修改时间后，清除顺延保留的原始时间
        _setIf(task._originalStartTime !== undefined, () => { delete task._originalStartTime; });

        if (newEndTime) {
            _setIf(task.endTime !== newEndTime, () => { task.endTime = newEndTime; });
        } else {
            _setIf(task.endTime !== undefined, () => { delete task.endTime; });
        }
    }
    _setIf(task.mode !== mode, () => { task.mode = mode; });
    if (description !== undefined) _setIf(task.description !== description, () => { task.description = description; });
    _setIf(task.listId !== listId, () => { task.listId = listId; });
    _setIf(task.groupId !== groupId, () => { task.groupId = groupId; });
    _setIf(task.important !== important, () => { task.important = important; });
    _setIf(task.urgent !== urgent, () => { task.urgent = urgent; });
    // 提前提醒：外部日历任务强制清空（附录 A-5）；旧字段 reminder 作为兼容镜像双写
    const newReminders = _isExtTask ? [] : reminders;
    _setIf(JSON.stringify(task.reminders || []) !== JSON.stringify(newReminders),
        () => { task.reminders = newReminders; });
    const newReminderMirror = newReminders.length ? Math.max(...newReminders) : 0;
    _setIf(task.reminder !== newReminderMirror, () => { task.reminder = newReminderMirror; });
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
    // 变更检测：无修改时跳过保存与重渲染，仅执行关闭流程
    const changeFlag = { changed: false };
    if (!applyDetailInputsToTask(task, { fallbackTitle: true, changeFlag })) return false;

    if (changeFlag.changed) {
        saveData();
        renderView();
        if (typeof renderTags === 'function') renderTags();
        if (typeof renderLists === 'function') renderLists();
    }
    hideDetailPanel();
    currentDetailTaskId = null;
    if (planPanelOpen) renderPlanPanel();

    // 修改日期可能导致今日任务清空，检查并触发"落日归山"彩蛋（仅在真实落盘时）
    if (changeFlag.changed && beforeTodayIncomplete > 0 && typeof ee_checkSunsetHorizon === 'function') {
        ee_checkSunsetHorizon();
    }
    return true;
}

let detailImportantState = false;
let detailUrgentState = false;

let planPanelOpen = false;

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
}

// 同步计划面板分组折叠态（与任务视图共享 taskListGroupCollapsed）。
// groupKey 为空时同步全部分组；用于任务视图侧折叠/展开、全部展开收起等场景。
function syncPlanPanelGroupCollapse(groupKey) {
    if (!planPanelOpen) return;
    const root = document.getElementById('plan-panel-content');
    if (!root) return;
    root.querySelectorAll('[data-plan-group]').forEach(wrap => {
        const key = wrap.getAttribute('data-plan-group');
        if (groupKey && key !== groupKey) return;
        const collapsed = !!(typeof taskListGroupCollapsed !== 'undefined' && taskListGroupCollapsed[key]);
        const content = wrap.querySelector('[data-plan-group-content]');
        if (content) {
            content.classList.toggle('hidden', collapsed);
            content.classList.toggle('fx-collapsed', collapsed);
        }
        const icon = wrap.querySelector('.plan-group-header i.fas');
        if (icon) icon.className = `fas fa-chevron-${collapsed ? 'right' : 'down'} text-xs text-theme-muted mr-1`;
    });
}

function renderPlanPanel() {
    const container = document.getElementById('plan-panel-content');
    if (!container) return;

    // 分组/排序完全复用任务视图：同一套 getTaskViewConfig（含 per-list 覆盖）+ buildTaskListGroups，
    // 因此分组依据、排序依据、排序方向、时间窗筛选下按天分组等均与任务视图一致。
    // 仅剔除「已完成」组——计划面板用于把待办拖去排期，已完成任务不参与。
    const groups = (typeof buildTaskListGroups === 'function' ? buildTaskListGroups() : [])
        .filter(g => !g.isCompleted && g.tasks && g.tasks.length > 0);

    if (groups.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-theme-muted">
                <i class="fas fa-clipboard-check text-4xl mb-3 opacity-30"></i>
                <p class="text-sm">暂无需要计划的任务</p>
            </div>
        `;
        return;
    }

    let html = '';
    groups.forEach(group => {
        // 折叠态与任务视图共享：同一 groupKey 在两侧同步折叠/展开
        const isCollapsed = !!(typeof taskListGroupCollapsed !== 'undefined' && taskListGroupCollapsed[group.key]);
        const labelHtml = group.labelHtml
            || `${group.label}<span class="ml-1 text-xs text-theme-muted font-normal">${group.count}</span>`;

        html += `
            <div class="mb-5 last:mb-0" data-plan-group="${group.key}">
                <div class="plan-group-header flex items-center gap-2 mb-2 cursor-pointer select-none"
                     onclick="toggleTaskListGroup('${group.key}', { skipRender: true })">
                    <i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'} text-xs text-theme-muted mr-1"></i>
                    <h4 class="text-sm font-semibold ${group.overdue ? 'text-red-500' : 'text-theme-primary'}">${labelHtml}</h4>
                </div>
                <div class="fx-collapse ${isCollapsed ? 'hidden fx-collapsed' : ''}" data-plan-group-content="${group.key}">
                    <div class="fx-collapse-inner">
        `;

        group.tasks.forEach(task => {
            const list = lists.find(l => l.id === task.listId);
            const listColor = list ? list.color : '#9ca3af';
            const listName = list ? list.name : '';
            const quadColors = getQuadrantColorClass(task, { forceBg: true });
            const timeDisplay = task.startTime ? formatTaskListTime(task, { withAllDayTag: false }) : '';

            // 单击不呼出详情面板：计划面板仅作为拖拽源（拖到主视图排期）。
            // data-task-id 供移动端长按动作面板取 id（onclick 已移除，无法再从 onclick 解析）。
            html += `
                <div class="plan-task-item flex items-center gap-2 py-2 px-2.5 rounded-r-lg ${quadColors.bg} hover:brightness-95 transition cursor-grab active:cursor-grabbing group mb-1"
                     data-task-id="${task.id}"
                     title="${(task.title || '新任务').replace(/"/g, '&quot;')}"
                     draggable="true"
                     ondragstart="handleTaskDragStart(event, '${task.id}')"
                     ondragend="handlePlanDragEnd(event)"
                     style="border-left: 3px solid ${listColor}; overflow: hidden;">
                    <span class="flex-1 text-sm text-theme-primary truncate min-w-0 group-hover:text-accent transition-colors duration-150">${task.title || '新任务'}</span>
                    <div class="flex items-center gap-1.5 flex-shrink-0 text-xs text-theme-secondary whitespace-nowrap">
                        ${listName ? `<span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background-color: ${listColor}"></span></span>` : ''}
                        ${timeDisplay ? `<span><i class="fas fa-clock mr-0.5"></i>${timeDisplay}</span>` : ''}
                    </div>
                </div>
            `;
        });

        html += '</div></div></div>';
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
    // 清除时间后提醒失去意义（无时间则不提醒），一并清空提前提醒与旧字段镜像
    task.reminders = [];
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
    // 外部订阅任务：不允许展开时间设置面板（3.3.2，按钮已禁用，此处兜底拦截）
    if (currentDetailTaskId) {
        const task = tasks.find(t => t.id === currentDetailTaskId);
        if (task && typeof isExternalTask === 'function' && isExternalTask(task)) return;
    }
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
    if (!picker) return;
    const willOpen = picker.classList.contains('hidden');
    picker.classList.toggle('hidden');
    if (willOpen) renderDetailReminderPanel();
}

function openTimePicker(inputEl, pickerId, onPicked) {
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
                if (typeof onPicked === 'function') onPicked();
                else onDetailAllDayChange();
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

function openDatePicker(inputEl, pickerId, onPicked) {
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
            if (typeof onPicked === 'function') onPicked();
            else onDetailAllDayChange();
        };
        picker.appendChild(item);
    }

    // 1. 今天
    addDateOption('今天', now);

    // 2. 明天
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    addDateOption('明天', tomorrow);

    // 3. 工作周期最后一个工作日（当天上班且次日休息；工作日在节假日/调休数据中判定）
    //    注意：这里的选项文案是「本周X / 下周X」——它是通用日期快捷项，
    //    与重复规则的名称「工作周期最后一个工作日」无关，勿改为「本周期/下周期」。
    const shortDayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const weekStartsOnMonday = settings.weekStart === 'monday';
    const currentWeekStart = getWeekStartDate(now, weekStartsOnMonday);
    const thisWeekLastWorkday = findLastWorkdayOfWeek(currentWeekStart);
    let lastWorkdayDate = null;
    let lastWorkdayLabel = '';
    if (thisWeekLastWorkday && thisWeekLastWorkday >= now) {
        lastWorkdayDate = thisWeekLastWorkday;
        lastWorkdayLabel = '本周' + shortDayNames[thisWeekLastWorkday.getDay()];
        addDateOption(lastWorkdayLabel, thisWeekLastWorkday);
    } else {
        const nextWeekStart = new Date(currentWeekStart);
        nextWeekStart.setDate(nextWeekStart.getDate() + 7);
        const nextWeekLastWorkday = findLastWorkdayOfWeek(nextWeekStart);
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

// ==================== 提前提醒：多选组件（主任务与子任务共用） ====================
/**
 * 渲染「提前提醒」多选列表。
 * 准点提醒是系统固有行为（时间到达必然弹出），不在此列表、也不提供开关。
 * @param {HTMLElement} container 列表容器
 * @param {number[]} selected 当前已选提前量
 * @param {string|null} baseIso 基准时间 ISO（用于右侧绝对时间显示），可空
 * @param {(minutes:number[])=>void} onChange 选择变化回调（入参为归一化后的新集合）
 * @param {HTMLElement|null} shakeTarget 达到上限时抖动的元素（通常是计数徽标）
 * @param {{showAbsolute?: boolean}} [opts] showAbsolute=false 时不渲染右侧绝对时间
 *        （主任务面板不用，因为它要缩到与收起态等宽；子任务面板保留）
 */
function renderAdvanceReminderOptions(container, selected, baseIso, onChange, shakeTarget, opts) {
    if (!container) return;
    const showAbsolute = !opts || opts.showAbsolute !== false;
    const sel = normalizeReminderMinutes(selected);
    const presetMinutes = REMINDER_PRESETS.map(p => p.minute);

    // 预设项 + 用户自定义项（不在预设里的已选值），统一按提前量降序
    const items = REMINDER_PRESETS.map(p => ({ minute: p.minute, label: p.label }));
    sel.forEach(m => {
        if (!presetMinutes.includes(m)) items.push({ minute: m, label: formatReminderMinute(m) });
    });
    items.sort((a, b) => b.minute - a.minute);

    container.innerHTML = '';
    items.forEach(item => {
        const checked = sel.includes(item.minute);
        const disabled = !checked && sel.length >= REMINDER_MAX_COUNT;

        const row = document.createElement('label');
        row.className = 'flex items-center gap-2 text-sm py-0.5 '
            + (disabled
                ? 'opacity-50 cursor-not-allowed text-theme-muted'
                : 'cursor-pointer text-theme-secondary hover:text-theme-primary');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'advance-reminder-option flex-shrink-0';
        cb.value = String(item.minute);
        cb.checked = checked;
        cb.disabled = disabled;

        const labelSpan = document.createElement('span');
        labelSpan.className = 'flex-1 truncate';
        labelSpan.textContent = item.label;

        row.appendChild(cb);
        row.appendChild(labelSpan);
        if (showAbsolute) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'text-xs text-theme-muted tabular-nums flex-shrink-0';
            timeSpan.textContent = formatReminderAbsolute(baseIso, item.minute);
            row.appendChild(timeSpan);
        }

        cb.onchange = () => {
            let next = normalizeReminderMinutes(sel);
            if (cb.checked) {
                if (next.length >= REMINDER_MAX_COUNT) {
                    cb.checked = false;
                    shakeReminderLimit(shakeTarget);
                    showToast(`最多 ${REMINDER_MAX_COUNT} 个提前提醒`, 'warning');
                    return;
                }
                if (!next.includes(item.minute)) next.push(item.minute);
            } else {
                next = next.filter(m => m !== item.minute);
            }
            onChange(normalizeReminderMinutes(next));
        };

        container.appendChild(row);
    });
}

// 更新「N/5」计数徽标
function updateAdvanceReminderCount(countEl, minutes) {
    if (!countEl) return;
    const n = normalizeReminderMinutes(minutes).length;
    countEl.textContent = `${n}/${REMINDER_MAX_COUNT}`;
    countEl.classList.toggle('text-amber-500', n >= REMINDER_MAX_COUNT);
}

// 达到上限时的抖动提示
function shakeReminderLimit(el) {
    if (!el) return;
    el.classList.remove('reminder-limit-shake');
    void el.offsetWidth; // 强制重排以重启动画
    el.classList.add('reminder-limit-shake');
    setTimeout(() => el.classList.remove('reminder-limit-shake'), 400);
}

// ==================== 详情面板：提前提醒 ====================

// 渲染详情面板的提前提醒面板（仅复选列表 + 自定义添加；不显示计数与绝对时间）
function renderDetailReminderPanel() {
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) return;

    const container = document.getElementById('detail-reminder-options');
    // 达到上限时抖动整个下拉（本面板已无计数徽标可作为抖动目标）
    const shakeTarget = document.getElementById('detail-reminder-picker');
    const selected = getAdvanceMinutes(task);

    // 自定义输入框支持回车添加（只绑定一次）
    const customInput = document.getElementById('detail-custom-reminder');
    if (customInput && !customInput.dataset.enterBound) {
        customInput.dataset.enterBound = '1';
        customInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addDetailCustomReminder(); }
        });
    }

    updateDetailReminderText();

    // showAbsolute: false —— 主任务面板已缩到与收起态等宽，不再渲染右侧绝对时间
    renderAdvanceReminderOptions(container, selected, null, (next) => {
        const t = tasks.find(x => x.id === currentDetailTaskId);
        if (!t) return;
        t.reminders = next;
        t.reminder = next.length ? Math.max(...next) : 0; // 旧字段镜像
        updateDetailReminderText();
        renderDetailReminderPanel();
        saveData();
    }, shakeTarget, { showAbsolute: false });
}

// 折叠态摘要文案 + 计数徽标
function updateDetailReminderText() {
    const reminderText = document.getElementById('detail-reminder-text');
    if (!reminderText) return;
    const task = tasks.find(t => t.id === currentDetailTaskId);
    const minutes = task ? getAdvanceMinutes(task) : [];
    reminderText.textContent = formatReminderSummary(minutes);
    reminderText.title = minutes.length ? minutes.map(formatReminderMinute).join('、') : REMINDER_EMPTY_LABEL;

    // 按钮上的计数徽标：只在「多于 1 条」时显示。
    // 只有 1 条时收起态摘要本身已经写明了是哪一条（如「提前 5 分钟」），
    // 再挂一个「1」既冗余又占宽度，故隐藏。
    const badge = document.getElementById('detail-reminder-badge');
    if (badge) {
        badge.textContent = String(minutes.length);
        badge.classList.toggle('hidden', minutes.length <= 1);
    }
}

// 从表单收集提前量（面板已渲染时以 DOM 为准，否则回退到任务数据）
function getDetailRemindersFromForm() {
    const container = document.getElementById('detail-reminder-options');
    if (container && container.children.length) {
        const fromDom = [];
        container.querySelectorAll('input.advance-reminder-option:checked').forEach(cb => {
            const v = parseInt(cb.value, 10);
            if (!isNaN(v)) fromDom.push(v);
        });
        return normalizeReminderMinutes(fromDom);
    }
    const task = tasks.find(t => t.id === currentDetailTaskId);
    return task ? getAdvanceMinutes(task) : [];
}

// 自定义提前量：校验 + 添加
function addDetailCustomReminder() {
    const input = document.getElementById('detail-custom-reminder');
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!input || !task) return;

    const val = parseInt(input.value, 10);
    const cur = getAdvanceMinutes(task);

    const reject = (msg) => {
        input.classList.add('border-red-500');
        setTimeout(() => input.classList.remove('border-red-500'), 1200);
        if (msg) showToast(msg, 'warning');
    };

    if (isNaN(val) || val < 1 || val > REMINDER_MAX_MINUTES) {
        reject(`请输入 1 ~ ${REMINDER_MAX_MINUTES} 之间的分钟数`);
        return;
    }
    if (cur.includes(val)) {
        reject('该提前量已存在');
        return;
    }
    if (cur.length >= REMINDER_MAX_COUNT) {
        shakeReminderLimit(document.getElementById('detail-reminder-picker'));
        showToast(`最多 ${REMINDER_MAX_COUNT} 个提前提醒`, 'warning');
        return;
    }

    const next = normalizeReminderMinutes([...cur, val]);
    task.reminders = next;
    task.reminder = next.length ? Math.max(...next) : 0;
    input.value = '';
    renderDetailReminderPanel();
    saveData();
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
            repeatText.textContent = '工作周期最后一个工作日';
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
                       // 只匹配到 id 为止：onclick 现为 openTaskDetailPanel('id', readOnly, fromClick)
                       document.querySelector(`[onclick*="openTaskDetailPanel('${currentDetailTaskId}'"]`);
        easterEgg_onTaskDelete(taskEl);

        const deletedId = currentDetailTaskId;
        const _extTask = tasks.find(t => t.id === deletedId);
        const _isExt = !!(_extTask && _extTask.extSourceId);
        if (_isExt && typeof recordExternalTaskDeletion === 'function') recordExternalTaskDeletion(_extTask);
        tasks = tasks.filter(t => t.id !== currentDetailTaskId);
        saveData();
        hideDetailPanel();
        currentDetailTaskId = null;
        deleteDetailConfirming = false;
        if (_detailSkipUndoSnapshot && _detailSkipUndoSnapshot.taskId === deletedId) {
            _detailSkipUndoSnapshot = null;
            _clearDetailSkipUndoTimer();
        }
        renderLists();
        if (typeof renderTags === 'function') renderTags();
        renderView();
        if (planPanelOpen) renderPlanPanel();
        showToast(_isExt ? '已删除；该日程已加入屏蔽名单，重新同步后不会再出现' : '任务已删除', 'success');
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
    // 变更检测：无任何修改的换看任务跳过保存与重渲染（整板重建会打断在途动画/滚动位置，也是无谓开销）
    const changeFlag = { changed: false };
    if (!applyDetailInputsToTask(task, { fallbackTitle: false, changeFlag })) return;
    if (!changeFlag.changed) return;

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

    // 子任务提醒面板：单击面板外（含子任务编辑框、其它行、面板空白处）保存并关闭。
    // 与详情面板的浮层关闭口径一致（outside-click 收起）。
    document.addEventListener('click', (e) => {
        if (!openSubtaskReminderPanelId) return;
        // 面板内部（含其日期/时间快速选择下拉）不关闭；面板自身的 click 已 stopPropagation，
        // 这里再判一次以防将来把下拉移出面板
        if (e.target.closest('.subtask-reminder-panel')) return;
        // 铃铛按钮由自身 toggle 处理，避免"刚打开就被这条逻辑关掉"
        if (e.target.closest('.subtask-bell-btn')) return;
        closeSubtaskReminderPanel();
    });

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

        // 点击落在已打开的全屏浮层（设置/新增任务/番茄专注/命令面板等）内部时，不算「点击外部」：
        // 浮层内的普通元素（如设置面板左侧导航 <a>）此前会误关详情面板，并连带触发四象限展开态的
        // View Transition（伪元素树位于 top layer）把整页快照动画盖到浮层之上，出现层级倒挂
        if (typeof isEventInsideOpenOverlay === 'function' && isEventInsideOpenOverlay(e)) {
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
                    task.reminders = reminder > 0 ? [reminder] : [];
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
                    reminders: reminder > 0 ? [reminder] : [],
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
    const task = tasks.find(t => t.id === taskId);
    const isExt = !!(task && task.extSourceId);
    // 外部订阅任务：删除时写黑名单（3.3.3），下次同步跳过该 UID 不再重建
    if (isExt && typeof recordExternalTaskDeletion === 'function') {
        recordExternalTaskDeletion(task);
    }
    // 彩蛋：断舍离检测（在DOM移除前获取位置）
    const taskEl = document.querySelector(`[onclick*="toggleTaskComplete('${taskId}')"]`) ||
                   // 只匹配到 id 为止：onclick 现为 openTaskDetailPanel('id', readOnly, fromClick)
                   document.querySelector(`[onclick*="openTaskDetailPanel('${taskId}'"]`);
    easterEgg_onTaskDelete(taskEl);

    tasks = tasks.filter(t => t.id !== taskId);
    saveData();
    if (currentDetailTaskId === taskId) {
        hideDetailPanel();
        currentDetailTaskId = null;
    }
    if (_detailSkipUndoSnapshot && _detailSkipUndoSnapshot.taskId === taskId) {
        _detailSkipUndoSnapshot = null;
        _clearDetailSkipUndoTimer();
    }
    renderLists();
    if (typeof renderTags === 'function') renderTags();
    renderView();
    showToast(isExt ? '已删除；该日程已加入屏蔽名单，重新同步后不会再出现' : '任务已删除', 'success');
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
                // 必须走 isWorkday（读取 holidayData 的 holidays/workdays），
                // 不能只看 getDay()：调休周末（如「班」的周日）也是工作日，法定假日里的周中也要跳过。
                result.setDate(result.getDate() + 1);
                let guard = 0;
                while (!isWorkday(result) && guard < 366) {
                    result.setDate(result.getDate() + 1);
                    guard++;
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
                // 从真实节假日数据（holidayData）解析「下一个节假日的首日」，
                // 取其前一天作为结果。原先硬编码 1/1、5/1、10/1 三个日期，
                // 既漏掉春节/清明/端午/中秋，也无法跟随用户导入/编辑的调休表。
                const nextHolidayStart = findNextHolidayStart(fromDate);
                if (nextHolidayStart) {
                    result = new Date(nextHolidayStart);
                    result.setDate(result.getDate() - 1);
                } else {
                    // 数据缺失时退回「一年后的元旦前一天」，与旧行为保持一致的兜底语义
                    result = new Date(fromDate.getFullYear() + 1, 0, 0);
                }
            }
        } else if (task.repeat.type === 'weeklyFirstWorkday') {
            const weekStartsOnMonday = settings.weekStart === 'monday';
            const currentWeekStart = getWeekStartDate(fromDate, weekStartsOnMonday);
            const nextWeekStart = new Date(currentWeekStart);
            nextWeekStart.setDate(nextWeekStart.getDate() + 7);
            const firstWorkday = findFirstWorkdayOfWeek(nextWeekStart);
            result = firstWorkday || new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        } else if (task.repeat.type === 'weeklyLastWorkday') {
            // 「工作周期最后一个工作日」= 当天上班 且 次日休息。
            // 直接向后找下一个满足条件的日子，无需按周结算（周起始日设置不影响该判定）。
            result = findNextLastWorkdayOfCycle(fromDate);
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
        reminders: getAdvanceMinutes(task),
        // 子任务时间随周期顺延，撤销时需一并还原
        subtaskTimes: (task.subtasks || []).map(st => ({ id: st.id, startTime: st.startTime || null })),
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

    // 子任务时间随主任务周期顺延（保持相对位置不变），使子任务提醒跟随新周期
    if (snapshot.startTime) {
        const deltaMs = newStartTimeDate.getTime() - new Date(snapshot.startTime).getTime();
        if (deltaMs !== 0) {
            (task.subtasks || []).forEach(st => {
                if (!st.startTime) return;
                const t = new Date(st.startTime);
                if (!isNaN(t.getTime())) {
                    st.startTime = new Date(t.getTime() + deltaMs).toISOString();
                }
            });
        }
    }

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
    if (snap.reminders !== undefined) {
        task.reminders = snap.reminders;
    }
    // 还原子任务时间（周期顺延前）
    if (Array.isArray(snap.subtaskTimes)) {
        snap.subtaskTimes.forEach(rec => {
            const st = (task.subtasks || []).find(s => s.id === rec.id);
            if (st) st.startTime = rec.startTime;
        });
    }
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

/**
 * 播放任务完成塌陷动画：条目从左侧勾选框向右擦除、高度塌陷（下方任务向上平移补位）。
 * 主视图勾选 / 右侧详情面板勾选 / 子任务全部完成自动勾选父任务 共用，保证各入口完成动效一致。
 * 同一任务可能同时出现在多处（多日任务跨多个日期列、月视图网格 + 日浮层 / 命令面板），
 * 对全部可见条目播放，避免只播一处导致其余位置状态不同步。
 * 月视图网格 / 周视图全天区：完成仍在可见切片内的行跳过塌陷（避免消失后闪回）；
 * 被挤出切片时在 +N 按钮前同步"生长"出被顶入的下一条任务（揭示行动画）。
 * @param {string} taskId - 任务 id
 * @returns {boolean} 是否实际播放（未开启动效、系统减弱动态或当前视图中无可见任务条目时为 false）
 */
function _playTaskDoneCollapseFx(taskId) {
    if (typeof settings === 'undefined' || settings.smoothAnimations !== true) return false;
    // 系统级减弱动态效果时不播放（与视图切换等 fx 入口口径一致）
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    // 视图级完成动效预案（月视图网格 / 周视图全天区）：切片内保留行跳过塌陷、切片外补揭示行
    const plan = (typeof planCalendarTaskDoneFx === 'function') ? planCalendarTaskDoneFx(taskId) : null;
    const skipRows = plan ? plan.skip : null;
    const reveals = (plan && plan.reveals.length > 0) ? plan.reveals : [];
    // 收集该任务所有可见条目（task-row 语义类；周视图时间块等不重排的条目不带该类，自然不播放）
    const anchors = document.querySelectorAll(`[onclick*="toggleTaskComplete('${taskId}')"]`);
    const rows = [];
    for (const anchor of anchors) {
        const row = anchor.closest('.task-row');
        if (row && row.offsetParent !== null && !rows.includes(row) && !(skipRows && skipRows.has(row))) rows.push(row);
    }
    if (rows.length === 0 && reveals.length === 0) return false;
    rows.forEach(item => {
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
    });
    // 揭示行：与塌陷同步从 0 高生长到自然行高（透明度渐入），新任务看似从 +N 按钮底部滑出；
    // 行高与被塌陷行一致，二者相抵后 +N 按钮视觉上原地不动
    reveals.forEach(rv => {
        if (!rv || !rv.container) return;
        const wrap = document.createElement('div');
        wrap.className = 'fx-task-reveal';
        wrap.style.cssText = 'height:0;margin-top:0;opacity:0;overflow:hidden;';
        wrap.innerHTML = rv.html;
        if (rv.refEl && rv.refEl.parentNode === rv.container) {
            rv.container.insertBefore(wrap, rv.refEl);
        } else {
            rv.container.appendChild(wrap);
        }
        const targetH = wrap.scrollHeight;
        void wrap.offsetWidth; // 强制回流，让初始态先落地再过渡
        wrap.style.height = targetH + 'px';
        wrap.style.marginTop = rv.gap || '0px';
        wrap.style.opacity = '1';
    });
    return true;
}

function toggleTaskComplete(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        const willComplete = !task.completed;
        // 详情面板正展示这条任务时：
        //   · 勾成完成 → 面板同步标记完成并关闭（否则面板停在旧的「未完成」态上）
        //   · 取消完成 → 面板保持打开，只把勾选框刷回未完成态（同一类状态不同步问题）
        // 关闭必须放在塌陷动画与后续重渲染之前：closeTaskDetailPanel 内部的 saveTaskDetail
        // 可能触发一次 renderView（面板里有未落盘修改时），会把已塌陷的行重建回原高度，动画白播。
        const detailShowing = isDetailPanelShowingTask(taskId);
        if (willComplete && detailShowing) {
            updateDetailCompleteButton(true); // 淡出动画期间面板勾选框同步为完成态
            closeTaskDetailPanel();           // 走正常关闭流程：先落盘面板里的标题/备注，再收起
            // 关闭流程可能把「空任务」直接丢弃；此时对象已不在 tasks 里，不再继续勾选
            if (!tasks.includes(task)) return;
        }
        // 平滑过渡动画：标记完成时旧条目从左侧勾选框向右擦除、高度塌陷（下方任务向上平移补位），再延迟刷新视图
        const playFx = willComplete && _playTaskDoneCollapseFx(taskId);
        const { structuralChange } = applyTaskCompletionToggle(task);
        if (!willComplete && detailShowing) {
            updateDetailCompleteButton(false);
        }
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
        // 清单重命名/改色后同步刷新番茄页当前任务徽标（圆点颜色/清单名），避免残留旧值
        if (typeof updatePomodoroTaskButton === 'function') updatePomodoroTaskButton();
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
