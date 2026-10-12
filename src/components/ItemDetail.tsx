"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BoardItem, WorkEvent } from "@/lib/types";
import { DEMO_NOW } from "@/lib/types";
import type { ReasonsResponse } from "@/lib/api-types";
import { deriveBoard, formatInManagerTz } from "@/lib/board";
import { eventsByItem, extractedCache, getItem, getPerson, items as ALL_ITEMS, itemById } from "@/lib/data";
import { toCompactItem } from "@/lib/compact";
import { applyActions, useActions } from "./actions-store";
import { ActionBar } from "./ActionBar";
import { ActionToast } from "./Toast";
import { SearchBox } from "./Search";
import { itemHref } from "./slug";
import { ContactShape, HudLabel, RadarMark, SOURCE_META, ScoreBar, ScoreChip, SourceIcon, Sparkle, fmtDuration, hoursSince } from "./ui";
import { metaLine, postJson } from "./api";

const NOISE = new Set(["reaction", "ci_passed", "ci_failed", "bot"]);
const KIND_LABEL: Record<string, string> = {
  created: "created", status_changed: "status", comment: "comment", review_requested: "review requested", review_approved: "approved",
  changes_requested: "changes requested", commit: "commit", merged: "merged", deployed: "deployed", message: "message",
  email_received: "email in", email_sent: "email out", incident_opened: "incident opened", incident_update: "incident update",
  reaction: "reaction", ci_passed: "CI passed", ci_failed: "CI failed", bot: "bot",
};
const RING_LABEL = { now: "Act now", today: "Today", watch: "Watch" } as const;

let rawNow: ReturnType<typeof deriveBoard> | null = null;
const nowBoard = () => (rawNow ??= deriveBoard(DEMO_NOW));

function Panel({ label, children, className = "", hot, open }: { label: string; children: React.ReactNode; className?: string; hot?: boolean; open?: boolean }) {
  // "open" panels skip the clip-path so popover menus can extend past their edge
  const shell = open
    ? `relative z-20 brackets border p-4 sm:p-5 ${hot ? "frame-hot border-signal/50" : "border-line-strong"} bg-[linear-gradient(180deg,rgba(10,34,62,0.85),rgba(5,16,32,0.85))]`
    : `frame brackets p-4 sm:p-5 ${hot ? "frame-hot" : ""}`;
  return (
    <section className={`${shell} ${className}`} aria-label={label}>
      <h2 className="scanline mb-3"><HudLabel className="text-[11px]">{label}</HudLabel></h2>
      {children}
    </section>
  );
}

export default function ItemDetail({ id }: { id: string }) {
  const item = getItem(id)!;
  const store = useActions();
  const raw = nowBoard();
  const board = useMemo(() => applyActions(raw, store, true), [raw, store]);
  const a = store.items[id];
  const rawBi = raw.items.find((b) => b.item.id === id);
  const bi: BoardItem | undefined = board.items.find((b) => b.item.id === id) ?? board.snoozed.find((b) => b.item.id === id) ?? (rawBi && a?.assign?.to ? { ...rawBi, item: { ...rawBi.item, ownerId: a.assign.to } } : rawBi);
  const [ai, setAi] = useState<{ text?: string; meta?: ReasonsResponse; status: "loading" | "ready" | "none" }>({ status: rawBi ? "loading" : "none" });
  const [showNoise, setShowNoise] = useState(false);

  useEffect(() => {
    if (!rawBi) return;
    let alive = true;
    postJson<ReasonsResponse>("/api/reasons", { items: [toCompactItem(rawBi)] }, 30_000)
      .then((r) => alive && setAi({ text: r.reasons?.[id], meta: r, status: "ready" }))
      .catch(() => alive && setAi({ status: "none" }));
    return () => {
      alive = false;
    };
  }, [id, rawBi]);

  const ownerId = a?.assign?.to ?? item.ownerId;
  const owner = getPerson(ownerId);
  const status = a?.done ? "Done (marked by you)" : bi?.status ?? item.status;
  const now = Date.parse(DEMO_NOW);

  const signals = useMemo(
    () => extractedCache.filter((s) => Date.parse(s.evidenceTs) <= now && (s.itemIds.includes(id) || s.sourceItemId === id)),
    [id, now]
  );
  const evById = useMemo(() => {
    const m = new Map<string, WorkEvent>();
    for (const list of eventsByItem.values()) for (const e of list) m.set(e.id, e);
    return m;
  }, []);
  const linked = useMemo(
    () => Array.from(new Set([...item.links, ...ALL_ITEMS.filter((o) => o.links.includes(id)).map((o) => o.id)])).filter((l) => l !== id && itemById.has(l)),
    [id, item.links]
  );
  const trail = useMemo(() => {
    const ids = [id, ...linked];
    return ids
      .flatMap((x) => eventsByItem.get(x) ?? [])
      .filter((e) => Date.parse(e.ts) <= now)
      .sort((p, q) => Date.parse(q.ts) - Date.parse(p.ts));
  }, [id, linked, now]);
  const noiseCount = trail.filter((e) => NOISE.has(e.kind)).length;
  const blockedPerson = raw.blocked.find((p) => p.items.some((b) => b.item.id === id));
  // this item's own chain: the person's longest chain if it runs through this item, else item -> what it waits on
  const chain = (() => {
    if (!blockedPerson) return [];
    const c = blockedPerson.chain;
    const at = c.indexOf(item.key);
    if (at >= 0) return c.slice(at);
    const w = rawBi?.waitingOn;
    const label = w ? (getPerson(w)?.name ? `${getPerson(w)!.name}` : w.replace(/^us:\s*/i, "us: ")) : "waiting";
    return [item.key, label];
  })();
  const color = item.priority === "P0" ? "var(--crit)" : SOURCE_META[item.source].color;

  return (
    <div className="relative min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-ink/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="hud flex h-8 items-center gap-2 rounded-[2px] border border-line-strong px-3 text-[11px] text-holo hover:border-holo">← Back to dashboard</Link>
            <span className="flex items-center gap-2"><RadarMark size={22} /><span className="font-display text-[16px] font-bold tracking-[0.08em]">WORKRADAR</span></span>
          </div>
          <SearchBox />
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] space-y-4 px-4 py-5 sm:px-6">
        {/* ---------------- header */}
        <section className={`frame brackets p-5 sm:p-6 ${bi?.ring === "now" ? "frame-hot" : ""}`} aria-labelledby="item-title">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden><ContactShape type={item.type} r={5.5} fill={bi?.blocked ? "none" : color} stroke={color} strokeWidth={bi?.blocked ? 1.4 : 0} strokeDasharray={bi?.blocked ? "2 1.6" : undefined} /></svg>
            <SourceIcon source={item.source} />
            <span className="font-mono text-[14px] font-semibold" style={{ color }}>{item.key}</span>
            <span className="hud text-[10.5px] text-faint">{SOURCE_META[item.source].label}{item.channel ? ` · ${item.channel}` : ""} · {item.type}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <h1 id="item-title" className="max-w-[800px] text-[24px] font-semibold leading-tight tracking-[-0.01em] sm:text-[28px]" style={{ textWrap: "balance" }}>{item.title}</h1>
            {bi && <div className="flex items-center gap-2"><HudLabel>Score</HudLabel><ScoreChip value={bi.score.total} /></div>}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-3 lg:grid-cols-6">
            <Field k="Status" v={status} tone={a?.done ? "text-ok" : undefined} />
            <Field k="Priority" v={item.priority ?? "None"} tone={item.priority === "P0" ? "text-crit" : undefined} />
            <Field k="Due" v={item.dueAt ? formatInManagerTz(item.dueAt) : "No date"} mono={!!item.dueAt} />
            <Field k={a?.assign ? "Assignee" : "Owner"} v={owner?.name ?? "Unowned"} extra={a?.assign ? "Assigned by you" : owner?.location} />
            <Field k="Ring" v={bi ? RING_LABEL[bi.ring] : a?.done ? "Off radar" : "Not on radar"} tone={bi?.ring === "now" ? "text-signal" : undefined} />
            <Field k="Last activity" v={bi?.lastActivityTs ? formatInManagerTz(bi.lastActivityTs) : "None"} mono />
          </dl>
          {bi && <div className="mt-5 max-w-[720px]"><ScoreBar score={bi.score} showLabels /></div>}
        </section>

        {/* ---------------- actions */}
        <Panel label="Actions · Assign · Mark done · Snooze · Nudge" hot open>
          <ActionBar b={rawBi} itemId={id} ownerId={item.ownerId} />
          {a?.snooze?.until && <p className="mt-2 text-[12.5px] text-dim">Hidden from the dashboard until {formatInManagerTz(a.snooze.until)} Cologne.</p>}
          {a?.done && <p className="mt-2 text-[12.5px] text-dim">Off the radar and listed in What happened. Undo puts it back.</p>}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-4">
            {/* ---------------- why */}
            <Panel label="Why it ranks here">
              {ai.status === "loading" && <div className="space-y-2"><div className="skeleton h-3.5 w-[85%]" /><div className="skeleton h-3.5 w-[60%]" /></div>}
              {ai.status === "ready" && ai.text && (
                <p className="flex gap-2 border border-holo/30 bg-holo/[0.06] px-3 py-2.5 text-[15px] leading-snug text-fg"><Sparkle className="mt-[5px]" /><span>{ai.text}</span></p>
              )}
              {ai.meta && <p className="mt-1.5 font-mono text-[11px] text-faint">AI reason: {metaLine(ai.meta)}</p>}
              {bi ? (
                <>
                  <h3 className="mt-4"><HudLabel>Rule reasons</HudLabel></h3>
                  <ul className="mt-1.5 space-y-1 text-[14px] text-dim">
                    {bi.reasons.map((r) => <li key={r} className="flex gap-2"><span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 bg-holo" />{r}</li>)}
                  </ul>
                </>
              ) : (
                <p className="text-[14px] text-dim">Not on the board at {formatInManagerTz(DEMO_NOW)}: closed, or context with no open signal.</p>
              )}
              {signals.length > 0 && (
                <>
                  <h3 className="mt-5"><HudLabel>Signals read by AI from Slack and email</HudLabel></h3>
                  <ul className="mt-2 space-y-3">
                    {signals.map((sg, i) => {
                      const ev = evById.get(sg.evidenceEventId);
                      return (
                        <li key={i} className="text-[14px]">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="hud rounded-[2px] border border-line-strong px-1.5 py-[1px] text-[9.5px] text-holo">{sg.kind.replace("_", " ")}</span>
                            <span className="text-fg">{sg.summary}</span>
                          </div>
                          {ev?.text && (
                            <blockquote className="mt-1.5 border-l-2 border-holo/50 pl-3 text-[13.5px] italic leading-snug text-dim">
                              &ldquo;{ev.text}&rdquo;
                              <footer className="mt-0.5 not-italic text-[12px] text-faint">{getPerson(ev.actorId)?.name ?? ev.actorId}, {formatInManagerTz(ev.ts)} in <Link href={itemHref(sg.sourceItemId)} className="text-holo hover:underline">{getItem(sg.sourceItemId)?.key}</Link></footer>
                            </blockquote>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </Panel>

            {/* ---------------- timeline */}
            <Panel label="Event timeline · Cologne time">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-faint">{trail.length - noiseCount} events across {SOURCE_META[item.source].label}{linked.length ? " and linked items" : ""}, newest first</p>
                <button type="button" aria-pressed={showNoise} onClick={() => setShowNoise((v) => !v)} className={`hud h-7 rounded-[2px] border px-2 text-[10px] ${showNoise ? "border-holo text-holo" : "border-line-strong text-dim hover:border-holo"}`}>
                  {showNoise ? "Hide" : "Show"} noise ({noiseCount})
                </button>
              </div>
              <ol className="border-l border-line">
                {trail.filter((e) => showNoise || !NOISE.has(e.kind)).map((e) => {
                  const noise = NOISE.has(e.kind);
                  const src = itemById.get(e.itemId)!;
                  return (
                    <li key={e.id} className={`relative py-2 pl-4 ${noise ? "opacity-40" : ""}`}>
                      <span aria-hidden className="absolute left-[-3.5px] top-[14px] h-[6px] w-[6px] rotate-45" style={{ background: noise ? "var(--line-strong)" : SOURCE_META[src.source].color }} />
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                        <span className="font-mono text-dim">{formatInManagerTz(e.ts)}</span>
                        <span className="font-medium text-fg">{getPerson(e.actorId)?.name ?? e.actorId}</span>
                        <span className="text-faint">{KIND_LABEL[e.kind] ?? e.kind}{e.kind === "status_changed" && e.to ? ` to ${e.to}` : ""}{noise ? ", noise" : ""}</span>
                        {src.id !== id && <Link href={itemHref(src.id)} className="font-mono text-[11px] hover:underline" style={{ color: SOURCE_META[src.source].color }}>{src.key}</Link>}
                      </div>
                      {e.text && <p className="mt-0.5 text-[14px] leading-snug text-dim">{e.text}</p>}
                    </li>
                  );
                })}
              </ol>
            </Panel>
          </div>

          <div className="min-w-0 space-y-4">
            {(bi?.blocked || blockedPerson) && (
              <Panel label="Blocker chain">
                {blockedPerson ? (
                  <>
                    <p className="text-[13px] text-dim">
                      {blockedPerson.person.name} is holding
                      {bi?.blockedSinceTs && <> for <span className="font-mono text-signal">{fmtDuration(hoursSince(bi.blockedSinceTs, DEMO_NOW))}</span>, since {formatInManagerTz(bi.blockedSinceTs)}</>}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {chain.map((l, i) => {
                        const target = ALL_ITEMS.find((x) => x.key === l);
                        return (
                          <span key={i} className="inline-flex items-center gap-1.5">
                            {i > 0 && <span aria-hidden className="text-faint">→</span>}
                            {target ? (
                              <Link href={itemHref(target.id)} className="rounded-[2px] border px-1.5 py-[3px] font-mono text-[12px] hover:brightness-125" style={{ color: SOURCE_META[target.source].color, borderColor: "var(--line-strong)" }}>{l}</Link>
                            ) : (
                              <span className="rounded-[2px] border border-dashed border-holo/60 px-1.5 py-[3px] text-[12px] text-fg">{l}</span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </>
                ) : null}
                {bi?.blockedReason && <p className="mt-3 text-[13.5px] text-dim">{bi.blockedReason}</p>}
                {a?.assign && <p className="mt-2 text-[12.5px] text-faint">Assigning does not unblock it; the chain above still holds.</p>}
              </Panel>
            )}

            <Panel label={`Linked items · ${linked.length}`}>
              {linked.length ? (
                <ul className="space-y-1.5">
                  {linked.map((l) => {
                    const it = getItem(l)!;
                    return (
                      <li key={l}>
                        <Link href={itemHref(l)} className="flex items-start gap-2 px-1.5 py-1 -mx-1.5 hover:bg-raised">
                          <SourceIcon source={it.source} className="mt-[3px]" />
                          <span className="min-w-0">
                            <span className="font-mono text-[12.5px]" style={{ color: SOURCE_META[it.source].color }}>{it.key}</span>{" "}
                            <span className="text-[13.5px] text-fg">{it.title}</span>
                            <span className="block text-[12px] text-faint">{it.status} · {getPerson(it.ownerId)?.name ?? "Unowned"}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-faint">No linked items.</p>
              )}
            </Panel>

          </div>
        </div>
      </main>
      <ActionToast />
    </div>
  );
}

function Field({ k, v, mono, tone, extra }: { k: string; v: string; mono?: boolean; tone?: string; extra?: string }) {
  return (
    <div className="min-w-0">
      <dt><HudLabel className="text-[9.5px] text-faint">{k}</HudLabel></dt>
      <dd className={`truncate ${tone ?? "text-fg"} ${mono ? "font-mono text-[13px]" : ""}`}>{v}</dd>
      {extra && <dd className="truncate text-[11.5px] text-faint">{extra}</dd>}
    </div>
  );
}
