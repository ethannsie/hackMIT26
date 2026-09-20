/** Runtime contracts at the HTTP boundary. Types alone do not validate JSON. */
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface AskBody {
  question: string
  context?: { raw_text?: string; solutions?: string[]; current_givens?: string }
}

export function validAsk(value: unknown): value is AskBody {
  if (!object(value) || typeof value.question !== 'string' || !value.question.trim() || value.question.length > 2000) return false
  if (value.context === undefined) return true
  const ctx = value.context
  if (!object(ctx)) return false
  if (ctx.raw_text !== undefined && (typeof ctx.raw_text !== 'string' || ctx.raw_text.length > 12000)) return false
  if (ctx.current_givens !== undefined && (typeof ctx.current_givens !== 'string' || ctx.current_givens.length > 4000)) return false
  return ctx.solutions === undefined || (Array.isArray(ctx.solutions) && ctx.solutions.length <= 32 &&
    ctx.solutions.every(s => typeof s === 'string' && s.length <= 1000))
}

function vector(v: unknown): boolean {
  return object(v) && ['x', 'y', 'z'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k]))
}

export function validHand(value: unknown): boolean {
  if (!object(value)) return false
  return typeof value.t_ms === 'number' && Number.isFinite(value.t_ms) &&
    (value.handedness === 'left' || value.handedness === 'right') &&
    ['confidence', 'pinch'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k]) && value[k] >= 0 && value[k] <= 1) &&
    (value.fist === undefined || (typeof value.fist === 'number' && Number.isFinite(value.fist) && value.fist >= 0 && value.fist <= 1)) &&
    vector(value.palm) && vector(value.palm_velocity) &&
    (value.landmarks === undefined || (Array.isArray(value.landmarks) && value.landmarks.length === 21 && value.landmarks.every(vector)))
}
