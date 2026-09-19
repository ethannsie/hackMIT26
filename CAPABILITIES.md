# System Capabilities

What this system can simulate, what it refuses, and how accurate it is.

Everything in the accuracy column is measured by `npm run verify`, which runs
the engine against independent closed-form solutions. It is not an estimate.

---

## The pipeline

```
photo ──► compress ──► extract ──► validate ──► simulate ──► derive
         1024px JPEG   strict JSON  physical    fixed-step   KaTeX, live
                                    sanity      Matter.js
                                       │
                                       └── low confidence or missing field
                                           ──► manual picker + sliders
```

Three ways in, all producing the same `ProblemSpec`:

1. **Photograph a problem.** Compressed in-browser, extracted by a vision model
   under a strict JSON schema at temperature 0.
2. **Pick a type and drag sliders.** No model, no network, no API key. This is a
   complete demo on its own.
3. **Hand-written spec.** Any `ProblemSpec` JSON drives the sim directly.

---

## Problem types

Nine types. Four are the standard intro-mechanics workhorses. Five were chosen
because they are *notoriously hard to visualize* — in each one the interesting
vector points somewhere nothing is moving, which is exactly what a static
textbook diagram cannot show.

### The standard four

#### `projectile`
| | |
|---|---|
| **Reads** | `v0_ms`, `launch_angle_deg`, `h0_m`, `gravity_ms2` |
| **Solves** | time of flight, range, apex height |
| **Hand** | grab and throw — launch velocity is the measured palm velocity |
| **Accuracy** | 0.28% on time of flight and range, 0.58% on apex |
| **Requires** | `v0_ms` and `launch_angle_deg` |

Drag-free ballistics, so the closed form is exact and the sim matches it.

#### `inclined_plane`
| | |
|---|---|
| **Reads** | `incline_angle_deg`, `mass_kg`, `mu_kinetic`, `ramp_length_m`, `initial_velocity_ms`, `body_motion` |
| **Solves** | acceleration, normal force, time to bottom, final velocity |
| **Hand** | push the block along the ramp |
| **Accuracy** | 0.00% sliding, 0.27% rolling |
| **Requires** | `incline_angle_deg` |

Covers sliding and rolling-without-slipping (`body_motion`), frictionless
through to friction-wins. Verified that μ = 0.6 at 25° leaves the block at rest,
and that a rolling sphere accelerates at 5/7 of the sliding value.

#### `pendulum`
| | |
|---|---|
| **Reads** | `length_m`, `theta0_deg`, `mass_kg` |
| **Solves** | period, angular frequency, max speed |
| **Hand** | pull the bob aside and release |
| **Accuracy** | 0.11% on period |
| **Requires** | `length_m` |

Runs well past the small-angle regime. Above 20° the panel states by how much
the small-angle approximation overpredicts peak speed, and shows both the exact
energy result and the approximation side by side.

#### `collision_1d`
| | |
|---|---|
| **Reads** | `m1_kg`, `m2_kg`, `v1_ms`, `v2_ms`, `restitution` |
| **Solves** | both final velocities, kinetic energy lost |
| **Hand** | push one cart into the other |
| **Accuracy** | 0.00% across elastic, partial and inelastic |
| **Requires** | `m1_kg` and `m2_kg` |

Any restitution from 1 to 0, equal or unequal masses, same-direction or head-on.
Momentum conservation is checked independently in every case.

---

### The hard-to-picture five

Each of these targets a specific, documented place where a student's mental
simulation fails. The derivation panel names the misconception directly.

#### `rolling_without_slipping`
| | |
|---|---|
| **Reads** | `radius_m`, `mass_kg`, `v0_ms`, `body_shape` |
| **Solves** | angular velocity, contact point speed, top point speed, rotational KE fraction |
| **Shows** | contact point marked `v = 0`; top point arrowed at `2v` |
| **Accuracy** | 0.00% on all three |
| **Requires** | `radius_m` |

> **The difficulty:** the wheel is moving, yet the point touching the ground has
> zero velocity, while the top moves at twice the axle speed — all on one rigid
> body at one instant. This is why static friction can act on a rolling wheel
> without doing any work.

`body_shape` (`disc`, `sphere`, `hoop`, `point`) sets the moment of inertia, so
the rotational energy fraction changes with it — which is the reason a hoop
loses a race to a disc, and a disc to a sphere.

#### `circular_motion`
| | |
|---|---|
| **Reads** | `radius_m`, `v0_ms`, `mass_kg` |
| **Solves** | centripetal acceleration, centripetal force, period, angular frequency |
| **Shows** | acceleration arrow into the centre, velocity along the tangent, centre labelled |
| **Accuracy** | radius held to 0.00%, speed constant to 0.00% over a full orbit |
| **Requires** | `radius_m` |

> **The difficulty:** the acceleration points at the centre, where nothing is
> moving and no object sits. Speed is constant while velocity never is. There is
> no outward force — what feels like one is inertia continuing straight while a
> constraint pulls you off that line.

#### `charged_particle_magnetic`
| | |
|---|---|
| **Reads** | `charge_c`, `b_field_tesla`, `mass_kg`, `v0_ms`, `launch_angle_deg` |
| **Solves** | orbit radius, cyclotron period, cyclotron frequency, work done |
| **Shows** | `F = qv × B` arrow perpendicular to motion; field as out-of-page dots or into-page crosses |
| **Accuracy** | radius 0.00%, period 0.13%, speed drift 0.000% |
| **Requires** | `b_field_tesla` and a non-zero `charge_c` |

> **The difficulty:** the force is perpendicular to both the velocity and the
> field, so it points somewhere neither of them is heading. It does zero work —
> a magnetic field can change where a particle goes but never how fast.

Two demonstrations worth driving with the sliders:

- **Speed does not change.** The kinetic energy readout is flat no matter how
  long it runs. Verified to 0.000% drift.
- **The period does not depend on speed.** Quadruple the speed: the radius
  quadruples, the period does not move. Verified at 0.13%. That independence is
  the principle a cyclotron is built on.

Charge and field both run through zero to negative. Flipping either reverses the
orbit, which is the fastest way to feel what a cross product does.

#### `rotating_frame`
| | |
|---|---|
| **Reads** | `omega_rads`, `v0_ms`, `launch_angle_deg`, `mass_kg`, `radius_m` |
| **Solves** | Coriolis acceleration, centrifugal acceleration, apparent outward force |
| **Shows** | two arrows at once — Coriolis (∝ velocity) and centrifugal (∝ position) |
| **Accuracy** | 0.00% on both magnitudes; ω = 0 gives an exactly straight path |
| **Requires** | `omega_rads` |

> **The difficulty:** in the inertial frame the particle travels in a perfectly
> straight line with no force on it at all. In the rotating frame it curves.
> Both descriptions are correct. Neither pseudo-force has a third-law partner,
> because nothing is pushing.

Setting ω = 0 is the built-in control: the deflection vanishes entirely, which
makes it obvious the curve was the frame and not a force.

#### `angular_momentum_point`
| | |
|---|---|
| **Reads** | `mass_kg`, `v0_ms`, `impact_parameter_m` |
| **Solves** | angular momentum about the origin, torque, areal velocity |
| **Shows** | the `r` vector and the area it sweeps, filled live |
| **Accuracy** | L exact to 0.00%, constant to machine precision over 5 s |
| **Requires** | `impact_parameter_m` |

> **The difficulty:** a particle moving in a straight line, never rotating around
> anything, has non-zero and perfectly constant angular momentum about an
> off-axis point. Nothing is spinning.

Drag the impact parameter to zero and L collapses to zero — same motion,
different origin. Angular momentum is a statement about a point you choose, not
a property the particle carries. The swept-area overlay is Kepler's second law
with the gravity removed: equal areas in equal times is just L conservation.

---

## Solvable quantities

28 in total, drawn from the `Askable` enum. A problem asking for something
outside this list gets an empty `asked_for` rather than a near-miss
substitution, and the panel falls back to showing everything that type solves.

`acceleration_ms2` · `time_to_bottom_s` · `final_velocity_ms` ·
`time_of_flight_s` · `range_m` · `apex_height_m` · `period_s` ·
`angular_frequency_rads` · `max_speed_ms` · `normal_force_n` ·
`v1_final_ms` · `v2_final_ms` · `kinetic_energy_lost_j` ·
`contact_point_speed_ms` · `top_point_speed_ms` · `rotational_ke_fraction` ·
`centripetal_acceleration_ms2` · `centripetal_force_n` · `orbit_radius_m` ·
`cyclotron_period_s` · `cyclotron_frequency_rads` · `work_done_j` ·
`coriolis_acceleration_ms2` · `centrifugal_acceleration_ms2` ·
`angular_momentum_kgm2s` · `areal_velocity_m2s` · `torque_nm`

`tension_n` is declared but not yet produced by any solver — see Known gaps.

---

## Interaction

| Gesture | Effect |
|---|---|
| Hover in front of the sim plane | free-look, no contact |
| Push through the plane | force `F = clamp(k · penetration, 0, 60 N)` |
| Pinch near a pushable body | grab (hysteresis at 0.7 / 0.5 so it cannot flicker) |
| Release | throw at the measured palm velocity |
| Drag a slider | rebuild the sim and re-derive the algebra live |

Only bodies marked `interactable` can be pushed. Ramps, ground, walls and pivots
are forced to `interactable: false` during validation, so a model hallucinating
a pushable ramp cannot reach the simulation.

Hand input arrives as `HandFrame` from any `HandSource`. A mouse-driven mock
ships today; MediaPipe drops into the same interface without the sim changing.

---

## Accuracy and determinism

**39 checks, all passing.** Worst case across the entire library is 0.58%.

The sim is deterministic: physics only advances through a fixed 8.333 ms step
and never reads a frame delta. Verified two ways — two worlds from the same spec
are bit-identical after 1500 steps, and stepping 700 + 800 matches stepping 1500
in one go. A dropped frame cannot change a trajectory.

### Where Matter.js is not used as-is

Four places where the stock engine was measurably wrong, and what replaced it:

| Case | Matter alone | Replaced with | Result |
|---|---|---|---|
| Incline friction | μ = 0.05 pins the block (a = 0.008 vs 3.701) | explicit Coulomb force | exact |
| Collision, e → 1 | 0.375 / 1.625 instead of 0 / 2 | closed-form impulse | exact |
| Magnetic orbit | explicit Euler on a rotation: speed +2175%, orbit 23× | Boris-style velocity rotation | 0.000% drift |
| Uniform circular | constraint solver leaks 38% of speed per orbit | radius and tangent re-imposed each step | 0.00% |

Matter still handles all geometry, contact detection and every hand-driven
interaction. These four are cases where its approximations would have put wrong
physics in front of a student reading the derivation panel beside the animation.

---

## What it will not do

**Not in the library:** Atwood machines, spring-mass oscillators, 2D collisions,
rigid-body torque and angular acceleration, orbital mechanics, buoyancy, fluids,
thermodynamics, electric fields, circuits, optics, anything relativistic or
quantum.

**Photograph one of those** and the model picks the nearest of the nine with low
confidence. Below 0.6 that opens the manual picker rather than building
something plausible-looking and wrong. This is the intended behaviour and it is
what the extraction prompt is most carefully tuned for.

**Also out of scope by construction:**

- **Diagrams.** It reads stated numbers, not figures. A problem whose data is
  only in a picture will not extract.
- **Multi-part problems.** It takes the first complete one and lowers confidence.
- **Symbolic answers.** Every quantity resolves to a number.
- **3D motion.** The solver is planar. Every type here is genuinely planar, so
  nothing is lost — but gyroscopic precession, which belongs on this list
  thematically, cannot be done without a 3D solver.

**Guardrails.** Values outside plausible ranges are clamped, never silently: a
negative mass is dropped, μ above 2 is clamped, a ramp past 89° is clamped, and
**every repair is printed in the derivation panel.** If a number on screen is not
the student's, the system says so.

---

## Known gaps

- `tension_n` is in the `Askable` enum but no solver produces it — a leftover
  from sketching Atwood. Degrades gracefully (falls back to all solutions for
  that type) but should either be implemented or removed.
- The ramp-tilt gesture is specified but not yet wired to hand orientation;
  the ramp angle is slider-driven today.
- The renderer is 2D canvas. The three.js scene with the articulated hand is
  the tracking side's surface and is not in this half yet.
- Rotating-frame accuracy is verified over 400 steps. The centrifugal term grows
  with radius, so very long runs will drift — physically correct, but the
  comparison against a closed form stops being meaningful once the particle is
  far from the axis.

---

## Adding a tenth type

The pattern is fixed and takes well under an hour:

1. Add the name to `PROBLEM_TYPES` and any new fields to `SpecGiven`
   ([src/spec/types.ts](src/spec/types.ts)).
2. Add those fields to `GIVEN_NUMBER_KEYS` ([src/spec/schema.ts](src/spec/schema.ts))
   and give each a range plus a `REQUIRED_BY_TYPE` entry
   ([src/spec/validate.ts](src/spec/validate.ts)).
3. Add a params case ([src/sim/params.ts](src/sim/params.ts)), a closed-form
   solver ([src/sim/analytic.ts](src/sim/analytic.ts)) and a builder
   ([src/sim/builders.ts](src/sim/builders.ts)).
4. Add a preset and sliders ([src/presets.ts](src/presets.ts)) and a prompt rule
   ([server/prompt.ts](server/prompt.ts)).
5. **Add a verify case.** Not optional — steps 1 to 4 will compile and animate
   something wrong without it.

TypeScript's exhaustive switches will name every file you still have to touch.
