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
import type { SimParams } from './params.ts'
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
  if (!Number.isFinite(x)) return '\\infty'
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
  const apex = h0 + (vy * vy) / (2 * g)

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
          label: 'Apex is where vertical velocity reaches zero',
          latex: 'h = h_0 + \\frac{v_0^2\\sin^2\\theta}{2g}',
          substituted: `h = ${n(h0)} + \\frac{${n(vy * vy)}}{2(${n(g)})} = ${n(apex)}\\ \\text{m}`,
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

  const a = motion === 'rolling' ? (5 / 7) * g * sin : g * (sin - mu * cos)
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
        label: 'Rolling without slipping — 5/7 of the sliding value, because energy also goes into rotation',
        latex: 'a = \\tfrac{5}{7} g\\sin\\theta',
        substituted: `a = \\tfrac{5}{7}(${n(g)})\\sin ${n(angle_deg)}^\\circ = ${n(a)}\\ \\text{m/s}^2`,
      }
    : {
        label: 'Newton\'s second law along the ramp, friction opposing motion',
        latex: 'a = g(\\sin\\theta - \\mu\\cos\\theta)',
        substituted: `a = ${n(g)}(\\sin ${n(angle_deg)}^\\circ - ${n(mu)}\\cos ${n(angle_deg)}^\\circ) = ${n(a)}\\ \\text{m/s}^2`,
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
          label: 'Constant acceleration over the ramp length',
          latex: 'L = v_0 t + \\tfrac{1}{2}at^2 \;\\Rightarrow\; t = \\frac{-v_0 + \\sqrt{v_0^2 + 2aL}}{a}',
          substituted: `t = \\frac{-${n(v0)} + \\sqrt{${n(v0 * v0)} + 2(${n(a)})(${n(L)})}}{${n(a)}} = ${n(t)}\\ \\text{s}`,
        },
      ],
    },
    {
      quantity: 'final_velocity_ms',
      value: vf,
      unit: 'm/s',
      steps: [
        {
          label: 'Kinematics with no time term',
          latex: 'v_f = \\sqrt{v_0^2 + 2aL}',
          substituted: `v_f = \\sqrt{${n(v0 * v0)} + 2(${n(a)})(${n(L)})} = ${n(vf)}\\ \\text{m/s}`,
        },
      ],
    },
  ]
  return out
}

function pendulum(p: Extract<SimParams, { kind: 'pendulum' }>): Solution[] {
  const { length_m: L, theta0_deg, mass_kg: m, g } = p
  const th0 = theta0_deg * DEG
  const omega = Math.sqrt(g / L)
  const T = 2 * Math.PI * Math.sqrt(L / g)

  // Small-angle prediction vs the exact energy result. The gap IS the lesson.
  const vMaxSmall = omega * L * Math.abs(th0)
  const vMaxExact = Math.sqrt(2 * g * L * (1 - Math.cos(th0)))
  const errPct = vMaxExact === 0 ? 0 : ((vMaxSmall - vMaxExact) / vMaxExact) * 100

  return [
    {
      quantity: 'angular_frequency_rads',
      value: omega,
      unit: 'rad/s',
      steps: [
        {
          label: 'Small-angle approximation: sin θ ≈ θ makes this simple harmonic',
          latex: '\\omega = \\sqrt{g/L}',
          substituted: `\\omega = \\sqrt{${n(g)}/${n(L)}} = ${n(omega)}\\ \\text{rad/s}`,
        },
      ],
    },
    {
      quantity: 'period_s',
      value: T,
      unit: 's',
      steps: [
        {
          label: 'Period is independent of both mass and amplitude — at small angles',
          latex: 'T = 2\\pi\\sqrt{L/g}',
          substituted: `T = 2\\pi\\sqrt{${n(L)}/${n(g)}} = ${n(T)}\\ \\text{s}\\quad (m = ${n(m)}\\ \\text{kg does not appear})`,
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
          substituted: `v_{max} \\approx (${n(omega)})(${n(L)})(${n(th0)}) = ${n(vMaxSmall)}\\ \\text{m/s}`,
        },
      ],
      ...(Math.abs(theta0_deg) > 20
        ? {
            caveat: `At ${n(theta0_deg)}° the small-angle approximation overpredicts peak speed by ${n(errPct, 1)}%. Below about 15° the two agree to under 1%.`,
          }
        : {}),
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
  }
}

/** Just the quantities the problem actually asked for, in the order asked. */
export function solveAsked(params: SimParams, asked: Askable[]): Solution[] {
  const all = solve(params)
  const byQuantity = new Map(all.map((s) => [s.quantity, s]))
  const picked = asked.map((q) => byQuantity.get(q)).filter((s): s is Solution => s !== undefined)
  return picked.length > 0 ? picked : all
}
