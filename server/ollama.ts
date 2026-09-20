/**
 * Ollama's native chat endpoint, for the text-only jobs.
 *
 * Extraction stays on the OpenAI-compatible `/v1` route (server/index.ts);
 * this exists because that route cannot switch a model's reasoning off, and
 * nemotron-3.5-lightning reasons by default. Measured on the GX10 for a
 * schema-constrained problem: 31 s with thinking (6,850 characters of it),
 * 5.5 s without. At a demo table the second one is the only usable one, and
 * the consistency check in generate keeps the quality honest.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model: string
  messages: ChatMessage[]
  /** JSON schema to constrain the reply to, or nothing for prose. */
  format?: unknown
  temperature?: number
  /** Cap on generated tokens. */
  maxTokens?: number
  timeoutMs: number
}

export interface ChatResult {
  content: string
  evalTokens: number
}

/** `http://host:11434/v1` -> `http://host:11434`; native routes hang off the root. */
export function nativeBase(openAiCompatUrl: string): string {
  return openAiCompatUrl.replace(/\/v1\/?$/, '')
}

export async function chat(base: string, opts: ChatOptions): Promise<ChatResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        // The whole reason this file exists.
        think: false,
        messages: opts.messages,
        ...(opts.format ? { format: opts.format } : {}),
        options: {
          temperature: opts.temperature ?? 0.7,
          ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
        },
      }),
    })
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as { message?: { content?: string }; eval_count?: number }
    const content = data.message?.content?.trim() ?? ''
    if (!content) throw new Error(`${opts.model} returned an empty response`)
    return { content, evalTokens: data.eval_count ?? 0 }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`${opts.model} timed out after ${opts.timeoutMs} ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}
