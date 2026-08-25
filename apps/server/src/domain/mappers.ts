import type { ChatMessage, KnownFact, PublicPlayer, Role, RoomSnapshot } from "@raid/shared";
import type { PlayerRow } from "../repositories/playersRepo.js";
import type { RoomRow } from "../repositories/roomsRepo.js";
import type { GamePlayerRow } from "../repositories/gamesRepo.js";

export function toPublicPlayer(player: PlayerRow, role: Role | null, isHost: boolean): PublicPlayer {
  return {
    id: player.id,
    displayName: player.displayName,
    isHost,
    ready: player.ready,
    connected: player.connected,
    role,
    joinedAt: player.createdAt.toISOString(),
  };
}

/**
 * `rooms.hostPlayerId` is the ONLY source of truth for who is host - see
 * docs/DECISIONS.md "single authoritative host" ADR. isHost is always
 * derived here at read time rather than cached on the player row, which is
 * exactly what host-transfer-on-disconnect requires: transferring host is a
 * single UPDATE to `rooms`, with nothing else to keep in sync.
 */
export function toRoomSnapshot(
  room: RoomRow,
  players: PlayerRow[],
  roleByPlayerId: Map<string, Role>,
  scenarioId: string | null = null,
): RoomSnapshot {
  return {
    roomId: room.id,
    code: room.code,
    phase: room.phase as RoomSnapshot["phase"],
    players: players.map((p) => toPublicPlayer(p, roleByPlayerId.get(p.id) ?? null, p.id === room.hostPlayerId)),
    gameId: room.currentGameId,
    scenarioId,
    createdAt: room.createdAt.toISOString(),
  };
}

export function roleMapFromGamePlayers(gamePlayers: GamePlayerRow[]): Map<string, Role> {
  return new Map(gamePlayers.map((gp) => [gp.playerId, gp.role as Role]));
}

export function toChatMessage(row: {
  id: string;
  gameId: string;
  authorId: string | null;
  authorName: string;
  text: string;
  kind: string;
  createdAt: Date;
}): ChatMessage {
  return {
    id: row.id,
    gameId: row.gameId,
    authorId: row.authorId,
    authorName: row.authorName,
    text: row.text,
    kind: row.kind as ChatMessage["kind"],
    createdAt: row.createdAt.toISOString(),
  };
}

export function toKnownFact(row: {
  id: string;
  text: string;
  category: string;
  sourceEvidenceId: string | null;
  addedBy: string;
  createdAt: Date;
}): KnownFact {
  return {
    id: row.id,
    text: row.text,
    category: row.category === "question" ? "question" : "fact",
    sourceEvidenceId: row.sourceEvidenceId,
    addedBy: row.addedBy,
    createdAt: row.createdAt.toISOString(),
  };
}
