import { randomUUID } from "node:crypto";
import type { Role } from "@raid/shared";
import type {
  AIInvocationMeta,
  AIProvider,
  DebriefInput,
  FinalEvaluationInput,
  HypothesisEvaluationInput,
  InterventionProposalInput,
  TeamStateClassificationInput,
} from "./provider.js";
import type { DebriefContent, FinalEvaluation, HypothesisEvaluation, InterventionProposal, TeamStateClassificationResult } from "./schemas.js";

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

  /**
   * Deterministic classification ladder, checked in priority order. Not a substitute for the real
   * model's judgment (same caveat as every other mock heuristic here) — it exists so V0.4's
   * adaptive-Game-Master pipeline (classify -> maybe intervene -> deliver) is fully exercisable,
   * deterministically, in tests and free local play.
   */
  async classifyTeamState(
    input: TeamStateClassificationInput,
  ): Promise<{ result: TeamStateClassificationResult; meta: AIInvocationMeta }> {
    const start = Date.now();
    const { scenario, state } = input;
    const progressFraction = state.durationSeconds > 0 ? state.elapsedSeconds / state.durationSeconds : 0;

    let result: TeamStateClassificationResult;
    if (state.recentTrajectory.length === 0 && progressFraction > 0.25) {
      result = {
        classification: "STALLED",
        confidence: 0.75,
        rationale: "No investigation activity has been logged recently despite meaningful time having passed.",
      };
    } else if (state.discoveredEvidence.length < 3) {
      result = {
        classification: "INSUFFICIENT_EVIDENCE",
        confidence: 0.8,
        rationale: "Very little evidence has been discovered yet — normal for early in the investigation.",
      };
    } else if (
      state.challengedHypotheses.length > 0 &&
      state.activeHypotheses.some((h) => state.challengedHypotheses.some((c) => c.text === h.text))
    ) {
      result = {
        classification: "CONTRADICTORY_REASONING",
        confidence: 0.65,
        rationale: "A hypothesis still active on the board has been challenged by a teammate and never reconciled.",
      };
    } else if (
      progressFraction > 0.4 &&
      Object.values(state.subsystemCoverage).filter((f) => (f ?? 0) > 0).length <= 1 &&
      Object.keys(state.subsystemCoverage).length > 1
    ) {
      result = {
        classification: "TUNNEL_VISION",
        confidence: 0.6,
        rationale: "Investigation has stayed within a single subsystem despite meaningful time having passed and other subsystems being available.",
      };
    } else if (
      state.discoveredEvidence.length > 0 &&
      !state.activeHypotheses.some((h) => scenario.scoringHints.causalTerms.some((t) => h.text.toLowerCase().includes(t)))
    ) {
      result = {
        classification: "IGNORING_CRITICAL_SIGNAL",
        confidence: 0.55,
        rationale: "Evidence has been discovered but no active hypothesis appears to engage with it.",
      };
    } else if (
      state.activeHypotheses.some((h) => h.status === "SUPPORTED") &&
      state.discoveredEvidence.length < Math.max(3, Math.ceil(scenario.rootCause.keyEvidenceIds.length / 2))
    ) {
      result = {
        classification: "SOLVING_TOO_QUICKLY",
        confidence: 0.6,
        rationale: "A hypothesis is already marked supported despite the team having gathered less than half the scenario's key evidence.",
      };
    } else {
      result = {
        classification: "ON_TRACK",
        confidence: 0.7,
        rationale: "The team is actively investigating, evidence is accumulating, and hypotheses on the board are reasonably well-supported.",
      };
    }

    return { result, meta: mockMeta("classifyTeamState", start) };
  }

  /**
   * Only ON_TRACK/SOLVING_TOO_QUICKLY are treated as "nothing to fix"; the other 5 classifications
   * get a templated, kind-appropriate nudge. Messages never reference specific evidence content —
   * only evidence titles ever reach this provider (see collectiveState.ts), so there is nothing to
   * leak even if the mock tried.
   */
  async proposeIntervention(input: InterventionProposalInput): Promise<{ result: InterventionProposal; meta: AIInvocationMeta }> {
    const start = Date.now();
    const { state, classification } = input;

    let result: InterventionProposal;
    switch (classification) {
      case "TUNNEL_VISION": {
        const leastCovered = (Object.entries(state.subsystemCoverage) as [Role, number][]).sort((a, b) => a[1] - b[1])[0];
        result = {
          shouldIntervene: true,
          kind: "OPERATIONAL_CLUE",
          message: "Ops note: incidents like this usually touch more than one part of the stack — has every role's tooling been checked yet?",
          targetRole: leastCovered ? leastCovered[0] : null,
          confidence: 0.65,
        };
        break;
      }
      case "CONTRADICTORY_REASONING":
        result = {
          shouldIntervene: true,
          kind: "RECONCILE_SUGGESTION",
          message: "Two things the team has found don't fully agree with each other yet — worth reconciling before committing to a direction.",
          targetRole: null,
          confidence: 0.6,
        };
        break;
      case "IGNORING_CRITICAL_SIGNAL":
        result = {
          shouldIntervene: true,
          kind: "OPTIONAL_HINT",
          message: "One of the readings already on the board might matter more than it first looked — worth a second look.",
          targetRole: null,
          confidence: 0.55,
        };
        break;
      case "STALLED":
        result = {
          shouldIntervene: true,
          kind: "CUSTOMER_SYMPTOM",
          message: "Support just flagged a fresh customer report on this incident — might be worth revisiting what's changed recently.",
          targetRole: null,
          confidence: 0.6,
        };
        break;
      default:
        result = { shouldIntervene: false, kind: null, message: null, targetRole: null, confidence: 0.9 };
    }

    return { result, meta: mockMeta("proposeIntervention", start) };
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
