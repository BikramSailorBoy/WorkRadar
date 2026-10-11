import { NextResponse } from "next/server";
import { MODELS, hasKey, liveJson, validateReasons } from "@/lib/ai";
import { REASONS_SYSTEM, reasonsUser } from "@/lib/prompts";
import { bad, readJson, reasonIfKey } from "@/lib/route-util";
import type { ReasonsRequest, ReasonsResponse } from "@/lib/api-types";
import cache from "../../../../data/ai-cache/reasons.json";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<ReasonsRequest>(req);
  if (!body || !Array.isArray(body.items) || body.items.length === 0) return bad("items required");
  const items = body.items.slice(0, 30);
  const valid = new Set(items.map((i) => i.id));
  const key = hasKey();

  let reason = undefined as ReasonsResponse["fallbackReason"];
  if (key) {
    const r = await liveJson(
      { model: MODELS.fast, system: REASONS_SYSTEM, user: reasonsUser(items), maxTokens: 120 + items.length * 50 },
      validateReasons(valid)
    );
    if (r.ok) {
      const res: ReasonsResponse = { mode: "live", usage: r.usage, reasons: r.value };
      return NextResponse.json(res);
    }
    reason = r.reason;
  }
  const c = cache as Record<string, string>;
  const reasons: Record<string, string> = {};
  for (const id of valid) if (c[id]) reasons[id] = c[id];
  const res: ReasonsResponse = { mode: "demo", usage: null, fallbackReason: reasonIfKey(key, reason ?? "error"), reasons };
  return NextResponse.json(res);
}
