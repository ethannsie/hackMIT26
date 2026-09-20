/**
 * Optional link to the 7 in. control panel (panel/panel_server.py).
 *
 * Two directions, both of which fail soft:
 *   app  -> panel   the current mode, so the panel can follow it into sandbox
 *   panel -> app    a saved scan, which lands here as a Blob and goes straight
 *                   into the existing extraction path
 *
 * If the panel is not running, connect() reports it once and everything else
 * becomes a no-op. The app is never blocked on it.
 */

/** The panel binds localhost on the demo box; the app runs on the same box. */
const DEFAULT_BASE = `http://${window.location.hostname}:8770`

/** What the panel's Graphs view can ask the app to do. */
export interface SimControl {
  action: 'play' | 'pause' | 'seek'
  index?: number
}

export interface PanelEvents {
  /** A scan was saved on the panel. The Blob is the full-quality JPEG. */
  onScan(image: Blob, file: string): void
  /** Connection state changed, for the status line. */
  onLink?(up: boolean): void
  /** The panel switched views; 'graphs' is the one the app streams to. */
  onView?(view: string): void
  /** Transport from the panel's Graphs view: same effect as the app's own controls. */
  onControl?(cmd: SimControl): void
}

export class PanelLink {
  private stream: EventSource | null = null
  private up = false
  /** Last mode we told the panel, so a reconnect can resend it. */
  private mode: 'problem' | 'sandbox' | null = null
  /** The panel's current view, from its state events. */
  view = 'home'
  private simInFlight = false

  constructor(
    private readonly events: PanelEvents,
    readonly base: string = DEFAULT_BASE,
  ) {}

  get live(): boolean {
    return this.up
  }

  connect(): void {
    if (this.stream) return
    const stream = new EventSource(`${this.base}/api/events`)
    this.stream = stream

    stream.addEventListener('open', () => {
      this.setUp(true)
      // The panel may have restarted; it has no memory of our mode.
      if (this.mode) void this.setMode(this.mode)
    })
    stream.addEventListener('error', () => this.setUp(false))

    stream.addEventListener('scan:saved', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { file: string; url: string }
      void this.fetchScan(data.url, data.file)
    })

    stream.addEventListener('state', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { view?: string }
      if (typeof data.view === 'string' && data.view !== this.view) {
        this.view = data.view
        this.events.onView?.(this.view)
      }
    })

    stream.addEventListener('sim:control', (e) => {
      const cmd = JSON.parse((e as MessageEvent).data) as SimControl
      if (cmd.action === 'play' || cmd.action === 'pause' || cmd.action === 'seek') {
        this.events.onControl?.(cmd)
      }
    })
  }

  /**
   * Motion samples + transport state for the panel's Graphs view. Fire and
   * forget, one request in flight at a time: a slow panel drops snapshots
   * rather than queueing them, and the next one carries the newer state.
   */
  sendSim(payload: unknown): void {
    if (!this.up || this.simInFlight) return
    this.simInFlight = true
    fetch(`${this.base}/api/sim/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .catch(() => undefined)
      .finally(() => {
        this.simInFlight = false
      })
  }

  disconnect(): void {
    this.stream?.close()
    this.stream = null
    this.setUp(false)
  }

  /** Tell the panel which mode the app is in. Silent if the panel is down. */
  async setMode(mode: 'problem' | 'sandbox'): Promise<void> {
    this.mode = mode
    try {
      await fetch(`${this.base}/api/mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
    } catch {
      // Panel down. Not an error worth surfacing: it is an accessory.
    }
  }

  private async fetchScan(url: string, file: string): Promise<void> {
    try {
      const res = await fetch(`${this.base}${url}`)
      if (!res.ok) throw new Error(String(res.status))
      this.events.onScan(await res.blob(), file)
    } catch {
      // The panel told us about a file we cannot read. Nothing useful to do
      // here; the panel already reported the save on its own screen.
    }
  }

  private setUp(up: boolean): void {
    if (up === this.up) return
    this.up = up
    this.events.onLink?.(up)
  }
}
