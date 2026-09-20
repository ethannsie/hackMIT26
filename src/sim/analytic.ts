/**
 * Closed-form solutions, straight from hackmit-2026-plan.md §6.
 *
 * Two jobs:
 *   1. Feed the KaTeX derivation panel with real substituted numbers.
 *   2. Act as ground truth for the Matter.js integration. If the engine and
 *      these formulas disagree by more than a few percent, the engine is wrong.
 *      `npm run verify` checks exactly that.
 *
 * Everything here is pure: same params in, same numbers out, no engine state.
 */
import { INERTIA_COEFF, type SimParams } from './params.ts'
import type { Askable } from '../spec/types.ts'

export interface DerivationStep {
  /** Plain-language label shown above the formula. */
  label: string
  /** Symbolic form, KaTeX source. */
  latex: string
  /** Same formula with the current numbers substituted in, KaTeX source. */
  substituted: string
}

export interface Solution {
  quantity: Askable
  value: number
  unit: string
  steps: DerivationStep[]
  /** Set when the closed form rests on an assumption the current values strain. */
  caveat?: string
}

const DEG = Math.PI / 180

/** Round for display without pretending to more precision than we have. */
function n(x: number, places = 3): string {
  if (Number.isNaN(x)) return '\\text{undefined}'
  if (!Number.isFinite(x)) return x < 0 ? '-\\infty' : '\\infty'
  const r = Number(x.toFixed(places))
  return String(r)
}

function projectile(p: Extract<SimParams, { kind: 'projectile' }>): Solution[] {
  const { v0_ms: v0, angle_deg, h0_m: h0, g } = p
  const th = angle_deg * DEG
  const vy = v0 * Math.sin(th)
  const vx = v0 * Math.cos(th)

  const disc = vy * vy + 2 * g * h0
  const tf = (vy + Math.sqrt(disc)) / g
  const range = vx * tf
  const riseVy = Math.max(0, vy)
  const apex = h0 + (riseVy * riseVy) / (2 * g)

  return [
    {
      quantity: 'time_of_flight_s',
      value: tf,
      unit: 's',
      steps: [
        {
          label: 'Vertical motion, solved for the time y returns to 0',
          latex: 't_f = \\frac{v_0\\sin\\theta + \\sqrt{v_0^2\\sin^2\\theta + 2gh_0}}{g}',
          substituted: `t_f = \\frac{${n(v0)}\\sin ${n(angle_deg)}^\\circ + \\sqrt{${n(vy * vy)} + 2(${n(g)})(${n(h0)})}}{${n(g)}} = ${n(tf)}\\ \\text{s}`,
        },
      ],
    },
    {
      quantity: 'range_m',
      value: range,
      unit: 'm',
      steps: [
        {
          label: 'Horizontal velocity is constant, so range is just vₓ·t_f',
          latex: 'R = v_0\\cos\\theta \\cdot t_f',
          substituted: `R = (${n(v0)})\\cos ${n(angle_deg)}^\\circ \\cdot ${n(tf)} = ${n(range)}\\ \\text{m}`,
        },
      ],
    },
    {
      quantity: 'apex_height_m',
      value: apex,
      unit: 'm',
      steps: [
        {
          label: vy > 0 ? 'Apex is where vertical velocity reaches zero' : 'Launched downward: the highest point is the starting point',
          latex: 'h = h_0 + \\frac{\\max(0,v_0\\sin\\theta)^2}{2g}',
          substituted: `h = ${n(h0)} + \\frac{${n(riseVy * riseVy)}}{2(${n(g)})} = ${n(apex)}\\ \\text{m}`,
        },
      ],
    },
  ]
}

function incline(p: Extract<SimParams, { kind: 'inclined_plane' }>): Solution[] {
  const { angle_deg, mass_kg: m, mu_kinetic: mu, ramp_length_m: L, v0_ms: v0, motion, g } = p
  const th = angle_deg * DEG
  const sin = Math.sin(th)
  const cos = Math.cos(th)

  const k = INERTIA_COEFF[p.shape]
  const held = motion === 'sliding' && v0 === 0 && sin <= mu * cos
  const a = held ? 0 : motion === 'rolling' ? g * sin / (1 + k) : g * (sin - mu * cos)
  const N = m * g * cos

  // L = v0·t + ½at²  solved for positive t.
  const disc = v0 * v0 + 2 * a * L
  const slides = a > 1e-9 || v0 > 1e-9
  const t = slides && disc >= 0 && Math.abs(a) > 1e-9
    ? (-v0 + Math.sqrt(disc)) / a
    : slides && Math.abs(a) <= 1e-9
      ? L / v0
      : Infinity
  const vf = slides && disc >= 0 ? Math.sqrt(disc) : 0

  const accelStep: DerivationStep = motion === 'rolling'
    ? {
        label: `Rolling ${p.shape}: I = ${n(k)}mr²; energy goes into translation and rotation`,
        latex: 'a = \\frac{g\\sin\\theta}{1+k}',
        substituted: `a = \\frac{${n(g)}\\sin ${n(angle_deg)}^\\circ}{1+${n(k)}} = ${n(a)}\\ \\text{m/s}^2`,
      }
    : {
        label: held ? 'Static friction balances the downhill weight; the block stays at rest' : 'Newton\'s second law along the ramp, friction opposing motion',
        latex: held ? 'a=0' : 'a = g(\\sin\\theta - \\mu\\cos\\theta)',
        substituted: held ? 'a=0\\ \\text{m/s}^2' : `a = ${n(g)}(\\sin ${n(angle_deg)}^\\circ - ${n(mu)}\\cos ${n(angle_deg)}^\\circ) = ${n(a)}\\ \\text{m/s}^2`,
      }

  const out: Solution[] = [
    {
      quantity: 'acceleration_ms2',
      value: a,
      unit: 'm/s²',
      steps: [accelStep],
      ...(a <= 0 && v0 === 0
        ? { caveat: `With μ = ${n(mu)} at ${n(angle_deg)}°, static friction wins and the block never starts moving.` }
        : {}),
    },
    {
      quantity: 'normal_force_n',
      value: N,
      unit: 'N',
      steps: [
        {
          label: 'Perpendicular to the ramp surface, nothing accelerates',
          latex: 'N = mg\\cos\\theta',
          substituted: `N = (${n(m)})(${n(g)})\\cos ${n(angle_deg)}^\\circ = ${n(N)}\\ \\text{N}`,
        },
      ],
    },
    {
      quantity: 'time_to_bottom_s',
      value: t,
      unit: 's',
      steps: [
        {
          label: Number.isFinite(t) ? 'Constant acceleration over the ramp length' : 'The body stops before the bottom or remains at rest',
          latex: 'L = v_0 t + \\tfrac{1}{2}at^2 \\;\\Rightarrow\\; t = \\frac{-v_0 + \\sqrt{v_0^2 + 2aL}}{a}',
          substituted: !Number.isFinite(t) ? '\\text{Bottom is never reached}' : Math.abs(a) < 1e-9 ? `t=L/v_0=${n(t)}\\ \\text{s}` : `t = \\frac{-${n(v0)} + \\sqrt{${n(v0 * v0)} + 2(${n(a)})(${n(L)})}}{${n(a)}} = ${n(t)}\\ \\text{s}`,
        },
      ],
    },
    {
      quantity: 'final_velocity_ms',
      value: vf,
      unit: 'm/s',
      steps: [
        {
          label: Number.isFinite(t) ? 'Kinematics with no time term' : 'Final speed at rest; the bottom is never reached',
          latex: 'v_f = \\sqrt{v_0^2 + 2aL}',
          substituted: !Number.isFinite(t) ? 'v_{\\mathrm{stop}}=0' : `v_f = \\sqrt{${n(v0 * v0)} + 2(${n(a)})(${n(L)})} = ${n(vf)}\\ \\text{m/s}`,
        },
      ],
    },
  ]
  return out
}

function pendulum(p: Extract<SimParams, { kind: 'pendulum' }>): Solution[] {
  const { length_m: L, theta0_deg, mass_kg: m, g } = p
  const th0 = theta0_deg * DEG
  // K(k) = pi/(2 AGM(1, sqrt(1-k²))). Converges quadratically.
  let a = 1, b = Math.cos(th0 / 2)
  for (let i = 0; i < 12; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]
  const T = 2 * Math.PI * Math.sqrt(L / g) / a
  const omega = 2 * Math.PI / T

  // Small-angle prediction vs the exact energy result. The gap IS the lesson.
  const vMaxSmall = Math.sqrt(g / L) * L * Math.abs(th0)
  const vMaxExact = Math.sqrt(2 * g * L * (1 - Math.cos(th0)))
  const tMax = m * g * (3 - 2 * Math.cos(th0))
  const errPct = vMaxExact === 0 ? 0 : ((vMaxSmall - vMaxExact) / vMaxExact) * 100

  return [
    {
      quantity: 'angular_frequency_rads',
      value: omega,
      unit: 'rad/s',
      steps: [
        {
          label: 'Angular frequency from the amplitude-dependent period',
          latex: '\\omega = 2\\pi/T',
          substituted: `\\omega = 2\\pi/${n(T)} = ${n(omega)}\\ \\text{rad/s}`,
        },
      ],
    },
    {
      quantity: 'period_s',
      value: T,
      unit: 's',
      steps: [
        {
          label: 'Exact finite-amplitude period; K is the complete elliptic integral',
          latex: 'T = 4\\sqrt{L/g}\\,K(\\sin(|\\theta_0|/2))',
          substituted: `T = 4\\sqrt{${n(L)}/${n(g)}}\\,K(${n(Math.sin(Math.abs(th0) / 2))}) = ${n(T)}\\ \\text{s}\\quad (m = ${n(m)}\\ \\text{kg does not appear})`,
        },
      ],
    },
    {
      quantity: 'max_speed_ms',
      value: vMaxExact,
      unit: 'm/s',
      steps: [
        {
          label: 'Energy conservation, exact for any amplitude',
          latex: 'v_{max} = \\sqrt{2gL(1 - \\cos\\theta_0)}',
          substituted: `v_{max} = \\sqrt{2(${n(g)})(${n(L)})(1 - \\cos ${n(theta0_deg)}^\\circ)} = ${n(vMaxExact)}\\ \\text{m/s}`,
        },
        {
          label: 'What the small-angle formula would have predicted',
          latex: 'v_{max} \\approx \\omega L \\theta_0',
          substituted: `v_{max} \\approx (${n(Math.sqrt(g / L))})(${n(L)})(${n(Math.abs(th0))}) = ${n(vMaxSmall)}\\ \\text{m/s}`,
        },
      ],
      ...(Math.abs(theta0_deg) > 20
        ? {
            caveat: `At ${n(theta0_deg)}° the small-angle approximation overpredicts peak speed by ${n(errPct, 1)}%. Below about 15° the two agree to under 1%.`,
          }
        : {}),
    },
    {
      quantity: 'tension_n',
      value: tMax,
      unit: 'N',
      steps: [
        {
          label: 'Rod tension at the bottom of the swing, where it is largest',
          latex: 'T_{max} = mg + \\frac{m v_{max}^2}{L} = mg(3 - 2\\cos\\theta_0)',
          substituted: `T_{max} = (${n(m)})(${n(g)})(3 - 2\\cos ${n(theta0_deg)}^\\circ) = ${n(tMax)}\\ \\text{N}`,
        },
      ],
      caveat: 'At the top of the swing the tension drops to mg cos θ₀ — the rod pulls hardest exactly when the bob is moving fastest, because it has to supply the centripetal force as well as hold the weight.',
    },
  ]
}

function collision(p: Extract<SimParams, { kind: 'collision_1d' }>): Solution[] {
  const { m1_kg: m1, m2_kg: m2, v1_ms: v1, v2_ms: v2, restitution: e } = p
  const M = m1 + m2
  const pTot = m1 * v1 + m2 * v2

  const v1f = (pTot + m2 * e * (v2 - v1)) / M
  const v2f = (pTot + m1 * e * (v1 - v2)) / M

  const keBefore = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2
  const keAfter = 0.5 * m1 * v1f * v1f + 0.5 * m2 * v2f * v2f
  const keLost = keBefore - keAfter

  return [
    {
      quantity: 'v1_final_ms',
      value: v1f,
      unit: 'm/s',
      steps: [
        {
          label: 'Momentum conservation plus the restitution definition, solved for body 1',
          latex: "v_1' = \\frac{m_1v_1 + m_2v_2 + m_2 e (v_2 - v_1)}{m_1 + m_2}",
          substituted: `v_1' = \\frac{${n(pTot)} + (${n(m2)})(${n(e)})(${n(v2 - v1)})}{${n(M)}} = ${n(v1f)}\\ \\text{m/s}`,
        },
      ],
    },
    {
      quantity: 'v2_final_ms',
      value: v2f,
      unit: 'm/s',
      steps: [
        {
          label: 'Same two equations, solved for body 2',
          latex: "v_2' = \\frac{m_1v_1 + m_2v_2 + m_1 e (v_1 - v_2)}{m_1 + m_2}",
          substituted: `v_2' = \\frac{${n(pTot)} + (${n(m1)})(${n(e)})(${n(v1 - v2)})}{${n(M)}} = ${n(v2f)}\\ \\text{m/s}`,
        },
      ],
    },
    {
      quantity: 'kinetic_energy_lost_j',
      value: keLost,
      unit: 'J',
      steps: [
        {
          label: 'Momentum is always conserved; kinetic energy is not, unless e = 1',
          latex: '\\Delta K = K_i - K_f',
          substituted: `\\Delta K = ${n(keBefore)} - ${n(keAfter)} = ${n(keLost)}\\ \\text{J}`,
        },
      ],
      ...(e === 1 ? { caveat: 'e = 1, so this collision is elastic and no kinetic energy is lost.' } : {}),
    },
  ]
}


// ---------------------------------------------------------------------------
// The hard-to-picture five.
// ---------------------------------------------------------------------------

function rolling(p: Extract<SimParams, { kind: 'rolling_without_slipping' }>): Solution[] {
  const { radius_m: r, v_ms: v, shape } = p
  const k = INERTIA_COEFF[shape]
  const omega = v / r
  const fraction = k / (1 + k) // continuous shape ratio, also defined at rest

  return [
    {
      quantity: 'angular_frequency_rads',
      value: omega,
      unit: 'rad/s',
      steps: [
        {
          label: 'Rolling without slipping ties rotation to translation',
          latex: 'v = \\omega r \\;\\Rightarrow\\; \\omega = v/r',
          substituted: `\\omega = ${n(v)}/${n(r)} = ${n(omega)}\\ \\text{rad/s}`,
        },
      ],
    },
    {
      quantity: 'contact_point_speed_ms',
      value: 0,
      unit: 'm/s',
      steps: [
        {
          label: 'The contact point is instantaneously at rest — translation and rotation cancel exactly',
          latex: 'v_{contact} = v - \\omega r = 0',
          substituted: `v_{contact} = ${n(v)} - (${n(omega)})(${n(r)}) = 0\\ \\text{m/s}`,
        },
      ],
      caveat:
        'The wheel is moving, yet the point touching the ground has zero velocity. That is why static friction can act here without doing any work, and why rolling does not wear the contact point away.',
    },
    {
      quantity: 'top_point_speed_ms',
      value: 2 * v,
      unit: 'm/s',
      steps: [
        {
          label: 'At the top, translation and rotation add instead of cancelling',
          latex: 'v_{top} = v + \\omega r = 2v',
          substituted: `v_{top} = ${n(v)} + (${n(omega)})(${n(r)}) = ${n(2 * v)}\\ \\text{m/s}`,
        },
      ],
      caveat: `The top of the wheel moves at ${n(2 * v)} m/s — twice the speed of the axle — while the bottom is stationary. Both are true at the same instant on the same rigid body.`,
    },
    {
      quantity: 'rotational_ke_fraction',
      value: fraction,
      unit: '',
      steps: [
        {
          label: `Moment of inertia for a ${shape}: I = ${n(k)}mr²`,
          latex: 'K_{rot}/K_{total} = \\frac{\\tfrac{1}{2}I\\omega^2}{\\tfrac{1}{2}mv^2 + \\tfrac{1}{2}I\\omega^2} = \\frac{k}{1+k}',
          substituted: `= \\frac{${n(k)}}{1 + ${n(k)}} = ${n(fraction)}`,
        },
      ],
      caveat: v === 0 ? 'At rest both kinetic energies are zero. This is the limiting shape ratio for non-zero rolling speed.' : `${n(fraction * 100, 1)}% of this body's kinetic energy is rotation, not motion down the track. Change the shape and this fraction changes — which is the whole reason a hoop loses a race to a disc, and a disc to a sphere.`,
    },
  ]
}

function circular(p: Extract<SimParams, { kind: 'circular_motion' }>): Solution[] {
  const { radius_m: r, speed_ms: v, mass_kg: m } = p
  const omega = v / r
  const T = (2 * Math.PI * r) / v
  const ac = (v * v) / r
  const Fc = m * ac

  return [
    {
      quantity: 'centripetal_acceleration_ms2',
      value: ac,
      unit: 'm/s²',
      steps: [
        {
          label: 'Speed is constant, yet the velocity vector is turning — so there is acceleration',
          latex: 'a_c = \\frac{v^2}{r} = \\omega^2 r',
          substituted: `a_c = \\frac{(${n(v)})^2}{${n(r)}} = ${n(ac)}\\ \\text{m/s}^2`,
        },
      ],
      caveat:
        'This acceleration points at the centre, where nothing is moving and nothing is located. The velocity points along the tangent. The two are perpendicular at every instant, which is exactly why the speed never changes while the direction always does.',
    },
    {
      quantity: 'centripetal_force_n',
      value: Fc,
      unit: 'N',
      steps: [
        {
          label: 'Newton\'s second law, directed inward',
          latex: 'F_c = ma_c = \\frac{mv^2}{r}',
          substituted: `F_c = (${n(m)})(${n(ac)}) = ${n(Fc)}\\ \\text{N}`,
        },
      ],
      caveat:
        'There is no outward force. What feels like one is your own inertia continuing straight while the constraint pulls you off that line.',
    },
    {
      quantity: 'period_s',
      value: T,
      unit: 's',
      steps: [
        {
          label: 'One full circumference at constant speed',
          latex: 'T = \\frac{2\\pi r}{v}',
          substituted: `T = \\frac{2\\pi(${n(r)})}{${n(v)}} = ${n(T)}\\ \\text{s}`,
        },
      ],
    },
    {
      quantity: 'angular_frequency_rads',
      value: omega,
      unit: 'rad/s',
      steps: [
        {
          label: 'Angular rate',
          latex: '\\omega = v/r',
          substituted: `\\omega = ${n(v)}/${n(r)} = ${n(omega)}\\ \\text{rad/s}`,
        },
      ],
    },
  ]
}

function magnetic(p: Extract<SimParams, { kind: 'charged_particle_magnetic' }>): Solution[] {
  const { charge_c: q, b_field_tesla: B, mass_kg: m, speed_ms: v } = p
  const absQB = Math.abs(q * B)
  const r = absQB === 0 ? Infinity : (m * v) / absQB
  const T = absQB === 0 ? Infinity : (2 * Math.PI * m) / absQB
  const omega = absQB / m
  const sense = q * B > 0 ? 'clockwise' : 'counter-clockwise'

  return [
    {
      quantity: 'orbit_radius_m',
      value: r,
      unit: 'm',
      steps: [
        {
          label: 'The magnetic force supplies exactly the centripetal force',
          latex: 'qvB = \\frac{mv^2}{r} \\;\\Rightarrow\\; r = \\frac{mv}{|q|B}',
          substituted: `r = \\frac{(${n(m)})(${n(v)})}{|${n(q)}|(${n(B)})} = ${n(r)}\\ \\text{m}`,
        },
      ],
      caveat: `The force is qv × B: perpendicular to the velocity AND to the field, so it points somewhere neither the particle nor the field is heading. Here that makes the orbit ${sense}. Flip the sign of the charge or the field and it reverses.`,
    },
    {
      quantity: 'cyclotron_period_s',
      value: T,
      unit: 's',
      steps: [
        {
          label: 'Period of one full orbit',
          latex: 'T = \\frac{2\\pi m}{|q|B}',
          substituted: `T = \\frac{2\\pi(${n(m)})}{|${n(q)}|(${n(B)})} = ${n(T)}\\ \\text{s}`,
        },
      ],
      caveat:
        'The speed v cancels out. A fast particle traces a bigger circle but takes exactly the same time to go around. Change the speed slider and watch the radius move while the period does not — that is the principle the cyclotron is built on.',
    },
    {
      quantity: 'cyclotron_frequency_rads',
      value: omega,
      unit: 'rad/s',
      steps: [
        {
          label: 'Angular frequency, again independent of speed',
          latex: '\\omega_c = \\frac{|q|B}{m}',
          substituted: `\\omega_c = \\frac{|${n(q)}|(${n(B)})}{${n(m)}} = ${n(omega)}\\ \\text{rad/s}`,
        },
      ],
    },
    {
      quantity: 'work_done_j',
      value: 0,
      unit: 'J',
      steps: [
        {
          label: 'Force is perpendicular to displacement at every instant',
          latex: 'W = \\int \\vec{F}\\cdot d\\vec{s} = 0 \\quad\\text{since}\\quad \\vec{F}\\perp\\vec{v}',
          substituted: 'W = 0\\ \\text{J}\\quad\\text{always}',
        },
      ],
      caveat:
        'A magnetic field can change where a particle goes but never how fast it goes. The kinetic energy readout will not move no matter how long this runs.',
    },
  ]
}

function rotatingFrame(p: Extract<SimParams, { kind: 'rotating_frame' }>): Solution[] {
  const { omega_rads: w, speed_ms: v, mass_kg: m, r0_m: r0 } = p
  const aCor = 2 * Math.abs(w) * v
  const aCf = w * w * r0
  const deflection = w > 0 ? 'right' : 'left'

  return [
    {
      quantity: 'coriolis_acceleration_ms2',
      value: aCor,
      unit: 'm/s²',
      steps: [
        {
          label: 'Coriolis term — depends on velocity, not position',
          latex: '\\vec{a}_{Cor} = -2\\vec{\\omega}\\times\\vec{v}, \\quad |a_{Cor}| = 2\\omega v',
          substituted: `|a_{Cor}| = 2(${n(Math.abs(w))})(${n(v)}) = ${n(aCor)}\\ \\text{m/s}^2`,
        },
      ],
      caveat: `In the inertial frame this particle travels in a perfectly straight line at constant speed, with no force on it at all. In the rotating frame it curves to the ${deflection}. Both descriptions are correct; the curve is the frame turning underneath, not a push.`,
    },
    {
      quantity: 'centrifugal_acceleration_ms2',
      value: aCf,
      unit: 'm/s²',
      steps: [
        {
          label: 'Centrifugal term — depends on position, not velocity',
          latex: '\\vec{a}_{cf} = -\\vec{\\omega}\\times(\\vec{\\omega}\\times\\vec{r}), \\quad |a_{cf}| = \\omega^2 r',
          substituted: `|a_{cf}| = (${n(w)})^2(${n(r0)}) = ${n(aCf)}\\ \\text{m/s}^2`,
        },
      ],
      caveat:
        'Neither of these has a third-law partner. Nothing is pushing back, because nothing is pushing — they are bookkeeping terms that appear when you insist on measuring from a frame that is itself turning.',
    },
    {
      quantity: 'centripetal_force_n',
      value: m * aCf,
      unit: 'N',
      steps: [
        {
          label: 'What an observer in the rotating frame would report as an outward pull',
          latex: 'F_{cf} = m\\omega^2 r',
          substituted: `F_{cf} = (${n(m)})(${n(w)})^2(${n(r0)}) = ${n(m * aCf)}\\ \\text{N}`,
        },
      ],
    },
  ]
}

function angularMomentumPoint(
  p: Extract<SimParams, { kind: 'angular_momentum_point' }>,
): Solution[] {
  const { mass_kg: m, speed_ms: v, impact_parameter_m: d } = p
  const L = m * v * d
  const areal = L / (2 * m)

  return [
    {
      quantity: 'angular_momentum_kgm2s',
      value: L,
      unit: 'kg·m²/s',
      steps: [
        {
          label: 'Angular momentum about the chosen origin',
          latex: '\\vec{L} = \\vec{r}\\times\\vec{p}, \\quad |L| = mvd',
          substituted: `L = (${n(m)})(${n(v)})(${n(d)}) = ${n(L)}\\ \\text{kg}\\cdot\\text{m}^2/\\text{s}`,
        },
        {
          label: 'Only the perpendicular distance survives the cross product',
          latex: '|\\vec{r}\\times\\vec{p}| = rp\\sin\\theta = p\\,(r\\sin\\theta) = p\\,d',
          substituted: `r\\sin\\theta = d = ${n(d)}\\ \\text{m at every point on the line}`,
        },
      ],
      caveat:
        'This particle moves in a straight line and never rotates around anything, yet its angular momentum about this origin is non-zero and perfectly constant. Nothing is spinning. Move the origin onto the line of motion and L drops to zero — angular momentum is a statement about a point you choose, not a property the particle carries.',
    },
    {
      quantity: 'torque_nm',
      value: 0,
      unit: 'N·m',
      steps: [
        {
          label: 'No force acts, so no torque acts, so L cannot change',
          latex: '\\vec{\\tau} = \\frac{d\\vec{L}}{dt} = \\vec{r}\\times\\vec{F} = 0',
          substituted: '\\tau = 0\\ \\text{N}\\cdot\\text{m}',
        },
      ],
    },
    {
      quantity: 'areal_velocity_m2s',
      value: areal,
      unit: 'm²/s',
      steps: [
        {
          label: 'The line from the origin sweeps area at a constant rate',
          latex: '\\frac{dA}{dt} = \\frac{L}{2m} = \\tfrac{1}{2}vd',
          substituted: `\\frac{dA}{dt} = \\frac{${n(L)}}{2(${n(m)})} = ${n(areal)}\\ \\text{m}^2/\\text{s}`,
        },
      ],
      caveat:
        "This is Kepler's second law with the gravity removed. Equal areas in equal times is not really about orbits — it is just angular momentum conservation, and it holds even for a particle drifting in a straight line through empty space.",
    },
  ]
}

/** Solve every quantity this problem type supports. Pure. */
export function solve(params: SimParams): Solution[] {
  switch (params.kind) {
    case 'projectile':
      return projectile(params)
    case 'inclined_plane':
      return incline(params)
    case 'pendulum':
      return pendulum(params)
    case 'collision_1d':
      return collision(params)
    case 'rolling_without_slipping':
      return rolling(params)
    case 'circular_motion':
      return circular(params)
    case 'charged_particle_magnetic':
      return magnetic(params)
    case 'rotating_frame':
      return rotatingFrame(params)
    case 'angular_momentum_point':
      return angularMomentumPoint(params)
  }
}

/** Just the quantities the problem actually asked for, in the order asked. */
export function solveAsked(params: SimParams, asked: Askable[]): Solution[] {
  const all = solve(params)
  const byQuantity = new Map(all.map((s) => [s.quantity, s]))
  const picked = asked.map((q) => byQuantity.get(q)).filter((s): s is Solution => s !== undefined)
  return picked.length > 0 ? picked : all
}
