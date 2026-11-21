// Golden numbers (DESIGN.md §8.2) against the independent Python oracle, plus edge cases (§8.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO, JUDGE_CSV, ymd } from '../src/engine/demo.js';
import { buildPlan, sampleSize, fingerprint, changedFields, csvHeader } from '../src/engine/plan.js';
import { parseResultsCsv } from '../src/engine/csv.js';
import { evaluate, publicResult } from '../src/engine/verdict.js';
import { zq, chi2Sf, erfc, phi } from '../src/engine/dist.js';
import { compare, prop, holm, nonInferior, planTotal } from '../src/engine/stats.js';
import { pval } from '../src/engine/format.js';

const G = JSON.parse(readFileSync(new URL('../research/golden_values.json', import.meta.url), 'utf8'));
const D = new Date(Date.UTC(2026, 10, 17, 15, 30));

function close(actual, expected, what, rel = 1e-6) {
  const ok = Math.abs(actual - expected) <= Math.max(rel * Math.abs(expected), 1e-15);
  assert.ok(ok, `${what}: got ${actual}, expected ${expected}`);
}

function planOf(ref, overrides = {}) {
  const e = DEMO.find((x) => x.ref === ref);
  const r = buildPlan({ ...e.spec, ...overrides });
  assert.ok(r.ok, r.error);
  return { e, plan: r.plan };
}

function run(ref, csv, asOf, looksBefore = 0) {
  const { e, plan } = planOf(ref);
  const data = parseResultsCsv(csv, plan, { experiment: ref, version: 1 });
  assert.ok(data.ok, JSON.stringify(data.errors));
  return evaluate({ plan, launchDate: ymd(D, e.launch), asOf: ymd(D, asOf), data, looksBefore });
}

const demoCsv = (ref, i = 0) => DEMO.find((x) => x.ref === ref).readouts[i].csv;
const arm = (r, a) => r.primary.arms.find((x) => x.arm === a);
const guard = (r, key, a) => r.guardrails.find((g) => g.key === key).arms.find((x) => x.arm === a);
const cmpGolden = (got, g, what) => {
  close(got.rel, g.rel, `${what} rel`); close(got.relLo, g.rel_lo, `${what} relLo`); close(got.relHi, g.rel_hi, `${what} relHi`);
  close(got.p, g.p, `${what} p`); if (got.z !== undefined) close(got.z, g.z, `${what} z`);
};

const FORBIDDEN = new Set(['primary', 'guardrails', 'secondaries', 'perArm', 'rel', 'relLo', 'relHi', 'lift', 'ci', 'diff']);
function assertWithheld(r) {
  const pub = publicResult(r);
  const walk = (o, path) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      assert.ok(!FORBIDDEN.has(k), `withheld output has "${path}${k}"`);
      if (k === 'p') assert.ok(path.startsWith('srm.') || path.startsWith('stop.'), `p outside srm/stop at ${path}`);
      walk(v, `${path}${k}.`);
    }
  };
  walk(pub, '');
  assert.equal(pub.withheld, true);
}

test('distributions', () => {
  assert.equal(phi(0), 0.5);
  close(zq(0.975), 1.959963984540054, 'z0.975', 1e-9);
  for (const x of [0.5, 3.84, 48]) {
    close(chi2Sf(x, 1), erfc(Math.sqrt(x / 2)), `df1 ${x}`, 1e-12);
    close(chi2Sf(x, 2), Math.exp(-x / 2), `df2 ${x}`, 1e-12);
    close(chi2Sf(x, 3), erfc(Math.sqrt(x / 2)) + Math.sqrt((2 * x) / Math.PI) * Math.exp(-x / 2), `df3 ${x}`, 1e-10);
  }
});

test('EXP-1: Ship annual', () => {
  const { plan } = planOf('EXP-1');
  const size = sampleSize(plan);
  assert.equal(size.total, G.exp1.plan.total);
  assert.equal(size.perArm.control, G.exp1.plan.per_arm[0]);
  const r = run('EXP-1', demoCsv('EXP-1'), -7);
  close(r.srm.chi2, G.exp1.srm.chi2, 'srm chi2'); close(r.srm.p, G.exp1.srm.p, 'srm p');
  cmpGolden(arm(r, 'annual'), G.exp1.primary, 'primary');
  const g = guard(r, 'refund_14d', 'annual');
  close(g.harm, G.exp1.refund.harm, 'refund harm'); close(g.hi, G.exp1.refund.hi, 'refund hi');
  assert.equal(g.status, 'ok');
  const aov = r.secondaries[0].arms[0];
  close(aov.rel, G.exp1.aov.rel, 'aov rel'); close(aov.p, G.exp1.aov.p, 'aov p');
  assert.equal(r.verdict, 'ship'); assert.equal(r.winner, 'annual');
  assert.deepEqual(r.warnings, []);
  assert.match(r.reasons[0], /^annual: checkout_conversion \+12\.48% \[\+5\.17%, \+19\.80%\], p = 0\.000385; guardrails OK$/);
});

test('EXP-2: Invalid (sample ratio mismatch), effects withheld', () => {
  const r = run('EXP-2', demoCsv('EXP-2'), -6);
  close(r.srm.chi2, G.exp2.srm.chi2, 'srm chi2'); close(r.srm.p, G.exp2.srm.p, 'srm p');
  assert.equal(r.verdict, 'invalid');
  assert.match(r.reasons[0], /51\.10% \/ 48\.90% against 50\/50/);
  assert.match(r.reasons[0], /p = 4\.0e-12/);
  assertWithheld(r);
});

test('EXP-2 corrected: Inconclusive, the +4.2% lift disappears', () => {
  const { plan } = planOf('EXP-2');
  assert.equal(sampleSize(plan).total, G.exp2.plan.total);
  const r = run('EXP-2', JUDGE_CSV['EXP-2'], 0);
  close(r.srm.p, G.exp2.srm_fixed.p, 'srm p');
  cmpGolden(arm(r, 'sequence_v2'), G.exp2.primary_fixed, 'primary');
  const g = guard(r, 'unsubscribe', 'sequence_v2');
  close(g.hi, G.exp2.unsub_fixed.hi, 'unsub hi'); assert.equal(g.status, 'ok');
  assert.equal(r.verdict, 'inconclusive');
  assert.match(r.reasons[0], /^no detectable effect: activation_7d −0\.15% \[−2\.48%, \+2\.19%\], p = 0\.9025$/);
});

test('EXP-3: Not ready on day 3 and day 6, Ship one_page at the final readout', () => {
  const { plan } = planOf('EXP-3');
  assert.equal(sampleSize(plan).total, G.exp3.plan.total);
  const d3 = run('EXP-3', demoCsv('EXP-3', 0), -12, 0);
  close(d3.srm.p, G.exp3.srm_d3.p, 'srm d3');
  assert.equal(d3.verdict, 'not_ready'); assert.equal(d3.readiness.looks, 1);
  assert.equal((d3.readiness.progress * 100).toFixed(1), '29.5');
  assertWithheld(d3);
  const d6 = run('EXP-3', demoCsv('EXP-3', 1), -9, 1);
  close(d6.srm.p, G.exp3.srm_d6.p, 'srm d6');
  assert.equal(d6.verdict, 'not_ready');
  assert.equal((d6.readiness.progress * 100).toFixed(1), '58.9');
  assert.equal(Math.round(d6.readiness.accrualPerDay), 10608);
  assert.equal(d6.readiness.earliestDecisionDay, 14);
  assert.equal(d6.readiness.looks, 2);
  assert.match(d6.reasons[0], /^58\.9% of 108,060 units; day 6 of 14; 2 looks$/);
  assertWithheld(d6);
  const fin = run('EXP-3', JUDGE_CSV['EXP-3'], 0, 2);
  close(fin.srm.p, G.exp3.srm_final.p, 'srm final');
  cmpGolden(arm(fin, 'one_page'), G.exp3.primary_final, 'primary final');
  const g = guard(fin, 'refund_14d', 'one_page');
  close(g.hi, G.exp3.refund_final.hi, 'refund hi'); assert.equal(g.status, 'ok');
  assert.equal(fin.verdict, 'ship'); assert.equal(fin.winner, 'one_page'); assert.deepEqual(fin.warnings, []);
});

test("EXP-4: Don't ship (guardrail breach) and an early look stops for harm", () => {
  const { plan } = planOf('EXP-4');
  const size = sampleSize(plan);
  assert.equal(size.total, G.exp4.plan.total); assert.equal(size.perArm.price_14, G.exp4.plan.per_arm[1]);
  const r = run('EXP-4', demoCsv('EXP-4'), -4);
  close(r.srm.p, G.exp4.srm.p, 'srm p');
  cmpGolden(arm(r, 'price_14'), G.exp4.primary, 'rpv');
  assert.equal(arm(r, 'price_14').significant, true);
  const g = guard(r, 'checkout_conversion', 'price_14');
  close(g.harm, G.exp4.conv.harm, 'conv harm'); close(g.lo, G.exp4.conv.lo, 'conv lo');
  assert.equal(g.status, 'breach');
  assert.equal(r.verdict, 'dont_ship');
  assert.equal(r.reasons[0], 'checkout_conversion fell 10.00%; limit 5%');
  const early = run('EXP-4', demoCsv('EXP-4'), -13);
  assert.equal(early.verdict, 'stop_harm');
  close(early.stop.harmP, G.exp4.harm_p, 'harm p');
  assertWithheld(early);
});

test('EXP-5: Holm turns two raw wins into Inconclusive', () => {
  const { plan } = planOf('EXP-5');
  const size = sampleSize(plan);
  assert.equal(size.total, G.exp5.plan.total); assert.equal(size.perArm.curiosity, G.exp5.plan.per_arm[1]);
  const r = run('EXP-5', demoCsv('EXP-5'), -2);
  cmpGolden(arm(r, 'curiosity'), G.exp5.curiosity, 'curiosity');
  cmpGolden(arm(r, 'deadline'), G.exp5.deadline, 'deadline');
  close(arm(r, 'curiosity').holmP, G.exp5.holm[0], 'holm curiosity');
  close(arm(r, 'deadline').holmP, G.exp5.holm[1], 'holm deadline');
  assert.equal(arm(r, 'curiosity').significant, false); assert.equal(arm(r, 'deadline').significant, false);
  close(guard(r, 'unsubscribe', 'curiosity').hi, G.exp5.unsub_curiosity.hi, 'unsub b');
  close(guard(r, 'unsubscribe', 'deadline').hi, G.exp5.unsub_deadline.hi, 'unsub c');
  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.reasons[0], 'no detectable effect: best arm curiosity, Holm p = 0.0653');
});

test('EXP-5: a column that is not in the locked plan is rejected', () => {
  const { plan } = planOf('EXP-5');
  const res = parseResultsCsv(JUDGE_CSV['EXP-5-extra-column'], plan, { experiment: 'EXP-5', version: 1 });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /`open_rate` is not in the locked plan v1 of EXP-5/);
});

test('EXP-6: sample-size calculator', () => {
  const { plan } = planOf('EXP-6');
  const s = sampleSize(plan);
  assert.equal(s.total, G.exp6.plan.total); assert.equal(s.perArm.social_proof, G.exp6.plan.per_arm[1]);
  const { plan: p10 } = planOf('EXP-6', { primarySpec: 'signup_conversion | proportion | increase | baseline 12% | mde 10%' });
  const s10 = sampleSize(p10);
  assert.equal(s10.total, G.exp6.plan_mde10.total); assert.equal(s10.perArm.control, G.exp6.plan_mde10.per_arm[0]);
});

test('CSV contract edge cases', () => {
  const { plan } = planOf('EXP-3');
  const ok = (csv) => parseResultsCsv(csv, plan, { experiment: 'EXP-3' });
  assert.equal(ok('﻿arm,units,checkout_conversion,refund_14d\r\ncontrol,100,10,1/10\r\none_page,100,12,1/12\r\n').ok, true);
  assert.match(ok('arm,units,checkout_conversion\ncontrol,1,1\none_page,1,1').errors[0], /"refund_14d" is missing/);
  assert.match(ok('arm,units,checkout_conversion,refund_14d\ncontrol,100,10,1/10\ncontrol,100,10,1/10').errors.join(' '), /appears twice/);
  assert.match(ok('arm,units,checkout_conversion,refund_14d\ncontrol,100,120,1/10\none_page,100,12,1/12').errors[0], /more than the denominator/);
  assert.match(ok('arm,units,checkout_conversion,refund_14d\ncontrol,-5,1,1/10\none_page,100,12,1/12').errors[0], /whole number/);
  assert.match(ok('arm,units,checkout_conversion,refund_14d\ncontrol,10.5,1,1/10\none_page,100,12,1/12').errors[0], /whole number/);
  assert.match(ok('arm,units,checkout_conversion,refund_14d\ncontrol,100,,1/10\none_page,100,12,1/12').errors[0], /empty/);
  assert.match(ok(`arm,units,checkout_conversion,refund_14d\n${'x'.repeat(21 * 1024)}`).errors[0], /20 KB/);
  assert.match(ok('arm,units,checkout_conversion,refund_14d\ncontrol,100,10,1/10').errors[0], /"one_page" is missing/);
  const { plan: p4 } = planOf('EXP-4');
  assert.match(parseResultsCsv('arm,units,revenue_per_visitor,checkout_conversion\ncontrol,100,0.5,10\nprice_14,100,0.5|1,10', p4).errors[0], /mean\|sd/);
});

test('readiness boundary, Holm with one test, guardrail boundary, unequal weights', () => {
  const { e, plan } = planOf('EXP-6');
  const per = sampleSize(plan).perArm;
  const csv = (a, b) => `arm,units,signup_conversion,support_contact\ncontrol,${a},${Math.round(a * 0.12)},${Math.round(a * 0.01)}\nsocial_proof,${b},${Math.round(b * 0.12)},${Math.round(b * 0.01)}`;
  const launch = ymd(D, -14);
  const at = (a, b, asOf) => evaluate({ plan, launchDate: launch, asOf: ymd(D, asOf), data: parseResultsCsv(csv(a, b), plan) });
  assert.equal(at(per.control, per.social_proof, 0).readiness.ready, true);
  assert.equal(at(per.control - 1, per.social_proof, 0).readiness.ready, false);
  assert.equal(at(per.control, per.social_proof, -1).readiness.ready, false);
  assert.equal(e.launch, null);
  const p = compare(prop(100, 1000), prop(130, 1000)).p;
  assert.equal(holm([p], 0.05).adjusted[0], p);
  const r = nonInferior(prop(100, 10000), prop(100, 10000), { margin: 0, harmUp: true, relative: false });
  assert.equal(r.status, 'unclear');
  const even = planTotal(0.05, 0.8, [{ w: 0.5, variance: 0.09, value: 0.1 }, { w: 0.5, variance: 0.0945, value: 0.105 }]);
  const skew = planTotal(0.05, 0.8, [{ w: 0.8, variance: 0.09, value: 0.1 }, { w: 0.2, variance: 0.0945, value: 0.105 }]);
  assert.ok(skew > even);
});

test('plan fingerprint, amendments and header', () => {
  const { plan } = planOf('EXP-5');
  assert.equal(fingerprint(plan).length, 64);
  assert.equal(fingerprint(plan), fingerprint(JSON.parse(JSON.stringify(plan))));
  assert.deepEqual(changedFields(plan, { ...plan }), []);
  assert.deepEqual(changedFields(plan, { ...plan, alpha: 0.1 }), ['alpha']);
  assert.equal(csvHeader(plan), 'arm,units,click_through,unsubscribe');
  assert.equal(pval(3.983e-12), '4.0e-12'); assert.equal(pval(0.000385), '0.000385'); assert.equal(pval(0.9025), '0.9025');
});

test('a bad spec string gives a message the agent can act on', () => {
  const bad = buildPlan({ armsSpec: 'control', primarySpec: 'x | proportion | increase | baseline 0.1 | mde 5%' });
  assert.equal(bad.ok, false); assert.match(bad.error, /control:50/);
  const bad2 = buildPlan({ armsSpec: 'control:50, b:50', primarySpec: 'x | proportion | sideways | baseline 0.1 | mde 5%' });
  assert.match(bad2.error, /increase or decrease/);
});
