import { eq, sql, and } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { hypotheses, hypothesisEvidence, hypothesisReactions } from "../db/schema.js";
import type { HypothesisStatus } from "@raid/shared";

export type HypothesisRow = typeof hypotheses.$inferSelect;

export async function insertHypothesis(
  db: Database,
  params: { gameId: string; authorId: string; text: string; clientMsgId: string },
): Promise<HypothesisRow | undefined> {
  const [row] = await db
    .insert(hypotheses)
    .values({ gameId: params.gameId, authorId: params.authorId, text: params.text, clientMsgId: params.clientMsgId })
    .onConflictDoNothing({ target: [hypotheses.gameId, hypotheses.clientMsgId] })
    .returning();
  return row;
}

export async function findHypothesesForGame(db: Database, gameId: string): Promise<HypothesisRow[]> {
  return db.select().from(hypotheses).where(eq(hypotheses.gameId, gameId)).orderBy(hypotheses.createdAt);
}

export async function findHypothesisById(db: Database, id: string): Promise<HypothesisRow | undefined> {
  const [row] = await db.select().from(hypotheses).where(eq(hypotheses.id, id)).limit(1);
  return row;
}

/** Optimistic concurrency: only applies the AI evaluation if the hypothesis hasn't moved on
 * since the AI call started (e.g. a stale evaluation racing a newer game phase). */
export async function applyHypothesisEvaluation(
  db: Database,
  hypothesisId: string,
  expectedVersion: number,
  status: HypothesisStatus,
  aiRationale: string,
): Promise<HypothesisRow | undefined> {
  const [row] = await db
    .update(hypotheses)
    .set({ status, aiRationale, version: sql`${hypotheses.version} + 1` })
    .where(and(eq(hypotheses.id, hypothesisId), eq(hypotheses.version, expectedVersion)))
    .returning();
  return row;
}

/** Idempotent via unique(hypothesis_id, player_id, kind): concurrent duplicate
 * support/challenge clicks from the same player collapse to one row. */
export async function insertReaction(
  db: Database,
  params: { hypothesisId: string; playerId: string; kind: "support" | "challenge" },
): Promise<boolean> {
  const rows = await db
    .insert(hypothesisReactions)
    .values(params)
    .onConflictDoNothing({ target: [hypothesisReactions.hypothesisId, hypothesisReactions.playerId, hypothesisReactions.kind] })
    .returning();
  return rows.length > 0;
}

export async function findReactionsForHypothesis(db: Database, hypothesisId: string) {
  return db.select().from(hypothesisReactions).where(eq(hypothesisReactions.hypothesisId, hypothesisId));
}

export async function findReactionsForGame(db: Database, gameId: string) {
  return db
    .select({ hypothesisId: hypothesisReactions.hypothesisId, playerId: hypothesisReactions.playerId, kind: hypothesisReactions.kind })
    .from(hypothesisReactions)
    .innerJoin(hypotheses, eq(hypotheses.id, hypothesisReactions.hypothesisId))
    .where(eq(hypotheses.gameId, gameId));
}

export async function insertHypothesisEvidence(
  db: Database,
  params: { hypothesisId: string; evidenceId: string; attachedBy: string },
): Promise<boolean> {
  const rows = await db
    .insert(hypothesisEvidence)
    .values(params)
    .onConflictDoNothing({ target: [hypothesisEvidence.hypothesisId, hypothesisEvidence.evidenceId] })
    .returning();
  return rows.length > 0;
}

export async function findEvidenceForHypothesis(db: Database, hypothesisId: string): Promise<string[]> {
  const rows = await db
    .select({ evidenceId: hypothesisEvidence.evidenceId })
    .from(hypothesisEvidence)
    .where(eq(hypothesisEvidence.hypothesisId, hypothesisId));
  return rows.map((r) => r.evidenceId);
}

export async function findEvidenceForGameHypotheses(db: Database, gameId: string) {
  return db
    .select({ hypothesisId: hypothesisEvidence.hypothesisId, evidenceId: hypothesisEvidence.evidenceId })
    .from(hypothesisEvidence)
    .innerJoin(hypotheses, eq(hypotheses.id, hypothesisEvidence.hypothesisId))
    .where(eq(hypotheses.gameId, gameId));
}
