export interface Point { x: number; y: number }
export type Surface =
  | { kind: 'box'; x: number; y: number; width: number; height: number; angle?: number; label: string }
  | { kind: 'bumper'; x: number; y: number; radius: number; label: string }
export interface RopeLevel {
  id: number
  name: string
  lesson?: [string, string]
  hint?: string
  candy: Point
  anchors: Point[]
  stars: Point[]
  mouth: Point
  surfaces?: Surface[]
}

export const WIDTH = 1280
export const HEIGHT = 800

// Every solution uses only gravity, rope tension, cut timing and collisions.
export const LEVELS: readonly RopeLevel[] = [{
  id: 1,
  name: 'Swing & soar',
  lesson: ['Height becomes speed.', 'Cut to keep that momentum.'],
  hint: 'Cut as the candy swings right.',
  candy: { x: 460, y: 310 },
  anchors: [{ x: 650, y: 160 }],
  stars: [{ x: 650, y: 402 }, { x: 800, y: 464 }, { x: 925, y: 605 }],
  mouth: { x: 965, y: 665 },
}, {
  id: 2,
  name: 'Drop & bounce',
  lesson: ['Gravity builds speed.', 'The bumper redirects it.'],
  hint: 'Cut above the rubber bumper.',
  candy: { x: 580, y: 240 },
  anchors: [{ x: 580, y: 140 }],
  stars: [{ x: 580, y: 360 }, { x: 680, y: 492 }, { x: 820, y: 599 }],
  mouth: { x: 875, y: 665 },
  surfaces: [{ kind: 'bumper', x: 530, y: 560, radius: 70, label: 'rubber bumper' }],
}, {
  id: 3,
  name: 'Two to tango',
  lesson: ['Two ropes hold a balance.', 'One cut starts the swing.'],
  hint: 'Cut rope 1, then 2 on the right swing.',
  candy: { x: 650, y: 350 },
  anchors: [{ x: 500, y: 150 }, { x: 800, y: 150 }],
  stars: [{ x: 785, y: 398 }, { x: 920, y: 452 }, { x: 1035, y: 590 }],
  mouth: { x: 1065, y: 665 },
}, {
  id: 4,
  name: 'Ramp runner',
  lesson: ['A slope redirects the fall.', 'Roll off into a free flight.'],
  hint: 'Cut and follow the spin down the ramp.',
  candy: { x: 500, y: 230 },
  anchors: [{ x: 500, y: 130 }],
  stars: [{ x: 500, y: 350 }, { x: 720, y: 485 }, { x: 900, y: 590 }],
  mouth: { x: 950, y: 665 },
  surfaces: [{ kind: 'box', x: 650, y: 500, width: 340, height: 24, angle: 0.35, label: 'ramp' }],
}, {
  id: 5,
  name: 'Bank shot',
  lesson: ['Keep speed through the cut.', 'The wall reverses direction.'],
  hint: 'Cut after the bottom, rising right.',
  candy: { x: 650, y: 320 },
  anchors: [{ x: 850, y: 160 }],
  stars: [{ x: 850, y: 415 }, { x: 1110, y: 473 }, { x: 1080, y: 610 }],
  mouth: { x: 1070, y: 665 },
  surfaces: [{ kind: 'box', x: 1160, y: 460, width: 24, height: 460, label: 'wall' }],
}]
