"use client";
import { useEffect, useRef, useState } from "react";
import type { BoardItem } from "@/lib/types";
import type { NudgeResponse } from "@/lib/api-types";
import { DEMO_NOW } from "@/lib/types";
import { getPerson, people } from "@/lib/data";
import { toCompactItem } from "@/lib/compact";
import { SNOOZE_OPTIONS, act, actionLabel, undo, useActions } from "./actions-store";
import type { UserAction } from "./actions-store";
import { metaLine, postJson } from "./api";
import { Sparkle } from "./ui";

const btn = "hud inline-flex h-9 items-center gap-2 rounded-[2px] border px-3 text-[11px] transition-colors";

/** Team members you can assign to (not OOO on the demo clock, not the current owner). */
export function assignees(currentOwner: string | null | undefined) {
  const t = Date.parse(DEMO_NOW);
  return people.filter((p) => p.isTeam && p.id !== currentOwner && !(p.ooo && Date.parse(p.ooo.from) <= t && t <= Date.parse(p.ooo.to)));
}

/** Small popover menu used for Assign and Snooze, keyboard reachable. */
export function Menu({ label, items, onPick, onClose }: { label: string; items: { id: string; label: string; hint?: string }[]; onPick: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={(e) => {
        const list = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          onClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          list[(i + 1) % list.length]?.focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          list[(i - 1 + list.length) % list.length]?.focus();
        } else if (/^[1-9]$/.test(e.key) && list[Number(e.key) - 1]) {
          e.preventDefault();
          list[Number(e.key) - 1].click();
        }
      }}
      className="pop-in absolute z-50 mt-1 min-w-[220px] border border-holo/50 bg-[#061528] p-1 shadow-[0_12px_40px_-10px_rgba(0,0,0,0.8),0_0_18px_rgba(63,208,255,0.15)]"
    >
      {items.map((it, i) => (
        <button
          key={it.id}
          role="menuitem"
          type="button"
          onClick={() => {
            onPick(it.id);
            onClose();
          }}
          className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] text-fg hover:bg-raised focus:bg-raised focus:outline-none"
        >
          <span className="w-4 font-mono text-[11px] text-faint">{i + 1}</span>
          <span className="flex-1">{it.label}</span>
          {it.hint && <span className="truncate text-[11.5px] text-faint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** Assign · Mark done · Snooze · (Nudge) · Undo for one item. Shared by drawer, detail page and triage. */
export function ActionBar({ b, itemId, ownerId, withNudge = true, compact = false }: { b?: BoardItem; itemId: string; ownerId: string | null; withNudge?: boolean; compact?: boolean }) {
  const s = useActions();
  const a = s.items[itemId];
  const [menu, setMenu] = useState<"assign" | "snooze" | null>(null);
  const [nudge, setNudge] = useState<{ status: "loading" } | { status: "ready"; text: string; meta: NudgeResponse } | { status: "error" } | null>(null);
  const [copied, setCopied] = useState(false);
  const effectiveOwner = a?.assign?.to ?? ownerId;
  const hasActions = !!a && Object.keys(a).length > 0;

  async function draftNudge() {
    if (!b) return;
    setNudge({ status: "loading" });
    try {
      const owner = getPerson(effectiveOwner);
      const r = await postJson<NudgeResponse>("/api/nudge", { item: toCompactItem(b), ownerName: owner?.name ?? "team", managerName: "Marty" });
      setNudge({ status: "ready", text: r.message, meta: r });
      act(itemId, "nudge", { message: r.message });
    } catch {
      setNudge({ status: "error" });
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Actions">
        <div className="relative">
          <button type="button" aria-haspopup="menu" aria-expanded={menu === "assign"} onClick={() => setMenu(menu === "assign" ? null : "assign")} className={`${btn} border-holo/60 text-holo hover:border-holo hover:shadow-[0_0_12px_rgba(63,208,255,0.3)]`}>
            Assign
          </button>
          {menu === "assign" && (
            <Menu
              label="Assign to"
              items={assignees(effectiveOwner).map((p) => ({ id: p.id, label: p.name, hint: p.role }))}
              onPick={(id) => act(itemId, "assign", { to: id })}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
        <button type="button" onClick={() => act(itemId, "done")} disabled={!!a?.done} className={`${btn} border-ok/60 text-ok hover:border-ok disabled:opacity-40`}>
          Mark done
        </button>
        <div className="relative">
          <button type="button" aria-haspopup="menu" aria-expanded={menu === "snooze"} onClick={() => setMenu(menu === "snooze" ? null : "snooze")} className={`${btn} border-line-strong text-fg hover:border-holo`}>
            Snooze
          </button>
          {menu === "snooze" && (
            <Menu label="Snooze until" items={SNOOZE_OPTIONS.map((o) => ({ id: o.id, label: o.label }))} onPick={(id) => act(itemId, "snooze", { until: SNOOZE_OPTIONS.find((o) => o.id === id)!.until })} onClose={() => setMenu(null)} />
          )}
        </div>
        {withNudge && b && (
          <button type="button" onClick={() => void draftNudge()} className={`${btn} border-line-strong text-fg hover:border-holo`}>
            <Sparkle /> Nudge
          </button>
        )}
        {hasActions && (
          <button type="button" onClick={() => undo({ itemId })} className={`${btn} border-signal/60 text-signal hover:border-signal`}>
            Undo
          </button>
        )}
      </div>
      {hasActions && !compact && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Your actions on this item">
          {Object.values(a!).map((x) => x && <ActionTag key={x.action} a={x} />)}
        </ul>
      )}
      {nudge && (
        <div className="mt-3">
          {nudge.status === "loading" && <div className="space-y-2"><div className="skeleton h-3 w-[90%]" /><div className="skeleton h-3 w-[70%]" /></div>}
          {nudge.status === "error" && <p className="text-[13px] text-crit">The draft did not come back. Try Nudge again.</p>}
          {nudge.status === "ready" && (
            <div>
              <label htmlFor={`nudge-${itemId}`} className="flex items-center gap-1.5 text-[12.5px] text-dim"><Sparkle /> Drafted nudge, edit before sending</label>
              <textarea id={`nudge-${itemId}`} defaultValue={nudge.text} rows={3} className="mt-1.5 w-full resize-y rounded-[2px] border border-line-strong bg-ink/70 p-2.5 text-[14px] leading-relaxed text-fg focus:border-holo focus:outline-none" />
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-faint">{metaLine(nudge.meta)}</span>
                <button
                  type="button"
                  onClick={async () => {
                    const v = (document.getElementById(`nudge-${itemId}`) as HTMLTextAreaElement | null)?.value ?? nudge.text;
                    try {
                      await navigator.clipboard.writeText(v);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                  className={`${btn} h-8 border-line-strong text-fg hover:border-holo`}
                >
                  {copied ? "Copied" : "Copy message"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ActionTag({ a }: { a: UserAction }) {
  const tone = a.action === "done" ? "border-ok/50 text-ok" : a.action === "snooze" ? "border-line-strong text-dim" : "border-holo/50 text-holo";
  return (
    <li className={`inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-[2px] text-[11.5px] ${tone}`}>
      {actionLabel(a)}
      {a.action === "assign" && <span className="text-faint"> by you</span>}
    </li>
  );
}
