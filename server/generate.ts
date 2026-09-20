/**
 * Prompts for the two text-only jobs the local model does besides reading
 * photos: writing a fresh problem, and answering a question at the table.
 *
 * Both run on the GX10's Ollama, through the native chat route with reasoning
 * off (server/ollama.ts). Problem generation reuses the extraction schema, so a generated
 * problem is a ProblemSpec the moment it comes back — same validator, same
 * builders, same derivation. The model writes the statement AND the numbers;
 * nothing else has to parse the statement afterwards.
 */
import { PROBLEM_TYPES, type ProblemSpec, type ProblemType } from '../src/spec/types.ts'

/**
 * Which `given` fields a generated problem of each type must fill, with the
 * ranges the sim's sliders cover, so a generated problem is one the sliders
 * can then vary rather than something clamped on arrival.
 */
const FIELDS: Record<ProblemType, string> = {
  projectile:
    'v0_ms (3–30), launch_angle_deg (10–80), h0_m (0–10). asked_for from: time_of_flight_s, range_m, apex_height_m.',
  inclined_plane:
    'incline_angle_deg (10–50), ramp_length_m (0.5–5), mass_kg (0.5–20), mu_kinetic (0–0.5, or 0 if frictionless), initial_velocity_ms (0 unless stated), body_motion ("sliding" for a block, "rolling" for a ball/cylinder). asked_for from: acceleration_ms2, normal_force_n, time_to_bottom_s, final_velocity_ms.',
  pendulum:
    'length_m (0.2–4), theta0_deg (5–60), mass_kg (0.1–10). asked_for from: period_s, angular_frequency_rads, max_speed_ms, tension_n.',
  collision_1d:
    'm1_kg, m2_kg (0.1–10), v1_ms, v2_ms (−10–10, one may be 0), restitution (1 elastic, 0 perfectly inelastic, or a stated value). asked_for from: v1_final_ms, v2_final_ms, kinetic_energy_lost_j.',
  rolling_without_slipping:
    'radius_m (0.05–1.5), mass_kg (0.1–20), v0_ms (0.2–8), body_shape (disc, sphere, hoop). asked_for from: angular_frequency_rads, contact_point_speed_ms, top_point_speed_ms, rotational_ke_fraction.',
  circular_motion:
    'radius_m (0.2–3), v0_ms (0.2–10) as the constant speed, mass_kg (0.1–10). asked_for from: centripetal_acceleration_ms2, centripetal_force_n, period_s.',
  charged_particle_magnetic:
    'charge_c (−3–3, non-zero), b_field_tesla (−3–3, non-zero; positive is out of the page), v0_ms (0.2–8), mass_kg (0.1–5), launch_angle_deg (direction of travel, 0 = +x). asked_for from: orbit_radius_m, cyclotron_period_s, work_done_j.',
  rotating_frame:
    'omega_rads (−4–4, non-zero), v0_ms (0.1–6), launch_angle_deg (−180–180, direction of travel), mass_kg (0.1–10), radius_m (0–3, the starting distance from the axis). asked_for from: coriolis_acceleration_ms2, centrifugal_acceleration_ms2.',
  angular_momentum_point:
    'mass_kg (0.1–10), v0_ms (0.1–6), impact_parameter_m (−2–2, non-zero). asked_for from: angular_momentum_kgm2s, torque_nm, areal_velocity_m2s.',
}

/** Scene dressings, so two generated problems of one type are not the same problem twice. */
const SETTINGS: Record<ProblemType, string[]> = {
  projectile: ['a basketball shot', 'a stone from a cliff', 'a water balloon', 'a golf ball off a tee', 'a cannonball from a castle wall', 'a soccer free kick', 'a rock from a catapult'],
  inclined_plane: ['a crate on a loading ramp', 'a skier on a slope', 'a book on a tilted desk', 'a bowling ball rolling down a ramp', 'a toolbox on a truck ramp', 'a sled on a snowy hill'],
  pendulum: ['a wrecking ball', 'a grandfather clock', 'a child on a swing', 'a lamp hanging in a train', 'a museum Foucault pendulum', 'a conker on a string'],
  collision_1d: ['two air-track gliders', 'a shopping cart and a parked one', 'two curling stones', 'a railway car coupling to another', 'two ice-hockey pucks', 'bumper cars'],
  rolling_without_slipping: ['a bicycle wheel', 'a bowling ball', 'a can rolling off a table', 'a hula hoop', 'a rolling log', 'a marble'],
  circular_motion: ['a ball on a string', 'a car on a roundabout', 'a satellite model on a rod', 'a stone in a sling', 'a toy plane on a wire'],
  charged_particle_magnetic: ['a proton in a cyclotron', 'an electron in a cathode-ray tube', 'a charged dust grain', 'an alpha particle in a bubble chamber', 'an ion in a mass spectrometer'],
  rotating_frame: ['a puck on a merry-go-round', 'a ball rolled across a turntable', 'a hockey puck on a rotating rink', 'a marble on a spinning platform'],
  angular_momentum_point: ['a comet passing the Sun', 'a puck sliding past a post', 'a car passing a lamppost', 'a bird flying past a tower'],
}

export function pickType(requested?: string): ProblemType {
  if (requested && (PROBLEM_TYPES as readonly string[]).includes(requested)) return requested as ProblemType
  return PROBLEM_TYPES[Math.floor(Math.random() * PROBLEM_TYPES.length)]!
}

export function generatePrompt(type: ProblemType): { system: string; user: string; setting: string } {
  const settings = SETTINGS[type]
  const setting = settings[Math.floor(Math.random() * settings.length)]!
  const system = `You write introductory physics problems for a live demo and record their numbers in a fixed schema.

Write ONE new problem of type "${type}", two to four sentences, the way a good textbook would: a concrete situation, the given quantities with units, and a clear question. Then fill the schema with exactly the numbers you wrote.

RULES
1. problem_type is "${type}". confidence is 1. objects is an empty array.
2. raw_text is the full problem statement, verbatim, as a student would read it. Every number in the schema must appear in raw_text with its unit, and nothing in the schema may be a number the text does not state.
3. Fill these given fields and no others (leave the rest null): ${FIELDS[type]}
4. gravity_ms2 is 9.81 unless the problem is set somewhere else and says so.
5. Use SI units in the schema even if the text says centimetres or grams. Pick numbers that make the problem interesting but ordinary — nothing microscopic, nothing astronomical.
6. Ask for two or three of the listed quantities, in asked_for, in the order the text asks for them.
7. If something is launched or thrown horizontally, launch_angle_deg is 0; if it is dropped, v0_ms is 0. Otherwise every angle and speed must be written in the text.
8. Do not solve the problem or include an answer.`
  const user = `Setting: ${setting}. Vary the numbers from the obvious round ones (seed ${Math.floor(Math.random() * 1e6)}).`
  return { system, user, setting }
}

export const TUTOR_SYSTEM = `You are a physics tutor standing at a science-fair table beside an interactive simulation. A visitor just asked you a question out loud.

Answer in plain spoken English, at most 120 words, no LaTeX, no bullet lists, no headings. Give the physical idea first, then one concrete number or example if the current problem provides one. If the question is not about physics, say so kindly in one sentence and offer to talk about the simulation instead.

You may be given passages from an introductory physics textbook and the problem currently on screen. Prefer them over memory when they cover the question; never claim a passage says something it does not. Do not mention that you were given passages.`

/**
 * The statement and the schema must agree: every number the schema records
 * has to be one the text states. With reasoning off the model occasionally
 * writes "kicked horizontally" and records a 30° angle; this catches that so
 * the caller can ask for another draft rather than show a student a problem
 * whose animation does not match its words.
 *
 * Returns a description of the first mismatch, or null when consistent.
 */
export function numbersConsistent(spec: ProblemSpec): string | null {
  const inText = new Set<number>()
  for (const m of spec.raw_text.matchAll(/-?\d+(?:\.\d+)?/g)) inText.add(Number(m[0]))
  const stated = (v: number): boolean => {
    for (const t of inText) {
      // Same value, or the same value before a unit conversion the model
      // was told to do (cm -> m, g -> kg, km/h -> m/s), or a sign flip.
      for (const f of [1, 100, 1000, 3.6, 1 / 100, 1 / 1000, 1 / 3.6]) {
        if (Math.abs(Math.abs(t) * f - Math.abs(v)) <= 0.011 * Math.max(1, Math.abs(v))) return true
      }
    }
    return false
  }
  for (const [key, value] of Object.entries(spec.given)) {
    if (typeof value !== 'number') continue
    // Defaults the prompt allows the model to fill in without stating them.
    if (key === 'gravity_ms2' && Math.abs(value - 9.81) < 0.01) continue
    if (key === 'initial_velocity_ms' && value === 0) continue
    if (key === 'restitution' && (value === 0 || value === 1)) continue
    if (key === 'h0_m' && value === 0) continue
    if (key === 'radius_m' && value === 0 && spec.problem_type === 'rotating_frame') continue
    if (key === 'launch_angle_deg' && value === 0) continue
    if (!stated(value)) return `given.${key} = ${value} does not appear in the problem text`
  }
  return null
}
