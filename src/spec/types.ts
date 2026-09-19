/**
 * THE CONTRACT.
 *
 * This file is the interface between stage [2] EXTRACT and stage [3] BUILD.
 * Per hackmit-2026-plan.md §3, it is frozen after hour 4: do not change a field
 * name here without telling the whole team.
 *
 * Design rules (plan §4): strict, small, boring. Every field carries its unit in
 * its name. No free-form strings the sim has to parse.
 */

export const PROBLEM_TYPES = [
  'projectile',
  'inclined_plane',
  'pendulum',
  'collision_1d',
] as const
export type ProblemType = (typeof PROBLEM_TYPES)[number]

/** Quantities the derivation panel knows how to solve for. */
export const ASKABLE = [
  'acceleration_ms2',
  'time_to_bottom_s',
  'final_velocity_ms',
  'time_of_flight_s',
  'range_m',
  'apex_height_m',
  'period_s',
  'angular_frequency_rads',
  'max_speed_ms',
  'normal_force_n',
  'tension_n',
  'v1_final_ms',
  'v2_final_ms',
  'kinetic_energy_lost_j',
] as const
export type Askable = (typeof ASKABLE)[number]

export const OBJECT_KINDS = [
  'ball',
  'box',
  'cart',
  'bob',
  'incline',
  'ground',
  'wall',
  'pivot',
] as const
export type ObjectKind = (typeof OBJECT_KINDS)[number]

/** Kinds the hand is never allowed to push (plan §4). Enforced, not advisory. */
export const STATIC_KINDS: readonly ObjectKind[] = ['incline', 'ground', 'wall', 'pivot']

export interface SpecObject {
  id: string
  kind: ObjectKind
  interactable: boolean
  mass_kg: number | null
  /** [width, height] for box/cart, [radius] for ball/bob, [length] for incline. Metres. */
  dims_m: number[]
  /** Scene position in metres, origin at ground level under the leftmost object. */
  position_m: [number, number]
  angle_deg: number | null
}

/**
 * Flat parameter bag. Every field is nullable and every field is always present.
 *
 * This shape is dictated by OpenAI structured-output strict mode, which forbids
 * optional properties and restricts `anyOf`. So instead of a per-type union we
 * use one flat object and let `normalize()` in ./normalize.ts project it down to
 * the typed params each sim builder actually wants.
 *
 * NOTE — deliberate deviation from the plan doc's draft: the draft used
 * `angle_deg` for the incline angle, but a flat bag makes that collide with the
 * projectile launch angle. Split into `incline_angle_deg` and
 * `launch_angle_deg`. Everything else matches the doc.
 */
export interface SpecGiven {
  gravity_ms2: number | null

  // projectile
  v0_ms: number | null
  launch_angle_deg: number | null
  h0_m: number | null

  // inclined plane
  incline_angle_deg: number | null
  ramp_length_m: number | null
  mass_kg: number | null
  mu_kinetic: number | null
  initial_velocity_ms: number | null
  /** 'sliding' -> a = g(sinθ − μcosθ); 'rolling' -> a = (5/7)g sinθ. Plan §6.2. */
  body_motion: 'sliding' | 'rolling' | null

  // pendulum
  length_m: number | null
  theta0_deg: number | null

  // 1D collision
  m1_kg: number | null
  m2_kg: number | null
  v1_ms: number | null
  v2_ms: number | null
  restitution: number | null
}

export interface ProblemSpec {
  problem_type: ProblemType
  /** 0..1. Below 0.6 the UI must show the manual type picker (plan §4). */
  confidence: number
  given: SpecGiven
  objects: SpecObject[]
  asked_for: Askable[]
  /** Original problem text, kept so the derivation panel can quote it. */
  raw_text: string
}

/** Confidence below this forces the manual problem-type picker. Plan §4. */
export const CONFIDENCE_FLOOR = 0.6
