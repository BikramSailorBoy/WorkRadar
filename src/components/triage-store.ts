import { getPerson } from "@/lib/data";

export type DecisionAction = "ack" | "delegate" | "snooze" | "nudge";
export interface Decision {
  action: DecisionAction;
  at: string; // board time the decision was made
  to?: string; // person id for delegate
  message?: string; // nudge text
}

const KEY = "workradar.triage.v1";

export function loadDecisions(): Record<string, Decision> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Decision>) : {};
  } catch {
    return {};
  }
}

export function saveDecisions(d: Record<string, Decision>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* private mode or storage blocked: decisions stay in memory */
  }
}

export function decisionLabel(d: Decision): string {
  switch (d.action) {
    case "ack":
      return "Acknowledged";
    case "delegate":
      return `Delegated to ${getPerson(d.to)?.name.split(" ")[0] ?? "teammate"}`;
    case "snooze":
      return "Snoozed to Wed";
    case "nudge":
      return "Nudged";
  }
}
