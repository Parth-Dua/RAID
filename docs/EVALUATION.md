# Evaluation

Self-assessment against the dimensions the design brief calls out, grounded in what was actually run
this session (test output, real browser sessions, real bot-script runs) rather than asserted from
reading the code. Scores are out of 5, with the evidence that justifies each score.

## Architecture — 4/5

**Evidence for**: clear four-layer boundary (transport → services → game-engine → repositories,
`docs/ARCHITECTURE.md`) held up under implementation without needing revision. `packages/game-engine`
has zero I/O — every function in it is pure and unit-testable without a database, which is exactly why
20 unit tests run in under a second. AI sits behind one interface (`AIProvider`) constructed in exactly
one file. No circular package dependencies (`@raid/shared` ← `@raid/game-engine`, `@raid/ai` ← both;
`apps/server` ← all three; `apps/web` ← `@raid/shared` only).

**Evidence against**: one real coupling issue was found and fixed during implementation (a temporary
circular import between `gameService.ts` and `finalizationService.ts`, resolved by extracting
`gameLoader.ts` — see `docs/REVIEW_NOTES.md`), meaning the first-draft module boundary wasn't quite
right. `gameService.ts` is the largest single file in the server (snapshot assembly + five distinct
action handlers) and would be the first candidate to split further if it kept growing.

## Multiplayer correctness — 4/5

**Evidence for**: the full concurrency test suite (host double-start, duplicate hypothesis submission,
simultaneous support, final-submission race) passes against a real Postgres database with real
simultaneous socket calls, not mocked timing. Role-based evidence isolation is verified by actually
building a second player's snapshot after evidence unlocks and asserting the id never appears, not by
asserting "the code looks like it filters correctly." Reconnect was verified by disconnecting and
reconnecting a real socket mid-game and checking role/evidence survive.

**Evidence against**: horizontal scaling is undesigned-for in practice (single in-memory timer per
process, no Redis adapter) — acceptable per ADR-009/DEPLOYMENT.md for MVP scale, but it is a real
ceiling, not a hypothetical one, and hasn't been load-tested even at single-process scale (see
"Reliability" below).

## Game quality — 4/5

**Evidence for**: the scenario passes every check in its own automated structural-quality checklist
(rubric sums to 100, key evidence spans 3 roles, every role has a red herring, timeline is monotonic,
no orphaned evidence). The bot script's two-pass tool execution concretely demonstrated the
time-gating mechanic works as designed (baseline text before the threshold, real evidence after).
Manually driving four separate real browser sessions through a full game showed the asymmetric-
information design working as intended — no player's screen shows another role's tools or evidence.

**Evidence against**: "is it fun" was assessed by one full playthrough via automation/scripted browser
control, not by a human actually playing with three friends under time pressure — the single strongest
form of validation this scenario hasn't had. The "Open Questions" knowledge-board category from the
original brief was scoped out (see `docs/GAME_DESIGN.md` known limitations) rather than built.

## AI quality — 4/5

**Evidence for**: every one of the required malformed-output test cases is covered with a real
simulated failure (invalid JSON, missing field, invalid enum, an attempted root-cause leak, a
hallucinated evidence id, a network error) and each correctly falls back rather than corrupting state
or throwing to the client. The leak guard's false-positive tradeoff (it will occasionally reject a
legitimate rationale that happens to combine two already-known facts) is documented as a deliberate
choice, not discovered as a bug. Cost discipline is real, not asserted: AI is called exactly 3 times
per game action-class (hypothesis, final eval, debrief), never for chat/timers/tools, and every
invocation logs latency/success/fallback.

**Evidence against**: a real (non-mocked) DeepSeek smoke test was attempted this session
(`apps/server/src/scripts/deepseekSmokeTest.ts`) and hit a genuine external blocker — the sandboxed
dev environment's outbound proxy returned `403 Host not in allowlist` for `api.deepseek.com`,
confirmed via the proxy's own status endpoint rather than assumed. This is honestly reported rather
than glossed over: real DeepSeek response quality and latency were **not** observed this session. What
the failed run did verify for real is the fallback path itself — all three calls hit a genuine network
error (not simulated) and correctly degraded to `MockAIProvider` with `usedFallback:true` logged, which
is real evidence for the reliability claim even though it isn't the evidence this line was originally
trying to gather.

## Reliability — 3/5

**Evidence for**: every failure-mode test the spec explicitly lists is covered (see
`docs/TESTING.md` "failure-mode tests" table) with a real simulated failure, not a hypothetical
description. A malformed session cookie correctly returns `NOT_AUTHORIZED` rather than a raw Postgres
error — a real bug (a non-UUID playerId hitting the DB unescaped) was found and fixed via this exact
test, not by inspection.

**Evidence against**: no load or soak testing was performed — the "handful of concurrent rooms" scale
assumption underlying the deployment/scaling ADRs is a design assumption, not a measured one. The
in-memory rate limiter and per-game timer have no test coverage for behavior under many simultaneous
active games. This is the honest weakest-evidence category in this evaluation.

## Developer experience — 4/5

**Evidence for**: `pnpm install && docker compose -f docker/docker-compose.yml up -d db && pnpm db:migrate && pnpm dev` is the actual working setup path (exercised this session, not just written down) — `AI_PROVIDER=mock` by default means a fresh clone runs and passes its full test suite with zero external credentials. `pnpm bots` gives an immediate, real, observable end-to-end proof the whole stack works without opening a browser.

**Evidence against**: no CI configuration is included (no `.github/workflows`), so "does this repo's
test suite actually run green in a clean environment" depends on someone running the commands in
`docs/TESTING.md` by hand rather than a pipeline enforcing it on every push.

## Overall

Strongest where the spec asked for defensible engineering under test — concurrency, security/privacy,
AI failure handling — because those are exactly the areas this session wrote real tests against real
infrastructure and fixed real bugs the tests found (four of them, documented in
`docs/REVIEW_NOTES.md`, none of which would have been caught by code review alone). Weakest where
validation requires things this session's time budget didn't stretch to: a human playtest, a
production build of the web app, and any load testing.
