"use client";
import { useState } from "react";
import type { BoardItem, Source } from "@/lib/types";
import { formatInManagerTz } from "@/lib/board";
import { getPerson } from "@/lib/data";
import { ContactShape, SOURCE_META, SOURCE_ORDER, ScoreChip, Sparkle } from "./ui";
import type { ReasonText } from "./Panels";
import { SNOOZE_OPTIONS, act, useActions } from "./actions-store";
import { Menu, assignees } from "./ActionBar";

type Ring = "all" | "now" | "today" | "watch" | "blocked" | "snoozed";

interface Props {
  items: BoardItem[]; // open, visible, ranked by score
  snoozed: BoardItem[];
  attentionIds: Set<string>;
  reasonFor: (b: BoardItem) => ReasonText;
  onOpen: (id: string) => void; // detail page
  onHover: (id: string | null) => void;
  hoverId: string | null;
  live: boolean;
}

export function PriorityFeed({ items, snoozed, attentionIds, reasonFor, onOpen, onHover, hoverId, live }: Props) {
  const [ring, setRing] = useState<Ring>("all");
  const [sources, setSources] = useState<Set<Source>>(new Set());
  const s = useActions();

  const base = ring === "snoozed" ? snoozed : items;
  const list = base.filter((b) => {
    if (sources.size && !sources.has(b.item.source)) return false;
    if (ring === "now" || ring === "today" || ring === "watch") return b.ring === ring;
    if (ring === "blocked") return b.blocked;
    return true;
  });
  const count = (r: Ring) => (r === "snoozed" ? snoozed.length : r === "all" ? items.length : r === "blocked" ? items.filter((b) => b.blocked).length : items.filter((b) => b.ring === r).length);
  const chips: { id: Ring; label: string }[] = [
    { id: "all", label: "All" },
    { id: "now", label: "Act now" },
    { id: "today", label: "Today" },
    { id: "watch", label: "Watch" },
    { id: "blocked", label: "Blocked" },
    { id: "snoozed", label: "Snoozed" },
  ];

  return (
    <div>
      <div className="sticky top-0 z-10 space-y-2 border-b border-line bg-[#071a31]/95 px-4 py-2.5 backdrop-blur">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter by ring">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={ring === c.id}
              onClick={() => setRing(c.id)}
              className={`hud flex h-7 items-center gap-1.5 rounded-[2px] border px-2 text-[10px] ${ring === c.id ? "border-holo bg-holo/15 text-fg" : "border-line-strong text-dim hover:border-holo"}`}
            >
              {c.label}
              <span className={`font-mono text-[11px] ${c.id === "now" ? "text-signal" : "text-holo"}`}>{count(c.id)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by source">
          {SOURCE_ORDER.map((src) => {
            const on = sources.has(src);
            return (
              <button
                key={src}
                type="button"
                aria-pressed={on}
                onClick={() => setSources((prev) => { const n = new Set(prev); if (n.has(src)) n.delete(src); else n.add(src); return n; })}
                className={`flex h-6 items-center gap-1.5 rounded-[2px] border px-1.5 text-[11.5px] ${on ? "border-holo text-fg" : "border-line text-dim hover:border-line-strong"}`}
              >
                <svg width="10" height="10" viewBox="-6 -6 12 12" aria-hidden><circle r="4" fill={SOURCE_META[src].color} /></svg>
                {SOURCE_META[src].label}
              </button>
            );
          })}
          <span className="ml-auto text-[11px] text-faint">Row keys: Enter open · A assign · M done · S snooze</span>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-faint">{ring === "snoozed" ? "Nothing is snoozed." : "No items match these filters."}</p>
      ) : (
        <ol className="divide-y divide-line" aria-label="Priority feed">
          {list.map((b) => (
            <FeedRow
              key={b.item.id}
              b={b}
              rank={ring === "snoozed" ? undefined : items.indexOf(b) + 1}
              attn={attentionIds.has(b.item.id)}
              reason={reasonFor(b)}
              assigned={!!s.items[b.item.id]?.assign}
              snoozedUntil={s.items[b.item.id]?.snooze?.until}
              onOpen={onOpen}
              onHover={onHover}
              hot={hoverId === b.item.id}
              live={live}
            />
          ))}
        </ol>
      )}
      {!live && <p className="px-4 py-3 text-[12px] text-faint">Replaying history: actions are available at Now.</p>}
    </div>
  );
}

function FeedRow({ b, rank, attn, reason, assigned, snoozedUntil, onOpen, onHover, hot, live }: { b: BoardItem; rank?: number; attn: boolean; reason: ReasonText; assigned: boolean; snoozedUntil?: string; onOpen: (id: string) => void; onHover: (id: string | null) => void; hot: boolean; live: boolean }) {
  const [menu, setMenu] = useState<"assign" | "snooze" | null>(null);
  const id = b.item.id;
  const owner = getPerson(b.item.ownerId);
  const color = b.item.priority === "P0" ? "var(--crit)" : SOURCE_META[b.item.source].color;
  const qa = "hud h-7 rounded-[2px] border px-2 text-[10px] transition-colors";
  return (
    <li className={`group relative ${hot ? "bg-raised" : ""} ${snoozedUntil ? "opacity-60" : ""}`} onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)}>
      <button
        type="button"
        onClick={() => onOpen(id)}
        onKeyDown={(e) => {
          if (!live || e.metaKey || e.ctrlKey || e.altKey) return;
          const k = e.key.toLowerCase();
          if (k === "a") { e.preventDefault(); setMenu("assign"); }
          else if (k === "m") { e.preventDefault(); act(id, "done"); }
          else if (k === "s") { e.preventDefault(); setMenu("snooze"); }
        }}
        aria-label={`${rank ? `Rank ${rank}. ` : ""}${b.item.key}, ${b.item.title}. Score ${b.score.total}. Owner ${owner?.name ?? "unowned"}.${b.blocked ? " Blocked." : ""}${attn ? " Needs attention." : ""} Press Enter to open, A to assign, M to mark done, S to snooze.`}
        className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-raised focus-visible:bg-raised"
      >
        <span className="w-5 shrink-0 pt-[2px] text-right font-mono text-[12px] text-faint">{rank ?? "–"}</span>
        <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden className="mt-[3px] shrink-0">
          <ContactShape type={b.item.type} r={4.6} fill={b.blocked ? "none" : color} stroke={color} strokeWidth={b.blocked ? 1.4 : 0} strokeDasharray={b.blocked ? "2 1.6" : undefined} />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-[12.5px]" style={{ color }}>{b.item.key}</span>
            <span className="truncate text-[13.5px] font-medium text-fg">{b.item.title}</span>
          </span>
          <span className="mt-0.5 flex gap-1.5 text-[12.5px] leading-snug text-dim">
            {reason.ai && <Sparkle className="mt-[3px]" />}
            <span className="line-clamp-2">{reason.text}</span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-faint">
            <span className="text-dim">{owner?.name ?? "Unowned"}</span>
            {assigned && <span className="rounded-[2px] border border-holo/40 px-1 text-[10.5px] text-holo">Assigned by you</span>}
            {attn && <span className="hud text-[9.5px] text-signal">Attention</span>}
            {b.blocked && <span className="hud rounded-[2px] border border-dashed border-holo/60 px-1 text-[9.5px] text-holo">Blocked</span>}
            {snoozedUntil && <span className="text-dim">Wakes {formatInManagerTz(snoozedUntil)}</span>}
          </span>
        </span>
        <ScoreChip value={b.score.total} />
      </button>
      {live && (
        <div className="absolute right-14 top-2 hidden items-center gap-1 bg-[#071a31] pl-2 group-hover:flex group-focus-within:flex">
          <div className="relative">
            <button type="button" aria-haspopup="menu" onClick={() => setMenu(menu === "assign" ? null : "assign")} className={`${qa} border-holo/60 text-holo hover:border-holo`}>Assign</button>
            {menu === "assign" && <div className="absolute right-0"><Menu label={`Assign ${b.item.key} to`} items={assignees(b.item.ownerId).map((p) => ({ id: p.id, label: p.name, hint: p.role }))} onPick={(to) => act(id, "assign", { to })} onClose={() => setMenu(null)} /></div>}
          </div>
          <button type="button" onClick={() => act(id, "done")} className={`${qa} border-ok/60 text-ok hover:border-ok`}>Done</button>
          <div className="relative">
            <button type="button" aria-haspopup="menu" onClick={() => setMenu(menu === "snooze" ? null : "snooze")} className={`${qa} border-line-strong text-fg hover:border-holo`}>Snooze</button>
            {menu === "snooze" && <div className="absolute right-0"><Menu label={`Snooze ${b.item.key}`} items={SNOOZE_OPTIONS.map((o) => ({ id: o.id, label: o.label }))} onPick={(o) => act(id, "snooze", { until: SNOOZE_OPTIONS.find((x) => x.id === o)!.until })} onClose={() => setMenu(null)} /></div>}
          </div>
        </div>
      )}
    </li>
  );
}
