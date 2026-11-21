// Distributions used by Prereg's statistics. Pure functions, no Forge imports.
// p-values come from erfc and the regularized upper incomplete gamma directly, so very small
// values (for example 4.0e-12) keep their relative precision instead of cancelling against 1.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** log Gamma(x) for x > 0 (Lanczos, g = 7). */
export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized upper incomplete gamma Q(a, x): series below a + 1, continued fraction above. */
export function gammaincc(a, x) {
  if (!(x > 0)) return 1;
  const front = Math.exp(-x + a * Math.log(x) - lgamma(a));
  if (x < a + 1) {
    let sum = 1 / a;
    let term = 1 / a;
    let n = a;
    for (let i = 0; i < 10000; i += 1) {
      n += 1;
      term *= x / n;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
    }
    return 1 - sum * front;
  }
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return front * h;
}

/** Complementary error function with relative precision in the far tail. */
export function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  if (x === 0) return 1;
  return gammaincc(0.5, x * x);
}

/** Standard normal CDF. */
export const phi = (z) => 0.5 * erfc(-z / Math.SQRT2);

/** Two-sided p-value for a z statistic: 2(1 - Phi(|z|)) without cancellation. */
export const twoSidedP = (z) => erfc(Math.abs(z) / Math.SQRT2);

/** Standard normal quantile by bisection (absolute error below 1e-12). */
export function zq(p) {
  if (!(p > 0 && p < 1)) throw new RangeError(`quantile needs 0 < p < 1, got ${p}`);
  let lo = -40;
  let hi = 40;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (phi(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Chi-squared survival function P(X >= x) with df degrees of freedom. */
export const chi2Sf = (x, df) => gammaincc(df / 2, x / 2);
