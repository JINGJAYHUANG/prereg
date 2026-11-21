// Jira REST calls. UI and agent calls run as the current user (people act under their own permissions);
// issue-property writes and the trigger run as the app. Prereg calls only Atlassian APIs.

import api, { route } from '@forge/api';

export const PROP_KEY = 'prereg';
const requester = (asApp) => (asApp ? api.asApp() : api.asUser());

async function parse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

const errorText = (body, status) => (body.errorMessages ?? []).concat(Object.values(body.errors ?? {})).join(' ') || `HTTP ${status}`;
const FIELDS = ['summary', 'status', 'project', 'issuetype', 'created'];

export function itemOut(issue) {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    id: String(issue.id),
    summary: f.summary ?? issue.key,
    status: f.status?.name ?? '',
    done: f.status?.statusCategory?.key === 'done',
    projectKey: f.project?.key ?? null,
    issueType: f.issuetype?.name ?? '',
    created: f.created ?? null,
    prop: issue.properties?.[PROP_KEY] ?? null,
  };
}

export async function searchItems(jql, { asApp = false, max = 100 } = {}) {
  const out = [];
  let nextPageToken;
  do {
    const res = await requester(asApp).requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields: FIELDS, properties: [PROP_KEY], maxResults: Math.min(100, max - out.length), ...(nextPageToken ? { nextPageToken } : {}) }),
    });
    if (!res.ok) {
      const body = await parse(res);
      console.log(`jira search failed ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
      return { ok: false, status: res.status, items: out, error: errorText(body, res.status) };
    }
    const data = await res.json();
    for (const issue of data.issues ?? []) out.push(itemOut(issue));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken && out.length < max);
  return { ok: true, items: out };
}

export async function getItem(key, { asApp = false } = {}) {
  const res = await requester(asApp).requestJira(route`/rest/api/3/issue/${String(key)}?fields=${FIELDS.join(',')}&properties=${PROP_KEY}`);
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, item: itemOut(await res.json()) };
}

export async function setProperty(key, value) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${String(key)}/properties/${PROP_KEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) console.log(`setProperty ${key} failed ${res.status}`);
  return { ok: res.ok, status: res.status };
}

export async function createItem({ projectKey, summary, description }) {
  const post = (issueType) => api.asUser().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { project: { key: projectKey }, issuetype: { name: issueType }, summary: String(summary).slice(0, 250), ...(description ? { description: adfParagraphs(description) } : {}) } }),
  });
  let res = await post('Task');
  if (!res.ok && res.status === 400) res = await post('Story');
  if (!res.ok) {
    const body = await parse(res);
    return { ok: false, status: res.status, error: errorText(body, res.status) };
  }
  const created = await res.json();
  return { ok: true, key: created.key, id: String(created.id) };
}

export async function addComment(key, text, { asApp = false } = {}) {
  const res = await requester(asApp).requestJira(route`/rest/api/3/issue/${String(key)}/comment`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: adfParagraphs(text) }),
  });
  return { ok: res.ok, status: res.status };
}

export async function deleteItem(key) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${String(key)}`, { method: 'DELETE' });
  return { ok: res.ok || res.status === 404, status: res.status };
}

export async function listProjects() {
  const res = await api.asUser().requestJira(route`/rest/api/3/project/search?maxResults=100&orderBy=name`);
  if (!res.ok) {
    console.log(`listProjects failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  const data = await res.json();
  return (data.values ?? []).map((p) => ({ key: p.key, name: p.name }));
}

export function adfParagraphs(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return { type: 'doc', version: 1, content: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })) };
}
