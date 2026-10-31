// markdown.js — FR-10 Markdown 渲染（零依赖，离线版可用）
//
// 设计约束（《需求说明书_任务操作增强》FR-10）：
//   · 自研渲染器，不引入 marked / markdown-it 等外部库；
//   · 先转义后组装，链接/图片 URL 走白名单，禁止 HTML 直通；
//   · 详情面板备注采用「行级失焦渲染」：光标所在行显示源码，其余行渲染；围栏代码块整体保留；
//   · 行级编辑器同时服务三处：文本模式备注、子任务模式「任务详情描述」、模板编辑面板的备注/描述；
//     编辑器把整篇源码同步回各自的隐藏 textarea（DOM 权威），各保存链路无需改动。
//
// 依赖（运行时解析）：settings / tasks / currentDetailTaskId / currentTaskMode /
// detailReadOnly / scheduleWriteModeAutoSave / updateWriteModeGlassBounds / showToast

/* ==================== 基础工具 ==================== */

function mdEscapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// 链接/图片白名单：http(s)、站内绝对路径（含 /api/attachments/）、./ ../ 相对路径、页内 #
// 其余协议（javascript: / vbscript: / data: / file: 等）一律拒绝。
function mdSanitizeUrl(raw) {
    const url = String(raw == null ? '' : raw).trim();
    if (!url) return null;
    // 反斜杠/控制字符/尖括号/引号会被部分浏览器归一化成协议分隔符或破坏属性，直接拒绝
    if (/[\u0000-\u001f\u007f\\<>"']/.test(url)) return null;
    const probe = url.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
    if (/^(javascript|vbscript|data|file|blob):/.test(probe)) return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (/^\/(?!\/)/.test(url)) return url;
    if (/^\.{1,2}\//.test(url)) return url;
    if (/^#/.test(url)) return url;
    // 无协议的相对路径；显式拒绝协议相对地址 //evil.com
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^\/\//.test(url)) return url;
    return null;
}

function mdNormalizeSource(src) {
    return String(src == null ? '' : src).replace(/\r\n?/g, '\n');
}

function mdIsBlankLine(line) {
    return /^\s*$/.test(line);
}

/* ==================== 行内解析 ==================== */

function mdInlineEmphasis(str) {
    let s = String(str == null ? '' : str);
    s = s.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^\n]+?)__/g, '<strong>$1</strong>');
    s = s.replace(/~~([^\n]+?)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
    return s;
}

function mdInline(text) {
    let s = String(text == null ? '' : text);
    const store = [];
    const tok = function (html) {
        store.push(html);
        return '\u0000' + (store.length - 1) + '\u0000';
    };

    // 1) 行内代码优先占位，避免其中的 * _ ~ [] 被后续规则误解析
    s = s.replace(/`([^`\n]+)`/g, function (_, code) {
        return tok('<code class="md-inline-code">' + mdEscapeHtml(code) + '</code>');
    });
    // 2) 反斜杠转义（代码块外）：\* 等按字面量显示
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~>])/g, function (_, ch) {
        return tok(mdEscapeHtml(ch));
    });
    // 3) 图片
    s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, function (all, alt, url, title) {
        const safe = mdSanitizeUrl(url);
        if (!safe) return all;
        return tok('<img class="md-img" src="' + mdEscapeHtml(safe) + '" alt="' + mdEscapeHtml(alt) + '" loading="lazy"'
            + (title ? ' title="' + mdEscapeHtml(title) + '"' : '') + '>');
    });
    // 4) 链接
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, function (all, label, url, title) {
        const safe = mdSanitizeUrl(url);
        if (!safe) return all;
        return tok('<a class="md-link" href="' + mdEscapeHtml(safe) + '" target="_blank" rel="noopener noreferrer"'
            + (title ? ' title="' + mdEscapeHtml(title) + '"' : '') + '>'
            + mdInlineEmphasis(mdEscapeHtml(label)) + '</a>');
    });

    // 5) 其余文本统一转义后再套强调/换行
    s = mdEscapeHtml(s);
    s = mdInlineEmphasis(s);
    s = s.replace(/\n/g, '<br>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
        return store[+i] || '';
    });
}

/* ==================== 块解析 ==================== */

// 行级块模型：每个非空行、空行都是一个可独立编辑的块；围栏代码块整体作为一个块。
// start/end 为该行（或代码块）在源码中的字符偏移；行块 raw 不含行尾换行。
function mdParseListLine(raw) {
    let m = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    let indent, marker, content, noSpace = false;
    if (m) {
        indent = m[1];
        marker = m[2];
        content = m[3];
    } else {
        // 兼容「1.内容」这种没有空格的编号输入；数字超过两位（如 2024.年度）不当作列表
        m = raw.match(/^(\s*)(\d{1,2}[.)])([^\d\s].*)$/);
        if (!m) return null;
        indent = m[1];
        marker = m[2];
        content = m[3];
        noSpace = true;
    }
    const ordered = /^\d/.test(marker);
    const number = ordered ? (parseInt(marker, 10) || 1) : 0;
    const delim = ordered ? marker.slice(-1) : '';
    const rest = raw.slice(indent.length + marker.length);
    const wsLen = noSpace ? 0 : (rest.match(/^\s+/) || [''])[0].length;
    const prefixLen = indent.length + marker.length + wsLen;
    const taskMatch = content.match(/^\[([ xX])\]\s+(.*)$/);
    return {
        indent: indent,
        marker: marker,
        ordered: ordered,
        number: number,
        delim: delim,
        prefixLen: prefixLen,
        task: !!taskMatch,
        checked: taskMatch ? taskMatch[1].toLowerCase() === 'x' : false,
        content: taskMatch ? taskMatch[2] : content
    };
}

function mdParseBlocks(src) {
    const source = mdNormalizeSource(src);
    if (!source) return [];
    const lines = source.split('\n');
    const starts = [];
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
        starts[i] = off;
        off += lines[i].length + 1;
    }

    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const start = starts[i];
        const end = start + line.length;

        // 围栏代码块：内部空行不切块，未闭合则吞到文末
        let m = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (m) {
            const fence = m[1];
            const fenceChar = fence.charAt(0);
            const fenceLen = fence.length;
            const closeRe = new RegExp('^\\s*' + (fenceChar === '`' ? '`' : '~') + '{' + fenceLen + ',}\\s*$');
            let j = i + 1;
            while (j < lines.length && !closeRe.test(lines[j])) j++;
            const closed = j < lines.length;
            const lastLine = closed ? j : lines.length - 1;
            const codeStartLine = i + 1;
            const codeEndLine = closed ? j - 1 : lines.length - 1;
            const codeText = codeEndLine >= codeStartLine
                ? lines.slice(codeStartLine, codeEndLine + 1).join('\n')
                : '';
            const codeEnd = starts[lastLine] + lines[lastLine].length;
            blocks.push({
                type: 'code',
                start: start,
                end: codeEnd,
                raw: source.slice(start, codeEnd),
                fenced: true,
                lang: (m[2] || '').trim(),
                codeText: codeText
            });
            i = lastLine + 1;
            continue;
        }

        if (mdIsBlankLine(line)) {
            blocks.push({ type: 'blank', start: start, end: end, raw: line });
            i++;
            continue;
        }

        // 标题 # ~ ###
        m = line.match(/^(#{1,3})\s+(.*)$/);
        if (m) {
            blocks.push({ type: 'heading', start: start, end: end, raw: line, level: m[1].length, text: m[2] });
            i++;
            continue;
        }

        // 分割线
        if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
            blocks.push({ type: 'hr', start: start, end: end, raw: line });
            i++;
            continue;
        }

        // 引用：每一行独立的引用行
        if (/^\s*>/.test(line)) {
            blocks.push({
                type: 'quote',
                start: start,
                end: end,
                raw: line,
                text: line.replace(/^\s*>\s?/, '')
            });
            i++;
            continue;
        }

        // 列表 / 任务列表：每一行独立的列表行，便于行级编辑与编号递增
        const list = mdParseListLine(line);
        if (list) {
            blocks.push(Object.assign({
                type: 'li',
                start: start,
                end: end,
                raw: line,
                taskOffset: list.task ? start + list.prefixLen : null
            }, list));
            i++;
            continue;
        }

        // 普通行
        blocks.push({ type: 'p', start: start, end: end, raw: line });
        i++;
    }
    return blocks;
}

/* ==================== 块渲染 ==================== */

// 列表层级：4 空格（或 1 个 Tab）为一级；仅用于选择项目符号，布局仍复用源码缩进
function mdListDepth(indent) {
    let cols = 0;
    const text = String(indent || '');
    for (let i = 0; i < text.length; i++) cols += text.charAt(i) === '	' ? 4 : 1;
    return Math.min(8, Math.floor(cols / 4));
}

function mdRenderBlock(block, source, opts) {
    const readOnly = !!(opts && opts.readOnly);
    switch (block.type) {
        case 'code': {
            const lang = block.lang ? ' data-lang="' + mdEscapeHtml(block.lang) + '"' : '';
            return '<pre class="md-code"' + lang + '><code>' + mdEscapeHtml(block.codeText || '') + '</code></pre>';
        }
        case 'heading': {
            const level = Math.max(1, Math.min(3, block.level || 1));
            return '<h' + level + ' class="md-h' + level + '">' + mdInline(block.text || '') + '</h' + level + '>';
        }
        case 'hr':
            return '<hr class="md-hr">';
        case 'quote':
            return '<div class="md-quote-row">' + mdInline(block.text || '') + '</div>';
        case 'li': {
            // 缩进直接复用源码前导空格：编辑态 textarea 与渲染行使用同一字体/同一串空格，
            // 标记和正文的起始 x 才能完全一致（不再用固定 1.2em/级近似）。
            const indentHtml = '<span class="md-li-indent">' + mdEscapeHtml(block.indent || '') + '</span>';
            if (block.task) {
                return '<div class="md-task-item' + (block.checked ? ' md-task-done' : '') + '">'
                    + indentHtml
                    + '<input type="checkbox" class="md-task-checkbox" data-md-task-offset="' + block.taskOffset + '"'
                    + (block.checked ? ' checked' : '')
                    + (readOnly ? ' disabled' : '')
                    + ' aria-label="切换完成状态">'
                    + '<span class="md-task-text">' + mdInline(block.content || '') + '</span>'
                    + '</div>';
            }
            const depth = mdListDepth(block.indent);
            const bullet = ['•', '◦', '▪'][depth % 3];
            const markerHtml = block.ordered
                ? '<span class="md-li-marker">' + mdEscapeHtml(block.marker) + ' </span>'
                : '<span class="md-li-marker md-li-bullet" data-md-bullet="' + mdEscapeHtml(bullet) + '">' + mdEscapeHtml(block.marker) + ' </span>';
            return '<div class="md-li-row">'
                + indentHtml
                + markerHtml
                + '<span class="md-li-text">' + mdInline(block.content || '') + '</span>'
                + '</div>';
        }
        case 'blank':
            return '<div class="md-blank" aria-hidden="true"></div>';
        case 'p':
        case 'paragraph':
        default:
            return '<div class="md-p md-p-line">' + mdInline(block.raw) + '</div>';
    }
}

// 整篇渲染（只读展示 / 测试用；编辑器按行渲染以支持局部编辑）
function renderMarkdown(src, opts) {
    const source = mdNormalizeSource(src);
    return mdParseBlocks(source).map(function (b) {
        return mdRenderBlock(b, source, opts || {});
    }).join('');
}

/* ==================== 纯文本投影（提醒 Toast / 系统通知预览） ==================== */
// 提醒 Toast 是窄卡片（普通正文默认 2 行，含列表最多 6 行），不承载富文本；
// 这里把 Markdown 源文投影成「可读的纯文本」：
//   · 标题/段落/引用/列表各占一行；空行与分割线丢弃；
//   · 列表保留层级：无序 - 、有序 1. 、任务列表 ☐/☑，缩进统一 2 空格/级；
//   · 链接只保留文字，图片统一 [图片]，行内代码/强调标记去掉；
//   · 代码块压成一行（Toast 不是代码阅读器）。
// 与编辑器同源：块切分复用 mdParseBlocks，行内解析与 mdInline 同序同规则，
// 只是输出纯文字、不生成 HTML，避免把富文本渲染/图片加载带进通知路径。

// 行内强调去标记。与 mdInlineEmphasis 的规则逐条对应，只是输出文字而不是 <strong>。
// ⚠️ mdInlineEmphasis / mdInline 的规则若有调整，必须同步这里。
function mdInlineEmphasisToPlain(str) {
    let s = String(str == null ? '' : str);
    s = s.replace(/\*\*([^\n]+?)\*\*/g, '$1');
    s = s.replace(/__([^\n]+?)__/g, '$1');
    s = s.replace(/~~([^\n]+?)~~/g, '$1');
    s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1$2');
    s = s.replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1$2');
    return s;
}

// 行内 Markdown → 纯文本。顺序与 mdInline 一致：行内代码 → 转义 → 图片 → 链接 → 强调。
// ⚠️ 这里只产出纯文字，不产出 HTML；最终由 Toast 的 _toastEscape 统一转义。
function mdInlineToPlain(text) {
    let s = String(text == null ? '' : text);
    const store = [];
    const tok = function (txt) {
        store.push(txt);
        return '\u0000' + (store.length - 1) + '\u0000';
    };

    // 1) 行内代码：内容原样保留（不参与后续强调/链接解析）
    s = s.replace(/`([^`\n]+)`/g, function (_, code) { return tok(code); });
    // 2) 反斜杠转义：还原字面量
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~>])/g, function (_, ch) { return tok(ch); });
    // 3) 图片：不展开 URL，也不读取 alt（粘贴截图时 alt 往往是长文件名）
    s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, function () {
        return tok('[图片]');
    });
    // 4) 链接：只保留文字
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, function (_, label) {
        return tok(mdInlineEmphasisToPlain(label));
    });
    // 5) 其余文字去强调标记
    s = mdInlineEmphasisToPlain(s);
    // 6) 行内换行折叠为空格（块级换行由 mdToPlainText 负责）
    s = s.replace(/\r?\n/g, ' ');
    // 7) 还原占位
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
        return store[+i] || '';
    });
}

// 块级 Markdown → 纯文本。
// opts:
//   preserveLineBreaks  默认 true；false 时所有块压成一行（系统通知等单行场景）
//   listIndent          列表缩进空格/级，默认 2
//   maxDepth            最大缩进层级，默认 6（防止深层列表把正文挤没）
function mdToPlainText(src, opts) {
    opts = opts || {};
    const preserveLineBreaks = opts.preserveLineBreaks !== false;
    const listIndent = Math.max(1, Math.min(4, parseInt(opts.listIndent, 10) || 2));
    const maxDepth = Math.max(1, Math.min(8, parseInt(opts.maxDepth, 10) || 6));
    const source = mdNormalizeSource(src);
    if (!source.trim()) return '';

    const lines = [];
    mdParseBlocks(source).forEach(function (block) {
        if (block.type === 'blank' || block.type === 'hr') return;

        if (block.type === 'code') {
            // 代码块压成一行；围栏和语言标记都不进入预览
            const code = String(block.codeText || '').replace(/\s+/g, ' ').trim();
            if (code) lines.push(code);
            return;
        }

        if (block.type === 'li') {
            const depth = Math.min(maxDepth, mdListDepth(block.indent || ''));
            const pad = new Array(depth * listIndent + 1).join(' ');
            let marker = '- ';
            if (block.task) marker = block.checked ? '☑ ' : '☐ ';
            else if (block.ordered) marker = (block.number || 1) + '. ';
            const text = mdInlineToPlain(block.content || '').trim();
            // 空列表项通常是输入过程中的空行，不占提醒卡的行数
            if (text) lines.push(pad + marker + text);
            return;
        }

        const text = mdInlineToPlain(
            block.text != null ? block.text : block.raw
        ).trim();
        if (text) lines.push(text);
    });

    let out = lines.join(preserveLineBreaks ? '\n' : ' ');
    if (!preserveLineBreaks) out = out.replace(/[ \t]+/g, ' ');
    return out.trim();
}

// 源文是否含列表块（用于 Toast 的 6 行截断档）。
// 判断源文而不是投影结果：`\- 不是列表` 这类转义行投影后会以 "- " 开头，
// 但它在源文里是段落，不应放宽截断；反过来空列表项也能被正确识别。
function mdHasListBlocks(src) {
    const source = mdNormalizeSource(src);
    if (!source.trim()) return false;
    return mdParseBlocks(source).some(function (block) {
        return block.type === 'li';
    });
}

/* ==================== 任务列表勾选 ==================== */

function mdToggleTaskAt(source, offset) {
    if (!source || source.charAt(offset) !== '[') return null;
    const inner = source.charAt(offset + 1);
    if (inner !== ' ' && inner !== 'x' && inner !== 'X') return null;
    const next = inner === ' ' ? 'x' : ' ';
    return source.slice(0, offset + 1) + next + source.slice(offset + 2);
}

/* ==================== 行级编辑器（备注 / 子任务描述 / 模板编辑区共用） ==================== */
// 同一时刻右栏只会打开一个编辑区（详情面板的备注或描述、模板编辑面板），
// 因此编辑器状态仍保持单例，只把「目标 textarea / 渲染容器」参数化。
const _mdEditor = {
    target: null,          // { kind, textareaId, editorId, editorClass, placeholder, readOnly, allowAttachmentPaste, afterSync, onSave, onShowTextarea }
    source: '',
    blocks: [],
    activeStart: null,
    activeTextarea: null,
    readOnly: false,
    emptyPad: 0,
    pendingRender: false,
    composing: false
};

function _mdNotesEl() {
    // 固定指向备注 textarea：附件粘贴/替换等流程只作用于备注
    return document.getElementById('detail-task-notes');
}

function _mdTargetEl() {
    const target = _mdEditor.target;
    return target ? document.getElementById(target.textareaId) : null;
}

function _mdEditorEl() {
    const target = _mdEditor.target;
    return target ? document.getElementById(target.editorId) : null;
}

function _ensureMdEditorCss() {
    if (document.getElementById('md-editor-css')) return;
    const style = document.createElement('style');
    style.id = 'md-editor-css';
    style.textContent = `
        .md-editor { color: var(--text-primary); font-size: 16px; line-height: 1.7; cursor: text; }
        .md-editor.hidden { display: none !important; }
        .md-editor-desc { flex: 1 1 auto; min-width: 0; min-height: 36px; overflow: visible; }
        .md-editor-tpl { width: 100%; min-height: 36px; overflow: visible; }
    `;
    document.head.appendChild(style);
}

function _mdEnsureEditorEl() {
    const target = _mdEditor.target;
    const ta = _mdTargetEl();
    if (!target || !ta || !ta.parentNode) return null;
    let el = _mdEditorEl();
    if (el) return el;
    _ensureMdEditorCss();
    el = document.createElement('div');
    el.id = target.editorId;
    el.className = 'md-editor hidden' + (target.editorClass ? ' ' + target.editorClass : '');
    el.setAttribute('role', 'document');
    ta.parentNode.insertBefore(el, ta.nextSibling);
    _mdBindEditorEvents(el);
    if (target.kind === 'notes' && typeof _initWmGlass === 'function') _initWmGlass(); // 书写态毛玻璃测量补挂监听
    if (typeof ResizeObserver !== 'undefined') {
        let lastWidth = -1;
        el._mdWidthObserver = new ResizeObserver(function () {
            if (_mdEditorEl() !== el) return;
            // 只响应宽度变化：_mdAutoGrow 改高度会再次触发观察器，按高度响应会自激
            const w = Math.round(el.getBoundingClientRect().width);
            if (w > 0 && w !== lastWidth) {
                lastWidth = w;
                if (_mdEditor.activeTextarea) _mdAutoGrow(_mdEditor.activeTextarea);
            }
        });
        el._mdWidthObserver.observe(el);
    }
    return el;
}

function _mdIsMarkdownOn() {
    return (typeof settings === 'undefined' || !settings) ? true : settings.notesMarkdown !== false;
}

function _mdCurrentTask() {
    if (typeof tasks === 'undefined' || typeof currentDetailTaskId === 'undefined') return null;
    return tasks.find(function (t) { return t.id === currentDetailTaskId; }) || null;
}

function _mdResetActiveState() {
    _mdEditor.source = '';
    _mdEditor.blocks = [];
    _mdEditor.activeStart = null;
    _mdEditor.activeTextarea = null;
    _mdEditor.emptyPad = 0;
    _mdEditor.pendingRender = false;
}

// 收起当前编辑区：落定活动块 → 隐藏编辑器 → 还原 textarea
function _mdDeactivateTarget() {
    const target = _mdEditor.target;
    if (!target) return;
    if (_mdEditor.activeTextarea) _mdCommitActive(false);
    const el = _mdEditorEl();
    if (el) {
        el.classList.add('hidden');
        el.innerHTML = '';
    }
    const ta = _mdTargetEl();
    if (ta) {
        ta.classList.remove('hidden');
        if (typeof target.onShowTextarea === 'function') target.onShowTextarea(ta);
    }
    _mdEditor.target = null;
    _mdEditor.readOnly = false;
    _mdResetActiveState();
}

// 激活某个编辑区。同一目标再次调用 = 刷新（先落定活动块，再按 textarea 现值重渲染）
function _mdActivateTarget(cfg) {
    const ta = cfg && document.getElementById(cfg.textareaId);
    if (!ta) return false;
    const prev = _mdEditor.target;
    if (prev && (prev.kind !== cfg.kind || prev.textareaId !== cfg.textareaId)) {
        _mdDeactivateTarget();
    } else if (prev && _mdEditor.activeTextarea) {
        _mdCommitActive(false);
    }
    _mdEditor.target = cfg;
    _mdEditor.readOnly = !!cfg.readOnly;
    _mdEditor.source = mdNormalizeSource(ta.value);
    _mdEditor.blocks = [];
    _mdEditor.activeStart = null;
    _mdEditor.activeTextarea = null;
    _mdEditor.emptyPad = 0;
    _mdEditor.pendingRender = false;
    // 规范化换行后同步回 textarea（静默：打开面板不算一次编辑）
    if (ta.value !== _mdEditor.source) ta.value = _mdEditor.source;
    ta.classList.add('hidden');
    const el = _mdEnsureEditorEl();
    if (!el) {
        ta.classList.remove('hidden');
        _mdEditor.target = null;
        return false;
    }
    el.classList.remove('hidden');
    _mdRenderAll();
    return true;
}

function mdDeactivateEditorForKind(kind) {
    if (_mdEditor.target && _mdEditor.target.kind === kind) _mdDeactivateTarget();
}

function _mdSyncHiddenTextarea(silent) {
    const ta = _mdTargetEl();
    if (!ta) return;
    if (ta.value !== _mdEditor.source) ta.value = _mdEditor.source;
    if (!silent && _mdEditor.target && typeof _mdEditor.target.afterSync === 'function') {
        _mdEditor.target.afterSync(_mdEditor.source, ta);
    }
}

function _mdScheduleSave() {
    if (_mdEditor.target && typeof _mdEditor.target.onSave === 'function') {
        _mdEditor.target.onSave();
    }
}

function _mdRerenderGlass() {
    if (typeof updateWriteModeGlassBounds === 'function'
        && document.body.classList.contains('detail-write-mode')) {
        updateWriteModeGlassBounds();
    }
}

function _mdRenderAll(blocksOverride) {
    const el = _mdEditorEl();
    if (!el) return;
    _mdEditor.pendingRender = false;
    const scrollTop = el.scrollTop;
    _mdEditor.blocks = blocksOverride || mdParseBlocks(_mdEditor.source);
    el.innerHTML = '';
    if (!_mdEditor.blocks.length) {
        const ph = document.createElement('div');
        ph.className = 'md-empty-placeholder';
        ph.textContent = _mdEditor.readOnly
            ? '暂无详情'
            : ((_mdEditor.target && _mdEditor.target.placeholder) || '任务详情描述');
        ph.dataset.mdEmpty = '1';
        el.appendChild(ph);
    } else {
        _mdEditor.blocks.forEach(function (block, idx) {
            const wrap = document.createElement('div');
            wrap.className = 'md-block' + (block.synthetic ? ' md-block-synthetic' : '');
            wrap.dataset.mdBlockStart = String(block.start);
            wrap.dataset.mdBlockIndex = String(idx);
            wrap.dataset.mdBlockType = block.type;
            wrap.innerHTML = mdRenderBlock(block, _mdEditor.source, { readOnly: _mdEditor.readOnly });
            el.appendChild(wrap);
        });
    }
    el.scrollTop = scrollTop;
    _mdRerenderGlass();
}

// 供 tasks.js 在打开面板 / 模式切换 / 设置变更时调用：
// 文本模式编辑备注；子任务模式编辑「任务详情描述」，两者共用同一套行级编辑器。
function refreshDetailNotesEditor() {
    const notes = _mdNotesEl();
    const desc = document.getElementById('detail-task-description');
    if (!notes || !desc) return;
    const task = _mdCurrentTask();
    const mode = (typeof currentTaskMode === 'undefined') ? 'text' : currentTaskMode;
    const markdownOn = _mdIsMarkdownOn();
    const readOnly = (typeof detailReadOnly !== 'undefined' && detailReadOnly) || !!(task && task.extSourceId);

    if (!markdownOn || !task) {
        if (_mdEditor.target && _mdEditor.target.kind !== 'template') _mdDeactivateTarget();
        if (mode === 'subtasks') {
            notes.classList.add('hidden');
            desc.classList.remove('hidden');
        } else {
            notes.classList.remove('hidden');
            desc.classList.add('hidden');
        }
        return;
    }

    if (mode === 'text') {
        _mdActivateTarget({
            kind: 'notes',
            textareaId: 'detail-task-notes',
            editorId: 'detail-notes-md-editor',
            editorClass: '',
            placeholder: '任务详情描述',
            readOnly: readOnly,
            allowAttachmentPaste: true,
            afterSync: null,
            onSave: function () {
                if (typeof scheduleWriteModeAutoSave === 'function') scheduleWriteModeAutoSave();
            },
            onShowTextarea: null
        });
        // 激活/切换过程中会把旧 textarea 还原出来，这里再按当前模式收口一次
        notes.classList.add('hidden');
        desc.classList.add('hidden');
        return;
    }

    // 子任务模式：描述框走行级编辑器（与文本模式备注同一套块模型）
    _mdActivateTarget({
        kind: 'description',
        textareaId: 'detail-task-description',
        editorId: 'detail-task-description-md-editor',
        editorClass: 'md-editor-desc',
        placeholder: '任务详情描述',
        readOnly: readOnly,
        allowAttachmentPaste: false,
        afterSync: function (source) {
            const idx = tasks.findIndex(function (t) { return t.id === currentDetailTaskId; });
            if (idx !== -1) tasks[idx].description = source;
        },
        onSave: null,
        onShowTextarea: function (ta) {
            if (typeof autoResizeDetailDescription === 'function') autoResizeDetailDescription(ta);
        }
    });
    notes.classList.add('hidden');
    desc.classList.add('hidden');
}

// 模板编辑面板的备注 / 描述：与详情面板共用行级编辑器（同样受 Markdown 开关控制）
function refreshTaskTemplatePanelNotesEditor() {
    const ta = document.getElementById('tpl-panel-notes');
    const panel = document.getElementById('template-detail-panel');
    const state = (typeof _tplPanelState !== 'undefined') ? _tplPanelState : null;
    if (!ta || !panel || panel.classList.contains('hidden') || !state || !_mdIsMarkdownOn()) {
        mdDeactivateEditorForKind('template');
        return;
    }
    _mdActivateTarget({
        kind: 'template',
        textareaId: 'tpl-panel-notes',
        editorId: 'tpl-panel-notes-md-editor',
        editorClass: 'md-editor-tpl',
        placeholder: ta.placeholder || '',
        readOnly: false,
        allowAttachmentPaste: false,
        afterSync: function (source, target) {
            if (typeof onTaskTemplatePanelNotesInput === 'function') onTaskTemplatePanelNotesInput(target);
        },
        onSave: null,
        onShowTextarea: function (target) {
            if (typeof _tplPanelAutoResizeNotes === 'function') _tplPanelAutoResizeNotes(target);
        }
    });
}

function _mdBindEditorEvents(el) {
    el.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        const img = e.target.closest('.md-img');
        if (img) {
            // 图片优先走大图预览，避免误触进入块编辑
            const src = img.getAttribute('src') || '';
            const m = src.match(/^\/api\/attachments\/([^/]+)\/([^/]+)/);
            if (m && typeof openAttachmentPreview === 'function') {
                e.preventDefault();
                openAttachmentPreview(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
            } else if (/^https?:\/\//i.test(src)) {
                e.preventDefault();
                window.open(src, '_blank', 'noopener');
            }
            return;
        }
        if (_mdEditor.readOnly) return;
        const taskCb = e.target.closest('input[data-md-task-offset]');
        if (taskCb) {
            e.preventDefault();
            _mdToggleTask(parseInt(taskCb.dataset.mdTaskOffset, 10));
            return;
        }
        if (e.target.closest('a')) return; // 链接走原生跳转
        const wrap = e.target.closest('.md-block');
        if (!wrap) {
            if (e.target.closest('.md-empty-placeholder')) {
                e.preventDefault();
                _mdStartEmptyBlock();
                return;
            }
            if (e.target === el) {
                // 点滚动条不应被当成「点空白新建段落」（折叠态长备注会出现滚动条）
                const r = el.getBoundingClientRect();
                const sbW = el.offsetWidth - el.clientWidth;
                const sbH = el.offsetHeight - el.clientHeight;
                if ((sbW > 0 && e.clientX >= r.left + el.clientWidth)
                    || (sbH > 0 && e.clientY >= r.top + el.clientHeight)) {
                    return;
                }
                e.preventDefault();
                _mdStartEmptyBlock();
            }
            return;
        }
        if (_mdEditor.activeTextarea && wrap.contains(_mdEditor.activeTextarea)) return;
        e.preventDefault();
        const start = parseInt(wrap.dataset.mdBlockStart, 10);
        const caret = _mdCaretFromClick(wrap, e, start);
        _mdSwitchToBlock(start, caret);
    });
    // 点击编辑器外部的任意位置时先落定当前块：不依赖 textarea 的原生 blur
    //（部分嵌入环境/被 CSS 隐藏的输入框不会派发 blur），也避免切换任务时丢内容。
    document.addEventListener('pointerdown', function (e) {
        if (!_mdEditor.activeTextarea) return;
        if (_mdEditorEl() !== el) return; // 只由当前激活的编辑区处理
        if (el.contains(e.target)) return;
        _mdCommitActive();
    }, true);
}

function _mdStartEmptyBlock() {
    if (_mdEditor.readOnly) return;
    if (_mdEditor.activeTextarea) _mdCommitActive();
    // 行级模型：在文末补一个换行即可得到一个可编辑空行；若用户最终没输入就撤销补白。
    let pad = 0;
    if (_mdEditor.source && !_mdEditor.source.endsWith('\n')) {
        _mdEditor.source += '\n';
        pad = 1;
        _mdSyncHiddenTextarea();
    }
    _mdEditor.emptyPad = pad;
    const blocks = mdParseBlocks(_mdEditor.source);
    if (!blocks.length) {
        const synthetic = {
            type: 'blank',
            start: 0,
            end: 0,
            raw: '',
            synthetic: true
        };
        _mdRenderAll([synthetic]);
        _mdActivateBlockAt(0, 0);
        return;
    }
    const last = blocks[blocks.length - 1];
    if (last.type !== 'blank' || last.start !== _mdEditor.source.length) {
        // 兜底：理论上补换行后一定会得到文末空行；异常结构时显式补一个 synthetic 空行
        const synthetic = {
            type: 'blank',
            start: _mdEditor.source.length,
            end: _mdEditor.source.length,
            raw: '',
            synthetic: true
        };
        blocks.push(synthetic);
        _mdRenderAll(blocks);
        _mdActivateBlockAt(synthetic.start, 0);
        return;
    }
    _mdRenderAll(blocks);
    _mdActivateBlockAt(last.start, 0);
}

function _mdSwitchToBlock(start, caret) {
    const prevActive = _mdEditor.activeStart;
    const delta = _mdCommitActive();
    let target = start;
    if (prevActive != null && prevActive < start && delta) target += delta;
    // 目标在文末之外（例如标题回车后新建空段落）：直接起一个空块
    if (!_mdEditor.blocks.length || target >= _mdEditor.source.length && !_mdEditor.blocks.some(function (b) { return b.start <= target && target <= b.end; })) {
        _mdStartEmptyBlock();
        return;
    }
    // 目标块在提交后可能已被拆分/合并，按偏移找包含它的块
    let block = _mdEditor.blocks.find(function (b) { return b.start === target; });
    if (!block) {
        block = _mdEditor.blocks.find(function (b) { return b.start <= target && target <= b.end; });
    }
    if (!block) {
        // 点击的块被合并掉了：落到最近的块
        block = _mdEditor.blocks.find(function (b) { return b.start >= target; })
            || _mdEditor.blocks[_mdEditor.blocks.length - 1];
    }
    if (!block) {
        _mdStartEmptyBlock();
        return;
    }
    _mdActivateBlockAt(block.start, Math.min(caret, block.raw.length));
}

function _mdActivateBlockAt(blockStart, caret) {
    if (_mdEditor.readOnly) return;
    const el = _mdEditorEl();
    if (!el) return;
    const block = _mdEditor.blocks.find(function (b) { return b.synthetic && b.start === blockStart; })
        || _mdEditor.blocks.find(function (b) { return b.start === blockStart; });
    if (!block) return;
    const wrap = block.synthetic
        ? el.querySelector('.md-block-synthetic')
        : el.querySelector('.md-block[data-md-block-start="' + blockStart + '"]');
    if (!wrap) return;

    const ta = document.createElement('textarea');
    ta.className = 'md-block-input';
    ta.value = block.raw;
    ta.rows = 1;
    ta.spellcheck = false;
    ta.setAttribute('aria-label', '编辑备注块');
    wrap.classList.add('md-block-editing');
    wrap.innerHTML = '';
    wrap.appendChild(ta);
    _mdEditor.activeStart = blockStart;
    _mdEditor.activeTextarea = ta;
    _mdBindActiveTextarea(ta);
    _mdAutoGrow(ta);
    ta.focus({ preventScroll: true });
    const pos = Math.max(0, Math.min(caret == null ? ta.value.length : caret, ta.value.length));
    ta.setSelectionRange(pos, pos);
    _mdScrollCaretIntoView(ta);
}

function _mdBindActiveTextarea(ta) {
    ta.addEventListener('input', function () {
        _mdUpdateActiveSource();
        _mdAutoGrow(ta);
        _mdScheduleSave();
        _mdRerenderGlass();
    });
    ta.addEventListener('blur', function () {
        // 延后一拍：若紧接着 mousedown 切到别的块，由 _mdSwitchToBlock 接管
        setTimeout(function () {
            if (_mdEditor.activeTextarea === ta) _mdCommitActive();
        }, 0);
    });
    if (_mdEditor.target && _mdEditor.target.allowAttachmentPaste) {
        ta.addEventListener('paste', function (e) {
            if (typeof handleAttachmentPaste === 'function') handleAttachmentPaste(e);
        });
    }
    ta.addEventListener('keydown', _mdHandleActiveKeydown);
    ta.addEventListener('compositionstart', function () {
        _mdEditor.composing = true;
    });
    ta.addEventListener('compositionend', function () {
        _mdEditor.composing = false;
        _mdUpdateActiveSource();
        _mdAutoGrow(ta);
    });
}

function _mdActiveBlock() {
    if (_mdEditor.activeStart == null) return null;
    // 空块可能与最后一个真实块共享同一个 start（文末新起一段），优先取 synthetic
    return _mdEditor.blocks.find(function (b) { return b.synthetic && b.start === _mdEditor.activeStart; })
        || _mdEditor.blocks.find(function (b) { return b.start === _mdEditor.activeStart; });
}

function _mdUpdateActiveSource() {
    const ta = _mdEditor.activeTextarea;
    if (!ta || _mdEditor.activeStart == null) return;
    const block = _mdActiveBlock();
    if (!block) return;
    const oldRaw = block.raw;
    const newRaw = ta.value;
    const delta = newRaw.length - oldRaw.length;
    if (!delta && newRaw === oldRaw) return;

    _mdEditor.source = _mdEditor.source.slice(0, block.start) + newRaw + _mdEditor.source.slice(block.end);
    block.raw = newRaw;
    block.end = block.start + newRaw.length;

    if (delta) {
        // 活动块之后的块/任务勾选偏移整体平移，避免下次点击落到错误位置
        _mdEditor.blocks.forEach(function (b) {
            if (b !== block && b.start > block.start) {
                b.start += delta;
                b.end += delta;
            }
        });
        const el = _mdEditorEl();
        if (el) {
            el.querySelectorAll('.md-block[data-md-block-start]').forEach(function (w) {
                const s = parseInt(w.dataset.mdBlockStart, 10);
                if (s > block.start) w.dataset.mdBlockStart = String(s + delta);
            });
            el.querySelectorAll('input[data-md-task-offset]').forEach(function (cb) {
                const s = parseInt(cb.dataset.mdTaskOffset, 10);
                if (s > block.start) cb.dataset.mdTaskOffset = String(s + delta);
            });
        }
    }
    _mdSyncHiddenTextarea();
}

function _mdCommitActive(render) {
    const ta = _mdEditor.activeTextarea;
    if (!ta) return 0;
    const block = _mdActiveBlock();
    let delta = 0;
    if (block) {
        const oldRaw = block.raw;
        const newRaw = ta.value;
        delta = newRaw.length - oldRaw.length;
        if (newRaw !== oldRaw) {
            _mdEditor.source = _mdEditor.source.slice(0, block.start) + newRaw + _mdEditor.source.slice(block.end);
            _mdSyncHiddenTextarea();
        }
        // 文末空行未输入任何内容：撤销 _mdStartEmptyBlock 补的换行
        if (newRaw === '' && _mdEditor.emptyPad) {
            _mdEditor.source = _mdEditor.source.slice(0, Math.max(0, _mdEditor.source.length - _mdEditor.emptyPad));
            delta = -_mdEditor.emptyPad;
            _mdSyncHiddenTextarea();
        }
    }
    _mdEditor.emptyPad = 0;
    _mdEditor.activeStart = null;
    _mdEditor.activeTextarea = null;
    // 关闭/切任务等「马上会隐藏或重渲染」的场景只落定数据，不重建 DOM，
    // 避免在关闭动画开始前出现一次源码→渲染态的跳动。
    if (render !== false) {
        _mdRenderAll();
    } else {
        // 兜底：若调用方随后没有关闭/重渲染（如保存被校验拦下），下一拍自行恢复渲染，
        // 避免留下一个已经脱离 activeTextarea 管理的 textarea。
        _mdEditor.pendingRender = true;
        setTimeout(function () {
            if (!_mdEditor.pendingRender) return;
            _mdEditor.pendingRender = false;
            const el = _mdEditorEl();
            // 面板/编辑区已关闭时不重渲染（模板面板与详情面板共用这套兜底）
            if (!el || !el.getClientRects().length || _mdEditor.activeTextarea) return;
            if (document.body.classList.contains('wm-morph-out')
                || document.body.classList.contains('wm-morph-in')) return;
            _mdRenderAll();
        }, 0);
    }
    return delta;
}

// 供保存/关闭前兜底：活动块内容已实时同步到隐藏 textarea，这里只做落定与重渲染。
// options.render === false：只落定数据不重建 DOM（调用方随后会隐藏面板或 refreshDetailNotesEditor）
function mdEditorCommit(options) {
    if (_mdEditor.activeTextarea) _mdCommitActive(!options || options.render !== false);
}

function _mdAutoGrow(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 24) + 'px';
}

function _mdScrollCaretIntoView(ta) {
    try {
        ta.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (e) {
        ta.scrollIntoView(false);
    }
    _mdRerenderGlass();
}

function _mdCaretFromClick(wrap, e, blockStart) {
    const block = _mdEditor.blocks.find(function (b) { return b.start === blockStart; });
    if (!block || !block.raw) return 0;
    const rect = wrap.getBoundingClientRect();
    const cs = getComputedStyle(wrap);
    const lineHeight = parseFloat(cs.lineHeight) || 24;
    const lineCount = block.raw.split('\n').length;
    let lineIdx = Math.floor((e.clientY - rect.top) / lineHeight);
    lineIdx = Math.max(0, Math.min(lineCount - 1, lineIdx));
    const lines = block.raw.split('\n');
    let pos = 0;
    for (let i = 0; i < lineIdx; i++) pos += lines[i].length + 1;
    return pos;
}

function _mdSplitActiveLine(selStart, selEnd) {
    const ta = _mdEditor.activeTextarea;
    const block = _mdActiveBlock();
    if (!ta || !block) return;
    const value = ta.value;
    // 多行文本（Shift+Enter / 粘贴）暂不拆行，交给浏览器默认换行
    if (value.indexOf('\n') !== -1) return;

    const before = value.slice(0, selStart);
    const after = value.slice(selEnd);
    let newRaw = after;
    let caret = 0;

    // 列表续行：1. → 2.；- → -；- [ ] → - [ ]；缩进与分隔符保留。
    // 直接按 textarea 当前文本识别，因此即使这行刚由空行输入而成，也能立即生效。
    const list = mdParseListLine(value);
    if (list && selStart >= list.prefixLen) {
        const nextMarker = list.ordered ? (list.number + 1) + list.delim : list.marker;
        const prefix = list.indent + nextMarker + ' ' + (list.task ? '[ ] ' : '');
        newRaw = prefix + after;
        caret = prefix.length;
    } else {
        const quote = value.match(/^(\s*>\s?)/);
        if (quote && selStart >= quote[1].length) {
            newRaw = quote[1] + after;
            caret = quote[1].length;
        }
    }

    const source = _mdEditor.source;
    _mdEditor.source = source.slice(0, block.start) + before + '\n' + newRaw + source.slice(block.end);
    _mdSyncHiddenTextarea();
    _mdEditor.activeStart = null;
    _mdEditor.activeTextarea = null;
    _mdEditor.blocks = mdParseBlocks(_mdEditor.source);
    _mdRenderAll();
    const newStart = block.start + before.length + 1;
    _mdActivateBlockAt(newStart, caret);
    _mdScheduleSave();
}

function _mdHandleActiveKeydown(e) {
    const ta = e.target;
    if (e.isComposing || _mdEditor.composing) return;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const collapsed = start === end;

    // Esc：落定并退出编辑块
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        _mdCommitActive();
        return;
    }
    // Tab：列表行按 4 空格补齐到下一级；其他行插入两个空格，避免焦点被移走
    if (e.key === 'Tab') {
        e.preventDefault();
        const block = _mdActiveBlock();
        const list = (block && block.type !== 'code' && value.indexOf('\n') === -1) ? mdParseListLine(value) : null;
        if (list) {
            const lead = value.match(/^[ \t]*/)[0];
            const tabCount = (lead.match(/\t/g) || []).length;
            if (e.shiftKey) {
                let removed = 0;
                if (tabCount) {
                    const lastTab = lead.lastIndexOf('\t');
                    removed = lastTab + 1;
                } else {
                    const spaces = lead.length;
                    // 4 空格为一级；已有 2 空格等旧缩进也能退到上一档
                    removed = spaces % 4 === 0 ? Math.min(4, spaces) : spaces % 4;
                }
                if (removed) {
                    ta.value = value.slice(removed);
                    ta.selectionStart = ta.selectionEnd = Math.max(0, start - removed);
                    _mdUpdateActiveSource();
                    _mdAutoGrow(ta);
                    _mdScheduleSave();
                }
                return;
            }
            // Tab 补齐到下一级（4 空格）；已有 2 空格缩进会补 2 空格到 4
            const add = tabCount ? 4 : (4 - (lead.length % 4));
            ta.value = ' '.repeat(add) + value;
            ta.selectionStart = ta.selectionEnd = start + add;
            _mdUpdateActiveSource();
            _mdAutoGrow(ta);
            _mdScheduleSave();
            return;
        }
        const before = value.slice(0, start);
        const after = value.slice(end);
        ta.value = before + '  ' + after;
        ta.selectionStart = ta.selectionEnd = start + 2;
        _mdUpdateActiveSource();
        _mdAutoGrow(ta);
        _mdScheduleSave();
        return;
    }
    // 回车：行级拆分；列表自动续号；代码块内保持默认换行
    if (e.key === 'Enter' && !e.shiftKey) {
        const block = _mdActiveBlock();
        if (block && block.type !== 'code' && value.indexOf('\n') === -1) {
            e.preventDefault();
            _mdSplitActiveLine(start, end);
            return;
        }
    }

    // Backspace：块首与上一块合并
    if (e.key === 'Backspace' && collapsed && start === 0) {
        const idx = _mdEditor.blocks.indexOf(_mdActiveBlock());
        if (idx > 0) {
            e.preventDefault();
            const prev = _mdEditor.blocks[idx - 1];
            const cur = _mdEditor.blocks[idx];
            const mergedSource = _mdEditor.source.slice(0, prev.start)
                + prev.raw + ta.value
                + _mdEditor.source.slice(cur.end);
            _mdEditor.source = mergedSource;
            _mdEditor.activeTextarea = null;
            _mdEditor.activeStart = null;
            _mdSyncHiddenTextarea();
            _mdEditor.blocks = mdParseBlocks(_mdEditor.source);
            _mdRenderAll();
            _mdScheduleSave();
            _mdActivateBlockAt(prev.start, prev.raw.length);
            return;
        }
    }

    // Delete：块尾与下一块合并
    if (e.key === 'Delete' && collapsed && start === value.length) {
        const idx = _mdEditor.blocks.indexOf(_mdActiveBlock());
        if (idx !== -1 && idx < _mdEditor.blocks.length - 1) {
            e.preventDefault();
            const cur = _mdEditor.blocks[idx];
            const next = _mdEditor.blocks[idx + 1];
            _mdEditor.source = _mdEditor.source.slice(0, cur.start)
                + ta.value + next.raw
                + _mdEditor.source.slice(next.end);
            _mdEditor.activeTextarea = null;
            _mdEditor.activeStart = null;
            _mdSyncHiddenTextarea();
            _mdEditor.blocks = mdParseBlocks(_mdEditor.source);
            _mdRenderAll();
            _mdScheduleSave();
            _mdActivateBlockAt(cur.start, ta.value.length);
            return;
        }
    }

    // 上下方向键跨块：块首按 ↑ / 块尾按 ↓
    const firstLineBreak = value.indexOf('\n');
    const atFirstLine = firstLineBreak === -1 || start <= firstLineBreak;
    if (e.key === 'ArrowUp' && collapsed && atFirstLine) {
        const idx = _mdEditor.blocks.indexOf(_mdActiveBlock());
        if (idx > 0) {
            e.preventDefault();
            const prev = _mdEditor.blocks[idx - 1];
            _mdSwitchToBlock(prev.start, prev.raw.length);
            return;
        }
    }
    const lastLineStart = value.lastIndexOf('\n') + 1;
    const atLastLine = lastLineStart === 0 || start >= lastLineStart;
    if (e.key === 'ArrowDown' && collapsed && atLastLine) {
        const idx = _mdEditor.blocks.indexOf(_mdActiveBlock());
        if (idx !== -1 && idx < _mdEditor.blocks.length - 1) {
            e.preventDefault();
            const next = _mdEditor.blocks[idx + 1];
            _mdSwitchToBlock(next.start, 0);
            return;
        }
    }
}

function _mdToggleTask(offset) {
    if (!offset && offset !== 0) return;
    if (_mdEditor.readOnly) return;
    // 勾选会重建全部块：先把正在编辑的块落定，避免 activeTextarea 指向已被移除的节点
    if (_mdEditor.activeTextarea) _mdCommitActive();
    const next = mdToggleTaskAt(_mdEditor.source, offset);
    if (next == null) return;
    _mdEditor.source = next;
    _mdSyncHiddenTextarea();
    _mdRenderAll();
    _mdScheduleSave();
    _mdRerenderGlass();
}

/* ---------- 对外：粘贴占位替换 ---------- */

// 在活动块光标处插入文本；活动块不存在时退回隐藏 textarea
function mdEditorInsertText(text) {
    const insert = String(text == null ? '' : text);
    if (!insert) return;
    const ta = _mdEditor.activeTextarea;
    if (ta) {
        const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
        const end = ta.selectionEnd == null ? start : ta.selectionEnd;
        ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + insert.length;
        _mdUpdateActiveSource();
        _mdAutoGrow(ta);
        _mdScheduleSave();
        return;
    }
    const target = _mdTargetEl();
    if (target) {
        const start = target.selectionStart == null ? target.value.length : target.selectionStart;
        const end = target.selectionEnd == null ? start : target.selectionEnd;
        target.value = target.value.slice(0, start) + insert + target.value.slice(end);
        target.selectionStart = target.selectionEnd = start + insert.length;
        _mdEditor.source = mdNormalizeSource(target.value);
        _mdScheduleSave();
    }
}

// 上传完成后把占位文本替换为真实 Markdown 图片链接。
// 活动块内命中时直接改 textarea（不打断输入）；否则改整篇源码并重渲染。
function mdEditorReplaceText(search, replacement) {
    if (!search) return false;
    let ta = _mdEditor.activeTextarea;
    // 活动块是文末空块时先落定：替换会重排版，空块需要重新生成
    if (ta && _mdActiveBlock() && _mdActiveBlock().synthetic) {
        _mdCommitActive();
        ta = null;
    }
    if (ta && ta.value.indexOf(search) !== -1) {
        ta.value = ta.value.split(search).join(replacement);
        _mdUpdateActiveSource();
        _mdAutoGrow(ta);
        _mdScheduleSave();
        return true;
    }
    const idx = _mdEditor.source.indexOf(search);
    if (idx === -1) return false;
    const delta = replacement.length - search.length;
    _mdEditor.source = _mdEditor.source.slice(0, idx) + replacement + _mdEditor.source.slice(idx + search.length);
    _mdSyncHiddenTextarea();
    if (ta) {
        // 正在编辑别的块：只平移偏移，不重建 DOM，避免打断输入
        const active = _mdActiveBlock();
        if (active) {
            if (idx + search.length <= active.start) {
                _mdEditor.activeStart += delta;
                active.start += delta;
                active.end += delta;
            }
        }
        _mdEditor.blocks = mdParseBlocks(_mdEditor.source);
        const el = _mdEditorEl();
        if (el) {
            el.querySelectorAll('.md-block[data-md-block-start]').forEach(function (w) {
                const s = parseInt(w.dataset.mdBlockStart, 10);
                if (s >= idx + search.length) w.dataset.mdBlockStart = String(s + delta);
            });
            el.querySelectorAll('input[data-md-task-offset]').forEach(function (cb) {
                const s = parseInt(cb.dataset.mdTaskOffset, 10);
                if (s >= idx + search.length) cb.dataset.mdTaskOffset = String(s + delta);
            });
            // 占位可能位于另一个已渲染块：就地刷新该块，避免它停留在「上传中」文本
            const replacedBlock = _mdEditor.blocks.find(function (b) { return b.start <= idx && idx <= b.end; });
            if (replacedBlock) {
                const w = el.querySelector('.md-block[data-md-block-start="' + replacedBlock.start + '"]');
                const activeWrap = ta.closest ? ta.closest('.md-block') : null;
                if (w && w !== activeWrap) {
                    w.innerHTML = mdRenderBlock(replacedBlock, _mdEditor.source, { readOnly: _mdEditor.readOnly });
                }
            }
        }
    } else {
        _mdRenderAll();
    }
    _mdScheduleSave();
    _mdRerenderGlass();
    return true;
}

function mdEditorIsActive() {
    const el = _mdEditorEl();
    return !!el && !el.classList.contains('hidden') && el.getClientRects().length > 0;
}

// 在整篇备注里替换文本（Markdown 关闭时直接改隐藏 textarea；开启时走编辑器）
function mdReplaceInNotes(search, replacement) {
    if (!search) return false;
    // 只有备注编辑区处于激活状态时才走行级替换；描述/模板编辑区的源码不能串到备注
    if (_mdEditor.target && _mdEditor.target.kind === 'notes' && mdEditorIsActive()) {
        return mdEditorReplaceText(search, replacement);
    }
    const notes = _mdNotesEl();
    if (!notes || notes.value.indexOf(search) === -1) return false;
    notes.value = notes.value.split(search).join(replacement);
    if (_mdEditor.target && _mdEditor.target.kind === 'notes') {
        _mdEditor.source = mdNormalizeSource(notes.value);
    }
    if (typeof scheduleWriteModeAutoSave === 'function') scheduleWriteModeAutoSave();
    return true;
}

// 测试/排障辅助：当前编辑器源码（与隐藏 textarea 同步）
function mdEditorGetSource() {
    return _mdEditor.source;
}

/* ==================== 支持语法帮助弹窗 ==================== */

let _markdownHelpEscBound = false;

function openMarkdownHelp() {
    const modal = document.getElementById('markdown-help-modal');
    if (!modal) return;
    const content = document.getElementById('markdown-help-content');
    if (content) content.innerHTML = renderMarkdownHelpContent();
    if (!_markdownHelpEscBound) {
        _markdownHelpEscBound = true;
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            const m = document.getElementById('markdown-help-modal');
            if (m && !m.classList.contains('hidden')) closeMarkdownHelp();
        });
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeMarkdownHelp() {
    const modal = document.getElementById('markdown-help-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function _mdHelpRow(syntax, desc) {
    return '<div class="flex items-baseline gap-3">'
        + '<span class="flex-shrink-0 font-mono text-xs text-theme-primary truncate" style="width: 12rem;" title="' + mdEscapeHtml(syntax) + '">' + mdEscapeHtml(syntax) + '</span>'
        + '<span class="flex-1 text-xs text-theme-secondary">' + mdEscapeHtml(desc) + '</span>'
        + '</div>';
}

function renderMarkdownHelpContent() {
    const sections = [
        ['文本', [
            ['# / ## / ###', '标题（1–3 级）'],
            ['**粗体** / __粗体__', '加粗'],
            ['*斜体* / _斜体_', '斜体'],
            ['~~删除线~~', '删除线'],
            ['`行内代码`', '行内代码']
        ]],
        ['块级', [
            ['``` / ~~~', '围栏代码块；保留内部空行，整体编辑'],
            ['- / * / +', '无序列表；Tab 缩进一级（4 空格），Shift+Tab 反缩进'],
            ['1. / 1)', '有序列表；回车自动补全下一行编号'],
            ['- [ ] / - [x]', '任务列表；点击复选框切换完成状态'],
            ['>', '引用'],
            ['---', '分割线']
        ]],
        ['链接与图片', [
            ['[文字](链接)', '链接；仅 http(s) / 站内路径，新标签打开'],
            ['![说明](链接)', '图片；支持粘贴截图自动上传']
        ]]
    ];
    let html = '';
    sections.forEach(function (section) {
        html += '<div><h3 class="text-sm font-semibold text-theme-secondary mb-2">' + mdEscapeHtml(section[0]) + '</h3><div class="space-y-1">';
        section[1].forEach(function (row) { html += _mdHelpRow(row[0], row[1]); });
        html += '</div></div>';
    });
    return html;
}
