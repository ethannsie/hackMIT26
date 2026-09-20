import { HEIGHT, WIDTH, type Point, type RopeLevel } from './levels.ts'

const STEP = 1 / 120
const GRAVITY = 850
export const CANDY_RADIUS = 24
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

/** Pure, fixed-step simulation. No DOM, shared physics world, or camera ownership. */
export class RopeWorld {
  candy: Point
  velocity: Point = { x: 0, y: 0 }
  ropes: Rope[]
  collected: boolean[]
  outcome: Outcome = 'playing'
  elapsed = 0
  events: GameEvent[] = []
  private accumulator = 0

  constructor(readonly level: RopeLevel) {
    this.candy = { ...level.candy }
    this.ropes = level.anchors.map(anchor => ({ anchor: { ...anchor },
      length: Math.hypot(anchor.x - level.candy.x, anchor.y - level.candy.y), cut: false }))
    this.collected = level.stars.map(() => false)
  }

  get stars(): number { return this.collected.filter(Boolean).length }
  get cuts(): number { return this.ropes.filter(r => r.cut).length }

  swipe(from: Point, to: Point): number {
    if (this.outcome !== 'playing' || Math.hypot(to.x - from.x, to.y - from.y) < 4) return 0
    let count = 0
    for (const rope of this.ropes) {
      if (!rope.cut && segmentsMeet(from, to, rope.anchor, this.candy)) {
        rope.cut = true
        this.events.push({ kind: 'cut', at: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } })
        count++
      }
    }
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
    this.velocity.y += GRAVITY * STEP
    this.candy.x += this.velocity.x * STEP
    this.candy.y += this.velocity.y * STEP
    // A rope pulls but cannot push. Project the taut rope and remove only the
    // outward velocity, preserving the swing's tangential momentum on release.
    for (let iteration = 0; iteration < 8; iteration++) {
      for (const rope of this.ropes) {
        if (rope.cut) continue
        const dx = this.candy.x - rope.anchor.x, dy = this.candy.y - rope.anchor.y
        const length = Math.hypot(dx, dy)
        if (length <= rope.length || length === 0) continue
        const nx = dx / length, ny = dy / length
        this.candy.x = rope.anchor.x + nx * rope.length
        this.candy.y = rope.anchor.y + ny * rope.length
        const outward = this.velocity.x * nx + this.velocity.y * ny
        if (outward > 0) {
          this.velocity.x -= outward * nx
          this.velocity.y -= outward * ny
        }
      }
    }
    this.level.stars.forEach((star, i) => {
      if (!this.collected[i] && distanceToSegment(star, before, this.candy) < CANDY_RADIUS + 19) {
        this.collected[i] = true
        this.events.push({ kind: 'star', at: { ...star } })
      }
    })
    if (distanceToSegment(this.level.mouth, before, this.candy) < 35) {
      this.outcome = 'won'
      this.events.push({ kind: 'won', at: { ...this.level.mouth } })
    } else if (this.candy.y > HEIGHT + 60 || this.candy.x < -80 || this.candy.x > WIDTH + 80) {
      this.outcome = 'lost'
      this.events.push({ kind: 'lost', at: { ...this.candy } })
    }
  }
}
