/**
 * Local extraction API.
 *
 * Exists for one reason: the OpenAI key must never reach the browser. Vite
 * proxies /api here (see vite.config.ts), so the front end only ever talks to
 * localhost and never holds a credential.
 *
 * The agreed demo runs all models on GX10; leave OPENAI_API_KEY unset.
 * Hosted support remains a development contingency. GX10 runs Ollama, whose
 * OpenAI-compatible endpoint takes the exact same prompt and strict schema, so the two backends
 * differ only in base URL, model name and how long we are willing to wait.
 *
 * Measured on the GX10 (Sat 19 Sep): qwen3.8 (27B, vision) returns a full
 * 538-token spec in ~30 s at ~18 tok/s. That is why EXTRACT_LOCAL_TIMEOUT_MS
 * defaults to 45 s rather than the 2 s the plan originally assumed — a 2 s
 * timeout would fall through to OpenAI on every single photo and the GX10
 * would never do any work. A stalled GX10 still cannot freeze a demo: the
 * timeout fires, we fall back, and the UI shows which backend answered.
 */
import 'dotenv/config'
import express from 'express'
import OpenAI from 'openai'
import { RESPONSE_FORMAT } from '../src/spec/schema.ts'
import { validateSpec } from '../src/spec/validate.ts'
import { SYSTEM_PROMPT, USER_PROMPT } from './prompt.ts'
import { generatePrompt, pickType, TUTOR_SYSTEM } from './generate.ts'
import { Corpus } from './corpus.ts'

const PORT = Number(process.env['API_PORT'] ?? 8787)
const MODEL = process.env['OPENAI_MODEL'] ?? 'gpt-4o'
// Optional on-device backend: an OpenAI-compatible base URL, e.g. the GX10's
// Ollama at http://localhost:11434/v1 (see gx10/README.md).
const LOCAL_URL = process.env['EXTRACT_LOCAL_URL']
const LOCAL_MODEL = process.env['EXTRACT_LOCAL_MODEL'] ?? 'qwen3.8'
const LOCAL_TIMEOUT_MS = Number(process.env['EXTRACT_LOCAL_TIMEOUT_MS'] ?? 45_000)
// Text-only jobs (writing a problem, answering a question) go to the faster
// model: no picture to read, and a 67 tok/s answer at a demo table beats an
// 18 tok/s one. Falls back to the extraction model if unset.
const TEXT_MODEL = process.env['TEXT_LOCAL_MODEL'] ?? 'nemotron-3.5-lightning'
const TEXT_TIMEOUT_MS = Number(process.env['TEXT_LOCAL_TIMEOUT_MS'] ?? 60_000)
// Speech-to-text is the one hosted piece: Deepgram, keyed from .env and only
// ever called from this process. Without a key the Ask box still works typed.
const DEEPGRAM_KEY = process.env['DEEPGRAM_API_KEY']
const DEEPGRAM_MODEL = process.env['DEEPGRAM_MODEL'] ?? 'nova-3'
const CORPUS_DIR = process.env['CORPUS_DIR'] ?? new URL('../corpus', import.meta.url).pathname

const app = express()
// Base64 data URLs are bulky even after compression; 12 MB is ample headroom.
app.use(express.json({ limit: '12mb' }))
// Recorded questions arrive as raw audio (webm/opus from MediaRecorder).
app.use('/api/transcribe', express.raw({ type: 'audio/*', limit: '12mb' }))

const corpus = new Corpus(CORPUS_DIR)

const apiKey = process.env['OPENAI_API_KEY']
const openai = apiKey ? new OpenAI({ apiKey }) : null
// Ollama ignores the key but the SDK insists on one.
const local = LOCAL_URL ? new OpenAI({ baseURL: LOCAL_URL, apiKey: 'ollama' }) : null

interface HandFramePayload {
  t_ms: number
  handedness: 'left' | 'right'
  confidence: number
  palm: { x: number; y: number; z: number }
  palm_velocity: { x: number; y: number; z: number }
  pinch: number
}

let latestHandFrame: HandFramePayload | null = null
let latestHandReceivedAt = 0

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    openai_key_present: Boolean(apiKey),
    local_endpoint: LOCAL_URL ?? null,
    local_model: LOCAL_URL ? LOCAL_MODEL : null,
    local_timeout_ms: LOCAL_URL ? LOCAL_TIMEOUT_MS : null,
    text_model: LOCAL_URL ? TEXT_MODEL : null,
    deepgram: Boolean(DEEPGRAM_KEY),
    corpus: { books: corpus.books, chunks: corpus.size },
  })
})

/**
 * Write a new problem with the local model and return it as a validated
 * ProblemSpec — the same shape a photo produces, so the app loads it through
 * the same path. Structured output means the statement and its numbers
 * cannot disagree: the model writes both in one reply.
 */
app.post('/api/generate', async (req, res) => {
  const started = Date.now()
  if (!local) {
    res.status(503).json({ error: 'No local model configured (EXTRACT_LOCAL_URL); problem generation runs on the GX10.' })
    return
  }
  const type = pickType((req.body as { problem_type?: unknown })?.problem_type as string | undefined)
  const { system, user, setting } = generatePrompt(type)
  // Two tries: a creative temperature occasionally produces a spec the
  // validator rejects (a missing required field), and a second draft is
  // cheaper than a "try again" button.
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await local.chat.completions.create(
        {
          model: TEXT_MODEL,
          temperature: 0.9,
          response_format: RESPONSE_FORMAT,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
        { timeout: TEXT_TIMEOUT_MS, maxRetries: 0 },
      )
      const text = completion.choices[0]?.message?.content
      if (!text) throw new Error(`${TEXT_MODEL} returned an empty response`)
      const result = validateSpec(JSON.parse(text))
      if (!result.ok || !result.spec) {
        lastError = result.errors.join('; ')
        continue
      }
      // The model chose the type; the request did. Trust the request.
      if (result.spec.problem_type !== type) {
        lastError = `model wrote a ${result.spec.problem_type} problem instead of ${type}`
        continue
      }
      res.json({ ...result, source: 'local' as const, setting, elapsed_ms: Date.now() - started })
      return
    } catch (err) {
      lastError = `${TEXT_MODEL} at ${LOCAL_URL}: ${(err as Error).message}`
      console.warn(`generate attempt ${attempt + 1} failed: ${lastError}`)
    }
  }
  res.status(502).json({ error: `could not generate a ${type.replace(/_/g, ' ')} problem — ${lastError}` })
})

/**
 * Answer a visitor's question with the local model, grounded in the textbook
 * passages that match it and in the problem currently on screen.
 */
app.post('/api/ask', async (req, res) => {
  const started = Date.now()
  const body = req.body as { question?: unknown; context?: { raw_text?: string; solutions?: string[] } }
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) {
    res.status(400).json({ error: 'body.question must be a non-empty string' })
    return
  }
  if (!local) {
    res.status(503).json({ error: 'No local model configured (EXTRACT_LOCAL_URL); questions are answered on the GX10.' })
    return
  }
  const passages = corpus.search(question, 4)
  const parts: string[] = []
  if (body.context?.raw_text) {
    parts.push(`The problem on screen right now:\n${body.context.raw_text}`)
    if (body.context.solutions?.length) parts.push(`Its worked answers:\n${body.context.solutions.join('\n')}`)
  }
  if (passages.length) {
    parts.push(
      'Textbook passages that may help:\n' +
        passages.map((p) => `[${p.section}]\n${p.text}`).join('\n\n'),
    )
  }
  parts.push(`The visitor asks: ${question}`)
  try {
    const completion = await local.chat.completions.create(
      {
        model: TEXT_MODEL,
        temperature: 0.3,
        max_tokens: 320,
        messages: [
          { role: 'system', content: TUTOR_SYSTEM },
          { role: 'user', content: parts.join('\n\n') },
        ],
      },
      { timeout: TEXT_TIMEOUT_MS, maxRetries: 0 },
    )
    const answer = completion.choices[0]?.message?.content?.trim()
    if (!answer) throw new Error(`${TEXT_MODEL} returned an empty response`)
    res.json({
      question,
      answer,
      // Distinct sections, for the attribution line; the licence asks for it
      // and a visitor may want to read more.
      sources: [...new Set(passages.map((p) => `${p.book} — ${p.section}`))],
      elapsed_ms: Date.now() - started,
    })
  } catch (err) {
    res.status(502).json({ error: `${TEXT_MODEL} at ${LOCAL_URL}: ${(err as Error).message}` })
  }
})

/**
 * Speech to text through Deepgram. The key never leaves this process: the
 * browser posts the recording here and gets words back.
 */
app.post('/api/transcribe', async (req, res) => {
  const started = Date.now()
  if (!DEEPGRAM_KEY) {
    res.status(503).json({ error: 'No DEEPGRAM_API_KEY in .env — type the question instead.' })
    return
  }
  const audio = req.body as Buffer
  if (!Buffer.isBuffer(audio) || audio.length < 1000) {
    res.status(400).json({ error: 'body must be the recorded audio (audio/webm)' })
    return
  }
  const url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(DEEPGRAM_MODEL)}&smart_format=true&language=en`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const dg = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Token ${DEEPGRAM_KEY}`, 'Content-Type': req.headers['content-type'] ?? 'audio/webm' },
      body: new Uint8Array(audio),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!dg.ok) throw new Error(`Deepgram ${dg.status}: ${(await dg.text()).slice(0, 200)}`)
    const data = (await dg.json()) as {
      results?: { channels?: { alternatives?: { transcript?: string; confidence?: number }[] }[] }
    }
    const best = data.results?.channels?.[0]?.alternatives?.[0]
    res.json({ text: best?.transcript ?? '', confidence: best?.confidence ?? 0, elapsed_ms: Date.now() - started })
  } catch (err) {
    res.status(502).json({ error: `transcription failed: ${(err as Error).message}` })
  }
})

app.get('/api/hand/frame', (_req, res) => {
  res.setHeader('cache-control', 'no-store')
  res.json(Date.now() - latestHandReceivedAt < 350 ? latestHandFrame : null)
})

app.post('/api/hand/frame', (req, res) => {
  const frame = req.body as Partial<HandFramePayload>
  if (
    !frame ||
    typeof frame !== 'object' ||
    typeof frame.t_ms !== 'number' ||
    (frame.handedness !== 'left' && frame.handedness !== 'right') ||
    typeof frame.confidence !== 'number' ||
    typeof frame.pinch !== 'number' ||
    !frame.palm ||
    !frame.palm_velocity
  ) {
    res.status(400).json({ error: 'invalid hand frame' })
    return
  }
  latestHandFrame = frame as HandFramePayload
  latestHandReceivedAt = Date.now()
  res.status(204).end()
})

/** The one request shape both backends accept. */
function extractionRequest(image: string) {
  return {
    // Deterministic extraction: same photo should give the same spec.
    temperature: 0,
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: USER_PROMPT },
          // 'high' detail: these are printed textbook pages and the numbers
          // are small. Low detail loses decimal points and exponents.
          { type: 'image_url' as const, image_url: { url: image, detail: 'high' as const } },
        ],
      },
    ],
  }
}

/**
 * Try the on-device GX10 first, but never wait on it past the timeout.
 *
 * Returns the parsed spec, or the reason it could not: on the all-local demo
 * there is no hosted fallback, and "set OPENAI_API_KEY" is the wrong thing to
 * tell an operator whose real problem is that Ollama is down or the model is
 * still loading.
 */
async function tryLocal(image: string): Promise<{ raw: unknown } | { error: string }> {
  if (!local) return { error: 'no local endpoint configured (EXTRACT_LOCAL_URL)' }
  try {
    const completion = await local.chat.completions.create(
      { model: LOCAL_MODEL, ...extractionRequest(image) },
      { timeout: LOCAL_TIMEOUT_MS, maxRetries: 0 },
    )
    const text = completion.choices[0]?.message?.content
    if (!text) return { error: `${LOCAL_MODEL} returned an empty response` }
    return { raw: JSON.parse(text) as unknown }
  } catch (err) {
    // Timeout, refused, model not loaded, malformed JSON: fall through to the
    // hosted API. Log it so a silently-dead GX10 is visible in the api pane.
    const message = `${LOCAL_MODEL} at ${LOCAL_URL}: ${(err as Error).message}`
    console.warn(`local extraction failed, falling back: ${message}`)
    return { error: message }
  }
}

app.post('/api/extract', async (req, res) => {
  const started = Date.now()
  const image = (req.body as { image?: unknown })?.image

  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    res.status(400).json({ error: 'body.image must be a data:image/... URL' })
    return
  }

  let source: 'local' | 'openai' = 'local'
  const attempt = await tryLocal(image)
  let raw: unknown = 'raw' in attempt ? attempt.raw : null

  if (!('raw' in attempt)) {
    source = 'openai'
    if (!openai) {
      // Name the backend that actually failed. Only mention the hosted key
      // when hosted extraction was ever the plan (a local endpoint is set).
      res.status(503).json({
        error: local
          ? `local extraction failed — ${attempt.error}. No OPENAI_API_KEY to fall back to.`
          : 'No extraction backend configured. Set EXTRACT_LOCAL_URL (GX10 Ollama) or OPENAI_API_KEY in .env (see .env.example).',
      })
      return
    }
    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        ...extractionRequest(image),
      })
      const text = completion.choices[0]?.message?.content
      if (!text) throw new Error('model returned an empty response')
      raw = JSON.parse(text)
    } catch (err) {
      res.status(502).json({ error: `extraction failed: ${(err as Error).message}` })
      return
    }
  }

  // Shape is guaranteed by the schema; physical sanity is not. Gate it.
  const result = validateSpec(raw)
  res.json({
    ...result,
    source,
    elapsed_ms: Date.now() - started,
  })
})

app.listen(PORT, () => {
  console.log(`extract API on http://localhost:${PORT}`)
  console.log(`  model            ${MODEL}`)
  console.log(`  OPENAI_API_KEY   ${apiKey ? 'present' : 'MISSING — see .env.example'}`)
  console.log(`  local endpoint   ${LOCAL_URL ? `${LOCAL_URL} (${LOCAL_MODEL}, ${LOCAL_TIMEOUT_MS} ms)` : 'none (set EXTRACT_LOCAL_URL for the GX10)'}`)
  console.log(`  text model       ${LOCAL_URL ? TEXT_MODEL : 'n/a'} (generate + ask)`)
  console.log(`  deepgram         ${DEEPGRAM_KEY ? `key present (${DEEPGRAM_MODEL})` : 'no key — Ask box is typed only'}`)
  console.log(`  corpus           ${corpus.size ? `${corpus.size} passages from ${corpus.books.join(', ')}` : 'empty — see corpus/README.md'}`)
})
