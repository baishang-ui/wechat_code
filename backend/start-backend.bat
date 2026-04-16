@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%start-backend.ps1"

if not exist "%PS_SCRIPT%" (
  echo [backend] PowerShell startup script not found:
  echo %PS_SCRIPT%
  echo.
  pause
  exit /b 1
)

echo [backend] Starting backend server...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"

echo.
if errorlevel 1 (
  echo [backend] Startup failed. Please check the logs above.
) else (
  echo [backend] Server exited.
)

echo.
pause
