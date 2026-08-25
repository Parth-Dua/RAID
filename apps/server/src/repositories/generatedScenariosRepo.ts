import { eq } from "drizzle-orm";
import type { GeneratedScenarioDefinition } from "@raid/shared";
import type { Database } from "../db/client.js";
import { generatedScenarios } from "../db/schema.js";

export type GeneratedScenarioRow = typeof generatedScenarios.$inferSelect;

export async function insertGeneratedScenario(
  db: Database,
  params: {
    scenarioId: string;
    title: string;
    severity: string;
    briefing: string;
    tagline: string;
    definition: GeneratedScenarioDefinition;
    requestedDescription: string;
  },
): Promise<GeneratedScenarioRow> {
  const [row] = await db
    .insert(generatedScenarios)
    .values({
      scenarioId: params.scenarioId,
      title: params.title,
      severity: params.severity,
      briefing: params.briefing,
      tagline: params.tagline,
      definition: params.definition,
      requestedDescription: params.requestedDescription,
    })
    .returning();
  if (!row) throw new Error("Failed to save generated scenario");
  return row;
}

export async function findGeneratedScenarioByScenarioId(db: Database, scenarioId: string): Promise<GeneratedScenarioRow | undefined> {
  const [row] = await db.select().from(generatedScenarios).where(eq(generatedScenarios.scenarioId, scenarioId)).limit(1);
  return row;
}

export async function findAllGeneratedScenarios(db: Database): Promise<GeneratedScenarioRow[]> {
  return db.select().from(generatedScenarios).orderBy(generatedScenarios.createdAt);
}

export async function existsGeneratedScenarioId(db: Database, scenarioId: string): Promise<boolean> {
  const row = await findGeneratedScenarioByScenarioId(db, scenarioId);
  return row !== undefined;
}
