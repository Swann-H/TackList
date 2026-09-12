#!/bin/bash

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$APP_DIR/server.log"
PID_FILE="$APP_DIR/server.pid"
PORT_FILE="$APP_DIR/server.port"
LOCK_DIR="$APP_DIR/.browser_lock"

# data.json 中的首选端口（被占用时 server.py 会漂移 +1，实际端口写入 server.port）
preferred_port() {
    python3 -c "import json; d=json.load(open('$APP_DIR/data.json')); p=d.get('settings',{}).get('port',14438); print(p if isinstance(p,int) and 1024<=p<=65535 else 14438)" 2>/dev/null || echo 14438
}

# 健康探测：直连 127.0.0.1、绕过系统代理，并校验是本服务的 /api/platform 响应，
# 避免端口被其他程序占用时误判就绪（与 launcher.py 的 http_alive 口径一致）
http_alive() {
    curl -s --noproxy '*' -m 2 "http://127.0.0.1:$1/api/platform" 2>/dev/null | grep -q 'platform'
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
    preferred_port
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
    nohup python3 server.py > "$LOG_FILE" 2>&1 &
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
        wait_for_server
        xdg-open "http://127.0.0.1:$(server_port)"
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
