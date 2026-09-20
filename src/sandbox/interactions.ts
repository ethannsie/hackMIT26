/**
 * Does every component actually do something?
 *
 * The sandbox rule is that each element must interact with at least one
 * other: a pendulum's arc has to reach something, a rolling ball has to be on a
 * line that meets another body, a wall has to be in somebody's way. Guessing
 * that from geometry is fragile — whether an arc reaches a ball depends on the
 * start angle, the rod, the bob radius, and whatever knocked it first. So this
 * does not guess. It runs the authored scene ahead in a scratch world for a few
 * seconds and records which pairs of components Matter actually brought into
 * contact. Sensor regions count: a body crossing a field is being acted on.
 *
 * The same dry run yields each movable body's predicted path, which the view
 * draws while the scene is at rest, so the arc and the line of travel are
 * visible before anyone presses play.
 *
 * The scratch world is a separate SandboxWorld built from the same scene, so
 * the live one is never touched and determinism is unaffected.
 */
import Matter from 'matter-js'
import { FIXED_DT_S } from '../sim/units.ts'
import { SandboxWorld } from './world.ts'
import type { SandboxScene } from './types.ts'

const { Events } = Matter

/** How far ahead the dry run looks. Long enough for a slow roll to arrive. */
export const LOOKAHEAD_S = 10
/** Predicted-path sample spacing, in fixed steps. 6 = 20 samples per second. */
const PATH_EVERY = 6

export interface Contact {
  /** The other component. */
  id: string
  /** Sim time of the first contact, seconds. */
  at_s: number
}

export interface InteractionReport {
  /** Every component id in the scene, in scene order. */
  ids: string[]
  /** For each id, the components it touched during the dry run. */
  partners: Record<string, Contact[]>
  /** Components that touched nothing. Empty means the scene is allowed to run. */
  isolated: string[]
  /** Predicted positions for every movable component, in scene metres (y up). */
  paths: Record<string, { x: number; y: number }[]>
  /** How long the dry run covered, seconds. */
  horizon_s: number
}

/** Owning entity id for a body label: `spring_1_anchor` -> `spring_1`. */
function ownerOf(label: string, ids: ReadonlySet<string>): string | null {
  if (ids.has(label)) return label
  for (const suffix of ['_anchor', '_pivot']) {
    if (label.endsWith(suffix)) {
      const base = label.slice(0, -suffix.length)
      if (ids.has(base)) return base
    }
  }
  return null
}

export function checkInteractions(scene: SandboxScene, horizon_s = LOOKAHEAD_S): InteractionReport {
  const ids = scene.entities.map((e) => e.id)
  const idSet = new Set(ids)
  const partners: Record<string, Contact[]> = {}
  const paths: Record<string, { x: number; y: number }[]> = {}
  for (const id of ids) partners[id] = []

  if (ids.length === 0) return { ids, partners, isolated: [], paths, horizon_s }

  const world = new SandboxWorld(structuredClone(scene))
  const seen = new Set<string>()

  const record = (a: string, b: string, at_s: number): void => {
    if (a === b) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (seen.has(key)) return
    seen.add(key)
    partners[a]!.push({ id: b, at_s })
    partners[b]!.push({ id: a, at_s })
  }

  const onStart = (e: Matter.IEventCollision<Matter.Engine>): void => {
    for (const pair of e.pairs) {
      const a = ownerOf(pair.bodyA.label, idSet)
      const b = ownerOf(pair.bodyB.label, idSet)
      if (a && b) record(a, b, world.time_s)
    }
  }
  Events.on(world.engine, 'collisionStart', onStart)

  const steps = Math.round(horizon_s / FIXED_DT_S)
  const movable = world.components.filter((c) => c.main && !c.main.isStatic)
  for (const c of movable) paths[c.entity.id] = []

  try {
    for (let i = 0; i <= steps; i++) {
      if (i % PATH_EVERY === 0) {
        for (const s of world.states()) paths[s.id]?.push({ x: s.position_m[0], y: s.position_m[1] })
      }
      if (i === steps) break
      world.step()
    }
  } finally {
    Events.off(world.engine, 'collisionStart', onStart)
    world.dispose()
  }

  for (const id of ids) partners[id]!.sort((p, q) => p.at_s - q.at_s)
  const isolated = ids.filter((id) => partners[id]!.length === 0)
  return { ids, partners, isolated, paths, horizon_s }
}
