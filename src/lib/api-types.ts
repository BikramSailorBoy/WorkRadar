// Request/response contracts for the WorkRadar AI routes.
// The client sends compact board data it already has; the server never re-reads the mock data for live calls.
import type { ExtractedSignal, Ring } from "./types";

export type AiMode = "live" | "demo";
export type FallbackReason = "no_key" | "timeout" | "error" | "invalid_output";

/** Token + latency accounting for one live call. null in demo mode. */
export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** Fields present on every AI response. */
export interface AiMeta {
  mode: AiMode;
  usage: Usage | null;
  /** Only set when mode === "demo" because a live attempt failed (not when no key). */
  fallbackReason?: FallbackReason;
}

// ---------- compact board (what the client sends) ----------

export interface CompactItem {
  id: string; // WorkItem.id, e.g. "jira:PAY-412"
  key: string; // display key
  title: string;
  type: string; // ticket | incident | pr | thread | email
  status: string;
  owner: string | null; // display name
  ownerId?: string | null;
  priority: string | null;
  dueAt: string | null;
  customerFacing?: boolean;
  score: { total: number; urgency: number; impact: number; fanout: number; staleness: number; escalation: number };
  ring: Ring;
  blocked: boolean;
  blockedReason?: string;
  waitingOn?: string;
  reasons: string[]; // rule-based fragments
  signals: { kind: string; summary: string }[];
  lastActivityTs: string | null;
}

export interface CompactBoard {
  at: string; // ISO time t
  manager: string; // display name, e.g. "Marty"
  /** Union of every item referenced below. Citations are validated against these ids. */
  items: CompactItem[];
  top: string[]; // item ids, ranked
  attention: string[];
  blocked: { person: string; itemIds: string[]; chain: string[] }[];
  happened: { ts: string; itemId: string; label: string }[];
}

export interface RecentEvent {
  ts: string;
  itemId: string;
  actor: string; // display name
  text: string;
}

// ---------- routes ----------

export interface BriefRequest { board: CompactBoard }
export interface BriefResponse extends AiMeta {
  at: string;
  sentences: { text: string; citations: string[] }[];
}

export interface AskRequest { question: string; board: CompactBoard; recentEvents?: RecentEvent[] }
export interface AskResponse extends AiMeta {
  answer: string;
  citations: string[];
  notInData: boolean;
}

export interface ReasonsRequest { items: CompactItem[] }
export interface ReasonsResponse extends AiMeta {
  reasons: Record<string, string>; // itemId -> one-line reason; items missing from the map keep rule-based reasons
}

export interface NudgeRequest {
  item: CompactItem;
  ownerName: string;
  managerName: string;
}
export interface NudgeResponse extends AiMeta { message: string }

export interface ExtractRequest {
  sourceItemId: string; // slack thread or email item id
  title: string;
  events: { id: string; ts: string; author: string; authorId?: string; text: string }[];
  knownItems: { id: string; key: string; title: string }[];
  people: { id: string; name: string }[];
}
export interface ExtractResponse extends AiMeta { signals: ExtractedSignal[] }

export interface StatusResponse { live: boolean }
