# HackMIT hand-physics prototype

A webcam-first prototype for the planned physics interaction:

- index fingertip is the precise cursor;
- thumb + index pinch grabs a ball;
- an open palm acts as a larger, soft collider that pushes the ball;
- a hand-colored virtual avatar with a palm, rounded fingers, and wrist follows the tracked hand;
- landmarks are smoothed and the gesture needs three frames to change state.

## Run it

Use Python 3.10 or newer, then install the packages, download the official
MediaPipe hand model once, and run the demo:

```powershell
python -m pip install -r requirements.txt
Invoke-WebRequest -Uri "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task" -OutFile "hand_landmarker.task"
python hand_physics_demo.py
```

Run all three commands from this project folder. The model is kept next to the
Python file; it is required by the current MediaPipe Tasks API.

To drive the browser physics engine with the webcam demo, start the web app,
open `http://localhost:5173/`, and then run the Python command in a
second terminal. The Python process publishes the latest hand pose to the local
API and stays headless, so the browser is the single visible physics screen.
Pinch grabs and throws movable bodies, while an open palm pushes them in both
problem and sandbox modes. Add `--preview` to the Python command if you also
want the old OpenCV camera window. Without `?hand=python`, the browser keeps
its mouse interaction. Add `?hand=mouse` to the URL to explicitly use the
mouse source instead.

With `--preview`, press `R` to reset and `Q` or `Esc` to exit. Without the
preview, stop the Python process with `Ctrl+C` in its terminal.

## If grabbing releases during a fast motion

The demo deliberately keeps a grab active through a 0.22-second hand-tracker
dropout and requires six consecutive open-pinch frames to release. Adjust the
constants near the top of `hand_physics_demo.py`:

- raise `TRACKING_GRACE_SECONDS` to tolerate longer tracking dropouts;
- raise `PINCH_RELEASE_RATIO` to require a wider thumb-index gap before release;
- raise `RELEASE_CONFIRM_FRAMES` to make release take longer.

Those changes make grabbing more forgiving, but too large a value makes an
intentional release feel delayed.

## Why these hand points

The index fingertip is an explicit, precise control point. The palm center is
the median of wrist plus the four knuckle landmarks, not an average of all
landmarks, so bending fingers does not shift the palm collider. A three-frame
gesture debounce prevents a one-frame tracker wobble from grabbing/releasing.

## Add the VL53L7CX next

`depth_at_cursor_mm()` is intentionally a small empty adapter. After mounting
the camera and ToF sensor together, calibrate camera pixels to the sensor's
8x8 cells and return the measured depth for the cursor cell. Gate true contact
or a virtual wall by that depth; do not rely on MediaPipe's relative z value.
