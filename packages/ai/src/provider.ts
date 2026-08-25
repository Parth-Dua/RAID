import type { Difficulty, ScenarioDefinition } from "@raid/shared";
import type { CollectiveReasoningState } from "./collectiveState.js";
import type {
  DebriefContent,
  FinalEvaluation,
  GeneratedScenario,
  HypothesisEvaluation,
  InterventionProposal,
  SemanticReview,
  TeamStateClassificationResult,
} from "./schemas.js";

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
  operation:
    | "evaluateHypothesis"
    | "evaluateFinalDiagnosis"
    | "generateDebrief"
    | "classifyTeamState"
    | "proposeIntervention"
    | "generateScenario"
    | "semanticReviewScenario";
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

export interface ScenarioGenerationInput {
  /** A free-text request, e.g. "Create an intermediate Kubernetes incident caused by a broken
   * readiness configuration." Never trusted as anything but generation-prompt content. */
  description: string;
  difficulty?: Difficulty;
}

export interface SemanticReviewInput {
  candidate: GeneratedScenario;
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
  /** V0.5.1/V0.5.5: generate a difficulty-neutral scenario candidate from a free-text request. The
   * GENERATE -> VALIDATE -> REPAIR -> REVALIDATE loop (V0.5.5) is implemented via the same
   * schema-failure/semantic-failure repair-prompt retry every other operation already has
   * (DeepSeekProvider's `run()`) — here the "semantic" check IS the deterministic structural
   * validator (`validateGeneratedScenario`), so a structurally broken candidate triggers a bounded
   * number of in-conversation repair retries before ever reaching the caller. */
  generateScenario(input: ScenarioGenerationInput): Promise<{ result: GeneratedScenario; meta: AIInvocationMeta }>;
  /** V0.5.4: a single bounded AI review pass over an already structurally-valid candidate, checking
   * causal consistency / role balance / answer leakage / red-herring plausibility / remediation
   * validity / scenario coherence — the caller must never invoke this more than once per generation
   * attempt (see docs/AI_DESIGN.md "budget-efficient live evaluation"). */
  semanticReviewScenario(input: SemanticReviewInput): Promise<{ result: SemanticReview; meta: AIInvocationMeta }>;
}
