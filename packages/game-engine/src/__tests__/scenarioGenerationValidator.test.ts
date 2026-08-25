import { describe, expect, it } from "vitest";
import type { GeneratedScenarioDefinition } from "@raid/shared";
import { validateGeneratedScenario } from "../scenarioGenerationValidator.js";
import { materializeGeneratedScenario } from "../fractionalScenario.js";
import { evaluateScenarioQuality } from "../scenarioValidation.js";

function validCandidate(): GeneratedScenarioDefinition {
  return {
    id: "test-generated-scenario",
    title: "Broken Readiness Probe Cascade",
    severity: "SEV-2",
    briefing: "A rolling deploy introduced a readiness probe that never passes, taking capacity offline gradually.",
    tools: [
      { id: "be_logs", role: "backend_engineer", name: "App Logs", description: "d", resultSummary: "s", baselineOutput: "nominal" },
      { id: "be_traces", role: "backend_engineer", name: "Traces", description: "d", resultSummary: "s" },
      { id: "db_conns", role: "database_engineer", name: "Connections", description: "d", resultSummary: "s" },
      { id: "db_latency", role: "database_engineer", name: "Latency", description: "d", resultSummary: "s" },
      { id: "sre_pods", role: "sre", name: "Pod Health", description: "d", resultSummary: "s" },
      { id: "sre_cpu", role: "sre", name: "CPU/Mem", description: "d", resultSummary: "s" },
      { id: "ic_board", role: "incident_commander", name: "Status Board", description: "d", resultSummary: "s" },
    ],
    evidence: [
      {
        id: "ev_deploy",
        visibleToRoles: ["backend_engineer"],
        title: "Deploy note",
        category: "deployment",
        content: "v9.0.0 changed the readiness probe path from /health to /healthz without updating the k8s manifest.",
        unlock: { toolId: "be_logs" },
        isRedHerring: false,
        isKeyEvidence: true,
      },
      {
        id: "ev_trace",
        visibleToRoles: ["backend_engineer"],
        title: "Trace showing 404 on probe",
        category: "trace",
        content: "GET /healthz -> 404, readiness probe failing repeatedly.",
        unlock: { toolId: "be_traces", atFraction: 0.1 },
        isRedHerring: false,
        isKeyEvidence: true,
      },
      {
        id: "ev_payment_ok",
        visibleToRoles: ["backend_engineer"],
        title: "Payment provider healthy",
        category: "metric",
        content: "Payment provider latency/error rate both nominal.",
        unlock: { toolId: "be_traces" },
        isRedHerring: true,
        isKeyEvidence: false,
      },
      {
        id: "ev_db_ok",
        visibleToRoles: ["database_engineer"],
        title: "Connections normal",
        category: "metric",
        content: "Connection pool at 20% utilization, nothing unusual.",
        unlock: { toolId: "db_conns" },
        isRedHerring: false,
        isKeyEvidence: true,
      },
      {
        id: "ev_db_latency_ok",
        visibleToRoles: ["database_engineer"],
        title: "Latency normal",
        category: "metric",
        content: "p99 query latency 8ms, normal baseline.",
        unlock: { toolId: "db_latency" },
        isRedHerring: true,
        isKeyEvidence: false,
      },
      {
        id: "ev_db_replication_ok",
        visibleToRoles: ["database_engineer"],
        title: "Replication lag normal",
        category: "metric",
        content: "Replica lag under 1s across both replicas.",
        unlock: { toolId: "db_conns" },
        isRedHerring: false,
        isKeyEvidence: false,
      },
      {
        id: "ev_pods_not_ready",
        visibleToRoles: ["sre"],
        title: "Pods stuck NotReady",
        category: "metric",
        content: "3/6 pods stuck in NotReady state since the deploy, never joining the load balancer pool.",
        unlock: { toolId: "sre_pods", atFraction: 0.1 },
        isRedHerring: false,
        isKeyEvidence: true,
      },
      {
        id: "ev_cpu_flat",
        visibleToRoles: ["sre"],
        title: "CPU/mem flat",
        category: "metric",
        content: "CPU and memory both nominal across all pods.",
        unlock: { toolId: "sre_cpu" },
        isRedHerring: true,
        isKeyEvidence: false,
      },
      {
        id: "ev_network_ok",
        visibleToRoles: ["sre"],
        title: "Network healthy",
        category: "metric",
        content: "Inter-pod network latency and packet loss both nominal.",
        unlock: { toolId: "sre_pods" },
        isRedHerring: false,
        isKeyEvidence: false,
      },
      {
        id: "ev_ic_status",
        visibleToRoles: ["incident_commander"],
        title: "Status board",
        category: "metric",
        content: "checkout-service: DEGRADED (reduced capacity)",
        unlock: { toolId: "ic_board" },
        isRedHerring: false,
        isKeyEvidence: false,
      },
    ],
    timeline: [
      { atFraction: 0, headline: "Capacity begins draining" },
      { atFraction: 0.3, headline: "Half of pods unavailable" },
    ],
    rootCause: {
      summary:
        "The v9.0.0 deploy changed the app's health endpoint path but the Kubernetes manifest's readiness probe " +
        "still points at the old path, so new pods never pass readiness and never receive traffic.",
      causalChain: [
        "v9.0.0 renames the health endpoint from /health to /healthz",
        "The k8s deployment manifest's readinessProbe path was not updated to match",
        "Every new pod's readiness probe requests the old /health path and gets a 404",
        "Pods never transition to Ready and are never added to the service's load balancer pool",
        "Available capacity shrinks with every rolling-update pod replacement",
      ],
      remediation: "Update the readiness probe path to /healthz and roll the deployment again.",
      keyEvidenceIds: ["ev_deploy", "ev_trace", "ev_db_ok", "ev_pods_not_ready"],
    },
    plausibleWrongHypotheses: ["A database slowdown is the cause (ruled out: connections/latency both normal)."],
    rubricWeights: { rootCauseAccuracy: 40, evidenceQuality: 20, remediationQuality: 20, efficiency: 10, collaboration: 10 },
    scoringHints: {
      causalTerms: ["readiness", "probe", "healthz", "manifest"],
      redHerringTerms: ["database", "slow quer", "cpu"],
      remediationTerms: ["readiness probe", "manifest", "rollback"],
      distinctiveTerms: ["readiness probe", "healthz path"],
    },
  };
}

describe("validateGeneratedScenario", () => {
  it("accepts a well-formed candidate", () => {
    const result = validateGeneratedScenario(validCandidate());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a tool with an invalid role", () => {
    const c = validCandidate();
    c.tools[0]!.role = "network_engineer" as never;
    const result = validateGeneratedScenario(c);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid role"))).toBe(true);
  });

  it("rejects duplicate tool ids", () => {
    const c = validCandidate();
    c.tools.push({ ...c.tools[0]! });
    const result = validateGeneratedScenario(c);
    expect(result.errors.some((e) => e.includes("duplicate tool id"))).toBe(true);
  });

  it("rejects duplicate evidence ids", () => {
    const c = validCandidate();
    c.evidence.push({ ...c.evidence[0]! });
    const result = validateGeneratedScenario(c);
    expect(result.errors.some((e) => e.includes("duplicate evidence id"))).toBe(true);
  });

  it("rejects an evidence unlock referencing an unknown tool id", () => {
    const c = validCandidate();
    c.evidence[0]!.unlock = { toolId: "not_a_real_tool" };
    const result = validateGeneratedScenario(c);
    expect(result.errors.some((e) => e.includes("unknown tool id"))).toBe(true);
  });

  it("rejects rootCause.keyEvidenceIds referencing an unknown evidence id", () => {
    const c = validCandidate();
    c.rootCause.keyEvidenceIds = ["not_a_real_evidence_id"];
    const result = validateGeneratedScenario(c);
    expect(result.errors.some((e) => e.includes("unknown evidence id"))).toBe(true);
  });

  it("rejects an out-of-range unlock fraction", () => {
    const c = validCandidate();
    c.evidence[0]!.unlock = { atFraction: 1.5 };
    const result = validateGeneratedScenario(c);
    expect(result.errors.some((e) => e.includes("outside [0,1]"))).toBe(true);
  });

  it("rejects a non-monotonic timeline", () => {
    const c = validCandidate();
    c.timeline = [
      { atFraction: 0.5, headline: "later" },
      { atFraction: 0.1, headline: "earlier" },
    ];
    const result = validateGeneratedScenario(c);
    expect(result.errors.some((e) => e.includes("not monotonically ordered"))).toBe(true);
  });

  it("rejects a causal chain shorter than 4 steps", () => {
    const c = validCandidate();
    c.rootCause.causalChain = ["one", "two"];
    const result = validateGeneratedScenario(c);
    expect(result.errors.some((e) => e.includes("causalChain"))).toBe(true);
  });

  it("rejects rubric weights that don't sum to 100", () => {
    const c = validCandidate();
    c.rubricWeights.rootCauseAccuracy = 30;
    const result = validateGeneratedScenario(c);
    expect(result.errors.some((e) => e.includes("sum to"))).toBe(true);
  });

  it("rejects a scenario where an investigative role has zero tools", () => {
    const c = validCandidate();
    c.tools = c.tools.filter((t) => t.role !== "sre");
    const result = validateGeneratedScenario(c);
    expect(result.errors.some((e) => e.includes('"sre" has zero tools'))).toBe(true);
  });

  it("a valid candidate, once materialized, also passes the full scenario-quality checklist", () => {
    const materialized = materializeGeneratedScenario(validCandidate(), 1200);
    const report = evaluateScenarioQuality({ ...materialized, difficulty: "NORMAL" });
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
