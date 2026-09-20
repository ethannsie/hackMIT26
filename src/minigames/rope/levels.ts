export interface Point { x: number; y: number }
export interface RopeLevel {
  id: number
  name: string
  candy: Point
  anchors: Point[]
  stars: Point[]
  mouth: Point
}

export const WIDTH = 1280
export const HEIGHT = 800
export const PLANNED_LEVELS = 5

// Level one teaches the original interaction: one cut, three stars, one hungry friend.
// Future levels are data, not changes to the app, tracker, or solver.
export const LEVELS: readonly RopeLevel[] = [{
  id: 1,
  name: 'The first snip',
  candy: { x: 640, y: 350 },
  anchors: [{ x: 640, y: 155 }],
  stars: [{ x: 640, y: 445 }, { x: 640, y: 530 }, { x: 640, y: 610 }],
  mouth: { x: 640, y: 704 },
}]
