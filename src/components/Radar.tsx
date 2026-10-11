"use client";
import { memo, useMemo, useState } from "react";
import type { BoardItem, Source } from "@/lib/types";
import { getPerson } from "@/lib/data";
import { SOURCE_META, SOURCE_ORDER, SourceGlyph } from "./ui";

const SIZE = 600;
const C = SIZE / 2;
const R = 238;
const BANDS = { now: [0, 0.36], today: [0.36, 0.68], watch: [0.68, 1] } as const;
// quadrant start angle, clockwise from 12 o'clock
const QUAD: Record<Source, number> = { jira: 0, github: 90, slack: 180, email: 270 };
const PAD = 7; // degrees kept clear at quadrant edges

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function radiusFor(b: BoardItem): number {
  const s = b.score.total;
  // higher score sits closer to the centre within its ring band
  if (b.ring === "now") return R * (0.34 - (Math.min(100, Math.max(75, s)) - 75) / 25 * 0.24);
  if (b.ring === "today") return R * (0.655 - (Math.min(74, Math.max(50, s)) - 50) / 24 * 0.25);
  return R * (0.965 - Math.min(49, Math.max(0, s)) / 49 * 0.24);
}
const blipR = (b: BoardItem) => 4.5 + (b.score.impact / 25) * 6;

interface Placed {
  b: BoardItem;
  x: number;
  y: number;
  r: number;
  rad: number;
  ang: number;
}

/** Deterministic placement: angle from a hash of the id, then a few relaxation passes to stop overlaps. */
function place(items: BoardItem[]): Placed[] {
  const out: Placed[] = [];
  for (const src of SOURCE_ORDER) {
    const group = items.filter((b) => b.item.source === src);
    const lo = QUAD[src] + PAD;
    const hi = QUAD[src] + 90 - PAD;
    const ps = group.map((b) => ({ b, rad: radiusFor(b), r: blipR(b), ang: lo + hash(b.item.id) * (hi - lo) }));
    for (let iter = 0; iter < 60; iter++) {
      let moved = false;
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], c = ps[j];
          const ax = Math.sin((a.ang * Math.PI) / 180) * a.rad, ay = Math.cos((a.ang * Math.PI) / 180) * a.rad;
          const cx = Math.sin((c.ang * Math.PI) / 180) * c.rad, cy = Math.cos((c.ang * Math.PI) / 180) * c.rad;
          const d = Math.hypot(ax - cx, ay - cy);
          const need = a.r + c.r + 7;
          if (d < need) {
            const meanR = (a.rad + c.rad) / 2;
            const push = (((need - d) / meanR) * 180) / Math.PI / 2 + 0.2;
            const dir = a.ang <= c.ang ? -1 : 1;
            a.ang = Math.min(hi, Math.max(lo, a.ang + dir * push));
            c.ang = Math.min(hi, Math.max(lo, c.ang - dir * push));
            moved = true;
          }
        }
      if (!moved) break;
    }
    for (const p of ps) {
      const th = (p.ang * Math.PI) / 180;
      out.push({ ...p, x: C + Math.sin(th) * p.rad, y: C - Math.cos(th) * p.rad });
    }
  }
  return out;
}

export interface RadarProps {
  items: BoardItem[];
  attentionIds: Set<string>;
  selectedId: string | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  topReason: (b: BoardItem) => string;
  replaying: boolean;
}

function RadarImpl({ items, attentionIds, selectedId, hoverId, onHover, onSelect, topReason, replaying }: RadarProps) {
  const placed = useMemo(() => place(items), [items]);
  const ordered = useMemo(() => [...placed].sort((a, b) => b.b.score.total - a.b.score.total), [placed]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const tipId = hoverId ?? focusId;
  const tip = tipId ? placed.find((p) => p.b.item.id === tipId) : undefined;
  const counts = useMemo(() => {
    const m: Record<Source, number> = { jira: 0, github: 0, slack: 0, email: 0 };
    for (const b of items) m[b.item.source]++;
    return m;
  }, [items]);

  const corner: Record<Source, { x: number; y: number; anchor: "start" | "end" }> = {
    jira: { x: SIZE - 14, y: 26, anchor: "end" },
    github: { x: SIZE - 14, y: SIZE - 14, anchor: "end" },
    slack: { x: 14, y: SIZE - 14, anchor: "start" },
    email: { x: 14, y: 26, anchor: "start" },
  };

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[600px] select-none">
      {/* sweep: a rotating conic wedge behind the scope */}
      <div aria-hidden className="pointer-events-none absolute rounded-full" style={{ inset: `${((C - R) / SIZE) * 100}%` }}>
        <div className="radar-sweep absolute inset-0 rounded-full" style={{ opacity: replaying ? 0.35 : 1 }} />
      </div>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={`relative block h-full w-full overflow-visible ${replaying ? "blip-anim" : ""}`} role="group" aria-label={`Radar of ${items.length} open items. Inner ring: act now. Middle: today. Outer: watch.`}>
        <defs>
          <radialGradient id="scope" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.07" />
            <stop offset="55%" stopColor="var(--panel)" stopOpacity="0.0" />
            <stop offset="100%" stopColor="var(--panel)" stopOpacity="0.0" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={R} fill="url(#scope)" />
        {/* ring bands */}
        <circle cx={C} cy={C} r={R * BANDS.now[1]} fill="color-mix(in oklab, var(--crit) 6%, transparent)" stroke="color-mix(in oklab, var(--crit) 45%, var(--line-strong))" strokeWidth="1" />
        <circle cx={C} cy={C} r={R * BANDS.today[1]} fill="none" stroke="var(--line-strong)" strokeWidth="1" />
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line-strong)" strokeWidth="1.2" />
        {[0.18, 0.52, 0.84].map((f) => (
          <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="var(--line)" strokeWidth="0.8" strokeDasharray="1 5" />
        ))}
        {/* quadrant axes */}
        <line x1={C} y1={C - R - 8} x2={C} y2={C + R + 8} stroke="var(--line-strong)" strokeWidth="1" />
        <line x1={C - R - 8} y1={C} x2={C + R + 8} y2={C} stroke="var(--line-strong)" strokeWidth="1" />
        {/* degree ticks on the rim */}
        {Array.from({ length: 72 }, (_, i) => {
          const th = (i * 5 * Math.PI) / 180;
          const len = i % 6 === 0 ? 7 : 3;
          return <line key={i} x1={C + Math.sin(th) * R} y1={C - Math.cos(th) * R} x2={C + Math.sin(th) * (R + len)} y2={C - Math.cos(th) * (R + len)} stroke="var(--line-strong)" strokeWidth="1" />;
        })}
        {/* ring labels along the 9 o'clock axis, just inside each ring edge */}
        {[
          { t: "Act now", e: BANDS.now[1], c: "var(--crit)" },
          { t: "Today", e: BANDS.today[1], c: "var(--signal)" },
          { t: "Watch", e: 1, c: "var(--dim)" },
        ].map((l) => (
          <text className="radar-ring" key={l.t} x={C - R * l.e + 6} y={C - 6} fontSize="11.5" fontWeight={600} fill={l.c} paintOrder="stroke" stroke="var(--panel)" strokeWidth="4" strokeLinejoin="round" style={{ letterSpacing: "0.01em" }}>{l.t}</text>
        ))}
        {/* source labels in the four corners */}
        {SOURCE_ORDER.map((s) => {
          const k = corner[s];
          const iconX = k.anchor === "end" ? k.x - 16 : k.x;
          const textX = k.anchor === "end" ? k.x - 22 : k.x + 22;
          return (
            <g key={s} style={{ color: SOURCE_META[s].color }}>
              <g transform={`translate(${iconX} ${k.y - 13})`}>
                <SourceGlyph source={s} />
              </g>
              <text className="radar-src" x={textX} y={k.y - 1} textAnchor={k.anchor} fontSize="14" fontWeight={600} fill="currentColor">
                {SOURCE_META[s].label}
                <tspan fill="var(--faint)" fontWeight={500} dx="6" fontFamily="var(--font-mono)" fontSize="12.5">{counts[s]}</tspan>
              </text>
            </g>
          );
        })}

        {/* blips, in score order so Tab walks from hottest to coolest */}
        {ordered.map((p) => {
          const { b } = p;
          const id = b.item.id;
          const color = SOURCE_META[b.item.source].color;
          const attn = attentionIds.has(id);
          const sel = id === selectedId;
          const hot = id === hoverId;
          const showLabel = b.ring !== "watch" || sel || hot;
          const owner = getPerson(b.item.ownerId)?.name ?? "unowned";
          const labelRight = p.x >= C;
          return (
            <g
              key={id}
              className="blip cursor-pointer"
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
              tabIndex={0}
              role="button"
              aria-label={`${b.item.key}, ${b.item.title}. Score ${b.score.total}. ${b.blocked ? "Blocked. " : ""}${attn ? "Needs attention. " : ""}Owner ${owner}.`}
              aria-pressed={sel}
              onMouseEnter={() => onHover(id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => setFocusId(id)}
              onBlur={() => setFocusId((f) => (f === id ? null : f))}
              onClick={() => onSelect(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(id);
                }
              }}
            >
              <circle r={p.r + 10} fill="transparent" />
              {b.changedRecently && !replaying && <circle className="blip-pulse" r={p.r} fill="none" stroke={color} strokeWidth="1.5" style={{ ["--r0" as string]: `${p.r}px` }} />}
              {attn && <circle r={p.r + 4.5} fill="none" stroke="var(--crit)" strokeOpacity="0.75" strokeWidth="1.2" />}
              {(sel || hot) && <circle r={p.r + 8} fill="none" stroke="var(--signal)" strokeWidth="1.6" />}
              <circle className="blip-focus" r={p.r + 8} fill="none" stroke="var(--signal)" strokeWidth="2" opacity="0" />
              {b.blocked ? (
                <circle r={p.r} fill="var(--panel)" stroke={color} strokeWidth="2" strokeDasharray="3 2.4" />
              ) : (
                <circle r={p.r} fill={color} stroke="var(--panel)" strokeWidth="1.5" />
              )}
              {showLabel && (
                <text
                  className="radar-key"
                  x={labelRight ? p.r + 6 : -(p.r + 6)}
                  y={4}
                  textAnchor={labelRight ? "start" : "end"}
                  fontSize="12"
                  fontFamily="var(--font-mono)"
                  fontWeight={500}
                  fill={sel || hot ? "var(--fg)" : "var(--dim)"}
                  paintOrder="stroke"
                  stroke="var(--ink)"
                  strokeWidth="3.5"
                  strokeLinejoin="round"
                >
                  {b.item.key}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 w-64 rounded-lg border border-line-strong bg-raised/95 px-3 py-2.5 text-[12.5px] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)] backdrop-blur"
          style={{
            left: `${(tip.x / SIZE) * 100}%`,
            top: `${(tip.y / SIZE) * 100}%`,
            transform: `translate(${tip.x > C ? "calc(-100% - 16px)" : "16px"}, ${tip.y > C ? "calc(-100% + 8px)" : "-8px"})`,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[12px]" style={{ color: SOURCE_META[tip.b.item.source].color }}>{tip.b.item.key}</span>
            <span className="font-mono text-[12px] text-fg">{tip.b.score.total}<span className="text-faint">/100</span></span>
          </div>
          <div className="mt-1 font-medium leading-snug text-fg">{tip.b.item.title}</div>
          <div className="mt-1 text-dim">{getPerson(tip.b.item.ownerId)?.name ?? "Unowned"}{tip.b.blocked ? " · blocked" : ""}</div>
          <div className="mt-1.5 border-t border-line pt-1.5 leading-snug text-dim">{topReason(tip.b)}</div>
        </div>
      )}
    </div>
  );
}

export const Radar = memo(RadarImpl);

export function RadarLegend() {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-dim" aria-label="Radar legend">
      <li className="flex items-center gap-1.5">
        <svg width="18" height="14" aria-hidden><circle cx="5" cy="7" r="3" fill="var(--dim)" /><circle cx="13" cy="7" r="5" fill="var(--dim)" /></svg>
        Size is impact
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5" fill="none" stroke="var(--dim)" strokeWidth="1.6" strokeDasharray="2.6 2" /></svg>
        Hollow and dashed is blocked
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="16" height="16" aria-hidden><circle cx="8" cy="8" r="3.5" fill="var(--dim)" /><circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--crit)" strokeWidth="1.2" /></svg>
        Outer ring needs attention
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="16" height="16" aria-hidden><circle cx="8" cy="8" r="3.5" fill="var(--dim)" /><circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--dim)" strokeOpacity="0.5" strokeWidth="1" /></svg>
        Pulse is new activity in the last hour
      </li>
    </ul>
  );
}
