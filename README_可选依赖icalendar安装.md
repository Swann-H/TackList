## 可选依赖：icalendar安装

> **绝大多数用户不需要安装它，请先判断是否真的需要。**

当使用的终端可联网，并且希望将滴答清单、Outlook 日历、Google 日历、iCloud 日历等外部日历的 `.ics` 订阅链接接入本系统，作为只读任务展示时，才需要安装icalendar。否则，在根据README文件进行系统安装后，即可使用系统中的所有功能。

### 安装前提

- **安装过程需要访问互联网**（脚本 / pip 需要从 PyPI 下载安装包）。若处于企业内网且无法访问外网，**请不要进行安装**。
- Python 版本决定能装哪个 icalendar 版本，一键安装脚本会自动判断：

| Python 版本 | 安装的 icalendar 版本 |
|-------------|----------------------|
| 3.10 及以上 | 最新版（7.x） |
| 3.8 / 3.9 | 6.3.x |
| 3.7 | 5.0.x |

### 一键安装：在终端中输入命令或直接运行bat批处理文件

```bash
# Linux（银河麒麟 V10 SP1 / 统信 UOS / 其它发行版）
chmod +x install_icalendar.sh pack_icalendar_wheels.sh
./install_icalendar.sh

# Windows：双击运行，或在命令行执行
install_icalendar.bat
```

脚本会依次检查 Python 版本、pip 是否可用、网络是否可达，并**优先使用同目录下的 `wheels/` 离线包**；任何一步失败都会打印明确的原因和处理建议（权限、代理、PEP 668、版本过旧等）。