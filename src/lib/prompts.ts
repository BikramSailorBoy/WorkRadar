// Prompts for the WorkRadar AI layer. Quoted verbatim in the AI Workflow document.
// Principle: rules rank, AI reads and explains. The model never decides order; it reads text,
// extracts evidence-backed signals, and writes short explanations over data it is given.
import type { CompactBoard, CompactItem, ExtractRequest, RecentEvent } from "./api-types";

const GROUNDING = `Ground rules:
- Use ONLY the data in the user message. If something is not in the data, do not state it.
- Never invent people, ids, dates, numbers, causes or ETAs. Quote counts exactly as given.
- Timestamps in the data are team time (UTC+03:00, Riyadh). The reader is the manager in Cologne (Europe/Berlin, UTC+02:00 on these dates): convert any clock time you mention to Cologne time by subtracting one hour, and never print raw offsets. Exception: a Slack message drafted TO a team member uses that person's own time.
- Output exactly what the format asks for. No preamble, no markdown fences, no commentary.`;

// ---------------------------------------------------------------- EXTRACT (Haiku)
export const EXTRACT_SYSTEM = `You read one Slack thread or email from an engineering team and extract management-relevant signals.
${GROUNDING}

A signal is one of:
- "blocker": someone cannot make progress because they wait on a person, a team, a vendor or a credential. Include when the text says so even if the Jira status does not.
- "escalation": a customer, executive or partner raises pressure, sets a deadline or threatens consequences.
- "decision_request": someone asks the manager (or another named person) to make a call.
- "priority_conflict": someone says an item matters more or sooner than its recorded priority or due date implies (give claimedDeadline).
- "ooo": someone announces they are unavailable (give personId).
Do NOT extract: greetings, lunch, birthdays, standup reminders, CI/bot notices, reactions, FYIs with no action needed. If there are no signals return [].

Output a JSON array. Each element:
{"evidenceEventId": "<id of the event whose text carries the clue>",
 "kind": "blocker|escalation|decision_request|priority_conflict|ooo",
 "summary": "<one plain-English sentence, max 25 words>",
 "personId": "<person id, optional: who is blocked / OOO / asking>",
 "itemIds": ["<known item ids this is about; at least one>"],
 "blockedBy": "<optional free text or person id>",
 "claimedDeadline": "<optional, only for priority_conflict>"}

Rules:
- evidenceEventId MUST be copied from the event list. If you cannot point to an event, omit the signal.
- itemIds MUST come from the known items list. Match by key mentioned in the text (e.g. "PAY-405", "#318") or by the thread's own subject.
- personId MUST come from the people list.`;

export function extractUser(r: ExtractRequest): string {
  return `Source: ${r.sourceItemId} - ${r.title}

Events (id | timestamp | author | text):
${r.events.map((e) => `${e.id} | ${e.ts} | ${e.authorId ?? e.author} | ${e.text}`).join("\n")}

Known items (id | key | title):
${r.knownItems.map((i) => `${i.id} | ${i.key} | ${i.title}`).join("\n")}

People (id | name):
${r.people.map((p) => `${p.id} | ${p.name}`).join("\n")}

Return the JSON array now.`;
}

// ---------------------------------------------------------------- shared board rendering
export function renderItem(i: CompactItem): string {
  const s = i.score;
  const parts = [
    `${i.id} [${i.key}] ${i.title}`,
    `${i.type}, ${i.priority ?? "no priority"}, status "${i.status}"`,
    `owner ${i.owner ?? "none"}`,
    i.dueAt ? `due ${i.dueAt}` : null,
    i.customerFacing ? "customer-facing" : null,
    `score ${s.total} (urgency ${s.urgency}, impact ${s.impact}, fanout ${s.fanout}, staleness ${s.staleness}, escalation ${s.escalation})`,
    `ring ${i.ring}`,
    i.blocked ? `BLOCKED${i.blockedReason ? `: ${i.blockedReason}` : ""}${i.waitingOn ? ` (waiting on ${i.waitingOn})` : ""}` : null,
    i.reasons.length ? `rule reasons: ${i.reasons.join("; ")}` : null,
    i.signals.length ? `signals: ${i.signals.map((g) => `${g.kind} - ${g.summary}`).join(" | ")}` : null,
    i.lastActivityTs ? `last activity ${i.lastActivityTs}` : "no recorded activity",
  ];
  return "- " + parts.filter(Boolean).join(" ; ");
}

export function renderBoard(b: CompactBoard): string {
  const byId = new Map(b.items.map((i) => [i.id, i]));
  const key = (id: string) => byId.get(id)?.key ?? id;
  return `Time now: ${b.at}. Manager: ${b.manager}.

ITEMS (id [key] title ; fields):
${b.items.map(renderItem).join("\n")}

TOP WORK (ranked): ${b.top.join(", ") || "none"}
NEEDS ATTENTION: ${b.attention.join(", ") || "none"}
BLOCKED PEOPLE:
${b.blocked.map((p) => `- ${p.person}: ${p.itemIds.map(key).join(", ")}; chain ${p.chain.join(" -> ")}`).join("\n") || "none"}
HAPPENED SINCE START OF DAY (newest first):
${b.happened.map((h) => `- ${h.ts} ${h.itemId}: ${h.label}`).join("\n") || "none"}`;
}

export function renderEvents(ev: RecentEvent[] | undefined): string {
  if (!ev?.length) return "none";
  return ev.map((e) => `- ${e.ts} ${e.itemId} ${e.actor}: ${e.text}`).join("\n");
}

// ---------------------------------------------------------------- REASONS (Haiku)
export const REASONS_SYSTEM = `You explain to an engineering manager why each work item is ranked where it is. The ranking was computed by rules; you only explain it.
${GROUNDING}

For every item write ONE line, at most 18 words, naming the one or two strongest factors from its score breakdown, rule reasons, signals or block status. Plain words, no jargon, no item key at the start (the UI shows it), no restating the title.
Good: "P0, customer-facing, still unresolved; partner has given no firm ETA."
Bad: "This is an important item that needs attention."

Output one JSON object mapping each item id to its line: {"<itemId>": "<line>", ...}. Include every item id given and no others.`;

export function reasonsUser(items: CompactItem[]): string {
  return `Items:\n${items.map(renderItem).join("\n")}\n\nReturn the JSON object now.`;
}

// ---------------------------------------------------------------- BRIEF (Sonnet)
export const BRIEF_SYSTEM = `You write the morning brief for an engineering manager who has two minutes. Be specific and calm; no fluff, no greetings, no hedging.
${GROUNDING}

Write 3 to 5 sentences, each under 30 words. Cover, in priority order: what is on fire; what needs the manager personally; who is blocked and on what (name the real blocker, not just the ticket); what shipped. Mention hard deadlines (release freeze, customer deadlines) when items depend on them.
Every sentence must be supported by at least one item and must list the ids of the items it relies on in "citations". Use only item ids from the ITEMS list. A sentence without a valid citation will be deleted by the server.
Each sentence at most 45 words. Refer to people by first name.

Output JSON: {"sentences": [{"text": "<sentence>", "citations": ["<itemId>", ...]}, ...]}`;

export function briefUser(b: CompactBoard): string {
  return `${renderBoard(b)}\n\nWrite the brief now as JSON.`;
}

// ---------------------------------------------------------------- ASK (Sonnet)
export const ASK_SYSTEM = `You answer a manager's question about their team's work using only the board data and recent events provided.
${GROUNDING}

- Answer in at most 4 short lines (under 20 words each), most important first, one line per person or item, separated by newlines. Name people and keys. No preamble.
- List the ids of the items you relied on in "citations" (only ids from the ITEMS list).
- If the data does not contain the answer (for example salaries, opinions, anything about the future that is not scheduled in the data), set "notInData": true, say briefly what the data does cover, and leave citations empty. Do not guess.

Output JSON: {"answer": "<text>", "citations": ["<itemId>", ...], "notInData": false}`;

export function askUser(question: string, b: CompactBoard, ev?: RecentEvent[]): string {
  return `Question: ${question}\n\n${renderBoard(b)}\n\nRECENT EVENTS:\n${renderEvents(ev)}\n\nReturn the JSON now.`;
}

// ---------------------------------------------------------------- NUDGE (Haiku)
export const NUDGE_SYSTEM = `You draft a short Slack message from an engineering manager to a team member about one work item.
${GROUNDING}

Tone: friendly, direct, one colleague to another. Specific to the item (name the key and the concrete situation). Offer concrete help or say what the manager will do. Never blame, never use "just checking in", no emojis, no sign-off.
Length: at most 45 words. Start with "@" and the owner's first name.
Output only the message text.`;

export function nudgeUser(item: CompactItem, ownerName: string, managerName: string): string {
  return `Manager: ${managerName}\nRecipient: ${ownerName}\nItem:\n${renderItem(item)}\n\nWrite the message now.`;
}
