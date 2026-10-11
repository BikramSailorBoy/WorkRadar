import { NextResponse } from "next/server";
import { MODELS, hasKey, liveText, validateNudge } from "@/lib/ai";
import { NUDGE_SYSTEM, nudgeUser } from "@/lib/prompts";
import { bad, readJson, reasonIfKey } from "@/lib/route-util";
import type { NudgeRequest, NudgeResponse } from "@/lib/api-types";
import cache from "../../../../data/ai-cache/nudges.json";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<NudgeRequest>(req);
  if (!body?.item?.id || !body.ownerName || !body.managerName) return bad("item, ownerName and managerName required");
  const key = hasKey();

  let reason = undefined as NudgeResponse["fallbackReason"];
  if (key) {
    const r = await liveText(
      { model: MODELS.fast, system: NUDGE_SYSTEM, user: nudgeUser(body.item, body.ownerName, body.managerName), maxTokens: 120 },
      validateNudge
    );
    if (r.ok) return NextResponse.json({ mode: "live", usage: r.usage, message: r.value } satisfies NudgeResponse);
    reason = r.reason;
  }
  const c = cache as Record<string, string>;
  const first = body.ownerName.split(" ")[0];
  const message = c[body.item.id] ?? `@${first} how is ${body.item.key} going? Anything I can unblock or take off your plate before the freeze?`;
  const res: NudgeResponse = { mode: "demo", usage: null, fallbackReason: reasonIfKey(key, reason ?? "error"), message };
  return NextResponse.json(res);
}
