/**
 * Turn a textbook's extracted text into retrievable chunks for /api/ask.
 *
 * Input: `corpus/<name>.txt`, as written by `pdftotext -enc UTF-8` from the
 * OpenStax PDF (see corpus/README.md). Output: `corpus/<name>.json`, a list of
 * ~900-character passages each tagged with the section it came from, which
 * server/corpus.ts indexes at boot and hands to the local model as context.
 *
 * Nothing here is committed: the current OpenStax edition is CC BY-NC-SA, so
 * the built corpus stays on the demo box. Run once, on the box:
 *
 *   npx tsx scripts/build-corpus.ts corpus/university-physics-volume-1.txt
 *
 * Why chunk by paragraph and tag by section rather than anything cleverer:
 * the questions this answers are "why does the ball keep moving", asked at a
 * demo table, and a page of the right section beats a sentence from the
 * wrong one. Equations are lost in the text extraction (they are images in
 * the PDF); the prose around them is what the model needs anyway.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const TARGET_CHARS = 900
const MIN_CHARS = 200

export interface Chunk {
  id: string
  /** Book title, for the attribution line under an answer. */
  book: string
  /** "3.4 Motion with Constant Acceleration" — the page header it sat under. */
  section: string
  text: string
}

const path = process.argv[2]
if (!path) {
  console.error('usage: npx tsx scripts/build-corpus.ts corpus/<book>.txt')
  process.exit(1)
}

const raw = readFileSync(path, 'utf8')
const name = basename(path).replace(/\.txt$/, '')
const book = name
  .split('-')
  .map((w) => (/^\d/.test(w) ? w : w[0]!.toUpperCase() + w.slice(1)))
  .join(' ')

// Page headers in the OpenStax PDF read "3.4 • Motion with Constant
// Acceleration" and "Chapter 3 • Motion Along a Straight Line"; either one
// is the section every following paragraph belongs to.
const SECTION = /^(?:Chapter \d+|\d+\.\d+) • (.+)$/
const NOISE = [/^Access for free at openstax\.org$/, /^\d{1,4}$/, /^\s*$/]

let section = 'Front matter'
let paragraph: string[] = []
const paragraphs: { section: string; text: string }[] = []

const flush = (): void => {
  const text = paragraph.join(' ').replace(/\s+/g, ' ').trim()
  if (text.length > 0) paragraphs.push({ section, text })
  paragraph = []
}

for (const line of raw.split(/\r?\n/)) {
  const s = line.trim()
  const m = SECTION.exec(s)
  if (m) {
    flush()
    section = s.replace(' • ', ' ')
    continue
  }
  if (NOISE.some((re) => re.test(s))) {
    // A blank line ends a paragraph; the other noise is just dropped.
    if (s === '') flush()
    continue
  }
  paragraph.push(s)
}
flush()

// Pack consecutive paragraphs of one section up to the target size, with
// one paragraph of overlap so a thought split across chunks is still findable.
const chunks: Chunk[] = []
let buf: { section: string; text: string }[] = []
let bufLen = 0
const emit = (): void => {
  const text = buf.map((p) => p.text).join('\n')
  if (text.length >= MIN_CHARS) {
    chunks.push({ id: `${name}#${chunks.length}`, book, section: buf[0]!.section, text })
  }
}
for (const p of paragraphs) {
  const sectionChanged = buf.length > 0 && buf[0]!.section !== p.section
  if (sectionChanged || bufLen + p.text.length > TARGET_CHARS) {
    emit()
    const carry = sectionChanged || buf.length === 0 ? [] : [buf[buf.length - 1]!]
    buf = carry
    bufLen = carry.reduce((n, q) => n + q.text.length, 0)
  }
  buf.push(p)
  bufLen += p.text.length
}
if (buf.length) emit()

const out = path.replace(/\.txt$/, '.json')
writeFileSync(out, JSON.stringify({ book, license: 'CC BY-NC-SA 4.0, OpenStax', chunks }))
console.log(`${book}: ${paragraphs.length} paragraphs -> ${chunks.length} chunks -> ${out}`)
