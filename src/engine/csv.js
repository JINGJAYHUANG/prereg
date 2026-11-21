// R3: the strict results contract. The header must be exactly arm, units and the locked plan's metric keys
// (any order). Anything else is rejected with a message that says what to fix, and nothing is stored.
import { metricsOf } from './plan.js';

export const MAX_CSV_BYTES = 20 * 1024;
const INT = /^\d+$/;
const NUM = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

/**
 * Parses a results CSV against a plan. ctx = { experiment, version } for messages.
 * Returns { ok: true, arms: { key: { units, metrics: { key: {s,d} | {mean,sd,n} } } }, order }
 * or { ok: false, errors: [...] }.
 */
export function parseResultsCsv(csv, plan, ctx = {}) {
  const where = `the locked plan v${ctx.version ?? 1}${ctx.experiment ? ` of ${ctx.experiment}` : ''}`;
  const text = String(csv ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) return bad(`The CSV is larger than 20 KB.`);
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  if (lines.length < 2) return bad('The CSV needs a header row and one row per arm.');
  const header = lines[0].split(',').map((h) => h.trim());
  const metrics = metricsOf(plan);
  const known = new Set(['arm', 'units', ...metrics.map((m) => m.key)]);
  const errors = [];
  const seen = new Set();
  for (const h of header) {
    if (h === '') errors.push('The header has an empty column name.');
    else if (seen.has(h)) errors.push(`Column "${h}" appears twice.`);
    else if (!known.has(h)) errors.push(`\`${h}\` is not in ${where}. Only these columns are accepted: ${[...known].join(', ')}.`);
    seen.add(h);
  }
  for (const k of known) if (!seen.has(k)) errors.push(`Column "${k}" is missing; ${where} needs it.`);
  if (errors.length) return { ok: false, errors };

  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const armKeys = plan.arms.map((a) => a.key);
  const arms = {};
  for (const [li, line] of lines.slice(1).entries()) {
    const row = line.split(',').map((c) => c.trim());
    const rowNo = li + 2;
    if (row.length !== header.length) { errors.push(`Row ${rowNo} has ${row.length} cells; the header has ${header.length}.`); continue; }
    const arm = row[col.arm];
    if (!armKeys.includes(arm)) { errors.push(`Row ${rowNo}: arm "${arm}" is not in ${where} (arms: ${armKeys.join(', ')}).`); continue; }
    if (arms[arm]) { errors.push(`Arm "${arm}" appears twice.`); continue; }
    const unitsCell = row[col.units];
    if (!INT.test(unitsCell)) { errors.push(`Row ${rowNo} (${arm}): units must be a whole number of 0 or more, got "${unitsCell}".`); continue; }
    const units = Number(unitsCell);
    const out = { units, metrics: {} };
    for (const m of metrics) {
      const cell = row[col[m.key]];
      const parsed = m.type === 'proportion' ? propCell(cell, units) : meanCell(cell, units);
      if (parsed.error) errors.push(`Row ${rowNo} (${arm}), ${m.key}: ${parsed.error}`);
      else out.metrics[m.key] = parsed;
    }
    arms[arm] = out;
  }
  for (const a of armKeys) if (!arms[a] && !errors.some((e) => e.includes(`"${a}"`))) errors.push(`Arm "${a}" is missing; ${where} has arms ${armKeys.join(', ')}.`);
  if (errors.length) return { ok: false, errors: errors.slice(0, 8) };
  return { ok: true, arms, order: armKeys };
}

function propCell(cell, units) {
  if (cell === '' || cell === undefined) return { error: 'the cell is empty.' };
  const m = /^(\d+)(?:\/(\d+))?$/.exec(cell);
  if (!m) return { error: `a proportion is successes (denominator = units) or successes/denominator, both whole numbers; got "${cell}".` };
  const s = Number(m[1]);
  const d = m[2] === undefined ? units : Number(m[2]);
  if (!(d > 0)) return { error: 'the denominator must be more than 0.' };
  if (s > d) return { error: `successes (${s}) are more than the denominator (${d}).` };
  return { s, d };
}

function meanCell(cell, units) {
  if (cell === '' || cell === undefined) return { error: 'the cell is empty.' };
  const parts = cell.split('|').map((x) => x.trim());
  if (parts.length < 2 || parts.length > 3 || !NUM.test(parts[0]) || !NUM.test(parts[1])) return { error: `a mean is mean|sd or mean|sd|n; got "${cell}".` };
  const mean = Number(parts[0]);
  const sd = Number(parts[1]);
  if (sd < 0) return { error: 'sd must be 0 or more.' };
  let n = units;
  if (parts.length === 3) {
    if (!INT.test(parts[2]) || Number(parts[2]) === 0) return { error: `n must be a whole number above 0; got "${parts[2]}".` };
    n = Number(parts[2]);
  }
  if (!(n > 0)) return { error: 'n must be more than 0.' };
  return { mean, sd, n };
}

const bad = (msg) => ({ ok: false, errors: [msg] });
