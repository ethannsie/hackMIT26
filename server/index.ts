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

const PORT = Number(process.env['API_PORT'] ?? 8787)
const MODEL = process.env['OPENAI_MODEL'] ?? 'gpt-4o'
// Optional on-device backend: an OpenAI-compatible base URL, e.g. the GX10's
// Ollama at http://localhost:11434/v1 (see gx10/README.md).
const LOCAL_URL = process.env['EXTRACT_LOCAL_URL']
const LOCAL_MODEL = process.env['EXTRACT_LOCAL_MODEL'] ?? 'qwen3.8'
const LOCAL_TIMEOUT_MS = Number(process.env['EXTRACT_LOCAL_TIMEOUT_MS'] ?? 45_000)

const app = express()
// Base64 data URLs are bulky even after compression; 12 MB is ample headroom.
app.use(express.json({ limit: '12mb' }))

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
  })
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

/** Try the on-device GX10 first, but never wait on it past the timeout. */
async function tryLocal(image: string): Promise<unknown | null> {
  if (!local) return null
  try {
    const completion = await local.chat.completions.create(
      { model: LOCAL_MODEL, ...extractionRequest(image) },
      { timeout: LOCAL_TIMEOUT_MS, maxRetries: 0 },
    )
    const text = completion.choices[0]?.message?.content
    return text ? (JSON.parse(text) as unknown) : null
  } catch (err) {
    // Timeout, refused, model not loaded, malformed JSON: fall through to the
    // hosted API. Log it so a silently-dead GX10 is visible in the api pane.
    console.warn(`local extraction failed, falling back: ${(err as Error).message}`)
    return null
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
  let raw = await tryLocal(image)

  if (raw === null) {
    source = 'openai'
    if (!openai) {
      res.status(503).json({
        error: 'No extraction backend available. Set OPENAI_API_KEY in .env (see .env.example).',
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
})
