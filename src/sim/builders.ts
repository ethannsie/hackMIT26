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
import { mToPx, pxToM, msToMatterVel, DEG } from './units.ts'
import type { SimParams } from './params.ts'

const { Bodies, Body, Composite, Constraint } = Matter

/**
 * The natural framing for a problem, in scene metres (y UP).
 *
 * Computed from the parameters rather than from live body positions. Refitting
 * the camera to whatever the bodies are doing makes the scale jitter every
 * frame and zooms out forever when something rolls away; a stable box does not.
 * The view pans to follow a body that leaves it, but never rescales.
 */
export interface ViewBox {
  minX_m: number
  maxX_m: number
  minY_m: number
  maxY_m: number
}

export interface BuiltScene {
  bodies: Matter.Body[]
  constraints: Matter.Constraint[]
  /** Stable id -> body, so the hand layer and overlays can address things by name. */
  byId: Record<string, Matter.Body>
  /** The body the camera frames and the overlays annotate. */
  focusId: string
  /** Ids the hand is allowed to push. Derived from the spec, enforced by the engine. */
  interactableIds: string[]
  /** Stable camera framing for this problem. */
  view: ViewBox
  /**
   * The border: inner faces of the walls that keep every body inside the
   * scene, in scene metres (y UP). Drawn by the renderer, enforced by Matter.
   */
  bounds: ViewBox
}

/** A builder's output before the border is added. */
type OpenScene = Omit<BuiltScene, 'bounds'>

/** How far outside the view box the border sits, in metres. */
export const BORDER_PAD_M = 0.25
/** Ids of the border walls, so renderers and pickers can treat them as scenery. */
export const isWallId = (id: string): boolean => id.startsWith('wall_')

/**
 * Thick on purpose: Matter only sees a collision when shapes overlap at the
 * end of a step, so anything thinner than one step of travel is invisible to
 * a fast body. 1 m holds up to 120 m/s at 120 Hz. The renderer draws the
 * floor's top face and the border line, never the slabs, so thickness is free.
 */
const GROUND_THICKNESS_PX = 200
const WALL = { isStatic: true, friction: 0.6, restitution: 0.2 }

/**
 * The floor.
 *
 * Width matters more than it looks: a 20 m/s projectile at 45° ranges 40.7 m,
 * which used to overshoot the fixed 40 m floor entirely and fall through the
 * world. Callers size it to the motion they expect.
 */
function ground(widthM = 400): Matter.Body {
  return Bodies.rectangle(0, GROUND_THICKNESS_PX / 2, mToPx(widthM), GROUND_THICKNESS_PX, {
    ...WALL,
    label: 'ground',
  })
}

/**
 * Ground long enough that a landed body cannot roll off it.
 *
 * Generous on purpose. A static body costs nothing, and the alternative — a ball
 * that rolls past the edge and falls out of the world — is a visible failure.
 * The camera pans rather than rescales, so a long floor does not shrink the view.
 */
function groundForRange(rangeM: number): Matter.Body {
  return ground(Math.max(400, rangeM * 20))
}

function projectile(p: Extract<SimParams, { kind: 'projectile' }>): OpenScene {
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

  // Size the floor to where this shot will actually land.
  const th2 = p.angle_deg * DEG
  const vy0 = p.v0_ms * Math.sin(th2)
  const tf = (vy0 + Math.sqrt(Math.max(0, vy0 * vy0 + 2 * p.g * p.h0_m))) / p.g
  const expectedRange = Math.abs(p.v0_ms * Math.cos(th2) * tf)

  const apex = p.h0_m + (vy0 * vy0) / (2 * p.g)
  const g = groundForRange(expectedRange)
  return {
    bodies: [g, ball],
    constraints: [],
    byId: { ground: g, projectile: ball },
    focusId: 'projectile',
    interactableIds: ['projectile'],
    view: {
      minX_m: -0.5,
      maxX_m: Math.max(2, expectedRange * 1.1),
      minY_m: -0.18,
      maxY_m: Math.max(1.5, apex * 1.2),
    },
  }
}

/**
 * How far the incline surface continues above the stated top, in px. The
 * block starts at the top of the stated length, so it needs surface behind it
 * to rest on; corrections.ts uses the same number so friction still acts on a
 * block that a hand has pushed back up onto that stretch.
 */
export function rampExtensionPx(rampLengthPx: number): number {
  return Math.max(rampLengthPx * 0.08, mToPx(0.08))
}

function inclinedPlane(p: Extract<SimParams, { kind: 'inclined_plane' }>): OpenScene {
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

  const size = mToPx(0.08)
  const isRolling = p.motion === 'rolling'

  // The body starts with its centre exactly at the top of the L the problem
  // states, so "time to the bottom" in the derivation is the time the sim
  // takes. It used to start 8 % of the way down so it would not teeter off the
  // top corner, which quietly made the sim ~7 % faster than the panel; now the
  // ramp itself carries on above the top by that much instead, so the body
  // still rests fully on a surface and the travel is the full L.
  const extra = rampExtensionPx(L)
  const lift = size / 2 + 1
  const rampTop = { x: top.x - down.x * extra, y: top.y - down.y * extra }

  // Shift the ramp body half a thickness beneath the surface, so the surface
  // itself (not the body centre) runs through `rampTop` and `bottom`.
  const ramp = Bodies.rectangle(
    (rampTop.x + bottom.x) / 2 - normal.x * (thickness / 2),
    (rampTop.y + bottom.y) / 2 - normal.y * (thickness / 2),
    L + extra,
    thickness,
    // friction 0: Coulomb friction is applied explicitly in corrections.ts,
    // because Matter's own friction model pins the block even at mu = 0.05.
    { ...WALL, angle: th, friction: 0, frictionStatic: 0, label: 'ramp' },
  )

  // A sliding box stops when its leading corner meets the floor at the
  // ramp's foot, which is half a box before its centre gets there. Start it
  // with its leading edge at the top, so the centre's travel to that moment
  // is exactly L. A rolling ball touches the floor under its centre, so it
  // starts centred on the top.
  const lead = isRolling ? 0 : size / 2
  const start = {
    x: top.x - down.x * lead + normal.x * lift,
    y: top.y - down.y * lead + normal.y * lift,
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
  const spanX = p.ramp_length_m * Math.cos(th)
  const spanY = p.ramp_length_m * Math.sin(th)
  const extraX_m = pxToM(extra) * Math.cos(th)
  const extraY_m = pxToM(extra) * Math.sin(th)
  return {
    bodies: [g, ramp, block],
    constraints: [],
    byId: { ground: g, ramp, block },
    focusId: 'block',
    interactableIds: ['block'], // the ramp is static; tilting it is a separate gesture
    view: {
      minX_m: -0.35 - extraX_m,
      maxX_m: spanX + 0.55,
      minY_m: -0.18,
      maxY_m: spanY + extraY_m + 0.35,
    },
  }
}

function pendulum(p: Extract<SimParams, { kind: 'pendulum' }>): OpenScene {
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

  // No Matter Constraint. It holds the rod's LENGTH but bleeds its ENERGY:
  // reading its velocity back each step decayed a 40° release to 18° in 30 s.
  // The rod is integrated in corrections.ts instead, and drawn by the renderer.
  const g = ground()
  const pivotY_m = p.length_m + 0.3
  return {
    bodies: [g, pivot, bob],
    constraints: [],
    byId: { ground: g, pivot, bob },
    focusId: 'bob',
    interactableIds: ['bob'],
    view: {
      minX_m: -(p.length_m + 0.4),
      maxX_m: p.length_m + 0.4,
      minY_m: -0.3,
      maxY_m: pivotY_m + 0.4,
    },
  }
}

function collision1d(p: Extract<SimParams, { kind: 'collision_1d' }>): OpenScene {
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
    view: { minX_m: -1.6, maxX_m: 1.6, minY_m: -0.3, maxY_m: 1.0 },
  }
}


// ---------------------------------------------------------------------------
// The hard-to-picture five. All but rolling run with gravity off — gravity is
// not the lesson in any of them and would just drag the body out of frame.
// ---------------------------------------------------------------------------

function rollingWithoutSlipping(
  p: Extract<SimParams, { kind: 'rolling_without_slipping' }>,
): OpenScene {
  const r = mToPx(p.radius_m)
  const wheel = Bodies.circle(-mToPx(1.5), -r, r, {
    label: 'wheel',
    friction: 0, // rolling is enforced kinematically in corrections.ts
    frictionStatic: 0,
    frictionAir: 0,
    restitution: 0,
  })
  Body.setMass(wheel, p.mass_kg)
  Body.setVelocity(wheel, { x: msToMatterVel(p.v_ms), y: 0 })
  // omega = v/r is the rolling constraint, applied here and held every step.
  Body.setAngularVelocity(wheel, msToMatterVel(p.v_ms) / r)

  const g = ground(400)
  g.friction = 0
  g.frictionStatic = 0

  return {
    bodies: [g, wheel],
    constraints: [],
    byId: { ground: g, wheel },
    focusId: 'wheel',
    interactableIds: ['wheel'],
    // The wheel travels, so the view pans with it at a fixed scale.
    view: { minX_m: -2.2, maxX_m: 2.2, minY_m: -0.3, maxY_m: p.radius_m * 2 + 1.2 },
  }
}

function circularMotion(p: Extract<SimParams, { kind: 'circular_motion' }>): OpenScene {
  const R = mToPx(p.radius_m)
  const centreY = -R - mToPx(0.4)

  const pivot = Bodies.circle(0, centreY, 5, { isStatic: true, label: 'pivot' })
  const ball = Bodies.circle(R, centreY, mToPx(0.05), {
    label: 'ball',
    frictionAir: 0,
    restitution: 0,
  })
  Body.setMass(ball, p.mass_kg)
  // Tangential: at angle 0 on the circle, tangent points straight "up" (-y).
  Body.setVelocity(ball, { x: 0, y: -msToMatterVel(p.speed_ms) })

  // The string is what actually supplies the centripetal force — no fudging.
  const string = Constraint.create({
    bodyA: pivot,
    bodyB: ball,
    length: R,
    stiffness: 1,
    damping: 0,
    label: 'string',
  })

  const R_m = p.radius_m
  return {
    bodies: [pivot, ball],
    constraints: [string],
    byId: { pivot, ball },
    focusId: 'ball',
    interactableIds: ['ball'],
    view: {
      minX_m: -(R_m + 0.4),
      maxX_m: R_m + 0.4,
      minY_m: -0.2,
      maxY_m: 2 * R_m + 0.9,
    },
  }
}

function chargedParticle(
  p: Extract<SimParams, { kind: 'charged_particle_magnetic' }>,
): OpenScene {
  const th = p.angle_deg * DEG
  const particle = Bodies.circle(0, 0, mToPx(0.04), {
    label: 'particle',
    frictionAir: 0,
    restitution: 1,
  })
  Body.setMass(particle, p.mass_kg)
  Body.setVelocity(particle, {
    x: msToMatterVel(p.speed_ms * Math.cos(th)),
    y: -msToMatterVel(p.speed_ms * Math.sin(th)),
  })

  // No ground: this is a particle in a field region, not a scene with a floor.
  const r = Math.abs(p.charge_c * p.b_field_tesla) > 1e-9
    ? (p.mass_kg * p.speed_ms) / Math.abs(p.charge_c * p.b_field_tesla)
    : 3
  const pad = Math.max(0.5, r * 0.35)
  return {
    bodies: [particle],
    constraints: [],
    byId: { particle },
    focusId: 'particle',
    interactableIds: ['particle'],
    view: {
      minX_m: -(2 * r + pad),
      maxX_m: 2 * r + pad,
      minY_m: -(2 * r + pad),
      maxY_m: 2 * r + pad,
    },
  }
}

function rotatingFrame(p: Extract<SimParams, { kind: 'rotating_frame' }>): OpenScene {
  const th = p.angle_deg * DEG
  const particle = Bodies.circle(mToPx(p.r0_m), 0, mToPx(0.04), {
    label: 'particle',
    frictionAir: 0,
    restitution: 1,
  })
  Body.setMass(particle, p.mass_kg)
  Body.setVelocity(particle, {
    x: msToMatterVel(p.speed_ms * Math.cos(th)),
    y: -msToMatterVel(p.speed_ms * Math.sin(th)),
  })

  // A marker at the rotation axis, so the origin the pseudo-forces refer to is
  // visible rather than implied.
  const axis = Bodies.circle(0, 0, 4, { isStatic: true, label: 'pivot' })

  const reach = Math.max(2.5, p.r0_m + p.speed_ms * 2)
  return {
    bodies: [axis, particle],
    constraints: [],
    byId: { pivot: axis, particle },
    focusId: 'particle',
    interactableIds: ['particle'],
    view: { minX_m: -reach, maxX_m: reach, minY_m: -reach, maxY_m: reach },
  }
}

function angularMomentumPoint(
  p: Extract<SimParams, { kind: 'angular_momentum_point' }>,
): OpenScene {
  // The particle travels horizontally along a line offset from the origin by
  // the impact parameter. The origin is the whole point, so it gets a marker.
  const origin = Bodies.circle(0, 0, 5, { isStatic: true, label: 'pivot' })
  // Matter's +y is down, so a POSITIVE impact parameter puts the particle below
  // the origin on screen. That is what makes L = +mvd (counter-clockwise
  // positive) rather than -mvd, matching the sign convention in analytic.ts.
  const particle = Bodies.circle(-mToPx(2), mToPx(p.impact_parameter_m), mToPx(0.04), {
    label: 'particle',
    frictionAir: 0,
    restitution: 1,
  })
  Body.setMass(particle, p.mass_kg)
  Body.setVelocity(particle, { x: msToMatterVel(p.speed_ms), y: 0 })

  const span = Math.max(2.5, Math.abs(p.impact_parameter_m) * 2.5)
  return {
    bodies: [origin, particle],
    constraints: [],
    byId: { pivot: origin, particle },
    focusId: 'particle',
    interactableIds: ['particle'],
    view: { minX_m: -span, maxX_m: span, minY_m: -span * 0.6, maxY_m: span * 0.6 },
  }
}

/**
 * Wall the scene in.
 *
 * Every problem used to run on an effectively infinite floor: a ball that was
 * pushed kept rolling, the camera panned after it, and the demo sat in the same
 * constant state forever with nothing in view. The walls sit just outside the
 * framing box, so everything a hand throws comes back into the picture, and
 * the renderer draws the same rectangle so the limit is never a surprise.
 *
 * Walls are static scenery: never interactable, never the focus, and skipped by
 * the picker. Restitution is a pair MAXIMUM in Matter, so a 0.6 wall bounces a
 * zero-restitution cart back and leaves a perfectly elastic particle elastic.
 */
function enclose(scene: OpenScene, params: SimParams): BuiltScene {
  const v = scene.view
  const bounds: ViewBox = {
    minX_m: v.minX_m - BORDER_PAD_M,
    maxX_m: v.maxX_m + BORDER_PAD_M,
    minY_m: v.minY_m - BORDER_PAD_M,
    maxY_m: v.maxY_m + BORDER_PAD_M,
  }
  // The pendulum bob is placed by its integrated angle every step (see
  // corrections.ts), so a wall cannot stop it — it would just tunnel through
  // and jitter. Its ceiling is the full swing circle instead, which the bob
  // cannot leave anyway.
  if (params.kind === 'pendulum') {
    bounds.maxY_m = Math.max(bounds.maxY_m, 2 * params.length_m + 0.3 + BORDER_PAD_M)
  }

  const t = GROUND_THICKNESS_PX
  const x0 = mToPx(bounds.minX_m)
  const x1 = mToPx(bounds.maxX_m)
  const y0 = -mToPx(bounds.maxY_m) // top, Matter y-down
  const y1 = -mToPx(bounds.minY_m) // bottom
  const w = x1 - x0
  const h = y1 - y0
  const mk = (x: number, y: number, ww: number, hh: number, label: string): Matter.Body =>
    Bodies.rectangle(x, y, ww, hh, {
      isStatic: true,
      friction: 0,
      frictionStatic: 0,
      restitution: 0.6,
      label,
    })
  const walls: Record<string, Matter.Body> = {
    wall_left: mk(x0 - t / 2, (y0 + y1) / 2, t, h + 2 * t, 'wall_left'),
    wall_right: mk(x1 + t / 2, (y0 + y1) / 2, t, h + 2 * t, 'wall_right'),
    wall_top: mk((x0 + x1) / 2, y0 - t / 2, w + 2 * t, t, 'wall_top'),
  }
  // Scenes with a floor already have their bottom edge; the gravity-free
  // particle scenes have nothing below and get one.
  if (!scene.byId['ground']) {
    walls['wall_bottom'] = mk((x0 + x1) / 2, y1 + t / 2, w + 2 * t, t, 'wall_bottom')
  }

  return {
    ...scene,
    bodies: [...scene.bodies, ...Object.values(walls)],
    byId: { ...scene.byId, ...walls },
    bounds,
  }
}

export function buildScene(params: SimParams): BuiltScene {
  return enclose(buildOpenScene(params), params)
}

function buildOpenScene(params: SimParams): OpenScene {
  switch (params.kind) {
    case 'projectile':
      return projectile(params)
    case 'inclined_plane':
      return inclinedPlane(params)
    case 'pendulum':
      return pendulum(params)
    case 'collision_1d':
      return collision1d(params)
    case 'rolling_without_slipping':
      return rollingWithoutSlipping(params)
    case 'circular_motion':
      return circularMotion(params)
    case 'charged_particle_magnetic':
      return chargedParticle(params)
    case 'rotating_frame':
      return rotatingFrame(params)
    case 'angular_momentum_point':
      return angularMomentumPoint(params)
  }
}

/** Convenience for callers that want everything in one composite. */
export function addToWorld(world: Matter.World, scene: BuiltScene): void {
  Composite.add(world, [...scene.bodies, ...scene.constraints])
}
