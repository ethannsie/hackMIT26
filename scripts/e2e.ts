/**
 * End-to-end check of the ingest pipeline against a real image.
 *
 * Usage: npx tsx scripts/e2e.ts <path-to-image>
 *
 * Runs the same path the browser does — /api/extract, validation, sim build —
 * and then compares the simulated motion against the closed form. Costs one
 * API call.
 */
import { readFileSync } from 'node:fs'
import { SimWorld } from '../src/sim/world.ts'
import type { ValidationResult } from '../src/spec/validate.ts'

const path = process.argv[2]
if (!path) {
  console.error('usage: npx tsx scripts/e2e.ts <image>')
  process.exit(1)
}

const bytes = readFileSync(path)
const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`
console.log(`image: ${path}  (${Math.round(bytes.length / 1024)} KB)`)

const res = await fetch('http://localhost:8787/api/extract', {
  method: 'POST',
  signal: AbortSignal.timeout(180_000),
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ image: dataUrl }),
})

const body = (await res.json()) as ValidationResult & { source: string; elapsed_ms: number; error?: string }
if (!res.ok) {
  console.error('FAILED:', body.error ?? JSON.stringify(body))
  process.exit(1)
}

console.log(`\nsource=${body.source}  ${body.elapsed_ms} ms  ok=${body.ok}  needsConfirmation=${body.needsConfirmation}`)
if (body.errors.length) console.log('errors:', body.errors)
if (body.repairs.length) console.log('repairs:', body.repairs)
if (!body.spec) process.exit(1)

console.log('\nextracted spec:')
console.log(JSON.stringify(body.spec, null, 2))

const world = new SimWorld(body.spec)
console.log('\nclosed-form answers:')
for (const s of world.state().solutions) {
  console.log(`  ${s.quantity.padEnd(22)} ${s.value.toFixed(4)} ${s.unit}`)
  if (s.caveat) console.log(`    note: ${s.caveat}`)
}

// Run the sim and compare where comparable.
console.log('\nsimulated:')
if (body.spec.problem_type === 'inclined_plane') {
  world.stepMany(30)
  const v0 = world.state().bodies['block']!.speed_ms
  const t0 = world.time_s
  world.stepMany(60)
  const v1 = world.state().bodies['block']!.speed_ms
  const a = (v1 - v0) / (world.time_s - t0)
  const expected = world.state().solutions.find((s) => s.quantity === 'acceleration_ms2')!.value
  const err = Math.abs(a - expected) / Math.max(Math.abs(expected), 1e-6) * 100
  console.log(`  acceleration  sim=${a.toFixed(4)}  analytic=${expected.toFixed(4)}  err=${err.toFixed(2)}%`)
  if (err >= 1 || !Number.isFinite(err)) process.exitCode = 1
  console.log(err < 1 ? '\nPipeline verified: photo -> spec -> sim agrees with the derivation.' : '\nMISMATCH between sim and derivation.')
} else {
  world.stepMany(240)
  console.log(`  after 2 s: ${JSON.stringify(world.state().focus.position_m.map((n) => Number(n.toFixed(3))))} m`)
}
