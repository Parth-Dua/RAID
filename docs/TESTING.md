# Testing

All automated tests run against `AI_PROVIDER=mock` — no test suite spends real API credits, and none
requires network access. `.env.test` (gitignored, `apps/server/.env.test`) points at a separate
`raid_test` database so integration tests never touch dev data.

## Commands and what they actually cover (run in this session)

```bash
# packages/game-engine - state machine, scoring, scenario unlock logic, scenario quality checklist,
# difficulty transform (V0.3), generated-scenario structural validator (V0.5)
cd packages/game-engine && pnpm exec vitest run
# 6 files, 62/62 tests passed

# packages/ai - mock provider behavior, leak guard, DeepSeek malformed-output handling,
# collective reasoning state + intervention validation (V0.4), scenario generation + semantic
# review (V0.5)
cd packages/ai && pnpm exec vitest run
# 6 files, 83/83 tests passed

# apps/server - REST, concurrency races, security/privacy, full game flow + reconnect + auto-finalize,
# scenario selection + rematch (V0.3), adaptive Game Master orchestration (V0.4), scenario
# generation/save/play (V0.5)
cd apps/server && NODE_ENV=test pnpm exec vitest run
# 9 files, 67/67 tests passed (one file takes ~65s: it genuinely waits out a real 60s
# "instant"-preset timer to prove auto-finalization fires without a submission)
```

212 tests total across the monorepo, all green as of the last full run (V0.5) — see
`docs/REVIEW_NOTES.md` for the handful of real bugs these caught and fixed along the way (several of
the original concurrency/security tests failed on their first run for genuine reasons, not test bugs),
and each phase's entry in `docs/MILESTONES.md` for what was added and why per phase.

### Why `apps/server`'s vitest.config.ts sets `fileParallelism: false`

Discovered the hard way: vitest runs test *files* in parallel worker processes by default. All four
server test files share one real Postgres database (`raid_test`) and each calls `TRUNCATE ... CASCADE`
in `afterEach`. Running them in parallel meant one file's truncate could fire while another file had
an in-flight room creation, producing intermittent `500 SERVER_ERROR` failures with no code bug behind
them. Integration tests against one shared external resource need to run sequentially — this is a
real, measured tradeoff (a slower `vitest run`, dominated by the one 60s timer test) in exchange for
tests that don't flake against each other, not a theoretical concern.

## What's covered, by layer

**Unit (`packages/game-engine`, `packages/ai`)**: phase-transition legality (including the ones that
must be *illegal* — skipping LOBBY→ACTIVE, re-entering STARTING, transitioning out of a terminal
state), evidence unlock timing (baseline text before a time threshold, real content after), role-based
evidence partitioning, score clamping against AI-supplied out-of-range/NaN/Infinity numbers, the
scenario structural-quality checklist, mock-provider heuristics, the leak guard, and DeepSeek's
malformed-output handling (invalid JSON, missing field, invalid enum, a root-cause leak attempt, a
hallucinated evidence id, a network failure, and a repair-prompt recovery path where the *second*
attempt succeeds).

**Integration (`apps/server/src/__tests__/`)**:
- `rooms.rest.test.ts` — create/join/get-room, room-full, invalid-room, empty-name validation.
- `concurrency.test.ts` — host double-start (both the "not everyone ready" guard and, separately, the
  real optimistic-concurrency race where exactly one of two simultaneous Start calls wins), duplicate
  `hypothesis:create` with the same `clientMsgId`, two concurrent `hypothesis:support` calls from the
  same player, and the final-submission race.
- `security.test.ts` — unauthenticated socket connection rejected, a garbage/malformed session cookie
  rejected (not a 500), a player's `game:snapshot` never contains another role's evidence even after
  it unlocks, a tool call for another role's tool is rejected, attaching a real-but-not-yet-unlocked
  evidence id is rejected, attaching evidence visible only to a different role is rejected, an
  outright hallucinated evidence id is rejected, only the Incident Commander (when one exists) may
  submit the final diagnosis, and oversized/malformed payloads are rejected by the Zod layer.
- `gameFlow.integration.test.ts` — a complete room-creation-to-scored-debrief run over real sockets;
  a reconnecting player keeps their identity/role/previously-unlocked evidence; a host disconnecting
  in the lobby transfers host to another connected player; the timer genuinely auto-finalizes a game
  with no submission once the clock runs out.
- `v0.3.test.ts` (V0.3) — the scenario catalog endpoint lists all 3 scenarios; a host's chosen
  scenario/difficulty is recorded and reflected back to every player; an unknown `scenarioId` is
  rejected with `INVALID_PAYLOAD` rather than silently falling back; each scenario actually produces
  its own distinct tools/evidence (not checkout-degradation's); a HARD game still runs end-to-end;
  rematch resets a COMPLETED room to LOBBY and every player's ready state; only the host can rematch;
  rematch is rejected outside COMPLETED; a full rematch → new scenario → new game cycle produces a
  fresh `gameId` and fresh role assignment with zero leakage from the old game; a stale `final:submit`
  fired against an already-rematched room is rejected rather than corrupting the new LOBBY room.
- `v0.4.test.ts` (V0.4) — a non-intervention-eligible classification (`ON_TRACK`) never even calls
  `proposeIntervention`; `SOLVING_TOO_QUICKLY`/`INSUFFICIENT_EVIDENCE` also never intervene; a valid
  intervention is delivered as an `ai_intervention` chat message and recorded in `game_interventions`
  history; a proposal that leaks the root cause is discarded before delivery (the adversarial "AI
  intervention attempts root-cause leak" case); a below-threshold-confidence proposal is discarded; the
  AI's own decision not to intervene is respected; the per-game budget (max 3) is enforced; the
  60-second cooldown between deliveries is enforced. Classification/proposal results are forced via
  `vi.spyOn(aiProvider, ...)` so this file tests the budget/cooldown/validation *orchestration* in
  `gameMasterService.ts` directly and deterministically — the classification heuristic itself is
  exhaustively covered at the `packages/ai` unit level instead (`mockProvider.test.ts`).
- `v0.5.test.ts` (V0.5) — `POST /api/scenarios/generate` returns a structurally-valid,
  review-passed candidate and never persists anything as a side effect; rejects an empty/overlong
  description; `POST /api/scenarios/save` persists a valid candidate into the scenario catalog,
  disambiguates an id collision rather than overwriting, and re-validates (rejecting) a tampered
  candidate that references missing evidence (adversarial case) or a broken unlock graph
  (adversarial case) or doesn't match the schema at all; and, end-to-end, a saved generated scenario
  can actually be started, played through real tool execution, and completed with a real score - the
  same real-socket flow every built-in scenario is tested through, proving a generated scenario is
  genuinely indistinguishable from a built-in one once saved. Also confirms starting a game with a
  scenario id that was never generated or saved is still rejected with `INVALID_PAYLOAD`.

**System-level (`apps/server/src/scripts/botSimulation.ts`)**: not a vitest suite — a standalone
script that drives 4 real `socket.io-client` connections through the *actual* REST + Socket.IO API
(no test-only shortcuts) from room creation to a scored debrief, including two tool-execution passes
that prove time-gated evidence really does stay hidden until its threshold and then appear. Since V0.3
it accepts `RAID_SCENARIO_ID` and `RAID_DIFFICULTY` env vars (defaulting to `checkout-degradation` /
`NORMAL`) so the same script exercises any of the 3 scenarios at either difficulty — its
`FINAL_SUBMISSIONS` map holds the matching root-cause/remediation text per scenario id. Run it against
a live dev server:

```bash
pnpm dev            # or just the server: pnpm --filter @raid/server dev
pnpm bots            # apps/server: pnpm exec tsx src/scripts/botSimulation.ts

# or target a specific scenario/difficulty:
RAID_SCENARIO_ID=lock-contention RAID_DIFFICULTY=HARD pnpm bots
```

This is the regression tool referenced by the spec's "system test / bot players" requirement, and it
was what caught the very first real bug in this project (a `waitForEvent` listener race — see
`docs/REVIEW_NOTES.md`).

**Manual/browser verification (`apps/web`)**: the web app has no automated test suite of its own (see
"known limitations" below) — its correctness was verified by actually driving it with a real headless
Chromium (Playwright) through multiple separate browser contexts (i.e. genuinely separate cookie
jars/sessions, not one page pretending to be four players): create room → 3 real joins → ready → host
start → tool execution with a real result rendered in the DOM → chat → hypothesis proposal → final
submission → a fully rendered debrief screen with the real score breakdown. Screenshots from that run
are not committed to the repo (they were scratch verification artifacts), but the flow is exactly what
`docs/GAME_DESIGN.md`'s game loop describes and what the bot script exercises server-side.

V0.3 added the same style of browser verification for the lobby's scenario/difficulty picker (host
selects Order Processing Stall + HARD, confirms scenario-specific content renders after start, not
checkout-degradation's) and for rematch (submit final answer → debrief renders → host clicks "Play
again with this group" → room returns to a clean LOBBY with the scenario picker visible again and no
leftover debrief content from the previous round).

V0.4's adaptive Game Master was runtime-verified two ways: a `pnpm bots` run whose server log shows
`runGameMasterCheck` firing mid-game, correctly classifying the team's state, and delivering a real
intervention (confirmed by the bot script's full loop still completing normally, score 87/100,
afterward); and a Playwright run confirming the negative case — a team with no investigation activity
yet is classified `INSUFFICIENT_EVIDENCE` and correctly gets no intervention, rather than a premature
or spammy one. See `docs/MILESTONES.md`'s V0.4 entry for the exact log lines and reasoning.

V0.5's scenario authoring UI was verified end-to-end in a real browser: expand the "Generate a custom
scenario" panel, submit a free-text description, confirm the candidate passes both structural
validation and semantic review and the preview card renders real tool/evidence counts, click Save,
confirm it appears in the scenario picker and gets auto-selected, then actually start and load a game
with that generated scenario (confirming the in-game view renders normally, not just that the save
succeeded).

## Failure-mode tests specifically (spec section 34 "Failure tests")

| Required case | Where it's covered |
|---|---|
| DeepSeek timeout | `deepseekProvider.test.ts` "falls back gracefully on a network timeout/error" |
| Malformed DeepSeek JSON | `deepseekProvider.test.ts` invalid JSON / missing field / invalid enum / leak / hallucinated-id cases |
| DB error | `playersRepo.insertPlayer`'s room-full path is a real transactional guard exercised by `rooms.rest.test.ts`; a raw DB error surfacing as a clean `NOT_AUTHORIZED` rather than a raw Postgres error is covered by `security.test.ts` "garbage cookie" |
| Socket reconnect | `gameFlow.integration.test.ts` reconnect test |
| Invalid room | `rooms.rest.test.ts` "rejects joining a nonexistent room" |
| Expired/invalid session | `security.test.ts` socket-authentication tests |
| Invalid phase transition | `concurrency.test.ts` host-double-start; `packages/game-engine` state-machine unit tests for the illegal-transition cases directly |
| AI intervention attempts root-cause leak (V0.4) | `interventionValidator.test.ts` (unit) and `v0.4.test.ts` "discards ... an intervention proposal that leaks the root cause" (integration, via `runGameMasterCheck`) |
| Generated scenario references missing evidence (V0.5) | `scenarioGenerationValidator.test.ts` (unit) and `v0.5.test.ts` "rejects ... a candidate that references missing evidence" (integration, via `POST /api/scenarios/save`) |
| Generated scenario has a broken unlock graph (V0.5) | `scenarioGenerationValidator.test.ts` (unit, "rejects an evidence unlock referencing an unknown tool id") and `v0.5.test.ts` "rejects ... a candidate with a broken unlock graph" (integration) |
| Rematch while old events are in flight | `v0.3.test.ts` "a stale final:submit against an already-completed, already-rematched game is rejected" |

## Known gaps

- No dedicated frontend unit/component test suite (no Vitest + Testing Library setup in `apps/web`).
  Given the time budget, verification leaned on the server-side integration suite (which exercises the
  exact same API surface the frontend calls) plus real-browser manual/scripted verification. If this
  were to keep growing, component tests for `GameProvider`'s event-merging reducer logic (the trickiest
  client-side logic — merging incremental socket events into the snapshot) would be the first thing
  worth adding.
- No load/soak test. The MVP's expected concurrency (a handful of simultaneous rooms) was never
  actually stress-tested; `docs/EVALUATION.md` calls this out as an explicit unknown, not a proven
  characteristic.
