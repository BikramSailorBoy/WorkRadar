# Token log

How this is measured: subagent figures are the token totals each agent reported when it finished. Main-session figures are read from the session's remaining-token counter at the start and end of each step, so they are approximate. Live app calls report their own input and output tokens in the UI.

| Step | Who | Model | Tokens |
| --- | --- | --- | --- |
| PRD v1 drafting and doc writes | Main session | Claude Opus 5.5 | ~59,000 (approx.) |
| Mock dataset (45 items, 246 events, 12 planted signals) | Subagent | Claude Sonnet 5.5 | 151,505 |
| AI layer: prompts, 6 API routes, demo cache | Subagent | Claude Sonnet 5.5 | 144,835 |
| Board logic, scoring, ground-truth check | Subagent | Claude Sonnet 5.5 | 198,706 |
| Persona change (Marty McFly, Cologne HQ), data and PRD edits | Main session | Claude Opus 5.5 | ~18,500 (approx.) |
