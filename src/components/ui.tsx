"use client";
import type { ReactNode } from "react";
import type { ScoreBreakdown, Source } from "@/lib/types";
import { getItem } from "@/lib/data";

export const SOURCE_META: Record<Source, { label: string; color: string }> = {
  jira: { label: "Jira", color: "var(--jira)" },
  github: { label: "GitHub", color: "var(--github)" },
  slack: { label: "Slack", color: "var(--slack)" },
  email: { label: "Email", color: "var(--email)" },
};

export const SOURCE_ORDER: Source[] = ["jira", "github", "slack", "email"];

/** Simple hand-drawn source glyphs (not brand logos). Drawn on a 16x16 grid. */
export function SourceGlyph({ source }: { source: Source }) {
  switch (source) {
    case "jira":
      // ticket with a notch
      return <path d="M2.5 4.5h11v2.2a1.5 1.5 0 0 0 0 2.6v2.2h-11V9.3a1.5 1.5 0 0 0 0-2.6z M6.5 5v6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />;
    case "github":
      // branch: two commits merging
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="4.5" cy="3.5" r="1.6" />
          <circle cx="4.5" cy="12.5" r="1.6" />
          <circle cx="11.5" cy="5.5" r="1.6" />
          <path d="M4.5 5.1v5.8M11.5 7.1c0 3-7 2-7 3.8" />
        </g>
      );
    case "slack":
      // hash
      return <path d="M6 2.5 5 13.5M11 2.5l-1 11M2.8 6h11M2.2 10.5h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />;
    case "email":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
          <rect x="2" y="3.5" width="12" height="9" rx="1.4" />
          <path d="m2.5 4.5 5.5 4.3 5.5-4.3" />
        </g>
      );
  }
}

export function SourceIcon({ source, size = 14, className = "" }: { source: Source; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label={SOURCE_META[source].label} role="img" className={`shrink-0 ${className}`} style={{ color: SOURCE_META[source].color }}>
      <SourceGlyph source={source} />
    </svg>
  );
}

/** Clickable item key, tinted by its source. */
export function KeyChip({ id, onSelect, size = "sm" }: { id: string; onSelect?: (id: string) => void; size?: "xs" | "sm" }) {
  const item = getItem(id);
  if (!item) return null;
  const c = SOURCE_META[item.source].color;
  const cls = `inline-flex items-center gap-1 rounded-[5px] border font-mono leading-none whitespace-nowrap align-middle transition-colors ${size === "xs" ? "px-1.5 py-[3px] text-[11px]" : "px-1.5 py-1 text-[12px]"}`;
  const style = { color: c, borderColor: `color-mix(in oklab, ${c} 38%, transparent)`, background: `color-mix(in oklab, ${c} 9%, transparent)` };
  const label = <span className="max-w-[190px] truncate py-[1px] -my-[1px]">{item.key}</span>;
  if (!onSelect) return <span className={cls} style={style}>{label}</span>;
  return (
    <button type="button" className={`${cls} hover:brightness-125 cursor-pointer`} style={style} onClick={(e) => { e.stopPropagation(); onSelect(id); }} aria-label={`Open ${item.key}: ${item.title}`} title={item.title}>
      {label}
    </button>
  );
}

export function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" className={`inline-block shrink-0 ${className}`} aria-label="Written by AI" role="img">
      <path d="M6 0.8c.4 2.6 1.6 3.8 4.2 4.2v.4c-2.6.4-3.8 1.6-4.2 4.2h-.4C5.2 7 4 5.8 1.4 5.4V5C4 4.6 5.2 3.4 5.6.8z" fill="var(--signal)" />
    </svg>
  );
}

const SEGMENTS: { k: keyof Omit<ScoreBreakdown, "total">; label: string; max: number }[] = [
  { k: "urgency", label: "Urgency", max: 30 },
  { k: "impact", label: "Impact", max: 25 },
  { k: "fanout", label: "Fan-out", max: 20 },
  { k: "staleness", label: "Staleness", max: 15 },
  { k: "escalation", label: "Escalation", max: 10 },
];

/** Five segments sized by each factor's maximum, filled by the item's value. */
export function ScoreBar({ score, showLabels = false }: { score: ScoreBreakdown; showLabels?: boolean }) {
  return (
    <div>
      <div className="flex gap-[3px]" role="img" aria-label={`Score ${score.total} of 100: ${SEGMENTS.map((s) => `${s.label} ${score[s.k]} of ${s.max}`).join(", ")}`}>
        {SEGMENTS.map((s) => (
          <div key={s.k} className="h-2 rounded-[2px] bg-line overflow-hidden" style={{ flexGrow: s.max, flexBasis: 0 }}>
            <div className="h-full rounded-[2px] bg-signal" style={{ width: `${(score[s.k] / s.max) * 100}%` }} />
          </div>
        ))}
      </div>
      {showLabels && (
        <div className="mt-2 grid grid-cols-5 gap-2 text-[11px] text-faint">
          {SEGMENTS.map((s) => (
            <div key={s.k} className="min-w-0">
              <div className="truncate">{s.label}</div>
              <div className="font-mono text-dim">{score[s.k]}<span className="text-faint">/{s.max}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScoreChip({ value }: { value: number }) {
  const hot = value >= 75;
  const mid = value >= 50;
  return (
    <span
      className={`inline-flex h-6 min-w-8 items-center justify-center rounded-[5px] px-1.5 font-mono text-[12px] font-medium tabular-nums ${hot ? "bg-crit text-ink" : mid ? "bg-signal text-signal-ink" : "border border-line-strong text-dim"}`}
      aria-label={`Score ${value}`}
      title="Priority score out of 100"
    >
      {value}
    </span>
  );
}

const AVATAR_HUES = ["var(--jira)", "var(--github)", "var(--slack)", "var(--email)", "var(--signal)"];
export function Avatar({ name, id, size = 32 }: { name: string; id: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = AVATAR_HUES[h % AVATAR_HUES.length];
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.38, color: c, background: `color-mix(in oklab, ${c} 16%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${c} 40%, transparent)` }}
    >
      {initials}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-raised px-1 font-mono text-[11px] text-dim">{children}</kbd>;
}

export function RadarMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--line-strong)" strokeWidth="1.2" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      <g className="mini-sweep">
        <path d="M12 12 L12 1.5 A10.5 10.5 0 0 1 19.4 4.6 Z" fill="var(--signal)" opacity="0.28" />
        <line x1="12" y1="12" x2="19.4" y2="4.6" stroke="var(--signal)" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <circle cx="15.8" cy="8.6" r="1.6" fill="var(--signal)" />
    </svg>
  );
}

export function PanelShell({ title, count, accent, children, hint, id }: { title: string; count: number; accent?: string; children: ReactNode; hint?: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="relative min-w-0 rounded-xl border border-line bg-panel/90 backdrop-blur-[2px]">
      {accent && <div aria-hidden className="absolute inset-x-0 top-0 h-[2px] rounded-t-xl" style={{ background: accent }} />}
      <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-3">
        <h2 id={id} className="flex items-baseline gap-2 text-[15px] font-semibold tracking-[-0.005em]">
          {title}
          <span className="font-mono text-[13px] font-medium" style={{ color: accent ?? "var(--dim)" }}>{count}</span>
        </h2>
        {hint && <div className="text-right text-[12px] text-faint max-sm:hidden">{hint}</div>}
      </header>
      {children}
    </section>
  );
}

export function hoursSince(fromIso: string, toIso: string): number {
  return Math.max(0, (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000);
}

export function fmtDuration(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
