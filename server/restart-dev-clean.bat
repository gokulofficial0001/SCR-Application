@echo off
REM ============================================================
REM  Clean-restart the DEV server (localhost:3500)
REM  ----------------------------------------------------------
REM  Frees 127.0.0.1:3500 (even a stuck/elevated process) and
REM  starts a fresh DEV watchdog window.
REM
REM  >>> RIGHT-CLICK this file -> "Run as administrator" <<<
REM  (admin rights are needed to clear a leftover system-owned
REM   server process that a normal user cannot stop)
REM ============================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: must run as Administrator.
    echo  Right-click restart-dev-clean.bat  -^>  Run as administrator
    echo.
    pause
    exit /b 1
)

echo  Freeing 127.0.0.1:3500 ...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "127.0.0.1:3500" ^| findstr "LISTENING"') do (
    echo    stopping PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo  Starting a fresh DEV server window ...
start "SCR DEV" /min "%~dp0watchdog-server.bat"
timeout /t 3 /nobreak >nul

echo.
echo  Done. DEV server (re)started on http://localhost:3500/
echo  A minimized "SCR DEV" window is now running the server.
echo.
pause
