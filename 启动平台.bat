@echo off
chcp 65001 >nul
title 异构服务器选型配置与算力匹配测算平台 V1.0
echo ================================================
echo  异构服务器选型配置与算力匹配测算平台 V1.0
echo ================================================
echo.

cd /d "%~dp0server"

rem 定位 Node：优先系统 PATH，其次本机便携版
where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE_EXE=node"
  set "NPM_CMD=npm"
) else if exist "C:\Users\admin\.nodejs\node-v20.18.1-win-x64\node.exe" (
  set "NODE_EXE=C:\Users\admin\.nodejs\node-v20.18.1-win-x64\node.exe"
  set "NPM_CMD=C:\Users\admin\.nodejs\node-v20.18.1-win-x64\npm.cmd"
) else (
  echo [错误] 未找到 Node.js，请安装 Node 18+ 后重试。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [初始化] 首次运行，安装依赖...
  call "%NPM_CMD%" install --registry=https://registry.npmmirror.com --no-audit --no-fund
  if errorlevel 1 ( echo [错误] 依赖安装失败 & pause & exit /b 1 )
)

echo [启动] 服务地址: http://127.0.0.1:3000
echo [提示] 管理后台账号 admin / Admin@123 ，支付为模拟支付
echo.
start "" http://127.0.0.1:3000
"%NODE_EXE%" src/index.js
pause
