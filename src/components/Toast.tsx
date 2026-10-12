"use client";
import { useEffect, useRef, useState } from "react";
import { getItem, getPerson } from "@/lib/data";
import { lastEntry, undo, useActions } from "./actions-store";
import type { ActionKind } from "./actions-store";

const VERB: Record<ActionKind, string> = { assign: "Assigned", done: "Marked done", snooze: "Snoozed", ack: "Acknowledged", nudge: "Nudge drafted for" };

/** Shows the latest action for 6 seconds with an Undo button. */
export function ActionToast() {
  const s = useActions();
  const last = lastEntry(s);
  const seen = useRef<number | null>(null);
  const [show, setShow] = useState<{ seq: number; text: string } | null>(null);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = s.seq; // ignore actions that existed before this page loaded
      return;
    }
    if (last && last.seq > seen.current) {
      seen.current = last.seq;
      const a = s.items[last.itemId]?.[last.action];
      const key = getItem(last.itemId)?.key ?? last.itemId;
      const who = last.action === "assign" && a?.to ? ` to ${getPerson(a.to)?.name.split(" ")[0] ?? a.to}` : "";
      setShow({ seq: last.seq, text: `${VERB[last.action]} ${key}${who}` });
      const id = window.setTimeout(() => setShow((x) => (x?.seq === last.seq ? null : x)), 6000);
      return () => window.clearTimeout(id);
    }
  }, [s, last]);

  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex justify-center px-4" role="status" aria-live="polite">
      <div className="frame brackets pop-in pointer-events-auto flex items-center gap-4 py-2 pl-4 pr-2 text-[13.5px] text-fg">
        <span>{show.text}</span>
        <button
          type="button"
          onClick={() => {
            undo({ seq: show.seq });
            setShow(null);
          }}
          className="hud rounded-[2px] bg-signal px-2.5 py-1 text-[10.5px] text-signal-ink"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
