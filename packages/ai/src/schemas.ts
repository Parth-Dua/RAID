import { z } from "zod";

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

/** Not exercised at MVP runtime (scenario is authored, not generated) — kept as a
 * documented extension point / schema so a future `generateScenario` call has
 * somewhere to land without inventing an unvalidated shape under time pressure. */
export const ScenarioSeedSchema = z.object({
  title: z.string().min(3).max(100),
  briefing: z.string().min(20).max(600),
  severity: z.enum(["SEV-1", "SEV-2", "SEV-3"]),
});
export type ScenarioSeed = z.infer<typeof ScenarioSeedSchema>;
