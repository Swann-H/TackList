// people.js — 联系人功能（原「人员 / 通讯录」，一期，《需求文档_人员功能.md》FR-01 ~ FR-05）
//
// 轻入口设计：详情面板不设「人员」区块、无成员胶囊。
// 正文 @名字 即事实：task.peopleIds 是派生缓存（utils.js recomputeTaskPeopleIds）。
// 本文件提供：
//   · 联系人管理页（独立视图 'people'，设置面板入口，节假日页同范式）
//   · 详情描述/备注输入 @ 时的候选面板（拼音首字母匹配、行内快速创建）
//   · 渲染态提及点击 → 联系人浮层卡片（联系方式 / 相关任务 / 筛选入口）
//   · 联系人快捷筛选（与清单/标签/过滤器互斥，顶部提示条可清除）
//
// 依赖（运行时解析）：settings / tasks / currentView / currentListId / currentFilter /
// currentTagIds / currentFilterId / currentPersonId（utils.js）/ escapeHtml / generateId /
// showToast / saveData / switchView / openTaskDetailPanel / formatTaskTimeLabel / isTaskOverdue /
// getPersonColor / getPersonAvatarText / getPersonAvatarTextColor / renderPersonAvatarHtml /
// pickPersonAvatarColor / personAvatarOf

/* ==================== 共享：创建 / 重名校验 ==================== */

function personNameExists(name, excludeId) {
    const key = normalizePersonName(name);
    if (!key) return false;
    return (settings.people || []).some(function (p) {
        if (p.id === excludeId) return false;
        return getPersonAllNames(p).some(function (n) { return normalizePersonName(n) === key; });
    });
}

// 创建成员记录（行内快速创建与管理页共用）；重名/空名返回 null。落盘由调用方 saveData。
function createPersonRecord(name) {
    const trimmed = String(name == null ? '' : name).trim();
    if (!trimmed || personNameExists(trimmed)) return null;
    const now = Date.now();
    const person = {
        id: generateId(),
        name: trimmed,
        aliases: [],
        pinyinAlias: '',
        email: '',
        deviceAccount: '',
        phones: [],
        jobTitle: '',
        company: '',
        staffNo: '',
        note: '',
        color: (typeof pickPersonAvatarColor === 'function') ? pickPersonAvatarColor() : '',
        avatar: '',
        customFields: [],
        birthday: '',
        countdownId: '',
        archived: false,
        lastUsedAt: 0,
        createdAt: now,
        updatedAt: now
    };
    if (!Array.isArray(settings.people)) settings.people = [];
    // 系统托管全拼别名：按全部已占用名（正名/别名/全拼）去重，重名追加数字后缀
    const taken = {};
    settings.people.forEach(function (p) {
        getPersonAllNames(p).forEach(function (n) { taken[normalizePersonName(n)] = true; });
    });
    person.pinyinAlias = (typeof generatePersonPinyinAlias === 'function') ? generatePersonPinyinAlias(trimmed, taken) : '';
    settings.people.push(person);
    return person;
}

function countPersonMentions(personId) {
    let n = 0;
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (!t.deletedAt && (t.peopleIds || []).indexOf(personId) !== -1) n++;
    }
    return n;
}

// 新建成员/增删别名后：既有正文里的 @名字 可能从普通文本变为提及，全量重算派生缓存。
// 正文未变，不 touchTask（避免扰动任务排序/更新时间）。
function _recomputeAllPeopleIds() {
    let changed = 0;
    if (typeof tasks !== 'undefined' && Array.isArray(tasks)) {
        tasks.forEach(function (t) { if (recomputeTaskPeopleIds(t)) changed++; });
    }
    return changed;
}

/* ==================== FR-11 生日与倒计时联动 ==================== */

// 生日合法格式：YYYY-MM-DD 或 MM-DD（年份未知，按年重复）；允许 02-29
function normalizePersonBirthday(value) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return '';
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    let year = null, month, day;
    if (m) {
        year = parseInt(m[1], 10); month = parseInt(m[2], 10); day = parseInt(m[3], 10);
        if (year < 1900 || year > 2100) return null;
    } else {
        m = /^(\d{2})-(\d{2})$/.exec(v);
        if (!m) return null;
        month = parseInt(m[1], 10); day = parseInt(m[2], 10);
    }
    if (month < 1 || month > 12 || day < 1) return null;
    const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (day > maxDay) return null;
    if (year !== null && month === 2 && day === 29) {
        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        if (!leap) return null;
    }
    return v;
}

// 读取关联倒计时；引用失效（倒计时被删除）时惰性清空，与失效提及降级范式一致
function getPersonCountdown(person) {
    if (!person || !person.countdownId) return null;
    const cd = (settings.countdowns || []).find(function (c) { return c && c.id === person.countdownId; });
    if (!cd) { person.countdownId = ''; return null; }
    return cd;
}

// 「生日还有 N 天」徽标（管理页卡片与浮层卡片共用）；点击跳转倒计时视图
function _personBirthdayChipHtml(person) {
    const cd = getPersonCountdown(person);
    if (!cd) return '';
    const days = (typeof getCountdownDays === 'function') ? getCountdownDays(cd.date, cd.repeat) : null;
    if (days == null) return '';
    const text = days === 0 ? '今天生日' : '生日还有 ' + days + ' 天';
    return '<button type="button" onclick="event.stopPropagation();openPersonBirthdayCountdown()" class="text-[10px] px-1.5 py-0.5 rounded bg-theme-tertiary text-accent hover:opacity-80 transition flex-shrink-0 whitespace-nowrap" title="查看倒计时：' + escapeHtml(cd.name || '') + '"><i class="fas fa-cake-candles mr-1"></i>' + text + '</button>';
}

function openPersonBirthdayCountdown() {
    closePersonCard();
    if (typeof switchToCountdownPage === 'function') switchToCountdownPage();
    else switchView('countdown');
}

// 创建生日倒计时：复用既有倒计时数据范式（name/date/repeat:'yearly'），成功后写回 countdownId
function createBirthdayCountdown(personId) {
    const person = getPersonById(personId);
    if (!person || !person.birthday) return;
    if (getPersonCountdown(person)) { openPersonBirthdayCountdown(); return; }
    const anchor = person.birthday.length === 5
        ? (new Date().getFullYear() + '-' + person.birthday)
        : person.birthday;
    const item = {
        id: generateId(),
        name: (person.name + ' 的生日').slice(0, 20),
        date: anchor,
        repeat: 'yearly'
    };
    if (!Array.isArray(settings.countdowns)) settings.countdowns = [];
    settings.countdowns.push(item);
    person.countdownId = item.id;
    person.updatedAt = Date.now();
    saveData();
    renderPeopleList();
    if (typeof renderSidebarCountdown === 'function') renderSidebarCountdown();
    showToast('已创建生日倒计时：' + item.name, 'success');
}

// 解除关联：只清 countdownId，不删除倒计时本体；就地移除表单行，不打断其它未保存输入
function unlinkPersonCountdown(personId) {
    const person = getPersonById(personId);
    if (!person) return;
    person.countdownId = '';
    person.updatedAt = Date.now();
    saveData();
    const row = document.getElementById('people-form-countdown-row');
    if (row) row.remove();
    showToast('已解除生日倒计时关联（倒计时本身保留）', 'success');
}

/* ==================== FR-01 人员管理页 ==================== */

let peopleReturnSource = 'settings';
let peoplePrevView = 'task';
let peopleSearchVisible = false;
let peopleSearchQuery = '';
let peopleEditing = null;          // null | { id: string|null }（null=新建）
let peopleDeleteConfirming = null; // personId | null
let peopleDeleteTimer = null;
let peoplePendingAvatar;           // undefined=未改动 / ''=已移除 / {blob,url}=新图（url 为本地预览）
let peoplePendingColor = '';       // 新建时的默认底色（避免每次重绘重新随机）
let _peopleSaving = false;         // 保存进行中（头像上传 await 期间），防重复提交 / 点外保存重入

function switchToPeoplePage(source) {
    peopleReturnSource = source || 'settings';
    peoplePrevView = (typeof currentView !== 'undefined') ? currentView : 'task';
    if (typeof closeSettingsModal === 'function') closeSettingsModal();
    if (typeof closeTaskDetailPanel === 'function') closeTaskDetailPanel();
    peopleSearchVisible = false;
    peopleSearchQuery = '';
    peopleEditing = null;
    _peopleFormAnchorH = 0;
    peopleBatchMode = false;
    peopleBatchSelected = [];
    _releasePendingAvatar();
    peoplePendingColor = '';
    peopleDeleteConfirming = null;
    if (peopleDeleteTimer) { clearTimeout(peopleDeleteTimer); peopleDeleteTimer = null; }
    peopleHelpExpanded = false;
    switchView('people');
}

function closePeopleView() {
    if (peopleReturnSource === 'settings') {
        switchView(peoplePrevView || 'task');
        if (typeof openSettingsModal === 'function') openSettingsModal();
    } else {
        switchView(peoplePrevView || 'task');
    }
}

// 顶栏与任务模板页同范式：标题+计数徽标，右侧圆形 搜索/新增/返回 按钮，搜索框折叠展开
function renderPeopleView(container) {
    const total = (settings.people || []).length;
    const isMobile = typeof isMobileView === 'function' && isMobileView();
    const searchBtnClass = peopleSearchVisible
        ? 'bg-cyan-500 text-white'
        : 'border-2 border-cyan-500 text-cyan-500 hover:bg-cyan-500 hover:text-white';
    // 批量管理按钮与主视图同范式（index.html #batch-select-btn）：fa-list 图标 + 青色描边圆形；
    // 激活态沿用同排搜索按钮的「青色实底」口径
    const batchBtnClass = peopleBatchMode
        ? 'bg-cyan-500 text-white'
        : 'border-2 border-cyan-500 text-cyan-500 hover:bg-cyan-500 hover:text-white';
    const countBadge = '<span id="people-page-count" class="text-xs font-normal text-theme-muted whitespace-nowrap self-end mb-1 leading-none ' + (total ? '' : 'hidden') + '">' + total + '</span>';
    const buttons = '<div class="flex items-center gap-3 flex-shrink-0">' +
        '<button type="button" onclick="togglePeopleSearch()" class="w-10 h-10 rounded-full flex items-center justify-center transition ' + searchBtnClass + '" title="' + (peopleSearchVisible ? '隐藏搜索' : '搜索') + '"><i class="fas fa-search"></i></button>' +
        '<button type="button" onclick="togglePeopleBatchMode()" class="w-10 h-10 rounded-full flex items-center justify-center transition ' + batchBtnClass + '" title="' + (peopleBatchMode ? '退出批量管理' : '批量管理') + '"><i class="fas fa-list"></i></button>' +
        '<button type="button" onclick="togglePeopleFieldConfig()" id="people-field-config-btn" class="w-10 h-10 rounded-full border-2 border-indigo-500 text-indigo-500 flex items-center justify-center hover:bg-indigo-500 hover:text-white transition" title="联系人配置"><i class="fas fa-sliders-h"></i></button>' +
        '<button type="button" onclick="onPeoplePlusClick(this)" class="w-10 h-10 rounded-full border-2 border-purple-500 text-purple-500 flex items-center justify-center hover:bg-purple-500 hover:text-white transition" title="新增联系人"><i class="fas fa-plus"></i></button>' +
        '<button type="button" onclick="closePeopleView()" class="w-10 h-10 rounded-full border-2 border-slate-400 text-slate-500 flex items-center justify-center hover:bg-slate-400 hover:text-white active:bg-slate-500 active:scale-95 transition" title="返回"><i class="fas fa-arrow-left"></i></button>' +
    '</div>';
    const header = isMobile
        ? '<div class="flex items-center justify-between px-4 py-3 border-b border-theme/30 flex-shrink-0 gap-3">' +
              '<div class="flex items-center gap-2 min-w-0"><h1 class="text-lg font-bold text-theme-primary whitespace-nowrap">联系人</h1>' + countBadge + '</div>' +
              buttons +
          '</div>'
        : '<div class="flex items-center justify-between p-4 pb-2 flex-shrink-0 gap-3">' +
              '<div class="flex items-center gap-2 min-w-0"><h1 class="text-2xl font-bold text-theme-primary whitespace-nowrap">联系人</h1>' + countBadge + '</div>' +
              buttons +
          '</div>';

    container.innerHTML =
        '<div class="h-full flex flex-col relative">' +
            header +
            '<div id="people-page-scroll" class="flex-1 overflow-y-auto min-h-0 px-4 pb-6">' +
                (peopleSearchVisible
                    ? '<div class="my-3 relative">' +
                          '<input id="people-search-input" type="text" value="' + escapeHtml(peopleSearchQuery) + '" ' +
                              'placeholder="搜索姓名 / 别名 / 拼音首字母 / 电话 / 邮箱 / 备注…" autocomplete="off" spellcheck="false" ' +
                              'oninput="onPeopleSearchInput(this.value);_syncSearchClearBtn(this)" ' +
                              'class="w-full px-3 py-2 pr-9 border-2 border-theme rounded-lg bg-theme-secondary text-theme-primary text-sm focus:outline-none focus:border-accent">' +
                          searchClearBtnHtml('people-search-input') +
                      '</div>'
                    : '') +
                '<div id="people-list"></div>' +
            '</div>' +
            renderPeopleBatchBar() +
            renderPeopleHelpPanel() +
            renderPeopleInitialIndex() +
        '</div>';
    renderPeopleList();
    // 悬浮编辑卡随滚动/尺寸变化重新收敛到可视区（见 _peopleFitForm）
    const peopleScroller = document.getElementById('people-page-scroll');
    if (peopleScroller) peopleScroller.addEventListener('scroll', _peopleScheduleFit, { passive: true });
    if (peopleSearchVisible) {
        _syncSearchClearBtn(document.getElementById('people-search-input'));
        setTimeout(function () {
            const input = document.getElementById('people-search-input');
            if (input) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        }, 30);
    }
}

// 页底「联系人使用说明」：固定在视口底部，默认收起只显示标题，点击标题展开
let peopleHelpExpanded = false;

function togglePeopleHelp() {
    peopleHelpExpanded = !peopleHelpExpanded;
    const card = document.querySelector('.person-help-card');
    if (!card) return;
    card.classList.toggle('is-open', peopleHelpExpanded);
    const list = card.querySelector('.person-help-list');
    if (list) list.classList.toggle('hidden', !peopleHelpExpanded);
    // 头部两个可点区域（标题 / 箭头）同为 .person-help-toggle，aria 状态一并同步
    card.querySelectorAll('.person-help-toggle').forEach(function (btn) {
        btn.setAttribute('aria-expanded', peopleHelpExpanded ? 'true' : 'false');
    });
}

function renderPeopleHelpPanel() {
    // 「不再显示」后整体隐藏；重开入口：联系人配置面板底部的「使用说明」按钮
    if (settings.peopleHelpHidden) return '';
    const lines = [
        '联系人用于在任务正文中 @ 提及对方，并据此聚合、筛选与该联系人相关的任务。',
        '姓名、别名与默认全拼都可用于提及，使用其中任一名称都会指向同一联系人。',
        '点击正文中的 @姓名 可查看该联系人的资料与相关任务、标记「等待」或新建关联任务。',
        '改名、增删别名或合并联系人后，正文中已有的提及会自动改写，指向关系不变；合并不可撤销。',
        '标记「等待」后正文提及显示沙漏，侧边栏过滤器顶部的「我在等谁」可筛选全部等待中的任务。',
        '填写生日后，单击生日后的蛋糕图标即可创建按年重复的生日倒计时，卡片显示剩余天数。',
        '归档的联系人仅供查看，不参与 @ 候选、等待标记与新建任务。',
        '自定义分组下长按卡片可拖拽换组，短按仍保留点击操作。'
    ];
    return '<div class="person-help-footer">' +
        '<div class="person-help-card' + (peopleHelpExpanded ? ' is-open' : '') + '">' +
            // 头部一行：标题（点击展开/收起）+ 右侧并排的「不再显示」与箭头（两个按钮同位置同款式）
            '<div class="person-help-head">' +
                '<button type="button" class="person-help-toggle" onclick="togglePeopleHelp()" aria-expanded="' + (peopleHelpExpanded ? 'true' : 'false') + '">' +
                    '<span class="person-help-title">联系人使用说明</span>' +
                '</button>' +
                '<button type="button" class="person-help-hide" onclick="hidePeopleHelp()" ' +
                    'title="不再显示此提示条（可在联系人配置底部重新打开）">不再显示</button>' +
                '<button type="button" class="person-help-toggle person-help-chevron-btn" onclick="togglePeopleHelp()" aria-expanded="' + (peopleHelpExpanded ? 'true' : 'false') + '">' +
                    '<i class="fas fa-chevron-up person-help-chevron"></i>' +
                '</button>' +
            '</div>' +
            '<ul class="person-help-list' + (peopleHelpExpanded ? '' : ' hidden') + '">' +
                lines.map(function (t) { return '<li>' + t + '</li>'; }).join('') +
            '</ul>' +
        '</div>' +
    '</div>';
}

// 隐藏页底使用说明条（持久化，配置面板底部「使用说明」可重新打开）
function hidePeopleHelp() {
    settings.peopleHelpHidden = true;
    saveData();
    renderView();
}

// 联系人配置面板底部入口：重新显示使用说明条
function showPeopleHelpFromConfig() {
    if (!settings.peopleHelpHidden) return;
    settings.peopleHelpHidden = false;
    saveData();
    renderView();
}

// 「按首字母」分组模式：右侧竖向 A-Z# 字母索引条（仿手机通讯录）。
// 容器常驻（renderPeopleView 挂载），内容由 renderPeopleList 按当前分组依据填充；
// 非按首字母模式 / 搜索平铺态隐藏。
function renderPeopleInitialIndex() {
    return '<div id="people-initial-index" class="hidden" aria-hidden="true"></div>';
}

function _updatePeopleInitialIndex(visibleLetters) {
    const bar = document.getElementById('people-initial-index');
    if (!bar) return;
    if (!visibleLetters || !visibleLetters.size) {
        bar.classList.add('hidden');
        bar.innerHTML = '';
        return;
    }
    bar.innerHTML = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map(function (L) {
        const has = visibleLetters.has(L);
        return '<div class="people-index-letter' + (has ? ' has' : '') + '"' +
            (has ? ' onclick="jumpPeopleInitial(\'' + L + '\')" title="跳转到 ' + L + '"' : '') + '>' + L + '</div>';
    }).join('');
    bar.classList.remove('hidden');
}

function jumpPeopleInitial(letter) {
    const el = document.getElementById('pc-sec-initial:' + letter);
    if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
}

// 标题栏「+」：自定义模式且已有分组时弹选组气泡；自动依据下直接新建（创建后按依据自动归位）
function onPeoplePlusClick(btn) {
    const mode = (typeof getPeopleGroupMode === 'function') ? getPeopleGroupMode() : 'custom';
    if (mode === 'custom' && typeof openGroupPick === 'function' && getGroupDefs('people').length) {
        openGroupPick('people', btn);
    } else {
        startAddPerson('');
    }
}

function togglePeopleSearch() {
    peopleSearchVisible = !peopleSearchVisible;
    if (!peopleSearchVisible) peopleSearchQuery = '';
    renderView();
}

function onPeopleSearchInput(value) {
    peopleSearchQuery = String(value == null ? '' : value);
    renderPeopleList();
}

function _personMatchesSearch(p, q) {
    if (!q) return true;
    const ql = q.trim().toLowerCase();
    if (!ql) return true;
    const names = getPersonAllNames(p);
    if (names.some(function (n) {
        return n.toLowerCase().indexOf(ql) !== -1 || getPinyinInitialsForName(n).indexOf(ql) !== -1;
    })) return true;
    if (String(p.email || '').toLowerCase().indexOf(ql) !== -1) return true;
    if (String(p.deviceAccount || '').toLowerCase().indexOf(ql) !== -1) return true;
    if (String(p.jobTitle || '').toLowerCase().indexOf(ql) !== -1) return true;
    if (String(p.company || '').toLowerCase().indexOf(ql) !== -1) return true;
    if (String(p.staffNo || '').toLowerCase().indexOf(ql) !== -1) return true;
    if ((Array.isArray(p.phones) ? p.phones : []).some(function (v) { return String(v || '').toLowerCase().indexOf(ql) !== -1; })) return true;
    if (String(p.note || '').toLowerCase().indexOf(ql) !== -1) return true;
    return (Array.isArray(p.customFields) ? p.customFields : []).some(function (f) {
        return f && (String(f.label || '').toLowerCase().indexOf(ql) !== -1
            || String(f.value || '').toLowerCase().indexOf(ql) !== -1);
    });
}

// 渲染单段联系人卡片（卡片 + 新建表单/新增占位）。
// addGroupId 传入时，虚线「+」卡片直接新建到该组（不再弹选组气泡）；未传入（搜索态平铺）沿用标题栏选组入口。
// 新建表单占据「+」卡片位置（网格末尾），保证原地生成、不跳位。
// showAddCard=false（自动分组依据）：段尾不加「+」、段内不落新建表单——表单统一置顶独立渲染。
function _renderPeopleCards(list, editing, q, addGroupId, showAddCard) {
    if (showAddCard === undefined) showAddCard = true;
    let html = '';
    list.forEach(function (p) {
        html += (editing && editing.id === p.id) ? renderPersonForm(p) : renderPersonCard(p);
    });
    if (!showAddCard) return html;
    if (editing && editing.id === null) {
        html += renderPersonForm(null);
    } else {
        const addCall = (addGroupId !== undefined)
            ? 'startAddPerson(\'' + addGroupId + '\')'
            : 'onPeoplePlusClick(this)';
        html += '<div class="person-add-card flex items-center justify-center p-3 rounded-xl border border-dashed border-theme cursor-pointer hover:bg-theme-tertiary transition" onclick="' + addCall + '" title="新增联系人">' +
            '<i class="fas fa-plus text-xl text-theme-secondary"></i></div>';
    }
    return html;
}

// 悬浮编辑卡的可视区适配：优先按内容自然高度完整展示，再整体收敛进滚动区可视范围——
// 锚点居中时原地浮起；锚点贴近/滚出下沿时表单上移（允许负 top，浮在锚点上方），
// 锚点滚出上沿时贴顶停留；高度不足才内部滚动，保证保存/取消始终完整可达
let _peopleFitRAF = null;
function _peopleFitForm() {
    const form = document.getElementById('people-edit-form');
    const scroller = document.getElementById('people-page-scroll');
    if (!form || !scroller || !form.parentElement) return;
    // 自动依据下新建表单置顶、走普通流内布局：清掉可能残留的悬浮 inline 定位后直接返回
    if (form.closest('.people-top-form-wrap')) {
        form.style.top = '';
        form.style.maxHeight = '';
        return;
    }
    const sr = scroller.getBoundingClientRect();
    // 移动端底部导航为 fixed 悬浮，会盖住滚动区下沿：可视下界取其顶边
    let visibleBottom = sr.bottom;
    const nav = document.getElementById('mobile-bottom-nav');
    if (nav && getComputedStyle(nav).display !== 'none') {
        const nr = nav.getBoundingClientRect();
        if (nr.top < visibleBottom && nr.bottom > sr.top) visibleBottom = nr.top;
    }
    const room = Math.floor(visibleBottom - sr.top - 8);
    if (room < 120) return;
    const wr = form.parentElement.getBoundingClientRect();
    // max-height 约束 border-box，scrollHeight 不含边框：补上边框厚，避免 2~3px 的假性内滚动
    const borderY = form.offsetHeight - form.clientHeight;
    const h = Math.max(120, Math.min(form.scrollHeight + borderY, room));
    const minAbs = sr.top + 4;
    const maxAbs = Math.max(minAbs, visibleBottom - h - 4);
    const absTop = Math.min(Math.max(wr.top, minAbs), maxAbs);
    form.style.top = Math.round(absTop - wr.top) + 'px';
    form.style.maxHeight = h + 'px';
}

function _peopleScheduleFit() {
    if (_peopleFitRAF) return;
    _peopleFitRAF = requestAnimationFrame(function () { _peopleFitRAF = null; _peopleFitForm(); });
    // 兜底：后台/无头等不产帧环境 rAF 可能不触发，32ms 后强制复量，保证收敛不饿死
    setTimeout(function () {
        if (_peopleFitRAF) { cancelAnimationFrame(_peopleFitRAF); _peopleFitRAF = null; _peopleFitForm(); }
    }, 32);
}

// 渲染后延迟复量：兜底 webfont / 图标字体 / 头像 / CDN 样式等异步落定带来的高度变化（两段式）
let _peopleSettleTimer = null;
function _peopleSettleFit() {
    if (_peopleSettleTimer) clearTimeout(_peopleSettleTimer);
    _peopleSettleTimer = setTimeout(function () {
        _peopleScheduleFit();
        _peopleSettleTimer = setTimeout(function () { _peopleSettleTimer = null; _peopleScheduleFit(); }, 640);
    }, 260);
}

// 表单尺寸/外部样式变化的持续监听：ResizeObserver 捕捉表单自身增高（如备注 textarea 拖大）；
// 200ms 一致性巡检兜底一切异步样式落定（Tailwind CDN 走 CSSOM 注入，MutationObserver 看不到）：
// 发现「内容溢出被裁」或「高度富余」即复量收敛；每次重渲染重新挂载、无表单时卸载
let _peopleFormRO = null, _peopleHeadMO = null, _peopleFitPoll = null;
function _peopleWatchForm() {
    const form = document.getElementById('people-edit-form');
    if (_peopleFormRO) { _peopleFormRO.disconnect(); _peopleFormRO = null; }
    if (_peopleHeadMO) { _peopleHeadMO.disconnect(); _peopleHeadMO = null; }
    if (_peopleFitPoll) { clearInterval(_peopleFitPoll); _peopleFitPoll = null; }
    if (!form) return;
    if (typeof ResizeObserver !== 'undefined') {
        _peopleFormRO = new ResizeObserver(function () { _peopleScheduleFit(); });
        _peopleFormRO.observe(form);
    }
    if (typeof MutationObserver !== 'undefined') {
        _peopleHeadMO = new MutationObserver(function () {
            // 表单已不在（离开联系人页/结束编辑）：自行卸载，避免空转
            if (!document.getElementById('people-edit-form')) { _peopleWatchForm(); return; }
            _peopleScheduleFit();
        });
        _peopleHeadMO.observe(document.head, { childList: true, subtree: true, characterData: true });
    }
    _peopleFitPoll = setInterval(function () {
        const f = document.getElementById('people-edit-form');
        if (!f) { _peopleWatchForm(); return; }
        const borderY = f.offsetHeight - f.clientHeight;
        const natural = f.scrollHeight + borderY;
        if (f.scrollHeight > f.clientHeight || f.clientHeight - natural > 4) _peopleScheduleFit();
    }, 200);
}

function renderPeopleList() {
    const wrap = document.getElementById('people-list');
    if (!wrap) return;
    const all = (settings.people || []);
    const countEl = document.getElementById('people-page-count');
    if (countEl) {
        countEl.textContent = String(all.length);
        countEl.classList.toggle('hidden', !all.length);
    }
    const q = peopleSearchQuery;
    const active = all.filter(function (p) { return !p.archived && _personMatchesSearch(p, q); });
    const archived = all.filter(function (p) { return p.archived && _personMatchesSearch(p, q); });
    active.sort(function (a, b) { return comparePersonNamesByPinyin(a.name, b.name); });
    archived.sort(function (a, b) { return comparePersonNamesByPinyin(a.name, b.name); });
    // 已归档默认收起；正在编辑归档联系人时强制展开
    const archivedExpanded = !peopleArchivedCollapsed || !!(peopleEditing && peopleEditing.id
        && archived.some(function (p) { return p.id === peopleEditing.id; }));

    // 搜索态：跨组平铺（沿用原有布局，不分组）
    if (q) {
        let html = '<div class="people-grid mt-3">';
        if (!active.length && !archived.length) {
            html += '<div class="person-grid-span text-center text-theme-muted py-12 text-sm">没有匹配「' + escapeHtml(q) + '」的联系人</div>';
        }
        html += _renderPeopleCards(active, peopleEditing, q);
        if (archived.length) {
            html += '<div class="person-grid-span mt-4 mb-1 text-xs text-theme-muted flex items-center gap-2 cursor-pointer select-none" onclick="togglePeopleArchivedCollapse()" title="展开/收起已归档">' +
                '<i class="fas fa-chevron-' + (archivedExpanded ? 'down' : 'right') + ' text-[10px] w-3 flex-shrink-0"></i>' +
                '<i class="fas fa-box-archive"></i>已归档（' + archived.length + '）</div>';
            if (archivedExpanded) {
                archived.forEach(function (p) {
                    html += (peopleEditing && peopleEditing.id === p.id) ? renderPersonForm(p) : renderPersonCard(p);
                });
            }
        }
        html += '</div>';
        wrap.innerHTML = html;
        _peopleWatchForm();
        _updatePeopleInitialIndex(null);   // 搜索平铺态无分组段，隐藏索引条
        if (peopleEditing) {
            _peopleFitForm();
            _peopleSettleFit();
            const nameInput = document.getElementById('people-form-name');
            if (nameInput) { nameInput.focus(); nameInput.select(); }
        }
        return;
    }

    // 非搜索态：按分组分段，默认/兜底段恒置底；已归档始终独立段置底
    const groupMode = (typeof getPeopleGroupMode === 'function') ? getPeopleGroupMode() : 'custom';
    const sections = groupItems('people', active, groupMode);
    const isAutoMode = groupMode !== 'custom';
    // 自动依据（首字母/添加时间/最近使用）：新建表单不在段内/段尾渲染，统一置顶（见下方 topFormHtml）。
    // 旧的「按空记录落桶键找段」逻辑已废弃：空姓名落 '#'/'unknown'/'never' 桶会与已有卡片重叠，且空名单
    // 对应的段往往不存在（首字母只渲染非空字母段），还要靠末尾兜底，位置不可预期。
    let topFormHtml = '';
    if (isAutoMode && peopleEditing && peopleEditing.id === null) {
        topFormHtml = '<div class="people-top-form-wrap">' + renderPersonForm(null) + '</div>';
    }
    const editingInGroup = peopleEditing && peopleEditing.id !== null
        ? (settings.people || []).find(function (p) { return p && p.id === peopleEditing.id; })
        : null;
    const editingGid = editingInGroup
        ? (typeof normalizeGroupId === 'function' ? normalizeGroupId('people', editingInGroup.groupId) : (editingInGroup.groupId || ''))
        : null;
    let html = '';
    if (!all.length && !peopleEditing) {
        html += '<div class="bg-theme-secondary rounded-xl shadow-theme p-8 text-center text-theme-muted mt-3">' +
            '<i class="fas fa-user-plus text-3xl mb-3 block"></i>' +
            '<p class="text-sm text-theme-primary">联系人还是空的</p>' +
            '<p class="text-xs mt-1">点击右上角「+」添加，或在任务详情中输入 @ 快速创建。</p>' +
            '</div>';
    } else {
        // 置顶新建表单：自动依据下独占列表顶部一整块，不与任何分组卡片重叠
        if (topFormHtml) html += topFormHtml;
        sections.forEach(function (sec) {
            const isAuto = groupMode !== 'custom';
            // 新建表单：仅自定义模式显示在选中组段；自动依据下表单已置顶，不再落段
            let isNewHere = false;
            if (!isAuto && peopleEditing && peopleEditing.id === null) {
                const pendingGid = typeof normalizeGroupId === 'function'
                    ? normalizeGroupId('people', _peoplePendingGroupId || '') : (_peoplePendingGroupId || '');
                isNewHere = sec.id === pendingGid;
            }
            let secHtml = '';
            // 待建表单所在段强制展开，避免新建后看不到表单
            const collapsed = !!sec.collapsed && !isNewHere;
            const toggleCall = isAuto
                ? 'toggleAutoGroupCollapse(\'' + sec.id + '\')'
                : 'togglePeopleGroupCollapse(\'' + sec.id + '\')';
            const nameSpan = (!isAuto && !sec.isDefault)
                ? '<span class="text-sm font-semibold text-theme-primary truncate" onclick="event.stopPropagation()" ondblclick="event.stopPropagation();startPeopleGroupRename(\'' + sec.id + '\',this)" title="双击重命名分组">' + escapeHtml(sec.name) + '</span>'
                : '<span class="text-sm font-semibold text-theme-primary truncate">' + escapeHtml(sec.name) + '</span>';
            const head = '<div id="pc-sec-' + sec.id + '" class="flex items-center justify-between px-1 py-2 mt-2' + (sec.isDefault ? '' : ' cursor-pointer group') + '" ' +
                    (sec.isDefault ? '' : 'onclick="' + toggleCall + '" title="展开/收起分组"') + '>' +
                '<div class="flex items-center gap-2 min-w-0">' +
                    (sec.isDefault ? '' : '<i class="fas fa-chevron-' + (collapsed ? 'right' : 'down') + ' text-xs text-theme-muted w-3 flex-shrink-0"></i>') +
                    nameSpan +
                    '<span class="text-xs text-theme-muted flex-shrink-0">' + sec.items.length + '</span>' +
                '</div>' +
                (sec.isDefault || isAuto ? '' :
                    '<button type="button" onclick="event.stopPropagation();startAddPerson(\'' + sec.id + '\')" class="w-7 h-7 rounded-lg flex items-center justify-center text-theme-muted hover:bg-theme-tertiary hover:text-accent flex-shrink-0" title="新建到此分组"><i class="fas fa-plus text-xs"></i></button>') +
            '</div>';
            secHtml += head;
            if (!collapsed) {
                const hasEditingHere = !isAuto && peopleEditing && peopleEditing.id !== null && editingGid === sec.id;
                const items = sec.items.slice();
                if (hasEditingHere && !items.some(function (p) { return p.id === peopleEditing.id; })) {
                    // 编辑中的条目若归属被改到别的组，保持在原展示组不丢失（仅自定义模式）
                    items.push(editingInGroup);
                }
                // 空分组只显示标题；新建表单所在段即使无卡片也渲染（表单占据「+」位）
                let cardsEditing = null;
                if (isNewHere) cardsEditing = { id: null };
                else if (peopleEditing && peopleEditing.id !== null) cardsEditing = peopleEditing;
                if (items.length || isNewHere) {
                    // 自动依据：段尾不加「+」卡片（新增统一从右上角「+」或置顶表单进入）
                    secHtml += '<div class="people-grid">' + _renderPeopleCards(items, cardsEditing, q, isAuto ? '' : sec.id, !isAuto) + '</div>';
                }
            }
            // 自定义模式：整段作为长按拖拽的放置目标（指针事件检测，见 _pc* 模块）
            html += isAuto
                ? secHtml
                : '<div class="people-group-section" data-gid="' + sec.id + '">' + secHtml + '</div>';
        });
        if (archived.length) {
            html += '<div class="flex items-center gap-2 mt-4 mb-1 text-xs text-theme-muted cursor-pointer select-none" onclick="togglePeopleArchivedCollapse()" title="展开/收起已归档">' +
                '<i class="fas fa-chevron-' + (archivedExpanded ? 'down' : 'right') + ' text-[10px] w-3 flex-shrink-0"></i>' +
                '<i class="fas fa-box-archive"></i>已归档（' + archived.length + '）</div>';
            if (archivedExpanded) {
                html += '<div class="people-grid">' + archived.map(function (p) {
                    return (peopleEditing && peopleEditing.id === p.id) ? renderPersonForm(p) : renderPersonCard(p);
                }).join('') + '</div>';
            }
        }
    }
    wrap.innerHTML = html;
    _peopleWatchForm();
    // 按首字母模式：按当前非空分组字母刷新右侧索引条；其他模式隐藏
    if (!q && groupMode === 'initial') {
        const letters = new Set(sections.map(function (s) { return s.id.slice('initial:'.length); }));
        _updatePeopleInitialIndex(letters);
    } else {
        _updatePeopleInitialIndex(null);
    }
    // 自定义分组非搜索态：段内卡片长按拖拽换组（归档段在段外，天然不可拖）；短按保留单击
    if (!q && groupMode === 'custom') {
        _pcBindDragEvents();
        wrap.querySelectorAll('.people-group-section .person-card-item[data-pid]').forEach(function (card) {
            card.addEventListener('pointerdown', function (e) { peopleCardPointerDown(e, card.dataset.pid); });
        });
    }
    if (peopleEditing) {
        _peopleFitForm();
        _peopleSettleFit();
        const nameInput = document.getElementById('people-form-name');
        if (nameInput) { nameInput.focus(); nameInput.select(); }
    }
    renderPeopleSidebar();
}

/* ---- 卡片长按拖拽换组（自定义分组、非搜索态；与子任务/分组配置同一套指针事件范式） ----
   长按 300ms 激活拖拽，短按保留单击（信息项复制 / 各按钮）；判定期位移超 6px 视为点选/划选立即取消；
   触摸端不启用（保留编辑表单「分组」下拉兜底）。落点为分组段，高亮复用 .people-drop-over。
   不用原生 HTML5 DnD：常 draggable 会让整卡变 grab 光标并吞掉单击/选词，与子任务改造原因一致。 */
const PEOPLE_HOLD_MS = 300;
const PEOPLE_HOLD_TOLERANCE = 6;
const PEOPLE_HOLD_HINT_DELAY_MS = 150;
if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--people-hold-anim-ms', (PEOPLE_HOLD_MS - PEOPLE_HOLD_HINT_DELAY_MS) + 'ms');
}
let _pcHoldTimer = null, _pcHintTimer = null, _pcHoldCard = null, _pcHoldPointerId = null, _pcStartX = 0, _pcStartY = 0;
let _pcDragActive = false, _pcDragPointerId = null, _pcDragCard = null, _pcDragPid = null, _pcDragFromGid = null;
let _pcRects = [], _pcTargetGid = null, _pcRAF = null, _pcActiveSec = null, _pcDragBound = false;

function _pcCancelHold() {
    if (_pcHoldTimer) { clearTimeout(_pcHoldTimer); _pcHoldTimer = null; }
    if (_pcHintTimer) { clearTimeout(_pcHintTimer); _pcHintTimer = null; }
    if (_pcHoldCard) { _pcHoldCard.classList.remove('person-holding'); _pcHoldCard = null; }
    _pcHoldPointerId = null;
}

function _pcClearHighlight() {
    if (_pcRAF) { cancelAnimationFrame(_pcRAF); _pcRAF = null; }
    if (_pcActiveSec) { _pcActiveSec.classList.remove('people-drop-over'); _pcActiveSec = null; }
}

function _pcScheduleHighlight(sec) {
    if (_pcRAF) return;
    _pcRAF = requestAnimationFrame(function () {
        _pcRAF = null;
        if (_pcActiveSec === sec) return;
        if (_pcActiveSec) _pcActiveSec.classList.remove('people-drop-over');
        _pcActiveSec = sec;
        if (sec) sec.classList.add('people-drop-over');
    });
}

// 按下：仅起长按计时，不立即拖拽；按钮/输入/链接不参与（保留单击）。
// 触摸端同样启用长按拖拽：判定期不阻断滚动（移动超容差或系统滚动手势触发 pointercancel 即取消），
// 激活后靠 body.people-dragging 的 touch-action:none 接管手势，避免与页面滚动冲突。
function peopleCardPointerDown(e, pid) {
    if (peopleBatchMode) return; // 批量态整卡单击选中，不拖拽
    if (e.button !== undefined && e.button !== 0 && e.pointerType !== 'touch') return;
    if (e.target.closest && e.target.closest('button, input, select, textarea, a')) return;
    const card = e.currentTarget;
    _pcCancelHold();
    _pcHoldCard = card;
    _pcHoldPointerId = e.pointerId;
    _pcStartX = e.clientX;
    _pcStartY = e.clientY;
    _pcHintTimer = setTimeout(function () {
        _pcHintTimer = null;
        if (_pcHoldCard === card) card.classList.add('person-holding');
    }, PEOPLE_HOLD_HINT_DELAY_MS);
    _pcHoldTimer = setTimeout(function () {
        _pcHoldTimer = null;
        _pcStartDrag(card, pid);
    }, PEOPLE_HOLD_MS);
}

function _pcStartDrag(card, pid) {
    if (_pcHintTimer) { clearTimeout(_pcHintTimer); _pcHintTimer = null; }
    card.classList.remove('person-holding');
    _pcHoldCard = null;
    _pcDragActive = true;
    _pcDragPointerId = _pcHoldPointerId;
    _pcHoldPointerId = null;
    _pcDragCard = card;
    _pcDragPid = pid;
    const person = getPersonById(pid);
    _pcDragFromGid = person ? normalizeGroupId('people', person.groupId) : '';
    _pcTargetGid = null;
    card.classList.add('person-drag-ready');
    document.body.classList.add('people-dragging');
    try { if (_pcDragPointerId !== null) card.setPointerCapture(_pcDragPointerId); } catch (_) {}
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
    _pcRects = [];
    document.querySelectorAll('.people-group-section[data-gid]').forEach(function (sec) {
        const r = sec.getBoundingClientRect();
        _pcRects.push({ sec: sec, gid: sec.getAttribute('data-gid'), top: r.top, bottom: r.bottom });
    });
}

function _pcCleanupDrag() {
    _pcCancelHold();
    _pcClearHighlight();
    if (_pcDragCard) {
        _pcDragCard.classList.remove('person-drag-ready');
        try {
            if (_pcDragPointerId !== null && _pcDragCard.hasPointerCapture(_pcDragPointerId)) {
                _pcDragCard.releasePointerCapture(_pcDragPointerId);
            }
        } catch (_) {}
    }
    document.body.classList.remove('people-dragging');
    _pcDragActive = false;
    _pcDragPointerId = null;
    _pcDragCard = null;
    _pcDragPid = null;
    _pcDragFromGid = null;
    _pcRects = [];
    _pcTargetGid = null;
}

function _pcOnMove(e) {
    if (!_pcDragActive) {
        if (_pcHoldCard && e.pointerId === _pcHoldPointerId) {
            const dx = e.clientX - _pcStartX, dy = e.clientY - _pcStartY;
            if (dx * dx + dy * dy > PEOPLE_HOLD_TOLERANCE * PEOPLE_HOLD_TOLERANCE) _pcCancelHold();
        }
        return;
    }
    if (e.pointerId !== _pcDragPointerId) return;
    if (!(e.buttons & 1)) { _pcCleanupDrag(); return; }
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
    const y = e.clientY;
    let hit = null;
    for (let i = 0; i < _pcRects.length; i++) {
        const r = _pcRects[i];
        if (r.gid === _pcDragFromGid) continue; // 本组不构成换组落点
        if (y >= r.top && y <= r.bottom) { hit = r; break; }
    }
    _pcTargetGid = hit ? hit.gid : null;
    _pcScheduleHighlight(hit ? hit.sec : null);
}

function _pcOnUp(e) {
    if (!_pcDragActive) {
        if (_pcHoldCard && e.pointerId === _pcHoldPointerId) _pcCancelHold();
        return;
    }
    if (e.pointerId !== _pcDragPointerId) return;
    const pid = _pcDragPid, gid = _pcTargetGid;
    _pcCleanupDrag();
    if (pid && gid !== null) _applyPersonGroupChange(pid, gid);
}

function _pcBindDragEvents() {
    if (_pcDragBound) return;
    _pcDragBound = true;
    document.addEventListener('pointermove', _pcOnMove, { passive: true });
    document.addEventListener('pointerup', _pcOnUp);
    document.addEventListener('pointercancel', function () { if (_pcDragActive) _pcCleanupDrag(); else _pcCancelHold(); });
    document.addEventListener('wheel', function () { if (_pcDragActive) _pcCleanupDrag(); }, { passive: true });
    // 触摸长按会唤起系统菜单/划选：按住或拖拽期间屏蔽 contextmenu
    document.addEventListener('contextmenu', function (e) { if (_pcHoldCard || _pcDragActive) e.preventDefault(); });
}

// 换组落盘（拖拽完成调用）：目标组若收起则展开，让结果立即可见
function _applyPersonGroupChange(pid, gid) {
    const person = (settings.people || []).find(function (p) { return p && p.id === pid; });
    if (!person || person.archived) return;
    const target = normalizeGroupId('people', gid || '');
    if (normalizeGroupId('people', person.groupId) === target) return;
    person.groupId = target;
    person.updatedAt = Date.now();
    const g = target ? getGroupDefs('people').find(function (x) { return x && x.id === target; }) : null;
    if (g && g.collapsed) g.collapsed = false;
    saveData();
    renderPeopleList();
    if (typeof refreshGroupManagerUi === 'function') refreshGroupManagerUi();
}

function togglePeopleGroupCollapse(groupId) {
    const g = getGroupDefs('people').find(function (x) { return x && x.id === groupId; });
    if (!g) return;
    g.collapsed = !g.collapsed;
    saveData();
    renderPeopleList();
}

// 双击分组标题就地改名（自定义分组）：Enter/失焦提交，Esc 取消；复用 groups.js renameGroup 校验
function startPeopleGroupRename(groupId, spanEl) {
    if (!spanEl || spanEl.querySelector('input')) return;
    const g = getGroupDefs('people').find(function (x) { return x && x.id === groupId; });
    if (!g) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = g.name || '';
    input.maxLength = 20;
    input.className = 'text-sm font-semibold text-theme-primary bg-theme-tertiary border border-theme rounded px-1 py-0.5 min-w-0 flex-1 focus:outline-none focus:border-accent';
    input.onclick = function (e) { e.stopPropagation(); };
    input.ondblclick = function (e) { e.stopPropagation(); };
    let done = false;
    const commit = function () {
        if (done) return;
        done = true;
        renameGroup('people', groupId, input.value);
    };
    const cancel = function () {
        if (done) return;
        done = true;
        renderPeopleList();
    };
    input.onkeydown = function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
    input.onblur = commit;
    spanEl.replaceWith(input);
    input.focus();
    input.select();
}

// 已归档段默认收起，点击标题展开/收起（编辑归档联系人时强制展开）
let peopleArchivedCollapsed = true;
function togglePeopleArchivedCollapse() {
    peopleArchivedCollapsed = !peopleArchivedCollapsed;
    renderPeopleList();
}

/* ---- 卡片信息行：@ 可提及名 + 表格式「项目 / 内容」行（管理页卡片与浮层卡片共用） ---- */

// 正文里能命中的全部写法：姓名 + 别名 + 全拼，统一带 @ 前缀显示。
// 非编辑态隐藏「原名」与「默认全拼」（二者默认可用，无需罗列）；仅展示其余别名，
// 含重名加后缀的全拼（如 @zhangsan2）。编辑态由表单完整展示姓名与全部别名。
// withHint=false：不带"正文输入以下任一 @名字……"操作提示 hover（悬浮卡片用；管理页卡片默认保留）
function _personMentionLineHtml(person, withHint) {
    const names = getPersonAllNames(person);
    if (!names.length) return '';
    const nameKey = normalizePersonName(person.name);
    const basePy = (typeof getPersonFullPinyin === 'function') ? getPersonFullPinyin(person.name) : '';
    const visible = names.filter(function (n) {
        const k = normalizePersonName(n);
        if (k === nameKey) return false;
        if (basePy && k === basePy) return false;
        return true;
    });
    if (!visible.length) return '';
    return '<div class="person-mention-line"' + (withHint === false ? '' :
        ' title="正文输入以下任一 @名字 都能提及该联系人（姓名与默认全拼始终可用）"') + '>' +
        visible.map(function (n) { return '<span>@' + escapeHtml(n) + '</span>'; }).join('') +
    '</div>';
}

// 自定义信息项的值类型：决定是否渲染成 mailto / tel / 外链
function _personFieldKind(label, value) {
    const v = String(value || '');
    if (/^https?:\/\//i.test(v)) return 'url';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
    if (/(电话|手机|座机|热线|tel|phone|mobile)/i.test(String(label || ''))) return 'tel';
    return 'text';
}

// 有序信息行：邮箱 → 电话 → 职位 → 公司 → 工号 → 生日 → 自定义项 → 备注（空值不占行）
function _personInfoEntries(person) {
    const out = [];
    if (person.email) out.push({ key: 'email', label: '邮箱', value: person.email, kind: 'email' });
    (Array.isArray(person.phones) ? person.phones : []).forEach(function (v, i) {
        const phone = String(v || '').trim();
        if (!phone) return;
        out.push({ key: 'phone:' + i, label: '电话号码', value: phone, kind: 'tel' });
    });
    if (person.jobTitle) out.push({ key: 'jobTitle', label: '职位', value: person.jobTitle, kind: 'text' });
    if (person.company) out.push({ key: 'company', label: '所属公司', value: person.company, kind: 'text' });
    if (person.staffNo) out.push({ key: 'staffNo', label: '工号', value: person.staffNo, kind: 'text' });
    // 生日：有专门适配 —— 单击标签创建/查看生日倒计时（原卡片上的蛋糕按钮已并入此行）
    if (person.birthday) out.push({ key: 'birthday', label: '生日', value: person.birthday, kind: 'birthday' });
    // 设备账号已下线，仅兼容未迁移干净的存量数据（加载时会转成自定义信息项）
    if (person.deviceAccount) out.push({ key: 'deviceAccount', label: '设备账号', value: person.deviceAccount, kind: 'text' });
    const custom = Array.isArray(person.customFields) ? person.customFields : [];
    custom.forEach(function (f, i) {
        if (!f) return;
        const label = String(f.label || '').trim();
        const value = String(f.value || '').trim();
        if (!label || !value) return;
        out.push({ key: 'cf:' + i, label: label, value: value, kind: _personFieldKind(label, value) });
    });
    if (person.note) out.push({ key: 'note', label: '备注', value: person.note, kind: 'note' });
    return out;
}

// mode='card'：卡片内紧凑单行（超长截断）；mode='popover'：浮层内可换行、标题可点击复制
function _personInfoRowsHtml(person, mode) {
    const entries = _personInfoEntries(person);
    if (!entries.length) return '';
    const popover = mode === 'popover';
    return '<div class="person-info-grid' + (popover ? ' person-info-grid-popover' : '') + '">' +
        entries.map(function (e) {
            const label = escapeHtml(e.label);
            // 项目名本身即复制入口（管理页卡片与浮层一致）：短按单击复制，悬停下划线提示可点；
            // 长按拖拽由卡片指针事件负责，按钮不参与长按，故二者不冲突
            const labelHtml = '<button type="button" class="person-info-label person-info-label-btn" onclick="copyPersonField(\'' + escapeHtml(person.id) + '\',\'' + e.key + '\')" title="点击复制' + label + '">' + label + '</button>';
            let valueHtml;
            // 邮箱/电话/外链在管理页卡片与浮层都可点击（mailto / tel / 新窗口），短按即达
            if (e.kind === 'email') {
                valueHtml = '<a href="mailto:' + escapeHtml(e.value) + '" class="person-info-value person-info-link">' + escapeHtml(e.value) + '</a>';
            } else if (e.kind === 'tel') {
                valueHtml = '<a href="tel:' + escapeHtml(e.value.replace(/[^\d+]/g, '')) + '" class="person-info-value person-info-link">' + escapeHtml(e.value) + '</a>';
            } else if (e.kind === 'url') {
                valueHtml = '<a href="' + escapeHtml(e.value) + '" target="_blank" rel="noopener noreferrer" class="person-info-value person-info-link">' + escapeHtml(e.value) + '</a>';
            } else {
                valueHtml = '<span class="person-info-value' + (e.kind === 'note' ? ' person-info-note' : '') + '" title="' + escapeHtml(e.value) + '">' + escapeHtml(e.value) + '</span>';
            }
            // 生日行：日期后附蛋糕图标按钮 —— 单击创建/查看生日倒计时（原独立按钮已并入此行）
            if (e.kind === 'birthday') {
                valueHtml = '<span class="person-info-value-wrap">' + valueHtml +
                    '<button type="button" class="person-info-cake-btn" onclick="createBirthdayCountdown(\'' + escapeHtml(person.id) + '\')" title="单击创建生日倒计时（按年重复）；已关联则打开倒计时视图"><i class="fas fa-cake-candles"></i></button>' +
                '</span>';
            }
            return labelHtml + valueHtml;
        }).join('') +
    '</div>';
}

// 成员卡片：头像 + 姓名 + @可提及名 + 表格式信息行；与倒计时管理页同款虚线卡片。
// 底部操作行已取消：编辑按钮悬浮在卡片右上角（仿倒计时），合并移入编辑态；
// 「N 个关联任务」入口并入信息区末尾保留。卡片空白处双击 = 进入编辑。
function renderPersonCard(p) {
    if (peopleBatchMode) return _renderPersonBatchCard(p);
    const count = countPersonMentions(p.id);
    const filtered = currentPersonId === p.id;
    return '<div class="person-card-item person-card-view hover:bg-theme-tertiary transition' + (p.archived ? ' opacity-60' : '') + (filtered ? ' person-card-filtered' : '') + '" data-pid="' + p.id + '" ondblclick="_onPersonCardDblClick(event,\'' + p.id + '\')">' +
        '<button type="button" class="person-card-edit-btn" onclick="startEditPerson(\'' + p.id + '\')" title="编辑"><i class="fas fa-edit"></i></button>' +
        '<div class="flex items-start gap-2.5">' +
            '<button type="button" class="person-card-avatar-btn" onclick="quickUploadPersonAvatar(\'' + p.id + '\')" title="点击更换头像">' +
                renderPersonAvatarHtml(p, 'w-10 h-10', 'text-sm') +
            '</button>' +
            '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-2 min-w-0 pr-7">' +
                    '<span class="text-sm font-semibold text-theme-primary truncate">' + escapeHtml(p.name) + '</span>' +
                    (p.archived ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-theme-tertiary text-theme-muted flex-shrink-0">已归档</span>' : '') +
                    _personBirthdayChipHtml(p) +
                '</div>' +
                _personMentionLineHtml(p) +
            '</div>' +
        '</div>' +
        _personInfoRowsHtml(p, 'card') +
        (count > 0
            ? '<div class="mt-1.5">' +
                '<button type="button" onclick="togglePersonFilter(\'' + p.id + '\')" class="text-xs whitespace-nowrap transition ' + (filtered ? 'text-accent font-medium' : 'text-theme-muted hover:text-accent') + '" title="' + (filtered ? '取消筛选' : '筛选相关任务') + '">' + count + ' 个关联任务</button>' +
              '</div>'
            : '') +
    '</div>';
}

// 卡片空白处双击进入编辑：交互控件（按钮/链接/输入等）上双击不拦截，保留各自单击行为
function _onPersonCardDblClick(e, id) {
    const t = e && e.target;
    if (t && t.closest && t.closest('button,a,input,textarea,select,[contenteditable]')) return;
    if (peopleBatchMode) return;
    startEditPerson(id);
}

/* ---- 编辑表单：与卡片同宽（同处一个网格单元），头像 + 就地编辑 ---- */

function _personCustomRowHtml(label, value) {
    return '<div class="person-form-row people-form-custom-row">' +
        '<input type="text" class="person-form-label-input" value="' + escapeHtml(label || '') + '" placeholder="项目" list="people-field-suggestions" maxlength="24" autocomplete="off" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();addPersonFieldRow();}">' +
        '<input type="text" class="person-form-value-input" value="' + escapeHtml(value || '') + '" placeholder="内容" maxlength="500" autocomplete="off" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();addPersonFieldRow();}">' +
        '<button type="button" class="person-row-del" onclick="this.closest(\'.people-form-custom-row\').remove()" title="删除该项"><i class="fas fa-xmark"></i></button>' +
    '</div>';
}

const _PERSON_FIELD_SUGGESTIONS = ['职位', '公司', '部门', '电话', '手机', '微信', '工号', '生日', '地址', '主页'];

// 内置项目（邮箱 / 电话号码 / 职位 / 所属公司 / 工号 / 生日）：字段是数据模型固定项，配置里只决定「表单是否展示」
// 电话号码可多条，单独用 phone 组渲染；其余为单行
const PERSON_BUILTIN_FIELDS = {
    email: { label: '邮箱', inputId: 'people-form-email', type: 'email' },
    phone: { label: '电话号码' },
    title: { label: '职位', inputId: 'people-form-title', type: 'text' },
    company: { label: '所属公司', inputId: 'people-form-company', type: 'text' },
    staffNo: { label: '工号', inputId: 'people-form-staffNo', type: 'text' },
    // 生日有专门适配（格式校验 + 一键生日倒计时），输入框右侧带 i 图标提示填写规则
    birthday: { label: '生日', inputId: 'people-form-birthday', type: 'text', placeholder: '选填，如 1990-05-20 或 05-20' }
};

function _personBuiltinRowHtml(kind, value) {
    const meta = PERSON_BUILTIN_FIELDS[kind];
    if (!meta || !meta.inputId) return '';
    const tail = kind === 'birthday'
        ? '<i class="fas fa-circle-info person-form-info-icon" title="填写规则：YYYY-MM-DD（含年份，如 1990-05-20）或 MM-DD（年份未知、按年重复，如 05-20）；保存时自动校验，填写后可单击卡片上的「生日」一键创建生日倒计时"></i>'
        : '<span class="person-row-spacer" aria-hidden="true"></span>';
    return '<div class="person-form-row person-form-builtin-row" data-builtin="' + kind + '">' +
        '<span class="person-form-label">' + meta.label + '</span>' +
        '<input id="' + meta.inputId + '" type="' + meta.type + '" value="' + escapeHtml(value || '') + '" placeholder="' + escapeHtml(meta.placeholder || '选填') + '" class="person-form-value-input" autocomplete="off">' +
        tail +
    '</div>';
}

// 电话号码：一行一个，可增删（至少保留一行空白）；每行输入框右侧「+」追加一行、「×」删除本行。
// 「电话号码」label 固定在组级（不在行内），避免删掉首行后标签随之消失；删除走二次确认。
function _personPhoneRowHtml(value) {
    return '<div class="person-form-row people-form-phone-row">' +
        '<input type="text" value="' + escapeHtml(value || '') + '" placeholder="选填，如 138…" class="person-form-value-input" autocomplete="off">' +
        '<button type="button" class="person-row-add" onclick="addPersonPhoneRow(this)" title="添加电话号码"><i class="fas fa-plus"></i></button>' +
        '<button type="button" class="person-row-del" onclick="requestRemovePersonPhoneRow(this)" title="删除该号码"><i class="fas fa-xmark"></i></button>' +
    '</div>';
}

function _personPhoneGroupHtml(phones) {
    const list = (Array.isArray(phones) ? phones : []).slice();
    if (!list.length) list.push('');
    return '<div class="person-form-row people-form-phone-group">' +
        '<span class="person-form-label">电话号码</span>' +
        '<div class="people-form-phones" id="people-form-phones">' +
            list.map(function (v) { return _personPhoneRowHtml(v); }).join('') +
        '</div>' +
    '</div>';
}

// 表单字段行：
//   · 新建 → 完全按「字段配置」顺序预置（内置项目 + 自定义项目，均空值）
//   · 编辑 → 内置项目按配置是否启用 + 本人是否已有值决定；自定义项目只显示本人已有的（避免删了又自动加回）
function _personFormFieldsHtml(p, isNew) {
    const tpl = getPeopleFieldTemplate();
    const has = function (kind) {
        return tpl.some(function (f) { return f.builtin === kind; });
    };
    if (isNew) {
        return tpl.map(function (f) {
            if (f.builtin === 'phone') return _personPhoneGroupHtml([]);
            if (f.builtin) return _personBuiltinRowHtml(f.builtin, '');
            return _personCustomRowHtml(f.label, '');
        }).join('');
    }
    // 编辑：内置项按「配置启用」或「本人已有值」决定是否出现；自定义项只显示本人已有的
    let html = '';
    if (has('email') || (p && p.email)) html += _personBuiltinRowHtml('email', p ? p.email : '');
    if (has('phone') || (p && Array.isArray(p.phones) && p.phones.length)) html += _personPhoneGroupHtml(p ? p.phones : []);
    if (has('title') || (p && p.jobTitle)) html += _personBuiltinRowHtml('title', p ? p.jobTitle : '');
    if (has('company') || (p && p.company)) html += _personBuiltinRowHtml('company', p ? p.company : '');
    if (has('staffNo') || (p && p.staffNo)) html += _personBuiltinRowHtml('staffNo', p ? p.staffNo : '');
    if (has('birthday') || (p && p.birthday)) html += _personBuiltinRowHtml('birthday', p ? p.birthday : '');
    const custom = (p && Array.isArray(p.customFields)) ? p.customFields : [];
    html += custom.map(function (f) { return _personCustomRowHtml(f.label, f.value); }).join('');
    return html;
}

// 「+」追加电话行：传按钮时插在该行正下方，否则追加到末尾；上限 10 条，自动聚焦新行
function addPersonPhoneRow(btn) {
    const wrap = document.getElementById('people-form-phones');
    if (!wrap) return;
    if (wrap.querySelectorAll('.people-form-phone-row').length >= 10) { showToast('最多添加 10 个电话号码', 'warning'); return; }
    const row = (btn && btn.closest) ? btn.closest('.people-form-phone-row') : null;
    const html = _personPhoneRowHtml('', false);
    let newRow;
    if (row && wrap.contains(row)) {
        row.insertAdjacentHTML('afterend', html);
        newRow = row.nextElementSibling;
    } else {
        wrap.insertAdjacentHTML('beforeend', html);
        newRow = wrap.lastElementChild;
    }
    const input = newRow && newRow.querySelector('.person-form-value-input');
    if (input) input.focus();
}

function removePersonPhoneRow(btn) {
    const wrap = document.getElementById('people-form-phones');
    if (!wrap) return;
    const row = btn && btn.closest('.people-form-phone-row');
    const rows = wrap.querySelectorAll('.people-form-phone-row');
    if (row && rows.length > 1) {
        _resetPersonPhoneDelete(btn);   // 删行前确保确认态不残留
        row.remove();
        return;
    }
    const input = row && row.querySelector('.person-form-value-input');
    if (input) { input.value = ''; input.focus(); }
}

function _readPersonPhones() {
    const rows = document.querySelectorAll('#people-edit-form .people-form-phone-row');
    const out = [];
    Array.prototype.forEach.call(rows, function (row) {
        const el = row.querySelector('.person-form-value-input');
        const v = String(el ? el.value : '').trim().slice(0, 60);
        if (v && out.indexOf(v) === -1) out.push(v);
    });
    return out.slice(0, 10);
}

function renderPersonForm(p) {
    const isNew = !p;
    const color = peoplePendingColor || (p ? getPersonColor(p) : pickPersonAvatarColor());
    if (isNew) peoplePendingColor = color;
    // 编辑态完整展示别名 + 系统托管全拼（全拼默认可用，查看态不罗列，编辑态可见）
    const aliasList = (p && Array.isArray(p.aliases)) ? p.aliases.slice() : [];
    if (p && p.pinyinAlias && !aliasList.some(function (a) { return normalizePersonName(a) === normalizePersonName(p.pinyinAlias); })) {
        aliasList.push(p.pinyinAlias);
    }
    const aliasesValue = aliasList.join(', ');
    const fieldsHtml = _personFormFieldsHtml(p, isNew);
    const pendingUrl = _pendingAvatarUrl();
    const avatar = (pendingUrl !== null) ? pendingUrl : personAvatarOf(p);
    const nameValue = p ? p.name : '';
    const avatarInit = _formAvatarHtml(color, avatar, nameValue);

    // 自定义分组模式下提供「分组」下拉：触摸端无法拖拽卡片换组，这里是等价入口
    let groupRowHtml = '';
    if (typeof getPeopleGroupMode === 'function' && getPeopleGroupMode() === 'custom') {
        const curGid = normalizeGroupId('people', isNew ? (_peoplePendingGroupId || '') : (p.groupId || ''));
        const opts = ['<option value=""' + (curGid === '' ? ' selected' : '') + '>' + GROUP_DEFAULT_NAME + '</option>']
            .concat(getGroupDefs('people').filter(function (g) { return g && g.id; }).map(function (g) {
                return '<option value="' + g.id + '"' + (g.id === curGid ? ' selected' : '') + '>' + escapeHtml(g.name || '未命名分组') + '</option>';
            }));
        groupRowHtml = '<div class="person-form-row">' +
            '<span class="person-form-label">分组</span>' +
            '<select id="people-form-group" class="person-form-value-input">' + opts.join('') + '</select>' +
            '<span class="person-row-spacer" aria-hidden="true"></span>' +
        '</div>';
    }

    // FR-11 生日行已并入内置项目（由字段配置驱动，含 i 图标填写规则提示），不再硬编码
    // 已关联生日倒计时：展示引用 + 解除入口（只清引用，不删除倒计时本体）
    const linkedCd = p ? getPersonCountdown(p) : null;
    const countdownRowHtml = linkedCd
        ? '<div class="person-form-row" id="people-form-countdown-row">' +
            '<span class="person-form-label">倒计时</span>' +
            '<span class="flex-1 min-w-0 text-xs text-theme-secondary truncate" title="' + escapeHtml(linkedCd.name || '') + '">已关联：' + escapeHtml(linkedCd.name || '') + '</span>' +
            '<button type="button" class="person-row-del" onclick="unlinkPersonCountdown(\'' + p.id + '\')" title="解除关联（保留倒计时）"><i class="fas fa-link-slash"></i></button>' +
        '</div>'
        : '';

    // 原地悬浮包裹层（.person-form-wrap）：占据原卡片的网格单元（min-height 按原卡高度内联，
    // 网格布局不塌陷）；表单本体绝对定位浮起，宽度 = 1 个卡片列，高度向下自由展开
    const anchorStyle = _peopleFormAnchorH > 0 ? ' style="min-height:' + Math.round(_peopleFormAnchorH) + 'px"' : '';
    return '<div class="person-form-wrap"' + anchorStyle + '>' +
        '<div class="person-card-item person-form-item" id="people-edit-form">' +
        '<div class="flex items-start gap-3">' +
            '<div class="flex flex-col items-center gap-1.5 flex-shrink-0">' +
                // 悬浮头像时右上角出现垃圾桶（仅有头像时可用），二次确认后移除；查看态不显示
                '<div class="person-avatar-wrap" onmouseleave="_resetPersonAvatarDelete()">' +
                    '<button type="button" onclick="triggerPersonAvatarUpload()" class="person-avatar-btn" title="点击上传头像">' +
                        avatarInit +
                        '<span class="person-avatar-cam"><i class="fas fa-camera"></i></span>' +
                    '</button>' +
                    '<button type="button" id="people-form-avatar-del" class="person-avatar-del' + (avatar ? '' : ' is-empty') + '" onclick="confirmRemovePersonAvatar()" title="移除头像"><i class="fas fa-trash"></i></button>' +
                '</div>' +
                '<input id="people-form-color" type="color" value="' + escapeHtml(color) + '" class="person-color-input" title="头像底色" oninput="refreshPersonFormAvatar()">' +
                '<input id="people-form-avatar-file" type="file" accept="image/*" class="hidden" onchange="onPersonAvatarFileChosen(this)">' +
            '</div>' +
            '<div class="flex-1 min-w-0 space-y-1.5">' +
                '<input id="people-form-name" type="text" value="' + escapeHtml(nameValue) + '" placeholder="姓名（必填，不可重复）" class="person-form-value-input person-form-name-input" autocomplete="off" ' +
                    'oninput="refreshPersonFormAvatar()" ' +
                    'onkeydown="if(event.key===\'Enter\'){event.preventDefault();savePersonForm();}else if(event.key===\'Escape\'){cancelPersonForm();}">' +
                '<input id="people-form-aliases" type="text" value="' + escapeHtml(aliasesValue) + '" placeholder="别名（逗号分隔，如 zhangsan, shawn）" class="person-form-value-input person-form-name-input" autocomplete="off" ' +
                    'onkeydown="if(event.key===\'Enter\'){event.preventDefault();savePersonForm();}else if(event.key===\'Escape\'){cancelPersonForm();}">' +
            '</div>' +
        '</div>' +
        '<div class="person-form-rows" id="people-form-fields">' +
            groupRowHtml +
            fieldsHtml +
            countdownRowHtml +
            '<div class="person-form-row person-form-row-note">' +
                '<span class="person-form-label">备注</span>' +
                '<textarea id="people-form-note" rows="2" placeholder="选填" class="person-form-value-input person-form-textarea">' + escapeHtml(p ? p.note : '') + '</textarea>' +
                '<span class="person-row-spacer" aria-hidden="true"></span>' +
            '</div>' +
        '</div>' +
        '<button type="button" onclick="addPersonFieldRow()" class="person-add-field"><i class="fas fa-plus"></i>添加信息</button>' +
        '<datalist id="people-field-suggestions">' + _PERSON_FIELD_SUGGESTIONS.map(function (s) { return '<option value="' + s + '"></option>'; }).join('') + '</datalist>' +
        // 底部操作行：左组合并/归档/删除（仅编辑已有联系人），右组保存/取消；统一 w-8 描边方钮
        '<div class="flex items-center justify-between gap-2 mt-2.5">' +
            (isNew ? '<span></span>' :
                '<div class="flex items-center gap-2">' +
                    '<button type="button" id="people-form-merge-btn" onclick="openPersonMergePicker(\'' + p.id + '\', this)" class="flex items-center justify-center w-8 h-8 rounded-lg border border-orange-500 text-orange-500 hover:bg-orange-50 transition" title="合并联系人…"><i class="fas fa-code-merge text-sm"></i></button>' +
                    '<button type="button" id="people-form-archive-btn" onclick="requestArchivePersonFromForm(\'' + p.id + '\')" class="flex items-center justify-center w-8 h-8 rounded-lg border border-amber-500 text-amber-500 hover:bg-amber-50 transition" title="' + (p.archived ? '取消归档' : '归档') + '"><i class="fas ' + (p.archived ? 'fa-rotate-left' : 'fa-archive') + ' text-sm"></i></button>' +
                    '<button type="button" id="people-form-delete-btn" onclick="confirmDeletePerson(\'' + p.id + '\', true)" class="' + (peopleDeleteConfirming === p.id
                        ? 'flex items-center justify-center w-8 h-8 rounded-lg bg-red-600 text-white border border-red-600 transition'
                        : 'flex items-center justify-center w-8 h-8 rounded-lg border border-red-500 text-red-500 hover:bg-red-50 transition') + '" title="' + (peopleDeleteConfirming === p.id ? '再次点击确认删除' : '删除') + '"><i class="fas fa-trash text-sm"></i></button>' +
                '</div>') +
            '<div class="flex items-center gap-2">' +
                '<button type="button" onclick="savePersonForm()" class="flex items-center justify-center w-8 h-8 rounded-lg border border-green-500 text-green-500 hover:bg-green-500 hover:text-white transition" title="保存"><i class="fas fa-check text-sm"></i></button>' +
                '<button type="button" onclick="cancelPersonForm()" class="flex items-center justify-center w-8 h-8 rounded-lg border border-theme text-theme-secondary hover:bg-theme-primary transition" title="取消"><i class="fas fa-times text-sm"></i></button>' +
            '</div>' +
        '</div>' +
    '</div>' +
    '</div>';
}

// 表单头像预览：始终渲染占位字，有图时由 <img> 覆盖；图加载失败自动回退（离线版/文件被清理）
function _formAvatarHtml(color, avatarUrl, name) {
    return '<span id="people-form-avatar" class="rounded-full w-16 h-16 flex items-center justify-center flex-shrink-0 overflow-hidden relative font-semibold text-xl" style="background:' + color + '">' +
        '<span style="color:' + getPersonAvatarTextColor(color) + '">' + escapeHtml(getPersonAvatarText({ name: name })) + '</span>' +
        (avatarUrl ? '<img class="person-avatar-img" src="' + escapeHtml(avatarUrl) + '" alt="" onerror="this.remove()">' : '') +
    '</span>';
}

// 待提交头像：undefined=未改动 / ''=已移除 / {blob,url}=新图（url 是本地预览）
function _pendingAvatarUrl() {
    if (peoplePendingAvatar === undefined) return null;
    if (!peoplePendingAvatar) return '';
    return peoplePendingAvatar.url || '';
}

function _setPendingAvatarBlob(blob) {
    if (peoplePendingAvatar && peoplePendingAvatar.url) {
        try { URL.revokeObjectURL(peoplePendingAvatar.url); } catch (e) {}
    }
    peoplePendingAvatar = { blob: blob, url: URL.createObjectURL(blob) };
    refreshPersonFormAvatar();
}

function _releasePendingAvatar() {
    if (peoplePendingAvatar && peoplePendingAvatar.url) {
        try { URL.revokeObjectURL(peoplePendingAvatar.url); } catch (e) {}
    }
    peoplePendingAvatar = undefined;
}

// 头像写入服务端文件（attachments/people_avatars/<id>.jpg），返回带版本参数的 URL
function uploadPersonAvatar(personId, blob) {
    return fetch('/api/people-avatar/' + encodeURIComponent(personId), {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob
    }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
    }).then(function (j) {
        if (!j || !j.url) throw new Error('bad response');
        return j.url + '?v=' + (j.version || Date.now());
    });
}

function deletePersonAvatarFile(personId) {
    try {
        fetch('/api/people-avatar/' + encodeURIComponent(personId), { method: 'DELETE' }).catch(function () {});
    } catch (e) {}
}

// 卡片头像直接换图：不进入编辑态，压缩后立即上传并落盘
function quickUploadPersonAvatar(personId) {
    const person = getPersonById(personId);
    if (!person) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = function () {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) return;
        compressPersonAvatar(file).then(function (blob) {
            return uploadPersonAvatar(personId, blob).then(function (url) {
                const p = getPersonById(personId);
                if (!p) return;
                p.avatar = url;
                p.updatedAt = Date.now();
                saveData();
                renderPeopleList();
                showToast('已更新头像：' + p.name, 'success');
            });
        }).catch(function (err) {
            const tooLarge = err && err.message === 'too-large';
            showToast(tooLarge ? '图片过大，请选择 12MB 以内的图片' : '头像上传失败，请确认服务端已启动后重试', 'warning');
        });
    };
    input.click();
}

// 头像预览实时刷新（改姓名/改底色/上传/移除后调用；只动预览节点，不重绘表单）
function refreshPersonFormAvatar() {
    const el = document.getElementById('people-form-avatar');
    if (!el) return;
    const colorEl = document.getElementById('people-form-color');
    const nameEl = document.getElementById('people-form-name');
    const person = (peopleEditing && peopleEditing.id) ? getPersonById(peopleEditing.id) : null;
    const color = (colorEl && colorEl.value) || (person ? getPersonColor(person) : '#2563eb');
    const pendingUrl = _pendingAvatarUrl();
    const avatar = (pendingUrl !== null) ? pendingUrl : personAvatarOf(person);
    const name = nameEl ? nameEl.value : (person ? person.name : '');
    el.style.background = color;
    el.innerHTML = '<span style="color:' + getPersonAvatarTextColor(color) + '">' + escapeHtml(getPersonAvatarText({ name: name })) + '</span>' +
        (avatar ? '<img class="person-avatar-img" src="' + escapeHtml(avatar) + '" alt="" onerror="this.remove()">' : '');
    // 无头像时隐藏垃圾桶（有图才可移除），并清掉确认态
    const delBtn = document.getElementById('people-form-avatar-del');
    if (delBtn) {
        if (!avatar) _resetPersonAvatarDelete();
        delBtn.classList.toggle('is-empty', !avatar);
    }
}

// 头像删除：首次点击进入确认态（3 秒后复原），再次点击才移除
let _personAvatarDelConfirming = false;
let _personAvatarDelTimer = null;

function _resetPersonAvatarDelete() {
    if (_personAvatarDelTimer) { clearTimeout(_personAvatarDelTimer); _personAvatarDelTimer = null; }
    _personAvatarDelConfirming = false;
    const btn = document.getElementById('people-form-avatar-del');
    if (!btn) return;
    btn.classList.remove('is-confirm');
    btn.innerHTML = '<i class="fas fa-trash"></i>';
    btn.title = '移除头像';
}

function confirmRemovePersonAvatar() {
    const btn = document.getElementById('people-form-avatar-del');
    if (!btn) return;
    if (!_personAvatarDelConfirming) {
        _personAvatarDelConfirming = true;
        btn.classList.add('is-confirm');
        btn.innerHTML = '<i class="fas fa-check"></i>';
        btn.title = '再次点击确认移除头像';
        if (_personAvatarDelTimer) clearTimeout(_personAvatarDelTimer);
        _personAvatarDelTimer = setTimeout(_resetPersonAvatarDelete, 3000);
        return;
    }
    _resetPersonAvatarDelete();
    clearPersonAvatar();
}

// 电话号码删除：二次确认（首次点击实心红底白 ×、3 秒复原，再点才删）；样式与联系人删除确认态一致。
// 确认态按按钮元素记忆（可多行各删各的），表单重建后节点失效自然复原。
let _personPhoneDelConfirmBtn = null;
let _personPhoneDelTimer = null;

function _resetPersonPhoneDelete(btn) {
    if (_personPhoneDelTimer) { clearTimeout(_personPhoneDelTimer); _personPhoneDelTimer = null; }
    const target = btn || _personPhoneDelConfirmBtn;
    _personPhoneDelConfirmBtn = null;
    if (!target || !target.isConnected) return;
    target.classList.remove('is-confirm');
    target.title = '删除该号码';
}

function requestRemovePersonPhoneRow(btn) {
    if (!btn) return;
    if (_personPhoneDelConfirmBtn === btn) {
        _resetPersonPhoneDelete(btn);
        removePersonPhoneRow(btn);
        return;
    }
    _resetPersonPhoneDelete();
    _personPhoneDelConfirmBtn = btn;
    btn.classList.add('is-confirm');
    btn.title = '再次点击确认删除该号码';
    if (_personPhoneDelTimer) clearTimeout(_personPhoneDelTimer);
    _personPhoneDelTimer = setTimeout(function () { _resetPersonPhoneDelete(btn); }, 3000);
}

function triggerPersonAvatarUpload() {
    const input = document.getElementById('people-form-avatar-file');
    if (input) input.click();
}

function clearPersonAvatar() {
    if (peoplePendingAvatar && peoplePendingAvatar.url) {
        try { URL.revokeObjectURL(peoplePendingAvatar.url); } catch (e) {}
    }
    peoplePendingAvatar = '';
    refreshPersonFormAvatar();
}

function onPersonAvatarFileChosen(input) {
    const file = input && input.files && input.files[0];
    if (input) input.value = ''; // 允许连续选择同一张图
    if (!file) return;
    compressPersonAvatar(file).then(function (blob) {
        _setPendingAvatarBlob(blob);
        showToast('头像已就绪，保存后上传', 'success');
    }).catch(function (err) {
        const tooLarge = err && err.message === 'too-large';
        showToast(tooLarge ? '图片过大，请选择 12MB 以内的图片' : '无法读取这张图片，请换一张试试', 'warning');
    });
}

// 头像压缩：居中裁正方形 → 128×128 JPEG(q=0.82)，典型 6~10KB；返回 Blob 供直传服务端
function compressPersonAvatar(file) {
    return new Promise(function (resolve, reject) {
        if (!file || !/^image\//.test(String(file.type || ''))) { reject(new Error('not-image')); return; }
        if (file.size > 12 * 1024 * 1024) { reject(new Error('too-large')); return; }
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = function () {
            try {
                const size = 128;
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                const side = Math.min(w, h) || 1;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, size, size);
                ctx.imageSmoothingEnabled = true;
                if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
                URL.revokeObjectURL(objectUrl);
                _canvasToJpegBlob(canvas, 0.82).then(function (blob) {
                    if (!blob) { reject(new Error('encode')); return; }
                    if (blob.size <= 40000) { resolve(blob); return; }
                    // 噪点图兜底：降一档质量重编
                    _canvasToJpegBlob(canvas, 0.68).then(function (smaller) {
                        resolve(smaller || blob);
                    }, function () { resolve(blob); });
                }, reject);
            } catch (e) {
                URL.revokeObjectURL(objectUrl);
                reject(e);
            }
        };
        img.onerror = function () {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('decode'));
        };
        img.src = objectUrl;
    });
}

function _canvasToJpegBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
        if (typeof canvas.toBlob !== 'function') {
            // 极老环境兜底：dataURL → Blob
            try {
                const durl = canvas.toDataURL('image/jpeg', quality);
                const bin = atob(durl.split(',')[1]);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                resolve(new Blob([arr], { type: 'image/jpeg' }));
            } catch (e) { reject(e); }
            return;
        }
        canvas.toBlob(function (blob) { resolve(blob); }, 'image/jpeg', quality);
    });
}

function addPersonFieldRow() {
    const wrap = document.getElementById('people-form-fields');
    if (!wrap) return;
    if (wrap.querySelectorAll('.people-form-custom-row').length >= 20) { showToast('最多添加 20 项信息', 'warning'); return; }
    const noteRow = wrap.querySelector('.person-form-row-note');
    if (noteRow) noteRow.insertAdjacentHTML('beforebegin', _personCustomRowHtml('', ''));
    else wrap.insertAdjacentHTML('beforeend', _personCustomRowHtml('', ''));
    const rows = wrap.querySelectorAll('.people-form-custom-row');
    const last = rows[rows.length - 1];
    const labelInput = last && last.querySelector('.person-form-label-input');
    if (labelInput) labelInput.focus();
}

// 读取表单里的自定义信息项；label 缺失但填了内容时报错（返回 error）
function _readPersonCustomFields() {
    const rows = document.querySelectorAll('#people-edit-form .people-form-custom-row');
    const out = [];
    let badInput = null;
    Array.prototype.forEach.call(rows, function (row) {
        const labelEl = row.querySelector('.person-form-label-input');
        const valueEl = row.querySelector('.person-form-value-input');
        const label = String(labelEl ? labelEl.value : '').trim();
        const value = String(valueEl ? valueEl.value : '').trim();
        if (!label && !value) return;
        if (!label) { if (!badInput) badInput = labelEl; return; }
        if (!value) return; // 只预置了项目名（模板行）但没填内容 → 不落盘
        out.push({ label: label.slice(0, 24), value: value.slice(0, 500) });
    });
    if (badInput) return { error: '自定义信息需要填写项目名称', focusEl: badInput };
    return { fields: out.slice(0, 20) };
}

// 新建联系人时预设分组（由标题栏「+」选组传入）
let _peoplePendingGroupId = '';
// 悬浮编辑卡的锚定高度：进入编辑前量取原卡片高度，作为包裹层 min-height，保证网格不塌陷
let _peopleFormAnchorH = 0;

function _peopleMeasureAnchor(id) {
    const card = id ? document.querySelector('.person-card-item[data-pid="' + id + '"]') : null;
    _peopleFormAnchorH = card ? card.offsetHeight : 0;
}

function startAddPerson(groupId) {
    _peopleExitSeq++;   // 让仍在播放的退场回调失效，避免它重建列表覆盖新表单
    peopleEditing = { id: null };
    _peoplePendingGroupId = typeof normalizeGroupId === 'function'
        ? normalizeGroupId('people', groupId || '') : (groupId || '');
    peopleDeleteConfirming = null;
    _peopleFormAnchorH = 0;   // 新建占据「+」占位卡位置，用 CSS 默认 min-height
    _releasePendingAvatar();
    _resetPersonAvatarDelete();
    peoplePendingColor = pickPersonAvatarColor();
    renderPeopleList();
    // 置顶新建表单：滚到列表顶部即可（普通流内卡片，自身占位，不会跳位）；
    // 自定义分组的原地悬浮表单：滚到锚点单元居中，再收敛进可视区
    const topWrap = document.querySelector('.people-top-form-wrap');
    const wrap = topWrap ? topWrap : document.querySelector('.person-form-wrap');
    if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ block: topWrap ? 'start' : 'center' });
    _peopleFitForm();
}

function startEditPerson(id) {
    _peopleExitSeq++;
    _peopleMeasureAnchor(id);
    peopleEditing = { id: id };
    _peoplePendingGroupId = '';
    peopleDeleteConfirming = null;
    _releasePendingAvatar();
    _resetPersonAvatarDelete();
    peoplePendingColor = '';
    renderPeopleList();
}

function cancelPersonForm() {
    const returningId = peopleEditing ? peopleEditing.id : null;  // 归位卡片 id（新建为 null，无卡片可回到）
    peopleEditing = null;
    _peoplePendingGroupId = '';
    _peopleFormAnchorH = 0;
    _releasePendingAvatar();
    peoplePendingColor = '';
    _resetPersonAvatarDelete();
    _peopleFinishEdit(returningId);
}

// 关闭编辑：先播「从下到上擦除消失」退场动画，播完再重建列表 + 归位卡片显现（对等进场）。
// 用递增序号做 token：动画未播完时若又开启了新的编辑（startAddPerson/startEditPerson 会让 token 失效），
// 旧回调即放弃重建，避免覆盖新表单状态。reduced-motion / 无 form 时直接同步收尾。
let _peopleExitSeq = 0;
function _peopleFinishEdit(returningId) {
    const form = document.getElementById('people-edit-form');
    const seq = ++_peopleExitSeq;
    const finish = function () {
        if (seq !== _peopleExitSeq) return;   // 已被新的编辑流程接管，放弃本次重建
        renderPeopleList();
        _peoplePlayCardReturn(returningId);
    };
    const reduce = (typeof matchMedia === 'function') && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!form || reduce) { finish(); return; }
    let done = false;
    const once = function (e) {
        if (e && e.target !== form) return;  // 忽略子元素动画冒泡上来的 animationend
        if (done) return;
        done = true;
        form.removeEventListener('animationend', once);
        finish();
    };
    form.classList.add('person-form-exit');
    form.addEventListener('animationend', once);
    // 兜底：后台/无头等环境 animationend 可能不触发，超时强制收尾
    setTimeout(once, 320);
}

// 取消/保存编辑后回到卡片：给归位卡片挂「从下到上擦除显现」动画（对等进场 person-form-reveal）。
// 卡片由 renderPeopleList 重建，新节点尚未首帧绘制，此刻挂类即可让动画从初始帧播放；
// 与进场同用 clip-path，只重绘卡片自身、不触发布局。新建取消无归位卡片时直接跳过。
function _peoplePlayCardReturn(id) {
    if (!id) return;
    const card = document.querySelector('.person-card-item[data-pid="' + id + '"]');
    if (!card || card.classList.contains('person-form-item')) return;
    card.classList.add('person-card-return');
    // 兜底摘类：prefers-reduced-motion 下动画为 none 不触发 animationend
    setTimeout(function () { card.classList.remove('person-card-return'); }, 400);
}

function _peopleFormHasName() {
    const el = document.getElementById('people-form-name');
    return !!(el && String(el.value || '').trim());
}

// 新建表单是否已填过东西（决定「点外」是保存还是静默放弃）
function _peopleFormHasContent() {
    const ids = ['people-form-aliases', 'people-form-email', 'people-form-title', 'people-form-company', 'people-form-staffNo', 'people-form-note', 'people-form-birthday'];
    for (let i = 0; i < ids.length; i++) {
        const el = document.getElementById(ids[i]);
        if (el && String(el.value || '').trim()) return true;
    }
    const rows = document.querySelectorAll('#people-edit-form .people-form-custom-row, #people-edit-form .people-form-phone-row');
    for (let i = 0; i < rows.length; i++) {
        const el = rows[i].querySelector('.person-form-value-input');
        if (el && String(el.value || '').trim()) return true;
    }
    return !!_pendingAvatarUrl();
}

// 别名输入解析：逗号/顿号/分号/空白分隔；去空、去重、排除与本人正名/系统全拼相同项；
// 与他人正名/别名/全拼冲突时报错（别名全局唯一，保证 @ 无歧义）
function _parseAliasesInput(value, selfName, excludeId, selfPinyin) {
    const parts = String(value == null ? '' : value).split(/[,，、;；\s]+/);
    const selfKey = normalizePersonName(selfName);
    const selfPyKey = normalizePersonName(selfPinyin || '');
    const seen = {};
    const aliases = [];
    for (let i = 0; i < parts.length; i++) {
        const v = parts[i].trim();
        if (!v) continue;
        const key = normalizePersonName(v);
        if (!key || key === selfKey || (selfPyKey && key === selfPyKey) || seen[key]) continue;
        if (personNameExists(v, excludeId)) return { error: '别名与已有联系人的姓名/别名冲突：' + v };
        seen[key] = true;
        aliases.push(v);
    }
    return { aliases: aliases };
}

function _aliasesEqual(a, b) {
    const ka = (a || []).map(normalizePersonName).join(',');
    const kb = (b || []).map(normalizePersonName).join(',');
    return ka === kb;
}

async function savePersonForm() {
    if (!peopleEditing || _peopleSaving) return;
    const editingToken = peopleEditing;

    // ---- 校验：任一项不通过都保持编辑态（与倒计时编辑卡一致，不丢用户输入）----
    const nameEl = document.getElementById('people-form-name');
    const name = String(nameEl ? nameEl.value : '').trim();
    if (!name) {
        showToast('姓名不能为空', 'warning');
        if (nameEl) nameEl.focus();
        return;
    }
    const excludeId = peopleEditing.id || undefined;
    if (personNameExists(name, excludeId)) {
        showToast('已存在同名联系人：' + name, 'warning');
        if (nameEl) nameEl.focus();
        return;
    }
    const aliasesEl = document.getElementById('people-form-aliases');
    const editingPerson = peopleEditing.id ? getPersonById(peopleEditing.id) : null;
    const parsed = _parseAliasesInput(aliasesEl ? aliasesEl.value : '', name, excludeId, editingPerson ? editingPerson.pinyinAlias : '');
    if (parsed.error) {
        showToast(parsed.error, 'warning');
        if (aliasesEl) aliasesEl.focus();
        return;
    }
    let aliases = parsed.aliases;

    const customParsed = _readPersonCustomFields();
    if (customParsed.error) {
        showToast(customParsed.error, 'warning');
        if (customParsed.focusEl) customParsed.focusEl.focus();
        return;
    }
    const customFields = customParsed.fields || [];

    // FR-11 生日校验：YYYY-MM-DD 或 MM-DD（公历），非法保持编辑态；
    // 行未渲染（配置未启用且本人无值）时按空处理，不清空已有生日
    const birthdayEl = document.getElementById('people-form-birthday');
    const birthday = birthdayEl ? normalizePersonBirthday(birthdayEl.value)
        : (!peopleEditing.id ? '' : String((getPersonById(peopleEditing.id) || {}).birthday || ''));
    if (birthdayEl && birthday === null) {
        showToast('生日格式不正确，请用 YYYY-MM-DD 或 MM-DD（如 1990-05-20 或 05-20）', 'warning');
        if (birthdayEl) birthdayEl.focus();
        return;
    }

    // 内置项可能因「字段配置」未启用而不在表单里：此时保持原值（新建则空），避免误清空
    const emailEl = document.getElementById('people-form-email');
    const titleEl = document.getElementById('people-form-title');
    const companyEl = document.getElementById('people-form-company');
    const staffNoEl = document.getElementById('people-form-staffNo');
    const phoneWrap = document.getElementById('people-form-phones');
    const note = String((document.getElementById('people-form-note') || {}).value || '').trim();
    const color = String((document.getElementById('people-form-color') || {}).value || '');
    const pendingAvatar = peoplePendingAvatar;
    const now = Date.now();

    // ---- 取记录（新建先落一条：头像文件按 personId 命名，必须先有 id）----
    let person = null;
    let isNew = false;
    if (!peopleEditing.id) {
        person = createPersonRecord(name);
        if (!person) { showToast('已存在同名联系人：' + name, 'warning'); return; }
        isNew = true;
    } else {
        person = getPersonById(peopleEditing.id);
        if (!person) { cancelPersonForm(); return; }
    }

    // 分组归属：优先表单「分组」下拉（自定义分组模式，新建/编辑通用）；
    // 无下拉时新建沿用标题栏选中的分组，编辑保持原值
    const groupEl = document.getElementById('people-form-group');
    if (groupEl) {
        person.groupId = normalizeGroupId('people', groupEl.value);
    } else if (isNew && _peoplePendingGroupId && normalizeGroupId('people', _peoplePendingGroupId)) {
        person.groupId = _peoplePendingGroupId;
    }

    const oldNames = isNew ? [] : getPersonAllNames(person);
    const oldName = person.name;
    const aliasesChanged = isNew ? false : !_aliasesEqual(person.aliases, aliases);
    const email = emailEl ? String(emailEl.value || '').trim() : (isNew ? '' : String(person.email || ''));
    const jobTitle = titleEl ? String(titleEl.value || '').trim() : (isNew ? '' : String(person.jobTitle || ''));
    const company = companyEl ? String(companyEl.value || '').trim() : (isNew ? '' : String(person.company || ''));
    const staffNo = staffNoEl ? String(staffNoEl.value || '').trim() : (isNew ? '' : String(person.staffNo || ''));
    const phones = phoneWrap ? _readPersonPhones() : (isNew ? [] : (Array.isArray(person.phones) ? person.phones.slice() : []));

    // 系统托管全拼不重复存为普通别名（编辑态展示用，落盘归位到 pinyinAlias 字段）
    const pyKey = normalizePersonName(person.pinyinAlias || '');
    if (pyKey) aliases = aliases.filter(function (a) { return normalizePersonName(a) !== pyKey; });
    // 头像上传是异步的：先快照原值，await 期间用户点「取消」/Esc 时可完整回滚（新建则整条移除），
    // 保证取消语义 = 放弃本次全部修改（不落盘、不留半成品记录）
    const _orig = isNew ? null : {
        groupId: person.groupId,
        name: person.name,
        aliases: person.aliases,
        email: person.email,
        jobTitle: person.jobTitle,
        company: person.company,
        staffNo: person.staffNo,
        phones: person.phones,
        note: person.note,
        customFields: person.customFields,
        birthday: person.birthday,
        color: person.color,
        avatar: person.avatar,
        pinyinAlias: person.pinyinAlias,
        updatedAt: person.updatedAt
    };
    person.name = name;
    person.aliases = aliases;
    person.email = email;
    person.jobTitle = jobTitle;
    person.company = company;
    person.staffNo = staffNo;
    person.phones = phones;
    person.note = note;
    person.customFields = customFields;
    person.birthday = birthday;
    if (color) person.color = color;
    person.updatedAt = now;

    let avatarWarning = '';
    _peopleSaving = true;
    try {
        // 头像：二进制走服务端文件（attachments/people_avatars/<id>.jpg），data.json 只留 URL。
        // 先落盘再结束编辑，保证列表重绘时拿到的 URL 已是新版本；上传失败不阻塞其他字段保存。
        if (pendingAvatar && pendingAvatar.blob) {
            try {
                person.avatar = await uploadPersonAvatar(person.id, pendingAvatar.blob);
            } catch (e) {
                avatarWarning = '头像上传失败，其他信息已保存';
            }
        } else if (pendingAvatar === '') {
            const hadFile = /^\/api\/people-avatar\//.test(String(person.avatar || ''));
            person.avatar = '';
            if (hadFile) deletePersonAvatarFile(person.id);
        }

        // 上传期间用户点了「取消」/Esc（cancelPersonForm 置 peopleEditing = null）：
        // 回滚本次全部修改并放弃，不落盘（新建的记录与可能已上传的头像文件一并清理）
        if (peopleEditing === null) {
            if (isNew) {
                const idx = (settings.people || []).indexOf(person);
                if (idx !== -1) settings.people.splice(idx, 1);
                deletePersonAvatarFile(person.id);
            } else if (_orig) {
                person.groupId = _orig.groupId;
                person.name = _orig.name;
                person.aliases = _orig.aliases;
                person.email = _orig.email;
                person.jobTitle = _orig.jobTitle;
                person.company = _orig.company;
                person.staffNo = _orig.staffNo;
                person.phones = _orig.phones;
                person.note = _orig.note;
                person.customFields = _orig.customFields;
                person.birthday = _orig.birthday;
                person.color = _orig.color;
                person.avatar = _orig.avatar;
                person.pinyinAlias = _orig.pinyinAlias;
                person.updatedAt = _orig.updatedAt;
            }
            renderPeopleList();
            return;
        }

        if (isNew) {
            _recomputeAllPeopleIds(); // 正文里可能已有 @姓名/@别名/@全拼 的普通文本
        } else if (oldName !== name) {
            rewritePersonMentionsInTasks(oldNames, name); // 正文改写静默完成，不弹提示（oldNames 含旧全拼）
            // 系统托管全拼随改名更新：排除自身后按其余联系人的全部可提及名去重
            const taken = {};
            (settings.people || []).forEach(function (p) {
                if (p.id === person.id) return;
                getPersonAllNames(p).forEach(function (n) { taken[normalizePersonName(n)] = true; });
            });
            person.pinyinAlias = (typeof generatePersonPinyinAlias === 'function') ? generatePersonPinyinAlias(name, taken) : '';
            _recomputeAllPeopleIds(); // 新全拼可能命中原正文里的普通文本
        } else if (aliasesChanged) {
            _recomputeAllPeopleIds(); // 增删别名不改写正文，仅重算派生缓存
        }

        saveData();
        // 上传期间用户可能已切到别的编辑/视图：只落数据，不抢回界面状态
        if (peopleEditing !== editingToken) return;

        peopleEditing = null;
        _peoplePendingGroupId = '';
        _peopleFormAnchorH = 0;
        _releasePendingAvatar();
        peoplePendingColor = '';
        _peopleFinishEdit(person.id);   // 播退场动画后重建列表 + 归位卡片显现
        // 保存成功不弹提示（用户要求：编辑保存静默）；仅头像上传失败等异常才提示
        if (avatarWarning) showToast(avatarWarning, 'warning');
    } finally {
        _peopleSaving = false;
    }
}

// 编辑表单相对原记录是否有未保存改动：与 savePersonForm 的读取口径一致，
// 用于归档/删除前提醒「改动将丢弃」；不在该联系人的编辑态时视为无改动。
function _personFormDirty(id) {
    if (!peopleEditing || peopleEditing.id !== id) return false;
    const p = getPersonById(id);
    if (!p) return false;
    const val = function (elId) {
        const el = document.getElementById(elId);
        return el ? String(el.value || '').trim() : null;
    };
    const name = val('people-form-name');
    if (name !== null && name !== String(p.name || '')) return true;
    const aliasesEl = document.getElementById('people-form-aliases');
    if (aliasesEl) {
        const parsed = _parseAliasesInput(aliasesEl.value, name === null ? p.name : name, id, p.pinyinAlias);
        if (parsed.error || !_aliasesEqual(parsed.aliases, p.aliases)) return true;
    }
    const pairs = [
        ['people-form-email', p.email],
        ['people-form-title', p.jobTitle],
        ['people-form-company', p.company],
        ['people-form-staffNo', p.staffNo],
        ['people-form-note', p.note]
    ];
    for (let i = 0; i < pairs.length; i++) {
        const v = val(pairs[i][0]);
        if (v !== null && v !== String(pairs[i][1] || '')) return true;
    }
    const birthdayEl = document.getElementById('people-form-birthday');
    if (birthdayEl) {
        const b = normalizePersonBirthday(birthdayEl.value);
        if (b !== String(p.birthday || '')) return true;
    }
    if (document.getElementById('people-form-phones')) {
        const phones = _readPersonPhones();
        const old = Array.isArray(p.phones) ? p.phones : [];
        if (phones.length !== old.length || phones.some(function (v, i) { return v !== old[i]; })) return true;
    }
    const custom = _readPersonCustomFields();
    if (custom.error || !_samePersonCustomFields(custom.fields || [], p.customFields)) return true;
    const colorEl = document.getElementById('people-form-color');
    if (colorEl && String(colorEl.value || '') !== String(getPersonColor(p) || '')) return true;
    if (_pendingAvatarUrl() !== null) return true;
    const groupEl = document.getElementById('people-form-group');
    if (groupEl && typeof normalizeGroupId === 'function'
        && normalizeGroupId('people', groupEl.value) !== normalizeGroupId('people', p.groupId || '')) return true;
    return false;
}

function _samePersonCustomFields(a, b) {
    const x = Array.isArray(a) ? a : [];
    const y = Array.isArray(b) ? b : [];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
        if (!y[i] || x[i].label !== y[i].label || x[i].value !== y[i].value) return false;
    }
    return true;
}

// 删除确认态就地切换：只改按钮 class/title，不重建列表，避免清掉编辑中的输入
function _syncPersonFormDeleteBtn(id) {
    const btn = document.getElementById('people-form-delete-btn');
    if (!btn) return;
    const confirming = peopleDeleteConfirming === id;
    btn.className = confirming
        ? 'flex items-center justify-center w-8 h-8 rounded-lg bg-red-600 text-white border border-red-600 transition'
        : 'flex items-center justify-center w-8 h-8 rounded-lg border border-red-500 text-red-500 hover:bg-red-50 transition';
    btn.title = confirming ? '再次点击确认删除' : '删除';
}

// 编辑态归档：有未保存改动先确认丢弃；执行前退出编辑态（不播归位动画，卡片会移位/收起）
function requestArchivePersonFromForm(id) {
    const doArchive = function () {
        if (peopleEditing && peopleEditing.id === id) {
            peopleEditing = null;
            _peoplePendingGroupId = '';
            _peopleFormAnchorH = 0;
            _releasePendingAvatar();
            peoplePendingColor = '';
            _resetPersonAvatarDelete();
        }
        peopleDeleteConfirming = null;
        if (peopleDeleteTimer) { clearTimeout(peopleDeleteTimer); peopleDeleteTimer = null; }
        renderPeopleList();
        togglePersonArchived(id);
    };
    if (_personFormDirty(id)) {
        showConfirmToast('有未保存的修改，归档后将丢失。是否继续？', doArchive, null,
            { confirmLabel: '继续归档', cancelLabel: '取消' });
        return;
    }
    doArchive();
}

// FR-07：归档前若仍有未完成相关任务，先弹确认（不阻止，只提醒）；恢复不受影响
function togglePersonArchived(id) {
    const person = getPersonById(id);
    if (!person) return;
    if (!person.archived) {
        const activeCount = tasks.filter(function (t) {
            return !t.deletedAt && !t.completed && (t.peopleIds || []).indexOf(id) !== -1;
        }).length;
        if (activeCount > 0) {
            showConfirmToast(
                '「' + person.name + '」仍有 ' + activeCount + ' 条未完成任务与其相关，归档后将无法在 @ 候选中选择。',
                function () { _doTogglePersonArchived(person); },
                null,
                { confirmLabel: '继续归档', cancelLabel: '取消' }
            );
            return;
        }
    }
    _doTogglePersonArchived(person);
}

function _doTogglePersonArchived(person) {
    person.archived = !person.archived;
    person.updatedAt = Date.now();
    saveData();
    renderPeopleList();
    showToast(person.archived ? '已归档：' + person.name + '（正文提及保留，显示为灰色）' : '已取消归档：' + person.name, 'success');
}

function confirmDeletePerson(id, fromForm) {
    if (peopleDeleteConfirming !== id) {
        peopleDeleteConfirming = id;
        if (peopleDeleteTimer) clearTimeout(peopleDeleteTimer);
        peopleDeleteTimer = setTimeout(function () {
            peopleDeleteConfirming = null;
            peopleDeleteTimer = null;
            if (fromForm) _syncPersonFormDeleteBtn(id);
            else renderPeopleList();
        }, 3000);
        if (fromForm) _syncPersonFormDeleteBtn(id);
        else renderPeopleList();
        return;
    }
    if (peopleDeleteTimer) { clearTimeout(peopleDeleteTimer); peopleDeleteTimer = null; }
    peopleDeleteConfirming = null;
    // 编辑态删除：先确认丢弃未保存改动，再落删除（表单会随列表重建而消失，无需单独收起）
    if (fromForm && _personFormDirty(id)) {
        // 已退出确认态：先就地复原按钮，取消/超时后不会残留实心红
        _syncPersonFormDeleteBtn(id);
        showConfirmToast('有未保存的修改，删除后将丢失。是否继续？', function () {
            _doConfirmDeletePerson(id);
        }, null, { confirmLabel: '继续删除', cancelLabel: '取消' });
        return;
    }
    _doConfirmDeletePerson(id);
}

function _doConfirmDeletePerson(id) {
    const person = getPersonById(id);
    if (!person) return;
    if (/^\/api\/people-avatar\//.test(String(person.avatar || ''))) deletePersonAvatarFile(id);
    const count = countPersonMentions(id);
    settings.people = settings.people.filter(function (p) { return p.id !== id; });
    // 正文即事实：删除成员不改写正文，@名字 留为普通文本；仅从派生缓存移除该 id
    tasks.forEach(function (t) {
        if (Array.isArray(t.peopleIds) && t.peopleIds.indexOf(id) !== -1) {
            t.peopleIds = t.peopleIds.filter(function (pid) { return pid !== id; });
        }
        // FR-08：等待标记随关联一并清理
        if (Array.isArray(t.waitingForIds) && t.waitingForIds.indexOf(id) !== -1) {
            t.waitingForIds = t.waitingForIds.filter(function (pid) { return pid !== id; });
        }
    });
    if (currentPersonId === id) {
        currentPersonId = null;
        _saveFilterState();
    }
    // 从编辑态删除：清掉表单残留状态（外加头像/底色草稿），避免后续点外保存误判
    if (peopleEditing && peopleEditing.id === id) {
        peopleEditing = null;
        _peoplePendingGroupId = '';
        _peopleFormAnchorH = 0;
        _releasePendingAvatar();
        peoplePendingColor = '';
        _resetPersonAvatarDelete();
    }
    saveData();
    renderPeopleList();
    showToast(count > 0 ? '已删除：' + person.name + '（' + count + ' 个任务中的 @' + person.name + ' 保留为普通文本）' : '已删除：' + person.name, 'success');
}

/* ==================== FR-02 @ 候选面板 ==================== */

let _mp = { open: false, ta: null, at: -1, query: '', items: [], active: 0 };

function _peoplePickerAllowed(ta) {
    if (!ta) return false;
    if (ta.id === 'detail-task-notes' || ta.id === 'detail-task-description') return true;
    // 行级编辑器的活动块 textarea：仅详情面板内（模板面板不启用）
    return !!(ta.classList && ta.classList.contains('md-block-input') && ta.closest('#task-detail-panel'));
}

// 输入钩子：光标前存在「行首/空白 + @ + 非空白查询」时打开/更新候选，否则关闭
function peopleMentionInputHook(ta) {
    if (!_peoplePickerAllowed(ta) || !ta.isConnected) { closePeopleMentionPicker(); return; }
    const caret = ta.selectionStart;
    if (caret == null || ta.selectionEnd !== caret) { closePeopleMentionPicker(); return; }
    const value = ta.value;
    let at = -1;
    for (let i = caret - 1; i >= 0 && caret - i <= 31; i--) {
        const ch = value[i];
        if (ch === '@') { at = i; break; }
        if (/\s/.test(ch)) break;
    }
    if (at === -1) { closePeopleMentionPicker(); return; }
    if (at > 0 && !/\s/.test(value[at - 1])) { closePeopleMentionPicker(); return; }
    // 代码区内的 @ 不触发（行内代码/围栏代码块）
    if (_maskMentionCodeRegions(value)[at] !== '@') { closePeopleMentionPicker(); return; }
    const query = value.slice(at + 1, caret);
    const items = _buildMentionCandidates(query);
    if (!items.length) { closePeopleMentionPicker(); return; }
    const sameTarget = _mp.open && _mp.ta === ta && _mp.at === at && _mp.query === query;
    _mp.open = true;
    _mp.ta = ta;
    _mp.at = at;
    _mp.query = query;
    _mp.items = items;
    if (!sameTarget) _mp.active = 0;
    else _mp.active = Math.min(_mp.active, items.length - 1);
    _mpRender();
    _mpPosition();
}

function _buildMentionCandidates(query) {
    const q = normalizePersonName(query);
    const ql = String(query || '').trim().toLowerCase();
    const people = (settings.people || []).filter(function (p) { return !p.archived; });
    let matched = people.filter(function (p) {
        if (!q) return true;
        return getPersonAllNames(p).some(function (n) {
            return normalizePersonName(n).indexOf(q) !== -1
                || getPinyinInitialsForName(n).indexOf(ql) !== -1;
        });
    });
    matched.sort(function (a, b) {
        return (b.lastUsedAt || 0) - (a.lastUsedAt || 0)
            || comparePersonNamesByPinyin(a.name, b.name);
    });
    const items = matched.slice(0, 8).map(function (p) { return { type: 'person', person: p }; });
    // 输入已是某成员的正名或别名时不再提供「创建」（避免别名被拆成新成员）
    const exact = q && (settings.people || []).some(function (p) {
        return getPersonAllNames(p).some(function (n) { return normalizePersonName(n) === q; });
    });
    if (String(query || '').trim() && !exact) {
        items.push({ type: 'create', name: String(query).trim() });
    }
    return items;
}

function _mpRender() {
    const picker = document.getElementById('people-mention-picker');
    if (!picker) return;
    let html = '';
    _mp.items.forEach(function (item, i) {
        const activeCls = i === _mp.active ? ' people-picker-active' : '';
        if (item.type === 'person') {
            const p = item.person;
            const initials = getPersonPinyinInitials(p);
            // 经别名命中时附注别名，提示 @别名 与 @姓名 指向同一人
            const q = normalizePersonName(_mp.query);
            let aliasHint = '';
            if (q && normalizePersonName(p.name).indexOf(q) === -1) {
                const hit = getPersonAllNames(p).find(function (a) {
                    return normalizePersonName(a) !== normalizePersonName(p.name) && normalizePersonName(a).indexOf(q) !== -1;
                });
                if (hit) aliasHint = '<span class="text-[10px] text-theme-muted flex-shrink-0">@' + escapeHtml(hit) + '</span>';
            }
            html += '<div class="people-picker-item' + activeCls + '" data-mp-idx="' + i + '">' +
                renderPersonAvatarHtml(p, 'w-6 h-6', 'text-[10px]') +
                '<span class="flex-1 min-w-0 truncate text-sm text-theme-primary">' + escapeHtml(p.name) + '</span>' +
                aliasHint +
                (initials ? '<span class="text-[10px] text-theme-muted flex-shrink-0">' + escapeHtml(initials) + '</span>' : '') +
            '</div>';
        } else {
            html += '<div class="people-picker-item' + activeCls + '" data-mp-idx="' + i + '">' +
                '<span class="w-6 h-6 rounded-full flex items-center justify-center bg-theme-tertiary text-accent flex-shrink-0"><i class="fas fa-plus text-[10px]"></i></span>' +
                '<span class="flex-1 min-w-0 truncate text-sm text-theme-primary">创建「' + escapeHtml(item.name) + '」</span>' +
            '</div>';
        }
    });
    picker.innerHTML = html;
    picker.classList.remove('hidden');
}

// 光标坐标：镜像 div 测量（textarea 无原生 caret rect API）
function _peopleCaretCoords(ta) {
    const cs = getComputedStyle(ta);
    const div = document.createElement('div');
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing'
    ].forEach(function (k) { div.style[k] = cs[k]; });
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.overflow = 'hidden';
    div.style.width = cs.width;
    div.style.top = '0';
    div.style.left = '-9999px';
    const caret = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    div.textContent = ta.value.slice(0, caret);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    div.appendChild(marker);
    document.body.appendChild(div);
    const top = marker.offsetTop;
    const left = marker.offsetLeft;
    div.remove();
    const rect = ta.getBoundingClientRect();
    const lineH = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 14) * 1.4;
    return { x: rect.left + left - ta.scrollLeft, y: rect.top + top - ta.scrollTop, lineH: lineH };
}

function _mpPosition() {
    const picker = document.getElementById('people-mention-picker');
    if (!picker || !_mp.open || !_mp.ta) return;
    const pos = _peopleCaretCoords(_mp.ta);
    const w = picker.offsetWidth || 260;
    const h = picker.offsetHeight || 40;
    let left = Math.min(Math.max(8, pos.x), window.innerWidth - w - 8);
    let top = pos.y + pos.lineH + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, pos.y - h - 4);
    picker.style.left = left + 'px';
    picker.style.top = top + 'px';
}

function closePeopleMentionPicker() {
    if (!_mp.open) return;
    _mp.open = false;
    _mp.ta = null;
    _mp.at = -1;
    _mp.query = '';
    _mp.items = [];
    _mp.active = 0;
    const picker = document.getElementById('people-mention-picker');
    if (picker) { picker.classList.add('hidden'); picker.innerHTML = ''; }
}

// 键盘钩子：候选打开时接管 ↑/↓/Enter/Tab/Esc；返回 true 表示已消费
function peopleMentionKeydownHook(e, ta) {
    if (!_mp.open || _mp.ta !== ta) return false;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        _mp.active = (_mp.active + 1) % _mp.items.length;
        _mpRender();
        return true;
    }
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        _mp.active = (_mp.active - 1 + _mp.items.length) % _mp.items.length;
        _mpRender();
        return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        _mpSelect(_mp.active);
        return true;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        closePeopleMentionPicker(); // Esc 仅关面板，已输入的 @查询 文本保留
        return true;
    }
    return false;
}

function _mpSelect(idx) {
    const item = _mp.items[idx];
    const ta = _mp.ta;
    const at = _mp.at;
    if (!item || !ta || at < 0) { closePeopleMentionPicker(); return; }
    let person;
    if (item.type === 'create') {
        person = createPersonRecord(item.name);
        if (!person) {
            showToast('已存在同名联系人：' + item.name, 'warning');
            closePeopleMentionPicker();
            return;
        }
        showToast('已创建联系人：' + person.name, 'success');
    } else {
        person = item.person;
    }
    person.lastUsedAt = Date.now();
    const caret = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const insert = '@' + person.name + ' ';
    ta.value = ta.value.slice(0, at) + insert + ta.value.slice(caret);
    const pos = at + insert.length;
    ta.setSelectionRange(pos, pos);
    closePeopleMentionPicker();
    // 派发 input 走各自同步链（行级编辑器 _mdUpdateActiveSource / 原始 textarea 自动保存）
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    saveData();
}

// Markdown 关闭时的原始 textarea（描述/备注）绑定同一套钩子
function bindPeopleRawTextarea(ta) {
    if (!ta || ta._peopleBound) return;
    ta._peopleBound = true;
    ta.addEventListener('input', function () { peopleMentionInputHook(ta); });
    ta.addEventListener('keydown', function (e) {
        if (e.isComposing) return;
        peopleMentionKeydownHook(e, ta);
    });
    ta.addEventListener('blur', function () { closePeopleMentionPicker(); });
    ta.addEventListener('compositionend', function () { peopleMentionInputHook(ta); });
}

/* ==================== FR-04 成员浮层卡片 ==================== */

let _personCardId = null;
let _personCardAnchor = null; // 记住锚点：卡片内操作后就地刷新不跳位

function openPersonCard(personId, anchorEl) {
    const person = getPersonById(personId);
    const card = document.getElementById('person-card');
    if (!person || !card) return;
    _personCardId = personId;
    if (anchorEl) _personCardAnchor = anchorEl;

    const related = tasks.filter(function (t) {
        return !t.deletedAt && (t.peopleIds || []).indexOf(personId) !== -1;
    });
    related.sort(function (a, b) {
        const ca = a.completed ? 1 : 0, cb = b.completed ? 1 : 0;
        if (ca !== cb) return ca - cb;
        const ta = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const tb = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        return ta - tb;
    });
    const shown = related.slice(0, 8);

    let html = '<div class="flex items-start gap-3 mb-1">' +
        renderPersonAvatarHtml(person, 'w-10 h-10', 'text-sm') +
            '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center gap-2 min-w-0">' +
                '<span class="font-semibold text-theme-primary truncate">' + escapeHtml(person.name) + '</span>' +
                (person.archived ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-theme-tertiary text-theme-muted flex-shrink-0">已归档</span>' : '') +
            '</div>' +
            _personMentionLineHtml(person, false) +
        '</div>' +
        '<div class="flex items-center gap-0.5 flex-shrink-0">' +
            '<button type="button" onclick="editPersonFromCard(\'' + personId + '\')" class="w-7 h-7 rounded-lg flex items-center justify-center text-theme-muted hover:bg-theme-tertiary transition"><i class="fas fa-pen text-xs"></i></button>' +
            '<button type="button" onclick="closePersonCard()" class="w-7 h-7 rounded-lg flex items-center justify-center text-theme-muted hover:bg-theme-tertiary transition"><i class="fas fa-xmark text-xs"></i></button>' +
        '</div>' +
    '</div>';

    html += _personInfoRowsHtml(person, 'popover');

    // 「相关任务 N」本身就是筛选入口（原「查看更多」已并入），N 直接写数值、不加括号
    const relatedLabel = related.length
        ? '<button type="button" class="person-related-label" onclick="togglePersonFilter(\'' + personId + '\')">相关任务 ' + related.length + '</button>'
        : '<span class="person-related-label person-related-empty">相关任务 0</span>';
    html += '<div class="mt-3 pt-2 person-card-foot">' +
        '<div class="mb-1.5">' + relatedLabel + '</div>';
    if (!shown.length) {
        html += '<div class="text-xs text-theme-muted py-2">暂无任务提及该联系人</div>';
    } else {
        shown.forEach(function (t) {
            const overdue = !t.completed && isTaskOverdue(t);
            const timeText = formatTaskTimeLabel(t);
            html += '<div onclick="openPersonCardTask(\'' + t.id + '\')" class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-theme-tertiary transition cursor-pointer">' +
                '<span class="flex-1 min-w-0 truncate text-sm ' + (t.completed ? 'line-through text-theme-muted' : 'text-theme-primary') + '">' + escapeHtml(t.title || '(无标题)') + '</span>' +
                (overdue ? '<span class="text-[10px] ' + OVERDUE_TEXT_CLASS + ' flex-shrink-0">已逾期</span>' : '') +
                (timeText ? '<span class="text-[10px] ' + (overdue ? OVERDUE_TEXT_CLASS : 'text-theme-muted') + ' flex-shrink-0">' + escapeHtml(timeText) + '</span>' : '') +
            '</div>';
        });
        if (related.length > shown.length) {
            html += '<div class="text-[10px] text-theme-muted px-2 pt-1">还有 ' + (related.length - shown.length) + ' 个未显示</div>';
        }
    }
    html += '</div>';

    // FR-08 / FR-10 底部操作区：「标记等待」与「新建关联任务」同行左右两按钮
    // （等待按钮仅从任务正文打开且任务未完成时出现；无等待按钮时新建任务占满整行）
    const ctxTask = (typeof currentDetailTaskId !== 'undefined' && currentDetailTaskId)
        ? tasks.find(function (t) { return t.id === currentDetailTaskId && !t.deletedAt; })
        : null;
    const ctxValid = !!(ctxTask && (ctxTask.peopleIds || []).indexOf(personId) !== -1);
    html += '<div class="mt-2 pt-2 person-card-foot flex gap-1.5">';
    if (person.archived) {
        html += '<div class="text-xs text-theme-muted px-1">已归档联系人仅供查看，不能标记等待或新建任务</div>';
    } else {
        const canWait = ctxValid && !ctxTask.completed;
        if (canWait) {
            const waiting = (ctxTask.waitingForIds || []).indexOf(personId) !== -1;
            html += '<button type="button" onclick="toggleWaitingForPerson(\'' + ctxTask.id + '\',\'' + personId + '\')" class="flex-1 min-w-0 px-2 py-1.5 rounded-lg border text-sm transition flex items-center justify-center gap-2 ' + (waiting ? 'border-accent text-accent' : 'border-theme text-theme-secondary hover:bg-theme-tertiary') + '"><i class="fas fa-hourglass-half text-xs"></i>' + (waiting ? '取消等待' : '标记等待') + '</button>';
        }
        html += '<button type="button" onclick="createTaskForPerson(\'' + personId + '\')" class="' + (canWait ? 'flex-1 min-w-0 ' : 'w-full ') + 'px-2 py-1.5 rounded-lg border border-theme text-sm text-theme-secondary hover:bg-theme-tertiary transition flex items-center justify-center gap-2"><i class="fas fa-plus text-xs"></i>新建关联任务</button>';
    }
    html += '</div>';

    card.innerHTML = html;
    card.classList.remove('hidden');
    // 定位：锚点下方优先，越界翻转/夹取
    const w = card.offsetWidth || 300;
    const h = card.offsetHeight || 200;
    let left = 8, top = 8;
    const anchor = anchorEl || _personCardAnchor;
    if (anchor && anchor.getBoundingClientRect) {
        const r = anchor.getBoundingClientRect();
        left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
        top = r.bottom + 6;
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    }
    card.style.left = left + 'px';
    card.style.top = top + 'px';
}

function closePersonCard() {
    if (!_personCardId) return;
    _personCardId = null;
    _personCardAnchor = null;
    const card = document.getElementById('person-card');
    if (card) { card.classList.add('hidden'); card.innerHTML = ''; }
}

// FR-08：切换当前任务对某联系人的等待标记（waitingForIds ⊆ peopleIds，由重算入口统一裁剪）
function toggleWaitingForPerson(taskId, personId) {
    const task = tasks.find(function (t) { return t.id === taskId; });
    const person = getPersonById(personId);
    if (!task || !person || task.completed || task.deletedAt || person.archived) return;
    if ((task.peopleIds || []).indexOf(personId) === -1) return;
    if (!Array.isArray(task.waitingForIds)) task.waitingForIds = [];
    const idx = task.waitingForIds.indexOf(personId);
    if (idx !== -1) task.waitingForIds.splice(idx, 1);
    else task.waitingForIds.push(personId);
    saveData();
    openPersonCard(personId); // 就地刷新按钮态（锚点已记住）
    // 详情渲染态提及的沙漏同步：仅在无活动编辑块时重渲染，避免打断正在输入的内容
    if (typeof _mdRenderAll === 'function' && typeof _mdEditor !== 'undefined'
        && _mdEditor.target && !_mdEditor.activeTextarea) {
        _mdRenderAll();
        // 重渲染会重建提及节点：把锚点换成新节点，避免后续就地刷新时定位失效
        const fresh = document.querySelector('#task-detail-panel .md-mention[data-person-id="' + personId + '"]');
        if (fresh) _personCardAnchor = fresh;
    }
    if (currentWaitingFilter) renderView();
    // 侧边栏「我在等谁」入口的计数/显隐随等待标记变化即时刷新
    if (typeof renderFilters === 'function') renderFilters();
}

// FR-10：新建关联任务——关闭卡片，命令面板建任务模式预置描述提及
function createTaskForPerson(personId) {
    const person = getPersonById(personId);
    if (!person || person.archived) return;
    closePersonCard();
    if (typeof openCommandPaletteWithMention === 'function') openCommandPaletteWithMention(personId);
}

// 浮层卡片里的编辑入口：跳到联系人页并就地展开该联系人的编辑表单
function editPersonFromCard(personId) {
    const person = getPersonById(personId);
    if (!person) return;
    closePersonCard();
    if (typeof closePeopleMentionPicker === 'function') closePeopleMentionPicker();
    switchToPeoplePage('task');
    // switchToPeoplePage 会清空编辑态，故在其之后设置
    _peopleMeasureAnchor(personId);
    peopleEditing = { id: personId };
    _releasePendingAvatar();
    peoplePendingColor = '';
    renderPeopleList();
    setTimeout(function () {
        const form = document.getElementById('people-edit-form');
        if (form && form.scrollIntoView) form.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
}

function openPersonCardTask(taskId) {
    closePersonCard();
    if (typeof openTaskDetailPanel === 'function') openTaskDetailPanel(taskId);
}

// 字段取值：email / phone:<index> / jobTitle / company / deviceAccount(历史) / note / 自定义项 cf:<index>
function _personFieldValue(person, key) {
    if (!person) return '';
    if (key === 'email') return String(person.email || '');
    if (key === 'deviceAccount') return String(person.deviceAccount || '');
    if (key === 'jobTitle') return String(person.jobTitle || '');
    if (key === 'company') return String(person.company || '');
    if (key === 'birthday') return String(person.birthday || '');
    if (key === 'note') return String(person.note || '');
    const pm = /^phone:(\d+)$/.exec(String(key || ''));
    if (pm) {
        const phones = Array.isArray(person.phones) ? person.phones : [];
        return String(phones[parseInt(pm[1], 10)] || '');
    }
    const m = /^cf:(\d+)$/.exec(String(key || ''));
    if (m) {
        const f = (Array.isArray(person.customFields) ? person.customFields : [])[parseInt(m[1], 10)];
        return f ? String(f.value || '') : '';
    }
    return '';
}

async function copyPersonField(personId, field) {
    const person = getPersonById(personId);
    if (!person) return;
    const value = _personFieldValue(person, field);
    if (!value) return;
    const ok = await copyTextToClipboard(value);
    showToast(ok ? '已复制' : '复制失败，请手动复制', ok ? 'success' : 'warning');
}

/* ==================== FR-05 人员快捷筛选 ==================== */

// 「退出筛选」返回原界面：激活筛选时记录当时的视图与右侧详情栏状态，退出时恢复。
// 快照只在激活时写入；被其它互斥操作（选清单/标签等）清掉筛选后即使残留也无副作用——下次激活会覆盖。
let _personFilterReturn = null;
let _waitingFilterReturn = null;
// 联系人筛选来源标记：侧边栏单击激活时不显示顶部「正在筛选」提示条
// （侧边栏按钮自身的高亮即筛选状态指示，再点一次退出并返回原界面）；
// 卡片计数 / 浮层「相关任务」激活时仍显示提示条，提供显式「退出筛选」入口。
let _personFilterFromSidebar = false;

function _captureFilterReturn() {
    const detailOpen = !!(typeof currentDetailTaskId !== 'undefined' && currentDetailTaskId
        && typeof isDetailPanelShowingTask === 'function' && isDetailPanelShowingTask(currentDetailTaskId));
    return {
        view: (typeof currentView !== 'undefined') ? currentView : 'task',
        detailTaskId: detailOpen ? currentDetailTaskId : null
    };
}

// 恢复单击筛选时的界面：视图不同则切回（switchView 会先收起详情栏），随后重开原详情栏任务。
function _restoreFilterReturn(snap) {
    if (!snap) return;
    const targetView = snap.view || 'task';
    if (typeof currentView !== 'undefined' && currentView !== targetView) {
        switchView(targetView);
    }
    if (snap.detailTaskId && typeof openTaskDetailPanel === 'function') {
        const t = tasks.find(function (x) { return x.id === snap.detailTaskId && !x.deletedAt; });
        if (t) openTaskDetailPanel(snap.detailTaskId);
    }
}

function togglePersonFilter(personId, fromSidebar) {
    const person = getPersonById(personId);
    if (!person) return;
    closePersonCard();
    if (currentPersonId === personId) { clearPersonFilter(); return; }
    _personFilterReturn = _captureFilterReturn();
    _personFilterFromSidebar = !!fromSidebar;
    if (typeof clearUndoStack === 'function') clearUndoStack();
    currentPersonId = personId;
    currentWaitingFilter = false; // 与「我在等谁」互斥
    _waitingFilterReturn = null;
    currentListId = null;
    currentFilter = null;
    currentTagIds = [];
    currentFilterId = null;
    _saveFilterState();
    if (currentView === 'people' || VIEW_ORDER_DEFAULT.indexOf(currentView) === -1) {
        switchView('task');
    } else {
        renderView();
        renderLists();
        renderTags();
        updateSidebarHighlight();
    }
}

function clearPersonFilter() {
    if (!currentPersonId) return;
    currentPersonId = null;
    _personFilterFromSidebar = false;
    _saveFilterState();
    const snap = _personFilterReturn;
    _personFilterReturn = null;
    renderView();
    renderLists();
    updateSidebarHighlight();
    _restoreFilterReturn(snap);
}

// FR-08「我在等谁」快捷筛选：未完成且 waitingForIds 非空；与联系人快捷筛选互斥
function toggleWaitingFilter() {
    closePersonCard();
    if (currentWaitingFilter) { clearWaitingFilter(); return; }
    _waitingFilterReturn = _captureFilterReturn();
    if (typeof clearUndoStack === 'function') clearUndoStack();
    currentWaitingFilter = true;
    currentPersonId = null;
    _personFilterReturn = null;
    currentListId = null;
    currentFilter = null;
    currentTagIds = [];
    currentFilterId = null;
    _saveFilterState();
    if (currentView === 'people' || VIEW_ORDER_DEFAULT.indexOf(currentView) === -1) {
        switchView('task');
    } else {
        renderView();
        renderLists();
        renderTags();
        updateSidebarHighlight();
    }
}

function clearWaitingFilter() {
    if (!currentWaitingFilter) return;
    currentWaitingFilter = false;
    _saveFilterState();
    const snap = _waitingFilterReturn;
    _waitingFilterReturn = null;
    renderView();
    renderLists();
    updateSidebarHighlight();
    _restoreFilterReturn(snap);
}

// 导航类操作（选清单/标签/过滤器/时间项/全部任务/回收站等）静默退出等待筛选：
// 不恢复快照、不重绘（由调用方统一渲染），与 currentPersonId 的清除时机保持一致，
// 保证侧边栏快捷筛选都是「单选互斥、导航即退出」的统一语义。
function _clearWaitingFilterSilent() {
    currentWaitingFilter = false;
    _waitingFilterReturn = null;
}

// 顶部筛选提示条：renderView 每次重绘时同步。
// 仅服务于卡片计数 / 浮层「相关任务」发起的联系人筛选（提供显式「退出筛选」入口）；
// 侧边栏单击发起的筛选不显示（侧边栏按钮高亮即状态指示）。「我在等谁」入口已移至侧边栏过滤器分组顶部。
function updatePersonFilterBar() {
    const bar = document.getElementById('person-filter-bar');
    if (!bar) return;
    const person = currentPersonId ? getPersonById(currentPersonId) : null;
    if (person && !_personFilterFromSidebar) {
        bar.innerHTML =
            renderPersonAvatarHtml(person, 'w-5 h-5', 'text-[10px]') +
            '<span class="text-sm text-theme-primary">正在筛选：<span class="text-accent font-medium">@' + escapeHtml(person.name) + '</span> 的相关任务</span>' +
            '<button onclick="clearPersonFilter()" class="ml-1 px-2.5 h-6 rounded-full flex items-center justify-center text-xs text-theme-muted hover:bg-theme-tertiary hover:text-accent transition whitespace-nowrap" title="退出筛选并返回原界面">退出筛选</button>';
        bar.classList.remove('hidden');
        return;
    }
    bar.classList.add('hidden');
    bar.innerHTML = '';
}

/* ==================== FR-09 联系人合并 ==================== */

let _personMergeSourceId = null;
let _personMergeAnchor = null;
let _personMergeQuery = '';

// 目标选择气泡：与新建选组气泡同范式（动态节点、锚点定位、点外关闭）
function openPersonMergePicker(sourceId, anchorBtn) {
    closePersonMergePicker();
    const source = getPersonById(sourceId);
    if (!source) return;
    if (!(settings.people || []).some(function (p) { return p.id !== sourceId; })) {
        showToast('没有其他联系人可合并', 'info');
        return;
    }
    _personMergeSourceId = sourceId;
    _personMergeAnchor = anchorBtn || null;
    _personMergeQuery = '';
    renderPersonMergePicker();
    setTimeout(function () {
        document.addEventListener('pointerdown', _personMergeOutside, true);
    }, 0);
}

function closePersonMergePicker() {
    const el = document.getElementById('person-merge-popover');
    if (el) el.remove();
    _personMergeSourceId = null;
    _personMergeAnchor = null;
    document.removeEventListener('pointerdown', _personMergeOutside, true);
}

function _personMergeOutside(e) {
    const pop = document.getElementById('person-merge-popover');
    if (pop && pop.contains(e.target)) return;
    if (_personMergeAnchor && _personMergeAnchor.contains && _personMergeAnchor.contains(e.target)) return;
    closePersonMergePicker();
}

function onPersonMergeSearch(value) {
    _personMergeQuery = String(value == null ? '' : value);
    renderPersonMergePicker();
}

function renderPersonMergePicker() {
    const old = document.getElementById('person-merge-popover');
    if (old) old.remove();
    if (!_personMergeSourceId) return;
    const source = getPersonById(_personMergeSourceId);
    if (!source) { closePersonMergePicker(); return; }
    const candidates = (settings.people || []).filter(function (p) {
        return p.id !== source.id && _personMatchesSearch(p, _personMergeQuery);
    });
    candidates.sort(function (a, b) { return comparePersonNamesByPinyin(a.name, b.name); });
    const pop = document.createElement('div');
    pop.id = 'person-merge-popover';
    pop.className = 'fixed z-50 bg-theme-secondary border border-theme rounded-xl shadow-xl py-1.5 px-1.5';
    pop.style.width = '240px';
    pop.innerHTML = '<div class="px-2 py-1 text-[11px] text-theme-muted truncate">将「' + escapeHtml(source.name) + '」合并到…</div>' +
        '<div class="relative">' +
            '<input id="person-merge-search" type="text" value="' + escapeHtml(_personMergeQuery) + '" placeholder="搜索姓名 / 别名 / 拼音首字母…" autocomplete="off" ' +
                'oninput="onPersonMergeSearch(this.value);_syncSearchClearBtn(this)" ' +
                'class="w-full px-2 py-1.5 pr-8 mb-1 border border-theme rounded-lg bg-theme-primary text-theme-primary text-sm focus:outline-none focus:border-accent">' +
            searchClearBtnHtml('person-merge-search') +
        '</div>' +
        '<div class="overflow-y-auto" style="max-height:40vh">' +
            (candidates.length
                ? candidates.map(function (p) {
                    return '<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-theme-tertiary transition cursor-pointer" onclick="choosePersonMergeTarget(\'' + p.id + '\')">' +
                        renderPersonAvatarHtml(p, 'w-6 h-6', 'text-[10px]') +
                        '<span class="flex-1 min-w-0 truncate text-sm text-theme-primary">' + escapeHtml(p.name) + '</span>' +
                        '<span class="text-[10px] text-theme-muted flex-shrink-0" title="提及该联系人的任务数">' + countPersonMentions(p.id) + ' 个提及</span>' +
                        (p.archived ? '<span class="text-[10px] text-theme-muted flex-shrink-0">已归档</span>' : '') +
                    '</div>';
                }).join('')
                : '<div class="px-2 py-3 text-xs text-theme-muted text-center">没有匹配的联系人</div>') +
        '</div>';
    document.body.appendChild(pop);
    const r = _personMergeAnchor ? _personMergeAnchor.getBoundingClientRect() : null;
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
    const search = document.getElementById('person-merge-search');
    _syncSearchClearBtn(search);
    if (search) {
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
    }
}

function choosePersonMergeTarget(targetId) {
    const sourceId = _personMergeSourceId;
    closePersonMergePicker();
    const source = getPersonById(sourceId);
    const target = getPersonById(targetId);
    if (!source || !target || source.id === target.id) return;
    const affected = countPersonMentions(sourceId);
    const src = escapeHtml(source.name);
    const tgt = escapeHtml(target.name);
    showConfirmToast(
        '确定将 @' + src + ' 合并到 @' + tgt + ' 中吗？<br>' +
        affected + ' 个提及到 @' + src + ' 的任务相关信息将改写为 @' + tgt + '。<br>' +
        '此操作不可撤销。',
        function () { _doMergePerson(sourceId, targetId); },
        null,
        { confirmLabel: '合并', cancelLabel: '取消', html: true }
    );
}

function _doMergePerson(sourceId, targetId) {
    const source = getPersonById(sourceId);
    const target = getPersonById(targetId);
    if (!source || !target || sourceId === targetId) return;
    // 等待标记先 remap：正文改写内部会重算 peopleIds 并按子集裁剪 waitingForIds，
    // 若后 remap，源 id 会在重算时被视为非法而丢失
    tasks.forEach(function (t) {
        if (!Array.isArray(t.waitingForIds) || t.waitingForIds.indexOf(sourceId) === -1) return;
        const next = [];
        t.waitingForIds.forEach(function (id) {
            const mapped = id === sourceId ? targetId : id;
            if (next.indexOf(mapped) === -1) next.push(mapped);
        });
        t.waitingForIds = next;
    });
    // 正文改写（跳过代码区）+ peopleIds 重算，与改名共用同一套定位规则
    const affected = rewritePersonMentionsInTasks(getPersonAllNames(source), target.name);
    // FR-11：目标未关联倒计时时继承源的（元数据不自动合并，仅引用继承）
    if (!target.countdownId && source.countdownId) {
        const cd = getPersonCountdown(source);
        if (cd) target.countdownId = cd.id;
    }
    // 删除源条目与头像文件（正文已改写，无降级文本残留）
    if (/^\/api\/people-avatar\//.test(String(source.avatar || ''))) deletePersonAvatarFile(sourceId);
    settings.people = settings.people.filter(function (p) { return p.id !== sourceId; });
    tasks.forEach(function (t) {
        if (Array.isArray(t.peopleIds) && t.peopleIds.indexOf(sourceId) !== -1) {
            t.peopleIds = t.peopleIds.filter(function (pid) { return pid !== sourceId; });
        }
        if (Array.isArray(t.waitingForIds) && t.waitingForIds.indexOf(sourceId) !== -1) {
            t.waitingForIds = t.waitingForIds.filter(function (pid) { return pid !== sourceId; });
        }
    });
    // 正在筛选源联系人时改指向目标，保持筛选连续性
    if (currentPersonId === sourceId) {
        currentPersonId = targetId;
        _saveFilterState();
    }
    target.updatedAt = Date.now();
    saveData();
    renderPeopleList();
    if (currentPersonId === targetId) renderView();
    showToast('已合并：' + source.name + ' → ' + target.name + '（' + affected + ' 个任务的提及已改写），可到目标联系人资料中补充信息', 'success');
}

/* ==================== 联系人字段配置（新建表单预置项目） ==================== */

// 模板：新建联系人时按顺序预置的自定义项目行；编辑已有联系人不做补齐
function getPeopleFieldTemplate() {
    if (!Array.isArray(settings.peopleFieldTemplate)) settings.peopleFieldTemplate = [];
    return settings.peopleFieldTemplate;
}

function renderPeopleFieldTemplateList() {
    const wrap = document.getElementById('people-field-template-list');
    if (!wrap) return;
    const list = getPeopleFieldTemplate();
    _syncPeopleFieldChips();
    if (!list.length) {
        wrap.innerHTML = '<div class="px-2 py-5 text-center text-xs text-theme-muted leading-relaxed">还没有可选项目。<br>新建联系人时默认只有姓名、别名、备注。</div>';
        return;
    }
    // 行样式与「列表分组」自定义分组行（groupManagerRowsHtml/group-cfg-row）统一：
    // 透明底 + 行 hover；操作钮 w-8 h-8 tone-outline-* 描边，上/下移箭头 + 删除 trash 图标；
    // 删除二次确认与分组行同款：首次点击变红色实底（tone-solid-red），3 秒未确认自动复原
    const btnCls = 'people-field-row-btn';
    const sortCls = btnCls + ' tone-outline-sky';
    wrap.innerHTML = list.map(function (f, i) {
        const isBuiltin = !!f.builtin;
        const confirming = _peopleFieldDelConfirmIdx === i;
        const delCls = btnCls + (confirming ? ' tone-solid-red' : ' tone-outline-red');
        const nameCell = isBuiltin
            ? '<span class="people-field-row-fixed">' + escapeHtml(f.label) +
                  '<span class="people-field-row-tag">内置</span></span>'
            : '<input type="text" class="people-field-row-label" value="' + escapeHtml(f.label) + '" maxlength="24" autocomplete="off" placeholder="项目名称" ' +
                  'onchange="renamePeopleFieldTemplate(' + i + ', this.value)" title="可直接改名（不影响已有联系人）">';
        return '<div class="people-field-row">' +
            nameCell +
            '<button type="button" onclick="movePeopleFieldTemplate(' + i + ',-1)" class="' + sortCls + '" title="上移"' + (i === 0 ? ' disabled' : '') + '><i class="fas fa-arrow-up text-sm"></i></button>' +
            '<button type="button" onclick="movePeopleFieldTemplate(' + i + ',1)" class="' + sortCls + '" title="下移"' + (i === list.length - 1 ? ' disabled' : '') + '><i class="fas fa-arrow-down text-sm"></i></button>' +
            '<button type="button" onclick="requestDeletePeopleField(' + i + ')" class="' + delCls + '" title="' + (confirming ? '确认删除' : (isBuiltin ? '从表单移除（已有内容保留）' : '删除（已有联系人里的内容保留）')) + '"><i class="fas fa-trash text-sm"></i></button>' +
        '</div>';
    }).join('');
}

// 内置项目开关（邮箱 / 设备账号）：在配置面板顶部以芯片形式一键加/减
function _syncPeopleFieldChips() {
    const list = getPeopleFieldTemplate();
    ['email', 'phone', 'title', 'company', 'staffNo', 'birthday'].forEach(function (kind) {
        const btn = document.getElementById('people-field-chip-' + kind);
        if (!btn) return;
        const on = list.some(function (f) { return f.builtin === kind; });
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

function togglePeopleFieldBuiltin(kind) {
    const meta = PERSON_BUILTIN_FIELDS[kind];
    if (!meta) return;
    const list = getPeopleFieldTemplate();
    const idx = list.findIndex(function (f) { return f.builtin === kind; });
    if (idx >= 0) {
        list.splice(idx, 1);
        showToast('已从表单移除：' + meta.label + '（已有内容保留）', 'success');
    } else {
        if (list.length >= 20) { showToast('最多设置 20 个项目', 'warning'); return; }
        list.push({ id: 'pf_builtin_' + kind, label: meta.label, builtin: kind });
        showToast('已加入表单：' + meta.label, 'success');
    }
    saveData();
    renderPeopleFieldTemplateList();
}

// 分组区（静态结构在双 HTML 的 peopleFieldConfigPanel 内）：同步依据下拉 + 内嵌分组管理
function renderPeopleFieldConfigExtras() {
    const sel = document.getElementById('people-group-mode-select');
    if (sel) sel.value = (typeof getPeopleGroupMode === 'function') ? getPeopleGroupMode() : 'custom';
    if (typeof renderPeopleGroupInline === 'function') renderPeopleGroupInline();
}

function onPeopleGroupModeChange() {
    const sel = document.getElementById('people-group-mode-select');
    if (!sel || typeof setPeopleGroupMode !== 'function') return;
    if (typeof finalizeGroupRename === 'function') finalizeGroupRename(); // 切走前先落定进行中的命名
    setPeopleGroupMode(sel.value);
}

function openPeopleFieldConfig() {
    renderPeopleFieldTemplateList();
    _syncPeopleFieldChips();
    renderPeopleFieldConfigExtras();
    // 关闭面板（点外部/Esc/切视图）时落定进行中的分组命名
    if (typeof openViewConfigPanel === 'function') openViewConfigPanel('peopleField', finalizeGroupRename);
}

function closePeopleFieldConfig() {
    if (typeof closeViewConfigPanel === 'function') closeViewConfigPanel('peopleField');
}

function togglePeopleFieldConfig() {
    const st = (typeof _viewConfigPanels !== 'undefined') ? _viewConfigPanels['peopleField'] : null;
    if (st && st.open) closePeopleFieldConfig();
    else openPeopleFieldConfig();
}

function _peopleFieldLabelExists(label, exceptIdx) {
    const key = String(label || '').trim().toLowerCase();
    return getPeopleFieldTemplate().some(function (f, i) {
        return i !== exceptIdx && String(f.label || '').toLowerCase() === key;
    });
}

// 「新建项目」：直接在模板末尾追加一条自定义项目，行内键入名称即可（原“输入框 + 添加”行已并入此按钮）
function addPeopleFieldTemplate() {
    const list = getPeopleFieldTemplate();
    if (list.length >= 20) { showToast('最多设置 20 个项目', 'warning'); return; }
    _resetPeopleFieldDelConfirm();
    list.push({ id: generateId(), label: '' });
    saveData();
    renderPeopleFieldTemplateList();
    const wrap = document.getElementById('people-field-template-list');
    const rows = wrap ? wrap.querySelectorAll('.people-field-row-label') : [];
    const last = rows[rows.length - 1];
    if (last) last.focus();
}

function renamePeopleFieldTemplate(idx, value) {
    const list = getPeopleFieldTemplate();
    if (!list[idx] || list[idx].builtin) return;
    const label = String(value || '').trim().slice(0, 24);
    if (!label) { renderPeopleFieldTemplateList(); return; }
    if (_peopleFieldLabelExists(label, idx)) {
        showToast('已有同名项目：' + label, 'warning');
        renderPeopleFieldTemplateList();
        return;
    }
    list[idx].label = label;
    saveData();
    renderPeopleFieldTemplateList();
}

function movePeopleFieldTemplate(idx, delta) {
    const list = getPeopleFieldTemplate();
    const to = idx + delta;
    if (!list[idx] || to < 0 || to >= list.length) return;
    _resetPeopleFieldDelConfirm();
    const tmp = list[idx];
    list[idx] = list[to];
    list[to] = tmp;
    saveData();
    renderPeopleFieldTemplateList();
}

// 删除二次确认（与分组行 requestDeleteGroup 同款）：首次点击仅置确认态（红色实底 + 3 秒超时复原），再点才真删
let _peopleFieldDelConfirmIdx = null;
let _peopleFieldDelTimer = null;

function _resetPeopleFieldDelConfirm() {
    _peopleFieldDelConfirmIdx = null;
    if (_peopleFieldDelTimer) { clearTimeout(_peopleFieldDelTimer); _peopleFieldDelTimer = null; }
}

function requestDeletePeopleField(idx) {
    const list = getPeopleFieldTemplate();
    if (!list[idx]) { _resetPeopleFieldDelConfirm(); renderPeopleFieldTemplateList(); return; }
    if (_peopleFieldDelConfirmIdx === idx) { confirmDeletePeopleField(idx); return; }
    _resetPeopleFieldDelConfirm();
    _peopleFieldDelConfirmIdx = idx;
    _peopleFieldDelTimer = setTimeout(function () {
        _peopleFieldDelConfirmIdx = null;
        _peopleFieldDelTimer = null;
        renderPeopleFieldTemplateList();
    }, 3000);
    renderPeopleFieldTemplateList();
}

function confirmDeletePeopleField(idx) {
    _resetPeopleFieldDelConfirm();
    removePeopleFieldTemplate(idx);
}

function removePeopleFieldTemplate(idx) {
    const list = getPeopleFieldTemplate();
    if (!list[idx]) return;
    const removed = list[idx];
    list.splice(idx, 1);
    saveData();
    renderPeopleFieldTemplateList();
    const isBuiltin = !!removed.builtin;
    showToast((isBuiltin ? '已从表单移除：' : '已移除项目：') + removed.label + '（已有联系人里的内容保留）', 'success');
}

function clearPeopleFieldTemplate() {
    settings.peopleFieldTemplate = [];
    saveData();
    renderPeopleFieldTemplateList();
    showToast('已清空全部预置项目', 'success');
}

if (typeof _registerViewConfig === 'function') {
    _registerViewConfig('peopleField', 'peopleFieldConfigPanel', 'people-field-config-btn');
}

/* ==================== 联系人批量管理 ==================== */
// 多选 → 批量归档 / 取消归档 / 换组 / 删除（即时应用，删除二次确认）。
// 批量态下卡片简化为「勾选 + 概要」，整卡单击即选中，隐藏单卡操作按钮避免与选中冲突。
let peopleBatchMode = false;
let peopleBatchSelected = [];

function togglePeopleBatchMode() {
    peopleBatchMode = !peopleBatchMode;
    peopleBatchSelected = [];
    renderView();
}

function togglePeopleBatchSelect(id) {
    const i = peopleBatchSelected.indexOf(id);
    if (i === -1) peopleBatchSelected.push(id);
    else peopleBatchSelected.splice(i, 1);
    renderView();
}

function _renderPersonBatchCard(p) {
    const sel = peopleBatchSelected.indexOf(p.id) !== -1;
    const mentionCount = countPersonMentions(p.id);
    return '<div class="person-card-item person-batch-card cursor-pointer transition' + (sel ? ' person-card-filtered' : '') + (p.archived ? ' opacity-60' : '') + '" data-pid="' + p.id + '" onclick="togglePeopleBatchSelect(\'' + p.id + '\')">' +
        '<div class="flex items-start gap-2.5">' +
            '<span class="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition ' + (sel ? 'bg-accent border-accent text-white' : 'border-theme text-transparent') + '"><i class="fas fa-check text-[10px]"></i></span>' +
            renderPersonAvatarHtml(p, 'w-10 h-10', 'text-sm') +
            '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-2 min-w-0">' +
                    '<span class="text-sm font-semibold text-theme-primary truncate">' + escapeHtml(p.name) + '</span>' +
                    (p.archived ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-theme-tertiary text-theme-muted flex-shrink-0">已归档</span>' : '') +
                '</div>' +
                _personMentionLineHtml(p) +
            '</div>' +
        '</div>' +
        (mentionCount > 0
            ? '<div class="mt-auto pt-2 person-card-foot flex items-center justify-between gap-2">' +
                '<span class="text-xs text-theme-muted">' + mentionCount + ' 个关联任务</span>' +
              '</div>'
            : '') +
    '</div>';
}

function renderPeopleBatchBar() {
    if (!peopleBatchMode) return '';
    const n = peopleBatchSelected.length;
    const groupOpts = ['<option value="__pick__" selected disabled>换组到…</option>',
        '<option value="">' + escapeHtml(GROUP_DEFAULT_NAME) + '</option>']
        .concat(getGroupDefs('people').filter(function (g) { return g && g.id; }).map(function (g) {
            return '<option value="' + g.id + '">' + escapeHtml(g.name || '未命名分组') + '</option>';
        }));
    const btn = 'px-2.5 h-8 rounded-lg border border-theme text-sm text-theme-secondary hover:bg-theme-tertiary transition whitespace-nowrap';
    return '<div class="flex items-center gap-2 px-3 py-2 mx-4 mb-3 bg-theme-secondary border border-theme rounded-2xl shadow-theme flex-shrink-0 flex-wrap">' +
        '<span class="text-sm text-theme-primary font-medium flex-shrink-0">已选 ' + n + ' 项</span>' +
        '<div class="flex-1"></div>' +
        '<button type="button" onclick="peopleBatchArchive(true)" class="' + btn + '" title="归档所选">归档</button>' +
        '<button type="button" onclick="peopleBatchArchive(false)" class="' + btn + '" title="取消归档所选">取消归档</button>' +
        '<select id="people-batch-group" onchange="peopleBatchMoveGroup(this.value)" class="h-8 px-2 rounded-lg border border-theme bg-theme-secondary text-sm text-theme-secondary focus:outline-none focus:border-accent">' + groupOpts.join('') + '</select>' +
        '<button type="button" onclick="peopleBatchDelete()" class="px-2.5 h-8 rounded-lg border border-red-500 text-red-500 text-sm hover:bg-red-500 hover:text-white transition whitespace-nowrap">删除</button>' +
        '<button type="button" onclick="togglePeopleBatchMode()" class="' + btn + '">退出</button>' +
    '</div>';
}

function peopleBatchArchive(archived) {
    if (!peopleBatchSelected.length) { showToast('请先选择联系人', 'warning'); return; }
    const now = Date.now();
    let n = 0;
    peopleBatchSelected.forEach(function (id) {
        const p = getPersonById(id);
        if (p && p.archived !== archived) { p.archived = archived; p.updatedAt = now; n++; }
    });
    peopleBatchSelected = [];
    saveData();
    renderView();
    showToast((archived ? '已归档 ' : '已取消归档 ') + n + ' 个联系人', 'success');
}

function peopleBatchMoveGroup(gid) {
    if (gid === '__pick__') return;
    if (!peopleBatchSelected.length) { showToast('请先选择联系人', 'warning'); return; }
    const target = normalizeGroupId('people', gid || '');
    const now = Date.now();
    let n = 0;
    peopleBatchSelected.forEach(function (id) {
        const p = getPersonById(id);
        if (p && normalizeGroupId('people', p.groupId) !== target) { p.groupId = target; p.updatedAt = now; n++; }
    });
    peopleBatchSelected = [];
    saveData();
    renderView();
    showToast('已移动 ' + n + ' 个联系人到「' + (target ? (getGroupDefs('people').find(function (g) { return g.id === target; }) || {}).name || '未命名分组' : GROUP_DEFAULT_NAME) + '」', 'success');
}

function peopleBatchDelete() {
    if (!peopleBatchSelected.length) { showToast('请先选择联系人', 'warning'); return; }
    const ids = peopleBatchSelected.slice();
    showConfirmToast(
        '确定删除所选 ' + ids.length + ' 个联系人？正文中的提及将保留为普通文本。此操作不可撤销。',
        function () {
            ids.forEach(function (id) {
                const p = getPersonById(id);
                if (p && /^\/api\/people-avatar\//.test(String(p.avatar || ''))) deletePersonAvatarFile(id);
            });
            settings.people = (settings.people || []).filter(function (p) { return ids.indexOf(p.id) === -1; });
            tasks.forEach(function (t) {
                if (Array.isArray(t.peopleIds)) t.peopleIds = t.peopleIds.filter(function (pid) { return ids.indexOf(pid) === -1; });
                if (Array.isArray(t.waitingForIds)) t.waitingForIds = t.waitingForIds.filter(function (pid) { return ids.indexOf(pid) === -1; });
            });
            if (ids.indexOf(currentPersonId) !== -1) { currentPersonId = null; _saveFilterState(); }
            peopleBatchSelected = [];
            saveData();
            renderView();
            showToast('已删除 ' + ids.length + ' 个联系人', 'success');
        },
        null,
        { confirmLabel: '删除', cancelLabel: '取消' }
    );
}

/* ==================== 侧边栏「联系人」分组 ==================== */
// 与清单/标签平行的快捷筛选分组：仅列有 ≥1 条未删除相关任务的联系人（不含归档），
// 单击筛选该联系人的相关任务（togglePersonFilter，再点取消）。无相关任务者不出现，保持侧边栏精简。
function countPeopleWithTasks() {
    return (settings.people || []).filter(function (p) { return !p.archived && countPersonMentions(p.id) > 0; }).length;
}

function renderPeopleSidebar() {
    const section = document.getElementById('sidebar-people-section');
    const container = document.getElementById('sidebar-people-container');
    if (!section || !container) return;
    const people = (settings.people || []).filter(function (p) { return !p.archived && countPersonMentions(p.id) > 0; });
    people.sort(function (a, b) { return comparePersonNamesByPinyin(a.name, b.name); });
    container.innerHTML = '';
    people.forEach(function (p) {
        const n = countPersonMentions(p.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'sidebar-person-' + p.id;
        btn.className = 'w-full text-left px-3 py-1 rounded-lg hover:bg-theme-tertiary transition text-theme-primary flex items-center gap-2 sidebar-person-btn' + (currentPersonId === p.id ? ' sidebar-active' : '');
        btn.title = '筛选 @' + p.name + ' 的相关任务';
        btn.innerHTML = renderPersonAvatarHtml(p, 'w-4 h-4', 'text-[9px]') +
            '<span class="sidebar-text flex-1 min-w-0 truncate">' + escapeHtml(p.name) + '</span>' +
            '<span class="sidebar-count text-xs text-theme-muted">' + n + '</span>';
        btn.onclick = function () { togglePersonFilter(p.id, true); };
        container.appendChild(btn);
    });
    if (typeof applySectionCollapse === 'function') applySectionCollapse();
    if (typeof applySidebarItemsConfig === 'function') applySidebarItemsConfig();
}

/* ==================== 全局事件绑定（一次性） ==================== */

let _peopleBindingsDone = false;
function initPeopleBindings() {
    if (_peopleBindingsDone) return;
    _peopleBindingsDone = true;

    // 视口尺寸变化：悬浮编辑卡重新收敛到滚动区可视范围
    window.addEventListener('resize', _peopleScheduleFit);
    //  webfont 落定后行高可能变化：重新量取自然高度，避免表单被旧高度裁切
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(function () { _peopleScheduleFit(); });
    }
    // 图标字体等可能在表单渲染后才开始加载：每批字体落定都复量（fonts.ready 只兑现一次，不够）
    if (document.fonts && document.fonts.addEventListener) {
        document.fonts.addEventListener('loadingdone', function () { _peopleScheduleFit(); });
    }

    // 渲染态提及点击（编辑器内的提及由 markdown.js mousedown 分支处理；
    // 其余渲染场景——任务卡片详情预览、模板预览等——走这里的委托）
    document.addEventListener('click', function (e) {
        const mention = e.target.closest ? e.target.closest('.md-mention') : null;
        if (!mention) return;
        if (mention.closest('.md-block')) return; // 行级编辑器内部已处理
        e.preventDefault();
        openPersonCard(mention.dataset.personId, mention);
    });

    // 候选面板：mousedown 选择（preventDefault 保持 textarea 焦点，不触发落定）
    const picker = document.getElementById('people-mention-picker');
    if (picker) {
        picker.addEventListener('mousedown', function (e) {
            e.preventDefault();
            const row = e.target.closest('[data-mp-idx]');
            if (row) _mpSelect(parseInt(row.dataset.mpIdx, 10));
        });
    }

    // 编辑态：点卡片外区域 = 保存（与倒计时编辑卡的区域判定一致；用捕获阶段保证先于目标按钮自己的 onclick）
    document.addEventListener('click', function (e) {
        if (!peopleEditing || _peopleSaving) return;
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('#people-edit-form')) return;          // 卡片内：继续编辑
        if (t.closest('#peopleFieldConfigPanel')) return;    // 字段配置面板：不当作点外
        if (t.closest('#person-card')) return;               // 联系人浮层卡片
        if (t.closest('#people-mention-picker')) return;     // @ 候选面板
        if (t.closest('#group-drawer-mask')) return;          // 分组管理抽屉
        if (t.closest('#group-pick-popover')) return;         // 新建选组气泡
        if (t.closest('#person-merge-popover')) return;       // 合并目标选择气泡
        if (t.closest('#toast-container') || t.closest('.undo-toast')) return; // 通知条上的撤销等操作
        // 空白新建表单：视为放弃，静默收起（不弹「姓名不能为空」）
        if (peopleEditing.id === null && !_peopleFormHasName() && !_peopleFormHasContent()) {
            cancelPersonForm();
            return;
        }
        savePersonForm();
    }, true);

    // 卡片外部点击关闭（提及本身除外——点击另一个提及直接换卡片）
    document.addEventListener('pointerdown', function (e) {
        if (!_personCardId) return;
        const card = document.getElementById('person-card');
        if (card && card.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.md-mention')) return;
        closePersonCard();
    }, true);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && _personCardId) closePersonCard();
    });

    // 滚动时收起候选面板（fixed 定位不跟随滚动，避免悬空错位）
    document.addEventListener('scroll', function () {
        if (_mp.open) closePeopleMentionPicker();
    }, true);
}
initPeopleBindings();