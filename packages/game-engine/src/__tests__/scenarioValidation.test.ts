import { describe, expect, it } from "vitest";
import type { Difficulty } from "@raid/shared";
import { buildScenario, DURATION_PRESETS, listScenarioIds } from "../scenarioEngine.js";
import { evaluateScenarioQuality } from "../scenarioValidation.js";

const DIFFICULTIES: Difficulty[] = ["NORMAL", "HARD"];

describe.each(listScenarioIds())("%s scenario quality", (scenarioId) => {
  it.each(DIFFICULTIES)("passes every structural quality check at %s difficulty (standard duration)", (difficulty) => {
    const scenario = buildScenario(scenarioId, DURATION_PRESETS.standard, difficulty);
    const report = evaluateScenarioQuality(scenario);
    const failed = report.checks.filter((c) => !c.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("also passes when scaled to demo duration", () => {
    const demo = buildScenario(scenarioId, DURATION_PRESETS.demo);
    const demoReport = evaluateScenarioQuality(demo);
    expect(demoReport.passed).toBe(true);
  });

  it("also passes when scaled to instant (bot-simulation) duration", () => {
    const instant = buildScenario(scenarioId, DURATION_PRESETS.instant);
    const instantReport = evaluateScenarioQuality(instant);
    expect(instantReport.passed).toBe(true);
  });
});
