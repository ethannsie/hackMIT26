# IRL Physics Sim

Tap **Take a picture** on the **7-inch touchscreen**, capture a physics problem
with the **USB webcam**, then interact with its simulation on the larger
**ASUS portable monitor** using webcam-tracked hands.

**All models run on the ASUS Ascent GX10**, which also hosts the app and
simulation. The webcam serves both photo capture and hand tracking. No depth
sensor, IMU or serial bridge is required; the one microcontroller is an
ESP32-S3 driving the camera ring light over MQTT
([hackmit_camera_light/](hackmit_camera_light/README.md)).

The initial demo covers **projectile, inclined plane, pendulum and 1D collision**
(confirmed September 19). The engine already contains nine
problem types and a sandbox; those additional capabilities are not part of the
initial touchscreen menu scope.

**Implementation status (Sat 19 Sep evening):** solver, derivations, graphs,
extraction API, the touchscreen menu ([panel/](panel/README.md): scan, hand
overlay, shutdown), webcam hand tracking into the sim, the ring light and the
one-icon two-display launch on the GX10 ([gx10/](gx10/README.md)) all exist
and have run on the real hardware. Still open: a full rehearsal with printed
problems, and the GX10 hosting its own Wi-Fi so the ring light needs no phone.

- [Build plan](hackmit-2026-plan.md): architecture, scope and acceptance.
- [GX10 guide](gx10/README.md): local inference and hardware setup.
- [Capabilities](CAPABILITIES.md): existing engine behavior and limitations.
- [Hardware checklist](HackMIT_2026_Hardware_Checkout.docx): active rig.
- [Organizer inventory](HackMIT%202026%20Hardware%20List.pdf): original reference catalog, not project requirements.

## Run it

```bash
npm install
cp .env.example .env      # GX10 local Ollama settings; see gx10/README.md
npm run dev               # web app on :5173, extract API on :8787
```

Two other commands matter:

```bash
npm run verify            # problem library, against the closed forms
npm run verify:sandbox    # sandbox, against the conservation laws
npm run verify:all        # both
npm run check             # typecheck
```

Open `#sandbox` in the URL to go straight into sandbox mode. Press `?` in the
app for keyboard shortcuts.

**Run `npm run verify:all` before every push.** It is the only thing standing
between us and demoing wrong physics to a judge — it has already caught a pendulum that silently decayed, a magnetic orbit
that gained 2175% speed, and bodies falling off the end of the floor.

The GX10 local extraction path needs no OpenAI key. If extraction is unavailable,
pick a prepared problem and use the sliders. Hosted OpenAI support remains in
code for development, but the agreed demo runs all models locally.

## Generate and Ask (GX10, no photo needed)

Two more things the local models do, both text-only and both on the box:

- **New problem** — the `✨ New problem` button (or `N`, or the panel's tile)
  has `nemotron-3.5-lightning` write a fresh problem of the selected type
  *and* fill the same ProblemSpec schema the photo path uses, in one
  structured reply. It lands through the same validator, builders and
  derivation as a scan. 5–6 s measured. A consistency check rejects a draft
  whose numbers do not appear in its own statement and asks for another.
- **Ask about the physics** — a box under the derivation. Type a question
  (or `A`), or press `🎤` / `M` / the panel's *Ask a question* tile to record
  7 s from the webcam's own mic. The clip goes to Deepgram (`DEEPGRAM_API_KEY`
  in `.env`, server-side only; needs internet) and the words come back into
  the box; the question then goes to the local model with the problem on
  screen and the best-matching passages from OpenStax *University Physics
  Vol. 1* as context (`corpus/README.md` — built on the box, not committed,
  CC BY-NC-SA). ~1.5–2 s per answer. Voice is **online-only by design**:
  the API probes Deepgram every 30 s and the mic button is disabled whenever
  the box cannot reach it (or has no key), so the typed box is what works
  offline. Without the corpus the model answers from memory. Measured:
  a spoken sentence transcribed word-for-word in 0.8 s with `nova-3`.

Reasoning is switched off for both (Ollama's native `think: false`): with it
on, a structured problem took 31 s instead of 5.5.

---

## The two contracts

Everything else is negotiable. These two are not — they are how we work in
parallel without blocking each other.

### 1. `ProblemSpec` — [src/spec/types.ts](src/spec/types.ts)

Between EXTRACT and BUILD. A flat, strict, all-units-in-the-name JSON object.
Frozen after hour 4; do not rename a field without telling everyone.

One deviation from the draft in the plan doc: the ramp angle is
`incline_angle_deg` and the projectile launch angle is `launch_angle_deg`.
The draft called both `angle_deg`, which collides in a flat object.

### 2. `HandFrame` — [src/hand/types.ts](src/hand/types.ts)

Between TRACK and INTERACT. **If you are doing MediaPipe, this is your output
type and it is the only thing you need from the sim side.**

```ts
interface HandFrame {
  t_ms: number                     // performance.now() at capture
  handedness: 'left' | 'right'
  confidence: number
  palm_m: Vec3                     // sim frame, metres
  palm_velocity_ms: Vec3           // m/s — this is where a throw's speed comes from
  landmarks_m?: Vec3[]             // 21 points, for rendering only
  pinch: number                    // 0 open .. 1 closed
  palm_normal?: Vec3
}
```

Coordinate frame is the **sim's**, not the camera's: `+x` right, `+y` **up**,
`+z` toward the viewer, origin at the centre of the sim plane. Converting out of
MediaPipe's normalised image coordinates is the tracking side's job, so the sim
never has to know a camera exists.

Implement `HandSource` (`current()`, `start()`, `stop()`) and we swap it in for
the mock at one line in [src/main.ts](src/main.ts). Until then
[src/hand/mock.ts](src/hand/mock.ts) drives the same interface from the mouse,
so both halves are testable today.

The existing coupling in [src/hand/coupling.ts](src/hand/coupling.ts) accepts
synthetic plane penetration for push and pinch for grab/release. For the
webcam-only demo, define image-plane or gesture-based contact and map it into
this interface; no physical depth stream is required. Velocity is in simulation
units after camera-to-scene mapping. Tracking loss and capture mode must clear
interaction safely.

---

## How the sim stays honest

Two properties we are protecting, both enforced by `npm run verify`.

**It is deterministic.** Physics only ever advances through `SimWorld.step()`,
which uses a fixed 8.333 ms timestep. Nothing reads a `requestAnimationFrame`
delta. The render loop converts wall-clock time into a whole number of fixed
steps, so a dropped frame produces the same trajectory as a smooth one. Same
spec plus same step count gives a bit-identical result on any machine.

**It agrees with the derivation panel.** A student reads the animation and the
algebra side by side, so the two must never disagree.
[src/sim/analytic.ts](src/sim/analytic.ts) holds the closed forms, and
`verify-sims.ts` runs the engine against them. Current worst case is 0.58%.

### Where Matter.js needed replacing

Two of its contact models are not accurate enough to put in front of a student,
so [src/sim/corrections.ts](src/sim/corrections.ts) substitutes the textbook
model. Measured, not guessed:

| Case | Matter alone | With corrections |
|---|---|---|
| Frictionless incline | exact | unchanged |
| Incline, μ = 0.05 | a = 0.008 vs 3.701 expected — block pins | exact |
| Rolling sphere | 95% of sliding value, should be 5/7 | 0.27% |
| Collision, e = 0 | exact | unchanged |
| Collision, e = 1 | 0.375 / 1.625 instead of 0 / 2 | exact |
| Magnetic orbit | speed +2175%, orbit 23× over one run | 0.000% drift |
| Uniform circular | 38% speed swing per orbit | 0.00% |

Matter's friction is a damping model rather than Coulomb, and its restitution is
under-applied as e approaches 1. Applying the Lorentz force explicitly is Euler
on a rotation, which is unconditionally unstable — fatal for the one sim whose
point is that a magnetic field cannot change a particle's speed; that one uses a
Boris-style velocity rotation instead. Everything else — contacts, geometry, and
every hand-driven interaction — still goes through Matter.

Two traps worth knowing if you touch this code:

- **Matter's velocity unit is per `_baseDelta` (1/60 s), not per second and not
  per our timestep.** Using our timestep silently halves every launch speed.
- **Mid-`Engine.update` (inside a `collisionStart` handler) `body.velocity` is
  still raw per-step displacement**, not normalised. Reading it there halves the
  momentum you transfer. Capture velocities in `preStep` instead.

Both cost real debugging time. Both are caught by `npm run verify`.

---

## Ingest

1. **Compress in the browser** — [src/extract/compress.ts](src/extract/compress.ts).
   Long edge to 1024px, JPEG q0.72. A 4 MB phone photo becomes under 200 KB with
   no loss in extraction quality on printed text. Vision models tile at 512px, so
   detail beyond that is paid for and discarded.

2. **Extract** — [server/index.ts](server/index.ts). The key lives only in this
   process; Vite proxies `/api` to it so the browser never holds a credential.
   Uses the same prompt and JSON schema for local Ollama and the existing
   hosted path. On GX10 set `EXTRACT_LOCAL_URL=http://localhost:11434/v1`,
   `EXTRACT_LOCAL_MODEL=qwen3.8` and `EXTRACT_LOCAL_TIMEOUT_MS=45000`. Leave
   `OPENAI_API_KEY` unset for the all-local demo. A tested local extraction took
   about 28 seconds; the new touchscreen flow needs loading and retry states.

3. **Validate** — [src/spec/validate.ts](src/spec/validate.ts). Structured
   outputs guarantee shape, never physics. This clamps implausible values,
   forces `interactable: false` on ramps and walls, rejects specs missing a
   field the type cannot run without, and **surfaces every repair in the UI** —
   if a number on screen is not the student's, we say so.

Test the whole path against a real image:

```bash
npx tsx scripts/e2e.ts path/to/problem.jpg     # uses configured extraction backend
```

---

## Layout

```
src/spec/        the ProblemSpec contract, JSON schema, validator
src/sim/         params -> scene -> deterministic world; closed forms; corrections
                 nine problem types — see CAPABILITIES.md
src/hand/        the HandFrame contract, mouse mock, hand->force coupling
src/extract/     browser-side compression and API client
src/ask/         the Ask box: recorder (webcam mic), transcription + question client
src/render/      canvas views, KaTeX derivation panel, motion graphs
src/history.ts   rollback buffer (snapshots are spec + step count)
server/          extraction API and prompt; generate + ask + transcribe; BM25 corpus
scripts/         verify-sims.ts (run this), e2e.ts
```

The canvas renderer is deliberately not three.js. It draws the solver's actual
state, so when the animation and the derivation disagree we can see which one is
lying. It is sufficient for the initial demo; a three.js scene is not required.

## Third-party

Disclosed per the HackMIT honour code (plan §17):
matter-js 0.20, katex 0.16, openai 4.73, vite 5.4, express 4.21.
Approach follows LivePhys (arXiv:2607.20990) for the scan-to-spec stage.

## Standalone webcam demo

`hand_physics_demo.py` is the original webcam-first prototype: index fingertip
as cursor, thumb + index pinch to grab, open palm as a soft pusher, with a
drawn hand avatar. On the demo box the [panel](panel/README.md) owns the
camera, so run this only on a laptop. Python 3.10+:

```bash
python3 -m pip install -r requirements.txt
curl -fLo hand_landmarker.task https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task
python3 hand_physics_demo.py            # --preview for the OpenCV window
```

With the web app open it posts poses to `/api/hand/frame` and the browser
picks them up automatically (after the panel camera, before the mouse);
without it the browser keeps the mouse, and `?hand=mouse` ignores every
tracker. It holds a grab through a 0.22 s tracker
dropout and needs six open frames to release — constants at the top of the
file. `depth_at_cursor_mm()` is an empty adapter left for a depth sensor.
