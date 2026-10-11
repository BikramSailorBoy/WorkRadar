import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "How AI was used, WorkRadar" };

async function read(name: string): Promise<string> {
  try {
    return await readFile(path.join(process.cwd(), "docs", name), "utf8");
  } catch {
    return "";
  }
}

/** Minimal Markdown: headings, paragraphs, pipe tables, bullet lists, inline code and bold. */
function inline(s: string): ReactNode[] {
  return s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="rounded bg-raised px-1 font-mono text-[0.92em]">{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return p;
  });
}

function render(md: string): ReactNode[] {
  const lines = md.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl === 1 ? "mt-10 text-[24px] font-semibold" : lvl === 2 ? "mt-8 text-[18px] font-semibold" : "mt-6 text-[15px] font-semibold";
      out.push(lvl === 1 ? <h2 key={i} className={cls}>{inline(h[2])}</h2> : <h3 key={i} className={cls}>{inline(h[2])}</h3>);
      i++;
      continue;
    }
    if (l.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={i} className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] text-left text-[13.5px]">
            <thead className="bg-raised text-dim"><tr>{head.map((c, j) => <th key={j} className="px-3 py-2 font-semibold">{inline(c)}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="px-3 py-2 align-top text-dim">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      out.push(<ul key={i} className="mt-3 list-disc space-y-1 pl-5 text-[14.5px] text-dim">{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||\s*[-*]\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={i} className="mt-3 max-w-[72ch] text-[14.5px] leading-relaxed text-dim">{inline(para.join(" "))}</p>);
  }
  return out;
}

export default async function DocsPage() {
  const [usage, tokens] = await Promise.all([read("ai-usage-log.md"), read("token-log.md")]);
  return (
    <main className="relative z-10 mx-auto max-w-[980px] px-4 py-8 sm:px-6">
      <Link href="/" className="text-[13px] text-dim underline decoration-line-strong underline-offset-4 hover:text-fg">Back to WorkRadar</Link>
      {usage ? render(usage) : <p className="mt-6 text-dim">The AI usage log is not available in this build.</p>}
      {tokens && render(tokens)}
    </main>
  );
}
