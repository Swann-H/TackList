@echo off
setlocal EnableDelayedExpansion

echo ========================================
echo   Schedule Manager - Windows Install
echo ========================================
echo.

:: Deep probe: run every candidate (python / python3 / py) and keep the
:: highest version >= 3.8. Probing by actually running rejects the
:: WindowsApps stub aliases (which pass "where" checks but cannot execute)
:: and Python 2 as well. Result is cached to python.conf so start.bat can
:: skip live probing on every launch (fast startup); users can also edit
:: that file to pin a specific version, e.g. "py -3.9".
set BEST_CMD=
set BEST_VER=0
for %%c in (python python3 py) do (
    set V=
    for /f "delims=" %%v in ('%%c -c "import sys; print(sys.version_info[0]*100+sys.version_info[1])" 2^>nul') do set V=%%v
    if defined V if !V! GEQ 308 if !V! GTR !BEST_VER! (
        set BEST_VER=!V!
        set BEST_CMD=%%c
    )
)

if not defined BEST_CMD (
    echo [ERROR] Python 3.8+ not found. Please install Python 3.8+
    echo Download: https://www.python.org/downloads/
    echo Check "Add Python to PATH" during installation
    echo.
    pause
    exit /b 1
)

set /a MAJOR=!BEST_VER!/100
set /a MINOR=!BEST_VER!%%100
echo [1/3] Checking Python... OK (!BEST_CMD!, !MAJOR!.!MINOR!)
echo.

set APP_DIR=%~dp0

echo [2/3] Caching Python command to python.conf...
(echo !BEST_CMD!)> "%APP_DIR%python.conf"

:: Create desktop shortcut.
:: - The app dir is passed via an environment variable: the env block is
::   UTF-16, so paths with non-ASCII characters survive the cmd-to-PowerShell
::   handoff regardless of the active code page.
:: - WindowStyle=7 keeps the start.bat console minimized instead of flashing.
:: - Chinese name is constructed via Unicode code points to avoid encoding issues.
echo [3/3] Creating desktop shortcut...
set "TACKLIST_APP_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$n=-join([char[]](0x65E5,0x7A0B,0x7BA1,0x7406)); $d=[Environment]::GetFolderPath('Desktop'); $a=$env:TACKLIST_APP_DIR; $ws=New-Object -ComObject WScript.Shell; $l=$ws.CreateShortcut($d+'\'+$n+'.lnk'); $l.TargetPath=$a+'start.bat'; $l.WorkingDirectory=$a; $l.IconLocation=$a+'favicon.ico,0'; $l.WindowStyle=7; $l.Save()"

:: Remove old startup shortcut if exists (from previous versions)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$n=-join([char[]](0x65E5,0x7A0B,0x7BA1,0x7406)); $s=[Environment]::GetFolderPath('Startup'); $f=$s+'\'+$n+'.lnk'; if(Test-Path $f){Remove-Item $f -Force}"

echo.
echo ========================================
echo   Install complete!
echo ========================================
echo.
echo   Desktop shortcut created (minimized console).
echo   Cached Python command: !BEST_CMD!
echo.
echo   Usage:
echo     - Double-click desktop shortcut to start
echo     - Enable auto-start in Settings
echo     - Command line: start.bat start^|stop^|restart
echo     - Pin a Python version: edit python.conf in this folder
echo.
pause
