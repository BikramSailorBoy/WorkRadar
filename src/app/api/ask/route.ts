import { NextResponse } from "next/server";
import { MODELS, hasKey, liveJson, validateAsk, filterCitations } from "@/lib/ai";
import { ASK_SYSTEM, askUser } from "@/lib/prompts";
import { bad, boardIds, isBoard, readJson, reasonIfKey } from "@/lib/route-util";
import type { AskRequest, AskResponse } from "@/lib/api-types";
import cache from "../../../../data/ai-cache/ask.json";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export async function POST(req: Request) {
  const body = await readJson<AskRequest>(req);
  if (!body || typeof body.question !== "string" || !body.question.trim() || !isBoard(body.board)) return bad("question and board required");
  const question = body.question.trim().slice(0, 500);
  const valid = boardIds(body.board);
  const key = hasKey();

  let reason = undefined as AskResponse["fallbackReason"];
  if (key) {
    const r = await liveJson(
      { model: MODELS.smart, system: ASK_SYSTEM, user: askUser(question, body.board, body.recentEvents), maxTokens: 600 },
      validateAsk(valid)
    );
    if (r.ok) {
      const res: AskResponse = { mode: "live", usage: r.usage, ...r.value };
      return NextResponse.json(res);
    }
    reason = r.reason;
  }
  const hit = cache.questions.find((q) => norm(q.q) === norm(question));
  const fb = reasonIfKey(key, reason ?? "error");
  if (hit) {
    const res: AskResponse = { mode: "demo", usage: null, fallbackReason: fb, answer: hit.answer, citations: filterCitations(hit.citations, valid), notInData: hit.notInData };
    return NextResponse.json(res);
  }
  const res: AskResponse = {
    mode: "demo", usage: null, fallbackReason: fb, citations: [], notInData: true,
    answer: "Demo mode can only answer the suggested questions. Set ANTHROPIC_API_KEY on the server to ask free-form questions about the board.",
  };
  return NextResponse.json(res);
}
