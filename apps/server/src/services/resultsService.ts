import type { Debrief, LeaderboardEntry, PublicGameResult, Role } from "@raid/shared";
import type { Database } from "../db/client.js";
import { RaidError } from "../domain/errors.js";
import * as roomsRepo from "../repositories/roomsRepo.js";
import * as gamesRepo from "../repositories/gamesRepo.js";
import * as finalRepo from "../repositories/finalRepo.js";
import * as playersRepo from "../repositories/playersRepo.js";

/**
 * V0.6.4: public, read-only lookup for the shareable /result/:gameId page. `gameId` is an
 * unguessable UUID (this is the entire access control - same posture as the room-code-only room
 * lookup, acceptable at this MVP's accounts-free scope). Returns null for a game that either
 * doesn't exist or hasn't finished yet - the route maps that to 404, never a partial/fabricated
 * result.
 */
export async function getPublicGameResult(db: Database, gameId: string): Promise<PublicGameResult | null> {
  const game = await gamesRepo.findGameById(db, gameId);
  if (!game) return null;
  const result = await finalRepo.findGameResultByGame(db, gameId);
  if (!result) return null;
  return { gameId, completedAt: result.createdAt.toISOString(), debrief: result.debrief as Debrief };
}

/**
 * V0.6.5: room-scoped leaderboard - every completed game ever played in this room, most recent
 * first, built entirely from real persisted game_results rows. Deliberately not global/cross-room:
 * with no accounts, a cross-room ranking would conflate different people under the same display
 * name and imply a comparability the data doesn't support.
 */
export async function getRoomLeaderboard(db: Database, roomCode: string): Promise<LeaderboardEntry[]> {
  const room = await roomsRepo.findRoomByCode(db, roomCode);
  if (!room) throw new RaidError("ROOM_NOT_FOUND", "No room with that code");

  const games = await gamesRepo.findGamesByRoom(db, room.id);
  if (games.length === 0) return [];

  const results = await finalRepo.findGameResultsByGameIds(
    db,
    games.map((g) => g.id),
  );
  const resultByGameId = new Map(results.map((r) => [r.gameId, r]));

  const playersInRoom = await playersRepo.findPlayersInRoom(db, room.id);
  const nameById = new Map(playersInRoom.map((p) => [p.id, p.displayName]));

  const completedGameIds = games.filter((g) => resultByGameId.has(g.id)).map((g) => g.id);
  const allGamePlayers = await gamesRepo.findGamePlayersForGames(db, completedGameIds);
  const gamePlayersByGameId = new Map<string, typeof allGamePlayers>();
  for (const gp of allGamePlayers) {
    const list = gamePlayersByGameId.get(gp.gameId) ?? [];
    list.push(gp);
    gamePlayersByGameId.set(gp.gameId, list);
  }

  const entries: LeaderboardEntry[] = [];
  for (const game of games) {
    const result = resultByGameId.get(game.id);
    if (!result) continue; // game started but never finished (abandoned room, etc.)
    const debrief = result.debrief as Debrief;
    const gamePlayers = gamePlayersByGameId.get(game.id) ?? [];
    entries.push({
      gameId: game.id,
      scenarioTitle: debrief.scenarioTitle,
      difficulty: debrief.difficulty,
      total: result.total,
      completedAt: result.createdAt.toISOString(),
      players: gamePlayers.map((gp) => ({ displayName: nameById.get(gp.playerId) ?? "Unknown", role: gp.role as Role })),
    });
  }
  return entries.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
}
