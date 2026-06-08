@echo off
REM ============================================================
REM   DEPLOY TO LIVE  -  push tested DEV code to the LIVE server
REM   ----------------------------------------------------------
REM   DEV  source : this folder            (localhost:3500)
REM   LIVE target : C:\SCR-LIVE            (10.10.1.26:3500)
REM
REM   WHAT IT DOES
REM     1. Backs up the LIVE database (safety snapshot)
REM     2. Copies code (js, css, html, server\*.js) DEV -> LIVE
REM     3. NEVER touches the LIVE database, node_modules, or the
REM        LIVE launcher .bat files (each env keeps its own)
REM     4. Restarts the LIVE server so changes take effect
REM
REM   USE: test your changes on http://localhost:3500 first,
REM        then double-click this file to publish to LIVE.
REM ============================================================

setlocal
set "SRC=%~dp0"
set "DST=C:\SCR-LIVE"
set "LIVEIP=10.10.1.26"

echo.
echo  ============================================================
echo    DEPLOY TO LIVE
echo    From: %SRC%
echo    To  : %DST%   (http://%LIVEIP%:3500/)
echo  ============================================================
echo.

if not exist "%DST%\server\server.js" (
    echo  ERROR: LIVE folder not found at %DST%
    echo  Expected %DST%\server\server.js
    echo.
    pause
    exit /b 1
)

echo  This will publish your DEV code to the LIVE server that
echo  your team uses. The LIVE database will NOT be changed.
echo.
set /p "CONFIRM=  Type Y to continue, anything else to cancel: "
if /i not "%CONFIRM%"=="Y" (
    echo  Cancelled. Nothing was changed.
    echo.
    pause
    exit /b 0
)
echo.

REM --- 1. Safety: snapshot the LIVE database before we touch anything ---
echo  [1/3] Backing up LIVE database...
if exist "%DST%\server\data\scr.db" (
    if not exist "%DST%\server\data\backups" mkdir "%DST%\server\data\backups"
    for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmmss"') do set "STAMP=%%i"
    copy /y "%DST%\server\data\scr.db" "%DST%\server\data\backups\pre-deploy-%STAMP%.db" >nul
    echo        saved data\backups\pre-deploy-%STAMP%.db
) else (
    echo        (no LIVE database yet - skipping)
)
echo.

REM --- 2. Sync code only. Excludes protect LIVE data + per-env launchers ---
echo  [2/3] Copying code DEV -^> LIVE...
robocopy "%SRC%." "%DST%" /MIR ^
  /XD ".git" "data" "node_modules" "backups" ".claude" ^
  /XF "*.bat" "*.bak" "watchdog.log" "*.log" ^
  /R:1 /W:1 /MT:16 /NFL /NDL /NJH /NP
if errorlevel 8 (
    echo.
    echo  ERROR: copy failed - robocopy reported a fatal error. LIVE not restarted.
    echo.
    pause
    exit /b 1
)
echo        code synced.
echo.

REM --- 3. Restart LIVE so the new code loads. Watchdog auto-restarts it. ---
echo  [3/3] Restarting LIVE server (%LIVEIP%:3500)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "%LIVEIP%:3500" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo        LIVE process stopped - watchdog will restart it in ~5s.
echo.
echo  ============================================================
echo    DEPLOY COMPLETE.  Verify at  http://%LIVEIP%:3500/
echo  ============================================================
echo.
echo  NOTE: if you added a NEW npm dependency, run "npm install"
echo        inside %DST%\server once (node_modules is not copied).
echo.
pause
endlocal
