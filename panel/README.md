# panel — the 7 in. touchscreen

The WiseCoco 7 in. touchscreen hangs off the GX10 as a **second display**, not a
mirror. The big screen runs the simulation; this panel runs the controls, so
nobody has to reach across the demo to a laptop mid-sentence.

Three things, each one button from the home screen:

| | |
|---|---|
| **Scan image** | live preview, **1** captures or recaptures, **2** saves. The saved photo goes straight to the solver |
| **Hand tracking** | the MediaPipe overlay. Follows the app into sandbox by default, or pin it on at any time |
| **Graphs** | the app's position / velocity / acceleration plots for the tracked body, with a thumb-sized scrubber and play/pause. Dragging pauses the sim on the big screen and scrubs it; ▶ resumes from there |
| **System** | hold 2 s to power the box off |

```bash
panel/setup.sh                    # deps + hand_landmarker.task, re-runnable
.venv/bin/python panel/panel_server.py     # http://localhost:8770

Home tiles that act on the big screen rather than here: **New problem**
(`POST /api/app/generate` → SSE `app:generate` → the app asks the GX10 for a
fresh problem) and **Ask a question**, which opens the panel's Ask view: its
button or the keypad's `1` posts `POST /api/app/ask {action: start|stop}` →
SSE `app:ask` → the app records from the webcam mic, transcribes, answers on
the monitor, and mirrors every phase back with `POST /api/ask/state` → SSE
`ask`, which the view renders (LISTENING with a countdown, working, thinking,
answered). The panel only relays; see the project README, "Generate and Ask".
panel/launch_panel.sh             # Chromium on the 7in screen, not the big one
```

`panel/test_panel.py` exercises the whole service with no camera and no
MediaPipe attached, and never actually powers anything off.

## Why it is a separate service

**One process can open the webcam.** V4L2 gives `/dev/video0` to a single
opener. MediaPipe is a Python library, and the browser's `getUserMedia` would
take the device away from it, so the camera cannot be shared by negotiating —
it has to be *owned*. This service owns it, and everything else reads it over
localhost HTTP: MJPEG for the two previews, JSON for the landmarks, a JPEG for
a capture.

That ownership is also what makes the panel useful to the main app rather than
a parallel universe. The main app has no camera code of its own and does not
grow any.

The stack is Python's stdlib `ThreadingHTTPServer` plus the OpenCV/MediaPipe
that hand tracking needs anyway. No web framework: the GX10 is ARM64 and every
extra wheel is a thing that can fail to build the night before a demo.
`multipart/x-mixed-replace` and server-sent events are both a dozen lines.

## How the pieces talk

```
        ┌───────────── GX10 ──────────────┐
        │                                 │
  7in   │   panel_server.py :8770 ────────┼──► /dev/video0   (sole owner)
 screen ├──►  scan · hand · shutdown      │
        │        │        ▲               │
        │  scan:saved   mode              │
        │        ▼        │               │
  big   │   vite :5173 ───┘               │
 screen ├──►  physics app                 │
        │        └──► :8787 ──► Ollama    │
        └─────────────────────────────────┘
```

Three links, all optional in both directions:

- **`mode`** — the app POSTs `problem` / `sandbox` whenever it switches. The
  panel uses it for the auto hand overlay.
- **`scan:saved`** — an SSE event carrying the filename. The app fetches the
  JPEG and runs it through the same `ingestImage` path as the file picker:
  compress, `/api/extract`, validate, simulate. Pressing **2** on the panel
  therefore solves a problem on the big screen.
- **`sim` / `sim:control`** — while the panel shows Graphs, the app streams
  the tracked body's motion samples and transport state a few times a second;
  the panel's slider and play button go back as commands. The app applies
  them through the same code as its own controls, so the two screens can
  never disagree about time.
- **`/api/hand/events`** — SSE of `HandFrame`s: `palm_n`/`landmarks_n` as
  fractions of the camera frame plus the legacy metre fields.
  `src/hand/remote.ts` implements `HandSource` over it and maps the fractions
  onto the sim canvas, so the whole camera frame is the whole visible sim at
  whatever zoom the view has (`?handspan=0.8` on the app URL reaches the
  edges with less arm travel). Falls back to the mouse the moment frames stop.

If this service is not running, the main app is exactly what it was: file
picker, mouse-driven hand. Nothing in it waits on the panel.

## The hand overlay switch

The ask was "show hand tracking when in sandbox mode", then "let me see it
whenever". Those are the same control with three positions, not two features:

| | |
|---|---|
| **Auto** (default) | on in sandbox, off in problem mode |
| **Always on** | on regardless of what the app is doing |
| **Off** | off even in sandbox |

Detection only runs when something is actually watching — the hand view is
open, or the app is in sandbox consuming frames. The capture loop always runs;
the landmarker is what gets switched, because a 27B vision model and a hand
tracker on the same box is the combination that drops frames.

## Gestures

Two, and an open hand is neither:

| | | |
|---|---|---|
| **pinch** | thumb tip to index tip | grabs the nearest body, carries it, throws it on release |
| **fist** | four fingers curled | pushes: bodies bounce off the fist, and a *moving* fist adds a force along its travel. A fist held still does nothing. The big screen draws the fist as a solid hand with a dashed **hitbox** circle (the exact reach the coupling uses) and an arrow for the shove it is about to give |

Earlier, any hand that looked close to the camera counted as "through the
plane" and pushed on every movement. Now only a fist pushes, and only while
it moves, so waving a hand across the scene disturbs nothing. Landmarks are
One Euro filtered before any of this is computed, so a stationary hand reads
as stationary.

## The ring light

The white ring on the ESP32 lights the page while the panel is in the scan
view and goes dark the moment it leaves. `PanelState.sync_light()` runs on
every broadcast and publishes a retained MQTT message through `light.py`; the
firmware in `hackmit_camera_light/` mirrors it. No broker, no ring: the panel
logs one line and carries on.

## Endpoints

| | |
|---|---|
| `GET /` | the panel UI |
| `GET /api/state` · `GET /api/events` | state snapshot · SSE stream |
| `GET /stream/raw.mjpg` · `/stream/hand.mjpg` | previews, plain and with the skeleton |
| `POST /api/scan/start` · `/capture` · `/save` · `/cancel` | the scan flow |
| `GET /api/scan/pending.jpg` · `/latest.jpg` | the frozen frame · the last save |
| `POST /api/mode` · `/api/hand/switch` · `/api/view` | `{mode}` · `{switch}` · `{view}` |
| `GET /api/hand/events` · `/api/hand/latest` | landmarks in sim coordinates |
| `POST /api/sim/snapshot` · SSE `sim` | app → panel, ~4 Hz while the Graphs view is open: `{t_s, running, frames, index, scrubbing, label, samples[]}` |
| `POST /api/sim/control` · SSE `sim:control` | panel → app: `{action: play\|pause\|seek, index?}` — applied exactly like the app's own play button and slider |
| `POST /api/system/shutdown` | needs `{"confirm": true}` |

The server holds the state and the UI only renders what it is sent, so the
panel and the app can never disagree about whether a capture is pending, and a
reloaded panel comes back mid-scan exactly where it was.

## Config

| env | default | |
|---|---|---|
| `PANEL_PORT` | `8770` | |
| `PANEL_BIND` | `127.0.0.1` | loopback only. Requests also require a trusted Host/Origin; shutdown requires the session token from `/api/session`. Keep this service local. |
| `PANEL_CAMERA_INDEX` | `0` | the USB webcam |
| `PANEL_CAMERA_WIDTH` / `_HEIGHT` | `1280` / `720` | |
| `PANEL_CAMERA_FOURCC` / `_FPS` | `MJPG` / `30` | OpenCV's default raw YUYV caps a USB 2 webcam at ~10 fps at 720p; MJPEG runs at the C270's full 30 |
| `PANEL_CAMERA_DYNAMIC_FPS` | `0` | `1` lets the C270's auto-exposure halve the rate in dim light (it does, to 15). Needs `v4l2-ctl` (`v4l-utils`) |
| `PANEL_SCENE_WIDTH_M` | `1.6` | metres across the frame in the legacy `palm_m` fields. The app now uses `palm_n` (fractions of the frame) mapped onto its own canvas, so this only matters to older consumers |
| `PANEL_PINCH_CLOSED` / `_OPEN` | `0.2` / `0.8` | thumb-tip to index-tip gap as a fraction of palm width at fully pinched / fully open. The hand view shows the live `gap` to tune against; a grab is 70 % of the way from open to closed |
| `PANEL_FIST_OPEN` / `_CLOSED` | `1.35` / `0.85` | fingertip-to-wrist over knuckle-to-wrist that counts as extended / curled (open hand ~1.8, relaxed ~1.2, fist ~0.6). Median of four fingers is `fist`; ≥ 0.7 is the push gesture and suppresses pinch. The hand view shows it live |
| `PANEL_SMOOTH`, `_MIN_CUTOFF`, `_BETA` | `1`, `1.0`, `0.01` | One Euro filter on every landmark: a resting hand stops trembling (`MIN_CUTOFF` Hz), a moving one is not delayed (`BETA` × px/s). `0` disables |
| `PANEL_CAPTURE_DIR` | `<repo>/captures` | |
| `PANEL_MODEL` | auto | `hand_landmarker.task`; reuses the repo-root copy if `hand_physics_demo.py` already fetched one |
| `PANEL_SHUTDOWN_CMD` | `sudo systemctl poweroff` | set to `echo dry-run` while testing |
| `PANEL_ALLOW_SHUTDOWN` | `1` | `0` removes the endpoint |
| `PANEL_LIGHT` | `1` | `0` stops driving the camera ring light |
| `PANEL_LIGHT_MQTT` | `localhost:1883` | broker the ESP32 ring light listens to |
| `PANEL_LIGHT_TOPIC` | `hackmit/scanlight` | retained `on`/`off`, see [`hackmit_camera_light/`](../hackmit_camera_light/README.md) |

## Notes

- **Depth is estimated, not measured.** `palm_m.z` comes from apparent hand
  size against an assumed 90 mm knuckle span. `depth_at_palm_mm()` in
  `camera.py` is the hook for the VL53L7CX; until it returns real millimetres,
  treat z as a hint. Same honest gap as `hand_physics_demo.py`.
- **Shutdown needs a 2 s hold**, not a tap. A confirm dialog is one stray touch
  away from powering off the machine mid-demo; a sleeve cannot complete a hold,
  and letting go cancels it.
- **The overlay is a skeleton, not the avatar** from `hand_physics_demo.py`.
  This screen's job is to tell you at a glance whether tracking is healthy, and
  a skeleton shows a bad landmark where a smooth avatar hides it.
- **Captures are written at quality 95.** They are input to a model reading
  printed text; `src/extract/compress.ts` does the downscaling later.
- **`launch_panel.sh` uses `--app`, not `--kiosk`.** Kiosk mode ignores
  `--window-position` and lands on the primary display, which is the entire
  problem. The script reads the monitor offset from `xrandr` and picks the
  smallest attached panel, so it does not hard-code a resolution.
- **MediaPipe is optional.** If its wheel will not install on ARM64, scan and
  shutdown still work and the hand view says why it cannot run.


The raw scan stream and saved JPEGs retain the camera's text orientation. Only
the hand preview is mirrored. Stale frames expire after one second; stale hands
after 300 ms. Camera/tracker failures clear the pose and retry automatically.
Shutdown requests from custom clients must send `X-Panel-Token` from the trusted
`GET /api/session` response, as well as `{"confirm": true}`. The kiosk UI handles
this automatically. Additional local frontend origins can be configured through
`PANEL_ORIGINS` (comma-separated exact origins).
