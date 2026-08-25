import type { ScenarioDefinition } from "@raid/shared";
import type { DebriefContent, FinalEvaluation, HypothesisEvaluation } from "./schemas.js";

export interface HypothesisEvaluationInput {
  scenario: ScenarioDefinition;
  hypothesisText: string;
  elapsedSeconds: number;
  /** Brief text of other hypotheses already on the board, for context (not full objects). */
  otherHypotheses: string[];
  /** Titles of known facts the team has already surfaced. */
  knownFacts: string[];
}

export interface FinalEvaluationInput {
  scenario: ScenarioDefinition;
  rootCause: string;
  remediation: string;
  /** Evidence titles the team cited, already validated to be real evidence IDs by the caller. */
  citedEvidenceTitles: { id: string; title: string }[];
  elapsedSeconds: number;
}

export interface DebriefInput {
  scenario: ScenarioDefinition;
  finalEvaluation: FinalEvaluation;
  keyEvidenceFoundTitles: string[];
  keyEvidenceMissedTitles: string[];
  redHerringsEncounteredTitles: string[];
  hypothesesConsidered: { text: string; status: string }[];
  playerCount: number;
  distinctContributors: number;
  elapsedSeconds: number;
}

export interface AIInvocationMeta {
  requestId: string;
  operation: "evaluateHypothesis" | "evaluateFinalDiagnosis" | "generateDebrief";
  latencyMs: number;
  provider: "mock" | "deepseek";
  success: boolean;
  usedFallback: boolean;
  errorMessage?: string;
}

export interface AIProvider {
  evaluateHypothesis(input: HypothesisEvaluationInput): Promise<{ result: HypothesisEvaluation; meta: AIInvocationMeta }>;
  evaluateFinalDiagnosis(input: FinalEvaluationInput): Promise<{ result: FinalEvaluation; meta: AIInvocationMeta }>;
  generateDebrief(input: DebriefInput): Promise<{ result: DebriefContent; meta: AIInvocationMeta }>;
}
