// Builds the compact board the AI routes expect (see api-types.ts). Client-side, no network.
import type { BoardItem, BoardState } from "./types";
import type { CompactBoard, CompactItem, RecentEvent } from "./api-types";
import { events, getPerson } from "./data";

const NOISE = new Set(["reaction", "ci_passed", "ci_failed", "bot"]);

export function toCompactItem(b: BoardItem): CompactItem {
  const owner = getPerson(b.item.ownerId);
  return {
    id: b.item.id,
    key: b.item.key,
    title: b.item.title,
    type: b.item.type,
    status: b.status,
    owner: owner?.name ?? null,
    ownerId: b.item.ownerId,
    priority: b.item.priority,
    dueAt: b.item.dueAt,
    customerFacing: b.item.customerFacing,
    score: { ...b.score },
    ring: b.ring,
    blocked: b.blocked,
    blockedReason: b.blockedReason,
    waitingOn: b.waitingOn,
    reasons: b.reasons,
    signals: b.signals.map((s) => ({ kind: s.kind, summary: s.summary })),
    lastActivityTs: b.lastActivityTs,
  };
}

export function toCompactBoard(board: BoardState, manager = "Marty"): CompactBoard {
  return {
    at: board.at,
    manager,
    items: board.items.map(toCompactItem),
    top: board.top.map((b) => b.item.id),
    attention: board.attention.map((b) => b.item.id),
    blocked: board.blocked.map((p) => ({ person: p.person.name, itemIds: p.items.map((i) => i.item.id), chain: p.chain })),
    happened: board.happened.map((h) => ({ ts: h.event.ts, itemId: h.item.id, label: h.label })),
  };
}

/** Meaningful events from the last `hours` before t, newest last, for /api/ask context. */
export function recentEvents(at: string, hours = 30, max = 80): RecentEvent[] {
  const t = Date.parse(at);
  const from = t - hours * 3_600_000;
  return events
    .filter((e) => {
      const ts = Date.parse(e.ts);
      return ts >= from && ts <= t && !NOISE.has(e.kind) && !!e.text;
    })
    .slice(-max)
    .map((e) => ({ ts: e.ts, itemId: e.itemId, actor: getPerson(e.actorId)?.name ?? e.actorId, text: e.text ?? "" }));
}
