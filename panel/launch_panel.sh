#!/usr/bin/env bash
# Put the panel on the 7 in. touchscreen, leaving the main display alone.
#
# The 7 in. WiseCoco is an extended display, not a mirror, so the browser has
# to be told where to open. Chromium's --window-position is in the X virtual
# screen's coordinate space, which is exactly what xrandr reports as the
# monitor's offset — so we read the offset rather than guessing 1920.
#
#   panel/launch_panel.sh                  auto-pick the smallest monitor
#   PANEL_DISPLAY=HDMI-1 panel/launch_panel.sh    name it explicitly
set -euo pipefail

URL="${PANEL_URL:-http://localhost:8770}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Snap Chromium silently ignores a --user-data-dir under ~/.config (hidden
# top-level dirs are outside its home interface) and joins its default
# profile instead, which lands the window on the wrong screen. Same visible
# location gx10/demo.sh uses.
PROFILE="${PANEL_PROFILE:-$REPO/.demo/profile-panel}"
mkdir -p "$PROFILE"

pick_monitor() {
  # xrandr --listmonitors lines look like:
  #   1: +HDMI-1 1024/154x600/86+1920+0  HDMI-1
  # Emit "name width height x y" for each connected monitor.
  xrandr --listmonitors 2>/dev/null | tail -n +2 | while read -r _ name geom _; do
    if [[ "$geom" =~ ^([0-9]+)/[0-9]+x([0-9]+)/[0-9]+\+([0-9]+)\+([0-9]+)$ ]]; then
      echo "${name#+} ${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]} ${BASH_REMATCH[4]}"
    fi
  done
}

target=""
if [[ -n "${PANEL_DISPLAY:-}" ]]; then
  target="$(pick_monitor | awk -v want="$PANEL_DISPLAY" '$1 == want')"
  [[ -n "$target" ]] || { echo "no monitor named $PANEL_DISPLAY" >&2; exit 1; }
else
  # The touchscreen is the smallest panel attached; sorting by pixel count
  # picks it without hard-coding a resolution the hardware might not have.
  target="$(pick_monitor | awk '{print $2*$3, $0}' | sort -n | head -1 | cut -d' ' -f2-)"
fi

if [[ -z "$target" ]]; then
  echo "xrandr found no monitors (headless or Wayland?). Falling back to windowed." >&2
  read -r name w h x y <<<"panel 1024 600 0 0"
else
  read -r name w h x y <<<"$target"
  echo "panel -> $name  ${w}x${h} at +${x}+${y}"
fi

for candidate in chromium chromium-browser google-chrome; do
  if command -v "$candidate" >/dev/null 2>&1; then BROWSER="$candidate"; break; fi
done
: "${BROWSER:?no chromium found — gx10/setup.sh installs it}"

# --app instead of --kiosk: kiosk mode ignores --window-position and lands on
# the primary display, which is the whole problem we are solving here.
exec "$BROWSER" \
  --app="$URL" \
  --window-position="${x},${y}" \
  --window-size="${w},${h}" \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --user-data-dir="$PROFILE"
