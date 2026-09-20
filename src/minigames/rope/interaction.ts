import type { HandFrame } from '../../hand/types.ts'
import type { Point } from './levels.ts'
import { indexExtended } from './input.ts'

/** Camera observations produce a blade sweep, never a force on the candy. */
export class RopeBlade {
  point: Point | null = null
  private last: { tip: Point; time: number; side: string; armed: boolean } | null = null

  reset(): void { this.point = null; this.last = null }

  sample(frame: HandFrame | null): [Point, Point] | null {
    if (!frame || frame.confidence < 0.5) { this.reset(); return null }
    const tip = frame.landmarks_m?.[8] ?? frame.palm_m
    if (![tip.x, tip.y].every(Number.isFinite)) { this.reset(); return null }
    this.point = { x: tip.x, y: tip.y }
    if (frame.t_ms === this.last?.time) return null
    const last = this.last, armed = indexExtended(frame)
    this.last = { tip: this.point, time: frame.t_ms, side: frame.handedness, armed }
    if (!last || !armed || !last.armed || frame.t_ms - last.time > 180 || frame.t_ms <= last.time
      || last.side !== frame.handedness || Math.hypot(tip.x - last.tip.x, tip.y - last.tip.y) > 380) return null
    return [last.tip, this.point]
  }
}
