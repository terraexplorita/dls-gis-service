@echo off
setlocal
cd /d "%~dp0"
echo PERSONAL LIFE OS Events - local updater/start
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-local.ps1"
if errorlevel 1 (
  echo.
  echo Update failed. The app was NOT started.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)
echo.
echo Starting local app...
node server.js
pause
