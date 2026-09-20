import assert from 'node:assert/strict'
import { LEVELS, type RopeLevel } from '../src/minigames/rope/levels.ts'
import { RopeWorld, segmentsMeet } from '../src/minigames/rope/physics.ts'
import { HandBlade } from '../src/minigames/rope/input.ts'
import type { HandFrame } from '../src/hand/types.ts'

let checks = 0
const test = (name: string, f: () => void) => { f(); console.log(`PASS ${name}`); checks++ }
const tick = (world: RopeWorld, seconds: number, hz = 60) => {
  for (let i = 0; i < seconds * hz; i++) world.advance(1 / hz)
}
const level = LEVELS[0]!
const cut = (w: RopeWorld) => w.swipe({ x: 570, y: 260 }, { x: 710, y: 260 })

test('Uncut candy stays suspended for 30 seconds', () => {
  const w = new RopeWorld(level); tick(w, 30)
  assert.equal(w.outcome, 'playing'); assert.equal(w.stars, 0)
  assert.ok(Math.abs(w.candy.y - level.candy.y) < 0.01)
})
test('One swipe releases candy, collects all three stars, and feeds creature', () => {
  const w = new RopeWorld(level)
  assert.equal(cut(w), 1); assert.equal(cut(w), 0)
  tick(w, 3)
  assert.equal(w.outcome, 'won'); assert.equal(w.stars, 3)
  assert.equal(w.events.filter(e => e.kind === 'star').length, 3)
  assert.equal(w.events.filter(e => e.kind === 'won').length, 1)
})
test('Missed and stationary swipes do not cut', () => {
  const w = new RopeWorld(level)
  assert.equal(w.swipe({ x: 20, y: 260 }, { x: 300, y: 260 }), 0)
  assert.equal(w.swipe({ x: 640, y: 260 }, { x: 640, y: 260 }), 0)
})
test('Fast crossing, near miss, and collinear disjoint geometry', () => {
  assert.ok(segmentsMeet({ x: 450, y: 250 }, { x: 800, y: 250 }, { x: 640, y: 155 }, { x: 640, y: 350 }))
  assert.ok(!segmentsMeet({ x: 650, y: 260 }, { x: 750, y: 260 }, { x: 640, y: 155 }, { x: 640, y: 350 }))
  assert.ok(!segmentsMeet({ x: 640, y: 450 }, { x: 640, y: 550 }, { x: 640, y: 155 }, { x: 640, y: 350 }))
})
test('30/60/144 Hz render schedules give the same release trajectory', () => {
  const worlds = [30, 60, 144].map(hz => { const w = new RopeWorld(level); cut(w); tick(w, 0.5, hz); return w })
  for (const w of worlds) assert.ok(Math.abs(w.candy.y - worlds[0]!.candy.y) < 1e-8)
})
test('An offset candy swings on the rope and retains momentum after cutting', () => {
  const l: RopeLevel = { ...level, candy: { x: 780, y: 310 }, stars: [], mouth: { x: 10, y: 750 } }
  const w = new RopeWorld(l); tick(w, 0.5)
  assert.ok(w.candy.x < 780)
  assert.ok(Math.abs(Math.hypot(w.candy.x - 640, w.candy.y - 155) - w.ropes[0]!.length) < 0.01)
  const velocity = { ...w.velocity }
  const middle = { x: (640 + w.candy.x) / 2, y: (155 + w.candy.y) / 2 }
  assert.equal(w.swipe({ x: middle.x - 60, y: middle.y }, { x: middle.x + 60, y: middle.y }), 1)
  w.advance(1 / 120)
  assert.equal(w.velocity.x, velocity.x)
  assert.ok(w.velocity.y > velocity.y)
})
test('Missing the mouth loses; rebuilding restores the entire level', () => {
  const w = new RopeWorld({ ...level, mouth: { x: 100, y: 704 } }); cut(w); tick(w, 5)
  assert.equal(w.outcome, 'lost')
  const fresh = new RopeWorld(level)
  assert.equal(fresh.stars, 0); assert.equal(fresh.cuts, 0); assert.equal(fresh.outcome, 'playing')
})
test('Multiple ropes can be severed independently for future level data', () => {
  const w = new RopeWorld({ ...level, anchors: [{ x: 490, y: 155 }, { x: 790, y: 155 }] })
  assert.equal(w.swipe({ x: 500, y: 250 }, { x: 610, y: 250 }), 1)
  assert.equal(w.ropes[1]!.cut, false)
})

function frame(x: number, time: number, overrides: Partial<HandFrame> = {}): HandFrame {
  return { t_ms: time, confidence: 1, handedness: 'right', palm_m: { x, y: 260, z: 0 },
    palm_velocity_ms: { x: 0, y: 0, z: 0 }, pinch: 0, fist: 0, ...overrides }
}
test('Recorded-format hand samples cut through the same gameplay path', () => {
  const blade = new HandBlade(), w = new RopeWorld(level)
  assert.equal(blade.sample(frame(550, 100)), null)
  const swipe = blade.sample(frame(730, 133))!
  assert.equal(w.swipe(...swipe), 1); tick(w, 3); assert.equal(w.outcome, 'won')
})
test('Lost, stale, repeated, uncertain, fist, and teleporting hands never bridge a cut', () => {
  const blade = new HandBlade()
  blade.sample(frame(550, 100)); blade.sample(null)
  assert.equal(blade.sample(frame(730, 133)), null)
  assert.equal(blade.sample(frame(550, 500)), null)
  assert.equal(blade.sample(frame(730, 500)), null)
  assert.equal(blade.sample(frame(730, 530, { confidence: 0.2 })), null)
  assert.equal(blade.sample(frame(550, 560)), null)
  assert.equal(blade.sample(frame(730, 590, { fist: 1 })), null)
  assert.equal(blade.sample(frame(550, 620)), null)
  assert.equal(blade.sample(frame(1100, 650)), null)
})
test('Index fingertip takes precedence over the palm', () => {
  const blade = new HandBlade()
  const landmarks = Array.from({ length: 21 }, () => ({ x: 200, y: 260, z: 0 }))
  landmarks[8] = { x: 550, y: 260, z: 0 }
  blade.sample(frame(200, 100, { landmarks_m: landmarks }))
  landmarks[8] = { x: 730, y: 260, z: 0 }
  const swipe = blade.sample(frame(200, 133, { landmarks_m: landmarks }))!
  assert.equal(swipe[0].x, 550); assert.equal(swipe[1].x, 730)
})
console.log(`\n${checks} rope-game checks passed`)
