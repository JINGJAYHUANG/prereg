// Readiness (R5), early harm stop (R6), the per-arm and experiment verdict (R7–R10), secondary metrics (R11),
// the Twyman warning (R12) and withholding. Pure: the same plan and counts always give the same verdict.
import { srm, prop, meanStat, compare, holm, nonInferior, harmP } from './stats.js';
import { sampleSize } from './plan.js';
import { pct, signedPct, pval, pp, margin, int, value } from './format.js';

export const VERDICTS = ['ship', 'dont_ship', 'inconclusive', 'invalid', 'not_ready', 'stop_harm', 'draft'];
export const VERDICT_LABEL = {
  ship: 'Ship', dont_ship: "Don't ship", inconclusive: 'Inconclusive', invalid: 'Invalid', not_ready: 'Not ready', stop_harm: 'Stop: harm', draft: 'Draft',
};
export const SRM_CAUSES = [
  'an assignment or randomisation bug',
  'redirects or page loads that lose users in one arm',
  'bot filtering applied to one arm only',
  'logging or event loss in one arm',
  'a triggering condition that differs between arms',
];

const DAY = 86400000;
/** Whole UTC days from launch (YYYY-MM-DD) to asOf (YYYY-MM-DD). */
export const daysBetween = (launch, asOf) => Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${launch}T00:00:00Z`)) / DAY);

const stat = (m, cell) => (m.type === 'proportion' ? prop(cell.s, cell.d) : meanStat(cell.mean, cell.sd, cell.n));

/** Normal-approximation guard (R7): at least 100 units, and 10 successes and 10 failures for proportions. */
function tooFew(m, cell, units) {
  if (units < 100) return true;
  if (m.type === 'proportion') return cell.s < 10 || cell.d - cell.s < 10;
  return cell.n < 100;
}

/**
 * Evaluates one readout. input = { plan, launchDate, asOf, data (parseResultsCsv output), looksBefore }.
 * Returns the full result; publicResult() strips everything that must be withheld.
 */
export function evaluate({ plan, launchDate, asOf, data, looksBefore = 0 }) {
  const order = plan.arms.map((a) => a.key);
  const [controlKey, ...treatKeys] = order;
  const units = order.map((k) => data.arms[k].units);
  const size = sampleSize(plan);
  const s = srm(units, plan.arms.map((a) => a.weight));
  const srmOut = {
    chi2: s.chi2, p: s.p, ok: !(s.p < plan.srmAlpha), threshold: plan.srmAlpha,
    observed: Object.fromEntries(order.map((k, i) => [k, s.observed[i]])),
    planned: Object.fromEntries(order.map((k, i) => [k, s.planned[i]])),
  };
  const total = units.reduce((a, b) => a + b, 0);
  const daysElapsed = daysBetween(launchDate, asOf);
  const accrual = daysElapsed > 0 ? total / daysElapsed : null;
  const earliestDay = accrual ? Math.max(plan.minDays, Math.ceil(size.total / accrual)) : plan.minDays;
  const enoughUnits = order.every((k) => data.arms[k].units >= size.perArm[k]);
  const ready = enoughUnits && daysElapsed >= plan.minDays;
  const readiness = {
    ready, progress: total / size.total, plannedTotal: size.total, plannedPerArm: size.perArm, daysElapsed, minDays: plan.minDays,
    accrualPerDay: accrual, earliestDecisionDay: earliestDay, looks: looksBefore + (ready ? 0 : 1),
  };
  const base = { srm: srmOut, readiness, units: Object.fromEntries(order.map((k, i) => [k, units[i]])) };

  if (!srmOut.ok) {
    const split = order.map((k) => pct(srmOut.observed[k])).join(' / ');
    const plannedSplit = plan.arms.map((a) => trimNum(a.weight)).join('/');
    return {
      ...base, verdict: 'invalid', withheld: true, causes: SRM_CAUSES,
      reasons: [`sample ratio mismatch: ${split} against ${plannedSplit}, χ² = ${s.chi2.toFixed(2)}, p = ${pval(s.p)}`, 'Results cannot be trusted until the cause is found; effects are not shown.'],
    };
  }

  if (!ready) {
    for (const g of plan.guardrails) {
      for (const t of treatKeys) {
        const c = data.arms[controlKey].metrics[g.key];
        const x = data.arms[t].metrics[g.key];
        if (tooFew(g, c, data.arms[controlKey].units) || tooFew(g, x, data.arms[t].units)) continue;
        const p = harmP(stat(g, c), stat(g, x), g.harm === 'increase');
        if (p < plan.earlyHarmAlpha) {
          return {
            ...base, verdict: 'stop_harm', withheld: true, stop: { guardrail: g.key, arm: t, harmP: p },
            reasons: [`${t}: ${g.key} moved in the harmful direction (one-sided p = ${pval(p)} < ${plan.earlyHarmAlpha}); stop the experiment.`],
          };
        }
      }
    }
    const why = [];
    if (!enoughUnits) why.push(`${pct(readiness.progress, 1)} of ${int(size.total)} units`);
    if (daysElapsed < plan.minDays) why.push(`day ${daysElapsed} of ${plan.minDays}`);
    return {
      ...base, verdict: 'not_ready', withheld: true,
      reasons: [`${why.join('; ')}; ${readiness.looks} look${readiness.looks === 1 ? '' : 's'}`, `Earliest decision day: ${earliestDay}. Effects stay hidden until then (no peeking).`],
    };
  }

  // Ready and valid: the primary test with Holm across treatments.
  const pr = plan.primary;
  const ctrlCell = data.arms[controlKey].metrics[pr.key];
  const ctrl = stat(pr, ctrlCell);
  const prim = treatKeys.map((t) => {
    const cell = data.arms[t].metrics[pr.key];
    const few = tooFew(pr, ctrlCell, data.arms[controlKey].units) || tooFew(pr, cell, data.arms[t].units);
    const r = compare(ctrl, stat(pr, cell));
    return { arm: t, value: r ? stat(pr, cell).value : null, few, ...r };
  });
  const h = holm(prim.map((x) => (x.few ? 1 : x.p)), plan.alpha);
  prim.forEach((x, i) => {
    x.holmP = prim.length > 1 ? h.adjusted[i] : x.p;
    x.significant = !x.few && h.reject[i];
    const better = pr.direction === 'increase' ? x.diff > 0 : x.diff < 0;
    x.direction = x.significant ? (better ? 'better' : 'worse') : 'none';
  });

  const guards = plan.guardrails.map((g) => ({
    key: g.key, type: g.type, harm: g.harm, marginType: g.marginType, margin: g.margin,
    arms: treatKeys.map((t) => {
      const c = data.arms[controlKey].metrics[g.key];
      const x = data.arms[t].metrics[g.key];
      if (tooFew(g, c, data.arms[controlKey].units) || tooFew(g, x, data.arms[t].units)) return { arm: t, status: 'unclear', few: true };
      const ni = nonInferior(stat(g, c), stat(g, x), { margin: g.margin, harmUp: g.harm === 'increase', relative: g.marginType === 'rel', alpha: plan.guardrailAlpha });
      return { arm: t, control: stat(g, c).value, value: stat(g, x).value, harm: ni.harm, hi: ni.hi, lo: ni.lo, status: ni.status, rel: ni.compare.rel };
    }),
  }));

  const secondaries = plan.secondaries.map((m) => ({
    key: m.key, type: m.type, descriptive: true,
    control: stat(m, data.arms[controlKey].metrics[m.key]).value,
    arms: treatKeys.map((t) => {
      const r = compare(stat(m, data.arms[controlKey].metrics[m.key]), stat(m, data.arms[t].metrics[m.key]));
      return { arm: t, value: stat(m, data.arms[t].metrics[m.key]).value, rel: r.rel, relLo: r.relLo, relHi: r.relHi, p: r.p };
    }),
  }));

  // R10 per arm.
  const perArm = prim.map((x) => {
    const gs = guards.map((g) => ({ key: g.key, g, a: g.arms.find((y) => y.arm === x.arm) }));
    const breach = gs.find((y) => y.a.status === 'breach');
    const unclear = gs.find((y) => y.a.status === 'unclear');
    if (breach) return { arm: x.arm, verdict: 'dont_ship', reason: breachText(breach.g, breach.a) };
    if (x.direction === 'worse') return { arm: x.arm, verdict: 'dont_ship', reason: `${pr.key} moved the wrong way: ${signedPct(x.rel)}, Holm p = ${pval(x.holmP)}` };
    if (x.direction === 'better' && !unclear) return { arm: x.arm, verdict: 'ship', reason: `${pr.key} ${signedPct(x.rel)} [${signedPct(x.relLo)}, ${signedPct(x.relHi)}], p = ${pval(x.p)}${prim.length > 1 ? `, Holm p = ${pval(x.holmP)}` : ''}` };
    if (x.direction === 'better' && unclear) return { arm: x.arm, verdict: 'inconclusive', reason: `guardrail unclear: ${unclear.key}` };
    return { arm: x.arm, verdict: 'inconclusive', reason: x.few ? 'too few events for the normal approximation' : 'no detectable effect' };
  });
  prim.forEach((x) => { x.verdict = perArm.find((y) => y.arm === x.arm).verdict; });

  let verdict;
  let winner = null;
  const reasons = [];
  const ships = prim.filter((x) => x.verdict === 'ship');
  if (ships.length) {
    const best = ships.reduce((a, b) => (Math.abs(b.rel) > Math.abs(a.rel) ? b : a));
    verdict = 'ship';
    winner = best.arm;
    reasons.push(`${best.arm}: ${perArm.find((y) => y.arm === best.arm).reason}; guardrails OK`);
  } else if (perArm.some((y) => y.verdict === 'dont_ship')) {
    verdict = 'dont_ship';
    for (const y of perArm.filter((z) => z.verdict === 'dont_ship')) reasons.push(treatKeys.length > 1 ? `${y.arm}: ${y.reason}` : y.reason);
  } else {
    verdict = 'inconclusive';
    if (treatKeys.length > 1) {
      const best = prim.reduce((a, b) => (b.holmP < a.holmP ? b : a));
      reasons.push(`no detectable effect: best arm ${best.arm}, Holm p = ${pval(best.holmP)}`);
    } else {
      const x = prim[0];
      reasons.push(perArm[0].reason === 'no detectable effect'
        ? `no detectable effect: ${pr.key} ${signedPct(x.rel)} [${signedPct(x.relLo)}, ${signedPct(x.relHi)}], p = ${pval(x.p)}`
        : perArm[0].reason);
    }
  }
  const warnings = prim.filter((x) => Math.abs(x.rel) >= 4 * pr.mdeRel).map((x) => `${x.arm}: unusually large effect (${signedPct(x.rel)}, more than 4 × the planned ${pct(pr.mdeRel, 0)}); check the instrumentation.`);

  return {
    ...base, verdict, winner, withheld: false, reasons, warnings,
    primary: { key: pr.key, type: pr.type, direction: pr.direction, control: ctrl.value, arms: prim.map(({ arm, value: v, diff, rel, relLo, relHi, absLo, absHi, z, p, holmP, significant, direction, verdict: vd, few }) => ({ arm, value: v, diff, rel, relLo, relHi, absLo, absHi, z, p, holmP, significant, direction, verdict: vd, few })) },
    guardrails: guards,
    secondaries,
    perArm,
  };
}

function breachText(g, a) {
  const verb = g.harm === 'increase' ? 'rose' : 'fell';
  if (g.marginType === 'rel') return `${g.key} ${verb} ${pct(Math.abs(a.harm))}; limit ${margin(g)}`;
  const amount = g.type === 'proportion' ? pp(Math.abs(a.harm)) : Math.abs(a.harm).toFixed(3);
  return `${g.key} ${verb} ${amount}; limit ${margin(g)}`;
}

const trimNum = (x) => String(Number(Number(x).toFixed(4)));

/** What may leave the engine: when withheld, no effect statistics of any kind. */
export function publicResult(r) {
  if (!r.withheld) return r;
  const { primary, guardrails, secondaries, perArm, ...rest } = r; // eslint-disable-line no-unused-vars
  return rest;
}

/** One-line summary for lists: the first reason. */
export const shortReason = (r) => (r?.reasons?.[0] ?? '');

export { value as formatValue };
