"use client";
import type { ReactNode } from "react";
import type { BoardState } from "@/lib/types";
import { formatInManagerTz } from "@/lib/board";

/** Jump to a panel and flash it so the eye lands in the right place. */
function jump(id: string) {
  const el = document.getElementById(id)?.closest("section");
  if (!el) return;
  el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  el.classList.remove("panel-flash");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("panel-flash");
  window.setTimeout(() => el.classList.remove("panel-flash"), 1400);
}

function Tile({ label, value, detail, color, target }: { label: string; value: ReactNode; detail: ReactNode; color: string; target: string }) {
  return (
    <button
      type="button"
      onClick={() => jump(target)}
      className="group flex min-w-0 items-center gap-3 rounded-lg border border-line bg-panel/90 px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-raised"
    >
      <span className="font-mono text-[22px] font-semibold leading-none tabular-nums" style={{ color }}>{value}</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-fg">{label}</span>
        <span className="block truncate text-[12px] text-dim">{detail}</span>
      </span>
    </button>
  );
}

export function Glance({ board }: { board: BoardState }) {
  const top = board.top[0];
  const latest = board.happened[0];
  const names = board.blocked.map((b) => b.person.name.split(" ")[0]);
  const attn = board.attention[0];
  return (
    <nav aria-label="At a glance" className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Tile label="Needs attention" value={board.attention.length} color="var(--crit)" target="p-attention" detail={attn ? `${attn.item.key} first` : "Nothing urgent"} />
      <Tile label="Who is blocked" value={board.blocked.length} color="var(--crit)" target="p-blocked" detail={names.length ? names.join(" · ") : "Nobody"} />
      <Tile label="Top work" value={board.top.length} color="var(--signal)" target="p-top" detail={top ? `${top.item.key} leads at ${top.score.total}` : "Nothing ranked"} />
      <Tile
        label="What happened"
        value={board.happened.length}
        color="var(--dim)"
        target="p-happened"
        detail={latest ? `${formatInManagerTz(latest.event.ts).slice(4)} ${latest.label}` : "Quiet since 08:00"}
      />
    </nav>
  );
}
