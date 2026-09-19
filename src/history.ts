/**
 * Rollback: a short, in-memory history of what was simulated.
 *
 * Reset and edits are destructive — a scene you had tuned for ten minutes is
 * gone the moment a slider moves. This keeps the last few states so you can step
 * back and look at what was running before.
 *
 * The snapshots are tiny because the sim is deterministic. A run is fully
 * described by its spec plus a step count: restoring means rebuilding from the
 * spec and replaying that many fixed steps, which lands on exactly the same
 * state, bit for bit. Nothing about the bodies needs storing.
 *
 * In memory only. Nothing is written to disk and nothing survives a reload,
 * which is the intent — this is an undo buffer, not a save file.
 */

export interface Snapshot<T> {
  id: number
  /** Human label for the action this state preceded, e.g. "before reset". */
  label: string
  /** Simulation time this state was captured at. */
  sim_time_s: number
  at_ms: number
  payload: T
}

export class History<T> {
  private entries: Snapshot<T>[] = []
  private nextId = 1
  private lastPushMs = 0
  private lastLabel = ''

  constructor(
    private limit = 24,
    /** Pushes with the same label inside this window are coalesced. */
    private coalesceMs = 900,
  ) {}

  /**
   * Record the state as it is BEFORE some destructive action.
   *
   * Repeated pushes from one continuous gesture — dragging a slider fires on
   * every pixel — collapse into the first, so undo returns to before the drag
   * rather than to the middle of it.
   */
  push(label: string, payload: T, sim_time_s: number): void {
    const now = Date.now()
    if (label === this.lastLabel && now - this.lastPushMs < this.coalesceMs) {
      this.lastPushMs = now
      return
    }
    this.lastPushMs = now
    this.lastLabel = label

    this.entries.push({ id: this.nextId++, label, sim_time_s, at_ms: now, payload })
    if (this.entries.length > this.limit) this.entries.shift()
  }

  /** Most recent snapshot, removed from the stack. */
  pop(): Snapshot<T> | null {
    const entry = this.entries.pop() ?? null
    // A restore should not be coalesced into whatever comes next.
    this.lastLabel = ''
    return entry
  }

  /** Restore a specific snapshot and drop everything after it. */
  take(id: number): Snapshot<T> | null {
    const idx = this.entries.findIndex((e) => e.id === id)
    if (idx === -1) return null
    const entry = this.entries[idx]!
    this.entries.length = idx
    this.lastLabel = ''
    return entry
  }

  /** Newest first. */
  list(): Snapshot<T>[] {
    return [...this.entries].reverse()
  }

  get size(): number {
    return this.entries.length
  }

  clear(): void {
    this.entries = []
    this.lastLabel = ''
  }
}
