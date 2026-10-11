// Server-side Claude helper. Import only from route handlers (never from client components).
// The API key is read from process.env only and is never logged or returned.
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedSignal } from "./types";
import type { FallbackReason, Usage } from "./api-types";

export const MODELS = {
  fast: "claude-haiku-5-5", // extract, reasons, nudge
  smart: "claude-sonnet-5-5", // brief, ask
} as const;

export function hasKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

let cached: Anthropic | null = null;
export function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  if (!cached) cached = new Anthropic({ apiKey: key, maxRetries: 0 });
  return cached;
}

export class AiError extends Error {
  constructor(public reason: FallbackReason, msg: string) {
    super(msg);
  }
}

export interface CallOpts {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs?: number;
}

export async function callClaude(o: CallOpts): Promise<{ text: string; usage: Usage }> {
  const client = getClient();
  if (!client) throw new AiError("no_key", "no api key");
  const timeoutMs = o.timeoutMs ?? 20000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await client.messages.create(
      {
        model: o.model,
        max_tokens: o.maxTokens,
        system: o.system,
        // These are short, structured tasks: no extended thinking. Without this the model can spend the
        // whole max_tokens budget on thinking and return no text (found via /api/diag on the live deploy).
        // Haiku 5.5 accepts {type:"disabled"}; Sonnet 5.5 requires {type:"between_tools"} for the same effect.
        ...({ thinking: o.model === MODELS.smart ? { type: "between_tools" } : { type: "disabled" } } as Record<string, unknown>),
        messages: [{ role: "user", content: o.user }],
      },
      { signal: ctrl.signal }
    );
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return {
      text,
      usage: {
        model: o.model,
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
        latencyMs: Date.now() - t0,
      },
    };
  } catch (e) {
    if (ctrl.signal.aborted) throw new AiError("timeout", `timeout after ${timeoutMs}ms`);
    // Log only the error class/status, never request headers or the key.
    const status = (e as { status?: number })?.status;
    throw new AiError("error", `anthropic error${status ? ` ${status}` : ""}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Parse the first balanced JSON object/array in text (tolerates code fences and prose around it). */
export function extractJson(text: string): unknown | null {
  const s = text.replace(/```(?:json)?/gi, "");
  for (let start = 0; start < s.length; start++) {
    const c = s[start];
    if (c !== "{" && c !== "[") continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

export type LiveResult<T> =
  | { ok: true; value: T; usage: Usage }
  | { ok: false; reason: FallbackReason };

/** Call Claude, parse JSON, validate. Never throws; failures become { ok:false, reason } so routes fall back to the demo cache. */
export async function liveJson<T>(o: CallOpts, validate: (j: unknown) => T | null): Promise<LiveResult<T>> {
  try {
    const { text, usage } = await callClaude(o);
    const value = validate(extractJson(text));
    return value === null ? { ok: false, reason: "invalid_output" } : { ok: true, value, usage };
  } catch (e) {
    return { ok: false, reason: e instanceof AiError ? e.reason : "error" };
  }
}

/** Same as liveJson but for plain-text outputs (nudge). */
export async function liveText<T>(o: CallOpts, validate: (text: string) => T | null): Promise<LiveResult<T>> {
  try {
    const { text, usage } = await callClaude(o);
    const value = validate(text);
    return value === null ? { ok: false, reason: "invalid_output" } : { ok: true, value, usage };
  } catch (e) {
    return { ok: false, reason: e instanceof AiError ? e.reason : "error" };
  }
}

// ---------- tiny validators ----------

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const strArr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);

export function filterCitations(c: unknown, valid: Set<string>): string[] {
  return [...new Set(strArr(c).filter((id) => valid.has(id)))];
}

export function validateBrief(valid: Set<string>) {
  return (j: unknown): { text: string; citations: string[] }[] | null => {
    const arr = isObj(j) ? j.sentences : null;
    if (!Array.isArray(arr)) return null;
    const out = arr
      .filter(isObj)
      .map((s) => ({ text: isStr(s.text) ? s.text.trim() : "", citations: filterCitations(s.citations, valid) }))
      .filter((s) => s.text && s.citations.length > 0) // post-check: drop uncited sentences
      .slice(0, 5);
    return out.length >= 2 ? out : null;
  };
}

export function validateAsk(valid: Set<string>) {
  return (j: unknown): { answer: string; citations: string[]; notInData: boolean } | null => {
    if (!isObj(j) || !isStr(j.answer)) return null;
    const notInData = j.notInData === true;
    const citations = filterCitations(j.citations, valid);
    if (!notInData && citations.length === 0) return null; // an in-data answer must cite something real
    return { answer: j.answer.trim(), citations, notInData };
  };
}

export function validateReasons(valid: Set<string>) {
  return (j: unknown): Record<string, string> | null => {
    if (!isObj(j)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j)) if (valid.has(k) && isStr(v)) out[k] = v.trim();
    return Object.keys(out).length ? out : null;
  };
}

export function validateNudge(text: string): string | null {
  const t = text.trim().replace(/^["`]+|["`]+$/g, "").trim();
  if (!t) return null;
  // Never show a message cut off mid-sentence: trim to the last full sentence if needed.
  const m = t.match(/^[\s\S]*[.!?](?=\s|$)/);
  const whole = /[.!?]$/.test(t) ? t : m ? m[0].trim() : null;
  if (!whole) return null;
  return whole.split(/\s+/).length <= 60 ? whole : null; // prompt asks <= 45; small tolerance, otherwise fall back to cache
}

const KINDS = new Set(["blocker", "escalation", "decision_request", "priority_conflict", "ooo"]);
export function validateExtract(eventIds: Set<string>, itemIds: Set<string>, sourceItemId: string, tsById: Map<string, string>) {
  return (j: unknown): ExtractedSignal[] | null => {
    if (!Array.isArray(j)) return null;
    const out: ExtractedSignal[] = [];
    for (const s of j) {
      if (!isObj(s) || !isStr(s.evidenceEventId) || !eventIds.has(s.evidenceEventId)) continue; // must cite real evidence
      if (!isStr(s.kind) || !KINDS.has(s.kind) || !isStr(s.summary)) continue;
      const ids = strArr(s.itemIds).filter((id) => itemIds.has(id));
      if (!ids.length) continue;
      out.push({
        sourceItemId,
        evidenceEventId: s.evidenceEventId,
        evidenceTs: tsById.get(s.evidenceEventId)!, // server-trusted, not model-supplied
        kind: s.kind as ExtractedSignal["kind"],
        summary: s.summary.trim(),
        personId: isStr(s.personId) ? s.personId : undefined,
        itemIds: ids,
        blockedBy: isStr(s.blockedBy) ? s.blockedBy : undefined,
        claimedDeadline: isStr(s.claimedDeadline) ? s.claimedDeadline : undefined,
      });
    }
    return out; // empty array is a valid answer ("no signals")
  };
}
