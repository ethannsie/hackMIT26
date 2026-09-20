import { RemoteHandSource } from '../../hand/remote.ts'
import { RopeArt } from './art.ts'
import { CandyInteraction } from './interaction.ts'
import { LEVELS, PLANNED_LEVELS, type Point } from './levels.ts'
import { RopeWorld } from './physics.ts'
import style from './game.css?inline'

export class RopeGame {
  private host = document.createElement('div')
  private root = this.host.attachShadow({ mode: 'open' })
  private world = new RopeWorld(LEVELS[0]!)
  private interaction = new CandyInteraction()
  private art: RopeArt
  private hand: RemoteHandSource
  private raf = 0
  private last = performance.now()
  private tracked = false
  private wonAt = 0
  private lastReport = 0
  private reportInFlight = false
  private disposed = false
  private background: { element: HTMLElement; inert: boolean }[] = []
  private previousFocus = document.activeElement
  private score: HTMLElement
  private source: HTMLElement
  private result: HTMLElement

  constructor(private base: string) {
    this.host.id = 'rope-minigame'
    this.host.setAttribute('role', 'dialog')
    this.host.setAttribute('aria-modal', 'true')
    this.host.setAttribute('aria-label', 'Cut the Rope minigame')
    this.root.innerHTML = `<style>${style}</style>
      <main class="theatre">
        <canvas aria-label="Pinch the candy between thumb and index finger, swing it, then open your fingers to release. Cut the rope and bounce off the ramp and bumper."></canvas>
        <header><div class="brand">cut the rope<small>THE HAND-TRACKED PLAYGROUND</small></div>
          <div class="score" aria-label="0 of 3 stars">☆☆☆</div><div class="level">LEVEL 01 / 0${PLANNED_LEVELS}</div></header>
        <span class="source" role="status"></span><footer>Cut · Restart · Exit on the touchscreen</footer>
        <section class="result" hidden aria-live="polite"><div class="card"><div class="big-stars"></div><h1></h1><p class="message"></p><p class="next">Tap Restart on the touchscreen to play again.</p><p class="coming">Level 1 preview · Levels 2–5 are coming next.</p></div></section>
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
    void this.hand.start()
    this.host.tabIndex = -1
    this.host.focus()
    document.addEventListener('visibilitychange', this.visibility)
    window.addEventListener('keydown', this.key, true)
    this.raf = requestAnimationFrame(this.frame)
  }

  cutRopes(): void { this.world.cutAll() }

  restart(): void {
    this.world.dispose()
    this.world = new RopeWorld(LEVELS[0]!)
    this.interaction.reset(this.world)
    this.wonAt = 0; this.result.hidden = true; this.lastReport = 0
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf); this.hand.stop(); this.world.dispose(); this.host.remove()
    for (const { element, inert } of this.background) element.inert = inert
    if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus()
    window.removeEventListener('keydown', this.key, true)
    document.removeEventListener('visibilitychange', this.visibility)
  }

  private visibility = (): void => { this.interaction.reset(this.world); this.last = performance.now() }
  private key = (e: KeyboardEvent): void => {
    // Keep global app shortcuts from editing the scene behind the game.
    e.stopImmediatePropagation()
    if (!e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault()
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
    const stroke = this.interaction.sample(hand, this.world)
    if (stroke) this.swipe(...stroke)
    if (!document.hidden) this.world.advance(dt)
    this.art.draw(this.world, this.interaction.point ?? hand?.palm_m ?? null, now, hand)
    const stars = '★'.repeat(this.world.stars) + '☆'.repeat(3 - this.world.stars)
    this.score.textContent = stars
    this.score.setAttribute('aria-label', `${this.world.stars} of 3 stars`)
    this.source.dataset.live = String(this.tracked)
    this.source.textContent = this.world.held
      ? `Holding · ${this.world.speed.toFixed(1)} m/s · open thumb & index to release`
      : this.tracked ? `${this.world.speed.toFixed(1)} m/s · pinch the candy to pick it up`
      : this.hand.live ? 'Show your hand to the camera' : 'Waiting for camera · check the touchscreen'
    if (this.world.outcome !== 'playing') {
      if (!this.wonAt) this.wonAt = now
      if (now - this.wonAt > 950) {
        this.result.hidden = false
        this.root.querySelector('.big-stars')!.textContent = stars
        this.root.querySelector('h1')!.textContent = this.world.outcome === 'won' ? 'Sweet success!' : 'So close!'
        this.root.querySelector('.message')!.textContent = this.world.outcome === 'won'
          ? `${this.world.stars} of 3 stars. Swing, flight, and a well-earned snack.` : 'The candy missed our friend. Try another throw.'
      }
    }
    if (now - this.lastReport > 1000 && !this.reportInFlight) {
      this.lastReport = now; this.reportInFlight = true
      void fetch(`${this.base}/api/rope/status`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome: this.world.outcome, stars: this.world.stars, cuts: this.world.cuts, tracked: this.tracked, held: this.world.held, speed: this.world.speed }) })
        .catch(() => undefined).finally(() => { this.reportInFlight = false })
    }
    this.raf = requestAnimationFrame(this.frame)
  }
}
