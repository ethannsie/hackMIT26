import type { HandFrame } from '../../hand/types.ts'

/** Pointing or an open hand cuts; a curled index is safe to reposition. */
export function indexExtended(frame: HandFrame): boolean {
  const points = frame.landmarks_m
  if (!points || points.length < 21) return (frame.fist ?? 0) < 0.65
  const base = points[5]!, joint = points[6]!, tip = points[8]!
  const ax = base.x - joint.x, ay = base.y - joint.y
  const bx = tip.x - joint.x, by = tip.y - joint.y
  const length = Math.hypot(ax, ay) * Math.hypot(bx, by)
  return length > 1 && (ax * bx + ay * by) / length < -0.45
}
