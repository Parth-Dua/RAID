import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { rooms } from "../db/schema.js";
import type { GamePhase } from "@raid/shared";

export type RoomRow = typeof rooms.$inferSelect;

export async function insertRoom(db: Database, code: string): Promise<RoomRow> {
  const [row] = await db.insert(rooms).values({ code, phase: "LOBBY" }).returning();
  if (!row) throw new Error("Failed to create room");
  return row;
}

export async function findRoomByCode(db: Database, code: string): Promise<RoomRow | undefined> {
  const [row] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
  return row;
}

export async function findRoomById(db: Database, id: string): Promise<RoomRow | undefined> {
  const [row] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
  return row;
}

export async function setHostPlayer(db: Database, roomId: string, hostPlayerId: string): Promise<void> {
  await db.update(rooms).set({ hostPlayerId, updatedAt: new Date() }).where(eq(rooms.id, roomId));
}

/**
 * Optimistic-concurrency phase transition: only succeeds if the room is
 * still at `expectedPhase` AND `expectedVersion`. This is what makes
 * "host presses Start twice" and "timer expiry races final submission"
 * safe — exactly one caller wins the row update, everyone else sees 0 rows
 * affected and treats it as already-transitioned rather than double-applying.
 */
export async function tryTransitionRoomPhase(
  db: Database,
  roomId: string,
  expectedPhase: GamePhase,
  expectedVersion: number,
  nextPhase: GamePhase,
  extra?: { currentGameId?: string | null },
): Promise<RoomRow | undefined> {
  const [row] = await db
    .update(rooms)
    .set({
      phase: nextPhase,
      version: sql`${rooms.version} + 1`,
      updatedAt: new Date(),
      ...(extra && "currentGameId" in extra ? { currentGameId: extra.currentGameId } : {}),
    })
    .where(sql`${rooms.id} = ${roomId} AND ${rooms.phase} = ${expectedPhase} AND ${rooms.version} = ${expectedVersion}`)
    .returning();
  return row;
}
