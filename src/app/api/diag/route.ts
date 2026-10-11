// GET /api/diag — checks the live Claude path without exposing the key.
// Returns, per model, whether a tiny call works, its latency, and the API's error type/message if not.
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, getClient, hasKey } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function probe(client: Anthropic, model: string, withTemperature: boolean) {
  const t0 = Date.now();
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 16,
      ...(withTemperature ? { temperature: 0.2 } : {}),
      messages: [{ role: "user", content: "Reply with the word ok." }],
    });
    return { ok: true, latencyMs: Date.now() - t0, text: res.content.map((b) => (b.type === "text" ? b.text : "")).join("").slice(0, 20) };
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
  for (const m of [MODELS.fast, MODELS.smart]) {
    out[m] = { withTemperature: await probe(client, m, true), withoutTemperature: await probe(client, m, false) };
  }
  return Response.json(out);
}
