import type { Hypothesis, KnownFact, Role, ScenarioDefinition } from "@raid/shared";

/**
 * The adaptive Game Master (V0.4) never sees raw chat or the full evidence text — it sees a
 * bounded, structured summary of what the TEAM has collectively surfaced. This keeps prompt size
 * bounded regardless of game length, and means an intervention can never be generated from (or
 * leak) private per-role evidence content: only evidence ids/titles are included, never the
 * evidentiary text itself. See docs/AI_DESIGN.md "Adaptive Game Master" and ADR-0XX.
 */

const MAX_EVIDENCE = 20;
const MAX_HYPOTHESES = 10;
const MAX_TRAJECTORY = 15;
const MAX_QUESTIONS = 10;
const MAX_FACTS = 15;

export interface TrajectoryEntry {
  atSeconds: number;
  summary: string;
}

export interface CollectiveReasoningState {
  elapsedSeconds: number;
  durationSeconds: number;
  discoveredEvidence: { id: string; title: string; category: string }[];
  activeHypotheses: { text: string; status: string }[];
  challengedHypotheses: { text: string; status: string; challengeCount: number }[];
  ruledOutHypotheses: { text: string }[];
  openQuestions: string[];
  knownFacts: string[];
  toolsExecuted: string[];
  recentTrajectory: TrajectoryEntry[];
  /** Fraction (0-1) of each role's tools that have been executed at least once by anyone. Roles
   * with zero tools in this scenario (shouldn't happen) are omitted rather than reported as 0. */
  subsystemCoverage: Partial<Record<Role, number>>;
}

export type RawTrajectoryEventType = "TOOL_EXECUTED" | "EVIDENCE_UNLOCKED" | "HYPOTHESIS_CREATED" | "KNOWN_FACT_ADDED";

export interface RawTrajectoryEvent {
  atSeconds: number;
  type: RawTrajectoryEventType;
  payload: Record<string, unknown>;
}

export interface CollectiveReasoningStateInput {
  scenario: ScenarioDefinition;
  elapsedSeconds: number;
  unlockedEvidenceIds: ReadonlySet<string>;
  hypotheses: Hypothesis[];
  knownFacts: KnownFact[];
  executedToolIds: ReadonlySet<string>;
  /** Ordered oldest -> newest; the builder keeps only the most recent MAX_TRAJECTORY entries. */
  recentEvents: RawTrajectoryEvent[];
}

export function buildCollectiveReasoningState(input: CollectiveReasoningStateInput): CollectiveReasoningState {
  const { scenario, elapsedSeconds, unlockedEvidenceIds, hypotheses, knownFacts, executedToolIds, recentEvents } = input;

  const discoveredEvidence = scenario.evidence
    .filter((e) => unlockedEvidenceIds.has(e.id))
    .slice(0, MAX_EVIDENCE)
    .map((e) => ({ id: e.id, title: e.title, category: e.category }));

  const activeHypotheses = hypotheses
    .filter((h) => h.status === "OPEN" || h.status === "PLAUSIBLE" || h.status === "SUPPORTED")
    .slice(0, MAX_HYPOTHESES)
    .map((h) => ({ text: h.text, status: h.status }));

  const challengedHypotheses = hypotheses
    .filter((h) => h.status !== "CONTRADICTED" && h.challengedBy.length > 0)
    .slice(0, MAX_HYPOTHESES)
    .map((h) => ({ text: h.text, status: h.status, challengeCount: h.challengedBy.length }));

  const ruledOutHypotheses = hypotheses
    .filter((h) => h.status === "CONTRADICTED")
    .slice(0, MAX_HYPOTHESES)
    .map((h) => ({ text: h.text }));

  const openQuestions = knownFacts
    .filter((f) => f.category === "question")
    .slice(0, MAX_QUESTIONS)
    .map((f) => f.text);

  const knownFactsList = knownFacts
    .filter((f) => f.category === "fact")
    .slice(0, MAX_FACTS)
    .map((f) => f.text);

  const toolById = new Map(scenario.tools.map((t) => [t.id, t]));
  const toolsExecuted = [...executedToolIds]
    .map((id) => toolById.get(id)?.name)
    .filter((name): name is string => Boolean(name));

  const evidenceById = new Map(scenario.evidence.map((e) => [e.id, e]));
  const hypothesisById = new Map(hypotheses.map((h) => [h.id, h]));
  const factById = new Map(knownFacts.map((f) => [f.id, f]));

  const trajectory: TrajectoryEntry[] = recentEvents
    .slice(-MAX_TRAJECTORY)
    .map((ev) => ({ atSeconds: ev.atSeconds, summary: summarizeEvent(ev, toolById, evidenceById, hypothesisById, factById) }))
    .filter((e) => e.summary.length > 0);

  const rolesInScenario = new Set(scenario.tools.map((t) => t.role));
  const subsystemCoverage: Partial<Record<Role, number>> = {};
  for (const role of rolesInScenario) {
    const roleTools = scenario.tools.filter((t) => t.role === role);
    if (roleTools.length === 0) continue;
    const executed = roleTools.filter((t) => executedToolIds.has(t.id));
    subsystemCoverage[role] = executed.length / roleTools.length;
  }

  return {
    elapsedSeconds,
    durationSeconds: scenario.durationSeconds,
    discoveredEvidence,
    activeHypotheses,
    challengedHypotheses,
    ruledOutHypotheses,
    openQuestions,
    knownFacts: knownFactsList,
    toolsExecuted,
    recentTrajectory: trajectory,
    subsystemCoverage,
  };
}

function summarizeEvent(
  ev: RawTrajectoryEvent,
  toolById: Map<string, { name: string }>,
  evidenceById: Map<string, { title: string }>,
  hypothesisById: Map<string, { text: string }>,
  factById: Map<string, { text: string }>,
): string {
  switch (ev.type) {
    case "TOOL_EXECUTED": {
      const name = toolById.get(String(ev.payload.toolId))?.name ?? "a tool";
      return `Ran "${name}"`;
    }
    case "EVIDENCE_UNLOCKED": {
      const title = evidenceById.get(String(ev.payload.evidenceId))?.title ?? "new evidence";
      return `Unlocked evidence "${title}"`;
    }
    case "HYPOTHESIS_CREATED": {
      const text = hypothesisById.get(String(ev.payload.hypothesisId))?.text;
      return text ? `Proposed hypothesis: "${text}"` : "Proposed a hypothesis";
    }
    case "KNOWN_FACT_ADDED": {
      const text = factById.get(String(ev.payload.factId))?.text;
      return text ? `Logged: "${text}"` : "Logged a known fact";
    }
    default:
      return "";
  }
}
