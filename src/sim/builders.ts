/**
 * Spec parameters -> a concrete Matter.js scene, one builder per problem type.
 *
 * These are hand-written and parameterized. We are not building a general
 * physics compiler (plan §6); the model only fills in numbers.
 *
 * Coordinate convention: Matter's native y-down. Ground sits at y = 0, so
 * anything above the ground has NEGATIVE y. Readouts flip the sign back.
 */
import Matter from 'matter-js'
import { mToPx, msToMatterVel, DEG } from './units.ts'
import type { SimParams } from './params.ts'

const { Bodies, Body, Composite, Constraint } = Matter

export interface BuiltScene {
  bodies: Matter.Body[]
  constraints: Matter.Constraint[]
  /** Stable id -> body, so the hand layer and overlays can address things by name. */
  byId: Record<string, Matter.Body>
  /** The body the camera frames and the overlays annotate. */
  focusId: string
  /** Ids the hand is allowed to push. Derived from the spec, enforced by the engine. */
  interactableIds: string[]
}

const GROUND_THICKNESS_PX = 40
const WALL = { isStatic: true, friction: 0.6, restitution: 0.2 }

function ground(widthM = 40): Matter.Body {
  return Bodies.rectangle(0, GROUND_THICKNESS_PX / 2, mToPx(widthM), GROUND_THICKNESS_PX, {
    ...WALL,
    label: 'ground',
  })
}

function projectile(p: Extract<SimParams, { kind: 'projectile' }>): BuiltScene {
  const r = mToPx(0.06)
  const ball = Bodies.circle(0, -mToPx(p.h0_m) - r, r, {
    label: 'projectile',
    restitution: 0.35,
    friction: 0.05,
    frictionAir: 0, // no drag: the closed form in analytic.ts assumes none
    density: 0.001,
  })

  // Mass does not affect a drag-free trajectory, but the hand pushes by force,
  // so every dynamic body needs a real mass in kg for F = ma to come out right.
  Body.setMass(ball, 1)

  const th = p.angle_deg * DEG
  Body.setVelocity(ball, {
    x: msToMatterVel(p.v0_ms * Math.cos(th)),
    y: -msToMatterVel(p.v0_ms * Math.sin(th)),
  })

  const g = ground()
  return {
    bodies: [g, ball],
    constraints: [],
    byId: { ground: g, projectile: ball },
    focusId: 'projectile',
    interactableIds: ['projectile'],
  }
}

function inclinedPlane(p: Extract<SimParams, { kind: 'inclined_plane' }>): BuiltScene {
  const th = p.angle_deg * DEG
  const L = mToPx(p.ramp_length_m)
  const thickness = mToPx(0.05)

  // Build the ramp from its two surface endpoints rather than from its centre —
  // getting this backwards once already put the block underneath the ramp.
  // Top of the slope is up and to the left; bottom meets the ground on the right.
  const top = { x: 0, y: -L * Math.sin(th) }
  const bottom = { x: L * Math.cos(th), y: 0 }

  // Unit vector pointing DOWN the slope, and the outward surface normal.
  // Matter is y-down, so the normal's negative y component points up out of the ramp.
  const down = { x: Math.cos(th), y: Math.sin(th) }
  const normal = { x: Math.sin(th), y: -Math.cos(th) }

  // Shift the ramp body half a thickness beneath the surface, so the surface
  // itself (not the body centre) runs through `top` and `bottom`.
  const ramp = Bodies.rectangle(
    (top.x + bottom.x) / 2 - normal.x * (thickness / 2),
    (top.y + bottom.y) / 2 - normal.y * (thickness / 2),
    L,
    thickness,
    // friction 0: Coulomb friction is applied explicitly in corrections.ts,
    // because Matter's own friction model pins the block even at mu = 0.05.
    { ...WALL, angle: th, friction: 0, frictionStatic: 0, label: 'ramp' },
  )

  const size = mToPx(0.08)
  const isRolling = p.motion === 'rolling'
  // Start a little way down from the very top edge so the body rests fully on
  // the ramp rather than teetering off the corner.
  const inset = L * 0.08
  const lift = size / 2 + 1

  const start = {
    x: top.x + down.x * inset + normal.x * lift,
    y: top.y + down.y * inset + normal.y * lift,
  }

  const common = {
    label: 'block',
    friction: 0, // see corrections.ts — friction is modelled as an explicit force
    frictionStatic: 0,
    frictionAir: 0,
    restitution: 0,
  }
  const block = isRolling
    ? Bodies.circle(start.x, start.y, size / 2, common)
    : Bodies.rectangle(start.x, start.y, size, size, { ...common, angle: th })

  Body.setMass(block, p.mass_kg)
  if (p.v0_ms !== 0) {
    Body.setVelocity(block, {
      x: msToMatterVel(p.v0_ms * down.x),
      y: msToMatterVel(p.v0_ms * down.y),
    })
  }

  const g = ground()
  return {
    bodies: [g, ramp, block],
    constraints: [],
    byId: { ground: g, ramp, block },
    focusId: 'block',
    interactableIds: ['block'], // the ramp is static; tilting it is a separate gesture
  }
}

function pendulum(p: Extract<SimParams, { kind: 'pendulum' }>): BuiltScene {
  const L = mToPx(p.length_m)
  const th = p.theta0_deg * DEG

  // Pivot high enough that the bob always swings above the ground.
  const pivotY = -L - mToPx(0.3)
  const pivot = Bodies.circle(0, pivotY, 6, { isStatic: true, label: 'pivot' })

  const bobR = mToPx(0.05)
  const bob = Bodies.circle(L * Math.sin(th), pivotY + L * Math.cos(th), bobR, {
    label: 'bob',
    frictionAir: 0, // undamped, so the period matches T = 2pi*sqrt(L/g)
    restitution: 0.2,
    density: 0.001,
  })
  Body.setMass(bob, p.mass_kg)

  // A rigid rod, not a spring. stiffness 1 + damping 0 + the engine's raised
  // constraintIterations is what keeps the measured period honest.
  const rod = Constraint.create({
    bodyA: pivot,
    bodyB: bob,
    length: L,
    stiffness: 1,
    damping: 0,
    label: 'rod',
  })

  const g = ground()
  return {
    bodies: [g, pivot, bob],
    constraints: [rod],
    byId: { ground: g, pivot, bob },
    focusId: 'bob',
    interactableIds: ['bob'],
  }
}

function collision1d(p: Extract<SimParams, { kind: 'collision_1d' }>): BuiltScene {
  const h = mToPx(0.08)
  const w = mToPx(0.12)
  const y = -h / 2

  const mk = (label: string, x: number, mass: number, v: number): Matter.Body => {
    const b = Bodies.rectangle(x, y, w, h, {
      label,
      friction: 0, // a frictionless track: the closed form assumes momentum is conserved
      frictionStatic: 0,
      frictionAir: 0,
      // restitution 0: the exact impulse is applied in corrections.ts, because
      // Matter under-applies restitution badly as e approaches 1.
      restitution: 0,
      density: 0.001,
    })
    Body.setMass(b, mass)
    Body.setVelocity(b, { x: msToMatterVel(v), y: 0 })
    return b
  }

  const cart1 = mk('cart1', -mToPx(0.5), p.m1_kg, p.v1_ms)
  const cart2 = mk('cart2', mToPx(0.5), p.m2_kg, p.v2_ms)

  // Frictionless ground under frictionless carts.
  const g = ground()
  g.friction = 0
  g.frictionStatic = 0

  return {
    bodies: [g, cart1, cart2],
    constraints: [],
    byId: { ground: g, cart1, cart2 },
    focusId: 'cart1',
    interactableIds: ['cart1', 'cart2'],
  }
}

export function buildScene(params: SimParams): BuiltScene {
  switch (params.kind) {
    case 'projectile':
      return projectile(params)
    case 'inclined_plane':
      return inclinedPlane(params)
    case 'pendulum':
      return pendulum(params)
    case 'collision_1d':
      return collision1d(params)
  }
}

/** Convenience for callers that want everything in one composite. */
export function addToWorld(world: Matter.World, scene: BuiltScene): void {
  Composite.add(world, [...scene.bodies, ...scene.constraints])
}
