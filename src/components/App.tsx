"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardItem, BoardState, Source } from "@/lib/types";
import { DEMO_NOW, WEEK_START } from "@/lib/types";
import type { BriefResponse, ReasonsResponse, StatusResponse } from "@/lib/api-types";
import { deriveBoard, formatInManagerTz } from "@/lib/board";
import { getPerson } from "@/lib/data";
import { recentEvents, toCompactBoard, toCompactItem } from "@/lib/compact";
import { Radar, RadarLegend } from "./Radar";
import type { Trail } from "./Radar";
import { AttentionList, BlockedList, HappenedList, TopList } from "./Panels";
import type { ReasonText } from "./Panels";
import { BriefList } from "./Brief";
import type { BriefState } from "./Brief";
import { Ask, SUGGESTED } from "./Ask";
import { Replay } from "./Replay";
import { Drawer } from "./Drawer";
import { Triage } from "./Triage";
import { Widget } from "./Widget";
import type { WidgetId } from "./Widget";
import { Kbd, RadarMark, SOURCE_META, Sparkle, fmtDuration, hoursSince } from "./ui";
import { clutterAt, place } from "./scope";
import type { Placed } from "./scope";
import { metaLine, postJson } from "./api";
import { useRouter } from "next/navigation";
import { applyActions, useActions } from "./actions-store";
import { PriorityFeed } from "./Feed";
import { SearchBox } from "./Search";
import { ActionToast } from "./Toast";
import { itemHref } from "./slug";

const LO = Date.parse(WEEK_START);
const HI = Date.parse(DEMO_NOW);
const HOUR = 3_600_000;
const PLAY_MS_PER_HOUR = 600;

// deriveBoard is pure and ~2ms; cache by 5-minute bucket so scrubbing back and forth is free
const boardCache = new Map<number, BoardState>();
function boardAt(t: number): BoardState {
  const q = t >= HI ? HI : Math.floor(t / 300_000) * 300_000;
  let b = boardCache.get(q);
  if (!b) {
    b = deriveBoard(q === HI ? DEMO_NOW : new Date(q).toISOString());
    if (boardCache.size > 800) boardCache.clear();
    boardCache.set(q, b);
  }
  return b;
}
const placeCache = new WeakMap<BoardState, Placed[]>();
function placedAt(b: BoardState): Placed[] {
  let p = placeCache.get(b);
  if (!p) {
    p = place(b.items);
    placeCache.set(b, p);
  }
  return p;
}

const TRAIL_STEPS = [360, 240, 150, 90, 40]; // minutes before t, oldest first
const RGB: Record<Source, string> = { jira: "63,208,255", github: "154,166,255", slack: "46,230,197", email: "227,244,255" };

export default function App() {
  const [t, setT] = useState(HI);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [triageOpen, setTriageOpen] = useState(false);
  const [openW, setOpenW] = useState<WidgetId | null>(null);
  const [suppress, setSuppress] = useState(true);
  const [live, setLive] = useState<boolean | null>(null);
  const [brief, setBrief] = useState<BriefState>({ status: "loading" });
  const [aiReasons, setAiReasons] = useState<Record<string, string>>({});
  const [reasonsMode, setReasonsMode] = useState<ReasonsResponse | null>(null);
  const askRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const store = useActions();
  const decisions = store.items;
  const rawBoard = useMemo(() => boardAt(t), [t]);
  // user actions (done, snooze, assign) apply to the live view only; replay shows history untouched
  const board = useMemo(() => applyActions(rawBoard, store, t >= HI), [rawBoard, store, t]);
  const nowBoard = useMemo(() => boardAt(HI), []);
  const replaying = t < HI;
  const placed = useMemo(() => placedAt(board), [board]);
  const clutter = useMemo(() => clutterAt(Math.min(t, HI)), [t]);

  // ---------- AI calls, all for "now"; every failure falls back to rule-based text
  useEffect(() => {
    let alive = true;
    fetch("/api/status")
      .then((r) => r.json() as Promise<StatusResponse>)
      .then((s) => alive && setLive(!!s.live))
      .catch(() => alive && setLive(false));
    postJson<BriefResponse>("/api/brief", { board: toCompactBoard(nowBoard) }, 45_000)
      .then((data) => alive && setBrief({ status: "ready", data }))
      .catch((e) => alive && setBrief({ status: "error", message: e instanceof Error ? e.message : "request failed" }));
    postJson<ReasonsResponse>("/api/reasons", { items: nowBoard.items.slice(0, 30).map(toCompactItem) }, 45_000)
      .then((r) => {
        if (!alive) return;
        setAiReasons(r.reasons ?? {});
        setReasonsMode(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [nowBoard]);


  // ---------- replay: scrub throttled to one board per animation frame
  const pending = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const scrub = useCallback((v: number) => {
    setPlaying(false);
    pending.current = v;
    if (raf.current === null) {
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        if (pending.current !== null) setT(pending.current);
      });
    }
  }, []);

  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const n = tRef.current + (dt / PLAY_MS_PER_HOUR) * HOUR;
      if (n >= HI) {
        tRef.current = HI;
        setT(HI);
        setPlaying(false);
        return;
      }
      tRef.current = n;
      setT(n);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  const togglePlay = useCallback(() => {
    if (!playing && tRef.current >= HI) {
      tRef.current = LO;
      setT(LO);
    }
    setPlaying(!playing);
  }, [playing]);
  const goNow = useCallback(() => {
    setPlaying(false);
    setT(HI);
  }, []);

  // ---------- track history: earlier positions of each contact while replaying
  const trails = useMemo<Trail[]>(() => {
    if (!replaying) return [];
    const samples = TRAIL_STEPS.map((m) => t - m * 60_000).filter((s) => s >= LO).map((s) => new Map(placedAt(boardAt(s)).map((p) => [p.b.item.id, p])));
    const out: Trail[] = [];
    for (const p of placed) {
      const pts: { x: number; y: number }[] = [];
      for (const m of samples) {
        const q = m.get(p.b.item.id);
        if (q) pts.push({ x: q.x, y: q.y });
      }
      pts.push({ x: p.x, y: p.y });
      const moved = pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) > 3);
      if (pts.length > 1 && moved) out.push({ id: p.b.item.id, pts, color: p.b.item.priority === "P0" ? "255,90,95" : RGB[p.b.item.source] });
    }
    return out;
  }, [replaying, t, placed]);

  // ---------- widgets: one open at a time; Esc or a click outside closes
  const toggleW = useCallback((id: WidgetId) => setOpenW((w) => (w === id ? null : id)), []);
  useEffect(() => {
    if (!openW) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest(`[data-widget="${openW}"]`) || el.closest("[data-keep-widget]") || el.closest('[role="dialog"]')) return;
      setOpenW(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !drawerId && !triageOpen) setOpenW(null);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openW, drawerId, triageOpen]);

  const openAsk = useCallback(() => {
    setOpenW("ask");
    window.setTimeout(() => {
      askRef.current?.focus();
      askRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
  }, []);


  const reasonFor = useCallback(
    (b: BoardItem): ReasonText => {
      const ai = !replaying ? aiReasons[b.item.id] : undefined;
      if (ai) return { text: ai, ai: true };
      return { text: b.reasons.slice(0, 2).join("; ") || "No strong signal", ai: false };
    },
    [aiReasons, replaying]
  );

  // selecting from anywhere locks the radar onto the contact and opens its drawer
  const openItem = useCallback((id: string) => {
    setSelectedId(id);
    setDrawerId(id);
  }, []);

  const attentionIds = useMemo(() => new Set(board.attention.map((b) => b.item.id)), [board]);
  const openDetail = useCallback((id: string) => router.push(itemHref(id)), [router]);
  const [triageSnap, setTriageSnap] = useState<{ b: BoardItem; why: "attention" | "blocked" }[] | null>(null);
  const triageQueue = useMemo(() => {
    const seen = new Set<string>();
    const q: { b: BoardItem; why: "attention" | "blocked" }[] = [];
    // from the raw board, so items you mark done or snooze stay in the queue and count as triaged
    for (const b of rawBoard.attention) if (!seen.has(b.item.id)) { seen.add(b.item.id); q.push({ b, why: "attention" }); }
    for (const p of rawBoard.blocked) for (const b of p.items) if (!seen.has(b.item.id)) { seen.add(b.item.id); q.push({ b, why: "blocked" }); }
    return q;
  }, [rawBoard]);
  const startTriage = useCallback(() => {
    setOpenW(null);
    setTriageSnap(triageQueue);
    setTriageOpen(true);
  }, [triageQueue]);
  const triagedCount = triageQueue.filter((q) => decisions[q.b.item.id]).length;

  // ---------- keyboard: T triage, / ask
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (triageOpen || drawerId) return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        startTriage();
      } else if (e.key === "/") {
        e.preventDefault();
        openAsk();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triageOpen, drawerId, openAsk, startTriage]);

  const common = { selectedId, hoverId, onSelect: openItem, onHover: setHoverId, reasonFor, decisions };
  const getAskBoard = useCallback(() => ({ board: toCompactBoard(board), recentEvents: recentEvents(board.at) }), [board]);
  const nowLabel = formatInManagerTz(DEMO_NOW).slice(4);
  const actNow = board.items.filter((b) => b.ring === "now").length;
  const trackId = hoverId ?? selectedId ?? board.top[0]?.item.id ?? null;
  const track = (trackId ? board.items.find((b) => b.item.id === trackId) : undefined) ?? board.top[0];

  // ---------- widget summaries (all from the board at time t)
  const attn = board.attention;
  const firstSentence = brief.status === "ready" ? brief.data.sentences[0]?.text : undefined;
  const latest = board.happened[0];

  const left = (
    <>
      <Widget
        id="attention" side="left" sector="Needs attention" title="Needs attention now" hint="Incidents, escalations, decisions for you"
        count={attn.length} countColor="var(--signal)" hot={attn.length > 0} open={openW === "attention"} onToggle={toggleW}
        summary={attn[0] ? <><span className="font-mono text-signal">{attn[0].item.key}</span> {attn[0].item.title}</> : "Nothing needs you right now."}
        visual={<ScoreBars items={attn} />}
      >
        <AttentionList board={board} c={common} />
      </Widget>
      <Widget
        id="blocked" side="left" sector="Who is blocked" title="Who is blocked" hint="Longest blocker chain per person"
        count={board.blocked.length} countColor="var(--holo)" open={openW === "blocked"} onToggle={toggleW}
        summary={board.blocked.length ? board.blocked.map((b) => b.person.name.split(" ")[0]).join(" · ") : "Nobody is blocked."}
        visual={<Holding board={board} />}
      >
        <BlockedList board={board} c={common} />
      </Widget>
      <Widget
        id="brief" side="left" sector="AI summary · Morning brief" title="AI summary · Morning brief" hint={brief.status === "ready" ? metaLine(brief.data) : undefined}
        count={brief.status === "ready" ? Math.min(5, brief.data.sentences.length) : undefined} countColor="var(--holo)" open={openW === "brief"} onToggle={toggleW}
        summary={
          brief.status === "loading" ? <span className="block space-y-1.5"><span className="skeleton block h-3 w-[90%]" /><span className="skeleton block h-3 w-[70%]" /></span>
          : brief.status === "error" ? "The brief did not load. Widgets are still current."
          : <span className="line-clamp-4">{replaying && <span className="text-signal">At {nowLabel} now: </span>}{firstSentence}</span>
        }
      >
        <BriefList state={brief} onSelect={openItem} replaying={replaying} nowLabel={nowLabel} />
      </Widget>
    </>
  );

  const right = (
    <>
      <Widget
        id="top" side="right" sector="Priority feed · Top work" title="Priority feed · Top work" hint="All open items, ranked by rule-based score"
        count={board.items.length} countColor="var(--holo)" open={openW === "top"} onToggle={toggleW}
        summary={board.top[0] ? <><span className="font-mono text-holo">#1 {board.top[0].item.key}</span> {board.top[0].item.title}<span className="mt-1 block text-[11.5px] text-faint">{board.items.length} open items ranked. Top 5 below.</span></> : "No open work ranked yet."}
        visual={<ScoreBars items={board.top} />}
      >
        <PriorityFeed items={board.items} snoozed={board.snoozed} attentionIds={attentionIds} reasonFor={reasonFor} onOpen={openDetail} onHover={setHoverId} hoverId={hoverId} live={!replaying} />
      </Widget>
      <Widget
        id="happened" side="right" sector="What happened" title="What happened today" hint="Since 08:00 team time, newest first"
        count={board.happened.length} countColor="var(--holo)" open={openW === "happened"} onToggle={toggleW}
        summary={latest ? <><span className="font-mono text-dim">{formatInManagerTz(latest.event.ts).slice(4)}</span> {latest.label}</> : "Quiet since 08:00 team time."}
        visual={<DayTicks board={board} />}
      >
        <HappenedList board={board} c={common} />
      </Widget>
      <Widget
        id="ask" side="right" sector="Ask WorkRadar" title="Ask WorkRadar"
        open={openW === "ask"} onToggle={(id) => (openW === id ? toggleW(id) : openAsk())}
        summary={<span className="text-dim">Ask about today&apos;s work in plain words. Answers cite their sources.</span>}
        visual={
          <span className="flex flex-wrap gap-1">
            {SUGGESTED.slice(0, 2).map((s) => <span key={s} className="truncate rounded-[2px] border border-line px-1.5 py-0.5 text-[11px] text-faint">{s}</span>)}
            <span className="ml-auto self-center"><Kbd>/</Kbd></span>
          </span>
        }
      >
        <Ask ref={askRef} getBoard={getAskBoard} onSelect={openItem} replaying={replaying} />
      </Widget>
    </>
  );

  return (
    <div className="relative flex min-h-dvh flex-col lg:h-dvh lg:min-h-[760px]">
      {/* ---------------- top bar */}
      <header className="relative z-20 border-b border-line bg-ink/60 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 px-4 py-2.5 lg:flex-nowrap lg:px-5">
          <div className="flex shrink-0 items-center gap-2.5">
            <RadarMark size={28} />
            <span className="font-display text-[20px] font-bold tracking-[0.08em] text-fg glow-text">WORKRADAR</span>
            <span className="hud text-[10px] text-faint">CIC</span>
          </div>
          <div className="order-last w-full lg:order-none lg:mx-auto lg:w-auto"><SearchBox /></div>
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2.5 lg:ml-0">
            <AiBadge live={live} brief={brief} />
            <button type="button" onClick={openAsk} className="hud flex h-8 items-center gap-2 rounded-[2px] border border-line-strong px-3 text-[11px] text-holo hover:border-holo hover:shadow-[0_0_14px_rgba(63,208,255,0.35)]">
              Ask <Kbd>/</Kbd>
            </button>
            <button type="button" onClick={startTriage} className="hud flex h-8 items-center gap-2 rounded-[2px] bg-signal px-3 text-[11px] text-signal-ink shadow-[0_0_16px_rgba(255,181,71,0.35)] hover:brightness-110">
              Triage <span className="font-mono">{triagedCount}/{triageQueue.length}</span>
              <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] border border-signal-ink/40 px-1 font-mono text-[11px]">T</kbd>
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-line px-4 py-1.5 lg:px-5">
          <p className="hud flex flex-wrap gap-x-4 gap-y-0.5 text-[10.5px] text-faint" aria-label="System status">
            <span><span className="text-faint">Own ship </span><span className="text-fg">Marty McFly</span> · CGN <span className="font-mono text-holo">{formatInManagerTz(t).slice(4)}</span> · Team <span className="text-dim">RUH · CAI · BLR</span></span>
            <span aria-hidden className="text-line-strong">|</span>
            <span>Contacts <b className="font-mono font-semibold text-holo">{board.items.length}</b></span>
            <span>Act now <b className="font-mono font-semibold text-signal">{actNow}</b></span>
            <span>Attention <b className="font-mono font-semibold text-signal">{attn.length}</b></span>
            <span>Holding <b className="font-mono font-semibold text-holo">{board.blocked.length}</b></span>
            <span>Clutter filtered <b className="font-mono font-semibold text-dim">{clutter.count}</b></span>
          </p>
          <p className="text-[11px] text-faint">
            Mock data, fictional people and companies. Built with Claude.{" "}
            <Link href="/docs" className="text-dim underline decoration-line-strong underline-offset-4 hover:text-fg">How AI was used</Link>
          </p>
        </div>
      </header>

      {replaying && (
        <div className="pointer-events-none fixed inset-x-0 top-[92px] z-30 flex justify-center px-4 max-lg:top-3" aria-live="polite">
          <div className="frame frame-hot pointer-events-auto flex items-center gap-3 py-1.5 pl-4 pr-1.5 text-[13px]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-signal" aria-hidden />
            <span className="hud text-[11px] text-fg">Replaying <span className="font-mono text-signal">{formatInManagerTz(t)}</span> Cologne</span>
            <button type="button" onClick={goNow} className="hud rounded-[2px] bg-signal px-2.5 py-1 text-[10.5px] text-signal-ink">Back to now</button>
          </div>
        </div>
      )}

      {/* ---------------- console */}
      <main className="relative z-10 grid min-h-0 flex-1 content-start gap-4 px-4 py-4 lg:content-stretch lg:grid-cols-[300px_minmax(0,1fr)_300px] lg:px-5">
        <div className="order-2 flex min-h-0 flex-col gap-3 lg:order-1">{left}</div>

        <section aria-labelledby="radar-h" className="order-1 flex min-h-0 flex-col items-center lg:order-2" data-keep-widget>
          <h2 id="radar-h" className="sr-only">Radar</h2>
          <div className="flex w-full min-h-0 flex-1 items-center justify-center">
            <div className="aspect-square w-full max-w-[680px] lg:h-full lg:w-auto lg:max-w-full">
              <Radar
                placed={placed}
                attentionIds={attentionIds}
                selectedId={selectedId}
                hoverId={hoverId}
                onHover={setHoverId}
                onSelect={openItem}
                replaying={replaying}
                specks={clutter.specks}
                suppress={suppress}
                trails={trails}
              />
            </div>
          </div>
          <div className="mt-1.5 flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => setSuppress((s) => !s)}
              aria-pressed={suppress}
              className={`hud flex h-7 items-center gap-2 rounded-[2px] border px-2.5 text-[10.5px] ${suppress ? "border-line-strong text-dim" : "border-holo text-holo shadow-[0_0_12px_rgba(63,208,255,0.3)]"}`}
              title="Bot, CI and reaction events plus chatter in threads with no signal. They never reach the board."
            >
              <span className={`h-1.5 w-1.5 rounded-full ${suppress ? "bg-ok" : "bg-signal"}`} aria-hidden />
              Clutter suppression {suppress ? "on" : "off"}
            </button>
            <span className="text-[11.5px] text-faint" title={`${clutter.kinds.bots} bot, ${clutter.kinds.ci} CI, ${clutter.kinds.reactions} reactions, ${clutter.kinds.chatter} off-topic chatter`}>
              <span className="font-mono text-dim">{clutter.count}</span> noise events {suppress ? "suppressed" : "shown"}
              <span className="lg:hidden 2xl:inline">: {clutter.kinds.bots} bot, {clutter.kinds.ci} CI, {clutter.kinds.reactions} reactions, {clutter.kinds.chatter} chatter</span>
            </span>
                        <div className="hidden xl:block"><RadarLegend /></div>
          </div>
        </section>

        <div className="order-3 flex min-h-0 flex-col gap-3">{right}</div>
      </main>

      {/* ---------------- bottom: track info + replay */}
      <div className="sticky bottom-0 z-20 border-t border-line-strong bg-[rgba(3,10,22,0.9)] backdrop-blur-md" data-keep-widget>
        <div className="max-md:hidden"><TrackInfo b={track} at={board.at} reason={track ? reasonFor(track) : undefined} onOpen={openItem} locked={!!selectedId && track?.item.id === selectedId} /></div>
        <div className="px-4 pb-2.5 pt-1 lg:px-5">
          <Replay t={t} onScrub={scrub} playing={playing} onTogglePlay={togglePlay} onNow={goNow} timeline={nowBoard.timeline} />
        </div>
      </div>

      {drawerId && (
        <Drawer id={drawerId} board={board} aiReason={!replaying ? aiReasons[drawerId] : undefined} live={!replaying} onClose={() => setDrawerId(null)} onSelect={openItem} />
      )}
      {triageOpen && (
        <Triage queue={triageSnap ?? triageQueue} at={board.at} decisions={decisions} onClose={() => setTriageOpen(false)} aiReasons={replaying ? {} : aiReasons} />
      )}
      <ActionToast />
      {reasonsMode && <span className="sr-only">Reason lines marked with a spark are written by AI ({reasonsMode.mode}).</span>}
    </div>
  );
}

// ---------------------------------------------------------------- small real-data visuals for collapsed tiles

function ScoreBars({ items }: { items: BoardItem[] }) {
  if (!items.length) return null;
  return (
    <span className="flex items-end gap-1.5" aria-hidden>
      {items.slice(0, 6).map((b) => (
        <span key={b.item.id} className="flex min-w-0 max-w-[64px] flex-1 flex-col items-center gap-1">
          <span className="relative h-12 w-full overflow-hidden bg-line/60">
            <span className="absolute inset-x-0 bottom-0" style={{ height: `${b.score.total}%`, background: b.score.total >= 75 ? "var(--signal)" : "var(--holo)", boxShadow: "0 0 8px currentColor", opacity: 0.85 }} />
          </span>
          <span className="w-full truncate text-center font-mono text-[9.5px] text-faint">{b.item.key.replace("PR ", "")}</span>
        </span>
      ))}
    </span>
  );
}

function Holding({ board }: { board: BoardState }) {
  if (!board.blocked.length) return null;
  return (
    <span className="block space-y-1" aria-hidden>
      {board.blocked.slice(0, 4).map((bp) => {
        const since = bp.items.map((i) => i.blockedSinceTs).filter((x): x is string => !!x).sort()[0];
        return (
          <span key={bp.person.id} className="flex items-center justify-between gap-2 text-[11.5px]">
            <span className="truncate text-dim">{bp.person.name.split(" ")[0]} <span className="text-faint">{bp.chain[bp.chain.length - 1]}</span></span>
            {since && <span className="hud shrink-0 text-[10px] text-signal">Holding {fmtDuration(hoursSince(since, board.at))}</span>}
          </span>
        );
      })}
    </span>
  );
}

function DayTicks({ board }: { board: BoardState }) {
  const end = Date.parse(board.at);
  const start = board.happened.length ? Math.min(end - HOUR, ...board.happened.map((h) => Date.parse(h.event.ts))) : end - HOUR;
  const span = Math.max(1, end - start);
  return (
    <span className="block" aria-hidden>
      <span className="relative block h-10 border-b border-line-strong">
        {board.happened.map((h) => (
          <span key={h.event.id} className="absolute bottom-0 w-[2px] -translate-x-1/2" style={{ left: `${((Date.parse(h.event.ts) - start) / span) * 100}%`, height: 28, background: SOURCE_META[h.item.source].color, boxShadow: `0 0 6px ${SOURCE_META[h.item.source].color}` }} />
        ))}
      </span>
      <span className="mt-1 flex justify-between font-mono text-[10px] text-faint">
        <span>{formatInManagerTz(start).slice(4)}</span>
        <span>{formatInManagerTz(end).slice(4)}</span>
      </span>
    </span>
  );
}

function AiBadge({ live, brief }: { live: boolean | null; brief: BriefState }) {
  const data = brief.status === "ready" ? brief.data : null;
  const isLive = live === true && data?.mode !== "demo";
  const usage = data?.usage;
  const label = live === null ? "Checking AI" : isLive ? "Live AI" : live ? "Live AI, fell back to demo" : "Demo AI";
  return (
    <span
      className={`hud inline-flex h-8 items-center gap-2 rounded-[2px] border px-2.5 text-[10.5px] ${isLive ? "border-ok/50 text-ok" : "border-holo/40 text-holo"}`}
      title={isLive ? "AI text is generated live by Claude" : "No API key on the server: AI text comes from precomputed Claude output"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-ok shadow-[0_0_8px_var(--ok)]" : "bg-holo shadow-[0_0_8px_var(--holo)]"}`} aria-hidden />
      {label}
      {usage ? <span className="font-mono normal-case tracking-normal text-dim">{usage.model} · {(usage.inputTokens + usage.outputTokens).toLocaleString("en-US")} tok</span> : data ? <span className="font-mono normal-case tracking-normal text-faint">precomputed</span> : null}
    </span>
  );
}

function TrackInfo({ b, at, reason, onOpen, locked }: { b?: BoardItem; at: string; reason?: ReasonText; onOpen: (id: string) => void; locked: boolean }) {
  if (!b) return <div className="px-4 py-2 text-[12px] text-faint lg:px-5">No contact selected.</div>;
  const owner = getPerson(b.item.ownerId);
  const ring = b.ring === "now" ? "Act now" : b.ring === "today" ? "Today" : "Watch";
  const holding = b.blocked && b.blockedSinceTs ? fmtDuration(hoursSince(b.blockedSinceTs, at)) : null;
  return (
    <div className="flex items-center gap-x-5 gap-y-1 overflow-hidden px-4 py-2 max-md:flex-wrap lg:px-5" aria-live="polite">
      <span className="hud shrink-0 text-[10.5px] text-holo">{locked ? "Track locked" : "Track info"}</span>
      <button type="button" onClick={() => onOpen(b.item.id)} className="flex min-w-0 items-center gap-2 text-left hover:underline decoration-line-strong underline-offset-4">
        <span className="font-mono text-[13px] font-semibold" style={{ color: b.item.priority === "P0" ? "var(--crit)" : SOURCE_META[b.item.source].color }}>{b.item.key}</span>
        <span className="truncate text-[13px] text-fg">{b.item.title}</span>
      </button>
      <dl className="hud flex shrink-0 items-center gap-4 text-[10px] text-faint max-md:hidden">
        <div className="flex gap-1.5"><dt>Scr</dt><dd className="font-mono text-[12px] text-fg">{b.score.total}</dd></div>
        <div className="flex gap-1.5"><dt>Ring</dt><dd className={b.ring === "now" ? "text-signal" : "text-fg"}>{ring}</dd></div>
        <div className="flex gap-1.5"><dt>Owner</dt><dd className="text-fg">{owner?.name ?? "Unowned"}</dd></div>
        <div className="flex gap-1.5"><dt>Status</dt><dd className="text-fg">{b.status}</dd></div>
        {holding && <div className="flex gap-1.5"><dt>Holding</dt><dd className="font-mono text-[12px] text-signal">{holding}</dd></div>}
      </dl>
      {reason && (
        <span className="hidden min-w-0 flex-1 items-center gap-1.5 truncate text-[12.5px] text-dim xl:flex">
          {reason.ai && <Sparkle />}
          <span className="truncate">{reason.text}</span>
        </span>
      )}
    </div>
  );
}
