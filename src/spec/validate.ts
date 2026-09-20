/**
 * Structured outputs guarantee the SHAPE of the spec. They guarantee nothing
 * about physics: a model can still hand us a negative mass, mu = 5, or a 400
 * degree ramp. This layer is the gate in front of the sim.
 *
 * Policy: repair what is unambiguously repairable, record every repair so the
 * UI can show it, and reject only what would make the sim meaningless.
 */
import {
  PROBLEM_TYPES,
  ASKABLE,
  OBJECT_KINDS,
  STATIC_KINDS,
  CONFIDENCE_FLOOR,
  type ProblemSpec,
  type ProblemType,
  type Askable,
  type ObjectKind,
  type SpecGiven,
  type SpecObject,
} from './types.ts'
import { MAX_INPUT_SPEED_MS, MAX_COLLISION_INPUT_MS, MAX_UNFORCED_SPEED_MS, MAX_ORBIT_FREQUENCY_RADS } from '../sim/limits.ts'

export interface ValidationResult {
  ok: boolean
  spec: ProblemSpec | null
  /** Non-fatal corrections applied. Surface these; silent repair is how we ship a wrong demo. */
  repairs: string[]
  /** Fatal problems. If non-empty, `spec` is null and the UI falls back to the manual picker. */
  errors: string[]
  /** True when confidence < 0.6 and the UI must ask the user to confirm the type. Plan §4. */
  needsConfirmation: boolean
}

interface Range {
  min: number
  max: number
}

/** Plausible ranges for intro mechanics. Outside these we clamp and say so. */
const RANGES: Partial<Record<keyof SpecGiven, Range>> = {
  gravity_ms2: { min: 0.1, max: 30 },
  v0_ms: { min: 0, max: MAX_INPUT_SPEED_MS },
  launch_angle_deg: { min: -89, max: 89 },
  h0_m: { min: 0, max: 500 },
  incline_angle_deg: { min: 0, max: 89 },
  ramp_length_m: { min: 0.01, max: 100 },
  mass_kg: { min: 0.001, max: 10_000 },
  mu_kinetic: { min: 0, max: 2 },
  initial_velocity_ms: { min: -MAX_INPUT_SPEED_MS, max: MAX_INPUT_SPEED_MS },
  length_m: { min: 0.01, max: 100 },
  theta0_deg: { min: -170, max: 170 },
  m1_kg: { min: 0.001, max: 10_000 },
  m2_kg: { min: 0.001, max: 10_000 },
  v1_ms: { min: -MAX_COLLISION_INPUT_MS, max: MAX_COLLISION_INPUT_MS },
  v2_ms: { min: -MAX_COLLISION_INPUT_MS, max: MAX_COLLISION_INPUT_MS },
  restitution: { min: 0, max: 1 },
  radius_m: { min: 0.001, max: 50 },
  // Signed on purpose: a negative charge orbits the opposite way, and that
  // reversal is most of what the magnetic-field sim is for.
  charge_c: { min: -1000, max: 1000 },
  b_field_tesla: { min: -100, max: 100 },
  omega_rads: { min: -4, max: 4 },
  impact_parameter_m: { min: -100, max: 100 },
}

/**
 * Where one type reads a shared key differently. `launch_angle_deg` is a
 * projectile's elevation, but for the rotating frame and the charged particle
 * it is a direction of travel, and clamping "moving left" to 89° would turn a
 * correctly extracted problem into a wrong one with a repair note attached.
 * `radius_m` is the rotating frame's starting radius, which may be zero.
 */
const TYPE_RANGES: Partial<Record<ProblemType, Partial<Record<keyof SpecGiven, Range>>>> = {
  rotating_frame: {
    launch_angle_deg: { min: -180, max: 180 },
    radius_m: { min: 0, max: 50 },
  },
  charged_particle_magnetic: {
    launch_angle_deg: { min: -180, max: 180 },
  },
}

function rangeFor(key: keyof SpecGiven, type: unknown): Range {
  const override = typeof type === 'string' ? TYPE_RANGES[type as ProblemType]?.[key] : undefined
  return override ?? RANGES[key]!
}

/** Fields without which a given problem type cannot be simulated at all. */
const REQUIRED_BY_TYPE: Record<ProblemType, (keyof SpecGiven)[]> = {
  projectile: ['v0_ms', 'launch_angle_deg'],
  inclined_plane: ['incline_angle_deg', 'ramp_length_m', 'mass_kg', 'mu_kinetic', 'initial_velocity_ms', 'body_motion'],
  pendulum: ['length_m', 'theta0_deg', 'mass_kg'],
  collision_1d: ['m1_kg', 'm2_kg', 'v1_ms', 'v2_ms', 'restitution'],
  rolling_without_slipping: ['radius_m', 'mass_kg', 'v0_ms', 'body_shape'],
  circular_motion: ['radius_m', 'v0_ms', 'mass_kg'],
  charged_particle_magnetic: ['b_field_tesla', 'charge_c', 'mass_kg', 'v0_ms'],
  rotating_frame: ['omega_rads', 'v0_ms', 'radius_m', 'mass_kg'],
  angular_momentum_point: ['impact_parameter_m', 'mass_kg', 'v0_ms'],
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function validateSpec(raw: unknown): ValidationResult {
  const repairs: string[] = []
  const errors: string[] = []

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, spec: null, repairs, errors: ['spec is not an object'], needsConfirmation: true }
  }
  const r = raw as Record<string, unknown>

  // --- problem_type -------------------------------------------------------
  const problem_type = r['problem_type']
  if (typeof problem_type !== 'string' || !(PROBLEM_TYPES as readonly string[]).includes(problem_type)) {
    errors.push(`problem_type ${JSON.stringify(problem_type)} is not one of ${PROBLEM_TYPES.join(', ')}`)
  }

  // --- confidence ---------------------------------------------------------
  let confidence = isFiniteNumber(r['confidence']) ? r['confidence'] : 0
  if (!isFiniteNumber(r['confidence'])) {
    repairs.push('confidence missing or non-numeric; treated as 0')
  } else if (confidence < 0 || confidence > 1) {
    repairs.push(`confidence ${confidence} clamped into [0, 1]`)
    confidence = Math.min(1, Math.max(0, confidence))
  }

  // --- given --------------------------------------------------------------
  const rawGiven = (typeof r['given'] === 'object' && r['given'] !== null ? r['given'] : {}) as Record<string, unknown>
  const given = {} as SpecGiven

  for (const key of Object.keys(RANGES) as (keyof SpecGiven)[]) {
    const v = rawGiven[key]
    if (v === null || v === undefined) {
      ;(given[key] as number | null) = null
      continue
    }
    if (!isFiniteNumber(v)) {
      repairs.push(`given.${key} was ${JSON.stringify(v)} (not a finite number); dropped`)
      ;(given[key] as number | null) = null
      continue
    }
    const range = rangeFor(key, problem_type)
    if (v < range.min || v > range.max) {
      const clamped = Math.min(range.max, Math.max(range.min, v))
      repairs.push(`given.${key} = ${v} outside [${range.min}, ${range.max}]; clamped to ${clamped}`)
      ;(given[key] as number | null) = clamped
    } else {
      ;(given[key] as number | null) = v
    }
  }

  const motion = rawGiven['body_motion']
  given.body_motion = motion === 'sliding' || motion === 'rolling' ? motion : null
  if (motion != null && given.body_motion === null) {
    repairs.push(`given.body_motion = ${JSON.stringify(motion)} is not 'sliding' or 'rolling'; dropped`)
  }

  const SHAPES = ['disc', 'sphere', 'hoop', 'point'] as const
  const shape = rawGiven['body_shape']
  given.body_shape =
    typeof shape === 'string' && (SHAPES as readonly string[]).includes(shape)
      ? (shape as SpecGiven['body_shape'])
      : null
  if (shape != null && given.body_shape === null) {
    repairs.push(`given.body_shape = ${JSON.stringify(shape)} is not one of ${SHAPES.join(', ')}; dropped`)
  }

  // A charge of exactly zero feels no magnetic force, which is a valid setup but
  // a degenerate sim. Flag it rather than silently drawing a straight line.
  if (problem_type === 'charged_particle_magnetic' && given.charge_c === 0) {
    errors.push('charged_particle_magnetic needs a non-zero charge_c; a neutral particle feels no magnetic force')
  }

  if (given.gravity_ms2 === null) {
    given.gravity_ms2 = 9.81
    repairs.push('gravity_ms2 missing; defaulted to 9.81')
  }

  // Only conventional coordinate choices may be filled in, always visibly.
  const defaultValue = (key: keyof SpecGiven, value: number): void => {
    if (given[key] === null) {
      (given[key] as number | null) = value
      repairs.push(`${key} missing; assumed ${value}. Confirm before using this problem.`)
    }
  }
  if (problem_type === 'projectile') defaultValue('h0_m', 0)
  if (problem_type === 'charged_particle_magnetic' || problem_type === 'rotating_frame') defaultValue('launch_angle_deg', 0)
  if (problem_type === 'rolling_without_slipping' && given.v0_ms === null && given.initial_velocity_ms !== null) given.v0_ms = given.initial_velocity_ms
  if (problem_type === 'inclined_plane') {
    if ((given.initial_velocity_ms ?? 0) < 0) errors.push('Uphill launches leave the top of this finite ramp; use a downhill initial velocity or a sandbox scene.')
    if (given.body_motion === 'rolling' && given.body_shape === null) errors.push('A rolling incline requires body_shape (sphere, disc or hoop).')
  }
  // Keep textbook motion below the emergency numerical guard (60 m/s).
  const g = given.gravity_ms2!
  let peak2 = 0
  if (problem_type === 'projectile') peak2 = (given.v0_ms ?? 0) ** 2 + 2 * g * (given.h0_m ?? 0)
  if (problem_type === 'inclined_plane') peak2 = (given.initial_velocity_ms ?? 0) ** 2 + 2 * g * (given.ramp_length_m ?? 0)
  if (problem_type === 'pendulum') peak2 = 2 * g * (given.length_m ?? 0) * (1 - Math.cos((given.theta0_deg ?? 0) * Math.PI / 180))
  if (peak2 >= MAX_UNFORCED_SPEED_MS ** 2) errors.push(`These givens exceed the supported simulation energy range (peak speed must stay below ${MAX_UNFORCED_SPEED_MS} m/s). Reduce the speed, height or length.`)
  let frequency = 0
  if (problem_type === 'circular_motion' && given.radius_m) frequency = (given.v0_ms ?? 0) / given.radius_m
  if (problem_type === 'charged_particle_magnetic' && given.mass_kg) frequency = Math.abs((given.charge_c ?? 0) * (given.b_field_tesla ?? 0) / given.mass_kg)
  if (problem_type === 'pendulum' && given.length_m) frequency = Math.sqrt(g / given.length_m)
  if (frequency > MAX_ORBIT_FREQUENCY_RADS) errors.push(`This motion is too fast for the 120 Hz solver (${frequency.toFixed(2)} rad/s; maximum ${MAX_ORBIT_FREQUENCY_RADS}). Increase the radius, length or mass, or reduce the speed or magnetic field.`)

  // --- required fields for this type --------------------------------------
  if (typeof problem_type === 'string' && (PROBLEM_TYPES as readonly string[]).includes(problem_type)) {
    for (const key of REQUIRED_BY_TYPE[problem_type as ProblemType]) {
      if (given[key] === null) {
        errors.push(`${problem_type} requires given.${key}, which was not extracted`)
      }
    }
  }

  // --- objects ------------------------------------------------------------
  const rawObjects = Array.isArray(r['objects']) ? r['objects'] : []
  if (!Array.isArray(r['objects'])) repairs.push('objects missing or not an array; treated as empty')

  const seenIds = new Set<string>()
  const objects: SpecObject[] = []
  for (const [i, item] of rawObjects.entries()) {
    if (typeof item !== 'object' || item === null) {
      repairs.push(`objects[${i}] is not an object; dropped`)
      continue
    }
    const o = item as Record<string, unknown>

    const kind = o['kind']
    if (typeof kind !== 'string' || !(OBJECT_KINDS as readonly string[]).includes(kind)) {
      repairs.push(`objects[${i}].kind = ${JSON.stringify(kind)} is not a known kind; dropped`)
      continue
    }
    const objKind = kind as ObjectKind

    let id = typeof o['id'] === 'string' && o['id'].length > 0 ? o['id'] : `${objKind}_${i}`
    if (seenIds.has(id)) {
      const unique = `${id}_${i}`
      repairs.push(`duplicate object id "${id}"; renamed to "${unique}"`)
      id = unique
    }
    seenIds.add(id)

    // Ramps, walls, ground and pivots are never pushable. Plan §4. Enforced here
    // so a model hallucinating interactable:true on a ramp cannot reach the sim.
    let interactable = o['interactable'] === true
    if (interactable && STATIC_KINDS.includes(objKind)) {
      repairs.push(`objects[${i}] ("${id}") is a ${objKind}; interactable forced to false`)
      interactable = false
    }

    let mass_kg: number | null = isFiniteNumber(o['mass_kg']) ? o['mass_kg'] : null
    if (mass_kg !== null && mass_kg <= 0) {
      repairs.push(`objects[${i}] ("${id}") mass_kg = ${mass_kg} is not positive; dropped`)
      mass_kg = null
    }

    const rawDims = Array.isArray(o['dims_m']) ? o['dims_m'] : []
    const dims_m = rawDims.filter(isFiniteNumber).map((d) => Math.abs(d)).filter((d) => d > 0)
    if (dims_m.length !== rawDims.length) {
      repairs.push(`objects[${i}] ("${id}") had non-positive or non-numeric dims_m entries; dropped`)
    }

    const rawPos = Array.isArray(o['position_m']) ? o['position_m'] : []
    const px = isFiniteNumber(rawPos[0]) ? rawPos[0] : 0
    const py = isFiniteNumber(rawPos[1]) ? rawPos[1] : 0
    if (rawPos.length !== 2 || !isFiniteNumber(rawPos[0]) || !isFiniteNumber(rawPos[1])) {
      repairs.push(`objects[${i}] ("${id}") position_m was not a numeric pair; defaulted to [0, 0]`)
    }

    objects.push({
      id,
      kind: objKind,
      interactable,
      mass_kg,
      dims_m,
      position_m: [px, py],
      angle_deg: isFiniteNumber(o['angle_deg']) ? o['angle_deg'] : null,
    })
  }

  // --- asked_for ----------------------------------------------------------
  const rawAsked = Array.isArray(r['asked_for']) ? r['asked_for'] : []
  const asked_for = rawAsked.filter(
    (a): a is Askable => typeof a === 'string' && (ASKABLE as readonly string[]).includes(a),
  )
  if (asked_for.length !== rawAsked.length) {
    repairs.push('asked_for contained entries the derivation panel does not know how to solve; dropped')
  }

  const raw_text = typeof r['raw_text'] === 'string' ? r['raw_text'] : ''

  if (errors.length > 0) {
    return { ok: false, spec: null, repairs, errors, needsConfirmation: true }
  }

  return {
    ok: true,
    spec: {
      problem_type: problem_type as ProblemType,
      confidence,
      given,
      objects,
      asked_for,
      raw_text,
    },
    repairs,
    errors,
    needsConfirmation: confidence < CONFIDENCE_FLOOR || repairs.length > 0,
  }
}
