/**
 * Motion graphs: position, velocity and acceleration against time.
 *
 * Three separate charts stacked on a shared time axis, never one chart with two
 * y-scales — quantities of different units and magnitudes do not share an axis.
 *
 * Series colours are the validated categorical slots 1-3 for a dark surface
 * (blue / orange / aqua). They clear CVD separation on all pairs, so x and y
 * components stay distinguishable; they are also direct-labelled, so identity is
 * never carried by colour alone.
 */

export interface Sample {
  t_s: number
  x_m: number
  y_m: number
  vx_ms: number
  vy_ms: number
  ax_ms2: number
  ay_ms2: number
}

const SERIES = {
  x: '#3987e5',
  y: '#d95926',
  mag: '#199e70',
} as const

const INK = {
  primary: '#c9d1d9',
  secondary: '#8b949e',
  muted: '#6e7681',
  grid: '#1e232c',
  axis: '#30363d',
  surface: '#12151c',
}

/**
 * Records motion for one body.
 *
 * Acceleration is differenced from velocity rather than read from the solver:
 * during a collision Matter's internal force is a penetration-resolution
 * artefact, not the physical force, and plotting it produces a spike that means
 * nothing. Differencing over a short window gives the acceleration a student
 * would actually measure.
 */
export class MotionRecorder {
  private samples: Sample[] = []
  private lastV: { vx: number; vy: number; t: number } | null = null
  private trackedId: string | null = null

  /** Seconds of history kept. Older samples are dropped. */
  constructor(private windowSeconds = 12) {}

  get data(): readonly Sample[] {
    return this.samples
  }

  get tracked(): string | null {
    return this.trackedId
  }

  clear(id: string | null = this.trackedId): void {
    this.samples = []
    this.lastV = null
    this.trackedId = id
  }

  /** Copy the buffer, for a rollback snapshot. */
  snapshot(): Sample[] {
    return this.samples.map((s) => ({ ...s }))
  }

  /** Put a previously captured buffer back, so the graphs show that run again. */
  restore(samples: readonly Sample[], id: string | null): void {
    this.samples = samples.map((s) => ({ ...s }))
    this.trackedId = id
    const last = this.samples[this.samples.length - 1]
    this.lastV = last ? { vx: last.vx_ms, vy: last.vy_ms, t: last.t_s } : null
  }

  /** Record one point. Switching body resets the history. */
  push(id: string, t_s: number, pos: [number, number], vel: [number, number]): void {
    if (id !== this.trackedId) this.clear(id)

    let ax = 0
    let ay = 0
    if (this.lastV) {
      const dt = t_s - this.lastV.t
      if (dt > 1e-6) {
        ax = (vel[0] - this.lastV.vx) / dt
        ay = (vel[1] - this.lastV.vy) / dt
      } else if (this.samples.length > 0) {
        const prev = this.samples[this.samples.length - 1]!
        ax = prev.ax_ms2
        ay = prev.ay_ms2
      }
    }
    this.lastV = { vx: vel[0], vy: vel[1], t: t_s }

    this.samples.push({
      t_s,
      x_m: pos[0],
      y_m: pos[1],
      vx_ms: vel[0],
      vy_ms: vel[1],
      ax_ms2: ax,
      ay_ms2: ay,
    })

    const cutoff = t_s - this.windowSeconds
    while (this.samples.length > 2 && this.samples[0]!.t_s < cutoff) this.samples.shift()
  }
}

interface SeriesSpec {
  label: string
  color: string
  get: (s: Sample) => number
}

interface ChartSpec {
  title: string
  unit: string
  series: SeriesSpec[]
}

const CHARTS: ChartSpec[] = [
  {
    title: 'Position',
    unit: 'm',
    series: [
      { label: 'x', color: SERIES.x, get: (s) => s.x_m },
      { label: 'y', color: SERIES.y, get: (s) => s.y_m },
    ],
  },
  {
    title: 'Velocity',
    unit: 'm/s',
    series: [
      { label: 'vx', color: SERIES.x, get: (s) => s.vx_ms },
      { label: 'vy', color: SERIES.y, get: (s) => s.vy_ms },
      { label: '|v|', color: SERIES.mag, get: (s) => Math.hypot(s.vx_ms, s.vy_ms) },
    ],
  },
  {
    title: 'Acceleration',
    unit: 'm/s²',
    series: [
      { label: 'ax', color: SERIES.x, get: (s) => s.ax_ms2 },
      { label: 'ay', color: SERIES.y, get: (s) => s.ay_ms2 },
    ],
  },
]

function niceStep(range: number, target = 4): number {
  if (range <= 0 || !Number.isFinite(range)) return 1
  const raw = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1
  return step * mag
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000) return v.toExponential(1)
  if (a >= 100) return v.toFixed(0)
  if (a >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

/**
 * Draws the three charts into one canvas, with a shared crosshair.
 *
 * `hoverT` is a time in seconds, supplied by the caller from pointer position;
 * every chart reads the same instant, so the three panels can be compared.
 */
export class MotionCharts {
  private ctx: CanvasRenderingContext2D
  private layout: { top: number; height: number; left: number; width: number }[] = []
  hoverX: number | null = null

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
  }

  /** Time at a pointer x position, or null when outside the plots. */
  timeAt(clientX: number, data: readonly Sample[]): number | null {
    if (data.length < 2 || this.layout.length === 0) return null
    const rect = this.canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const box = this.layout[0]!
    if (x < box.left || x > box.left + box.width) return null
    const t0 = data[0]!.t_s
    const t1 = data[data.length - 1]!.t_s
    return t0 + ((x - box.left) / box.width) * (t1 - t0)
  }

  draw(data: readonly Sample[], label: string): void {
    const dpr = window.devicePixelRatio || 1
    const { clientWidth: cw, clientHeight: ch } = this.canvas
    if (this.canvas.width !== cw * dpr || this.canvas.height !== ch * dpr) {
      this.canvas.width = cw * dpr
      this.canvas.height = ch * dpr
    }
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = INK.surface
    ctx.fillRect(0, 0, cw, ch)

    if (data.length < 2) {
      ctx.fillStyle = INK.muted
      ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Run the simulation to plot motion', cw / 2, ch / 2)
      ctx.textAlign = 'left'
      this.layout = []
      return
    }

    const padL = 48
    const padR = 26 // room for the direct series labels
    const gap = 14
    const titleH = 16
    const axisH = 14
    const each = (ch - gap * (CHARTS.length - 1)) / CHARTS.length
    const plotH = each - titleH - axisH
    const plotW = cw - padL - padR

    const t0 = data[0]!.t_s
    const t1 = data[data.length - 1]!.t_s
    const tSpan = Math.max(t1 - t0, 1e-6)

    this.layout = []

    CHARTS.forEach((chart, ci) => {
      const top = ci * (each + gap)
      const plotTop = top + titleH
      this.layout.push({ top: plotTop, height: plotH, left: padL, width: plotW })

      // Title names the quantity, so no legend box is needed; the series are
      // direct-labelled at their last point instead.
      ctx.fillStyle = INK.primary
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(chart.title, padL, top + 11)
      ctx.fillStyle = INK.muted
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText(chart.unit, padL + ctx.measureText(chart.title).width + 34, top + 11)

      let lo = Infinity
      let hi = -Infinity
      for (const s of data) {
        for (const ser of chart.series) {
          const v = ser.get(s)
          if (!Number.isFinite(v)) continue
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        lo = -1
        hi = 1
      }
      if (hi - lo < 1e-9) {
        lo -= 1
        hi += 1
      }
      const padY = (hi - lo) * 0.12
      lo -= padY
      hi += padY

      const sy = (v: number): number => plotTop + plotH - ((v - lo) / (hi - lo)) * plotH
      const sx = (t: number): number => padL + ((t - t0) / tSpan) * plotW

      // Recessive gridlines.
      const step = niceStep(hi - lo)
      ctx.strokeStyle = INK.grid
      ctx.lineWidth = 1
      ctx.fillStyle = INK.muted
      ctx.font = '10px ui-monospace, monospace'
      ctx.textAlign = 'right'
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        const y = sy(v)
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(padL + plotW, y)
        ctx.stroke()
        ctx.fillText(fmt(v), padL - 6, y + 3)
      }
      ctx.textAlign = 'left'

      // Zero line, when the range straddles it.
      if (lo < 0 && hi > 0) {
        ctx.strokeStyle = INK.axis
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(padL, sy(0))
        ctx.lineTo(padL + plotW, sy(0))
        ctx.stroke()
      }

      for (const ser of chart.series) {
        ctx.strokeStyle = ser.color
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.beginPath()
        let started = false
        for (const s of data) {
          const v = ser.get(s)
          if (!Number.isFinite(v)) continue
          const px = sx(s.t_s)
          const py = sy(v)
          if (!started) {
            ctx.moveTo(px, py)
            started = true
          } else ctx.lineTo(px, py)
        }
        ctx.stroke()

        // Direct label at the last point: identity is never colour-alone.
        const last = data[data.length - 1]!
        const lv = ser.get(last)
        if (Number.isFinite(lv)) {
          ctx.fillStyle = ser.color
          ctx.font = '600 10px ui-monospace, monospace'
          ctx.fillText(ser.label, padL + plotW + 2, sy(lv) + 3)
        }
      }

      // Time axis on the last chart only.
      if (ci === CHARTS.length - 1) {
        ctx.fillStyle = INK.muted
        ctx.font = '10px ui-monospace, monospace'
        ctx.fillText(`${t0.toFixed(1)} s`, padL, plotTop + plotH + 12)
        ctx.textAlign = 'right'
        ctx.fillText(`${t1.toFixed(1)} s`, padL + plotW, plotTop + plotH + 12)
        ctx.textAlign = 'left'
      }
    })

    // Shared crosshair and readout.
    if (this.hoverX !== null && this.layout.length > 0) {
      const box = this.layout[0]!
      const x = Math.max(box.left, Math.min(box.left + box.width, this.hoverX))
      const tHover = t0 + ((x - box.left) / box.width) * tSpan

      let nearest = data[0]!
      let best = Infinity
      for (const s of data) {
        const d = Math.abs(s.t_s - tHover)
        if (d < best) {
          best = d
          nearest = s
        }
      }

      ctx.strokeStyle = INK.axis
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, ch)
      ctx.stroke()
      ctx.setLineDash([])

      CHARTS.forEach((chart, ci) => {
        const box2 = this.layout[ci]
        if (!box2) return
        let lo = Infinity
        let hi = -Infinity
        for (const s of data) {
          for (const ser of chart.series) {
            const v = ser.get(s)
            if (!Number.isFinite(v)) continue
            lo = Math.min(lo, v)
            hi = Math.max(hi, v)
          }
        }
        if (hi - lo < 1e-9) {
          lo -= 1
          hi += 1
        }
        const padY = (hi - lo) * 0.12
        lo -= padY
        hi += padY
        for (const ser of chart.series) {
          const v = ser.get(nearest)
          if (!Number.isFinite(v)) continue
          const y = box2.top + box2.height - ((v - lo) / (hi - lo)) * box2.height
          ctx.beginPath()
          ctx.arc(x, y, 4, 0, Math.PI * 2)
          ctx.fillStyle = ser.color
          ctx.fill()
          // 2px surface ring keeps overlapping markers separable.
          ctx.strokeStyle = INK.surface
          ctx.lineWidth = 2
          ctx.stroke()
        }
      })

      ctx.fillStyle = INK.secondary
      ctx.font = '10px ui-monospace, monospace'
      const readout =
        `t ${nearest.t_s.toFixed(2)}s  ` +
        `x ${fmt(nearest.x_m)} y ${fmt(nearest.y_m)}  ` +
        `v ${fmt(Math.hypot(nearest.vx_ms, nearest.vy_ms))}`
      ctx.textAlign = x > cw / 2 ? 'right' : 'left'
      ctx.fillText(readout, x + (x > cw / 2 ? -8 : 8), 10)
      ctx.textAlign = 'left'
    }

    ctx.fillStyle = INK.muted
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillText(`tracking: ${label}`, padL, ch - 2)
  }
}
