/**
 * The composed world.
 *
 * Same determinism discipline as SimWorld: physics only advances through
 * step(), which uses FIXED_DT_MS, and the world is a pure function of the scene
 * spec. Editing a component rebuilds and restarts rather than mutating a running
 * sim — that is what keeps a sandbox run reproducible instead of a one-off.
 *
 * Two forces are applied by hand each step rather than left to Matter:
 *   - springs, so the stiffness is a real k in N/m and omega = sqrt(k/m) holds
 *   - magnetic regions, as a velocity rotation (see corrections.ts for why a
 *     force would blow up)
 */
import Matter from 'matter-js'
import {
  FIXED_DT_MS,
  FIXED_DT_S,
  PX_PER_M,
  mToPx,
  pxToM,
  msToMatterVel,
  matterVelToMs,
  gravityY,
  DEG,
  RAD,
} from '../sim/units.ts'
import { isStaticKind, type Entity, type SandboxScene } from './types.ts'

const { Engine, Composite, Bodies, Body } = Matter

const FORCE_N_TO_MATTER = PX_PER_M / 1e6
const GROUND_THICKNESS_PX = 40

export interface SandboxBodyState {
  id: string
  kind: string
  position_m: [number, number]
  velocity_ms: [number, number]
  speed_ms: number
  angle_deg: number
  mass_kg: number
  charge_c: number
  kinetic_j: number
  potential_j: number
}

/** Per-entity Matter handles, so the renderer and inspector can address them. */
interface Built {
  entity: Entity
  /** The body the hand can grab, and the one readouts report. */
  main?: Matter.Body
  anchor?: Matter.Body
  constraint?: Matter.Constraint
  /** Sensor rectangle for a magnet_region. */
  region?: Matter.Body
  /** Pendulum state: angle from vertical, and its rate. See stepPendulums(). */
  theta?: number
  omega?: number
}

export class SandboxWorld {
  readonly engine: Matter.Engine
  readonly scene: SandboxScene
  private built: Built[] = []
  private accumulatorMs = 0
  steps = 0

  constructor(scene: SandboxScene) {
    this.scene = scene
    this.engine = Engine.create()
    this.engine.gravity.scale = 1
    this.engine.gravity.x = 0
    this.engine.gravity.y = gravityY(scene.gravity_ms2)
    this.engine.constraintIterations = 12
    this.engine.positionIterations = 10
    this.engine.velocityIterations = 8
    this.engine.enableSleeping = false

    this.build()
  }

  private build(): void {
    const world = this.engine.world

    if (this.scene.ground) {
      const ground = Bodies.rectangle(0, GROUND_THICKNESS_PX / 2, mToPx(60), GROUND_THICKNESS_PX, {
        isStatic: true,
        friction: 0.4,
        restitution: 0.2,
        label: 'ground',
      })
      Composite.add(world, ground)
    }

    for (const e of this.scene.entities) {
      const b = this.buildEntity(e)
      this.built.push(b)
      const parts: (Matter.Body | Matter.Constraint)[] = []
      if (b.main) parts.push(b.main)
      if (b.anchor) parts.push(b.anchor)
      if (b.region) parts.push(b.region)
      if (b.constraint) parts.push(b.constraint)
      Composite.add(world, parts)
    }
  }

  /** Scene metres (y up) to Matter pixels (y down). */
  private px(p: [number, number]): { x: number; y: number } {
    return { x: mToPx(p[0]), y: -mToPx(p[1]) }
  }

  private buildEntity(e: Entity): Built {
    const at = this.px(e.position_m)

    switch (e.kind) {
      case 'ball': {
        const body = Bodies.circle(at.x, at.y, mToPx(e.radius_m), {
          label: e.id,
          restitution: e.restitution,
          friction: e.friction,
          frictionAir: 0,
        })
        Body.setMass(body, e.mass_kg)
        Body.setVelocity(body, {
          x: msToMatterVel(e.velocity_ms[0]),
          y: -msToMatterVel(e.velocity_ms[1]),
        })
        return { entity: e, main: body }
      }

      case 'box': {
        const body = Bodies.rectangle(at.x, at.y, mToPx(e.width_m), mToPx(e.height_m), {
          label: e.id,
          angle: e.angle_deg * DEG,
          restitution: e.restitution,
          friction: e.friction,
          frictionAir: 0,
        })
        Body.setMass(body, e.mass_kg)
        Body.setVelocity(body, {
          x: msToMatterVel(e.velocity_ms[0]),
          y: -msToMatterVel(e.velocity_ms[1]),
        })
        return { entity: e, main: body }
      }

      case 'ramp': {
        // Built from the top-left surface point, running down and to the right —
        // the same convention the inclined_plane builder uses, and the same
        // mistake (placing from the centre) is the one that put a block under a
        // ramp the first time.
        const th = e.angle_deg * DEG
        const L = mToPx(e.length_m)
        const thickness = mToPx(0.06)
        const normal = { x: Math.sin(th), y: -Math.cos(th) }
        const body = Bodies.rectangle(
          at.x + (L * Math.cos(th)) / 2 - normal.x * (thickness / 2),
          at.y + (L * Math.sin(th)) / 2 - normal.y * (thickness / 2),
          L,
          thickness,
          { isStatic: true, angle: th, friction: e.friction, restitution: 0.1, label: e.id },
        )
        return { entity: e, main: body }
      }

      case 'wall': {
        const body = Bodies.rectangle(at.x, at.y, mToPx(e.width_m), mToPx(e.height_m), {
          isStatic: true,
          angle: e.angle_deg * DEG,
          friction: e.friction,
          restitution: e.restitution,
          label: e.id,
        })
        return { entity: e, main: body }
      }

      case 'pendulum': {
        const L = mToPx(e.length_m)
        const th = e.start_angle_deg * DEG
        const pivot = Bodies.circle(at.x, at.y, 5, { isStatic: true, label: `${e.id}_pivot` })
        const bob = Bodies.circle(
          at.x + L * Math.sin(th),
          at.y + L * Math.cos(th),
          mToPx(e.bob_radius_m),
          { label: e.id, frictionAir: 0, restitution: 0.4, friction: 0.2 },
        )
        Body.setMass(bob, e.bob_mass_kg)
        // No Matter Constraint — see stepPendulums() for why.
        return { entity: e, main: bob, anchor: pivot, theta: th, omega: 0 }
      }

      case 'spring': {
        const anchor = Bodies.circle(at.x, at.y, 5, { isStatic: true, label: `${e.id}_anchor` })
        // Hangs downward from the anchor, displaced by the starting stretch.
        const drop = mToPx(e.rest_length_m + e.start_extension_m)
        const bob = Bodies.circle(at.x, at.y + drop, mToPx(e.bob_radius_m), {
          label: e.id,
          frictionAir: 0,
          restitution: 0.3,
          friction: 0.2,
        })
        Body.setMass(bob, e.mass_kg)
        // No Matter constraint: the restoring force is applied explicitly in
        // step() so that k is a real stiffness in N/m.
        return { entity: e, main: bob, anchor }
      }

      case 'magnet_region': {
        const region = Bodies.rectangle(at.x, at.y, mToPx(e.width_m), mToPx(e.height_m), {
          isStatic: true,
          isSensor: true, // things pass through; only the field acts
          label: e.id,
        })
        return { entity: e, region }
      }
    }
  }

  /** Bodies the hand is allowed to push. */
  get interactableIds(): string[] {
    return this.built
      .filter((b) => b.main && !isStaticKind(b.entity.kind))
      .map((b) => b.entity.id)
  }

  bodyById(id: string): Matter.Body | undefined {
    return this.built.find((b) => b.entity.id === id)?.main
  }

  entityById(id: string): Entity | undefined {
    return this.built.find((b) => b.entity.id === id)?.entity
  }

  /** Every built component, for the renderer. */
  get components(): readonly Built[] {
    return this.built
  }

  private applySpringForces(): void {
    for (const b of this.built) {
      if (b.entity.kind !== 'spring' || !b.main || !b.anchor) continue
      const e = b.entity

      const dx = b.main.position.x - b.anchor.position.x
      const dy = b.main.position.y - b.anchor.position.y
      const len = Math.hypot(dx, dy)
      if (len < 1e-9) continue

      // Hooke: F = -k * extension, along the spring axis.
      const extension_m = pxToM(len) - e.rest_length_m
      const magnitude = -e.stiffness_n_per_m * extension_m

      Body.applyForce(b.main, b.main.position, {
        x: (dx / len) * magnitude * FORCE_N_TO_MATTER,
        y: (dy / len) * magnitude * FORCE_N_TO_MATTER,
      })
    }
  }

  private applyMagneticRotation(): void {
    const regions = this.built.filter((b) => b.entity.kind === 'magnet_region' && b.region)
    if (regions.length === 0) return

    for (const b of this.built) {
      if (!b.main || b.main.isStatic) continue
      const e = b.entity
      if (e.kind !== 'ball' && e.kind !== 'box') continue
      if (e.charge_c === 0) continue

      for (const r of regions) {
        const region = r.region!
        const bounds = region.bounds
        const p = b.main.position
        const inside =
          p.x >= bounds.min.x && p.x <= bounds.max.x && p.y >= bounds.min.y && p.y <= bounds.max.y
        if (!inside) continue

        const field = (r.entity as { b_field_tesla: number }).b_field_tesla
        // Rotate the velocity rather than applying qv x B as a force: an
        // explicit force is Euler on a rotation and gains energy without bound.
        const omegaC = (e.charge_c * field) / b.main.mass
        const phi = -omegaC * FIXED_DT_S
        const cos = Math.cos(phi)
        const sin = Math.sin(phi)

        const vx = b.main.velocity.x
        const vy = -b.main.velocity.y
        Body.setVelocity(b.main, {
          x: vx * cos - vy * sin,
          y: -(vx * sin + vy * cos),
        })
        break // one field at a time; overlapping regions are not a thing we model
      }
    }
  }

  /**
   * Pendulums are integrated as the one-degree-of-freedom systems they are.
   *
   * Two earlier approaches both failed, and both failed visibly:
   *
   *   Matter's Constraint      bled a 40° pendulum down to 18.5° in 20 s, losing
   *                            76% of its swing with no damping in the scene.
   *   Position projection      over-corrects on the very first step, drives the
   *                            energy-corrected speed negative, and clamps it to
   *                            zero forever — the bob creeps down at KE = 0.
   *
   * A rigid pendulum has exactly one degree of freedom, so integrate that:
   *
   *     omega += -(g/L)·sin(theta)·dt
   *     theta += omega·dt
   *
   * Semi-implicit Euler is symplectic, so energy oscillates within a bound
   * instead of draining away — no secular drift, however long it runs.
   *
   * Collisions still work. Matter's gravity on the bob is cancelled so it is not
   * applied twice, Engine.update is left to resolve any contact, and whatever
   * velocity that produces is projected back onto the tangent and folded into
   * omega. So a falling box can still knock the pendulum, and the rod stays rigid.
   */
  private cancelGravityOnBobs(): void {
    for (const b of this.built) {
      if (b.entity.kind !== 'pendulum' || !b.main) continue
      // Matter adds mass·gravity.y to force each step; subtract exactly that.
      Body.applyForce(b.main, b.main.position, {
        x: 0,
        y: -b.main.mass * this.engine.gravity.y,
      })
    }
  }

  private stepPendulums(): void {
    for (const b of this.built) {
      if (b.entity.kind !== 'pendulum' || !b.main || !b.anchor) continue
      if (b.theta === undefined || b.omega === undefined) continue

      const L_m = b.entity.length_m
      const L = mToPx(L_m)

      // Tangential direction at the current angle, in Matter's y-down frame.
      const tx = Math.cos(b.theta)
      const ty = -Math.sin(b.theta)

      // Whatever the collision solver did to the bob, keep only the part the
      // rod allows: motion along the tangent.
      const vt_ms =
        matterVelToMs(b.main.velocity.x) * tx + -matterVelToMs(b.main.velocity.y) * -ty
      b.omega = vt_ms / L_m

      // Symplectic step.
      b.omega += -(this.scene.gravity_ms2 / L_m) * Math.sin(b.theta) * FIXED_DT_S
      b.theta += b.omega * FIXED_DT_S

      const nx = Math.sin(b.theta)
      const ny = Math.cos(b.theta)
      Body.setPosition(b.main, {
        x: b.anchor.position.x + nx * L,
        y: b.anchor.position.y + ny * L,
      })

      const speed = msToMatterVel(b.omega * L_m)
      Body.setVelocity(b.main, {
        x: Math.cos(b.theta) * speed,
        y: -Math.sin(b.theta) * speed,
      })
    }
  }

  step(forces: { bodyId: string; force_n: [number, number] }[] = []): void {
    for (const f of forces) {
      const body = this.bodyById(f.bodyId)
      if (!body || body.isStatic) continue
      Body.applyForce(body, body.position, {
        x: f.force_n[0] * FORCE_N_TO_MATTER,
        y: -f.force_n[1] * FORCE_N_TO_MATTER,
      })
    }

    this.applySpringForces()
    this.applyMagneticRotation()
    this.cancelGravityOnBobs()
    Engine.update(this.engine, FIXED_DT_MS)
    this.stepPendulums()
    this.steps += 1
  }

  stepMany(n: number): void {
    for (let i = 0; i < n; i++) this.step()
  }

  advanceWith(
    elapsedMs: number,
    forcesFor: () => { bodyId: string; force_n: [number, number] }[],
    maxSteps = 8,
  ): number {
    this.accumulatorMs = Math.min(this.accumulatorMs + elapsedMs, FIXED_DT_MS * maxSteps)
    let taken = 0
    while (this.accumulatorMs >= FIXED_DT_MS) {
      this.step(forcesFor())
      this.accumulatorMs -= FIXED_DT_MS
      taken += 1
    }
    return taken
  }

  get time_s(): number {
    return this.steps * FIXED_DT_S
  }

  setVelocityMs(id: string, v: [number, number]): void {
    const body = this.bodyById(id)
    if (!body || body.isStatic) return
    Body.setVelocity(body, { x: msToMatterVel(v[0]), y: -msToMatterVel(v[1]) })
  }

  setPositionM(id: string, p: [number, number]): void {
    const body = this.bodyById(id)
    if (!body || body.isStatic) return
    Body.setPosition(body, { x: mToPx(p[0]), y: -mToPx(p[1]) })
  }

  /** Metric state of every movable component. */
  states(): SandboxBodyState[] {
    const out: SandboxBodyState[] = []
    for (const b of this.built) {
      if (!b.main || b.main.isStatic) continue
      const e = b.entity
      const y = -pxToM(b.main.position.y)
      const vx = matterVelToMs(b.main.velocity.x)
      const vy = -matterVelToMs(b.main.velocity.y)
      const speed = Math.hypot(vx, vy)
      const m = b.main.mass
      out.push({
        id: e.id,
        kind: e.kind,
        position_m: [pxToM(b.main.position.x), y],
        velocity_ms: [vx, vy],
        speed_ms: speed,
        angle_deg: b.main.angle * RAD,
        mass_kg: m,
        charge_c: 'charge_c' in e ? e.charge_c : 0,
        kinetic_j: 0.5 * m * speed * speed,
        potential_j: m * this.scene.gravity_ms2 * y,
      })
    }
    return out
  }

  /** Energy stored in every spring right now. */
  springEnergy_j(): number {
    let total = 0
    for (const b of this.built) {
      if (b.entity.kind !== 'spring' || !b.main || !b.anchor) continue
      const dx = b.main.position.x - b.anchor.position.x
      const dy = b.main.position.y - b.anchor.position.y
      const ext = pxToM(Math.hypot(dx, dy)) - b.entity.rest_length_m
      total += 0.5 * b.entity.stiffness_n_per_m * ext * ext
    }
    return total
  }

  dispose(): void {
    Composite.clear(this.engine.world, false)
    this.built = []
  }
}
