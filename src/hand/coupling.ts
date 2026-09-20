/**
 * Stage [5]: hand -> force.
 *
 * Two gestures, nothing else touches the sim:
 *
 *   pinch  (thumb to index)  grabs the nearest interactable body, carries it,
 *                            and throws it at the palm's velocity on release.
 *                            That is where the projectile demo's launch speed
 *                            comes from.
 *   fist   (fingers curled)  pushes: a moving fist applies a force along its
 *                            own velocity to the body it reaches,
 *                            F = clamp(k * speed, 0, F_MAX), and bodies bounce
 *                            off the fist's circle. A resting fist applies
 *                            nothing.
 *
 * An open hand is free-look. The earlier "depth as touch" model (push whenever
 * the palm looked close enough to be past the plane) fired on every ordinary
 * hand movement, because the depth estimate is apparent hand size and a hand
 * near the camera is always "through the plane". palm_m.z is kept only for
 * the contact glow.
 */
import type Matter from 'matter-js'
import type { AppliedForce } from '../sim/world.ts'
import { matterVelToMs, pxToM } from '../sim/units.ts'
import { halfExtents } from '../sim/contain.ts'
import { FIST_CLOSE, FIST_OPEN, PINCH_GRAB, PINCH_RELEASE, type HandFrame } from './types.ts'

/** Newtons per m/s of fist speed. A 1 m/s punch on a 1 kg body is a firm shove. */
export const PUNCH_N_PER_M_S = 40
/** Hard ceiling, so a fast lunge cannot launch a body off-screen. */
export const MAX_PUSH_N = 60
/** Below this fist speed no force is applied: a fist held still is not a push. */
export const PUNCH_MIN_SPEED_M_S = 0.05
/**
 * Fastest a hand can launch a body, m/s. A real throw across the sim is a few
 * m/s; a tracking glitch on release can report fifty. Above this the body
 * outruns the collision detector and leaves the scene.
 */
export const MAX_THROW_M_S = 12

function capSpeed(v: [number, number], max: number): [number, number] {
  const speed = Math.hypot(v[0], v[1])
  return speed > max ? [(v[0] / speed) * max, (v[1] / speed) * max] : v
}

/**
 * The hand's own size on the sim plane, from its landmarks, in scene metres.
 *
 * This is the depth cue. The tracker has no range sensor; what it has is how
 * big the hand looks, and the landmarks arrive already mapped onto the scene,
 * so a hand near the camera is simply a large hand here and one far away a
 * small one. Deliberately unclamped (beyond sanity bounds): everything sized
 * from it — fist hitbox, grab reach, contact glow — then grows and shrinks
 * with the hand, at any zoom, which is what makes the drawn hitbox honest.
 */
export function palmRadiusM(hand: HandFrame): number {
  const points = hand.landmarks_m
  if (!points || points.length < 18) return 0.12 // the mouse mock: no landmarks
  const wristToMiddle = Math.hypot(points[0]!.x - points[9]!.x, points[0]!.y - points[9]!.y)
  const knuckleSpan = Math.hypot(points[5]!.x - points[17]!.x, points[5]!.y - points[17]!.y)
  return Math.max(0.03, Math.min(3, (wristToMiddle + knuckleSpan) * 0.34))
}

/** Fist hitbox radius as a multiple of the palm radius. ~2.2 palms: the fist plus a little air. */
export const FIST_REACH_PER_PALM = 2.2
/** Grab reach as a multiple of the palm radius. A pinch has to be nearly on the thing. */
export const GRAB_REACH_PER_PALM = 1.8
/** Floors, so a hand seen tiny and far away can still touch something. */
const MIN_REACH_M = 0.06

/**
 * How far from the palm centre a fist reaches, in metres. This is the hitbox:
 * a body whose centre is inside it gets pushed, one outside it is untouched.
 * The overlay draws exactly this circle so the user sees what will be hit —
 * and because it scales with the hand, a fist brought toward the camera
 * visibly grows its reach, and one pulled back shrinks it.
 */
export function fistReachM(hand: HandFrame): number {
  return Math.max(MIN_REACH_M, palmRadiusM(hand) * FIST_REACH_PER_PALM)
}

/** How close the grab point must be to a body's centre to pinch it, in metres. Same scaling. */
export function grabReachM(hand: HandFrame): number {
  return Math.max(MIN_REACH_M, palmRadiusM(hand) * GRAB_REACH_PER_PALM)
}

/**
 * The minimum a world must expose to be pushed by a hand.
 *
 * Both SimWorld and SandboxWorld satisfy this, so the same coupling drives a
 * solved problem and a composed scene without either knowing about the other.
 */
export interface CouplableWorld {
  readonly interactableIds: readonly string[]
  bodyById(id: string): Matter.Body | undefined
  setVelocityMs(id: string, v: [number, number]): void
  setPositionM(id: string, p: [number, number]): void
}

export interface CouplingState {
  contact: boolean
  penetration_m: number
  grabbedId: string | null
  /** Where fingertips cross the plane, for the contact glow. Sim-frame metres. */
  contactPoint_m: [number, number] | null
  force: AppliedForce | null
}

const IDLE: CouplingState = {
  contact: false,
  penetration_m: 0,
  grabbedId: null,
  contactPoint_m: null,
  force: null,
}

export class HandCoupling {
  private grabbedId: string | null = null
  /** Fist latch with hysteresis, so a push does not stutter at the threshold. */
  private fistLatched = false

  /** The latched fist state, so the overlay draws what the coupling is doing. */
  get fisted(): boolean {
    return this.fistLatched
  }

  /**
   * Work out what this hand is doing to the sim this step.
   *
   * Returns state for the renderer and a force for SimWorld.step(). Grabbing is
   * applied directly (it is a position constraint, not a force), so callers
   * should call this once per fixed step, not once per rendered frame.
   */
  update(world: CouplableWorld, hand: HandFrame | null): CouplingState {
    if (!hand) {
      this.grabbedId = null
      this.fistLatched = false
      return IDLE
    }

    // --- grab / release --------------------------------------------------
    if (this.grabbedId !== null) {
      if (hand.pinch < PINCH_RELEASE) {
        // Release: hand the body the palm's velocity. This is the throw.
        world.setVelocityMs(
          this.grabbedId,
          capSpeed([hand.palm_velocity_ms.x, hand.palm_velocity_ms.y], MAX_THROW_M_S),
        )
        this.grabbedId = null
      } else {
        const [holdX, holdY] = this.grabPoint(hand)
        world.setPositionM(this.grabbedId, [holdX, holdY])
        return {
          contact: true,
          penetration_m: Math.max(0, -hand.palm_m.z),
          grabbedId: this.grabbedId,
          contactPoint_m: [holdX, holdY],
          force: null,
        }
      }
    } else if (hand.pinch >= PINCH_GRAB) {
      // The index fingertip is the user's precise pointing/grab target. The
      // palm remains the anchor that carries the object after acquisition.
      const [grabX, grabY] = this.grabPoint(hand)
      const target = this.nearestInteractable(world, grabX, grabY, grabReachM(hand))
      if (target) {
        this.grabbedId = target
        return {
          contact: true,
          penetration_m: Math.max(0, -hand.palm_m.z),
          grabbedId: target,
          contactPoint_m: [hand.palm_m.x, hand.palm_m.y],
          force: null,
        }
      }
    }

    // --- push: only a closed fist pushes ------------------------------------
    const fist = hand.fist ?? 0
    if (this.fistLatched) {
      if (fist < FIST_OPEN) this.fistLatched = false
    } else if (fist >= FIST_CLOSE) {
      this.fistLatched = true
    }
    if (!this.fistLatched) return IDLE // open hand: free-look, disturbs nothing

    const glow = Math.max(0, -hand.palm_m.z)
    const target = this.nearestInteractable(world, hand.palm_m.x, hand.palm_m.y, fistReachM(hand))
    if (!target) {
      return { ...IDLE, contact: true, penetration_m: glow, contactPoint_m: [hand.palm_m.x, hand.palm_m.y] }
    }

    // Bodies bounce off the fist's circle whatever its speed...
    this.resolvePalmCollision(world, target, hand)

    // ...and a moving fist also shoves along its own travel. Speed sets the
    // magnitude, so a fist parked next to a body leaves it alone.
    const vx = hand.palm_velocity_ms.x
    const vy = hand.palm_velocity_ms.y
    const speed = Math.hypot(vx, vy)
    if (speed < PUNCH_MIN_SPEED_M_S) {
      return { ...IDLE, contact: true, penetration_m: glow, contactPoint_m: [hand.palm_m.x, hand.palm_m.y] }
    }
    const magnitude = Math.min(PUNCH_N_PER_M_S * speed, MAX_PUSH_N)
    const dir: [number, number] = [vx / speed, vy / speed]

    return {
      contact: true,
      penetration_m: glow,
      grabbedId: null,
      contactPoint_m: [hand.palm_m.x, hand.palm_m.y],
      force: { bodyId: target, force_n: [dir[0] * magnitude, dir[1] * magnitude] },
    }
  }

  private grabPoint(hand: HandFrame): [number, number] {
    const indexTip = hand.landmarks_m?.[8]
    return indexTip ? [indexTip.x, indexTip.y] : [hand.palm_m.x, hand.palm_m.y]
  }

  private resolvePalmCollision(world: CouplableWorld, id: string, hand: HandFrame): void {
    const body = world.bodyById(id)
    if (!body || body.isStatic) return

    const bodyX = pxToM(body.position.x)
    const bodyY = -pxToM(body.position.y)
    const dx = bodyX - hand.palm_m.x
    const dy = bodyY - hand.palm_m.y
    const distance = Math.hypot(dx, dy)
    const normal: [number, number] = distance > 1e-6
      ? [dx / distance, dy / distance]
      : [1, 0]
    // Shape extents, not `body.bounds`: Matter inflates bounds by the current
    // velocity for its broad phase, which made a fast ball's fist hitbox up to
    // twice its size. Same rule contain.ts follows.
    const [hw, hh] = halfExtents(body)
    const bodyRadius = pxToM(Math.max(hw, hh))
    const contactRadius = palmRadiusM(hand) + bodyRadius
    const overlap = contactRadius - distance
    if (overlap <= 0) return

    // Position correction prevents tunneling through the hand circle.
    world.setPositionM(id, [
      hand.palm_m.x + normal[0] * contactRadius,
      hand.palm_m.y + normal[1] * contactRadius,
    ])

    // Reflect only the incoming component; tangential motion is preserved.
    const bodyVelocity: [number, number] = [
      matterVelToMs(body.velocity.x),
      -matterVelToMs(body.velocity.y),
    ]
    const relativeNormal =
      (bodyVelocity[0] - hand.palm_velocity_ms.x) * normal[0] +
      (bodyVelocity[1] - hand.palm_velocity_ms.y) * normal[1]
    if (relativeNormal < 0) {
      const bounce = -(1 + 0.65) * relativeNormal
      world.setVelocityMs(id, capSpeed([
        bodyVelocity[0] + normal[0] * bounce,
        bodyVelocity[1] + normal[1] * bounce,
      ], MAX_THROW_M_S))
    }
  }

  /** Nearest pushable body within `maxDistance` of a point, or null. */
  private nearestInteractable(world: CouplableWorld, x: number, y: number, maxDistance: number): string | null {
    let best: string | null = null
    let bestDist = maxDistance

    for (const id of world.interactableIds) {
      const body = world.bodyById(id)
      if (!body) continue
      const d = Math.hypot(pxToM(body.position.x) - x, -pxToM(body.position.y) - y)
      if (d < bestDist) {
        bestDist = d
        best = id
      }
    }
    return best
  }
}
