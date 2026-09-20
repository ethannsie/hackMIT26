# IRL Physics Sim — Full Build Plan

**HackMIT 2026 · Sept 19–20 · MIT**

Working reference for the whole team. Updated September 19 for the confirmed webcam-only, two-display demo. New user decisions supersede older planning notes; record them here and in the local handoff.

---

## 1. What we are building

A visitor taps **Take a picture** on a 7-inch touchscreen menu. A USB webcam captures a physics problem, a model on the ASUS Ascent GX10 extracts its parameters, and the corresponding simulation opens on the larger ASUS portable monitor. The webcam then tracks the visitor's hand so they can interact with the simulation.

**All models run on the GX10**, including the hand tracker and photo extraction model. The target deployment runs the browser and simulation there too. The portable monitor is the simulation display; the 7-inch touchscreen is the controller. Laptops are development machines.

The initial demo supports four problem types: projectile, inclined plane, pendulum and 1D collision. The user confirmed this set on September 19. Extra simulations already in the repository are outside this initial menu scope.

No external depth sensor, IMU, microcontroller, sensor firmware, serial bridge or haptic device is required. This replaces the earlier sensor-fusion plan.

One sentence for judges:

> Photograph a physics problem, then explore its simulation with your hands.

---

## 2. Where we sit in the landscape

Two things already exist and judges may know them.

**PhET** has had parameterized physics simulations for twenty years. Well made, widely used in classrooms, entirely mouse and slider driven, and every simulation was hand-authored by a human.

**LivePhys** (arXiv:2607.20990, July 23 2026) does scan-to-play: photograph a static textbook problem, a multimodal LLM extracts entities, parameters and constraints into a structured intermediate representation, and a physics engine executes it into an interactive simulation. Their user study found reduced cognitive load compared to static textbook material.

That is most of our pipeline, published two months ago. **Say this to judges before they say it to us.** Naming the prior art yourself reads as command of the field. Pretending it doesn't exist reads as not having looked.

Our differentiator is the interface. LivePhys gives you a simulation you manipulate with a cursor. We give you one you manipulate with webcam-tracked hand gestures, with the derivation displayed beside the simulation. We do not claim measured physical hand depth.

That distinction matters most for exactly the concepts intro mechanics students fail at: torque, angular momentum, and anything where the vector points somewhere nothing is moving. You cannot feel a cross product with a mouse.

---

## 3. Architecture

Target workflow; the touchscreen controller and two-display integration still need implementation and testing.

```text
7-inch touchscreen: menu -> Take a picture -> preview / retake / loading
                                      |
USB webcam ----------------------> captured image
                                      |
GX10 local vision model ---------> validated ProblemSpec
                                      |
GX10 simulation -----------------> ASUS portable monitor: scene + equations
          ^
          |
GX10 hand tracker <--------------- same USB webcam in interaction mode
```

1. **Capture:** controller requests a webcam still of the printed problem.
2. **Extract:** the GX10 model returns a structured spec; validate it and restrict the demo to the four supported types.
3. **Build:** load the matching parameterized Matter.js simulation on the ASUS display.
4. **Track:** process webcam frames on the GX10 and map hand landmarks into simulation coordinates.
5. **Interact:** gestures drive push, grab and release; render the resulting motion and equations on the ASUS display.

Use one webcam initially, switching between capture and interaction. Pause interaction during capture and while the page obscures the hand. Resume only after a valid hand is reacquired. The camera position must make both tasks practical; test printed text legibility early.

Two views must share one active problem and simulation session. A controller action must update the ASUS view, not start an independent simulation in another tab. The transport and view routes remain implementation work; do not advertise invented launch URLs.

`ProblemSpec` connects extraction to simulation; `HandFrame` connects tracking to interaction. Existing contracts live in `src/spec/types.ts` and `src/hand/types.ts`.

---

## 4. The problem spec

The source of truth is `src/spec/types.ts`, with structured-output schema in `src/spec/schema.ts` and validation in `src/spec/validate.ts`. The implemented spec is flat; do not reuse the older nested `given` / `objects` draft.

- Initial menu types: `projectile`, `inclined_plane`, `pendulum`, `collision_1d`.
- Parameter names carry units. Projectile uses `launch_angle_deg`; incline uses `incline_angle_deg`.
- Validate extracted values before loading a scene and show corrections or missing information to the user.
- Low confidence, unreadable photos and unsupported types lead to retake or manual selection; do not silently substitute an unrelated problem.
- The code supports additional types. Restricting the initial capture/menu experience to four is a pending product change, not a schema change made by this documentation update.

---

## 5. Stack and deployment

| Layer | Choice | Status / purpose |
|---|---|---|
| App | TypeScript web app on GX10 | Existing Vite app; controller/display views still to build |
| Simulation display | ASUS portable monitor | Scene, equations, vectors and graphs |
| Controller | 7-inch touchscreen | Take a picture, preview, retake and loading/result state |
| Physics | Matter.js 2D | Existing deterministic solver |
| Rendering | Existing canvas renderer | 3D rendering is not a demo requirement; no three.js dependency |
| Tracking | Webcam hand model on GX10 | MediaPipe is the planned adapter; integrate actual tracker with HandSource |
| Math | KaTeX | Existing derivation panel |
| Extraction | Ollama on GX10 | Local photo-to-spec model; measured extraction about 28 seconds |
| Models | All local on GX10 | Hosted API exists in code, but is outside the agreed demo path |

The four initial problems are planar. Keep the existing 2D solver and prioritize clear hand interaction over a renderer rewrite. A landmark overlay can help users see what the webcam detects without implying measured physical depth.

---

## 6. The simulation library

Four problem types in the initial demo menu. The existing engine has nine types; preserve that code, but do not expand the initial demo scope.

Each sim is hand-written and parameterized. We are not building a general physics compiler; the model only fills in numbers.

### 6.1 Projectile

Params: `v0_ms`, `launch_angle_deg`, `h0_m`, `gravity_ms2`

```
x(t) = v0·cos(θ)·t
y(t) = h0 + v0·sin(θ)·t − ½·g·t²
time of flight  t_f = [v0·sin(θ) + √(v0²sin²(θ) + 2·g·h0)] / g
range           R   = v0·cos(θ)·t_f
apex height     h   = h0 + v0²sin²(θ)/(2g)
```

Hand role: grab the projectile, throw it. Launch velocity comes from tracked movement mapped to simulation units at release, not a claim of calibrated physical speed.

### 6.2 Inclined plane

Params: `incline_angle_deg`, `mass_kg`, `mu_kinetic`, `ramp_length_m`

```
sliding block   a = g·(sin θ − μ·cos θ)
normal force    N = m·g·cos θ
rolling sphere  a = (5/7)·g·sin θ
```

Hand role: push the block along the ramp. Webcam-based ramp-angle control is optional future work; it does not require an IMU and is not part of the initial acceptance criteria.

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

## 7. Webcam hand tracking

Run the hand model on the GX10 using frames from the USB webcam. Implement the existing `HandSource` interface (`start`, `stop`, `current`) and output `HandFrame` in simulation coordinates: +x right, +y up, +z toward the viewer.

Map image coordinates to the visible simulation area, handle mirroring consistently, smooth movement and derive release velocity in simulation units. Pinch near an object grabs it; release throws it. Define the push gesture explicitly and tune it with the real camera.

**No physical depth measurement is required.** Do not make contact depend on a ToF stream or claim camera-relative metric depth. The existing coupling has a synthetic z/penetration input; the webcam adapter may derive that from an explicit gesture or the coupling can be adapted to image-plane contact. That choice remains implementation work.

On tracking loss or stale frames, release/clear interaction safely; do not throw with an old velocity. Clear interaction when entering capture mode, and reacquire the hand before resuming.

As of this documentation update, this branch still wires `MockHandSource` into `src/main.ts`. The user reports a hand-tracking model is being developed; its actual adapter must land and be tested on GX10. Sandbox hand interaction is separate integration work and not required for the four-problem demo.

---

## 8. Touchscreen controller and camera workflow

The 7-inch touchscreen is the menu, while the ASUS portable monitor shows the simulation. Both views run on the GX10 and share state.

### Required flow

1. Show a large **Take a picture** button and camera readiness state.
2. Enter capture mode, pause hand interaction and show a preview so the visitor can frame the printed problem.
3. Capture a still from the webcam. Offer retake and submit it to the local extraction API.
4. Show a clear loading state while the model runs; prevent duplicate captures from repeatedly loading scenes.
5. On a valid supported result, load its simulation on the ASUS display and show success on the controller.
6. Remove the page, return the webcam to hand interaction and require hand reacquisition.
7. On unreadable, unsupported or failed input, offer retake or a manual choice among the four types.

The exact preview/confirmation layout may change during implementation. The required behavior is touch-triggered webcam capture followed by the corresponding simulation on the other screen.

### Hardware acceptance

- Both monitors work simultaneously as an extended desktop.
- Touches map only to the 7-inch screen, with correct rotation and edge alignment.
- The camera can read the actual printed problems and see the hand in the interaction area.
- Switching capture/interaction modes does not create competing camera owners or leave a grabbed object stuck.
- The controller and simulation remain in sync after retry, reset or window reload.

`gx10/serial_bridge.py` is a legacy utility from the previous sensor plan. Do not launch it for this demo. No ESP32, ToF sensor, BNO055, firmware, wiring or soldering task remains in the active scope.

---

## 9. The GX10

The ASUS Ascent GX10 is the host for **all models**, the web app and the simulation. Photo extraction runs through local Ollama; the webcam hand tracker also runs on this machine. A live explanation model is optional future work, not a requirement for the pivot.

### Display and peripheral layout

- **ASUS portable monitor:** simulation, equations and graphs. Earlier inventory called it a ZenScreen; the user called it a Zenbook portable monitor. Confirm the exact model/ports before choosing cables.
- **7-inch touchscreen:** capture menu and status. It needs working video, power and touch data connections appropriate to its actual ports.
- **USB webcam:** shared between printed-problem capture and hand interaction.
- **Keyboard and mouse:** setup and recovery.

Connect both displays to the GX10 as an extended desktop. The exact simultaneous video-output/adapter arrangement is not verified. Confirm it physically rather than assuming a USB-C cable or hub carries video. Map touch input to the small display and place each app view on its intended monitor.

Laptops remain development machines. The target demo must not depend on a laptop or hosted inference. Existing hosted API support remains in code as a development contingency; leave `OPENAI_API_KEY` unset when verifying the all-local demo.

### Setup already reported by Claude

SSH, Node 22, Chromium, no-sleep configuration, Ollama with resident models and the repository at `~/hackMIT26` are configured. See `gx10/README.md` for access and commands. Old setup also installed serial dependencies; their presence does not make sensors a requirement.

| Model | Role | Recorded hardware result |
|---|---|---|
| `qwen3.8` | Photo to spec | About 28 seconds on the tested synthetic problem image, with correct local output |
| `qwen3-vl:8b` | Candidate faster extraction | Pull initiated; completion, accuracy and speed need verification |
| `nemotron-3.5-lightning` | Optional later explanations | Recorded 67 tokens/s and 0.9 s warm sentence; explanation feature not integrated |

`server/index.ts` uses Ollama's OpenAI-compatible `/v1` endpoint. The configured local timeout is 45 seconds. Keep loading/retry UI responsive; test all four real printed samples rather than treating one synthetic-image success as full acceptance.

### Still to verify on the box

- Camera access and tracking performance while local extraction runs.
- Both displays and touch mapping together.
- Controller-to-simulation synchronization and camera mode switching.
- A complete run with no hosted API key and with required model assets already available locally.

---

## 10. Hardware checklist

### Required for the active demo

| Item | Role | Status / next action |
|---|---|---|
| ASUS Ascent GX10 and supply | Runs all models and app | Claude has configured the box |
| ASUS portable monitor and cables | Simulation display | User confirms target display; verify exact model, inputs and power |
| 7-inch touchscreen and cables | Capture/menu controller | In hand; verify video, power and touch data |
| Logitech C270 USB webcam | Photo capture and hand tracking | Previously inventoried; connect and test both uses |
| Wired keyboard and mouse | Setup / recovery | In hand |
| Suitable display adapters and USB cables | Connect both screens and camera | Confirm against actual ports; dual-display route unverified |
| Stand/clamp and cable restraint | Stable camera and display placement | Assemble and mark a repeatable page/hand position |

### Set aside from earlier inventory

VL53L1X packages, BNO055, ESP32/UNO Q, breadboards, jumper wires, WAGOs, servos, buzzers, vibration motors and soldering tools are not required. Do not spend demo time acquiring or wiring them.

### Documents

`HackMIT_2026_Hardware_Checkout.docx` is the team's updated setup checklist. `HackMIT 2026 Hardware List.pdf` is the organizer's original inventory catalog; keep it unchanged as a reference, not a list of project requirements.

---

## 11. Scope and acceptance

### First working milestone

GX10 runs the webcam tracker and one simulation on the ASUS display. A visitor can grab and release an object reliably; losing tracking does not fling it unexpectedly. Keep mouse controls available for development and recovery.

### Initial complete demo

The 7-inch touchscreen offers Take a picture. The webcam captures a printed problem, local GX10 inference produces a valid spec for one of the four types, and the ASUS monitor loads the corresponding simulation. The visitor then interacts using webcam-tracked hands. Show clear loading, retake and error states.

### Required verification

Test one real printed example of each type; exercise capture-to-hand switching, retries, tracking loss, touch alignment and both displays after restart. Record local backend provenance. Check tracking responsiveness during extraction and confirm models/assets are available without downloading during the presentation.

### Deferred

Depth sensing, sensor fusion, IMUs, ESP32 firmware, serial integration, haptics, physical actuators, mandatory 3D rendering and live explanation chat. Extra engine types and sandbox remain existing capabilities outside the initial demo scope.

---

## 12. Failure ladder

1. Full demo: touchscreen capture -> local GX10 extraction -> ASUS simulation -> webcam hand interaction.
2. Unreadable photo or extraction failure: retake, or manually select one of four prepared problems on GX10.
3. Tracking unavailable: keep the current simulation and use mouse/touch controls for recovery; clearly identify that hand interaction is unavailable.
4. Two-display setup fails: use a combined controller/simulation view on one working display for recovery; this does not satisfy final two-display acceptance.
5. GX10 unavailable: use a recorded demo as presentation backup. Laptop/hosted execution would be an explicitly different deployment, not proof of the agreed all-local design.

---

## 13. Roles

| Person | Owns |
|---|---|
| CV / interaction | MediaPipe, hand-to-physics coupling, grab and release gesture states |
| Physics / render | Matter.js sims, four demo problem types, ASUS display, overlays |
| Model pipeline | Local GX10 extraction, validation, loading/errors, integration with existing derivations |
| Rig / pitch (Davide) | Two displays, touch mapping, camera mounting and lighting, table setup, demo video, pitch, submission |

The fourth role is not the lesser role. At a three-minute expo slot, whoever owns the story and the physical setup is doing load-bearing work.

---

## 14. Timeline

Clock times follow the 2025 schedule; confirm at opening ceremony.

| When | What |
|---|---|
| Hour 0–1 | Freeze scope. Write the JSON spec. Agree interfaces. |
| Next checkpoint | Webcam hand interacts with one simulation on the ASUS display, running on GX10. |
| Hour 12 | From here, `main` always demos. No exceptions. |
| Hour 12–18 | Sleep in shifts, two and two. Non-negotiable. |
| Sat night | Two strangers try it. Film their reaction. Feeds the Learning and Collaboration third of the rubric. |
| Before freeze | Touchscreen capture loads all four problem types; test both displays and hand reacquisition. |
| Hour 18 | **Feature freeze.** Record the 90-second demo video as insurance. |
| Hour 20–23 | Rehearse the pitch five times out loud. Set up the table. Test under actual room lights. |
| Sun ~11:15 | Submit, 30 min early. Submission systems fall over at the deadline. |
| Sun 11:45 | Hacking ends. |
| Sun PM | Expo judging, two phases. Panel judging if we advance. Closing ~6:00 PM. |

---

## 15. The three-minute pitch

1. **Open with the hand, not a slide.** Push the ball, let the judge watch the vector follow your palm. Ten seconds, no narration.
2. **Name the problem.** Students read a static diagram and have to run the simulation in their heads. That is where intro mechanics loses people.
3. **Show photo to sim.** Tap Take a picture on the 7-inch menu, capture a printed problem, then point to the simulation and derivation on the ASUS display.
4. **Hand the judge the controls.** Let them grab and release the projectile and watch its motion and graphs. A judge who touches it remembers it.
5. **Name LivePhys yourself**, explain what the hand adds, and close on what's next.

Rehearse this. Five times, out loud, to a person. The pitch is a deliverable, not an afterthought.

---

## 16. Submission targets

**Primary track:** Education.

**Challenges:** pick two or three we satisfy naturally rather than spreading across a dozen sponsor prizes.

- Most Creative — strong fit
- Best UX — strong fit
- ASUS "Build What's Next" — real, because inference genuinely runs on the GX10
- Hardware awards are not a reason to restore sensors; describe the GX10, webcam and two-display interaction accurately, and verify current eligibility separately.

Do not add a sponsor dependency purely to qualify for a prize. Judges can tell, and it is how good projects die at 4 AM.

---

## 17. Honor code

HackMIT operates on an honor code. No project work before hacking starts, and any borrowed code must be disclosed. Teams have been disqualified in the past both for presenting others' demo material as their own and for resubmitting a project from a previous hackathon.

Practically: list MediaPipe, Matter.js, three.js, KaTeX and the actual hand-tracking model in the README with versions. Cite LivePhys in the submission. Being explicit costs nothing and protects us.

---

## 18. Open questions

- Exact ASUS portable monitor model and its input/power ports; simultaneous display wiring and adapters on GX10.
- Final webcam placement for readable pages and comfortable hand interaction with the same camera.
- Hand-tracking implementation location, runtime and measured GX10 performance; MediaPipe remains the documented integration target until the actual model is confirmed.
- Controller/display view routes and shared-state mechanism; these are not implemented by this docs update.
- Confirm current event deadlines and challenge eligibility; older schedule/prize notes above are provisional.

---

## 19. Sources

- hackmit.org — 2026 dates and scale
- dayof.hackmit.org — 2025 tracks, challenges, prizes, schedule, FAQ
- hack-mit-2023.devpost.com — published judging rubric (originality/impact, technology, learning/collaboration, equal weight)
- thetech.com, 2014 — honor code and past disqualifications
- arXiv:2607.20990 — LivePhys
- developers.google.com — MediaPipe HandLandmarker for web
