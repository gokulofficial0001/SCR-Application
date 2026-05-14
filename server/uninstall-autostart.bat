@echo off
REM ============================================================
REM  Remove the "SCR Server" auto-start scheduled task.
REM  Run as administrator if the task was created as SYSTEM.
REM ============================================================

echo.
echo  Removing scheduled task "SCR Server"...
schtasks /Delete /TN "SCR Server" /F

if %errorlevel% equ 0 (
    echo  Done. Auto-start has been removed.
) else (
    echo  Could not remove the task. If it was created as SYSTEM,
    echo  right-click this file and Run as administrator.
)
echo.
pause
