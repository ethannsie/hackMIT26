/**
 * Free-body diagrams.
 *
 * The forces are derived analytically from each problem's own parameters, not
 * read out of the solver. Matter's internal `body.force` is a penetration-
 * resolution artefact mid-collision rather than the physical force, so drawing
 * it would put a meaningless arrow next to a correct equation.
 *
 * Every vector here is in newtons with +y UP, matching the derivation panel.
 */
import type { SimParams } from './params.ts'
import type { BodyState } from './world.ts'

export type ForceKind = 'weight' | 'normal' | 'friction' | 'tension' | 'applied' | 'net'

export interface ForceVector {
  /** Short symbol drawn at the arrow head. */
  label: string
  /** Full name, for the legend. */
  name: string
  /** Newtons, y UP. */
  vec_n: [number, number]
  magnitude_n: number
  kind: ForceKind
}

const DEG = Math.PI / 180

function vec(label: string, name: string, kind: ForceKind, x: number, y: number): ForceVector {
  return { label, name, kind, vec_n: [x, y], magnitude_n: Math.hypot(x, y) }
}

/**
 * Forces on the focus body of a problem.
 *
 * `state` supplies the live position and velocity, so the diagram tracks the
 * motion — friction flips when the body reverses, tension grows at the bottom
 * of a swing.
 */
export function forcesFor(params: SimParams, state: BodyState): ForceVector[] {
  const m = state.mass_kg
  if (m <= 0) return []

  switch (params.kind) {
    case 'projectile': {
      const W = vec('W', 'Weight', 'weight', 0, -m * params.g)
      return [W, netOf([W])]
    }

    case 'inclined_plane': {
      const th = params.angle_deg * DEG
      // Downhill direction and outward surface normal, both y-up.
      const d: [number, number] = [Math.cos(th), -Math.sin(th)]
      const n: [number, number] = [Math.sin(th), Math.cos(th)]

      const W = vec('W', 'Weight', 'weight', 0, -m * params.g)
      const Nmag = m * params.g * Math.cos(th)
      const N = vec('N', 'Normal force', 'normal', n[0] * Nmag, n[1] * Nmag)

      // Friction opposes motion along the slope; at rest it holds, up to μN.
      const vAlong = state.velocity_ms[0] * d[0] + state.velocity_ms[1] * d[1]
      const driving = m * params.g * Math.sin(th)
      let fMag: number
      if (Math.abs(vAlong) < 1e-3) {
        fMag = Math.min(driving, params.mu_kinetic * Nmag)
      } else {
        fMag = params.mu_kinetic * Nmag
      }
      const sign = Math.abs(vAlong) < 1e-3 ? 1 : Math.sign(vAlong)
      const f = vec('f', 'Friction', 'friction', -d[0] * sign * fMag, -d[1] * sign * fMag)

      const list = [W, N, f]
      return [...list, netOf(list)]
    }

    case 'pendulum': {
      const W = vec('W', 'Weight', 'weight', 0, -m * params.g)

      // Angle from vertical, from the bob's position relative to the pivot.
      const L = params.length_m
      const pivotY = L + 0.3
      const dx = state.position_m[0]
      const dy = state.position_m[1] - pivotY
      const r = Math.hypot(dx, dy) || L
      // Unit vector from bob toward the pivot: tension pulls this way.
      const ux = -dx / r
      const uy = -dy / r

      const cosTheta = -dy / r
      const speed = state.speed_ms
      // T = mg cos θ + m v² / L — the weight component plus what is needed to
      // keep the bob on its arc.
      const T = m * params.g * cosTheta + (m * speed * speed) / L
      const Tv = vec('T', 'Rod tension', 'tension', ux * T, uy * T)

      const list = [W, Tv]
      return [...list, netOf(list)]
    }

    case 'collision_1d': {
      // collision_1d carries no gravity term of its own; the carts sit on a
      // track under standard gravity.
      const g = 9.81
      const W = vec('W', 'Weight', 'weight', 0, -m * g)
      const N = vec('N', 'Normal force', 'normal', 0, m * g)
      // Between collisions these cancel and the cart coasts; the collision
      // itself is impulsive and too brief to draw meaningfully.
      return [W, N, netOf([W, N])]
    }

    case 'rolling_without_slipping': {
      const W = vec('W', 'Weight', 'weight', 0, -m * params.g)
      const N = vec('N', 'Normal force', 'normal', 0, m * params.g)
      const list = [W, N]
      return [
        ...list,
        {
          ...netOf(list),
          name: 'Net force (zero — rolling at constant speed does not need one)',
        },
      ]
    }

    case 'circular_motion': {
      // The string supplies exactly the centripetal force, pointing at the centre.
      const R = params.radius_m
      const centreY = R + 0.4
      const dx = -state.position_m[0]
      const dy = centreY - state.position_m[1]
      const r = Math.hypot(dx, dy) || R
      const Fc = (m * params.speed_ms * params.speed_ms) / R
      const T = vec('T', 'String tension (centripetal)', 'tension', (dx / r) * Fc, (dy / r) * Fc)
      return [T, { ...netOf([T]), name: 'Net force — points at the centre, where nothing is moving' }]
    }

    case 'charged_particle_magnetic': {
      const qB = params.charge_c * params.b_field_tesla
      const [vx, vy] = state.velocity_ms
      // F = qv × B, with B out of the page: (q v_y B, −q v_x B).
      const F = vec('F', 'Magnetic force qv × B', 'applied', qB * vy, -qB * vx)
      return [F, { ...netOf([F]), name: 'Net force — always perpendicular to v, so it does no work' }]
    }

    case 'rotating_frame': {
      const w = params.omega_rads
      const [x, y] = state.position_m
      const [vx, vy] = state.velocity_ms
      const cf = vec('F_cf', 'Centrifugal (pseudo)', 'applied', m * w * w * x, m * w * w * y)
      const cor = vec('F_Cor', 'Coriolis (pseudo)', 'friction', m * 2 * w * vy, m * -2 * w * vx)
      const list = [cf, cor]
      return [
        ...list,
        { ...netOf(list), name: 'Net force — neither term has a third-law partner' },
      ]
    }

    case 'angular_momentum_point': {
      return [
        {
          label: '0',
          name: 'No force acts — which is why L cannot change',
          kind: 'net',
          vec_n: [0, 0],
          magnitude_n: 0,
        },
      ]
    }
  }
}

function netOf(list: ForceVector[]): ForceVector {
  let x = 0
  let y = 0
  for (const f of list) {
    x += f.vec_n[0]
    y += f.vec_n[1]
  }
  return vec('ΣF', 'Net force', 'net', x, y)
}

/** Colours per force kind, consistent across both modes. */
export const FORCE_COLORS: Record<ForceKind, string> = {
  weight: '#d95926',
  normal: '#3987e5',
  friction: '#c792ea',
  tension: '#199e70',
  applied: '#ffd166',
  net: '#ff7b72',
}
