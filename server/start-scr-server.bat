@echo off
REM ============================================================
REM  SCR Management System - DEV Server Launcher (manual)
REM  ----------------------------------------------------------
REM  Environment : DEVELOPMENT   Binds: 127.0.0.1:3500
REM  Double-click to start the dev server in this window.
REM  Test on http://localhost:3500, then deploy-to-live.bat.
REM  Only frees 127.0.0.1:3500 - never touches LIVE.
REM ============================================================

title SCR Server [DEV - localhost:3500]
cd /d "%~dp0"

set "HOST=127.0.0.1"
set "PORT=3500"
set "SCR_ENV=DEVELOPMENT"

echo.
echo  ============================================
echo   SCR Management System - DEV (localhost:3500)
echo  ============================================
echo.

REM --- free ONLY 127.0.0.1:3500 if a stale process holds it ---
echo  Checking 127.0.0.1:3500 for stale processes...
set "FOUND="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "127.0.0.1:3500" ^| findstr "LISTENING"') do (
    set "FOUND=%%a"
    echo  Found process %%a on 127.0.0.1:3500 - terminating it...
    taskkill /F /PID %%a >nul 2>&1
)
if defined FOUND (
    echo  127.0.0.1:3500 cleared.
    timeout /t 1 /nobreak >nul
) else (
    echo  127.0.0.1:3500 is free.
)
echo.

echo  Starting DEV SCR server...
echo  ------------------------------------------------------------
node server.js

echo.
echo  ------------------------------------------------------------
echo  DEV SCR server has stopped.
echo  Press any key to close this window.
pause >nul
