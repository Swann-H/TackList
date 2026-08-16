#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""TackList 启动编排器。

针对"点快捷方式后 127.0.0.1 拒绝连接"的加固：
- 单实例锁：连点快捷方式不会出现多个启动流程互相杀进程、端口漂移
- 健康探测直连 127.0.0.1（绕过系统代理），并校验响应内容，避免误判
- 服务确认健康后才打开浏览器；失败时弹窗提示并附日志末尾
- 只清理确认僵死的 python 进程，不误杀忙碌中的健康服务

用法：python launcher.py [start|stop|restart]
"""

import ctypes
import json
import os
import subprocess
import sys
import time
import urllib.request

DIRECTORY = os.path.dirname(os.path.abspath(__file__))
SERVER_SCRIPT = os.path.join(DIRECTORY, 'server.py')
LOG_FILE = os.path.join(DIRECTORY, 'server.log')
PORT_FILE = os.path.join(DIRECTORY, 'server.port')
PID_FILE = os.path.join(DIRECTORY, 'server.pid')
LAUNCH_LOCK = os.path.join(DIRECTORY, 'launch.lock')
DATA_FILE = os.path.join(DIRECTORY, 'data.json')

DEFAULT_PORT = 14438
HEALTH_TIMEOUT = 60          # 冷启动（杀毒扫描等）最长等待秒数
ZOMBIE_CONFIRM_SECONDS = 10  # 判定占端口的进程僵死前的观察期
LOCK_FRESH_SECONDS = 90      # 认为另一个启动器仍在工作的窗口期

# pythonw 下 stdout/stderr 为 None，统一落到日志文件
if sys.stdout is None:
    sys.stdout = open(LOG_FILE, 'a', encoding='utf-8')
if sys.stderr is None:
    sys.stderr = open(LOG_FILE, 'a', encoding='utf-8')


def log(msg):
    print('[%s] launcher: %s' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg))
    try:
        sys.stdout.flush()
    except Exception:
        pass


def read_preferred_port():
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            p = json.load(f).get('settings', {}).get('port', DEFAULT_PORT)
        if isinstance(p, int) and 1024 <= p <= 65535:
            return p
    except Exception:
        pass
    return DEFAULT_PORT


_no_proxy_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_alive(port, timeout=2):
    """直连探测（不走系统代理）。必须是本应用的 /api/platform 响应才算存活，
    避免端口被其他程序占用时误开浏览器。"""
    try:
        with _no_proxy_opener.open('http://127.0.0.1:%d/api/platform' % port,
                                   timeout=timeout) as resp:
            if resp.status != 200:
                return False
            body = resp.read(256).decode('utf-8', 'replace')
            return 'platform' in body
    except Exception:
        return False


def read_small_int(path):
    try:
        with open(path, 'r') as f:
            return int(f.read().strip())
    except Exception:
        return None


def remove_file(path):
    try:
        os.remove(path)
    except OSError:
        pass


def pid_alive(pid):
    if not pid or pid <= 0 or pid == os.getpid():
        return False
    if os.name == 'nt':
        try:
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not handle:
                return False
            kernel32.CloseHandle(handle)
            return True
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def port_listener_pids(port):
    """返回监听该端口的所有 PID。"""
    pids = set()
    try:
        out = subprocess.run(['netstat', '-ano', '-p', 'tcp'],
                             capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[0] == 'TCP' and parts[3] == 'LISTENING':
                if parts[1].endswith(':%d' % port):
                    try:
                        pids.add(int(parts[4]))
                    except ValueError:
                        pass
    except Exception:
        pass
    return pids


def is_python_pid(pid):
    try:
        out = subprocess.run(['tasklist', '/FI', 'PID eq %d' % pid, '/FO', 'CSV'],
                             capture_output=True, text=True, timeout=10).stdout
        return 'python' in out.lower()
    except Exception:
        return False


def kill_pids(pids):
    for pid in pids:
        if pid == os.getpid():
            continue
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(pid), '/F'],
                               capture_output=True, timeout=10)
            else:
                os.kill(pid, 15)
        except Exception:
            pass


def message_box(text):
    try:
        if os.name == 'nt':
            ctypes.windll.user32.MessageBoxW(0, text, 'TackList', 0x10)
    except Exception:
        pass


def open_browser(port):
    url = 'http://127.0.0.1:%d' % port
    try:
        os.startfile(url)
    except Exception:
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception:
            pass


def acquire_launch_lock():
    try:
        fd = os.open(LAUNCH_LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except OSError:
        return False


def launch_lock_stale():
    try:
        return time.time() - os.path.getmtime(LAUNCH_LOCK) > LOCK_FRESH_SECONDS
    except OSError:
        return True


def find_healthy_port(candidates, timeout=2):
    for p in candidates:
        if p and http_alive(p, timeout=timeout):
            return p
    return None


def spawn_server():
    log_fp = open(LOG_FILE, 'a', encoding='utf-8')
    exe = sys.executable
    base, _ = os.path.splitext(exe)
    pythonw = base + 'w.exe'
    if os.path.exists(pythonw):
        exe = pythonw
    kwargs = {}
    if os.name == 'nt':
        kwargs['creationflags'] = (subprocess.CREATE_NEW_PROCESS_GROUP |
                                   subprocess.CREATE_NO_WINDOW)
    return subprocess.Popen([exe, SERVER_SCRIPT], cwd=DIRECTORY,
                            stdout=log_fp, stderr=log_fp,
                            stdin=subprocess.DEVNULL, **kwargs)


def log_tail(lines=12):
    try:
        with open(LOG_FILE, 'r', encoding='utf-8', errors='replace') as f:
            return ''.join(f.readlines()[-lines:]).strip()
    except Exception:
        return '(无法读取 server.log)'


def show_startup_failure(preferred, proc=None):
    reason = ''
    if proc is not None and proc.poll() is not None:
        reason = '服务进程启动后立即退出（退出码 %s）。' % proc.poll()
    msg = (u'%s\n\n'
           u'常见原因：\n'
           u'1. 杀毒软件拦截了 python / server.py，建议将本目录加入白名单\n'
           u'2. 端口 %d 被其他程序占用\n'
           u'3. Python 环境异常\n\n'
           u'—— server.log 末尾 ——\n%s'
           % (reason or (u'服务在 %d 秒内未能完成启动。' % HEALTH_TIMEOUT),
              preferred, log_tail()))
    log('startup failed:\n%s' % msg)
    message_box(msg)


def do_start(preferred):
    file_port = read_small_int(PORT_FILE)

    # 清理失效的 pid/port 文件（对应进程已不存在，或端口上并非本服务）
    old_pid = read_small_int(PID_FILE)
    if old_pid is not None and not pid_alive(old_pid):
        remove_file(PID_FILE)
        remove_file(PORT_FILE)
        file_port = None
    if file_port is not None and not http_alive(file_port, timeout=2):
        remove_file(PORT_FILE)

    # 端口被占用但服务无响应：观察期内多次探测，仍僵死且是 python 进程才清理，
    # 避免"服务正忙着加载页面被误杀"的老问题
    zombie_ports = {preferred}
    if file_port is not None:
        zombie_ports.add(file_port)
    for port in zombie_ports:
        listeners = port_listener_pids(port)
        if not listeners or http_alive(port, timeout=2):
            continue
        log('port %d occupied by %s, observing...' % (port, sorted(listeners)))
        deadline = time.time() + ZOMBIE_CONFIRM_SECONDS
        while time.time() < deadline:
            time.sleep(2)
            if http_alive(port, timeout=2):
                log('port %d became healthy, no cleanup needed' % port)
                break
            listeners = port_listener_pids(port)
            if not listeners:
                break
        if listeners and not http_alive(port, timeout=2):
            zombies = {p for p in listeners if is_python_pid(p)}
            if zombies:
                log('killing zombie server pids on port %d: %s' % (port, sorted(zombies)))
                kill_pids(zombies)
                deadline = time.time() + 10
                while time.time() < deadline and port_listener_pids(port):
                    time.sleep(1)
            # 非 python 进程占用端口：不杀，交给 server.py 的端口漂移逻辑

    log('starting server...')
    try:
        proc = spawn_server()
    except Exception as e:
        show_startup_failure(preferred)
        log('spawn error: %s' % e)
        return 1

    # 轮询健康检查；server.port 出现后以它为准（端口漂移场景）
    target = preferred
    deadline = time.time() + HEALTH_TIMEOUT
    while time.time() < deadline:
        pf = read_small_int(PORT_FILE)
        if pf:
            target = pf
        if http_alive(target, timeout=2):
            log('service ready on port %d' % target)
            open_browser(target)
            return 0
        if proc.poll() is not None:
            break
        time.sleep(1)

    show_startup_failure(preferred, proc)
    return 1


def cmd_start():
    preferred = read_preferred_port()
    file_port = read_small_int(PORT_FILE)

    # 快速路径：服务已在运行，直接开浏览器
    healthy = find_healthy_port({preferred, file_port})
    if healthy:
        log('service already running on port %d' % healthy)
        open_browser(healthy)
        return 0

    locked = acquire_launch_lock()
    if not locked and launch_lock_stale():
        remove_file(LAUNCH_LOCK)
        locked = acquire_launch_lock()

    if not locked:
        # 另一个启动流程正在进行：等它拉起服务后直接开浏览器，不再另起进程
        log('another launch in progress, waiting...')
        deadline = time.time() + HEALTH_TIMEOUT
        while time.time() < deadline:
            time.sleep(1.5)
            healthy = find_healthy_port({preferred, read_small_int(PORT_FILE)})
            if healthy:
                open_browser(healthy)
                return 0
            if not os.path.exists(LAUNCH_LOCK):
                break
        locked = acquire_launch_lock()

    try:
        return do_start(preferred)
    finally:
        if locked:
            remove_file(LAUNCH_LOCK)


def cmd_stop():
    stopped = False
    ports = {read_preferred_port()}
    file_port = read_small_int(PORT_FILE)
    if file_port:
        ports.add(file_port)
    for port in ports:
        for pid in port_listener_pids(port):
            if is_python_pid(pid):
                kill_pids({pid})
                stopped = True
    remove_file(PID_FILE)
    remove_file(PORT_FILE)
    log('service stopped' if stopped else 'no running service found')
    return 0


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'start'
    if action == 'stop':
        return cmd_stop()
    if action == 'restart':
        cmd_stop()
        time.sleep(2)
        return cmd_start()
    if action != 'start':
        log('unknown action: %s' % action)
        return 1
    return cmd_start()


if __name__ == '__main__':
    sys.exit(main())
