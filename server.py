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
import time
import signal
import socket

import urllib.parse
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta

PORT = 14438
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(DIRECTORY, 'data.json')
LOCK_FILE = os.path.join(DIRECTORY, '.data.lock')
ARCHIVE_DIR = os.path.join(DIRECTORY, 'pomodoro_archive')
BACKUP_DIR = os.path.join(DIRECTORY, 'backups')
POMODORO_HISTORY_LIMIT = 500

DEFAULT_DATA = {
    "taskLists": [{"id": "default", "name": "默认", "color": "#3b82f6"}],
    "tasks": [],
    "settings": {
        "defaultListId": "default",
        "defaultImportant": False,
        "defaultUrgent": False,
        "defaultDuration": 30,
        "defaultView": "task",
        "weekStart": "monday",
        "showCompleted": True,
        "showLunar": True,
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
        "port": 14438
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
notified_task_ids = set()
notified_task_ids_lock = threading.Lock()
# 稍后提醒队列: {task_id: remind_again_after_timestamp_ms}
snoozed_reminders = {}
snoozed_reminders_lock = threading.Lock()

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

def archive_pomodoro_history(history_list):
    """将超出上限的旧历史记录归档到 pomodoro_archive/ 目录，按月存储，不丢失数据。"""
    if len(history_list) <= POMODORO_HISTORY_LIMIT:
        return
    overflow = history_list[:-POMODORO_HISTORY_LIMIT]
    if not overflow:
        return
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    # 按月分组归档
    monthly = {}
    for entry in overflow:
        date_str = entry.get('date', entry.get('startedAt', ''))
        try:
            month_key = date_str[:7]  # "YYYY-MM"
        except Exception:
            month_key = 'unknown'
        monthly.setdefault(month_key, []).append(entry)
    for month_key, entries in monthly.items():
        archive_file = os.path.join(ARCHIVE_DIR, 'pomodoro_archive_%s.json' % month_key.replace('-', ''))
        existing = []
        if os.path.exists(archive_file):
            try:
                with open(archive_file, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            except Exception:
                existing = []
        # 合并去重
        existing_started = set(e.get('startedAt', '') for e in existing)
        for entry in entries:
            if entry.get('startedAt', '') not in existing_started:
                existing.append(entry)
                existing_started.add(entry.get('startedAt', ''))
        try:
            with open(archive_file, 'w', encoding='utf-8') as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print("Archive pomodoro history error: %s" % str(e))
    # 截断主列表，只保留最近记录
    history_list[:] = history_list[-POMODORO_HISTORY_LIMIT:]

def _save_pomodoro_history_entry(history_entry):
    """保存单条番茄历史记录（去重：startedAt+taskId组合唯一）。"""
    try:
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
            archive_pomodoro_history(history_list)
            save_data_to_file(file_data)
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
            file_data = load_data_from_file()
            file_data['continuousTomatoCount'] = pomodoro_state['continuousTomatoCount']
            file_data['continuousTomatoCountDate'] = today_str
            save_data_to_file(file_data)
        except Exception as e:
            print("Save continuousTomatoCount error: %s" % str(e))

        now_str = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        original_started = pomodoro_state.get('originalStartedAt')

        # 处理拆分记录：专注过程中任务被完成后切换了新任务
        # 修正：服务器端存储的 completedTaskDuringFocus 总是带有 completedElapsedSeconds（数值），
        # 但如果用户未切换到新任务（currentTaskId 为 None 或仍为已完成的任务），
        # 则不应拆分，整个时长归已完成任务。
        if split_info and split_info.get('completedElapsedSeconds') is not None:
            if current_task_id is None or current_task_id == split_info.get('completedTaskId'):
                # 未切换新任务：不拆分，整个时长归已完成任务
                split_info = dict(split_info)
                split_info['completedElapsedSeconds'] = None

        if split_info and split_info.get('completedElapsedSeconds') is not None:
            completed_seconds = split_info['completedElapsedSeconds']
            remaining_seconds = total_elapsed - completed_seconds
            # 计算新任务B的开始时间（= 专注开始时间 + 已完成任务时长 = 切换时刻）
            b_started_at = original_started
            if original_started:
                try:
                    orig_dt = datetime.fromisoformat(original_started.replace('Z', '+00:00'))
                    b_started_at = (orig_dt + timedelta(seconds=completed_seconds)).isoformat().replace('+00:00', 'Z')
                except Exception:
                    b_started_at = original_started
            # 第一条记录：已完成任务的时长（endedAt为切换到新任务B的时刻）
            entry1 = {
                "date": now_str,
                "startedAt": original_started,
                "endedAt": b_started_at,
                "duration": max(1, round(completed_seconds / 60)),
                "taskName": split_info.get('completedTaskName', '一般专注'),
                "taskId": split_info.get('completedTaskId')
            }
            # 第二条记录：新任务的时长（startedAt为切换时刻）
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
            # 未切换任务：整个时长归已完成任务
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

def send_notify_send(title, body, task_id=None, category=None):
    global _notify_env
    notif_data = {'title': title, 'body': body or ''}
    if task_id:
        notif_data['taskId'] = task_id
    if category:
        notif_data['category'] = category
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

def check_task_reminders():
    global notified_task_ids
    try:
        data = load_data_from_file()
        tasks = data.get('tasks', [])
        now = datetime.now(timezone.utc)
        now_ms = int(now.timestamp() * 1000)

        # Check snoozed reminders: if snooze time expired, re-notify
        with snoozed_reminders_lock:
            expired_snooze_ids = [tid for tid, ts in snoozed_reminders.items() if now_ms >= ts]
            for tid in expired_snooze_ids:
                del snoozed_reminders[tid]

        if expired_snooze_ids:
            for task in tasks:
                task_id = task.get('id', '')
                if task_id not in expired_snooze_ids:
                    continue
                if task.get('completed'):
                    continue
                with notified_task_ids_lock:
                    notified_task_ids.discard(task_id)
                task_name = task.get('title', '未命名任务')
                try:
                    task_time = parse_iso_datetime(task['startTime'])
                    local_time = task_time.astimezone()
                    time_str = local_time.strftime('%H:%M')
                except Exception:
                    time_str = '??:??'
                notes = task.get('notes', '')
                list_id = task.get('listId', '')
                list_name = ''
                for lst in data.get('taskLists', []):
                    if lst.get('id') == list_id:
                        list_name = lst.get('name', '')
                        break
                list_prefix = ''
                if list_name and list_name != '默认':
                    list_prefix = list_name + ' | '
                if notes and notes.strip():
                    title = '%s %s' % (time_str, task_name)
                    body = list_prefix + notes.strip()
                else:
                    title = time_str
                    body = list_prefix + task_name
                with notified_task_ids_lock:
                    notified_task_ids.add(task_id)
                send_notify_send(title, body, task_id=task_id)
                play_notification_sound()

        for task in tasks:
            if not task.get('startTime') or task.get('completed'):
                continue
            if task.get('isAllDay'):
                continue
            reminder = task.get('reminder', 0)
            task_id = task.get('id', '')
            with notified_task_ids_lock:
                if task_id in notified_task_ids:
                    continue

            try:
                task_time = parse_iso_datetime(task['startTime'])
                task_time_ms = int(task_time.timestamp() * 1000)
            except Exception:
                continue

            diff = task_time_ms - now_ms
            should_notify = False

            if reminder and reminder > 0:
                remind_ms = reminder * 60 * 1000
                if 0 < diff <= remind_ms:
                    should_notify = True
            else:
                if -30000 <= diff <= 30000:
                    should_notify = True

            if should_notify:
                with notified_task_ids_lock:
                    notified_task_ids.add(task_id)
                task_name = task.get('title', '未命名任务')
                local_time = task_time.astimezone()
                time_str = local_time.strftime('%H:%M')
                notes = task.get('notes', '')
                list_id = task.get('listId', '')
                list_name = ''
                for lst in data.get('taskLists', []):
                    if lst.get('id') == list_id:
                        list_name = lst.get('name', '')
                        break
                list_prefix = ''
                if list_name and list_name != '默认':
                    list_prefix = list_name + ' | '
                if notes and notes.strip():
                    title = '%s %s' % (time_str, task_name)
                    body = list_prefix + notes.strip()
                else:
                    title = time_str
                    body = list_prefix + task_name
                send_notify_send(title, body, task_id=task_id)
                play_notification_sound()
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
    global notified_task_ids
    try:
        data = load_data_from_file()
        tasks = data.get('tasks', [])
        valid_ids = set()
        for task in tasks:
            if task.get('id'):
                valid_ids.add(task['id'])
        with notified_task_ids_lock:
            notified_task_ids = notified_task_ids & valid_ids
        with snoozed_reminders_lock:
            invalid_snooze = [tid for tid in snoozed_reminders if tid not in valid_ids]
            for tid in invalid_snooze:
                del snoozed_reminders[tid]
    except Exception:
        pass


class TackListHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
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

        if path == '/api/platform':
            self.send_json_response({
                'platform': 'windows' if IS_WINDOWS else 'linux',
                'isWindows': IS_WINDOWS
            })
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

        if path == '/api/export':
            data = load_data_from_file()
            export_data = dict(data)
            export_data['version'] = '4.0'
            export_data['exportDate'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
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

        # 服务端备份：保存到 backups 目录
        if path == '/api/backup':
            data = load_data_from_file()
            export_data = dict(data)
            export_data['version'] = '4.0'
            export_data['exportDate'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            if not os.path.exists(BACKUP_DIR):
                os.makedirs(BACKUP_DIR)
            filename = 'schedule-backup-%s.json' % datetime.now().strftime('%Y%m%d-%H%M%S')
            filepath = os.path.join(BACKUP_DIR, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, ensure_ascii=False, indent=2)
            self.send_json_response({'success': True, 'filename': filename})
            return

        # 备份文件列表
        if path == '/api/backups':
            if not os.path.exists(BACKUP_DIR):
                self.send_json_response({'backups': []})
                return
            files = []
            for f in sorted(os.listdir(BACKUP_DIR)):
                if f.endswith('.json'):
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
            with open(filepath, 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="%s"' % filename)
            self.send_header('Content-Length', str(len(body)))
            self.send_cors_headers()
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()
            self.wfile.write(body)
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

                # 版本冲突检测：客户端提供的版本号必须匹配当前版本
                client_version = data.pop('_version', -1)
                if client_version >= 0 and client_version != _data_version:
                    # 版本冲突：返回当前服务器数据，让客户端合并后重试
                    current_data = load_data_from_file()
                    current_data['_version'] = _data_version
                    self.send_json_response({"status": "conflict", "currentData": current_data, "serverVersion": _data_version})
                    return

                # 清理内部字段后保存
                data.pop('_version', None)
                save_data_to_file(data)
                _data_version += 1

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

                global notified_task_ids
                with notified_task_ids_lock:
                    task_ids = set()
                    for task in data.get('tasks', []):
                        if task.get('id'):
                            task_ids.add(task['id'])
                    notified_task_ids = notified_task_ids & task_ids

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

    def do_POST(self):
        global pomodoro_notified
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

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
                            desktop_content = (
                                "[Desktop Entry]\n"
                                "Type=Application\n"
                                "Name=Schedule Manager\n"
                                "Exec=%s/start.sh\n"
                                "Icon=%s/favicon.ico\n"
                                "Terminal=false\n"
                                "Categories=Utility;\n"
                            ) % (DIRECTORY, DIRECTORY)
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
                    data = load_data_from_file()
                    export_data = dict(data)
                    export_data['version'] = '4.0'
                    export_data['exportDate'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                    if not os.path.exists(BACKUP_DIR):
                        os.makedirs(BACKUP_DIR)
                    filename = 'schedule-backup-%s.json' % datetime.now().strftime('%Y%m%d-%H%M%S')
                    filepath = os.path.join(BACKUP_DIR, filename)
                    with open(filepath, 'w', encoding='utf-8') as f:
                        json.dump(export_data, f, ensure_ascii=False, indent=2)
                    self.send_json_response({'success': True, 'filename': filename})
                except Exception as e:
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
                    if f.endswith('.json'):
                        fp = os.path.join(BACKUP_DIR, f)
                        if os.path.getmtime(fp) < cutoff:
                            os.remove(fp)
                            deleted += 1
                self.send_json_response({'deleted': deleted})
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
                            # 处理拆分记录
                            if split_info and split_info.get('completedElapsedSeconds') is not None:
                                completed_seconds = split_info['completedElapsedSeconds']
                                remaining_seconds = total_elapsed - completed_seconds
                                # 计算新任务B的开始时间（= 专注开始时间 + 已完成任务时长 = 切换时刻）
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
                    # 同步持久化重置
                    try:
                        file_data = load_data_from_file()
                        file_data['continuousTomatoCount'] = 0
                        file_data['continuousTomatoCountDate'] = datetime.now().strftime('%Y-%m-%d')
                        save_data_to_file(file_data)
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

            if path == '/api/import':
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

                if not (data.get('lists') or data.get('tasks')):
                    self.send_error_json("Invalid data format", 400)
                    return

                save_data_to_file(data)
                self.send_json_response({"status": "ok"})
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
                with notified_task_ids_lock:
                    if task_id:
                        notified_task_ids.discard(task_id)
                    else:
                        notified_task_ids.clear()
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
                delay_minutes = data.get('delayMinutes', 15)
                if not task_id:
                    self.send_error_json("taskId is required", 400)
                    return
                now = datetime.now(timezone.utc)
                remind_after = int(now.timestamp() * 1000) + delay_minutes * 60 * 1000
                with snoozed_reminders_lock:
                    snoozed_reminders[task_id] = remind_after
                self.send_json_response({"status": "ok", "remindAfter": remind_after})
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
            # 差异化缓存策略：HTML 禁缓存（确保改动即时生效），静态资源长缓存
            if ext == '.html':
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
            else:
                # CSS/JS/字体/图片等静态资源缓存 1 天
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
            httpd = HTTPServer((bind_address, PORT), TackListHandler)
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
