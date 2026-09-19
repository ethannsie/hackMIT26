/**
 * Sandbox verification.
 *
 * The problem library is checked against closed forms. A composed scene has no
 * closed form, so it is checked against the things that hold regardless:
 * conservation laws, and the isolated-component cases where a closed form does
 * still apply (an alone spring is still 2*pi*sqrt(m/k)).
 *
 * Run: npm run verify:sandbox
 */
import { SandboxWorld } from '../src/sandbox/world.ts'
import { InvariantTracker } from '../src/sandbox/invariants.ts'
import { loadPreset } from '../src/sandbox/presets.ts'
import type { SandboxScene } from '../src/sandbox/types.ts'

let failures = 0

function check(name: string, actual: number, expected: number, tolPct: number, note = ''): void {
  const err = Math.abs(expected) < 1e-12 ? Math.abs(actual) : Math.abs((actual - expected) / expected) * 100
  const pass = err <= tolPct
  if (!pass) failures++
  console.log(
    `  [${pass ? 'PASS' : 'FAIL'}] ${name.padEnd(38)} sim=${actual.toFixed(4).padStart(10)}  ` +
      `expected=${expected.toFixed(4).padStart(10)}  err=${err.toFixed(2).padStart(6)}%  (tol ${tolPct}%)` +
      (note ? `  ${note}` : ''),
  )
}

function ok(name: string, pass: boolean, detail = ''): void {
  if (!pass) failures++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? `  ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
console.log('\nISOLATED SPRING  a lone component must still match its closed form')
{
  // k = 100 N/m on 1 kg in zero gravity: T = 2*pi*sqrt(m/k) = 0.6283 s
  const scene: SandboxScene = {
    name: 'spring test',
    gravity_ms2: 0,
    ground: false,
    arena: { width_m: 16, height_m: 9, walls: false },
    entities: [
      {
        id: 'spring_1', kind: 'spring', position_m: [0, 3],
        rest_length_m: 1, stiffness_n_per_m: 100, mass_kg: 1,
        bob_radius_m: 0.08, start_extension_m: 0.3,
      },
    ],
  }
  const w = new SandboxWorld(scene)
  const expectedT = 2 * Math.PI * Math.sqrt(1 / 100)

  // Period from successive downward-extreme crossings.
  const crossings: number[] = []
  let prev = w.states()[0]!.velocity_ms[1]
  for (let i = 0; i < 40_000 && crossings.length < 3; i++) {
    w.step()
    const v = w.states()[0]!.velocity_ms[1]
    if (prev < 0 && v >= 0) crossings.push(w.time_s)
    prev = v
  }
  if (crossings.length >= 2) {
    check('period (s)', crossings[1]! - crossings[0]!, expectedT, 2, '(T = 2π√(m/k))')
  } else {
    ok('spring oscillates', false)
  }
}

// ---------------------------------------------------------------------------
console.log('\nENERGY  a scene with nothing dissipative must conserve it')
{
  const scene: SandboxScene = {
    name: 'conservative',
    gravity_ms2: 9.81,
    ground: false,
    arena: { width_m: 16, height_m: 9, walls: false },
    entities: [
      {
        id: 'pendulum_1', kind: 'pendulum', position_m: [0, 4],
        length_m: 1.2, bob_mass_kg: 1, bob_radius_m: 0.1, start_angle_deg: 40,
      },
      {
        id: 'spring_1', kind: 'spring', position_m: [2.5, 4],
        rest_length_m: 0.8, stiffness_n_per_m: 80, mass_kg: 1,
        bob_radius_m: 0.1, start_extension_m: 0.35,
      },
    ],
  }
  const w = new SandboxWorld(scene)
  const tracker = new InvariantTracker()
  const first = tracker.sample(w)

  let worst = 0
  for (let i = 0; i < 2400; i++) {
    w.step()
    const inv = tracker.sample(w)
    worst = Math.max(worst, Math.abs(inv.drift(first)))
  }
  ok(`total energy holds over 20 s: worst drift ${worst.toFixed(3)}%`, worst < 2)

  const laws = tracker.sample(w).laws
  const energyLaw = laws.find((l) => l.name === 'Total energy')!
  ok('scene is correctly reported as energy-conserving', energyLaw.expected === true)
}

// ---------------------------------------------------------------------------
console.log('\nDISSIPATION  friction must be reported as breaking energy conservation')
{
  const scene = loadPreset('chain_reaction')
  const w = new SandboxWorld(scene)
  const tracker = new InvariantTracker()
  tracker.sample(w)
  w.stepMany(600)
  const inv = tracker.sample(w)

  const energyLaw = inv.laws.find((l) => l.name === 'Total energy')!
  ok(
    'energy conservation correctly NOT expected',
    energyLaw.expected === false,
    `(${energyLaw.reasons.length} reasons named)`,
  )
  ok('reasons name the responsible components', energyLaw.reasons.some((r) => r.includes('friction')))

  const momentumLaw = inv.laws.find((l) => l.name === 'Linear momentum')!
  ok('momentum conservation correctly NOT expected', momentumLaw.expected === false)

  // And energy must fall, not rise. An engine that gains energy is broken.
  ok(
    `energy decreases with friction present: ${energyLaw.drift_pct.toFixed(1)}%`,
    energyLaw.current <= energyLaw.initial + 1e-6,
  )
}

// ---------------------------------------------------------------------------
console.log('\nMAGNETIC REGION  a charged body curves, a neutral one does not')
{
  const scene = loadPreset('field_trap')
  const w = new SandboxWorld(scene)
  const tracker = new InvariantTracker()
  const before = tracker.sample(w)

  const startCharged = w.states().find((s) => s.id === 'ball_1')!
  const startNeutral = w.states().find((s) => s.id === 'ball_2')!

  w.stepMany(900)

  const charged = w.states().find((s) => s.id === 'ball_1')!
  const neutral = w.states().find((s) => s.id === 'ball_2')!

  // The neutral ball has no reason to leave its line.
  check('neutral ball holds its y (m)', neutral.position_m[1], startNeutral.position_m[1], 1)
  ok(
    `charged ball deflects: y ${startCharged.position_m[1].toFixed(2)} -> ${charged.position_m[1].toFixed(2)} m`,
    Math.abs(charged.position_m[1] - startCharged.position_m[1]) > 0.2,
  )

  // The headline: a magnetic field does no work, so energy survives even though
  // momentum does not.
  const inv = tracker.sample(w)
  check('speed of the charged ball (m/s)', charged.speed_ms, startCharged.speed_ms, 1, '(field does no work)')
  ok(`total energy holds: drift ${inv.drift(before).toFixed(3)}%`, Math.abs(inv.drift(before)) < 1)

  const momentumLaw = inv.laws.find((l) => l.name === 'Linear momentum')!
  ok('momentum correctly NOT expected (the field deflects)', momentumLaw.expected === false)
}

// ---------------------------------------------------------------------------
console.log('\nDETERMINISM  a composed scene must replay exactly')
{
  const a = new SandboxWorld(loadPreset('chain_reaction'))
  const b = new SandboxWorld(loadPreset('chain_reaction'))
  a.stepMany(1500)
  b.stepMany(1500)
  ok('two worlds bit-identical after 1500 steps', JSON.stringify(a.states()) === JSON.stringify(b.states()))

  const c = new SandboxWorld(loadPreset('chain_reaction'))
  c.stepMany(700)
  c.stepMany(800)
  ok('batched stepping matches single stepping', JSON.stringify(c.states()) === JSON.stringify(a.states()))
}

// ---------------------------------------------------------------------------
console.log('\nROLLBACK  a snapshot is a scene plus a step count, and must replay exactly')
{
  // This is what makes the undo buffer cheap: nothing about the bodies is
  // stored, so restoring has to reproduce the state by replaying alone.
  const scene = loadPreset('chain_reaction')
  const live = new SandboxWorld(structuredClone(scene))
  live.stepMany(880)
  const atSnapshot = JSON.stringify(live.states())

  // Keep running past the snapshot, as a real session would.
  live.stepMany(400)

  const restored = new SandboxWorld(structuredClone(scene))
  restored.stepMany(880)
  ok('restored scene matches the snapshot exactly', JSON.stringify(restored.states()) === atSnapshot)

  // And an edited scene must NOT match — otherwise the check above is vacuous.
  const edited = structuredClone(scene)
  const box = edited.entities.find((e) => e.id === 'box_1')
  if (box && box.kind === 'box') box.mass_kg = 5
  const other = new SandboxWorld(edited)
  other.stepMany(880)
  ok('an edited scene diverges, so the check is meaningful', JSON.stringify(other.states()) !== atSnapshot)
}

console.log(failures === 0 ? '\nAll sandbox checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
