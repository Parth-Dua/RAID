import type { EvidenceDefinition, ScenarioDefinition, TimelineStep, ToolDefinition } from "@raid/shared";

/**
 * "Order Processing Stall" — scenario 2. Deliberately a different failure *mechanism* than
 * checkout-degradation (lock wait, not connection-pool exhaustion from query volume) so the two
 * scenarios feel meaningfully different rather than re-skinned versions of each other, per
 * V0.3's "scenarios feel meaningfully different" requirement.
 *
 * TRUE ROOT CAUSE: a deploy adds a background backfill job that updates `loyalty_tier` on every
 * row of the `orders` table inside ONE large, long-running, uncommitted transaction instead of
 * batching it into many small committed transactions. That transaction holds row/table locks on
 * `orders` for its entire multi-minute duration. Every normal order-write transaction (checkout
 * completing an order, an order status update) then blocks waiting to acquire those same locks.
 * Blocked transactions sit "idle in transaction" holding a DB connection without doing any work,
 * so the pool *looks* fully utilized (same surface symptom as checkout-degradation) but for an
 * entirely different reason — nobody is running expensive queries, everybody is waiting on a lock.
 * Once wait time exceeds the app's statement/transaction timeout, order-write requests fail.
 * CPU/memory stay flat because pods are blocked, not busy.
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
    id: "order_service_logs",
    role: "backend_engineer",
    name: "Order Service Logs",
    description: "Tail recent application-level logs for order-service.",
    resultSummary: "Recent ERROR/WARN lines for order-service.",
    baselineOutput: "No ERROR/WARN lines in the last few minutes. Log volume nominal.",
  },
  {
    id: "order_traces",
    role: "backend_engineer",
    name: "Distributed Traces",
    description: "Inspect a sampled trace for a slow POST /orders request.",
    resultSummary: "Waterfall of spans for one representative order-write request.",
    baselineOutput: "TRACE sample: POST /orders total=180ms. All spans nominal, no anomalies yet.",
  },
  {
    id: "order_deployments",
    role: "backend_engineer",
    name: "Deployment History",
    description: "List recent deployments and background jobs for order-service.",
    resultSummary: "Deployment and job-launch log.",
  },
  {
    id: "order_endpoint_stats",
    role: "backend_engineer",
    name: "Endpoint Stats",
    description: "Per-endpoint latency and error-rate breakdown.",
    resultSummary: "p50/p95/p99 latency and 5xx rate per endpoint.",
  },
  {
    id: "downstream_health",
    role: "backend_engineer",
    name: "Downstream Dependency Health",
    description: "Check latency/error rate of payment and shipping dependencies.",
    resultSummary: "Outbound call stats to order-service's dependencies.",
  },
  // Database Engineer
  {
    id: "order_lock_monitor",
    role: "database_engineer",
    name: "Lock Monitor",
    description: "Check for blocking locks and long-held transactions.",
    resultSummary: "Current lock waits and blocking chains, if any.",
    baselineOutput: "No blocking chains detected.",
  },
  {
    id: "order_active_queries",
    role: "database_engineer",
    name: "Active Connections / Queries",
    description: "See what every open connection to orders_db is currently doing.",
    resultSummary: "Per-connection state: active, idle, or idle-in-transaction.",
    baselineOutput: "18/30 connections in use, all executing normally. No idle-in-transaction connections.",
  },
  {
    id: "order_query_stats",
    role: "database_engineer",
    name: "Query Duration Stats",
    description: "Longest-running statements against orders_db right now.",
    resultSummary: "Currently-executing statements ranked by duration.",
    baselineOutput: "No statement has been running longer than 40ms.",
  },
  {
    id: "order_deadlock_check",
    role: "database_engineer",
    name: "Deadlock Detector",
    description: "Check for detected deadlocks in the last hour.",
    resultSummary: "Deadlock events, if any.",
  },
  {
    id: "order_replication_status",
    role: "database_engineer",
    name: "Replication Status",
    description: "Primary/replica lag for orders_db.",
    resultSummary: "Replication lag in seconds per replica.",
  },
  // SRE / Infra
  {
    id: "order_cpu_memory",
    role: "sre",
    name: "CPU / Memory Panel",
    description: "Container-level CPU and memory utilization for order-service pods.",
    resultSummary: "CPU% and memory% across pods over time.",
  },
  {
    id: "order_pod_health",
    role: "sre",
    name: "Pod Health",
    description: "Pod restart counts and readiness status.",
    resultSummary: "Per-pod restarts, OOMKills, readiness state.",
  },
  {
    id: "order_request_rate",
    role: "sre",
    name: "Request Rate",
    description: "Inbound request rate to order-service.",
    resultSummary: "Requests/min over time, compared to the prior 24h baseline.",
  },
  {
    id: "order_network_health",
    role: "sre",
    name: "Network Health",
    description: "Latency and packet loss between order-service and orders_db.",
    resultSummary: "Network RTT and loss% on the service-to-DB path.",
  },
  {
    id: "order_infra_events",
    role: "sre",
    name: "Infra Events Feed",
    description: "Cluster-level events: deploys, job launches, scaling actions.",
    resultSummary: "Chronological infra event feed.",
  },
  // Incident Commander
  {
    id: "order_status_board",
    role: "incident_commander",
    name: "Service Status Board",
    description: "A coarse, cross-team health rollup: which services are degraded right now.",
    resultSummary: "NOMINAL / DEGRADED per service. Says what's unhealthy, not why.",
    baselineOutput: "order-service: NOMINAL  |  orders_db: NOMINAL  |  infra: NOMINAL",
  },
  {
    id: "order_impact_feed",
    role: "incident_commander",
    name: "Customer Impact Feed",
    description: "Support ticket volume and customer-reported order failures.",
    resultSummary: "Ticket volume trend for order-related complaints.",
    baselineOutput: "Order-related tickets: 1 in the last 15 min (baseline). No notable spike yet.",
  },
];

const EVIDENCE: FractionalEvidence[] = [
  // ---- Backend Engineer ----
  {
    id: "oc_backfill_deploy",
    visibleToRoles: ["backend_engineer"],
    title: "Deploy: order-service v4.2.0 + loyalty_tier backfill job",
    category: "deployment",
    content:
      "2026-09-10T09:01:03Z  DEPLOY  order-service v4.2.0 (prev v4.1.7)\n" +
      "  Author: r.kapoor  Ticket: ORD-902 \"Backfill loyalty_tier on historical orders\"\n" +
      "  Diff summary: launches a one-time background job, backfillLoyaltyTier(), that runs\n" +
      "  `UPDATE orders SET loyalty_tier = ... WHERE loyalty_tier IS NULL` as a single transaction\n" +
      "  covering the entire orders table, rather than batching it in smaller committed chunks.",
    unlock: { toolId: "order_deployments" },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "oc_trace_blocked",
    visibleToRoles: ["backend_engineer"],
    title: "Trace: POST /orders (6.8s, stuck waiting on a lock)",
    category: "trace",
    content:
      "TRACE c91a04  POST /orders  total=6812ms\n" +
      "  auth.verify                 10ms\n" +
      "  order.validate               8ms\n" +
      "  db.transaction.begin          1ms\n" +
      "  db.update orders SET status=? WHERE id=?   6740ms (waiting for row lock)\n" +
      "  db.transaction.commit        FAILED: statement timeout",
    hint: "Nearly all span time is spent waiting to acquire a lock, not executing the UPDATE itself.",
    unlock: { toolId: "order_traces", atFraction: 0.12 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "oc_error_logs",
    visibleToRoles: ["backend_engineer"],
    title: "Application error logs",
    category: "log",
    content:
      "09:07:41 WARN  order-service  transaction pending for 3200ms on orders row update\n" +
      "09:09:15 ERROR order-service  StatementTimeoutError: canceling statement due to statement timeout\n" +
      "09:09:52 ERROR order-service  StatementTimeoutError: canceling statement due to statement timeout\n" +
      "  (repeats, growing in frequency, all on order-write endpoints)",
    unlock: { toolId: "order_service_logs", atFraction: 0.2 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "oc_endpoint_stats",
    visibleToRoles: ["backend_engineer"],
    title: "Endpoint latency/error breakdown",
    category: "metric",
    content:
      "POST /orders        p50=3.8s p95=6.9s p99=8.1s  5xx-rate=11.2%  (baseline p50=95ms, 5xx-rate=0.1%)\n" +
      "PATCH /orders/:id   p50=4.1s p95=7.2s p99=8.4s  5xx-rate=10.8%  (baseline p50=80ms, 5xx-rate=0.1%)\n" +
      "GET /orders/:id     p50=42ms p95=90ms p99=140ms 5xx-rate=0.04%  (unchanged from baseline)\n" +
      "GET /catalog        p50=45ms p95=100ms p99=160ms 5xx-rate=0.05% (unchanged from baseline)",
    hint: "Only endpoints that WRITE to orders are degraded; read-only endpoints are unaffected.",
    unlock: { toolId: "order_endpoint_stats" },
    isRedHerring: false,
    isKeyEvidence: false,
  },
  {
    id: "oc_downstream_ok",
    visibleToRoles: ["backend_engineer"],
    title: "Downstream dependency health (red herring check)",
    category: "metric",
    content:
      "Payment provider: p95=170ms, error-rate=0.01%. Shipping provider: p95=210ms, error-rate=0.02%.\n" +
      "Both dependency status pages report all systems operational.",
    hint: "Neither downstream dependency is implicated.",
    unlock: { toolId: "downstream_health" },
    isRedHerring: true,
    isKeyEvidence: false,
  },

  // ---- Database Engineer ----
  {
    id: "oc_blocking_chain",
    visibleToRoles: ["database_engineer"],
    title: "Lock monitor: one long-held transaction blocking dozens of others",
    category: "metric",
    content:
      "Blocking chain detected:\n" +
      "  PID 8841 (backfillLoyaltyTier job) — holding row locks on `orders`, running since 09:01:04\n" +
      "    blocks PID 9012 (order-service) — waiting 4200ms\n" +
      "    blocks PID 9013 (order-service) — waiting 3900ms\n" +
      "    blocks PID 9021 (order-service) — waiting 3600ms\n" +
      "    ... 26 more waiters, all order-service connections",
    hint: "One transaction (the backfill job) is blocking every other write to the orders table.",
    unlock: { toolId: "order_lock_monitor", atFraction: 0.1 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "oc_idle_in_transaction",
    visibleToRoles: ["database_engineer"],
    title: "Connections: mostly idle-in-transaction, not executing",
    category: "metric",
    content:
      "orders_db connections (max=30):\n" +
      "  09:00  in-use=9   idle-in-transaction=0\n" +
      "  09:04  in-use=18  idle-in-transaction=6\n" +
      "  09:08  in-use=29  idle-in-transaction=24\n" +
      "  09:10  in-use=30  idle-in-transaction=27",
    hint: "Almost all 'in-use' connections are idle-in-transaction (blocked, waiting) — not busy running queries.",
    unlock: { toolId: "order_active_queries", atFraction: 0.15 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "oc_long_running_statement",
    visibleToRoles: ["database_engineer"],
    title: "One statement has been running for 9+ minutes",
    category: "metric",
    content:
      "Longest-running statements:\n" +
      "  PID 8841  UPDATE orders SET loyalty_tier = ... WHERE loyalty_tier IS NULL   duration=9m14s (still running)\n" +
      "  PID 9012  UPDATE orders SET status = ? WHERE id = ?                        duration=41s (blocked, not executing)\n" +
      "  PID 9013  UPDATE orders SET status = ? WHERE id = ?                        duration=38s (blocked, not executing)",
    unlock: { toolId: "order_query_stats", atFraction: 0.1 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "oc_no_deadlock",
    visibleToRoles: ["database_engineer"],
    title: "Deadlock detector: no deadlocks",
    category: "metric",
    content: "0 deadlocks detected in the last hour. This is lock WAIT, not a deadlock — nothing is being auto-rolled-back.",
    unlock: { toolId: "order_deadlock_check" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "oc_replication_ok",
    visibleToRoles: ["database_engineer"],
    title: "Replication lag: normal",
    category: "metric",
    content: "Replica-1 lag: 0.3s. Replica-2 lag: 0.5s. Both within normal range (<2s).",
    unlock: { toolId: "order_replication_status" },
    isRedHerring: true,
    isKeyEvidence: false,
  },

  // ---- SRE / Infra ----
  {
    id: "oc_cpu_mem_flat",
    visibleToRoles: ["sre"],
    title: "CPU/memory flat throughout",
    category: "metric",
    content:
      "order-service pods (avg of 4):\n" +
      "  09:00  CPU=18%  MEM=35%\n" +
      "  09:05  CPU=19%  MEM=36%\n" +
      "  09:10  CPU=20%  MEM=36%",
    hint: "No CPU or memory pressure — pods are blocked waiting on the database, not busy.",
    unlock: { toolId: "order_cpu_memory", atFraction: 0.1 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "oc_request_rate_normal",
    visibleToRoles: ["sre"],
    title: "Request rate: no traffic spike",
    category: "metric",
    content: "order-service inbound rate: 61 req/min at 09:00, 58 req/min at 09:10. 24h baseline: 55-70 req/min.",
    hint: "This is a completely normal traffic level.",
    unlock: { toolId: "order_request_rate" },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "oc_pods_healthy",
    visibleToRoles: ["sre"],
    title: "Pod health: no restarts",
    category: "metric",
    content: "0 restarts, 0 OOMKills across all 4 order-service pods in the last hour. All pods Ready.",
    unlock: { toolId: "order_pod_health" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "oc_network_ok",
    visibleToRoles: ["sre"],
    title: "Network health: normal",
    category: "metric",
    content: "order-service -> orders_db: RTT p99=0.9ms, 0.0% packet loss. No network anomalies.",
    unlock: { toolId: "order_network_health" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "oc_deploy_marker",
    visibleToRoles: ["sre"],
    title: "Infra event: deploy + job launch at 09:01",
    category: "deployment",
    content:
      "09:01:03  DEPLOY order-service v4.2.0 rolled out (4/4 pods updated by 09:01:20)\n" +
      "09:01:04  JOB backfillLoyaltyTier started (job runner pod jr-7712)",
    hint: "A deploy and a background job both started right before symptoms began, but infra events alone don't show what the job does.",
    unlock: { toolId: "order_infra_events" },
    isRedHerring: false,
    isKeyEvidence: false,
  },

  // ---- Incident Commander ----
  {
    id: "oc_status_degraded",
    visibleToRoles: ["incident_commander"],
    title: "Service Status Board: orders + database degraded",
    category: "metric",
    content: "order-service: DEGRADED (elevated latency on writes)\norders_db: DEGRADED (elevated lock wait)\ninfra: NOMINAL",
    hint: "Two services are unhealthy; infrastructure itself reports no issues.",
    unlock: { toolId: "order_status_board", atFraction: 0.1 },
    isRedHerring: false,
    isKeyEvidence: false,
  },
  {
    id: "oc_impact_rising",
    visibleToRoles: ["incident_commander"],
    title: "Customer impact rising",
    category: "metric",
    content:
      "Order-related tickets: 21 in the last 15 min, up from a 1-ticket baseline.\n" +
      "  Common complaint: \"order won't go through, spinner just hangs.\"",
    unlock: { toolId: "order_impact_feed", atFraction: 0.4 },
    isRedHerring: false,
    isKeyEvidence: false,
  },
];

const TIMELINE: FractionalTimelineStep[] = [
  { atFraction: 0, headline: "Order write latency begins rising", detail: "p95 climbs from ~100ms toward several seconds." },
  { atFraction: 0.08, headline: "First order-write timeouts reported", detail: "Isolated StatementTimeoutError spikes." },
  { atFraction: 0.2, headline: "Lock wait queue grows past 20 waiters", detail: "Blocking chain rooted at the backfill job." },
  { atFraction: 0.35, headline: "Order-write error rate crosses 8%", detail: "Sustained 5xx on POST/PATCH /orders." },
  { atFraction: 0.5, headline: "Customer support escalates", detail: "Multiple reports of orders failing to submit." },
  { atFraction: 0.7, headline: "Error rate plateaus near 10-11%", detail: "The backfill job is still running; locks remain held." },
];

export function buildLockContentionScenario(durationSeconds: number): Omit<ScenarioDefinition, "difficulty"> {
  const evidence: EvidenceDefinition[] = EVIDENCE.map((e) => ({
    ...e,
    unlock: {
      toolId: e.unlock.toolId,
      atSeconds: e.unlock.atFraction !== undefined ? Math.round(e.unlock.atFraction * durationSeconds) : undefined,
    },
  }));

  const timeline: TimelineStep[] = TIMELINE.map((t) => ({
    atSeconds: Math.round(t.atFraction * durationSeconds),
    headline: t.headline,
    detail: t.detail,
  }));

  return {
    id: "lock-contention",
    title: "Order Processing Stall",
    severity: "SEV-1",
    briefing:
      "Order writes (checkout completion, order status updates) are queueing up and timing out. Reads " +
      "are unaffected. A deploy went out a few minutes before symptoms began. Find the root cause and " +
      "propose a remediation before the incident window closes.",
    durationSeconds,
    timeline,
    tools: TOOLS,
    evidence,
    rootCause: {
      summary:
        "The v4.2.0 deploy launched a one-time backfill job that updates loyalty_tier across the entire " +
        "orders table inside a single long-running, uncommitted transaction instead of small batched " +
        "commits. That transaction holds row locks on orders for its whole duration. Every normal " +
        "order-write transaction then blocks waiting for those same locks; blocked connections sit " +
        "idle-in-transaction rather than executing, so the pool looks saturated even though nobody is " +
        "running expensive queries. Once the wait exceeds the statement timeout, order writes fail.",
      causalChain: [
        "v4.2.0 deploy launches backfillLoyaltyTier as one large uncommitted transaction over the whole orders table",
        "The backfill transaction acquires row locks across a large portion of orders and holds them for its multi-minute duration",
        "Normal order-write transactions (checkout completion, status updates) block waiting to acquire the same locks",
        "Blocked transactions hold their DB connection idle-in-transaction while waiting, so the pool looks fully utilized without any query actually running slow",
        "Wait time exceeds the application's statement timeout and order-write requests fail with a 5xx",
        "CPU/memory stay flat because pods are blocked waiting on the database, not busy computing anything",
      ],
      remediation:
        "Kill or pause the backfill job, rewrite it to run in small batches with a commit (and a short lock " +
        "duration) after each batch, and re-run it during low-traffic hours or with explicit lock timeouts " +
        "so it can't block production writes indefinitely.",
      keyEvidenceIds: [
        "oc_backfill_deploy",
        "oc_trace_blocked",
        "oc_error_logs",
        "oc_blocking_chain",
        "oc_idle_in_transaction",
        "oc_long_running_statement",
        "oc_cpu_mem_flat",
        "oc_request_rate_normal",
      ],
    },
    plausibleWrongHypotheses: [
      "A sudden traffic spike overwhelmed order-service (ruled out: request rate is at normal baseline).",
      "A deadlock is stalling transactions (ruled out: the deadlock detector shows zero deadlocks - this is lock wait, not a deadlock).",
      "A downstream payment/shipping dependency is slow (ruled out: both report normal latency and uptime).",
      "Replication lag is causing slow/stale reads (ruled out: replica lag is normal).",
      "A pod crash loop is dropping requests (ruled out: zero restarts, zero OOMKills).",
    ],
    rubricWeights: {
      rootCauseAccuracy: 40,
      evidenceQuality: 20,
      remediationQuality: 20,
      efficiency: 10,
      collaboration: 10,
    },
    scoringHints: {
      causalTerms: [
        "lock",
        "backfill",
        "transaction",
        "idle-in-transaction",
        "idle in transaction",
        "uncommitted",
        "blocking",
        "loyalty_tier",
        "migration",
      ],
      redHerringTerms: ["traffic spike", "deadlock", "payment provider", "replication", "crash loop", "network"],
      remediationTerms: ["batch", "commit", "timeout", "kill the job", "pause the job"],
      distinctiveTerms: ["backfillloyaltytier", "idle-in-transaction", "loyalty_tier", "uncommitted transaction", "blocking chain"],
    },
  };
}
