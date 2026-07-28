#!/bin/bash
# 自启动脚本：开机自动启动日程管理服务并打开浏览器
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

# 检查是否已在运行
if [ -f "$APP_DIR/server.pid" ]; then
    OLD_PID=$(cat "$APP_DIR/server.pid")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        # 服务已在运行，直接打开浏览器
        PORT=$(python3 -c "import json; d=json.load(open('$APP_DIR/data.json')); print(d.get('settings',{}).get('port',14438))" 2>/dev/null || echo 14438)
        xdg-open "http://localhost:$PORT" 2>/dev/null &
        exit 0
    fi
    rm -f "$APP_DIR/server.pid"
fi

# 启动服务
nohup python3 "$APP_DIR/server.py" > "$APP_DIR/server.log" 2>&1 &
echo $! > "$APP_DIR/server.pid"

# 等待服务就绪
for i in $(seq 1 30); do
    PORT=$(python3 -c "import json; d=json.load(open('$APP_DIR/data.json')); print(d.get('settings',{}).get('port',14438))" 2>/dev/null || echo 14438)
    if curl -s "http://localhost:$PORT/" > /dev/null 2>&1; then
        xdg-open "http://localhost:$PORT" 2>/dev/null &
        exit 0
    fi
    sleep 0.5
done

echo "Warning: Server did not start within 15 seconds" >> "$APP_DIR/server.log"
