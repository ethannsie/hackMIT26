import assert from 'node:assert/strict'
import Matter from 'matter-js'
import { isPinching } from '../src/minigames/rope/input.ts'
import { CandyInteraction } from '../src/minigames/rope/interaction.ts'
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

test('Redesigned level has a physical three-star throw solution', () => {
  const w = new RopeWorld(playground); w.cutAll(); w.velocity = { x: 560, y: -110 }; tick(w, 3)
  assert.equal(w.outcome, 'won'); assert.equal(w.stars, 3)
})
test('Free throw follows the gravity parabola and keeps horizontal momentum', () => {
  const w = new RopeWorld({ ...empty({ x: 500, y: 200 }), surfaces: [] })
  w.velocity = { x: 400, y: -100 }; tick(w, 0.5)
  assert.ok(Math.abs(w.candy.x - 700) < 0.5)
  assert.ok(Math.abs(w.candy.y - (200 - 50 + 0.5 * 9.81 * 85 * 0.25)) < 1.5)
  assert.ok(Math.abs(w.velocity.x - 400) < 0.1)
})
test('Finger moves candy with a force, rope limits reach, release preserves velocity', () => {
  const w = new RopeWorld(playground)
  assert.ok(w.grab(w.candy)); w.moveTarget({ x: 880, y: 340 })
  assert.equal(w.candy.x, playground.candy.x)
  tick(w, 0.5)
  assert.ok(w.candy.x > playground.candy.x + 40)
  assert.ok(Math.hypot(w.candy.x - 540, w.candy.y - 150) <= 190.01)
  assert.equal(w.swipe({ x: 500, y: 200 }, { x: 700, y: 200 }), 0)
  w.cutAll(); w.moveTarget({ x: 900, y: 450 }); tick(w, 0.2)
  const v = w.velocity; w.release()
  assert.deepEqual(w.velocity, v); assert.ok(v.x > 100)
  const x = w.candy.x; tick(w, 0.1); assert.ok(w.candy.x > x + 5)
})
test('Fast throw cannot tunnel through the floor or right wall', () => {
  const floor = new RopeWorld(empty({ x: 540, y: 630 })); floor.velocity = { x: 0, y: 1800 }
  let bounced = false
  for (let i = 0; i < 60; i++) {
    floor.advance(1 / 120); assert.ok(floor.candy.y < 711)
    if (floor.velocity.y < -50) bounced = true
  }
  assert.ok(bounced)
  const wall = new RopeWorld(empty({ x: 1150, y: 230 })); wall.velocity = { x: 1800, y: 0 }
  tick(wall, 0.1); assert.ok(wall.candy.x < 1190); assert.ok(wall.velocity.x < 0)
})
test('Holding against a wall cannot drag the candy through solid geometry', () => {
  const w = new RopeWorld(empty({ x: 1100, y: 240 }))
  w.grab(w.candy); w.moveTarget({ x: 1270, y: 240 })
  for (let i = 0; i < 240; i++) { w.advance(1 / 120); assert.ok(w.candy.x < 1190) }
})
test('Ramp contact redirects the candy and creates spin', () => {
  const w = new RopeWorld(empty({ x: 740, y: 460 }))
  const hit = new Set<string>()
  Matter.Events.on(w.engine, 'collisionStart', event => {
    for (const pair of event.pairs) { hit.add(pair.bodyA.label); hit.add(pair.bodyB.label) }
  })
  tick(w, 0.9)
  assert.ok(hit.has('ramp')); assert.ok(w.velocity.x > 10); assert.ok(Math.abs(w.angle) > 0.01)
})
test('Rubber bumper rebounds a thrown candy', () => {
  const w = new RopeWorld(empty({ x: 870, y: 350 })); w.velocity = { x: 700, y: 0 }
  tick(w, 0.2); assert.ok(w.velocity.x < -100)
})
test('A held candy cannot win until released', () => {
  const w = new RopeWorld({ ...empty({ x: 600, y: 350 }), mouth: { x: 600, y: 350 }, surfaces: [] })
  w.grab(w.candy); tick(w, 0.5); assert.equal(w.outcome, 'playing')
  w.release(); tick(w, 0.02); assert.equal(w.outcome, 'won')
})
function pinch(x: number, y: number, time: number, gapRatio = 0.15): HandFrame {
  const p = Array.from({ length: 21 }, () => ({ x, y: y + 100, z: 0 }))
  p[5] = { x: x - 40, y: y + 100, z: 0 }; p[17] = { x: x + 40, y: y + 100, z: 0 }
  p[4] = { x: x - gapRatio * 40, y, z: 0 }; p[8] = { x: x + gapRatio * 40, y, z: 0 }
  return frame(x, time, { landmarks_m: p, fist: 1 })
}
test('Thumb-index pinch grabs despite curled spare fingers; opening releases', () => {
  const w = new RopeWorld(playground), input = new CandyInteraction()
  input.sample(pinch(540, 340, 100), w); assert.ok(w.held)
  input.sample(pinch(640, 340, 133), w); tick(w, 0.1)
  assert.ok(w.candy.x > 540)
  const v = w.velocity
  input.sample(pinch(640, 340, 166, 0.9), w)
  assert.ok(!w.held); assert.deepEqual(w.velocity, v)
})
test('Loss and teleport release without injecting a throw or cutting', () => {
  const w = new RopeWorld(playground), input = new CandyInteraction()
  input.sample(pinch(540, 340, 100), w)
  assert.equal(input.sample(pinch(1100, 200, 133), w), null); assert.ok(!w.held)
  input.reset(w); input.sample(pinch(540, 340, 500), w); assert.ok(w.held)
  input.sample(null, w); assert.ok(!w.held); assert.equal(w.cuts, 0)
  assert.equal(input.sample(pinch(700, 200, 800), w), null)
})
test('Open hand never grabs; pinch hysteresis prevents grip flicker', () => {
  const w = new RopeWorld(playground), input = new CandyInteraction()
  input.sample(pinch(540, 340, 100, 0.9), w); assert.ok(!w.held)
  input.sample(pinch(540, 340, 133, 0.2), w); assert.ok(w.held)
  input.sample(pinch(540, 340, 166, 0.45), w); assert.ok(w.held)
  const target = { ...w.target! }
  input.sample(pinch(620, 340, 199, 0.9), w); assert.ok(!w.held)
  assert.equal(target.x, 540)
  assert.equal(input.sample(pinch(560, 340, 199, 0.2), w), null)
  assert.ok(!w.held, 'duplicate observations must not reacquire')
})
test('Pinch thresholds are palm-relative, not camera-distance dependent', () => {
  const f = pinch(540, 340, 100, 0.2)
  assert.ok(isPinching(f))
  f.landmarks_m = f.landmarks_m!.map(p => ({ x: p.x * 0.4, y: p.y * 0.4, z: 0 }))
  assert.ok(isPinching(f))
  assert.ok(!isPinching(pinch(540, 340, 133, 0.45)))
  assert.ok(isPinching(pinch(540, 340, 133, 0.45), true))
  assert.ok(!isPinching(pinch(540, 340, 166, 0.8), true))
})
console.log(`\n${checks} rope-game checks passed`)
