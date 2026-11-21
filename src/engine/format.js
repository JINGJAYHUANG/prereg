// Display helpers shared by the engine's reasons, the UI and the actions.
const MINUS = '−';

const sign = (x, text) => (x < 0 ? `${MINUS}${text}` : `+${text}`);

/** 0.1248 -> "12.48%" (no sign). */
export const pct = (x, digits = 2) => `${(Math.abs(x) * 100).toFixed(digits)}%`.replace(/^/, x < 0 ? MINUS : '');

/** 0.1248 -> "+12.48%", -0.0015 -> "−0.15%". */
export const signedPct = (x, digits = 2) => sign(x, `${(Math.abs(x) * 100).toFixed(digits)}%`);

/** p-values: 4 decimals from 0.001, 6 decimals from 0.0001, scientific below (4.0e-12). */
export function pval(p) {
  if (p >= 0.001) return p.toFixed(4);
  if (p >= 0.0001) return p.toFixed(6);
  const [m, e] = p.toExponential(1).split('e');
  return `${m}e${e.replace('+', '')}`;
}

/** Absolute difference of proportions in percentage points: 0.004994 -> "0.499 pp". */
export function pp(x, signed = false) {
  const v = Math.abs(x) * 100;
  const text = `${v >= 0.1 ? v.toFixed(3) : v.toFixed(4)} pp`;
  if (!signed) return x < 0 ? `${MINUS}${text}` : text;
  return sign(x, text);
}

/** A margin as the plan states it: "1.0 pp" (absolute proportion), "5%" (relative) or a plain number. */
export function margin(g) {
  if (g.marginType === 'rel') return `${trim(g.margin * 100)}%`;
  if (g.type === 'proportion') return `${(g.margin * 100).toFixed(g.margin * 100 >= 1 ? 1 : 2)} pp`;
  return String(g.margin);
}

const trim = (x) => String(Number(x.toFixed(6)));

/** 108060 -> "108,060". */
export const int = (n) => Math.round(n).toLocaleString('en-US');

/** A metric value: proportions as a percentage, means as a number. */
export const value = (type, v) => (type === 'proportion' ? pct(v, v < 0.01 ? 3 : 2) : (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(3)));
