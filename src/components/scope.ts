// Radar geometry shared by the SVG layer (contacts, rings) and the canvas layer (sweep, phosphor, clutter, trails).
import type { BoardItem, Source } from "@/lib/types";
import { WEEK_START } from "@/lib/types";
import { events, extractedCache, itemById } from "@/lib/data";

export const SIZE = 640;
export const C = SIZE / 2;
export const R = 262;
export const BANDS = { now: 0.36, today: 0.68 } as const;
/** Sector start bearing, clockwise from north. */
export const QUAD: Record<Source, number> = { jira: 0, github: 90, slack: 180, email: 270 };
const PAD = 7;

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Same score-to-radius mapping as before: higher score sits closer to the centre inside its ring band. */
export function radiusFor(b: BoardItem): number {
  const s = b.score.total;
  if (b.ring === "now") return R * (0.34 - ((Math.min(100, Math.max(75, s)) - 75) / 25) * 0.24);
  if (b.ring === "today") return R * (0.655 - ((Math.min(74, Math.max(50, s)) - 50) / 24) * 0.25);
  return R * (0.965 - (Math.min(49, Math.max(0, s)) / 49) * 0.24);
}
export const contactR = (b: BoardItem) => 5 + (b.score.impact / 25) * 6;

export interface Placed {
  b: BoardItem;
  x: number;
  y: number;
  r: number;
  rad: number;
  ang: number; // bearing in degrees
}

export const toXY = (bearing: number, rad: number) => {
  const th = (bearing * Math.PI) / 180;
  return { x: C + Math.sin(th) * rad, y: C - Math.cos(th) * rad };
};

/** Deterministic placement: bearing from a hash of the id, then relaxation so contacts never overlap. */
export function place(items: BoardItem[]): Placed[] {
  const out: Placed[] = [];
  for (const src of Object.keys(QUAD) as Source[]) {
    const lo = QUAD[src] + PAD;
    const hi = QUAD[src] + 90 - PAD;
    const ps = items.filter((b) => b.item.source === src).map((b) => ({ b, rad: radiusFor(b), r: contactR(b), ang: lo + hash(b.item.id) * (hi - lo) }));
    for (let iter = 0; iter < 60; iter++) {
      let moved = false;
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], c = ps[j];
          const pa = toXY(a.ang, a.rad), pc = toXY(c.ang, c.rad);
          const d = Math.hypot(pa.x - pc.x, pa.y - pc.y);
          const need = a.r + c.r + 9;
          if (d < need) {
            const push = (((need - d) / ((a.rad + c.rad) / 2)) * 180) / Math.PI / 2 + 0.2;
            const dir = a.ang <= c.ang ? -1 : 1;
            a.ang = Math.min(hi, Math.max(lo, a.ang + dir * push));
            c.ang = Math.min(hi, Math.max(lo, c.ang - dir * push));
            moved = true;
          }
        }
      if (!moved) break;
    }
    for (const p of ps) out.push({ ...p, ...toXY(p.ang, p.rad) });
  }
  return out;
}

// ---------------------------------------------------------------- clutter
// Mirrors board.ts's notion of "not meaningful": bot, CI and reaction events, plus chatter in Slack threads and
// emails that carry no blocker, escalation or decision signal at time t. These never reach the board.

const NOISE_KINDS = new Set(["reaction", "ci_passed", "ci_failed", "bot"]);
const BEARING_KINDS = new Set(["escalation", "decision_request", "blocker"]);
const LO = Date.parse(WEEK_START);

export interface Speck {
  x: number;
  y: number;
  ts: number;
}

const clutterCache = new Map<number, { specks: Speck[]; count: number; kinds: { bots: number; ci: number; reactions: number; chatter: number } }>();

export function clutterAt(t: number) {
  const key = Math.floor(t / 300_000);
  const hit = clutterCache.get(key);
  if (hit) return hit;
  const bearing = new Set<string>();
  for (const s of extractedCache) if (Date.parse(s.evidenceTs) <= t && BEARING_KINDS.has(s.kind)) for (const id of s.itemIds) bearing.add(id);
  const specks: Speck[] = [];
  const kinds = { bots: 0, ci: 0, reactions: 0, chatter: 0 };
  for (const e of events) {
    const ts = Date.parse(e.ts);
    if (ts < LO || ts > t) continue;
    const item = itemById.get(e.itemId);
    if (!item) continue;
    const ctx = item.type === "thread" || item.type === "email";
    let noise = false;
    if (NOISE_KINDS.has(e.kind)) {
      noise = true;
      if (e.kind === "bot") kinds.bots++;
      else if (e.kind === "reaction") kinds.reactions++;
      else kinds.ci++;
    } else if (ctx && !bearing.has(item.id)) {
      noise = true;
      kinds.chatter++;
    }
    if (!noise) continue;
    // scatter inside the item's source sector, mostly in the outer bands, like sea clutter
    const a = QUAD[item.source] + 4 + hash(e.id) * 82;
    const rad = R * (0.42 + Math.sqrt(hash(e.id + "r")) * 0.56);
    specks.push({ ...toXY(a, rad), ts });
  }
  const res = { specks, count: specks.length, kinds };
  if (clutterCache.size > 600) clutterCache.clear();
  clutterCache.set(key, res);
  return res;
}
