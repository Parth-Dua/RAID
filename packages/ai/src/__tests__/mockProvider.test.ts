import { describe, expect, it } from "vitest";
import { buildScenario, listScenarioIds } from "@raid/game-engine";
import { MockAIProvider } from "../mockProvider.js";

const scenario = buildScenario("checkout-degradation", 1200);
const provider = new MockAIProvider();

describe("MockAIProvider", () => {
  it("never calls the network and always resolves", async () => {
    const { result, meta } = await provider.evaluateHypothesis({
      scenario,
      hypothesisText: "The connection pool is exhausted because of a repeated query pattern from the new deploy.",
      elapsedSeconds: 300,
      otherHypotheses: [],
      knownFacts: [],
    });
    expect(meta.provider).toBe("mock");
    expect(meta.success).toBe(true);
    expect(["SUPPORTED", "PLAUSIBLE", "WEAK", "CONTRADICTED"]).toContain(result.status);
  });

  it("contradicts a pure red-herring hypothesis", async () => {
    const { result } = await provider.evaluateHypothesis({
      scenario,
      hypothesisText: "This looks like a sudden traffic spike overwhelming the service.",
      elapsedSeconds: 300,
      otherHypotheses: [],
      knownFacts: [],
    });
    expect(result.status).toBe("CONTRADICTED");
  });

  it("never leaks the root cause in hypothesis rationale", async () => {
    const cases = [
      "traffic spike",
      "connection pool exhausted deploy loyalty",
      "random guess about nothing",
    ];
    for (const text of cases) {
      const { result } = await provider.evaluateHypothesis({
        scenario,
        hypothesisText: text,
        elapsedSeconds: 100,
        otherHypotheses: [],
        knownFacts: [],
      });
      expect(result.rationale.toLowerCase()).not.toContain("the root cause is");
      expect(result.rationale.toLowerCase()).not.toContain("correct!");
    }
  });

  it("scores a well-formed final diagnosis higher than a weak one", async () => {
    const good = await provider.evaluateFinalDiagnosis({
      scenario,
      rootCause:
        "The deploy added a per-item loyalty lookup causing N+1 query volume, saturating the connection pool.",
      remediation: "Batch the loyalty query and roll back if needed.",
      citedEvidenceTitles: [
        { id: "be_deploy_log", title: "x" },
        { id: "db_pool_saturation", title: "y" },
      ],
      elapsedSeconds: 600,
    });
    const weak = await provider.evaluateFinalDiagnosis({
      scenario,
      rootCause: "Not sure, maybe the network is slow.",
      remediation: "Restart the service.",
      citedEvidenceTitles: [],
      elapsedSeconds: 600,
    });
    expect(good.result.rootCauseAccuracy).toBeGreaterThan(weak.result.rootCauseAccuracy);
  });

  it("evaluateFinalDiagnosis never returns scores above rubric bounds", async () => {
    const { result } = await provider.evaluateFinalDiagnosis({
      scenario,
      rootCause: "deploy loyalty n+1 per item connection pool pool",
      remediation: "batch cache rollback",
      citedEvidenceTitles: scenario.evidence.map((e) => ({ id: e.id, title: e.title })),
      elapsedSeconds: 100,
    });
    expect(result.rootCauseAccuracy).toBeLessThanOrEqual(40);
    expect(result.evidenceQuality).toBeLessThanOrEqual(20);
    expect(result.remediationQuality).toBeLessThanOrEqual(20);
  });

  describe.each(listScenarioIds())("scoring is scenario-aware, not checkout-degradation-shaped (regression)", (scenarioId) => {
    // Regression coverage for a real bug found during V0.4 architecture review: MockAIProvider's
    // scoring used one hardcoded, checkout-degradation-shaped keyword list for every scenario, so
    // lock-contention's and memory-leak's own correct answers ("lock contention", "memory leak")
    // were scored as if they were RED HERRINGS, because those exact phrases were literally on the
    // hardcoded red-herring list. Fixed by moving keyword hints onto each ScenarioDefinition
    // (`scoringHints`) so the mock provider reads scenario-specific data instead of one literal
    // list. This test would have failed against the pre-fix code for lock-contention/memory-leak.
    const s = buildScenario(scenarioId, 1200);

    it(`a hypothesis built from ${scenarioId}'s own causal terms is not contradicted`, async () => {
      const text = s.scoringHints.causalTerms.slice(0, 3).join(" ");
      const { result } = await provider.evaluateHypothesis({
        scenario: s,
        hypothesisText: text,
        elapsedSeconds: 300,
        otherHypotheses: [],
        knownFacts: [],
      });
      expect(result.status).not.toBe("CONTRADICTED");
    });

    it(`a hypothesis built from ${scenarioId}'s own red-herring terms is contradicted`, async () => {
      const text = s.scoringHints.redHerringTerms[0]!;
      const { result } = await provider.evaluateHypothesis({
        scenario: s,
        hypothesisText: text,
        elapsedSeconds: 300,
        otherHypotheses: [],
        knownFacts: [],
      });
      expect(result.status).toBe("CONTRADICTED");
    });

    it(`${scenarioId}'s own root cause summary scores meaningfully higher than an unrelated guess`, async () => {
      const good = await provider.evaluateFinalDiagnosis({
        scenario: s,
        rootCause: s.rootCause.summary,
        remediation: s.rootCause.remediation,
        citedEvidenceTitles: [],
        elapsedSeconds: 600,
      });
      const weak = await provider.evaluateFinalDiagnosis({
        scenario: s,
        rootCause: "Not sure, maybe it's just a fluke.",
        remediation: "Restart everything.",
        citedEvidenceTitles: [],
        elapsedSeconds: 600,
      });
      expect(good.result.rootCauseAccuracy).toBeGreaterThan(weak.result.rootCauseAccuracy);
      expect(good.result.rootCauseAccuracy).toBeGreaterThan(20);
    });
  });

  it("generateDebrief acknowledges missed key evidence", async () => {
    const { result } = await provider.generateDebrief({
      scenario,
      finalEvaluation: {
        rootCauseAccuracy: 20,
        evidenceQuality: 10,
        remediationQuality: 10,
        rationale: "partial",
        matchedKeyEvidenceIds: [],
      },
      keyEvidenceFoundTitles: [],
      keyEvidenceMissedTitles: ["Deployment: checkout-service v2.14.0"],
      redHerringsEncounteredTitles: [],
      hypothesesConsidered: [],
      playerCount: 4,
      distinctContributors: 1,
      elapsedSeconds: 900,
    });
    expect(result.coachingNotes.length).toBeGreaterThan(0);
    expect(result.coachingNotes.join(" ")).toContain("Deployment: checkout-service v2.14.0");
  });
});
