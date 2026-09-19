/**
 * JSON Schema for ProblemSpec, shaped for OpenAI structured outputs in
 * `strict: true` mode. That mode is what makes extraction deterministic in
 * shape: the model physically cannot return a key we did not ask for.
 *
 * Its constraints drive some odd-looking choices here:
 *   - every property must appear in `required` (no optional keys)
 *   - optionality is expressed as a nullable type instead
 *   - every object needs additionalProperties: false
 *   - numeric bounds (minimum/maximum) are NOT supported, so range checking
 *     lives in ./validate.ts rather than in the schema
 */
import { PROBLEM_TYPES, ASKABLE, OBJECT_KINDS } from './types.ts'

const nullableNumber = { type: ['number', 'null'] } as const

const GIVEN_NUMBER_KEYS = [
  'gravity_ms2',
  'v0_ms',
  'launch_angle_deg',
  'h0_m',
  'incline_angle_deg',
  'ramp_length_m',
  'mass_kg',
  'mu_kinetic',
  'initial_velocity_ms',
  'length_m',
  'theta0_deg',
  'm1_kg',
  'm2_kg',
  'v1_ms',
  'v2_ms',
  'restitution',
] as const

const givenProperties: Record<string, unknown> = Object.fromEntries(
  GIVEN_NUMBER_KEYS.map((k) => [k, nullableNumber]),
)
givenProperties['body_motion'] = { type: ['string', 'null'], enum: ['sliding', 'rolling', null] }

export const PROBLEM_SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['problem_type', 'confidence', 'given', 'objects', 'asked_for', 'raw_text'],
  properties: {
    problem_type: { type: 'string', enum: [...PROBLEM_TYPES] },
    confidence: { type: 'number' },
    given: {
      type: 'object',
      additionalProperties: false,
      required: [...GIVEN_NUMBER_KEYS, 'body_motion'],
      properties: givenProperties,
    },
    objects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'interactable', 'mass_kg', 'dims_m', 'position_m', 'angle_deg'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: [...OBJECT_KINDS] },
          interactable: { type: 'boolean' },
          mass_kg: nullableNumber,
          dims_m: { type: 'array', items: { type: 'number' } },
          position_m: { type: 'array', items: { type: 'number' } },
          angle_deg: nullableNumber,
        },
      },
    },
    asked_for: { type: 'array', items: { type: 'string', enum: [...ASKABLE] } },
    raw_text: { type: 'string' },
  },
} as const

/** Wrapper the Chat Completions API expects for `response_format`. */
export const RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'problem_spec',
    strict: true,
    schema: PROBLEM_SPEC_SCHEMA,
  },
}
