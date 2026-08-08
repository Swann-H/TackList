// ==================== 四象限视图（从 views.js 拆分） ====================

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

    // 保存各象限滚动位置（自动刷新等重渲染场景）
    const savedScrolls = {};
    container.querySelectorAll('.quadrant-drop-zone').forEach((zone, i) => {
        savedScrolls[i] = zone.scrollTop;
    });

    container.innerHTML = `
        <div class="h-full flex flex-col">
            <div class="flex items-center justify-between mb-6 flex-shrink-0">
                <h2 class="text-2xl font-bold text-theme-primary">四象限视图</h2>
                <button onclick="resetQuadrantOrder()" class="text-sm text-accent hover:text-accent-hover">
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
                                                <button onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')" class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${task.completed ? 'bg-gray-400 border-gray-400 text-white' : 'border-accent dark:border-white hover:border-accent-hover dark:hover:border-accent-secondary'}">
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
                                                    ${task.progress && task.progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-accent"></i>${task.progress}%</span>` : ''}
                                                    ${isStagnant && key === 'important-not-urgent' ? `<span class="flex items-center gap-1 text-amber-500"><i class="fas fa-hourglass-half"></i>已停留${stagnationDays}天</span>` : ''}
                                                </div>
                                                <div class="font-medium ${task.completed ? 'text-theme-muted' : 'text-theme-primary'}">
                                                    ${task.title || '新任务'}
                                                </div>
                                                ${renderSubtaskListDisplay(task) || (task.notes ? `<div class="text-xs text-theme-muted mt-1">${task.notes}</div>` : '')}
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

    // 同步恢复各象限滚动位置
    container.querySelectorAll('.quadrant-drop-zone').forEach((zone, i) => {
        if (savedScrolls[i] > 0) {
            zone.scrollTop = savedScrolls[i];
        }
    });

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
    const container = document.getElementById('toast-container');
    if (!container) return;

    const existing = document.getElementById('quadrant-stagnation-modal');
    if (existing) existing.remove();

    const theme = {
        color: 'text-amber-400', border: 'border-amber-500', bg: 'bg-amber-500',
        shadow: 'shadow-[0_0_15px_rgba(245,158,11,0.3)]', icon: 'fa-hourglass-half'
    };
    const duration = 30000;

    const toast = document.createElement('div');
    toast.id = 'quadrant-stagnation-modal';
    toast.className = `quest-toast flex flex-col p-4 bg-slate-900/95 backdrop-blur-sm border-l-4 ${theme.border} text-slate-200 ${theme.shadow} w-full`;

    toast.innerHTML = `
        <div class="flex items-center">
            <div class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full border-2 ${theme.border} ${theme.color} bg-slate-900 shadow-[0_0_10px_currentColor] mr-4 relative z-10">
                <i class="fas ${theme.icon} text-lg"></i>
            </div>
            <div class="flex-1 relative z-10 flex flex-col justify-center">
                <div class="${theme.color} text-xs font-black tracking-[0.15em] uppercase mb-0.5 drop-shadow-md">
                    WARNING
                </div>
                <div class="text-sm font-medium text-slate-300 leading-snug">
                    「${escapeHtml(task.title || '新任务')}」已在"重要不紧急"象限停留 <span class="font-bold text-amber-400">${days}</span> 天。${totalCount > 1 ? ` 另有 ${totalCount - 1} 个类似任务。` : ''}
                </div>
            </div>
        </div>
        <div class="flex gap-2 mt-3 relative z-10 justify-end">
            <button class="stagnation-promote-btn px-3 py-1.5 bg-amber-500/20 text-amber-400 border border-amber-500 rounded font-bold hover:bg-amber-500/30 transition text-xs tracking-wider">设为紧急</button>
            <button class="stagnation-focus-btn px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500 rounded font-bold hover:bg-green-500/30 transition text-xs tracking-wider">开始专注</button>
            <button class="stagnation-dismiss-btn px-3 py-1.5 bg-slate-700/50 text-slate-400 border border-slate-600 rounded font-bold hover:bg-slate-600/50 transition text-xs tracking-wider">稍后</button>
        </div>
        <div class="absolute bottom-0 left-0 h-1 ${theme.bg} opacity-80"
             style="animation: progressShrink ${duration}ms linear forwards;">
        </div>
    `;

    container.appendChild(toast);

    let isRemoved = false;
    function removeToast() {
        if (isRemoved) return;
        isRemoved = true;
        toast.classList.add('quest-toast-out');
        setTimeout(() => toast.remove(), 400);
    }

    toast.querySelector('.stagnation-promote-btn').addEventListener('click', () => {
        clearTimeout(autoRemoveTimer);
        removeToast();
        promoteStagnantTask(task.id);
    });
    toast.querySelector('.stagnation-focus-btn').addEventListener('click', () => {
        clearTimeout(autoRemoveTimer);
        removeToast();
        focusStagnantTask(task.id);
    });
    toast.querySelector('.stagnation-dismiss-btn').addEventListener('click', () => {
        clearTimeout(autoRemoveTimer);
        removeToast();
    });

    const autoRemoveTimer = setTimeout(() => {
        removeToast();
    }, duration);
}

function promoteStagnantTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        task.urgent = true;
        saveData();
        renderView();
        showToast(buildTaskToastMessage(task), 'success', null, '已调整为紧急');
    }
}

function focusStagnantTask(taskId) {
    startPomodoroForTask(taskId);
}

function openAddTaskForQuadrant(quadrantKey) {
    const important = quadrantKey.includes('important') && !quadrantKey.includes('not-important');
    const urgent = quadrantKey.includes('urgent') && !quadrantKey.includes('not-urgent');

    openAddTaskModal();
    document.getElementById('task-important').checked = important;
    document.getElementById('task-urgent').checked = urgent;
}
