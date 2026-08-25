import { generateRoomCode, ROLES, type Role } from "@raid/shared";
import { assertTransition } from "@raid/game-engine";
import type { Database } from "../db/client.js";
import { RaidError } from "../domain/errors.js";
import { generateSessionToken } from "../domain/session.js";
import { toRoomSnapshot, roleMapFromGamePlayers } from "../domain/mappers.js";
import * as roomsRepo from "../repositories/roomsRepo.js";
import * as playersRepo from "../repositories/playersRepo.js";
import * as gamesRepo from "../repositories/gamesRepo.js";
import { appendEvent } from "../repositories/eventsRepo.js";
import { DURATION_PRESETS, type DurationPreset } from "@raid/game-engine";
import { logger } from "../logger.js";

const MIN_PLAYERS_TO_START = 3;
const MAX_PLAYERS_TO_START = 4;
const SCENARIO_ID = "checkout-degradation";

export interface CreatedIdentity {
  playerId: string;
  roomId: string;
  sessionToken: string;
}

export async function createRoom(db: Database, displayName: string): Promise<CreatedIdentity & { code: string }> {
  let room = undefined;
  for (let attempt = 0; attempt < 5 && !room; attempt++) {
    const code = generateRoomCode();
    try {
      room = await roomsRepo.insertRoom(db, code);
    } catch (err) {
      // unique violation on code collision (astronomically rare) - retry with a new code
      logger.warn({ err }, "room code collision, retrying");
    }
  }
  if (!room) throw new RaidError("SERVER_ERROR", "Could not allocate a room code");

  const sessionToken = generateSessionToken();
  const playerResult = await playersRepo.insertPlayer(db, { roomId: room.id, displayName, sessionToken });
  if ("error" in playerResult) throw new RaidError("ROOM_FULL", "Room is full");

  await roomsRepo.setHostPlayer(db, room.id, playerResult.id);
  await appendEvent(db, {
    roomId: room.id,
    type: "PLAYER_JOINED",
    payload: { playerId: playerResult.id, displayName, isHost: true },
    actorPlayerId: playerResult.id,
  });

  return { playerId: playerResult.id, roomId: room.id, sessionToken, code: room.code };
}

export async function joinRoom(db: Database, code: string, displayName: string): Promise<CreatedIdentity> {
  const room = await roomsRepo.findRoomByCode(db, code.toUpperCase());
  if (!room) throw new RaidError("ROOM_NOT_FOUND", `No room with code ${code}`);
  if (room.phase !== "LOBBY") throw new RaidError("INVALID_PHASE", "This room has already started its incident");

  const sessionToken = generateSessionToken();
  const playerResult = await playersRepo.insertPlayer(db, { roomId: room.id, displayName, sessionToken });
  if ("error" in playerResult) throw new RaidError("ROOM_FULL", "Room is full (max 4 players)");

  await appendEvent(db, {
    roomId: room.id,
    type: "PLAYER_JOINED",
    payload: { playerId: playerResult.id, displayName, isHost: false },
    actorPlayerId: playerResult.id,
  });

  return { playerId: playerResult.id, roomId: room.id, sessionToken };
}

export async function getRoomSnapshot(db: Database, roomId: string) {
  const room = await roomsRepo.findRoomById(db, roomId);
  if (!room) throw new RaidError("ROOM_NOT_FOUND", "Room not found");
  const players = await playersRepo.findPlayersInRoom(db, roomId);
  let roleMap = new Map<string, Role>();
  if (room.currentGameId) {
    const gamePlayers = await gamesRepo.findGamePlayers(db, room.currentGameId);
    roleMap = roleMapFromGamePlayers(gamePlayers);
  }
  return toRoomSnapshot(room, players, roleMap);
}

export async function setPlayerReady(db: Database, roomId: string, playerId: string, ready: boolean) {
  const room = await roomsRepo.findRoomById(db, roomId);
  if (!room) throw new RaidError("ROOM_NOT_FOUND", "Room not found");
  if (room.phase !== "LOBBY") throw new RaidError("INVALID_PHASE", "Cannot change ready state after start");
  const updated = await playersRepo.setPlayerReady(db, playerId, ready);
  if (!updated) throw new RaidError("SERVER_ERROR", "Player not found");
  await appendEvent(db, { roomId, type: "PLAYER_READY", payload: { playerId, ready }, actorPlayerId: playerId });
  return updated;
}

export async function setPlayerConnected(db: Database, roomId: string, playerId: string, connected: boolean) {
  const updated = await playersRepo.setPlayerConnected(db, playerId, connected);
  if (updated) {
    await appendEvent(db, {
      roomId,
      type: connected ? "PLAYER_JOINED" : "PLAYER_LEFT",
      payload: { playerId, connected },
      actorPlayerId: playerId,
    });
  }
  return updated;
}

export interface StartGameResult {
  gameId: string;
  scenarioId: string;
  durationSeconds: number;
  startedAtMs: number;
  endsAtMs: number;
  roleByPlayerId: Map<string, Role>;
}

/**
 * The atomic lobby -> active transition (spec step 9/10). Guards enforced,
 * in order: caller must be host, room must be in LOBBY, player count must be
 * 3-4, everyone must be ready. The actual phase flip uses optimistic
 * concurrency (rooms.version) so a double Start-button click race resolves
 * safely: the second caller's UPDATE affects 0 rows and gets ALREADY_STARTED
 * instead of creating a second game.
 */
export async function startGame(
  db: Database,
  roomId: string,
  requestingPlayerId: string,
  durationPreset: DurationPreset = "standard",
): Promise<StartGameResult> {
  const room = await roomsRepo.findRoomById(db, roomId);
  if (!room) throw new RaidError("ROOM_NOT_FOUND", "Room not found");
  if (room.hostPlayerId !== requestingPlayerId) throw new RaidError("NOT_HOST", "Only the host can start the game");
  if (room.phase !== "LOBBY") throw new RaidError("ALREADY_STARTED", "Game has already started");

  // Only players actually present can start or block a start: a player who joined via REST but
  // never opened a socket (or disconnected in the lobby) must not be able to hold the room hostage
  // by never readying up. See docs/REVIEW_NOTES.md "ghost join" finding.
  const allPlayers = await playersRepo.findPlayersInRoom(db, roomId);
  const players = allPlayers.filter((p) => p.connected);
  if (players.length < MIN_PLAYERS_TO_START) {
    throw new RaidError("INVALID_PHASE", `Need at least ${MIN_PLAYERS_TO_START} connected players to start`);
  }
  if (players.length > MAX_PLAYERS_TO_START) {
    throw new RaidError("INVALID_PHASE", `RAID supports at most ${MAX_PLAYERS_TO_START} players`);
  }
  if (!players.every((p) => p.ready)) {
    throw new RaidError("INVALID_PHASE", "All players must be ready");
  }

  assertTransition("LOBBY", "STARTING");
  const startingRoom = await roomsRepo.tryTransitionRoomPhase(db, roomId, "LOBBY", room.version, "STARTING");
  if (!startingRoom) {
    throw new RaidError("ALREADY_STARTED", "Game has already started");
  }

  const durationSeconds = DURATION_PRESETS[durationPreset];
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  const game = await gamesRepo.insertGame(db, { roomId, scenarioId: SCENARIO_ID, durationSeconds, startedAt, endsAt });

  const roleByPlayerId = assignRoles(players.map((p) => p.id));
  await gamesRepo.insertGamePlayers(
    db,
    game.id,
    [...roleByPlayerId.entries()].map(([playerId, role]) => ({ playerId, role })),
  );

  assertTransition("STARTING", "ACTIVE");
  const activeRoom = await roomsRepo.tryTransitionRoomPhase(db, roomId, "STARTING", startingRoom.version, "ACTIVE", {
    currentGameId: game.id,
  });
  if (!activeRoom) throw new RaidError("SERVER_ERROR", "Failed to activate game after role assignment");

  await appendEvent(db, {
    roomId,
    gameId: game.id,
    type: "GAME_STARTED",
    payload: { scenarioId: SCENARIO_ID, durationSeconds, playerCount: players.length },
  });
  for (const [playerId, role] of roleByPlayerId) {
    await appendEvent(db, { roomId, gameId: game.id, type: "ROLE_ASSIGNED", payload: { playerId, role }, actorPlayerId: playerId });
  }

  return {
    gameId: game.id,
    scenarioId: SCENARIO_ID,
    durationSeconds,
    startedAtMs: startedAt.getTime(),
    endsAtMs: endsAt.getTime(),
    roleByPlayerId,
  };
}

function assignRoles(playerIds: string[]): Map<string, Role> {
  const pool: Role[] = playerIds.length === 4 ? [...ROLES] : ROLES.filter((r) => r !== "incident_commander");
  const shuffled = shuffle(pool).slice(0, playerIds.length);
  const map = new Map<string, Role>();
  playerIds.forEach((id, i) => map.set(id, shuffled[i]!));
  return map;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
