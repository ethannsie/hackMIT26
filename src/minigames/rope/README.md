# Hand-cut rope minigame

One playable physics playground of a planned five-level game. Move a real
rigid-body candy with a thumb–index pinch, swing it on a rope, cut, throw, and
bounce off a ramp, rubber bumper, floor, ceiling and side walls. Original canvas
artwork, three collectible stars, a hungry creature, win/loss feedback and
restart. Levels 2–5 remain visibly locked placeholders.

## Play from the touchscreen

Run the usual app on `http://localhost:5173/` and the panel service on
`http://localhost:8770/`. Select **Cut the Rope** on the panel home screen.
The main display opens the game; the panel shows score, tracking status, Restart
and Exit. Exiting resumes the previous physics scene at its preserved time.
The panel server needs restarting after installing this branch; Vite serves the
game with the existing build/launcher. No new packages, model or camera process.

The camera frame maps to the game canvas. The complete translucent 21-joint hand
is drawn in the same coordinates as interaction. **Pinch the candy between
thumb and index to pick it up. Move to swing it, then open those fingers to
release.** The target is the midpoint between the two fingertips. The candy is
pulled by a damped spring force, rather than teleported; release preserves its
actual velocity. A cyan tether and candy ring show when you are holding it.
An intact rope limits how far it can move.

**All buttons are on the touchscreen:** Cut rope, Restart level, Exit game.
The big display is presentation-only: no mouse drag handlers, game shortcuts,
restart buttons, or clickable result controls. After a win, use Restart on the
small screen. A continuous open-hand swipe can also cut a rope; closing or
opening a pinch cannot accidentally create a cutting stroke.

Pinch detection uses the thumb–index gap divided by palm width: acquire below
0.35, release above 0.60. This hysteresis keeps a grip stable. It reads the
landmarks directly, so the shared tracker's whole-hand fist score cannot disable
a pinch. Tracking loss or a large pose jump releases without injecting a
camera-derived impulse; reacquisition cannot create a phantom cutting stroke.
You can pick the candy up again after a missed throw. The goal only accepts a
released candy, so moving it over the creature while holding does not win.

The panel owns the webcam and enables tracking during the game, then restores
the existing Auto/On/Off behavior on exit. Speed is shown in m/s; gravity is
9.81 m/s² at 85 game pixels per metre. Friction produces spin on contact; the
rubber bumper has a higher restitution than the other surfaces.

The existing `handspan` query parameter works here too. Start at its default
1.0; `?handspan=0.8` maps the middle 80% of the camera onto the playfield.

For the two-display demo, keep **one main app window** and one panel window
open: several copies compete for the shared menu and the browser's per-origin
streaming-connection budget. Select the game from the menu; do not use the old
`hand=mouse` preview URL. The game now always uses the camera.

## Ownership and merge boundaries

Keep subsequent game work in this folder and `panel/rope_game.py`,
`panel/ui/rope.{js,css}`, `panel/test_rope_game.py`, `scripts/verify-rope.ts`.
There are just four small shared-file integration points:

- `src/main.ts`: import, controller construction, skip the host loop while active.
- `panel/panel_server.py`: recognize the game view, enable tracking, delegate routes.
- `panel/ui/index.html`: menu tile and controller markup/assets.
- `panel/ui/panel.js`: register the additional view.

No changes to the solver, sandbox, shared physics engine, camera tracker, hand-source
contract, dependency lockfile, or GX10 launcher. Game styling is inside a Shadow
DOM; the hidden app is inert while playing. The hand input adapter reads the
existing `RemoteHandSource`, with its coordinate mapping set to game pixels.
The engine wraps a private Matter.js world (already a project dependency) with
240 Hz collision steps, unilateral rope tension, physically computed disk
inertia, and a capped force for hand dragging. The fastest allowed throw moves
less than 8 pixels per collision step. All collision surfaces come from level
data and are drawn using their exact dimensions.

Add future layouts in `levels.ts` and level selection in `game.ts` and the
dedicated panel files. Do not extend the problem-mode enum for minigames.

## Validation

```sh
npm run build
npm run verify:all
npx tsx scripts/verify-rope.ts
.venv/bin/python panel/test_panel.py
.venv/bin/python panel/test_rope_game.py
```

The rope checks cover suspension, both the vertical fixture and the redesigned
level's three-star throw, swept cuts, swing/release momentum, gravity parabolas,
render-rate determinism, high-speed floor/wall containment, dragging against a
wall, ramp spin, bumper rebound, held-goal rejection, pinch acquisition/release, palm-relative thresholds,
hysteresis, and tracking dropout/jump handling. Panel tests exercise HTTP
routing, status expiry, retry/cut events and restoring tracking.
Physical swipe/throw feel on the GX10 still needs a hardware rehearsal.
