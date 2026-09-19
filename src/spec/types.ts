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
  // The original four: the bread and butter of intro mechanics.
  'projectile',
  'inclined_plane',
  'pendulum',
  'collision_1d',
  // The hard-to-picture five. Each one targets a specific place where a
  // student's mental simulation reliably fails, and where a static textbook
  // diagram cannot help because the interesting thing is a vector pointing
  // somewhere nothing is moving.
  'rolling_without_slipping',
  'circular_motion',
  'charged_particle_magnetic',
  'rotating_frame',
  'angular_momentum_point',
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
  // rolling without slipping
  'contact_point_speed_ms',
  'top_point_speed_ms',
  'rotational_ke_fraction',
  // uniform circular motion
  'centripetal_acceleration_ms2',
  'centripetal_force_n',
  // charged particle in a magnetic field
  'orbit_radius_m',
  'cyclotron_period_s',
  'cyclotron_frequency_rads',
  'work_done_j',
  // rotating frame
  'coriolis_acceleration_ms2',
  'centrifugal_acceleration_ms2',
  // angular momentum about a point
  'angular_momentum_kgm2s',
  'areal_velocity_m2s',
  'torque_nm',
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
  'wheel',
  'particle',
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

  // rolling, circular motion — the radius of the rolling body or the orbit
  radius_m: number | null
  /**
   * Mass distribution, which fixes the moment of inertia:
   *   disc/cylinder I = 1/2 mr²    sphere I = 2/5 mr²
   *   hoop/ring     I = mr²        point  I = mr²
   * This is the whole reason a hoop and a disc race differently down a ramp.
   */
  body_shape: 'disc' | 'sphere' | 'hoop' | 'point' | null

  // charged particle in a magnetic field. Signs matter: a negative charge or a
  // reversed field orbits the other way, which is most of the lesson.
  charge_c: number | null
  /** Out of the page is positive, into the page negative. */
  b_field_tesla: number | null

  // rotating frame — frame angular velocity, positive counter-clockwise
  omega_rads: number | null

  /**
   * Angular momentum about a point: the perpendicular distance from the chosen
   * origin to the particle's line of motion. Signed, because L's direction is.
   */
  impact_parameter_m: number | null
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
