@echo off
rem ============================================================
rem  TackList offline wheel packer (icalendar) - Windows
rem  Run this on a computer WITH internet access, then copy the
rem  generated "wheels" folder to the offline machine.
rem  Usage: pack_icalendar_wheels.bat [target-python-version]   e.g. 3.8
rem  This .bat is an ASCII launcher; the real logic is in pack_icalendar_wheels.ps1
rem ============================================================
setlocal
cd /d "%~dp0"

where powershell >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell not found. Please run pack_icalendar_wheels.ps1 manually.
    pause
    exit /b 1
)

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0pack_icalendar_wheels.ps1" %*

echo.
pause
exit /b 0
