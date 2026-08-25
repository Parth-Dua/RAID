import { z } from "zod";

/**
 * Typed WebSocket event contract shared by server and web client.
 * See docs/WEBSOCKET_PROTOCOL.md for direction / authorization / broadcast semantics.
 * This is the single source of truth — neither app redefines these shapes.
 */

// ---------- Client -> Server ----------

export const PlayerReadyPayload = z.object({ ready: z.boolean() });
export type PlayerReadyPayload = z.infer<typeof PlayerReadyPayload>;

/** Voluntary leave. Only legal in LOBBY - once a game is ACTIVE a player's role/evidence are
 * bound into the game record and they can only disconnect, not remove themselves. */
export const PlayerLeavePayload = z.object({});
export type PlayerLeavePayload = z.infer<typeof PlayerLeavePayload>;

export const GameStartPayload = z.object({
  // "instant" is intentionally undocumented in the web UI - see DURATION_PRESETS
  // in @raid/game-engine for why it exists (fast bot-simulation regression runs).
  durationPreset: z.enum(["standard", "demo", "instant"]).optional(),
  scenarioId: z.string().min(1).max(60).optional(),
  difficulty: z.enum(["NORMAL", "HARD"]).optional(),
});
export type GameStartPayload = z.infer<typeof GameStartPayload>;

/** Host-only, only legal once the room is COMPLETED: resets the room back to LOBBY for another
 * round with the same players, without creating a brand-new room/invite code. */
export const RematchPayload = z.object({});
export type RematchPayload = z.infer<typeof RematchPayload>;

export const ChatSendPayload = z.object({
  text: z.string().min(1).max(500),
  clientMsgId: z.string().uuid(),
});
export type ChatSendPayload = z.infer<typeof ChatSendPayload>;

export const ToolExecutePayload = z.object({
  toolId: z.string().min(1).max(100),
});
export type ToolExecutePayload = z.infer<typeof ToolExecutePayload>;

export const HypothesisCreatePayload = z.object({
  text: z.string().min(5).max(600),
  clientMsgId: z.string().uuid(),
});
export type HypothesisCreatePayload = z.infer<typeof HypothesisCreatePayload>;

export const HypothesisSupportPayload = z.object({
  hypothesisId: z.string().uuid(),
});
export type HypothesisSupportPayload = z.infer<typeof HypothesisSupportPayload>;

export const HypothesisChallengePayload = z.object({
  hypothesisId: z.string().uuid(),
});
export type HypothesisChallengePayload = z.infer<typeof HypothesisChallengePayload>;

export const EvidenceAttachPayload = z.object({
  hypothesisId: z.string().uuid(),
  evidenceId: z.string().min(1).max(100),
});
export type EvidenceAttachPayload = z.infer<typeof EvidenceAttachPayload>;

export const KnownFactAddPayload = z.object({
  text: z.string().min(3).max(300),
  category: z.enum(["fact", "question"]).optional(),
  sourceEvidenceId: z.string().max(100).nullable().optional(),
});
export type KnownFactAddPayload = z.infer<typeof KnownFactAddPayload>;

export const FinalSubmitPayload = z.object({
  rootCause: z.string().min(10).max(1500),
  supportingEvidenceIds: z.array(z.string().min(1).max(100)).max(20),
  remediation: z.string().min(5).max(800),
  clientMsgId: z.string().uuid(),
});
export type FinalSubmitPayload = z.infer<typeof FinalSubmitPayload>;

export const ClientToServerEvents = {
  "player:ready": PlayerReadyPayload,
  "player:leave": PlayerLeavePayload,
  "game:start": GameStartPayload,
  "game:rematch": RematchPayload,
  "chat:send": ChatSendPayload,
  "tool:execute": ToolExecutePayload,
  "hypothesis:create": HypothesisCreatePayload,
  "hypothesis:support": HypothesisSupportPayload,
  "hypothesis:challenge": HypothesisChallengePayload,
  "evidence:attach": EvidenceAttachPayload,
  "knownfact:add": KnownFactAddPayload,
  "final:submit": FinalSubmitPayload,
} as const;

export type ClientToServerEventName = keyof typeof ClientToServerEvents;

// ---------- Server -> Client ----------

export interface ServerErrorPayload {
  code:
    | "INVALID_PAYLOAD"
    | "NOT_AUTHORIZED"
    | "ROOM_NOT_FOUND"
    | "ROOM_FULL"
    | "INVALID_PHASE"
    | "ALREADY_STARTED"
    | "RATE_LIMITED"
    | "NOT_HOST"
    | "UNKNOWN_TOOL"
    | "WRONG_ROLE"
    | "SERVER_ERROR";
  message: string;
  requestId?: string;
}

/**
 * Server -> client event names, documented in docs/WEBSOCKET_PROTOCOL.md.
 * Payload types live in domain.ts (RoomSnapshot, GameSnapshot, etc.) since
 * they are also used directly by REST responses.
 */
export const SERVER_EVENTS = [
  "room:snapshot",
  "player:joined",
  "player:left",
  "player:updated",
  "game:started",
  "game:snapshot",
  "game:event",
  "timer:update",
  "evidence:unlocked",
  "hypothesis:updated",
  "final:evaluated",
  "game:completed",
  "error",
] as const;
export type ServerEventName = (typeof SERVER_EVENTS)[number];
