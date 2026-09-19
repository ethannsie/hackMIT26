# GX10 — the demo box

ASUS Ascent GX10 = NVIDIA DGX Spark. GB10, 128 GB unified memory, **ARM64**,
DGX OS (Ubuntu 24.04). Target deployment: the GX10 runs **all models**, the
browser and the simulation. The **ASUS portable monitor** shows the simulation;
the **7-inch touchscreen** is the capture/menu controller. One USB webcam serves
photo capture and hand tracking. Laptops are for editing.

No external depth sensors, IMU, ESP32 or serial bridge are required. The two-view
controller/display workflow and webcam hand adapter still need integration and
hardware verification; the commands below start the existing app only.

## Access

| | |
|---|---|
| hostname | `gx10-f443` (`.local` mDNS does **not** resolve on venue Wi-Fi — use the IP) |
| user | `asus` — factory password is on the Quick Reference Card in the box; change it |
| SSH | `ssh asus@<ip>` — Davide's key is installed; add yours with `ssh-copy-id` |
| IP | `hostname -I` on the box. It changes when the Wi-Fi does |
| Wi-Fi | venue `HackMIT.2026` works for internet **and** for SSH by IP |
| sudo | passwordless for `asus` (hackathon box, not prod) |

## State as of Sat 19 Sep evening

Done, via `gx10/setup.sh` (re-runnable):
- SSH on, `asus` in `dialout`, sleep/suspend masked, screen never blanks.
- Ollama 0.32.15 on `0.0.0.0:11434`, models kept resident (`OLLAMA_KEEP_ALIVE=-1`).
- Chromium (snap) installed, `raw-usb` connected. Firefox was the only browser shipped.
- Legacy `python3-serial` and `python3-websockets` dependencies installed during the earlier sensor plan; unused by the active demo.
- Repo cloned at `~/hackMIT26`.

## Models

| model | role | measured | notes |
|---|---|---|---|
| `qwen3.8` (Qwen 3.5 27B, Q4) | photo → spec (**vision**) | 18 tok/s, ~30 s per photo | preinstalled. Correct + deterministic on the real prompt/schema |
| `nemotron-3.5-lightning` (33B MoE) | optional future explanations | 67 tok/s, **0.9 s** per sentence | preinstalled. Text only, tools, 1M context |
| `qwen3-vl:8b` | faster photo → spec | untested | pull initiated; confirm completion and A/B accuracy and speed before switching |

Both preinstalled models stay loaded together: ~47 GB of 128.

## Extraction wiring

`server/index.ts` tries `EXTRACT_LOCAL_URL` first (Ollama's OpenAI-compatible
`/v1`, same prompt and strict JSON schema as the hosted path), falls back to
OpenAI after `EXTRACT_LOCAL_TIMEOUT_MS` only if a key is configured. For the
agreed all-local demo leave `OPENAI_API_KEY` unset. On the GX10, `.env` is:

```
EXTRACT_LOCAL_URL=http://localhost:11434/v1
EXTRACT_LOCAL_MODEL=qwen3.8
EXTRACT_LOCAL_TIMEOUT_MS=45000
```

The 45 s is deliberate: a 27B model needs ~30 s for the 538-token spec, so a
short timeout means the GX10 never answers and the ASUS story is false. If
`qwen3-vl:8b` proves accurate, switch `EXTRACT_LOCAL_MODEL` and drop the timeout.

Verified end to end from a laptop on Sat 19 Sep: `/api/extract` → `source:
"local"`, `ok: true`, 28 s, no OpenAI key present.

## Display and camera setup

1. Verify the ASUS portable monitor model and ports. Earlier notes call it a
   ZenScreen; the user called it a Zenbook portable monitor. Use the actual label
   when selecting adapters and power connections.
2. Connect it and the 7-inch touchscreen to the GX10 as an **extended desktop**.
   Simultaneous video output and the required adapters are not yet verified.
3. Connect touchscreen power and touch data as required by its actual ports.
   Map touches to the small display; test all corners and rotation.
4. Connect the C270 webcam. Check readable printed text and stable hand tracking
   under table lighting, using a repeatable camera/page position.
5. Once the controller/display views exist, put the menu on the 7-inch screen
   and the simulation on the ASUS monitor. Both must share one problem/session.

The touchscreen flow is **Take a picture -> preview/capture -> local extraction
-> simulation on ASUS -> resume hand interaction**. Use one webcam initially;
pause interaction during capture and reacquire the hand afterward. Camera access,
GPU acceleration, two-display operation and this flow remain hardware tests.

## Run the existing app

```bash
ssh asus@<ip>
cd ~/hackMIT26
# Check out the team's approved demo revision before starting.
npm run dev                           # web :5173, api :8787
```

On the GX10 desktop open Chromium at `http://localhost:5173`. This launches the
current single-view app; it does not yet launch a separate touchscreen menu.
The two-view routes and automatic monitor placement have not been implemented.
Do not start `gx10/serial_bridge.py`; it remains a legacy utility only.

## Demo acceptance

- Touch capture loads each of the four confirmed types: projectile, inclined
  plane, pendulum and 1D collision.
- Simulation appears on ASUS while menu/loading/error state stays on 7-inch.
- All model execution stays on GX10; verify with no OpenAI key, record local
  extraction source, and make required model assets available before the demo.
- Retry, unsupported input, tracking loss and return from capture behave cleanly.
- Both displays, touch alignment and camera access survive a restart.

## Gotchas

- **Venue Wi-Fi blocks device-to-device traffic** for some pairs (`No route to
  host` from a Mac on the same subnet earlier, then it worked from a different
  spot). Running everything on the box sidesteps this; for SSH, the phone
  hotspot always works.
- **ARM64 + Blackwell (`sm_121`)**: anything past Ollama (vLLM, PyTorch) needs
  NVIDIA NGC containers `26.01+`.
- Venue download speed was ~2 MB/s. Pull models early.
- Two `hostname -I` addresses are normal: the second (`172.17.0.1`) is Docker.
