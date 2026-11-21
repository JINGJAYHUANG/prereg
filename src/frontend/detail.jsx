import React, { useEffect, useState } from 'react';
import {
  Box, Button, ButtonGroup, DatePicker, DynamicTable, Heading, Inline, Label, Lozenge, Modal, ModalBody, ModalFooter, ModalHeader,
  ModalTitle, ModalTransition, ProgressBar, SectionMessage, Select, Stack, Strong, Text, TextArea, Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';

export const VERDICT_APPEARANCE = { ship: 'success', dont_ship: 'removed', inconclusive: 'default', invalid: 'removed', not_ready: 'inprogress', stop_harm: 'removed', draft: 'new' };
const MESSAGE_APPEARANCE = { ship: 'success', dont_ship: 'error', inconclusive: 'information', invalid: 'error', not_ready: 'warning', stop_harm: 'error', draft: 'discovery' };
const MINUS = '−';
const signed = (x) => (x < 0 ? `${MINUS}${(Math.abs(x) * 100).toFixed(2)}%` : `+${(x * 100).toFixed(2)}%`);
const pctv = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
const pval = (p) => (p >= 0.001 ? p.toFixed(4) : p >= 0.0001 ? p.toFixed(6) : p.toExponential(1).replace('e-', 'e-'));
const num = (n) => Math.round(n).toLocaleString('en-US');
const val = (type, v) => (type === 'proportion' ? pctv(v, v < 0.01 ? 3 : 2) : v.toFixed(3));
const ppText = (x) => { const v = Math.abs(x) * 100; return `${x < 0 ? MINUS : ''}${v >= 0.1 ? v.toFixed(3) : v.toFixed(4)} pp`; };
const STATUS = { ok: ['success', 'OK'], breach: ['removed', 'Breach'], unclear: ['moved', 'Unclear'] };

export function VerdictLozenge({ verdict, label }) {
  return <Lozenge appearance={VERDICT_APPEARANCE[verdict] ?? 'default'} isBold>{label ?? verdict}</Lozenge>;
}

const table = (cells, rows) => <DynamicTable head={{ cells: cells.map((c, i) => ({ key: `h${i}`, content: c })) }} rows={rows.map((r, i) => ({ key: `r${i}`, cells: r.map((c, j) => ({ key: `c${i}-${j}`, content: c })) }))} />;

function PlanCard({ e }) {
  const p = e.plan;
  return (
    <Stack space="space.100">
      <Heading as="h4">{e.state === 'draft' ? 'Plan (draft, not locked)' : `Plan v1, locked at launch on ${e.launchDate}`}</Heading>
      {e.fingerprint ? <Text>{`Fingerprint ${e.fingerprint}. The verdict is always computed under this version.`}</Text> : null}
      <Text>{`Arms: ${p.arms.map((a, i) => `${a.key} ${a.weight}${i === 0 ? ' (control)' : ''}`).join(', ')}. Planned ${num(e.plannedTotal)} units (${Object.entries(e.plannedPerArm).map(([k, v]) => `${k} ${num(v)}`).join(', ')}). Minimum ${p.minDays} days. Alpha ${p.alpha}, power ${p.power}.`}</Text>
      {table(['Metric', 'Role', 'Type', 'Rule', 'Definition'], e.metrics.map((m) => [
        <Strong>{m.key}</Strong>, m.role, m.type,
        m.role === 'primary' ? `${m.direction}, baseline ${m.type === 'proportion' ? pctv(m.baseline, 2) : m.baseline}, MDE ${m.mde}` : m.role === 'guardrail' ? `${m.harm} is harm, margin ${m.margin}` : 'descriptive only',
        m.definition ?? '',
      ]))}
      <Text size="small">{`Results CSV header: ${e.csvHeader}`}</Text>
    </Stack>
  );
}

function ResultTables({ e }) {
  const r = e.result;
  if (!r) return null;
  const out = [];
  out.push(<Text key="srm">{`Sample ratio check: ${Object.entries(r.srm.observed).map(([k, v]) => `${k} ${pctv(v)}`).join(' / ')} against planned ${Object.entries(r.srm.planned).map(([k, v]) => pctv(v, 1)).join(' / ')}; χ² = ${r.srm.chi2.toFixed(2)}, p = ${pval(r.srm.p)} (${r.srm.ok ? 'OK' : 'mismatch'}).`}</Text>);
  const rd = r.readiness;
  out.push(
    <Stack key="ready" space="space.050">
      <Text>{`Progress: ${pctv(Math.min(rd.progress, 1), 1)} of ${num(rd.plannedTotal)} units; day ${rd.daysElapsed} of at least ${rd.minDays}; earliest decision day ${rd.earliestDecisionDay}; looks before readiness: ${rd.looks}.`}</Text>
      <ProgressBar value={Math.min(rd.progress, 1)} appearance={rd.ready ? 'success' : 'default'} ariaLabel="Progress to the planned sample" />
    </Stack>,
  );
  if (r.verdict === 'invalid') {
    out.push(<SectionMessage key="causes" appearance="error" title="Usual causes of a sample ratio mismatch"><Stack>{(r.causes ?? []).map((c) => <Text key={c}>{`• ${c}`}</Text>)}</Stack></SectionMessage>);
  }
  if (r.withheld) {
    if (r.verdict !== 'invalid') out.push(<SectionMessage key="wh" appearance="information" title="Effects are hidden"><Text>Prereg shows no lifts, p-values or directions before the planned sample and minimum days are reached, so nobody can stop a test early because it looks good.</Text></SectionMessage>);
    return <Stack space="space.150">{out}</Stack>;
  }
  const pr = r.primary;
  out.push(<Heading key="ph" as="h4">{`Primary: ${pr.key} (${pr.direction === 'increase' ? 'higher is better' : 'lower is better'})`}</Heading>);
  out.push(<Box key="pt">{table(['Arm', 'Value', 'Relative lift', '95% CI', 'p', 'Holm p', 'Result'], [
    ['control', val(pr.type, pr.control), '', '', '', '', ''],
    ...pr.arms.map((a) => [a.arm, val(pr.type, a.value), signed(a.rel), `${signed(a.relLo)} to ${signed(a.relHi)}`, pval(a.p), pval(a.holmP),
      <VerdictLozenge verdict={a.verdict} label={{ ship: 'Ship', dont_ship: "Don't ship", inconclusive: 'Inconclusive' }[a.verdict]} />]),
  ])}</Box>);
  if (r.guardrails?.length) {
    out.push(<Heading key="gh" as="h4">Guardrails (non-inferiority, one-sided 95%)</Heading>);
    out.push(<Box key="gt">{table(['Guardrail', 'Arm', 'Control', 'Treatment', 'Harm', 'Bound used', 'Margin', 'Status'], r.guardrails.flatMap((g) => g.arms.map((a) => {
      const rel = g.marginType === 'rel';
      const fmt = (x) => (rel ? pctv(x) : g.type === 'proportion' ? ppText(x) : x.toFixed(3));
      const st = STATUS[a.status] ?? ['default', a.status];
      return [g.key, a.arm, a.few ? '' : val(g.type, a.control), a.few ? '' : val(g.type, a.value), a.few ? 'too few events' : fmt(a.harm), a.few ? '' : (a.status === 'breach' ? `lower ${fmt(a.lo)}` : `upper ${fmt(a.hi)}`), rel ? pctv(g.margin, 0) : g.type === 'proportion' ? ppText(g.margin) : String(g.margin), <Lozenge appearance={st[0]}>{st[1]}</Lozenge>];
    })))}</Box>);
  }
  if (r.secondaries?.length) {
    out.push(<Heading key="sh" as="h4">Secondary metrics (descriptive, not used for the decision)</Heading>);
    out.push(<Box key="st">{table(['Metric', 'Arm', 'Control', 'Treatment', 'Relative', '95% CI', 'p (unadjusted)'], r.secondaries.flatMap((s) => s.arms.map((a) => [s.key, a.arm, val(s.type, s.control), val(s.type, a.value), signed(a.rel), `${signed(a.relLo)} to ${signed(a.relHi)}`, pval(a.p)])))}</Box>);
  }
  for (const w of r.warnings ?? []) out.push(<SectionMessage key={w} appearance="warning"><Text>{w}</Text></SectionMessage>);
  return <Stack space="space.150">{out}</Stack>;
}

const today = () => new Date().toISOString().slice(0, 10);

function SubmitModal({ e, onClose, onDone }) {
  const [v, setV] = useState({ asOf: today(), source: '', note: '', csv: '' });
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k) => (x) => { const value = x?.target ? x.target.value : x; setV((prev) => ({ ...prev, [k]: value })); };
  const validate = async () => setCheck(await invoke('validateCsv', { experiment: e.key, csv: v.csv }));
  const submit = async () => {
    setBusy(true);
    const res = await invoke('submit', { experiment: e.key, ...v });
    setBusy(false);
    setResult(res);
    if (res.ok) onDone();
  };
  return (
    <Modal onClose={onClose} width="large">
      <ModalHeader><ModalTitle>{`Submit results for ${e.key}`}</ModalTitle></ModalHeader>
      <ModalBody>
        <Stack space="space.100">
          <Text>{`Counts only. Prereg computes every statistic under plan v1. Header: ${e.csvHeader}`}</Text>
          <Label labelFor="asof">As of</Label>
          <DatePicker id="asof" value={v.asOf} onChange={set('asOf')} />
          <Label labelFor="source">Source (a query or job name, not a person)</Label>
          <Textfield id="source" value={v.source} onChange={set('source')} placeholder="warehouse query v2" />
          <Label labelFor="note">Note</Label>
          <Textfield id="note" value={v.note} onChange={set('note')} placeholder="what changed since the last readout" />
          <Label labelFor="csv">Results CSV</Label>
          <TextArea id="csv" value={v.csv} onChange={set('csv')} minimumRows={4} placeholder={`${e.csvHeader}\ncontrol,…`} />
          {check ? (check.ok
            ? <SectionMessage appearance="success"><Text>{`The CSV matches plan v1. Units: ${Object.entries(check.echo).map(([k, n]) => `${k} ${num(n)}`).join(', ')}.`}</Text></SectionMessage>
            : <SectionMessage appearance="error" title="Rejected, nothing stored"><Stack>{check.errors.map((x) => <Text key={x}>{x}</Text>)}</Stack></SectionMessage>) : null}
          {result && !result.ok ? <SectionMessage appearance="error" title="Rejected, nothing stored"><Stack>{(result.errors ?? [result.error]).map((x) => <Text key={x}>{x}</Text>)}</Stack></SectionMessage> : null}
          {result?.ok ? <SectionMessage appearance={MESSAGE_APPEARANCE[result.verdict]} title={`${result.readout}: ${result.verdictLabel}`}><Stack>{result.reasons.map((x) => <Text key={x}>{x}</Text>)}</Stack></SectionMessage> : null}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <ButtonGroup>
          <Button onClick={onClose}>{result?.ok ? 'Close' : 'Cancel'}</Button>
          <Button onClick={validate} isDisabled={!v.csv}>Validate</Button>
          <Button appearance="primary" onClick={submit} isDisabled={busy || !v.csv || result?.ok}>Submit</Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
}

const AMEND_FIELDS = [
  { label: 'alpha', value: 'alpha' }, { label: 'power', value: 'power' }, { label: 'minimum days', value: 'minDays' },
  { label: 'primary metric spec', value: 'primarySpec' }, { label: 'guardrails spec', value: 'guardrailsSpec' }, { label: 'secondary spec', value: 'secondarySpec' },
];

function AmendModal({ e, onClose, onDone }) {
  const [v, setV] = useState({ field: 'alpha', value: '', reason: '' });
  const [res, setRes] = useState(null);
  const submit = async () => {
    const out = await invoke('amend', { experiment: e.key, ...v });
    setRes(out);
    if (out.ok) onDone();
  };
  return (
    <Modal onClose={onClose}>
      <ModalHeader><ModalTitle>{`Amend the plan of ${e.key}`}</ModalTitle></ModalHeader>
      <ModalBody>
        <Stack space="space.100">
          <Text>The amendment is recorded as made after launch. The official verdict always stays with plan v1; Prereg shows the amended result beside it as exploratory.</Text>
          <Label labelFor="field">Field</Label>
          <Select inputId="field" options={AMEND_FIELDS} value={AMEND_FIELDS.find((o) => o.value === v.field)} onChange={(o) => setV((prev) => ({ ...prev, field: o.value }))} />
          <Label labelFor="value">New value</Label>
          <Textfield id="value" value={v.value} onChange={(x) => { const value = x.target.value; setV((prev) => ({ ...prev, value })); }} placeholder="0.10" />
          <Label labelFor="reason">Reason (required)</Label>
          <Textfield id="reason" value={v.reason} onChange={(x) => { const reason = x.target.value; setV((prev) => ({ ...prev, reason })); }} />
          {res && !res.ok ? <SectionMessage appearance="error"><Text>{res.error}</Text></SectionMessage> : null}
          {res?.ok ? <SectionMessage appearance="warning" title={`v${res.version} amended after launch`}><Text>{`Official verdict: ${res.officialVerdict} (v1).${res.exploratory ? ` Exploratory under v${res.exploratory.version}: ${res.exploratory.verdictLabel}${res.exploratory.winner ? ` ${res.exploratory.winner}` : ''}.` : ''}`}</Text></SectionMessage> : null}
        </Stack>
      </ModalBody>
      <ModalFooter><ButtonGroup><Button onClick={onClose}>Close</Button><Button appearance="primary" onClick={submit} isDisabled={!v.value || !v.reason || res?.ok}>Record amendment</Button></ButtonGroup></ModalFooter>
    </Modal>
  );
}

function RecordModal({ e, onClose, onDone }) {
  const [space, setSpace] = useState('');
  const [res, setRes] = useState(null);
  const submit = async () => { const out = await invoke('record', { experiment: e.key, spaceKey: space }); setRes(out); if (out.ok) onDone(); };
  return (
    <Modal onClose={onClose}>
      <ModalHeader><ModalTitle>Write the decision record</ModalTitle></ModalHeader>
      <ModalBody>
        <Stack space="space.100">
          <Text>Prereg writes a Confluence page as you: plan v1, the numbers, the verdict, looks and amendments.</Text>
          <Label labelFor="space">Confluence space key</Label>
          <Textfield id="space" value={space} onChange={(x) => setSpace(x.target.value)} placeholder="GROWTH" />
          {res && !res.ok ? <SectionMessage appearance="error"><Text>{res.error}</Text></SectionMessage> : null}
          {res?.ok ? <SectionMessage appearance="success" title="Page created"><Text>{res.url ?? res.title}</Text></SectionMessage> : null}
        </Stack>
      </ModalBody>
      <ModalFooter><ButtonGroup><Button onClick={onClose}>Close</Button><Button appearance="primary" onClick={submit} isDisabled={!space || res?.ok}>Write page</Button></ButtonGroup></ModalFooter>
    </Modal>
  );
}

const NEW_SPEC = { armsSpec: 'control:50, treatment:50', primarySpec: 'conversion | proportion | increase | baseline 5% | mde 10%', guardrailsSpec: '', secondarySpec: '', minDays: 14 };

export function PlanEditor({ issueKey, initial, hypothesis: h0, onSaved, onLocked }) {
  const [spec, setSpec] = useState({ ...NEW_SPEC, ...(initial ?? {}) });
  const [hypothesis, setHypothesis] = useState(h0 ?? '');
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (x) => { const value = x.target.value; setSpec((prev) => ({ ...prev, [k]: value })); };
  const refresh = async (s = spec) => setPreview(await invoke('previewPlan', { spec: { ...s, minDays: Number(s.minDays) } }));
  useEffect(() => { refresh(); }, []);
  const save = async () => {
    const out = await invoke('saveDraft', { issueKey, hypothesis, spec: { ...spec, minDays: Number(spec.minDays) } });
    setMsg(out);
    return out;
  };
  const lock = async () => {
    setBusy(true);
    const saved = await save();
    if (saved.ok) {
      const out = await invoke('lock', { experiment: saved.experiment });
      setMsg(out);
      if (out.ok) onLocked?.();
    }
    setBusy(false);
  };
  return (
    <Stack space="space.100">
      <Heading as="h4">Plan editor</Heading>
      <Text size="small">Spec strings: arms as control:50, b:50 (the first arm is the control). Metrics as key | proportion or mean | direction | baseline | mde (primary), key | type | increase is harm | margin 1.0pp or 5% (guardrails, separated by ;).</Text>
      <Label labelFor="hyp">Hypothesis</Label>
      <Textfield id="hyp" value={hypothesis} onChange={(x) => setHypothesis(x.target.value)} />
      <Label labelFor="arms">Arms</Label>
      <Textfield id="arms" value={spec.armsSpec} onChange={set('armsSpec')} />
      <Label labelFor="primary">Primary metric</Label>
      <Textfield id="primary" value={spec.primarySpec} onChange={set('primarySpec')} />
      <Label labelFor="guard">Guardrails</Label>
      <Textfield id="guard" value={spec.guardrailsSpec} onChange={set('guardrailsSpec')} />
      <Label labelFor="sec">Secondary metrics</Label>
      <Textfield id="sec" value={spec.secondarySpec} onChange={set('secondarySpec')} />
      <Label labelFor="days">Minimum days</Label>
      <Textfield id="days" value={String(spec.minDays)} onChange={set('minDays')} />
      {preview ? (preview.ok
        ? <SectionMessage appearance="information" title={`Sample size: ${num(Math.max(...Object.values(preview.plannedPerArm)))} per arm`}><Text>{`${num(preview.plannedTotal)} units in total (${Object.entries(preview.plannedPerArm).map(([k, v]) => `${k} ${num(v)}`).join(', ')}). CSV header: ${preview.csvHeader}`}</Text></SectionMessage>
        : <SectionMessage appearance="error"><Text>{preview.error}</Text></SectionMessage>) : null}
      {msg && !msg.ok ? <SectionMessage appearance="error"><Text>{msg.error}</Text></SectionMessage> : null}
      {msg?.ok && msg.fingerprint ? <SectionMessage appearance="success" title={`Plan v1 locked on ${msg.launchDate}`}><Text>{`Fingerprint ${msg.fingerprint}.`}</Text></SectionMessage> : null}
      <ButtonGroup>
        <Button onClick={() => refresh()}>Update sample size</Button>
        <Button onClick={async () => { const out = await save(); if (out.ok) onSaved?.(); }}>Save draft</Button>
        <Button appearance="primary" onClick={lock} isDisabled={busy}>Lock & launch</Button>
      </ButtonGroup>
    </Stack>
  );
}

/** "Ship curiosity: click_through +3.40% ..." (the first reason already starts with the winning arm). */
function exploratoryText(x) {
  const first = (x.reasons ?? [])[0] ?? '';
  const w = x.winner;
  const reason = w && first.startsWith(`${w}: `) ? first.slice(w.length + 2) : first;
  return `${x.verdictLabel}${w ? ` ${w}` : ''}: ${reason}. The official verdict stays with plan v1.`;
}

export function ExperimentDetail({ e, reload, rovoEnabled, ask }) {
  const [modal, setModal] = useState(null);
  const closeAndReload = () => { setModal(null); reload(); };
  return (
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center">
        <Heading as="h3">{`${e.key} · ${e.title}`}</Heading>
        <VerdictLozenge verdict={e.verdict} label={e.verdictLabel} />
      </Inline>
      {e.hypothesis ? <Text>{`Hypothesis: ${e.hypothesis}`}</Text> : null}
      <SectionMessage appearance={MESSAGE_APPEARANCE[e.verdict]} title={`Verdict: ${e.verdictLabel}${e.result?.winner ? ` ${e.result.winner}` : ''}`}>
        <Stack>{(e.reasons ?? []).map((x) => <Text key={x}>{x}</Text>)}</Stack>
      </SectionMessage>
      {e.exploratory ? <SectionMessage appearance="warning" title={`Exploratory, not decision-grade (v${e.exploratory.version})`}><Text>{e.exploratory.error ?? exploratoryText(e.exploratory)}</Text></SectionMessage> : null}
      <ButtonGroup>
        {e.state !== 'draft' ? <Button appearance="primary" onClick={() => setModal('submit')}>Submit results</Button> : null}
        {e.state !== 'draft' ? <Button onClick={() => setModal('amend')}>Amend</Button> : null}
        {e.result ? <Button onClick={() => setModal('record')}>Write decision record</Button> : null}
        {rovoEnabled ? <Button onClick={() => ask(e.verdict === 'invalid' ? `Why couldn't we trust the readout of ${e.key}?` : `Can we ship ${e.key}?`)}>Ask Prereg</Button> : null}
      </ButtonGroup>
      {e.state === 'draft' ? <PlanEditor issueKey={e.issueKey} initial={e.spec} hypothesis={e.hypothesis} onSaved={reload} onLocked={reload} /> : null}
      <ResultTables e={e} />
      <PlanCard e={e} />
      {e.readouts.length ? <Stack space="space.100"><Heading as="h4">Readouts (append-only)</Heading>{table(['Readout', 'As of', 'Source', 'Verdict', 'Note', 'CSV SHA-256'], e.readouts.map((r) => [r.key, r.asOf, r.source, <VerdictLozenge verdict={r.verdict} label={r.verdictLabel} />, r.note ?? '', r.csvSha256]))}</Stack> : null}
      {e.versions.length > 1 ? <Stack space="space.100"><Heading as="h4">Plan versions</Heading>{table(['Version', 'Fingerprint', 'Changed', 'Reason'], e.versions.map((v) => [v.version === 1 ? 'v1 (official)' : `v${v.version} (amended after launch)`, v.fingerprint, v.changedFields.join(', ') || '-', v.reason]))}</Stack> : null}
      {e.recordUrl ? <Text>{`Decision record: ${e.recordUrl}`}</Text> : null}
      <ModalTransition>
        {modal === 'submit' ? <SubmitModal e={e} onClose={closeAndReload} onDone={reload} /> : null}
        {modal === 'amend' ? <AmendModal e={e} onClose={closeAndReload} onDone={reload} /> : null}
        {modal === 'record' ? <RecordModal e={e} onClose={closeAndReload} onDone={reload} /> : null}
      </ModalTransition>
    </Stack>
  );
}
