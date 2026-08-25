import { describe, expect, it } from "vitest";
import { assembleFinalScore, computeCollaborationScore, computeEfficiencyScore } from "../scoring.js";
import { buildScenario } from "../scenarioEngine.js";

const scenario = buildScenario("checkout-degradation", 1200);

describe("scoring", () => {
  it("clamps every rubric component to its weight even if AI over-reports", () => {
    const score = assembleFinalScore(scenario.rubricWeights, {
      rootCauseAccuracy: 999,
      evidenceQuality: -50,
      remediationQuality: 20,
      efficiency: 10,
      collaboration: 10,
    });
    expect(score.rootCauseAccuracy).toBe(40); // clamped to weight
    expect(score.evidenceQuality).toBe(0); // clamped to >= 0
    expect(score.total).toBeLessThanOrEqual(100);
  });

  it("never exceeds 100 total", () => {
    const score = assembleFinalScore(scenario.rubricWeights, {
      rootCauseAccuracy: 40,
      evidenceQuality: 20,
      remediationQuality: 20,
      efficiency: 10,
      collaboration: 10,
    });
    expect(score.total).toBe(100);
  });

  it("handles NaN/garbage input safely", () => {
    const score = assembleFinalScore(scenario.rubricWeights, {
      rootCauseAccuracy: NaN,
      evidenceQuality: Infinity,
      remediationQuality: -Infinity,
      efficiency: 5,
      collaboration: 5,
    });
    expect(score.rootCauseAccuracy).toBe(0);
    expect(Number.isFinite(score.total)).toBe(true);
  });

  it("efficiency rewards finishing well within the time limit", () => {
    const fast = computeEfficiencyScore({ scenario, elapsedSeconds: 300, playerCount: 4, distinctToolExecutions: 10 });
    const slow = computeEfficiencyScore({ scenario, elapsedSeconds: 1190, playerCount: 4, distinctToolExecutions: 10 });
    expect(fast).toBeGreaterThan(slow);
  });

  it("collaboration rewards broad participation and cross-supported hypotheses", () => {
    const high = computeCollaborationScore({
      scenario,
      playerCount: 4,
      distinctContributors: 4,
      hypothesesWithMultipleSupporters: 2,
      totalHypotheses: 2,
    });
    const low = computeCollaborationScore({
      scenario,
      playerCount: 4,
      distinctContributors: 1,
      hypothesesWithMultipleSupporters: 0,
      totalHypotheses: 2,
    });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(scenario.rubricWeights.collaboration);
  });
});
