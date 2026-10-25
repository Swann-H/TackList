#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys

# When running with pythonw.exe on Windows, stdout/stderr are None.
# Redirect to a log file so print() calls don't crash.
if sys.stdout is None:
    _log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'server.log')
    sys.stdout = open(_log_path, 'a', encoding='utf-8')
if sys.stderr is None:
    _log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'server.log')
    sys.stderr = open(_log_path, 'a', encoding='utf-8')
import json
import threading
import subprocess
import shutil
import time
import signal
import socket
import re
import uuid
import mimetypes
import tempfile
import zipfile

import urllib.parse
import urllib.request
import urllib.error
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta

PORT = 14438
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(DIRECTORY, 'data.json')
LOCK_FILE = os.path.join(DIRECTORY, '.data.lock')
ARCHIVE_DIR = os.path.join(DIRECTORY, 'pomodoro_archive')
BACKUP_DIR = os.path.join(DIRECTORY, 'backups')
# 任务附件（FR-06）：按 <taskId>/<fileId>_<sanitized name> 落盘。
# 二进制不进 data.json —— 全量 PUT + 5MB PATCH 上限决定了 base64 内联不可行。
ATTACHMENT_DIR = os.path.join(DIRECTORY, 'attachments')
ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024  # 单文件上限 20MB
ATTACHMENT_INLINE_MIME = {
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'
}
ATTACHMENT_ALLOWED_MIME = {
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif',
    'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
    'application/zip', 'application/x-zip-compressed',
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    # 未知二进制（浏览器常见兜底类型）：允许上传，但读取时一律按 attachment 下发 + nosniff
    'application/octet-stream'
}


def attachment_safe_id(value):
    """taskId / fileId 白名单化：只留字母数字下划线连字符，杜绝路径穿越。"""
    return re.sub(r'[^A-Za-z0-9_\-]', '', value or '')[:80]


def attachment_safe_name(name):
    """原始文件名净化：剥离目录成分与非法字符，仅用于展示与磁盘后缀。"""
    base = os.path.basename((name or '').replace('\\', '/'))
    base = re.sub(r'[\x00-\x1f<>:"|?*]', '_', base).strip('. ')
    if not base:
        base = 'file'
    return base[:120]


def attachment_find_file(task_id, file_id):
    """按 <fileId>_ 前缀定位磁盘文件（客户端只持有 fileId，不参与拼路径）。"""
    folder = os.path.join(ATTACHMENT_DIR, task_id)
    if not os.path.isdir(folder):
        return None
    prefix = file_id + '_'
    try:
        for fn in os.listdir(folder):
            if fn.startswith(prefix):
                return os.path.join(folder, fn)
    except OSError:
        return None
    return None


DEFAULT_DATA = {
    "taskLists": [{"id": "default", "name": "默认", "color": "#3b82f6"}],
    "tasks": [],
    "settings": {
        "defaultListId": "default",
        "defaultImportant": False,
        "defaultUrgent": False,
        "defaultView": "task",
        "weekStart": "monday",
        "showCompleted": True,
        "showLunar": True,
        "noDateTaskPosition": "last",
        "focusDuration": 25,
        "shortBreakDuration": 5,
        "longBreakDuration": 15,
        "longBreakInterval": 4,
        "autoBreak": False,
        "autoFocus": False,
        "autoCreateTask": True,
        "toastDuration": 5,
        "refreshInterval": 30,
        "theme": "light",
        "bgImage": "",
        "bgOpacity": 30,
        "backupEnabled": False,
        "backupInterval": 7,
        "retentionPeriod": 30,
        "bindAddress": "127.0.0.1",
        "port": 14438,
        "viewOrder": [
            {"id": "task", "enabled": True},
            {"id": "schedule", "enabled": True},
            {"id": "week", "enabled": True},
            {"id": "month", "enabled": True},
            {"id": "quadrant", "enabled": True},
            {"id": "kanban", "enabled": True}
        ],
        "defaultHomeView": "task"
    },
    "quadrantOrder": ["urgent-important", "important-not-urgent", "urgent-not-important", "not-urgent-not-important"],
    "pomodoroHistory": [],
    "continuousTomatoCount": 0,
    "continuousTomatoCountDate": ""
}

def get_local_ip():
    """获取本机局域网IP地址"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            hostname = socket.gethostname()
            ip = socket.gethostbyname(hostname)
            if ip and ip != '127.0.0.1':
                return ip
        except Exception:
            pass
        return "127.0.0.1"

data_lock = threading.Lock()
# 已提醒去重集合（任务+时间点级）。
# 元素形如 "task_xxx@0@1758326400000"（准点）、"task_xxx@30@1758326400000"（提前 30 分钟）、
#        "task_xxx@sub_yyy@0@1758326400000"（子任务准点）。
# 末段 base_ms 为任务/子任务的时间戳：时间一变 key 全部失效，重复任务顺延/改时间后可再次提醒。
notified_reminder_keys = set()
notified_task_ids_lock = threading.Lock()
# 稍后提醒队列: {"task_id@_task" 或 "task_id@sub_yyy": remind_again_after_timestamp_ms}
snoozed_reminders = {}
snoozed_reminders_lock = threading.Lock()

# 提醒触发窗口（毫秒）：围绕每个提醒时间点的容差。
# diff = 提醒时刻 - 当前时刻，故 diff<0 表示提醒时刻已过、diff>0 表示还没到。
# 早到容差 30s（时钟抖动）；迟到容差 60s（巡检间隔 30s，向后放宽以覆盖漏拍，
# 避免"差一点错过窗口就永不提醒"）。
REMINDER_EARLY_TOLERANCE_MS = 30000
REMINDER_LATE_TOLERANCE_MS = 60000
# 提前提醒：最多 5 个，取值范围 1 ~ 10080 分钟（7 天）
REMINDER_MAX_COUNT = 5
REMINDER_MAX_MINUTES = 10080


def _reminder_key(task_id, minute, subtask_id=None, base_ms=0):
    """构造提醒去重键。minute=0 表示准点。base_ms 为对应任务/子任务的时间戳。"""
    who = '%s@%s' % (task_id, subtask_id) if subtask_id else task_id
    return '%s@%d@%d' % (who, minute, base_ms)


def _snooze_key(task_id, subtask_id=None):
    """构造稍后提醒队列的键。"""
    return '%s@%s' % (task_id, subtask_id or '_task')


def _normalize_reminder_minutes(raw):
    """归一化提前提醒数组：仅保留 1~10080 的整数，去重、降序、截断 5 个。"""
    out = []
    if isinstance(raw, list):
        for v in raw:
            try:
                m = int(v)
            except (TypeError, ValueError):
                continue
            if 1 <= m <= REMINDER_MAX_MINUTES and m not in out:
                out.append(m)
    return sorted(out, reverse=True)[:REMINDER_MAX_COUNT]


def _task_advance_minutes(task):
    """读取任务的提前量列表；兼容旧字段 reminder（>0 视为一个提前量）。"""
    raw = task.get('reminders')
    if isinstance(raw, list):
        return _normalize_reminder_minutes(raw)
    old = task.get('reminder')
    if isinstance(old, (int, float)) and old > 0:
        return [int(old)]
    return []


def _fire_points(base_ms, advance_minutes):
    """返回 [(minute, fire_ms, kind)]；minute=0 恒为第一项（准点，系统固有行为）。"""
    points = [(0, base_ms, 'ondot')]
    for m in advance_minutes:
        points.append((m, base_ms - m * 60 * 1000, 'advance'))
    return points


def _try_fire(key, fire_ms, now_ms):
    """窗口判定 + 原子去重；返回 True 表示本次应触发。

    diff = fire_ms - now_ms：>0 为尚未到点（允许提前 30s 抖动），<0 为已过点（允许补发 60s）。
    """
    diff = fire_ms - now_ms
    if not (-REMINDER_LATE_TOLERANCE_MS <= diff <= REMINDER_EARLY_TOLERANCE_MS):
        return False
    with notified_task_ids_lock:
        if key in notified_reminder_keys:
            return False
        notified_reminder_keys.add(key)
    return True


def _humanize_minute(minute):
    """把提前分钟数转成人类可读文案：5 分钟 / 1 小时 / 1 天。"""
    try:
        m = int(minute)
    except (TypeError, ValueError):
        return ''
    if m >= 1440 and m % 1440 == 0:
        d = m // 1440
        return '1 天' if d == 1 else '%d 天' % d
    if m >= 60 and m % 60 == 0:
        h = m // 60
        return '1 小时' if h == 1 else '%d 小时' % h
    return '%d 分钟' % m


def _truncate_for_title(text, limit=24):
    """系统通知的软截断（标题与正文共用，limit 由调用方按承载位传）。

    系统通知没有 CSS 省略号，过长内容会把通知撑爆；前端 Toast 另有 CSS truncate 兜底。
    标题档 limit=24（子任务名）；正文档 limit=80（任务详情描述）。
    """
    t = (text or '').strip()
    return t if len(t) <= limit else t[:limit - 1] + '…'


def _list_prefix(list_id, data):
    """清单名前缀：非默认清单返回 '清单名 | '，否则空串。"""
    list_name = ''
    for lst in (data.get('taskLists') or []):
        if lst.get('id') == list_id:
            list_name = lst.get('name', '')
            break
    if list_name and list_name != '默认':
        return list_name + ' | '
    return ''

pomodoro_state = {
    "running": False,
    "state": "idle",  # idle | focusing | pause | resting | completed
    "phase": "focus",
    "startedAt": None,
    "originalStartedAt": None,  # 首次开始时间，Pause/Resume不重置
    "totalDuration": 0,
    "accumulatedTime": 0,  # Tick-based累加器：已累计的有效秒数
    "totalFocusedSeconds": 0,  # 跨暂停/恢复周期的总专注秒数（resume时从accumulatedTime转入）
    "currentTaskId": None,
    "completedPomodoros": 0,
    "continuousTomatoCount": 0,
    "focusDuration": 25,
    "shortBreakDuration": 5,
    "longBreakDuration": 15,
    "longBreakInterval": 4,
    "breakDuration": 5,
    "autoBreak": False,
    "autoFocus": False,
    "taskName": "",
    "lastTickTime": None,  # 最后一次Tick时间戳（ISO格式）
    "lastUserActivityAt": None,  # 最后一次用户活跃时间戳（ISO格式）
    "timeLeft": 0,  # 暂停时保存的剩余秒数
}
pomodoro_lock = threading.Lock()
pomodoro_notified = False
_data_version = 0

pending_notifications = []
pending_notifications_lock = threading.Lock()

# 平台检测
IS_WINDOWS = sys.platform == 'win32' or os.name == 'nt'

# 文件锁：Linux（银河麒麟等）优先使用 fcntl，Windows 开发环境使用 msvcrt
try:
    import fcntl
    HAS_FCNTL = True
except ImportError:
    HAS_FCNTL = False

try:
    import msvcrt
    HAS_MSVCRT = True
except ImportError:
    HAS_MSVCRT = False

def acquire_file_lock():
    lock_fd = open(LOCK_FILE, 'w')
    if HAS_FCNTL:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
        except Exception:
            pass
    elif HAS_MSVCRT:
        try:
            msvcrt.locking(lock_fd.fileno(), msvcrt.LK_LOCK, 1)
        except Exception:
            pass
    return lock_fd

def release_file_lock(lock_fd):
    if HAS_FCNTL:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
        except Exception:
            pass
    elif HAS_MSVCRT:
        try:
            msvcrt.locking(lock_fd.fileno(), msvcrt.LK_UNLCK, 1)
        except Exception:
            pass
    lock_fd.close()

def load_data_from_file():
    lock_fd = acquire_file_lock()
    try:
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for key in DEFAULT_DATA:
                    if key not in data:
                        data[key] = DEFAULT_DATA[key]
                # 确保 taskLists 非空（至少包含默认清单）
                if not data.get('taskLists'):
                    data['taskLists'] = DEFAULT_DATA['taskLists']
                # 确保 settings 包含 defaultListId
                if not data.get('settings'):
                    data['settings'] = dict(DEFAULT_DATA['settings'])
                elif 'defaultListId' not in data['settings']:
                    data['settings']['defaultListId'] = 'default'
                return data
        else:
            return json.loads(json.dumps(DEFAULT_DATA))
    except Exception as e:
        print("Error loading data: %s" % str(e))
        return json.loads(json.dumps(DEFAULT_DATA))
    finally:
        release_file_lock(lock_fd)

def save_data_to_file(data):
    lock_fd = acquire_file_lock()
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("Error saving data: %s" % str(e))
    finally:
        release_file_lock(lock_fd)

def _bump_data_version():
    """服务端写盘后抬高 _data_version。

    客户端全量 PUT /api/data 依据版本号做冲突检测；若服务端自行写盘
    （番茄历史、连续番茄数等）不抬高版本号，携带旧版本号的客户端 PUT
    会通过一致性检查，用内存里的旧 pomodoroHistory 直接覆盖服务端刚
    写入的专注记录（丢更新），且其他标签页因版本号未变跳过刷新，
    永远看不到新记录。"""
    global _data_version
    _data_version += 1

def _migrate_pomodoro_archive_into_main(data):
    """一次性迁移：把旧机制 pomodoro_archive/ 目录中的归档专注记录并回 data.json 主列表。

    旧机制在专注记录超过 500 条时把更早的记录移入按月归档文件，但应用界面
    （历史记录/专注概况）从不读取归档，等于旧记录"看不见"。现专注记录全量
    持久化于 data.json，启动时执行本迁移，按与主列表一致的 startedAt+taskId
    组合去重合并；合并成功的归档文件随即删除（data.json 即唯一持久化载体，
    导出/备份天然包含全部记录）。仅在 main() 启动阶段单线程调用。"""
    if not os.path.isdir(ARCHIVE_DIR):
        return 0
    try:
        archive_files = [f for f in os.listdir(ARCHIVE_DIR)
                        if f.startswith('pomodoro_archive_') and f.endswith('.json')]
    except Exception as e:
        print("List pomodoro archive error: %s" % str(e))
        return 0
    if not archive_files:
        return 0
    history = data.setdefault('pomodoroHistory', [])
    existing_keys = set((h.get('startedAt', ''), h.get('taskId')) for h in history)
    merged = 0
    for fname in archive_files:
        fp = os.path.join(ARCHIVE_DIR, fname)
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                entries = json.load(f)
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                key = (entry.get('startedAt', ''), entry.get('taskId'))
                if key in existing_keys:
                    continue
                history.append(entry)
                existing_keys.add(key)
                merged += 1
            # 该文件所有记录已并入主列表（或本就是重复记录），删除避免重复迁移
            os.remove(fp)
        except Exception as e:
            print("Migrate pomodoro archive error (%s): %s" % (fname, str(e)))
    if merged > 0:
        # 按开始时间恢复时间序（归档记录比主列表现有记录更早，append 会打乱顺序）
        history.sort(key=lambda h: h.get('startedAt') or '')
        try:
            save_data_to_file(data)
        except Exception as e:
            print("Save migrated pomodoro history error: %s" % str(e))
        print("Migrated %d archived pomodoro records into main history" % merged)
    return merged

def collect_extended_backup_fields():
    """收集导出/备份所需的扩展数据：归档专注历史 + 节假日数据 + 背景轮播配置。

    返回 dict，可直接合并进导出对象：
    - pomodoroArchive: { "YYYYMM": [entries...] }（无归档时为 {}）
    - holidayData: 节假日数据（无文件时为 {}）
    - bgCarousel: 背景图轮播用户配置（enabled/directory/interval/intervalUnit/order，
      不含服务端运行时进度；无配置时为 {}）
    """
    result = {'pomodoroArchive': {}, 'holidayData': {}, 'bgCarousel': {}}
    # 归档专注历史（按月文件）
    try:
        if os.path.isdir(ARCHIVE_DIR):
            for fname in sorted(os.listdir(ARCHIVE_DIR)):
                if not fname.startswith('pomodoro_archive_') or not fname.endswith('.json'):
                    continue
                month_key = fname[len('pomodoro_archive_'):-len('.json')]
                fp = os.path.join(ARCHIVE_DIR, fname)
                with open(fp, 'r', encoding='utf-8') as f:
                    entries = json.load(f)
                if isinstance(entries, list):
                    result['pomodoroArchive'][month_key] = entries
    except Exception as e:
        print("Collect pomodoro archive error: %s" % str(e))
    # 节假日数据（剔除 _ 开头的元数据键，与 /api/holiday-data 读取一致）
    try:
        holiday_file = os.path.join(DIRECTORY, 'holiday_data.json')
        if os.path.exists(holiday_file):
            with open(holiday_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                result['holidayData'] = {k: v for k, v in data.items() if not k.startswith('_')}
    except Exception as e:
        print("Collect holiday data error: %s" % str(e))
    # 背景图轮播配置（独立持久化于 bg_carousel.json，不在 data.json 内）
    try:
        with bg_carousel_lock:
            for key in ('enabled', 'directory', 'interval', 'intervalUnit', 'order'):
                if key in bg_carousel_state:
                    result['bgCarousel'][key] = bg_carousel_state[key]
    except Exception as e:
        print("Collect bg carousel config error: %s" % str(e))
    return result

def restore_extended_backup_fields(data):
    """还原导出/备份中的扩展数据：归档专注历史合并回 data.json 主列表，节假日数据写回独立文件，
    背景轮播配置写回 bg_carousel.json。

    - pomodoroArchive: 旧版备份的扩展字段（超出保留上限的归档记录），现全量
      保存在主列表，导入时与现有主列表按 startedAt+taskId 去重合并
      （导入不覆盖、不丢本地已有记录），保证界面可见
    - holidayData: 整体写入 holiday_data.json（节假日数据以导入文件为准）
    - bgCarousel: 用户配置写入轮播状态表（旧备份无此字段时保持现状不动）。
      目录路径不做存在性校验（备份可能来自另一台机器，目录缺失时由轮播
      状态机进入 empty_directory 错误态并在设置面板提示，用户可重新选择）
    """
    # 归档专注历史
    archive = data.get('pomodoroArchive')
    if isinstance(archive, dict) and archive:
        try:
            file_data = load_data_from_file()
            history = file_data.setdefault('pomodoroHistory', [])
            existing_keys = set((h.get('startedAt', ''), h.get('taskId')) for h in history)
            for month_key, entries in archive.items():
                if not isinstance(entries, list) or not entries:
                    continue
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    key = (entry.get('startedAt', ''), entry.get('taskId'))
                    if key not in existing_keys:
                        history.append(entry)
                        existing_keys.add(key)
            save_data_to_file(file_data)
        except Exception as e:
            print("Restore pomodoro archive error: %s" % str(e))
    # 节假日数据
    holiday = data.get('holidayData')
    if isinstance(holiday, dict) and holiday:
        try:
            holiday_file = os.path.join(DIRECTORY, 'holiday_data.json')
            with open(holiday_file, 'w', encoding='utf-8') as f:
                json.dump(holiday, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print("Restore holiday data error: %s" % str(e))
    # 背景图轮播配置
    carousel = data.get('bgCarousel')
    if isinstance(carousel, dict) and carousel:
        try:
            with bg_carousel_lock:
                if 'directory' in carousel:
                    bg_carousel_state['directory'] = str(carousel.get('directory') or '').strip()
                if 'enabled' in carousel:
                    bg_carousel_state['enabled'] = bool(carousel.get('enabled'))
                if 'interval' in carousel:
                    try:
                        bg_carousel_state['interval'] = max(1, min(365, int(carousel.get('interval', 30))))
                    except (TypeError, ValueError):
                        bg_carousel_state['interval'] = 30
                if carousel.get('intervalUnit') in BG_CAROUSEL_UNIT_SECONDS:
                    bg_carousel_state['intervalUnit'] = carousel['intervalUnit']
                if carousel.get('order') in ('sequential', 'random'):
                    bg_carousel_state['order'] = carousel['order']
                if bg_carousel_state.get('enabled') and bg_carousel_state.get('directory'):
                    # 启用态导入：立即从导入目录选图并起播（运行时进度不跨机器还原）
                    _bg_carousel_advance_locked()
                else:
                    _bg_carousel_save_locked()
        except Exception as e:
            print("Restore bg carousel config error: %s" % str(e))

# ==================== 导出 / 备份（单一内容来源 + zip 打包附件） ====================
# 背景：导出（用户主动下载）与服务端备份（自动/重置前）曾是两套实现，
# POST /api/backup 漏掉了扩展字段，导致"自动备份恢复后归档专注历史/节假日/
# 轮播配置丢失"。现统一由 build_export_payload() 构造内容，export 与 backup
# 只是"投递方式"不同。
# 附件（FR-06）二进制不在 data.json 内，此前完全不进备份包；现改为 zip：
#   schedule-backup-YYYY-MM-DD.zip
#   ├── data.json                 （与 JSON 导出内容完全一致）
#   └── attachments/<taskId>/<fileId>_<name>
EXPORT_FORMAT_VERSION = '4.0'
# 导入包体积上限：附件单文件 20MB，留足多任务空间；同时避免异常包耗尽内存
IMPORT_MAX_BYTES = 512 * 1024 * 1024
EXPORT_ZIP_NAME = 'schedule-backup-%s.zip'


def build_export_payload():
    """构造导出/备份的完整数据对象 —— 唯一来源，export 与 backup 不得各自拼装。"""
    export_data = dict(load_data_from_file())
    export_data.update(collect_extended_backup_fields())
    export_data['version'] = EXPORT_FORMAT_VERSION
    export_data['exportDate'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    return export_data


def iter_attachment_files():
    """遍历附件目录，产出 (arcname, filepath)；arcname 固定 attachments/<taskId>/<file>。"""
    if not os.path.isdir(ATTACHMENT_DIR):
        return
    for task_id in sorted(os.listdir(ATTACHMENT_DIR)):
        folder = os.path.join(ATTACHMENT_DIR, task_id)
        if not os.path.isdir(folder):
            continue
        safe_task = attachment_safe_id(task_id)
        if not safe_task:
            continue
        for fname in sorted(os.listdir(folder)):
            fp = os.path.join(folder, fname)
            if os.path.isfile(fp):
                yield 'attachments/%s/%s' % (safe_task, fname), fp


def write_export_zip(zip_path, export_data):
    """把导出数据与全部任务附件写成一个 zip。

    附件一律 STORED（图片/PDF/office 本身已压缩，重复 deflate 只增加耗时）；
    data.json 单独 DEFLATED。返回 (附件文件数, 附件原始字节数)。
    """
    count = 0
    total = 0
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED, allowZip64=True) as zf:
        zf.writestr('data.json', json.dumps(export_data, ensure_ascii=False, indent=2),
                    compress_type=zipfile.ZIP_DEFLATED)
        for arcname, fp in iter_attachment_files():
            try:
                zf.write(fp, arcname)
                count += 1
                total += os.path.getsize(fp)
            except OSError as e:
                # 单个附件读失败不阻断整包导出（例如被其他进程占用）
                print("Skip attachment in export: %s (%s)" % (fp, str(e)))
    return count, total


def build_export_zip_tempfile(export_data):
    """生成临时 zip 文件并返回路径；调用方负责 os.remove。"""
    fd, path = tempfile.mkstemp(prefix='tacklist-export-', suffix='.zip')
    os.close(fd)
    try:
        write_export_zip(path, export_data)
    except Exception:
        try:
            os.remove(path)
        except OSError:
            pass
        raise
    return path


def create_backup_file():
    """生成一份完整备份（zip：data.json + attachments/），返回文件名。

    GET /api/backup 与 POST /api/backup 共用 —— 两条路径曾各自实现，
    POST 版漏了扩展字段，导致自动备份恢复后丢归档专注历史/节假日/轮播配置。
    """
    export_data = build_export_payload()
    if not os.path.exists(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    filename = 'schedule-backup-%s.zip' % stamp
    filepath = os.path.join(BACKUP_DIR, filename)
    # 同一秒内重复触发（手动 + 自动备份撞车）时加序号，不覆盖既有备份
    seq = 1
    while os.path.exists(filepath):
        filename = 'schedule-backup-%s-%d.zip' % (stamp, seq)
        filepath = os.path.join(BACKUP_DIR, filename)
        seq += 1
    write_export_zip(filepath, export_data)
    return filename


# ==================== 导入（JSON / zip 共用核心） ====================
# 导入是"全量还原"语义：data.json 整体覆盖，附件目录整体替换。
# 破坏性操作的顺序刻意设计为：先在临时目录解压并校验 → 再替换，
# 校验失败时磁盘上不产生任何改动。
IMPORT_ATTACHMENT_PREFIX = 'attachments/'


def sanitize_import_settings(settings_obj):
    """导入时保留本机专属配置，避免跨机覆盖。

    - port / bindAddress 属设备级：A 机的端口带过来会让设置面板与实际监听不一致；
    - _lastBackupDate 属本机运行时状态：带过来会让「距上次备份 N 天」误判为刚备份过，
      导致换机后长期不再自动备份（删掉最多多备份一次，代价远小于漏备份）。
      `_backupEnabledDate` 只影响「启用当天不备份」一个判断，保留原值即可。
    """
    if not isinstance(settings_obj, dict):
        return settings_obj
    try:
        current = (load_data_from_file().get('settings') or {})
    except Exception:
        current = {}
    for key in ('port', 'bindAddress'):
        if key in current:
            settings_obj[key] = current[key]
        else:
            settings_obj.pop(key, None)
    settings_obj.pop('_lastBackupDate', None)
    return settings_obj


def validate_import_payload(data):
    """结构校验：tasks / taskLists 允许为空数组（空数据集的备份同样合法）。"""
    if not isinstance(data, dict):
        return False, 'Invalid data format'
    has_tasks = isinstance(data.get('tasks'), list)
    has_lists = isinstance(data.get('taskLists'), list) or isinstance(data.get('lists'), list)
    if not (has_tasks or has_lists):
        return False, 'Invalid data format'
    return True, None


def apply_import_payload(data):
    """把导入数据落到 data.json 与各扩展文件；返回 (ok, error)。"""
    ok, err = validate_import_payload(data)
    if not ok:
        return False, err
    # 剥离扩展字段后写入 data.json；扩展字段单独还原到各自文件/目录。
    # 同时剔除导出时附加的元数据键（version/exportDate），避免污染 data.json
    main_data = {k: v for k, v in data.items()
                 if k not in ('pomodoroArchive', 'holidayData', 'bgCarousel',
                              'version', 'exportDate')}
    if isinstance(main_data.get('settings'), dict):
        sanitize_import_settings(main_data['settings'])
    # 持锁写盘并抬高版本号：与其他标签页的版本检查互斥，防止导入后
    # 被携带旧版本号的全量 PUT 覆盖（与 PUT /api data 的锁序一致）
    with data_lock:
        save_data_to_file(main_data)
        _bump_data_version()
    # 服务端内存番茄配置同步：PUT /api/data 有此逻辑，导入此前遗漏，
    # 会让后台 tick 继续按旧时长判断 autoBreak / autoFocus
    s = main_data.get('settings') or {}
    with pomodoro_lock:
        pomodoro_state['focusDuration'] = s.get('focusDuration', pomodoro_state.get('focusDuration', 25))
        pomodoro_state['shortBreakDuration'] = s.get('shortBreakDuration', pomodoro_state.get('shortBreakDuration', 5))
        pomodoro_state['longBreakDuration'] = s.get('longBreakDuration', pomodoro_state.get('longBreakDuration', 15))
        pomodoro_state['longBreakInterval'] = s.get('longBreakInterval', pomodoro_state.get('longBreakInterval', 4))
        pomodoro_state['autoBreak'] = s.get('autoBreak', pomodoro_state.get('autoBreak', False))
        pomodoro_state['autoFocus'] = s.get('autoFocus', pomodoro_state.get('autoFocus', False))
    restore_extended_backup_fields(data)
    return True, None


def replace_attachment_dir(new_dir):
    """用 new_dir 整体替换 ATTACHMENT_DIR（先备份旧目录，失败回滚）。"""
    backup_dir = ATTACHMENT_DIR + '.bak'
    if os.path.isdir(backup_dir):
        shutil.rmtree(backup_dir, ignore_errors=True)
    had_old = os.path.isdir(ATTACHMENT_DIR)
    if had_old:
        os.replace(ATTACHMENT_DIR, backup_dir)
    try:
        os.replace(new_dir, ATTACHMENT_DIR)
    except Exception:
        # 替换失败：把旧目录放回去，避免导入半途丢失全部附件
        if had_old and not os.path.isdir(ATTACHMENT_DIR):
            try:
                os.replace(backup_dir, ATTACHMENT_DIR)
            except Exception:
                pass
        raise
    if had_old:
        shutil.rmtree(backup_dir, ignore_errors=True)


def import_from_zip(zip_path):
    """解析导入 zip（data.json + attachments/），返回 (ok, error)。

    安全性：只接受根目录 data.json 与 attachments/<safeId>/<file> 三类成员，
    其余（__MACOSX、绝对路径、.. 穿越、多级目录）一律忽略，绝不按成员名拼盘符。
    """
    try:
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            if 'data.json' not in names:
                return False, 'data.json not found in zip'
            att_members = []
            for name in names:
                norm = name.replace('\\', '/')
                if norm == 'data.json' or norm.endswith('/'):
                    continue
                parts = norm.split('/')
                if len(parts) != 3 or parts[0] != 'attachments':
                    continue
                task_id = attachment_safe_id(parts[1])
                fname = attachment_safe_name(parts[2])
                if not task_id or not fname or parts[2] in ('.', '..'):
                    continue
                att_members.append((name, task_id, fname))
            try:
                data = json.loads(zf.read('data.json').decode('utf-8'))
            except Exception:
                return False, 'Invalid data.json in zip'
            ok, err = validate_import_payload(data)
            if not ok:
                return False, err
            # 解压到临时目录（与 attachments 同盘，os.replace 才是原子 rename）
            tmp_root = tempfile.mkdtemp(prefix='.import-attachments-', dir=DIRECTORY)
            tmp_att = os.path.join(tmp_root, 'attachments')
            os.makedirs(tmp_att, exist_ok=True)
            try:
                for name, task_id, fname in att_members:
                    folder = os.path.join(tmp_att, task_id)
                    os.makedirs(folder, exist_ok=True)
                    with zf.open(name) as src, open(os.path.join(folder, fname), 'wb') as dst:
                        shutil.copyfileobj(src, dst, 256 * 1024)
            except Exception as e:
                shutil.rmtree(tmp_root, ignore_errors=True)
                return False, 'Extract attachments failed: %s' % str(e)
    except zipfile.BadZipFile:
        return False, 'Not a valid zip file'
    except Exception as e:
        return False, 'Read zip failed: %s' % str(e)

    try:
        ok, err = apply_import_payload(data)
        if not ok:
            shutil.rmtree(tmp_root, ignore_errors=True)
            return False, err
        # 数据已落盘，再替换附件目录（顺序不可颠倒：数据失败时不毁附件）
        replace_attachment_dir(tmp_att)
        shutil.rmtree(tmp_root, ignore_errors=True)
        return True, None
    except Exception as e:
        shutil.rmtree(tmp_root, ignore_errors=True)
        return False, 'Import failed: %s' % str(e)


# ==================== WebDAV 手动同步 ====================
# 使用场景：电脑与手机各自运行一份本系统，两端配置同一个 WebDAV 地址（坚果云、
# Nextcloud 等），在设置面板手动「上传到云端 / 从云端下载」即可完成数据同步。
# 凭据单独保存在 webdav_config.json，不写入 data.json，
# 避免账号密码随数据导出/导入在设备间扩散。
WEBDAV_CONFIG_FILE = os.path.join(DIRECTORY, 'webdav_config.json')
WEBDAV_TIMEOUT = 20
WEBDAV_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024  # 云端数据下载上限，避免异常大文件耗尽内存

webdav_lock = threading.Lock()


def load_webdav_config():
    """读取 WebDAV 配置；文件不存在或损坏时返回空 dict。"""
    try:
        if os.path.exists(WEBDAV_CONFIG_FILE):
            with open(WEBDAV_CONFIG_FILE, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            return cfg if isinstance(cfg, dict) else {}
    except Exception as e:
        print("Load webdav config error: %s" % str(e))
    return {}


def save_webdav_config(cfg):
    tmp_file = WEBDAV_CONFIG_FILE + '.tmp'
    try:
        with open(tmp_file, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp_file, WEBDAV_CONFIG_FILE)
        return True
    except Exception as e:
        try:
            if os.path.exists(tmp_file):
                os.remove(tmp_file)
        except OSError:
            pass
        print("Save webdav config error: %s" % str(e))
        return False


def _encode_webdav_password(p):
    """base64 编码后存储，避免配置文件里出现明文密码（仅混淆，不是加密）。"""
    import base64
    return 'b64:' + base64.b64encode(p.encode('utf-8')).decode('ascii')


def _get_webdav_password(cfg):
    p = cfg.get('password') or ''
    if p.startswith('b64:'):
        import base64
        try:
            return base64.b64decode(p[4:]).decode('utf-8')
        except Exception:
            return ''
    return p


def _webdav_auth_header(username, password):
    import base64
    token = base64.b64encode(('%s:%s' % (username or '', password or '')).encode('utf-8')).decode('ascii')
    return 'Basic ' + token


def _webdav_ssl_context(allow_insecure=False):
    """SSL 上下文：默认严格校验证书；自签证书需用户显式允许不安全连接。"""
    import ssl
    ctx = ssl.create_default_context()
    if allow_insecure:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _webdav_request(method, url, username, password, data=None, timeout=WEBDAV_TIMEOUT,
                    content_type=None, allow_insecure=False, max_bytes=None):
    """发送 WebDAV 请求，返回 (status, payload)。

    GET/PUT 时 payload 为响应体 bytes；HEAD 时 payload 为响应头。
    HTTP 明文与自签证书默认拒绝，需配置 allowInsecure 显式放行。
    4xx/5xx 由 urllib 抛 HTTPError，交由调用方按状态码转为可读提示。
    """
    if urllib.parse.urlparse(url).scheme.lower() == 'http' and not allow_insecure:
        raise ValueError('HTTP 地址会明文传输凭据；如确需使用请在 WebDAV 设置中勾选「允许不安全连接」')
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', _webdav_auth_header(username, password))
    if data is not None:
        req.add_header('Content-Type', content_type or 'application/json; charset=utf-8')
        req.add_header('Content-Length', str(len(data)))
    with urllib.request.urlopen(req, timeout=timeout,
                                context=_webdav_ssl_context(allow_insecure)) as resp:
        if method == 'HEAD':
            return resp.status, resp.headers
        if max_bytes is not None:
            length = resp.headers.get('Content-Length')
            if length is not None:
                try:
                    too_large = int(length) > max_bytes
                except ValueError:
                    too_large = False
                if too_large:
                    raise ValueError('云端文件超过 %d MB 上限' % (max_bytes // (1024 * 1024)))
            payload = resp.read(max_bytes + 1)
            if len(payload) > max_bytes:
                raise ValueError('云端文件超过 %d MB 上限' % (max_bytes // (1024 * 1024)))
            return resp.status, payload
        return resp.status, resp.read()


def webdav_test_connection(cfg):
    """用表单里的临时值测试连通性，无需先保存配置。

    GET 目标文件：200=可读写且文件已存在，404=地址可达但文件尚未创建，401=认证失败。
    """
    url = (cfg.get('url') or '').strip()
    if not url:
        return {'ok': False, 'message': '请先填写 WebDAV 地址'}
    try:
        status, _ = _webdav_request('GET', url, cfg.get('username') or '',
                                    cfg.get('password') or '', timeout=10,
                                    allow_insecure=bool(cfg.get('allowInsecure')),
                                    max_bytes=WEBDAV_MAX_DOWNLOAD_BYTES)
        if status == 200:
            return {'ok': True, 'message': '连接成功，云端文件已存在，可执行上传或下载'}
        return {'ok': False, 'message': '连接异常：返回 HTTP %d' % status}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {'ok': True, 'message': '连接成功（云端尚无该文件，首次上传会自动创建）'}
        if e.code == 401:
            return {'ok': False, 'message': '认证失败（HTTP 401）：请检查用户名与应用密码'}
        if e.code == 403:
            return {'ok': False, 'message': '访问被拒绝（HTTP 403）：请检查账号与该目录的权限'}
        return {'ok': False, 'message': '连接失败（HTTP %d）' % e.code}
    except Exception as e:
        return {'ok': False, 'message': '连接失败：%s（%s）' % (str(e), type(e).__name__)}


def webdav_probe_cloud(cfg):
    """轻量探测云端文件，返回 (reachable, exists, last_modified, error)。"""
    url = (cfg.get('url') or '').strip()
    username = cfg.get('username') or ''
    password = _get_webdav_password(cfg)
    if not url or not username or not password:
        return None, None, None, None
    try:
        status, headers = _webdav_request('HEAD', url, username, password, timeout=8,
                                          allow_insecure=bool(cfg.get('allowInsecure')))
        modified = None
        try:
            modified = headers.get('Last-Modified')
        except Exception:
            pass
        return True, (status == 200), modified, None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return True, False, None, None
        if e.code == 401:
            return False, None, None, '认证失败（HTTP 401）'
        return True, None, None, 'HTTP %d' % e.code
    except Exception as e:
        return False, None, None, str(e)


def _webdav_touch_sync_state(key, probe_state=None):
    """记录最近一次上传/下载时间，便于在设置面板展示同步状态。

    probe_state 用于顺手刷新主视图「同步」入口的配色缓存：刚完成上传/下载后
    两端即视为已同步，避免下次打开页面仍显示「待上传 / 待下载」。
    """
    try:
        cfg = load_webdav_config()
        if not cfg:
            return
        cfg[key] = datetime.now().astimezone().isoformat(timespec='seconds')
        if probe_state:
            cfg['lastProbeState'] = probe_state
            cfg['lastProbeAt'] = cfg[key]
        save_webdav_config(cfg)
    except Exception as e:
        print("Webdav sync state error: %s" % str(e))


def _webdav_cache_probe_state(state):
    """缓存最近一次联网探测结果，供主视图「同步」入口在不联网时显示配色。"""
    try:
        with webdav_lock:
            cfg = load_webdav_config()
            if not cfg or cfg.get('lastProbeState') == state:
                return
            cfg['lastProbeState'] = state
            cfg['lastProbeAt'] = datetime.now().astimezone().isoformat(timespec='seconds')
            save_webdav_config(cfg)
    except Exception as e:
        print("Cache webdav probe state error: %s" % str(e))


def _webdav_parse_time(value, http_date=False):
    """解析 WebDAV 同步时间；失败返回 None。HTTP 头按 RFC 1123，ISO 时间按本地/带时区处理。"""
    if not value:
        return None
    try:
        if http_date:
            from email.utils import parsedate_to_datetime
            dt = parsedate_to_datetime(value)
        else:
            dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc) if http_date else dt.astimezone()
        return dt
    except Exception:
        return None


def _webdav_sync_state(local_modified, cloud_modified, cfg):
    """结合文件时间与最近一次上传/下载时间判定同步状态。

    仅比较 mtime 会在刚上传（云端比本地新）或刚下载（本地比云端新）后给出相反建议，
    因此用 lastPushAt / lastPullAt 判断「当前差异是否正来自最近一次同步动作」。
    """
    t_local = _webdav_parse_time(local_modified)
    t_cloud = _webdav_parse_time(cloud_modified, http_date=True)
    if not t_local or not t_cloud:
        return 'unknown'
    diff = (t_cloud - t_local).total_seconds()
    last_push = _webdav_parse_time(cfg.get('lastPushAt'))
    last_pull = _webdav_parse_time(cfg.get('lastPullAt'))
    last_action = None
    if last_push and (not last_pull or last_push >= last_pull):
        last_action = ('push', last_push)
    elif last_pull:
        last_action = ('pull', last_pull)
    if last_action:
        kind, t = last_action
        if kind == 'push':
            # 刚上传：云端 mtime 不晚于本次推送（部分服务会保留原 mtime），且本地推送后没有新的保存
            if (t_cloud <= t + timedelta(seconds=5)
                    and t_local <= t + timedelta(seconds=1)):
                return 'in-sync'
        else:
            # 刚下载：本地 mtime 由本次写盘产生，且云端在下载后没有新的更新
            if (t_local <= t + timedelta(seconds=1)
                    and t_local >= t - timedelta(seconds=120)
                    and t_cloud <= t + timedelta(seconds=5)):
                return 'in-sync'
        # 最近一次同步动作之后本地/云端又发生了变化，直接按 mtime 方向判断
        return 'cloud-newer' if diff > 0 else 'local-newer'
    # 没有同步时间记录（旧配置）：退回 60 秒时间接近判定
    if abs(diff) <= 60:
        return 'in-sync'
    return 'cloud-newer' if diff > 0 else 'local-newer'


def webdav_status():
    """设置面板打开时拉取的同步状态（配置、云端文件、本地修改时间）。"""
    with webdav_lock:
        cfg = load_webdav_config()
    url = (cfg.get('url') or '').strip()
    username = (cfg.get('username') or '').strip()
    has_password = bool(cfg.get('password'))
    configured = bool(url and username and has_password)
    local_modified = None
    try:
        if os.path.exists(DATA_FILE):
            local_modified = datetime.fromtimestamp(os.path.getmtime(DATA_FILE)).astimezone().isoformat(timespec='seconds')
    except Exception:
        pass
    reachable, exists, cloud_modified, err = None, None, None, None
    # 未配置完整时不做网络探测，避免打开设置面板无谓等待
    if configured:
        reachable, exists, cloud_modified, err = webdav_probe_cloud(cfg)

    # 规范化状态：前端据此显示色条与徽标（403/5xx 不再被误判为“云端文件不存在”）
    state = 'unconfigured'
    if configured:
        if reachable is False:
            state = 'auth-error' if (err and ('401' in err or '认证' in err)) else 'connect-error'
        elif reachable is True:
            if exists is None:
                state = 'http-error'
            elif exists is False:
                state = 'cloud-missing'
            elif exists is True:
                state = _webdav_sync_state(local_modified, cloud_modified, cfg)

    if configured:
        # 缓存探测结果，供主视图「同步」入口免联网显示配色
        _webdav_cache_probe_state(state)

    return {
        'configured': configured,
        'config': {'url': url, 'username': username, 'hasPassword': has_password,
                   'allowInsecure': bool(cfg.get('allowInsecure'))},
        'cloudReachable': reachable,
        'cloudExists': exists,
        'cloudModified': cloud_modified,
        'localModified': local_modified,
        'lastPushAt': cfg.get('lastPushAt'),
        'lastPullAt': cfg.get('lastPullAt'),
        'message': err,
        'state': state,
    }


def webdav_config_summary():
    """主视图「同步」入口使用的轻量状态：只读本地配置，不联网探测。

    与 webdav_status 的区别：不访问云端，响应在毫秒级，可随页面加载调用；
    颜色所需的 state 取自上次探测的缓存值，真正联网探测由展开面板时另行触发。
    """
    with webdav_lock:
        cfg = load_webdav_config()
    url = (cfg.get('url') or '').strip()
    username = (cfg.get('username') or '').strip()
    has_password = bool(cfg.get('password'))
    configured = bool(url and username and has_password)
    return {
        'configured': configured,
        'lastPushAt': cfg.get('lastPushAt'),
        'lastPullAt': cfg.get('lastPullAt'),
        'cachedState': (cfg.get('lastProbeState') or '') if configured else 'unconfigured',
        'lastProbeAt': cfg.get('lastProbeAt'),
    }


# ---------- 日程提醒 .ics（上传到 WebDAV 同目录，供手机日历订阅） ----------

def _ics_escape(text):
    """转义 ICS 文本字段中的特殊字符。"""
    if text is None:
        return ''
    s = str(text).replace('\r\n', '\n').replace('\r', '\n')
    return s.replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\n', '\\n')


def _ics_local_date_parts(iso_str):
    """把 UTC ISO 时间转成本地日期 (Y, M, D, datetime)。

    全天任务在数据里存的是 UTC 16:00（= 北京次日 00:00），必须用本地时间取日期。
    """
    try:
        dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00')).astimezone()
        return dt.year, dt.month, dt.day, dt
    except Exception:
        return None


def _ics_fmt_utc_dt(dt):
    """datetime -> ICS UTC 时间（带 Z），由日历客户端换算到设备本地时区。"""
    return dt.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def _ics_fmt_date(y, m, d):
    return '%04d%02d%02d' % (y, m, d)


def _ics_fold_line(line):
    """按 RFC 5545 将超过 75 字节的逻辑行折行；续行以一个空格开头。"""
    if len(line.encode('utf-8')) <= 75:
        return line
    parts = []
    current = ''
    for ch in line:
        candidate = current + ch
        if len(candidate.encode('utf-8')) > 75:
            parts.append(current)
            current = ' ' + ch
        else:
            current = candidate
    if current:
        parts.append(current)
    return '\r\n'.join(parts)


def _ics_reminder_values(task):
    """读取任务的全部提前提醒分钟数（兼容旧的单值 reminder 字段）。"""
    values = []
    raw = task.get('reminders')
    if isinstance(raw, list):
        for v in raw:
            try:
                n = int(v)
            except Exception:
                continue
            if n > 0 and n not in values:
                values.append(n)
    if not values:
        try:
            n = int(task.get('reminder') or 0)
        except Exception:
            n = 0
        if n > 0:
            values = [n]
    return values


def _ics_append_alarm(lines, title, minutes):
    lines.append('BEGIN:VALARM')
    lines.append('ACTION:DISPLAY')
    lines.append('DESCRIPTION:%s' % _ics_escape(title))
    lines.append('TRIGGER:%s' % (('-PT%dM' % minutes) if minutes > 0 else 'PT0M'))
    lines.append('END:VALARM')


def _ics_uid(task):
    """稳定 UID：用任务 id，保证每次重新生成对应同一个事件（更新而非重复）。"""
    return '%s@tacklist' % (task.get('id') or 'task')


def _ics_dtstamp():
    return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def _build_ics_from_data(data):
    """把任务数据转换成 ICS 日历字符串。

    - 全天任务：DTSTART 用本地日期，DTEND 为次日（ICS 结束日期排他）
    - 定时任务：DTSTART/DTEND 用 UTC 时间（带 Z），由设备按本地时区显示
    - VALARM：按 reminders 数组生成多个提醒；无提前提醒时按任务开始时间提醒
    - 只输出有日期、未完成、未进回收站且非外部订阅的任务
    """
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TackList//Task Reminder//CN',
             'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:TackList 日程提醒']

    tasks = data.get('tasks', []) if isinstance(data, dict) else []
    for t in tasks:
        if t.get('completed') or t.get('deletedAt') or t.get('extSourceId'):
            continue
        iso = t.get('startTime') or t.get('endTime')
        if not iso:
            continue
        parsed = _ics_local_date_parts(iso)
        if not parsed:
            continue
        y, m, d, local_dt = parsed
        is_all_day = bool(t.get('isAllDay'))
        title = t.get('title') or '未命名任务'
        reminders = _ics_reminder_values(t)
        alarm_minutes = reminders if reminders else [0]

        lines.append('BEGIN:VEVENT')
        lines.append('UID:%s' % _ics_uid(t))
        lines.append('DTSTAMP:%s' % _ics_dtstamp())

        if is_all_day:
            lines.append('DTSTART;VALUE=DATE:%s' % _ics_fmt_date(y, m, d))
            next_day = datetime(y, m, d) + timedelta(days=1)
            lines.append('DTEND;VALUE=DATE:%s' % _ics_fmt_date(next_day.year, next_day.month, next_day.day))
        else:
            start_dt = local_dt
            end_parsed = _ics_local_date_parts(t.get('endTime')) if t.get('endTime') else None
            end_dt = end_parsed[3] if end_parsed else None
            if not end_dt or end_dt <= start_dt:
                end_dt = start_dt + timedelta(hours=1)
            lines.append('DTSTART:%s' % _ics_fmt_utc_dt(start_dt))
            lines.append('DTEND:%s' % _ics_fmt_utc_dt(end_dt))

        for minutes in alarm_minutes:
            _ics_append_alarm(lines, title, minutes)

        lines.append('SUMMARY:%s' % _ics_escape(title))
        note = t.get('notes') or t.get('description') or ''
        if note:
            lines.append('DESCRIPTION:%s' % _ics_escape(note))
        lines.append('STATUS:CONFIRMED')
        lines.append('END:VEVENT')

    lines.append('END:VCALENDAR')
    # ICS 规范要求 CRLF 换行，并对超过 75 字节的行折行
    return '\r\n'.join(_ics_fold_line(line) for line in lines) + '\r\n'


def _ics_url_from_data_url(data_url):
    """根据数据文件的 WebDAV URL 推导同目录下 .ics 的 URL。"""
    base = (data_url or '').strip()
    if '?' in base:
        base = base.split('?', 1)[0]
    prefix = base.rsplit('/', 1)[0] if '/' in base else ''
    return prefix + '/tacklist-reminders.ics'


def webdav_push_ics(cfg):
    """生成 .ics 并上传到 WebDAV 同目录，返回 (ok, message)。

    手机端在系统日历里订阅该地址，可把未完成的日程同步进手机日历。
    该步骤失败不影响数据同步结果，仅作为附加提示返回。
    """
    data_url = (cfg.get('url') or '').strip()
    if not data_url:
        return False, '未配置 WebDAV 地址'
    try:
        ics_str = _build_ics_from_data(load_data_from_file())
        ics_url = _ics_url_from_data_url(data_url)
        body = ics_str.encode('utf-8')
        status, _ = _webdav_request('PUT', ics_url, cfg.get('username'),
                                    _get_webdav_password(cfg), data=body,
                                    content_type='text/calendar; charset=utf-8',
                                    allow_insecure=bool(cfg.get('allowInsecure')))
        if 200 <= status < 300:
            return True, '日程提醒日历已更新'
        return False, '日程提醒日历上传失败（HTTP %d）' % status
    except Exception as e:
        return False, '日程提醒日历上传失败：%s' % str(e)


# ---------- 上传 / 下载 ----------

def webdav_push_data(cfg):
    """把本地完整数据（含归档专注历史、节假日、背景轮播配置）上传到云端。"""
    url = (cfg.get('url') or '').strip()
    if not url:
        return {'ok': False, 'message': '未配置 WebDAV 地址，请先保存配置'}
    with webdav_lock:
        data = load_data_from_file()
        export_data = dict(data)
        export_data.update(collect_extended_backup_fields())
        export_data['version'] = '4.0'
        export_data['exportDate'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        body = json.dumps(export_data, ensure_ascii=False).encode('utf-8')
        try:
            status, _ = _webdav_request('PUT', url, cfg.get('username'),
                                        _get_webdav_password(cfg), data=body,
                                        allow_insecure=bool(cfg.get('allowInsecure')))
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return {'ok': False, 'message': '上传失败：认证失败（HTTP 401），请检查用户名与应用密码'}
            if e.code == 409:
                return {'ok': False, 'message': '上传失败（HTTP 409）：请确认 WebDAV 地址中的上级目录已在云端创建'}
            if e.code == 507:
                return {'ok': False, 'message': '上传失败：云端存储空间不足（HTTP 507）'}
            return {'ok': False, 'message': '上传失败（HTTP %d）' % e.code}
        except Exception as e:
            return {'ok': False, 'message': '上传失败：%s（%s）' % (str(e), type(e).__name__)}
        if not (200 <= status < 300):
            return {'ok': False, 'message': '上传失败（HTTP %d）' % status}
        _webdav_touch_sync_state('lastPushAt', 'in-sync')
        ics_ok, ics_msg = webdav_push_ics(cfg)
        msg = '上传成功，云端数据已更新（%d 个任务）' % len(export_data.get('tasks') or [])
        msg += '；' + (ics_msg if ics_ok else '但提醒日历同步失败：%s' % ics_msg)
        return {'ok': True, 'message': msg}


def _webdav_backup_local_before_pull():
    """覆盖前把本地完整数据备份到 backups/，返回备份文件名（失败返回 None）。"""
    try:
        export_data = dict(load_data_from_file())
        export_data.update(collect_extended_backup_fields())
        export_data['version'] = '4.0'
        export_data['exportDate'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        if not os.path.exists(BACKUP_DIR):
            os.makedirs(BACKUP_DIR)
        name = 'pre-webdav-pull-%s.json' % datetime.now().strftime('%Y%m%d-%H%M%S')
        with open(os.path.join(BACKUP_DIR, name), 'w', encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)
        return name
    except Exception as e:
        print("WebDAV pull local backup error: %s" % str(e))
        return None


def webdav_pull_data(cfg):
    """从 WebDAV 下载数据并覆盖本地。

    覆盖前自动把本地数据备份到 backups/，覆盖后抬高数据版本号，
    使其他标签页/客户端在下一次轮询时强制重新渲染。
    """
    global _data_version
    url = (cfg.get('url') or '').strip()
    if not url:
        return {'ok': False, 'message': '未配置 WebDAV 地址，请先保存配置'}
    with webdav_lock:
        try:
            status, raw = _webdav_request('GET', url, cfg.get('username'),
                                          _get_webdav_password(cfg),
                                          allow_insecure=bool(cfg.get('allowInsecure')),
                                          max_bytes=WEBDAV_MAX_DOWNLOAD_BYTES)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return {'ok': False, 'message': '下载失败：认证失败（HTTP 401），请检查用户名与应用密码'}
            if e.code == 404:
                return {'ok': False, 'message': '下载失败：云端文件不存在（HTTP 404），请先在任意一端执行「上传到云端」'}
            return {'ok': False, 'message': '下载失败（HTTP %d）' % e.code}
        except Exception as e:
            return {'ok': False, 'message': '下载失败：%s（%s）' % (str(e), type(e).__name__)}
        if status != 200:
            return {'ok': False, 'message': '下载失败（HTTP %d）' % status}
        try:
            cloud_data = json.loads(raw.decode('utf-8'))
        except Exception:
            return {'ok': False, 'message': '下载失败：云端文件不是有效的 JSON'}
        if not isinstance(cloud_data, dict) or not isinstance(cloud_data.get('tasks'), list):
            return {'ok': False, 'message': '下载失败：云端文件不是有效的 TackList 数据（缺少 tasks 字段）'}

        backup_name = _webdav_backup_local_before_pull()
        if not backup_name:
            return {'ok': False, 'message': '下载中止：覆盖前的本地备份失败，请检查 backups 目录权限与磁盘空间'}
        # 剥离扩展字段与导出元数据后写入 data.json，扩展字段再分别还原到各自文件/缓存
        main_data = {k: v for k, v in cloud_data.items()
                     if k not in ('pomodoroArchive', 'holidayData', 'bgCarousel',
                                  'version', 'exportDate')}
        # 持锁写盘并抬高版本号，防止其他标签页携带旧版本号的全量 PUT 覆盖刚拉取的数据
        with data_lock:
            save_data_to_file(main_data)
            _bump_data_version()
        restore_extended_backup_fields(cloud_data)

        # 番茄时长等设置项同步到服务端内存状态，避免后台 tick 继续沿用旧配置
        s = main_data.get('settings') or {}
        with pomodoro_lock:
            pomodoro_state['focusDuration'] = s.get('focusDuration', pomodoro_state.get('focusDuration', 25))
            pomodoro_state['shortBreakDuration'] = s.get('shortBreakDuration', pomodoro_state.get('shortBreakDuration', 5))
            pomodoro_state['longBreakDuration'] = s.get('longBreakDuration', pomodoro_state.get('longBreakDuration', 15))
            pomodoro_state['longBreakInterval'] = s.get('longBreakInterval', pomodoro_state.get('longBreakInterval', 4))
            pomodoro_state['autoBreak'] = s.get('autoBreak', pomodoro_state.get('autoBreak', False))
            pomodoro_state['autoFocus'] = s.get('autoFocus', pomodoro_state.get('autoFocus', False))

        _webdav_touch_sync_state('lastPullAt', 'in-sync')
        msg = '下载成功，已用云端数据覆盖本地（%d 个任务）' % len(main_data.get('tasks') or [])
        if backup_name:
            msg += '；覆盖前的本地数据已备份为 backups/%s' % backup_name
        return {'ok': True, 'message': msg, 'version': _data_version}


def _save_pomodoro_history_entry(history_entry):
    """保存单条番茄历史记录（去重：startedAt+taskId组合唯一）。

    必须持 data_lock 完成整个读改写事务：与客户端全量 PUT /api data 的
    "版本检查+写盘"互斥，防止交错覆盖。调用方均持有 pomodoro_lock，
    锁序固定为 pomodoro_lock → data_lock（PUT 处理器为先 data_lock 后
    pomodoro_lock 的顺序获取、非嵌套，不构成死锁）。写盘成功后抬高
    版本号，理由见 _bump_data_version。"""
    try:
        with data_lock:
            file_data = load_data_from_file()
            history_list = file_data.setdefault('pomodoroHistory', [])
            started_at = history_entry.get('startedAt', '')
            task_id = history_entry.get('taskId')
            # 拆分记录的startedAt相同但taskId不同，使用组合去重
            is_duplicate = any(
                h.get('startedAt') == started_at and h.get('taskId') == task_id
                for h in history_list
            )
            if not is_duplicate:
                history_list.append(history_entry)
                save_data_to_file(file_data)
                _bump_data_version()
    except Exception as e:
        print("Save pomodoro history error: %s" % str(e))

def _do_pomodoro_complete(split_info=None):
    """服务器内部完成番茄钟：写历史、更新状态。必须在 pomodoro_lock 内调用。"""
    global pomodoro_notified
    current_task_id = pomodoro_state.get('currentTaskId')
    task_name = pomodoro_state.get('taskName', '')
    # 使用 totalFocusedSeconds + accumulatedTime 计算跨暂停/恢复周期的总专注时长
    # accumulatedTime 可能在Tick结束时略超 totalDuration，需截断；totalFocusedSeconds 不截断
    acc = min(pomodoro_state.get('accumulatedTime', 0), pomodoro_state.get('totalDuration', 0))
    total_elapsed = pomodoro_state.get('totalFocusedSeconds', 0) + acc

    if pomodoro_state.get('phase') == 'focus':
        pomodoro_state['continuousTomatoCount'] = pomodoro_state.get('continuousTomatoCount', 0) + 1
        pomodoro_state['completedPomodoros'] = pomodoro_state.get('completedPomodoros', 0) + 1
        # 持久化 continuousTomatoCount 到数据文件（防止服务器重启丢失）
        today_str = datetime.now().strftime('%Y-%m-%d')
        try:
            with data_lock:
                file_data = load_data_from_file()
                file_data['continuousTomatoCount'] = pomodoro_state['continuousTomatoCount']
                file_data['continuousTomatoCountDate'] = today_str
                save_data_to_file(file_data)
                _bump_data_version()
        except Exception as e:
            print("Save continuousTomatoCount error: %s" % str(e))

        now_str = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        original_started = pomodoro_state.get('originalStartedAt')

        # 处理多任务拆分记录
        if split_info and split_info.get('completedTasks'):
            completed_tasks = split_info['completedTasks']
            prev_started_at = original_started
            for task in completed_tasks:
                ended_at = original_started
                if original_started and task.get('elapsedSeconds'):
                    try:
                        orig_dt = datetime.fromisoformat(original_started.replace('Z', '+00:00'))
                        ended_at = (orig_dt + timedelta(seconds=task['elapsedSeconds'])).isoformat().replace('+00:00', 'Z')
                    except Exception:
                        ended_at = original_started
                entry = {
                    "date": now_str,
                    "startedAt": prev_started_at,
                    "endedAt": ended_at,
                    "duration": max(1, round(task.get('durationSeconds', 0) / 60)),
                    "taskName": task.get('taskName', '一般专注'),
                    "taskId": task.get('taskId')
                }
                _save_pomodoro_history_entry(entry)
                prev_started_at = ended_at
            last_task = completed_tasks[-1]
            remaining_seconds = total_elapsed - last_task.get('elapsedSeconds', 0)
            if remaining_seconds > 0:
                entry = {
                    "date": now_str,
                    "startedAt": prev_started_at,
                    "endedAt": now_str,
                    "duration": max(1, round(remaining_seconds / 60)),
                    "taskName": task_name or '一般专注',
                    "taskId": current_task_id
                }
                _save_pomodoro_history_entry(entry)
        elif split_info and split_info.get('completedElapsedSeconds') is not None:
            if current_task_id is None or current_task_id == split_info.get('completedTaskId'):
                split_info = dict(split_info)
                split_info['completedElapsedSeconds'] = None

            if split_info.get('completedElapsedSeconds') is not None:
                completed_seconds = split_info['completedElapsedSeconds']
                remaining_seconds = total_elapsed - completed_seconds
                b_started_at = original_started
                if original_started:
                    try:
                        orig_dt = datetime.fromisoformat(original_started.replace('Z', '+00:00'))
                        b_started_at = (orig_dt + timedelta(seconds=completed_seconds)).isoformat().replace('+00:00', 'Z')
                    except Exception:
                        b_started_at = original_started
                entry1 = {
                    "date": now_str,
                    "startedAt": original_started,
                    "endedAt": b_started_at,
                    "duration": max(1, round(completed_seconds / 60)),
                    "taskName": split_info.get('completedTaskName', '一般专注'),
                    "taskId": split_info.get('completedTaskId')
                }
                entry2 = {
                    "date": now_str,
                    "startedAt": b_started_at,
                    "endedAt": now_str,
                    "duration": max(1, round(remaining_seconds / 60)),
                    "taskName": task_name or '一般专注',
                    "taskId": current_task_id
                }
                _save_pomodoro_history_entry(entry1)
                _save_pomodoro_history_entry(entry2)
            elif split_info.get('completedTaskId'):
                history_entry = {
                    "date": now_str,
                    "startedAt": original_started,
                    "endedAt": now_str,
                    "duration": round(total_elapsed / 60),
                    "taskName": split_info.get('completedTaskName', task_name or '一般专注'),
                    "taskId": split_info.get('completedTaskId')
                }
                _save_pomodoro_history_entry(history_entry)
        elif split_info and split_info.get('completedTaskId'):
            history_entry = {
                "date": now_str,
                "startedAt": original_started,
                "endedAt": now_str,
                "duration": round(total_elapsed / 60),
                "taskName": split_info.get('completedTaskName', task_name or '一般专注'),
                "taskId": split_info.get('completedTaskId')
            }
            _save_pomodoro_history_entry(history_entry)
        else:
            # 正常路径：无拆分
            history_entry = {
                "date": now_str,
                "startedAt": original_started,
                "endedAt": now_str,
                "duration": round(total_elapsed / 60),
                "taskName": task_name or '一般专注',
                "taskId": current_task_id
            }
            _save_pomodoro_history_entry(history_entry)

        # 判定长/短休息
        is_long_break = pomodoro_state['continuousTomatoCount'] % pomodoro_state.get('longBreakInterval', 4) == 0
        if is_long_break:
            pomodoro_state['phase'] = 'longBreak'
            pomodoro_state['breakDuration'] = pomodoro_state.get('longBreakDuration', 15)
        else:
            pomodoro_state['phase'] = 'break'
            pomodoro_state['breakDuration'] = pomodoro_state.get('shortBreakDuration', 5)
        pomodoro_state['state'] = 'completed'
    else:
        # 休息完成
        pomodoro_state['phase'] = 'focus'
        pomodoro_state['state'] = 'idle'

    pomodoro_state['running'] = False
    pomodoro_state['startedAt'] = None
    pomodoro_state['totalDuration'] = 0
    pomodoro_state['accumulatedTime'] = 0
    pomodoro_state['totalFocusedSeconds'] = 0

def parse_iso_datetime(s):
    s = s.replace('Z', '+00:00')
    if '.' in s:
        parts = s.split('.')
        frac_and_tz = parts[1]
        tz_pos = -1
        for i, c in enumerate(frac_and_tz):
            if c in ('+', '-') and i > 0:
                tz_pos = i
                break
        if tz_pos > 0:
            s = parts[0] + '.' + frac_and_tz[:tz_pos][:6] + frac_and_tz[tz_pos:]
        else:
            s = parts[0] + '.' + frac_and_tz[:6]
    return datetime.fromisoformat(s)

def _get_notify_env():
    env = os.environ.copy()
    if 'DISPLAY' not in env:
        env['DISPLAY'] = ':0'
    if 'DBUS_SESSION_BUS_ADDRESS' not in env:
        bus_pid_file = os.path.expanduser('~/.dbus/session-bus/')
        try:
            display = env.get('DISPLAY', ':0').replace(':', '')
            for f in os.listdir(bus_pid_file):
                if display in f:
                    with open(os.path.join(bus_pid_file, f), 'r') as fh:
                        for line in fh:
                            if line.startswith('DBUS_SESSION_BUS_ADDRESS='):
                                env['DBUS_SESSION_BUS_ADDRESS'] = line.split('=', 1)[1].strip().rstrip(';')
                                break
                    break
        except Exception:
            pass
    return env

_notify_env = None

def _send_windows_notify(title, body):
    """Windows平台：使用PowerShell发送Toast通知"""
    try:
        escaped_title = title.replace("'", "''").replace('"', '`"')
        escaped_body = (body or '').replace("'", "''").replace('"', '`"')
        ps_script = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$n = New-Object System.Windows.Forms.NotifyIcon; "
            "$n.Icon = [System.Drawing.SystemIcons]::Information; "
            "$n.Visible = $true; "
            "$n.ShowBalloonTip(10000, '%s', '%s', [System.Windows.Forms.ToolTipIcon]::Info); "
            "Start-Sleep -Seconds 10; "
            "$n.Dispose()" % (escaped_title, escaped_body)
        )
        subprocess.Popen(
            ['powershell', '-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', ps_script],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0
        )
    except Exception:
        pass

def send_notify_send(title, body, task_id=None, category=None, subtask_id=None,
                     reminder_kind=None, reminder_minute=0):
    """发通知（系统通知 + 前端队列）。

    reminder_kind / reminder_minute：提醒类型（ondot 准点 / advance 提前量 / snooze 稍后）
    与提前分钟数。标题里的「· N 分钟后」只服务于系统通知栏（它只有一行标题）；
    应用内 Toast 需要靠这两个字段把时机改放到图标徽标上，标题行保持规整格式。
    """
    global _notify_env
    notif_data = {'title': title, 'body': body or ''}
    if task_id:
        notif_data['taskId'] = task_id
    if subtask_id:
        notif_data['subtaskId'] = subtask_id
    if category:
        notif_data['category'] = category
    if reminder_kind:
        notif_data['reminderKind'] = reminder_kind
        notif_data['reminderMinute'] = int(reminder_minute or 0)
    with pending_notifications_lock:
        # 同类通知覆盖：新通知到达时清除同类的旧通知
        # 确保用户只看到最新阶段的状态（如休息结束时清除专注完成通知）
        if category:
            pending_notifications[:] = [n for n in pending_notifications if n.get('category') != category]
        pending_notifications.append(notif_data)
    if IS_WINDOWS:
        _send_windows_notify(title, body)
    else:
        try:
            if _notify_env is None:
                _notify_env = _get_notify_env()
            if body:
                subprocess.Popen(
                    ['notify-send', '-t', '10000', title, body],
                    env=_notify_env,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
            else:
                subprocess.Popen(
                    ['notify-send', '-t', '10000', title],
                    env=_notify_env,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
        except Exception as e:
            pass

def play_notification_sound():
    if IS_WINDOWS:
        try:
            # Windows平台：使用PowerShell播放系统提示音
            ps_script = (
                "Add-Type -AssemblyName System.Windows.Forms; "
                "[System.Media.SystemSounds]::Exclamation.Play()"
            )
            subprocess.Popen(
                ['powershell', '-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', ps_script],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0
            )
        except Exception:
            pass
    else:
        try:
            subprocess.Popen(
                ['python3', '-c',
                 'import subprocess; subprocess.Popen(["aplay", "-q", "/usr/share/sounds/freedesktop/stereo/bell.oga"], '
                 'stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        except Exception:
            pass

# ==================== 外部日历订阅(ICS)同步 ====================
# 文档：《外部日历订阅同步需求说明书.md》5.2 核心同步算法
try:
    from icalendar import Calendar
    HAS_ICALENDAR = True
except ImportError:
    HAS_ICALENDAR = False
    Calendar = None

# 常见 Windows 时区名 → IANA 映射（Outlook 导出的 TZID 常为 Windows 名）
WINDOWS_TZID_MAP = {
    "China Standard Time": "Asia/Shanghai",
    "UTC": "UTC",
    "GMT Standard Time": "Europe/London",
    "Romance Standard Time": "Europe/Paris",
    "W. Europe Standard Time": "Europe/Berlin",
    "Tokyo Standard Time": "Asia/Tokyo",
    "Singapore Standard Time": "Asia/Singapore",
    "India Standard Time": "Asia/Kolkata",
    "Korea Standard Time": "Asia/Seoul",
    "Taipei Standard Time": "Asia/Taipei",
    "US Eastern Standard Time": "America/New_York",
    "Eastern Standard Time": "America/New_York",
    "Central Standard Time": "America/Chicago",
    "Mountain Standard Time": "America/Denver",
    "Pacific Standard Time": "America/Los_Angeles",
    "Russia Time Zone 3": "Europe/Moscow",
    "AUS Eastern Standard Time": "Australia/Sydney",
}

CALENDAR_SYNC_TIMEOUT = 10
CALENDAR_SYNC_WINDOW_PAST_DAYS = 30
CALENDAR_SYNC_WINDOW_FUTURE_DAYS = 180


def _int_to_base36(n):
    if n == 0:
        return '0'
    chars = '0123456789abcdefghijklmnopqrstuvwxyz'
    out = ''
    while n > 0:
        n, r = divmod(n, 36)
        out = chars[r] + out
    return out


def _gen_task_id():
    """生成与前端 generateId 风格一致的 id（base36 时间戳 + 随机）"""
    import random
    import time
    return _int_to_base36(int(time.time() * 1000)) + _int_to_base36(random.randint(0, 2**31 - 1)) + _int_to_base36(random.randint(0, 2**31 - 1))[:4]


def _safe_iana(tzid):
    """尝试把 tzid 当 IANA 名直接用"""
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(tzid)
        return tzid
    except Exception:
        return None


def _resolve_ical_dt(prop):
    """icalendar 的 vDDDTypes 属性 → (iso_string, is_all_day)。

    返回值恒为**带时区的本地时间** ISO（如 2026-11-22T00:00:00+08:00）：
    - 带时间事件 → 本地时区 iso，is_all_day=False
    - 全天事件 → 本地 00:00 的 iso，is_all_day=True
    调用方因此可以安全地与 aware 的同步窗口比较。
    """
    import datetime as _dt
    if prop is None:
        return None, True
    dt = getattr(prop, 'dt', prop)
    if dt is None:
        return None, True
    # 补时区：floating datetime 且带 TZID 参数（如 Windows 时区名）
    if isinstance(dt, _dt.datetime) and dt.tzinfo is None:
        tzid = None
        params = getattr(prop, 'params', None)
        if params:
            tzid = params.get('TZID')
        if tzid:
            iana = WINDOWS_TZID_MAP.get(tzid) or _safe_iana(tzid)
            if iana:
                try:
                    from zoneinfo import ZoneInfo
                    dt = dt.replace(tzinfo=ZoneInfo(iana))
                except Exception:
                    pass
    if isinstance(dt, _dt.datetime):
        # 浮动时间（无 TZID、无 Z）按 RFC 5545 视为「观察者本地时间」，
        # 必须补上本地时区：否则产出 naive ISO，与同步窗口的 aware 边界比较时会抛
        # TypeError: can't compare offset-naive and offset-aware datetimes。
        local = dt.astimezone()
        return local.isoformat(), False
    elif isinstance(dt, _dt.date):
        from datetime import datetime as _dtt
        # 全天事件取本地 00:00，同样补上本地时区（同一原因）
        local = _dtt(dt.year, dt.month, dt.day).astimezone()
        return local.isoformat(), True
    return None, True


def _event_key(vevent):
    """匹配键 = UID [+ RECURRENCE-ID]，详见需求说明书 5.2 / 6.1"""
    uid = str(vevent.get('UID', '') or '')
    rid_prop = vevent.get('RECURRENCE-ID')
    if rid_prop is not None:
        rid = getattr(rid_prop, 'dt', rid_prop)
        rid_str = rid.isoformat() if hasattr(rid, 'isoformat') else str(rid)
        return uid + '@' + rid_str
    return uid


def _convert_rrule(rrule_prop):
    """ICS RRULE → TackList repeat 结构；无法转换返回 None（调用方追加警告）"""
    if rrule_prop is None:
        return None
    try:
        freq_list = rrule_prop.get('FREQ')
        freq = str(freq_list[0]).upper() if freq_list else ''
        interval_list = rrule_prop.get('INTERVAL')
        interval = int(interval_list[0]) if interval_list else 1
        if freq == 'DAILY':
            if interval == 1:
                return {'type': 'daily', 'repeatMode': 'startTime'}
            return {'type': 'custom', 'interval': interval, 'unit': 'days', 'repeatMode': 'startTime'}
        if freq == 'WEEKLY':
            if interval == 1:
                return {'type': 'weekly', 'repeatMode': 'startTime'}
            return {'type': 'custom', 'interval': interval, 'unit': 'weeks', 'repeatMode': 'startTime'}
        if freq == 'MONTHLY':
            if interval == 1:
                return {'type': 'monthly', 'repeatMode': 'startTime'}
            return {'type': 'custom', 'interval': interval, 'unit': 'months', 'repeatMode': 'startTime'}
        if freq == 'YEARLY':
            if interval == 1:
                return {'type': 'yearly', 'repeatMode': 'startTime'}
            return {'type': 'custom', 'interval': interval, 'unit': 'years', 'repeatMode': 'startTime'}
        return None
    except Exception:
        return None


def _ensure_subscription_list(data, sub):
    """确保订阅的专属清单存在（带 extSourceId 标记）；返回 list_id。详见附录 A-4。"""
    lists = data.get('taskLists', [])
    target_id = 'extlist_' + sub['id']
    for lst in lists:
        if lst.get('extSourceId') == sub['id']:
            return lst['id']
        if lst.get('id') == target_id:
            lst['extSourceId'] = sub['id']  # 兜底补标记
            return target_id
    color_map = {'blue': '#3b82f6', 'green': '#10b981', 'red': '#ef4444',
                 'purple': '#8b5cf6', 'orange': '#f59e0b', 'teal': '#14b8a6',
                 'pink': '#ec4899', 'gray': '#9ca3af'}
    new_list = {
        'id': target_id,
        'name': sub.get('name') or '订阅',
        'color': color_map.get(sub.get('color'), sub.get('color') or '#3b82f6'),
        'extSourceId': sub['id']
    }
    data.setdefault('taskLists', []).append(new_list)
    return target_id


def _fetch_ics(url):
    """拉取 ICS 内容（webcal://→https://，仅 http/https）；返回 bytes"""
    u = url.strip()
    if u.lower().startswith('webcal://'):
        u = 'https://' + u[len('webcal://'):]
    parsed = urllib.parse.urlparse(u)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('仅支持 http/https 订阅链接')
    req = urllib.request.Request(u, headers={'User-Agent': 'TackList/11.6'})
    with urllib.request.urlopen(req, timeout=CALENDAR_SYNC_TIMEOUT) as resp:
        return resp.read()


def _do_calendar_sync():
    """执行外部日历同步；返回 {added, updated, removed, results}。
    全部订阅在一次读改写事务内完成，统一写盘、_data_version 仅 +1（附录 A-6）。"""
    global _data_version
    if not HAS_ICALENDAR:
        return {'error': '缺少 icalendar 库，请在服务端运行 pip install icalendar',
                'added': 0, 'updated': 0, 'removed': 0, 'results': []}

    data = load_data_from_file()
    settings = data.get('settings', {})
    subs = settings.get('calendarSubscriptions', []) or []
    enabled_subs = [s for s in subs if s.get('enabled', True)]
    if not enabled_subs:
        return {'added': 0, 'updated': 0, 'removed': 0, 'results': [], 'message': '没有启用的订阅'}

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=CALENDAR_SYNC_WINDOW_PAST_DAYS)
    window_end = now + timedelta(days=CALENDAR_SYNC_WINDOW_FUTURE_DAYS)

    results = []
    total_added = total_updated = total_removed = 0
    data_changed = False

    for sub in enabled_subs:
        sub_id = sub['id']
        # 兼容旧字符串格式和新对象格式 {uid, title, startTime, deletedAt}
        deleted_uids = set()
        for d in (sub.get('extDeletedUids') or []):
            if isinstance(d, dict):
                if d.get('uid'):
                    deleted_uids.add(d['uid'])
            elif isinstance(d, str):
                deleted_uids.add(d)
        result = {'id': sub_id, 'name': sub.get('name', ''), 'added': 0, 'updated': 0, 'removed': 0, 'error': ''}
        try:
            raw = _fetch_ics(sub['url'])
            cal = Calendar.from_ical(raw)
        except Exception as e:
            result['error'] = '拉取/解析失败：%s' % str(e)
            sub['lastSyncAt'] = now.isoformat().replace('+00:00', 'Z')
            sub['lastSyncError'] = result['error']
            results.append(result)
            data_changed = True
            continue

        # 解析所有 VEVENT（含黑名单跳过、CANCELLED 跳过、时间窗口过滤）
        # 单条事件解析异常（异常 TZID、损坏属性等）只跳过该条，不影响整源与其它订阅
        events = []
        for comp in cal.walk('VEVENT'):
            try:
                status = str(comp.get('STATUS', '') or '').upper()
                if status == 'CANCELLED':
                    continue
                ev_uid = str(comp.get('UID', '') or '')
                if ev_uid in deleted_uids:
                    continue
                start_iso, _is_all_day = _resolve_ical_dt(comp.get('DTSTART'))
                if not start_iso:
                    continue
                start_dt = parse_iso_datetime(start_iso)
                # 兜底：任何来源的 naive 时间都按本地时区补齐，避免窗口比较抛 TypeError
                if start_dt.tzinfo is None:
                    start_dt = start_dt.astimezone()
                if start_dt < window_start or start_dt > window_end:
                    continue
            except Exception:
                continue
            events.append(comp)

        # 隔离比对池：该订阅的全部已有任务
        tasks = data.get('tasks', [])
        local_pool = {}
        for t in tasks:
            if t.get('extSourceId') == sub_id:
                key = t.get('extEventUid', '')
                if key:
                    local_pool[key] = t

        list_id = _ensure_subscription_list(data, sub)

        for comp in events:
            key = _event_key(comp)
            title = str(comp.get('SUMMARY', '') or '').strip() or '(无标题)'
            desc = str(comp.get('DESCRIPTION', '') or '')
            start_iso, is_all_day = _resolve_ical_dt(comp.get('DTSTART'))
            end_iso, _ = _resolve_ical_dt(comp.get('DTEND'))
            rrule = _convert_rrule(comp.get('RRULE'))
            notes = desc
            if rrule is None and comp.get('RRULE') is not None:
                notes = (desc + '\n' if desc else '') + '[⚠️ 同步提示：此任务包含复杂的重复规则，TackList 已将其简化显示]'
            if key in local_pool:
                t = local_pool.pop(key)
                t['title'] = title
                t['startTime'] = start_iso
                if end_iso:
                    t['endTime'] = end_iso
                else:
                    t.pop('endTime', None)
                t['isAllDay'] = is_all_day
                t['notes'] = notes
                t['reminder'] = 0
                t['reminders'] = []
                t['repeat'] = rrule
                # completed / completedAt / tags / important / urgent / listId / progress 保留本地
                result['updated'] += 1
                total_updated += 1
            else:
                new_t = {
                    'id': _gen_task_id(),
                    'title': title,
                    'listId': list_id,
                    'important': False,
                    'urgent': False,
                    'notes': notes,
                    'tags': [],
                    'startTime': start_iso,
                    'endTime': end_iso,
                    'isAllDay': is_all_day,
                    'reminder': 0,
                    'reminders': [],
                    'repeat': rrule,
                    'completed': False,
                    'createdAt': now.isoformat().replace('+00:00', 'Z'),
                    'mode': 'text',
                    'description': '',
                    'subtasks': [{'id': _gen_task_id(), 'text': '', 'completed': False, 'originalOrder': 0}],
                    'progress': 0,
                    'extSourceId': sub_id,
                    'extEventUid': key,
                }
                tasks.append(new_t)
                result['added'] += 1
                total_added += 1

        # 清理云端已删除（local_pool 剩余）；黑名单任务已不在 tasks 中（用户删除时已移除）
        removed_keys = list(local_pool.keys())
        if removed_keys:
            removed_set = set(id(local_pool[k]) for k in removed_keys)
            data['tasks'] = [t for t in tasks if id(t) not in removed_set]
            result['removed'] = len(removed_keys)
            total_removed += len(removed_keys)

        sub['lastSyncAt'] = now.isoformat().replace('+00:00', 'Z')
        sub['lastSyncError'] = ''
        results.append(result)
        data_changed = True

    if data_changed:
        save_data_to_file(data)
        _data_version += 1

    return {'added': total_added, 'updated': total_updated, 'removed': total_removed, 'results': results}


# ==================== 背景图目录自动轮播 ====================
# 文档：《背景图目录自动轮播功能 PRD 需求说明书.md》
# 架构：服务端计时 + 客户端被动接收。配置与运行时状态持久化于独立文件 bg_carousel.json，
# 与 data.json 完全隔离（避免客户端全量 PUT 覆盖服务端运行时状态，也避免每次换图抬高 _data_version）。
BG_CAROUSEL_FILE = os.path.join(DIRECTORY, 'bg_carousel.json')
BG_CAROUSEL_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp')
BG_CAROUSEL_UNIT_SECONDS = {'minutes': 60, 'hours': 3600, 'days': 86400}
BG_CAROUSEL_MIME = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp',
}

# 轮播状态表：config 为用户配置（前端 POST 修改），runtime 为服务端维护的运行时进度
# 默认值单列成常量：设置「重置数据」时以它整体还原（config + runtime 全部归零）
_BG_CAROUSEL_DEFAULTS = {
    # ---- config ----
    'enabled': False,          # 轮播模式总开关（false=单张图片模式）
    'directory': '',           # 壁纸目录绝对路径
    'interval': 30,            # 轮播间隔数值
    'intervalUnit': 'minutes', # minutes | hours | days
    'order': 'sequential',     # sequential 顺序循环 | random 随机抽取
    # ---- runtime ----
    'currentIndex': 0,          # 当前图片在扫描列表中的索引（顺序模式）
    'currentFile': '',          # 当前图片绝对路径
    'nextSwitchAt': 0.0,       # 下次切换时间戳（epoch 秒）；重启后据此恢复节奏
    'switchId': 0,             # 切换计数器：客户端据此判断是否需要换图
    'imageCount': 0,           # 最近一次扫描的有效图片数
    'error': '',                # '' | no_directory | empty_directory
    'errorId': 0,              # 错误流水号：客户端据此去重 Toast
}
bg_carousel_state = dict(_BG_CAROUSEL_DEFAULTS)
bg_carousel_lock = threading.Lock()


def _bg_carousel_reset_locked():
    """恢复出厂状态（调用方需已持有 bg_carousel_lock）。

    「重置数据」专用：config 与 runtime 一并归零——只清 config 会残留
    currentFile/nextSwitchAt 等运行时进度，重新启用轮播时状态卡会先闪现旧图。"""
    bg_carousel_state.clear()
    bg_carousel_state.update(_BG_CAROUSEL_DEFAULTS)
    _bg_carousel_save_locked()


def _bg_carousel_load():
    """启动时从 bg_carousel.json 恢复状态（幂等：文件缺失/损坏时回退默认）"""
    global bg_carousel_state
    try:
        if os.path.exists(BG_CAROUSEL_FILE):
            with open(BG_CAROUSEL_FILE, 'r', encoding='utf-8') as f:
                saved = json.load(f)
            merged = dict(bg_carousel_state)
            for key in bg_carousel_state:
                if key in saved:
                    merged[key] = saved[key]
            bg_carousel_state = merged
    except Exception as e:
        print("Error loading bg_carousel.json: %s" % str(e))


def _bg_carousel_save_locked():
    """持久化轮播状态（调用方需已持有 bg_carousel_lock）"""
    try:
        with open(BG_CAROUSEL_FILE, 'w', encoding='utf-8') as f:
            json.dump(bg_carousel_state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("Error saving bg_carousel.json: %s" % str(e))


def _bg_carousel_interval_seconds_locked():
    unit = bg_carousel_state.get('intervalUnit', 'minutes')
    mult = BG_CAROUSEL_UNIT_SECONDS.get(unit, 60)
    try:
        val = int(bg_carousel_state.get('interval', 30))
    except (TypeError, ValueError):
        val = 30
    return max(1, val) * mult


def _bg_image_valid(filepath):
    """轻量校验：非空文件且魔数与扩展名匹配（损坏/截断图片直接跳过，不做全量解码）"""
    try:
        if os.path.getsize(filepath) <= 0:
            return False
        with open(filepath, 'rb') as f:
            head = f.read(12)
        if not head:
            return False
        ext = os.path.splitext(filepath)[1].lower()
        if ext in ('.jpg', '.jpeg'):
            return head[0:2] == b'\xFF\xD8'
        if ext == '.png':
            return head[0:8] == b'\x89PNG\r\n\x1a\n'
        if ext == '.gif':
            return head[0:6] in (b'GIF87a', b'GIF89a')
        if ext == '.webp':
            return head[0:4] == b'RIFF' and head[8:12] == b'WEBP'
        return False
    except Exception:
        return False


def _bg_carousel_scan_locked():
    """扫描目录，返回按文件名排序的有效图片列表（仅扩展名合法且魔数通过）"""
    directory = bg_carousel_state.get('directory', '')
    if not directory or not os.path.isdir(directory):
        return []
    try:
        names = sorted(os.listdir(directory))
    except Exception:
        return []
    result = []
    for name in names:
        if os.path.splitext(name)[1].lower() in BG_CAROUSEL_EXTENSIONS:
            fp = os.path.join(directory, name)
            if os.path.isfile(fp) and _bg_image_valid(fp):
                result.append(fp)
    return result


def _bg_carousel_advance_locked(keep_current=False):
    """计算并应用下一张图片：更新 currentFile/currentIndex/switchId/nextSwitchAt。
    keep_current=True 时若当前图仍有效则原样重发（用于重新启用轮播，仅 bump switchId 让客户端重新应用）。
    目录为空时进入 error 态并清空当前图（客户端回退默认背景）；图片恢复后自动解除。"""
    images = _bg_carousel_scan_locked()
    bg_carousel_state['imageCount'] = len(images)
    now = time.time()
    if not images:
        # 目录为空 / 被删除：回退默认背景（清空当前图），保持节奏继续扫描以便自动恢复
        bg_carousel_state['error'] = 'empty_directory' if bg_carousel_state.get('directory') else 'no_directory'
        bg_carousel_state['errorId'] += 1
        bg_carousel_state['currentFile'] = ''
        bg_carousel_state['currentIndex'] = 0
        bg_carousel_state['switchId'] += 1
        bg_carousel_state['nextSwitchAt'] = now + _bg_carousel_interval_seconds_locked()
        _bg_carousel_save_locked()
        return
    if bg_carousel_state.get('error'):
        bg_carousel_state['error'] = ''
        bg_carousel_state['errorId'] += 1
    order = bg_carousel_state.get('order', 'sequential')
    current = bg_carousel_state.get('currentFile', '')
    if keep_current and current in images:
        pick = images.index(current)
    elif order == 'random':
        import random as _random
        if len(images) == 1:
            pick = 0
        else:
            # 随机抽取但避免与当前图片相同
            cur_idx = images.index(current) if current in images else -1
            choices = [i for i in range(len(images)) if i != cur_idx]
            pick = _random.choice(choices) if choices else 0
    else:
        # 顺序循环：基于当前文件定位，目录内容变动时索引自动回环修正；
        # 首次启用/错误恢复后 current 为空 → 从第一张开始
        try:
            idx = images.index(current)
        except ValueError:
            idx = -1
        pick = (idx + 1) % len(images) if idx >= 0 else 0
    bg_carousel_state['currentFile'] = images[pick]
    bg_carousel_state['currentIndex'] = pick
    bg_carousel_state['switchId'] += 1
    bg_carousel_state['nextSwitchAt'] = now + _bg_carousel_interval_seconds_locked()
    _bg_carousel_save_locked()


def _bg_carousel_public_state_locked():
    """输出给客户端的状态（不含绝对路径，仅文件名）"""
    current = bg_carousel_state.get('currentFile', '')
    return {
        'enabled': bool(bg_carousel_state.get('enabled')),
        'directory': bg_carousel_state.get('directory', ''),
        'directoryExists': os.path.isdir(bg_carousel_state.get('directory', '')),
        'interval': bg_carousel_state.get('interval', 30),
        'intervalUnit': bg_carousel_state.get('intervalUnit', 'minutes'),
        'order': bg_carousel_state.get('order', 'sequential'),
        'currentFile': os.path.basename(current) if current else '',
        'currentIndex': bg_carousel_state.get('currentIndex', 0),
        'imageCount': bg_carousel_state.get('imageCount', 0),
        'nextSwitchAt': bg_carousel_state.get('nextSwitchAt', 0),
        'switchId': bg_carousel_state.get('switchId', 0),
        'error': bg_carousel_state.get('error', ''),
        'errorId': bg_carousel_state.get('errorId', 0),
    }


def bg_carousel_loop():
    """轮播守护线程：秒级检查。休眠唤醒后 now>=nextSwitchAt 时仅切换一次并重启节奏。"""
    while True:
        try:
            with bg_carousel_lock:
                if bg_carousel_state.get('enabled') and bg_carousel_state.get('directory', ''):
                    now = time.time()
                    current = bg_carousel_state.get('currentFile', '')
                    if now >= bg_carousel_state.get('nextSwitchAt', 0):
                        _bg_carousel_advance_locked()
                    elif current and not os.path.isfile(current):
                        # 当前图片被删除（服务运行期间）：立即换下一张
                        _bg_carousel_advance_locked()
        except Exception as e:
            print("Bg carousel loop error: %s" % str(e))
        time.sleep(1)


# ==================== 系统目录选择对话框（跨平台） ====================
# 关键约束：GUI 对话框一律在独立子进程中弹出，不在 HTTP 处理线程里创建 Tk / Qt 对象。
# 线程内建 Tk 在部分发行版（如银河麒麟）上会直接抛异常，且异常被吞掉后只剩
# 「未选择目录」这一条无信息量的提示；放进子进程后失败可判读、可换后端、可超时。

# tkinter 目录选择脚本。退出码：0=已选（路径走 stdout），2=用户取消，3/4/5=该解释器不可用
_TK_DIR_PICK_SCRIPT = r'''
import sys
try:
    import tkinter as tk
    from tkinter import filedialog
except Exception:
    sys.exit(3)
try:
    root = tk.Tk()
except Exception:
    sys.exit(4)
root.withdraw()
try:
    root.attributes('-topmost', True)
    root.update()
except Exception:
    pass
try:
    path = filedialog.askdirectory(parent=root, title='选择壁纸目录')
except Exception:
    sys.exit(5)
try:
    root.destroy()
except Exception:
    pass
sys.stdout.write(path or '')
sys.exit(0 if path else 2)
'''

# Qt 目录选择脚本（银河麒麟 / UOS 自带 PyQt5，zenity 往往没装）。
# 退出码：0=已选，2=用户取消，3=无 Qt 绑定，4=弹窗失败
_QT_DIR_PICK_SCRIPT = r'''
import os
import sys
bindings = ('PyQt5.QtWidgets', 'PySide2.QtWidgets', 'PyQt6.QtWidgets', 'PySide6.QtWidgets')
widgets = None
for name in bindings:
    try:
        widgets = __import__(name, fromlist=['*'])
        break
    except Exception:
        widgets = None
if widgets is None:
    sys.exit(3)
try:
    app = widgets.QApplication.instance() or widgets.QApplication(sys.argv[:1])
    path = widgets.QFileDialog.getExistingDirectory(
        None, '选择壁纸目录', os.path.expanduser('~'))
except Exception:
    sys.exit(4)
sys.stdout.write(path or '')
sys.exit(0 if path else 2)
'''

# 命令行目录选择器：zenity / kdialog / qarma / yad，存在即用
_LINUX_CLI_PICKERS = ('zenity', 'kdialog', 'qarma', 'yad')

# 判定"对话框根本没弹出来"（而不是用户取消）的 stderr 特征
_DISPLAY_FAIL_HINTS = (
    'cannot open display', "can't open display", 'unable to open display',
    'could not connect', 'unable to init server', 'no display',
    'cannot connect to x server', 'display is not set',
)


def _home_dir():
    """当前用户主目录。expanduser 在 HOME 缺失且 pwd 不可用时会原样返回 '~'，
    此时再退到环境变量，避免内置目录浏览器一起步就落到无效路径。"""
    home = os.path.expanduser('~')
    if not home or home == '~':
        home = os.environ.get('HOME') or os.environ.get('USERPROFILE') or ''
    return home


def _guess_display():
    """推断 X11 DISPLAY：优先环境变量，其次 /tmp/.X11-unix 下的套接字，最后回退 :0"""
    try:
        for name in sorted(os.listdir('/tmp/.X11-unix')):
            if name.startswith('X') and name[1:].isdigit():
                return ':' + name[1:]
    except Exception:
        pass
    return ':0'


def _gui_session_env():
    """为 GUI 子进程补齐图形会话环境变量。

    服务常由 nohup / 自启动脚本 / systemd 拉起，DISPLAY、XAUTHORITY、
    DBUS_SESSION_BUS_ADDRESS 可能缺失，tkinter / zenity 会静默失败——
    表现就是"点了「选择目录」什么都不弹"。这里按可推断的信息补齐。"""
    env = os.environ.copy()
    if IS_WINDOWS:
        return env
    if not env.get('DISPLAY'):
        env['DISPLAY'] = _guess_display()
    if not env.get('XAUTHORITY'):
        xauth = os.path.join(os.path.expanduser('~'), '.Xauthority')
        if os.path.isfile(xauth):
            env['XAUTHORITY'] = xauth
    if not env.get('XDG_RUNTIME_DIR'):
        try:
            runtime = '/run/user/%d' % os.getuid()
            if os.path.isdir(runtime):
                env['XDG_RUNTIME_DIR'] = runtime
        except Exception:
            pass
    if not env.get('WAYLAND_DISPLAY'):
        try:
            runtime = env.get('XDG_RUNTIME_DIR', '')
            for name in ('wayland-0', 'wayland-1'):
                if runtime and os.path.exists(os.path.join(runtime, name)):
                    env['WAYLAND_DISPLAY'] = name
                    break
        except Exception:
            pass
    if not env.get('DBUS_SESSION_BUS_ADDRESS'):
        try:
            bus = os.path.join(env.get('XDG_RUNTIME_DIR', ''), 'bus')
            if env.get('XDG_RUNTIME_DIR') and os.path.exists(bus):
                env['DBUS_SESSION_BUS_ADDRESS'] = 'unix:path=' + bus
            else:
                # 老式会话：~/.dbus/session-bus/<machine>-<display> 里存有总线地址
                display = env.get('DISPLAY', ':0').replace(':', '').split('.')[0]
                bus_dir = os.path.expanduser('~/.dbus/session-bus/')
                for fname in os.listdir(bus_dir):
                    if display not in fname:
                        continue
                    with open(os.path.join(bus_dir, fname), 'r') as fh:
                        for line in fh:
                            if line.startswith('DBUS_SESSION_BUS_ADDRESS='):
                                env['DBUS_SESSION_BUS_ADDRESS'] = line.split('=', 1)[1].strip().rstrip(';')
                                break
                    break
        except Exception:
            pass
    return env


def _candidate_interpreters():
    """候选 Python 解释器（去重保序）：当前解释器 → PATH 上的 python3 / python。
    自启动环境里的 sys.executable 可能没装 python3-tk，而系统 python3 装了（反之亦然），
    所以逐个试，而不是只认一个。"""
    result = []
    for exe in [sys.executable, shutil.which('python3'), shutil.which('python')]:
        if exe and exe not in result:
            result.append(exe)
    return result


def _pick_dir_subprocess(script, env, unavailable_codes):
    """跑一个"打印路径到 stdout"的子进程对话框脚本，逐个解释器尝试。

    返回 (path, reason)：reason 为 ok / cancelled / unavailable / error"""
    saw_error = False
    for exe in _candidate_interpreters():
        try:
            result = subprocess.run([exe, '-c', script],
                                    capture_output=True, text=True, timeout=600, env=env)
        except Exception:
            continue
        if result.returncode == 0:
            path = (result.stdout or '').strip()
            return (path, 'ok') if path else (None, 'cancelled')
        if result.returncode == 2:
            return None, 'cancelled'
        if result.returncode not in unavailable_codes:
            # 非约定退出码（多为脚本异常）：换下一个解释器再试，别就此放弃
            saw_error = True
    return (None, 'error') if saw_error else (None, 'unavailable')


def _pick_dir_tkinter(env):
    """tkinter 目录选择（子进程）"""
    return _pick_dir_subprocess(_TK_DIR_PICK_SCRIPT, env, (3, 4, 5))


def _pick_dir_qt(env):
    """Qt 目录选择（子进程）。银河麒麟 / UOS 默认带 PyQt5，覆盖 zenity 缺失的场景。"""
    return _pick_dir_subprocess(_QT_DIR_PICK_SCRIPT, env, (3, 4))


def _pick_dir_cli(env):
    """zenity / kdialog / qarma / yad 目录选择。
    这类工具的约定是：0=确定，1=取消；但连不上显示服务时也返回 1，
    因此再用 stderr 特征区分"真取消"和"压根没弹出来"，后者继续换下一个后端。"""
    home = _home_dir()
    for name in _LINUX_CLI_PICKERS:
        exe = shutil.which(name)
        if not exe:
            continue
        if name == 'kdialog':
            argv = [exe, '--getexistingdirectory', home, '--title', '选择壁纸目录']
        else:
            argv = [exe, '--file-selection', '--directory', '--title=选择壁纸目录']
        try:
            result = subprocess.run(argv, capture_output=True, text=True,
                                    timeout=600, env=env)
        except Exception:
            continue
        out = (result.stdout or '').strip()
        err = (result.stderr or '').lower()
        if result.returncode == 0:
            return (out, 'ok') if out else (None, 'cancelled')
        if result.returncode == 1 and not any(h in err for h in _DISPLAY_FAIL_HINTS):
            return None, 'cancelled'
    return None, 'unavailable'


def _pick_dir_windows():
    """Windows：tkinter（子进程）→ PowerShell FolderBrowserDialog"""
    env = os.environ.copy()
    path, reason = _pick_dir_tkinter(env)
    if reason in ('ok', 'cancelled'):
        return path, reason
    try:
        ps_script = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
            "$d.Description = '选择壁纸目录';"
            "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK)"
            "{ Write-Output $d.SelectedPath }"
        )
        result = subprocess.run(
            ['powershell', '-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', ps_script],
            capture_output=True, text=True, timeout=600,
            creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0
        )
        path = (result.stdout or '').strip()
        return (path, 'ok') if path else (None, 'cancelled')
    except Exception:
        return None, 'unavailable'


def _bg_pick_directory_dialog():
    """在服务器所在机器上弹出系统目录选择对话框。

    返回 (path, reason)：
      path   选中的目录绝对路径；未选中为 None
      reason 'ok'          已选择
             'cancelled'   用户主动取消（调用方提示"未选择目录"）
             'unavailable' 当前环境没有可用的图形对话框（缺 python3-tk / zenity，
                           或服务跑在无图形会话的环境）→ 调用方回退内置目录浏览器
             'error'       对话框存在但调用出错
    后端按 可用性 依次尝试：tkinter → Qt(PyQt5) → zenity/kdialog/qarma/yad；
    任一后端弹出了对话框（无论用户选还是取消）即终止，不会连弹两次。"""
    if IS_WINDOWS:
        return _pick_dir_windows()
    env = _gui_session_env()
    saw_error = False
    for picker in (_pick_dir_tkinter, _pick_dir_qt, _pick_dir_cli):
        try:
            path, reason = picker(env)
        except Exception:
            continue
        if reason in ('ok', 'cancelled'):
            return path, reason
        if reason == 'error':
            saw_error = True
    return (None, 'error') if saw_error else (None, 'unavailable')


# ---------- 内置目录浏览器（系统对话框不可用时的零依赖兜底） ----------

_xdg_user_dirs_cache = None


def _xdg_user_dirs():
    """读取 XDG 用户目录（与语言/发行版无关）。

    中文系统是 ~/桌面、~/图片，英文是 ~/Desktop、~/Pictures，法语是 ~/Bureau……
    硬编码目录名只能覆盖中英两种；xdg-user-dir 是各桌面发行版的统一口径，
    缺失（如精简安装）时返回空表，由调用方回退到中英文候选名。"""
    global _xdg_user_dirs_cache
    if _xdg_user_dirs_cache is not None:
        return _xdg_user_dirs_cache
    found = {}
    if not IS_WINDOWS:
        exe = shutil.which('xdg-user-dir')
        if exe:
            for key in ('DESKTOP', 'DOWNLOAD', 'PICTURES'):
                try:
                    out = subprocess.run([exe, key], capture_output=True,
                                         text=True, timeout=5)
                    p = (out.stdout or '').strip()
                    if p and os.path.isdir(p):
                        found[key] = p
                except Exception:
                    pass
    _xdg_user_dirs_cache = found
    return found


def _bg_dir_shortcuts():
    """内置目录浏览器的快捷入口（目录存在才返回）"""
    home = _home_dir()
    xdg = _xdg_user_dirs()
    candidates = (
        ('主目录', home),
        ('桌面', xdg.get('DESKTOP') or os.path.join(home, '桌面')),
        ('桌面', os.path.join(home, 'Desktop')),
        ('图片', xdg.get('PICTURES') or os.path.join(home, '图片')),
        ('图片', os.path.join(home, 'Pictures')),
        ('下载', xdg.get('DOWNLOAD') or os.path.join(home, '下载')),
        ('下载', os.path.join(home, 'Downloads')),
    )
    result = []
    seen = set()
    for name, p in candidates:
        if not p or p in seen or not os.path.isdir(p):
            continue
        seen.add(p)
        result.append({'name': name, 'path': p})
    return result


def _bg_browse_directory(raw_path):
    """列出某目录下的子目录，供前端内置目录浏览器使用。
    只读、只返回目录（不返回文件名），不跟随越权——本功能只需要选目录。"""
    home = _home_dir()
    target = (raw_path or '').strip() or home
    try:
        target = os.path.realpath(os.path.abspath(os.path.expanduser(target)))
    except Exception:
        return {'success': False, 'reason': 'bad_path', 'message': '路径无法解析'}
    if not os.path.exists(target):
        return {'success': False, 'reason': 'not_found', 'message': '目录不存在：%s' % target}
    if not os.path.isdir(target):
        return {'success': False, 'reason': 'not_dir', 'message': '不是目录：%s' % target}
    try:
        names = os.listdir(target)
    except PermissionError:
        return {'success': False, 'reason': 'denied', 'message': '没有权限读取：%s' % target}
    except Exception as e:
        return {'success': False, 'reason': 'error', 'message': str(e)}
    visible, hidden = [], []
    for name in names:
        full = os.path.join(target, name)
        try:
            if not os.path.isdir(full):
                continue
        except Exception:
            continue
        item = {'name': name, 'path': full}
        (hidden if name.startswith('.') else visible).append(item)
    visible.sort(key=lambda x: x['name'].lower())
    hidden.sort(key=lambda x: x['name'].lower())
    parent = os.path.dirname(target)
    return {
        'success': True,
        'path': target,
        'parent': parent if parent and parent != target else '',
        'home': home,
        'shortcuts': _bg_dir_shortcuts(),
        'entries': visible + hidden,
    }


def _fire_task_reminder(task, minute, kind, data):
    """主任务提醒：系统通知 + 前端队列。minute=0 为准点（kind='ondot'/'snooze'）。"""
    task_id = task.get('id', '')
    task_name = task.get('title') or '未命名任务'
    try:
        local_time = parse_iso_datetime(task['startTime']).astimezone()
        time_str = local_time.strftime('%H:%M')
        date_str = local_time.strftime('%m-%d')
    except Exception:
        time_str, date_str = '??:??', ''

    # 提前量：标题带"距开始还有多久"；准点：沿用现有纯时间格式
    if kind == 'advance' and minute > 0:
        if minute >= 1440:
            base_title = '%s %s · %s' % (date_str, time_str, _humanize_minute(minute))
        else:
            base_title = '%s · %s后' % (time_str, _humanize_minute(minute))
    else:
        base_title = time_str

    notes = task.get('notes', '')
    list_prefix = _list_prefix(task.get('listId'), data)
    if notes and notes.strip():
        # 保持旧行为：有 notes 时标题带任务名，正文用 notes
        title = '%s %s' % (base_title, task_name)
        body = list_prefix + notes.strip()
    else:
        title = base_title
        body = list_prefix + task_name

    send_notify_send(title, body, task_id=task_id, reminder_kind=kind, reminder_minute=minute)
    play_notification_sound()


def _reminder_body_head(task, task_name):
    """子任务提醒正文的「头部」：任务名，子任务模式下再挂上详情描述。

    子任务模式且填了详情描述时返回 `任务名 · 详情描述`。
    用户 2026-09-23 明确：系统通知看不到应用内界面，**任务名与描述都要保留**
    （应用内 Toast 第 2 行是「描述顶替任务名」，两者口径有意不同，别去"统一"）。
    非子任务模式（`mode` 缺省或 `'text'`）或未填描述 → 只返回任务名，旧正文一字不变。
    描述是自由文本、系统通知没有省略号，故按正文档软截断到 80 字（标题档是 24）。
    """
    if (task.get('mode') or 'text') != 'text':
        description = _truncate_for_title(task.get('description'), limit=80)
        if description:
            return '%s · %s' % (task_name, description)
    return task_name


def _fire_subtask_reminder(task, subtask, minute, kind, data):
    """子任务提醒：系统通知 + 前端队列。

    正文格式：`清单名 | 头部 → 子任务文本（已完成/总数）`
    头部 = 任务名；子任务模式且填了详情描述时为 `任务名 · 详情描述`（见 _reminder_body_head）
    标题格式：准点 `09:00 · 子任务名`；提前量 `08:50 · 10 分钟后 · 子任务名`
    标题始终带子任务名（不论子任务多少条）：系统通知看不到应用内的子任务列表，
    标题里有名字才能一眼看出是哪一步到点。
    """
    task_id = task.get('id', '')
    st_id = subtask.get('id', '')
    task_name = task.get('title') or '未命名任务'
    st_text = (subtask.get('text') or '').strip() or '未命名子任务'

    try:
        local_time = parse_iso_datetime(subtask['startTime']).astimezone()
        time_str = local_time.strftime('%H:%M')
        date_str = local_time.strftime('%m-%d')
    except Exception:
        time_str, date_str = '??:??', ''

    subs = [s for s in (task.get('subtasks') or []) if (s.get('text') or '').strip()]
    done = len([s for s in subs if s.get('completed')])
    total = len(subs)
    progress = '（%d/%d）' % (done, total) if total else ''

    list_prefix = _list_prefix(task.get('listId'), data)

    # 标题里用真实子任务名（过长软截断），无论子任务有多少条都带名字。
    # （曾按「仅 > 1 条时带名字」实现过，已按用户要求撤销：标题始终写名字更一致）
    st_title = _truncate_for_title(st_text)
    if kind == 'advance' and minute > 0:
        if minute >= 1440:
            title = '%s %s · %s · %s' % (date_str, time_str, _humanize_minute(minute), st_title)
        else:
            title = '%s · %s后 · %s' % (time_str, _humanize_minute(minute), st_title)
    else:
        title = '%s · %s' % (time_str, st_title)

    body = '%s%s → %s%s' % (list_prefix, _reminder_body_head(task, task_name), st_text, progress)

    # 不传 category：同一时刻多个子任务到点时应各自独立入队，避免被同类覆盖丢消息
    send_notify_send(title, body, task_id=task_id, subtask_id=st_id,
                     reminder_kind=kind, reminder_minute=minute)
    play_notification_sound()


def check_task_reminders():
    try:
        data = load_data_from_file()
        tasks = data.get('tasks', [])
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

        # —— 稍后提醒：到期后直接重发 ——
        with snoozed_reminders_lock:
            expired = [(k, ts) for k, ts in snoozed_reminders.items() if now_ms >= ts]
            for k, _ in expired:
                del snoozed_reminders[k]

        for skey, _ in expired:
            task_id, _, sub_id = skey.partition('@')
            if sub_id == '_task':
                sub_id = None
            task = next((t for t in tasks if t.get('id') == task_id), None)
            # deletedAt：软删除进回收站的任务（FR-02），不再触发提醒
            if not task or task.get('completed') or task.get('deletedAt'):
                continue
            if sub_id:
                st = next((s for s in (task.get('subtasks') or []) if s.get('id') == sub_id), None)
                if not st or st.get('completed') or not st.get('startTime'):
                    continue
                if not (st.get('text') or '').strip():
                    continue
                _fire_subtask_reminder(task, st, 0, 'snooze', data)
            else:
                if not task.get('startTime') or task.get('isAllDay'):
                    continue
                _fire_task_reminder(task, 0, 'snooze', data)

        # —— 主任务：准点无条件触发 + 用户配置的提前量 ——
        for task in tasks:
            # 无时间 / 已完成 / 全天 一律跳过（全天任务无具体时刻可作"准点"）；
            # deletedAt：软删除进回收站的任务（FR-02）不触发提醒
            if not task.get('startTime') or task.get('completed') or task.get('isAllDay') or task.get('deletedAt'):
                continue
            task_id = task.get('id', '')
            try:
                task_time_ms = int(parse_iso_datetime(task['startTime']).timestamp() * 1000)
            except Exception:
                continue
            for minute, fire_ms, kind in _fire_points(task_time_ms, _task_advance_minutes(task)):
                key = _reminder_key(task_id, minute, base_ms=task_time_ms)
                if _try_fire(key, fire_ms, now_ms):
                    _fire_task_reminder(task, minute, kind, data)

        # —— 子任务：与主任务同规则（准点恒触发 + 最多 5 个提前量）——
        for task in tasks:
            # deletedAt：软删除进回收站的任务（FR-02）不触发提醒
            if task.get('completed') or task.get('deletedAt'):
                continue
            task_id = task.get('id', '')
            for st in (task.get('subtasks') or []):
                st_id = st.get('id', '')
                if not st_id or st.get('completed'):
                    continue
                st_time = st.get('startTime')
                if not st_time:
                    continue
                if not (st.get('text') or '').strip():
                    continue  # 无文本不通知（正文无内容可显示）
                try:
                    st_time_ms = int(parse_iso_datetime(st_time).timestamp() * 1000)
                except Exception:
                    continue
                for minute, fire_ms, kind in _fire_points(
                        st_time_ms, _normalize_reminder_minutes(st.get('reminders'))):
                    key = _reminder_key(task_id, minute, st_id, base_ms=st_time_ms)
                    if _try_fire(key, fire_ms, now_ms):
                        _fire_subtask_reminder(task, st, minute, kind, data)
    except Exception as e:
        print("Reminder check error: %s" % str(e))

def check_pomodoro_completion():
    """Tick-based累加器：每秒累加有效时间，检测休眠并自动暂停，超时直接完成。"""
    global pomodoro_state, pomodoro_notified
    notify_info = None
    with pomodoro_lock:
        now = datetime.now(timezone.utc)
        now_str = now.isoformat().replace('+00:00', 'Z')
        last_tick = pomodoro_state.get('lastTickTime')

        # 始终更新 lastTickTime
        pomodoro_state['lastTickTime'] = now_str

        if not pomodoro_state.get('running'):
            return

        # 首次Tick：只记录时间，不累加
        if last_tick is None:
            return

        try:
            if isinstance(last_tick, str):
                last_tick_dt = parse_iso_datetime(last_tick)
            else:
                last_tick_dt = last_tick
            delta = (now - last_tick_dt).total_seconds()
        except Exception:
            return

        if delta < 0:
            return  # 时钟回拨，忽略

        # 休眠检测：两次Tick间隔超过15秒，说明系统刚从休眠中唤醒
        if delta > 15:
            total = pomodoro_state.get('totalDuration', 0)
            acc = pomodoro_state.get('accumulatedTime', 0)
            remaining = total - acc

            # 如果休眠时间 >= 剩余时间，说明专注本应完成，直接结算
            if remaining > 0 and delta >= remaining:
                pomodoro_state['accumulatedTime'] = total
                if not pomodoro_notified:
                    pomodoro_notified = True
                    split_info = pomodoro_state.get('completedTaskDuringFocus')
                    _do_pomodoro_complete(split_info)
                    if 'completedTaskDuringFocus' in pomodoro_state:
                        del pomodoro_state['completedTaskDuringFocus']
                    if pomodoro_state.get('state') == 'completed':
                        if pomodoro_state.get('phase') == 'longBreak':
                            notify_info = ('专注完成', '系统休眠期间专注已自动完成，好好休息一下吧~')
                        else:
                            notify_info = ('专注完成', '系统休眠期间专注已自动完成，短暂休息一下吧~')
                        # 自动休息
                        if pomodoro_state.get('autoBreak'):
                            break_seconds = pomodoro_state.get('breakDuration', 5) * 60
                            now_str2 = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                            pomodoro_state['running'] = True
                            pomodoro_state['startedAt'] = now_str2
                            pomodoro_state['lastTickTime'] = now_str2
                            pomodoro_state['state'] = 'resting'
                            pomodoro_state['totalDuration'] = break_seconds
                            pomodoro_state['accumulatedTime'] = 0
                            pomodoro_state['totalFocusedSeconds'] = 0
                            pomodoro_state['timeLeft'] = break_seconds
                            pomodoro_notified = False
                    else:
                        notify_info = ('休息结束', '系统休眠期间休息已自动完成')
                        if pomodoro_state.get('autoFocus'):
                            auto_focus_blocked = False
                            last_activity = pomodoro_state.get('lastUserActivityAt')
                            if last_activity:
                                try:
                                    activity_time = parse_iso_datetime(last_activity)
                                    inactive_seconds = (datetime.now(timezone.utc) - activity_time).total_seconds()
                                    cycle_duration = (pomodoro_state.get('focusDuration', 25) + pomodoro_state.get('shortBreakDuration', 5)) * 60
                                    threshold = pomodoro_state.get('longBreakInterval', 4) * cycle_duration
                                    if inactive_seconds > threshold:
                                        auto_focus_blocked = True
                                except Exception:
                                    pass
                            if not auto_focus_blocked:
                                focus_seconds = pomodoro_state.get('focusDuration', 25) * 60
                                now_str2 = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                                pomodoro_state['running'] = True
                                pomodoro_state['startedAt'] = now_str2
                                pomodoro_state['lastTickTime'] = now_str2
                                pomodoro_state['state'] = 'focusing'
                                pomodoro_state['phase'] = 'focus'
                                pomodoro_state['totalDuration'] = focus_seconds
                                pomodoro_state['accumulatedTime'] = 0
                                pomodoro_state['totalFocusedSeconds'] = 0
                                pomodoro_state['timeLeft'] = focus_seconds
                                pomodoro_notified = False
            else:
                # 休眠时间 < 剩余时间：自动暂停，保留已专注时间
                pomodoro_state['timeLeft'] = max(0, int(remaining))
                pomodoro_state['totalFocusedSeconds'] = pomodoro_state.get('totalFocusedSeconds', 0) + acc
                pomodoro_state['accumulatedTime'] = 0
                pomodoro_state['running'] = False
                pomodoro_state['state'] = 'pause'
                pomodoro_state['totalDuration'] = 0
                notify_info = ('system_sleep', '检测到系统休眠，专注已自动暂停')
            return

        # 正常Tick：累加有效时长
        pomodoro_state['accumulatedTime'] = pomodoro_state.get('accumulatedTime', 0) + delta

        total = pomodoro_state.get('totalDuration', 0)
        if total > 0 and pomodoro_state.get('accumulatedTime', 0) >= total:
            # 时间到！服务器直接完成结算
            pomodoro_state['accumulatedTime'] = total
            if pomodoro_notified:
                return
            pomodoro_notified = True
            split_info = pomodoro_state.get('completedTaskDuringFocus')
            _do_pomodoro_complete(split_info)
            # 清理服务器端存储的拆分信息
            if 'completedTaskDuringFocus' in pomodoro_state:
                del pomodoro_state['completedTaskDuringFocus']
            # 服务器端发送完成通知（确保浏览器关闭时也能收到）
            if pomodoro_state.get('state') == 'completed':
                # 专注完成：_do_pomodoro_complete 已更新 phase 为 break/longBreak
                if pomodoro_state.get('phase') == 'longBreak':
                    notify_info = ('专注完成', '你完成了一个番茄，好好休息一下吧~')
                else:
                    notify_info = ('专注完成', '你完成了一个番茄，短暂休息一下吧~')
                # 自动休息：服务器端直接启动休息倒计时（浏览器未打开时也能自动开始）
                if pomodoro_state.get('autoBreak'):
                    break_seconds = pomodoro_state.get('breakDuration', 5) * 60
                    now_str2 = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                    pomodoro_state['running'] = True
                    pomodoro_state['startedAt'] = now_str2
                    pomodoro_state['lastTickTime'] = now_str2
                    pomodoro_state['state'] = 'resting'
                    pomodoro_state['totalDuration'] = break_seconds
                    pomodoro_state['accumulatedTime'] = 0
                    pomodoro_state['totalFocusedSeconds'] = 0
                    pomodoro_state['timeLeft'] = break_seconds
                    pomodoro_notified = False
            else:
                notify_info = ('休息结束', '准备好开始新的专注了吗？')
                # 自动专注：服务器端直接启动专注倒计时（浏览器未打开时也能自动开始）
                if pomodoro_state.get('autoFocus'):
                    # 检查 autoFocus 是否应被拦截（用户长时间未操作）
                    auto_focus_blocked = False
                    last_activity = pomodoro_state.get('lastUserActivityAt')
                    if last_activity:
                        try:
                            activity_time = parse_iso_datetime(last_activity)
                            inactive_seconds = (datetime.now(timezone.utc) - activity_time).total_seconds()
                            cycle_duration = (pomodoro_state.get('focusDuration', 25) + pomodoro_state.get('shortBreakDuration', 5)) * 60
                            threshold = pomodoro_state.get('longBreakInterval', 4) * cycle_duration
                            if inactive_seconds > threshold:
                                auto_focus_blocked = True
                        except Exception:
                            pass
                    if not auto_focus_blocked:
                        focus_seconds = pomodoro_state.get('focusDuration', 25) * 60
                        now_str2 = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                        pomodoro_state['running'] = True
                        pomodoro_state['startedAt'] = now_str2
                        pomodoro_state['lastTickTime'] = now_str2
                        pomodoro_state['state'] = 'focusing'
                        pomodoro_state['phase'] = 'focus'
                        pomodoro_state['totalDuration'] = focus_seconds
                        pomodoro_state['accumulatedTime'] = 0
                        pomodoro_state['totalFocusedSeconds'] = 0
                        pomodoro_state['timeLeft'] = focus_seconds
                        pomodoro_notified = False

    if notify_info:
        if notify_info[0] == 'system_sleep':
            send_notify_send('系统休眠检测', notify_info[1], category='pomodoro')
        else:
            send_notify_send(notify_info[0], notify_info[1], category='pomodoro')
        play_notification_sound()

def reminder_checker_loop():
    while True:
        try:
            check_task_reminders()
        except Exception as e:
            print("Reminder loop error: %s" % str(e))
        time.sleep(30)

def pomodoro_checker_loop():
    while True:
        try:
            check_pomodoro_completion()
        except Exception as e:
            print("Pomodoro check error: %s" % str(e))
        time.sleep(1)

def cleanup_notified_ids():
    """清理已删除任务残留的去重键与稍后提醒项（按 task_id 前缀匹配，天然覆盖子任务）。"""
    global notified_reminder_keys
    try:
        data = load_data_from_file()
        tasks = data.get('tasks', [])
        valid_prefixes = tuple('%s@' % t['id'] for t in tasks if t.get('id'))
        with notified_task_ids_lock:
            if valid_prefixes:
                notified_reminder_keys = {
                    k for k in notified_reminder_keys if k.startswith(valid_prefixes)
                }
            else:
                notified_reminder_keys = set()
        with snoozed_reminders_lock:
            invalid_snooze = [
                k for k in snoozed_reminders
                if not (valid_prefixes and k.startswith(valid_prefixes))
            ]
            for k in invalid_snooze:
                del snoozed_reminders[k]
    except Exception:
        pass


class TodoHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, PATCH, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def send_json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_cors_headers()
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json_response({"error": message}, status)

    def send_file_download(self, filepath, download_name, content_type):
        """分块下发文件（导出 zip / 备份下载），避免整包读进内存。

        Content-Length 用 ascii 安全的 filename* 兜底：备份文件名目前都是 ASCII，
        但导出的中文文件名一旦出现，裸 filename= 在部分浏览器会乱码。
        """
        size = os.path.getsize(filepath)
        safe_name = urllib.parse.quote(download_name, safe='')
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Disposition',
                         "attachment; filename=\"%s\"; filename*=UTF-8''%s" % (download_name, safe_name))
        self.send_header('Content-Length', str(size))
        self.send_cors_headers()
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.end_headers()
        with open(filepath, 'rb') as f:
            shutil.copyfileobj(f, self.wfile, 256 * 1024)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/data':
            data = load_data_from_file()
            data['_version'] = _data_version
            self.send_json_response(data)
            return

        if path == '/api/pomodoro':
            with pomodoro_lock:
                resp = dict(pomodoro_state)
                state = resp.get('state', 'idle')
                if resp.get('running'):
                    # Tick-based: timeLeft = totalDuration - accumulatedTime
                    resp['timeLeft'] = max(0, int(resp.get('totalDuration', 0) - resp.get('accumulatedTime', 0)))
                elif state == 'pause':
                    resp['timeLeft'] = resp.get('timeLeft', 0)
                elif state in ('idle', 'completed'):
                    phase = resp.get('phase', 'focus')
                    if phase == 'focus':
                        resp['timeLeft'] = resp.get('focusDuration', 25) * 60
                    elif phase == 'longBreak':
                        resp['timeLeft'] = resp.get('longBreakDuration', 15) * 60
                    else:
                        resp['timeLeft'] = resp.get('shortBreakDuration', 5) * 60
                self.send_json_response(resp)
            return

        if path == '/api/notifications':
            with pending_notifications_lock:
                notifs = list(pending_notifications)
                pending_notifications.clear()
            self.send_json_response(notifs)
            return

        if path == '/api/holiday-data':
            holiday_file = os.path.join(DIRECTORY, 'holiday_data.json')
            try:
                if os.path.exists(holiday_file):
                    with open(holiday_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    cleaned = {k: v for k, v in data.items() if not k.startswith('_')}
                    self.send_json_response(cleaned)
                else:
                    self.send_json_response({})
            except Exception as e:
                print("Error loading holiday data: %s" % str(e))
                self.send_json_response({})
            return

        # 附件能力探测（FR-06）：前端据此决定是否展示上传入口。
        # 两个入口（index / index_offline）都由本服务提供，故不能用 _WEB_VERSION 判断
        # 「有没有服务端」，只能实测。
        if path == '/api/attachments/capabilities':
            self.send_json_response({
                'enabled': True,
                'maxBytes': ATTACHMENT_MAX_BYTES,
                'mime': sorted(ATTACHMENT_ALLOWED_MIME)
            })
            return

        # 任务附件读取（FR-06）：/api/attachments/<taskId>/<fileId>
        # 图片 inline 展示（Markdown 插图需要），其余一律 attachment 下载 + nosniff，杜绝内联执行
        if path.startswith('/api/attachments/'):
            parts = path[len('/api/attachments/'):].split('/')
            if len(parts) != 2 or not parts[0] or not parts[1]:
                self.send_error_json("Invalid attachment path", 400)
                return
            task_id = attachment_safe_id(urllib.parse.unquote(parts[0]))
            file_id = attachment_safe_id(urllib.parse.unquote(parts[1]))
            fp = attachment_find_file(task_id, file_id) if task_id and file_id else None
            if not fp:
                self.send_error_json("Attachment not found", 404)
                return
            try:
                with open(fp, 'rb') as f:
                    body = f.read()
            except OSError:
                self.send_error_json("Read attachment failed", 500)
                return
            mime = mimetypes.guess_type(fp)[0] or 'application/octet-stream'
            # 仅栅格图片允许 inline；SVG 等同源可执行内容一律按附件下载
            is_image = mime in ATTACHMENT_INLINE_MIME
            display_name = os.path.basename(fp)[len(file_id) + 1:] or 'file'
            try:
                quoted = urllib.parse.quote(display_name, safe='')
            except Exception:
                quoted = 'file'
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Content-Disposition',
                             ('inline' if is_image else 'attachment') +
                             '; filename="%s"; filename*=UTF-8\'\'%s' % (display_name.encode('ascii', 'ignore').decode() or 'file', quoted))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'private, max-age=3600')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(body)
            return

        if path == '/api/platform':
            self.send_json_response({
                'platform': 'windows' if IS_WINDOWS else 'linux',
                'isWindows': IS_WINDOWS
            })
            return

        # 背景图轮播：当前轮播状态（客户端 5s 轮询，switchId 变化时应用新图）
        if path == '/api/bg-carousel':
            with bg_carousel_lock:
                resp = _bg_carousel_public_state_locked()
            self.send_json_response(resp)
            return

        # 背景图轮播：内置目录浏览器（系统目录对话框不可用时的兜底，零外部依赖）
        if path == '/api/bg-carousel/browse-directory':
            query = urllib.parse.parse_qs(parsed.query)
            target = (query.get('path') or [''])[0]
            self.send_json_response(_bg_browse_directory(target))
            return

        # 背景图轮播：当前图片字节流（URL 携带 ?v=switchId，切换后地址变化天然绕过缓存）
        if path == '/api/bg-carousel/image':
            with bg_carousel_lock:
                current = bg_carousel_state.get('currentFile', '')
            if not current or not os.path.isfile(current):
                self.send_error_json("No carousel image", 404)
                return
            ext = os.path.splitext(current)[1].lower()
            content_type = BG_CAROUSEL_MIME.get(ext, 'application/octet-stream')
            try:
                with open(current, 'rb') as f:
                    content = f.read()
            except Exception:
                self.send_error_json("Read carousel image failed", 500)
                return
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_cors_headers()
            # 图片内容随 v 参数寻址，可长缓存（换图后 URL 改变）
            self.send_header('Cache-Control', 'public, max-age=604800')
            self.end_headers()
            self.wfile.write(content)
            return

        if path == '/api/autostart':
            if IS_WINDOWS:
                try:
                    startup_dir = os.path.join(os.environ.get('APPDATA', ''),
                                               r'Microsoft\Windows\Start Menu\Programs\Startup')
                    name = '日程管理'
                    shortcut_path = os.path.join(startup_dir, name + '.lnk')
                    enabled = os.path.exists(shortcut_path)
                except Exception:
                    enabled = False
            else:
                # Linux: check autostart .desktop file
                autostart_dir = os.path.expanduser('~/.config/autostart')
                autostart_file = os.path.join(autostart_dir, 'schedule-manager.desktop')
                enabled = os.path.exists(autostart_file)
            self.send_json_response({'enabled': enabled, 'platform': 'windows' if IS_WINDOWS else 'linux'})
            return

        if path == '/api/network-info':
            local_ip = get_local_ip()
            file_data = load_data_from_file()
            s = file_data.get('settings', {})
            bind_address = s.get('bindAddress', '127.0.0.1')
            self.send_json_response({
                'localIp': local_ip,
                'bindAddress': bind_address,
                'port': PORT,
                'localhostUrl': 'http://127.0.0.1:%d' % PORT,
                'lanUrl': 'http://%s:%d' % (local_ip, PORT) if bind_address == '0.0.0.0' else None,
                'backupDir': BACKUP_DIR
            })
            return

        # WebDAV 手动同步：配置与云端状态（设置面板打开时拉取）
        if path == '/api/webdav/status':
            self.send_json_response(webdav_status())
            return

        # WebDAV 轻量状态：主视图「同步」入口用，只读本地配置、不联网
        if path == '/api/webdav/config/summary':
            self.send_json_response(webdav_config_summary())
            return

        if path == '/api/export':
            export_data = build_export_payload()
            fmt = (urllib.parse.parse_qs(parsed.query).get('format') or ['zip'])[0].lower()
            if fmt == 'json':
                # 兼容旧入口/脚本：只取结构化数据（不含附件二进制）
                body = json.dumps(export_data, ensure_ascii=False, indent=2).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Disposition', 'attachment; filename="schedule-backup-%s.json"' % datetime.now(timezone.utc).strftime('%Y-%m-%d'))
                self.send_header('Content-Length', str(len(body)))
                self.send_cors_headers()
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.end_headers()
                self.wfile.write(body)
                return
            # 默认 zip：data.json + attachments/（附件此前完全不进导出包）
            tmp_path = build_export_zip_tempfile(export_data)
            try:
                self.send_file_download(tmp_path, EXPORT_ZIP_NAME % datetime.now().strftime('%Y-%m-%d'),
                                        'application/zip')
            finally:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            return

        # 服务端备份：保存到 backups 目录（zip，含附件）
        if path == '/api/backup':
            try:
                filename = create_backup_file()
                self.send_json_response({'success': True, 'filename': filename})
            except Exception as e:
                print("Backup error: %s" % str(e))
                self.send_json_response({'success': False, 'error': str(e)})
            return

        # 备份文件列表
        if path == '/api/backups':
            if not os.path.exists(BACKUP_DIR):
                self.send_json_response({'backups': []})
                return
            files = []
            for f in sorted(os.listdir(BACKUP_DIR)):
                # .zip = 当前格式（含附件）；.json = 历史备份，一并列出以便用户自行取用
                if f.endswith('.json') or f.endswith('.zip'):
                    fp = os.path.join(BACKUP_DIR, f)
                    st = os.stat(fp)
                    files.append({
                        'filename': f,
                        'size': st.st_size,
                        'date': datetime.fromtimestamp(st.st_mtime).isoformat()
                    })
            self.send_json_response({'backups': files})
            return

        # 备份文件下载
        if path.startswith('/api/backups/download/'):
            filename = path[len('/api/backups/download/'):]
            # 防止路径遍历
            filename = os.path.basename(filename)
            filepath = os.path.join(BACKUP_DIR, filename)
            if not os.path.exists(filepath):
                self.send_error_json("Backup not found", 404)
                return
            ctype = 'application/zip' if filename.endswith('.zip') else 'application/json; charset=utf-8'
            self.send_file_download(filepath, filename, ctype)
            return

        if path == '/' or path == '':
            # 默认使用离线版本（本地资源），用户可在设置中切换到在线版本
            path = '/index_offline.html'

        self.serve_static_file(path)

    def do_PUT(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path == '/api/data':
                global _data_version
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length > 30 * 1024 * 1024:
                    self.send_error_json("Data too large", 413)
                    return
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return

                # 多线程下串行化"版本检查+写入"，避免并发保存互相覆盖
                with data_lock:
                    client_version = data.pop('_version', -1)
                    conflict_data = None
                    if client_version >= 0 and client_version != _data_version:
                        # 版本冲突：返回当前服务器数据，让客户端合并后重试
                        conflict_data = load_data_from_file()
                        conflict_data['_version'] = _data_version
                    else:
                        # 客户端全量数据只含 5 个主体键，不含服务端自管的顶层键
                        # （continuousTomatoCount / continuousTomatoCountDate），
                        # 直接整文件覆盖会抹掉刚持久化的连续番茄数，写盘前补齐
                        try:
                            existing = load_data_from_file()
                            for _srv_key in ('continuousTomatoCount', 'continuousTomatoCountDate'):
                                if _srv_key in existing:
                                    data[_srv_key] = existing[_srv_key]
                        except Exception:
                            pass
                        save_data_to_file(data)
                        _data_version += 1
                if conflict_data is not None:
                    self.send_json_response({"status": "conflict", "currentData": conflict_data, "serverVersion": conflict_data['_version']})
                    return

                # 同步 settings 中的番茄配置项到服务器内存 pomodoro_state
                # （导入数据或 saveSettings 写入 data.json 后，服务器内存需同步，
                #   否则 syncPomodoroFromServer 会用旧值覆盖前端，且后台 tick 用旧值判断 autoBreak/autoFocus）
                s = data.get('settings', {})
                with pomodoro_lock:
                    pomodoro_state['focusDuration'] = s.get('focusDuration', pomodoro_state.get('focusDuration', 25))
                    pomodoro_state['shortBreakDuration'] = s.get('shortBreakDuration', pomodoro_state.get('shortBreakDuration', 5))
                    pomodoro_state['longBreakDuration'] = s.get('longBreakDuration', pomodoro_state.get('longBreakDuration', 15))
                    pomodoro_state['longBreakInterval'] = s.get('longBreakInterval', pomodoro_state.get('longBreakInterval', 4))
                    pomodoro_state['autoBreak'] = s.get('autoBreak', pomodoro_state.get('autoBreak', False))
                    pomodoro_state['autoFocus'] = s.get('autoFocus', pomodoro_state.get('autoFocus', False))

                global notified_reminder_keys
                task_prefixes = tuple('%s@' % t['id'] for t in data.get('tasks', []) if t.get('id'))
                with notified_task_ids_lock:
                    # 仅保留仍存在的任务（按 task_id 前缀匹配，天然覆盖子任务键）。
                    # 任务时间变化时新 key 含新的 base_ms，旧键自动失效；此处一并清理同任务旧键，避免集合无限增长。
                    if task_prefixes:
                        notified_reminder_keys = {
                            k for k in notified_reminder_keys if k.startswith(task_prefixes)
                        }
                    else:
                        notified_reminder_keys = set()
                with snoozed_reminders_lock:
                    for k in [k for k in snoozed_reminders
                              if not (task_prefixes and k.startswith(task_prefixes))]:
                        del snoozed_reminders[k]

                self.send_json_response({"status": "ok", "version": _data_version})
                return

            self.send_error_json("Not found", 404)
        except Exception as e:
            print("PUT error: %s" % str(e))
            sys.stdout.flush()
            try:
                self.send_error(500, str(e))
            except Exception:
                pass

    def do_PATCH(self):
        # 增量保存单个任务：避免每次勾选/编辑都序列化并传输全量数据（5510 任务 + 416 历史）
        global _data_version, notified_reminder_keys
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path.startswith('/api/tasks/'):
                task_id = urllib.parse.unquote(path[len('/api/tasks/'):])
                if not task_id:
                    self.send_error_json("Missing task id", 400)
                    return
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length > 5 * 1024 * 1024:
                    self.send_error_json("Task data too large", 413)
                    return
                body = self.rfile.read(content_length)
                try:
                    task = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return

                # 原子地读取-修改-写回单个任务（data_lock + 文件锁双重串行化）
                with data_lock:
                    lock_fd = acquire_file_lock()
                    try:
                        if os.path.exists(DATA_FILE):
                            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                                data = json.load(f)
                        else:
                            data = json.loads(json.dumps(DEFAULT_DATA))
                        for key in DEFAULT_DATA:
                            if key not in data:
                                data[key] = DEFAULT_DATA[key]
                        if not data.get('taskLists'):
                            data['taskLists'] = DEFAULT_DATA['taskLists']
                        if not data.get('settings'):
                            data['settings'] = dict(DEFAULT_DATA['settings'])
                        elif 'defaultListId' not in data['settings']:
                            data['settings']['defaultListId'] = 'default'

                        tasks_list = data.get('tasks', [])
                        found = False
                        old_start = ''
                        for i in range(len(tasks_list)):
                            if tasks_list[i].get('id') == task_id:
                                old_start = tasks_list[i].get('startTime', '')
                                tasks_list[i] = task
                                found = True
                                break
                        if not found:
                            tasks_list.append(task)
                        data['tasks'] = tasks_list

                        with open(DATA_FILE, 'w', encoding='utf-8') as f:
                            json.dump(data, f, ensure_ascii=False, indent=2)
                    finally:
                        release_file_lock(lock_fd)
                    _data_version += 1

                # 任务时间变化时清除该任务（含子任务）的通知标记，允许在新时间重新提醒
                new_start = task.get('startTime', '')
                if new_start != old_start:
                    pfx = '%s@' % task_id
                    with notified_task_ids_lock:
                        notified_reminder_keys = {
                            k for k in notified_reminder_keys if not k.startswith(pfx)
                        }
                        # 同步清理该任务的稍后提醒项
                        with snoozed_reminders_lock:
                            for k in [k for k in snoozed_reminders if k.startswith(pfx)]:
                                del snoozed_reminders[k]

                self.send_json_response({"status": "ok", "version": _data_version})
                return

            self.send_error_json("Not found", 404)
        except Exception as e:
            print("PATCH error: %s" % str(e))
            sys.stdout.flush()
            try:
                self.send_error(500, str(e))
            except Exception:
                pass

    def do_DELETE(self):
        # 任务附件删除（FR-06）：
        #   DELETE /api/attachments                      清空全部附件（重置数据时级联）
        #   DELETE /api/attachments/<taskId>/<fileId>    删单个文件
        #   DELETE /api/attachments/task/<taskId>        删整个目录（任务被永久删除时级联，C6-3）
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            if path == '/api/attachments':
                # 重置数据：任务集清空后附件目录里的文件已成孤儿，一并清掉
                if os.path.isdir(ATTACHMENT_DIR):
                    shutil.rmtree(ATTACHMENT_DIR, ignore_errors=True)
                self.send_json_response({'success': True})
                return
            if path.startswith('/api/attachments/task/'):
                task_id = attachment_safe_id(urllib.parse.unquote(path[len('/api/attachments/task/'):]))
                if not task_id:
                    self.send_error_json("Missing taskId", 400)
                    return
                folder = os.path.join(ATTACHMENT_DIR, task_id)
                if os.path.isdir(folder):
                    shutil.rmtree(folder, ignore_errors=True)
                self.send_json_response({'success': True})
                return

            if path.startswith('/api/attachments/'):
                parts = path[len('/api/attachments/'):].split('/')
                if len(parts) != 2 or not parts[0] or not parts[1]:
                    self.send_error_json("Invalid attachment path", 400)
                    return
                task_id = attachment_safe_id(urllib.parse.unquote(parts[0]))
                file_id = attachment_safe_id(urllib.parse.unquote(parts[1]))
                fp = attachment_find_file(task_id, file_id) if task_id and file_id else None
                if not fp:
                    self.send_error_json("Attachment not found", 404)
                    return
                try:
                    os.remove(fp)
                except OSError as e:
                    self.send_error_json("Delete attachment failed: %s" % str(e), 500)
                    return
                # 目录空了顺手清掉，避免磁盘留一堆空目录
                try:
                    folder = os.path.dirname(fp)
                    if not os.listdir(folder):
                        os.rmdir(folder)
                except OSError:
                    pass
                self.send_json_response({'success': True})
                return

            self.send_error_json("Not found", 404)
        except Exception as e:
            print("DELETE error: %s" % str(e))
            sys.stdout.flush()
            try:
                self.send_error(500, str(e))
            except Exception:
                pass

    def do_POST(self):
        global pomodoro_notified, notified_reminder_keys
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            # 任务附件上传（FR-06）：POST /api/attachments/upload?taskId=xxx&name=<urlencoded>
            # 直接用裸字节体上传（请求体即文件内容），不走 multipart：
            #   Python 3.13 已移除 cgi 模块，零第三方依赖前提下自解析 multipart 只会增加脆弱面；
            #   文件名走 query（URL 编码），二进制完全不经解析。
            if path == '/api/attachments/upload':
                query = urllib.parse.parse_qs(parsed.query)
                task_id = attachment_safe_id((query.get('taskId') or [''])[0])
                if not task_id:
                    self.send_error_json("Missing taskId", 400)
                    return
                try:
                    content_length = int(self.headers.get('Content-Length', 0))
                except ValueError:
                    content_length = 0
                if content_length <= 0:
                    self.send_error_json("Empty body", 400)
                    return
                if content_length > ATTACHMENT_MAX_BYTES:
                    self.send_error_json("File too large (max 20MB)", 413)
                    return
                mime = (self.headers.get('Content-Type') or 'application/octet-stream').split(';')[0].strip().lower()
                if mime not in ATTACHMENT_ALLOWED_MIME:
                    self.send_error_json("Unsupported file type: %s" % mime, 415)
                    return
                body = self.rfile.read(content_length)
                if len(body) != content_length:
                    self.send_error_json("Incomplete upload", 400)
                    return
                raw_name = (query.get('name') or ['file'])[0]
                display_name = attachment_safe_name(raw_name)
                file_id = 'att_' + uuid.uuid4().hex[:12]
                folder = os.path.join(ATTACHMENT_DIR, task_id)
                try:
                    os.makedirs(folder, exist_ok=True)
                    with open(os.path.join(folder, file_id + '_' + display_name), 'wb') as f:
                        f.write(body)
                except OSError as e:
                    self.send_error_json("Write attachment failed: %s" % str(e), 500)
                    return
                self.send_json_response({
                    'id': file_id,
                    'name': display_name,
                    'size': len(body),
                    'mime': mime,
                    'addedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                })
                return

            if path == '/api/autostart':
                content_length = int(self.headers.get('Content-Length', 0))
                body_raw = self.rfile.read(content_length)
                try:
                    body = json.loads(body_raw.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                enabled = body.get('enabled', False)
                if IS_WINDOWS:
                    try:
                        import pythoncom
                        from win32com.shell import shell, shellcon
                        startup_dir = os.path.join(os.environ.get('APPDATA', ''),
                                                   r'Microsoft\Windows\Start Menu\Programs\Startup')
                        name = '日程管理'
                        shortcut_path = os.path.join(startup_dir, name + '.lnk')
                        if enabled:
                            pythoncom.CoInitialize()
                            try:
                                ws = pythoncom.CoCreateInstance(
                                    shell.CLSID_ShellLink, None,
                                    pythoncom.CLSCTX_INPROC_SERVER,
                                    shell.IID_IShellLink)
                                ws.SetPath(os.path.join(DIRECTORY, 'start.bat'))
                                ws.SetWorkingDirectory(DIRECTORY)
                                ws.SetIconLocation(os.path.join(DIRECTORY, 'favicon.ico'), 0)
                                ws.QueryInterface(pythoncom.IID_IPersistFile).Save(shortcut_path, 0)
                            finally:
                                pythoncom.CoUninitialize()
                        else:
                            if os.path.exists(shortcut_path):
                                os.remove(shortcut_path)
                        self.send_json_response({'success': True, 'enabled': enabled})
                    except ImportError:
                        # Fallback: use PowerShell to create/remove shortcut
                        try:
                            app_dir = DIRECTORY.replace('\\', '\\\\')
                            if enabled:
                                ps_cmd = (
                                    "$n=-join([char[]](0x65E5,0x7A0B,0x7BA1,0x7406));"
                                    "$s=[Environment]::GetFolderPath('Startup');"
                                    "$ws=New-Object -ComObject WScript.Shell;"
                                    "$l=$ws.CreateShortcut($s+'\\'+$n+'.lnk');"
                                    "$l.TargetPath='%s';"
                                    "$l.WorkingDirectory='%s';"
                                    "$l.IconLocation='%s,0';"
                                    "$l.Save()"
                                ) % (os.path.join(DIRECTORY, 'start.bat'), app_dir,
                                     os.path.join(DIRECTORY, 'favicon.ico'))
                            else:
                                ps_cmd = (
                                    "$n=-join([char[]](0x65E5,0x7A0B,0x7BA1,0x7406));"
                                    "$s=[Environment]::GetFolderPath('Startup');"
                                    "$f=$s+'\\'+$n+'.lnk';"
                                    "if(Test-Path $f){Remove-Item $f -Force}"
                                )
                            subprocess.run(['powershell', '-ExecutionPolicy', 'Bypass',
                                            '-Command', ps_cmd], check=True, timeout=10)
                            self.send_json_response({'success': True, 'enabled': enabled})
                        except Exception as e:
                            self.send_json_response({'success': False, 'error': str(e)})
                    except Exception as e:
                        self.send_json_response({'success': False, 'error': str(e)})
                else:
                    # Linux: create/remove autostart .desktop file
                    try:
                        autostart_dir = os.path.expanduser('~/.config/autostart')
                        autostart_file = os.path.join(autostart_dir, 'schedule-manager.desktop')
                        if enabled:
                            os.makedirs(autostart_dir, exist_ok=True)
                            # Exec 经 bash 解释执行：与 install.sh 生成的自启动项口径
                            # 一致（noexec 挂载点可用）；Icon 用已安装的图标名
                            # （install.sh 安装到 hicolor；.ico 绝对路径多数 Linux DE 不渲染）
                            desktop_content = (
                                "[Desktop Entry]\n"
                                "Type=Application\n"
                                "Name=Schedule Manager\n"
                                "Exec=bash \"%s/autostart.sh\"\n"
                                "Icon=schedule-manager\n"
                                "Terminal=false\n"
                                "Categories=Utility;\n"
                            ) % (DIRECTORY,)
                            with open(autostart_file, 'w', encoding='utf-8') as f:
                                f.write(desktop_content)
                        else:
                            if os.path.exists(autostart_file):
                                os.remove(autostart_file)
                        self.send_json_response({'success': True, 'enabled': enabled})
                    except Exception as e:
                        self.send_json_response({'success': False, 'error': str(e)})
                return

            # 服务端备份
            if path == '/api/backup':
                try:
                    # 与 GET /api/export 同一份内容来源（含扩展字段 + 附件 zip）
                    filename = create_backup_file()
                    self.send_json_response({'success': True, 'filename': filename})
                except Exception as e:
                    print("Backup error: %s" % str(e))
                    self.send_json_response({'success': False, 'error': str(e)})
                return

            # 清理过期备份
            if path == '/api/backups/cleanup':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                retention_days = data.get('retentionDays', 0)
                if retention_days <= 0:
                    self.send_json_response({'deleted': 0})
                    return
                if not os.path.exists(BACKUP_DIR):
                    self.send_json_response({'deleted': 0})
                    return
                now = datetime.now()
                cutoff = now.timestamp() - retention_days * 24 * 60 * 60
                deleted = 0
                for f in os.listdir(BACKUP_DIR):
                    if f.endswith('.json') or f.endswith('.zip'):
                        fp = os.path.join(BACKUP_DIR, f)
                        if os.path.getmtime(fp) < cutoff:
                            os.remove(fp)
                            deleted += 1
                self.send_json_response({'deleted': deleted})
                return

            # WebDAV 手动同步：保存配置（password 留空表示沿用已保存的密码）
            if path == '/api/webdav/config':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    req_data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                if not isinstance(req_data, dict):
                    self.send_error_json("Invalid data format", 400)
                    return
                new_url = (req_data.get('url') or '').strip()
                new_username = (req_data.get('username') or '').strip()
                if not new_url:
                    self.send_error_json("请填写 WebDAV 地址", 400)
                    return
                if not new_url.startswith(('http://', 'https://')):
                    self.send_error_json("WebDAV 地址需以 http:// 或 https:// 开头", 400)
                    return
                if not new_username:
                    self.send_error_json("请填写用户名", 400)
                    return
                allow_insecure = bool(req_data.get('allowInsecure'))
                if new_url.lower().startswith('http://') and not allow_insecure:
                    self.send_error_json('HTTP 地址会明文传输凭据；如确需使用请勾选「允许不安全连接」', 400)
                    return
                with webdav_lock:
                    cfg = load_webdav_config()
                    new_cfg = {
                        'url': new_url,
                        'username': new_username,
                        'password': cfg.get('password', ''),
                        'allowInsecure': allow_insecure,
                    }
                    # 保留同步时间等附加字段
                    for key in ('lastPushAt', 'lastPullAt'):
                        if cfg.get(key):
                            new_cfg[key] = cfg[key]
                    if req_data.get('password'):
                        new_cfg['password'] = _encode_webdav_password(req_data['password'])
                    if not new_cfg['password']:
                        self.send_error_json("请填写应用密码", 400)
                        return
                    saved = save_webdav_config(new_cfg)
                if saved:
                    self.send_json_response({'ok': True, 'message': 'WebDAV 配置已保存'})
                else:
                    self.send_error_json('配置保存失败', 500)
                return

            # WebDAV 手动同步：清空本机配置（不删除云端文件）
            if path == '/api/webdav/config/reset':
                try:
                    with webdav_lock:
                        if os.path.exists(WEBDAV_CONFIG_FILE):
                            os.remove(WEBDAV_CONFIG_FILE)
                    self.send_json_response({'ok': True, 'message': 'WebDAV 配置已重置'})
                except Exception as e:
                    self.send_error_json('重置失败：%s' % str(e), 500)
                return

            # WebDAV 手动同步：测试连接（用表单中的临时值，无需先保存）
            if path == '/api/webdav/test':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    req_data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                password = req_data.get('password') or ''
                if not password:
                    # 表单密码留空表示沿用已保存的密码（与 /api/webdav/config 一致）
                    with webdav_lock:
                        saved_cfg = load_webdav_config()
                    password = _get_webdav_password(saved_cfg)
                test_cfg = {
                    'url': (req_data.get('url') or '').strip(),
                    'username': req_data.get('username') or '',
                    'password': password,
                    'allowInsecure': bool(req_data.get('allowInsecure')),
                }
                self.send_json_response(webdav_test_connection(test_cfg))
                return

            # WebDAV 手动同步：上传本地数据到云端
            if path == '/api/webdav/push':
                with webdav_lock:
                    cfg = load_webdav_config()
                self.send_json_response(webdav_push_data(cfg))
                return

            # WebDAV 手动同步：从云端下载并覆盖本地
            if path == '/api/webdav/pull':
                with webdav_lock:
                    cfg = load_webdav_config()
                self.send_json_response(webdav_pull_data(cfg))
                return

            if path == '/api/notify':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                title = data.get('title', '提醒')
                body_text = data.get('body', '')
                task_id = data.get('taskId', None)
                send_notify_send(title, body_text, task_id=task_id)
                play_notification_sound()
                self.send_json_response({"status": "ok"})
                return

            # 背景图轮播：更新配置（立即生效）。body 可含 enabled/directory/interval/
            # intervalUnit/order 任意子集，响应始终携带最新完整状态。
            if path == '/api/bg-carousel/config':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                with bg_carousel_lock:
                    # 重置数据专用：整表还原默认（enabled=false、目录/间隔/顺序清零、
                    # 运行时进度归零），优先于其余字段处理
                    if data.get('reset'):
                        _bg_carousel_reset_locked()
                        resp = _bg_carousel_public_state_locked()
                        resp['success'] = True
                        self.send_json_response(resp)
                        return
                    directory_changed = False
                    enabled_changed = False
                    interval_changed = False
                    if 'directory' in data:
                        new_dir = str(data.get('directory') or '').strip()
                        if new_dir and not os.path.isdir(new_dir):
                            resp = _bg_carousel_public_state_locked()
                            resp['success'] = False
                            resp['reason'] = 'directory_not_found'
                            self.send_json_response(resp)
                            return
                        if new_dir != bg_carousel_state.get('directory', ''):
                            bg_carousel_state['directory'] = new_dir
                            directory_changed = True
                    if 'enabled' in data:
                        new_enabled = bool(data.get('enabled'))
                        if new_enabled != bool(bg_carousel_state.get('enabled')):
                            bg_carousel_state['enabled'] = new_enabled
                            enabled_changed = True
                    if 'interval' in data:
                        try:
                            new_interval = max(1, min(365, int(data.get('interval', 30))))
                        except (TypeError, ValueError):
                            new_interval = 30
                        if new_interval != bg_carousel_state.get('interval'):
                            bg_carousel_state['interval'] = new_interval
                            interval_changed = True
                    if 'intervalUnit' in data:
                        new_unit = data.get('intervalUnit')
                        if new_unit in BG_CAROUSEL_UNIT_SECONDS and new_unit != bg_carousel_state.get('intervalUnit'):
                            bg_carousel_state['intervalUnit'] = new_unit
                            interval_changed = True
                    if 'order' in data:
                        new_order = data.get('order')
                        if new_order in ('sequential', 'random'):
                            bg_carousel_state['order'] = new_order

                    now = time.time()
                    if directory_changed:
                        if bg_carousel_state.get('enabled'):
                            # 新目录：立即换图（从新目录第一张/随机一张开始）
                            _bg_carousel_advance_locked()
                        else:
                            # 禁用状态下变更/清空目录（删除按钮）：仅持久化，不换图、不报错
                            _bg_carousel_save_locked()
                    elif enabled_changed and bg_carousel_state.get('enabled'):
                        if bg_carousel_state.get('directory'):
                            # 重新启用：当前图仍有效则原样重发，否则重新选图
                            _bg_carousel_advance_locked(keep_current=True)
                        else:
                            # 尚未配置目录：保持 no_directory 状态，由面板空目录提示引导
                            _bg_carousel_save_locked()
                    elif enabled_changed and not bg_carousel_state.get('enabled'):
                        _bg_carousel_save_locked()
                    elif interval_changed and bg_carousel_state.get('enabled'):
                        # 间隔变更：以新间隔重启节奏
                        bg_carousel_state['nextSwitchAt'] = now + _bg_carousel_interval_seconds_locked()
                        _bg_carousel_save_locked()
                    else:
                        _bg_carousel_save_locked()
                    resp = _bg_carousel_public_state_locked()
                    resp['success'] = True
                self.send_json_response(resp)
                return

            # 背景图轮播：手动调试「下一张」（立即切换，节奏从头计）
            if path == '/api/bg-carousel/next':
                with bg_carousel_lock:
                    if not bg_carousel_state.get('enabled'):
                        resp = _bg_carousel_public_state_locked()
                        resp['success'] = False
                        resp['reason'] = 'not_enabled'
                        self.send_json_response(resp)
                        return
                    _bg_carousel_advance_locked()
                    resp = _bg_carousel_public_state_locked()
                    resp['success'] = True
                self.send_json_response(resp)
                return

            # 背景图轮播：弹出系统目录选择对话框（在服务器所在机器上）
            if path == '/api/bg-carousel/pick-directory':
                path_picked, reason = _bg_pick_directory_dialog()
                if path_picked:
                    self.send_json_response({'success': True, 'path': path_picked})
                else:
                    # reason 让前端能区分"用户取消"和"环境没有图形对话框"，
                    # 后者自动降级到内置目录浏览器（见 app.js bgCarouselSelectDirectory）
                    resp = {'success': False, 'reason': reason or 'unavailable'}
                    if reason == 'unavailable':
                        resp['message'] = ('当前系统没有可用的图形目录选择组件'
                                           '（缺少 python3-tk / zenity 等），已切换为内置目录浏览器')
                    elif reason == 'error':
                        resp['message'] = '系统目录对话框调用失败，已切换为内置目录浏览器'
                    self.send_json_response(resp)
                return

            if path == '/api/shutdown':
                self.send_json_response({"status": "shutting_down"})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return

            if path == '/api/restart':
                self.send_json_response({"status": "restarting"})
                def do_restart():
                    # 用子进程重新启动自身，然后关闭当前进程
                    import subprocess as _sp
                    _sp.Popen(
                        [sys.executable] + sys.argv,
                        cwd=DIRECTORY,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    self.server.shutdown()
                threading.Thread(target=do_restart, daemon=True).start()
                return

            if path == '/api/pomodoro/start':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                with pomodoro_lock:
                    now_str = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                    pomodoro_state['running'] = True
                    pomodoro_state['startedAt'] = now_str
                    pomodoro_state['lastTickTime'] = now_str
                    pomodoro_state['phase'] = data.get('phase', pomodoro_state.get('phase', 'focus'))
                    pomodoro_state['state'] = 'focusing' if pomodoro_state['phase'] == 'focus' else 'resting'
                    if pomodoro_state['phase'] == 'focus':
                        pomodoro_state['originalStartedAt'] = now_str
                        pomodoro_state['accumulatedTime'] = 0
                        pomodoro_state['totalFocusedSeconds'] = 0
                        if 'completedTaskDuringFocus' in pomodoro_state:
                            del pomodoro_state['completedTaskDuringFocus']
                    elif not pomodoro_state.get('originalStartedAt'):
                        pass  # 保持原值
                    pomodoro_state['totalDuration'] = data.get('totalDuration', pomodoro_state.get('focusDuration', 25) * 60)
                    pomodoro_state['currentTaskId'] = data.get('currentTaskId', pomodoro_state.get('currentTaskId'))
                    pomodoro_state['taskName'] = data.get('taskName', '')
                    pomodoro_state['completedPomodoros'] = data.get('completedPomodoros', pomodoro_state.get('completedPomodoros', 0))
                    pomodoro_state['focusDuration'] = data.get('focusDuration', pomodoro_state.get('focusDuration', 25))
                    pomodoro_state['shortBreakDuration'] = data.get('shortBreakDuration', pomodoro_state.get('shortBreakDuration', 5))
                    pomodoro_state['longBreakDuration'] = data.get('longBreakDuration', pomodoro_state.get('longBreakDuration', 15))
                    pomodoro_state['longBreakInterval'] = data.get('longBreakInterval', pomodoro_state.get('longBreakInterval', 4))
                    pomodoro_state['breakDuration'] = data.get('breakDuration', pomodoro_state.get('breakDuration', 5))
                    pomodoro_state['autoBreak'] = data.get('autoBreak', pomodoro_state.get('autoBreak', False))
                    pomodoro_state['autoFocus'] = data.get('autoFocus', pomodoro_state.get('autoFocus', False))
                    pomodoro_notified = False
                self.send_json_response({"status": "ok"})
                return

            if path == '/api/pomodoro/stop':
                with pomodoro_lock:
                    # Tick-based: accumulatedTime 已由轮询线程维护，无需手动计算
                    pomodoro_state['running'] = False
                    pomodoro_state['state'] = 'pause'
                    # 计算当前剩余时间保存
                    total = pomodoro_state.get('totalDuration', 0)
                    acc = pomodoro_state.get('accumulatedTime', 0)
                    pomodoro_state['timeLeft'] = max(0, int(total - acc))
                    # 读取客户端发来的 timeLeft（优先使用客户端精确值）
                    content_length = int(self.headers.get('Content-Length', 0))
                    if content_length > 0:
                        try:
                            body = self.rfile.read(content_length)
                            data = json.loads(body.decode('utf-8'))
                            if data.get('timeLeft', -1) >= 0:
                                pomodoro_state['timeLeft'] = data.get('timeLeft', 0)
                        except Exception:
                            pass
                    # 将accumulatedTime转入totalFocusedSeconds，确保从暂停状态结束时历史时长正确
                    pomodoro_state['totalFocusedSeconds'] = pomodoro_state.get('totalFocusedSeconds', 0) + acc
                    pomodoro_state['accumulatedTime'] = 0
                    pomodoro_state['totalDuration'] = 0
                self.send_json_response({"status": "ok"})
                return

            if path == '/api/pomodoro/reset':
                with pomodoro_lock:
                    pomodoro_state['running'] = False
                    pomodoro_state['state'] = 'idle'
                    pomodoro_state['phase'] = 'focus'
                    pomodoro_state['startedAt'] = None
                    pomodoro_state['originalStartedAt'] = None
                    pomodoro_state['totalDuration'] = 0
                    pomodoro_state['accumulatedTime'] = 0
                    pomodoro_state['totalFocusedSeconds'] = 0
                    pomodoro_state['currentTaskId'] = None
                    pomodoro_state['completedPomodoros'] = 0
                    pomodoro_state['continuousTomatoCount'] = 0
                    pomodoro_state['taskName'] = ''
                    pomodoro_state['lastTickTime'] = None
                    pomodoro_state['timeLeft'] = 0
                    # 「重置数据」专用端点：同步清零 data.json 中持久化的连续番茄数。
                    # 不写盘的话，重启后会从 data.json 复活旧计数；且客户端紧随其后的
                    # 全量 PUT 会从现有文件补齐该键（见 do_PUT），旧值会立即写回。
                    # 持 data_lock 与 PUT 的"读文件补齐+写盘"互斥即可：两请求虽并发
                    # 在途，任一串行顺序的最终落盘值都是 0。刻意不抬 _data_version——
                    # 抬升会让重置标签页正在途的 PUT 判为版本冲突，触发冲突合并把
                    # 服务器旧任务/清单合并回来，反而破坏重置。
                    # 锁序 pomodoro_lock → data_lock 与 _save_pomodoro_history_entry
                    # 一致（PUT 处理器为顺序获取、不嵌套，无死锁）。
                    try:
                        with data_lock:
                            file_data = load_data_from_file()
                            file_data['continuousTomatoCount'] = 0
                            file_data['continuousTomatoCountDate'] = datetime.now().strftime('%Y-%m-%d')
                            save_data_to_file(file_data)
                    except Exception as e:
                        print("Reset continuousTomatoCount error: %s" % str(e))
                self.send_json_response({"status": "ok"})
                return

            if path == '/api/pomodoro/resume':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                with pomodoro_lock:
                    now_str = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                    # 将暂停前的累计时间转入totalFocusedSeconds，重置accumulatedTime
                    # 这样 timeLeft = totalDuration - accumulatedTime 计算才正确
                    prev_acc = pomodoro_state.get('accumulatedTime', 0)
                    pomodoro_state['totalFocusedSeconds'] = pomodoro_state.get('totalFocusedSeconds', 0) + prev_acc
                    pomodoro_state['accumulatedTime'] = 0
                    pomodoro_state['running'] = True
                    pomodoro_state['startedAt'] = now_str
                    pomodoro_state['lastTickTime'] = now_str
                    pomodoro_state['totalDuration'] = data.get('timeLeft', 0)
                    pomodoro_state['state'] = 'focusing' if pomodoro_state.get('phase') == 'focus' else 'resting'
                    # 保持 originalStartedAt 不变
                    pomodoro_notified = False
                self.send_json_response({"status": "ok"})
                return

            if path == '/api/pomodoro/complete':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                with pomodoro_lock:
                    # 如果已经不在运行状态（服务器已通过Tick完成结算），直接返回当前状态
                    if not pomodoro_state.get('running') and pomodoro_state.get('state') in ('completed', 'idle'):
                        result = {
                            "phase": pomodoro_state.get('phase', 'focus'),
                            "state": pomodoro_state.get('state', 'idle'),
                            "continuousTomatoCount": pomodoro_state.get('continuousTomatoCount', 0),
                            "breakDuration": pomodoro_state.get('breakDuration', 5),
                            "completedPomodoros": pomodoro_state.get('completedPomodoros', 0),
                            "autoBreak": pomodoro_state.get('autoBreak', False),
                            "autoFocus": pomodoro_state.get('autoFocus', False)
                        }
                        self.send_json_response(result)
                        return

                    # 客户端触发的完成：执行结算
                    split_info = data.get('splitInfo')
                    if not split_info:
                        split_info = pomodoro_state.get('completedTaskDuringFocus')
                    _do_pomodoro_complete(split_info)
                    # 清理服务器端存储的拆分信息
                    if 'completedTaskDuringFocus' in pomodoro_state:
                        del pomodoro_state['completedTaskDuringFocus']

                    # 检查 autoFocus 是否应被拦截
                    auto_focus_blocked = False
                    if pomodoro_state.get('state') == 'idle' and pomodoro_state.get('autoFocus'):
                        last_activity = pomodoro_state.get('lastUserActivityAt')
                        if last_activity:
                            try:
                                activity_time = parse_iso_datetime(last_activity)
                                inactive_seconds = (datetime.now(timezone.utc) - activity_time).total_seconds()
                                # 阈值：longBreakInterval 个完整专注-休息周期的时长
                                cycle_duration = (pomodoro_state.get('focusDuration', 25) + pomodoro_state.get('shortBreakDuration', 5)) * 60
                                threshold = pomodoro_state.get('longBreakInterval', 4) * cycle_duration
                                if inactive_seconds > threshold:
                                    auto_focus_blocked = True
                            except Exception:
                                pass

                    result = {
                        "phase": pomodoro_state.get('phase', 'focus'),
                        "state": pomodoro_state.get('state', 'idle'),
                        "continuousTomatoCount": pomodoro_state.get('continuousTomatoCount', 0),
                        "breakDuration": pomodoro_state.get('breakDuration', 5),
                        "completedPomodoros": pomodoro_state.get('completedPomodoros', 0),
                        "autoFocusBlocked": auto_focus_blocked,
                        "autoBreak": pomodoro_state.get('autoBreak', False),
                        "autoFocus": pomodoro_state.get('autoFocus', False)
                    }
                self.send_json_response(result)
                return

            if path == '/api/pomodoro/abandon':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                with pomodoro_lock:
                    save_time = data.get('saveTime', False)
                    current_task_id = data.get('currentTaskId', pomodoro_state.get('currentTaskId'))
                    task_name = data.get('taskName', pomodoro_state.get('taskName', ''))
                    split_info = data.get('splitInfo')
                    # 合并服务器端存储的拆分信息
                    if not split_info:
                        split_info = pomodoro_state.get('completedTaskDuringFocus')
                    if save_time and pomodoro_state.get('phase') == 'focus':
                        # 使用 totalFocusedSeconds + accumulatedTime 计算跨暂停/恢复周期的总专注时长
                        # 暂停状态下 accumulatedTime 已转入 totalFocusedSeconds（为0），直接相加即可
                        total_elapsed = pomodoro_state.get('totalFocusedSeconds', 0) + pomodoro_state.get('accumulatedTime', 0)
                        duration_minutes = round(total_elapsed / 60)
                        if duration_minutes > 0:
                            now_str = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                            original_started = pomodoro_state.get('originalStartedAt')
                            # 处理多任务拆分记录
                            if split_info and split_info.get('completedTasks'):
                                completed_tasks = split_info['completedTasks']
                                prev_started_at = original_started
                                for task in completed_tasks:
                                    ended_at = original_started
                                    if original_started and task.get('elapsedSeconds'):
                                        try:
                                            orig_dt = datetime.fromisoformat(original_started.replace('Z', '+00:00'))
                                            ended_at = (orig_dt + timedelta(seconds=task['elapsedSeconds'])).isoformat().replace('+00:00', 'Z')
                                        except Exception:
                                            ended_at = original_started
                                    entry = {
                                        "date": now_str,
                                        "startedAt": prev_started_at,
                                        "endedAt": ended_at,
                                        "duration": max(1, round(task.get('durationSeconds', 0) / 60)),
                                        "taskName": task.get('taskName', '一般专注'),
                                        "taskId": task.get('taskId')
                                    }
                                    _save_pomodoro_history_entry(entry)
                                    prev_started_at = ended_at
                                last_task = completed_tasks[-1]
                                remaining_seconds = total_elapsed - last_task.get('elapsedSeconds', 0)
                                if remaining_seconds > 0:
                                    entry = {
                                        "date": now_str,
                                        "startedAt": prev_started_at,
                                        "endedAt": now_str,
                                        "duration": max(1, round(remaining_seconds / 60)),
                                        "taskName": task_name or '一般专注',
                                        "taskId": current_task_id
                                    }
                                    _save_pomodoro_history_entry(entry)
                            elif split_info and split_info.get('completedElapsedSeconds') is not None:
                                completed_seconds = split_info['completedElapsedSeconds']
                                remaining_seconds = total_elapsed - completed_seconds
                                b_started_at = original_started
                                if original_started:
                                    try:
                                        orig_dt = datetime.fromisoformat(original_started.replace('Z', '+00:00'))
                                        b_started_at = (orig_dt + timedelta(seconds=completed_seconds)).isoformat().replace('+00:00', 'Z')
                                    except Exception:
                                        b_started_at = original_started
                                entry1 = {
                                    "date": now_str,
                                    "startedAt": original_started,
                                    "endedAt": b_started_at,
                                    "duration": max(1, round(completed_seconds / 60)),
                                    "taskName": split_info.get('completedTaskName', '一般专注'),
                                    "taskId": split_info.get('completedTaskId')
                                }
                                entry2 = {
                                    "date": now_str,
                                    "startedAt": b_started_at,
                                    "endedAt": now_str,
                                    "duration": max(1, round(remaining_seconds / 60)),
                                    "taskName": task_name or '一般专注',
                                    "taskId": current_task_id
                                }
                                _save_pomodoro_history_entry(entry1)
                                _save_pomodoro_history_entry(entry2)
                            elif split_info and split_info.get('completedTaskId'):
                                history_entry = {
                                    "date": now_str,
                                    "startedAt": original_started,
                                    "endedAt": now_str,
                                    "duration": duration_minutes,
                                    "taskName": split_info.get('completedTaskName', task_name or '一般专注'),
                                    "taskId": split_info.get('completedTaskId')
                                }
                                _save_pomodoro_history_entry(history_entry)
                            else:
                                history_entry = {
                                    "date": now_str,
                                    "startedAt": original_started,
                                    "endedAt": now_str,
                                    "duration": duration_minutes,
                                    "taskName": task_name or '一般专注',
                                    "taskId": current_task_id
                                }
                                _save_pomodoro_history_entry(history_entry)
                    pomodoro_state['continuousTomatoCount'] = 0
                    # 同步持久化重置（持锁 + 抬版本，防止被旧版本号的全量 PUT 覆盖）
                    try:
                        with data_lock:
                            file_data = load_data_from_file()
                            file_data['continuousTomatoCount'] = 0
                            file_data['continuousTomatoCountDate'] = datetime.now().strftime('%Y-%m-%d')
                            save_data_to_file(file_data)
                            _bump_data_version()
                    except Exception:
                        pass
                    pomodoro_state['running'] = False
                    pomodoro_state['state'] = 'idle'
                    pomodoro_state['phase'] = 'focus'
                    pomodoro_state['startedAt'] = None
                    pomodoro_state['totalDuration'] = 0
                    pomodoro_state['accumulatedTime'] = 0
                    pomodoro_state['totalFocusedSeconds'] = 0
                    pomodoro_state['originalStartedAt'] = None
                    if 'completedTaskDuringFocus' in pomodoro_state:
                        del pomodoro_state['completedTaskDuringFocus']
                self.send_json_response({"status": "ok"})
                return

            if path == '/api/pomodoro/skip_rest':
                with pomodoro_lock:
                    # 跳过休息：回到 idle，保留 continuousTomatoCount
                    pomodoro_state['running'] = False
                    pomodoro_state['state'] = 'idle'
                    pomodoro_state['phase'] = 'focus'
                    pomodoro_state['startedAt'] = None
                    pomodoro_state['totalDuration'] = 0
                    pomodoro_state['accumulatedTime'] = 0
                    pomodoro_state['totalFocusedSeconds'] = 0
                    pomodoro_state['originalStartedAt'] = None
                    # continuousTomatoCount 严格保留不变
                self.send_json_response({"status": "ok"})
                return

            if path == '/api/pomodoro/update':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                # 白名单：只允许更新任务关联相关字段，防止客户端篡改状态机字段
                allowed_keys = ('currentTaskId', 'taskName')
                with pomodoro_lock:
                    for key in allowed_keys:
                        if key in data:
                            pomodoro_state[key] = data[key]
                self.send_json_response({"status": "ok"})
                return

            if path == '/api/pomodoro/heartbeat':
                # 用户活跃心跳：更新 lastUserActivityAt
                with pomodoro_lock:
                    pomodoro_state['lastUserActivityAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                self.send_json_response({"status": "ok"})
                return

            if path == '/api/pomodoro/task_completed_during_focus':
                # 专注过程中任务被完成：服务器端记录拆分点
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                with pomodoro_lock:
                    # 计算服务器端的已专注秒数
                    acc = pomodoro_state.get('accumulatedTime', 0)
                    total_focused = pomodoro_state.get('totalFocusedSeconds', 0)
                    server_elapsed = total_focused + acc
                    pomodoro_state['completedTaskDuringFocus'] = {
                        'completedTaskId': data.get('taskId'),
                        'completedTaskName': data.get('taskName'),
                        'completedElapsedSeconds': server_elapsed
                    }
                self.send_json_response({"status": "ok"})
                return

            if path == '/api/pomodoro/sync_now':
                # 客户端倒计时归零时调用：客户端是"播放器"，倒计时归零是权威信号。
                # 服务器必须在此刻立即完成结算——不依赖自身的 accumulatedTime 是否追上，
                # 否则浏览器时钟略快时，服务器响应仍是旧状态（focusing/focus），导致
                # 客户端用"休息时长 + 专注状态"组合错误地以专注动画/彩蛋启动休息。
                #
                # 关键修复：只有当服务端当前 phase 与客户端 completedPhase 一致时才强制结算。
                # 如果服务端已经进入下一阶段（如已自动启动休息），说明服务端 tick 先完成了
                # 前一阶段的结算，此时不应再强制结算当前阶段（否则会跳过休息）。
                content_length = int(self.headers.get('Content-Length', 0))
                req_data = {}
                if content_length > 0:
                    try:
                        body = self.rfile.read(content_length)
                        req_data = json.loads(body.decode('utf-8'))
                    except Exception:
                        pass
                client_completed_phase = req_data.get('completedPhase', None)
                force_completed_phase = None
                with pomodoro_lock:
                    current_phase = pomodoro_state.get('phase', 'focus')
                    # 只有当服务端当前阶段与客户端完成的阶段一致时，才强制结算
                    # 这避免了客户端专注倒计时归零时，服务端已在休息阶段而被错误强制完成休息
                    should_force = (pomodoro_state.get('running')
                                    and not pomodoro_notified
                                    and (client_completed_phase is None or current_phase == client_completed_phase))
                    if should_force:
                        force_completed_phase = current_phase
                        pomodoro_state['accumulatedTime'] = pomodoro_state.get('totalDuration', 0)
                        pomodoro_notified = True
                        # 优先使用客户端发送的splitInfo（包含B切换时间等最新信息）
                        split_info = req_data.get('splitInfo')
                        if not split_info:
                            split_info = pomodoro_state.get('completedTaskDuringFocus')
                        _do_pomodoro_complete(split_info)
                        if 'completedTaskDuringFocus' in pomodoro_state:
                            del pomodoro_state['completedTaskDuringFocus']
                        # 服务器端发送完成通知
                        notify_info = None
                        if pomodoro_state.get('state') == 'completed':
                            if pomodoro_state.get('phase') == 'longBreak':
                                notify_info = ('专注完成', '你完成了一个番茄，好好休息一下吧~')
                            else:
                                notify_info = ('专注完成', '你完成了一个番茄，短暂休息一下吧~')
                            # 自动休息：服务器端直接启动休息倒计时
                            if pomodoro_state.get('autoBreak'):
                                break_seconds = pomodoro_state.get('breakDuration', 5) * 60
                                now_str2 = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                                pomodoro_state['running'] = True
                                pomodoro_state['startedAt'] = now_str2
                                pomodoro_state['lastTickTime'] = now_str2
                                pomodoro_state['state'] = 'resting'
                                pomodoro_state['totalDuration'] = break_seconds
                                pomodoro_state['accumulatedTime'] = 0
                                pomodoro_state['totalFocusedSeconds'] = 0
                                pomodoro_state['timeLeft'] = break_seconds
                                pomodoro_notified = False
                        else:
                            notify_info = ('休息结束', '准备好开始新的专注了吗？')
                            # 自动专注：服务器端直接启动专注倒计时
                            if pomodoro_state.get('autoFocus'):
                                auto_focus_blocked = False
                                last_activity = pomodoro_state.get('lastUserActivityAt')
                                if last_activity:
                                    try:
                                        activity_time = parse_iso_datetime(last_activity)
                                        inactive_seconds = (datetime.now(timezone.utc) - activity_time).total_seconds()
                                        cycle_duration = (pomodoro_state.get('focusDuration', 25) + pomodoro_state.get('shortBreakDuration', 5)) * 60
                                        threshold = pomodoro_state.get('longBreakInterval', 4) * cycle_duration
                                        if inactive_seconds > threshold:
                                            auto_focus_blocked = True
                                    except Exception:
                                        pass
                                if not auto_focus_blocked:
                                    focus_seconds = pomodoro_state.get('focusDuration', 25) * 60
                                    now_str2 = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                                    pomodoro_state['running'] = True
                                    pomodoro_state['startedAt'] = now_str2
                                    pomodoro_state['lastTickTime'] = now_str2
                                    pomodoro_state['state'] = 'focusing'
                                    pomodoro_state['phase'] = 'focus'
                                    pomodoro_state['totalDuration'] = focus_seconds
                                    pomodoro_state['accumulatedTime'] = 0
                                    pomodoro_state['totalFocusedSeconds'] = 0
                                    pomodoro_state['timeLeft'] = focus_seconds
                                    pomodoro_notified = False
                        if notify_info:
                            send_notify_send(notify_info[0], notify_info[1], category='pomodoro')
                            play_notification_sound()
                with pomodoro_lock:
                    resp = dict(pomodoro_state)
                    state = resp.get('state', 'idle')
                    if resp.get('running'):
                        resp['timeLeft'] = max(0, int(resp.get('totalDuration', 0) - resp.get('accumulatedTime', 0)))
                    elif state == 'pause':
                        resp['timeLeft'] = resp.get('timeLeft', 0)
                    elif state in ('idle', 'completed'):
                        phase = resp.get('phase', 'focus')
                        if phase == 'focus':
                            resp['timeLeft'] = resp.get('focusDuration', 25) * 60
                        elif phase == 'longBreak':
                            resp['timeLeft'] = resp.get('longBreakDuration', 15) * 60
                        else:
                            resp['timeLeft'] = resp.get('shortBreakDuration', 5) * 60
                    # 告知客户端是否由 sync_now 触发了强制结算及结算的阶段
                    if force_completed_phase is not None:
                        resp['forceCompletedPhase'] = force_completed_phase
                self.send_json_response(resp)
                return

            if path == '/api/migrate':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                save_data_to_file(data)
                self.send_json_response({"status": "ok"})
                return

            # 完整数据导入：data.json 主体 + 扩展字段（归档专注历史/节假日数据/背景轮播配置）
            if path == '/api/import':
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length > 64 * 1024 * 1024:
                    self.send_error_json("Data too large", 413)
                    return
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                ok, err = apply_import_payload(data)
                if not ok:
                    self.send_error_json(err or 'Invalid data format', 400)
                    return
                # 纯 JSON 导入不含附件文件，提示调用方（前端据此提醒用户）
                self.send_json_response({"status": "ok", "attachmentsIncluded": False})
                return

            # zip 导入（导出/备份包）：data.json + attachments/ 一并还原
            if path == '/api/import/zip':
                try:
                    content_length = int(self.headers.get('Content-Length', 0))
                except ValueError:
                    content_length = 0
                if content_length <= 0:
                    self.send_error_json("Empty body", 400)
                    return
                if content_length > IMPORT_MAX_BYTES:
                    self.send_error_json("File too large", 413)
                    return
                tmp_fd, tmp_zip = tempfile.mkstemp(prefix='tacklist-import-', suffix='.zip')
                try:
                    with os.fdopen(tmp_fd, 'wb') as f:
                        remaining = content_length
                        while remaining > 0:
                            chunk = self.rfile.read(min(256 * 1024, remaining))
                            if not chunk:
                                break
                            f.write(chunk)
                            remaining -= len(chunk)
                    ok, err = import_from_zip(tmp_zip)
                finally:
                    try:
                        os.remove(tmp_zip)
                    except OSError:
                        pass
                if not ok:
                    self.send_error_json(err or 'Import failed', 400)
                    return
                self.send_json_response({"status": "ok", "attachmentsIncluded": True})
                return

            if path == '/api/holiday-data':
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length > 1024 * 1024:
                    self.send_error_json("Data too large", 413)
                    return
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                holiday_file = os.path.join(DIRECTORY, 'holiday_data.json')
                try:
                    with open(holiday_file, 'w', encoding='utf-8') as f:
                        json.dump(data, f, ensure_ascii=False, indent=4)
                    self.send_json_response({"status": "ok"})
                except Exception as e:
                    print("Error saving holiday data: %s" % str(e))
                    self.send_error_json("Failed to save holiday data", 500)
                return

            if path == '/api/holiday-fetch':
                # 在线版独有：从 timor.tech / jiejiariapi.com 抓取当年调休数据
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length) if content_length else b''
                params = {}
                if body:
                    try:
                        params = json.loads(body.decode('utf-8'))
                    except Exception:
                        params = {}
                year = params.get('year') or str(datetime.now().year)
                custom_api = params.get('apiUrl', '').strip()

                # 默认 API 列表：timor.tech 主，jiejiariapi 备
                apis = []
                if custom_api:
                    apis.append(custom_api.rstrip('/') + '/' + year)
                apis.append('https://timor.tech/api/holiday/year/%s/' % year)
                apis.append('https://www.jiejiariapi.com/v1/holidays/%s' % year)

                result = None
                errors = []
                for api_url in apis:
                    try:
                        req = urllib.request.Request(api_url, headers={
                            'User-Agent': 'Mozilla/5.0 (TackList Scheduler)',
                            'Accept': 'application/json'
                        })
                        with urllib.request.urlopen(req, timeout=8) as resp:
                            raw = resp.read().decode('utf-8')
                            data = json.loads(raw)
                            # 转换为项目格式
                            converted = convert_holiday_api_data(data, year, api_url)
                            if converted:
                                result = converted
                                break
                    except Exception as e:
                        errors.append("%s: %s" % (api_url, str(e)))
                        continue

                if result:
                    # 写入 holiday_data.json（合并到已有数据）
                    holiday_file = os.path.join(DIRECTORY, 'holiday_data.json')
                    existing = {}
                    try:
                        if os.path.isfile(holiday_file):
                            with open(holiday_file, 'r', encoding='utf-8') as f:
                                existing = json.load(f)
                    except Exception:
                        existing = {}
                    existing[year] = result
                    try:
                        with open(holiday_file, 'w', encoding='utf-8') as f:
                            json.dump(existing, f, ensure_ascii=False, indent=4)
                        self.send_json_response({"status": "ok", "year": year, "data": result})
                    except Exception as e:
                        self.send_error_json("Failed to save: %s" % str(e), 500)
                else:
                    self.send_error_json("All APIs failed: %s" % '; '.join(errors), 502)
                return

            if path == '/api/reminder/clear':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                task_id = data.get('taskId')
                subtask_id = data.get('subtaskId')
                with notified_task_ids_lock:
                    if not task_id:
                        notified_reminder_keys.clear()
                    elif subtask_id:
                        # 只清除该子任务（含准点与各提前量）
                        pfx = '%s@%s@' % (task_id, subtask_id)
                        notified_reminder_keys = {
                            k for k in notified_reminder_keys if not k.startswith(pfx)
                        }
                    else:
                        # 清除该任务及其所有子任务
                        pfx = '%s@' % task_id
                        notified_reminder_keys = {
                            k for k in notified_reminder_keys if not k.startswith(pfx)
                        }
                self.send_json_response({"status": "ok"})
                return

            if path == '/api/reminder/snooze':
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body.decode('utf-8'))
                except Exception:
                    self.send_error_json("Invalid JSON", 400)
                    return
                task_id = data.get('taskId')
                subtask_id = data.get('subtaskId')
                delay_minutes = data.get('delayMinutes', 15)
                if not task_id:
                    self.send_error_json("taskId is required", 400)
                    return
                try:
                    delay_minutes = max(1, int(delay_minutes))
                except (TypeError, ValueError):
                    delay_minutes = 15
                now = datetime.now(timezone.utc)
                remind_after = int(now.timestamp() * 1000) + delay_minutes * 60 * 1000
                with snoozed_reminders_lock:
                    snoozed_reminders[_snooze_key(task_id, subtask_id)] = remind_after
                self.send_json_response({"status": "ok", "remindAfter": remind_after})
                return

            # 外部日历订阅同步（仅在线版；详见《外部日历订阅同步需求说明书.md》）
            if path == '/api/calendar-sync':
                try:
                    sync_result = _do_calendar_sync()
                    if 'error' in sync_result:
                        self.send_error_json(sync_result['error'], 500)
                    else:
                        self.send_json_response({'status': 'ok', 'version': _data_version, 'sync': sync_result})
                except Exception as e:
                    print("Calendar sync error: %s" % str(e))
                    sys.stdout.flush()
                    self.send_error_json("同步失败：%s" % str(e), 500)
                return

            self.send_error_json("Not found", 404)
        except Exception as e:
            print("POST error: %s" % str(e))
            sys.stdout.flush()
            try:
                self.send_error(500, str(e))
            except Exception:
                pass

    def serve_static_file(self, path):
        if path.startswith('/'):
            path = path[1:]
        filepath = os.path.join(DIRECTORY, path)
        filepath = os.path.normpath(filepath)
        if not filepath.startswith(DIRECTORY):
            self.send_error(403)
            return
        if not os.path.isfile(filepath):
            self.send_error(404)
            return

        ext = os.path.splitext(filepath)[1].lower()
        mime_types = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.eot': 'application/vnd.ms-fontobject',
            '.webp': 'image/webp',
            '.webm': 'video/webm',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.oga': 'audio/ogg',
        }
        content_type = mime_types.get(ext, 'application/octet-stream')

        try:
            with open(filepath, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_cors_headers()
            # 差异化缓存策略：HTML/JS/CSS 禁缓存（本地应用迭代频繁，确保改动即时生效），
            # 字体/图片等低频变动资源长缓存
            if ext in ('.html', '.js', '.css'):
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
            else:
                # 字体/图片等静态资源缓存 1 天
                self.send_header('Cache-Control', 'public, max-age=86400')
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            self.send_error(500)


def convert_holiday_api_data(data, year, api_url):
    """将 timor.tech / jiejiariapi 的返回数据转换为项目格式
    项目格式: { "holidays": {"MM-DD": "节日名"}, "workdays": {"MM-DD": "调休名"} }
    """
    holidays = {}
    workdays = {}

    # 简化名称映射：把"春节前补班"/"春节后补班"统一为"春节调休"
    def simplify_name(name):
        name = name.replace('前补班', '调休').replace('后补班', '调休')
        if name.endswith('调休') and not name.endswith('调休调休'):
            return name
        return name

    if 'timor.tech' in api_url:
        # timor.tech 格式: { "code": 0, "holiday": { "01-01": {"holiday": true, "name": "元旦", ...}, ... } }
        holiday_map = data.get('holiday', {})
        if not holiday_map:
            return None
        for date_key, info in holiday_map.items():
            # date_key 已是 "MM-DD" 格式
            name = info.get('name', '')
            if info.get('holiday') is True:
                holidays[date_key] = name
            elif info.get('holiday') is False:
                workdays[date_key] = simplify_name(name) if '调休' not in name else name
    elif 'jiejiariapi' in api_url:
        # jiejiariapi 格式: { "2025-01-01": {"date": "2025-01-01", "name": "元旦", "isOffDay": true}, ... }
        if not isinstance(data, dict) or not data:
            return None
        for date_key, info in data.items():
            # date_key 是 "YYYY-MM-DD" 格式，需切片取 "MM-DD"
            if '-' not in date_key:
                continue
            parts = date_key.split('-')
            if len(parts) != 3:
                continue
            mm_dd = '%s-%s' % (parts[1], parts[2])
            name = info.get('name', '')
            if info.get('isOffDay') is True:
                holidays[mm_dd] = name
            elif info.get('isOffDay') is False:
                workdays[mm_dd] = simplify_name(name) if '调休' not in name else name
    else:
        # 自定义 API：尝试两种格式
        if 'holiday' in data:
            holiday_map = data.get('holiday', {})
            for date_key, info in holiday_map.items():
                name = info.get('name', '') if isinstance(info, dict) else str(info)
                is_holiday = info.get('holiday', info.get('isOffDay', False)) if isinstance(info, dict) else False
                if is_holiday is True:
                    holidays[date_key[-5:]] = name
                elif is_holiday is False:
                    workdays[date_key[-5:]] = name
        else:
            for date_key, info in (data.items() if isinstance(data, dict) else []):
                if isinstance(info, dict):
                    name = info.get('name', '')
                    is_off = info.get('isOffDay', info.get('holiday', False))
                    mm_dd = date_key[-5:] if len(date_key) >= 5 else date_key
                    if is_off is True:
                        holidays[mm_dd] = name
                    elif is_off is False:
                        workdays[mm_dd] = name

    if not holidays and not workdays:
        return None

    # 名称标准化：参照2025年数据样本，将春节假期中各日期的不同名称
    # （除夕、初一、初二、...、初八、初九）统一为"春节"，以便正确分组
    LUNAR_NEW_YEAR_NAMES = {'除夕', '春节', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十'}
    for md, name in list(holidays.items()):
        if name in LUNAR_NEW_YEAR_NAMES:
            holidays[md] = '春节'

    return {"holidays": holidays, "workdays": workdays}


def main():
    global PORT

    os.chdir(DIRECTORY)

    data = load_data_from_file()
    # 一次性迁移：旧机制把超过 500 条的专注记录移入 pomodoro_archive/（界面不读取），
    # 现专注记录全量持久化于 data.json，启动时把历史归档并回主列表
    _migrate_pomodoro_archive_into_main(data)
    s = data.get('settings', {})
    with pomodoro_lock:
        pomodoro_state['focusDuration'] = s.get('focusDuration', 25)
        pomodoro_state['shortBreakDuration'] = s.get('shortBreakDuration', 5)
        pomodoro_state['longBreakDuration'] = s.get('longBreakDuration', 15)
        pomodoro_state['longBreakInterval'] = s.get('longBreakInterval', 4)
        pomodoro_state['autoBreak'] = s.get('autoBreak', False)
        pomodoro_state['autoFocus'] = s.get('autoFocus', False)
        # 从数据文件恢复 continuousTomatoCount（同一天则保留，跨天则重置）
        saved_count = data.get('continuousTomatoCount', 0)
        saved_date = data.get('continuousTomatoCountDate', '')
        today_str = datetime.now().strftime('%Y-%m-%d')
        if saved_date == today_str:
            pomodoro_state['continuousTomatoCount'] = saved_count
        else:
            pomodoro_state['continuousTomatoCount'] = 0

    bind_address = s.get('bindAddress', '127.0.0.1')
    configured_port = s.get('port', 14438)
    if isinstance(configured_port, int) and 1024 <= configured_port <= 65535:
        PORT = configured_port
    else:
        PORT = 14438

    httpd = None
    while True:
        try:
            # 多线程：首屏并行拉取静态资源/数据时不再阻塞，健康探测也不会超时误判
            httpd = ThreadingHTTPServer((bind_address, PORT), TodoHandler)
            break
        except OSError:
            PORT += 1
            if PORT > 65535:
                print("Error: No available port found")
                sys.exit(1)

    local_ip = get_local_ip()
    print("TackList Server running at http://127.0.0.1:%d" % PORT)
    if bind_address == '0.0.0.0':
        print("LAN access: http://%s:%d" % (local_ip, PORT))
    sys.stdout.flush()

    # 将实际端口和PID写入文件，供启动脚本读取
    try:
        port_file = os.path.join(DIRECTORY, 'server.port')
        with open(port_file, 'w') as pf:
            pf.write(str(PORT))
        pid_file = os.path.join(DIRECTORY, 'server.pid')
        with open(pid_file, 'w') as pf:
            pf.write(str(os.getpid()))
    except Exception:
        pass

    holiday_file = os.path.join(DIRECTORY, 'holiday_data.json')
    current_year = str(datetime.now().year)
    try:
        if os.path.exists(holiday_file):
            with open(holiday_file, 'r', encoding='utf-8') as f:
                h_data = json.load(f)
            if current_year not in h_data or not h_data[current_year].get('holidays'):
                print("WARNING: holiday_data.json missing data for year %s, please update" % current_year)
        else:
            print("WARNING: holiday_data.json not found, holiday/workday info will not be available")
    except Exception as e:
        print("WARNING: Error checking holiday data: %s" % str(e))

    reminder_thread = threading.Thread(target=reminder_checker_loop, daemon=True)
    reminder_thread.start()

    pomodoro_thread = threading.Thread(target=pomodoro_checker_loop, daemon=True)
    pomodoro_thread.start()

    # 背景图轮播：恢复持久化状态（含 nextSwitchAt，重启不重置倒计时）并启动守护线程
    _bg_carousel_load()
    bg_carousel_thread = threading.Thread(target=bg_carousel_loop, daemon=True)
    bg_carousel_thread.start()

    def cleanup_loop():
        while True:
            time.sleep(300)
            cleanup_notified_ids()
    cleanup_thread = threading.Thread(target=cleanup_loop, daemon=True)
    cleanup_thread.start()

    # Browser is opened by start.bat, not by server itself (avoids duplicate tabs)

    def shutdown(signum, frame):
        print("\nShutting down server...")
        # 清理端口和PID文件
        for fname in ['server.port', 'server.pid']:
            try:
                fpath = os.path.join(DIRECTORY, fname)
                if os.path.exists(fpath):
                    os.remove(fpath)
            except Exception:
                pass
        threading.Thread(target=httpd.shutdown, daemon=True).start()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass

    httpd.server_close()


if __name__ == '__main__':
    main()
