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
window on top. If a USB touchscreen is present it is mapped to the small
monitor (`xinput map-to-output`) so touches land where the panel is. **The
WiseCoco needs its USB cable, not just HDMI**, for touch to exist at all.

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
