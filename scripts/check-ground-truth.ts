// Acceptance check: runs deriveBoard(DEMO_NOW) against the 12 planted signals in data/ground_truth.json.
// Usage: npm run check
import { deriveBoard, formatInManagerTz } from "../src/lib/board";
import { DEMO_NOW } from "../src/lib/types";
import truth from "../data/ground_truth.json";

interface Truth { id: string; title: string; panel: string; itemIds: string[]; eventIds: string[] }
const signals = truth as Truth[];

/** Items that must be present in the expected panel (any one of them is enough unless listed as `all`). */
const KEY: Record<string, { any?: string[]; all?: string[] }> = {
  S1: { all: ["jira:INC-88"] },
  S2: { all: ["gh:pr-318"] },
  S3: { all: ["jira:PAY-412"] },
  S4: { all: ["jira:PAY-405"] },
  S5: { any: ["jira:PAY-398", "email:em-0002"] },
  S6: { all: ["jira:ONB-77"] },
  S7: { all: ["jira:ONB-70"] },
  S8: { all: ["ev-0211", "ev-0215", "ev-0217"] }, // happened: event ids
  S9: { any: ["jira:ONB-79", "jira:PAY-420"] }, // top; blocked freeze items are covered by S2-S4/S10
  S10: { all: ["jira:ONB-81", "jira:PAY-405"] },
  S12: { all: ["jira:ONB-77", "gh:pr-322"] },
};

const b = deriveBoard(DEMO_NOW);
const ids = {
  top: new Set(b.top.map((x) => x.item.id)),
  attention: new Set(b.attention.map((x) => x.item.id)),
  blocked: new Set(b.blocked.flatMap((p) => p.items.map((x) => x.item.id))),
  happened: new Set(b.happened.map((h) => h.event.id)),
};

let pass = 0;
let recallTotal = 0;
for (const s of signals) {
  if (s.panel === "noise") continue;
  recallTotal++;
  const k = KEY[s.id];
  // S12 / S6 may live in top or attention (ground truth says "Needs attention / top"); S6 also accepts attention.
  const panels = s.id === "S6" || s.id === "S12" ? ["attention", "top"] : [s.panel];
  const has = (id: string) => panels.some((p) => ids[p as keyof typeof ids].has(id));
  const strict = s.id === "S12" ? (id: string) => ids.attention.has(id) || ids.top.has(id) : has;
  const ok = k.all ? k.all.every(strict) : k.any!.some(strict);
  if (ok) pass++;
  const missing = (k.all ?? k.any!).filter((i) => !strict(i));
  console.log(`${ok ? "PASS" : "FAIL"} ${s.id.padEnd(3)} [${panels.join("|")}] ${s.title}${ok ? "" : "  missing: " + missing.join(", ")}`);
}

const noise = signals.find((s) => s.panel === "noise")!;
const leaks = noise.itemIds.filter((i) => ids.top.has(i) || ids.attention.has(i));
console.log(`${leaks.length ? "FAIL" : "PASS"} S11 noise  leaks: ${leaks.length ? leaks.join(", ") : "none"}`);

// sanity checks
const early = deriveBoard("2026-10-13T08:30:00+03:00");
const noInc = !early.items.some((x) => x.item.id === "jira:INC-88");
const nine30 = deriveBoard("2026-10-13T09:30:00+03:00");
const kycMerged = nine30.happened.some((h) => h.event.id === "ev-0211" && h.item.id === "gh:pr-316");
console.log(`${noInc ? "PASS" : "FAIL"} sanity: no INC-88 at 08:30 +03:00`);
console.log(`${kycMerged ? "PASS" : "FAIL"} sanity: KYC v2 merge in happened at 09:30 +03:00`);

console.log("\n--- board at DEMO_NOW (" + formatInManagerTz(DEMO_NOW) + " Berlin) ---");
const line = (x: (typeof b.items)[number]) => `${x.item.key.padEnd(10)} ${String(x.score.total).padStart(3)} ${x.ring.padEnd(5)} ${x.reasons.join("; ")}`;
console.log("TOP\n  " + b.top.map(line).join("\n  "));
console.log("ATTENTION\n  " + b.attention.map(line).join("\n  "));
console.log("BLOCKED\n  " + b.blocked.map((p) => `${p.person.name}: ${p.chain.join(" -> ")}\n    ` + p.items.map((x) => `${x.item.key} since ${x.blockedSinceTs && formatInManagerTz(x.blockedSinceTs)} | ${x.blockedReason} | waitingOn=${x.waitingOn}`).join("\n    ")).join("\n  "));
console.log("HAPPENED\n  " + b.happened.map((h) => `${formatInManagerTz(h.event.ts)} ${h.label}`).join("\n  "));
console.log(`TIMELINE ${b.timeline.length} events, ${b.timeline.filter((x) => x.important).length} important`);

console.log(`\nRecall: ${pass}/${recallTotal}`);
console.log(`Noise leaks: ${leaks.length}`);
const allOk = pass === recallTotal && leaks.length === 0 && noInc && kycMerged;
console.log(allOk ? "RESULT: OK" : "RESULT: FAILED");
process.exit(allOk ? 0 : 1);
