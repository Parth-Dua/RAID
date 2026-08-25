# Milestones

Per-version acceptance conditions, tests, and results for the V0.1 → V0.6 roadmap. Each entry is
written after the phase's tests actually ran, not before — this is a record of what happened, not a
plan. See `README.md` for the roadmap summary and `docs/REVIEW_NOTES.md` for deep-dive bug writeups
that are too long to repeat here.

## DeepSeek API budget

Hard ceiling for all work in the V0.2-V0.6 roadmap: **$8.00 USD**. Tracked cumulatively below at the
end of every phase that makes live calls. `deepseek-v4-flash` via `AI_PROVIDER=deepseek`; all
automated tests use `AI_PROVIDER=mock` (zero cost) unless a phase's acceptance conditions specifically
require live-integration evidence mocks can't provide.

| Phase | Live requests | Est. input tokens | Est. output tokens | Est. cost | Cumulative |
|---|---|---|---|---|---|
| V0.1 (prior session) | 3 (all failed at network layer — sandbox egress blocked `api.deepseek.com`) | 0 (never reached the model) | 0 | $0.00 | $0.00 |

Running total: **$0.00 of $8.00**.

---

## V0.1 — Core multiplayer incident simulator (prior session)

Full build from an empty repository: monorepo, domain/game-engine, AI provider abstraction, backend
(rooms/sessions/sockets/services), frontend, one scenario, 68 automated tests, 19 ADRs, 10 rendered
Mermaid diagrams. Complete writeup in the initial commit and `docs/REVIEW_NOTES.md`/`docs/EVALUATION.md`.
Summarized here for continuity; not re-litigated.

**Status**: shipped, committed (`278f95b`, `953ecc7`).

---

## V0.2 — Human playtest readiness + game quality

**Goal**: make the existing scenario enjoyable and understandable for four humans without the
developer explaining the game, and fix the Incident Commander's passivity.

**What changed**:
- Lobby onboarding blurb explaining the asymmetric-information premise before the game starts.
- In-game role objective banner ("Investigate the application layer...") at the top of every role's
  tools panel, generalized across all four roles (removed the special-cased Incident Commander branch
  that used to render static text instead of a real tool list).
- **Incident Commander is no longer passive**: two new IC-exclusive tools (Service Status Board,
  Customer Impact Feed) with their own time-gated evidence, deliberately coarse (says which service is
  unhealthy, never why) so they add real signal without duplicating any investigative role's evidence
  or leaking the mechanism.
- Team roster: every player's role (not evidence) is now visible to the whole team once the game
  starts — the wire data already existed (`RoomSnapshot.players[].role`), it was never rendered.
- Knowledge board split into Known Facts, Open Questions (new `category` column on `known_facts`),
  Active Hypotheses, and Ruled Out (hypotheses with AI status `CONTRADICTED` get their own section).
- Leave-room: a new `player:leave` socket event, legal only in `LOBBY` (once a game starts, role/
  evidence bindings mean a player can disconnect but not be deleted without corrupting game history).
  Host-transfer logic was factored out of the socket layer into `roomService.transferHostIfNeeded` so
  disconnect and voluntary leave share one implementation instead of two that could drift apart.
- Extended `evaluateScenarioQuality` with 4 new automated checks: IC has an active tool, evidence is
  balanced across roles (max ≤ 2.5x min), no evidence item leaks the root-cause summary verbatim, and
  the causal chain has a real multi-hop structure (≥4 steps).
- `docs/PLAYTESTING.md`: a human playtest rubric plus this session's role-balance/asymmetry/pacing
  evaluation, built from real bot-run and browser-run data (not assumption) — and an explicit,
  reasoned decision *not* to fake an automated "can one role solve it alone" test against MockAI, since
  the mock's keyword heuristic would measure the mock's sensitivity, not actual epistemic limits.

**Acceptance conditions**:
- PASS first-time users can understand the flow from the UI — onboarding blurb + role objective banner, verified in a real browser session
- PASS each role meaningfully contributes — role-balance table in `docs/PLAYTESTING.md`, evidence-balance now enforced automatically
- PASS no single role can confidently solve alone — structural argument in `docs/PLAYTESTING.md`, key evidence spans ≥3 roles (automated)
- PASS final diagnosis requires multi-role evidence — same
- PASS Incident Commander has active gameplay — 2 new tools, verified via real browser screenshot and bot-script tool execution
- PASS at least one plausible wrong path exists — 5 red herrings, unchanged from V0.1, still automatically checked
- PASS private evidence remains private — existing security suite green, plus a new test confirming a non-IC player gets `WRONG_ROLE` on an IC tool
- PASS reconnect works — existing reconnect test still green after the scenario/schema changes
- PASS leave/rejoin behavior is sane — 3 new tests: seat freed immediately, host transfers on leave, leaving mid-game is rejected (must disconnect instead)
- PASS knowledge board has clear purpose — Known Facts / Open Questions / Active / Ruled Out, verified rendering in a real browser
- PASS 4-player bot flow passes — `pnpm bots` run against live server, score 87/100, IC's new tools correctly time-gated (baseline on first pass, `ic_status_degraded` unlocked on the second)
- PASS 3-player flow passes if supported — exercised throughout `concurrency.test.ts`/`security.test.ts`/`v0.2.test.ts` (role assignment, tool execution, leave, final submission all use 3-player setups and reach completion)
- PASS browser multiplayer verification passes — 4 separate real Chromium sessions (Playwright) through lobby, onboarding, leave, in-game roster, knowledge board, IC tools
- PASS existing tests remain green — 30/30 pre-existing tests still pass
- PASS new behavior has tests where practical — 7 new server tests (37/37 total)
- PASS PLAYTESTING.md exists
- PASS findings are documented — this entry, `docs/PLAYTESTING.md`, `docs/GAME_DESIGN.md` role table update

**Tests run**: `packages/game-engine` 20/20 (4 new scenario-quality checks added, all pass with real
non-trivial values, e.g. evidence balance 5/6/5 across roles — verified by printing actual counts, not
just checking the aggregate pass/fail). `apps/server` 37/37 (7 new). `packages/ai` unaffected, not
re-run this phase (no AI-layer changes).

**Runtime verification**: `pnpm bots` (4-player, live server) — full loop completed, IC tools correctly
time-gated, score 87/100. Scripted Playwright sessions (4 separate real browser contexts) — lobby
onboarding, leave-room (seat freed immediately, other players' view updates), in-game team roster,
knowledge board (facts + questions both rendering with real submitted text), IC tools panel (Service
Status Board executable with a real "Run" button and baseline output).

**DeepSeek calls made this phase**: 0 (mock only; no AI-layer changes in V0.2).

**Approximate spend this phase**: $0.00. Cumulative: **$0.00 of $8.00**.

**Bugs found**: none new in application logic this phase (the `pnpm dev` filter-quoting bug was found
and fixed during README productionization, immediately prior to this phase — see `docs/REVIEW_NOTES.md`).

**Architecture changes**: host-transfer logic moved from the socket transport layer into
`roomService.transferHostIfNeeded` (a real domain-boundary fix — this was business logic living in
`sockets/index.ts` before, duplicated nowhere yet but positioned to drift if a second call site had
been added without noticing the first).

**Known remaining limitations**: no real human playtest has happened yet (top priority, unchanged from
V0.1's "next five improvements"); the Incident Commander's new tools are unavoidably subjective in how
"coarse" is coarse enough — this was designed and reasoned about, not empirically tuned against real
play.

---

(V0.3 onward recorded below as each phase completes.)
