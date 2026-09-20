import { LEVELS } from './levels.ts'
import type { Outcome } from './physics.ts'

const KEY = 'rope-puzzles-v1'
/** Save between levels; a half-finished attempt always restarts cleanly. */
export class RopeProgress {
  index = 0
  best: number[] = LEVELS.map(() => -1)

  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      const saved = JSON.parse(storage?.getItem(KEY) ?? 'null')
      if (Array.isArray(saved?.best)) this.best = this.best.map((_, i) =>
        Number.isInteger(saved.best[i]) && saved.best[i] >= 0 && saved.best[i] <= 3 ? saved.best[i] : -1)
      if (Number.isInteger(saved?.index) && saved.index >= 0 && saved.index < LEVELS.length) this.index = saved.index
    } catch { /* Storage unavailable or corrupt save: start at level one. */ }
  }
  complete(stars: number): void {
    this.best[this.index] = Math.max(this.best[this.index]!, stars)
    this.save()
  }
  canNext(outcome: Outcome): boolean { return outcome === 'won' && this.index + 1 < LEVELS.length }
  next(outcome: Outcome): boolean {
    if (!this.canNext(outcome)) return false
    this.index++; this.save(); return true
  }
  select(level: number): boolean {
    const index = LEVELS.findIndex(candidate => candidate.id === level)
    if (index < 0) return false
    this.index = index; this.save(); return true
  }
  replay(): void { this.index = 0; this.save() }
  private save(): void {
    try { this.storage?.setItem(KEY, JSON.stringify({ index: this.index, best: this.best })) } catch { /* Optional. */ }
  }
}
