import type { HandFrame } from '../../hand/types.ts'
import type { Point } from './levels.ts'

/** Treat a reappearing hand as a new stroke, never a slash across the screen. */
export class HandBlade {
  private last: { point: Point; time: number } | null = null
  point: Point | null = null

  reset(): void { this.last = null; this.point = null }

  sample(frame: HandFrame | null): [Point, Point] | null {
    if (!frame || frame.confidence < 0.5 || (frame.fist ?? 0) > 0.65) {
      this.reset()
      return null
    }
    const p = frame.landmarks_m?.[8] ?? frame.palm_m
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { this.reset(); return null }
    const point = { x: p.x, y: p.y }
    this.point = point
    const last = this.last
    // Repeated render frames are not new observations.
    if (last && frame.t_ms === last.time) return null
    this.last = { point, time: frame.t_ms }
    if (!last) return null
    const dt = frame.t_ms - last.time
    const travel = Math.hypot(point.x - last.point.x, point.y - last.point.y)
    if (dt <= 0 || dt > 180 || travel > 380 || travel < 4) return null
    return [last.point, point]
  }
}
