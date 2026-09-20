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
export const PLANNED_LEVELS = 5

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
}]
