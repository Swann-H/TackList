@echo off
rem ============================================================
rem  TackList optional dependency installer (icalendar) - Windows
rem  Only needed for the "External Calendar Subscription" feature.
rem  This .bat is an ASCII launcher; the real logic is in install_icalendar.ps1
rem ============================================================
setlocal
cd /d "%~dp0"

where powershell >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell not found. Please run install_icalendar.ps1 manually.
    pause
    exit /b 1
)

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0install_icalendar.ps1" %*

echo.
pause
exit /b 0
