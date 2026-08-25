# RAID

A real-time, multiplayer, AI-adjudicated incident-response game. 3-4 players each see a different
slice of one production outage — different logs, different metrics, different tools — and have a
fixed clock to combine what they know into a correct root cause before time runs out. Think incident
war room × escape room × social deduction × debugging simulator.

```
┌──────────────────────────────────────────────────┐
│ RAID #A82F       SEV-1       14:32 REMAINING      │
├───────────────────────┬────────────────────────────┤
│ YOUR ROLE / TOOLS      │ SHARED INCIDENT           │
│ Backend Engineer       │ Timeline · Known facts     │
│ Logs · Traces · Deploy │ Hypotheses                │
├───────────────────────┼────────────────────────────┤
│ PRIVATE FINDINGS       │ TEAM CHAT                 │
└───────────────────────┴────────────────────────────┘
```

## Quick start

```bash
pnpm install
docker compose -f docker/docker-compose.yml up -d db   # local Postgres
pnpm db:migrate                                          # from apps/server, or: pnpm --filter @raid/server run db:migrate
pnpm dev                                                  # builds packages, then runs web (5173) + server (4000)
```

Defaults to `AI_PROVIDER=mock` — no API key needed to play, develop, or run the full test suite.
Copy `apps/server/.env.example` → `.env` and `apps/web/.env.example` → `.env` to customize; set
`AI_PROVIDER=deepseek` and `DEEPSEEK_API_KEY` to use the real model. See `docs/DEPLOYMENT.md`.

**See it work end-to-end without opening a browser**: `pnpm bots` (from `apps/server`, server must be
running) drives 4 real socket connections through the entire game loop — room creation, roles, timed
evidence unlocking, AI hypothesis feedback, final diagnosis, scoring, debrief.

## Documentation

| Doc | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagram, domain boundaries, lifecycle/sequence diagrams |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 19 ADRs — every major technical choice, with evidence, not just theory |
| [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) | The scenario, roles, asymmetric information, scenario-quality checklist |
| [`docs/AI_DESIGN.md`](docs/AI_DESIGN.md) | Why AI, where, the validation loop, cost discipline |
| [`docs/WEBSOCKET_PROTOCOL.md`](docs/WEBSOCKET_PROTOCOL.md) | Every event, payload, auth rule, broadcast scope |
| [`docs/DATABASE.md`](docs/DATABASE.md) | ER diagram, why JSONB where it's used, concurrency constraints |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | MVP topology, scaling path, why not FaaS |
| [`docs/TESTING.md`](docs/TESTING.md) | Exact commands, what's covered, known gaps |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | Scored self-assessment with evidence for and against each score |
| [`docs/REVIEW_NOTES.md`](docs/REVIEW_NOTES.md) | Real bugs found in self/adversarial review, and what changed |

## How this was actually built

This was built as a continuous inspect → hypothesize → change → verify loop, not a single generation
pass — every row below is a real thing that was run, with a real result, not a plan. The full raw log
is longer; this is the condensed version. Four genuine bugs were found and fixed this way, none of
which would have been caught by "the code looks correct."

| # | What I was trying to verify | What I ran | What actually happened |
|---|---|---|---|
| 1 | `game-engine` typechecks and the scenario passes its own quality gate | `tsc --noEmit`, then `vitest run` | A `references` config error surfaced immediately (fixed); then 20/20 tests passed on the first real run, including the scenario's own structural checklist (rubric sums to 100, key evidence spans 3 roles, every role has a red herring) |
| 2 | `packages/ai`'s validation loop actually catches malformed model output, not just "should" | `vitest run` against a stubbed `fetch` simulating invalid JSON, a missing field, an invalid enum, a root-cause-leak attempt, a hallucinated evidence id, and a network failure | 18/18 passed, including a repair-prompt recovery path where a *second* attempt succeeds after the first is rejected — proving the retry loop re-calls with corrective instructions rather than just failing |
| 3 | The whole backend loop works against a real server, not mocks | Built a bot-simulation script driving 4 real `socket.io-client` connections through the actual REST + Socket.IO API | First run failed at `game:completed` — a listener was registered *after* the event had already arrived. Fixed (register listeners before firing requests); second run completed the full loop end to end with a real score |
| 4 | The spec's required concurrency/security test cases actually hold | Wrote 24 integration tests (host double-start, duplicate messages, evidence-privacy, final-submission race) against a real Postgres test database | First full run: 13/24 failed with `500`s — root cause was vitest running test files in parallel against one shared database (fixed: `fileParallelism: false`). Along the way, found and fixed a garbage-cookie 500 that should have been a 401, an unhandled rejection in disconnect handling, **and one real correctness bug**: `players.is_host` was a second, stale source of truth for host status that never updated when a host disconnected — found by a failing test, confirmed with a standalone repro, fixed by deleting the column entirely (ADR-007) |
| 5 | The frontend actually works, driven by a real browser, not just `tsc` | Ran headless Chromium (Playwright) through 4 separate real browser sessions — genuinely separate cookies/sockets — for the full game loop | Found a real product bug: 3-player games (which have no Incident Commander by design) had **no way to submit a final diagnosis at all**, because the form was nested only inside the IC's own panel. Fixed by deriving submission eligibility from player count, matching the server's actual rule |
| 6 | The production build (not just dev mode) actually runs | `pnpm build` then `node dist/main.js` directly, no ts-node/tsx | Crashed with `ERR_MODULE_NOT_FOUND` — workspace packages pointed at raw `.ts` source, unresolvable by plain Node. Fixed (real `build` scripts + `dist`-pointing `main`/`exports` on all 3 packages); re-verified the compiled server boots and serves a real request, and the full 62-test suite still passed afterward |
| 7 | The system resists actual attack attempts, not just "looks secure" | 18 adversarial attempts against the live server (role escalation, evidence-id guessing, forged final submissions, replayed messages, forced AI leaks) | 17/18 correctly rejected. The 18th, found by literally `curl`-ing the join endpoint repeatedly, was real: REST-only "ghost" joins could fill a room to capacity and permanently block Start. Fixed with a grace-window seat-reclaim mechanism, a race-closing `SELECT ... FOR UPDATE`, and 3 new regression tests |

Every fix above has a corresponding entry in [`docs/REVIEW_NOTES.md`](docs/REVIEW_NOTES.md) or
[`docs/DECISIONS.md`](docs/DECISIONS.md) with the full technical detail.

## What this demonstrates

- **Real-time systems & WebSockets**: Socket.IO with room-scoped broadcast, per-role private
  payloads, acknowledged actions, and reconnect that reuses the exact same code path as first
  connect — no custom resume protocol (`docs/WEBSOCKET_PROTOCOL.md`).
- **Server-authoritative multiplayer**: every mutation re-derives authorization from the database on
  every request; the client asserts nothing the server trusts blindly (`docs/DECISIONS.md` ADR-011).
- **Concurrency control**: optimistic-concurrency version columns and unique constraints resolve
  host-double-start, simultaneous hypothesis actions, and final-submission races — verified with real
  simultaneous socket calls, not mocked timing (`docs/DATABASE.md`, ADR-017).
- **Explicit state machines**: a single legal-transition table is the only authority on game phase;
  illegal transitions throw, don't silently no-op (`packages/game-engine/src/stateMachine.ts`).
- **Typed event protocols**: one Zod schema per client→server event, imported unmodified by both
  server and client — no duplicated, driftable payload shapes.
- **PostgreSQL modeling**: normal relational tables with real foreign keys and uniqueness constraints
  doing actual concurrency-control work; JSONB used in exactly three places, each argued for
  individually (`docs/DATABASE.md`).
- **Append-only event log**: `game_events` records everything for audit/debrief-timeline purposes —
  explicitly *not* claimed as event sourcing, with the distinction spelled out
  (`docs/DATABASE.md` "event log vs. event sourcing").
- **Session recovery**: an opaque, server-issued bearer token in an httpOnly cookie; reconnect and
  first-load share one code path (ADR-016).
- **Structured AI orchestration**: one `AIProvider` interface, purpose-specific context builders,
  server-side-only credentials, and a validation pipeline (schema → semantic checks → repair-prompt
  retry → graceful fallback) that was actually exercised against simulated malformed output, not just
  written and trusted (`docs/AI_DESIGN.md`).
- **Deterministic + generative systems, explicitly separated**: every score component the AI proposes
  is re-clamped by deterministic code before it can affect a total; `efficiency` and `collaboration`
  are never asked of the model at all — they're arithmetic over the event log.
- **Human-in-the-loop AI**: the AI evaluates and coaches; it never sets score, phase, or unlocks
  anything — humans investigate, the model judges their reasoning after the fact.

## Known limitations

- No explicit "leave room" or host-kick action — a disconnected player's row stays visible in the
  lobby list (though, as of this session, it can no longer block room capacity or game start — see
  `docs/REVIEW_NOTES.md`). A real leave/kick feature is the top item in "next five improvements" below.
- One browser tab holds one identity at a time (a deliberate tradeoff of the anonymous-cookie session
  design, ADR-016) — opening a second room's invite link in the same browser prompts a fresh join
  rather than silently reusing the first room's identity.
- Single scenario (`checkout-degradation`), single application process (no horizontal scaling built —
  the path is documented in `docs/DEPLOYMENT.md`, not implemented, deliberately).
- No automated frontend test suite (`apps/web`) — verified this session via real integration tests
  against the same API surface plus scripted multi-session browser testing, not a Testing Library
  suite. See `docs/TESTING.md`.
- No load/soak testing was performed — concurrency *correctness* is tested and verified; concurrency
  *at scale* is a documented assumption, not a measured one (`docs/EVALUATION.md`).
- No CI pipeline configured (no `.github/workflows`) — the test commands in `docs/TESTING.md` need to
  be run by hand.

## Next five improvements, ranked by impact

1. **Leave-room / host-kick.** The ghost-join fix (this session) closed the denial-of-service angle,
   but there's still no way for a player to voluntarily leave or for a host to remove someone —
   the natural next step now that the underlying seat-accounting is correct.
2. **A human playtest.** Every functional claim in this repo is backed by an automated test or a
   scripted browser session — none by an actual group of people playing under real time pressure and
   reporting back "this part dragged" or "this clue was too obvious in practice." That's the single
   highest-value validation this project hasn't had yet.
3. **A frontend test suite**, starting with `GameProvider`'s event-merging logic — the trickiest
   client-side code and currently the least-tested layer.
4. **A second scenario**, both to prove the scenario-authoring pattern generalizes and to give replay
   value beyond one incident.
5. **CI** running `docs/TESTING.md`'s commands on every push, so "all tests pass" is enforced rather
   than manually re-verified.
