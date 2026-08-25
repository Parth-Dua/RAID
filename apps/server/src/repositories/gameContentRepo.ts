import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { chatMessages, gameEvidence, knownFacts, toolActions } from "../db/schema.js";

export async function findUnlockedEvidenceIds(db: Database, gameId: string): Promise<Set<string>> {
  const rows = await db.select({ evidenceId: gameEvidence.evidenceId }).from(gameEvidence).where(eq(gameEvidence.gameId, gameId));
  return new Set(rows.map((r) => r.evidenceId));
}

/** Idempotent: unique(game_id, evidence_id) means a duplicate unlock attempt (two players
 * triggering the same evidence concurrently) is silently absorbed by ON CONFLICT DO NOTHING. */
export async function insertUnlockedEvidence(
  db: Database,
  gameId: string,
  evidenceIds: string[],
  unlockedAtSeconds: number,
  unlockedByPlayerId: string,
): Promise<string[]> {
  if (evidenceIds.length === 0) return [];
  const rows = await db
    .insert(gameEvidence)
    .values(evidenceIds.map((evidenceId) => ({ gameId, evidenceId, unlockedAtSeconds, unlockedByPlayerId })))
    .onConflictDoNothing({ target: [gameEvidence.gameId, gameEvidence.evidenceId] })
    .returning({ evidenceId: gameEvidence.evidenceId });
  return rows.map((r) => r.evidenceId);
}

export async function findExecutedToolIds(db: Database, gameId: string): Promise<Set<string>> {
  const rows = await db.select({ toolId: toolActions.toolId }).from(toolActions).where(eq(toolActions.gameId, gameId));
  return new Set(rows.map((r) => r.toolId));
}

/** V0.6.1: every evidence-unlock row (not just the distinct evidence id set
 * `findUnlockedEvidenceIds` returns) - used to compute each player's real per-role evidence
 * contribution for the debrief. */
export async function findUnlockedEvidenceRows(
  db: Database,
  gameId: string,
): Promise<{ evidenceId: string; unlockedByPlayerId: string | null; unlockedAtSeconds: number }[]> {
  return db
    .select({
      evidenceId: gameEvidence.evidenceId,
      unlockedByPlayerId: gameEvidence.unlockedByPlayerId,
      unlockedAtSeconds: gameEvidence.unlockedAtSeconds,
    })
    .from(gameEvidence)
    .where(eq(gameEvidence.gameId, gameId));
}

/** V0.6.1: every tool-execution row (not just distinct executors) - used to compute each player's
 * real tool-usage count for the debrief's role-contribution breakdown. */
export async function findToolActionsForGame(db: Database, gameId: string): Promise<{ playerId: string; toolId: string }[]> {
  return db.select({ playerId: toolActions.playerId, toolId: toolActions.toolId }).from(toolActions).where(eq(toolActions.gameId, gameId));
}

export async function insertToolAction(
  db: Database,
  params: { gameId: string; playerId: string; toolId: string; executedAtSeconds: number; output: string },
) {
  const [row] = await db.insert(toolActions).values(params).returning();
  return row;
}

export async function findDistinctToolExecutorIds(db: Database, gameId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ playerId: toolActions.playerId })
    .from(toolActions)
    .where(eq(toolActions.gameId, gameId));
  return rows.map((r) => r.playerId);
}

export async function insertChatMessage(
  db: Database,
  params: {
    gameId: string;
    authorId: string | null;
    authorName: string;
    text: string;
    kind: "player" | "system" | "ai_intervention";
    clientMsgId: string | null;
  },
) {
  const [row] = await db
    .insert(chatMessages)
    .values(params)
    .onConflictDoNothing({ target: [chatMessages.gameId, chatMessages.clientMsgId] })
    .returning();
  return row;
}

export async function findChatMessages(db: Database, gameId: string) {
  return db.select().from(chatMessages).where(eq(chatMessages.gameId, gameId)).orderBy(chatMessages.createdAt);
}

export async function insertKnownFact(
  db: Database,
  params: { gameId: string; text: string; category: "fact" | "question"; sourceEvidenceId: string | null; addedBy: string },
) {
  const [row] = await db.insert(knownFacts).values(params).returning();
  return row;
}

export async function findKnownFacts(db: Database, gameId: string) {
  return db.select().from(knownFacts).where(eq(knownFacts.gameId, gameId)).orderBy(knownFacts.createdAt);
}
