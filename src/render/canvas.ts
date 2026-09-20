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
import { BORDER_PAD_M, isWallId } from '../sim/builders.ts'
import type { SimWorld, SimState } from '../sim/world.ts'
import type { CouplingState } from '../hand/coupling.ts'
import type { HandFrame } from '../hand/types.ts'
import { drawHandOverlay } from './hand-overlay.ts'
import { FORCE_COLORS, type ForceVector } from '../sim/fbd.ts'

export interface DrawOptions {
  /** Body the graphs and the free-body diagram are following. */
  selectedId: string | null
  /** Traced paths, keyed by body id, in scene metres. */
  paths: Record<string, { x: number; y: number }[]>
  /** Forces on the selected body. Empty hides the diagram. */
  forces: ForceVector[]
  showForces: boolean
  hand: HandFrame | null
  /** The coupling's latched fist, so the avatar matches what is pushing. */
  fisted?: boolean
}

const COLORS = {
  bg: '#0f1115',
  grid: '#1b1f27',
  ground: '#2a3040',
  static: '#39415a',
  border: '#4f5b78',
  outside: 'rgba(0, 0, 0, 0.32)',
  dynamic: '#4da3ff',
  grabbed: '#ffd166',
  velocity: '#5ee6a8',
  accel: '#ff7b72',
  hand: '#00e5ff',
  concept: '#c792ea',
  sweep: '#c792ea',
  text: '#c9d1d9',
  dim: '#6e7681',
  selected: '#5ee6a8',
  path: '#4da3ff',
  pathDim: '#39465c',
}

export class CanvasView {
  private ctx: CanvasRenderingContext2D
  /** Screen pixels per sim pixel, recomputed each frame to keep the scene framed. */
  private scale = 1
  private originX = 0
  private originY = 0

  /** Recent focus-body positions, for the swept-area overlay. */
  private trail: { x: number; y: number }[] = []

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
  }

  toScene(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect()
    return [
      (clientX - rect.left - this.originX) / this.scale / mToPx(1),
      -(clientY - rect.top - this.originY) / this.scale / mToPx(1),
    ]
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

  /**
   * Camera.
   *
   * Scale comes from the problem's own dimensions and then stays put. Refitting
   * to live body positions made the scale jitter on every frame and zoom out
   * without limit when something rolled away. If the focus body leaves the box,
   * the view PANS to keep it — it never rescales.
   */
  private frame(world: SimWorld, state: SimState): void {
    const v = world.view
    const { clientWidth: cw, clientHeight: ch } = this.canvas
    // Room for the border and a little air beyond it on the tight axis.
    const pad = mToPx(BORDER_PAD_M + 0.1)

    const w = mToPx(v.maxX_m - v.minX_m) + pad * 2
    const h = mToPx(v.maxY_m - v.minY_m) + pad * 2
    this.scale = Math.min(cw / w, ch / h)

    // Centre of the framing box, in Matter pixels (y down).
    let cx = mToPx((v.minX_m + v.maxX_m) / 2)
    let cy = -mToPx((v.minY_m + v.maxY_m) / 2)

    // Pan, but never rescale, to keep the subject on screen.
    const focus = world.bodyById(state.focus.id)
    if (focus) {
      const margin = Math.min(cw, ch) * 0.12
      const halfW = (cw / 2 - margin) / this.scale
      const halfH = (ch / 2 - margin) / this.scale
      cx = Math.max(cx, focus.position.x - halfW)
      cx = Math.min(cx, focus.position.x + halfW)
      cy = Math.max(cy, focus.position.y - halfH)
      cy = Math.min(cy, focus.position.y + halfH)
    }

    this.originX = cw / 2 - cx * this.scale
    this.originY = ch / 2 - cy * this.scale
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


  /**
   * Type-specific annotations for the hard-to-picture problems.
   *
   * This is the payload for those five. Each one exists because a vector points
   * somewhere nothing is moving, and a static diagram cannot show that. Drawing
   * the velocity alone would miss the entire lesson.
   */
  private drawConceptOverlay(world: SimWorld, state: SimState): void {
    const { ctx } = this
    const p = world.params

    const focus = world.bodyById(state.focus.id)
    if (!focus) return
    const fx = this.sx(focus.position.x)
    const fy = this.sy(focus.position.y)

    switch (p.kind) {
      case 'circular_motion': {
        const pivot = world.bodyById('pivot')
        if (!pivot) break
        const cx = this.sx(pivot.position.x)
        const cy = this.sy(pivot.position.y)

        // Acceleration points at the centre — where nothing is moving and no
        // object sits. That is the whole misconception this sim targets.
        const ac = (p.speed_ms * p.speed_ms) / p.radius_m
        const dx = cx - fx
        const dy = cy - fy
        const len = Math.hypot(dx, dy) || 1
        const draw = Math.min(len * 0.8, ac * 6)
        this.drawArrow(fx, fy, (dx / len) * draw, (dy / len) * draw, COLORS.accel, `a = ${ac.toFixed(2)} m/s²`)

        ctx.setLineDash([4, 4])
        ctx.strokeStyle = COLORS.dim
        ctx.beginPath()
        ctx.arc(cx, cy, len, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])

        ctx.fillStyle = COLORS.dim
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillText('nothing is moving here', cx + 8, cy - 8)
        break
      }

      case 'charged_particle_magnetic': {
        // F = qv x B, perpendicular to BOTH the velocity and the field.
        const [vx, vy] = state.focus.velocity_ms
        const qB = p.charge_c * p.b_field_tesla
        const Fx = qB * vy
        const Fy = -qB * vx
        this.drawArrow(fx, fy, Fx * 14, -Fy * 14, COLORS.accel, `F = qv×B = ${Math.hypot(Fx, Fy).toFixed(2)} N`)

        // The field itself fills the plane, so show it as a lattice of the
        // conventional out-of-page dots (or into-page crosses).
        ctx.strokeStyle = COLORS.concept
        ctx.fillStyle = COLORS.concept
        ctx.globalAlpha = 0.35
        const gap = 70
        for (let gx = gap / 2; gx < this.canvas.clientWidth; gx += gap) {
          for (let gy = gap / 2; gy < this.canvas.clientHeight; gy += gap) {
            ctx.beginPath()
            if (p.b_field_tesla >= 0) {
              ctx.arc(gx, gy, 2, 0, Math.PI * 2)
              ctx.fill()
            } else {
              ctx.moveTo(gx - 3, gy - 3)
              ctx.lineTo(gx + 3, gy + 3)
              ctx.moveTo(gx + 3, gy - 3)
              ctx.lineTo(gx - 3, gy + 3)
              ctx.stroke()
            }
          }
        }
        ctx.globalAlpha = 1
        ctx.fillStyle = COLORS.concept
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillText(
          `B = ${p.b_field_tesla.toFixed(2)} T ${p.b_field_tesla >= 0 ? 'out of page' : 'into page'}`,
          12,
          this.canvas.clientHeight - 14,
        )
        break
      }

      case 'rotating_frame': {
        const [vx, vy] = state.focus.velocity_ms
        const [x, y] = state.focus.position_m
        const w = p.omega_rads

        // Coriolis depends on velocity; centrifugal depends on position. Showing
        // both at once is the only way the difference lands.
        const corx = 2 * w * vy
        const cory = -2 * w * vx
        this.drawArrow(fx, fy, corx * 18, -cory * 18, COLORS.accel, 'Coriolis (∝ v)')

        const cfx = w * w * x
        const cfy = w * w * y
        this.drawArrow(fx, fy, cfx * 18, -cfy * 18, COLORS.concept, 'centrifugal (∝ r)')
        break
      }

      case 'angular_momentum_point': {
        const origin = world.bodyById('pivot')
        if (!origin) break
        const ox = this.sx(origin.position.x)
        const oy = this.sy(origin.position.y)

        // The r vector, and the area it sweeps. Equal areas in equal times, with
        // no orbit and no force anywhere — Kepler's second law stripped bare.
        ctx.strokeStyle = COLORS.concept
        ctx.setLineDash([5, 5])
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.lineTo(fx, fy)
        ctx.stroke()
        ctx.setLineDash([])

        if (this.trail.length > 1) {
          ctx.fillStyle = COLORS.sweep
          ctx.globalAlpha = 0.18
          ctx.beginPath()
          ctx.moveTo(ox, oy)
          for (const pt of this.trail) ctx.lineTo(this.sx(pt.x), this.sy(pt.y))
          ctx.closePath()
          ctx.fill()
          ctx.globalAlpha = 1
        }

        const L = state.focus.mass_kg *
          (state.focus.position_m[0] * state.focus.velocity_ms[1] -
            state.focus.position_m[1] * state.focus.velocity_ms[0])
        ctx.fillStyle = COLORS.concept
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillText(`L = r × p = ${L.toFixed(3)} kg·m²/s  (constant)`, ox + 10, oy + 16)
        ctx.fillText('straight line, no rotation, L ≠ 0', ox + 10, oy + 32)
        break
      }

      case 'rolling_without_slipping': {
        const r = focus.circleRadius ?? 0
        const v = state.focus.velocity_ms[0]

        // Bottom: stationary. Top: 2v. Same rigid body, same instant.
        const bx = fx
        const by = this.sy(focus.position.y + r)
        ctx.fillStyle = COLORS.accel
        ctx.beginPath()
        ctx.arc(bx, by, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillText('contact point: v = 0', bx + 10, by + 4)

        const tx = fx
        const ty = this.sy(focus.position.y - r)
        this.drawArrow(tx, ty, v * 2 * 22, 0, COLORS.concept, `top: ${(2 * v).toFixed(2)} m/s = 2v`)
        break
      }

      case 'pendulum': {
        // The rod is integrated, not a Matter constraint, so the generic
        // constraint pass has nothing to draw. Draw it here.
        const pivot = world.bodyById('pivot')
        if (!pivot) break
        ctx.strokeStyle = COLORS.dim
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(this.sx(pivot.position.x), this.sy(pivot.position.y))
        ctx.lineTo(fx, fy)
        ctx.stroke()
        break
      }

      default:
        break
    }
  }

  /**
   * The border: the inner face of the walls that keep everything in the scene.
   * Everything outside it is dimmed so the playable area reads at a glance,
   * and the line itself is where a thrown body will come back from.
   */
  private borderRect(world: SimWorld): [number, number, number, number] {
    const b = world.bounds
    const x0 = this.sx(mToPx(b.minX_m))
    const x1 = this.sx(mToPx(b.maxX_m))
    const y0 = this.sy(-mToPx(b.maxY_m))
    const y1 = this.sy(-mToPx(b.minY_m))
    return [x0, y0, x1, y1]
  }

  private clipToBorder(world: SimWorld): void {
    const [x0, y0, x1, y1] = this.borderRect(world)
    this.ctx.beginPath()
    this.ctx.rect(x0, y0, x1 - x0, y1 - y0)
    this.ctx.clip()
  }

  private drawBorder(world: SimWorld): void {
    const { ctx } = this
    const [x0, y0, x1, y1] = this.borderRect(world)
    const cw = this.canvas.clientWidth
    const ch = this.canvas.clientHeight

    ctx.fillStyle = COLORS.outside
    ctx.beginPath()
    ctx.rect(0, 0, cw, ch)
    ctx.rect(x0, y0, x1 - x0, y1 - y0)
    ctx.fill('evenodd')

    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 2.5
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
  }

  /** Body under a screen point, for click-to-select. */
  pick(world: SimWorld, clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect()
    const x = (clientX - rect.left - this.originX) / this.scale
    const y = (clientY - rect.top - this.originY) / this.scale

    let best: string | null = null
    let bestDist = Infinity
    for (const id of world.bodyIds) {
      const body = world.bodyById(id)
      if (!body || body.label === 'ground' || isWallId(id)) continue
      const b = body.bounds
      if (x < b.min.x || x > b.max.x || y < b.min.y || y > b.max.y) continue
      const d = Math.hypot(body.position.x - x, body.position.y - y)
      // Prefer movable bodies, so a ball resting on a ramp wins the click.
      const score = body.isStatic ? d + 1e6 : d
      if (score < bestDist) {
        bestDist = score
        best = id
      }
    }
    return best
  }

  /** Trajectory of a body, brightest at the present. */
  private drawPath(points: { x: number; y: number }[], color: string, width: number): void {
    if (points.length < 2) return
    const { ctx } = this
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    // Fade the tail so the direction of travel reads without an arrowhead.
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

  /**
   * Free-body diagram on the selected body.
   *
   * Arrow lengths are normalised so the largest force fills a fixed screen
   * length, with the magnitude printed beside each. Scaling newtons to pixels
   * directly would make a 0.2 N spring force invisible next to a 200 N normal
   * force, which is the case where the diagram matters most.
   */
  private drawForces(body: Matter.Body, forces: ForceVector[]): void {
    if (forces.length === 0) return
    const { ctx } = this
    const ox = this.sx(body.position.x)
    const oy = this.sy(body.position.y)

    const peak = Math.max(...forces.map((f) => f.magnitude_n), 1e-9)
    const maxLen = 78

    for (const f of forces) {
      if (f.magnitude_n < 1e-6) continue
      const len = (f.magnitude_n / peak) * maxLen
      const ux = f.vec_n[0] / f.magnitude_n
      const uy = -f.vec_n[1] / f.magnitude_n // to screen space
      const tipX = ox + ux * len
      const tipY = oy + uy * len
      const color = FORCE_COLORS[f.kind]
      const dashed = f.kind === 'net'

      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = dashed ? 2 : 2.5
      if (dashed) ctx.setLineDash([5, 3])
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

      // Label beyond the head, nudged along the arrow's own normal so
      // neighbouring arrows do not stack their text on top of each other.
      ctx.font = '600 10px ui-monospace, monospace'
      ctx.textAlign = ux < -0.25 ? 'right' : 'left'
      const lx = tipX + ux * 10 - uy * 5
      const ly = tipY + uy * 10 + ux * 5 + 3
      ctx.fillText(`${f.label} ${f.magnitude_n.toFixed(1)} N`, lx, ly)
      ctx.textAlign = 'left'
    }
  }

  draw(world: SimWorld, state: SimState, coupling: CouplingState, opts: DrawOptions): void {
    this.resize()
    this.frame(world, state)

    const focusBody = world.bodyById(state.focus.id)
    if (focusBody) {
      this.trail.push({ x: focusBody.position.x, y: focusBody.position.y })
      if (this.trail.length > 240) this.trail.shift()
    }
    if (state.steps === 0) this.trail.length = 0

    const { ctx } = this
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight)
    this.drawGrid()

    this.drawBorder(world)

    // Bodies are clipped to the border: the floor is built far wider than any
    // scene so nothing can roll off it, and the part beyond the walls would
    // otherwise read as more world to explore.
    ctx.save()
    this.clipToBorder(world)
    const grabbedBody = coupling.grabbedId ? world.bodyById(coupling.grabbedId) : undefined
    for (const body of Matter.Composite.allBodies(world.engine.world)) {
      // The walls are drawn as the border line, not as slabs.
      if (isWallId(body.label)) continue
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
    ctx.restore()

    // Paths go over the bodies, not under them: a block sliding down a ramp
    // travels along the ramp's own surface, so a path drawn underneath is
    // completely hidden by the ramp.
    for (const [id, pts] of Object.entries(opts.paths)) {
      const isSel = id === opts.selectedId
      this.drawPath(pts, isSel ? COLORS.path : COLORS.pathDim, isSel ? 2 : 1.5)
    }

    if (opts.selectedId) {
      const sel = world.bodyById(opts.selectedId)
      if (sel) {
        const r = sel.circleRadius && sel.circleRadius > 0
          ? sel.circleRadius * this.scale + 6
          : Math.max(sel.bounds.max.x - sel.bounds.min.x, sel.bounds.max.y - sel.bounds.min.y) * this.scale * 0.72 + 6
        ctx.strokeStyle = COLORS.selected
        ctx.lineWidth = 2
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.arc(this.sx(sel.position.x), this.sy(sel.position.y), r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }
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

    this.drawConceptOverlay(world, state)

    if (opts.showForces && opts.selectedId) {
      const body = world.bodyById(opts.selectedId)
      if (body) this.drawForces(body, opts.forces)
    }

    drawHandOverlay(ctx, opts.hand, (point) => [
      this.sx(mToPx(point.x)),
      this.sy(-mToPx(point.y)),
    ], opts.fisted)

    // The force label on a push. The hitbox itself is the one ring the hand
    // overlay draws (fist reach or grab reach, scaled with the hand); a second
    // fixed-size "contact glow" here used to sit inside it and read as a
    // second, contradicting hitbox.
    if (coupling.force && coupling.contactPoint_m) {
      const [hx, hy] = coupling.contactPoint_m
      const [fxN, fyN] = coupling.force.force_n
      this.drawArrow(
        this.sx(mToPx(hx)), this.sy(-mToPx(hy)),
        fxN * 1.6, -fyN * 1.6, COLORS.accel, `F = ${Math.hypot(fxN, fyN).toFixed(1)} N`,
      )
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
