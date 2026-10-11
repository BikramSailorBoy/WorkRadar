"use client";
import { forwardRef, useEffect, useRef, useState } from "react";
import type { AskResponse, CompactBoard, RecentEvent } from "@/lib/api-types";
import { KeyChip, Kbd, Sparkle } from "./ui";
import { metaLine, postJson } from "./api";

export const SUGGESTED = [
  "What's at risk before Thursday's freeze?",
  "Who needs me today?",
  "What changed overnight in Bengaluru?",
  "What's the status of the Northstar incident?",
];

type State = { status: "idle" } | { status: "loading"; q: string } | { status: "ready"; q: string; data: AskResponse } | { status: "error"; q: string; message: string };

export const Ask = forwardRef<HTMLInputElement, { getBoard: () => { board: CompactBoard; recentEvents: RecentEvent[] }; onSelect: (id: string) => void; replaying: boolean }>(
  function Ask({ getBoard, onSelect, replaying }, ref) {
    const [q, setQ] = useState("");
    const [state, setState] = useState<State>({ status: "idle" });
    const answerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      // bring the answer fully into view, clear of the replay bar (scroll-padding-bottom on html)
      if (state.status === "ready" || state.status === "error") answerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [state.status]);

    async function ask(question: string) {
      const text = question.trim();
      if (!text) return;
      setQ(text);
      setState({ status: "loading", q: text });
      try {
        const { board, recentEvents } = getBoard();
        const data = await postJson<AskResponse>("/api/ask", { question: text, board, recentEvents });
        setState({ status: "ready", q: text, data });
      } catch (e) {
        setState({ status: "error", q: text, message: e instanceof Error ? e.message : "request failed" });
      }
    }

    return (
      <section aria-labelledby="ask-h" className="rounded-xl border border-line bg-panel/90 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="ask-h" className="flex items-center gap-2 text-[15px] font-semibold"><Sparkle /> Ask the board</h2>
          <span className="hidden items-center gap-1.5 text-[12px] text-faint sm:flex">Press <Kbd>/</Kbd></span>
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
        >
          <label htmlFor="ask-input" className="sr-only">Ask a question about today&apos;s work</label>
          <input
            id="ask-input"
            ref={ref}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask about today's work"
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-ink/60 px-3 text-[14px] text-fg placeholder:text-faint focus:border-signal focus:outline-none"
          />
          <button type="submit" disabled={state.status === "loading" || !q.trim()} className="h-10 shrink-0 rounded-lg bg-signal px-4 text-[14px] font-semibold text-signal-ink transition-opacity disabled:opacity-40">
            Ask
          </button>
        </form>
        <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Suggested questions">
          {SUGGESTED.map((s) => (
            <button key={s} type="button" onClick={() => void ask(s)} className="rounded-full border border-line-strong px-2.5 py-1 text-left text-[12.5px] text-dim transition-colors hover:border-signal hover:text-fg">
              {s}
            </button>
          ))}
        </div>
        {replaying && state.status === "idle" && <p className="mt-3 text-[12.5px] text-faint">Answers use the board at the replay time.</p>}

        <div aria-live="polite" ref={answerRef} className="scroll-mb-28">
          {state.status === "loading" && (
            <div className="mt-4 space-y-2 border-t border-line pt-4" aria-label="Thinking">
              <div className="skeleton h-3.5 w-[95%]" />
              <div className="skeleton h-3.5 w-[88%]" />
              <div className="skeleton h-3.5 w-[60%]" />
            </div>
          )}
          {state.status === "error" && (
            <p className="mt-4 border-t border-line pt-4 text-[13.5px] text-dim">The question did not go through ({state.message}). Try again, or pick a suggested question.</p>
          )}
          {state.status === "ready" && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-[12.5px] text-faint">{state.q}</p>
              {state.data.notInData ? (
                <div className="mt-2 rounded-lg border border-dashed border-line-strong px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-dim">Not in today&apos;s data</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-dim">{state.data.answer}</p>
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-line text-[14.5px] leading-[1.6] text-fg" style={{ textWrap: "pretty" }}>{state.data.answer}</p>
              )}
              {state.data.citations.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1">{state.data.citations.map((c) => <KeyChip key={c} id={c} onSelect={onSelect} size="xs" />)}</div>
              )}
              <p className="mt-2.5 font-mono text-[11px] text-faint">{metaLine(state.data)}</p>
            </div>
          )}
        </div>
      </section>
    );
  }
);
