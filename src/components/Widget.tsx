"use client";
import type { ReactNode } from "react";

export type WidgetId = "attention" | "blocked" | "brief" | "top" | "happened" | "ask";

interface Props {
  id: WidgetId;
  side: "left" | "right";
  sector: string; // HUD label, e.g. "Who is blocked"
  count?: number | string;
  countColor?: string;
  hot?: boolean;
  summary: ReactNode;
  visual?: ReactNode;
  open: boolean;
  onToggle: (id: WidgetId) => void;
  title: string; // heading inside the expanded view
  hint?: string;
  children: ReactNode; // expanded content
}

/** Collapsed: a compact console tile. Expanded: on desktop a glass overlay anchored beside the radar,
 *  on mobile the content grows in place under the tile. Content stays mounted so state survives. */
export function Widget({ id, side, sector, count, countColor, hot, summary, visual, open, onToggle, title, hint, children }: Props) {
  const panelId = `w-${id}`;
  return (
    <div data-widget={id} className="min-h-0 lg:flex-1 lg:basis-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle(id)}
        className={`frame brackets group flex w-full flex-col p-3.5 lg:h-full text-left transition-[filter] hover:brightness-125 ${hot ? "frame-hot" : ""} ${open ? "brightness-125" : ""}`}
      >
        <span className="scanline flex items-center justify-between gap-2">
          <span className="hud truncate text-[10.5px] text-holo/90" title={sector}>
            {sector}
          </span>
          <span aria-hidden className={`hud text-[10px] transition-transform ${open ? "text-signal" : "text-faint"}`}>
            {open ? "▣" : side === "left" ? "▸" : "◂"}
          </span>
        </span>
        <span className="mt-2 flex min-h-0 items-start gap-3">
          {count !== undefined && (
            <span className="font-display text-[34px] font-semibold leading-none tabular-nums glow-text" style={{ color: countColor ?? "var(--holo)", textShadow: `0 0 14px ${countColor ?? "var(--holo)"}` }}>
              {count}
            </span>
          )}
          <span className="min-w-0 flex-1 text-[13px] leading-snug text-fg">{summary}</span>
        </span>
        {visual && <span className="block min-h-0 pt-3 lg:my-auto">{visual}</span>}
      </button>

      <section
        id={panelId}
        aria-labelledby={`${panelId}-h`}
        hidden={!open}
        style={{ ["--origin" as string]: side === "left" ? "left center" : "right center" }}
        className={`pop-in z-30 mt-2 lg:absolute lg:inset-y-0 lg:mt-0 lg:w-[min(560px,calc(100%-640px))] ${side === "left" ? "lg:left-[316px]" : "lg:right-[316px]"}`}
      >
        <div className={`frame brackets flex h-full max-h-full flex-col ${hot ? "frame-hot" : ""}`} style={{ background: "linear-gradient(180deg, rgba(8,30,56,0.94), rgba(4,14,30,0.94))" }}>
          <header className="scanline flex items-baseline justify-between gap-3 px-4 pb-3 pt-4">
            <h2 id={`${panelId}-h`} className="flex items-baseline gap-2.5">
              <span className="hud text-[14px] text-fg">{title}</span>
              {count !== undefined && <span className="font-mono text-[14px] font-semibold" style={{ color: countColor ?? "var(--holo)" }}>{count}</span>}
            </h2>
            <span className="flex items-center gap-3">
              {hint && <span className="hidden text-[12px] text-faint xl:inline">{hint}</span>}
              <button type="button" onClick={() => onToggle(id)} aria-label={`Close ${title}`} className="hud flex h-7 items-center rounded-[2px] border border-line-strong px-2 text-[10px] text-dim hover:border-holo hover:text-fg">
                Esc
              </button>
            </span>
          </header>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto border-t border-line pt-1 max-lg:max-h-[70vh]">{children}</div>
        </div>
      </section>
    </div>
  );
}
