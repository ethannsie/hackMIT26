/**
 * What a composed scene can still tell you, once closed forms are gone.
 *
 * A block sliding into a pendulum into a spring has no textbook answer. But the
 * conservation laws never stopped applying, and unlike a closed form they hold
 * for ANY arrangement of components. So the sandbox panel shows those.
 *
 * The important half is honesty about which ones SHOULD hold. Energy is not
 * conserved when a surface has friction, and momentum is not conserved when a
 * wall is there to push back. A panel that showed "energy: drifting 12%" without
 * saying "because you set friction to 0.3" would be teaching the wrong lesson.
 * So each law is reported together with whether this scene permits it, and the
 * specific components responsible when it does not.
 */
import type { SandboxWorld } from './world.ts'
import type { SandboxScene } from './types.ts'

export interface Conservation {
  name: string
  /** Whether this scene's components permit the law to hold. */
  expected: boolean
  /** Why not, naming the components responsible. Empty when expected. */
  reasons: string[]
  initial: number
  current: number
  /** Absolute change from the initial value, in `unit`. */
  drift_abs: number
  /**
   * Change as a percent of the energy (or momentum) actually in play.
   *
   * NOT a percent of the raw total. Gravitational potential energy is measured
   * from an arbitrary zero, so a pendulum hanging 4 m above the origin carries
   * ~30 J of offset that has nothing to do with its 2.8 J swing. Dividing by
   * that hides real drift behind a big denominator — it made a pendulum losing
   * 76% of its swing read as "7%". The scale here is the dynamic range: the
   * largest kinetic + spring energy seen, and the span of height actually used.
   */
  drift_pct: number
  unit: string
}

export interface Invariants {
  /** Percent change in total energy relative to an earlier sample. */
  drift(from: Invariants): number
  time_s: number
  kinetic_j: number
  potential_gravity_j: number
  potential_spring_j: number
  total_energy_j: number
  momentum_ms: [number, number]
  momentum_magnitude: number
  angular_momentum_kgm2s: number
  laws: Conservation[]
}

/**
 * Which laws this scene permits, and what breaks them.
 *
 * Deliberately conservative: anything that MIGHT dissipate or apply an external
 * force counts against the law. Better to say "energy should not be conserved
 * here" and have it hold anyway than to promise conservation and drift.
 */
function analyse(scene: SandboxScene): {
  energy: string[]
  momentum: string[]
  angular: string[]
} {
  const energy: string[] = []
  const momentum: string[] = []
  const angular: string[] = []

  if (scene.ground) {
    momentum.push('the ground pushes up on whatever lands on it')
    angular.push('the ground exerts an external torque')
  }
  if (scene.gravity_ms2 !== 0) {
    momentum.push(`gravity (${scene.gravity_ms2} m/s²) is an external force on every body`)
  }

  for (const e of scene.entities) {
    switch (e.kind) {
      case 'ball':
      case 'box':
        if (e.friction > 0) energy.push(`${e.id} has friction ${e.friction}`)
        if (e.restitution < 1) energy.push(`${e.id} has bounciness ${e.restitution} — collisions lose energy`)
        break
      case 'ramp':
        if (e.friction > 0) energy.push(`${e.id} has friction μ = ${e.friction}`)
        momentum.push(`${e.id} is fixed in place and pushes back`)
        angular.push(`${e.id} exerts an external torque`)
        break
      case 'wall':
        if (e.friction > 0) energy.push(`${e.id} has friction ${e.friction}`)
        if (e.restitution < 1) energy.push(`${e.id} has bounciness ${e.restitution}`)
        momentum.push(`${e.id} is fixed in place and pushes back`)
        angular.push(`${e.id} exerts an external torque`)
        break
      case 'pendulum':
        momentum.push(`${e.id}'s pivot holds it in place`)
        break
      case 'spring':
        momentum.push(`${e.id}'s anchor holds it in place`)
        break
      case 'magnet_region':
        // A magnetic force does no work, so energy survives. It does change
        // direction, so momentum and angular momentum do not.
        momentum.push(`${e.id} deflects charged bodies`)
        angular.push(`${e.id} deflects charged bodies`)
        break
    }
  }

  return { energy, momentum, angular }
}

export class InvariantTracker {
  private initial: { energy: number; px: number; py: number; L: number } | null = null

  // Running extremes, used to size "how much is actually in play".
  private dynamicMax = 0
  private peMin = Infinity
  private peMax = -Infinity
  private pMax = 0
  private lMax = 0

  /** Forget the baseline, so the next sample restarts the comparison. */
  reset(): void {
    this.initial = null
    this.dynamicMax = 0
    this.peMin = Infinity
    this.peMax = -Infinity
    this.pMax = 0
    this.lMax = 0
  }

  sample(world: SandboxWorld): Invariants {
    const states = world.states()
    const g = world.scene.gravity_ms2

    let kinetic = 0
    let potentialG = 0
    let px = 0
    let py = 0
    let L = 0

    for (const s of states) {
      kinetic += s.kinetic_j
      potentialG += s.mass_kg * g * s.position_m[1]
      px += s.mass_kg * s.velocity_ms[0]
      py += s.mass_kg * s.velocity_ms[1]
      // L_z about the scene origin: m (x·vy − y·vx)
      L += s.mass_kg * (s.position_m[0] * s.velocity_ms[1] - s.position_m[1] * s.velocity_ms[0])
    }

    const potentialS = world.springEnergy_j()
    const total = kinetic + potentialG + potentialS

    if (this.initial === null) {
      this.initial = { energy: total, px, py, L }
    }
    const init = this.initial

    this.dynamicMax = Math.max(this.dynamicMax, kinetic + potentialS)
    this.peMin = Math.min(this.peMin, potentialG)
    this.peMax = Math.max(this.peMax, potentialG)
    const pNow = Math.hypot(px, py)
    this.pMax = Math.max(this.pMax, pNow, Math.hypot(init.px, init.py))
    this.lMax = Math.max(this.lMax, Math.abs(L), Math.abs(init.L))

    // The energy genuinely in play: the largest kinetic + spring store seen, and
    // the span of gravitational PE actually traversed.
    const energyScale = Math.max(
      this.dynamicMax,
      Number.isFinite(this.peMax - this.peMin) ? this.peMax - this.peMin : 0,
      1e-6,
    )

    const pct = (delta: number, scale: number): number =>
      scale < 1e-9 ? (Math.abs(delta) < 1e-9 ? 0 : 100) : (delta / scale) * 100

    const broken = analyse(world.scene)

    const laws: Conservation[] = [
      {
        name: 'Total energy',
        expected: broken.energy.length === 0,
        reasons: broken.energy,
        initial: init.energy,
        current: total,
        drift_abs: total - init.energy,
        drift_pct: pct(total - init.energy, energyScale),
        unit: 'J',
      },
      {
        name: 'Linear momentum',
        expected: broken.momentum.length === 0,
        reasons: broken.momentum,
        initial: Math.hypot(init.px, init.py),
        current: pNow,
        drift_abs: pNow - Math.hypot(init.px, init.py),
        drift_pct: pct(pNow - Math.hypot(init.px, init.py), Math.max(this.pMax, 1e-6)),
        unit: 'kg·m/s',
      },
      {
        name: 'Angular momentum about origin',
        expected: broken.angular.length === 0,
        reasons: broken.angular,
        initial: init.L,
        current: L,
        drift_abs: L - init.L,
        drift_pct: pct(L - init.L, Math.max(this.lMax, 1e-6)),
        unit: 'kg·m²/s',
      },
    ]

    return {
      // Energy drift as a percent of the energy actually in play, not of the
      // raw total — see the note on Conservation.drift_pct.
      drift(from: Invariants): number {
        return pct(this.total_energy_j - from.total_energy_j, energyScale)
      },
      time_s: world.time_s,
      kinetic_j: kinetic,
      potential_gravity_j: potentialG,
      potential_spring_j: potentialS,
      total_energy_j: total,
      momentum_ms: [px, py],
      momentum_magnitude: Math.hypot(px, py),
      angular_momentum_kgm2s: L,
      laws,
    }
  }
}
