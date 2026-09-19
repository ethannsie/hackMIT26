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
  wall: 'Wall',
  pendulum: 'Pendulum',
  spring: 'Spring',
  magnet_region: 'Magnetic field',
}

export const ICONS: Record<EntityKind, string> = {
  ball: '●',
  box: '■',
  ramp: '◺',
  wall: '▌',
  pendulum: '⊥',
  spring: '⌇',
  magnet_region: '⊗',
}

export const HINTS: Record<EntityKind, string> = {
  ball: 'Rolls, bounces, and curves inside a magnetic field if you give it charge.',
  box: 'Slides and tumbles. Friction and restitution decide how much energy survives.',
  ramp: 'Static surface. Sets up everything else.',
  wall: 'Static barrier. Bounces things back into the scene.',
  pendulum: 'Pivot and bob on a rigid rod. Something can knock it.',
  spring: 'Real stiffness in N/m, so the period is genuinely 2π√(m/k).',
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
  magnet_region: [
    { key: 'width_m', label: 'width (m)', min: 0.3, max: 8, step: 0.1 },
    { key: 'height_m', label: 'height (m)', min: 0.3, max: 8, step: 0.1 },
    { key: 'b_field_tesla', label: 'B (T, +out of page)', min: -5, max: 5, step: 0.1 },
  ],
}

let counter = 0
export function nextId(kind: EntityKind): string {
  counter += 1
  return `${kind}_${counter}`
}

/** A fresh component of the given kind, placed at a scene position. */
export function makeEntity(kind: EntityKind, at: [number, number]): Entity {
  const id = nextId(kind)
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
    case 'magnet_region':
      return { id, kind, position_m: at, width_m: 2.5, height_m: 2.5, b_field_tesla: 1.5 }
  }
}
