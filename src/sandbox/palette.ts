/**
 * The component palette: what you can place, and what you can change about it.
 *
 * `FIELDS` drives the inspector UI directly, so adding a knob to a component is
 * a one-line change here rather than a UI edit. Every field carries its unit in
 * its name, same rule as the ProblemSpec.
 */
import type { Entity, EntityKind } from './types.ts'

export interface Field {
  key: string
  label: string
  min: number
  max: number
  step: number
}

export const LABELS: Record<EntityKind, string> = {
  ball: 'Ball',
  box: 'Box',
  ramp: 'Ramp',
  wall: 'Wall (any angle)',
  wall_v: 'Vertical wall',
  pendulum: 'Pendulum',
  spring: 'Spring (hanging)',
  spring_h: 'Spring (horizontal)',
  magnet_region: 'Magnetic field',
}

export const ICONS: Record<EntityKind, string> = {
  ball: '●',
  box: '■',
  ramp: '◺',
  wall: '▞',
  wall_v: '▌',
  pendulum: '⊥',
  spring: '⌇',
  spring_h: '⟿',
  magnet_region: '⊗',
}

export const HINTS: Record<EntityKind, string> = {
  ball: 'Rolls, bounces, and curves inside a magnetic field if you give it charge.',
  box: 'Slides and tumbles. Friction and restitution decide how much energy survives.',
  ramp: 'Static surface. Balls roll down at any friction; a box only slides at friction 0.',
  wall: 'Static barrier at any angle. Bounces things back into the scene.',
  wall_v: 'Stands on the floor. Stops what rolls into it and sends it back.',
  pendulum: 'Pivot and bob on a rigid rod. Something can knock it.',
  spring: 'Hangs from its anchor. Real stiffness in N/m, so the period is genuinely 2π√(m/k).',
  spring_h: 'Lies along the floor with a block on the end: textbook SHM, and the block hits things.',
  magnet_region: 'Any charged body inside curves. Speed is never changed.',
}

/** Editable quantifiers per component. */
export const FIELDS: Record<EntityKind, Field[]> = {
  ball: [
    { key: 'mass_kg', label: 'mass (kg)', min: 0.1, max: 20, step: 0.1 },
    { key: 'radius_m', label: 'radius (m)', min: 0.02, max: 0.6, step: 0.01 },
    { key: 'restitution', label: 'bounciness', min: 0, max: 1, step: 0.05 },
    { key: 'friction', label: 'friction', min: 0, max: 1, step: 0.05 },
    { key: 'charge_c', label: 'charge (C)', min: -5, max: 5, step: 0.1 },
  ],
  box: [
    { key: 'mass_kg', label: 'mass (kg)', min: 0.1, max: 20, step: 0.1 },
    { key: 'width_m', label: 'width (m)', min: 0.05, max: 1.5, step: 0.05 },
    { key: 'height_m', label: 'height (m)', min: 0.05, max: 1.5, step: 0.05 },
    { key: 'angle_deg', label: 'angle (°)', min: -180, max: 180, step: 5 },
    { key: 'restitution', label: 'bounciness', min: 0, max: 1, step: 0.05 },
    { key: 'friction', label: 'friction', min: 0, max: 1, step: 0.05 },
    { key: 'charge_c', label: 'charge (C)', min: -5, max: 5, step: 0.1 },
  ],
  ramp: [
    { key: 'angle_deg', label: 'angle (°)', min: -80, max: 80, step: 1 },
    { key: 'length_m', label: 'length (m)', min: 0.2, max: 6, step: 0.1 },
    { key: 'friction', label: 'friction μ', min: 0, max: 1, step: 0.05 },
  ],
  wall: [
    { key: 'width_m', label: 'width (m)', min: 0.05, max: 4, step: 0.05 },
    { key: 'height_m', label: 'height (m)', min: 0.05, max: 4, step: 0.05 },
    { key: 'angle_deg', label: 'angle (°)', min: -90, max: 90, step: 5 },
    { key: 'restitution', label: 'bounciness', min: 0, max: 1, step: 0.05 },
    { key: 'friction', label: 'friction', min: 0, max: 1, step: 0.05 },
  ],
  wall_v: [
    { key: 'height_m', label: 'height (m)', min: 0.1, max: 5, step: 0.05 },
    { key: 'thickness_m', label: 'thickness (m)', min: 0.05, max: 1, step: 0.05 },
    { key: 'restitution', label: 'bounciness', min: 0, max: 1, step: 0.05 },
    { key: 'friction', label: 'friction', min: 0, max: 1, step: 0.05 },
  ],
  pendulum: [
    { key: 'length_m', label: 'rod length (m)', min: 0.2, max: 3, step: 0.05 },
    { key: 'bob_mass_kg', label: 'bob mass (kg)', min: 0.1, max: 20, step: 0.1 },
    { key: 'bob_radius_m', label: 'bob radius (m)', min: 0.03, max: 0.4, step: 0.01 },
    { key: 'start_angle_deg', label: 'start angle (°)', min: -150, max: 150, step: 5 },
  ],
  spring: [
    { key: 'stiffness_n_per_m', label: 'stiffness k (N/m)', min: 1, max: 400, step: 1 },
    { key: 'mass_kg', label: 'mass (kg)', min: 0.1, max: 20, step: 0.1 },
    { key: 'rest_length_m', label: 'rest length (m)', min: 0.1, max: 2, step: 0.05 },
    { key: 'start_extension_m', label: 'start stretch (m)', min: -1, max: 1, step: 0.05 },
    { key: 'bob_radius_m', label: 'bob radius (m)', min: 0.03, max: 0.4, step: 0.01 },
  ],
  spring_h: [
    { key: 'stiffness_n_per_m', label: 'stiffness k (N/m)', min: 1, max: 400, step: 1 },
    { key: 'mass_kg', label: 'block mass (kg)', min: 0.1, max: 20, step: 0.1 },
    { key: 'rest_length_m', label: 'rest length (m)', min: 0.1, max: 3, step: 0.05 },
    { key: 'start_extension_m', label: 'start stretch (m)', min: -1.5, max: 1.5, step: 0.05 },
    { key: 'block_size_m', label: 'block size (m)', min: 0.05, max: 1, step: 0.05 },
    { key: 'direction', label: 'direction (−1 left, +1 right)', min: -1, max: 1, step: 2 },
    { key: 'friction', label: 'block friction', min: 0, max: 1, step: 0.05 },
  ],
  magnet_region: [
    { key: 'width_m', label: 'width (m)', min: 0.3, max: 8, step: 0.1 },
    { key: 'height_m', label: 'height (m)', min: 0.3, max: 8, step: 0.1 },
    { key: 'b_field_tesla', label: 'B (T, +out of page)', min: -5, max: 5, step: 0.1 },
  ],
}

/**
 * The next free id for a kind, given the ids already in the scene.
 *
 * Presets author their own ids (`ball_1`), so a plain counter handed out
 * `ball_1` again and the two bodies became indistinguishable to everything
 * keyed by id — the interaction check merged them into one. Always derive
 * from what the scene already holds.
 */
export function nextId(kind: EntityKind, taken: Iterable<string>): string {
  let n = 0
  const prefix = `${kind}_`
  for (const id of taken) {
    if (!id.startsWith(prefix)) continue
    const k = Number(id.slice(prefix.length))
    if (Number.isInteger(k)) n = Math.max(n, k)
  }
  return `${prefix}${n + 1}`
}

/**
 * A fresh component of the given kind, placed at a scene position.
 *
 * Floor-bound kinds snap to the floor when there is one: a vertical wall's
 * base goes to y = 0 and a horizontal spring's block sits on the ground, so a
 * click anywhere near the floor gives a wall that stands and a block that
 * slides, instead of something that falls over first.
 */
export function makeEntity(kind: EntityKind, at: [number, number], taken: Iterable<string>, ground = true): Entity {
  const id = nextId(kind, taken)
  switch (kind) {
    case 'ball':
      return {
        id, kind, position_m: at,
        radius_m: 0.12, mass_kg: 1, restitution: 0.6, friction: 0.2,
        charge_c: 0, velocity_ms: [0, 0],
      }
    case 'box':
      return {
        id, kind, position_m: at,
        width_m: 0.3, height_m: 0.3, angle_deg: 0, mass_kg: 1,
        restitution: 0.2, friction: 0.3, charge_c: 0, velocity_ms: [0, 0],
      }
    case 'ramp':
      return { id, kind, position_m: at, angle_deg: 25, length_m: 2, friction: 0.1 }
    case 'wall':
      return {
        id, kind, position_m: at,
        width_m: 0.15, height_m: 1.2, angle_deg: 0, friction: 0.3, restitution: 0.6,
      }
    case 'wall_v':
      return {
        id, kind, position_m: ground ? [at[0], 0] : at,
        height_m: 1.5, thickness_m: 0.2, friction: 0.3, restitution: 0.6,
      }
    case 'pendulum':
      return {
        id, kind, position_m: at,
        length_m: 1, bob_mass_kg: 1, bob_radius_m: 0.1, start_angle_deg: 0,
      }
    case 'spring':
      return {
        id, kind, position_m: at,
        rest_length_m: 0.6, stiffness_n_per_m: 60, mass_kg: 1,
        bob_radius_m: 0.1, start_extension_m: 0.3,
      }
    case 'spring_h': {
      const size = 0.3
      return {
        id, kind, position_m: ground ? [at[0], size / 2] : at,
        rest_length_m: 0.8, stiffness_n_per_m: 60, mass_kg: 1,
        block_size_m: size, start_extension_m: -0.4, direction: 1, friction: 0,
      }
    }
    case 'magnet_region':
      return { id, kind, position_m: at, width_m: 2.5, height_m: 2.5, b_field_tesla: 1.5 }
  }
}
