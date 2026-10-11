// Validates WorkRadar mock data. Usage: node data/validate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-10-13T10:30:00+03:00');
const errors = [];
const err = (m) => errors.push(m);
const load = (f) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
  catch (e) { err(`${f}: cannot parse (${e.message})`); return null; }
};

const pf = load('people.json'), items = load('items.json'), events = load('events.json'), truth = load('ground_truth.json');
if (!pf || !items || !events || !truth) { console.error(errors.join('\n')); process.exit(1); }

const TS = /^2026-\d\d-\d\dT\d\d:\d\d:\d\d\+03:00$/;
const checkTs = (v, where, optional) => {
  if (v == null) { if (!optional) err(`${where}: missing timestamp`); return; }
  if (!TS.test(v) || Number.isNaN(Date.parse(v))) { err(`${where}: bad timestamp ${v}`); return; }
};

// people
const pids = new Set();
for (const p of pf.people) {
  if (pids.has(p.id)) err(`people: duplicate id ${p.id}`);
  pids.add(p.id);
  for (const k of ['id', 'name', 'role', 'location', 'tz']) if (typeof p[k] !== 'string') err(`person ${p.id}: ${k} missing`);
  if (typeof p.isTeam !== 'boolean') err(`person ${p.id}: isTeam missing`);
  if (![null, 'payments', 'onboarding'].includes(p.squad)) err(`person ${p.id}: bad squad`);
  if (p.ooo) { checkTs(p.ooo.from, `person ${p.id} ooo.from`); checkTs(p.ooo.to, `person ${p.id} ooo.to`); }
}
if (!pids.has(pf.manager)) err('manager id does not resolve');
const team = pf.people.filter((p) => p.isTeam);
if (team.length !== 8) err(`expected 8 team members, got ${team.length}`);

// items
const SRC = ['jira', 'github', 'slack', 'email'], TYPES = ['ticket', 'incident', 'pr', 'thread', 'email'];
const JSTAT = ['To Do', 'In Progress', 'In Review', 'Blocked', 'Done'], PSTAT = ['open', 'merged', 'closed'], TSTAT = ['open', 'resolved'];
const iids = new Set();
for (const i of items) {
  if (iids.has(i.id)) err(`items: duplicate id ${i.id}`);
  iids.add(i.id);
  if (!SRC.includes(i.source)) err(`${i.id}: bad source`);
  if (!TYPES.includes(i.type)) err(`${i.id}: bad type`);
  if (!i.id.startsWith({ jira: 'jira:', github: 'gh:', slack: 'slack:', email: 'email:' }[i.source])) err(`${i.id}: id prefix doesn't match source`);
  if (i.ownerId !== null && !pids.has(i.ownerId)) err(`${i.id}: ownerId ${i.ownerId} unresolved`);
  if (![null, 'payments', 'onboarding'].includes(i.squad)) err(`${i.id}: bad squad`);
  if (i.source === 'jira') { if (!['P0', 'P1', 'P2', 'P3'].includes(i.priority)) err(`${i.id}: jira needs priority`); if (!JSTAT.includes(i.status)) err(`${i.id}: bad jira status ${i.status}`); }
  else { if (i.priority !== null) err(`${i.id}: priority only for jira`); }
  if (i.source === 'github' && !PSTAT.includes(i.status)) err(`${i.id}: bad pr status`);
  if ((i.source === 'slack' || i.source === 'email') && !TSTAT.includes(i.status)) err(`${i.id}: bad thread/email status`);
  if (typeof i.customerFacing !== 'boolean') err(`${i.id}: customerFacing`);
  checkTs(i.createdAt, `${i.id}.createdAt`);
  checkTs(i.dueAt, `${i.id}.dueAt`, true);
  if (i.createdAt && Date.parse(i.createdAt) > NOW) err(`${i.id}: createdAt after now`);
  for (const l of i.links) { if (!iids.has(l) && !items.some((x) => x.id === l)) err(`${i.id}: link ${l} unresolved`); if (l === i.id) err(`${i.id}: self link`); }
  if (i.source === 'slack' && !i.channel) err(`${i.id}: slack needs channel`);
  if (i.source === 'email') { if (!pids.has(i.from)) err(`${i.id}: email from unresolved`); }
  if (i.source === 'github') for (const r of i.reviewers || []) if (!pids.has(r)) err(`${i.id}: reviewer ${r} unresolved`);
}

// events
const KINDS = ['created', 'status_changed', 'comment', 'review_requested', 'review_approved', 'changes_requested', 'commit', 'merged', 'deployed', 'message', 'email_received', 'email_sent', 'incident_opened', 'incident_update', 'reaction', 'ci_passed', 'ci_failed', 'bot'];
const eids = new Set();
let prev = -Infinity;
for (const e of events) {
  if (eids.has(e.id)) err(`events: duplicate id ${e.id}`);
  eids.add(e.id);
  checkTs(e.ts, e.id);
  const t = Date.parse(e.ts);
  if (t < prev) err(`${e.id}: events not sorted`);
  prev = t;
  if (t > NOW) err(`${e.id}: after now`);
  if (!iids.has(e.itemId)) err(`${e.id}: itemId ${e.itemId} unresolved`);
  const host = items.find((x) => x.id === e.itemId);
  if (host && e.kind !== 'bot' && e.kind !== 'status_changed' && t < Date.parse(host.createdAt)) err(`${e.id}: occurs before ${host.id} was created`);
  if (!pids.has(e.actorId)) err(`${e.id}: actorId ${e.actorId} unresolved`);
  if (!KINDS.includes(e.kind)) err(`${e.id}: bad kind ${e.kind}`);
  if (e.kind === 'status_changed' && (!e.from || !e.to)) err(`${e.id}: status_changed needs from/to`);
  if (['message', 'comment', 'email_received', 'email_sent'].includes(e.kind) && !e.text) err(`${e.id}: ${e.kind} needs text`);
}
if (!/^ev-0001$/.test(events[0]?.id || '')) err('event ids should start at ev-0001');

// replay status
const byItem = new Map();
for (const e of events) if (e.kind === 'status_changed' || e.kind === 'merged') (byItem.get(e.itemId) || byItem.set(e.itemId, []).get(e.itemId)).push(e);
for (const i of items) {
  if (i.source !== 'jira' && i.source !== 'github') continue;
  const evs = byItem.get(i.id);
  if (!evs) continue;
  let cur = null;
  for (const e of evs) {
    if (cur !== null && e.from !== cur) err(`${i.id}: ${e.id} from "${e.from}" but replay state was "${cur}"`);
    cur = e.to;
  }
  if (cur !== i.status) err(`${i.id}: replayed status "${cur}" != current "${i.status}"`);
}
// PRs: merged status must have a merged event
for (const i of items) if (i.source === 'github' && i.status === 'merged' && !(byItem.get(i.id) || []).some((e) => e.kind === 'merged')) err(`${i.id}: merged without merged event`);

// ground truth
const sids = new Set();
for (const s of truth) {
  if (sids.has(s.id)) err(`truth: duplicate ${s.id}`);
  sids.add(s.id);
  if (!['top', 'happened', 'attention', 'blocked', 'noise'].includes(s.panel)) err(`${s.id}: bad panel`);
  for (const k of ['title', 'hiddenIn', 'expected']) if (!s[k]) err(`${s.id}: ${k} missing`);
  if (!s.itemIds?.length) err(`${s.id}: itemIds empty`);
  for (const id of s.itemIds || []) if (!iids.has(id)) err(`${s.id}: itemId ${id} unresolved`);
  for (const id of s.eventIds || []) if (!eids.has(id)) err(`${s.id}: eventId ${id} unresolved`);
}
for (let n = 1; n <= 12; n++) if (!sids.has('S' + n)) err(`missing signal S${n}`);

if (errors.length) {
  console.error(`FAIL: ${errors.length} problem(s)`);
  for (const m of errors) console.error(' - ' + m);
  process.exit(1);
}
console.log(`OK: ${pf.people.length} people, ${items.length} items, ${events.length} events, ${truth.length} signals`);
