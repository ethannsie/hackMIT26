# GX10 — the demo box

ASUS Ascent GX10 = NVIDIA DGX Spark. GB10, 128 GB unified memory, **ARM64**,
DGX OS (Ubuntu 24.04). The whole demo runs on it: Chromium drives the 7 in.
touchscreen, the webcam and the ESP32 are on its USB, and Ollama answers on
`localhost`. Laptops are for editing. Plan §9 has the reasoning.

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
- `python3-serial`, `python3-websockets` for the serial bridge.
- Repo cloned at `~/hackMIT26`.

## Models

| model | role | measured | notes |
|---|---|---|---|
| `qwen3.8` (Qwen 3.5 27B, Q4) | photo → spec (**vision**) | 18 tok/s, ~30 s per photo | preinstalled. Correct + deterministic on the real prompt/schema |
| `nemotron-3.5-lightning` (33B MoE) | live "why did that happen?" | 67 tok/s, **0.9 s** per sentence | preinstalled. Text only, tools, 1M context |
| `qwen3-vl:8b` | faster photo → spec | untested | pulled Sat evening as the ~3× faster ingest option; A/B it |

Both preinstalled models stay loaded together: ~47 GB of 128.

## Extraction wiring

`server/index.ts` tries `EXTRACT_LOCAL_URL` first (Ollama's OpenAI-compatible
`/v1`, same prompt and strict JSON schema as the hosted path), falls back to
OpenAI after `EXTRACT_LOCAL_TIMEOUT_MS`. On the GX10, `.env` is:

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

## Sensors: serial → WebSocket, not WebSerial

Snap Chromium cannot open `/dev/ttyUSB0` (its `serial-port` interface has
nothing to connect to) and Firefox has no WebSerial. So:

```bash
python3 gx10/serial_bridge.py          # auto-finds /dev/ttyUSB*|ttyACM*, 115200, ws://localhost:8765
```

Forwards each NDJSON line from the ESP32 to every browser client verbatim,
reconnects if the ESP32 resets. Browser side is
`new WebSocket('ws://localhost:8765')`. Tested on the box (without an ESP32 —
it waits politely).

## Run the demo

```bash
ssh asus@<ip>
cd ~/hackMIT26 && git pull
python3 gx10/serial_bridge.py &        # once the ESP32 exists
npm run dev                            # web :5173, api :8787
chromium --kiosk http://localhost:5173 # on the 7in screen
```

## Gotchas

- **Venue Wi-Fi blocks device-to-device traffic** for some pairs (`No route to
  host` from a Mac on the same subnet earlier, then it worked from a different
  spot). Running everything on the box sidesteps this; for SSH, the phone
  hotspot always works.
- **ARM64 + Blackwell (`sm_121`)**: anything past Ollama (vLLM, PyTorch) needs
  NVIDIA NGC containers `26.01+`.
- Venue download speed was ~2 MB/s. Pull models early.
- Two `hostname -I` addresses are normal: the second (`172.17.0.1`) is Docker.
