#!/usr/bin/env bash
# Undo gx10/demo.sh: close both browser windows and the three services.
# Ollama stays up on purpose — it is a system service and the models are resident.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$REPO/.demo"

mkdir -p "$RUN"
exec 9>"$RUN/demo.lock"
flock -n 9 || { echo "Demo is starting; retry Stop after startup completes"; exit 1; }
PY="$REPO/.venv/bin/python"; [[ -x "$PY" ]] || PY=python3
for name in hackmit-app hackmit-panel web api panel; do
  f="$RUN/$name.owner.json"
  [[ -f "$f" ]] || continue
  "$PY" "$REPO/gx10/process_owner.py" stop "$f"
done
# Legacy .pid files and manually started services are intentionally not killed:
# a PID alone cannot prove ownership after reboot or PID reuse.
echo "== owned demo processes stopped $(date '+%F %T') ==" | tee -a "$RUN/demo.log"
notify-send -a "HackMIT demo" "Demo stopped" 2>/dev/null || true
