"use client";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { WorkItem } from "@/lib/types";
import { eventsByItem, getPerson, items } from "@/lib/data";
import { SOURCE_META, SourceIcon } from "./ui";
import { useActions } from "./actions-store";
import { itemHref } from "./slug";

interface Doc {
  item: WorkItem;
  key: string;
  title: string;
  people: string; // owner, sender, reviewers (names and roles)
  meta: string; // status, source, channel, type, priority
  events: string[];
}

const DOCS: Doc[] = items.map((item) => {
  const names = [item.ownerId, item.from, ...(item.reviewers ?? [])]
    .map((id) => getPerson(id))
    .filter(Boolean)
    .map((p) => `${p!.name} ${p!.role}`);
  return {
    item,
    key: item.key.toLowerCase(),
    title: item.title.toLowerCase(),
    people: names.join(" ").toLowerCase(),
    meta: [item.status, SOURCE_META[item.source].label, item.channel ?? "", item.type, item.priority ?? "", item.customerFacing ? "customer-facing" : ""].join(" ").toLowerCase(),
    events: (eventsByItem.get(item.id) ?? []).map((e) => `${getPerson(e.actorId)?.name ?? ""}: ${e.text ?? ""}`),
  };
});

export interface Hit {
  item: WorkItem;
  score: number;
  snippet: string;
}

export function search(q: string, assignee: (id: string) => string | undefined): Hit[] {
  const tokens = q.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return [];
  const hits: Hit[] = [];
  for (const d of DOCS) {
    const assigned = (assignee(d.item.id) ?? "").toLowerCase();
    const evLower = d.events.map((e) => e.toLowerCase());
    let score = 0;
    let ok = true;
    let snippet = "";
    for (const t of tokens) {
      let s = 0;
      if (d.key === t) s += 30;
      else if (d.key.includes(t)) s += 18;
      if (d.title.includes(t)) s += 8;
      if (d.people.includes(t) || assigned.includes(t)) s += 8;
      if (d.meta.includes(t)) s += 3;
      const evHit = evLower.findIndex((e) => e.includes(t));
      if (evHit >= 0) {
        s += 1 + Math.min(3, evLower.filter((e) => e.includes(t)).length);
        if (!snippet && !d.title.includes(t) && !d.key.includes(t)) snippet = d.events[evHit];
      }
      if (!s) {
        ok = false;
        break;
      }
      if (!snippet && !d.title.includes(t) && !d.key.includes(t)) {
        if (d.people.includes(t) || assigned.includes(t)) snippet = `People: ${[d.people, assigned].filter(Boolean).join(", ")}`;
        else if (d.meta.includes(t)) snippet = `${d.item.status}, ${SOURCE_META[d.item.source].label}${d.item.channel ? " " + d.item.channel : ""}`;
      }
      score += s;
    }
    if (!ok) continue;
    if (!snippet) snippet = d.events.find((e) => tokens.some((t) => e.toLowerCase().includes(t))) ?? d.events[d.events.length - 1] ?? "";
    hits.push({ item: d.item, score, snippet: window1(snippet, tokens) });
  }
  return hits.sort((a, b) => b.score - a.score || a.item.key.localeCompare(b.item.key));
}

function window1(text: string, tokens: string[]): string {
  const lower = text.toLowerCase();
  const i = Math.min(...tokens.map((t) => lower.indexOf(t)).filter((x) => x >= 0), Infinity);
  if (!Number.isFinite(i) || text.length <= 110) return text;
  const start = Math.max(0, i - 40);
  return (start > 0 ? "…" : "") + text.slice(start, start + 110) + (start + 110 < text.length ? "…" : "");
}

export function Highlight({ text, q }: { text: string; q: string }) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!tokens.length) return <>{text}</>;
  const re = new RegExp(`(${tokens.join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[1px] bg-holo/25 px-[1px] text-fg">{part}</mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

export function SearchBox() {
  const router = useRouter();
  const s = useActions();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => (q.trim() ? search(q, (id) => getPerson(s.items[id]?.assign?.to)?.name) : []), [q, s]);
  const shown = all ? hits : hits.slice(0, 8);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);

  const go = (id: string) => {
    setOpen(false);
    router.push(itemHref(id));
  };

  return (
    <div ref={wrap} className="relative w-full lg:w-[360px] xl:w-[420px]" data-keep-widget>
      <label htmlFor="search-input" className="sr-only">Search</label>
      <div className={`flex h-8 items-center gap-2 rounded-[2px] border bg-ink/70 px-2.5 ${open && q ? "border-holo shadow-[0_0_14px_rgba(63,208,255,0.3)]" : "border-line-strong"}`}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-holo">
          <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="m10.6 10.6 3.6 3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          id="search-input"
          ref={input}
          role="combobox"
          aria-expanded={open && !!q}
          aria-controls="search-results"
          aria-activedescendant={open && shown[active] ? `sr-${active}` : undefined}
          autoComplete="off"
          value={q}
          placeholder="Search"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
            setAll(false);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(shown.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && shown[active]) {
              e.preventDefault();
              go(shown[active].item.id);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              input.current?.blur();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-faint focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded-[2px] border border-line-strong px-1 font-mono text-[10.5px] text-faint sm:inline">⌘K</kbd>
      </div>

      {open && q.trim() && (
        <div className="pop-in absolute right-0 z-50 mt-1.5 w-[min(560px,calc(100vw-32px))] border border-holo/50 bg-[#05142a]/97 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9),0_0_24px_rgba(63,208,255,0.15)] backdrop-blur-md">
          <div className="hud flex items-center justify-between border-b border-line px-3 py-2 text-[10px] text-faint">
            <span>{hits.length} {hits.length === 1 ? "result" : "results"} for <span className="normal-case tracking-normal text-holo">&ldquo;{q.trim()}&rdquo;</span></span>
            <span>↑↓ Enter · Esc</span>
          </div>
          {hits.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-dim">Nothing matches. Try a key like PAY-412, a person, or a word from a message.</p>
          ) : (
            <ul id="search-results" role="listbox" aria-label="Search results" className="scrollbar-thin max-h-[60vh] overflow-y-auto py-1">
              {shown.map((h, i) => {
                const owner = getPerson(s.items[h.item.id]?.assign?.to ?? h.item.ownerId)?.name ?? "Unowned";
                return (
                  <li key={h.item.id} id={`sr-${i}`} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(h.item.id)}
                      className={`flex w-full gap-2.5 px-3 py-2 text-left ${i === active ? "bg-raised" : ""}`}
                    >
                      <SourceIcon source={h.item.source} className="mt-[3px]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="font-mono text-[12.5px]" style={{ color: SOURCE_META[h.item.source].color }}><Highlight text={h.item.key} q={q} /></span>
                          <span className="truncate text-[13.5px] text-fg"><Highlight text={h.item.title} q={q} /></span>
                        </span>
                        <span className="block truncate text-[12px] text-faint">{owner} · {h.item.status}</span>
                        {h.snippet && <span className="mt-0.5 block line-clamp-2 text-[12.5px] leading-snug text-dim"><Highlight text={h.snippet} q={q} /></span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hits.length > 8 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="hud w-full border-t border-line px-3 py-2 text-left text-[10.5px] text-holo hover:bg-raised">
              {all ? "Show top 8" : `Show all ${hits.length} results`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
