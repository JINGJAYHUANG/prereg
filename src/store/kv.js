// App storage (Forge KVS). No account IDs, names or email addresses are stored.
//   exp:<EXP-n>        an experiment: plan versions, launch date, latest verdict
//   exps               the list of experiment keys
//   issue:<KEY-n>      the experiment key for a work item
//   ro:<RO-n>          a readout snapshot (append-only)
//   seq:exp, seq:ro    counters for EXP-n and RO-n
//   settings           defaults for new plans
//   sample:<project>   what "Load sample data" created, for "Remove sample data"
//   notified:<EXP-n>   events already commented on (R14)

import { kvs } from '@forge/kvs';

export const getExperiment = async (key) => (key ? (await kvs.get(`exp:${key}`)) ?? null : null);
export const listExperimentKeys = async () => (await kvs.get('exps')) ?? [];

export async function saveExperiment(exp) {
  await kvs.set(`exp:${exp.key}`, { ...exp, updatedAt: new Date().toISOString() });
  const keys = await listExperimentKeys();
  if (!keys.includes(exp.key)) await kvs.set('exps', [...keys, exp.key]);
  if (exp.issueKey) await kvs.set(`issue:${exp.issueKey}`, exp.key);
}

export async function deleteExperiment(exp) {
  for (const ro of exp.readouts ?? []) await kvs.delete(`ro:${ro}`);
  await kvs.delete(`exp:${exp.key}`);
  if (exp.issueKey) await kvs.delete(`issue:${exp.issueKey}`);
  await kvs.delete(`notified:${exp.key}`);
  await kvs.set('exps', (await listExperimentKeys()).filter((k) => k !== exp.key));
}

export const experimentKeyForIssue = async (issueKey) => (issueKey ? (await kvs.get(`issue:${issueKey}`)) ?? null : null);

export async function listExperiments() {
  const out = [];
  for (const key of await listExperimentKeys()) {
    const e = await getExperiment(key);
    if (e) out.push(e);
  }
  return out;
}

export async function nextKey(kind) {
  const n = ((await kvs.get(`seq:${kind}`)) ?? 0) + 1;
  await kvs.set(`seq:${kind}`, n);
  return `${kind === 'exp' ? 'EXP' : 'RO'}-${n}`;
}

export const getReadout = async (key) => (await kvs.get(`ro:${key}`)) ?? null;
export const saveReadout = (ro) => kvs.set(`ro:${ro.key}`, ro);

export const getSettings = async () => (await kvs.get('settings')) ?? {};
export const saveSettings = (s) => kvs.set('settings', s);

export const getSample = async (projectKey) => (await kvs.get(`sample:${projectKey}`)) ?? null;
export const setSample = (projectKey, value) => (value ? kvs.set(`sample:${projectKey}`, value) : kvs.delete(`sample:${projectKey}`));
export const listSampleProjects = async () => (await kvs.get('sample-projects')) ?? [];
export const setSampleProjects = (list) => kvs.set('sample-projects', list);

export const getNotified = async (expKey) => (await kvs.get(`notified:${expKey}`)) ?? [];
export const setNotified = (expKey, list) => kvs.set(`notified:${expKey}`, list);
