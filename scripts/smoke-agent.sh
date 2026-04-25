#!/usr/bin/env bash
set -euo pipefail

NOVEL_ID="${1:-}"
if [[ -z "$NOVEL_ID" ]]; then
  echo "用法: $0 <novel-id>" >&2
  exit 1
fi

PORT="${AGENT_SERVER_PORT:-3100}"
BASE="http://localhost:$PORT"

echo "=== 启动 outline agent (1-10 章) ==="
SESSION=$(curl -fsS -X POST "$BASE/api/agent/$NOVEL_ID/outline/start" \
  -H 'Content-Type: application/json' \
  -d '{"from":1,"to":10}' | jq -r .id)
echo "session: $SESSION"

echo "=== 触发 outline 自驱（流式） ==="
curl -N -fsS -X POST "$BASE/api/agent/session/$SESSION/run" \
  -H 'Content-Type: application/json' \
  -d '{}'

echo
echo
echo "=== 产物（target/） ==="
DATA_DIR="${NOVEL_AGENT_DATA_DIR:-$HOME/.novel-agent/data}"
ls -la "$DATA_DIR/$NOVEL_ID/target/outlines/" 2>/dev/null || echo "  (no outlines/)"
echo "--- maps.md ---"
cat "$DATA_DIR/$NOVEL_ID/target/maps.md" 2>/dev/null || echo "  (no maps.md)"

echo
echo "=== 启动 writer agent ==="
WSESSION=$(curl -fsS -X POST "$BASE/api/agent/$NOVEL_ID/writer/start" \
  -H 'Content-Type: application/json' \
  -d '{"from":1,"to":10}' | jq -r .id)
echo "writer session: $WSESSION"

echo "=== 触发 writer 自驱 ==="
curl -N -fsS -X POST "$BASE/api/agent/session/$WSESSION/run" \
  -H 'Content-Type: application/json' \
  -d '{}'

echo
echo
echo "=== 正文产物 ==="
ls -la "$DATA_DIR/$NOVEL_ID/target/chapters/" 2>/dev/null || echo "  (no chapters/)"

echo
echo "=== state.md ==="
cat "$DATA_DIR/$NOVEL_ID/target/state.md" 2>/dev/null || echo "  (no state.md)"
