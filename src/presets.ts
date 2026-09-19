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
}
