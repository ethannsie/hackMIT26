/**
 * Starter scenes.
 *
 * Each one is a chain: something releases, something else responds. A sandbox
 * that opens on an empty grid gets a shrug at an expo table; one that opens
 * mid-Rube-Goldberg gets a question.
 *
 * Every component here meets at least one other within the interaction check's
 * lookahead (see interactions.ts) — `npm run verify:sandbox` enforces it, so a
 * preset cannot quietly decay into a scene the sandbox refuses to run.
 */
import { DEFAULT_ARENA, type SandboxScene } from './types.ts'

export const SANDBOX_PRESETS: Record<string, SandboxScene> = {
  /**
   * The chain named in the plan: box down a ramp, into a pendulum, whose bob
   * knocks a ball into a wall that sends it back.
   *
   * The ramp and box are frictionless on purpose. Matter's own friction model
   * pins a box on a 28° slope even at μ = 0.05 (it crept at 0.06 m/s), which is
   * the same reason the problem-mode incline applies Coulomb friction by hand.
   * Balls roll down at any friction; boxes slide only at zero.
   */
  chain_reaction: {
    name: 'Chain reaction',
    gravity_ms2: 9.81,
    ground: true,
    arena: { width_m: 13, height_m: 4.5, walls: true },
    entities: [
      {
        id: 'ramp_1', kind: 'ramp', position_m: [-3.2, 2.0],
        angle_deg: 28, length_m: 2.6, friction: 0,
      },
      {
        id: 'box_1', kind: 'box', position_m: [-3.0, 2.05],
        width_m: 0.28, height_m: 0.28, angle_deg: 28, mass_kg: 2,
        restitution: 0.35, friction: 0, charge_c: 0, velocity_ms: [0, 0],
      },
      {
        id: 'pendulum_1', kind: 'pendulum', position_m: [0.6, 1.75],
        length_m: 1.35, bob_mass_kg: 1.2, bob_radius_m: 0.18, start_angle_deg: 0,
      },
      {
        id: 'ball_1', kind: 'ball', position_m: [1.1, 0.16],
        radius_m: 0.16, mass_kg: 0.8, restitution: 0.75, friction: 0.05,
        charge_c: 0, velocity_ms: [0, 0],
      },
      {
        id: 'wall_v_1', kind: 'wall_v', position_m: [4.2, 0],
        height_m: 1.4, thickness_m: 0.18, friction: 0.1, restitution: 0.85,
      },
    ],
  },

  /**
   * Almost nothing dissipates here, so the energy law should actually hold and
   * the panel should say so. A compressed floor spring fires a frictionless
   * ball into a pendulum; everything is elastic.
   */
  conservative_playground: {
    name: 'Conservative playground',
    gravity_ms2: 9.81,
    ground: true,
    arena: { width_m: 13, height_m: 5.5, walls: true },
    entities: [
      {
        id: 'spring_h_1', kind: 'spring_h', position_m: [-5.8, 0.15],
        rest_length_m: 1.2, stiffness_n_per_m: 120, mass_kg: 1,
        block_size_m: 0.3, start_extension_m: -0.6, direction: 1, friction: 0,
      },
      {
        id: 'ball_1', kind: 'ball', position_m: [-4.2, 0.14],
        radius_m: 0.14, mass_kg: 1, restitution: 1, friction: 0,
        charge_c: 0, velocity_ms: [0, 0],
      },
      {
        id: 'pendulum_1', kind: 'pendulum', position_m: [1.2, 1.7],
        length_m: 1.45, bob_mass_kg: 1, bob_radius_m: 0.13, start_angle_deg: 0,
      },
    ],
  },

  /**
   * The two new pieces doing what they are for: a floor spring launches a
   * block into a ball, the ball crosses under a pendulum and knocks it, hits a
   * standing wall, and comes back through the pendulum a second time.
   */
  launch_and_return: {
    name: 'Launch and return',
    gravity_ms2: 9.81,
    ground: true,
    arena: { width_m: 13, height_m: 4.5, walls: true },
    entities: [
      {
        id: 'spring_h_1', kind: 'spring_h', position_m: [-5.8, 0.15],
        rest_length_m: 1.2, stiffness_n_per_m: 150, mass_kg: 1.5,
        block_size_m: 0.3, start_extension_m: -0.7, direction: 1, friction: 0,
      },
      {
        id: 'ball_1', kind: 'ball', position_m: [-3.9, 0.16],
        radius_m: 0.16, mass_kg: 0.8, restitution: 0.9, friction: 0.02,
        charge_c: 0, velocity_ms: [0, 0],
      },
      {
        id: 'pendulum_1', kind: 'pendulum', position_m: [0, 1.6],
        length_m: 1.3, bob_mass_kg: 0.8, bob_radius_m: 0.15, start_angle_deg: 0,
      },
      {
        id: 'wall_v_1', kind: 'wall_v', position_m: [3.5, 0],
        height_m: 1.5, thickness_m: 0.2, friction: 0.1, restitution: 0.9,
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
    // Open scene: the field does the containing, not walls.
    arena: { width_m: 14, height_m: 7, walls: false },
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
    arena: { ...DEFAULT_ARENA },
    entities: [],
  },
}

/** Deep copy, so editing a scene never mutates the preset. */
export function loadPreset(key: string): SandboxScene {
  const preset = SANDBOX_PRESETS[key] ?? SANDBOX_PRESETS['blank']!
  return structuredClone(preset)
}
