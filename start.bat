@echo off
setlocal
title TackList

set APP_DIR=%~dp0
set ACTION=%1
if "%ACTION%"=="" set ACTION=start

:: All start/guard/health-check logic is handled in launcher.py
:: Probe Python by actually running it: WindowsApps stub aliases pass "where"
:: checks but cannot execute, and Python 2 must be rejected as well
set PYTHON_CMD=
python -c "import sys; assert sys.version_info[0]==3" >nul 2>&1 && set PYTHON_CMD=python
if not defined PYTHON_CMD python3 -c "import sys; assert sys.version_info[0]==3" >nul 2>&1 && set PYTHON_CMD=python3
if not defined PYTHON_CMD py -c "import sys; assert sys.version_info[0]==3" >nul 2>&1 && set PYTHON_CMD=py
if not defined PYTHON_CMD (
    echo [ERROR] Python 3 not found. Please install Python 3.8+
    echo Download: https://www.python.org/downloads/
    echo Check "Add Python to PATH" during installation
    pause
    exit /b 1
)

"%PYTHON_CMD%" "%APP_DIR%launcher.py" %ACTION%
endlocal
