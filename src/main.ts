/**
 * App wiring: spec -> sim -> render -> derivation, with a hand source in the loop.
 *
 * The render loop never steps physics by a frame delta. It hands elapsed
 * wall-clock time to SimWorld.advance(), which converts it into whole fixed
 * steps. The hand is sampled once per fixed step so interaction is reproducible
 * at any frame rate.
 */
import 'katex/dist/katex.min.css'
import { SimWorld } from './sim/world.ts'
import { CanvasView } from './render/canvas.ts'
import { renderDerivation } from './render/derivation.ts'
import { HandCoupling, type CouplingState } from './hand/coupling.ts'
import { MockHandSource } from './hand/mock.ts'
import { extractFromImage } from './extract/client.ts'
import { PRESETS, KNOBS } from './presets.ts'
import { CONFIDENCE_FLOOR, PROBLEM_TYPES, type ProblemSpec, type ProblemType } from './spec/types.ts'

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`missing element: ${sel}`)
  return el
}

const canvas = $<HTMLCanvasElement>('#stage')
const panel = $<HTMLDivElement>('#derivation')
const knobsEl = $<HTMLDivElement>('#knobs')
const typeEl = $<HTMLSelectElement>('#problem-type')
const statusEl = $<HTMLDivElement>('#status')
const fileEl = $<HTMLInputElement>('#photo')

const view = new CanvasView(canvas)
const coupling = new HandCoupling()

let spec: ProblemSpec = PRESETS.inclined_plane
let world = new SimWorld(spec)
let repairs: string[] = []
let running = true

const hand = new MockHandSource({
  element: canvas,
  // Kept in step with the view so a mouse metre and a sim metre agree.
  metresPerPixel: 1 / view.pixelsPerMetre,
})
void hand.start()

function setStatus(text: string, tone: 'ok' | 'warn' | 'error' = 'ok'): void {
  statusEl.textContent = text
  statusEl.dataset['tone'] = tone
}

/** Swap in a new spec: rebuild the world, the sliders and the derivation. */
function load(next: ProblemSpec, nextRepairs: string[] = []): void {
  world.dispose()
  spec = next
  repairs = nextRepairs
  world = new SimWorld(spec)
  typeEl.value = spec.problem_type
  buildKnobs()
  refreshDerivation()
}

function refreshDerivation(): void {
  renderDerivation(panel, world.state().solutions, spec.raw_text, repairs)
}

/** Live parameter editing. Every change rebuilds the sim from the edited spec. */
function buildKnobs(): void {
  knobsEl.innerHTML = ''
  for (const knob of KNOBS[spec.problem_type]) {
    const value = spec.given[knob.key]
    if (typeof value !== 'number') continue

    const row = document.createElement('label')
    row.className = 'knob'
    row.innerHTML = `<span>${knob.label}</span><output>${value}</output>`

    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(knob.min)
    input.max = String(knob.max)
    input.step = String(knob.step)
    input.value = String(value)

    const out = row.querySelector('output')!
    input.addEventListener('input', () => {
      const v = Number(input.value)
      out.textContent = String(v)
      // Rebuild rather than mutate: the sim is a pure function of the spec, and
      // keeping it that way is what makes a run reproducible.
      const edited: ProblemSpec = { ...spec, given: { ...spec.given, [knob.key]: v } }
      world.dispose()
      spec = edited
      world = new SimWorld(spec)
      refreshDerivation()
    })

    row.appendChild(input)
    knobsEl.appendChild(row)
  }
}

// --- controls --------------------------------------------------------------
typeEl.innerHTML = PROBLEM_TYPES.map(
  (t) => `<option value="${t}">${t.replace(/_/g, ' ')}</option>`,
).join('')
typeEl.addEventListener('change', () => {
  load(PRESETS[typeEl.value as ProblemType])
  setStatus(`loaded preset: ${typeEl.value.replace(/_/g, ' ')}`)
})

$('#reset').addEventListener('click', () => {
  world.reset()
  setStatus('reset')
})
const playBtn = $<HTMLButtonElement>('#play')
playBtn.addEventListener('click', () => {
  running = !running
  playBtn.textContent = running ? 'Pause' : 'Play'
})

fileEl.addEventListener('change', async () => {
  const file = fileEl.files?.[0]
  if (!file) return
  setStatus('compressing and extracting…', 'warn')
  try {
    const result = await extractFromImage(file)
    const kb = (n: number): string => `${Math.round(n / 1024)} KB`
    const shrink = `${kb(result.image.originalBytes)} → ${kb(result.image.bytes)}`

    if (!result.ok || !result.spec) {
      setStatus(`extraction failed: ${result.errors.join('; ')} — pick a type manually`, 'error')
      return
    }
    load(result.spec, result.repairs)

    if (result.needsConfirmation) {
      setStatus(
        `low confidence (${result.spec.confidence.toFixed(2)} < ${CONFIDENCE_FLOOR}) — confirm the problem type above. ${shrink}, ${result.elapsed_ms} ms via ${result.source}`,
        'warn',
      )
    } else {
      setStatus(
        `${result.spec.problem_type.replace(/_/g, ' ')} at ${result.spec.confidence.toFixed(2)} confidence · ${shrink} · ${result.elapsed_ms} ms via ${result.source}`,
      )
    }
  } catch (err) {
    setStatus((err as Error).message, 'error')
  } finally {
    fileEl.value = ''
  }
})

// --- loop ------------------------------------------------------------------
let lastMs = performance.now()
let lastCoupling: CouplingState = {
  contact: false,
  penetration_m: 0,
  grabbedId: null,
  contactPoint_m: null,
  force: null,
}

function frame(nowMs: number): void {
  const elapsed = nowMs - lastMs
  lastMs = nowMs

  if (running) {
    // Sample the hand once per fixed step, not once per rendered frame.
    world.advanceWith(elapsed, () => {
      lastCoupling = coupling.update(world, hand.current())
      return lastCoupling.force ? [lastCoupling.force] : []
    })
  }

  view.draw(world, world.state(), lastCoupling)
  requestAnimationFrame(frame)
}

load(spec)
setStatus('ready — drag on the canvas to push, hold space to grab and throw')
requestAnimationFrame(frame)
