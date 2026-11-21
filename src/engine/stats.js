// The statistical tests Prereg applies. Each mirrors research/golden_check.py, the independent oracle.
import { chi2Sf, phi, twoSidedP, zq, erfc } from './dist.js';

/** R4: chi-squared goodness of fit of assigned units against the planned weights. */
export function srm(units, weights) {
  const total = units.reduce((a, b) => a + b, 0);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const expected = weights.map((w) => (total * w) / wsum);
  const chi2 = units.reduce((acc, o, i) => acc + ((o - expected[i]) ** 2) / expected[i], 0);
  return {
    chi2,
    df: units.length - 1,
    p: chi2Sf(chi2, units.length - 1),
    observed: units.map((u) => u / total),
    planned: weights.map((w) => w / wsum),
  };
}

/** A proportion with its estimate's variance. */
export const prop = (s, n) => {
  const p = s / n;
  return { value: p, variance: (p * (1 - p)) / n, n };
};

/** A mean with its estimate's variance (unpooled). */
export const meanStat = (mean, sd, n) => ({ value: mean, variance: (sd * sd) / n, n });

/** R7: two-sample z comparison of treatment t against control c, with a delta-method CI for the relative lift. */
export function compare(c, t) {
  const diff = t.value - c.value;
  const se = Math.sqrt(c.variance + t.variance);
  const z = diff / se;
  const p = twoSidedP(z);
  const ratio = t.value / c.value;
  const rel = ratio - 1;
  const seRel = ratio * Math.sqrt(t.variance / (t.value ** 2) + c.variance / (c.value ** 2));
  const zc = zq(0.975);
  return { diff, se, z, p, rel, seRel, relLo: rel - zc * seRel, relHi: rel + zc * seRel, absLo: diff - zc * se, absHi: diff + zc * se };
}

/** R8: Holm-Bonferroni. Returns adjusted p-values and rejections in the input order. */
export function holm(pvals, alpha) {
  const k = pvals.length;
  const order = pvals.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
  const adjusted = new Array(k).fill(0);
  const reject = new Array(k).fill(false);
  let running = 0;
  let still = true;
  order.forEach((i, rank) => {
    running = Math.max(running, Math.min(1, (k - rank) * pvals[i]));
    adjusted[i] = running;
    if (still && pvals[i] <= alpha / (k - rank)) reject[i] = true;
    else still = false;
  });
  return { adjusted, reject };
}

/**
 * R9: non-inferiority for a guardrail. harmUp: an increase is harmful. relative: margin on the relative scale.
 * OK if the one-sided (1 - alpha) upper bound of harm is below the margin, Breach if the lower bound is above it,
 * otherwise Unclear (a bound exactly on the margin is Unclear).
 */
export function nonInferior(c, t, { margin, harmUp, relative, alpha = 0.05 }) {
  const r = compare(c, t);
  const z1 = zq(1 - alpha);
  const harm = relative ? (harmUp ? r.rel : -r.rel) : (harmUp ? r.diff : -r.diff);
  const se = relative ? r.seRel : r.se;
  const hi = harm + z1 * se;
  const lo = harm - z1 * se;
  const status = hi < margin ? 'ok' : (lo > margin ? 'breach' : 'unclear');
  return { harm, hi, lo, status, compare: r };
}

/** R6: one-sided p-value that the guardrail moved in the harmful direction at all (harm > 0). */
export function harmP(c, t, harmUp) {
  const r = compare(c, t);
  const h = harmUp ? r.diff : -r.diff;
  return 0.5 * erfc(h / r.se / Math.SQRT2);
}

/**
 * R13: total units so that every treatment-versus-control test has the planned power.
 * arms: [{ w, variance, value }] with the control first; Bonferroni alpha / k for planning (conservative).
 */
export function planTotal(alpha, power, arms) {
  const k = arms.length - 1;
  const za = zq(1 - alpha / k / 2);
  const zb = zq(power);
  const [control, ...treatments] = arms;
  let need = 0;
  for (const t of treatments) {
    const delta = t.value - control.value;
    need = Math.max(need, ((za + zb) ** 2) * (control.variance / control.w + t.variance / t.w) / (delta ** 2));
  }
  return Math.ceil(need);
}

export { phi };
