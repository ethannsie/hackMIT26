import { request } from '../net/request.ts'
/**
 * Browser side of stage [2]: compress, send, receive a validated ProblemSpec.
 */
import { compressImage, type CompressedImage } from './compress.ts'
import type { ValidationResult } from '../spec/validate.ts'

export interface ExtractResult extends ValidationResult {
  /** Which backend answered: the on-device GX10, or the hosted API. */
  source: 'local' | 'openai'
  elapsed_ms: number
  /** What compression achieved, for the debug overlay. */
  image: CompressedImage
}

export async function extractFromImage(file: Blob, signal?: AbortSignal): Promise<ExtractResult> {
  const image = await compressImage(file)

  const res = await request('/api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: image.dataUrl }),
    signal,
  }, 180_000)

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`extraction failed (${res.status}): ${detail}`)
  }

  const body = (await res.json()) as Omit<ExtractResult, 'image'>
  return { ...body, image }
}
