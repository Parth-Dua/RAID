# Architecture Decision Records

Each ADR: Decision, Context, Requirements, Alternatives considered, Chosen approach, Why, Tradeoffs, Risks, What evidence would make us reconsider.

This file is updated **as decisions are actually made and tested**, not written speculatively up front. Where implementation evidence contradicted an earlier decision, that is noted explicitly under "Evidence observed" instead of silently editing history.

---

## ADR-001: Node.js + TypeScript over Python/FastAPI

**Context**: RAID is a real-time, WebSocket-heavy, stateful multiplayer server that also needs a typed contract shared with a TypeScript frontend.

**Requirements**: low-latency event broadcast to many concurrent sockets per room, one language for both ends of the WebSocket contract to avoid duplicating event schemas, ecosystem support for Socket.IO.

**Alternatives considered**:
- Python/FastAPI + `python-socketio`: mature, but the event contract would need to be hand-duplicated (Pydantic on the server, Zod/TS on the client) with no shared source of truth, and FastAPI's async model adds less value here than in a request/response-heavy API.
- Go: excellent concurrency primitives, but no first-party Socket.IO-compatible server and a much smaller candidate pool for rapid MVP iteration.

**Chosen approach**: Node.js + TypeScript on both server and client, with a `packages/shared` workspace package as the single source of truth for event payload shapes (Zod schemas) and domain types.

**Why**: the shared-types package is only possible cheaply because both ends run TypeScript; that directly satisfies the "typed event protocols" requirement without duplicated schemas that drift.

**Tradeoffs**: Node's single-threaded event loop means CPU-bound work (e.g. a hypothetical local LLM) would block the loop — not a concern here since the only CPU-bound-ish work (AI calls) is delegated to an external HTTP API and awaited, not computed in-process.

**Risks**: none observed after implementation — see "Evidence observed" below.

**Evidence observed**: `packages/shared/src/events.ts` Zod schemas are imported unmodified by both `apps/server` socket handlers and (in Stage 7) `apps/web`; a payload shape change only needs to happen once. Confirmed via `tsc --noEmit` passing across all packages referencing `@raid/shared`.

**What would make us reconsider**: if RAID needed CPU-heavy in-process simulation (physics, ML inference) rather than short deterministic state transitions, a worker-thread pool or a different runtime would become necessary.

---

## ADR-002: Express over Fastify/NestJS for the HTTP layer

**Context**: The HTTP surface is intentionally small — room creation/lookup and health checks. Almost all gameplay traffic is WebSocket, not REST.

**Alternatives considered**:
- Fastify: faster raw throughput and a built-in JSON-schema validator, but that validator would duplicate the Zod schemas already used for sockets and DB boundaries — two validation systems for one contract.
- NestJS: DI container and decorators are overkill for a handful of REST routes in a modular monolith; it also pulls in RxJS/reflect-metadata for no MVP benefit.

**Chosen approach**: Express, with Zod as the *only* validation library everywhere (REST bodies, socket payloads, AI responses).

**Why**: REST traffic volume/latency is not the bottleneck here (Socket.IO is), so Express's smaller footprint and the fact that we already need Zod for sockets and AI output made a second schema system pure overhead.

**Tradeoffs**: Express's default router has no built-in schema validation — every route hand-calls `schema.parse()`. Acceptable at this route count (< 10).

**Risks**: would need revisiting if REST surface grew to dozens of routes with nested validation.

---

## ADR-003: Socket.IO over native WebSocket

See full discussion in `docs/DECISIONS.md` ADR-003 section maintained during Stage 5 (multiplayer implementation) — rooms, reconnection with session resumption, and acknowledgements were the deciding factors. (Expanded below once the socket layer is implemented and reconnect is verified against a real disconnect/reconnect test.)

---

## ADR-004: PostgreSQL + Drizzle ORM

**Context**: Need relational integrity for room/player/game/hypothesis relationships, transactional guarantees for concurrency-sensitive writes (host double-start, duplicate hypothesis support, final-submission race), and a lightweight append-only event log.

**Alternatives considered**:
- Prisma: excellent DX, but its generated client and migration engine add a build step and a heavier runtime; Drizzle's query builder compiles to SQL we can read directly, which matters when debugging concurrency bugs under a deadline.
- MongoDB: would fit the loosely-typed `game_events.payload`, but the majority of RAID's data (players, hypotheses, evidence unlocks, final submissions) is genuinely relational with foreign keys and uniqueness constraints that matter for correctness (e.g. "one final submission per game").

**Chosen approach**: PostgreSQL, Drizzle ORM, with JSONB reserved for exactly three columns: `game_events.payload` (heterogeneous per-event-type shape), `final_submissions.supporting_evidence_ids` (a variable-length list of scenario-defined string IDs, not DB rows), and `game_results.debrief` (a rendered, display-only composite object). Everything else is real relational columns with FKs/uniques. See `docs/DATABASE.md` for the full schema and the reasoning per table.

**Why**: the concurrency test cases in the spec (double-start, simultaneous hypothesis support, final-submission race) map directly onto Postgres unique constraints + optimistic-concurrency version columns, which is exactly the tool for that job.

**Tradeoffs**: relational schema requires migrations for shape changes; accepted since the domain is well understood before the MVP than not.

**Risks**: none yet — will confirm via concurrency integration tests in Stage 6.

---

## ADR-005: `Player.role` removed in favor of a `game_players` join table

**Context**: while designing the schema (Stage 2), the first draft put `role` directly on the `players` table.

**Evidence that changed the decision**: a player's identity (display name, session token, room membership) is scoped to the *room* and persists across the whole lobby lifecycle, but a *role* only has meaning once a specific game has started — and the spec explicitly lists `GamePlayer` as its own entity to support a game/room lifecycle where a room could in principle run more than one game. Putting `role` on `players` conflates "who you are" with "what you're assigned for this incident," and would need to be nulled out and reassigned on every replay.

**Chosen approach**: `game_players(game_id, player_id, role)` with a unique constraint on `(game_id, player_id)`. `players` carries no role column.

**Tradeoffs**: one extra join when reading role-scoped data (evidence visibility, tool authorization) — negligible at MVP scale, and it is the join that makes "play again with a new incident, same room" a straightforward future extension rather than a schema migration.

---

## ADR-006: Room.phase is the single authoritative phase column

**Context**: initial draft had both `rooms.phase` and `games.phase`, updated together on every transition.

**Evidence that changed the decision**: two columns that must always agree is a correctness bug waiting to happen — the first race-condition test we'd write (host double-start) is exactly the scenario where two near-simultaneous writers could leave the two columns disagreeing if the transaction touching one succeeds and the other fails/retries independently.

**Chosen approach**: `rooms.phase` is the *only* phase column, covering the entire lifecycle (`LOBBY -> STARTING -> ACTIVE -> FINALIZING -> COMPLETED/ABANDONED`), guarded by `packages/game-engine`'s state machine and a `rooms.version` optimistic-concurrency column. `games` stores content/timing metadata only (scenario id, duration, started_at, ends_at), never a redundant phase.

**Why**: a single source of truth for phase eliminates an entire class of divergence bugs by construction, at zero feature cost — nothing in the spec requires a room and its game to ever disagree on phase.

---

## ADR-007: `rooms.hostPlayerId` is the single authoritative "who is host" signal

**Context**: the first cut of the `players` table had its own `is_host` boolean, set `true` at insert time for the room creator. Host-disconnect-in-lobby handling (`docs/WEBSOCKET_PROTOCOL.md`, spec section 15) transfers hosting to another connected player by updating `rooms.hostPlayerId` — but `toPublicPlayer` was reading `player.isHost` from the `players` row to build the `PublicPlayer.isHost` field sent to clients.

**Evidence that changed the decision**: this was caught by a real integration test (`gameFlow.integration.test.ts` "host disconnecting in the lobby transfers host"), not by inspection. A standalone repro script confirmed it concretely: after `hostPlayerId` was reassigned, the *old* host still showed `isHost: true` and the *new* host still showed `isHost: false` in the broadcast snapshot, because nothing ever updated the stale `players.is_host` column. This is exactly the dual-source-of-truth bug ADR-006 (`rooms.phase`) was written to avoid one layer up — and it was reintroduced one table over without anyone deciding to.

**Chosen approach**: dropped `players.is_host` entirely (migration `0002_natural_invisible_woman.sql`). `PublicPlayer.isHost` is now always computed at snapshot-build time as `player.id === room.hostPlayerId`. Host transfer on disconnect is now a single `UPDATE rooms SET host_player_id = ...` with nothing else to keep in sync, by construction.

**Why**: any place that stores the same fact in two locations is a bug waiting for the one code path that updates only one of them. The fix generalizes ADR-006's principle ("one authoritative column per fact") from game phase to host identity.

**Tradeoff**: computing `isHost` requires the room row in scope everywhere a player list is rendered; already true here since `getRoomSnapshot` always loads both.

**What would make us reconsider**: if host status needed to be queried independently of any room context (it doesn't, anywhere in this codebase) a denormalized cache might be justified — with the room row as the write-through source, never written directly.

---

## ADR-003 (expanded): Socket.IO over native WebSocket

**Context**: RAID needs room-scoped broadcast, per-role private messages, acknowledged
request/response actions (a `tool:execute` call needs a reply, not just a fire-and-forget), automatic
reconnection after a network blip, and a client that can be simple (no hand-rolled heartbeat/backoff
logic).

**Requirements**: room semantics (broadcast to "everyone in room X"), reconnect that resumes cleanly,
acknowledgements per action, reasonable client complexity, a server complexity budget that fits a
solo-built MVP, a scaling path that exists even if unused today.

**Alternatives considered**:
- Native `ws` (or the platform `WebSocket`): no built-in rooms (would hand-roll a
  `Map<roomId, Set<WebSocket>>`), no acknowledgement protocol (would hand-roll request-id correlation
  over raw messages), no reconnection/heartbeat (would hand-roll exponential backoff and a resume
  protocol). All three are exactly the primitives RAID's protocol actually needs.
- A pub/sub service (e.g. Ably/Pusher) fronting a stateless API: moves the "which room is this socket
  in" problem to a third party and reintroduces a network hop between the socket layer and the
  authoritative game logic for every action — worse for the low-latency ack-per-action pattern RAID
  uses (`tool:execute` needs to return unlocked evidence synchronously to the caller).

**Chosen approach**: Socket.IO server + client.

**Why**: rooms (`socket.join`), acknowledgement callbacks (`socket.emit(event, payload, ack)`), and
automatic reconnection with configurable backoff are all built in and used exactly as designed —
`apps/server/src/sockets/index.ts`'s `withHandler` wraps every event in the ack pattern, and
`apps/server/src/sockets/emit.ts`'s `roomRoom(roomId)` is the entire room-scoping mechanism.

**Tradeoffs**: Socket.IO's own framing adds a small amount of overhead vs. raw WebSocket frames
(irrelevant at RAID's message sizes/rates), and horizontal scaling requires its Redis adapter (see
Redis ADR below) rather than being scaling-primitive-agnostic.

**Evidence observed**: reconnect required *zero* custom protocol code — `handleConnection`
(`apps/server/src/sockets/index.ts`) doesn't branch on "is this a fresh connect or a reconnect," it
just always resends `room:snapshot` (+ `game:snapshot` if a game exists), and this is the entire
mechanism verified by `gameFlow.integration.test.ts`'s reconnect test, which disconnects a real socket
mid-game and asserts role + previously-unlocked evidence come back correctly. Acknowledgement
callbacks made every concurrency test in `concurrency.test.ts` straightforward to write (each side of
a race gets its own resolved/rejected promise) without inventing a request-id correlation scheme.

**What would make us reconsider**: extremely latency-sensitive, very-high-frequency messaging (RAID's
actual event rate — tool calls, chat, occasional hypothesis updates — is nowhere near that) would make
raw WebSocket's lower per-frame overhead worth the hand-rolled room/ack/reconnect machinery.

---

## ADR-008: Vite + React over Next.js for the frontend

**Context**: the frontend is a single-page realtime app with almost no SEO surface (a lobby/game
screen behind a room code isn't content anyone needs server-rendered) and no server-side data-fetching
story that would benefit from Next's App Router.

**Alternatives considered**: Next.js — strong choice for content sites or apps mixing server + client
rendering, but its server-rendering machinery (RSC, route handlers, edge/node runtime split) solves
problems RAID doesn't have: every page here is fully client-rendered and driven by WebSocket state
that doesn't exist until a socket connects, so there's nothing meaningful to server-render.

**Chosen approach**: Vite + React + react-router (client-side routing for `/` and `/r/:code`).

**Why**: faster dev-server iteration, a much smaller framework surface for a UI that's realtime-driven
end to end, no need to reason about server/client component boundaries for a page that's 100%
client-rendered anyway.

**Tradeoffs**: no built-in SSR if RAID ever wanted a marketing/landing page optimized for search —
not a current requirement.

**What would make us reconsider**: adding public, indexable content (a marketing site, public scenario
gallery) genuinely benefiting from SSR/SSG.

---

## ADR-009: Redis is not part of the MVP

**Context**: Socket.IO's horizontal-scaling story and a distributed rate limiter both conventionally
reach for Redis.

**Requirements actually present**: broadcast within one process (solved by Socket.IO's in-memory
adapter), a per-player rate limiter that only needs to survive within one process's lifetime, durable
state that survives a process restart (already solved by Postgres — `rooms`, `games`, `hypotheses`,
etc. are never held only in memory).

**Chosen approach**: no Redis. Socket.IO's default in-memory adapter; the rate limiter
(`apps/server/src/sockets/rateLimiter.ts`) is a plain in-memory `Map`; the per-game timer
(`apps/server/src/sockets/clock.ts`) is a plain `setInterval` per active game, re-adopted from
Postgres on process boot (`resumeActiveClocks`) so a restart doesn't strand an active game.

**Why**: RAID runs as one process. Redis would add a service to deploy, monitor, and pay for, in
exchange for solving a cross-process coordination problem that doesn't exist yet — this is exactly the
"Redis was unnecessary because we run one application process and durable state is persisted in
PostgreSQL" case the design brief anticipates.

**What would make us reconsider**: the horizontal-scaling path in `docs/DEPLOYMENT.md` — the moment a
second server process needs to see a broadcast from the first, or a room's timer needs to be owned
consistently across restarts *of a fleet* rather than one process, Redis (the Socket.IO adapter,
specifically) is the direct answer, not a rearchitecture.

---

## ADR-010: Modular monolith over microservices

**Context**: the spec's own component list (rooms, sessions, game engine, AI, scenario content) could
be drawn as separate services on a whiteboard.

**Chosen approach**: one Node process, with the *package* boundaries (`packages/shared`,
`packages/game-engine`, `packages/ai`) doing the separation-of-concerns work that would otherwise
require network boundaries.

**Why**: every one of those "services" needs the same request's data in the same transaction (role
assignment, evidence unlock, and event logging all happen atomically within one `game:start` or
`tool:execute` call) — splitting them would mean either distributed transactions or eventual
consistency for state that has no business being eventually consistent (a player's role must be
immediately correct, not "correct in a few hundred ms"). A monolith gets this for free from Postgres
transactions.

**Tradeoffs**: all code deploys together; a bug in one area can't be hotfixed independently of the
rest. Acceptable at this scale; the package boundaries mean pulling `packages/ai` or
`packages/game-engine` out into their own deployable later is a real, bounded refactor rather than a
rewrite, should load or team-scaling ever justify it.

**What would make us reconsider**: a genuinely independent scaling need (e.g. AI evaluation becoming
CPU/GPU-bound enough to need its own fleet) or an independent team-ownership need — neither applies to
a solo-built MVP.

---

## ADR-011: The server is authoritative over all game state

**Context**: every mutation (ready state, role assignment, evidence unlock, hypothesis status, final
score) must be something the server decides, not something a client asserts.

**Why this must be true**: cheating (a client claiming to have unlocked evidence it hasn't, or
claiming a role it wasn't assigned), consistency (two clients must never see different truths about
the same hypothesis), reconnect (a rejoining client must get the *actual* current state, not whatever
it last had cached), and concurrency (every race condition test in `concurrency.test.ts` is a race to
be the one write that wins — that only means anything if the server, not the client, decides who won).

**Chosen approach**: every socket event handler re-derives authorization from the database (role,
phase, unlock ledger) using the identity resolved once at handshake (`socket.data.playerId`, never
re-read from a payload) — see `docs/WEBSOCKET_PROTOCOL.md` "never trust the socket payload". The AI is
explicitly excluded from this authority (docs/AI_DESIGN.md "authoritative state").

**Evidence observed**: the entire `security.test.ts` suite is evidence this holds — a role-guessing
attack, a not-yet-unlocked-evidence-citation attempt, and an unauthorized final-submission attempt all
fail with the correct error code rather than silently succeeding or 500ing.

---

## ADR-012: Deterministic simulation, not AI-improvised incident state

**Context**: the incident's facts (what CPU was at t=40s, whether a query is slow) could theoretically
be generated live by a model asked to "improvise a realistic incident."

**Chosen approach**: every fact is authored, fixed content (`packages/game-engine/src/scenarios/
checkoutDegradation.ts`), unlocked by deterministic rules (tool executed + time threshold passed —
`scenarioEngine.ts`). AI never invents a metric value, log line, or evidence item during play.

**Why**: a model asked to "make up what the CPU graph looks like" on demand cannot guarantee internal
consistency across five role-specific tool calls, cannot guarantee the red herrings are genuinely
ruled out by the evidence rather than just asserted to be, and cannot be unit-tested for "is this
scenario actually solvable, and does it require all three roles" the way
`scenarioValidation.test.ts` tests fixed content. Consistency and testability both required fixed,
authored content.

**What would make us reconsider**: a `generateScenario` feature (see docs/AI_DESIGN.md "what was NOT
built") that produces new scenarios *offline*, validated against the same structural checklist before
ever being played — never live, in-game improvisation.

---

## ADR-013: One Game-Master model, not a multi-agent system

**Context**: it's tempting to imagine separate "agents" per role, or an agent orchestrating other
agents.

**Chosen approach**: a single `AIProvider` interface with three narrow, purpose-specific methods
(`evaluateHypothesis`, `evaluateFinalDiagnosis`, `generateDebrief`), each with its own minimal context
builder. No agent-to-agent communication, no tool-calling loop, no autonomous planning.

**Why**: every AI call in RAID is a single-turn, structured-output judgment task — there's no
multi-step reasoning process an agent framework would meaningfully add over a single well-scoped
prompt + schema validation. A multi-agent system would add orchestration complexity, latency (extra
round-trips), and cost (extra tokens) without a task that needs it. See docs/AI_DESIGN.md "why not
autonomous agents solving the incident" for the closely related question of why AI doesn't play the
game itself.

**What would make us reconsider**: if a future feature needed genuinely multi-step reasoning with
intermediate tool use (e.g. an AI that could itself query the scenario's evidence graph to construct a
model-generated scenario), a single-call interface would need to become an agent loop for that
specific feature — still not a reason to restructure the three existing calls.

---

## ADR-014: REST for identity, WebSockets for everything after

**Context**: room creation/join needs to happen before a socket identity exists (you need a session
cookie to authenticate the socket handshake), but the resulting httpOnly cookie makes a natural
REST/WS split available.

**Chosen approach**: exactly two REST endpoints matter — `POST /api/rooms` and
`POST /api/rooms/:code/join` (plus `GET /api/rooms/:code` for existence checks and a `/api/health`).
Every gameplay action after that is a Socket.IO event.

**Why**: room creation is a one-shot action naturally suited to request/response and needs to set a
cookie via a `Set-Cookie` response header before any socket can authenticate — REST is the right shape
for that. Everything after (ready toggling, tool calls, chat, hypotheses, final submission) is either
broadcast-relevant or benefits from the ack/reconnect machinery REST doesn't have.

**Evidence observed**: this split never needed revisiting during implementation — no gameplay action
turned out to want REST's semantics, and no identity action turned out to need a socket.

---

## ADR-015: Scenario content lives in code, not the database

**Context**: `ScenarioDefinition` (the full checkout-degradation content — evidence, tools, timeline,
rubric, root cause) could be a database table, seeded once.

**Chosen approach**: scenarios are TypeScript modules (`packages/game-engine/src/scenarios/*.ts`)
registered in a small in-memory `SCENARIO_REGISTRY`. Games reference a `scenario_id` string; nothing
about the scenario's content is stored in Postgres.

**Why**: scenario content needs type-checking (a typo in an `unlock.toolId` referencing a nonexistent
tool should be a compile-time/test-time error, not a runtime surprise mid-game — exactly what
`scenarioValidation.test.ts` catches), version control (a scenario edit is a normal code review, not a
data migration), and zero query cost (it's read once per game-snapshot build, from memory, not from a
round trip). None of that is naturally true of a database row.

**Tradeoffs**: adding a scenario requires a deploy, not a content-team workflow through an admin
panel. Acceptable — RAID ships with exactly one, deliberately polished, scenario; a content-management
system for scenario authoring is out of scope for an MVP with one scenario.

**What would make us reconsider**: multiple scenarios with a need for non-engineers to author or
edit them without a deploy — at that point a DB-backed scenario table (or the `generateScenario` AI
path, validated against the same structural checklist) becomes worth the tradeoff.

---

## ADR-016: Anonymous session via an opaque server-issued bearer token

**Context**: no signup, but players need a stable identity across a refresh/reconnect within one room.

**Alternatives considered**: a JWT encoding player/room/role client-side — rejected because it either
needs signing infrastructure disproportionate to the problem, or (if unsigned) is forgeable; either
way it puts data client-side (even encoded) that has no reason to leave the server, and the server
still has to hit the DB to check current role/game state regardless, so a self-contained token buys
nothing.

**Chosen approach**: `randomBytes(32)` (256 bits) stored server-side as `players.session_token`,
delivered as `${playerId}.${token}` in an httpOnly, `SameSite=Lax` cookie
(`apps/server/src/domain/session.ts`). Every use does a DB lookup + `timingSafeEqual` comparison — the
same trust model as a conventional server-side session-ID cookie.

**Why**: unguessable by construction, nothing decodable or forgeable client-side, no signing
infrastructure to build or key-rotate, and the DB lookup it requires is already happening for every
authorized action anyway (see ADR-011).

**Tradeoffs**: one cookie = one identity, so this browser can be "in" one room at a time (documented
in `apps/web/src/state/identity.ts` and as a known limitation in the README) — opening a second room's
invite link in the same browser prompts a fresh join rather than silently reusing the first room's
identity. A genuinely rare and low-cost limitation for a game meant to be played in one sitting.

**What would make us reconsider**: a product need to be simultaneously "in" multiple rooms in one
browser tab context — not a current requirement.

---

## ADR-017: Concurrency strategy — optimistic concurrency + unique constraints, not application-level locks

**Context**: the spec explicitly requires safe handling of host-double-start, simultaneous hypothesis
actions, and a final-submission race, and explicitly forbids "Node is single-threaded" as an answer
(true for CPU, false for interleaved awaited I/O — two concurrent handlers both awaiting the DB can
interleave their non-awaited-yet logic).

**Chosen approach**: every race-sensitive write is either (a) a `version`-checked `UPDATE ... WHERE
phase = ? AND version = ?` (rooms' phase transitions) or (b) a unique constraint with
`ON CONFLICT DO NOTHING` (final submissions, evidence unlocks, hypothesis reactions, duplicate
`clientMsgId` sends) — see `docs/DATABASE.md` "concurrency-relevant constraints" for the full table
mapping each constraint to the specific race it resolves.

**Why**: both patterns push the actual arbitration into a single atomic database operation, so "who
won the race" is decided by Postgres, not by application code that could itself race. No
`SELECT ... FOR UPDATE` row locks or advisory locks were needed — every case here is "exactly one of
these concurrent writes should succeed, and it doesn't matter which," which optimistic concurrency and
unique constraints solve directly.

**Evidence observed**: `concurrency.test.ts`'s "with all players ready, exactly one of two concurrent
Start calls wins" test fires two real simultaneous socket calls and asserts exactly one `{ok:true}` and
one `{ok:false, error:{code:"ALREADY_STARTED"}}` — this is the actual mechanism under test, not a
mocked-out approximation.

---

## ADR-018: Why not fully event-source everything

**Context**: `game_events` already logs every meaningful action — it's a short step from there to
"why not make it the actual source of truth and reconstruct state by replay."

**Chosen approach**: explicitly not full event sourcing — see `docs/DATABASE.md` "event log vs. event
sourcing" for the mechanical distinction (current state lives in its own tables, written directly;
the event log is a secondary, append-only record).

**Why**: full event sourcing buys replay/audit/temporal-query power RAID doesn't need (no feature
requires "what did this room look like at any past instant," only "what is true right now" plus a
human-readable debrief timeline, which the log already serves without needing to be the *only* copy of
truth) — and it costs real complexity: every reader would need a replay/projection layer instead of a
`SELECT`, and every race-condition guard (ADR-017) would need to be reasoned about in terms of event
ordering rather than a single atomic constrained write, which is a meaningfully harder concurrency
model for no corresponding benefit here.

**What would make us reconsider**: a feature genuinely needing point-in-time reconstruction (a
full game replay viewer, not just the current debrief timeline) would be a reason to look at this
again — the log already has the raw material (`seq`-ordered, typed, payload-complete) even though
nothing replays it today.

---

## ADR-019: Deployment target — a persistent-process host, not FaaS

See `docs/DEPLOYMENT.md` for the full diagram and reasoning. In one sentence: RAID's WebSocket
connections are long-lived (a multi-minute game session), which requires a host that keeps a process
alive and reachable for that duration — a serverless/FaaS platform built around short request/response
invocations is the wrong shape for this workload without bolting on a separate always-on WebSocket
gateway, which the MVP has no need to build.

---

## ADR-020: Difficulty as a pure data/rule transform, not per-scenario branching

**Context**: V0.3 needed two difficulty levels (NORMAL/HARD) that change actual reasoning
complexity — clue clarity and unlock timing — not just the countdown clock. With 3 scenario modules
already in the codebase (and a design goal of adding more without regression risk), the naive
approach of writing `if (difficulty === "HARD") { ... }` branches inside each scenario file, or
worse, authoring two full copies of every scenario, does not scale and directly contradicts V0.3.3's
"scenario differences should be primarily data/rule-driven, not scattered `if (scenario.id === ...)`
conditionals."

**Chosen approach**: every scenario module (`checkoutDegradation.ts`, `lockContention.ts`,
`memoryLeak.ts`) authors exactly one canonical, difficulty-neutral definition. Evidence items that
carry an interpretive one-liner do so via an optional `hint` field, kept separate from the raw
`content`. A single function, `applyDifficulty()` in `packages/game-engine/src/difficulty.ts`, is the
only place difficulty logic exists: on NORMAL it appends each evidence item's `hint` to its `content`;
on HARD it withholds the hint (raw data still shown, interpretation withheld) and pushes every
time-gated evidence item's unlock threshold later (×1.35, capped at 95% of the game's duration).
`buildScenario(scenarioId, durationSeconds, difficulty)` calls the scenario's builder to get the
canonical definition, then applies this one transform — no scenario module ever imports or checks
`difficulty` itself.

**Why**: this keeps the number of authored-content copies at exactly one per scenario regardless of
how many difficulty levels exist, makes the difficulty *rule* itself easy to test in isolation
(`difficulty.test.ts` asserts the transform's properties directly rather than diffing two hand-authored
scenario files against each other), and guarantees by construction that difficulty can never
accidentally change the root cause, remediation, or key evidence — `applyDifficulty` never touches
those fields.

**What would make us reconsider**: a genuinely structural difficulty difference (not "more subtle
clues" but "a different number of red herrings" or "a different causal chain") would need either a
richer transform or, at that point, may be better modeled as a distinct scenario rather than a
difficulty level of an existing one.

---

## ADR-021: Rematch reuses the room via a `COMPLETED -> LOBBY` transition, not a new room

**Context**: V0.3.5 required replayability — playing again, optionally with a different scenario, with
freshly randomized roles — without building an accounts system. The simplest option, "just create a
brand-new room and have everyone rejoin," has real friction: a new invite code, a fresh join round for
every player, and no natural place to say "we're the same group, one more round."

**Chosen approach**: the state machine (`packages/game-engine/src/stateMachine.ts`) now permits exactly
one transition out of the previously fully-terminal `COMPLETED` phase: `COMPLETED -> LOBBY`. A
host-only `game:rematch` socket event (`roomService.rematchRoom`) performs this transition with the
same optimistic-concurrency guard (`rooms.version`) used everywhere else, clears `currentGameId` back
to `null`, and resets every player's `ready` flag to false. The room code and every player's identity/
session cookie are untouched, so "play again" is just: room flips to LOBBY, host (optionally) picks a
new scenario/difficulty, everyone re-readies, host starts — the existing LOBBY -> STARTING -> ACTIVE
path runs unchanged and assigns fresh roles via the same shuffle `startGame` always uses.
`ABANDONED` deliberately stays fully terminal — a room walked away from mid-game was not "finished,"
so it is not eligible for rematch.

**Why this is safe against stale in-flight actions**: the completed game's row is never mutated or
deleted — only the *room's* pointer to it (`currentGameId`) is cleared — so any late-arriving read of
the old game (e.g. an AI hypothesis-evaluation callback that was still in flight) resolves against a
game record that still exists and simply never gets re-attached to the room. Any late *write* attempt
against the old game (e.g. a stale `final:submit` retry) is rejected with `INVALID_PHASE`, because
every game-scoped socket handler resolves "the active game" via `room.currentGameId`, which is now
`null`. The client mirrors this: `GameProvider` tracks the room's current `gameId` and drops any
`game:snapshot` naming a different one, and clears local game/debrief state the moment a `room:snapshot`
reports `LOBBY` with no `gameId` — so a rematch can never leave the previous round's evidence, chat, or
score visible in the next one. See `apps/server/src/__tests__/v0.3.test.ts` ("rematch / replayability")
for the adversarial coverage, including a stale `final:submit` fired after rematch.

**What would make us reconsider**: an accounts/persistent-history system (explicitly out of scope
through V0.6) would probably want completed games to remain independently addressable/linkable rather
than being superseded in place — at that point rematch might become "create a new room, pre-filled from
the old one" instead of an in-place phase transition.

---

## ADR-022: Adaptive Game Master interventions are delivered as chat messages, never a new mutation type

**Context**: V0.4 added an AI capability (see `docs/AI_DESIGN.md` "Adaptive Game Master") that can
decide, mid-game, to nudge the team. The most flexible implementation would give the AI some way to
directly affect game state — e.g. unlock a piece of evidence early, inject a fabricated timeline event,
or adjust a score. That flexibility is exactly the risk V0.4.3 explicitly rules out ("AI may NOT...
mutate score, bypass game engine").

**Chosen approach**: an intervention has exactly one effect on the game, unconditionally: it becomes a
`chat_messages` row with `kind: "ai_intervention"`, broadcast the same way a scripted timeline event's
system message already is (`gameService.deliverInterventionChatMessage`, `sockets/clock.ts`). There is
no second code path. The AI's `InterventionProposal` output is a `{kind, message, targetRole,
confidence}` object; nothing about it can name an evidence id to unlock, a hypothesis to alter, or a
score to adjust, because those fields simply don't exist in the schema (`packages/ai/src/schemas.ts`).

**Why**: this makes "the AI may not bypass the game engine" true by construction rather than by
runtime policy check. A policy check can have a bug; a data model with no field for "unlock this
evidence id" cannot accidentally unlock evidence no matter what the model returns. It also means
`validateIntervention` (`packages/ai/src/interventionValidator.ts`) only has to validate *message
content* (leak-guard, id-smuggling) — there is no second category of "does this proposal try to do
something structurally dangerous" to check, because the proposal shape can't express anything
structurally dangerous in the first place.

**What would make us reconsider**: a genuinely richer intervention (e.g. "surface one extra,
authored-in-advance optional evidence item early") would need a deliberately narrow new mutation type
with its own validation — not a general "AI can mutate state" escape hatch — and should only be
considered once chat-message-only interventions have been played and found insufficient.

---

## ADR-023: Generated scenarios reuse the repair-retry loop instead of new repair machinery

**Context**: V0.5.5 requires a bounded GENERATE → VALIDATE → IDENTIFY FAILURES → REPAIR → REVALIDATE
loop for AI-generated scenarios. `DeepSeekProvider` already has exactly this shape internally
(`run()`'s schema-failure/semantic-failure retry, capped by `AI_MAX_RETRIES`, used by every other
operation) — the design question was whether scenario generation needed its own, separate repair
mechanism (e.g. a loop living in `scenarioGenerationService.ts` that calls `generateScenario`
multiple times, diffing errors between attempts and building a repair prompt itself).

**Chosen approach**: no new mechanism. `DeepSeekProvider.generateScenario` passes
`validateGeneratedScenario` (the deterministic structural validator, `packages/game-engine`) as the
`run()` pipeline's semantic-validation callback — the identical slot `evaluateHypothesis` fills with
the leak guard and `evaluateFinalDiagnosis` fills with the evidence-id-hallucination check. A
structurally invalid candidate fails that callback, which triggers the same in-conversation
repair-prompt retry (with the validator's error list appended, capped at 5 for prompt-length safety)
every other operation's schema/semantic failures already trigger, bounded by the same
`AI_MAX_RETRIES` config.

**Why**: one retry mechanism to reason about and test, not two. `deepseekProvider.test.ts` already
exhaustively covers the retry/repair/fallback behavior of this pipeline for every other operation;
scenario generation inherits that coverage's *mechanism* for free and only needed new tests for its
own semantic-validation callback (does an invalid candidate actually fail it, does a valid one pass).
A bespoke second retry loop would have needed its own timeout/backoff/max-attempts reasoning,
duplicating decisions already made once in `run()`.

**What would make us reconsider**: if scenario generation ever needed a *different* retry policy
than every other operation (e.g. more attempts, because a full scenario is a much larger and more
failure-prone generation than a one-sentence hypothesis rationale), that would argue for
parameterizing `run()`'s retry count per-operation rather than forking a second mechanism — still
not a reason to build separate repair machinery.

---

## ADR-024: A generated scenario is authored and stored in the same fractional shape as built-in ones

**Context**: V0.5's generated scenarios need to support the same duration presets (demo/standard/
instant) and the same NORMAL/HARD difficulty as the 3 built-in scenarios, without asking the AI to
generate a separate version per duration or difficulty. The 3 hand-authored scenario files already
solved an equivalent problem for themselves (author once as fractions of the eventual duration, scale
at build time — see ADR-020's difficulty-as-transform decision for the related "author once" pattern)
but had that scaling logic duplicated 3 times, once per scenario file.

**Chosen approach**: `GeneratedScenarioDefinition` (packages/shared) uses the identical fractional
shape (`atFraction` instead of `atSeconds`) the 3 built-in scenarios' internal `FractionalEvidence`/
`FractionalTimelineStep` types already used. The scaling logic itself was extracted, as part of this
work, into `materializeFractionalEvidence`/`materializeFractionalTimeline`
(`packages/game-engine/src/fractionalScenario.ts`) — a small, mechanical DRY refactor of the 3
existing scenario files (verified behavior-identical: all 62 game-engine tests passed unchanged
before and after) — so a generated scenario reuses the exact same functions rather than needing a
4th implementation of the same fraction-to-seconds math. `buildGeneratedScenario` then composes that
materializer with the same `applyDifficulty()` every built-in scenario uses.

**Why**: this is what makes "a generated scenario plays through the exact same engine, no special
casing" true rather than aspirational. The only place server code distinguishes "built-in" from
"AI-generated" is `gameLoader.resolveScenario`'s registry-or-database lookup; everything downstream
of that one function — scoring, the Game Master, difficulty, evidence unlocking — operates on a plain
`ScenarioDefinition` with no marker saying where it came from.

**What would make us reconsider**: a scenario-generation feature that genuinely needed
duration-specific content (not just differently-scaled timing of the same content) would break this
model and require the AI to generate per-duration variants — not currently needed, since every
built-in scenario's design already treats duration as a pacing dial on one fixed set of content,
and generated scenarios were designed to match that same assumption.
