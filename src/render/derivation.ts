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
): void {
  const parts: string[] = []

  if (rawText) {
    parts.push(`<blockquote class="problem">${escapeHtml(rawText)}</blockquote>`)
  }

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

function prettyQuantity(q: string): string {
  return q
    .replace(/_(ms2|ms|s|m|n|j|rads)$/, '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

function format(v: number): string {
  if (!Number.isFinite(v)) return '∞'
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(2)
  return String(Number(v.toFixed(3)))
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
