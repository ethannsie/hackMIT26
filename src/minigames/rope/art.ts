import { HEIGHT, WIDTH, type Point } from './levels.ts'
import { RopeWorld } from './physics.ts'
import type { HandFrame } from '../../hand/types.ts'
import { drawTrackedHand } from './hand-overlay.ts'

interface Particle extends Point { vx: number; vy: number; life: number; color: string }
export class RopeArt {
  private particles: Particle[] = []
  private trail: (Point & { life: number })[] = []
  private last = 0
  constructor(readonly canvas: HTMLCanvasElement) {}

  toGame(x: number, y: number): [number, number] {
    const r = this.canvas.getBoundingClientRect()
    return [(x - r.left) / r.width * WIDTH, (y - r.top) / r.height * HEIGHT]
  }

  slash(a: Point, b: Point): void { this.trail.push({ ...a, life: 0.22 }, { ...b, life: 0.22 }) }

  draw(world: RopeWorld, hand: Point | null, now: number, trackedHand: HandFrame | null = null): void {
    const ctx = this.canvas.getContext('2d')!
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0)
    this.last = now
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr)
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height
    }
    ctx.setTransform(width / WIDTH, 0, 0, height / HEIGHT, 0, 0)
    const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT)
    bg.addColorStop(0, '#edf3d9'); bg.addColorStop(1, '#c7dfb3')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, WIDTH, HEIGHT)

    // A paper theatre: pinstriped paper, rolling hills, layered leaves.
    ctx.strokeStyle = '#7897710b'; ctx.lineWidth = 1
    for (let x = 0; x < WIDTH; x += 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke() }
    this.hill(ctx, '#bad3a1', 754, 40)
    this.hill(ctx, '#9bbf85', 800, 90)
    for (const [x, y, angle, scale] of [[-10, 530, -0.5, 1.4], [1180, 625, 0.7, 1.1], [90, 820, -0.4, 1.2], [1110, 820, 0.4, 1.4]]) {
      ctx.save(); ctx.translate(x!, y!); ctx.rotate(angle!); ctx.scale(scale!, scale!)
      ctx.strokeStyle = '#567e50'; ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(0, 180); ctx.quadraticCurveTo(45, 70, 0, 0); ctx.stroke()
      for (let i = 0; i < 5; i++) {
        ctx.save(); ctx.translate(12, 30 + i * 27); ctx.rotate(i % 2 ? 0.7 : -1.5)
        ctx.fillStyle = i % 2 ? '#769d62' : '#5e8958'
        ctx.beginPath(); ctx.ellipse(22, 0, 36, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore()
      }
      ctx.restore()
    }
    ctx.fillStyle = '#52704b'; ctx.font = '600 13px system-ui'; ctx.textAlign = 'left'
    ctx.fillText('A LITTLE PHYSICS. A LITTLE MAGIC.', 72, 146)
    ctx.fillStyle = '#264f39'; ctx.font = '800 52px system-ui'
    ctx.fillText('The first snip.', 70, 207)
    ctx.font = '20px system-ui'; ctx.fillStyle = '#60775b'
    ctx.fillText('One rope. Three stars.', 73, 249)
    ctx.fillText('One very hungry friend.', 73, 277)

    ctx.save(); ctx.translate(92, 374); ctx.rotate(-0.06)
    ctx.fillStyle = '#ffffff80'; ctx.beginPath(); ctx.roundRect(-20, -32, 330, 141, 18); ctx.fill()
    ctx.fillStyle = '#315b42'; ctx.font = '700 21px system-ui'; ctx.fillText('✂  Swipe to cut', 0, 0)
    ctx.font = '17px system-ui'; ctx.fillStyle = '#60775b'
    ctx.fillText('Point one finger at the camera.', 0, 36)
    ctx.fillText('Sweep across the rope.', 0, 63)
    ctx.fillText('No pinching needed.', 0, 90); ctx.restore()

    ctx.save(); ctx.setLineDash([3, 10]); ctx.strokeStyle = '#64845755'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(700, 300); ctx.bezierCurveTo(815, 275, 785, 335, 710, 324); ctx.stroke()
    ctx.restore()
    ctx.fillStyle = '#648457'; ctx.font = 'italic 17px Georgia'; ctx.fillText('snip here', 798, 306)

    // The visible rope is the exact line tested by the blade.
    for (const rope of world.ropes) {
      if (!rope.cut) {
        ctx.lineCap = 'round'; ctx.strokeStyle = '#735632'; ctx.lineWidth = 8
        ctx.beginPath(); ctx.moveTo(rope.anchor.x, rope.anchor.y); ctx.lineTo(world.candy.x, world.candy.y); ctx.stroke()
        ctx.strokeStyle = '#e0c492'; ctx.lineWidth = 4; ctx.setLineDash([4, 6]); ctx.stroke(); ctx.setLineDash([])
      } else {
        ctx.strokeStyle = '#947546'; ctx.lineWidth = 5
        ctx.beginPath(); ctx.moveTo(rope.anchor.x, rope.anchor.y); ctx.quadraticCurveTo(rope.anchor.x + 12, rope.anchor.y + 26, rope.anchor.x - 5, rope.anchor.y + 40); ctx.stroke()
      }
      this.disc(ctx, rope.anchor.x, rope.anchor.y, 15, '#667963')
      this.disc(ctx, rope.anchor.x - 2, rope.anchor.y - 3, 9, '#b2c3a2')
      this.disc(ctx, rope.anchor.x - 2, rope.anchor.y - 3, 3, '#63735a')
    }
    world.level.stars.forEach((star, i) => {
      if (!world.collected[i]) {
        const pulse = 1 + Math.sin(now / 420 + i) * 0.06
        ctx.save(); ctx.translate(star.x, star.y); ctx.scale(pulse, pulse)
        ctx.shadowColor = '#ffda60'; ctx.shadowBlur = 24
        this.star(ctx, 0, 0, 23, '#ffcb44'); ctx.shadowBlur = 0
        this.star(ctx, -2, -3, 15, '#ffe687'); ctx.restore()
      }
    })

    this.monster(ctx, world, now)
    if (world.outcome !== 'won') this.candy(ctx, world.candy, world.elapsed * 0.25)

    for (const event of world.events.splice(0)) {
      const color = event.kind === 'cut' ? '#faf4d4' : event.kind === 'lost' ? '#e78379' : '#ffce52'
      for (let i = 0; i < (event.kind === 'won' ? 55 : 18); i++) {
        const angle = Math.random() * Math.PI * 2, speed = 70 + Math.random() * 180
        this.particles.push({ ...event.at, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 80,
          life: 0.7 + Math.random() * 0.6, color })
      }
    }
    this.particles = this.particles.filter(p => p.life > 0)
    for (const p of this.particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 280 * dt
      ctx.globalAlpha = Math.min(1, p.life * 2); this.disc(ctx, p.x, p.y, 4, p.color)
    }
    ctx.globalAlpha = 1
    this.trail = this.trail.filter(p => (p.life -= dt) > 0)
    for (let i = 0; i + 1 < this.trail.length; i += 2) {
      const a = this.trail[i]!, b = this.trail[i + 1]!
      ctx.globalAlpha = a.life / 0.22; ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.lineCap = 'round'
      ctx.shadowColor = '#54cfa5'; ctx.shadowBlur = 16
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1
    if (trackedHand?.landmarks_m?.length === 21) {
      drawTrackedHand(ctx, trackedHand)
    } else if (hand) {
      this.disc(ctx, hand.x, hand.y, 15, '#ffffffb0')
      ctx.strokeStyle = '#287657'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hand.x, hand.y, 21, 0, 2 * Math.PI); ctx.stroke()
      this.disc(ctx, hand.x, hand.y, 4, '#287657')
    }
  }

  private hill(ctx: CanvasRenderingContext2D, color: string, y: number, height: number): void {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, y)
    ctx.bezierCurveTo(400, y - height * 2, 800, y + height, WIDTH, y - height)
    ctx.lineTo(WIDTH, HEIGHT); ctx.lineTo(0, HEIGHT); ctx.fill()
  }
  private disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
  }
  private star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
    ctx.fillStyle = color; ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5 - Math.PI / 2, radius = i % 2 ? r * 0.47 : r
      ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius)
    }
    ctx.closePath(); ctx.fill()
  }
  private candy(ctx: CanvasRenderingContext2D, p: Point, angle: number): void {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle)
    ctx.shadowColor = '#70432b40'; ctx.shadowBlur = 15; ctx.shadowOffsetY = 5
    this.disc(ctx, 0, 0, 26, '#fcf0d5'); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.clip()
    for (let i = 0; i < 5; i++) {
      ctx.rotate(Math.PI * 2 / 5); ctx.fillStyle = '#e86558'
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(17, -5, 10, -25, 28, -28)
      ctx.lineTo(30, -5); ctx.bezierCurveTo(14, -10, 8, 4, 0, 0); ctx.fill()
    }
    ctx.restore(); this.disc(ctx, -9, -10, 5, '#ffffffaa'); ctx.restore()
  }
  private monster(ctx: CanvasRenderingContext2D, world: RopeWorld, now: number): void {
    const { x, y } = world.level.mouth
    const happy = world.outcome === 'won'
    const bounce = happy ? Math.abs(Math.sin(now / 140)) * 9 : Math.sin(now / 430) * 2
    ctx.save(); ctx.translate(x, y - bounce)
    ctx.fillStyle = '#537a4430'; ctx.beginPath(); ctx.ellipse(0, 62 + bounce, 77, 12, 0, 0, Math.PI * 2); ctx.fill()
    this.disc(ctx, -40, 48, 23, '#558743'); this.disc(ctx, 40, 48, 23, '#558743')
    ctx.fillStyle = '#80b74e'; ctx.beginPath(); ctx.ellipse(0, 8, 66, 58, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#aad365'; ctx.beginPath(); ctx.ellipse(0, 17, 52, 40, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#80b74e'; ctx.beginPath(); ctx.moveTo(-47, -20); ctx.quadraticCurveTo(-80, -73, -31, -46); ctx.fill()
    ctx.beginPath(); ctx.moveTo(47, -20); ctx.quadraticCurveTo(80, -73, 31, -46); ctx.fill()
    for (const ex of [-25, 25]) {
      this.disc(ctx, ex, -30, 23, '#fcf9e9')
      const look = Math.max(-5, Math.min(5, (world.candy.x - x) / 50))
      this.disc(ctx, ex + look, -34, 9, '#28473b'); this.disc(ctx, ex + look - 3, -37, 3, '#fff')
    }
    ctx.fillStyle = '#344738'; ctx.beginPath(); ctx.ellipse(0, 6, happy ? 24 : 37, happy ? 12 : 30, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#e58b7d'; ctx.beginPath(); ctx.ellipse(0, happy ? 10 : 23, 21, 9, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fffbe5'
    for (const tx of [-20, 10]) { ctx.beginPath(); ctx.roundRect(tx, -17, 11, 13, [0, 0, 5, 5]); ctx.fill() }
    this.disc(ctx, -46, 6, 9, '#d4a86b70'); this.disc(ctx, 46, 6, 9, '#d4a86b70')
    ctx.restore()
  }
}
