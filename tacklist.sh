#!/bin/bash

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$APP_DIR/server.log"
PID_FILE="$APP_DIR/server.pid"
LOCK_DIR="$APP_DIR/.browser_lock"

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
    for i in $(seq 1 30); do
        local port=$(python3 -c "import json; d=json.load(open('$APP_DIR/data.json')); print(d.get('settings',{}).get('port',14438))" 2>/dev/null || echo 14438)
        if curl -s http://localhost:$port/ > /dev/null 2>&1; then
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
        local port=$(python3 -c "import json; d=json.load(open('$APP_DIR/data.json')); print(d.get('settings',{}).get('port',14438))" 2>/dev/null || echo 14438)
        xdg-open http://localhost:$port
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
