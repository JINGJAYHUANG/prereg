// Resolver functions for the Prereg page, the work item panel and the glance. People act as themselves;
// issue-property writes run as the app.

import Resolver from '@forge/resolver';
import { buildPlan, sampleSize, csvHeader } from '../engine/plan.js';
import { parseResultsCsv } from '../engine/csv.js';
import { DEFAULTS } from '../engine/plan.js';
import { getItem, listProjects } from '../platform/jira.js';
import { getSettings, saveSettings, listSampleProjects } from '../store/kv.js';
import {
  resolveExperiment, experimentView, portfolio, draftExperiment, lockExperiment, submitReadout, amendExperiment,
  writeDecisionRecord, todayUtc, onClosed,
} from '../services/prereg.js';
import { sampleStep, sampleRemove, sampleStatus, SAMPLE_STEPS } from '../services/sample.js';

const resolver = new Resolver();
const issueOf = (context) => context?.extension?.issue?.key ?? null;
const safe = (fn) => async (req) => {
  try {
    return await fn(req);
  } catch (error) {
    console.log(`resolver failed: ${error?.message}`);
    return { ok: false, error: error?.message ?? 'Something went wrong.' };
  }
};

resolver.define('portfolio', safe(async () => {
  const p = await portfolio();
  const samples = {};
  for (const key of await listSampleProjects()) samples[key] = await sampleStatus(key);
  return { ok: true, ...p, samples, today: todayUtc() };
}));

resolver.define('projects', safe(async () => ({ ok: true, projects: await listProjects() })));

resolver.define('experiment', safe(async ({ payload, context }) => {
  const ref = payload?.experiment || payload?.issueKey || issueOf(context);
  const exp = await resolveExperiment(ref);
  if (!exp) {
    const issueKey = issueOf(context);
    let summary = null;
    if (issueKey) {
      const got = await getItem(issueKey);
      summary = got.ok ? got.item.summary : null;
    }
    return { ok: true, experiment: null, issueKey, summary, defaults: { ...DEFAULTS, ...(await getSettings()) } };
  }
  return { ok: true, experiment: await experimentView(exp) };
}));

resolver.define('previewPlan', safe(async ({ payload }) => {
  const built = buildPlan({ ...(await getSettings()), ...(payload?.spec ?? {}) });
  if (!built.ok) return { ok: false, error: built.error };
  const s = sampleSize(built.plan);
  return { ok: true, plannedTotal: s.total, plannedPerArm: s.perArm, csvHeader: csvHeader(built.plan), plan: built.plan };
}));

resolver.define('saveDraft', safe(async ({ payload, context }) => {
  const issueKey = payload?.issueKey || issueOf(context);
  let title = payload?.title;
  if (!title && issueKey) {
    const got = await getItem(issueKey);
    title = got.ok ? got.item.summary : issueKey;
  }
  return draftExperiment({ issueKey, title, hypothesis: payload?.hypothesis, spec: payload?.spec ?? {} });
}));

resolver.define('lock', safe(async ({ payload, context }) => {
  const exp = await resolveExperiment(payload?.experiment || issueOf(context));
  return lockExperiment(exp);
}));

resolver.define('validateCsv', safe(async ({ payload, context }) => {
  const exp = await resolveExperiment(payload?.experiment || issueOf(context));
  if (!exp) return { ok: false, errors: ['No experiment found.'] };
  const plan = exp.versions?.[0]?.plan ?? exp.plan;
  const data = parseResultsCsv(payload?.csv, plan, { experiment: exp.key, version: 1 });
  if (!data.ok) return { ok: false, errors: data.errors, csvHeader: csvHeader(plan) };
  return { ok: true, echo: Object.fromEntries(Object.entries(data.arms).map(([k, v]) => [k, v.units])), csvHeader: csvHeader(plan) };
}));

resolver.define('submit', safe(async ({ payload, context }) => {
  const exp = await resolveExperiment(payload?.experiment || issueOf(context));
  return submitReadout(exp, { asOf: payload?.asOf, csv: payload?.csv, source: payload?.source, note: payload?.note });
}));

resolver.define('amend', safe(async ({ payload, context }) => {
  const exp = await resolveExperiment(payload?.experiment || issueOf(context));
  return amendExperiment(exp, { field: payload?.field, value: payload?.value, reason: payload?.reason });
}));

resolver.define('record', safe(async ({ payload, context }) => {
  const exp = await resolveExperiment(payload?.experiment || issueOf(context));
  if (!exp) return { ok: false, error: 'No experiment found.' };
  return writeDecisionRecord(exp, String(payload?.spaceKey ?? '').trim());
}));

resolver.define('settings', safe(async () => ({ ok: true, settings: { ...DEFAULTS, ...(await getSettings()) }, sampleSteps: SAMPLE_STEPS, projects: await listProjects(), sampleProjects: await listSampleProjects() })));

resolver.define('saveSettings', safe(async ({ payload }) => {
  const s = payload?.settings ?? {};
  const next = {
    alpha: clampNum(s.alpha, 0.001, 0.2, DEFAULTS.alpha),
    power: clampNum(s.power, 0.5, 0.99, DEFAULTS.power),
    srmAlpha: [0.001, 0.0005].includes(Number(s.srmAlpha)) ? Number(s.srmAlpha) : DEFAULTS.srmAlpha,
    earlyHarmAlpha: clampNum(s.earlyHarmAlpha, 0.0001, 0.05, DEFAULTS.earlyHarmAlpha),
    minDays: Math.round(clampNum(s.minDays, 1, 90, DEFAULTS.minDays)),
  };
  await saveSettings(next);
  return { ok: true, settings: next };
}));

const clampNum = (x, lo, hi, d) => {
  const n = Number(x);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
};

resolver.define('sampleStep', safe(async ({ payload }) => sampleStep({ projectKey: payload?.projectKey, index: Number(payload?.index ?? 0) })));
resolver.define('sampleRemove', safe(async ({ payload }) => sampleRemove(payload?.projectKey)));

export const handler = resolver.getDefinitions();

const LOZENGE = {
  ship: { label: 'Ship', type: 'success' },
  dont_ship: { label: "Don't ship", type: 'removed' },
  inconclusive: { label: 'Inconclusive', type: 'default' },
  invalid: { label: 'Invalid', type: 'removed' },
  not_ready: { label: 'Not ready', type: 'inprogress' },
  stop_harm: { label: 'Stop: harm', type: 'removed' },
  draft: { label: 'Draft', type: 'new' },
};

/** Glance label: "Prereg: Ship" and so on, from the work-item property. */
export async function glanceProperties(payload, context) {
  try {
    const key = context?.extension?.issue?.key ?? payload?.extension?.issue?.key;
    if (!key) return { label: 'Prereg' };
    const got = await getItem(key, { asApp: true });
    const p = got.ok ? got.item.prop : null;
    const lz = p ? LOZENGE[p.verdict] : null;
    if (!lz) return { label: 'Prereg' };
    return { label: 'Prereg', status: { type: 'lozenge', value: { label: lz.label, type: lz.type } } };
  } catch (error) {
    console.log(`glance failed: ${error?.message}`);
    return { label: 'Prereg' };
  }
}

/** Trigger: when an experiment's work item moves to Done (R14). */
export async function onIssueUpdated(event) {
  try {
    const key = event?.issue?.key;
    const toDone = (event?.changelog?.items ?? []).some((i) => i.field === 'status');
    if (!key || !toDone) return;
    const out = await onClosed(key);
    console.log(`issue-updated ${key} ${JSON.stringify(out)}`);
  } catch (error) {
    console.log(`issue-updated failed: ${error?.message}`);
  }
}
