# IRL Physics Sim

Photograph a mechanics problem, get a live simulation you can reach into with
your hands, with the derivation rewriting itself as you move.

Full plan and scope tiers: [hackmit-2026-plan.md](hackmit-2026-plan.md).
**What the system can and cannot simulate: [CAPABILITIES.md](CAPABILITIES.md).**
This README covers the **simulation and ingest** half — stages [1]–[3] and [5].

---

## Run it

```bash
npm install
cp .env.example .env      # add your OpenAI key
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

**Run `npm run verify:all` before every push.** 41 + 16 checks, worst case
0.58%. It is the only thing standing between us and demoing wrong physics to a
judge — it has already caught a pendulum that silently decayed, a magnetic orbit
that gained 2175% speed, and bodies falling off the end of the floor.

Without an API key everything still works except photo ingest: pick a problem
type from the dropdown and use the sliders. That is rung 4 of the failure
ladder, and it is deliberately a complete demo on its own.

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

Contact model is in [src/hand/coupling.ts](src/hand/coupling.ts): crossing the
plane applies `F = clamp(k · penetration, 0, F_max)`; pinching near a pushable
body grabs it; releasing throws it at the measured palm velocity.

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
   Uses OpenAI structured outputs with `strict: true` and `temperature: 0`, so
   the reply cannot be shaped wrong and the same photo gives the same spec.
   Set `EXTRACT_LOCAL_URL` to the GX10 and it tries on-device first, falling back
   to the hosted API on a 2 s timeout.

3. **Validate** — [src/spec/validate.ts](src/spec/validate.ts). Structured
   outputs guarantee shape, never physics. This clamps implausible values,
   forces `interactable: false` on ramps and walls, rejects specs missing a
   field the type cannot run without, and **surfaces every repair in the UI** —
   if a number on screen is not the student's, we say so.

Test the whole path against a real image:

```bash
npx tsx scripts/e2e.ts path/to/problem.jpg     # costs one API call
```

---

## Layout

```
src/spec/        the ProblemSpec contract, JSON schema, validator
src/sim/         params -> scene -> deterministic world; closed forms; corrections
                 nine problem types — see CAPABILITIES.md
src/hand/        the HandFrame contract, mouse mock, hand->force coupling
src/extract/     browser-side compression and API client
src/render/      canvas views, KaTeX derivation panel, motion graphs
src/history.ts   rollback buffer (snapshots are spec + step count)
server/          extraction API and the extraction prompt
scripts/         verify-sims.ts (run this), e2e.ts
```

The canvas renderer is deliberately not three.js. It draws the solver's actual
state, so when the animation and the derivation disagree we can see which one is
lying. It stays useful as a debug view once the 3D scene lands.

## Third-party

Disclosed per the HackMIT honour code (plan §17):
matter-js 0.20, three 0.169, katex 0.16, openai 4.73, vite 5.4, express 4.21.
Approach follows LivePhys (arXiv:2607.20990) for the scan-to-spec stage.
