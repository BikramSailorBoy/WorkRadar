"use client";
import { useEffect, useRef } from "react";
import type { BoardState } from "@/lib/types";
import { formatInManagerTz } from "@/lib/board";
import { eventsByItem, getItem, getPerson, items as ALL_ITEMS } from "@/lib/data";
import { KeyChip, ScoreBar, ScoreChip, SOURCE_META, SourceIcon, Sparkle } from "./ui";
import type { Decision } from "./triage-store";
import { decisionLabel } from "./triage-store";

const NOISE = new Set(["reaction", "ci_passed", "ci_failed", "bot"]);
const KIND_LABEL: Record<string, string> = {
  created: "created",
  status_changed: "status",
  comment: "comment",
  review_requested: "review requested",
  review_approved: "approved",
  changes_requested: "changes requested",
  commit: "commit",
  merged: "merged",
  deployed: "deployed",
  message: "message",
  email_received: "email in",
  email_sent: "email out",
  incident_opened: "incident opened",
  incident_update: "incident update",
  reaction: "reaction",
  ci_passed: "CI passed",
  ci_failed: "CI failed",
  bot: "bot",
};

interface Props {
  id: string;
  board: BoardState;
  aiReason?: string;
  decision?: Decision;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export function Drawer({ id, board, aiReason, decision, onClose, onSelect }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const item = getItem(id);
  const bi = board.items.find((b) => b.item.id === id);
  const t = Date.parse(board.at);

  useEffect(() => {
    closeRef.current?.focus();
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (!item) return null;
  const owner = getPerson(item.ownerId);
  const trail = (eventsByItem.get(id) ?? []).filter((e) => Date.parse(e.ts) <= t).slice().reverse();
  const linked = Array.from(new Set([...item.links, ...ALL_ITEMS.filter((o) => o.links.includes(id)).map((o) => o.id)])).filter((l) => l !== id && getItem(l));
  const visible = Date.parse(item.createdAt) <= t || trail.length > 0;
  const status = bi?.status ?? (visible ? lastStatus(id, t) ?? item.status : "not created yet");

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-[rgba(2,8,18,0.45)]" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-labelledby="drawer-title" className="sheet-in relative flex h-full w-full max-w-[520px] flex-col border-l border-holo/50 bg-[linear-gradient(180deg,#081c34,#040f1f)] shadow-[-20px_0_60px_-20px_rgba(63,208,255,0.25)]">
        <header className="border-b border-line px-5 pb-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13px]" style={{ color: SOURCE_META[item.source].color }}>
              <SourceIcon source={item.source} />
              <span className="font-mono">{item.key}</span>
              <span className="text-faint">in {SOURCE_META[item.source].label}{item.channel ? ` ${item.channel}` : ""}</span>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close details" className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-dim hover:text-fg">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
          <h2 id="drawer-title" className="mt-2 text-[19px] font-semibold leading-snug tracking-[-0.01em]">{item.title}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
            <Field k="Status" v={status} />
            <Field k="Owner" v={owner?.name ?? "Unowned"} />
            <Field k="Priority" v={item.priority ?? "None"} />
            <Field k="Due" v={item.dueAt ? formatInManagerTz(item.dueAt) : "No date"} mono={!!item.dueAt} />
          </dl>
          {decision && <p className="mt-3 text-[12.5px] text-ok">Triage: {decisionLabel(decision)} at {formatInManagerTz(decision.at)}</p>}
        </header>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
          {bi ? (
            <section aria-label="Why it ranks here">
              <div className="flex items-center justify-between">
                <h3 className="hud text-[11px] text-holo/90">Why it ranks here</h3>
                <ScoreChip value={bi.score.total} />
              </div>
              <div className="mt-3"><ScoreBar score={bi.score} showLabels /></div>
              {aiReason && (
                <p className="mt-4 flex gap-2 rounded-[2px] border border-holo/30 bg-holo/[0.06] px-3 py-2 text-[14px] leading-snug text-fg">
                  <Sparkle className="mt-[4px]" />
                  <span>{aiReason}</span>
                </p>
              )}
              <ul className="mt-3 space-y-1 text-[13.5px] text-dim">
                {bi.reasons.map((r) => (
                  <li key={r} className="flex gap-2"><span aria-hidden className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-faint" />{r}</li>
                ))}
              </ul>
              {bi.blocked && (
                <p className="mt-3 rounded-[2px] border border-dashed border-holo/60 px-3 py-2 text-[13px] text-holo">
                  Blocked{bi.blockedSinceTs ? ` since ${formatInManagerTz(bi.blockedSinceTs)}` : ""}: {bi.blockedReason ?? bi.waitingOn}
                </p>
              )}
              {bi.signals.length > 0 && (
                <div className="mt-4">
                  <h3 className="hud text-[11px] text-holo/90">Signals read from Slack and email</h3>
                  <ul className="mt-2 space-y-1.5">
                    {bi.signals.map((s, i) => (
                      <li key={i} className="text-[13px] leading-snug text-dim">
                        <span className="mr-1.5 rounded border border-line-strong px-1 py-[1px] font-mono text-[11px] text-faint">{s.kind.replace("_", " ")}</span>
                        {s.summary}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ) : (
            <p className="text-[13.5px] text-dim">{visible ? "Not on the board at this time: closed, or context with no open signal." : "This item does not exist yet at the replay time."}</p>
          )}

          {linked.length > 0 && (
            <section className="mt-5">
              <h3 className="hud text-[11px] text-holo/90">Linked</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">{linked.map((l) => <KeyChip key={l} id={l} onSelect={onSelect} />)}</div>
            </section>
          )}

          <section className="mt-5">
            <h3 className="hud text-[11px] text-holo/90">Trail <span className="font-normal text-faint">newest first, Cologne time</span></h3>
            {trail.length === 0 ? (
              <p className="mt-2 text-[13px] text-faint">No events yet.</p>
            ) : (
              <ol className="mt-2 border-l border-line">
                {trail.map((e) => {
                  const noise = NOISE.has(e.kind);
                  return (
                    <li key={e.id} className={`relative py-2 pl-4 ${noise ? "opacity-45" : ""}`}>
                      <span aria-hidden className="absolute left-[-3.5px] top-[14px] h-[6px] w-[6px] rounded-full" style={{ background: noise ? "var(--line-strong)" : SOURCE_META[item.source].color }} />
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                        <span className="font-mono text-dim">{formatInManagerTz(e.ts)}</span>
                        <span className="font-medium text-fg">{getPerson(e.actorId)?.name ?? e.actorId}</span>
                        <span className="text-faint">{KIND_LABEL[e.kind] ?? e.kind}{e.kind === "status_changed" && e.to ? ` to ${e.to}` : ""}{noise ? ", noise" : ""}</span>
                      </div>
                      {e.text && <p className="mt-0.5 text-[13.5px] leading-snug text-dim">{e.text}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-faint">{k}</dt>
      <dd className={`truncate text-fg ${mono ? "font-mono text-[12.5px]" : ""}`}>{v}</dd>
    </div>
  );
}

function lastStatus(id: string, t: number): string | null {
  const evs = (eventsByItem.get(id) ?? []).filter((e) => Date.parse(e.ts) <= t && (e.kind === "status_changed" || e.kind === "merged") && e.to);
  return evs.length ? evs[evs.length - 1].to! : null;
}
