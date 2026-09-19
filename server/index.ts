/**
 * Local extraction API.
 *
 * Exists for one reason: the OpenAI key must never reach the browser. Vite
 * proxies /api here (see vite.config.ts), so the front end only ever talks to
 * localhost and never holds a credential.
 *
 * Per the plan's failure ladder (§12), this is rung 3 — the hosted-API path.
 * When the GX10 is up, point EXTRACT_LOCAL_URL at it and this falls back to
 * OpenAI on a 2 second timeout, so a stalled GX10 can never freeze a demo.
 */
import 'dotenv/config'
import express from 'express'
import OpenAI from 'openai'
import { RESPONSE_FORMAT } from '../src/spec/schema.ts'
import { validateSpec } from '../src/spec/validate.ts'
import { SYSTEM_PROMPT, USER_PROMPT } from './prompt.ts'

const PORT = Number(process.env['API_PORT'] ?? 8787)
const MODEL = process.env['OPENAI_MODEL'] ?? 'gpt-4o'
const LOCAL_URL = process.env['EXTRACT_LOCAL_URL'] // optional GX10 endpoint
const LOCAL_TIMEOUT_MS = 2000

const app = express()
// Base64 data URLs are bulky even after compression; 12 MB is ample headroom.
app.use(express.json({ limit: '12mb' }))

const apiKey = process.env['OPENAI_API_KEY']
const openai = apiKey ? new OpenAI({ apiKey }) : null

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    openai_key_present: Boolean(apiKey),
    local_endpoint: LOCAL_URL ?? null,
  })
})

/** Try the on-device GX10 first, but never wait on it. */
async function tryLocal(dataUrl: string): Promise<unknown | null> {
  if (!LOCAL_URL) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS)
  try {
    const r = await fetch(LOCAL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
      signal: controller.signal,
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null // timeout, refused, malformed — fall through to the hosted API
  } finally {
    clearTimeout(timer)
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
        // Deterministic extraction: same photo should give the same spec.
        temperature: 0,
        response_format: RESPONSE_FORMAT,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: USER_PROMPT },
              // 'high' detail: these are printed textbook pages and the numbers
              // are small. Low detail loses decimal points and exponents.
              { type: 'image_url', image_url: { url: image, detail: 'high' } },
            ],
          },
        ],
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
  console.log(`  local endpoint   ${LOCAL_URL ?? 'none (set EXTRACT_LOCAL_URL for the GX10)'}`)
})
