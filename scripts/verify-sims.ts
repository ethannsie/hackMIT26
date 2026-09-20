/**
 * Checks the Matter.js engine against the closed forms in src/sim/analytic.ts.
 *
 * A simulation that merely looks plausible is worthless for teaching: a judge
 * or a student will read the derivation panel and the animation side by side.
 * If they disagree, we are showing someone wrong physics. This script is how we
 * find that out at hour 3 instead of at the expo table.
 *
 * Run: npm run verify
 */
import { SimWorld } from '../src/sim/world.ts'
import { solve } from '../src/sim/analytic.ts'
import { toParams } from '../src/sim/params.ts'
import { FIXED_DT_S } from '../src/sim/units.ts'
import { Timeline } from '../src/render/timeline.ts'
import type { ProblemSpec, SpecGiven, ProblemType } from '../src/spec/types.ts'

const EMPTY_GIVEN: SpecGiven = {
  gravity_ms2: 9.81,
  v0_ms: null,
  launch_angle_deg: null,
  h0_m: null,
  incline_angle_deg: null,
  ramp_length_m: null,
  mass_kg: null,
  mu_kinetic: null,
  initial_velocity_ms: null,
  body_motion: null,
  length_m: null,
  theta0_deg: null,
  m1_kg: null,
  m2_kg: null,
  v1_ms: null,
  v2_ms: null,
  restitution: null,
  radius_m: null,
  body_shape: null,
  charge_c: null,
  b_field_tesla: null,
  omega_rads: null,
  impact_parameter_m: null,
}

function spec(problem_type: ProblemType, given: Partial<SpecGiven>): ProblemSpec {
  return {
    problem_type,
    confidence: 1,
    given: { ...EMPTY_GIVEN, ...given },
    objects: [],
    asked_for: [],
    raw_text: 'verification fixture',
  }
}

let failures = 0

function check(name: string, actual: number, expected: number, tolPct: number, note = ''): void {
  const err = expected === 0 ? Math.abs(actual) : Math.abs((actual - expected) / expected) * 100
  const pass = err <= tolPct
  if (!pass) failures++
  const mark = pass ? 'PASS' : 'FAIL'
  console.log(
    `  [${mark}] ${name.padEnd(34)} sim=${actual.toFixed(4).padStart(10)}  ` +
      `analytic=${expected.toFixed(4).padStart(10)}  err=${err.toFixed(2).padStart(6)}%  (tol ${tolPct}%)` +
      (note ? `  ${note}` : ''),
  )
}

function answer(s: ProblemSpec, quantity: string): number {
  const found = solve(toParams(s)).find((x) => x.quantity === quantity)
  if (!found) throw new Error(`no analytic solution for ${quantity}`)
  return found.value
}

// ---------------------------------------------------------------------------
console.log('\nPROJECTILE  v0 = 20 m/s, theta = 45 deg, h0 = 0')
{
  const s = spec('projectile', { v0_ms: 20, launch_angle_deg: 45, h0_m: 0 })
  const w = new SimWorld(s)
  const start = w.state().focus.position_m
  let apex = start[1]
  let landedAt = -1

  for (let i = 0; i < 20_000; i++) {
    w.step()
    const st = w.state().focus
    apex = Math.max(apex, st.position_m[1])
    // Ball radius is 0.06 m, so "landed" is its centre back at launch height.
    if (st.velocity_ms[1] < 0 && st.position_m[1] <= start[1]) {
      landedAt = w.time_s
      break
    }
  }

  const range = w.state().focus.position_m[0] - start[0]
  check('time of flight (s)', landedAt, answer(s, 'time_of_flight_s'), 2)
  check('range (m)', range, answer(s, 'range_m'), 2)
  check('apex height (m)', apex - start[1], answer(s, 'apex_height_m'), 3)
}

// ---------------------------------------------------------------------------
console.log('\nINCLINED PLANE  theta = 25 deg, mu = 0.15, m = 2 kg, L = 1.2 m')
{
  const s = spec('inclined_plane', {
    incline_angle_deg: 25,
    mu_kinetic: 0.15,
    mass_kg: 2,
    ramp_length_m: 1.2,
    body_motion: 'sliding',
  })
  const w = new SimWorld(s)

  // Let contact settle, then measure acceleration along the ramp over a window.
  w.stepMany(30)
  const v0 = w.state().bodies['block']!.speed_ms
  const t0 = w.time_s
  w.stepMany(60)
  const v1 = w.state().bodies['block']!.speed_ms
  const aMeasured = (v1 - v0) / (w.time_s - t0)

  check('acceleration along ramp (m/s²)', aMeasured, answer(s, 'acceleration_ms2'), 1)
}

// ---------------------------------------------------------------------------
console.log('\nINCLINED PLANE  rolling sphere, theta = 25 deg — expect 5/7 of the sliding value')
{
  const s = spec('inclined_plane', {
    incline_angle_deg: 25,
    mu_kinetic: 0,
    mass_kg: 2,
    ramp_length_m: 6,
    body_motion: 'rolling',
  })
  const w = new SimWorld(s)
  w.stepMany(40)
  const v0 = w.state().bodies['block']!.speed_ms
  const t0 = w.time_s
  w.stepMany(80)
  const v1 = w.state().bodies['block']!.speed_ms
  const aMeasured = (v1 - v0) / (w.time_s - t0)

  check('rolling acceleration (m/s²)', aMeasured, answer(s, 'acceleration_ms2'), 1)
  const sliding = 9.81 * Math.sin(25 * Math.PI / 180)
  check('ratio to sliding value', aMeasured / sliding, 5 / 7, 1, '(the 71% that goes into rotation)')
}

// ---------------------------------------------------------------------------
console.log('\nINCLINED PLANE  time to the bottom and final speed, against the panel')
{
  // The derivation solves for the full stated L, so the block must start at
  // the top of that L, not a little way down it. It used to start 8 % down,
  // which made the sim ~7 % faster than the algebra beside it.
  const s = spec('inclined_plane', {
    incline_angle_deg: 25, mu_kinetic: 0.15, mass_kg: 2, ramp_length_m: 1.2, body_motion: 'sliding',
  })
  const w = new SimWorld(s)
  // The run ends when the block meets the floor at the ramp's foot: speed
  // peaks there and drops as the floor takes the vertical component.
  let t = -1
  let vf = 0
  for (let i = 0; i < 180; i++) { // 1.5 s, well past the 0.92 s the algebra gives
    w.step()
    const b = w.state().bodies['block']!
    if (b.speed_ms > vf) {
      vf = b.speed_ms
      t = w.time_s
    }
  }
  check('time to bottom (s)', t, answer(s, 'time_to_bottom_s'), 2)
  check('speed at the bottom (m/s)', vf, answer(s, 'final_velocity_ms'), 2)
}

// ---------------------------------------------------------------------------
console.log('\nINCLINED PLANE  mu = 0.6 at 25 deg — friction wins, block must not move')
{
  const s = spec('inclined_plane', {
    incline_angle_deg: 25, mu_kinetic: 0.6, mass_kg: 2, ramp_length_m: 1.2, body_motion: 'sliding',
  })
  const w = new SimWorld(s)
  w.stepMany(600)
  const moved = Math.abs(w.state().bodies['block']!.speed_ms)
  const pass = moved < 0.02
  if (!pass) failures++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] block stays at rest (tan 25° = 0.466 < mu = 0.6), speed = ${moved.toFixed(4)} m/s`)
}

// ---------------------------------------------------------------------------
console.log('\nPENDULUM  L = 1.0 m, theta0 = 10 deg (small angle)')
{
  const s = spec('pendulum', { length_m: 1.0, theta0_deg: 10, mass_kg: 1 })
  const w = new SimWorld(s)

  // Period from successive crossings of x = 0 moving the same direction.
  const crossings: number[] = []
  let prevX = w.state().bodies['bob']!.position_m[0]
  for (let i = 0; i < 100_000 && crossings.length < 3; i++) {
    w.step()
    const x = w.state().bodies['bob']!.position_m[0]
    if (prevX > 0 && x <= 0) crossings.push(w.time_s)
    prevX = x
  }

  if (crossings.length >= 2) {
    const measured = crossings[1]! - crossings[0]!
    check('period (s)', measured, answer(s, 'period_s'), 1)
  } else {
    failures++
    console.log('  [FAIL] pendulum never completed two swings')
  }
}

// ---------------------------------------------------------------------------
console.log('\nPENDULUM  amplitude must not decay — nothing in this scene damps it')
for (const theta0 of [10, 40]) {
  const s = spec('pendulum', { length_m: 1.2, theta0_deg: theta0, mass_kg: 1 })
  const w = new SimWorld(s)
  const pivotY = w.bodyById('pivot')!.position.y

  // Peak angle reached in the final 10 s of a 30 s run.
  let latePeak = 0
  for (let i = 0; i < 3600; i++) {
    w.step()
    if (i < 2400) continue
    const bob = w.bodyById('bob')!
    const ang = Math.atan2(bob.position.x, bob.position.y - pivotY) * (180 / Math.PI)
    latePeak = Math.max(latePeak, Math.abs(ang))
  }
  check(`amplitude after 30 s, released ${theta0}° (°)`, latePeak, theta0, 2, '(undamped: must not decay)')
}

// ---------------------------------------------------------------------------
console.log('\n1D COLLISION  m1 = 1 kg @ 2 m/s into m2 = 1 kg at rest, e = 1 (elastic)')
{
  const s = spec('collision_1d', { m1_kg: 1, m2_kg: 1, v1_ms: 2, v2_ms: 0, restitution: 1 })
  const w = new SimWorld(s)

  // Run until well after contact, then read both velocities.
  for (let i = 0; i < 20_000; i++) {
    w.step()
    if (w.state().bodies['cart2']!.velocity_ms[0] > 0.01) break
  }
  w.stepMany(30)

  const st = w.state()
  check('cart1 final velocity (m/s)', st.bodies['cart1']!.velocity_ms[0], answer(s, 'v1_final_ms'), 1)
  check('cart2 final velocity (m/s)', st.bodies['cart2']!.velocity_ms[0], answer(s, 'v2_final_ms'), 1)
}

// ---------------------------------------------------------------------------
console.log('\n1D COLLISION  unequal masses and partial restitution')
for (const c of [
  { m1_kg: 3, m2_kg: 1, v1_ms: 2, v2_ms: 0, restitution: 1, label: '3 kg into 1 kg, e = 1' },
  { m1_kg: 1, m2_kg: 2, v1_ms: 3, v2_ms: -1, restitution: 0.5, label: 'head-on, e = 0.5' },
  { m1_kg: 2, m2_kg: 2, v1_ms: 4, v2_ms: 0, restitution: 0, label: 'perfectly inelastic, e = 0' },
]) {
  const { label, ...given } = c
  const s = spec('collision_1d', given)
  const w = new SimWorld(s)
  for (let i = 0; i < 20_000; i++) {
    w.step()
    if (Math.abs(w.state().bodies['cart2']!.velocity_ms[0] - given.v2_ms) > 0.01) break
  }
  w.stepMany(30)
  const st = w.state()
  console.log(`  ${label}`)
  check('  cart1 final (m/s)', st.bodies['cart1']!.velocity_ms[0], answer(s, 'v1_final_ms'), 2)
  check('  cart2 final (m/s)', st.bodies['cart2']!.velocity_ms[0], answer(s, 'v2_final_ms'), 2)

  // Momentum is conserved in every collision, elastic or not. Check it directly.
  const pBefore = given.m1_kg * given.v1_ms + given.m2_kg * given.v2_ms
  const pAfter =
    given.m1_kg * st.bodies['cart1']!.velocity_ms[0] + given.m2_kg * st.bodies['cart2']!.velocity_ms[0]
  check('  momentum conserved (kg·m/s)', pAfter, pBefore, 2)
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
console.log('\nROLLING WITHOUT SLIPPING  disc, r = 0.3 m, v = 2 m/s')
{
  const s = spec('rolling_without_slipping', { radius_m: 0.3, mass_kg: 2, v0_ms: 2, body_shape: 'disc' })
  const w = new SimWorld(s)
  w.stepMany(60)
  const st = w.state().bodies['wheel']!

  const omega = st.angular_velocity_rads
  check('angular velocity (rad/s)', Math.abs(omega), answer(s, 'angular_frequency_rads'), 1)

  // The claim worth testing: the contact point is stationary while the top
  // point moves at 2v, on the same rigid body at the same instant.
  const v = st.velocity_ms[0]
  const r = 0.3
  const contact = v - Math.abs(omega) * r
  const top = v + Math.abs(omega) * r
  check('contact point speed (m/s)', contact, 0, 1)
  check('top point speed (m/s)', top, 2 * v, 1)
}

// ---------------------------------------------------------------------------
console.log('\nUNIFORM CIRCULAR MOTION  r = 0.8 m, v = 2.5 m/s')
{
  const s = spec('circular_motion', { radius_m: 0.8, v0_ms: 2.5, mass_kg: 1.2 })
  const w = new SimWorld(s)

  // Speed must stay constant and the radius must not drift.
  const centre = w.bodyById('pivot')!.position
  let minR = Infinity
  let maxR = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (let i = 0; i < 1200; i++) {
    w.step()
    const b = w.bodyById('ball')!
    const rad = Math.hypot(b.position.x - centre.x, b.position.y - centre.y) / 200
    minR = Math.min(minR, rad)
    maxR = Math.max(maxR, rad)
    const sp = w.state().bodies['ball']!.speed_ms
    minV = Math.min(minV, sp)
    maxV = Math.max(maxV, sp)
  }
  check('orbit radius held (m)', (minR + maxR) / 2, 0.8, 2)
  check('speed held constant (m/s)', (minV + maxV) / 2, 2.5, 2)
  const spread = ((maxV - minV) / 2.5) * 100
  const pass = spread < 2
  if (!pass) failures++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] speed spread over one orbit = ${spread.toFixed(2)}% (tol 2%)`)
}

// ---------------------------------------------------------------------------
console.log('\nCHARGED PARTICLE IN A MAGNETIC FIELD  q = 1 C, B = 1.5 T, m = 1 kg, v = 2 m/s')
{
  const s = spec('charged_particle_magnetic', {
    charge_c: 1, b_field_tesla: 1.5, mass_kg: 1, v0_ms: 2, launch_angle_deg: 0,
  })
  const w = new SimWorld(s)
  const expectedR = answer(s, 'orbit_radius_m')
  const expectedT = answer(s, 'cyclotron_period_s')

  // Track the orbit: its diameter, its period, and whether the speed moves.
  const start = { ...w.bodyById('particle')!.position }
  let maxDist = 0
  let minV = Infinity
  let maxV = -Infinity
  let period = -1
  let left = false

  for (let i = 0; i < 40_000; i++) {
    w.step()
    const b = w.bodyById('particle')!
    const d = Math.hypot(b.position.x - start.x, b.position.y - start.y) / 200
    maxDist = Math.max(maxDist, d)
    const sp = w.state().bodies['particle']!.speed_ms
    minV = Math.min(minV, sp)
    maxV = Math.max(maxV, sp)
    if (d > expectedR) left = true
    if (left && d < 0.02 && period < 0) { period = w.time_s; break }
  }

  check('orbit diameter (m)', maxDist, 2 * expectedR, 2)
  check('cyclotron period (s)', period, expectedT, 2)

  // The headline claim: a magnetic force does no work, so speed never changes.
  const drift = ((maxV - minV) / 2) * 100
  const pass = drift < 1
  if (!pass) failures++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] speed unchanged by the field: drift = ${drift.toFixed(3)}% (tol 1%)`)

  // And the period must not depend on speed. Same field, four times the speed.
  const fast = new SimWorld(spec('charged_particle_magnetic', {
    charge_c: 1, b_field_tesla: 1.5, mass_kg: 1, v0_ms: 8, launch_angle_deg: 0,
  }))
  const fastStart = { ...fast.bodyById('particle')!.position }
  let fastPeriod = -1
  let fastLeft = false
  let fastMax = 0
  for (let i = 0; i < 40_000; i++) {
    fast.step()
    const b = fast.bodyById('particle')!
    const d = Math.hypot(b.position.x - fastStart.x, b.position.y - fastStart.y) / 200
    fastMax = Math.max(fastMax, d)
    if (d > expectedR * 4) fastLeft = true
    if (fastLeft && d < 0.05 && fastPeriod < 0) { fastPeriod = fast.time_s; break }
  }
  check('period at 4x speed (s)', fastPeriod, expectedT, 3, '(must NOT change with speed)')
  check('radius at 4x speed (m)', fastMax / 2, expectedR * 4, 3, '(must scale with speed)')
}

// ---------------------------------------------------------------------------
console.log('\nROTATING FRAME  a straight inertial line must curve in the rotating frame')
{
  // omega = 0 is the control: with no rotation the pseudo-forces vanish and the
  // path must be exactly straight.
  const straight = new SimWorld(spec('rotating_frame', {
    omega_rads: 0, v0_ms: 1.5, launch_angle_deg: 90, mass_kg: 1, radius_m: 0.5,
  }))
  straight.stepMany(400)
  const sx = straight.state().bodies['particle']!.position_m[0]
  check('omega = 0 leaves x unchanged (m)', sx, 0.5, 1, '(no rotation, no deflection)')

  const s = spec('rotating_frame', { omega_rads: 1.2, v0_ms: 1.5, launch_angle_deg: 90, mass_kg: 1, radius_m: 0.5 })
  const w = new SimWorld(s)
  w.stepMany(400)
  const curved = w.state().bodies['particle']!.position_m[0]
  const deflected = Math.abs(curved - 0.5) > 0.05
  if (!deflected) failures++
  console.log(`  [${deflected ? 'PASS' : 'FAIL'}] omega = 1.2 deflects the path: x moved 0.5 -> ${curved.toFixed(3)} m`)

  check('Coriolis magnitude (m/s²)', 2 * 1.2 * 1.5, answer(s, 'coriolis_acceleration_ms2'), 1)
  check('centrifugal magnitude (m/s²)', 1.2 * 1.2 * 0.5, answer(s, 'centrifugal_acceleration_ms2'), 1)
}

// ---------------------------------------------------------------------------
console.log('\nANGULAR MOMENTUM ABOUT A POINT  straight-line motion, L must be non-zero and constant')
{
  const s = spec('angular_momentum_point', { mass_kg: 2, v0_ms: 1.5, impact_parameter_m: 0.6 })
  const w = new SimWorld(s)
  const expectedL = answer(s, 'angular_momentum_kgm2s')

  // Recompute L = m(r x v) directly from the sim state at intervals. Nothing is
  // rotating, so this is the claim that needs evidence. 2.5 s keeps the
  // particle on its straight line: the scene is walled in, and a bounce off the
  // border reverses v, which is a different (and correct) L.
  const samples: number[] = []
  for (let i = 0; i < 300; i++) {
    w.step()
    if (i % 50 !== 0) continue
    const b = w.state().bodies['particle']!
    const [x, y] = b.position_m
    const [vx, vy] = b.velocity_ms
    samples.push(b.mass_kg * (x * vy - y * vx))
  }
  const spread = Math.max(...samples) - Math.min(...samples)
  check('L from sim state (kg·m²/s)', samples[0]!, expectedL, 1)
  const pass = Math.abs(spread / expectedL) < 0.01
  if (!pass) failures++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] L constant along a straight line: spread = ${spread.toExponential(2)} over 2.5 s`)

  // And L must vanish when the origin sits on the line of motion.
  const onLine = new SimWorld(spec('angular_momentum_point', { mass_kg: 2, v0_ms: 1.5, impact_parameter_m: 0 }))
  onLine.stepMany(300)
  const b = onLine.state().bodies['particle']!
  const L0 = b.mass_kg * (b.position_m[0] * b.velocity_ms[1] - b.position_m[1] * b.velocity_ms[0])
  const zero = Math.abs(L0) < 1e-6
  if (!zero) failures++
  console.log(`  [${zero ? 'PASS' : 'FAIL'}] d = 0 gives L = 0: same motion, different origin, L = ${L0.toExponential(2)}`)
}

console.log('\nCONTAINMENT  nothing leaves the border, however fast it goes or where a hand drags it')
{
  const s = spec('projectile', { v0_ms: 8, launch_angle_deg: 40, h0_m: 0 })
  const w = new SimWorld(s)
  const b = w.bounds
  const inside = (): boolean => {
    const [x, y] = w.state().focus.position_m
    const r = 0.06
    return x >= b.minX_m - r - 1e-6 && x <= b.maxX_m + r + 1e-6 && y >= -r - 1e-6 && y <= b.maxY_m + r + 1e-6
  }
  // Well past what any wall thickness could stop at 120 Hz without help.
  for (const v of [[55, 0], [-55, 10], [30, 55], [40, -55]] as const) {
    w.reset()
    w.setVelocityMs('projectile', [v[0], v[1]])
    let ok_ = true
    for (let i = 0; i < 600; i++) {
      w.step()
      if (!inside()) { ok_ = false; break }
    }
    const st = w.state().focus
    const pass = ok_ && Number.isFinite(st.position_m[0]) && Number.isFinite(st.position_m[1])
    if (!pass) failures++
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] thrown at (${v[0]}, ${v[1]}) m/s stays inside for 5 s  (ends at x=${st.position_m[0].toFixed(2)}, y=${st.position_m[1].toFixed(2)}, |v|=${st.speed_ms.toFixed(1)})`)
  }
  // A grab that tries to carry the ball through the wall lands on the inside face.
  w.reset()
  w.setPositionM('projectile', [b.maxX_m + 5, b.maxY_m + 5])
  const held = w.state().focus.position_m
  const clamped = inside()
  if (!clamped) failures++
  console.log(`  [${clamped ? 'PASS' : 'FAIL'}] grab target outside the border is clamped to (${held[0].toFixed(2)}, ${held[1].toFixed(2)})`)
}

console.log('\nDETERMINISM  identical spec, identical step count, two separate worlds')
{
  const s = spec('projectile', { v0_ms: 13.7, launch_angle_deg: 37, h0_m: 1.5 })
  const a = new SimWorld(s)
  const b = new SimWorld(s)
  a.stepMany(1500)
  b.stepMany(1500)

  const sa = JSON.stringify(a.state().bodies)
  const sb = JSON.stringify(b.state().bodies)
  const identical = sa === sb
  if (!identical) failures++
  console.log(`  [${identical ? 'PASS' : 'FAIL'}] two worlds bit-identical after 1500 steps`)

  // And the same total time reached in uneven batches must match single-stepping.
  const c = new SimWorld(s)
  c.stepMany(700)
  c.stepMany(800)
  const identical2 = JSON.stringify(c.state().bodies) === sa
  if (!identical2) failures++
  console.log(`  [${identical2 ? 'PASS' : 'FAIL'}] batched stepping matches single stepping`)
}

console.log('\nTIMELINE  a render loop at any frame rate must keep recording history')
{
  // The loop only sees the step count at frame boundaries. One odd-sized
  // first frame (a 25 ms frame after a mode switch is three steps) used to
  // leave every later count odd, and a stride check on parity then recorded
  // nothing for the rest of the run: no scrubbing, no paths, no panel graphs.
  for (const [fps, firstMs] of [[60, 25], [60, 30], [30, 33.3], [45, 22.2]] as const) {
    const w = new SimWorld(spec('projectile', { v0_ms: 12, launch_angle_deg: 40, h0_m: 1.5 }))
    const tl = new Timeline()
    const rec = (): void => tl.record(w.steps, w.time_s, {})
    rec()
    w.advanceWith(firstMs, () => [])
    rec()
    for (let i = 0; i < fps * 2; i++) {
      w.advanceWith(1000 / fps, () => [])
      rec()
    }
    // A frame can be kept only where the loop looked, so the most the
    // timeline can hold is one per render frame, or one per two steps.
    const possible = Math.min(fps * 2 + 2, Math.floor(w.steps / 2) + 1)
    const pass = tl.length >= possible * 0.9
    if (!pass) failures++
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${fps} fps, first frame ${firstMs} ms: ${w.steps} steps -> ${tl.length} frames`)
  }
}

console.log(`\nfixed timestep: ${(FIXED_DT_S * 1000).toFixed(3)} ms (${(1 / FIXED_DT_S).toFixed(0)} Hz)`)
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
