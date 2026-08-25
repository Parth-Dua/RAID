import { desc, eq } from "drizzle-orm";
import type { InterventionKind, Role, TeamStateClassification } from "@raid/shared";
import type { Database } from "../db/client.js";
import { gameInterventions } from "../db/schema.js";

export type GameInterventionRow = typeof gameInterventions.$inferSelect;

export async function insertIntervention(
  db: Database,
  params: {
    gameId: string;
    classification: TeamStateClassification;
    kind: InterventionKind;
    message: string;
    targetRole: Role | null;
    confidence: number;
    elapsedSeconds: number;
  },
): Promise<GameInterventionRow> {
  const [row] = await db
    .insert(gameInterventions)
    .values({
      gameId: params.gameId,
      classification: params.classification,
      kind: params.kind,
      message: params.message,
      targetRole: params.targetRole,
      confidence: Math.round(params.confidence * 100),
      elapsedSeconds: params.elapsedSeconds,
    })
    .returning();
  if (!row) throw new Error("Failed to record intervention");
  return row;
}

export async function countInterventionsForGame(db: Database, gameId: string): Promise<number> {
  const rows = await db.select({ id: gameInterventions.id }).from(gameInterventions).where(eq(gameInterventions.gameId, gameId));
  return rows.length;
}

export async function findLastInterventionForGame(db: Database, gameId: string): Promise<GameInterventionRow | undefined> {
  const [row] = await db
    .select()
    .from(gameInterventions)
    .where(eq(gameInterventions.gameId, gameId))
    .orderBy(desc(gameInterventions.createdAt))
    .limit(1);
  return row;
}

export async function findInterventionsForGame(db: Database, gameId: string): Promise<GameInterventionRow[]> {
  return db.select().from(gameInterventions).where(eq(gameInterventions.gameId, gameId)).orderBy(gameInterventions.elapsedSeconds);
}
