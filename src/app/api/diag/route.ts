// GET /api/diag — checks the live Claude path without exposing the key.
// Returns, per model, whether a tiny call works, its latency, and the API's error type/message if not.
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, getClient, hasKey } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function probe(client: Anthropic, model: string, withTemperature: boolean, maxTokens = 16, system?: string, prompt = "Reply with the word ok.", noThink: boolean | "between_tools" = false) {
  const t0 = Date.now();
  try {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      ...(withTemperature ? { temperature: 0.2 } : {}),
      ...(noThink ? ({ thinking: { type: noThink === true ? "disabled" : "between_tools" } } as Record<string, unknown>) : {}),
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
  out[MODELS.fast] = await probe(client, MODELS.fast, false, 16, undefined, undefined, true);
  out[MODELS.smart] = await probe(client, MODELS.smart, false, 16, undefined, undefined, "between_tools");
  return Response.json(out);
}
