import { describe, expect, it } from "vitest";
import { validateGeneratedScenario, materializeGeneratedScenario, evaluateScenarioQuality } from "@raid/game-engine";
import { MockAIProvider } from "../mockProvider.js";
import { GeneratedScenarioSchema } from "../schemas.js";

const provider = new MockAIProvider();

describe("MockAIProvider.generateScenario", () => {
  it("produces a candidate that passes strict schema validation", async () => {
    const { result } = await provider.generateScenario({ description: "Create an intermediate Kubernetes incident caused by a broken readiness configuration" });
    const parsed = GeneratedScenarioSchema.safeParse(result);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues, null, 2)).toBe(true);
  });

  it("produces a candidate that passes the deterministic structural validator", async () => {
    const { result } = await provider.generateScenario({ description: "A queue backlog caused by a slow consumer" });
    const validation = validateGeneratedScenario(result);
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("a materialized candidate also passes the full game-design quality checklist", async () => {
    const { result } = await provider.generateScenario({ description: "A third-party payment gateway degradation" });
    const materialized = materializeGeneratedScenario(result, 1200);
    const report = evaluateScenarioQuality({ ...materialized, difficulty: "NORMAL" });
    expect(report.checks.filter((c) => !c.passed), JSON.stringify(report.checks.filter((c) => !c.passed))).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("is deterministic: the same description produces the same candidate", async () => {
    const a = await provider.generateScenario({ description: "A broken cache invalidation strategy" });
    const b = await provider.generateScenario({ description: "A broken cache invalidation strategy" });
    expect(a.result).toEqual(b.result);
  });

  it("different descriptions produce different candidates", async () => {
    const a = await provider.generateScenario({ description: "A broken cache invalidation strategy" });
    const b = await provider.generateScenario({ description: "A misconfigured load balancer health check" });
    expect(a.result.id).not.toBe(b.result.id);
    expect(a.result.title).not.toBe(b.result.title);
  });

  it("handles a very short/generic description without crashing or producing an invalid candidate", async () => {
    const { result } = await provider.generateScenario({ description: "bug" });
    const validation = validateGeneratedScenario(result);
    expect(validation.valid, JSON.stringify(validation.errors)).toBe(true);
  });

  it("every investigative role's evidence spans key evidence, satisfying the no-single-role bar", async () => {
    const { result } = await provider.generateScenario({ description: "A DNS resolution failure inside the service mesh" });
    const roles = new Set(
      result.rootCause.keyEvidenceIds
        .map((id) => result.evidence.find((e) => e.id === id))
        .flatMap((e) => e?.visibleToRoles ?? []),
    );
    expect(roles.size).toBeGreaterThanOrEqual(3);
  });
});

describe("MockAIProvider.semanticReviewScenario", () => {
  it("always passes for a mock-generated candidate", async () => {
    const { result: candidate } = await provider.generateScenario({ description: "A stale feature flag rollout" });
    const { result } = await provider.semanticReviewScenario({ candidate });
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
