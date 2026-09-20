import { RopeGame } from './game.ts'

/** Only integration surface: the host skips its loop while active.
 * The solver, sandbox, history, and tracking implementation stay untouched.
 */
export class RopeMinigame {
  private game: RopeGame | null = null
  private stream: EventSource
  private standalone = new URLSearchParams(location.search).get('game') === 'rope'
  private base = new URLSearchParams(location.search).get('panel') || `http://${location.hostname}:8770`
  get active(): boolean { return this.game !== null }

  constructor() {
    this.stream = new EventSource(`${this.base}/api/events`)
    this.stream.addEventListener('state', e => {
      const state = JSON.parse((e as MessageEvent).data) as { view: string }
      if (state.view === 'rope') { this.standalone = false; this.open() }
      else if (!this.standalone) this.close()
    })
    this.stream.addEventListener('rope:control', e => {
      const { action } = JSON.parse((e as MessageEvent).data) as { action: string }
      if (action === 'restart') this.game?.restart()
    })
    if (this.standalone) {
      this.open()
      // Direct preview also enables tracking when a panel is available.
      void this.setView('rope')
    }
    window.addEventListener('pagehide', () => { this.close(); this.stream.close() }, { once: true })
  }
  private open(): void {
    if (!this.game) this.game = new RopeGame(this.base, () => {
      this.standalone = false; this.close(); void this.setView('home')
      const url = new URL(location.href); url.searchParams.delete('game'); history.replaceState(null, '', url)
    })
  }
  private close(): void { this.game?.dispose(); this.game = null }
  private async setView(view: string): Promise<void> {
    try {
      await fetch(`${this.base}/api/view`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ view }) })
    } catch { /* Standalone mouse preview also works without a running panel. */ }
  }
}
