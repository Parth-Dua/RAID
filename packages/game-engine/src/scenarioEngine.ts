import type { Difficulty, EvidenceDefinition, PublicEvidence, Role, ScenarioCatalogEntry, ScenarioDefinition, ToolResult } from "@raid/shared";
import { buildCheckoutDegradationScenario } from "./scenarios/checkoutDegradation.js";
import { buildLockContentionScenario } from "./scenarios/lockContention.js";
import { buildMemoryLeakScenario } from "./scenarios/memoryLeak.js";
import { applyDifficulty } from "./difficulty.js";

/** A scenario builder authors ONE canonical (difficulty-neutral) definition; `buildScenario`
 * below is the only place difficulty is applied, uniformly, to whatever a builder returns - no
 * scenario module needs to know difficulty exists. This is the "no `if (scenario.id === ...)`
 * scattered through product logic" requirement in practice: the registry is the only place
 * scenario identity is switched on, and it's a plain data lookup, not branching logic. */
export type ScenarioBuilder = (durationSeconds: number) => Omit<ScenarioDefinition, "difficulty">;

const SCENARIO_REGISTRY: Record<string, ScenarioBuilder> = {
  "checkout-degradation": buildCheckoutDegradationScenario,
  "lock-contention": buildLockContentionScenario,
  "memory-leak": buildMemoryLeakScenario,
};

const CATALOG: ScenarioCatalogEntry[] = [
  {
    id: "checkout-degradation",
    title: "Checkout Degradation",
    severity: "SEV-1",
    briefing: "Checkout latency is climbing and a growing share of requests are failing outright.",
    tagline: "A deploy, a query pattern, and a saturated connection pool.",
  },
  {
    id: "lock-contention",
    title: "Order Processing Stall",
    severity: "SEV-1",
    briefing: "Order writes are queueing up and timing out across the board.",
    tagline: "A migration, a long-held lock, and a growing wait queue.",
  },
  {
    id: "memory-leak",
    title: "Recommendation Service Crash Loop",
    severity: "SEV-2",
    briefing: "A backend service is intermittently failing as its pods restart on a rolling basis.",
    tagline: "A new feature, a slow leak, and a cascade of OOM kills.",
  },
];

export function listScenarioIds(): string[] {
  return Object.keys(SCENARIO_REGISTRY);
}

export function listScenarioCatalog(): ScenarioCatalogEntry[] {
  return CATALOG;
}

export function buildScenario(scenarioId: string, durationSeconds: number, difficulty: Difficulty = "NORMAL"): ScenarioDefinition {
  const builder = SCENARIO_REGISTRY[scenarioId];
  if (!builder) throw new Error(`Unknown scenario: ${scenarioId}`);
  const base: ScenarioDefinition = { ...builder(durationSeconds), difficulty };
  return applyDifficulty(base, difficulty);
}

/**
 * Duration presets. "standard" targets the 15-25 min design goal; "demo" is
 * for quick human playtests (~5 min). "instant" is NOT exposed in the web
 * UI's start-game dropdown — it exists solely so the bot simulation script
 * (docs/TESTING.md) can exercise the full time-gated evidence pipeline in
 * well under a minute instead of waiting on real 5-minute demo timing.
 */
export const DURATION_PRESETS = {
  standard: 20 * 60,
  demo: 5 * 60,
  instant: 60,
} as const;
export type DurationPreset = keyof typeof DURATION_PRESETS;

/**
 * An evidence item is unlocked once every condition on it is satisfied:
 *  - toolId (if set): that tool must have been executed at least once by ANY player who can see it
 *    (role-gated at the tool-authorization layer, not here)
 *  - atSeconds (if set): the simulation clock must have passed this mark
 * Both conditions AND together when both are present.
 */
export function isEvidenceUnlocked(
  evidence: EvidenceDefinition,
  executedToolIds: ReadonlySet<string>,
  elapsedSeconds: number,
): boolean {
  if (evidence.unlock.toolId && !executedToolIds.has(evidence.unlock.toolId)) return false;
  if (evidence.unlock.atSeconds !== undefined && elapsedSeconds < evidence.unlock.atSeconds) return false;
  return true;
}

export function getUnlockedEvidence(
  scenario: ScenarioDefinition,
  executedToolIds: ReadonlySet<string>,
  elapsedSeconds: number,
): EvidenceDefinition[] {
  return scenario.evidence.filter((e) => isEvidenceUnlocked(e, executedToolIds, elapsedSeconds));
}

export function toPublicEvidence(evidence: EvidenceDefinition, elapsedSeconds: number): PublicEvidence {
  return {
    id: evidence.id,
    title: evidence.title,
    category: evidence.category,
    content: evidence.content,
    unlockedAtSeconds: evidence.unlock.atSeconds ?? elapsedSeconds,
    isRedHerring: evidence.isRedHerring,
  };
}

export function visibleEvidenceForRole(evidence: EvidenceDefinition[], role: Role): EvidenceDefinition[] {
  return evidence.filter((e) => e.visibleToRoles.includes(role));
}

/**
 * Executing a tool never mutates evidence state itself — it just means "this tool has now
 * been executed at least once", which is one of the two unlock predicates above. This
 * function computes what a specific execution should show the player: previously-unlocked
 * evidence tied to that tool (if any), or a deterministic baseline line otherwise.
 */
export function computeToolResult(
  scenario: ScenarioDefinition,
  toolId: string,
  executedToolIdsIncludingThis: ReadonlySet<string>,
  elapsedSeconds: number,
): ToolResult {
  const tool = scenario.tools.find((t) => t.id === toolId);
  if (!tool) throw new Error(`Unknown tool: ${toolId}`);

  const tiedEvidence = scenario.evidence.filter((e) => e.unlock.toolId === toolId);
  const unlockedNow = tiedEvidence.filter((e) => isEvidenceUnlocked(e, executedToolIdsIncludingThis, elapsedSeconds));

  const output =
    unlockedNow.length > 0
      ? unlockedNow.map((e) => `[${e.title}]\n${e.content}`).join("\n\n")
      : (tool.baselineOutput ?? tool.resultSummary);

  return {
    toolId,
    executedAtSeconds: elapsedSeconds,
    output,
    unlockedEvidenceIds: unlockedNow.map((e) => e.id),
  };
}

export function computeSimulationSeconds(startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}
