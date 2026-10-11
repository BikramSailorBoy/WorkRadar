import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { MODELS, hasKey, liveJson, validateExtract } from "@/lib/ai";
import { EXTRACT_SYSTEM, extractUser } from "@/lib/prompts";
import { bad, readJson, reasonIfKey } from "@/lib/route-util";
import type { ExtractRequest, ExtractResponse } from "@/lib/api-types";
import type { ExtractedSignal } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function cached(sourceItemId: string): Promise<ExtractedSignal[]> {
  try {
    const raw = await readFile(path.join(process.cwd(), "data/ai-cache/extract.json"), "utf8");
    const all = JSON.parse(raw);
    const list: ExtractedSignal[] = Array.isArray(all) ? all : Array.isArray(all?.signals) ? all.signals : [];
    return list.filter((s) => s.sourceItemId === sourceItemId);
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  const body = await readJson<ExtractRequest>(req);
  if (!body || typeof body.sourceItemId !== "string" || !Array.isArray(body.events) || !Array.isArray(body.knownItems)) {
    return bad("sourceItemId, events and knownItems required");
  }
  const key = hasKey();
  let reason = undefined as ExtractResponse["fallbackReason"];
  if (key) {
    const events = body.events.slice(0, 40);
    const r = await liveJson(
      { model: MODELS.fast, system: EXTRACT_SYSTEM, user: extractUser({ ...body, events }), maxTokens: 900 },
      validateExtract(
        new Set(events.map((e) => e.id)),
        new Set(body.knownItems.map((i) => i.id)),
        body.sourceItemId,
        new Map(events.map((e) => [e.id, e.ts]))
      )
    );
    if (r.ok) return NextResponse.json({ mode: "live", usage: r.usage, signals: r.value } satisfies ExtractResponse);
    reason = r.reason;
  }
  const res: ExtractResponse = { mode: "demo", usage: null, fallbackReason: reasonIfKey(key, reason ?? "error"), signals: await cached(body.sourceItemId) };
  return NextResponse.json(res);
}
