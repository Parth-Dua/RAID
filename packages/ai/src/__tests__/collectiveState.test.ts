import { describe, expect, it } from "vitest";
import { buildScenario } from "@raid/game-engine";
import type { Hypothesis, KnownFact } from "@raid/shared";
import { buildCollectiveReasoningState } from "../collectiveState.js";

const scenario = buildScenario("checkout-degradation", 1200);

function hypothesis(overrides: Partial<Hypothesis>): Hypothesis {
  return {
    id: overrides.id ?? "h1",
    gameId: "g1",
    authorId: "p1",
    authorName: "Ada",
    text: overrides.text ?? "Some hypothesis",
    status: overrides.status ?? "OPEN",
    aiRationale: null,
    supportedBy: overrides.supportedBy ?? [],
    challengedBy: overrides.challengedBy ?? [],
    evidenceIds: [],
    createdAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

function fact(overrides: Partial<KnownFact>): KnownFact {
  return {
    id: overrides.id ?? "f1",
    text: overrides.text ?? "Some fact",
    category: overrides.category ?? "fact",
    sourceEvidenceId: null,
    addedBy: "Ada",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildCollectiveReasoningState", () => {
  it("includes only unlocked evidence, never the full content", () => {
    const [firstEvidence] = scenario.evidence;
    const state = buildCollectiveReasoningState({
      scenario,
      elapsedSeconds: 60,
      unlockedEvidenceIds: new Set([firstEvidence!.id]),
      hypotheses: [],
      knownFacts: [],
      executedToolIds: new Set(),
      recentEvents: [],
    });
    expect(state.discoveredEvidence).toHaveLength(1);
    expect(state.discoveredEvidence[0]!.id).toBe(firstEvidence!.id);
    expect(state.discoveredEvidence[0]).not.toHaveProperty("content");
    // The locked evidence never appears.
    const lockedId = scenario.evidence.find((e) => e.id !== firstEvidence!.id)!.id;
    expect(state.discoveredEvidence.some((e) => e.id === lockedId)).toBe(false);
  });

  it("splits hypotheses into active / challenged / ruled-out buckets correctly", () => {
    const hypotheses = [
      hypothesis({ id: "h-open", status: "OPEN" }),
      hypothesis({ id: "h-supported", status: "SUPPORTED" }),
      hypothesis({ id: "h-contradicted", status: "CONTRADICTED", text: "wrong theory" }),
      hypothesis({ id: "h-challenged", status: "PLAUSIBLE", challengedBy: ["p2"], text: "disputed theory" }),
    ];
    const state = buildCollectiveReasoningState({
      scenario,
      elapsedSeconds: 60,
      unlockedEvidenceIds: new Set(),
      hypotheses,
      knownFacts: [],
      executedToolIds: new Set(),
      recentEvents: [],
    });
    expect(state.activeHypotheses.map((h) => h.text)).toEqual(
      expect.arrayContaining([hypotheses[0]!.text, hypotheses[1]!.text, hypotheses[3]!.text]),
    );
    expect(state.ruledOutHypotheses).toEqual([{ text: "wrong theory" }]);
    expect(state.challengedHypotheses).toEqual([{ text: "disputed theory", status: "PLAUSIBLE", challengeCount: 1 }]);
    // A contradicted hypothesis never appears as "active" even if it happened to be challenged too.
    expect(state.activeHypotheses.some((h) => h.text === "wrong theory")).toBe(false);
  });

  it("splits known facts by category into knownFacts vs openQuestions", () => {
    const state = buildCollectiveReasoningState({
      scenario,
      elapsedSeconds: 60,
      unlockedEvidenceIds: new Set(),
      hypotheses: [],
      knownFacts: [fact({ text: "Latency rose", category: "fact" }), fact({ id: "f2", text: "Why now?", category: "question" })],
      executedToolIds: new Set(),
      recentEvents: [],
    });
    expect(state.knownFacts).toEqual(["Latency rose"]);
    expect(state.openQuestions).toEqual(["Why now?"]);
  });

  it("caps every list at its bound regardless of how much input is given", () => {
    const manyHypotheses = Array.from({ length: 50 }, (_, i) => hypothesis({ id: `h${i}`, status: "OPEN", text: `hyp ${i}` }));
    const state = buildCollectiveReasoningState({
      scenario,
      elapsedSeconds: 60,
      unlockedEvidenceIds: new Set(scenario.evidence.map((e) => e.id)),
      hypotheses: manyHypotheses,
      knownFacts: Array.from({ length: 50 }, (_, i) => fact({ id: `f${i}`, text: `fact ${i}`, category: "fact" })),
      executedToolIds: new Set(scenario.tools.map((t) => t.id)),
      recentEvents: Array.from({ length: 50 }, (_, i) => ({
        atSeconds: i,
        type: "TOOL_EXECUTED" as const,
        payload: { toolId: scenario.tools[0]!.id },
      })),
    });
    expect(state.activeHypotheses.length).toBeLessThanOrEqual(10);
    expect(state.knownFacts.length).toBeLessThanOrEqual(15);
    expect(state.recentTrajectory.length).toBeLessThanOrEqual(15);
  });

  it("keeps only the most recent trajectory entries, not the earliest", () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      atSeconds: i * 10,
      type: "TOOL_EXECUTED" as const,
      payload: { toolId: scenario.tools[0]!.id },
    }));
    const state = buildCollectiveReasoningState({
      scenario,
      elapsedSeconds: 200,
      unlockedEvidenceIds: new Set(),
      hypotheses: [],
      knownFacts: [],
      executedToolIds: new Set(),
      recentEvents: events,
    });
    expect(state.recentTrajectory[0]!.atSeconds).toBe(50); // the 6th event (index 5) onward survives a cap of 15
    expect(state.recentTrajectory.at(-1)!.atSeconds).toBe(190);
  });

  it("computes subsystem coverage as the fraction of each role's tools executed", () => {
    const backendTools = scenario.tools.filter((t) => t.role === "backend_engineer");
    const state = buildCollectiveReasoningState({
      scenario,
      elapsedSeconds: 60,
      unlockedEvidenceIds: new Set(),
      hypotheses: [],
      knownFacts: [],
      executedToolIds: new Set([backendTools[0]!.id]),
      recentEvents: [],
    });
    expect(state.subsystemCoverage.backend_engineer).toBeCloseTo(1 / backendTools.length);
    expect(state.subsystemCoverage.database_engineer).toBe(0);
  });

  it("resolves tool/evidence/hypothesis ids in the trajectory to human-readable summaries", () => {
    const tool = scenario.tools[0]!;
    const state = buildCollectiveReasoningState({
      scenario,
      elapsedSeconds: 60,
      unlockedEvidenceIds: new Set(),
      hypotheses: [],
      knownFacts: [],
      executedToolIds: new Set(),
      recentEvents: [{ atSeconds: 5, type: "TOOL_EXECUTED", payload: { toolId: tool.id } }],
    });
    expect(state.recentTrajectory[0]!.summary).toContain(tool.name);
  });
});
