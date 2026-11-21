// Rovo actions. The first five are also the MCP tools (rovo:mcp). Every number and verdict comes from the
// engine; agents read plans, submit counts and explain. Lock and amend are not MCP tools: only people in
// Atlassian lock or amend plans. Outputs are capped at 50 KB.

import { buildPlan, sampleSize } from '../engine/plan.js';
import { fitOutput } from '../shared/limits.js';
import {
  resolveExperiment, planOutput, submitReadout, verdictOutput, portfolio, draftExperiment, lockExperiment, amendExperiment,
  readBrief, writeDecisionRecord, todayUtc,
} from '../services/prereg.js';

/** The experiment from the inputs, else the Jira work item the agent was opened on. */
function refFrom(payload, field = 'experiment') {
  const ctx = payload?.context ?? {};
  for (const v of [payload?.[field], ctx.jira?.issueKey, ctx.jira?.issue?.key, ctx.issueKey]) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return null;
}

async function guarded(name, payload, run) {
  const started = Date.now();
  try {
    const result = await run();
    const ctxKeys = Object.keys(payload?.context ?? {}).join(',') || 'none';
    console.log(`tool=${name} experiment=${result?.experiment ?? '-'} verdict=${result?.verdict ?? '-'} ok=${result?.ok !== false} ms=${Date.now() - started} context=${ctxKeys}${result?.error ? ` error=${String(result.error).slice(0, 160)}` : ''}`);
    return fitOutput({ ok: true, ...result }, { listKey: 'experiments' });
  } catch (error) {
    console.log(`tool=${name} failed: ${error?.message}`);
    return { ok: false, error: `${name} failed: ${error?.message ?? 'unknown error'}` };
  }
}

const notFound = (ref) => ({ ok: false, error: ref ? `No Prereg experiment for "${ref}". Give an EXP-n key or the work item key.` : 'Give an experiment (EXP-n) or a work item key, or open the experiment work item.' });

export const actionListExperiments = (payload) => guarded('list-experiments', payload, async () => {
  const p = await portfolio({ state: payload?.state || undefined, verdict: payload?.verdict || undefined, projectKey: payload?.projectKey ? String(payload.projectKey).toUpperCase() : undefined });
  return { count: p.experiments.length, counts: p.counts, experiments: p.experiments.map(({ sample, ...r }) => r) };
});

export const actionGetPlan = (payload) => guarded('get-experiment-plan', payload, async () => {
  const ref = refFrom(payload);
  const exp = await resolveExperiment(ref);
  if (!exp) return notFound(ref);
  if (exp.state === 'draft') return { ...planOutput(exp), note: 'This plan is a draft and not locked yet. Results can be submitted only after a person locks it at launch.' };
  return planOutput(exp);
});

export const actionSubmitResults = (payload) => guarded('submit-results', payload, async () => {
  const ref = refFrom(payload);
  const exp = await resolveExperiment(ref);
  if (!exp) return notFound(ref);
  const out = await submitReadout(exp, { asOf: payload?.asOf, csv: payload?.resultsCsv, source: payload?.source, note: payload?.note });
  if (!out.ok) return { experiment: exp.key, ...out, ok: false, error: out.error ?? out.errors?.join(' ') };
  return out;
});

export const actionGetVerdict = (payload) => guarded('get-verdict', payload, async () => {
  const ref = refFrom(payload);
  const exp = await resolveExperiment(ref);
  if (!exp) return notFound(ref);
  return verdictOutput(exp);
});

export const actionSampleSize = (payload) => guarded('compute-sample-size', payload, async () => {
  const type = String(payload?.metricType ?? 'proportion').toLowerCase();
  const arms = Math.max(2, Math.min(6, Math.round(Number(payload?.arms ?? 2))));
  const frac = (x) => { const n = Number(x); return n > 1 ? n / 100 : n; };
  const baseline = type === 'proportion' ? frac(payload?.baseline) : Number(payload?.baseline);
  const mde = frac(payload?.mdeRelative);
  const armsSpec = ['control:1', ...Array.from({ length: arms - 1 }, (_, i) => `treatment_${i + 1}:1`)].join(', ');
  const primarySpec = `metric | ${type} | increase | baseline ${baseline} | mde ${mde}${type === 'mean' ? ` | sd ${Number(payload?.sd)}` : ''}`;
  const built = buildPlan({ armsSpec, primarySpec, alpha: payload?.alpha, power: payload?.power, minDays: 14 });
  if (!built.ok) return { ok: false, error: built.error };
  const s = sampleSize(built.plan);
  const daily = Number(payload?.dailyUnits);
  return {
    metricType: type, baseline, mdeRelative: mde, arms, alpha: built.plan.alpha, power: built.plan.power,
    plannedTotal: s.total, plannedPerArm: Math.max(...Object.values(s.perArm)),
    ...(daily > 0 ? { daysAtDailyUnits: Math.ceil(s.total / daily) } : {}),
    method: 'Two-sided z-test per treatment against control, unpooled variances, Bonferroni alpha/k across treatments for planning.',
  };
});

export const actionDraftPlan = (payload) => guarded('draft-plan', payload, async () => {
  const issueKey = String(refFrom(payload, 'issueKey') ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(issueKey)) return { ok: false, error: 'Give the Jira work item key for the experiment, for example GRO-6.' };
  const out = await draftExperiment({
    issueKey, hypothesis: payload?.hypothesis,
    spec: { armsSpec: payload?.armsSpec, primarySpec: payload?.primarySpec, guardrailsSpec: payload?.guardrailsSpec ?? '', secondarySpec: payload?.secondarySpec ?? '', minDays: payload?.minDays, alpha: payload?.alpha, power: payload?.power },
  });
  return out.ok ? { ...out, verdict: 'draft', next: 'A person locks the plan at launch (Lock & launch in the work item panel, or ask the agent after agreeing).' } : out;
});

export const actionLockPlan = (payload) => guarded('lock-plan', payload, async () => {
  const ref = refFrom(payload);
  const exp = await resolveExperiment(ref);
  if (!exp) return notFound(ref);
  return lockExperiment(exp, { launchDate: todayUtc() });
});

export const actionAmendPlan = (payload) => guarded('amend-plan', payload, async () => {
  const ref = refFrom(payload);
  const exp = await resolveExperiment(ref);
  if (!exp) return notFound(ref);
  return amendExperiment(exp, { field: payload?.field, value: payload?.value, reason: payload?.reason });
});

export const actionGetBrief = (payload) => guarded('get-brief', payload, async () => {
  if (!payload?.page) return { ok: false, error: 'Give the Confluence page link or ID of the experiment brief.' };
  return readBrief(payload.page);
});

export const actionWriteRecord = (payload) => guarded('write-decision-record', payload, async () => {
  const ref = refFrom(payload);
  const exp = await resolveExperiment(ref);
  if (!exp) return notFound(ref);
  if (!payload?.spaceKey) return { ok: false, error: 'Give the Confluence space key for the decision record.' };
  const out = await writeDecisionRecord(exp, String(payload.spaceKey).trim());
  return { experiment: exp.key, ...out };
});
