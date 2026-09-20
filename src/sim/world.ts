/**
 * The deterministic sim wrapper.
 *
 * Determinism rule, and it is the whole point of this file: physics only ever
 * advances through `step()`, which uses FIXED_DT_MS. Nothing here ever reads a
 * requestAnimationFrame delta. The render loop converts wall-clock time into a
 * whole number of fixed steps (see `advance`), so a slow frame produces the
 * same trajectory as a fast one — just computed in a bigger batch.
 *
 * Same spec + same step count = same result, on any machine, at any frame rate.
 */
import Matter from 'matter-js'
import {
  FIXED_DT_MS,
  FIXED_DT_S,
  PX_PER_M,
  mToPx,
  msToMatterVel,
  gravityY,
  pxToM,
  matterVelToMs,
  matterAngVelToRads,
  RAD,
} from './units.ts'
import { buildScene, addToWorld, type BuiltScene, type ViewBox } from './builders.ts'
import { containBody, clampBodyCentre, type PxBox } from './contain.ts'
import { installCorrections, type Corrections } from './corrections.ts'
import { toParams, type SimParams } from './params.ts'
import { solveAsked, type Solution } from './analytic.ts'
import type { ProblemSpec } from '../spec/types.ts'

const { Engine, Composite, Body } = Matter

/**
 * Newtons -> Matter force units.
 *
 * Matter integrates acceleration = force / mass in px/ms². Every dynamic body
 * here has had Body.setMass called with its real mass in kg, so Matter's mass
 * IS kilograms. That leaves only the length and time conversion: 1 N on 1 kg is
 * 1 m/s², which is PX_PER_M/1e6 px/ms².
 */
const FORCE_N_TO_MATTER = PX_PER_M / 1e6

const GRAVITY_FREE: ReadonlySet<string> = new Set([
  'circular_motion',
  'charged_particle_magnetic',
  'rotating_frame',
  'angular_momentum_point',
])

/** Metric snapshot of one body. Everything here is SI; no pixels escape. */
export interface BodyState {
  id: string
  /** Metres, y positive UP from the ground. */
  position_m: [number, number]
  velocity_ms: [number, number]
  speed_ms: number
  angle_deg: number
  angular_velocity_rads: number
  mass_kg: number
  kinetic_energy_j: number
  potential_energy_j: number
}

export interface SimState {
  time_s: number
  steps: number
  bodies: Record<string, BodyState>
  focus: BodyState
  total_kinetic_j: number
  total_potential_j: number
  /** Closed-form answers for the quantities the problem asked for. */
  solutions: Solution[]
}

/** A force the hand (or anything else) is applying this step. */
export interface AppliedForce {
  bodyId: string
  /** Newtons, y positive UP. */
  force_n: [number, number]
}

export class SimWorld {
  readonly engine: Matter.Engine
  readonly params: SimParams
  readonly spec: ProblemSpec
  /** Gravity in m/s², kept in SI so readouts never have to invert the calibration. */
  readonly g_ms2: number

  private scene: BuiltScene
  private corrections: Corrections
  private accumulatorMs = 0
  steps = 0

  constructor(spec: ProblemSpec) {
    this.spec = spec
    this.params = toParams(spec)
    // Four of the hard-to-picture types run with gravity off. Gravity is not
    // the lesson in any of them, and leaving it on would just drag the body out
    // of frame mid-explanation.
    this.g_ms2 = GRAVITY_FREE.has(this.params.kind)
      ? 0
      : 'g' in this.params
        ? this.params.g
        : 9.81

    this.engine = Engine.create()
    // Pin the scale to 1 so gravityY() is the sole gravity calibration point.
    this.engine.gravity.scale = 1
    this.engine.gravity.x = 0
    this.engine.gravity.y = gravityY(this.g_ms2)

    // A rigid pendulum rod needs far more constraint solving than the default 2.
    this.engine.constraintIterations = 12
    this.engine.positionIterations = 10
    this.engine.velocityIterations = 8
    // Matter's default sleeping would freeze a block we still want to watch.
    this.engine.enableSleeping = false

    this.scene = buildScene(this.params)
    addToWorld(this.engine.world, this.scene)
    this.corrections = installCorrections(this.engine, this.scene, this.params)
  }

  /** The ids the hand is permitted to push. Static geometry is never in here. */
  get interactableIds(): readonly string[] {
    return this.scene.interactableIds
  }

  /** Stable camera framing for this problem, in metres. */
  get view(): ViewBox {
    return this.scene.view
  }

  /** The border every body is kept inside, in metres. Drawn by the renderer. */
  get bounds(): ViewBox {
    return this.scene.bounds
  }

  /** Bodies that have left the world and been parked. */
  readonly escaped = new Set<string>()

  /**
   * Catch anything that leaves the world.
   *
   * A projectile that lands keeps rolling; with the old fixed floor it reached
   * the edge at x = 20 m, fell off, and was 10 km below the scene a minute
   * later. Parking it at the boundary keeps the readouts, the energy totals and
   * the camera meaningful instead of tracking something nobody can see.
   */
  private enforceEscapeNet(): void {
    const v = this.scene.view
    const spanX = Math.max(v.maxX_m - v.minX_m, 1)
    const spanY = Math.max(v.maxY_m - v.minY_m, 1)
    const limitX = mToPx(Math.abs(v.minX_m) + spanX * 6)
    const limitY = mToPx(Math.abs(v.maxY_m) + spanY * 6)

    for (const [id, body] of Object.entries(this.scene.byId)) {
      if (body.isStatic) continue
      const p = body.position
      const lost =
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > limitX ||
        Math.abs(p.y) > limitY

      if (!lost) {
        this.escaped.delete(id)
        continue
      }
      this.escaped.add(id)
      Body.setPosition(body, {
        x: Number.isFinite(p.x) ? Math.max(-limitX, Math.min(limitX, p.x)) : 0,
        y: Number.isFinite(p.y) ? Math.max(-limitY, Math.min(limitY, p.y)) : 0,
      })
      Body.setVelocity(body, { x: 0, y: 0 })
      Body.setAngularVelocity(body, 0)
    }
  }

  bodyById(id: string): Matter.Body | undefined {
    return this.scene.byId[id]
  }

  /**
   * The box no movable body may leave, in Matter px (y down). The border
   * walls on three sides; the floor's surface where there is a floor, else
   * the bottom wall. See contain.ts for why the walls alone are not enough.
   */
  private containBox(): PxBox {
    const b = this.scene.bounds
    return {
      minX: mToPx(b.minX_m),
      maxX: mToPx(b.maxX_m),
      top: -mToPx(b.maxY_m),
      bottom: this.scene.byId['ground'] ? 0 : -mToPx(b.minY_m),
    }
  }

  /** Put anything that got out (tunnelled, dragged, blew up) back inside. */
  private containBodies(): void {
    const box = this.containBox()
    for (const body of Object.values(this.scene.byId)) containBody(body, box)
  }

  /**
   * Advance exactly one fixed step, with any external forces applied for the
   * duration of that step. Matter clears forces after each update, so callers
   * pass the force every step it should act, rather than once.
   */
  step(forces: AppliedForce[] = []): void {
    for (const f of forces) {
      const body = this.scene.byId[f.bodyId]
      if (!body || body.isStatic) continue
      // Enforced here, not just in the spec: a ramp can never be pushed.
      if (!this.scene.interactableIds.includes(f.bodyId)) continue

      Body.applyForce(body, body.position, {
        x: f.force_n[0] * FORCE_N_TO_MATTER,
        y: -f.force_n[1] * FORCE_N_TO_MATTER, // caller's y is up, Matter's is down
      })
    }

    this.corrections.preStep()
    Engine.update(this.engine, FIXED_DT_MS)
    this.corrections.postStep?.()
    this.enforceEscapeNet()
    this.containBodies()
    this.steps += 1
  }


  /**
   * Put a body back to a recorded state, for timeline scrubbing.
   *
   * Corrections that carry their own internal state — the pendulum's angle and
   * rate — are re-derived afterwards, or resuming from a scrubbed frame would
   * snap the bob back to wherever the integrator last was.
   */
  applyBodyState(
    id: string,
    f: { x_m: number; y_m: number; angle_deg: number; vx_ms: number; vy_ms: number; omega_rads: number },
  ): void {
    const body = this.scene.byId[id]
    if (!body || body.isStatic) return
    Body.setPosition(body, { x: mToPx(f.x_m), y: -mToPx(f.y_m) })
    Body.setAngle(body, f.angle_deg * (Math.PI / 180))
    Body.setVelocity(body, { x: msToMatterVel(f.vx_ms), y: -msToMatterVel(f.vy_ms) })
    Body.setAngularVelocity(body, f.omega_rads * FIXED_DT_S)
    // A scrub is an explicit jump in simulation time, not a partial render
    // delta that should be carried into the next play press.
    this.accumulatorMs = 0
  }

  /** Re-derive any internal correction state from the bodies. */
  resyncCorrections(): void {
    this.corrections.resync?.()
  }

  /** Every body id the renderer and selection can address. */
  get bodyIds(): string[] {
    return Object.keys(this.scene.byId)
  }

  /**
   * Set a body's velocity in m/s, y positive UP.
   * Used when the hand releases a grabbed body — this is the throw.
   */
  setVelocityMs(id: string, v: [number, number]): void {
    const body = this.scene.byId[id]
    if (!body || body.isStatic) return
    Body.setVelocity(body, { x: msToMatterVel(v[0]), y: -msToMatterVel(v[1]) })
  }

  /**
   * Teleport a body to a position in metres, y positive UP.
   *
   * Used while a body is held: a grab is a position constraint, not a force, so
   * the body follows the palm exactly rather than chasing it through a spring.
   */
  setPositionM(id: string, p: [number, number]): void {
    const body = this.scene.byId[id]
    if (!body || body.isStatic) return
    // A grab is a teleport; clamp it so a hand cannot carry a body through a wall.
    const [x, y] = clampBodyCentre(body, mToPx(p[0]), -mToPx(p[1]), this.containBox())
    Body.setPosition(body, { x, y })
  }

  /** Advance n fixed steps. Used by the verify script and any test. */
  stepMany(n: number, forces: AppliedForce[] = []): void {
    for (let i = 0; i < n; i++) this.step(forces)
  }

  /**
   * Turn elapsed wall-clock milliseconds into whole fixed steps.
   * Capped so a backgrounded tab cannot trigger a thousand-step catch-up.
   */
  advance(elapsedMs: number, forces: AppliedForce[] = [], maxSteps = 8): number {
    this.accumulatorMs = Math.min(this.accumulatorMs + elapsedMs, FIXED_DT_MS * maxSteps)
    let taken = 0
    while (this.accumulatorMs >= FIXED_DT_MS) {
      this.step(forces)
      this.accumulatorMs -= FIXED_DT_MS
      taken += 1
    }
    return taken
  }

  /**
   * Like `advance`, but asks for the forces afresh before each fixed step.
   *
   * This is the form the render loop uses: the hand is sampled per PHYSICS step
   * rather than per rendered frame, so a dropped frame does not change how hard
   * or how long a push was applied.
   */
  advanceWith(elapsedMs: number, forcesFor: () => AppliedForce[], maxSteps = 8): number {
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

  /** Rebuild from the original spec. Identical starting state, every time. */
  reset(): void {
    this.escaped.clear()
    this.corrections.dispose()
    Composite.clear(this.engine.world, false)
    this.scene = buildScene(this.params)
    addToWorld(this.engine.world, this.scene)
    this.corrections = installCorrections(this.engine, this.scene, this.params)
    this.steps = 0
    this.accumulatorMs = 0
  }

  /** Detach engine listeners. Call when discarding a world. */
  dispose(): void {
    this.corrections.dispose()
    Composite.clear(this.engine.world, false)
  }

  private readBody(id: string, body: Matter.Body): BodyState {
    const x = pxToM(body.position.x)
    const y = -pxToM(body.position.y) // flip to y-up
    const vx = matterVelToMs(body.velocity.x)
    const vy = -matterVelToMs(body.velocity.y)
    const speed = Math.hypot(vx, vy)
    const m = body.isStatic ? 0 : body.mass

    return {
      id,
      position_m: [x, y],
      velocity_ms: [vx, vy],
      speed_ms: speed,
      angle_deg: body.angle * RAD,
      angular_velocity_rads: matterAngVelToRads(body.angularVelocity),
      mass_kg: m,
      kinetic_energy_j: 0.5 * m * speed * speed,
      potential_energy_j: m * this.g_ms2 * y,
    }
  }

  state(): SimState {
    const bodies: Record<string, BodyState> = {}
    let kin = 0
    let pot = 0
    for (const [id, body] of Object.entries(this.scene.byId)) {
      const s = this.readBody(id, body)
      bodies[id] = s
      if (!body.isStatic) {
        kin += s.kinetic_energy_j
        pot += s.potential_energy_j
      }
    }
    return {
      time_s: this.time_s,
      steps: this.steps,
      bodies,
      focus: bodies[this.scene.focusId]!,
      total_kinetic_j: kin,
      total_potential_j: pot,
      solutions: solveAsked(this.params, this.spec.asked_for),
    }
  }
}
