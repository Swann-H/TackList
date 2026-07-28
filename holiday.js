// 节假日与调休管理页面逻辑

const STANDARD_FESTIVALS = ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'];

let holidayCurrentYear = new Date().getFullYear();
// 编辑状态: { groupKey, type, festival, isAdd } 或 null
let holidayEditing = null;
// 删除确认状态: { groupKey, type, festival } 或 null
let holidayDeleteConfirming = null;
let holidayDeleteTimer = null;

// 切换到节假日管理页面
function switchToHolidayPage() {
    closeSettingsModal();
    // 关闭任务详情栏（避免在节假日页面上显示）
    if (typeof closeTaskDetailPanel === 'function') closeTaskDetailPanel();
    document.getElementById('holiday-page').classList.remove('hidden');
    document.getElementById('sidebar-bottom-buttons').classList.add('hidden');
    document.getElementById('main-content').classList.add('hidden');
    holidayCurrentYear = new Date().getFullYear();
    holidayEditing = null;
    holidayDeleteConfirming = null;
    renderHolidayPage();
}

// 关闭管理页面
function closeHolidayPage() {
    document.getElementById('holiday-page').classList.add('hidden');
    document.getElementById('sidebar-bottom-buttons').classList.remove('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    closeHolidayYearPicker();
    closeHolidayCalendarPopup();
    if (typeof updateHolidayCountdown === 'function') updateHolidayCountdown();
    if (typeof renderView === 'function') renderView();
}

// 渲染整个页面
function renderHolidayPage() {
    updateHolidayYearDisplay();
    renderHolidayGroups();
}

// 更新年份显示
function updateHolidayYearDisplay() {
    const yearLabel = document.getElementById('holiday-year-label');
    if (yearLabel) yearLabel.textContent = holidayCurrentYear + ' 年';
}

// 年份导航
function navigateHolidayYear(direction) {
    const newYear = holidayCurrentYear + direction;
    if (newYear < 2020 || newYear > 2099) return;
    holidayCurrentYear = newYear;
    holidayEditing = null;
    holidayDeleteConfirming = null;
    closeHolidayYearPicker();
    updateHolidayYearDisplay();
    renderHolidayGroups();
}

// 当前显示的十年面板起始年
let holidayDecadeStart = Math.floor(holidayCurrentYear / 10) * 10;

// 打开/关闭年份选择面板（10年为单位）
function toggleHolidayYearPicker() {
    const existing = document.getElementById('holiday-year-picker');
    if (existing) {
        closeHolidayYearPicker();
        return;
    }
    holidayDecadeStart = Math.floor(holidayCurrentYear / 10) * 10;
    renderHolidayYearPicker();
}

// 渲染年份选择面板
function renderHolidayYearPicker() {
    // 移除旧面板和监听器（避免重复绑定）
    document.removeEventListener('click', closeHolidayYearPickerOnOutside);
    const existing = document.getElementById('holiday-year-picker');
    if (existing) existing.remove();

    const thisYear = new Date().getFullYear();
    const picker = document.createElement('div');
    picker.id = 'holiday-year-picker';
    picker.className = 'absolute top-full left-0 mt-2 z-50 bg-theme-secondary border border-theme rounded-lg shadow-lg p-3 min-w-[220px]';

    // "今年"按钮
    const thisYearBtn = document.createElement('button');
    thisYearBtn.className = 'w-full mb-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm font-medium';
    thisYearBtn.textContent = '今年（' + thisYear + '）';
    thisYearBtn.onclick = () => {
        holidayCurrentYear = thisYear;
        holidayEditing = null;
        holidayDeleteConfirming = null;
        closeHolidayYearPicker();
        updateHolidayYearDisplay();
        renderHolidayGroups();
    };
    picker.appendChild(thisYearBtn);

    // 十年范围导航
    const decadeNav = document.createElement('div');
    decadeNav.className = 'flex items-center justify-between mb-2 px-1';
    const decadeEnd = holidayDecadeStart + 9;
    decadeNav.innerHTML = `
        <button class="p-1 hover:bg-theme-tertiary rounded transition text-theme-secondary" title="上一个十年">
            <i class="fas fa-chevron-left text-xs"></i>
        </button>
        <span class="text-sm font-medium text-theme-primary">${holidayDecadeStart} - ${decadeEnd}</span>
        <button class="p-1 hover:bg-theme-tertiary rounded transition text-theme-secondary" title="下一个十年">
            <i class="fas fa-chevron-right text-xs"></i>
        </button>
    `;
    // 绑定十年导航按钮事件（阻止冒泡，避免触发外部点击关闭逻辑）
    const navBtns = decadeNav.querySelectorAll('button');
    navBtns[0].addEventListener('click', (e) => {
        e.stopPropagation();
        navigateHolidayDecade(-1);
    });
    navBtns[1].addEventListener('click', (e) => {
        e.stopPropagation();
        navigateHolidayDecade(1);
    });
    picker.appendChild(decadeNav);

    // 年份网格（2行5列）
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-5 gap-1';
    for (let y = holidayDecadeStart; y <= decadeEnd; y++) {
        const yearBtn = document.createElement('button');
        const isCurrent = y === holidayCurrentYear;
        const isDisabled = y < 2020 || y > 2099;
        yearBtn.className = `px-1 py-1.5 rounded text-xs transition ${isCurrent ? 'bg-blue-500 text-white font-medium' : isDisabled ? 'text-theme-muted cursor-not-allowed' : 'hover:bg-theme-tertiary text-theme-primary'}`;
        yearBtn.textContent = y;
        if (!isDisabled) {
            yearBtn.onclick = () => {
                holidayCurrentYear = y;
                holidayEditing = null;
                holidayDeleteConfirming = null;
                closeHolidayYearPicker();
                updateHolidayYearDisplay();
                renderHolidayGroups();
            };
        }
        grid.appendChild(yearBtn);
    }
    picker.appendChild(grid);

    // 定位到年份标签下方
    const label = document.getElementById('holiday-year-label');
    if (label) {
        label.appendChild(picker);
    }

    // 点击外部关闭
    setTimeout(() => {
        document.addEventListener('click', closeHolidayYearPickerOnOutside);
    }, 0);
}

// 切换十年
function navigateHolidayDecade(direction) {
    holidayDecadeStart += direction * 10;
    renderHolidayYearPicker();
}

// 点击外部关闭面板
function closeHolidayYearPickerOnOutside(e) {
    const picker = document.getElementById('holiday-year-picker');
    const label = document.getElementById('holiday-year-label');
    if (picker && !picker.contains(e.target) && e.target !== label) {
        closeHolidayYearPicker();
    }
}

// 关闭年份选择面板
function closeHolidayYearPicker() {
    const picker = document.getElementById('holiday-year-picker');
    if (picker) picker.remove();
    document.removeEventListener('click', closeHolidayYearPickerOnOutside);
}

// 获取指定年份的分组数据
// 返回: [{ name, isOther, sections: [{ festival, type, dates, ranges }] }]
function getHolidayGroups(year) {
    const yearStr = String(year);
    const yearData = holidayData[yearStr] || { holidays: {}, workdays: {} };
    const holidays = yearData.holidays || {};
    const workdays = yearData.workdays || {};

    // 收集所有条目，提取节日名
    // sectionsMap: key = festivalName, value = { holiday: [dates], work: [dates] }
    const sectionsMap = {};

    for (const [md, name] of Object.entries(holidays)) {
        if (!sectionsMap[name]) sectionsMap[name] = { holiday: [], work: [] };
        sectionsMap[name].holiday.push(md);
    }
    for (const [md, name] of Object.entries(workdays)) {
        // 调休日名称去掉"调休"后缀得到节日名
        const festival = name.endsWith('调休') ? name.slice(0, -2) : name;
        if (!sectionsMap[festival]) sectionsMap[festival] = { holiday: [], work: [] };
        sectionsMap[festival].work.push(md);
    }

    // 构建分组
    const standardGroups = [];
    const otherSections = [];

    for (const festival of STANDARD_FESTIVALS) {
        if (!sectionsMap[festival]) continue;
        const data = sectionsMap[festival];
        const sections = [];
        if (data.holiday.length > 0) {
            data.holiday.sort((a, b) => a.localeCompare(b));
            sections.push({ festival, type: 'holiday', dates: data.holiday, ranges: mergeConsecutiveDates(data.holiday) });
        }
        if (data.work.length > 0) {
            data.work.sort((a, b) => a.localeCompare(b));
            sections.push({ festival, type: 'work', dates: data.work, ranges: mergeConsecutiveDates(data.work) });
        }
        if (sections.length > 0) {
            standardGroups.push({ name: festival, isOther: false, sections });
        }
    }

    for (const [festival, data] of Object.entries(sectionsMap)) {
        if (STANDARD_FESTIVALS.includes(festival)) continue;
        // 非标准节日，放入"其他"
        if (data.holiday.length > 0) {
            data.holiday.sort((a, b) => a.localeCompare(b));
            otherSections.push({ festival, type: 'holiday', dates: data.holiday, ranges: mergeConsecutiveDates(data.holiday) });
        }
        if (data.work.length > 0) {
            data.work.sort((a, b) => a.localeCompare(b));
            otherSections.push({ festival, type: 'work', dates: data.work, ranges: mergeConsecutiveDates(data.work) });
        }
    }

    // "其他"分组内的条目按日期排序
    otherSections.sort((a, b) => a.dates[0].localeCompare(b.dates[0]));

    const groups = [...standardGroups];
    if (otherSections.length > 0) {
        groups.push({ name: '其他', isOther: true, sections: otherSections });
    }

    return groups;
}

// 合并连续日期为范围段
// 输入: ['10-01', '10-02', '10-03', '10-05', '10-06', '10-07']
// 输出: [{start: '10-01', end: '10-03'}, {start: '10-05', end: '10-07'}]
function mergeConsecutiveDates(dates) {
    if (dates.length === 0) return [];
    const sorted = [...dates].sort((a, b) => a.localeCompare(b));
    const ranges = [];
    let start = sorted[0];
    let end = sorted[0];
    const year = holidayCurrentYear;

    for (let i = 1; i < sorted.length; i++) {
        const prevDate = new Date(year, parseInt(end.split('-')[0]) - 1, parseInt(end.split('-')[1]));
        const currDate = new Date(year, parseInt(sorted[i].split('-')[0]) - 1, parseInt(sorted[i].split('-')[1]));
        const diff = (currDate - prevDate) / (1000 * 60 * 60 * 24);

        if (diff === 1) {
            end = sorted[i];
        } else {
            ranges.push({ start, end });
            start = sorted[i];
            end = sorted[i];
        }
    }
    ranges.push({ start, end });
    return ranges;
}

// MM-DD → "M月D日"
function formatDateChinese(md) {
    const [m, d] = md.split('-');
    return parseInt(m) + '月' + parseInt(d) + '日';
}

// 范围数组 → 中文显示（HTML，等宽对齐）
// [{start:'10-01',end:'10-03'}, {start:'10-05',end:'10-05'}]
// → "<seg>10月1日</seg><sep>-</sep><seg>10月3日</seg><sep>,</sep><seg>10月5日</seg>"
function formatRangeChinese(ranges) {
    return ranges.map(r => {
        if (r.start === r.end) {
            return `<span class="hd-seg">${formatDateChinese(r.start)}</span>`;
        }
        return `<span class="hd-seg">${formatDateChinese(r.start)}</span><span class="hd-sep">-</span><span class="hd-seg">${formatDateChinese(r.end)}</span>`;
    }).join('<span class="hd-sep">,</span>');
}

// 渲染分组列表
function renderHolidayGroups() {
    // 重新渲染前关闭日历弹窗（编辑表单会被重建，避免弹窗悬空）
    closeHolidayCalendarPopup();
    const groups = getHolidayGroups(holidayCurrentYear);
    const container = document.getElementById('holiday-groups');
    const statsEl = document.getElementById('holiday-stats');

    // 统计
    const yearStr = String(holidayCurrentYear);
    const yearData = holidayData[yearStr] || { holidays: {}, workdays: {} };
    const holidayCount = yearData.holidays ? Object.keys(yearData.holidays).length : 0;
    const workCount = yearData.workdays ? Object.keys(yearData.workdays).length : 0;
    statsEl.textContent = `假期：${holidayCount} 天 | 调休：${workCount} 天`;

    container.innerHTML = '';

    // 收集所有分组卡片（含正在编辑/新增的表单）
    const allCards = [];
    groups.forEach(group => {
        allCards.push(renderGroup(group));
    });

    // 全局添加模式：在最后追加表单卡片
    const isGlobalAdding = holidayEditing && holidayEditing.isAdd && holidayEditing.groupKey === '__global__';
    if (isGlobalAdding) {
        allCards.push(renderEditForm(null, null, true));
    }

    if (allCards.length === 0 && !isGlobalAdding) {
        container.innerHTML = `<div class="text-center text-theme-muted py-8">暂无数据，点击下方"添加条目"开始设置</div>`;
    }

    // 双栏布局，上下优先排列
    const midpoint = Math.ceil(allCards.length / 2);
    const colsHtml = `<div class="holiday-cols"><div class="holiday-col" id="holiday-col-1"></div><div class="holiday-col" id="holiday-col-2"></div></div>`;
    container.innerHTML = colsHtml;
    const col1 = document.getElementById('holiday-col-1');
    const col2 = document.getElementById('holiday-col-2');
    allCards.forEach((card, i) => {
        if (i < midpoint) col1.appendChild(card);
        else col2.appendChild(card);
    });

    // 全局添加条目按钮（始终显示在最下方，跨两栏）
    if (!isGlobalAdding) {
        const addDiv = document.createElement('div');
        addDiv.className = 'mt-4';
        addDiv.innerHTML = `
            <button onclick="addEntryInGroup('__global__', '')" class="px-4 py-2 border-2 border-dashed border-theme rounded-lg hover:bg-theme-tertiary transition text-theme-secondary flex items-center gap-2 text-sm w-full justify-center">
                <i class="fas fa-plus"></i>添加条目
            </button>
        `;
        container.appendChild(addDiv);
    }
}

// 渲染单个分组
function renderGroup(group) {
    const div = document.createElement('div');
    div.className = 'holiday-group mb-4';

    // 分组标题（含悬浮添加按钮，仿侧边栏新建清单样式）
    const header = document.createElement('div');
    header.className = 'group flex items-center justify-between pb-2 mb-2 border-b-2 border-theme';
    const title = document.createElement('span');
    title.className = 'text-base font-semibold text-theme-primary';
    title.textContent = group.name;
    header.appendChild(title);

    // 分组内添加按钮（悬浮显示）
    const isAddingInThisGroup = holidayEditing && holidayEditing.isAdd && holidayEditing.groupKey === group.name;
    if (!isAddingInThisGroup) {
        const addBtn = document.createElement('button');
        const defaultFestival = group.isOther ? '' : group.name;
        addBtn.onclick = () => addEntryInGroup(group.name, defaultFestival);
        addBtn.className = 'text-theme-secondary hover:text-theme-primary opacity-0 group-hover:opacity-100 transition text-sm w-5 text-center flex items-center justify-center';
        addBtn.title = '添加条目';
        addBtn.innerHTML = `<i class="fas fa-plus"></i>`;
        header.appendChild(addBtn);
    } else {
        // 占位，保持标题右对齐
        const placeholder = document.createElement('span');
        placeholder.className = 'w-5';
        header.appendChild(placeholder);
    }
    div.appendChild(header);

    // 分组内容
    const body = document.createElement('div');
    body.className = 'space-y-2';

    group.sections.forEach(section => {
        const isEditing = holidayEditing &&
            holidayEditing.groupKey === group.name &&
            holidayEditing.type === section.type &&
            holidayEditing.festival === section.festival;

        if (isEditing) {
            body.appendChild(renderEditForm(group, section, false));
        } else {
            body.appendChild(renderSectionView(group, section));
        }
    });

    // 分组内添加模式：显示表单
    if (isAddingInThisGroup) {
        body.appendChild(renderEditForm(group, null, true));
    }

    div.appendChild(body);
    return div;
}

// 渲染查看模式行
function renderSectionView(group, section) {
    const div = document.createElement('div');
    div.className = `holiday-section flex items-center gap-2 px-3 py-2 bg-theme-primary rounded-r-lg border border-theme border-l-4 ${section.type === 'holiday' ? 'border-l-green-400' : 'border-l-orange-400'}`;

    const typeLabel = section.type === 'holiday' ? '假期' : '调休';
    const typeBadgeClass = section.type === 'holiday'
        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
        : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300';

    const datesText = formatRangeChinese(section.ranges);

    // 删除确认状态
    const isDeleteConfirming = holidayDeleteConfirming &&
        holidayDeleteConfirming.groupKey === group.name &&
        holidayDeleteConfirming.type === section.type &&
        holidayDeleteConfirming.festival === section.festival;

    const deleteBtnClass = isDeleteConfirming
        ? 'bg-red-600 text-white border-red-600'
        : 'border border-red-500 text-red-500 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/30';
    const deleteBtnTitle = isDeleteConfirming ? '确认删除' : '删除';
    const deleteBtnIcon = isDeleteConfirming ? 'fa-check' : 'fa-trash';
    const editBtnClass = 'border border-blue-500 text-blue-500 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-900/30';

    // "其他"分组显示名称
    const nameSpan = group.isOther
        ? `<span class="text-sm text-theme-secondary flex-shrink-0">${section.festival}</span>`
        : '';

    div.innerHTML = `
        <span class="px-1.5 py-0.5 rounded text-xs font-medium ${typeBadgeClass} flex-shrink-0">${typeLabel}</span>
        ${nameSpan}
        <span class="text-sm text-theme-primary flex-1">${datesText}</span>
        <div class="flex gap-1 flex-shrink-0">
            <button onclick="editSection('${group.name}', '${section.type}', '${section.festival}')" class="flex items-center justify-center w-8 h-8 rounded-lg border ${editBtnClass} transition" title="编辑">
                <i class="fas fa-edit text-sm"></i>
            </button>
            <button onclick="deleteSection('${group.name}', '${section.type}', '${section.festival}')" class="flex items-center justify-center w-8 h-8 rounded-lg border ${deleteBtnClass} transition" title="${deleteBtnTitle}">
                <i class="fas ${deleteBtnIcon} text-sm"></i>
            </button>
        </div>
    `;
    return div;
}

// 渲染编辑/新增表单
function renderEditForm(group, section, isAdd) {
    const div = document.createElement('div');
    div.className = 'holiday-edit-form px-3 py-2.5 bg-theme-tertiary rounded-lg border border-theme border-l-4 border-l-blue-400';

    const yearStr = String(holidayCurrentYear);

    // 日期范围预填
    let dateRangeValue = '';
    if (section && section.dates.length > 0) {
        dateRangeValue = datesToRangeInput(section.dates, yearStr);
    }

    // 类型
    const typeValue = section ? section.type : 'holiday';

    // 名称
    let nameValue = '';
    if (section) {
        nameValue = section.festival;
    } else if (holidayEditing && holidayEditing.festival) {
        nameValue = holidayEditing.festival;
    }

    const groupKey = group ? group.name : '__global__';
    const festival = section ? section.festival : (holidayEditing ? holidayEditing.festival : '');

    div.innerHTML = `
        <div class="flex items-center gap-2 mb-2">
            <input type="text" id="holiday-edit-daterange" value="${dateRangeValue}"
                placeholder="多个日期用 , 分隔，连续范围用 - 连接"
                class="flex-1 px-2 py-1.5 text-sm border border-theme rounded-lg bg-theme-primary text-theme-primary"
                aria-label="日期范围">
            <button id="holiday-calendar-btn" onclick="openHolidayDatePicker(event)"
                class="flex items-center justify-center w-8 h-8 rounded-lg border border-theme text-theme-secondary hover:bg-theme-primary transition" title="选择日期">
                <i class="fas fa-calendar text-sm"></i>
            </button>
        </div>
        <div class="flex items-center gap-2">
            <input type="hidden" id="holiday-edit-type" value="${typeValue}">
            <div class="flex gap-1.5 flex-shrink-0">
                <button type="button" onclick="setHolidayEditType('holiday')" data-type="holiday"
                    class="holiday-type-btn detail-tag-pill${typeValue === 'holiday' ? ' detail-tag-pill-selected' : ''}"
                    style="--tag-color: #22c55e">假期</button>
                <button type="button" onclick="setHolidayEditType('work')" data-type="work"
                    class="holiday-type-btn detail-tag-pill${typeValue === 'work' ? ' detail-tag-pill-selected' : ''}"
                    style="--tag-color: #f97316">调休</button>
            </div>
            <div class="flex-1 relative" id="holiday-name-combobox-wrapper">
                <input type="text" id="holiday-edit-name" value="${nameValue}"
                    maxlength="20"
                    placeholder="节日名称"
                    autocomplete="off"
                    class="w-full px-2 py-1.5 text-sm border border-theme rounded-lg bg-theme-primary text-theme-primary"
                    aria-label="名称">
                <button type="button" onclick="toggleHolidayNameDropdown(event)"
                    class="absolute right-1 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-primary px-1" title="选择已有名称">
                    <i class="fas fa-chevron-down text-xs"></i>
                </button>
                <div id="holiday-name-dropdown" class="hidden absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto border border-theme rounded-lg bg-theme-secondary shadow-lg z-50"></div>
            </div>
            <div class="flex gap-1 flex-shrink-0">
                <button onclick="saveSection('${groupKey}', '${typeValue}', '${festival}', ${isAdd})"
                    class="flex items-center justify-center w-8 h-8 rounded-lg border border-green-500 text-green-500 hover:bg-green-500 hover:text-white transition" title="保存">
                    <i class="fas fa-check text-sm"></i>
                </button>
                <button onclick="cancelHolidayEdit()"
                    class="flex items-center justify-center w-8 h-8 rounded-lg border border-theme text-theme-secondary hover:bg-theme-primary transition" title="取消">
                    <i class="fas fa-times text-sm"></i>
                </button>
            </div>
        </div>
    `;
    // 绑定名称输入框的下拉交互
    const nameInput = div.querySelector('#holiday-edit-name');
    if (nameInput) {
        nameInput.addEventListener('focus', () => _openHolidayNameDropdown());
        nameInput.addEventListener('input', () => {
            const dd = document.getElementById('holiday-name-dropdown');
            if (dd && !dd.classList.contains('hidden')) {
                _renderHolidayNameDropdown(dd, nameInput.value);
            }
        });
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                _closeHolidayNameDropdown();
            }
        });
    }
    return div;
}

// 收集当前数据中所有出现过的节日名称（含标准节日）
function _collectAllFestivalNames() {
    const names = new Set(STANDARD_FESTIVALS);
    for (const yearKey in holidayData) {
        const yearData = holidayData[yearKey];
        if (!yearData) continue;
        if (yearData.holidays) {
            for (const md in yearData.holidays) names.add(yearData.holidays[md]);
        }
        if (yearData.workdays) {
            for (const md in yearData.workdays) {
                const n = yearData.workdays[md];
                // 调休名去掉"调休"后缀得到节日名
                names.add(n.endsWith('调休') ? n.slice(0, -2) : n);
            }
        }
    }
    // 标准节日排在最前
    return [...STANDARD_FESTIVALS.filter(n => names.has(n)), ...[...names].filter(n => !STANDARD_FESTIVALS.includes(n)).sort()];
}

function _renderHolidayNameDropdown(listEl, filter) {
    const allNames = _collectAllFestivalNames();
    const filtered = filter
        ? allNames.filter(n => n.toLowerCase().includes(filter.toLowerCase()))
        : allNames;
    listEl.innerHTML = '';
    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'px-3 py-2 text-sm text-theme-muted';
        empty.textContent = '无匹配名称，可直接输入';
        listEl.appendChild(empty);
        return;
    }
    for (const name of filtered) {
        const item = document.createElement('div');
        item.className = 'px-3 py-1.5 cursor-pointer hover:bg-theme-tertiary text-sm text-theme-primary';
        item.textContent = name;
        item.onmousedown = (e) => {
            e.preventDefault(); // 防止输入框失焦
            _selectHolidayName(name);
        };
        listEl.appendChild(item);
    }
}

function _openHolidayNameDropdown() {
    const listEl = document.getElementById('holiday-name-dropdown');
    if (!listEl) return;
    const inputEl = document.getElementById('holiday-edit-name');
    _renderHolidayNameDropdown(listEl, inputEl ? inputEl.value : '');
    listEl.classList.remove('hidden');
}

function _closeHolidayNameDropdown() {
    const listEl = document.getElementById('holiday-name-dropdown');
    if (listEl) listEl.classList.add('hidden');
}

// 点击外部关闭名称下拉
document.addEventListener('click', (e) => {
    const listEl = document.getElementById('holiday-name-dropdown');
    if (!listEl || listEl.classList.contains('hidden')) return;
    const wrapper = document.getElementById('holiday-name-combobox-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        _closeHolidayNameDropdown();
    }
});

function _selectHolidayName(name) {
    const inputEl = document.getElementById('holiday-edit-name');
    if (inputEl) inputEl.value = name;
    _closeHolidayNameDropdown();
    if (inputEl) inputEl.focus();
}

function toggleHolidayNameDropdown(event) {
    if (event) event.stopPropagation();
    const listEl = document.getElementById('holiday-name-dropdown');
    if (!listEl) return;
    if (listEl.classList.contains('hidden')) {
        _openHolidayNameDropdown();
    } else {
        _closeHolidayNameDropdown();
    }
}

// ===== 日期范围解析工具 =====

// 日期数组 → 输入框文本
// ['10-01','10-02','10-03','10-05'] → "1001 - 1003 , 1005"
function datesToRangeInput(dates, yearStr) {
    const ranges = mergeConsecutiveDates(dates);
    return ranges.map(r => {
        const start = r.start.replace('-', '');
        if (r.start === r.end) return start;
        return start + ' - ' + r.end.replace('-', '');
    }).join(' , ');
}

// 输入框文本 → MM-DD 日期数组
// 默认 MMDD 格式，兼容 YYYYMMDD / YYYY-MM-DD
// 支持: "1001", "1001 - 1007", "10-01", "10-01 - 10-07"
// 兼容: "20261001", "20261001 - 20261007", "2026-10-01"
function parseDateRangeInput(text, year) {
    const parts = text.split(/[,，]/);
    const allDates = [];

    for (const part of parts) {
        // 提取所有数字段（用连字符或空格分隔）
        const tokens = part.trim().split(/[-\s]+/).filter(t => t.length > 0);
        if (tokens.length === 0) continue;

        // 将连续的2位数字两两组合为 MM-DD（如 10-01 → 一个4位）
        const combined = [];
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].length === 2 && i + 1 < tokens.length && tokens[i + 1].length === 2) {
                combined.push(tokens[i] + tokens[i + 1]);
                i++; // 跳过下一个
            } else {
                combined.push(tokens[i]);
            }
        }

        // 判断每个 token 是 YYYYMMDD(8位) 还是 MMDD(4位)
        const parsed = combined.map(t => {
            const digits = t.replace(/\D/g, '');
            if (digits.length === 8) return { type: 'long', md: extractMD(digits) };
            if (digits.length === 4) return { type: 'short', md: extractMDShort(digits) };
            return null;
        }).filter(p => p !== null);

        if (parsed.length === 0) continue;

        if (parsed.length === 1) {
            if (parsed[0].md) allDates.push(parsed[0].md);
        } else {
            // 取前两个作为范围起止
            const startMD = parsed[0].md;
            const endMD = parsed[1].md;
            if (startMD && endMD) {
                const expanded = expandDateRange(startMD, endMD, year);
                allDates.push(...expanded);
            }
        }
    }
    return allDates;
}

// "20261001" 或 "2026-10-01" → "10-01"
function extractMD(dateStr) {
    const cleaned = dateStr.replace(/-/g, '');
    if (cleaned.length !== 8) return null;
    return cleaned.substring(4, 6) + '-' + cleaned.substring(6, 8);
}

// "1001" 或 "10-01" → "10-01"
function extractMDShort(dateStr) {
    const cleaned = dateStr.replace(/-/g, '');
    if (cleaned.length !== 4) return null;
    return cleaned.substring(0, 2) + '-' + cleaned.substring(2, 4);
}

// 展开日期范围: "10-01" to "10-07" → ['10-01','10-02',...,'10-07']
function expandDateRange(startMD, endMD, year) {
    const startDate = new Date(year, parseInt(startMD.split('-')[0]) - 1, parseInt(startMD.split('-')[1]));
    const endDate = new Date(year, parseInt(endMD.split('-')[0]) - 1, parseInt(endMD.split('-')[1]));
    if (endDate < startDate) return []; // 起止颠倒返回空
    const dates = [];
    const current = new Date(startDate);
    while (current <= endDate) {
        const mm = String(current.getMonth() + 1).padStart(2, '0');
        const dd = String(current.getDate()).padStart(2, '0');
        dates.push(mm + '-' + dd);
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

// 自定义日历弹窗状态
let _holidayCalViewYear = null;
let _holidayCalViewMonth = null;

// 打开日期选择器（自定义日历弹窗，定位到按钮水平右侧）
function openHolidayDatePicker(event) {
    if (event) event.stopPropagation();
    const btn = document.getElementById('holiday-calendar-btn');
    if (!btn) return;

    // 移除已存在的弹窗
    closeHolidayCalendarPopup();

    // 初始化查看月份：优先用文本框中已有的日期，否则用今天
    if (_holidayCalViewYear === null) {
        const textInput = document.getElementById('holiday-edit-daterange');
        const m = textInput && textInput.value.match(/(\d{2})(\d{2})/);
        if (m) {
            _holidayCalViewYear = holidayCurrentYear;
            _holidayCalViewMonth = parseInt(m[1], 10) - 1;
        } else {
            const today = new Date();
            _holidayCalViewYear = holidayCurrentYear;
            _holidayCalViewMonth = today.getMonth();
        }
    }

    const popup = document.createElement('div');
    popup.id = 'holiday-calendar-popup';
    popup.className = 'fixed z-50 bg-theme-secondary border border-theme rounded-lg shadow-xl p-3 w-64 text-sm';

    popup.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <button type="button" class="p-1 rounded hover:bg-theme-tertiary text-theme-secondary transition" data-nav="prev" title="上个月">
                <i class="fas fa-chevron-left text-xs"></i>
            </button>
            <span class="text-theme-primary font-medium" id="holiday-cal-title"></span>
            <button type="button" class="p-1 rounded hover:bg-theme-tertiary text-theme-secondary transition" data-nav="next" title="下个月">
                <i class="fas fa-chevron-right text-xs"></i>
            </button>
        </div>
        <div class="grid grid-cols-7 gap-0.5 text-center text-[11px] text-theme-muted mb-1">
            <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
        </div>
        <div class="grid grid-cols-7 gap-0.5" id="holiday-cal-grid"></div>
        <div class="mt-2 pt-2 border-t border-theme flex items-center justify-between text-[11px] text-theme-muted">
            <span>点击日期追加</span>
            <button type="button" class="px-2 py-0.5 rounded hover:bg-theme-tertiary text-theme-secondary transition" data-action="today">今天</button>
        </div>
    `;
    document.body.appendChild(popup);

    // 绑定导航按钮
    popup.querySelector('[data-nav="prev"]').addEventListener('click', (e) => {
        e.stopPropagation();
        _holidayCalViewMonth--;
        if (_holidayCalViewMonth < 0) { _holidayCalViewMonth = 11; _holidayCalViewYear--; }
        renderHolidayCalendarGrid();
    });
    popup.querySelector('[data-nav="next"]').addEventListener('click', (e) => {
        e.stopPropagation();
        _holidayCalViewMonth++;
        if (_holidayCalViewMonth > 11) { _holidayCalViewMonth = 0; _holidayCalViewYear++; }
        renderHolidayCalendarGrid();
    });
    popup.querySelector('[data-action="today"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const today = new Date();
        _holidayCalViewYear = today.getFullYear();
        _holidayCalViewMonth = today.getMonth();
        renderHolidayCalendarGrid();
    });

    // 定位到按钮水平右侧
    positionHolidayCalendarPopup(btn);
    renderHolidayCalendarGrid();

    // 点击外部关闭
    setTimeout(() => {
        document.addEventListener('click', closeHolidayCalendarOnOutside);
    }, 0);
}

// 定位弹窗到按钮水平右侧（右侧空间不足时回退到左侧）
function positionHolidayCalendarPopup(btn) {
    const popup = document.getElementById('holiday-calendar-popup');
    if (!popup) return;
    const rect = btn.getBoundingClientRect();
    const popupWidth = 256 + 24; // w-64 + padding
    const popupHeight = popup.offsetHeight || 280;
    const margin = 8;

    let left = rect.right + margin;
    if (left + popupWidth > window.innerWidth - 8) {
        left = rect.left - popupWidth - margin;
    }
    if (left < 8) left = Math.max(8, rect.right + margin);

    let top = rect.top;
    if (top + popupHeight > window.innerHeight - 8) {
        top = window.innerHeight - popupHeight - 8;
    }
    if (top < 8) top = 8;

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
}

// 渲染日历网格
function renderHolidayCalendarGrid() {
    const popup = document.getElementById('holiday-calendar-popup');
    if (!popup) return;
    const title = popup.querySelector('#holiday-cal-title');
    const grid = popup.querySelector('#holiday-cal-grid');
    if (!title || !grid) return;

    const y = _holidayCalViewYear;
    const m = _holidayCalViewMonth;
    title.textContent = `${y}年${m + 1}月`;

    const firstDay = new Date(y, m, 1).getDay(); // 0=周日
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m;

    grid.innerHTML = '';
    // 前置空白
    for (let i = 0; i < firstDay; i++) {
        const blank = document.createElement('span');
        grid.appendChild(blank);
    }
    // 日期格
    for (let d = 1; d <= daysInMonth; d++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.textContent = d;
        const isToday = isCurrentMonth && today.getDate() === d;
        cell.className = `py-1 rounded text-xs transition ${
            isToday
                ? 'bg-blue-500 text-white font-semibold hover:bg-blue-600'
                : 'text-theme-primary hover:bg-theme-tertiary'
        }`;
        cell.addEventListener('click', (e) => {
            e.stopPropagation();
            const mm = String(m + 1).padStart(2, '0');
            const dd = String(d).padStart(2, '0');
            applyHolidayDatePick(mm + dd);
            closeHolidayCalendarPopup();
        });
        grid.appendChild(cell);
    }
}

// 将选中的 MMDD 追加到文本输入框（保持原有逻辑）
function applyHolidayDatePick(mmdd) {
    const textInput = document.getElementById('holiday-edit-daterange');
    if (!textInput) return;
    const currentText = textInput.value.trim();
    if (currentText === '' || currentText.endsWith('-') || currentText.endsWith(',') || currentText.endsWith('，') || currentText.endsWith(' ')) {
        textInput.value = currentText + mmdd;
    } else {
        textInput.value = mmdd;
    }
    textInput.focus();
}

// 点击外部关闭日历弹窗
function closeHolidayCalendarOnOutside(e) {
    const popup = document.getElementById('holiday-calendar-popup');
    const btn = document.getElementById('holiday-calendar-btn');
    if (popup && !popup.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        closeHolidayCalendarPopup();
    }
}

// 关闭日历弹窗
function closeHolidayCalendarPopup() {
    const popup = document.getElementById('holiday-calendar-popup');
    if (popup) popup.remove();
    document.removeEventListener('click', closeHolidayCalendarOnOutside);
}

// ===== 操作函数 =====

// 开始编辑某个分组
function editSection(groupKey, type, festival) {
    holidayEditing = { groupKey, type, festival, isAdd: false };
    holidayDeleteConfirming = null;
    renderHolidayGroups();
}

// 开始添加条目（在指定分组内）
function addEntryInGroup(groupKey, defaultFestival) {
    holidayEditing = { groupKey, type: 'holiday', festival: defaultFestival || '', isAdd: true };
    holidayDeleteConfirming = null;
    renderHolidayGroups();
    setTimeout(() => {
        const dateInput = document.getElementById('holiday-edit-daterange');
        if (dateInput) dateInput.focus();
    }, 50);
}

// 取消编辑
function cancelHolidayEdit() {
    holidayEditing = null;
    renderHolidayGroups();
}

// 切换编辑表单中的类型（假期/调休）
function setHolidayEditType(type) {
    const hidden = document.getElementById('holiday-edit-type');
    if (hidden) hidden.value = type;
    document.querySelectorAll('.holiday-type-btn').forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.remove('detail-tag-pill');
            btn.classList.add('detail-tag-pill-selected');
        } else {
            btn.classList.remove('detail-tag-pill-selected');
            btn.classList.add('detail-tag-pill');
        }
    });
}

// 保存条目
function saveSection(groupKey, originalType, originalFestival, isAdd) {
    const dateRangeInput = document.getElementById('holiday-edit-daterange');
    const typeSelect = document.getElementById('holiday-edit-type');
    const nameInput = document.getElementById('holiday-edit-name');

    if (!dateRangeInput || !typeSelect || !nameInput) return;

    const dateRangeText = dateRangeInput.value.trim();
    const type = typeSelect.value;
    let name = nameInput.value.trim();

    // 校验日期范围
    if (!dateRangeText) {
        showToast('请输入日期范围', 'error');
        return;
    }

    const newDates = parseDateRangeInput(dateRangeText, holidayCurrentYear);
    if (newDates.length === 0) {
        showToast('日期格式应为 MMDD - MMDD，请重新输入', 'error');
        return;
    }

    // 校验每个日期是否真实存在
    for (const md of newDates) {
        const [m, d] = md.split('-').map(Number);
        const testDate = new Date(holidayCurrentYear, m - 1, d);
        if (testDate.getMonth() + 1 !== m || testDate.getDate() !== d) {
            showToast(`请输入合法的日期（${md} 不存在）`, 'error');
            return;
        }
    }

    // 校验名称
    if (!name) {
        showToast('请输入名称', 'error');
        return;
    }

    // 调休类型追加"调休"后缀
    let storedName = name;
    if (type === 'work' && !storedName.endsWith('调休')) {
        storedName = storedName + '调休';
    }
    if (type === 'holiday' && storedName.endsWith('调休')) {
        storedName = storedName.slice(0, -2);
    }

    const yearStr = String(holidayCurrentYear);
    if (!holidayData[yearStr]) {
        holidayData[yearStr] = { holidays: {}, workdays: {} };
    }
    if (!holidayData[yearStr].holidays) holidayData[yearStr].holidays = {};
    if (!holidayData[yearStr].workdays) holidayData[yearStr].workdays = {};

    const targetObj = type === 'holiday' ? holidayData[yearStr].holidays : holidayData[yearStr].workdays;
    const otherObj = type === 'holiday' ? holidayData[yearStr].workdays : holidayData[yearStr].holidays;

    // 收集原有日期（编辑模式下需要排除）
    const originalDates = new Set();
    if (!isAdd) {
        const entries = getHolidayEntriesForFestival(yearStr, originalType, originalFestival);
        entries.forEach(md => originalDates.add(md));
    }

    // 检查冲突
    const conflicts = [];
    for (const md of newDates) {
        // 排除自身原有日期
        if (originalDates.has(md)) continue;

        // 检查另一类型是否已有该日期
        if (otherObj[md]) {
            conflicts.push(`${md} 已设为${type === 'holiday' ? '调休' : '假期'}`);
            continue;
        }

        // 检查同类型中是否已有不同节日的该日期
        if (targetObj[md]) {
            const existingName = targetObj[md];
            const existingFestival = (type === 'work' && existingName.endsWith('调休'))
                ? existingName.slice(0, -2)
                : existingName;
            if (existingFestival !== name) {
                conflicts.push(`${md} 已设为${existingName}`);
            }
        }
    }

    if (conflicts.length > 0) {
        showToast('日期冲突：' + conflicts[0], 'error');
        return;
    }

    // 删除原有日期（编辑模式）
    if (!isAdd) {
        for (const md of originalDates) {
            delete targetObj[md];
        }
    }

    // 写入新日期
    for (const md of newDates) {
        targetObj[md] = storedName;
    }

    // 保存
    if (saveHolidayData(holidayData)) {
        holidayEditing = null;
        renderHolidayGroups();
        showToast('保存成功', 'success');
    }
}

// 获取某节日+类型的所有日期
function getHolidayEntriesForFestival(yearStr, type, festival) {
    const sourceObj = type === 'holiday'
        ? (holidayData[yearStr]?.holidays || {})
        : (holidayData[yearStr]?.workdays || {});
    const dates = [];
    for (const [md, name] of Object.entries(sourceObj)) {
        const entryFestival = (type === 'work' && name.endsWith('调休')) ? name.slice(0, -2) : name;
        if (entryFestival === festival) {
            dates.push(md);
        }
    }
    return dates;
}

// 删除条目（内联二次确认）
function deleteSection(groupKey, type, festival) {
    const confirmKey = { groupKey, type, festival };

    if (!holidayDeleteConfirming ||
        holidayDeleteConfirming.groupKey !== groupKey ||
        holidayDeleteConfirming.type !== type ||
        holidayDeleteConfirming.festival !== festival) {
        holidayDeleteConfirming = confirmKey;
        renderHolidayGroups();
        if (holidayDeleteTimer) clearTimeout(holidayDeleteTimer);
        holidayDeleteTimer = setTimeout(() => {
            holidayDeleteConfirming = null;
            renderHolidayGroups();
        }, 3000);
        return;
    }

    // 确认删除
    const yearStr = String(holidayCurrentYear);
    const dates = getHolidayEntriesForFestival(yearStr, type, festival);
    if (dates.length === 0) return;

    const targetObj = type === 'holiday'
        ? (holidayData[yearStr]?.holidays || {})
        : (holidayData[yearStr]?.workdays || {});

    for (const md of dates) {
        delete targetObj[md];
    }

    if (saveHolidayData(holidayData)) {
        holidayDeleteConfirming = null;
        if (holidayDeleteTimer) {
            clearTimeout(holidayDeleteTimer);
            holidayDeleteTimer = null;
        }
        renderHolidayGroups();
        showToast('删除成功', 'success');
    }
}

// 导出 JSON
function exportHolidayJSON() {
    const dataStr = JSON.stringify(holidayData, null, 4);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `holidays_data_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('导出成功', 'success');
}

// 导入 JSON
function importHolidayJSON() {
    const input = document.getElementById('holiday-import-file');
    if (input) {
        input.value = '';
        input.click();
    }
}

// 处理导入文件
function handleHolidayImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);

            let valid = false;
            for (const key of Object.keys(data)) {
                if (data[key] && (data[key].holidays || data[key].workdays)) {
                    valid = true;
                    break;
                }
            }
            if (!valid) {
                showToast('文件格式不正确，请检查 JSON 结构是否包含年份、holidays、workdays', 'error');
                return;
            }

            showConfirmToast(
                '导入方式：确认=合并所有年份，取消=覆盖所有数据',
                () => {
                    for (const [year, yearData] of Object.entries(data)) {
                        if (year.startsWith('_')) continue;
                        if (!holidayData[year]) {
                            holidayData[year] = { holidays: {}, workdays: {} };
                        }
                        if (yearData.holidays) {
                            if (!holidayData[year].holidays) holidayData[year].holidays = {};
                            Object.assign(holidayData[year].holidays, yearData.holidays);
                        }
                        if (yearData.workdays) {
                            if (!holidayData[year].workdays) holidayData[year].workdays = {};
                            Object.assign(holidayData[year].workdays, yearData.workdays);
                        }
                    }
                    saveHolidayData(holidayData);
                    renderHolidayGroups();
                    showToast('导入成功（合并模式）', 'success');
                },
                () => {
                    showConfirmToast(
                        '覆盖将删除所有现有数据，确定继续？',
                        () => {
                            const newData = {};
                            for (const [year, yearData] of Object.entries(data)) {
                                if (year.startsWith('_')) continue;
                                newData[year] = {
                                    holidays: yearData.holidays || {},
                                    workdays: yearData.workdays || {}
                                };
                            }
                            holidayData = newData;
                            saveHolidayData(holidayData);
                            renderHolidayGroups();
                            showToast('导入成功（覆盖模式）', 'success');
                        },
                        () => {
                            showToast('已取消导入', 'info');
                        }
                    );
                }
            );
        } catch (error) {
            showToast('文件格式不正确，请检查 JSON 结构是否包含年份、holidays、workdays', 'error');
        }
    };
    reader.readAsText(file);
}
