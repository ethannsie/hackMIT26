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
import { DEFAULT_ARENA, isStaticKind, type Entity, type SandboxScene } from './types.ts'
import { containBody, clampBodyCentre, type PxBox } from '../sim/contain.ts'
import type { ForceVector } from '../sim/fbd.ts'

const { Engine, Composite, Bodies, Body } = Matter

const FORCE_N_TO_MATTER = PX_PER_M / 1e6
/** 1 m of slab: thinner than one step of fast travel and Matter never sees the hit. */
const GROUND_THICKNESS_PX = 200

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
  /** Measured over the most recent fixed step, in m/s² (y up). */
  private accelerationById = new Map<string, [number, number]>()
  steps = 0

  /**
   * Physics substeps per fixed step.
   *
   * A stiff spring is the one thing here that can outrun a 120 Hz step: k = 400
   * N/m on 0.1 kg gives omega = 63 rad/s, so omega*dt = 0.53 and the explicit
   * force integration pumps energy instead of conserving it — that scene hit
   * 82 m/s from a 0.9 m stretch. Substepping brings omega*dt back under 0.2.
   *
   * Derived purely from the scene, so determinism is unaffected.
   */
  readonly subSteps: number

  constructor(scene: SandboxScene) {
    // Fill in an arena rather than throwing: a hand-written or older scene JSON
    // should still load.
    this.scene = { ...scene, arena: scene.arena ?? { ...DEFAULT_ARENA } }
    this.subSteps = SandboxWorld.requiredSubSteps(scene)
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
    const { width_m: W, height_m: H, walls } = this.scene.arena
    const halfW = mToPx(W / 2)

    if (this.scene.ground) {
      // Spans the arena exactly, with a margin so nothing can round off its end.
      const ground = Bodies.rectangle(
        0,
        GROUND_THICKNESS_PX / 2,
        mToPx(W) + GROUND_THICKNESS_PX * 2,
        GROUND_THICKNESS_PX,
        { isStatic: true, friction: 0.4, restitution: 0.2, label: 'ground' },
      )
      Composite.add(world, ground)
    }

    if (walls) {
      const t = GROUND_THICKNESS_PX
      const h = mToPx(H)
      const mk = (x: number, y: number, w: number, hh: number, label: string): Matter.Body =>
        Bodies.rectangle(x, y, w, hh, {
          isStatic: true,
          friction: 0.2,
          restitution: 0.4,
          label,
        })
      Composite.add(world, [
        mk(-halfW - t / 2, -h / 2, t, h + t * 2, 'wall_left'),
        mk(halfW + t / 2, -h / 2, t, h + t * 2, 'wall_right'),
        mk(0, -h - t / 2, mToPx(W) + t * 2, t, 'wall_top'),
      ])
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
  private static requiredSubSteps(scene: SandboxScene): number {
    let worst = 0
    for (const e of scene.entities) {
      if (e.kind !== 'spring' && e.kind !== 'spring_h') continue
      worst = Math.max(worst, Math.sqrt(e.stiffness_n_per_m / Math.max(e.mass_kg, 1e-6)))
    }
    if (worst === 0) return 1
    // Target omega * dt_sub <= 0.2.
    return Math.min(16, Math.max(1, Math.ceil((worst * FIXED_DT_S) / 0.2)))
  }

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

      case 'wall_v': {
        // position_m is the base centre; the body stands up from it.
        const h = mToPx(e.height_m)
        const body = Bodies.rectangle(at.x, at.y - h / 2, mToPx(e.thickness_m), h, {
          isStatic: true,
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

      case 'spring_h': {
        const anchor = Bodies.circle(at.x, at.y, 5, { isStatic: true, label: `${e.id}_anchor` })
        const dir = e.direction < 0 ? -1 : 1
        const reach = mToPx(e.rest_length_m + e.start_extension_m)
        const size = mToPx(e.block_size_m)
        const block = Bodies.rectangle(at.x + dir * reach, at.y, size, size, {
          label: e.id,
          frictionAir: 0,
          restitution: 0.3,
          friction: e.friction,
          frictionStatic: e.friction === 0 ? 0 : 0.5,
        })
        Body.setMass(block, e.mass_kg)
        // Same explicit Hooke force as the hanging spring, so k is real.
        return { entity: e, main: block, anchor }
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

  /**
   * The box no movable component may leave, in Matter px (y down). Walled
   * arenas close all three sides; the floor closes the bottom. An open arena
   * without a floor leaves everything to the escape net, by design.
   */
  private containBox(): PxBox {
    const { width_m: W, height_m: H, walls } = this.scene.arena
    return {
      minX: walls ? -mToPx(W / 2) : -Infinity,
      maxX: walls ? mToPx(W / 2) : Infinity,
      top: walls ? -mToPx(H) : -Infinity,
      bottom: this.scene.ground ? 0 : Infinity,
    }
  }

  private containBodies(): void {
    const box = this.containBox()
    for (const b of this.built) {
      if (!b.main) continue
      // The bob's position is the integrator's, not Matter's; clamping it
      // would fight the rod. Its swing circle keeps it in the arena anyway.
      if (b.entity.kind === 'pendulum') continue
      containBody(b.main, box)
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
      if ((b.entity.kind !== 'spring' && b.entity.kind !== 'spring_h') || !b.main || !b.anchor) continue
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

  private applyMagneticRotation(dtS: number): void {
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
        const phi = -omegaC * dtS
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

  private stepPendulums(dtS: number): void {
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
      b.omega += -(this.scene.gravity_ms2 / L_m) * Math.sin(b.theta) * dtS
      b.theta += b.omega * dtS

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
    const before = new Map<string, [number, number]>()
    for (const b of this.built) {
      if (!b.main || b.main.isStatic) continue
      before.set(b.entity.id, [matterVelToMs(b.main.velocity.x), -matterVelToMs(b.main.velocity.y)])
    }
    const n = this.subSteps
    const dtMs = FIXED_DT_MS / n
    const dtS = FIXED_DT_S / n

    for (let i = 0; i < n; i++) {
      for (const f of forces) {
        const body = this.bodyById(f.bodyId)
        if (!body || body.isStatic) continue
        Body.applyForce(body, body.position, {
          x: f.force_n[0] * FORCE_N_TO_MATTER,
          y: -f.force_n[1] * FORCE_N_TO_MATTER,
        })
      }

      this.applySpringForces()
      this.applyMagneticRotation(dtS)
      this.cancelGravityOnBobs()
      Engine.update(this.engine, dtMs)
      this.stepPendulums(dtS)
    }

    this.enforceEscapeNet()
    this.containBodies()
    for (const b of this.built) {
      if (!b.main || b.main.isStatic) continue
      const prior = before.get(b.entity.id)
      if (!prior) continue
      const vx = matterVelToMs(b.main.velocity.x)
      const vy = -matterVelToMs(b.main.velocity.y)
      this.accelerationById.set(b.entity.id, [
        (vx - prior[0]) / FIXED_DT_S,
        (vy - prior[1]) / FIXED_DT_S,
      ])
    }
    this.steps += 1
  }

  /**
   * Catch anything that has left the world.
   *
   * Even with walls a body can escape — walls can be switched off, and a fast
   * enough body can tunnel. Once outside, it accelerates forever, poisons the
   * energy readout, and drags the camera off with it. Rather than integrate
   * something nobody can see, park it at the boundary and record that it left.
   */
  private enforceEscapeNet(): void {
    const limitX = mToPx(this.scene.arena.width_m * 1.5)
    const limitY = mToPx(this.scene.arena.height_m * 3)

    for (const b of this.built) {
      if (!b.main || b.main.isStatic) continue
      const p = b.main.position

      const lost =
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > limitX ||
        p.y > limitY ||
        p.y < -limitY

      if (!lost) {
        this.escaped.delete(b.entity.id)
        continue
      }

      if (!this.escaped.has(b.entity.id)) this.escaped.add(b.entity.id)
      Body.setPosition(b.main, {
        x: Number.isFinite(p.x) ? Math.max(-limitX, Math.min(limitX, p.x)) : 0,
        y: Number.isFinite(p.y) ? Math.max(-limitY, Math.min(limitY, p.y)) : 0,
      })
      Body.setVelocity(b.main, { x: 0, y: 0 })
      Body.setAngularVelocity(b.main, 0)
    }
  }

  /** Ids that have left the arena and been parked. */
  readonly escaped = new Set<string>()

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

  /** Put a body back to a recorded state, for timeline scrubbing. */
  applyBodyState(
    id: string,
    f: { x_m: number; y_m: number; angle_deg: number; vx_ms: number; vy_ms: number },
  ): void {
    const b = this.built.find((x) => x.entity.id === id)
    if (!b?.main || b.main.isStatic) return
    Body.setPosition(b.main, { x: mToPx(f.x_m), y: -mToPx(f.y_m) })
    Body.setAngle(b.main, f.angle_deg * DEG)
    Body.setVelocity(b.main, { x: msToMatterVel(f.vx_ms), y: -msToMatterVel(f.vy_ms) })
    this.accumulatorMs = 0
    this.accelerationById.delete(id)
    // A pendulum carries its own angle and rate; re-derive them or resuming
    // from a scrubbed frame would snap the bob back.
    if (b.entity.kind === 'pendulum' && b.anchor) {
      const dx = b.main.position.x - b.anchor.position.x
      const dy = b.main.position.y - b.anchor.position.y
      b.theta = Math.atan2(dx, dy)
      const tx = Math.cos(b.theta)
      const ty = -Math.sin(b.theta)
      const vt = matterVelToMs(b.main.velocity.x) * tx + -matterVelToMs(b.main.velocity.y) * -ty
      b.omega = vt / b.entity.length_m
    }
  }

  /**
   * Forces on one body, for the free-body diagram.
   *
   * Only the forces this file actually applies are known exactly: weight, the
   * spring, and the magnetic deflection. Everything a contact does is lumped
   * into one "contact" arrow, recovered as the difference between the measured
   * net force (m·a, differenced from velocity) and those known terms. That is
   * honest — it is the normal force and friction combined, because from outside
   * the solver there is no way to separate them.
   */
  forcesOn(id: string): ForceVector[] {
    const b = this.built.find((x) => x.entity.id === id)
    if (!b?.main || b.main.isStatic) return []
    const body = b.main
    const m = body.mass
    const out: ForceVector[] = []

    const g = this.scene.gravity_ms2
    if (g !== 0) {
      out.push({
        label: 'W', name: 'Weight', kind: 'weight',
        vec_n: [0, -m * g], magnitude_n: m * g,
      })
    }

    if ((b.entity.kind === 'spring' || b.entity.kind === 'spring_h') && b.anchor) {
      const dx = body.position.x - b.anchor.position.x
      const dy = body.position.y - b.anchor.position.y
      const len = Math.hypot(dx, dy)
      if (len > 1e-9) {
        const ext = pxToM(len) - b.entity.rest_length_m
        const mag = -b.entity.stiffness_n_per_m * ext
        const fx = (dx / len) * mag
        const fy = -(dy / len) * mag // to y-up
        out.push({
          label: 'F_s', name: 'Spring force (−kx)', kind: 'tension',
          vec_n: [fx, fy], magnitude_n: Math.abs(mag),
        })
      }
    }

    const e = b.entity
    if ((e.kind === 'ball' || e.kind === 'box') && e.charge_c !== 0) {
      for (const r of this.built) {
        if (r.entity.kind !== 'magnet_region' || !r.region) continue
        const p = body.position
        const bb = r.region.bounds
        if (p.x < bb.min.x || p.x > bb.max.x || p.y < bb.min.y || p.y > bb.max.y) continue
        const qB = e.charge_c * r.entity.b_field_tesla
        const vx = matterVelToMs(body.velocity.x)
        const vy = -matterVelToMs(body.velocity.y)
        out.push({
          label: 'F_B', name: 'Magnetic force qv × B', kind: 'applied',
          vec_n: [qB * vy, -qB * vx], magnitude_n: Math.abs(qB) * Math.hypot(vx, vy),
        })
        break
      }
    }

    // Matter resolves contacts internally. Recover their resultant from F = ma
    // after subtracting the forces we explicitly model, which makes a normal /
    // collision / rod-reaction arrow available for any selected movable body.
    const a = this.accelerationById.get(id)
    if (a) {
      const net: [number, number] = [m * a[0], m * a[1]]
      const known = out.reduce<[number, number]>(
        (sum, f) => [sum[0] + f.vec_n[0], sum[1] + f.vec_n[1]],
        [0, 0],
      )
      const contact: [number, number] = [net[0] - known[0], net[1] - known[1]]
      const contactMag = Math.hypot(contact[0], contact[1])
      if (contactMag > 1e-3) {
        out.push({
          label: 'F_c', name: 'Contact / constraint resultant', kind: 'normal',
          vec_n: contact, magnitude_n: contactMag,
        })
      }
      out.push({ label: 'ΣF', name: 'Net force (m·a)', kind: 'net', vec_n: net, magnitude_n: Math.hypot(...net) })
    }
    return out
  }

  setVelocityMs(id: string, v: [number, number]): void {
    const body = this.bodyById(id)
    if (!body || body.isStatic) return
    Body.setVelocity(body, { x: msToMatterVel(v[0]), y: -msToMatterVel(v[1]) })
  }

  setPositionM(id: string, p: [number, number]): void {
    const body = this.bodyById(id)
    if (!body || body.isStatic) return
    // A grab is a teleport; clamp it so a hand cannot carry a body through a wall.
    const [x, y] = clampBodyCentre(body, mToPx(p[0]), -mToPx(p[1]), this.containBox())
    Body.setPosition(body, { x, y })
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
      if ((b.entity.kind !== 'spring' && b.entity.kind !== 'spring_h') || !b.main || !b.anchor) continue
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
