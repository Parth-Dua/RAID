/**
 * One-off, budget-conscious smoke test of the REAL DeepSeek API (not mocked).
 * Not part of the automated test suite (which intentionally only runs against
 * AI_PROVIDER=mock, per docs/AI_DESIGN.md cost discipline) - this is a manual
 * verification script, run once, to confirm the actual DeepSeek integration
 * works end-to-end against the real network API before calling it "done".
 *
 * NOTE: this could not be run to a real success in the sandboxed dev environment
 * this project was built in - its outbound network proxy does not have
 * api.deepseek.com in its egress allowlist (confirmed via a 403 "Host not in
 * allowlist" error, not a code bug). The graceful-fallback path itself was
 * verified for real by this exact failure: every call below fell back to
 * MockAIProvider automatically and the script still completed successfully.
 * See docs/AI_DESIGN.md / docs/EVALUATION.md for the full writeup. Run this
 * from an environment with open egress to confirm live DeepSeek behavior.
 *
 * Usage: DEEPSEEK_API_KEY=... tsx src/scripts/deepseekSmokeTest.ts
 */
import { DeepSeekProvider } from "@raid/ai";
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

  console.log("\nDONE - all calls used provider:", h.meta.provider, h2.meta.provider, final.meta.provider);
  console.log("usedFallback (should be false for all if the real API responded validly):", h.meta.usedFallback, h2.meta.usedFallback, final.meta.usedFallback);
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
