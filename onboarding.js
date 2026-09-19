// ==================== 首次使用引导（Spotlight 遮罩） ====================
// 触发：init 完成后 settings.onboardingVersion < ONBOARDING_VERSION 且无任务（首次使用）自动启动；
//      也可由任务视图空态卡片「重看新手引导」或 startOnboarding(true) 强制启动。
// 语义：「跳过」不写标记（下次满足条件仍会弹出）；「不再显示」/ 走完全部步骤 写入标记并 saveData()。
// 移动端复用同一套内容：目标元素不可见（抽屉侧栏 / 底部导航收纳）时退化为居中卡片、不画聚光框。
// 步骤规划（4 组 9 步）：
//   1 添加任务（+按钮 / 命令面板一句话创建，后者真实呼出并注入演示文字）
//   2 清单与清单集（新建清单 / 编辑清单（颜色图标）/ 新建清单集（拖拽合并）/ 编辑清单集（行尾编辑按钮））
//   3 视图总览（仅介绍视图本身，不含时间配置）
//   4 专注（番茄专注入口）+ 提醒（Toast 四按钮示意卡）
// 示例数据：启动引导时幂等创建示例清单/清单集/标签（团队工作、生活>购物+运动、总结会），仅存在于内存，
//   使命令面板演示的 ~清单 / #标签 在实时预览中真实解析呈现，并为清单步骤提供高亮目标；
//   引导结束（跳过 / 不再显示 / 开始使用）即从内存删除本次创建的演示数据，保证关闭引导后为空数据。

const ONBOARDING_VERSION = 1;
// 注意：~清单 与 #标签 之间必须空格分隔——NLP 的 ~(\S+) 会连着吞掉无空格分隔的后续 #token
const OB_DEMO_TEXT = '明天下午5点团队会议 ~团队工作 #总结会 !!!|记得提前准备会议资料';

let _onboardingActive = false;
let _onboardingStep = 0;
let _obSteps = [];
let _obOverlay = null;
let _obSpotlight = null;
let _obTooltip = null;
let _obStyleInjected = false;
let _obRepositionTimer = null;
// 本次引导为演示而创建的清单/标签 id（仅这些会在结束时删除；用户原有的同名数据不受影响）
let _obCreatedListIds = [];
let _obCreatedTagIds = [];

// —— 样式注入（仅一次） ——
function _obEnsureStyle() {
    if (_obStyleInjected) return;
    _obStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
.ob-overlay{position:fixed;inset:0;z-index:10000;}
/* 无锚点步骤（如提醒示意）整屏压暗，与聚光框 box-shadow 同色 */
.ob-overlay.ob-dim{background:rgba(15,23,42,.55);}
.ob-spotlight{position:fixed;z-index:10001;pointer-events:none;border-radius:12px;
    border:2px solid var(--accent-color,#3b82f6);box-shadow:0 0 0 200vmax rgba(15,23,42,.55);
    transition:top .3s cubic-bezier(.4,0,.2,1),left .3s cubic-bezier(.4,0,.2,1),
        width .3s cubic-bezier(.4,0,.2,1),height .3s cubic-bezier(.4,0,.2,1);}
.ob-tooltip{position:fixed;z-index:10002;}
.ob-card{animation:obCardIn .22s ease-out;}
@keyframes obCardIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
@media (prefers-reduced-motion: reduce){.ob-card{animation:none;}.ob-spotlight{transition:none;}}
.ob-ul{margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px;}
.ob-tip{margin:10px 0 0;}
.ob-demo{display:flex;flex-wrap:wrap;gap:4px;margin-top:10px;}
.ob-seg{padding:2px 6px;border-radius:6px;border:1px solid transparent;font-size:13px;line-height:20px;}
/* 引导期间强制显示"悬停才出现"的元素（侧栏 + 按钮 / 清单集行尾编辑按钮） */
.ob-reveal{opacity:1 !important;display:flex !important;}
`;
    document.head.appendChild(style);
}

// —— 示例数据（幂等：同名不存在才创建；仅存内存不写盘，结束时删除本次创建的） ——
function _obEnsureDemoData() {
    if (typeof lists === 'undefined' || !Array.isArray(lists)) return;
    _obCreatedListIds = [];
    _obCreatedTagIds = [];
    let changed = false;
    const now = new Date().toISOString();

    // 示例清单「团队工作」：命令面板演示 ~团队工作 的解析目标
    if (!lists.some(l => l.name === '团队工作')) {
        const demoList = { id: generateId(), name: '团队工作', color: '#8b5cf6', createdAt: now };
        lists.push(demoList);
        _obCreatedListIds.push(demoList.id);
        changed = true;
    }
    // 示例清单集「生活」+ 子清单「购物」「运动」：清单集相关步骤的高亮与演示目标
    // （子清单需多个，才能直观呈现"把一个清单拖到另一个清单上合并"的结果形态）
    let folder = lists.find(l => l.isFolder && l.name === '生活');
    if (!folder) {
        folder = { id: generateId(), name: '生活', color: '#f59e0b', isFolder: true, createdAt: now };
        lists.push(folder);
        _obCreatedListIds.push(folder.id);
        changed = true;
    }
    if (!lists.some(l => l.name === '购物' && l.parentId === folder.id)) {
        const shopping = { id: generateId(), name: '购物', color: '#10b981', parentId: folder.id, createdAt: now };
        lists.push(shopping);
        _obCreatedListIds.push(shopping.id);
        changed = true;
    }
    if (!lists.some(l => l.name === '运动' && l.parentId === folder.id)) {
        const sport = { id: generateId(), name: '运动', color: '#3b82f6', parentId: folder.id, createdAt: now };
        lists.push(sport);
        _obCreatedListIds.push(sport.id);
        changed = true;
    }
    // 示例标签「总结会」：命令面板演示 #总结会 的解析目标
    if (!settings.tags || !Array.isArray(settings.tags)) settings.tags = [];
    if (!settings.tags.some(t => t.name === '总结会')) {
        const demoTag = { id: generateId(), name: '总结会', color: '#06b6d4', createdAt: now };
        settings.tags.push(demoTag);
        _obCreatedTagIds.push(demoTag.id);
        changed = true;
    }

    if (changed) {
        if (typeof renderLists === 'function') renderLists();
        if (typeof renderTags === 'function') renderTags();
    }
}

// —— 删除本次引导创建的演示数据（用户原有的同名数据不受影响） ——
function _obRemoveDemoData() {
    let changed = false;
    if (_obCreatedListIds.length > 0) {
        const idSet = new Set(_obCreatedListIds);
        const before = lists.length;
        lists = lists.filter(l => !idSet.has(l.id));
        if (lists.length !== before) changed = true;
    }
    if (_obCreatedTagIds.length > 0 && settings.tags && settings.tags.length > 0) {
        const tagSet = new Set(_obCreatedTagIds);
        const before = settings.tags.length;
        settings.tags = settings.tags.filter(t => !tagSet.has(t.id));
        if (settings.tags.length !== before) changed = true;
    }
    _obCreatedListIds = [];
    _obCreatedTagIds = [];
    if (changed) {
        if (typeof renderLists === 'function') renderLists();
        if (typeof renderTags === 'function') renderTags();
        if (typeof renderView === 'function') renderView();
    }
    return changed;
}

// —— 步骤定义 ——
function _obBuildSteps() {
    const kbd = (k) => `<kbd class="px-1 py-0.5 bg-theme-tertiary text-theme-muted rounded text-[10px]">${k}</kbd>`;
    const demoList = (typeof lists !== 'undefined') ? lists.find(l => !l.archived && !l.isFolder && l.name === '团队工作') : null;
    const demoFolder = (typeof lists !== 'undefined')
        ? (lists.find(l => l.isFolder && !l.archived && l.name === '生活') || lists.find(l => l.isFolder && !l.archived))
        : null;
    const demoListSel = demoList ? `#lists-container button[data-list-id="${demoList.id}"]` : '#lists-container';
    const demoFolderSel = demoFolder ? `#lists-container button[data-list-id="${demoFolder.id}"]` : '#lists-container';

    return [
        // 第 1 组 · 添加任务（方式一：+ 按钮）
        {
            group: '添加任务 · 1/2',
            target: '#add-task-btn',
            title: '添加任务方式一：添加任务按钮',
            body: `
                <p>点击右上角的 <b class="text-theme-primary">+</b> 按钮打开任务编辑窗口：</p>
                <ul class="ob-ul text-sm">
                    <li>任务标题必填，其余均为可选项</li>
                    <li>时间、提醒、重要/紧急、清单等高级设置按需展开</li>
                </ul>`
        },
        // 第 1 组 · 添加任务（方式二：命令面板，真实呼出演示）
        {
            group: '添加任务 · 2/2',
            target: null,
            paletteDemo: true,
            delay: 380,
            title: '添加任务方式二：命令面板一句话创建',
            body: `
                <p>按 ${kbd('Ctrl')}+${kbd('Alt')}+${kbd('N')} 呼出命令面板，一句话写完所有信息（各段之间用空格分隔）。上方输入框已自动填入示例：</p>
                <div class="ob-demo">
                    <span class="ob-seg bg-blue-500/10 text-blue-400 border-blue-500/40" title="日期时间：自动识别">明天下午5点</span><span class="ob-seg text-theme-primary font-medium" title="任务标题">团队会议</span><span class="ob-seg bg-purple-500/10 text-purple-400 border-purple-500/40" title="清单">~团队工作</span><span class="ob-seg bg-cyan-500/10 text-cyan-500 border-cyan-500/40" title="标签">#总结会</span><span class="ob-seg bg-red-500/10 text-red-500 border-red-500/40" title="优先级">!!!</span><span class="ob-seg bg-slate-500/10 text-theme-secondary border-slate-500/40" title="备注">|记得提前准备会议资料</span>
                </div>
                <ul class="ob-ul text-sm">
                    <li><b>~清单名</b>：归属清单（输入时自动弹出候选）</li>
                    <li><b>#标签名</b>：标签，可写多个，不存在会自动创建</li>
                    <li><b>!</b> 紧急、<b>!!</b> 重要、<b>!!!</b> 重要且紧急</li>
                    <li><b>|备注内容</b>：写入任务详情</li>
                </ul>
                <p class="ob-tip text-xs">示例为演示文字（只读），面板下方即为实时解析预览；实际使用时直接打字即可。</p>`,
            onEnter: _obEnterPaletteDemo,
            onLeave: _obLeavePaletteDemo
        },
        // 第 2 组 · 清单与清单集（新建清单）
        {
            group: '清单与清单集 · 1/4',
            target: '#sidebar-lists-header',
            reveal: ['#sidebar-lists-header button[title="新建清单"]'],
            title: '新建清单',
            body: `
                <p>单击「清单」标题行右侧的 <b>+</b> 按钮：</p>
                <ul class="ob-ul text-sm">
                    <li>在展开的表单中输入清单名称、选择颜色</li>
                    <li>回车或单击 ✓ 保存</li>
                </ul>`
        },
        // 第 2 组 · 清单与清单集（编辑清单：单击颜色图标）
        {
            group: '清单与清单集 · 2/4',
            target: demoListSel,
            title: '编辑清单',
            body: `
                <p>单击清单前的<b>颜色图标</b>，即可打开编辑表单：</p>
                <ul class="ob-ul text-sm">
                    <li>修改名称、更换颜色</li>
                    <li>表单中同时提供删除、归档操作</li>
                </ul>`
        },
        // 第 2 组 · 清单与清单集（新建清单集：拖拽合并）
        // 高亮 = 清单集行 + 其展开的子清单块（联合矩形），只圈选演示的清单集本身，不含无关清单
        {
            group: '清单与清单集 · 3/4',
            targets: demoFolder ? [demoFolderSel, demoFolderSel + ' + div.mt-1'] : ['#lists-container'],
            title: '新建清单集',
            body: `
                <p>把一个清单<b>拖拽</b>到另一个清单上，自动合并为清单集：</p>
                <ul class="ob-ul text-sm">
                    <li>单击清单集<b>图标</b>可展开 / 收起其中的子清单</li>
                    <li>单击清单集<b>标题</b>可查看清单集内所有任务</li>
                </ul>`
        },
        // 第 2 组 · 清单与清单集（编辑清单集：行尾编辑按钮）
        {
            group: '清单与清单集 · 4/4',
            target: demoFolderSel,
            reveal: demoFolder ? [`${demoFolderSel} .fa-pen`] : [],
            title: '编辑清单集',
            body: `
                <p>鼠标悬停清单集行，单击行尾出现的<b>编辑按钮</b>：</p>
                <ul class="ob-ul text-sm">
                    <li>修改名称、更换颜色</li>
                    <li>拖拽子清单可移入 / 移出清单集</li>
                </ul>`
        },
        // 第 3 组 · 视图总览（仅视图本身，不含时间配置）
        {
            group: '视图总览 · 1/1',
            target: '#view-tabs',
            title: '六种任务视图',
            body: `
                <p>顶部一键切换，数据实时同步：</p>
                <ul class="ob-ul text-sm">
                    <li><b>任务</b>：分组列表，可按时间 / 清单 / 标签 / 优先级分组</li>
                    <li><b>日程</b>：按日期时间线展示，今天高亮</li>
                    <li><b>周 / 月</b>：网格与日历总览，任务可拖拽改期</li>
                    <li><b>四象限</b>：重要 × 紧急，一眼判断先后</li>
                    <li><b>看板</b>：拖拽卡片管理进度</li>
                </ul>
                <p class="ob-tip text-xs">视图的顺序与默认首页等可在设置中配置；每个视图右上角都有「视图配置」按钮，可对该视图单独自定义，且各清单的视图配置相互独立。</p>`
        },
        // 第 4 组 · 番茄专注（入口）
        {
            group: '专注与提醒 · 1/2',
            target: '#sidebar-pomodoro-btn',
            title: '番茄专注',
            body: `
                <p>通过此处进入番茄专注倒计时，或单击任务卡片中、任务详情面板中的「开始专注」按钮，指定任务开始专注倒计时。</p>
                <p class="ob-tip text-xs">快捷键：${kbd('Ctrl')}+${kbd('Alt')}+${kbd('P')}</p>`
        },
        // 第 4 组 · 任务提醒（Toast 四按钮静态示意）
        {
            group: '专注与提醒 · 2/2',
            target: null,
            position: 'bottom',
            dim: true,
            title: '任务提醒',
            body: `
                <p>任务到达提醒时间时，屏幕底部居中位置会弹出提醒卡片：</p>
                <div class="rounded-lg bg-slate-900/95 border-l-4 border-amber-500 p-3 text-slate-200 shadow-lg mt-2 select-none">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full border-2 border-amber-500 text-amber-400 flex items-center justify-center flex-shrink-0">
                            <i class="fas fa-bell"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="text-amber-400 text-xs font-black tracking-widest uppercase">17:00</div>
                            <div class="text-sm font-medium text-slate-300 truncate">团队会议</div>
                        </div>
                    </div>
                    <div class="flex gap-2 mt-2.5 justify-end text-xs font-bold tracking-wider">
                        <span class="px-2.5 py-1 bg-green-500/20 text-green-400 border border-green-500 rounded">FOCUS</span>
                        <span class="px-2.5 py-1 bg-amber-500/20 text-amber-400 border border-amber-500 rounded">DONE</span>
                        <span class="px-2.5 py-1 bg-cyan-500/20 text-cyan-400 border border-cyan-500 rounded">LATER</span>
                        <span class="px-2.5 py-1 bg-slate-700/50 text-slate-400 border border-slate-600 rounded">OK</span>
                    </div>
                </div>
                <ul class="ob-ul text-sm">
                    <li><b class="text-green-400">FOCUS</b>：立刻开始该任务的番茄专注</li>
                    <li><b class="text-amber-400">DONE</b>：一键标记任务完成</li>
                    <li><b class="text-cyan-400">LATER</b>：稍后提醒（默认 15 分钟，可在设置中调整）</li>
                    <li><b class="text-slate-400">OK</b>：仅关闭任务提醒卡片</li>
                </ul>
                <p class="ob-tip text-xs">点击卡片空白处：关闭提醒并打开任务详情。</p>`
        }
    ];
}

// —— 命令面板演示：真实呼出 + 注入示例文字（只读，光标置首避免弹出候选面板） ——
function _obEnterPaletteDemo() {
    if (typeof openCommandPalette !== 'function') return;
    openCommandPalette();
    const input = document.getElementById('command-palette-input');
    if (!input) return;
    input.value = OB_DEMO_TEXT;
    try { input.setSelectionRange(0, 0); } catch (e) { /* ignore */ }
    input.readOnly = true;
    input.blur();
    // 触发实时 NLP 预览（面板内部 120ms 防抖）
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function _obLeavePaletteDemo() {
    // 清除草稿关闭（false = 不保留输入内容）
    if (typeof closeCommandPalette === 'function') closeCommandPalette(false);
}

// —— 引导期间强制显形的元素清理 ——
function _obApplyReveals(step) {
    if (!step || !Array.isArray(step.reveal)) return;
    step.reveal.forEach(function (sel) {
        const el = document.querySelector(sel);
        if (el) el.classList.add('ob-reveal');
    });
}

function _obClearReveals() {
    document.querySelectorAll('.ob-reveal').forEach(function (el) { el.classList.remove('ob-reveal'); });
}

// —— 可见性判定（不可见 → 居中退化） ——
// 注意：不检查 opacity——命令面板 fadeIn 动画首帧 opacity=0，会误判为不可见导致卡片位置跳动
function _obElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const vw = window.innerWidth, vh = window.innerHeight;
    return r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
}

// —— 定位：聚光框 + 气泡卡片 ——
// 支持三种锚点：paletteDemo（命令面板本体，卡片置于面板下方）/ targets（多元素联合矩形，如清单集行+子清单块）/ target（单元素）；
// 无锚点步骤默认居中，可声明 position:'bottom' 底部居中
function _obPosition() {
    if (!_onboardingActive) return;
    const step = _obSteps[_onboardingStep];
    if (!step) return;
    const vw = window.innerWidth, vh = window.innerHeight;

    // 解析锚点元素集合
    let anchorEls = [];
    if (step.paletteDemo) {
        const palette = document.getElementById('command-palette');
        if (palette) anchorEls.push(palette);
    } else if (Array.isArray(step.targets)) {
        anchorEls = step.targets.map(sel => document.querySelector(sel)).filter(Boolean);
    } else if (step.target) {
        const el = document.querySelector(step.target);
        if (el) anchorEls.push(el);
    }

    // 目标可能在滚动容器外（如长侧栏底部的清单集行）：先最小滚动使其进入视口
    if (anchorEls.length > 0 && !step.paletteDemo && anchorEls[0].isConnected) {
        try { anchorEls[0].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ }
    }

    const anchorVisible = anchorEls.length > 0 && anchorEls.every(_obElementVisible);

    // 多锚点取联合矩形（如清单集行 + 展开的子清单块）
    let r = null;
    if (anchorVisible) {
        const rects = anchorEls.map(el => el.getBoundingClientRect());
        r = {
            left: Math.min.apply(null, rects.map(x => x.left)),
            top: Math.min.apply(null, rects.map(x => x.top)),
            right: Math.max.apply(null, rects.map(x => x.right)),
            bottom: Math.max.apply(null, rects.map(x => x.bottom))
        };
    }

    // 无锚点步骤可声明 dim:true，由遮罩层整屏压暗（与聚光框 box-shadow 同色）；有锚点时压暗由聚光框负责
    _obOverlay.classList.toggle('ob-dim', step.dim === true && !r);

    if (r && step.paletteDemo) {
        // 命令面板演示：不画聚光框（面板自带遮罩与边框），卡片置于面板正下方、中心对齐
        _obSpotlight.style.display = 'none';
        const card = _obTooltip.firstElementChild;
        if (card) {
            const cw = Math.min(400, vw - 32);
            card.style.width = cw + 'px';
            const ch = card.offsetHeight;
            // 垂直：优先面板下方；放不下退到面板上方；仍放不下贴底夹紧
            let y;
            if (r.bottom + 16 + ch <= vh - 16) {
                y = r.bottom + 16;
            } else if (r.top - 16 - ch >= 16) {
                y = r.top - 16 - ch;
            } else {
                y = Math.max(16, vh - ch - 16);
            }
            let x = r.left + (r.right - r.left - cw) / 2;
            x = Math.min(Math.max(16, x), Math.max(16, vw - cw - 16));
            _obTooltip.style.left = x + 'px';
            _obTooltip.style.top = y + 'px';
        }
    } else if (r) {
        // 聚光框：跟随联合矩形
        const pad = 8;
        _obSpotlight.style.display = 'block';
        _obSpotlight.style.left = (r.left - pad) + 'px';
        _obSpotlight.style.top = (r.top - pad) + 'px';
        _obSpotlight.style.width = (r.right - r.left + pad * 2) + 'px';
        _obSpotlight.style.height = (r.bottom - r.top + pad * 2) + 'px';

        // 气泡卡片：优先联合矩形下方，其次上方，最后居中；水平对齐左缘并夹紧
        const card = _obTooltip.firstElementChild;
        if (card) {
            const cw = Math.min(400, vw - 32);
            card.style.width = cw + 'px';
            const ch = card.offsetHeight;
            let x, y;
            if (r.bottom + 16 + ch <= vh - 16) {
                y = r.bottom + 16;
            } else if (r.top - 16 - ch >= 16) {
                y = r.top - 16 - ch;
            } else {
                y = Math.max(16, (vh - ch) / 2);
            }
            x = Math.min(Math.max(16, r.left), Math.max(16, vw - cw - 16));
            _obTooltip.style.left = x + 'px';
            _obTooltip.style.top = y + 'px';
        }
    } else {
        _obSpotlight.style.display = 'none';
        // 无可见锚点：居中退化；步骤声明 position:'bottom' 时改为底部居中（贴近 Toast 实际弹出位置）
        const card = _obTooltip.firstElementChild;
        if (card) {
            const cw = Math.min(400, vw - 32);
            card.style.width = cw + 'px';
            const ch = card.offsetHeight;
            _obTooltip.style.left = Math.max(16, (vw - cw) / 2) + 'px';
            if (step.position === 'bottom') {
                _obTooltip.style.top = Math.max(16, vh - ch - 32) + 'px';
            } else {
                _obTooltip.style.top = Math.max(16, (vh - ch) / 2 - 20) + 'px';
            }
        }
    }
}

// —— 渲染当前步骤 ——
function _obShowStep() {
    const step = _obSteps[_onboardingStep];
    if (!step) return;

    _obClearReveals();
    if (typeof step.onEnter === 'function') step.onEnter();
    _obApplyReveals(step);

    const total = _obSteps.length;
    const isLast = _onboardingStep === total - 1;
    _obTooltip.innerHTML = `
        <div class="ob-card bg-theme-secondary border border-theme rounded-xl shadow-2xl p-4">
            <div class="flex items-center justify-between mb-2">
                <span class="text-xs text-theme-muted">${step.group}</span>
                <span class="text-xs text-theme-muted">${_onboardingStep + 1} / ${total}</span>
            </div>
            <h3 class="text-base font-semibold text-theme-primary mb-1.5">${step.title}</h3>
            <div class="text-sm text-theme-secondary leading-relaxed">${step.body}</div>
            <div class="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-theme">
                <div class="flex items-center gap-3 text-xs">
                    <button data-ob="skip" class="text-theme-muted hover:text-theme-primary transition">跳过</button>
                    <button data-ob="never" class="text-theme-muted hover:text-theme-primary transition">不再显示</button>
                </div>
                <div class="flex items-center gap-2">
                    ${_onboardingStep > 0 ? `<button data-ob="prev" class="px-3 py-1.5 rounded-lg text-xs border border-theme text-theme-secondary hover:bg-theme-tertiary hover:text-theme-primary transition">上一步</button>` : ''}
                    <button data-ob="next" class="px-4 py-1.5 rounded-lg text-xs font-medium text-white transition hover:opacity-90" style="background: var(--accent-color, #3b82f6)">${isLast ? '开始使用' : '下一步'}</button>
                </div>
            </div>
        </div>`;

    // 有 delay 的步骤（命令面板演示）：等 NLP 预览防抖与面板动画稳定后再显示卡片，
    // 避免先按短面板定位、预览渲染变高后卡片跳位
    if (_obRepositionTimer) clearTimeout(_obRepositionTimer);
    if (step.delay) {
        _obTooltip.style.visibility = 'hidden';
        _obRepositionTimer = setTimeout(function () {
            if (!_onboardingActive) return;
            _obPosition();
            _obTooltip.style.visibility = '';
            // 卡片动画在隐藏期间已播完，重置后重新播放入场效果
            const card = _obTooltip.firstElementChild;
            if (card) {
                card.classList.remove('ob-card');
                void card.offsetWidth;
                card.classList.add('ob-card');
            }
        }, step.delay);
    } else {
        _obPosition();
    }
}

function _obGoStep(idx) {
    const prev = _obSteps[_onboardingStep];
    if (prev && typeof prev.onLeave === 'function') prev.onLeave();
    _obClearReveals();
    _onboardingStep = Math.max(0, Math.min(idx, _obSteps.length - 1));
    _obShowStep();
}

// —— 结束：markSeen=true 写入版本标记；无论何种结束方式都删除本次创建的演示数据 ——
function _obFinish(markSeen) {
    if (!_onboardingActive) return;
    const cur = _obSteps[_onboardingStep];
    if (cur && typeof cur.onLeave === 'function') cur.onLeave();
    _obTeardown();
    // 撤掉遮罩后再清理演示数据（侧栏 / 标签 / 视图即时刷新），保证关闭引导后为空数据
    const dataChanged = _obRemoveDemoData();
    if (markSeen) settings.onboardingVersion = ONBOARDING_VERSION;
    if ((markSeen || dataChanged) && typeof saveData === 'function') saveData();
}

function _obTeardown() {
    _onboardingActive = false;
    _obClearReveals();
    if (_obRepositionTimer) { clearTimeout(_obRepositionTimer); _obRepositionTimer = null; }
    window.removeEventListener('resize', _obPosition);
    window.removeEventListener('scroll', _obPosition, true);
    document.removeEventListener('keydown', _obKeydown, true);
    if (_obOverlay && _obOverlay.parentNode) _obOverlay.remove();
    _obOverlay = null;
    _obSpotlight = null;
    _obTooltip = null;
}

function _obKeydown(e) {
    if (!_onboardingActive) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        _obFinish(false);
    }
}

function _obClick(e) {
    const btn = e.target.closest('[data-ob]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const action = btn.dataset.ob;
    if (action === 'skip') _obFinish(false);
    else if (action === 'never') _obFinish(true);
    else if (action === 'prev') _obGoStep(_onboardingStep - 1);
    else if (action === 'next') {
        if (_onboardingStep >= _obSteps.length - 1) _obFinish(true);
        else _obGoStep(_onboardingStep + 1);
    }
}

// —— 启动 ——
function startOnboarding(force) {
    if (_onboardingActive) return;
    if (!force && settings.onboardingVersion >= ONBOARDING_VERSION) return;
    _onboardingActive = true;
    _onboardingStep = 0;
    // 幂等创建示例清单 / 清单集 / 标签（命令面板演示与清单步骤的高亮目标）
    _obEnsureDemoData();
    _obSteps = _obBuildSteps();
    _obEnsureStyle();

    _obOverlay = document.createElement('div');
    _obOverlay.className = 'ob-overlay';
    _obOverlay.id = 'onboarding-overlay';
    _obOverlay.addEventListener('click', function (e) {
        // 遮罩本身拦截一切底层交互；点击空白不关闭（避免误触中断引导）
        e.preventDefault();
        e.stopPropagation();
    });

    _obSpotlight = document.createElement('div');
    _obSpotlight.className = 'ob-spotlight';
    // 首次定位不做过渡（避免从 (0,0) 飞入）
    _obSpotlight.style.transition = 'none';

    _obTooltip = document.createElement('div');
    _obTooltip.className = 'ob-tooltip';
    _obTooltip.addEventListener('click', _obClick);

    _obOverlay.appendChild(_obSpotlight);
    _obOverlay.appendChild(_obTooltip);
    document.body.appendChild(_obOverlay);

    window.addEventListener('resize', _obPosition);
    window.addEventListener('scroll', _obPosition, true);
    document.addEventListener('keydown', _obKeydown, true);

    _obShowStep();
    // 下一帧恢复聚光框过渡（步骤间平滑移动）
    requestAnimationFrame(function () {
        if (_obSpotlight) _obSpotlight.style.transition = '';
    });
}

// —— 自动触发：未看过引导 && 当前无任务（导入过数据的老用户不打扰） ——
function maybeStartOnboarding() {
    if (_onboardingActive) return;
    if (typeof settings === 'undefined' || !settings) return;
    if (settings.onboardingVersion >= ONBOARDING_VERSION) return;
    if (typeof tasks !== 'undefined' && tasks && tasks.length > 0) return;
    // 等待首帧渲染完成后再启动，避免与初始化渲染竞争
    setTimeout(function () {
        if (!_onboardingActive) startOnboarding(false);
    }, 600);
}
