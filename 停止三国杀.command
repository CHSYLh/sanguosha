#!/bin/bash
# 停止三国杀联机服务（macOS / Linux）
# 使用：双击运行，或在终端执行 ./停止三国杀.command
cd "$(dirname "$0")" || exit 1

echo "============================================"
echo "  停止三国杀联机服务"
echo "============================================"
echo

# 精确匹配本项目启动的 node server.js 进程
PIDS=$(pgrep -f "node.*server\.js" 2>/dev/null)

if [ -z "$PIDS" ]; then
  echo "  没有找到正在运行的三国杀服务。"
else
  for pid in $PIDS; do
    if kill "$pid" 2>/dev/null; then
      echo "  已停止服务进程 (PID $pid)"
    else
      echo "  !! 无法停止进程 $pid"
    fi
  done
  sleep 1
  echo
  echo "  三国杀联机服务已停止。"
fi

echo
read -n 1 -s -r -p "按任意键退出..."
echo
