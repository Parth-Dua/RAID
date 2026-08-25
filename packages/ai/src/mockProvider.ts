import { randomUUID } from "node:crypto";
import type {
  AIInvocationMeta,
  AIProvider,
  DebriefInput,
  FinalEvaluationInput,
  HypothesisEvaluationInput,
} from "./provider.js";
import type { DebriefContent, FinalEvaluation, HypothesisEvaluation } from "./schemas.js";

/**
 * Deterministic, network-free provider. Used whenever AI_PROVIDER=mock
 * (the default), which is what tests and day-to-day development run
 * against — RAID must be fully playable and testable without spending any
 * DeepSeek credits. The heuristics here are intentionally simple keyword
 * matching, not a re-implementation of language understanding; they exist
 * to make the mock's behavior *plausible* for manual playtesting, not to
 * be a substitute for the real model's judgment.
 */
export class MockAIProvider implements AIProvider {
  async evaluateHypothesis(
    input: HypothesisEvaluationInput,
  ): Promise<{ result: HypothesisEvaluation; meta: AIInvocationMeta }> {
    const start = Date.now();
    const text = input.hypothesisText.toLowerCase();

    const supportiveTerms = input.scenario.scoringHints.causalTerms;
    const redHerringTerms = input.scenario.scoringHints.redHerringTerms;

    const supportiveHits = supportiveTerms.filter((t) => text.includes(t)).length;
    const redHerringHits = redHerringTerms.filter((t) => text.includes(t)).length;

    let result: HypothesisEvaluation;
    if (redHerringHits > 0 && supportiveHits === 0) {
      result = {
        status: "CONTRADICTED",
        rationale:
          "The metrics the team has gathered don't support this direction — check the role-specific tools that " +
          "would confirm or rule this out before pursuing it further.",
      };
    } else if (supportiveHits >= 2) {
      result = {
        status: "SUPPORTED",
        rationale:
          "This is consistent with multiple signals the team has found. Make sure you can account for every " +
          "anomalous reading the team has surfaced, not just the ones that fit this theory, and cite specific " +
          "evidence when you submit a final diagnosis.",
      };
    } else if (supportiveHits === 1) {
      result = {
        status: "PLAUSIBLE",
        rationale:
          "This points in a reasonable direction but isn't fully backed yet — you likely need corroborating " +
          "evidence from another role before this explains the full picture.",
      };
    } else {
      result = {
        status: "WEAK",
        rationale:
          "There isn't much evidence on the board yet connecting this hypothesis to what's actually been observed. " +
          "Consider what each role's tools could confirm or rule out.",
      };
    }

    return { result, meta: mockMeta("evaluateHypothesis", start) };
  }

  async evaluateFinalDiagnosis(
    input: FinalEvaluationInput,
  ): Promise<{ result: FinalEvaluation; meta: AIInvocationMeta }> {
    const start = Date.now();
    const text = (input.rootCause + " " + input.remediation).toLowerCase();

    const { causalTerms, remediationTerms } = input.scenario.scoringHints;
    const hits = causalTerms.filter((t) => text.includes(t)).length;
    const fraction = Math.min(1, hits / 4);

    const citedKeyIds = input.citedEvidenceTitles
      .map((e) => e.id)
      .filter((id) => input.scenario.rootCause.keyEvidenceIds.includes(id));

    const result: FinalEvaluation = {
      rootCauseAccuracy: Math.round(fraction * 40),
      evidenceQuality: Math.round(Math.min(1, citedKeyIds.length / 4) * 20),
      remediationQuality: remediationTerms.some((t) => text.includes(t)) ? 16 : 8,
      rationale:
        fraction >= 0.75
          ? "The submission correctly identifies the scenario's actual causal mechanism."
          : "The submission captures part of the picture but doesn't fully connect the code-level change to the infrastructure-level failure mode.",
      matchedKeyEvidenceIds: citedKeyIds,
    };

    return { result, meta: mockMeta("evaluateFinalDiagnosis", start) };
  }

  async generateDebrief(input: DebriefInput): Promise<{ result: DebriefContent; meta: AIInvocationMeta }> {
    const start = Date.now();
    const result: DebriefContent = {
      collaborationNote:
        input.distinctContributors >= Math.max(2, input.playerCount - 1)
          ? "Most of the team actively contributed evidence and hypotheses — that spread of investigation is what made the diagnosis possible."
          : "Investigation leaned heavily on a subset of the team; wider participation tends to surface evidence faster.",
      coachingNotes: [
        input.keyEvidenceMissedTitles.length > 0
          ? `Next time, prioritize checking: ${input.keyEvidenceMissedTitles.slice(0, 3).join(", ")}.`
          : "The team found all of the key evidence — strong investigation coverage.",
        input.redHerringsEncounteredTitles.length > 0
          ? `Time was spent ruling out ${input.redHerringsEncounteredTitles.slice(0, 2).join(", ")}; confirming/denying leads quickly with a specific tool call keeps the team moving.`
          : "The team didn't get pulled into major red herrings — good filtering of hypotheses.",
        "Cross-role callouts in chat as soon as a metric looks abnormal tend to shorten time-to-diagnosis more than solo digging.",
      ],
    };
    return { result, meta: mockMeta("generateDebrief", start) };
  }
}

function mockMeta(operation: AIInvocationMeta["operation"], start: number): AIInvocationMeta {
  return {
    requestId: randomUUID(),
    operation,
    latencyMs: Date.now() - start,
    provider: "mock",
    success: true,
    usedFallback: false,
  };
}
