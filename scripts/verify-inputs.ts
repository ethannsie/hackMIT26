import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { MockHandSource } from '../src/hand/mock.ts'
import { RemoteHandSource } from '../src/hand/remote.ts'
import { Recorder } from '../src/ask/recorder.ts'
import { LatestRequest } from '../src/net/latest.ts'
import { request } from '../src/net/request.ts'

let now = 0
const originalPerformance = globalThis.performance
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } })
const win = Object.assign(new EventTarget(), { location: { search: '' } })
Object.defineProperty(globalThis, 'window', { configurable: true, value: win })
function event(target: EventTarget, type: string, props: object = {}) { target.dispatchEvent(Object.assign(new Event(type), props)) }
const element = new EventTarget()
const hand = new MockHandSource({ element: element as HTMLElement, toScene: (x, y) => [x, y] })
await hand.start()
event(element, 'mousemove', { clientX: 1, clientY: 2 }); now = 20
event(element, 'mousemove', { clientX: 2, clientY: 3 })
event(element, 'mousedown'); assert.equal(hand.current()!.fist, 1)
event(win, 'mouseup'); assert.equal(hand.current()!.fist, 0); assert.ok(hand.current()!.palm_m.z > 0)
now = 200; assert.equal(hand.current()!.palm_velocity_ms.x, 0)
event(win, 'keydown', { key: 'Shift' }); assert.equal(hand.current()!.pinch, 1)
event(win, 'blur'); assert.equal(hand.current(), null)
event(element, 'mousemove', { clientX: 2, clientY: 3 }); assert.equal(hand.current()!.pinch, 0)
hand.stop(); await hand.start(); event(element, 'mousemove', { clientX: 2, clientY: 3 }); assert.equal(hand.current()!.fist, 0); hand.stop()
console.log('PASS mouse release, stale velocity, blur and restart')

class Events extends EventTarget { static last: Events; constructor(_url: string) { super(); Events.last = this } close() {} }
Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: Events })
const remote = new RemoteHandSource({ base: 'http://localhost' }); await remote.start()
const payload = { t_ms: 42, handedness: 'right', confidence: 1, palm_m: { x: 0, y: 0, z: 0 }, palm_velocity_ms: { x: 1, y: 0, z: 0 }, pinch: 0, fist: 1 }
event(Events.last, 'hand', { data: JSON.stringify(payload) }); assert.ok(remote.current())
now += 301; event(Events.last, 'hand', { data: JSON.stringify(payload) }); assert.equal(remote.current(), null)
event(Events.last, 'hand', { data: JSON.stringify({ ...payload, t_ms: 43 }) }); assert.ok(remote.current())
event(Events.last, 'hand', { data: 'null' }); assert.equal(remote.current(), null); remote.stop()
console.log('PASS repeated SSE timestamps cannot revive a stale hand')

const latest = new LatestRequest(), first = latest.begin(), second = latest.begin()
assert.ok(first.signal.aborted && !first.current() && second.current()); latest.cancel(); assert.ok(!second.current())
console.log('PASS newer requests and edits invalidate older results')

let grant: (s: MediaStream) => void = () => {}, stopped = 0, failConstructor = false, failStart = false
const stream = () => ({ getTracks: () => [{ stop: () => stopped++ }] }) as unknown as MediaStream
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise<MediaStream>(resolve => { grant = resolve }) } } })
class Media extends EventTarget {
  state = 'inactive'; mimeType = 'audio/webm'
  static isTypeSupported() { return true }
  constructor(_stream: MediaStream) { super(); if (failConstructor) throw new Error('constructor failed') }
  start() { if (failStart) throw new Error('start failed'); this.state = 'recording' }
  stop() { this.state = 'inactive'; event(this, 'stop') }
}
Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Media })
const mic = new Recorder()
const pending = mic.record(20); const oldGrant = grant
assert.equal(mic.recording, true)
await assert.rejects(mic.record(20), /already recording/)
mic.stop(); await assert.rejects(pending, /cancelled/); oldGrant(stream()); await Promise.resolve(); assert.equal(stopped, 1)
for (const phase of ['constructor', 'start', 'success']) {
  failConstructor = phase === 'constructor'; failStart = phase === 'start'
  const capture = mic.record(20); grant(stream()); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  if (phase === 'success') { now += 1000; mic.stop(); await capture } else await assert.rejects(capture, /failed/)
  assert.equal(mic.recording, false)
}
assert.equal(stopped, 4)
console.log('PASS microphone overlap, cancelled permission, constructor/start failures and normal cleanup')

Object.defineProperty(globalThis, 'performance', { configurable: true, value: originalPerformance })
const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); })
server.listen(0, '127.0.0.1'); await once(server, 'listening')
try {
  const port = (server.address() as { port: number }).port
  const response = await request(`http://127.0.0.1:${port}`, {}, 100)
  await assert.rejects(response.json(), /abort|timeout/i)
  console.log('PASS request deadline also aborts a stalled response body')
} finally { server.closeAllConnections(); server.close() }
