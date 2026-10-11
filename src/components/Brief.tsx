"use client";
import type { BriefResponse } from "@/lib/api-types";
import { useState } from "react";
import { KeyChip, Sparkle } from "./ui";
import { metaLine } from "./api";

export type BriefState = { status: "loading" } | { status: "ready"; data: BriefResponse } | { status: "error"; message: string };

export function Brief({ state, onSelect, replaying, nowLabel }: { state: BriefState; onSelect: (id: string) => void; replaying: boolean; nowLabel: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-labelledby="brief-h" className="relative rounded-xl border border-line bg-panel/90">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <h2 id="brief-h" className="flex items-center gap-2 text-[15px] font-semibold"><Sparkle /> Morning brief</h2>
          <p className="text-[13px] text-dim">
            {replaying ? <span className="text-signal">Brief reflects {nowLabel} now, not the replay time</span> : "What matters before you open Slack, Jira, GitHub or email"}
          </p>
        </div>
        {state.status === "ready" && <p className="font-mono text-[11px] text-faint">{metaLine(state.data)}</p>}
      </header>

      <div aria-live="polite" aria-busy={state.status === "loading"} className={`px-4 pb-4 pt-3 sm:px-5 transition-opacity ${replaying ? "opacity-55" : ""}`}>
        {state.status === "loading" && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" aria-label="Loading brief">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <div className="skeleton h-3 w-[92%]" />
                <div className="skeleton h-3 w-[84%]" />
                <div className="skeleton h-3 w-[88%]" />
                <div className="skeleton h-3 w-[40%]" />
              </div>
            ))}
          </div>
        )}
        {state.status === "error" && (
          <p className="text-[14px] text-dim">
            The brief could not load ({state.message}). Everything below is computed from rules and still current; reload to try the brief again.
          </p>
        )}
        {state.status === "ready" && (
          <ol className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {state.data.sentences.slice(0, 5).map((s, i) => (
              <li key={i} className={`${!expanded && i >= 3 ? "max-sm:hidden" : ""} border-l-2 pl-3 text-[13.5px] leading-[1.5] text-fg ${i === 0 ? "border-crit" : "border-line-strong"}`} style={{ textWrap: "pretty" }}>
                {s.text}
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {s.citations.map((c) => <KeyChip key={c} id={c} onSelect={onSelect} size="xs" />)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {state.status === "ready" && state.data.sentences.length > 3 && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-3 text-[13px] font-medium text-signal sm:hidden">
            {expanded ? "Show less" : `Show all ${Math.min(5, state.data.sentences.length)}`}
          </button>
        )}
      </div>
    </section>
  );
}
