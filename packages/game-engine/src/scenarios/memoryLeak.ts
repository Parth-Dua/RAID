import type { EvidenceDefinition, ScenarioDefinition, TimelineStep, ToolDefinition } from "@raid/shared";

/**
 * "Recommendation Service Crash Loop" — scenario 3. A third distinct failure *mechanism* again
 * (unbounded memory growth -> OOM kill -> restart cycle) so none of the three scenarios share a
 * root cause shape: checkout-degradation is query-volume-driven pool exhaustion, lock-contention
 * is a blocking transaction, this one is a memory leak with no query or lock involvement at all.
 *
 * TRUE ROOT CAUSE: the v3.4.0 deploy adds an in-process response cache to recommendation-service,
 * keyed by a unique per-request ID instead of the user ID the response is actually keyed on. Since
 * every request generates a new key that is never reused and never evicted, the cache grows
 * without bound. Each pod's memory climbs steadily until it hits its container memory limit, at
 * which point Kubernetes OOM-kills it. The pod restarts, and requests routed to it during the
 * restart/readiness window fail with 503s. Because pods leak independently and restart on their
 * own schedule, the failure pattern is intermittent and cyclical rather than a constant outage.
 * CPU stays flat throughout — this is a memory problem, not a compute problem.
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
    id: "reco_app_logs",
    role: "backend_engineer",
    name: "Application Logs",
    description: "Tail recent application-level logs for recommendation-service.",
    resultSummary: "Recent ERROR/WARN lines for recommendation-service.",
    baselineOutput: "No ERROR/WARN lines in the last few minutes. Log volume nominal.",
  },
  {
    id: "reco_traces",
    role: "backend_engineer",
    name: "Distributed Traces",
    description: "Inspect a sampled trace for a failed recommendation request.",
    resultSummary: "Waterfall of spans for one representative request.",
    baselineOutput: "TRACE sample: GET /recommendations total=45ms. All spans nominal, no anomalies yet.",
  },
  {
    id: "reco_deployments",
    role: "backend_engineer",
    name: "Deployment History",
    description: "List recent deployments for recommendation-service.",
    resultSummary: "Deployment log with diff summaries.",
  },
  {
    id: "reco_endpoint_stats",
    role: "backend_engineer",
    name: "Endpoint Stats",
    description: "Per-endpoint latency and error-rate breakdown.",
    resultSummary: "p50/p95/p99 latency and 5xx rate per endpoint.",
  },
  {
    id: "reco_cache_stats",
    role: "backend_engineer",
    name: "In-Process Cache Stats",
    description: "Inspect recommendation-service's in-process response cache.",
    resultSummary: "Cache entry count, key cardinality, and hit rate over time.",
    baselineOutput: "Cache stats unavailable outside of the affected build.",
  },
  {
    id: "reco_downstream_ml",
    role: "backend_engineer",
    name: "ML Model Service Health",
    description: "Check latency/error rate of the downstream recommendation-model dependency.",
    resultSummary: "Outbound call stats to the ML model-serving dependency.",
  },
  // Database Engineer
  {
    id: "reco_connections",
    role: "database_engineer",
    name: "Active Connections",
    description: "See recommendation-service's connection pool utilization against reco_db.",
    resultSummary: "Connection pool in-use/idle counts over time.",
    baselineOutput: "6/20 connections in use, all idle or executing normally.",
  },
  {
    id: "reco_query_latency",
    role: "database_engineer",
    name: "Query Latency",
    description: "p50/p95/p99 latency for reco_db queries.",
    resultSummary: "Query latency distribution over time.",
    baselineOutput: "All queries under 15ms p99.",
  },
  {
    id: "reco_slow_queries",
    role: "database_engineer",
    name: "Slow Query Log",
    description: "Queries exceeding the slow-query threshold.",
    resultSummary: "Slow-query log entries, if any.",
  },
  {
    id: "reco_lock_monitor",
    role: "database_engineer",
    name: "Lock Monitor",
    description: "Check for blocking locks and long-held transactions on reco_db.",
    resultSummary: "Current lock waits and blocking chains, if any.",
  },
  {
    id: "reco_replication_status",
    role: "database_engineer",
    name: "Replication Status",
    description: "Primary/replica lag for reco_db.",
    resultSummary: "Replication lag in seconds per replica.",
  },
  // SRE / Infra
  {
    id: "reco_cpu_memory",
    role: "sre",
    name: "CPU / Memory Panel",
    description: "Container-level CPU and memory utilization for recommendation-service pods.",
    resultSummary: "CPU% and memory% across pods over time.",
  },
  {
    id: "reco_pod_health",
    role: "sre",
    name: "Pod Health",
    description: "Pod restart counts, OOMKill events, and readiness status.",
    resultSummary: "Per-pod restarts, OOMKills, readiness state.",
  },
  {
    id: "reco_request_rate",
    role: "sre",
    name: "Request Rate",
    description: "Inbound request rate to recommendation-service.",
    resultSummary: "Requests/min over time, compared to the prior 24h baseline.",
  },
  {
    id: "reco_network_health",
    role: "sre",
    name: "Network Health",
    description: "Latency and packet loss between recommendation-service and its dependencies.",
    resultSummary: "Network RTT and loss% on outbound paths.",
  },
  {
    id: "reco_infra_events",
    role: "sre",
    name: "Infra Events Feed",
    description: "Cluster-level events: deploys, restarts, OOM kills, scaling actions.",
    resultSummary: "Chronological infra event feed.",
  },
  // Incident Commander
  {
    id: "reco_status_board",
    role: "incident_commander",
    name: "Service Status Board",
    description: "A coarse, cross-team health rollup: which services are degraded right now.",
    resultSummary: "NOMINAL / DEGRADED per service. Says what's unhealthy, not why.",
    baselineOutput: "recommendation-service: NOMINAL  |  reco_db: NOMINAL  |  infra: NOMINAL",
  },
  {
    id: "reco_impact_feed",
    role: "incident_commander",
    name: "Customer Impact Feed",
    description: "Support ticket volume and customer-reported recommendation failures.",
    resultSummary: "Ticket volume trend for recommendation-related complaints.",
    baselineOutput: "Recommendation-related tickets: 0 in the last 15 min (baseline). No notable spike yet.",
  },
];

const EVIDENCE: FractionalEvidence[] = [
  // ---- Backend Engineer ----
  {
    id: "reco_deploy_note",
    visibleToRoles: ["backend_engineer"],
    title: "Deploy: recommendation-service v3.4.0",
    category: "deployment",
    content:
      "2026-09-12T14:02:11Z  DEPLOY  recommendation-service v3.4.0 (prev v3.3.2)\n" +
      "  Author: t.osei  Ticket: RECO-441 \"Add in-process response cache to cut model-service calls\"\n" +
      "  Diff summary: introduces an in-memory Map cache in front of the recommendation-model call, " +
      "keyed by `requestId` (a fresh UUID generated per incoming request) rather than `userId`. No " +
      "eviction policy or max-size bound was added.",
    unlock: { toolId: "reco_deployments" },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "reco_cache_growth",
    visibleToRoles: ["backend_engineer"],
    title: "Cache stats: entry count growing without bound",
    category: "metric",
    content:
      "recommendation-service in-process cache (pod reco-7f9c-a1):\n" +
      "  14:05  entries=1,204     hit-rate=0.0%\n" +
      "  14:15  entries=48,910    hit-rate=0.0%\n" +
      "  14:25  entries=112,340   hit-rate=0.0%\n" +
      "  14:35  entries=201,880   hit-rate=0.0%  (pod restarted at 14:37, entries reset to 0)",
    hint: "Entry count only ever grows and the hit rate is 0% — every key is unique and nothing is ever evicted or reused.",
    unlock: { toolId: "reco_cache_stats", atFraction: 0.15 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "reco_error_logs",
    visibleToRoles: ["backend_engineer"],
    title: "Application error logs",
    category: "log",
    content:
      "14:22:03 WARN  recommendation-service  memory usage above 85% of container limit\n" +
      "14:24:51 ERROR recommendation-service  connection reset: pod terminating\n" +
      "14:24:52 ERROR gateway  upstream recommendation-service pod unavailable, retrying\n" +
      "  (pattern repeats every 15-20 minutes on a different pod each time)",
    unlock: { toolId: "reco_app_logs", atFraction: 0.25 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "reco_trace_restart",
    visibleToRoles: ["backend_engineer"],
    title: "Trace: failed request during pod restart",
    category: "trace",
    content:
      "TRACE 5e21fa  GET /recommendations  total=timeout\n" +
      "  gateway.route -> reco-7f9c-a1                FAILED: connection reset\n" +
      "  gateway.retry -> reco-7f9c-b3                 210ms  200 OK",
    hint: "The request fails only when it lands on a pod that is mid-restart; retrying against a healthy pod succeeds immediately.",
    unlock: { toolId: "reco_traces", atFraction: 0.2 },
    isRedHerring: false,
    isKeyEvidence: false,
  },
  {
    id: "reco_endpoint_stats_ev",
    visibleToRoles: ["backend_engineer"],
    title: "Endpoint latency/error breakdown",
    category: "metric",
    content:
      "GET /recommendations   p50=48ms p95=120ms p99=180ms  5xx-rate=6.1% (bursty, correlated with restarts)\n" +
      "GET /catalog            p50=40ms p95=95ms  p99=150ms  5xx-rate=0.03% (unchanged from baseline)\n" +
      "GET /cart                p50=35ms p95=88ms  p99=140ms  5xx-rate=0.02% (unchanged from baseline)",
    hint: "Only recommendation-service's own endpoint shows elevated errors, and they come in bursts rather than a steady rate.",
    unlock: { toolId: "reco_endpoint_stats" },
    isRedHerring: false,
    isKeyEvidence: false,
  },
  {
    id: "reco_ml_ok",
    visibleToRoles: ["backend_engineer"],
    title: "ML model service health (red herring check)",
    category: "metric",
    content: "recommendation-model service: p95=38ms, error-rate=0.0%. Status page reports fully operational.",
    hint: "The downstream model service itself is healthy throughout.",
    unlock: { toolId: "reco_downstream_ml" },
    isRedHerring: true,
    isKeyEvidence: false,
  },

  // ---- Database Engineer ----
  {
    id: "reco_connections_normal",
    visibleToRoles: ["database_engineer"],
    title: "Connections: normal utilization",
    category: "metric",
    content:
      "reco_db connections (max=20):\n" +
      "  14:00  in-use=5   idle=15\n" +
      "  14:15  in-use=7   idle=13\n" +
      "  14:30  in-use=6   idle=14",
    hint: "Connection pool utilization is low and stable the entire time — the database is not under pressure.",
    unlock: { toolId: "reco_connections", atFraction: 0.1 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "reco_query_latency_normal",
    visibleToRoles: ["database_engineer"],
    title: "Query latency: normal throughout",
    category: "metric",
    content: "reco_db query latency: p50=4ms p95=11ms p99=15ms at 14:00, 14:15, and 14:30 — no change across the incident window.",
    unlock: { toolId: "reco_query_latency" },
    isRedHerring: false,
    isKeyEvidence: false,
  },
  {
    id: "reco_no_slow_queries",
    visibleToRoles: ["database_engineer"],
    title: "Slow query log: empty",
    category: "log",
    content: "0 queries exceeding the 100ms slow-query threshold in the last hour.",
    unlock: { toolId: "reco_slow_queries" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "reco_no_locks",
    visibleToRoles: ["database_engineer"],
    title: "Lock monitor: no blocking",
    category: "metric",
    content: "0 blocking chains, 0 idle-in-transaction connections detected on reco_db.",
    unlock: { toolId: "reco_lock_monitor" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "reco_replication_ok",
    visibleToRoles: ["database_engineer"],
    title: "Replication lag: normal",
    category: "metric",
    content: "Replica-1 lag: 0.2s. Replica-2 lag: 0.4s. Both within normal range (<2s).",
    unlock: { toolId: "reco_replication_status" },
    isRedHerring: true,
    isKeyEvidence: false,
  },

  // ---- SRE / Infra ----
  {
    id: "reco_cpu_mem_sawtooth",
    visibleToRoles: ["sre"],
    title: "CPU/memory: sawtooth pattern on memory only",
    category: "metric",
    content:
      "recommendation-service pod reco-7f9c-a1:\n" +
      "  14:05  CPU=12%  MEM=22%\n" +
      "  14:15  CPU=13%  MEM=51%\n" +
      "  14:25  CPU=12%  MEM=79%\n" +
      "  14:35  CPU=14%  MEM=97%\n" +
      "  14:37  CPU=11%  MEM=19%  (pod restarted, memory reset)",
    hint: "Memory climbs steadily until the pod restarts and resets to baseline, then climbs again - CPU stays flat the entire time.",
    unlock: { toolId: "reco_cpu_memory", atFraction: 0.15 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "reco_oomkills_climbing",
    visibleToRoles: ["sre"],
    title: "Pod health: OOMKill count climbing",
    category: "metric",
    content:
      "recommendation-service pods (4 total):\n" +
      "  14:00  OOMKills(total)=0\n" +
      "  14:20  OOMKills(total)=1  (reco-7f9c-a1)\n" +
      "  14:40  OOMKills(total)=3  (reco-7f9c-a1, reco-7f9c-b3, reco-7f9c-c2)\n" +
      "  15:00  OOMKills(total)=6  (each pod OOM-killed roughly every 15-20 min)",
    hint: "Every pod is independently being killed for exceeding its memory limit, then restarting and repeating the pattern.",
    unlock: { toolId: "reco_pod_health", atFraction: 0.2 },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "reco_request_rate_normal",
    visibleToRoles: ["sre"],
    title: "Request rate: no traffic spike",
    category: "metric",
    content: "recommendation-service inbound rate: 210 req/min at 14:00, 205 req/min at 14:40. 24h baseline: 190-230 req/min.",
    hint: "Traffic is at a completely normal level throughout - this rules out a demand spike as the trigger.",
    unlock: { toolId: "reco_request_rate" },
    isRedHerring: false,
    isKeyEvidence: true,
  },
  {
    id: "reco_network_ok",
    visibleToRoles: ["sre"],
    title: "Network health: normal",
    category: "metric",
    content: "recommendation-service -> reco_db and -> recommendation-model: RTT p99 under 2ms, 0.0% packet loss throughout.",
    unlock: { toolId: "reco_network_health" },
    isRedHerring: true,
    isKeyEvidence: false,
  },
  {
    id: "reco_infra_oom_events",
    visibleToRoles: ["sre"],
    title: "Infra events: OOMKill + restart timestamps",
    category: "log",
    content:
      "14:20:03  OOMKilled  pod=reco-7f9c-a1  reason=Memory cgroup out of memory\n" +
      "14:20:04  RESTARTED  pod=reco-7f9c-a1\n" +
      "14:38:11  OOMKilled  pod=reco-7f9c-b3  reason=Memory cgroup out of memory\n" +
      "14:38:12  RESTARTED  pod=reco-7f9c-b3\n" +
      "14:55:47  OOMKilled  pod=reco-7f9c-c2  reason=Memory cgroup out of memory",
    hint: "The kernel is killing pods specifically for exceeding their memory cgroup limit, not for any other reason.",
    unlock: { toolId: "reco_infra_events", atFraction: 0.25 },
    isRedHerring: false,
    isKeyEvidence: false,
  },

  // ---- Incident Commander ----
  {
    id: "reco_status_degraded",
    visibleToRoles: ["incident_commander"],
    title: "Service Status Board: recommendation-service degraded",
    category: "metric",
    content: "recommendation-service: DEGRADED (intermittent errors)\nreco_db: NOMINAL\ninfra: NOMINAL",
    hint: "Only the service itself is unhealthy; its database and the underlying infrastructure both report fine.",
    unlock: { toolId: "reco_status_board", atFraction: 0.1 },
    isRedHerring: false,
    isKeyEvidence: false,
  },
  {
    id: "reco_impact_rising",
    visibleToRoles: ["incident_commander"],
    title: "Customer impact rising, in bursts",
    category: "metric",
    content:
      "Recommendation-related tickets: 14 in the last 45 min, up from a 0-1 baseline.\n" +
      "  Common complaint: \"recommendations section fails to load, works again on refresh.\"",
    hint: "Complaints come in clusters rather than steadily, matching an intermittent rather than constant failure.",
    unlock: { toolId: "reco_impact_feed", atFraction: 0.35 },
    isRedHerring: false,
    isKeyEvidence: false,
  },
];

const TIMELINE: FractionalTimelineStep[] = [
  { atFraction: 0, headline: "Memory usage on recommendation-service pods begins climbing", detail: "Steady upward trend on every pod, independently." },
  { atFraction: 0.15, headline: "First pod crosses 85% of its memory limit", detail: "Warning-level memory pressure logged." },
  { atFraction: 0.22, headline: "First OOM kill and restart", detail: "reco-7f9c-a1 is OOM-killed; brief 503 burst while it restarts." },
  { atFraction: 0.4, headline: "Second pod OOM-killed", detail: "reco-7f9c-b3 follows the same climb-and-kill pattern." },
  { atFraction: 0.55, headline: "Error rate becomes cyclical", detail: "5xx rate spikes every 15-20 minutes as different pods restart." },
  { atFraction: 0.75, headline: "Support tickets cluster around each restart burst", detail: "Complaints arrive in waves, not a steady stream." },
];

export function buildMemoryLeakScenario(durationSeconds: number): Omit<ScenarioDefinition, "difficulty"> {
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
    id: "memory-leak",
    title: "Recommendation Service Crash Loop",
    severity: "SEV-2",
    briefing:
      "recommendation-service is intermittently failing with 503s. The errors come in bursts rather than " +
      "steadily, and each burst seems to hit a different pod. A deploy went out a bit before symptoms began. " +
      "Find the root cause and propose a remediation before the incident window closes.",
    durationSeconds,
    timeline,
    tools: TOOLS,
    evidence,
    rootCause: {
      summary:
        "The v3.4.0 deploy added an in-process response cache keyed by a fresh per-request ID instead of " +
        "the user ID the response actually depends on. Every request creates a new, never-reused, " +
        "never-evicted cache entry, so each pod's memory grows without bound until it hits its container " +
        "memory limit. Kubernetes OOM-kills the pod, it restarts, and requests routed to it during the " +
        "restart/readiness window fail with 503s. Because pods leak independently and restart on their own " +
        "schedule, the failure pattern is intermittent and cyclical rather than a constant outage, and CPU " +
        "stays flat throughout since this is a memory problem, not a compute problem.",
      causalChain: [
        "v3.4.0 deploy adds an in-process cache keyed by a fresh per-request UUID instead of userId",
        "Every request produces a unique key, so cache entries are never reused and never evicted",
        "Each pod's memory climbs steadily as its cache grows without bound",
        "A pod's memory usage approaches its container memory limit",
        "Kubernetes OOM-kills the pod for exceeding its memory cgroup limit",
        "The pod restarts, and requests routed to it during the restart/readiness window fail with 503s",
        "Pods leak independently and restart on their own schedule, so the failure pattern is intermittent and cyclical rather than constant; CPU stays flat because the problem is memory growth, not compute load",
      ],
      remediation:
        "Roll back to v3.3.2 or disable the cache via feature flag as an immediate mitigation. Fix the cache " +
        "to key on userId (the actual cacheable dimension) with a bounded, evicting cache such as an LRU with " +
        "a max size, and add memory-based alerting that fires before pods approach their OOM threshold.",
      keyEvidenceIds: [
        "reco_deploy_note",
        "reco_cache_growth",
        "reco_error_logs",
        "reco_connections_normal",
        "reco_cpu_mem_sawtooth",
        "reco_oomkills_climbing",
        "reco_request_rate_normal",
      ],
    },
    plausibleWrongHypotheses: [
      "The downstream ML model service is slow or failing (ruled out: model service reports normal latency and 0% errors).",
      "A traffic spike overwhelmed recommendation-service (ruled out: request rate is at normal baseline the entire time).",
      "A slow database query is timing out requests (ruled out: query latency and connection utilization are normal throughout).",
      "Network issues between pods and dependencies are causing failures (ruled out: network RTT and packet loss are normal).",
      "A recent node or infrastructure failure is dropping pods (ruled out: infra events show only memory-limit OOM kills, not node failures).",
    ],
    rubricWeights: {
      rootCauseAccuracy: 40,
      evidenceQuality: 20,
      remediationQuality: 20,
      efficiency: 10,
      collaboration: 10,
    },
  };
}
