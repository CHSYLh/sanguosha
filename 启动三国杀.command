#!/bin/bash
# 三国杀联机版 - 一键启动（macOS / Linux）
# 使用：双击运行，或在终端执行 ./启动三国杀.command
cd "$(dirname "$0")" || exit 1

echo "============================================"
echo "  三国杀联机版 - 一键启动"
echo "============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 没有检测到 Node.js，请先到 https://nodejs.org 安装。"
  read -n 1 -s -r -p "按任意键退出..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "首次运行，正在安装依赖，请稍候..."
  npm install || { echo "[错误] 依赖安装失败。"; read -n 1 -s -r -p "按任意键退出..."; exit 1; }
  echo "依赖安装完成。"
  echo
fi

echo "正在启动服务，启动后会自动打开浏览器。"
echo "局域网内的其他设备，用浏览器访问下面输出的「局域网访问」地址即可加入。"
echo "按 Ctrl+C 停止服务。"
echo "============================================"
echo

(sleep 2; (open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null) &) >/dev/null 2>&1

node server.js
