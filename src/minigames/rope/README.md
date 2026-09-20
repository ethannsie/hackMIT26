# Hand-cut rope minigame

One playable introductory level of a planned five-level game. Original canvas
artwork, candy on a physical rope, three collectible stars, a hungry creature,
win/loss feedback and restart. Levels 2–5 are visibly locked placeholders, not
implemented levels.

## Play from the touchscreen

Run the usual app on `http://localhost:5173/` and the panel service on
`http://localhost:8770/`. Select **Cut the Rope** on the panel home screen.
The main display opens the game; the panel shows score, tracking status, Restart
and Exit. Exiting resumes the previous physics scene at its preserved time.
The panel server needs restarting after installing this branch; Vite serves the
game with the existing build/launcher. No new packages, model or camera process.

The camera frame maps to the game canvas. The complete translucent 21-joint hand
is drawn in the same coordinates as the cutting blade. The green ring around
the **index fingertip** marks the blade; sweep it across the rope to cut. No
pinch is required. A fist remains visible but disables cutting (amber ring).
Tracking loss clears the stroke; reacquisition does not cut across the gap.
The panel owns the webcam and automatically enables tracking while this view
is selected, then restores the existing Auto/On/Off behavior when leaving.

The existing `handspan` query parameter works here too. Start at its default
1.0; `?handspan=0.8` maps the middle 80% of the camera onto the playfield.

For a camera-free development preview, use
`http://localhost:5173/?game=rope&hand=mouse` and click-drag across the rope.
`R` restarts and `Escape` exits. For the real two-display demo, keep **one main
app window** and one panel window open: several copies compete for the shared
menu and the browser's per-origin streaming-connection budget.

## Ownership and merge boundaries

Keep subsequent game work in this folder and `panel/rope_game.py`,
`panel/ui/rope.{js,css}`, `panel/test_rope_game.py`, `scripts/verify-rope.ts`.
There are just four small shared-file integration points:

- `src/main.ts`: import, controller construction, skip the host loop while active.
- `panel/panel_server.py`: recognize the game view, enable tracking, delegate routes.
- `panel/ui/index.html`: menu tile and controller markup/assets.
- `panel/ui/panel.js`: register the additional view.

No changes to the solver, sandbox, physics engine, camera tracker, hand-source
contract, dependency lockfile, or GX10 launcher. Game styling is inside a Shadow
DOM; the hidden app is inert while playing. The hand input adapter reads the
existing `RemoteHandSource`, with its coordinate mapping set to game pixels.
The engine itself is pure TypeScript, uses a 120 Hz fixed timestep, keeps rope
tension unilateral, and preserves tangential velocity on release.

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

The rope checks cover suspension, the three-star solution, swept cuts, misses,
independent ropes, swinging/release momentum, render-rate determinism, failure,
reset, index-tip selection, and tracking dropout/jump/fist guards. Panel tests
exercise real HTTP routing, status expiry, retry events and restoring tracking.
Physical swipe feel on the GX10 still needs a hardware rehearsal.
