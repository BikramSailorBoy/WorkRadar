"use client";
import type { BriefResponse } from "@/lib/api-types";
import { KeyChip } from "./ui";
import { metaLine } from "./api";

export type BriefState = { status: "loading" } | { status: "ready"; data: BriefResponse } | { status: "error"; message: string };

/** Full brief: every sentence with its citation chips. Shown when the brief widget is expanded. */
export function BriefList({ state, onSelect, replaying, nowLabel }: { state: BriefState; onSelect: (id: string) => void; replaying: boolean; nowLabel: string }) {
  return (
    <div aria-live="polite" aria-busy={state.status === "loading"} className="px-4 pb-4">
      {replaying && <p className="mb-3 text-[12.5px] text-signal">The brief reflects {nowLabel} now, not the replay time.</p>}
      {state.status === "loading" && (
        <div className="space-y-4" aria-label="Loading brief">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-3 w-[92%]" />
              <div className="skeleton h-3 w-[84%]" />
              <div className="skeleton h-3 w-[50%]" />
            </div>
          ))}
        </div>
      )}
      {state.status === "error" && (
        <p className="text-[14px] text-dim">The brief could not load ({state.message}). Every widget is computed from rules and still current; reload to try the brief again.</p>
      )}
      {state.status === "ready" && (
        <>
          <ol className="space-y-4">
            {state.data.sentences.slice(0, 5).map((s, i) => (
              <li key={i} className={`border-l-2 pl-3 text-[14.5px] leading-[1.6] text-fg ${i === 0 ? "border-signal" : "border-line-strong"}`} style={{ textWrap: "pretty" }}>
                {s.text}
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {s.citations.map((c) => <KeyChip key={c} id={c} onSelect={onSelect} size="xs" />)}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 font-mono text-[11px] text-faint">{metaLine(state.data)}</p>
        </>
      )}
    </div>
  );
}
