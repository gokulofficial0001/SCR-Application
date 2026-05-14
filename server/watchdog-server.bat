@echo off
REM ============================================================
REM  SCR Server - WATCHDOG launcher
REM  Self-restarting: if the server crashes or is killed, this
REM  loop restarts it automatically after 5 seconds.
REM  Also clears any stale process holding port 3500 first.
REM  Output is appended to watchdog.log in this folder.
REM
REM  This file is launched automatically by the "SCR Server"
REM  scheduled task at logon. You can also double-click it.
REM ============================================================

title SCR Server (watchdog - keep open)
cd /d "%~dp0"

REM Prefer the standard all-users Node path; fall back to PATH
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

:loop
REM --- free port 3500 from any stale/zombie process ---
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3500 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo [%date% %time%] Starting SCR server...
echo [%date% %time%] Starting SCR server... >> watchdog.log

"%NODE%" server.js >> watchdog.log 2>&1

echo [%date% %time%] Server stopped/crashed - restarting in 5 seconds...
echo [%date% %time%] Server stopped/crashed - restarting in 5 seconds... >> watchdog.log
timeout /t 5 /nobreak >nul
goto loop
