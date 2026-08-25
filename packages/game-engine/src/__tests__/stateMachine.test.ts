import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, IllegalPhaseTransitionError } from "../stateMachine.js";

describe("game phase state machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("LOBBY", "STARTING")).toBe(true);
    expect(canTransition("STARTING", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "FINALIZING")).toBe(true);
    expect(canTransition("FINALIZING", "COMPLETED")).toBe(true);
  });

  it("allows abandonment from any non-terminal phase", () => {
    expect(canTransition("LOBBY", "ABANDONED")).toBe(true);
    expect(canTransition("STARTING", "ABANDONED")).toBe(true);
    expect(canTransition("ACTIVE", "ABANDONED")).toBe(true);
    expect(canTransition("FINALIZING", "ABANDONED")).toBe(true);
  });

  it("rejects skipping phases", () => {
    expect(canTransition("LOBBY", "ACTIVE")).toBe(false);
    expect(canTransition("LOBBY", "COMPLETED")).toBe(false);
  });

  it("rejects transitions out of terminal states", () => {
    expect(canTransition("COMPLETED", "ACTIVE")).toBe(false);
    expect(canTransition("ABANDONED", "LOBBY")).toBe(false);
  });

  it("double-start (LOBBY -> STARTING -> STARTING) is rejected", () => {
    expect(canTransition("STARTING", "STARTING")).toBe(false);
  });

  it("throws IllegalPhaseTransitionError with from/to context", () => {
    expect(() => assertTransition("LOBBY", "COMPLETED")).toThrow(IllegalPhaseTransitionError);
    try {
      assertTransition("LOBBY", "COMPLETED");
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalPhaseTransitionError);
      expect((e as IllegalPhaseTransitionError).from).toBe("LOBBY");
      expect((e as IllegalPhaseTransitionError).to).toBe("COMPLETED");
    }
  });
});
