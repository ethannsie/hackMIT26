export interface Recording { blob: Blob; seconds: number }

/** One owned capture session, including the permission prompt and final flush. */
export class Recorder {
  private active: { cancel: AbortController; recorder?: MediaRecorder } | null = null

  get recording(): boolean { return this.active !== null }

  async record(maxSeconds: number, onTick?: (remaining: number) => void): Promise<Recording> {
    if (this.active) throw new Error('already recording')
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no microphone access in this browser')
    const session = { cancel: new AbortController(), recorder: undefined as MediaRecorder | undefined }
    this.active = session
    let stream: MediaStream | undefined
    let ticker: ReturnType<typeof setInterval> | undefined
    let limit: ReturnType<typeof setTimeout> | undefined
    const permissionLimit = setTimeout(() => session.cancel.abort(), 30_000)
    try {
      const pending = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      // A permission prompt cannot be cancelled by the browser API. If it later
      // grants access to an expired session, release those tracks immediately.
      pending.then(s => { if (session.cancel.signal.aborted) s.getTracks().forEach(t => t.stop()) }, () => {})
      stream = await Promise.race([
        pending,
        new Promise<never>((_, reject) => session.cancel.signal.addEventListener('abort', () => reject(new Error('Microphone startup cancelled or timed out')), { once: true })),
      ])
      clearTimeout(permissionLimit)
      if (session.cancel.signal.aborted) throw new Error('Microphone startup cancelled')
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m))
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      session.recorder = recorder
      const chunks: Blob[] = []
      const started = performance.now()
      return await new Promise<Recording>((resolve, reject) => {
        recorder.addEventListener('dataavailable', e => { if (e.data.size) chunks.push(e.data) })
        recorder.addEventListener('stop', () => resolve({ blob: new Blob(chunks, { type: recorder.mimeType }), seconds: (performance.now() - started) / 1000 }), { once: true })
        recorder.addEventListener('error', () => reject(new Error('recording failed')), { once: true })
        limit = setTimeout(() => this.stop(), maxSeconds * 1000)
        ticker = setInterval(() => onTick?.(Math.max(0, Math.ceil(maxSeconds - (performance.now() - started) / 1000))), 250)
        recorder.start()
        onTick?.(maxSeconds)
      })
    } finally {
      clearTimeout(permissionLimit)
      clearTimeout(limit)
      clearInterval(ticker)
      session.cancel.abort()
      stream?.getTracks().forEach(t => t.stop())
      if (this.active === session) this.active = null
    }
  }

  stop(): void {
    const session = this.active
    if (!session) return
    if (session.recorder?.state === 'recording') session.recorder.stop()
    else if (!session.recorder) session.cancel.abort()
  }
}
