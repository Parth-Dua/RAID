import { describe, expect, it } from "vitest";
import { buildScenario, DURATION_PRESETS } from "../scenarioEngine.js";
import { evaluateScenarioQuality } from "../scenarioValidation.js";

describe("checkout-degradation scenario quality", () => {
  const scenario = buildScenario("checkout-degradation", DURATION_PRESETS.standard);
  const report = evaluateScenarioQuality(scenario);

  it("passes every structural quality check", () => {
    const failed = report.checks.filter((c) => !c.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("also passes when scaled to demo duration", () => {
    const demo = buildScenario("checkout-degradation", DURATION_PRESETS.demo);
    const demoReport = evaluateScenarioQuality(demo);
    expect(demoReport.passed).toBe(true);
  });
});
