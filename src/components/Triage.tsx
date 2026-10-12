"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardItem } from "@/lib/types";
import type { NudgeResponse } from "@/lib/api-types";
import { formatInManagerTz } from "@/lib/board";
import { getPerson, people } from "@/lib/data";
import { toCompactItem } from "@/lib/compact";
import { Avatar, Kbd, ScoreBar, ScoreChip, SOURCE_META, SourceIcon, Sparkle } from "./ui";
import { metaLine, postJson } from "./api";
import type { ActionKind, ItemActions } from "./actions-store";
import { SNOOZE_OPTIONS, act, actionLabel, primaryAction } from "./actions-store";

interface Props {
  queue: { b: BoardItem; why: "attention" | "blocked" }[];
  at: string;
  decisions: Record<string, ItemActions>;
  onClose: () => void;
  aiReasons: Record<string, string>;
}

type NudgeState = { status: "loading" } | { status: "ready"; text: string; meta: NudgeResponse } | { status: "error" };

export function Triage({ queue, at, decisions, onClose, aiReasons }: Props) {
  const firstOpen = Math.max(0, queue.findIndex((q) => !decisions[q.b.item.id]));
  const [idx, setIdx] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [delegating, setDelegating] = useState(false);
  const [nudges, setNudges] = useState<Record<string, NudgeState>>({});
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const done = idx >= queue.length;
  const cur = done ? null : queue[idx];
  const triaged = queue.filter((q) => decisions[q.b.item.id]).length;

  const team = useMemo(() => {
    if (!cur) return [];
    const t = Date.parse(at);
    return people.filter((p) => p.isTeam && p.id !== cur.b.item.ownerId && !(p.ooo && Date.parse(p.ooo.from) <= t && t <= Date.parse(p.ooo.to))).slice(0, 9);
  }, [cur, at]);

  const next = useCallback(() => {
    setDelegating(false);
    setCopied(false);
    setIdx((i) => Math.min(queue.length, i + 1));
  }, [queue.length]);
  const prev = useCallback(() => {
    setDelegating(false);
    setCopied(false);
    setIdx((i) => Math.max(0, i - 1));
  }, []);

  const decide = useCallback(
    (action: ActionKind, extra?: { to?: string }) => {
      if (!cur) return;
      act(cur.b.item.id, action, action === "snooze" ? { until: SNOOZE_OPTIONS[0].until } : extra);
      if (action !== "nudge") next();
    },
    [cur, next]
  );

  const nudge = useCallback(async () => {
    if (!cur) return;
    const id = cur.b.item.id;
    const owner = getPerson(cur.b.item.ownerId);
    setNudges((n) => ({ ...n, [id]: { status: "loading" } }));
    try {
      const r = await postJson<NudgeResponse>("/api/nudge", { item: toCompactItem(cur.b), ownerName: owner?.name ?? "team", managerName: "Marty" });
      setNudges((n) => ({ ...n, [id]: { status: "ready", text: r.message, meta: r } }));
      act(id, "nudge", { message: r.message });
    } catch {
      setNudges((n) => ({ ...n, [id]: { status: "error" } }));
    }
  }, [cur]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (delegating) setDelegating(false);
        else if (tag === "TEXTAREA") (e.target as HTMLElement).blur();
        else onClose();
        return;
      }
      if (tag === "TEXTAREA" || tag === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (delegating && /^[1-9]$/.test(k)) {
        const p = team[Number(k) - 1];
        if (p) decide("assign", { to: p.id });
        e.preventDefault();
        return;
      }
      if (k === "j" || e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); next(); }
      else if (k === "k" || e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); prev(); }
      else if (done) return;
      else if (k === "a") { e.preventDefault(); decide("ack"); }
      else if (k === "d") { e.preventDefault(); setDelegating((v) => !v); }
      else if (k === "s") { e.preventDefault(); decide("snooze"); }
      else if (k === "m") { e.preventDefault(); decide("done"); }
      else if (k === "n") { e.preventDefault(); void nudge(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [delegating, team, decide, next, prev, nudge, onClose, done]);

  const nd = cur ? nudges[cur.b.item.id] : undefined;
  const owner = cur ? getPerson(cur.b.item.ownerId) : undefined;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[rgba(2,8,18,0.86)] backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="triage-h" ref={dialogRef} tabIndex={-1}>
      <div className="mx-auto flex min-h-full max-w-[720px] flex-col px-4 py-6 sm:py-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="triage-h" className="hud text-[16px] text-fg glow-text">Triage</h2>
            <p className="text-[13px] text-dim">Attention items, then blocked work. One decision each.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[13px] text-dim" aria-live="polite">{triaged} of {queue.length} triaged</span>
            <button type="button" onClick={onClose} className="h-9 rounded-[2px] border border-line-strong px-3 text-[13px] text-fg hover:border-holo">Exit <span className="ml-1 text-faint">Esc</span></button>
          </div>
        </div>
        <div className="mt-4 flex gap-1" aria-hidden>
          {queue.map((q, i) => (
            <button key={q.b.item.id} tabIndex={-1} onClick={() => setIdx(i)} className={`h-1.5 flex-1 rounded-full ${decisions[q.b.item.id] ? "bg-ok" : i === idx ? "bg-holo shadow-[0_0_8px_var(--holo)]" : "bg-line-strong"}`} />
          ))}
        </div>

        {cur ? (
          <article key={cur.b.item.id} className="card-in frame brackets mt-6 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[13px]">
                <SourceIcon source={cur.b.item.source} />
                <span className="font-mono" style={{ color: SOURCE_META[cur.b.item.source].color }}>{cur.b.item.key}</span>
                <span className={`hud rounded-[2px] px-2 py-[2px] text-[10px] ${cur.why === "attention" ? "bg-signal/15 text-signal" : "border border-dashed border-holo/70 text-holo"}`}>
                  {cur.why === "attention" ? "Needs attention" : "Blocked"}
                </span>
              </div>
              <span className="font-mono text-[12px] text-faint">{idx + 1} / {queue.length}</span>
            </div>
            <h3 className="mt-3 text-[22px] font-semibold leading-tight tracking-[-0.01em]" style={{ textWrap: "balance" }}>{cur.b.item.title}</h3>
            <div className="mt-3 flex items-center gap-2.5 text-[13.5px] text-dim">
              {owner && <Avatar name={owner.name} id={owner.id} size={24} />}
              <span>{owner ? `${owner.name}, ${owner.location}` : "Unowned"}</span>
              <span className="text-faint">{cur.b.status}</span>
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto]">
              <ScoreBar score={cur.b.score} showLabels />
              <div className="flex items-start sm:justify-end"><ScoreChip value={cur.b.score.total} /></div>
            </div>

            <div className="mt-5 space-y-2">
              {aiReasons[cur.b.item.id] && (
                <p className="flex gap-2 text-[15px] leading-snug text-fg"><Sparkle className="mt-[5px]" />{aiReasons[cur.b.item.id]}</p>
              )}
              <p className="text-[13.5px] leading-snug text-dim">{cur.b.reasons.join("; ")}</p>
              {cur.b.signals.length > 0 && (
                <ul className="space-y-1 pt-1">
                  {cur.b.signals.map((s, i) => (
                    <li key={i} className="text-[13px] text-dim"><span className="mr-1.5 font-mono text-[11px] text-faint">{s.kind.replace("_", " ")}</span>{s.summary}</li>
                  ))}
                </ul>
              )}
              <p className="text-[12.5px] text-faint">Last activity {cur.b.lastActivityTs ? formatInManagerTz(cur.b.lastActivityTs) : "none"}</p>
            </div>

            {decisions[cur.b.item.id] && (
              <p className="mt-4 text-[13px] font-medium text-ok">{actionLabel(primaryAction(decisions[cur.b.item.id])!)}. Press J for the next card.</p>
            )}

            {delegating && (
              <div className="mt-5 rounded-[2px] border border-line-strong p-3">
                <p className="text-[12.5px] text-dim">Assign to. Press a number.</p>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {team.map((p, i) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => decide("assign", { to: p.id })} className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[13px] hover:bg-raised">
                        <Kbd>{i + 1}</Kbd>
                        <span className="text-fg">{p.name}</span>
                        <span className="truncate text-faint">{p.role}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {nd && (
              <div className="mt-5">
                {nd.status === "loading" && <div className="space-y-2"><div className="skeleton h-3.5 w-[90%]" /><div className="skeleton h-3.5 w-[70%]" /></div>}
                {nd.status === "error" && <p className="text-[13px] text-crit">The draft did not come back. Press N to try again.</p>}
                {nd.status === "ready" && (
                  <div>
                    <label htmlFor="nudge-text" className="flex items-center gap-1.5 text-[12.5px] text-dim"><Sparkle /> Drafted nudge to {owner?.name.split(" ")[0] ?? "owner"}, edit before sending</label>
                    <textarea
                      id="nudge-text"
                      defaultValue={nd.text}
                      rows={4}
                      className="mt-2 w-full resize-y rounded-[2px] border border-line-strong bg-ink/60 p-3 text-[14px] leading-relaxed text-fg focus:border-holo focus:outline-none"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] text-faint">{metaLine(nd.meta)}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          const v = (document.getElementById("nudge-text") as HTMLTextAreaElement | null)?.value ?? nd.text;
                          try {
                            await navigator.clipboard.writeText(v);
                            setCopied(true);
                          } catch {
                            setCopied(false);
                          }
                        }}
                        className="h-8 rounded-[2px] border border-line-strong px-3 text-[13px] text-fg hover:border-holo"
                      >
                        {copied ? "Copied" : "Copy message"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Action k="A" label="Acknowledge" onClick={() => decide("ack")} />
              <Action k="D" label="Assign" onClick={() => setDelegating((v) => !v)} active={delegating} />
              <Action k="M" label="Mark done" onClick={() => decide("done")} />
              <Action k="S" label="Snooze to tomorrow" onClick={() => decide("snooze")} />
              <Action k="N" label="Draft nudge" onClick={() => void nudge()} />
            </div>
            <div className="mt-4 flex items-center justify-between text-[12px] text-faint">
              <button type="button" onClick={prev} className="flex items-center gap-1.5 hover:text-fg"><Kbd>K</Kbd> Previous</button>
              <button type="button" onClick={next} className="flex items-center gap-1.5 hover:text-fg">Skip <Kbd>J</Kbd></button>
            </div>
          </article>
        ) : (
          <Finish queue={queue} decisions={decisions} onClose={onClose} onRestart={() => setIdx(0)} />
        )}
      </div>
    </div>
  );
}

function Action({ k, label, onClick, active }: { k: string; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex h-11 items-center justify-center gap-2 rounded-[2px] border text-[13.5px] font-medium transition-colors ${active ? "border-holo bg-holo/10 text-fg" : "border-line-strong text-fg hover:border-holo"}`}>
      <Kbd>{k}</Kbd>{label}
    </button>
  );
}

function Finish({ queue, decisions, onClose, onRestart }: { queue: Props["queue"]; decisions: Record<string, ItemActions>; onClose: () => void; onRestart: () => void }) {
  const decided = queue.filter((q) => primaryAction(decisions[q.b.item.id]));
  const open = queue.length - decided.length;
  const by = (a: ActionKind) => decided.filter((q) => decisions[q.b.item.id]?.[a]).length;
  return (
    <div className="card-in frame brackets mt-6 p-6">
      <h3 className="text-[22px] font-semibold">{open === 0 ? "Everything triaged." : `${decided.length} decided, ${open} left open.`}</h3>
      <p className="mt-1 text-[14px] text-dim">
        {by("ack")} acknowledged, {by("assign")} assigned, {by("done")} marked done, {by("snooze")} snoozed, {by("nudge")} nudged.
      </p>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {queue.map((q) => (
          <li key={q.b.item.id} className="flex items-center gap-3 py-2 text-[13.5px]">
            <SourceIcon source={q.b.item.source} />
            <span className="w-16 shrink-0 font-mono text-[12.5px] text-dim">{q.b.item.key}</span>
            <span className="min-w-0 flex-1 truncate text-fg">{q.b.item.title}</span>
            <span className={`shrink-0 text-[12.5px] ${decisions[q.b.item.id] ? "text-ok" : "text-faint"}`}>{primaryAction(decisions[q.b.item.id]) ? actionLabel(primaryAction(decisions[q.b.item.id])!) : "Open"}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onClose} className="hud h-10 rounded-[2px] bg-holo px-4 text-[12px] text-holo-ink">Back to radar</button>
        <button type="button" onClick={onRestart} className="h-10 rounded-[2px] border border-line-strong px-4 text-[14px] text-fg hover:border-holo">Review again</button>
      </div>
    </div>
  );
}
