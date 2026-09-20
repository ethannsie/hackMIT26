# Hand-cut rope physics puzzles

Two playable levels of five planned. Hands **only cut ropes**: candy cannot be
picked up, dragged, thrown or rescued. All motion comes from gravity, rope
tension and collision response. Full live hand overlay, index blade, velocity
arrow, flight trail, three stars, and win/loss feedback.

- **Swing & soar:** candy starts displaced on a pendulum. Cut during its
  rightward swing to preserve tangential momentum and reach the creature.
- **Drop & bounce:** cut the hanging candy. It accelerates under gravity and
  rebounds off the curved rubber bumper toward the creature.

Both have verified three-star solutions without injected velocities or forces.
Missing the creature lets the candy leave the stage and enables another attempt.

## Play and resume

Open the main app at `http://localhost:5173/` and touchscreen menu at
`http://localhost:8770/`. Select **Cut the Rope** from the menu.
All buttons stay on the touchscreen: **Cut rope**, **Restart level**, **Next
level** (after winning level one), and **Exit game**. The big screen has no
mouse or keyboard game controls. After level two, the preview is complete;
**Replay levels** starts again at level one, keeping best stars;
levels 3–5 are deferred. Exit restores the underlying simulation.

A pointing index or open hand sweeps through a rope to cut it. Curl the index
to reposition safely; the full hand remains visible. Tracking loss, stale
observations, hand switches and large jumps break the blade stroke. There is
no grabbing gesture or force coupling to the candy.

The big screen saves current level and best stars in localStorage. Reopening
in the same browser resumes that level with a fresh attempt. Storage is
optional; blocked storage does not prevent play. Restart retries the current
level. Panel and Vite processes need relaunching after laptop shutdown.

Mac preview (two terminals in the repository):

```sh
npx vite --host localhost --port 5173 --strictPort
PANEL_CAMERA_INDEX=1 PANEL_ALLOW_SHUTDOWN=0 PANEL_LIGHT=0 .venv/bin/python panel/panel_server.py
```

Camera index 1 is this Mac's FaceTime camera, not a GX10 setting. The panel owns
the webcam and automatically enables tracking in the game. Use one main app
and one menu window to avoid competing sessions/SSE connection limits.
The existing `handspan` query parameter controls camera-to-canvas mapping.

## Ownership and merge boundaries

Keep game changes in this folder, `panel/rope_game.py`, `panel/ui/rope.{js,css}`,
`panel/test_rope_game.py` and `scripts/verify-rope.ts`. Existing integration hooks:

- `src/main.ts`: construct controller and suspend host loop while playing.
- `panel/panel_server.py`: game view, tracking activation and delegated routes.
- `panel/ui/index.html`: menu tile, controller markup and assets.
- `panel/ui/panel.js`: additional view registration.

No changes to the solver, sandbox, shared physics, tracking, dependencies or
launcher. Shadow DOM isolates game styles. A private Matter world advances at
240 Hz, with gravity 9.81 m/s² at 85 px/m, disk inertia, unilateral ropes and
swept star/goal/cut checks. Collision geometry matches the drawn level data.

## Validation

```sh
npm run build
npm run verify:all
npx tsx scripts/verify-rope.ts
.venv/bin/python panel/test_panel.py
.venv/bin/python panel/test_rope_game.py
```

Checks cover both cut-only three-star solutions, an incorrect cut, the viable
swing timing window, pendulum release momentum, gravity, render-rate
determinism, collision containment, gesture continuity, progress persistence,
Next gating/end-of-preview, HTTP control transport and tracking lifecycle.
Physical hand feel and two-display GX10 rehearsal remain hardware checks.
