/**
 * Hand-written specs, one per problem type.
 *
 * Two jobs: they are the manual problem-type picker (failure-ladder rung 4,
 * plan §12 — the sim still works with no photo and no model), and they are what
 * the app boots into so a demo never starts on an empty screen.
 */
import type { ProblemSpec, ProblemType, SpecGiven } from './spec/types.ts'

const BASE: SpecGiven = {
  gravity_ms2: 9.81,
  v0_ms: null,
  launch_angle_deg: null,
  h0_m: null,
  incline_angle_deg: null,
  ramp_length_m: null,
  mass_kg: null,
  mu_kinetic: null,
  initial_velocity_ms: null,
  body_motion: null,
  length_m: null,
  theta0_deg: null,
  m1_kg: null,
  m2_kg: null,
  v1_ms: null,
  v2_ms: null,
  restitution: null,
  radius_m: null,
  body_shape: null,
  charge_c: null,
  b_field_tesla: null,
  omega_rads: null,
  impact_parameter_m: null,
}

export const PRESETS: Record<ProblemType, ProblemSpec> = {
  projectile: {
    problem_type: 'projectile',
    confidence: 1,
    given: { ...BASE, v0_ms: 12, launch_angle_deg: 40, h0_m: 1.5 },
    objects: [],
    asked_for: ['time_of_flight_s', 'range_m', 'apex_height_m'],
    raw_text:
      'A ball is launched at 12 m/s at 40° above the horizontal from a height of 1.5 m. Find its time of flight, range, and maximum height.',
  },
  inclined_plane: {
    problem_type: 'inclined_plane',
    confidence: 1,
    given: {
      ...BASE,
      incline_angle_deg: 25,
      ramp_length_m: 1.2,
      mass_kg: 2,
      mu_kinetic: 0.15,
      initial_velocity_ms: 0,
      body_motion: 'sliding',
    },
    objects: [],
    asked_for: ['acceleration_ms2', 'normal_force_n', 'time_to_bottom_s', 'final_velocity_ms'],
    raw_text:
      'A 2.0 kg block is released from rest at the top of a 1.2 m ramp inclined at 25°. The coefficient of kinetic friction is 0.15. Find the acceleration, the normal force, and the time to reach the bottom.',
  },
  pendulum: {
    problem_type: 'pendulum',
    confidence: 1,
    given: { ...BASE, length_m: 1.0, theta0_deg: 15, mass_kg: 0.5 },
    objects: [],
    asked_for: ['period_s', 'angular_frequency_rads', 'max_speed_ms'],
    raw_text:
      'A 0.5 kg bob hangs from a 1.0 m string and is released from 15° off vertical. Find the period and the maximum speed.',
  },
  collision_1d: {
    problem_type: 'collision_1d',
    confidence: 1,
    given: { ...BASE, m1_kg: 1.5, m2_kg: 1.0, v1_ms: 2.5, v2_ms: 0, restitution: 1 },
    objects: [],
    asked_for: ['v1_final_ms', 'v2_final_ms', 'kinetic_energy_lost_j'],
    raw_text:
      'A 1.5 kg cart moving at 2.5 m/s collides elastically with a stationary 1.0 kg cart on a frictionless track. Find both final velocities.',
  },

  rolling_without_slipping: {
    problem_type: 'rolling_without_slipping',
    confidence: 1,
    given: { ...BASE, radius_m: 0.3, mass_kg: 2, v0_ms: 2, body_shape: 'disc' },
    objects: [],
    asked_for: [
      'angular_frequency_rads',
      'contact_point_speed_ms',
      'top_point_speed_ms',
      'rotational_ke_fraction',
    ],
    raw_text:
      'A 2.0 kg uniform disc of radius 0.30 m rolls without slipping at 2.0 m/s. Find its angular velocity, the speed of the contact point, the speed of the topmost point, and the fraction of its kinetic energy that is rotational.',
  },

  circular_motion: {
    problem_type: 'circular_motion',
    confidence: 1,
    given: { ...BASE, radius_m: 0.8, v0_ms: 2.5, mass_kg: 1.2 },
    objects: [],
    asked_for: ['centripetal_acceleration_ms2', 'centripetal_force_n', 'period_s'],
    raw_text:
      'A 1.2 kg ball moves in a horizontal circle of radius 0.80 m at a constant speed of 2.5 m/s. Find the centripetal acceleration, the force required, and the period.',
  },

  charged_particle_magnetic: {
    problem_type: 'charged_particle_magnetic',
    confidence: 1,
    given: { ...BASE, charge_c: 1, b_field_tesla: 1.5, mass_kg: 1, v0_ms: 2, launch_angle_deg: 0 },
    objects: [],
    asked_for: ['orbit_radius_m', 'cyclotron_period_s', 'work_done_j'],
    raw_text:
      'A particle of charge +1.0 C and mass 1.0 kg enters a uniform 1.5 T magnetic field directed out of the page, moving at 2.0 m/s perpendicular to the field. Find the radius of its path, the period of its orbit, and the work done on it by the field.',
  },

  rotating_frame: {
    problem_type: 'rotating_frame',
    confidence: 1,
    given: { ...BASE, omega_rads: 1.2, v0_ms: 1.5, launch_angle_deg: 90, mass_kg: 1, radius_m: 0.5 },
    objects: [],
    asked_for: ['coriolis_acceleration_ms2', 'centrifugal_acceleration_ms2'],
    raw_text:
      'A 1.0 kg puck slides outward at 1.5 m/s on a turntable rotating at 1.2 rad/s, starting 0.50 m from the axis. Describe its path as seen from the rotating turntable, and find the Coriolis and centrifugal accelerations.',
  },

  angular_momentum_point: {
    problem_type: 'angular_momentum_point',
    confidence: 1,
    given: { ...BASE, mass_kg: 2, v0_ms: 1.5, impact_parameter_m: 0.6 },
    objects: [],
    asked_for: ['angular_momentum_kgm2s', 'torque_nm', 'areal_velocity_m2s'],
    raw_text:
      'A 2.0 kg particle travels in a straight line at a constant 1.5 m/s. Its line of motion passes 0.60 m from the origin O. Find its angular momentum about O, and show that it does not change.',
  },
}

/** Sliders for the live-editing panel, per problem type. */
export interface Knob {
  key: keyof SpecGiven
  label: string
  min: number
  max: number
  step: number
}

export const KNOBS: Record<ProblemType, Knob[]> = {
  projectile: [
    { key: 'v0_ms', label: 'launch speed (m/s)', min: 1, max: 40, step: 0.5 },
    { key: 'launch_angle_deg', label: 'launch angle (°)', min: 5, max: 85, step: 1 },
    { key: 'h0_m', label: 'launch height (m)', min: 0, max: 10, step: 0.1 },
    { key: 'gravity_ms2', label: 'gravity (m/s²)', min: 1, max: 25, step: 0.01 },
  ],
  inclined_plane: [
    { key: 'incline_angle_deg', label: 'ramp angle (°)', min: 1, max: 60, step: 1 },
    { key: 'mu_kinetic', label: 'friction μ', min: 0, max: 1, step: 0.01 },
    { key: 'mass_kg', label: 'mass (kg)', min: 0.1, max: 20, step: 0.1 },
    { key: 'ramp_length_m', label: 'ramp length (m)', min: 0.3, max: 5, step: 0.1 },
  ],
  pendulum: [
    { key: 'length_m', label: 'length (m)', min: 0.2, max: 4, step: 0.05 },
    { key: 'theta0_deg', label: 'release angle (°)', min: 1, max: 90, step: 1 },
    { key: 'mass_kg', label: 'bob mass (kg)', min: 0.1, max: 10, step: 0.1 },
    { key: 'gravity_ms2', label: 'gravity (m/s²)', min: 1, max: 25, step: 0.01 },
  ],
  collision_1d: [
    { key: 'm1_kg', label: 'mass 1 (kg)', min: 0.1, max: 10, step: 0.1 },
    { key: 'v1_ms', label: 'velocity 1 (m/s)', min: -10, max: 10, step: 0.1 },
    { key: 'm2_kg', label: 'mass 2 (kg)', min: 0.1, max: 10, step: 0.1 },
    { key: 'v2_ms', label: 'velocity 2 (m/s)', min: -10, max: 10, step: 0.1 },
    { key: 'restitution', label: 'restitution e', min: 0, max: 1, step: 0.05 },
  ],
  rolling_without_slipping: [
    { key: 'v0_ms', label: 'axle speed v (m/s)', min: 0.2, max: 8, step: 0.1 },
    { key: 'radius_m', label: 'radius (m)', min: 0.05, max: 1.5, step: 0.05 },
    { key: 'mass_kg', label: 'mass (kg)', min: 0.1, max: 20, step: 0.1 },
  ],
  circular_motion: [
    { key: 'radius_m', label: 'radius (m)', min: 0.2, max: 3, step: 0.05 },
    { key: 'v0_ms', label: 'speed (m/s)', min: 0.2, max: 10, step: 0.1 },
    { key: 'mass_kg', label: 'mass (kg)', min: 0.1, max: 10, step: 0.1 },
  ],
  charged_particle_magnetic: [
    // Both run through zero and negative on purpose: reversing either one
    // reverses the orbit, and that is the fastest way to feel what a cross
    // product does.
    { key: 'charge_c', label: 'charge q (C)', min: -3, max: 3, step: 0.1 },
    { key: 'b_field_tesla', label: 'field B (T, +out of page)', min: -3, max: 3, step: 0.1 },
    { key: 'v0_ms', label: 'speed (m/s)', min: 0.2, max: 8, step: 0.1 },
    { key: 'mass_kg', label: 'mass (kg)', min: 0.1, max: 5, step: 0.1 },
  ],
  rotating_frame: [
    { key: 'omega_rads', label: 'frame ω (rad/s)', min: -4, max: 4, step: 0.1 },
    { key: 'v0_ms', label: 'speed (m/s)', min: 0.1, max: 6, step: 0.1 },
    { key: 'launch_angle_deg', label: 'direction (°)', min: -180, max: 180, step: 5 },
    { key: 'radius_m', label: 'start radius (m)', min: 0, max: 3, step: 0.05 },
  ],
  angular_momentum_point: [
    // Drag this to zero and L vanishes — the origin is a choice, not a fact.
    { key: 'impact_parameter_m', label: 'impact parameter d (m)', min: -2, max: 2, step: 0.05 },
    { key: 'v0_ms', label: 'speed (m/s)', min: 0.1, max: 6, step: 0.1 },
    { key: 'mass_kg', label: 'mass (kg)', min: 0.1, max: 10, step: 0.1 },
  ],
}
