# 日程管理 - Windows 安装指南

## 环境要求

- 操作系统：Windows 10 / Windows 11
- Python：3.8 或更高版本
- 浏览器：Edge / Chrome / Firefox（系统自带即可）
- 可选依赖 `icalendar`：**只有「外部日历订阅」功能需要**，详见下文《可选：安装 icalendar》。企业内网用户或不需要该功能的用户请跳过，不影响任何其它功能。

## 安装步骤

### 1. 安装 Python

1. 访问 [Python 官网](https://www.python.org/downloads/) 下载 Python 3.8+
2. 运行安装程序，**务必勾选 "Add Python to PATH"**
3. 安装完成后，打开命令提示符验证：

```cmd
python --version
```

### 2. 部署应用

将应用文件夹复制到目标目录，例如：

```
C:\Users\你的用户名\TODO
```

> 注意：路径中避免使用中文或空格

### 3. 运行安装脚本

双击 `install.bat`，脚本会自动：
- 检查 Python 环境
- 创建桌面快捷方式
- 创建开机自启动项

安装完成后：
- 桌面会出现"日程管理"快捷方式，双击即可启动
- 系统会在下次登录时自动启动

### 4. 手动启动（如不运行安装脚本）

双击 `start.bat`，或在命令提示符中执行：

```cmd
cd C:\Users\你的用户名\TODO
start.bat
```

启动后浏览器会自动打开，或手动访问 `http://localhost:14438`

## 常用命令

在命令提示符中进入应用目录后：

```cmd
start.bat           # 启动服务
start.bat stop      # 停止服务
start.bat restart   # 重启服务
```

## 可选：安装 icalendar（仅「外部日历订阅」需要）

> **这是可选项，请先判断是否需要，不需要就不要安装。**

### 这个依赖是干什么的？

它只服务于一个功能：**外部日历订阅**（设置 → 外部日历订阅）——把滴答清单、Outlook 日历、Google 日历、iCloud 日历等外部日历的 `.ics` 订阅链接接入本系统，把外部日程拉取进来作为只读任务展示。

**不安装的影响：** 只有点「立即同步」时会提示"缺少 icalendar 库"。任务、清单、日历视图、四象限、看板、番茄专注、倒计时、统计等**其它全部功能正常可用**，不报错、不影响数据。

**安装前提：必须能访问互联网**（pip 需要从 PyPI 下载）。如果你处在**企业内网 / 无外网环境，请直接跳过本节**——这是预期行为，不是故障。

### 一键安装（推荐）

双击运行 `install_icalendar.bat`（或在命令行进入应用目录执行 `install_icalendar.bat`）。
`install_icalendar.bat` 只是引导器，真正的逻辑在同目录的 `install_icalendar.ps1`（PowerShell）。

脚本会自动：

1. 找到系统里的 Python（`python` → 回退 `py -3`），并检查版本
2. 检查 pip，缺失时自动尝试 `python -m ensurepip`
3. 检测互联网连通性
4. 优先使用同目录下的 `wheels/` 离线包；没有则联网安装
5. 安装后 `import icalendar` 验证，并提示重启服务

失败时会明确打印原因与处理建议，常见提示包括：

| 提示 | 含义 / 处理 |
|------|-------------|
| 未找到 Python | 安装 Python 3.8+ 并勾选 "Add Python to PATH" |
| Python 版本过低（< 3.7） | 需升级 Python；3.7 装 5.0.x、3.8/3.9 装 6.3.x、3.10+ 装 7.x |
| pip 不可用 | 重装 Python 并勾选 pip，或手动执行 `python -m ensurepip` |
| 无法访问 PyPI | 无外网 / 被代理拦截：请改用离线包（见下），或配置代理后重试 |
| 权限不足 | 以管理员身份运行，或脚本会自动降级为 `--user` 安装到当前用户 |
| 公司代理/证书报错 | 设置 `HTTPS_PROXY`，或加 `--trusted-host pypi.org --trusted-host files.pythonhosted.org` |

手动安装等价命令（需要与启动服务的是**同一个 Python**）：

```cmd
python -m pip install --user icalendar
python -c "import icalendar; print(icalendar.__version__)"
start.bat restart
```

若装了多个 Python、自动检测挑错了版本，可显式指定：

```cmd
powershell -ExecutionPolicy Bypass -File install_icalendar.ps1 -PythonPath "C:\Python314\python.exe"
```

想先预览将要执行的命令而不实际安装，加 `-DryRun`：

```cmd
powershell -ExecutionPolicy Bypass -File install_icalendar.ps1 -DryRun
```

### 离线 / 内网环境怎么装

1. 在一台**能上网**的机器上双击 `pack_icalendar_wheels.bat`，生成 `wheels/` 目录。
2. 把 `wheels/` 拷贝到内网机，与 `install_icalendar.bat` 放在同一目录。
3. 在内网机运行 `install_icalendar.bat`，脚本自动识别 `wheels/` 走离线安装，全程不联网。

## 文件说明

| 文件 | 说明 |
|------|------|
| `start.bat` | 启动/停止/重启服务（入口，实际逻辑在 launcher.py） |
| `launcher.py` | 启动编排器：单实例锁、健康检查、防误杀、确认就绪后才开浏览器 |
| `install.bat` | 安装桌面快捷方式和开机自启动 |
| `install_icalendar.bat` | **可选**：一键安装 icalendar（外部日历订阅用，支持联网/离线），双击即可 |
| `install_icalendar.ps1` | **可选**：上述 .bat 的实际安装逻辑（PowerShell，可用 `-PythonPath` / `-DryRun` 参数） |
| `pack_icalendar_wheels.bat` | **可选**：在联网机打包 icalendar 离线安装包（生成 `wheels/`），双击即可 |
| `pack_icalendar_wheels.ps1` | **可选**：上述打包 .bat 的实际逻辑（可用 `-TargetVersion 3.8` 指定目标机 Python 版本） |
| `requirements-optional.txt` | **可选**：icalendar 依赖清单（按 Python 版本自动约束） |
| `server.py` | 主服务程序 |
| `start_server.py` | 备用离线服务程序（功能有限） |
| `data.json` | 用户数据文件 |
| `server.log` | 服务运行日志 |

> `install.bat` 和 `start.bat` 的关系：`install.bat` 是一次性安装脚本，负责创建桌面快捷方式（指向 `start.bat`）和开机自启动项；`start.bat` 是日常使用的启动脚本。两个文件都需要保留。

## 离线使用说明

本系统支持完全离线运行：

- 应用包含 `index_offline.html`，无需网络即可使用全部功能
- 所有数据存储在本地 `data.json` 文件中
- 系统运行无需任何第三方 Python 包；唯一的可选依赖 `icalendar` 只用于「外部日历订阅」功能（见上文），不安装也不影响离线使用

## 常见问题

### Q: 双击 install.bat / start.bat 提示"Internet安全设置阻止打开文件"？

这是Windows的安全机制，阻止运行本地脚本文件。请按以下顺序尝试：

**方法1：修改Internet安全设置**（推荐，一劳永逸）

1. 按 `Win+R`，输入 `inetcpl.cpl`，回车打开"Internet 选项"
2. 切换到"安全"选项卡，选择"Internet"区域，点击"自定义级别"
3. 找到"加载应用程序和不安全文件"，改为"提示"或"启用"
4. 点击确定

**方法2：添加到受信任站点**

1. 打开"Internet 选项"（同上）
2. 切换到"安全"选项卡，选择"受信任的站点"，点击"站点"
3. 取消勾选"对该区域中的所有站点要求服务器验证(https:)"
4. 在地址栏输入应用路径，如 `file://D:\Swann\Documents\TODO\`，点击"添加"
5. 点击关闭 → 确定

**方法3：通过命令提示符运行**（无需修改设置）

1. 按 `Win+R`，输入 `cmd`，回车
2. 切换到应用目录，如 `cd /d D:\Swann\Documents\TODO`
3. 执行 `install.bat`

**方法4：解除文件锁定**（仅对从网络下载的文件有效）

右键点击 `install.bat` → 属性，如果底部有"解除锁定"选项，勾选后确定。如果没有该选项，请使用上述方法1或2。

### Q: 双击 start.bat 闪退？

右键 `start.bat` → "以管理员身份运行"，或先打开命令提示符再手动执行。

### Q: 提示"未找到 Python"？

1. 确认安装 Python 时勾选了 "Add Python to PATH"
2. 或手动添加 Python 到系统环境变量：
   - 右键"此电脑" → 属性 → 高级系统设置 → 环境变量
   - 在 Path 中添加 Python 安装路径（如 `C:\Python39`）

### Q: 端口被占用？

系统默认使用端口 14438，可在设置 → 网络配置中修改。若端口被占用，系统会自动递增尝试下一个端口。查看 `server.log` 获取实际端口：

```cmd
type server.log | findstr "TackList Server"
```

### Q: 双击快捷方式后浏览器提示"127.0.0.1 拒绝了连接请求"？

启动流程已加固（launcher.py）：服务确认健康后才会打开浏览器，连点快捷方式也不会互相干扰。若仍出现该提示，通常是服务启动失败，会弹出包含 `server.log` 末尾内容的对话框，按提示处理：

1. **杀毒软件拦截**：将应用目录（含 `python.exe`）加入杀毒软件白名单，这是冷启动超时最常见的原因
2. **代理软件**：浏览器访问 `127.0.0.1` 被代理拦截时，在代理软件（如 Clash）中开启"绕过局域网/回环地址"
3. **服务僵死**：执行 `start.bat restart` 强制重启服务
4. 查看日志定位：`server.log`（记录了服务启动与报错信息）

### Q: 如何取消开机自启动？

按 `Win+R`，输入 `shell:startup`，删除"日程管理"快捷方式即可。

### Q: 如何卸载？

1. 执行 `start.bat stop` 停止服务
2. 删除桌面快捷方式
3. 按 `Win+R`，输入 `shell:startup`，删除自启动快捷方式
4. 删除应用文件夹（可选，会删除所有数据）
