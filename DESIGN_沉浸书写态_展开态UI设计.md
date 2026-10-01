# 设计文档：沉浸书写态 · 展开态界面（Notion 笔记风格）

- 状态：**已实施（含第二 / 第三轮改进）**：`index.html` / `index_offline.html` / `tasks.js` / `app.js` / `data.js`
- 日期：2026-10-01（第二轮、第三轮改进同日完成，见 10.2 / 10.3）
- 上游：[DESIGN_沉浸书写态与番茄任务详情切换.md](./DESIGN_沉浸书写态与番茄任务详情切换.md) 特性一
- 方案基线：**方案一（主视图挤压式展开，保留左侧栏）**，本文档只定义「展开态下详情面板长什么样」
- 拍板记录：见第 10 节（四项决策 + 两项一致性要求，均已落实到本节）

---

## 1. 要解决的三个问题

| # | 现状 | 问题 |
| - | ---- | ---- |
| P1 | 底部 `[删除任务][开始专注][保存]` 三个 `flex-1` 按钮（`index.html:3363-3369`） | 面板变宽后按钮被撑成三条巨大的色块，视觉重心全被按钮抢走 |
| P2 | 顶部工具栏「设置时间 ▾」居左，标题在标题区居左 | 顶部 chrome 居左 + 正文居中，两条对齐线打架，割裂 |
| P3 | 整体仍是「表单面板」的观感 | 缺少沉浸感，不像一张可以写东西的纸 |

---

## 2. 设计原则（Notion 化的 6 条）

1. **标题下放**：标题不再是顶部工具栏的附属品，而是正文的第一行（H1）。顶栏只剩 chrome。
2. **单一对齐线**：顶栏面包屑与正文容器**共用一个 max-width 容器**，上下左边缘对齐 → 割裂感消失。
3. **属性化**：日期/提醒/重复等不再藏在二级菜单里，变成常驻的 Properties 行（icon + label + value）。
4. **无框输入**：正文是无边框、无背景的连续流，点击即写。
5. **操作退场**：主操作收进右下角圆形悬浮簇，不在内容流里占位。
6. **留白即边界**：靠 max-width + 大留白定义内容区，不靠边框和分割线。

---

## 3. 展开态布局总览

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏 chrome 48px（无分割线 / 极浅底）                          │
│  ┌ 与正文同宽的容器 ─────────────────────────────┐            │
│  │ ← 收起   工作 / 季度复盘                      │  ⤢  ←     │
│  └──────────────────────────────────────────────┘            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│              ┌── 正文容器 max-w:720/900/100% ──┐              │
│              │ ○  季度复盘              │  ← H1 32px         │
│              │                          │                    │
│              │      ( 1月2日 01:00 - 02:00 ▾ )   ← 时间摘要胶囊 │
│              │  ┌─ 点击展开 ─────────────────┐   │            │
│              │  │ 时间       [时间段][清除时间] │  │            │
│              │  │ [日期][时间][结束日期][结束时间]│ │            │
│              │  │ [提醒][重复]                │  │            │
│              │  └────────────────────────────┘   │            │
│              │                          │                    │
│              │ 这里是任务笔记正文……      │  ← 正文 16px/1.8   │
│              │ 无边框、自动增高、         │                    │
│              │ 可以一直往下写。           │                    │
│              │                          │                    │
│              │ ☐ 子任务一                │  ← 子任务（可选）  │
│              │ ☐ 子任务二                │                    │
│              └──────────────────────────┘                     │
│                                                              │
│                       (🏷 复盘) (深度思考)      ← 标签，右对齐 │
│                       [▶ 100%]                 ← 进度条        │
│                       (⭐)(🔥)(🏷)(📁)(🗑)( ▶ )  ← 6 个 40px 圆钮 │
│                       └── 280px 右对齐停靠区 ──┘              │
│                          （无保存按钮，自动保存）              │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 分区详细设计

### 4.1 顶栏（chrome 化）— 解决 P2

现有：`[设置时间 ▾] ... [切换模式][×]`（`index.html:3104-3117`）

展开态改为：

- **左**：~~`清单名 › 任务名`（13px，次要色，truncate）~~ —— **第六轮隐藏**
  （标题已下放到正文 H1，顶部不需要再念一遍面包屑）。`#detail-crumb` 在 DOM 里仍保留
  （`openTaskDetailPanel()` 还在写它的 `textContent`，只是 `display: none`）。
- **右**（同一组按钮，按 `order`/显隐随态变化）：

  | 态 | 可见按钮（从左到右） |
  | -- | ------ |
  | 收起态 | 方形 ghost `fa-list-ul`/`fa-edit` 切换模式 → 方形 ghost `fa-expand` 展开书写 → 方形 ghost `fa-times` 关闭面板 |
  | 书写态 | **圆形** `fa-text-width` 正文宽度（**purple-500**）→ **圆形** `fa-list-ul`/`fa-edit` 切换模式（**indigo-500**）→ **圆形** `fa-arrow-left` 返回（**slate**，与「设置节假日与调休」返回按钮一致） |

  **模式切换按钮（`#toggle-mode-btn`）第五轮起两态都可见**。DOM 顺序是
  `#detail-width-btn → #toggle-mode-btn → #detail-expand-btn → #detail-dismiss-btn`，
  收起态 `width-btn` 隐藏、书写态 `expand-btn` 隐藏 —— 两种态下模式按钮都恰好落在最右按钮的左边。
  图标由 `openTaskDetailPanel()` / `toggleTaskMode()` 写成 `fa-list-ul`（当前文本模式）或
  `fa-edit`（当前子任务模式），两态共用同一份渲染。

  **第六轮：书写态右上角改成与主视图 `#header-actions` 同规格的圆形图标按钮**（详细见 4.7.3）。
  收起态**保持现状的方形 ghost 按钮**（用户明确只要改展开态）。

- **样式（书写态，第六轮）**：`padding: 28px 24px 12px 24px` —— 顶边 28px、右边 24px，
  正好对齐主视图 `#header-actions` 圆形按钮的实测坐标（y=28、右边缘距视口右 24px）。
  面包屑侧也用同一份 24px 留白，让左下「摘要条」与右上按钮对齐到同一个 24px 网格。
- **对齐**：面包屑所在内层容器与正文容器**共用同一 max-width 与 padding**

> 为什么这样能解决割裂：顶栏不再承载"标题"语义（标题已下放到正文 H1），
> 它只是一条导航 chrome；同时面包屑与正文共享左边缘，屏幕上只有**一条**对齐线。

### 4.2 正文容器 · 宽度三档（已拍板）

不新增包裹容器：面板是 `flex flex-col`，让顶栏内容、标题行、属性区、正文、标签区
**各自**套同一个 max-width 居中，视觉上就是一条完整的竖列（避免插入 `#detail-canvas`
改变 picker 的定位祖先）。

```css
body.detail-write-mode            { --wm-width: 720px; --wm-pad: 24px; }  /* standard */
body.detail-write-mode.wm-w-900   { --wm-width: 900px; }                  /* wide     */
body.detail-write-mode.wm-w-full  { --wm-width: 100%; --wm-pad: 40px; }   /* full     */
body.detail-write-mode #detail-topbar > :first-child,
body.detail-write-mode #detail-title-row,
body.detail-write-mode #detail-time-menu,
body.detail-write-mode #detail-body,
body.detail-write-mode #detail-tags-display,
body.detail-write-mode #progress-container {
    width: 100%;
    max-width: calc(var(--wm-width) + var(--wm-pad) * 2);
    margin: 0 auto;
    padding-left: var(--wm-pad);
    padding-right: var(--wm-pad);
}
```

- **standard（默认）** 720px — Notion 标准可读宽度
- **wide** 900px
- **full** 拉满可用宽度（`100%` + 40px 内边距）

切换入口两处，共享 `settings.writeModeWidth`：

1. 顶栏右侧图标按钮 `#detail-width-btn`（`fa-text-width`），点击循环 720 → 900 → 全屏
2. 设置 → 视图与外观 → **书写态正文宽度**（下拉，作为默认档）

- 收起态不受影响（上述规则全部在 `body.detail-write-mode` 作用域内）
- 移动端（<769px）不套用，展开态即全屏弹层

### 4.3 H1 标题行

- 复用 `#detail-task-title` 与完成圈 `#detail-task-complete-btn`
- 展开态：完成圈 28px 与标题第一行基线对齐；标题 `font-size: 32px; line-height: 1.3; font-weight: 600`
- placeholder 由「任务标题」改为「无标题」
- **不加边框、不加背景**（现有本就是 `bg-transparent border-none`，只需放大字号）
- ⚠️ **必须放开 `max-height`**：`#detail-task-title` 上有内联 `style="max-height:120px"`，
  32px 字号一行约 41.6px，写满三行就超出被裁（表现为「下半部分看不到」）。
  展开态用 `max-height: 320px !important` 覆盖（内联样式只能用 `!important` 压过），
  并在进入书写态时调一次 `autoResizeTextarea()` 重算高度。

### 4.4 设置时间区：摘要 → 点击展开（与收起态同一套）

> 这一节的方案改过三次：
> 1. 初版「Notion 属性行」—— 把 4 个时间字段做成常驻的属性列表
> 2. 第二轮改成「平铺一行」+ 按空值过滤
> 3. **第三轮（当前）推翻了前两次**：回到与收起态完全一致的两级结构
>    —— 默认只显示任务时间摘要，点击才展开完整设置。
>    理由：平铺 / 属性行都把「时间段 / 清除时间 / 跳过此周期 / 撤销」这些按钮挤掉了，
>    功能对不上；而且按空值过滤会让「提醒 / 重复」在未设置时**无法点击设置**。

**做法**：`#detail-time-menu` 保持收起态的 `hidden` 开关语义，书写态只是把它换一种排版。

```css
/* 摘要条（书写态专属触发入口，居中于正文容器） */
body.detail-write-mode #detail-time-trigger-wm {
    order: 2; align-self: center; border-radius: 9999px;
    border: 1px solid var(--border-color); padding: 4px 12px; font-size: 13px;
}
/* 展开态：:not(.hidden) 是关键 —— 否则 !important 的 display 会压过 Tailwind 的 .hidden，
   菜单会永远展开 */
body.detail-write-mode #detail-time-menu:not(.hidden) {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 14px;
    border: 1px solid var(--border-color) !important;
    border-radius: 10px;
    padding: 12px 14px !important;
}
@media (min-width: 1024px) {
    body.detail-write-mode #detail-time-menu:not(.hidden) {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }
}
/* 两个 .grid 容器退化为「透明盒子」，让字段直接参与上面的网格 */
body.detail-write-mode #detail-time-menu > .grid:not(.hidden) { display: contents !important; }
/* 首行（「时间」标题 + 跳过此周期 / 撤销 / 时间段 / 清除时间）横跨整行 */
body.detail-write-mode #detail-time-menu > div:first-child { grid-column: 1 / -1; }
```

- **触发入口**：`#detail-time-trigger-wm`（`wm-only`，书写态显示）内部是四个
  `button.wm-time-seg`，每段都挂 `onclick="toggleDetailTimeMenu()"` —— 与收起态顶栏的
  「设置时间」按钮**共用同一个函数**，所以外部点击关闭、订阅任务拦截等既有逻辑全部复用，无需改。
- **摘要文案**：`updateDetailTimeBtnText()` 拆成两个出口 ——
  ① 收起态顶栏按钮 `#detail-time-btn-text` 仍写单行长文案（逻辑一字未动）；
  ② 书写态交给 `setWriteModeTimeSegments()` 逐段写入（见 4.4.3）。
- **默认收起**：`syncWriteModeTimeMenu()` 在进入书写态时强制 `classList.add('hidden')`，
  保证「默认只显示任务时间」。
- **`:not(.hidden)` 是必需的**：`#detail-end-time-container` 的显隐由 `hidden` 类控制，
  写成无条件 `display:grid !important` 会让它永远显示（这个坑踩过两次）。
- **所有按钮与功能与收起态一致**：首行四个按钮（跳过此周期 / 撤销 / 时间段 / 清除时间）
  原样保留在展开面板顶部，不做任何隐藏。

**⚠️ 不要用 `repeat(auto-fit, minmax(200px, 1fr))`**（第三轮踩到的真坑）：

`auto-fit` 在**固有尺寸（intrinsic sizing）阶段**会按容器的 `max-width` 推出 4 条 200px 轨道，
于是网格的 `min-content` 约 **872px**；而 `#task-detail-panel` 是 flex 项，
其自动最小尺寸 = `min-content` → **面板被撑到 872px 宽，在 1024px 及以下的窗口里整块溢出**。
（加 `min-width: 0` 也没用：flex 项在**列**方向的 min-content 贡献不受 `min-width` 削减。）

显式列数 + `minmax(0, 1fr)`（最小轨道为 0）→ min-content ≈ 0，面板正常收缩。
实测（`--wm-width: 900px`，菜单展开）：1600→面板 1340 / 4 列 219px；1024→764 / 4 列 173px；
800→540 / 2 列 248px；769→509 / 2 列 232px，**任何宽度都不溢出**。

**⚠️ 绝不能给 `#detail-time-menu` 加包裹层**（第二轮踩过）：

Tailwind 的 `space-y-3` 生成的是 `.space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: ... }`，
它**只作用于直接子元素**。一旦把内部各行包进一个新 div，这些行就不再是直接子元素，
`space-y-3` 全部失效 → **收起态下各行失去间距、挤在一起**（就是「设置时间布局错误重叠」）。

### 4.4.3 摘要条：分段可点（第四轮拆段 → 第五轮合并日期与时间）

> 第四轮改动。第三轮的摘要条是一颗胶囊 + 一整串文案（`2026-10-01 14:00 · 提前 15 分钟 · 每周三`），
> 信息挤在一起、也看不出哪部分对应哪个设置。于是沿用**旧版属性行的「图标 + 值」显示规则**，
> 拆成若干独立属性，每段单独可点。
>
> **第五轮修正**：拆成「日期」「时间」两段后，跨天任务会裂成两格
> （`1月2日` ｜ `22:00 - 1月3日 02:00`），读起来断裂。现在**把日期与时间合并回同一个信息格**，
> 直接复用收起态顶栏按钮的**同一份字符串** —— 显示规则完全一致，跨天才连贯。

| 段 | `data-part` | 图标 | 内容来源 | 空值判定 |
| ---- | ---- | ---- | ---- | ---- |
| 日期+时间 | `datetime` | `far fa-calendar` | 与收起态顶栏按钮**同一份** `text`（含跨天 / 全天 / 时间段写法） | 无日期 → 隐藏 |
| 提前 | `reminder` | `fas fa-bell` | `#detail-reminder-text` | 等于 `REMINDER_EMPTY_LABEL`（不提前提醒）→ 隐藏 |
| 重复 | `repeat` | `fas fa-redo` | `#detail-repeat-text` | 等于「不重复」→ 隐藏 |
| 占位 | `empty` | `far fa-calendar` | 固定「设置时间」 | 只要上面三段有任意一段有值就隐藏 |

`datetime` 段的文案 = `updateDetailTimeBtnText()` 里算出的 `text`，即：

| 场景 | 摘要格文案 |
| ---- | ---- |
| 仅日期（全天） | `10月8日 (全天)` |
| 日期 + 时间 | `10月8日 09:30` |
| 同日时间段 | `10月8日 09:30 - 11:00` |
| 跨天时间段 | `10月8日 22:00 - 10月9日 02:00` |
| 跨天全天 | `10月8日 - 10月11日 (全天)` |
| 跨年时间段 | `12月31日 23:00 - 2027年1月1日 01:00` |
| 无日期 | 该段隐藏（回落到 `empty` 占位「设置时间」） |

- **DOM 顺序即显示顺序**，容器 `display: flex; flex-wrap: wrap; justify-content: center`，
  段间距 `gap: 0 2px`，每段自带 `padding: 3px 8px; border-radius: 6px`，
  悬浮时给一段浅底（`--bg-tertiary`）作为可点提示 —— 容器本身**不再有胶囊边框**。
- **提醒 / 重复不要求先有任务时间**：与 `refreshDetailSkipCycleButton()` 的口径一致
  （「只要配置了重复就显示跳过按钮，不要求已设置时间」）。所以「清除时间」后如果重复配置还在，
  摘要条会只剩一段「每周」—— 这是**刻意的**，比收起态按钮显示的「设置时间」更如实。
- **同步时机**：`updateDetailTimeBtnText()` 是唯一出口（**一份数据两个出口**：同时写收起态
  `#detail-time-btn-text` 与书写态各段）；`updateDetailReminderText()` 与
  `updateDetailRepeatText()` 结尾各追加一次调用，这样改提醒 / 改重复后摘要条立刻跟上。
- **隐藏必须自带 `!important`**：`body.detail-write-mode .wm-time-seg.hidden { display: none !important; }`
  —— `.wm-time-seg` 的 `display: inline-flex` 与 Tailwind 的 `.hidden` 特指度相同，
  谁后注入谁生效，不能赌注入顺序。

实测（第五轮，主版与离线版一致；逐场景驱动输入后读摘要格）：

```
仅日期（全天）  : 摘要格="10月8日 (全天)"              收起态按钮同串  一致=Y
日期+时间      : 摘要格="10月8日 09:30"               一致=Y
同日时间段     : 摘要格="10月8日 09:30 - 11:00"        一致=Y
跨天时间段     : 摘要格="10月8日 22:00 - 10月9日 02:00"  一致=Y
跨天全天       : 摘要格="10月8日 - 10月11日 (全天)"      一致=Y
跨年时间段     : 摘要格="12月31日 23:00 - 2027年1月1日 01:00"  一致=Y
清除时间       : 摘要格隐藏，收起态按钮="设置时间"
点 datetime 段 : 菜单展开=true      再点 repeat 段 → 菜单收起（toggle）
```

**第六轮：摘要条不再居中，与任务标题文字居左对齐。**

实现：把 `#detail-time-trigger-wm` 加进与 `#detail-title-row` 共用的容器规则
（`width:100%; max-width:calc(--wm-width + 2*--wm-pad); margin-left:auto; margin-right:auto`），
再把 `padding-left` 补成 `calc(var(--wm-pad) + 40px)`，多出的 40px = 完成圈 28px +
`#detail-title-row` 的 `gap-3` 12px，正好把摘要条首段的左边缘推到**标题文字**
（`#detail-task-title`）所在的 x≈610 竖线上。同时 `justify-content: flex-start`
（不再居中）、`align-self: stretch`（取消 `align-self: center`，因为现在宽度由容器规则锁定了）。

实测（1600 视口，--wm-width 720 / --wm-pad 24）：

```
标题行内容左边缘 = 570.5   完成圈 = 570.5   标题文字 = 610.5   正文 = 570.5
摘要条首段左边缘 = 610.5  ← 与标题文字完全重合（差 0px）
```

宽度横扫（1600/1440/1280/1024/900/800）：摘要条首段左边缘始终与标题文字左边缘相等
（差 0px），窄视口被容器的 `max-width` 夹住。

### 4.4.1 空属性过滤：已废弃

第三轮把「按任务值过滤空属性」整体删掉（`updateWriteModeProps()` / `wm-prop-empty` /
`wm-prop-label` 全部移除）。原因：展开面板里**所有字段都必须可点可填**，
把「提醒 = 不提前提醒」这种"空值"行隐藏掉，用户就再也设不了提醒了。

### 4.4.2 排版顺序：用 flex `order`，不动 DOM

`#detail-time-menu` 在 DOM 里位于 `#detail-title-row` **之前**（收起态点「设置时间」时，
菜单从顶栏下方推出来，位置在标题上方）。书写态希望它出现在标题下方，但改 DOM 顺序会破坏收起态。

因此书写态给面板的每个直接子元素显式指定 `order`：

| 子元素 | order |
| ---- | ---- |
| `#detail-topbar` | 0 |
| `#detail-title-row` | 1 |
| `#detail-time-trigger-wm` | 2 |
| `#detail-time-menu` | 3 |
| `#detail-body` | 4 |
| `#detail-timestamps-display` | 5 |
| `#detail-tags-display` | 6 |
| `#progress-container` | 7 |
| `#detail-actions` | 8 |

⚠️ 默认 `order` 全是 0，所以**必须逐个写全**；漏掉任何一个都会让它跳到标题上方。
副作用：Tab 焦点顺序仍是 DOM 顺序（顶栏 → 菜单 → 摘要条 → 标题 → 正文），与视觉顺序不完全一致。
本应用为个人本地工具，接受这一点。

### 4.5 正文笔记区

复用 `#detail-task-notes`（`index.html:3286`）：

- `font-size: 16px; line-height: 1.8`（现有未指定行高，展开态收紧为阅读友好值）
- `min-height: 42vh`，让它看起来像一张可延展的纸
- `padding-bottom: 46vh`（**第十一轮**）：滚到底时最后一行上方留约半屏空白 → 「最后一行」落在屏幕垂直中部（书写视觉中部）。⚠️ `_textElContentHeight` 量毛玻璃带底边时**必须扣除这段 padding**（见 10.11）
- 正文框**自身是滚动容器**（上述 padding 撑出可滚空间）；毛玻璃带底边须按「框顶 + 内容高 − `scrollTop`」计算并随滚动重算，否则带子会一直铺到屏幕底（见 10.12）
- placeholder 改为「开始输入…」
- 保持 `bg-transparent border-none outline-none resize-none`
- 编写区**一直延伸到屏幕最底部**：底部集群（时间戳/标签/进度/按钮）包进 `#detail-dock` 绝对定位到面板底，从文档流脱出（见 4.8 / 10.11）

### 4.6 子任务区

复用 `#subtask-content`（`index.html:3289-3302`），展开态改为 Notion to-do block 观感：

- `☐ + 文本` 一行为一块，行高 28px
- hover 行显示删除/拖拽句柄（沿用现有 `#subtask-manage-btn` 的 opacity 占位写法，避免重排）
- 不改动任何逻辑，纯样式

### 4.7 右下角操作簇 — 解决 P1

现有底部按钮区（`index.html` 的 `#detail-actions`）在展开态整体改为
**文档流内右对齐**的一排圆钮（第三轮起不再绝对定位，理由见 4.7.2）：

```css
body.detail-write-mode #detail-actions {
    order: 8;
    align-self: flex-end;          /* 右对齐到面板右侧 */
    margin: 0 24px 24px 0;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 0;
    border-top: none !important;
    background: transparent;
}
```

簇内按钮（**全部 40px 正圆**，无主操作例外）：

| 顺序（左→右） | 按钮 | 复用 | 主题色 | 语义 |
| - | ---- | ---- | ------ | ---- |
| 1 | ⭐ 重要 | `#detail-task-important` | `#eab308` yellow | 复用（激活态为 0.15 淡色内联底） |
| 2 | 🔥 紧急 | `#detail-task-urgent` | `#f97316` orange | 同上 |
| 3 | 🏷 标签 | `#detail-tag-btn` → `toggleDetailTagPicker()` | `#14b8a6` teal | 点击弹气泡 |
| 4 | 📁 清单 | `#detail-list-btn` → `toggleDetailListPicker()` | **`var(--accent-color)` 主题强调色**（第四轮改，原 `#6366f1`） | 点击弹气泡（清单名在书写态隐去） |
| 5 | ▶ 开始专注 | `#detail-focus-btn` | `#22c55e` green | 见 4.7.1（图标＝实心时钟，第十轮改） |
| 6 | 🗑 删除 | `#detail-delete-btn` | `#ef4444` red | 复用（已有二次确认，见下） |

> 顺序由 DOM 决定：第 1 行 `重要 / 紧急 / 标签 / 清单`，第 2 行 `开始专注 / 删除`（**第十轮对调**，原为 `删除 / 开始专注`），
> 书写态把两行拉平成一条（`#detail-actions > div { margin-bottom: 0 }`）。

**🎨 图标范式：默认态圆形空心描边 / 悬浮态实心填充 + 白图标（第二轮拍板）**

参考主视图右上角 `#header-actions` 的「添加任务 / 顺延任务」等图标——即：

```css
/* 统一几何：40px 正圆 + 2px 描边 + 同色图标 */
body.detail-write-mode .wm-circle {
    flex: none !important;           /* 压过按钮原来的 flex-1（否则会被拉成横条） */
    display: flex !important;
    align-items: center;
    justify-content: center;
    width: 40px; height: 40px;
    padding: 0;
    border-radius: 9999px !important;/* 压过二次确认态内联的 border-radius: 0.5rem */
    border-width: 2px;
    border-style: solid;
    font-size: 15px;
    background: transparent;         /* ← 见下，刻意不加 !important */
}
body.detail-write-mode .wm-circle i { margin: 0 !important; color: inherit !important; }

/* 每个按钮一组：默认描边 + 同色图标，悬浮实心填充 + 白图标 */
body.detail-write-mode #detail-tag-btn       { border-color: #14b8a6 !important; color: #14b8a6 !important; }
body.detail-write-mode #detail-tag-btn:hover { background: #14b8a6 !important; border-color: #14b8a6 !important; color: #fff !important; }
/* 重要 #eab308 / 紧急 #f97316 / 专注 #22c55e / 删除 #ef4444，写法同上 */
/* 清单：用主题强调色（第四轮改） */
body.detail-write-mode #detail-list-btn       { border-color: var(--accent-color, #3b82f6) !important; color: var(--accent-color, #3b82f6) !important; }
body.detail-write-mode #detail-list-btn:hover { background: var(--accent-color, #3b82f6) !important; border-color: var(--accent-color, #3b82f6) !important; color: #fff !important; }
```

**⚠️ `.wm-circle i { color: inherit !important }` 是必需的（第四轮修）**

只写按钮的 `color` 是**不够的**：`<i>` 上挂着 Tailwind 的 `text-*-500`
（标签 `text-green-500`、紧急 `text-red-500`），清单图标更是 JS 按清单色写的**内联** `color`
（`updateDetailListBtnStyle()` 里 `listIcon.style.color = selectedList.color`）。
子元素自己的颜色会盖住继承来的按钮色，于是**悬浮实心填充时彩色图标压在实色圆上**，
观感割裂。实测对照（进入书写态后的 computed `color`）：

| 按钮 | 描边 | 修前图标 | 修后图标 | 悬浮 |
| ---- | ---- | ---- | ---- | ---- |
| 标签 | `rgb(20,184,166)` | `rgb(34,197,94)` 绿 ✗ | 同描边 ✓ | 白 ✓ |
| 清单 | `rgb(82,147,224)` | `rgb(59,130,246)` 蓝 ✗ | 同描边 ✓ | 白 ✓ |
| 重要 | `rgb(234,179,8)` | 同色 ✓ | 同色 ✓ | 白 ✓ |
| 紧急 | `rgb(249,115,22)` | `rgb(239,68,68)` 红 ✗ | 同描边 ✓ | 白 ✓ |
| 专注 / 删除 | 绿 / 红 | 同色 ✓ | 同色 ✓ | 白 ✓ |

`color: inherit` 一次管住**默认 / 悬浮实心 / 删除二次确认**三态（因为三态都只是改按钮的 `color`）。
**必须限定在 `body.detail-write-mode` 内** —— 收起态是刻意让图标独立着色的
（中性灰方框 + 彩色图标），改了会破坏收起态。

**清单为什么换成主题强调色**：它原来按清单自身颜色着色，与这里的描边色对不上，
也让「描边色 = 图标色」这条范式在它身上失效。改用 `var(--accent-color)`
（浅色主题 `#3b82f6`、深色 `#60a5fa`，用户可在设置里改强调色）后六个钮完全一致。

**⚠️ 背景必须 `transparent`，且不能加 `!important`（第三轮修）**

- **为什么是透明**：原来写的是 `background: var(--bg-secondary, #fff)`。开着背景图时
  `--bg-secondary` 是深色（实测 `#282d33`），于是圆钮默认态成了一块黑底；
  而 `#header-actions` 的按钮**本来就是透明底**（只有 `hover:bg-{color}`）。
  改成 `transparent` 才真正一致。
- **为什么不能加 `!important`**：重要 / 紧急的**激活态**是
  `updateDetailPriorityButtons()` 写的**内联 `background-color: rgba(..., 0.15)`**（无 `!important`）。
  若这里加 `!important`，样式表 `!important` 会**盖掉内联**，激活态就没了淡色底。
  不加时：内联自然生效；而 `:hover` 规则带 `!important`（且 `#id:hover` 特指度高），
  仍能压过内联 → 悬浮实心不受影响。

**⚠️ 为什么颜色规则要 `!important`**：同上，内联样式优先级高于普通 CSS 规则，
不加 `!important` 压不住激活态 → 激活后悬停会「半死不活」。

每个按钮在 HTML 里挂 `wm-circle` 类即可（原有的 `w-10 h-10 rounded-lg border border-theme
text-theme-secondary hover:bg-theme-tertiary` 等 Tailwind 类会被上述规则覆盖）。

**⚠️ 三轮修掉的具体问题**：

| 轮次 | 问题 | 根因 | 修复 |
| - | ---- | ---- | ---- |
| 2 | 「所属清单」图标错位 | `#detail-list-btn` 漏了 `wm-circle`，宽度被内容撑开 | 补 `wm-circle` + `#detail-list-name { display:none }` |
| 2 | 「删除任务」只有文字 | 补的 `<i class="fas fa-trash wm-only">` **每次打开面板都被抹掉** | 见下 |
| 3 | 同上（第二轮没修好） | `openTaskDetailPanel()` 里 `deleteBtn.textContent = '删除任务'` —— `textContent` setter **会清空所有子节点**，把图标一起删掉 | 新增 `setDetailDeleteLabel()`，只写 `<span id="detail-delete-label">` 的文本 |
| 3 | 开始专注 / 删除任务比别的钮大 | 开始专注挂着 `.wm-focus`（48px 主操作） | 第三轮**取消主操作尺寸**，删掉 `wm-focus` 类与规则，6 个钮统一 40px |

**删除按钮的二次确认态（第三轮重做）**

原来确认态靠 `btn.textContent = '确认删除'` + 内联 `cssText` 把它涂成红底方块。
书写态里这既丢了图标、又变成方角。现在改为：

- JS 加 `is-confirming` 类（不再依赖文字），文字仍写进 `#detail-delete-label`
- `body.detail-write-mode #detail-delete-btn.is-confirming` → 红色实心圆 + 白图标
- `.wm-circle` 的 `border-radius: 9999px !important` 保证内联的 `0.5rem` 压不进来

**💾 保存按钮：书写态下移除（已拍板）**

展开态没有保存按钮，靠**自动保存**：标题 / 备注的 `input` 事件触发防抖保存，
间隔取自 `settings.autoSaveDelay`（默认 500ms，可在设置中调整）。

配套的兜底（都已实现）：

- 退出书写态 / 关闭面板 / 切换任务前调用 `flushWriteModeAutoSave()` 立即落盘
- 点「开始专注」/「删除任务」前先 `exitDetailWriteMode()`，同样会 flush
- 自动保存走 `saveTaskDetailWithoutClose()`（空标题跳过不写、面板保持打开），
  **不**走 `saveTaskDetail()`——后者 `fallbackTitle:true` 会把空标题兜底成「未命名任务」并关闭面板

### 4.7.1 开始专注按钮（第十轮改：图标＝实心时钟）

> 第十轮用户要求：展开态「开始专注」按钮图标改为**如侧边栏「番茄专注」（`#sidebar-pomodoro-btn`）那样的实心时钟**。

- 侧边栏「番茄专注」用的是**单个实心图标** `<i class="fas fa-clock"></i>`。
- 展开态 `#detail-focus-btn` 现同样只用**一个实心时钟** `<i class="fas fa-clock mr-1"></i>`，
  **不再**复用任务卡片的 `pomodoro-focus-btn` + `pf-icon-outline` / `pf-icon-solid`
  双图标（描边↔实心切换）机制；`pomodoro-focus-btn` 类已从该按钮移除。
- 悬浮态仍走既有规则：`#detail-focus-btn:hover` 实心填充绿底 + 白图标（`index.html` 书写态块）。
- 仅 `onclick` 与卡片不同——详情页走 `startPomodoroForTaskFromDetail()`（内部即 `startPomodoroForTask(currentDetailTaskId)`）。
- 注：视图里任务卡片（`utils.js renderFocusButton()`）仍保留双图标机制，未改。

**尺寸**：第三轮已**取消**「主操作放大到 48px」的做法，改为与其余按钮一致的 **40px**。
理由：一排里只有它大一号，视觉上像没对齐；用户明确要求「参考紧急图标大小进行调整」。
它的主题色取 `#22c55e`（green），与 `renderFocusButton()` 的 `text-green-600` 同色系。

### 4.7.2 标签 / 进度停靠区（第三轮新增）

需求：「将任务详情正文下方的标签显示与进度显示移动至右下角按钮的上方（与按钮宽度一致）」。

**做法**：不再让它们横跨整栏，而是收窄成 **280px**（= 6 个 40px 圆钮 + 5 个 8px 间隙）
右对齐，并**回到文档流**（原来是 `position:absolute` 悬浮）：

```css
body.detail-write-mode #detail-tags-display {
    order: 6;
    align-self: flex-end;          /* 右对齐 */
    width: 280px;
    margin: 0 24px 8px 0 !important;
    padding: 0 !important;
    border-top: none !important;
    justify-content: flex-end;     /* 标签靠右排 */
    max-height: 72px; overflow-y: auto;
}
body.detail-write-mode #progress-container {
    order: 7;
    align-self: flex-end; width: 280px;
    margin: 0 24px 8px 0 !important;
    border-top: none !important; border-radius: 8px;
    padding: 6px 8px !important; background: var(--bg-tertiary);
    overflow: hidden;              /* 让内部的进度条被圆角裁掉 */
}
body.detail-write-mode #detail-actions { order: 8; align-self: flex-end; margin: 0 24px 24px 0; }
```

**为什么改成文档流而不是继续 `absolute`**：悬浮定位需要给正文预留 `padding-bottom`
去躲开它们，而标签行高随内容变化，留多少都是猜。回到文档流后 `#detail-body` 是 `flex-1`，
自然把停靠区顶到底部，**不会遮挡正文**，也不用再留 96px 的空白。

**第六轮：进度条只描边、不填底**。原先 `background: var(--bg-tertiary)` 在深色主题下
看着就是一块深色块，现在改为 `border: 1.5px dashed var(--accent-color, #3b82f6) !important;
background: transparent !important` —— 中间与背景同色，用一圈虚线强调色提示「可拖拽调整」。
**非背景图与背景图两种模式统一**（背景图模式之前就是虚线，现在非背景图也长一样）。
`backdrop-filter: none` 也放进通用规则，避免叠层模糊。

### 4.7.3 书写态右上角圆形图标按钮（第六轮新增）

需求：「在展开态中，右上角的图标参考主视图中右上角的『添加任务』『视图配置』等按钮
进行风格一致性设计（圆形图标，默认态 / 悬浮态 / 按下态风格一致），其中『返回（Esc）』
按钮可直接使用『设置节假日与调休』界面的返回按钮。并保持其按钮位置与主视图中的
圆形图标按钮位置一致。」

**做法**：复用主视图 `#header-actions` 的范式（`w-10 h-10 rounded-full border-2 ...`，
40×40 圆形 + 2px 描边 + 同色图标），补上「按下态」（取自节假日页返回按钮的
`active:bg-*-600 active:scale-95` —— 它是全站唯一带 active 态的圆形钮）。
顶栏内边距改为 `padding: 28px 24px 12px 24px`，把按钮推到主视图实测坐标
（y=28、右边缘距视口右 24px）。**只作用于书写态**：收起态的 `#detail-width-btn` /
`#toggle-mode-btn` / `#detail-dismiss-btn` 仍是方形 ghost 按钮（用户明确只要改展开态）。

```css
/* 几何：与主视图 #header-actions 同规格 */
body.detail-write-mode #detail-topbar > div:last-child { gap: 12px; }   /* 主视图 gap-3 */
body.detail-write-mode #detail-width-btn,
body.detail-write-mode #toggle-mode-btn,
body.detail-write-mode #detail-dismiss-btn {
    width: 40px; height: 40px; padding: 0;
    border-radius: 9999px !important;       /* 圆角不可被覆盖 */
    border: 2px solid;
    display: flex !important; align-items: center; justify-content: center;
    background: transparent;
    transition: background-color .15s, border-color .15s, color .15s, transform .1s;
}
/* 图标继承按钮色：否则 <i> 自带的 text-theme-muted 会盖住描边色 */
body.detail-write-mode #detail-width-btn i,
body.detail-write-mode #toggle-mode-btn i,
body.detail-write-mode #detail-dismiss-btn i {
    margin: 0 !important; color: inherit !important; font-size: 15px;
}

/* 配色：正文宽度 purple / 模式切换 indigo / 返回 slate */
body.detail-write-mode #detail-width-btn {
    border-color: #a855f7 !important; color: #a855f7 !important;
}
body.detail-write-mode #detail-width-btn:hover {
    background: #a855f7 !important; border-color: #a855f7 !important; color: #fff !important;
}
body.detail-write-mode #detail-width-btn:active {
    background: #9333ea !important; border-color: #9333ea !important; color: #fff !important;
    transform: scale(.95);
}
body.detail-write-mode #toggle-mode-btn {
    border-color: #6366f1 !important; color: #6366f1 !important;
}
body.detail-write-mode #toggle-mode-btn:hover {
    background: #6366f1 !important; border-color: #6366f1 !important; color: #fff !important;
}
body.detail-write-mode #toggle-mode-btn:active {
    background: #4f46e5 !important; border-color: #4f46e5 !important; color: #fff !important;
    transform: scale(.95);
}
/* 返回按钮直接复用节假日页范式：slate-400 描边 / slate-500 文字 / 悬浮 slate-500 /
   按下 slate-600 + scale-95 */
body.detail-write-mode #detail-dismiss-btn {
    border-color: #94a3b8 !important; color: #64748b !important;
}
body.detail-write-mode #detail-dismiss-btn:hover {
    background: #64748b !important; border-color: #64748b !important; color: #fff !important;
}
body.detail-write-mode #detail-dismiss-btn:active {
    background: #475569 !important; border-color: #475569 !important; color: #fff !important;
    transform: scale(.95);
}
```

实测（`verify_round6.js`，主版与离线版结果完全一致；按下态通过「摘掉 onclick + mouse.down
→ 读 computed style → mouse.up」避免真的触发 click 退出书写态）：

```
三钮都是 40x40 圆 + 2px 实线描边 = Y   右边缘=1576(=1576? Y)   顶边=28(=28? Y)
配色：正文宽度=rgb(168, 85, 247)(purple-500)
     模式切换=rgb(99, 102, 241)(indigo-500)
     返回    =border rgb(148, 163, 184)(slate-400) + text rgb(100, 116, 139)(slate-500)
三态：
  width-btn      默认 bg=透明 图标=purple  | 悬浮 bg=purple 图标=#fff | 按下 bg=purple-600 transform=scale(.95)
  toggle-mode-btn 默认 透明 图标=indigo    | 悬浮 bg=indigo 图标=#fff | 按下 bg=indigo-600 transform=scale(.95)
  dismiss-btn    默认 透明 图标=slate-500  | 悬浮 bg=slate-500 图标=#fff | 按下 bg=slate-600 transform=scale(.95)
```

收起态基线（应无回归）：`toggle-mode-btn {w:32, h:40, radius:8px, border:0px}`,
`detail-dismiss-btn {w:28, h:40, radius:8px, border:0px}` —— 仍是方形 ghost。

⚠️ 注意 `#detail-tags-display` / `#progress-container` 已从「与正文同宽的居中列表」中**移除**
（原先它们在 `max-width: calc(--wm-width + --wm-pad*2)` 那一组里）。

实测（`--wm-width: 900px`，1600 视口）：标签 `x=1296 y=822 280×20`、进度 `x=1296 y=850 280×28`、
按钮簇 `x=1296 y=886 280×40` —— 三者左边缘完全对齐，间距 8px。

**⚠️ 第四轮补丁：`#detail-actions` 必须显式 `position: relative`**（修一个既有 bug）

`#detail-list-picker` / `#detail-tag-picker` 用的是 `position: absolute; bottom: 100%; right: 0`
（意图是「锚定在簇上方的气泡」），但 `#detail-actions` 是 flex 项、`position` 仍是 `static`，
于是它们的包含块退到了 `#task-detail-panel` —— **`bottom: 100%` 直接把气泡顶到面板上方**。
实测：`#detail-tag-picker` 打开后 `y = -102`（高 102px），**完全在视口外，根本点不到**。

```css
body.detail-write-mode #detail-actions { position: relative; }
```

修完实测：`actions = {x:1296, y:886, w:280, h:40}`、`picker = {x:1296, y:784, w:280, h:102}`
—— 在视口内、且在按钮簇正上方，与注释里写的意图一致。

> **第十轮追加（气泡底边对齐虚线框 + 圆角一致）**：用户要求标签/清单气泡的底边与上方虚线框
> `#progress-container` 底边对齐、两者圆角一致。虚线框在 `#detail-actions` 上方 8px
> （`#progress-container` 的 `margin-bottom:8px`），故气泡由 `bottom:100%` 改为
> **`bottom: calc(100% + 8px)`**，并加 **`margin-bottom: 0 !important`**（HTML 上带 `mb-3`=12px，
> 不清会让气泡整体上移 12px、与虚线框底错位），`border-radius: 8px` 与虚线框一致。
> 实测 `picker.bottom = box.bottom = 878`（差 0px），圆角双方均 `8px`。

### 4.8 背景与留白

- 沿用上游 2.3：叠加极淡专注底色（非遮罩、不遮挡内容）
- 正文区上下留白：顶部 40px、底部 16px
- **底部停靠区（第十一轮起）绝对定位到面板底部**（`#detail-dock`），不再占文档流高度 → 正文滚动区一直延伸到底；`padding-bottom:46vh` 让滚到底时最后一行落在屏幕中部（见 4.5 / 10.11）

**背景图片模式（`body.has-bg-image`）下的毛玻璃 —— 第四轮重做，第五轮收敛**

原来 `body.has-bg-image #task-detail-panel.bg-theme-secondary` 会给**整块面板**加
`backdrop-filter`，于是书写态下整个区域（含正文列左右两侧的大片留白）都被糊掉，
背景图只剩下「一片糊」。第四轮改成两块独立毛玻璃，第五轮进一步**只保留正文列这一块**：

| 区域 | 实现 | 宽度 |
| ---- | ---- | ---- |
| 正文列 | `#task-detail-panel::before`，`top:var(--wm-glass-top,0); bottom:var(--wm-glass-bottom,0); left:50%; transform:translateX(-50%)`（纵向范围由 JS `updateWriteModeGlassBounds` 按文字位置动态算、并随正文框滚动重算，见 10.9 / 10.12） | `calc(var(--wm-width) + var(--wm-pad) * 2)`，`max-width: 100%` |
| 右下停靠区 | ~~三块各自 `backdrop-filter`~~ → **第五轮取消，保持全透明** | 各 280px，右对齐 24px |

```css
/* 面板自身的模糊必须撤掉，否则和子元素的模糊叠加成双层 */
body.has-bg-image.detail-write-mode #task-detail-panel,
body.has-bg-image.detail-write-mode #task-detail-panel.bg-theme-secondary {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}
/* 正文列玻璃带：z-index:-1 压在内容之下，否则会把文字一起糊掉。
   纵向范围由 JS 动态设定（见 10.9 / 10.12）：top/bottom 不再是 0/0 贯穿整屏，
   而是「标题顶端 -> 详情文本最后一行」，且底边随正文框滚动跟随（滚到底时止于屏幕中部）。
   未计算时回退整高（top:0 bottom:0）。 */
body.has-bg-image.detail-write-mode #task-detail-panel::before {
    content: '';
    position: absolute;
    top: var(--wm-glass-top, 0);
    bottom: var(--wm-glass-bottom, 0);
    left: 50%;
    transform: translateX(-50%);
    width: calc(var(--wm-width) + var(--wm-pad) * 2);
    max-width: 100%;
    backdrop-filter: blur(var(--bg-blur, 12px));
    -webkit-backdrop-filter: blur(var(--bg-blur, 12px));
    pointer-events: none;
    z-index: -1;
}
```

四个要点：

1. **`z-index: -1` 是必须的**。`backdrop-filter` 模糊的是「元素之下已绘制的内容」，
   若 `::before` 以默认 `z-index: auto` 绘制，它会盖在正文之上 → **把正文一起糊掉**。
   压到 -1 后它位于面板背景之上、所有内容之下。
2. **面板自身的 `backdrop-filter` 必须撤掉**。设了 `backdrop-filter` 的元素会**自成 Stacking
   Context**，此时子元素的 `z-index: -1` **退不到父级背景之后** → 玻璃带会盖住正文。
3. **右下停靠区不加毛玻璃（第五轮）**。停靠区是操作区，糊一层反而让图标发虚；
   三块一律 `backdrop-filter: none !important` + `background: transparent !important`
   （`--bg-tertiary` 在深色主题是深色，铺上去就是一块黑底）。
   第四轮为了消除「玻璃缝」而做的 `margin-bottom → padding-bottom` 顶替也一并撤销，恢复原有间距。
4. **进度条改用「颜色框」提示可拖拽**：背景图下没有底色，用一圈虚线强调色边框代替，
   中间保持透明：

   ```css
   body.has-bg-image.detail-write-mode #progress-container {
       backdrop-filter: none !important;
       background: transparent !important;
       border: 1.5px dashed var(--accent-color, #3b82f6) !important;
       border-radius: 8px !important;
   }
   ```

   `!important` 是必需的：写态的 `body.detail-write-mode #progress-container { border-top: none !important }`
   同为 important，靠更高的特指度（多一个 `.has-bg-image`）取胜。颜色跟随用户设置的
   **主题强调色**（实测本机 `--accent-color: #5293e0`）。

实测（1600 视口，`--bg-blur: 10px`）：

```
panel backdrop-filter = none
panel::before         = blur(10px)  width=768px   （--wm-width: 720px）
标签块   bd=none  bg=rgba(0,0,0,0)  radius=0px          box=1296,820 280x20
进度块   bd=none  bg=rgba(0,0,0,0)  radius=8px  border=1px dashed rgb(82,147,224)  box=1296,848 280x30
按钮簇   bd=none  bg=rgba(0,0,0,0)  radius=0px          box=1296,886 280x40
进度框四边都是 accent 虚线 = Y（border 1.5px 在 DPR=1 下渲染为 1px）

正文宽度三档：标准 720 → 玻璃带 768px ｜ 宽 900 → 948px ｜ 全屏 100% → 1339px（= 面板宽）
窄视口自动被 max-width:100% 夹住：1024→764px、900→640px、800→540px，overflow 全程 0
非背景图模式：进度容器 bg=rgb(55,61,67)（深色 --bg-tertiary）、border=0px none —— 原样未变
```

---

## 5. 关键尺寸表

| 元素 | 收起态 | 展开态 |
| ---- | ------ | ------ |
| 顶栏高 | 56px（含分割线） | 48px（无分割线） |
| 顶栏图标 | 32px 方形 | 书写态：**40×40 圆形**（purple / indigo / slate），gap 12px，按下态 scale(.95)；顶边 y=28、右边缘距视口右 24px，对齐主视图 `#header-actions`；**收起态保持方形 ghost** |
| 顶栏左侧（面包屑） | 无 | **第六轮隐藏**（`#detail-crumb { display: none }`），DOM 里仍写内容 |
| 顶栏内边距 | — | 书写态 `padding: 28px 24px 12px 24px`（把按钮推到主视图坐标） |
| 正文容器 | 无（撑满 384px） | `max-width: 720 / 900 / 100%` 居中（三档） |
| 标题字号 | 20px（`text-xl`） | **32px / 1.3 / 500**，`max-height: 320px` |
| 完成圈 | 24px | 28px |
| 时间设置 | 顶栏「设置时间 ▾」+ 展开的两列网格 | **三段可点摘要**（日期+时间合并格 / 提前 / 重复，居中）+ 点击展开的**自适应网格**（2 列 / ≥1024px 转 4 列）；第六轮**摘要条与任务标题文字居左对齐**（左边缘 x≈610，与标题文字完全重合） |
| 正文字号 | 默认 | **16px / 1.8** |
| 正文 min-height | 120px | 42vh（+ 书写态 `padding-bottom:46vh`，滚到底末行居中） |
| 底部按钮 | 3 个 `flex-1` 色块 | 右下角 6 个 **40px** 圆形钮（无主操作例外） |
| 标签 / 进度 | 整栏宽，正文下方 | 右下角 **280px** 右对齐，停在按钮簇上方；第六轮进度条改「**透明 + 1.5px 虚线强调色边框**」（非背景图 / 背景图两态统一），虚线本身也提示「可拖拽」 |
| 毛玻璃（背景图） | 整块面板 | **仅正文列**（`--wm-width + 2×--wm-pad` 宽，纵向由 `updateWriteModeGlassBounds` 算成「标题顶→正文末行」并**随滚动跟随**，滚到底止于屏幕中部，见 10.9 / 10.12）；右下停靠区**不加** |
| 底部停靠区 | 文档流 | **`#detail-dock` 绝对定位到面板底**（`pointer-events:none`，子块 `auto`），正文滚动区延伸到底（见 10.11） |
| 内容左右 padding | 16px | 24px（容器外无限留白） |

---

## 6. DOM 改动清单

| 位置 | 动作 | 风险 |
| ---- | ---- | ---- |
| `#task-detail-panel` | **不新增包裹层**（初版设想的 `#detail-canvas` 已放弃，改为顶栏内容 / 标题行 / 时间菜单 / 正文各自 `max-width + margin auto` 合成竖列） | 低：定位祖先不变，absolute picker 不受影响 |
| 新增 `#detail-time-trigger-wm` | 书写态专属的时间摘要按钮（`wm-only`），复用 `toggleDetailTimeMenu()` | 低：不带 `data-page-node-id`，不参与离线版 node id 映射 |
| `#detail-time-menu` | 书写态由「常驻平铺」改回 `hidden` 开关 + 自适应网格；**不可加包裹层**（`space-y-3` 见 4.4） | 低：纯 CSS；`:not(.hidden)` 必需 |
| `#detail-time-btn-text-wm` | 与收起态 `#detail-time-btn-text` 由同一个 `updateDetailTimeBtnText()` 写文案 | 低：一份逻辑两个出口 |
| ~~各时间字段的 `.wm-prop-label`~~ | **已删除**（随空属性过滤一起废弃） | — |
| `#detail-delete-label` | 删除按钮的文字节点独立出来，避免 `textContent` 抹掉图标 | 低：兜底回退整体赋值 |
| 底部按钮区 `#detail-actions` | 改为**文档流内** `align-self: flex-end`；各按钮挂 `wm-circle` | 低：DOM 基本不动（补 id / 图标） |
| `#detail-tags-display` / `#progress-container` | 从「与正文同宽」改为 **280px 右对齐 + 文档流** | 低：纯 CSS |
| 标签/清单 picker | CSS 改为 `bottom: 100%` 气泡 | 中：需设 `position: absolute` 锚点 |
| 保存按钮 `#detail-save-btn` | 加 `wm-hide`；自动保存走 `saveTaskDetailWithoutClose()` | 中：语义变更，需回归 |

> **不新增字段 DOM 副本** —— 复用同一套 `#detail-*` 元素，避免上游 3.5 提到的「字段 DOM 双实例漂移」。
> 唯一的例外是时间摘要的**文案 span**（`#detail-time-btn-text-wm`），它不承载状态，
> 只是同一份文案的第二个渲染出口。

---

## 7. 交互与状态

- **进入**：顶部/顶栏 `fa-expand` 按钮 → 挂 `body.detail-write-mode`
- **退出**：同位置 `fa-compress` / 顶栏 `← 收起` / `Esc`
- **切任务**：书写态下点侧栏其他任务 → 面板换任务、保持展开态（沿用上游 2.1）
- **保存时机**：退出 / 切任务前 flush 防抖 + 校验；空任务走 `discardEmptyDetailTask()`
- **只读态**（`detailReadOnly`，归档清单）：所有输入 `disabled`，悬浮簇只剩关闭
- **持久化**：展开态不跨会话保存（沿用上游 2.1）

### Esc 归属（⚠️ 新增逻辑，需排队）

现状：**详情面板不响应 Esc**（`quadrantView.js:237` 注释「详情面板不受 Esc 影响」）。
`pomodoro.js:98-100` 的 Esc 关番茄页并给子面板让位，`quadrantView.js:234` 判断 pomoPage 存在就跳过。

展开态的 Esc 优先级建议：

```
最上层浮层（date/time/reminder/repeat/tag/list picker）
  → 命令面板（commandPalette 已注册）
  → 书写态退出（新增，仅 body.detail-write-mode 时）
  → 四象限展开收起 / 番茄页（既有）
```

**实现**（`tasks.js:5949-5978`）：冒泡阶段监听 + 双重让位 ——
`if (e.defaultPrevented) return;`（上游已处理就不再抢）与
`if (_writeModeOverlayOpen()) return;`（自检 `#detail-time-menu div[id$="-picker"]` /
`#detail-list-picker` / `#detail-tag-picker` / `.modal-overlay` / `[id$="-modal"]`
中是否有可见者）。两者都通过才 `exitDetailWriteMode()`。

---

## 8. 动效（`body.fx-smooth` 开启时，第七轮落地）

> **开关归属**：本展开态的动效挂在 **「界面交互动效」** 上（`settings.smoothAnimations` → `body.fx-smooth`），
> 与「场景过渡动效」（`body.fx-feature`，含四象限展开/收起）是**两套独立开关**。
> 文案里那句「任务加载、**详情展开**、视图切换等交互播放平滑动效」指的就是这里。

### 8.1 为什么没用 View Transitions API
上游 2.4 设想用一次性 VT。但进入书写态时会把 `#main-content` 切成 `display:none`，
VT 会拍整页快照、消失元素「空盒飞」，且低端机快照开销大 → **弃用 VT**，改为纯 CSS 合成器动画。

### 8.2 性能红线（合成器友好）
- 只动 `transform` / `opacity`（合成层，不触发 layout/paint）。
- 绝不动 `width` / `max-width` / `margin`（重排）；绝不动 `backdrop-filter`（逐像素重算，全站最贵）。
- `animation-fill-mode: both` 做 staggered 入场：delay 期间保持 from 态（透明），否则错峰会「先整块闪一下再动」。

### 8.3 三档自动降级（互为兜底）
| 档位 | 触发 | 表现 |
| ---- | ---- | ---- |
| 正常 | `smoothAnimations=true`、非 reduce、非低端机 | `--wm-fx-dur:0.22s` / `stagger:30ms` / `shift:6px` |
| **低端机** | `app.js` 探测 `navigator.hardwareConcurrency≤4 ‖ deviceMemory≤4` → `body.fx-low` | 变量被覆盖：**时长砍半、stagger 归零（不去错峰）、shift 归零（只淡入不位移）** |
| 系统 | `prefers-reduced-motion: reduce` | JS 门控 `_wmFxOn()` 直接返回 false（不挂类）+ CSS 媒体查询块 `animation:none !important` 双保险 |

### 8.4 覆盖的 6 组动效
1. **进入**：9 个内容块（`#detail-topbar`→`#detail-title-row`→`#detail-time-trigger-wm`→`#detail-time-menu`/`#detail-body`→`#detail-timestamps-display`/`#detail-tags-display`→`#progress-container`/`#detail-actions`）`wmRise` 错峰淡入（`body.fx-smooth.wm-fx-enter` + 各块 `animation-delay`）。
2. **退出**：整块面板 `wmFadeIn` 一次（`body.fx-smooth.wm-fx-exit #task-detail-panel`）。
3. **时间菜单展开/收起**：`wm-menu-in`（`wmRise` 淡入）/`wm-menu-out`（`wmFadeOut`，期间 `pointer-events:none`，动画结束才真正 `hidden`）。
4. **正文宽度三档切换**：**不做宽度动画**（动 width 必重排），用 `wmWidthSwap`（opacity 45%→100% 凹陷）掩盖突变（`body.fx-smooth.wm-fx-width` 作用于 topbar 首子 / 标题行 / 时间菜单 / 正文）。
5. **气泡**（标签 / 清单选择器）：`wm-pop-in`（`wmRise`）。
6. **完成圈勾选**：`wmPop`（scale 1.18 回弹）。

### 8.5 编排（JS，`tasks.js`）
- `_wmFxOn()`：门控 = `settings.smoothAnimations===true && !matchMedia('(prefers-reduced-motion: reduce)').matches`。
- `_wmFxSeconds(name)`：从 `body` 读 `--wm-fx-*` 变量（秒），`fx-low` 覆盖后读到的就是降级值。
- `_wmFxPlay(el, cls, sec)`：单次播放，先摘类 + 强制回流保证连点重播，定时器清理。
- `_wmBodyFx(cls)`：挂在 `body` 的成组动效（enter 总时长 = `dur + stagger×5`，exit/width = `fade`）。
- 接入点：`enterDetailWriteMode`(wm-fx-enter)、`exitDetailWriteMode`(wm-fx-exit)、`cycleWriteModeWidth`(wm-fx-width)、
  `toggleDetailTimeMenu`(wm-menu-in/out 重写，非 `toggle`)、`toggleDetailListPicker`/`toggleDetailTagPicker`(wm-pop-in)、
  `toggleTaskDetailComplete`(wm-pop)。
- `app.js` 新增 `_isLowEndDevice()`，在 `applySettings` 里 `body.classList.toggle('fx-low', _isLowEndDevice())`（阈值同 `easterEgg.js` 的 `ee_getFxTier`）。

### 8.6 验证
`tmp/verify_round7.js`（主版 + 离线版 × 正常 / fx-low / reduce 三档）全 PASS：
进入错峰 delay 成立、菜单 in/out 正确、气泡/完成圈/宽度凹陷生效、门控 off 与 reduce 下完全不挂类、fx-low 下 `--wm-fx-shift=0px`。

---

## 9. 风险与对策

| 风险 | 对策 |
| ---- | ---- |
| **属性区 picker 被撑爆**：`#detail-task-date-picker` 等是 `absolute left-0 right-0`，展开态下会撑满容器 | 展开态下覆盖为 `left: auto; right: auto; width: 288px;`，并给父行 `position: relative` |
| ~~新增 `#detail-canvas` 改变了 picker 的定位祖先~~ | **已规避**：最终方案不新增包裹层，各区块各自 `max-width + margin auto`（见 6. DOM 清单） |
| 给 `#detail-time-menu` 加包裹层会让 `space-y-3` 失效（收起态重叠） | **已修**：保持直接子元素结构，选择器一律 `#detail-time-menu ...`（见 4.4） |
| **网格用 `auto-fit` 会把面板撑到 872px，≤1024px 溢出窗口** | **已修**：改用显式列数 + `minmax(0, 1fr)`（见 4.4 的警告） |
| `!important` 的 `display:grid` 压过 Tailwind `.hidden`，菜单永远展开 | 选择器写 `#detail-time-menu:not(.hidden)` |
| `#detail-task-title` 内联 `max-height:120px` 裁掉大字号标题 | 展开态 `max-height: 320px !important` + 进入时 `autoResizeTextarea()`（见 4.3） |
| 保存语义变更导致空任务残留 | 退出/切任务前仍走 `discardEmptyDetailTask()`；`saveTaskDetailWithoutClose` 空标题本就跳过不写 |
| ~~`#detail-time-menu` 常驻后 `toggleDetailTimeMenu()` 会把它收起~~ | **第三轮已不适用**：菜单恢复 `hidden` 开关语义，`toggleDetailTimeMenu()` 正是期望的入口，不再需要屏蔽 |
| `.wm-circle` 的 `background` 若加 `!important` 会抹掉重要/紧急的激活态内联底色 | 背景写 `background: transparent;`（无 `!important`），见 4.7 |
| `deleteBtn.textContent = '删除任务'` 会清空子节点、抹掉图标 | 改用 `setDetailDeleteLabel()` 只写 `#detail-delete-label` |
| 停靠区遮挡正文末尾 | 标签 / 进度 / 按钮簇都回到**文档流**（`align-self: flex-end`），`#detail-body` 是 `flex-1` 自动让位，不再需要预留 padding |
| 悬浮簇与 toast 打架 | 展开态**已移除全部 toast**（进入书写态 / 切宽度不再弹提示）；其他来源的 toast 容器居中于底部（`index.html:3382`），簇在右下角，几何上不重叠 |
| 触屏无 hover | 簇按钮的「描边→实心」只在 `:hover`；触屏点击即触发动作（弹 picker / 切换属性），不依赖 hover 反馈；`@media (hover: none)` 下可直接常驻实心 |
| 移动端无 max-width 概念 | 展开态 = 全屏，容器 `100%`，簇缩到 36px 并上移到 `bottom: 76px`（避开底部导航） |
| 背景图下长文可读性 | 面板在 `has-bg-image` 下是**透明 + backdrop-blur**（`index.html:172-181` 既有设计）。书写态正文较长时观感偏"糊"，如需可给展开态补一条更实的面板底色（见 4.8） |

---

## 10. 决策记录（2026-10-01 拍板）

| # | 议题 | 结论 | 落地位置 |
| - | ---- | ---- | -------- |
| 1 | 保存按钮 | **书写态移除**，改为自动保存；间隔可在「设置 → 视图与外观 → 自动保存间隔」调整 | `detail-save-btn` 加 `wm-hide`；`tasks.js` 新增 `scheduleWriteModeAutoSave()`；`data.js` 的 `saveData()` 节流改为 `getAutoSaveDelay()`（默认 500） |
| 2 | 正文宽度 | **三档**：standard 720 / wide 900 / full 拉满可用宽度 | `body.wm-w-900` / `.wm-w-full`；顶栏 `#detail-width-btn` 循环 + 设置下拉，共享 `settings.writeModeWidth` |
| 3 | 标签与清单 | **留在悬浮簇**，不搬进属性区 | 时间区只含时间类属性；picker 在书写态改为簇上方气泡 |
| 4 | ~~属性区默认只显示非空属性~~ | **第三轮作废**：改为与收起态一致的「摘要 → 点击展开」，展开后所有字段都可见可填 | 见 4.4；`updateWriteModeProps()` / `wm-prop-empty` / `wm-prop-label` 全部删除 |
| 5 | 开始专注按钮 | **与任务卡片一致** | 复用 `pomodoro-focus-btn` + `pf-icon-outline/solid`；收起态图标由 `fa-stopwatch` 改为 `fa-clock` |
| 6 | 返回 / 关闭 | **只保留一个**，放在原关闭按钮位置 | `#detail-dismiss-btn` + `onDetailDismiss()` |
| 7 | 悬浮簇图标（第二轮） | 统一为**默认圆形空心描边 / 悬浮实心填充 + 白图标**，与 `#header-actions` 一致 | `body.detail-write-mode .wm-circle` 管几何；逐按钮 `#id` / `#id:hover` 写色并带 `!important`（见 4.7） |
| 8 | 展开态 Toast（第二轮） | **全部删除**（进入书写态 / 切换宽度不再弹提示，静默生效） | 移除 `enterDetailWriteMode()` / `cycleWriteModeWidth()` 内的 `showToast` |

### 10.1 仍待确认 / 后续

1. ~~**`index_offline.html` 同步**~~ **✅ 已完成**：以 HEAD 版本为参照，
   按顺序映射两套 `data-page-node-id`（151 / 151 对齐校验通过），三处替换全部成功
   —— `#task-detail-panel` 整块、CSS 块、两项设置。脚本见 `tmp/sync_offline.py`（**已改为幂等**：
   CSS 块存在则替换、设置项存在则跳过，可反复执行）。
2. ~~**书写态下无法切换「时间段 / 清除时间」**~~ **✅ 第三轮已解决**：时间区回到收起态结构，
   首行的四个按钮（跳过此周期 / 撤销 / 时间段 / 清除时间）原样保留。
3. ~~**动效**：当前展开 / 收起是瞬时切换，尚未接 View Transitions（上游 2.4 的方案待接）。~~ **✅ 第七轮已落地**：轻量 CSS 分层入场（未用 VT），覆盖进入错峰 / 退出淡入 / 菜单 in-out / 宽度凹陷 / 气泡 / 完成圈 6 组；三档自动降级（正常 / `body.fx-low` 低端机 / `prefers-reduced-motion`）。详见第 8 节。
4. ~~**视觉稿 `tmp/write_mode_preview.html`**~~ **✅ 第三轮已同步**：按实现的真实 DOM 顺序重写
   （顶栏 → 摘要条 → 时间菜单 → 标题行 → 正文 → 标签 → 进度 → 按钮簇，视觉顺序靠 flex `order`），
   逐条镜像透明圆钮 / 统一 40px / `rgba(...,.15)` 激活态 / 摘要条 + 自适应网格（4 列 / 2 列）/
   `display:contents` 摊平 `.grid2` / 280px 停靠区；另加三档正文宽度切换与可点的
   时间段 / 清除时间 / 跳过此周期 / 重要 / 紧急 / 删除二次确认。截图见 `tmp/preview_*.png`。
5. **Tab 焦点顺序与视觉顺序不一致**：书写态用 flex `order` 重排，Tab 仍走 DOM 顺序（见 4.4.2）。
6. ~~**圆钮内的图标色尚未统一**~~ **✅ 第四轮已解决**：加
   `body.detail-write-mode .wm-circle i { color: inherit !important; }`，
   并把「所属清单」换成 `var(--accent-color)`。详见 4.7。
7. 🆕 **毛玻璃边界是硬边**（第四轮）：正文列玻璃带用的是 `::before` 的一条矩形，
   与两侧未模糊区域之间是**垂直硬边**（背景图细节丰富时能看出一条直缝）。
   用户当前明确要「只模糊正文宽度对应的部分」，故保持硬边；
   若以后想要柔和过渡，可给 `::before` 加 `mask-image: linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)`
   做羽化。
8. 🆕 **摘要条在背景图下的对比度**：三段摘要用的是 `--text-secondary`，
   叠在深色背景图上略淡（与第三轮的单颗胶囊同色，非某次改动引入）。若需要可在
   `body.has-bg-image.detail-write-mode .wm-time-seg` 上单独提亮。**仍未处理，等用户拍板。**

### 10.2 第二轮改进记录（2026-10-01）

| # | 问题 | 根因 | 修复 |
| - | ---- | ---- | ---- |
| 1 | 离线版缺功能 | 独立副本未同步 | `tmp/sync_offline.py` 按 node id 顺序镜像三处 |
| 2 | 主标题下半部分看不到 | `#detail-task-title` 有内联 `max-height: 120px`，32px 字号写满三行被裁 | 书写态覆盖 `max-height: 320px !important`，并在进入时调 `autoResizeTextarea()` |
| 3 | 「设置时间」布局错误重叠 | 初版加了 `#detail-props-body` 包裹层 → Tailwind `space-y-3` 只作用于直接子元素而失效 | 彻底移除包裹层，恢复 `#detail-time-menu` 直接子元素结构；选择器全部改为 `#detail-time-menu ...` |
| 4 | 展开态 Toast 冗余 | — | 删除 `enterDetailWriteMode()` / `cycleWriteModeWidth()` 内的 `showToast` |
| 5 | 悬浮簇图标不齐 / 缺图标 | 清单按钮漏 `wm-circle`；删除按钮只有文字 | 统一 `wm-circle` 范式；删除补 `fa-trash`；清单文字书写态隐去；专注按钮复用双图标 |

### 10.3 第三轮改进记录（2026-10-01）

| # | 问题（用户原话摘要） | 根因 | 修复 |
| - | ---- | ---- | ---- |
| 1 | 背景图模式下圆钮默认态有**黑色底**，希望透明填充 | `.wm-circle` 写的是 `background: var(--bg-secondary)`，`has-bg-image` 下该变量是深色 `#282d33` | 改为 `background: transparent`（**不加 `!important`**，否则抹掉激活态内联底色） |
| 2 | 「删除任务」**依旧没有图标** | 第二轮补的 `<i class="fas fa-trash wm-only">` 被 `openTaskDetailPanel()` 的 `deleteBtn.textContent = '删除任务'` **清空**了（`textContent` setter 会删掉所有子节点） | 新增 `setDetailDeleteLabel()`，只写 `<span id="detail-delete-label">`；确认态改用 `is-confirming` 类渲染红色实心圆 |
| 3 | 「开始专注」「删除任务」**尺寸与其他钮不一致** | 开始专注挂着 `.wm-focus`（48px 主操作） | 取消主操作尺寸，删掉 `wm-focus` 类与规则，6 个钮统一 40px |
| 4 | 时间设置**改回收起态样式**（默认只显示任务时间，点击展开），但适配当前宽度；按钮与功能要与收起态一致 | 第二轮的「平铺一行」把首行四个按钮挤掉了，且空属性过滤会让提醒/重复无法设置 | 见 4.4：恢复两级结构 + 自适应网格（2 列 / ≥1024px 4 列）+ flex `order` 重排 |
| 5 | 标签与进度**移到右下角按钮上方**（与按钮同宽） | 原来横跨整栏、在正文下方 | 见 4.7.2：280px 右对齐 + 回到文档流 |

**第三轮顺带修掉的坑**：`repeat(auto-fit, minmax(200px, 1fr))` 的 `min-content` ≈ 872px
把面板撑爆（≤1024px 溢出窗口）→ 改显式列数 + `minmax(0, 1fr)`。
宽度横扫实测 1600/1440/1366/1280/1024/900/800/769 全部无溢出。

### 10.4 第四轮改进记录（2026-10-01）

| # | 问题（用户原话摘要） | 根因 | 修复 |
| - | ---- | ---- | ---- |
| 1 | 展开态下用**旧版的「任务时间 / 提前 / 重复」显示规则**，抽象成「设置时间收起态」的展示方式；点任意一部分展开设置面板 | 第三轮的摘要条是一整串文案，信息挤在一起、也看不出哪部分对应哪个设置 | 见 4.4.3：拆成 `date` / `time` / `reminder` / `repeat` 四段（+ `empty` 占位），逐段 `setWriteModeTimeSegments()` 写入与隐藏；四段共用 `toggleDetailTimeMenu()` |
| 2 | 「所属清单」图标用**主题强调色**；其他图标**悬浮时图标应为白色**（原来只有专注/删除做到了） | `<i>` 自带 Tailwind `text-*-500`，清单图标还有 JS 写的内联清单色 → 盖住了按钮色 | 见 4.7：`.wm-circle i { color: inherit !important }`（一次管住默认/悬浮/二次确认三态）；清单改用 `var(--accent-color)` |
| 3 | 右下角**进度栏在背景图下有黑底**，要透明 | 书写态给 `#progress-container` 写了 `background: var(--bg-tertiary)`，深色主题下就是一块黑 | 背景图模式下 `background: transparent !important`（见 4.8） |
| 4 | 毛玻璃**宽度应随「正文宽度」变化**，不要全部加模糊；只模糊正文宽度对应的部分 + 右下角选项对应的部分 | 原来 `body.has-bg-image #task-detail-panel.bg-theme-secondary` 给**整块面板**加 `backdrop-filter` | 见 4.8：撤掉面板自身的模糊，改为「正文列玻璃带（`::before`，宽 = `--wm-width + 2×--wm-pad`）+ 右下停靠区三块连续玻璃」 |

**第四轮顺带修掉的既有 bug**：`#detail-actions` 是 `position: static`，
而标签 / 清单气泡用 `bottom: 100%` → 包含块退到 `#task-detail-panel`，
气泡被顶到面板上方（实测 `y = -102`，**完全在视口外点不到**）。
加 `position: relative` 后气泡正确锚定在按钮簇上方（`y = 784`，在视口内）。详见 4.7.2。

**第四轮验证**（`index.html` 与 `index_offline.html` 结果一致）：

- 摘要条逐状态：初始 `date="1月2日" | time="01:00 - 02:00"` → 清除时间 `empty="设置时间"`
  → 只填日期 `date="10月8日" | time="全天"` → 加时间 `time="09:30"`
  → 加提醒 `reminder="提前 15 分钟"` → 选重复 `repeat="每周"`
  → 时间段 `time="09:30 - 11:00"`；点任一段都能展开菜单、再点收起。
- 6 个圆钮：默认图标色 == 描边色、悬浮 `background` == 描边色且图标 `rgb(255,255,255)`，**全部 OK**。
- 背景图模式：`panel backdrop-filter = none`；`panel::before = blur(10px) width=948px`（`--wm-width: 900px`）；
  停靠区三块 `blur(10px) / bg transparent / radius 0`，纵向跨度 822→926 **首尾相接**。
- 玻璃带随三档正文宽度：720 → 768px、900 → 948px、100% → 1339px；窄视口被 `max-width: 100%` 夹住
  （1024→763、900→639、800→539）。
- 宽度横扫 1600/1440/1280/1024/900/800：`panel overflow = 0`。

### 10.5 第五轮改进记录（2026-10-01）

| # | 问题（用户原话摘要） | 根因 | 修复 |
| - | ---- | ---- | ---- |
| 1 | 摘要条要**把日期和时间合并到一起**，优化跨天时间的显示；「时间段信息显示参考收起态规则」 | 第四轮拆成 `date` / `time` 两段后，跨天任务裂成两格（`1月2日` ｜ `22:00 - 1月3日 02:00`），读起来断裂 | 见 4.4.3：两段合并为一段 `datetime`，文案**直接复用收起态顶栏按钮的同一份 `text`** → 显示规则天然一致（含跨天 / 跨年 / 全天 / 时间段）。`setWriteModeTimeSegments()` 的入参由 `{date,time,reminder,repeat,empty}` 变为 `{datetime,reminder,repeat,empty}` |
| 2 | 右下角**按钮 / 进度 / 标签不要毛玻璃**，背景图下保持**全透明**；进度部分改用**颜色框（中间透明）**提示可拖拽 | 第四轮为了让三块玻璃「首尾相接」还给停靠区加了模糊 + `padding-bottom` 顶替 `margin-bottom`；但停靠区是操作区，糊一层让图标发虚 | 见 4.8：三块一律 `backdrop-filter: none !important` + `background: transparent !important`，撤销 padding 顶替恢复原间距；进度容器加 `border: 1.5px dashed var(--accent-color) !important` + `border-radius: 8px` |
| 3 | 右上角**补全「切换任务模式 / 文本模式」按钮**，放在返回按钮左侧 | `#toggle-mode-btn` 挂着 `wm-hide`（书写态隐藏）→ 书写时切不了模式 | 见 4.1：去掉 `wm-hide`，两态都可见。DOM 顺序本来就是 `width-btn → toggle-mode-btn → expand-btn → dismiss-btn`，而收起态 `width-btn` 隐藏、书写态 `expand-btn` 隐藏 → 两种态下模式按钮都恰好落在最右按钮左侧，无需额外 CSS |

**第五轮验证**（`verify_round5.js`，`index.html` 与 `index_offline.html` 结果完全一致）：

- 摘要格逐场景与收起态按钮**逐字一致**：仅日期 `10月8日 (全天)` ｜ 日期+时间 `10月8日 09:30`
  ｜ 同日时间段 `10月8日 09:30 - 11:00` ｜ **跨天时间段 `10月8日 22:00 - 10月9日 02:00`**
  ｜ 跨天全天 `10月8日 - 10月11日 (全天)` ｜ 跨年 `12月31日 23:00 - 2027年1月1日 01:00`
  ｜ 清除时间 → 摘要格隐藏、占位「设置时间」出现。点 `datetime` 段展开、再点 `repeat` 段收起。
- 顶栏顺序：书写态可见 `detail-width-btn(1492) > toggle-mode-btn(1530) > detail-dismiss-btn(1570)`，
  **模式按钮紧邻返回按钮左侧 = Y**；收起态 `toggle-mode-btn(1478) > detail-expand-btn(1518) > detail-dismiss-btn(1556)`。
  实际点击 `toggle-mode-btn`：`text → subtasks`，图标同步为 `fa-edit`。
- 背景图模式：`panel backdrop-filter = none`；`panel::before = blur(10px) width=768px`（正文列玻璃带保留）；
  标签块 / 按钮簇 `bd=none bg=rgba(0,0,0,0)`；进度容器 `bd=none bg=rgba(0,0,0,0) radius=8px
  border=1px dashed rgb(82,147,224)`，**四边均为强调色虚线 = Y**。
- 非背景图模式：进度容器 `bg=rgb(55,61,67)`（深色 `--bg-tertiary`）、`border=0px none` —— 原样未变。
- 宽度横扫 1600/1440/1280/1024/900/800：`panel overflow = 0`。
- 数据安全：全程 `setRequestInterception` 丢弃非 GET 的 `/api/*`，`data.json` mtime 未变。
- 唯一 console error 是既有的可选字体 404（`offline_assets/fonts/CountdownSerif-700.woff2`），
  与本次改动无关。

### 10.6 第六轮改进记录（2026-10-01）

| # | 问题（用户原话摘要） | 根因 | 修复 |
| - | ---- | ---- | ---- |
| 1 | 展开态摘要条**不要居中，要与任务标题居左对齐** | 摘要条原本是 `justify-content: center` + 没有 `padding-left` 补偿 | 见 4.4.3：把摘要条加进与 `#detail-title-row` 共用的容器规则（`max-width` + `margin:auto`），`padding-left` 补到 `calc(--wm-pad + 40px)`（40px = 完成圈 28 + title-row 的 gap-3 12），首段左边缘正好落在标题文字 x≈610 的竖线上；`justify-content: flex-start` |
| 2 | 展开态**不要「清单名 › 任务名」面包屑**，标题已下放到正文 | `#detail-crumb` 在书写态仍 `display: block` | `#detail-crumb { display: none !important }`（第六轮），DOM 与 JS 写入仍保留（不影响其他逻辑） |
| 3 | 展开态右上角图标**与主视图「添加任务/视图配置」同规格**（默认/悬浮/按下三态一致），**返回按钮沿用节假日页范式**，**位置与主视图圆形按钮一致** | 右上角是 `p-2 text-theme-secondary hover:bg-theme-tertiary rounded-lg` 的方形 ghost，三个按钮尺寸都不一致（30×32/32×40/30×40），也没有 active 态；顶栏 padding 是 `10px 0`、右边缘贴死视口右 | 见 4.7.3：复用主视图 `w-10 h-10 rounded-full border-2 ...` 范式 + 节假日页的 `active:bg-*-600 active:scale-95`；配色 正文宽度 purple-500 / 模式切换 indigo-500 / 返回 slate-400+slate-500；顶栏 `padding: 28px 24px 12px 24px` 把按钮推到主视图实测坐标（y=28、右边缘 24px） |
| 4 | 进度条在**非背景图模式下也有底色**，希望只描边、内容与背景一致 | 写态规则给 `#progress-container` 写了 `background: var(--bg-tertiary)`，深色主题下是深色块 | 改为 `border: 1.5px dashed var(--accent-color) !important; background: transparent !important`；非背景图与背景图**两态统一**（背景图模式之前就是虚线，现在非背景图也长一样） |

**第六轮验证**（`verify_round6.js`，主版与离线版结果完全一致）：

- 摘要条对齐：所有宽度（1600/1440/1280/1024/900/800）摘要条首段 x 都与标题文字 x 完全相等（差 0.0px）。
- 面包屑：`display: none`（内容仍保留 `"工作 › 撰写产品周报"`）。
- 三个按钮：`40x40` 圆 / `border 2px solid` / `radius 9999px` / 配色 purple·indigo·slate 与设计一致；`gap=12px`；右簇右边缘 1576、按钮顶边 28；**三态**：默认透明+彩色图标 → 悬浮实心+白图标 → 按下深一档+`transform: scale(.95)`。收起态基线（32×40 radius 8px border 0）无回归。
- 进度条：非背景图与背景图都是 `bg=rgba(0,0,0,0) border=1px dashed rgb(16,185,129) radius=8px 280x30`，**两态统一**。
- 数据安全：全程拦网络层丢弃非 GET 的 `/api/*`，`data.json` mtime 未变。
- 唯一 404 是既有的可选字体（`offline_assets/fonts/CountdownSerif-700.woff2`）。
- 截图：`tmp/wm3_summary_full.png`、`wm3_summary_bar.png`、`wm3_glass_pattern.png`、
  `wm3_dock_idle.png`、`wm3_dock_hover_tag.png`、`wm3_dock_hover_list.png`、`wm3_normal.png`。

### 10.7 第七轮改进记录（2026-10-01）—— 书写态交互动效

用户指令：「为这个任务展开态设计『界面交互动效』（仅在该功能项开时应用）。注意性能，低性能机器也要流畅。可参考四象限的象限展开动画。」

确认方案（AskUserQuestion 全选推荐）：轻量 CSS 分层入场 / 全套 5 组覆盖 / 三档自动降级 / 宽度切换用 opacity 交叉掩盖。

**改动**
- CSS（`index.html`，写在书写态 `@media (min-width:769px)` 块末尾、`@keyframes fxPanelIn` 之前，确保被 `sync_offline.py` 覆盖）：
  - 5 个变量 `--wm-fx-dur/ease/stagger/shift/fade`，`body.fx-low` 档位覆盖，`wmRise`/`wmFadeIn`/`wmFadeOut`/`wmWidthSwap`/`wmPop` 5 个 keyframes，6 组规则，`prefers-reduced-motion` 全关兜底块。
- JS：`tasks.js` 新增 `_wmFxOn()` / `_wmFxSeconds()` / `_wmFxPlay()` / `_wmBodyFx()`，接入 `enter`/`exit`/`width`/`menu in-out`/`picker pop`/`complete pop` 共 6 个调用点；`app.js` 新增 `_isLowEndDevice()` 并在 `applySettings` 挂 `body.fx-low`。
- 视觉稿 `tmp/write_mode_preview.html` **按用户要求不更新**（本轮只动真实代码）。

**验证**（`verify_round7.js`，主版 + 离线版 × 正常 / fx-low / reduce 三档，全 PASS）：
- 进入错峰：title 块 `animationName=wmRise`、`delay=0.03s`，body 块 `delay=0.09s`；700ms 后 `wm-fx-enter` 自动清理。
- 菜单：`wm-menu-in`（淡入）/`wm-menu-out`（先淡出后 `hidden`，收起态 `pointer-events:none`）。
- 气泡 `wm-pop-in`、完成圈 `wmPop`、宽度 `wm-fx-width`（`#detail-body` 动画 `wmWidthSwap`，只动 opacity）。
- 门控 off（`smoothAnimations=false`）：完全不挂类。
- `fx-low`：`--wm-fx-shift=0px`（正常档 6px），`body.fx-low` 正确挂载。
- `prefers-reduced-motion: reduce`：JS 门控拦截，所有动效不播放。

### 10.8 第八轮改进记录（2026-10-01）—— 虚线框内显示所属清单

用户意图：展开态虚线框原「左 专注时长 / 右 进度%」缺所属清单信息；改为**居左固定显示清单颜色圆点+清单名称、中部显示专注时长（如有）、居右固定显示进度%**，且清单段单击展开清单选择器，名称过长省略号截断。清单徽标对齐任务视图右侧的「圆点+名」样式（不用文件夹图标、不用徽标框），颜色取 `list.color`。

**布局（方案 C，三栏，`index.html` `#progress-container` 内）**
- 左 `#detail-list-display`（`<span>`）：`#detail-list-dot`（圆点，`8px`、`background-color:list.color`）+ `#detail-list-name-wm`（`truncate` 省略号），`title="所属清单"`，`onclick="toggleDetailListPicker()"` + `onmousedown="event.stopPropagation()"`（防触发父级 `#progress-container` 的拖拽改进度）。
- 中 `#detail-focus-duration`（stopwatch + `Nm`）：`updateProgressDisplay()` 在其为 0 时 `display:none`，天然满足「中部如有」。
- 右 进度段（flag + `进度%`）。
- 拖拽改进度功能保留（方案 b：按钮簇 `#detail-list-btn` 也保留，两处共存）。

**改动**
- `tasks.js`：`updateDetailListBtnText()` 扩展为同时写 `#detail-list-dot.style.backgroundColor` 与 `#detail-list-name-wm.textContent`（一份数据两出口，与收起态 `#detail-list-name` 一致）；切换清单经 `populateDetailListSelect` 回调已同步。
- `tasks.js`：`enterDetailWriteMode()` 末尾补 `updateDetailListBtnText()`（防御：确保进入书写态时框内清单名/圆点已填充）。
- `tasks.js`：修复 `detailPanel` 的「外部点击关 picker」白名单——原 `button[onclick*="toggleDetailListPicker"]` 只匹配 `<button>`，而虚线框清单段是 `<span>`，导致单击打开 picker 后该 handler 立刻把它关掉（打开即被关）。新增 `e.target.closest('#detail-list-display')` 一并纳入「不关闭」白名单。

**根因（关键坑）**：`detailPanel` 上注册的 bubble 阶段 click 监听在「清单段内联 onclick 已打开 picker」之后执行，因目标不是 `<button>` 而不命中既有跳过条件，遂执行 `listPicker.classList.add('hidden')` —— 净效果 picker 开后即关、看似「点了没反应」。圆按钮 `#detail-list-btn` 是 `<button>` 故原本正常。

**验证**（`verify_round8_v2.js`，主版 + 离线版，ALL_PASS；`verify_round7.js` 回归全 PASS）：
- `click1_open`/`click2*_opens`：单击清单段确实打开选择器（核心需求落地）。
- `outsideClickCloses`：点击面板空白处仍正常收起（外部点击逻辑未破坏）。
- `circleBtnToggles`：圆按钮仍正常 toggle（无回归）。
- `boxTruncated`：长清单名 `scrollWidth>clientWidth` 且 `text-overflow:ellipsis`（省略号生效）。
- 圆点色 `rgb(59,130,246)`（= 清单 `#3b82f6`）、尺寸 `8px×8px`；框宽 280px；`focusVisibleWhenZero=false`（无专注时长则中栏隐藏，与预期一致）。
- 注：选择器 `bottom:100%` 展开时会覆盖虚线框清单段（与覆盖圆按钮不同，圆按钮中心未被覆盖）；再次单击清单段会落到选择器 pills 上（属预期「点选择器内选中」行为），非缺陷。
- ⚠️ **第十轮已回退本节「清单段单击展开选择器」的交互**（用户反馈该点击会与虚线框「拖拽改进度」冲突）：`#detail-list-display` 改为**仅展示**，虚线框内所有点击/拖动回归改进度；清单选择改由按钮簇 `#detail-list-btn` 触发。详见 **10.10**。

### 10.9 第九轮改进记录（2026-10-01）—— 毛玻璃带纵向只覆盖文字范围

用户意图：展开态背景图模式下，正文列毛玻璃带原本 `top:0; bottom:0` **贯穿整屏**，显得呆板；希望其纵向只覆盖「有文字的地方」——**上方从任务标题顶端开始，一直到下方任务详情文本的最后一行文字**。宽度维度不变（仍由 `--wm-width` 决定）。

**实现（`tasks.js`）**
- 新增 `updateWriteModeGlassBounds()`：以面板为基准算 `top` = 标题顶端相对面板顶（扣除 `borderTop`），`bottom` = 面板底 − 详情文本底边（扣除 `borderBottom`）；把结果写进 CSS 变量 `--wm-glass-top` / `--wm-glass-bottom`。CSS 带改为 `top:var(--wm-glass-top,0); bottom:var(--wm-glass-bottom,0)`（见正文 4.8 节 CSS）。
- 「详情文本最后一行」底边：文本框（`#detail-task-notes` / `#detail-task-description`）取内容高度；子任务模式取 `#subtask-content` 底边；三者取 max，确保覆盖到真实最后一行。
- 新增 `_textElContentHeight(el)`：文本框可能是 `flex-1` 被拉伸、`scrollHeight` 会等于拉伸框高而非文本高度——临时撤 `flex-grow` + `height:auto` 再读 `scrollHeight`；**先锁宽**（否则撤 flex 后宽度塌到 min-content、文字大量换行、scrollHeight 被撑高）；**还要临时清掉 CSS `min-height`**（详情框 computed `min-height≈399px`，单句文本会被算成 399px 高，而用户要的是「止于最后一行文字」，必须量真实文本高度）。测完同步还原、无闪烁。
- 新增 `_initWmGlass()`：给三个文本元素挂 `input` 监听 + `ResizeObserver`，宽度/模式变化、文本增减、子任务增减时实时重算。
- 挂接点：`enterDetailWriteMode()`（rAF 预算 + `setTimeout(updateWriteModeGlassBounds, 750)` 入场动画 `wm-fx-enter` 含 `translateY(6px)` 结束后精算，避免捕获偏高 6px 的 `titleRect.top`）、`cycleWriteModeWidth()`、`toggleTaskMode()`（模式切换后文本元素变化）。

**关键坑**
- flex-1 文本框 `scrollHeight===clientHeight`（拉伸框高），必须临时撤 flex 再测。
- 撤 flex 前**必须锁宽**，否则塌缩换行撑高 scrollHeight（实测一句短文本算成 399px）。
- 详情框 `min-height:399px` 是 CSS 规则（非内联 120px），量文本高度时须临时 `minHeight:'0px'` 覆盖，否则单句仍算 399px、带底落到 399px 而非第一行。
- 入场动画期间 `getBoundingClientRect` 含 6px 变换偏移，须在动画结束后精算；`top/bottom` 计算扣除面板 border。

**效果（实测，1600 视口）**
- 短文本（一句）：带高 **145px**（占面板 15%），`bandTopAbs=titleTop`、`bandBottomAbs=textBottom`（止于第一行文字），不再贯穿整屏。
- 长文本（30 行）：带延伸并 **clamp 到面板底（870px）**，正文超面板时覆盖到底，符合预期。
- 宽度档切换、追加一行输入：均实时重算对齐。

**验证**（`verify_glass.js`，主版 + 离线版，ALL_PASS；`verify_round8_v2.js` / `verify_round7.js` 回归全 PASS）：`short_topAlign`/`short_bottomAlign`/`short_notFull`、`long_topAlign`/`long_bottomAlign`(clamp 到底)/`long_tallerThanShort`、`afterWidth_topAlign`/`afterWidth_bottomAlign`、`input_recomputed` 全 true。

### 10.10 第十轮改进记录（2026-10-01）—— 虚线框回归拖拽 / 气泡对齐 / 按钮对调 / 实心时钟

用户提出四点改进：

**1) 虚线框内清单名改为「仅展示」，点击/拖动回归改进度**
- 背景：第八轮把 `#detail-list-display` 做成可点开清单选择器，但该点击会与虚线框 `#progress-container` 的 `onmousedown="startProgressDrag(event)"`（拖拽改进度）**冲突**——用户本意是拖拽改进度，却误触了清单选择。
- 改：`index.html` 去掉 `#detail-list-display` 的 `onclick="toggleDetailListPicker()"` 与 `onmousedown="event.stopPropagation()"`，并移除 `cursor-pointer hover:text-theme-primary`（纯展示）。虚线框内任意位置的 mousedown 现在都冒泡到 `#progress-container`，触发 `startProgressDrag`。
- `tasks.js`：`detailPanel` 的「外部点击关 picker」白名单移除 `#detail-list-display` 例外（该 `<span>` 已不再开 picker）；清单选择仍由按钮簇 `#detail-list-btn`（`<button>`）触发，原 `button[onclick*="toggleDetailListPicker"]` 条件已覆盖。

**2) 标签/清单气泡底边与虚线框底边对齐、圆角一致**
- CSS（`index.html` 书写态块）：`#detail-list-picker` / `#detail-tag-picker` 由 `bottom:100%` 改为 **`bottom: calc(100% + 8px)`**（虚线框在 `#detail-actions` 上方 8px，`bottom` 加 8px 把气泡底边压到虚线框底边），并加 **`margin-bottom: 0 !important`** 抵消 HTML 上的 `mb-3`（12px），`border-radius: 8px` 与虚线框一致。
- 实测：`picker.bottom = box.bottom = 878`（差 0px）；圆角双方 `8px`。

**3) 「删除任务」与「开始专注」按钮位置对调**
- `#detail-action-row-main` 内把 `#detail-focus-btn`（开始专注）移到 `#detail-delete-btn`（删除任务）之前；第 2 行顺序由 `删除 / 开始专注` 变为 `开始专注 / 删除`。

**4) 「开始专注」按钮图标改为实心时钟**
- `#detail-focus-btn` 图标由双图标机制（`far fa-clock` + `fas fa-clock`，hover 描边↔实心）改为**单个实心时钟** `<i class="fas fa-clock mr-1"></i>`，与侧边栏「番茄专注」（`#sidebar-pomodoro-btn` 的 `fas fa-clock`）一致；移除 `pomodoro-focus-btn` 类。见 4.7.1。

**离线版**：`index_offline.html` 经 `tmp/sync_offline.py` 同步（panel + CSS 块）。

**验证**（`verify_round10.js`，主版 + 离线版 ALL_PASS）：`r1_spanNoOnclick`/`r1_spanNotOpenPicker`/`r1_dragBubbles`/`r1_pickerViaButtonOpens`、`r2_bottomAlign`(差 0px)/`r2_radiusMatch`/`r2_outsideCloses`、`r3_focusBeforeDelete`、`r4_solidClock` 全 true。回归：`verify_round7.js` ALL PASS、`verify_glass.js` ALL_PASS、`verify_round8_v2.js`（已按新行为更新断言）ALL_PASS。

### 10.11 第十一轮改进记录（2026-10-01）—— 编写区延伸到底 + 书写视觉中部

用户提出两点改进：

**1) 详情编写区要一直写到屏幕最底部，而不是在「标签显示区」高度就停住滚动**

- 背景：底部集群（时间戳 / 标签 / 进度虚线框 / 按钮簇）原本在**文档流**里占据正文下方一段高度，`#detail-body` 的滚动区到标签区上方就被截断，正文右侧滚动条只到「与标签显示区平齐」的位置——与「一张写到底的纸」不符。
- 改（`index.html`）：把底部集群 4 块（`#detail-timestamps-display` / `#detail-tags-display` / `#progress-container` / `#detail-actions`）整体包进 **`#detail-dock`**，dock **绝对定位到面板底部**，从文档流中脱出；`#detail-body`（`flex-1`）于是自然撑满到屏幕底。
  ```css
  body.detail-write-mode #detail-dock {
      position: absolute; left: 0; right: 0; bottom: 0;
      display: flex; flex-direction: column; align-items: flex-end;
      pointer-events: none;   /* 空白区不挡正文 */
      z-index: 20;
  }
  body.detail-write-mode #detail-dock > * { pointer-events: auto; }  /* 各块自身可交互 */
  body.detail-write-mode #detail-dock > #detail-timestamps-display {
      align-self: stretch; pointer-events: none;   /* 时间戳整行铺开但仍不挡点击 */
  }
  ```
- `pointer-events` 两级：dock 容器 `none` + 子块 `auto`，保证正文左下角空白处 `elementFromPoint` 命中 `#detail-task-notes`（dock 透明层不吃点击）。
- 实测（1600×950）：`#detail-body` 底 = 950 = 屏幕底；textarea 底 = 934；dock 底 = 950。

**2) 滚到最底、光标在文本最后一行时，继续下滑让光标区落到屏幕中部（书写视觉中部）**

- 改：给书写态正文框加**底部空白填充** `padding-bottom: 46vh`，滚到底时最后一行上方仍留有约半屏空白，使「最后一行」落在屏幕垂直中部而非贴底。
  ```css
  body.detail-write-mode #detail-task-notes {
      font-size: 16px; line-height: 1.8; min-height: 42vh;
      padding-bottom: 46vh;   /* 950 视口下：滚到底最后一行 y≈468，屏幕中线 475 */
  }
  ```
- 实测：滚到底最后一行 y=468（屏幕中线 475），差 7px，符合「视觉中部」。

**关键坑（本轮新发现，务必记牢）**
- **`_textElContentHeight` 必须扣除 padding**：`scrollHeight` **包含上下 padding**，而 `padding-bottom:46vh` 会把 scrollHeight 撑高约半屏 → 若不扣，第九轮的毛玻璃带底部会多出约 437px 空白。修：
  ```js
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const h = Math.max(0, el.scrollHeight - padY);
  ```
  `verify_glass.js` 的 `contentH` 同步修改。**任何改正文框 padding 的改动都要回头检查这里。**
- **瞬时动效类不能跨进程采样**：`wm-fx-enter` 等是瞬时类，`fx-low` 下 `_wmBodyFx` 的清理定时器约 190ms 后移除；用 `wait(30)` + 跨进程 `evaluate` 往返读会读到已清理的状态（仅 `fx-low` 因时长砍半而失败，且主/离线版时序随机）。**验证须在同一个 `page.evaluate` 内同步调用 `enterDetailWriteMode()` 后立即采集**。

**离线版**：`index_offline.html` 经 `tmp/sync_offline.py` 同步（panel 34890 / css 28450 chars）。

**验证**（`verify_round11.js`，主版 + 离线版 ALL_PASS，8 项）：`body_bottomAtScreen`/`textarea_bottomAtScreen`/`dock_absoluteAtBottom`/`dock_pointerEventsNone`/`dockChildPointerEventsAuto`/`blankHitsTextarea`/`scrolledLastLineNearCenter` 全 true。回归：`verify_round7.js`（enter 检查改同步采集）ALL PASS、`verify_glass.js` ALL_PASS、`verify_round10.js` ALL_PASS、`verify_round8_v2.js` ALL_PASS。

### 10.12 第十二轮改进记录（2026-10-02）—— 毛玻璃带跟随滚动、止于最后一行

**用户意图**：第十一轮用 `padding-bottom:46vh` 让「滚到底时最后一行落在屏幕中部」达成了，但**毛玻璃带没跟着走**——带子仍从标题一直铺到屏幕底，于是最后一行下方留出约半屏「空白玻璃」，看起来像**用一堆空白把文字顶到中间**。用户要的是：毛玻璃**跟随滚动**，滚到底时**也止于屏幕中部**——即整个书写区（纸面）的底边随滚动一起上移。

**根因（实测确认）**：`#detail-task-notes` 自身是滚动容器（`padding-bottom:46vh` 撑出可滚空间），`bodyScrollTop` 恒为 0。而 `updateWriteModeGlassBounds` 算的 `textBottom = nr.top + _textElContentHeight(notes)` —— `nr.top` 是**固定**的框顶，内容高也是整段高度，**完全没算 `scrollTop`**；长文本时该值远超面板底 → `bottom` 被 `Math.max(0,…)` 夹到 0 → 带子铺满到面板底。且滚动时根本没重算。

实测（1600×950，40 行）：滚到底 `scrollTop=822`、最后一行 y=468（中线 475），但 `bandBottom=950`（屏幕底），多出约 480px 空白玻璃。

**实现（`tasks.js`）**
- `updateWriteModeGlassBounds()`：最后一行在**视口**中的底边 = `框顶 + 内容高 − scrollTop`，因此 notes / desc 两项各减去各自的 `scrollTop`：
  ```js
  textBottom = Math.max(textBottom, nr.top + _textElContentHeight(notes) - (notes.scrollTop || 0));
  ```
  顶部（scrollTop=0）长文本时该值仍超面板底 → 仍 clamp 到面板底（行为不变）；越往下滚，`textBottom` 越小、`bottom` 越大，带子从底部向上收，滚到底时正好止于最后一行（≈屏幕中部）。
- `_initWmGlass()`：给 `#detail-body` / `#detail-task-notes` / `#detail-task-description` 加 `scroll` 监听（`{passive:true}` + `requestAnimationFrame` 节流），滚动过程中重算。
- `_textElContentHeight()`：**新增存/还原 `scrollTop`**。量高时把 `height` 设为 `auto`，文本框暂时不再溢出 → 浏览器把 `scrollTop` 夹回 0，恢复高度后不会自动回来；不还原的话，每次 input/scroll 都会把编辑框弹回顶部（滚动监听引入后尤其致命）。

**实测（1600×950，40 行）**
| 状态 | scrollTop | bandBottom | 最后一行底边 |
| ---- | ---- | ---- | ---- |
| 顶部 | 0 | 950（clamp 到面板底） | 1318（在视口下方） |
| 中途 | 411 | 907 | 907 |
| 底部 | 821 | 497 | 497（≈中线 475） |

即带子底边**始终等于最后一行底边**（顶部因 clamp 除外）。条纹背景截图确认：滚到底时带子止于最后一行，下方条纹清晰（无玻璃）。

**离线版**：`tasks.js` 主/离线版共用，无需同步。

**验证**（新增 `verify_round12.js`，主版 + 离线版 ALL_PASS，5 项）：`topFillsToPanel`（顶部铺到面板底）/`endBandTracksLastLine`（底部带边≈最后一行，±6px）/`endBandAtCenter`（底部落在屏幕中部 ±45px）/`midBandBetween`（中途带边单调处于两端之间）/`topBandBelowCenter`（长文本时顶部不提前止住）。回归：`verify_round7`/`verify_glass`/`verify_round11`/`verify_round10`/`verify_round8_v2` 全 ALL_PASS。
