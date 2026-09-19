# IRL Physics Sim — Full Build Plan

**HackMIT 2026 · Sept 19–20 · MIT**

Working reference for the whole team. If something here conflicts with what someone said verbally, this document wins. If this document is wrong, fix it here rather than arguing in Discord.

---

## 1. What we are building

Point a camera at a physics problem in a textbook. The system extracts the problem's structure, builds a live simulation of it, and lets you reach into that simulation with your actual hand to push, tilt, and throw the objects while the derivation updates in real time beside it.

One sentence for judges:

> A student photographs a mechanics problem and then solves it with their hands instead of a pencil.

---

## 2. Where we sit in the landscape

Two things already exist and judges may know them.

**PhET** has had parameterized physics simulations for twenty years. Well made, widely used in classrooms, entirely mouse and slider driven, and every simulation was hand-authored by a human.

**LivePhys** (arXiv:2607.20990, July 23 2026) does scan-to-play: photograph a static textbook problem, a multimodal LLM extracts entities, parameters and constraints into a structured intermediate representation, and a physics engine executes it into an interactive simulation. Their user study found reduced cognitive load compared to static textbook material.

That is most of our pipeline, published two months ago. **Say this to judges before they say it to us.** Naming the prior art yourself reads as command of the field. Pretending it doesn't exist reads as not having looked.

Our differentiator is the interface. LivePhys gives you a simulation you manipulate with a cursor. We give you one you manipulate with your hand, in measured three-dimensional space, with the derivation rewriting itself as you move.

That distinction matters most for exactly the concepts intro mechanics students fail at: torque, angular momentum, and anything where the vector points somewhere nothing is moving. You cannot feel a cross product with a mouse.

---

## 3. Architecture

Five stages. Each one has a clean interface to the next, so people can work in parallel without blocking.

```
[1] CAPTURE      phone or webcam photo of a textbook problem
       |
       v
[2] EXTRACT      ASUS Ascent GX10, local inference
                 image -> strict JSON problem spec
       |
       v
[3] BUILD        spec -> parameterized sim, one per problem type
                 Matter.js 2D solver on a plane in a three.js 3D scene
       |
       v
[4] TRACK        MediaPipe worldLandmarks (hand pose, metric)
                 + VL53L1X ToF (palm depth, metric)
                 = hand placed in the 3D scene
       |
       v
[5] INTERACT     hand crosses the sim plane -> contact
                 contact drives forces -> sim resolves
                 -> derivation panel re-solves with live values
```

**The JSON problem spec is the contract between every stage.** It is the single most important artifact in this project. Freeze it early, and do not let anyone change it after hour 4 without telling the whole team.

---

## 4. The problem spec

Design target: strict, small, and boring. Every field has a unit in its name. No free-form strings the sim has to parse.

```json
{
  "problem_type": "inclined_plane",
  "confidence": 0.92,
  "given": {
    "angle_deg": 25,
    "ramp_length_m": 1.2,
    "mass_kg": 2.0,
    "mu_kinetic": 0.15,
    "initial_velocity_ms": 0,
    "gravity_ms2": 9.81
  },
  "objects": [
    {
      "id": "block",
      "kind": "box",
      "interactable": true,
      "mass_kg": 2.0,
      "dims_m": [0.10, 0.06]
    },
    {
      "id": "ramp",
      "kind": "incline",
      "interactable": false,
      "angle_deg": 25,
      "length_m": 1.2
    }
  ],
  "asked_for": ["acceleration_ms2", "time_to_bottom_s", "final_velocity_ms"],
  "raw_text": "A 2.0 kg block is released from rest at the top of a 1.2 m ramp inclined at 25 degrees..."
}
```

Rules:

- `problem_type` must be one of the enumerated types in section 6. If the model is unsure, it returns the closest match plus a low `confidence`, and the UI asks the user to confirm with a toggle. Never guess silently.
- `interactable: true` means the hand can push it. Ramps, walls, ground, and pivots are always `false`.
- `confidence` below 0.6 triggers the manual problem-type picker rather than a wrong simulation.
- `raw_text` is kept so the derivation panel can quote the original problem.

---

## 5. Stack, locked

| Layer | Choice | Why |
|---|---|---|
| App | TypeScript, single web app | One language, one build, one render loop |
| 3D render | three.js | Hand skeleton, scene, depth cues |
| Physics | Matter.js (2D) | Every problem here is planar; solver is battle-tested |
| Hand tracking | MediaPipe Tasks Vision, HandLandmarker | `worldLandmarks` gives metric 3D hand pose free |
| Math display | KaTeX | Fast, no MathJax startup cost |
| Sensors | ESP32 over WebSerial | No backend, no wifi dependency |
| Inference | ASUS Ascent GX10, local | ASUS challenge, works when venue wifi dies |
| Fallback inference | Hosted API, 2s timeout | GX10 stall must never freeze a demo |

### The 3D question, resolved

We render in 3D and simulate in 2D. These are independent decisions and conflating them is what made this confusing.

The scene is a three.js 3D space. The hand is a full articulated 21-joint skeleton with real perspective and depth. The simulation lives on a visible plane inside that space. You move around and *through* that plane in three dimensions.

Every problem in our library is genuinely planar, so a 2D solver loses nothing, and it saves the four-hour rewrite to Rapier or cannon-es. Visually it is completely three-dimensional and no judge will know or care that the solver is 2D.

**Do not switch to a 3D physics engine.** If someone insists later, the answer is Rapier (`@dimforge/rapier3d`), not a Python rewrite, and only if Tier 0 has been green for hours.

---

## 6. The simulation library

Four problem types. **This list does not grow.** Adding a fifth at 2 AM is how we lose.

Each sim is hand-written and parameterized. We are not building a general physics compiler; the model only fills in numbers.

### 6.1 Projectile

Params: `v0_ms`, `angle_deg`, `h0_m`, `g`

```
x(t) = v0·cos(θ)·t
y(t) = h0 + v0·sin(θ)·t − ½·g·t²
time of flight  t_f = [v0·sin(θ) + √(v0²sin²(θ) + 2·g·h0)] / g
range           R   = v0·cos(θ)·t_f
apex height     h   = h0 + v0²sin²(θ)/(2g)
```

Hand role: grab the projectile, throw it. Launch velocity comes from measured hand velocity at release.

### 6.2 Inclined plane

Params: `angle_deg`, `mass_kg`, `mu_kinetic`, `ramp_length_m`

```
sliding block   a = g·(sin θ − μ·cos θ)
normal force    N = m·g·cos θ
rolling sphere  a = (5/7)·g·sin θ
```

Hand role: tilt the ramp. This is our best interaction. The angle is continuously controlled by hand orientation and every number on screen re-solves live.

**Note the rolling sphere case.** A solid sphere rolling without slipping accelerates at 5/7 of the sliding value, about 71%, because energy goes into rotation. If we ever compare against a real ball, this discrepancy will appear reliably and has a beautiful explanation. Good material for the "why did that happen?" feature.

### 6.3 Pendulum

Params: `length_m`, `theta0_deg`, `mass_kg`

```
small angle     ω = √(g/L),   T = 2π·√(L/g)
restoring       τ = −m·g·L·sin θ
```

Hand role: pull the bob aside and release. Large initial angles visibly break the small-angle approximation, which is a teaching moment worth surfacing in the derivation panel.

### 6.4 1D collision

Params: `m1_kg`, `m2_kg`, `v1_ms`, `v2_ms`, `restitution`

```
general (restitution e):
  v1' = [m1·v1 + m2·v2 + m2·e·(v2 − v1)] / (m1 + m2)
  v2' = [m1·v1 + m2·v2 + m1·e·(v1 − v2)] / (m1 + m2)

elastic (e = 1):
  v1' = [(m1 − m2)·v1 + 2·m2·v2] / (m1 + m2)
  v2' = [(m2 − m1)·v2 + 2·m1·v1] / (m1 + m2)
```

Hand role: push one cart into the other. Momentum and kinetic energy bars before and after make conservation visible.

### Reference for later, not today

Atwood machine: `a = g·(m1 − m2)/(m1 + m2)`, `T = 2·m1·m2·g/(m1 + m2)`
Spring-mass: `ω = √(k/m)`, `T = 2π·√(m/k)`

---

## 7. Hand tracking

### What MediaPipe gives us

`HandLandmarker` returns two sets per hand:

- `landmarks` — normalized image coordinates, with a z that is relative to the wrist and unitless. **Not usable as real depth.**
- `worldLandmarks` — all 21 points as metric 3D coordinates in meters, origin at the hand's geometric center. **This is real 3D hand pose and it is free.**

So the *shape and articulation* of the hand in 3D is already solved with zero hardware. Render this immediately.

What is missing is where that hand sits relative to the camera. That single number is what the sensor supplies.

### Fusion

1. MediaPipe normalized x, y gives a ray from the camera through the palm.
2. VL53L1X ToF gives palm distance in millimeters along roughly that direction.
3. Place the hand along the ray at the measured distance.
4. Orient and articulate it using `worldLandmarks`.

Result: a fully articulated hand at a real metric position in the scene.

Pitch line: *we don't infer depth, we measure it.*

### Depth as touch

The sim plane sits at a fixed z. Contact is defined by crossing it.

```
penetration = palm_z − plane_z
if penetration > 0:
    contact = true
    F = clamp(k · penetration, 0, F_max)
```

Hovering above the plane is free-look. Pushing into it applies force proportional to how far in you reach. This gives the whole "reach into the simulation" feeling without any 3D physics.

Render a contact glow or a shadow where fingertips cross the plane, so depth reads instantly to a judge watching from three feet away.

---

## 8. Sensors and firmware

### Parts

| Part | Role | Priority |
|---|---|---|
| VL53L1X ToF | Palm depth, metric, up to ~50 Hz | P0 |
| BNO055 9-DOF | Hand or ramp orientation, absolute, no drift | P1 |
| ESP32-WROOM-32 | Reads sensors, streams to browser | P0 |
| Mini breadboard + jumpers | Wiring | P0 |
| VL53L7CX 8×8 ToF | Upgrade: 64 depth zones, survives lateral hand motion | P2 |

### The I2C trap

The VL53L1X defaults to **0x29**. The BNO055 is **0x28 or 0x29** depending on its address pin.

**Tie the BNO055 to 0x28 before wiring anything.** If both land on 0x29 you will spend an hour debugging a bus conflict that looks like a broken sensor.

### Serial protocol

Newline-delimited JSON over WebSerial, 50 to 100 Hz. No backend, no sockets, no wifi.

```json
{"t":1726790412,"depth_mm":412,"theta_deg":24.8,"gate":null}
```

Browser side:

```js
const port = await navigator.serial.requestPort();
await port.open({ baudRate: 115200 });
// read, split on \n, JSON.parse, push into the same loop as MediaPipe
```

Keep the sensor read in the same animation frame loop as hand tracking. Two loops fighting each other is a 3 AM bug.

### Calibration

Budget 45 minutes and expect longer.

- ToF zero offset against a known distance measured with an actual ruler
- BNO055 zeroed flat on a level surface
- Hand-to-plane distance threshold tuned with a person's actual hand, not a hand-shaped object

---

## 9. The GX10

Two jobs, not one. If it only fires at photo ingest, the ASUS story is thin.

1. **Ingest**: image to JSON problem spec.
2. **Live**: the "why did that happen?" query runs locally with the current sim state as context, while the user is interacting.

Then the entire loop is on-device and we can say so honestly.

Connection: Cat6 straight to the laptop, one local HTTP endpoint. Hit local first, fall back to the hosted API on a **2 second timeout**. A GX10 stall must never freeze a live demo.

---

## 10. Hardware checkout

### From ASUS lending
- ZenScreen MB169CK-P ×1 — sim canvas at hand height
- Ascent GX10 ×1 — local inference

### From the HackMIT hub
- USB webcams ×2 (one spare)
- Powered 7-port USB 3.0 hub ×1
- USB-C cables ×3, USB-C to USB-A adapters ×3
- Cat6 Ethernet cable ×1
- HDMI + micro-HDMI cables, active HDMI-to-USB-C adapter
- Wired USB keyboard + mouse (GX10 first boot)
- Portable 15.6 in. 1080p monitor ×1 — derivation panel facing the judge
- USB power bank 10,000 mAh 30 W (restricted) — ZenScreen power
- Foam board ×2 — matte backdrop behind the hand zone, big tracking accuracy win
- Gaffer tape, zip ties
- VL53L1X, BNO055, ESP32, breadboard, jumper wires

### Bring ourselves
- Laptops and chargers
- Tripod or clamp for the webcam (no good mount in inventory)
- Printed problems, clean contrast, no glare
- Phone for capture and the demo video

### Notes
- **There is no projector in the 2026 inventory.** Table projection is off unless someone brought one.
- Power strips are deployed by HackMIT staff only. Ask at your table, don't bring your own.
- Soldering is restricted to the staffed hot-work bench with safety glasses.

---

## 11. Scope tiers

### Tier 0 — must work, hour 6
Webcam, MediaPipe, hand as a paddle in a Matter.js scene, pinch to grab, release to throw. Live velocity and force vectors, energy bars, v–t graph, equation panel updating in real time.

**If Tier 0 works and nothing else does, we still demo well.** This is the floor and it is not negotiable.

### Tier 1 — hour 14
All four problem types. Photo to spec via the GX10. Derivation panel with real substituted numbers. three.js 3D hand rendering. Predicted trajectory drawn over the simulated motion.

### Tier 2 — start only if Tier 0 is solid, hard stop hour 16
ToF depth fusion. BNO055 orientation and hand-tilted ramps. The live "why did that happen?" query.

### Cut, and staying cut
Haptic glove. Thermal camera. Fifteen problem types. The 33-concept electromagnetism list. Chained sandbox systems. Generated CAD and STL export. Table projection. DimensionalOS.

These are the "what's next" slide. Framing them that way is a strength.

---

## 12. Failure ladder

Decide the floor now, not at 4 AM.

1. Full stack: photo → GX10 → sim → ToF-fused 3D hand → live derivation
2. No ToF: MediaPipe 2D hand only, depth threshold faked from hand size
3. No GX10: hosted API, same pipeline
4. No photo ingest: manual problem-type picker with sliders, sim still works
5. Floor: Tier 0, one problem type, hand pushing a ball

Every rung is still a demo. Nothing below rung 5 ships.

---

## 13. Roles

| Person | Owns |
|---|---|
| CV / interaction | MediaPipe, hand-to-physics coupling, grab and release gesture states |
| Physics / render | Matter.js sims, four problem types, three.js scene, overlays |
| Model pipeline | GX10 endpoint, image to spec, derivation generation, KaTeX panel |
| Rig / pitch (David) | Sensors and firmware, table setup, UX polish, demo video, pitch, submission |

The fourth role is not the lesser role. At a three-minute expo slot, whoever owns the story and the physical setup is doing load-bearing work.

---

## 14. Timeline

Clock times follow the 2025 schedule; confirm at opening ceremony.

| When | What |
|---|---|
| Hour 0–1 | Freeze scope. Write the JSON spec. Agree interfaces. |
| Hour 6 | **Checkpoint:** hand pushes ball, vectors live. Not working means cut Tier 1 until it is. |
| Hour 12 | From here, `main` always demos. No exceptions. |
| Hour 12–18 | Sleep in shifts, two and two. Non-negotiable. |
| Sat night | Two strangers try it. Film their reaction. Feeds the Learning and Collaboration third of the rubric. |
| Hour 16 | Tier 2 hard stop. |
| Hour 18 | **Feature freeze.** Record the 90-second demo video as insurance. |
| Hour 20–23 | Rehearse the pitch five times out loud. Set up the table. Test under actual room lights. |
| Sun ~11:15 | Submit, 30 min early. Submission systems fall over at the deadline. |
| Sun 11:45 | Hacking ends. |
| Sun PM | Expo judging, two phases. Panel judging if we advance. Closing ~6:00 PM. |

---

## 15. The three-minute pitch

1. **Open with the hand, not a slide.** Push the ball, let the judge watch the vector follow your palm. Ten seconds, no narration.
2. **Name the problem.** Students read a static diagram and have to run the simulation in their heads. That is where intro mechanics loses people.
3. **Show photo to sim.** Snap a textbook problem, the scene assembles, point at the derivation matching the motion.
4. **Hand the judge the controls.** Let them tilt the ramp and watch both the animation and the equations move. A judge who touches it remembers it.
5. **Name LivePhys yourself**, explain what the hand adds, and close on what's next.

Rehearse this. Five times, out loud, to a person. The pitch is a deliverable, not an afterthought.

---

## 16. Submission targets

**Primary track:** Education.

**Challenges:** pick two or three we satisfy naturally rather than spreading across a dozen sponsor prizes.

- Most Creative — strong fit
- Best UX — strong fit
- ASUS "Build What's Next" — real, because inference genuinely runs on the GX10
- Best Use of Hardware — only if the sensor rig actually works. Do not claim hardware on the strength of a webcam.

Do not add a sponsor dependency purely to qualify for a prize. Judges can tell, and it is how good projects die at 4 AM.

---

## 17. Honor code

HackMIT operates on an honor code. No project work before hacking starts, and any borrowed code must be disclosed. Teams have been disqualified in the past both for presenting others' demo material as their own and for resubmitting a project from a previous hackathon.

Practically: list MediaPipe, Matter.js, three.js, KaTeX and any sensor libraries in the README with versions. Cite LivePhys in the submission. Being explicit costs nothing and protects us.

---

## 18. Open questions

- Which ToF part is physically in hand right now
- Whether the BNO055 goes on the hand (orientation, torque demos) or the ramp (tilt control). Hand is the better demo; ramp is the easier build.
- Whether the portable monitor is available or already claimed
- Confirm 2026 tracks and challenge list at the opening ceremony; everything above assumes 2025 repeats

---

## 19. Sources

- hackmit.org — 2026 dates and scale
- dayof.hackmit.org — 2025 tracks, challenges, prizes, schedule, FAQ
- hack-mit-2023.devpost.com — published judging rubric (originality/impact, technology, learning/collaboration, equal weight)
- thetech.com, 2014 — honor code and past disqualifications
- arXiv:2607.20990 — LivePhys
- developers.google.com — MediaPipe HandLandmarker for web
