<#
.SYNOPSIS
    TackList 离线依赖包打包脚本（icalendar） — Windows

.DESCRIPTION
    在「能上网」的电脑上，把可选依赖 icalendar 及其依赖打包成 wheels 目录，
    供无外网的内网机离线安装（配合 install_icalendar.bat 使用）。

    icalendar 及其依赖都是纯 Python 包，打出的 wheel 与 CPU 架构无关。

.PARAMETER TargetVersion
    目标机的 Python 版本（如 3.8）。省略时按本机 Python 版本打包。

.PARAMETER DryRun
    只打印将要执行的命令，不实际下载。

.EXAMPLE
    .\pack_icalendar_wheels.ps1
    .\pack_icalendar_wheels.ps1 -TargetVersion 3.8
#>
param(
    [string]$TargetVersion,
    [switch]$DryRun
)

$AppDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutDir  = Join-Path $AppDir 'wheels'

function Say-Info($m) { Write-Host "[信息] $m" -ForegroundColor Cyan }
function Say-Ok($m)   { Write-Host "[成功] $m" -ForegroundColor Green }
function Say-Warn($m) { Write-Host "[提示] $m" -ForegroundColor Yellow }
function Say-Err($m)  { Write-Host "[失败] $m" -ForegroundColor Red }

function Fail($title, [string[]]$tips) {
    Say-Err $title
    if ($tips) { Write-Host ""; foreach ($t in $tips) { Write-Host "    $t" } }
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "============================================================"
Write-Host "  TackList 离线依赖包打包（icalendar，可选依赖）"
Write-Host "============================================================"
Write-Host ""

# ---------- 1. 定位 Python ----------
$PyExe = $null
$PyPre = @()
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
    if ($LASTEXITCODE -eq 0) { $PyExe = $c.Exe; $PyPre = $c.Pre; break }
}
if (-not $PyExe) { Fail "本机未找到 Python 3，无法打包。" @("处理：安装 Python 3.8+ 并勾选 [Add Python to PATH] 后重试。") }

function Invoke-Py {
    param([Parameter(ValueFromRemainingArguments = $true)]$Args)
    & $PyExe @($PyPre + $Args)
}

$LocalVer = (Invoke-Py -c "import sys; v=sys.version_info; print(str(v[0])+'.'+str(v[1]))" 2>$null | Out-String).Trim()
Say-Info "本机 Python 版本：$LocalVer"

if ([string]::IsNullOrWhiteSpace($TargetVersion)) { $TargetVersion = $LocalVer }
Say-Info "目标机 Python 版本：$TargetVersion"

$minor = 0
[void][int]::TryParse(($TargetVersion.Split('.')[1]), [ref]$minor)
$Spec = 'icalendar'
$Note = 'Python 3.10+ → icalendar 最新版'
switch ($minor) {
    7 { $Spec = 'icalendar<6'; $Note = 'Python 3.7 → icalendar 5.0.x' }
    8 { $Spec = 'icalendar<7'; $Note = 'Python 3.8 → icalendar 6.3.x' }
    9 { $Spec = 'icalendar<7'; $Note = 'Python 3.9 → icalendar 6.3.x' }
}
Say-Info "版本匹配：$Note"
$ExtraPkgs = @('python-dateutil', 'six', 'tzdata', 'typing-extensions')

# ---------- 2. 检查 pip / 网络 ----------
$null = Invoke-Py -m pip --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Fail "本机 pip 不可用。" @("处理：重新安装 Python 并勾选 pip，或执行 python -m ensurepip。")
}

$null = Invoke-Py -c "import urllib.request; urllib.request.urlopen('https://pypi.org/simple/', timeout=10)" 2>$null
if ($LASTEXITCODE -ne 0) {
    Fail "本机无法访问 PyPI，无法下载离线包。" @(
        "处理：请换一台能上网的电脑执行本脚本，或配置代理 / 内网镜像后重试。"
    )
}

# ---------- 3. 下载 ----------
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
Write-Host ""
Say-Info "开始下载到 $OutDir ..."

$dlArgs = @('-m','pip','download','-d',$OutDir,'--only-binary=:all:',
            '--python-version',$TargetVersion,'--implementation','py','--abi','none','--platform','any') + $Spec + $ExtraPkgs

if ($DryRun) {
    Say-Info "（DryRun）将要执行：$PyExe " + (($PyPre + $dlArgs) -join ' ')
    exit 0
}

Invoke-Py @dlArgs
if ($LASTEXITCODE -ne 0) {
    Say-Warn "按目标版本 $TargetVersion 精确打包失败，回退为按本机版本 $LocalVer 打包..."
    $dlArgs2 = @('-m','pip','download','-d',$OutDir,'--only-binary=:all:') + $Spec + $ExtraPkgs
    Invoke-Py @dlArgs2
    if ($LASTEXITCODE -ne 0) {
        Fail "打包失败。" @(
            "· pip 版本过旧 → python -m pip install --upgrade pip 后重试",
            "· 网络/代理问题 → 设置 HTTPS_PROXY 或 PIP_INDEX_URL 后重试",
            "· 目标 Python 版本过旧，无可用 wheel → 升级目标机 Python"
        )
    }
    Say-Warn "已按本机版本（$LocalVer）打包，若目标机版本为 $TargetVersion，请核对 wheel 是否匹配。"
}

Write-Host ""
$whls = Get-ChildItem -Path $OutDir -Filter *.whl -ErrorAction SilentlyContinue
if ($whls -and $whls.Count -gt 0) {
    Say-Ok "离线包已生成：$OutDir"
    foreach ($w in $whls) { Write-Host "        - $($w.Name)" }
    Write-Host ""
    Write-Host "    下一步："
    Write-Host "      1) 把整个 wheels 目录拷贝到目标机，与 install_icalendar.bat 放在同一目录"
    Write-Host "      2) 在目标机双击运行 install_icalendar.bat"
    Write-Host "      （脚本会自动识别 wheels 并离线安装，全程不联网）"
} else {
    Fail "未生成任何 wheel 文件，请检查上面的错误信息。"
}
Write-Host ""
exit 0
