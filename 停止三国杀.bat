@echo off
title 停止三国杀服务
rem %~dp0 以反斜杠结尾，须写成 %~dp0. 否则引号被当成转义
cd /d "%~dp0."

echo ============================================
echo   停止三国杀联机服务
echo ============================================
echo.
echo 正在查找并停止服务进程...

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop-server.ps1"
if errorlevel 1 (
  echo.
  echo PowerShell 不可用，请改为关闭运行服务时的那个窗口。
) else (
  echo.
)

echo.
echo 若提示没有找到进程，说明服务已经关闭。
echo.
pause
