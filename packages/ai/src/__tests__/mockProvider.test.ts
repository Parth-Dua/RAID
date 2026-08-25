import { describe, expect, it } from "vitest";
import { buildScenario, listScenarioIds } from "@raid/game-engine";
import { MockAIProvider } from "../mockProvider.js";
import type { CollectiveReasoningState } from "../collectiveState.js";
import { TEAM_STATE_CLASSIFICATIONS } from "@raid/shared";

const scenario = buildScenario("checkout-degradation", 1200);
const provider = new MockAIProvider();

function baseState(overrides: Partial<CollectiveReasoningState> = {}): CollectiveReasoningState {
  return {
    elapsedSeconds: 300,
    durationSeconds: 1200,
    discoveredEvidence: scenario.evidence.slice(0, 6).map((e) => ({ id: e.id, title: e.title, category: e.category })),
    activeHypotheses: [{ text: "A plausible direction", status: "PLAUSIBLE" }],
    challengedHypotheses: [],
    ruledOutHypotheses: [],
    openQuestions: [],
    knownFacts: [],
    toolsExecuted: [],
    recentTrajectory: [{ atSeconds: 250, summary: "Ran a tool" }],
    subsystemCoverage: { backend_engineer: 0.4, database_engineer: 0.4, sre: 0.4 },
    ...overrides,
  };
}

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

  describe("classifyTeamState", () => {
    it("always returns one of the 7 documented classifications", async () => {
      const { result } = await provider.classifyTeamState({ scenario, state: baseState() });
      expect(TEAM_STATE_CLASSIFICATIONS).toContain(result.classification);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("classifies as STALLED when there's been no recent activity despite meaningful elapsed time", async () => {
      const { result } = await provider.classifyTeamState({
        scenario,
        state: baseState({ elapsedSeconds: 600, recentTrajectory: [] }),
      });
      expect(result.classification).toBe("STALLED");
    });

    it("classifies as INSUFFICIENT_EVIDENCE early with little evidence discovered", async () => {
      const { result } = await provider.classifyTeamState({
        scenario,
        state: baseState({ elapsedSeconds: 100, discoveredEvidence: [], recentTrajectory: [{ atSeconds: 90, summary: "x" }] }),
      });
      expect(result.classification).toBe("INSUFFICIENT_EVIDENCE");
    });

    it("classifies as CONTRADICTORY_REASONING when an active hypothesis is under unresolved challenge", async () => {
      const { result } = await provider.classifyTeamState({
        scenario,
        state: baseState({
          activeHypotheses: [{ text: "disputed theory", status: "PLAUSIBLE" }],
          challengedHypotheses: [{ text: "disputed theory", status: "PLAUSIBLE", challengeCount: 1 }],
        }),
      });
      expect(result.classification).toBe("CONTRADICTORY_REASONING");
    });

    it("classifies as TUNNEL_VISION when only one subsystem has been touched deep into the game", async () => {
      const { result } = await provider.classifyTeamState({
        scenario,
        state: baseState({
          elapsedSeconds: 700,
          subsystemCoverage: { backend_engineer: 0.8, database_engineer: 0, sre: 0 },
        }),
      });
      expect(result.classification).toBe("TUNNEL_VISION");
    });

    it("classifies as SOLVING_TOO_QUICKLY when a hypothesis is already SUPPORTED with little evidence", async () => {
      const { result } = await provider.classifyTeamState({
        scenario,
        state: baseState({
          discoveredEvidence: scenario.evidence.slice(0, 3).map((e) => ({ id: e.id, title: e.title, category: e.category })),
          // References a real causal term so this doesn't also trip IGNORING_CRITICAL_SIGNAL -
          // this test isolates the "confident but under-evidenced" case specifically.
          activeHypotheses: [{ text: `confident theory about ${scenario.scoringHints.causalTerms[0]}`, status: "SUPPORTED" }],
        }),
      });
      expect(result.classification).toBe("SOLVING_TOO_QUICKLY");
    });

    it("classifies as ON_TRACK for healthy, active, well-evidenced investigation", async () => {
      const { result } = await provider.classifyTeamState({
        scenario,
        state: baseState({
          discoveredEvidence: scenario.evidence.map((e) => ({ id: e.id, title: e.title, category: e.category })),
          activeHypotheses: [{ text: "a well-supported theory referencing " + scenario.scoringHints.causalTerms[0], status: "SUPPORTED" }],
          subsystemCoverage: { backend_engineer: 1, database_engineer: 1, sre: 1 },
        }),
      });
      expect(result.classification).toBe("ON_TRACK");
    });
  });

  describe("proposeIntervention", () => {
    it("never intervenes on ON_TRACK", async () => {
      const { result } = await provider.proposeIntervention({ scenario, state: baseState(), classification: "ON_TRACK" });
      expect(result.shouldIntervene).toBe(false);
      expect(result.kind).toBeNull();
      expect(result.message).toBeNull();
    });

    it("never intervenes on SOLVING_TOO_QUICKLY", async () => {
      const { result } = await provider.proposeIntervention({ scenario, state: baseState(), classification: "SOLVING_TOO_QUICKLY" });
      expect(result.shouldIntervene).toBe(false);
    });

    it.each(["TUNNEL_VISION", "CONTRADICTORY_REASONING", "IGNORING_CRITICAL_SIGNAL", "STALLED"] as const)(
      "proposes a valid, non-leaking intervention for %s",
      async (classification) => {
        const { result } = await provider.proposeIntervention({ scenario, state: baseState(), classification });
        expect(result.shouldIntervene).toBe(true);
        expect(result.kind).not.toBeNull();
        expect(result.message).not.toBeNull();
        expect(result.message!.length).toBeGreaterThanOrEqual(10);
        // The message must never contain a real evidence or tool id verbatim.
        for (const e of scenario.evidence) expect(result.message).not.toContain(e.id);
        for (const t of scenario.tools) expect(result.message).not.toContain(t.id);
      },
    );

    it("targets the least-covered role for a TUNNEL_VISION intervention", async () => {
      const { result } = await provider.proposeIntervention({
        scenario,
        state: baseState({ subsystemCoverage: { backend_engineer: 1, database_engineer: 0, sre: 0.5 } }),
        classification: "TUNNEL_VISION",
      });
      expect(result.targetRole).toBe("database_engineer");
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
