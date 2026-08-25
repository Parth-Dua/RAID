import { describe, expect, it } from "vitest";
import { buildScenario } from "@raid/game-engine";
import type { InterventionProposal } from "../schemas.js";
import { validateIntervention } from "../interventionValidator.js";

const scenario = buildScenario("checkout-degradation", 1200);

function decline(): InterventionProposal {
  return { shouldIntervene: false, kind: null, message: null, targetRole: null, confidence: 0.9 };
}

function proposal(overrides: Partial<InterventionProposal>): InterventionProposal {
  return {
    shouldIntervene: true,
    kind: "OPTIONAL_HINT",
    message: "A safe, generic nudge that does not name anything internal.",
    targetRole: null,
    confidence: 0.6,
    ...overrides,
  };
}

describe("validateIntervention", () => {
  it("always accepts a decline (shouldIntervene: false)", () => {
    expect(validateIntervention(decline(), scenario)).toEqual({ valid: true });
  });

  it("accepts a well-formed, safe proposal", () => {
    expect(validateIntervention(proposal({}), scenario).valid).toBe(true);
  });

  it("rejects shouldIntervene:true with missing kind/message", () => {
    const bad = { shouldIntervene: true, kind: null, message: null, targetRole: null, confidence: 0.5 } as InterventionProposal;
    expect(validateIntervention(bad, scenario).valid).toBe(false);
  });

  it("rejects a message that leaks the root cause (reuses the same leak guard as hypothesis rationale)", () => {
    const leaking = proposal({
      message: "This is an N+1 issue hitting loyalty_history causing connection pool exhaustion.",
    });
    const result = validateIntervention(leaking, scenario);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("leak");
  });

  it("rejects a targetRole with no tools in this scenario", () => {
    // Every current scenario defines all 4 roles' tools, so simulate an invalid role value that
    // slipped past the zod enum some other way (e.g. a future scenario missing IC tools).
    const result = validateIntervention(proposal({ targetRole: "incident_commander" }), {
      ...scenario,
      tools: scenario.tools.filter((t) => t.role !== "incident_commander"),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("targetRole");
  });

  it("rejects a message that references a real evidence id verbatim", () => {
    const evidenceId = scenario.evidence[0]!.id;
    const result = validateIntervention(proposal({ message: `Check out evidence ${evidenceId} again.` }), scenario);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("evidence id");
  });

  it("rejects a message that references a real tool id verbatim", () => {
    const toolId = scenario.tools[0]!.id;
    const result = validateIntervention(proposal({ message: `Try running ${toolId} once more.` }), scenario);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("tool id");
  });

  it("accepts a valid targetRole that does have tools in this scenario", () => {
    const result = validateIntervention(proposal({ targetRole: "backend_engineer" }), scenario);
    expect(result.valid).toBe(true);
  });
});
