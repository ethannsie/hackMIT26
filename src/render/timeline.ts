/**
 * Recorded simulation history, for scrubbing and path tracing.
 *
 * Distinct from the rollback buffer in history.ts. That one snapshots the
 * SPEC before a destructive edit; this one records what actually happened,
 * frame by frame, so a paused run can be scrubbed backwards and the path each
 * body travelled can be drawn.
 *
 * Scrubbing applies a recorded frame to the live bodies rather than rendering
 * from a parallel copy. That keeps one source of truth: the renderer, the
 * graphs and the free-body diagram all read the same body state whether the sim
 * is running or parked at an earlier frame.
 */

export interface BodyFrame {
  x_m: number
  y_m: number
  angle_deg: number
  vx_ms: number
  vy_ms: number
  omega_rads: number
}

export interface Frame {
  step: number
  t_s: number
  bodies: Record<string, BodyFrame>
}

/** Record every Nth physics step. 2 gives 60 Hz against a 120 Hz solver. */
const STRIDE = 2

export class Timeline {
  private frames: Frame[] = []
  /** Which frame is being shown; null means "live, at the end". */
  private cursor: number | null = null

  /** Frames kept. 5400 at 60 Hz is 90 s of history. */
  constructor(private capacity = 5400) {}

  get length(): number {
    return this.frames.length
  }

  get all(): readonly Frame[] {
    return this.frames
  }

  /** Index being displayed: the scrub position, or the last frame. */
  get index(): number {
    return this.cursor ?? this.frames.length - 1
  }

  get scrubbing(): boolean {
    return this.cursor !== null
  }

  at(i: number): Frame | null {
    return this.frames[Math.max(0, Math.min(this.frames.length - 1, i))] ?? null
  }

  get current(): Frame | null {
    return this.at(this.index)
  }

  clear(): void {
    this.frames = []
    this.cursor = null
  }

  record(step: number, t_s: number, bodies: Record<string, BodyFrame>): void {
    if (this.cursor !== null) return // never record while parked in the past
    // requestAnimationFrame is not a physics clock. At slow playback speeds it
    // can render several times before the next fixed step, so don't turn one
    // physical state into a stack of duplicate scrub positions.
    const last = this.frames[this.frames.length - 1]
    if (last?.step === step) return
    // Measured from the last frame kept, never `step % STRIDE`: a render loop
    // only sees the step count at frame boundaries, and one odd-sized first
    // frame (a 25 ms frame after a mode switch is three steps) would leave
    // every later count odd and record nothing for the rest of the run.
    if (last && step - last.step < STRIDE) return

    this.frames.push({ step, t_s, bodies })
    if (this.frames.length > this.capacity) this.frames.shift()
  }

  /** Park on a frame. Pass null to return to live. */
  seek(i: number | null): Frame | null {
    if (i === null) {
      this.cursor = null
      return null
    }
    this.cursor = Math.max(0, Math.min(this.frames.length - 1, i))
    return this.frames[this.cursor] ?? null
  }

  /**
   * Resume from the scrub position: everything after it is discarded.
   *
   * Playing forward from an earlier point makes that point the new present, the
   * way a tape does. Keeping the old future around would put the scrubber out
   * of step with the bodies the moment they diverge.
   */
  commitToCursor(): void {
    if (this.cursor === null) return
    this.frames.length = this.cursor + 1
    this.cursor = null
  }

  /** The path one body has travelled, in scene metres, up to the cursor. */
  pathFor(id: string): { x: number; y: number }[] {
    const end = this.index
    const out: { x: number; y: number }[] = []
    for (let i = 0; i <= end && i < this.frames.length; i++) {
      const b = this.frames[i]!.bodies[id]
      if (b) out.push({ x: b.x_m, y: b.y_m })
    }
    return out
  }

  /** Ids that actually travel, including paths that return to their start. */
  movingIds(minTravel_m = 0.05): string[] {
    if (this.frames.length < 2) return []
    const first = this.frames[0]!
    const end = Math.min(this.index, this.frames.length - 1)
    const ids: string[] = []
    for (const id of Object.keys(first.bodies)) {
      let travelled = 0
      let previous = first.bodies[id]
      for (let i = 1; i <= end; i++) {
        const current = this.frames[i]!.bodies[id]
        if (previous && current) travelled += Math.hypot(current.x_m - previous.x_m, current.y_m - previous.y_m)
        previous = current
      }
      if (travelled > minTravel_m) ids.push(id)
    }
    return ids
  }
}
