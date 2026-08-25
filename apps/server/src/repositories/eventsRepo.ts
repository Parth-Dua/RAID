import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { gameEvents } from "../db/schema.js";

export type GameEventType =
  | "PLAYER_JOINED"
  | "PLAYER_LEFT"
  | "PLAYER_READY"
  | "GAME_STARTED"
  | "ROLE_ASSIGNED"
  | "TOOL_EXECUTED"
  | "EVIDENCE_UNLOCKED"
  | "HYPOTHESIS_CREATED"
  | "HYPOTHESIS_EVALUATED"
  | "HYPOTHESIS_REACTION"
  | "KNOWN_FACT_ADDED"
  | "SIMULATION_EVENT"
  | "FINAL_SUBMITTED"
  | "GAME_COMPLETED"
  | "GAME_ABANDONED";

export async function appendEvent(
  db: Database,
  params: {
    roomId: string;
    gameId?: string | null;
    type: GameEventType;
    payload: Record<string, unknown>;
    actorPlayerId?: string | null;
  },
) {
  const [row] = await db
    .insert(gameEvents)
    .values({
      roomId: params.roomId,
      gameId: params.gameId ?? null,
      type: params.type,
      payload: params.payload,
      actorPlayerId: params.actorPlayerId ?? null,
    })
    .returning();
  return row;
}

export async function findEventsForGame(db: Database, gameId: string) {
  return db.select().from(gameEvents).where(eq(gameEvents.gameId, gameId)).orderBy(asc(gameEvents.seq));
}
