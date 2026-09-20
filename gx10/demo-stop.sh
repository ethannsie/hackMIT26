#!/usr/bin/env bash
# Undo gx10/demo.sh: close both browser windows, the three services and the BLE light bridge.
# Ollama stays up on purpose — it is a system service and the models are resident.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$REPO/.demo"

stopped=0
for name in hackmit-app hackmit-panel web api panel ble-light; do
  f="$RUN/$name.pid"
  [[ -f "$f" ]] || continue
  pid=$(cat "$f")
  # demo.sh started each one with setsid, so pid == process group.
  if kill -- "-$pid" 2>/dev/null; then echo "stopped $name ($pid)"; stopped=$((stopped + 1)); fi
  rm -f "$f"
done

# Anything started by hand that holds the same ports or profiles.
pkill -f -- "--user-data-dir=$RUN/profile-hackmit-" 2>/dev/null && echo "closed stray browser windows"
pkill -f "panel/panel_server.py" 2>/dev/null && echo "stopped stray panel"
pkill -f "gx10/ble_light.py" 2>/dev/null && echo "stopped stray ble light"
pkill -f "server/index.ts" 2>/dev/null && echo "stopped stray api"
pkill -f "vite --port 5173" 2>/dev/null && echo "stopped stray web"

echo "== demo stopped $(date '+%F %T') ($stopped tracked) ==" | tee -a "$RUN/demo.log"
notify-send -a "HackMIT demo" "Demo stopped" 2>/dev/null || true
