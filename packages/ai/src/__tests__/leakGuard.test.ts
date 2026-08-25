import { describe, expect, it } from "vitest";
import { buildScenario, listScenarioIds } from "@raid/game-engine";
import { containsRootCauseLeak } from "../leakGuard.js";

const scenario = buildScenario("checkout-degradation", 1200);

describe("containsRootCauseLeak", () => {
  it("flags a direct confirmatory phrase", () => {
    expect(containsRootCauseLeak("That's correct, well done!", scenario)).toBe(true);
  });

  it("flags reciting the mechanism with multiple distinctive terms", () => {
    expect(
      containsRootCauseLeak("This is an N+1 issue hitting loyalty_history causing connection pool exhaustion.", scenario),
    ).toBe(true);
  });

  it("allows discussing a single already-known fact without leaking", () => {
    expect(
      containsRootCauseLeak(
        "You've confirmed the connection pool is under pressure, but you haven't yet explained why query volume rose.",
        scenario,
      ),
    ).toBe(false);
  });

  it("allows generic non-leaking feedback", () => {
    expect(
      containsRootCauseLeak("This is plausible but you should check what SRE's metrics show before concluding.", scenario),
    ).toBe(false);
  });

  describe.each(listScenarioIds())("every scenario has real leak protection, not just checkout-degradation's", (scenarioId) => {
    // Regression: leak detection used to be one hardcoded, checkout-degradation-specific term
    // list, so lock-contention and memory-leak had ZERO protection against a rationale reciting
    // their own mechanism verbatim. Fixed via each scenario's authored `scoringHints.distinctiveTerms`.
    const s = buildScenario(scenarioId, 1200);

    it(`flags reciting ${scenarioId}'s own distinctive terms together`, () => {
      const recital = s.scoringHints.distinctiveTerms.slice(0, 2).join(" and ");
      expect(containsRootCauseLeak(`This is caused by ${recital}, exactly as described.`, s)).toBe(true);
    });

    it(`allows a single distinctive term from ${scenarioId} mentioned alone`, () => {
      const single = s.scoringHints.distinctiveTerms[0]!;
      expect(containsRootCauseLeak(`You've confirmed ${single} is present, but not the full picture yet.`, s)).toBe(false);
    });
  });
});
