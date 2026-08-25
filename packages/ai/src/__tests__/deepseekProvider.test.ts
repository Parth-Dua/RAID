import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildScenario } from "@raid/game-engine";
import { DeepSeekProvider } from "../deepseekProvider.js";
import type { CollectiveReasoningState } from "../collectiveState.js";

const scenario = buildScenario("checkout-degradation", 1200);

const state: CollectiveReasoningState = {
  elapsedSeconds: 300,
  durationSeconds: 1200,
  discoveredEvidence: scenario.evidence.slice(0, 4).map((e) => ({ id: e.id, title: e.title, category: e.category })),
  activeHypotheses: [{ text: "A plausible direction", status: "PLAUSIBLE" }],
  challengedHypotheses: [],
  ruledOutHypotheses: [],
  openQuestions: [],
  knownFacts: [],
  toolsExecuted: [],
  recentTrajectory: [{ atSeconds: 250, summary: "Ran a tool" }],
  subsystemCoverage: { backend_engineer: 0.4 },
};

function chatResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  };
}

function makeProvider(fetchImpl: typeof fetch) {
  vi.stubGlobal("fetch", fetchImpl);
  return new DeepSeekProvider({
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.test",
    model: "deepseek-v4-flash",
    timeoutMs: 2000,
    maxRetries: 2,
  });
}

describe("DeepSeekProvider malformed-output handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to MockAIProvider on invalid JSON after exhausting retries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse("not json at all"));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { result, meta } = await provider.evaluateHypothesis({
      scenario,
      hypothesisText: "connection pool deploy n+1",
      elapsedSeconds: 100,
      otherHypotheses: [],
      knownFacts: [],
    });

    expect(meta.usedFallback).toBe(true);
    expect(meta.success).toBe(false);
    expect(["SUPPORTED", "PLAUSIBLE", "WEAK", "CONTRADICTED"]).toContain(result.status);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("falls back when a required field is missing (schema validation failure)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(JSON.stringify({ status: "SUPPORTED" })));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { meta } = await provider.evaluateHypothesis({
      scenario,
      hypothesisText: "x",
      elapsedSeconds: 0,
      otherHypotheses: [],
      knownFacts: [],
    });

    expect(meta.usedFallback).toBe(true);
    expect(meta.errorMessage).toContain("schema validation");
  });

  it("falls back when the enum value is invalid", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify({ status: "TOTALLY_CORRECT", rationale: "this is fine and long enough" })));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { meta } = await provider.evaluateHypothesis({
      scenario,
      hypothesisText: "x",
      elapsedSeconds: 0,
      otherHypotheses: [],
      knownFacts: [],
    });

    expect(meta.usedFallback).toBe(true);
  });

  it("rejects and retries when the model tries to leak the root cause, then falls back", async () => {
    const leak = JSON.stringify({
      status: "SUPPORTED",
      rationale: "The root cause is an N+1 query hitting loyalty_history causing connection pool exhaustion.",
    });
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(leak));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { meta, result } = await provider.evaluateHypothesis({
      scenario,
      hypothesisText: "x",
      elapsedSeconds: 0,
      otherHypotheses: [],
      knownFacts: [],
    });

    expect(meta.usedFallback).toBe(true);
    expect(result.rationale.toLowerCase()).not.toContain("the root cause is");
  });

  it("succeeds on a well-formed response without retrying", async () => {
    const good = JSON.stringify({ status: "PLAUSIBLE", rationale: "This is a reasonable direction to keep investigating." });
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(good));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { result, meta } = await provider.evaluateHypothesis({
      scenario,
      hypothesisText: "x",
      elapsedSeconds: 0,
      otherHypotheses: [],
      knownFacts: [],
    });

    expect(meta.success).toBe(true);
    expect(meta.usedFallback).toBe(false);
    expect(result.status).toBe("PLAUSIBLE");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("recovers via repair prompt: first response bad, second response valid", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(chatResponse("garbage"))
      .mockResolvedValueOnce(chatResponse(JSON.stringify({ status: "WEAK", rationale: "Not much support for this yet in the evidence." })));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { result, meta } = await provider.evaluateHypothesis({
      scenario,
      hypothesisText: "x",
      elapsedSeconds: 0,
      otherHypotheses: [],
      knownFacts: [],
    });

    expect(meta.usedFallback).toBe(false);
    expect(result.status).toBe("WEAK");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sanitizes hallucinated evidence IDs on final-diagnosis evaluation rather than corrupting the game", async () => {
    const withHallucination = JSON.stringify({
      rootCauseAccuracy: 30,
      evidenceQuality: 15,
      remediationQuality: 15,
      rationale: "Reasonable diagnosis citing evidence.",
      matchedKeyEvidenceIds: ["be_deploy_log", "totally_made_up_evidence_id"],
    });
    const clean = JSON.stringify({
      rootCauseAccuracy: 30,
      evidenceQuality: 15,
      remediationQuality: 15,
      rationale: "Reasonable diagnosis citing real evidence only.",
      matchedKeyEvidenceIds: ["be_deploy_log"],
    });
    const fetchImpl = vi.fn().mockResolvedValueOnce(chatResponse(withHallucination)).mockResolvedValueOnce(chatResponse(clean));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { result, meta } = await provider.evaluateFinalDiagnosis({
      scenario,
      rootCause: "deploy caused N+1",
      remediation: "batch query",
      citedEvidenceTitles: [{ id: "be_deploy_log", title: "x" }],
      elapsedSeconds: 500,
    });

    expect(meta.usedFallback).toBe(false);
    expect(result.matchedKeyEvidenceIds).toEqual(["be_deploy_log"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back gracefully on a network timeout/error without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    await expect(
      provider.evaluateHypothesis({
        scenario,
        hypothesisText: "x",
        elapsedSeconds: 0,
        otherHypotheses: [],
        knownFacts: [],
      }),
    ).resolves.toMatchObject({ meta: { usedFallback: true, success: false } });
  });
});

describe("DeepSeekProvider classifyTeamState / proposeIntervention (V0.4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("succeeds on a well-formed classification response", async () => {
    const good = JSON.stringify({ classification: "ON_TRACK", confidence: 0.8, rationale: "Evidence is accumulating steadily across roles." });
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(good));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { result, meta } = await provider.classifyTeamState({ scenario, state });
    expect(meta.usedFallback).toBe(false);
    expect(result.classification).toBe("ON_TRACK");
  });

  it("falls back when the model returns an invalid classification enum value", async () => {
    const bad = JSON.stringify({ classification: "PANICKING", confidence: 0.5, rationale: "not a real classification value" });
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(bad));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { meta } = await provider.classifyTeamState({ scenario, state });
    expect(meta.usedFallback).toBe(true);
  });

  it("rejects a classification rationale that leaks the root cause, then falls back", async () => {
    const leak = JSON.stringify({
      classification: "ON_TRACK",
      confidence: 0.9,
      rationale: "This is an N+1 issue hitting loyalty_history causing connection pool exhaustion.",
    });
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(leak));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { meta } = await provider.classifyTeamState({ scenario, state });
    expect(meta.usedFallback).toBe(true);
  });

  it("succeeds on a well-formed, safe intervention proposal", async () => {
    const good = JSON.stringify({
      shouldIntervene: true,
      kind: "OPTIONAL_HINT",
      message: "One of the readings already on the board might be worth a second look.",
      targetRole: null,
      confidence: 0.6,
    });
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(good));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { result, meta } = await provider.proposeIntervention({ scenario, state, classification: "IGNORING_CRITICAL_SIGNAL" });
    expect(meta.usedFallback).toBe(false);
    expect(result.shouldIntervene).toBe(true);
  });

  it("rejects an intervention proposal that references a real evidence id verbatim, then falls back", async () => {
    const leaking = JSON.stringify({
      shouldIntervene: true,
      kind: "OPTIONAL_HINT",
      message: `Take another look at ${scenario.evidence[0]!.id}.`,
      targetRole: null,
      confidence: 0.6,
    });
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(leaking));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { meta } = await provider.proposeIntervention({ scenario, state, classification: "STALLED" });
    expect(meta.usedFallback).toBe(true);
  });

  it("rejects an intervention proposal that leaks the root cause, then falls back", async () => {
    const leaking = JSON.stringify({
      shouldIntervene: true,
      kind: "OPTIONAL_HINT",
      message: "This is an N+1 issue hitting loyalty_history causing connection pool exhaustion.",
      targetRole: null,
      confidence: 0.6,
    });
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(leaking));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { meta } = await provider.proposeIntervention({ scenario, state, classification: "STALLED" });
    expect(meta.usedFallback).toBe(true);
  });

  it("accepts a clean decline (shouldIntervene: false) without triggering the leak/id checks", async () => {
    const clean = JSON.stringify({ shouldIntervene: false, kind: null, message: null, targetRole: null, confidence: 0.9 });
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(clean));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const { result, meta } = await provider.proposeIntervention({ scenario, state, classification: "INSUFFICIENT_EVIDENCE" });
    expect(meta.usedFallback).toBe(false);
    expect(result.shouldIntervene).toBe(false);
  });
});
