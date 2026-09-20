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
}

interface WireVec {
  x: number
  y: number
  z: number
}

interface WireFrame {
  t_ms: number
  handedness: string
  confidence: number
  palm_m: WireVec
  palm_velocity_ms: WireVec
  pinch: number
  landmarks_m?: WireVec[]
}

const vec = (v: WireVec): Vec3 => ({ x: v.x, y: v.y, z: v.z })

export class RemoteHandSource implements HandSource {
  private stream: EventSource | null = null
  private frame: HandFrame | null = null
  /** Panel clock vs. this page's clock: the offset lets us age frames locally. */
  private receivedAt = 0
  private connected = false

  constructor(private readonly opts: RemoteHandOptions) {}

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
      this.frame = {
        // The panel's t_ms comes from its own monotonic clock. Restamp with
        // ours so velocity consumers compare like with like.
        t_ms: performance.now(),
        handedness: w.handedness === 'left' ? 'left' : 'right',
        confidence: w.confidence,
        palm_m: vec(w.palm_m),
        palm_velocity_ms: vec(w.palm_velocity_ms),
        pinch: w.pinch,
        landmarks_m: w.landmarks_m?.map(vec),
      }
      this.receivedAt = performance.now()
      this.connected = true
    })
  }

  stop(): void {
    this.stream?.close()
    this.stream = null
    this.frame = null
    this.connected = false
  }

  current(): HandFrame | null {
    if (!this.frame) return null
    if (performance.now() - this.receivedAt > STALE_MS) return null
    return this.frame
  }
}
