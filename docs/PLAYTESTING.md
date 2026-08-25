# Playtesting

This document is both a rubric for future human playtests and a record of the analytical/automated
evaluation done in V0.2, grounded in real runs (bot simulation + scripted multi-session browser
verification) rather than assumption. A genuine human playtest (a group of people actually playing
under real time pressure) has **not** happened yet — see "What this document is not" at the bottom.

## Human playtest rubric

Use this after any group session (in person or via a video call, each player on their own device).

### Setup (2 min)
- [ ] Did players understand the objective without the facilitator explaining it out loud?
- [ ] Did the lobby onboarding blurb ("each of you gets a different role...") land, or did someone ask "wait, what am I supposed to do"?
- [ ] Did role assignment and the game start feel instantaneous, or was there a confusing pause?

### First 2 minutes of the incident
- [ ] Did every player find and run at least one tool without being told how?
- [ ] Did anyone say something like "I don't know what I'm looking at"?
- [ ] Did the role objective banner (top of the tools panel) get read, or ignored?

### Middle of the game
- [ ] Did players proactively share findings in chat or the knowledge board, or did they investigate in silence?
- [ ] Did anyone say a piece of evidence "gave it away" too early?
- [ ] Did the team pursue at least one red herring before ruling it out?
- [ ] Did the Incident Commander (if present) actively use their tools, or sit idle waiting for others?
- [ ] Was there a moment where a player said "wait, what does [teammate]'s role even see"? (a roster/role-visibility gap)

### End of the game
- [ ] Did the team reach a final diagnosis they were reasonably confident in?
- [ ] Did the debrief's score and coaching notes feel fair given what actually happened?
- [ ] Would the group want to play again immediately? (the single strongest signal)

### Open-ended
- [ ] What was the most confusing moment?
- [ ] What was the most fun moment?
- [ ] What felt like busywork / unnecessary reading?

## V0.2 evaluation (this session)

### Role balance

| Role | Unique tools | Unique evidence | Reason to communicate |
|---|---|---|---|
| Backend Engineer | 5 | 5 | Holds the deploy diff and the N+1 trace pattern — the "what changed" half of the story |
| Database Engineer | 5 | 6 | Holds the pool-saturation graph and query-volume spike — the "what broke" half |
| SRE / Infra | 5 | 5 | Holds the negative evidence (flat CPU/memory, normal request rate) that rules out the two most tempting wrong theories (traffic spike, infra capacity) |
| Incident Commander | 2 (new in V0.2) | 2 (new in V0.2) | Holds a coarse cross-service status rollup and customer-impact trend — enough to direct the team ("focus on checkout + DB, infra's fine") without duplicating any investigative role's evidence |

Before V0.2, the Incident Commander had zero tools and zero evidence — a genuinely passive role whose
only actions were chat and the final submission button. `packages/game-engine/src/scenarioValidation.ts`
now mechanically enforces "Incident Commander has at least one active tool" as part of the automated
scenario-quality checklist, so this can't silently regress. Evidence distribution across the three
investigative roles is checked to be balanced within 2.5x (measured: 5/6/5 for this scenario — see
`evaluateScenarioQuality`'s "evidence is roughly balanced" check).

### Information asymmetry (V0.2.3)

**Structural argument** (grounded in the actual evidence map, not assumption): the seven pieces of key
evidence needed for a complete, correctly-argued diagnosis span three roles - Backend (deploy log,
N+1 trace, error logs), Database (pool saturation, query volume spike), SRE (flat CPU/memory, normal
request rate). No role's evidence pool is a superset of another's. A Backend Engineer playing alone
can reasonably hypothesize "the deploy introduced a repeated per-item lookup" (they hold the deploy
diff and the trace showing six identical DB spans) but cannot *confirm* that this saturated the
connection pool (that graph is Database-only) or *rule out* that it's simply a traffic/infra problem
(that requires SRE's flat-CPU and normal-request-rate readings) - so the rubric's `evidenceQuality`
component, which rewards citing evidence across the causal chain, structurally caps what a solo
Backend Engineer can score even with a fully correct-sounding root-cause sentence.

**Why this wasn't turned into an automated "solo AI score" test**: `MockAIProvider`'s
`evaluateFinalDiagnosis` is a keyword-matching heuristic (see `docs/AI_DESIGN.md`) - it would happily
score a Backend-only submission highly if the text merely *contains* the right words ("deploy",
"N+1", "connection pool"), regardless of whether that player could plausibly have known them. Building
an automated test on top of the mock here would produce a number that looks like evidence but measures
the mock's keyword sensitivity, not actual epistemic limits - that would be exactly the kind of
fabricated-looking-real evidence these instructions warn against. The structural argument above (which
evidence exists, who can see it, what the rubric rewards) is the honest form this check can currently
take; a real DeepSeek-scored solo-role submission, if ever run, would be a stronger version of this
test and is noted as a candidate for V0.4's live-verification budget.

### Pacing (V0.2.4), from real bot-run and browser-run data

- **Time to first discovery**: instant. Most evidence has no time-gate at all (unlocks the moment its
  tool is run) - a player who runs every one of their tools once, in the first 10-15 seconds, sees
  roughly half of their role's evidence immediately (confirmed in this session's bot-script and
  browser runs).
- **Escalation / time-gated evidence**: the remaining key evidence (the N+1 trace, error logs, pool
  saturation graph, query volume spike, flat-CPU reading) unlocks at 10-20% of total game duration -
  roughly 30-45s into a 5-minute demo game, or 2-4 minutes into a 20-minute standard game. Confirmed
  directly: the bot script's two-pass tool execution showed zero new evidence on immediate re-runs and
  exactly the expected items appearing after the timeout.
- **Reading volume**: each role's tool result is 2-8 lines of log/metric text: enough to feel like a
  real system, short enough to scan in a few seconds. No tool result exceeds roughly 500 characters.
- **False paths**: five red herrings exist, one to two per role, each ruled out by a specific,
  checkable tool result rather than left ambiguous.
- **Answer leakage**: checked mechanically - no evidence item's text contains the root-cause summary
  verbatim (`evaluateScenarioQuality` "no single evidence item states the full root-cause summary
  verbatim"). The Incident Commander's new tools were deliberately written to be coarse (WHICH service
  is degraded, never WHY) specifically to avoid this while still giving IC something concrete.

### Shared knowledge board

Known Facts and Hypotheses existed before V0.2 but had no "ruled out" distinction and no way to record
an open question separately from a stray chat message. V0.2 adds:
- **Ruled out**: hypotheses with AI status `CONTRADICTED` now render in a visually separate section
  instead of being buried in the same list as active ones.
- **Open Questions**: a genuinely separate category (not just filtered chat) backed by the same
  `known_facts` table with a `category` column (`fact` | `question`), so "why did errors start exactly
  at T+24s" is a first-class, visible-to-everyone artifact distinct from an assertion of fact.
- **Team roster**: new in V0.2 - every player's role (not evidence, just the role label) is now shown
  to the whole team once the game starts. Previously a player had no way to know who to ask about what
  short of guessing from context clues in chat. This was already technically present in the wire
  protocol (`RoomSnapshot.players[].role`) but was never rendered anywhere in the UI.

## What this document is not

This is not a substitute for an actual human playtest. Every finding above comes from automated checks,
bot-simulation runs, or scripted Playwright sessions driving real browser instances through the UI -
useful for catching structural and functional problems, but none of it can tell you whether the game
is actually *fun* under real social dynamics and real time pressure. That remains the top item in
"next five improvements" until it happens.
