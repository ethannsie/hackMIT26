/**
 * Matter.js is unitless but tuned for pixel-scale geometry: bodies a few dozen
 * units across, gravity near 0.001 px/ms². Feeding it metres directly gives
 * sluggish, mushy collisions. So the whole sim runs in "sim pixels" and this
 * file is the only place the conversion lives.
 *
 * Every number crossing the boundary — into the engine, out to a derivation
 * panel, out to a hand-tracking teammate — passes through here.
 */

/** Sim pixels per metre. Chosen so a 1 m scene is ~200 units: Matter's happy range. */
export const PX_PER_M = 200

/**
 * One physics step. Fixed, never taken from requestAnimationFrame.
 *
 * This is what makes the sim deterministic: identical initial conditions and an
 * identical number of steps give bit-identical results, on any machine, at any
 * frame rate. A variable dt would not.
 */
export const FIXED_DT_MS = 1000 / 120
export const FIXED_DT_S = FIXED_DT_MS / 1000

export const mToPx = (m: number): number => m * PX_PER_M
export const pxToM = (px: number): number => px / PX_PER_M

/**
 * Matter's velocity unit is NOT per second, and NOT per our timestep.
 *
 * Body.updateVelocities normalises to `Body._baseDelta` (a hardcoded 1/60 s),
 * whatever delta Engine.update was actually given. Using FIXED_DT_S here instead
 * silently halves every launch speed — verified against matter.js 0.20 source
 * and caught by scripts/verify-sims.ts.
 */
export const BASE_DELTA_S = 1 / 60

export const msToMatterVel = (v: number): number => v * PX_PER_M * BASE_DELTA_S
export const matterVelToMs = (v: number): number => v / (PX_PER_M * BASE_DELTA_S)

/** Angular velocity is normalised the same way: radians per _baseDelta. */
export const matterAngVelToRads = (w: number): number => w / BASE_DELTA_S

/**
 * Matter applies `force.y += mass · gravity.y · gravity.scale` each step, giving
 * an acceleration of `gravity.y · gravity.scale` in px/ms². With scale pinned to
 * 1, this is the gravity.y that reproduces a real g in m/s².
 */
export const gravityY = (g_ms2: number): number => (g_ms2 * PX_PER_M) / 1e6

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI
