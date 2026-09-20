#!/usr/bin/env bash
# Run ONCE on the GX10, while it still has internet:  bash ~/hackMIT26/gx10/install-demo.sh
# Re-runnable. Afterwards the box needs no network: gx10/demo.sh (the "HackMIT
# Demo" desktop icon) brings up the whole demo against localhost Ollama.
#
# gx10/setup.sh is the OS-level part (ssh, sleep, ollama, chromium, node). This
# is the app-level part: deps, the hand model, the venv, the desktop icons.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

say "node deps"
if [[ -d node_modules ]]; then echo "present"; else npm install --no-audit --no-fund; fi

say "python venv (.venv) with mediapipe + opencv"
# Ubuntu 24.04 refuses `pip install --user` (PEP 668); a venv sidesteps that
# without touching the system python. --system-site-packages keeps apt's
# python3-serial etc. visible for gx10/serial_bridge.py.
[[ -d .venv ]] || python3 -m venv --system-site-packages .venv
if .venv/bin/python -c 'import mediapipe, cv2, numpy' 2>/dev/null; then
  echo "present: $(.venv/bin/python -c 'import mediapipe, cv2; print("mediapipe", mediapipe.__version__, "opencv", cv2.__version__)')"
else
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements.txt
fi

say "hand landmark model"
if [[ -f hand_landmarker.task ]]; then
  echo "present: hand_landmarker.task"
else
  curl -fL --progress-bar -o hand_landmarker.task \
    https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task
fi

say ".env"
if [[ -f .env ]]; then echo "present"; else cp .env.example .env; echo "copied from .env.example (localhost Ollama, no OpenAI key)"; fi
grep -E '^EXTRACT_LOCAL_(URL|MODEL)=' .env

say "window tools (wmctrl pins each browser window to its monitor)"
if command -v wmctrl >/dev/null && command -v v4l2-ctl >/dev/null; then echo "present"; else sudo -n apt-get install -y -qq wmctrl xdotool v4l-utils || echo "!! could not install wmctrl/v4l-utils (offline?) — demo.sh still works; placement and the 30 fps camera pin are best effort"; fi

say "camera"
if ls /dev/video* >/dev/null 2>&1; then ls /dev/video*; else echo "!! no /dev/video* — plug in the C270"; fi

say "desktop icons"
chmod +x gx10/demo.sh gx10/demo-stop.sh panel/launch_panel.sh 2>/dev/null || true
mkdir -p "$HOME/Desktop" "$HOME/.local/share/applications"
write_entry() { # file name comment exec icon
  cat >"$1" <<ENTRY
[Desktop Entry]
Version=1.0
Type=Application
Name=$2
Comment=$3
Exec=$4
Icon=$5
Terminal=false
StartupNotify=false
Categories=Education;Science;
ENTRY
  chmod +x "$1"
  # GNOME's desktop-icons extension only runs a launcher it has been told to trust.
  gio set "$1" metadata::trusted true 2>/dev/null || true
  echo "$1"
}
for dir in "$HOME/Desktop" "$HOME/.local/share/applications"; do
  write_entry "$dir/hackmit-demo.desktop" "HackMIT Demo" \
    "Start the physics demo: sim on the monitor, controls on the touchscreen" \
    "$REPO/gx10/demo.sh" "$REPO/gx10/hackmit-demo.svg"
  write_entry "$dir/hackmit-demo-stop.desktop" "Stop HackMIT Demo" \
    "Close the demo windows and services (Ollama stays up)" \
    "$REPO/gx10/demo-stop.sh" "$REPO/gx10/hackmit-demo-stop.svg"
done
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

cat <<'DONE'

Ready. Double-click "HackMIT Demo" on the desktop, or from a shell:

  gx10/demo.sh          # start everything (re-runnable)
  gx10/demo-stop.sh     # stop everything
  tail -f .demo/*.log   # what each piece is doing

DONE
