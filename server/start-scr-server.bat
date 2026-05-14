@echo off
REM ============================================================
REM  SCR Management System - Server Launcher
REM  Double-click this file to start the server.
REM  - Kills any stale/zombie process holding port 3500 first
REM  - Starts the Node server in THIS window
REM  - Keep this window open while you use the app
REM  - Close this window (or press Ctrl+C) to stop the server
REM ============================================================

title SCR Server - port 3500
cd /d "%~dp0"

echo.
echo  ============================================
echo   SCR Management System - Server Launcher
echo  ============================================
echo.

REM --- Step 1: free port 3500 if a stale process is holding it ---
echo  Checking port 3500 for stale processes...
set "FOUND="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3500 " ^| findstr "LISTENING"') do (
    set "FOUND=%%a"
    echo  Found process %%a on port 3500 - terminating it...
    taskkill /F /PID %%a >nul 2>&1
)
if defined FOUND (
    echo  Port 3500 cleared.
    timeout /t 1 /nobreak >nul
) else (
    echo  Port 3500 is free.
)
echo.

REM --- Step 2: start the server ---
echo  Starting SCR server...
echo  ------------------------------------------------------------
node server.js

REM --- Step 3: server stopped ---
echo.
echo  ------------------------------------------------------------
echo  SCR server has stopped.
echo  Press any key to close this window.
pause >nul
