/**
 * One spoken question, as a Blob.
 *
 * The mic is the C270's own (it enumerates as a USB audio device beside the
 * camera). Audio and video are separate devices to the browser, so this does
 * not fight the panel for the camera: the panel holds /dev/video0, we hold
 * the audio capture, and both are happy.
 *
 * Fixed-length rather than voice-activity-detected: at a demo table the room
 * never goes quiet, and a countdown the visitor can see beats a recorder
 * that decides for itself when they have finished.
 */

export interface Recording {
  blob: Blob
  seconds: number
}

export class Recorder {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null

  get recording(): boolean {
    return this.recorder?.state === 'recording'
  }

  /**
   * Record for up to `maxSeconds`. `onTick` gets the seconds remaining once
   * a second so the UI can count down; stop() ends it early.
   */
  async record(maxSeconds: number, onTick?: (remaining: number) => void): Promise<Recording> {
    if (this.recording) throw new Error('already recording')
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no microphone access in this browser')
    // Mono, with the browser's own noise suppression: a demo hall is loud.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(
      (m) => MediaRecorder.isTypeSupported(m),
    )
    const recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined)
    this.recorder = recorder
    const chunks: Blob[] = []
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    })

    const started = performance.now()
    return new Promise<Recording>((resolve, reject) => {
      const finish = (): void => {
        clearInterval(ticker)
        clearTimeout(limit)
        this.release()
        resolve({ blob: new Blob(chunks, { type: recorder.mimeType }), seconds: (performance.now() - started) / 1000 })
      }
      recorder.addEventListener('stop', finish, { once: true })
      recorder.addEventListener('error', () => {
        clearInterval(ticker)
        clearTimeout(limit)
        this.release()
        reject(new Error('recording failed'))
      }, { once: true })
      const limit = setTimeout(() => this.stop(), maxSeconds * 1000)
      const ticker = setInterval(() => {
        onTick?.(Math.max(0, Math.round(maxSeconds - (performance.now() - started) / 1000)))
      }, 250)
      onTick?.(maxSeconds)
      recorder.start()
    })
  }

  /** End the current recording now; the promise from record() resolves with what was captured. */
  stop(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop()
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.recorder = null
  }
}
