# Review Notes

## README productionization (post-V0.1)

**Finding: the documented single-command `pnpm dev` had never actually been run as one command.**
Every prior verification started `tsx` and `vite` independently in separate background processes,
which worked and masked a real bug: root `package.json`'s `dev` script had an unquoted
`--filter ./apps/*`, which the shell glob-expanded into two literal arguments
(`./apps/server ./apps/web`) before pnpm ever received a single filter pattern - `pnpm dev` failed
outright with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. The adjacent `build:packages` script quoted its
equivalent pattern correctly; `dev` did not. **Fix**: quoted the filter pattern. Re-verified with a
fresh `pnpm dev` run: both server and web health-checked successfully. A reminder that "the pieces
work" and "the documented command works" are different claims requiring different evidence.

Findings from the self-review passes and adversarial review, run after the first fully working
implementation. This file records what was actually found and changed — not a restatement of the
architecture, and not a log of every trivial fix. See `docs/DECISIONS.md` for the ADRs some of these
findings prompted.

## Review 1 — Architecture

**Finding: a circular import between `gameService.ts` and `finalizationService.ts`.** The first draft
had `finalizationService.ts` import `loadActiveGame` from `gameService.ts`, while `gameService.ts`
re-exported `finalizeGame` from `finalizationService.ts` for a single unified import surface. This
worked at runtime (ESM tolerates cycles when nothing is used at module-eval time) but is a real
coupling smell and a maintenance trap. **Fix**: extracted `gameLoader.ts` holding `loadActiveGame` and
`LoadedGame`, imported by both services independently. No more cycle.

**Finding: `gameService.ts` is doing too much.** It currently owns snapshot assembly *and* five
distinct action handlers (tool execution, hypothesis creation, reactions, evidence attach, known
facts, chat). It's the largest file in the server. Not split further in this pass — each function is
still small and independently testable, and splitting further (e.g. one file per action) would add
navigation overhead without an obvious current benefit — but it's the first place to look if the file
keeps growing.

**Not a finding, but worth stating**: `packages/game-engine` has zero I/O by design (verified — no
imports of `fs`, `pg`, `drizzle`, or anything network-related anywhere in that package), which is
exactly why its 20 unit tests run in under a second with no database. This boundary held without
needing correction.

## Review 2 — Multiplayer

**Finding (the significant one): `players.is_host` was a second, stale source of truth for host
status.** Caught by a real integration test failure, not inspection — see `docs/DECISIONS.md` ADR-007
for the full writeup. This is the most consequential bug found in this project: it reintroduced, one
table over, exactly the dual-authority problem `rooms.phase` (ADR-006) had already been designed to
avoid. Fixed by deleting the column and deriving `isHost` from `room.hostPlayerId` at read time.

**Finding: `handleDisconnect` could throw an unhandled rejection.** If the room row no longer existed
by the time a lingering socket's disconnect handler ran (e.g. during test teardown, or in principle a
racing room-level operation), `getRoomSnapshot` threw `RaidError` uncaught inside a fire-and-forget
`void handleDisconnect(...)` call. **Fix**: wrapped the handler body in try/catch with a
room-existence check up front, logging rather than crashing.

**Finding: a malformed session cookie surfaced as `SERVER_ERROR` instead of `NOT_AUTHORIZED`.** A
non-UUID `playerId` extracted from a garbage cookie value was passed straight into a Postgres query,
which threw a raw "invalid input syntax for type uuid" error — caught by the outer handler, but
logged and reported as a generic 500 rather than the correct auth failure. **Fix**: added a UUID-shape
pre-check in `socketAuthMiddleware` before any DB lookup.

**Finding: the production build crashed on startup.** Not a multiplayer bug per se, but found during
this review pass and consequential enough to note here: `node dist/main.js` (the actual production
entry point, no ts-node/tsx) failed with `ERR_MODULE_NOT_FOUND` because the workspace packages'
`package.json` pointed `main`/`exports` at raw `.ts` source, which only tsx/Vite's TypeScript loaders
can resolve. Confirmed by literally running the compiled output, not by reading the Dockerfile and
assuming it worked. **Fix**: added real `build` scripts to all three workspace packages, pointed
`main`/`types`/`exports` at their compiled `dist/`, and updated the root `dev` script and both
Dockerfiles to build packages before the apps that depend on them. Re-verified: `node dist/main.js`
now boots and serves a real request on a fresh port, and the full 62-test suite still passes
afterward (confirming the module-resolution change didn't regress dev-mode behavior).

## Review 3 — AI

**Finding: the leak guard's multi-term heuristic is a deliberate over-block, not a bug — but worth
documenting explicitly as a tradeoff rather than leaving implicit.** `containsRootCauseLeak`'s
"2+ distinctive causal terms" check will occasionally reject a legitimate rationale that references
two facts the team has already independently discovered (e.g. "the pool is under pressure" +
"query volume is up" together, even without stating the causal link between them). This trades a
fallback to generic-but-safe text for never leaking the answer. Documented in `docs/AI_DESIGN.md`
rather than tuned away, since tuning it looser is exactly the kind of change that should be driven by
observing real DeepSeek output at volume (not done this session, see `docs/EVALUATION.md`), not by
guessing at a better threshold.

**Not a finding**: cost discipline held up under a direct check — grepped every call site of
`aiProvider.` outside `packages/ai` itself and confirmed exactly three (`createHypothesis`'s async
evaluation, `finalizationService`'s final evaluation, and its debrief generation), none inside a loop,
none inside `tool:execute`/`chat:send`/`knownfact:add`/the timer tick.

## Review 4 — Game design

Assessed by actually running the game, not by re-reading the scenario prose: the bot simulation
script's two-pass tool execution concretely proved the time-gating mechanic (baseline text before a
threshold, real content after); four separate real browser sessions (via Playwright, genuinely
separate cookie jars) proved no player's client ever renders another role's tools or evidence; the
automated structural checklist (`scenarioValidation.test.ts`) passed on first write for both the
standard and instant duration presets.

**Finding: a 3-player game had no way to submit a final diagnosis through the UI.** The frontend
only rendered the final-submission form inside the Incident Commander's panel — but a 3-player game
has no IC by design (`assignRoles` drops that role below 4 players), so no one would ever see the
form. Caught during the browser E2E pass, not by reading the component in isolation. **Fix**: moved
`FinalSubmitForm` to a shared location gated by a client-derived `canSubmitFinal` (IC role, or a
3-player game where no IC exists) matching the server's actual authorization rule in
`finalizationService.ts`.

**Finding, not fixed (documented as a known limitation)**: no "Open Questions" board category —
see `docs/GAME_DESIGN.md`.

## Review 5 — Code quality

- Removed an unused `and` import in `gameContentRepo.ts` and an unused `Role` import in
  `finalizationService.ts` during the ADR-007 refactor.
- No dead code, `TODO`/`FIXME` markers, or leftover debug `console.log` calls found in application
  source (checked directly with a repo-wide grep; the only `console.log` calls remaining are in the
  three CLI scripts — `db/seed.ts`, `db/migrate.ts`, `scripts/botSimulation.ts` — where stdout output
  is the intended behavior, not debug residue).
- **Not fixed, flagged as debt**: no ESLint/Prettier configuration exists (`lint` scripts are
  placeholders). Manual review substituted for automated linting this session; a repo this size would
  benefit from at least `noUnusedLocals`/`noUnusedParameters` in the base tsconfig, which weren't
  enabled and so wouldn't have caught the two unused-import cases above at compile time.

## Adversarial review

Attempted, against the real running system (not just reasoned about):

| Attack | Result |
|---|---|
| Join a full room (5th player) | Rejected, `ROOM_FULL` (`rooms.rest.test.ts`) |
| Start game with players not ready | Rejected, `INVALID_PHASE` (`concurrency.test.ts`) |
| Two simultaneous Start calls | Exactly one wins, other gets `ALREADY_STARTED` (`concurrency.test.ts`) |
| Connect a socket with no session cookie | Rejected at handshake, `NOT_AUTHORIZED` (`security.test.ts`) |
| Connect a socket with a garbage/malformed cookie | Rejected, `NOT_AUTHORIZED`, not a 500 (`security.test.ts`) |
| Execute another role's tool | Rejected, `WRONG_ROLE` (`security.test.ts`) |
| Attach a real evidence id that hasn't unlocked yet (guessed correctly) | Rejected, `NOT_AUTHORIZED` (`security.test.ts`) |
| Attach an evidence id visible only to a different role | Rejected, `NOT_AUTHORIZED` (`security.test.ts`) |
| Attach a fully invented evidence id | Rejected, `INVALID_PAYLOAD` (`security.test.ts`) |
| Submit final diagnosis as a non-IC in a 4-player game | Rejected, `NOT_AUTHORIZED` (`security.test.ts`) |
| Two simultaneous final submissions | Exactly one is scored (`concurrency.test.ts`) |
| Duplicate `hypothesis:create` with the same `clientMsgId` (simulating a retried/duplicate send) | Idempotent, one hypothesis created (`concurrency.test.ts`) |
| Duplicate `hypothesis:support` from the same player | Idempotent, one reaction recorded (`concurrency.test.ts`) |
| Oversized chat message / non-UUID `clientMsgId` | Rejected at the Zod layer, `INVALID_PAYLOAD` (`security.test.ts`) |
| Force a AI response with a hallucinated evidence id | Rejected, repair-retried, then sanitized if still present (`deepseekProvider.test.ts`) |
| Force an AI response that tries to leak the root cause | Rejected by the leak guard, repair-retried, then falls back (`deepseekProvider.test.ts`) |
| Kill the process mid-game and restart it | `resumeActiveClocks` re-adopts any `ACTIVE` room's timer on boot (implemented; not covered by an automated test — see below) |
| Disconnect and reconnect mid-game | Role and previously-unlocked evidence survive (`gameFlow.integration.test.ts`) |
| Flood a room with REST-only "ghost" joins to deny service | **Was a real bug — found here, fixed, regression-tested.** See below. |

### Ghost-join denial of service (found, fixed)

**The attack**: repeatedly calling `POST /api/rooms/:code/join` for the same room from fresh sessions
(a different browser/incognito window, or direct API calls) created a new, permanently-disconnected
player row each time, with no leave/kick mechanic to remove it. Verified against the live server, not
just reasoned about: three REST-only joins filled a real room to capacity and a legitimate fourth
player was rejected with `ROOM_FULL`. Worse, because the start-gate required
`players.every(p => p.ready)` across *all* rows regardless of connection status, a single
never-connected ghost permanently blocked the host from ever starting the game.

Not a privacy or authorization break — a ghost player sees nothing a real player wouldn't, and gains
no elevated access under ADR-016 — but a genuine availability bug, and reachable by anyone holding a
room code (which the spec intends to be freely shareable).

**The fix** (`apps/server/src/repositories/playersRepo.ts`, `services/roomService.ts`):
1. Introduced `occupiesSeat(player, now)`: a player occupies a seat if they're currently connected, or
   joined within a 60s grace window (so a real player between their REST join and their socket
   handshake is never evicted mid-arrival).
2. The room-full check now counts only seat-occupying players, and abandoned rows past the grace
   window are deleted in the same transaction rather than accumulating forever.
3. That transaction now uses `SELECT ... FOR UPDATE` on the room's player rows, which also closes a
   pre-existing (unrelated, unnoticed) race where two simultaneous joins could each read "3 players"
   and both insert a 4th.
4. The start-gate now counts only *connected* players for both the 3-4 player range and the all-ready
   check, so a disconnected or never-arrived player can no longer hold a lobby hostage.

**Regression tests added**: `security.test.ts` "an unready player who never connected does not block
Start" (which fails against the old code with "All players must be ready") and "still enforces the
4-player cap against recent joins", plus `occupiesSeat.test.ts` covering the grace-window predicate's
boundaries directly as a pure function — so the 60s reclaim path is tested in milliseconds rather than
requiring a minute-long integration test.

**Still open (deliberately)**: there is no explicit "leave room" or host-kick action. A player who
disconnects mid-lobby is no longer *blocking* anything, but their row stays visible in the lobby list
until the room ends. Adding real leave/kick semantics is a product feature, not a security fix, and is
listed in the final report's next-improvements.
