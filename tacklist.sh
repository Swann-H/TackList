#!/bin/bash

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$APP_DIR/server.log"
PID_FILE="$APP_DIR/server.pid"
PORT_FILE="$APP_DIR/server.port"
LOCK_DIR="$APP_DIR/.browser_lock"

# Python 解释器：环境变量 TACKLIST_PYTHON > python.conf（install.sh 探测写入，
# 也可手工编辑固定解释器，如 python3.9 或绝对路径）> python3
resolve_python() {
    local cmd
    if [ -n "$TACKLIST_PYTHON" ]; then
        echo "$TACKLIST_PYTHON"
        return 0
    fi
    if [ -s "$APP_DIR/python.conf" ]; then
        cmd=$(grep -v '^[[:space:]]*#' "$APP_DIR/python.conf" 2>/dev/null | grep -m1 -v '^[[:space:]]*$')
        if [ -n "$cmd" ] && command -v "$cmd" >/dev/null 2>&1; then
            echo "$cmd"
            return 0
        fi
    fi
    echo python3
}
PY="$(resolve_python)"

# 失败提示：桌面环境无终端，尽量用系统通知呈现（notify-send / zenity 存在才弹），
# 始终落日志——避免"双击无响应"时无任何线索可排查
notify_failure() {
    local msg="$1"
    echo "[tacklist.sh $(date '+%Y-%m-%d %H:%M:%S')] $msg" >> "$LOG_FILE" 2>/dev/null
    if command -v notify-send >/dev/null 2>&1; then
        notify-send -a TackList "日程管理" "$msg" 2>/dev/null
    elif command -v zenity >/dev/null 2>&1; then
        zenity --error --title="TackList" --text="$msg" 2>/dev/null
    fi
}

# 启动前校验解释器可用：缺失时给出可见提示，而不是静默无响应
if ! command -v "$PY" >/dev/null 2>&1; then
    notify_failure "未找到可用的 Python 解释器（$PY）。请安装 Python 3.8+，或运行 install.sh 重新探测，或设置 TACKLIST_PYTHON 环境变量。"
    exit 1
fi

# data.json 中的首选端口：纯 shell 解析、进程内只读一次（原先每次探测都要起一个
# python3 进程，慢速设备上探测循环自身就拖慢启动数秒）。被占用时 server.py 会
# 漂移 +1，实际端口写入 server.port
PREFERRED_PORT=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]\+' "$APP_DIR/data.json" 2>/dev/null | head -n 1 | grep -o '[0-9]\+$')
case "$PREFERRED_PORT" in
    ''|*[!0-9]*) PREFERRED_PORT=14438 ;;
esac
if ! { [ "$PREFERRED_PORT" -ge 1024 ] && [ "$PREFERRED_PORT" -le 65535 ]; } 2>/dev/null; then
    PREFERRED_PORT=14438
fi

# 健康探测：直连 127.0.0.1、绕过系统代理，并校验是本服务的 /api/platform 响应，
# 避免端口被其他程序占用时误判就绪（与 launcher.py 的 http_alive 口径一致）。
# 探测工具按可用性择优一次：curl > wget > bash 内建 /dev/tcp（零外部依赖，
# 仅校验端口上有 HTTP 服务响应、无 body 校验——前两者覆盖绝大多数发行版）
HTTP_PROBE=tcp
if command -v curl >/dev/null 2>&1; then
    HTTP_PROBE=curl
elif command -v wget >/dev/null 2>&1; then
    HTTP_PROBE=wget
fi

http_alive() {
    case "$HTTP_PROBE" in
        curl) curl -s --noproxy '*' -m 2 "http://127.0.0.1:$1/api/platform" 2>/dev/null | grep -q 'platform' ;;
        wget) http_proxy= https_proxy= HTTP_PROXY= HTTPS_PROXY= wget -q -T 2 -O - "http://127.0.0.1:$1/api/platform" 2>/dev/null | grep -q 'platform' ;;
        tcp)
            (
                exec 3<>"/dev/tcp/127.0.0.1/$1" || exit 1
                printf 'GET /api/platform HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n' >&3
                read -r -t 2 _ <&3
            ) 2>/dev/null
            ;;
    esac
}

# 实际端口：优先读 server.port（跟随端口漂移），回退首选端口
server_port() {
    local p
    if [ -f "$PORT_FILE" ]; then
        p=$(cat "$PORT_FILE" 2>/dev/null | tr -d '[:space:]')
        if [ -n "$p" ] && [ "$p" -gt 0 ] 2>/dev/null; then
            echo "$p"
            return 0
        fi
    fi
    echo "$PREFERRED_PORT"
}

start() {
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            echo "Server is already running (PID: $OLD_PID)"
            return 0
        fi
        rm -f "$PID_FILE"
    fi

    cd "$APP_DIR"
    nohup "$PY" server.py > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Server started (PID: $(cat $PID_FILE))"
}

wait_for_server() {
    local port
    for i in $(seq 1 30); do
        port=$(server_port)
        if http_alive "$port"; then
            return 0
        fi
        sleep 0.5
    done
    return 1
}

open_browser() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        trap "rm -rf '$LOCK_DIR'" EXIT
        start
        if ! wait_for_server; then
            notify_failure "服务启动超时（约 15 秒）。请查看日志：$APP_DIR/server.log"
        fi
        xdg-open "http://127.0.0.1:$(server_port)" >/dev/null 2>&1
        sleep 3
        rm -rf "$LOCK_DIR"
        trap - EXIT
    else
        echo "Browser is already being opened, skipping"
    fi
}

stop() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID"
            rm -f "$PID_FILE"
            echo "Server stopped"
        else
            rm -f "$PID_FILE"
            echo "Server was not running"
        fi
    else
        echo "No PID file found"
    fi
}

case "$1" in
    start)
        start
        ;;
    open)
        open_browser
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        sleep 1
        start
        ;;
    *)
        start
        ;;
esac
