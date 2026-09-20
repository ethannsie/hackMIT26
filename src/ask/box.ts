/**
 * The Ask box: a visitor's question in, the local model's answer out.
 *
 * Two ways in. Typed, which always works; and spoken, which records from the
 * webcam's mic, sends the clip to /api/transcribe (Deepgram, the one hosted
 * piece) and drops the words into the same field. Either way the question
 * goes to /api/ask with whatever problem is on screen as context, so "why is
 * it only 2.8?" means something.
 *
 * The panel's "Ask a question" tile lands on record() too, so the touchscreen
 * can start a recording that plays out on the big screen.
 */
import { askQuestion, transcribe, voiceState, type AskContext, type VoiceState } from './client.ts'
import { Recorder } from './recorder.ts'

/**
 * Longest the mic listens, seconds. Press-to-stop is the normal way to end
 * it; this is the ceiling for a visitor who walks off mid-sentence.
 */
const RECORD_SECONDS = 20

/** Where the Ask box is, mirrored to the touchscreen and the on-stage banner. */
export interface AskPhase {
  phase: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'answered' | 'error'
  seconds_left?: number
  heard?: string
  answer?: string
  error?: string
}

export class AskBox {
  private readonly input: HTMLInputElement
  private readonly askBtn: HTMLButtonElement
  private readonly micBtn: HTMLButtonElement
  private readonly state: HTMLElement
  private readonly answer: HTMLElement
  private readonly sources: HTMLElement
  private readonly recorder = new Recorder()
  private busy = false
  /** Follows /api/health: the mic only lights up when Deepgram is reachable. */
  private voice: VoiceState = 'offline'

  constructor(
    root: HTMLElement,
    /** What is on screen right now, sent along with every question. */
    private readonly context: () => AskContext,
    private readonly setStatus: (text: string, tone?: 'ok' | 'warn' | 'error') => void,
    /** Every phase change, for the panel's Ask view and the banner over the sim. */
    private readonly onPhase: (p: AskPhase) => void = () => {},
  ) {
    root.innerHTML = `
      <h4>Ask about the physics</h4>
      <div class="ask-row">
        <input id="ask-input" type="text" placeholder="e.g. why does the block slow down?" autocomplete="off" />
        <button id="ask-mic" class="icon-btn" disabled>🎤</button>
        <button id="ask-send" title="Ask (Enter)">Ask</button>
      </div>
      <div id="ask-state" class="ask-state" hidden></div>
      <div id="ask-answer" class="ask-answer" hidden></div>
      <div id="ask-sources" class="ask-sources" hidden></div>`
    this.input = root.querySelector('#ask-input')!
    this.askBtn = root.querySelector('#ask-send')!
    this.micBtn = root.querySelector('#ask-mic')!
    this.state = root.querySelector('#ask-state')!
    this.answer = root.querySelector('#ask-answer')!
    this.sources = root.querySelector('#ask-sources')!

    this.askBtn.addEventListener('click', () => void this.ask())
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void this.ask()
      }
    })
    this.micBtn.addEventListener('click', () => void this.record())

    // Online-only by design: the mic is disabled whenever the box cannot
    // reach the transcription service, so nobody talks into a dead button.
    void this.refreshVoice()
    setInterval(() => void this.refreshVoice(), 30_000)
  }

  private async refreshVoice(): Promise<void> {
    this.voice = await voiceState()
    const ready = this.voice === 'ready'
    this.micBtn.disabled = !ready && !this.recorder.recording
    this.micBtn.title = ready
      ? `Press to start listening, press again to stop (up to ${RECORD_SECONDS} s)`
      : this.voice === 'no-key'
        ? 'Voice needs DEEPGRAM_API_KEY in .env — type the question instead'
        : this.voice === 'invalid-key' ? 'Voice credentials were rejected — type the question instead'
        : this.voice === 'unavailable' ? 'Transcription service unavailable — type the question instead'
        : 'Voice needs the internet and the box is offline — type the question instead'
  }

  private voiceBlocked(): string | null {
    if (this.voice === 'ready') return null
    return this.voice === 'no-key'
      ? 'voice is off: no Deepgram key on this box — type the question instead'
      : this.voice === 'invalid-key' ? 'voice is off: Deepgram rejected the key — type the question instead'
      : this.voice === 'unavailable' ? 'voice is off: transcription service unavailable — type the question instead'
      : 'voice is off: the box is offline — type the question instead'
  }

  focus(): void {
    this.input.focus()
  }

  /** Send whatever is typed. */
  async ask(question = this.input.value.trim()): Promise<void> {
    if (!question || this.busy || this.recorder.recording) return
    this.input.value = question
    this.setBusy(true, 'thinking…')
    this.onPhase({ phase: 'thinking', heard: question })
    try {
      const result = await askQuestion(question, this.context())
      this.answer.textContent = result.answer
      this.answer.hidden = false
      if (result.sources.length) {
        this.sources.textContent = `From ${result.sources.join(' · ')} (OpenStax, CC BY-NC-SA 4.0)`
        this.sources.hidden = false
      } else {
        this.sources.hidden = true
      }
      this.showState(`answered in ${(result.elapsed_ms / 1000).toFixed(1)} s`)
      this.onPhase({ phase: 'answered', heard: question, answer: result.answer })
    } catch (err) {
      this.showState((err as Error).message, 'error')
      this.onPhase({ phase: 'error', heard: question, error: (err as Error).message })
    } finally {
      this.setBusy(false)
    }
  }

  /** Is the mic open right now? */
  get listening(): boolean {
    return this.recorder.recording
  }

  /** Stop an open recording and go on to transcribe it. No-op otherwise. */
  stop(): void {
    if (this.recorder.recording) this.recorder.stop()
  }

  /** The panel's button: start if idle, stop if listening. */
  toggle(): void {
    if (this.recorder.recording) this.stop()
    else void this.record()
  }

  /**
   * Listen until stop() or the ceiling, transcribe, then ask. Press-to-start,
   * press-to-stop: the mic button, `M`, and the panel's button all land here.
   */
  async record(): Promise<void> {
    if (this.busy) return
    if (this.recorder.recording) {
      this.recorder.stop()
      return
    }
    const blocked = this.voiceBlocked()
    if (blocked) {
      this.showState(blocked, 'warn')
      this.setStatus(blocked, 'warn')
      this.onPhase({ phase: 'error', error: blocked })
      this.focus()
      return
    }
    this.answer.hidden = true
    this.sources.hidden = true
    this.showState('Waiting for microphone permission…', 'warn')
    this.micBtn.classList.add('on')
    this.micBtn.textContent = '■'
    this.micBtn.title = 'Stop and ask'
    let heardText = ''
    try {
      const clip = await this.recorder.record(RECORD_SECONDS, (left) => {
        this.showState(`listening… press again to stop (${left} s left)`, 'warn')
        this.onPhase({ phase: 'listening', seconds_left: left })
      })
      this.micBtn.classList.remove('on')
      this.micBtn.textContent = '🎤'
      if (clip.seconds < 0.6) {
        const msg = 'that was too short — press once to start, speak, press again to stop'
        this.showState(msg, 'warn')
        this.onPhase({ phase: 'error', error: msg })
        return
      }
      this.setBusy(true, 'working out what you said…')
      this.onPhase({ phase: 'transcribing' })
      const heard = await transcribe(clip.blob)
      heardText = heard.text.trim()
      if (!heardText) {
        const msg = 'did not catch that — try again, closer to the camera'
        this.showState(msg, 'warn')
        this.onPhase({ phase: 'error', error: msg })
        return
      }
      this.input.value = heardText
      this.setBusy(false)
      await this.ask(heardText)
    } catch (err) {
      this.showState((err as Error).message, 'error')
      this.setStatus(`ask: ${(err as Error).message}`, 'error')
      this.onPhase({ phase: 'error', heard: heardText || undefined, error: (err as Error).message })
    } finally {
      this.micBtn.classList.remove('on')
      this.micBtn.textContent = '🎤'
      this.setBusy(false)
      void this.refreshVoice()
    }
  }

  private setBusy(busy: boolean, label?: string): void {
    this.busy = busy
    this.askBtn.disabled = busy
    this.input.disabled = busy
    if (label) this.showState(label, 'warn')
  }

  private showState(text: string, tone: 'ok' | 'warn' | 'error' = 'ok'): void {
    this.state.textContent = text
    this.state.dataset['tone'] = tone
    this.state.hidden = false
  }
}
