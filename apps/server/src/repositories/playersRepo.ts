import { eq, and, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { players } from "../db/schema.js";

export type PlayerRow = typeof players.$inferSelect;

const MAX_PLAYERS_PER_ROOM = 4;

/**
 * Grace period between a REST join (which creates the player row) and the socket
 * connection that follows it. A player inside this window counts toward the room
 * even though `connected` is still false, so a real player mid-handshake is never
 * evicted; past it, a row that never connected is an abandoned "ghost" join and is
 * reclaimed rather than permanently occupying a seat. See docs/REVIEW_NOTES.md.
 */
const JOIN_GRACE_MS = 60_000;

/** Players that actually occupy a seat: currently connected, or joined/seen recently enough to still be arriving. */
export function occupiesSeat(player: PlayerRow, nowMs = Date.now()): boolean {
  return player.connected || nowMs - player.lastSeenAt.getTime() < JOIN_GRACE_MS;
}

export async function insertPlayer(
  db: Database,
  params: { roomId: string; displayName: string; sessionToken: string },
): Promise<PlayerRow | { error: "ROOM_FULL" }> {
  return db.transaction(async (tx) => {
    // SELECT ... FOR UPDATE serializes concurrent joins to the same room, so two
    // simultaneous joins can't both read "3 players" and both insert a 4th.
    const existing = await tx.select().from(players).where(eq(players.roomId, params.roomId)).for("update");
    const now = Date.now();
    const occupied = existing.filter((p) => occupiesSeat(p, now));
    if (occupied.length >= MAX_PLAYERS_PER_ROOM) {
      return { error: "ROOM_FULL" as const };
    }

    // Reclaim abandoned never-connected rows so they don't accumulate indefinitely.
    const stale = existing.filter((p) => !occupiesSeat(p, now));
    if (stale.length > 0) {
      await tx.delete(players).where(
        inArray(
          players.id,
          stale.map((p) => p.id),
        ),
      );
    }
    const [row] = await tx
      .insert(players)
      .values({
        roomId: params.roomId,
        displayName: params.displayName,
        sessionToken: params.sessionToken,
        connected: false,
      })
      .returning();
    if (!row) throw new Error("Failed to create player");
    return row;
  });
}

export async function findPlayerById(db: Database, id: string): Promise<PlayerRow | undefined> {
  const [row] = await db.select().from(players).where(eq(players.id, id)).limit(1);
  return row;
}

export async function findPlayersInRoom(db: Database, roomId: string): Promise<PlayerRow[]> {
  return db.select().from(players).where(eq(players.roomId, roomId)).orderBy(players.createdAt);
}

export async function setPlayerReady(db: Database, playerId: string, ready: boolean): Promise<PlayerRow | undefined> {
  const [row] = await db.update(players).set({ ready, lastSeenAt: new Date() }).where(eq(players.id, playerId)).returning();
  return row;
}

export async function setPlayerConnected(db: Database, playerId: string, connected: boolean): Promise<PlayerRow | undefined> {
  const [row] = await db
    .update(players)
    .set({ connected, lastSeenAt: new Date() })
    .where(eq(players.id, playerId))
    .returning();
  return row;
}

export async function deletePlayer(db: Database, playerId: string): Promise<void> {
  await db.delete(players).where(eq(players.id, playerId));
}

export async function findPlayerByDisplayNameInRoom(
  db: Database,
  roomId: string,
  displayName: string,
): Promise<PlayerRow | undefined> {
  const [row] = await db
    .select()
    .from(players)
    .where(and(eq(players.roomId, roomId), eq(players.displayName, displayName)))
    .limit(1);
  return row;
}
