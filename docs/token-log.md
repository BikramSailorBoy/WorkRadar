# Token log

How this is measured: subagent figures are the token totals each agent reported when it finished. Main-session figures are read from the session's remaining-token counter at the start and end of each step, so they are approximate. Live app calls report their own input and output tokens in the UI.

| Step | Who | Model | Tokens |
| --- | --- | --- | --- |
| PRD v1 drafting and doc writes | Main session | Claude Opus 5.5 | ~59,000 (approx.) |
| Mock dataset (45 items, 246 events, 12 planted signals) | Subagent | Claude Sonnet 5.5 | 151,505 |
| AI layer: prompts, 6 API routes, demo cache | Subagent | Claude Sonnet 5.5 | 144,835 |
| Board logic, scoring, ground-truth check | Subagent | Claude Sonnet 5.5 | 198,706 |
| Persona change (Marty McFly, Cologne HQ), data and PRD edits | Main session | Claude Opus 5.5 | ~18,500 (approx.) |
| UI: radar, panels, replay, triage, Ask, drawer, screenshots | Subagent | Claude Opus 5.5 | 245,183 |
| Integration fixes, Cologne-time outputs, deploy attempt | Main session | Claude Opus 5.5 | ~51,000 (approx.) |
| Security upgrade, live-AI debugging and fixes | Main session | Claude Opus 5.5 | ~31,000 (approx.) |

## Live app: tokens per call (measured on the deployed app, 12 Oct 2026)

| Call | Model | Input tokens | Output tokens | Latency |
| --- | --- | --- | --- | --- |
| Morning brief | claude-sonnet-5-5 | 7,185 | 536 | 3.8 s |
| AI reasons (all board items in one call) | claude-haiku-5-5 | 6,578 | 1,025 | 4.4 s |
| Triage nudge | claude-haiku-5-5 | 570 | 76 | 1.1 s |

## Review and polish

| Step | Who | Model | Tokens |
| --- | --- | --- | --- |
| Independent review of the live app and repo | Subagent | Claude Sonnet 5.5 | 114,351 |
| UI fixes from the review (at-a-glance strip, sticky radar, brief clamp) | Subagent, resumed | Claude Opus 5.5 | not reported by the tool |
| AI Workflow doc, PRD v2 edits, review fixes | Main session | Claude Opus 5.5 | ~70,000 (approx.) |
| UI redesign v2: holographic radar console | Subagent, resumed | Claude Opus 5.5 | not reported by the tool |
