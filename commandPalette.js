// ==================== 命令面板 & NLP 快速添加 (FR-27 / FR-28) ====================

let _commandPaletteOpen = false;
let _commandPaletteDebounceTimer = null;

// —— 候选面板状态（仿输入法候选词：~ 触发清单候选、# 触发标签候选）——
let _cpCandidates = null; // { type:'list'|'tag', prefix:'~'|'#', start, end, query, items:[{name,color,selected,isCurrent}], activeIndex, virtual }
let _cpDelToken = null;   // 已武装的识别块（双退格整删用）：{ start, text }
let _cpDraft = null;      // 未完成草稿：误触遮罩空白关闭面板时保留（文本+光标），下次呼出恢复；
                          // Esc 关闭 / Enter 创建成功后清空（主动放弃 / 已消费）

// ==================== 模糊时间偏好配置 ====================
// 时段词：word=触发词, key=settings.commandTimePrefs 字段名, min/max=可调区间(分钟,硬约束),
//         defaultMin=旧数据缺失该字段时的兜底默认值。
// 已过处理：当天该偏好时间已过 → 同日区间内取当前时刻之后下一个 30 分钟槽点；区间全过 → 次日偏好值。
// 冲突检测：按 30 分钟步长检测同日同时分任务，区间上限仍冲突 → 回偏好起点允许冲突(标记 conflict)。
// ⚠️ max=1440 表示「24:00」——它是区间右端点的文案边界，不是可放置时刻：
//    时刻 1440 会回绕到次日 00:00，故实际可放置/可选的最大分钟数取 min(max, 1439)（见 resolveFuzzyTimeConflict / openFuzzyTimePicker）。
const FUZZY_TIME_WORDS = [
    { word: '上午', key: 'morning',   min: 360,  max: 720,  defaultMin: 540  },  // 6:00–12:00
    { word: '中午', key: 'noon',      min: 690,  max: 810,  defaultMin: 720  },  // 11:30–13:30
    { word: '下午', key: 'afternoon', min: 720,  max: 1080, defaultMin: 900  }, // 12:00–18:00
    { word: '晚上', key: 'evening',   min: 1080, max: 1440, defaultMin: 1140 }  // 18:00–24:00
];
// 相对时间词：now + settings.commandTimePrefs.laterMinutes（仅当未识别到任何日期/时间时生效）
const FUZZY_RELATIVE_WORDS = ['稍后', '等等', '一会儿'];
// 顺延/冲突步长（分钟）
const FUZZY_TIME_STEP = 30;

// ==================== 命令面板 UI ====================

function openCommandPalette() {
    if (_commandPaletteOpen) return;
    _commandPaletteOpen = true;

    // 移除已有面板
    const existing = document.getElementById('command-palette-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'command-palette-overlay';
    // 顶部预留候选面板的悬浮空间（max 保证小屏也有足够留白），候选面板出现时不推动输入框
    overlay.className = 'fixed inset-0 z-50 flex items-start justify-center pt-[max(15vh,168px)]';
    overlay.style.background = 'rgba(0,0,0,0.45)';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.onclick = function(e) {
        // 误触遮罩空白：关闭但保留草稿（下次呼出恢复输入到一半的文本）
        if (e.target === overlay) closeCommandPalette(true);
    };

    const palette = document.createElement('div');
    palette.id = 'command-palette';
    // relative 作为候选浮层的定位容器；子元素均为透明背景，无需 overflow-hidden 裁圆角
    palette.className = 'w-full max-w-xl bg-theme-secondary rounded-2xl shadow-2xl border border-theme relative';
    palette.style.animation = 'fadeIn 0.15s ease-out';
    palette.innerHTML = `
        <div id="command-palette-candidates" class="hidden absolute bottom-full inset-x-0 mb-2 bg-theme-secondary rounded-xl shadow-2xl border border-theme"></div>
        <div class="flex items-center gap-3 px-5 py-4 border-b border-theme">
            <i class="fas fa-terminal text-theme-secondary"></i>
            <input id="command-palette-input" type="text"
                   class="flex-1 bg-transparent outline-none text-theme-primary text-base"
                   placeholder="快速新建任务 或 /s 搜索历史任务…"
                   autocomplete="off" spellcheck="false">
        </div>
        <div id="command-palette-results" class="max-h-72 overflow-y-auto"></div>
        <div id="command-palette-hint" class="px-5 py-3 text-xs text-theme-secondary border-t border-theme flex items-center gap-4">
            <div class="flex items-start gap-4 flex-shrink-0">
                <span class="flex flex-col items-center gap-1">
                    <kbd class="px-1 py-0.5 bg-theme-tertiary text-theme-muted rounded text-[10px]">Enter</kbd>
                    <span id="cmd-hint-enter">新建任务</span>
                </span>
                <span class="flex flex-col items-center gap-1">
                    <kbd class="px-1 py-0.5 bg-theme-tertiary text-theme-muted rounded text-[10px]">Esc</kbd>
                    <span>关闭面板</span>
                </span>
            </div>
            <div class="ml-auto min-w-0 flex flex-col items-end gap-1 text-right">
                <span id="cmd-hint-default">${_cmdHintChip('select', '/select 批量管理')} · ${_cmdHintChip('s', '/s 搜索任务')} · ~清单 · #标签 · !优先级 · |详情</span>
                <span id="cmd-hint-search" class="hidden"><span class="flex flex-col items-end gap-1">
                    <span>搜索筛选：~清单 · #标签 · is:已完成/未完成/今天/逾期/无日期</span>
                    <span>${_cmdHintChip('select', '/select 批量管理')}</span>
                </span></span>
            </div>
        </div>
    `;

    overlay.appendChild(palette);
    document.body.appendChild(overlay);

    // 每次打开都是全新 DOM，候选/双退格状态一并复位
    _cpCandidates = null;
    _cpDelToken = null;

    const input = document.getElementById('command-palette-input');
    input.focus();

    // 脏则重建（C8-1）：数据变更经 saveData 统一置脏，不脏直接复用，避免每次打开全量重建
    if (typeof ensureSearchIndex === 'function') ensureSearchIndex();

    input.addEventListener('keydown', handleCommandPaletteKeydown);
    input.addEventListener('input', handleCommandPaletteInput);
    // 纯光标移动（方向键/鼠标点击）不触发 input 事件，需单独同步候选状态
    input.addEventListener('keyup', handleCommandPaletteKeyup);
    input.addEventListener('mouseup', handleCommandPaletteMouseUp);
    // IME 组字结束兜底刷新（Chrome 最后一次 input 在 compositionend 之前，组字期间
    // 光标位置可能尚未稳定，结束时以最终光标位置再同步一次；操作幂等无副作用）
    input.addEventListener('compositionend', handleCommandPaletteCompositionEnd);

    // 恢复上次未完成的草稿（误触遮罩空白关闭时保留）：文本 + 光标位置一并还原，
    // 并走一遍 input 流程刷新候选面板 / 搜索结果 / 创建预览（/s 草稿同样可恢复）
    if (_cpDraft) {
        input.value = _cpDraft.text;
        const s = Math.min(_cpDraft.start, _cpDraft.text.length);
        const end = Math.min(_cpDraft.end, _cpDraft.text.length);
        input.setSelectionRange(s, end);
        handleCommandPaletteInput({});
    }
}

function closeCommandPalette(keepDraft) {
    _commandPaletteOpen = false;
    // keepDraft=true（误触遮罩空白）：保留当前输入为草稿；否则（Esc / 创建成功 / 移动端返回）清空
    const draftInput = document.getElementById('command-palette-input');
    _cpDraft = (keepDraft && draftInput && draftInput.value)
        ? { text: draftInput.value, start: draftInput.selectionStart, end: draftInput.selectionEnd }
        : null;
    _cpCandidates = null;
    _cpDelToken = null;
    if (_commandPaletteDebounceTimer) {
        clearTimeout(_commandPaletteDebounceTimer);
        _commandPaletteDebounceTimer = null;
    }
    // 关闭命令面板时，同步关闭模态浮层模式的任务详情
    if (typeof _taskDetailModalMode !== 'undefined' && _taskDetailModalMode) {
        closeTaskDetailPanel();
    }
    const overlay = document.getElementById('command-palette-overlay');
    if (overlay) {
        overlay.style.animation = 'fadeOut 0.1s ease-in';
        setTimeout(() => overlay.remove(), 100);
    }
}

function handleCommandPaletteKeydown(e) {
    // IME 组字中的按键不进入面板逻辑（Enter=上屏候选、Esc=取消组字），
    // 避免拼音选字时把半截拼音直接建成任务
    if (e.isComposing) return;

    const input = document.getElementById('command-palette-input');

    if (e.key === 'Escape') {
        e.preventDefault();
        // FR-08-3：/s 搜索模式已有查询词时，第一次 Esc 仅清空查询词回到 /s 提示态
        // （注意必须匹配 '/s ' 前缀而非 startsWith('/s')，否则 /settings 之类输入会被误判）
        const v = input.value;
        if (v.startsWith('/s ') && v.slice(3).trim() !== '') {
            input.value = '/s ';
            input.focus();
            _resetSearchLazyState();
            handleCommandPaletteInput({});
            return;
        }
        closeCommandPalette();
        return;
    }

    // 候选面板激活：↑↓ 在候选间移动；Tab 确认当前高亮候选
    if (_cpCandidates) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (_cpCandidates.items.length > 0) {
                e.preventDefault();
                const n = _cpCandidates.items.length;
                _cpCandidates.activeIndex = (_cpCandidates.activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
                renderCommandPaletteCandidates();
            }
            return;
        }
        // Tab 确认候选：Tab 不经过输入法（IME）处理，preventDefault 可 100% 拦截默认行为，
        // 天然无「确认字符被上屏」问题（此前 · 键由 IME 产出，keydown 拦不住、码点随输入法而异）
        if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault(); // 阻止焦点移出输入框（含 Shift+Tab 逆向导航）
            if (e.shiftKey) {
                // Shift+Tab：高亮上移（与 ↑ 等价的逆向导航，仿终端 Tab 补全习惯）
                if (_cpCandidates.items.length > 0) {
                    const n = _cpCandidates.items.length;
                    _cpCandidates.activeIndex = (_cpCandidates.activeIndex - 1 + n) % n;
                    renderCommandPaletteCandidates();
                }
            } else if (_cpCandidates.items.length > 0) {
                applyCommandPaletteCandidate(_cpCandidates.activeIndex);
            }
            return;
        }
    }

    // FR-08-3 键盘全导航：/s 搜索模式下 ↑↓ 在结果间移动高亮（候选面板激活时上方分支已 return）
    const _vRaw = input.value;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (_vRaw.startsWith('/s ') || _vRaw.trim() === '/s')) {
        if (_lastSearchResults.length > 0) {
            e.preventDefault();
            const n = _lastSearchResults.length;
            if (_searchActiveIndex === -1) _searchActiveIndex = e.key === 'ArrowDown' ? 0 : n - 1;
            else _searchActiveIndex = (_searchActiveIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
            _updateSearchActiveHighlight();
        }
        return;
    }

    // 双退格整删：针对已识别信息（!优先级 / ~清单 / #标签 / 日期时间文字）。
    // 第一次退格删掉块尾空格（默认行为，同时武装该块），第二次退格整块删除；
    // 删完自动武装前一个识别块，可连续逐个撤销
    if (e.key === 'Backspace') {
        const v = input.value;
        const pos = input.selectionStart;
        if (input.selectionStart !== input.selectionEnd) {
            _cpDelToken = null; // 有选区：普通删除
        } else {
            const t = _cpDelToken;
            // ① 光标停在已武装块尾（尾随空格已被上一次退格删除）→ 整删该块
            //    只删块本身、保留块前分隔空格：链式删除时每个识别块固定消耗两次退格
            //    （第一次删尾随空格、第二次整删），与前一块的删除互不干扰
            if (t && pos === t.start + t.text.length && v.startsWith(t.text, t.start) && v.charAt(pos) !== ' ') {
                e.preventDefault();
                input.value = v.slice(0, t.start) + v.slice(t.start + t.text.length);
                input.setSelectionRange(t.start, t.start);
                _cpDelToken = null;
                armPreviousCommandPaletteToken();
                updateCommandPaletteCandidates();
                renderCommandPalettePreview();
                return;
            }
            // ② 光标前是空格：放行默认删空格，同时武装空格前的识别块（下一次退格整删）
            if (pos > 0 && v.charAt(pos - 1) === ' ') {
                const chunk = findCommandPaletteChunkEndingAt(v, pos - 1);
                _cpDelToken = chunk ? { start: chunk.start, text: v.slice(chunk.start, pos - 1) } : null;
            } else {
                // ③ 其他位置：普通逐字删除
                _cpDelToken = null;
            }
        }
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        executeCommandPalette();
    }
}

function handleCommandPaletteInput(e) {
    // 注意：这里不能按 isComposing 提前返回——Chrome 中 IME 提交文本的最后一次
    // input 事件发生在 compositionend 之前且 isComposing=true，提前返回会完全错过
    // IME 提交（表现为：输入法打出的 ~ / # / 中文不触发候选与预览，而退格等
    // 非组字操作一切正常）。组字过程中的 input 事件照常处理：候选随组字文本
    // 实时过滤（与输入法候选行为一致），提交后的最后一次 input 即为最终结果。
    const input = document.getElementById('command-palette-input');

    const value = input.value.trim();

    // 右下角语法提示两态切换（默认创建语法 ↔ 搜索筛选语法）
    _updateCommandPaletteHint(value);

    // 候选面板实时刷新（不走防抖，保证导航与输入的即时反馈）
    updateCommandPaletteCandidates();

    // 清除上一次防抖定时器
    if (_commandPaletteDebounceTimer) {
        clearTimeout(_commandPaletteDebounceTimer);
    }

    const resultsContainer = document.getElementById('command-palette-results');

    if (!value) {
        // FR-08-6：空输入展示搜索历史（无历史维持空白）
        _resetSearchLazyState();
        resultsContainer.innerHTML = renderSearchHistory();
        return;
    }

    // /s 搜索模式：防抖 150ms，避免连续按键全量扫描
    if (value.startsWith('/s ') || value === '/s') {
        const query = value.slice(3).trim();
        _searchActiveIndex = -1; // 输入变更即复位键盘高亮，Enter 不会取到过期下标
        if (!query) {
            _resetSearchLazyState();
            resultsContainer.innerHTML = renderSearchHint();
            return;
        }
        _commandPaletteDebounceTimer = setTimeout(() => {
            const curInput = document.getElementById('command-palette-input');
            // 防抖期间用户可能已清空或切换输入，校验当前值仍为搜索模式
            if (!curInput || !curInput.value.trim().startsWith('/s')) return;
            const r = searchTasks(query);
            _setSearchLazyState(query, r);
            resultsContainer.innerHTML = renderSearchResults(r.results, query, r.total);
        }, 150);
        return;
    }

    // FR-03 /select 多选模式：搜索结果批量选中（与 /s 共用 searchTasks 索引与渲染）
    if (value.startsWith('/select ') || value === '/select') {
        const query = value.slice(8).trim();
        _searchActiveIndex = -1;
        if (!query) {
            _resetSearchLazyState();
            resultsContainer.innerHTML = '<div class="px-5 py-6 text-center text-theme-muted text-sm">' +
                '<i class="fas fa-list mr-2"></i>输入关键词，按 Enter 将匹配任务全部选中并进入批量管理' +
                '</div>';
            return;
        }
        _commandPaletteDebounceTimer = setTimeout(() => {
            const curInput = document.getElementById('command-palette-input');
            if (!curInput || !curInput.value.trim().startsWith('/select')) return;
            const r = searchTasks(query);
            _setSearchLazyState(query, r);
            resultsContainer.innerHTML = renderSearchResults(r.results, query, r.total);
        }, 150);
        return;
    }

    // FR-01/FR-02 斜杠指令（/undo /撤销 /trash /回收站）：仅显示指令提示，不做 NLP 预览
    if (_isSlashDirectiveInput(value)) {
        resultsContainer.innerHTML = renderSlashDirectiveHint(_matchSlashDirective(value));
        return;
    }

    // 快速创建模式 - 实时预览 NLP 解析结果（也轻微防抖，避免高频解析）
    _commandPaletteDebounceTimer = setTimeout(() => {
        const curInput = document.getElementById('command-palette-input');
        if (!curInput || curInput.value.trim().startsWith('/s')) return;
        if (_isSlashDirectiveInput(curInput.value)) return; // FR-01/FR-02 斜杠指令：提示已渲染，跳过 NLP 预览
        renderCommandPalettePreview();
    }, 120);
}

// FR-01/FR-02 斜杠指令工具：完整输入命中返回指令名，否则 null
function _matchSlashDirective(value) {
    const v = (value || '').trim().toLowerCase();
    if (v === '/undo' || v === '/撤销') return 'undo';
    if (v === '/trash' || v === '/回收站') return 'trash';
    return null;
}

// 输入过程是否命中斜杠指令前缀（用于拦截 NLP 预览与候选面板）
function _isSlashDirectiveInput(value) {
    const v = (value || '').trim().toLowerCase();
    return v.startsWith('/undo') || v.startsWith('/撤销')
        || v.startsWith('/trash') || v.startsWith('/回收站');
}

function renderSlashDirectiveHint(directive) {
    if (directive === 'undo') {
        return `<div class="px-5 py-6 text-center text-theme-secondary text-sm">
            <i class="fas fa-rotate-left mr-2"></i>按 Enter 撤销最近一次操作（也可用 Ctrl+Z）
        </div>`;
    }
    if (directive === 'trash') {
        return `<div class="px-5 py-6 text-center text-theme-secondary text-sm">
            <i class="fas fa-trash mr-2"></i>按 Enter 打开回收站
        </div>`;
    }
    return renderSearchHint();
}

function executeCommandPalette() {
    const input = document.getElementById('command-palette-input');
    const value = input.value.trim();
    if (!value) return;

    // /s 搜索模式 - 打开当前高亮项（无高亮开第一条；不关闭命令面板，方便快速切换查看多个任务）
    if (value.startsWith('/s ')) {
        const query = value.slice(3).trim();
        if (query) {
            _addSearchHistory(query); // FR-08-6：Enter 提交即记录搜索历史
            const r = searchTasks(query);
            // 取值池优先用「已展开的结果集」：点过「+N 更多」后键盘高亮可能落在首屏 50 条之外，
            // 直接用重新搜索的 results（固定 50 条）会取到 undefined
            const pool = (_lastSearchQuery === query && _lastSearchResults.length > r.results.length)
                ? _lastSearchResults : r.results;
            if (pool.length > 0) {
                const idx = (_searchActiveIndex >= 0 && _searchActiveIndex < pool.length) ? _searchActiveIndex : 0;
                openTaskDetailModal(pool[idx].id);
                return;
            }
        }
        showToast('没有匹配的任务', 'info');
        return;
    }

    // FR-03 /select 多选模式 - 匹配任务全部选中并进入多选态（上限 50，含余量提示）
    if (value.startsWith('/select ')) {
        const query = value.slice(8).trim();
        const r = query ? searchTasks(query) : { results: [], total: 0 };
        closeCommandPalette();
        if (r.results.length === 0) { showToast('没有匹配的任务', 'info'); return; }
        enterBatchSelectMode(r.results.map(function (t) { return t.id; }));
        showToast('已选中 ' + r.results.length + ' 项' +
            (r.total > r.results.length ? '（共 ' + r.total + ' 条匹配，仅选中前 ' + r.results.length + ' 条）' : ''), 'success');
        return;
    }

    // FR-01/FR-02 斜杠指令：/undo /撤销 /trash /回收站
    const directive = _matchSlashDirective(value);
    if (directive === 'undo') {
        closeCommandPalette();
        if (typeof performUndo === 'function') {
            // 撤销类通知统一走简洁通知条（单行、青边、short 档）
            if (!performUndo()) showCompactToast('没有可撤销的操作', { tone: 'info' });
        }
        return;
    }
    if (directive === 'trash') {
        closeCommandPalette();
        if (typeof openTrashView === 'function') openTrashView();
        return;
    }

    // 快速创建模式
    const parsed = parseNLPInput(value);
    createTaskFromNLP(parsed);
    closeCommandPalette();
}

// ==================== 候选面板（仿输入法候选词：~清单 / #标签）====================

// 光标所在的 ~/# token 视为「组字中」：光标位于触发符之后、token 内部或紧随 token 末尾
function findCommandPaletteCandidateToken(value, cursor) {
    const re = /([~#])([^\s|]*)/g;
    let m;
    while ((m = re.exec(value)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (cursor > start && cursor <= end) {
            return { type: m[1] === '~' ? 'list' : 'tag', prefix: m[1], start, end, query: m[2] };
        }
    }
    return null;
}

// 构建候选面板的候选项：过滤（前缀匹配优先于包含匹配）+ 标记已在输入中生效的完整 token（实心）
function buildCommandPaletteItems(type, query, value) {
    let items = type === 'list'
        // 「默认」清单不出现在候选中：不填 ~token 时任务本就归属默认清单，
        // 想改回默认直接双退格删掉 ~token 即可
        ? lists.filter(l => !l.archived && !l.isFolder && l.id !== 'default' && !shouldHideExternalList(l)).map(l => ({ name: l.name, color: l.color || '#6b7280' }))
        : (settings.tags || []).map(t => ({ name: t.name, color: t.color || '#6b7280' }));

    const q = (query || '').toLowerCase();
    if (q) {
        const prefixHits = [];
        const containsHits = [];
        items.forEach(it => {
            const n = it.name.toLowerCase();
            if (n.startsWith(q)) prefixHits.push(it);
            else if (n.indexOf(q) !== -1) containsHits.push(it);
        });
        items = prefixHits.concat(containsHits);
    }

    const prefix = type === 'list' ? '~' : '#';
    const present = new Set();
    const re = /([~#])([^\s|]+)/g;
    let m;
    while ((m = re.exec(value)) !== null) present.add(m[0]);
    items.forEach(it => {
        it.selected = present.has(prefix + it.name);
        it.isCurrent = query === it.name;
    });
    return items;
}

function updateCommandPaletteCandidates() {
    const input = document.getElementById('command-palette-input');
    const box = document.getElementById('command-palette-candidates');
    if (!input || !box) { _cpCandidates = null; return; }

    const hidePanel = () => { _cpCandidates = null; box.classList.add('hidden'); box.innerHTML = ''; };
    const value = input.value;
    if (value.trim().startsWith('/s')) { hidePanel(); return; } // /s 搜索模式不出候选
    if (_isSlashDirectiveInput(value)) { hidePanel(); return; } // FR-01/FR-02 斜杠指令不出候选

    // 标签多选「虚拟面板」仍锚定在光标处（光标未动、无选区）：保持展开，不重建
    if (_cpCandidates && _cpCandidates.virtual
        && input.selectionStart === _cpCandidates.start && input.selectionEnd === input.selectionStart) {
        return;
    }

    // 双退格整删已「武装」且光标正停在待删块的相关位置：用户处于连续删除流程中，
    // 此时不弹候选（否则整删流程中面板会在每次删除间隙闪烁）；
    // 移动光标或继续输入即脱离武装位置，恢复正常候选逻辑
    if (_cpDelToken) {
        const t = _cpDelToken;
        const pos = input.selectionStart;
        const atEndWithSpace = pos === t.start + t.text.length + 1 && value.startsWith(t.text + ' ', t.start);
        const atEndNoSpace = pos === t.start + t.text.length && value.startsWith(t.text, t.start) && value.charAt(pos) !== ' ';
        if (atEndWithSpace || atEndNoSpace) { hidePanel(); return; }
    }

    const token = findCommandPaletteCandidateToken(value, input.selectionStart);
    if (!token) { hidePanel(); return; }

    _cpCandidates = Object.assign(token, {
        items: buildCommandPaletteItems(token.type, token.query, value),
        activeIndex: 0
    });
    renderCommandPaletteCandidates();
}

function renderCommandPaletteCandidates() {
    const box = document.getElementById('command-palette-candidates');
    const c = _cpCandidates;
    if (!box || !c) return;

    const kbd = 'px-1 py-0.5 bg-theme-tertiary text-theme-muted rounded text-[10px] border border-theme';
    const label = c.type === 'list' ? '清单' : '标签';
    const icon = c.type === 'list' ? 'fa-list-ul' : 'fa-tags';
    const hint = `<span class="ml-auto flex items-center gap-3 whitespace-nowrap">
            <span class="flex items-center gap-1"><kbd class="${kbd}">↑↓</kbd>切换</span>
            <span class="flex items-center gap-1"><kbd class="${kbd}">Tab</kbd>设置任务${label}</span>
        </span>`;

    if (c.items.length === 0) {
        box.innerHTML = `<div class="px-4 py-2 text-xs text-theme-secondary flex items-center gap-1.5">
            <i class="fas ${icon}"></i>${label}
            <span class="ml-1.5">没有匹配${c.query ? '「' + escapeHtml(c.query) + '」' : ''}的${label}</span>
            ${hint}
        </div>`;
        box.classList.remove('hidden');
        return;
    }

    // 复用任务详情栏清单/标签选择器的胶囊样式（detail-tag-pill / detail-tag-pill-selected）；
    // 键盘高亮挂 cmd-pal-candidate-active 类（半透明标签色底 + 内描边，均在胶囊边界内，无 outline 外扩裁剪）
    const pills = c.items.map((it, i) => {
        const cls = it.selected ? 'detail-tag-pill-selected' : 'detail-tag-pill';
        const active = i === c.activeIndex ? ' cmd-pal-candidate-active' : '';
        return `<button type="button" class="${cls}${active} cmd-pal-candidate" data-idx="${i}"
                style="--tag-color:${it.color};" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</button>`;
    }).join('');

    box.innerHTML = `
        <div class="px-4 pt-2 pb-1.5 text-[11px] text-theme-secondary flex items-center gap-2">
            <i class="fas ${icon}"></i>${label}
            ${hint}
        </div>
        <div class="px-4 pb-2.5 flex flex-wrap gap-2 max-h-24 overflow-y-auto">${pills}</div>`;
    box.classList.remove('hidden');

    box.querySelectorAll('.cmd-pal-candidate').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 防止输入框失焦
            applyCommandPaletteCandidate(parseInt(btn.dataset.idx, 10));
        });
    });
    const active = box.querySelector(`.cmd-pal-candidate[data-idx="${c.activeIndex}"]`);
    if (active) active.scrollIntoView({ block: 'nearest' });
}

function applyCommandPaletteCandidate(idx) {
    const input = document.getElementById('command-palette-input');
    const c = _cpCandidates;
    if (!input || !c || !c.items[idx]) return;
    const it = c.items[idx];
    const v = input.value;

    if (it.selected && !it.isCurrent) {
        // 已生效的完整 token：再点一次 = 从输入中移除（取消选择，连同尾随空格，避免留下双空格）
        const re = /([~#])([^\s|]+)/g;
        let m;
        while ((m = re.exec(v)) !== null) {
            if (m[0] === c.prefix + it.name) {
                const tokenEnd = m.index + m[0].length;
                const removeEnd = tokenEnd + (v.charAt(tokenEnd) === ' ' ? 1 : 0);
                input.value = v.slice(0, m.index) + v.slice(removeEnd);
                const pos = Math.min(m.index, input.value.length);
                input.setSelectionRange(pos, pos);
                break;
            }
        }
        _cpDelToken = null;
    } else {
        // 确认候选：仿输入法上屏，用 `~名称 ` / `#名称 ` 替换光标所在 token，尾随空格保证断词
        const insert = c.prefix + it.name + ' ';
        // 清单为单选语义：前后文中已生效的其他 ~清单 token 一并移除（新清单替换旧清单），
        // 否则旧 ~token 残留会落入标题文字，解析出错误的任务名
        if (c.type === 'list') {
            const stripLists = s => s.replace(/~[^\s|!]+\s?/g, '');
            const before = stripLists(v.slice(0, c.start));
            input.value = before + insert + stripLists(v.slice(c.end));
            const cursor = before.length + insert.length;
            input.setSelectionRange(cursor, cursor);
        } else {
            input.value = v.slice(0, c.start) + insert + v.slice(c.end);
            const cursor = c.start + insert.length;
            input.setSelectionRange(cursor, cursor);
        }
        // 整删不在此时武装：退格时由 Backspace 处理器按识别块动态武装
    }
    input.focus();
    // 标签多选：确认/移除后候选面板保持展开（虚拟空 token），可继续 ↑↓ Tab 连选，
    // 高亮停留在刚操作的标签上（接续连选）；清单为单选，走常规刷新收起
    if (c.type === 'tag') keepTagPanelOpen(it.name);
    else updateCommandPaletteCandidates();
    renderCommandPalettePreview();
}

// 标签多选连选：以光标为锚点保持一个「虚拟空 token」候选面板，不向输入框写入任何字符，
// 可继续用 ↑↓ Tab 选择其他标签（再按 Tab 于已选标签 = 移除）；输入任意字符或移动光标即退出。
// focusName：刚确认/移除的标签名，高亮停留在其上（接续连选，避免每次都从第一个重新开始）
function keepTagPanelOpen(focusName) {
    const input = document.getElementById('command-palette-input');
    if (!input) return;
    const cursor = input.selectionStart;
    // 光标仍落在真实 ~/# token 内（确认后紧邻下一个组字 token 等）：走常规刷新
    if (findCommandPaletteCandidateToken(input.value, cursor)) {
        updateCommandPaletteCandidates();
        return;
    }
    const items = buildCommandPaletteItems('tag', '', input.value);
    const focusIdx = focusName ? items.findIndex(x => x.name === focusName) : -1;
    _cpCandidates = {
        type: 'tag', prefix: '#', start: cursor, end: cursor, query: '',
        items,
        activeIndex: focusIdx >= 0 ? focusIdx : 0,
        virtual: true
    };
    renderCommandPaletteCandidates();
}

// ==================== 识别块扫描（双退格整删用）====================

// 将输入中「已识别信息」定位为区间：!优先级 / ~清单 / #标签 / 日期时间与重复文字。
// 与 parseNLPInput 的识别口径一致：先提取 ! 与 ~/# token，再对剩余文本跑 NLP 日期解析。
// 掩码副本与原串等长（已识别的字符置 \u0000，不被 \s 与任何日期模式匹配），保证区间位置与原始输入一一对应
function findCommandPaletteChunks(value) {
    const intervals = [];
    const mask = value.split('');
    const take = (start, end, time) => {
        intervals.push({ start, end, time: !!time });
        for (let i = start; i < end; i++) mask[i] = '\u0000';
    };

    let m = /!!!|!!|!/.exec(value); // ! 优先级（提取顺序与 parseNLPInput 一致）
    if (m) take(m.index, m.index + m[0].length);

    const tokenRe = /([~#])([^\s|!]+)/g; // ~清单 / #标签（! 已被优先级提取，不并入 token 名）
    while ((m = tokenRe.exec(value)) !== null) take(m.index, m.index + m[0].length);

    const masked = mask.join('');
    const dateResult = parseNLPDate(masked);
    if (dateResult) {
        // 顺序定位：模拟解析器「首个匹配即消费」的行为，避免同名匹配串定位到未消费的出现处
        const work = masked.split('');
        dateResult.matches.forEach(s => {
            const idx = work.join('').indexOf(s);
            if (idx !== -1) {
                take(idx, idx + s.length, true);
                for (let i = idx; i < idx + s.length; i++) work[i] = '\u0000';
            }
        });
    }

    // 同一时间表达式的相邻日期/时刻部分合并为一个块（可跨空格，如「明天」+「上午八点」、
    // 「每天 8点」）；! / ~ / # 等独立 token 不参与合并
    intervals.sort((a, b) => a.start - b.start || a.end - b.end);
    const chunks = [];
    intervals.forEach(iv => {
        const last = chunks[chunks.length - 1];
        if (last && last.time && iv.time && iv.start >= last.end
            && !/\S/.test(value.slice(last.end, iv.start))) {
            last.end = Math.max(last.end, iv.end);
        } else {
            chunks.push({ start: iv.start, end: iv.end, time: iv.time });
        }
    });
    return chunks;
}

// 找到恰好结束于 end 位置的识别块（供退格武装：光标前的空格若是识别块的尾随空格，该块可整删）
function findCommandPaletteChunkEndingAt(value, end) {
    return findCommandPaletteChunks(value).find(c => c.end === end) || null;
}

// 整删一个识别块后，若光标前紧贴另一个识别块（其尾随空格已被整删吞掉），直接武装它，
// 使继续按退格可逐个撤销此前的识别信息；带尾随空格的形态由 Backspace ② 分支动态武装
function armPreviousCommandPaletteToken() {
    const input = document.getElementById('command-palette-input');
    if (!input) return;
    const chunk = findCommandPaletteChunkEndingAt(input.value, input.selectionStart);
    if (chunk) _cpDelToken = { start: chunk.start, text: input.value.slice(chunk.start, chunk.end) };
}

// 立即重渲染 NLP 预览（绕过防抖，供候选确认/整删/组字结束后即时刷新）
function renderCommandPalettePreview() {
    const curInput = document.getElementById('command-palette-input');
    const resultsContainer = document.getElementById('command-palette-results');
    if (!curInput || !resultsContainer) return;
    const v = curInput.value.trim();
    // 空输入与 handleCommandPaletteInput 的空分支保持一致：展示搜索历史（FR-08-6），
    // 避免退格清空文本后历史视图被这里意外抹掉
    if (!v) { resultsContainer.innerHTML = renderSearchHistory(); return; }
    // /s 搜索模式的结果由其自身防抖分支负责渲染，此处不得用 NLP 预览覆盖；
    // FR-01/FR-02 斜杠指令同理（提示由输入分支渲染）
    if (v.startsWith('/s')) return;
    if (_isSlashDirectiveInput(v)) return;
    const parsed = parseNLPInput(v);
    resultsContainer.innerHTML = renderNLPPreview(parsed);
}

function handleCommandPaletteKeyup(e) {
    if (e.isComposing) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        updateCommandPaletteCandidates();
    }
}

function handleCommandPaletteMouseUp() {
    updateCommandPaletteCandidates();
}

function handleCommandPaletteCompositionEnd() {
    updateCommandPaletteCandidates();
    renderCommandPalettePreview();
}

// ==================== 任务搜索（FR-08 增强） ====================

// 预计算的小写搜索索引，避免每次按键对 5510 条任务做 toLowerCase() + includes()。
// 脏标记（C8-1）：数据变更经 saveData() 统一置脏（data.js 钩子），面板打开 / 搜索时
// 「脏则重建、不脏直接复用」，避免每次打开面板都付一次全量重建的卡顿成本。
let _searchIndex = [];
let _searchIndexReady = false;
let _searchIndexDirty = false;

function markSearchIndexDirty() {
    _searchIndexDirty = true;
}

// 确保索引就绪且未脏（面板打开 / 搜索入口调用）
function ensureSearchIndex() {
    if (!_searchIndexReady || _searchIndexDirty) rebuildSearchIndex();
}

function rebuildSearchIndex() {
    _searchIndex = [];
    // 标签 / 清单建 Map 查找，避免每条任务线性扫描（C8-1）
    const listMap = new Map();
    (lists || []).forEach(l => listMap.set(l.id, (l.name || '').toLowerCase()));
    const tagMap = new Map();
    ((settings && settings.tags) || []).forEach(t => tagMap.set(t.id, (t.name || '').toLowerCase()));
    if (!tasks || tasks.length === 0) { _searchIndexReady = true; _searchIndexDirty = false; return; }
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        // FR-02（V2-6 / C8-3）：回收站任务不进入命令面板搜索索引
        if (t.deletedAt) continue;
        _searchIndex.push({
            task: t,
            title: (t.title || '').toLowerCase(),
            notes: ((t.notes || '') + ' ' + (t.description || '')).toLowerCase(),
            // FR-08-1 索引扩容：子任务标题 / 标签名 / 清单名
            // 标签字段兼容 tagIds（与 filterTasks 的 task.tags || task.tagIds 口径一致）
            subtasks: (t.subtasks || []).map(s => (s.text || '')).join(' ').toLowerCase(),
            tags: ((t.tags || t.tagIds) || []).map(id => tagMap.get(id) || '').join(' ').toLowerCase(),
            listName: listMap.get(t.listId) || ''
        });
    }
    _searchIndexReady = true;
    _searchIndexDirty = false;
}

// ---- 筛选语法解析（FR-08-5，R2 修订：清单筛选语法改为 ~清单名）----
// 关键词后可追加条件 token（空格分隔，多条件 AND）：
//   ~清单名（包含匹配，主语法，与快速创建的 ~清单 语法对齐）、#标签名（包含匹配）、
//   is:已完成/未完成/今天/逾期/无日期
// 兼容旧写法「清单:名称」；全角符号 ～ ＃ ： 自动归一化（中文输入法直出的字符不失效）。
// 注：is:有附件 依赖 FR-06 附件功能，暂不支持
const SEARCH_IS_FILTERS = ['已完成', '未完成', '今天', '逾期', '无日期'];

// 全角符号归一化：～＃： → ~ # :（仅影响筛选 token 识别；关键词主体含全角标点的场景极少，可接受）
function _normalizeSearchToken(tok) {
    return tok.replace(/～/g, '~').replace(/＃/g, '#').replace(/：/g, ':');
}

// 右下角语法提示两态：默认（快速创建语法）↔ 搜索态（搜索筛选语法）。
// startsWith('/s') 同时覆盖 '/s ' 与 '/select'（二者同属搜索模式）。
// 顺手切换左侧 Enter 提示：搜索态下 Enter 是「打开选中项」而非「新建任务」。
function _updateCommandPaletteHint(value) {
    const d = document.getElementById('cmd-hint-default');
    const s = document.getElementById('cmd-hint-search');
    const en = document.getElementById('cmd-hint-enter');
    if (!d || !s) return;
    const searchMode = typeof value === 'string' && value.trim().startsWith('/s');
    d.classList.toggle('hidden', searchMode);
    s.classList.toggle('hidden', !searchMode);
    if (en) en.textContent = searchMode ? '打开选中项' : '新建任务';
}

// 提示条里的可点击命令 chip：点击把命令前缀补进输入框（默认提示的 /s、/select，
// 以及 /s 搜索态第 2 行的 /select）
function _cmdHintChip(cmd, text) {
    return '<span class="cursor-pointer text-accent-dark dark:text-accent-light hover:underline transition"'
        + ' onclick="event.stopPropagation(); _insertCommandPrefix(\'' + cmd + '\')">' + text + '</span>';
}

// 点击提示补全命令前缀（cmd: 's' | 'select'）：
// ① 已有该前缀 → 只聚焦，不重复插入；
// ② /s 态下点 /select → 前缀升级为 /select，保留已输入的查询词；
// ③ 其余情况 → 前缀插到已有文本之前（保留草稿，不清空输入）。
function _insertCommandPrefix(cmd) {
    const input = document.getElementById('command-palette-input');
    if (!input) return;
    const prefix = '/' + cmd;
    const v = input.value;
    const t = v.trim();
    const low = t.toLowerCase();
    const isS = low === '/s' || low.indexOf('/s ') === 0;
    const isSelect = low === '/select' || low.indexOf('/select ') === 0;

    let next = null;
    if (cmd === 'select') {
        if (isSelect) next = null;                                   // 已在该模式：仅聚焦
        else if (isS) next = '/select ' + t.slice(2).replace(/^\s+/, ''); // /s → /select，保留查询词
        else next = prefix + ' ' + v.replace(/^\s+/, '');
    } else {
        if (isS) next = null;                                        // 已在搜索态：仅聚焦
        else next = prefix + ' ' + v.replace(/^\s+/, '');
    }

    if (next !== null) input.value = next;
    input.focus();
    const pos = input.value.length;
    input.setSelectionRange(pos, pos);
    if (next !== null) handleCommandPaletteInput({});
}

function _parseSearchQuery(query) {
    const tokens = (query || '').split(/\s+/).filter(Boolean);
    const parsed = { keywords: [], listFilter: null, tagFilter: null, isFilters: [] };
    for (const raw of tokens) {
        const tok = _normalizeSearchToken(raw);
        const lt = tok.toLowerCase();
        if (tok.charAt(0) === '~') {
            const v = tok.slice(1).trim().toLowerCase();
            if (v) parsed.listFilter = v; // 同类多 token 后者覆盖
        } else if (lt.startsWith('清单:')) {
            const v = tok.slice(3).trim().toLowerCase();
            if (v) parsed.listFilter = v; // 旧语法「清单:名称」兼容
        } else if (tok.charAt(0) === '#') {
            const v = tok.slice(1).trim().toLowerCase();
            if (v) parsed.tagFilter = v;
        } else if (lt.startsWith('is:')) {
            const v = tok.slice(3);
            if (SEARCH_IS_FILTERS.indexOf(v) !== -1 && parsed.isFilters.indexOf(v) === -1) parsed.isFilters.push(v);
        } else {
            parsed.keywords.push(lt);
        }
    }
    return parsed;
}

// is:xxx 条件过滤（完成态 / 时间态），全部条件 AND
function _searchTaskPassIsFilters(task, isFilters) {
    for (let i = 0; i < isFilters.length; i++) {
        const f = isFilters[i];
        if (f === '已完成' && !task.completed) return false;
        if (f === '未完成' && task.completed) return false;
        if (f === '今天') {
            if (!task.startTime) return false;
            const d = new Date(task.startTime);
            const now = new Date();
            if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) return false;
        }
        if (f === '逾期') {
            if (typeof isTaskOverdue === 'function' ? !isTaskOverdue(task) : !task.startTime) return false;
        }
        if (f === '无日期' && task.startTime) return false;
    }
    return true;
}

// 单词命中权重（FR-08-2 相关度）：标题 3 > 子任务/标签 2 > notes/清单名 1；0 = 未命中
function _searchHitScore(entry, kw) {
    if (entry.title.indexOf(kw) !== -1) return 3;
    if (entry.subtasks.indexOf(kw) !== -1 || entry.tags.indexOf(kw) !== -1) return 2;
    if (entry.notes.indexOf(kw) !== -1 || entry.listName.indexOf(kw) !== -1) return 1;
    return 0;
}

const SEARCH_MAX_RESULTS = 50; // FR-08-2：上限 8 → 50，超出由渲染层给余量提示
const SEARCH_PAGE_SIZE = 50;   // 「+N 更多」每次追加条数（与首屏等量，懒加载分批渲染）
const SEARCH_SORT_MODES = [
    { key: 'relevance', label: '相关度' },
    { key: 'time', label: '时间' },
    { key: 'created', label: '创建时间' }
];
let _searchSortMode = 'relevance';
let _searchActiveIndex = -1;  // 键盘导航高亮（FR-08-3）
let _lastSearchResults = [];  // 当前渲染的结果集（Enter 取高亮项用）
let _lastSearchTotal = 0;
let _searchMatchedAll = [];   // 当前查询的完整匹配任务（「+N 更多」懒加载展开的数据源）
let _searchLoadedCount = 0;   // 已渲染条数（首屏 SEARCH_MAX_RESULTS，展开按 SEARCH_PAGE_SIZE 递增）
let _lastSearchQuery = '';    // 当前查询词（展开时复用，不必重新解析输入）

// 搜索态状态复位（切模式 / 清空输入时用）
function _resetSearchLazyState() {
    _searchActiveIndex = -1;
    _lastSearchResults = [];
    _lastSearchTotal = 0;
    _searchMatchedAll = [];
    _searchLoadedCount = 0;
    _lastSearchQuery = '';
}

// 搜索态状态写入（searchTasks 结果落库，供懒加载展开复用）
function _setSearchLazyState(query, r) {
    _searchActiveIndex = -1;
    _lastSearchResults = r.results;
    _lastSearchTotal = r.total;
    _searchMatchedAll = r.matched || r.results;
    _searchLoadedCount = r.results.length;
    _lastSearchQuery = query;
}

function setSearchSortMode(mode) {
    _searchSortMode = mode;
    // 排序切换后重算并重渲染当前查询（保持查询词与高亮复位）
    const input = document.getElementById('command-palette-input');
    const resultsContainer = document.getElementById('command-palette-results');
    if (!input || !resultsContainer) return;
    const value = input.value.trim();
    if (!value.startsWith('/s ')) return;
    const query = value.slice(3).trim();
    if (!query) return;
    const r = searchTasks(query);
    _setSearchLazyState(query, r);
    resultsContainer.innerHTML = renderSearchResults(r.results, query, r.total);
}

// 搜索主入口：解析筛选 token → 过滤 → 多关键词 AND 匹配 → 排序 → 截断 50
// 返回 { results: <task[]>, total: <number> }
function searchTasks(query) {
    if (!_searchIndexReady || _searchIndexDirty) rebuildSearchIndex();
    const parsed = _parseSearchQuery(query);
    const matched = [];
    for (let i = 0; i < _searchIndex.length; i++) {
        const s = _searchIndex[i];
        if (parsed.listFilter && s.listName.indexOf(parsed.listFilter) === -1) continue;
        if (parsed.tagFilter && s.tags.indexOf(parsed.tagFilter) === -1) continue;
        if (parsed.isFilters.length && !_searchTaskPassIsFilters(s.task, parsed.isFilters)) continue;
        if (parsed.keywords.length) {
            let score = 0, allHit = true;
            for (let j = 0; j < parsed.keywords.length; j++) {
                const sc = _searchHitScore(s, parsed.keywords[j]);
                if (!sc) { allHit = false; break; }
                score += sc;
            }
            if (!allHit) continue;
            s._score = score; // 瞬态评分，随下次搜索重算
        } else {
            s._score = 0;
        }
        matched.push(s);
    }
    const startTimeOf = t => t.startTime ? new Date(t.startTime).getTime() : Infinity;
    if (_searchSortMode === 'time') {
        matched.sort((a, b) => startTimeOf(a.task) - startTimeOf(b.task)); // startTime 近 → 远，无日期排尾
    } else if (_searchSortMode === 'created') {
        matched.sort((a, b) => new Date(b.task.createdAt || 0).getTime() - new Date(a.task.createdAt || 0).getTime()); // 新 → 旧
    } else {
        // 相关度（默认）：权重降序 → 同权重 startTime 近者优先（无日期排尾）
        matched.sort((a, b) => (b._score - a._score) || (startTimeOf(a.task) - startTimeOf(b.task)));
    }
    const total = matched.length;
    return {
        results: matched.slice(0, SEARCH_MAX_RESULTS).map(s => s.task), // 首屏
        total,
        matched: matched.map(s => s.task)                               // 完整匹配（「+N 更多」展开用）
    };
}

// ---- 命中高亮（FR-08-4 / C8-2）----
// 安全序：在原始文本上定位命中区间 → 切片 → escapeHtml 各段 → 拼 <mark>；禁止反向操作
function _highlightText(text, keywords) {
    const raw = text || '';
    if (!raw || !keywords || !keywords.length) return escapeHtml(raw);
    const lower = raw.toLowerCase();
    let hit = -1, kwLen = 0;
    for (const kw of keywords) {
        const i = lower.indexOf(kw);
        if (i !== -1) { hit = i; kwLen = kw.length; break; }
    }
    if (hit === -1) return escapeHtml(raw);
    const MARK_CLS = 'bg-accent-soft dark:bg-accent-strong text-accent-dark dark:text-accent-light rounded px-0.5';
    return escapeHtml(raw.slice(0, hit))
        + '<mark class="' + MARK_CLS + '">' + escapeHtml(raw.slice(hit, hit + kwLen)) + '</mark>'
        + escapeHtml(raw.slice(hit + kwLen));
}

// notes 命中片段：命中位置前后约 40 字符的 snippet，片段内高亮；未命中返回 ''
function _notesSnippet(text, keywords) {
    const raw = (text || '').trim();
    if (!raw || !keywords || !keywords.length) return '';
    const lower = raw.toLowerCase();
    let hit = -1;
    for (const kw of keywords) {
        const i = lower.indexOf(kw);
        if (i !== -1) { hit = i; break; }
    }
    if (hit === -1) return '';
    const start = Math.max(0, hit - 40);
    const end = Math.min(raw.length, hit + 40);
    return (start > 0 ? '…' : '') + _highlightText(raw.slice(start, end), keywords) + (end < raw.length ? '…' : '');
}

// ---- 搜索历史（FR-08-6）：localStorage 最近 10 条，不进 settings（避免入全量 PUT 载荷）----
const SEARCH_HISTORY_KEY = 'tacklist_search_history';
const SEARCH_HISTORY_MAX = 10;

function _loadSearchHistory() {
    try {
        const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
    } catch (e) { return []; }
}

function _saveSearchHistory(arr) {
    try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(arr)); } catch (e) { /* 配额满等场景静默放弃 */ }
}

function _addSearchHistory(query) {
    const q = (query || '').trim();
    if (!q) return;
    let arr = _loadSearchHistory().filter(x => x !== q);
    arr.unshift(q);
    if (arr.length > SEARCH_HISTORY_MAX) arr = arr.slice(0, SEARCH_HISTORY_MAX);
    _saveSearchHistory(arr);
}

// 内联 onclick 的 JS 字符串字面量安全化（' 与 \ 转义）
function _jsStr(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function removeSearchHistoryItem(query) {
    _saveSearchHistory(_loadSearchHistory().filter(x => x !== query));
    // 删除后即时刷新（仅当当前处于空输入历史视图）
    const input = document.getElementById('command-palette-input');
    const resultsContainer = document.getElementById('command-palette-results');
    if (input && resultsContainer && !input.value.trim()) {
        resultsContainer.innerHTML = renderSearchHistory();
    }
}

// 点击历史词：填入 /s 词 并走一遍 input 流程（搜索立即执行）
function _useSearchHistory(query) {
    const input = document.getElementById('command-palette-input');
    if (!input) return;
    input.value = '/s ' + query;
    input.focus();
    handleCommandPaletteInput({});
}

// 空输入时展示搜索历史（V8-8）；无历史返回 ''（维持空白）
function renderSearchHistory() {
    const arr = _loadSearchHistory();
    if (!arr.length) return '';
    return `<div class="px-5 py-2 text-xs text-theme-muted flex items-center gap-2 border-b border-theme sticky top-0 bg-theme-secondary">
            <i class="fas fa-clock-rotate-left"></i>最近搜索
        </div>` + arr.map(q => `
        <div class="px-3 py-1">
            <div class="task-row flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-theme-tertiary transition cursor-pointer group"
                 onclick="_useSearchHistory('${_jsStr(q)}')">
                <i class="fas fa-magnifying-glass text-xs text-theme-muted flex-shrink-0"></i>
                <span class="flex-1 text-sm text-theme-primary truncate min-w-0">${escapeHtml(q)}</span>
                <button class="opacity-0 group-hover:opacity-100 text-theme-muted hover:text-red-400 transition px-1 flex-shrink-0" title="删除该记录"
                        onclick="event.stopPropagation(); removeSearchHistoryItem('${_jsStr(q)}')">
                    <i class="fas fa-times text-xs"></i>
                </button>
            </div>
        </div>`).join('');
}

function renderSearchHint() {
    return `<div class="px-5 py-6 text-center text-theme-secondary text-sm">
        <i class="fas fa-search mr-2"></i>输入关键词搜索任务
    </div>`;
}

// 排序切换（紧凑三态，仅 /s 有结果时渲染于结果区顶部）
function _renderSearchSortToggle() {
    return `<div class="flex items-center gap-2 px-5 py-2 border-b border-theme text-xs text-theme-secondary sticky top-0 bg-theme-secondary z-[1]">
        <i class="fas fa-sort-amount-down text-theme-muted"></i><span>排序</span>
        <div class="flex gap-1">
        ${SEARCH_SORT_MODES.map(m => `<button type="button" class="px-2 py-0.5 rounded transition ${_searchSortMode === m.key ? 'bg-accent-soft dark:bg-accent-strong text-accent-dark dark:text-accent-light font-bold' : 'hover:bg-theme-tertiary text-theme-secondary'}" onclick="setSearchSortMode('${m.key}')">${m.label}</button>`).join('')}
        </div>
    </div>`;
}

// 键盘导航高亮同步：不整块重渲染，仅在 DOM 上切换高亮类并滚动到可见（FR-08-3）
function _updateSearchActiveHighlight() {
    const container = document.getElementById('command-palette-results');
    if (!container) return;
    container.querySelectorAll('[data-search-index]').forEach(row => {
        const idx = parseInt(row.getAttribute('data-search-index'), 10);
        const inner = row.firstElementChild;
        if (inner) inner.classList.toggle('bg-theme-tertiary', idx === _searchActiveIndex);
    });
    const active = container.querySelector(`[data-search-index="${_searchActiveIndex}"]`);
    if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
}

function renderSearchResults(results, query, total) {
    if (results.length === 0) {
        return `<div class="px-5 py-6 text-center text-theme-secondary text-sm">
            <i class="fas fa-search mr-2"></i>未找到匹配「${escapeHtml(query)}」的任务
        </div>`;
    }
    const keywords = _parseSearchQuery(query).keywords;
    const header = _renderSearchSortToggle();
    const body = results.map((task, idx) => _renderSearchRow(task, idx, keywords)).join('');
    // 超出首屏的部分给「+N 更多」懒加载入口（点击按 SEARCH_PAGE_SIZE 追加，不一次性全渲染）
    return header + body + _renderSearchMoreFooter(total - results.length);
}

// 单条搜索结果行（首屏渲染与「+N 更多」追加共用同一份模板）
// 注：搜索结果行是「查看」而非「操作」——不带完成勾选框、不带开始专注按钮，
//     避免搜索时顺手改完成态或直接进入专注；这两项请在点开的任务详情面板里操作。
function _renderSearchRow(task, idx, keywords) {
    const list = lists.find(l => l.id === task.listId);
    const listColor = list ? list.color : '#9ca3af';
    const listName = list ? list.name : '';
    const focusMinutes = getTaskFocusMinutes(task.id);
    const timeDisplay = formatTaskListTime(task, { fullDate: true });
    const progress = task.progress || 0;
    const quadColors = getQuadrantColorClass(task);
    const isOverdue = isTaskOverdue(task);
    const timeTextClass = isOverdue ? OVERDUE_TEXT_CLASS : 'text-theme-primary';
    const tagCapsules = renderTagCapsules(task, 2, 'right');
    const snippet = _notesSnippet((task.notes || '') + ' ' + (task.description || ''), keywords);

    return `<div class="px-3 py-1" data-search-index="${idx}">
            <div class="task-list-item cmd-search-item task-row relative flex items-center gap-3 py-2.5 px-3 rounded-r-lg ${quadColors.bg} hover:opacity-85 transition cursor-pointer group ${task.completed ? 'opacity-55' : ''} ${idx === _searchActiveIndex ? 'bg-theme-tertiary' : ''}"
                 data-list-id="${task.listId || 'default'}"
                 onclick="event.stopPropagation(); openTaskDetailModal('${task.id}')">
                <div class="task-list-color-bar" style="background-color: ${_extTaskBarColor(task, getTaskBarColor(task, listColor))};"></div>
                ${_extTaskIconHtml(task)}<div class="flex-1 min-w-0"><span class="flex items-center block text-sm ${task.completed ? 'text-theme-secondary' : 'text-theme-primary'} truncate min-w-0">${_highlightText(task.title || '新任务', keywords)}</span>${snippet ? `<span class="block text-xs text-theme-muted truncate mt-0.5">${snippet}</span>` : ''}</div>
                <div class="flex items-center gap-2 flex-shrink-0 text-xs text-theme-primary whitespace-nowrap">
                    ${tagCapsules}
                    ${progress > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-flag text-accent-light"></i>${progress}%</span>` : ''}
                    ${focusMinutes > 0 ? `<span class="flex items-center gap-1"><i class="fas fa-stopwatch text-red-400"></i>${formatFocusMinutes(focusMinutes)}</span>` : ''}
                    ${listName ? `<span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background-color: ${listColor}"></span><span class="hidden sm:inline">${listName}</span></span>` : ''}
                </div>
                ${timeDisplay ? `<span class="flex-shrink-0 text-xs ${timeTextClass} whitespace-nowrap" style="min-width: 50px; text-align: right;"><i class="fas fa-clock mr-1"></i>${timeDisplay}</span>` : ''}
            </div>
        </div>`;
}

// 结果区底部「+N 更多」：点击按 SEARCH_PAGE_SIZE 追加下一批（懒加载，参考任务视图的分批渲染思路，
// 不一次性把上千条塞进 DOM）。无剩余时返回空串。
function _renderSearchMoreFooter(remain) {
    if (typeof remain !== 'number' || remain <= 0) return '';
    return `<div id="cmd-search-more" class="px-5 py-2.5 text-center text-xs border-t border-theme">
            <button type="button" class="text-accent-dark dark:text-accent-light hover:underline transition"
                    onclick="expandSearchResults()">+${remain} 更多</button>
        </div>`;
}

// 「+N 更多」：增量插入下一批结果行（不整块重渲染，滚动位置与键盘高亮均不丢）
function expandSearchResults() {
    const container = document.getElementById('command-palette-results');
    if (!container) return;
    const footer = document.getElementById('cmd-search-more');
    const startIdx = _searchLoadedCount;
    const next = _searchMatchedAll.slice(startIdx, startIdx + SEARCH_PAGE_SIZE);
    if (!next.length) { if (footer) footer.remove(); return; }

    const keywords = _parseSearchQuery(_lastSearchQuery).keywords;
    const html = next.map((task, i) => _renderSearchRow(task, startIdx + i, keywords)).join('');
    if (footer) footer.insertAdjacentHTML('beforebegin', html);
    else container.insertAdjacentHTML('beforeend', html);

    _searchLoadedCount = startIdx + next.length;
    _lastSearchResults = _searchMatchedAll.slice(0, _searchLoadedCount);

    const remain = _searchMatchedAll.length - _searchLoadedCount;
    if (remain <= 0) { if (footer) footer.remove(); }
    else if (footer) footer.outerHTML = _renderSearchMoreFooter(remain);
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
    let fuzzyConflict = false; // 模糊时段词命中后由冲突检测回绕产生
    let dayOffset = 0;         // 相对日期的跨天偏移天数（明天=1 / 后天=2 / 大后天=3 / N天后=N）
    let lateNightWarning = false; // 凌晨时段(00:00-06:00) + 跨天相对日期 的提醒标记

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
        const foundList = lists.find(l => l.name === listName && !l.isFolder);
        if (foundList) {
            listId = foundList.id;
        }
        titleText = titleText.replace(listMatch[0], ' ');
        removedParts.push(listMatch[0]);
    }

    // 2.5 从标题中解析标签：#标签名（支持多个#标签，不存在则标记待创建）。
    // 必须单遍 replace 完成「提取 + 剥离」：此前在 exec 循环里边遍历边缩短字符串，
    // 全局正则的 lastIndex 仍指向旧串位置，会跳过紧邻的下一个 #标签
    // （多选标签后面板输入形如「#a #b 标题」，#b 会原样泄漏进任务标题）
    const tagIds = [];
    const tagNamesToCreate = [];
    titleText = titleText.replace(/#(\S+)/g, (full, name) => {
        let foundTag = (settings.tags || []).find(t => t.name === name);
        if (foundTag) {
            tagIds.push(foundTag.id);
        } else {
            // 标签不存在，标记待创建（不在输入时创建，避免中间状态）
            tagNamesToCreate.push(name);
        }
        removedParts.push(full);
        return ' ';
    });

    // 3. 解析日期和时间（先从标题解析，再从详情解析）
    // 设置项 cmdRemoveTimeText：是否从标题中移除已解析的日期/时间文字
    const removeTimeText = settings.cmdRemoveTimeText !== false;
    if (!startTime) {
        const titleDateResult = parseNLPDate(titleText);
        if (titleDateResult) {
            dayOffset = titleDateResult.dayOffset || 0;
            if (titleDateResult._fuzzyResolve) {
                // 模糊时段词：交由 resolveFuzzyTimeConflict 做顺延 + 冲突检测
                const resolved = resolveFuzzyTimeConflict(titleDateResult.date, titleDateResult._fuzzyResolve);
                startTime = resolved.startTime;
                isAllDay = false;
                endTime = null;
                repeat = null;
                fuzzyConflict = resolved.conflict;
            } else {
                startTime = titleDateResult.date;
                isAllDay = titleDateResult.isAllDay;
                endTime = titleDateResult.endTime || null;
                repeat = titleDateResult.repeat || null;
            }
            if (removeTimeText) {
                titleDateResult.matches.forEach(m => {
                    titleText = titleText.replace(m, ' ');
                });
            }
            removedParts.push(...titleDateResult.matches);
        }
    }

    // 3.5 相对时间词（稍后/等等/一会儿）：仅当未识别到任何日期/时间时生效
    if (!startTime) {
        const _relPrefs = settings.commandTimePrefs || {};
        let _laterMins = (typeof _relPrefs.laterMinutes === 'number') ? _relPrefs.laterMinutes : 15;
        _laterMins = Math.max(5, Math.min(120, _laterMins));
        for (let ri = 0; ri < FUZZY_RELATIVE_WORDS.length; ri++) {
            const rw = FUZZY_RELATIVE_WORDS[ri];
            if (titleText.indexOf(rw) !== -1) {
                const dt = new Date();
                dt.setMinutes(dt.getMinutes() + _laterMins, 0, 0);
                startTime = dt;
                isAllDay = false;
                removedParts.push(rw);
                if (removeTimeText) titleText = titleText.replace(rw, ' ');
                break;
            }
        }
    }
    if (!startTime && notes) {
        const notesDateResult = parseNLPDate(notes);
        if (notesDateResult) {
            dayOffset = notesDateResult.dayOffset || 0;
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

    // 3.6 凌晨提醒：当前处于 00:00-06:00 且命令使用了跨天相对日期（明天/后天/大后天/N天后）。
    //     凌晨时段用户口中的"明天"可能是其感知里的"当天"，故提示核对任务时间是否符合预期。
    const _curHour = new Date().getHours();
    lateNightWarning = !!(startTime && dayOffset >= 1 && _curHour >= 0 && _curHour < 6);

    // 4. 清理标题：去除多余空格和已解析的标识
    titleText = titleText.replace(/\s+/g, ' ').trim();
    notes = notes.replace(/\s+/g, ' ').trim();

    // 5. 设置项 defaultTaskDate：未识别到日期时的默认日期
    if (!startTime && settings.defaultTaskDate && settings.defaultTaskDate !== 'none') {
        const defaultDate = getDefaultTaskDate(settings.defaultTaskDate);
        if (defaultDate) {
            startTime = defaultDate;
            isAllDay = true;
        }
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
        removedParts,
        fuzzyConflict,
        lateNightWarning
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
    let _fuzzyResolve = null; // 命中模糊时段词时携带 {key,min,max,prefMin,text}，供 parseNLPInput 后处理
    // 相对日期的跨天偏移天数：明天=1 / 后天=2 / 大后天=3 / N天后=N；今天与具体日期=0。
    // 供 parseNLPInput 判断「凌晨时段 + 跨天相对日期」时给出提醒。
    let dayOffset = 0;

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
            dayOffset = days;
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

    // 半小时后 / 半小时以后（相对时间，设置具体时间点）
    if (!date || (date && hour === null)) {
        m = remaining.match(/半小时[以]?后/);
        if (m) {
            const targetDate = new Date(now.getTime() + 30 * 60 * 1000);
            if (!date) date = targetDate;
            hour = targetDate.getHours();
            minute = targetDate.getMinutes();
            isAllDay = false;
            periodSpecified = true; // 阻止智能时间修正
            matches.push(m[0]);
            remaining = remaining.replace(m[0], ' ');
        }
    }

    // 一个半小时后 / 1个半小时后（相对时间，设置具体时间点）
    if (!date || (date && hour === null)) {
        m = remaining.match(/(一|1)?个?半小?时[以]?后/);
        if (m) {
            const targetDate = new Date(now.getTime() + 90 * 60 * 1000);
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
            dayOffset = 3;
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
            dayOffset = 2;
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
            dayOffset = 1;
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
                // "下周X" = 下一个X（最近的未来X），与"本周X"算法一致
                // 例如周五输入"下周一" → 3天后（而非10天后）
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

    // --- 模糊时段词解析（上午/中午/下午/晚上）：取用户偏好时间 ---
    // 仅当未匹配到具体小时时生效（"上午10点"仍以 10 点为准）；命中后直接返回，
    // 日期/顺延/冲突检测交由 parseNLPInput 的 resolveFuzzyTimeConflict 后处理
    if (hour === null && !repeat) {
        const _fuzzyPrefs = settings.commandTimePrefs || {};
        for (const fw of FUZZY_TIME_WORDS) {
            const fm = remaining.match(fw.word);
            if (fm) {
                let prefMin = (typeof _fuzzyPrefs[fw.key] === 'number') ? _fuzzyPrefs[fw.key] : fw.defaultMin;
                prefMin = Math.max(fw.min, Math.min(fw.max, prefMin));
                let _fdate = date ? new Date(date) : new Date(now);
                _fdate.setHours(0, 0, 0, 0);
                matches.push(fm[0]);
                return {
                    date: _fdate,
                    isAllDay: false,
                    endTime: null,
                    repeat: null,
                    matches: matches,
                    dayOffset: dayOffset,
                    _fuzzyResolve: { key: fw.key, min: fw.min, max: fw.max, prefMin: prefMin, text: fm[0] }
                };
            }
        }
    }

    // 仅有时段没有具体时间
    if (!date && hour === null && !repeat) return null;

    // 智能时间解析
    // 未指定时段（上午/下午/晚上/凌晨）时，1-7 点自动视为下午（+12）
    if (hour !== null && !periodSpecified) {
        if (hour >= 1 && hour <= 7) hour += 12;
    }
    // 时间段的结束时间应用相同的智能修正，避免"3点到5点"被识别为 15:00-05:00
    if (endHour !== null && !periodSpecified) {
        if (endHour >= 1 && endHour <= 7) endHour += 12;
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

    // --- 跨天时间段：今天到明天 / 今天到后天 / 明天到后天 ---
    if (!endTime) {
        const dayKeywordMap = { '今天': 0, '明天': 1, '后天': 2, '大后天': 3 };
        m = text.match(/(今天|明天|后天|大后天)\s*[到至~\-]\s*(今天|明天|后天|大后天)/);
        if (m) {
            const startOffset = dayKeywordMap[m[1]];
            const endOffset = dayKeywordMap[m[2]];
            if (startOffset !== undefined && endOffset !== undefined && endOffset > startOffset) {
                const startDate = new Date(now);
                startDate.setDate(startDate.getDate() + startOffset);
                startDate.setHours(0, 0, 0, 0);

                const endDate = new Date(now);
                endDate.setDate(endDate.getDate() + endOffset);
                endDate.setHours(23, 59, 59, 0);

                date = startDate;
                endTime = endDate;
                isAllDay = true;
                matches.push(m[0]);
                // 从 remaining 中也移除该关键词，避免后续重复匹配
                remaining = remaining.replace(m[0], ' ');
            }
        }
    }

    return { date, isAllDay, endTime, repeat, matches, dayOffset };
}

// ==================== 模糊时段词后处理：顺延 + 冲突检测 ====================
// 开关 settings.commandTimePrefs.smartSchedule（设置项「模糊时间任务智能计划时间」，默认 true）：
//   开启 → 完整智能排程；关闭 → 仅按偏好时间排程（当天已过则次日），不检测任务冲突。
// 步长 step = settings.commandTimePrefs.timeGranularity（设置项「任务时间粒度」，默认 30，1-120）。
// 规则（开启时）：
//   1. 当天该偏好时间已过 → 同日区间[min,max]内取当前时刻之后下一个时间块；
//      区间内已无时间块 → 次日偏好值。
//   2. 冲突检测：按步长推进，时段内有任务则顺延；到区间上限仍冲突 →
//      放置到「任务量最少」的时段（并列时取最接近偏好值的时段）。
// baseDate: 已确定为当天 00:00 的日期；fw: { key, min, max, prefMin }
function resolveFuzzyTimeConflict(baseDate, fw) {
    const now = new Date();
    const _prefs = settings.commandTimePrefs || {};
    // 时间块粒度（分钟）：默认 30，允许 1-120（设置项「任务时间粒度」）
    const step = Math.max(1, Math.min(120,
        (typeof _prefs.timeGranularity === 'number') ? _prefs.timeGranularity : FUZZY_TIME_STEP));
    // 智能计划时间开关（默认开启）：关闭时仅按偏好时间排程，不做同日就近与冲突检测
    const smart = _prefs.smartSchedule !== false;
    // 区间右端点可能为 1440（24:00）：它只是文案边界，不能作为可放置时刻（1440 会回绕到次日 00:00），
    // 故实际可放置/可回绕的最大分钟数封顶到 1439；偏好值同样封顶，避免越界回绕。
    const maxSlot = Math.min(fw.max, 1439);
    const prefMin = Math.min(fw.prefMin, maxSlot);
    // 当前时刻之后的第一个时间块起点（以偏好时间为基准对齐，保证偏好值本身也是块起点）
    function firstSlotAfter(min) {
        return prefMin + Math.ceil((min + 1 - prefMin) / step) * step;
    }
    function mkDateTime(day, mins) {
        const d = new Date(day);
        d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
        return d;
    }
    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    function minsOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }
    // 冲突判定：该时段（FUZZY_TIME_STEP 分钟）内已有任务即视为冲突。
// 与回绕时的任务量统计口径保持一致，避免 15:10 的任务不被 15:00 视为冲突这类漏判。
    function hasConflict(d) {
        return countTasksInSlot(d, d.getHours() * 60 + d.getMinutes()) > 0;
    }
    // 统计某个时间块（step 分钟）内的任务数量（按 startTime 落入 [start, start+step) 判定）。
    // 用于回绕时挑选「任务量最少」的时段：时段内可能有非整点任务，故按范围而非精确时分统计。
    function countTasksInSlot(day, startMin) {
        const endMin = startMin + step;
        return tasks.reduce(function (n, t) {
            if (!t.startTime) return n;
            const td = new Date(t.startTime);
            if (!sameDay(td, day)) return n;
            const tm = td.getHours() * 60 + td.getMinutes();
            return (tm >= startMin && tm < endMin) ? n + 1 : n;
        }, 0);
    }

    // 1. 确定候选日期与时间
    let candidate = mkDateTime(baseDate, prefMin);
    if (sameDay(candidate, now) && candidate.getTime() <= now.getTime()) {
        if (!smart) {
            // 关闭智能计划：次日同一偏好时间
            candidate = mkDateTime(baseDate, prefMin);
            candidate.setDate(candidate.getDate() + 1);
        } else {
            // 已过：同日区间内取当前时刻之后的下一个时间块；区间内已无时间块 → 次日偏好值
            let next = firstSlotAfter(minsOfDay(now));
            if (next < fw.min) next = fw.min;
            if (next <= maxSlot) {
                candidate = mkDateTime(baseDate, next);
            } else {
                candidate = mkDateTime(baseDate, prefMin);
                candidate.setDate(candidate.getDate() + 1);
            }
        }
    }
    // 关闭智能计划：不检测任务冲突，直接返回
    if (!smart) return { startTime: candidate, conflict: false };

    // 2. 冲突检测顺延（在该词语区间内按步长推进）
    let conflict = false;
    const curDay = new Date(candidate);
    let curMin = minsOfDay(candidate);
    // 回绕统计的有效区间起点：当天时排除已过时段，未来日期取区间下限
    let effMin = fw.min;
    if (sameDay(candidate, now)) {
        effMin = Math.max(fw.min, firstSlotAfter(minsOfDay(now)));
    }
    while (hasConflict(candidate)) {
        curMin += step;
        if (curMin > maxSlot) {
            // 区间上限仍冲突 → 放置到「任务量最少」的时段（并列时取最接近偏好值的时段）
            let bestSlot = prefMin, bestCount = Infinity, bestDist = Infinity;
            for (let s = effMin; s <= maxSlot; s += step) {
                const cnt = countTasksInSlot(curDay, s);
                const dist = Math.abs(s - prefMin);
                // 同任务量时取最接近偏好值的时段；距离也相同时优先偏好值之后（保持「往后顺延」语义）
                const better = (cnt < bestCount)
                    || (cnt === bestCount && dist < bestDist)
                    || (cnt === bestCount && dist === bestDist && s >= prefMin && bestSlot < prefMin);
                if (better) { bestCount = cnt; bestDist = dist; bestSlot = s; }
            }
            candidate = mkDateTime(curDay, bestSlot);
            // 选中时段本就无任务时不应标记冲突
            conflict = bestCount > 0;
            break;
        }
        candidate = mkDateTime(curDay, curMin);
    }
    return { startTime: candidate, conflict: conflict };
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
        parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-soft dark:bg-accent-strong text-accent-dark dark:text-accent-light rounded text-xs"><i class="fas fa-calendar-alt"></i>${dateStr} ${timeStr}</span>`);
        // 模糊时段词命中后冲突回绕：提示该时间点已存在任务
        if (parsed.fuzzyConflict) {
            parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded text-xs"><i class="fas fa-exclamation-circle"></i>时间冲突</span>`);
        }
    }

    // 重复预览
    if (parsed.repeat) {
        const repeatLabels = {
            'daily': '每天',
            'weekly': '每周',
            'monthly': '每月',
            'yearly': '每年',
            'weeklyFirstWorkday': '每周首个工作日',
            'weeklyLastWorkday': '工作周期最后一个工作日',
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
        parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-soft dark:bg-accent-strong text-accent-dark dark:text-accent-light rounded text-xs"><i class="fas fa-star"></i>重要不紧急</span>`);
    } else if (parsed.urgent) {
        parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded text-xs"><i class="fas fa-clock"></i>紧急不重要</span>`);
    }

    const tagsHtml = parts.length > 0 ? `<div class="flex flex-wrap gap-1.5 mb-2">${parts.join('')}</div>` : '';
    // 凌晨提醒：紧贴在时间徽章下方（当前已过 0 点且用了"明天/后天"等跨天相对日期）
    // 结构与下方「创建任务」行保持一致（外层不设 text-*，图标按继承渲染；文字用 text-sm），
    // 使提示图标与 fa-plus-circle 同尺寸、提示文字与「创建任务」同字号。
    const lateNightHtml = parsed.lateNightWarning
        ? `<div class="flex items-center gap-2 mb-2 text-amber-500 dark:text-amber-400"><i class="fas fa-exclamation-circle"></i><span class="text-sm">当前已过凌晨0点，注意任务时间设置是否符合预期。</span></div>`
        : '';
    const notesHtml = parsed.notes ? `<div class="text-xs text-theme-secondary mt-1 ml-7 truncate"><i class="fas fa-align-left mr-1"></i>${escapeHtml(parsed.notes)}</div>` : '';

    return `<div class="px-5 py-4">
        ${tagsHtml}
        ${lateNightHtml}
        <div class="flex items-center gap-2">
            <i class="fas fa-plus-circle text-green-500"></i>
            <span class="text-sm text-theme-secondary">创建任务：</span>
            <span class="text-sm font-medium text-theme-primary">${escapeHtml(parsed.title)}</span>
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
        subtasks: [{ id: generateId(), text: '', completed: false, originalOrder: 0, startTime: null, reminders: [] }],
        progress: 0
    };

    tasks.push(newTask);
    saveData();
    renderLists();
    renderView();

    // 2行消息提示：第1行状态词（SUCCESS），第2行"任务标题（任务时间）"
    showToast(buildTaskToastMessage(newTask), 'success');
}

// ==================== 快捷键系统 ====================
// 单一注册表 + 单一派发器。除「固定快捷键」（见下）外，所有键位都能在「设置 → 快捷键」自定义。
// 注册表由两路合并而来（2026-10-17）：
//   · 原「组合键」：Ctrl+Alt 的大动作（命令面板 Ctrl+Alt+N、番茄专注 Ctrl+Alt+P）与 Alt+数字的视图切换
//   · 原「导航键」：无修饰键单键（N 新建任务、/ 搜索任务、K 看板 …）
// ⚠️ 迁移后**不再保留任何无修饰键的默认键位**：单键在浏览界面时极易误触（敲一下就弹新建任务）。
// ⚠️ 命名空间分两族（2026-10-17 最终方案，用户拍板）：
//     · 动作类（newTask / searchTasks / editCurrentTask / filterToday / shortcutsHelp / commandPalette / togglePomodoro）
//       → 统一 **Ctrl+Alt+字母**。其中命令面板从 Ctrl+Alt+N 挪到 **Ctrl+Alt+K**（沿用 GitHub 式
//       「命令面板 = K」惯例），把 N 让给「新建任务」，避免二者在 Ctrl+Alt 命名空间撞车。
//     · 视图类（viewTask~viewQuadrant + viewKanban + viewSummary）→ 统一 **Alt**（Alt+1~5 数字 + Alt+K 看板 + Alt+S 摘要）。
//       Alt+K / Alt+S 在主流浏览器均非菜单栏加速键（危险的是 Alt+F/E/T/H/V/B，已被赶到 Ctrl+Alt 命名空间），
//       故视图用裸 Alt+字母是安全的；而动作类一律 Ctrl+Alt，彻底避开浏览器菜单截胡。
//     派发器仍保留「无修饰键」分支（守卫：非输入焦点 + 无浮层打开），便于将来按需回退，当前无登记项。
// ⚠️ 固定快捷键不入注册表、不可自定义：撤销最近操作 Ctrl/Cmd+Z（trash.js:initUndoHotkey）、
//    关闭浮层 / 面板 Esc。二者只在帮助浮层里静态展示。
// ⚠️ 「完成 / 取消完成当前任务」的 Space 快捷键已整体移除：完成态只能通过勾选框修改。
const DEFAULT_SHORTCUTS = {
    commandPalette:  { ctrl: true,  alt: true,  shift: false, key: 'k', label: '命令面板' },
    togglePomodoro:  { ctrl: true,  alt: true,  shift: false, key: 'p', label: '番茄专注' },
    newTask:         { ctrl: true,  alt: true,  shift: false, key: 'n', label: '新建任务' },
    searchTasks:     { ctrl: true,  alt: true,  shift: false, key: 'f', label: '搜索任务' },
    editCurrentTask: { ctrl: true,  alt: true,  shift: false, key: 'e', label: '编辑当前任务' },
    filterToday:     { ctrl: true,  alt: true,  shift: false, key: 't', label: '今天' },
    viewTask:        { ctrl: false, alt: true,  shift: false, key: '1', label: '任务视图' },
    viewSchedule:    { ctrl: false, alt: true,  shift: false, key: '2', label: '日程视图' },
    viewWeek:        { ctrl: false, alt: true,  shift: false, key: '3', label: '周视图' },
    viewMonth:       { ctrl: false, alt: true,  shift: false, key: '4', label: '月视图' },
    viewQuadrant:    { ctrl: false, alt: true,  shift: false, key: '5', label: '四象限视图' },
    viewKanban:      { ctrl: false, alt: true,  shift: false, key: 'k', label: '看板' },
    viewSummary:     { ctrl: false, alt: true,  shift: false, key: 's', label: '摘要' },
    shortcutsHelp:   { ctrl: true,  alt: true,  shift: false, key: 'h', label: '快捷键帮助' }
};

// Ctrl/Cmd+Z 与 Esc 之外的键位都开放自定义；这两个键由各处在 keydown 里直接处理。
const FIXED_SHORTCUT_HINTS = [
    { label: '撤销最近操作', text: 'Ctrl+Z' },
    { label: '关闭浮层 / 面板', text: 'Esc' }
];

let _recordingShortcut = null;
let _resetAllShortcutsConfirming = false; // 「全部重置」两段式确认（二次点击才真正执行）
let _resetAllShortcutsTimer = null;

// ---- 单条读值口径 ----
// settings.shortcuts[key]：
//   undefined / 键不存在 → 沿用默认
//   组合对象            → 用户自定义键位
//   null                → 用户显式「不为该功能设置快捷键」（录入时按 Backspace）
// null 与 undefined 的区别只能靠 hasOwnProperty 判定，不能简写成 `settings.shortcuts[key] || DEFAULT`。
function _hasUserShortcut(key) {
    return !!(settings && settings.shortcuts && Object.prototype.hasOwnProperty.call(settings.shortcuts, key));
}

// 取生效的组合；返回 null = 该功能已停用快捷键
function getShortcutCombo(key) {
    const def = DEFAULT_SHORTCUTS[key];
    if (!def) return null;
    if (!_hasUserShortcut(key)) return { ...def };
    const v = settings.shortcuts[key];
    if (!v) return null;
    return {
        ctrl: !!v.ctrl, alt: !!v.alt, shift: !!v.shift,
        key: v.key,
        label: v.label || def.label
    };
}

function isShortcutDefault(key) {
    if (!_hasUserShortcut(key)) return true;
    const v = settings.shortcuts[key];
    if (!v) return false; // 停用 ≠ 默认：仍要给出「重置」入口
    const d = DEFAULT_SHORTCUTS[key];
    return !!v.ctrl === !!d.ctrl && !!v.alt === !!d.alt && !!v.shift === !!d.shift
        && String(v.key).toLowerCase() === String(d.key).toLowerCase();
}

// 生效清单（停用项不参与匹配、不进帮助浮层）
function getCurrentShortcuts() {
    const merged = {};
    for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
        const combo = getShortcutCombo(key);
        if (!combo) continue;
        if (!combo.label) combo.label = DEFAULT_SHORTCUTS[key].label;
        merged[key] = combo;
    }
    return merged;
}

// 快捷键随其它设置一样即时落盘（settings.shortcuts 属于 settings 的一部分）
function _saveShortcutSettings() {
    if (typeof saveData === 'function') saveData();
}

function formatShortcut(combo) {
    const parts = [];
    if (combo.ctrl) parts.push('Ctrl');
    if (combo.alt) parts.push('Alt');
    if (combo.shift) parts.push('Shift');
    if (combo.key) parts.push(String(combo.key).toUpperCase());
    return parts.join('+');
}

function checkShortcutConflict(shortcutKey, combo) {
    if (!combo) return null;
    const shortcuts = getCurrentShortcuts();
    for (const [key, existing] of Object.entries(shortcuts)) {
        if (key === shortcutKey) continue;
        if (existing.ctrl === !!combo.ctrl &&
            existing.alt === !!combo.alt &&
            existing.shift === !!combo.shift &&
            String(existing.key).toLowerCase() === String(combo.key).toLowerCase()) {
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
        case 'newTask':
            openAddTaskModal();
            break;
        case 'searchTasks':
            openCommandPaletteWithSearch();
            break;
        case 'editCurrentTask':
            _shortcutEditCurrentTask();
            break;
        case 'filterToday':
            filterToday();
            break;
        case 'shortcutsHelp':
            openShortcutsHelp();
            break;
        case 'viewTask': case 'viewSchedule': case 'viewWeek': case 'viewMonth':
        case 'viewQuadrant': case 'viewKanban': case 'viewSummary': {
            const viewMap = {
                viewTask: 'task', viewSchedule: 'schedule', viewWeek: 'week',
                viewMonth: 'month', viewQuadrant: 'quadrant', viewKanban: 'kanban', viewSummary: 'summary'
            };
            _shortcutSwitchView(viewMap[action]);
            break;
        }
    }
}

// E：编辑当前选中任务（详情面板当前任务 > 多选态最近点击任务；无当前任务时轻提示）
function _shortcutEditCurrentTask() {
    const id = (typeof getBatchCurrentTaskId === 'function') ? getBatchCurrentTaskId() : null;
    if (!id || !tasks.some(function (t) { return t.id === id && !t.deletedAt; })) {
        showToast('没有当前任务：请先打开任务详情或多选', 'info');
        return;
    }
    if (typeof isBatchSelectActive === 'function' && isBatchSelectActive()) exitBatchSelectMode();
    openTaskDetailPanel(id, false, true);
}

// 视图切换前先收起番茄专注全屏页
function _shortcutSwitchView(view) {
    const pomodoroPage = document.getElementById('pomodoro-page');
    if (pomodoroPage && !pomodoroPage.classList.contains('hidden')) closePomodoroPage();
    switchView(view);
}

// `/` 键：打开命令面板并预填 /s 进入搜索态（FR-08 入口）
function openCommandPaletteWithSearch() {
    openCommandPalette();
    const input = document.getElementById('command-palette-input');
    if (!input) return;
    input.value = '/s ';
    input.focus();
    handleCommandPaletteInput({});
}

document.addEventListener('keydown', function(e) {
    // 录入快捷键模式
    if (_recordingShortcut) {
        e.preventDefault();
        e.stopPropagation();

        const modifierKeys = ['Control', 'Alt', 'Shift', 'Meta'];
        if (modifierKeys.includes(e.key)) return;

        // Backspace / Delete：不为该功能设置快捷键（退格 = 清空键位，且立即落盘）
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const clearedKey = _recordingShortcut;
            if (!settings.shortcuts) settings.shortcuts = {};
            settings.shortcuts[clearedKey] = null; // null = 显式停用，区别于「未设置」
            _recordingShortcut = null;
            _saveShortcutSettings();
            renderShortcutsSettings();
            showToast('已取消「' + (DEFAULT_SHORTCUTS[clearedKey] ? DEFAULT_SHORTCUTS[clearedKey].label : clearedKey) + '」的快捷键', 'success');
            return;
        }
        // Esc：放弃本次录制，保留原键位
        if (e.key === 'Escape') {
            _recordingShortcut = null;
            renderShortcutsSettings();
            return;
        }

        const hasModifier = e.ctrlKey || e.altKey || e.shiftKey;
        if (!hasModifier) {
            const recordingBtn = document.querySelector(`[data-shortcut-key="${_recordingShortcut}"] .shortcut-record-btn`);
            if (recordingBtn) {
                recordingBtn.textContent = '需要修饰键';
                setTimeout(() => {
                    if (_recordingShortcut) {
                        recordingBtn.textContent = '请按下快捷键…';
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
            label: (DEFAULT_SHORTCUTS[_recordingShortcut] || {}).label
        };

        _recordingShortcut = null;
        _saveShortcutSettings();
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
    // C4-1：IME 组字期间一律不响应全局快捷键（不吞字、不误触发）
    if (e.isComposing) return;

    // ? 由 Shift+/ 产出，按 e.key 原值匹配；其余键小写化匹配
    const evKey = (e.key === '?') ? '?' : (e.key || '').toLowerCase();
    const shortcuts = getCurrentShortcuts(); // 已排除「不设置快捷键」的功能
    const _t = e.target;
    const inEditable = !!(_t && (_t.tagName === 'INPUT' || _t.tagName === 'TEXTAREA' || _t.isContentEditable));

    // 单键分支：仅无修饰键单键命中（沿用原导航键层的守卫 C4-2/C4-4：
    // 输入焦点内不响应、任意浮层打开时不响应）。单键与组合键共用同一张注册表，
    // 区别只在这里多两道守卫 —— 单键不会在写字时误触发。
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (inEditable) return;
        if (typeof isAnyOverlayOpen === 'function' && isAnyOverlayOpen()) return;
        for (const [action, combo] of Object.entries(shortcuts)) {
            if (!combo.ctrl && !combo.alt && !combo.shift && String(combo.key).toLowerCase() === evKey) {
                e.preventDefault();
                executeShortcutAction(action);
                return;
            }
        }
        return; // 无修饰键的其余键不参与组合键匹配
    }

    // FR-03 多选态组合键：Ctrl/Cmd+A 全选、Ctrl/Cmd+Backspace 删除选中（破坏性操作必须用组合键）。
    // C4-2：输入焦点内不拦截（保留输入框原生 Ctrl+A 全选 / Ctrl+Backspace 删词）
    if ((e.ctrlKey || e.metaKey) && !e.altKey
        && typeof isBatchSelectActive === 'function' && isBatchSelectActive()) {
        if (!inEditable) {
            if (e.key.toLowerCase() === 'a') {
                e.preventDefault();
                if (typeof toggleSelectAllBatchTasks === 'function') toggleSelectAllBatchTasks();
                return;
            }
            if (e.key === 'Backspace') {
                e.preventDefault();
                // skipConfirm：组合键本身已是 deliberate 门槛，直接执行（按钮点击才走二次确认）
                if (typeof batchDeleteSelected === 'function') batchDeleteSelected(true);
                return;
            }
        }
    }

    for (const [action, combo] of Object.entries(shortcuts)) {
    // C4-2 收严（2026-10-17）：输入焦点内只放行 Ctrl 系组合键（Ctrl+Alt+X 等），
    // Alt+X（视图类，如 Alt+K 看板 / Alt+1 视图）一律让位给文本框自身的按键处理 —— 否则在备注里打字时
    // 顺手按 Alt+K 会误切视图，等于把视图组合键又变成误触源。
        // Ctrl+Alt+X 之所以放行：既有的命令面板 / 番茄专注等高频入口依赖这条通道，
        // 且 Ctrl+Alt+字母不与浏览器任何文本编辑快捷键冲突。
        if (inEditable && !combo.ctrl) continue;
        if (e.ctrlKey === !!combo.ctrl &&
            e.altKey === !!combo.alt &&
            e.shiftKey === !!combo.shift &&
            String(combo.key).toLowerCase() === evKey) {
            e.preventDefault();
            executeShortcutAction(action);
            return;
        }
    }
});

// 3 栏网格：功能补全后共 14 项，一栏会拖得过长；每格「标签一行 + 键位一行」，
// 竖排比左右分栏更抗压（栏宽约 190px，键位按钮也不至于挤成省略号）。
function renderShortcutsSettings() {
    const container = document.getElementById('shortcuts-settings-container');
    if (!container) return;

    let html = '<div class="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">';

    for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
        const combo = getShortcutCombo(key);           // null = 用户未给该功能设置快捷键
        const label = DEFAULT_SHORTCUTS[key].label;
        const disabled = combo === null;
        const isRecording = _recordingShortcut === key;
        let displayText;
        if (isRecording) displayText = '请按下快捷键…';
        else if (disabled) displayText = '未设置';
        else displayText = formatShortcut(combo);
        const btnClass = isRecording
            ? 'border-accent bg-accent text-white'
            : (disabled
                ? 'border-dashed border-theme text-theme-muted hover:bg-theme-tertiary'
                : 'border-theme bg-theme-tertiary text-theme-primary hover:bg-theme-secondary');

        html += `
            <div class="flex flex-col gap-1 min-w-0" data-shortcut-key="${key}">
                <div class="flex items-center gap-1 min-w-0">
                    <span class="flex-1 min-w-0 truncate text-xs text-theme-secondary" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
                    <span class="flex-shrink-0 w-5 inline-flex items-center justify-center ${isShortcutDefault(key) ? 'invisible' : ''}"><button class="p-0.5 text-theme-muted hover:text-theme-primary transition" onclick="resetShortcut('${key}')" title="重置为默认"><i class="fas fa-undo text-xs"></i></button></span>
                </div>
                <button class="shortcut-record-btn w-full px-2 py-1.5 text-xs border rounded-lg transition text-center truncate ${btnClass}"
                        onclick="startShortcutRecording('${key}')"
                        title="${isRecording ? '按下新快捷键；Backspace 不设置，Esc 取消' : (disabled ? '未设置快捷键，点击录制' : '点击修改快捷键')}">
                    ${escapeHtml(displayText)}
                </button>
            </div>`;
    }

    html += '</div>';
    html += `<div id="shortcut-conflict-warning" class="hidden text-xs text-red-500 mt-1"></div>`;
    html += `<div class="flex justify-between items-center mt-3">`;
    html += `<button class="px-3 py-1.5 text-xs text-theme-muted hover:text-theme-primary border border-theme rounded-lg transition" onclick="openShortcutsHelp()"><i class="fas fa-keyboard mr-1"></i>查看所有快捷键</button>`;
    html += `<button class="px-3 py-1.5 text-xs border rounded-lg transition ${_resetAllShortcutsConfirming ? 'border-red-500 bg-red-500 text-white' : 'text-theme-muted hover:text-theme-primary border-theme'}" onclick="requestResetAllShortcuts()" title="${_resetAllShortcutsConfirming ? '再次点击确认重置全部快捷键' : '重置全部快捷键为默认'}">${_resetAllShortcutsConfirming ? '再次点击确认重置' : '全部重置'}</button>`;
    html += `</div>`;

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
    _saveShortcutSettings();
    renderShortcutsSettings();
}

function requestResetAllShortcuts() {
    // 两段式确认：首次点击进入待确认态（按钮变红 + 文案提示），3 秒内再次点击才真正重置
    if (!_resetAllShortcutsConfirming) {
        _resetAllShortcutsConfirming = true;
        renderShortcutsSettings();
        _resetAllShortcutsTimer = setTimeout(function () {
            _resetAllShortcutsConfirming = false;
            _resetAllShortcutsTimer = null;
            renderShortcutsSettings();
        }, 3000);
        return;
    }
    // 二次确认：执行全部重置
    clearTimeout(_resetAllShortcutsTimer);
    _resetAllShortcutsTimer = null;
    _resetAllShortcutsConfirming = false;
    if (settings) {
        settings.shortcuts = {};
    }
    _saveShortcutSettings();
    renderShortcutsSettings();
}

// ==================== 快捷键帮助浮层（FR-04 一期） ====================
let _shortcutsHelpEscBound = false;

function openShortcutsHelp() {
    const modal = document.getElementById('shortcuts-help-modal');
    if (!modal) return;
    const content = document.getElementById('shortcuts-help-content');
    if (content) content.innerHTML = renderShortcutsHelpContent();
    // Esc 惰性绑定（对齐 openBgDirBrowser 范式）
    if (!_shortcutsHelpEscBound) {
        _shortcutsHelpEscBound = true;
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            const m = document.getElementById('shortcuts-help-modal');
            if (m && !m.classList.contains('hidden')) closeShortcutsHelp();
        });
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeShortcutsHelp() {
    const modal = document.getElementById('shortcuts-help-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function _helpKbd(text) {
    return `<kbd class="px-1.5 py-0.5 bg-theme-tertiary text-theme-primary border border-theme rounded text-xs font-mono min-w-[2.5rem] text-center inline-block">${escapeHtml(text)}</kbd>`;
}

// 帮助内容四区：① 快捷键（导航键与组合键合并，全部可自定义）② 固定快捷键 ③ 批量管理 ④ 搜索语法
function renderShortcutsHelpContent() {
    let html = `<div>
        <h3 class="text-sm font-semibold text-theme-secondary mb-2">快捷键</h3>
        <div class="grid grid-cols-2 gap-x-6 gap-y-0.5">`;
    const combos = getCurrentShortcuts();
    for (const combo of Object.values(combos)) {
        html += _helpRow(escapeHtml(combo.label || ''), formatShortcut(combo));
    }
    html += `</div></div>`;

    html += `<div>
        <h3 class="text-sm font-semibold text-theme-secondary mb-2">固定快捷键</h3>
        <div class="space-y-0.5">`;
    for (const fixed of FIXED_SHORTCUT_HINTS) {
        html += _helpRow(escapeHtml(fixed.label), fixed.text);
    }
    html += `</div></div>`;

    html += `<div>
        <h3 class="text-sm font-semibold text-theme-secondary mb-2">任务视图批量管理</h3>
        <div class="space-y-1.5">
            <div class="flex items-center justify-between py-0.5">
                <span class="text-sm text-theme-primary">全选（多选态）</span>
                ${_helpKbd('Ctrl+A')}
            </div>
            <div class="flex items-center justify-between py-0.5">
                <span class="text-sm text-theme-primary">删除选中项（多选态）</span>
                ${_helpKbd('Ctrl+Backspace')}
            </div>
            <div class="flex items-center justify-between py-0.5">
                <span class="text-sm text-theme-primary">退出多选态</span>
                ${_helpKbd('Esc')}
            </div>
            <div class="text-xs text-theme-muted pt-1 space-y-0.5">
                <div>顶部「批量管理」按钮或命令面板 <span class="font-mono text-theme-primary">/select 关键词</span> 进入多选态</div>
                <div>多选态内：点击 = 选中，<span class="font-mono text-theme-primary">Shift+点击</span> = 连续区间，<span class="font-mono text-theme-primary">Ctrl+点击</span> = 离散补选；点分组前的方块可整组勾选</div>
                <div>退出多选需点击「退出多选」后二次确认；主动退出会恢复进入前的任务详情栏</div>
            </div>
        </div>
    </div>`;

    // 搜索语法：左右分离式（左 = 语法，右 = 含义），不用居中破折号串写，扫读更快
    html += `<div>
        <h3 class="text-sm font-semibold text-theme-secondary mb-2">搜索语法</h3>
        <div class="space-y-1">`;
    const searchSyntax = [
        ['/s 关键词', '搜索标题 / 备注 / 子任务 / 标签 / 清单名'],
        ['~清单名', '限定清单（如 ~工作）'],
        ['#标签名', '限定标签（如 #重要）'],
        ['is:已完成 / is:未完成', '完成态'],
        ['is:今天 / is:逾期 / is:无日期', '时间态']
    ];
    for (const [syntax, desc] of searchSyntax) {
        html += `<div class="flex items-baseline gap-3">
            <span class="flex-shrink-0 font-mono text-xs text-theme-primary truncate" style="width: 12rem;" title="${escapeHtml(syntax)}">${escapeHtml(syntax)}</span>
            <span class="flex-1 text-xs text-theme-secondary">${escapeHtml(desc)}</span>
        </div>`;
    }
    html += `<div class="text-xs text-theme-muted pt-1">多条件用空格分隔，语义为 AND；按 Enter 记入搜索历史</div>`;
    html += `</div></div>`;
    return html;
}

// 帮助浮层的一行：左侧功能名 / 右侧键位
function _helpRow(labelHtml, comboText) {
    return `<div class="flex items-center justify-between gap-2 py-0.5 min-w-0">
            <span class="text-sm text-theme-primary truncate">${labelHtml}</span>
            ${_helpKbd(comboText)}
        </div>`;
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
    return div.innerHTML.replace(/"/g, '&quot;');
}
