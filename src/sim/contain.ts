/**
 * Hard containment: nothing leaves the box, whatever its speed.
 *
 * Matter has no continuous collision detection. A body that moves more than a
 * wall's thickness in one 8 ms step is on the far side before the wall is ever
 * consulted, and a grabbed body is not moving at all — it is teleported to the
 * palm each step, so dragging it past a wall carries it straight through. The
 * walls are still there for the ordinary bounces; this is the guarantee behind
 * them. After every step each movable body is checked against the box its
 * scene allows and, if any part of it is outside, put back on the inside face
 * with the incoming velocity component reflected. Grab positions are clamped
 * the same way before they are applied.
 *
 * Coordinates are Matter pixels, y DOWN: `top` is the smaller y.
 */
import Matter from 'matter-js'
import { msToMatterVel } from './units.ts'

const { Body } = Matter

export interface PxBox {
  minX: number
  maxX: number
  /** Smallest y (the ceiling). */
  top: number
  /** Largest y (the floor). */
  bottom: number
}

/** Bounce kept when a body is pushed back inside. Matches the border walls. */
const CONTAIN_RESTITUTION = 0.6

/**
 * Speed ceiling, m/s. Nothing in the library or a human throw legitimately
 * exceeds this; a tracking glitch that reports a 200 m/s palm does. Above it,
 * tunneling is guaranteed and the readouts are nonsense.
 */
export const MAX_SPEED_MS = 60

/**
 * Half extents of the body's actual shape, in px.
 *
 * Not `body.bounds`: Matter inflates those by the current velocity for its
 * broad phase, so a ball falling at 13 m/s reported itself twice its size
 * and was held 11 cm above the floor.
 */
export function halfExtents(body: Matter.Body): [number, number] {
  if (body.circleRadius && body.circleRadius > 0) return [body.circleRadius, body.circleRadius]
  let hw = 0
  let hh = 0
  for (const v of body.vertices) {
    hw = Math.max(hw, Math.abs(v.x - body.position.x))
    hh = Math.max(hh, Math.abs(v.y - body.position.y))
  }
  return [hw, hh]
}

/** A point clamped so a body of this size centred there fits in the box. */
export function clampCentre(
  x: number,
  y: number,
  box: PxBox,
  hw: number,
  hh: number,
): [number, number] {
  const cx = box.maxX - hw < box.minX + hw
    ? (box.minX + box.maxX) / 2
    : Math.min(box.maxX - hw, Math.max(box.minX + hw, x))
  const cy = box.bottom - hh < box.top + hh
    ? (box.top + box.bottom) / 2
    : Math.min(box.bottom - hh, Math.max(box.top + hh, y))
  return [cx, cy]
}

/**
 * Keep one body inside the box. Returns true if it had to be moved.
 * Static bodies are left alone; they are the box.
 */
export function containBody(body: Matter.Body, box: PxBox): boolean {
  if (body.isStatic) return false
  const [hw, hh] = halfExtents(body)
  const { x, y } = body.position
  let vx = body.velocity.x
  let vy = body.velocity.y

  const finite = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(vx) && Number.isFinite(vy)
  // Only a centre that has crossed a face counts. Ordinary contact leaves a
  // body a few px into a wall with its centre still inside, and that is
  // Matter's to resolve with the pair's own restitution; stepping in earlier
  // would replace every floor bounce with this one. Past the face Matter would
  // push the body out the far side, so it comes back here.
  const crossed = finite && (x < box.minX || x > box.maxX || y < box.top || y > box.bottom)
  let cx = x
  let cy = y
  if (!finite) {
    cx = (box.minX + box.maxX) / 2
    cy = (box.top + box.bottom) / 2
  } else if (crossed) {
    ;[cx, cy] = clampCentre(x, y, box, hw, hh)
  }

  let moved = !finite || crossed
  if (moved && finite) {
    // Reflect only the component that was heading out.
    if ((cx > x && vx < 0) || (cx < x && vx > 0)) vx = -vx * CONTAIN_RESTITUTION
    if ((cy > y && vy < 0) || (cy < y && vy > 0)) vy = -vy * CONTAIN_RESTITUTION
  } else if (!finite) {
    vx = 0
    vy = 0
  }

  // Speed ceiling, independent of position.
  const cap = msToMatterVel(MAX_SPEED_MS)
  const speed = Math.hypot(vx, vy)
  if (speed > cap) {
    vx *= cap / speed
    vy *= cap / speed
    moved = true
  }

  if (!moved) return false
  Body.setPosition(body, { x: cx, y: cy })
  Body.setVelocity(body, { x: vx, y: vy })
  return true
}

/** Clamp a target centre for `body` into the box, in px. */
export function clampBodyCentre(body: Matter.Body, x: number, y: number, box: PxBox): [number, number] {
  const [hw, hh] = halfExtents(body)
  return clampCentre(x, y, box, hw, hh)
}
