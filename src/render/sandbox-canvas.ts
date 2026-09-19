/**
 * Sandbox view: draws the composed scene, the selection, and a ghost preview of
 * whatever component is armed for placement.
 *
 * Kept separate from CanvasView rather than bolted onto it. That one frames a
 * single solved problem tightly; this one needs a stable world-anchored camera,
 * because a camera that refits every frame makes placing components impossible.
 */
import Matter from 'matter-js'
import { mToPx } from '../sim/units.ts'
import type { SandboxWorld } from '../sandbox/world.ts'
import type { Entity, EntityKind } from '../sandbox/types.ts'
import { ICONS } from '../sandbox/palette.ts'
import { FORCE_COLORS, type ForceVector } from '../sim/fbd.ts'

export interface SandboxDrawOptions {
  paths: Record<string, { x: number; y: number }[]>
  forces: ForceVector[]
}

const COLORS = {
  bg: '#0f1115',
  grid: '#1b1f27',
  axis: '#2b3240',
  static: '#39415a',
  dynamic: '#4da3ff',
  charged: '#ffd166',
  selected: '#5ee6a8',
  field: '#c792ea',
  spring: '#8f9bb3',
  ghost: '#5ee6a8',
  text: '#c9d1d9',
  dim: '#6e7681',
  velocity: '#5ee6a8',
}

export class SandboxView {
  private ctx: CanvasRenderingContext2D
  /**
   * Screen px per sim px. Never refit automatically — placement needs a stable
   * mapping between where you click and where a component lands. Zoom and pan
   * are user actions only.
   */
  private scale = 0.55
  private panX = 0
  private panY = 0
  /** User pan offset in screen px, on top of the default framing. */
  private offsetX = 0
  private offsetY = 0

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1
    const { clientWidth: w, clientHeight: h } = this.canvas
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr
      this.canvas.height = h * dpr
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Origin sits low-centre: the ground line, with headroom above it.
    this.panX = w / 2 + this.offsetX
    this.panY = h * 0.82 + this.offsetY
  }

  /** Zoom about a screen point, so the thing under the cursor stays put. */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.canvas.getBoundingClientRect()
    const before = this.toScene(clientX, clientY)
    this.scale = Math.max(0.12, Math.min(3, this.scale * factor))
    // Recompute the base origin at the new scale, then correct the offset so the
    // scene point under the cursor is unchanged.
    this.panX = rect.width / 2 + this.offsetX
    this.panY = rect.height * 0.82 + this.offsetY
    const after = this.toScene(clientX, clientY)
    this.offsetX += (after[0] - before[0]) * mToPx(1) * this.scale
    this.offsetY -= (after[1] - before[1]) * mToPx(1) * this.scale
  }

  pan(dx: number, dy: number): void {
    this.offsetX += dx
    this.offsetY += dy
  }

  /** Frame the arena, filling the canvas with a margin. */
  fit(arena: { width_m: number; height_m: number }): void {
    const { clientWidth: w, clientHeight: h } = this.canvas
    if (w === 0 || h === 0) return
    const margin = 0.88
    this.scale = Math.min(
      (w * margin) / mToPx(arena.width_m),
      (h * margin) / mToPx(arena.height_m),
    )
    this.offsetX = 0
    // Centre the arena vertically rather than sitting it on the 82% line.
    this.offsetY = h * 0.5 - h * 0.82 + (mToPx(arena.height_m) * this.scale) / 2
  }

  private sx(x: number): number {
    return this.panX + x * this.scale
  }
  private sy(y: number): number {
    return this.panY + y * this.scale
  }

  /** Screen point to scene metres (y up). The inverse of sx/sy. */
  toScene(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect()
    const px = (clientX - rect.left - this.panX) / this.scale
    const py = (clientY - rect.top - this.panY) / this.scale
    return [px / mToPx(1), -py / mToPx(1)]
  }

  private grid(): void {
    const { ctx } = this
    const step = mToPx(0.5) * this.scale
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = this.panX % step; x < this.canvas.clientWidth; x += step) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, this.canvas.clientHeight)
    }
    for (let y = this.panY % step; y < this.canvas.clientHeight; y += step) {
      ctx.moveTo(0, y)
      ctx.lineTo(this.canvas.clientWidth, y)
    }
    ctx.stroke()

    // The origin: angular momentum in the panel is measured about this point.
    ctx.strokeStyle = COLORS.axis
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, this.sy(0))
    ctx.lineTo(this.canvas.clientWidth, this.sy(0))
    ctx.stroke()
    ctx.fillStyle = COLORS.axis
    ctx.beginPath()
    ctx.arc(this.sx(0), this.sy(0), 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillText('O', this.sx(0) + 7, this.sy(0) - 7)
  }

  private bodyPath(body: Matter.Body): void {
    const { ctx } = this
    ctx.beginPath()
    if (body.circleRadius && body.circleRadius > 0) {
      ctx.arc(this.sx(body.position.x), this.sy(body.position.y), body.circleRadius * this.scale, 0, Math.PI * 2)
    } else {
      const vs = body.vertices
      ctx.moveTo(this.sx(vs[0]!.x), this.sy(vs[0]!.y))
      for (let i = 1; i < vs.length; i++) ctx.lineTo(this.sx(vs[i]!.x), this.sy(vs[i]!.y))
      ctx.closePath()
    }
  }

  /** Trajectory of a body, brightest at the present. */
  private drawPath(points: { x: number; y: number }[], color: string, width: number): void {
    if (points.length < 2) return
    const { ctx } = this
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const n = points.length
    for (let i = 1; i < n; i++) {
      const a = points[i - 1]!
      const b = points[i]!
      ctx.globalAlpha = 0.12 + 0.68 * (i / n)
      ctx.beginPath()
      ctx.moveTo(this.sx(mToPx(a.x)), this.sy(-mToPx(a.y)))
      ctx.lineTo(this.sx(mToPx(b.x)), this.sy(-mToPx(b.y)))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  /** Free-body diagram, normalised so the largest force fills a fixed length. */
  private drawForces(body: Matter.Body, forces: ForceVector[]): void {
    if (forces.length === 0) return
    const { ctx } = this
    const ox = this.sx(body.position.x)
    const oy = this.sy(body.position.y)
    const peak = Math.max(...forces.map((f) => f.magnitude_n), 1e-9)

    for (const f of forces) {
      if (f.magnitude_n < 1e-6) continue
      const len = (f.magnitude_n / peak) * 72
      const ux = f.vec_n[0] / f.magnitude_n
      const uy = -f.vec_n[1] / f.magnitude_n
      const tipX = ox + ux * len
      const tipY = oy + uy * len
      ctx.strokeStyle = FORCE_COLORS[f.kind]
      ctx.fillStyle = FORCE_COLORS[f.kind]
      ctx.lineWidth = f.kind === 'net' ? 2 : 2.5
      if (f.kind === 'net') ctx.setLineDash([5, 3])
      ctx.beginPath()
      ctx.moveTo(ox, oy)
      ctx.lineTo(tipX, tipY)
      ctx.stroke()
      ctx.setLineDash([])
      const a = Math.atan2(uy, ux)
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(tipX - 9 * Math.cos(a - 0.38), tipY - 9 * Math.sin(a - 0.38))
      ctx.lineTo(tipX - 9 * Math.cos(a + 0.38), tipY - 9 * Math.sin(a + 0.38))
      ctx.closePath()
      ctx.fill()
      ctx.font = '600 10px ui-monospace, monospace'
      ctx.textAlign = ux < -0.25 ? 'right' : 'left'
      ctx.fillText(`${f.label} ${f.magnitude_n.toFixed(1)} N`, tipX + ux * 10 - uy * 5, tipY + uy * 10 + ux * 5 + 3)
      ctx.textAlign = 'left'
    }
  }

  draw(
    world: SandboxWorld,
    selectedId: string | null,
    armed: EntityKind | null,
    cursor: [number, number] | null,
    opts: SandboxDrawOptions = { paths: {}, forces: [] },
  ): void {
    this.resize()
    const { ctx } = this
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight)
    this.grid()

    // The arena outline: where components can live, and where the walls are.
    const arena = world.scene.arena
    const ax = this.sx(-mToPx(arena.width_m / 2))
    const ay = this.sy(-mToPx(arena.height_m))
    const aw = mToPx(arena.width_m) * this.scale
    const ah = mToPx(arena.height_m) * this.scale
    ctx.strokeStyle = arena.walls ? COLORS.static : COLORS.grid
    ctx.lineWidth = arena.walls ? 2 : 1
    if (!arena.walls) ctx.setLineDash([5, 5])
    ctx.strokeRect(ax, ay, aw, ah)
    ctx.setLineDash([])

    // Field regions first, so bodies draw on top of them.
    for (const c of world.components) {
      if (!c.region || c.entity.kind !== 'magnet_region') continue
      const e = c.entity
      this.bodyPath(c.region)
      ctx.fillStyle = COLORS.field
      ctx.globalAlpha = 0.09
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = COLORS.field
      ctx.setLineDash([6, 4])
      ctx.lineWidth = selectedId === e.id ? 2.5 : 1.5
      ctx.stroke()
      ctx.setLineDash([])

      // Conventional out-of-page dots / into-page crosses.
      ctx.fillStyle = COLORS.field
      ctx.strokeStyle = COLORS.field
      ctx.globalAlpha = 0.5
      const b = c.region.bounds
      for (let gx = b.min.x; gx <= b.max.x; gx += mToPx(0.5)) {
        for (let gy = b.min.y; gy <= b.max.y; gy += mToPx(0.5)) {
          const px = this.sx(gx)
          const py = this.sy(gy)
          ctx.beginPath()
          if (e.b_field_tesla >= 0) {
            ctx.arc(px, py, 1.8, 0, Math.PI * 2)
            ctx.fill()
          } else {
            ctx.moveTo(px - 2.5, py - 2.5)
            ctx.lineTo(px + 2.5, py + 2.5)
            ctx.moveTo(px + 2.5, py - 2.5)
            ctx.lineTo(px - 2.5, py + 2.5)
            ctx.stroke()
          }
        }
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = COLORS.field
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText(`B = ${e.b_field_tesla.toFixed(1)} T`, this.sx(b.min.x) + 6, this.sy(b.min.y) + 14)
    }

    // Ground, if present.
    for (const body of Matter.Composite.allBodies(world.engine.world)) {
      if (body.label !== 'ground') continue
      this.bodyPath(body)
      ctx.fillStyle = COLORS.static
      ctx.fill()
    }

    // Springs: a coil between anchor and bob.
    for (const c of world.components) {
      if (c.entity.kind !== 'spring' || !c.main || !c.anchor) continue
      const ax = this.sx(c.anchor.position.x)
      const ay = this.sy(c.anchor.position.y)
      const bx = this.sx(c.main.position.x)
      const by = this.sy(c.main.position.y)
      const dx = bx - ax
      const dy = by - ay
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len

      ctx.strokeStyle = selectedId === c.entity.id ? COLORS.selected : COLORS.spring
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      const coils = 14
      for (let i = 1; i < coils; i++) {
        const t = i / coils
        const amp = (i % 2 === 0 ? 1 : -1) * 7
        ctx.lineTo(ax + dx * t + nx * amp, ay + dy * t + ny * amp)
      }
      ctx.lineTo(bx, by)
      ctx.stroke()

      ctx.fillStyle = COLORS.dim
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText(`k = ${c.entity.stiffness_n_per_m} N/m`, ax + 8, ay - 6)
    }

    // Rods.
    ctx.lineWidth = 2
    for (const c of world.components) {
      if (c.entity.kind !== 'pendulum' || !c.main || !c.anchor) continue
      ctx.strokeStyle = selectedId === c.entity.id ? COLORS.selected : COLORS.dim
      ctx.beginPath()
      ctx.moveTo(this.sx(c.anchor.position.x), this.sy(c.anchor.position.y))
      ctx.lineTo(this.sx(c.main.position.x), this.sy(c.main.position.y))
      ctx.stroke()
    }

    // Anchors and pivots.
    for (const c of world.components) {
      if (!c.anchor) continue
      ctx.fillStyle = COLORS.static
      ctx.beginPath()
      ctx.arc(this.sx(c.anchor.position.x), this.sy(c.anchor.position.y), 5, 0, Math.PI * 2)
      ctx.fill()
    }

    // Bodies.
    for (const c of world.components) {
      const body = c.main
      if (!body) continue
      const e = c.entity
      const charged = 'charge_c' in e && e.charge_c !== 0
      const fill = body.isStatic ? COLORS.static : charged ? COLORS.charged : COLORS.dynamic

      this.bodyPath(body)
      ctx.fillStyle = fill
      ctx.globalAlpha = 0.85
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = selectedId === e.id ? COLORS.selected : fill
      ctx.lineWidth = selectedId === e.id ? 3 : 1.5
      ctx.stroke()

      if (charged) {
        ctx.fillStyle = '#0f1115'
        ctx.font = 'bold 11px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(
          (e as { charge_c: number }).charge_c > 0 ? '+' : '−',
          this.sx(body.position.x),
          this.sy(body.position.y) + 4,
        )
        ctx.textAlign = 'left'
      }
    }

    // Velocity arrow on the selection only, so the scene stays readable.
    if (selectedId) {
      const body = world.bodyById(selectedId)
      const state = world.states().find((s) => s.id === selectedId)
      if (body && state && state.speed_ms > 0.05) {
        const fx = this.sx(body.position.x)
        const fy = this.sy(body.position.y)
        const dx = mToPx(state.velocity_ms[0] * 0.18) * this.scale
        const dy = -mToPx(state.velocity_ms[1] * 0.18) * this.scale
        ctx.strokeStyle = COLORS.velocity
        ctx.fillStyle = COLORS.velocity
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(fx, fy)
        ctx.lineTo(fx + dx, fy + dy)
        ctx.stroke()
        const a = Math.atan2(dy, dx)
        ctx.beginPath()
        ctx.moveTo(fx + dx, fy + dy)
        ctx.lineTo(fx + dx - 9 * Math.cos(a - 0.4), fy + dy - 9 * Math.sin(a - 0.4))
        ctx.lineTo(fx + dx - 9 * Math.cos(a + 0.4), fy + dy - 9 * Math.sin(a + 0.4))
        ctx.closePath()
        ctx.fill()
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillText(`${state.speed_ms.toFixed(2)} m/s`, fx + dx + 6, fy + dy - 6)
      }
    }

    // Paths over the bodies, for the same reason as in the problem view.
    for (const [id, pts] of Object.entries(opts.paths)) {
      const isSel = id === selectedId
      this.drawPath(pts, isSel ? COLORS.velocity : COLORS.dim, isSel ? 2 : 1.5)
    }

    // Free-body diagram on the selection.
    if (opts.forces.length > 0) {
      const target = selectedId ? world.bodyById(selectedId) : undefined
      const fallback = world.components.find((c) => c.main && !c.main.isStatic)?.main
      const body = target ?? fallback
      if (body) this.drawForces(body, opts.forces)
    }

    // Ghost preview of the armed component.
    if (armed && cursor) {
      ctx.fillStyle = COLORS.ghost
      ctx.globalAlpha = 0.5
      ctx.font = '26px ui-sans-serif, system-ui'
      ctx.textAlign = 'center'
      ctx.fillText(ICONS[armed], this.sx(mToPx(cursor[0])), this.sy(-mToPx(cursor[1])) + 9)
      ctx.textAlign = 'left'
      ctx.globalAlpha = 1
      ctx.fillStyle = COLORS.dim
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillText('click to place · esc to cancel', 12, this.canvas.clientHeight - 14)
    }

    ctx.fillStyle = COLORS.text
    ctx.font = '12px ui-monospace, monospace'
    ctx.fillText(`t = ${world.time_s.toFixed(2)} s   step ${world.steps}`, 12, 20)
  }

  /** Topmost component whose body contains this scene point, if any. */
  pick(world: SandboxWorld, scene_m: [number, number]): Entity | null {
    const p = { x: mToPx(scene_m[0]), y: -mToPx(scene_m[1]) }
    const hits = world.components.filter((c) => {
      const body = c.main ?? c.region
      if (!body) return false
      return Matter.Bounds.contains(body.bounds, p)
    })
    // Prefer movable components: a ball inside a field region should win.
    const movable = hits.find((c) => c.main && !c.main.isStatic)
    return (movable ?? hits[hits.length - 1])?.entity ?? null
  }
}
