"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { BoardItem, Source } from "@/lib/types";
import { formatInManagerTz } from "@/lib/board";
import { getPerson } from "@/lib/data";
import { ContactShape, SOURCE_META } from "./ui";
import { BANDS, C, QUAD, R, SIZE, toXY } from "./scope";
import type { Placed, Speck } from "./scope";

const PERIOD = 6000; // ms per sweep revolution
const PERSIST = 3.0; // seconds of phosphor afterglow

export interface Trail {
  id: string;
  pts: { x: number; y: number }[]; // oldest first, ends at the current position
  color: string;
}

export interface RadarProps {
  placed: Placed[];
  attentionIds: Set<string>;
  selectedId: string | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  replaying: boolean;
  specks: Speck[];
  suppress: boolean;
  trails: Trail[];
}

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

const COLOR_HEX: Record<Source, string> = { jira: "63,208,255", github: "154,166,255", slack: "46,230,197", email: "227,244,255" };
const isP0 = (b: BoardItem) => b.item.priority === "P0";
const contactColor = (b: BoardItem) => (isP0(b) ? "var(--crit)" : SOURCE_META[b.item.source].color);
const contactRgb = (b: BoardItem) => (isP0(b) ? "255,90,95" : COLOR_HEX[b.item.source]);

// ---------------------------------------------------------------- canvas layer: sweep, afterglow, clutter, trails

function ScopeCanvas({ placed, specks, suppress, trails, reduced }: { placed: Placed[]; specks: Speck[]; suppress: boolean; trails: Trail[]; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useRef({ placed, specks, suppress, trails, reduced });
  data.current = { placed, specks, suppress, trails, reduced };

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let w = 0;
    const resize = () => {
      const px = cv.clientWidth;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = px;
      cv.width = Math.round(px * dpr);
      cv.height = Math.round(px * dpr);
      ctx.setTransform((px * dpr) / SIZE, 0, 0, (px * dpr) / SIZE, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (data.current.reduced) draw(performance.now());
    });
    ro.observe(cv);

    const draw = (now: number) => {
      if (!w) return;
      const d = data.current;
      const sweep = d.reduced ? 45 : ((now / PERIOD) * 360) % 360; // bearing
      ctx.clearRect(0, 0, SIZE, SIZE);

      // afterglow wedge trailing the sweep line
      const a0 = ((sweep - 90) * Math.PI) / 180;
      ctx.save();
      ctx.beginPath();
      ctx.arc(C, C, R, 0, Math.PI * 2);
      ctx.clip();
      const wedge = 70;
      if (typeof ctx.createConicGradient === "function") {
        const g = ctx.createConicGradient(a0 - (wedge * Math.PI) / 180, C, C);
        g.addColorStop(0, "rgba(63,208,255,0)");
        g.addColorStop(wedge / 360 - 0.002, "rgba(63,208,255,0.30)");
        g.addColorStop(wedge / 360, "rgba(63,208,255,0)");
        g.addColorStop(1, "rgba(63,208,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, SIZE, SIZE);
      } else {
        for (let i = 0; i < 28; i++) {
          const s = a0 - ((wedge * (i + 1)) / 28) * (Math.PI / 180);
          ctx.beginPath();
          ctx.moveTo(C, C);
          ctx.arc(C, C, R, s, s + ((wedge / 28) * Math.PI) / 180);
          ctx.fillStyle = `rgba(63,208,255,${0.3 * (1 - i / 28) * 0.4})`;
          ctx.fill();
        }
      }
      // leading edge
      const tip = toXY(sweep, R);
      const lg = ctx.createLinearGradient(C, C, tip.x, tip.y);
      lg.addColorStop(0, "rgba(160,235,255,0.15)");
      lg.addColorStop(1, "rgba(160,235,255,0.95)");
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = "rgba(63,208,255,0.9)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(C, C);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.shadowBlur = 0;

      const since = (bearing: number) => (((sweep - bearing) % 360) + 360) % 360 / 360 * (PERIOD / 1000);
      const glow = (bearing: number) => (d.reduced ? 0.5 : Math.max(0, 1 - since(bearing) / PERSIST) ** 2);

      // sea clutter: tiny desaturated specks, never interactive
      const base = d.suppress ? 0.05 : 0.45;
      for (const s of d.specks) {
        const brg = (Math.atan2(s.x - C, C - s.y) * 180) / Math.PI;
        const a = base + (d.suppress ? 0.04 : 0.35) * glow((brg + 360) % 360);
        ctx.fillStyle = `rgba(150,180,200,${a})`;
        const sz = d.suppress ? 1.6 : 2.2;
        ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
      }

      // track history: fading trail of earlier positions
      for (const tr of d.trails) {
        const n = tr.pts.length;
        for (let i = 1; i < n; i++) {
          const p = tr.pts[i - 1], q = tr.pts[i];
          ctx.strokeStyle = `rgba(${tr.color},${0.25 + 0.6 * (i / n)})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 2]);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        for (let i = 0; i < n - 1; i++) {
          const p = tr.pts[i];
          ctx.fillStyle = `rgba(${tr.color},${0.3 + 0.5 * (i / n)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // phosphor persistence: contacts flare as the sweep passes, then decay over ~3s
      for (const p of d.placed) {
        const g = glow(p.ang);
        const rr = p.r * (2.6 + g * 1.6);
        const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        const rgb = contactRgb(p.b);
        rg.addColorStop(0, `rgba(${rgb},${0.18 + 0.5 * g})`);
        rg.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const onRedraw = () => draw(performance.now());
    cv.addEventListener("redraw", onRedraw);
    let raf = 0;
    const loop = (now: number) => {
      draw(now);
      if (!data.current.reduced) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("redraw", onRedraw);
    };
  }, [reduced]);

  // reduced motion: redraw when the data changes instead of every frame
  useEffect(() => {
    if (!reduced) return;
    const id = requestAnimationFrame(() => ref.current?.dispatchEvent(new Event("redraw")));
    return () => cancelAnimationFrame(id);
  }, [reduced, placed, specks, suppress, trails]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

// ---------------------------------------------------------------- static scope: grid, rings, bearing ring, sector names

const ScopeBase = memo(function ScopeBase() {
  const ticks = [];
  for (let b = 0; b < 360; b += 5) {
    const major = b % 30 === 0;
    const mid = b % 10 === 0;
    const len = major ? 10 : mid ? 6 : 3.5;
    const p = toXY(b, R + 2), q = toXY(b, R + 2 + len);
    ticks.push(<line key={b} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="var(--holo)" strokeOpacity={major ? 0.9 : 0.45} strokeWidth={major ? 1.3 : 1} />);
  }
  const labels = [];
  for (let b = 0; b < 360; b += 30) {
    const p = toXY(b, R + 23);
    labels.push(
      <text key={b} x={p.x} y={p.y + 3.5} textAnchor="middle" className="radar-brg" fontSize="10.5" fontFamily="var(--font-mono)" fill="var(--holo)" fillOpacity="0.8">
        {String(b).padStart(3, "0")}
      </text>
    );
  }
  const arc = (r: number, a0: number, a1: number) => {
    const p = toXY(a0, r), q = toXY(a1, r);
    return `M${p.x} ${p.y} A${r} ${r} 0 0 1 ${q.x} ${q.y}`;
  };
  const arcRev = (r: number, a0: number, a1: number) => {
    const p = toXY(a1, r), q = toXY(a0, r);
    return `M${p.x} ${p.y} A${r} ${r} 0 0 0 ${q.x} ${q.y}`;
  };
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      <defs>
        <pattern id="hex" width="18" height="31.18" patternUnits="userSpaceOnUse" patternTransform="scale(1.1)">
          <path d="M9 0 L18 5.2 L18 15.6 L9 20.8 L0 15.6 L0 5.2 Z M9 20.8 L9 31.18" fill="none" stroke="var(--holo)" strokeOpacity="0.07" strokeWidth="0.8" />
        </pattern>
        <radialGradient id="scope-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0b3352" stopOpacity="0.55" />
          <stop offset="70%" stopColor="#06213a" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#031322" stopOpacity="0.7" />
        </radialGradient>
        <filter id="rim-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {(Object.keys(QUAD) as Source[]).map((s) => {
          const mid = QUAD[s] + 45;
          const bottom = mid > 90 && mid < 270;
          return <path key={s} id={`sec-${s}`} d={bottom ? arcRev(R + 41, mid - 30, mid + 30) : arc(R + 38, mid - 30, mid + 30)} />;
        })}
      </defs>
      <circle cx={C} cy={C} r={R} fill="url(#scope-bg)" />
      <circle cx={C} cy={C} r={R} fill="url(#hex)" />
      {/* spokes every 30 degrees */}
      {Array.from({ length: 12 }, (_, i) => {
        const p = toXY(i * 30, R);
        const major = i % 3 === 0;
        return <line key={i} x1={C} y1={C} x2={p.x} y2={p.y} stroke="var(--holo)" strokeOpacity={major ? 0.32 : 0.1} strokeWidth={major ? 1 : 0.8} />;
      })}
      {/* range rings: act now (amber), today, watch */}
      {[0.18, 0.52, 0.84].map((f) => (
        <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="var(--holo)" strokeOpacity="0.14" strokeDasharray="2 5" />
      ))}
      <circle cx={C} cy={C} r={R * BANDS.now} fill="rgba(255,181,71,0.05)" stroke="var(--signal)" strokeOpacity="0.75" strokeWidth="1.2" />
      <circle cx={C} cy={C} r={R * BANDS.today} fill="none" stroke="var(--holo)" strokeOpacity="0.45" strokeWidth="1" />
      <circle cx={C} cy={C} r={R} fill="none" stroke="var(--holo)" strokeWidth="1.6" filter="url(#rim-glow)" />
      <circle cx={C} cy={C} r={R + 1.6} fill="none" stroke="rgba(255,90,140,0.25)" strokeWidth="0.8" />
      <circle cx={C} cy={C} r={R - 1.6} fill="none" stroke="rgba(120,255,240,0.2)" strokeWidth="0.8" />
      {ticks}
      {labels}
      {/* decorative arc segments, slowly rotating, outside everything that carries data */}
      <g className="deco-spin">
        <path d={arc(R + 52, 20, 70)} fill="none" stroke="var(--holo)" strokeOpacity="0.35" strokeWidth="2" />
        <path d={arc(R + 52, 200, 232)} fill="none" stroke="var(--holo)" strokeOpacity="0.35" strokeWidth="2" />
      </g>
      <g className="deco-spin-rev">
        <path d={arc(R + 56, 110, 160)} fill="none" stroke="var(--holo)" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="1 4" />
        <path d={arc(R + 56, 290, 340)} fill="none" stroke="var(--holo)" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="1 4" />
      </g>
      {/* sector names on the rim */}
      {(Object.keys(QUAD) as Source[]).map((s) => (
        <text key={s} className="radar-src hud" fontSize="11.5" fill={SOURCE_META[s].color} style={{ letterSpacing: "0.32em" }}>
          <textPath href={`#sec-${s}`} startOffset="50%" textAnchor="middle">{SOURCE_META[s].label.toUpperCase()}</textPath>
        </text>
      ))}
      {/* ring names along the west spoke */}
      {[
        { t: "ACT NOW", e: BANDS.now, c: "var(--signal)" },
        { t: "TODAY", e: BANDS.today, c: "var(--holo)" },
        { t: "WATCH", e: 1, c: "var(--dim)" },
      ].map((l) => (
        <text key={l.t} className="radar-ring hud" x={C - R * l.e + 7} y={C - 7} fontSize="9.5" fill={l.c} paintOrder="stroke" stroke="#04182b" strokeWidth="3.5" strokeLinejoin="round" style={{ letterSpacing: "0.16em" }}>
          {l.t}
        </text>
      ))}
      {/* own ship */}
      <path d={`M${C - 6} ${C}h12M${C} ${C - 6}v12`} stroke="var(--holo)" strokeWidth="1.2" />
      <circle cx={C} cy={C} r="2.2" fill="var(--holo)" />
    </svg>
  );
});

// ---------------------------------------------------------------- contacts

function Brackets({ s, color, width = 1.5, len = 5 }: { s: number; color: string; width?: number; len?: number }) {
  const d = `M${-s} ${-s + len}V${-s}H${-s + len} M${s - len} ${-s}H${s}V${-s + len} M${s} ${s - len}V${s}H${s - len} M${-s + len} ${s}H${-s}V${s - len}`;
  return <path d={d} fill="none" stroke={color} strokeWidth={width} />;
}

function tagLines(b: BoardItem) {
  const owner = getPerson(b.item.ownerId)?.name.split(" ")[0].toUpperCase() ?? "UNOWNED";
  const last = b.lastActivityTs ? formatInManagerTz(b.lastActivityTs).slice(4) : "--:--";
  const l1 = `TRK ${b.item.key} · SCR ${b.score.total} · ${owner} · ${last}`;
  const t = b.item.title;
  const l2 = (b.blocked ? "BLOCKED · " : "") + (t.length > 38 ? t.slice(0, 37) + "…" : t);
  return [l1, l2];
}

function DataTag({ p, locked }: { p: Placed; locked: boolean }) {
  const [l1, l2] = tagLines(p.b);
  const wBox = Math.max(l1.length * 6.6, l2.length * 6.3) + 16;
  // tags point outward from the scope centre, flipping only if they would leave the console
  const right = p.x >= C ? p.x + 46 + wBox <= SIZE + 24 : p.x - 46 - wBox < -24;
  const up = p.y > 80;
  const dx = right ? 1 : -1;
  const dy = up ? -1 : 1;
  const s = p.r + 10;
  const x1 = p.x + dx * s, y1 = p.y + dy * s;
  const x2 = x1 + dx * 22, y2 = y1 + dy * 22;
  const x3 = x2 + dx * 12;
  const bx = right ? x3 : x3 - wBox;
  const by = y2 - 19;
  return (
    <g pointerEvents="none" className={locked ? "pop-in" : ""}>
      <polyline points={`${x1},${y1} ${x2},${y2} ${x3},${y2}`} fill="none" stroke="var(--holo)" strokeWidth="1.1" />
      <rect x={bx} y={by} width={wBox} height={38} fill="rgba(3,14,28,0.92)" stroke="var(--holo)" strokeOpacity="0.8" strokeWidth="1" />
      <rect x={bx} y={by} width={3} height={38} fill="var(--holo)" />
      <text x={bx + 10} y={by + 15} fontSize="11" fontFamily="var(--font-mono)" fill="var(--fg)" className="radar-tag">{l1}</text>
      <text x={bx + 10} y={by + 30} fontSize="10.5" fontFamily="var(--font-sans)" fill="var(--dim)" className="radar-tag">{l2}</text>
    </g>
  );
}

function RadarImpl({ placed, attentionIds, selectedId, hoverId, onHover, onSelect, replaying, specks, suppress, trails }: RadarProps) {
  const reduced = useReducedMotion();
  const ordered = useMemo(() => [...placed].sort((a, b) => b.b.score.total - a.b.score.total), [placed]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const tagId = hoverId ?? focusId ?? selectedId;
  const tagP = tagId ? placed.find((p) => p.b.item.id === tagId) : undefined;
  const selP = selectedId ? placed.find((p) => p.b.item.id === selectedId) : undefined;

  return (
    <div className="relative mx-auto aspect-square h-full max-h-full w-full max-w-full select-none">
      <ScopeBase />
      <ScopeCanvas placed={placed} specks={specks} suppress={suppress} trails={trails} reduced={reduced} />
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`absolute inset-0 h-full w-full overflow-visible ${replaying ? "blip-anim" : ""}`}
        role="group"
        aria-label={`Radar with ${placed.length} contacts. Inner ring: act now. Middle: today. Outer: watch. Tab through contacts by score; Enter opens details.`}
      >
        {ordered.map((p) => {
          const { b } = p;
          const id = b.item.id;
          const color = contactColor(b);
          const attn = attentionIds.has(id);
          const tagged = id === tagId;
          const showKey = !tagged && b.ring !== "watch";
          const owner = getPerson(b.item.ownerId)?.name ?? "unowned";
          const right = p.x >= C;
          return (
            <g
              key={id}
              className="blip cursor-pointer"
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
              tabIndex={0}
              role="button"
              aria-label={`${b.item.key}, ${b.item.title}. Score ${b.score.total}. ${b.blocked ? "Blocked. " : ""}${attn ? "Needs attention. " : ""}Owner ${owner}.`}
              aria-pressed={id === selectedId}
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
              <circle r={p.r + 12} fill="transparent" />
              {attn && <Brackets s={p.r + 6} color="var(--signal)" width={1.3} len={4} />}
              {focusId === id && <circle r={p.r + 14} fill="none" stroke="var(--holo)" strokeWidth="1.5" strokeDasharray="3 3" />}
              <g style={{ filter: `drop-shadow(0 0 4px ${color})` }} className={b.blocked ? "contact-blocked" : ""}>
                {b.blocked ? (
                  <ContactShape type={b.item.type} r={p.r} fill="rgba(3,14,28,0.85)" stroke={color} strokeWidth={1.8} strokeDasharray="3 2.4" />
                ) : (
                  <ContactShape type={b.item.type} r={p.r} fill={color} fillOpacity={0.92} stroke="#e8fbff" strokeOpacity={0.55} strokeWidth={0.8} />
                )}
              </g>
              {showKey && (
                <text
                  className="radar-key"
                  x={right ? p.r + 9 : -(p.r + 9)}
                  y={4}
                  textAnchor={right ? "start" : "end"}
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                  fill="var(--dim)"
                  paintOrder="stroke"
                  stroke="#04182b"
                  strokeWidth="3.5"
                  strokeLinejoin="round"
                >
                  {b.item.key}
                </text>
              )}
            </g>
          );
        })}
        {selP && (
          <g transform={`translate(${selP.x} ${selP.y})`} pointerEvents="none">
            <g key={selP.b.item.id} className="lock-box">
              <Brackets s={selP.r + 10} color="#e8fbff" width={1.6} len={6} />
            </g>
          </g>
        )}
        {tagP && <DataTag p={tagP} locked={tagP.b.item.id === selectedId} />}
      </svg>
    </div>
  );
}

export const Radar = memo(RadarImpl);

export function RadarLegend() {
  const item = (shape: string, label: string) => (
    <li className="flex items-center gap-1.5">
      <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden><ContactShape type={shape} r={4.5} fill="var(--holo)" /></svg>
      {label}
    </li>
  );
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1.5 text-[11.5px] text-dim" aria-label="Radar legend" title="Contact size shows impact">
      {item("ticket", "Ticket")}
      {item("pr", "PR")}
      {item("thread", "Thread")}
      {item("email", "Email")}
      <li className="flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden><ContactShape type="ticket" r={4.5} fill="none" stroke="var(--holo)" strokeWidth={1.4} strokeDasharray="2 1.6" /></svg>
        Blocked
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden><Brackets s={5.5} color="var(--signal)" width={1.2} len={3} /><circle r="2.5" fill="var(--holo)" /></svg>
        Attention
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden><ContactShape type="ticket" r={4.5} fill="var(--crit)" /></svg>
        P0
      </li>
    </ul>
  );
}
