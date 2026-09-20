export interface Point { x: number; y: number }
export type Surface =
  | { kind: 'box'; x: number; y: number; width: number; height: number; angle?: number; label: string }
  | { kind: 'bumper'; x: number; y: number; radius: number; label: string }
export interface RopeLevel {
  id: number
  name: string
  candy: Point
  anchors: Point[]
  stars: Point[]
  mouth: Point
  surfaces?: Surface[]
}

export const WIDTH = 1280
export const HEIGHT = 800
export const PLANNED_LEVELS = 5

// Level one is a small physics playground: swing, cut, throw, bounce, recover.
export const LEVELS: readonly RopeLevel[] = [{
  id: 1,
  name: 'Swing & sling',
  candy: { x: 540, y: 340 },
  anchors: [{ x: 540, y: 150 }],
  stars: [{ x: 650, y: 320 }, { x: 820, y: 400 }, { x: 1060, y: 590 }],
  mouth: { x: 1110, y: 665 },
  surfaces: [
    { kind: 'box', x: 800, y: 743, width: 864, height: 30, label: 'floor' },
    { kind: 'box', x: 380, y: 432, width: 24, height: 620, label: 'wall' },
    { kind: 'box', x: 1220, y: 432, width: 24, height: 620, label: 'wall' },
    { kind: 'box', x: 800, y: 122, width: 864, height: 16, label: 'ceiling' },
    { kind: 'box', x: 760, y: 635, width: 300, height: 24, angle: 0.28, label: 'ramp' },
    { kind: 'bumper', x: 1010, y: 355, radius: 42, label: 'rubber bumper' },
  ],
}]
