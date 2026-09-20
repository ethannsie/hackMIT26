import type { HandFrame } from '../../hand/types.ts'
import type { Point } from './levels.ts'

/** Read the pinch directly so curled spare fingers never suppress it through
 * the shared tracker's whole-hand fist score. Palm-relative thresholds give
 * the same gesture at different camera distances, with release hysteresis. */
export function isPinching(frame: HandFrame, holding = false): boolean {
  const p = frame.landmarks_m
  if (!p || p.length < 21) return frame.pinch >= (holding ? 0.45 : 0.7)
  const width = Math.hypot(p[5]!.x - p[17]!.x, p[5]!.y - p[17]!.y)
  if (width < 5) return false
  const gap = Math.hypot(p[4]!.x - p[8]!.x, p[4]!.y - p[8]!.y) / width
  return gap < (holding ? 0.60 : 0.35)
}

export function pinchCenter(frame: HandFrame): Point {
  const p = frame.landmarks_m
  return p && p.length >= 21
    ? { x: (p[4]!.x + p[8]!.x) / 2, y: (p[4]!.y + p[8]!.y) / 2 }
    : { x: frame.palm_m.x, y: frame.palm_m.y }
}
