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

console.log(`\nfixed timestep: ${(FIXED_DT_S * 1000).toFixed(3)} ms (${(1 / FIXED_DT_S).toFixed(0)} Hz)`)
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
