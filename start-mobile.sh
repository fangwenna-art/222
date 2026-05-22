#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
CLIENT_PORT="${CLIENT_PORT:-5188}"
SERVER_PORT="${SERVER_PORT:-3010}"

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -z "$IP" ]; then
  IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
fi

echo ""
echo "  德州扑克 · 手机访问（需与电脑同一 WiFi）"
echo ""
echo "  页面: http://${IP}:${CLIENT_PORT}/"
echo "  服务端: http://${IP}:${SERVER_PORT}"
echo ""
echo "  按 Ctrl+C 停止"
echo ""

cd "$ROOT/server"
PORT="$SERVER_PORT" ALLOW_LAN=true node src/index.js &
SERVER_PID=$!

cd "$ROOT/client"
python3 -m http.server "$CLIENT_PORT" --bind 0.0.0.0 &
CLIENT_PID=$!

trap 'kill $SERVER_PID $CLIENT_PID 2>/dev/null' EXIT
wait
