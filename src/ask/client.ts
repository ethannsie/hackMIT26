/**
 * Browser side of the two text jobs the local model does: writing a problem
 * and answering a visitor. Same /api proxy as extraction; the browser never
 * talks to Ollama or Deepgram directly.
 */
import type { ValidationResult } from '../spec/validate.ts'

export interface GenerateResult extends ValidationResult {
  source: 'local'
  /** The scene the prompt asked for, e.g. "a stone from a cliff". For the status line. */
  setting: string
  elapsed_ms: number
}

export interface AskContext {
  raw_text?: string
  /** "period_s = 2.01 s" lines, so the tutor can refer to the numbers on screen. */
  solutions?: string[]
}

export interface AskResult {
  question: string
  answer: string
  /** "University Physics Volume 1 — 11.1 Rolling Motion", for attribution. */
  sources: string[]
  elapsed_ms: number
}

export interface TranscribeResult {
  text: string
  confidence: number
  elapsed_ms: number
}

async function failure(res: Response): Promise<Error> {
  let detail = ''
  try {
    detail = ((await res.json()) as { error?: string }).error ?? ''
  } catch {
    detail = await res.text().catch(() => '')
  }
  return new Error(detail || `${res.status} ${res.statusText}`)
}

export async function generateProblem(problem_type?: string): Promise<GenerateResult> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ problem_type }),
  })
  if (!res.ok) throw await failure(res)
  return (await res.json()) as GenerateResult
}

export async function askQuestion(question: string, context: AskContext): Promise<AskResult> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, context }),
  })
  if (!res.ok) throw await failure(res)
  return (await res.json()) as AskResult
}

export async function transcribe(audio: Blob): Promise<TranscribeResult> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': audio.type || 'audio/webm' },
    body: audio,
  })
  if (!res.ok) throw await failure(res)
  return (await res.json()) as TranscribeResult
}

export type VoiceState = 'ready' | 'offline' | 'no-key'

/** Whether a spoken question can be transcribed right now. */
export async function voiceState(): Promise<VoiceState> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' })
    if (!res.ok) return 'offline'
    const data = (await res.json()) as { voice?: VoiceState }
    return data.voice ?? 'no-key'
  } catch {
    return 'offline'
  }
}
