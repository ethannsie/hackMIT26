/**
 * App shell: mode switching, transport controls, motion graphs, keyboard.
 *
 * The render loop never steps physics by a frame delta. Elapsed wall-clock time
 * goes to `advanceWith`, which converts it into whole fixed steps, so a slow
 * frame produces the same trajectory as a fast one. The speed control scales the
 * elapsed time fed in, never the timestep itself.
 */
import 'katex/dist/katex.min.css'
import { SimWorld } from './sim/world.ts'
import { CanvasView } from './render/canvas.ts'
import { renderDerivation } from './render/derivation.ts'
import { MotionCharts, MotionRecorder } from './render/charts.ts'
import { HandCoupling, type CouplingState } from './hand/coupling.ts'
import { MockHandSource } from './hand/mock.ts'
import { extractFromImage } from './extract/client.ts'
import { PRESETS, KNOBS } from './presets.ts'
import { SandboxMode } from './sandbox/ui.ts'
import { History } from './history.ts'
import { Timeline } from './render/timeline.ts'
import { forcesFor } from './sim/fbd.ts'
import type { DrawOptions } from './render/canvas.ts'
import type { Sample } from './render/charts.ts'
import type { SandboxScene } from './sandbox/types.ts'
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
const sandboxAside = $<HTMLDivElement>('#sandbox-panel')
const problemAside = $<HTMLDivElement>('#problem-panel')
const modeEl = $<HTMLSelectElement>('#mode')
const speedEl = $<HTMLSelectElement>('#speed')
const playBtn = $<HTMLButtonElement>('#play')
const stepBtn = $<HTMLButtonElement>('#step')
const graphsBtn = $<HTMLButtonElement>('#graphs')
const drawer = $<HTMLElement>('#charts-drawer')
const chartCanvas = $<HTMLCanvasElement>('#charts')
const chartTarget = $<HTMLSpanElement>('#chart-target')
const helpEl = $<HTMLDivElement>('#help')
const undoBtn = $<HTMLButtonElement>('#undo')
const scrubEl = $<HTMLInputElement>('#scrub')
const scrubTime = $<HTMLSpanElement>('#scrub-time')
const scrubHint = $<HTMLSpanElement>('#scrub-hint')
const scrubBar = $<HTMLDivElement>('#scrub-bar')
const historyEl = $<HTMLSelectElement>('#history')

function setStatus(text: string, tone: 'ok' | 'warn' | 'error' = 'ok'): void {
  statusEl.textContent = text
  statusEl.dataset['tone'] = tone
}

const view = new CanvasView(canvas)
const coupling = new HandCoupling()
const recorder = new MotionRecorder()
const charts = new MotionCharts(chartCanvas)
// Sandbox asks us to snapshot before it changes anything, so placing, deleting
// and slider edits are all undoable through the same buffer.
const sandbox = new SandboxMode(
  canvas,
  sandboxAside,
  setStatus,
  (label) => remember(label),
  () => {
    // Rebuilding an authored scene returns it to t=0. Its old playback frames
    // cannot safely be applied to this new set of bodies.
    timeline.clear()
    recorder.clear(null)
  },
)

type Mode = 'problem' | 'sandbox'
let mode: Mode = 'problem'
let spec: ProblemSpec = PRESETS.inclined_plane
let world = new SimWorld(spec)
let repairs: string[] = []
let running = true
let showGraphs = false
let speed = 1

/**
 * Rollback buffer.
 *
 * Snapshots are cheap because the sim is deterministic: the spec (or scene) plus
 * a step count reproduces the run exactly, so nothing about the bodies is
 * stored. The recorded motion goes along for the ride so the graphs show the
 * restored run too.
 */
type Snap =
  | { kind: 'problem'; spec: ProblemSpec; repairs: string[]; steps: number; samples: Sample[]; tracked: string | null }
  | { kind: 'sandbox'; scene: SandboxScene; steps: number; samples: Sample[]; tracked: string | null }

const rollback = new History<Snap>()
const timeline = new Timeline()

/** Body the graphs and the free-body diagram follow. Null means the problem's own subject. */
let selectedId: string | null = null
let showForces = true

/** Capture the state as it is right now, before something destroys it. */
function remember(label: string): void {
  const samples = recorder.snapshot()
  const tracked = recorder.tracked
  if (mode === 'sandbox') {
    rollback.push(label, { kind: 'sandbox', scene: sandbox.snapshotScene(), steps: sandbox.steps, samples, tracked }, sandbox.simTime)
  } else {
    rollback.push(label, { kind: 'problem', spec, repairs: [...repairs], steps: world.steps, samples, tracked }, world.time_s)
  }
  refreshHistoryUi()
}

function restore(snap: Snap): void {
  timeline.clear()
  if (snap.kind === 'sandbox') {
    if (mode !== 'sandbox') setMode('sandbox')
    sandbox.restoreScene(snap.scene, snap.steps)
  } else {
    if (mode !== 'problem') setMode('problem')
    world.dispose()
    spec = snap.spec
    repairs = [...snap.repairs]
    world = new SimWorld(spec)
    // Deterministic replay: the same spec and step count is the same state.
    world.stepMany(Math.min(snap.steps, 20_000))
    typeEl.value = spec.problem_type
    buildKnobs()
    refreshDerivation()
  }
  recorder.restore(snap.samples, snap.tracked)
  recordFrame()
  setRunning(false)
  refreshHistoryUi()
}

function refreshHistoryUi(): void {
  const entries = rollback.list()
  undoBtn.disabled = entries.length === 0
  historyEl.disabled = entries.length === 0
  historyEl.innerHTML =
    `<option value="">History (${entries.length})</option>` +
    entries
      .map((e) => `<option value="${e.id}">${e.label} · t=${e.sim_time_s.toFixed(1)}s</option>`)
      .join('')
  historyEl.value = ''
}

const hand = new MockHandSource({
  element: canvas,
  metresPerPixel: 1 / view.pixelsPerMetre,
})

// --- problem mode ----------------------------------------------------------

function load(next: ProblemSpec, nextRepairs: string[] = []): void {
  world.dispose()
  spec = next
  repairs = nextRepairs
  world = new SimWorld(spec)
  recorder.clear(null)
  timeline.clear()
  selectedId = null
  recordFrame()
  typeEl.value = spec.problem_type
  buildKnobs()
  refreshDerivation()
}

function refreshDerivation(): void {
  renderDerivation(panel, world.state().solutions, spec.raw_text, repairs)
}

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
      // Coalesced inside History, so a whole drag is one undo step.
      remember(`before ${knob.label} change`)
      out.textContent = String(v)
      // Rebuild rather than mutate: the sim is a pure function of the spec, and
      // keeping it that way is what makes a run reproducible.
      const edited: ProblemSpec = { ...spec, given: { ...spec.given, [knob.key]: v } }
      world.dispose()
      spec = edited
      world = new SimWorld(spec)
      recorder.clear(null)
      timeline.clear()
      recordFrame()
      refreshDerivation()
    })

    row.appendChild(input)
    knobsEl.appendChild(row)
  }
}

// --- transport -------------------------------------------------------------

function setRunning(next: boolean): void {
  // Playing forward from a scrubbed frame makes that frame the new present:
  // everything after it is discarded, the way a tape works.
  if (next && timeline.scrubbing) {
    timeline.commitToCursor()
    setStatus('resumed from the scrubbed frame — later history discarded')
  }
  running = next
  playBtn.textContent = running ? '❚❚' : '▶'
  playBtn.title = running ? 'Pause (Space)' : 'Play (Space)'
  stepBtn.disabled = running
  refreshScrubber()
}

function stepOnce(): void {
  if (mode === 'sandbox') {
    sandbox.stepOnce()
    recordFrame()
    sampleMotion()
  }
  else {
    world.step(lastCoupling.force ? [lastCoupling.force] : [])
    recordFrame()
    sampleMotion()
  }
}

function resetAll(): void {
  remember('before reset')
  if (mode === 'sandbox') {
    sandbox.reset()
    timeline.clear()
    recorder.clear(null)
    recordFrame()
    setStatus('sandbox reset to the authored scene')
  } else {
    world.reset()
    recorder.clear(null)
    timeline.clear()
    recordFrame()
    setStatus('reset')
  }
}

function setGraphs(next: boolean): void {
  showGraphs = next
  drawer.hidden = !showGraphs
  graphsBtn.classList.toggle('on', showGraphs)
  scrubBar.classList.toggle('with-drawer', showGraphs)
}

function setMode(next: Mode): void {
  mode = next
  modeEl.value = next
  const inSandbox = mode === 'sandbox'
  problemAside.hidden = inSandbox
  sandboxAside.hidden = !inSandbox
  typeEl.hidden = inSandbox
  fileEl.parentElement!.hidden = inSandbox
  recorder.clear(null)
  timeline.clear()
  selectedId = null

  const hash = inSandbox ? '#sandbox' : ''
  if (window.location.hash !== hash) {
    window.history.replaceState(null, '', hash || window.location.pathname)
  }

  if (inSandbox) {
    hand.stop()
    sandbox.start()
    recordFrame()
  } else {
    sandbox.stop()
    void hand.start()
    recordFrame()
    setStatus('drag to push · hold shift to grab and throw · space pauses')
  }
}

// --- graphs ----------------------------------------------------------------

/** Snapshot every body this step, for scrubbing and path tracing. */
function recordFrame(): void {
  if (mode === 'sandbox') {
    const bodies: Record<string, import('./render/timeline.ts').BodyFrame> = {}
    for (const b of sandbox.bodyStates()) {
      bodies[b.id] = {
        x_m: b.position_m[0], y_m: b.position_m[1], angle_deg: b.angle_deg,
        vx_ms: b.velocity_ms[0], vy_ms: b.velocity_ms[1], omega_rads: 0,
      }
    }
    timeline.record(sandbox.steps, sandbox.simTime, bodies)
    return
  }
  const st = world.state()
  const bodies: Record<string, import('./render/timeline.ts').BodyFrame> = {}
  for (const [id, b] of Object.entries(st.bodies)) {
    if (b.mass_kg <= 0) continue // static scenery never moves
    bodies[id] = {
      x_m: b.position_m[0], y_m: b.position_m[1], angle_deg: b.angle_deg,
      vx_ms: b.velocity_ms[0], vy_ms: b.velocity_ms[1], omega_rads: b.angular_velocity_rads,
    }
  }
  timeline.record(world.steps, st.time_s, bodies)
}

/** Put the live bodies where a recorded frame says they were. */
function applyFrame(i: number): void {
  const frame = timeline.seek(i)
  if (!frame) return
  if (mode === 'sandbox') {
    sandbox.applyFrame(frame.bodies, frame.step)
  } else {
    for (const [id, f] of Object.entries(frame.bodies)) world.applyBodyState(id, f)
    world.steps = frame.step
    world.resyncCorrections()
  }
  scrubTime.textContent = `${frame.t_s.toFixed(2)} s`
  // Graphs follow the scrub position, so the plot and the scene agree.
  rebuildGraphHistory(i)
}

function refreshScrubber(): void {
  const n = timeline.length
  scrubEl.max = String(Math.max(0, n - 1))
  scrubEl.disabled = running || n < 2
  if (!timeline.scrubbing) {
    scrubEl.value = String(Math.max(0, n - 1))
    const f = timeline.current
    scrubTime.textContent = `${(f?.t_s ?? 0).toFixed(2)} s`
  }
  scrubHint.textContent = running
    ? 'press space to pause, then scrub'
    : n < 2
      ? 'no history yet'
      : timeline.scrubbing
        ? 'play resumes from here'
        : `${n} frames`
}

/** Rebuild the graph buffer from the timeline, up to a frame index. */
function rebuildGraphHistory(upTo: number): void {
  const id = activeBodyId()
  if (!id) {
    recorder.clear(null)
    return
  }
  recorder.clear(id)
  const frames = timeline.all
  const end = Math.min(upTo, frames.length - 1)
  for (let i = 0; i <= end; i++) {
    const b = frames[i]!.bodies[id]
    if (!b) continue
    recorder.push(id, frames[i]!.t_s, [b.x_m, b.y_m], [b.vx_ms, b.vy_ms])
  }
}

/** The body the graphs and the diagram are about. */
function activeBodyId(): string | null {
  if (mode === 'sandbox') return sandbox.selectedEntityId() ?? sandbox.firstMovableId()
  if (selectedId && world.bodyById(selectedId)) return selectedId
  return world.state().focus.id
}

function sampleMotion(): void {
  const id = activeBodyId()
  if (!id) {
    recorder.clear(null)
    return
  }
  if (mode === 'sandbox') {
    const b = sandbox.bodyStates().find((x) => x.id === id)
    if (b) recorder.push(id, sandbox.simTime, b.position_m, b.velocity_ms)
    return
  }
  const b = world.state().bodies[id]
  if (b) recorder.push(id, world.time_s, b.position_m, b.velocity_ms)
}

chartCanvas.addEventListener('mousemove', (e) => {
  const rect = chartCanvas.getBoundingClientRect()
  charts.hoverX = e.clientX - rect.left
})
chartCanvas.addEventListener('mouseleave', () => {
  charts.hoverX = null
})

// --- controls --------------------------------------------------------------

typeEl.innerHTML = PROBLEM_TYPES.map(
  (t) => `<option value="${t}">${t.replace(/_/g, ' ')}</option>`,
).join('')
typeEl.addEventListener('change', () => {
  remember('before problem change')
  load(PRESETS[typeEl.value as ProblemType])
  setStatus(`loaded ${typeEl.value.replace(/_/g, ' ')}`)
})

modeEl.addEventListener('change', () => setMode(modeEl.value as Mode))
speedEl.addEventListener('change', () => {
  speed = Number(speedEl.value)
})
playBtn.addEventListener('click', () => setRunning(!running))
undoBtn.addEventListener('click', undoOnce)

scrubEl.addEventListener('input', () => {
  if (running) setRunning(false)
  applyFrame(Number(scrubEl.value))
  refreshScrubber()
})

// Click a body to make the graphs and the diagram follow it.
canvas.addEventListener('mousedown', (e) => {
  if (mode !== 'problem') return
  const hit = view.pick(world, e.clientX, e.clientY)
  if (hit) {
    selectedId = hit
    rebuildGraphHistory(timeline.index)
    setStatus(`tracking ${hit}`)
  }
})
historyEl.addEventListener('change', () => {
  const id = Number(historyEl.value)
  if (!id) return
  const snap = rollback.take(id)
  if (snap) {
    restore(snap.payload)
    setStatus(`rolled back to "${snap.label}" at t = ${snap.sim_time_s.toFixed(1)} s`)
  }
})

function undoOnce(): void {
  const snap = rollback.pop()
  if (!snap) {
    setStatus('nothing to roll back to', 'warn')
    return
  }
  restore(snap.payload)
  setStatus(`rolled back: ${snap.label} (t = ${snap.sim_time_s.toFixed(1)} s)`)
}
stepBtn.addEventListener('click', stepOnce)
$('#reset').addEventListener('click', resetAll)
graphsBtn.addEventListener('click', () => setGraphs(!showGraphs))
$('#charts-close').addEventListener('click', () => setGraphs(false))
$('#help-open').addEventListener('click', () => {
  helpEl.hidden = false
})
$('#help-close').addEventListener('click', () => {
  helpEl.hidden = true
})
helpEl.addEventListener('click', (e) => {
  if (e.target === helpEl) helpEl.hidden = true
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
        `low confidence (${result.spec.confidence.toFixed(2)} < ${CONFIDENCE_FLOOR}) — confirm the type. ${shrink}, ${result.elapsed_ms} ms via ${result.source}`,
        'warn',
      )
    } else {
      setStatus(
        `${result.spec.problem_type.replace(/_/g, ' ')} · confidence ${result.spec.confidence.toFixed(2)} · ${shrink} · ${result.elapsed_ms} ms via ${result.source}`,
      )
    }
  } catch (err) {
    setStatus((err as Error).message, 'error')
  } finally {
    fileEl.value = ''
  }
})

// --- keyboard --------------------------------------------------------------

function typingInAField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')
}

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    undoOnce()
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return

  if (e.key === 'Escape') {
    if (!helpEl.hidden) {
      helpEl.hidden = true
      e.preventDefault()
    }
    return
  }
  if (typingInAField(e)) return

  switch (e.key) {
    case ' ':
      // Space pauses. Grab moved to Shift so the two never fight.
      e.preventDefault()
      setRunning(!running)
      break
    case '.':
    case '>':
      e.preventDefault()
      if (running) setRunning(false)
      stepOnce()
      break
    case 'r':
    case 'R':
      e.preventDefault()
      resetAll()
      break
    case 'g':
    case 'G':
      e.preventDefault()
      setGraphs(!showGraphs)
      break
    case 'v':
    case 'V':
      e.preventDefault()
      showForces = !showForces
      setStatus(showForces ? 'free-body diagram on' : 'free-body diagram off')
      break
    case 'ArrowLeft':
      e.preventDefault()
      if (running) setRunning(false)
      applyFrame(Math.max(0, timeline.index - 1))
      scrubEl.value = String(timeline.index)
      refreshScrubber()
      break
    case 'ArrowRight':
      e.preventDefault()
      if (running) setRunning(false)
      applyFrame(Math.min(timeline.length - 1, timeline.index + 1))
      scrubEl.value = String(timeline.index)
      refreshScrubber()
      break
    case '?':
      e.preventDefault()
      helpEl.hidden = !helpEl.hidden
      break
    default:
      break
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
  const raw = nowMs - lastMs
  lastMs = nowMs
  // Cap the delta so returning to a backgrounded tab does not fast-forward.
  const elapsed = Math.min(raw, 100) * speed

  const paths: Record<string, { x: number; y: number }[]> = {}
  for (const id of timeline.movingIds()) paths[id] = timeline.pathFor(id)

  // Selection can change while paused (notably in Sandbox). Rebuild from the
  // timeline immediately so the drawer never shows the last object's graph.
  if (recorder.tracked !== activeBodyId()) rebuildGraphHistory(timeline.index)

  if (mode === 'sandbox') {
    sandbox.lastPaths = paths
    sandbox.showForces = showForces
    sandbox.frame(elapsed, running)
    if (running) {
      recordFrame()
      sampleMotion()
    }
  } else {
    if (running) {
      world.advanceWith(elapsed, () => {
        lastCoupling = coupling.update(world, hand.current())
        return lastCoupling.force ? [lastCoupling.force] : []
      })
      recordFrame()
      sampleMotion()
    }

    const st = world.state()
    const activeId = activeBodyId()
    const activeState = activeId ? st.bodies[activeId] : undefined
    const opts: DrawOptions = {
      selectedId: activeId,
      paths,
      forces: showForces && activeState ? forcesFor(world.params, activeState) : [],
      showForces,
    }
    view.draw(world, st, lastCoupling, opts)

    if (world.escaped.size > 0) {
      setStatus(`${[...world.escaped].join(', ')} left the scene and was parked`, 'warn')
    }
  }

  refreshScrubber()

  if (showGraphs) {
    const label = recorder.tracked ?? '—'
    chartTarget.textContent = recorder.tracked ? `· ${label}` : ''
    charts.draw(recorder.data, label)
  }

  requestAnimationFrame(frame)
}

load(spec)
refreshHistoryUi()
setRunning(true)
setMode(window.location.hash === '#sandbox' ? 'sandbox' : 'problem')
requestAnimationFrame(frame)
