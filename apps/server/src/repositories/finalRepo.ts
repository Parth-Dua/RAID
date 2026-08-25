import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { finalSubmissions, gameResults } from "../db/schema.js";

export type FinalSubmissionRow = typeof finalSubmissions.$inferSelect;
export type GameResultRow = typeof gameResults.$inferSelect;

/**
 * `final_submissions.game_id` is UNIQUE — this is the concurrency guard for
 * "two players submit final diagnosis simultaneously" / "timer expires
 * during final submission". Whichever insert wins the unique constraint
 * succeeds; the loser gets undefined back and the caller treats that as
 * "already submitted" rather than retrying, which would corrupt the
 * one-submission-per-game invariant.
 */
export async function insertFinalSubmission(
  db: Database,
  params: {
    gameId: string;
    submittedBy: string;
    rootCause: string;
    supportingEvidenceIds: string[];
    remediation: string;
    clientMsgId: string;
  },
): Promise<FinalSubmissionRow | undefined> {
  const [row] = await db
    .insert(finalSubmissions)
    .values(params)
    .onConflictDoNothing({ target: finalSubmissions.gameId })
    .returning();
  return row;
}

export async function findFinalSubmissionByGame(db: Database, gameId: string): Promise<FinalSubmissionRow | undefined> {
  const [row] = await db.select().from(finalSubmissions).where(eq(finalSubmissions.gameId, gameId)).limit(1);
  return row;
}

export async function insertGameResult(
  db: Database,
  params: {
    gameId: string;
    rootCauseAccuracy: number;
    evidenceQuality: number;
    remediationQuality: number;
    efficiency: number;
    collaboration: number;
    total: number;
    debrief: unknown;
  },
): Promise<GameResultRow | undefined> {
  const [row] = await db.insert(gameResults).values(params).onConflictDoNothing({ target: gameResults.gameId }).returning();
  return row;
}

export async function findGameResultByGame(db: Database, gameId: string): Promise<GameResultRow | undefined> {
  const [row] = await db.select().from(gameResults).where(eq(gameResults.gameId, gameId)).limit(1);
  return row;
}
