// Shared helpers for the AI route handlers.
import { NextResponse } from "next/server";
import type { CompactBoard, FallbackReason } from "./api-types";

export function boardIds(b: CompactBoard): Set<string> {
  const s = new Set<string>(b.items.map((i) => i.id));
  b.happened.forEach((h) => s.add(h.itemId));
  return s;
}

export function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}

export function isBoard(b: unknown): b is CompactBoard {
  const x = b as CompactBoard | undefined;
  return !!x && typeof x.at === "string" && Array.isArray(x.items) && Array.isArray(x.top) && Array.isArray(x.attention)
    && Array.isArray(x.blocked) && Array.isArray(x.happened);
}

/** fallbackReason is only reported when a key was configured but the live call failed. */
export function reasonIfKey(hasKey: boolean, r: FallbackReason): FallbackReason | undefined {
  return hasKey ? r : undefined;
}
