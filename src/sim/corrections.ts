/**
 * Exact physics for the two places Matter's contact models are not good enough
 * to put in front of a student.
 *
 * Measured against the closed forms (see scripts/verify-sims.ts):
 *
 *   Frictionless incline   exact, ratio 1.000 — gravity and geometry are fine
 *   Incline with mu > 0    Matter's friction is a damping model, not Coulomb.
 *                          Even mu = 0.05 pins the block: measured a = 0.008
 *                          against an expected 3.701 m/s².
 *   Collision at e = 0     exact
 *   Collision at e = 1     under-applied: equal masses give 0.375 / 1.625
 *                          instead of a clean 0 / 2 exchange.
 *
 * So for these two cases we disable Matter's model and impose the textbook one:
 * Coulomb friction as a real force, and an exact restitution impulse at contact.
 * This is not cheating the engine — it is the same choice as hand-writing each
 * sim (plan §6). Everything else, including every hand-driven interaction, still
 * goes through Matter normally.
 *
 * The rule we are protecting: the animation and the derivation panel must never
 * disagree, because a student will read both at once.
 */
import Matter from 'matter-js'
import { PX_PER_M, mToPx, pxToM, msToMatterVel, matterVelToMs, FIXED_DT_S, DEG } from './units.ts'
import type { SimParams } from './params.ts'
import type { BuiltScene } from './builders.ts'

const { Events, Body } = Matter

const FORCE_N_TO_MATTER = PX_PER_M / 1e6

export interface Corrections {
  /** Runs immediately before each Engine.update. */
  preStep(): void
  /** Detaches event listeners, so reset() does not leak them. */
  dispose(): void
}

const NONE: Corrections = { preStep() {}, dispose() {} }

/**
 * Coulomb friction on the incline, applied as an explicit force.
 *
 * Matter's own friction is zeroed by the builder when this is active, so this is
 * the only tangential force on the block.
 */
function inclineFriction(
  engine: Matter.Engine,
  scene: BuiltScene,
  p: Extract<SimParams, { kind: 'inclined_plane' }>,
): Corrections {
  const block = scene.byId['block']
  const ramp = scene.byId['ramp']
  if (!block || !ramp) return NONE

  const th = p.angle_deg * DEG
  const sin = Math.sin(th)
  const cos = Math.cos(th)
  // Same ramp geometry the builder used: top of the slope at the origin's
  // height, running down and to the right. Matter is y-down.
  const L = mToPx(p.ramp_length_m)
  const top = { x: 0, y: -L * sin }
  const down = { x: cos, y: sin }
  const normal = { x: sin, y: -cos }

  // Contact is determined GEOMETRICALLY, not from the solver's pair list.
  //
  // Both collisionStart/End events and the live pair list are too jittery here:
  // a rolling sphere micro-bounces and registers contact on only ~41% of steps,
  // so the correcting force lands on a fraction of them and the sphere
  // accelerates at 95% of the sliding value instead of the correct 5/7.
  //
  // The ramp is a fixed line, so the distance from the body centre to its
  // surface is exact and jitter-free.
  const restOffset = block.circleRadius && block.circleRadius > 0
    ? block.circleRadius
    : mToPx(0.08) / 2
  const contactTol = restOffset + mToPx(0.02)

  const touchingRamp = (): boolean => {
    const dx = block.position.x - top.x
    const dy = block.position.y - top.y
    // Perpendicular distance from the ramp surface, positive on the outside.
    const perp = dx * normal.x + dy * normal.y
    // And how far along the ramp we are, so a body past either end is not "on" it.
    const along = dx * down.x + dy * down.y
    return perp > 0 && perp < contactTol && along > -contactTol && along < L + contactTol
  }

  // Normal force from the textbook, not from the contact solver: N = mg cos(theta).
  const m = p.mass_kg
  const N = m * p.g * cos
  const gravityAlong = m * p.g * sin // driving force down the slope
  const maxStatic = p.mu_kinetic * N

  return {
    preStep(): void {
      if (!touchingRamp()) return

      // Speed along the slope, signed: positive means sliding downhill.
      const vDown =
        matterVelToMs(block.velocity.x) * down.x + matterVelToMs(block.velocity.y) * down.y

      if (p.motion === 'rolling') {
        // Rolling without slipping: a = (5/7) g sin(theta). Static friction does
        // no work here, it just diverts 2/7 of the drive into rotation, so model
        // it as a constant retarding force rather than as Coulomb friction.
        const retard = (2 / 7) * gravityAlong
        Body.applyForce(block, block.position, {
          x: -down.x * retard * FORCE_N_TO_MATTER,
          y: -down.y * retard * FORCE_N_TO_MATTER,
        })
        // Keep the visible spin consistent with rolling without slipping.
        const r = block.circleRadius ?? 1
        Body.setAngularVelocity(block, msToMatterVel(vDown) / r)
        return
      }

      if (Math.abs(vDown) < 1e-3) {
        // At rest. Static friction holds it unless gravity along the slope wins.
        if (gravityAlong <= maxStatic) {
          Body.setVelocity(block, { x: 0, y: 0 })
          Body.applyForce(block, block.position, {
            x: -down.x * gravityAlong * FORCE_N_TO_MATTER,
            y: -down.y * gravityAlong * FORCE_N_TO_MATTER,
          })
        }
        return
      }

      // Kinetic friction: magnitude mu*N, always opposing motion.
      const f = p.mu_kinetic * N
      const sign = vDown > 0 ? 1 : -1
      Body.applyForce(block, block.position, {
        x: -down.x * sign * f * FORCE_N_TO_MATTER,
        y: -down.y * sign * f * FORCE_N_TO_MATTER,
      })
    },
    dispose(): void {},
  }
}

/**
 * Exact 1D restitution impulse, applied once when the carts first touch.
 *
 * The carts carry restitution 0 so Matter's own solver only separates the
 * overlap; the velocity exchange is entirely ours and matches analytic.ts.
 */
function collisionImpulse(
  engine: Matter.Engine,
  scene: BuiltScene,
  p: Extract<SimParams, { kind: 'collision_1d' }>,
): Corrections {
  const c1 = scene.byId['cart1']
  const c2 = scene.byId['cart2']
  if (!c1 || !c2) return NONE

  let resolved = false

  // Velocities captured at the START of each step, while Matter has them
  // normalised. Inside a collisionStart handler we are mid-Engine.update, where
  // body.velocity is still raw per-step displacement — reading it there gives
  // half the true value and silently halves the transferred momentum.
  let u1 = matterVelToMs(c1.velocity.x)
  let u2 = matterVelToMs(c2.velocity.x)

  const onStart = (e: Matter.IEventCollision<Matter.Engine>): void => {
    if (resolved) return
    const hit = e.pairs.some(
      (pair) =>
        (pair.bodyA === c1 && pair.bodyB === c2) || (pair.bodyA === c2 && pair.bodyB === c1),
    )
    if (!hit) return

    // Pre-contact velocities, not the spec's initial values — the hand may have
    // pushed a cart on its way here.
    const { m1_kg: m1, m2_kg: m2, restitution: e_ } = p
    const M = m1 + m2
    const pTot = m1 * u1 + m2 * u2

    const v1 = (pTot + m2 * e_ * (u2 - u1)) / M
    const v2 = (pTot + m1 * e_ * (u1 - u2)) / M

    Body.setVelocity(c1, { x: msToMatterVel(v1), y: c1.velocity.y })
    Body.setVelocity(c2, { x: msToMatterVel(v2), y: c2.velocity.y })
    resolved = true
  }

  Events.on(engine, 'collisionStart', onStart)

  return {
    preStep(): void {
      if (resolved) return
      u1 = matterVelToMs(c1.velocity.x)
      u2 = matterVelToMs(c2.velocity.x)
    },
    dispose(): void {
      Events.off(engine, 'collisionStart', onStart)
    },
  }
}


/**
 * The rolling constraint, held every step: omega = v / r.
 *
 * Matter's friction cannot produce rolling without slipping (see the note at the
 * top of this file), so rather than fight it we impose the constraint directly.
 * The wheel's spin is then exactly consistent with its translation, which is
 * what makes the contact point genuinely stationary and the top point genuinely
 * move at 2v — the two numbers the whole sim exists to show.
 */
function rollingConstraint(scene: BuiltScene): Corrections {
  const wheel = scene.byId['wheel']
  if (!wheel) return NONE
  const r = wheel.circleRadius ?? 1

  return {
    preStep(): void {
      // Both sides are in Matter's normalised units, so the ratio is the
      // angular velocity in radians per the same interval.
      Body.setAngularVelocity(wheel, wheel.velocity.x / r)
    },
    dispose(): void {},
  }
}

/**
 * A charged particle in a magnetic field, advanced by rotating its velocity
 * rather than by applying a force.
 *
 * Applying F = qv x B as an explicit force does not work here. A force applied
 * once per step is explicit Euler on a pure rotation, which is unconditionally
 * unstable: the speed grows by a factor of sqrt(1 + (omega*dt)^2) every step.
 * Measured, that inflated the orbit 23x and the speed by 2175% over one run —
 * on the one sim whose entire point is that a magnetic field CANNOT change a
 * particle's speed.
 *
 * So instead we do what plasma codes do (the Boris push): rotate the velocity
 * vector through the exact angle it should turn in one timestep,
 *
 *     phi = -(qB/m) * dt
 *
 * A rotation preserves length identically, so the speed is conserved to machine
 * precision and the gyroradius comes out at exactly mv/|q|B. The physics is not
 * approximated — it is integrated in the form that respects what the force does.
 */
function magneticRotation(
  scene: BuiltScene,
  p: Extract<SimParams, { kind: 'charged_particle_magnetic' }>,
): Corrections {
  const particle = scene.byId['particle']
  if (!particle) return NONE

  // Cyclotron angular frequency. The sign carries the sense of the orbit, which
  // reverses with either the charge or the field.
  const omegaC = (p.charge_c * p.b_field_tesla) / p.mass_kg
  const phi = -omegaC * FIXED_DT_S
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)

  return {
    preStep(): void {
      // Work in physics convention (y up), then convert back.
      const vx = particle.velocity.x
      const vy = -particle.velocity.y

      const rx = vx * cos - vy * sin
      const ry = vx * sin + vy * cos

      Body.setVelocity(particle, { x: rx, y: -ry })
    },
    dispose(): void {},
  }
}

/**
 * Uniform circular motion, held exactly on its circle.
 *
 * Matter's constraint solver leaks energy around a full revolution — measured at
 * a 38% speed swing per orbit, which is fatal for a sim whose whole claim is
 * that the SPEED is constant while the VELOCITY is not. So each step we re-impose
 * the two things "uniform circular motion" actually asserts: the radius is fixed,
 * and the velocity is tangential with constant magnitude.
 *
 * This is a stipulated motion, not an emergent one. The lesson is the geometry —
 * that the acceleration points at the centre where nothing is moving, while the
 * velocity points along the tangent — and that geometry is exact here.
 */
function uniformCircularMotion(
  scene: BuiltScene,
  p: Extract<SimParams, { kind: 'circular_motion' }>,
): Corrections {
  const ball = scene.byId['ball']
  const pivot = scene.byId['pivot']
  if (!ball || !pivot) return NONE

  const R = mToPx(p.radius_m)
  const speed = msToMatterVel(p.speed_ms)

  return {
    preStep(): void {
      const dx = ball.position.x - pivot.position.x
      const dy = ball.position.y - pivot.position.y
      const r = Math.hypot(dx, dy)
      if (r < 1e-9) return

      // Snap back onto the circle.
      Body.setPosition(ball, {
        x: pivot.position.x + (dx / r) * R,
        y: pivot.position.y + (dy / r) * R,
      })

      // Tangent, perpendicular to the radius. Keep whichever way it was going.
      const tx = -dy / r
      const ty = dx / r
      const sense = ball.velocity.x * tx + ball.velocity.y * ty >= 0 ? 1 : -1
      Body.setVelocity(ball, { x: tx * sense * speed, y: ty * sense * speed })
    },
    dispose(): void {},
  }
}

/**
 * Centrifugal and Coriolis pseudo-forces, in a frame rotating at omega.
 *
 *   a_cf  = omega² r          outward, depends on POSITION
 *   a_cor = -2 omega x v      sideways, depends on VELOCITY
 *
 * Applying them as forces is the honest way to show what they are: the terms
 * you must invent to keep F = ma working in a frame that is itself turning.
 * Neither has a third-law partner, and the sim will not pretend otherwise.
 */
function rotatingFrameForces(
  scene: BuiltScene,
  p: Extract<SimParams, { kind: 'rotating_frame' }>,
): Corrections {
  const particle = scene.byId['particle']
  if (!particle) return NONE

  const w = p.omega_rads
  const m = p.mass_kg

  return {
    preStep(): void {
      const x = pxToM(particle.position.x)
      const y = -pxToM(particle.position.y) // to y-up
      const vx = matterVelToMs(particle.velocity.x)
      const vy = -matterVelToMs(particle.velocity.y)

      // Centrifugal: outward along r.
      const cfx = w * w * x
      const cfy = w * w * y

      // Coriolis: -2 (omega z-hat) x v.
      const corx = 2 * w * vy
      const cory = -2 * w * vx

      Body.applyForce(particle, particle.position, {
        x: m * (cfx + corx) * FORCE_N_TO_MATTER,
        y: -m * (cfy + cory) * FORCE_N_TO_MATTER,
      })
    },
    dispose(): void {},
  }
}

export function installCorrections(
  engine: Matter.Engine,
  scene: BuiltScene,
  params: SimParams,
): Corrections {
  switch (params.kind) {
    case 'inclined_plane':
      return inclineFriction(engine, scene, params)
    case 'collision_1d':
      return collisionImpulse(engine, scene, params)
    case 'rolling_without_slipping':
      return rollingConstraint(scene)
    case 'charged_particle_magnetic':
      return magneticRotation(scene, params)
    case 'circular_motion':
      return uniformCircularMotion(scene, params)
    case 'rotating_frame':
      return rotatingFrameForces(scene, params)

    // Projectile is drag-free ballistics and the pendulum rod already tracks
    // T = 2*pi*sqrt(L/g) to 0.1%. The angular-momentum particle is genuinely
    // force-free: its whole point is that L is constant with nothing acting.
    case 'projectile':
    case 'pendulum':
    case 'angular_momentum_point':
      return NONE
  }
}
