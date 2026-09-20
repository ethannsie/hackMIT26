/**
 * A HandSource fed by the panel service's camera.
 *
 * The panel owns the webcam (only one process can), runs MediaPipe, and
 * converts landmarks into this app's sim frame before publishing them. So the
 * whole tracker arrives here as a stream of ready-made HandFrames and this
 * file is only plumbing — which is the point of the HandSource contract in
 * ./types.ts.
 *
 * It is deliberately optional. If the panel is not running, start() resolves
 * anyway and current() returns null, so the caller keeps whatever fallback it
 * had. Nothing in the main app depends on the panel being up.
 */
import type { HandFrame, HandSource, Vec3 } from './types.ts'

/** Drop a frame this old rather than let a dead stream freeze a hand on screen. */
const STALE_MS = 300

export interface RemoteHandOptions {
  /** Panel service origin. */
  base: string
  /**
   * The canvas the sim draws on, and its screen→scene conversion. With these
   * the full camera frame maps onto the full canvas — whatever the view is
   * zoomed to — so a hand crossing the camera crosses the whole sim, no more
   * and no less. Without them, frames fall back to the panel's fixed metre
   * frame, which only matches a sim that happens to be ~1.6 m wide.
   */
  element?: HTMLElement
  toScene?: (clientX: number, clientY: number) => [number, number]
  /**
   * Fraction of the camera frame that spans the canvas, 0..1. 1 = edge to
   * edge. 0.8 lets the hand reach the sim's edges while still comfortably
   * inside the camera's view. `?handspan=0.8` overrides at runtime.
   */
  span?: number
}

interface WireVec {
  x: number
  y: number
  z: number
}

interface WireVec2 {
  x: number
  y: number
}

interface WireFrame {
  t_ms: number
  handedness: string
  confidence: number
  palm_m: WireVec
  palm_velocity_ms: WireVec
  pinch: number
  landmarks_m?: WireVec[]
  /** Fractions of the camera frame, image y down. Newer panels only. */
  palm_n?: WireVec2
  landmarks_n?: WireVec2[]
}

const vec = (v: WireVec): Vec3 => ({ x: v.x, y: v.y, z: v.z })

export class RemoteHandSource implements HandSource {
  private stream: EventSource | null = null
  private frame: HandFrame | null = null
  /** Panel clock vs. this page's clock: the offset lets us age frames locally. */
  private receivedAt = 0
  private connected = false
  /** Previous canvas-mapped palm, for velocity in the view's own metres. */
  private lastPalm: { x: number; y: number; t: number } | null = null
  private readonly span: number

  constructor(private readonly opts: RemoteHandOptions) {
    const fromUrl = Number(new URLSearchParams(window.location.search).get('handspan'))
    const span = fromUrl > 0 && fromUrl <= 1 ? fromUrl : (opts.span ?? 1)
    this.span = Math.min(1, Math.max(0.2, span))
  }

  /**
   * Camera fraction → scene metres through the canvas. The span window is
   * centred: with span 0.8, camera x=0.1 is the canvas's left edge.
   */
  private mapPoint(n: WireVec2): [number, number] | null {
    const { element, toScene } = this.opts
    if (!element || !toScene) return null
    const rect = element.getBoundingClientRect()
    const u = (n.x - (1 - this.span) / 2) / this.span
    const v = (n.y - (1 - this.span) / 2) / this.span
    return toScene(rect.left + u * rect.width, rect.top + v * rect.height)
  }

  private fromWire(w: WireFrame, now: number): HandFrame {
    const base: HandFrame = {
      // The panel's t_ms comes from its own monotonic clock. Restamp with
      // ours so velocity consumers compare like with like.
      t_ms: now,
      handedness: w.handedness === 'left' ? 'left' : 'right',
      confidence: w.confidence,
      palm_m: vec(w.palm_m),
      palm_velocity_ms: vec(w.palm_velocity_ms),
      pinch: w.pinch,
      landmarks_m: w.landmarks_m?.map(vec),
    }
    const palm = w.palm_n ? this.mapPoint(w.palm_n) : null
    if (!palm) {
      this.lastPalm = null
      return base
    }
    const [x, y] = palm
    // Velocity in the view's metres, from successive mapped positions; the
    // panel's own velocity is in its fixed frame and would be the wrong scale.
    let vx = 0
    let vy = 0
    if (this.lastPalm) {
      const dt = Math.max((now - this.lastPalm.t) / 1000, 1e-3)
      // A tracker frame can land twice on one timestamp; cap the implied speed.
      vx = Math.max(-20, Math.min(20, (x - this.lastPalm.x) / dt))
      vy = Math.max(-20, Math.min(20, (y - this.lastPalm.y) / dt))
    }
    this.lastPalm = { x, y, t: now }
    const z = w.palm_m.z
    return {
      ...base,
      palm_m: { x, y, z },
      palm_velocity_ms: { x: vx, y: vy, z: w.palm_velocity_ms.z },
      landmarks_m: w.landmarks_n
        ? w.landmarks_n.map((n) => {
            const p = this.mapPoint(n) ?? [x, y]
            return { x: p[0], y: p[1], z }
          })
        : base.landmarks_m,
    }
  }

  get live(): boolean {
    return this.connected
  }

  async start(): Promise<void> {
    if (this.stream) return
    const stream = new EventSource(`${this.opts.base}/api/hand/events`)
    this.stream = stream

    stream.addEventListener('open', () => {
      this.connected = true
    })
    stream.addEventListener('error', () => {
      // EventSource reconnects by itself; clear the pose so the sim does not
      // keep pushing with a hand that is no longer being seen.
      this.connected = false
      this.frame = null
    })
    stream.addEventListener('hand', (e) => {
      const w = JSON.parse((e as MessageEvent).data) as WireFrame
      const now = performance.now()
      this.frame = this.fromWire(w, now)
      this.receivedAt = now
      this.connected = true
    })
  }

  stop(): void {
    this.stream?.close()
    this.stream = null
    this.frame = null
    this.lastPalm = null
    this.connected = false
  }

  current(): HandFrame | null {
    if (!this.frame) return null
    if (performance.now() - this.receivedAt > STALE_MS) return null
    return this.frame
  }
}
