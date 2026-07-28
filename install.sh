#!/bin/bash

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$HOME/桌面"
AUTOSTART_DIR="$HOME/.config/autostart"
DESKTOP_FILE="schedule-manager.desktop"
ICON_NAME="schedule-manager"

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
cat > "$DESKTOP_DIR/$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=日程管理
Comment=TackList Schedule Management System
Exec="$APP_DIR/tacklist.sh" open
Icon=$ICON_NAME
Terminal=false
Categories=Office;
StartupNotify=false
EOF

chmod +x "$DESKTOP_DIR/$DESKTOP_FILE"

# Autostart entry (runs on login)
cat > "$AUTOSTART_DIR/$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=日程管理
Comment=TackList Schedule Management System
Exec="$APP_DIR/autostart.sh"
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
