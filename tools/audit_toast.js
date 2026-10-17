#!/usr/bin/env node
/**
 * Toast 审计：扫描全项目 showToast 调用，输出不合规清单。
 * 用法：node tools/audit_toast.js [--json]
 * 退出码：0 = 全部通过，1 = 有违规
 *
 * 检查项（对应 DESIGN_Toast通道重构方案.md §8）：
 *   1. 时长仍是数字（应为 'short'|'normal'|'long' 或省略）
 *   2. 标题不在 TOAST_TITLES 词表内
 *   3. 同一句文案用了多个 type
 *   4. type 与语义判定表不符
 *   5. 标点：句末 。！ / 半角冒号 / 直双引号 / 量词缺空格 / ASCII 省略号
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TITLES = ['SUCCESS', 'FAILED', 'NOTICE', 'CAUTION', 'CONFIRM'];

function listJs() {
    return fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
}

// 从 open 位置做括号配平，返回闭合下标
function matchParen(src, openIdx) {
    let depth = 0, instr = null;
    for (let i = openIdx; i < src.length; i++) {
        const ch = src[i];
        if (instr) {
            if (ch === instr && src[i - 1] !== '\\') instr = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { instr = ch; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth === 0) return i; }
    }
    return -1;
}

// 按顶层逗号切参数
function splitArgs(inner) {
    const out = [];
    let depth = 0, instr = null, cur = '';
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (instr) {
            cur += ch;
            if (ch === instr && inner[i - 1] !== '\\') instr = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { instr = ch; cur += ch; continue; }
        if ('([{'.includes(ch)) depth++;
        if (')]}'.includes(ch)) depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

// 字面量文案 → 纯文本（模板串去掉 ${} 部分）
function plainText(expr) {
    if (!expr) return null;
    const m = expr.match(/^(['"`])([\s\S]*)\1$/);
    if (!m) return null;
    const inner = m[2];
    // 拼接串（'a' + b + 'c'）不当作整句文案，跳过标点与语义判定
    if (/['"`]\s*\+/.test(inner)) return null;
    return inner.replace(/\$\{[^}]*\}/g, '·');
}

// 语义判定（§8.2 判定表的可执行版本，用于粗筛，命中后人工复核）
function semanticOf(text) {
    if (!text) return null;
    if (/^正在/.test(text)) return 'info';
    if (/已达上限|已达|最多|至少|仅支持|不支持/.test(text)) return 'warning';
    if (/^(请|不能|默认清单|归档清单|分组名称已存在|清单名称已存在|标签名称已存在|任务已有|日期格式|文件格式|该日期)/.test(text)) return 'warning';
    if (/(失败|不可用|无法|超时|不可达|不存在|无效|格式不正确|错误)/.test(text)) return 'error';
    if (/^(没有|未|暂无|该|当前已是|回收站是空的|选中任务均已)/.test(text)) return 'info';
    if (/(已|成功|完成)/.test(text)) return 'success';
    return null;
}

const calls = [];
for (const file of listJs()) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const re = /showToast\(/g;
    let m;
    while ((m = re.exec(src))) {
        if (src.slice(Math.max(0, m.index - 9), m.index) === 'function ') continue;
        const open = m.index + 'showToast'.length;
        const close = matchParen(src, open);
        if (close < 0) continue;
        const args = splitArgs(src.slice(open + 1, close));
        if (!args.length) continue;
        const line = src.slice(0, m.index).split('\n').length;
        calls.push({
            file, line,
            raw: src.slice(m.index, close + 1),
            message: args[0],
            text: plainText(args[0]),
            type: args[1] ? args[1].replace(/^['"]|['"]$/g, '') : '(default)',
            duration: args[2] || null,
            title: args[3] || null
        });
    }
}

// 人工确认过的「刻意例外」：语义判定表的启发式在这里不适用
const TYPE_OK = new Set([
    'app.js:1833', 'app.js:1857', 'app.js:1896',   // 网络降级：已自动切回离线版，无需用户行动
    'app.js:2802',                                  // 缺强调色：用户改配色即可解决，属可修复
    'batchSelect.js:593', 'holiday.js:1325',        // 用户主动取消，不是"完成"
    'batchSelect.js:723',                           // 被外部订阅任务阻断
    'calendarViews.js:1847',                        // 空月份定位，无操作
    'calendar_sync.js:677',                         // 部分源失败，其余成功
    'data.js:1255',                                 // 已从本地缓存恢复
    'tasks.js:5328',                                // 无法计算周期，需用户改设置
    'batchSelect.js:767',                           // 「已是该状态」是空操作，不是完成
    'calendar_sync.js:198'                          // 「正在新增订阅，请先保存」是校验拒绝，不是进行中
]);

const issues = { duration: [], title: [], dupType: [], typeMismatch: [], punct: [] };

const byText = new Map();
for (const c of calls) {
    // 1. 时长
    if (c.duration && /^\d+$/.test(c.duration)) {
        issues.duration.push(`${c.file}:${c.line}  时长=${c.duration}`);
    }
    // 2. 标题
    if (c.title && c.title !== 'null') {
        const t = c.title.replace(/^['"]|['"]$/g, '');
        if (!TITLES.includes(t) && !/^[A-Za-z_$]/.test(c.title)) {
            issues.title.push(`${c.file}:${c.line}  标题=${t}`);
        }
    }
    // 3/4. 同句多 type & 语义
    if (c.text) {
        if (!byText.has(c.text)) byText.set(c.text, []);
        byText.get(c.text).push(c);
        const want = semanticOf(c.text);
        if (want && c.type !== '(default)' && c.type !== want && !TYPE_OK.has(c.file + ':' + c.line)) {
            issues.typeMismatch.push(`${c.file}:${c.line}  ${c.type} → 应为 ${want}  「${c.text.slice(0, 34)}」`);
        }
        // 5. 标点
        const p = [];
        if (/[。！]$/.test(c.text)) p.push('句末标点');
        if (/: /.test(c.text)) p.push('半角冒号');
        if (/"[^"]*"/.test(c.text)) p.push('直双引号');
        if (/\d[个条天秒分小]/.test(c.text)) p.push('量词缺空格');
        if (/\.\.\./.test(c.text)) p.push('ASCII 省略号');
        if (p.length) issues.punct.push(`${c.file}:${c.line}  [${p.join('/')}]  「${c.text.slice(0, 34)}」`);
    }
}
for (const [text, list] of byText) {
    const types = [...new Set(list.map(c => c.type))];
    if (types.length > 1) {
        issues.dupType.push(`「${text.slice(0, 34)}」 ${list.map(c => c.file + ':' + c.line + '=' + c.type).join('  ')}`);
    }
}

const total = Object.values(issues).reduce((a, b) => a + b.length, 0);
if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ calls: calls.length, issues }, null, 2));
} else {
    console.log(`扫描 ${calls.length} 处 showToast 调用\n`);
    const labels = {
        duration: '① 时长仍是数字',
        title: '② 标题不在词表',
        dupType: '③ 同一句文案多个 type',
        typeMismatch: '④ type 与语义不符',
        punct: '⑤ 标点/排版'
    };
    for (const k of Object.keys(labels)) {
        const arr = issues[k];
        console.log(`${labels[k]}：${arr.length} 处`);
        arr.slice(0, 200).forEach(x => console.log('   ' + x));
        if (arr.length) console.log('');
    }
    console.log(total === 0 ? '✅ 全部通过' : `❌ 共 ${total} 处待处理`);
}
process.exit(total === 0 ? 0 : 1);
