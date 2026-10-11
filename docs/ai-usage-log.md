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
