@echo off
REM ============================================================
REM  SCR Server - DEVELOPMENT watchdog launcher
REM  ----------------------------------------------------------
REM  Environment : DEVELOPMENT
REM  Binds to    : 127.0.0.1:3500  (localhost only)
REM  URL         : http://localhost:3500/
REM
REM  This is the DEV environment. Edit code here, test on
REM  http://localhost:3500, then run deploy-to-live.bat to push
REM  the tested code to LIVE (10.10.1.26:3500).
REM
REM  Self-restarting: if the server crashes it restarts in 5s.
REM  IMPORTANT: this watchdog ONLY kills a stale process on
REM  127.0.0.1:3500. It NEVER touches LIVE (10.10.1.26:3500).
REM ============================================================

title SCR Server [DEV - localhost:3500] (keep open)
cd /d "%~dp0"

REM --- Environment: bind to localhost only ---
set "HOST=127.0.0.1"
set "PORT=3500"
set "SCR_ENV=DEVELOPMENT"

REM Prefer the standard all-users Node path; fall back to PATH
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

:loop
REM --- free ONLY 127.0.0.1:3500 from any stale/zombie process ---
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "127.0.0.1:3500" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo [%date% %time%] Starting SCR server [DEV localhost:3500]...
echo [%date% %time%] Starting SCR server [DEV localhost:3500]... >> watchdog.log

"%NODE%" server.js >> watchdog.log 2>&1

echo [%date% %time%] DEV server stopped/crashed - restarting in 5 seconds...
echo [%date% %time%] DEV server stopped/crashed - restarting in 5 seconds... >> watchdog.log
timeout /t 5 /nobreak >nul
goto loop
