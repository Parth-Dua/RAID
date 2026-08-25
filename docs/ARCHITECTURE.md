# Architecture

RAID is a modular monolith: one Node process serving REST + WebSockets, one PostgreSQL database, one
static frontend. See `docs/DECISIONS.md` ADR "monolith vs microservices" for why — the short version
is that nothing in this MVP has an independent scaling or deployment need that would justify the
operational cost of splitting it up, and the monorepo's package boundaries (`packages/shared`,
`packages/game-engine`, `packages/ai`) already give the codebase the seams a future extraction would
use, without paying for network calls between them today.

## High-level system architecture

```mermaid
flowchart TB
    subgraph Client["Browser"]
        Web["apps/web (React + Vite)"]
    end

    subgraph Server["apps/server (Node, one process)"]
        REST["Express REST\n(room create/join, health)"]
        WS["Socket.IO\n(all gameplay events)"]
        Auth["Session auth middleware\n(cookie -> player)"]
        Services["Application services\nroomService / gameService /\nfinalizationService / aiService"]
        Engine["packages/game-engine\nstate machine, scenario, scoring"]
        AI["packages/ai\nAIProvider: Mock | DeepSeek"]
        Repos["Repositories\n(Drizzle query wrappers)"]
    end

    DB[("PostgreSQL")]
    DeepSeek["DeepSeek API\n(chat.completions)"]

    Web <-- "REST: create/join room" --> REST
    Web <-- "Socket.IO: gameplay" --> WS
    REST --> Auth
    WS --> Auth
    Auth --> Services
    Services --> Engine
    Services --> AI
    Services --> Repos
    Repos --> DB
    AI -. "only when AI_PROVIDER=deepseek" .-> DeepSeek
```

## Domain boundaries

```
Transport (routes/*.ts, sockets/index.ts)
    - Zod-parse the payload, resolve identity from socket.data / session cookie, call a service, ack.
    - No business logic here. A handler that's more than ~10 lines is a smell.
        v
Application services (services/*.ts)
    - roomService: lobby lifecycle, role assignment, the LOBBY->ACTIVE transition
    - gameService: tool execution, hypotheses, evidence, chat, known facts, snapshot assembly
    - finalizationService: the ACTIVE->FINALIZING->COMPLETED transition, scoring, debrief assembly
    - aiService: constructs the one AIProvider singleton; the only file that imports @raid/ai's
      concrete classes
        v
Domain / game engine (packages/game-engine) - pure functions, no I/O
    - stateMachine: legal phase transitions
    - scenarioEngine: evidence unlock predicates, role/tool authorization, tool-result computation
    - scoring: deterministic efficiency/collaboration, rubric clamping
        v
Repositories (repositories/*.ts) - thin Drizzle query wrappers, one file per aggregate
    - No query building outside this layer; services never import `db` and call `.select()` directly
      themselves (aiService/gameService import repo functions, not the schema)
        v
PostgreSQL
```

AI sits *beside* this stack, not inside it: `gameService`/`finalizationService` call `aiProvider.
evaluate*` the same way they call a repository function — an awaited call that returns validated data,
never a callback with side effects. See docs/AI_DESIGN.md for the full request lifecycle.

## Room / game lifecycle

```mermaid
sequenceDiagram
    actor Host
    actor P2
    participant REST
    participant WS as Socket.IO
    participant Svc as roomService
    participant DB

    Host->>REST: POST /api/rooms {displayName}
    REST->>Svc: createRoom
    Svc->>DB: INSERT room, INSERT player (host), UPDATE room.host_player_id
    REST-->>Host: {roomCode, playerId} + Set-Cookie (session)
    Host->>WS: connect (cookie, auth:{roomCode})
    WS-->>Host: room:snapshot

    P2->>REST: POST /api/rooms/:code/join {displayName}
    REST->>Svc: joinRoom
    Svc->>DB: INSERT player
    REST-->>P2: {playerId} + Set-Cookie
    P2->>WS: connect
    WS-->>Host: room:snapshot (broadcast, now 2 players)
    WS-->>P2: room:snapshot

    Host->>WS: player:ready {ready:true}
    P2->>WS: player:ready {ready:true}
    Note over WS,DB: (2 more players join and ready up the same way - 3 or 4 total)

    Host->>WS: game:start {durationPreset}
    WS->>Svc: startGame (host-only, all-ready, 3-4 players)
    Svc->>DB: rooms LOBBY->STARTING (optimistic concurrency)
    Svc->>DB: INSERT game, INSERT game_players (shuffled role assignment)
    Svc->>DB: rooms STARTING->ACTIVE
    WS-->>Host: room:snapshot (ACTIVE) + personalized game:snapshot
    WS-->>P2: room:snapshot (ACTIVE) + personalized game:snapshot
    Note over WS: server-authoritative timer starts (apps/server/src/sockets/clock.ts)
```

## Multiplayer realtime flow (steady-state investigation)

```mermaid
sequenceDiagram
    actor Backend as Backend Engineer
    actor DBEng as Database Engineer
    participant WS as Socket.IO
    participant Svc as gameService
    participant DB

    Backend->>WS: tool:execute {toolId:"deployments"}
    WS->>Svc: executeTool (role check: tool.role == caller's role)
    Svc->>DB: INSERT tool_action, INSERT game_evidence (if newly unlocked)
    WS-->>Backend: ack {output, unlockedEvidenceIds} (private)
    WS-->>Backend: evidence:unlocked [...] (private, this socket only)

    Backend->>WS: knownfact:add {text, sourceEvidenceId}
    WS->>Svc: addKnownFact (re-checks role visibility + unlock ledger)
    Svc->>DB: INSERT known_fact
    WS-->>Backend: game:event {kind:"known_fact"} (broadcast to room)
    WS-->>DBEng: game:event {kind:"known_fact"} (broadcast to room)

    Note over DBEng: DB Engineer never receives Backend's raw evidence,\nonly what Backend chose to promote to the shared board.
```

## Hypothesis submission sequence

```mermaid
sequenceDiagram
    actor Player
    participant WS as Socket.IO
    participant Svc as gameService
    participant DB
    participant AI as aiProvider (Mock or DeepSeek)

    Player->>WS: hypothesis:create {text, clientMsgId}
    WS->>Svc: createHypothesis (dedup on clientMsgId)
    Svc->>DB: INSERT hypothesis (status=OPEN)
    WS-->>Player: ack {hypothesisId}
    WS-->>Player: hypothesis:updated {status:"OPEN"} (broadcast to room)
    Note over WS: AI evaluation runs AFTER the OPEN broadcast,\nasynchronously - UI shows "Evaluating..." meanwhile

    WS->>Svc: evaluateHypothesisAsync (fire-and-forget)
    Svc->>AI: evaluateHypothesis(scenario, text, knownFacts, otherHypotheses)
    AI-->>Svc: {status, rationale} (schema + leak-guard validated)
    Svc->>DB: UPDATE hypothesis SET status, rationale WHERE version = <captured version>
    alt version still matches (game hasn't moved on)
        DB-->>Svc: 1 row updated
        Svc->>WS: hypothesis:updated {status:"SUPPORTED"|...} (broadcast to room)
    else version changed (stale - e.g. game already finalized)
        DB-->>Svc: 0 rows updated
        Note over Svc: dropped silently, logged - never broadcasts stale AI output
    end
```

## Reconnect flow

```mermaid
sequenceDiagram
    actor Player
    participant Browser as socket.io-client
    participant WS as Socket.IO server
    participant Auth as socketAuthMiddleware
    participant DB

    Note over Player,Browser: Network blip / tab refresh
    Browser->>Browser: automatic reconnection attempt (built-in, no custom protocol)
    Browser->>WS: connect (same httpOnly session cookie, same auth:{roomCode})
    WS->>Auth: resolve cookie -> player, verify player.roomId matches roomCode
    Auth-->>WS: socket.data = {playerId, roomId, displayName}
    WS->>DB: setPlayerConnected(true)
    WS-->>Browser: room:snapshot (fresh player list, this player marked connected)
    alt game already active
        WS->>DB: rebuild GameSnapshot for this player (role, unlocked evidence, hypotheses, chat)
        WS-->>Browser: game:snapshot (fully current - no client-side replay needed)
    end
```

Reconnect and first-load are the *same code path* (`handleConnection` in `apps/server/src/sockets/
index.ts` doesn't branch on "is this a reconnect") — see docs/DECISIONS.md ADR-003 for why Socket.IO's
built-in reconnection made this possible without a custom resume protocol, and
`gameFlow.integration.test.ts` for the test that actually disconnects and reconnects a socket mid-game
and asserts role + evidence survive.

## Horizontal scaling path (not built, deliberately)

See docs/DEPLOYMENT.md for the full diagram and sticky-session discussion. In one sentence: today one
process holds all room state in Postgres + in-memory timers; scaling to N processes needs sticky
sessions (a room's sockets must land on the process that owns its timer) or a Socket.IO Redis adapter
for cross-process broadcast — neither is implemented because nothing about the MVP's expected load
(a handful of concurrent 3-4 player rooms) requires it yet, and docs/DECISIONS.md's Redis ADR explains
why adding it now would be solving a problem that doesn't exist.
