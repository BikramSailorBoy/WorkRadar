"use client";
import { memo, useEffect, useMemo, useRef } from "react";
import type { BoardState } from "@/lib/types";
import { DEMO_NOW, WEEK_START } from "@/lib/types";
import { formatInManagerTz } from "@/lib/board";
import { SOURCE_META } from "./ui";

const LO = Date.parse(WEEK_START);
const HI = Date.parse(DEMO_NOW);
const SPAN = HI - LO;
const HOUR = 3_600_000;
const STEP = 10 * 60_000;
const pct = (t: number) => ((t - LO) / SPAN) * 100;

// midnights and 6-hour marks in the manager's timezone (CEST, +02:00, on these dates)
const MIDNIGHTS = ["2026-10-12T00:00:00+02:00", "2026-10-13T00:00:00+02:00"].map(Date.parse);
const DAYS = [
  { label: "Sun 11", from: LO, to: MIDNIGHTS[0] },
  { label: "Mon 12", from: MIDNIGHTS[0], to: MIDNIGHTS[1] },
  { label: "Tue 13", from: MIDNIGHTS[1], to: HI },
];
const SIX_H: number[] = (() => {
  const out: number[] = [];
  for (let t = Math.ceil(LO / HOUR) * HOUR; t <= HI; t += HOUR) {
    const berlinH = (new Date(t).getUTCHours() + 2) % 24;
    if (berlinH % 6 === 0 && berlinH !== 0) out.push(t);
  }
  return out;
})();

interface Props {
  t: number;
  onScrub: (t: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  onNow: () => void;
  timeline: BoardState["timeline"];
}

function ReplayImpl({ t, onScrub, playing, onTogglePlay, onNow, timeline }: Props) {
  const track = useRef<HTMLDivElement>(null);
  // last value sent, so several key presses inside one animation frame accumulate
  const sent = useRef(t);
  const mine = useRef<number[]>([]);
  useEffect(() => {
    // only adopt t when it came from outside (play, Now); our own throttled values may lag behind
    if (!mine.current.includes(t)) sent.current = t;
  }, [t]);
  const send = (v: number) => {
    sent.current = v;
    mine.current = [...mine.current.slice(-40), v];
    onScrub(v);
  };
  const atNow = t >= HI;
  const ticks = useMemo(() => timeline.map((e) => ({ ...e, p: pct(Date.parse(e.ts)) })), [timeline]);

  const fromX = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const raw = LO + f * SPAN;
    return f >= 0.995 ? HI : Math.round(raw / STEP) * STEP;
  };

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? "Pause replay" : "Play the week from Sunday"}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong bg-raised text-fg transition-colors hover:border-signal"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect x="2" y="1.5" width="2.8" height="9" rx="0.8" fill="currentColor" /><rect x="7.2" y="1.5" width="2.8" height="9" rx="0.8" fill="currentColor" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3 1.6v8.8L10.4 6z" fill="currentColor" /></svg>
          )}
        </button>
        <button
          type="button"
          onClick={onNow}
          disabled={atNow && !playing}
          className="h-9 rounded-full border border-line-strong px-3 text-[13px] font-medium text-fg transition-colors hover:border-signal disabled:opacity-40"
        >
          Now
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <div
          ref={track}
          className="relative h-11 cursor-ew-resize touch-none"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            send(fromX(e.clientX));
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) send(fromX(e.clientX));
          }}
        >
          {/* day bands */}
          {DAYS.map((d, i) => (
            <div key={d.label} className="absolute bottom-[14px] top-0 border-l border-line-strong" style={{ left: `${pct(d.from)}%`, width: `${pct(d.to) - pct(d.from)}%`, borderLeftWidth: i === 0 ? 0 : 1 }}>
              <span className="absolute left-1.5 top-0 text-[11px] font-semibold text-dim">{d.label}</span>
            </div>
          ))}
          {/* event ticks */}
          <div className="absolute inset-x-0 bottom-[14px] h-[22px]" aria-hidden>
            <div className="absolute inset-x-0 bottom-0 h-px bg-line-strong" />
            <div className="absolute bottom-0 left-0 h-[2px] bg-signal/70" style={{ width: `${pct(t)}%` }} />
            {ticks.map((e) => (
              <span
                key={e.eventId}
                className="absolute bottom-0 w-[2px] -translate-x-1/2 rounded-t-[1px]"
                style={{ left: `${e.p}%`, height: e.important ? 16 : 7, background: SOURCE_META[e.source].color, opacity: e.p <= pct(t) ? 1 : 0.35 }}
              />
            ))}
          </div>
          {/* 6h labels */}
          {SIX_H.map((h) => (
            <span key={h} className="absolute bottom-0 -translate-x-1/2 font-mono text-[10.5px] text-faint max-sm:hidden" style={{ left: `${pct(h)}%` }}>
              {formatInManagerTz(h).slice(4)}
            </span>
          ))}
          {/* thumb */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Replay time"
            aria-valuemin={LO}
            aria-valuemax={HI}
            aria-valuenow={t}
            aria-valuetext={`${formatInManagerTz(t)} Cologne`}
            onKeyDown={(e) => {
              const d = e.shiftKey ? HOUR : STEP;
              let n: number | null = null;
              const base = sent.current;
              if (e.key === "ArrowLeft" || e.key === "ArrowDown") n = base - d;
              else if (e.key === "ArrowRight" || e.key === "ArrowUp") n = base + d;
              else if (e.key === "Home") n = LO;
              else if (e.key === "End") n = HI;
              if (n !== null) {
                e.preventDefault();
                e.stopPropagation();
                send(Math.min(HI, Math.max(LO, n)));
              }
            }}
            className="absolute bottom-[10px] top-[2px] w-0 focus:outline-none [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-signal"
            style={{ left: `${pct(t)}%` }}
          >
            <span className="absolute bottom-0 top-3 left-[-1px] w-[2px] rounded bg-signal" />
            <span className="absolute bottom-[-3px] left-[-7px] h-[14px] w-[14px] rounded-full border-2 border-ink bg-signal shadow" />
          </div>
        </div>
      </div>

      <div className="hidden w-[108px] shrink-0 text-right md:block">
        <div className="font-mono text-[14px] text-fg">{formatInManagerTz(t)}</div>
        <div className="text-[11.5px] text-faint">{atNow ? "Now, Cologne" : "Replay, Cologne"}</div>
      </div>
    </div>
  );
}

export const Replay = memo(ReplayImpl);
export const REPLAY_LO = LO;
export const REPLAY_HI = HI;
