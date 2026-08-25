import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { games, gamePlayers } from "../db/schema.js";
import type { Role } from "@raid/shared";

export type GameRow = typeof games.$inferSelect;
export type GamePlayerRow = typeof gamePlayers.$inferSelect;

export async function insertGame(
  db: Database,
  params: { roomId: string; scenarioId: string; difficulty: string; durationSeconds: number; startedAt: Date; endsAt: Date },
): Promise<GameRow> {
  const [row] = await db
    .insert(games)
    .values({
      roomId: params.roomId,
      scenarioId: params.scenarioId,
      difficulty: params.difficulty,
      durationSeconds: params.durationSeconds,
      startedAt: params.startedAt,
      endsAt: params.endsAt,
    })
    .returning();
  if (!row) throw new Error("Failed to create game");
  return row;
}

export async function findGameById(db: Database, id: string): Promise<GameRow | undefined> {
  const [row] = await db.select().from(games).where(eq(games.id, id)).limit(1);
  return row;
}

/** V0.6.5: every game ever played in a room, oldest first - the source list the room-scoped
 * leaderboard is built from (joined against game_results, which only exists for completed games). */
export async function findGamesByRoom(db: Database, roomId: string): Promise<GameRow[]> {
  return db.select().from(games).where(eq(games.roomId, roomId)).orderBy(asc(games.createdAt));
}

export async function insertGamePlayers(
  db: Database,
  gameId: string,
  assignments: { playerId: string; role: Role }[],
): Promise<GamePlayerRow[]> {
  if (assignments.length === 0) return [];
  return db
    .insert(gamePlayers)
    .values(assignments.map((a) => ({ gameId, playerId: a.playerId, role: a.role })))
    .returning();
}

export async function findGamePlayers(db: Database, gameId: string): Promise<GamePlayerRow[]> {
  return db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
}

/** V0.6.5: batched form of findGamePlayers for the room leaderboard, which otherwise would
 * issue one query per game in the room (N+1). */
export async function findGamePlayersForGames(db: Database, gameIds: string[]): Promise<GamePlayerRow[]> {
  if (gameIds.length === 0) return [];
  return db.select().from(gamePlayers).where(inArray(gamePlayers.gameId, gameIds));
}
