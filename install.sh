#!/bin/bash

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTOSTART_DIR="$HOME/.config/autostart"
DESKTOP_FILE="schedule-manager.desktop"
ICON_NAME="schedule-manager"

# Python 探测：自动发现 PATH 中所有 python3.x（含 python3），实跑校验版本，
# 取 >= 3.8 的最高版本。结果写入 python.conf（tacklist.sh / autostart.sh 读取；
# 用户也可手工编辑该文件固定解释器，或用环境变量 TACKLIST_PYTHON 临时覆盖）
BEST_PY=
BEST_VER=0
for cmd in $(compgen -c 2>/dev/null | grep -E '^python3(\.[0-9]+)?$' | sort -u) python3; do
    command -v "$cmd" >/dev/null 2>&1 || continue
    ver=$("$cmd" -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null) || continue
    case "$ver" in
        ''|*[!0-9]*) continue ;;
    esac
    [ "$ver" -ge 308 ] || continue
    if [ "$ver" -gt "$BEST_VER" ]; then
        BEST_VER=$ver
        BEST_PY=$cmd
    fi
done
if [ -z "$BEST_PY" ]; then
    echo "[错误] 未找到 Python 3.8 或更高版本，请先安装后再运行本脚本："
    echo "  银河麒麟 / 统信 UOS / Ubuntu / Debian：sudo apt install python3"
    echo "  CentOS / RHEL：sudo yum install python3"
    exit 1
fi
echo "$BEST_PY" > "$APP_DIR/python.conf"
echo "Python 检测完成：$BEST_PY（版本 $((BEST_VER/100)).$((BEST_VER%100))，已写入 python.conf）"

# 桌面目录：首选显式中文路径（实测部分中文 Linux 发行版需要显式指定 ~/桌面）；
# 该目录不存在时才退级到 xdg-user-dir 通用匹配，最后回退 ~/Desktop 并确保目录存在
if [ -d "$HOME/桌面" ]; then
    DESKTOP_DIR="$HOME/桌面"
else
    DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null)"
    if [ -z "$DESKTOP_DIR" ] || [ ! -d "$DESKTOP_DIR" ]; then
        DESKTOP_DIR="$HOME/Desktop"
    fi
fi
mkdir -p "$DESKTOP_DIR"

# 修复 zip / tar 分发时丢失的执行权限（desktop 文件的 Exec 依赖脚本可执行）
for script in tacklist.sh autostart.sh; do
    if [ -f "$APP_DIR/$script" ]; then
        chmod +x "$APP_DIR/$script"
    fi
done

# Install icon to user icon theme directory (required by UKUI and most Linux desktops)
ICON_DIR="$HOME/.local/share/icons/hicolor"
mkdir -p "$ICON_DIR/128x128/apps"
mkdir -p "$ICON_DIR/scalable/apps"

# Copy PNG icon (128x128)
if [ -f "$APP_DIR/favicon.png" ]; then
    cp "$APP_DIR/favicon.png" "$ICON_DIR/128x128/apps/$ICON_NAME.png"
fi

# Copy SVG icon (scalable)
if [ -f "$APP_DIR/favicon.svg" ]; then
    cp "$APP_DIR/favicon.svg" "$ICON_DIR/scalable/apps/$ICON_NAME.svg"
fi

# Update icon cache
if command -v gtk-update-icon-cache &>/dev/null; then
    gtk-update-icon-cache -f "$ICON_DIR" 2>/dev/null
fi

mkdir -p "$AUTOSTART_DIR"

# Desktop shortcut (shown on desktop with Chinese name)
# Exec 经 bash 解释执行脚本：绕过 noexec 挂载点（U 盘/NTFS 分区解压场景）
# 及部分桌面环境对引号路径的解析差异
cat > "$DESKTOP_DIR/$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=日程管理
Comment=TackList Schedule Management System
Exec=bash "$APP_DIR/tacklist.sh" open
Icon=$ICON_NAME
Terminal=false
Categories=Office;
StartupNotify=false
EOF

chmod +x "$DESKTOP_DIR/$DESKTOP_FILE"

# GNOME 新版文件管理器要求桌面图标"允许启动"（metadata::trusted）；
# 有 gio 时顺带标记，避免双击无响应
if command -v gio >/dev/null 2>&1; then
    gio set "$DESKTOP_DIR/$DESKTOP_FILE" metadata::trusted true 2>/dev/null
fi

# Autostart entry (runs on login)
cat > "$AUTOSTART_DIR/$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=日程管理
Comment=TackList Schedule Management System
Exec=bash "$APP_DIR/autostart.sh"
Icon=$ICON_NAME
Terminal=false
Categories=Office;
StartupNotify=false
X-GNOME-Autostart-enabled=true
EOF

chmod +x "$AUTOSTART_DIR/$DESKTOP_FILE"

echo "安装完成！"
echo "- 桌面快捷方式: $DESKTOP_DIR/$DESKTOP_FILE"
echo "- 自启动项: $AUTOSTART_DIR/$DESKTOP_FILE"
echo ""
echo "系统将在下次登录时自动启动。"
echo "您也可以双击桌面快捷方式手动启动。"
