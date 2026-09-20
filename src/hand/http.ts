import { request } from '../net/request.ts'
import type { HandFrame, HandSource } from './types.ts'

interface RemoteHandFrame {
  t_ms: number
  handedness: 'left' | 'right'
  confidence: number
  palm: { x: number; y: number; z: number }
  palm_velocity: { x: number; y: number; z: number }
  pinch: number
  fist?: number
  landmarks?: { x: number; y: number; z: number }[]
}

/** How long to leave the API alone after a failed poll. */
const BACKOFF_MS = 1000

/** Receives the Python webcam tracker's latest frame through the local API. */
export class HttpHandSource implements HandSource {
  private controller: AbortController | null = null
  private lastSourceStamp: number | null = null
  private frame: HandFrame | null = null
  private target: HandFrame | null = null
  private timer: number | null = null
  private requestInFlight = false
  private lastReceived = 0
  private lastCurrent = performance.now()
  /** Do not poll again before this; set after a failed request. */
  private retryAt = 0

  constructor(
    private readonly element: HTMLElement,
    private readonly toScene: (clientX: number, clientY: number) => [number, number],
    /**
     * When this says a better source is live, the bridge is not polled at all.
     * The bridge is a laptop-era fallback; on the demo box the panel camera
     * is the tracker, and 60 requests a second to an API that has nothing to
     * say is pure noise in the network log.
     */
    private readonly yieldTo: () => boolean = () => false,
  ) {}

  async start(): Promise<void> {
    if (this.controller) return
    this.controller = new AbortController()
    this.timer = window.setInterval(() => void this.poll(), 16)
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.controller?.abort()
    this.controller = null
    this.frame = null
    this.target = null
  }

  current(): HandFrame | null {
    if (performance.now() - this.lastReceived > 350) return null
    if (!this.target) return this.frame
    const now = performance.now()
    // Keep only a small smoothing window: a long window feels like the hand is
    // trailing behind the camera even when the tracker is producing frames.
    const alpha = 1 - Math.exp(-(now - this.lastCurrent) / 10)
    this.lastCurrent = now
    this.frame = this.frame ? this.blend(this.frame, this.target, alpha) : this.target
    return this.frame
  }

  private blend(previous: HandFrame, next: HandFrame, alpha: number): HandFrame {
    const mix = (a: number, b: number): number => a + (b - a) * alpha
    const mixVec = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({
      x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z),
    })
    return {
      ...next,
      palm_m: mixVec(previous.palm_m, next.palm_m),
      palm_velocity_ms: mixVec(previous.palm_velocity_ms, next.palm_velocity_ms),
      landmarks_m: next.landmarks_m && previous.landmarks_m
        ? next.landmarks_m.map((point, i) => mixVec(previous.landmarks_m![i] ?? point, point))
        : next.landmarks_m,
    }
  }

  private async poll(): Promise<void> {
    if (this.requestInFlight || this.yieldTo() || performance.now() < this.retryAt) return
    this.requestInFlight = true
    try {
      const response = await request('/api/hand/frame', { cache: 'no-store', signal: this.controller?.signal }, 1000)
      if (!response.ok) {
        this.retryAt = performance.now() + BACKOFF_MS
        return
      }
      const remote = (await response.json()) as RemoteHandFrame | null
      if (!this.controller || this.controller.signal.aborted) return
      if (!remote) { this.frame = null; this.target = null; this.lastSourceStamp = null; return }
      if (remote.t_ms === this.lastSourceStamp) return
      this.lastSourceStamp = remote.t_ms
      const rect = this.element.getBoundingClientRect()
      const [palmX, palmY] = this.toScene(
        rect.left + remote.palm.x * rect.width,
        rect.top + remote.palm.y * rect.height,
      )
      const [nextX, nextY] = this.toScene(
        rect.left + (remote.palm.x + remote.palm_velocity.x * 0.01) * rect.width,
        rect.top + (remote.palm.y + remote.palm_velocity.y * 0.01) * rect.height,
      )
      const landmarks_m = remote.landmarks && remote.landmarks.length > 0
        ? remote.landmarks.map((landmark) => {
        const [x, y] = this.toScene(
          rect.left + landmark.x * rect.width,
          rect.top + landmark.y * rect.height,
        )
        return { x, y, z: landmark.z }
        })
        : this.target?.landmarks_m ?? this.frame?.landmarks_m
      this.target = {
        t_ms: remote.t_ms,
        handedness: remote.handedness,
        confidence: remote.confidence,
        palm_m: {
          x: palmX,
          y: palmY,
          z: remote.palm.z,
        },
        palm_velocity_ms: {
          x: (nextX - palmX) / 0.01,
          y: (nextY - palmY) / 0.01,
          z: remote.palm_velocity.z,
        },
        pinch: remote.pinch,
        fist: remote.fist ?? 0,
        palm_normal: { x: 0, y: 0, z: 1 },
        landmarks_m,
      }
      this.lastReceived = performance.now()
    } catch {
      // The browser can continue with mouse control while the bridge is
      // offline; ask again in a second rather than sixty times a second.
      this.retryAt = performance.now() + BACKOFF_MS
    } finally {
      this.requestInFlight = false
    }
  }
}