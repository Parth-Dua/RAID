import type { Server } from "socket.io";
import type {
  Debrief,
  GameEventBroadcast,
  GameSnapshot,
  Hypothesis,
  PublicEvidence,
  RoomSnapshot,
  ServerErrorPayload,
} from "@raid/shared";
import { buildGameSnapshotForPlayer } from "../services/gameService.js";
import type { Database } from "../db/client.js";
import * as gamesRepo from "../repositories/gamesRepo.js";

/**
 * All server -> client emission is centralized here so the wire format
 * matches docs/WEBSOCKET_PROTOCOL.md in exactly one place.
 */
export function emitRoomSnapshot(io: Server, roomId: string, snapshot: RoomSnapshot): void {
  io.to(roomRoom(roomId)).emit("room:snapshot", snapshot);
}

export function emitError(io: Server, socketId: string, payload: ServerErrorPayload): void {
  io.to(socketId).emit("error", payload);
}

/** Game state is role-personalized, so every room member gets their own snapshot, not a broadcast. */
export async function emitGameSnapshotToRoom(io: Server, db: Database, roomId: string, gameId: string): Promise<void> {
  const sockets = await io.in(roomRoom(roomId)).fetchSockets();
  await Promise.all(
    sockets.map(async (s) => {
      const playerId = s.data.playerId as string | undefined;
      if (!playerId) return;
      const snapshot = await buildGameSnapshotForPlayer(db, gameId, playerId);
      s.emit("game:snapshot", snapshot);
    }),
  );
}

export async function emitGameSnapshotToPlayer(io: Server, db: Database, gameId: string, playerId: string, socketId: string): Promise<void> {
  const snapshot = await buildGameSnapshotForPlayer(db, gameId, playerId);
  io.to(socketId).emit("game:snapshot", snapshot);
}

export function emitGameEvent(io: Server, roomId: string, event: GameEventBroadcast): void {
  io.to(roomRoom(roomId)).emit("game:event", event);
}

export function emitTimerUpdate(io: Server, roomId: string, remainingSeconds: number): void {
  io.to(roomRoom(roomId)).emit("timer:update", { remainingSeconds });
}

export function emitEvidenceUnlocked(io: Server, socketId: string, evidence: PublicEvidence[]): void {
  if (evidence.length === 0) return;
  io.to(socketId).emit("evidence:unlocked", evidence);
}

export function emitHypothesisUpdated(io: Server, roomId: string, hypothesis: Hypothesis): void {
  io.to(roomRoom(roomId)).emit("hypothesis:updated", hypothesis);
}

export function emitFinalEvaluated(io: Server, roomId: string, debrief: Debrief): void {
  io.to(roomRoom(roomId)).emit("final:evaluated", debrief);
}

export function emitGameCompleted(io: Server, roomId: string): void {
  io.to(roomRoom(roomId)).emit("game:completed", { roomId });
}

export function roomRoom(roomId: string): string {
  return `room:${roomId}`;
}
