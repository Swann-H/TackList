@echo off
setlocal
title TackList

set APP_DIR=%~dp0
set ACTION=%1
if "%ACTION%"=="" set ACTION=start

:: All start/guard/health-check logic is handled in launcher.py
set PYTHON_CMD=
where python >nul 2>&1 && set PYTHON_CMD=python
if not defined PYTHON_CMD where python3 >nul 2>&1 && set PYTHON_CMD=python3
if not defined PYTHON_CMD where pythonw >nul 2>&1 && set PYTHON_CMD=pythonw
if not defined PYTHON_CMD (
    echo [ERROR] Python not found. Please install Python 3.8+
    echo Download: https://www.python.org/downloads/
    echo Check "Add Python to PATH" during installation
    pause
    exit /b 1
)

"%PYTHON_CMD%" "%APP_DIR%launcher.py" %ACTION%
endlocal
