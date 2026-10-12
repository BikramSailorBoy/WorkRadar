"use client";
import type { BoardItem, BoardState, HappenedEntry } from "@/lib/types";
import { formatInManagerTz } from "@/lib/board";
import { getItem, getPerson, items as ALL_ITEMS } from "@/lib/data";
import { Avatar, KeyChip, ScoreChip, SourceIcon, Sparkle, fmtDuration, hoursSince } from "./ui";
import type { Decision } from "./triage-store";
import { decisionLabel } from "./triage-store";

export interface ReasonText {
  text: string;
  ai: boolean;
}

export interface Common {
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  reasonFor: (b: BoardItem) => ReasonText;
  decisions: Record<string, Decision>;
}

function DecisionChip({ d }: { d?: Decision }) {
  if (!d) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-ok/40 bg-ok/10 px-1.5 py-[1px] text-[11px] font-medium text-ok whitespace-nowrap">
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden><path d="M1.5 5.3 4 7.6 8.6 2.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {decisionLabel(d)}
    </span>
  );
}

function Reason({ r }: { r: ReasonText }) {
  return (
    <p className="mt-1 flex gap-1.5 text-[13px] leading-snug text-dim">
      {r.ai && <Sparkle className="mt-[3px]" />}
      <span className="min-w-0">{r.text}</span>
    </p>
  );
}

function ItemRow({ b, rank, c, accent }: { b: BoardItem; rank?: number; c: Common; accent?: string }) {
  const id = b.item.id;
  const owner = getPerson(b.item.ownerId);
  const active = c.selectedId === id || c.hoverId === id;
  return (
    <li>
      <button
        type="button"
        onClick={() => c.onSelect(id)}
        onMouseEnter={() => c.onHover(id)}
        onMouseLeave={() => c.onHover(null)}
        onFocus={() => c.onHover(id)}
        onBlur={() => c.onHover(null)}
        className={`group relative flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-raised ${active ? "bg-raised" : ""}`}
      >
        {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-holo shadow-[0_0_8px_var(--holo)]" />}
        {rank !== undefined && <span className="w-4 shrink-0 pt-[3px] font-mono text-[13px] text-faint">{rank}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 sm:flex-nowrap">
            <SourceIcon source={b.item.source} />
            <span className="font-mono text-[12.5px] shrink-0" style={{ color: accent }}>{b.item.key}</span>
            <span className="min-w-0 text-[14px] font-medium leading-snug text-fg max-sm:basis-full sm:truncate">{b.item.title}</span>
          </div>
          <Reason r={c.reasonFor(b)} />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
            <span>{owner?.name ?? "Unowned"}</span>
            {b.item.priority && <span className="font-mono">{b.item.priority}</span>}
            <span>{b.status}</span>
            <DecisionChip d={c.decisions[id]} />
          </div>
        </div>
        <ScoreChip value={b.score.total} />
      </button>
    </li>
  );
}

export function AttentionList({ board, c }: { board: BoardState; c: Common }) {
  return (
    <>
      {board.attention.length ? (
        <ul className="divide-y divide-line">{board.attention.map((b) => <ItemRow key={b.item.id} b={b} c={c} />)}</ul>
      ) : (
        <Empty>Nothing needs you right now. Check Top work for what to push forward.</Empty>
      )}
    </>
  );
}

export function TopList({ board, c }: { board: BoardState; c: Common }) {
  return (
    <>
      {board.top.length ? (
        <ol className="divide-y divide-line">{board.top.map((b, i) => <ItemRow key={b.item.id} b={b} rank={i + 1} c={c} />)}</ol>
      ) : (
        <Empty>No open work is ranked yet at this point in the replay.</Empty>
      )}
    </>
  );
}

function ChainChip({ label, onSelect, last }: { label: string; onSelect: (id: string) => void; last: boolean }) {
  // a chain label is either an item key or a free-text root cause
  const keyMatch = label.match(/^([A-Z][A-Z0-9]*-\d+|PR #\d+)$/);
  if (keyMatch) {
    const item = findByKey(label);
    if (item) return <KeyChip id={item.id} onSelect={onSelect} size="xs" />;
  }
  return (
    <span className={`inline-flex items-center rounded-[2px] border border-dashed px-1.5 py-[3px] text-[11.5px] leading-none ${last ? "border-holo/70 text-fg" : "border-line-strong text-dim"}`}>
      {label}
    </span>
  );
}

const keyIndex = new Map<string, string>();
function findByKey(key: string) {
  if (!keyIndex.size) {
    // lazy index of display keys to ids
    for (const it of ALL_ITEMS) keyIndex.set(it.key, it.id);
  }
  const id = keyIndex.get(key);
  return id ? getItem(id) : undefined;
}

export function BlockedList({ board, c }: { board: BoardState; c: Common }) {
  const n = board.blocked.length;
  return (
    <>
      {n ? (
        <ul className="divide-y divide-line">
          {board.blocked.map((bp) => {
            const since = bp.items.map((i) => i.blockedSinceTs).filter((x): x is string => !!x).sort()[0];
            const holding = since ? fmtDuration(hoursSince(since, board.at)) : null;
            const active = bp.items.some((i) => i.item.id === c.selectedId || i.item.id === c.hoverId);
            return (
              <li key={bp.person.id} className={`relative px-4 py-3 ${active ? "bg-raised" : ""}`}>
                {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-holo shadow-[0_0_8px_var(--holo)]" />}
                <div className="flex items-start gap-3">
                  <Avatar name={bp.person.name} id={bp.person.id} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-[14px] font-medium text-fg">{bp.person.name}</span>
                      {holding && (
                        <span className="text-[12px] text-dim">
                          <span className="hud text-[10px] text-faint">Holding</span> <span className="font-mono text-signal">{holding}</span>
                          <span className="text-faint"> since {formatInManagerTz(since!)}</span>
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-faint">{bp.person.role}, {bp.person.location}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1" aria-label={`Blocker chain: ${bp.chain.join(" waits on ")}`}>
                      {bp.chain.map((l, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          {i > 0 && (
                            <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden className="text-faint">
                              <path d="M1 5h11M8.5 1.5 12 5 8.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          <ChainChip label={l} onSelect={c.onSelect} last={i === bp.chain.length - 1} />
                        </span>
                      ))}
                    </div>
                    <ul className="mt-2 space-y-1">
                      {bp.items.map((b) => (
                        <li key={b.item.id}>
                          <button
                            type="button"
                            onClick={() => c.onSelect(b.item.id)}
                            onMouseEnter={() => c.onHover(b.item.id)}
                            onMouseLeave={() => c.onHover(null)}
                            className="flex w-full min-w-0 items-start gap-2 rounded-[2px] px-1.5 py-1 -mx-1.5 text-left hover:bg-raised"
                          >
                            <SourceIcon source={b.item.source} className="mt-[2px]" />
                            <span className="min-w-0 flex-1">
                              <span className="font-mono text-[12px] text-dim">{b.item.key}</span>{" "}
                              <span className="text-[13px] text-fg">{b.item.title}</span>
                              <span className="flex gap-1.5 text-[12.5px] leading-snug text-faint">
                                {c.reasonFor(b).ai && <Sparkle className="mt-[3px]" />}
                                <span>{c.reasonFor(b).text}</span>
                              </span>
                            </span>
                            <DecisionChip d={c.decisions[b.item.id]} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>Nobody is blocked at this point.</Empty>
      )}
    </>
  );
}

const KIND_VERB: Record<string, string> = {
  merged: "Merged",
  deployed: "Deployed",
  status_changed: "Status",
  incident_opened: "Incident",
  email_received: "Escalation",
};

export function HappenedList({ board, c }: { board: BoardState; c: Common }) {
  const list: HappenedEntry[] = board.happened;
  return (
    <>
      {list.length ? (
        <ol className="relative py-1">
          <span aria-hidden className="absolute bottom-4 top-4 left-[78px] w-px bg-line" />
          {list.map((h) => {
            const actor = getPerson(h.event.actorId)?.name ?? h.event.actorId;
            const active = c.selectedId === h.item.id || c.hoverId === h.item.id;
            return (
              <li key={h.event.id}>
                <button
                  type="button"
                  onClick={() => c.onSelect(h.item.id)}
                  onMouseEnter={() => c.onHover(h.item.id)}
                  onMouseLeave={() => c.onHover(null)}
                  className={`relative flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-raised ${active ? "bg-raised" : ""}`}
                >
                  <span className="w-[46px] shrink-0 pt-[1px] font-mono text-[12px] text-dim">{formatInManagerTz(h.event.ts).slice(4)}</span>
                  <span className="relative z-10 mt-[3px] flex h-[14px] w-[14px] items-center justify-center rounded-full bg-panel-solid">
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: `var(--${h.item.source})` }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] text-fg">{h.label}</span>
                    <span className="block truncate text-[12px] text-faint">
                      {KIND_VERB[h.event.kind] ?? "Update"} by {actor}. {h.item.title}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <Empty>Quiet so far today. Nothing merged, shipped, opened or escalated since 08:00 team time.</Empty>
      )}
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-[13px] text-faint">{children}</p>;
}
