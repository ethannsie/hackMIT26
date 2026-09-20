/**
 * Stage [5]: hand -> force.
 *
 * Implements the "depth as touch" model from plan §7. The sim lives on a plane
 * at z = 0. Hovering in front of it is free-look; pushing THROUGH it applies a
 * force proportional to how far in you reach.
 *
 *   penetration = -palm_z            (positive once past the plane)
 *   F = clamp(k * penetration, 0, F_MAX)
 *
 * Grabbing is separate: pinch past the threshold near an interactable body
 * attaches it to the palm, and releasing throws it at the measured palm
 * velocity. That is where the projectile demo's launch speed comes from.
 */
import type Matter from 'matter-js'
import type { AppliedForce } from '../sim/world.ts'
import { matterVelToMs, pxToM } from '../sim/units.ts'
import { PINCH_GRAB, PINCH_RELEASE, type HandFrame } from './types.ts'

/** Newtons per metre of penetration. Tuned so a few cm of reach moves a 1 kg body. */
export const PUSH_STIFFNESS_N_PER_M = 400
/** Hard ceiling, so a fast lunge cannot launch a body off-screen. */
export const MAX_PUSH_N = 60
/** How close the palm must be to a body's centre to push or grab it, in metres. */
export const GRAB_RADIUS_M = 0.22

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
      return IDLE
    }

    // --- grab / release --------------------------------------------------
    if (this.grabbedId !== null) {
      if (hand.pinch < PINCH_RELEASE) {
        // Release: hand the body the palm's velocity. This is the throw.
        world.setVelocityMs(this.grabbedId, [hand.palm_velocity_ms.x, hand.palm_velocity_ms.y])
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
      const target = this.nearestInteractable(world, grabX, grabY)
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

    // --- push -------------------------------------------------------------
    const penetration = -hand.palm_m.z
    if (penetration <= 0) return IDLE // hovering in front of the plane: free-look

    const target = this.nearestInteractable(
      world,
      hand.palm_m.x,
      hand.palm_m.y,
      Math.max(GRAB_RADIUS_M, this.palmRadiusM(hand) + 0.16),
    )
    if (!target) {
      return { ...IDLE, contact: true, penetration_m: penetration, contactPoint_m: [hand.palm_m.x, hand.palm_m.y] }
    }

    this.resolvePalmCollision(world, target, hand)
    const magnitude = Math.min(PUSH_STIFFNESS_N_PER_M * penetration, MAX_PUSH_N)

    // Push along the palm's travel direction. A palm moving straight in with no
    // lateral motion pushes along its own normal instead.
    const vx = hand.palm_velocity_ms.x
    const vy = hand.palm_velocity_ms.y
    const speed = Math.hypot(vx, vy)
    const dir: [number, number] =
      speed > 0.05
        ? [vx / speed, vy / speed]
        : [hand.palm_normal?.x ?? 1, hand.palm_normal?.y ?? 0]

    return {
      contact: true,
      penetration_m: penetration,
      grabbedId: null,
      contactPoint_m: [hand.palm_m.x, hand.palm_m.y],
      force: { bodyId: target, force_n: [dir[0] * magnitude, dir[1] * magnitude] },
    }
  }

  private grabPoint(hand: HandFrame): [number, number] {
    const indexTip = hand.landmarks_m?.[8]
    return indexTip ? [indexTip.x, indexTip.y] : [hand.palm_m.x, hand.palm_m.y]
  }

  private palmRadiusM(hand: HandFrame): number {
    const points = hand.landmarks_m
    if (!points || points.length < 18) return 0.12
    const wristToMiddle = Math.hypot(points[0]!.x - points[9]!.x, points[0]!.y - points[9]!.y)
    const knuckleSpan = Math.hypot(points[5]!.x - points[17]!.x, points[5]!.y - points[17]!.y)
    return Math.max(0.08, Math.min(0.35, (wristToMiddle + knuckleSpan) * 0.34))
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
    const bodyRadius = Math.max(
      pxToM(body.bounds.max.x - body.bounds.min.x),
      pxToM(body.bounds.max.y - body.bounds.min.y),
    ) * 0.5
    const contactRadius = this.palmRadiusM(hand) + bodyRadius
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
      world.setVelocityMs(id, [
        bodyVelocity[0] + normal[0] * bounce,
        bodyVelocity[1] + normal[1] * bounce,
      ])
    }
  }

  /** Nearest pushable body within GRAB_RADIUS_M of the palm, or null. */
  private nearestInteractable(world: CouplableWorld, x: number, y: number, maxDistance = GRAB_RADIUS_M): string | null {
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
