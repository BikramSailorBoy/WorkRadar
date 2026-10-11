// WorkRadar core logic: replays the mock data to time t and derives the manager's board.
// Everything here is rule-based and generic (no item ids). AI-derived signals come in as ExtractedSignal[].
import type {
  BlockedPerson,
  BoardItem,
  BoardState,
  ExtractedSignal,
  HappenedEntry,
  Person,
  Ring,
  ScoreBreakdown,
  WorkEvent,
  WorkItem,
} from "./types";
import { DEMO_NOW, MANAGER_ID, MANAGER_TZ, WEEK_START } from "./types";
import { eventsByItem, extractedCache, getPerson, items as allItems, itemById, events as allEvents } from "./data";

// ---------------------------------------------------------------- constants

/** Q4 audit release freeze (announced in #eng-announcements). */
export const FREEZE_AT = "2026-10-15T12:00:00+03:00";
/** Silent-stall / staleness thresholds in the owner's working hours. The brief said 72h/24h; with weekends
 * excluded. Matches the PRD: more than 72 working hours without movement is stale. */
export const STALE_LONG_H = 72;
export const STALE_SHORT_H = 24;
const REVIEW_BLOCK_H = 24;
const HOUR = 3_600_000;
const DAY_START_TZ = "Asia/Riyadh"; // data timestamps are +03:00; the working day starts 08:00 there
const NOISE_KINDS = new Set(["reaction", "ci_passed", "ci_failed", "bot"]);
const DONE_STATES = new Set(["done", "merged", "closed", "resolved"]);
const BOARD_CONTEXT_KINDS = new Set(["escalation", "decision_request", "blocker"]);
/** Weekend days (0 = Sun) by timezone; everything else is Sat/Sun. */
const WEEKEND_BY_TZ: Record<string, number[]> = { "Asia/Riyadh": [5, 6], "Africa/Cairo": [5, 6] };

// ---------------------------------------------------------------- time helpers

const ms = (ts: string) => Date.parse(ts);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const wdFormatters = new Map<string, Intl.DateTimeFormat>();
function weekdayIndex(tz: string, epoch: number): number {
  let f = wdFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    wdFormatters.set(tz, f);
  }
  return WEEKDAYS.indexOf(f.format(new Date(epoch)));
}

const HALF = 1_800_000;
const weekendCache = new Map<string, boolean>();
function isWeekendBucket(tz: string, bucket: number): boolean {
  const key = tz + "|" + bucket;
  let v = weekendCache.get(key);
  if (v === undefined) {
    const wd = weekdayIndex(tz, bucket * HALF + 1);
    v = (WEEKEND_BY_TZ[tz] ?? [0, 6]).includes(wd);
    weekendCache.set(key, v);
  }
  return v;
}

/** Hours between two instants, excluding the weekend in the given timezone. */
export function workingHoursBetween(fromMs: number, toMs: number, tz: string): number {
  if (toMs <= fromMs) return 0;
  let total = 0;
  for (let b = Math.floor(fromMs / HALF); b * HALF < toMs; b++) {
    const overlap = Math.min(toMs, (b + 1) * HALF) - Math.max(fromMs, b * HALF);
    if (overlap > 0 && !isWeekendBucket(tz, b)) total += overlap;
  }
  return total / HOUR;
}

const mgrDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: MANAGER_TZ, weekday: "short" });
const mgrTimeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: MANAGER_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "Tue 09:30" in the manager's timezone (Europe/Berlin). */
export function formatInManagerTz(ts: string | number): string {
  const d = new Date(typeof ts === "number" ? ts : ms(ts));
  return `${mgrDayFmt.format(d)} ${mgrTimeFmt.format(d)}`;
}
const mgrLongDay = new Intl.DateTimeFormat("en-US", { timeZone: MANAGER_TZ, weekday: "long" });

function dayStartOf(t: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DAY_START_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  return ms(`${parts}T08:00:00+03:00`);
}

const personTz = (id: string | null | undefined) => getPerson(id)?.tz ?? MANAGER_TZ;
const firstName = (p?: Person) => (p ? p.name.split(" ")[0] : "someone");
const isExec = (p?: Person) => !!p && /\b(CEO|CFO|COO|CTO|CIO|Chief|President|VP)\b/i.test(p.role);
const isOpenStatus = (s: string) => !DONE_STATES.has(s.toLowerCase());
const isContext = (i: WorkItem) => i.type === "thread" || i.type === "email";
function isOooAt(personId: string, t: number): boolean {
  const o = getPerson(personId)?.ooo;
  return !!o && ms(o.from) <= t && t <= ms(o.to);
}

// ---------------------------------------------------------------- replay

function statusAt(item: WorkItem, t: number): string {
  const evs = eventsByItem.get(item.id) ?? [];
  const changes = evs.filter((e) => (e.kind === "status_changed" || e.kind === "merged") && e.to);
  let cur: string | undefined;
  for (const e of changes) if (ms(e.ts) <= t) cur = e.to;
  if (cur) return cur;
  if (changes.length && changes[0].from) return changes[0].from; // before the first recorded change
  return item.status;
}

function firstSeen(item: WorkItem): number {
  const evs = eventsByItem.get(item.id);
  return Math.min(ms(item.createdAt), evs?.length ? ms(evs[0].ts) : Infinity);
}

type SigMap = Map<string, ExtractedSignal[]>;

function meaningful(e: WorkEvent, bearing: Set<string>): boolean {
  if (NOISE_KINDS.has(e.kind)) return false;
  const item = itemById.get(e.itemId);
  if (!item) return false;
  if (isContext(item) && !bearing.has(item.id)) return false; // chit-chat threads / routine emails
  return true;
}

function bearingSet(sigs: ExtractedSignal[]): Set<string> {
  const s = new Set<string>();
  for (const sig of sigs) if (BOARD_CONTEXT_KINDS.has(sig.kind)) for (const id of sig.itemIds) s.add(id);
  return s;
}

// ---------------------------------------------------------------- internal per-item record

interface Review {
  pending: string[];
  since: number;
  waitH: number;
}

interface Rec {
  item: WorkItem;
  status: string;
  signals: ExtractedSignal[];
  lastActivity: number | null;
  activityBase: number;
  workHoursIdle: number;
  review: Review | null;
  // blocking
  blocked: boolean;
  reason?: string;
  rootLabel?: string;
  since?: number;
  waitingOn?: string;
  dependsOn: string[]; // item ids
  directBlocks: boolean; // blocked by own mechanism (not only propagation)
  managerAction: boolean;
  managerReasons: string[];
}

function reviewState(item: WorkItem, status: string, t: number): Review | null {
  if (item.type !== "pr" || status.toLowerCase() !== "open") return null;
  const evs = (eventsByItem.get(item.id) ?? []).filter((e) => ms(e.ts) <= t);
  const reqs = evs.filter((e) => e.kind === "review_requested");
  if (!reqs.length) return null;
  const responses = evs.filter((e) => e.kind === "review_approved" || e.kind === "changes_requested");
  const lastReq = ms(reqs[reqs.length - 1].ts);
  const lastResp = responses.length ? responses[responses.length - 1] : undefined;
  const respTs = lastResp ? ms(lastResp.ts) : -Infinity;
  const approvedBy = new Set(evs.filter((e) => e.kind === "review_approved").map((e) => e.actorId));
  const pending = (item.reviewers ?? []).filter((r) => !approvedBy.has(r));
  if (!pending.length) return null;

  let asks: number[];
  if (lastResp && respTs >= lastReq) {
    if (lastResp.kind === "review_approved") return null;
    // changes requested: the ball is with the author until they push again
    const fix = evs.find((e) => e.kind === "commit" && e.actorId === item.ownerId && ms(e.ts) > respTs);
    if (!fix) return null;
    asks = [ms(fix.ts)];
  } else {
    asks = reqs.filter((e) => ms(e.ts) > respTs).map((e) => ms(e.ts));
    // author pings (@reviewer) before the formal request count as the start of the wait
    for (const e of evs) {
      if (e.kind === "comment" && e.actorId === item.ownerId && ms(e.ts) > respTs && pending.some((r) => (e.text ?? "").includes("@" + r))) asks.push(ms(e.ts));
    }
  }
  const since = Math.min(...asks);
  return { pending, since, waitH: workingHoursBetween(since, t, personTz(item.ownerId)) };
}

// ---------------------------------------------------------------- label helpers

function cleanBlockedBy(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function blockedByLabel(raw: string): string {
  const person = getPerson(raw);
  if (person) return person.name;
  return cleanBlockedBy(raw);
}
function reasonFromBlockedBy(raw: string, t: number): string {
  const person = getPerson(raw);
  if (person) return `Waiting on ${person.name}${isOooAt(person.id, t) ? " (OOO)" : ""}`;
  if (/^us:\s*/i.test(raw)) return "Blocked on us: " + raw.replace(/^us:\s*/i, "");
  return "Waiting on " + raw;
}
const BLOCKED_BY_RE = /blocked\s+(?:by|on)\s+([A-Z][A-Z0-9]*-\d+)/i;

// ---------------------------------------------------------------- main

export function deriveBoard(at: string, opts?: { extracted?: ExtractedSignal[] }): BoardState {
  const t = ms(at);
  const extracted = opts?.extracted ?? extractedCache;
  const signals = extracted.filter((s) => ms(s.evidenceTs) <= t);
  const bearing = bearingSet(signals);
  const sigByItem: SigMap = new Map();
  for (const s of signals) for (const id of s.itemIds) {
    const a = sigByItem.get(id);
    if (a) a.push(s);
    else sigByItem.set(id, [s]);
  }
  const keyToId = new Map(allItems.map((i) => [i.key.toLowerCase(), i.id]));

  // ---- visible, open records
  const recs = new Map<string, Rec>();
  for (const item of allItems) {
    if (firstSeen(item) > t) continue;
    const status = statusAt(item, t);
    if (!isOpenStatus(status)) continue;
    if (isContext(item) && !bearing.has(item.id)) continue;
    if (isContext(item) && !(sigByItem.get(item.id) ?? []).some((s) => BOARD_CONTEXT_KINDS.has(s.kind))) continue;
    // activity: own meaningful events plus those of directly linked ticket/PR counterparts
    const own = eventsByItem.get(item.id) ?? [];
    let evs = own;
    if (!isContext(item)) {
      const pair = item.links.map((l) => itemById.get(l)).filter((l): l is WorkItem => !!l && !isContext(l) && (l.type === "pr") !== (item.type === "pr"));
      if (pair.length) evs = own.concat(...pair.map((p) => eventsByItem.get(p.id) ?? []));
    }
    let last: number | null = null;
    for (const e of evs) {
      const ts = ms(e.ts);
      if (ts <= t && (last === null || ts > last) && meaningful(e, bearing)) last = ts;
    }
    const base = last ?? firstSeen(item);
    recs.set(item.id, {
      item, status, signals: sigByItem.get(item.id) ?? [], lastActivity: last, activityBase: base,
      workHoursIdle: workingHoursBetween(base, t, personTz(item.ownerId)),
      review: reviewState(item, status, t),
      blocked: false, dependsOn: [], directBlocks: false, managerAction: false, managerReasons: [],
    });
  }
  const R = (id: string) => recs.get(id);
  const nonCtx = [...recs.values()].filter((r) => !isContext(r.item));

  // ---- blocker signal targets: non-context items in the signal owned by the blocked person
  const blockerBy = new Map<string, ExtractedSignal[]>();
  for (const s of signals) {
    if (s.kind !== "blocker") continue;
    const cands = s.itemIds.map(R).filter((r): r is Rec => !!r && !isContext(r.item));
    let targets = cands.filter((r) => s.personId && r.item.ownerId === s.personId);
    if (!targets.length && cands.length) targets = [cands[0]];
    for (const r of targets) {
      const a = blockerBy.get(r.item.id);
      if (a) a.push(s);
      else blockerBy.set(r.item.id, [s]);
    }
  }

  // ---- direct blocking
  for (const r of nonCtx) {
    const { item } = r;
    const evs = (eventsByItem.get(item.id) ?? []).filter((e) => ms(e.ts) <= t);
    const sigs = blockerBy.get(item.id) ?? [];
    const sinces: number[] = [];
    let reason: string | undefined;
    let rootLabel: string | undefined;
    let waitingOn: string | undefined;

    // dependency hints: owner's "blocked by KEY" comment, blocker signal text naming another item
    const lastBlockComment = [...evs].reverse().find((e) => e.kind === "comment" && e.actorId === item.ownerId && BLOCKED_BY_RE.test(e.text ?? ""));
    const depKeys = new Set<string>();
    if (lastBlockComment) depKeys.add(BLOCKED_BY_RE.exec(lastBlockComment.text ?? "")![1].toLowerCase());
    for (const s of sigs) if (s.blockedBy) for (const m of s.blockedBy.matchAll(/[A-Za-z][A-Za-z0-9]*-\d+/g)) depKeys.add(m[0].toLowerCase());
    for (const k of depKeys) {
      const id = keyToId.get(k);
      if (id && id !== item.id && R(id) && !isContext(R(id)!.item)) r.dependsOn.push(id);
    }
    // a ticket depends on its open PR(s)
    if (item.type !== "pr") {
      for (const l of item.links) {
        const lr = R(l);
        if (lr && lr.item.type === "pr") r.dependsOn.push(l);
      }
    }

    // 1) Jira Blocked
    if (item.source === "jira" && r.status.toLowerCase() === "blocked") {
      const ch = [...evs].reverse().find((e) => e.kind === "status_changed" && e.to?.toLowerCase() === "blocked");
      sinces.push(ch ? ms(ch.ts) : ms(item.createdAt));
      reason = "Marked Blocked in Jira";
      rootLabel = "blocked in Jira";
      r.directBlocks = true;
    }
    // 2) blocker signals
    if (sigs.length) {
      r.directBlocks = true;
      for (const s of sigs) sinces.push(ms(s.evidenceTs));
      const withBy = sigs.filter((s) => s.blockedBy);
      const s0 = withBy[0] ?? sigs[0];
      if (s0.blockedBy) {
        const keyed = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(s0.blockedBy.trim());
        reason = keyed ? `Blocked by ${s0.blockedBy.trim()}` : reasonFromBlockedBy(s0.blockedBy, t);
        rootLabel = keyed ? undefined : blockedByLabel(s0.blockedBy);
        waitingOn = s0.blockedBy;
      } else {
        reason = s0.summary;
        rootLabel = "see signal";
      }
    }
    // 3) PR waiting on review
    const rv = r.review;
    const mgrOnly = !!rv && rv.pending.every((p) => p === MANAGER_ID);
    if (rv && !mgrOnly) {
      const oooAll = rv.pending.every((p) => isOooAt(p, t));
      if (rv.waitH > REVIEW_BLOCK_H || (oooAll && rv.waitH > 0)) {
        const names = rv.pending.map((p) => getPerson(p)?.name ?? p).join(", ");
        reason = `Waiting ${Math.round(rv.waitH)}h on review from ${names}${oooAll ? "; reviewer OOO" : ""}`;
        rootLabel = `review: ${names}${oooAll ? " (OOO)" : ""}`;
        waitingOn = rv.pending[0];
        sinces.push(rv.since);
        r.directBlocks = true;
      }
    }
    if (rv && rv.pending.includes(MANAGER_ID)) {
      r.managerAction = true;
      r.managerReasons.push(`Waiting ${Math.round(rv.waitH)}h on your review`);
    }
    if (r.directBlocks) {
      r.blocked = true;
      r.reason = reason;
      r.rootLabel = rootLabel;
      r.waitingOn = waitingOn;
      r.since = Math.min(...sinces);
    }
  }

  // ---- propagate through dependencies
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of nonCtx) {
      const dep = r.dependsOn.map(R).find((d) => d && d.blocked && d !== r);
      if (!dep) continue;
      if (!r.blocked) {
        r.blocked = true;
        r.since = dep.since;
        changed = true;
      }
    }
  }
  for (const r of nonCtx) {
    const dep = r.dependsOn.map(R).find((d) => d && d.blocked && d !== r);
    if (!dep || !r.blocked) continue;
    const root = dep.rootLabel ? ` — ${dep.rootLabel}` : "";
    r.reason = `Waiting on ${dep.item.key}${root}`;
    r.waitingOn = dep.item.key;
    if (dep.since !== undefined) r.since = r.directBlocks && r.since !== undefined ? Math.min(r.since, dep.since) : dep.since;
  }

  // ---- fanout dependents
  const dependents = new Map<string, Rec[]>();
  for (const r of nonCtx) {
    if (!r.blocked) continue;
    for (const d of r.dependsOn) {
      const dr = R(d);
      if (dr && dr.blocked) {
        const a = dependents.get(d);
        if (a) a.push(r);
        else dependents.set(d, [r]);
      }
    }
  }

  // ---- scoring
  const freeze = ms(FREEZE_AT);
  const boardItems = new Map<string, BoardItem>();
  const detail = new Map<string, { due: number | null; claimed: ExtractedSignal | undefined; waiters: Person[]; deps: Rec[]; exec: boolean }>();

  for (const r of recs.values()) {
    const { item } = r;
    const sigs = r.signals;
    const reasons: string[] = [];
    const claimed = sigs.filter((s) => s.kind === "priority_conflict" && s.claimedDeadline);
    const dueCandidates = [item.dueAt ? ms(item.dueAt) : null, ...claimed.map((s) => ms(s.claimedDeadline!))].filter((x): x is number => x !== null);
    const due = dueCandidates.length ? Math.min(...dueCandidates) : null;

    // urgency
    let urgency = 0;
    const isP0Inc = item.type === "incident" && item.priority === "P0";
    if (isP0Inc) urgency = 30;
    else if (due !== null) {
      if (due <= t + 24 * HOUR) urgency = 30;
      else if (due <= t + 72 * HOUR || due <= freeze) urgency = 20;
      else urgency = 10;
    }

    // impact
    let impact = { P0: 25, P1: 18, P2: 10, P3: 4 }[item.priority ?? "P3"] ?? 6;
    if (item.priority === null) impact = 6;
    if (item.customerFacing) impact += 5;
    impact = Math.min(25, impact);
    const execConflict = sigs.find((s) => s.kind === "priority_conflict" && isExec(getPerson(s.personId)));
    if (execConflict) impact = Math.max(impact, 18);

    // fanout: other items (blocked on this) and people waiting on it
    const deps = dependents.get(item.id) ?? [];
    const counted = new Set<string>(deps.map((d) => d.item.ownerId ?? ""));
    const waiters: Person[] = [];
    for (const s of sigs) {
      if (!["decision_request", "escalation", "priority_conflict"].includes(s.kind) || !s.personId) continue;
      if (s.personId === item.ownerId || s.personId === MANAGER_ID || counted.has(s.personId)) continue;
      const p = getPerson(s.personId);
      if (!p) continue;
      counted.add(s.personId);
      waiters.push(p);
    }
    const fanout = Math.min(20, 7 * (deps.length + waiters.length));

    // staleness (open items only here)
    const stalled = r.workHoursIdle > STALE_LONG_H;
    const staleness = stalled ? 15 : r.workHoursIdle > STALE_SHORT_H ? 8 : 0;

    // escalation
    const exec = sigs.some((s) => s.kind !== "ooo" && isExec(getPerson(s.personId)));
    const escalation = sigs.some((s) => s.kind === "escalation" || s.kind === "decision_request") || exec ? 10 : 0;

    const total = Math.min(100, urgency + impact + fanout + staleness + escalation);
    const score: ScoreBreakdown = { urgency, impact, fanout, staleness, escalation, total };
    const ring: Ring = total >= 75 ? "now" : total >= 50 ? "today" : "watch";

    // reasons
    if (isP0Inc) reasons.push(`P0 incident${item.customerFacing ? ", customer-facing" : ""}`);
    else if ((item.priority === "P0" || item.priority === "P1") && item.customerFacing) reasons.push(`${item.priority}, customer-facing`);
    else if (item.priority === "P0" || item.priority === "P1") reasons.push(item.priority);
    if (execConflict) {
      const p = getPerson(execConflict.personId)!;
      reasons.push(`${p.name} (${p.role}) needs it ${execConflict.claimedDeadline ? formatInManagerTz(execConflict.claimedDeadline) : "sooner"}; Jira says ${item.priority ?? "unprioritised"}`);
    }
    if (due !== null && !isP0Inc && !(execConflict && due === ms(execConflict.claimedDeadline ?? ""))) {
      const beforeFreeze = due <= freeze;
      if (due <= t) reasons.push(`Overdue since ${formatInManagerTz(due)}`);
      else if (due <= t + 24 * HOUR) reasons.push(`Due in ${Math.max(1, Math.round((due - t) / HOUR))}h${beforeFreeze ? ", before " + mgrLongDay.format(new Date(freeze)) + " freeze" : ""}`);
      else if (beforeFreeze) reasons.push(`Due before ${mgrLongDay.format(new Date(freeze))} freeze`);
      else if (urgency >= 20) reasons.push(`Due ${formatInManagerTz(due)}`);
    }
    for (const s of sigs) {
      if (s.kind === "decision_request") {
        reasons.push(`Decision needed from you (${firstName(getPerson(s.personId))})`);
      } else if (s.kind === "escalation" && s.personId) {
        const p = getPerson(s.personId);
        if (p && p.id !== item.ownerId) reasons.push(`Escalated by ${p.name}`);
      }
    }
    reasons.push(...r.managerReasons);
    if (deps.length) reasons.push(`Holds up ${deps.map((d) => d.item.key).join(", ")}`);
    if (r.blocked && r.reason) reasons.push(r.reason);
    if (stalled) reasons.push(`No activity for ${Math.max(1, Math.round(r.workHoursIdle / 24))} working days`);
    else if (staleness) reasons.push(`Quiet for ${Math.round(r.workHoursIdle)} working hours`);
    const uniq = [...new Set(reasons)];

    boardItems.set(item.id, {
      item,
      status: r.status,
      score,
      ring,
      blocked: r.blocked,
      blockedReason: r.blocked ? r.reason : undefined,
      blockedSinceTs: r.blocked && r.since !== undefined ? toRiyadhIso(r.since) : undefined,
      waitingOn: r.blocked ? r.waitingOn : undefined,
      signals: sigs,
      lastActivityTs: r.lastActivity !== null ? toRiyadhIso(r.lastActivity) : null,
      changedRecently: r.lastActivity !== null && t - r.lastActivity <= HOUR && r.lastActivity <= t,
      reasons: uniq,
    });
    detail.set(item.id, { due, claimed: claimed[0], waiters, deps, exec });
    if (sigs.some((s) => s.kind === "decision_request")) r.managerAction = true;
  }

  const sorted = [...boardItems.values()].sort((a, b) => b.score.total - a.score.total || a.item.key.localeCompare(b.item.key));

  // ---- suppress context items whose linked work item is already on the board
  const hasParent = (b: BoardItem): boolean => {
    if (!isContext(b.item)) return false;
    const linked = new Set(b.item.links);
    for (const o of allItems) if (o.links.includes(b.item.id)) linked.add(o.id);
    for (const id of linked) {
      const o = recs.get(id);
      if (o && !isContext(o.item)) return true;
    }
    return false;
  };

  // ---- top
  const topPool = sorted.filter((b) => !b.blocked && !hasParent(b));
  const mgr = topPool.filter((b) => recs.get(b.item.id)!.managerAction).slice(0, 2);
  const mgrIds = new Set(mgr.map((b) => b.item.id));
  const rest = topPool.filter((b) => !mgrIds.has(b.item.id) && b.score.total >= 20).slice(0, 5 - mgr.length);
  const top = [...mgr, ...rest].sort((a, b) => b.score.total - a.score.total).slice(0, 5);

  // ---- attention
  const attention = topPool.filter((b) => {
    const r = recs.get(b.item.id)!;
    const d = detail.get(b.item.id)!;
    const sigs = b.signals;
    if (b.score.total >= 75) return true;
    if (b.item.type === "incident" && (b.item.priority === "P0" || b.item.priority === "P1")) return true;
    if (sigs.some((s) => s.kind === "escalation" || s.kind === "decision_request")) return true;
    if (d.due !== null && d.due <= t + 24 * HOUR) return true;
    if (r.status.toLowerCase() === "in progress" && r.workHoursIdle > STALE_LONG_H) return true;
    return false;
  });

  // ---- blocked, grouped by blocked owner
  const byOwner = new Map<string, BoardItem[]>();
  for (const b of sorted) {
    if (!b.blocked || isContext(b.item) || !b.item.ownerId || !getPerson(b.item.ownerId)) continue;
    const a = byOwner.get(b.item.ownerId);
    if (a) a.push(b);
    else byOwner.set(b.item.ownerId, [b]);
  }
  const chainOf = (start: Rec): string[] => {
    const labels = [start.item.key];
    const seen = new Set([start.item.id]);
    let cur = start;
    for (;;) {
      const dep = cur.dependsOn.map(R).find((d) => d && d.blocked && !seen.has(d.item.id));
      if (!dep) break;
      labels.push(dep.item.key);
      seen.add(dep.item.id);
      cur = dep;
    }
    labels.push(cur.rootLabel ?? "waiting");
    return labels;
  };
  const blocked: BlockedPerson[] = [...byOwner.entries()].map(([pid, bis]) => {
    const chains = bis.map((b) => chainOf(recs.get(b.item.id)!));
    let best = 0;
    chains.forEach((c, i) => { if (c.length > chains[best].length) best = i; });
    return { person: getPerson(pid)!, items: bis, chain: chains[best] };
  }).sort((a, b) => Math.max(...b.items.map((i) => i.score.total)) - Math.max(...a.items.map((i) => i.score.total)));

  // ---- happened (since 08:00 +03:00 of t's day)
  const since = dayStartOf(t);
  const happened = buildHappened(since, t, signals);

  // ---- timeline for the scrubber (fixed window, signals as of DEMO_NOW)
  const timeline = buildTimeline();

  return { at, items: sorted, top, attention, blocked, happened, timeline };
}

function toRiyadhIso(epoch: number): string {
  const d = new Date(epoch + 3 * HOUR);
  return d.toISOString().replace(/\.\d{3}Z$/, "+03:00");
}

// ---------------------------------------------------------------- happened / timeline

function happenedLabel(e: WorkEvent, item: WorkItem, escalationEvents: Set<string>): string | null {
  switch (e.kind) {
    case "merged":
      return `${item.key} merged`;
    case "deployed":
      return /production/i.test(e.text ?? "") ? `${item.key} deployed to production` : `${item.key} deployed`;
    case "status_changed": {
      const to = (e.to ?? "").toLowerCase();
      if (to === "done") return `${item.key} moved to Done`;
      if (to === "blocked") return `${item.key} moved to Blocked`;
      return null;
    }
    case "incident_opened":
      return `${item.key} opened${item.priority ? ` (${item.priority}${item.customerFacing ? ", customer-facing" : ""})` : ""}`;
    case "email_received":
      return escalationEvents.has(e.id) ? `Escalation email from ${getPerson(e.actorId)?.name ?? e.actorId}` : null;
    default:
      return null;
  }
}

function buildHappened(from: number, t: number, sigs: ExtractedSignal[]): HappenedEntry[] {
  const esc = new Set(sigs.filter((s) => s.kind === "escalation").map((s) => s.evidenceEventId));
  const out: HappenedEntry[] = [];
  for (const e of allEvents) {
    const ts = ms(e.ts);
    if (ts < from || ts > t) continue;
    const item = itemById.get(e.itemId);
    if (!item) continue;
    const label = happenedLabel(e, item, esc);
    if (label) out.push({ event: e, item, label });
  }
  return out.sort((a, b) => ms(b.event.ts) - ms(a.event.ts) || b.event.id.localeCompare(a.event.id));
}

function buildTimeline(): BoardState["timeline"] {
  const sigs = extractedCache.filter((s) => ms(s.evidenceTs) <= ms(DEMO_NOW));
  const bearing = bearingSet(sigs);
  const esc = new Set(sigs.filter((s) => s.kind === "escalation").map((s) => s.evidenceEventId));
  const lo = ms(WEEK_START);
  const hi = ms(DEMO_NOW);
  const out: BoardState["timeline"] = [];
  for (const e of allEvents) {
    const ts = ms(e.ts);
    if (ts < lo || ts > hi || !meaningful(e, bearing)) continue;
    const item = itemById.get(e.itemId)!;
    const important =
      e.kind === "incident_opened" || e.kind === "incident_update" || e.kind === "merged" || e.kind === "deployed" ||
      esc.has(e.id) || (e.kind === "status_changed" && (e.to ?? "").toLowerCase() === "blocked");
    out.push({ ts: e.ts, source: item.source, important, eventId: e.id });
  }
  return out;
}
