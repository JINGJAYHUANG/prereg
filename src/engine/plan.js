// Plans: the spec-string parsers (action inputs cannot be arrays), validation, sample size (R13),
// canonical JSON and the fingerprint shown at lock (R1), and the decision-field diff for amendments (R2).
import { createHash } from 'node:crypto';
import { planTotal } from './stats.js';

export const DEFAULTS = { alpha: 0.05, power: 0.8, srmAlpha: 0.001, guardrailAlpha: 0.05, earlyHarmAlpha: 0.001, minDays: 14 };
export const LIMITS = { arms: 6, metrics: 12 };
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const TYPES = ['proportion', 'mean'];

class PlanError extends Error {}
const fail = (msg) => { throw new PlanError(msg); };

/** "10%" -> 0.1, "0.1" -> 0.1, "4.5%" -> 0.045. */
function fraction(text, what) {
  const t = String(text ?? '').trim();
  const m = /^(-?\d+(?:\.\d+)?)\s*(%)?$/.exec(t);
  if (!m) fail(`${what} must be a number such as 0.04 or 4%, got "${t}".`);
  return m[2] ? Number(m[1]) / 100 : Number(m[1]);
}

const segs = (s) => String(s).split('|').map((x) => x.trim()).filter((x) => x !== '');

function options(parts, start, what) {
  const out = {};
  for (const part of parts.slice(start)) {
    const m = /^(baseline|sd|mde|margin|def)\s+(.+)$/i.exec(part);
    if (!m) fail(`${what}: unknown part "${part}". Use baseline, sd, mde, margin or def.`);
    out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

function metricKey(k, what) {
  if (!KEY.test(k)) fail(`${what}: "${k}" is not a valid metric key (lowercase letters, digits, underscores; starts with a letter).`);
  return k;
}

function metricType(t, what) {
  const x = String(t || '').toLowerCase();
  if (!TYPES.includes(x)) fail(`${what}: type must be proportion or mean, got "${t}".`);
  return x;
}

/** "control:50, annual:50" -> [{ key, weight }]; the first arm is the control. */
export function parseArms(spec) {
  const arms = String(spec || '').split(',').map((s) => s.trim()).filter(Boolean).map((item) => {
    const m = /^([a-z][a-z0-9_]{0,39})\s*:\s*(\d+(?:\.\d+)?)$/.exec(item);
    if (!m) fail(`Arm "${item}" must look like control:50.`);
    return { key: m[1], weight: Number(m[2]) };
  });
  if (arms.length < 2) fail('A plan needs a control and at least one treatment arm.');
  if (arms.length > LIMITS.arms) fail(`At most ${LIMITS.arms} arms.`);
  if (new Set(arms.map((a) => a.key)).size !== arms.length) fail('Arm keys must be unique.');
  if (arms.some((a) => !(a.weight > 0))) fail('Arm weights must be positive.');
  return arms;
}

/** "checkout_conversion | proportion | increase | baseline 0.04 | mde 10%" */
export function parsePrimary(spec) {
  const p = segs(spec);
  if (p.length < 3) fail('Primary metric must look like: key | proportion | increase | baseline 0.04 | mde 10%.');
  const o = options(p, 3, 'Primary metric');
  const type = metricType(p[1], 'Primary metric');
  const direction = String(p[2]).toLowerCase();
  if (!['increase', 'decrease'].includes(direction)) fail('Primary metric direction must be increase or decrease.');
  if (o.baseline === undefined || o.mde === undefined) fail('Primary metric needs a baseline and an mde.');
  const primary = { key: metricKey(p[0], 'Primary metric'), type, direction, baseline: fraction(o.baseline, 'baseline'), mdeRel: fraction(o.mde, 'mde') };
  if (type === 'mean') {
    if (o.sd === undefined) fail('A mean primary metric needs sd (the standard deviation per unit).');
    primary.sd = Number(o.sd);
  }
  if (o.def) primary.definition = o.def.slice(0, 200);
  return primary;
}

/** "refund_14d | proportion | increase is harm | margin 1.0pp ; …" */
export function parseGuardrails(spec) {
  return String(spec || '').split(';').map((s) => s.trim()).filter(Boolean).map((item) => {
    const p = segs(item);
    if (p.length < 4) fail(`Guardrail "${item}" must look like: key | proportion | increase is harm | margin 1.0pp.`);
    const harmM = /^(increase|decrease)\s+is\s+harm$/i.exec(p[2]);
    if (!harmM) fail(`Guardrail "${p[0]}": say "increase is harm" or "decrease is harm".`);
    const o = options(p, 3, `Guardrail ${p[0]}`);
    if (o.margin === undefined) fail(`Guardrail "${p[0]}" needs a margin, for example margin 1.0pp or margin 5%.`);
    const type = metricType(p[1], `Guardrail ${p[0]}`);
    const mt = /^(\d+(?:\.\d+)?)\s*(pp|%)?$/i.exec(o.margin.replace(/\s+/g, ''));
    if (!mt) fail(`Guardrail "${p[0]}": margin "${o.margin}" must be like 1.0pp, 5% or 0.2.`);
    let marginType = 'abs';
    let m = Number(mt[1]);
    if (mt[2] && mt[2].toLowerCase() === 'pp') {
      if (type !== 'proportion') fail(`Guardrail "${p[0]}": pp margins are for proportions.`);
      m /= 100;
    } else if (mt[2] === '%') {
      marginType = 'rel';
      m /= 100;
    }
    const g = { key: metricKey(p[0], 'Guardrail'), type, harm: harmM[1].toLowerCase(), marginType, margin: m };
    if (o.def) g.definition = o.def.slice(0, 200);
    return g;
  });
}

/** "aov | mean ; trial_starts | proportion" */
export function parseSecondaries(spec) {
  return String(spec || '').split(';').map((s) => s.trim()).filter(Boolean).map((item) => {
    const p = segs(item);
    if (p.length < 2) fail(`Secondary metric "${item}" must look like: key | mean.`);
    const o = options(p, 2, `Secondary ${p[0]}`);
    const s = { key: metricKey(p[0], 'Secondary metric'), type: metricType(p[1], `Secondary ${p[0]}`) };
    if (o.def) s.definition = o.def.slice(0, 200);
    return s;
  });
}

const inRange = (x, lo, hi) => Number.isFinite(x) && x > lo && x < hi;

/** Checks a plan object; throws PlanError with a message the agent or the user can act on. */
export function validatePlan(plan) {
  if (!Array.isArray(plan.arms) || plan.arms.length < 2) fail('A plan needs at least two arms.');
  const pr = plan.primary;
  if (!pr) fail('A plan needs a primary metric.');
  if (pr.type === 'proportion' && !inRange(pr.baseline, 0, 1)) fail('A proportion baseline must be between 0 and 1 (for example 0.04 or 4%).');
  if (pr.type === 'mean' && !(pr.baseline > 0)) fail('A mean baseline must be positive.');
  if (pr.type === 'mean' && !(pr.sd > 0)) fail('sd must be positive.');
  if (!inRange(pr.mdeRel, 0, 1.0000001)) fail('mde must be a relative change between 0% and 100%.');
  if (pr.type === 'proportion') {
    const target = pr.baseline * (1 + (pr.direction === 'increase' ? pr.mdeRel : -pr.mdeRel));
    if (!inRange(target, 0, 1)) fail('baseline and mde give a target outside 0 to 100%.');
  }
  for (const g of plan.guardrails || []) {
    if (!(g.margin > 0)) fail(`Guardrail ${g.key}: the margin must be positive.`);
  }
  const keys = [pr.key, ...(plan.guardrails || []).map((g) => g.key), ...(plan.secondaries || []).map((s) => s.key)];
  if (new Set(keys).size !== keys.length) fail('Each metric key may appear only once in a plan.');
  if (keys.length > LIMITS.metrics) fail(`At most ${LIMITS.metrics} metrics.`);
  if (keys.includes('arm') || keys.includes('units')) fail('"arm" and "units" are reserved column names.');
  if (!inRange(plan.alpha, 0, 0.5)) fail('alpha must be between 0 and 0.5.');
  if (!inRange(plan.power, 0.5, 1)) fail('power must be between 0.5 and 1.');
  if (!(Number.isInteger(plan.minDays) && plan.minDays >= 1 && plan.minDays <= 90)) fail('Minimum days must be a whole number from 1 to 90.');
  return plan;
}

/** Builds and validates a plan from spec strings and numbers. Returns { ok, plan } or { ok: false, error }. */
export function buildPlan({ armsSpec, primarySpec, guardrailsSpec = '', secondarySpec = '', alpha, power, minDays, srmAlpha, guardrailAlpha, earlyHarmAlpha }) {
  try {
    const plan = {
      arms: parseArms(armsSpec),
      primary: parsePrimary(primarySpec),
      guardrails: parseGuardrails(guardrailsSpec),
      secondaries: parseSecondaries(secondarySpec),
      alpha: num(alpha, DEFAULTS.alpha),
      power: num(power, DEFAULTS.power),
      srmAlpha: num(srmAlpha, DEFAULTS.srmAlpha),
      guardrailAlpha: num(guardrailAlpha, DEFAULTS.guardrailAlpha),
      earlyHarmAlpha: num(earlyHarmAlpha, DEFAULTS.earlyHarmAlpha),
      minDays: Math.round(num(minDays, DEFAULTS.minDays)),
    };
    validatePlan(plan);
    return { ok: true, plan };
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, error: e.message };
    throw e;
  }
}

const num = (x, d) => (x === undefined || x === null || x === '' ? d : Number(x));

/** R13: planned units in total and per arm for the primary metric's minimum detectable effect. */
export function sampleSize(plan) {
  const pr = plan.primary;
  const wsum = plan.arms.reduce((a, b) => a + b.weight, 0);
  const sgn = pr.direction === 'increase' ? 1 : -1;
  const target = pr.baseline * (1 + sgn * pr.mdeRel);
  const variance = (v) => (pr.type === 'proportion' ? v * (1 - v) : pr.sd * pr.sd);
  const arms = plan.arms.map((a, i) => {
    const v = i === 0 ? pr.baseline : target;
    return { w: a.weight / wsum, variance: variance(v), value: v };
  });
  const total = planTotal(plan.alpha, plan.power, arms);
  const perArm = Object.fromEntries(plan.arms.map((a) => [a.key, Math.ceil((a.weight / wsum) * total)]));
  return { total, perArm };
}

/** JSON with sorted keys, so the same plan always gives the same fingerprint. */
export function canonicalJson(x) {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  if (x && typeof x === 'object') {
    return `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(x[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** R1: the plan's SHA-256 (the UI shows the first 12 hex characters). */
export const fingerprint = (plan) => sha256(canonicalJson(plan));

/** R2: which decision fields differ between two plan versions. Every plan field is a decision field. */
export function changedFields(a, b) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.filter((k) => canonicalJson(a[k]) !== canonicalJson(b[k])).sort();
}

/** Every column a results CSV must carry, in plan order. */
export const csvHeader = (plan) => ['arm', 'units', plan.primary.key, ...plan.guardrails.map((g) => g.key), ...plan.secondaries.map((s) => s.key)].join(',');

/** All metrics of a plan with their role. */
export const metricsOf = (plan) => [
  { ...plan.primary, role: 'primary' },
  ...plan.guardrails.map((g) => ({ ...g, role: 'guardrail' })),
  ...plan.secondaries.map((s) => ({ ...s, role: 'secondary' })),
];
