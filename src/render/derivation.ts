/**
 * The derivation panel: KaTeX rendering of the closed-form solution, with the
 * current numbers substituted in.
 *
 * This is the half of the demo a judge reads. It re-renders whenever parameters
 * change, so tilting a ramp visibly rewrites the algebra.
 */
import katex from 'katex'
import type { Solution } from '../sim/analytic.ts'

function tex(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: true })
  } catch {
    return `<code>${latex}</code>`
  }
}

export function renderDerivation(
  el: HTMLElement,
  solutions: Solution[],
  rawText: string,
  repairs: string[] = [],
  givens = '',
): void {
  const parts: string[] = []

  if (rawText) {
    parts.push(`<blockquote class="problem"><strong>Original problem</strong><br>${escapeHtml(rawText)}</blockquote>`)
  }

  if (givens) parts.push(`<p class="current-givens"><strong>Current simulation givens</strong><br>${escapeHtml(givens)}</p>`)

  for (const s of solutions) {
    parts.push(`<section class="solution">
      <h3>${prettyQuantity(s.quantity)} <span class="answer">${format(s.value)} ${s.unit}</span></h3>
      ${s.steps
        .map(
          (step) => `<div class="step">
            <p class="label">${escapeHtml(step.label)}</p>
            <div class="tex">${tex(step.latex)}</div>
            <div class="tex sub">${tex(step.substituted)}</div>
          </div>`,
        )
        .join('')}
      ${s.caveat ? `<p class="caveat">${escapeHtml(s.caveat)}</p>` : ''}
    </section>`)
  }

  if (repairs.length > 0) {
    // Never silently repair a spec — if a number on screen is not the student's,
    // say so.
    parts.push(`<section class="repairs">
      <h4>Adjusted during extraction</h4>
      <ul>${repairs.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </section>`)
  }

  el.innerHTML = parts.join('')
}

/**
 * Display names. An explicit map rather than a regex over the unit suffix:
 * suffixes like _kgm2s and _m2s do not strip cleanly, and these headings are
 * read by a judge standing three feet away.
 */
const LABELS: Record<string, string> = {
  acceleration_ms2: 'Acceleration',
  time_to_bottom_s: 'Time to bottom',
  final_velocity_ms: 'Final velocity',
  time_of_flight_s: 'Time of flight',
  range_m: 'Range',
  apex_height_m: 'Apex height',
  period_s: 'Period',
  angular_frequency_rads: 'Angular velocity',
  max_speed_ms: 'Maximum speed',
  normal_force_n: 'Normal force',
  tension_n: 'Tension',
  v1_final_ms: 'Final velocity, body 1',
  v2_final_ms: 'Final velocity, body 2',
  kinetic_energy_lost_j: 'Kinetic energy lost',
  contact_point_speed_ms: 'Speed of the contact point',
  top_point_speed_ms: 'Speed of the topmost point',
  rotational_ke_fraction: 'Fraction of KE that is rotational',
  centripetal_acceleration_ms2: 'Centripetal acceleration',
  centripetal_force_n: 'Centripetal force',
  orbit_radius_m: 'Orbit radius',
  cyclotron_period_s: 'Cyclotron period',
  cyclotron_frequency_rads: 'Cyclotron frequency',
  work_done_j: 'Work done by the field',
  coriolis_acceleration_ms2: 'Coriolis acceleration',
  centrifugal_acceleration_ms2: 'Centrifugal acceleration',
  angular_momentum_kgm2s: 'Angular momentum about O',
  areal_velocity_m2s: 'Areal velocity (dA/dt)',
  torque_nm: 'Torque about O',
}

function prettyQuantity(q: string): string {
  return (
    LABELS[q] ??
    q
      .replace(/_(ms2|ms|s|m|n|j|rads|kgm2s|nm|m2s)$/, '')
      .replace(/_/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
  )
}

function format(v: number): string {
  if (Number.isNaN(v)) return 'undefined'
  if (!Number.isFinite(v)) return v < 0 ? '−∞' : '∞'
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(2)
  return String(Number(v.toFixed(3)))
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
