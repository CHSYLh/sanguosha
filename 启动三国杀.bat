@echo off
title 三国杀联机服务
rem 注意：%~dp0 以反斜杠结尾，写成 "%~dp0" 会让 cmd 把结尾的反斜杠当成转义符，
rem      必须用 "%~dp0." 这种形式，否则整条命令会被当成非法路径。
cd /d "%~dp0."

echo ============================================
echo   三国杀联机版 - 一键启动
echo ============================================
echo.

rem ---- 检查 Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js。
  echo        请先到 https://nodejs.org 下载安装。
  echo.
  pause
  exit /b 1
)

rem ---- 首次运行自动安装依赖 ----
if not exist "node_modules" (
  echo 首次运行，正在安装依赖，请稍候...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
  echo 依赖安装完成。
  echo.
)

rem ---- 服务已在别处启动：直接打开浏览器，避免端口占用报错 ----
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:3000/healthz' -UseBasicParsing -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo 检测到服务已经在运行中，直接打开浏览器。
  echo 如需重启，请先关闭此前的运行窗口，或双击「停止三国杀.bat」。
  echo.
  start "" http://localhost:3000
  timeout /t 3 >nul
  exit /b 0
)

echo 正在启动服务，启动后会自动打开浏览器。
echo 局域网内其他设备访问下面输出的「局域网访问」地址即可加入。
echo.
echo 关闭本窗口即可停止服务；也可用「停止三国杀.bat」结束后台进程。
echo ============================================
echo.

start "" http://localhost:3000

node server.js

echo.
echo 服务已停止。
pause
