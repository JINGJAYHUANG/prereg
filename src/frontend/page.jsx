import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, DynamicTable, EmptyState, Heading, Inline, Label, SectionMessage, Select, Spinner, Stack,
  Tab, TabList, TabPanel, Tabs, Text, Textfield,
} from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import { ExperimentDetail, VerdictLozenge } from './detail.jsx';

const AGENT = { type: 'forge', agentKey: 'prereg-agent', agentName: 'Prereg' };
const ORDER = ['ship', 'dont_ship', 'inconclusive', 'invalid', 'not_ready', 'stop_harm', 'draft'];
const LABEL = { ship: 'Ship', dont_ship: "Don't ship", inconclusive: 'Inconclusive', invalid: 'Invalid', not_ready: 'Not ready', stop_harm: 'Stop: harm', draft: 'Draft' };

function Experiments({ data, reload, rovoEnabled }) {
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const fetchDetail = async (key) => {
    const res = await invoke('experiment', { experiment: key });
    setDetail(res.experiment ?? null);
  };
  const open = async (key) => {
    setSelected(key);
    setDetail(null);
    await fetchDetail(key);
  };
  // Refresh in place: clearing the detail would unmount an open modal and hide its result message.
  const reloadDetail = async () => { await reload(); if (selected) await fetchDetail(selected); };
  if (!data.experiments.length) {
    return <EmptyState header="No experiments yet" description="Open a Jira work item and draft a plan in its Experiment panel, or load the sample data under Settings." />;
  }
  const head = { cells: ['Work item', 'Experiment', 'Verdict', 'Reason', 'Primary lift', 'Looks', ''].map((c, i) => ({ key: `h${i}`, content: c, isSortable: i < 3 })) };
  const rows = data.experiments.map((r) => ({
    key: r.experiment,
    cells: [
      { key: 'w', content: r.workItem },
      { key: 'e', content: `${r.experiment} · ${r.title}` },
      { key: ORDER.indexOf(r.verdict), content: <VerdictLozenge verdict={r.verdict} label={r.verdictLabel} /> },
      { key: 'r', content: r.reason },
      { key: 'l', content: r.liftText },
      { key: 'k', content: String(r.looks) },
      { key: 'o', content: <Button onClick={() => open(r.experiment)} spacing="compact">Open</Button> },
    ],
  }));
  return (
    <Stack space="space.200">
      <Inline space="space.100" shouldWrap>{ORDER.filter((v) => data.counts[v]).map((v) => <VerdictLozenge key={v} verdict={v} label={`${LABEL[v]}: ${data.counts[v]}`} />)}</Inline>
      <DynamicTable head={head} rows={rows} rowsPerPage={20} />
      {selected ? (detail
        ? <ExperimentDetail e={detail} reload={reloadDetail} rovoEnabled={rovoEnabled} ask={(prompt) => rovo.open({ ...AGENT, prompt })} />
        : <Spinner label="Loading the experiment" />) : null}
    </Stack>
  );
}

function Settings({ onChanged }) {
  const [data, setData] = useState(null);
  const [v, setV] = useState(null);
  const [project, setProject] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    invoke('settings').then((d) => { setData(d); setV(d.settings); });
  }, []);
  if (!data || !v) return <Spinner label="Loading settings" />;
  const projects = (data.projects ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }));
  const srmOptions = [{ label: '0.001 (default)', value: 0.001 }, { label: '0.0005 (Microsoft ExP)', value: 0.0005 }];
  const save = async () => setStatus({ ok: true, ...(await invoke('saveSettings', { settings: v })), message: 'Saved.' });
  const load = async () => {
    setBusy(true);
    setStatus({ ok: true, message: 'Loading sample data (6 steps)…' });
    for (let i = 0; i < data.sampleSteps; i += 1) {
      const res = await invoke('sampleStep', { projectKey: project, index: i });
      if (!res.ok) { setStatus({ ok: false, message: res.error }); setBusy(false); return; }
      setStatus({ ok: true, message: res.done ? res.message : `Step ${i + 1} of ${data.sampleSteps}: created ${res.workItem}…` });
    }
    setBusy(false);
    onChanged();
  };
  const remove = async () => {
    setBusy(true);
    const res = await invoke('sampleRemove', { projectKey: project });
    setStatus({ ok: res.ok, message: res.message ?? res.error });
    setBusy(false);
    setConfirm(false);
    onChanged();
  };
  const field = (k, label) => (
    <Stack space="space.050"><Label labelFor={k}>{label}</Label><Textfield id={k} value={String(v[k])} onChange={(e) => { const value = e.target.value; setV((prev) => ({ ...prev, [k]: value })); }} /></Stack>
  );
  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Heading as="h4">Defaults for new plans</Heading>
        <Inline space="space.200" shouldWrap>
          {field('alpha', 'Alpha (two-sided)')}
          {field('power', 'Power')}
          {field('minDays', 'Minimum days')}
          {field('earlyHarmAlpha', 'Early harm stop (one-sided)')}
          <Stack space="space.050"><Label labelFor="srm">Sample ratio mismatch threshold</Label><Select inputId="srm" options={srmOptions} value={srmOptions.find((o) => o.value === Number(v.srmAlpha))} onChange={(o) => setV((prev) => ({ ...prev, srmAlpha: o.value }))} /></Stack>
        </Inline>
        <Button onClick={save}>Save defaults</Button>
      </Stack>
      <Stack space="space.100">
        <Heading as="h4">Sample data</Heading>
        <Text>Creates 6 fictional work items, 6 experiments and 6 readouts in a project you choose: Ship, Invalid (sample ratio mismatch), Not ready, Don't ship (guardrail), Inconclusive (Holm) and a Draft. Dates are relative to now, so the numbers match the testing guide.</Text>
        <Label labelFor="project">Project</Label>
        <Select inputId="project" options={projects} value={projects.find((o) => o.value === project) ?? null} onChange={(o) => setProject(o.value)} placeholder="Choose a project, e.g. Growth (GRO)" />
        <ButtonGroup>
          <Button appearance="primary" onClick={load} isDisabled={!project || busy}>Load sample data</Button>
          {confirm
            ? <Button appearance="danger" onClick={remove} isDisabled={busy}>Delete the sample work items and experiments</Button>
            : <Button onClick={() => setConfirm(true)} isDisabled={!project || busy}>Remove sample data</Button>}
          {confirm ? <Button onClick={() => setConfirm(false)}>Cancel</Button> : null}
        </ButtonGroup>
        {status ? <SectionMessage appearance={status.ok ? 'information' : 'error'}><Text>{status.message}</Text></SectionMessage> : null}
      </Stack>
    </Stack>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [rovoEnabled, setRovoEnabled] = useState(false);
  const reload = () => invoke('portfolio').then(setData).catch((e) => setData({ ok: false, error: String(e?.message ?? e) }));
  useEffect(() => {
    reload();
    rovo.isEnabled().then(setRovoEnabled).catch(() => setRovoEnabled(false));
  }, []);
  if (!data) return <Spinner label="Loading Prereg" />;
  if (!data.ok) return <SectionMessage appearance="warning" title="Prereg could not load"><Text>{data.error}</Text></SectionMessage>;
  return (
    <Stack space="space.200">
      <Text>Lock each A/B test's decision rule before launch. Prereg computes the verdict under that plan: Ship, Don't ship, Inconclusive, Not ready or Invalid.</Text>
      <Tabs id="prereg-tabs">
        <TabList>
          <Tab>Experiments</Tab>
          <Tab>Settings</Tab>
        </TabList>
        <TabPanel><Box paddingBlock="space.200"><Experiments data={data} reload={reload} rovoEnabled={rovoEnabled} /></Box></TabPanel>
        <TabPanel><Box paddingBlock="space.200"><Settings onChanged={reload} /></Box></TabPanel>
      </Tabs>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
