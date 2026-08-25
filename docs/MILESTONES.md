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
| V0.2 | 0 (mock only) | 0 | 0 | $0.00 | $0.00 |
| V0.3 | 0 (mock only) | 0 | 0 | $0.00 | $0.00 |
| V0.4 | 5 (V0.4.6 smoke test — `deepseekSmokeTest.ts` calls 1-3 unchanged + new calls 4-5 for `classifyTeamState`/`proposeIntervention`; all 5 failed at network layer, sandbox egress blocked `api.deepseek.com`, identical to V0.1) | 0 (never reached the model) | 0 | $0.00 | $0.00 |
| V0.5 | 2 (V0.5.6 smoke test — `deepseekSmokeTest.ts` new calls 6-7 for `generateScenario`/`semanticReviewScenario`; both failed at network layer, identical restriction, re-confirmed with a real `DEEPSEEK_API_KEY` supplied) | 0 (never reached the model) | 0 | $0.00 | $0.00 |

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

## V0.3 — Multiple scenarios + replayability

**Goal**: ship at least 3 meaningfully different incident scenarios with a difficulty system that
changes real reasoning complexity (not just the clock), generalize the scenario engine so scenario
differences are data/rule-driven rather than scattered `if (scenario.id === ...)` branching, and add
low-friction replayability (play again, pick a new scenario, fresh randomized roles, clean reset) with
no accounts system.

**What changed**:
- **3 scenarios**, each a genuinely different failure mechanism: `checkout-degradation` (existing,
  query-volume-driven pool exhaustion), `lock-contention` / "Order Processing Stall" (new — a
  long-held-transaction lock blocking writes; deliberately produces the *same* "pool looks full"
  surface symptom as checkout-degradation for a *different* underlying reason, so a team can't just
  pattern-match the previous scenario's answer), `memory-leak` / "Recommendation Service Crash Loop"
  (new — unbounded in-process cache growth → OOM-kill/restart cycle → intermittent, cyclical 503s).
  Each has its own 15-17 tools, 14-17 evidence items, 5 red herrings, 6-7 causal-chain steps, and 5
  plausible-wrong-hypotheses. See `docs/GAME_DESIGN.md` "Scenarios" for full per-scenario detail.
- **Difficulty (NORMAL/HARD)**, implemented as exactly one generic transform
  (`applyDifficulty()` in `packages/game-engine/src/difficulty.ts`) applied uniformly to whatever
  scenario is selected — no scenario module contains difficulty logic. NORMAL appends each evidence
  item's authored interpretive `hint` to its raw content; HARD withholds the hint (same raw data, no
  steer) and pushes time-gated evidence unlock thresholds later (×1.35, capped at 95% of duration).
  This is a real reasoning-complexity change, not a timer adjustment — see ADR-020.
- **Scenario engine generalization**: `SCENARIO_REGISTRY` (a plain id → builder map) is the single
  place scenario identity is switched on; `buildScenario(scenarioId, durationSeconds, difficulty)` is
  the only call site product code uses. A new `GET /api/scenarios` REST endpoint serves the catalog
  (id, title, severity, briefing, tagline) for the lobby's picker UI.
- **Host-side selection**: the lobby's host-only panel gained a scenario picker and a NORMAL/HARD
  toggle alongside the existing duration picker; the choice flows through `game:start`'s payload
  (`scenarioId?`, `difficulty?`, both optional with server-side defaults) to `roomService.startGame`,
  which rejects an unknown `scenarioId` with `INVALID_PAYLOAD` rather than silently falling back.
- **Replayability / rematch**: the state machine gained exactly one new transition,
  `COMPLETED → LOBBY` (ADR-021), reachable only via a new host-only `game:rematch` socket event. It
  resets the room to LOBBY (same room code/players, `currentGameId` cleared), resets every player's
  ready flag, and leaves the completed game's own row untouched. The existing LOBBY→STARTING→ACTIVE
  path (fresh role shuffle, host's newly-chosen scenario/difficulty) runs unchanged from there — no
  new "start a rematch" code path was needed. Debrief screen gained a "Play again with this group"
  button (host-only) and a waiting message for everyone else.
- **No state leakage across rematch**, defense in depth at two layers: server-side, every game-scoped
  socket handler resolves "the active game" via `room.currentGameId` (now `null` post-rematch), so a
  stale action against the old game is rejected with `INVALID_PHASE` rather than silently acting on it;
  client-side, `GameProvider` tracks the room's current `gameId` and drops any `game:snapshot` naming a
  different one, and clears local game/debrief state the instant a `room:snapshot` reports a
  gameId-less LOBBY.
- Two pre-existing gaps found and fixed as part of this work (not new regressions, but exposed by
  actually wiring scenario selection end-to-end): `RoomSnapshot.scenarioId` had been hardcoded to
  `null` since V0.1 and was never actually populated; `roomsRepo.tryTransitionRoomPhase`'s `extra`
  param used truthiness (`extra?.currentGameId ? … : {}`) to decide whether to update
  `currentGameId`, which silently could never clear it to `null` — both fixed (`getRoomSnapshot` now
  fetches the current game's row; the repo function now checks `"currentGameId" in extra"` instead of
  truthiness).
- `bots` script (`apps/server/src/scripts/botSimulation.ts`) now accepts `RAID_SCENARIO_ID` /
  `RAID_DIFFICULTY` env vars and a per-scenario `FINAL_SUBMISSIONS` map, so the same script drives any
  of the 3 scenarios at either difficulty instead of being hardcoded to checkout-degradation.
- `evaluateScenarioQuality`'s 14 automated checks now run against all 3 scenarios × both difficulties ×
  all 3 duration presets (18 combinations) via `describe.each`/`it.each` in `scenarioValidation.test.ts`,
  rather than one scenario at one duration.

**Acceptance conditions**:
- PASS at least 3 meaningfully different scenarios shipped — 3 distinct failure mechanisms, verified structurally distinct (different tool/evidence ids, different "what rules out the wrong answer" logic) and via live bot runs of all 3
- PASS difficulty changes real reasoning complexity, not just the clock — `difficulty.test.ts` asserts hint withholding + later unlock thresholds; both properties independently verified
- PASS scenario engine is data/rule-driven, not `if (scenario.id === ...)`-scattered — `SCENARIO_REGISTRY` is the only scenario-id switch point in product logic; verified by inspection and by the fact that adding scenario #3 required zero changes to `roomService`, `gameService`, `gameLoader`, or any socket handler
- PASS host can select scenario + difficulty in the lobby — real browser verification (Playwright), host picks "Order Processing Stall" + HARD, confirmed in the started game's content
- PASS unknown scenario selection is rejected, not silently substituted — `INVALID_PAYLOAD`, covered by a dedicated test
- PASS every scenario independently passes the automated structural quality checklist — 18/18 scenario×difficulty×duration combinations pass all 14 checks
- PASS replayability: play again with the same group — `game:rematch`, host-only, COMPLETED-only, verified server-side and in a real browser (submit → debrief → rematch → clean lobby)
- PASS replayability: new scenario/roles on rematch — rematch returns to LOBBY where the host can pick a different scenario; roles are freshly (re-)assigned by the same shuffle every game start uses
- PASS no accounts system introduced — rematch is purely a room-state reset; no user/session persistence beyond the existing per-room player cookie
- PASS no state leakage from the old game into the new one — two-layer guard (server `currentGameId`-null rejection + client gameId-mismatch drop), covered by a dedicated adversarial test (stale `final:submit` after rematch rejected with `INVALID_PHASE`) and an end-to-end rematch test asserting the new room's REST snapshot reflects only the new game
- PASS existing tests remain green — all 48 pre-V0.3 server tests + all pre-V0.3 game-engine tests still pass
- PASS new behavior has real test coverage — 11 new server tests (`v0.3.test.ts`), 1 new game-engine test file (`difficulty.test.ts`, 18 tests) plus generalized `scenarioValidation.test.ts` and 2 new `stateMachine.test.ts` cases
- PASS docs updated — `docs/GAME_DESIGN.md` (all 3 scenarios, difficulty, replayability sections), `docs/DECISIONS.md` (ADR-020, ADR-021), `docs/WEBSOCKET_PROTOCOL.md` (`game:rematch`, `game:start` payload changes, plus filling in two pre-existing V0.2 documentation gaps found while updating this file), `docs/DATABASE.md` (new `difficulty` column), `docs/TESTING.md` (new test file, bot script env vars)

**Tests run**: `packages/game-engine` 50/50 (`scoring` 5, `scenarioEngine` 7, `scenarioValidation` 12 —
was 2, now parameterized across 3 scenarios × 2 difficulties × 3 durations, `stateMachine` 8 — was 6,
+2 for the new `COMPLETED→LOBBY` transition, `difficulty` 18 — new file). `apps/server` 48/48 (was 37,
+11 in new `v0.3.test.ts`). `packages/ai` unaffected, not re-run (no AI-layer changes this phase). Root
`pnpm run build` / `pnpm run typecheck` / `pnpm run lint` all clean across all 5 workspace packages.

**Runtime verification**: `pnpm bots` run live against all 6 scenario×difficulty combinations
(`checkout-degradation`/`lock-contention`/`memory-leak` × `NORMAL`/`HARD`) — all 6 completed the full
room-creation-to-scored-debrief loop with `AI_PROVIDER=mock`, no errors. Real Chromium (Playwright,
separate browser contexts per player) end-to-end run: 3 real player joins → host selects "Order
Processing Stall" + HARD + demo duration → all ready → start → lock-contention-specific content
confirmed rendered (not checkout-degradation's) → final diagnosis submitted → debrief screen with real
score rendered → host clicks "Play again with this group" → room returns to a clean LOBBY with the
scenario picker visible again and **zero leaked debrief content** from the previous round, confirmed by
asserting the old score text is absent from the post-rematch page.

**DeepSeek calls made this phase**: 0 (mock only; no AI-layer changes in V0.3 — scoring/hypothesis
evaluation logic is unchanged, only which scenario/difficulty feeds into it).

**Approximate spend this phase**: $0.00. Cumulative: **$0.00 of $8.00**.

**Bugs found**: two pre-existing (V0.1-era) gaps surfaced while wiring scenario selection end-to-end,
both fixed this phase (see "What changed" above): `RoomSnapshot.scenarioId` had been hardcoded `null`
since V0.1 (never actually read from the game row), and `tryTransitionRoomPhase`'s optimistic
`currentGameId` update used truthiness instead of presence, which meant it could never actually clear
`currentGameId` back to `null` — a latent bug that would have made rematch's LOBBY reset silently
useless (the room would have kept pointing at the old completed game) had it not been caught by the
first rematch test run.

**Architecture changes**: `applyDifficulty()` is a new, deliberately narrow single-responsibility
module — difficulty logic now exists in exactly one place regardless of how many scenarios or future
difficulty levels exist (ADR-020). The `COMPLETED → LOBBY` state machine transition (ADR-021) is the
first crack in what was previously a fully-terminal completion state; `ABANDONED` remains fully
terminal by deliberate contrast. No new packages, no new cross-package coupling — scenario/difficulty
selection flows through the same `game:start` payload and `roomService.startGame` call path that
already existed, just with two new optional fields.

**Known remaining limitations**: difficulty currently varies clue legibility and unlock timing only —
it does not vary red-herring count or causal-chain length between NORMAL/HARD for the same scenario
(documented in `docs/GAME_DESIGN.md` as a deliberate scope boundary, with ADR-020 noting what would
warrant revisiting it). Rematch always keeps the same room/players; there is no "leave and start a
different rematch group" flow, which is intentional (V0.3.5 explicitly scoped out accounts) but means a
group that wants to reshuffle membership between rounds must create a new room instead.

---

## V0.4 — Adaptive multiplayer AI Game Master

**Goal**: give the AI a second capability beyond judging player output — a periodic read of the
team's *collective* investigative state from a bounded, structured snapshot (never raw chat), a
7-value structured classification of that state, and the ability to propose a safe, budget-gated
intervention when (and only when) the team is genuinely stuck — with backend validation making it
structurally impossible for an intervention to leak the answer, mutate score, or bypass the engine.

**What changed**:
- **Collective Reasoning State** (`packages/ai/src/collectiveState.ts`): a pure function that turns
  raw game state into a fixed-shape, capped summary — discovered evidence (titles/category only,
  never content, ≤20), active/challenged/ruled-out hypotheses (≤10 each), open questions and known
  facts (≤10/≤15), tools used, the last 15 investigation-trajectory events, and per-role subsystem
  coverage. Bounded by construction, not convention — the caps never grow regardless of game length,
  and an intervention can never leak private evidence content because the model is never given
  evidence content in the first place, only titles.
- **Team-State Classification**: `classifyTeamState` returns exactly one of 7 fixed values
  (`ON_TRACK`, `TUNNEL_VISION`, `INSUFFICIENT_EVIDENCE`, `CONTRADICTORY_REASONING`,
  `IGNORING_CRITICAL_SIGNAL`, `STALLED`, `SOLVING_TOO_QUICKLY`), Zod-validated structured output only.
- **Safe Interventions**: `proposeIntervention` returns `{shouldIntervene, kind, message, targetRole,
  confidence}` where `kind` is one of 5 fixed, safe categories. `validateIntervention`
  (`packages/ai/src/interventionValidator.ts`) runs unconditionally before delivery: rejects any
  message that leaks the root cause (reusing the same leak guard hypothesis rationales go through) or
  references a real evidence/tool id verbatim. Structurally, by design (ADR-022), an intervention's
  *only* possible effect on the game is becoming a read-only chat message — there is no code path from
  a proposal to any mutation of evidence, hypotheses, or score.
- **Intervention Budget** (`apps/server/src/services/gameMasterService.ts`): max 3 interventions per
  game, a 60-elapsed-second cooldown between deliveries, a 0.5 minimum confidence to actually deliver,
  and a durable `game_interventions` history table backing both checks (declined/invalid/low-confidence
  proposals are never persisted — only what's actually delivered).
- **Mock Mode**: `MockAIProvider.classifyTeamState` is a deterministic priority-ordered heuristic
  ladder over the collective state; `proposeIntervention` returns a fixed, kind-appropriate templated
  message per intervention-eligible classification. Every automated test runs against this.
- **Live API Validation**: `deepseekSmokeTest.ts` extended with 2 new real (non-mocked) calls
  (`classifyTeamState`, `proposeIntervention`) alongside its original 3.
- **Wiring**: `runGameMasterCheck` (classify → maybe propose → validate → budget/cooldown/confidence
  gate → persist + deliver) is called periodically — not every tick — from the game clock
  (`sockets/clock.ts`), at an interval scaled to the scenario's duration (`max(15s, 15% of
  durationSeconds)`). A classification/AI failure here is caught and logged, never propagated — the
  Game Master is additive on top of the core loop, never a dependency of it.
- A delivered intervention is a `ChatMessage` with a new `kind: "ai_intervention"` (widened
  `chat_messages.kind` column from varchar(10) to varchar(20) to fit it), rendered distinctly in the
  chat panel ("Game Master:" label, accent-tinted background) so players can tell it apart from
  scripted timeline system messages and each other's chat.
- **Architecture-review fix found and fixed before starting new V0.4 work** (committed separately,
  `1c8efed`): `MockAIProvider`'s scoring and `leakGuard`'s leak-detection both used one hardcoded,
  checkout-degradation-shaped keyword list applied to every scenario — meaning lock-contention's and
  memory-leak's own correct answers were scored as if they were red herrings, and those two scenarios
  had zero leak protection. Fixed by moving keyword hints onto `ScenarioDefinition.scoringHints`,
  authored per scenario, with 15 new regression tests. See that commit and `docs/DECISIONS.md` is not
  the write-up for this one — it's a straightforward bug fix, not an architecture decision, and is
  documented in the commit message and this note instead.

**Acceptance conditions**:
- PASS collective reasoning state is bounded and structured, never raw/unbounded chat — every list capped, evidence reduced to titles only; verified by `collectiveState.test.ts` (bounding, evidence-content-exclusion) and by inspection (no chat table is ever queried by `buildCollectiveStateForGame`)
- PASS team-state classification uses exactly the 7 specified values, structured output only — `TeamStateClassificationSchema` enum-validated; `classifyTeamState.test.ts`-equivalent coverage in `mockProvider.test.ts` exercises all 7 branches plus `deepseekProvider.test.ts` covers schema rejection of an invalid value
- PASS safe interventions are limited to the 5 specified kinds and cannot leak/mutate/bypass — `InterventionProposalSchema` enum-restricted `kind`; `validateIntervention` unconditionally checked; adversarial "AI intervention attempts root-cause leak" test in `v0.4.test.ts` confirms a forced leaking proposal is discarded before delivery
- PASS backend validates every intervention proposal, not just the schema shape — `interventionValidator.ts`, 8 dedicated tests plus reuse in both providers' pipelines
- PASS intervention budget enforced (cooldown, max count, minimum confidence, history) — all 4 covered by dedicated `v0.4.test.ts` tests (budget-of-3, cooldown, confidence floor, and the persisted `game_interventions` history itself)
- PASS mock mode is fully deterministic and used by all automated tests — every test in `packages/ai` and `apps/server` runs with `AI_PROVIDER=mock`; only `deepseekSmokeTest.ts` (never part of the automated suite) touches the real API
- PASS live API validation is a very small number of calls, not broad evaluation — exactly 2 new live calls added (1 classification, 1 intervention), both attempted and both hit the same documented sandbox network restriction as the pre-existing 3 calls
- PASS intervention never leaks the root cause — leak guard reused from hypothesis evaluation, both unit-tested and integration-tested via the adversarial case above
- PASS intervention never mutates score or bypasses the engine — structurally guaranteed (ADR-022): the proposal schema has no field capable of expressing a state mutation
- PASS the adaptive layer never stalls or corrupts the core game loop — `runGameMasterCheck` failures are caught and logged in `clock.ts`, never propagated; confirmed by `pnpm bots` runs completing normally across all 6 scenario/difficulty combinations with the Game Master wired in and live
- PASS architecture review conducted and meaningful findings fixed before phase completion — the scenario-specific-hardcoding bug (see above) found and fixed, with regression tests, before any new V0.4 feature code was written
- PASS existing tests remain green — every test file that existed before this phase (50 game-engine + 33 `packages/ai` post-bugfix + 48 server) continues to pass unmodified in behavior
- PASS new behavior has real test coverage — 19 new `packages/ai` tests (`collectiveState.test.ts` 7, `interventionValidator.test.ts` 8, plus classification/intervention cases folded into `mockProvider.test.ts` and `deepseekProvider.test.ts`) and 8 new `apps/server` tests (`v0.4.test.ts`)
- PASS docs updated — `docs/AI_DESIGN.md` (new "Adaptive Game Master" section), `docs/DECISIONS.md` (ADR-022), `docs/DATABASE.md` (`game_interventions` table, widened `chat_messages.kind`), `docs/WEBSOCKET_PROTOCOL.md` (`ai_intervention` chat kind)

**Tests run**: `packages/game-engine` 50/50 (unchanged from V0.3). `packages/ai` 69/69 (was 33 after the
pre-V0.4 bugfix commit, +36 new: `collectiveState.test.ts` 7, `interventionValidator.test.ts` 8,
`mockProvider.test.ts` grew from 15→29 [+14], `deepseekProvider.test.ts` grew from 8→15 [+7]).
`apps/server` 56/56 (was 48, +8 in new `v0.4.test.ts`). Root `pnpm run build` / `pnpm run typecheck` /
`pnpm run lint` all clean across all 5 workspace packages. Combined total across the whole monorepo:
**175 automated tests, all passing.**

**Runtime verification**: `pnpm bots` run live against the server with `AI_PROVIDER=mock` — server log
confirms `runGameMasterCheck` fired mid-game and correctly classified/delivered a real
`IGNORING_CRITICAL_SIGNAL` intervention (`intervened: true, reason: "delivered"`), and the full
room-creation-to-scored-debrief loop still completed normally afterward (score 87/100) — the Game
Master added a chat message and nothing else broke or was blocked. A separate Playwright browser run
(3 real player sessions, demo-duration game, ~55s real-time wait past the first classification window)
confirmed the negative case just as clearly: with no investigation activity yet, the team was correctly
classified `INSUFFICIENT_EVIDENCE` (`intervened: false, reason: "classification is not
intervention-eligible"`) rather than a false/premature nudge — i.e. the system's default is silence,
not chattiness, exactly as designed.

**DeepSeek calls made this phase**: 2 new live calls attempted (`classifyTeamState`,
`proposeIntervention`, via `deepseekSmokeTest.ts`), alongside the pre-existing 3. All 5 hit the
sandbox's `403 Host not in allowlist: api.deepseek.com` network restriction (same root cause as V0.1,
re-confirmed with a real `DEEPSEEK_API_KEY` present and via a direct `curl` to the API). The
graceful-fallback path was verified for real for both new operations: genuine network failures, caught
correctly, degraded to `MockAIProvider`, valid schema-conforming results returned with
`meta.usedFallback: true`. No workaround was attempted (bypassing the proxy is out of bounds
regardless of reason). Real DeepSeek response quality for `classifyTeamState`/`proposeIntervention`
was **not** verified this session — same documented gap as the original 3 operations.

**Approximate spend this phase**: $0.00 (a network-layer 403 is never billed — the request never
reached the model). Cumulative: **$0.00 of $8.00**.

**Bugs found**: the scenario-specific-hardcoding bug described above and in commit `1c8efed` (found
during this phase's architecture review, fixed and regression-tested before any new V0.4 feature code
was written, so it's recorded as a fix that happened *during* V0.4 even though its root cause predates
it). No new bugs found in the V0.4 feature code itself during this phase's review/testing.

**Architecture changes**: two new files establish a clean boundary — `packages/ai/src/collectiveState.ts`
(pure, no I/O, game-engine-adjacent) and `apps/server/src/services/gameMasterService.ts` (the only
place classify → propose → validate → budget → deliver is orchestrated; sockets/clock.ts calls it and
nothing else does). `ScenarioDefinition` gained a `scoringHints` field (part of the pre-existing-bug
fix, not new V0.4 surface, but shipped in this phase) making per-scenario keyword-based heuristics a
declared part of the scenario's own data rather than an assumption baked into `packages/ai`. ADR-022
records the "interventions are chat-messages-only, no new mutation type" decision explicitly.

**Known remaining limitations**: the Game Master's classification heuristic (mock mode) and its
templated intervention messages are, like every other mock heuristic in this project, a testable
approximation, not a substitute for the real model's judgment — real DeepSeek classification/
intervention quality is unverified in this environment (see "DeepSeek calls made this phase"). The
intervention budget/cooldown/confidence values (3 / 60s / 0.5) are fixed constants, not tuned against
real playtesting data or configurable per scenario/difficulty.

---

## V0.5 — AI-assisted scenario generation

**Goal**: let a host generate a new, playable incident scenario from a free-text request (e.g. "Create
an intermediate Kubernetes incident caused by a broken readiness configuration"), held to a strict
generation schema and a deterministic structural validator, with a single bounded AI semantic-review
pass, a bounded repair loop for structurally broken output, budget-conscious live evaluation, and a
lightweight (not no-code-editor) authoring UI — without ever lowering the bar a generated scenario
must clear relative to a hand-authored one.

**What changed**:
- **Strict Generation Schema** (`GeneratedScenarioSchema`, `packages/ai/src/schemas.ts`): mirrors
  `GeneratedScenarioDefinition` field-for-field with real bounds (string/array lengths, enum values) —
  a response that doesn't parse against this is never treated as valid content, full stop.
- **Deterministic Validator** (`validateGeneratedScenario`,
  `packages/game-engine/src/scenarioGenerationValidator.ts`): the cross-reference/executability layer
  a shape schema can't express — real roles, no duplicate tool/evidence ids, every evidence unlock
  references a real tool, every `keyEvidenceIds` entry references real evidence, a monotonic timeline,
  every investigative role has at least one tool, rubric weights sum to 100. Provider-agnostic: the
  same function protects a live DeepSeek generation, `MockAIProvider`'s output, and a human-submitted
  `/save` payload alike.
- **Repair Loop**: no new machinery — `DeepSeekProvider.generateScenario` passes
  `validateGeneratedScenario` as the exact semantic-validation callback every other operation's
  existing `run()` retry pipeline already takes, so a structurally broken candidate triggers the same
  bounded, in-conversation repair-prompt retry (capped by `AI_MAX_RETRIES`) a leaked hypothesis
  rationale or hallucinated evidence id already does elsewhere (ADR-023).
- **Semantic Review**: `semanticReviewScenario`, exactly one AI call per generation attempt, only
  ever reached once a candidate already passed the schema and the deterministic validator — reviews
  causal consistency, role balance, answer leakage, red-herring plausibility, remediation validity,
  and scenario coherence, returning `{passed, issues[]}`.
- **Materialization**: `GeneratedScenarioDefinition` uses the same fractional (`atFraction`) time
  representation the 3 built-in scenarios' internal types already used. Extracted
  `materializeFractionalEvidence`/`materializeFractionalTimeline`
  (`packages/game-engine/src/fractionalScenario.ts`) out of 3x-duplicated inline logic in the
  hand-authored scenario files (verified behavior-identical — all pre-existing game-engine tests
  passed unchanged before and after) so a generated scenario reuses the identical scaling functions
  rather than a 4th implementation of the same math (ADR-024). `buildGeneratedScenario` composes that
  materializer with the same `applyDifficulty()` every built-in scenario uses.
- **Persistence + playability**: a new `generated_scenarios` table (global content, not room/game-
  scoped) stores the saved, difficulty-neutral definition. `gameLoader.resolveScenario` checks the
  built-in registry first, then falls back to this table — the *only* place server code distinguishes
  a generated scenario from a built-in one; everything downstream (scoring, the Game Master,
  difficulty, evidence unlocking) works from a plain `ScenarioDefinition` with zero awareness of
  where it came from. `GET /api/scenarios` merges both sources into one catalog; `roomService.startGame`
  accepts either kind of scenario id.
- **REST API**: `POST /api/scenarios/generate` (generate + validate + one review call, saves
  nothing) and `POST /api/scenarios/save` (re-validates deterministically — no AI call — and
  persists, disambiguating a proposed id against every existing scenario id rather than overwriting).
- **Mock Mode**: `MockAIProvider.generateScenario` is a deterministic, keyword-parameterized template
  (not real language generation) that always produces a structurally-valid, quality-checklist-passing
  candidate regardless of the input description — every automated test runs against this.
- **Scenario Authoring UI** (`apps/web/src/components/ScenarioGeneratorPanel.tsx`): a description box,
  a Generate button, a compact preview (title/briefing/severity/tool+evidence counts) with the
  validation/review results inline, and a Save button — deliberately not a field-by-field editor; a
  saved scenario is immediately added to the lobby's existing scenario picker and auto-selected.
- Bumped the JSON body-size limit (64kb → 512kb) for `POST /api/scenarios/save`'s full
  scenario-definition payload — every other route's payloads stay tiny.

**Acceptance conditions**:
- PASS host can request a generated scenario in natural language and get a full, playable definition — `POST /api/scenarios/generate`, verified in `v0.5.test.ts` and live in a real browser (description in, valid candidate out)
- PASS generated content is never accepted raw/unvalidated — `GeneratedScenarioSchema` (shape) + `validateGeneratedScenario` (cross-reference/executability), both mandatory before anything is eligible to save
- PASS deterministic validator catches structurally broken output (invalid roles/ids, dangling references, duplicates, non-executable roles, bad rubric weights) — 12 dedicated unit tests (`scenarioGenerationValidator.test.ts`) plus 2 adversarial integration tests (missing-evidence reference, broken unlock graph) via `POST /api/scenarios/save`
- PASS semantic review checks the 6 named dimensions (causal consistency, role balance, answer leakage, red-herring plausibility, remediation validity, scenario coherence) and is never run more than once per attempt — enforced by `scenarioGenerationService.ts`'s call structure (review only reachable after validation passes, no loop around it)
- PASS repair loop is bounded, not unbounded retries — reuses the existing `AI_MAX_RETRIES`-capped `run()` pipeline (ADR-023), verified by `deepseekProvider.test.ts`'s repair-then-succeed and repair-exhausted-then-fallback cases
- PASS budget-efficient: automated tests use MockAI exclusively, only a small number of live calls attempted — every `packages/ai`/`apps/server` test runs against `MockAIProvider`; exactly 2 new live calls in `deepseekSmokeTest.ts` for this phase
- PASS a saved generated scenario is genuinely playable, not just validated — end-to-end real-socket test in `v0.5.test.ts` (generate → save → start a real game → execute a tool → submit a final diagnosis → receive a real score) plus a full real-browser run of the same flow
- PASS a generated scenario is held to the same quality bar as a hand-authored one — the mock generator's output passes the full 14-check `evaluateScenarioQuality` checklist once materialized (`scenarioGeneration.test.ts`), same as all 3 built-in scenarios
- PASS scenario id collisions are disambiguated, never silently overwritten — `uniqueScenarioId`, verified by a dedicated test generating the same description twice and asserting two distinct saved ids
- PASS an invalid/unsaved scenario id is still rejected when starting a game — `INVALID_PAYLOAD`, verified unchanged from V0.3's equivalent check, now also checked against the `generated_scenarios` table
- PASS authoring UI is lightweight, not a no-code editor — a description box, Generate, a read-only preview, Save; no field-by-field editing exists anywhere in `ScenarioGeneratorPanel.tsx`
- PASS existing tests remain green — every V0.1-V0.4 test file (50 game-engine + 69 `packages/ai` + 56 server = 175 tests) continues to pass unmodified in behavior, including after the fractional-scenario DRY refactor
- PASS new behavior has real test coverage — 12 new game-engine tests, 22 new `packages/ai` tests (`scenarioGeneration.test.ts` 8, plus 7 new `deepseekProvider.test.ts` generation cases, plus schema additions), 11 new server tests (`v0.5.test.ts`)
- PASS docs updated — `docs/AI_DESIGN.md` (new "AI-Assisted Scenario Generation (V0.5)" section with a full pipeline diagram), `docs/DECISIONS.md` (ADR-023, ADR-024), `docs/DATABASE.md` (`generated_scenarios` table + JSONB rationale), `docs/WEBSOCKET_PROTOCOL.md` (new REST routes), `docs/GAME_DESIGN.md` ("Custom (AI-generated) scenarios" section), `docs/TESTING.md`

**Tests run**: `packages/game-engine` 62/62 (was 50, +12 in new `scenarioGenerationValidator.test.ts`;
all pre-existing tests unchanged in behavior after the fractional-scenario DRY refactor of the 3
built-in scenario files). `packages/ai` 83/83 (was 69, +14 in new `scenarioGeneration.test.ts`
[8] and extended `deepseekProvider.test.ts` [+6 net, 7 new generation cases]). `apps/server` 67/67
(was 56, +11 in new `v0.5.test.ts`). Root `pnpm run build` / `pnpm run typecheck` / `pnpm run lint`
all clean across all 5 workspace packages. Combined total across the whole monorepo: **212 automated
tests, all passing.**

**Runtime verification**: real Chromium (Playwright) end-to-end run — 3 real player joins → host
expands "Generate a custom scenario," submits "A broken circuit breaker configuration causing
cascading timeouts" → generation succeeds, passes structural validation and semantic review, preview
card renders real tool/evidence counts → Save → scenario appears in the picker and gets auto-selected
→ all players ready → host starts the game → in-game view renders normally (tools/evidence panel,
timeline) with the generated content, not a built-in scenario's. Separately, `apps/server/src/scripts/
deepseekSmokeTest.ts` extended with 2 new live-call attempts (see "DeepSeek calls made this phase").

**DeepSeek calls made this phase**: 2 new live calls attempted (`generateScenario`,
`semanticReviewScenario`, via `deepseekSmokeTest.ts`), alongside the pre-existing 5 (V0.1 + V0.4). All
7 hit the sandbox's `403 Host not in allowlist: api.deepseek.com` network restriction — re-confirmed
this phase with a real, plausible-looking `DEEPSEEK_API_KEY` supplied (the user asked mid-session
whether a specific key worked; the answer is that this sandbox's outbound proxy rejects the CONNECT
tunnel to `api.deepseek.com` before the key is ever checked, confirmed via a direct `curl` returning
the identical 403 — a network-policy fact independent of which key is used, not a credential problem).
The graceful-fallback path was verified for real for both new operations: genuine network failures,
caught correctly, degraded to `MockAIProvider`, valid schema-conforming results returned with
`meta.usedFallback: true`. No workaround was attempted. Real DeepSeek response quality for scenario
generation/review was **not** verified this session — same documented gap as every other operation.

**Approximate spend this phase**: $0.00 (a network-layer 403 is never billed — the request never
reached the model). Cumulative: **$0.00 of $8.00**.

**Bugs found**: none in new V0.5 code during this phase's review/testing. (The 3 built-in scenario
files were refactored, not just extended, to extract the shared fractional-materialization helper —
this was verified as a pure, behavior-preserving refactor by running the full pre-existing game-engine
test suite unchanged before and after, rather than by inspection alone.)

**Architecture changes**: `fractionalScenario.ts` is a new shared module in `packages/game-engine`
that both the 3 built-in scenario builders and the new generated-scenario materialization path depend
on — a genuine DRY improvement (3x duplicated logic → 1 implementation), not just new-feature-adjacent
code. `scenarioGenerationValidator.ts` establishes a second, distinct validation layer alongside the
existing `scenarioValidation.ts` (design-quality checklist) — deliberately not merged into one file,
since they check different things (executability vs. design quality) and run at different points in
the pipeline (before vs. after materialization). `gameLoader.resolveScenario` is the single new
integration point where server code distinguishes a built-in scenario from a generated one; no other
file needed to change to support playing a generated scenario.

**Known remaining limitations**: the scenario-authoring UI has no way to edit a generated candidate
field-by-field (by design — V0.5.7 explicitly scoped out a no-code editor; the only correction
mechanism is regenerating with a clearer description). `POST /api/scenarios/generate` and `/save` are
unauthenticated and not rate-limited beyond the flat socket-layer limiter that doesn't cover REST
routes — acceptable at MVP scope (no accounts, no public deployment target yet) but would need
attention before a public-facing deployment, same caveat as the rest of this project's known
production-hardening gaps (no CI, no load testing). Real DeepSeek generation/review quality remains
unverified in this sandboxed environment.

---

## V0.6 — Social + replay layer

**Goal**: turn a single finished game into something a team actually wants to do again and show
off — a debrief that reflects the real game just played (not just a grading outcome), a low-friction
way to start another round without losing the group, a lightweight sense of progress across a
session with no accounts, and a way to share a result outside the room — all without ever inventing
a metric, a percentile, or a "skill rating" the data doesn't support.

**What changed**:
- **V0.6.1 Debrief upgrade** (`packages/shared/src/domain.ts`, `apps/server/src/services/
  finalizationService.ts`): `Debrief` gained `scenarioId`, `scenarioTitle`, `severity`, `difficulty`,
  `completionSeconds`, and a new `roleContributions: RoleContribution[]` — one row per player with
  `toolsExecuted`, `evidenceUnlocked`, `hypothesesProposed`, `knownFactsAdded`, all computed from real
  persisted rows (`tool_actions`, `game_evidence`, `hypotheses`, `known_facts`), never estimated. Two
  new repo queries (`findUnlockedEvidenceRows`, `findToolActionsForGame` in `gameContentRepo.ts`)
  return every row (not just distinct executors) so per-player counts can be built without N+1 queries
  — `buildRoleContributions()` issues a fixed 4 queries regardless of player count. `DebriefView.tsx`
  renders the new fields: severity/difficulty badges, scenario title, elapsed time, and a role-
  contributions table.
- **V0.6.2 Session-level stats** (`apps/web/src/lib/sessionStats.ts`): purely client-side,
  `localStorage`-backed, keyed by gameId so a re-render or reconnect can never double-count a game.
  Tracks games completed, average score, fastest diagnosis, roles played, scenarios completed — every
  field a real recorded fact pulled straight from that game's `Debrief`. Rendered on the landing page
  with an explicit "tracked locally in this browser only - not a validated skill rating, no accounts
  involved" disclaimer, and only shown once at least one game has been recorded.
- **V0.6.3 Rematch/replay UX** (`apps/web/src/lib/lastPlayed.ts`, `LobbyView.tsx`, `DebriefView.tsx`):
  the debrief screen's host controls became two buttons — **Play again** (rematch, and the lobby's
  scenario/difficulty/duration picker pre-fills from `localStorage`'s last-played choice so the host
  doesn't have to reconfigure) and **New scenario** (rematch, plus a one-shot `sessionStorage` hint
  that makes the lobby's catalog picker deliberately land on a different scenario than the one just
  played). Neither button bypasses the server's existing ready-reset on rematch (`roomService.
  rematchRoom`) — that's a deliberate multiplayer-correctness safeguard (everyone consciously re-
  readies before a new round starts), not friction to remove. Roles are already freshly randomized on
  every `game:start` (unchanged since V0.1) — the debrief screen states this rather than adding a fake
  "randomize" toggle for something that's already unconditionally true. "Same group" is inherent:
  rematch reuses the same room/room code.
- **V0.6.4 Shareable results** (`apps/server/src/routes/games.ts`, `services/resultsService.ts`,
  `apps/web/src/pages/ResultView.tsx`): a public, read-only `GET /api/games/:gameId/result` returns
  `{gameId, completedAt, debrief}` for a finished game (404, never a partial/fabricated payload, for an
  unknown or not-yet-finalized game — access control is the unguessable gameId UUID itself, same
  posture as every other unauthenticated MVP-scope route). A new frontend route `/result/:gameId`
  renders a read-only summary card (score, root cause, team roster) with no socket connection and no
  session cookie required. The debrief screen's "Copy shareable result link" button builds the URL
  client-side.
- **V0.6.5 Room-scoped leaderboard** (`GET /api/rooms/:code/leaderboard`, `LeaderboardPanel.tsx`):
  every completed game played in a room, most recent first, built entirely from real persisted
  `game_results` rows joined against that room's `games`. Deliberately room-scoped, not global — with
  no accounts, a cross-room ranking would conflate different people under the same display name and
  imply a comparability the data doesn't support. Shown in the lobby once at least one game in the room
  has completed; empty (not an error) otherwise. Batches game-player lookups across all of a room's
  completed games in one query (`findGamePlayersForGames`) instead of one query per game.

**Acceptance conditions**:
- PASS debrief reflects real game events, never fabricated metrics — every new field (`roleContributions`,
  `completionSeconds`, `scenarioId/Title/severity/difficulty`) is sourced from persisted rows or the
  scenario definition already used to score the game; verified by `v0.6.test.ts` asserting a player who
  executed a tool/added a fact/proposed a hypothesis shows a real non-zero count and an idle player
  shows real zeros, never a guessed value
- PASS session stats never framed as a validated skill score — explicit disclaimer text on the landing
  page, `sessionStats.ts`'s own doc comment states this is not a cross-device profile
- PASS rematch/replay is low-friction — one click each for "Play again" (pre-filled scenario/difficulty)
  and "New scenario" (deliberately different scenario), both reusing the existing rematch mechanism
- PASS old game state cannot leak into a new game via the new debrief/leaderboard data — adversarial
  test in `v0.6.test.ts`: after a rematch, the second game's `roleContributions` are all real zeros
  (nobody touched a tool/hypothesis/fact in the fresh game), not a carry-over from the first game
- PASS shareable results derive from real stored data, no invented percentile ranking — `PublicGameResult`
  wraps the exact same `Debrief` a player already saw; `ResultView.tsx` renders no derived ranking at all
- PASS shareable result endpoint 404s (never a partial/fabricated result) for an unfinished or unknown
  game — 2 dedicated adversarial tests in `v0.6.test.ts`
- PASS leaderboard is optional, honest, and only built because it stayed straightforward — room-scoped
  (not global), sourced entirely from real `game_results`, empty array (not an error) when no games have
  completed yet, verified live and in `v0.6.test.ts`
- PASS existing tests remain green — every V0.1-V0.5 test file continues to pass unmodified in behavior
  (62 game-engine + 83 `packages/ai` + 67 pre-existing server tests, all still passing)
- PASS new behavior has real test coverage — 8 new server tests (`v0.6.test.ts`) covering the debrief
  upgrade, the public result endpoint (success + 2 adversarial 404 cases), and the leaderboard (empty,
  unknown room, and the rematch-no-leakage case)
- PASS full monorepo `pnpm run build` / `tsc --noEmit` clean across all 5 workspace packages
- PASS docs updated — this entry, `docs/DECISIONS.md`, `docs/GAME_DESIGN.md`, `docs/DATABASE.md`,
  `docs/WEBSOCKET_PROTOCOL.md`, `docs/TESTING.md`, `README.md`

**Tests run**: `packages/game-engine` 62/62 (unchanged — no game-engine code touched this phase).
`packages/ai` 83/83 (unchanged — no AI-provider code touched this phase; V0.6 has no AI surface).
`apps/server` 75/75 (was 67, +8 in new `v0.6.test.ts`). Root `pnpm run build` (`tsc -p` across all 5
packages, including `apps/web`'s `vite build`) clean. Combined total across the whole monorepo: **220
automated tests, all passing.**

**Runtime verification**: real Chromium (Playwright), 3 separate browser contexts. Full flow: create
room → 2 more players join → ready up → host starts a demo-duration game → a player runs a tool →
host submits a final diagnosis → debrief renders with severity/difficulty badges, scenario title,
elapsed time, a "Copy shareable result link" button, and a role-contributions table showing the real
per-player tool/evidence/hypothesis/fact counts (verified the tool-running player shows 1 tool + 1
evidence, the other two show real zeros) → host clicks "Play again" → room returns to LOBBY → the
lobby's leaderboard panel now shows the just-completed game (score, scenario, all 3 players with their
roles) → everyone re-readies → host starts a second game successfully. Separately verified: the public
`/result/:gameId` page renders the same score/root cause/team roster with no socket connection, for a
real gameId; a bogus gameId renders the server's real "No finished game with that id" message rather
than crashing or showing fabricated data. Separately verified: the landing page's session-stats panel
renders real recorded numbers and the "not a validated skill rating" disclaimer. Also ran `pnpm bots`
(bot-simulation script, unmodified) end-to-end and independently confirmed the live server's public
result endpoint via `curl` returns real per-role tool-execution counts matching the bot log exactly
(10/10/4/... tool executions).

**DeepSeek calls made this phase**: 0. V0.6 has no AI-provider surface — the debrief content fields
that already came from `aiProvider.generateDebrief` (V0.1) are unchanged; every new field this phase
is computed deterministically from persisted rows, not model output.

**Approximate spend this phase**: $0.00. Cumulative: **$0.00 of $8.00**.

**Bugs found**: one type error caught immediately by `tsc --noEmit` during development, not shipped —
`findUnlockedEvidenceRows`'s return type initially declared `unlockedByPlayerId: string`, but the
underlying `game_evidence.unlocked_by_player_id` column is nullable; fixed by correcting the type to
`string | null` and skipping null rows when aggregating per-player evidence counts, rather than
asserting non-null. One N+1 query pattern caught during the code-quality review pass before committing
(not shipped): the room leaderboard initially issued one `findGamePlayers` query per game in the room;
replaced with a single batched `findGamePlayersForGames(gameIds)` query.

**Architecture changes**: new `resultsService.ts` (`apps/server/src/services/`) is the single place
that builds public-facing result/leaderboard data from `games`/`game_results`/`game_players` — mirrors
the existing pattern of one service per read-model rather than growing `finalizationService.ts` or
`roomService.ts` to cover an unrelated concern. Two new REST routes (`GET /api/games/:gameId/result`,
`GET /api/rooms/:code/leaderboard`) are the first genuinely public (no room-session cookie, no socket)
authenticated-by-obscurity endpoints in the project beyond the V0.5 scenario-generation routes — same
documented MVP-scope tradeoff, called out again in "Known remaining limitations" below. No changes to
the state machine, the AI provider interface, or the scoring/evidence/unlock pipeline — V0.6 is purely
additive read-models plus client-side UX on top of data that already existed (`game_results.debrief`,
`tool_actions`, `game_evidence`, `hypotheses`, `known_facts`) or already happened (rematch, role
reassignment).

**Known remaining limitations**: `GET /api/games/:gameId/result` and `GET /api/rooms/:code/leaderboard`
are unauthenticated, same MVP-scope caveat as V0.5's scenario-generation routes — acceptable given no
accounts and no public deployment target yet, worth revisiting before one. Session stats and the
last-played/new-scenario hints live in `localStorage`/`sessionStorage` only — they don't survive a
cleared browser, a different device, or private browsing, and are explicitly not a substitute for
accounts. The room leaderboard has no pagination — fine at MVP scale (a handful of rematches per room
session) but would need one for a room played over a very long history. No new DeepSeek surface was
added or exercised this phase.

---

(V1 onward would be recorded below, if that phase existed — it does not: the governing task scope
stops at V0.6.)
