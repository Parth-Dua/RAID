# Testing

All automated tests run against `AI_PROVIDER=mock` — no test suite spends real API credits, and none
requires network access. `.env.test` (gitignored, `apps/server/.env.test`) points at a separate
`raid_test` database so integration tests never touch dev data.

## Commands and what they actually cover (run in this session)

```bash
# packages/game-engine - state machine, scoring, scenario unlock logic, scenario quality checklist
cd packages/game-engine && pnpm exec vitest run
# 4 files, 20/20 tests passed

# packages/ai - mock provider behavior, leak guard, DeepSeek malformed-output handling
cd packages/ai && pnpm exec vitest run
# 3 files, 18/18 tests passed

# apps/server - REST, concurrency races, security/privacy, full game flow + reconnect + auto-finalize
cd apps/server && NODE_ENV=test pnpm exec vitest run
# 4 files, 24/24 tests passed (one file takes ~65s: it genuinely waits out a real 60s
# "instant"-preset timer to prove auto-finalization fires without a submission)
```

62 tests total, all green as of the last full run in this session (see `docs/REVIEW_NOTES.md` for the
handful of real bugs these caught and fixed along the way — several of the concurrency/security tests
failed on their first run for genuine reasons, not test bugs).

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

**System-level (`apps/server/src/scripts/botSimulation.ts`)**: not a vitest suite — a standalone
script that drives 4 real `socket.io-client` connections through the *actual* REST + Socket.IO API
(no test-only shortcuts) from room creation to a scored debrief, including two tool-execution passes
that prove time-gated evidence really does stay hidden until its threshold and then appear. Run it
against a live dev server:

```bash
pnpm dev            # or just the server: pnpm --filter @raid/server dev
pnpm bots            # apps/server: pnpm exec tsx src/scripts/botSimulation.ts
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
