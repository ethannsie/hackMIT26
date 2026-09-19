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
import { pxToM } from '../sim/units.ts'
import { PINCH_GRAB, PINCH_RELEASE, type HandFrame } from './types.ts'

/** Newtons per metre of penetration. Tuned so a few cm of reach moves a 1 kg body. */
export const PUSH_STIFFNESS_N_PER_M = 400
/** Hard ceiling, so a fast lunge cannot launch a body off-screen. */
export const MAX_PUSH_N = 60
/** How close the palm must be to a body's centre to grab it, in metres. */
export const GRAB_RADIUS_M = 0.12

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
        world.setPositionM(this.grabbedId, [hand.palm_m.x, hand.palm_m.y])
        return {
          contact: true,
          penetration_m: Math.max(0, -hand.palm_m.z),
          grabbedId: this.grabbedId,
          contactPoint_m: [hand.palm_m.x, hand.palm_m.y],
          force: null,
        }
      }
    } else if (hand.pinch >= PINCH_GRAB) {
      const target = this.nearestInteractable(world, hand.palm_m.x, hand.palm_m.y)
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

    const target = this.nearestInteractable(world, hand.palm_m.x, hand.palm_m.y)
    if (!target) {
      return { ...IDLE, contact: true, penetration_m: penetration, contactPoint_m: [hand.palm_m.x, hand.palm_m.y] }
    }

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

  /** Nearest pushable body within GRAB_RADIUS_M of the palm, or null. */
  private nearestInteractable(world: CouplableWorld, x: number, y: number): string | null {
    let best: string | null = null
    let bestDist = GRAB_RADIUS_M

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
