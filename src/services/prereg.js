// Prereg's core: drafts, locking (R1), amendments (R2), readouts and verdicts (R3–R12), the decision record.
// Every number comes from src/engine; this file only stores, loads and wires.

import { buildPlan, sampleSize, fingerprint, changedFields, csvHeader, metricsOf, sha256 } from '../engine/plan.js';
import { parseResultsCsv } from '../engine/csv.js';
import { evaluate, publicResult, daysBetween, VERDICT_LABEL } from '../engine/verdict.js';
import { margin as fmtMargin, signedPct, pval, pct, int } from '../engine/format.js';
import {
  getExperiment, saveExperiment, experimentKeyForIssue, listExperiments, nextKey, getReadout, saveReadout, getSettings,
} from '../store/kv.js';
import { setProperty, addComment, getItem } from '../platform/jira.js';
import { createPage, fetchPage } from '../platform/confluence.js';

export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const ISSUE = /^[A-Z][A-Z0-9_]+-\d+$/;
const EXP = /^EXP-\d+$/;

/** An experiment from EXP-n, a work item key or a /browse/ URL. */
export async function resolveExperiment(ref) {
  const s = String(ref ?? '').trim().toUpperCase();
  if (!s) return null;
  if (EXP.test(s)) return getExperiment(s);
  const m = /\/BROWSE\/([A-Z][A-Z0-9_]+-\d+)/.exec(s);
  const issueKey = m ? m[1] : (ISSUE.test(s) ? s : null);
  if (!issueKey) return null;
  return getExperiment(await experimentKeyForIssue(issueKey));
}

const officialPlan = (exp) => (exp.versions?.[0]?.plan ?? exp.plan);
const latestPlan = (exp) => (exp.versions?.length ? exp.versions[exp.versions.length - 1].plan : exp.plan);

/** The work-item property that powers JQL (preregVerdict = invalid) and the glance. */
export async function writeProperty(exp) {
  const r = exp.lastResult;
  let lift = null;
  if (r && !r.withheld && r.primary) {
    const arm = r.winner ? r.primary.arms.find((a) => a.arm === r.winner) : r.primary.arms[0];
    if (arm && Number.isFinite(arm.rel)) lift = Math.round(arm.rel * 10000) / 100;
  }
  return setProperty(exp.issueKey, { state: exp.state, verdict: exp.verdict, experiment: exp.key, lift, looks: exp.looks ?? 0 });
}

function metricLines(plan) {
  return metricsOf(plan).map((m) => {
    const base = { key: m.key, role: m.role, type: m.type, cell: m.type === 'proportion' ? 'successes (denominator = units), or successes/denominator' : 'mean|sd, or mean|sd|n' };
    if (m.definition) base.definition = m.definition;
    if (m.role === 'primary') Object.assign(base, { direction: m.direction, baseline: m.baseline, mde: `${+(m.mdeRel * 100).toFixed(4)}% relative`, ...(m.sd ? { sd: m.sd } : {}) });
    if (m.role === 'guardrail') Object.assign(base, { harm: m.harm, margin: `${fmtMargin(m)} ${m.marginType === 'rel' ? 'relative' : 'absolute'}` });
    return base;
  });
}

/** The locked plan as external agents need it (get-experiment-plan). */
export function planOutput(exp) {
  const plan = officialPlan(exp);
  const size = sampleSize(plan);
  return {
    experiment: exp.key,
    workItem: exp.issueKey,
    title: exp.title,
    state: exp.state,
    planVersion: 1,
    latestVersion: exp.versions?.length ?? 0,
    fingerprint: exp.versions?.[0]?.hash?.slice(0, 12) ?? null,
    launchDate: exp.launchDate ?? null,
    minDays: plan.minDays,
    arms: plan.arms.map((a) => ({ key: a.key, weight: a.weight, role: a === plan.arms[0] ? 'control' : 'treatment' })),
    csvHeader: csvHeader(plan),
    metrics: metricLines(plan),
    alpha: plan.alpha,
    plannedUnitsPerArm: size.perArm,
    plannedTotal: size.total,
    rules: 'Submit counts only, as a CSV with exactly csvHeader. Prereg computes every statistic and the verdict under plan v1. Columns that are not in csvHeader are rejected.',
  };
}

/** Everything the panel and the page show for one experiment. */
export async function experimentView(exp, { now = new Date() } = {}) {
  if (!exp) return null;
  const plan = officialPlan(exp);
  const size = sampleSize(plan);
  const readouts = [];
  for (const k of [...(exp.readouts ?? [])].reverse()) {
    const ro = await getReadout(k);
    if (ro) readouts.push({ key: ro.key, asOf: ro.asOf, source: ro.source, note: ro.note, verdict: ro.verdict, verdictLabel: VERDICT_LABEL[ro.verdict], submittedAt: ro.submittedAt, csvSha256: ro.csvHash?.slice(0, 12) });
  }
  return {
    key: exp.key,
    issueKey: exp.issueKey,
    title: exp.title,
    hypothesis: exp.hypothesis,
    state: exp.state,
    verdict: exp.verdict,
    verdictLabel: VERDICT_LABEL[exp.verdict] ?? exp.verdict,
    reasons: decorateReasons(exp, now),
    spec: exp.spec,
    plan,
    metrics: metricLines(plan),
    csvHeader: csvHeader(plan),
    plannedTotal: size.total,
    plannedPerArm: size.perArm,
    launchDate: exp.launchDate ?? null,
    fingerprint: exp.versions?.[0]?.hash?.slice(0, 12) ?? null,
    versions: (exp.versions ?? []).map(({ version, hash, at, changedFields: cf, reason }) => ({ version, fingerprint: hash.slice(0, 12), at, changedFields: cf, reason })),
    result: exp.lastResult ?? null,
    exploratory: exp.exploratory ?? null,
    looks: exp.looks ?? 0,
    readouts,
    recordUrl: exp.recordUrl ?? null,
    sample: Boolean(exp.sample),
  };
}

/** Adds "earliest decision day has passed" to a Not ready verdict when the calendar says so. */
function decorateReasons(exp, now) {
  const reasons = [...(exp.reasons ?? [])];
  const r = exp.lastResult;
  if (exp.verdict === 'not_ready' && r?.readiness && exp.launchDate) {
    const today = daysBetween(exp.launchDate, todayUtc(now));
    if (today >= r.readiness.earliestDecisionDay) reasons.push(`Earliest decision day ${r.readiness.earliestDecisionDay} has passed: submit a final readout.`);
  }
  return reasons;
}

/** Creates or replaces the draft plan of a work item. */
export async function draftExperiment({ issueKey, projectKey, title, hypothesis, spec, sample = false }) {
  if (!issueKey) return { ok: false, error: 'Open the experiment work item, or give its key.' };
  const settings = await getSettings();
  const built = buildPlan({ alpha: settings.alpha, power: settings.power, minDays: settings.minDays, srmAlpha: settings.srmAlpha, earlyHarmAlpha: settings.earlyHarmAlpha, ...spec });
  if (!built.ok) return { ok: false, error: built.error };
  let exp = await getExperiment(await experimentKeyForIssue(issueKey));
  if (exp && exp.state !== 'draft') return { ok: false, error: `${exp.key} is already locked (plan v1). Use an amendment; it is recorded and never changes the official verdict.` };
  const size = sampleSize(built.plan);
  exp = {
    ...(exp ?? { key: await nextKey('exp'), readouts: [], createdAt: new Date().toISOString() }),
    issueKey,
    projectKey: projectKey ?? issueKey.split('-')[0],
    title: clip(title, 200) || exp?.title || issueKey,
    hypothesis: clip(hypothesis, 1000) || exp?.hypothesis || '',
    state: 'draft',
    verdict: 'draft',
    reasons: [`Draft: ${int(size.total)} units planned (${Object.entries(size.perArm).map(([k, v]) => `${k} ${int(v)}`).join(', ')}).`],
    spec: { armsSpec: spec.armsSpec, primarySpec: spec.primarySpec, guardrailsSpec: spec.guardrailsSpec ?? '', secondarySpec: spec.secondarySpec ?? '', alpha: built.plan.alpha, power: built.plan.power, minDays: built.plan.minDays },
    plan: built.plan,
    sample,
  };
  await saveExperiment(exp);
  await writeProperty(exp);
  return { ok: true, experiment: exp.key, plannedTotal: size.total, plannedPerArm: size.perArm, plan: built.plan };
}

/** R1: locks plan v1 at launch. */
export async function lockExperiment(exp, { launchDate, comment = true } = {}) {
  if (!exp) return { ok: false, error: 'No Prereg experiment found. Draft a plan first.' };
  if (exp.state !== 'draft') return { ok: false, error: `${exp.key} was already locked on ${exp.launchDate}.` };
  const day = launchDate ?? todayUtc();
  const hash = fingerprint(exp.plan);
  const next = {
    ...exp,
    state: 'running',
    launchDate: day,
    versions: [{ version: 1, hash, at: new Date().toISOString(), plan: exp.plan, changedFields: [], reason: 'locked at launch' }],
    verdict: 'not_ready',
    reasons: ['No results yet.'],
    looks: 0,
  };
  await saveExperiment(next);
  await writeProperty(next);
  if (comment) await addComment(exp.issueKey, `Prereg: plan v1 of ${exp.key} locked at launch on ${day}. Fingerprint ${hash.slice(0, 12)}. The verdict will be computed under this plan.`);
  return { ok: true, experiment: exp.key, version: 1, launchDate: day, fingerprint: hash.slice(0, 12) };
}

/** R2: an amendment after launch is recorded as a new version and never changes the official verdict. */
export async function amendExperiment(exp, { field, value, reason }) {
  if (!exp || exp.state === 'draft') return { ok: false, error: 'Only a locked plan can be amended. Edit the draft instead.' };
  if (!clip(reason, 300)) return { ok: false, error: 'An amendment needs a reason.' };
  const allowed = ['armsSpec', 'primarySpec', 'guardrailsSpec', 'secondarySpec', 'alpha', 'power', 'minDays'];
  const f = String(field ?? '').trim();
  if (!allowed.includes(f)) return { ok: false, error: `field must be one of ${allowed.join(', ')}.` };
  const prevSpec = exp.versions.length > 1 ? exp.versions[exp.versions.length - 1].spec : exp.spec;
  const spec = { ...prevSpec, [f]: value };
  const built = buildPlan(spec);
  if (!built.ok) return { ok: false, error: built.error };
  const prev = latestPlan(exp);
  const changed = changedFields(prev, built.plan);
  if (!changed.length) return { ok: false, error: 'That change does not touch any decision field, so no new version is needed.' };
  const version = exp.versions.length + 1;
  const versions = [...exp.versions, { version, hash: fingerprint(built.plan), at: new Date().toISOString(), plan: built.plan, spec, changedFields: changed, reason: clip(reason, 300), amendedAfterLaunch: true }];
  const next = { ...exp, versions };
  next.exploratory = await exploratoryFor(next);
  await saveExperiment(next);
  await addComment(exp.issueKey, `Prereg: plan of ${exp.key} amended after launch to v${version} (${changed.join(', ')}). Reason: ${clip(reason, 300)}. The official verdict stays with plan v1.`);
  return { ok: true, experiment: exp.key, version, changedFields: changed, amendedAfterLaunch: true, officialVerdict: VERDICT_LABEL[exp.verdict], exploratory: next.exploratory };
}

/** The latest readout evaluated under the newest amended version: labelled exploratory, never decision-grade. */
async function exploratoryFor(exp) {
  if (!exp.versions || exp.versions.length < 2 || !exp.latestReadout) return null;
  const ro = await getReadout(exp.latestReadout);
  const plan = latestPlan(exp);
  const version = exp.versions.length;
  const data = parseResultsCsv(ro.csv, plan, { experiment: exp.key, version });
  if (!data.ok) return { version, error: data.errors[0] };
  const r = publicResult(evaluate({ plan, launchDate: exp.launchDate, asOf: ro.asOf, data, looksBefore: 0 }));
  return { version, label: `exploratory under v${version}, not decision-grade`, verdict: r.verdict, verdictLabel: VERDICT_LABEL[r.verdict], winner: r.winner ?? null, reasons: r.reasons };
}

/** R3–R12: validates a results CSV, stores an immutable readout and updates the verdict. */
export async function submitReadout(exp, { asOf, csv, source, note, sample = false, now = new Date() }) {
  if (!exp) return { ok: false, error: 'No Prereg experiment found for that key.' };
  if (exp.state === 'draft') return { ok: false, error: `${exp.key} is a draft. Lock the plan at launch before submitting results.` };
  const day = String(asOf ?? '').trim() || todayUtc(now);
  if (!ISO_DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return { ok: false, error: 'asOf must be a date like 2026-11-17.' };
  if (day < exp.launchDate) return { ok: false, error: `asOf ${day} is before the launch date ${exp.launchDate}.` };
  if (!sample && day > todayUtc(now)) return { ok: false, error: `asOf ${day} is in the future.` };
  const plan = officialPlan(exp);
  const data = parseResultsCsv(csv, plan, { experiment: exp.key, version: 1 });
  if (!data.ok) return { ok: false, rejected: true, errors: data.errors, csvHeader: csvHeader(plan), note: 'Nothing was stored.' };
  let looksBefore = 0;
  for (const k of exp.readouts ?? []) {
    const prev = await getReadout(k);
    if (prev && prev.result?.readiness && !prev.result.readiness.ready) looksBefore += 1;
  }
  const result = evaluate({ plan, launchDate: exp.launchDate, asOf: day, data, looksBefore });
  const key = await nextKey('ro');
  const csvHash = sha256(String(csv));
  const ro = { key, experimentKey: exp.key, planVersion: 1, asOf: day, submittedAt: now.toISOString(), source: clip(source, 80) || 'not given', note: clip(note, 500), csv: String(csv), csvHash, result, verdict: result.verdict, sample };
  await saveReadout(ro);
  const pub = publicResult(result);
  const next = {
    ...exp,
    readouts: [...(exp.readouts ?? []), key],
    latestReadout: key,
    verdict: result.verdict,
    reasons: result.reasons,
    looks: result.readiness.looks,
    lastResult: pub,
  };
  next.exploratory = await exploratoryFor(next);
  await saveExperiment(next);
  await writeProperty(next);
  return {
    ok: true,
    readout: key,
    experiment: exp.key,
    planVersion: 1,
    asOf: day,
    csvSha256: csvHash,
    echo: Object.fromEntries(Object.entries(data.arms).map(([k, v]) => [k, v.units])),
    verdict: result.verdict,
    verdictLabel: VERDICT_LABEL[result.verdict],
    reasons: result.reasons,
    result: pub,
  };
}

/** The latest verdict (get-verdict), with withholding applied. */
export function verdictOutput(exp, { now = new Date() } = {}) {
  const r = exp.lastResult ?? null;
  return {
    experiment: exp.key,
    workItem: exp.issueKey,
    title: exp.title,
    state: exp.state,
    verdict: exp.verdict,
    verdictLabel: VERDICT_LABEL[exp.verdict],
    reasons: decorateReasons(exp, now),
    planVersion: exp.versions?.length ? 1 : 0,
    looks: exp.looks ?? 0,
    latestReadout: exp.latestReadout ?? null,
    amendments: (exp.versions ?? []).slice(1).map((v) => ({ version: v.version, changedFields: v.changedFields, reason: v.reason, amendedAfterLaunch: true })),
    exploratory: exp.exploratory ?? null,
    ...(r ? { result: r } : {}),
  };
}

/** Rows for the portfolio and list-experiments. */
export async function portfolio({ state, verdict, projectKey } = {}, { now = new Date() } = {}) {
  const all = await listExperiments();
  const rows = all
    .filter((e) => (!state || e.state === state) && (!verdict || e.verdict === verdict) && (!projectKey || e.projectKey === projectKey))
    .map((e) => {
      const r = e.lastResult;
      let lift = null;
      if (r && !r.withheld && r.primary) {
        const a = r.winner ? r.primary.arms.find((x) => x.arm === r.winner) : r.primary.arms[0];
        if (a) lift = a.rel;
      }
      return {
        experiment: e.key, workItem: e.issueKey, title: e.title, state: e.state, verdict: e.verdict, verdictLabel: VERDICT_LABEL[e.verdict],
        reason: decorateReasons(e, now)[0] ?? '', lift, liftText: lift === null ? '' : signedPct(lift), latestReadout: e.latestReadout ?? null,
        asOf: r ? null : null, looks: e.looks ?? 0, launchDate: e.launchDate ?? null, sample: Boolean(e.sample),
      };
    })
    .sort((a, b) => Number(a.experiment.split('-')[1]) - Number(b.experiment.split('-')[1]));
  const counts = {};
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  return { experiments: rows, counts };
}

/** R14: when the work item closes without a Ship verdict, comment once. Never blocks the transition. */
export async function onClosed(issueKey) {
  const exp = await resolveExperiment(issueKey);
  if (!exp || exp.state === 'draft' || exp.state === 'decided') return { ok: true, skipped: true };
  const got = await getItem(issueKey, { asApp: true });
  if (!got.ok || !got.item.done) return { ok: true, skipped: true };
  const next = { ...exp, state: 'decided' };
  await saveExperiment(next);
  await writeProperty(next);
  if (exp.verdict !== 'ship') {
    await addComment(issueKey, `Prereg: ${exp.key} was closed with the verdict ${VERDICT_LABEL[exp.verdict]} under plan v1. ${exp.reasons?.[0] ?? ''}`.trim(), { asApp: true });
  }
  return { ok: true, decided: true };
}

/** P1: reads a Confluence brief (as the user) for drafting. */
export async function readBrief(page) {
  const got = await fetchPage(page);
  if (!got.ok) return { ok: false, error: got.status === 404 ? 'Cannot find that page, or you cannot view it.' : 'Could not read that page.' };
  const text = got.text.slice(0, 20000);
  const sections = ['Hypothesis', 'Metrics', 'Targets', 'Variations', 'Results', 'Background'].filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(text));
  return { ok: true, title: got.page.title, url: got.page.url, text, sectionsFound: sections };
}

/** P1: writes the decision record page as the user. Numbers come from the stored results. */
export async function writeDecisionRecord(exp, spaceKey) {
  if (!exp?.lastResult) return { ok: false, error: 'There is no readout yet, so there is nothing to record.' };
  const plan = officialPlan(exp);
  const r = exp.lastResult;
  const blocks = [
    { p: `Work item ${exp.issueKey}. Hypothesis: ${String(exp.hypothesis || 'not given').replace(/\.$/, '')}.` },
    { h2: 'Verdict (computed by Prereg under plan v1)' },
    { p: `${VERDICT_LABEL[exp.verdict]}${r.winner ? ` (${r.winner})` : ''}. ${exp.reasons?.join(' ') ?? ''}` },
    { h2: 'Plan v1 (locked at launch)' },
    { table: [['Item', 'Value'], ['Launch date', exp.launchDate], ['Fingerprint', exp.versions[0].hash.slice(0, 12)], ['Arms', plan.arms.map((a) => `${a.key} ${a.weight}`).join(', ')], ['Primary', `${plan.primary.key} (${plan.primary.type}, ${plan.primary.direction}, MDE ${pct(plan.primary.mdeRel, 0)})`], ['Guardrails', plan.guardrails.map((g) => `${g.key}: ${g.harm} is harm, margin ${fmtMargin(g)}`).join('; ') || 'none'], ['Alpha, power, minimum days', `${plan.alpha}, ${plan.power}, ${plan.minDays}`]] },
  ];
  if (!r.withheld && r.primary) {
    blocks.push({ h2: 'Primary metric' });
    blocks.push({ table: [['Arm', 'Relative lift', '95% CI', 'p', 'Holm p'], ...r.primary.arms.map((a) => [a.arm, signedPct(a.rel), `${signedPct(a.relLo)} to ${signedPct(a.relHi)}`, pval(a.p), pval(a.holmP)])] });
    if (r.guardrails?.length) blocks.push({ table: [['Guardrail', 'Arm', 'Status'], ...r.guardrails.flatMap((g) => g.arms.map((a) => [g.key, a.arm, { ok: 'OK', breach: 'Breach', unclear: 'Unclear' }[a.status] ?? a.status]))] });
  }
  blocks.push({ h2: 'Process' });
  blocks.push({ p: `Readouts: ${(exp.readouts ?? []).join(', ')}. Looks before readiness: ${exp.looks ?? 0}. Amendments after launch: ${Math.max(0, (exp.versions?.length ?? 1) - 1)} (never used for the verdict).` });
  const page = await createPage({ spaceKey, title: `Decision record: ${exp.key} ${exp.title}`, blocks });
  if (!page.ok) return page;
  await saveExperiment({ ...exp, recordUrl: page.url, recordPageId: page.pageId });
  return { ok: true, url: page.url, title: page.title };
}
