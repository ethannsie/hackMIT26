export type VoiceState = 'ready' | 'offline' | 'no-key' | 'invalid-key' | 'unavailable'

/** Reachability is insufficient: reject invalid credentials, quotas and 5xx. */
export function voiceStatus(status: number): VoiceState {
  if (status >= 200 && status < 300) return 'ready'
  if (status === 401 || status === 403) return 'invalid-key'
  return 'unavailable'
}
