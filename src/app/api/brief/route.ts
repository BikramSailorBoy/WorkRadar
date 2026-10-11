import { NextResponse } from "next/server";
import { MODELS, hasKey, liveJson, validateBrief, filterCitations } from "@/lib/ai";
import { BRIEF_SYSTEM, briefUser } from "@/lib/prompts";
import { bad, boardIds, isBoard, readJson, reasonIfKey } from "@/lib/route-util";
import type { BriefRequest, BriefResponse } from "@/lib/api-types";
import cache from "../../../../data/ai-cache/brief.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<BriefRequest>(req);
  if (!body || !isBoard(body.board)) return bad("board required");
  const valid = boardIds(body.board);
  const key = hasKey();

  let reason = undefined as BriefResponse["fallbackReason"];
  if (key) {
    const r = await liveJson(
      { model: MODELS.smart, system: BRIEF_SYSTEM, user: briefUser(body.board), maxTokens: 700 },
      validateBrief(valid)
    );
    if (r.ok) {
      const res: BriefResponse = { mode: "live", usage: r.usage, at: body.board.at, sentences: r.value };
      return NextResponse.json(res);
    }
    reason = r.reason;
  }
  // Demo: precomputed brief, citations filtered to ids present in this request, uncited sentences dropped.
  const sentences = cache.sentences
    .map((s) => ({ text: s.text, citations: filterCitations(s.citations, valid) }))
    .filter((s) => s.citations.length > 0);
  const res: BriefResponse = { mode: "demo", usage: null, fallbackReason: reasonIfKey(key, reason ?? "error"), at: cache.at, sentences };
  return NextResponse.json(res);
}
