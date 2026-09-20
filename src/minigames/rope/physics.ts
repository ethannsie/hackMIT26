import Matter from 'matter-js'
import { HEIGHT, WIDTH, type Point, type RopeLevel } from './levels.ts'

const { Engine, Bodies, Body, Composite } = Matter
const STEP = 1 / 240
export const PIXELS_PER_METRE = 85
export const GRAVITY = 9.81 * PIXELS_PER_METRE
export const CANDY_RADIUS = 24
export const MAX_SPEED = 1800
export type Outcome = 'playing' | 'won' | 'lost'
export interface Rope { anchor: Point; length: number; cut: boolean }
export interface GameEvent { kind: 'cut' | 'star' | 'won' | 'lost'; at: Point }

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/** Swept blade against rope: fast swipes cannot tunnel between camera frames. */
export function segmentsMeet(a: Point, b: Point, c: Point, d: Point, margin = 8): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d),
    distanceToSegment(c, a, b), distanceToSegment(d, a, b)) <= margin
}

/** Dedicated rigid-body world. Hands only sever constraints.
 * 240 Hz collision substeps keep the fastest allowed flight below 8 px per step.
 */
export class RopeWorld {
  readonly engine = Engine.create({ positionIterations: 12, velocityIterations: 10 })
  readonly body: Matter.Body
  ropes: Rope[]
  collected: boolean[]
  outcome: Outcome = 'playing'
  elapsed = 0
  events: GameEvent[] = []
  private accumulator = 0

  constructor(readonly level: RopeLevel) {
    this.engine.gravity.y = 1
    this.engine.gravity.scale = GRAVITY / 1e6
    this.body = Bodies.circle(level.candy.x, level.candy.y, CANDY_RADIUS, {
      restitution: 0.48, friction: 0.08, frictionStatic: 0.12, frictionAir: 0,
      mass: 0.25, label: 'candy',
    }, 32)
    Body.setInertia(this.body, 0.5 * this.body.mass * CANDY_RADIUS ** 2)
    Composite.add(this.engine.world, this.body)
    for (const surface of level.surfaces ?? []) {
      const options = { isStatic: true, friction: 0.08, restitution: surface.kind === 'bumper' ? 0.85 : 0.35, label: surface.label }
      Composite.add(this.engine.world, surface.kind === 'bumper'
        ? Bodies.circle(surface.x, surface.y, surface.radius, options, 48)
        : Bodies.rectangle(surface.x, surface.y, surface.width, surface.height, { ...options, angle: surface.angle ?? 0 }))
    }
    this.ropes = level.anchors.map(anchor => ({ anchor: { ...anchor },
      length: Math.hypot(anchor.x - level.candy.x, anchor.y - level.candy.y), cut: false }))
    this.collected = level.stars.map(() => false)
  }

  get candy(): Point { return this.body.position }
  get velocity(): Point { const v = Body.getVelocity(this.body); return { x: v.x * 60, y: v.y * 60 } }
  set velocity(v: Point) { Body.setVelocity(this.body, { x: v.x / 60, y: v.y / 60 }) }
  get speed(): number { const v = this.velocity; return Math.hypot(v.x, v.y) / PIXELS_PER_METRE }
  get angle(): number { return this.body.angle }
  get stars(): number { return this.collected.filter(Boolean).length }
  get cuts(): number { return this.ropes.filter(r => r.cut).length }

  dispose(): void { Composite.clear(this.engine.world, false); Engine.clear(this.engine) }

  cutAll(): void {
    if (this.outcome !== 'playing') return
    for (const rope of this.ropes) if (!rope.cut) this.cut(rope)
  }
  private cut(rope: Rope): void {
    rope.cut = true
    this.events.push({ kind: 'cut', at: { x: (rope.anchor.x + this.candy.x) / 2, y: (rope.anchor.y + this.candy.y) / 2 } })
  }
  swipe(from: Point, to: Point): number {
    if (this.outcome !== 'playing' || Math.hypot(to.x - from.x, to.y - from.y) < 4) return 0
    let count = 0
    for (const rope of this.ropes) if (!rope.cut && segmentsMeet(from, to, rope.anchor, this.candy)) { this.cut(rope); count++ }
    return count
  }

  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0 || this.outcome !== 'playing') return
    this.accumulator += Math.min(seconds, 0.1)
    while (this.accumulator + 1e-10 >= STEP && this.outcome === 'playing') {
      this.accumulator -= STEP
      this.step()
    }
  }

  private step(): void {
    this.elapsed += STEP
    const before = { ...this.candy }
    Engine.update(this.engine, STEP * 1000)
    for (let iteration = 0; iteration < 4; iteration++) for (const rope of this.ropes) {
      if (rope.cut) continue
      const dx = this.candy.x - rope.anchor.x, dy = this.candy.y - rope.anchor.y, length = Math.hypot(dx, dy)
      if (length <= rope.length || length === 0) continue
      const nx = dx / length, ny = dy / length, v = this.velocity
      Body.setPosition(this.body, { x: rope.anchor.x + nx * rope.length, y: rope.anchor.y + ny * rope.length })
      const outward = v.x * nx + v.y * ny
      if (outward > 0) this.velocity = { x: v.x - outward * nx, y: v.y - outward * ny }
    }
    const v = this.velocity, speed = Math.hypot(v.x, v.y)
    if (speed > MAX_SPEED) this.velocity = { x: v.x * MAX_SPEED / speed, y: v.y * MAX_SPEED / speed }
    this.level.stars.forEach((star, i) => {
      if (!this.collected[i] && distanceToSegment(star, before, this.candy) < CANDY_RADIUS + 19) {
        this.collected[i] = true; this.events.push({ kind: 'star', at: { ...star } })
      }
    })
    if (distanceToSegment(this.level.mouth, before, this.candy) < 50) {
      this.outcome = 'won'; this.events.push({ kind: 'won', at: { ...this.level.mouth } })
    } else if (this.candy.y > HEIGHT + 60 || this.candy.x < -80 || this.candy.x > WIDTH + 80) {
      this.outcome = 'lost'; this.events.push({ kind: 'lost', at: { ...this.candy } })
    }
  }
}
