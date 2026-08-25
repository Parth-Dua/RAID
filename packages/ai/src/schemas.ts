import { z } from "zod";
import { INTERVENTION_KINDS, ROLES, TEAM_STATE_CLASSIFICATIONS } from "@raid/shared";

/**
 * Every one of these schemas validates untrusted model output before it is
 * allowed anywhere near domain logic. See docs/AI_DESIGN.md "AI response
 * validation loop". Field-level bounds (e.g. score <= weight) are checked
 * here where the bound is fixed; bounds that depend on the scenario's
 * rubric weights are re-checked by the caller (packages/game-engine
 * scoring.ts clamps again, defense in depth).
 */

/** Every HYPOTHESIS_STATUS value except OPEN, which only ever applies to a
 * freshly-created hypothesis the AI hasn't evaluated yet. Written as a literal
 * tuple (rather than derived via .filter()) so zod/TS infer the precise
 * union type instead of widening to `string`. */
export const HypothesisEvaluationSchema = z.object({
  status: z.enum(["SUPPORTED", "PLAUSIBLE", "WEAK", "CONTRADICTED"]),
  rationale: z.string().min(10).max(500),
});
export type HypothesisEvaluation = z.infer<typeof HypothesisEvaluationSchema>;

export const FinalEvaluationSchema = z.object({
  rootCauseAccuracy: z.number().min(0).max(40),
  evidenceQuality: z.number().min(0).max(20),
  remediationQuality: z.number().min(0).max(20),
  rationale: z.string().min(10).max(1000),
  matchedKeyEvidenceIds: z.array(z.string().min(1).max(100)).max(30),
});
export type FinalEvaluation = z.infer<typeof FinalEvaluationSchema>;

export const DebriefContentSchema = z.object({
  collaborationNote: z.string().min(5).max(400),
  coachingNotes: z.array(z.string().min(5).max(300)).min(1).max(6),
});
export type DebriefContent = z.infer<typeof DebriefContentSchema>;

/** V0.4.2: structured-output-only team-state classification, Zod validated like every other AI
 * response. `confidence` lets the caller apply a minimum-confidence gate before acting on it. */
export const TeamStateClassificationSchema = z.object({
  classification: z.enum(TEAM_STATE_CLASSIFICATIONS),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(10).max(400),
});
export type TeamStateClassificationResult = z.infer<typeof TeamStateClassificationSchema>;

/** V0.4.3: a proposed intervention. Validated here (shape) and again by
 * `interventionValidator.ts` (safety semantics — leak check, budget) before it is ever delivered. */
export const InterventionProposalSchema = z
  .object({
    shouldIntervene: z.boolean(),
    kind: z.enum(INTERVENTION_KINDS).nullable(),
    message: z.string().min(10).max(300).nullable(),
    targetRole: z.enum(ROLES).nullable(),
    confidence: z.number().min(0).max(1),
  })
  .refine((v) => !v.shouldIntervene || (v.kind !== null && v.message !== null), {
    message: "kind and message are required when shouldIntervene is true",
  });
export type InterventionProposal = z.infer<typeof InterventionProposalSchema>;

/**
 * V0.5.2: strict schema for an AI-generated scenario candidate — mirrors
 * `GeneratedScenarioDefinition` (packages/shared/src/domain.ts) field-for-field. This is the shape
 * check only ("never accept raw arbitrary content as valid"); `validateGeneratedScenario`
 * (packages/game-engine) is the separate deterministic pass that checks cross-references (does
 * every evidence.unlock.toolId actually name a real tool?) and executability, which a shape schema
 * alone can't express.
 */
const GeneratedToolSchema = z.object({
  id: z.string().min(1).max(60),
  role: z.enum(ROLES),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
  resultSummary: z.string().min(1).max(200),
  baselineOutput: z.string().max(400).optional(),
});

const GeneratedEvidenceSchema = z.object({
  id: z.string().min(1).max(60),
  visibleToRoles: z.array(z.enum(ROLES)).min(1).max(4),
  title: z.string().min(1).max(120),
  category: z.enum(["log", "metric", "trace", "deployment", "chat_note", "incident_fact"]),
  content: z.string().min(1).max(1200),
  hint: z.string().max(300).optional(),
  unlock: z.object({
    toolId: z.string().max(60).optional(),
    atFraction: z.number().min(0).max(1).optional(),
  }),
  isRedHerring: z.boolean(),
  isKeyEvidence: z.boolean(),
});

const GeneratedTimelineStepSchema = z.object({
  atFraction: z.number().min(0).max(1),
  headline: z.string().min(1).max(150),
  detail: z.string().max(300).optional(),
});

const RubricWeightsSchema = z.object({
  rootCauseAccuracy: z.number().min(0).max(100),
  evidenceQuality: z.number().min(0).max(100),
  remediationQuality: z.number().min(0).max(100),
  efficiency: z.number().min(0).max(100),
  collaboration: z.number().min(0).max(100),
});

export const GeneratedScenarioSchema = z.object({
  id: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "id must be a lowercase-hyphen slug"),
  title: z.string().min(3).max(100),
  severity: z.enum(["SEV-1", "SEV-2", "SEV-3"]),
  briefing: z.string().min(20).max(600),
  tools: z.array(GeneratedToolSchema).min(4).max(25),
  evidence: z.array(GeneratedEvidenceSchema).min(6).max(30),
  timeline: z.array(GeneratedTimelineStepSchema).min(2).max(10),
  rootCause: z.object({
    summary: z.string().min(20).max(800),
    causalChain: z.array(z.string().min(5).max(300)).min(4).max(10),
    remediation: z.string().min(10).max(500),
    keyEvidenceIds: z.array(z.string().min(1).max(60)).min(1).max(15),
  }),
  plausibleWrongHypotheses: z.array(z.string().min(5).max(300)).min(1).max(8),
  rubricWeights: RubricWeightsSchema.refine((w) => Object.values(w).reduce((a, b) => a + b, 0) === 100, {
    message: "rubricWeights must sum to 100",
  }),
  scoringHints: z.object({
    causalTerms: z.array(z.string().min(1).max(60)).min(2).max(12),
    redHerringTerms: z.array(z.string().min(1).max(60)).min(1).max(12),
    remediationTerms: z.array(z.string().min(1).max(60)).min(1).max(12),
    distinctiveTerms: z.array(z.string().min(1).max(60)).min(2).max(8),
  }),
});
export type GeneratedScenario = z.infer<typeof GeneratedScenarioSchema>;

/** V0.5.4: a single, bounded AI review pass over an already structurally-valid candidate — never a
 * second full generation, and never run over more than one candidate per generation attempt (see
 * docs/AI_DESIGN.md "do not spend API budget reviewing large numbers of scenarios"). */
export const SemanticReviewSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string().min(5).max(300)).max(10),
});
export type SemanticReview = z.infer<typeof SemanticReviewSchema>;
