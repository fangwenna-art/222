#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3001}"

cd "$ROOT"
echo ""
echo "  德州扑克 · 本地测试（方案 A）"
echo ""
echo "  1/2 安装依赖..."
npm install --silent 2>/dev/null || npm install
echo "  2/2 运行测试..."
npm test
echo ""
echo "  启动开发服务（改 server 代码会自动重启）"
echo "  浏览器打开: http://localhost:${PORT}"
echo "  多人测试: 再开一个无痕窗口，加入同一房间"
echo "  健康检查: curl http://localhost:${PORT}/health"
echo "  按 Ctrl+C 停止"
echo ""

cd "$ROOT/server"
PORT="$PORT" ALLOW_LAN=true node --watch src/index.js
