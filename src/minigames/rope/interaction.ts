import type { HandFrame } from '../../hand/types.ts'
import type { Point } from './levels.ts'
import { isPinching, pinchCenter } from './input.ts'
import type { RopeWorld } from './physics.ts'

/** Camera-frame-driven pinch interaction, independent of render cadence. */
export class CandyInteraction {
  point: Point | null = null
  pinching = false
  private last: { point: Point; tip: Point; time: number; side: string; pinched: boolean } | null = null

  reset(world: RopeWorld): void {
    world.release(); this.point = null; this.pinching = false; this.last = null
  }

  sample(frame: HandFrame | null, world: RopeWorld): [Point, Point] | null {
    if (!frame || frame.confidence < 0.5) { this.reset(world); return null }
    const point = pinchCenter(frame)
    const tip = frame.landmarks_m?.[8] ?? frame.palm_m
    if (![point.x, point.y, tip.x, tip.y].every(Number.isFinite)) { this.reset(world); return null }
    this.point = point
    if (frame.t_ms === this.last?.time) return null
    const last = this.last
    this.pinching = isPinching(frame, this.pinching)
    this.last = { point, tip: { x: tip.x, y: tip.y }, time: frame.t_ms, side: frame.handedness, pinched: this.pinching }
    if (last && (frame.t_ms - last.time > 180 || frame.t_ms <= last.time || last.side !== frame.handedness
      || Math.hypot(point.x - last.point.x, point.y - last.point.y) > 380)) {
      world.release()
      return null
    }
    if (world.held) {
      // Open first, without moving the target to the newly spread fingers.
      // The throw inherits the moving candy's momentum, not finger-opening jitter.
      if (!this.pinching) world.release()
      else world.moveTarget(point)
      return null
    }
    if (this.pinching) { world.grab(point); return null }
    // Only an uninterrupted open-hand sweep cuts: closing/opening a pinch
    // must not sever a rope just because the index tip changes position.
    return last && !last.pinched ? [last.tip, { x: tip.x, y: tip.y }] : null
  }
}
