import assert from 'node:assert/strict'
import Matter from 'matter-js'
import { indexExtended } from '../src/minigames/rope/input.ts'
import { RopeBlade } from '../src/minigames/rope/interaction.ts'
import { RopeProgress } from '../src/minigames/rope/progress.ts'
import { LEVELS, type RopeLevel } from '../src/minigames/rope/levels.ts'
import { RopeWorld, segmentsMeet } from '../src/minigames/rope/physics.ts'
import type { HandFrame } from '../src/hand/types.ts'

let checks = 0
const test = (name: string, f: () => void) => { f(); console.log(`PASS ${name}`); checks++ }
const tick = (world: RopeWorld, seconds: number, hz = 60) => {
  for (let i = 0; i < seconds * hz; i++) world.advance(1 / hz)
}
const level: RopeLevel = { id: 0, name: 'Vertical fixture', candy: { x: 640, y: 350 }, anchors: [{ x: 640, y: 155 }], stars: [{ x: 640, y: 445 }, { x: 640, y: 530 }, { x: 640, y: 610 }], mouth: { x: 640, y: 704 } }
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
const playground = LEVELS[0]!
const empty = (candy: {x: number; y: number}): RopeLevel => ({ ...playground, candy, anchors: [], stars: [], mouth: { x: -1000, y: -1000 } })

test('All five authored puzzles have three-star solutions using cuts alone at 30/60/144 Hz', () => {
  for (const hz of [30, 60, 144]) for (const [index, wait] of [[0, 0.9], [1, 0], [2, 1], [3, 0], [4, 1.1]] as const) {
    const w = new RopeWorld(LEVELS[index]!)
    const hits = new Set<string>()
    Matter.Events.on(w.engine, 'collisionStart', event => {
      for (const pair of event.pairs) { hits.add(pair.bodyA.label); hits.add(pair.bodyB.label) }
    })
    if (index === 2) assert.ok(w.cutRope(0))
    tick(w, wait, hz); assert.ok(w.cutRope(index === 2 ? 1 : 0)); tick(w, 5, hz)
    assert.equal(w.outcome, 'won', `level ${index + 1} at ${hz} Hz`); assert.equal(w.stars, 3)
    if (index === 1) assert.ok(hits.has('rubber bumper'))
    if (index === 3) { assert.ok(hits.has('ramp')); assert.ok(Math.abs(w.angle) > 1) }
    if (index === 4) { assert.ok(hits.has('wall')); assert.ok(w.velocity.x < 0) }
    w.dispose()
  }
})
test('Two ropes require sequence; cutting both or the wrong side misses', () => {
  for (const first of [0, 1]) {
    const w = new RopeWorld(LEVELS[2]!); tick(w, 2)
    assert.ok(Math.abs(w.candy.x - 650) < 1, 'two ropes hold candy in balance')
    w.cutRope(first)
    if (first === 1) tick(w, 1)
    w.cutRope(1 - first); tick(w, 5)
    assert.equal(w.outcome, 'lost')
  }
  const w = new RopeWorld(LEVELS[2]!)
  assert.ok(!w.cutRope(-1)); assert.ok(!w.cutRope(0.5)); assert.ok(!w.cutRope(9))
  assert.ok(w.cutRope(0)); assert.ok(!w.cutRope(0)); assert.equal(w.ropes[1]!.cut, false)
})
test('Ramp and bank-shot solutions depend on real collisions', () => {
  for (const [index, wait] of [[3, 0], [4, 1.1]] as const) {
    const w = new RopeWorld({ ...LEVELS[index]!, surfaces: [] })
    tick(w, wait); w.cutRope(0); tick(w, 5); assert.equal(w.outcome, 'lost')
  }
})
test('Swing puzzle rewards timing; an immediate cut misses', () => {
  const w = new RopeWorld(playground); w.cutAll(); tick(w, 4)
  assert.equal(w.outcome, 'lost')
  for (const time of [0.85, 0.9, 0.95]) {
    const w = new RopeWorld(playground); tick(w, time, 240); w.cutAll(); tick(w, 4)
    assert.equal(w.outcome, 'won', `usable cut window at ${time}s`)
  }
})
test('Free throw follows the gravity parabola and keeps horizontal momentum', () => {
  const w = new RopeWorld({ ...empty({ x: 500, y: 200 }), surfaces: [] })
  w.velocity = { x: 400, y: -100 }; tick(w, 0.5)
  assert.ok(Math.abs(w.candy.x - 700) < 0.5)
  assert.ok(Math.abs(w.candy.y - (200 - 50 + 0.5 * 9.81 * 85 * 0.25)) < 1.5)
  assert.ok(Math.abs(w.velocity.x - 400) < 0.1)
})
test('A hand crossing candy cannot grab, teleport or inject momentum', () => {
  const w = new RopeWorld(level), blade = new RopeBlade()
  blade.sample(frame(570, 100, { palm_m: { x: 570, y: 350, z: 0 } }))
  const stroke = blade.sample(frame(710, 133, { palm_m: { x: 710, y: 350, z: 0 } }))
  const before = { ...w.candy }, v = w.velocity
  if (stroke) w.swipe(...stroke)
  assert.deepEqual(w.candy, before); assert.deepEqual(w.velocity, v)
  assert.ok(!('grab' in w)); assert.ok(!('moveTarget' in w))
})
test('Fast body cannot tunnel through a solid floor', () => {
  const w = new RopeWorld({ ...empty({ x: 540, y: 630 }), surfaces: [
    { kind: 'box', x: 800, y: 743, width: 864, height: 30, label: 'floor' },
  ] })
  w.velocity = { x: 0, y: 1800 }
  let bounced = false
  for (let i = 0; i < 60; i++) {
    w.advance(1 / 120); assert.ok(w.candy.y < 711)
    if (w.velocity.y < -50) bounced = true
  }
  assert.ok(bounced)
})
test('Continuous index sweep cuts; loss, stale samples and teleports never bridge', () => {
  const blade = new RopeBlade(), w = new RopeWorld(level)
  assert.equal(blade.sample(frame(570, 100)), null)
  const stroke = blade.sample(frame(710, 133))!
  assert.equal(w.swipe(...stroke), 1)
  assert.equal(blade.sample(frame(710, 133)), null)
  assert.equal(blade.sample(null), null)
  assert.equal(blade.sample(frame(570, 166)), null)
  assert.equal(blade.sample(frame(710, 500)), null)
  assert.equal(blade.sample(frame(1100, 533)), null)
  assert.equal(blade.sample(frame(950, 566, { handedness: 'left' })), null)
  assert.equal(blade.sample(frame(900, 600, { confidence: 0.1 })), null)
  assert.equal(blade.sample(frame(800, 633)), null)
  assert.equal(blade.sample(frame(700, 666, { fist: 1 })), null)
  assert.equal(blade.sample(frame(600, 699)), null)
})
test('Curled spare fingers do not disable an extended index; curled index is safe', () => {
  const f = frame(500, 100, { fist: 1 })
  f.landmarks_m = Array.from({ length: 21 }, () => ({ x: 500, y: 400, z: 0 }))
  f.landmarks_m[5] = { x: 500, y: 400, z: 0 }
  f.landmarks_m[6] = { x: 500, y: 350, z: 0 }
  f.landmarks_m[8] = { x: 500, y: 260, z: 0 }
  assert.ok(indexExtended(f))
  f.landmarks_m[8] = { x: 510, y: 400, z: 0 }
  assert.ok(!indexExtended(f))
})
test('Next requires a win and stops at five; selection preserves best scores across reload', () => {
  let saved: string | null = null
  const storage = { getItem: () => saved, setItem: (_: string, value: string) => { saved = value } }
  const p = new RopeProgress(storage)
  assert.ok(!p.next('playing')); assert.ok(!p.next('lost')); assert.equal(p.index, 0)
  for (let index = 0; index < 5; index++) {
    assert.equal(p.index, index); p.complete(3)
    assert.equal(p.next('won'), index < 4)
  }
  assert.equal(p.index, 4)
  const resumed = new RopeProgress(storage)
  assert.equal(resumed.index, 4); assert.deepEqual(resumed.best, [3, 3, 3, 3, 3])
  assert.ok(resumed.select(3)); resumed.complete(1)
  assert.equal(new RopeProgress(storage).index, 2); assert.equal(resumed.best[2], 3)
  for (const invalid of [0, 6, 1.5, NaN]) assert.ok(!resumed.select(invalid))
  assert.equal(resumed.index, 2)
  resumed.replay(); assert.equal(new RopeProgress(storage).index, 0)
  assert.equal(new RopeProgress(storage).best[4], 3)
  saved = '{broken'; assert.equal(new RopeProgress(storage).index, 0)
  saved = JSON.stringify({ index: 9, best: [99] }); assert.equal(new RopeProgress(storage).index, 0)
  const denied = new RopeProgress({ getItem() { throw Error() }, setItem() { throw Error() } })
  denied.complete(1); assert.ok(denied.next('won')); assert.ok(denied.select(5))
})
test('All levels are selectable immediately; existing two-level saves migrate', () => {
  let saved = JSON.stringify({ index: 1, best: [2, 3] })
  const storage = { getItem: () => saved, setItem: (_: string, value: string) => { saved = value } }
  const p = new RopeProgress(storage)
  assert.equal(p.index, 1); assert.deepEqual(p.best, [2, 3, -1, -1, -1])
  assert.ok(p.select(5)); assert.equal(new RopeProgress(storage).index, 4)
  assert.deepEqual(new RopeProgress(storage).best, [2, 3, -1, -1, -1])
  p.select(1); assert.equal(p.best[0], 2)
})
console.log(`\n${checks} rope-game checks passed`)
