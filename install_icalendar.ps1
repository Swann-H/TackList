<#
.SYNOPSIS
    TackList 可选依赖（icalendar）一键安装脚本 — Windows

.DESCRIPTION
    icalendar 仅用于「外部日历订阅（ICS 同步）」功能：
    把滴答清单 / Outlook / Google / iCloud 等外部日历的 .ics 订阅链接接入本系统。
    这是「可选项」：不需要该功能、或处在无外网的内网环境时，不必安装，
    系统其余全部功能正常可用（仅「立即同步」会提示缺少该库）。

    安装前提：需要访问互联网（pip 从 PyPI 下载）。
    离线场景：先用 pack_icalendar_wheels.bat 在联网机打包 wheels 目录，
    拷到本脚本同目录后重新运行，脚本会自动走离线安装。

.PARAMETER DryRun
    只打印将要执行的命令，不实际安装（用于预览与排查）。

.EXAMPLE
    .\install_icalendar.ps1
    .\install_icalendar.ps1 -DryRun
#>
param(
    [string]$PythonPath,
    [switch]$DryRun
)

$AppDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$WheelsDir = Join-Path $AppDir 'wheels'

function Say-Info($m) { Write-Host "[信息] $m" -ForegroundColor Cyan }
function Say-Ok($m)   { Write-Host "[成功] $m" -ForegroundColor Green }
function Say-Warn($m) { Write-Host "[提示] $m" -ForegroundColor Yellow }
function Say-Err($m)  { Write-Host "[失败] $m" -ForegroundColor Red }
function Say-Step($m) { Write-Host ""; Write-Host "==== $m ====" -ForegroundColor Cyan }

function Fail($title, [string[]]$tips) {
    Say-Err $title
    if ($tips) {
        Write-Host ""
        foreach ($t in $tips) { Write-Host "    $t" }
    }
    Write-Host ""
    Write-Host "提示：本依赖是可选的，未安装不影响系统除「外部日历订阅」以外的任何功能。" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "============================================================"
Write-Host "  TackList 可选依赖安装（icalendar）"
Write-Host "============================================================"
Write-Host ""
Write-Host "  本依赖仅用于「外部日历订阅」功能。"
Write-Host "  若不需要该功能，或处在无外网的内网环境，可直接关闭本窗口，"
Write-Host "  不会影响系统其它任何功能。"
Write-Host ""

# ---------- 1. 定位 Python ----------
Say-Step "步骤 1/5：检查 Python 环境"
$PyExe = $null
$PyPre = @()

if ($PythonPath) {
    # 手动指定：自动检测失败时的兜底入口
    if (-not (Test-Path $PythonPath)) { Fail "指定的 Python 路径不存在：$PythonPath" @("请检查路径是否正确，例如 C:\Python314\python.exe") }
    $null = & $PythonPath -c 'import sys; sys.exit(0 if sys.version_info[0]==3 else 1)' 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "指定的 Python 无法运行或不是 Python 3：$PythonPath" }
    $PyExe = $PythonPath
} else {

# 收集候选：PATH 中的 python / python3（含全部同名项）、常见安装目录、py 启动器
$pyCands = New-Object System.Collections.Generic.List[object]
$deferred = New-Object System.Collections.Generic.List[object]
foreach ($name in @('python', 'python3')) {
    $found = Get-Command $name -All -ErrorAction SilentlyContinue
    if ($found) {
        foreach ($f in $found) {
            if (-not $f.Source) { continue }
            $item = @{ Exe = $f.Source; Pre = @() }
            if ($f.Source -like '*WindowsApps*') { $deferred.Add($item) } else { $pyCands.Add($item) }
        }
    }
}
foreach ($dir in @((Join-Path $env:LOCALAPPDATA 'Programs\Python'), 'C:\')) {
    if (-not (Test-Path $dir)) { continue }
    Get-ChildItem -Path $dir -Directory -Filter 'Python3*' -ErrorAction SilentlyContinue | ForEach-Object {
        $p = Join-Path $_.FullName 'python.exe'
        if (Test-Path $p) { $pyCands.Add(@{ Exe = $p; Pre = @() }) }
    }
}
foreach ($d in $deferred) { $pyCands.Add($d) }
$pyCands.Add(@{ Exe = 'py'; Pre = @('-3') })
$pyCands.Add(@{ Exe = 'py'; Pre = @() })

foreach ($c in $pyCands) {
    try {
        $null = & $c.Exe @($c.Pre + @('-c', 'import sys; sys.exit(0 if sys.version_info[0]==3 else 1)')) 2>$null
    } catch { continue }
    if ($LASTEXITCODE -eq 0) {
        $PyExe = $c.Exe
        $PyPre = $c.Pre
        break
    }
}
}

if (-not $PyExe) {
    Fail "未找到可用的 Python 3。" @(
        "1. 到 https://www.python.org/downloads/ 下载安装 Python 3.8+",
        "   安装时务必勾选 [Add Python to PATH]",
        "2. 或手动把 Python 安装目录加入系统环境变量 Path",
        "3. 若确实不需要外部日历订阅，可直接忽略本提示。"
    )
}

function Invoke-Py {
    param([Parameter(ValueFromRemainingArguments = $true)]$Args)
    & $PyExe @($PyPre + $Args)
}

$PyPath = (Invoke-Py -c 'import sys; print(sys.executable)' 2>$null | Out-String).Trim()
$PyVer  = (Invoke-Py -c "import sys; v=sys.version_info; print(str(v[0])+'.'+str(v[1]))" 2>$null | Out-String).Trim()
if (-not $PyVer) { Fail "无法获取 Python 版本，Python 可能已损坏，请重新安装。" }

Say-Ok "已找到 Python：$PyPath"
Write-Host "        版本：$PyVer"

$minor = 0
[void][int]::TryParse(($PyVer.Split('.')[1]), [ref]$minor)

$Spec = 'icalendar'
$Note = 'Python 3.10+ → icalendar 最新版'
switch ($minor) {
    7 { $Spec = 'icalendar<6'; $Note = 'Python 3.7 → icalendar 5.0.x' }
    8 { $Spec = 'icalendar<7'; $Note = 'Python 3.8 → icalendar 6.3.x' }
    9 { $Spec = 'icalendar<7'; $Note = 'Python 3.9 → icalendar 6.3.x' }
    default {
        if ($minor -lt 7) {
            Fail "Python 版本过低（$PyVer），至少需要 Python 3.7。" @(
                "处理建议：升级 Python 后重试；或放弃安装本可选依赖（不影响其它功能）。"
            )
        }
    }
}
Say-Info "版本匹配：$Note"
$ExtraPkgs = @('python-dateutil', 'six', 'tzdata', 'typing-extensions')

# ---------- 2. 检查 pip ----------
Say-Step "步骤 2/5：检查 pip"
$null = Invoke-Py -m pip --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Say-Warn "未检测到 pip，尝试自动修复（ensurepip）..."
    $null = Invoke-Py -m ensurepip --user 2>$null
    if ($LASTEXITCODE -ne 0) { $null = Invoke-Py -m ensurepip 2>$null }
    $null = Invoke-Py -m pip --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Fail "pip 不可用，且自动修复失败。" @(
            "1. 重新运行 Python 安装程序 → Modify → 勾选 pip → 重新安装",
            "2. 或手动执行：python -m ensurepip",
            "3. 或在联网机用 pack_icalendar_wheels.bat 打包 wheels 目录后，",
            "   把 .whl 当作 zip 解压到 Python 的 site-packages 目录"
        )
    }
}
$PipVer = (Invoke-Py -m pip --version 2>$null | Out-String).Trim()
Say-Ok "pip 可用：$PipVer"

# ---------- 3. 判断离线包 / 网络 ----------
Say-Step "步骤 3/5：检查安装包来源"
$Offline = $false
if (Test-Path $WheelsDir) {
    $whls = Get-ChildItem -Path $WheelsDir -Filter *.whl -ErrorAction SilentlyContinue
    if ($whls -and $whls.Count -gt 0) {
        $Offline = $true
        Say-Ok "发现离线包目录 wheels，将使用离线安装（不联网）。"
        foreach ($w in $whls) { Write-Host "        - $($w.Name)" }
    }
}
if (-not $Offline) {
    Say-Info "未发现 wheels 离线包，检查互联网连通性..."
    $null = Invoke-Py -c "import urllib.request; urllib.request.urlopen('https://pypi.org/simple/', timeout=10)" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Fail "无法访问 PyPI（无互联网连接，或被代理 / 防火墙拦截）。" @(
            "1. 企业内网 / 无外网环境：无需安装本依赖，",
            "   系统除「外部日历订阅」外功能全部可用，直接关闭即可。",
            "2. 确实需要该功能：在能上网的电脑上运行 pack_icalendar_wheels.bat，",
            "   把生成的 wheels 目录拷贝到本脚本同目录后重新运行。",
            "3. 有代理：设置 HTTPS_PROXY / HTTP_PROXY 环境变量后重试，",
            "   或在 pip 上加 --trusted-host pypi.org --trusted-host files.pythonhosted.org"
        )
    }
    Say-Ok "互联网连通正常，将在线安装。"
}

# ---------- 4. 安装 ----------
Say-Step "步骤 4/5：安装 icalendar"
$PipArgs = @('-m', 'pip', 'install', '--user')
if ($Offline) { $PipArgs += @('--no-index', '--find-links', $WheelsDir) }
$PipArgs += $Spec
$PipArgs += $ExtraPkgs

$CmdLine = "$PyExe " + (($PyPre + $PipArgs) -join ' ')
if ($DryRun) {
    Say-Info "（DryRun）将要执行：$CmdLine"
} else {
    Say-Info "执行：$CmdLine"
    Invoke-Py @PipArgs
    if ($LASTEXITCODE -ne 0) {
        Fail "安装失败。" @(
            "常见原因与处理：",
            "· 无外网 / 代理拦截 → 改用离线包（pack_icalendar_wheels.bat）或设置 HTTPS_PROXY",
            "· 公司证书拦截     → 加 --trusted-host pypi.org --trusted-host files.pythonhosted.org",
            "· 权限不足         → 右键 install_icalendar.bat → 以管理员身份运行",
            "· pip 版本过旧     → python -m pip install --upgrade pip",
            "· 杀毒软件拦截     → 将 python.exe 加入白名单后重试",
            "完整命令：$CmdLine"
        )
    }
}

# ---------- 5. 验证 ----------
Say-Step "步骤 5/5：验证安装结果"
if ($DryRun) {
    Say-Info "（DryRun）跳过验证。"
    exit 0
}

$IcalVer = (Invoke-Py -c 'import icalendar; print(icalendar.__version__)' 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $IcalVer) {
    Fail "安装命令已返回成功，但 Python 仍无法导入 icalendar。" @(
        "常见原因：装到了其它 Python 环境。",
        "处理：请用启动 TackList 服务的同一个 Python 重新运行本脚本。",
        "当前使用的 Python：$PyPath"
    )
}

Say-Ok "icalendar $IcalVer 安装成功，已可被 Python 导入。"
Write-Host ""
Write-Host "    下一步：重启 TackList 服务后生效"
Write-Host "      start.bat restart"
Write-Host "    之后可在 设置 → 外部日历订阅 中点「立即同步」验证。"
Write-Host ""
Write-Host "    注意：若 TackList 服务用的是另一个 Python，请用同一个 Python 重新安装一次。"
Write-Host ""
exit 0
