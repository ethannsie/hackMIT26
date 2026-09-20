#!/usr/bin/env bash
# One click runs the whole demo on the GX10, with no network at all.
#
#   ollama (systemd)         :11434   photo → spec. Models are on disk, kept resident
#   panel/panel_server.py    :8770    owns the webcam: scan + hand tracking
#   server/index.ts          :8787    /api/extract → localhost Ollama
#   vite                     :5173    the physics app
#   chromium ×2                       app on the big monitor, panel on the 7 in. touchscreen
#
# Re-runnable: anything already up is left alone, anything missing is started.
# Logs and pids go to .demo/ at the repo root; gx10/demo-stop.sh undoes it all.
# gx10/install-demo.sh puts this on the desktop as "HackMIT Demo".
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$REPO/.demo"
mkdir -p "$RUN"
cd "$REPO"

# The desktop icon gives us no terminal, so everything goes to a log as well.
exec > >(tee -a "$RUN/demo.log") 2>&1
echo "== demo start $(date '+%F %T') =="

# A double-click on the icon must not start two of everything.
exec 9>"$RUN/demo.lock"
flock -n 9 || { echo "already starting"; exit 0; }

export DISPLAY="${DISPLAY:-:1}"

notify() { notify-send -a "HackMIT demo" "$@" 2>/dev/null || true; }
fail() {
  echo "!! $*"
  notify -u critical "Demo failed" "$*"
  zenity --error --title="HackMIT demo" --text="$*\n\nLog: $RUN/demo.log" 2>/dev/null || true
  exit 1
}
listening() { curl -s -m 2 -o /dev/null "http://localhost:$1$2"; }
wait_for() { # port path seconds
  local i
  for ((i = 0; i < $3; i++)); do listening "$1" "$2" && return 0; sleep 1; done
  return 1
}
# Own session + process group per service, so demo-stop.sh can kill the tree.
start() { # name cmd...
  local name=$1; shift
  # 9>&- : do not hand the lock fd to the service, or the lock is held for as
  # long as the service lives and the next click reports "already starting".
  setsid "$@" >"$RUN/$name.log" 2>&1 </dev/null 9>&- &
  echo $! >"$RUN/$name.pid"
  echo "   $name: started (pid $!, log .demo/$name.log)"
}

# ---- config ---------------------------------------------------------------
[[ -f .env ]] || cp .env.example .env
MODEL=$(sed -n 's/^EXTRACT_LOCAL_MODEL=//p' .env | head -1)
MODEL=${MODEL:-qwen3.8}
PY="$REPO/.venv/bin/python"; [[ -x "$PY" ]] || PY=python3
[[ -d node_modules ]] || fail "node_modules missing — run gx10/install-demo.sh once while online"

# ---- ollama ---------------------------------------------------------------
echo "-- ollama"
if listening 11434 /api/tags; then
  echo "   already up"
else
  sudo -n systemctl start ollama 2>/dev/null || true
  wait_for 11434 /api/tags 30 || fail "Ollama is not answering on :11434"
  echo "   started"
fi
# Load the extraction model now so the first photo does not pay the ~30 s load.
# Empty prompt = load only. keep_alive -1 = stay resident.
curl -s -m 900 localhost:11434/api/generate -d "{\"model\":\"$MODEL\",\"keep_alive\":-1}" >/dev/null 2>&1 9>&- &
echo "   warming $MODEL in the background"

# ---- mqtt broker (ring light) ---------------------------------------------
echo "-- mosquitto"
if systemctl is-active --quiet mosquitto; then
  echo "   already up"
else
  sudo -n systemctl start mosquitto 2>/dev/null && echo "   started" \
    || echo "   not installed — ring light off (gx10/setup.sh installs it)"
fi

# ---- services -------------------------------------------------------------
echo "-- panel (webcam)"
if listening 8770 /api/state; then echo "   already up"; else start panel "$PY" panel/panel_server.py; fi

echo "-- api"
if listening 8787 /api/health; then echo "   already up"; else start api npx tsx server/index.ts; fi

echo "-- web"
if listening 5173 /; then echo "   already up"; else start web npx vite --port 5173 --strictPort --host localhost; fi

wait_for 8770 /api/state 30 || fail "panel did not come up on :8770 — see .demo/panel.log"
wait_for 8787 /api/health 45 || fail "API did not come up on :8787 — see .demo/api.log"
wait_for 5173 / 90 || fail "web app did not come up on :5173 — see .demo/web.log"
echo "   all three answering"

# ---- displays -------------------------------------------------------------
# xrandr --listmonitors:  "0: +*USB-C-2 1920/344x1080/194+1024+0  USB-C-2"
# → "name w h x y", one per connected monitor. The 7 in. is the smallest.
monitors() {
  xrandr --listmonitors 2>/dev/null | tail -n +2 | while read -r _ name geom _; do
    if [[ "$geom" =~ ^([0-9]+)/[0-9]+x([0-9]+)/[0-9]+\+([0-9]+)\+([0-9]+)$ ]]; then
      name=${name#+}; name=${name#\*}
      echo "$name ${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]} ${BASH_REMATCH[4]}"
    fi
  done
}
sorted=$(monitors | awk '{print $2*$3, $0}' | sort -n | cut -d' ' -f2-)
count=$(printf '%s\n' "$sorted" | grep -c . || true)
if (( count == 0 )); then
  echo "!! xrandr found no monitors — opening plain windows"
  big="none 1920 1080 0 0"; small="none 1024 600 0 0"
else
  big=$(printf '%s\n' "$sorted" | tail -1)
  small=$(printf '%s\n' "$sorted" | head -1)
fi
read -r big_name big_w big_h big_x big_y <<<"$big"
read -r small_name small_w small_h small_x small_y <<<"$small"
echo "-- displays: $count found"
echo "   app   → $big_name ${big_w}x${big_h} at +${big_x}+${big_y}"
echo "   panel → $small_name ${small_w}x${small_h} at +${small_x}+${small_y}"

# A USB touchscreen lands stretched across the whole X screen unless it is
# mapped to the output it physically is. The WiseCoco's controller (wch.cn
# 27c0:0859) shows up twice — a multitouch interface and a mouse-emulation
# one — so match by name as well as by MT axes and map both. GNOME also holds
# a persistent mapping for it (gx10/README.md, "Touchscreen"); this is the
# belt to that brace, for a hub plugged in after login.
if (( count >= 2 )); then
  for id in $(xinput list --id-only 2>/dev/null); do
    name=$(xinput list --name-only "$id" 2>/dev/null)
    if [[ "$name" == *[Tt]ouch* ]] || xinput list "$id" 2>/dev/null | grep -q "Abs MT Position X"; then
      xinput map-to-output "$id" "$small_name" 2>/dev/null \
        && echo "   touch: $name (id $id) → $small_name"
    fi
  done
fi

# ---- browser --------------------------------------------------------------
BROWSER=""
for c in chromium chromium-browser google-chrome; do
  command -v "$c" >/dev/null 2>&1 && { BROWSER=$c; break; }
done
[[ -n "$BROWSER" ]] || fail "no chromium — gx10/setup.sh installs it"

open_window() { # profile url x y w h fullscreen(0|1) extra-flags...
  local profile=$1 url=$2 x=$3 y=$4 w=$5 h=$6 fs=$7; shift 7
  # Snap chromium cannot write under ~/.config (hidden top-level dirs are
  # outside its home interface) and silently falls back to its default
  # profile — then the second launch joins the first process and lands on the
  # wrong screen. Anything under a visible dir in $HOME is fine.
  local dir="$RUN/profile-$profile"
  if pgrep -f -- "--user-data-dir=$dir" >/dev/null; then
    echo "   $profile: window already open"; return
  fi
  # --app, not --kiosk: kiosk ignores --window-position and lands on the
  # primary display, which is the whole problem on a two-display box.
  local args=(
    --app="$url" --window-position="$x,$y" --window-size="$w,$h"
    --user-data-dir="$dir"
    --no-first-run --password-store=basic --noerrdialogs --disable-infobars
    --disable-session-crashed-bubble --disable-features=TranslateUI
    "$@"
  )
  (( fs )) && args+=(--start-fullscreen)
  start "$profile" "$BROWSER" "${args[@]}"
}

# Chromium does not always honour the position/fullscreen flags on X11, so once
# the window exists, tell the window manager directly. No-op without wmctrl.
place_window() { # title x y w h fullscreen(0|1)
  command -v wmctrl >/dev/null 2>&1 || return 0
  local title=$1 x=$2 y=$3 w=$4 h=$5 fs=$6 i
  for ((i = 0; i < 20; i++)); do
    wmctrl -l | grep -q -- " $title\$" && break
    sleep 0.5
  done
  wmctrl -l | grep -q -- " $title\$" || { echo "   $title: window not found, left as is"; return 0; }
  wmctrl -r "$title" -b remove,fullscreen,maximized_vert,maximized_horz
  wmctrl -r "$title" -e "0,$x,$y,$w,$h"
  (( fs )) && wmctrl -r "$title" -b add,fullscreen
  echo "   $title: placed at +$x+$y ($( (( fs )) && echo fullscreen || echo "${w}x${h}" ))"
}

echo "-- browser ($BROWSER)"
# Two monitors: both full-screen. One monitor: sim full-screen, panel a window
# on top so the scan button is still reachable.
if (( count >= 2 )); then panel_fs=1; else panel_fs=0; fi
open_window hackmit-app   "http://localhost:5173" "$big_x" "$big_y" "$big_w" "$big_h" 1 \
  --remote-debugging-port=9222
# DevTools ports (localhost only): 9222 = sim, 9223 = panel. Both windows can
# be inspected over ssh — `curl localhost:9223/json` — without a keyboard.
open_window hackmit-panel "http://localhost:8770" "$small_x" "$small_y" "$small_w" "$small_h" "$panel_fs" \
  --disable-pinch --overscroll-history-navigation=0 --touch-events=enabled \
  --remote-debugging-port=9223
place_window "IRL Physics Sim" "$big_x" "$big_y" "$big_w" "$big_h" 1
place_window "Physics Panel" "$small_x" "$small_y" "$small_w" "$small_h" "$panel_fs"

echo "== demo up $(date '+%T') — model $MODEL, logs in .demo/ =="
notify "Demo running" "Sim on $big_name, panel on $small_name. Model: $MODEL."
