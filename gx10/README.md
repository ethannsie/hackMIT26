# GX10 — the demo box

ASUS Ascent GX10 = NVIDIA DGX Spark. GB10, 128 GB unified memory, **ARM64**,
DGX OS (Ubuntu 24.04, GNOME on Xorg). The whole demo runs on it with **no
network**: Chromium drives both displays, the webcam is on its USB, and Ollama
answers on `localhost`. Laptops are for editing. Plan §9 has the reasoning.

## Run the demo: one icon

Double-click **HackMIT Demo** on the box's desktop. It starts everything that
is not already up and puts the two windows on the right screens:

| | | |
|---|---|---|
| Ollama (systemd) | `:11434` | photo → spec, `qwen3.8` kept resident, pre-warmed on launch |
| `panel/panel_server.py` | `:8770` | owns the webcam: scan + MediaPipe hand tracking |
| `server/index.ts` | `:8787` | `/api/extract` → localhost Ollama, no OpenAI key |
| vite | `:5173` | the physics app |
| Chromium ×2 | | sim full-screen on the big monitor, panel full-screen on the 7 in. touchscreen |

**Stop HackMIT Demo** closes it all (Ollama stays up). From a shell the same
things are `gx10/demo.sh` and `gx10/demo-stop.sh`; logs and pids live in
`.demo/` at the repo root (`tail -f .demo/*.log`). Re-running the start icon is
safe: anything already running is left alone.

Measured Sat 19 Sep 19:14 on the box, hotspot unplugged from the loop: icon →
both windows up in ~2 s; panel scan → spec on the big screen in ~30 s via
`qwen3.8` on the GPU, `source: local`. WebGL2 works in snap Chromium there.

### First-time install (needs internet once)

```bash
ssh asus@<box>
cd ~/hackMIT26 && git pull
bash gx10/setup.sh          # OS level: ssh, no sleep, ollama, chromium, node — already done
bash gx10/install-demo.sh   # app level: npm deps, .venv with mediapipe, hand model, .env, desktop icons
```

`install-demo.sh` is re-runnable and prints what it found. It also installs
`wmctrl`, which `demo.sh` uses to pin each window to its monitor.

### Two displays

`demo.sh` reads `xrandr`: the largest monitor gets the sim, the smallest gets
the panel. With one monitor the sim is full-screen and the panel opens as a
window on top.

### Touchscreen

**The WiseCoco needs its USB cable into the GX10 (or its hub), not a wall
charger**, for touch to exist at all: video is HDMI, touch + power are the USB.
Once plugged in it enumerates as `27c0:0859 wch.cn TouchScreen`
(`hid-multitouch`, plus a mouse-emulation interface) — no extra driver.

By default X stretches its touch surface across the whole 2944×1080 virtual
screen, so a tap on the 7 in. lands on the big monitor. Two fixes are in place:

- **Persistent (GNOME/mutter):** the device is pinned to the 7 in. by its EDID
  identity, applied automatically on login and replug:
  ```bash
  gsettings set org.gnome.desktop.peripherals.touchscreen:/org/gnome/desktop/peripherals/touchscreens/27c0:0859/ output "['TXD', 'Display', '00000000SL0']"
  ```
  (A different 7 in. panel has different EDID strings: `xrandr --props`,
  decode the EDID, use vendor / product name / serial.)
- **At launch:** `demo.sh` runs `xinput map-to-output <id> <smallest monitor>`
  for every touch device it finds.

Check with `xinput list-props <id> | grep Transformation`: identity means
"whole screen"; mapped to HDMI-0 it reads `0.348, 0, 0, 0, 0.556, 0, 0, 0, 1`.

## Access

| | |
|---|---|
| hostname | `gx10-f443` |
| user | `asus` — factory password is on the Quick Reference Card in the box; change it |
| SSH | `ssh asus@<ip>` — Davide's, Ethan's and Tony's keys are installed; add yours with `ssh-copy-id` |
| IP | `hostname -I` on the box. It changes when the network does |
| venue Wi-Fi `HackMIT.2026` | internet and SSH by IPv4; `.local` does **not** resolve there |
| phone hotspot | the Mac only gets an IPv6 route to the box: `ssh -6 asus@gx10-f443.local` (mDNS works here) |
| sudo | passwordless for `asus` (hackathon box, not prod) |

### SSH in (Ethan, Tony, Davide)

Your GitHub SSH keys are already on the box (`ssh-import-id gh:<you>`), so
whatever key you push to GitHub with just works:

```bash
ssh asus@<ip>          # hostname -I on the box; on a phone hotspot: ssh -6 asus@gx10-f443.local
```

If your key isn't accepted, you added a new one to GitHub since Saturday —
re-import it from the box: `ssh-import-id gh:<your-github-username>`.

### Git on the box

**Default: develop on your laptop, push from your laptop, `git pull` on the box.**
The box is the runtime, not your editor. `~/hackMIT26` is a normal clone on `main`:

```bash
cd ~/hackMIT26 && git pull
```

**If you must commit from the box** (you fixed something while testing on the
real screen and don't want to retype it): the Linux user is shared, so tell git
who you are for that shell, then commit on a branch and push:

```bash
export GIT_AUTHOR_NAME="Tony Ly" GIT_AUTHOR_EMAIL="tonyly@berkeley.edu"   # or yours
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
cd ~/hackMIT26
git switch -c my-fix-branch
git add -A && git commit -m "what you did"
git push -u origin my-fix-branch
```

Pushing needs GitHub auth **once per box**. The first person to push runs:

```bash
gh auth login --hostname github.com --git-protocol https --web
```

It prints a one-time code and a URL — open the URL on your laptop, paste the
code, approve. After that `git push` works for everyone on the box (it's one
shared credential; the per-shell `GIT_AUTHOR_*` above is what keeps the commit
attributed to you). Then open the PR from your laptop or with `gh pr create`.

Never commit on `main` on the box: it's what the demo runs from, and a
half-finished change there is a broken demo.

## Models

| model | role | measured | notes |
|---|---|---|---|
| `qwen3.8` (Qwen 3.5 27B, Q4) | photo → spec (**vision**) | 18 tok/s, ~30 s per photo | preinstalled. Correct + deterministic on the real prompt/schema. **The one `.env` uses** |
| `nemotron-3.5-lightning` (33B MoE) | live "why did that happen?" | 67 tok/s, **0.9 s** per sentence | preinstalled. Text only, tools, 1M context |
| `qwen3-vl:8b` | faster photo → spec | pulled, untested | ~3× faster ingest option; A/B on real photos before switching `EXTRACT_LOCAL_MODEL` |

All on disk, so nothing here needs the network. Both preinstalled models stay
loaded together: ~47 GB of 128.

## Extraction wiring

`server/index.ts` tries `EXTRACT_LOCAL_URL` first (Ollama's OpenAI-compatible
`/v1`, same prompt and strict JSON schema as the hosted path), and only falls
back to OpenAI after `EXTRACT_LOCAL_TIMEOUT_MS` — which never happens on the
box because there is no key. `.env` there:

```
EXTRACT_LOCAL_URL=http://localhost:11434/v1
EXTRACT_LOCAL_MODEL=qwen3.8
EXTRACT_LOCAL_TIMEOUT_MS=45000
```

The 45 s is deliberate: a 27B model needs ~30 s for the 538-token spec.
`demo.sh` loads the model on launch (`keep_alive: -1`) so the first photo
does not also pay the load.

## Sensors: serial → WebSocket (legacy, not in the current demo)

The confirmed demo is webcam-only. If an ESP32 ever comes back:

```bash
python3 gx10/serial_bridge.py          # auto-finds /dev/ttyUSB*|ttyACM*, 115200, ws://localhost:8765
```

Snap Chromium cannot open `/dev/ttyUSB0` and Firefox has no WebSerial, so the
bridge forwards NDJSON lines to `new WebSocket('ws://localhost:8765')`.

## Gotchas

- **Snap Chromium cannot write under `~/.config`** (hidden top-level dirs are
  outside its `home` interface). A `--user-data-dir` there is silently
  replaced by the default profile, the second launch joins the first process,
  and the panel lands on the wrong screen. `demo.sh` keeps its two profiles in
  `.demo/profile-*` inside the repo instead. `panel/launch_panel.sh` still
  uses `~/.config/hackmit-panel` and so does not work on the box on its own.
- **`--kiosk` ignores `--window-position`** and lands on the primary display.
  `--app` + `wmctrl` is what actually places a window.
- **Ubuntu 24.04 refuses `pip install --user`** (PEP 668). The panel's Python
  deps live in `.venv/` (`--system-site-packages`); `demo.sh` uses that
  interpreter when present. MediaPipe 1.0.1 runs fine on this ARM64 Linux —
  the 1.0.x crash is Mac-only.
- **Venue Wi-Fi blocks device-to-device traffic** for some pairs. Running
  everything on the box sidesteps this; for SSH, the phone hotspot always
  works (over IPv6, see Access).
- **ARM64 + Blackwell (`sm_121`)**: anything past Ollama (vLLM, PyTorch) needs
  NVIDIA NGC containers `26.01+`.
- Two `hostname -I` addresses are normal: the second (`172.17.0.1`) is Docker.
