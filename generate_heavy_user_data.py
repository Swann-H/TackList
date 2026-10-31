#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
重度用户测试数据生成器（TackList / 日程管理）

按当前系统的数据模型，生成一份"重度使用两年"后的完整配置：

  · 清单：文件夹、嵌套清单、归档清单、看板自定义分组与列顺序
  · 标签 / 过滤器（覆盖全部时间范围条件）/ 自定义倒计时 / 侧边栏固定倒计时
  · 任务：昨天 ~ 未来两年，每天 0~22 条，随机分布在各个时段
      - 全天 / 定时 / 时间区间 / 无日期 / 已逾期
      - 重要/紧急四象限、0~5 个提前提醒、Markdown 备注
      - 子任务模式、子任务独立时间与提醒、完成进度
      - 全部重复类型（每天/工作日/每周/首末工作日/每月/每年/节假日前一天/自定义）
      - 任务附件（图片 / PDF / Markdown / CSV / TXT / ZIP）
      - 回收站任务、存档清单任务、模板创建的任务
  · 任务模板（含使用次数与最近使用时间）
  · 番茄专注历史（默认昨天+今天，可用 --pomodoro-days 扩展）
  · 数值连贯的完成状态、创建/修改/完成时间

脚本会保留 data.json 中的真实数据，只清理本脚本与旧版 inject_test_data.py
注入的测试数据；写入前自动备份。

用法：
    python generate_heavy_user_data.py
    python generate_heavy_user_data.py --seed 42
    python generate_heavy_user_data.py --data-file tmp/data.json --attachments-dir tmp/attachments
    python generate_heavy_user_data.py --start 2026-10-30 --end 2028-10-31
    python generate_heavy_user_data.py --pomodoro-days 90 --no-attachments

注意：写入前请先退出正在运行的 TackList 服务，或写入后重启服务，
避免浏览器内存中的旧数据回写覆盖。
"""

import argparse
import csv
import io
import json
import os
import random
import re
import shutil
import struct
import sys
import uuid
import zipfile
import zlib
from datetime import date, datetime, timedelta, timezone

# ==================== 常量 ====================

MARK = '__heavy_user_data__'
LEGACY_MARK = '__test_data__'
TASK_ID_PREFIX = 'hyt_'
SUBTASK_ID_PREFIX = 'hyst_'
LIST_PREFIX = 'hylst_'
FOLDER_PREFIX = 'hyfold_'
TAG_PREFIX = 'hytag_'
FILTER_PREFIX = 'hyflt_'
TEMPLATE_PREFIX = 'hytpl_'
COUNTDOWN_PREFIX = 'hycd_'
GROUP_PREFIX = 'hygrp_'

# 旧版 inject_test_data.py 使用的固定 ID，仅按精确 ID 清理，避免误删用户数据
LEGACY_LIST_IDS = {
    'lst_work', 'lst_personal', 'lst_study', 'lst_health', 'lst_family',
    'lst_project', 'lst_reading', 'lst_finance', 'lst_social', 'lst_hobby',
}
LEGACY_TAG_IDS = {
    'tag_urgent', 'tag_routine', 'tag_deep', 'tag_quick', 'tag_meeting',
    'tag_creative', 'tag_review', 'tag_outdoor', 'tag_online', 'tag_weekend',
}
LEGACY_FILTER_IDS = {
    'flt_important_urgent', 'flt_work_deep', 'flt_health_outdoor',
    'flt_today_meeting', 'flt_quick_done',
}

COUNTDOWN_AUTO_KEY = '__auto_holiday__'
REMINDER_MAX_COUNT = 5
REMINDER_MAX_MINUTES = 10080
TAG_LIMIT = 20
FILTER_LIMIT = 10
COUNTDOWN_PIN_LIMIT = 2

DEFAULT_LIST_ID = 'default'

# ==================== 通用工具 ====================


def new_id(rng, prefix, used=None, length=16):
    """生成带前缀的随机 ID；used 为全局去重集合。"""
    alphabet = '0123456789abcdef'
    while True:
        value = prefix + ''.join(rng.choice(alphabet) for _ in range(length))
        if used is None or value not in used:
            if used is not None:
                used.add(value)
            return value


def add_years(d, years):
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(year=d.year + years, month=2, day=28)


def date_range(start_d, end_d):
    cur = start_d
    while cur <= end_d:
        yield cur
        cur += timedelta(days=1)


def to_iso_z(dt):
    """本地 naive / aware datetime → UTC ISO（与浏览器 toISOString 口径一致）。"""
    if dt.tzinfo is None:
        dt = dt.astimezone()
    return dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def iso_to_local_dt(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone()


def fill(text, ctx):
    if not text:
        return ''
    try:
        return text.format(**ctx)
    except (KeyError, IndexError, ValueError):
        return text


def choice_weighted(rng, items):
    values = list(items.keys())
    weights = list(items.values())
    return rng.choices(values, weights=weights, k=1)[0]


# ==================== 时区 / 日期语义 ====================

NOW = datetime.now().astimezone()
TODAY = NOW.date()


# ==================== 清单 / 分组 ====================

LIST_DEFS = [
    {'id': 'hyfold_work', 'name': '工作区', 'color': '#2563eb', 'isFolder': True},
    {'id': 'hylst_work', 'name': '工作', 'color': '#3b82f6', 'parentId': 'hyfold_work'},
    {'id': 'hylst_project', 'name': '项目', 'color': '#ec4899', 'parentId': 'hyfold_work'},
    {'id': 'hylst_meeting', 'name': '会议', 'color': '#f59e0b', 'parentId': 'hyfold_work'},
    {'id': 'hyfold_study', 'name': '学习区', 'color': '#7c3aed', 'isFolder': True},
    {'id': 'hylst_study', 'name': '学习', 'color': '#8b5cf6', 'parentId': 'hyfold_study'},
    {'id': 'hylst_reading', 'name': '阅读', 'color': '#06b6d4', 'parentId': 'hyfold_study'},
    {'id': 'hylst_health', 'name': '健康', 'color': '#ef4444'},
    {'id': 'hylst_family', 'name': '家庭', 'color': '#f59e0b'},
    {'id': 'hylst_finance', 'name': '财务', 'color': '#84cc16'},
    {'id': 'hylst_social', 'name': '社交', 'color': '#f97316'},
    {'id': 'hylst_hobby', 'name': '爱好', 'color': '#a855f7'},
    {'id': 'hylst_chores', 'name': '家务', 'color': '#64748b'},
    {'id': 'hylst_travel', 'name': '旅行', 'color': '#0ea5e9'},
    {'id': 'hylst_side', 'name': '副业', 'color': '#14b8a6'},
    {'id': 'hylst_archive', 'name': '旧项目（归档）', 'color': '#94a3b8', 'archived': True},
]

GROUP_DEFS = {
    'hylst_work': [
        ('hygrp_work_todo', '待办'),
        ('hygrp_work_doing', '进行中'),
        ('hygrp_work_wait', '等待反馈'),
        ('hygrp_work_done', '已完成'),
    ],
    'hylst_project': [
        ('hygrp_proj_req', '需求'),
        ('hygrp_proj_design', '设计'),
        ('hygrp_proj_dev', '开发'),
        ('hygrp_proj_test', '测试'),
        ('hygrp_proj_release', '上线'),
        ('hygrp_proj_block', '阻塞'),
    ],
}

CUSTOM_COLUMN_ORDER = {
    'hylst_project': [
        'hygrp_proj_req', 'hygrp_proj_design', 'hygrp_proj_dev',
        'hygrp_proj_test', 'hygrp_proj_release', 'hygrp_proj_block', 'ungrouped',
    ],
}

# ==================== 标签 ====================

TAG_DEFS = [
    {'key': 'deep', 'id': 'hytag_deep', 'name': '深度工作', 'color': '#3b82f6'},
    {'key': 'meeting', 'id': 'hytag_meeting', 'name': '会议', 'color': '#f59e0b'},
    {'key': 'urgent', 'id': 'hytag_urgent', 'name': '紧急处理', 'color': '#ef4444'},
    {'key': 'routine', 'id': 'hytag_routine', 'name': '例行事务', 'color': '#6b7280'},
    {'key': 'comm', 'id': 'hytag_comm', 'name': '沟通', 'color': '#0ea5e9'},
    {'key': 'travel', 'id': 'hytag_travel', 'name': '出差旅行', 'color': '#14b8a6'},
    {'key': 'creative', 'id': 'hytag_creative', 'name': '创意', 'color': '#ec4899'},
    {'key': 'review', 'id': 'hytag_review', 'name': '复盘', 'color': '#8b5cf6'},
    {'key': 'study', 'id': 'hytag_study', 'name': '学习', 'color': '#6366f1'},
    {'key': 'health', 'id': 'hytag_health', 'name': '健康', 'color': '#22c55e'},
    {'key': 'outdoor', 'id': 'hytag_outdoor', 'name': '户外', 'color': '#84cc16'},
    {'key': 'reading', 'id': 'hytag_reading', 'name': '阅读', 'color': '#06b6d4'},
    {'key': 'finance', 'id': 'hytag_finance', 'name': '理财', 'color': '#eab308'},
    {'key': 'chore', 'id': 'hytag_chore', 'name': '家务', 'color': '#78716c'},
    {'key': 'family', 'id': 'hytag_family', 'name': '家庭', 'color': '#f97316'},
    {'key': 'social', 'id': 'hytag_social', 'name': '社交', 'color': '#fb7185'},
    {'key': 'online', 'id': 'hytag_online', 'name': '线上', 'color': '#38bdf8'},
    {'key': 'weekend', 'id': 'hytag_weekend', 'name': '周末', 'color': '#a855f7'},
    {'key': 'waiting', 'id': 'hytag_waiting', 'name': '等待中', 'color': '#facc15'},
    {'key': 'quick', 'id': 'hytag_quick', 'name': '快速完成', 'color': '#10b981'},
]

# ==================== 文本素材 ====================

PEOPLE = ['张伟', '李娜', '王强', '刘洋', '陈晨', '赵敏', '周杰', '孙悦', '吴昊', '郑琪']
CLIENTS = ['华星科技', '远航物流', '星河银行', '青云教育', '北辰医疗', '启明制造', '云帆零售']
PROJECTS = ['星河 CRM', 'Atlas 数据平台', 'Meteor App', 'Nova 官网', 'Orion 中台', 'Lumen 小程序']
BOOKS = ['《深度工作》', '《原则》', '《思考，快与慢》', '《人类简史》', '《置身事内》',
         '《代码整洁之道》', '《系统之美》', '《金字塔原理》', '《纳瓦尔宝典》', '《反脆弱》']
COURSES = ['Python 数据分析', '分布式系统', '产品设计进阶', '英语听力', '机器学习基础',
           'SQL 优化', '项目管理实战', '商业分析', '前端工程化']
CITIES = ['杭州', '成都', '大理', '厦门', '西安', '青岛', '京都', '苏州', '重庆', '长沙']
BODY_PARTS = ['胸背', '腿部', '核心', '肩臂', '有氧', '全身循环']
CUISINES = ['火锅', '日料', '家常菜', '烧烤', '粤菜', '意大利面', '烘焙甜点', '云南菜']
FESTIVALS = ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节']

GENERIC_FOCUS_NAMES = ['专注工作', '阅读', '写作', '整理资料', '深度工作', '一般专注', '复盘思考']

# ==================== Markdown 素材 ====================
# 覆盖 markdown.js 支持的全部语法：1~3 级标题、粗体（** 与 __）、斜体（* 与 _）、
# 删除线、行内代码、``` 与 ~~~ 围栏代码、引用、无序/有序/嵌套列表、任务列表、
# 分割线、链接（含 title）、图片、硬换行。文本模式写入 notes，子任务模式写入 description。
MARKDOWN_BLOCKS = [
    """# 项目知识库

## 今日进展

**已完成**
- 梳理 {project} 的需求边界
- 与 {person} 确认接口字段
- 更新项目看板

**待跟进**
- [ ] 补充异常状态的处理说明
- [x] 同步测试同学联调时间
- [ ] 输出风险评估

> 重点关注：上线前必须完成回归与回滚演练。

参考：[项目文档](https://example.com/docs/{week})

---""",
    """## 技术方案

排查思路：
1. 复现问题并记录时间点
2. 对比最近一次变更
3. 在预发环境验证修复
4. 补充监控与告警

关键字段：`task.completedAt` / `repeat.repeatMode`

```bash
git log --oneline -10
curl -s http://127.0.0.1:14438/api/data | head
```

> 结论：先止血，再补测试，最后复盘。""",
    """### 复盘记录

**做得好的**
- 提前识别了 {project} 的依赖风险
- 每日同步进度，信息透明

**需要改进**
- ~~测试用例覆盖不足~~ → 已补充边界用例
- 会议时间偏长，后续控制在 45 分钟内

1. 建立风险清单
2. 明确责任人
3. 每周检查一次

> 经验：*可复用的流程*比一次性的补救更有价值。""",
    """## 阅读笔记

> 我们高估一年能做的事，却低估十年能做的事。

**核心观点**
- *长期主义*不是等待，而是持续投入
- 用系统代替意志力
- 把重要的事变成默认选项

延伸阅读：[读书笔记模板](https://example.com/notes "读书笔记模板")

![示意图](/favicon.png)

---""",
    """## 上线检查清单

- [x] 数据库备份完成
- [x] 配置变更已评审
- [ ] 灰度 5% 观察 30 分钟
- [ ] 全量发布
- [ ] 更新发布说明

**回滚条件**
1. 错误率超过 1%
2. P95 延迟翻倍
3. 出现数据一致性问题

> 任何一项不满足，立即停止发布。""",
    """### 本周计划

**目标**：完成 {project} 第一阶段交付。

- [ ] 需求冻结
- [ ] 接口联调
    - [ ] 用户中心
    - [ ] 订单服务
- [ ] 回归测试
- [x] 排期确认

> 周五 17:00 前提交周报。

相关链接：[排期表](https://example.com/plan)""",
    """## 会议纪要 · {project}

**时间**：本周三 14:00  
**参与人**：{person}、{person2}、我

### 结论
1. 范围保持不变，延期风险由测试资源消化
2. 接口字段以最新文档为准
3. 下周一进行灰度

### 待办
- [ ] {person} 补充接口文档
- [ ] 我更新排期
- [x] 同步客户

> 下次会议：下周一 10:00""",
    """## 风险与依赖

**高风险**（__必须今天确认__）
- 第三方接口稳定性未知
- 测试环境资源不足

**缓解措施**
- 增加降级开关
- 提前申请资源
- 每日跟踪风险状态

> 风险不可怕，*不可见*才可怕。

---""",
    """### 命令速查

~~~bash
python generate_heavy_user_data.py --seed 42
curl -s http://127.0.0.1:14438/api/data
~~~

- 查看端口：`cat server.port`
- 查看进程：`cat server.pid`
- ~~旧命令已废弃~~

> 更多说明见 [README](https://example.com/readme)""",
    """## 灵感记录

> 好的产品不是堆功能，而是让用户在正确的时刻做正确的事。

* 如果每天只允许做三件事，我会选什么？
* _把复杂留给自己_，把简单留给用户。
+ 用 `/api/data` 做一次端到端演练

![灵感板](/favicon.png)""",
    """### 每日回顾

**今天完成**
- [x] 推进了最重要的一件事
- [x] 处理完手头的待办
- [ ] 整理今天的记录

**明天优先**
1. 先完成最重要的事
2. 预留缓冲时间
3. 早点休息

> 明天最重要的一件事：*先做最重要的事*。""",
    """## 旅行准备

**证件**
- [x] 身份证
- [ ] 护照
- [ ] 驾照

**行程**
1) 订机票
2) 订酒店
3) 查 {city} 天气

> 出发前 24 小时在线值机。

[查看攻略](https://example.com/travel)""",
    """## 本周采购

- [ ] 牛奶
- [ ] 水果
- [x] 洗衣液
- [ ] 猫粮

**预算**：约 300 元

1. 先盘点库存
2. 再按清单购买
3. 回家分类收纳

> 避免在饥饿时逛超市。""",
    """## 学习笔记 · {course}

**本章重点**
- 理解核心概念与适用边界
- 用一个小例子验证
- 记录踩坑与解决方案

```python
def practice(items):
    for item in items:
        print(item)
```

> 学而不思则罔，*思而不学则殆*。

[课程资料](https://example.com/course)""",
    """## 健康记录

**今日目标**
- [x] 晨跑 5 公里
- [ ] 拉伸 15 分钟
- [ ] 23:00 前睡觉

1. 运动前热身
2. 运动后补水
3. 记录体感

> 身体是长期主义的本金。""",
    """## 本月账单

**固定支出**
- 房租
- 水电燃气
- 通信费

**待处理**
- [ ] 报销 3 张发票
- [ ] 核对信用卡账单
- [x] 基金定投

> 先储蓄，再消费。

---""",
    """## 客户沟通 · {client}

**诉求**
- 希望本月底前看到灰度版本
- 关注数据迁移的完整性

**回应**
1. 本周完成联调
2. 下周提供灰度计划
3. 数据迁移分两批验证

> 先确认目标，再讨论方案。

联系方式：[客户门户](https://example.com/client)""",
    """### 排查记录

**现象**：{project} 偶发 502，集中在晚间高峰。

**排查步骤**
1) 查看网关日志
2) 对比发布记录
3) 压测复现

关键日志：`upstream timed out`

```bash
tail -n 100 /var/log/nginx/error.log
```

> 先确认影响面，再动手修改。""",
    """## 阶段目标

- [x] 明确目标与验收标准
- [x] 拆解关键步骤
- [ ] 完成核心工作
- [ ] 检查与复盘
- [ ] 收尾归档

**关键日期**：{month} 月底

> 里程碑不是终点，而是下一次对齐的起点。

[查看计划](https://example.com/board "查看计划")""",
    """## 今日备忘

**重点**：`09:00` 前确认今天最重要的一件事，避免被琐事打断。

- 参考 [时间管理方法](https://example.com/focus)
- 相关事项：*长期目标*、~~已取消的安排~~
- 提醒：`23:00` 前休息

> 小步推进，及时复盘。""",
]

# 按任务类别可用的 Markdown 块下标；未命中的类别可用全部块
MARKDOWN_BLOCK_GROUPS = {
    'work': [0, 1, 2, 4, 5, 6, 7, 8, 16, 17, 18, 19],
    'project': [0, 1, 2, 4, 5, 6, 7, 8, 17, 18, 19],
    'meeting': [0, 2, 5, 6, 7, 8, 16, 17, 19],
    'study': [3, 13, 19],
    'reading': [2, 3, 13, 19],
    'health': [10, 14, 19],
    'family': [2, 10, 18, 19],
    'finance': [10, 12, 15, 18, 19],
    'social': [2, 10, 18, 19],
    'hobby': [2, 3, 9, 10, 13, 18],
    'chores': [2, 10, 12, 15, 19],
    'travel': [2, 10, 11, 12, 18, 19],
    'side': [0, 1, 2, 8, 9, 18, 19],
    'template': list(range(len(MARKDOWN_BLOCKS))),
}

# 标题关键词 → 更贴合的 Markdown 块；命中时优先于类别分组
MARKDOWN_KEYWORD_GROUPS = [
    (('电话', '父母', '家人'), [10, 19]),
    (('客户', '邮件', '会议', '评审'), [6, 16, 19]),
    (('采购', '账单', '报销', '缴费', '预算', '还款'), [12, 15, 19]),
    (('旅行', '行程', '机票', '酒店', '签证', '出行'), [11, 12, 19]),
    (('体检', '健身', '跑步', '健康', '瑜伽', '游泳', '骑行', '爬山', '训练'), [10, 14, 19]),
    (('读书', '阅读', '书评', '笔记'), [3, 13, 19]),
    (('学习', '课程', '练习', '复习', '单词', '论文'), [3, 13, 19]),
    (('写作', '视频', '公众号', '开源', '作品'), [1, 9, 19]),
    (('排查', '故障', '告警', 'Bug', '缺陷'), [1, 17, 19]),
    (('生日', '聚会', '婚礼', '聚餐', '活动'), [10, 18, 19]),
    (('打扫', '整理', '家务', '洗衣', '收纳', '清洁'), [10, 12, 19]),
    (('电影', '游戏', '吉他', '绘画', '摄影', '手工', '烹饪', '爱好'), [9, 10, 19]),
    (('基金', '保险', '资产', '理财', '股票'), [15, 18, 19]),
    (('孩子', '亲子', '宠物'), [10, 18, 19]),
    (('医院', '牙科', '药', '预约'), [10, 19]),
    (('面试', '培训', '入职'), [2, 10, 19]),
    (('代码', '接口', '部署', '联调', '测试', '上线'), [1, 4, 17, 19]),
    (('文档', '方案', '技术'), [1, 2, 19]),
]
_MARKDOWN_USED = set()


def _markdown_candidates(category, title=''):
    for keywords, indices in MARKDOWN_KEYWORD_GROUPS:
        if any(keyword in (title or '') for keyword in keywords):
            return indices
    return MARKDOWN_BLOCK_GROUPS.get(category) or list(range(len(MARKDOWN_BLOCKS)))


def _pick_markdown_block(rng, category, title=''):
    candidates = _markdown_candidates(category, title)
    unused = [i for i in range(len(MARKDOWN_BLOCKS)) if i not in _MARKDOWN_USED]
    if unused:
        preferred = [i for i in unused if i in candidates]
        index = preferred[0] if preferred else unused[0]
    else:
        index = rng.choice(candidates)
    _MARKDOWN_USED.add(index)
    return index, MARKDOWN_BLOCKS[index]


def _pick_extra_blocks(rng, category, count, exclude, title=''):
    if count <= 0:
        return []
    candidates = [i for i in _markdown_candidates(category, title) if i not in exclude]
    if not candidates:
        return []
    unused = [
        i for i in range(len(MARKDOWN_BLOCKS))
        if i not in _MARKDOWN_USED and i not in exclude
    ]
    preferred = [i for i in unused if i in candidates]
    if preferred:
        pool = preferred
    elif unused:
        pool = unused
    else:
        pool = candidates
    chosen = rng.sample(pool, k=min(count, len(pool)))
    remaining = count - len(chosen)
    if remaining > 0 and unused:
        fallback = [i for i in unused if i not in chosen]
        if fallback:
            chosen.extend(rng.sample(fallback, k=min(remaining, len(fallback))))
    _MARKDOWN_USED.update(chosen)
    return [MARKDOWN_BLOCKS[i] for i in chosen]


def has_markdown(text):
    if not text:
        return False
    return bool(re.search(r'(?m)^#{1,3}\s|```|~~~|^>\s?|^\s*[-*+]\s+|\*\*|__|~~', text))


def compose_markdown(rng, ctx, intro='', probability=0.80, category='', title='',
                     extra_count=None):
    """给备注/描述补充 Markdown 内容；intro 是原任务说明（纯文本）。"""
    intro = (intro or '').strip()
    if rng.random() >= probability:
        return intro
    index, first = _pick_markdown_block(rng, category, title)
    if extra_count is None:
        extra_count = rng.choices([0, 1, 2], weights=[55, 35, 10], k=1)[0]
    blocks = [first] + _pick_extra_blocks(rng, category, extra_count, {index}, title)
    rendered = [fill(block, ctx).strip() for block in blocks]
    parts = ([intro] if intro else []) + rendered
    return '\n\n'.join(part for part in parts if part)


def ensure_markdown(rng, ctx, text, probability=0.90, category='', title=''):
    text = (text or '').strip()
    if has_markdown(text):
        return text
    return compose_markdown(rng, ctx, text, probability, category, title)

# ==================== 时段 ====================

SLOT_WINDOWS = {
    'dawn': (5 * 60 + 30, 7 * 60),
    'morning': (7 * 60, 9 * 60),
    'work_am': (9 * 60, 11 * 60 + 30),
    'noon': (11 * 60 + 30, 13 * 60 + 30),
    'work_pm': (13 * 60 + 30, 17 * 60 + 30),
    'evening': (17 * 60 + 30, 20 * 60),
    'night': (20 * 60, 22 * 60 + 30),
    'late': (22 * 60 + 30, 23 * 60 + 45),
}


def pick_slot_time(slot, rng):
    start, end = SLOT_WINDOWS.get(slot, SLOT_WINDOWS['work_am'])
    minute = rng.randrange(start, end + 1, 15)
    return divmod(minute, 60)


# ==================== 任务规格 ====================

def S(title, *, notes='', description='', subtasks=None, tags=(), duration=(30, 60),
      slots=('work_am', 'work_pm'), all_day=0.0, no_end=0.16, list_id=None,
      important=None, urgent=None):
    return {
        'title': title,
        'notes': notes,
        'description': description,
        'subtasks': subtasks or [],
        'tags': tuple(tags),
        'duration': tuple(duration),
        'slots': tuple(slots),
        'all_day': all_day,
        'no_end': no_end,
        'list_id': list_id,
        'important': important,
        'urgent': urgent,
    }


CATEGORY_POOLS = {
    'work': [
        S('团队晨会同步', tags=('meeting', 'routine'),
          notes='同步昨日进展、今日计划与风险阻塞。',
          subtasks=[['更新昨日进展', '确认今日目标', '记录风险项']],
          duration=(30,), slots=('work_am',)),
        S('处理收件箱与待回复邮件', tags=('routine', 'quick'),
          notes='批量处理未读邮件，标记需要跟进的事项，清空收件箱。',
          duration=(30, 45), slots=('work_am', 'work_pm'), no_end=0.3),
        S('撰写第{week}周周报', tags=('review', 'deep'),
          notes='汇总本周关键产出、数据指标与下周计划。',
          subtasks=[['整理本周数据', '提炼关键结论', '列出下周计划', '发送给团队']],
          duration=(60, 90), slots=('work_pm',)),
        S('评审{project}需求文档', tags=('meeting', 'review'),
          notes='逐条确认范围、验收标准与依赖，输出评审结论。',
          subtasks=[['阅读需求初稿', '标注疑问点', '确认验收标准', '同步评审结论']],
          duration=(60, 90), slots=('work_am', 'work_pm')),
        S('与{client}对齐需求', tags=('comm', 'meeting'),
          notes='确认对方关注点，记录待办与责任人。',
          duration=(45, 60), slots=('work_am', 'work_pm')),
        S('跟进{project}项目进度', tags=('routine', 'comm'),
          notes='核对里程碑完成情况，更新风险清单。',
          duration=(30, 45), slots=('work_am', 'work_pm')),
        S('线上告警排查', tags=('urgent', 'deep'), important=True, urgent=True,
          notes='查看监控曲线与错误日志，先止血再定位根因。',
          subtasks=[['确认告警范围', '查看最近变更', '执行回滚或修复', '补充监控与结论']],
          duration=(90, 120), slots=('work_am', 'work_pm', 'evening')),
        S('整理会议纪要并同步', tags=('meeting', 'quick'),
          notes='纪要包含结论、待办、责任人和截止时间。',
          duration=(30,), slots=('work_pm',), no_end=0.3),
        S('处理审批与合同流程', tags=('routine',), notes='检查金额、条款与附件是否齐全。',
          duration=(20, 30), slots=('work_am',)),
        S('与{person} 1:1 沟通', tags=('comm', 'meeting'),
          notes='同步近期状态、目标进展与需要的支持。',
          duration=(30, 45), slots=('work_pm',)),
        S('准备季度汇报材料', tags=('deep', 'review'), important=True,
          notes='结构：目标回顾、关键结果、问题反思、下季度规划。',
          subtasks=[['收集各项目数据', '制作趋势图表', '撰写结论', '内部预演']],
          duration=(90, 120), slots=('work_pm',)),
        S('数据看板核对与异常分析', tags=('deep', 'quick'),
          notes='核对核心指标，对异常波动给出解释。',
          duration=(45, 60), slots=('work_am', 'work_pm')),
        S('面试候选人{person}', tags=('meeting',), notes='准备岗位问题与评价表。',
          duration=(60,), slots=('work_am', 'work_pm')),
        S('新员工入职培训', tags=('meeting',), important=True,
          notes='介绍团队、流程、工具与第一周目标。',
          subtasks=[['准备培训材料', '配置开发环境', '介绍团队成员', '分配首个任务']],
          duration=(60, 90), slots=('work_am',)),
        S('安全合规自查', tags=('review', 'deep'), notes='核对权限、密钥、日志与备份策略。',
          duration=(60,), slots=('work_pm',)),
        S('客户投诉处理', tags=('urgent', 'comm'), urgent=True,
          notes='先安抚并确认影响范围，再给出处理时限。',
          duration=(45, 60), slots=('work_am', 'work_pm')),
        S('制定下周排期', tags=('meeting', 'review'), notes='按优先级排期，预留缓冲时间。',
          duration=(45,), slots=('work_pm',)),
        S('整理归档项目资料', tags=('routine', 'quick'),
          notes='按项目归档文档、数据和会议记录。',
          duration=(30, 45), slots=('work_pm',), no_end=0.3),
        S('参加部门周会', tags=('meeting',), notes='同步部门目标与资源协调事项。',
          duration=(60,), slots=('work_am', 'work_pm')),
        S('输出复盘结论与改进项', tags=('review', 'deep'), important=True,
          notes='每个问题对应一个可执行的改进项。',
          duration=(60,), slots=('work_pm',)),
    ],
    'project': [
        S('冲刺计划会', tags=('meeting', 'routine'), notes='确认本冲刺目标、故事点与分工。',
          subtasks=[['回顾上冲刺', '确认本冲刺范围', '拆分任务', '认领任务']],
          duration=(60, 90), slots=('work_am',)),
        S('需求梳理工作坊', tags=('meeting', 'creative'), notes='用用户故事拆解核心场景。',
          duration=(90,), slots=('work_am', 'work_pm')),
        S('技术方案设计', tags=('deep', 'creative'), important=True,
          notes='包含架构图、数据流、异常处理与回滚方案。',
          subtasks=[['梳理约束条件', '画架构草图', '评估方案取舍', '输出技术方案']],
          duration=(120,), slots=('work_am', 'work_pm')),
        S('架构评审会', tags=('meeting', 'deep'), important=True,
          notes='重点评审扩展性、稳定性与成本。', duration=(90,), slots=('work_pm',)),
        S('接口联调与联测', tags=('deep', 'quick'), notes='按接口清单逐项验证，记录差异。',
          duration=(90, 120), slots=('work_am', 'work_pm')),
        S('代码评审', tags=('review', 'quick'), notes='关注边界条件、错误处理与可读性。',
          duration=(45, 60), slots=('work_pm',), no_end=0.25),
        S('补充单元测试', tags=('deep', 'quick'), notes='覆盖核心分支与异常路径。',
          duration=(60, 90), slots=('work_pm',)),
        S('测试回归验证', tags=('routine',), notes='按回归清单验证主流程与关键边界。',
          duration=(90, 120), slots=('work_am', 'work_pm')),
        S('灰度发布与观察', tags=('urgent', 'deep'), important=True,
          notes='按 5% → 20% → 50% 逐步放量，观察错误率与延迟。',
          subtasks=[['确认发布清单', '灰度 5%', '观察核心指标', '全量发布']],
          duration=(60, 90), slots=('work_pm', 'evening')),
        S('修复{project}缺陷', tags=('urgent', 'deep'), urgent=True,
          notes='先复现再修复，补充测试防止回归。',
          duration=(60, 120), slots=('work_am', 'work_pm')),
        S('性能优化专项', tags=('deep',), important=True,
          notes='定位热点路径，优化查询与缓存。',
          duration=(90, 120), slots=('work_pm',)),
        S('数据迁移脚本验证', tags=('deep', 'quick'), notes='在预发环境演练并校验差异。',
          duration=(90,), slots=('work_pm',)),
        S('里程碑验收', tags=('meeting', 'review'), important=True,
          notes='对照验收标准逐项演示与确认。', duration=(60,), slots=('work_pm',)),
        S('项目复盘会', tags=('review', 'meeting'),
          notes='复盘目标、过程、结果与可复用的经验。',
          subtasks=[['对比目标与结果', '回顾关键决策', '整理经验教训', '列出行动项']],
          duration=(60, 90), slots=('work_pm',)),
        S('风险评估与预案', tags=('deep', 'review'), notes='列出风险等级、触发条件与应对方案。',
          duration=(60,), slots=('work_pm',)),
        S('原型评审', tags=('meeting', 'creative'), notes='关注信息层级、交互路径与边界状态。',
          duration=(60,), slots=('work_am', 'work_pm')),
        S('用户访谈{person}', tags=('comm', 'deep'), notes='准备提纲，记录原话与关键洞察。',
          duration=(45, 60), slots=('work_am', 'work_pm')),
        S('编写发布说明', tags=('quick', 'review'), notes='按新增、优化、修复分类整理。',
          duration=(30, 45), slots=('work_pm',), no_end=0.3),
    ],
    'meeting': [
        S('部门周会', tags=('meeting',), notes='同步目标、进度与跨组协作事项。',
          duration=(60,), slots=('work_am',)),
        S('{project}项目对齐会', tags=('meeting', 'comm'), notes='对齐范围、排期与依赖风险。',
          duration=(60,), slots=('work_am', 'work_pm')),
        S('客户例会：{client}', tags=('meeting', 'comm'), notes='准备上周进展与本周期计划。',
          duration=(60,), slots=('work_pm',)),
        S('跨团队同步会', tags=('meeting', 'comm'), notes='确认接口人、交付物与时间节点。',
          duration=(45, 60), slots=('work_am', 'work_pm')),
        S('设计评审会', tags=('meeting', 'creative'), notes='评审关键页面与异常状态。',
          duration=(60, 90), slots=('work_pm',)),
        S('技术分享会', tags=('meeting', 'study'), notes='分享近期技术方案与踩坑经验。',
          duration=(60,), slots=('work_pm',)),
        S('1:1：{person}', tags=('meeting', 'comm'), notes='沟通状态、目标与成长计划。',
          duration=(30,), slots=('work_pm',)),
        S('面试：{person}', tags=('meeting',), notes='按评价表逐项记录。',
          duration=(60,), slots=('work_am', 'work_pm')),
        S('供应商沟通会', tags=('meeting', 'comm'), notes='确认报价、交付与售后条款。',
          duration=(45,), slots=('work_pm',)),
        S('复盘会', tags=('meeting', 'review'), notes='聚焦事实与改进，不追责个人。',
          duration=(60, 90), slots=('work_pm',)),
        S('需求答疑会', tags=('meeting',), notes='集中回答研发与测试的疑问。',
          duration=(30, 45), slots=('work_am',)),
    ],
    'study': [
        S('学习《{course}》第{n}章', tags=('study', 'deep'), notes='边学边记，完成章末练习。',
          duration=(60, 90), slots=('night',)),
        S('英语听力 30 分钟', tags=('study', 'routine'), notes='精听一段材料并跟读。',
          duration=(30,), slots=('morning', 'night')),
        S('背单词 50 个', tags=('study', 'quick'), notes='新词 + 复习，标记易错词。',
          duration=(30,), slots=('morning',)),
        S('刷算法题 2 道', tags=('study', 'deep'), notes='先自己想，再看题解并总结套路。',
          duration=(60, 90), slots=('night',)),
        S('阅读技术文档：{project}', tags=('study', 'reading'), notes='重点看设计取舍与示例代码。',
          duration=(45, 60), slots=('work_pm', 'night')),
        S('整理学习笔记', tags=('study', 'review'), notes='用自己的话复述，补充示例。',
          duration=(30, 45), slots=('night',), no_end=0.25),
        S('完成在线课程作业', tags=('study', 'online'), notes='按评分标准提交。',
          duration=(60,), slots=('night',)),
        S('参加线上讲座', tags=('study', 'online'), notes='记录三个可落地的要点。',
          duration=(90,), slots=('evening',)),
        S('复习错题集', tags=('study', 'review'), notes='重做错题，标记仍不理解的部分。',
          duration=(45,), slots=('night',)),
        S('练习英语口语', tags=('study', 'comm'), notes='录音回听，纠正发音与表达。',
          duration=(30,), slots=('night',)),
        S('写学习总结', tags=('study', 'review'), notes='本周学到什么、还缺什么、下一步做什么。',
          duration=(45,), slots=('night',)),
        S('项目实战练习', tags=('study', 'deep'), notes='把本阶段知识做成一个小项目。',
          duration=(90,), slots=('night', 'work_pm')),
        S('整理知识卡片', tags=('study', 'quick'), notes='每张卡片只写一个概念。',
          duration=(30,), slots=('night',), no_end=0.3),
        S('学习 SQL 优化', tags=('study', 'deep'), notes='分析执行计划，练习索引设计。',
          duration=(60,), slots=('night',)),
    ],
    'health': [
        S('晨跑 5 公里', tags=('health', 'outdoor'), notes='公园绿道，注意热身与拉伸。',
          duration=(45,), slots=('dawn', 'morning')),
        S('健身房训练：{bodypart}', tags=('health', 'routine'), notes='力量训练 + 20 分钟有氧。',
          duration=(60, 90), slots=('evening',)),
        S('游泳 1000 米', tags=('health',), notes='自由泳与蛙泳交替。',
          duration=(60,), slots=('evening',)),
        S('瑜伽拉伸', tags=('health', 'routine'), notes='重点放松肩颈与髋部。',
          duration=(30, 45), slots=('morning', 'night')),
        S('晚间散步', tags=('health', 'outdoor'), notes='不带手机，放空 30 分钟。',
          duration=(30, 45), slots=('night',)),
        S('体检预约', tags=('health',), notes='年度全身体检，提前空腹。',
          all_day=0.8, duration=(30,), slots=('morning',)),
        S('牙科检查', tags=('health',), notes='洗牙并检查智齿情况。',
          duration=(60,), slots=('work_pm',)),
        S('购买常备药', tags=('health', 'quick'), notes='补充感冒药、创可贴与肠胃药。',
          all_day=0.5, duration=(30,), slots=('evening',)),
        S('早睡打卡', tags=('health', 'routine'), notes='23:00 前放下手机。',
          duration=(15,), slots=('late',), no_end=0.6),
        S('户外骑行', tags=('health', 'outdoor'), notes='环湖路线，注意补水。',
          duration=(90, 120), slots=('morning',)),
        S('爬山', tags=('health', 'outdoor'), notes='提前查看天气与路线。',
          all_day=0.7, duration=(120,), slots=('morning',)),
        S('体脂测量', tags=('health', 'quick'), notes='记录体重、体脂与围度。',
          duration=(15,), slots=('morning',), no_end=0.6),
        S('冥想 15 分钟', tags=('health',), notes='关注呼吸，不评判走神。',
          duration=(15,), slots=('night',), no_end=0.5),
        S('眼科检查', tags=('health',), notes='复查视力与干眼情况。',
          all_day=0.4, duration=(60,), slots=('work_pm',)),
        S('打羽毛球', tags=('health', 'social'), notes='双打两局，注意热身。',
          duration=(90,), slots=('evening',)),
        S('攀岩体验', tags=('health', 'outdoor'), notes='室内抱石，练习基础动作。',
          duration=(120,), slots=('work_pm', 'evening')),
    ],
    'family': [
        S('陪孩子写作业', tags=('family', 'routine'), notes='先让孩子独立完成，再一起检查。',
          duration=(60, 90), slots=('evening',)),
        S('陪孩子上兴趣班', tags=('family',), notes='带上水壶和备用衣物。',
          all_day=0.2, duration=(90, 120), slots=('morning', 'work_pm')),
        S('家庭晚餐', tags=('family', 'routine'), notes='一起做饭，聊聊今天发生的事。',
          duration=(60, 90), slots=('evening',)),
        S('看望父母', tags=('family', 'weekend'), notes='带些水果，检查家里水电。',
          all_day=0.6, duration=(120,), slots=('morning', 'work_pm')),
        S('家庭大扫除', tags=('family', 'chore', 'weekend'), notes='分区清理，开窗通风。',
          all_day=0.35, duration=(120,), slots=('morning',)),
        S('家庭采购', tags=('family', 'chore', 'weekend'), notes='按清单采购，避免冲动消费。',
          duration=(60, 90), slots=('morning', 'work_pm'), all_day=0.15),
        S('给孩子准备生日', tags=('family', 'creative'), notes='订蛋糕、准备礼物与装饰。',
          all_day=0.8, duration=(90,), slots=('evening',)),
        S('家庭电影夜', tags=('family', 'weekend'), notes='准备零食，选一部全家都喜欢的电影。',
          duration=(120,), slots=('night',)),
        S('接送孩子', tags=('family', 'routine'), notes='提前十分钟出门，注意天气。',
          duration=(30,), slots=('morning', 'evening'), no_end=0.4),
        S('修理家居', tags=('family', 'chore'), notes='检查门锁、水龙头与灯具。',
          duration=(60, 90), slots=('work_pm', 'morning')),
        S('整理旧物', tags=('family', 'chore', 'weekend'), notes='分类保留、捐赠与丢弃。',
          duration=(90,), slots=('work_pm',)),
        S('亲子阅读', tags=('family', 'reading'), notes='让孩子选书，读后复述故事。',
          duration=(30, 45), slots=('night',)),
        S('家庭会议', tags=('family', 'meeting'), notes='回顾本周、安排下周、讨论家庭事务。',
          duration=(45,), slots=('evening',)),
        S('宠物洗澡', tags=('family', 'chore'), notes='洗澡、吹干、清理耳朵。',
          duration=(60,), slots=('work_pm', 'morning')),
        S('给父母打电话', tags=('family', 'comm'), notes='聊聊近况，提醒天气变化。',
          duration=(15, 30), slots=('evening',), no_end=0.4),
        S('准备{festival}家庭聚会', tags=('family', 'weekend'), notes='确认人数、菜单与座位。',
          all_day=0.4, duration=(90,), slots=('morning', 'work_pm')),
    ],
    'finance': [
        S('记录本月支出', tags=('finance', 'routine'), notes='补录未记账的消费，分类汇总。',
          duration=(30,), slots=('night',)),
        S('核对信用卡账单', tags=('finance', 'review'), notes='逐笔核对，标记异常消费。',
          duration=(30, 45), slots=('evening', 'night')),
        S('提交报销单', tags=('finance', 'routine'), notes='粘贴发票，填写事由与金额。',
          duration=(30,), slots=('work_pm',)),
        S('缴纳水电费', tags=('finance', 'quick'), notes='核对账单周期与用量。',
          all_day=0.25, duration=(20,), slots=('evening',), no_end=0.4),
        S('缴纳房租', tags=('finance', 'routine'), notes='确认租约与付款账户。',
          duration=(20,), slots=('morning',), no_end=0.4),
        S('基金定投', tags=('finance',), notes='确认扣款金额与账户余额。',
          duration=(15,), slots=('morning',), no_end=0.5),
        S('保险续费', tags=('finance',), important=True, notes='确认保障范围与续费金额。',
          duration=(30,), slots=('work_pm',)),
        S('年度税务申报', tags=('finance', 'review'), important=True,
          notes='整理收入、专项扣除与凭证。',
          all_day=0.3, duration=(90,), slots=('work_pm',)),
        S('整理发票', tags=('finance', 'quick'), notes='按月份与类别归档。',
          duration=(30,), slots=('night',), no_end=0.3),
        S('预算复盘', tags=('finance', 'review'), notes='对比预算与实际，分析偏差原因。',
          duration=(60,), slots=('night',)),
        S('还信用卡', tags=('finance', 'routine'), notes='确认还款金额与到账时间。',
          duration=(15,), slots=('morning',), no_end=0.5),
        S('整理家庭资产表', tags=('finance', 'review'), notes='更新现金、理财与负债。',
          duration=(60,), slots=('night',)),
        S('比价并采购大件', tags=('finance', 'quick'), notes='对比三家报价与售后。',
          duration=(45,), slots=('work_pm',)),
    ],
    'social': [
        S('朋友聚餐', tags=('social', 'weekend'), notes='提前确认人数与忌口。',
          duration=(120, 180), slots=('evening',)),
        S('参加婚礼', tags=('social', 'weekend'), notes='准备红包，确认着装与交通。',
          all_day=0.8, duration=(180,), slots=('morning',)),
        S('生日聚会', tags=('social', 'weekend'), notes='订蛋糕，准备小礼物。',
          duration=(120, 180), slots=('evening',)),
        S('与{person}喝咖啡', tags=('social', 'comm'), notes='聊聊近况与行业动态。',
          duration=(60, 90), slots=('work_pm', 'evening')),
        S('行业沙龙', tags=('social', 'study'), notes='准备自我介绍，记录潜在合作机会。',
          duration=(120,), slots=('evening',)),
        S('同学聚会', tags=('social', 'weekend'), notes='提前订位，确认交通。',
          duration=(180,), slots=('evening',)),
        S('给朋友回电话', tags=('social', 'comm'), notes='回访近况，约下次见面。',
          duration=(15, 30), slots=('evening',), no_end=0.5),
        S('参加读书会', tags=('social', 'reading'), notes='提前读完指定章节并准备分享。',
          duration=(90,), slots=('work_pm', 'evening')),
        S('社区活动', tags=('social', 'weekend'), notes='了解活动安排，带上水杯。',
          duration=(90, 120), slots=('morning',)),
        S('拜访客户{client}', tags=('social', 'comm'), notes='准备资料与伴手礼。',
          duration=(60, 90), slots=('work_am', 'work_pm')),
        S('团建活动', tags=('social', 'weekend'), notes='确认集合时间与交通方式。',
          all_day=0.6, duration=(180,), slots=('work_pm',)),
        S('志愿者活动', tags=('social', 'outdoor'), notes='提前报名，穿舒适衣物。',
          duration=(120,), slots=('morning',)),
        S('邻居聚餐', tags=('social',), notes='准备一道拿手菜。',
          duration=(120,), slots=('evening',)),
    ],
    'hobby': [
        S('摄影外拍', tags=('hobby', 'creative', 'outdoor'), notes='拍摄城市天际线与街景。',
          duration=(120, 180), slots=('morning', 'work_pm')),
        S('练习吉他 30 分钟', tags=('hobby', 'creative'), notes='练习和弦转换与节奏。',
          duration=(30,), slots=('night',)),
        S('绘画练习', tags=('hobby', 'creative'), notes='临摹一张喜欢的作品。',
          duration=(60, 90), slots=('night',)),
        S('做手账', tags=('hobby', 'creative'), notes='整理照片与本周记录。',
          duration=(45,), slots=('night',)),
        S('烹饪新菜：{cuisine}', tags=('hobby', 'creative'), notes='提前备好食材，记录调味比例。',
          duration=(90, 120), slots=('work_pm', 'evening')),
        S('玩游戏放松', tags=('hobby',), notes='控制在一小时内，注意休息眼睛。',
          duration=(60,), slots=('night',)),
        S('拼模型', tags=('hobby', 'creative'), notes='按说明书分件，耐心打磨。',
          duration=(90,), slots=('work_pm', 'night')),
        S('写歌', tags=('hobby', 'creative'), notes='记录旋律动机与歌词片段。',
          duration=(60,), slots=('night',)),
        S('剪辑视频', tags=('hobby', 'creative'), notes='整理素材，先粗剪再精修。',
          duration=(90, 120), slots=('night',)),
        S('练习书法', tags=('hobby', 'creative'), notes='临帖 30 分钟，注意结构。',
          duration=(45,), slots=('morning', 'night')),
        S('种花', tags=('hobby', 'outdoor'), notes='浇水、修剪与换盆。',
          duration=(45,), slots=('morning',)),
        S('逛展览', tags=('hobby', 'creative', 'weekend'), notes='提前预约，带好相机。',
          duration=(120,), slots=('work_pm',)),
        S('陶艺体验', tags=('hobby', 'creative'), notes='体验拉坯，注意控制水分。',
          duration=(120,), slots=('work_pm',)),
    ],
    'reading': [
        S('阅读《{book}》第{n}章', tags=('reading', 'deep'), notes='边读边标注，读完写三句话总结。',
          duration=(30, 45), slots=('night',)),
        S('整理读书笔记', tags=('reading', 'review'), notes='把摘录与自己的想法分开记录。',
          duration=(30, 45), slots=('night',), no_end=0.25),
        S('写书评', tags=('reading', 'deep'), notes='结构：核心观点、论证、启发与质疑。',
          duration=(60,), slots=('work_pm', 'night')),
        S('听书 30 分钟', tags=('reading', 'routine'), notes='通勤或散步时听。',
          duration=(30,), slots=('morning', 'evening')),
        S('摘录金句', tags=('reading', 'quick'), notes='每段摘录标注页码与感想。',
          duration=(15, 30), slots=('night',), no_end=0.4),
        S('逛书店', tags=('reading', 'weekend'), notes='只看不买也可以，记录想读的书。',
          duration=(90,), slots=('work_pm',)),
        S('阅读行业报告', tags=('reading', 'deep'), notes='关注数据趋势与关键结论。',
          duration=(45, 60), slots=('work_pm',)),
        S('参加读书会', tags=('reading', 'social'), notes='准备两个讨论问题。',
          duration=(90,), slots=('work_pm', 'evening')),
        S('重读经典章节', tags=('reading', 'review'), notes='带着新问题重读旧内容。',
          duration=(30,), slots=('night',)),
        S('制定阅读计划', tags=('reading', 'review'), notes='列出本月书单与每周页数。',
          duration=(30,), slots=('night',), no_end=0.3),
    ],
    'chores': [
        S('洗衣与晾晒', tags=('chore', 'routine'), notes='按颜色与材质分类。',
          duration=(30, 45), slots=('morning', 'evening')),
        S('打扫房间', tags=('chore', 'weekend'), notes='先收纳再除尘，最后拖地。',
          duration=(60, 90), slots=('morning', 'work_pm')),
        S('整理衣柜', tags=('chore', 'weekend'), notes='按季节与使用频率分区。',
          duration=(90,), slots=('work_pm',)),
        S('取快递', tags=('chore', 'quick'), notes='顺路取回并当场验货。',
          duration=(15, 30), slots=('evening',), no_end=0.5),
        S('采购日用品', tags=('chore', 'quick'), notes='按清单购买，比较单价。',
          duration=(60,), slots=('evening',), all_day=0.2),
        S('倒垃圾', tags=('chore', 'quick'), notes='干湿分类，顺手换垃圾袋。',
          duration=(10, 15), slots=('evening',), no_end=0.6),
        S('擦窗户', tags=('chore', 'weekend'), notes='先湿擦再干擦，注意安全。',
          duration=(60,), slots=('morning',)),
        S('清理冰箱', tags=('chore', 'weekend'), notes='丢弃过期食品，擦拭隔层。',
          duration=(45,), slots=('work_pm',)),
        S('给绿植浇水', tags=('chore', 'routine'), notes='检查土壤湿度，避免积水。',
          duration=(10, 15), slots=('morning',), no_end=0.6),
        S('缴纳物业费', tags=('chore', 'finance'), notes='核对费用明细与缴费周期。',
          duration=(20,), slots=('evening',), no_end=0.4),
        S('预约家政服务', tags=('chore', 'quick'), notes='确认时间、价格与服务范围。',
          duration=(15,), slots=('work_pm',), no_end=0.5),
        S('更换床单', tags=('chore', 'weekend'), notes='顺便清洗枕套与毯子。',
          duration=(30,), slots=('morning',)),
        S('整理书桌', tags=('chore', 'quick'), notes='只留下当前项目需要的物品。',
          duration=(30,), slots=('evening',), no_end=0.3),
    ],
    'travel': [
        S('制定{city}行程', tags=('travel', 'creative'), notes='列出必去景点、餐厅与交通方式。',
          subtasks=[['确定日期与预算', '筛选景点', '安排每日路线', '预订交通住宿']],
          duration=(90,), slots=('evening',)),
        S('预订机票与酒店', tags=('travel', 'quick'), notes='比较价格与退改政策。',
          duration=(60,), slots=('evening',)),
        S('办理签证', tags=('travel',), important=True, notes='准备材料并预约递交时间。',
          duration=(90,), slots=('work_pm',)),
        S('收拾行李', tags=('travel', 'quick'), notes='按清单准备衣物、药品与充电器。',
          duration=(60,), slots=('night',)),
        S('兑换外币', tags=('travel', 'finance'), notes='提前预约，比较汇率。',
          duration=(30,), slots=('work_pm',), no_end=0.3),
        S('购买旅行保险', tags=('travel',), notes='确认医疗与行李保障范围。',
          duration=(20,), slots=('evening',), no_end=0.4),
        S('查看{city}攻略', tags=('travel', 'reading'), notes='收藏交通、美食与避坑信息。',
          duration=(45,), slots=('night',)),
        S('出发前往{city}', tags=('travel', 'outdoor'), notes='提前两小时到达机场/车站。',
          all_day=0.9, duration=(180,), slots=('morning',)),
        S('{city}景点打卡', tags=('travel', 'outdoor'), notes='错峰出行，注意防晒。',
          duration=(180,), slots=('morning',)),
        S('返程回家', tags=('travel',), notes='预留足够时间，检查随身物品。',
          duration=(120,), slots=('evening',)),
        S('整理旅行照片', tags=('travel', 'creative'), notes='按日期归档，挑选精修。',
          duration=(60,), slots=('night',)),
        S('旅行记账', tags=('travel', 'finance'), notes='汇总交通、住宿、餐饮与门票。',
          duration=(30,), slots=('night',), no_end=0.3),
        S('准备{festival}出行计划', tags=('travel', 'weekend'), notes='避开高峰，提前订票。',
          all_day=0.3, duration=(60,), slots=('evening',)),
    ],
    'side': [
        S('写公众号文章', tags=('creative', 'deep'),
          notes='确定选题、列提纲、完成初稿。',
          subtasks=[['确定选题', '收集素材', '完成初稿', '修改排版']],
          duration=(90,), slots=('night',)),
        S('录制视频素材', tags=('creative',), notes='准备脚本与灯光，多录几条备用。',
          duration=(60,), slots=('work_pm',)),
        S('剪辑视频', tags=('creative', 'deep'), notes='先粗剪结构，再处理字幕与音效。',
          duration=(120,), slots=('night',)),
        S('维护开源项目', tags=('deep', 'online'), notes='处理 issue、评审 PR、更新文档。',
          duration=(90,), slots=('night',)),
        S('回复读者留言', tags=('comm', 'quick'), notes='集中回复，收集常见问题。',
          duration=(30,), slots=('evening',), no_end=0.4),
        S('评估接单需求', tags=('comm', 'review'), notes='评估范围、周期与报价。',
          duration=(45,), slots=('work_pm',)),
        S('副业收入记账', tags=('finance', 'quick'), notes='记录收入、成本与税费。',
          duration=(20,), slots=('night',), no_end=0.4),
        S('学习独立开发', tags=('study', 'deep'), notes='拆解一个产品并复刻核心功能。',
          duration=(60,), slots=('night',)),
        S('更新作品集', tags=('creative', 'review'), notes='补齐项目背景、过程与结果。',
          duration=(90,), slots=('work_pm',)),
        S('研究选题', tags=('creative', 'study'), notes='记录灵感与目标读者。',
          duration=(45,), slots=('night',)),
    ],
}

CATEGORY_LIST_DEFAULT = {
    'work': 'hylst_work',
    'project': 'hylst_project',
    'meeting': 'hylst_meeting',
    'study': 'hylst_study',
    'health': 'hylst_health',
    'family': 'hylst_family',
    'finance': 'hylst_finance',
    'social': 'hylst_social',
    'hobby': 'hylst_hobby',
    'reading': 'hylst_reading',
    'chores': 'hylst_chores',
    'travel': 'hylst_travel',
    'side': 'hylst_side',
}

CATEGORY_DEFAULT_TAGS = {
    'work': ('routine',),
    'project': ('deep',),
    'meeting': ('meeting',),
    'study': ('study',),
    'health': ('health',),
    'family': ('family',),
    'finance': ('finance',),
    'social': ('social',),
    'hobby': ('creative',),
    'reading': ('reading',),
    'chores': ('chore',),
    'travel': ('travel',),
    'side': ('creative',),
}

CATEGORY_PRIORITY_WEIGHTS = {
    'work': (0.35, 0.32, 0.15, 0.18),
    'project': (0.30, 0.30, 0.15, 0.25),
    'meeting': (0.50, 0.30, 0.10, 0.10),
    'study': (0.50, 0.35, 0.10, 0.05),
    'health': (0.60, 0.25, 0.10, 0.05),
    'family': (0.55, 0.30, 0.10, 0.05),
    'finance': (0.40, 0.40, 0.10, 0.10),
    'social': (0.65, 0.20, 0.10, 0.05),
    'hobby': (0.70, 0.20, 0.05, 0.05),
    'reading': (0.65, 0.25, 0.05, 0.05),
    'chores': (0.70, 0.15, 0.10, 0.05),
    'travel': (0.50, 0.30, 0.10, 0.10),
    'side': (0.50, 0.30, 0.10, 0.10),
}

CATEGORY_ALL_DAY_PROB = {
    'work': 0.03,
    'project': 0.02,
    'meeting': 0.02,
    'study': 0.04,
    'health': 0.10,
    'family': 0.25,
    'finance': 0.18,
    'social': 0.20,
    'hobby': 0.18,
    'reading': 0.12,
    'chores': 0.22,
    'travel': 0.45,
    'side': 0.08,
}

CATEGORY_SLOTS = {
    'work': ('work_am', 'work_pm', 'work_pm'),
    'project': ('work_am', 'work_pm', 'work_pm'),
    'meeting': ('work_am', 'work_pm', 'noon'),
    'study': ('morning', 'night', 'night'),
    'health': ('dawn', 'morning', 'evening', 'evening'),
    'family': ('evening', 'night', 'morning'),
    'finance': ('evening', 'night', 'work_pm'),
    'social': ('evening', 'evening', 'work_pm'),
    'hobby': ('night', 'night', 'work_pm'),
    'reading': ('night', 'night', 'morning'),
    'chores': ('morning', 'evening', 'work_pm'),
    'travel': ('evening', 'night', 'morning'),
    'side': ('night', 'night', 'work_pm'),
}

CATEGORY_DURATIONS = {
    'work': (30, 45, 60, 90),
    'project': (60, 90, 120),
    'meeting': (30, 45, 60, 90),
    'study': (30, 45, 60, 90),
    'health': (30, 45, 60, 90),
    'family': (60, 90, 120),
    'finance': (20, 30, 45, 60),
    'social': (90, 120, 180),
    'hobby': (45, 60, 90, 120),
    'reading': (30, 45, 60),
    'chores': (20, 30, 45, 60, 90),
    'travel': (60, 90, 120, 180),
    'side': (60, 90, 120),
}

DAY_CATEGORY_WEIGHTS = {
    'weekday': {
        'work': 30, 'project': 14, 'meeting': 8, 'study': 11, 'health': 10,
        'family': 7, 'finance': 5, 'social': 3, 'hobby': 3, 'reading': 4,
        'chores': 2, 'travel': 0.5, 'side': 2,
    },
    'weekend': {
        'work': 4, 'project': 3, 'meeting': 2, 'study': 8, 'health': 12,
        'family': 20, 'finance': 5, 'social': 15, 'hobby': 14, 'reading': 10,
        'chores': 12, 'travel': 2, 'side': 3,
    },
    'holiday': {
        'work': 2, 'project': 1, 'meeting': 1, 'study': 7, 'health': 8,
        'family': 25, 'finance': 5, 'social': 15, 'hobby': 12, 'reading': 8,
        'chores': 5, 'travel': 16, 'side': 2,
    },
    'workday_override': {
        'work': 28, 'project': 13, 'meeting': 8, 'study': 10, 'health': 9,
        'family': 8, 'finance': 6, 'social': 3, 'hobby': 3, 'reading': 4,
        'chores': 3, 'travel': 1, 'side': 2,
    },
}

RANDOM_REPEAT_PROB = 0.022


def random_repeat_rule(rng):
    rule_type = choice_weighted(rng, {
        'weekly': 40,
        'monthly': 20,
        'custom_days': 12,
        'custom_weeks': 8,
        'daily': 5,
        'workday': 5,
        'weekly_first': 3,
        'weekly_last': 3,
        'monthly_first': 2,
        'monthly_last': 2,
    })
    mode = rng.choices(['startTime', 'completeTime'], weights=[85, 15], k=1)[0]
    if rule_type == 'weekly':
        rule = {'type': 'weekly', 'repeatMode': mode}
        if rng.random() < 0.4:
            rule['dayOfWeek'] = rng.randint(0, 6)
        return rule
    if rule_type == 'monthly':
        rule = {'type': 'monthly', 'repeatMode': mode}
        if rng.random() < 0.5:
            rule['dayOfMonth'] = rng.randint(1, 28)
        return rule
    if rule_type == 'custom_days':
        return {'type': 'custom', 'interval': rng.choice([2, 3, 5, 7, 10]),
                'unit': 'days', 'repeatMode': mode}
    if rule_type == 'custom_weeks':
        return {'type': 'custom', 'interval': rng.choice([2, 3, 4]),
                'unit': 'weeks', 'repeatMode': mode}
    if rule_type == 'daily':
        return {'type': 'daily', 'repeatMode': mode}
    if rule_type == 'workday':
        return {'type': 'daily', 'workdayOnly': True, 'repeatMode': mode}
    if rule_type == 'weekly_first':
        return {'type': 'weeklyFirstWorkday', 'repeatMode': mode}
    if rule_type == 'weekly_last':
        return {'type': 'weeklyLastWorkday', 'repeatMode': mode}
    if rule_type == 'monthly_first':
        return {'type': 'monthlyFirstWorkday', 'repeatMode': mode}
    return {'type': 'monthlyLastWorkday', 'repeatMode': mode}


# ==================== 模板预置 ====================

TEMPLATE_DEFS = [
    {
        'name': '周计划',
        'title': '制定本周计划',
        'notes': '本周目标\n\n关键任务\n\n风险与依赖',
        'list': 'hylst_work',
        'tags': ['review', 'deep'],
        'important': True,
        'urgent': False,
        'reminders': [60],
        'suggestedTime': '09:00',
        'suggestedEndTime': '10:00',
        'repeat': {'type': 'weekly', 'dayOfWeek': 1, 'repeatMode': 'startTime'},
        'subtasks': ['回顾上周结果', '确定本周目标', '拆解关键任务', '预留缓冲时间'],
    },
    {
        'name': '每日站会',
        'title': '团队每日站会',
        'notes': '昨日完成\n\n今日计划\n\n风险与阻塞',
        'list': 'hylst_meeting',
        'tags': ['meeting', 'routine'],
        'important': False,
        'urgent': False,
        'reminders': [5],
        'suggestedTime': '09:30',
        'suggestedEndTime': '09:45',
        'repeat': {'type': 'daily', 'workdayOnly': True, 'repeatMode': 'startTime'},
        'subtasks': ['更新昨日进展', '确认今日目标', '记录阻塞项'],
    },
    {
        'name': '需求评审',
        'title': '需求评审会',
        'notes': '背景与目标\n\n关键需求\n\n验收标准\n\n风险与依赖',
        'list': 'hylst_project',
        'tags': ['meeting', 'review'],
        'important': True,
        'urgent': False,
        'reminders': [30, 10],
        'suggestedTime': '14:00',
        'suggestedEndTime': '15:30',
        'subtasks': ['提前阅读需求文档', '确认验收标准', '评估开发工作量', '输出评审结论'],
    },
    {
        'name': '线上故障复盘',
        'title': '线上故障复盘',
        'notes': '故障时间线\n\n影响范围\n\n根因分析\n\n改进项与责任人',
        'list': 'hylst_project',
        'tags': ['review', 'urgent'],
        'important': True,
        'urgent': True,
        'reminders': [60],
        'suggestedTime': '16:00',
        'suggestedEndTime': '17:00',
        'subtasks': ['整理时间线', '确认影响范围', '分析根因', '列出改进项并指定负责人'],
    },
    {
        'name': '读书笔记',
        'title': '整理读书笔记',
        'notes': '核心观点\n\n关键摘录\n\n我的思考\n\n行动启发',
        'list': 'hylst_reading',
        'tags': ['reading', 'review'],
        'important': False,
        'urgent': False,
        'reminders': [],
        'suggestedTime': '21:30',
        'subtasks': ['回顾划线内容', '提炼核心观点', '写下个人思考'],
    },
    {
        'name': '健身计划',
        'title': '制定本周健身计划',
        'notes': '训练部位\n\n有氧安排\n\n恢复与饮食',
        'list': 'hylst_health',
        'tags': ['health', 'routine'],
        'important': False,
        'urgent': False,
        'reminders': [60],
        'suggestedTime': '19:00',
        'suggestedEndTime': '19:30',
        'repeat': {'type': 'weekly', 'dayOfWeek': 0, 'repeatMode': 'startTime'},
        'subtasks': ['确定训练日', '安排有氧与力量', '预留恢复时间'],
    },
    {
        'name': '家庭采购',
        'title': '家庭采购清单',
        'notes': '食品\n\n日用品\n\n药品\n\n其他',
        'list': 'hylst_family',
        'tags': ['family', 'chore'],
        'important': False,
        'urgent': False,
        'reminders': [],
        'suggestedTime': '10:00',
        'suggestedEndTime': '11:00',
        'subtasks': ['检查冰箱库存', '列出采购清单', '比价并采购', '回家分类收纳'],
    },
    {
        'name': '旅行清单',
        'title': '旅行准备清单',
        'notes': '证件\n\n交通住宿\n\n衣物药品\n\n行程与预算',
        'list': 'hylst_travel',
        'tags': ['travel'],
        'important': True,
        'urgent': False,
        'reminders': [1440],
        'suggestedTime': '20:00',
        'suggestedEndTime': '20:30',
        'subtasks': ['确认证件有效期', '预订交通住宿', '整理行李清单', '购买旅行保险'],
    },
    {
        'name': '月度对账',
        'title': '月度账目核对',
        'notes': '收入\n\n支出\n\n预算差异\n\n下月调整',
        'list': 'hylst_finance',
        'tags': ['finance', 'review'],
        'important': True,
        'urgent': False,
        'reminders': [60],
        'suggestedTime': '20:30',
        'suggestedEndTime': '21:00',
        'repeat': {'type': 'monthly', 'dayOfMonth': 28, 'repeatMode': 'startTime'},
        'subtasks': ['导出账单', '分类核对支出', '更新预算表', '标记异常项'],
    },
    {
        'name': '深度工作块',
        'title': '深度工作',
        'notes': '单一目标\n\n关闭通知\n\n记录进展与卡点',
        'list': 'hylst_work',
        'tags': ['deep'],
        'important': True,
        'urgent': False,
        'reminders': [15],
        'suggestedTime': '09:00',
        'suggestedEndTime': '11:00',
        'subtasks': ['明确本次唯一目标', '关闭通知与聊天', '完成一个可交付成果'],
    },
    {
        'name': '客户拜访',
        'title': '客户拜访准备',
        'notes': '客户背景\n\n本次目标\n\n材料清单\n\n后续跟进',
        'list': 'hylst_social',
        'tags': ['comm', 'meeting'],
        'important': True,
        'urgent': False,
        'reminders': [30, 120],
        'suggestedTime': '14:30',
        'suggestedEndTime': '15:30',
        'subtasks': ['了解客户近况', '准备演示材料', '确认参会人', '记录后续行动'],
    },
    {
        'name': '周复盘',
        'title': '本周复盘',
        'notes': '本周完成\n\n未完成原因\n\n经验教训\n\n下周调整',
        'list': 'hylst_work',
        'tags': ['review', 'deep'],
        'important': True,
        'urgent': False,
        'reminders': [60],
        'suggestedTime': '17:00',
        'suggestedEndTime': '18:00',
        'repeat': {'type': 'weekly', 'dayOfWeek': 5, 'repeatMode': 'startTime'},
        'subtasks': ['列出本周产出', '分析偏差原因', '提炼可复用经验', '调整下周计划'],
    },
    {
        'name': '晨间启动',
        'title': '晨间启动',
        'notes': '喝水\n\n拉伸\n\n今日三件事\n\n避免一醒来就刷手机',
        'list': 'hylst_health',
        'tags': ['routine', 'health'],
        'important': False,
        'urgent': False,
        'reminders': [],
        'suggestedTime': '07:30',
        'suggestedEndTime': '08:00',
        'repeat': {'type': 'daily', 'repeatMode': 'startTime'},
        'subtasks': ['喝一杯水', '拉伸五分钟', '写下今日三件事'],
    },
    {
        'name': '文件归档',
        'title': '整理与归档文件',
        'notes': '按项目归档\n\n重命名规范\n\n清理重复文件',
        'list': 'hylst_work',
        'tags': ['routine', 'quick'],
        'important': False,
        'urgent': False,
        'reminders': [],
        'suggestedTime': '16:30',
        'suggestedEndTime': '17:00',
        'subtasks': ['删除临时文件', '按项目建立目录', '按规范重命名', '备份重要资料'],
    },
]


# ==================== 任务构造 ====================

def make_context(rng, d, holiday_map):
    person = rng.choice(PEOPLE)
    person2 = rng.choice([name for name in PEOPLE if name != person])
    ctx = {
        'person': person,
        'person2': person2,
        'client': rng.choice(CLIENTS),
        'project': rng.choice(PROJECTS),
        'book': rng.choice(BOOKS),
        'course': rng.choice(COURSES),
        'city': rng.choice(CITIES),
        'bodypart': rng.choice(BODY_PARTS),
        'cuisine': rng.choice(CUISINES),
        'week': str(d.isocalendar()[1]) if d else str(TODAY.isocalendar()[1]),
        'month': str((d or TODAY).month),
        'n': str(rng.randint(1, 20)),
        'festival': holiday_map.get(d) or ('周末' if d and d.weekday() >= 5 else '近期'),
    }
    return ctx


def choose_priority(rng, category, spec):
    weights = CATEGORY_PRIORITY_WEIGHTS.get(category, (0.45, 0.30, 0.12, 0.13))
    important, urgent = rng.choices(
        [(False, False), (True, False), (False, True), (True, True)],
        weights=weights, k=1,
    )[0]
    if spec.get('important') is not None:
        important = bool(spec.get('important'))
    if spec.get('urgent') is not None:
        urgent = bool(spec.get('urgent'))
    return important, urgent


def pick_reminders(rng, is_all_day):
    probability = 0.22 if is_all_day else 0.56
    if rng.random() >= probability:
        return []
    pool = [5, 10, 15, 30, 60, 120, 240, 1440, 2880, 10080] if is_all_day \
        else [5, 10, 15, 30, 60, 120, 240]
    count = rng.choices([1, 2, 3, 4, 5], weights=[40, 28, 16, 10, 6], k=1)[0]
    return sorted(rng.sample(pool, k=min(count, len(pool))), reverse=True)


def pick_created_at(rng, start_naive, now):
    if start_naive is None:
        base = TODAY - timedelta(days=rng.randint(0, 90))
    else:
        base = start_naive.date() - timedelta(days=rng.randint(0, 45))
    hour = rng.randint(6, 23)
    minute = rng.choice([0, 10, 15, 20, 30, 40, 45, 50])
    created = datetime(base.year, base.month, base.day, hour, minute).astimezone()
    if created > now:
        created = now - timedelta(days=rng.randint(0, 20), minutes=rng.randint(0, 600))
    if created > now:
        created = now - timedelta(minutes=rng.randint(5, 180))
    return created


def pick_completed_at(rng, start_naive, end_naive, created, now, day):
    if day is None:
        base = now - timedelta(days=rng.randint(0, 25), minutes=rng.randint(0, 600))
        return min(now, max(created, base))
    if day < TODAY:
        base = (end_naive or (start_naive + timedelta(hours=6))).astimezone()
        base = base + timedelta(minutes=rng.randint(5, 300))
    elif day == TODAY:
        if end_naive is not None and end_naive.astimezone() < now:
            base = end_naive.astimezone() + timedelta(minutes=rng.randint(5, 240))
        else:
            base = now - timedelta(minutes=rng.randint(5, 240))
    else:
        base = now - timedelta(hours=rng.randint(1, 96))
    if base < created:
        base = created + timedelta(minutes=rng.randint(5, 90))
    if base > now:
        base = now
    return base


def decide_completion(rng, day, is_all_day, start_naive, end_naive, now):
    if day is None:
        return rng.random() < 0.14
    if day < TODAY:
        probability = 0.82 if not is_all_day else 0.70
        return rng.random() < probability
    if day == TODAY:
        if is_all_day:
            return rng.random() < 0.32
        if end_naive is not None and end_naive.astimezone() < now:
            return rng.random() < 0.72
        return rng.random() < 0.06
    return rng.random() < 0.025


def make_subtasks(rng, texts, ctx, start_naive, parent_completed, parent_completed_at, now,
                  allow_time=True):
    items = []
    if not texts:
        return items
    if parent_completed:
        done_flags = [True] * len(texts)
    else:
        done_count = rng.randint(0, max(0, len(texts) - 1))
        done_flags = [True] * done_count + [False] * (len(texts) - done_count)
        rng.shuffle(done_flags)
    for index, text in enumerate(texts):
        completed = done_flags[index]
        start_time = None
        reminders = []
        if allow_time and rng.random() < 0.30:
            if start_naive is None:
                day = TODAY
                hour = rng.choice([9, 10, 14, 16, 20])
            else:
                day = start_naive.date()
                hour = start_naive.hour if start_naive.hour else rng.choice([9, 10, 14, 16, 20])
            minute = rng.choice([0, 15, 30, 45])
            offset_days = rng.choice([0, 0, 0, 1])
            st_dt = datetime(day.year, day.month, day.day, hour, minute) + timedelta(days=offset_days)
            start_time = to_iso_z(st_dt)
            if rng.random() < 0.35:
                reminders = [rng.choice([5, 10, 30, 60])]
        completed_at = None
        if completed:
            if parent_completed_at is not None:
                completed_at = parent_completed_at.astimezone(timezone.utc).isoformat(
                    timespec='milliseconds').replace('+00:00', 'Z')
            else:
                completed_at = to_iso_z(now - timedelta(minutes=rng.randint(10, 4320)))
        items.append({
            'id': new_id(rng, SUBTASK_ID_PREFIX),
            'text': fill(text, ctx).strip(),
            'completed': completed,
            'originalOrder': index,
            'completedAt': completed_at,
            'startTime': start_time,
            'reminders': sorted(reminders, reverse=True),
        })
    return items


def build_task(rng, day, spec, category, tag_ids, group_map, holiday_map, used_ids, *,
               forced_time=None, all_day_override=None, repeat_override=None,
               force_incomplete=False, list_id_override=None, completion_override=None,
               created_override=None):
    ctx = make_context(rng, day, holiday_map)
    title = fill(spec['title'], ctx).strip()

    list_id = list_id_override or spec.get('list_id') or CATEGORY_LIST_DEFAULT[category]
    if list_id_override is None and rng.random() < 0.07:
        list_id = DEFAULT_LIST_ID

    group_id = None
    if list_id in group_map and list_id_override is None:
        if rng.random() < 0.70:
            group_id = rng.choice(group_map[list_id])

    important, urgent = choose_priority(rng, category, spec)

    tag_keys = list(spec.get('tags') or CATEGORY_DEFAULT_TAGS.get(category, ()))
    if tag_keys and rng.random() < 0.08:
        tag_keys.append(rng.choice(list(tag_ids.keys())))
    if rng.random() < 0.06:
        tag_keys = []
    tags = []
    for key in tag_keys:
        tid = tag_ids.get(key)
        if tid and tid not in tags:
            tags.append(tid)
    if tags and len(tags) < 5 and rng.random() < 0.02:
        pool = [tid for tid in tag_ids.values() if tid not in tags]
        if pool:
            tags.extend(rng.sample(pool, k=min(5 - len(tags), len(pool))))
    tags = tags[:5]

    subtask_sets = spec.get('subtasks') or []
    use_subtasks = bool(subtask_sets) and rng.random() < 0.62

    if all_day_override is not None:
        is_all_day = bool(all_day_override)
    else:
        is_all_day = rng.random() < spec.get('all_day', CATEGORY_ALL_DAY_PROB[category])

    if day is None:
        is_all_day = False
        start_naive = None
        end_naive = None
        start_iso = None
        end_iso = None
    elif is_all_day:
        start_naive = datetime(day.year, day.month, day.day, 0, 0)
        end_naive = None
        start_iso = to_iso_z(start_naive)
        end_iso = None
    else:
        if forced_time is not None:
            hour, minute = forced_time
        else:
            slots = spec.get('slots') or CATEGORY_SLOTS[category]
            hour, minute = pick_slot_time(rng.choice(slots), rng)
        start_naive = datetime(day.year, day.month, day.day, hour, minute)
        start_iso = to_iso_z(start_naive)
        duration = rng.choice(spec.get('duration') or CATEGORY_DURATIONS[category])
        if rng.random() < spec.get('no_end', 0.16):
            end_naive = None
            end_iso = None
        else:
            end_naive = start_naive + timedelta(minutes=duration)
            end_iso = to_iso_z(end_naive)

    reminders = pick_reminders(rng, is_all_day) if day is not None else []
    reminders = sorted({int(v) for v in reminders if 1 <= int(v) <= REMINDER_MAX_MINUTES}, reverse=True)[:REMINDER_MAX_COUNT]

    repeat = repeat_override
    if repeat is None and day is not None and not is_all_day and rng.random() < RANDOM_REPEAT_PROB:
        repeat = random_repeat_rule(rng)

    if completion_override is not None:
        completed = bool(completion_override)
    elif force_incomplete:
        completed = False
    else:
        completed = decide_completion(rng, day, is_all_day, start_naive, end_naive, NOW)

    created = created_override or pick_created_at(rng, start_naive, NOW)
    if created > NOW:
        created = NOW - timedelta(minutes=rng.randint(5, 180))

    completed_at = None
    completed_dt = None
    if completed:
        completed_dt = pick_completed_at(rng, start_naive, end_naive, created, NOW, day)
        completed_at = to_iso_z(completed_dt)

    modified_at = None
    if rng.random() < 0.45:
        earliest = completed_dt or created
        span_seconds = max(60, int((NOW - earliest).total_seconds()))
        modified_dt = earliest + timedelta(seconds=rng.randint(60, span_seconds))
        if modified_dt > NOW:
            modified_dt = NOW
        modified_at = to_iso_z(modified_dt)

    if use_subtasks:
        texts = rng.choice(subtask_sets)
        subtasks = make_subtasks(rng, texts, ctx, start_naive, completed, completed_dt, NOW,
                                 allow_time=start_naive is not None)
        mode = 'subtasks'
        notes = '\n'.join(st['text'] for st in subtasks)
        intro = fill(spec.get('description') or spec.get('notes') or '', ctx).strip()
        description = compose_markdown(
            rng, ctx, intro, probability=0.86, category=category, title=title,
        )
    else:
        subtasks = []
        mode = 'text'
        intro = fill(spec.get('notes') or '', ctx).strip()
        notes = compose_markdown(
            rng, ctx, intro, probability=0.80, category=category, title=title,
        )
        description = ''

    if completed:
        progress = 100
    elif mode == 'subtasks' and subtasks:
        done = sum(1 for st in subtasks if st['completed'])
        progress = int(round(done / len(subtasks) * 100))
    elif rng.random() < 0.06:
        progress = rng.choice([10, 20, 25, 30, 40, 50, 60, 70, 80, 90])
    else:
        progress = 0

    # 工作清单的看板列带状态语义：已完成的进「已完成」，有进度的进「进行中」
    if group_id and list_id == 'hylst_work':
        has_subtask_progress = any(st.get('completed') for st in subtasks)
        if completed:
            group_id = 'hygrp_work_done'
        elif progress > 0 or has_subtask_progress:
            group_id = 'hygrp_work_doing'
        else:
            group_id = rng.choice(['hygrp_work_todo', 'hygrp_work_wait'])

    task_id = new_id(rng, TASK_ID_PREFIX, used=used_ids)
    task = {
        'id': task_id,
        'title': title,
        'listId': list_id,
        'important': bool(important),
        'urgent': bool(urgent),
        'notes': notes,
        'tags': tags,
        'startTime': start_iso,
        'endTime': end_iso,
        'isAllDay': bool(is_all_day),
        'reminder': reminders[0] if reminders else 0,
        'reminders': reminders,
        'repeat': repeat,
        'completed': bool(completed),
        'createdAt': to_iso_z(created),
        'mode': mode,
        'description': description,
        'subtasks': subtasks,
        'progress': progress,
        MARK: True,
    }
    if group_id:
        task['groupId'] = group_id
    if completed_at:
        task['completedAt'] = completed_at
    if modified_at:
        task['modifiedAt'] = modified_at

    meta = {
        'category': category,
        'repeat_type': (repeat or {}).get('type'),
        'all_day': is_all_day,
        'completed': completed,
        'mode': mode,
        'no_date': day is None,
        'attachments': 0,
    }
    return task, meta


def build_template_task(rng, day, tpl, tag_ids, group_map, holiday_map, used_ids):
    src = tpl['task']
    ctx = make_context(rng, day, holiday_map)
    list_id = src.get('listId') or DEFAULT_LIST_ID
    important = bool(src.get('important'))
    urgent = bool(src.get('urgent'))
    valid_tag_ids = set(tag_ids.values())
    tags = [tid for tid in (src.get('tags') or []) if tid in valid_tag_ids][:5]

    suggested = src.get('suggestedTime') or ''
    is_all_day = not suggested
    if is_all_day:
        start_naive = datetime(day.year, day.month, day.day, 0, 0)
        end_naive = None
        start_iso = to_iso_z(start_naive)
        end_iso = None
    else:
        try:
            hour, minute = [int(v) for v in suggested.split(':')[:2]]
        except Exception:
            hour, minute = 9, 0
        start_naive = datetime(day.year, day.month, day.day, hour, minute)
        start_iso = to_iso_z(start_naive)
        end_naive = None
        end_iso = None
        if src.get('suggestedEndTime'):
            try:
                eh, em = [int(v) for v in src['suggestedEndTime'].split(':')[:2]]
                end_naive = datetime(day.year, day.month, day.day, eh, em)
                if end_naive <= start_naive:
                    end_naive += timedelta(days=1)
                end_iso = to_iso_z(end_naive)
            except Exception:
                end_naive = None
                end_iso = None
        elif rng.random() < 0.35:
            end_naive = start_naive + timedelta(minutes=rng.choice([30, 45, 60, 90]))
            end_iso = to_iso_z(end_naive)

    title_text = (src.get('title') or tpl.get('name') or '新任务').strip()
    sub_texts = [fill(st.get('text', ''), ctx) for st in (src.get('subtasks') or []) if st.get('text')]
    if sub_texts:
        mode = 'subtasks'
        subtasks = make_subtasks(rng, sub_texts, ctx, start_naive, False, None, NOW)
        notes = '\n'.join(st['text'] for st in subtasks)
        description = ensure_markdown(
            rng, ctx, (src.get('description') or src.get('notes') or '').strip(), 0.95, 'template', title_text,
        )
    else:
        mode = 'text'
        subtasks = []
        notes = ensure_markdown(
            rng, ctx, (src.get('notes') or '').strip(), 0.95, 'template', title_text,
        )
        description = ''

    reminders = [int(v) for v in (src.get('reminders') or []) if 1 <= int(v) <= REMINDER_MAX_MINUTES]
    reminders = sorted(set(reminders), reverse=True)[:REMINDER_MAX_COUNT]
    repeat = json.loads(json.dumps(src['repeat'])) if src.get('repeat') else None
    created = NOW - timedelta(days=rng.randint(1, 10), minutes=rng.randint(0, 600))
    group_id = None
    if list_id in group_map and rng.random() < 0.6:
        group_id = rng.choice(group_map[list_id])
    if list_id == 'hylst_work' and group_id == 'hygrp_work_done':
        group_id = 'hygrp_work_todo'

    task = {
        'id': new_id(rng, TASK_ID_PREFIX, used=used_ids),
        'title': title_text,
        'listId': list_id,
        'important': important,
        'urgent': urgent,
        'notes': notes,
        'tags': tags,
        'startTime': start_iso,
        'endTime': end_iso,
        'isAllDay': bool(is_all_day),
        'reminder': reminders[0] if reminders else 0,
        'reminders': reminders,
        'repeat': repeat,
        'completed': False,
        'createdAt': to_iso_z(created),
        'mode': mode,
        'description': description,
        'subtasks': subtasks,
        'progress': 0,
        'templateId': tpl['id'],
        MARK: True,
    }
    if group_id:
        task['groupId'] = group_id
    meta = {
        'category': 'template',
        'repeat_type': (repeat or {}).get('type'),
        'all_day': is_all_day,
        'completed': False,
        'mode': mode,
        'no_date': False,
        'attachments': 0,
    }
    return task, meta


# ==================== 日期类型 ====================

def load_holiday_map(path):
    holidays = {}
    workdays = {}
    if not path or not os.path.exists(path):
        return holidays, workdays
    try:
        with open(path, 'r', encoding='utf-8') as f:
            raw = json.load(f)
    except Exception:
        return holidays, workdays
    for year_str, year_data in raw.items():
        try:
            year = int(year_str)
        except (TypeError, ValueError):
            continue
        for mmdd, name in (year_data.get('holidays') or {}).items():
            try:
                month, day = [int(v) for v in mmdd.split('-')]
                holidays[date(year, month, day)] = name
            except Exception:
                continue
        for mmdd, name in (year_data.get('workdays') or {}).items():
            try:
                month, day = [int(v) for v in mmdd.split('-')]
                workdays[date(year, month, day)] = name
            except Exception:
                continue
    return holidays, workdays


def classify_day(day, holidays, workdays):
    if day in workdays:
        return 'workday_override'
    if day in holidays:
        return 'holiday'
    if day.weekday() >= 5:
        return 'weekend'
    return 'weekday'


def daily_task_count(rng, day, kind, start_day):
    if day == start_day:
        return rng.randint(12, 18)
    if day == TODAY:
        return rng.randint(8, 16)
    if kind == 'weekday':
        if rng.random() < 0.03:
            return rng.randint(0, 2)
        count = rng.randint(3, 14)
        if rng.random() < 0.06:
            count += rng.randint(3, 8)
        return count
    if kind == 'workday_override':
        return rng.randint(4, 12)
    if kind == 'weekend':
        if rng.random() < 0.20:
            return rng.randint(0, 2)
        return rng.randint(1, 9)
    if kind == 'holiday':
        return rng.randint(0, 6)
    return 0


# ==================== 任务生成主流程 ====================

def generate_tasks(rng, start_day, end_day, tag_ids, group_map, templates,
                   holidays, workdays, used_ids):
    tasks = []
    metas = []

    def add(task, meta):
        tasks.append(task)
        metas.append(meta)

    for day in date_range(start_day, end_day):
        kind = classify_day(day, holidays, workdays)
        count = daily_task_count(rng, day, kind, start_day)
        weights = DAY_CATEGORY_WEIGHTS[kind]
        categories = list(weights.keys())
        category_weights = list(weights.values())
        all_day_count = 0
        for _ in range(count):
            category = rng.choices(categories, weights=category_weights, k=1)[0]
            spec = rng.choice(CATEGORY_POOLS[category])
            force_timed = all_day_count >= 3
            task, meta = build_task(
                rng, day, spec, category, tag_ids, group_map, holidays, used_ids,
                all_day_override=False if force_timed else None,
            )
            if meta['all_day']:
                all_day_count += 1
            add(task, meta)

    # ---- 专用重复任务：覆盖全部重复类型 ----
    recurring_defs = [
        {
            'day_offset': -1, 'time': (8, 25), 'title': '每日签到', 'category': 'work',
            'list': 'hylst_work', 'tags': ['routine', 'quick'], 'notes': '记录今日状态与最重要的一件事。',
            'duration': 30, 'repeat': {'type': 'daily', 'repeatMode': 'startTime'},
        },
        {
            'day_offset': 0, 'time': (18, 10), 'title': '写工作日日报', 'category': 'work',
            'list': 'hylst_work', 'tags': ['review', 'routine'], 'notes': '今日完成、明日计划、需要协助的事项。',
            'duration': 30, 'repeat': {'type': 'daily', 'workdayOnly': True, 'repeatMode': 'startTime'},
            'important': True,
        },
        {
            'day_offset': 1, 'time': (9, 30), 'title': '周一计划会', 'category': 'meeting',
            'list': 'hylst_meeting', 'tags': ['meeting'], 'notes': '确认本周目标、分工与依赖。',
            'duration': 60, 'repeat': {'type': 'weekly', 'dayOfWeek': 1, 'repeatMode': 'startTime'},
        },
        {
            'day_offset': 3, 'time': (17, 0), 'title': '周五复盘', 'category': 'work',
            'list': 'hylst_work', 'tags': ['review'], 'notes': '回顾本周结果，提炼下周改进项。',
            'duration': 60, 'repeat': {'type': 'weekly', 'dayOfWeek': 5, 'repeatMode': 'completeTime'},
            'important': True,
        },
        {
            'day_offset': 2, 'time': (18, 0), 'title': '提交本周周报', 'category': 'work',
            'list': 'hylst_work', 'tags': ['review', 'comm'], 'notes': '按模板填写并发送给团队。',
            'duration': 45, 'repeat': {'type': 'weeklyFirstWorkday', 'repeatMode': 'startTime'},
            'important': True,
        },
        {
            'day_offset': 4, 'time': (17, 30), 'title': '清理收件箱', 'category': 'work',
            'list': 'hylst_work', 'tags': ['routine', 'quick'], 'notes': '归档、回复或转成任务。',
            'duration': 30, 'repeat': {'type': 'weeklyLastWorkday', 'repeatMode': 'startTime'},
        },
        {
            'day_offset': 5, 'time': (10, 0), 'title': '缴纳房租', 'category': 'finance',
            'list': 'hylst_finance', 'tags': ['finance', 'routine'], 'notes': '确认金额与到账时间。',
            'duration': 20, 'repeat': {'type': 'monthly', 'dayOfMonth': 1, 'repeatMode': 'startTime'},
        },
        {
            'day_offset': 6, 'time': (15, 0), 'title': '月度对账', 'category': 'finance',
            'list': 'hylst_finance', 'tags': ['finance', 'review'], 'notes': '核对信用卡、花呗与银行流水。',
            'duration': 60, 'repeat': {'type': 'monthlyFirstWorkday', 'repeatMode': 'startTime'},
            'important': True,
        },
        {
            'day_offset': 7, 'time': (18, 0), 'title': '月度数据备份', 'category': 'work',
            'list': 'hylst_work', 'tags': ['routine'], 'notes': '导出数据并检查备份完整性。',
            'duration': 45, 'repeat': {'type': 'monthlyLastWorkday', 'repeatMode': 'startTime'},
        },
        {
            'day_offset': 8, 'time': (20, 0), 'title': '家庭纪念日提醒', 'category': 'family',
            'list': 'hylst_family', 'tags': ['family'], 'notes': '准备小礼物与晚餐。',
            'duration': 30, 'repeat': {'type': 'yearly', 'month': 12, 'day': 8, 'repeatMode': 'startTime'},
            'all_day': False,
        },
        {
            'day_offset': 9, 'time': (20, 30), 'title': '节假日前订票', 'category': 'travel',
            'list': 'hylst_travel', 'tags': ['travel', 'weekend'], 'notes': '查看余票与价格，确认行程。',
            'duration': 30, 'repeat': {'type': 'yearly', 'beforeHoliday': True, 'repeatMode': 'startTime'},
        },
        {
            'day_offset': 10, 'time': (8, 0), 'title': '给绿植浇水', 'category': 'chores',
            'list': 'hylst_chores', 'tags': ['chore', 'routine'], 'notes': '检查土壤湿度，修剪枯叶。',
            'duration': 15, 'repeat': {'type': 'custom', 'interval': 3, 'unit': 'days', 'repeatMode': 'startTime'},
        },
        {
            'day_offset': 11, 'time': (10, 0), 'title': '深度清洁', 'category': 'chores',
            'list': 'hylst_chores', 'tags': ['chore', 'weekend'], 'notes': '厨房、卫生间与地面。',
            'duration': 120, 'repeat': {'type': 'custom', 'interval': 2, 'unit': 'weeks', 'repeatMode': 'startTime'},
        },
        {
            'day_offset': 12, 'time': (9, 0), 'title': '季度体检预约', 'category': 'health',
            'list': 'hylst_health', 'tags': ['health'], 'notes': '确认体检项目与时间。',
            'duration': 30, 'repeat': {'type': 'custom', 'interval': 3, 'unit': 'months', 'repeatMode': 'startTime'},
            'important': True,
        },
        {
            'day_offset': 13, 'time': (11, 0), 'title': '更换净水器滤芯', 'category': 'chores',
            'list': 'hylst_chores', 'tags': ['chore'], 'notes': '记录更换日期，购买备用滤芯。',
            'duration': 30, 'repeat': {'type': 'custom', 'interval': 2, 'unit': 'years', 'repeatMode': 'startTime'},
        },
        {
            'day_offset': 14, 'time': (19, 0), 'title': '健身房训练', 'category': 'health',
            'list': 'hylst_health', 'tags': ['health', 'routine'], 'notes': '力量训练 + 有氧。',
            'duration': 60, 'repeat': {'type': 'daily', 'workdayOnly': True, 'repeatMode': 'startTime'},
        },
        {
            'day_offset': 15, 'time': (20, 0), 'title': '家庭会议', 'category': 'family',
            'list': 'hylst_family', 'tags': ['family', 'meeting'], 'notes': '回顾本周、安排下周。',
            'duration': 45, 'repeat': {'type': 'weekly', 'dayOfWeek': 0, 'repeatMode': 'startTime'},
        },
    ]
    for item in recurring_defs:
        day = TODAY + timedelta(days=item['day_offset'])
        if day < start_day or day > end_day:
            continue
        spec = S(
            item['title'], notes=item['notes'], tags=tuple(item['tags']),
            duration=(item['duration'],), slots=('work_am',),
            important=item.get('important'), urgent=item.get('urgent'),
        )
        task, meta = build_task(
            rng, day, spec, item['category'], tag_ids, group_map, holidays, used_ids,
            forced_time=item['time'], all_day_override=False,
            repeat_override=item['repeat'], force_incomplete=True,
            list_id_override=item['list'],
        )
        task['reminders'] = [5]
        task['reminder'] = 5
        add(task, meta)

    # ---- 无日期任务 ----
    for _ in range(rng.randint(60, 95)):
        category = rng.choices(list(DAY_CATEGORY_WEIGHTS['weekday'].keys()),
                               weights=list(DAY_CATEGORY_WEIGHTS['weekday'].values()), k=1)[0]
        spec = rng.choice(CATEGORY_POOLS[category])
        task, meta = build_task(
            rng, None, spec, category, tag_ids, group_map, holidays, used_ids,
            completion_override=(rng.random() < 0.14),
        )
        add(task, meta)

    # ---- 归档清单任务 ----
    for _ in range(rng.randint(10, 16)):
        day = start_day + timedelta(days=rng.randint(0, max(0, (end_day - start_day).days)))
        category = rng.choice(['work', 'project', 'meeting'])
        spec = rng.choice(CATEGORY_POOLS[category])
        task, meta = build_task(
            rng, day, spec, category, tag_ids, group_map, holidays, used_ids,
            list_id_override='hylst_archive',
        )
        add(task, meta)

    # ---- 模板创建的任务 ----
    for _ in range(rng.randint(18, 26)):
        tpl = rng.choice(templates)
        span = max(1, (end_day - start_day).days)
        day = start_day + timedelta(days=rng.randint(0, span))
        task, meta = build_template_task(rng, day, tpl, tag_ids, group_map, holidays, used_ids)
        add(task, meta)
        tpl['useCount'] = int(tpl.get('useCount') or 0) + 1
        tpl['lastUsedAt'] = to_iso_z(NOW - timedelta(days=rng.randint(0, 5), minutes=rng.randint(0, 600)))

    # ---- 回收站任务 ----
    for _ in range(rng.randint(18, 28)):
        span = max(1, (end_day - start_day).days)
        day = start_day + timedelta(days=rng.randint(0, min(span, 120)))
        category = rng.choices(list(DAY_CATEGORY_WEIGHTS['weekday'].keys()),
                               weights=list(DAY_CATEGORY_WEIGHTS['weekday'].values()), k=1)[0]
        spec = rng.choice(CATEGORY_POOLS[category])
        task, meta = build_task(
            rng, day, spec, category, tag_ids, group_map, holidays, used_ids,
            completion_override=(rng.random() < 0.35),
        )
        deleted_dt = NOW - timedelta(days=rng.randint(0, 8), minutes=rng.randint(0, 1440))
        created_dt = iso_to_local_dt(task.get('createdAt'))
        if created_dt and deleted_dt <= created_dt:
            deleted_dt = min(NOW, created_dt + timedelta(minutes=rng.randint(30, 1440)))
        task['deletedAt'] = to_iso_z(deleted_dt)
        task['deletedFrom'] = task['listId'] or DEFAULT_LIST_ID
        meta['trash'] = True
        add(task, meta)

    return tasks, metas


# ==================== 附件 ====================

def make_png(seed):
    width, height = 64, 48
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            r = (60 + (x * 3 + seed * 17) % 160) & 0xFF
            g = (80 + (y * 4 + seed * 11) % 150) & 0xFF
            b = (100 + (x * 2 + y * 3 + seed * 7) % 140) & 0xFF
            raw += bytes((r, g, b))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')


def make_pdf(title, lines):
    def esc(text):
        return str(text).replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')

    content_lines = ['BT /F1 18 Tf 72 760 Td (%s) Tj ET' % esc(title)]
    y = 728
    for line in lines:
        content_lines.append('BT /F1 11 Tf 72 %d Td (%s) Tj ET' % (y, esc(line)))
        y -= 18
    content = '\n'.join(content_lines).encode('latin-1', 'replace')

    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
        b'/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        b'<< /Length %d >>\nstream\n' % len(content) + content + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    output = bytearray(b'%PDF-1.4\n')
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output += ('%d 0 obj\n' % index).encode('ascii') + obj + b'\nendobj\n'
    xref_at = len(output)
    output += ('xref\n0 %d\n' % (len(objects) + 1)).encode('ascii')
    output += b'0000000000 65535 f \n'
    for offset in offsets[1:]:
        output += ('%010d 00000 n \n' % offset).encode('ascii')
    output += ('trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF' %
               (len(objects) + 1, xref_at)).encode('ascii')
    return bytes(output)


def make_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('README.txt', 'TackList 测试附件资料包\n')
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['项目', '负责人', '状态', '截止日期'])
        writer.writerow(['需求梳理', '张三', '进行中', '2026-11-10'])
        writer.writerow(['接口联调', '李四', '待开始', '2026-11-15'])
        zf.writestr('任务清单.csv', output.getvalue())
    return buf.getvalue()


def attachment_safe_name(name):
    base = os.path.basename((name or 'file').replace('\\', '/'))
    for ch in '<>:"/\\|?*':
        base = base.replace(ch, '_')
    base = ''.join(ch for ch in base if ord(ch) >= 32).strip('. ')
    return (base or 'file')[:120]


def attachment_safe_id(value):
    return ''.join(ch for ch in (value or '') if ch.isalnum() or ch in '_-')[:80]


def attachment_file_specs(rng, task_title):
    specs = [
        ('会议纪要.md', 'text/markdown', lambda: (
            '# 会议纪要\n\n## 议题\n- %s\n\n## 结论\n- 待补充\n\n## 待办\n- [ ] 跟进事项\n' % task_title
        ).encode('utf-8')),
        ('需求说明.txt', 'text/plain', lambda: (
            '任务：%s\n\n背景：\n目标：\n验收标准：\n风险：\n' % task_title
        ).encode('utf-8')),
        ('预算表.csv', 'text/csv', lambda: (
            '项目,预算,实际,差异\n交通,1200,980,-220\n住宿,2400,2380,-20\n餐饮,800,760,-40\n'
        ).encode('utf-8')),
        ('任务清单.md', 'text/markdown', lambda: (
            '# %s\n\n- [x] 收集资料\n- [x] 确认范围\n- [ ] 输出初稿\n- [ ] 内部评审\n' % task_title
        ).encode('utf-8')),
        ('原型图.png', 'image/png', lambda: make_png(rng.randint(1, 9999))),
        ('现场照片.png', 'image/png', lambda: make_png(rng.randint(1, 9999))),
        ('项目计划.pdf', 'application/pdf', lambda: make_pdf(
            'Project Plan', ['Task: %s' % task_title, 'Milestone 1: Kickoff',
                              'Milestone 2: Development', 'Milestone 3: Release',
                              'Owner: Team', 'Status: In Progress'])),
        ('资料包.zip', 'application/zip', make_zip),
        ('数据分析.csv', 'text/csv', lambda: (
            '日期,访问量,转化率,备注\n2026-10-01,1200,3.2%,\n2026-10-02,1350,3.5%,\n2026-10-03,980,2.9%,\n'
        ).encode('utf-8')),
        ('上线清单.txt', 'text/plain', lambda: (
            '上线检查清单\n1. 数据库备份\n2. 配置变更\n3. 灰度发布\n4. 监控观察\n5. 回滚预案\n'
        ).encode('utf-8')),
    ]
    count = rng.choices([1, 1, 2, 2, 3, 4], weights=[28, 22, 20, 14, 10, 6], k=1)[0]
    return rng.sample(specs, k=min(count, len(specs)))


def add_attachments(rng, tasks, metas, attachments_dir):
    if not tasks:
        return 0, 0
    candidates = [t for t, m in zip(tasks, metas)
                  if t.get(MARK) and not m.get('trash')]
    trash_candidates = [t for t, m in zip(tasks, metas)
                        if t.get(MARK) and m.get('trash')]
    rng.shuffle(candidates)
    chosen = candidates[:rng.randint(18, 26)]
    if trash_candidates and rng.random() < 0.5:
        chosen.append(rng.choice(trash_candidates))

    os.makedirs(attachments_dir, exist_ok=True)
    total_files = 0
    for task in chosen:
        used_names = set()
        file_specs = attachment_file_specs(rng, task.get('title') or '任务')
        metadata = []
        for display_name, mime, builder in file_specs:
            base = os.path.splitext(display_name)[0]
            ext = os.path.splitext(display_name)[1]
            name = display_name
            suffix = 2
            while name in used_names:
                name = '%s-%d%s' % (base, suffix, ext)
                suffix += 1
            used_names.add(name)
            data = builder()
            file_id = 'att_' + uuid.uuid4().hex[:12]
            folder = os.path.join(attachments_dir, attachment_safe_id(task['id']))
            os.makedirs(folder, exist_ok=True)
            disk_name = file_id + '_' + attachment_safe_name(name)
            with open(os.path.join(folder, disk_name), 'wb') as f:
                f.write(data)
            created = iso_to_local_dt(task.get('createdAt')) or NOW
            earliest = max(created, NOW - timedelta(days=120))
            added = earliest + timedelta(seconds=rng.randint(0, max(60, int((NOW - earliest).total_seconds()))))
            if added > NOW:
                added = NOW
            metadata.append({
                'id': file_id,
                'name': name,
                'size': len(data),
                'mime': mime,
                'addedAt': to_iso_z(added),
            })
            total_files += 1
        if metadata:
            task['attachments'] = metadata
    return len(chosen), total_files


# ==================== 清单 / 标签 / 过滤器 / 倒计时 / 模板 ====================

def build_lists():
    result = []
    for item in LIST_DEFS:
        obj = {'id': item['id'], 'name': item['name'], 'color': item['color']}
        for key in ('parentId', 'isFolder', 'archived'):
            if item.get(key):
                obj[key] = item[key]
        groups = GROUP_DEFS.get(item['id'])
        if groups:
            obj['groups'] = [{'id': gid, 'name': name} for gid, name in groups]
        order = CUSTOM_COLUMN_ORDER.get(item['id'])
        if order:
            obj['customColumnOrder'] = list(order)
        result.append(obj)
    return result


def build_tags(existing_tags):
    result = []
    existing_names = {t.get('name') for t in existing_tags if t.get('name')}
    capacity = max(0, TAG_LIMIT - len(existing_tags))
    for item in TAG_DEFS:
        if len(result) >= capacity:
            break
        name = item['name']
        while name in existing_names:
            name += '·'
        obj = {
            'id': item['id'],
            'name': name,
            'color': item['color'],
            'createdAt': to_iso_z(NOW - timedelta(days=200 - len(result) * 3)),
        }
        result.append(obj)
        existing_names.add(name)
    return result


def build_group_map():
    return {
        list_id: [gid for gid, _ in groups]
        for list_id, groups in GROUP_DEFS.items()
    }


def build_filters(existing_filters, tag_key_to_id, list_ids):
    available = max(0, FILTER_LIMIT - len(existing_filters))
    if available <= 0:
        return []

    def cond(time_range=None, *, lists=None, tags=None, important=None, urgent=None,
             custom_start=None, custom_end=None):
        return {
            'listIds': list(lists or []),
            'tagIds': [tag_key_to_id[k] for k in (tags or []) if k in tag_key_to_id],
            'important': important,
            'urgent': urgent,
            'timeRange': time_range,
            'customStartDate': custom_start,
            'customEndDate': custom_end,
        }

    candidates = [
        ('今日待办', '#3b82f6', cond('today')),
        ('已逾期', '#ef4444', cond('overdue')),
        ('无日期待办', '#6b7280', cond('nodate')),
        ('本周重点', '#f59e0b', cond('week', important=True)),
        ('最近三天', '#10b981', cond('last3days')),
        ('昨日回顾', '#8b5cf6', cond('yesterday')),
        ('上周复盘', '#a855f7', cond('lastweek', tags=['review'])),
        ('本月工作计划', '#0ea5e9', cond('month', lists=['hylst_work', 'hylst_project'],
                                          tags=['meeting'])),
        ('上月财务复盘', '#84cc16', cond('lastmonth', lists=['hylst_finance'])),
        ('旅行筹备', '#14b8a6', cond(
            'custom',
            lists=['hylst_travel'],
            tags=['travel'],
            custom_start=(TODAY + timedelta(days=1)).isoformat(),
            custom_end=(TODAY + timedelta(days=120)).isoformat(),
        )),
    ]
    result = []
    for name, color, conditions in candidates:
        if len(result) >= available:
            break
        if not set(conditions['listIds']).issubset(set(list_ids)):
            continue
        result.append({
            'id': FILTER_PREFIX + uuid.uuid4().hex[:12],
            'name': name,
            'color': color,
            'conditions': conditions,
            'createdAt': to_iso_z(NOW - timedelta(days=60 - len(result) * 4)),
        })
    return result


def build_countdowns(existing_countdowns):
    items = [
        {'id': COUNTDOWN_PREFIX + 'birthday', 'name': '妈妈生日', 'repeat': 'yearly', 'date': _next_month_day(12, 8)},
        {'id': COUNTDOWN_PREFIX + 'anniversary', 'name': '结婚纪念日', 'repeat': 'yearly', 'date': _next_month_day(5, 20)},
        {'id': COUNTDOWN_PREFIX + 'graduation', 'name': '毕业纪念日', 'repeat': 'yearly', 'date': _next_month_day(6, 30)},
        {'id': COUNTDOWN_PREFIX + 'trip', 'name': '京都旅行', 'repeat': 'once', 'date': (TODAY + timedelta(days=45)).isoformat()},
        {'id': COUNTDOWN_PREFIX + 'exam', 'name': '资格考试', 'repeat': 'once', 'date': (TODAY + timedelta(days=120)).isoformat()},
        {'id': COUNTDOWN_PREFIX + 'launch', 'name': '项目上线日', 'repeat': 'once', 'date': (TODAY + timedelta(days=30)).isoformat()},
        {'id': COUNTDOWN_PREFIX + 'marathon', 'name': '城市马拉松', 'repeat': 'once', 'date': (TODAY + timedelta(days=200)).isoformat()},
        {'id': COUNTDOWN_PREFIX + 'past', 'name': '产品发布会', 'repeat': 'once', 'date': (TODAY - timedelta(days=5)).isoformat()},
        {'id': COUNTDOWN_PREFIX + 'lease', 'name': '房租到期', 'repeat': 'once', 'date': (TODAY + timedelta(days=300)).isoformat()},
        {'id': COUNTDOWN_PREFIX + 'checkup', 'name': '年度体检', 'repeat': 'once', 'date': (TODAY + timedelta(days=80)).isoformat()},
    ]
    existing_ids = {c.get('id') for c in existing_countdowns}
    return [item for item in items if item['id'] not in existing_ids]


def _next_month_day(month, day):
    this_year = date(TODAY.year, month, day)
    if this_year < TODAY:
        this_year = date(TODAY.year + 1, month, day)
    return this_year.isoformat()


def build_templates(rng, existing_templates, tag_key_to_id):
    existing_names = {t.get('name') for t in existing_templates if t.get('name')}
    result = []
    ctx = make_context(rng, None, {})
    for index, item in enumerate(TEMPLATE_DEFS):
        name = item['name']
        while name in existing_names:
            name += '·'
        subtasks = [
            {
                'text': text,
                'completed': False,
                'originalOrder': i,
                'startTime': None,
                'reminders': [],
            }
            for i, text in enumerate(item.get('subtasks') or [])
        ]
        notes = (item.get('notes') or '').strip()
        description = (item.get('description') or '').strip()
        force_extra = 1 if index < 8 else 0
        if subtasks:
            description = compose_markdown(
                rng, ctx, description or notes, probability=1.0,
                category='template', title=item['title'], extra_count=force_extra,
            )
        else:
            notes = compose_markdown(
                rng, ctx, notes, probability=1.0,
                category='template', title=item['title'], extra_count=force_extra,
            )
            description = ''
        task = {
            'title': item['title'],
            'notes': notes,
            'description': description,
            'listId': item.get('list') or DEFAULT_LIST_ID,
            'tags': [tag_key_to_id[k] for k in (item.get('tags') or []) if k in tag_key_to_id],
            'important': bool(item.get('important')),
            'urgent': bool(item.get('urgent')),
            'reminders': list(item.get('reminders') or []),
            'repeat': json.loads(json.dumps(item['repeat'])) if item.get('repeat') else None,
            'suggestedTime': item.get('suggestedTime'),
            'suggestedEndTime': item.get('suggestedEndTime'),
            'subtasks': subtasks,
        }
        task = {k: v for k, v in task.items() if v is not None}
        created = NOW - timedelta(days=rng_days(index), minutes=rng_minutes(index))
        tpl = {
            'id': TEMPLATE_PREFIX + '%012x' % (0x5EED00000000 + index),
            'name': name,
            'createdAt': to_iso_z(created),
            'updatedAt': to_iso_z(created + timedelta(days=1, hours=2)),
            'task': task,
        }
        if index % 3 != 0:
            tpl['useCount'] = 3 + index * 2
            tpl['lastUsedAt'] = to_iso_z(NOW - timedelta(days=index % 10, hours=index % 8))
        result.append(tpl)
        existing_names.add(name)
    return result


def rng_days(index):
    return 30 + (index * 7) % 120


def rng_minutes(index):
    return (index * 37) % 600


# ==================== 番茄历史 ====================

def generate_pomodoro(rng, days_back, tasks, existing_keys):
    records = []
    today_log = []
    tasks_by_day = {}
    for task in tasks:
        if task.get('deletedAt') or not task.get('startTime'):
            continue
        local_dt = iso_to_local_dt(task['startTime'])
        if not local_dt:
            continue
        tasks_by_day.setdefault(local_dt.date(), []).append(task)

    for offset in range(days_back - 1, -1, -1):
        day = TODAY - timedelta(days=offset)
        is_today = day == TODAY
        if is_today:
            max_end = min(NOW, datetime(day.year, day.month, day.day, 23, 0).astimezone())
            session_target = 0
            if NOW.hour >= 8:
                session_target = rng.randint(1, min(8, max(1, (NOW.hour - 8) * 2)))
        elif offset == 1:
            max_end = datetime(day.year, day.month, day.day, 22, 30).astimezone()
            session_target = rng.randint(12, 18)
        else:
            max_end = datetime(day.year, day.month, day.day, 22, 30).astimezone()
            session_target = rng.randint(5, 10)

        cursor = datetime(day.year, day.month, day.day, 7, 30).astimezone()
        day_tasks = tasks_by_day.get(day, [])
        count = 0
        attempts = 0
        while count < session_target and attempts < 80:
            attempts += 1
            cursor += timedelta(minutes=rng.choice([5, 5, 10, 15, 20, 30]))
            if cursor >= max_end:
                break
            duration = rng.choice([15, 25, 25, 25, 50])
            end = cursor + timedelta(minutes=duration)
            if end > max_end:
                break
            task = rng.choice(day_tasks) if day_tasks and rng.random() < 0.82 else None
            task_id = task['id'] if task else None
            task_name = task['title'] if task else rng.choice(GENERIC_FOCUS_NAMES)
            started = cursor
            if rng.random() < 0.22 and duration >= 20:
                first = rng.choice([10, 12, 15])
                second = duration - first
                segments = [(started, started + timedelta(minutes=first), first),
                            (started + timedelta(minutes=first), end, second)]
            else:
                segments = [(started, end, duration)]
            for seg_start, seg_end, minutes in segments:
                key = (to_iso_z(seg_start), task_id)
                if key in existing_keys:
                    continue
                existing_keys.add(key)
                record = {
                    'id': new_id(rng, 'hyp_'),
                    'date': to_iso_z(seg_end),
                    'startedAt': to_iso_z(seg_start),
                    'endedAt': to_iso_z(seg_end),
                    'duration': max(1, int(minutes)),
                    'taskName': task_name or '一般专注',
                    'taskId': task_id,
                    MARK: True,
                }
                records.append(record)
                if is_today:
                    today_log.append(record)
            cursor = end
            count += 1
    records.sort(key=lambda r: r['startedAt'])
    return records, today_log


# ==================== 清理 ====================

def is_our_task(task):
    if not isinstance(task, dict):
        return False
    return bool(task.get(MARK)) or bool(task.get(LEGACY_MARK)) or \
        str(task.get('id', '')).startswith(TASK_ID_PREFIX)


def is_our_list(item):
    return str(item.get('id', '')).startswith(LIST_PREFIX) or \
        str(item.get('id', '')).startswith(FOLDER_PREFIX) or \
        item.get('id') in LEGACY_LIST_IDS


def is_our_tag(item):
    return str(item.get('id', '')).startswith(TAG_PREFIX) or item.get('id') in LEGACY_TAG_IDS


def is_our_filter(item):
    return str(item.get('id', '')).startswith(FILTER_PREFIX) or item.get('id') in LEGACY_FILTER_IDS


def is_our_countdown(item):
    return str(item.get('id', '')).startswith(COUNTDOWN_PREFIX)


def is_our_template(item):
    return str(item.get('id', '')).startswith(TEMPLATE_PREFIX)


def cleanup_attachment_dirs(attachments_dir, removed_task_ids):
    if not os.path.isdir(attachments_dir):
        return 0
    removed = 0
    for task_id in removed_task_ids:
        folder = os.path.join(attachments_dir, attachment_safe_id(task_id))
        if os.path.isdir(folder):
            shutil.rmtree(folder, ignore_errors=True)
            removed += 1
    for name in os.listdir(attachments_dir):
        if name.startswith(TASK_ID_PREFIX):
            folder = os.path.join(attachments_dir, name)
            if os.path.isdir(folder):
                shutil.rmtree(folder, ignore_errors=True)
                removed += 1
    return removed


# ==================== 校验 ====================

ALLOWED_REPEAT_TYPES = {
    'daily', 'weekly', 'monthly', 'yearly', 'custom',
    'weeklyFirstWorkday', 'weeklyLastWorkday',
    'monthlyFirstWorkday', 'monthlyLastWorkday',
}

# 覆盖 markdown.js 的全部渲染能力；验证阶段确保每种语法至少出现一次
MARKDOWN_FEATURE_PATTERNS = {
    '一级标题': r'(?m)^#\s+\S',
    '二级标题': r'(?m)^##\s+\S',
    '三级标题': r'(?m)^###\s+\S',
    '粗体（**）': r'\*\*[^*\n]+\*\*',
    '粗体（__）': r'__[^_\n]+__',
    '斜体（*）': r'(?<!\*)\*[^*\n]+\*(?!\*)',
    '斜体（_）': r'(?<![\w])_[^_\n]+_(?![\w])',
    '删除线': r'~~[^~\n]+~~',
    '行内代码': r'`[^`\n]+`',
    '围栏代码（```）': r'(?m)^```',
    '围栏代码（~~~）': r'(?m)^~~~',
    '引用': r'(?m)^>\s?\S',
    '无序列表（-）': r'(?m)^\s*-\s+\S',
    '无序列表（*）': r'(?m)^\s*\*\s+\S',
    '无序列表（+）': r'(?m)^\s*\+\s+\S',
    '有序列表（1.）': r'(?m)^\s*\d+\.\s+\S',
    '有序列表（1)）': r'(?m)^\s*\d+\)\s+\S',
    '任务列表（未完成）': r'(?m)^\s*[-*+]\s+\[ \]\s+\S',
    '任务列表（已完成）': r'(?m)^\s*[-*+]\s+\[[xX]\]\s+\S',
    '嵌套列表': r'(?m)^\s{2,}[-*+]\s+\S',
    '分割线': r'(?m)^---\s*$',
    '链接': r'\[[^\]\n]+\]\([^)\s]+',
    '带标题链接': r'\[[^\]\n]+\]\([^)\s]+\s+["\'][^"\']+["\']\)',
    '图片': r'!\[[^\]\n]*\]\([^)\s]+\)',
    '硬换行': r' {2,}\n',
}


def validate_markdown_coverage(tasks, templates):
    parts = []
    md_tasks = 0
    for task in tasks:
        if not task.get(MARK):
            continue
        notes = task.get('notes') or ''
        description = task.get('description') or ''
        if has_markdown(notes) or has_markdown(description):
            md_tasks += 1
        if notes:
            parts.append(notes)
        if description:
            parts.append(description)
    for tpl in templates:
        task = tpl.get('task') or {}
        parts.append(task.get('notes') or '')
        parts.append(task.get('description') or '')
    blob = '\n\n'.join(part for part in parts if part)
    missing = [
        name for name, pattern in MARKDOWN_FEATURE_PATTERNS.items()
        if not re.search(pattern, blob)
    ]
    return missing, md_tasks


def validate_dataset(data, start_day, end_day, attachments_dir, attachments_enabled):
    errors = []
    task_ids = set()
    list_ids = {l.get('id') for l in (data.get('taskLists') or [])}
    tag_ids = {t.get('id') for t in ((data.get('settings') or {}).get('tags') or [])}
    templates = {t.get('id') for t in (data.get('taskTemplates') or [])}
    group_map = {}
    for lst in data.get('taskLists') or []:
        group_map[lst.get('id')] = {g.get('id') for g in (lst.get('groups') or [])}

    for task in data.get('tasks') or []:
        if not task.get(MARK):
            continue
        tid = task.get('id')
        if not tid or tid in task_ids:
            errors.append('任务 ID 缺失或重复: %r' % tid)
            continue
        task_ids.add(tid)
        if task.get('listId') not in list_ids:
            errors.append('%s 引用了不存在的清单 %s' % (tid, task.get('listId')))
        if task.get('templateId') and task.get('templateId') not in templates:
            errors.append('%s 引用了不存在的模板 %s' % (tid, task.get('templateId')))
        if task.get('groupId'):
            if task.get('groupId') not in group_map.get(task.get('listId'), set()):
                errors.append('%s 的分组 %s 不属于清单 %s' % (tid, task.get('groupId'), task.get('listId')))
        for tag_id in task.get('tags') or []:
            if tag_id not in tag_ids:
                errors.append('%s 引用了不存在的标签 %s' % (tid, tag_id))
        if len(task.get('tags') or []) > 5:
            errors.append('%s 标签超过 5 个' % tid)
        if task.get('isAllDay') and task.get('endTime'):
            errors.append('%s 为全天任务但存在 endTime' % tid)
        if task.get('startTime'):
            start_dt = iso_to_local_dt(task['startTime'])
            end_dt = iso_to_local_dt(task.get('endTime'))
            if start_dt and not (start_day <= start_dt.date() <= end_day):
                errors.append('%s 的日期 %s 超出范围' % (tid, start_dt.date()))
            if end_dt and start_dt and end_dt < start_dt:
                errors.append('%s 的结束时间早于开始时间' % tid)
        if task.get('completed'):
            if task.get('progress') != 100:
                errors.append('%s 已完成但 progress != 100' % tid)
            if not task.get('completedAt'):
                errors.append('%s 已完成但缺少 completedAt' % tid)
        if task.get('mode') not in ('text', 'subtasks'):
            errors.append('%s 的 mode 非法: %s' % (tid, task.get('mode')))
        if task.get('mode') == 'subtasks' and not task.get('subtasks'):
            errors.append('%s 为子任务模式但没有子任务' % tid)
        reminders = task.get('reminders') or []
        if len(reminders) > REMINDER_MAX_COUNT:
            errors.append('%s 提醒数量超过 5 个' % tid)
        if reminders != sorted(reminders, reverse=True):
            errors.append('%s 提醒未按降序排列' % tid)
        for value in reminders:
            if not isinstance(value, int) or not (1 <= value <= REMINDER_MAX_MINUTES):
                errors.append('%s 提醒数值非法: %r' % (tid, value))
        expected_reminder = reminders[0] if reminders else 0
        if task.get('reminder') != expected_reminder:
            errors.append('%s 的 reminder 字段与 reminders 不一致' % tid)
        repeat = task.get('repeat')
        if repeat:
            if repeat.get('type') not in ALLOWED_REPEAT_TYPES:
                errors.append('%s 的重复类型非法: %s' % (tid, repeat.get('type')))
            if repeat.get('type') == 'custom':
                if not isinstance(repeat.get('interval'), int) or repeat.get('unit') not in ('days', 'weeks', 'months', 'years'):
                    errors.append('%s 的自定义重复参数不完整' % tid)
            if repeat.get('repeatMode') not in (None, 'startTime', 'completeTime'):
                errors.append('%s 的重复模式非法' % tid)
            if repeat.get('dayOfWeek') is not None and not (0 <= repeat['dayOfWeek'] <= 6):
                errors.append('%s 的 dayOfWeek 非法' % tid)
            if repeat.get('dayOfMonth') is not None and not (1 <= repeat['dayOfMonth'] <= 31):
                errors.append('%s 的 dayOfMonth 非法' % tid)
        for st in task.get('subtasks') or []:
            if not st.get('text'):
                errors.append('%s 存在空子任务' % tid)
            if len(st.get('reminders') or []) > REMINDER_MAX_COUNT:
                errors.append('%s 子任务提醒数量超过 5 个' % tid)
        if attachments_enabled and task.get('attachments'):
            for att in task['attachments']:
                folder = os.path.join(attachments_dir, attachment_safe_id(tid))
                prefix = att.get('id', '') + '_'
                found = False
                if os.path.isdir(folder):
                    found = any(name.startswith(prefix) for name in os.listdir(folder))
                if not found:
                    errors.append('%s 的附件文件不存在: %s' % (tid, att.get('name')))

    seen_pomodoro = set()
    for record in data.get('pomodoroHistory') or []:
        if not record.get(MARK):
            continue
        key = (record.get('startedAt'), record.get('taskId'))
        if key in seen_pomodoro:
            errors.append('番茄记录重复: %r' % (key,))
        seen_pomodoro.add(key)
        try:
            started = iso_to_local_dt(record.get('startedAt'))
            ended = iso_to_local_dt(record.get('endedAt'))
            if not started or not ended or ended < started:
                errors.append('番茄记录时间非法: %r' % key)
        except Exception:
            errors.append('番茄记录时间无法解析: %r' % key)
        if not isinstance(record.get('duration'), int) or record.get('duration', 0) <= 0:
            errors.append('番茄记录时长非法: %r' % key)

    missing_markdown, _ = validate_markdown_coverage(
        data.get('tasks') or [], data.get('taskTemplates') or [],
    )
    for feature in missing_markdown:
        errors.append('Markdown 覆盖缺失: %s' % feature)

    return errors


# ==================== 主流程 ====================

def detect_template_preset_version(app_dir):
    """读取 taskTemplates.js 中当前的 TEMPLATE_PRESET_VERSION。

    应用启动时若 settings.taskTemplatesPresetVersion 小于该值，
    会把整个模板列表重建为出厂预置，覆盖脚本生成的模板。
    """
    path = os.path.join(app_dir, 'taskTemplates.js')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            source = f.read()
        match = re.search(r'const\s+TEMPLATE_PRESET_VERSION\s*=\s*(\d+)', source)
        if match:
            return int(match.group(1))
    except OSError:
        pass
    return 4


def parse_date_arg(value):
    return datetime.strptime(value, '%Y-%m-%d').date()


def main():
    parser = argparse.ArgumentParser(description='生成 TackList 重度用户测试数据')
    parser.add_argument('--data-file', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.json'))
    parser.add_argument('--attachments-dir',
                        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'attachments'))
    parser.add_argument('--holiday-file',
                        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'holiday_data.json'))
    parser.add_argument('--seed', type=int, default=None, help='随机种子（默认由系统熵决定）')
    parser.add_argument('--start', type=parse_date_arg, default=None, help='起始日期，默认昨天')
    parser.add_argument('--end', type=parse_date_arg, default=None, help='结束日期，默认两年后')
    parser.add_argument('--pomodoro-days', type=int, default=2,
                        help='番茄历史回溯天数（含今天，默认 2；设为 1 仅今天）')
    parser.add_argument('--no-attachments', action='store_true', help='不生成附件文件与元数据')
    parser.add_argument('--no-tune-settings', action='store_true', help='不调整视图/侧边栏等偏好设置')
    parser.add_argument('--no-backup', action='store_true', help='写入前不备份原 data.json')
    args = parser.parse_args()

    data_file = os.path.abspath(args.data_file)
    attachments_dir = os.path.abspath(args.attachments_dir)
    holiday_file = os.path.abspath(args.holiday_file)

    start_day = args.start or (TODAY - timedelta(days=1))
    end_day = args.end or add_years(TODAY, 2)
    if end_day < start_day:
        raise SystemExit('结束日期不能早于开始日期')

    rng = random.Random(args.seed)

    if not os.path.exists(data_file):
        data = {}
        print('未找到 data.json，将创建新文件: %s' % data_file)
    else:
        with open(data_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

    data.setdefault('taskLists', [])
    data.setdefault('tasks', [])
    data.setdefault('settings', {})
    settings = data['settings']
    for key in ('tags', 'filters', 'countdowns', 'pinnedCountdowns'):
        if not isinstance(settings.get(key), list):
            settings[key] = []
    data.setdefault('quadrantOrder', [
        'urgent-important', 'important-not-urgent', 'urgent-not-important', 'not-urgent-not-important',
    ])
    data.setdefault('pomodoroHistory', [])
    data.setdefault('taskTemplates', [])

    # ---------- 清理旧测试数据 ----------
    old_tasks = list(data['tasks'])
    removed_task_ids = {t.get('id') for t in old_tasks if is_our_task(t)}
    data['tasks'] = [t for t in old_tasks if not is_our_task(t)]
    removed_tasks = len(old_tasks) - len(data['tasks'])

    old_lists = list(data['taskLists'])
    data['taskLists'] = [l for l in old_lists if not is_our_list(l)]
    removed_lists = len(old_lists) - len(data['taskLists'])

    old_tags = list(settings['tags'])
    settings['tags'] = [t for t in old_tags if not is_our_tag(t)]
    removed_tags = len(old_tags) - len(settings['tags'])

    old_filters = list(settings['filters'])
    settings['filters'] = [f for f in old_filters if not is_our_filter(f)]
    removed_filters = len(old_filters) - len(settings['filters'])

    old_templates = list(data['taskTemplates'])
    data['taskTemplates'] = [t for t in old_templates if not is_our_template(t)]
    removed_templates = len(old_templates) - len(data['taskTemplates'])

    old_countdowns = list(settings['countdowns'])
    settings['countdowns'] = [c for c in old_countdowns if not is_our_countdown(c)]
    removed_countdowns = len(old_countdowns) - len(settings['countdowns'])
    removed_cd_ids = {c.get('id') for c in old_countdowns if is_our_countdown(c)}
    settings['pinnedCountdowns'] = [k for k in settings['pinnedCountdowns'] if k not in removed_cd_ids]

    old_pomodoro = list(data['pomodoroHistory'])
    data['pomodoroHistory'] = [
        r for r in old_pomodoro if not (r.get(MARK) or r.get(LEGACY_MARK))
    ]
    removed_pomodoro = len(old_pomodoro) - len(data['pomodoroHistory'])

    removed_attachment_dirs = cleanup_attachment_dirs(attachments_dir, {tid for tid in removed_task_ids if tid})

    # ---------- 基础引用 ----------
    if not any(l.get('id') == DEFAULT_LIST_ID for l in data['taskLists']):
        data['taskLists'].insert(0, {'id': DEFAULT_LIST_ID, 'name': '默认', 'color': '#6366f1'})
    if settings.get('defaultListId') not in {l.get('id') for l in data['taskLists']}:
        settings['defaultListId'] = DEFAULT_LIST_ID

    new_tags = build_tags(settings['tags'])
    settings['tags'].extend(new_tags)
    tag_key_to_id = {d['key']: d['id'] for d in TAG_DEFS if d['id'] in {t['id'] for t in new_tags}}
    tag_ids = {tid: tid for tid in tag_key_to_id.values()}

    new_templates = build_templates(rng, data['taskTemplates'], tag_key_to_id)
    data['taskTemplates'].extend(new_templates)

    new_lists = build_lists()
    data['taskLists'].extend(new_lists)
    list_ids = {l.get('id') for l in data['taskLists']}

    new_filters = build_filters(settings['filters'], tag_key_to_id, list_ids)
    settings['filters'].extend(new_filters)

    new_countdowns = build_countdowns(settings['countdowns'])
    settings['countdowns'].extend(new_countdowns)

    group_map = build_group_map()
    holidays, workdays = load_holiday_map(holiday_file)

    # ---------- 生成任务 ----------
    used_ids = {t.get('id') for t in data['tasks'] if t.get('id')}
    tasks, metas = generate_tasks(
        rng, start_day, end_day, tag_key_to_id, group_map, new_templates,
        holidays, workdays, used_ids,
    )
    data['tasks'].extend(tasks)

    # ---------- 附件 ----------
    if args.no_attachments:
        attachment_task_count, attachment_file_count = 0, 0
    else:
        attachment_task_count, attachment_file_count = add_attachments(
            rng, tasks, metas, attachments_dir,
        )

    # ---------- 番茄历史 ----------
    existing_keys = {
        (r.get('startedAt'), r.get('taskId'))
        for r in data['pomodoroHistory']
        if r.get('startedAt')
    }
    pomodoro_records, today_records = generate_pomodoro(
        rng, max(1, args.pomodoro_days), data['tasks'], existing_keys,
    )
    data['pomodoroHistory'].extend(pomodoro_records)
    data['continuousTomatoCount'] = min(len(today_records), 6)
    data['continuousTomatoCountDate'] = TODAY.isoformat()

    # ---------- 固定倒计时 ----------
    valid_pin_keys = {COUNTDOWN_AUTO_KEY} | {c['id'] for c in settings['countdowns']}
    pinned = [k for k in settings['pinnedCountdowns'] if k in valid_pin_keys]
    for key in (COUNTDOWN_AUTO_KEY, COUNTDOWN_PREFIX + 'trip'):
        if key in valid_pin_keys and key not in pinned and len(pinned) < COUNTDOWN_PIN_LIMIT:
            pinned.append(key)
    settings['pinnedCountdowns'] = pinned[:COUNTDOWN_PIN_LIMIT]

    # ---------- 设置 ----------
    # 这些标记必须存在，否则应用启动时会把模板列表重建为出厂预置，覆盖本脚本生成的模板
    settings['taskTemplatesSeeded'] = True
    try:
        existing_preset_version = int(settings.get('taskTemplatesPresetVersion') or 0)
    except (TypeError, ValueError):
        existing_preset_version = 0
    detected_preset_version = detect_template_preset_version(
        os.path.dirname(os.path.abspath(__file__)),
    )
    settings['taskTemplatesPresetVersion'] = max(existing_preset_version, detected_preset_version)
    settings['taskTemplatesRepeatNormalizedV1'] = True
    settings['taskTemplatesPresetUpgradeV1'] = True
    try:
        settings['onboardingVersion'] = max(int(settings.get('onboardingVersion') or 0), 1)
    except (TypeError, ValueError):
        settings['onboardingVersion'] = 1

    if not args.no_tune_settings:
        settings['showCompleted'] = True
        settings['showLunar'] = True
        settings['showHolidayCountdown'] = True
        settings['showSidebarExtras'] = True
        settings['showFocusButton'] = True
        settings['notesMarkdown'] = True
        settings['priorityTaskBg'] = True
        settings['defaultTaskDate'] = 'today'
        sidebar = settings.get('sidebarItems') if isinstance(settings.get('sidebarItems'), dict) else {}
        sidebar.update({
            'allTasks': 'show', 'today': 'show', 'tomorrow': 'show',
            'recent3days': 'show', 'recent7days': 'show', 'summary': 'show',
            'tags': 'show', 'filters': 'show', 'trash': 'show',
        })
        settings['sidebarItems'] = sidebar
        for key in ('taskViewConfig', 'scheduleConfig', 'weekConfig', 'monthConfig',
                    'quadrantConfig', 'kanbanConfig'):
            cfg = settings.get(key)
            if not isinstance(cfg, dict):
                cfg = {}
            cfg['showCompleted'] = True
            if key in ('quadrantConfig', 'kanbanConfig'):
                cfg['showFocusButton'] = True
            settings[key] = cfg
        kanban = settings.setdefault('kanbanConfig', {})
        kanban.setdefault('groupBy', 'custom')
        kanban.setdefault('sortBy', 'time')
        kanban.setdefault('sortDir', 'asc')

    # ---------- 校验 ----------
    errors = validate_dataset(
        data, start_day, end_day, attachments_dir,
        attachments_enabled=not args.no_attachments,
    )
    if errors:
        print('\n数据校验失败（未写入文件）：')
        for msg in errors[:30]:
            print('  - ' + msg)
        if len(errors) > 30:
            print('  ... 共 %d 个问题' % len(errors))
        raise SystemExit(2)

    # ---------- 备份并写入 ----------
    backup_path = None
    if os.path.exists(data_file) and not args.no_backup:
        stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = '%s.heavy_user.bak.%s' % (data_file, stamp)
        shutil.copy2(data_file, backup_path)
        _prune_backups(data_file, keep=3)

    parent_dir = os.path.dirname(data_file)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)
    tmp_file = data_file + '.tmp'
    with open(tmp_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_file, data_file)

    # ---------- 汇报 ----------
    print('\n===== 重度用户测试数据生成完成 =====')
    print('时间范围      : %s ~ %s（%d 天）' % (start_day, end_day, (end_day - start_day).days + 1))
    print('随机种子      : %s' % ('(system)' if args.seed is None else args.seed))
    print('数据文件      : %s' % data_file)
    if backup_path:
        print('原数据备份    : %s' % backup_path)
    print('')
    print('清理旧测试数据: 任务 %d / 清单 %d / 标签 %d / 过滤器 %d / 模板 %d / 倒计时 %d / 番茄 %d / 附件目录 %d'
          % (removed_tasks, removed_lists, removed_tags, removed_filters,
             removed_templates, removed_countdowns, removed_pomodoro, removed_attachment_dirs))
    print('')
    print('清单 %d 个（含文件夹/归档/看板分组）' % len(new_lists))
    print('标签 %d 个 / 过滤器 %d 个 / 模板 %d 个 / 自定义倒计时 %d 个'
          % (len(new_tags), len(new_filters), len(new_templates), len(new_countdowns)))
    print('任务 %d 条（本次生成），其中：' % len(tasks))
    print('  普通日任务 : %d' % sum(
        1 for t, m in zip(tasks, metas)
        if not m['no_date'] and m['category'] != 'template'
        and not m.get('trash') and t.get('listId') != 'hylst_archive'))
    print('  无日期任务 : %d' % sum(1 for m in metas if m['no_date']))
    print('  归档任务   : %d' % sum(1 for t, m in zip(tasks, metas) if t.get('listId') == 'hylst_archive'))
    print('  模板任务   : %d' % sum(1 for m in metas if m['category'] == 'template'))
    print('  回收站任务 : %d' % sum(1 for m in metas if m.get('trash')))
    print('  全天 / 定时: %d / %d' % (
        sum(1 for m in metas if m['all_day']), sum(1 for m in metas if not m['all_day'])))
    print('  已完成     : %d' % sum(1 for m in metas if m['completed']))
    print('  文本 / 子任务模式: %d / %d' % (
        sum(1 for m in metas if m['mode'] == 'text'),
        sum(1 for m in metas if m['mode'] == 'subtasks')))
    repeat_counter = {}
    for m in metas:
        if m['repeat_type']:
            repeat_counter[m['repeat_type']] = repeat_counter.get(m['repeat_type'], 0) + 1
    print('  重复任务   : %s' % (', '.join('%s=%d' % (k, v) for k, v in sorted(repeat_counter.items())) or '无'))
    md_tasks = sum(
        1 for t in tasks
        if has_markdown(t.get('notes')) or has_markdown(t.get('description'))
    )
    md_templates = sum(
        1 for tpl in new_templates
        if has_markdown((tpl.get('task') or {}).get('notes'))
        or has_markdown((tpl.get('task') or {}).get('description'))
    )
    print('Markdown 内容 : 任务 %d / %d，模板 %d / %d' % (
        md_tasks, len(tasks), md_templates, len(new_templates)))
    print('附件          : %d 个任务 / %d 个文件' % (attachment_task_count, attachment_file_count))
    print('番茄记录      : %d 条（今日 %d 条）' % (len(pomodoro_records), len(today_records)))
    print('固定倒计时    : %s' % ', '.join(settings['pinnedCountdowns']))
    print('任务总数（含保留的真实数据）: %d' % len(data['tasks']))
    print('')
    print('提示：若 TackList 服务正在运行，请重启应用后再刷新页面，避免浏览器内存中的旧数据回写覆盖。')


def _prune_backups(data_file, keep):
    folder = os.path.dirname(data_file) or '.'
    prefix = os.path.basename(data_file) + '.heavy_user.bak.'
    matches = sorted(
        (os.path.join(folder, name) for name in os.listdir(folder) if name.startswith(prefix)),
        key=os.path.getmtime, reverse=True,
    )
    for path in matches[keep:]:
        try:
            os.remove(path)
        except OSError:
            pass


if __name__ == '__main__':
    main()
