"use client";
// One client-side store for everything the manager does to an item: assign, mark done, snooze, acknowledge, nudge.
// Persisted to localStorage (best effort), shared by the dashboard, triage, drawer and detail page, with undo.
import { useSyncExternalStore } from "react";
import type { BoardItem, BoardState, HappenedEntry, WorkEvent } from "@/lib/types";
import { DEMO_NOW, MANAGER_ID } from "@/lib/types";
import { formatInManagerTz } from "@/lib/board";
import { getPerson, itemById } from "@/lib/data";

export type ActionKind = "assign" | "done" | "snooze" | "ack" | "nudge";
export interface UserAction {
  itemId: string;
  action: ActionKind;
  to?: string; // person id (assign)
  until?: string; // iso (snooze)
  at: string; // iso, demo clock
  message?: string; // nudge text
}
export type ItemActions = Partial<Record<ActionKind, UserAction>>;
interface LogEntry {
  seq: number;
  itemId: string;
  action: ActionKind;
  prev?: UserAction;
  undone?: boolean;
}
interface State {
  items: Record<string, ItemActions>;
  log: LogEntry[];
  seq: number;
}

const KEY = "workradar.actions.v1";
const LEGACY_KEY = "workradar.triage.v1";

/** Snooze presets on the demo clock (Tue 13 Oct 09:30 Cologne). */
export const SNOOZE_OPTIONS = [
  { id: "tomorrow", label: "Tomorrow 09:00", until: "2026-10-14T09:00:00+02:00" },
  { id: "nextweek", label: "Next week", until: "2026-10-19T09:00:00+02:00" },
] as const;

let state: State = { items: {}, log: [], seq: 0 };
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s && s.items) state = { items: s.items, log: s.log ?? [], seq: s.seq ?? 0 };
    } else {
      // one-time migration from the earlier triage-only store
      const legacy = window.localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const d = JSON.parse(legacy) as Record<string, { action: string; at: string; to?: string; message?: string }>;
        const items: Record<string, ItemActions> = {};
        for (const [id, v] of Object.entries(d)) {
          const action: ActionKind = v.action === "delegate" ? "assign" : (v.action as ActionKind);
          if (!["assign", "snooze", "ack", "nudge"].includes(action)) continue;
          items[id] = { [action]: { itemId: id, action, at: v.at, to: v.to, message: v.message, until: action === "snooze" ? SNOOZE_OPTIONS[0].until : undefined } };
        }
        state = { items, log: [], seq: 0 };
        persist();
        window.localStorage.removeItem(LEGACY_KEY);
      }
    }
  } catch {
    /* storage blocked: actions live in memory only */
  }
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...state, log: state.log.slice(-50) }));
  } catch {
    /* ignore */
  }
}

function emit() {
  persist();
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      loaded = false;
      load();
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: State = { items: {}, log: [], seq: 0 };
function getSnapshot() {
  load();
  return state;
}

export function useActions(): State {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

export function act(itemId: string, action: ActionKind, extra: Partial<UserAction> = {}) {
  load();
  const cur = state.items[itemId] ?? {};
  const seq = state.seq + 1;
  const entry: LogEntry = { seq, itemId, action, prev: cur[action] };
  const next: ItemActions = { ...cur, [action]: { itemId, action, at: DEMO_NOW, ...extra } };
  // marking done or snoozing clears the other so the latest intent wins
  if (action === "done") delete next.snooze;
  if (action === "snooze") delete next.done;
  state = { items: { ...state.items, [itemId]: next }, log: [...state.log, entry], seq };
  emit();
  return seq;
}

/** Undo one log entry (by seq), or the latest action on an item, or the latest action overall. */
export function undo(opts: { seq?: number; itemId?: string } = {}) {
  load();
  const live = state.log.filter((e) => !e.undone);
  const entry = opts.seq !== undefined ? live.find((e) => e.seq === opts.seq) : [...live].reverse().find((e) => !opts.itemId || e.itemId === opts.itemId);
  const cur = entry ? state.items[entry.itemId] : opts.itemId ? state.items[opts.itemId] : undefined;
  if (!entry) {
    // no log (for example migrated data): clear the item's actions outright
    if (opts.itemId && cur) {
      const items = { ...state.items };
      delete items[opts.itemId];
      state = { ...state, items };
      emit();
    }
    return;
  }
  const next: ItemActions = { ...(cur ?? {}) };
  if (entry.prev) next[entry.action] = entry.prev;
  else delete next[entry.action];
  const items = { ...state.items, [entry.itemId]: next };
  if (!Object.keys(next).length) delete items[entry.itemId];
  state = { items, log: state.log.map((e) => (e.seq === entry.seq ? { ...e, undone: true } : e)), seq: state.seq };
  emit();
}

export function lastEntry(s: State): LogEntry | undefined {
  return [...s.log].reverse().find((e) => !e.undone);
}

export function actionLabel(a: UserAction): string {
  switch (a.action) {
    case "ack":
      return "Acknowledged";
    case "assign":
      return `Assigned to ${getPerson(a.to)?.name.split(" ")[0] ?? "teammate"}`;
    case "snooze":
      return `Snoozed until ${a.until ? formatInManagerTz(a.until) : "later"}`;
    case "done":
      return "Marked done";
    case "nudge":
      return "Nudged";
  }
}

/** Most meaningful single label for chips: done > snooze > assign > nudge > ack. */
export function primaryAction(a?: ItemActions): UserAction | undefined {
  if (!a) return undefined;
  return a.done ?? a.snooze ?? a.assign ?? a.nudge ?? a.ack;
}

export function hasAnyAction(a?: ItemActions) {
  return !!a && Object.keys(a).length > 0;
}

// ---------------------------------------------------------------- overlay on the board (live view only)

export interface OverlayBoard extends BoardState {
  snoozed: BoardItem[];
  doneIds: Set<string>;
}

const withOwner = (b: BoardItem, a?: ItemActions): BoardItem => (a?.assign?.to ? { ...b, item: { ...b.item, ownerId: a.assign.to } } : b);

export function applyActions(board: BoardState, s: State, live: boolean): OverlayBoard {
  if (!live) return { ...board, snoozed: [], doneIds: new Set() };
  const now = Date.parse(DEMO_NOW);
  const doneIds = new Set<string>();
  const snoozedIds = new Set<string>();
  for (const [id, a] of Object.entries(s.items)) {
    if (a.done) doneIds.add(id);
    else if (a.snooze?.until && Date.parse(a.snooze.until) > now) snoozedIds.add(id);
  }
  const hidden = (id: string) => doneIds.has(id) || snoozedIds.has(id);
  const map = (b: BoardItem) => withOwner(b, s.items[b.item.id]);
  const items = board.items.filter((b) => !hidden(b.item.id)).map(map);
  const snoozed = board.items.filter((b) => snoozedIds.has(b.item.id)).map(map);
  // top: keep the rule-based picks that remain, then refill from the next best unblocked items
  const top = board.top.filter((b) => !hidden(b.item.id)).map(map);
  for (const b of items) {
    if (top.length >= 5) break;
    if (!b.blocked && b.score.total >= 20 && !top.some((x) => x.item.id === b.item.id)) top.push(b);
  }
  top.sort((a, b) => b.score.total - a.score.total);
  const attention = board.attention.filter((b) => !hidden(b.item.id)).map(map);
  const blocked = board.blocked
    .map((p) => ({ ...p, items: p.items.filter((b) => !hidden(b.item.id)).map(map) }))
    .filter((p) => p.items.length > 0);
  const extra: HappenedEntry[] = [];
  for (const id of doneIds) {
    const item = itemById.get(id);
    const a = s.items[id].done!;
    if (!item) continue;
    const event: WorkEvent = { id: `user-done-${id}`, ts: a.at, itemId: id, actorId: MANAGER_ID, kind: "status_changed", to: "Done", text: "Marked done in WorkRadar" };
    extra.push({ event, item, label: `${item.key} marked done by you` });
  }
  const happened = [...extra, ...board.happened].sort((a, b) => Date.parse(b.event.ts) - Date.parse(a.event.ts));
  return { ...board, items, top, attention, blocked, happened, snoozed, doneIds };
}
