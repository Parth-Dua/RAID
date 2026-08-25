import type { EvidenceDefinition, ScenarioDefinition, TimelineStep, ToolDefinition } from "@raid/shared";

/**
 * "Checkout Degradation" — the MVP's single, polished scenario.
 *
 * TRUE ROOT CAUSE (never sent verbatim to clients until debrief):
 * A deploy (checkout-service v2.14.0) adds a per-cart-item loyalty-discount
 * lookup. Instead of batching one query per cart, it issues one query PER
 * ITEM (classic N+1). Query volume against the `loyalty_history` table jumps
 * ~8x. The DB connection pool (fixed at 20 connections) saturates. Requests
 * queue waiting for a free connection; once the wait exceeds the client
 * timeout, requests fail with 5xx. CPU/memory stay flat because the
 * bottleneck is I/O wait on pool checkout, not compute — which is exactly
 * why "CPU doesn't obviously spike" despite severe user-facing degradation.
 *
 * Authoring uses fractional timeline positions (0..1 of total duration) so
 * the same causal chain can be scaled to a 20-minute "standard" game or a
 * 5-minute "demo" game without maintaining two parallel scripts.
 */

interface FractionalEvidence extends Omit<EvidenceDefinition, "unlock"> {
  unlock: { toolId?: string; atFraction?: number };
}

interface FractionalTimelineStep extends Omit<TimelineStep, "atSeconds"> {
  atFraction: number;
}

const TOOLS: ToolDefinition[] = [
  // Backend Engineer
  {
    id: "app_logs",
    role: "backend_engineer",
    name: "Application Logs",
    description: "Tail recent application-level logs for the checkout service.",
    resultSummary: "Recent ERROR/WARN log lines for checkout-service.",
    baselineOutput: "No ERROR/WARN lines in the last few minutes. Log volume nominal.",
  },
  {
    id: "distributed_traces",
    role: "backend_engineer",
    name: "Distributed Traces",
    description: "Inspect a sampled trace for a slow POST /checkout request.",
    resultSummary: "Waterfall of spans for one representative checkout request.",
    baselineOutput: "TRACE sample: POST /checkout total=214ms. All spans nominal, no anomalies yet.",
  },
  {
    id: "deployments",
    role: "backend_engineer",
    name: "Deployment History",
    description: "List recent deployments for checkout-service.",
    resultSummary: "Deployment log with version, time, and change summary.",
  },
  {
    id: "endpoint_stats",
    role: "backend_engineer",
    name: "Endpoint Stats",
    description: "Per-endpoint latency and error-rate breakdown.",
    resultSummary: "p50/p95/p99 latency and 5xx rate per endpoint.",
  },
  {
    id: "payment_dependency",
    role: "backend_engineer",
    name: "Payment Provider Health",
    description: "Check latency/error rate of the external payment dependency.",
    resultSummary: "Outbound call stats to the payment provider.",
  },
  // Database Engineer
  {
    id: "active_connections",
    role: "database_engineer",
    name: "Connection Pool Monitor",
    description: "View current connection pool utilization.",
    resultSummary: "Pool size, in-use connections, and queued waiters.",
  },
  {
    id: "query_stats",
    role: "database_engineer",
    name: "Query Volume Stats",
    description: "Top queries by call volume over the last few minutes.",
    resultSummary: "Query fingerprints ranked by calls/min and mean latency.",
    baselineOutput:
      "Top queries by calls/min: loyalty_history ~480/min, cart_items ~410/min, users ~395/min. All within baseline.",
  },
  {
    id: "slow_query_log",
    role: "database_engineer",
    name: "Slow Query Log",
    description: "Queries exceeding the slow-query threshold.",
    resultSummary: "Individually slow queries, if any.",
  },
  {
    id: "lock_monitor",
    role: "database_engineer",
    name: "Lock Monitor",
    description: "Check for blocking locks or long-held transactions.",
    resultSummary: "Current lock waits and blocking chains, if any.",
  },
  {
    id: "replication_status",
    role: "database_engineer",
    name: "Replication Status",
    description: "Primary/replica lag for the checkout database.",
    resultSummary: "Replication lag in seconds per replica.",
  },
  // SRE / Infra
  {
    id: "cpu_memory",
    role: "sre",
    name: "CPU / Memory Panel",
    description: "Container-level CPU and memory utilization for checkout-service pods.",
    resultSummary: "CPU% and memory% across pods over time.",
    baselineOutput: "CPU=21% MEM=40% across 6 pods. Nominal.",
  },
  {
    id: "pod_health",
    role: "sre",
    name: "Pod Health",
    description: "Pod restart counts and readiness status.",
    resultSummary: "Per-pod restarts, OOMKills, readiness state.",
  },
  {
    id: "request_rate",
    role: "sre",
    name: "Request Rate",
    description: "Inbound request rate to checkout-service.",
    resultSummary: "Requests/min over time, compared to the prior 24h baseline.",
  },
  {
    id: "network_health",
    role: "sre",
    name: "Network Health",
    description: "Latency and packet loss between checkout-service and its DB.",
    resultSummary: "Network RTT and loss% on the service-to-DB path.",
  },
  {
    id: "infra_events",
    role: "sre",
    name: "Infra Events Feed",
    description: "Cluster-level events: deploys, scaling actions, node events.",
    resultSummary: "Chronological infra event feed.",
  },
  // Incident Commander
  {
    id: "service_status_board",
    role: "incident_commander",
    name: "Service Status Board",
    description: "A coarse, cross-team health rollup: which services are degraded right now.",
    resultSummary: "NOMINAL / DEGRADED per service. Says what's unhealthy, not why.",
    baselineOutput: "checkout-service: NOMINAL  |  checkout_db: NOMINAL  |  infra: NOMINAL",
  },
  {
    id: "customer_impact_feed",
    role: "incident_commander",
    name: "Customer Impact Feed",
    description: "Support ticket volume and customer-reported checkout failures.",
    resultSummary: "Ticket volume trend for checkout-related complaints.",
    baselineOutput: "Checkout-related tickets: 2 in the last 15 min (baseline). No notable spike yet.",
  },
];

const EVIDENCE: FractionalEvidence[] = [
  // ---- Backend Engineer ----
  {
    id: "be_deploy_log",
    visibleToRoles: ["backend_engineer"],
    title: "Deployment: checkout-service v2.14.0",
    category: "deployment",
    content:
      "2026-08-25T14:02:11Z  DEPLOY  checkout-service v2.14.0 (prev v2.13.4)\n" +
      "  Author: t.osei  Ticket: CHK-1188 \"Show per-item loyalty discount at checkout\"\n" +
      "  Diff summary: checkout handler now calls loyaltyClient.getHistory(userId, itemId)\n" +
      "  once per cart line item to compute a personalized discount badge.\n" +
      "  Previously this data was not fetched during checkout at all.",
    unlock: { toolId: "deployments" },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "be_trace_n1",
    visibleToRoles: ["backend_engineer"],
    title: "Trace: POST /checkout (4.1s, 6 DB spans of same shape)",
    category: "trace",
    content:
      "TRACE 8f2a1c  POST /checkout  total=4102ms\n" +
      "  auth.verify                 12ms\n" +
      "  cart.load                   18ms\n" +
      "  db.query SELECT loyalty_history WHERE user_id=? AND item_id=?   612ms (pool wait 590ms)\n" +
      "  db.query SELECT loyalty_history WHERE user_id=? AND item_id=?   598ms (pool wait 580ms)\n" +
      "  db.query SELECT loyalty_history WHERE user_id=? AND item_id=?   641ms (pool wait 615ms)\n" +
      "  db.query SELECT loyalty_history WHERE user_id=? AND item_id=?   605ms (pool wait 579ms)\n" +
      "  db.query SELECT loyalty_history WHERE user_id=? AND item_id=?   622ms (pool wait 601ms)\n" +
      "  db.query SELECT loyalty_history WHERE user_id=? AND item_id=?   588ms (pool wait 561ms)\n" +
      "  payment.charge               41ms\n" +
      "  order.create                 14ms",
    hint:
      "6 near-identical loyalty_history spans, one per cart line item (cart had 6 items). Almost all " +
      "span time is 'pool wait', not query execution.",
    unlock: { toolId: "distributed_traces", atFraction: 0.12 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "be_error_logs",
    visibleToRoles: ["backend_engineer"],
    title: "Application error logs",
    category: "log",
    content:
      "14:08:03 WARN  checkout-service  pool wait exceeded 500ms for 1 connection acquisition\n" +
      "14:11:47 ERROR checkout-service  PoolTimeoutError: timed out acquiring connection after 5000ms (pool=20/20 in use)\n" +
      "14:11:52 ERROR checkout-service  PoolTimeoutError: timed out acquiring connection after 5000ms (pool=20/20 in use)\n" +
      "14:13:20 ERROR checkout-service  PoolTimeoutError: timed out acquiring connection after 5000ms (pool=20/20 in use)\n" +
      "  (repeats, growing in frequency)",
    unlock: { toolId: "app_logs", atFraction: 0.2 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "be_endpoint_stats",
    visibleToRoles: ["backend_engineer"],
    title: "Endpoint latency/error breakdown",
    category: "metric",
    content:
      "POST /checkout      p50=2.1s p95=4.3s p99=6.8s  5xx-rate=9.4%   (baseline p50=210ms, 5xx-rate=0.1%)\n" +
      "GET  /catalog       p50=48ms p95=110ms p99=180ms 5xx-rate=0.05%  (unchanged from baseline)\n" +
      "GET  /cart          p50=61ms p95=140ms p99=210ms 5xx-rate=0.06%  (unchanged from baseline)\n" +
      "POST /login         p50=90ms p95=160ms p99=240ms 5xx-rate=0.03%  (unchanged from baseline)",
    hint: "Only checkout is degraded; every other endpoint is within normal range.",
    unlock: { toolId: "endpoint_stats" },
    isRedHerring: false,
    isKeyEvidence: false,
  },
  {
    id: "be_payment_ok",
    visibleToRoles: ["backend_engineer"],
    title: "Payment provider health (red herring check)",
    category: "metric",
    content:
      "Outbound calls to payment-provider: p95=180ms, error-rate=0.02%, no timeouts.\n" +
      "Payment provider status page: all systems operational.",
    hint: "The external payment dependency is not implicated.",
    unlock: { toolId: "payment_dependency" },
    isRedHerring: true,
    isKeyEvidence: false,
  },

  // ---- Database Engineer ----
  {
    id: "db_pool_saturation",
    visibleToRoles: ["database_engineer"],
    title: "Connection pool utilization climbing to 100%",
    category: "metric",
    content:
      "checkout_db pool (max=20):\n" +
      "  14:00  in-use=7   queued=0\n" +
      "  14:04  in-use=12  queued=0\n" +
      "  14:07  in-use=19  queued=3\n" +
      "  14:10  in-use=20  queued=14\n" +
      "  14:13  in-use=20  queued=27",
    hint: "Pool has been fully saturated (20/20) with a growing wait queue since ~14:10.",
    unlock: { toolId: "active_connections", atFraction: 0.15 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "db_query_volume_spike",
    visibleToRoles: ["database_engineer"],
    title: "loyalty_history query volume up ~8x",
    category: "metric",
    content:
      "Top queries by calls/min (last 10 min window):\n" +
      "  SELECT * FROM loyalty_history WHERE user_id=$1 AND item_id=$2   3,820 calls/min  mean=8ms\n" +
      "  SELECT * FROM cart_items WHERE cart_id=$1                        410 calls/min  mean=3ms\n" +
      "  SELECT * FROM users WHERE id=$1                                  395 calls/min  mean=2ms\n" +
      "  Prior 24h baseline for loyalty_history: ~480 calls/min.",
    hint: "Each individual loyalty_history query is fast (8ms) — this is a volume problem, not a slow-query problem.",
    unlock: { toolId: "query_stats", atFraction: 0.18 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "db_no_slow_queries",
    visibleToRoles: ["database_engineer"],
    title: "Slow query log: empty",
    category: "metric",
    content:
      "No queries exceeding the 200ms slow-query threshold in the last 15 minutes.",
    hint: "Every individual query is fast; the problem is not query execution time.",
    unlock: { toolId: "slow_query_log" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "db_no_locks",
    visibleToRoles: ["database_engineer"],
    title: "Lock monitor: no blocking chains",
    category: "metric",
    content: "No blocking locks or long-held transactions detected. Lock wait time is negligible (<1ms p99).",
    unlock: { toolId: "lock_monitor" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "db_replication_ok",
    visibleToRoles: ["database_engineer"],
    title: "Replication lag: normal",
    category: "metric",
    content: "Replica-1 lag: 0.4s. Replica-2 lag: 0.6s. Both within normal range (<2s).",
    unlock: { toolId: "replication_status" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "db_pool_config",
    visibleToRoles: ["database_engineer"],
    title: "Pool configuration",
    category: "incident_fact",
    content:
      "checkout_db connection pool: max_connections=20, idle_timeout=30s, acquire_timeout=5000ms.\n" +
      "  This limit has not changed in the last 90 days.",
    unlock: { toolId: "active_connections" },
    isRedHerring: false,
    isKeyEvidence: false,
  },

  // ---- SRE / Infra ----
  {
    id: "sre_cpu_mem_flat",
    visibleToRoles: ["sre"],
    title: "CPU/memory flat throughout",
    category: "metric",
    content:
      "checkout-service pods (avg of 6):\n" +
      "  14:00  CPU=22%  MEM=41%\n" +
      "  14:05  CPU=24%  MEM=42%\n" +
      "  14:10  CPU=26%  MEM=43%\n" +
      "  14:13  CPU=25%  MEM=43%",
    hint: "No CPU or memory pressure at any point. Pods are mostly idle, waiting on I/O.",
    unlock: { toolId: "cpu_memory", atFraction: 0.1 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "sre_request_rate_normal",
    visibleToRoles: ["sre"],
    title: "Request rate: no traffic spike",
    category: "metric",
    content:
      "checkout-service inbound rate: 148 req/min at 14:00, 152 req/min at 14:13.\n" +
      "  24h baseline for this time of day: 140-160 req/min.",
    hint: "This is a completely normal traffic level.",
    unlock: { toolId: "request_rate" },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "sre_pods_healthy",
    visibleToRoles: ["sre"],
    title: "Pod health: no restarts",
    category: "metric",
    content: "0 restarts, 0 OOMKills across all 6 checkout-service pods in the last hour. All pods Ready.",
    unlock: { toolId: "pod_health" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "sre_network_ok",
    visibleToRoles: ["sre"],
    title: "Network health: normal",
    category: "metric",
    content: "checkout-service -> checkout_db: RTT p99=1.2ms, 0.0% packet loss. No network anomalies.",
    unlock: { toolId: "network_health" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "sre_deploy_marker",
    visibleToRoles: ["sre"],
    title: "Infra event: deploy at 14:02",
    category: "deployment",
    content:
      "14:02:14  DEPLOY checkout-service v2.14.0 rolled out (6/6 pods updated by 14:02:40)\n" +
      "14:02:40  Autoscaler: no scaling action taken (CPU target not breached)",
    hint: "A deploy happened right before symptoms began, but infra-level metrics alone don't show what changed in the code.",
    unlock: { toolId: "infra_events" },
    isRedHerring: false,
    isKeyEvidence: false,
  },

  // ---- Incident Commander ----
  // Deliberately coarse: says WHICH systems look unhealthy, never WHY. Gives the IC an active
  // tool to run and something concrete to cross-reference against what teammates report, without
  // duplicating any investigative role's evidence or leaking the mechanism.
  {
    id: "ic_status_degraded",
    visibleToRoles: ["incident_commander"],
    title: "Service Status Board: checkout + database degraded",
    category: "metric",
    content:
      "checkout-service: DEGRADED (elevated latency, error rate climbing)\n" +
      "checkout_db: DEGRADED (elevated latency)\n" +
      "infra: NOMINAL (no CPU/memory/scaling alerts)",
    hint: "Two services are unhealthy; the underlying infrastructure itself reports no issues.",
    unlock: { toolId: "service_status_board", atFraction: 0.1 },
    isRedHerring: false,
    isKeyEvidence: false,
  },
  {
    id: "ic_impact_rising",
    visibleToRoles: ["incident_commander"],
    title: "Customer impact rising",
    category: "metric",
    content:
      "Checkout-related tickets: 34 in the last 15 min, up from a 2-ticket baseline.\n" +
      "  Common complaint: \"payment page hangs, then fails.\" No reports of failed logins or\n" +
      "  browsing issues elsewhere on the site.",
    unlock: { toolId: "customer_impact_feed", atFraction: 0.4 },
    isRedHerring: false,
    isKeyEvidence: false,
  },
];

const TIMELINE: FractionalTimelineStep[] = [
  { atFraction: 0, headline: "Checkout latency begins rising", detail: "p95 climbs from 210ms toward 1.2s." },
  { atFraction: 0.08, headline: "First 5xx errors reported", detail: "Isolated PoolTimeoutError spikes on checkout." },
  { atFraction: 0.2, headline: "DB connection pool nears saturation", detail: "Pool utilization crosses 95%." },
  { atFraction: 0.35, headline: "Error rate crosses 5%", detail: "Sustained 5xx on POST /checkout." },
  { atFraction: 0.5, headline: "Customer support escalates", detail: "Multiple reports of failed checkouts." },
  { atFraction: 0.7, headline: "Error rate plateaus near 9-10%", detail: "Pool remains fully saturated with a growing wait queue." },
];

export function buildCheckoutDegradationScenario(durationSeconds: number): Omit<ScenarioDefinition, "difficulty"> {
  const evidence: EvidenceDefinition[] = EVIDENCE.map((e) => ({
    ...e,
    unlock: {
      toolId: e.unlock.toolId,
      atSeconds:
        e.unlock.atFraction !== undefined ? Math.round(e.unlock.atFraction * durationSeconds) : undefined,
    },
  }));

  const timeline: TimelineStep[] = TIMELINE.map((t) => ({
    atSeconds: Math.round(t.atFraction * durationSeconds),
    headline: t.headline,
    detail: t.detail,
  }));

  return {
    id: "checkout-degradation",
    title: "Checkout Degradation",
    severity: "SEV-1",
    briefing:
      "Checkout latency has climbed from ~200ms to several seconds and a growing share of requests are " +
      "failing outright. Orders are being lost. A deploy went out a few minutes before symptoms began. " +
      "Find the root cause and propose a remediation before the incident window closes.",
    durationSeconds,
    timeline,
    tools: TOOLS,
    evidence,
    rootCause: {
      summary:
        "The v2.14.0 deploy added a per-cart-item loyalty-discount lookup that issues one DB query per " +
        "line item instead of a single batched query (N+1). Query volume against loyalty_history rose " +
        "~8x, saturating the fixed 20-connection DB pool. Requests then queue for a free connection; once " +
        "the wait exceeds the 5s acquire timeout, the request fails with a 5xx. CPU/memory stay flat " +
        "because the bottleneck is pool contention (I/O wait), not compute.",
      causalChain: [
        "v2.14.0 deploy adds per-item loyalty_history lookup in the checkout handler",
        "Each checkout now issues N queries (N = cart line items) instead of 0-1",
        "loyalty_history query volume rises ~8x (480 -> ~3,800 calls/min)",
        "Fixed 20-connection DB pool saturates (20/20 in use, growing wait queue)",
        "Checkout requests queue waiting for a pool connection",
        "Requests exceeding the 5000ms acquire timeout fail with PoolTimeoutError -> 5xx",
        "CPU/memory remain flat because pods are I/O-blocked, not compute-bound",
      ],
      remediation:
        "Batch the loyalty-history lookup into a single query per cart (WHERE item_id IN (...)) instead of " +
        "one query per item, or cache/precompute loyalty data outside the checkout hot path. As a short-term " +
        "mitigation, roll back v2.14.0 and/or temporarily raise the DB pool size while the query is fixed.",
      keyEvidenceIds: [
        "be_deploy_log",
        "be_trace_n1",
        "be_error_logs",
        "db_pool_saturation",
        "db_query_volume_spike",
        "sre_cpu_mem_flat",
        "sre_request_rate_normal",
      ],
    },
    plausibleWrongHypotheses: [
      "A sudden traffic spike overwhelmed checkout (ruled out: request rate is at normal baseline).",
      "The deploy introduced a crash loop or memory leak (ruled out: zero restarts, flat memory).",
      "Replication lag is causing slow/stale reads (ruled out: replica lag is normal, <1s).",
      "Lock contention between concurrent checkout writes (ruled out: no blocking locks detected).",
      "The external payment provider is slow or failing (ruled out: payment dependency latency/error rate normal).",
    ],
    rubricWeights: {
      rootCauseAccuracy: 40,
      evidenceQuality: 20,
      remediationQuality: 20,
      efficiency: 10,
      collaboration: 10,
    },
    scoringHints: {
      causalTerms: ["deploy", "loyalty", "n+1", "n + 1", "repeated quer", "per item", "per-item", "connection pool", "pool"],
      redHerringTerms: ["traffic spike", "memory leak", "crash loop", "replication", "lock contention", "payment provider", "network"],
      remediationTerms: ["batch", "cache", "rollback"],
      distinctiveTerms: ["n+1", "loyalty_history", "connection pool", "pool saturat", "20-connection"],
    },
  };
}
