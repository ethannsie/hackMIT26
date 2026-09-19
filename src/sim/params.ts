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

export type SimParams = ProjectileParams | InclineParams | PendulumParams | CollisionParams

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
  }
}
