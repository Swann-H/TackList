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

// ==================== 任务修改时间戳（modifiedAt）====================
// touchTask：任务内容变更时统一打修改时间戳（问题 1 写入点补全）。
// 口径：① 完成状态切换不打戳（completedAt 已独立记录，且已完成恒置底，见 applyTaskCompletionToggle）；
//       ② 外部订阅任务不打戳（本地时间戳会被下次同步覆盖，无意义）；
//       ③ 批量管理操作（清单删除/合并级联、过期任务批量顺延）不调用本函数。
// 存量任务无 modifiedAt 时排序走 createdAt 兜底（taskListView/kanbanView），不做数据迁移。
function touchTask(task) {
    if (!task || task.extSourceId) return task;
    task.modifiedAt = new Date().toISOString();
    return task;
}

// ==================== FR-01 改期撤销快照 ====================
// 详情面板时间菜单、周/月/日程视图拖拽共用：改期前快照、改期后入栈。
// 语义（FR-01-2）：还原 startTime / endTime / isAllDay（以及顺延保留的 _originalStartTime）。
function _snapshotTaskTime(task) {
    return {
        startTime: task.startTime,
        endTime: task.endTime,
        isAllDay: task.isAllDay,
        originalStartTime: task._originalStartTime
    };
}

function _pushRescheduleUndo(task, snap, label) {
    if (!task || !snap || typeof pushUndoEntry !== 'function') return null;
    const changed = snap.startTime !== task.startTime
        || snap.endTime !== task.endTime
        || snap.isAllDay !== task.isAllDay;
    if (!changed) return null;
    return pushUndoEntry({
        label: label || '调整任务时间',
        kind: 'reschedule',
        undo: function () {
            if (snap.startTime === undefined) delete task.startTime; else task.startTime = snap.startTime;
            if (snap.endTime === undefined) delete task.endTime; else task.endTime = snap.endTime;
            task.isAllDay = snap.isAllDay;
            if (snap.originalStartTime === undefined) delete task._originalStartTime;
            else task._originalStartTime = snap.originalStartTime;
        }
    });
}

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
            touchTask(task); // 问题 1：拖拽改期
            saveData();
            renderView();
            showToast('已更新时间', 'success');
        }
    } else if (currentView === 'quadrant' && targetQuadrant) {
        task.important = targetQuadrant.includes('important') && !targetQuadrant.includes('not-important');
        task.urgent = targetQuadrant.includes('urgent') && !targetQuadrant.includes('not-urgent');
        touchTask(task); // 问题 1：拖拽改优先级
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
    const _timeSnap = _snapshotTaskTime(task);

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

    touchTask(task); // 问题 1：拖拽改期
    _pushRescheduleUndo(task, _timeSnap, '调整「' + (task.title || '任务') + '」时间');
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

    const _timeSnap = _snapshotTaskTime(task);
    const oldDate = task.startTime ? new Date(task.startTime) : null;

    task.startTime = new Date(dateStr + 'T00:00:00').toISOString();
    task.isAllDay = true;

    if (task.endTime && oldDate) {
        shiftEndTimeByDays(task, oldDate);
    } else {
        delete task.endTime;
    }

    touchTask(task); // 问题 1：拖拽改期
    _pushRescheduleUndo(task, _timeSnap, '调整「' + (task.title || '任务') + '」时间');
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

    const _timeSnap = _snapshotTaskTime(task);
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

    touchTask(task); // 问题 1：拖拽改期
    _pushRescheduleUndo(task, _timeSnap, '调整「' + (task.title || '任务') + '」时间');
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

    const _timeSnap = _snapshotTaskTime(task);
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

    touchTask(task); // 问题 1：拖拽改期
    _pushRescheduleUndo(task, _timeSnap, '调整「' + (task.title || '任务') + '」时间');
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
            touchTask(task); // 问题 1：拖拽改优先级
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
        showToast('已更新象限顺序', 'success');
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

    const _timeSnap = _snapshotTaskTime(task);
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

    touchTask(task); // 问题 1：拖拽改期
    _pushRescheduleUndo(task, _timeSnap, '调整「' + (task.title || '任务') + '」时间');
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

// 任务时间段跨度：仅取实际起止时间；未设置结束时间时按周视图「任务块默认时长」预填
function getTaskSpanMinutes(task) {
    if (task && task.startTime && task.endTime) {
        const diff = (new Date(task.endTime).getTime() - new Date(task.startTime).getTime()) / 60000;
        if (isFinite(diff) && diff > 0) return Math.round(diff);
    }
    return (typeof getWeekTaskBlockMinutes === 'function') ? getWeekTaskBlockMinutes() : 30;
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

        // 起止跨度以任务已有时间跨度为准，没有则按 30 分钟预填
        const _task = currentDetailTaskId ? tasks.find(t => t.id === currentDetailTaskId) : null;
        const duration = _task ? getTaskSpanMinutes(_task) : 30;
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
    // 面板 384px 入场会挤压主区；等过渡结束后重算 Header 收纳（0ms 再按预判宽度立即收一次）
    if (typeof scheduleHeaderActionOverflow === 'function') scheduleHeaderActionOverflow(380);
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
    if (typeof scheduleHeaderActionOverflow === 'function') scheduleHeaderActionOverflow(0);
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
    // 面板收起后主区回弹；等过渡结束重算 Header 收纳
    if (typeof scheduleHeaderActionOverflow === 'function') scheduleHeaderActionOverflow(380);
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
    if (typeof scheduleHeaderActionOverflow === 'function') scheduleHeaderActionOverflow(0);
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
            banner.className = 'px-4 py-2 tone-banner-cyan text-xs flex items-center gap-2 flex-shrink-0';
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
    // 模板选择器与详情共用同一个右栏槽：选择器立即收起，主区宽度由详情面板无缝接替
    if (typeof dismissTaskTemplatePickerForDetail === 'function' && dismissTaskTemplatePickerForDetail()) {
        requestAnimationFrame(function () {
            document.body.classList.remove('tpl-picker-open');
            if (typeof scheduleHeaderActionOverflow === 'function') scheduleHeaderActionOverflow(0);
        });
    }
    // 上一次收拢动画可能还没落地（面板被关掉时已强制落定，这里再兜一道）：
    // 残留的 detail-write-mode 会让面板一打开就是书写态。
    if (typeof _wmMorphFinishNow === 'function') _wmMorphFinishNow();
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
            // FR-10：未完成上传的图片占位先摘掉，避免带着旧任务占位去保存
            if (typeof cleanupPendingNotePlaceholders === 'function') cleanupPendingNotePlaceholders(currentDetailTaskId);
            // FR-10：落定块编辑器（含文末空块的补白回收），再保存旧任务
            if (typeof mdEditorCommit === 'function') mdEditorCommit({ render: false });
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

    // FR-06：附件区渲染（能力探测是异步的，探测完成后若仍停留在同一任务则补渲染一次）
    if (typeof renderAttachmentsSection === 'function') {
        renderAttachmentsSection(task);
        if (typeof probeAttachmentSupport === 'function') {
            probeAttachmentSupport().then(function (ok) {
                if (ok && currentDetailTaskId === task.id) {
                    const t = tasks.find(x => x.id === task.id);
                    if (t) renderAttachmentsSection(t);
                }
            });
        }
    }
    // FR-06：备注框内粘贴截图 → 上传为附件（FR-10 编辑器插图通道落地前的替代路径）
    const notesPasteEl = document.getElementById('detail-task-notes');
    if (notesPasteEl && !notesPasteEl._attPasteBound) {
        notesPasteEl._attPasteBound = true;
        notesPasteEl.addEventListener('paste', function (e) {
            if (typeof handleAttachmentPaste === 'function') handleAttachmentPaste(e);
        });
    }
    
    // 显示面板（必须在renderSubtasks之前，否则scrollHeight为0导致文本不显示）
    showDetailPanel(taskId);

    // 启动描述框「宽度 → 高度」自适应监听（仅一次）：覆盖书写态入场 morph / 宽度档切换 / 窗口缩放
    // 等导致的宽度变化，避免用瞬态窄宽量出偏大高度残留成空白。
    _initDescAutoResize();
    // 子任务行同理：宽度变化时逐行重算高度，避免「收起态窄宽下量出的多行高度」在书写态残留。
    _initSubtaskAutoResize();

    // 渲染子任务（在面板可见后，确保autoResizeTextarea能正确计算高度）
    if (currentTaskMode === 'subtasks') {
        renderSubtasks();
    }
    
    deleteDetailConfirming = false;
    const deleteBtn = document.getElementById('detail-delete-btn');
    if (deleteBtn) {
        // 只改文字节点，不能写 deleteBtn.textContent —— 那会把里面的 <i> 图标一起抹掉
        setDetailDeleteLabel('删除任务');
        deleteBtn.classList.remove('is-confirming');
        deleteBtn.style.cssText = '';
    }
    
    // 添加日期和时间的交互
    setupDateTimeInteractions();
    
    // 添加标题自动调整高度
    setupTitleAutoResize();

    // 绑定标题/备注的输入自动保存：收起态与书写态共用同一套防抖落盘（第十七轮起
    // 收起态也移除了「保存」按钮，改为自动保存；关闭 / 切任务时仍会再兜一次全量保存）
    setupWriteModeAutoSave();

    // 添加子任务模式描述框的输入监听（高度自适应 + 实时写入任务对象）
    setupDetailDescriptionInput();

    // 书写态：刷新面包屑与属性区空属性过滤
    syncDetailWriteModeUI();

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
            // 日期/时间输入框：回车只提交当前输入并收起快速选择下拉，不关闭整个详情面板。
            // （此前回车会走 closeTaskDetailPanel：面板被关掉，且浏览器尚未定稿的输入值
            //   按空串读走 → 时间被清空、任务被误判为全天任务）
            if (e.target instanceof HTMLInputElement &&
                (e.target.type === 'date' || e.target.type === 'time')) {
                e.preventDefault();
                e.stopPropagation();
                commitDetailDateTimeInput(e.target);
                return;
            }
            e.preventDefault();
            closeTaskDetailPanel();
        }
    };
    
    document.removeEventListener('click', handleDetailTimeMenuOutsideClick);
    document.addEventListener('click', handleDetailTimeMenuOutsideClick);

    // 应用只读模式：禁用所有可编辑控件，隐藏操作按钮
    applyDetailReadOnly(detailReadOnly);
    // FR-10：备注块级 Markdown 编辑器（在只读判定之后初始化，保证 readOnly 状态正确）
    if (typeof refreshDetailNotesEditor === 'function') refreshDetailNotesEditor();
    // FR-09：标题行模板入口需在只读/外部任务判定之后同步显隐与提示
    if (typeof updateDetailTemplateEntry === 'function') updateDetailTemplateEntry(task);
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
    // FR-09：只读态不提供「存为模板」（模板来自可编辑任务）
    const saveTplBtn = document.getElementById('detail-save-template-btn');
    // 底部快捷按钮容器（重要/紧急/标签/清单 + 删除/专注/保存）
    const bottomActions = document.querySelector('#task-detail-panel > div:last-child');

    if (readOnly) {
        if (titleInput) titleInput.readOnly = true;
        if (notesInput) notesInput.readOnly = true;
        if (descInput) descInput.readOnly = true;
        if (completeBtn) completeBtn.style.display = 'none';
        if (toggleModeBtn) toggleModeBtn.style.display = 'none';
        if (timeMenuBtn) timeMenuBtn.style.display = 'none';
        if (saveTplBtn) saveTplBtn.style.display = 'none';
        if (progressContainer) progressContainer.style.cursor = 'default';
        if (bottomActions) bottomActions.style.display = 'none';
    } else {
        if (titleInput) titleInput.readOnly = false;
        if (notesInput) notesInput.readOnly = false;
        if (descInput) descInput.readOnly = false;
        if (completeBtn) completeBtn.style.display = '';
        if (toggleModeBtn) toggleModeBtn.style.display = '';
        if (timeMenuBtn) timeMenuBtn.style.display = '';
        if (saveTplBtn) saveTplBtn.style.display = '';
        if (progressContainer) progressContainer.style.cursor = 'pointer';
        if (bottomActions) bottomActions.style.display = '';
    }
}

// 更新任务的创建/完成时间显示（口径 2026-10-18：仅已完成任务展示创建/完成时间；
// 修改时间不展示——modifiedAt 字段保留，仅供「最近修改」排序使用）
function updateDetailTimestamps(task) {
    const container = document.getElementById('detail-timestamps-display');
    if (!container) return;

    // 未完成任务不展示任何时间信息
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

    // FR-01：改期/改提醒/改重复的撤销快照（含提前量与重复配置，撤销后整块还原）
    const _undoSnap = {
        startTime: task.startTime,
        endTime: task.endTime,
        isAllDay: task.isAllDay,
        originalStartTime: task._originalStartTime,
        reminders: (task.reminders || []).slice(),
        reminder: task.reminder || 0,
        repeat: task.repeat ? JSON.parse(JSON.stringify(task.repeat)) : null
    };

    // 记录修改前今日未完成任务数（用于检测是否因修改日期清空今日任务）
    const beforeTodayIncomplete = (typeof ee_countTodayIncomplete === 'function') ? ee_countTodayIncomplete() : -1;

    // 变更检测快照（问题 1）：时间菜单每次收起都会走到这里，无修改时不打 modifiedAt
    const _snap = {
        startTime: task.startTime || null,
        endTime: task.endTime || null,
        isAllDay: !!task.isAllDay,
        hasOrig: task._originalStartTime !== undefined,
        reminders: JSON.stringify(task.reminders || []),
        reminder: task.reminder || 0,
        repeat: JSON.stringify(task.repeat || null),
    };

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
        showToast('结束时间必须晚于开始时间', 'warning');
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

    // 变更比对（问题 1）：有真实变化才打修改时间戳
    const _timeChanged = _snap.startTime !== (task.startTime || null) ||
        _snap.endTime !== (task.endTime || null) ||
        _snap.isAllDay !== !!task.isAllDay ||
        _snap.hasOrig !== (task._originalStartTime !== undefined) ||
        _snap.reminders !== JSON.stringify(task.reminders || []) ||
        _snap.reminder !== (task.reminder || 0) ||
        _snap.repeat !== JSON.stringify(task.repeat || null);
    if (_timeChanged) {
        touchTask(task);
        // FR-01：改期入撤销栈（详情面板这条路径同时弹 Toast，拖拽路径只入栈）
        if (typeof pushUndoEntry === 'function') {
            const entry = pushUndoEntry({
                label: '调整「' + (task.title || '任务') + '」时间',
                kind: 'reschedule',
                undo: function () {
                    if (_undoSnap.startTime === undefined) delete task.startTime; else task.startTime = _undoSnap.startTime;
                    if (_undoSnap.endTime === undefined) delete task.endTime; else task.endTime = _undoSnap.endTime;
                    task.isAllDay = _undoSnap.isAllDay;
                    if (_undoSnap.originalStartTime === undefined) delete task._originalStartTime;
                    else task._originalStartTime = _undoSnap.originalStartTime;
                    task.reminders = _undoSnap.reminders.slice();
                    task.reminder = _undoSnap.reminder;
                    task.repeat = _undoSnap.repeat ? JSON.parse(JSON.stringify(_undoSnap.repeat)) : null;
                }
            });
            if (entry && typeof showUndoToast === 'function') {
                showUndoToast('已调整「' + (task.title || '任务') + '」时间', function () {
                    return (typeof _executeUndoEntry === 'function') ? _executeUndoEntry(entry) : { ok: false, reason: 'invalid' };
                });
            }
        }
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
    // FR-10：先落定块编辑器，再切换模式（子任务拆分读取的是 notes 源码）
    if (typeof mdEditorCommit === 'function') mdEditorCommit({ render: false });
    // FR-10：切换模式前摘掉未完成上传的图片占位，避免被当成子任务文本
    if (typeof cleanupPendingNotePlaceholders === 'function') cleanupPendingNotePlaceholders(task.id);
    
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
        // 关键：先把描述行 + 子任务列表显示出来，再调用 autoResizeDetailDescription。
        // 否则在父链 display:none 时 textarea 的 scrollHeight 永远是 0，
        // 写出的 height=0px 被 min-height:36px 兜底，造成「切回子任务模式后描述框被压成 36px」。
        _setSubtasksAreaVisible(true);
        autoResizeDetailDescription(document.getElementById('detail-task-description'));
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
    touchTask(task); // 模式切换视为内容变更（问题 1）
    // 模式切换后详情文本元素变化（notes <-> description+subtasks），重算毛玻璃带纵向范围
    if (typeof refreshDetailNotesEditor === 'function') refreshDetailNotesEditor();
    requestAnimationFrame(updateWriteModeGlassBounds);
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
    // 快照比对（问题 1）：本函数也会在「打开子任务提醒面板」等渲染路径被调用，
    // 只有子任务内容真正变化时才打 modifiedAt，避免误触
    const _before = JSON.stringify(task.subtasks);
    const _progressBefore = task.progress;
    task.subtasks = newSubtasks;
    updateTaskProgressFromSubtasks(task);
    if (_before !== JSON.stringify(task.subtasks) || _progressBefore !== task.progress) {
        touchTask(task);
    }
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
// 底部拖拽引导条（.subtask-holding::after 的蓝色进度线）延迟出现：
// 普通单击的按压时长通常 < 150ms，若按下即显示，每次点选子任务都会闪一下引导条；
// 延迟到阈值一半才出现，单击全程看不到它，真正想拖拽的人仍能在剩余时间里获得引导。
const SUBTASK_HOLD_HINT_DELAY_MS = 150;
// 引导条填充动画时长 = 长按阈值 − 延迟，保证「线走满」与「拖拽激活」同时发生。
// 写入 CSS 变量，避免 index.html / index_offline.html 里再各写死一份数字。
const SUBTASK_HOLD_FILL_MS = SUBTASK_HOLD_MS - SUBTASK_HOLD_HINT_DELAY_MS;
if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--subtask-hold-anim-ms', SUBTASK_HOLD_FILL_MS + 'ms');
}
let subtaskHoldTimer = null;
let subtaskHoldHintTimer = null;    // 引导条延迟计时器（单击未达阈值时会被清掉）
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
    if (subtaskHoldHintTimer) { clearTimeout(subtaskHoldHintTimer); subtaskHoldHintTimer = null; }
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
    // 防御：若引导条延迟计时器还没触发（阈值被调小的情况），先清掉，避免它在拖拽中把类加回来
    if (subtaskHoldHintTimer) { clearTimeout(subtaskHoldHintTimer); subtaskHoldHintTimer = null; }
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
        checkbox.onclick = () => toggleSubtaskComplete(subtask.id, !subtask.completed, null, checkbox);
        
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
        input.oninput = () => { autoResizeSubtaskInput(input); saveSubtasksToTask(); updateDetailDescriptionPlaceholder(); };
        
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
            // 引导条延后出现：普通单击（按住 < HINT_DELAY）全程看不到它，避免每次点选都闪一下；
            // 行元素已记在 subtaskHoldRow，取消时由 cancelSubtaskHold 统一移除类，不会残留。
            subtaskHoldHintTimer = setTimeout(() => {
                subtaskHoldHintTimer = null;
                if (subtaskHoldRow === wrapper) wrapper.classList.add('subtask-holding');
            }, SUBTASK_HOLD_HINT_DELAY_MS);
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

        // 初始化子任务文本域高度（不设上限，完整显示）
        autoResizeSubtaskInput(input);
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
        const _prev = JSON.stringify(st.reminders || []);
        st.reminders = next;
        if (_prev !== JSON.stringify(st.reminders || [])) touchTask(task); // 问题 1
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
    // body.subtasks-mode：让书写态 CSS 只在子任务模式追加 #detail-body 底部 padding，
    // 把子任务列表滚到 #detail-dock 之上不被浮层遮住（文本模式 notes 自带 padding-bottom:46vh 无需介入）。
    if (document.body) document.body.classList.toggle('subtasks-mode', visible);
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
    if (changed) touchTask(task); // 问题 1：子任务时间变化视为父任务被修改
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

    const _hadValue = !!(subtask.startTime || (subtask.reminders && subtask.reminders.length));
    subtask.startTime = null;
    subtask.reminders = [];
    if (_hadValue) touchTask(task); // 问题 1：确有内容被清除才打戳

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
    touchTask(task); // 问题 1：子任务提醒变化视为父任务被修改
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

    touchTask(task); // 问题 1：子任务排序变化视为父任务被修改
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
        touchTask(task); // 问题 1：子任务增改视为父任务被修改
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
            touchTask(task); // 问题 1：新增子任务视为父任务被修改
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
// sourceEl 可选：被点击的子任务复选框，用于彩蛋锚点捕获。
function toggleSubtaskComplete(subtaskId, completed, taskId, sourceEl) {
    // 彩蛋锚点须在详情面板重渲染（renderSubtasks）前捕获为坐标快照，
    // 否则原复选框元素脱离 DOM 后 getBoundingClientRect 全零导致回退
    const eeAnchor = (typeof ee_captureAnchor === 'function') ? ee_captureAnchor(sourceEl) : null;
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
        // 问题 1：子任务勾选/取消属于内容变更（与父任务自身完成切换的「不算」口径区分）
        touchTask(task);
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

        // 触发彩蛋效果（子任务完成时）：锚点取用户刚勾选的子任务复选框（eeAnchor 快照）
        if (completed && !wasCompleted) {
            if (typeof easterEgg_onSubtaskComplete === 'function') {
                easterEgg_onSubtaskComplete(eeAnchor);
            }
        }

        // 子任务全部完成导致父任务标记为已完成时，通知番茄专注退回"一般专注"
        if (task.completed && !wasTaskCompleted) {
            easterEgg_onTaskComplete(task, eeAnchor);
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
    touchTask(task); // 问题 1：删除子任务视为父任务被修改
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
            touchTask(tasks[taskIndex]); // 问题 1：进度拖拽为内容变更
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

// 任务标题专用：有 120px 上限（标题太长会挤占正文，且书写态另有 320px 上限覆盖）
// ⚠️ 别把子任务也接到这里 —— 子任务需要「多长显示多高」，用 autoResizeSubtaskInput。
function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// 子任务模式下"任务详情描述"输入框的高度自适应
// 子任务模式下描述文本框不再限制高度（CSS 也已去掉 max-height:200px）：
// 文本有多长就让框长多高，超出可视区后由 #detail-body 整体滚动，
// 让详情文本和子任务列表在同一个滚动容器里一起移动，避免描述框内部出现独立滚动条。
function autoResizeDetailDescription(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

// 子任务文本域的高度自适应（**不设上限**）
// 与描述框同一合约：文本有多长就让框长多高，超出可视区由 #detail-body 整体滚动，
// 既不在子任务框内部出现独立滚动条，也不裁掉任何文字（收起态 / 书写态一致）。
// 高度同时由 _initSubtaskAutoResize 在「可用宽度变化」时逐行重算（宽度决定换行行数）。
function autoResizeSubtaskInput(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
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

    // 彩蛋锚点：同步栈内读取当前点击事件源（详情面板完成按钮，内联 onclick 触发）
    const detailSource = (typeof window !== 'undefined' && window.event && window.event.target) || null;
    const { structuralChange } = applyTaskCompletionToggle(task, detailSource);

    updateDetailCompleteButton(task.completed);
    // 书写态：完成圈勾选弹一下（纯 scale，合成层，updateDetailCompleteButton 不会重建按钮）
    if (_wmFxOn()) _wmFxPlay(document.getElementById('detail-task-complete-btn'), 'wm-pop', 0.2);
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

    // 记录「用户在框内动过键盘」的状态：回车提交时用来区分「输入无法识别」与
    // 「本来就空」（后者视为清空时间，按点击面板外一致处理）。
    // 用 keydown 而非 input：键入不被接受的字符（如只输了个 "9"）时 input 不触发，
    // 但 value 同样是空串，正是要提示的那种情况。
    // 输入框每次打开面板都会 clone 重建，标记随之自然重置。
    [newDateInput, newTimeInput, endDateInput, endTimeInput].forEach(el => {
        if (!el) return;
        el.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') el._detailDateTimeDirty = true;
        });
    });
}

// 详情栏日期/时间输入框内按回车：把编辑中的输入定稿（合法则写回 value 并派发 change），
// 收起快速选择下拉，详情面板与时间菜单保持打开。
// - 输入有效 → 立即落库（与点击面板外收起时间菜单同一口径）
// - 输入为空但用户动过键盘（如只输了 "9"，或输入了无法识别的字符）→ 不动任务数据，
//   提示重新输入，避免「以为设了时间，实际被清成全天任务」
// - 输入为空且未动过键盘 → 视为清空时间（与点击面板外一致，按全天处理）
function commitDetailDateTimeInput(input) {
    // 未定稿的无效原文（如只输入了 "9"）：此时 blur 也不会写入 value
    const hasUnparseableInput = !!(input.validity && input.validity.badInput);
    // blur 让浏览器完成定稿/校验（Enter 的默认行为被 preventDefault 掉后不会自动发生），
    // 随后立刻还回焦点，用户不必重新点输入框
    input.blur();
    input.focus();
    // 只收起快速时间/日期选择下拉，不动 #detail-time-menu 与任务详情面板
    closeAllTimePickers();
    // 定稿后仍为空且用户动过键盘 → 输入无法识别，不动任务数据
    if (!input.value && (hasUnparseableInput || input._detailDateTimeDirty)) {
        input.select();
        showToast(input.type === 'date'
            ? '未能识别输入的日期，请检查日期格式'
            : '未能识别输入的时间，请按 HH:MM 格式填写（如 09:30）', 'warning');
        return;
    }
    saveDetailTimeConfig();
}

function closeTaskDetailPanel() {
    // FR-10：先清理未完成上传的占位并落定块编辑器（含文末空块补白回收），
    // 无论后续是关闭面板还是切回番茄概况，都不把临时内容留在正文里。
    if (typeof cleanupPendingNotePlaceholders === 'function') cleanupPendingNotePlaceholders(currentDetailTaskId);
    if (typeof mdEditorCommit === 'function') mdEditorCommit({ render: false });
    // 番茄右栏「任务详情」模式（特性二）：面板此刻托管在番茄页右栏，主视图不可见。
    // 此时「关闭」的语义是切回右栏的专注概况，而不是把主视图的详情栏关掉
    // （关掉只会让右栏留下一块空白）。_unmountDetailFromRight 会先摘托管标记再走这里，故不重入。
    if (typeof isDetailPanelHostedInPomodoro === 'function' && isDetailPanelHostedInPomodoro()) {
        if (typeof setPomodoroRightMode === 'function') {
            setPomodoroRightMode('overview');
            return;
        }
    }
    // 书写态下关闭面板：先撤掉展开态（内部会 flush 自动保存），避免 body 上的 detail-write-mode 残留
    if (typeof exitDetailWriteMode === 'function') exitDetailWriteMode();
    // 面板马上要 display:none，还在排队的场景对切动画已无意义；
    // 若不取消，残留的 wm-morph-out 会给 #task-detail-panel 挂 animation，
    // 与下一次打开面板的 panel-fade-in 抢同一个属性，导致入场动画被顶掉。
    // ⚠️ 退出动画现在是「落地时才摘 detail-write-mode」，面板一隐藏 animationend 就再也
    //    不会来，只剩计时器兜底 —— 必须用 finishNow 把落定回调补做掉，否则书写态会残留
    //    到下一次打开面板（表现为「一打开就是书写态」）。
    if (typeof _wmMorphFinishNow === 'function') _wmMorphFinishNow();
    else if (typeof _wmMorphCancel === 'function') _wmMorphCancel();
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
    const _prevListId = task.listId;
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

    const endDateValue = isTimeRangeMode ? document.getElementById('detail-task-end-date').value : '';
    const endTimeValue = isTimeRangeMode ? document.getElementById('detail-task-end-time').value : '';
    let newEndTime = null;
    if (endDateValue && endTimeValue && !isAllDay) {
        newEndTime = new Date(`${endDateValue}T${endTimeValue}`).toISOString();
    } else if (endDateValue) {
        newEndTime = new Date(endDateValue + 'T00:00:00').toISOString();
    }

    // ── 第二段：唯一校验点（此刻 task 仍完全未被修改）──
    if (newEndTime && newStartTime && new Date(newEndTime) < new Date(newStartTime)) {
        showToast('结束时间必须晚于开始时间', 'warning');
        return false;
    }

    // ── 第三段：校验通过，统一写入 ──
    // 外部任务（_isExtTask）保护外部覆盖字段：title/notes/startTime/endTime/isAllDay/repeat 保留原值，
    // 本地保留字段（mode/description/listId/groupId/important/urgent）仍写；reminder 强制 0（附录 A-5）。
    // 变更追踪（changeFlag）：仅记录真实变化；无修改的换看任务由调用方跳过保存与整板重渲染。
    // 历史数据的可选字段可能缺失或为 null（groupId / reminders / endTime / description 等），
    // 必须先把任务侧值与表单侧默认值归一化到同一语义再比较，否则「未编辑直接换看」会被误判为有修改。
    const _cf = options.changeFlag;
    const _setIf = (cond, apply) => { if (cond) { apply(); if (_cf) _cf.changed = true; } };
    if (!_isExtTask) {
        if (newTitle !== undefined) _setIf((task.title || '') !== newTitle, () => { task.title = newTitle; });
        if (notes !== undefined) _setIf((task.notes || '') !== notes, () => { task.notes = notes; });
        _setIf(JSON.stringify(task.repeat || null) !== JSON.stringify(repeat || null), () => { task.repeat = repeat; });

        // 时间按面板显示的「日期 + 时:分」比较，而非 ISO 瞬时值：历史全天任务可能存成
        // UTC 午夜或本地午夜（同一显示日期对应不同 ISO），直接比 ISO 会让每次换看都误判为修改。
        const _hhmm = (iso) => {
            const d = new Date(iso);
            return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        };
        const curDateValue = task.startTime ? formatDate(new Date(task.startTime)) : '';
        const curTimeValue = (task.startTime && !task.isAllDay) ? _hhmm(task.startTime) : '';
        const startUnchanged = curDateValue === dateValue && curTimeValue === timeValue;
        if (!startUnchanged) {
            if (newStartTime) {
                task.startTime = newStartTime;
                task.isAllDay = isAllDay;
            } else {
                delete task.startTime;
                task.isAllDay = false;
            }
            if (_cf) _cf.changed = true;
            // 手动修改时间后，顺延保留的原始时间失效
            if (task._originalStartTime !== undefined) delete task._originalStartTime;
        }

        const curEndDateValue = task.endTime ? formatDate(new Date(task.endTime)) : '';
        const curEndTimeValue = (task.endTime && !task.isAllDay) ? _hhmm(task.endTime) : '';
        const endUnchanged = (!!task.endTime === isTimeRangeMode)
            && (!isTimeRangeMode || (curEndDateValue === endDateValue && curEndTimeValue === endTimeValue));
        if (!endUnchanged) {
            if (newEndTime) task.endTime = newEndTime;
            else delete task.endTime;
            if (_cf) _cf.changed = true;
        }
    }
    _setIf((task.mode || 'text') !== mode, () => { task.mode = mode; });
    if (description !== undefined) _setIf((task.description || '') !== description, () => { task.description = description; });
    _setIf((task.listId || 'default') !== listId, () => { task.listId = listId; });
    // FR-01：改清单入撤销栈（kind='moveList'，只还原 listId）
    if (!_isExtTask && _prevListId !== task.listId && typeof pushUndoEntry === 'function') {
        const _movedTask = task;
        pushUndoEntry({
            label: '移动「' + (task.title || '任务') + '」到其他清单',
            kind: 'moveList',
            undo: function () { _movedTask.listId = _prevListId; }
        });
    }
    _setIf((task.groupId || null) !== groupId, () => { task.groupId = groupId; });
    _setIf(!!task.important !== important, () => { task.important = important; });
    _setIf(!!task.urgent !== urgent, () => { task.urgent = urgent; });
    // 提前提醒：外部日历任务强制清空（附录 A-5）；旧字段 reminder 作为兼容镜像双写。
    // 旧数据只有 reminder 没有 reminders 数组时，getAdvanceMinutes 会回退读取，
    // 这里同样按回退结果比较，避免仅因字段缺失就判定为修改。
    const newReminders = _isExtTask ? [] : reminders;
    const curReminders = normalizeReminderMinutes(getAdvanceMinutes(task));
    _setIf(JSON.stringify(curReminders) !== JSON.stringify(newReminders),
        () => { task.reminders = newReminders; });
    const newReminderMirror = newReminders.length ? Math.max(...newReminders) : 0;
    _setIf((task.reminder || 0) !== newReminderMirror, () => { task.reminder = newReminderMirror; });
    // 内容发生真实变化时打修改时间戳（问题 1）
    if (_cf && _cf.changed) touchTask(task);
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
        // 右栏互斥：模板选择器打开时先收起它，避免两个右栏同时挤压主区
        const tplPickerPanel = document.getElementById('tpl-picker-panel');
        if (tplPickerPanel && !tplPickerPanel.classList.contains('hidden')
            && typeof closeTaskTemplatePicker === 'function') {
            closeTaskTemplatePicker(true);
        }
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
        if (icon) icon.className = `fas fa-chevron-${collapsed ? 'right' : 'down'} w-3 text-center text-xs text-theme-muted mr-1`;
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

    // 计划面板专用排序：把「无日期」组提到最前（其后依次为 已过期 / 今天 / 明天 / …）。
    // 面板的用途是把未排期任务拖去安排时间，无日期任务最需要被优先处理，
    // 故不跟随「无日期任务位置」设置（默认 last 会把它排到最末）。
    // 仅「按时间分组」模式存在 nodate 组；其他分组模式（标签/优先级/清单等）自然不受影响。
    // 只作用于本面板，任务视图行为保持不变。
    const noDateIdx = groups.findIndex(g => g.key === 'nodate');
    if (noDateIdx > 0) groups.unshift(groups.splice(noDateIdx, 1)[0]);

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
                    <i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'} w-3 text-center text-xs text-theme-muted mr-1"></i>
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
    touchTask(task); // 问题 1：清除时间属时间变更
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
    if (!menu) return;
    const willOpen = menu.classList.contains('hidden');
    menu.classList.remove('wm-menu-in', 'wm-menu-out');
    if (!_wmFxOn()) { menu.classList.toggle('hidden'); return; }
    const fade = _wmFxSeconds('--wm-fx-fade', 0.16);
    if (willOpen) {
        menu.classList.remove('hidden');
        _wmFxPlay(menu, 'wm-menu-in', fade);
    } else {
        // 收起：先播淡出（期间 pointer-events:none），动画结束再真正 hidden，
        // 否则 display:none 会立刻杀掉动画，看起来还是「瞬间消失」
        menu.classList.add('wm-menu-out');
        clearTimeout(menu._wmMenuOutTimer);
        menu._wmMenuOutTimer = setTimeout(() => {
            menu.classList.remove('wm-menu-out');
            menu.classList.add('hidden');
        }, Math.max(60, fade * 1000));
    }
}

function openDetailListPicker() {
    const picker = document.getElementById('detail-list-picker');
    if (!picker) return;
    _cancelHoverPickerClose('detail-list-picker');
    _cancelHoverPickerClose('detail-tag-picker');
    document.getElementById('detail-tag-picker').classList.add('hidden');
    if (!picker.classList.contains('hidden')) return;
    picker.classList.remove('hidden');
    if (_wmFxOn()) _wmFxPlay(picker, 'wm-pop-in', _wmFxSeconds('--wm-fx-fade', 0.16));
}

function closeDetailListPicker() {
    const picker = document.getElementById('detail-list-picker');
    if (!picker) return;
    _cancelHoverPickerClose('detail-list-picker');
    picker.classList.add('hidden');
    picker.classList.remove('wm-pop-in');
}

function toggleDetailListPicker() {
    const picker = document.getElementById('detail-list-picker');
    if (picker.classList.contains('hidden')) {
        openDetailListPicker();
    } else if (!_hoverPickerOpenedForClick('detail-list-picker')) {
        closeDetailListPicker();
    }
}

function updateDetailTimeBtnText() {
    const dateEl = document.getElementById('detail-task-date');
    const timeEl = document.getElementById('detail-task-time');
    const endContainer = document.getElementById('detail-end-time-container');
    const endDateEl = document.getElementById('detail-task-end-date');
    const endTimeEl = document.getElementById('detail-task-end-time');
    const dateValue = dateEl ? dateEl.value : '';
    const timeValue = timeEl ? timeEl.value : '';
    const isAllDay = !timeValue;
    const isRange = endContainer ? !endContainer.classList.contains('hidden') : false;
    const endDateValue = (isRange && endDateEl) ? endDateEl.value : '';
    const endTimeValue = (isRange && endTimeEl) ? endTimeEl.value : '';

    // ---- 1) 收起态顶栏按钮：单行文案（原逻辑保持不变） ----
    let text = '设置时间';

    if (dateValue) {
        const date = new Date(dateValue);
        const dateStr = fmtMD(date);
        if (isAllDay) {
            if (isRange && endDateValue && endDateValue !== dateValue) {
                text = fmtMDRange(date, new Date(endDateValue)) + ' (全天)';
            } else {
                text = dateStr + ' (全天)';
            }
        } else if (timeValue) {
            if (isRange) {
                let endStr = '';
                if (endDateValue) {
                    const sameDay = dateValue === endDateValue;
                    if (sameDay) {
                        endStr = endTimeValue || '';
                    } else {
                        endStr = fmtMD(new Date(endDateValue));
                        if (endTimeValue) endStr += ' ' + endTimeValue;
                    }
                }
                text = dateStr + ' ' + timeValue + ' - ' + (endStr || '...');
            } else {
                text = dateStr + ' ' + timeValue;
            }
        } else {
            text = dateStr;
        }
    }

    const btnText = document.getElementById('detail-time-btn-text');
    if (btnText) btnText.textContent = text;

    // ---- 2) 书写态摘要条：日期与时间合并成一个信息格，再各自独立的「提前 / 重复」 ----
    // 合并后的文案直接复用上面算出的 text —— 跨天时（如「1月2日 22:00 - 1月3日 02:00」
    // 或「1月2日 - 1月5日 (全天)」）日期与时间必须在同一格才读得连贯，
    // 显示规则与收起态顶栏按钮完全一致。
    const segDatetime = dateValue ? text : '';

    const reminderEl = document.getElementById('detail-reminder-text');
    const repeatEl = document.getElementById('detail-repeat-text');
    const reminderText = reminderEl ? reminderEl.textContent.trim() : '';
    const repeatText = repeatEl ? repeatEl.textContent.trim() : '';
    const reminderEmpty = (typeof REMINDER_EMPTY_LABEL !== 'undefined') ? REMINDER_EMPTY_LABEL : '不提前提醒';
    // 提醒 / 重复各自独立成段：不要求必须先有任务时间
    // （「跳过此周期」按钮同样只要求配置了重复，见 refreshDetailSkipCycleButton）
    const segReminder = (reminderText && reminderText !== reminderEmpty) ? reminderText : '';
    const segRepeat = (repeatText && repeatText !== '不重复') ? repeatText : '';
    const hasAny = !!(segDatetime || segReminder || segRepeat);

    setWriteModeTimeSegments({
        datetime: segDatetime,
        reminder: segReminder,
        repeat: segRepeat,
        empty: hasAny ? '' : '设置时间'
    });
}

/* 书写态时间摘要条：逐段写入文案并按空值隐藏。
   段位：datetime（日期+时间合并）/ reminder / repeat / empty。
   四段都是按钮，点任意一段都走同一个 toggleDetailTimeMenu()（展开同一套完整设置面板）。
   隐藏必须靠 .hidden 类 + CSS 里的 !important —— Tailwind 的 .hidden 与本类的 display
   特指度相同，谁后注入谁生效，不能赌注入顺序。 */
function setWriteModeTimeSegments(values) {
    const host = document.getElementById('detail-time-trigger-wm');
    if (!host) return;
    Object.keys(values).forEach(function (part) {
        const seg = host.querySelector('.wm-time-seg[data-part="' + part + '"]');
        if (!seg) return;
        const val = values[part] || '';
        const span = seg.querySelector('span');
        if (span) span.textContent = val;
        seg.classList.toggle('hidden', !val);
    });
}

function updateDetailListBtnText() {
    const listIcon = document.getElementById('detail-list-icon');
    const listNameEl = document.getElementById('detail-list-name');
    // 书写态虚线框内（方案 C / 第八轮）：清单颜色圆点 + 清单名，与任务视图每任务右侧一致
    const listDotEl = document.getElementById('detail-list-dot');
    const listNameWmEl = document.getElementById('detail-list-name-wm');
    const selectedList = lists.find(l => l.id === detailSelectedListId);
    if (selectedList) {
        if (listIcon && selectedList.color) {
            listIcon.style.color = selectedList.color;
        }
        if (listNameEl) {
            listNameEl.textContent = selectedList.name;
        }
        if (listDotEl) {
            listDotEl.style.backgroundColor = selectedList.color || 'transparent';
        }
        if (listNameWmEl) {
            listNameWmEl.textContent = selectedList.name;
        }
    } else {
        if (listNameEl) {
            listNameEl.textContent = '';
        }
        if (listDotEl) {
            listDotEl.style.backgroundColor = 'transparent';
        }
        if (listNameWmEl) {
            listNameWmEl.textContent = '';
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

// 重要 / 紧急 激活态：改由 CSS 类 .is-on 表达（实心圆 + 白图标 + 同色外环），不再写内联样式。
// 原因：border-color / color 在样式表里带 !important，内联根本压不住；而 background 若写在内联，
// 又会被 .wm-circle 的 background:transparent 与 :hover 规则夹击 —— 统一走类切换最稳。
// 未激活态由样式表统一给成中性灰描边，「有色 = 已标记」这条规则才立得住。
function _setDetailPriorityBtnState(btn, on, label) {
    if (!btn) return;
    btn.style.cssText = ''; // 清掉历史内联样式（旧版写在 style 上的 15% 淡底）
    btn.classList.toggle('is-on', !!on);
    btn.title = on ? (label + '（已标记）') : label;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function updateDetailPriorityButtons() {
    _setDetailPriorityBtnState(document.getElementById('detail-task-important'), detailImportantState, '重要');
    _setDetailPriorityBtnState(document.getElementById('detail-task-urgent'), detailUrgentState, '紧急');
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

    // 提醒段是书写态摘要条的四段之一，这里改完文案要顺手刷新它
    if (typeof updateDetailTimeBtnText === 'function') updateDetailTimeBtnText();
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
    touchTask(task); // 问题 1：提醒配置变更
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
    // 重复段是书写态摘要条的四段之一，这里改完文案要顺手刷新它
    if (typeof updateDetailTimeBtnText === 'function') updateDetailTimeBtnText();
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

        // FR-01/FR-02：与共享层 deleteTask 同口径 —— 外部任务硬删 + 黑名单（撤销时插回 + 除名），
        // 原生任务软删除进回收站（撤销时清标记）
        let _undoEntry = null;
        if (_isExt) {
            const _restoreIndex = tasks.indexOf(_extTask);
            tasks = tasks.filter(t => t.id !== deletedId);
            _undoEntry = pushUndoEntry({
                label: '删除任务',
                kind: 'delete',
                undo: function () {
                    tasks.splice(Math.min(_restoreIndex, tasks.length), 0, _extTask);
                    if (typeof removeExternalTaskDeletion === 'function') removeExternalTaskDeletion(_extTask);
                }
            });
        } else if (_extTask) {
            _extTask.deletedAt = new Date().toISOString();
            _extTask.deletedFrom = _extTask.listId || 'default';
            _undoEntry = pushUndoEntry({
                label: '删除任务',
                kind: 'delete',
                undo: function () {
                    _extTask.deletedAt = null;
                    _extTask.deletedFrom = null;
                }
            });
        }
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
        showUndoToast(
            _isExt ? '已删除「' + (_extTask.title || '任务') + '」；该日程已加入屏蔽名单，重新同步后不会再出现'
                   : '已删除「' + (_extTask ? _extTask.title || '任务' : '任务') + '」',
            function () { if (typeof _executeUndoEntry === 'function') return _executeUndoEntry(_undoEntry); return { ok: false, reason: 'invalid' }; }
        );
        return;
    }
    
    deleteDetailConfirming = true;
    const btn = document.getElementById('detail-delete-btn');
    if (btn) {
        // 同上：只改文字，保留 <i> 图标。is-confirming 供书写态渲染红色实心圆
        setDetailDeleteLabel('确认删除');
        btn.classList.add('is-confirming');
    }
    
    setTimeout(() => {
        deleteDetailConfirming = false;
        if (btn) {
            setDetailDeleteLabel('删除任务');
            btn.classList.remove('is-confirming');
            btn.style.cssText = '';
        }
    }, 3000);
}

/** 只更新「删除任务」按钮的文字节点，保留其中的图标元素。
 *  直接写 btn.textContent 会把 <i class="fas fa-trash"> 一并抹掉（曾导致书写态只剩文字）。 */
function setDetailDeleteLabel(label) {
    const el = document.getElementById('detail-delete-label');
    if (el) { el.textContent = label; return; }
    const btn = document.getElementById('detail-delete-btn');
    if (btn) btn.textContent = label;   // 兜底：DOM 结构异常时退回整体赋值
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

function saveTaskDetailWithoutClose(deferRenders) {
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
    if (deferRenders) {
        // 退出动画路径：重渲染推迟到落地帧（与摘 detail-write-mode 同批微任务）。
        // 点击返回的响应不再被 renderView 的整板重建拖慢；主视图淡入期间内容仍为旧值，
        // 落地帧（≈0.2s 后）一次性刷新，与面板内容滑入对齐。
        if (!_wmDeferredRenders) _wmDeferredRenders = [];
        _wmDeferredRenders.push(renderView);
        if (typeof renderTags === 'function') _wmDeferredRenders.push(renderTags);
        if (typeof renderLists === 'function') _wmDeferredRenders.push(renderLists);
    } else {
        renderView();
        if (typeof renderTags === 'function') renderTags();
        if (typeof renderLists === 'function') renderLists();
    }

    // 修改日期可能导致今日任务清空，检查并触发"落日归山"彩蛋
    if (beforeTodayIncomplete > 0 && typeof ee_checkSunsetHorizon === 'function') {
        ee_checkSunsetHorizon();
    }
}

/* ---------- 通用：悬浮展开候选面板（触发器 + 浮层面板） ----------
 * 鼠标悬浮触发器即展开对应面板；移开用短延时收起，用来穿越触发器与气泡之间的
 * 8px 间隙 —— 期间指针进入气泡会取消收起，因此「触发器 → 气泡」是连续可操作的。
 * 只认 pointerType === 'mouse'：触屏 tap 会先派发 pointerenter 再派发 click，
 * 若触摸也走悬浮逻辑，就会「展开后立刻被 click 收起」。
 * 详情栏（清单/标签）与模板编辑面板（标签/清单）共用这一套。 */
const _hoverPickerConfigs = [];
const _hoverPickerCloseTimers = {};

function _findHoverPickerConfig(pickerId) {
    return _hoverPickerConfigs.find(function (p) { return p.pickerId === pickerId; });
}

function _cancelHoverPickerClose(pickerId) {
    if (_hoverPickerCloseTimers[pickerId]) {
        clearTimeout(_hoverPickerCloseTimers[pickerId]);
        _hoverPickerCloseTimers[pickerId] = null;
    }
}

// 鼠标点击触发器时，面板通常已因悬浮而展开 —— 这次点击不应收起它。
// 判定用最近一次 pointerdown 的指针类型（触屏 pointerdown 是 touch，仍按点击 toggle 收起）；
// 不用 (hover:hover) 媒体查询：触屏笔记本的主指针仍可能是触控板，媒体查询会误判为鼠标。
function _hoverPickerOpenedForClick(pickerId) {
    const cfg = _findHoverPickerConfig(pickerId);
    return !!(cfg && cfg.lastPointerType === 'mouse');
}

function _scheduleHoverPickerClose(pickerId) {
    _cancelHoverPickerClose(pickerId);
    _hoverPickerCloseTimers[pickerId] = setTimeout(function () {
        _hoverPickerCloseTimers[pickerId] = null;
        const picker = document.getElementById(pickerId);
        if (!picker || picker.classList.contains('hidden')) return;
        // 延时期间指针已进入气泡 / 回到触发器时，enter 事件通常已取消计时器；
        // 这里再按实际 hover 状态兜底一次，避免面板在鼠标底下被收掉。
        if (picker.matches(':hover')) return;
        const cfg = _findHoverPickerConfig(pickerId);
        const trigger = cfg ? document.getElementById(cfg.triggerId) : null;
        if (trigger && trigger.matches(':hover')) return;
        picker.classList.add('hidden');
        picker.classList.remove('wm-pop-in');
    }, 180);
}

/* configs: [{ triggerId, pickerId, open }]。可重复调用（已绑定过的触发器会跳过）。 */
function setupHoverPickerGroup(configs) {
    configs.forEach(function (cfg) {
        const trigger = document.getElementById(cfg.triggerId);
        const picker = document.getElementById(cfg.pickerId);
        if (!trigger || !picker || trigger._hoverPickerBound) return;
        trigger._hoverPickerBound = true;
        cfg.lastPointerType = '';
        _hoverPickerConfigs.push(cfg);
        trigger.addEventListener('pointerdown', function (e) {
            cfg.lastPointerType = e.pointerType || '';
        });
        trigger.addEventListener('pointerenter', function (e) {
            if (e.pointerType !== 'mouse') return;
            _cancelHoverPickerClose(cfg.pickerId);
            if (picker.classList.contains('hidden')) cfg.open();
        });
        trigger.addEventListener('pointerleave', function (e) {
            if (e.pointerType !== 'mouse') return;
            _scheduleHoverPickerClose(cfg.pickerId);
        });
        picker.addEventListener('pointerenter', function (e) {
            if (e.pointerType !== 'mouse') return;
            _cancelHoverPickerClose(cfg.pickerId);
        });
        picker.addEventListener('pointerleave', function (e) {
            if (e.pointerType !== 'mouse') return;
            _scheduleHoverPickerClose(cfg.pickerId);
        });
    });
}

function setupDetailPickerHover() {
    // init() 会被「导入数据」重复调用；setupHoverPickerGroup 内部按触发器去重
    setupHoverPickerGroup([
        { triggerId: 'detail-list-btn', pickerId: 'detail-list-picker', open: function () { openDetailListPicker(); } },
        { triggerId: 'detail-tag-btn', pickerId: 'detail-tag-picker', open: function () { openDetailTagPicker(); } }
    ]);
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
            // 点击切换按钮不关闭（由按钮自己处理）。
            // 注：书写态虚线框内的清单段 #detail-list-display 现已改为「仅展示」——不再调
            // toggleDetailListPicker()，故无需再把它纳入「不关闭」白名单；清单选择改由按钮簇的
            // #detail-list-btn（<button>）触发，原 button 匹配条件已覆盖。
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

function deleteTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const isExt = !!task.extSourceId;
    // 外部订阅任务：删除时写黑名单（3.3.3），下次同步跳过该 UID 不再重建。
    // 回收站不覆盖外部任务（FR-02 C2-3：软删除会被下次同步重新拉入，属行为倒退），
    // 但撤销入口仍可用（原下标插回 + 移除黑名单记录，V1-7）
    if (isExt && typeof recordExternalTaskDeletion === 'function') {
        recordExternalTaskDeletion(task);
    }
    // 彩蛋：断舍离检测（在DOM移除前获取位置）
    const taskEl = document.querySelector(`[onclick*="toggleTaskComplete('${taskId}')"]`) ||
                   // 只匹配到 id 为止：onclick 现为 openTaskDetailPanel('id', readOnly, fromClick)
                   document.querySelector(`[onclick*="openTaskDetailPanel('${taskId}'"]`);
    easterEgg_onTaskDelete(taskEl);

    let undoEntry = null;
    if (isExt) {
        // 外部任务保持硬删除；撤销时按原下标插回（扁平数组顺序即下标，见 §0.1 约定）
        const restoreIndex = tasks.indexOf(task);
        tasks = tasks.filter(t => t.id !== taskId);
        undoEntry = pushUndoEntry({
            label: '删除任务',
            kind: 'delete',
            undo: function () {
                tasks.splice(Math.min(restoreIndex, tasks.length), 0, task);
                if (typeof removeExternalTaskDeletion === 'function') removeExternalTaskDeletion(task);
            }
        });
    } else {
        // FR-02：原生任务软删除进回收站（保留在 tasks 数组内，原下标天然不变，导出天然包含）
        task.deletedAt = new Date().toISOString();
        task.deletedFrom = task.listId || 'default';
        undoEntry = pushUndoEntry({
            label: '删除任务',
            kind: 'delete',
            undo: function () {
                task.deletedAt = null;
                task.deletedFrom = null;
            }
        });
    }
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
    // FR-01：Toast 撤销入口（撤销本条操作专属的栈记录）
    showUndoToast(
        isExt ? '已删除「' + (task.title || '任务') + '」；该日程已加入屏蔽名单，重新同步后不会再出现'
              : '已删除「' + (task.title || '任务') + '」',
        function () { if (typeof _executeUndoEntry === 'function') return _executeUndoEntry(undoEntry); return { ok: false, reason: 'invalid' }; }
    );
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
    touchTask(task); // 问题 1：跳过周期属时间变更
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
    showToast(`已跳过此周期，时间调整至 ${targetDisplay}`, 'success');
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

    touchTask(task); // 问题 1：撤销跳过也属时间变更
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

    // 撤销类通知统一走简洁通知条（单行、绿边、short 档）
    showCompactToast('已撤销跳过周期，恢复原时间', { tone: 'success' });
}

/**
 * 切换任务完成状态的核心逻辑（不含 UI 刷新）。
 * 供 toggleTaskComplete / toggleTaskDetailComplete 共用，锁住保存口径与完成通知的一致性。
 * @param {object} task - 任务对象
 * @param {HTMLElement|Object} sourceEl - 彩蛋锚点源：点击的复选框/完成按钮元素，或坐标快照
 * @returns {{wasCompleted: boolean, structuralChange: boolean}}
 */
function applyTaskCompletionToggle(task, sourceEl) {
    const wasCompleted = task.completed;
    const preState = { completed: task.completed, completedAt: task.completedAt, progress: task.progress };
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;

    let structuralChange = false;
    let derivedId = null;
    if (task.completed && task.repeat && task.repeat.type) {
        const nextTask = createNextRepeatTask(task);
        if (nextTask) {
            tasks.push(nextTask);
            derivedId = nextTask.id;
        }
        // 新增了重复任务，需全量保存
        saveData();
        structuralChange = true;
    } else {
        // 仅本任务状态变更，增量保存
        saveTaskPatch(task.id);
    }

    // FR-01：完成/取消完成入撤销栈。V1-2 关键细节：撤销「完成」必须同时移除派生出的
    // 下一条重复实例，否则撤销后再次完成会生成重复的下一条
    const undoEntry = pushUndoEntry({
        label: (task.completed ? '已完成「' : '已取消完成「') + (task.title || '任务') + '」',
        kind: 'complete',
        undo: function () {
            task.completed = preState.completed;
            task.completedAt = preState.completedAt;
            task.progress = preState.progress;
            if (derivedId) {
                const di = tasks.findIndex(function (t) { return t.id === derivedId; });
                if (di !== -1) tasks.splice(di, 1);
            }
        }
    });
    // FR-01：Toast 撤销入口（主视图勾选与详情面板完成按钮共用本函数，两处均生效）
    if (typeof showUndoToast === 'function') {
        showUndoToast(
            (task.completed ? '已完成「' : '已取消完成「') + (task.title || '任务') + '」',
            function () { if (typeof _executeUndoEntry === 'function') return _executeUndoEntry(undoEntry); return { ok: false, reason: 'invalid' }; }
        );
    }

    // 触发彩蛋效果 + 通知番茄专注（任务完成时）：锚点取用户实际点击源
    if (task.completed && !wasCompleted) {
        easterEgg_onTaskComplete(task, sourceEl);
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
        // 彩蛋锚点：同步栈内读取当前点击事件源（主视图/看板/周月等各视图复选框，内联 onclick 触发）。
        // 即便上面关闭了同任务的详情面板，window.event 仍指向用户实际点击的主视图复选框，不受面板状态影响
        const clickSource = (typeof window !== 'undefined' && window.event && window.event.target) || null;
        const { structuralChange } = applyTaskCompletionToggle(task, clickSource);
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
        // FR-02：回收站任务不参与过期顺延
        if (task.deletedAt) return false;
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
        // FR-02：回收站任务不计入过期顺延按钮（旁路 filterTasks，需单独排除）
        if (task.deletedAt) return false;
        const taskDate = new Date(task.startTime);
        taskDate.setHours(0, 0, 0, 0);
        return taskDate.getTime() < now.getTime();
    });
    
    if (hasOverdue) {
        postponeBtn.classList.remove('hidden');
    } else {
        postponeBtn.classList.add('hidden');
    }
    // 顺延按钮显隐变化会影响右上角溢出结果
    if (typeof applyHeaderActionOverflow === 'function') applyHeaderActionOverflow();
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
        showToast('请输入清单名称', 'warning');
        return;
    }
    
    // 清单名称唯一性校验
    const existingList = lists.find(l => l.name === name && l.id !== editId);
    if (existingList) {
        showToast('清单名称已存在', 'warning');
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
        showToast('已新建清单', 'success');
    }
}

// 点击"所有任务"按钮 - 清除筛选和清单
function filterAllTasks() {
    // FR-01-4：筛选上下文变化后撤销栈失效
    if (typeof clearUndoStack === 'function') clearUndoStack();
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

function openDetailTagPicker() {
    const picker = document.getElementById('detail-tag-picker');
    if (!picker) return;
    _cancelHoverPickerClose('detail-tag-picker');
    _cancelHoverPickerClose('detail-list-picker');
    // 关闭清单选择器
    document.getElementById('detail-list-picker').classList.add('hidden');
    if (!picker.classList.contains('hidden')) return;
    picker.classList.remove('hidden');
    // 隐藏新建标签表单（每次打开默认收起）
    const form = document.getElementById('detail-new-tag-form');
    if (form) { form.classList.add('hidden'); form.classList.remove('flex'); }
    renderDetailTagPills();
    if (_wmFxOn()) _wmFxPlay(picker, 'wm-pop-in', _wmFxSeconds('--wm-fx-fade', 0.16));
}

function closeDetailTagPicker() {
    const picker = document.getElementById('detail-tag-picker');
    if (!picker) return;
    _cancelHoverPickerClose('detail-tag-picker');
    picker.classList.add('hidden');
    picker.classList.remove('wm-pop-in');
}

function toggleDetailTagPicker() {
    const picker = document.getElementById('detail-tag-picker');
    if (picker.classList.contains('hidden')) {
        openDetailTagPicker();
    } else if (!_hoverPickerOpenedForClick('detail-tag-picker')) {
        closeDetailTagPicker();
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
        // 标签重建会清掉行内的附件按钮，这里补渲染并按新宽度重新判断同行/上方
        if (typeof refreshDetailAttachmentTrigger === 'function') refreshDetailAttachmentTrigger(task);
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
            showToast('每个任务最多 5 个标签', 'warning');
            return;
        }
        task.tags.push(tagId);
    }

    touchTask(task); // 问题 1：标签增删
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
        touchTask(task); // 问题 1：标签增删
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
        showToast('请输入标签名称', 'warning');
        return;
    }
    
    if (name.length > 20) {
        showToast('标签名称最多 20 个字符', 'warning');
        return;
    }
    
    if (!settings.tags) settings.tags = [];
    
    // 标签名称唯一性校验
    if (settings.tags.find(t => t.name === name)) {
        showToast('标签名称已存在', 'warning');
        return;
    }
    
    if (settings.tags.length >= 20) {
        showToast('标签数量已达上限（20 个）', 'warning');
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
        touchTask(task); // 问题 1：标签增删
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
    showToast('已新建标签', 'success');
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
        showToast('请输入标签名称', 'warning');
        return;
    }
    
    // 标签名称长度限制
    if (name.length > 20) {
        showToast('标签名称最多 20 个字符', 'warning');
        return;
    }
    
    if (!settings.tags) settings.tags = [];
    
    // 标签名称唯一性校验
    const existingTag = settings.tags.find(t => t.name === name && t.id !== editId);
    if (existingTag) {
        showToast('标签名称已存在', 'warning');
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
            showToast('标签数量已达上限（20 个）', 'warning');
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
        showToast('已新建标签', 'success');
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

/* ==================== 沉浸书写态（展开态） ====================
 * 布局基线：方案一 —— 主视图被挤占消失（display:none），侧栏保留，详情面板占满剩余空间。
 * 本区块只负责状态机、自动保存与属性区过滤；视觉全部由 index.html 中
 * body.detail-write-mode 的样式块承担，收起态不受任何影响。
 */

let _writeModeSaveTimer = null;
let _writeModeAutoSaveBound = false;

function isDetailWriteMode() {
    return document.body.classList.contains('detail-write-mode');
}

/* 自动保存是否生效：详情面板打开（收起态 / 书写态皆可）且不是只读（归档清单）时生效。
   第十七轮起收起态也改为自动保存（移除了「保存」按钮），所以门禁不能再只看书写态。
   只读态下所有输入被 disabled，本来也不会触发 input，这里再兜一层避免误写归档任务。 */
function isDetailAutoSaveActive() {
    if (typeof detailReadOnly !== 'undefined' && detailReadOnly) return false;
    const panel = document.getElementById('task-detail-panel');
    return !!panel && !panel.classList.contains('hidden');
}

// 自动保存间隔（毫秒）。两态都没有「保存」按钮，输入后按此间隔防抖落盘。
// 间隔不再开放设置，统一取 data.js 的推荐值（AUTO_SAVE_DELAY_MS = 500）。
function writeModeAutoSaveDelay() {
    return (typeof getAutoSaveDelay === 'function') ? getAutoSaveDelay() : 500;
}

function scheduleWriteModeAutoSave() {
    if (!isDetailAutoSaveActive()) return;
    if (_writeModeSaveTimer) clearTimeout(_writeModeSaveTimer);
    _writeModeSaveTimer = setTimeout(function () {
        _writeModeSaveTimer = null;
        if (typeof saveTaskDetailWithoutClose === 'function') saveTaskDetailWithoutClose();
    }, writeModeAutoSaveDelay());
}

// 退出 / 切任务 / 切番茄页前调用：把待落盘的编辑立即写回
// deferRenders=true 时只做「数据落盘」，重渲染（renderView/renderTags/renderLists）推迟到
// 退出动画的落地帧执行（见 _wmRunDeferredRenders），避免点击返回的响应被整板重建拖慢。
function flushWriteModeAutoSave(deferRenders) {
    if (_writeModeSaveTimer) {
        clearTimeout(_writeModeSaveTimer);
        _writeModeSaveTimer = null;
    }
    if (isDetailAutoSaveActive() && typeof saveTaskDetailWithoutClose === 'function') {
        saveTaskDetailWithoutClose(deferRenders === true);
    }
}

// 落地帧统一补跑被推迟的重渲染。与摘 detail-write-mode 在同一批微任务里执行，
// Tailwind JIT 只多一次合并扫描；若动画被中断（关闭面板 / 二次切换），_wmMorphCancel
// 会先补做 land 回调，队列同样在这里被排空，不会丢渲染。
let _wmDeferredRenders = null;
function _wmRunDeferredRenders() {
    if (!_wmDeferredRenders) return;
    const fns = _wmDeferredRenders;
    _wmDeferredRenders = null;
    for (let i = 0; i < fns.length; i++) {
        try { fns[i](); } catch (e) { /* 渲染失败不应卡住落定 */ }
    }
}

function setupWriteModeAutoSave() {
    if (_writeModeAutoSaveBound) return;
    const title = document.getElementById('detail-task-title');
    const notes = document.getElementById('detail-task-notes');
    if (!title || !notes) return;
    const onEdit = function () { scheduleWriteModeAutoSave(); };
    title.addEventListener('input', onEdit);
    notes.addEventListener('input', onEdit);
    // 时间类属性变化后同样触发防抖保存
    ['detail-task-date', 'detail-task-time', 'detail-task-end-date', 'detail-task-end-time'].forEach(function (id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', function () {
            scheduleWriteModeAutoSave();
        });
    });
    _writeModeAutoSaveBound = true;
}

function syncDetailWriteModeUI() {
    setupWriteModeAutoSave();
    if (!isDetailWriteMode()) return;
    updateWriteModeCrumb();
    syncWriteModeTimeMenu();
}

/** 书写态的时间区是「摘要 → 点击展开」两级结构：
 *  - 摘要条文案与收起态顶栏按钮共用 updateDetailTimeBtnText() 写出的同一份文案
 *  - 进入书写态时强制回到收起（默认只显示任务时间） */
function syncWriteModeTimeMenu() {
    const menu = document.getElementById('detail-time-menu');
    if (menu) menu.classList.add('hidden');
    if (typeof updateDetailTimeBtnText === 'function') updateDetailTimeBtnText();
}

/* ---------- 正文容器宽度三档 ---------- */
const WRITE_MODE_WIDTHS = ['standard', 'wide', 'full'];
const WRITE_MODE_WIDTH_LABEL = { standard: '标准', wide: '宽', full: '全屏' };

function applyWriteModeWidth(width) {
    const b = document.body;
    b.classList.remove('wm-w-900', 'wm-w-full');
    if (width === 'wide') b.classList.add('wm-w-900');
    else if (width === 'full') b.classList.add('wm-w-full');
    const btn = document.getElementById('detail-width-btn');
    if (btn) btn.title = '正文宽度：' + (WRITE_MODE_WIDTH_LABEL[width] || '标准');
}

function cycleWriteModeWidth() {
    const cur = (typeof settings !== 'undefined' && settings.writeModeWidth) || 'standard';
    const idx = WRITE_MODE_WIDTHS.indexOf(cur);
    const next = WRITE_MODE_WIDTHS[(idx + 1) % WRITE_MODE_WIDTHS.length];
    if (typeof settings !== 'undefined') settings.writeModeWidth = next;
    applyWriteModeWidth(next);
    // 宽度本身瞬切（动画 width 会重排，低端机必卡），用一次 opacity 凹陷掩盖突变
    _wmBodyFx('wm-fx-width');
    if (typeof saveData === 'function') saveData();
    updateWriteModeGlassBounds();
}

/* ---------- 背景图模式毛玻璃：正文列玻璃带纵向范围 ----------
   玻璃带是 #task-detail-panel::before（top/bottom 由 --wm-glass-top / --wm-glass-bottom 驱动）。
   原来 top:0 bottom:0 贯穿整屏，显得呆板；这里改为「从任务标题顶端 -> 详情文本最后一行」，
   随文字实际位置动态计算。仅书写态 + 有背景图时才有意义（::before 的 backdrop-filter 由
   body.has-bg-image.detail-write-mode 控制），但变量始终计算无害。 */
let _wmGlassInited = false;

// 文本框可能是 flex-1 被拉伸，其 scrollHeight 会等于拉伸后的框高而非文本高度；
// 临时撤掉 flex-grow 让它收缩到内容再测 scrollHeight。关键：先锁住当前宽度，否则撤 flex 后
// 文本框会塌缩到 min-content 宽度导致文字大量换行、scrollHeight 被撑高（实测一句短文本被算成 399px）。
// 还要临时清掉 CSS 的 min-height（详情框 computed min-height≈399px，单句文本会因此被算成 399px 高，
// 而用户要的是「玻璃带止于最后一行文字」，必须量真实文本高度而非编辑框最小高度）。
// 测完立即还原（同步执行、无闪烁）。
function _textElContentHeight(el) {
    if (!el || el.tagName !== 'TEXTAREA') return el ? el.offsetHeight : 0;
    const cs = getComputedStyle(el);
    // scrollHeight 含上下 padding；书写态给正文底部留了约半屏空白（padding-bottom:46vh），
    // 「最后一行文字」的底边必须把这段 padding 扣掉，否则毛玻璃带会多出半屏（见 10.11）。
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const prevFlex = el.style.flex, prevHeight = el.style.height, prevWidth = el.style.width, prevMinH = el.style.minHeight;
    // 量高时把 height 设成 auto，会令文本框暂时不再溢出 → 浏览器把 scrollTop 夹回 0；
    // 恢复高度后 scrollTop 不会自动回来。因此必须存/还原滚动位置，否则每次 input/scroll 都会跳回顶部。
    const prevScrollTop = el.scrollTop;
    el.style.width = el.clientWidth + 'px';
    el.style.flex = '0 0 auto';
    el.style.height = 'auto';
    el.style.minHeight = '0px';
    const h = Math.max(0, el.scrollHeight - padY);
    el.style.flex = prevFlex;
    el.style.height = prevHeight;
    el.style.width = prevWidth;
    el.style.minHeight = prevMinH;
    el.scrollTop = prevScrollTop;
    return h;
}

function updateWriteModeGlassBounds() {
    const panel = document.getElementById('task-detail-panel');
    if (!panel || !document.body.classList.contains('detail-write-mode')) return;
    const titleRow = document.getElementById('detail-title-row');
    if (!titleRow) return;
    const cs = getComputedStyle(panel);
    const borderTop = parseFloat(cs.borderTopWidth) || 0;
    const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
    const panelRect = panel.getBoundingClientRect();
    const titleRect = titleRow.getBoundingClientRect();
    const top = Math.max(0, Math.round(titleRect.top - panelRect.top - borderTop));

    // 「详情文本最后一行」的底边：notes / description 文本框按内容高度取；
    // 子任务模式改取 #subtask-content 底边；取最大值，确保覆盖到真实最后一行文字。
    // 注意：书写态正文框自身是滚动容器（padding-bottom 撑出可滚空间），
    // 最后一行在「视口」中的位置 = 框顶 + 内容高 - scrollTop。必须减去 scrollTop，
    // 玻璃带底边才会随滚动一起上移 —— 滚到底时最后一行落到屏幕中部，玻璃带也止于屏幕中部
    // （否则带子会一直铺到屏幕底，看起来像用空白把文字推到中间，见 10.12）。
    let textBottom = titleRect.bottom;
    // 必须检查「真实渲染高度」而非 offsetParent：#subtask-content 是可见容器，仅子节点隐藏，
    // 若用 offsetParent 会误判为可见并取其底边（≈ 正文区底）污染范围。
    const visible = (el) => el && el.offsetHeight > 0;
    const notes = document.getElementById('detail-task-notes');
    const mdEditor = document.getElementById('detail-notes-md-editor');
    const desc = document.getElementById('detail-task-description');
    const subtaskContent = document.getElementById('subtask-content');
    if (visible(notes)) {
        const nr = notes.getBoundingClientRect();
        textBottom = Math.max(textBottom, nr.top + _textElContentHeight(notes) - (notes.scrollTop || 0));
    }
    if (visible(mdEditor)) {
        // 块编辑器的文本高度同样要扣掉书写态预留的 padding-bottom:46vh，
        // 否则毛玻璃带会多出半屏（与上方 _textElContentHeight 同一口径）。
        const er = mdEditor.getBoundingClientRect();
        const ecs = getComputedStyle(mdEditor);
        const epad = (parseFloat(ecs.paddingTop) || 0) + (parseFloat(ecs.paddingBottom) || 0);
        textBottom = Math.max(textBottom, er.top + Math.max(0, mdEditor.scrollHeight - epad) - (mdEditor.scrollTop || 0));
    }
    if (visible(desc)) {
        const dr = desc.getBoundingClientRect();
        textBottom = Math.max(textBottom, dr.top + _textElContentHeight(desc) - (desc.scrollTop || 0));
    }
    if (visible(subtaskContent)) {
        const sr = subtaskContent.getBoundingClientRect();
        textBottom = Math.max(textBottom, sr.bottom);
    }
    const bottom = Math.max(0, Math.round(panelRect.bottom - textBottom - borderBottom));
    panel.style.setProperty('--wm-glass-top', top + 'px');
    panel.style.setProperty('--wm-glass-bottom', bottom + 'px');
}

// ==================== 子任务模式「描述框」宽度自适应高度 ====================
// 描述文本高度取决于可用宽度（换行行数）。宽度会在多种时机改变：
//   · 进入书写态：#detail-body 从窄侧栏宽 morph 到 wm-width（宽度渐变）
//   · 书写态宽度档切换（standard/wide/full）
//   · 窗口缩放
// 若在这些时机用「瞬态窄宽」测量 scrollHeight，会量出一个偏大的高度残留成大片空白
// （见第十五轮：展开态下描述框下方出现大片留白）。
// 因此用 ResizeObserver 监听「父行 #subtask-desc-row」的宽度：宽度真正变化才重算高度，
// 高度变化不会引起宽度变化，所以不会死循环；测量均在最终宽度上完成。
let _descAutoResizeInited = false;
let _descLastWidth = -1;
function _initDescAutoResize() {
    if (_descAutoResizeInited) return;
    const ta = document.getElementById('detail-task-description');
    const host = document.getElementById('subtask-desc-row');
    if (!ta || !host || typeof ResizeObserver === 'undefined') return;
    _descAutoResizeInited = true;
    const ro = new ResizeObserver(() => {
        const w = Math.round(host.getBoundingClientRect().width);
        // 仅在宽度真正变化（且元素可见、宽度非 0）时重算，避免死循环与隐藏态误测
        if (w > 0 && w !== _descLastWidth) {
            _descLastWidth = w;
            if (!ta.classList.contains('hidden')) autoResizeDetailDescription(ta);
        }
    });
    ro.observe(host);
}

// ==================== 子任务行「宽度 → 高度」自适应 ====================
// 与上面的描述框同理：子任务文本域的高度由「当前可用宽度下文本换行的行数」决定。
// 但子任务行的高度此前只在 renderSubtasks() 里量一次，而 renderSubtasks() 通常发生在
// 收起态（面板 384px 宽 → 文本域可用宽约 289px），长文本在窄宽下换行成 2~3 行被写死；
// 随后进入书写态 / 切换宽度档 / 缩放窗口把可用宽放大到 770~1200px，文本其实只占 1 行，
// 文本域却仍是 2~3 行高 → 表现为「只占一行的子任务却有 2~3 行显示高度、勾选框与文字错位」。
// 这里用 ResizeObserver 监听 #subtasks-container 的宽度：宽度真正变化才逐行重算；
// 高度变化不会引起宽度变化，故不会死循环（与描述框同一套思路）。
let _subtaskAutoResizeInited = false;
let _subtaskLastWidth = -1;
function _initSubtaskAutoResize() {
    if (_subtaskAutoResizeInited) return;
    const host = document.getElementById('subtasks-container');
    if (!host || typeof ResizeObserver === 'undefined') return;
    _subtaskAutoResizeInited = true;
    const ro = new ResizeObserver(() => {
        const w = Math.round(host.getBoundingClientRect().width);
        // 隐藏态（文本模式 / 面板未打开）容器宽为 0，直接跳过，避免把高度误算成 0
        if (w > 0 && w !== _subtaskLastWidth) {
            _subtaskLastWidth = w;
            resizeAllSubtaskInputs();
        }
    });
    ro.observe(host);
}

// 逐行重算子任务文本域高度（宽度变化时调用）
function resizeAllSubtaskInputs() {
    const container = document.getElementById('subtasks-container');
    if (!container) return;
    container.querySelectorAll('textarea[data-subtask-id]').forEach((ta) => autoResizeSubtaskInput(ta));
}

function _initWmGlass() {
    // 每个元素只绑定一次，已初始化过也不提前返回（面板 DOM 可能在首次调用后才补全）。
    ['detail-task-notes', 'detail-task-description', 'subtask-content'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el || el._wmGlassBound) return;
        el._wmGlassBound = true;
        // 文本输入（notes/desc）改变内容高度时重算
        el.addEventListener('input', updateWriteModeGlassBounds);
        // 高度自然变化（描述框自适应、子任务列表增减）时重算
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(updateWriteModeGlassBounds).observe(el);
        }
    });
    if (_wmGlassInited) return;
    _wmGlassInited = true;
    window.addEventListener('resize', () => {
        if (document.body.classList.contains('detail-write-mode')) updateWriteModeGlassBounds();
    });
    // 滚动时玻璃带底边必须跟随「最后一行文字」的视口位置（见 10.12），
    // 所以正文框 / 正文容器滚动过程中也要重算。用 rAF 节流，避免高频滚动反复重排。
    let glassRaf = 0;
    const onScroll = () => {
        if (glassRaf) return;
        glassRaf = requestAnimationFrame(() => {
            glassRaf = 0;
            if (document.body.classList.contains('detail-write-mode')) updateWriteModeGlassBounds();
        });
    };
    ['detail-body', 'detail-task-notes', 'detail-task-description'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('scroll', onScroll, { passive: true });
    });
}

/* ---------- 属性区 ---------- */
/* 第二轮曾在此实现「按任务值过滤空属性 / 折叠开关」，已废弃：
   属性区改回与收起态一致的两级结构（摘要条 + 点击展开的完整设置），
   展开后所有字段都要可见可填，过滤空属性反而会让「提醒 / 重复」无法设置。 */

function updateWriteModeCrumb() {
    const el = document.getElementById('detail-crumb');
    if (!el) return;
    const task = tasks.find(t => t.id === currentDetailTaskId);
    if (!task) { el.textContent = ''; el.title = ''; return; }
    const list = (typeof lists !== 'undefined') ? lists.find(l => l.id === task.listId) : null;
    const text = (list ? list.name : '任务') + ' › ' + (task.title || '无标题');
    el.textContent = text;
    el.title = text;
}

/* ---------- 书写态交互动效编排（第七轮） ----------
 * 门控：设置项「界面交互动效」= settings.smoothAnimations → body.fx-smooth，
 *       且系统未开启「减少动态效果」。CSS 侧另有 prefers-reduced-motion 兜底块（双保险）。
 * 红线：只动 opacity / transform（合成层，不触发 layout / paint），
 *       绝不动 width / max-width / margin（重排），绝不动 backdrop-filter（逐像素重算，全站最贵）。
 * 低端机：app.js 探测后给 body 挂 .fx-low，--wm-fx-* 变量被覆盖（时长砍半、去错峰、不位移）。
 */
function _wmFxOn() {
    if (typeof settings === 'undefined' || settings.smoothAnimations !== true) return false;
    try {
        if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) { /* 环境不支持 matchMedia 时按「已开启」处理，CSS 媒体查询仍会兜底 */ }
    return true;
}

// 读 --wm-fx-* 变量（秒）。从 body 读而非 :root —— body.fx-low 会覆盖这些变量，读 body 才能拿到生效值
function _wmFxSeconds(name, fallback) {
    try {
        const raw = getComputedStyle(document.body).getPropertyValue(name).trim();
        if (!raw) return fallback;
        const n = parseFloat(raw);
        if (isNaN(n)) return fallback;
        return raw.indexOf('ms') >= 0 ? n / 1000 : n;
    } catch (e) { return fallback; }
}

// 单次播放。先摘类 + 强制回流，保证连点也能重播（不回流的话浏览器认为类没变，动画不会重启）
function _wmFxPlay(el, cls, seconds) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    const key = '_wmFxTimer_' + cls;
    clearTimeout(el[key]);
    el[key] = setTimeout(() => el.classList.remove(cls), Math.max(60, seconds * 1000 + 80));
}

// 挂在 body 上的成组微动效（目前只剩 wm-fx-width：正文宽度三档的 opacity 凹陷）
function _wmBodyFx(cls) {
    if (!_wmFxOn()) return;
    const b = document.body;
    b.classList.remove(cls);
    void b.offsetWidth;
    b.classList.add(cls);
    const key = '_wmFxTimer_' + cls;
    clearTimeout(b[key]);
    b[key] = setTimeout(() => b.classList.remove(cls),
        Math.max(60, _wmFxSeconds('--wm-fx-fade', 0.16) * 1000 + 80));
}

/* ---------- 场景对切控制器（第十五轮 → 第十七轮「三区协同」→ 第十八轮「退出单段化」） ----------
 * 取代旧的 wm-fx-enter / wm-fx-exit：
 *   · 旧版动的是九个内容块的 translateY(+6px)，向下溢出 6px → 文档多出滚动条 →
 *     视口窄 10px → #background-image（fixed + cover）被重算 → 背景图先缩小再放大。
 *   · 新版只动两个元素（#main-content / #task-detail-panel），且全部是 opacity + transform，
 *     同时用 overflow:hidden 彻底断掉滚动条这条路（CSS 侧 body.wm-morph-* / .detail-write-mode）。
 *
 * 第十七轮（三区协同）：
 *   · 侧栏在退出首帧即恢复自然几何（CSS 侧 :not(.wm-morph-out) 收口），内容块错峰淡入；
 *     进入时对称错峰淡出。侧栏补偿 --wm-morph-main-left 仅「进入」需要注入。
 *
 * 第十八轮（退出单段化，2026-10-16）：
 *   · 退出不再有第二段「落地」—— 收拢（wmPanelOut：clip-path 全屏 → 右 384px，
 *     detail-write-mode 仍在）一结束就同步做「摘 detail-write-mode + 补跑重渲染 + settle」，
 *     收起态内容直接就位。退出总时长 = --wm-morph-dur = 0.20s（原 0.32s）。
 *   · 删掉落地动画 wmPanelLandIn 的理由：收拢本身就是「从左向右扫过、只剩右侧 384px」的
 *     过滤过程，末帧几何已与收起态逐像素重合；再补一次「收起态内容自右滑入」等于把刚扫到的
 *     东西又推走重来，观感是「抖一下」。对应 CSS 的 .wm-morph-land 规则一并删除。
 *   · land 回调仍是必需的中间态（摘 detail-write-mode / 换几何 / 补跑重渲染）：
 *     连点 / 关闭面板 / 二次切换等中断路径必须补做（_wmMorphCancel），
 *     否则 detail-write-mode 残留（下次打开面板直接是书写态）。
 *
 * 调用时机必须在「骨架切换的同一帧」：
 *   dir='in' 时要赶在 #main-content 被 display:none 之前把 wm-morph-in 挂上，
 *   否则主视图已经被抹掉，配合 fade-out 无处可播（见 enterDetailWriteMode）。
 * 返回本段动画时长（秒）；动效关闭 / 系统减弱动态时返回 0，交由 CSS 直接瞬切。
 */
let _wmMorphTimer = null;
let _wmMorphEndEl = null;
let _wmMorphEndHandler = null;
// 动画全部结束后的回调（进入/退出共用）
let _wmMorphPending = null;
// 退出专用「落地」回调（摘 detail-write-mode / 换几何 / 补跑重渲染）+ 在途退出的 land 闭包（中断路径补做用）
let _wmMorphLandFn = null;
let _wmMorphLandRunner = null;
let _wmMorphLanded = false;

function _wmRunPending() {
    if (!_wmMorphPending) return;
    const fn = _wmMorphPending;
    _wmMorphPending = null;
    try { fn(); } catch (e) { /* 落定回调不得打断收尾 */ }
}

// 中途放弃（面板被关闭 / 二次切换）时立即收尾，避免残留类与别的入场动画抢同一个元素
function _wmMorphCancel() {
    if (_wmMorphTimer) {
        clearTimeout(_wmMorphTimer);
        _wmMorphTimer = null;
    }
    if (_wmMorphEndEl && _wmMorphEndHandler) {
        _wmMorphEndEl.removeEventListener('animationend', _wmMorphEndHandler);
        _wmMorphEndEl = _wmMorphEndHandler = null;
    }
    // 退出动画若还没走到结尾，先把 land 补做掉（内部会同步 settle）：
    // 摘 detail-write-mode、补跑被推迟的重渲染，再统一收尾。
    if (_wmMorphLandRunner) {
        const l = _wmMorphLandRunner;
        _wmMorphLandRunner = null;
        l();
        if (_wmMorphTimer) {
            clearTimeout(_wmMorphTimer);
            _wmMorphTimer = null;
        }
    }
    _wmMorphLanded = false;
    _wmMorphLandFn = null;
    _wmRunPending();
    document.body.classList.remove('wm-morph-in', 'wm-morph-out');
    document.body.style.removeProperty('--wm-morph-left');
    document.body.style.removeProperty('--wm-morph-main-left');
}

// 强制把还没落地的场景对切立即收尾（关闭面板 / 重新打开面板前调用）。
// ⚠️ 会被 openTaskDetailPanel 每次都调到，常态下必须空转早退：
//    classList.remove 对不存在的类不会写 class 属性，本身很便宜，但 removeProperty 与
//    后续两个 classList 操作叠加起来没必要，先判一次有没有活儿干。
function _wmMorphFinishNow() {
    if (!_wmMorphPending && !_wmMorphLandFn && !_wmMorphLandRunner && !_wmMorphTimer && !_wmMorphEndEl
        && !document.body.classList.contains('wm-morph-in')
        && !document.body.classList.contains('wm-morph-out')) return;
    _wmRunPending();
    _wmMorphCancel();
}

function _wmMorphBegin(dir, onSettle, onLand) {
    const cls = 'wm-morph-' + dir;
    const other = dir === 'in' ? 'wm-morph-out' : 'wm-morph-in';
    _wmMorphCancel();
    if (!_wmFxOn()) {
        // 动效关闭 / 系统减弱动态：CSS 侧也是瞬切，land 与 settle 回调必须同步补做
        // （land 里摘 detail-write-mode、换终态几何、补跑推迟的重渲染）
        if (onLand) { try { onLand(); } catch (e) { /* 同上 */ } }
        if (onSettle) { try { onSettle(); } catch (e) { /* 同上 */ } }
        return 0;
    }
    const b = document.body;
    const panel = document.getElementById('task-detail-panel');
    // 面板上若残留打开时的 panel-fade-in / 关闭时的 panel-fade-out：
    // 它与 morph 动画同为「id + 3 类」特异性，靠源码顺序压制；一旦 morph 类被摘掉，
    // 被压制的 fxPanelIn / fxPanelOut 会立即重新起跑，面板在落帧后再滑一次（实测两次 0.25s
    // 叠加，观感就是「滑进来又滑回去」）。入场/出场早已播完，这里直接清干净。
    if (panel) panel.classList.remove('panel-fade-in', 'panel-fade-out');
    b.classList.remove(other);
    // ⚠️ 书写态侧栏完全脱离文档流（CSS 里 position:fixed 贴视口左下角），面板左边界恒为 0，
    //    --wm-morph-left 已停用（旧口径取侧栏宽，侧栏悬浮后必然错位）。
    //    **主视图反过来需要这份补偿**（仅进入）：侧栏一脱离 flex 流，#main-content 的左边界就从
    //    260 掉到 0、宽度 +260px（实测 796 → 1056），正在淡出的主视图会整屏重排 ——
    //    这正是「展开不连贯」的主因。故进入时给主视图注入 margin-left 补偿。
    //    退出时侧栏已由 CSS 的 :not(.wm-morph-out) 收口回到自然几何（in-flow 占位 260px），
    //    再注入会与自然流叠加成双重偏移，必须置 0。
    const sb = document.getElementById('sidebar');
    if (dir === 'in' && sb && sb.offsetWidth > 0) {
        b.style.setProperty('--wm-morph-main-left', Math.round(sb.offsetWidth) + 'px');
    } else {
        b.style.removeProperty('--wm-morph-main-left');
    }
    b.classList.remove(cls);
    void b.offsetWidth;  // 连点时强制重播
    b.classList.add(cls);
    _wmMorphPending = onSettle || null;
    _wmMorphLandFn = onLand || null;
    _wmMorphLanded = false;
    const seconds = _wmFxSeconds('--wm-morph-dur', 0.2);
    // 收尾优先听 animationend —— 低端机上主线程会被这次布局切换拖住，纯计时器可能在动画
    // 还没跑完（甚至还没起步）时就摘类，落帧出现跳变；计时器仅作兜底。
    if (panel) {
        _wmMorphEndHandler = function (e) {
            if (!e || e.target !== panel) return;   // 子元素的动画会冒泡上来
            const name = e.animationName || '';
            if (dir === 'in' ? name !== 'wmPanelIn' : name !== 'wmPanelOut') return;
            if (dir === 'out') land(); else settle();
        };
        _wmMorphEndEl = panel;
        panel.addEventListener('animationend', _wmMorphEndHandler);
    }
    function settle() {
        if (_wmMorphTimer) { clearTimeout(_wmMorphTimer); _wmMorphTimer = null; }
        if (_wmMorphEndEl && _wmMorphEndHandler) {
            _wmMorphEndEl.removeEventListener('animationend', _wmMorphEndHandler);
            _wmMorphEndEl = _wmMorphEndHandler = null;
        }
        // 先补做落定回调，再摘 morph 类。二者必须同一帧同步完成，否则中间态会被渲染成一帧闪跳。
        _wmRunPending();
        b.classList.remove(cls);
        b.style.removeProperty('--wm-morph-left');
        b.style.removeProperty('--wm-morph-main-left');
        // 落帧后按真实几何（无 transform 偏移）重算背景图模式的毛玻璃带
        if (typeof updateWriteModeGlassBounds === 'function') updateWriteModeGlassBounds();
    }
    // 落地（仅退出）：收拢结束 → 摘 detail-write-mode + 补跑被推迟的重渲染 → 同步 settle
    // 摘掉 wm-morph-out 类。幂等。
    // ⚠️ 第十八轮起这里不再挂 wm-morph-land、也不再 setTimeout 等 --wm-land-dur：
    //    收拢末帧的几何已与收起态重合，落地就是「换内容 + 摘类」，没有任何需要播的动画。
    //    land 回调与 settle 必须在同一批同步代码里完成 —— 中间态（已摘书写态、还挂着
    //    morph-out）一旦被渲染成帧，面板会闪一帧全宽 + 收起态内容的错版布局。
    function land() {
        if (_wmMorphLanded) return;
        _wmMorphLanded = true;
        if (_wmMorphTimer) { clearTimeout(_wmMorphTimer); _wmMorphTimer = null; }
        if (_wmMorphLandFn) {
            const fn = _wmMorphLandFn;
            _wmMorphLandFn = null;
            try { fn(); } catch (e) { /* 落定回调不得打断收尾 */ }
        }
        settle();
    }
    _wmMorphLandRunner = dir === 'out' ? land : null;
    // CSS 侧把动画关掉时（系统减弱动态 / 别的规则压掉了 animation），animationend 永远不会来，
    // 只剩计时器兜底 —— 退出动画会因此把「摘 detail-write-mode」推迟一秒多。这里直接探测一次：
    // 面板上没跑我们的动画就立刻落定 / 落地。
    if (panel) {
        try {
            const cs = getComputedStyle(panel);
            if (!cs.animationName || cs.animationName === 'none') {
                if (dir === 'out') land(); else settle();
                return seconds;
            }
        } catch (e) { /* 取不到就按正常流程走计时器兜底 */ }
    }
    _wmMorphTimer = setTimeout(dir === 'out' ? land : settle, Math.max(200, seconds * 2000 + 600));
    return seconds;
}

/* ---------- 进入 / 退出 ---------- */
function enterDetailWriteMode() {
    if (!currentDetailTaskId) return;
    // 进入前先把收起态的编辑落盘，避免布局切换期间丢失
    if (typeof saveTaskDetailWithoutClose === 'function') saveTaskDetailWithoutClose();
    // 场景对切：必须先于（或同帧于）detail-write-mode —— 挂晚了主视图已被 display:none 抹掉，
    // 「原地退场」的 fade-out 就无处可播了。返回值用于落帧后精算毛玻璃带。
    const morphSec = _wmMorphBegin('in');
    // 同帧挂 detail-write-mode：CSS 侧 wm-morph-in 规则会让面板内容块以
    // wmPanelContentIn 滑入，遮罩这一帧发生的「收起态布局 → 书写态布局」切换。
    document.body.classList.add('detail-write-mode');
    applyWriteModeWidth((typeof settings !== 'undefined' && settings.writeModeWidth) || 'standard');
    updateWriteModeCrumb();
    syncWriteModeTimeMenu();
    const dismiss = document.getElementById('detail-dismiss-btn');
    if (dismiss) dismiss.title = '返回（Esc）';
    // 标题放大为 32px 后重算高度（内联 max-height:120px 已由 CSS 放开到 320px）
    const titleEl = document.getElementById('detail-task-title');
    if (titleEl && typeof autoResizeTextarea === 'function') autoResizeTextarea(titleEl);
    // 进入书写态时同步框内「所属清单」圆点+名称（防御：确保即使此前未走 openTaskDetailPanel 的刷新路径也已填充）
    updateDetailListBtnText();
    // 背景图模式：按实际文字位置计算毛玻璃带纵向范围（标题顶端 -> 详情文本末行），避免贯穿整屏
    _initWmGlass();
    requestAnimationFrame(() => requestAnimationFrame(updateWriteModeGlassBounds));
    // 场景对切期间面板带 transform，getBoundingClientRect 会带偏移，范围会算偏；
    // 落帧（morph 结束 + 余量）后再精算一次 —— 与 _wmMorphBegin 的 settle 双保险。
    setTimeout(updateWriteModeGlassBounds, Math.round(morphSec * 1000) + 200);
}

function exitDetailWriteMode() {
    if (!isDetailWriteMode()) return;
    // 数据落盘同步做；重渲染（renderView/renderTags/renderLists）推迟到落地帧执行 ——
    // 与摘 detail-write-mode 同批微任务，JIT 只多一次合并扫描，点击响应不被整板重建拖慢。
    flushWriteModeAutoSave(true);
    // 已在收拢途中（连按 Esc / 连点返回）：不重开一段动画，让它自然落地
    if (document.body.classList.contains('wm-morph-out')) return;
    const dismiss = document.getElementById('detail-dismiss-btn');
    if (dismiss) dismiss.title = '关闭';
    // 场景对切（进入的严格逆过程），第十八轮起退出只有一段：
    //   收拢（--wm-morph-dur）：detail-write-mode **保留**，面板才能以书写态外观从全屏
    //   收拢回右侧 384px（CSS 把面板临时固定为终态几何 + clip-path 收拢）；侧栏在此
    //   首帧即恢复自然几何、内容错峰淡入，主视图同步淡入归位。
    //   收拢末帧（wmPanelOut 的 animationend）走 land 回调 —— 摘 detail-write-mode +
    //   补跑重渲染，随后同批同步 settle 摘掉 wm-morph-out；收起态内容直接就位，不再补
    //   「自右滑入」（第十八轮删除，理由见上方控制器注释）。
    // ⚠️ 旧实现是「先摘 detail-write-mode 再播动画」，播的其实是**收起态**内容从 opacity
    //    0.25 淡入 —— 既没有收拢过程，右侧栏还会「先空一下再浮现」，与进入不对称。
    _wmMorphBegin('out', null, function () {
        // 摘类与补跑重渲染必须与随后的 settle 同一批同步完成（中间态不会被渲染），
        // 否则会出现一帧「全宽面板 + 收起态内容」的错误布局。
        document.body.classList.remove('detail-write-mode');
        _wmRunDeferredRenders();
    });
}

function toggleDetailWriteMode() {
    if (isDetailWriteMode()) exitDetailWriteMode();
    else enterDetailWriteMode();
}

// 顶栏统一的退出按钮：收起态 = 关闭面板，书写态 = 返回三栏布局
function onDetailDismiss() {
    if (isDetailWriteMode()) exitDetailWriteMode();
    // 托管在番茄右栏时，顶栏这个按钮的语义是「返回专注概况」而非关闭主视图面板
    else if (typeof isDetailPanelHostedInPomodoro === 'function' && isDetailPanelHostedInPomodoro()) {
        if (typeof setPomodoroRightMode === 'function') setPomodoroRightMode('overview');
    }
    else closeTaskDetailPanel();
}

/* ---------- Esc 退出书写态 ----------
 * 详情面板原本不响应 Esc（quadrantView.js 注释「详情面板不受 Esc 影响」），
 * 这里只在书写态接管。冒泡阶段 + defaultPrevented 双重让位：
 * 命令面板 / 各类 picker / 番茄页若已处理掉 Esc，此处不再响应。 */
function _writeModeOverlayOpen() {
    const sels = [
        '#detail-time-menu div[id$="-picker"]',
        '#detail-list-picker',
        '#detail-tag-picker',
        '.modal-overlay',
        '[id$="-modal"]'
    ];
    for (let i = 0; i < sels.length; i++) {
        const nodes = document.querySelectorAll(sels[i]);
        for (let j = 0; j < nodes.length; j++) {
            const n = nodes[j];
            if (n && !n.classList.contains('hidden') && n.offsetParent !== null) return true;
        }
    }
    return false;
}

document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (e.defaultPrevented) return;
    if (!isDetailWriteMode()) return;
    if (_writeModeOverlayOpen()) return;
    e.preventDefault();
    exitDetailWriteMode();
});
