#!/usr/bin/env bash
# Prepare the control panel on the GX10. Re-runnable.
#
# Installs what panel/ needs and fetches the MediaPipe hand model. It does not
# touch the main app's npm setup or gx10/setup.sh — run those separately.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$HERE")"
MODEL="$HERE/models/hand_landmarker.task"
MODEL_URL="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

say "Python dependencies"
# ARM64 note: mediapipe ships aarch64 manylinux wheels, but if pip falls back
# to a source build on this box, install python3-opencv from apt and run the
# panel without tracking — scan and shutdown do not need MediaPipe.
python3 -m pip install --user --upgrade -r "$REPO/requirements.txt"

say "Hand landmark model"
if [[ -f "$MODEL" ]]; then
  echo "already present: $MODEL"
elif [[ -f "$REPO/hand_landmarker.task" ]]; then
  # hand_physics_demo.py keeps its copy at the repo root. Reuse it.
  echo "reusing the repo-root copy"
  ln -sf "$REPO/hand_landmarker.task" "$MODEL"
else
  mkdir -p "$HERE/models"
  curl -fL --progress-bar -o "$MODEL" "$MODEL_URL"
  echo "downloaded to $MODEL"
fi

say "Capture directory"
mkdir -p "$REPO/captures"
echo "$REPO/captures"

say "Check"
python3 - <<'PY'
import importlib.util as u
for mod in ("cv2", "mediapipe", "numpy"):
    print(f"  {mod:12s} {'ok' if u.find_spec(mod) else 'MISSING'}")
PY

cat <<'EOF'

Ready. Start it with:

  python3 panel/panel_server.py          # http://localhost:8770
  panel/launch_panel.sh                  # Chromium kiosk on the 7in screen

EOF
