@echo off
setlocal EnableDelayedExpansion
title TackList

set APP_DIR=%~dp0
set ACTION=%1
if "%ACTION%"=="" set ACTION=start

:: All start/guard/health-check logic is handled in launcher.py
:: Python resolution order:
::   1. python.conf (written by install.bat / by a previous successful probe;
::      users can edit it to pin a version, e.g. "py -3.9", or a quoted full
::      path when it contains spaces)
::   2. live probe of python / python3 / py, keeping the highest version
::      >= 3.8; the result is written back to python.conf for next time
:: Probing by actually running rejects WindowsApps stub aliases and Python 2.
set PYTHON_CMD=

set CACHED_PY=
if exist "%APP_DIR%python.conf" (
    for /f "usebackq eol=# delims=" %%a in ("%APP_DIR%python.conf") do (
        if not defined CACHED_PY set CACHED_PY=%%a
    )
)
if defined CACHED_PY (
    %CACHED_PY% -c "import sys; assert sys.version_info >= (3,8)" >nul 2>&1 || set CACHED_PY=
)
if defined CACHED_PY set PYTHON_CMD=%CACHED_PY%

if not defined PYTHON_CMD (
    set BEST_VER=0
    for %%c in (python python3 py) do (
        set V=
        for /f "delims=" %%v in ('%%c -c "import sys; print(sys.version_info[0]*100+sys.version_info[1])" 2^>nul') do set V=%%v
        if defined V if !V! GEQ 308 if !V! GTR !BEST_VER! (
            set BEST_VER=!V!
            set PYTHON_CMD=%%c
        )
    )
)

if not defined PYTHON_CMD (
    echo [ERROR] Python 3.8+ not found. Please install Python 3.8+
    echo Download: https://www.python.org/downloads/
    echo Check "Add Python to PATH" during installation
    pause
    exit /b 1
)

:: Persist the working command so the next start skips live probing
if not defined CACHED_PY (
    (echo !PYTHON_CMD!)> "%APP_DIR%python.conf"
)

%PYTHON_CMD% "%APP_DIR%launcher.py" %ACTION%
endlocal
