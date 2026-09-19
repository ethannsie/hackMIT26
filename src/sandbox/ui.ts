/**
 * Sandbox mode controller: palette, placement, inspector, conservation panel.
 *
 * Editing model, and it is the thing that keeps the sandbox honest: the scene
 * spec is the AUTHORED initial state, and the world is rebuilt from it on every
 * edit. Nothing mutates a running simulation. That means any scene can be
 * replayed exactly, a slider change is always reproducible, and Reset always
 * returns to something real rather than to wherever the bodies happened to be.
 */
import { SandboxWorld } from './world.ts'
import { InvariantTracker, type Invariants } from './invariants.ts'
import { loadPreset, SANDBOX_PRESETS } from './presets.ts'
import { FIELDS, HINTS, ICONS, LABELS, makeEntity, nextId } from './palette.ts'
import { ENTITY_KINDS, isStaticKind, type Entity, type EntityKind, type SandboxScene } from './types.ts'
import { SandboxView } from '../render/sandbox-canvas.ts'

export class SandboxMode {
  private scene: SandboxScene
  private world: SandboxWorld
  private view: SandboxView
  private tracker = new InvariantTracker()

  private armed: EntityKind | null = null
  private selectedId: string | null = null
  private cursor: [number, number] | null = null

  /** Drag state. Editing when paused, throwing when running. */
  private dragging: { id: string; throwing: boolean } | null = null
  private lastDrag: { x: number; y: number; t: number } | null = null
  private panning: { x: number; y: number } | null = null
  private dragVelocity: [number, number] = [0, 0]

  constructor(
    private canvas: HTMLCanvasElement,
    private aside: HTMLElement,
    private setStatus: (text: string, tone?: 'ok' | 'warn' | 'error') => void,
    /** Called with a label just before any destructive edit, for the rollback buffer. */
    private beforeChange: (label: string) => void = () => {},
  ) {
    this.scene = loadPreset('chain_reaction')
    this.world = new SandboxWorld(this.scene)
    this.view = new SandboxView(canvas)
  }

  // --- lifecycle ----------------------------------------------------------

  start(): void {
    this.canvas.addEventListener('mousedown', this.onDown)
    this.canvas.addEventListener('mousemove', this.onMove)
    window.addEventListener('mouseup', this.onUp)
    this.canvas.addEventListener('mouseleave', this.onLeave)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('contextmenu', this.onContext)
    window.addEventListener('keydown', this.onKey)
    // Frame the arena on entry, so its walls and extent are visible rather than
    // off-screen at whatever zoom was left behind.
    this.view.fit(this.scene.arena)
    this.renderPanel()
    this.setStatus('click a component to add · drag to move · wheel zooms · space pauses')
  }

  stop(): void {
    this.canvas.removeEventListener('mousedown', this.onDown)
    this.canvas.removeEventListener('mousemove', this.onMove)
    window.removeEventListener('mouseup', this.onUp)
    this.canvas.removeEventListener('mouseleave', this.onLeave)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('contextmenu', this.onContext)
    window.removeEventListener('keydown', this.onKey)
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.view.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1)
  }

  private onContext = (e: MouseEvent): void => {
    e.preventDefault()
  }

  /** Rebuild from the authored scene. Every edit goes through here. */
  private rebuild(): void {
    this.world.dispose()
    this.world = new SandboxWorld(this.scene)
    this.tracker.reset()
    this.reportedEscape = false
  }

  reset(): void {
    this.rebuild()
    this.renderPanel()
  }

  /** Advance exactly one fixed step, for frame-by-frame inspection. */
  stepOnce(): void {
    this.world.step()
  }

  /**
   * The body the motion graphs should plot: the selection when it can move,
   * otherwise the first movable component in the scene.
   */
  trackedState(): { id: string; t_s: number; position_m: [number, number]; velocity_ms: [number, number] } | null {
    const states = this.world.states()
    if (states.length === 0) return null
    const picked = states.find((s) => s.id === this.selectedId) ?? states[0]!
    return {
      id: picked.id,
      t_s: this.world.time_s,
      position_m: picked.position_m,
      velocity_ms: picked.velocity_ms,
    }
  }

  /** A copy of the authored scene, for a rollback snapshot. */
  snapshotScene(): SandboxScene {
    return structuredClone(this.scene)
  }

  get steps(): number {
    return this.world.steps
  }

  get simTime(): number {
    return this.world.time_s
  }

  /**
   * Put a previous scene back and replay it to where it was.
   *
   * Replaying is exact: the world is a pure function of the scene and the step
   * count. The replay is capped so restoring a long-running scene cannot lock
   * the page for seconds.
   */
  restoreScene(scene: SandboxScene, steps: number): void {
    this.scene = structuredClone(scene)
    this.selectedId = null
    this.armed = null
    this.rebuild()
    this.world.stepMany(Math.min(steps, 20_000))
    this.renderPanel()
  }

  /** Frame the arena. */
  fitView(): void {
    this.view.fit(this.scene.arena)
  }

  /** Copy the selection, offset so it is visible and immediately selected. */
  duplicateSelection(): void {
    const entity = this.scene.entities.find((x) => x.id === this.selectedId)
    if (!entity) return
    this.beforeChange(`before duplicating ${entity.id}`)
    const copy = structuredClone(entity) as Entity
    copy.id = nextId(entity.kind)
    copy.position_m = [entity.position_m[0] + 0.4, entity.position_m[1] + 0.4]
    this.scene.entities.push(copy)
    this.selectedId = copy.id
    this.rebuild()
    this.renderPanel()
    this.setStatus(`duplicated ${LABELS[entity.kind]}`)
  }

  frame(elapsedMs: number, running: boolean): void {
    if (running && !this.dragging) {
      this.world.advanceWith(elapsedMs, () => [])
    }
    this.view.draw(this.world, this.selectedId, this.armed, this.cursor)
    this.renderInvariants(this.tracker.sample(this.world))

    if (this.world.escaped.size > 0 && !this.reportedEscape) {
      this.reportedEscape = true
      this.setStatus(`${[...this.world.escaped].join(', ')} left the arena and was parked`, 'warn')
    }
  }

  private reportedEscape = false

  // --- interaction --------------------------------------------------------

  private onDown = (e: MouseEvent): void => {
    if (e.button === 1 || e.button === 2) {
      this.panning = { x: e.clientX, y: e.clientY }
      return
    }
    const at = this.view.toScene(e.clientX, e.clientY)

    if (this.armed) {
      this.beforeChange(`before placing ${LABELS[this.armed]}`)
      const entity = makeEntity(this.armed, at)
      this.scene.entities.push(entity)
      this.selectedId = entity.id
      this.armed = null
      this.rebuild()
      this.renderPanel()
      this.setStatus(`placed ${LABELS[entity.kind]}`)
      return
    }

    const hit = this.view.pick(this.world, at)
    this.selectedId = hit?.id ?? null
    this.renderPanel()

    if (hit && !isStaticKind(hit.kind)) {
      // Running: this is a grab, and releasing throws. Paused: this moves the
      // component's authored position.
      this.dragging = { id: hit.id, throwing: this.world.steps > 0 }
      this.lastDrag = { x: at[0], y: at[1], t: performance.now() }
      this.dragVelocity = [0, 0]
    } else if (hit) {
      this.dragging = { id: hit.id, throwing: false }
      this.lastDrag = { x: at[0], y: at[1], t: performance.now() }
    }
  }

  private onMove = (e: MouseEvent): void => {
    if (this.panning) {
      this.view.pan(e.clientX - this.panning.x, e.clientY - this.panning.y)
      this.panning = { x: e.clientX, y: e.clientY }
      return
    }
    const at = this.view.toScene(e.clientX, e.clientY)
    this.cursor = at
    if (!this.dragging) return

    const now = performance.now()
    if (this.lastDrag) {
      const dt = (now - this.lastDrag.t) / 1000
      if (dt > 0.004) {
        this.dragVelocity = [(at[0] - this.lastDrag.x) / dt, (at[1] - this.lastDrag.y) / dt]
        this.lastDrag = { x: at[0], y: at[1], t: now }
      }
    }

    if (this.dragging.throwing) {
      // Move the live body; the authored scene is left alone.
      this.world.setPositionM(this.dragging.id, at)
      this.world.setVelocityMs(this.dragging.id, [0, 0])
    } else {
      // Edit the authored position and rebuild, so the change is reproducible.
      const entity = this.scene.entities.find((x) => x.id === this.dragging!.id)
      if (entity) {
        this.beforeChange(`before moving ${entity.id}`)
        entity.position_m = at
        this.rebuild()
      }
    }
  }

  private onUp = (): void => {
    this.panning = null
    if (this.dragging?.throwing) {
      // Release velocity is the measured drag velocity. Same rule the hand uses.
      this.world.setVelocityMs(this.dragging.id, this.dragVelocity)
      const speed = Math.hypot(...this.dragVelocity)
      if (speed > 0.1) this.setStatus(`released at ${speed.toFixed(2)} m/s`)
    }
    this.dragging = null
    this.lastDrag = null
  }

  private onLeave = (): void => {
    this.cursor = null
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.armed = null
      this.selectedId = null
      this.renderPanel()
      return
    }
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
      e.preventDefault()
      this.beforeChange(`before deleting ${this.selectedId}`)
      this.scene.entities = this.scene.entities.filter((x) => x.id !== this.selectedId)
      this.selectedId = null
      this.rebuild()
      this.renderPanel()
      return
    }
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault()
      this.duplicateSelection()
      return
    }
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      this.fitView()
      this.setStatus('view fitted to the arena')
    }
  }

  // --- panel --------------------------------------------------------------

  private renderPanel(): void {
    this.aside.innerHTML = ''

    // Scene presets.
    const presets = document.createElement('div')
    presets.className = 'sb-block'
    presets.innerHTML = '<h4>Scene</h4>'
    const select = document.createElement('select')
    select.innerHTML = Object.entries(SANDBOX_PRESETS)
      .map(([k, v]) => `<option value="${k}">${v.name}</option>`)
      .join('')
    select.value =
      Object.entries(SANDBOX_PRESETS).find(([, v]) => v.name === this.scene.name)?.[0] ?? 'blank'
    select.addEventListener('change', () => {
      this.beforeChange('before scene change')
      this.scene = loadPreset(select.value)
      this.selectedId = null
      this.rebuild()
      this.view.fit(this.scene.arena)
      this.renderPanel()
      this.setStatus(`loaded ${this.scene.name}`)
    })
    presets.appendChild(select)

    presets.appendChild(
      this.slider('gravity (m/s²)', this.scene.gravity_ms2, 0, 25, 0.1, (v) => {
        this.beforeChange('before gravity change')
        this.scene.gravity_ms2 = v
        this.rebuild()
      }),
    )

    const groundRow = document.createElement('label')
    groundRow.className = 'sb-check'
    groundRow.innerHTML = '<span>ground</span>'
    const groundBox = document.createElement('input')
    groundBox.type = 'checkbox'
    groundBox.checked = this.scene.ground
    groundBox.addEventListener('change', () => {
      this.scene.ground = groundBox.checked
      this.rebuild()
      this.renderPanel()
    })
    groundRow.appendChild(groundBox)
    presets.appendChild(groundRow)
    this.aside.appendChild(presets)

    // Palette.
    const palette = document.createElement('div')
    palette.className = 'sb-block'
    palette.innerHTML = '<h4>Add a component</h4>'
    const grid = document.createElement('div')
    grid.className = 'sb-palette'
    for (const kind of ENTITY_KINDS) {
      const btn = document.createElement('button')
      btn.className = 'sb-chip' + (this.armed === kind ? ' armed' : '')
      btn.innerHTML = `<span class="ico">${ICONS[kind]}</span>${LABELS[kind]}`
      btn.title = HINTS[kind]
      btn.addEventListener('click', () => {
        this.armed = this.armed === kind ? null : kind
        this.renderPanel()
        this.setStatus(this.armed ? `click the canvas to place a ${LABELS[kind]}` : 'cancelled')
      })
      grid.appendChild(btn)
    }
    palette.appendChild(grid)
    this.aside.appendChild(palette)

    // Inspector for the selection.
    const entity = this.scene.entities.find((x) => x.id === this.selectedId)
    if (entity) {
      const box = document.createElement('div')
      box.className = 'sb-block'
      box.innerHTML = `<h4>${ICONS[entity.kind]} ${LABELS[entity.kind]} <code>${entity.id}</code></h4>
        <p class="sb-hint">${HINTS[entity.kind]}</p>`

      for (const f of FIELDS[entity.kind]) {
        const rec = entity as unknown as Record<string, number>
        const value = rec[f.key]
        if (typeof value !== 'number') continue
        box.appendChild(
          this.slider(f.label, value, f.min, f.max, f.step, (v) => {
            this.beforeChange(`before ${entity.id} ${f.label} change`)
            rec[f.key] = v
            this.rebuild()
          }),
        )
      }

      // Initial velocity is a vector, so it gets its own pair.
      if (entity.kind === 'ball' || entity.kind === 'box') {
        const ent = entity
        box.appendChild(
          this.slider('start vx (m/s)', ent.velocity_ms[0], -8, 8, 0.1, (v) => {
            ent.velocity_ms = [v, ent.velocity_ms[1]]
            this.rebuild()
          }),
        )
        box.appendChild(
          this.slider('start vy (m/s)', ent.velocity_ms[1], -8, 8, 0.1, (v) => {
            ent.velocity_ms = [ent.velocity_ms[0], v]
            this.rebuild()
          }),
        )
      }

      const del = document.createElement('button')
      del.className = 'sb-delete'
      del.textContent = 'Delete component'
      del.addEventListener('click', () => {
        this.beforeChange(`before deleting ${entity.id}`)
        this.scene.entities = this.scene.entities.filter((x) => x.id !== entity.id)
        this.selectedId = null
        this.rebuild()
        this.renderPanel()
      })
      box.appendChild(del)
      this.aside.appendChild(box)
    } else {
      const empty = document.createElement('div')
      empty.className = 'sb-block sb-hint'
      empty.textContent =
        this.scene.entities.length === 0
          ? 'Empty scene. Add a component above.'
          : 'Click a component to edit it. Delete removes it.'
      this.aside.appendChild(empty)
    }

    // Conservation panel, filled each frame.
    const laws = document.createElement('div')
    laws.className = 'sb-block'
    laws.id = 'sb-invariants'
    this.aside.appendChild(laws)
  }

  private slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('label')
    row.className = 'knob'
    row.innerHTML = `<span>${label}</span><output>${value}</output>`
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    const out = row.querySelector('output')!
    input.addEventListener('input', () => {
      const v = Number(input.value)
      out.textContent = String(v)
      onChange(v)
    })
    row.appendChild(input)
    return row
  }

  private renderInvariants(inv: Invariants): void {
    const el = this.aside.querySelector('#sb-invariants')
    if (!el) return

    const fmt = (v: number, d = 2): string => (Number.isFinite(v) ? v.toFixed(d) : '—')

    const rows = inv.laws
      .map((law) => {
        // A law the scene permits should hold: drift is then a real measurement
        // of solver quality. A law the scene breaks is expected to drift, so
        // showing a red number there would be teaching the wrong thing.
        const holding = Math.abs(law.drift_pct) < 1
        const verdict = law.expected
          ? holding
            ? 'holds'
            : `drifting ${fmt(law.drift_pct, 1)}%`
          : 'not expected here'
        const cls = law.expected ? (holding ? 'ok' : 'bad') : 'muted'
        return `<div class="law ${cls}">
          <div class="law-head"><span>${law.name}</span><span class="law-verdict">${verdict}</span></div>
          <div class="law-val">${fmt(law.current, 3)} ${law.unit}<span class="law-init">from ${fmt(law.initial, 3)}</span></div>
          ${law.reasons.length ? `<ul class="law-why">${law.reasons.slice(0, 4).map((r) => `<li>${r}</li>`).join('')}</ul>` : ''}
        </div>`
      })
      .join('')

    el.innerHTML = `<h4>Conserved quantities</h4>
      <p class="sb-hint">No closed form exists once components interact. These hold regardless — when the scene permits them.</p>
      <div class="energy-split">
        <span>KE <b>${fmt(inv.kinetic_j)}</b> J</span>
        <span>PE<sub>g</sub> <b>${fmt(inv.potential_gravity_j)}</b> J</span>
        <span>PE<sub>spring</sub> <b>${fmt(inv.potential_spring_j)}</b> J</span>
      </div>
      ${rows}`
  }
}
