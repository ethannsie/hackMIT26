/**
 * Client-side image compression, run before anything is sent to the model.
 *
 * Why it matters: a modern phone photo is ~4000px wide and costs a few thousand
 * image tokens. Vision models tile images at 512px, so detail beyond what the
 * tiles can resolve is paid for and then discarded. Downscaling the long edge to
 * 1024px and re-encoding as JPEG typically cuts a 4 MB capture to under 200 KB
 * with no measurable loss in extraction quality on printed text.
 *
 * On $50 of credit, that difference is the difference between a few hundred
 * demo captures and a few thousand.
 */

export interface CompressOptions {
  /** Longest edge after downscaling, in pixels. 1024 keeps printed text legible. */
  maxEdgePx?: number
  /** JPEG quality, 0..1. */
  quality?: number
  /** Give up shrinking once under this, to avoid over-degrading a hard photo. */
  targetBytes?: number
}

export interface CompressedImage {
  /** `data:image/jpeg;base64,...`, ready to hand to the API. */
  dataUrl: string
  bytes: number
  width: number
  height: number
  originalBytes: number
}

const DEFAULTS: Required<CompressOptions> = {
  maxEdgePx: 1024,
  quality: 0.72,
  targetBytes: 220_000,
}

function loadBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file)
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      quality,
    )
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'))
    fr.readAsDataURL(blob)
  })
}

export async function compressImage(
  file: Blob,
  options: CompressOptions = {},
): Promise<CompressedImage> {
  const { maxEdgePx, quality, targetBytes } = { ...DEFAULTS, ...options }
  const bitmap = await loadBitmap(file)

  const scale = Math.min(1, maxEdgePx / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  // White backdrop: JPEG has no alpha, and a transparent PNG would otherwise
  // flatten to black and swallow the text.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  let q = quality
  let blob = await encode(canvas, q)
  // Step quality down only while we are still well over target. Printed text
  // degrades badly below ~0.5, so that is the floor.
  while (blob.size > targetBytes && q > 0.5) {
    q -= 0.1
    blob = await encode(canvas, q)
  }

  return {
    dataUrl: await blobToDataUrl(blob),
    bytes: blob.size,
    width,
    height,
    originalBytes: file.size,
  }
}
