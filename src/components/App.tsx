"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardItem, BoardState } from "@/lib/types";
import { DEMO_NOW, WEEK_START } from "@/lib/types";
import type { BriefResponse, ReasonsResponse, StatusResponse } from "@/lib/api-types";
import { deriveBoard, formatInManagerTz } from "@/lib/board";
import { recentEvents, toCompactBoard, toCompactItem } from "@/lib/compact";
import { Radar, RadarLegend } from "./Radar";
import { AttentionPanel, BlockedPanel, HappenedPanel, TopPanel } from "./Panels";
import type { ReasonText } from "./Panels";
import { Brief } from "./Brief";
import { Glance } from "./Glance";
import type { BriefState } from "./Brief";
import { Ask } from "./Ask";
import { Replay } from "./Replay";
import { Drawer } from "./Drawer";
import { Triage } from "./Triage";
import { Kbd, RadarMark } from "./ui";
import { postJson } from "./api";
import type { Decision } from "./triage-store";
import { loadDecisions, saveDecisions } from "./triage-store";

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

export default function App() {
  const [t, setT] = useState(HI);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [triageOpen, setTriageOpen] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [live, setLive] = useState<boolean | null>(null);
  const [brief, setBrief] = useState<BriefState>({ status: "loading" });
  const [aiReasons, setAiReasons] = useState<Record<string, string>>({});
  const [reasonsMode, setReasonsMode] = useState<ReasonsResponse | null>(null);
  const askRef = useRef<HTMLInputElement>(null);

  const board = useMemo(() => boardAt(t), [t]);
  const nowBoard = useMemo(() => boardAt(HI), []);
  const replaying = t < HI;

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
    setDecisions(loadDecisions());
    return () => {
      alive = false;
    };
  }, [nowBoard]);

  const onDecide = useCallback((id: string, d: Decision) => {
    setDecisions((prev) => {
      const nextD = { ...prev, [id]: d };
      saveDecisions(nextD);
      return nextD;
    });
  }, []);

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
  tRef.current = t;
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

  // ---------- keyboard: T triage, / ask
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (triageOpen || selectedId) return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setTriageOpen(true);
      } else if (e.key === "/") {
        e.preventDefault();
        askRef.current?.focus();
        askRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triageOpen, selectedId]);

  const reasonFor = useCallback(
    (b: BoardItem): ReasonText => {
      const ai = !replaying ? aiReasons[b.item.id] : undefined;
      if (ai) return { text: ai, ai: true };
      return { text: b.reasons.slice(0, 2).join("; ") || "No strong signal", ai: false };
    },
    [aiReasons, replaying]
  );

  const attentionIds = useMemo(() => new Set(board.attention.map((b) => b.item.id)), [board]);
  const radarItems = useMemo(() => board.items, [board]);
  const topReason = useCallback((b: BoardItem) => reasonFor(b).text, [reasonFor]);

  const triageQueue = useMemo(() => {
    const seen = new Set<string>();
    const q: { b: BoardItem; why: "attention" | "blocked" }[] = [];
    for (const b of board.attention) if (!seen.has(b.item.id)) { seen.add(b.item.id); q.push({ b, why: "attention" }); }
    for (const p of board.blocked) for (const b of p.items) if (!seen.has(b.item.id)) { seen.add(b.item.id); q.push({ b, why: "blocked" }); }
    return q;
  }, [board]);
  const triagedCount = triageQueue.filter((q) => decisions[q.b.item.id]).length;

  const common = { selectedId, hoverId, onSelect: setSelectedId, onHover: setHoverId, reasonFor, decisions };
  const getAskBoard = useCallback(() => ({ board: toCompactBoard(board), recentEvents: recentEvents(board.at) }), [board]);

  const nowLabel = formatInManagerTz(DEMO_NOW).slice(4);

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      {replaying && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-30 flex justify-center px-4" aria-live="polite">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-signal/50 bg-panel/95 py-1.5 pl-4 pr-1.5 text-[13px] shadow-lg backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-signal" aria-hidden />
            <span>Replaying <span className="font-mono text-signal">{formatInManagerTz(t)}</span> Cologne</span>
            <button type="button" onClick={goNow} className="rounded-full bg-signal px-3 py-1 text-[12.5px] font-semibold text-signal-ink">Back to now</button>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-[1520px] flex-1 px-4 sm:px-6 lg:px-8">
        <Header live={live} briefMode={brief.status === "ready" ? brief.data.mode : null} onTriage={() => setTriageOpen(true)} triaged={triagedCount} total={triageQueue.length} />

        <Glance board={board} />

        <Brief state={brief} onSelect={setSelectedId} replaying={replaying} nowLabel={nowLabel} />

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,500px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:self-start">
            <section aria-labelledby="radar-h" className="rounded-xl border border-line bg-panel/90 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="radar-h" className="text-[15px] font-semibold">Radar</h2>
                <p className="text-[12px] text-faint">{board.items.length} open items, closer to the centre is more urgent</p>
              </div>
              <div className="mt-2">
                <Radar
                  items={radarItems}
                  attentionIds={attentionIds}
                  selectedId={selectedId}
                  hoverId={hoverId}
                  onHover={setHoverId}
                  onSelect={setSelectedId}
                  topReason={topReason}
                  replaying={replaying}
                />
              </div>
              <div className="mt-3 border-t border-line pt-3"><RadarLegend /></div>
            </section>
          </div>

          <div className="grid min-w-0 content-start gap-5 2xl:grid-cols-2">
            <AttentionPanel board={board} c={common} />
            <BlockedPanel board={board} c={common} />
            <TopPanel board={board} c={common} />
            <HappenedPanel board={board} c={common} />
            <div className="2xl:col-span-2">
              <Ask ref={askRef} getBoard={getAskBoard} onSelect={setSelectedId} replaying={replaying} />
            </div>
            {reasonsMode && !replaying && (
              <p className="flex items-center gap-1.5 text-[11.5px] text-faint 2xl:col-span-2">
                Reason lines marked with the spark are written by AI ({reasonsMode.mode === "live" && reasonsMode.usage ? `${reasonsMode.usage.model}, ${(reasonsMode.usage.inputTokens + reasonsMode.usage.outputTokens).toLocaleString("en-US")} tokens` : "precomputed, demo"}). Ranking itself is rule-based and explainable.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 z-20 mt-6 border-t border-line bg-panel/95 backdrop-blur-md">
        <div className="mx-auto max-w-[1520px] px-4 py-2.5 sm:px-6 lg:px-8">
          <Replay t={t} onScrub={scrub} playing={playing} onTogglePlay={togglePlay} onNow={goNow} timeline={nowBoard.timeline} />
        </div>
      </div>

      <footer className="border-t border-line bg-ink">
        <div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-3 px-4 py-4 text-[12.5px] text-faint sm:px-6 lg:px-8">
          <span>Mock data. All people and companies are fictional. Built with Claude.</span>
          <Link href="/docs" className="text-dim underline decoration-line-strong underline-offset-4 hover:text-fg">How AI was used</Link>
        </div>
      </footer>

      {selectedId && (
        <Drawer id={selectedId} board={board} aiReason={!replaying ? aiReasons[selectedId] : undefined} decision={decisions[selectedId]} onClose={() => setSelectedId(null)} onSelect={setSelectedId} />
      )}
      {triageOpen && (
        <Triage queue={triageQueue} at={board.at} decisions={decisions} onDecide={onDecide} onClose={() => setTriageOpen(false)} aiReasons={replaying ? {} : aiReasons} />
      )}
    </div>
  );
}

function Header({ live, briefMode, onTriage, triaged, total }: { live: boolean | null; briefMode: "live" | "demo" | null; onTriage: () => void; triaged: number; total: number }) {
  const isLive = live === true && briefMode !== "demo";
  const label = live === null ? "Checking AI" : isLive ? "Live AI" : live ? "Live AI, fell back to demo" : "Demo AI";
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-5 pt-5 sm:pt-7">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2.5">
          <RadarMark size={30} />
          <span className="wordmark text-[22px] font-bold">WorkRadar</span>
        </div>
        <span aria-hidden className="hidden h-8 w-px bg-line-strong sm:block" />
        <div className="min-w-0 max-sm:basis-full">
          <h1 className="text-[17px] font-semibold leading-tight sm:text-[19px]">Good morning, Marty</h1>
          <p className="text-[13px] text-dim">Tue 13 Oct · <span className="font-mono">09:30</span> Cologne · team in Riyadh, Cairo, Bengaluru</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${isLive ? "border-ok/40 text-ok" : "border-signal/40 text-signal"}`}
          title={isLive ? "AI text is generated live by Claude" : "No API key on the server: AI text comes from precomputed Claude output"}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-ok" : "bg-signal"}`} aria-hidden />
          {label}
        </span>
        <span className="hidden items-center gap-1.5 text-[12px] text-faint md:inline-flex">
          <Kbd>T</Kbd> triage <Kbd>/</Kbd> ask
        </span>
        <button type="button" onClick={onTriage} className="inline-flex h-9 items-center gap-2 rounded-lg bg-signal px-3.5 text-[13.5px] font-semibold text-signal-ink transition-[filter] hover:brightness-110">
          Start triage
          <span className="rounded bg-signal-ink/15 px-1.5 font-mono text-[12px]">{triaged}/{total}</span>
        </button>
      </div>
    </header>
  );
}
