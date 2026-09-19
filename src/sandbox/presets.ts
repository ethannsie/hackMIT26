/**
 * Starter scenes.
 *
 * Each one is a chain: something releases, something else responds. A sandbox
 * that opens on an empty grid gets a shrug at an expo table; one that opens
 * mid-Rube-Goldberg gets a question.
 */
import type { SandboxScene } from './types.ts'

export const SANDBOX_PRESETS: Record<string, SandboxScene> = {
  /** The chain named in the plan: box on ramp triggering a pendulum. */
  chain_reaction: {
    name: 'Chain reaction',
    gravity_ms2: 9.81,
    ground: true,
    entities: [
      {
        id: 'ramp_1', kind: 'ramp', position_m: [-3.2, 2.0],
        angle_deg: 28, length_m: 2.6, friction: 0.05,
      },
      {
        id: 'box_1', kind: 'box', position_m: [-3.0, 2.05],
        width_m: 0.28, height_m: 0.28, angle_deg: 28, mass_kg: 2,
        restitution: 0.35, friction: 0.05, charge_c: 0, velocity_ms: [0, 0],
      },
      {
        id: 'pendulum_1', kind: 'pendulum', position_m: [0.4, 2.4],
        length_m: 1.5, bob_mass_kg: 1.2, bob_radius_m: 0.14, start_angle_deg: 0,
      },
      {
        id: 'ball_1', kind: 'ball', position_m: [2.4, 0.16],
        radius_m: 0.16, mass_kg: 0.8, restitution: 0.75, friction: 0.05,
        charge_c: 0, velocity_ms: [0, 0],
      },
      {
        id: 'wall_1', kind: 'wall', position_m: [4.2, 0.7],
        width_m: 0.18, height_m: 1.4, angle_deg: 0, friction: 0.1, restitution: 0.85,
      },
    ],
  },

  /**
   * Almost nothing dissipates here, so the energy law should actually hold and
   * the panel should say so. A good scene to compare against the others.
   */
  conservative_playground: {
    name: 'Conservative playground',
    gravity_ms2: 9.81,
    ground: true,
    entities: [
      {
        id: 'spring_1', kind: 'spring', position_m: [-1.8, 3.0],
        rest_length_m: 0.8, stiffness_n_per_m: 90, mass_kg: 1,
        bob_radius_m: 0.13, start_extension_m: 0.45,
      },
      {
        id: 'pendulum_1', kind: 'pendulum', position_m: [1.2, 3.0],
        length_m: 1.4, bob_mass_kg: 1, bob_radius_m: 0.13, start_angle_deg: 35,
      },
      {
        id: 'ball_1', kind: 'ball', position_m: [-3.4, 1.2],
        radius_m: 0.14, mass_kg: 1, restitution: 1, friction: 0,
        charge_c: 0, velocity_ms: [2.2, 0],
      },
    ],
  },

  /**
   * Gravity off, no floor, no walls. A charged ball loops inside the field while
   * a neutral one sails straight through — same scene, same launch, one visible
   * difference. Momentum is not conserved and the panel names the field as why.
   */
  field_trap: {
    name: 'Magnetic trap',
    gravity_ms2: 0,
    ground: false,
    entities: [
      {
        id: 'magnet_region_1', kind: 'magnet_region', position_m: [0, 1.6],
        width_m: 4.5, height_m: 4.5, b_field_tesla: 1.6,
      },
      {
        id: 'ball_1', kind: 'ball', position_m: [-2.0, 1.6],
        radius_m: 0.1, mass_kg: 1, restitution: 1, friction: 0,
        charge_c: 1.2, velocity_ms: [2, 0],
      },
      {
        id: 'ball_2', kind: 'ball', position_m: [-2.0, 2.6],
        radius_m: 0.1, mass_kg: 1, restitution: 1, friction: 0,
        charge_c: 0, velocity_ms: [2, 0],
      },
    ],
  },

  /** Empty, for building from scratch. */
  blank: {
    name: 'Blank',
    gravity_ms2: 9.81,
    ground: true,
    entities: [],
  },
}

/** Deep copy, so editing a scene never mutates the preset. */
export function loadPreset(key: string): SandboxScene {
  const preset = SANDBOX_PRESETS[key] ?? SANDBOX_PRESETS['blank']!
  return structuredClone(preset)
}
