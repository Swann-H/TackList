# 日程管理 - Windows 安装指南

## 环境要求

- 操作系统：Windows 10 / Windows 11
- Python：3.8 或更高版本
- 浏览器：Edge / Chrome / Firefox（系统自带即可）

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
C:\Users\你的用户名\TackList
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
cd C:\Users\你的用户名\TackList
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

## 文件说明

| 文件 | 说明 |
|------|------|
| `start.bat` | 启动/停止/重启服务 |
| `install.bat` | 安装桌面快捷方式和开机自启动 |
| `server.py` | 主服务程序 |
| `start_server.py` | 备用离线服务程序（功能有限） |
| `data.json` | 用户数据文件 |
| `server.log` | 服务运行日志 |

> `install.bat` 和 `start.bat` 的关系：`install.bat` 是一次性安装脚本，负责创建桌面快捷方式（指向 `start.bat`）和开机自启动项；`start.bat` 是日常使用的启动脚本。两个文件都需要保留。

## 离线使用说明

本系统支持完全离线运行：

- 应用包含 `index_offline.html`，无需网络即可使用全部功能
- 所有数据存储在本地 `data.json` 文件中
- 无需安装任何第三方 Python 包

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
4. 在地址栏输入应用路径，如 `file://D:\Swann\Documents\TackList\`，点击"添加"
5. 点击关闭 → 确定

**方法3：通过命令提示符运行**（无需修改设置）

1. 按 `Win+R`，输入 `cmd`，回车
2. 切换到应用目录，如 `cd /d D:\Swann\Documents\TackList`
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

### Q: 如何取消开机自启动？

按 `Win+R`，输入 `shell:startup`，删除"日程管理"快捷方式即可。

### Q: 如何卸载？

1. 执行 `start.bat stop` 停止服务
2. 删除桌面快捷方式
3. 按 `Win+R`，输入 `shell:startup`，删除自启动快捷方式
4. 删除应用文件夹（可选，会删除所有数据）
