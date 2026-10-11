// GET /api/diag — checks the live Claude path without exposing the key.
// Returns, per model, whether a tiny call works, its latency, and the API's error type/message if not.
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, getClient, hasKey } from "@/lib/ai";
import { NUDGE_SYSTEM, nudgeUser } from "@/lib/prompts";
import type { CompactItem } from "@/lib/api-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function probe(client: Anthropic, model: string, withTemperature: boolean, maxTokens = 16, system?: string, prompt = "Reply with the word ok.") {
  const t0 = Date.now();
  try {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      ...(withTemperature ? { temperature: 0.2 } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    return { ok: true, latencyMs: Date.now() - t0, stop: res.stop_reason, blocks: res.content.map((b) => b.type), usage: res.usage, text: res.content.map((b) => (b.type === "text" ? b.text : "")).join("").slice(0, 200) };
  } catch (e) {
    const err = e as { status?: number; error?: { error?: { type?: string; message?: string } } };
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      status: err.status ?? null,
      type: err.error?.error?.type ?? null,
      message: (err.error?.error?.message ?? String((e as Error).message ?? "")).slice(0, 300),
    };
  }
}

export async function GET() {
  if (!hasKey()) return Response.json({ keyConfigured: false });
  const client = getClient()!;
  const out: Record<string, unknown> = { keyConfigured: true };
  for (const m of [MODELS.fast, MODELS.smart]) out[m] = await probe(client, m, false);
  out.nudgeProbe = await probe(client, MODELS.fast, false, 120, "You draft a short Slack message (max 45 words) from a manager to a colleague. Output only the message.", "Recipient: Omar. Item PAY-412 is blocked waiting on our reply to the vendor. Write the message now.");
  const item = { id: "jira:PAY-412", key: "PAY-412", title: "KYCly integration: production-tier sandbox keys", type: "ticket", status: "Blocked", owner: "Omar Al-Qahtani", priority: "P1", dueAt: "2026-10-15T09:00:00+03:00", score: { total: 70, urgency: 20, impact: 18, fanout: 14, staleness: 8, escalation: 10 }, ring: "today", blocked: true, blockedReason: "Waiting on our reply to KYCly", reasons: ["Blocked on vendor keys"], signals: [] } as unknown as CompactItem;
  out.realNudge = await probe(client, MODELS.fast, false, 120, NUDGE_SYSTEM, nudgeUser(item, "Omar", "Marty"));
  return Response.json(out);
}
