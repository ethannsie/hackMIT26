/**
 * 2D canvas view of the sim.
 *
 * Deliberately NOT three.js yet. The plan (§5) renders the scene in 3D with an
 * articulated hand, but that is the tracking side's surface. This draws the
 * solver's actual state directly, so when the animation and the derivation
 * panel disagree we can see which one is lying. It stays useful as a debug view
 * after the 3D scene lands.
 */
import Matter from 'matter-js'
import { mToPx } from '../sim/units.ts'
import type { SimWorld, SimState } from '../sim/world.ts'
import type { CouplingState } from '../hand/coupling.ts'

const COLORS = {
  bg: '#0f1115',
  grid: '#1b1f27',
  ground: '#2a3040',
  static: '#39415a',
  dynamic: '#4da3ff',
  grabbed: '#ffd166',
  velocity: '#5ee6a8',
  accel: '#ff7b72',
  hand: '#ff9ecb',
  text: '#c9d1d9',
  dim: '#6e7681',
}

export class CanvasView {
  private ctx: CanvasRenderingContext2D
  /** Screen pixels per sim pixel, recomputed each frame to keep the scene framed. */
  private scale = 1
  private originX = 0
  private originY = 0

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
  }

  /** Screen px per metre — the mock hand needs this to match the view's scale. */
  get pixelsPerMetre(): number {
    return this.scale * mToPx(1)
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1
    const { clientWidth: w, clientHeight: h } = this.canvas
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr
      this.canvas.height = h * dpr
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** Frame the scene: fit all bodies with padding, never zooming past 1:1. */
  private fit(world: SimWorld): void {
    const bodies = Matter.Composite.allBodies(world.engine.world)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    for (const b of bodies) {
      if (b.label === 'ground') continue // the ground slab is 40 m wide; ignore it
      minX = Math.min(minX, b.bounds.min.x)
      maxX = Math.max(maxX, b.bounds.max.x)
      minY = Math.min(minY, b.bounds.min.y)
      maxY = Math.max(maxY, b.bounds.max.y)
    }
    if (!Number.isFinite(minX)) return

    maxY = Math.max(maxY, 0) // always include the ground line
    const pad = mToPx(0.3)
    const w = maxX - minX + pad * 2
    const h = maxY - minY + pad * 2

    const { clientWidth: cw, clientHeight: ch } = this.canvas
    this.scale = Math.min(cw / w, ch / h, 1.5)
    this.originX = cw / 2 - ((minX + maxX) / 2) * this.scale
    this.originY = ch / 2 - ((minY + maxY) / 2) * this.scale
  }

  private sx(x: number): number {
    return this.originX + x * this.scale
  }
  private sy(y: number): number {
    return this.originY + y * this.scale
  }

  private drawGrid(): void {
    const { ctx } = this
    const step = mToPx(0.25) * this.scale
    if (step < 8) return
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = this.originX % step; x < this.canvas.clientWidth; x += step) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, this.canvas.clientHeight)
    }
    for (let y = this.originY % step; y < this.canvas.clientHeight; y += step) {
      ctx.moveTo(0, y)
      ctx.lineTo(this.canvas.clientWidth, y)
    }
    ctx.stroke()
  }

  private drawBody(body: Matter.Body, fill: string): void {
    const { ctx } = this
    ctx.beginPath()
    if (body.circleRadius && body.circleRadius > 0) {
      ctx.arc(this.sx(body.position.x), this.sy(body.position.y), body.circleRadius * this.scale, 0, Math.PI * 2)
      // A spoke, so rotation is visible — essential for the rolling sphere.
      ctx.moveTo(this.sx(body.position.x), this.sy(body.position.y))
      ctx.lineTo(
        this.sx(body.position.x + Math.cos(body.angle) * body.circleRadius),
        this.sy(body.position.y + Math.sin(body.angle) * body.circleRadius),
      )
    } else {
      const vs = body.vertices
      ctx.moveTo(this.sx(vs[0]!.x), this.sy(vs[0]!.y))
      for (let i = 1; i < vs.length; i++) ctx.lineTo(this.sx(vs[i]!.x), this.sy(vs[i]!.y))
      ctx.closePath()
    }
    ctx.fillStyle = fill
    ctx.globalAlpha = 0.85
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = fill
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  private drawArrow(fromX: number, fromY: number, dx: number, dy: number, color: string, label: string): void {
    const len = Math.hypot(dx, dy)
    if (len < 4) return
    const { ctx } = this
    const toX = fromX + dx
    const toY = fromY + dy
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(fromX, fromY)
    ctx.lineTo(toX, toY)
    ctx.stroke()

    const a = Math.atan2(dy, dx)
    ctx.beginPath()
    ctx.moveTo(toX, toY)
    ctx.lineTo(toX - 10 * Math.cos(a - 0.4), toY - 10 * Math.sin(a - 0.4))
    ctx.lineTo(toX - 10 * Math.cos(a + 0.4), toY - 10 * Math.sin(a + 0.4))
    ctx.closePath()
    ctx.fill()

    ctx.font = '11px ui-monospace, monospace'
    ctx.fillText(label, toX + 6, toY - 6)
  }

  draw(world: SimWorld, state: SimState, coupling: CouplingState): void {
    this.resize()
    this.fit(world)

    const { ctx } = this
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight)
    this.drawGrid()

    const grabbedBody = coupling.grabbedId ? world.bodyById(coupling.grabbedId) : undefined
    for (const body of Matter.Composite.allBodies(world.engine.world)) {
      const isGrabbed = grabbedBody === body
      const fill = isGrabbed
        ? COLORS.grabbed
        : body.label === 'ground'
          ? COLORS.ground
          : body.isStatic
            ? COLORS.static
            : COLORS.dynamic
      this.drawBody(body, fill)
    }

    // Constraints (the pendulum rod).
    ctx.strokeStyle = COLORS.dim
    ctx.lineWidth = 2
    for (const c of Matter.Composite.allConstraints(world.engine.world)) {
      if (!c.bodyA || !c.bodyB) continue
      ctx.beginPath()
      ctx.moveTo(this.sx(c.bodyA.position.x), this.sy(c.bodyA.position.y))
      ctx.lineTo(this.sx(c.bodyB.position.x), this.sy(c.bodyB.position.y))
      ctx.stroke()
    }

    // Velocity vector on the focus body. 1 m/s drawn as 0.15 m.
    const focus = world.bodyById(state.focus.id)
    if (focus) {
      const fx = this.sx(focus.position.x)
      const fy = this.sy(focus.position.y)
      const [vx, vy] = state.focus.velocity_ms
      this.drawArrow(
        fx,
        fy,
        mToPx(vx * 0.15) * this.scale,
        -mToPx(vy * 0.15) * this.scale,
        COLORS.velocity,
        `v = ${state.focus.speed_ms.toFixed(2)} m/s`,
      )
    }

    // Hand contact.
    if (coupling.contactPoint_m) {
      const [hx, hy] = coupling.contactPoint_m
      const px = this.sx(mToPx(hx))
      const py = this.sy(-mToPx(hy))
      const r = 10 + coupling.penetration_m * 200
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.fillStyle = COLORS.hand
      ctx.globalAlpha = coupling.contact ? 0.35 : 0.12
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = COLORS.hand
      ctx.lineWidth = 2
      ctx.stroke()

      if (coupling.force) {
        const [fxN, fyN] = coupling.force.force_n
        this.drawArrow(px, py, fxN * 1.6, -fyN * 1.6, COLORS.accel, `F = ${Math.hypot(fxN, fyN).toFixed(1)} N`)
      }
    }

    // Readout.
    ctx.fillStyle = COLORS.text
    ctx.font = '12px ui-monospace, monospace'
    ctx.fillText(`t = ${state.time_s.toFixed(3)} s   step ${state.steps}`, 12, 20)
    ctx.fillStyle = COLORS.dim
    ctx.fillText(
      `KE ${state.total_kinetic_j.toFixed(2)} J    PE ${state.total_potential_j.toFixed(2)} J    ` +
        `E ${(state.total_kinetic_j + state.total_potential_j).toFixed(2)} J`,
      12,
      38,
    )
    ctx.fillText(`x = ${state.focus.position_m[0].toFixed(3)} m   y = ${state.focus.position_m[1].toFixed(3)} m`, 12, 56)
  }
}
