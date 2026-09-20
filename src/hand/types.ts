/**
 * THE OTHER CONTRACT.
 *
 * Interface between stage [4] TRACK (MediaPipe + ToF) and stage [5] INTERACT.
 * Whoever owns hand tracking produces HandFrame; the sim consumes it. Neither
 * side needs to know anything else about the other, and either can be replaced
 * by a mock (see ./mock.ts) without touching the other.
 *
 * Units are SI and the frame is the SIM's frame, not the camera's:
 *   +x right, +y UP, +z toward the viewer, origin at the sim plane's centre.
 * Converting from MediaPipe's normalised image coords into this frame is the
 * tracking side's job, so the sim never has to know about cameras.
 */

/** MediaPipe HandLandmarker's 21-point ordering, named for readability. */
export const LANDMARK = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
} as const

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** One tracked hand at one instant. */
export interface HandFrame {
  /** performance.now() at capture, ms. The sim uses this for velocity, not frame count. */
  t_ms: number
  handedness: 'left' | 'right'
  /** MediaPipe's own detection confidence, 0..1. */
  confidence: number

  /** Palm centre in sim-frame metres. This is the number the ToF sensor supplies. */
  palm_m: Vec3
  /** Palm velocity in m/s. Release velocity for a throw comes from here. */
  palm_velocity_ms: Vec3

  /**
   * All 21 landmarks in sim-frame metres, for rendering the articulated hand.
   * Derived from MediaPipe worldLandmarks, translated to the measured palm
   * position. Optional: the sim's physics never needs these, only the renderer.
   */
  landmarks_m?: Vec3[]

  /**
   * Pinch strength, 0 = open, 1 = fully closed. Thumb-to-index distance,
   * normalised against that hand's own size so it works across hand sizes.
   * The sim treats >= PINCH_GRAB as a grab.
   */
  pinch: number

  /** Palm normal, unit vector. Used for the tilt-the-ramp gesture. */
  palm_normal?: Vec3

  /**
   * Fist strength, 0 = open hand, 1 = closed fist. Average curl of the four
   * fingers. The sim treats >= FIST_CLOSE as the push gesture: only a fist
   * pushes bodies, so an open hand moving across the scene disturbs nothing.
   * Sources that cannot tell (older panels, the bridge) leave it undefined,
   * which reads as 0.
   */
  fist?: number
}

/** Pinch at or above this counts as a grab; below PINCH_RELEASE it lets go. */
export const PINCH_GRAB = 0.7
/** Deliberately lower than PINCH_GRAB: hysteresis, so a held grab does not flicker. */
export const PINCH_RELEASE = 0.5
/** Fist at or above this pushes; below FIST_OPEN it stops. Same hysteresis idea. */
export const FIST_CLOSE = 0.7
export const FIST_OPEN = 0.5

/**
 * Source of hand frames. Implemented by the MediaPipe pipeline in production
 * and by MockHandSource during development.
 */
export interface HandSource {
  /** Most recent frame, or null when no hand is visible. */
  current(): HandFrame | null
  start(): Promise<void>
  stop(): void
}
