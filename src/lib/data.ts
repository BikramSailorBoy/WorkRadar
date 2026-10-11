import type { ExtractedSignal, Person, WorkEvent, WorkItem } from "./types";
import peopleJson from "../../data/people.json";
import itemsJson from "../../data/items.json";
import eventsJson from "../../data/events.json";
import extractJson from "../../data/ai-cache/extract.json";

export const people = (peopleJson as unknown as { people: Person[] }).people;
export const items = itemsJson as unknown as WorkItem[];
export const events = (eventsJson as unknown as WorkEvent[])
  .slice()
  .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.id.localeCompare(b.id));
export const extractedCache = extractJson as unknown as ExtractedSignal[];

export const personById = new Map(people.map((p) => [p.id, p]));
export const itemById = new Map(items.map((i) => [i.id, i]));

export function getPerson(id: string | null | undefined): Person | undefined {
  return id ? personById.get(id) : undefined;
}
export function getItem(id: string): WorkItem | undefined {
  return itemById.get(id);
}
export function loadPeople(): Person[] { return people; }
export function loadItems(): WorkItem[] { return items; }
export function loadEvents(): WorkEvent[] { return events; }
export function loadExtracted(): ExtractedSignal[] { return extractedCache; }

/** Events grouped by item id, chronological. */
export const eventsByItem: Map<string, WorkEvent[]> = (() => {
  const m = new Map<string, WorkEvent[]>();
  for (const e of events) {
    const a = m.get(e.itemId);
    if (a) a.push(e);
    else m.set(e.itemId, [e]);
  }
  return m;
})();
