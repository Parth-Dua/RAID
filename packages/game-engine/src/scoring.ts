import type { ScenarioDefinition, ScoreBreakdown } from "@raid/shared";

/**
 * Deterministic scoring components. The AI proposes rootCauseAccuracy,
 * evidenceQuality and remediationQuality (0..weight) via a validated rubric
 * response — see packages/ai. efficiency and collaboration are computed
 * here deterministically from recorded game events, never by the model,
 * because they are objectively derivable from the event log.
 */

export interface EfficiencyInput {
  scenario: Pick<ScenarioDefinition, "durationSeconds" | "rubricWeights">;
  elapsedSeconds: number;
  playerCount: number;
  distinctToolExecutions: number;
}

export function computeEfficiencyScore(input: EfficiencyInput): number {
  const weight = input.scenario.rubricWeights.efficiency;
  const timeFraction = Math.min(1, input.elapsedSeconds / input.scenario.durationSeconds);
  // Faster completion scores higher; a team that used all the time gets ~40% credit,
  // a team that wraps up by the halfway mark gets full credit.
  const timeScore = 1 - Math.max(0, timeFraction - 0.5) / 0.5;
  return Math.round(clamp01(timeScore) * weight);
}

export interface CollaborationInput {
  scenario: Pick<ScenarioDefinition, "rubricWeights">;
  playerCount: number;
  distinctContributors: number; // players who did >=1 tool call, chat msg, hypothesis, or fact add
  hypothesesWithMultipleSupporters: number;
  totalHypotheses: number;
}

export function computeCollaborationScore(input: CollaborationInput): number {
  const weight = input.scenario.rubricWeights.collaboration;
  if (input.playerCount === 0) return 0;
  const participationRatio = input.distinctContributors / input.playerCount;
  const crossSupportRatio =
    input.totalHypotheses === 0
      ? 0
      : input.hypothesesWithMultipleSupporters / input.totalHypotheses;
  const score = participationRatio * 0.6 + crossSupportRatio * 0.4;
  return Math.round(clamp01(score) * weight);
}

export function assembleFinalScore(
  weights: ScenarioDefinition["rubricWeights"],
  parts: {
    rootCauseAccuracy: number;
    evidenceQuality: number;
    remediationQuality: number;
    efficiency: number;
    collaboration: number;
  },
): ScoreBreakdown {
  const rootCauseAccuracy = clampToWeight(parts.rootCauseAccuracy, weights.rootCauseAccuracy);
  const evidenceQuality = clampToWeight(parts.evidenceQuality, weights.evidenceQuality);
  const remediationQuality = clampToWeight(parts.remediationQuality, weights.remediationQuality);
  const efficiency = clampToWeight(parts.efficiency, weights.efficiency);
  const collaboration = clampToWeight(parts.collaboration, weights.collaboration);
  const total = rootCauseAccuracy + evidenceQuality + remediationQuality + efficiency + collaboration;
  return {
    rootCauseAccuracy,
    evidenceQuality,
    remediationQuality,
    efficiency,
    collaboration,
    total: Math.min(100, total),
  };
}

function clampToWeight(value: number, weight: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(weight, Math.round(value)));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
