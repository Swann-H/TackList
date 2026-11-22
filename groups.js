// groups.js — 任务模板 / 联系人的单归属分组（方案 A：标题栏圆钮 + 右侧抽屉）
//
// 依赖（运行时解析）：settings / taskTemplates / saveData / escapeHtml / generateId /
//   showToast / inlineNameInput / renderView / refreshTaskTemplatesUi / renderPeopleList /
//   getPinyinInitialsForName
//
// 数据模型（全部向后兼容，旧数据零迁移）：
//   settings.templateGroups : [{ id, name, collapsed? }]  任务模板分组定义，数组顺序即显示顺序
//   settings.peopleGroups   : [{ id, name, collapsed? }]  联系人自定义分组定义，数组顺序即显示顺序
//   模板顶层 tpl.groupId / 联系人 p.groupId    所属分组 id；缺失或悬空一律视为「默认」
//   settings.peopleGroupMode 联系人分组依据：custom | initial | created | lastUsed
//   settings.peopleGroupCollapsed 自动段折叠状态：{ 'initial:A': true, ... }
// 「默认」是虚拟组（无 id、不可改名/删除、恒置底），仅用于容纳未分组条目。
// 自动依据下 groupId 保留但不参与分桶；切回 custom 原样恢复。
//
// 两个页面各自维护自己的分组体系，互不共用。分组名大小写不敏感、忽略首尾及内部空白后唯一。

const GROUP_DEFAULT_NAME = '默认';

// 联系人分组依据（与 data.js 的枚举校验保持一致）
const PEOPLE_GROUP_MODES = [
    { id: 'custom', label: '自定义分组' },
    { id: 'initial', label: '按首字母' },
    { id: 'created', label: '按添加时间' },
    { id: 'lastUsed', label: '按最近使用时间' }
];
// 最近使用档位顺序与显示名（顺序即展示顺序，兜底 never 恒置底）
const LAST_USED_BUCKETS = [
    { id: 'today', name: '今天' },
    { id: 'yesterday', name: '昨天' },
    { id: 'week7', name: '近7天' },
    { id: 'month30', name: '近30天' },
    { id: 'older', name: '更早' },
    { id: 'never', name: '从未使用' }
];

let _groupDrawerKind = null;          // 'template' | 'people' | null
let _groupPickKind = null;            // 新建选组气泡所属页面
let _groupPickAnchor = null;          // 触发气泡的按钮
let _groupRenameId = null;            // 正在重命名的组 id
let _groupRenameKind = null;          // 正在重命名的组所属页面
const _groupNewIds = new Set();       // 空名新建、尚未完成首次命名的组（未命名即关闭视为误操作）
let _groupDeleteConfirmId = null;     // 删除二次确认的组 id
let _groupDeleteTimer = null;
let _groupEscBound = false;

// 抽屉/气泡的 Esc 关闭（一次绑定，常驻）
function _bindGroupGlobalKeys() {
    if (_groupEscBound) return;
    _groupEscBound = true;
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (document.getElementById('group-pick-popover')) { closeGroupPick(); return; }
        if (_groupDrawerKind) { closeGroupDrawer(); }
    });
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bindGroupGlobalKeys);
    else _bindGroupGlobalKeys();
}

/* ==================== 通用数据辅助 ==================== */

function getGroupDefs(kind) {
    const key = kind === 'template' ? 'templateGroups' : 'peopleGroups';
    if (!Array.isArray(settings[key])) settings[key] = [];
    return settings[key];
}

// 组 id -> 名称；默认组返回空串（调用方据此显示 GROUP_DEFAULT_NAME）
function getGroupName(kind, groupId) {
    if (!groupId) return '';
    const g = getGroupDefs(kind).find(function (x) { return x && x.id === groupId; });
    return g ? (g.name || '') : '';
}

// 条目归属：groupId 悬空（指向已不存在的组）一律回落默认（返回 ''）
function normalizeGroupId(kind, groupId) {
    if (!groupId) return '';
    return getGroupDefs(kind).some(function (x) { return x && x.id === groupId; }) ? groupId : '';
}

function groupNameKey(name) {
    return String(name || '').replace(/\s+/g, '').toLowerCase();
}

// 校验组名可用性：空名 / 重名返回 false。excludeId 用于重命名时排除自身
function isGroupNameAvailable(kind, name, excludeId) {
    const key = groupNameKey(name);
    if (!key || key === groupNameKey(GROUP_DEFAULT_NAME)) return false;
    return !getGroupDefs(kind).some(function (g) {
        return g && g.id !== excludeId && groupNameKey(g.name) === key;
    });
}

// 按分组聚合条目。返回 [{ id, name, isDefault, collapsed, items }]，默认/兜底段恒置底。
// items 已由调用方过滤（搜索态则由调用方直接平铺，不走此函数）。
// mode 仅对联系人有效：非 custom 时走自动分桶，groupId 不参与。
function groupItems(kind, items, mode) {
    if (kind === 'people' && mode && mode !== 'custom') return groupPeopleByMode(items, mode);
    const defs = getGroupDefs(kind);
    const buckets = new Map();
    defs.forEach(function (g) { if (g && g.id) buckets.set(g.id, []); });
    const defaultItems = [];
    (items || []).forEach(function (item) {
        const id = normalizeGroupId(kind, item && item.groupId);
        if (!id) { defaultItems.push(item); return; }
        if (!buckets.has(id)) buckets.set(id, []);
        buckets.get(id).push(item);
    });
    const out = defs.filter(function (g) { return g && g.id; }).map(function (g) {
        return { id: g.id, name: g.name || '未命名分组', isDefault: false, collapsed: !!g.collapsed, items: buckets.get(g.id) || [] };
    });
    out.push({ id: '', name: GROUP_DEFAULT_NAME, isDefault: true, items: defaultItems });
    return out;
}

/* ==================== 联系人分组依据（自动分桶） ==================== */

function getPeopleGroupMode() {
    const m = settings.peopleGroupMode;
    return PEOPLE_GROUP_MODES.some(function (x) { return x.id === m; }) ? m : 'custom';
}

function setPeopleGroupMode(mode) {
    if (!PEOPLE_GROUP_MODES.some(function (x) { return x.id === mode; })) return;
    settings.peopleGroupMode = mode;
    saveData();
    // 切换只改视角，不动任何联系人记录（groupId 保留，切回 custom 原样恢复）
    if (typeof refreshGroupsUi === 'function') refreshGroupsUi();
    if (typeof renderPeopleFieldConfigExtras === 'function') renderPeopleFieldConfigExtras();
}

function isAutoGroupCollapsed(segId) {
    return !!(settings.peopleGroupCollapsed && settings.peopleGroupCollapsed[segId] === true);
}

function toggleAutoGroupCollapse(segId) {
    if (!settings.peopleGroupCollapsed || typeof settings.peopleGroupCollapsed !== 'object'
        || Array.isArray(settings.peopleGroupCollapsed)) settings.peopleGroupCollapsed = {};
    if (settings.peopleGroupCollapsed[segId]) delete settings.peopleGroupCollapsed[segId];
    else settings.peopleGroupCollapsed[segId] = true;
    saveData();
    if (typeof renderPeopleList === 'function') renderPeopleList();
}

// 单条联系人的桶键；兜底键由各依据的 make 处理（置底、不可折叠）
function _personAutoBucketKey(person, mode) {
    if (!person) return '';
    if (mode === 'initial') {
        // 复用 @ 候选的拼音首字母口径，取首字符；数字/符号/无法归类归 '#'
        const initials = (typeof getPinyinInitialsForName === 'function')
            ? getPinyinInitialsForName(person.name) : '';
        const ch = String(initials || '').charAt(0).toUpperCase();
        return /^[A-Z]$/.test(ch) ? ch : '#';
    }
    if (mode === 'created') {
        const ts = Number(person.createdAt) || 0;
        if (!ts) return 'unknown';
        const d = new Date(ts);
        if (isNaN(d.getTime()) || d.getFullYear() < 1970) return 'unknown';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }
    if (mode === 'lastUsed') {
        const ts = Number(person.lastUsedAt) || 0;
        if (!ts) return 'never';
        const d = new Date(ts);
        if (isNaN(d.getTime())) return 'never';
        const now = new Date();
        const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const used0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const days = Math.round((today0 - used0) / 86400000);
        if (days <= 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 7) return 'week7';
        if (days < 30) return 'month30';
        return 'older';
    }
    return '';
}

function groupPeopleByMode(items, mode) {
    const buckets = new Map();
    (items || []).forEach(function (p) {
        const key = _personAutoBucketKey(p, mode);
        if (!key) return;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(p);
    });
    const make = function (key, name, isDefault) {
        const segId = mode + ':' + key;
        return {
            id: segId, name: name, isDefault: !!isDefault,
            collapsed: isDefault ? false : isAutoGroupCollapsed(segId),
            items: buckets.get(key) || []
        };
    };
    if (mode === 'initial') {
        // 只显示非空字母段，'#' 兜底恒置底
        const keys = Array.from(buckets.keys()).filter(function (k) { return k !== '#'; }).sort();
        const out = keys.map(function (k) { return make(k, k, false); });
        if (buckets.has('#')) out.push(make('#', '#', true));
        return out;
    }
    if (mode === 'created') {
        // 年-月倒序，新在前；时间未知置底
        const keys = Array.from(buckets.keys()).filter(function (k) { return k !== 'unknown'; }).sort().reverse();
        const out = keys.map(function (k) {
            return make(k, k.slice(0, 4) + '年' + Number(k.slice(5)) + '月', false);
        });
        if (buckets.has('unknown')) out.push(make('unknown', '时间未知', true));
        return out;
    }
    if (mode === 'lastUsed') {
        // 只显示非空档；'从未使用' 始终显示（即使为空），避免一屏空段
        const out = [];
        LAST_USED_BUCKETS.forEach(function (b) {
            if (b.id === 'never' || buckets.has(b.id)) out.push(make(b.id, b.name, b.id === 'never'));
        });
        return out;
    }
    return [];
}

function groupItemCount(kind, groupId) {
    const items = kind === 'template' ? getTaskTemplates() : (settings.people || []);
    const want = normalizeGroupId(kind, groupId);
    return items.filter(function (item) {
        return normalizeGroupId(kind, item && item.groupId) === want;
    }).length;
}

/* ==================== 分组 CRUD（增改语义与看板分组一致） ==================== */

// 新增：空名创建并立即进入命名；未命名失焦/关闭静默丢弃，重名取消新增（同看板 addKanbanGroup）
function addGroup(kind) {
    const defs = getGroupDefs(kind);
    const g = { id: (kind === 'template' ? 'tg_' : 'pg_') + generateId(), name: '' };
    defs.push(g);
    _groupNewIds.add(g.id);
    _groupRenameId = g.id;
    _groupRenameKind = kind;
    saveData();
    if (typeof refreshGroupsUi === 'function') refreshGroupsUi();
    refreshGroupManagerUi();
    setTimeout(function () {
        const input = document.getElementById('group-rename-input');
        if (input) { input.focus(); input.select(); }
    }, 30);
}

// 删除组定义并把组内条目移入「默认」；返回移动数（不弹提示、不刷新管理 UI）
function _removeGroupCore(kind, groupId) {
    const defs = getGroupDefs(kind);
    const i = defs.findIndex(function (g) { return g && g.id === groupId; });
    if (i === -1) return 0;
    defs.splice(i, 1);
    const items = kind === 'template' ? getTaskTemplates() : (settings.people || []);
    let moved = 0;
    items.forEach(function (item) {
        if (item && item.groupId === groupId) {
            item.groupId = '';
            // 防止按 updatedAt 做冲突合并时旧副本覆盖掉这次的 groupId 变更
            item.updatedAt = kind === 'template' ? new Date().toISOString() : Date.now();
            moved++;
        }
    });
    saveData();
    if (typeof refreshGroupsUi === 'function') refreshGroupsUi();
    return moved;
}

function renameGroup(kind, groupId, name) {
    const g = getGroupDefs(kind).find(function (x) { return x && x.id === groupId; });
    _groupRenameId = null;
    _groupRenameKind = null;
    if (!g) { _groupNewIds.delete(groupId); refreshGroupManagerUi(); return; }
    const trimmed = String(name == null ? '' : name).trim().slice(0, 20);
    const isNew = _groupNewIds.has(groupId);
    if (!trimmed) {
        // 未填名称：新分组视为误操作丢弃；已有分组保持原名
        if (isNew) { _groupNewIds.delete(groupId); _removeGroupCore(kind, groupId); }
        refreshGroupManagerUi();
        return;
    }
    if (!isGroupNameAvailable(kind, trimmed, groupId)) {
        if (isNew) {
            _groupNewIds.delete(groupId);
            _removeGroupCore(kind, groupId);
            showToast('分组名称已存在，已取消新增', 'warning');
        } else {
            showToast('分组名重复或为保留名，已保持原名', 'warning');
        }
        refreshGroupManagerUi();
        return;
    }
    g.name = trimmed;
    _groupNewIds.delete(groupId);
    saveData();
    if (typeof refreshGroupsUi === 'function') refreshGroupsUi();
    refreshGroupManagerUi();
}

function cancelRenameGroup() {
    const kind = _groupRenameKind;
    const gid = _groupRenameId;
    _groupRenameId = null;
    _groupRenameKind = null;
    if (gid && _groupNewIds.has(gid)) {
        _groupNewIds.delete(gid);
        _removeGroupCore(kind, gid);
    }
    refreshGroupManagerUi();
}

// 面板/抽屉关闭时落定进行中的改名（新分组未命名则按空名规则丢弃）
function finalizeGroupRename() {
    if (!_groupRenameId) return;
    const input = document.getElementById('group-rename-input');
    renameGroup(_groupRenameKind || 'people', _groupRenameId, input ? input.value : '');
}

function moveGroup(kind, groupId, dir) {
    const defs = getGroupDefs(kind);
    const i = defs.findIndex(function (g) { return g && g.id === groupId; });
    const j = i + dir;
    if (i === -1 || j < 0 || j >= defs.length) return;
    const tmp = defs[i]; defs[i] = defs[j]; defs[j] = tmp;
    saveData();
    if (typeof refreshGroupsUi === 'function') refreshGroupsUi();
    refreshGroupManagerUi();
}

// 请求删除：首次点亮二次确认，再次点击才真正删除
function requestDeleteGroup(kind, groupId) {
    if (!getGroupDefs(kind).some(function (g) { return g && g.id === groupId; })) return;
    if (_groupDeleteConfirmId === groupId) { confirmDeleteGroup(kind, groupId); return; }
    _groupDeleteConfirmId = groupId;
    if (_groupDeleteTimer) clearTimeout(_groupDeleteTimer);
    _groupDeleteTimer = setTimeout(function () {
        _groupDeleteConfirmId = null;
        refreshGroupManagerUi();
    }, 3000);
    refreshGroupManagerUi();
}

function confirmDeleteGroup(kind, groupId) {
    if (_groupDeleteTimer) { clearTimeout(_groupDeleteTimer); _groupDeleteTimer = null; }
    _groupDeleteConfirmId = null;
    const moved = _removeGroupCore(kind, groupId);
    refreshGroupManagerUi();
    showToast('分组已删除，' + moved + ' 个条目已移入「' + GROUP_DEFAULT_NAME + '」', 'success');
}

/* ==================== 抽屉 UI ==================== */

function ensureGroupDrawer() {
    let mask = document.getElementById('group-drawer-mask');
    if (mask) return;
    mask = document.createElement('div');
    mask.id = 'group-drawer-mask';
    mask.className = 'hidden fixed inset-0 z-40';
    mask.style.background = 'rgba(0,0,0,.35)';
    mask.onclick = function (e) { if (e.target === mask) closeGroupDrawer(); };
    const panel = document.createElement('aside');
    panel.id = 'group-drawer-panel';
    panel.className = 'absolute top-0 right-0 h-full w-96 max-w-[92vw] bg-theme-secondary border-l border-theme shadow-xl flex flex-col';
    panel.style.transition = 'transform .28s ease';
    mask.appendChild(panel);
    document.body.appendChild(mask);
}

function openGroupDrawer(kind) {
    finalizeGroupRename(); // 内嵌区可能有进行中的命名，先落定再切换
    _groupDrawerKind = kind === 'people' ? 'people' : 'template';
    _groupRenameId = null;
    _groupRenameKind = null;
    _groupDeleteConfirmId = null;
    if (_groupDeleteTimer) { clearTimeout(_groupDeleteTimer); _groupDeleteTimer = null; }
    ensureGroupDrawer();
    const mask = document.getElementById('group-drawer-mask');
    mask.classList.remove('hidden');
    renderGroupDrawer();
    const panel = document.getElementById('group-drawer-panel');
    if (panel) panel.style.transform = 'translateX(0)';
}

function closeGroupDrawer() {
    finalizeGroupRename(); // 关闭即落定：已命名保存，空名新组静默丢弃
    const panel = document.getElementById('group-drawer-panel');
    if (panel) panel.style.transform = 'translateX(100%)';
    setTimeout(function () {
        const mask = document.getElementById('group-drawer-mask');
        if (mask) mask.classList.add('hidden');
        _groupDrawerKind = null;
        _groupRenameId = null;
        _groupRenameKind = null;
        _groupDeleteConfirmId = null;
    }, 280);
}

// 抽屉与联系人配置面板内嵌区共用的行渲染
// 注意：内联事件属性一律用转义单引号嵌入参数（双引号会截断 HTML 属性）
// 操作按钮样式对齐任务模板编辑界面（taskTemplates.js）：w-8 h-8 圆角方钮 + tone-outline-* 描边
function groupManagerRowsHtml(kind) {
    const defs = getGroupDefs(kind);
    const actCls = 'w-8 h-8 rounded-lg flex items-center justify-center transition flex-shrink-0';
    const sortCls = actCls + ' tone-outline-sky';
    const rows = defs.map(function (g, i) {
        if (!g) return '';
        const renaming = _groupRenameId === g.id;
        // 名称常驻为输入框（与预置项目行的 people-field-row-label 同款）：单击即编辑，失焦/回车保存
        // 新建分组的命名态仍走 inlineNameInput（自动聚焦全选、Escape 取消）
        const nameHtml = renaming
            ? inlineNameInput('group-rename-input', g.name || '',
                'renameGroup(\'' + kind + '\',\'' + g.id + '\',document.getElementById(\'group-rename-input\').value)',
                'cancelRenameGroup()', { placeholder: '分组名称' })
            : '<input type="text" class="people-field-row-label" value="' + escapeHtml(g.name || '') + '" maxlength="20" autocomplete="off" ' +
                  'onchange="renameGroup(\'' + kind + '\',\'' + g.id + '\',this.value)">';
        const confirming = _groupDeleteConfirmId === g.id;
        const deleteCls = actCls + (confirming ? ' tone-solid-red' : ' tone-outline-red');
        return '<div class="group-cfg-row relative flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-theme-tertiary transition" data-gid="' + g.id + '" onpointerdown="groupCfgPointerDown(event,\'' + kind + '\',\'' + g.id + '\')">' +
            nameHtml +
            '<button type="button" onclick="moveGroup(\'' + kind + '\',\'' + g.id + '\',-1)" class="' + sortCls + (i === 0 ? ' opacity-30 pointer-events-none' : '') + '" title="上移"><i class="fas fa-arrow-up text-sm"></i></button>' +
            '<button type="button" onclick="moveGroup(\'' + kind + '\',\'' + g.id + '\',1)" class="' + sortCls + (i === defs.length - 1 ? ' opacity-30 pointer-events-none' : '') + '" title="下移"><i class="fas fa-arrow-down text-sm"></i></button>' +
            '<button type="button" onclick="requestDeleteGroup(\'' + kind + '\',\'' + g.id + '\')" class="' + deleteCls + '" title="' + (confirming ? '确认删除' : '删除') + '"><i class="fas fa-trash text-sm"></i></button>' +
        '</div>';
    }).join('');
    const defaultRow =
        '<div class="flex items-center py-2 px-2 mt-2 border-t border-theme text-sm text-theme-secondary" title="未分组条目的归集处，不可改名或删除">' +
            '<span>' + GROUP_DEFAULT_NAME + '</span>' +
        '</div>';
    return { rows: rows, defaultRow: defaultRow };
}

function renderGroupDrawer() {
    const panel = document.getElementById('group-drawer-panel');
    if (!panel || !_groupDrawerKind) return;
    // 命名输入中跳过重绘，避免输入框被重建丢焦点；提交路径会先清 _groupRenameId 再刷新
    if (_groupRenameId && document.activeElement && document.activeElement.id === 'group-rename-input') return;
    const kind = _groupDrawerKind;
    const title = kind === 'template' ? '任务模板分组' : '联系人分组';
    const parts = groupManagerRowsHtml(kind);
    panel.innerHTML =
        '<div class="flex items-center justify-between p-4 border-b border-theme flex-shrink-0">' +
            '<h3 class="text-lg font-semibold text-theme-primary">' + title + '</h3>' +
            '<button onclick="closeGroupDrawer()" class="p-2 hover:bg-theme-tertiary rounded-lg transition"><i class="fas fa-times text-theme-muted"></i></button>' +
        '</div>' +
        '<div class="flex-1 overflow-y-auto p-3">' +
            '<p class="text-xs text-theme-muted leading-relaxed px-2 mb-2">条目按分组归类显示；删除分组后，其中的条目会移入「' + GROUP_DEFAULT_NAME + '」。</p>' +
            '<div class="space-y-1">' + (parts.rows || '<div class="text-xs text-theme-muted px-2 py-4 text-center">还没有分组，点击下方按钮新建</div>') + '</div>' +
            parts.defaultRow +
            '<p class="text-[11px] text-theme-muted px-2 mt-1 leading-relaxed">「' + GROUP_DEFAULT_NAME + '」为未分组条目的归集处，不可改名或删除。</p>' +
        '</div>' +
        '<div class="p-3 border-t border-theme flex-shrink-0">' +
            '<button type="button" onclick="addGroup(\'' + kind + '\')" class="w-full px-3 py-2 rounded-lg border-2 border-dashed border-accent text-accent hover:bg-theme-tertiary transition text-sm"><i class="fas fa-plus mr-1"></i>新建分组</button>' +
        '</div>';
}

// 联系人配置面板内的内嵌分组管理区（与字段配置同一入口）
function renderPeopleGroupInline() {
    const wrap = document.getElementById('people-group-config-inline');
    if (!wrap) return;
    if (getPeopleGroupMode() !== 'custom') { wrap.innerHTML = ''; return; }
    if (_groupRenameId && document.activeElement && document.activeElement.id === 'group-rename-input') return;
    const parts = groupManagerRowsHtml('people');
    wrap.innerHTML =
        '<div class="space-y-1">' + (parts.rows || '<div class="text-xs text-theme-muted px-2 py-3 text-center">还没有分组，点击下方按钮新建</div>') + '</div>' +
        parts.defaultRow +
        '<button type="button" onclick="addGroup(\'people\')" class="w-full mt-2 px-3 py-2 rounded-lg border-2 border-dashed border-accent text-accent hover:bg-theme-tertiary transition text-sm"><i class="fas fa-plus mr-1"></i>新建分组</button>';
}

// 分组 CRUD 后同时刷新抽屉与内嵌区
function refreshGroupManagerUi() {
    renderGroupDrawer();
    renderPeopleGroupInline();
}

function startRenameGroup(kind, groupId) {
    finalizeGroupRename(); // 已有进行中的命名先落定，保证同一时刻只有一个输入框
    if (!getGroupDefs(kind).some(function (g) { return g && g.id === groupId; })) return;
    _groupRenameId = groupId;
    _groupRenameKind = kind;
    refreshGroupManagerUi();
    setTimeout(function () {
        const input = document.getElementById('group-rename-input');
        if (input) { input.focus(); input.select(); }
    }, 30);
}

// 标题栏入口按钮：与搜索/新建/返回同风格的圆形按钮
function groupManagerButtonHtml(kind) {
    return '<button type="button" onclick="openGroupDrawer(\'' + kind + '\')" class="w-10 h-10 rounded-full border-2 border-teal-500 text-teal-500 flex items-center justify-center hover:bg-teal-500 hover:text-white transition" title="分组管理"><i class="fas fa-folder-tree"></i></button>';
}

/* ==================== 分组行长按拖拽排序（与看板分组配置同一套指针事件方案） ==================== */
// 长按 300ms 激活，位移超 6px 视为点选/划选立即取消；触摸端不启用（保留上下箭头按钮兜底）。
// 插入线用 inset box-shadow 指示，不触发布局；行坐标在激活时缓存，热路径零布局读取。
const GROUP_CFG_HOLD_MS = 300;
const GROUP_CFG_HOLD_TOLERANCE = 6;
const GROUP_CFG_HOLD_HINT_DELAY_MS = 150;
if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--group-cfg-hold-anim-ms', (GROUP_CFG_HOLD_MS - GROUP_CFG_HOLD_HINT_DELAY_MS) + 'ms');
}

let _gCfgHoldTimer = null;
let _gCfgHintTimer = null;
let _gCfgHoldRow = null;
let _gCfgHoldPointerId = null;
let _gCfgStartX = 0;
let _gCfgStartY = 0;
let _gCfgDragActive = false;
let _gCfgDragPointerId = null;
let _gCfgDragRow = null;
let _gCfgDragKind = null;
let _gCfgDragGid = null;
let _gCfgRects = [];          // [{ el, gid, top, bottom }]
let _gCfgTarget = null;       // { gid, after }
let _gCfgRAF = null;
let _gCfgPendingHL = null;
let _gCfgActiveEl = null;
let _gCfgActiveSide = null;
let _gCfgDragBound = false;

function _gCfgCancelHold() {
    if (_gCfgHoldTimer) { clearTimeout(_gCfgHoldTimer); _gCfgHoldTimer = null; }
    if (_gCfgHintTimer) { clearTimeout(_gCfgHintTimer); _gCfgHintTimer = null; }
    if (_gCfgHoldRow) { _gCfgHoldRow.classList.remove('group-cfg-holding'); _gCfgHoldRow = null; }
    _gCfgHoldPointerId = null;
}

function _gCfgClearHighlight() {
    if (_gCfgRAF) { cancelAnimationFrame(_gCfgRAF); _gCfgRAF = null; }
    _gCfgPendingHL = null;
    if (_gCfgActiveEl) {
        _gCfgActiveEl.style.boxShadow = '';
        _gCfgActiveEl.style.transition = '';
        _gCfgActiveEl = null;
    }
    _gCfgActiveSide = null;
}

function _gCfgApplyHighlight(el, side) {
    if (!el || (el === _gCfgActiveEl && side === _gCfgActiveSide)) return;
    _gCfgClearHighlight();
    _gCfgActiveEl = el;
    _gCfgActiveSide = side;
    el.style.transition = 'none';
    el.style.boxShadow = side === 'top' ? 'inset 0 3px 0 -1px #3b82f6' : 'inset 0 -3px 0 -1px #3b82f6';
}

function _gCfgScheduleHighlight(el, side) {
    // 同一帧多次 pointermove 只应用最后一次，保证插入线与最终落点一致
    _gCfgPendingHL = { el: el, side: side };
    if (_gCfgRAF) return;
    _gCfgRAF = requestAnimationFrame(function () {
        _gCfgRAF = null;
        const p = _gCfgPendingHL;
        _gCfgPendingHL = null;
        if (p) _gCfgApplyHighlight(p.el, p.side);
    });
}

function groupCfgPointerDown(e, kind, gid) {
    if (e.pointerType === 'touch') return;                       // 触摸端保持原生滚动，用箭头按钮排序
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest && (e.target.closest('button') || e.target.closest('input'))) return;
    if (_groupRenameId) return;                                  // 命名进行中不启用拖拽
    const row = e.currentTarget;
    _gCfgCancelHold();
    _gCfgHoldRow = row;
    _gCfgHoldPointerId = e.pointerId;
    _gCfgStartX = e.clientX;
    _gCfgStartY = e.clientY;
    _gCfgHintTimer = setTimeout(function () {
        _gCfgHintTimer = null;
        if (_gCfgHoldRow === row) row.classList.add('group-cfg-holding');
    }, GROUP_CFG_HOLD_HINT_DELAY_MS);
    _gCfgHoldTimer = setTimeout(function () {
        _gCfgHoldTimer = null;
        _gCfgStartDrag(row, kind, gid);
    }, GROUP_CFG_HOLD_MS);
    _gCfgBindDragEvents();
}

function _gCfgStartDrag(row, kind, gid) {
    if (_gCfgHintTimer) { clearTimeout(_gCfgHintTimer); _gCfgHintTimer = null; }
    row.classList.remove('group-cfg-holding');
    _gCfgHoldRow = null;
    _gCfgDragActive = true;
    _gCfgDragPointerId = _gCfgHoldPointerId;
    _gCfgHoldPointerId = null;
    _gCfgDragRow = row;
    _gCfgDragKind = kind;
    _gCfgDragGid = gid;
    _gCfgTarget = null;
    row.classList.add('group-cfg-drag-ready');
    document.body.classList.add('group-cfg-dragging');
    _gCfgRects = [];
    row.parentElement.querySelectorAll(':scope > .group-cfg-row[data-gid]').forEach(function (el) {
        const r = el.getBoundingClientRect();
        _gCfgRects.push({ el: el, gid: el.getAttribute('data-gid'), top: r.top, bottom: r.bottom });
    });
}

function _gCfgCleanupDrag() {
    _gCfgCancelHold();
    _gCfgClearHighlight();
    if (_gCfgDragRow) _gCfgDragRow.classList.remove('group-cfg-drag-ready');
    document.body.classList.remove('group-cfg-dragging');
    _gCfgDragActive = false;
    _gCfgDragPointerId = null;
    _gCfgDragRow = null;
    _gCfgDragKind = null;
    _gCfgDragGid = null;
    _gCfgRects = [];
    _gCfgTarget = null;
}

function _gCfgOnMove(e) {
    if (!_gCfgDragActive) {
        // 长按判定期：位移超容差视为点选/划选，静默取消
        if (_gCfgHoldRow && e.pointerId === _gCfgHoldPointerId) {
            const dx = e.clientX - _gCfgStartX;
            const dy = e.clientY - _gCfgStartY;
            if (dx * dx + dy * dy > GROUP_CFG_HOLD_TOLERANCE * GROUP_CFG_HOLD_TOLERANCE) _gCfgCancelHold();
        }
        return;
    }
    if (e.pointerId !== _gCfgDragPointerId) return;
    const y = e.clientY;
    let target = null;
    let hlEl = null;
    let hlSide = null;
    for (let i = 0; i < _gCfgRects.length; i++) {
        const r = _gCfgRects[i];
        if (r.gid === _gCfgDragGid) continue;
        if (y < (r.top + r.bottom) / 2) { target = { gid: r.gid, after: false }; hlEl = r.el; hlSide = 'top'; break; }
        target = { gid: r.gid, after: true }; hlEl = r.el; hlSide = 'bottom';
    }
    _gCfgTarget = target;
    if (hlEl) _gCfgScheduleHighlight(hlEl, hlSide);
    else _gCfgClearHighlight();
}

function _gCfgOnUp(e) {
    if (!_gCfgDragActive) {
        if (_gCfgHoldRow && e.pointerId === _gCfgHoldPointerId) _gCfgCancelHold();
        return;
    }
    if (e.pointerId !== _gCfgDragPointerId) return;
    const kind = _gCfgDragKind;
    const gid = _gCfgDragGid;
    const target = _gCfgTarget;
    _gCfgCleanupDrag();
    if (!target || target.gid === gid) return;
    const defs = getGroupDefs(kind);
    const from = defs.findIndex(function (g) { return g && g.id === gid; });
    if (from === -1) return;
    const moved = defs.splice(from, 1)[0];
    let to = defs.findIndex(function (g) { return g && g.id === target.gid; });
    if (to === -1) { defs.splice(from, 0, moved); return; }
    if (target.after) to++;
    defs.splice(to, 0, moved);
    saveData();
    if (typeof refreshGroupsUi === 'function') refreshGroupsUi();
    refreshGroupManagerUi();
}

function _gCfgBindDragEvents() {
    if (_gCfgDragBound) return;
    _gCfgDragBound = true;
    document.addEventListener('pointermove', _gCfgOnMove);
    document.addEventListener('pointerup', _gCfgOnUp);
    document.addEventListener('pointercancel', function (e) {
        if (_gCfgDragActive && e.pointerId === _gCfgDragPointerId) _gCfgCleanupDrag();
        else if (_gCfgHoldRow && e.pointerId === _gCfgHoldPointerId) _gCfgCancelHold();
    });
}

/* ==================== 新建时的分组选择气泡 ==================== */

function openGroupPick(kind, anchorBtn) {
    closeGroupPick();
    _groupPickKind = kind === 'people' ? 'people' : 'template';
    _groupPickAnchor = anchorBtn || null;
    // 自动依据下没有「选组」概念，任何入口都直接新建
    if (_groupPickKind === 'people' && getPeopleGroupMode() !== 'custom'
        && typeof startAddPerson === 'function') {
        _groupPickKind = null;
        _groupPickAnchor = null;
        startAddPerson('');
        return;
    }
    renderGroupPick();
}

function closeGroupPick() {
    const el = document.getElementById('group-pick-popover');
    if (el) el.remove();
    _groupPickKind = null;
    _groupPickAnchor = null;
    document.removeEventListener('pointerdown', _groupPickOutside, true);
}

function _groupPickOutside(e) {
    const pop = document.getElementById('group-pick-popover');
    if (pop && pop.contains(e.target)) return;
    if (_groupPickAnchor && _groupPickAnchor.contains && _groupPickAnchor.contains(e.target)) return;
    closeGroupPick();
}

function renderGroupPick() {
    const old = document.getElementById('group-pick-popover');
    if (old) old.remove();
    if (!_groupPickKind) return;
    const defs = getGroupDefs(_groupPickKind);
    const btns = [{ id: '', name: GROUP_DEFAULT_NAME }].concat(defs.filter(function (g) { return g && g.id; }));
    const pop = document.createElement('div');
    pop.id = 'group-pick-popover';
    pop.className = 'fixed z-50 bg-theme-secondary border border-theme rounded-xl shadow-xl py-1.5 px-1.5';
    pop.style.maxHeight = '60vh';
    pop.style.overflowY = 'auto';
    pop.style.minWidth = '160px';
    pop.innerHTML = '<div class="px-2 py-1 text-[11px] text-theme-muted">新建到分组</div>' + btns.map(function (g) {
        return '<button type="button" class="w-full text-left px-3 py-2 rounded-lg text-sm text-theme-primary hover:bg-theme-tertiary transition" onclick="chooseGroupPick(\'' + g.id + '\')">' + escapeHtml(g.name) + '</button>';
    }).join('');
    document.body.appendChild(pop);
    const r = _groupPickAnchor ? _groupPickAnchor.getBoundingClientRect() : null;
    const pr = pop.getBoundingClientRect();
    if (r) {
        let left = r.right - pr.width;
        if (left < 8) left = 8;
        let top = r.bottom + 6;
        if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
    } else {
        pop.style.left = Math.max(8, (window.innerWidth - pr.width) / 2) + 'px';
        pop.style.top = '72px';
    }
    setTimeout(function () {
        document.addEventListener('pointerdown', _groupPickOutside, true);
    }, 0);
}

function chooseGroupPick(groupId) {
    const kind = _groupPickKind;
    closeGroupPick();
    if (!kind) return;
    if (kind === 'template' && typeof startNewTaskTemplate === 'function') {
        startNewTaskTemplate(groupId || '');
    } else if (kind === 'people' && typeof startAddPerson === 'function') {
        startAddPerson(groupId || '');
    }
}

// 供各页面在分组变化后调用：刷新各自列表 + 选择器等派生 UI
function refreshGroupsUi() {
    if (typeof currentView !== 'undefined') {
        if (currentView === 'templates' && typeof _renderTaskTemplatesList === 'function') _renderTaskTemplatesList();
        if (currentView === 'people' && typeof renderPeopleList === 'function') renderPeopleList();
    }
    if (typeof refreshTaskTemplatePicker === 'function') refreshTaskTemplatePicker();
}
