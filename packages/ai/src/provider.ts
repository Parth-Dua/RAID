import type { ScenarioDefinition } from "@raid/shared";
import type { CollectiveReasoningState } from "./collectiveState.js";
import type { DebriefContent, FinalEvaluation, HypothesisEvaluation, InterventionProposal, TeamStateClassificationResult } from "./schemas.js";

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
  operation: "evaluateHypothesis" | "evaluateFinalDiagnosis" | "generateDebrief" | "classifyTeamState" | "proposeIntervention";
  latencyMs: number;
  provider: "mock" | "deepseek";
  success: boolean;
  usedFallback: boolean;
  errorMessage?: string;
}

export interface TeamStateClassificationInput {
  scenario: ScenarioDefinition;
  state: CollectiveReasoningState;
}

export interface InterventionProposalInput {
  scenario: ScenarioDefinition;
  state: CollectiveReasoningState;
  classification: TeamStateClassificationResult["classification"];
}

export interface AIProvider {
  evaluateHypothesis(input: HypothesisEvaluationInput): Promise<{ result: HypothesisEvaluation; meta: AIInvocationMeta }>;
  evaluateFinalDiagnosis(input: FinalEvaluationInput): Promise<{ result: FinalEvaluation; meta: AIInvocationMeta }>;
  generateDebrief(input: DebriefInput): Promise<{ result: DebriefContent; meta: AIInvocationMeta }>;
  /** V0.4.2: classify the team's current investigative state from a bounded collective-reasoning
   * snapshot — never raw chat, never per-role private evidence content. */
  classifyTeamState(input: TeamStateClassificationInput): Promise<{ result: TeamStateClassificationResult; meta: AIInvocationMeta }>;
  /** V0.4.3: given an intervention-eligible classification, propose (or decline) a safe,
   * budget/cooldown-gated nudge. The caller (gameMasterService) still runs backend validation and
   * enforces the intervention budget before ever delivering this to players. */
  proposeIntervention(input: InterventionProposalInput): Promise<{ result: InterventionProposal; meta: AIInvocationMeta }>;
}
