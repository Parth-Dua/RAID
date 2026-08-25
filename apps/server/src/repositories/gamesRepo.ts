import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { games, gamePlayers } from "../db/schema.js";
import type { Role } from "@raid/shared";

export type GameRow = typeof games.$inferSelect;
export type GamePlayerRow = typeof gamePlayers.$inferSelect;

export async function insertGame(
  db: Database,
  params: { roomId: string; scenarioId: string; durationSeconds: number; startedAt: Date; endsAt: Date },
): Promise<GameRow> {
  const [row] = await db
    .insert(games)
    .values({
      roomId: params.roomId,
      scenarioId: params.scenarioId,
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
