@echo off
setlocal enabledelayedexpansion
title Schedule Manager

set APP_DIR=%~dp0
set PID_FILE=%APP_DIR%server.pid
set LOG_FILE=%APP_DIR%server.log
set PORT_FILE=%APP_DIR%server.port
set DEFAULT_PORT=14438

if "%1"=="stop" goto :stop
if "%1"=="restart" goto :restart
goto :start

:start
:: Check if already running via PID file AND verify server is actually responding
if exist "%PID_FILE%" (
    set /p OLD_PID=<"%PID_FILE%"
    tasklist /FI "PID eq !OLD_PID!" 2>nul | find "!OLD_PID!" >nul
    if not errorlevel 1 (
        :: PID is running, verify server is actually responding on the port
        set CHECK_PORT=
        if exist "%PORT_FILE%" set /p CHECK_PORT=<"%PORT_FILE%"
        if "!CHECK_PORT!"=="" set CHECK_PORT=%DEFAULT_PORT%
        powershell -Command "try{Invoke-WebRequest -Uri 'http://127.0.0.1:!CHECK_PORT!/api/platform' -TimeoutSec 3 -UseBasicParsing|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
        if not errorlevel 1 (
            echo Service is running (PID: !OLD_PID!)
            goto :open_browser
        )
        :: PID exists but server not responding - stale PID, clean up
        echo Stale PID detected, cleaning up...
    )
    del "%PID_FILE%" 2>nul
    del "%PORT_FILE%" 2>nul
)

:: Always clean up stale port file before starting new server
if exist "%PORT_FILE%" del "%PORT_FILE%" 2>nul

:: Kill any zombie processes on the port before starting
call :kill_port_processes
timeout /t 2 /nobreak >nul

:: Verify port is free before starting
set RETRY=0
:verify_port_free
netstat -ano | findstr "LISTENING" | findstr ":!DEFAULT_PORT! " >nul 2>&1
if not errorlevel 1 (
    set /a RETRY+=1
    if !RETRY! GEQ 5 (
        echo WARNING: Port !DEFAULT_PORT! still in use after kill attempts. Retrying anyway...
        goto :skip_port_check
    )
    call :kill_port_processes
    timeout /t 2 /nobreak >nul
    goto :verify_port_free
)
:skip_port_check

:: Check Python
set PYTHON_CMD=python
where python >nul 2>&1
if errorlevel 1 (
    where python3 >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Python not found. Please install Python 3.8+
        echo Download: https://www.python.org/downloads/
        pause
        exit /b 1
    )
    set PYTHON_CMD=python3
)

:: Prefer pythonw (no console window) if available
where pythonw >nul 2>&1
if not errorlevel 1 (
    set PYTHON_CMD=pythonw
) else (
    if "!PYTHON_CMD!"=="python3" (
        where pythonw3 >nul 2>&1
        if not errorlevel 1 set PYTHON_CMD=pythonw3
    )
)

echo Starting server...

:: Start server with no visible console window
:: Remove trailing backslash from APP_DIR to avoid escaping issues in PowerShell
set APP_DIR_SAFE=%APP_DIR:~0,-1%
if "!PYTHON_CMD!"=="pythonw" (
    powershell -ExecutionPolicy Bypass -Command "Start-Process 'pythonw' -ArgumentList 'server.py' -WorkingDirectory '!APP_DIR_SAFE!' -WindowStyle Hidden"
) else if "!PYTHON_CMD!"=="pythonw3" (
    powershell -ExecutionPolicy Bypass -Command "Start-Process 'pythonw3' -ArgumentList 'server.py' -WorkingDirectory '!APP_DIR_SAFE!' -WindowStyle Hidden"
) else (
    powershell -ExecutionPolicy Bypass -Command "Start-Process '!PYTHON_CMD!' -ArgumentList 'server.py' -WorkingDirectory '!APP_DIR_SAFE!' -WindowStyle Hidden"
)

:: Wait for server.port file (max 15 seconds)
set WAIT_COUNT=0
:wait_loop
if exist "%PORT_FILE%" goto :server_ready
set /a WAIT_COUNT+=1
if !WAIT_COUNT! GEQ 15 (
    echo ERROR: Server failed to start within 15 seconds.
    echo Check %LOG_FILE% for details.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto :wait_loop

:server_ready
:: Read port from server.port file
set SERVER_PORT=
if exist "%PORT_FILE%" (
    set /p SERVER_PORT=<"%PORT_FILE%"
)
if "!SERVER_PORT!"=="" set SERVER_PORT=%DEFAULT_PORT%

:: Verify server is actually responding before opening browser (max 10 seconds)
:: Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues
set HEALTH_COUNT=0
:health_check
set /a HEALTH_COUNT+=1
if !HEALTH_COUNT! GEQ 10 (
    echo WARNING: Server port file found but server not responding. Opening browser anyway.
    goto :open_browser
)
powershell -Command "try{Invoke-WebRequest -Uri 'http://127.0.0.1:!SERVER_PORT!/api/platform' -TimeoutSec 2 -UseBasicParsing|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 (
    echo Service started successfully.
    goto :open_browser
)
timeout /t 1 /nobreak >nul
goto :health_check

:open_browser
:: Read port from server.port file (re-read in case it changed)
set SERVER_PORT=
if exist "%PORT_FILE%" (
    set /p SERVER_PORT=<"%PORT_FILE%"
)
if "!SERVER_PORT!"=="" set SERVER_PORT=%DEFAULT_PORT%
:: Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues on Windows
start "" http://127.0.0.1:!SERVER_PORT!
goto :eof

:stop
echo Stopping service...
:: Kill all processes listening on the port
call :kill_port_processes
if exist "%PID_FILE%" del "%PID_FILE%" 2>nul
if exist "%PORT_FILE%" del "%PORT_FILE%" 2>nul
echo Service stopped.
goto :eof

:restart
call "%~f0" stop
timeout /t 2 /nobreak >nul
call "%~f0" start
goto :eof

:kill_port_processes
:: Determine the port to check
set KILL_PORT=%DEFAULT_PORT%
if exist "%PORT_FILE%" set /p KILL_PORT=<"%PORT_FILE%"
:: Kill all processes listening on the port using netstat
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":!KILL_PORT! "') do (
    taskkill /PID %%a /F >nul 2>&1
)
goto :eof
