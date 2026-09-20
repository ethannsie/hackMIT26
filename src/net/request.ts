/** Abort covers both the response headers and subsequent body consumption. */
export function request(url: string, init: RequestInit = {}, timeoutMs = 8_000): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline
  return fetch(url, { ...init, signal })
}
