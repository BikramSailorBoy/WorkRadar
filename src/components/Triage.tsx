"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardItem } from "@/lib/types";
import type { NudgeResponse } from "@/lib/api-types";
import { formatInManagerTz } from "@/lib/board";
import { getPerson, people } from "@/lib/data";
import { toCompactItem } from "@/lib/compact";
import { Avatar, Kbd, ScoreBar, ScoreChip, SOURCE_META, SourceIcon, Sparkle } from "./ui";
import { metaLine, postJson } from "./api";
import type { Decision, DecisionAction } from "./triage-store";
import { decisionLabel } from "./triage-store";

interface Props {
  queue: { b: BoardItem; why: "attention" | "blocked" }[];
  at: string;
  decisions: Record<string, Decision>;
  onDecide: (id: string, d: Decision) => void;
  onClose: () => void;
  aiReasons: Record<string, string>;
}

type NudgeState = { status: "loading" } | { status: "ready"; text: string; meta: NudgeResponse } | { status: "error" };

export function Triage({ queue, at, decisions, onDecide, onClose, aiReasons }: Props) {
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
    (action: DecisionAction, extra?: Partial<Decision>) => {
      if (!cur) return;
      onDecide(cur.b.item.id, { action, at, ...extra });
      if (action !== "nudge") next();
    },
    [cur, at, onDecide, next]
  );

  const nudge = useCallback(async () => {
    if (!cur) return;
    const id = cur.b.item.id;
    const owner = getPerson(cur.b.item.ownerId);
    setNudges((n) => ({ ...n, [id]: { status: "loading" } }));
    try {
      const r = await postJson<NudgeResponse>("/api/nudge", { item: toCompactItem(cur.b), ownerName: owner?.name ?? "team", managerName: "Marty" });
      setNudges((n) => ({ ...n, [id]: { status: "ready", text: r.message, meta: r } }));
      onDecide(id, { action: "nudge", at, message: r.message });
    } catch {
      setNudges((n) => ({ ...n, [id]: { status: "error" } }));
    }
  }, [cur, at, onDecide]);

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
        if (p) decide("delegate", { to: p.id });
        e.preventDefault();
        return;
      }
      if (k === "j" || e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); next(); }
      else if (k === "k" || e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); prev(); }
      else if (done) return;
      else if (k === "a") { e.preventDefault(); decide("ack"); }
      else if (k === "d") { e.preventDefault(); setDelegating((v) => !v); }
      else if (k === "s") { e.preventDefault(); decide("snooze"); }
      else if (k === "n") { e.preventDefault(); void nudge(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [delegating, team, decide, next, prev, nudge, onClose, done]);

  const nd = cur ? nudges[cur.b.item.id] : undefined;
  const owner = cur ? getPerson(cur.b.item.ownerId) : undefined;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/85 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="triage-h" ref={dialogRef} tabIndex={-1}>
      <div className="mx-auto flex min-h-full max-w-[720px] flex-col px-4 py-6 sm:py-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="triage-h" className="text-[18px] font-semibold">Triage</h2>
            <p className="text-[13px] text-dim">Attention items, then blocked work. One decision each.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[13px] text-dim" aria-live="polite">{triaged} of {queue.length} triaged</span>
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-line-strong px-3 text-[13px] text-fg hover:border-signal">Exit <span className="ml-1 text-faint">Esc</span></button>
          </div>
        </div>
        <div className="mt-4 flex gap-1" aria-hidden>
          {queue.map((q, i) => (
            <button key={q.b.item.id} tabIndex={-1} onClick={() => setIdx(i)} className={`h-1.5 flex-1 rounded-full ${decisions[q.b.item.id] ? "bg-ok" : i === idx ? "bg-signal" : "bg-line-strong"}`} />
          ))}
        </div>

        {cur ? (
          <article key={cur.b.item.id} className="card-in mt-6 rounded-2xl border border-line-strong bg-panel p-5 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.8)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[13px]">
                <SourceIcon source={cur.b.item.source} />
                <span className="font-mono" style={{ color: SOURCE_META[cur.b.item.source].color }}>{cur.b.item.key}</span>
                <span className={`rounded-full px-2 py-[1px] text-[11.5px] font-medium ${cur.why === "attention" ? "bg-crit/15 text-crit" : "border border-dashed border-crit/60 text-crit"}`}>
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
              <p className="mt-4 text-[13px] font-medium text-ok">{decisionLabel(decisions[cur.b.item.id])}. Press J for the next card.</p>
            )}

            {delegating && (
              <div className="mt-5 rounded-xl border border-line-strong p-3">
                <p className="text-[12.5px] text-dim">Delegate to. Press a number.</p>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {team.map((p, i) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => decide("delegate", { to: p.id })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-raised">
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
                      className="mt-2 w-full resize-y rounded-lg border border-line-strong bg-ink/60 p-3 text-[14px] leading-relaxed text-fg focus:border-signal focus:outline-none"
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
                        className="h-8 rounded-lg border border-line-strong px-3 text-[13px] text-fg hover:border-signal"
                      >
                        {copied ? "Copied" : "Copy message"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Action k="A" label="Acknowledge" onClick={() => decide("ack")} />
              <Action k="D" label="Delegate" onClick={() => setDelegating((v) => !v)} active={delegating} />
              <Action k="S" label="Snooze to Wed" onClick={() => decide("snooze")} />
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
    <button type="button" onClick={onClick} className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-[13.5px] font-medium transition-colors ${active ? "border-signal bg-signal/10 text-fg" : "border-line-strong text-fg hover:border-signal"}`}>
      <Kbd>{k}</Kbd>{label}
    </button>
  );
}

function Finish({ queue, decisions, onClose, onRestart }: { queue: Props["queue"]; decisions: Record<string, Decision>; onClose: () => void; onRestart: () => void }) {
  const decided = queue.filter((q) => decisions[q.b.item.id]);
  const open = queue.length - decided.length;
  const by = (a: DecisionAction) => decided.filter((q) => decisions[q.b.item.id].action === a).length;
  return (
    <div className="card-in mt-6 rounded-2xl border border-line-strong bg-panel p-6">
      <h3 className="text-[22px] font-semibold">{open === 0 ? "Everything triaged." : `${decided.length} decided, ${open} left open.`}</h3>
      <p className="mt-1 text-[14px] text-dim">
        {by("ack")} acknowledged, {by("delegate")} delegated, {by("snooze")} snoozed, {by("nudge")} nudged.
      </p>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {queue.map((q) => (
          <li key={q.b.item.id} className="flex items-center gap-3 py-2 text-[13.5px]">
            <SourceIcon source={q.b.item.source} />
            <span className="w-16 shrink-0 font-mono text-[12.5px] text-dim">{q.b.item.key}</span>
            <span className="min-w-0 flex-1 truncate text-fg">{q.b.item.title}</span>
            <span className={`shrink-0 text-[12.5px] ${decisions[q.b.item.id] ? "text-ok" : "text-faint"}`}>{decisions[q.b.item.id] ? decisionLabel(decisions[q.b.item.id]) : "Open"}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-lg bg-signal px-4 text-[14px] font-semibold text-signal-ink">Back to radar</button>
        <button type="button" onClick={onRestart} className="h-10 rounded-lg border border-line-strong px-4 text-[14px] text-fg hover:border-signal">Review again</button>
      </div>
    </div>
  );
}
