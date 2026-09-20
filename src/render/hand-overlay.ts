import type { HandFrame, Vec3 } from '../hand/types.ts'

const CONNECTIONS: readonly [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
]

const FINGERS: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
]

export function drawHandOverlay(
  ctx: CanvasRenderingContext2D,
  hand: HandFrame | null,
  map: (point: Vec3) => [number, number],
): void {
  if (!hand) return
  const palm = map(hand.palm_m)
  const points = hand.landmarks_m?.map(map) ?? []

  ctx.save()
  const skin = '#e7ae8c'
  const skinHighlight = '#f3c7a6'
  const outline = '#9b5d51'
  ctx.strokeStyle = outline
  ctx.fillStyle = skin
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (points.length >= 21) {
    // Draw the recognizable hand first; the landmark network remains visible
    // as a restrained outline on top of the filled avatar.
    ctx.beginPath()
    const palmHull = [points[0]!, points[1]!, points[5]!, points[9]!, points[13]!, points[17]!]
    ctx.moveTo(palmHull[0]![0], palmHull[0]![1])
    for (const [x, y] of palmHull.slice(1)) ctx.lineTo(x, y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    for (const finger of FINGERS) {
      ctx.strokeStyle = skin
      ctx.lineWidth = finger[0] === 1 ? 16 : 20
      ctx.beginPath()
      ctx.moveTo(points[finger[0]!]![0], points[finger[0]!]![1])
      for (const index of finger.slice(1)) ctx.lineTo(points[index]![0], points[index]![1])
      ctx.stroke()
      ctx.strokeStyle = outline
      ctx.lineWidth = 2.5
      ctx.stroke()
    }

    ctx.fillStyle = skinHighlight
    ctx.strokeStyle = outline
    for (const index of [4, 8, 12, 16, 20]) {
      ctx.beginPath()
      ctx.arc(points[index]![0], points[index]![1], 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    ctx.strokeStyle = '#ff9ecb'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (const [from, to] of CONNECTIONS) {
      ctx.moveTo(points[from]![0], points[from]![1])
      ctx.lineTo(points[to]![0], points[to]![1])
    }
    ctx.stroke()
    ctx.beginPath()
    for (const [x, y] of points) {
      ctx.moveTo(x + 3, y)
      ctx.arc(x, y, 3, 0, Math.PI * 2)
    }
    ctx.fillStyle = 'rgba(255, 158, 203, 0.22)'
    ctx.fill()

    // Thumb and index rings make the grab gesture readable even when the
    // fingertip landmark is over a moving body.
    const thumb = points[4]!
    const index = points[8]!
    const grabbing = hand.pinch >= 0.7
    ctx.strokeStyle = grabbing ? '#00e5ff' : '#ffe066'
    ctx.fillStyle = grabbing ? 'rgba(0, 229, 255, 0.28)' : 'rgba(255, 224, 102, 0.2)'
    ctx.lineWidth = 3
    for (const [x, y] of [thumb, index]) {
      ctx.beginPath()
      ctx.arc(x, y, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    if (grabbing) {
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(thumb[0], thumb[1])
      ctx.lineTo(index[0], index[1])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  ctx.fillStyle = '#ff9ecb'
  ctx.font = '600 11px ui-monospace, monospace'
  ctx.fillText(hand.pinch >= 0.7 ? 'PINCH' : 'HAND', palm[0] + 21, palm[1] - 10)
  ctx.restore()
}