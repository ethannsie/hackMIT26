/**
 * A HandFrame source driven by the mouse.
 *
 * Exists so the sim and the hand-tracking work can proceed independently: this
 * implements the same HandSource contract MediaPipe will, so swapping the real
 * tracker in later is a one-line change at the call site and nothing downstream
 * moves.
 *
 * Controls:
 *   move          palm position on the sim plane
 *   hold button   push through the plane (palm_z goes negative)
 *   hold shift    pinch, to grab and throw
 *
 * Shift, not space: space is the global play/pause key, and a control that both
 * pauses the sim and grabs a body is a control nobody can use.
 */
import type { HandFrame, HandSource, Vec3 } from './types.ts'

export interface MockOptions {
  /** Element whose coordinate space the mouse is read in. */
  element: HTMLElement
  /** Metres per CSS pixel, so mock frames land in the same scale as real ones. */
  metresPerPixel: number
  /** Scene-space position of the element's centre, in metres. */
  origin_m?: { x: number; y: number }
  /** How far past the plane a held button reaches, in metres. */
  pushDepth_m?: number
}

export class MockHandSource implements HandSource {
  private frame: HandFrame | null = null
  private pushing = false
  private pinching = false
  private last: { x: number; y: number; t: number } | null = null
  private readonly opts: Required<MockOptions>

  constructor(options: MockOptions) {
    this.opts = {
      origin_m: { x: 0, y: 0 },
      pushDepth_m: 0.05,
      ...options,
    }
  }

  private onMove = (e: MouseEvent): void => {
    const rect = this.opts.element.getBoundingClientRect()
    const x =
      (e.clientX - rect.left - rect.width / 2) * this.opts.metresPerPixel + this.opts.origin_m.x
    // Screen y grows downward; the sim frame's y grows upward.
    const y =
      -(e.clientY - rect.top - rect.height / 2) * this.opts.metresPerPixel + this.opts.origin_m.y
    const t = performance.now()

    // Finite-difference velocity. Real MediaPipe frames get this the same way,
    // so throw behaviour here matches what the tracker will produce.
    let velocity: Vec3 = { x: 0, y: 0, z: 0 }
    if (this.last) {
      const dt = (t - this.last.t) / 1000
      if (dt > 0.001) {
        velocity = { x: (x - this.last.x) / dt, y: (y - this.last.y) / dt, z: 0 }
      } else if (this.frame) {
        velocity = this.frame.palm_velocity_ms
      }
    }
    this.last = { x, y, t }

    this.frame = {
      t_ms: t,
      handedness: 'right',
      confidence: 1,
      palm_m: { x, y, z: this.pushing ? -this.opts.pushDepth_m : 0.05 },
      palm_velocity_ms: velocity,
      pinch: this.pinching ? 1 : 0,
      palm_normal: { x: 0, y: 0, z: 1 },
    }
  }

  private onDown = (): void => {
    this.pushing = true
  }
  private onUp = (): void => {
    this.pushing = false
  }
  private onLeave = (): void => {
    this.frame = null
    this.last = null
  }
  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Shift') return
    this.pinching = e.type === 'keydown'
    if (this.frame) this.frame.pinch = this.pinching ? 1 : 0
  }

  async start(): Promise<void> {
    const el = this.opts.element
    el.addEventListener('mousemove', this.onMove)
    el.addEventListener('mousedown', this.onDown)
    el.addEventListener('mouseleave', this.onLeave)
    window.addEventListener('mouseup', this.onUp)
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
  }

  stop(): void {
    const el = this.opts.element
    el.removeEventListener('mousemove', this.onMove)
    el.removeEventListener('mousedown', this.onDown)
    el.removeEventListener('mouseleave', this.onLeave)
    window.removeEventListener('mouseup', this.onUp)
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
    this.frame = null
  }

  current(): HandFrame | null {
    return this.frame
  }
}
