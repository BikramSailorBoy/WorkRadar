# AI usage log

Running log of where AI was used and what was changed by hand. Feeds the AI Workflow PDF.

| # | Step | AI tool and model | What AI produced | What was changed manually, and why |
| --- | --- | --- | --- | --- |
| 1 | README | Claude (Sonnet 5.5) | First README from the client brief | Kept only what the brief states; no invented features |
| 2 | Approach and concept | Claude (Opus 5.5) | Build order, stack, five visual concepts | Bikram chose radar + day replay + triage; asked for Air Traffic Control and Team Weather as named alternatives |
| 3 | PRD v1 | Claude (Opus 5.5) via Claude Docs | Full PRD: questions, rules, scoring, AI design, options, metrics | Bikram changed persona to Marty McFly, HQ in Cologne on the Rhine; times and weekends reworked for a Germany-based manager with a Riyadh/Cairo/Bengaluru team |
| 4 | Mock data | Claude (Sonnet 5.5) subagent | 15 people, 45 items, 246 events, 12 planted ground-truth signals, validator | Company/bank names renamed to clearly fictional ones; two timestamps moved so the data matched its own ground truth (PR #318 review request, ONB-70 stall) |
| 5 | AI layer | Claude (Sonnet 5.5) subagent | Prompts, 6 API routes with live/demo fallback, precomputed demo outputs | Manager references renamed after the persona change |
| 6 | Board logic | Claude (Sonnet 5.5) subagent | deriveBoard (replay to any time), scoring, ground-truth check: 11/11 recall, 0 noise leaks | Agent lowered the stale threshold to 60h to pass; reverted to the PRD's 72h and fixed the data instead, so the rule stays principled |
| 7 | UI | Claude (Opus 5.5) subagent, frontend-design skill | Full UI with Playwright screenshot loop | Manually: AI-written text quoted Riyadh times while the UI shows Cologne; converted cached outputs and added a time-zone rule to the prompts; shortened the brief to keep the radar above the fold |
| 8 | Security upgrade | Claude (Opus 5.5) | Upgraded Next.js 15.5.4 to 15.5.27 and React to 19.3 after Vercel flagged a vulnerable Next.js version | None; verified build and ground-truth check still pass |
| 9 | Live AI debugging | Claude (Opus 5.5) | Added /api/diag on the live deploy; found two real defects: (1) `temperature` is deprecated on Claude 5.5 models (HTTP 400), (2) the models used the whole token budget on extended thinking and returned no text | Removed `temperature`; disabled thinking per model (Haiku: `disabled`, Sonnet: `between_tools`, which the API itself told us to use). The AI-written layer had assumed older API behaviour; only testing against the live API exposed it |
| 10 | UI redesign (v2) | Claude (Opus 5.5) subagent | Holographic radar console: bearing ring, sweep with afterglow, target lock, expanding widgets, noise shown as suppressible "sea clutter", replay track trails | Bikram judged v1 "not very appealing", supplied six reference images, and chose holographic blue, the console layout of one reference and click-to-expand widgets for readability. Rule set by the orchestrator: every number on screen must be real data, so no decorative fake readouts |
