import { describe, expect, it } from "vitest";
import { buildScenario, DURATION_PRESETS, listScenarioIds } from "../scenarioEngine.js";

describe("difficulty affects reasoning complexity, not just the clock (V0.3.2)", () => {
  for (const scenarioId of listScenarioIds()) {
    describe(scenarioId, () => {
      const normal = buildScenario(scenarioId, DURATION_PRESETS.standard, "NORMAL");
      const hard = buildScenario(scenarioId, DURATION_PRESETS.standard, "HARD");

      it("NORMAL evidence with an authored hint includes the interpretive hint text", () => {
        const hinted = normal.evidence.find((e) => e.hint);
        expect(hinted).toBeDefined();
        expect(hinted!.content).toContain(hinted!.hint!);
      });

      it("HARD withholds the interpretive hint from the same evidence item's content", () => {
        const hintedId = normal.evidence.find((e) => e.hint)!.id;
        const hardVersion = hard.evidence.find((e) => e.id === hintedId)!;
        expect(hardVersion.content).not.toContain(hardVersion.hint!);
        // The raw underlying data is still present - HARD withholds the interpretive steer, not the facts.
        const normalVersion = normal.evidence.find((e) => e.id === hintedId)!;
        expect(hardVersion.content).toBe(normalVersion.content.split(`\n  ${normalVersion.hint}`)[0]);
      });

      it("HARD pushes time-gated evidence unlock thresholds later than NORMAL", () => {
        const timeGated = normal.evidence.filter((e) => e.unlock.atSeconds !== undefined);
        expect(timeGated.length).toBeGreaterThan(0);
        for (const e of timeGated) {
          const hardVersion = hard.evidence.find((h) => h.id === e.id)!;
          expect(hardVersion.unlock.atSeconds!).toBeGreaterThanOrEqual(e.unlock.atSeconds!);
        }
        // At least one item is meaningfully later, not just clamped to the same value.
        expect(timeGated.some((e) => {
          const hardVersion = hard.evidence.find((h) => h.id === e.id)!;
          return hardVersion.unlock.atSeconds! > e.unlock.atSeconds!;
        })).toBe(true);
      });

      it("HARD never pushes an unlock threshold past 95% of the game duration", () => {
        for (const e of hard.evidence) {
          if (e.unlock.atSeconds !== undefined) {
            expect(e.unlock.atSeconds).toBeLessThanOrEqual(Math.round(hard.durationSeconds * 0.95));
          }
        }
      });

      it("difficulty never changes the underlying root cause, remediation, or key evidence ids", () => {
        expect(hard.rootCause.summary).toBe(normal.rootCause.summary);
        expect(hard.rootCause.remediation).toBe(normal.rootCause.remediation);
        expect(hard.rootCause.keyEvidenceIds).toEqual(normal.rootCause.keyEvidenceIds);
      });

      it("both difficulties still pass every structural quality check (asserted in scenarioValidation.test.ts)", () => {
        expect(normal.difficulty).toBe("NORMAL");
        expect(hard.difficulty).toBe("HARD");
      });
    });
  }
});
