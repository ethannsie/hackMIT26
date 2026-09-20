import type { HandFrame } from '../../hand/types.ts'

const FINGERS = [[0, 1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
const PALM = [0, 1, 5, 9, 13, 17]

/** Draw in the exact same game coordinates as cutting, including closed fists.
 * Visibility is deliberately independent of whether a pose is allowed to cut.
 */
export function drawTrackedHand(ctx: CanvasRenderingContext2D, frame: HandFrame): void {
  const points = frame.landmarks_m
  if (!points || points.length < 21) return
  const wrist = points[0]!, index = points[5]!, pinky = points[17]!
  const palmWidth = Math.hypot(index.x - pinky.x, index.y - pinky.y)
  const thickness = Math.max(10, Math.min(30, palmWidth * 0.21))
  ctx.save()
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  // Broad translucent fingers plus a filled palm make a hand-shaped avatar,
  // while the fine joint lines stay legible over rope, candy and the background.
  ctx.fillStyle = '#358caa55'; ctx.strokeStyle = '#358caa77'
  ctx.lineWidth = thickness
  ctx.beginPath()
  for (const i of PALM) ctx.lineTo(points[i]!.x, points[i]!.y)
  ctx.closePath(); ctx.fill(); ctx.stroke()
  for (const chain of FINGERS) {
    ctx.beginPath()
    chain.forEach((i, j) => {
      const p = points[i]!
      if (j === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y)
    })
    ctx.stroke()
  }
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#f5ffffd9'
  for (const chain of FINGERS) {
    ctx.beginPath()
    chain.forEach((i, j) => {
      const p = points[i]!
      if (j === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y)
    })
    ctx.stroke()
  }
  ctx.beginPath(); ctx.moveTo(wrist.x, wrist.y); ctx.lineTo(index.x, index.y)
  ctx.lineTo(pinky.x, pinky.y); ctx.closePath(); ctx.stroke()
  for (const point of points) {
    ctx.fillStyle = '#eefeff'; ctx.beginPath(); ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2); ctx.fill()
  }
  const tip = points[8]!
  const armed = (frame.fist ?? 0) <= 0.65 && frame.confidence >= 0.5
  ctx.strokeStyle = armed ? '#167756' : '#bd7c38'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(tip.x, tip.y, 19, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = '#fffbedeb'; ctx.beginPath(); ctx.roundRect(wrist.x - 68, wrist.y + 20, 136, 29, 14); ctx.fill()
  ctx.fillStyle = armed ? '#286147' : '#935f2e'; ctx.textAlign = 'center'; ctx.font = '700 12px system-ui'
  ctx.fillText(armed ? 'SWIPE TO CUT' : 'OPEN YOUR HAND', wrist.x, wrist.y + 39)
  ctx.restore()
}
