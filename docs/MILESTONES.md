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

(V0.4 onward recorded below as each phase completes.)
