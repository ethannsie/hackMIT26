import type { ProblemSpec } from './types.ts'
import { toParams } from '../sim/params.ts'

/** The displayed and tutor givens come from the same parameters as the engine. */
export function currentGivens(spec: ProblemSpec): string {
  const p = toParams(spec)
  const labels: Record<string, [string, string]> = {
    v0_ms: ['Initial speed', 'm/s'], speed_ms: ['Speed', 'm/s'], v_ms: ['Axle speed', 'm/s'],
    angle_deg: ['Angle', '°'], h0_m: ['Starting height', 'm'], g: ['Gravity', 'm/s²'],
    mass_kg: ['Mass', 'kg'], mu_kinetic: ['Friction coefficient', ''], ramp_length_m: ['Ramp length', 'm'],
    motion: ['Motion', ''], shape: ['Shape', ''], length_m: ['Length', 'm'], theta0_deg: ['Release angle', '°'],
    m1_kg: ['Mass 1', 'kg'], m2_kg: ['Mass 2', 'kg'], v1_ms: ['Velocity 1', 'm/s'], v2_ms: ['Velocity 2', 'm/s'],
    restitution: ['Restitution', ''], radius_m: ['Radius', 'm'], charge_c: ['Charge', 'C'],
    b_field_tesla: ['Magnetic field (+ out of page)', 'T'], omega_rads: ['Frame rotation', 'rad/s'],
    r0_m: ['Starting radius', 'm'], impact_parameter_m: ['Signed impact parameter', 'm'],
  }
  return Object.entries(p).filter(([key]) => key !== 'kind' && !(key === 'shape' && p.kind === 'inclined_plane' && p.motion === 'sliding'))
    .map(([key, value]) => { const [label, unit] = labels[key] ?? [key, '']; return `${label}: ${value}${unit ? ` ${unit}` : ''}` }).join('; ')

}

/** Generated statements are rendered from validated quantities, never matched by a bag of numbers. */
export function problemStatement(spec: ProblemSpec): string {
  const p = toParams(spec)
  let text: string
  switch (p.kind) {
    case 'projectile': text = `A ball is launched at ${p.v0_ms} m/s at ${p.angle_deg}° from the horizontal, from a height of ${p.h0_m} m. Gravity is ${p.g} m/s², with no air resistance.`; break
    case 'inclined_plane': text = `A ${p.mass_kg} kg ${p.motion === 'rolling' ? p.shape + ' rolls without slipping' : 'block slides'} down a ${p.ramp_length_m} m ramp at ${p.angle_deg}°, starting at ${p.v0_ms} m/s downhill. ${p.motion === 'sliding' ? `The friction coefficient (static and kinetic) is ${p.mu_kinetic}. ` : 'Static friction is sufficient for ideal rolling. '}Gravity is ${p.g} m/s².`; break
    case 'pendulum': text = `A ${p.mass_kg} kg bob on a rigid, massless ${p.length_m} m rod is released from rest at ${p.theta0_deg}° from vertical. Gravity is ${p.g} m/s²; neglect drag.`; break
    case 'collision_1d': text = `Two carts of masses ${p.m1_kg} kg and ${p.m2_kg} kg have signed velocities ${p.v1_ms} m/s and ${p.v2_ms} m/s on a frictionless track. The coefficient of restitution is ${p.restitution}. Find the velocities after a collision, if they meet.`; break
    case 'rolling_without_slipping': text = `A ${p.mass_kg} kg ${p.shape} of radius ${p.radius_m} m rolls without slipping on a horizontal track at ${p.v_ms} m/s. Gravity is ${p.g} m/s².`; break
    case 'circular_motion': text = `A ${p.mass_kg} kg particle moves at constant speed ${p.speed_ms} m/s in a circle of radius ${p.radius_m} m, in a plane with no gravity.`; break
    case 'charged_particle_magnetic': text = `A particle of mass ${p.mass_kg} kg and signed charge ${p.charge_c} C moves at ${p.speed_ms} m/s, initially at ${p.angle_deg}° from +x. The perpendicular magnetic field is ${p.b_field_tesla} T (positive out of the page). Neglect gravity.`; break
    case 'rotating_frame': text = `A ${p.mass_kg} kg free particle starts at (${p.r0_m}, 0) m in a frame rotating at ${p.omega_rads} rad/s. Its initial velocity in that frame is ${p.speed_ms} m/s at ${p.angle_deg}° from +x. Neglect gravity.`; break
    case 'angular_momentum_point': text = `A ${p.mass_kg} kg particle moves along +x at ${p.speed_ms} m/s on the line y = ${-p.impact_parameter_m} m relative to origin O. No forces act.`; break
  }
  return `${text} Calculate: ${spec.asked_for.map(q => q.replace(/_/g, ' ')).join(', ')}.`
}
