import type { Difficulty, GeneratedScenarioDefinition, ScenarioCatalogEntry } from "@raid/shared";
import { listScenarioIds, validateGeneratedScenario, type ScenarioGenerationValidationResult } from "@raid/game-engine";
import type { SemanticReview } from "@raid/ai";
import type { Database } from "../db/client.js";
import { RaidError } from "../domain/errors.js";
import { aiProvider } from "./aiService.js";
import * as generatedScenariosRepo from "../repositories/generatedScenariosRepo.js";
import { logger } from "../logger.js";

const MAX_DESCRIPTION_LENGTH = 500;

export interface GenerateResult {
  candidate: GeneratedScenarioDefinition;
  validation: ScenarioGenerationValidationResult;
  semanticReview: SemanticReview | null;
  /** true only if the candidate passed BOTH the deterministic validator and the semantic review -
   * i.e. is actually eligible to be saved. The generate step itself never saves anything (V0.5.7:
   * generate -> inspect -> preview -> save are 4 distinct steps, not one). */
  eligibleToSave: boolean;
}

/**
 * V0.5.1/V0.5.4/V0.5.5: runs one generation attempt (with the GENERATE->VALIDATE->REPAIR->REVALIDATE
 * loop happening inside `aiProvider.generateScenario` itself - see DeepSeekProvider's `run()` reuse)
 * and, only if that structurally validates, exactly one semantic review call. Never saves anything -
 * see `saveGeneratedScenario` below, a separate, AI-call-free step.
 */
export async function generateScenario(description: string, difficulty?: Difficulty): Promise<GenerateResult> {
  const trimmed = description.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new RaidError("INVALID_PAYLOAD", `description must be 1-${MAX_DESCRIPTION_LENGTH} characters`);
  }

  const { result: candidate, meta: genMeta } = await aiProvider.generateScenario({ description: trimmed, difficulty });
  logger.info({ aiOperation: genMeta.operation, aiProvider: genMeta.provider, aiUsedFallback: genMeta.usedFallback }, "scenario generation attempt");

  const validation = validateGeneratedScenario(candidate);
  if (!validation.valid) {
    return { candidate, validation, semanticReview: null, eligibleToSave: false };
  }

  // V0.5.4: exactly one bounded review call, only ever reached once the candidate is already
  // structurally valid - never spent reviewing something that's already known to be broken.
  const { result: review, meta: reviewMeta } = await aiProvider.semanticReviewScenario({ candidate });
  logger.info(
    { aiOperation: reviewMeta.operation, aiProvider: reviewMeta.provider, aiUsedFallback: reviewMeta.usedFallback, passed: review.passed },
    "scenario semantic review",
  );

  return { candidate, validation, semanticReview: review, eligibleToSave: review.passed };
}

export interface SaveResult {
  scenarioId: string;
  catalogEntry: ScenarioCatalogEntry;
}

/**
 * V0.5.7's separate "save" step. Deliberately AI-free: it re-runs only the deterministic validator
 * (defense in depth against a tampered/hand-edited client payload - cheap, no network call) and
 * disambiguates the candidate's proposed id against every existing scenario id, built-in or
 * previously generated, before persisting. Does not re-run semantic review - that would spend AI
 * budget on every save/retry, which V0.5.6 explicitly rules out.
 */
export async function saveGeneratedScenario(
  db: Database,
  candidate: GeneratedScenarioDefinition,
  requestedDescription = "",
): Promise<SaveResult> {
  const validation = validateGeneratedScenario(candidate);
  if (!validation.valid) {
    throw new RaidError("INVALID_PAYLOAD", `Cannot save an invalid scenario: ${validation.errors.slice(0, 3).join("; ")}`);
  }

  const scenarioId = await uniqueScenarioId(db, candidate.id);
  const finalCandidate: GeneratedScenarioDefinition = { ...candidate, id: scenarioId };
  const tagline = candidate.briefing.length > 140 ? `${candidate.briefing.slice(0, 137)}...` : candidate.briefing;

  await generatedScenariosRepo.insertGeneratedScenario(db, {
    scenarioId,
    title: finalCandidate.title,
    severity: finalCandidate.severity,
    briefing: finalCandidate.briefing,
    tagline,
    definition: finalCandidate,
    requestedDescription: requestedDescription.slice(0, MAX_DESCRIPTION_LENGTH),
  });

  const catalogEntry: ScenarioCatalogEntry = {
    id: scenarioId,
    title: finalCandidate.title,
    severity: finalCandidate.severity,
    briefing: finalCandidate.briefing,
    tagline,
  };
  return { scenarioId, catalogEntry };
}

async function uniqueScenarioId(db: Database, proposedId: string): Promise<string> {
  const builtInIds = new Set(listScenarioIds());
  let candidateId = proposedId;
  let suffix = 2;
  while (builtInIds.has(candidateId) || (await generatedScenariosRepo.existsGeneratedScenarioId(db, candidateId))) {
    candidateId = `${proposedId}-${suffix}`;
    suffix++;
  }
  return candidateId;
}

export async function listGeneratedScenarioCatalog(db: Database): Promise<ScenarioCatalogEntry[]> {
  const rows = await generatedScenariosRepo.findAllGeneratedScenarios(db);
  return rows.map((r) => ({
    id: r.scenarioId,
    title: r.title,
    severity: r.severity as ScenarioCatalogEntry["severity"],
    briefing: r.briefing,
    tagline: r.tagline,
  }));
}
