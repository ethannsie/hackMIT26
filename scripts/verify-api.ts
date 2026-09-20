import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { PRESETS } from '../src/presets.ts'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let installed = true, stall = false, lastPrompt = ''
const backend = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.url === '/api/tags') { res.end(JSON.stringify({ models: installed ? [{ name: 'vision:latest' }, { name: 'text:latest' }] : [] })); return }
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  if (stall) await delay(500)
  lastPrompt = JSON.stringify(body.messages)
  if (body.format) {
    const spec = { ...PRESETS.projectile, given: { ...PRESETS.projectile.given, launch_angle_deg: 30 }, raw_text: 'Launched horizontally at 30 m/s.' }
    res.end(JSON.stringify({ message: { content: JSON.stringify(spec) } }))
  } else res.end(JSON.stringify({ message: { content: 'A force changes momentum.' } }))
})
backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
const modelPort = (backend.address() as { port: number }).port
// The API accepts port zero and reports its actual bound address.
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(), env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', API_PORT: '0', API_BIND: '127.0.0.1', OPENAI_API_KEY: '', DEEPGRAM_API_KEY: '', EXTRACT_LOCAL_URL: `http://127.0.0.1:${modelPort}/v1`, EXTRACT_LOCAL_MODEL: 'vision', TEXT_LOCAL_MODEL: 'text', TEXT_LOCAL_TIMEOUT_MS: '1500', CORPUS_DIR: '/nonexistent-audit-corpus' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''; child.stdout.on('data', c => { output += String(c) }); child.stderr.on('data', c => { output += String(c) })
try {
  for (let i = 0; i < 200 && !output.match(/API listening on http:\/\/127.0.0.1:(\d+)/); i++) { if (child.exitCode !== null) throw new Error(output); await delay(25) }
  const port = output.match(/API listening on http:\/\/127.0.0.1:(\d+)/)?.[1]
  assert.ok(port, output)
  const base = `http://127.0.0.1:${port}`
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
  for (const solutions of [3, {}, 'bad', [1], Array(33).fill('x')]) {
    assert.equal((await post('/api/ask', { question: 'why?', context: { solutions } })).status, 400)
    assert.equal((await fetch(base + '/api/health')).status, 200)
  }
  for (const bad of [null, [], 'bad']) assert.equal((await post('/api/ask', bad)).status, 400)
  assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://evil.example' } })).status, 403)
  assert.equal((await fetch(base + '/api/ready')).status, 200)
  installed = false; assert.equal((await fetch(base + '/api/ready')).status, 503); installed = true
  const answer = await post('/api/ask', { question: 'why?', context: { raw_text: 'Original v = 12', current_givens: 'v0 = 7', solutions: ['speed = 7'] } })
  assert.equal(answer.status, 200); assert.ok(lastPrompt.includes('v0 = 7'))
  const generated = await (await post('/api/generate', { problem_type: 'projectile' })).json()
  assert.ok(generated.ok && generated.spec.raw_text.includes('30°') && !generated.spec.raw_text.includes('horizontally'))
  stall = true
  const jobs = [post('/api/ask', { question: 'one' }), post('/api/ask', { question: 'two' })]
  await delay(60); assert.equal((await post('/api/ask', { question: 'three' })).status, 429)
  await Promise.all(jobs)
  assert.equal((await fetch(base + '/api/health')).status, 200)
  console.log('PASS API malformed-body survival, origins, model readiness, current givens, generated prose and concurrency limits')
} finally {
  child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit')
  backend.closeAllConnections(); backend.close()
}
