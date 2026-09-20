import { RemoteHandSource } from '../../hand/remote.ts'
import { RopeArt } from './art.ts'
import { HandBlade } from './input.ts'
import { LEVELS, PLANNED_LEVELS, type Point } from './levels.ts'
import { RopeWorld } from './physics.ts'
import style from './game.css?inline'

export class RopeGame {
  private host = document.createElement('div')
  private root = this.host.attachShadow({ mode: 'open' })
  private world = new RopeWorld(LEVELS[0]!)
  private blade = new HandBlade()
  private art: RopeArt
  private hand: RemoteHandSource
  private raf = 0
  private last = performance.now()
  private pointer: Point | null = null
  private pointerDown = false
  private tracked = false
  private wonAt = 0
  private lastReport = 0
  private reportInFlight = false
  private disposed = false
  private background: { element: HTMLElement; inert: boolean }[] = []
  private previousFocus = document.activeElement
  private readonly mouseOnly = new URLSearchParams(location.search).get('hand') === 'mouse'
  private score: HTMLElement
  private source: HTMLElement
  private result: HTMLElement

  constructor(private base: string, private exit: () => void) {
    this.host.id = 'rope-minigame'
    this.host.setAttribute('role', 'dialog')
    this.host.setAttribute('aria-modal', 'true')
    this.host.setAttribute('aria-label', 'Cut the Rope minigame')
    this.root.innerHTML = `<style>${style}</style>
      <main class="theatre">
        <canvas aria-label="Swipe across the rope to drop the candy through three stars into the creature's mouth"></canvas>
        <header><div class="brand">cut the rope<small>THE HAND-TRACKED PLAYGROUND</small></div>
          <div class="score" aria-label="0 of 3 stars">☆☆☆</div><div class="level">LEVEL 01 / 0${PLANNED_LEVELS}</div></header>
        <footer><button id="exit">← Back to physics</button><span class="source" role="status"></span><button id="retry">↻ Restart</button></footer>
        <section class="result" hidden aria-live="polite"><div class="card"><div class="big-stars"></div><h1></h1><p class="message"></p><button id="again">Play again</button><p class="coming">Level 1 preview · Levels 2–5 are coming next.</p></div></section>
      </main>`
    this.background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .map(element => ({ element, inert: element.inert }))
    for (const { element } of this.background) element.inert = true
    document.body.append(this.host)
    const canvas = this.root.querySelector('canvas')!
    this.art = new RopeArt(canvas)
    this.score = this.root.querySelector('.score')!
    this.source = this.root.querySelector('.source')!
    this.result = this.root.querySelector('.result')!
    this.hand = new RemoteHandSource({ base, element: canvas, toScene: (x, y) => this.art.toGame(x, y) })
    if (!this.mouseOnly) void this.hand.start()
    this.root.querySelector('#retry')!.addEventListener('click', () => this.restart())
    this.root.querySelector('#again')!.addEventListener('click', () => this.restart())
    this.root.querySelector('#exit')!.addEventListener('click', exit)
    this.root.querySelector<HTMLButtonElement>('#retry')!.focus()
    canvas.addEventListener('pointerdown', e => {
      this.pointerDown = true; canvas.setPointerCapture(e.pointerId)
      const [x, y] = this.art.toGame(e.clientX, e.clientY); this.pointer = { x, y }
    })
    canvas.addEventListener('pointermove', e => {
      const [x, y] = this.art.toGame(e.clientX, e.clientY), next = { x, y }
      if (this.pointerDown && this.pointer && !this.tracked) this.swipe(this.pointer, next)
      this.pointer = next
    })
    const release = () => { this.pointerDown = false; this.pointer = null }
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)
    canvas.addEventListener('lostpointercapture', release)
    document.addEventListener('visibilitychange', this.visibility)
    window.addEventListener('keydown', this.key, true)
    this.raf = requestAnimationFrame(this.frame)
  }

  restart(): void {
    this.world = new RopeWorld(LEVELS[0]!)
    this.blade.reset(); this.pointer = null; this.pointerDown = false
    this.wonAt = 0; this.result.hidden = true; this.lastReport = 0
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf); this.hand.stop(); this.host.remove()
    for (const { element, inert } of this.background) element.inert = inert
    if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus()
    window.removeEventListener('keydown', this.key, true)
    document.removeEventListener('visibilitychange', this.visibility)
  }

  private visibility = (): void => { this.blade.reset(); this.pointer = null; this.pointerDown = false; this.last = performance.now() }
  private key = (e: KeyboardEvent): void => {
    // Keep global app shortcuts from editing the scene behind the game.
    e.stopImmediatePropagation()
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Escape') { e.preventDefault(); this.exit() }
    if (e.key.toLowerCase() === 'r') { e.preventDefault(); this.restart() }
  }
  private swipe(a: Point, b: Point): void {
    this.art.slash(a, b)
    this.world.swipe(a, b)
  }
  private frame = (now: number): void => {
    if (this.disposed) return
    const dt = (now - this.last) / 1000; this.last = now
    const hand = document.hidden ? null : this.hand.current()
    this.tracked = hand !== null
    const stroke = this.blade.sample(hand)
    if (stroke) this.swipe(...stroke)
    if (!document.hidden) this.world.advance(dt)
    this.art.draw(this.world, this.blade.point ?? hand?.palm_m ?? (this.pointerDown ? this.pointer : null), now, hand)
    const stars = '★'.repeat(this.world.stars) + '☆'.repeat(3 - this.world.stars)
    this.score.textContent = stars
    this.score.setAttribute('aria-label', `${this.world.stars} of 3 stars`)
    this.source.dataset.live = String(this.tracked)
    this.source.textContent = this.mouseOnly ? 'Mouse preview · click and drag to cut' : this.tracked
      ? (hand?.fist ?? 0) > 0.65 ? 'Open your hand to cut' : 'Hand detected · sweep your fingertip across the rope'
      : this.hand.live ? 'Show one hand to the camera · or click and drag' : 'Waiting for camera · click and drag to preview'
    if (this.world.outcome !== 'playing') {
      if (!this.wonAt) this.wonAt = now
      if (now - this.wonAt > 950) {
        this.result.hidden = false
        this.root.querySelector('.big-stars')!.textContent = stars
        this.root.querySelector('h1')!.textContent = this.world.outcome === 'won' ? 'Sweet success!' : 'So close!'
        this.root.querySelector('.message')!.textContent = this.world.outcome === 'won'
          ? `${this.world.stars} of 3 stars. A perfect little snack.` : 'The candy missed our friend. Give it another snip.'
      }
    }
    if (now - this.lastReport > 1000 && !this.reportInFlight) {
      this.lastReport = now; this.reportInFlight = true
      void fetch(`${this.base}/api/rope/status`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome: this.world.outcome, stars: this.world.stars, cuts: this.world.cuts, tracked: this.tracked }) })
        .catch(() => undefined).finally(() => { this.reportInFlight = false })
    }
    this.raf = requestAnimationFrame(this.frame)
  }
}
