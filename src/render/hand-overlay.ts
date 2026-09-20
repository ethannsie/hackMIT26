import type { HandFrame, Vec3 } from '../hand/types.ts'
import { FIST_CLOSE, PINCH_GRAB } from '../hand/types.ts'
import { fistReachM, PUNCH_MIN_SPEED_M_S } from '../hand/coupling.ts'

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

const SKIN = '#e7ae8c'
const SKIN_HIGHLIGHT = '#f3c7a6'
const SKIN_SHADE = '#c98d6c'
const OUTLINE = '#9b5d51'
const HIT = '#ff7b72'
const HIT_FILL = 'rgba(255, 123, 114, 0.3)'
const HIT_GLOW = 'rgba(255, 123, 114, 0.9)'

/**
 * The hand is see-through. It sits between the visitor and the thing they are
 * trying to grab, so an opaque avatar hides exactly the body they are aiming
 * at. Drawn opaque onto a scratch layer and then composited at this alpha, so
 * overlapping strokes do not stack into darker patches.
 */
const HAND_ALPHA = 0.5

let layer: HTMLCanvasElement | null = null

/** A scratch canvas matching the target's pixel size and transform. */
function scratchFor(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  if (!layer) layer = document.createElement('canvas')
  const target = ctx.canvas
  if (layer.width !== target.width || layer.height !== target.height) {
    layer.width = target.width
    layer.height = target.height
  }
  const lctx = layer.getContext('2d')
  if (!lctx) throw new Error('2D scratch context unavailable')
  lctx.setTransform(1, 0, 0, 1, 0, 0)
  lctx.clearRect(0, 0, layer.width, layer.height)
  lctx.setTransform(ctx.getTransform())
  return lctx
}

/** Composite the scratch layer onto the target at HAND_ALPHA. */
function blend(ctx: CanvasRenderingContext2D): void {
  if (!layer) return
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = HAND_ALPHA
  ctx.drawImage(layer, 0, 0)
  ctx.restore()
}

type Pt = [number, number]

/** Andrew's monotone chain. The fist is drawn as the inflated hull of the hand. */
function convexHull(pts: readonly Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Pt[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop()
    upper.push(q)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

function tracePath(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  ctx.beginPath()
  ctx.moveTo(pts[0]![0], pts[0]![1])
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y)
  ctx.closePath()
}

/**
 * A closed fist: one solid mass, not five sticks. The inflated convex hull of
 * all 21 landmarks gives the silhouette; four knuckle bumps along the top
 * edge and the thumb lying across the front give it its shape.
 */
function drawFist(ctx: CanvasRenderingContext2D, points: readonly Pt[], palmPx: number): void {
  const hull = convexHull(points)
  if (hull.length < 3) return
  const inflate = Math.max(14, palmPx * 0.34)

  // Body: fill, then a fat round-joined stroke to round every corner off.
  ctx.fillStyle = SKIN
  ctx.strokeStyle = SKIN
  ctx.lineWidth = inflate
  ctx.lineJoin = 'round'
  tracePath(ctx, hull)
  ctx.fill()
  ctx.stroke()
  // Outline at the inflated edge.
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = inflate + 5
  ctx.globalCompositeOperation = 'destination-over'
  ctx.stroke()
  ctx.globalCompositeOperation = 'source-over'

  // Knuckles: a bump over each of the four finger MCP joints.
  const r = Math.max(6, palmPx * 0.13)
  for (const i of [5, 9, 13, 17]) {
    const [x, y] = points[i]!
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = SKIN_HIGHLIGHT
    ctx.fill()
    ctx.strokeStyle = SKIN_SHADE
    ctx.lineWidth = 2
    ctx.stroke()
  }
  // Finger creases: short shaded lines from each knuckle toward the palm,
  // so the mass reads as curled fingers rather than a blob.
  ctx.strokeStyle = SKIN_SHADE
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (const [mcp, pip] of [[5, 6], [9, 10], [13, 14], [17, 18]] as const) {
    const a = points[mcp]!
    const b = points[pip]!
    ctx.beginPath()
    ctx.moveTo(a[0] + (b[0] - a[0]) * 0.35, a[1] + (b[1] - a[1]) * 0.35)
    ctx.lineTo(a[0] + (b[0] - a[0]) * 0.95, a[1] + (b[1] - a[1]) * 0.95)
    ctx.stroke()
  }
  // Thumb across the front.
  ctx.strokeStyle = SKIN_HIGHLIGHT
  ctx.lineWidth = Math.max(10, palmPx * 0.24)
  ctx.beginPath()
  ctx.moveTo(points[2]![0], points[2]![1])
  ctx.lineTo(points[3]![0], points[3]![1])
  ctx.lineTo(points[4]![0], points[4]![1])
  ctx.stroke()
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 2
  ctx.stroke()
}

function drawOpenHand(ctx: CanvasRenderingContext2D, points: readonly Pt[], palmPx: number, hand: HandFrame): void {
  ctx.strokeStyle = OUTLINE
  ctx.fillStyle = SKIN
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Palm, then fingers whose width follows the hand's size on screen, so a
  // hand near the camera is not drawn with the same twigs as one far away.
  const palmHull = [points[0]!, points[1]!, points[5]!, points[9]!, points[13]!, points[17]!]
  tracePath(ctx, palmHull)
  ctx.fill()
  ctx.stroke()

  const fingerW = Math.max(12, Math.min(44, palmPx * 0.3))
  for (const finger of FINGERS) {
    ctx.strokeStyle = SKIN
    ctx.lineWidth = finger[0] === 1 ? fingerW * 0.85 : fingerW
    ctx.beginPath()
    ctx.moveTo(points[finger[0]!]![0], points[finger[0]!]![1])
    for (const index of finger.slice(1)) ctx.lineTo(points[index]![0], points[index]![1])
    ctx.stroke()
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 2.5
    ctx.stroke()
  }

  ctx.fillStyle = SKIN_HIGHLIGHT
  ctx.strokeStyle = OUTLINE
  for (const index of [4, 8, 12, 16, 20]) {
    ctx.beginPath()
    ctx.arc(points[index]![0], points[index]![1], fingerW * 0.42, 0, Math.PI * 2)
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
  const grabbing = hand.pinch >= PINCH_GRAB
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

/**
 * The hitbox: the exact circle HandCoupling uses to pick what a fist pushes,
 * plus the direction and size of the shove it is about to give (from the
 * fist's velocity). Drawn under the hand so the fist sits on top of it.
 */
function hitboxRadiusPx(hand: HandFrame, palm: Pt, map: (p: Vec3) => Pt): number {
  const reach = fistReachM(hand)
  const edge = map({ x: hand.palm_m.x + reach, y: hand.palm_m.y, z: hand.palm_m.z })
  return Math.hypot(edge[0] - palm[0], edge[1] - palm[1])
}

/** The filled disc of the hitbox, under the hand. */
function drawHitboxFill(ctx: CanvasRenderingContext2D, palm: Pt, radius: number): void {
  ctx.save()
  ctx.fillStyle = HIT_FILL
  ctx.beginPath()
  ctx.arc(palm[0], palm[1], radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * The hitbox ring and the shove arrow, over the hand: a fat glowing outline
 * that stays visible on any body colour and on the translucent fist itself.
 */
function drawHitbox(ctx: CanvasRenderingContext2D, hand: HandFrame, palm: Pt, radius: number, map: (p: Vec3) => Pt): void {
  ctx.save()
  ctx.strokeStyle = HIT
  ctx.lineWidth = 4
  ctx.shadowColor = HIT_GLOW
  ctx.shadowBlur = 16
  ctx.setLineDash([14, 8])
  ctx.beginPath()
  ctx.arc(palm[0], palm[1], radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.stroke() // twice: the glow builds up, the dashes stay crisp
  ctx.setLineDash([])
  ctx.shadowBlur = 0

  const vx = hand.palm_velocity_ms.x
  const vy = hand.palm_velocity_ms.y
  const speed = Math.hypot(vx, vy)
  if (speed >= PUNCH_MIN_SPEED_M_S) {
    // Arrow along the shove, length ∝ speed (0.25 s of travel, capped).
    const scale = Math.min(0.25, 0.6 / speed)
    const tip = map({ x: hand.palm_m.x + vx * scale, y: hand.palm_m.y + vy * scale, z: hand.palm_m.z })
    const dx = tip[0] - palm[0]
    const dy = tip[1] - palm[1]
    const len = Math.hypot(dx, dy)
    if (len > 6) {
      const ux = dx / len
      const uy = dy / len
      ctx.strokeStyle = HIT
      ctx.fillStyle = HIT
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.shadowColor = HIT_GLOW
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.moveTo(palm[0], palm[1])
      ctx.lineTo(tip[0] - ux * 10, tip[1] - uy * 10)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(tip[0], tip[1])
      ctx.lineTo(tip[0] - ux * 14 - uy * 8, tip[1] - uy * 14 + ux * 8)
      ctx.lineTo(tip[0] - ux * 14 + uy * 8, tip[1] - uy * 14 - ux * 8)
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.restore()
}

export function drawHandOverlay(
  ctx: CanvasRenderingContext2D,
  hand: HandFrame | null,
  map: (point: Vec3) => [number, number],
  /**
   * The coupling's latched fist. It has hysteresis (closes at FIST_CLOSE,
   * opens at FIST_OPEN); reading the raw value here made the avatar flicker
   * between fist and open hand while the coupling was still pushing.
   */
  fistedByCoupling?: boolean,
): void {
  if (!hand) return
  const palm = map(hand.palm_m)
  const points = hand.landmarks_m?.map(map) ?? []
  const fisted = fistedByCoupling ?? (hand.fist ?? 0) >= FIST_CLOSE

  ctx.save()
  const radius = fisted ? hitboxRadiusPx(hand, palm, map) : 0
  if (fisted) drawHitboxFill(ctx, palm, radius)

  // The hand itself goes onto the scratch layer and comes back see-through.
  if (points.length >= 21) {
    const palmPx = Math.hypot(points[5]![0] - points[17]![0], points[5]![1] - points[17]![1])
    const hctx = scratchFor(ctx)
    if (fisted) drawFist(hctx, points, palmPx)
    else drawOpenHand(hctx, points, palmPx, hand)
    blend(ctx)
  }

  if (fisted) drawHitbox(ctx, hand, palm, radius, map)

  ctx.fillStyle = fisted ? HIT : '#ff9ecb'
  ctx.font = '600 11px ui-monospace, monospace'
  const label = hand.pinch >= PINCH_GRAB ? 'PINCH' : fisted ? 'FIST' : 'HAND'
  ctx.fillText(label, palm[0] + 21, palm[1] - 10)
  ctx.restore()
}
