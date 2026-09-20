/**
 * Retrieval for /api/ask: the textbook passages that best match a question.
 *
 * BM25 over the chunks scripts/build-corpus.ts wrote, in memory, built at
 * boot. No embedding model, on purpose: the GX10 is offline at the venue and
 * one more model to pull is one more thing that can be missing at 9 a.m. A
 * keyword index over a physics textbook is not subtle, but the questions are
 * not either — "why does the top of the wheel move faster" lands on the
 * rolling-without-slipping section every time — and it costs nothing.
 *
 * The corpus directory may be empty. Then search() returns nothing and the
 * model answers from what it knows, which is the same demo with less footing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Passage {
  id: string
  book: string
  section: string
  text: string
  score: number
}

interface Chunk {
  id: string
  book: string
  section: string
  text: string
}

const STOP = new Set(
  'a an the of to in on at for and or is are was were be been it its this that these those with as by from into than then there here what why how does do did can will would should could i you we they he she which who when where not no yes'.split(
    ' ',
  ),
)

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t))
    // Crude stemming: "forces" and "force", "rolling" and "roll" should meet.
    .map((t) => t.replace(/(ing|ed|es|s)$/, (m, _o, s: string) => (s.length > 4 ? '' : m)))
}

export class Corpus {
  private chunks: Chunk[] = []
  private df = new Map<string, number>()
  private tf: Map<string, number>[] = []
  private lengths: number[] = []
  private avgLen = 1

  /** Books loaded, for the attribution line and the health endpoint. */
  readonly books: string[] = []

  constructor(dir: string) {
    if (!existsSync(dir)) return
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      try {
        const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { book: string; chunks: Chunk[] }
        this.chunks.push(...data.chunks)
        this.books.push(data.book)
      } catch (err) {
        console.warn(`corpus: skipped ${file}: ${(err as Error).message}`)
      }
    }
    for (const c of this.chunks) {
      const counts = new Map<string, number>()
      const ts = tokens(`${c.section} ${c.text}`)
      for (const t of ts) counts.set(t, (counts.get(t) ?? 0) + 1)
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      this.tf.push(counts)
      this.lengths.push(ts.length)
    }
    this.avgLen = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length)
  }

  get size(): number {
    return this.chunks.length
  }

  search(query: string, k = 4): Passage[] {
    if (this.chunks.length === 0) return []
    const q = [...new Set(tokens(query))]
    const N = this.chunks.length
    const k1 = 1.4
    const b = 0.75
    const scored: Passage[] = []
    for (let i = 0; i < N; i++) {
      const tf = this.tf[i]!
      let score = 0
      for (const t of q) {
        const f = tf.get(t)
        if (!f) continue
        const df = this.df.get(t) ?? 0
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * this.lengths[i]!) / this.avgLen)))
      }
      if (score > 0) scored.push({ ...this.chunks[i]!, score })
    }
    scored.sort((x, y) => y.score - x.score)
    return scored.slice(0, k)
  }
}
