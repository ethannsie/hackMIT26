/** Shared numerical envelope; hand throws have their own, lower interaction limit. */
export const MAX_SPEED_MS = 60
export const MAX_INPUT_SPEED_MS = 40
export const MAX_COLLISION_INPUT_MS = 20
export const MAX_UNFORCED_SPEED_MS = MAX_SPEED_MS - 2
/** At 120 Hz this is at most 0.1 rad per integration step. */
export const MAX_ORBIT_FREQUENCY_RADS = 12
