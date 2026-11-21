import React, { useEffect, useState } from 'react';
import ForgeReconciler, { SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import { ExperimentDetail, PlanEditor } from './detail.jsx';

const AGENT = { type: 'forge', agentKey: 'prereg-agent', agentName: 'Prereg' };

function App() {
  const [data, setData] = useState(null);
  const [rovoEnabled, setRovoEnabled] = useState(false);
  const load = () => invoke('experiment', {}).then(setData).catch((e) => setData({ ok: false, error: String(e?.message ?? e) }));
  useEffect(() => {
    load();
    rovo.isEnabled().then(setRovoEnabled).catch(() => setRovoEnabled(false));
  }, []);
  if (!data) return <Spinner label="Loading Prereg" />;
  if (!data.ok) return <SectionMessage appearance="warning" title="Prereg could not load"><Text>{data.error}</Text></SectionMessage>;
  const ask = (prompt) => rovo.open({ ...AGENT, prompt });
  if (!data.experiment) {
    return (
      <Stack space="space.150">
        <Text>{`No Prereg plan for ${data.issueKey ?? 'this work item'} yet. Draft the decision rule here, then lock it at launch.`}</Text>
        <PlanEditor issueKey={data.issueKey} onSaved={load} onLocked={load} />
      </Stack>
    );
  }
  return <ExperimentDetail e={data.experiment} reload={load} rovoEnabled={rovoEnabled} ask={ask} />;
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
