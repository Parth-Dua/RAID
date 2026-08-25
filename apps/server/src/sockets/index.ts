import type { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ChatSendPayload,
  EvidenceAttachPayload,
  FinalSubmitPayload,
  GameStartPayload,
  HypothesisChallengePayload,
  HypothesisCreatePayload,
  HypothesisSupportPayload,
  KnownFactAddPayload,
  PlayerLeavePayload,
  PlayerReadyPayload,
  ToolExecutePayload,
} from "@raid/shared";
import { db } from "../db/client.js";
import { logger } from "../logger.js";
import { RaidError } from "../domain/errors.js";
import { socketAuthMiddleware, type SocketAuthData } from "./auth.js";
import { isRateLimited } from "./rateLimiter.js";
import { startClock, stopClock } from "./clock.js";
import * as roomService from "../services/roomService.js";
import * as gameService from "../services/gameService.js";
import * as roomsRepo from "../repositories/roomsRepo.js";
import {
  emitEvidenceUnlocked,
  emitFinalEvaluated,
  emitGameCompleted,
  emitGameEvent,
  emitGameSnapshotToPlayer,
  emitGameSnapshotToRoom,
  emitHypothesisUpdated,
  emitRoomSnapshot,
  roomRoom,
} from "./emit.js";

type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string } }) => void;
type Handler<T> = (io: Server, socket: Socket, payload: T) => Promise<unknown>;

function socketData(socket: Socket): SocketAuthData {
  return socket.data as SocketAuthData;
}

export function registerSocketHandlers(io: Server): void {
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    void handleConnection(io, socket);

    socket.on("player:ready", withHandler(io, socket, "player:ready", PlayerReadyPayload, onPlayerReady));
    socket.on("player:leave", withHandler(io, socket, "player:leave", PlayerLeavePayload, onPlayerLeave));
    socket.on("game:start", withHandler(io, socket, "game:start", GameStartPayload, onGameStart));
    socket.on("chat:send", withHandler(io, socket, "chat:send", ChatSendPayload, onChatSend));
    socket.on("tool:execute", withHandler(io, socket, "tool:execute", ToolExecutePayload, onToolExecute));
    socket.on("hypothesis:create", withHandler(io, socket, "hypothesis:create", HypothesisCreatePayload, onHypothesisCreate));
    socket.on(
      "hypothesis:support",
      withHandler(io, socket, "hypothesis:support", HypothesisSupportPayload, (ioArg, s, p) =>
        onHypothesisReact(ioArg, s, p, "support"),
      ),
    );
    socket.on(
      "hypothesis:challenge",
      withHandler(io, socket, "hypothesis:challenge", HypothesisChallengePayload, (ioArg, s, p) =>
        onHypothesisReact(ioArg, s, p, "challenge"),
      ),
    );
    socket.on("evidence:attach", withHandler(io, socket, "evidence:attach", EvidenceAttachPayload, onEvidenceAttach));
    socket.on("knownfact:add", withHandler(io, socket, "knownfact:add", KnownFactAddPayload, onKnownFactAdd));
    socket.on("final:submit", withHandler(io, socket, "final:submit", FinalSubmitPayload, onFinalSubmit));

    socket.on("disconnect", () => void handleDisconnect(io, socket));
  });
}

function withHandler<T>(io: Server, socket: Socket, eventName: string, schema: z.ZodType<T>, handler: Handler<T>) {
  return async (rawPayload: unknown, ack?: Ack) => {
    const requestId = randomUUID();
    if (isRateLimited(socketData(socket).playerId, eventName)) {
      const err = { code: "RATE_LIMITED", message: "Too many actions, slow down." };
      ack?.({ ok: false, error: err });
      return;
    }
    try {
      const payload = schema.parse(rawPayload);
      const data = await handler(io, socket, payload);
      ack?.({ ok: true, data });
    } catch (err) {
      if (err instanceof RaidError) {
        logger.warn({ requestId, eventName, code: err.code, playerId: socketData(socket).playerId }, err.message);
        ack?.({ ok: false, error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof z.ZodError) {
        ack?.({ ok: false, error: { code: "INVALID_PAYLOAD", message: err.issues.map((i) => i.message).join("; ") } });
        return;
      }
      logger.error({ requestId, eventName, err }, "unhandled socket handler error");
      ack?.({ ok: false, error: { code: "SERVER_ERROR", message: "Something went wrong." } });
    }
  };
}

async function handleConnection(io: Server, socket: Socket): Promise<void> {
  const { playerId, roomId } = socketData(socket);
  await socket.join(roomRoom(roomId));
  await roomService.setPlayerConnected(db, roomId, playerId, true);

  const roomSnapshot = await roomService.getRoomSnapshot(db, roomId);
  emitRoomSnapshot(io, roomId, roomSnapshot);

  if (roomSnapshot.gameId && roomSnapshot.phase !== "LOBBY") {
    await emitGameSnapshotToPlayer(io, db, roomSnapshot.gameId, playerId, socket.id);
  }
}

async function handleDisconnect(io: Server, socket: Socket): Promise<void> {
  const data = socket.data as SocketAuthData | undefined;
  if (!data) return;
  const { playerId, roomId } = data;
  try {
    const room = await roomsRepo.findRoomById(db, roomId);
    if (!room) return; // room no longer exists (e.g. process shutdown mid-test/dev-reset) - nothing to update

    await roomService.setPlayerConnected(db, roomId, playerId, false);
    await roomService.transferHostIfNeeded(db, roomId, playerId);

    const snapshot = await roomService.getRoomSnapshot(db, roomId);
    emitRoomSnapshot(io, roomId, snapshot);
  } catch (err) {
    logger.error({ err, playerId, roomId }, "handleDisconnect failed");
  }
}

// ---------------- handlers ----------------

const onPlayerReady: Handler<{ ready: boolean }> = async (io, socket, payload) => {
  const { playerId, roomId } = socketData(socket);
  await roomService.setPlayerReady(db, roomId, playerId, payload.ready);
  const snapshot = await roomService.getRoomSnapshot(db, roomId);
  emitRoomSnapshot(io, roomId, snapshot);
};

const onPlayerLeave: Handler<Record<string, never>> = async (io, socket) => {
  const { playerId, roomId } = socketData(socket);
  await roomService.leaveRoom(db, roomId, playerId);
  await socket.leave(roomRoom(roomId));
  const snapshot = await roomService.getRoomSnapshot(db, roomId);
  emitRoomSnapshot(io, roomId, snapshot);
  // The client disconnects its own socket once it receives this ack - the server has already
  // dropped the player row, so there's nothing further for this socket to be authorized to do.
};

const onGameStart: Handler<{ durationPreset?: "standard" | "demo" | "instant" }> = async (io, socket, payload) => {
  const { playerId, roomId } = socketData(socket);
  const result = await roomService.startGame(db, roomId, playerId, payload.durationPreset ?? "standard");
  const snapshot = await roomService.getRoomSnapshot(db, roomId);
  emitRoomSnapshot(io, roomId, snapshot);
  await emitGameSnapshotToRoom(io, db, roomId, result.gameId);
  startClock(io, db, roomId, result.gameId);
  return { gameId: result.gameId };
};

const onChatSend: Handler<{ text: string; clientMsgId: string }> = async (io, socket, payload) => {
  const { playerId, roomId, displayName } = socketData(socket);
  const room = await roomsRepo.findRoomById(db, roomId);
  if (!room?.currentGameId) throw new RaidError("INVALID_PHASE", "No active game");
  const message = await gameService.sendChatMessage(db, room.currentGameId, playerId, displayName, payload.text, payload.clientMsgId);
  if (message) emitGameEvent(io, roomId, { kind: "chat", message });
};

const onToolExecute: Handler<{ toolId: string }> = async (io, socket, payload) => {
  const { playerId, roomId } = socketData(socket);
  const room = await roomsRepo.findRoomById(db, roomId);
  if (!room?.currentGameId) throw new RaidError("INVALID_PHASE", "No active game");
  const result = await gameService.executeTool(db, room.currentGameId, playerId, payload.toolId);

  if (result.unlockedEvidenceIds.length > 0) {
    const snapshot = await gameService.buildGameSnapshotForPlayer(db, room.currentGameId, playerId);
    const unlocked = snapshot.evidence.filter((e) => result.unlockedEvidenceIds.includes(e.id));
    emitEvidenceUnlocked(io, socket.id, unlocked);
  }
  return { output: result.output, unlockedEvidenceIds: result.unlockedEvidenceIds };
};

const onHypothesisCreate: Handler<{ text: string; clientMsgId: string }> = async (io, socket, payload) => {
  const { playerId, roomId, displayName } = socketData(socket);
  const room = await roomsRepo.findRoomById(db, roomId);
  if (!room?.currentGameId) throw new RaidError("INVALID_PHASE", "No active game");
  const gameId = room.currentGameId;

  const row = await gameService.createHypothesis(db, gameId, playerId, payload.text, payload.clientMsgId);
  if (!row) return; // dedup'd duplicate submit

  emitHypothesisUpdated(io, roomId, {
    id: row.id,
    gameId,
    authorId: playerId,
    authorName: displayName,
    text: row.text,
    status: "OPEN",
    aiRationale: null,
    supportedBy: [],
    challengedBy: [],
    evidenceIds: [],
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  });

  // AI evaluation runs after the ack/broadcast above so hypothesis:updated (OPEN) always
  // arrives before the evaluated version - the UI shows "evaluating..." in between.
  void gameService.evaluateHypothesisAsync(db, gameId, row.id).then(async () => {
    const updatedRoom = await roomsRepo.findRoomById(db, roomId);
    if (!updatedRoom?.currentGameId) return;
    const snap = await gameService.buildGameSnapshotForPlayer(db, updatedRoom.currentGameId, playerId);
    const updatedHyp = snap.hypotheses.find((h) => h.id === row.id);
    if (updatedHyp) emitHypothesisUpdated(io, roomId, { ...updatedHyp, authorName: displayName });
  });

  return { hypothesisId: row.id };
};

async function onHypothesisReact(io: Server, socket: Socket, payload: { hypothesisId: string }, kind: "support" | "challenge") {
  const { playerId, roomId } = socketData(socket);
  const room = await roomsRepo.findRoomById(db, roomId);
  if (!room?.currentGameId) throw new RaidError("INVALID_PHASE", "No active game");
  const applied = await gameService.reactToHypothesis(db, room.currentGameId, playerId, payload.hypothesisId, kind);
  if (applied) {
    const snap = await gameService.buildGameSnapshotForPlayer(db, room.currentGameId, playerId);
    const hyp = snap.hypotheses.find((h) => h.id === payload.hypothesisId);
    if (hyp) emitHypothesisUpdated(io, roomId, hyp);
  }
}

const onEvidenceAttach: Handler<{ hypothesisId: string; evidenceId: string }> = async (io, socket, payload) => {
  const { playerId, roomId } = socketData(socket);
  const room = await roomsRepo.findRoomById(db, roomId);
  if (!room?.currentGameId) throw new RaidError("INVALID_PHASE", "No active game");
  const applied = await gameService.attachEvidenceToHypothesis(db, room.currentGameId, playerId, payload.hypothesisId, payload.evidenceId);
  if (applied) {
    const snap = await gameService.buildGameSnapshotForPlayer(db, room.currentGameId, playerId);
    const hyp = snap.hypotheses.find((h) => h.id === payload.hypothesisId);
    if (hyp) emitHypothesisUpdated(io, roomId, hyp);
  }
};

const onKnownFactAdd: Handler<{ text: string; category?: "fact" | "question"; sourceEvidenceId?: string | null }> = async (
  io,
  socket,
  payload,
) => {
  const { playerId, roomId } = socketData(socket);
  const room = await roomsRepo.findRoomById(db, roomId);
  if (!room?.currentGameId) throw new RaidError("INVALID_PHASE", "No active game");
  const fact = await gameService.addKnownFact(
    db,
    room.currentGameId,
    playerId,
    payload.text,
    payload.category ?? "fact",
    payload.sourceEvidenceId ?? null,
  );
  emitGameEvent(io, roomId, { kind: "known_fact", fact });
};

const onFinalSubmit: Handler<{
  rootCause: string;
  supportingEvidenceIds: string[];
  remediation: string;
  clientMsgId: string;
}> = async (io, socket, payload) => {
  const { playerId, roomId } = socketData(socket);
  const room = await roomsRepo.findRoomById(db, roomId);
  if (!room?.currentGameId) throw new RaidError("INVALID_PHASE", "No active game");
  const gameId = room.currentGameId;

  const outcome = await gameService.finalizeGame(db, gameId, {
    playerId,
    input: { rootCause: payload.rootCause, supportingEvidenceIds: payload.supportingEvidenceIds, remediation: payload.remediation },
    clientMsgId: payload.clientMsgId,
  });

  stopClock(gameId);
  emitFinalEvaluated(io, roomId, outcome.debrief);
  emitGameCompleted(io, roomId);
  await emitGameSnapshotToRoom(io, db, roomId, gameId);
  const roomSnapshot = await roomService.getRoomSnapshot(db, roomId);
  emitRoomSnapshot(io, roomId, roomSnapshot);
};
