/**
 * One-off, budget-conscious smoke test of the REAL DeepSeek API (not mocked).
 * Not part of the automated test suite (which intentionally only runs against
 * AI_PROVIDER=mock, per docs/AI_DESIGN.md cost discipline) - this is a manual
 * verification script, run once, to confirm the actual DeepSeek integration
 * works end-to-end against the real network API before calling it "done".
 * Calls 4-5 (V0.4) cover classifyTeamState/proposeIntervention - the "VERY SMALL number of live
 * requests" V0.4.6 calls for: just enough to check schema compliance and the qualitative
 * sanity of one classification and one intervention proposal against the real model.
 * Calls 6-7 (V0.5) cover generateScenario/semanticReviewScenario - V0.5.6's "only a few live
 * generation calls" requirement: one real generation (exercising the schema + the deterministic
 * repair loop if the first attempt needs it) and one real review of that same candidate.
 *
 * NOTE: this could not be run to a real success in the sandboxed dev environment
 * this project was built in - its outbound network proxy does not have
 * api.deepseek.com in its egress allowlist (confirmed via a 403 "Host not in
 * allowlist" error, not a code bug). Re-confirmed unchanged during V0.4 and V0.5
 * (every new call added in each phase hit the identical 403, including with a
 * real, valid-looking DEEPSEEK_API_KEY present - the proxy rejects the CONNECT
 * tunnel to api.deepseek.com before the request ever reaches DeepSeek's servers
 * or the key is checked). The graceful-fallback path itself was verified for
 * real by this exact failure: every call below fell back to MockAIProvider
 * automatically and the script still completed successfully, at $0.00 spend (a
 * network-layer 403 is never billed - the request never reached the model). See
 * docs/AI_DESIGN.md / docs/EVALUATION.md / docs/MILESTONES.md for the full
 * writeup. Run this from an environment with open egress to confirm live
 * DeepSeek response quality.
 *
 * Usage: DEEPSEEK_API_KEY=... tsx src/scripts/deepseekSmokeTest.ts
 */
import { DeepSeekProvider, buildCollectiveReasoningState } from "@raid/ai";
import { buildScenario, DURATION_PRESETS } from "@raid/game-engine";

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  const provider = new DeepSeekProvider({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    timeoutMs: 15000,
    maxRetries: 2,
    onInvocation: (meta) => console.log("[invocation]", JSON.stringify(meta)),
  });

  const scenario = buildScenario("checkout-degradation", DURATION_PRESETS.standard);

  console.log("\n--- Real call 1: evaluateHypothesis (a plausible-but-incomplete hypothesis) ---");
  const h = await provider.evaluateHypothesis({
    scenario,
    hypothesisText: "I think the recent deploy is somehow involved in the checkout slowdown.",
    elapsedSeconds: 300,
    otherHypotheses: [],
    knownFacts: ["Checkout latency rose from ~200ms to several seconds", "A deploy happened shortly before symptoms began"],
  });
  console.log("status:", h.result.status);
  console.log("rationale:", h.result.rationale);
  console.log("meta:", JSON.stringify(h.meta));

  console.log("\n--- Real call 2: evaluateHypothesis (a red herring) ---");
  const h2 = await provider.evaluateHypothesis({
    scenario,
    hypothesisText: "This looks like a sudden traffic spike overwhelmed the checkout service.",
    elapsedSeconds: 300,
    otherHypotheses: [h.result.status],
    knownFacts: ["Request rate is at normal 24h baseline, no spike observed"],
  });
  console.log("status:", h2.result.status);
  console.log("rationale:", h2.result.rationale);
  console.log("meta:", JSON.stringify(h2.meta));

  console.log("\n--- Real call 3: evaluateFinalDiagnosis (a strong, correct submission) ---");
  const final = await provider.evaluateFinalDiagnosis({
    scenario,
    rootCause:
      "The v2.14.0 deploy added a per-cart-item loyalty lookup, issuing one query per item instead of one batched " +
      "query. This N+1 pattern increased query volume ~8x, saturating the fixed 20-connection DB pool. Requests " +
      "then queued for a connection, and once the wait exceeded the acquire timeout, they failed with a 5xx.",
    remediation: "Batch the loyalty_history lookup into a single query per cart, and roll back the deploy as an immediate mitigation.",
    citedEvidenceTitles: [
      { id: "be_deploy_log", title: "Deployment: checkout-service v2.14.0" },
      { id: "db_pool_saturation", title: "Connection pool utilization climbing to 100%" },
    ],
    elapsedSeconds: 900,
  });
  console.log("scores:", JSON.stringify({ rootCauseAccuracy: final.result.rootCauseAccuracy, evidenceQuality: final.result.evidenceQuality, remediationQuality: final.result.remediationQuality }));
  console.log("rationale:", final.result.rationale);
  console.log("meta:", JSON.stringify(final.meta));

  console.log("\n--- Real call 4 (V0.4): classifyTeamState on a mid-investigation state ---");
  const state = buildCollectiveReasoningState({
    scenario,
    elapsedSeconds: 400,
    unlockedEvidenceIds: new Set(["be_deploy_log", "be_trace_n1", "db_pool_saturation"]),
    hypotheses: [],
    knownFacts: [],
    executedToolIds: new Set(["deployments", "distributed_traces", "active_connections"]),
    recentEvents: [
      { atSeconds: 60, type: "TOOL_EXECUTED", payload: { toolId: "deployments" } },
      { atSeconds: 120, type: "TOOL_EXECUTED", payload: { toolId: "distributed_traces" } },
      { atSeconds: 300, type: "TOOL_EXECUTED", payload: { toolId: "active_connections" } },
    ],
  });
  const classification = await provider.classifyTeamState({ scenario, state });
  console.log("classification:", classification.result.classification, "confidence:", classification.result.confidence);
  console.log("rationale:", classification.result.rationale);
  console.log("meta:", JSON.stringify(classification.meta));

  console.log("\n--- Real call 5 (V0.4): proposeIntervention for a STALLED-eligible state ---");
  const intervention = await provider.proposeIntervention({ scenario, state, classification: "STALLED" });
  console.log("shouldIntervene:", intervention.result.shouldIntervene);
  console.log("kind:", intervention.result.kind, "message:", intervention.result.message, "targetRole:", intervention.result.targetRole);
  console.log("meta:", JSON.stringify(intervention.meta));

  console.log("\n--- Real call 6 (V0.5): generateScenario from a free-text request ---");
  const generated = await provider.generateScenario({
    description: "Create an intermediate Kubernetes incident caused by a broken readiness configuration",
    difficulty: "NORMAL",
  });
  console.log("title:", generated.result.title, "| tools:", generated.result.tools.length, "| evidence:", generated.result.evidence.length);
  console.log("meta:", JSON.stringify(generated.meta));

  console.log("\n--- Real call 7 (V0.5): semanticReviewScenario on that same candidate ---");
  const review = await provider.semanticReviewScenario({ candidate: generated.result });
  console.log("passed:", review.result.passed, "| issues:", JSON.stringify(review.result.issues));
  console.log("meta:", JSON.stringify(review.meta));

  console.log(
    "\nDONE - all calls used provider:",
    h.meta.provider,
    h2.meta.provider,
    final.meta.provider,
    classification.meta.provider,
    intervention.meta.provider,
    generated.meta.provider,
    review.meta.provider,
  );
  console.log(
    "usedFallback (should be false for all if the real API responded validly):",
    h.meta.usedFallback,
    h2.meta.usedFallback,
    final.meta.usedFallback,
    classification.meta.usedFallback,
    intervention.meta.usedFallback,
    generated.meta.usedFallback,
    review.meta.usedFallback,
  );
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
