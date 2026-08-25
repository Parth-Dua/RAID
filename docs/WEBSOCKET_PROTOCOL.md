# WebSocket Protocol

Single source of truth for event shapes: `packages/shared/src/events.ts` (client → server, Zod-validated)
and `packages/shared/src/domain.ts` (server → client payload types). Neither app redefines these
shapes independently — the server imports and validates against the same Zod schemas the client
uses to build payloads, and both compile against the same TypeScript types.

## Transport & connection

- One Socket.IO connection per browser tab, opened after a REST `POST /api/rooms` or
  `POST /api/rooms/:code/join` call has set the session cookie.
- `GET /api/scenarios` (V0.3, extended V0.5) returns the scenario catalog (`ScenarioCatalogEntry[]` —
  id, title, severity, briefing, tagline) that populates the lobby's scenario picker: the 3 built-in
  scenarios plus every saved AI-generated one. `POST /api/scenarios/generate` (V0.5, body
  `{description, difficulty?}`) runs one generation + structural-validation + semantic-review attempt
  and returns `{candidate, validation, semanticReview, eligibleToSave}` — it never persists anything.
  `POST /api/scenarios/save` (V0.5, body `{candidate, requestedDescription?}`) re-validates
  deterministically (no AI call) and persists a candidate already returned by `/generate`, assigning
  it a disambiguated `scenarioId` usable anywhere a built-in scenario id is (including `game:start`'s
  payload below). All three are unauthenticated and not room-scoped — read-only or globally-available
  content, not covered by the socket auth flow.
- `GET /api/games/:gameId/result` (V0.6.4) returns `{gameId, completedAt, debrief}` for a finished
  game, or 404 for an unknown or not-yet-finalized one — public, no session cookie required (see
  ADR-025). This is what the `/result/:gameId` frontend route and the debrief screen's "Copy
  shareable result link" button use; it is never called over the socket connection.
- `GET /api/rooms/:code/leaderboard` (V0.6.5) returns `{entries: LeaderboardEntry[]}` — every
  completed game in that room, most recent first, or an empty array (never an error) for a room with
  no completed games yet. Also public, gated only by knowing the room code (see ADR-026).
- Handshake auth: `io(url, { withCredentials: true, auth: { roomCode } })`. The server's
  `socketAuthMiddleware` (`apps/server/src/sockets/auth.ts`) reads the session cookie from the
  handshake headers, resolves it to a player, and rejects the connection outright (`connect_error`)
  if the cookie is missing, malformed, or names a player that doesn't belong to `roomCode`.
- On successful connect, the server joins the socket to a Socket.IO room named `room:<roomId>` and
  immediately sends `room:snapshot` (always) and `game:snapshot` (if a game already exists and the
  room isn't still in `LOBBY`) — this is the entire reconnect protocol. See "Reconnect" below.

## Client → Server events

All payloads are validated against the Zod schema in `packages/shared/src/events.ts` before any
handler logic runs; a validation failure returns `{ ok: false, error: { code: "INVALID_PAYLOAD" } }`
via the acknowledgement callback and never reaches application code.

| Event | Payload | Auth | Ack |
|---|---|---|---|
| `player:ready` | `{ ready: boolean }` | must be a room member; room must be `LOBBY` | `{ok:true}` |
| `player:leave` (V0.2) | `{}` | room member; room must be `LOBBY` (once a game has started, a player can only disconnect, not remove themselves — their role/evidence are bound to game rows) | `{ok:true}` |
| `game:start` | `{ durationPreset?: "standard"\|"demo"\|"instant", scenarioId?: string, difficulty?: "NORMAL"\|"HARD" }` (V0.3: `scenarioId`/`difficulty` added; both optional, defaulting to `checkout-degradation`/`NORMAL`) | caller must be the room's host (`rooms.hostPlayerId`); room `LOBBY`; `scenarioId` (if given) must be a real built-in scenario id OR a saved generated one (V0.5 — checked against both `listScenarioIds()` and the `generated_scenarios` table) or the call is rejected with `INVALID_PAYLOAD`; 3-4 players, all ready | `{ok:true, data:{gameId}}` |
| `game:rematch` (V0.3) | `{}` | caller must be the room's host; room must be `COMPLETED` | `{ok:true}` — broadcasts a fresh `room:snapshot` with `phase:"LOBBY"`, `gameId:null`, and every player's `ready` reset to `false` |
| `chat:send` | `{ text: string(1-500), clientMsgId: uuid }` | room member; game `ACTIVE` or `FINALIZING` | `{ok:true}` |
| `tool:execute` | `{ toolId: string }` | tool's `role` must equal the caller's assigned role; game `ACTIVE` | `{ok:true, data:{output, unlockedEvidenceIds}}` |
| `hypothesis:create` | `{ text: string(5-600), clientMsgId: uuid }` | room member; game `ACTIVE` | `{ok:true, data:{hypothesisId}}` (or `{ok:true}` with no data if `clientMsgId` is a dedup'd retry) |
| `hypothesis:support` | `{ hypothesisId: uuid }` | room member; game `ACTIVE`; hypothesis belongs to this game | `{ok:true}` |
| `hypothesis:challenge` | `{ hypothesisId: uuid }` | same as support | `{ok:true}` |
| `evidence:attach` | `{ hypothesisId: uuid, evidenceId: string }` | evidenceId must be a real scenario evidence id, visible to the caller's role, AND already unlocked | `{ok:true}` |
| `knownfact:add` | `{ text: string(3-300), category?: "fact"\|"question" (V0.2, default "fact"), sourceEvidenceId?: string\|null }` | if `sourceEvidenceId` set, same visibility+unlock check as `evidence:attach` | `{ok:true}` |
| `final:submit` | `{ rootCause: string(10-1500), supportingEvidenceIds: string[], remediation: string(5-800), clientMsgId: uuid }` | if the game has an Incident Commander, only they may call this; otherwise any assigned player; game `ACTIVE` (this also covers rematch's stale-action case: a `final:submit` fired after `game:rematch` has cleared `currentGameId` finds no active game and is rejected with `INVALID_PHASE`) | `{ok:true}` |

Every ack either resolves `{ok:true, data?}` or rejects `{ok:false, error:{code,message}}` where
`code` is one of the `ServerErrorPayload["code"]` values (`NOT_AUTHORIZED`, `INVALID_PHASE`,
`ROOM_FULL`, `ALREADY_STARTED`, `WRONG_ROLE`, `RATE_LIMITED`, `INVALID_PAYLOAD`, `SERVER_ERROR`, ...).
Rate limiting is a flat per-player-per-event-name token bucket (8 actions / 3s) — see
`apps/server/src/sockets/rateLimiter.ts`; it exists to blunt accidental client bugs/spam, not as a
security boundary (see docs/DECISIONS.md Redis ADR for why this is in-memory, not distributed).

## Server → Client events

| Event | Payload | Broadcast scope | When |
|---|---|---|---|
| `room:snapshot` | `RoomSnapshot` (full player list, phase, code, current `scenarioId`) | all sockets in `room:<roomId>` | on connect, disconnect, ready toggle, host transfer, game start/complete, rematch |
| `game:snapshot` | `GameSnapshot` — **personalized per player** (own role, own unlocked evidence, own tools, the game's `difficulty`) | sent individually to each socket (`io.to(socket.id)`), never broadcast as one shared payload | on connect (if game exists), on game start, on final evaluation |
| `game:event` | `{kind:"chat", message} \| {kind:"known_fact", fact} \| {kind:"timeline_step", step}` | broadcast to `room:<roomId>` | on chat send, known-fact add, every deterministic timeline reveal, and every delivered V0.4 adaptive Game Master intervention (all three arrive as `{kind:"chat", message}` — a `ChatMessage.kind` of `"player"`, `"system"`, or `"ai_intervention"` tells them apart client-side) |
| `timer:update` | `{ remainingSeconds: number }` | broadcast | every 5s while `ACTIVE` |
| `evidence:unlocked` | `PublicEvidence[]` | **private**, sent only to the executing player's socket | after `tool:execute` newly unlocks evidence |
| `hypothesis:updated` | `Hypothesis` | broadcast | on create (status `OPEN`), on AI evaluation completing, on support/challenge, on evidence attach |
| `final:evaluated` | `Debrief` | broadcast | once scoring + debrief generation completes |
| `game:completed` | `{ roomId }` | broadcast | immediately after `final:evaluated`, once phase reaches `COMPLETED` |
| `error` | `ServerErrorPayload` | private, to the offending socket | reserved for server-initiated errors outside a specific ack (acks carry their own error shape) |

### Why `game:snapshot` is never a single broadcast

This is the one deliberate asymmetry in the protocol and the reason a naive `io.to(room).emit(...)`
pattern was rejected for game state: **the payload differs per recipient.** `GameSnapshot.myRole`,
`.tools`, and `.evidence` are computed per player from their assigned role — broadcasting one shared
object would either leak every role's evidence to everyone (a hard security requirement violation) or
force the client to filter untrusted data it already received, which defeats the point of server-side
authorization. `emitGameSnapshotToRoom` (`apps/server/src/sockets/emit.ts`) instead enumerates
sockets in the room and computes+sends one snapshot per socket.

## Reconnect

On any `connect` (fresh join or a `socket.io-client` auto-reconnect after a network blip), the server
resends both `room:snapshot` and — if a game exists — a fresh `game:snapshot` computed from the
player's current role and the evidence-unlock ledger. There is no separate "resume" event or
client-side replay logic: reconnect and initial-load are the same code path, which is the main
practical payoff of choosing Socket.IO's built-in reconnection over a hand-rolled one (see
docs/DECISIONS.md ADR-003). Verified by `apps/server/src/__tests__/gameFlow.integration.test.ts`
"a reconnecting player keeps their identity, role, and previously unlocked evidence".

## Never trust the socket payload

Every handler follows: parse with Zod → resolve `socket.data.{playerId,roomId}` (set once at
handshake, never re-read from the payload) → call a service function that re-checks room/game phase,
role authorization, and evidence visibility against the database → only then broadcast. A client
cannot claim to be a different player (the cookie is the only identity signal and it's server-issued),
cannot claim a different role (roles are looked up server-side from `game_players`, never trusted from
the client), and cannot fetch evidence by guessing an id (`evidence:attach` and `knownfact:add` both
re-check role visibility *and* the unlock ledger — see `apps/server/src/__tests__/security.test.ts`).
