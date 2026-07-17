# 日程管理 - 银河麒麟安装指南

## 环境要求

- 操作系统：银河麒麟 V10（或其他 Linux 发行版）
- Python：3.8 或更高版本
- 浏览器：Firefox 或 Chromium（系统自带即可）

## 安装步骤

### 1. 检查 Python 环境

打开终端，执行：

```bash
python3 --version
```

如未安装 Python 3，使用系统包管理器安装：

```bash
# 银河麒麟 / Ubuntu / Debian
sudo apt update
sudo apt install python3

# CentOS / RHEL
sudo yum install python3
```

### 2. 部署应用

将应用文件夹复制到目标目录，例如：

```bash
# 复制到用户目录
cp -r /path/to/TackList ~/TackList
cd ~/TackList
```

### 3. 赋予执行权限

```bash
chmod +x tacklist.sh install.sh autostart.sh
```

### 4. 运行安装脚本（可选）

安装脚本会自动创建桌面快捷方式和开机自启动项：

```bash
./install.sh
```

安装完成后：
- 桌面会出现"日程管理"快捷方式，双击即可启动
- 系统会在下次登录时自动启动

### 5. 手动启动（如不运行安装脚本）

```bash
cd ~/TackList
./tacklist.sh start
```

启动后浏览器会自动打开，或手动访问 `http://localhost:14438`

## 常用命令

```bash
./tacklist.sh start     # 启动服务
./tacklist.sh stop      # 停止服务
./tacklist.sh restart   # 重启服务
./tacklist.sh open      # 启动服务并打开浏览器
```

## 离线使用说明

本系统支持完全离线运行：

- 应用包含 `index_offline.html`，无需网络即可使用全部功能
- 所有数据存储在本地 `data.json` 文件中
- 无需安装任何第三方 Python 包

## 常见问题

### Q: 启动后浏览器没有自动打开？

手动在浏览器地址栏输入 `http://localhost:14438`

### Q: 端口被占用？

系统默认使用端口 14438，可在设置 → 网络配置中修改。若端口被占用，系统会自动递增尝试下一个端口。查看 `server.log` 获取实际端口：

```bash
cat server.log | grep "TackList Server"
```

### Q: 如何设置开机自启动？

运行 `./install.sh`，或手动创建自启动项：

```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/日程管理.desktop << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=日程管理
Exec=bash -c 'cd "$HOME/TackList" && ./tacklist.sh open'
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
```

### Q: 如何卸载？

```bash
# 停止服务
./tacklist.sh stop

# 删除桌面快捷方式和自启动项
rm -f ~/桌面/日程管理.desktop
rm -f ~/.config/autostart/日程管理.desktop

# 删除应用目录（可选，会删除所有数据）
rm -rf ~/TackList
```
