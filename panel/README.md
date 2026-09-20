# panel — the 7 in. touchscreen

The WiseCoco 7 in. touchscreen hangs off the GX10 as a **second display**, not a
mirror. The big screen runs the simulation; this panel runs the controls, so
nobody has to reach across the demo to a laptop mid-sentence.

Three things, each one button from the home screen:

| | |
|---|---|
| **Scan image** | live preview, **1** captures or recaptures, **2** saves. The saved photo goes straight to the solver |
| **Hand tracking** | the MediaPipe overlay. Follows the app into sandbox by default, or pin it on at any time |
| **System** | hold 2 s to power the box off |

```bash
panel/setup.sh                    # deps + hand_landmarker.task, re-runnable
python3 panel/panel_server.py     # http://localhost:8770
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

Two links, both optional in both directions:

- **`mode`** — the app POSTs `problem` / `sandbox` whenever it switches. The
  panel uses it for the auto hand overlay.
- **`scan:saved`** — an SSE event carrying the filename. The app fetches the
  JPEG and runs it through the same `ingestImage` path as the file picker:
  compress, `/api/extract`, validate, simulate. Pressing **2** on the panel
  therefore solves a problem on the big screen.
- **`/api/hand/events`** — SSE of `HandFrame`s, already converted into the
  sim's metre frame. `src/hand/remote.ts` implements `HandSource` over it, so
  the sim consumes real tracking through the same contract as the mouse mock
  and falls back to the mouse the moment frames stop.

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
| `POST /api/system/shutdown` | needs `{"confirm": true}` |

The server holds the state and the UI only renders what it is sent, so the
panel and the app can never disagree about whether a capture is pending, and a
reloaded panel comes back mid-scan exactly where it was.

## Config

| env | default | |
|---|---|---|
| `PANEL_PORT` | `8770` | |
| `PANEL_CAMERA_INDEX` | `0` | the USB webcam |
| `PANEL_CAMERA_WIDTH` / `_HEIGHT` | `1280` / `720` | |
| `PANEL_SCENE_WIDTH_M` | `1.6` | metres across the frame — the one number that sets how far a hand moves a body |
| `PANEL_CAPTURE_DIR` | `<repo>/captures` | |
| `PANEL_MODEL` | auto | `hand_landmarker.task`; reuses the repo-root copy if `hand_physics_demo.py` already fetched one |
| `PANEL_SHUTDOWN_CMD` | `sudo systemctl poweroff` | set to `echo dry-run` while testing |
| `PANEL_ALLOW_SHUTDOWN` | `1` | `0` removes the endpoint |

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
