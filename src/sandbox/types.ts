/**
 * SANDBOX SCENE — a composed world, not a solved problem.
 *
 * This is deliberately NOT a ProblemSpec. The nine problem types are each
 * verified against a closed form; the instant components interact, no closed
 * form exists. A block sliding down a ramp into a pendulum has no textbook
 * answer to check against.
 *
 * So the sandbox trades one kind of rigour for another. Instead of "here is the
 * answer and the sim agrees with it", it shows the quantities that must hold in
 * ANY composed system — energy, linear momentum, angular momentum — and says out
 * loud which of them this particular scene is allowed to conserve. A ramp with
 * friction is not supposed to conserve energy, and the panel says so rather than
 * quietly showing a number that drifts.
 *
 * Coordinate frame is the scene frame: metres, +y UP, origin at the ground line.
 */

export const ENTITY_KINDS = [
  'ball',
  'box',
  'ramp',
  'wall',
  'wall_v',
  'pendulum',
  'spring',
  'spring_h',
  'magnet_region',
] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

interface EntityBase {
  id: string
  /** Scene position in metres, y UP. For pendulum and spring this is the anchor. */
  position_m: [number, number]
}

export interface BallEntity extends EntityBase {
  kind: 'ball'
  radius_m: number
  mass_kg: number
  restitution: number
  friction: number
  /** Non-zero charge makes this body curve inside a magnet_region. */
  charge_c: number
  velocity_ms: [number, number]
}

export interface BoxEntity extends EntityBase {
  kind: 'box'
  width_m: number
  height_m: number
  angle_deg: number
  mass_kg: number
  restitution: number
  friction: number
  charge_c: number
  velocity_ms: [number, number]
}

export interface RampEntity extends EntityBase {
  kind: 'ramp'
  /** Surface runs down and to the right from `position_m`. */
  angle_deg: number
  length_m: number
  friction: number
}

export interface WallEntity extends EntityBase {
  kind: 'wall'
  width_m: number
  height_m: number
  angle_deg: number
  friction: number
  restitution: number
}

/**
 * A wall that stands on the floor. `position_m` is the centre of its BASE, so
 * placing one is "put a barrier here" rather than "centre a rectangle 0.6 m up
 * and hope it meets the ground". The free-angle `wall` remains for everything
 * else.
 */
export interface VerticalWallEntity extends EntityBase {
  kind: 'wall_v'
  height_m: number
  thickness_m: number
  friction: number
  restitution: number
}

export interface PendulumEntity extends EntityBase {
  kind: 'pendulum'
  length_m: number
  bob_mass_kg: number
  bob_radius_m: number
  /** Starting angle from vertical, degrees. */
  start_angle_deg: number
}

export interface SpringEntity extends EntityBase {
  kind: 'spring'
  rest_length_m: number
  /** Real stiffness in N/m, so omega = sqrt(k/m) is actually correct. */
  stiffness_n_per_m: number
  mass_kg: number
  bob_radius_m: number
  /** Initial displacement from rest, metres. This is the amplitude. */
  start_extension_m: number
}

/**
 * A spring lying along the floor: anchor plate at `position_m`, a block on the
 * end, sliding on the ground. Same real stiffness as the hanging spring, so
 * omega = sqrt(k/m) still holds — and on a frictionless block it is the
 * textbook horizontal SHM, which the hanging one is not (gravity shifts its
 * equilibrium). The block is what hits other things.
 */
export interface HorizontalSpringEntity extends EntityBase {
  kind: 'spring_h'
  rest_length_m: number
  stiffness_n_per_m: number
  mass_kg: number
  block_size_m: number
  /** Initial displacement from rest along the axis, metres. The amplitude. */
  start_extension_m: number
  /** +1 runs to the right of the anchor, -1 to the left. */
  direction: number
  /** The block's own friction. 0 slides freely on the ground. */
  friction: number
}

export interface MagnetRegionEntity extends EntityBase {
  kind: 'magnet_region'
  width_m: number
  height_m: number
  /** Positive is out of the page, negative into it. */
  b_field_tesla: number
}

export type Entity =
  | BallEntity
  | BoxEntity
  | RampEntity
  | WallEntity
  | VerticalWallEntity
  | PendulumEntity
  | SpringEntity
  | HorizontalSpringEntity
  | MagnetRegionEntity

/** Kinds that never move and can never be pushed by the hand. */
export const STATIC_ENTITY_KINDS: readonly EntityKind[] = ['ramp', 'wall', 'wall_v', 'magnet_region']

/**
 * The playable area.
 *
 * Without one, bodies leave and never come back: a frictionless box slid off the
 * end of the old fixed-width floor at x = 30 m, fell forever, and was doing
 * 74 m/s by the time anyone noticed. An arena gives the floor a definite size,
 * optionally walls it in, and gives the escape net something to measure against.
 */
export interface Arena {
  width_m: number
  height_m: number
  /** Solid left/right/top boundary. Off for open scenes like orbits. */
  walls: boolean
}

export const DEFAULT_ARENA: Arena = { width_m: 14, height_m: 5, walls: true }

export interface SandboxScene {
  name: string
  gravity_ms2: number
  /** Whether a floor spans the arena. Turn it off for orbit-style setups. */
  ground: boolean
  arena: Arena
  entities: Entity[]
}

export function isStaticKind(kind: EntityKind): boolean {
  return STATIC_ENTITY_KINDS.includes(kind)
}
