// ==================== 命令面板 & NLP 快速添加 (FR-27 / FR-28) ====================

let _commandPaletteOpen = false;

// ==================== 命令面板 UI ====================

function openCommandPalette() {
    if (_commandPaletteOpen) return;
    _commandPaletteOpen = true;

    // 移除已有面板
    const existing = document.getElementById('command-palette-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'command-palette-overlay';
    overlay.className = 'fixed inset-0 z-50 flex items-start justify-center pt-[15vh]';
    overlay.style.background = 'rgba(0,0,0,0.45)';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.onclick = function(e) {
        if (e.target === overlay) closeCommandPalette();
    };

    const palette = document.createElement('div');
    palette.id = 'command-palette';
    palette.className = 'w-full max-w-xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden';
    palette.style.animation = 'fadeIn 0.15s ease-out';
    palette.innerHTML = `
        <div class="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <i class="fas fa-terminal text-theme-secondary"></i>
            <input id="command-palette-input" type="text"
                   class="flex-1 bg-transparent outline-none text-gray-800 dark:text-gray-100 text-base placeholder-gray-400"
                   placeholder="快速新建任务 或 /s 搜索历史任务…"
                   autocomplete="off" spellcheck="false">
            <kbd class="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded border border-gray-200 dark:border-gray-600">ESC</kbd>
        </div>
        <div id="command-palette-results" class="max-h-72 overflow-y-auto"></div>
        <div id="command-palette-hint" class="px-5 py-3 text-xs text-theme-secondary border-t border-gray-100 dark:border-gray-700 flex items-center gap-4">
            <span><kbd class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">Enter</kbd> 执行</span>
            <span><kbd class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">Esc</kbd> 关闭</span>
            <span class="ml-auto">支持自动识别日期时间 / ~清单 / #标签 / !优先级 / |详情</span>
        </div>
    `;

    overlay.appendChild(palette);
    document.body.appendChild(overlay);

    const input = document.getElementById('command-palette-input');
    input.focus();

    input.addEventListener('keydown', handleCommandPaletteKeydown);
    input.addEventListener('input', handleCommandPaletteInput);
}

function closeCommandPalette() {
    _commandPaletteOpen = false;
    const overlay = document.getElementById('command-palette-overlay');
    if (overlay) {
        overlay.style.animation = 'fadeOut 0.1s ease-in';
        setTimeout(() => overlay.remove(), 100);
    }
}

function handleCommandPaletteKeydown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPalette();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        executeCommandPalette();
    }
}

function handleCommandPaletteInput(e) {
    const input = document.getElementById('command-palette-input');
    const value = input.value.trim();
    const resultsContainer = document.getElementById('command-palette-results');

    if (!value) {
        resultsContainer.innerHTML = '';
        return;
    }

    // /s 搜索模式
    if (value.startsWith('/s ') || value === '/s') {
        const query = value.slice(3).trim();
        if (!query) {
            resultsContainer.innerHTML = renderSearchHint();
            return;
        }
        const results = searchTasks(query);
        resultsContainer.innerHTML = renderSearchResults(results, query);
        return;
    }

    // 快速创建模式 - 实时预览 NLP 解析结果
    const parsed = parseNLPInput(value);
    resultsContainer.innerHTML = renderNLPPreview(parsed);
}

function executeCommandPalette() {
    const input = document.getElementById('command-palette-input');
    const value = input.value.trim();
    if (!value) return;

    // /s 搜索模式 - 打开第一个搜索结果（不关闭命令面板，方便快速切换查看多个任务）
    if (value.startsWith('/s ')) {
        const query = value.slice(3).trim();
        if (query) {
            const results = searchTasks(query);
            if (results.length > 0) {
                openTaskDetailPanel(results[0].id);
                return;
            }
        }
        showToast('未找到匹配任务', 'info');
        return;
    }

    // 快速创建模式
    const parsed = parseNLPInput(value);
    createTaskFromNLP(parsed);
    closeCommandPalette();
}

// ==================== 任务搜索 ====================

function searchTasks(query) {
    const q = query.toLowerCase();
    return tasks.filter(t => {
        return (t.title && t.title.toLowerCase().includes(q)) ||
               (t.notes && t.notes.toLowerCase().includes(q));
    }).slice(0, 8);
}

function renderSearchHint() {
    return `<div class="px-5 py-6 text-center text-theme-secondary text-sm">
        <i class="fas fa-search mr-2"></i>输入关键词搜索任务
    </div>`;
}

function renderSearchResults(results, query) {
    if (results.length === 0) {
        return `<div class="px-5 py-6 text-center text-theme-secondary text-sm">
            <i class="fas fa-search mr-2"></i>未找到匹配「${escapeHtml(query)}」的任务
        </div>`;
    }
    return results.map(task => {
        const list = lists.find(l => l.id === task.listId);
        const listColor = list ? list.color : '#9ca3af';
        const listName = list ? list.name : '默认';
        // 格式化任务时间
        let timeStr = '';
        if (task.startTime) {
            const d = new Date(task.startTime);
            const now = new Date();
            const isToday = d.toDateString() === now.toDateString();
            const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
            const isTomorrow = d.toDateString() === tomorrow.toDateString();
            const datePart = isToday ? '今天' : isTomorrow ? '明天' : `${d.getMonth() + 1}/${d.getDate()}`;
            if (task.isAllDay) {
                timeStr = ` · ${datePart} 全天`;
            } else {
                const hh = d.getHours().toString().padStart(2, '0');
                const mm = d.getMinutes().toString().padStart(2, '0');
                let timePart = `${hh}:${mm}`;
                if (task.endTime) {
                    const ed = new Date(task.endTime);
                    timePart += `-${ed.getHours().toString().padStart(2, '0')}:${ed.getMinutes().toString().padStart(2, '0')}`;
                }
                timeStr = ` · ${datePart} ${timePart}`;
            }
        }
        return `<div class="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition"
                     onclick="event.stopPropagation(); openTaskDetailPanel('${task.id}')">
            <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${listColor}"></span>
            <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate ${task.completed ? 'line-through opacity-50' : ''}">${escapeHtml(task.title || '新任务')}</div>
                <div class="text-xs text-theme-secondary">${listName}${timeStr}${task.important ? ' · 重要' : ''}${task.urgent ? ' · 紧急' : ''}</div>
            </div>
            <i class="fas fa-arrow-right text-xs text-theme-muted"></i>
        </div>`;
    }).join('');
}

// ==================== NLP 解析 (FR-28) ====================

function parseNLPInput(input) {
    let text = input;
    let startTime = null;
    let isAllDay = true;
    let endTime = null;
    let repeat = null;
    let listId = null;
    let important = false;
    let urgent = false;
    let removedParts = [];
    let notes = '';
    let titleText = '';

    // 0. 用 | 分割：|之前为标题，|之后为详情
    const pipeIndex = text.indexOf('|');
    if (pipeIndex !== -1) {
        titleText = text.substring(0, pipeIndex).trim();
        notes = text.substring(pipeIndex + 1).trim();
    } else {
        titleText = text;
    }

    // 1. 从标题中解析优先级：!!! > !! > !
    const priorityMatch = titleText.match(/!!!|!!|!/);
    if (priorityMatch) {
        const p = priorityMatch[0];
        if (p === '!!!') { important = true; urgent = true; }
        else if (p === '!!') { important = true; urgent = false; }
        else if (p === '!') { important = false; urgent = true; }
        titleText = titleText.replace(p, ' ');
        removedParts.push(p);
    }

    // 2. 从标题中解析清单：~清单名
    const listMatch = titleText.match(/~(\S+)/);
    if (listMatch) {
        const listName = listMatch[1];
        const foundList = lists.find(l => l.name === listName);
        if (foundList) {
            listId = foundList.id;
        }
        titleText = titleText.replace(listMatch[0], ' ');
        removedParts.push(listMatch[0]);
    }

    // 2.5 从标题中解析标签：#标签名（支持多个#标签，不存在则标记待创建）
    const tagIds = [];
    const tagNamesToCreate = [];
    const tagRegex = /#(\S+)/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(titleText)) !== null) {
        const tagName = tagMatch[1];
        let foundTag = (settings.tags || []).find(t => t.name === tagName);
        if (foundTag) {
            tagIds.push(foundTag.id);
        } else {
            // 标签不存在，标记待创建（不在输入时创建，避免中间状态）
            tagNamesToCreate.push(tagName);
        }
        titleText = titleText.replace(tagMatch[0], ' ');
        removedParts.push(tagMatch[0]);
    }

    // 3. 解析日期和时间（先从标题解析，再从详情解析）
    // 设置项 cmdRemoveTimeText：是否从标题中移除已解析的日期/时间文字
    const removeTimeText = settings.cmdRemoveTimeText !== false;
    if (!startTime) {
        const titleDateResult = parseNLPDate(titleText);
        if (titleDateResult) {
            startTime = titleDateResult.date;
            isAllDay = titleDateResult.isAllDay;
            endTime = titleDateResult.endTime || null;
            repeat = titleDateResult.repeat || null;
            if (removeTimeText) {
                titleDateResult.matches.forEach(m => {
                    titleText = titleText.replace(m, ' ');
                });
            }
            removedParts.push(...titleDateResult.matches);
        }
    }
    if (!startTime && notes) {
        const notesDateResult = parseNLPDate(notes);
        if (notesDateResult) {
            startTime = notesDateResult.date;
            isAllDay = notesDateResult.isAllDay;
            endTime = notesDateResult.endTime || null;
            repeat = notesDateResult.repeat || null;
            if (removeTimeText) {
                notesDateResult.matches.forEach(m => {
                    notes = notes.replace(m, ' ');
                });
            }
        }
    }

    // 4. 清理标题：去除多余空格和已解析的标识
    titleText = titleText.replace(/\s+/g, ' ').trim();
    notes = notes.replace(/\s+/g, ' ').trim();

    // 5. 设置项 cmdDefaultDate：未识别到日期时的默认日期
    if (!startTime && settings.cmdDefaultDate === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        startTime = today;
        isAllDay = true;
    }

    return {
        title: titleText || '新任务',
        startTime,
        isAllDay,
        endTime,
        repeat,
        listId: listId || (settings.defaultListId || 'default'),
        tagIds,
        tagNamesToCreate,
        important,
        urgent,
        notes,
        removedParts
    };
}

/**
 * NLP 日期时间解析（增强版）
 * 支持格式：
 *   - 今天/明天/后天/大后天
 *   - N天后 / N天以后（支持中文数字）
 *   - 下周一~下周日 / 本周一~周日 / 周一~周日
 *   - X月X日 / X月X号 / YYYY年M月D日 / YYYY/M/D / YYYY-M-D / M/D
 *   - X号（当月X号）
 *   - 本月底/下月底/年底/明年底/本月末/下月末/年末/明年末
 *   - 上午X点 / 下午X点 / 晚上X点 / 凌晨X点
 *   - X点X分 / X点半
 *   - 时间段：从X点到Y点 / X点到Y点 / X点-Y点
 *   - 跨天时间段：这周一到周三 / 周一到周三
 *   - 重复：每天/每周X/每月X号/每年X月X日/每个工作日/每个节假日假期前一天
 *   - 组合：明天下午3点 / 下周一上午9点半 / 3天后下午2点到5点
 */
function parseNLPDate(text) {
    const now = new Date();
    let date = null;
    let isAllDay = true;
    let endTime = null;
    let repeat = null;
    let matches = [];
    let remaining = text;
    let hour = null;
    let minute = 0;
    let endHour = null;
    let endMinute = 0;
    let periodSpecified = false;

    // --- 辅助函数 ---
    const cnNumMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '两': 2, '零': 0 };
    const numPattern = '(\\d{1,4}|[一二三四五六七八九十百千万两零]+)';
    function parseCnNum(str) {
        if (/^\d+$/.test(str)) return parseInt(str);
        if (str === '十') return 10;
        if (str.startsWith('十')) return 10 + (cnNumMap[str[1]] || 0);
        if (str.endsWith('十')) return (cnNumMap[str[0]] || 0) * 10;
        if (str.length === 1) return cnNumMap[str] || 0;
        // 处理更复杂的中文数字
        let result = 0;
        for (let j = 0; j < str.length; j++) {
            const ch = str[j];
            if (ch === '百') { result = (result || 0) * 100; }
            else if (ch === '十') { result += (result === 0 ? 10 : 10); }
            else { const n = cnNumMap[ch]; if (n !== undefined) result += n; }
        }
        return result || 0;
    }
    function parseHour(str) {
        if (/^\d+$/.test(str)) return parseInt(str);
        return parseCnNum(str);
    }

    const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };

    // --- 重复规则解析（优先级最高，先匹配） ---
    let m;
    m = remaining.match(/每个工作日/);
    if (m) {
        repeat = { type: 'daily', repeatMode: 'startTime', workdayOnly: true };
        matches.push(m[0]);
        remaining = remaining.replace(m[0], ' ');
        if (!date) { date = new Date(now); date.setHours(0,0,0,0); }
    }

    // "每个节假日假期前一天" → repeat: { type: 'yearly', repeatMode: 'startTime', beforeHoliday: true }
    if (!repeat) {
        m = remaining.match(/每个?节假日前一天/);
        if (m) {
            repeat = { type: 'yearly', repeatMode: 'startTime', beforeHoliday: true };
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
            if (!date) { date = new Date(now); date.setHours(0,0,0,0); }
        }
    }

    // "每天" → repeat: { type: 'daily' }
    if (!repeat) {
        m = remaining.match(/每天/);
        if (m) {
            repeat = { type: 'daily', repeatMode: 'startTime' };
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
            if (!date) { date = new Date(now); date.setHours(0,0,0,0); }
        }
    }

    // "每周X" → repeat: { type: 'weekly', dayOfWeek: N }
    if (!repeat) {
        m = remaining.match(/每周([一二三四五六日天])/);
        if (m) {
            const targetDay = dayMap[m[1]];
            if (targetDay !== undefined) {
                repeat = { type: 'weekly', repeatMode: 'startTime', dayOfWeek: targetDay };
                matches.push(m[0]);
                remaining = remaining.replace(m[0], ' ');
                date = new Date(now);
                const currentDay = date.getDay();
                let daysAhead = targetDay - currentDay;
                if (daysAhead <= 0) daysAhead += 7;
                date.setDate(date.getDate() + daysAhead);
                date.setHours(0,0,0,0);
            }
        }
    }

    // "每月X号/X日" → repeat: { type: 'monthly', dayOfMonth: N }
    if (!repeat) {
        m = remaining.match(/每月(\d{1,2})[号日]/);
        if (m) {
            const day = parseInt(m[1]);
            repeat = { type: 'monthly', repeatMode: 'startTime', dayOfMonth: day };
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
            date = new Date(now.getFullYear(), now.getMonth(), day);
            if (date < now) date.setMonth(date.getMonth() + 1);
            date.setHours(0,0,0,0);
        }
    }

    // "每年X月X日" → repeat: { type: 'yearly', month: N, day: N }
    if (!repeat) {
        m = remaining.match(/每年(\d{1,2})月(\d{1,2})[日号]/);
        if (m) {
            const month = parseInt(m[1]);
            const day = parseInt(m[2]);
            repeat = { type: 'yearly', repeatMode: 'startTime', month: month, day: day };
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
            date = new Date(now.getFullYear(), month - 1, day);
            if (date < now) date.setFullYear(date.getFullYear() + 1);
            date.setHours(0,0,0,0);
        }
    }

    // --- 日期解析 ---
    // N天后 / N天以后
    if (!date) {
        m = remaining.match(new RegExp(numPattern + '天[以]?后'));
        if (m) {
            const days = parseCnNum(m[1]);
            date = new Date(now);
            date.setDate(date.getDate() + days);
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // N小时后 / N个小时后（相对时间，设置具体时间点）
    if (!date || (date && hour === null)) {
        m = remaining.match(new RegExp(numPattern + '个?小时[以]?后'));
        if (m) {
            const hours = parseCnNum(m[1]);
            const targetDate = new Date(now.getTime() + hours * 3600 * 1000);
            if (!date) date = targetDate;
            hour = targetDate.getHours();
            minute = targetDate.getMinutes();
            isAllDay = false;
            periodSpecified = true; // 阻止智能时间修正
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // N分钟后 / N分钟以后（相对时间，设置具体时间点）
    if (!date || (date && hour === null)) {
        m = remaining.match(new RegExp(numPattern + '分钟?[以]?后'));
        if (m) {
            const mins = parseCnNum(m[1]);
            const targetDate = new Date(now.getTime() + mins * 60 * 1000);
            if (!date) date = targetDate;
            hour = targetDate.getHours();
            minute = targetDate.getMinutes();
            isAllDay = false;
            periodSpecified = true; // 阻止智能时间修正
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // YYYY年M月D日
    if (!date) {
        m = remaining.match(/(\d{4})年(\d{1,2})月(\d{1,2})[日号]/);
        if (m) {
            date = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // YYYY/M/D 或 YYYY-M-D
    if (!date) {
        m = remaining.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (m) {
            date = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // M/D (无年份，如 6/11)
    if (!date) {
        m = remaining.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/);
        if (m) {
            const month = parseInt(m[1]);
            const day = parseInt(m[2]);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                date = new Date(now.getFullYear(), month - 1, day);
                // 同一天即使时刻已过也保持今天，避免误判为明年
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                if (date < todayStart) date.setFullYear(date.getFullYear() + 1);
                matches.push(m[0]);
                remaining = remaining.replace(m[0], ' ');
            }
        }
    }

    // X月X日/X月X号
    if (!date) {
        m = remaining.match(/(\d{1,2})月(\d{1,2})[日号]/);
        if (m) {
            const month = parseInt(m[1]) - 1;
            const day = parseInt(m[2]);
            date = new Date(now.getFullYear(), month, day);
            // 仅当日期严格早于今天（非同一天）才推进到下一年
            // 同一天即使时刻已过也保持今天，避免"今天7月7日"被误判为明年
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (date < todayStart) date.setFullYear(date.getFullYear() + 1);
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // X号（当月X号）
    if (!date) {
        m = remaining.match(/(?<!\d)(\d{1,2})号(?!\d)/);
        if (m) {
            const day = parseInt(m[1]);
            if (day >= 1 && day <= 31) {
                date = new Date(now.getFullYear(), now.getMonth(), day);
                // 同一天即使时刻已过也保持今天，避免误判为下月
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                if (date < todayStart) date.setMonth(date.getMonth() + 1);
                matches.push(m[0]);
                remaining = remaining.replace(m[0], ' ');
            }
        }
    }

    // 本月底/本月末
    if (!date) {
        m = remaining.match(/本月底|本月末/);
        if (m) {
            date = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // 下月底/下月末
    if (!date) {
        m = remaining.match(/下月底|下月末/);
        if (m) {
            date = new Date(now.getFullYear(), now.getMonth() + 2, 0);
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // 年底/年末
    if (!date) {
        m = remaining.match(/年底|年末/);
        if (m) {
            date = new Date(now.getFullYear(), 11, 31);
            if (date < now) date.setFullYear(date.getFullYear() + 1);
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // 明年底/明年末
    if (!date) {
        m = remaining.match(/明年底|明年末/);
        if (m) {
            date = new Date(now.getFullYear() + 1, 11, 31);
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // 大后天
    if (!date) {
        m = remaining.match(/大后天/);
        if (m) {
            date = new Date(now);
            date.setDate(date.getDate() + 3);
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // 后天
    if (!date) {
        m = remaining.match(/后天/);
        if (m) {
            date = new Date(now);
            date.setDate(date.getDate() + 2);
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // 明天
    if (!date) {
        m = remaining.match(/明天/);
        if (m) {
            date = new Date(now);
            date.setDate(date.getDate() + 1);
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // 今天
    if (!date) {
        m = remaining.match(/今天/);
        if (m) {
            date = new Date(now);
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // 下周X
    if (!date) {
        m = remaining.match(/下(?:周|星期)([一二三四五六日天])/);
        if (m) {
            const targetDay = dayMap[m[1]];
            if (targetDay !== undefined) {
                date = new Date(now);
                const currentDay = date.getDay();
                let daysAhead = targetDay - currentDay;
                if (daysAhead <= 0) daysAhead += 7;
                daysAhead += 7;
                date.setDate(date.getDate() + daysAhead);
                matches.push(m[0]);
                remaining = remaining.replace(m[0], ' ');
            }
        }
    }

    // 本周X / 周X / 星期X
    if (!date) {
        m = remaining.match(/(?:本)?(?:周|星期)([一二三四五六日天])/);
        if (m) {
            const targetDay = dayMap[m[1]];
            if (targetDay !== undefined) {
                date = new Date(now);
                const currentDay = date.getDay();
                let daysAhead = targetDay - currentDay;
                if (daysAhead <= 0) daysAhead += 7;
                date.setDate(date.getDate() + daysAhead);
                matches.push(m[0]);
                remaining = remaining.replace(m[0], ' ');
            }
        }
    }

    // --- 时间段解析 ---

    // 辅助函数：解析单个时间部分
    function parseTimePart(str) {
        str = str.trim();
        let m;
        // X点X分
        m = str.match(/(凌晨|上午|下午|晚上)?(\d{1,2}|[一二三四五六七八九十两]+)[点时:：](\d{1,2}|[一二三四五六七八九十两]+)分?/);
        if (m) {
            let h = parseHour(m[2]);
            let min = parseHour(m[3]);
            let period = m[1];
            let ps = false;
            if (period === '下午' || period === '晚上') { ps = true; if (h < 12) h += 12; }
            else if (period === '凌晨') { ps = true; if (h === 12) h = 0; }
            else if (period === '上午') { ps = true; }
            return { hour: h, minute: min, periodSpecified: ps };
        }
        // X点半
        m = str.match(/(凌晨|上午|下午|晚上)?(\d{1,2}|[一二三四五六七八九十两]+)[点时]半/);
        if (m) {
            let h = parseHour(m[2]);
            let period = m[1];
            let ps = false;
            if (period === '下午' || period === '晚上') { ps = true; if (h < 12) h += 12; }
            else if (period === '凌晨') { ps = true; if (h === 12) h = 0; }
            else if (period === '上午') { ps = true; }
            return { hour: h, minute: 30, periodSpecified: ps };
        }
        // X点
        m = str.match(/(凌晨|上午|下午|晚上)?(\d{1,2}|[一二三四五六七八九十两]+)[点时]/);
        if (m) {
            let h = parseHour(m[2]);
            let period = m[1];
            let ps = false;
            if (period === '下午' || period === '晚上') { ps = true; if (h < 12) h += 12; }
            else if (period === '凌晨') { ps = true; if (h === 12) h = 0; }
            else if (period === '上午') { ps = true; }
            return { hour: h, minute: 0, periodSpecified: ps };
        }
        return null;
    }

    // 更简单的时间段解析
    // "从下午3点到5点" / "9点到11点" / "3点-5点"
    const rangePatterns = [
        // 从X点到Y点（带时段）
        new RegExp('从?(凌晨|上午|下午|晚上)?' + numPattern + '[点时:：](?:半|' + numPattern + '分?)?\\s*[到至~\\-]\\s*(凌晨|上午|下午|晚上)?' + numPattern + '[点时:：](?:半|' + numPattern + '分?)?'),
        // X点-Y点
        new RegExp(numPattern + '[点时:：](?:半|' + numPattern + '分?)?\\s*[到至~\\-]\\s*' + numPattern + '[点时:：](?:半|' + numPattern + '分?)?')
    ];

    let rangeMatched = false;
    for (const pat of rangePatterns) {
        m = remaining.match(pat);
        if (m) {
            const fullMatch = m[0];
            const parts = fullMatch.split(/\s*[到至~\-]\s*/);
            if (parts.length === 2) {
                const startResult = parseTimePart(parts[0].replace(/^从/, ''));
                const endResult = parseTimePart(parts[1]);
                if (startResult && endResult) {
                    hour = startResult.hour;
                    minute = startResult.minute;
                    endHour = endResult.hour;
                    endMinute = endResult.minute;
                    periodSpecified = startResult.periodSpecified || endResult.periodSpecified;
                    rangeMatched = true;
                    matches.push(fullMatch);
                    remaining = remaining.replace(fullMatch, ' ');
                    isAllDay = false;
                }
            }
            break;
        }
    }

    // --- 单时间点解析（如果时间段未匹配） ---
    if (!rangeMatched) {
        // X点X分
        m = remaining.match(new RegExp('(凌晨|上午|下午|晚上)?' + numPattern + '[点时:：]' + numPattern + '分?'));
        if (m) {
            hour = parseHour(m[2]);
            minute = parseHour(m[3]);
            const period = m[1];
            if (period === '下午' || period === '晚上') { periodSpecified = true; if (hour < 12) hour += 12; }
            else if (period === '凌晨') { periodSpecified = true; if (hour === 12) hour = 0; }
            else if (period === '上午') { periodSpecified = true; }
            matches.push(m[0]);
            isAllDay = false;
        }

        // X点半
        if (hour === null) {
            m = remaining.match(new RegExp('(凌晨|上午|下午|晚上)?' + numPattern + '[点时]半'));
            if (m) {
                hour = parseHour(m[2]);
                minute = 30;
                const period = m[1];
                if (period === '下午' || period === '晚上') { periodSpecified = true; if (hour < 12) hour += 12; }
                else if (period === '凌晨') { periodSpecified = true; if (hour === 12) hour = 0; }
                else if (period === '上午') { periodSpecified = true; }
                matches.push(m[0]);
                isAllDay = false;
            }
        }

        // X点
        if (hour === null) {
            m = remaining.match(new RegExp('(凌晨|上午|下午|晚上)?' + numPattern + '[点时](?!\\d)'));
            if (m) {
                hour = parseHour(m[2]);
                const period = m[1];
                if (period === '下午' || period === '晚上') { periodSpecified = true; if (hour < 12) hour += 12; }
                else if (period === '凌晨') { periodSpecified = true; if (hour === 12) hour = 0; }
                else if (period === '上午') { periodSpecified = true; }
                matches.push(m[0]);
                isAllDay = false;
            }
        }
    }

    // 仅有时段没有具体时间
    if (!date && hour === null && !repeat) return null;

    // 智能时间解析
    if (hour !== null && !periodSpecified) {
        if (hour >= 1 && hour <= 7) hour += 12;
    }

    // 如果没有日期但有时间，默认今天
    if (!date) {
        date = new Date(now);
        if (hour !== null) {
            const candidate = new Date(date);
            candidate.setHours(hour, minute, 0, 0);
            if (candidate <= now) date.setDate(date.getDate() + 1);
        }
    }

    // 设置时间
    if (hour !== null) {
        date.setHours(hour, minute, 0, 0);
    } else {
        date.setHours(0, 0, 0, 0);
    }

    // 设置结束时间
    if (endHour !== null) {
        endTime = new Date(date);
        endTime.setHours(endHour, endMinute, 0, 0);
        // 如果结束时间早于开始时间，结束时间为次日
        if (endTime <= date) endTime.setDate(endTime.getDate() + 1);
    }

    // --- 跨天时间段：这周一到周三 / 周一到周三 ---
    m = text.match(/(?:这|本)?(?:周|星期)([一二三四五六日天])\s*[到至~\-]\s*(?:周|星期)?([一二三四五六日天])/);
    if (m && !endTime) {
        const startDay = dayMap[m[1]];
        const endDay = dayMap[m[2]];
        if (startDay !== undefined && endDay !== undefined) {
            const startDate = new Date(now);
            const currentDay = startDate.getDay();
            let daysAhead = startDay - currentDay;
            if (daysAhead < 0) daysAhead += 7;
            startDate.setDate(startDate.getDate() + daysAhead);
            startDate.setHours(0,0,0,0);

            const endDate = new Date(startDate);
            let endDaysAhead = endDay - startDay;
            if (endDaysAhead <= 0) endDaysAhead += 7;
            endDate.setDate(endDate.getDate() + endDaysAhead);
            endDate.setHours(23, 59, 59, 0);

            date = startDate;
            endTime = endDate;
            isAllDay = true;
            matches.push(m[0]);
        }
    }

    return { date, isAllDay, endTime, repeat, matches };
}

// ==================== NLP 预览渲染 ====================

function renderNLPPreview(parsed) {
    const parts = [];

    // 日期预览
    if (parsed.startTime) {
        const d = parsed.startTime;
        const dateStr = `${d.getMonth() + 1}月${d.getDate()}日`;
        let timeStr = parsed.isAllDay ? '全天' : `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        if (parsed.endTime && !parsed.isAllDay) {
            const ed = parsed.endTime;
            timeStr += `-${ed.getHours().toString().padStart(2, '0')}:${ed.getMinutes().toString().padStart(2, '0')}`;
        }
        parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-xs"><i class="fas fa-calendar-alt"></i>${dateStr} ${timeStr}</span>`);
    }

    // 重复预览
    if (parsed.repeat) {
        const repeatLabels = {
            'daily': '每天',
            'weekly': '每周',
            'monthly': '每月',
            'yearly': '每年',
            'weeklyFirstWorkday': '每周首个工作日',
            'weeklyLastWorkday': '每周最后一个工作日',
            'monthlyFirstWorkday': '每月首个工作日',
            'monthlyLastWorkday': '每月最后一个工作日'
        };
        let repeatLabel = repeatLabels[parsed.repeat.type] || '重复';
        if (parsed.repeat.type === 'weekly' && parsed.repeat.dayOfWeek !== undefined) {
            const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
            repeatLabel = '每周' + weekDays[parsed.repeat.dayOfWeek];
        }
        if (parsed.repeat.type === 'monthly' && parsed.repeat.dayOfMonth) {
            repeatLabel = '每月' + parsed.repeat.dayOfMonth + '号';
        }
        if (parsed.repeat.type === 'yearly' && parsed.repeat.month && parsed.repeat.day) {
            repeatLabel = '每年' + parsed.repeat.month + '月' + parsed.repeat.day + '日';
        }
        if (parsed.repeat.workdayOnly) repeatLabel = '每个工作日';
        if (parsed.repeat.beforeHoliday) repeatLabel = '节假日假期前一天';
        parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded text-xs"><i class="fas fa-redo"></i>${repeatLabel}</span>`);
    }

    // 清单预览
    const list = lists.find(l => l.id === parsed.listId);
    if (list) {
        parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs" style="background:${list.color}20;color:${list.color}"><i class="fas fa-list"></i>${list.name}</span>`);
    }

    // 标签预览
    if (parsed.tagIds && parsed.tagIds.length > 0) {
        const allTags = settings.tags || [];
        parsed.tagIds.forEach(tagId => {
            const tag = allTags.find(t => t.id === tagId);
            if (tag) {
                parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs" style="background:${tag.color}33;color:${tag.color}"><i class="fas fa-tag"></i>${tag.name}</span>`);
            }
        });
    }
    // 待创建标签预览（用灰色占位）
    if (parsed.tagNamesToCreate && parsed.tagNamesToCreate.length > 0) {
        parsed.tagNamesToCreate.forEach(tagName => {
            parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-theme-secondary rounded text-xs"><i class="fas fa-tag"></i>${escapeHtml(tagName)}<span class="text-[10px] opacity-60">新建</span></span>`);
        });
    }

    // 优先级预览
    if (parsed.important && parsed.urgent) {
        parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-xs"><i class="fas fa-exclamation-triangle"></i>重要且紧急</span>`);
    } else if (parsed.important) {
        parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-xs"><i class="fas fa-star"></i>重要不紧急</span>`);
    } else if (parsed.urgent) {
        parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded text-xs"><i class="fas fa-clock"></i>紧急不重要</span>`);
    }

    const tagsHtml = parts.length > 0 ? `<div class="flex flex-wrap gap-1.5 mb-2">${parts.join('')}</div>` : '';
    const notesHtml = parsed.notes ? `<div class="text-xs text-theme-secondary mt-1 ml-7 truncate"><i class="fas fa-align-left mr-1"></i>${escapeHtml(parsed.notes)}</div>` : '';

    return `<div class="px-5 py-4">
        ${tagsHtml}
        <div class="flex items-center gap-2">
            <i class="fas fa-plus-circle text-green-500"></i>
            <span class="text-sm text-gray-700 dark:text-gray-300">创建任务：</span>
            <span class="text-sm font-medium text-gray-900 dark:text-gray-100">${escapeHtml(parsed.title)}</span>
        </div>
        ${notesHtml}
    </div>`;
}

// ==================== 从 NLP 解析结果创建任务 ====================

function createTaskFromNLP(parsed) {
    // 创建不存在的标签
    const allTagIds = [...(parsed.tagIds || [])];
    if (parsed.tagNamesToCreate && parsed.tagNamesToCreate.length > 0) {
        if (!settings.tags) settings.tags = [];
        parsed.tagNamesToCreate.forEach(tagName => {
            // 再次检查，避免并发创建
            if (!settings.tags.find(t => t.name === tagName)) {
                const newTag = {
                    id: generateId(),
                    name: tagName,
                    color: '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0'),
                    createdAt: new Date().toISOString()
                };
                settings.tags.push(newTag);
                allTagIds.push(newTag.id);
            } else {
                const existing = settings.tags.find(t => t.name === tagName);
                allTagIds.push(existing.id);
            }
        });
        saveData();
    }

    const newTask = {
        id: generateId(),
        title: parsed.title,
        listId: parsed.listId,
        important: parsed.important,
        urgent: parsed.urgent,
        notes: parsed.notes || '',
        tags: allTagIds,
        startTime: parsed.startTime ? parsed.startTime.toISOString() : null,
        endTime: parsed.endTime ? parsed.endTime.toISOString() : null,
        isAllDay: parsed.isAllDay,
        reminder: 0,
        repeat: parsed.repeat || null,
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

    // 2行消息提示：第1行"任务创建成功"，第2行"任务标题（任务时间）"
    showToast(buildTaskToastMessage(newTask), 'success', null, '任务创建成功');
}

// ==================== 快捷键系统 ====================

const DEFAULT_SHORTCUTS = {
    commandPalette: { ctrl: true, alt: true, shift: false, key: 'n', label: '命令面板' },
    togglePomodoro: { ctrl: true, alt: true, shift: false, key: 'p', label: '番茄专注' },
    viewTask: { ctrl: false, alt: true, shift: false, key: '1', label: '任务视图' },
    viewSchedule: { ctrl: false, alt: true, shift: false, key: '2', label: '日程视图' },
    viewWeek: { ctrl: false, alt: true, shift: false, key: '3', label: '周视图' },
    viewMonth: { ctrl: false, alt: true, shift: false, key: '4', label: '月视图' },
    viewQuadrant: { ctrl: false, alt: true, shift: false, key: '5', label: '四象限视图' }
};

let _recordingShortcut = null;

function getCurrentShortcuts() {
    if (settings && settings.shortcuts) {
        const merged = {};
        for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
            merged[key] = settings.shortcuts[key] || { ...DEFAULT_SHORTCUTS[key] };
            if (!merged[key].label) merged[key].label = DEFAULT_SHORTCUTS[key].label;
        }
        return merged;
    }
    return { ...DEFAULT_SHORTCUTS };
}

function formatShortcut(combo) {
    const parts = [];
    if (combo.ctrl) parts.push('Ctrl');
    if (combo.alt) parts.push('Alt');
    if (combo.shift) parts.push('Shift');
    if (combo.key) parts.push(combo.key.toUpperCase());
    return parts.join('+');
}

function checkShortcutConflict(shortcutKey, combo) {
    const shortcuts = getCurrentShortcuts();
    for (const [key, existing] of Object.entries(shortcuts)) {
        if (key === shortcutKey) continue;
        if (existing.ctrl === !!combo.ctrl &&
            existing.alt === !!combo.alt &&
            existing.shift === !!combo.shift &&
            existing.key.toLowerCase() === combo.key.toLowerCase()) {
            return existing.label;
        }
    }
    return null;
}

function executeShortcutAction(action) {
    switch (action) {
        case 'commandPalette':
            if (_commandPaletteOpen) closeCommandPalette();
            else openCommandPalette();
            break;
        case 'togglePomodoro':
            togglePomodoroPage();
            break;
        case 'viewTask': case 'viewSchedule': case 'viewWeek': case 'viewMonth': case 'viewQuadrant':
            const viewMap = { viewTask: 'task', viewSchedule: 'schedule', viewWeek: 'week', viewMonth: 'month', viewQuadrant: 'quadrant' };
            const pomodoroPage = document.getElementById('pomodoro-page');
            if (pomodoroPage && !pomodoroPage.classList.contains('hidden')) closePomodoroPage();
            switchView(viewMap[action]);
            break;
    }
}

document.addEventListener('keydown', function(e) {
    // 录入快捷键模式
    if (_recordingShortcut) {
        e.preventDefault();
        e.stopPropagation();

        const modifierKeys = ['Control', 'Alt', 'Shift', 'Meta'];
        if (modifierKeys.includes(e.key)) return;

        const hasModifier = e.ctrlKey || e.altKey || e.shiftKey;
        if (!hasModifier) {
            const recordingBtn = document.querySelector(`[data-shortcut-key="${_recordingShortcut}"] .shortcut-record-btn`);
            if (recordingBtn) {
                recordingBtn.textContent = '需要修饰键';
                setTimeout(() => {
                    if (_recordingShortcut) {
                        recordingBtn.textContent = '请按下快捷键...';
                    }
                }, 1500);
            }
            return;
        }

        const combo = {
            ctrl: e.ctrlKey,
            alt: e.altKey,
            shift: e.shiftKey,
            key: e.key.toLowerCase()
        };

        const conflict = checkShortcutConflict(_recordingShortcut, combo);

        if (!settings.shortcuts) settings.shortcuts = {};
        settings.shortcuts[_recordingShortcut] = {
            ctrl: combo.ctrl,
            alt: combo.alt,
            shift: combo.shift,
            key: combo.key,
            label: DEFAULT_SHORTCUTS[_recordingShortcut].label
        };

        _recordingShortcut = null;
        renderShortcutsSettings();
        if (conflict) {
            const warningEl = document.getElementById('shortcut-conflict-warning');
            if (warningEl) {
                warningEl.textContent = `快捷键冲突：与「${conflict}」相同`;
                warningEl.classList.remove('hidden');
            }
        }
        return;
    }

    // 正常快捷键处理
    if (_commandPaletteOpen) return;

    const shortcuts = getCurrentShortcuts();
    for (const [action, combo] of Object.entries(shortcuts)) {
        if (e.ctrlKey === !!combo.ctrl &&
            e.altKey === !!combo.alt &&
            e.shiftKey === !!combo.shift &&
            e.key.toLowerCase() === combo.key.toLowerCase()) {
            e.preventDefault();
            executeShortcutAction(action);
            return;
        }
    }
});

function renderShortcutsSettings() {
    const container = document.getElementById('shortcuts-settings-container');
    if (!container) return;

    const shortcuts = getCurrentShortcuts();
    let html = '';

    for (const [key, combo] of Object.entries(shortcuts)) {
        const isRecording = _recordingShortcut === key;
        const conflict = checkShortcutConflict(key, combo);
        const displayText = isRecording ? '请按下快捷键...' : formatShortcut(combo);
        const isDefault = !settings.shortcuts || !settings.shortcuts[key] ||
            (settings.shortcuts[key].ctrl === DEFAULT_SHORTCUTS[key].ctrl &&
             settings.shortcuts[key].alt === DEFAULT_SHORTCUTS[key].alt &&
             settings.shortcuts[key].shift === DEFAULT_SHORTCUTS[key].shift &&
             settings.shortcuts[key].key === DEFAULT_SHORTCUTS[key].key);

        html += `
            <div class="flex items-center justify-between py-2" data-shortcut-key="${key}">
                <span class="text-sm text-theme-secondary">${combo.label || DEFAULT_SHORTCUTS[key].label}</span>
                <div class="flex items-center gap-2">
                    ${!isDefault ? `<button class="p-1 text-theme-muted hover:text-theme-primary transition" onclick="resetShortcut('${key}')" title="重置为默认"><i class="fas fa-undo text-xs"></i></button>` : ''}
                    <button class="shortcut-record-btn px-3 py-1.5 text-sm border border-theme rounded-lg ${isRecording ? 'bg-blue-500 text-white border-blue-500' : 'bg-theme-tertiary text-theme-primary hover:bg-theme-secondary'} transition min-w-[140px] text-center"
                            onclick="startShortcutRecording('${key}')">
                        ${displayText}
                    </button>
                </div>
            </div>`;
    }

    html += `<div id="shortcut-conflict-warning" class="hidden text-xs text-red-500 mt-1"></div>`;
    html += `<div class="flex justify-end mt-2"><button class="px-3 py-1.5 text-xs text-theme-muted hover:text-theme-primary border border-theme rounded-lg transition" onclick="resetAllShortcuts()">全部重置</button></div>`;

    container.innerHTML = html;
}

function startShortcutRecording(shortcutKey) {
    _recordingShortcut = shortcutKey;
    renderShortcutsSettings();
}

function resetShortcut(shortcutKey) {
    if (settings.shortcuts) {
        delete settings.shortcuts[shortcutKey];
    }
    renderShortcutsSettings();
}

function resetAllShortcuts() {
    if (settings) {
        settings.shortcuts = {};
    }
    renderShortcutsSettings();
}

// 切换番茄专注页面
function togglePomodoroPage() {
    const pomodoroPage = document.getElementById('pomodoro-page');
    if (!pomodoroPage) return;
    if (pomodoroPage.classList.contains('hidden')) {
        switchToPomodoroPage();
    } else {
        closePomodoroPage();
    }
}

// ==================== 辅助函数 ====================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
