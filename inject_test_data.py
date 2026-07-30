#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试数据注入脚本：模拟重度用户使用后的系统数据。
- 10 个不同的清单
- 10 个不同的标签
- 5 个不同的过滤器
- 2026、2027 年每天 0-15 个日程任务（每日随机）
- 专注历史记录

保留原有设置中的非测试数据，仅追加/替换测试数据。重复执行会先清除上次注入的测试数据。
"""

import json
import os
import random
import uuid
from datetime import datetime, timezone, timedelta

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.json')
TEST_TAG = '__test_data__'  # 用于标识测试数据，便于重复执行时清理

# ==================== 清单定义（10个） ====================
TEST_LISTS = [
    {'id': 'lst_work',      'name': '工作',     'color': '#3b82f6'},
    {'id': 'lst_personal',  'name': '个人',     'color': '#10b981'},
    {'id': 'lst_study',     'name': '学习',     'color': '#8b5cf6'},
    {'id': 'lst_health',    'name': '健康',     'color': '#ef4444'},
    {'id': 'lst_family',    'name': '家庭',     'color': '#f59e0b'},
    {'id': 'lst_project',   'name': '项目',     'color': '#ec4899'},
    {'id': 'lst_reading',   'name': '阅读',     'color': '#06b6d4'},
    {'id': 'lst_finance',   'name': '财务',     'color': '#84cc16'},
    {'id': 'lst_social',    'name': '社交',     'color': '#f97316'},
    {'id': 'lst_hobby',     'name': '爱好',     'color': '#a855f7'},
]

# ==================== 标签定义（10个） ====================
TEST_TAGS = [
    {'id': 'tag_urgent',    'name': '紧急处理', 'color': '#ef4444'},
    {'id': 'tag_routine',   'name': '日常事务', 'color': '#6b7280'},
    {'id': 'tag_deep',      'name': '深度思考', 'color': '#3b82f6'},
    {'id': 'tag_quick',     'name': '快速完成', 'color': '#10b981'},
    {'id': 'tag_meeting',   'name': '会议',     'color': '#f59e0b'},
    {'id': 'tag_creative',  'name': '创意',     'color': '#ec4899'},
    {'id': 'tag_review',    'name': '复盘',     'color': '#8b5cf6'},
    {'id': 'tag_outdoor',   'name': '户外',     'color': '#84cc16'},
    {'id': 'tag_online',    'name': '线上',     'color': '#06b6d4'},
    {'id': 'tag_weekend',   'name': '周末',     'color': '#f97316'},
]

# ==================== 过滤器定义（5个） ====================
TEST_FILTERS = [
    {'id': 'flt_important_urgent', 'name': '重要且紧急', 'color': '#ef4444',
     'conditions': {'important': True, 'urgent': True}},
    {'id': 'flt_work_deep', 'name': '工作深度任务', 'color': '#3b82f6',
     'conditions': {'listIds': ['lst_work'], 'tagIds': ['tag_deep']}},
    {'id': 'flt_health_outdoor', 'name': '健康户外', 'color': '#84cc16',
     'conditions': {'listIds': ['lst_health'], 'tagIds': ['tag_outdoor']}},
    {'id': 'flt_today_meeting', 'name': '今日会议', 'color': '#f59e0b',
     'conditions': {'tagIds': ['tag_meeting'], 'timeRange': 'today'}},
    {'id': 'flt_quick_done', 'name': '快速完成项', 'color': '#10b981',
     'conditions': {'tagIds': ['tag_quick']}},
]

# ==================== 任务模板 ====================
# 每个模板关联清单和标签，确保覆盖多样化
TEXT_TEMPLATES = [
    # 工作
    {'title': '团队晨会同步', 'notes': '回顾昨日进度，明确今日目标', 'isAllDay': False, 'hour': 9, 'minute': 30, 'important': True, 'urgent': True, 'listId': 'lst_work', 'tagIds': ['tag_meeting', 'tag_routine']},
    {'title': '撰写产品周报', 'notes': '汇总本周关键指标与风险项', 'isAllDay': False, 'hour': 17, 'minute': 0, 'important': True, 'urgent': False, 'listId': 'lst_work', 'tagIds': ['tag_review', 'tag_deep']},
    {'title': '代码评审', 'notes': '检查 PR #1284 的实现逻辑', 'isAllDay': False, 'hour': 14, 'minute': 0, 'important': False, 'urgent': True, 'listId': 'lst_project', 'tagIds': ['tag_quick', 'tag_review']},
    {'title': '回复客户邮件', 'notes': '处理待办邮件清单', 'isAllDay': False, 'hour': 10, 'minute': 0, 'important': True, 'urgent': True, 'listId': 'lst_work', 'tagIds': ['tag_urgent', 'tag_quick']},
    {'title': '撰写技术方案', 'notes': '架构设计与技术选型', 'isAllDay': False, 'hour': 15, 'minute': 0, 'important': True, 'urgent': False, 'listId': 'lst_project', 'tagIds': ['tag_deep', 'tag_creative']},
    {'title': '线上故障排查', 'notes': '生产环境异常监控告警', 'isAllDay': False, 'hour': 11, 'minute': 0, 'important': True, 'urgent': True, 'listId': 'lst_work', 'tagIds': ['tag_urgent']},
    # 个人
    {'title': '整理本周笔记', 'notes': '归类到对应项目目录', 'isAllDay': True, 'important': False, 'urgent': False, 'listId': 'lst_personal', 'tagIds': ['tag_routine', 'tag_review']},
    {'title': '采购生活物资', 'notes': '牛奶、水果、日用品', 'isAllDay': True, 'important': False, 'urgent': False, 'listId': 'lst_personal', 'tagIds': ['tag_routine', 'tag_quick']},
    {'title': '冥想放松', 'notes': '10 分钟正念呼吸练习', 'isAllDay': True, 'important': False, 'urgent': False, 'listId': 'lst_personal', 'tagIds': ['tag_quick']},
    {'title': '年度目标回顾', 'notes': '检查 Q4 OKR 进展', 'isAllDay': False, 'hour': 20, 'minute': 0, 'important': True, 'urgent': False, 'listId': 'lst_personal', 'tagIds': ['tag_deep', 'tag_review']},
    # 学习
    {'title': '阅读技术文档', 'notes': '学习新框架的核心概念', 'isAllDay': True, 'important': False, 'urgent': False, 'listId': 'lst_study', 'tagIds': ['tag_deep']},
    {'title': '学习英语听力', 'notes': 'BBC 6 Minute English 一集', 'isAllDay': False, 'hour': 21, 'minute': 0, 'important': False, 'urgent': False, 'listId': 'lst_study', 'tagIds': ['tag_routine']},
    {'title': '在线课程学习', 'notes': '数据结构 Chapter 7', 'isAllDay': False, 'hour': 19, 'minute': 0, 'important': False, 'urgent': False, 'listId': 'lst_study', 'tagIds': ['tag_online', 'tag_deep']},
    # 健康
    {'title': '健身房训练', 'notes': '腿部+核心，45分钟', 'isAllDay': False, 'hour': 19, 'minute': 30, 'important': False, 'urgent': False, 'listId': 'lst_health', 'tagIds': ['tag_routine']},
    {'title': '晨跑5公里', 'notes': '公园绿道', 'isAllDay': False, 'hour': 6, 'minute': 30, 'important': False, 'urgent': False, 'listId': 'lst_health', 'tagIds': ['tag_outdoor', 'tag_routine']},
    {'title': '体检预约', 'notes': '年度全身体检', 'isAllDay': True, 'important': True, 'urgent': False, 'listId': 'lst_health', 'tagIds': ['tag_routine']},
    # 家庭
    {'title': '家庭大扫除', 'notes': '周末计划', 'isAllDay': True, 'important': False, 'urgent': False, 'listId': 'lst_family', 'tagIds': ['tag_weekend', 'tag_routine']},
    {'title': '陪孩子写作业', 'notes': '数学和语文', 'isAllDay': False, 'hour': 20, 'minute': 0, 'important': False, 'urgent': False, 'listId': 'lst_family', 'tagIds': ['tag_routine']},
    {'title': '家庭聚餐', 'notes': '周末全家吃饭', 'isAllDay': True, 'important': False, 'urgent': False, 'listId': 'lst_family', 'tagIds': ['tag_weekend']},
    # 项目
    {'title': '项目里程碑评审', 'notes': 'v2.0 发布前评估', 'isAllDay': False, 'hour': 14, 'minute': 0, 'important': True, 'urgent': True, 'listId': 'lst_project', 'tagIds': ['tag_meeting', 'tag_review']},
    {'title': '需求调研', 'notes': '用户访谈与竞品分析', 'isAllDay': False, 'hour': 10, 'minute': 30, 'important': True, 'urgent': False, 'listId': 'lst_project', 'tagIds': ['tag_deep', 'tag_creative']},
    # 阅读
    {'title': '读书30分钟', 'notes': '《深度工作》第四章', 'isAllDay': False, 'hour': 22, 'minute': 0, 'important': False, 'urgent': False, 'listId': 'lst_reading', 'tagIds': ['tag_deep', 'tag_routine']},
    {'title': '整理读书笔记', 'notes': '摘录与思考', 'isAllDay': True, 'important': False, 'urgent': False, 'listId': 'lst_reading', 'tagIds': ['tag_review']},
    # 财务
    {'title': '月度预算复盘', 'notes': '核对支出与预算差异', 'isAllDay': False, 'hour': 16, 'minute': 0, 'important': True, 'urgent': False, 'listId': 'lst_finance', 'tagIds': ['tag_review', 'tag_deep']},
    {'title': '报销单据整理', 'notes': '差旅与办公费用', 'isAllDay': True, 'important': False, 'urgent': False, 'listId': 'lst_finance', 'tagIds': ['tag_quick', 'tag_routine']},
    # 社交
    {'title': '朋友聚会', 'notes': '周六晚火锅', 'isAllDay': True, 'important': False, 'urgent': False, 'listId': 'lst_social', 'tagIds': ['tag_weekend']},
    {'title': '行业沙龙参加', 'notes': 'AI 技术分享', 'isAllDay': False, 'hour': 14, 'minute': 0, 'important': False, 'urgent': False, 'listId': 'lst_social', 'tagIds': ['tag_online', 'tag_deep']},
    # 爱好
    {'title': '摄影外拍', 'notes': '日落城市天际线', 'isAllDay': True, 'important': False, 'urgent': False, 'listId': 'lst_hobby', 'tagIds': ['tag_outdoor', 'tag_creative']},
    {'title': '练吉他30分钟', 'notes': '复习和弦转换', 'isAllDay': False, 'hour': 21, 'minute': 30, 'important': False, 'urgent': False, 'listId': 'lst_hobby', 'tagIds': ['tag_routine']},
]

SUBTASK_TEMPLATES = [
    {
        'title': '完成需求评审', 'notes': '需求文档 v2.3',
        'subtasks': ['梳理用户故事', '确认验收标准', '评估开发工作量', '与设计对齐交互细节'],
        'isAllDay': False, 'hour': 11, 'minute': 0, 'important': True, 'urgent': False,
        'listId': 'lst_project', 'tagIds': ['tag_meeting', 'tag_review']
    },
    {
        'title': '部署测试环境', 'notes': 'release-2026.07 分支',
        'subtasks': ['拉取最新代码', '执行数据库迁移', '重启后端服务', '验证接口连通性', '通知 QA 团队'],
        'isAllDay': False, 'hour': 15, 'minute': 30, 'important': False, 'urgent': True,
        'listId': 'lst_work', 'tagIds': ['tag_urgent', 'tag_routine']
    },
    {
        'title': '准备季度汇报', 'notes': 'PPT 初稿',
        'subtasks': ['收集各项目进度数据', '制作图表', '撰写总结', '内审一遍'],
        'isAllDay': True, 'important': True, 'urgent': True,
        'listId': 'lst_work', 'tagIds': ['tag_deep', 'tag_review']
    },
    {
        'title': '朋友生日聚会准备', 'notes': '本周六',
        'subtasks': ['订购蛋糕', '挑选礼物', '预定餐厅', '通知其他朋友'],
        'isAllDay': True, 'important': False, 'urgent': False,
        'listId': 'lst_social', 'tagIds': ['tag_weekend', 'tag_quick']
    },
    {
        'title': '修复线上 Bug', 'notes': 'Issue #2391 登录闪退',
        'subtasks': ['复现问题', '定位根因', '编写修复代码', '补充单元测试', '提交 hotfix'],
        'isAllDay': False, 'hour': 14, 'minute': 30, 'important': True, 'urgent': True,
        'listId': 'lst_project', 'tagIds': ['tag_urgent', 'tag_deep']
    },
    {
        'title': '车辆保养', 'notes': '里程 5 万公里',
        'subtasks': ['预约 4S 店', '更换机油机滤', '检查轮胎', '清洗空调'],
        'isAllDay': True, 'important': False, 'urgent': False,
        'listId': 'lst_personal', 'tagIds': ['tag_routine']
    },
    {
        'title': '新员工培训计划', 'notes': '入职第一周',
        'subtasks': ['准备培训材料', '配置开发环境', '介绍团队成员', '分配首个任务', '一周后回顾'],
        'isAllDay': False, 'hour': 10, 'minute': 0, 'important': True, 'urgent': False,
        'listId': 'lst_work', 'tagIds': ['tag_meeting', 'tag_review']
    },
    {
        'title': '家庭旅行规划', 'notes': '春节出游',
        'subtasks': ['确定目的地', '预订机票酒店', '制定行程表', '准备行李清单', '安排宠物寄养'],
        'isAllDay': True, 'important': False, 'urgent': False,
        'listId': 'lst_family', 'tagIds': ['tag_weekend', 'tag_creative']
    },
]


def gen_id():
    return uuid.uuid4().hex[:20]


def make_subtask(text, completed=False, order=0):
    return {'id': gen_id(), 'text': text, 'completed': completed, 'originalOrder': order}


def make_task(date, template):
    """根据模板构造一个任务对象"""
    year, month, day = date.year, date.month, date.day
    is_all_day = template.get('isAllDay', True)
    if is_all_day:
        start = datetime(year, month, day, 0, 0, 0)
        start_iso = start.isoformat() + '.000Z'
        end_iso = None
    else:
        hour = template.get('hour', 9)
        minute = template.get('minute', 0)
        start = datetime(year, month, day, hour, minute, 0)
        start_iso = start.isoformat() + '.000Z'
        # 随机时长：30分钟、1小时、1.5小时、2小时
        duration_hours = random.choice([0.5, 1, 1.5, 2])
        end = start + timedelta(hours=duration_hours)
        end_iso = end.isoformat() + '.000Z'

    is_subtask_mode = 'subtasks' in template
    if is_subtask_mode:
        sub_items = template['subtasks']
        subtasks = []
        for i, text in enumerate(sub_items):
            completed = random.random() < 0.3
            subtasks.append(make_subtask(text, completed, i))
        mode = 'subtask'
    else:
        subtasks = []
        mode = 'text'

    # 随机决定任务是否已完成（约 25% 已完成）
    completed = random.random() < 0.25
    if completed and is_subtask_mode:
        for st in subtasks:
            st['completed'] = True

    # 计算进度
    if completed:
        progress = 100
    elif is_subtask_mode and subtasks:
        done_count = sum(1 for st in subtasks if st['completed'])
        progress = int(done_count / len(subtasks) * 100)
    else:
        progress = 0

    task = {
        'id': gen_id(),
        'title': template['title'],
        'listId': template.get('listId', 'lst_work'),
        'important': template.get('important', False),
        'urgent': template.get('urgent', False),
        'notes': template.get('notes', ''),
        'tags': template.get('tagIds', []),
        'startTime': start_iso,
        'endTime': end_iso,
        'isAllDay': is_all_day,
        'reminder': random.choice([0, 0, 0, 5, 10, 15, 30]),  # 多数无提醒
        'repeat': None,
        'completed': completed,
        'createdAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'mode': mode,
        'subtasks': subtasks,
        'progress': progress,
        TEST_TAG: True
    }
    return task


def make_pomodoro_history(date, task_ids):
    """为某天生成番茄专注历史记录"""
    records = []
    # 当天专注次数：0-6 次
    count = random.randint(0, 6)
    if count == 0:
        return records

    # 专注时段分布
    focus_hours = [9, 10, 11, 14, 15, 16, 19, 20, 21]
    chosen_hours = random.sample(focus_hours, min(count, len(focus_hours)))

    for hour in chosen_hours:
        minute = random.choice([0, 15, 30, 45])
        start = datetime(date.year, date.month, date.day, hour, minute, 0)
        # 专注时长：25分钟（标准番茄钟），少数为15或50
        duration = random.choice([25, 25, 25, 15, 50])
        end = start + timedelta(minutes=duration)
        task_id = random.choice(task_ids) if task_ids else None

        # 同一周期可能拆分为多条记录（模拟拆分专注），共享 date 字段
        record_date = end
        # 仅当时长足够（>20分钟）才可能拆分
        num_splits = random.choice([1, 1, 1, 2]) if duration > 20 else 1
        for s in range(num_splits):
            if num_splits == 1:
                split_duration = duration
            else:
                # 拆分时确保每段至少10分钟
                split_duration = random.randint(10, max(11, duration - 10))
            split_end = start + timedelta(minutes=split_duration)
            records.append({
                'id': gen_id(),
                'date': split_end.isoformat() + '.000Z',
                'startedAt': start.isoformat() + '.000Z',
                'endedAt': split_end.isoformat() + '.000Z',
                'duration': split_duration,
                'taskName': '专注工作' if not task_id else '',
                'taskId': task_id,
                TEST_TAG: True
            })
            if num_splits > 1:
                start = split_end
                duration = duration - split_duration
    return records


def main():
    if not os.path.exists(DATA_FILE):
        print('data.json not found: %s' % DATA_FILE)
        return

    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # ========== 1. 清理上次注入的测试数据 ==========
    original_task_count = len(data.get('tasks', []))
    data['tasks'] = [t for t in data.get('tasks', []) if not t.get(TEST_TAG)]
    cleaned_tasks = original_task_count - len(data['tasks'])

    original_pomo_count = len(data.get('pomodoroHistory', []))
    data['pomodoroHistory'] = [h for h in data.get('pomodoroHistory', []) if not h.get(TEST_TAG)]
    cleaned_pomo = original_pomo_count - len(data['pomodoroHistory'])

    print('清理上次测试任务: %d 条' % cleaned_tasks)
    print('清理上次测试专注记录: %d 条' % cleaned_pomo)

    # ========== 2. 注入清单（10个） ==========
    if 'taskLists' not in data:
        data['taskLists'] = []
    # 移除上次注入的测试清单
    data['taskLists'] = [l for l in data['taskLists'] if not l.get('id', '').startswith('lst_')]
    # 保留原有清单，追加测试清单
    data['taskLists'].extend(TEST_LISTS)
    print('注入清单: %d 个' % len(TEST_LISTS))

    # ========== 3. 注入标签（10个） ==========
    if 'settings' not in data:
        data['settings'] = {}
    if 'tags' not in data['settings']:
        data['settings']['tags'] = []
    # 移除上次注入的测试标签
    data['settings']['tags'] = [t for t in data['settings']['tags'] if not t.get('id', '').startswith('tag_')]
    data['settings']['tags'].extend(TEST_TAGS)
    print('注入标签: %d 个' % len(TEST_TAGS))

    # ========== 4. 注入过滤器（5个） ==========
    if 'filters' not in data['settings']:
        data['settings']['filters'] = []
    # 移除上次注入的测试过滤器
    data['settings']['filters'] = [f for f in data['settings']['filters'] if not f.get('id', '').startswith('flt_')]
    data['settings']['filters'].extend(TEST_FILTERS)
    print('注入过滤器: %d 个' % len(TEST_FILTERS))

    # ========== 5. 注入任务（2026、2027年每天0-15个） ==========
    random.seed(42)  # 可复现的随机序列
    all_templates = TEXT_TEMPLATES + SUBTASK_TEMPLATES
    new_tasks = []

    for year in [2026, 2027]:
        for month in range(1, 13):
            # 获取当月天数
            if month == 12:
                next_month_first = datetime(year + 1, 1, 1)
            else:
                next_month_first = datetime(year, month + 1, 1)
            days_in_month = (next_month_first - datetime(year, month, 1)).days

            for day in range(1, days_in_month + 1):
                date = datetime(year, month, day)
                # 每天 0-15 个任务
                daily_count = random.randint(0, 15)
                if daily_count == 0:
                    continue

                # 从模板池中随机选取，允许重复（同一天可有多个相同模板）
                day_templates = [random.choice(all_templates) for _ in range(daily_count)]
                # 周末优先周末标签模板（增加 tag_weekend 出现频率）
                if date.weekday() >= 5:  # 周六周日
                    day_templates = [t for t in day_templates]  # 保持原样，模板内已有周末标签

                for tpl in day_templates:
                    task = make_task(date, tpl)
                    new_tasks.append(task)

    data['tasks'].extend(new_tasks)
    print('注入测试任务: %d 条（2026-2027年）' % len(new_tasks))

    # ========== 6. 注入专注历史记录 ==========
    # 收集所有任务ID用于关联
    test_task_ids = [t['id'] for t in new_tasks if not t['completed']]
    new_pomo_history = []

    # 为最近120天每天生成专注记录
    today = datetime.now()
    for days_ago in range(120):
        date = today - timedelta(days=days_ago)
        records = make_pomodoro_history(date, test_task_ids)
        new_pomo_history.extend(records)

    data['pomodoroHistory'].extend(new_pomo_history)
    # 保留最近500条（与server.py的POMODORO_HISTORY_LIMIT一致）
    if len(data['pomodoroHistory']) > 500:
        data['pomodoroHistory'] = data['pomodoroHistory'][-500:]
    print('注入专注历史记录: %d 条' % len(new_pomo_history))

    # ========== 保存 ==========
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print('\n===== 注入完成 =====')
    print('清单总数: %d' % len(data.get('taskLists', [])))
    print('标签总数: %d' % len(data.get('settings', {}).get('tags', [])))
    print('过滤器总数: %d' % len(data.get('settings', {}).get('filters', [])))
    print('任务总数: %d' % len(data.get('tasks', [])))
    print('专注历史记录: %d 条' % len(data.get('pomodoroHistory', [])))


if __name__ == '__main__':
    main()
