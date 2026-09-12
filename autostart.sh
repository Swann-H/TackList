#!/bin/bash
# 自启动脚本：开机自动启动日程管理服务并打开浏览器
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"
PORT_FILE="$APP_DIR/server.port"

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
nohup python3 "$APP_DIR/server.py" > "$APP_DIR/server.log" 2>&1 &
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

echo "Warning: Server did not start within 15 seconds" >> "$APP_DIR/server.log"
