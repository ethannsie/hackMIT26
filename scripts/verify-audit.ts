import assert from 'node:assert/strict'
import Matter from 'matter-js'
import { PRESETS } from '../src/presets.ts'
import { validateSpec } from '../src/spec/validate.ts'
import { problemStatement, currentGivens } from '../src/spec/describe.ts'
import type { ProblemType, SpecGiven } from '../src/spec/types.ts'
import { SimWorld } from '../src/sim/world.ts'
import { SandboxWorld } from '../src/sandbox/world.ts'
import type { SandboxScene } from '../src/sandbox/types.ts'
import { InvariantTracker } from '../src/sandbox/invariants.ts'
import { solve } from '../src/sim/analytic.ts'
import { toParams, INERTIA_COEFF } from '../src/sim/params.ts'
import { forcesFor } from '../src/sim/fbd.ts'
import { HandCoupling } from '../src/hand/coupling.ts'
import { Timeline } from '../src/render/timeline.ts'
import { voiceStatus } from '../server/voice.ts'
import { validAsk, validHand } from '../server/validation.ts'
const spec = (type: ProblemType, values: Partial<SpecGiven>) => ({ ...PRESETS[type], given: { ...PRESETS[type].given, ...values } })
const near = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`)
const frame = (b: ReturnType<SimWorld['state']>['focus']) => ({ x_m: b.position_m[0], y_m: b.position_m[1], angle_deg: b.angle_deg, vx_ms: b.velocity_ms[0], vy_ms: b.velocity_ms[1], omega_rads: b.angular_velocity_rads })
const answer = (type: ProblemType, values: Partial<SpecGiven>, q: string) => solve(toParams(spec(type, values))).find(s => s.quantity === q)!.value
const empty: SandboxScene = { name: 'audit', gravity_ms2: 0, ground: false, arena: { width_m: 20, height_m: 20, walls: false }, entities: [] }
let checks = 0
function test(name: string, check: () => void) { check(); checks++; console.log(`PASS ${name}`) }

test('Essential missing values fail; conventional defaults require review', () => {
  assert.equal(validateSpec(spec('pendulum', { theta0_deg: null })).ok, false)
  assert.equal(validateSpec(spec('collision_1d', { v1_ms: null })).ok, false)
  const defaults = validateSpec(spec('projectile', { h0_m: null }))
  assert.ok(defaults.ok && defaults.needsConfirmation && defaults.repairs.some(r => r.includes('h0_m')))
  assert.ok(validateSpec({ ...PRESETS.projectile, confidence: 0.2 }).needsConfirmation)
  for (const p of Object.values(PRESETS)) assert.ok(validateSpec(p).ok, p.problem_type)
  const essential: Partial<Record<ProblemType, (keyof SpecGiven)[]>> = {
    projectile: ['v0_ms', 'launch_angle_deg'], inclined_plane: ['ramp_length_m', 'mass_kg', 'initial_velocity_ms', 'mu_kinetic', 'body_motion'],
    pendulum: ['length_m', 'theta0_deg', 'mass_kg'], collision_1d: ['m1_kg', 'm2_kg', 'v1_ms', 'v2_ms', 'restitution'],
    circular_motion: ['radius_m', 'v0_ms', 'mass_kg'], rolling_without_slipping: ['radius_m', 'v0_ms', 'body_shape'],
    charged_particle_magnetic: ['charge_c', 'b_field_tesla', 'mass_kg', 'v0_ms'], rotating_frame: ['omega_rads', 'v0_ms', 'radius_m'], angular_momentum_point: ['mass_kg', 'v0_ms', 'impact_parameter_m'],
  }
  for (const [type, fields] of Object.entries(essential)) for (const key of fields) assert.equal(validateSpec(spec(type as ProblemType, { [key]: null })).ok, false, `${type}.${key}`)
})
test('Overspeed is repaired visibly; excessive gravitational energy is rejected', () => {
  const v = validateSpec(spec('projectile', { v0_ms: 100 }))
  assert.ok(v.ok && v.needsConfirmation)
  assert.equal(v.spec!.given.v0_ms, 40)
  const w = new SimWorld(v.spec!); w.step(); assert.ok(w.state().focus.speed_ms > 39); assert.equal(w.speedLimited.size, 0); w.dispose()
  assert.equal(validateSpec(spec('projectile', { h0_m: 500 })).ok, false)
  assert.equal(validateSpec(spec('circular_motion', { radius_m: 0.001, v0_ms: 40 })).ok, false)
  assert.equal(validateSpec(spec('charged_particle_magnetic', { mass_kg: 0.001 })).ok, false)
  assert.equal(validateSpec(spec('pendulum', { length_m: 0.01, gravity_ms2: 30 })).ok, false)
})
test('Spin round-trips and rolling energy includes rotation', () => {
  const w = new SimWorld(PRESETS.rolling_without_slipping), b = w.state().focus
  w.applyBodyState(b.id, frame(b)); near(w.state().focus.angular_velocity_rads, b.angular_velocity_rads)
  near(b.kinetic_energy_j, 6)
  w.dispose()
})
test('Dragged pendulum continues from its new angle in both worlds', () => {
  const w = new SimWorld(PRESETS.pendulum)
  w.setPositionM('bob', [0.8, 0.7]); w.setVelocityMs('bob', [0, 0])
  const at = w.state().focus.position_m; w.step()
  assert.ok(Math.hypot(w.state().focus.position_m[0] - at[0], w.state().focus.position_m[1] - at[1]) < 0.002)
  near(Math.hypot(at[0], at[1] - 1.3), 1); w.dispose()
  const sw = new SandboxWorld({ ...empty, gravity_ms2: 9.81, entities: [{ id: 'bob', kind: 'pendulum', position_m: [0, 1.3], length_m: 1, start_angle_deg: 15, bob_mass_kg: 1, bob_radius_m: 0.1 }] })
  sw.setPositionM('bob', [0.8, 0.7]); sw.setVelocityMs('bob', [0, 0]); sw.step()
  assert.ok(sw.states()[0]!.position_m[0] > 0.79); sw.dispose()
})
test('Origin decorations cannot deflect particles', () => {
  for (const type of ['rotating_frame', 'angular_momentum_point'] as const) {
    const w = new SimWorld(spec(type, { impact_parameter_m: 0, radius_m: 0, omega_rads: 0 }))
    const b = w.state().focus; w.stepMany(180)
    near(w.state().focus.velocity_ms[0], b.velocity_ms[0], 1e-6)
    near(w.state().focus.velocity_ms[1], b.velocity_ms[1], 1e-6)
    w.dispose()
  }
})
test('Static and unsupported uphill inclines are honest', () => {
  near(answer('inclined_plane', { mu_kinetic: 0.6 }, 'acceleration_ms2'), 0)
  assert.equal(answer('inclined_plane', { mu_kinetic: 0.6 }, 'time_to_bottom_s'), Infinity)
  assert.equal(validateSpec(spec('inclined_plane', { initial_velocity_ms: -1 })).ok, false)
})
test('Sphere, disc and hoop match simulated incline acceleration and force arrows', () => {
  for (const shape of ['sphere', 'disc', 'hoop'] as const) {
    const w = new SimWorld(spec('inclined_plane', { body_motion: 'rolling', body_shape: shape, mu_kinetic: 0, ramp_length_m: 4 }))
    w.stepMany(10); const v0 = w.state().focus.speed_ms
    w.stepMany(30); const b = w.state().focus
    const expected = 9.81 * Math.sin(25 * Math.PI / 180) / (1 + INERTIA_COEFF[shape])
    near((b.speed_ms - v0) / 0.25, expected, 0.05)
    near(answer('inclined_plane', { body_motion: 'rolling', body_shape: shape }, 'acceleration_ms2'), expected)
    near(forcesFor(w.params, b).find(f => f.kind === 'net')!.magnitude_n / b.mass_kg, expected)
    w.setPositionM('block', [0, 4]); const airborne = forcesFor(w.params, w.state().focus)
    assert.equal(airborne.some(f => f.kind === 'normal'), false); w.dispose()
  }
})
test('Downward launch apex is its starting height; zero rolling fraction is finite', () => {
  near(answer('projectile', { launch_angle_deg: -30, h0_m: 10 }, 'apex_height_m'), 10)
  near(answer('rolling_without_slipping', { v0_ms: 0 }, 'rotational_ke_fraction'), 1 / 3)
})
test('Large pendulum period agrees with measured crossings', () => {
  const w = new SimWorld(spec('pendulum', { theta0_deg: 90 }))
  const peaks: number[] = []; let previous = w.state().focus.velocity_ms[0]
  for (let i = 0; i < 1000; i++) { w.step(); const v = w.state().focus.velocity_ms[0]; if (previous > 0 && v <= 0) peaks.push(w.time_s); previous = v }
  near(peaks[1]! - peaks[0]!, answer('pendulum', { theta0_deg: 90 }, 'period_s'), 0.015); w.dispose()
})
test('Sandbox spin, vector momentum reversal and external torque are reported', () => {
  const w = new SandboxWorld({ ...empty, entities: [{ id: 'box', kind: 'box', position_m: [0, 2], width_m: 1, height_m: 1, angle_deg: 0, mass_kg: 2, velocity_ms: [1, 0], friction: 0, restitution: 1, charge_c: 0 }] })
  const body = w.bodyById('box')!
  Matter.Body.setAngularVelocity(body, 2 / 60)
  w.applyBodyState('box', { x_m: 0, y_m: 2, angle_deg: 0, vx_ms: 1, vy_ms: 0, omega_rads: 2 })
  near(w.states()[0]!.angular_velocity_rads, 2)
  const tracker = new InvariantTracker(), initial = tracker.sample(w)
  near(initial.kinetic_j, 1 + 0.5 * body.inertia / 200 ** 2 * 4)
  w.setVelocityMs('box', [-1, 0]); near(tracker.sample(w).laws[1]!.drift_abs, 4)
  w.dispose()
  const p = new SandboxWorld({ ...empty, gravity_ms2: 9.81, entities: [{ id: 'p', kind: 'pendulum', position_m: [2, 3], length_m: 1, start_angle_deg: 40, bob_mass_kg: 1, bob_radius_m: 0.1 }] })
  assert.equal(new InvariantTracker().sample(p).laws[2]!.expected, false); p.dispose()
})
test('Generated prose and tutor context use authoritative quantities', () => {
  const p = spec('projectile', { v0_ms: 30, launch_angle_deg: 30 }); p.raw_text = 'Launched horizontally at 30 m/s.'
  const text = problemStatement(p)
  assert.ok(text.includes('30°') && !text.includes('horizontally'))
  assert.ok(currentGivens(spec('projectile', { v0_ms: 7 })).includes('Initial speed: 7 m/s'))
})
test('Timeline single-step creates a branch even between recording strides', () => {
  const t = new Timeline(); for (const step of [0, 2, 4]) t.record(step, step / 120, {})
  t.seek(0); t.commitToCursor(); t.record(1, 1 / 120, {}, true)
  assert.deepEqual(t.all.map(f => f.step), [0, 1]); assert.equal(t.scrubbing, false)
})
test('World replacement resets a held hand without throwing the new body', () => {
  const c = new HandCoupling(), w = new SimWorld(PRESETS.projectile), b = w.state().focus
  const hand = { t_ms: 0, handedness: 'right' as const, confidence: 1, pinch: 1, palm_m: { x: b.position_m[0], y: b.position_m[1], z: 0 }, palm_velocity_ms: { x: 12, y: 0, z: 0 } }
  assert.ok(c.update(w, hand).grabbedId); c.reset(); c.update(w, { ...hand, pinch: 0 })
  near(w.state().focus.velocity_ms[0], b.velocity_ms[0]); w.dispose()
})
test('API payload and credential validation covers malformed nested data', () => {
  for (const solutions of [3, 'bad', {}, [1], Array(33).fill('x')]) assert.equal(validAsk({ question: 'why?', context: { solutions } }), false)
  assert.equal(validAsk({ question: 'why?', context: { current_givens: 'v0 = 2', solutions: ['x'] } }), true)
  assert.equal(validHand({ t_ms: 0, handedness: 'right', confidence: 1, pinch: 0, palm: { x: 0, y: 0, z: NaN }, palm_velocity: { x: 0, y: 0, z: 0 } }), false)
  assert.equal(voiceStatus(401), 'invalid-key'); assert.equal(voiceStatus(403), 'invalid-key'); assert.equal(voiceStatus(429), 'unavailable'); assert.equal(voiceStatus(200), 'ready')
})
console.log(`${checks} audit regression groups passed`)
