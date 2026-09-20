/** A new intent invalidates every earlier result, including work already parsing. */
export class LatestRequest {
  private controller: AbortController | null = null
  cancel(): void { this.controller?.abort(); this.controller = null }
  begin(): { signal: AbortSignal; current: () => boolean } {
    this.cancel()
    const controller = new AbortController()
    this.controller = controller
    return { signal: controller.signal, current: () => this.controller === controller && !controller.signal.aborted }
  }
}
