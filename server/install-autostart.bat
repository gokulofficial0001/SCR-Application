@echo off
REM ============================================================
REM  Register the SCR Server to auto-start on Windows BOOT.
REM
REM  This creates a SYSTEM-level scheduled task that runs the
REM  watchdog BEFORE anyone logs in — the most robust option
REM  for an always-on hospital LAN server.
REM
REM  >>> RIGHT-CLICK this file and choose "Run as administrator" <<<
REM  (a SYSTEM / ONSTART task requires admin rights to create)
REM ============================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: This script must be run as Administrator.
    echo  Right-click install-autostart.bat  -^>  Run as administrator
    echo.
    pause
    exit /b 1
)

set "WATCHDOG=%~dp0watchdog-server.bat"

echo.
echo  Registering scheduled task "SCR Server" (runs at system startup)...
schtasks /Create /TN "SCR Server" /TR "cmd /c \"%WATCHDOG%\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F

if %errorlevel% equ 0 (
    echo.
    echo  Done. The SCR server will now start automatically every boot
    echo  and restart itself if it ever crashes.
    echo.
    echo  To start it RIGHT NOW without rebooting:
    echo      schtasks /Run /TN "SCR Server"
    echo.
) else (
    echo.
    echo  Task creation failed. Make sure you ran this as Administrator.
    echo.
)
pause
