// "Load sample data" and "Remove sample data". Loading runs in six short steps that the page calls one after
// another (one experiment per step), because a single function call has a time limit. All data is fictional and
// dates are relative to the load time, so the verdicts and numbers match the testing guide on any day.

import { DEMO, ymd } from '../engine/demo.js';
import { createItem, deleteItem } from '../platform/jira.js';
import { getSample, setSample, listSampleProjects, setSampleProjects, getExperiment, deleteExperiment } from '../store/kv.js';
import { draftExperiment, lockExperiment, submitReadout } from './prereg.js';

export const SAMPLE_STEPS = DEMO.length;

/** One step: index 0 starts a load, then each step creates one work item with its experiment and readouts. */
export async function sampleStep({ projectKey, index }) {
  const key = String(projectKey ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+$/.test(key)) return { ok: false, error: 'Choose a Jira project.' };
  let record = await getSample(key);
  if (index === 0) {
    if (record?.complete) return { ok: false, error: `Sample data is already loaded in ${key}. Remove it first.` };
    record = { D: new Date().toISOString(), keys: {}, experiments: [], complete: false };
    await setSample(key, record);
    const projects = await listSampleProjects();
    if (!projects.includes(key)) await setSampleProjects([...projects, key]);
  }
  if (!record) return { ok: false, error: 'Start the load again from the first step.' };
  const demo = DEMO[index];
  if (!demo) return { ok: false, error: 'No such step.' };
  const D = new Date(record.D);
  const created = await createItem({ projectKey: key, summary: demo.title, description: `${demo.hypothesis}\nSample experiment created by Prereg (fictional data).` });
  if (!created.ok) return { ok: false, error: `Jira did not create the work item: ${created.error}` };
  record.keys[demo.ref] = created.key;
  await setSample(key, record);
  const draft = await draftExperiment({ issueKey: created.key, projectKey: key, title: demo.title, hypothesis: demo.hypothesis, spec: demo.spec, sample: true });
  if (!draft.ok) return { ok: false, error: draft.error };
  record.experiments.push(draft.experiment);
  await setSample(key, record);
  if (demo.launch !== null) {
    const locked = await lockExperiment(await getExperiment(draft.experiment), { launchDate: ymd(D, demo.launch), comment: false });
    if (!locked.ok) return { ok: false, error: locked.error };
    for (const ro of demo.readouts) {
      const sub = await submitReadout(await getExperiment(draft.experiment), { asOf: ymd(D, ro.asOf), csv: ro.csv, source: ro.source, note: ro.note, sample: true });
      if (!sub.ok) return { ok: false, error: (sub.errors ?? [sub.error]).join(' ') };
    }
  }
  const done = index === DEMO.length - 1;
  if (done) {
    record.complete = true;
    await setSample(key, record);
  }
  return { ok: true, done, index, workItem: created.key, experiment: draft.experiment, message: done ? doneMessage(record) : null };
}

const doneMessage = (record) => {
  const keys = Object.values(record.keys);
  const readouts = DEMO.reduce((n, d) => n + d.readouts.length, 0);
  return `Created ${keys.length} work items (${keys[0]} to ${keys[keys.length - 1]}), ${record.experiments.length} experiments and ${readouts} readouts.`;
};

export async function sampleStatus(projectKey) {
  const record = await getSample(String(projectKey ?? '').toUpperCase());
  return record ? { loaded: Boolean(record.complete), partial: !record.complete, keys: record.keys, experiments: record.experiments, at: record.D } : { loaded: false };
}

/** Deletes the sample work items, experiments and readouts recorded for a project. Nothing else is touched. */
export async function sampleRemove(projectKey) {
  const key = String(projectKey ?? '').trim().toUpperCase();
  const record = await getSample(key);
  if (!record) return { ok: false, error: `No sample data is recorded for ${key}.` };
  const deleted = [];
  const failed = [];
  for (const issueKey of Object.values(record.keys)) {
    const res = await deleteItem(issueKey);
    (res.ok ? deleted : failed).push(issueKey);
  }
  for (const expKey of record.experiments) {
    const exp = await getExperiment(expKey);
    if (exp?.sample) await deleteExperiment(exp);
  }
  await setSample(key, null);
  await setSampleProjects((await listSampleProjects()).filter((p) => p !== key));
  return { ok: failed.length === 0, deleted, failed, message: failed.length ? `Could not delete ${failed.join(', ')}.` : `Removed the sample data from ${key}.` };
}
