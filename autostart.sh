#!/bin/bash
# 自启动脚本：开机自动启动日程管理服务并打开浏览器
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"
PORT_FILE="$APP_DIR/server.port"

# Python 解释器：环境变量 TACKLIST_PYTHON > python.conf > python3（与 tacklist.sh 口径一致）
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

# 失败提示：自启动场景无终端，尽量用系统通知呈现（与 tacklist.sh 口径一致）
notify_failure() {
    local msg="$1"
    echo "[autostart.sh $(date '+%Y-%m-%d %H:%M:%S')] $msg" >> "$APP_DIR/server.log" 2>/dev/null
    if command -v notify-send >/dev/null 2>&1; then
        notify-send -a TackList "日程管理" "$msg" 2>/dev/null
    elif command -v zenity >/dev/null 2>&1; then
        zenity --error --title="TackList" --text="$msg" 2>/dev/null
    fi
}

# 启动前校验解释器可用：缺失时给出可见提示，而不是静默无响应
if ! command -v "$PY" >/dev/null 2>&1; then
    notify_failure "自启动失败：未找到可用的 Python 解释器（$PY）。请安装 Python 3.8+，或运行 install.sh 重新探测。"
    exit 1
fi

# data.json 中的首选端口：纯 shell 解析、进程内只读一次（避免探测循环反复起
# python3 进程）。被占用时 server.py 会漂移 +1，实际端口写入 server.port
PREFERRED_PORT=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]\+' "$APP_DIR/data.json" 2>/dev/null | head -n 1 | grep -o '[0-9]\+$')
case "$PREFERRED_PORT" in
    ''|*[!0-9]*) PREFERRED_PORT=14438 ;;
esac
if ! { [ "$PREFERRED_PORT" -ge 1024 ] && [ "$PREFERRED_PORT" -le 65535 ]; } 2>/dev/null; then
    PREFERRED_PORT=14438
fi

# 健康探测：直连 127.0.0.1、绕过系统代理，并校验是本服务的 /api/platform 响应
# （与 tacklist.sh 的降级链口径一致：curl > wget > bash 内建 /dev/tcp）
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

# 检查是否已在运行
if [ -f "$APP_DIR/server.pid" ]; then
    OLD_PID=$(cat "$APP_DIR/server.pid")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        # 服务已在运行，直接打开浏览器（端口跟随 server.port，漂移也能打开正确地址）
        xdg-open "http://127.0.0.1:$(server_port)" >/dev/null 2>&1 &
        exit 0
    fi
    rm -f "$APP_DIR/server.pid"
fi

# 启动服务
nohup "$PY" "$APP_DIR/server.py" > "$APP_DIR/server.log" 2>&1 &
echo $! > "$APP_DIR/server.pid"

# 等待服务就绪（直连探测、绕过代理、跟随端口漂移）
for i in $(seq 1 30); do
    PORT=$(server_port)
    if http_alive "$PORT"; then
        xdg-open "http://127.0.0.1:$PORT" >/dev/null 2>&1 &
        exit 0
    fi
    sleep 0.5
done

notify_failure "自启动超时：服务未能就绪。请查看日志：$APP_DIR/server.log"
