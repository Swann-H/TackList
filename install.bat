@echo off

echo ========================================
echo   Schedule Manager - Windows Install
echo ========================================
echo.

:: Check Python (probe by running it: WindowsApps stub aliases pass "where"
:: checks but cannot execute, and Python 2 must be rejected as well)
set PYTHON_OK=
python -c "import sys; assert sys.version_info[0]==3" >nul 2>&1 && set PYTHON_OK=1
if not defined PYTHON_OK python3 -c "import sys; assert sys.version_info[0]==3" >nul 2>&1 && set PYTHON_OK=1
if not defined PYTHON_OK py -c "import sys; assert sys.version_info[0]==3" >nul 2>&1 && set PYTHON_OK=1
if not defined PYTHON_OK (
    echo [ERROR] Python 3 not found. Please install Python 3.8+
    echo Download: https://www.python.org/downloads/
    echo Check "Add Python to PATH" during installation
    echo.
    pause
    exit /b 1
)

echo [1/3] Checking Python...OK
echo.

set APP_DIR=%~dp0

:: Create desktop shortcut using PowerShell
:: Chinese name is constructed via Unicode code points to avoid encoding issues
echo [2/2] Creating desktop shortcut...
powershell -ExecutionPolicy Bypass -Command "$n=-join([char[]](0x65E5,0x7A0B,0x7BA1,0x7406)); $d=[Environment]::GetFolderPath('Desktop'); $ws=New-Object -ComObject WScript.Shell; $l=$ws.CreateShortcut($d+'\'+$n+'.lnk'); $l.TargetPath='%APP_DIR%start.bat'; $l.WorkingDirectory='%APP_DIR%'; $l.IconLocation='%APP_DIR%favicon.ico,0'; $l.Save()"

:: Remove old startup shortcut if exists (from previous versions)
powershell -ExecutionPolicy Bypass -Command "$n=-join([char[]](0x65E5,0x7A0B,0x7BA1,0x7406)); $s=[Environment]::GetFolderPath('Startup'); $f=$s+'\'+$n+'.lnk'; if(Test-Path $f){Remove-Item $f -Force}"

echo.
echo ========================================
echo   Install complete!
echo ========================================
echo.
echo   Desktop shortcut created.
echo.
echo   Usage:
echo     - Double-click desktop shortcut to start
echo     - Enable auto-start in Settings
echo     - Command line: start.bat start^|stop^|restart
echo.
pause
