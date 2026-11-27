@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ZHIXING] Node.js not found. Please install Node 20+ first.
  pause
  exit /b 1
)

if not exist "node_modules\vite" (
  echo [ZHIXING] Installing dependencies for the first run...
  call npm.cmd install
  if errorlevel 1 (
    echo [ZHIXING] npm install failed.
    pause
    exit /b 1
  )
)

echo [ZHIXING] Building front-end...
call npm.cmd run build
if errorlevel 1 (
  echo [ZHIXING] Build failed.
  pause
  exit /b 1
)

echo [ZHIXING] Starting local server...
node server\index.js --open
pause
