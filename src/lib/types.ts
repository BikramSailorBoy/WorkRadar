// Shared contract for WorkRadar. Agents building logic, AI routes and UI all code against this file.

export type Source = "jira" | "github" | "slack" | "email";

export interface Person {
  id: string;
  name: string;
  role: string;
  squad: "payments" | "onboarding" | null;
  location: string;
  tz: string;
  isTeam: boolean;
  ooo?: { from: string; to: string };
}

export interface WorkItem {
  id: string; // "jira:PAY-412", "gh:pr-318", "slack:th-0003", "email:em-0002"
  source: Source;
  type: "ticket" | "incident" | "pr" | "thread" | "email";
  key: string; // display key: "PAY-412", "PR #318"
  title: string;
  ownerId: string | null;
  squad: "payments" | "onboarding" | null;
  priority: "P0" | "P1" | "P2" | "P3" | null;
  status: string; // current status at the demo clock
  dueAt: string | null;
  customerFacing: boolean;
  links: string[];
  createdAt: string;
  channel?: string;
  from?: string;
  reviewers?: string[];
}

export type EventKind =
  | "created" | "status_changed" | "comment" | "review_requested" | "review_approved"
  | "changes_requested" | "commit" | "merged" | "deployed" | "message" | "email_received"
  | "email_sent" | "incident_opened" | "incident_update" | "reaction" | "ci_passed" | "ci_failed" | "bot";

export interface WorkEvent {
  id: string;
  ts: string;
  itemId: string;
  actorId: string;
  kind: EventKind;
  from?: string;
  to?: string;
  text?: string;
}

/** Output of AI extraction (Haiku) for one Slack thread or email. Precomputed in data/ai-cache/extract.json. */
export interface ExtractedSignal {
  sourceItemId: string; // the slack thread / email the signal was read from
  evidenceEventId: string; // event whose text carries the clue
  evidenceTs: string; // signal only exists for replay time >= this
  kind: "blocker" | "escalation" | "decision_request" | "priority_conflict" | "ooo";
  summary: string; // one short sentence, plain English
  personId?: string; // who is blocked / who is OOO / who asks
  itemIds: string[]; // work items this signal is about
  blockedBy?: string; // free text: "infra staging DB credentials", or a person id
  claimedDeadline?: string; // for priority_conflict
}

export type Panel = "top" | "attention" | "blocked" | "happened";
export type Ring = "now" | "today" | "watch";

export interface ScoreBreakdown {
  urgency: number; // 0-30
  impact: number; // 0-25
  fanout: number; // 0-20
  staleness: number; // 0-15
  escalation: number; // 0-10
  total: number; // 0-100
}

export interface BoardItem {
  item: WorkItem;
  status: string; // status as of time t
  score: ScoreBreakdown;
  ring: Ring;
  blocked: boolean;
  blockedReason?: string;
  blockedSinceTs?: string;
  waitingOn?: string; // person id or free text
  signals: ExtractedSignal[]; // signals applying to this item at t
  lastActivityTs: string | null;
  changedRecently: boolean; // any meaningful event in the hour before t
  reasons: string[]; // short rule-based reason fragments, e.g. "P0 incident", "due before freeze"
}

export interface HappenedEntry {
  event: WorkEvent;
  item: WorkItem;
  label: string; // "PR #316 merged", "ONB-64 moved to Done"
}

export interface BlockedPerson {
  person: Person;
  items: BoardItem[];
  chain: string[]; // ordered chain of labels, e.g. ["ONB-81", "PAY-405", "infra staging DB creds"]
}

export interface BoardState {
  at: string; // ISO time t
  items: BoardItem[]; // all open items visible at t, sorted by score desc
  top: BoardItem[]; // max 5
  attention: BoardItem[];
  blocked: BlockedPerson[];
  happened: HappenedEntry[]; // newest first, since start of working day (08:00 +03:00) of t
  timeline: { ts: string; source: Source; important: boolean; eventId: string }[]; // all meaningful events up to DEMO_NOW for the scrubber
}

export const DEMO_NOW = "2026-10-13T10:30:00+03:00";
export const WEEK_START = "2026-10-11T08:00:00+03:00";
export const MANAGER_ID = "marty";
export const MANAGER_TZ = "Europe/Berlin"; // HQ on the Rhine; CEST (+02:00) on the demo date
export const TEAM_TZ = "Asia/Riyadh"; // data timestamps are +03:00
