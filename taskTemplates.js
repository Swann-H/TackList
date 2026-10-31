// taskTemplates.js — FR-09 任务模板
// 依赖（均为运行时解析）：
//   data.js / utils.js : tasks / taskTemplates / settings / lists / saveData / getList / generateId / getDefaultTaskDate
//   tasks.js           : createSubtask / normalizeReminderMinutes
//   sidebarViews.js    : getSidebarNewTaskDefaults
// 数据模型：data.json 顶层键 taskTemplates（与 pomodoroHistory 同级，已在 data.js 四处登记）。
// 模板只存「任务结构」：标题/备注/清单/标签/优先级/提醒/重复/子任务/建议时间。
// 预置模板额外带 presetKey / presetFingerprint，用于升级时识别并更新未被用户改过的旧预置。
// 不复制状态类字段（completed / completedAt / sortOrder / id / createdAt / templateId 等）。
// 日期不写入模板；创建时按「调用上下文 > 设置默认日期」决定，模板的 suggestedTime 只补充一天中的时刻。

const TEMPLATE_WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function getTaskTemplates() {
    if (!Array.isArray(taskTemplates)) taskTemplates = [];
    return taskTemplates;
}

function _templateId() {
    return 'tpl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _templateNameKey(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getTaskTemplateById(tplId) {
    if (!tplId) return null;
    return getTaskTemplates().find(function (t) { return t.id === tplId; }) || null;
}

function getTaskTemplateByName(name, excludeId) {
    const key = _templateNameKey(name);
    if (!key) return null;
    return getTaskTemplates().find(function (t) {
        return t.id !== excludeId && _templateNameKey(t.name) === key;
    }) || null;
}

function _templatePad2(n) {
    return String(n).padStart(2, '0');
}

function _templateNormalizeSuggestedTime(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return _templatePad2(h) + ':' + _templatePad2(mi);
}

function _templateSuggestedTimeOfTask(task) {
    if (!task || !task.startTime || task.isAllDay) return null;
    const d = new Date(task.startTime);
    if (isNaN(d.getTime())) return null;
    return _templatePad2(d.getHours()) + ':' + _templatePad2(d.getMinutes());
}
function _templateSuggestedEndTimeOfTask(task) {
    if (!task || !task.startTime || !task.endTime || task.isAllDay) return null;
    const d = new Date(task.endTime);
    if (isNaN(d.getTime())) return null;
    return _templatePad2(d.getHours()) + ':' + _templatePad2(d.getMinutes());
}

function _templateRemindersOf(task) {
    if (!task) return [];
    if (typeof normalizeReminderMinutes === 'function') {
        const raw = (Array.isArray(task.reminders) && task.reminders.length)
            ? task.reminders
            : (task.reminder ? [task.reminder] : []);
        return normalizeReminderMinutes(raw);
    }
    const raw = Array.isArray(task.reminders) ? task.reminders : [];
    return raw.map(function (v) { return parseInt(v, 10); })
        .filter(function (v) { return !isNaN(v) && v > 0; });
}

function _safeTemplateColor(value, fallback) {
    const v = String(value || '').trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
}

function _templateListSelectable(list) {
    if (!list || list.isFolder || list.archived) return false;
    if (typeof shouldHideExternalList === 'function' && shouldHideExternalList(list)) return false;
    return true;
}

// 详情面板用 data-repeat-props 存「每个工作日 / 节假日前一天」，
// 旧模板可能存成 dailyWorkday / yearlyBeforeHoliday；统一成重复引擎认识的形态。
function _normalizeTemplateRepeat(repeat) {
    if (!repeat || !repeat.type) return null;
    const out = JSON.parse(JSON.stringify(repeat));
    if (out.type === 'dailyWorkday') {
        out.type = 'daily';
        out.workdayOnly = true;
    } else if (out.type === 'yearlyBeforeHoliday') {
        out.type = 'yearly';
        out.beforeHoliday = true;
    }
    return out;
}

// 把重复对象翻译成可读标签（用于选择器/管理页摘要）
function getTaskTemplateRepeatLabel(repeat) {
    if (!repeat || !repeat.type) return '';
    const type = repeat.type;
    if (type === 'custom') {
        const units = { days: '天', weeks: '周', months: '月', years: '年' };
        return repeat.interval ? '每' + repeat.interval + (units[repeat.unit] || '天') : '自定义重复';
    }
    if (type === 'daily') return repeat.workdayOnly ? '每个工作日' : '每天';
    if (type === 'dailyWorkday') return '每个工作日';
    if (type === 'weekly') {
        if (typeof repeat.dayOfWeek === 'number' && TEMPLATE_WEEKDAY_NAMES[repeat.dayOfWeek]) {
            return '每' + TEMPLATE_WEEKDAY_NAMES[repeat.dayOfWeek];
        }
        return '每周';
    }
    if (type === 'weeklyFirstWorkday') return '每周首个工作日';
    if (type === 'weeklyLastWorkday') return '工作周期最后一个工作日';
    if (type === 'monthly') {
        if (repeat.dayOfMonth) return '每月' + repeat.dayOfMonth + '号';
        return '每月';
    }
    if (type === 'monthlyFirstWorkday') return '每月首个工作日';
    if (type === 'monthlyLastWorkday') return '每月最后一个工作日';
    if (type === 'yearly') {
        if (repeat.beforeHoliday) return '每个节假日前一天';
        if (repeat.month && repeat.day) return '每年' + repeat.month + '月' + repeat.day + '日';
        return '每年';
    }
    if (type === 'yearlyBeforeHoliday') return '每个节假日前一天';
    return '重复';
}

function getTaskTemplateMeta(tpl) {
    const task = (tpl && tpl.task) ? tpl.task : {};
    const list = task.listId && typeof getList === 'function' ? getList(task.listId) : null;
    const tagItems = [];
    (task.tags || []).forEach(function (id) {
        const tag = (settings.tags || []).find(function (t) { return t.id === id; });
        if (tag) tagItems.push(tag);
    });
    const reminders = _templateRemindersOf(task);
    const suggestedTime = _templateNormalizeSuggestedTime(task.suggestedTime);
    const suggestedEndTime = _templateNormalizeSuggestedTime(task.suggestedEndTime);
    const timeLabel = suggestedTime
        ? (suggestedEndTime ? suggestedTime + ' - ' + suggestedEndTime : suggestedTime)
        : null;
    const subCount = (task.subtasks || []).filter(function (s) {
        return s && (s.text || '').trim();
    }).length;
    return {
        task: task,
        listName: list ? (list.name || '') : '',
        tags: tagItems,
        reminders: reminders,
        repeatLabel: getTaskTemplateRepeatLabel(task.repeat),
        suggestedTime: suggestedTime,
        suggestedEndTime: suggestedEndTime,
        timeLabel: timeLabel,
        subCount: subCount,
        important: !!task.important,
        urgent: !!task.urgent,
        needsTime: (reminders.length > 0 || !!task.repeat) && !suggestedTime
    };
}

function getRecentTaskTemplates(limit) {
    const max = Math.max(1, parseInt(limit, 10) || 4);
    return getTaskTemplates()
        .filter(function (t) { return t && t.lastUsedAt; })
        .sort(function (a, b) {
            const ta = new Date(a.lastUsedAt).getTime() || 0;
            const tb = new Date(b.lastUsedAt).getTime() || 0;
            if (tb !== ta) return tb - ta;
            return (b.useCount || 0) - (a.useCount || 0);
        })
        .slice(0, max);
}

function _touchTaskTemplateUsage(tpl) {
    if (!tpl) return;
    tpl.lastUsedAt = new Date().toISOString();
    tpl.useCount = (parseInt(tpl.useCount, 10) || 0) + 1;
}

// 从任务抽取模板内容（剥离状态类字段；子任务重排 originalOrder，清空完成态与时间）
function extractTemplateTask(task) {
    if (!task) return null;
    return {
        title: task.title || '',
        notes: task.notes || '',
        description: task.description || '',
        mode: task.mode === 'subtasks' ? 'subtasks' : 'text',
        listId: task.listId || null,
        tags: (task.tags || []).slice(),
        important: !!task.important,
        urgent: !!task.urgent,
        reminders: _templateRemindersOf(task),
        repeat: task.repeat ? _normalizeTemplateRepeat(task.repeat) : null,
        suggestedTime: _templateSuggestedTimeOfTask(task),
        suggestedEndTime: _templateSuggestedEndTimeOfTask(task),
        // 子任务结构与 createSubtask() 产出同构（originalOrder 决定详情面板排序，缺了会不稳定）
        subtasks: (task.subtasks || [])
            .filter(function (s) { return s && (s.text || '').trim(); })
            .map(function (s, i) {
                return {
                    text: s.text || '',
                    completed: false,
                    originalOrder: i,
                    startTime: null,
                    reminders: []
                };
            })
    };
}

function _templateResolveListId(src, options, ctx) {
    function validList(id) {
        if (!id || typeof getList !== 'function') return null;
        const l = getList(id);
        return _templateListSelectable(l) ? id : null;
    }
    const explicit = options && options.listId;
    if (explicit && explicit !== '__template__') {
        const hit = validList(explicit);
        if (hit) return hit;
    }
    // 未显式选择清单时，跟随侧边栏上下文（与空白新建保持一致）
    if (!explicit && ctx && ctx.listId) {
        const hit = validList(ctx.listId);
        if (hit) return hit;
    }
    const fromTemplate = validList(src.listId);
    if (fromTemplate) return fromTemplate;
    if (ctx && ctx.listId) {
        const hit = validList(ctx.listId);
        if (hit) return hit;
    }
    return settings.defaultListId || 'default';
}

function _templateResolveStartDate(options) {
    if (options && options.startDate instanceof Date && !isNaN(options.startDate.getTime())) {
        return new Date(options.startDate.getTime());
    }
    const mode = options && options.dateMode;
    if (mode === 'none') return null;
    if (mode === 'today' || mode === 'tomorrow' || mode === 'nextmonday') {
        return typeof getDefaultTaskDate === 'function' ? getDefaultTaskDate(mode) : null;
    }
    if (mode === 'date' && options.dateStr) {
        const d = new Date(options.dateStr + 'T00:00:00');
        return isNaN(d.getTime()) ? null : d;
    }
    return typeof getDefaultTaskDate === 'function' ? getDefaultTaskDate(settings.defaultTaskDate) : null;
}

// 从模板创建任务（深拷贝 + 新 id + 清单/标签悬空回退）
function createTaskFromTemplate(tpl, options) {
    if (!tpl || !tpl.task) return null;
    options = options || {};
    const src = tpl.task;
    const ctx = (typeof getSidebarNewTaskDefaults === 'function') ? getSidebarNewTaskDefaults() : null;
    const listId = _templateResolveListId(src, options, ctx);
    const validTagIds = (settings.tags || []).map(function (t) { return t.id; });
    const tags = [];
    (src.tags || []).forEach(function (id) {
        if (validTagIds.indexOf(id) !== -1 && tags.indexOf(id) === -1) tags.push(id);
    });
    const contextTagIds = (options.tagIds && options.tagIds.length)
        ? options.tagIds
        : ((ctx && ctx.tagIds) || []);
    contextTagIds.forEach(function (id) {
        if (validTagIds.indexOf(id) !== -1 && tags.indexOf(id) === -1) tags.push(id);
    });

    const reminders = _templateRemindersOf(src);
    const startDate = _templateResolveStartDate(options);
    const suggestedTime = _templateNormalizeSuggestedTime(src.suggestedTime);
    let startTime = null;
    let isAllDay = true;
    if (startDate) {
        const d = new Date(startDate.getTime());
        if (suggestedTime) {
            const parts = suggestedTime.split(':');
            d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
            isAllDay = false;
        } else {
            d.setHours(0, 0, 0, 0);
            isAllDay = true;
        }
        startTime = d.toISOString();
    }
    let endTime = null;
    if (startTime && !isAllDay) {
        const suggestedEndTime = _templateNormalizeSuggestedTime(src.suggestedEndTime);
        if (suggestedEndTime) {
            const end = new Date(startTime);
            const parts = suggestedEndTime.split(':');
            end.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
            if (end.getTime() <= new Date(startTime).getTime()) {
                end.setDate(end.getDate() + 1);
            }
            endTime = end.toISOString();
        }
    }

    const validSubtasks = (src.subtasks || []).filter(function (s) {
        return s && (s.text || '').trim();
    });
    const mode = validSubtasks.length ? 'subtasks' : 'text';
    const subtaskText = validSubtasks.map(function (s) { return s.text.trim(); }).join('\n');
    const notesEchoesSubtasks = !!subtaskText && String(src.notes || '').trim() === subtaskText;
    const notes = mode === 'subtasks' ? subtaskText : (src.notes || '');
    const description = mode === 'subtasks'
        ? (src.description || (notesEchoesSubtasks ? '' : (src.notes || '')))
        : (src.description || '');

    const now = new Date().toISOString();
    const task = {
        id: generateId(),
        title: String(src.title || '').trim() || String(tpl.name || '').trim() || '新任务',
        listId: listId,
        important: !!src.important || !!(ctx && ctx.important === true),
        urgent: !!src.urgent || !!(ctx && ctx.urgent === true),
        notes: notes,
        tags: tags,
        startTime: startTime,
        endTime: endTime,
        isAllDay: isAllDay,
        reminder: reminders.length ? Math.max.apply(null, reminders) : 0,
        reminders: reminders.slice(),
        repeat: src.repeat ? _normalizeTemplateRepeat(src.repeat) : null,
        completed: false,
        createdAt: now,
        mode: mode,
        description: description,
        subtasks: [],
        progress: 0,
        templateId: tpl.id
    };

    validSubtasks.forEach(function (s) {
        task.subtasks.push({
            id: generateId(),
            text: s.text || '',
            completed: false,
            originalOrder: task.subtasks.length,
            startTime: null,
            reminders: []
        });
    });
    // 空模板也要有一个空子任务行（与其它新建入口一致）
    if (task.subtasks.length === 0 && typeof createSubtask === 'function') {
        task.subtasks = [createSubtask('', 0)];
    }

    tasks.push(task);
    _touchTaskTemplateUsage(tpl);
    saveData();
    if (typeof renderLists === 'function') renderLists();
    if (typeof renderView === 'function') renderView();

    if (!options.skipToast && typeof showToast === 'function') {
        const timeSensitive = !!task.repeat || reminders.length > 0;
        const hasClock = !!(task.startTime && !task.isAllDay);
        if (timeSensitive && !hasClock) {
            showToast('已创建「' + task.title + '」；模板含提醒/重复，设置具体时间后生效', 'warning');
        } else {
            showToast('已从模板创建「' + task.title + '」', 'success');
        }
    }
    return task;
}

function createTaskFromTemplateById(tplId, options) {
    const tpl = getTaskTemplateById(tplId);
    if (!tpl) {
        if (typeof showToast === 'function') showToast('模板不存在或已被删除', 'warning');
        return null;
    }
    return createTaskFromTemplate(tpl, options);
}

// ==================== 存为模板：更新 / 另存 ====================

let _tplSaveDialogState = null;

function saveTaskAsTemplate(taskId) {
    const id = taskId || currentDetailTaskId;
    const task = tasks.find(function (t) { return t.id === id; });
    if (!task) return;
    if (task.extSourceId) {
        if (typeof showToast === 'function') showToast('外部订阅任务不能存为模板', 'info');
        return;
    }
    _openTaskTemplateSaveDialog(task);
}

function _openTaskTemplateSaveDialog(task) {
    closeTaskTemplateSaveDialog();
    const linked = task.templateId ? getTaskTemplateById(task.templateId) : null;
    _tplSaveDialogState = { task: task, linked: linked, escHandler: null };
    const defaultName = linked ? linked.name : (task.title || '任务模板');
    const overlay = document.createElement('div');
    overlay.id = 'tpl-save-overlay';
    overlay.className = 'fixed inset-0 modal-overlay flex items-end sm:items-center justify-center';
    overlay.style.zIndex = '65';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '存为模板');
    overlay.innerHTML =
        '<div class="bg-theme-secondary rounded-t-2xl sm:rounded-xl shadow-theme border border-theme p-5 w-full sm:w-[26rem] max-w-[92vw]" onclick="event.stopPropagation()">' +
            '<div class="flex items-start justify-between gap-3 mb-3">' +
                '<div>' +
                    '<h3 class="text-base font-semibold text-theme-primary">存为模板</h3>' +
                    '<p class="text-xs text-theme-muted mt-1">' +
                        (linked
                            ? '此任务由模板「' + escapeHtml(linked.name) + '」创建，可更新原模板或另存为新模板。'
                            : '模板名称用于在选择器里识别，任务标题会保留当前内容。') +
                    '</p>' +
                '</div>' +
                '<button type="button" class="p-1.5 rounded-lg text-theme-muted hover:bg-theme-tertiary transition" onclick="closeTaskTemplateSaveDialog()" aria-label="关闭"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<input id="tpl-save-name" type="text" maxlength="30" aria-label="模板名称" class="w-full px-3 py-2 text-sm border border-theme rounded-lg bg-theme-tertiary text-theme-primary" value="' + escapeHtml(defaultName) + '" oninput="_refreshTaskTemplateSaveDialog()">' +
            '<div id="tpl-save-hint" class="text-[11px] text-theme-muted mt-1.5 min-h-[1rem]"></div>' +
            '<div class="flex flex-wrap justify-end gap-2 mt-4">' +
                '<button type="button" class="px-3 py-1.5 text-sm rounded-lg border border-theme text-theme-secondary hover:bg-theme-tertiary transition" onclick="closeTaskTemplateSaveDialog()">取消</button>' +
                (linked ? '<button type="button" id="tpl-save-secondary" class="px-3 py-1.5 text-sm rounded-lg border border-theme text-theme-secondary hover:bg-theme-tertiary transition disabled:opacity-50" onclick="_saveTaskTemplateDialogSecondary()">另存为新模板</button>' : '') +
                '<button type="button" id="tpl-save-primary" class="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover transition disabled:opacity-50" onclick="_saveTaskTemplateDialogPrimary()">' + (linked ? '更新模板' : '保存') + '</button>' +
            '</div>' +
        '</div>';
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeTaskTemplateSaveDialog();
    });
    document.body.appendChild(overlay);
    const input = document.getElementById('tpl-save-name');
    if (input) {
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); _saveTaskTemplateDialogPrimary(); }
        });
        setTimeout(function () { input.focus(); input.select(); }, 30);
    }
    _tplSaveDialogState.escHandler = function (e) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        closeTaskTemplateSaveDialog();
    };
    document.addEventListener('keydown', _tplSaveDialogState.escHandler);
    _refreshTaskTemplateSaveDialog();
}

function _refreshTaskTemplateSaveDialog() {
    const state = _tplSaveDialogState;
    const input = document.getElementById('tpl-save-name');
    if (!state || !input) return;
    const name = input.value.trim();
    const dup = getTaskTemplateByName(name, state.linked ? state.linked.id : null);
    const primary = document.getElementById('tpl-save-primary');
    const secondary = document.getElementById('tpl-save-secondary');
    const hint = document.getElementById('tpl-save-hint');
    let hintText = '';
    let disablePrimary = false;
    let disableSecondary = false;

    if (!name) {
        hintText = '请输入模板名称';
        disablePrimary = true;
        disableSecondary = true;
    } else if (state.linked) {
        if (dup) {
            hintText = '名称已被其他模板「' + dup.name + '」占用';
            disablePrimary = true;
            disableSecondary = true;
        }
        if (primary) primary.textContent = '更新模板';
    } else if (dup) {
        hintText = '同名模板「' + dup.name + '」已存在，保存将覆盖该模板';
        if (primary) primary.textContent = '覆盖并保存';
    } else {
        if (primary) primary.textContent = '保存';
    }
    if (hint) {
        hint.textContent = hintText;
        hint.className = 'text-[11px] mt-1.5 min-h-[1rem] ' + (hintText ? 'text-amber-500' : 'text-theme-muted');
    }
    if (primary) primary.disabled = disablePrimary;
    if (secondary) secondary.disabled = disableSecondary;
}

function _finishTaskTemplateSaveDialog() {
    const state = _tplSaveDialogState;
    closeTaskTemplateSaveDialog();
    if (typeof refreshTaskTemplatesUi === 'function') refreshTaskTemplatesUi();
    if (typeof refreshTaskTemplatePicker === 'function') refreshTaskTemplatePicker();
    if (state && state.task && typeof updateDetailTemplateEntry === 'function') {
        updateDetailTemplateEntry(state.task);
    }
}

function _saveTaskTemplateDialogPrimary() {
    const state = _tplSaveDialogState;
    const input = document.getElementById('tpl-save-name');
    if (!state || !input) return;
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const dup = getTaskTemplateByName(name, state.linked ? state.linked.id : null);
    if (state.linked) {
        if (dup) { _refreshTaskTemplateSaveDialog(); return; }
        state.linked.name = name;
        state.linked.task = extractTemplateTask(state.task);
        state.linked.updatedAt = new Date().toISOString();
        state.task.templateId = state.linked.id;
        saveData();
        if (typeof showToast === 'function') showToast('已更新模板「' + name + '」', 'success');
        _finishTaskTemplateSaveDialog();
        return;
    }
    if (dup) {
        dup.task = extractTemplateTask(state.task);
        dup.updatedAt = new Date().toISOString();
        state.task.templateId = dup.id;
        saveData();
        if (typeof showToast === 'function') showToast('已更新模板「' + dup.name + '」', 'success');
        _finishTaskTemplateSaveDialog();
        return;
    }
    const now = new Date().toISOString();
    const tpl = {
        id: _templateId(),
        name: name,
        createdAt: now,
        updatedAt: now,
        task: extractTemplateTask(state.task)
    };
    getTaskTemplates().push(tpl);
    state.task.templateId = tpl.id;
    saveData();
    if (typeof showToast === 'function') showToast('已存为模板「' + name + '」', 'success');
    _finishTaskTemplateSaveDialog();
}

function _saveTaskTemplateDialogSecondary() {
    const state = _tplSaveDialogState;
    const input = document.getElementById('tpl-save-name');
    if (!state || !input || !state.linked) return;
    let name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (_templateNameKey(name) === _templateNameKey(state.linked.name)) {
        name = _uniqueTemplateCopyName(state.linked.name);
    }
    if (getTaskTemplateByName(name, null)) {
        _refreshTaskTemplateSaveDialog();
        return;
    }
    const now = new Date().toISOString();
    const tpl = {
        id: _templateId(),
        name: name,
        createdAt: now,
        updatedAt: now,
        task: extractTemplateTask(state.task)
    };
    const list = getTaskTemplates();
    const anchor = list.findIndex(function (t) { return t.id === state.linked.id; });
    if (anchor !== -1) list.splice(anchor + 1, 0, tpl);
    else list.push(tpl);
    state.task.templateId = tpl.id;
    saveData();
    if (typeof showToast === 'function') showToast('已另存为模板「' + name + '」', 'success');
    _finishTaskTemplateSaveDialog();
}

function closeTaskTemplateSaveDialog() {
    const overlay = document.getElementById('tpl-save-overlay');
    if (overlay) overlay.remove();
    if (_tplSaveDialogState && _tplSaveDialogState.escHandler) {
        document.removeEventListener('keydown', _tplSaveDialogState.escHandler);
    }
    _tplSaveDialogState = null;
}

// ==================== 模板选择器 ====================

let _tplPickerState = null;
let _tplPickerEscHandler = null;
let _tplPickerHideTimer = null;
let _tplPickerOutsideBound = false;
let _tplPickerIgnoreOutsideClick = false;
let _tplPickerSelectTimer = null;
// 单击只高亮，超过这个时长没有再次单击同一行就自动熄灭
const TPL_PICKER_SELECT_RESET_MS = 3000;

// 选择器右栏：与任务详情面板同款（384px 文档流兄弟节点，移动端全屏）
function _ensureTaskTemplatePickerCss() {
    if (document.getElementById('tpl-picker-css')) return;
    const style = document.createElement('style');
    style.id = 'tpl-picker-css';
    style.textContent = `
        @media (min-width: 769px) {
            body.fx-smooth #tpl-picker-panel.panel-fade-in { animation: fxPanelIn .25s ease both; }
            body.fx-smooth #tpl-picker-panel.panel-fade-out { animation: fxPanelOut .2s ease forwards; }
            body.fx-smooth #tpl-picker-panel:not(.hidden) { position: fixed; top: 0; right: 0; bottom: 0; }
            body.fx-smooth.tpl-picker-open #main-content { margin-right: 24rem; }
        }
        @media (max-width: 768px) {
            #tpl-picker-panel {
                position: fixed !important;
                top: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                left: 0 !important;
                /* width 交给 left/right 撑开：写 100% 会取 #app-container 的宽度，
                   主区内容更宽时会溢出视口，右侧的关闭与「管理模板」会被裁掉 */
                width: auto !important;
                max-width: 100vw !important;
                height: 100dvh !important;
                z-index: 52 !important;
                border: none !important;
                overflow-x: hidden;
            }
            #tpl-picker-panel:not(.hidden) { animation: mobilePanelIn .28s ease; }
            #tpl-picker-panel .tpl-picker-dock {
                padding-bottom: calc(0.75rem + env(safe-area-inset-bottom)) !important;
            }
            /* 触控目标 40 → 44（规范 7），与侧边栏动作按钮的移动端提升同口径 */
            #tpl-picker-panel .tpl-circle { width: 44px !important; height: 44px !important; }
        }
        body.has-bg-image #tpl-picker-panel {
            background-color: rgba(var(--bg-secondary-rgb, 255,255,255), 0.55) !important;
            backdrop-filter: blur(var(--bg-blur, 12px)) !important;
            -webkit-backdrop-filter: blur(var(--bg-blur, 12px)) !important;
        }
        body.has-bg-image #tpl-picker-panel .bg-theme-secondary,
        body.has-bg-image #tpl-picker-panel.bg-theme-secondary {
            background-color: transparent !important;
            backdrop-filter: blur(var(--bg-blur, 12px)) !important;
            -webkit-backdrop-filter: blur(var(--bg-blur, 12px)) !important;
        }
        html[data-blur="off"] body.has-bg-image #tpl-picker-panel {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            background-color: rgba(var(--bg-secondary-rgb, 255,255,255), 0.92) !important;
        }
        html[data-blur="off"] body.has-bg-image #tpl-picker-panel .bg-theme-secondary,
        html[data-blur="off"] body.has-bg-image #tpl-picker-panel.bg-theme-secondary {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            background-color: rgba(var(--bg-secondary-rgb, 255,255,255), 0.92) !important;
        }
        /* 384px 宽度下省略行尾圆形加号：整行本身即可点击，省出的宽度留给标签与清单 */
        #tpl-picker-panel .tpl-picker-row .tpl-card-add { display: none; }

        /* ---- 底部停靠区圆钮：一比一复刻任务详情栏 .wm-circle（index.html:3198）----
           基础形态（40×40 正圆 / 2px 语义色描边 / 透明底 / 图标 15px 且 color:inherit）
           直接复用全局 .wm-circle，这里只补 picker 自己的配色与 hover / 激活态：
           .wm-circle 的 background 没有 !important（详情栏注释明确要求，否则会抹掉激活淡底），
           所以 hover 的 background-color 必须带 !important 才能压过透明底。 */
        #tpl-picker-panel .tpl-circle {
            border-color: var(--tpl-btn-color, var(--accent-color)) !important;
            color: var(--tpl-btn-color, var(--accent-color)) !important;
        }
        #tpl-picker-panel .tpl-circle:hover {
            background-color: var(--tpl-btn-color, var(--accent-color)) !important;
            border-color: var(--tpl-btn-color, var(--accent-color)) !important;
            color: #fff !important;
        }
        /* 清单候选已展开（或已指定具体清单）时实心：圆钮不带文字，状态只能靠颜色表达 */
        #tpl-picker-panel .tpl-circle.is-on {
            background-color: var(--tpl-btn-color, var(--accent-color)) !important;
            border-color: var(--tpl-btn-color, var(--accent-color)) !important;
            color: #fff !important;
        }

        /* 行 hover：与管理页 .tpl-manage-row 同为 hover:opacity-80（不改底色），
           这样象限底色在 hover 时依然成立；hover 换底色会把象限色盖掉。 */
        #tpl-picker-panel .tpl-picker-row:hover { opacity: .8; }

        /* 行左侧清单色条：与全局 .task-list-color-bar 同规格（4px / 绝对定位 / 贴满上下），
           但选择器行是 <button>，内部只能放 phrasing content，故用 <span> 承载。
           rounded-r-lg + 左侧贴边，形成规范 2.6 要求的「色条 + 卡片」连续感。 */
        #tpl-picker-panel .tpl-picker-color-bar {
            position: absolute;
            left: 0;
            top: -1px;
            bottom: -1px;
            width: 4px;
            z-index: 1;
        }

        /* 搜索输入框：与回收站 / 模板管理页同款（border-2 + focus 改 accent 描边） */
        #tpl-picker-panel #tpl-picker-search:focus {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 3px var(--accent-bg);
        }

        /* ---- 行选中态（单击高亮、3 秒内再次单击同一行创建）----
           口径取番茄专注页「选取关联任务」的选定态：反色——
           浅色模式选中转深（#1f2937），深色模式选中转浅（#f9fafb），
           行内三档文字色同步反转，保证深/浅底上都可读。
           · 底色必须 !important：行本身可能带象限底色（重要/紧急），选中态要压过它；
           · 行 hover 时整体 opacity .8，选中行回到 1，否则高亮会被自己压暗。 */
        #tpl-picker-panel .tpl-picker-row.is-selected {
            background-color: #1f2937 !important;
        }
        #tpl-picker-panel .tpl-picker-row.is-selected .text-theme-primary { color: #f9fafb !important; }
        #tpl-picker-panel .tpl-picker-row.is-selected .text-theme-secondary { color: #d1d5db !important; }
        #tpl-picker-panel .tpl-picker-row.is-selected .text-theme-muted { color: #a8a29e !important; }
        [data-theme="dark"] #tpl-picker-panel .tpl-picker-row.is-selected {
            background-color: #f9fafb !important;
        }
        [data-theme="dark"] #tpl-picker-panel .tpl-picker-row.is-selected .text-theme-primary { color: #111827 !important; }
        [data-theme="dark"] #tpl-picker-panel .tpl-picker-row.is-selected .text-theme-secondary { color: #6b7280 !important; }
        [data-theme="dark"] #tpl-picker-panel .tpl-picker-row.is-selected .text-theme-muted { color: #78716c !important; }
        /* 选中行：模板图标换成「添加任务」圆钮（与主视图右上角同形），
           外圈在第 1.5 秒开始用 1.5 秒抽空，与 3 秒选中超时同步。
           --tpl-ring-delay 由 _syncTaskTemplatePickerSelection 按已过时间写入，
           保证搜索/日期重渲染后动画相位仍与计时器一致。 */
        #tpl-picker-panel .tpl-picker-lead {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #tpl-picker-panel .tpl-picker-add-icon {
            display: none;
            position: relative;
            width: 20px;
            height: 20px;
            align-items: center;
            justify-content: center;
            color: #a855f7;
        }
        #tpl-picker-panel .tpl-picker-row.is-selected .tpl-picker-lead-default { display: none; }
        #tpl-picker-panel .tpl-picker-row.is-selected .tpl-picker-add-icon { display: flex; }
        #tpl-picker-panel .tpl-picker-add-icon .tpl-picker-add-ring {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            transform: rotate(-90deg);
            overflow: visible;
        }
        #tpl-picker-panel .tpl-picker-add-icon .tpl-picker-add-ring circle {
            fill: none;
            stroke: #a855f7;
            stroke-width: 1.6;
            stroke-linecap: round;
            stroke-dasharray: 53.41;
            stroke-dashoffset: 0;
        }
        #tpl-picker-panel .tpl-picker-row.is-selected .tpl-picker-add-icon .tpl-picker-add-ring circle {
            animation: tplPickRingDrain 1.5s linear var(--tpl-ring-delay, 1.5s) forwards;
        }
        #tpl-picker-panel .tpl-picker-add-icon .fa-plus {
            position: relative;
            font-size: 9px;
            line-height: 1;
        }
        @keyframes tplPickRingDrain {
            to { stroke-dashoffset: 53.41; }
        }

        /* 选中行 hover：不再整体降透明（高亮会被自己压暗） */
        #tpl-picker-panel .tpl-picker-row.is-selected:hover { opacity: 1; }
    `;
    document.head.appendChild(style);
}

function _ensureTaskTemplatePickerPanel() {
    let panel = document.getElementById('tpl-picker-panel');
    if (panel) return panel;
    panel = document.createElement('aside');
    panel.id = 'tpl-picker-panel';
    panel.className = 'hidden w-96 bg-theme-secondary border-l border-theme flex flex-col h-screen relative z-40';
    panel.setAttribute('aria-label', '从模板创建');
    const app = document.getElementById('app-container') || document.body;
    app.appendChild(panel);
    return panel;
}

// 骨架与任务详情栏同构（规范 4.10）：顶栏（上下文 + 关闭）→ 正文列表 → 底部停靠区。
// 四层之间一律不画横向分割线，分区只靠 16px 留白与字号层级分群 —— 分割线是「弹窗表单感」的主要来源。
// 停靠区一行搞定：左侧（搜索框，常驻但可收起）+ 右侧圆钮（搜索 / 转到模板管理）。
// 搜索框是**常驻节点、只切 hidden**，不参与行区重渲染 —— 否则中文输入法组合串会被打断。
// 收起时左侧不占位，圆钮被推到右侧，与详情栏停靠区同观感。
// 清单目标不在面板里选：不指定清单本就是常态，创建时跟随模板自带清单。
function _tplPickerPanelHtml() {
    return '<div class="px-4 pt-4 pb-3 flex items-center justify-between gap-2 flex-shrink-0">' +
            '<div id="tpl-picker-date-chips" class="flex items-center gap-1 min-w-0"></div>' +
            '<button type="button" class="p-2 hover:bg-theme-tertiary rounded-lg transition flex-shrink-0" onclick="closeTaskTemplatePicker()" aria-label="关闭" title="关闭"><i class="fas fa-times text-theme-muted"></i></button>' +
        '</div>' +
        // pt-1 与顶栏的 pb-3 合计 16px，分区间距仍是 16（不靠分割线，只靠留白）
        '<div id="tpl-picker-list-box" class="flex-1 min-h-0 overflow-y-auto px-4 pt-1 pb-4">' +
            '<div id="tpl-picker-rows" class="space-y-1"></div>' +
        '</div>' +
        '<div class="tpl-picker-dock px-4 py-3 flex-shrink-0">' +
            '<div class="flex items-center gap-2">' +
                // lead：搜索展开时占满剩余宽度（收起时留白，圆钮自然靠右）
                '<div class="flex-1 min-w-0 flex items-center">' +
                    '<div id="tpl-picker-search-wrap" class="hidden w-full min-w-0">' +
                        '<input id="tpl-picker-search" type="text" autocomplete="off" spellcheck="false" ' +
                            'placeholder="搜索模板名称或任务标题…" ' +
                            'oninput="onTaskTemplatePickerSearchInput(this.value)" onkeydown="onTaskTemplatePickerSearchKeydown(event)" ' +
                            'class="w-full px-3 py-2 border-2 border-theme rounded-lg bg-theme-secondary text-theme-primary text-sm focus:outline-none focus:border-accent">' +
                    '</div>' +
                '</div>' +
                // 搜索沿用回收站 / 模板管理页的 cyan-500（全站搜索入口既定色）
                '<button type="button" id="tpl-picker-search-btn" class="wm-circle tpl-circle flex-shrink-0" style="--tpl-btn-color: #06b6d4;" onclick="toggleTaskTemplatePickerSearch()" title="搜索" aria-label="搜索"><i class="fas fa-search"></i></button>' +
                // 转到模板管理：fa-arrow-right-from-bracket（方框 + 右出箭头）
                // 40px 圆钮下比 9px 挂角小箭头清晰得多，语义也更直白（从当前面板转到外部页面）
                '<button type="button" class="wm-circle tpl-circle flex-shrink-0" style="--tpl-btn-color: #6366f1;" onclick="openTaskTemplatesPageFromPicker(false)" title="转到模板管理" aria-label="转到模板管理"><i class="fas fa-arrow-right-from-bracket"></i></button>' +
            '</div>' +
        '</div>';
}

// 搜索开关：只切两个常驻节点的可见性与按钮态，不重建 input（重建会打断中文输入法组合串）
function _syncTaskTemplatePickerSearchUI() {
    const on = !!(_tplPickerState && _tplPickerState.searchVisible);
    const wrap = document.getElementById('tpl-picker-search-wrap');
    const input = document.getElementById('tpl-picker-search');
    const btn = document.getElementById('tpl-picker-search-btn');
    if (wrap) wrap.classList.toggle('hidden', !on);
    if (input) {
        const q = _tplPickerState ? _tplPickerState.query : '';
        if (input.value !== q) input.value = q;
    }
    if (btn) {
        btn.classList.toggle('is-on', on);
        btn.title = on ? '隐藏搜索' : '搜索';
        btn.setAttribute('aria-label', btn.title);
    }
}

function toggleTaskTemplatePickerSearch(force) {
    if (!_tplPickerState) return;
    const next = force === undefined ? !_tplPickerState.searchVisible : !!force;
    _tplPickerState.searchVisible = next;
    // 收起即清词：否则列表还筛着，按钮却显示成未展开，状态自相矛盾
    if (!next) _tplPickerState.query = '';
    _syncTaskTemplatePickerSearchUI();
    _renderTaskTemplatePickerRows();
    if (!next) return;
    // 展开后立刻聚焦并把光标放到末尾（与模板管理页同口径）
    setTimeout(function () {
        const input = document.getElementById('tpl-picker-search');
        if (!input) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }, 30);
}

function onTaskTemplatePickerSearchInput(value) {
    if (!_tplPickerState) return;
    _tplPickerState.query = value || '';
    // 只重渲行区：input 节点保持不变，输入法组合中/光标位置都不受影响
    _renderTaskTemplatePickerRows();
}

function onTaskTemplatePickerSearchKeydown(e) {
    if (e.key === 'Escape') {
        // 三级语义：有词先清词 → 词空则收起搜索框 → 搜索已收起才交给面板级 Esc 关闭
        if (_tplPickerState && _tplPickerState.query) {
            e.preventDefault();
            clearTaskTemplatePickerSearch();
            return;
        }
        if (_tplPickerState && _tplPickerState.searchVisible) {
            e.preventDefault();
            toggleTaskTemplatePickerSearch(false);
        }
        return;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        // 已高亮 → 视为「再次单击」，直接创建；未高亮 → 先高亮第一条（3 秒后自动熄灭）
        if (_tplPickerState && _tplPickerState.selectedId) {
            const id = _tplPickerState.selectedId;
            _clearTaskTemplatePickerSelectTimer();
            pickTaskTemplate(id);
            return;
        }
        const first = document.querySelector('#tpl-picker-rows .tpl-picker-row');
        if (first) first.click();
        return;
    }
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const first = document.querySelector('#tpl-picker-rows .tpl-picker-row');
        if (first) first.focus();
    }
}

// 只清关键词、保留展开态：清完通常还要继续输入，不该顺手把输入框收掉
function clearTaskTemplatePickerSearch() {
    if (!_tplPickerState) return;
    _tplPickerState.query = '';
    if (!_tplPickerState.searchVisible) {
        toggleTaskTemplatePickerSearch(true);
        return;
    }
    _syncTaskTemplatePickerSearchUI();
    _renderTaskTemplatePickerRows();
    const search = document.getElementById('tpl-picker-search');
    if (search) search.focus();
}

function _setupTaskTemplatePickerOutsideClose() {
    if (_tplPickerOutsideBound) return;
    _tplPickerOutsideBound = true;
    document.addEventListener('click', function (e) {
        if (!_tplPickerState) return;
        if (e.target.closest && e.target.closest('#tpl-picker-panel')) return;
        // 打开选择器的那一次点击同样会冒泡到这里：忽略一次，避免刚打开就被关掉
        if (_tplPickerIgnoreOutsideClick) {
            _tplPickerIgnoreOutsideClick = false;
            return;
        }
        // 与任务详情栏同口径（tasks.js#setupDetailPanelCloseHandler）：落在按钮 / 输入控件 /
        // 已打开浮层内部时不算「点击外部」。此前少了这几条豁免，点面板外任意按钮都会收起，
        // 与详情栏行为不一致（点同样的按钮，详情栏会留着）。
        if (e.target.closest('button, input, textarea, select, label, a')) return;
        if (typeof isEventInsideOpenOverlay === 'function' && isEventInsideOpenOverlay(e)) return;
        closeTaskTemplatePicker();
    });
}

function _renderTaskTemplatePickerDateChips() {
    const box = document.getElementById('tpl-picker-date-chips');
    if (!box || !_tplPickerState) return;
    const modes = [
        { key: 'today', label: '今天' },
        { key: 'tomorrow', label: '明天' },
        { key: 'none', label: '不设日期' }
    ];
    box.innerHTML = modes.map(function (m) {
        const active = _tplPickerState.dateMode === m.key;
        return '<button type="button" class="px-2 py-1 rounded-lg border text-xs transition ' +
            (active
                ? 'bg-accent text-white border-transparent'
                : 'border-theme text-theme-secondary hover:bg-theme-secondary') +
            '" onclick="setTaskTemplatePickerDate(\'' + m.key + '\')">' + m.label + '</button>';
    }).join('');
}

function _templateMetaChips(meta, extraNeedsTime, hideTimeWarning, hideSuggestedTime, hideSubCount) {
    const chips = [];
    // 胶囊口径对齐规范 4.9：12px 字、全圆角、padding 2px 10px、1.5px 描边（原 11px 与 6px 内边距均非档位）
    function chip(icon, text, cls, style) {
        return '<span class="inline-flex items-center gap-1 flex-shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ' +
            (cls || 'border-theme text-theme-muted bg-theme-secondary') + '"' + (style ? ' style="' + style + '"' : '') + '>' +
            (icon ? '<i class="' + icon + '"></i>' : '') + escapeHtml(text) + '</span>';
    }
    const timeText = meta.timeLabel || meta.suggestedTime;
    if (timeText && !hideSuggestedTime) {
        chips.push(chip('far fa-clock text-accent', timeText, 'tpl-picker-time-chip border-theme text-theme-muted bg-theme-secondary'));
    }
    if (meta.listName) chips.push(chip('fas fa-inbox', meta.listName));
    meta.tags.slice(0, 2).forEach(function (tag) {
        const color = _safeTemplateColor(tag.color, '#6b7280');
        chips.push('<span class="inline-flex items-center gap-1 flex-shrink-0 whitespace-nowrap rounded-full border border-theme bg-theme-secondary px-2.5 py-0.5 text-xs text-theme-muted">' +
            '<span class="w-1.5 h-1.5 rounded-full" style="background:' + color + '"></span>' +
            escapeHtml(tag.name) + '</span>');
    });
    if (meta.tags.length > 2) chips.push(chip('', '+' + (meta.tags.length - 2) + ' 标签'));
    if (meta.important) chips.push(chip('fas fa-star text-yellow-500', '重要'));
    if (meta.urgent) chips.push(chip('fas fa-fire text-red-500', '紧急'));
    if (meta.reminders.length) chips.push(chip('fas fa-bell', '提前 ' + meta.reminders.join('/') + ' 分钟'));
    if (meta.repeatLabel) chips.push(chip('fas fa-redo', meta.repeatLabel));
    if (meta.subCount && !hideSubCount) chips.push(chip('fas fa-list-check', meta.subCount + ' 个子任务'));
    if ((meta.needsTime || extraNeedsTime) && !hideTimeWarning) {
        // 内联 style 而非 border-amber-500/40 + bg-amber-500/10：离线版 JIT 不生成 /xx 变体
        chips.push(chip('fas fa-triangle-exclamation', '需补时间', '', 'border-color:#f59e0b; color:#f59e0b; background-color:rgba(245, 158, 11, .12);'));
    }
    return chips.join('');
}

// Markdown → 纯文本：仅用于第 2 行预览与悬浮提示，不生成 HTML
function _templatePlainText(src) {
    let text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    text = text.replace(/(?:```|~~~)[^\n]*\n?([\s\S]*?)(?:```|~~~)/g, '$1');
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    return text.split('\n').map(function (line) {
        let out = line
            .replace(/^\s*#{1,6}\s+/, '')
            .replace(/^\s*>\s?/, '')
            .replace(/^\s*(?:[-*+]|\d{1,2}[.)])\s+/, '')
            .replace(/^\[[ xX]\]\s*/, '')
            .replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/, '')
            .replace(/`([^`\n]+)`/g, '$1');
        out = out
            .replace(/\*\*([^\n]+?)\*\*/g, '$1')
            .replace(/__([^\n]+?)__/g, '$1')
            .replace(/~~([^\n]+?)~~/g, '$1')
            .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1$2')
            .replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1$2')
            .replace(/\\([\\`*_{}\[\]()#+\-.!~>])/g, '$1');
        return out.trimEnd();
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 第 2 行悬浮提示：备注全文 + 全部子任务。原生 title 不适合超长文本，截断到 800 字
function _templateDetailHoverText(notesSource, notesIsSubtaskEcho, subtaskTexts) {
    const parts = [];
    const notes = notesIsSubtaskEcho ? '' : _templatePlainText(notesSource);
    if (notes) parts.push(notes);
    if (subtaskTexts.length) {
        parts.push(subtaskTexts.map(function (text) { return '○ ' + text; }).join('\n'));
    }
    let text = parts.join('\n\n');
    if (text.length > 800) text = text.slice(0, 800) + '…';
    return text;
}

function _templateDetailLineHTML(task) {
    const subtaskTexts = ((task && task.subtasks) || []).filter(function (st) {
        return st && (st.text || '').trim();
    }).map(function (st) { return st.text.trim(); });
    // 子任务模式的备注通常由子任务拼成，避免与下方子任务行重复；有描述时优先展示描述
    const notesSource = (task && task.mode === 'subtasks' && task.description)
        ? task.description
        : ((task && task.notes) || '');
    const notesIsSubtaskEcho = subtaskTexts.length > 0
        && String(notesSource).trim() === subtaskTexts.join('\n');
    // 预览取备注首个有效行：预置模板的备注是 Markdown，先转纯文本再去掉标记
    const plainNotes = notesIsSubtaskEcho ? '' : _templatePlainText(notesSource);
    const firstLine = plainNotes.split('\n').map(function (line) { return line.trim(); })
        .find(function (line) { return !!line; }) || '';
    const notesPreview = firstLine.length > 50 ? firstLine.slice(0, 50) + '…' : firstLine;
    // 备注最多占 35% 行宽：50 字硬截断之外再让一次宽度，避免长备注把子任务全挤掉
    const notesPrefixHtml = notesPreview
        ? '<span class="flex-shrink-0 truncate text-theme-secondary" style="max-width:35%;">' + escapeHtml(notesPreview) + '</span>'
        : '';
    // 悬浮提示挂在第 2 行整体上：被 …[ n/total ] 收起的子任务也能从 title 里看全
    const hoverText = _templateDetailHoverText(notesSource, notesIsSubtaskEcho, subtaskTexts);
    const hoverTitleAttr = hoverText
        ? ' title="' + escapeHtml(hoverText).replace(/\n/g, '&#10;') + '"'
        : '';
    if (subtaskTexts.length) {
        const itemsHtml = subtaskTexts.map(function (text, i) {
            return '<span data-tpl-detail-item="' + i + '" class="inline-flex items-center gap-0.5 flex-shrink-0"><span class="text-theme-muted">○</span><span>' + escapeHtml(text) + '</span></span>';
        }).join('');
        return '<span data-tpl-detail-line' + hoverTitleAttr + ' class="flex w-full items-center gap-1 min-w-0 overflow-hidden text-xs text-theme-muted mt-0.5">' +
            notesPrefixHtml +
            '<span data-tpl-detail-names class="flex items-center gap-1 min-w-0 overflow-hidden whitespace-nowrap">' + itemsHtml + '</span>' +
            '<span data-tpl-detail-counter class="flex-shrink-0 hidden"></span>' +
            '</span>';
    }
    if (notesPreview) {
        return '<span data-tpl-detail-line' + hoverTitleAttr + ' class="flex w-full items-center gap-1 min-w-0 overflow-hidden text-xs text-theme-muted mt-0.5">' +
            '<span class="min-w-0 truncate text-theme-secondary">' + escapeHtml(notesPreview) + '</span>' +
            '</span>';
    }
    return '';
}

function _templatePickerRowHTML(tpl, options) {
    options = options || {};
    const meta = getTaskTemplateMeta(tpl);
    const name = tpl.name || '未命名模板';
    const rowClass = options.rowClass || 'tpl-picker-row';
    // 选择器行走二次确认（先高亮、3 秒内再点同一行才创建）；命令面板等外部调用仍可直接传 onclick
    const onclick = options.onclick || ("onTaskTemplatePickerRowClick('" + tpl.id + "')");
    const extraAttr = options.extraAttr ? ' ' + options.extraAttr : '';
    const needsTime = meta.needsTime || ((meta.reminders.length || meta.task.repeat) && _tplPickerState && _tplPickerState.dateMode === 'none');
    // 选择器行式化（去掉卡片边框，与主区任务行同一解剖）；命令面板的 cmd-tpl-row 共用本函数，
    // 保留其既有卡片外观 —— 靠 rowClass 区分，避免这次改动波及命令面板。
    const layout = rowClass === 'tpl-picker-row'
        ? 'py-2.5 px-3 rounded-lg hover:bg-theme-tertiary'
        : 'p-3 rounded-xl border border-theme bg-theme-secondary hover:bg-theme-tertiary';
    if (rowClass !== 'tpl-picker-row') {
        return '<button type="button" data-tpl-id="' + tpl.id + '"' + extraAttr + ' class="' + rowClass + ' w-full text-left flex items-start gap-3 ' + layout + ' transition group" onclick="' + onclick + '">' +
            '<span class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style="background-color: rgba(168, 85, 247, .12); color: #a855f7;"><i class="fas fa-layer-group text-sm"></i></span>' +
            '<span class="flex-1 min-w-0">' +
                '<span class="flex items-center gap-2 min-w-0">' +
                    '<span class="text-sm font-medium text-theme-primary truncate">' + escapeHtml(name) + '</span>' +
                '</span>' +
                '<span data-tpl-picker-meta class="flex items-center gap-1 mt-1.5 overflow-hidden">' + _templateMetaChips(meta, needsTime, false, false, true) + '</span>' +
                _templateDetailLineHTML(meta.task) +
            '</span>' +
            '<span class="tpl-card-add flex-shrink-0 self-center w-10 h-10 rounded-full border-2 border-purple-500 text-purple-500 flex items-center justify-center group-hover:bg-purple-500 group-hover:text-white transition"><i class="fas fa-plus"></i></span>' +
        '</button>';
    }
    // —— 选择器行：信息行与模板管理页 .tpl-manage-row 同构（字号 text-xs、间距 gap-x-1.5、
    //    清单为「圆点 + 名称」、标签走 renderTagCapsules、警告为图标 + 文字），
    //    重要 / 紧急不在信息行里堆图标，改由管理页同款的象限底色表达（见下方 quadBg）。
    const list = meta.task.listId && typeof getList === 'function' ? getList(meta.task.listId) : null;
    const listColor = list ? (list.color || '#8b5cf6') : '#8b5cf6';
    const listLabel = list ? (list.name || '当前清单') : '根据上下文添加';
    const quadColors = (typeof getQuadrantColorClass === 'function')
        ? getQuadrantColorClass({ important: !!meta.important, urgent: !!meta.urgent })
        : { bg: '' };
    const reminderText = meta.reminders.length ? '提前 ' + meta.reminders.join('/') + ' 分钟' : '';
    const tagCapsules = (typeof renderTagCapsules === 'function')
        ? renderTagCapsules(Object.assign({}, meta.task, { id: tpl.id }), 2, 'right')
        : '';
    const timeText = meta.timeLabel || meta.suggestedTime || '';
    return '<button type="button" data-tpl-id="' + tpl.id + '"' + extraAttr +
            ' class="' + rowClass + ' relative w-full text-left flex items-center gap-2 py-2.5 px-3 rounded-r-lg ' + (quadColors.bg || '') + ' hover:opacity-80 transition" onclick="' + onclick + '">' +
            '<span class="tpl-picker-color-bar" style="background-color:' + listColor + ';"></span>' +
            '<span class="tpl-picker-lead w-5 h-5 flex-shrink-0">' +
                '<i class="fas fa-layer-group text-sm text-purple-500 tpl-picker-lead-default"></i>' +
                '<span class="tpl-picker-add-icon" title="再次单击创建任务" aria-hidden="true">' +
                    '<svg class="tpl-picker-add-ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5"></circle></svg>' +
                    '<i class="fas fa-plus"></i>' +
                '</span>' +
            '</span>' +
            '<span class="flex-1 min-w-0">' +
                '<span class="block text-base font-medium text-theme-primary truncate">' + escapeHtml(name) + '</span>' +
                _templateDetailLineHTML(meta.task) +
                '<span data-tpl-info-line class="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0 text-xs text-theme-secondary mt-0.5">' +
                    (timeText ? '<span class="inline-flex items-center gap-1 flex-shrink-0 text-theme-secondary"><i class="far fa-clock"></i>' + escapeHtml(timeText) + '</span>' : '') +
                    // 清单名允许收缩换行（overflow-wrap:anywhere 兜住超长英文名），不再截断到 110px
                    '<span class="inline-flex items-center gap-1 min-w-0">' +
                        '<span class="w-2 h-2 rounded-full flex-shrink-0" style="background:' + listColor + ';"></span>' +
                        '<span class="min-w-0" style="overflow-wrap:anywhere;">' + escapeHtml(listLabel) + '</span>' +
                    '</span>' +
                    (reminderText ? '<span class="inline-flex items-center gap-1 flex-shrink-0"><i class="fas fa-bell"></i>' + escapeHtml(reminderText) + '</span>' : '') +
                    (meta.repeatLabel ? '<span class="inline-flex items-center gap-1 flex-shrink-0"><i class="fas fa-redo"></i>' + escapeHtml(meta.repeatLabel) + '</span>' : '') +
                    tagCapsules +
                    ((meta.needsTime || needsTime) ? '<span class="inline-flex items-center gap-1 flex-shrink-0 text-amber-500"><i class="fas fa-triangle-exclamation"></i>需补时间</span>' : '') +
                '</span>' +
            '</span>' +
        '</button>';
}

function _renderTaskTemplatePickerRows() {
    // 只重渲行区，搜索框是常驻节点（见 _tplPickerPanelHtml）——
    // 把 input 一起重建会打断中文输入法的组合串
    const box = document.getElementById('tpl-picker-rows');
    if (!box || !_tplPickerState) return;
    const all = getTaskTemplates();
    const q = _tplPickerState.query.trim().toLowerCase();
    const filtered = q ? all.filter(function (t) {
        const name = (t.name || '').toLowerCase();
        const title = (t.task && t.task.title ? t.task.title : '').toLowerCase();
        return name.indexOf(q) !== -1 || title.indexOf(q) !== -1;
    }) : all;

    // 选中项被搜索筛掉 / 被删掉时同步失效：否则高亮还亮着，点的却是一个看不见的模板
    if (_tplPickerState.selectedId
        && !filtered.some(function (t) { return t.id === _tplPickerState.selectedId; })) {
        _tplPickerState.selectedId = null;
        _tplPickerState.selectedAt = null;
        _clearTaskTemplatePickerSelectTimer();
    }

    if (all.length === 0) {
        box.innerHTML = '<div class="text-center py-10 text-theme-muted">' +
            '<i class="fas fa-layer-group text-4xl mb-3 opacity-30"></i>' +
            '<p class="text-sm text-theme-primary">还没有模板</p>' +
            '<p class="text-xs mt-1">在任务标题右侧点模板图标，或新建一个。</p>' +
            '<button type="button" class="mt-4 px-4 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent-hover transition" onclick="openTaskTemplatesPageFromPicker(true)"><i class="fas fa-plus mr-1"></i>新建模板</button>' +
        '</div>';
        _syncTaskTemplatePickerSelection();
        _setupTaskTemplateDetailFit();
        return;
    }
    if (filtered.length === 0) {
        box.innerHTML = '<div class="text-center py-10 text-theme-muted">' +
            '<i class="fas fa-magnifying-glass text-3xl mb-3 opacity-30"></i>' +
            '<p class="text-sm text-theme-primary">没有匹配「' + escapeHtml(_tplPickerState.query.trim()) + '」的模板</p>' +
            '<button type="button" class="mt-3 text-xs text-accent hover:underline" onclick="clearTaskTemplatePickerSearch()">清除搜索</button>' +
        '</div>';
        _syncTaskTemplatePickerSelection();
        _setupTaskTemplateDetailFit();
        return;
    }

    let html = '';
    if (!q) {
        const recent = getRecentTaskTemplates(4);
        const recentIds = recent.map(function (t) { return t.id; });
        if (recent.length) {
            html += '<div class="px-1 pt-1 pb-1 text-xs font-semibold text-theme-muted">最近使用</div>';
            html += recent.map(_templatePickerRowHTML).join('');
            const rest = filtered.filter(function (t) { return recentIds.indexOf(t.id) === -1; });
            if (rest.length) {
                html += '<div class="px-1 pt-3 pb-1 text-xs font-semibold text-theme-muted">其他模板</div>';
                html += rest.map(_templatePickerRowHTML).join('');
            }
        } else {
            html += '<div class="px-1 pt-1 pb-1 text-xs font-semibold text-theme-muted">全部模板</div>';
            html += filtered.map(_templatePickerRowHTML).join('');
        }
    } else {
        html += '<div class="px-1 pt-1 pb-1 text-xs font-semibold text-theme-muted">搜索结果</div>';
        html += filtered.map(_templatePickerRowHTML).join('');
    }
    box.innerHTML = html;
    _syncTaskTemplatePickerSelection();
    _setupTaskTemplateDetailFit();
}

// ==================== 行选中（单击高亮，3 秒内再次单击创建） ====================
// 高亮是瞬时的：3 秒内没有再次单击同一行就自动熄灭（定时器见下）。
// 不在行尾放确认按钮：行本身是 <button>，HTML 不允许再嵌套 <button>。
function _clearTaskTemplatePickerSelectTimer() {
    if (_tplPickerSelectTimer) {
        clearTimeout(_tplPickerSelectTimer);
        _tplPickerSelectTimer = null;
    }
}

function _armTaskTemplatePickerSelectTimer() {
    _clearTaskTemplatePickerSelectTimer();
    _tplPickerSelectTimer = setTimeout(function () {
        _tplPickerSelectTimer = null;
        if (!_tplPickerState || !_tplPickerState.selectedId) return;
        _tplPickerState.selectedId = null;
        _tplPickerState.selectedAt = null;
        _syncTaskTemplatePickerSelection();
    }, TPL_PICKER_SELECT_RESET_MS);
}

function _tplPickerRingDelay() {
    const state = _tplPickerState;
    if (!state || !state.selectedAt) return '1.5s';
    const elapsed = Math.max(0, Date.now() - state.selectedAt);
    if (elapsed < 1500) return (1500 - elapsed) + 'ms';
    return '-' + Math.min(elapsed - 1500, 1500) + 'ms';
}

function _syncTaskTemplatePickerSelection() {
    const state = _tplPickerState;
    const box = document.getElementById('tpl-picker-rows');
    const selectedId = state ? state.selectedId : null;
    if (box) {
        box.querySelectorAll('.tpl-picker-row').forEach(function (row) {
            const on = !!selectedId && row.dataset.tplId === selectedId;
            if (on) {
                const icon = row.querySelector('.tpl-picker-add-icon');
                if (icon) icon.style.setProperty('--tpl-ring-delay', _tplPickerRingDelay());
            }
            row.classList.toggle('is-selected', on);
        });
    }
}

// 返回是否真的清掉了一个选中项 —— Esc 用它区分「撤销选中」与「关闭面板」
function clearTaskTemplatePickerSelection() {
    if (!_tplPickerState || !_tplPickerState.selectedId) return false;
    _tplPickerState.selectedId = null;
    _tplPickerState.selectedAt = null;
    _clearTaskTemplatePickerSelectTimer();
    _syncTaskTemplatePickerSelection();
    return true;
}

// 行点击入口：第一次 = 选中高亮（3 秒后自动熄灭），第二次（同一行）= 确认创建
function onTaskTemplatePickerRowClick(tplId) {
    if (!_tplPickerState) return;
    if (_tplPickerState.selectedId === tplId) {
        _clearTaskTemplatePickerSelectTimer();
        pickTaskTemplate(tplId);
        return;
    }
    _tplPickerState.selectedId = tplId;
    _tplPickerState.selectedAt = Date.now();
    _syncTaskTemplatePickerSelection();
    _armTaskTemplatePickerSelectTimer();
}

function openTaskTemplatePicker(options) {
    options = options || {};
    const existingPanel = document.getElementById('tpl-picker-panel');
    // 同一入口再次触发（Header 悬浮组 / 空态按钮 / 命令面板）→ 收起
    if (_tplPickerState && existingPanel && !existingPanel.classList.contains('hidden')) {
        closeTaskTemplatePicker();
        return;
    }
    closeTaskTemplatePicker(true);

    // 右栏互斥：详情面板 / 计划面板先按各自关闭口径收起（落盘草稿）
    const detailPanel = document.getElementById('task-detail-panel');
    if (detailPanel && !detailPanel.classList.contains('hidden')
        && typeof closeTaskDetailPanel === 'function') {
        closeTaskDetailPanel();
    }
    if (typeof planPanelOpen !== 'undefined' && planPanelOpen
        && typeof closePlanPanel === 'function') {
        closePlanPanel();
    }
    // 模板编辑面板同样占用右栏：先落盘草稿；保存失败（如重名）则保留编辑态，不打开选择器
    if (_tplPanelState && !closeTaskTemplatePanel()) return;
    // 触发按钮保留焦点会让 Header 悬浮组一直展开，点击后主动让出焦点
    const active = document.activeElement;
    if (active && active.closest && active.closest('#add-task-group')) active.blur();

    const ctx = (typeof getSidebarNewTaskDefaults === 'function') ? getSidebarNewTaskDefaults() : null;
    _tplPickerState = {
        query: '',
        // 搜索默认收起：停靠区的圆形搜索钮点击后，输入框在**同一行左侧**展开
        searchVisible: false,
        // 二次确认的选中项：null = 未选；单击只高亮，3 秒内再次单击同一行才创建
        selectedId: null,
        // 选中时刻：搜索/日期重渲染后据此恢复圆环动画的相位
        selectedAt: null,
        dateMode: options.dateMode || (settings.defaultTaskDate === 'none' ? 'none' : 'today'),
        // 面板内不再提供清单选择：保留字段仅为「从任务行打开时落到该行清单」这一入口，
        // 默认 __template__ = 跟随模板自带清单（不指定清单即常态）
        listId: options.listId || (ctx && ctx.listId) || '__template__'
    };
    _ensureTaskTemplatePickerCss();
    const panel = _ensureTaskTemplatePickerPanel();
    // 每次打开重建内容：日期胶囊与搜索框 value 都需要按当前状态复位
    panel.innerHTML = _tplPickerPanelHtml();
    panel.classList.remove('hidden');
    document.body.classList.add('tpl-picker-open');
    if (settings.smoothAnimations === true) {
        panel.classList.remove('panel-fade-out');
        panel.classList.remove('panel-fade-in');
        void panel.offsetWidth;
        panel.classList.add('panel-fade-in');
    } else {
        panel.classList.remove('panel-fade-in', 'panel-fade-out');
    }
    // 面板挤压主区：Header 动作按钮需要重新收纳（与详情面板同口径）
    if (typeof scheduleHeaderActionOverflow === 'function') {
        scheduleHeaderActionOverflow(380);
        scheduleHeaderActionOverflow(0);
    }

    _renderTaskTemplatePickerDateChips();
    _syncTaskTemplatePickerSearchUI();
    _renderTaskTemplatePickerRows();
    // 面板内字体/滚动条落定后再量一次，避免首次测量偏宽导致子任务多留一个
    _scheduleTaskTemplateDetailFit(400);

    _tplPickerEscHandler = function (e) {
        if (e.key !== 'Escape') return;
        if (e.defaultPrevented) return;
        if (document.getElementById('tpl-save-overlay')) return;
        // 二次确认的第二层：先撤销选中，再按一次才关面板（与详情栏「先收浮层再关」同序）
        if (clearTaskTemplatePickerSelection()) {
            e.preventDefault();
            return;
        }
        e.preventDefault();
        closeTaskTemplatePicker();
    };
    document.addEventListener('keydown', _tplPickerEscHandler);

    _setupTaskTemplatePickerOutsideClose();
    _tplPickerIgnoreOutsideClick = true;
    setTimeout(function () { _tplPickerIgnoreOutsideClick = false; }, 0);
}

function setTaskTemplatePickerDate(mode) {
    if (!_tplPickerState) return;
    if (mode !== 'today' && mode !== 'tomorrow' && mode !== 'none') return;
    _tplPickerState.dateMode = mode;
    _renderTaskTemplatePickerDateChips();
    _renderTaskTemplatePickerRows();
}

function refreshTaskTemplatePicker() {
    const panel = document.getElementById('tpl-picker-panel');
    if (_tplPickerState && panel && !panel.classList.contains('hidden')) {
        _renderTaskTemplatePickerRows();
    }
}

function pickTaskTemplate(tplId) {
    const state = _tplPickerState;
    if (!state) return;
    const tpl = getTaskTemplateById(tplId);
    if (!tpl) {
        if (typeof showToast === 'function') showToast('模板不存在或已被删除', 'warning');
        refreshTaskTemplatePicker();
        return;
    }
    // 撤销要回到同一上下文：日期模式 / 清单目标在面板收起（state 被清空）前快照
    const pickerOptions = { dateMode: state.dateMode, listId: state.listId };
    const usageBefore = { lastUsedAt: tpl.lastUsedAt, useCount: tpl.useCount };
    // 立即隐藏选择器但保留主区宽度类：紧接着由任务详情面板接管右栏，主区不会先回弹再收缩
    _finishTaskTemplatePickerHide(true);
    // 通知交由下方的撤销条统一发出，避免成功提示叠两条
    const task = createTaskFromTemplate(tpl, { dateMode: state.dateMode, listId: state.listId, skipToast: true });
    if (task && typeof openTaskDetailPanel === 'function') {
        openTaskDetailPanel(task.id);
    }
    // 详情面板已加上自己的宽度类；此时移除选择器类不会改变 margin-right
    requestAnimationFrame(function () {
        document.body.classList.remove('tpl-picker-open');
        if (typeof scheduleHeaderActionOverflow === 'function') scheduleHeaderActionOverflow(0);
    });
    if (task) _showTaskTemplateCreatedUndo(tpl, task, usageBefore, pickerOptions);
}

// 创建成功的通知改走撤销条：UNDO / Ctrl+Z 删除刚创建的任务，并回到模板选择面板。
// 时间敏感型模板（含提醒/重复但没有具体时间）保留原警示文案，同样允许撤销。
function _showTaskTemplateCreatedUndo(tpl, task, usageBefore, pickerOptions) {
    if (typeof showUndoToast !== 'function') return;
    const usageAfter = { lastUsedAt: tpl.lastUsedAt, useCount: tpl.useCount };
    let entry = null;
    if (typeof pushUndoEntry === 'function') {
        entry = pushUndoEntry({
            label: '从模板创建任务',
            kind: 'create',
            undo: function () {
                const wasShowing = typeof currentDetailTaskId !== 'undefined' && currentDetailTaskId === task.id;
                // 先按正常口径收起详情栏（退出书写态 + 落盘），再做删除
                if (wasShowing && typeof closeTaskDetailPanel === 'function') closeTaskDetailPanel();
                tasks = tasks.filter(function (t) { return t.id !== task.id; });
                // 兜底：saveTaskDetail 校验失败时 close 会提前返回；任务已删除，直接强制收起
                if (wasShowing && typeof currentDetailTaskId !== 'undefined' && currentDetailTaskId === task.id) {
                    if (typeof hideDetailPanel === 'function') hideDetailPanel();
                    currentDetailTaskId = null;
                }
                // 撤销「最近使用」排序影响；若模板期间又被使用过，不覆盖较新的记录
                if (tpl.lastUsedAt === usageAfter.lastUsedAt && tpl.useCount === usageAfter.useCount) {
                    if (usageBefore.lastUsedAt === undefined) delete tpl.lastUsedAt;
                    else tpl.lastUsedAt = usageBefore.lastUsedAt;
                    if (usageBefore.useCount === undefined) delete tpl.useCount;
                    else tpl.useCount = usageBefore.useCount;
                }
                // 面板已开着（用户操作中途按了 Ctrl+Z）就保持现状，避免 openTaskTemplatePicker 的再次触发把它收起
                const pickerPanel = document.getElementById('tpl-picker-panel');
                if (pickerPanel && !pickerPanel.classList.contains('hidden')) {
                    if (typeof refreshTaskTemplatePicker === 'function') refreshTaskTemplatePicker();
                } else if (typeof openTaskTemplatePicker === 'function') {
                    openTaskTemplatePicker(pickerOptions);
                }
            }
        });
    }
    const timeSensitive = !!task.repeat || (Array.isArray(task.reminders) && task.reminders.length > 0);
    const hasClock = !!(task.startTime && !task.isAllDay);
    const warn = timeSensitive && !hasClock;
    showUndoToast(
        warn
            ? '已从模板创建「' + task.title + '」；模板含提醒/重复，设置具体时间后生效'
            : '已从模板创建「' + task.title + '」',
        function () {
            if (typeof _executeUndoEntry !== 'function' || !entry) return { ok: false, reason: 'invalid' };
            return _executeUndoEntry(entry);
        },
        warn ? { type: 'warning' } : {}
    );
}

// 详情面板接管右栏前调用：只收起选择器面板，主区宽度类留给详情面板无缝接替
function dismissTaskTemplatePickerForDetail() {
    if (!_tplPickerState) return false;
    _finishTaskTemplatePickerHide(true);
    return true;
}

function _finishTaskTemplatePickerHide(instant) {
    _clearTaskTemplatePickerSelectTimer();
    if (_tplPickerEscHandler) {
        document.removeEventListener('keydown', _tplPickerEscHandler);
        _tplPickerEscHandler = null;
    }
    _tplPickerState = null;
    _setupTaskTemplateDetailFit();
    if (_tplPickerHideTimer) {
        clearTimeout(_tplPickerHideTimer);
        _tplPickerHideTimer = null;
    }
    const panel = document.getElementById('tpl-picker-panel');
    if (!panel) return;
    const smooth = typeof settings !== 'undefined' && settings.smoothAnimations === true;
    if (instant === true || !smooth || panel.classList.contains('hidden')) {
        panel.classList.remove('panel-fade-in', 'panel-fade-out');
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('panel-fade-in');
    panel.classList.add('panel-fade-out');
    _tplPickerHideTimer = setTimeout(function () {
        _tplPickerHideTimer = null;
        panel.classList.remove('panel-fade-out');
        panel.classList.add('hidden');
        if (typeof scheduleHeaderActionOverflow === 'function') scheduleHeaderActionOverflow(0);
    }, 200);
}

function closeTaskTemplatePicker(instant) {
    _finishTaskTemplatePickerHide(instant);
    document.body.classList.remove('tpl-picker-open');
    if (typeof scheduleHeaderActionOverflow === 'function') {
        scheduleHeaderActionOverflow(instant === true ? 0 : 380);
    }
}

// ==================== 设置入口 / 模板管理页 ====================

function openSettingsToTaskTemplates() {
    if (typeof openSettingsModal === 'function') openSettingsModal();
    setTimeout(function () {
        const target = document.getElementById('settings-section-templates');
        const scrollEl = document.getElementById('settings-content-scroll');
        if (target && scrollEl) {
            const top = target.getBoundingClientRect().top
                - scrollEl.getBoundingClientRect().top
                + scrollEl.scrollTop;
            scrollEl.scrollTop = Math.max(0, top - 8);
        }
        const nav = document.getElementById('settings-nav');
        if (nav) {
            nav.querySelectorAll('.settings-nav-item').forEach(function (n) {
                n.classList.remove('settings-nav-active');
            });
            const item = nav.querySelector('[data-target="settings-section-templates"]');
            if (item) item.classList.add('settings-nav-active');
        }
        renderTaskTemplatesSettingsEntry();
    }, 320);
}

function renderTaskTemplatesSettingsEntry() {
    const el = document.getElementById('tpl-settings-summary');
    if (!el) return;
    const list = getTaskTemplates();
    el.textContent = list.length === 0 ? '还没有模板' : '共 ' + list.length + ' 个模板';
}

function refreshTaskTemplatesUi() {
    renderTaskTemplatesSettingsEntry();
    if (typeof currentView !== 'undefined' && currentView === 'templates') {
        _renderTaskTemplatesList();
        _updateTaskTemplatesPageCount();
    }
    if (typeof refreshTaskTemplatePicker === 'function') refreshTaskTemplatePicker();
    if (typeof currentDetailTaskId !== 'undefined' && currentDetailTaskId
        && typeof updateDetailTemplateEntry === 'function') {
        const current = tasks.find(function (t) { return t.id === currentDetailTaskId; });
        if (current) updateDetailTemplateEntry(current);
    }
}

// ==================== 管理页：状态与样式 ====================

let _tplPageSearchVisible = false;
let _tplPageSearchQuery = '';
let _tplPageReturnSource = 'settings';
let _tplPagePrevView = 'task';
let _tplPageFlashId = null;
let _tplPageResetScroll = false;

function _ensureTaskTemplatesCss() {
    if (document.getElementById('tpl-manage-css')) return;
    const style = document.createElement('style');
    style.id = 'tpl-manage-css';
    style.textContent = `
        .tpl-manage-row { margin-bottom: 2px; }
        .tpl-manage-row.tpl-row-dragging { opacity: .45; }
        .tpl-manage-row.tpl-row-drag-over { box-shadow: inset 0 2px 0 var(--accent-color); }
        .tpl-subtask-row.tpl-subtask-dragging { opacity: .45; }
        .tpl-subtask-row.tpl-subtask-drag-over { box-shadow: inset 0 2px 0 var(--accent-color); }
        .tpl-row-flash { animation: tplRowFlash .8s ease; }
        @keyframes tplRowFlash {
            0% { background-color: var(--accent-bg-strong); }
            100% { background-color: transparent; }
        }
        @media (min-width: 769px) {
            body.fx-smooth #template-detail-panel.panel-fade-in { animation: fxPanelIn .25s ease both; }
            body.fx-smooth #template-detail-panel.panel-fade-out { animation: fxPanelOut .2s ease forwards; }
            body.fx-smooth #template-detail-panel:not(.hidden) { position: fixed; top: 0; right: 0; bottom: 0; }
            body.fx-smooth.tpl-panel-open #main-content { margin-right: 24rem; }
        }
        @media (max-width: 768px) {
            #template-detail-panel {
                position: fixed !important;
                top: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100dvh !important;
                z-index: 52 !important;
                border: none !important;
            }
            #template-detail-panel:not(.hidden) { animation: mobilePanelIn .28s ease; }
            #template-detail-panel > div:last-child {
                padding-bottom: calc(1rem + env(safe-area-inset-bottom)) !important;
            }
        }
        .tpl-subtask-input { min-height: 1.5rem; line-height: 1.5rem; }
        .tpl-subtask-row .tpl-subtask-delete {
            opacity: 0;
            pointer-events: none;
            width: 1.25rem;
            height: 1.25rem;
            padding: 0;
            flex-shrink: 0;
            color: var(--text-muted, #9ca3af);
            transition: opacity .15s, color .15s;
        }
        .tpl-subtask-row:hover .tpl-subtask-delete {
            opacity: 1;
            pointer-events: auto;
        }
        .tpl-subtask-row:focus-within .tpl-subtask-delete {
            opacity: 0;
            pointer-events: none;
        }
        .tpl-subtask-row .tpl-subtask-delete:hover { color: #ef4444; }
        @media (hover: none) {
            .tpl-subtask-row .tpl-subtask-delete { opacity: 1 !important; pointer-events: auto !important; }
        }
        /* 标签 / 清单候选面板：锚在按钮簇正上方的气泡（与任务详情栏同口径）。
           必须悬浮于文档流之外：面板内联展开会挤压正文高度，悬浮进出时整块布局跳动。 */
        .tpl-panel-hover-picker {
            position: absolute;
            bottom: calc(100% + 8px);
            left: 0;
            right: 0;
            max-height: 50vh;
            z-index: 40;
        }
        #tpl-panel-important { border-color: #eab308 !important; color: #eab308 !important; }
        #tpl-panel-urgent { border-color: #f97316 !important; color: #f97316 !important; }
        #tpl-panel-important:hover { background: rgba(234, 179, 8, 0.15) !important; border-color: #eab308 !important; color: #eab308 !important; }
        #tpl-panel-urgent:hover { background: rgba(249, 115, 22, 0.15) !important; border-color: #f97316 !important; color: #f97316 !important; }
        #tpl-panel-important.is-on { background: #eab308 !important; border-color: #eab308 !important; color: #fff !important; box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.20); }
        #tpl-panel-important.is-on:hover { background: #ca9a06 !important; border-color: #ca9a06 !important; color: #fff !important; }
        #tpl-panel-urgent.is-on { background: #ef4444 !important; border-color: #ef4444 !important; color: #fff !important; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.20); }
        #tpl-panel-urgent.is-on:hover { background: #dc2626 !important; border-color: #dc2626 !important; color: #fff !important; }
        #tpl-panel-tag-btn { border-color: #14b8a6 !important; color: #14b8a6 !important; }
        #tpl-panel-tag-btn:hover { background: #14b8a6 !important; border-color: #14b8a6 !important; color: #fff !important; }
        #tpl-panel-list-btn { border-color: var(--accent-color, #3b82f6) !important; color: var(--accent-color, #3b82f6) !important; }
        #tpl-panel-list-btn:hover { background: var(--accent-color, #3b82f6) !important; border-color: var(--accent-color, #3b82f6) !important; color: #fff !important; }
        #tpl-panel-delete-btn { border-color: #ef4444 !important; color: #ef4444 !important; }
        #tpl-panel-delete-btn:hover { background: #ef4444 !important; border-color: #ef4444 !important; color: #fff !important; }

        /* ---- 建议时间菜单：与任务详情栏 #detail-time-menu 同口径 ----
           · 浅底圆角卡片替代分割线（底色 + 1px 描边 + 10px 圆角 / 2 16 6 外边距 / 10 14 内边距）；
           · 时间段输入框改为「透明底 + 1px 描边 + 次级文字色」，与下方提醒 / 重复按钮一致。
           壁纸模式与 blur-off 的取值直接对齐 #detail-time-menu 的既有规则。 */
        #template-detail-panel #tpl-panel-time-menu:not(.hidden) {
            background-color: var(--bg-tertiary, #f3f4f6);
            border: 1px solid var(--border-color, #e5e7eb);
            border-radius: 10px;
            margin: 2px 16px 6px;
            padding: 10px 14px;
        }
        body.has-bg-image #template-detail-panel #tpl-panel-time-menu:not(.hidden) {
            background-color: rgba(var(--bg-tertiary-rgb, 243,244,246), 0.5) !important;
            backdrop-filter: blur(var(--bg-blur, 12px));
            -webkit-backdrop-filter: blur(var(--bg-blur, 12px));
        }
        html[data-blur="off"] body.has-bg-image #template-detail-panel #tpl-panel-time-menu:not(.hidden) {
            background-color: rgba(var(--bg-tertiary-rgb, 243,244,246), 0.92) !important;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
        /* 原生 time 输入框的 UA 底色是 field（主题下呈白色），必须显式透明；
           outline:none 与详情栏同因（原生 date/time 恒匹配 :focus-visible，单击也会画白环） */
        #template-detail-panel #tpl-panel-time-menu input[type="time"] {
            background-color: transparent;
            outline: none;
        }
        body.has-bg-image #template-detail-panel {
            background-color: rgba(var(--bg-secondary-rgb, 255,255,255), 0.55) !important;
            backdrop-filter: blur(var(--bg-blur, 12px)) !important;
            -webkit-backdrop-filter: blur(var(--bg-blur, 12px)) !important;
        }
        body.has-bg-image #template-detail-panel .bg-theme-secondary,
        body.has-bg-image #template-detail-panel.bg-theme-secondary {
            background-color: transparent !important;
            backdrop-filter: blur(var(--bg-blur, 12px)) !important;
            -webkit-backdrop-filter: blur(var(--bg-blur, 12px)) !important;
        }
        body.has-bg-image #template-detail-panel #tpl-panel-time-picker,
        body.has-bg-image #template-detail-panel #tpl-panel-reminder-picker,
        body.has-bg-image #template-detail-panel #tpl-panel-repeat-picker,
        body.has-bg-image #template-detail-panel .tpl-panel-hover-picker {
            background-color: rgba(var(--bg-tertiary-rgb, 243,244,246), 0.85) !important;
            backdrop-filter: blur(var(--bg-blur, 12px)) !important;
            -webkit-backdrop-filter: blur(var(--bg-blur, 12px)) !important;
        }
        html[data-blur="off"] body.has-bg-image #template-detail-panel {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            background-color: rgba(var(--bg-secondary-rgb, 255,255,255), 0.92) !important;
        }
        html[data-blur="off"] body.has-bg-image #template-detail-panel .bg-theme-secondary,
        html[data-blur="off"] body.has-bg-image #template-detail-panel.bg-theme-secondary {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            background-color: rgba(var(--bg-secondary-rgb, 255,255,255), 0.92) !important;
        }
        html[data-blur="off"] body.has-bg-image #template-detail-panel #tpl-panel-time-picker,
        html[data-blur="off"] body.has-bg-image #template-detail-panel #tpl-panel-reminder-picker,
        html[data-blur="off"] body.has-bg-image #template-detail-panel #tpl-panel-repeat-picker,
        html[data-blur="off"] body.has-bg-image #template-detail-panel .tpl-panel-hover-picker {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            background-color: rgba(var(--bg-tertiary-rgb, 243,244,246), 0.95) !important;
        }
    `;
    document.head.appendChild(style);
}


// ==================== 管理页：进入 / 返回 / 渲染 ====================

function switchToTaskTemplatesPage(source) {
    if (typeof currentView !== 'undefined' && currentView === 'templates') {
        if (source === 'settings' && typeof closeSettingsModal === 'function') closeSettingsModal();
        renderView();
        return;
    }
    _tplPageReturnSource = source || 'settings';
    _tplPagePrevView = (typeof currentView !== 'undefined') ? currentView : 'task';
    _tplPageSearchVisible = false;
    _tplPageSearchQuery = '';
    _tplPageResetScroll = true;
    closeTaskTemplatePicker();
    closeTaskTemplateUsePopover();
    closeTaskTemplatePanel(true);
    if (source === 'settings' && typeof closeSettingsModal === 'function') closeSettingsModal();
    if (typeof currentView !== 'undefined' && currentView === 'templates') {
        renderView();
        return;
    }
    switchView('templates');
}

function openTaskTemplatesPageFromPicker(create) {
    closeTaskTemplatePicker();
    switchToTaskTemplatesPage('picker');
    if (create) startNewTaskTemplate();
}

function closeTaskTemplatesView() {
    if (!closeTaskTemplatePanel()) return;
    closeTaskTemplateUsePopover();
    const back = (_tplPagePrevView && _tplPagePrevView !== 'templates')
        ? _tplPagePrevView
        : ((typeof settings !== 'undefined' && settings.defaultView) || 'task');
    const fromSettings = _tplPageReturnSource === 'settings';
    if (fromSettings) openSettingsToTaskTemplates();
    switchView(back);
}


function renderTaskTemplatesView(container) {
    _ensureTaskTemplatesCss();
    const prevScrollEl = document.getElementById('tpl-page-scroll');
    const prevScrollTop = (_tplPageResetScroll || !prevScrollEl) ? 0 : prevScrollEl.scrollTop;
    _tplPageResetScroll = false;
    const total = getTaskTemplates().length;
    const isMobile = typeof isMobileView === 'function' && isMobileView();
    const searchVisible = _tplPageSearchVisible;
    const searchBtnClass = searchVisible
        ? 'bg-cyan-500 text-white'
        : 'border-2 border-cyan-500 text-cyan-500 hover:bg-cyan-500 hover:text-white';
    const header = isMobile
        ? '<div class="flex items-center justify-between px-4 py-3 border-b border-theme/30 flex-shrink-0 gap-3">' +
              '<div class="flex items-center gap-2 min-w-0">' +
                  '<h1 class="text-lg font-bold text-theme-primary whitespace-nowrap">任务模板</h1>' +
                  '<span id="tpl-page-count" class="text-xs font-normal text-theme-muted whitespace-nowrap self-end mb-1 leading-none ' + (total ? '' : 'hidden') + '">' + total + '</span>' +
              '</div>' +
              _tplPageHeaderButtons(searchBtnClass) +
          '</div>'
        : '<div class="flex items-center justify-between p-4 pb-2 flex-shrink-0 gap-3">' +
              '<div class="flex items-center gap-2 min-w-0">' +
                  '<h1 class="text-2xl font-bold text-theme-primary whitespace-nowrap">任务模板</h1>' +
                  '<span id="tpl-page-count" class="text-xs font-normal text-theme-muted whitespace-nowrap self-end mb-1 leading-none ' + (total ? '' : 'hidden') + '">' + total + '</span>' +
              '</div>' +
              _tplPageHeaderButtons(searchBtnClass) +
          '</div>';

    container.innerHTML =
        '<div class="h-full flex flex-col">' +
            header +
            '<div id="tpl-page-scroll" class="flex-1 overflow-y-auto min-h-0 px-4 pb-6">' +
                (searchVisible
                    ? '<div class="my-3">' +
                          '<input id="tpl-page-search" type="text" value="' + escapeHtml(_tplPageSearchQuery) + '" ' +
                              'placeholder="搜索模板名称或任务标题…" autocomplete="off" spellcheck="false" ' +
                              'oninput="onTaskTemplatesSearchInput(this.value)" ' +
                              'class="w-full px-3 py-2 border-2 border-theme rounded-lg bg-theme-secondary text-theme-primary text-sm focus:outline-none focus:border-accent">' +
                      '</div>'
                    : '') +
                '<div id="tpl-page-list"></div>' +
            '</div>' +
        '</div>';

    _renderTaskTemplatesList();
    const scrollEl = document.getElementById('tpl-page-scroll');
    if (scrollEl && prevScrollTop > 0) scrollEl.scrollTop = prevScrollTop;
    if (searchVisible) {
        setTimeout(function () {
            const input = document.getElementById('tpl-page-search');
            if (input) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        }, 30);
    }
}

function _tplPageHeaderButtons(searchBtnClass) {
    return '<div class="flex items-center gap-3 flex-shrink-0">' +
        '<button type="button" onclick="toggleTaskTemplatesSearch()" class="w-10 h-10 rounded-full flex items-center justify-center transition ' + searchBtnClass + '" title="' + (_tplPageSearchVisible ? '隐藏搜索' : '搜索') + '">' +
            '<i class="fas fa-search"></i>' +
        '</button>' +
        '<button type="button" onclick="startNewTaskTemplate()" class="w-10 h-10 rounded-full border-2 border-purple-500 text-purple-500 flex items-center justify-center hover:bg-purple-500 hover:text-white transition" title="新建模板">' +
            '<i class="fas fa-plus"></i>' +
        '</button>' +
        '<button type="button" onclick="closeTaskTemplatesView()" class="w-10 h-10 rounded-full border-2 border-slate-400 text-slate-500 flex items-center justify-center hover:bg-slate-400 hover:text-white active:bg-slate-500 active:scale-95 transition" title="返回">' +
            '<i class="fas fa-arrow-left"></i>' +
        '</button>' +
    '</div>';
}

function toggleTaskTemplatesSearch() {
    _tplPageSearchVisible = !_tplPageSearchVisible;
    if (!_tplPageSearchVisible) _tplPageSearchQuery = '';
    _tplPageResetScroll = true;
    renderView();
}

function onTaskTemplatesSearchInput(value) {
    _tplPageSearchQuery = value || '';
    _renderTaskTemplatesList();
}

function clearTaskTemplatesSearch() {
    _tplPageSearchQuery = '';
    const input = document.getElementById('tpl-page-search');
    if (input) {
        input.value = '';
        input.focus();
    }
    _renderTaskTemplatesList();
}

function _updateTaskTemplatesPageCount() {
    const el = document.getElementById('tpl-page-count');
    if (!el) return;
    const total = getTaskTemplates().length;
    el.textContent = total;
    el.classList.toggle('hidden', total === 0);
}

function _renderTaskTemplatesList() {
    const box = document.getElementById('tpl-page-list');
    if (!box) return;
    const all = getTaskTemplates();
    const q = _tplPageSearchQuery.trim().toLowerCase();
    const filtered = q ? all.filter(function (tpl) {
        const name = (tpl.name || '').toLowerCase();
        const title = (tpl.task && tpl.task.title ? tpl.task.title : '').toLowerCase();
        return name.indexOf(q) !== -1 || title.indexOf(q) !== -1;
    }) : all;

    if (all.length === 0) {
        box.innerHTML =
            '<div class="bg-theme-secondary rounded-xl shadow-theme p-8 text-center text-theme-muted">' +
                '<i class="fas fa-layer-group text-4xl mb-3 opacity-30"></i>' +
                '<p class="text-sm text-theme-primary">还没有任务模板</p>' +
                '<p class="text-xs mt-1">把常用任务结构保存下来，创建任务时可以直接套用。</p>' +
                '<button type="button" onclick="startNewTaskTemplate()" class="mt-4 px-4 py-2 rounded-lg bg-accent text-white text-sm hover:bg-accent-hover transition"><i class="fas fa-plus mr-1"></i>新建模板</button>' +
                '<p class="text-[11px] mt-3">也可以在任务详情标题右侧点模板图标，把现有任务存为模板。</p>' +
            '</div>';
        _teardownTaskTemplateDetailFit();
        _flashTaskTemplateRow();
        return;
    }

    if (filtered.length === 0) {
        box.innerHTML =
            '<div class="bg-theme-secondary rounded-xl shadow-theme p-8 text-center text-theme-muted">' +
                '<i class="fas fa-magnifying-glass text-3xl mb-3 opacity-30"></i>' +
                '<p class="text-sm text-theme-primary">没有匹配「' + escapeHtml(_tplPageSearchQuery.trim()) + '」的模板</p>' +
                '<button type="button" onclick="clearTaskTemplatesSearch()" class="mt-3 text-xs text-accent hover:underline">清除搜索</button>' +
            '</div>';
        _teardownTaskTemplateDetailFit();
        return;
    }

    const label = q ? '搜索结果 · ' + filtered.length : '全部模板';
    const rows = filtered.map(function (tpl) {
        return _renderTaskTemplateRow(tpl, q);
    }).join('');
    box.innerHTML =
        '<div class="bg-theme-secondary rounded-xl shadow-theme p-4">' +
            '<div class="flex items-center justify-between mb-2">' +
                '<h3 class="text-base font-semibold text-theme-primary">' + label + '</h3>' +
            '</div>' +
            '<div>' + rows + '</div>' +
        '</div>';
    _setupTaskTemplateDetailFit();
    _flashTaskTemplateRow();
}

let _tplRowDeleteConfirmId = null;
let _tplRowDeleteConfirmTimer = null;

function _renderTaskTemplateRow(tpl, searching) {
    const meta = getTaskTemplateMeta(tpl);
    const name = tpl.name || '未命名模板';
    const list = meta.task.listId && typeof getList === 'function' ? getList(meta.task.listId) : null;
    const barColor = list ? (list.color || '#8b5cf6') : '#8b5cf6';
    const listDotColor = list ? (list.color || '#8b5cf6') : '#8b5cf6';
    const listLabel = list ? (list.name || '当前清单') : '根据上下文添加';
    const titleHtml = escapeHtml(name);
    const detailHtml = _templateDetailLineHTML(meta.task);
    const quadColors = (typeof getQuadrantColorClass === 'function')
        ? getQuadrantColorClass({ important: !!meta.important, urgent: !!meta.urgent })
        : { bg: '' };
    const dragClass = searching
        ? 'opacity-30 pointer-events-none'
        : 'hover:text-theme-primary cursor-grab';
    const timeText = meta.timeLabel || '';
    const reminderText = meta.reminders.length ? '提前 ' + meta.reminders.join('/') + ' 分钟' : '';
    const repeatLabel = meta.repeatLabel || '';
    const tagCapsules = (typeof renderTagCapsules === 'function')
        ? renderTagCapsules(Object.assign({}, meta.task, { id: tpl.id }), 2, 'right')
        : '';
    const warning = meta.needsTime
        ? '<span class="inline-flex items-center gap-1 flex-shrink-0 text-amber-500"><i class="fas fa-triangle-exclamation"></i>需补时间</span>'
        : '';
    const listAll = getTaskTemplates();
    const idx = listAll.findIndex(function (t) { return t.id === tpl.id; });
    const actionBase = 'w-8 h-8 rounded-lg flex items-center justify-center transition flex-shrink-0';
    const editCls = actionBase + ' tone-outline-accent';
    const copyCls = actionBase + ' tone-outline-emerald';
    const sortCls = actionBase + ' tone-outline-sky';
    const useCls = 'px-2.5 py-1.5 text-xs rounded-lg tone-outline-purple transition flex-shrink-0';
    const disabledUp = searching || idx <= 0;
    const disabledDown = searching || idx === -1 || idx >= listAll.length - 1;
    const confirming = _tplRowDeleteConfirmId === tpl.id;
    const deleteCls = actionBase + (confirming
        ? ' tone-solid-red'
        : ' tone-outline-red');

    return `<div class="tpl-manage-row relative flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 py-2.5 px-3 rounded-r-lg ${quadColors.bg} hover:opacity-80 transition cursor-pointer group"
            data-tpl-id="${tpl.id}"
            onclick="event.stopPropagation();openTaskTemplatePanel('${tpl.id}')"
            ondragover="taskTemplateDragOver(event, this)" ondragleave="taskTemplateDragLeave(event, this)" ondrop="dropTaskTemplate(event, this, '${tpl.id}')">
        <div class="task-list-color-bar" style="background-color: ${barColor};"></div>
        <span class="tpl-drag-handle hidden sm:flex items-center justify-center w-5 h-8 rounded text-theme-muted select-none flex-shrink-0 ${dragClass}" draggable="${searching ? 'false' : 'true'}"
            onclick="event.stopPropagation()" ondragstart="startTaskTemplateDrag(event, '${tpl.id}')" ondragend="endTaskTemplateDrag()" title="拖拽排序">
            <i class="fas fa-layer-group text-sm text-purple-500"></i>
        </span>
        <div class="flex-1 min-w-0">
            <div data-tpl-title class="text-base font-medium text-theme-primary truncate">${titleHtml}</div>
            ${detailHtml}
            <div data-tpl-info-line class="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0 text-xs text-theme-secondary mt-0.5">
                ${timeText ? '<span class="inline-flex items-center gap-1 flex-shrink-0 text-theme-secondary"><i class="far fa-clock"></i>' + escapeHtml(timeText) + '</span>' : ''}
                <span class="inline-flex items-center gap-1 min-w-0">
                    <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${listDotColor};"></span>
                    <span class="min-w-0" style="overflow-wrap:anywhere;">${escapeHtml(listLabel)}</span>
                </span>
                ${reminderText ? '<span class="inline-flex items-center gap-1 flex-shrink-0"><i class="fas fa-bell"></i>' + escapeHtml(reminderText) + '</span>' : ''}
                ${repeatLabel ? '<span class="inline-flex items-center gap-1 flex-shrink-0"><i class="fas fa-redo"></i>' + escapeHtml(repeatLabel) + '</span>' : ''}
                ${tagCapsules}
                ${warning}
            </div>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0 w-full justify-end sm:w-auto pt-1.5 border-t border-theme sm:pt-0 sm:border-t-0" onclick="event.stopPropagation()">
            <button type="button" class="${editCls}" title="编辑" onclick="openTaskTemplatePanel('${tpl.id}')"><i class="fas fa-pen text-sm"></i></button>
            <button type="button" class="${copyCls}" title="复制" onclick="duplicateTaskTemplateAndOpen('${tpl.id}')"><i class="fas fa-copy text-sm"></i></button>
            <button type="button" class="${sortCls}${disabledUp ? ' opacity-30 pointer-events-none' : ''}" title="上移" onclick="moveTaskTemplate('${tpl.id}',-1)"><i class="fas fa-arrow-up text-sm"></i></button>
            <button type="button" class="${sortCls}${disabledDown ? ' opacity-30 pointer-events-none' : ''}" title="下移" onclick="moveTaskTemplate('${tpl.id}',1)"><i class="fas fa-arrow-down text-sm"></i></button>
            <button type="button" onclick="openTaskTemplateUsePopover('${tpl.id}', this)" class="${useCls}" title="使用此模板">使用</button>
            <button type="button" class="${deleteCls}" title="${confirming ? '确认删除' : '删除'}" onclick="requestDeleteTaskTemplate('${tpl.id}')"><i class="fas fa-trash text-sm"></i></button>
        </div>
    </div>`;
}

let _tplDetailResizeObserver = null;
let _tplDetailFitRaf = null;
let _tplDetailFitTimer = null;

function _scheduleTaskTemplateDetailFit(delay) {
    if (_tplDetailFitTimer) clearTimeout(_tplDetailFitTimer);
    _tplDetailFitTimer = setTimeout(function () {
        _tplDetailFitTimer = null;
        _fitAllTaskTemplateDetailLines();
    }, delay);
}

function _fitTaskTemplateDetailLine(line) {
    if (!line || !line.getClientRects().length) return;
    const names = line.querySelector('[data-tpl-detail-names]');
    const counter = line.querySelector('[data-tpl-detail-counter]');
    if (!names || !counter) return;
    const items = Array.from(names.querySelectorAll('[data-tpl-detail-item]'));
    if (!items.length) return;
    const total = items.length;
    function resetLine() {
        items.forEach(function (el) { el.style.display = ''; });
        counter.classList.add('hidden');
        counter.textContent = '';
    }
    resetLine();
    const gap = parseFloat(getComputedStyle(names).columnGap) || 4;
    const widths = items.map(function (el) { return el.getBoundingClientRect().width; });
    function usedWidth(count) {
        let w = 0;
        for (let i = 0; i < count; i++) w += widths[i] + (i > 0 ? gap : 0);
        return w;
    }
    // getBoundingClientRect 的小数是亚像素宽度，clientWidth 取整；
    // 不留 1px 容差时 3 个 60.34px 的子任务会被判成 189.03 > 189 而误截断
    const FIT_TOLERANCE = 1;
    if (usedWidth(total) <= names.clientWidth + FIT_TOLERANCE) return;
    function computeFit() {
        const avail = names.clientWidth + FIT_TOLERANCE;
        let fit = 0;
        let used = 0;
        for (let i = 0; i < total; i++) {
            const w = widths[i] + (fit > 0 ? gap : 0);
            if (used + w <= avail) {
                used += w;
                fit += 1;
            } else {
                break;
            }
        }
        return fit;
    }
    function showFirst(count) {
        items.forEach(function (el, i) { el.style.display = i < count ? '' : 'none'; });
    }

    // ① 完整计数 ……[ n/total ]：计数自身会占宽度，迭代到数量与计数宽稳定
    counter.classList.remove('hidden');
    counter.textContent = '……[ ' + total + '/' + total + ' ]';
    let shown = -1;
    for (let pass = 0; pass <= total + 1; pass++) {
        const fit = computeFit();
        if (fit === total) {
            resetLine();
            return;
        }
        if (fit === shown) {
            if (fit >= 1) {
                showFirst(fit);
                return;
            }
            break;
        }
        shown = fit;
        counter.textContent = '……[ ' + fit + '/' + total + ' ]';
    }
    if (shown >= 1) {
        showFirst(shown);
        return;
    }

    // ② 计数挤掉全部子任务：压缩成省略号，至少放回 1 个
    counter.textContent = '……';
    let compactFit = computeFit();
    if (compactFit === total) {
        resetLine();
        return;
    }
    if (compactFit >= 1) {
        showFirst(compactFit);
        return;
    }

    // ③ 省略号也放不下：去掉计数再试；仍放不下完整子任务就回到「0/total」计数，
    //    宁可只显示数量，也不把子任务文字裁成半截
    counter.classList.add('hidden');
    counter.textContent = '';
    const fit = computeFit();
    if (fit >= 1) {
        showFirst(fit);
        return;
    }
    counter.textContent = '……[ 0/' + total + ' ]';
    counter.classList.remove('hidden');
    showFirst(0);
}

function _fitAllTaskTemplateDetailLines() {
    document.querySelectorAll('.tpl-manage-row [data-tpl-detail-line], .tpl-picker-row [data-tpl-detail-line], .cmd-tpl-row [data-tpl-detail-line]').forEach(function (line) {
        _fitTaskTemplateDetailLine(line);
    });
}

function _fitPickerMetaChips(meta) {
    if (!meta || !meta.getClientRects().length) return;
    const chips = Array.from(meta.children);
    if (!chips.length) return;
    chips.forEach(function (el) { el.style.display = ''; });
    if (meta.scrollWidth <= meta.clientWidth + 1) return;
    // 从尾部整颗隐藏，首颗（有时间时即时间）始终保留，避免胶囊被裁成半个字
    for (let i = chips.length - 1; i >= 1; i--) {
        chips[i].style.display = 'none';
        if (meta.scrollWidth <= meta.clientWidth + 1) break;
    }
}

function _fitAllPickerMetaChips() {
    document.querySelectorAll('.tpl-picker-row [data-tpl-picker-meta], .cmd-tpl-row [data-tpl-picker-meta]').forEach(_fitPickerMetaChips);
}

function _setupTaskTemplateDetailFit() {
    _fitAllPickerMetaChips();
    _fitAllTaskTemplateDetailLines();
    if (typeof ResizeObserver !== 'function') return;
    if (!_tplDetailResizeObserver) {
        _tplDetailResizeObserver = new ResizeObserver(function () {
            if (_tplDetailFitRaf) cancelAnimationFrame(_tplDetailFitRaf);
            _tplDetailFitRaf = requestAnimationFrame(function () {
                _tplDetailFitRaf = null;
                _fitAllPickerMetaChips();
                _fitAllTaskTemplateDetailLines();
            });
        });
    }
    _tplDetailResizeObserver.disconnect();
    document.querySelectorAll('.tpl-manage-row [data-tpl-detail-line], .tpl-picker-row [data-tpl-detail-line], .cmd-tpl-row [data-tpl-detail-line], .tpl-picker-row [data-tpl-picker-meta], .cmd-tpl-row [data-tpl-picker-meta]').forEach(function (line) {
        _tplDetailResizeObserver.observe(line);
    });
}

function _teardownTaskTemplateDetailFit() {
    if (_tplDetailFitTimer) {
        clearTimeout(_tplDetailFitTimer);
        _tplDetailFitTimer = null;
    }
    if (_tplDetailFitRaf) {
        cancelAnimationFrame(_tplDetailFitRaf);
        _tplDetailFitRaf = null;
    }
    if (_tplDetailResizeObserver) {
        _tplDetailResizeObserver.disconnect();
        _tplDetailResizeObserver = null;
    }
}

function requestDeleteTaskTemplate(tplId) {
    if (_tplRowDeleteConfirmId !== tplId) {
        _tplRowDeleteConfirmId = tplId;
        if (_tplRowDeleteConfirmTimer) clearTimeout(_tplRowDeleteConfirmTimer);
        _tplRowDeleteConfirmTimer = setTimeout(function () {
            _tplRowDeleteConfirmTimer = null;
            _tplRowDeleteConfirmId = null;
            if (typeof currentView !== 'undefined' && currentView === 'templates') _renderTaskTemplatesList();
        }, 3000);
        _renderTaskTemplatesList();
        return;
    }
    if (_tplRowDeleteConfirmTimer) {
        clearTimeout(_tplRowDeleteConfirmTimer);
        _tplRowDeleteConfirmTimer = null;
    }
    _tplRowDeleteConfirmId = null;
    _doDeleteTaskTemplate(tplId);
}

function _flashTaskTemplateRow() {
    if (!_tplPageFlashId) return;
    const id = _tplPageFlashId;
    _tplPageFlashId = null;
    const row = document.querySelector('.tpl-manage-row[data-tpl-id="' + id + '"]');
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    row.classList.add('tpl-row-flash');
    setTimeout(function () { row.classList.remove('tpl-row-flash'); }, 900);
}


function startNewTaskTemplate() {
    if (_tplPageSearchVisible && _tplPageSearchQuery) {
        _tplPageSearchVisible = false;
        _tplPageSearchQuery = '';
        _tplPageResetScroll = true;
        renderView();
    }
    openTaskTemplatePanel(null);
}

// ==================== 管理页：行菜单 / 使用浮层 ====================

function duplicateTaskTemplateAndOpen(tplId) {
    if (_tplPanelState && _tplPanelState.tplId === tplId
        && typeof flushTaskTemplatePanelAutoSave === 'function'
        && !flushTaskTemplatePanelAutoSave()) {
        return;
    }
    const copy = duplicateTaskTemplate(tplId);
    if (copy) openTaskTemplatePanel(copy.id);
}

let _tplUseState = null;
let _tplUseScrollCleanup = null;

function _tplUseDateLabel(mode) {
    return mode === 'tomorrow' ? '明天' : (mode === 'none' ? '不设日期' : '今天');
}

function _tplUseListLabel(listId) {
    if (!listId || listId === '__template__') return '跟随模板清单';
    const list = typeof getList === 'function' ? getList(listId) : null;
    return list ? (list.name || '当前清单') : '默认清单';
}

function _tplUseListOptionsHtml() {
    return ['<option value="__template__">跟随模板清单</option>'].concat(
        (typeof lists !== 'undefined' ? lists : [])
            .filter(_templateListSelectable)
            .map(function (l) {
                return '<option value="' + l.id + '">' + escapeHtml(l.name) + '</option>';
            })
    ).join('');
}

function openTaskTemplateUsePopover(tplId, btn) {
    closeTaskTemplateUsePopover();
    if (_tplPanelState && _tplPanelState.tplId === tplId && typeof flushTaskTemplatePanelAutoSave === 'function'
        && !flushTaskTemplatePanelAutoSave()) {
        return;
    }
    const tpl = getTaskTemplateById(tplId);
    if (!tpl) {
        if (typeof showToast === 'function') showToast('模板不存在或已被删除', 'warning');
        return;
    }
    _tplUseState = {
        tplId: tplId,
        dateMode: (typeof settings !== 'undefined' && settings.defaultTaskDate === 'none') ? 'none' : 'today',
        listId: '__template__'
    };
    const overlay = document.createElement('div');
    overlay.id = 'tpl-use-overlay';
    overlay.className = 'fixed inset-0';
    overlay.style.zIndex = '65';
    overlay.onclick = function (e) { if (e.target === overlay) closeTaskTemplateUsePopover(); };

    overlay.innerHTML =
        '<div id="tpl-use-popover" class="bg-theme-secondary border border-theme rounded-xl shadow-2xl p-4 w-[20rem] max-w-[92vw]" onclick="event.stopPropagation()">' +
            '<div class="flex items-start justify-between gap-3 mb-3">' +
                '<div class="min-w-0">' +
                    '<h3 class="text-base font-semibold text-theme-primary truncate">从「' + escapeHtml(tpl.name || '未命名模板') + '」创建</h3>' +
                    '<p class="text-xs text-theme-muted mt-0.5">选择日期与清单后创建任务。</p>' +
                '</div>' +
                '<button type="button" onclick="closeTaskTemplateUsePopover()" class="p-1.5 rounded-lg text-theme-muted hover:bg-theme-tertiary transition flex-shrink-0" aria-label="关闭"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="space-y-3">' +
                '<div>' +
                    '<div class="text-xs text-theme-secondary mb-1">创建到</div>' +
                    '<div id="tpl-use-date-chips" class="flex items-center gap-1"></div>' +
                '</div>' +
                '<div>' +
                    '<div class="text-xs text-theme-secondary mb-1">清单</div>' +
                    '<select id="tpl-use-list" onchange="setTaskTemplateUseList(this.value)" class="w-full text-xs px-2 py-2 rounded-lg border border-theme bg-theme-tertiary text-theme-primary cursor-pointer">' + _tplUseListOptionsHtml() + '</select>' +
                '</div>' +
                '<div id="tpl-use-summary" class="text-[11px] text-theme-muted"></div>' +
            '</div>' +
            '<div class="flex justify-end gap-2 mt-4">' +
                '<button type="button" onclick="closeTaskTemplateUsePopover()" class="px-3 py-1.5 text-sm rounded-lg border border-theme text-theme-secondary hover:bg-theme-tertiary transition">取消</button>' +
                '<button type="button" onclick="confirmTaskTemplateUse()" class="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover transition">创建任务</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(overlay);
    const panel = document.getElementById('tpl-use-popover');
    panel.style.width = '20rem';
    panel.style.maxWidth = '92vw';
    const rect = btn.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - pw - 8, rect.right - pw));
    let top = rect.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6;
    panel.style.position = 'fixed';
    panel.style.left = left + 'px';
    panel.style.top = Math.max(8, top) + 'px';
    panel.style.maxHeight = Math.max(160, window.innerHeight - 16) + 'px';
    panel.style.overflowY = 'auto';
    _renderTaskTemplateUseDateChips();
    _updateTaskTemplateUseSummary();
    _tplUseScrollCleanup = function () {
        window.addEventListener('scroll', closeTaskTemplateUsePopover, true);
    };
    setTimeout(_tplUseScrollCleanup, 0);
}

function closeTaskTemplateUsePopover() {
    const overlay = document.getElementById('tpl-use-overlay');
    if (overlay) overlay.remove();
    if (_tplUseScrollCleanup) {
        window.removeEventListener('scroll', closeTaskTemplateUsePopover, true);
        _tplUseScrollCleanup = null;
    }
    _tplUseState = null;
}

function _renderTaskTemplateUseDateChips() {
    const box = document.getElementById('tpl-use-date-chips');
    if (!box || !_tplUseState) return;
    const modes = [
        { key: 'today', label: '今天' },
        { key: 'tomorrow', label: '明天' },
        { key: 'none', label: '不设日期' }
    ];
    box.innerHTML = modes.map(function (m) {
        const active = _tplUseState.dateMode === m.key;
        return '<button type="button" onclick="setTaskTemplateUseDate(\'' + m.key + '\')" class="px-2 py-1 rounded-lg border text-xs transition ' +
            (active ? 'bg-accent text-white border-transparent' : 'border-theme text-theme-secondary hover:bg-theme-tertiary') + '">' +
            m.label + '</button>';
    }).join('');
}

function _updateTaskTemplateUseSummary() {
    const el = document.getElementById('tpl-use-summary');
    if (!el || !_tplUseState) return;
    el.textContent = '创建到：' + _tplUseDateLabel(_tplUseState.dateMode) + ' · ' + _tplUseListLabel(_tplUseState.listId);
}

function setTaskTemplateUseDate(mode) {
    if (!_tplUseState) return;
    if (mode !== 'today' && mode !== 'tomorrow' && mode !== 'none') return;
    _tplUseState.dateMode = mode;
    _renderTaskTemplateUseDateChips();
    _updateTaskTemplateUseSummary();
}

function setTaskTemplateUseList(listId) {
    if (!_tplUseState) return;
    _tplUseState.listId = listId || '__template__';
    _updateTaskTemplateUseSummary();
}

function confirmTaskTemplateUse() {
    const state = _tplUseState;
    if (!state) return;
    const tpl = getTaskTemplateById(state.tplId);
    if (!tpl) {
        closeTaskTemplateUsePopover();
        if (typeof showToast === 'function') showToast('模板不存在或已被删除', 'warning');
        return;
    }
    const task = createTaskFromTemplate(tpl, { dateMode: state.dateMode, listId: state.listId });
    closeTaskTemplateUsePopover();
    if (task) {
        _renderTaskTemplatesList();
        _updateTaskTemplatesPageCount();
    }
}

// ==================== 模板操作 / 拖拽排序 ====================

function _uniqueTemplateCopyName(baseName) {
    const base = String(baseName || '模板') + ' 副本';
    let name = base;
    let i = 2;
    while (getTaskTemplateByName(name)) {
        name = base + ' ' + i;
        i += 1;
    }
    return name;
}

function duplicateTaskTemplate(tplId) {
    const tpl = getTaskTemplateById(tplId);
    if (!tpl) return null;
    const now = new Date().toISOString();
    const taskCopy = JSON.parse(JSON.stringify(tpl.task || {}));
    delete taskCopy.duration;
    const copy = {
        id: _templateId(),
        name: _uniqueTemplateCopyName(tpl.name || '模板'),
        createdAt: now,
        updatedAt: now,
        task: taskCopy
    };
    const list = getTaskTemplates();
    const index = list.findIndex(function (t) { return t.id === tplId; });
    if (index === -1) list.push(copy);
    else list.splice(index + 1, 0, copy);
    saveData();
    _tplPageFlashId = copy.id;
    refreshTaskTemplatesUi();
    if (typeof showToast === 'function') showToast('已复制模板「' + copy.name + '」', 'success');
    return copy;
}

function _doDeleteTaskTemplate(tplId) {
    const tpl = getTaskTemplateById(tplId);
    if (!tpl) return;
    taskTemplates = getTaskTemplates().filter(function (t) { return t.id !== tplId; });
    saveData();
    if (_tplPanelState && _tplPanelState.tplId === tplId) {
        closeTaskTemplatePanel(true);
    }
    refreshTaskTemplatesUi();
    if (typeof showToast === 'function') showToast('已删除模板「' + tpl.name + '」', 'success');
}

function deleteTaskTemplate(tplId) {
    const tpl = getTaskTemplateById(tplId);
    if (!tpl) return;
    const linked = (typeof tasks !== 'undefined' ? tasks : []).filter(function (t) {
        return t.templateId === tplId;
    }).length;
    const message = '删除模板「' + tpl.name + '」？' + (linked > 0
        ? '已有 ' + linked + ' 个任务由它创建，删除模板不会删除这些任务。'
        : '');
    if (typeof showConfirmToast === 'function') {
        showConfirmToast(message, function () { _doDeleteTaskTemplate(tplId); }, null, { confirmLabel: '删除', cancelLabel: '取消' });
    } else {
        _doDeleteTaskTemplate(tplId);
    }
}

function deleteTaskTemplateFromPanel() {
    if (!_tplPanelState || !_tplPanelState.tplId) return;
    deleteTaskTemplate(_tplPanelState.tplId);
}

function moveTaskTemplate(tplId, dir) {
    const list = getTaskTemplates();
    const i = list.findIndex(function (t) { return t.id === tplId; });
    const j = i + dir;
    if (i === -1 || j < 0 || j >= list.length) return;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    saveData();
    refreshTaskTemplatesUi();
}

let _tplDragId = null;

function startTaskTemplateDrag(e, tplId) {
    if (_tplPageSearchQuery.trim()) {
        e.preventDefault();
        return;
    }
    _tplDragId = tplId;
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', tplId); } catch (err) {}
    }
    const row = e.currentTarget ? e.currentTarget.closest('.tpl-manage-row') : null;
    if (row) row.classList.add('tpl-row-dragging');
}

function endTaskTemplateDrag() {
    _tplDragId = null;
    document.querySelectorAll('.tpl-manage-row').forEach(function (row) {
        row.classList.remove('tpl-row-dragging', 'tpl-row-drag-over');
    });
}

function taskTemplateDragOver(e, row) {
    if (!_tplDragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (row) row.classList.add('tpl-row-drag-over');
}

function taskTemplateDragLeave(e, row) {
    if (!row) return;
    if (!e.relatedTarget || !row.contains(e.relatedTarget)) {
        row.classList.remove('tpl-row-drag-over');
    }
}

function dropTaskTemplate(e, row, targetId) {
    if (!_tplDragId) return;
    e.preventDefault();
    const fromId = _tplDragId;
    const list = getTaskTemplates();
    const fromIndex = list.findIndex(function (t) { return t.id === fromId; });
    if (fromIndex === -1) { endTaskTemplateDrag(); return; }
    const item = list.splice(fromIndex, 1)[0];
    const targetIndex = list.findIndex(function (t) { return t.id === targetId; });
    if (targetIndex === -1) {
        list.splice(fromIndex, 0, item);
        endTaskTemplateDrag();
        return;
    }
    let after = false;
    if (row) {
        const rect = row.getBoundingClientRect();
        after = e.clientY > rect.top + rect.height / 2;
    }
    list.splice(targetIndex + (after ? 1 : 0), 0, item);
    endTaskTemplateDrag();
    saveData();
    refreshTaskTemplatesUi();
}

// ==================== 模板详情面板 ====================

let _tplPanelState = null;
let _tplPanelHideTimer = null;
let _tplPanelSaveTimer = null;
let _tplPanelOutsideBound = false;
let _tplPanelSubtaskHoldTimer = null;
let _tplPanelSubtaskHintTimer = null;
let _tplPanelSubtaskHoldRow = null;
let _tplPanelSubtaskHoldIndex = -1;
let _tplPanelSubtaskHoldPointerId = null;
let _tplPanelSubtaskHoldStartX = 0;
let _tplPanelSubtaskHoldStartY = 0;
let _tplPanelSubtaskDragActive = false;
let _tplPanelSubtaskDragRow = null;
let _tplPanelSubtaskDragIndex = -1;
let _tplPanelSubtaskDragPointerId = null;
let _tplPanelSubtaskDragRects = [];
let _tplPanelSubtaskDragTarget = null;

function _tplPanelAutoSaveDelay() {
    return (typeof getAutoSaveDelay === 'function') ? getAutoSaveDelay() : 500;
}

function _taskTemplatePanelHtml() {
    return `
        <div class="px-4 pt-4 pb-3 flex items-center justify-between flex-shrink-0">
            <button type="button" onclick="toggleTaskTemplatePanelTimeMenu()" class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-theme-primary hover:bg-theme-tertiary transition min-w-0">
                <span id="tpl-panel-time-summary" class="truncate">设置建议时间</span>
                <span id="tpl-panel-needs-time" class="hidden flex-shrink-0 text-[10px] leading-4 px-1.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30">需补时间</span>
                <i class="fas fa-chevron-down text-xs flex-shrink-0"></i>
            </button>
            <div class="flex items-center gap-2 flex-shrink-0">
                <button type="button" onclick="closeTaskTemplatePanel()" class="p-2 text-theme-muted hover:bg-theme-tertiary rounded-lg transition" title="关闭"><i class="fas fa-times"></i></button>
            </div>
        </div>
        <div id="tpl-panel-time-menu" class="hidden p-4 space-y-3 flex-shrink-0">
            <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-theme-secondary">建议时间</span>
                <div class="flex items-center gap-2">
                    <button type="button" id="tpl-panel-time-mode-btn" onclick="toggleTaskTemplatePanelTimeRange()" class="text-xs px-2 py-1 rounded border border-theme text-theme-secondary hover:bg-theme-tertiary transition">时间段</button>
                    <button type="button" onclick="clearTaskTemplatePanelTime()" class="text-xs px-2 py-1 rounded border border-theme text-theme-secondary hover:bg-theme-tertiary transition">清除时间</button>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <div class="relative">
                    <input type="time" id="tpl-panel-time" title="开始时间" aria-label="开始时间" class="w-full px-2 py-1.5 text-sm border border-theme rounded-lg text-theme-secondary cursor-pointer" onclick="openTimePicker(this, 'tpl-panel-time-picker', onTaskTemplatePanelTimeChange)" onchange="onTaskTemplatePanelTimeChange()">
                    <div id="tpl-panel-time-picker" class="hidden absolute left-0 right-0 mt-1 bg-theme-tertiary rounded-lg border border-theme z-20 shadow-lg max-h-48 overflow-y-auto"></div>
                </div>
                <div id="tpl-panel-end-time-container" class="relative hidden">
                    <input type="time" id="tpl-panel-end-time" title="结束时间" aria-label="结束时间" class="w-full px-2 py-1.5 text-sm border border-theme rounded-lg text-theme-secondary cursor-pointer" onclick="openTimePicker(this, 'tpl-panel-end-time-picker', onTaskTemplatePanelEndTimeChange)" onchange="onTaskTemplatePanelEndTimeChange()">
                    <div id="tpl-panel-end-time-picker" class="hidden absolute left-0 right-0 mt-1 bg-theme-tertiary rounded-lg border border-theme z-20 shadow-lg max-h-48 overflow-y-auto"></div>
                </div>
            </div>
            <p id="tpl-panel-time-range-hint" class="hidden text-[11px] text-amber-500"></p>
            <p id="tpl-panel-time-warning" class="hidden text-[11px] text-amber-500">提醒和重复需要建议时间才会生效</p>
            <div class="grid grid-cols-2 gap-2">
                <div class="relative">
                    <button type="button" id="tpl-panel-reminder-btn" onclick="toggleTaskTemplatePanelReminderPicker()" class="w-full px-3 py-1.5 text-sm text-theme-secondary border border-theme rounded-lg hover:bg-theme-tertiary flex items-center justify-between gap-1">
                        <span class="flex items-center min-w-0"><i class="fas fa-bell mr-2 flex-shrink-0"></i><span id="tpl-panel-reminder-text" class="truncate">不提前提醒</span></span>
                        <span class="flex items-center gap-1 flex-shrink-0">
                            <span id="tpl-panel-reminder-badge" class="hidden text-[10px] leading-4 px-1 rounded bg-theme-secondary text-theme-muted">0</span>
                            <i class="fas fa-chevron-down text-xs"></i>
                        </span>
                    </button>
                    <div id="tpl-panel-reminder-picker" class="hidden absolute left-0 right-0 mt-1 p-2 bg-theme-tertiary rounded-lg border border-theme z-20 shadow-lg" style="max-height: 380px; overflow-y: auto;">
                        <div id="tpl-panel-reminder-options" class="space-y-0.5"></div>
                        <div class="flex items-center gap-1 border-t border-theme mt-1 pt-1">
                            <input type="number" id="tpl-panel-custom-reminder" min="1" max="10080" placeholder="提前分钟数"
                                class="flex-1 min-w-0 px-2 py-1 text-sm border border-theme rounded bg-theme-secondary text-theme-primary"
                                onkeydown="if(event.key==='Enter'){event.preventDefault();addTaskTemplatePanelCustomReminder();}">
                            <button type="button" onclick="addTaskTemplatePanelCustomReminder()" class="px-2 py-1 text-xs rounded border border-theme text-theme-secondary hover:bg-theme-secondary transition whitespace-nowrap">+ 添加</button>
                        </div>
                    </div>
                </div>
                <div class="relative">
                    <button type="button" onclick="toggleTaskTemplatePanelRepeatPicker()" class="w-full px-3 py-1.5 text-sm text-theme-secondary border border-theme rounded-lg hover:bg-theme-tertiary flex items-center justify-between">
                        <span><i class="fas fa-redo mr-2"></i><span id="tpl-panel-repeat-text">不重复</span></span>
                        <i class="fas fa-chevron-down text-xs"></i>
                    </button>
                    <div id="tpl-panel-repeat-picker" class="hidden absolute left-0 right-0 mt-1 p-2 bg-theme-tertiary rounded-lg border border-theme z-10 shadow-lg" style="max-height: 360px; overflow-y: auto;">
                        <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                            <input type="radio" name="tpl-panel-repeat" value="" class="tpl-repeat-option" checked onchange="onTaskTemplatePanelRepeatChange()"> 不重复
                        </label>
                        <div class="repeat-group">
                            <div class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1" onclick="toggleRepeatSubmenu(this)">
                                <i class="fas fa-chevron-right text-[10px] transition-transform duration-200 repeat-submenu-arrow"></i>
                                <span>每天</span>
                            </div>
                            <div class="hidden pl-5 repeat-submenu space-y-0">
                                <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                                    <input type="radio" name="tpl-panel-repeat" value="daily" class="tpl-repeat-option" onchange="onTaskTemplatePanelRepeatChange()"> 每天
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                                    <input type="radio" name="tpl-panel-repeat" value="dailyWorkday" class="tpl-repeat-option" data-repeat-props='{"type":"daily","workdayOnly":true}' onchange="onTaskTemplatePanelRepeatChange()"> 每个工作日
                                </label>
                            </div>
                        </div>
                        <div class="repeat-group">
                            <div class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1" onclick="toggleRepeatSubmenu(this)">
                                <i class="fas fa-chevron-right text-[10px] transition-transform duration-200 repeat-submenu-arrow"></i>
                                <span>每周</span>
                            </div>
                            <div class="hidden pl-5 repeat-submenu space-y-0">
                                <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                                    <input type="radio" name="tpl-panel-repeat" value="weekly" class="tpl-repeat-option" onchange="onTaskTemplatePanelRepeatChange()"> 每周
                                </label>
                                <div class="border-t border-theme my-1"></div>
                                <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                                    <input type="radio" name="tpl-panel-repeat" value="weeklyFirstWorkday" class="tpl-repeat-option" onchange="onTaskTemplatePanelRepeatChange()"> 每周首个工作日
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                                    <input type="radio" name="tpl-panel-repeat" value="weeklyLastWorkday" class="tpl-repeat-option" onchange="onTaskTemplatePanelRepeatChange()"> 工作周期最后一个工作日
                                </label>
                            </div>
                        </div>
                        <div class="repeat-group">
                            <div class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1" onclick="toggleRepeatSubmenu(this)">
                                <i class="fas fa-chevron-right text-[10px] transition-transform duration-200 repeat-submenu-arrow"></i>
                                <span>每月</span>
                            </div>
                            <div class="hidden pl-5 repeat-submenu space-y-0">
                                <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                                    <input type="radio" name="tpl-panel-repeat" value="monthly" class="tpl-repeat-option" onchange="onTaskTemplatePanelRepeatChange()"> 每月
                                </label>
                                <div class="border-t border-theme my-1"></div>
                                <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                                    <input type="radio" name="tpl-panel-repeat" value="monthlyFirstWorkday" class="tpl-repeat-option" onchange="onTaskTemplatePanelRepeatChange()"> 每月首个工作日
                                </label>
                                <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                                    <input type="radio" name="tpl-panel-repeat" value="monthlyLastWorkday" class="tpl-repeat-option" onchange="onTaskTemplatePanelRepeatChange()"> 每月最后一个工作日
                                </label>
                            </div>
                        </div>
                        <div class="repeat-group">
                            <div class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1" onclick="toggleRepeatSubmenu(this)">
                                <i class="fas fa-chevron-right text-[10px] transition-transform duration-200 repeat-submenu-arrow"></i>
                                <span>每年</span>
                            </div>
                            <div class="hidden pl-5 repeat-submenu space-y-0">
                                <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                                    <input type="radio" name="tpl-panel-repeat" value="yearly" class="tpl-repeat-option" onchange="onTaskTemplatePanelRepeatChange()"> 每年
                                </label>
                                <div class="border-t border-theme my-1"></div>
                                <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                                    <input type="radio" name="tpl-panel-repeat" value="yearlyBeforeHoliday" class="tpl-repeat-option" data-repeat-props='{"type":"yearly","beforeHoliday":true}' onchange="onTaskTemplatePanelRepeatChange()"> 每个节假日前一天
                                </label>
                            </div>
                        </div>
                        <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary py-1">
                            <input type="radio" name="tpl-panel-repeat" value="custom" class="tpl-repeat-option" onchange="onTaskTemplatePanelRepeatChange()"> 自定义
                        </label>
                        <div id="tpl-panel-custom-repeat-container" class="hidden space-y-2 pl-5">
                            <input type="number" id="tpl-panel-custom-repeat-interval" class="w-full px-2 py-1 text-sm border border-theme rounded bg-theme-secondary text-theme-primary" placeholder="间隔" onchange="onTaskTemplatePanelRepeatChange()">
                            <select id="tpl-panel-custom-repeat-unit" class="w-full px-2 py-1 text-sm border border-theme rounded bg-theme-secondary text-theme-primary" onchange="onTaskTemplatePanelRepeatChange()">
                                <option value="days">天</option>
                                <option value="weeks">周</option>
                                <option value="months">月</option>
                                <option value="years">年</option>
                            </select>
                        </div>
                        <div id="tpl-panel-repeat-mode-container" class="border-t border-theme pt-2 mt-2 space-y-1">
                            <label class="text-xs font-medium text-theme-secondary">重复方式</label>
                            <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary">
                                <input type="radio" name="tpl-panel-repeat-mode" value="startTime" class="tpl-repeat-mode-option" checked onchange="onTaskTemplatePanelRepeatChange()"> 按设定时间
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer text-sm text-theme-secondary hover:text-theme-primary">
                                <input type="radio" name="tpl-panel-repeat-mode" value="completeTime" class="tpl-repeat-mode-option" onchange="onTaskTemplatePanelRepeatChange()"> 按完成时间
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="px-4 pt-2 pb-2 flex items-center gap-3 flex-shrink-0">
            <span class="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center flex-shrink-0"><i class="fas fa-layer-group text-sm"></i></span>
            <div class="flex-1 min-w-0">
                <textarea id="tpl-panel-name" rows="1" maxlength="30" placeholder="模板名称" class="block w-full text-xl font-medium bg-transparent border-none outline-none text-theme-primary resize-none overflow-hidden" style="min-height:32px;max-height:120px;" oninput="onTaskTemplatePanelNameInput(this)"></textarea>
            </div>
        </div>
        <div id="tpl-panel-body" class="flex-1 p-4 overflow-y-auto min-h-0 flex flex-col">
            <textarea id="tpl-panel-notes" rows="1" placeholder="任务详情描述" class="w-full bg-transparent border-none outline-none resize-none text-theme-primary overflow-hidden" style="min-height:36px;" oninput="onTaskTemplatePanelNotesInput(this)"></textarea>
            <div id="tpl-panel-subtasks" class="space-y-2 flex-shrink-0"></div>
            <div id="tpl-panel-error" class="hidden text-xs text-red-500 mt-2"></div>
        </div>
        <div class="p-4 flex-shrink-0 space-y-3">
            <div id="tpl-panel-tags-display" class="hidden flex flex-wrap mb-1"></div>
            <div class="flex items-center gap-1.5 text-xs text-theme-secondary min-w-0">
                <span id="tpl-panel-list-dot" class="w-2 h-2 rounded-full flex-shrink-0" style="background:#8b5cf6;"></span>
                <span id="tpl-panel-list-name" class="truncate">根据上下文添加</span>
            </div>
            <div class="relative">
                <div class="grid grid-cols-5 gap-2">
                    <button type="button" id="tpl-panel-important" onclick="toggleTaskTemplatePanelPriority('important')" title="重要" class="wm-circle mx-auto flex items-center justify-center w-10 h-10 rounded-full border border-theme text-theme-secondary hover:bg-theme-tertiary transition"><i class="fas fa-star"></i></button>
                    <button type="button" id="tpl-panel-urgent" onclick="toggleTaskTemplatePanelPriority('urgent')" title="紧急" class="wm-circle mx-auto flex items-center justify-center w-10 h-10 rounded-full border border-theme text-theme-secondary hover:bg-theme-tertiary transition"><i class="fas fa-fire"></i></button>
                    <button type="button" id="tpl-panel-tag-btn" onclick="toggleTaskTemplatePanelTagPicker()" title="标签" class="wm-circle mx-auto flex items-center justify-center w-10 h-10 rounded-full border border-theme text-theme-secondary hover:bg-theme-tertiary transition"><i class="fas fa-tag"></i></button>
                    <button type="button" id="tpl-panel-list-btn" onclick="toggleTaskTemplatePanelListPicker()" title="所属清单" class="wm-circle mx-auto flex items-center justify-center w-10 h-10 rounded-full border border-theme text-theme-secondary hover:bg-theme-tertiary transition"><i class="fas fa-inbox"></i></button>
                    <button type="button" id="tpl-panel-delete-btn" onclick="deleteTaskTemplateFromPanel()" title="删除模板" class="wm-circle mx-auto flex items-center justify-center w-10 h-10 rounded-full border border-theme text-theme-secondary hover:bg-theme-tertiary transition"><i class="fas fa-trash"></i></button>
                </div>
                <!-- 标签 / 清单候选面板：悬浮在按钮簇正上方（与任务详情栏同款气泡） -->
                <div id="tpl-panel-tag-picker" class="tpl-panel-hover-picker hidden p-2 bg-theme-tertiary rounded-lg border border-theme overflow-y-auto"><div id="tpl-panel-tag-pills" class="flex flex-wrap gap-1.5"></div></div>
                <div id="tpl-panel-list-picker" class="tpl-panel-hover-picker hidden p-2 bg-theme-tertiary rounded-lg border border-theme overflow-y-auto"><div id="tpl-panel-list-pills" class="flex flex-wrap gap-1.5"></div></div>
            </div>
        </div>
    `;
}

function _ensureTaskTemplatePanel() {
    let panel = document.getElementById('template-detail-panel');
    if (panel) return panel;
    panel = document.createElement('aside');
    panel.id = 'template-detail-panel';
    panel.className = 'hidden w-96 bg-theme-secondary border-l border-theme flex flex-col h-screen relative z-40';
    panel.innerHTML = _taskTemplatePanelHtml();
    const app = document.getElementById('app-container') || document.body;
    app.appendChild(panel);
    panel.addEventListener('click', _tplPanelPickerOutsideClick);
    if (typeof setupHoverPickerGroup === 'function') {
        setupHoverPickerGroup([
            { triggerId: 'tpl-panel-tag-btn', pickerId: 'tpl-panel-tag-picker', open: function () { openTaskTemplatePanelTagPicker(); } },
            { triggerId: 'tpl-panel-list-btn', pickerId: 'tpl-panel-list-picker', open: function () { openTaskTemplatePanelListPicker(); } }
        ]);
    }
    _setupTaskTemplatePanelOutsideClose();
    return panel;
}

function _tplPanelPickerOutsideClick(e) {
    const reminderPicker = document.getElementById('tpl-panel-reminder-picker');
    if (reminderPicker && !reminderPicker.classList.contains('hidden')
        && !e.target.closest('#tpl-panel-reminder-picker')
        && !e.target.closest('button[onclick="toggleTaskTemplatePanelReminderPicker()"]')) {
        reminderPicker.classList.add('hidden');
    }
    const repeatPicker = document.getElementById('tpl-panel-repeat-picker');
    if (repeatPicker && !repeatPicker.classList.contains('hidden')
        && !e.target.closest('#tpl-panel-repeat-picker')
        && !e.target.closest('button[onclick="toggleTaskTemplatePanelRepeatPicker()"]')) {
        repeatPicker.classList.add('hidden');
    }
    const tagPicker = document.getElementById('tpl-panel-tag-picker');
    if (tagPicker && !tagPicker.classList.contains('hidden')
        && !e.target.closest('#tpl-panel-tag-picker')
        && !e.target.closest('button[onclick="toggleTaskTemplatePanelTagPicker()"]')) {
        tagPicker.classList.add('hidden');
    }
    const listPicker = document.getElementById('tpl-panel-list-picker');
    if (listPicker && !listPicker.classList.contains('hidden')
        && !e.target.closest('#tpl-panel-list-picker')
        && !e.target.closest('button[onclick="toggleTaskTemplatePanelListPicker()"]')) {
        listPicker.classList.add('hidden');
    }
}

function _setupTaskTemplatePanelOutsideClose() {
    if (_tplPanelOutsideBound) return;
    _tplPanelOutsideBound = true;
    document.addEventListener('click', function (e) {
        if (!_tplPanelState) return;
        if (e.target.closest('#template-detail-panel')) return;
        if (e.target.closest('#tpl-use-overlay')) return;
        if (typeof isEventInsideOpenOverlay === 'function' && isEventInsideOpenOverlay(e)) return;
        if (e.target.closest('button, input, textarea, select')) return;
        if (e.target.closest('.tpl-manage-row')) return;
        closeTaskTemplatePanel();
    });
}

function _tplPanelBuildDraft(tpl) {
    const task = (tpl && tpl.task) ? tpl.task : {};
    const validTagIds = (settings.tags || []).map(function (t) { return t.id; });
    const list = task.listId && typeof getList === 'function' ? getList(task.listId) : null;
    const subtasks = (task.subtasks || []).filter(function (s) {
        return s && (s.text || '').trim();
    }).map(function (s, i) {
        return {
            text: s.text || '',
            completed: false,
            originalOrder: i,
            startTime: null,
            reminders: []
        };
    });
    if (subtasks.length === 0) {
        subtasks.push({ text: '', completed: false, originalOrder: 0, startTime: null, reminders: [] });
    }
    const name = tpl ? (tpl.name || '') : '';
    return {
        name: name,
        task: {
            title: task.title || name,
            notes: task.notes || '',
            description: task.description || '',
            mode: task.mode === 'subtasks' ? 'subtasks' : 'text',
            listId: _templateListSelectable(list) ? task.listId : null,
            tags: (task.tags || []).filter(function (id) { return validTagIds.indexOf(id) !== -1; }),
            important: !!task.important,
            urgent: !!task.urgent,
            reminders: _templateRemindersOf(task),
            repeat: task.repeat ? _normalizeTemplateRepeat(task.repeat) : null,
            suggestedTime: _templateNormalizeSuggestedTime(task.suggestedTime),
            suggestedEndTime: _templateNormalizeSuggestedTime(task.suggestedEndTime),
            subtasks: subtasks
        }
    };
}

function _tplPanelHasContent(draft) {
    if (!draft) return false;
    if (String(draft.name || '').trim()) return true;
    const task = draft.task || {};
    if (String(task.title || '').trim()) return true;
    if (String(task.notes || '').trim()) return true;
    if (String(task.description || '').trim()) return true;
    if (task.listId) return true;
    if ((task.tags || []).length) return true;
    if (task.important || task.urgent) return true;
    if (task.suggestedTime) return true;
    if ((task.reminders || []).length) return true;
    if (task.repeat) return true;
    return (task.subtasks || []).some(function (st) { return String(st.text || '').trim(); });
}

function _tplPanelSetError(message) {
    const el = document.getElementById('tpl-panel-error');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
}

function _tplPanelAutoResizeName(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(120, Math.max(32, el.scrollHeight)) + 'px';
}

function _tplPanelAutoResizeSubtask(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

function _tplPanelAutoResizeNotes(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(36, el.scrollHeight) + 'px';
}

function _tplPanelUpdateNotesPlaceholder() {
    const notes = document.getElementById('tpl-panel-notes');
    if (!notes || !_tplPanelState) return;
    const hasSubtaskText = (_tplPanelState.draft.task.subtasks || []).some(function (st) {
        return st && String(st.text || '').trim();
    });
    notes.placeholder = hasSubtaskText ? '' : '任务详情描述';
}

function _tplPanelRefreshActions() {
    if (!_tplPanelState) return;
    const saved = !!_tplPanelState.tplId;
    const del = document.getElementById('tpl-panel-delete-btn');
    if (del) {
        del.classList.toggle('opacity-30', !saved);
        del.classList.toggle('pointer-events-none', !saved);
        del.setAttribute('aria-disabled', saved ? 'false' : 'true');
    }
}

function _tplPanelRefreshTimeSummary() {
    if (!_tplPanelState) return;
    const task = _tplPanelState.draft.task;
    const start = _templateNormalizeSuggestedTime(task.suggestedTime);
    const end = _templateNormalizeSuggestedTime(task.suggestedEndTime);
    const timeLabel = start ? (end ? start + ' - ' + end : start) : null;
    const parts = [];
    if (timeLabel) parts.push(timeLabel);
    if (task.reminders && task.reminders.length) parts.push('提前 ' + task.reminders.join('/') + ' 分钟');
    const repeatLabel = getTaskTemplateRepeatLabel(task.repeat);
    if (repeatLabel) parts.push(repeatLabel);
    const summary = document.getElementById('tpl-panel-time-summary');
    if (summary) summary.textContent = parts.length ? parts.join(' · ') : '设置建议时间';
    const needed = ((task.reminders && task.reminders.length > 0) || !!task.repeat) && !start;
    const warning = document.getElementById('tpl-panel-time-warning');
    if (warning) warning.classList.toggle('hidden', !needed);
    const badge = document.getElementById('tpl-panel-needs-time');
    if (badge) badge.classList.toggle('hidden', !needed);
    const hint = document.getElementById('tpl-panel-time-range-hint');
    if (hint) {
        let text = '';
        if (start && end && end <= start) text = '结束时间不晚于开始时间，创建任务时将按次日处理';
        else if (!start && end) text = '时间段需要填写开始时间';
        hint.textContent = text;
        hint.classList.toggle('hidden', !text);
    }
}

function _tplPanelRefreshTimeModeUi() {
    if (!_tplPanelState) return;
    const range = !!_tplPanelState.rangeMode;
    const btn = document.getElementById('tpl-panel-time-mode-btn');
    if (btn) btn.textContent = range ? '时间' : '时间段';
    const endBox = document.getElementById('tpl-panel-end-time-container');
    if (endBox) endBox.classList.toggle('hidden', !range);
}

function _tplPanelAddMinutes(hhmm, minutes) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return '';
    const d = new Date();
    d.setHours(parseInt(m[1], 10), parseInt(m[2], 10) + minutes, 0, 0);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function _tplPanelRefreshReminderText() {
    if (!_tplPanelState) return;
    const minutes = _tplPanelState.draft.task.reminders || [];
    const text = document.getElementById('tpl-panel-reminder-text');
    if (text) {
        text.textContent = formatReminderSummary(minutes);
        text.title = minutes.length ? minutes.map(formatReminderMinute).join('、') : REMINDER_EMPTY_LABEL;
    }
    const badge = document.getElementById('tpl-panel-reminder-badge');
    if (badge) {
        badge.textContent = String(minutes.length);
        badge.classList.toggle('hidden', minutes.length <= 1);
    }
}

function _tplPanelRenderReminderOptions() {
    if (!_tplPanelState) return;
    const container = document.getElementById('tpl-panel-reminder-options');
    if (!container) return;
    renderAdvanceReminderOptions(container, _tplPanelState.draft.task.reminders || [], null, function (next) {
        if (!_tplPanelState) return;
        _tplPanelState.draft.task.reminders = next;
        _tplPanelRefreshReminderText();
        _tplPanelRefreshTimeSummary();
        _tplPanelRenderReminderOptions();
        _tplPanelScheduleAutoSave();
    }, document.getElementById('tpl-panel-reminder-picker'), { showAbsolute: false });
}

function _tplPanelInitRepeatPicker() {
    if (!_tplPanelState) return;
    const picker = document.getElementById('tpl-panel-repeat-picker');
    if (!picker) return;
    const repeat = _tplPanelState.draft.task.repeat;
    picker.querySelectorAll('.tpl-repeat-option').forEach(function (el) { el.checked = false; });
    picker.querySelectorAll('.repeat-submenu').forEach(function (el) { el.classList.add('hidden'); });
    picker.querySelectorAll('.repeat-submenu-arrow').forEach(function (el) { el.style.transform = ''; });
    const customBox = document.getElementById('tpl-panel-custom-repeat-container');
    if (customBox) customBox.classList.add('hidden');
    const modeBox = document.getElementById('tpl-panel-repeat-mode-container');
    if (modeBox) modeBox.classList.remove('hidden');
    picker.querySelectorAll('.tpl-repeat-mode-option').forEach(function (el) { el.checked = false; });
    const defaultMode = picker.querySelector('.tpl-repeat-mode-option[value="startTime"]');
    if (defaultMode) defaultMode.checked = true;

    let value = '';
    if (repeat && repeat.type) {
        if (repeat.type === 'custom') value = 'custom';
        else if (repeat.type === 'daily' && repeat.workdayOnly) value = 'dailyWorkday';
        else if (repeat.type === 'dailyWorkday') value = 'dailyWorkday';
        else if (repeat.type === 'yearly' && repeat.beforeHoliday) value = 'yearlyBeforeHoliday';
        else if (repeat.type === 'yearlyBeforeHoliday') value = 'yearlyBeforeHoliday';
        else value = repeat.type;
    }
    let target = value ? picker.querySelector('.tpl-repeat-option[value="' + value + '"]') : null;
    if (value === 'custom') {
        if (customBox) customBox.classList.remove('hidden');
        const interval = document.getElementById('tpl-panel-custom-repeat-interval');
        const unit = document.getElementById('tpl-panel-custom-repeat-unit');
        if (interval) interval.value = repeat.interval || '';
        if (unit) unit.value = repeat.unit || 'days';
    }
    if (!target) target = picker.querySelector('.tpl-repeat-option[value=""]');
    if (target) {
        target.checked = true;
        const group = target.closest('.repeat-group');
        if (group) {
            const submenu = group.querySelector('.repeat-submenu');
            const arrow = group.querySelector('.repeat-submenu-arrow');
            if (submenu) submenu.classList.remove('hidden');
            if (arrow) arrow.style.transform = 'rotate(90deg)';
        }
    }
    if (repeat && repeat.repeatMode) {
        const mode = picker.querySelector('.tpl-repeat-mode-option[value="' + repeat.repeatMode + '"]');
        if (mode) mode.checked = true;
    }
    _tplPanelRefreshRepeatText(false);
}

function _tplPanelRepeatValueFromForm() {
    const picker = document.getElementById('tpl-panel-repeat-picker');
    if (!picker) return _tplPanelState ? _tplPanelState.draft.task.repeat : null;
    const selected = picker.querySelector('.tpl-repeat-option:checked');
    if (!selected || !selected.value) return null;
    const modeEl = picker.querySelector('.tpl-repeat-mode-option:checked');
    const repeatMode = modeEl ? modeEl.value : 'startTime';
    if (selected.value === 'custom') {
        const interval = parseInt(document.getElementById('tpl-panel-custom-repeat-interval').value, 10);
        const unit = document.getElementById('tpl-panel-custom-repeat-unit').value;
        if (!interval || interval <= 0) return null;
        return { type: 'custom', interval: interval, unit: unit, repeatMode: repeatMode };
    }
    const propsAttr = selected.getAttribute('data-repeat-props');
    let value;
    if (propsAttr) {
        try { value = Object.assign({}, JSON.parse(propsAttr)); }
        catch (err) { value = { type: selected.value }; }
    } else {
        value = { type: selected.value };
    }
    value.repeatMode = repeatMode;
    const original = _tplPanelState ? _tplPanelState.originalRepeat : null;
    if (original && original.type === value.type) {
        if (value.type === 'weekly' && original.dayOfWeek !== undefined) value.dayOfWeek = original.dayOfWeek;
        if (value.type === 'monthly' && original.dayOfMonth !== undefined) value.dayOfMonth = original.dayOfMonth;
        if (value.type === 'yearly') {
            if (original.month !== undefined) value.month = original.month;
            if (original.day !== undefined) value.day = original.day;
            if (original.beforeHoliday !== undefined) value.beforeHoliday = original.beforeHoliday;
        }
    }
    return value;
}

function _tplPanelRefreshRepeatText(scheduleSave) {
    if (!_tplPanelState) return;
    const picker = document.getElementById('tpl-panel-repeat-picker');
    const customBox = document.getElementById('tpl-panel-custom-repeat-container');
    const selected = picker ? picker.querySelector('.tpl-repeat-option:checked') : null;
    if (customBox) customBox.classList.toggle('hidden', !selected || selected.value !== 'custom');
    if (scheduleSave !== false) {
        _tplPanelState.draft.task.repeat = _tplPanelRepeatValueFromForm();
    }
    const text = document.getElementById('tpl-panel-repeat-text');
    if (text) {
        text.textContent = getTaskTemplateRepeatLabel(_tplPanelState.draft.task.repeat) || '不重复';
    }
    _tplPanelRefreshTimeSummary();
    if (scheduleSave !== false) _tplPanelScheduleAutoSave();
}

function _tplPanelRefreshPriority() {
    if (!_tplPanelState) return;
    const task = _tplPanelState.draft.task;
    if (typeof _setDetailPriorityBtnState === 'function') {
        _setDetailPriorityBtnState(document.getElementById('tpl-panel-important'), !!task.important, '重要');
        _setDetailPriorityBtnState(document.getElementById('tpl-panel-urgent'), !!task.urgent, '紧急');
    }
}

function _tplPanelRefreshTags() {
    const box = document.getElementById('tpl-panel-tag-pills');
    if (!box || !_tplPanelState) return;
    const tags = settings.tags || [];
    if (tags.length === 0) {
        box.innerHTML = '<p class="text-xs text-theme-muted">还没有标签，可在侧边栏创建。</p>';
        return;
    }
    const selected = _tplPanelState.draft.task.tags || [];
    box.innerHTML = tags.map(function (tag) {
        const on = selected.indexOf(tag.id) !== -1;
        const color = _safeTemplateColor(tag.color, '#6b7280');
        return '<button type="button" class="detail-tag-pill' + (on ? ' detail-tag-pill-selected' : '') + '" style="--tag-color:' + color + ';' + getTagSolidStyle(color) + '" aria-pressed="' + on + '" onclick="toggleTaskTemplatePanelTag(&#39;' + tag.id + '&#39;, this)">' + escapeHtml(tag.name) + '</button>';
    }).join('');
}

function _tplPanelRefreshTagsDisplay() {
    const box = document.getElementById('tpl-panel-tags-display');
    if (!box || !_tplPanelState) return;
    const tagIds = _tplPanelState.draft.task.tags || [];
    const tags = (settings.tags || []).filter(function (tag) { return tagIds.indexOf(tag.id) !== -1; });
    if (tags.length === 0) {
        box.innerHTML = '';
        box.classList.add('hidden');
        return;
    }
    box.classList.remove('hidden');
    box.innerHTML = tags.map(function (tag) {
        const color = _safeTemplateColor(tag.color, '#6b7280');
        return '<span class="detail-tag-chip inline-flex items-center px-2 py-0.5 rounded-full text-xs" style="--tag-color:' + color + ';' + getTagSolidStyle(color) + '">' +
            escapeHtml(tag.name) +
            '<button type="button" onclick="event.stopPropagation();removeTaskTemplatePanelTag(&#39;' + tag.id + '&#39;)" class="tag-remove-btn inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white/30 hover:bg-black/30 transition" title="删除标签"><i class="fas fa-times text-[9px]"></i></button>' +
        '</span>';
    }).join('');
}

function _tplPanelRefreshListButton() {
    const el = document.getElementById('tpl-panel-list-name');
    const dot = document.getElementById('tpl-panel-list-dot');
    if (!el || !_tplPanelState) return;
    const listId = _tplPanelState.draft.task.listId;
    const list = listId && typeof getList === 'function' ? getList(listId) : null;
    if (!list) {
        el.textContent = '根据上下文添加';
        if (dot) dot.style.background = '#8b5cf6';
        return;
    }
    el.textContent = list.name || '当前清单';
    if (dot) dot.style.background = list.color || '#8b5cf6';
}

function _tplPanelRefreshLists() {
    const box = document.getElementById('tpl-panel-list-pills');
    if (!box || !_tplPanelState) return;
    const current = _tplPanelState.draft.task.listId || '';
    const followOn = !current;
    const followColor = '#8b5cf6';
    const items = ['<button type="button" class="detail-tag-pill' + (followOn ? ' detail-tag-pill-selected' : '') + '" style="--tag-color:' + followColor + ';' + getTagSolidStyle(followColor) + '" onclick="setTaskTemplatePanelList(\'\')">根据上下文添加</button>'];
    (typeof lists !== 'undefined' ? lists : []).filter(_templateListSelectable).forEach(function (l) {
        const on = current === l.id;
        const color = _safeTemplateColor(l.color, '#8b5cf6');
        items.push('<button type="button" class="detail-tag-pill' + (on ? ' detail-tag-pill-selected' : '') + '" style="--tag-color:' + color + ';' + getTagSolidStyle(color) + '" onclick="setTaskTemplatePanelList(\'' + l.id + '\')">' + escapeHtml(l.name) + '</button>');
    });
    box.innerHTML = items.join('');
    _tplPanelRefreshListButton();
}

function _tplPanelRefreshSubtasks() {
    const box = document.getElementById('tpl-panel-subtasks');
    if (!box || !_tplPanelState) return;
    const subtasks = _tplPanelState.draft.task.subtasks || [];
    box.innerHTML = subtasks.map(function (st, i) {
        return '<div class="tpl-subtask-row subtask-item relative" data-index="' + i + '" ' +
                'onpointerdown="startTaskTemplateSubtaskHold(event, this, ' + i + ')">' +
            '<div class="flex items-center gap-2 py-1 group">' +
                '<span class="w-4 h-4 flex items-center justify-center flex-shrink-0"><i class="fas fa-layer-group text-purple-500 text-xs"></i></span>' +
                '<textarea rows="1" data-subtask-index="' + i + '" placeholder="输入子任务..." ' +
                    'class="tpl-subtask-input flex-1 bg-transparent border-none outline-none text-theme-primary resize-none overflow-hidden" ' +
                    'onkeydown="handleTaskTemplateSubtaskKeydown(event, ' + i + ')" ' +
                    'oninput="onTaskTemplateSubtaskInput(this, ' + i + ')">' + escapeHtml(st.text || '') + '</textarea>' +
                '<button type="button" class="tpl-subtask-delete" onclick="removeTaskTemplatePanelSubtask(' + i + ')" title="删除"><i class="fas fa-trash-alt text-xs"></i></button>' +
            '</div>' +
        '</div>';
    }).join('');
    box.querySelectorAll('textarea').forEach(function (ta) {
        _tplPanelAutoResizeSubtask(ta);
    });
    _tplPanelUpdateNotesPlaceholder();
}

function _tplPanelFill() {
    if (!_tplPanelState) return;
    const draft = _tplPanelState.draft;
    const nameEl = document.getElementById('tpl-panel-name');
    if (nameEl) {
        nameEl.value = draft.name;
        _tplPanelAutoResizeName(nameEl);
    }
    const notesEl = document.getElementById('tpl-panel-notes');
    if (notesEl) {
        notesEl.value = draft.task.mode === 'subtasks'
            ? (draft.task.description || '')
            : (draft.task.notes || '');
        _tplPanelAutoResizeNotes(notesEl);
    }
    _tplPanelUpdateNotesPlaceholder();
    const timeEl = document.getElementById('tpl-panel-time');
    if (timeEl) timeEl.value = draft.task.suggestedTime || '';
    const endTimeEl = document.getElementById('tpl-panel-end-time');
    if (endTimeEl) endTimeEl.value = draft.task.suggestedEndTime || '';
    ['tpl-panel-time-picker', 'tpl-panel-end-time-picker'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    _tplPanelRefreshTimeModeUi();
    _tplPanelRefreshTimeSummary();
    _tplPanelRefreshReminderText();
    _tplPanelRenderReminderOptions();
    _tplPanelInitRepeatPicker();
    _tplPanelRefreshPriority();
    _tplPanelRefreshTags();
    _tplPanelRefreshTagsDisplay();
    _tplPanelRefreshLists();
    _tplPanelRefreshSubtasks();
    _tplPanelRefreshActions();
    _tplPanelSetError('');
    const menu = document.getElementById('tpl-panel-time-menu');
    if (menu) menu.classList.add('hidden');
    const reminderPicker = document.getElementById('tpl-panel-reminder-picker');
    if (reminderPicker) reminderPicker.classList.add('hidden');
    const repeatPicker = document.getElementById('tpl-panel-repeat-picker');
    if (repeatPicker) repeatPicker.classList.add('hidden');
    const tagPicker = document.getElementById('tpl-panel-tag-picker');
    if (tagPicker) tagPicker.classList.add('hidden');
    const listPicker = document.getElementById('tpl-panel-list-picker');
    if (listPicker) listPicker.classList.add('hidden');
    const body = document.getElementById('tpl-panel-body');
    if (body) body.scrollTop = 0;
}

function _showTaskTemplatePanel(panel) {
    if (_tplPanelHideTimer) {
        clearTimeout(_tplPanelHideTimer);
        _tplPanelHideTimer = null;
    }
    panel.classList.remove('hidden');
    document.body.classList.add('tpl-panel-open');
    if (typeof settings !== 'undefined' && settings.smoothAnimations === true) {
        panel.classList.remove('panel-fade-out');
        panel.classList.remove('panel-fade-in');
        void panel.offsetWidth;
        panel.classList.add('panel-fade-in');
    } else {
        panel.classList.remove('panel-fade-in', 'panel-fade-out');
    }
    _scheduleTaskTemplateDetailFit(340);
}

function openTaskTemplatePanel(tplId, force) {
    const targetId = tplId || null;
    if (_tplPanelState) {
        if (!force && _tplPanelState.tplId === targetId) return;
        if (!force && !_tplPanelFlushBeforeClose()) return;
        closeTaskTemplatePanel(true);
    }
    const tpl = targetId ? getTaskTemplateById(targetId) : null;
    if (targetId && !tpl) {
        if (typeof showToast === 'function') showToast('模板不存在或已被删除', 'warning');
        return;
    }
    _ensureTaskTemplatesCss();
    const panel = _ensureTaskTemplatePanel();
    const originalRepeat = tpl && tpl.task && tpl.task.repeat
        ? JSON.parse(JSON.stringify(tpl.task.repeat))
        : null;
    _tplPanelState = {
        mode: tpl ? 'edit' : 'create',
        tplId: tpl ? tpl.id : null,
        draft: _tplPanelBuildDraft(tpl),
        originalRepeat: originalRepeat,
        rangeMode: !!(tpl && tpl.task && _templateNormalizeSuggestedTime(tpl.task.suggestedEndTime)),
        changed: false,
        escHandler: null
    };
    _tplPanelFill();
    _showTaskTemplatePanel(panel);
    const nameEl = document.getElementById('tpl-panel-name');
    if (nameEl) _tplPanelAutoResizeName(nameEl);
    const notesEl = document.getElementById('tpl-panel-notes');
    if (notesEl) _tplPanelAutoResizeNotes(notesEl);
    document.querySelectorAll('#tpl-panel-subtasks textarea').forEach(function (ta) {
        _tplPanelAutoResizeSubtask(ta);
    });
    if (typeof refreshTaskTemplatePanelNotesEditor === 'function') refreshTaskTemplatePanelNotesEditor();
    _tplPanelState.escHandler = function (e) {
        if (e.key !== 'Escape') return;
        const menu = document.getElementById('tpl-panel-time-menu');
        if (menu && !menu.classList.contains('hidden')) {
            menu.classList.add('hidden');
            return;
        }
        const reminderPicker = document.getElementById('tpl-panel-reminder-picker');
        if (reminderPicker && !reminderPicker.classList.contains('hidden')) {
            reminderPicker.classList.add('hidden');
            return;
        }
        const repeatPicker = document.getElementById('tpl-panel-repeat-picker');
        if (repeatPicker && !repeatPicker.classList.contains('hidden')) {
            repeatPicker.classList.add('hidden');
            return;
        }
        const tagPicker = document.getElementById('tpl-panel-tag-picker');
        if (tagPicker && !tagPicker.classList.contains('hidden')) {
            tagPicker.classList.add('hidden');
            return;
        }
        const listPicker = document.getElementById('tpl-panel-list-picker');
        if (listPicker && !listPicker.classList.contains('hidden')) {
            listPicker.classList.add('hidden');
            return;
        }
        closeTaskTemplatePanel();
    };
    document.addEventListener('keydown', _tplPanelState.escHandler);
    if (!tpl) {
        setTimeout(function () {
            const name = document.getElementById('tpl-panel-name');
            if (name) {
                name.focus();
                name.select();
            }
        }, 40);
    }
}

function _tplPanelUniqueName(base) {
    let name = base;
    let i = 2;
    while (getTaskTemplateByName(name)) {
        name = base + ' ' + i;
        i += 1;
    }
    return name;
}

function _tplPanelFlushBeforeClose() {
    if (!_tplPanelState) return true;
    // 行级编辑器先落定活动块（含输入法组合中的最后一段），再读 textarea 持久化
    if (typeof mdEditorCommit === 'function') mdEditorCommit({ render: false });
    if (_tplPanelSaveTimer) {
        clearTimeout(_tplPanelSaveTimer);
        _tplPanelSaveTimer = null;
    }
    const state = _tplPanelState;
    if (!state.changed) return true;
    if (!state.tplId) {
        if (!_tplPanelHasContent(state.draft)) return true;
        let name = String(state.draft.name || '').trim()
            || String(state.draft.task.title || '').trim()
            || '未命名模板';
        if (getTaskTemplateByName(name, null)) name = _tplPanelUniqueName(name);
        state.draft.name = name;
    }
    return _tplPanelPersist({ auto: true });
}

function closeTaskTemplatePanel(force) {
    // force=false 时先把草稿落盘；持久化失败（如重名）则保留面板与草稿，由调用方决定是否继续
    if (!force && !_tplPanelFlushBeforeClose()) return false;
    // 备注行级编辑器：先落定活动块再收起（自动保存失败保留面板时，编辑区仍保持激活）
    if (typeof mdEditorCommit === 'function') mdEditorCommit({ render: false });
    if (typeof mdDeactivateEditorForKind === 'function') mdDeactivateEditorForKind('template');
    if (_tplPanelSaveTimer) {
        clearTimeout(_tplPanelSaveTimer);
        _tplPanelSaveTimer = null;
    }
    const panel = document.getElementById('template-detail-panel');
    if (_tplPanelState && _tplPanelState.escHandler) {
        document.removeEventListener('keydown', _tplPanelState.escHandler);
    }
    _tplPanelState = null;
    document.body.classList.remove('tpl-panel-open');
    if (!panel) {
        return true;
    }
    if (typeof settings !== 'undefined' && settings.smoothAnimations === true && !panel.classList.contains('hidden')) {
        panel.classList.remove('panel-fade-in');
        panel.classList.add('panel-fade-out');
        if (_tplPanelHideTimer) clearTimeout(_tplPanelHideTimer);
        _tplPanelHideTimer = setTimeout(function () {
            _tplPanelHideTimer = null;
            panel.classList.remove('panel-fade-out');
            panel.classList.add('hidden');
        }, 200);
    } else {
        panel.classList.remove('panel-fade-in', 'panel-fade-out');
        panel.classList.add('hidden');
    }
    _scheduleTaskTemplateDetailFit(280);
    return true;
}

function guardLeaveTaskTemplates(targetView) {
    if (_tplPanelState && !closeTaskTemplatePanel()) return false;
    _teardownTaskTemplateDetailFit();
    return true;
}

function _tplPanelScheduleAutoSave() {
    if (!_tplPanelState) return;
    _tplPanelState.changed = true;
    if (_tplPanelSaveTimer) clearTimeout(_tplPanelSaveTimer);
    _tplPanelSaveTimer = setTimeout(function () {
        _tplPanelSaveTimer = null;
        _tplPanelPersist({ auto: true });
    }, _tplPanelAutoSaveDelay());
}

function flushTaskTemplatePanelAutoSave() {
    if (_tplPanelSaveTimer) {
        clearTimeout(_tplPanelSaveTimer);
        _tplPanelSaveTimer = null;
    }
    if (!_tplPanelState || !_tplPanelState.changed) return true;
    return _tplPanelPersist({ auto: true });
}

function _tplPanelPersist(options) {
    const state = _tplPanelState;
    if (!state) return false;
    const name = String(state.draft.name || '').trim();
    if (!name) {
        if (state.tplId) _tplPanelSetError('请填写模板名称');
        return false;
    }
    if (getTaskTemplateByName(name, state.tplId)) {
        _tplPanelSetError('已存在同名模板，请换一个名称');
        return false;
    }
    const list = state.draft.task.listId && typeof getList === 'function'
        ? getList(state.draft.task.listId)
        : null;
    const validTagIds = (settings.tags || []).map(function (tag) { return tag.id; });
    const tags = (state.draft.task.tags || []).filter(function (id) {
        return validTagIds.indexOf(id) !== -1;
    });
    const subtasks = (state.draft.task.subtasks || []).map(function (st, i) {
        return {
            text: String(st.text || '').trim(),
            completed: false,
            originalOrder: i,
            startTime: null,
            reminders: []
        };
    }).filter(function (st) { return st.text; });
    const taskMode = subtasks.length ? 'subtasks' : 'text';
    let taskNotes = state.draft.task.notes || '';
    let taskDescription = state.draft.task.description || '';
    if (taskMode === 'subtasks') {
        const subtaskText = subtasks.map(function (st) { return st.text; }).join('\n');
        if (!taskDescription && taskNotes && taskNotes.trim() !== subtaskText) {
            taskDescription = taskNotes; // 文本草稿新增子任务：原备注转为描述，避免被覆盖
        }
        taskNotes = subtaskText;
    }
    const task = {
        title: String(state.draft.task.title || '').trim() || name,
        notes: taskNotes,
        description: taskDescription,
        mode: taskMode,
        listId: _templateListSelectable(list) ? list.id : null,
        tags: tags,
        important: !!state.draft.task.important,
        urgent: !!state.draft.task.urgent,
        reminders: (state.draft.task.reminders || []).slice().sort(function (a, b) { return b - a; }),
        repeat: _normalizeTemplateRepeat(state.draft.task.repeat),
        suggestedTime: _templateNormalizeSuggestedTime(state.draft.task.suggestedTime),
        suggestedEndTime: _templateNormalizeSuggestedTime(state.draft.task.suggestedTime)
            ? _templateNormalizeSuggestedTime(state.draft.task.suggestedEndTime)
            : null,
        subtasks: subtasks
    };
    const now = new Date().toISOString();
    let tpl;
    if (state.tplId) {
        tpl = getTaskTemplateById(state.tplId);
        if (!tpl) {
            _tplPanelSetError('模板已被删除，可新建一个模板');
            return false;
        }
        tpl.name = name;
        tpl.task = task;
        tpl.updatedAt = now;
    } else {
        tpl = { id: _templateId(), name: name, createdAt: now, updatedAt: now, task: task };
        getTaskTemplates().push(tpl);
        state.tplId = tpl.id;
        state.mode = 'edit';
        _tplPageFlashId = tpl.id;
        _tplPanelRefreshActions();
    }
    state.draft.task.mode = taskMode;
    state.draft.task.notes = taskNotes;
    state.draft.task.description = taskDescription;
    saveData();
    refreshTaskTemplatesUi();
    state.originalRepeat = task.repeat ? JSON.parse(JSON.stringify(task.repeat)) : null;
    state.changed = false;
    _tplPanelSetError('');
    return true;
}

// ==================== 面板：时间 / 提醒 / 重复 ====================

function toggleTaskTemplatePanelTimeMenu() {
    const menu = document.getElementById('tpl-panel-time-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
}

function onTaskTemplatePanelTimeChange() {
    if (!_tplPanelState) return;
    const input = document.getElementById('tpl-panel-time');
    _tplPanelState.draft.task.suggestedTime = _templateNormalizeSuggestedTime(input ? input.value : '');
    _tplPanelRefreshTimeSummary();
    _tplPanelScheduleAutoSave();
}

function onTaskTemplatePanelEndTimeChange() {
    if (!_tplPanelState) return;
    const input = document.getElementById('tpl-panel-end-time');
    _tplPanelState.draft.task.suggestedEndTime = _templateNormalizeSuggestedTime(input ? input.value : '');
    _tplPanelRefreshTimeSummary();
    _tplPanelScheduleAutoSave();
}

function toggleTaskTemplatePanelTimeRange() {
    if (!_tplPanelState) return;
    _tplPanelState.rangeMode = !_tplPanelState.rangeMode;
    const endInput = document.getElementById('tpl-panel-end-time');
    if (_tplPanelState.rangeMode) {
        if (_tplPanelState.draft.task.suggestedTime && !_tplPanelState.draft.task.suggestedEndTime) {
            const prefilled = _tplPanelAddMinutes(_tplPanelState.draft.task.suggestedTime, 30);
            _tplPanelState.draft.task.suggestedEndTime = prefilled || null;
            if (endInput) endInput.value = prefilled || '';
        }
    } else {
        _tplPanelState.draft.task.suggestedEndTime = null;
        if (endInput) endInput.value = '';
    }
    _tplPanelRefreshTimeModeUi();
    _tplPanelRefreshTimeSummary();
    _tplPanelScheduleAutoSave();
}

function clearTaskTemplatePanelTime() {
    if (!_tplPanelState) return;
    _tplPanelState.draft.task.suggestedTime = null;
    _tplPanelState.draft.task.suggestedEndTime = null;
    _tplPanelState.rangeMode = false;
    const input = document.getElementById('tpl-panel-time');
    if (input) input.value = '';
    const endInput = document.getElementById('tpl-panel-end-time');
    if (endInput) endInput.value = '';
    _tplPanelRefreshTimeModeUi();
    _tplPanelRefreshTimeSummary();
    _tplPanelScheduleAutoSave();
}

function toggleTaskTemplatePanelReminderPicker() {
    const picker = document.getElementById('tpl-panel-reminder-picker');
    if (!picker) return;
    const repeatPicker = document.getElementById('tpl-panel-repeat-picker');
    if (repeatPicker) repeatPicker.classList.add('hidden');
    const willOpen = picker.classList.contains('hidden');
    picker.classList.toggle('hidden');
    if (willOpen) _tplPanelRenderReminderOptions();
}

function addTaskTemplatePanelCustomReminder() {
    if (!_tplPanelState) return;
    const input = document.getElementById('tpl-panel-custom-reminder');
    const val = input ? parseInt(input.value, 10) : NaN;
    const cur = _tplPanelState.draft.task.reminders || [];
    const reject = function (msg) {
        if (input) {
            input.classList.add('border-red-500');
            setTimeout(function () { input.classList.remove('border-red-500'); }, 1200);
        }
        if (msg && typeof showToast === 'function') showToast(msg, 'warning');
    };
    if (isNaN(val) || val < 1 || val > REMINDER_MAX_MINUTES) {
        reject('请输入 1 ~ ' + REMINDER_MAX_MINUTES + ' 之间的分钟数');
        return;
    }
    if (cur.indexOf(val) !== -1) {
        reject('该提前量已存在');
        return;
    }
    if (cur.length >= REMINDER_MAX_COUNT) {
        if (typeof shakeReminderLimit === 'function') shakeReminderLimit(document.getElementById('tpl-panel-reminder-picker'));
        if (typeof showToast === 'function') showToast('最多 ' + REMINDER_MAX_COUNT + ' 个提前提醒', 'warning');
        return;
    }
    _tplPanelState.draft.task.reminders = normalizeReminderMinutes(cur.concat([val]));
    if (input) input.value = '';
    _tplPanelRefreshReminderText();
    _tplPanelRefreshTimeSummary();
    _tplPanelRenderReminderOptions();
    _tplPanelScheduleAutoSave();
}

function toggleTaskTemplatePanelRepeatPicker() {
    const picker = document.getElementById('tpl-panel-repeat-picker');
    if (!picker) return;
    const reminderPicker = document.getElementById('tpl-panel-reminder-picker');
    if (reminderPicker) reminderPicker.classList.add('hidden');
    const willOpen = picker.classList.contains('hidden');
    picker.classList.toggle('hidden');
    if (willOpen) _tplPanelInitRepeatPicker();
}

function onTaskTemplatePanelRepeatChange() {
    if (!_tplPanelState) return;
    _tplPanelRefreshRepeatText(true);
}


// ==================== 面板：正文 / 底部操作 ====================

function onTaskTemplatePanelNameInput(el) {
    if (!_tplPanelState) return;
    const value = el ? el.value : '';
    const draft = _tplPanelState.draft;
    // 标题原本与模板名同步时才跟随改名；独立标题（如内置预置）保持不变
    const titleWasSynced = _templateNameKey(draft.task.title) === _templateNameKey(draft.name);
    draft.name = value;
    if (titleWasSynced || !String(draft.task.title || '').trim()) draft.task.title = value;
    _tplPanelAutoResizeName(el);
    _tplPanelSetError('');
    _tplPanelScheduleAutoSave();
}


function onTaskTemplatePanelNotesInput(el) {
    if (!_tplPanelState) return;
    const value = el ? el.value : '';
    if (_tplPanelState.draft.task.mode === 'subtasks') {
        _tplPanelState.draft.task.description = value;
    } else {
        _tplPanelState.draft.task.notes = value;
    }
    _tplPanelAutoResizeNotes(el);
    _tplPanelScheduleAutoSave();
}

function toggleTaskTemplatePanelPriority(key) {
    if (!_tplPanelState) return;
    if (key === 'important') _tplPanelState.draft.task.important = !_tplPanelState.draft.task.important;
    if (key === 'urgent') _tplPanelState.draft.task.urgent = !_tplPanelState.draft.task.urgent;
    _tplPanelRefreshPriority();
    _tplPanelScheduleAutoSave();
}

function openTaskTemplatePanelTagPicker() {
    const picker = document.getElementById('tpl-panel-tag-picker');
    const listPicker = document.getElementById('tpl-panel-list-picker');
    if (!picker) return;
    _cancelHoverPickerClose('tpl-panel-tag-picker');
    _cancelHoverPickerClose('tpl-panel-list-picker');
    if (listPicker) listPicker.classList.add('hidden');
    if (!picker.classList.contains('hidden')) return;
    picker.classList.remove('hidden');
    _tplPanelRefreshTags();
}

function closeTaskTemplatePanelTagPicker() {
    const picker = document.getElementById('tpl-panel-tag-picker');
    if (!picker) return;
    _cancelHoverPickerClose('tpl-panel-tag-picker');
    picker.classList.add('hidden');
}

function toggleTaskTemplatePanelTagPicker() {
    const picker = document.getElementById('tpl-panel-tag-picker');
    if (!picker) return;
    if (picker.classList.contains('hidden')) {
        openTaskTemplatePanelTagPicker();
    } else if (!_hoverPickerOpenedForClick('tpl-panel-tag-picker')) {
        closeTaskTemplatePanelTagPicker();
    }
}

function openTaskTemplatePanelListPicker() {
    const picker = document.getElementById('tpl-panel-list-picker');
    const tagPicker = document.getElementById('tpl-panel-tag-picker');
    if (!picker) return;
    _cancelHoverPickerClose('tpl-panel-list-picker');
    _cancelHoverPickerClose('tpl-panel-tag-picker');
    if (tagPicker) tagPicker.classList.add('hidden');
    if (!picker.classList.contains('hidden')) return;
    picker.classList.remove('hidden');
    _tplPanelRefreshLists();
}

function closeTaskTemplatePanelListPicker() {
    const picker = document.getElementById('tpl-panel-list-picker');
    if (!picker) return;
    _cancelHoverPickerClose('tpl-panel-list-picker');
    picker.classList.add('hidden');
}

function toggleTaskTemplatePanelListPicker() {
    const picker = document.getElementById('tpl-panel-list-picker');
    if (!picker) return;
    if (picker.classList.contains('hidden')) {
        openTaskTemplatePanelListPicker();
    } else if (!_hoverPickerOpenedForClick('tpl-panel-list-picker')) {
        closeTaskTemplatePanelListPicker();
    }
}

function toggleTaskTemplatePanelTag(tagId, btn) {
    if (!_tplPanelState) return;
    const tags = _tplPanelState.draft.task.tags;
    const index = tags.indexOf(tagId);
    if (index === -1) tags.push(tagId);
    else tags.splice(index, 1);
    const on = tags.indexOf(tagId) !== -1;
    if (btn) {
        btn.classList.toggle('detail-tag-pill-selected', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    } else {
        _tplPanelRefreshTags();
    }
    _tplPanelRefreshTagsDisplay();
    _tplPanelScheduleAutoSave();
}

function removeTaskTemplatePanelTag(tagId) {
    if (!_tplPanelState) return;
    const tags = _tplPanelState.draft.task.tags;
    const index = tags.indexOf(tagId);
    if (index === -1) return;
    tags.splice(index, 1);
    _tplPanelRefreshTags();
    _tplPanelRefreshTagsDisplay();
    _tplPanelScheduleAutoSave();
}

function setTaskTemplatePanelList(listId) {
    if (!_tplPanelState) return;
    if (listId) {
        const list = typeof getList === 'function' ? getList(listId) : null;
        _tplPanelState.draft.task.listId = _templateListSelectable(list) ? listId : null;
    } else {
        _tplPanelState.draft.task.listId = null;
    }
    _tplPanelRefreshLists();
    const picker = document.getElementById('tpl-panel-list-picker');
    if (picker) picker.classList.add('hidden');
    _tplPanelScheduleAutoSave();
}

// ==================== 面板：子任务编辑 ====================

function onTaskTemplateSubtaskInput(el, index) {
    if (!_tplPanelState) return;
    const item = _tplPanelState.draft.task.subtasks[index];
    if (!item) return;
    item.text = el ? el.value : '';
    _tplPanelAutoResizeSubtask(el);
    _tplPanelUpdateNotesPlaceholder();
    _tplPanelScheduleAutoSave();
}

function _tplPanelFocusSubtask(index, caret) {
    setTimeout(function () {
        const inputs = document.querySelectorAll('#tpl-panel-subtasks textarea');
        const input = inputs[index];
        if (!input) return;
        input.focus();
        const pos = (caret === 'end') ? input.value.length : (typeof caret === 'number' ? caret : 0);
        input.setSelectionRange(pos, pos);
    }, 10);
}

function handleTaskTemplateSubtaskKeydown(event, index) {
    if (!_tplPanelState) return;
    const subtasks = _tplPanelState.draft.task.subtasks;
    const item = subtasks[index];
    if (!item) return;
    const input = event.target;
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const cursorPos = input.selectionStart;
        const before = input.value.substring(0, cursorPos);
        const after = input.value.substring(cursorPos);
        item.text = before;
        subtasks.splice(index + 1, 0, {
            text: after,
            completed: false,
            originalOrder: index + 1,
            startTime: null,
            reminders: []
        });
        subtasks.forEach(function (st, i) { st.originalOrder = i; });
        _tplPanelRefreshSubtasks();
        _tplPanelFocusSubtask(index + 1, 0);
        _tplPanelScheduleAutoSave();
    } else if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        const inputs = document.querySelectorAll('#tpl-panel-subtasks textarea');
        if (index < inputs.length - 1) {
            const next = inputs[index + 1];
            next.focus();
            next.setSelectionRange(next.value.length, next.value.length);
        } else {
            subtasks.push({
                text: '',
                completed: false,
                originalOrder: subtasks.length,
                startTime: null,
                reminders: []
            });
            _tplPanelRefreshSubtasks();
            _tplPanelFocusSubtask(subtasks.length - 1, 0);
            _tplPanelScheduleAutoSave();
        }
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && input.selectionStart === input.selectionEnd) {
        const currentLine = input.value.substring(0, input.selectionStart).split('\n').length;
        const totalLines = input.value.split('\n').length;
        const atFirstLine = event.key === 'ArrowUp' && currentLine === 1;
        const atLastLine = event.key === 'ArrowDown' && currentLine === totalLines;
        if (atFirstLine || atLastLine) {
            const targetIndex = atFirstLine ? index - 1 : index + 1;
            if (targetIndex >= 0 && targetIndex < subtasks.length) {
                event.preventDefault();
                event.stopPropagation();
                _tplPanelFocusSubtask(targetIndex, 'end');
            }
        }
    } else if (event.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0) {
        if (index > 0) {
            event.preventDefault();
            event.stopPropagation();
            const prev = subtasks[index - 1];
            const mergePos = (prev.text || '').length;
            prev.text = (prev.text || '') + (input.value || '');
            subtasks.splice(index, 1);
            subtasks.forEach(function (st, i) { st.originalOrder = i; });
            _tplPanelRefreshSubtasks();
            _tplPanelFocusSubtask(index - 1, mergePos);
            _tplPanelScheduleAutoSave();
        } else if (subtasks.length > 1) {
            event.preventDefault();
            event.stopPropagation();
            subtasks.splice(index, 1);
            subtasks.forEach(function (st, i) { st.originalOrder = i; });
            _tplPanelRefreshSubtasks();
            _tplPanelFocusSubtask(0, 0);
            _tplPanelScheduleAutoSave();
        }
    }
}

function removeTaskTemplatePanelSubtask(index) {
    if (!_tplPanelState) return;
    const subtasks = _tplPanelState.draft.task.subtasks;
    if (index < 0 || index >= subtasks.length) return;
    subtasks.splice(index, 1);
    if (subtasks.length === 0) {
        subtasks.push({ text: '', completed: false, originalOrder: 0, startTime: null, reminders: [] });
    }
    subtasks.forEach(function (st, i) { st.originalOrder = i; });
    _tplPanelRefreshSubtasks();
    _tplPanelScheduleAutoSave();
}

// 长按拖拽子任务（桌面指针设备；触摸端保持原生滚动，与任务详情一致）
function _cancelTaskTemplateSubtaskHold() {
    if (_tplPanelSubtaskHoldTimer) {
        clearTimeout(_tplPanelSubtaskHoldTimer);
        _tplPanelSubtaskHoldTimer = null;
    }
    if (_tplPanelSubtaskHintTimer) {
        clearTimeout(_tplPanelSubtaskHintTimer);
        _tplPanelSubtaskHintTimer = null;
    }
    if (_tplPanelSubtaskHoldRow) {
        _tplPanelSubtaskHoldRow.classList.remove('subtask-holding');
        _tplPanelSubtaskHoldRow = null;
    }
}

function _endTaskTemplateSubtaskDrag() {
    _cancelTaskTemplateSubtaskHold();
    if (_tplPanelSubtaskDragRow) {
        _tplPanelSubtaskDragRow.classList.remove('subtask-drag-ready');
        try {
            if (_tplPanelSubtaskDragPointerId !== null && _tplPanelSubtaskDragRow.hasPointerCapture(_tplPanelSubtaskDragPointerId)) {
                _tplPanelSubtaskDragRow.releasePointerCapture(_tplPanelSubtaskDragPointerId);
            }
        } catch (err) {}
    }
    _tplPanelSubtaskDragActive = false;
    _tplPanelSubtaskDragRow = null;
    _tplPanelSubtaskDragPointerId = null;
    _tplPanelSubtaskDragRects = [];
    _tplPanelSubtaskDragTarget = null;
    if (typeof clearSubtaskHighlight === 'function') clearSubtaskHighlight();
}

function _startTaskTemplateSubtaskDrag(row, index) {
    if (!_tplPanelState) return;
    _tplPanelSubtaskDragActive = true;
    _tplPanelSubtaskDragRow = row;
    _tplPanelSubtaskDragIndex = index;
    _tplPanelSubtaskDragPointerId = _tplPanelSubtaskHoldPointerId;
    _tplPanelSubtaskDragTarget = null;
    if (_tplPanelSubtaskHintTimer) {
        clearTimeout(_tplPanelSubtaskHintTimer);
        _tplPanelSubtaskHintTimer = null;
    }
    row.classList.remove('subtask-holding');
    row.classList.add('subtask-drag-ready');
    try {
        if (_tplPanelSubtaskDragPointerId !== null) row.setPointerCapture(_tplPanelSubtaskDragPointerId);
    } catch (err) {}
    const ta = row.querySelector('textarea');
    if (ta) ta.blur();
    if (window.getSelection) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
    }
    _tplPanelSubtaskDragRects = [];
    document.querySelectorAll('#tpl-panel-subtasks .tpl-subtask-row').forEach(function (el) {
        const r = el.getBoundingClientRect();
        _tplPanelSubtaskDragRects.push({
            el: el,
            index: parseInt(el.dataset.index, 10),
            top: r.top,
            bottom: r.bottom,
            midY: r.top + r.height / 2
        });
    });
}

function _updateTaskTemplateSubtaskDrag(clientY) {
    if (!_tplPanelSubtaskDragActive) return;
    if (window.getSelection) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
    }
    const hit = _tplPanelSubtaskDragRects.find(function (r) {
        return clientY >= r.top && clientY <= r.bottom;
    });
    if (!hit || hit.el === _tplPanelSubtaskDragRow) {
        _tplPanelSubtaskDragTarget = null;
        if (typeof clearSubtaskHighlight === 'function') clearSubtaskHighlight();
        return;
    }
    _tplPanelSubtaskDragTarget = {
        index: hit.index,
        insertAfter: clientY >= hit.midY
    };
    if (typeof applySubtaskHighlight === 'function') {
        applySubtaskHighlight(hit.el, clientY >= hit.midY ? 'bottom' : 'top');
    }
}

function _finishTaskTemplateSubtaskDrag() {
    const from = _tplPanelSubtaskDragIndex;
    const target = _tplPanelSubtaskDragTarget;
    const subtasks = _tplPanelState ? _tplPanelState.draft.task.subtasks : null;
    _endTaskTemplateSubtaskDrag();
    if (!subtasks || from < 0 || !target || target.index === from) return;
    const item = subtasks.splice(from, 1)[0];
    let insert = target.index;
    if (from < insert) insert -= 1;
    insert += target.insertAfter ? 1 : 0;
    insert = Math.max(0, Math.min(subtasks.length, insert));
    subtasks.splice(insert, 0, item);
    subtasks.forEach(function (st, i) { st.originalOrder = i; });
    _tplPanelRefreshSubtasks();
    _tplPanelScheduleAutoSave();
}

function startTaskTemplateSubtaskHold(e, row, index) {
    if (!_tplPanelState) return;
    if (e.pointerType === 'touch') return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button')) return;
    _cancelTaskTemplateSubtaskHold();
    _tplPanelSubtaskHoldRow = row;
    _tplPanelSubtaskHoldIndex = index;
    _tplPanelSubtaskHoldPointerId = e.pointerId;
    _tplPanelSubtaskHoldStartX = e.clientX;
    _tplPanelSubtaskHoldStartY = e.clientY;
    _tplPanelSubtaskHintTimer = setTimeout(function () {
        _tplPanelSubtaskHintTimer = null;
        if (_tplPanelSubtaskHoldRow === row) row.classList.add('subtask-holding');
    }, 150);
    _tplPanelSubtaskHoldTimer = setTimeout(function () {
        _tplPanelSubtaskHoldTimer = null;
        _startTaskTemplateSubtaskDrag(row, index);
    }, 300);
}




if (!window.__tplSubtaskDragBound) {
    window.__tplSubtaskDragBound = true;
    document.addEventListener('pointermove', function (e) {
        if (_tplPanelSubtaskDragActive) {
            if (e.pointerId !== _tplPanelSubtaskDragPointerId) return;
            if (!(e.buttons & 1)) { _endTaskTemplateSubtaskDrag(); return; }
            _updateTaskTemplateSubtaskDrag(e.clientY);
            return;
        }
        if (!_tplPanelSubtaskHoldTimer) return;
        if (Math.abs(e.clientX - _tplPanelSubtaskHoldStartX) > 6
            || Math.abs(e.clientY - _tplPanelSubtaskHoldStartY) > 6) {
            _cancelTaskTemplateSubtaskHold();
        }
    }, { passive: true });
    document.addEventListener('pointerup', function () {
        if (_tplPanelSubtaskDragActive) _finishTaskTemplateSubtaskDrag();
        else _cancelTaskTemplateSubtaskHold();
    });
    document.addEventListener('pointercancel', function () {
        if (_tplPanelSubtaskDragActive) _endTaskTemplateSubtaskDrag();
        else _cancelTaskTemplateSubtaskHold();
    });
    document.addEventListener('wheel', function () {
        if (_tplPanelSubtaskDragActive) _endTaskTemplateSubtaskDrag();
    }, { passive: true });
}

// ==================== 详情面板入口状态 ====================

function updateDetailTemplateEntry(task) {
    const btn = document.getElementById('detail-save-template-btn');
    if (!btn) return;
    const readonly = (typeof detailReadOnly !== 'undefined' && detailReadOnly);
    const hidden = !task || task.extSourceId || readonly;
    btn.style.display = hidden ? 'none' : '';
    if (hidden) return;
    const tpl = task.templateId ? getTaskTemplateById(task.templateId) : null;
    const label = tpl ? '更新模板「' + tpl.name + '」' : '存为模板';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.classList.toggle('is-linked', !!tpl);
}

// ==================== 内置预置模板 ====================

// 预置模板改版号：改动 TEMPLATE_PRESETS 后必须 +1。
// 升级时 seedTaskTemplatesIfNeeded() 按 presetKey / 旧版内容指纹做非破坏性迁移：
// 只更新未被用户改过的旧预置，自建模板与改过的模板一律保留。
// 「重置数据」才调用 resetTaskTemplatesToPresets() 整体还原。
const TEMPLATE_PRESET_VERSION = 4;

// 预置主题固定为 3 个日常工作模板：周报 / 会议纪要 / 项目复盘
// 备注骨架使用 Markdown（详情面板按行级 Markdown 渲染）
const TEMPLATE_PRESETS = [
    {
        presetKey: 'weekly-report',
        name: '周报',
        task: {
            title: '本周周报',
            notes: '## 本周完成\n- **重点产出**：\n- **关键数据**：\n\n## 下周计划\n- **核心目标**：\n- **需要的支持**：\n\n## 风险与需要的支持\n- **风险**：\n- **应对方案**：',
            important: true,
            urgent: false,
            reminders: [60],
            suggestedTime: '17:00',
            repeat: { type: 'weekly' },
            subtasks: [
                { text: '汇总本周产出', completed: false, originalOrder: 0 },
                { text: '整理下周计划', completed: false, originalOrder: 1 }
            ]
        }
    },
    {
        presetKey: 'meeting-notes',
        name: '会议纪要',
        task: {
            title: '会议纪要',
            notes: '## 议题\n- 议题 1\n- 议题 2\n\n## 结论\n- 结论 1\n\n## 待办与责任人\n- [ ] 事项 —— 负责人 / 截止时间\n\n## 下次会议\n- **时间**：\n- **议题**：',
            important: false,
            urgent: false,
            // 会议时间不固定，模板不写死时刻：建成全天任务，由用户按会议时段补时间
            reminders: [],
            subtasks: [
                { text: '会前确认议题与参会人', completed: false, originalOrder: 0 },
                { text: '记录讨论结论与待办', completed: false, originalOrder: 1 },
                { text: '同步纪要并跟进待办', completed: false, originalOrder: 2 }
            ]
        }
    },
    {
        presetKey: 'project-review',
        name: '项目复盘',
        task: {
            title: '项目复盘',
            notes: '## 目标与结果\n- **原定目标**：\n- **实际结果**：\n\n## 关键节点\n1. 启动：\n2. 交付：\n\n## 遇到的问题\n- **问题**：\n- **根因**：\n\n## 下一步行动\n- [ ] 待办 —— 负责人 / 截止时间',
            important: true,
            urgent: false,
            reminders: [60],
            suggestedTime: '16:00',
            subtasks: [
                { text: '对比目标与实际结果', completed: false, originalOrder: 0 },
                { text: '回顾关键节点与决策', completed: false, originalOrder: 1 },
                { text: '整理经验与教训', completed: false, originalOrder: 2 },
                { text: '列出下一步行动项', completed: false, originalOrder: 3 }
            ]
        }
    }
];

// 旧版预置（v3）的内容登记：旧数据没有 presetKey，只能按内容指纹识别「未被用户改过」的预置。
// 更早的预置（每日站会 / 购物清单 等）没有登记在这里，迁移时一律保留，不做自动删除。
const LEGACY_TEMPLATE_PRESETS = [
    {
        presetKey: 'weekly-report',
        name: '周报',
        task: {
            title: '本周周报',
            notes: '本周完成\n\n下周计划\n\n风险与需要的支持',
            important: true,
            urgent: false,
            reminders: [60],
            suggestedTime: '17:00',
            repeat: { type: 'weekly' },
            subtasks: [
                { text: '汇总本周产出' },
                { text: '整理下周计划' }
            ]
        }
    },
    {
        presetKey: 'meeting-notes',
        name: '会议纪要',
        task: {
            title: '会议纪要',
            notes: '议题\n\n结论\n\n待办与责任人\n\n下次会议',
            important: false,
            urgent: false,
            reminders: [],
            subtasks: [
                { text: '会前确认议题与参会人' },
                { text: '记录讨论结论与待办' },
                { text: '同步纪要并跟进待办' }
            ]
        }
    },
    {
        presetKey: 'project-review',
        name: '项目复盘',
        task: {
            title: '项目复盘',
            notes: '目标与结果\n\n关键节点\n\n遇到的问题\n\n下一步行动',
            important: true,
            urgent: false,
            reminders: [60],
            suggestedTime: '16:00',
            subtasks: [
                { text: '对比目标与实际结果' },
                { text: '回顾关键节点与决策' },
                { text: '整理经验与教训' },
                { text: '列出下一步行动项' }
            ]
        }
    }
];

// 按当前预置生成一套全新模板（每次重新分配 id，避免重建后旧引用残留）
function buildPresetTaskTemplates() {
    const now = new Date().toISOString();
    return TEMPLATE_PRESETS.map(function (p) {
        const tpl = {
            id: _templateId(),
            presetKey: p.presetKey,
            name: p.name,
            createdAt: now,
            updatedAt: now,
            task: JSON.parse(JSON.stringify(p.task))
        };
        // 记录「应用时的预置指纹」：后续改版只要用户没改过内容，就能继续升级
        tpl.presetFingerprint = _templatePresetFingerprint(tpl);
        return tpl;
    });
}

// 把模板列表还原为出厂预置（仅「重置数据」使用）。
// 只改内存，持久化由调用方的 saveData/saveDataImmediate 负责。
function resetTaskTemplatesToPresets() {
    taskTemplates = buildPresetTaskTemplates();
    settings.taskTemplatesSeeded = true;
    settings.taskTemplatesPresetVersion = TEMPLATE_PRESET_VERSION;
    return taskTemplates.length;
}

// 清理历史模板里的 dailyWorkday / yearlyBeforeHoliday 写法（重复引擎不识别这两种 type）
function _normalizeStoredTemplateRepeats() {
    getTaskTemplates().forEach(function (tpl) {
        if (!tpl || !tpl.task || !tpl.task.repeat) return;
        const before = JSON.stringify(tpl.task.repeat);
        const after = _normalizeTemplateRepeat(tpl.task.repeat);
        if (JSON.stringify(after) !== before) tpl.task.repeat = after;
    });
}

function _templateStableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return '[' + value.map(_templateStableStringify).join(',') + ']';
    }
    return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + _templateStableStringify(value[key]);
    }).join(',') + '}';
}

// 只比较模板的可编辑内容，忽略 id / 时间戳 / 使用统计 / mode 等派生字段。
// 这样打开过编辑面板（字段被规范化）不会误判成修改，真正改过内容才会失配。
// ⚠️ 修改这里的字段集合会使已存的 presetFingerprint 全部失配（旧预置会被当作已修改保留），
//    需要同时提供哈希版本或迁移逻辑。
function _templatePresetFingerprint(tplOrPreset) {
    const source = tplOrPreset || {};
    const task = source.task || {};
    const normalizeText = function (value) {
        return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
    };
    const reminders = _templateRemindersOf(task).slice().sort(function (a, b) { return b - a; });
    const payload = {
        name: normalizeText(source.name),
        title: normalizeText(task.title),
        notes: normalizeText(task.notes),
        description: normalizeText(task.description),
        listId: task.listId || null,
        tags: Array.isArray(task.tags) ? task.tags.slice().sort() : [],
        important: !!task.important,
        urgent: !!task.urgent,
        reminders: reminders,
        repeat: _normalizeTemplateRepeat(task.repeat),
        suggestedTime: _templateNormalizeSuggestedTime(task.suggestedTime),
        suggestedEndTime: _templateNormalizeSuggestedTime(task.suggestedEndTime),
        subtasks: (Array.isArray(task.subtasks) ? task.subtasks : [])
            .filter(function (st) { return st && normalizeText(st.text); })
            .map(function (st) { return normalizeText(st.text); })
    };
    return _templateStableStringify(payload);
}

let _legacyPresetFingerprintMap = null;

function _getLegacyPresetFingerprints() {
    if (_legacyPresetFingerprintMap) return _legacyPresetFingerprintMap;
    _legacyPresetFingerprintMap = {};
    LEGACY_TEMPLATE_PRESETS.forEach(function (preset) {
        if (!preset || !preset.presetKey) return;
        if (!_legacyPresetFingerprintMap[preset.presetKey]) {
            _legacyPresetFingerprintMap[preset.presetKey] = [];
        }
        _legacyPresetFingerprintMap[preset.presetKey].push(_templatePresetFingerprint(preset));
    });
    return _legacyPresetFingerprintMap;
}

// 非破坏性预置迁移：
// - 带 presetKey 的模板优先按 key 定位；旧数据按旧版内置签名定位；
// - 有 presetFingerprint 的模板以「内容是否仍等于应用时指纹」判断，没有的按内置签名判断；
// - 只有未被用户改过的模板才会被更新，自建 / 改过的一律保留；
// - 不删除任何模板；同内容的多条只在最早的一条上迁移，其余副本保持原样。
function _migrateTaskTemplatesPresets() {
    const list = getTaskTemplates();
    if (!list.length) return false;
    const legacyMap = _getLegacyPresetFingerprints();
    const now = new Date().toISOString();
    let changed = false;

    TEMPLATE_PRESETS.forEach(function (preset) {
        if (!preset || !preset.presetKey) return;
        const currentFingerprint = _templatePresetFingerprint(preset);
        const knownFingerprints = [currentFingerprint].concat(legacyMap[preset.presetKey] || []);
        // 没有指纹字段的旧模板只能按内置签名识别；有指纹的模板以「内容是否仍等于应用时的指纹」为准，
        // 这样后续预置改版不必把上一版定义再登记一次。
        const isUnmodified = function (tpl) {
            const fingerprint = _templatePresetFingerprint(tpl);
            const stored = typeof tpl.presetFingerprint === 'string' ? tpl.presetFingerprint : '';
            if (stored) return fingerprint === stored;
            return knownFingerprints.indexOf(fingerprint) !== -1;
        };

        let candidates = list.filter(function (tpl) {
            return tpl && tpl.presetKey === preset.presetKey;
        });
        if (!candidates.length) {
            candidates = list.filter(function (tpl) {
                return tpl && !tpl.presetKey && !tpl.presetFingerprint && isUnmodified(tpl);
            });
        }
        const unmodified = candidates.filter(isUnmodified);
        if (!unmodified.length) return;

        unmodified.sort(function (a, b) {
            const ta = Date.parse(a.createdAt) || 0;
            const tb = Date.parse(b.createdAt) || 0;
            if (ta !== tb) return ta - tb;
            return list.indexOf(a) - list.indexOf(b);
        });
        const target = unmodified[0];
        const targetFingerprint = _templatePresetFingerprint(target);
        const contentChanged = targetFingerprint !== currentFingerprint;
        // 出现同名模板时整条跳过，避免改名冲突，也避免写入与实际内容不一致的指纹
        if (contentChanged && list.some(function (tpl) {
            return tpl !== target && _templateNameKey(tpl.name) === _templateNameKey(preset.name);
        })) return;

        let targetChanged = false;
        if (target.presetKey !== preset.presetKey) {
            target.presetKey = preset.presetKey;
            targetChanged = true;
        }
        if (target.presetFingerprint !== currentFingerprint) {
            target.presetFingerprint = currentFingerprint;
            targetChanged = true;
        }
        if (contentChanged) {
            target.name = preset.name;
            target.task = JSON.parse(JSON.stringify(preset.task));
            target.updatedAt = now;
            targetChanged = true;
        }
        if (targetChanged) changed = true;
    });

    return changed;
}

function seedTaskTemplatesIfNeeded() {
    let changed = false;
    const presetVersion = parseInt(settings.taskTemplatesPresetVersion, 10) || 0;

    if (getTaskTemplates().length === 0 && !settings.taskTemplatesSeeded) {
        // 首次安装（或从未播种过）：生成当前 3 个预置
        taskTemplates = buildPresetTaskTemplates();
        settings.taskTemplatesSeeded = true;
        settings.taskTemplatesPresetVersion = TEMPLATE_PRESET_VERSION;
        changed = true;
    } else {
        // 升级 / 导入 / 日常启动：只按稳定 key 更新未被用户改过的旧预置，绝不整体重建
        if (_migrateTaskTemplatesPresets()) changed = true;
        if (presetVersion < TEMPLATE_PRESET_VERSION) {
            settings.taskTemplatesPresetVersion = TEMPLATE_PRESET_VERSION;
            changed = true;
        }
        if (!settings.taskTemplatesSeeded) {
            settings.taskTemplatesSeeded = true;
            changed = true;
        }
    }
    if (!settings.taskTemplatesRepeatNormalizedV1) {
        settings.taskTemplatesRepeatNormalizedV1 = true;
        changed = true;
        _normalizeStoredTemplateRepeats();
    }
    if (changed) saveData();
}

// 命令面板 `*` 入口：按名称前缀匹配模板（前缀优先，其次包含）
function findTemplatesByQuery(query) {
    const q = (query || '').trim().toLowerCase();
    const list = getTaskTemplates();
    if (!q) return list.slice();
    const prefix = [];
    const contains = [];
    list.forEach(function (t) {
        const n = (t.name || '').toLowerCase();
        if (n.startsWith(q)) prefix.push(t);
        else if (n.indexOf(q) !== -1) contains.push(t);
    });
    return prefix.concat(contains);
}
