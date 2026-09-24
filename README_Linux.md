# 日程管理 - 银河麒麟安装指南

## 环境要求

- 操作系统：银河麒麟 V10 SP1（或其它 Linux 发行版）、统信 UOS
- Python：3.8 或更高版本
- 浏览器：Firefox 或 Chromium（系统自带即可）
- 可选依赖 `icalendar`：**只有「外部日历订阅」功能需要**，详见下文《可选：安装 icalendar》。内网/离线环境用户请跳过，不影响任何其它功能。

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

> **解压分发包时**：优先使用 `.tar.gz` 包（文件名编码与执行权限都能正确保留）。
> 若拿到的是 Windows 上制作的 `.zip` 包，其中的中文文件名可能乱码，请用 `unzip -O gbk 包名.zip` 解压（需要 unzip 6.0+）。应用目录本身的路径包含中文不受影响。

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

## 指定 Python 版本

`install.sh` 会自动探测 PATH 中所有 Python 3.x，选择 ≥ 3.8 的最高版本运行本系统，并写入应用目录的 `python.conf`。需要固定某个版本时，二选一：

- 编辑 `python.conf`，写入解释器命令（如 `python3.9`，或绝对路径 `/usr/bin/python3.9`）
- 或设置环境变量临时覆盖（优先级更高）：

```bash
TACKLIST_PYTHON=python3.9 ./tacklist.sh open
```

改完后执行 `./tacklist.sh restart` 生效。

## 可选：安装 icalendar（仅「外部日历订阅」需要）

> **这是可选项，请先判断是否需要，不需要就不要安装。**

### 这个依赖是干什么的？

它只服务于一个功能：**外部日历订阅**（设置 → 外部日历订阅）——把滴答清单、Outlook 日历、Google 日历、iCloud 日历等外部日历的 `.ics` 订阅链接接入本系统，把外部日程拉取进来作为只读任务展示。

**不安装的影响：** 只有点「立即同步」时会提示"缺少 icalendar 库"。任务、清单、日历视图、四象限、看板、番茄专注、倒计时、统计等**其它全部功能正常可用**，不报错、不影响数据。

**安装前提：必须能访问互联网**（pip 需要从 PyPI 下载）。**信创内网 / 无外网环境的机器请直接跳过本节**——这是预期行为，不是故障，系统绝大部分功能照常使用。

### 一键安装（推荐）

```bash
chmod +x install_icalendar.sh pack_icalendar_wheels.sh
./install_icalendar.sh
```

脚本会在银河麒麟 V10 SP1、统信 UOS 及其它发行版上自动完成：

1. 定位 `python3`（找不到则回退 `python`），检查版本
2. 检查 pip，缺失时提示对应发行版的安装命令（麒麟/UOS：`sudo apt install python3-pip`；CentOS/RHEL：`sudo yum install python3-pip`），并尝试 `python3 -m ensurepip --user`
3. 检测互联网连通性（curl / wget / python 三种方式任一）
4. 优先使用同目录下的 `wheels/` 离线包；没有则联网安装
5. 遇到 PEP 668（`externally-managed-environment`，Debian 12 / 较新的 UOS 会出现）自动加 `--break-system-packages` 重试
6. 安装后 `import icalendar` 验证，并提示重启服务

失败时会明确打印原因与处理建议，常见提示包括：

| 提示 | 含义 / 处理 |
|------|-------------|
| 未找到 Python 3 | `sudo apt install python3` / `sudo yum install python3` |
| Python 版本过低（< 3.7） | 升级 Python；3.7 装 5.0.x、3.8/3.9 装 6.3.x、3.10+ 装 7.x |
| pip 不可用 | `sudo apt install python3-pip`（麒麟/UOS）或 `sudo yum install python3-pip` |
| 无法访问 PyPI | 无外网 / 走内网镜像：请改用离线包（见下），或先配置 pip 镜像源 |
| 无 sudo 权限 | 脚本默认 `--user` 安装到 `~/.local`，一般不需要 sudo |
| PEP 668 受限 | 已自动加 `--break-system-packages`；仍失败可改用 `sudo apt install python3-icalendar` |

手动安装等价命令（需要与启动服务的是**同一个 python3**）：

```bash
python3 -m pip install --user icalendar
python3 -c "import icalendar; print(icalendar.__version__)"
./tacklist.sh restart
```

若系统里装了多个 Python、自动检测挑错了版本，可显式指定：

```bash
PYTHON=/usr/bin/python3.8 ./install_icalendar.sh
```

也可以用系统源里的包（版本较旧但可用，二选一即可）：

```bash
sudo apt install python3-icalendar    # 银河麒麟 / 统信 UOS / Debian / Ubuntu
sudo yum install python3-icalendar    # CentOS / RHEL
```

## 离线使用说明

本系统支持完全离线运行：

- 应用包含 `index_offline.html`，无需网络即可使用全部功能
- 所有数据存储在本地 `data.json` 文件中
- 系统运行无需任何第三方 Python 包；唯一的可选依赖 `icalendar` 只用于「外部日历订阅」功能（见上文），不安装也不影响离线使用

## 常见问题

### Q: 启动后浏览器没有自动打开？

手动在浏览器地址栏输入 `http://localhost:14438`

### Q: 端口被占用？

系统默认使用端口 14438，可在设置 → 网络配置中修改。若端口被占用，系统会自动递增尝试下一个端口。查看 `server.log` 获取实际端口：

```bash
cat server.log | grep "TackList Server"
```

### Q: 设置背景图片轮换时，点「选择目录」没有弹出系统文件选择框？

系统会依次尝试 `tkinter` → `PyQt5` / `PySide` → `zenity` / `kdialog` / `qarma` / `yad` 等图形目录选择组件（并会自动补齐 `DISPLAY` 等图形会话环境变量）。这些组件都缺失（或服务运行在无图形会话的环境）时，会自动切换为**内置目录浏览器**（网页内的目录树），功能不受影响。

若希望使用系统原生对话框，可安装任一组件后重启服务：

```bash
# 银河麒麟 / 统信 UOS / Debian / Ubuntu（推荐）
sudo apt install python3-tk

# CentOS / RHEL / Fedora
sudo yum install python3-tkinter

# openSUSE
sudo zypper install python3-tk

# 或者安装任一命令行选择器（GTK 桌面用 zenity，KDE 桌面用 kdialog）
sudo apt install zenity

./tacklist.sh restart
```

内置目录浏览器打开的位置：优先使用输入框里的路径，路径无效时回落到用户主目录；快捷入口按 `xdg-user-dirs` 解析（中文系统的 ~/桌面、英文系统的 ~/Desktop、法语系统的 ~/Bureau 都能正确识别），支持直接输入路径跳转、逐级进入与「选择此目录」。

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
