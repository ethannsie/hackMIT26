/**
 * Projects the flat, all-nullable SpecGiven bag down to the typed parameter set
 * each sim builder actually wants, applying documented defaults.
 *
 * Defaults live here and nowhere else. If a number appears on screen that the
 * student did not supply, it came from this file.
 */
import type { ProblemSpec, SpecGiven } from '../spec/types.ts'

export interface ProjectileParams {
  kind: 'projectile'
  v0_ms: number
  angle_deg: number
  h0_m: number
  g: number
}

export interface InclineParams {
  kind: 'inclined_plane'
  angle_deg: number
  mass_kg: number
  mu_kinetic: number
  ramp_length_m: number
  v0_ms: number
  motion: 'sliding' | 'rolling'
  shape: MassShape
  g: number
}

export interface PendulumParams {
  kind: 'pendulum'
  length_m: number
  theta0_deg: number
  mass_kg: number
  g: number
}

export interface CollisionParams {
  kind: 'collision_1d'
  m1_kg: number
  m2_kg: number
  v1_ms: number
  v2_ms: number
  restitution: number
}

export interface RollingParams {
  kind: 'rolling_without_slipping'
  radius_m: number
  mass_kg: number
  v_ms: number
  shape: MassShape
  g: number
}

export interface CircularParams {
  kind: 'circular_motion'
  radius_m: number
  speed_ms: number
  mass_kg: number
}

export interface MagneticParams {
  kind: 'charged_particle_magnetic'
  charge_c: number
  b_field_tesla: number
  mass_kg: number
  speed_ms: number
  /** Initial direction of travel, measured from +x. */
  angle_deg: number
}

export interface RotatingFrameParams {
  kind: 'rotating_frame'
  omega_rads: number
  speed_ms: number
  angle_deg: number
  mass_kg: number
  /** Starting radius from the rotation axis. */
  r0_m: number
}

export interface AngularMomentumParams {
  kind: 'angular_momentum_point'
  mass_kg: number
  speed_ms: number
  /** Signed perpendicular distance from the origin to the line of motion. */
  impact_parameter_m: number
}

export type SimParams =
  | ProjectileParams
  | InclineParams
  | PendulumParams
  | CollisionParams
  | RollingParams
  | CircularParams
  | MagneticParams
  | RotatingFrameParams
  | AngularMomentumParams

export type MassShape = 'disc' | 'sphere' | 'hoop' | 'point'

/**
 * Moment of inertia as a fraction of mr². This single number is why a hoop
 * loses a race down a ramp to a disc, which loses to a sphere.
 */
export const INERTIA_COEFF: Record<MassShape, number> = {
  disc: 1 / 2,
  sphere: 2 / 5,
  hoop: 1,
  point: 1,
}

/** `v ?? fallback`, but only for the null case — 0 is a legitimate value. */
function or(v: number | null, fallback: number): number {
  return v === null ? fallback : v
}

export function toParams(spec: ProblemSpec): SimParams {
  const g: SpecGiven = spec.given
  const gravity = or(g.gravity_ms2, 9.81)

  switch (spec.problem_type) {
    case 'projectile':
      return {
        kind: 'projectile',
        v0_ms: or(g.v0_ms, 0),
        angle_deg: or(g.launch_angle_deg, 45),
        h0_m: or(g.h0_m, 0),
        g: gravity,
      }

    case 'inclined_plane':
      return {
        kind: 'inclined_plane',
        angle_deg: or(g.incline_angle_deg, 25),
        mass_kg: or(g.mass_kg, 1),
        mu_kinetic: or(g.mu_kinetic, 0),
        ramp_length_m: or(g.ramp_length_m, 1.2),
        v0_ms: or(g.initial_velocity_ms, 0),
        motion: g.body_motion ?? 'sliding',
        shape: g.body_shape ?? 'sphere',
        g: gravity,
      }

    case 'pendulum':
      return {
        kind: 'pendulum',
        length_m: or(g.length_m, 1),
        theta0_deg: or(g.theta0_deg, 15),
        mass_kg: or(g.mass_kg, 1),
        g: gravity,
      }

    case 'collision_1d':
      return {
        kind: 'collision_1d',
        m1_kg: or(g.m1_kg, 1),
        m2_kg: or(g.m2_kg, 1),
        v1_ms: or(g.v1_ms, 1),
        v2_ms: or(g.v2_ms, 0),
        restitution: or(g.restitution, 1),
      }

    case 'rolling_without_slipping':
      return {
        kind: 'rolling_without_slipping',
        radius_m: or(g.radius_m, 0.25),
        mass_kg: or(g.mass_kg, 1),
        v_ms: or(g.v0_ms, or(g.initial_velocity_ms, 1.5)),
        shape: g.body_shape ?? 'disc',
        g: gravity,
      }

    // The next four are all zero-gravity setups. Gravity is not the point in any
    // of them, and leaving it on would drag the body out of frame mid-lesson.
    case 'circular_motion':
      return {
        kind: 'circular_motion',
        radius_m: or(g.radius_m, 0.8),
        speed_ms: or(g.v0_ms, 2),
        mass_kg: or(g.mass_kg, 1),
      }

    case 'charged_particle_magnetic':
      return {
        kind: 'charged_particle_magnetic',
        charge_c: or(g.charge_c, 1),
        b_field_tesla: or(g.b_field_tesla, 1),
        mass_kg: or(g.mass_kg, 1),
        speed_ms: or(g.v0_ms, 2),
        angle_deg: or(g.launch_angle_deg, 0),
      }

    case 'rotating_frame':
      return {
        kind: 'rotating_frame',
        omega_rads: or(g.omega_rads, 1),
        speed_ms: or(g.v0_ms, 1.5),
        angle_deg: or(g.launch_angle_deg, 90),
        mass_kg: or(g.mass_kg, 1),
        r0_m: or(g.radius_m, 0),
      }

    case 'angular_momentum_point':
      return {
        kind: 'angular_momentum_point',
        mass_kg: or(g.mass_kg, 1),
        speed_ms: or(g.v0_ms, 1.5),
        impact_parameter_m: or(g.impact_parameter_m, 0.6),
      }
  }
}
