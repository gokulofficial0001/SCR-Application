@echo off
setlocal
title SCR Server [LIVE - 10.10.27.169:3500] (keep open)
cd /d "%~dp0"

set "HOST=10.10.27.169"
set "PORT=3500"
set "SCR_ENV=LIVE"
set "NODE="

REM Require a runtime that supports the built-in node:sqlite module.
for /f "delims=" %%N in ('where node.exe 2^>nul') do (
    if not defined NODE call :try_node "%%N"
)
for /d %%D in ("%LOCALAPPDATA%\npm-cache\_npx\*") do (
    if not defined NODE call :try_node "%%D\node_modules\node\bin\node.exe"
)
if not defined NODE (
    echo ERROR: Node.js 22.5+ with node:sqlite is required.
    echo Install Node.js 22.5 or newer, then restart this watchdog.
    exit /b 1
)
for /f "delims=" %%V in ('"%NODE%" --version') do set "NODE_VERSION=%%V"
echo Using %NODE_VERSION%: %NODE%

powershell -NoProfile -Command "if (Get-NetIPAddress -IPAddress '10.10.27.169' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo ERROR: LIVE address 10.10.27.169 is not assigned to this computer.
    exit /b 1
)

:loop
netstat -aon | findstr /C:"10.10.27.169:3500" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo [%date% %time%] LIVE address is already served; this watchdog will not take over that listener.
    echo [%date% %time%] LIVE address is already served; watchdog stopped. >> watchdog-live.log
    exit /b 0
)

echo.
echo [%date% %time%] Starting SCR server [LIVE 10.10.27.169:3500]...
echo [%date% %time%] Starting SCR server [LIVE 10.10.27.169:3500]... >> watchdog-live.log

"%NODE%" server.js >> watchdog-live.log 2>&1

echo [%date% %time%] LIVE server stopped/crashed - restarting in 5 seconds...
echo [%date% %time%] LIVE server stopped/crashed - restarting in 5 seconds... >> watchdog-live.log
timeout /t 5 /nobreak >nul
goto loop

:try_node
if not exist "%~1" exit /b 0
"%~1" -e "require('node:sqlite')" >nul 2>&1
if errorlevel 1 exit /b 0
set "NODE=%~1"
exit /b 0
