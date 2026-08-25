import { describe, expect, it } from "vitest";
import { buildScenario, computeToolResult, getUnlockedEvidence, visibleEvidenceForRole } from "../scenarioEngine.js";

describe("scenarioEngine unlock logic", () => {
  const scenario = buildScenario("checkout-degradation", 1200);

  it("unlocks nothing at t=0 with no tools executed", () => {
    const unlocked = getUnlockedEvidence(scenario, new Set(), 0);
    // evidence with no toolId and no atSeconds condition would unlock immediately -
    // in this scenario every item requires at least a tool call.
    expect(unlocked.length).toBe(0);
  });

  it("unlocks time-independent evidence once its tool is executed", () => {
    const unlocked = getUnlockedEvidence(scenario, new Set(["deployments"]), 0);
    expect(unlocked.some((e) => e.id === "be_deploy_log")).toBe(true);
  });

  it("keeps time-gated evidence locked until the time threshold, even with the tool executed", () => {
    const early = getUnlockedEvidence(scenario, new Set(["distributed_traces"]), 1);
    expect(early.some((e) => e.id === "be_trace_n1")).toBe(false);
    const late = getUnlockedEvidence(scenario, new Set(["distributed_traces"]), 1200 * 0.12 + 1);
    expect(late.some((e) => e.id === "be_trace_n1")).toBe(true);
  });

  it("a tool call before its time-gated evidence unlocks returns baseline output, not the evidence", () => {
    const result = computeToolResult(scenario, "distributed_traces", new Set(["distributed_traces"]), 0);
    expect(result.unlockedEvidenceIds).toEqual([]);
    expect(result.output).toContain("nominal");
  });

  it("a tool call after the time threshold returns the evidence content", () => {
    const t = Math.ceil(1200 * 0.12) + 1;
    const result = computeToolResult(scenario, "distributed_traces", new Set(["distributed_traces"]), t);
    expect(result.unlockedEvidenceIds).toContain("be_trace_n1");
    expect(result.output).toContain("loyalty_history");
  });

  it("role visibility strictly partitions evidence — backend cannot see DB-only evidence", () => {
    const dbOnly = scenario.evidence.filter(
      (e) => e.visibleToRoles.includes("database_engineer") && !e.visibleToRoles.includes("backend_engineer"),
    );
    expect(dbOnly.length).toBeGreaterThan(0);
    const backendVisible = visibleEvidenceForRole(scenario.evidence, "backend_engineer");
    for (const e of dbOnly) {
      expect(backendVisible.find((x) => x.id === e.id)).toBeUndefined();
    }
  });

  it("throws on unknown tool id", () => {
    expect(() => computeToolResult(scenario, "not_a_real_tool", new Set(), 0)).toThrow();
  });
});
