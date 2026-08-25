import { describe, expect, it } from "vitest";
import { buildScenario } from "@raid/game-engine";
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
});
