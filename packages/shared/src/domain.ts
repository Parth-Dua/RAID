/**
 * Core domain types shared between server and web client.
 * These mirror (but are not identical to) the database schema — this file
 * is the wire/domain representation, DB rows are mapped into these shapes.
 */

export const ROLES = [
  "backend_engineer",
  "database_engineer",
  "sre",
  "incident_commander",
] as const;
export type Role = (typeof ROLES)[number];

export const GAME_PHASES = [
  "LOBBY",
  "STARTING",
  "ACTIVE",
  "FINALIZING",
  "COMPLETED",
  "ABANDONED",
] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

export const HYPOTHESIS_STATUS = [
  "OPEN",
  "SUPPORTED",
  "PLAUSIBLE",
  "WEAK",
  "CONTRADICTED",
] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUS)[number];

export interface PublicPlayer {
  id: string;
  displayName: string;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  role: Role | null;
  joinedAt: string;
}

export interface RoomSnapshot {
  roomId: string;
  code: string;
  phase: GamePhase;
  players: PublicPlayer[];
  gameId: string | null;
  scenarioId: string | null;
  createdAt: string;
}

export interface EvidenceUnlockCondition {
  /** Evidence becomes available once this tool has been executed at least once. */
  toolId?: string;
  /** Evidence becomes available once the simulation clock passes this many seconds. */
  atSeconds?: number;
  /** If both toolId and atSeconds are set, both conditions must hold (AND). */
}

export const DIFFICULTIES = ["NORMAL", "HARD"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * V0.4 adaptive Game Master: how the AI classifies the team's current investigative state, from a
 * bounded collective-reasoning snapshot (never raw chat). ON_TRACK and SOLVING_TOO_QUICKLY never
 * trigger an intervention (nothing to correct); the other five are intervention-eligible states.
 * See docs/AI_DESIGN.md "Adaptive Game Master".
 */
export const TEAM_STATE_CLASSIFICATIONS = [
  "ON_TRACK",
  "TUNNEL_VISION",
  "INSUFFICIENT_EVIDENCE",
  "CONTRADICTORY_REASONING",
  "IGNORING_CRITICAL_SIGNAL",
  "STALLED",
  "SOLVING_TOO_QUICKLY",
] as const;
export type TeamStateClassification = (typeof TEAM_STATE_CLASSIFICATIONS)[number];

/** Safe, bounded intervention kinds the AI may propose (V0.4.3). Never includes anything that
 * changes the root cause, fabricates facts, reveals the answer, exposes private evidence, mutates
 * score, or bypasses the game engine — every intervention is delivered as a labeled, read-only
 * system chat message, never a mutation to evidence/hypotheses/score. */
export const INTERVENTION_KINDS = [
  "CUSTOMER_SYMPTOM",
  "TIMING_ADJUSTMENT",
  "OPERATIONAL_CLUE",
  "RECONCILE_SUGGESTION",
  "OPTIONAL_HINT",
] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export interface EvidenceDefinition {
  id: string;
  /** Role(s) that can see this evidence once unlocked. */
  visibleToRoles: Role[];
  title: string;
  category: "log" | "metric" | "trace" | "deployment" | "chat_note" | "incident_fact";
  /** Rendered content shown to the player: the raw data (log lines, a metric table, ...). */
  content: string;
  /**
   * An optional one-line interpretive callout ("this rules out X", "note the pattern here").
   * Shown appended to `content` on NORMAL difficulty; withheld entirely on HARD, so the same
   * authored evidence item is objectively harder to read on HARD without being a different
   * scenario - see packages/game-engine applyDifficulty() and docs/GAME_DESIGN.md "difficulty".
   */
  hint?: string;
  unlock: EvidenceUnlockCondition;
  isRedHerring: boolean;
  /** Not sent to clients; used for scoring key-evidence coverage. */
  isKeyEvidence: boolean;
}

/** Evidence as delivered to a specific client: unlock metadata stripped, only what they're allowed to see. */
export interface PublicEvidence {
  id: string;
  title: string;
  category: EvidenceDefinition["category"];
  content: string;
  unlockedAtSeconds: number;
  isRedHerring: boolean;
}

export interface ToolDefinition {
  id: string;
  role: Role;
  name: string;
  description: string;
  /** Static result text shown every time (deterministic, cheap — no AI). */
  resultSummary: string;
  /** Shown when executed before any time-gated evidence for this tool has unlocked. */
  baselineOutput?: string;
}

export interface TimelineStep {
  atSeconds: number;
  headline: string;
  /** Optional metric deltas broadcast as part of the shared incident timeline. */
  detail?: string;
}

export interface ScenarioRubricWeights {
  rootCauseAccuracy: number;
  evidenceQuality: number;
  remediationQuality: number;
  efficiency: number;
  collaboration: number;
}

export interface ScenarioDefinition {
  id: string;
  title: string;
  severity: "SEV-1" | "SEV-2" | "SEV-3";
  briefing: string;
  durationSeconds: number;
  difficulty: Difficulty;
  timeline: TimelineStep[];
  tools: ToolDefinition[];
  evidence: EvidenceDefinition[];
  rootCause: {
    summary: string;
    causalChain: string[];
    remediation: string;
    keyEvidenceIds: string[];
  };
  plausibleWrongHypotheses: string[];
  rubricWeights: ScenarioRubricWeights;
  /**
   * Scenario-authored keyword hints MockAIProvider matches against, so the mock's scoring
   * heuristic is data-driven per scenario rather than one hardcoded checkout-degradation-shaped
   * keyword list applied to every scenario (which would score "lock contention" or "memory leak"
   * as wrong even when they're the actual answer for those scenarios). Never read by the real
   * DeepSeek provider - it reasons from the full causal chain/evidence already in its prompt.
   */
  scoringHints: {
    /** Terms that indicate genuine causal understanding of this scenario's actual root cause. */
    causalTerms: string[];
    /** Terms strongly associated with one of this scenario's red herrings / wrong explanations. */
    redHerringTerms: string[];
    /** Terms indicating a remediation that matches this scenario's actual fix. */
    remediationTerms: string[];
    /**
     * A small set of *mutually non-overlapping* (no term a substring of another) phrases unique
     * enough that reciting 2+ of them together is reciting the mechanism, not making one
     * legitimate observation. Used only by `leakGuard.containsRootCauseLeak` - deliberately a
     * separate, stricter list from `causalTerms` above (which favors recall for scoring and can
     * include generic single words like "pool" that would false-positive here on a single mention).
     */
    distinctiveTerms: string[];
  };
}

/** Lightweight, spoiler-free listing used by the scenario-selection UI - never includes evidence/root cause. */
export interface ScenarioCatalogEntry {
  id: string;
  title: string;
  severity: ScenarioDefinition["severity"];
  briefing: string;
  tagline: string;
}

export interface ToolResult {
  toolId: string;
  executedAtSeconds: number;
  output: string;
  unlockedEvidenceIds: string[];
}

export interface Hypothesis {
  id: string;
  gameId: string;
  authorId: string;
  authorName: string;
  text: string;
  status: HypothesisStatus;
  aiRationale: string | null;
  supportedBy: string[];
  challengedBy: string[];
  evidenceIds: string[];
  createdAt: string;
  version: number;
}

export interface ChatMessage {
  id: string;
  gameId: string;
  authorId: string | null;
  authorName: string;
  text: string;
  /** "ai_intervention" (V0.4) is a delivered, budget/cooldown-gated Game Master nudge - rendered
   * distinctly from "system" (deterministic timeline events) so players can tell scripted incident
   * progression apart from the adaptive AI's read of the team's investigation. */
  kind: "player" | "system" | "ai_intervention";
  createdAt: string;
}

export const KNOWLEDGE_BOARD_CATEGORIES = ["fact", "question"] as const;
export type KnowledgeBoardCategory = (typeof KNOWLEDGE_BOARD_CATEGORIES)[number];

export interface KnownFact {
  id: string;
  text: string;
  category: KnowledgeBoardCategory;
  sourceEvidenceId: string | null;
  addedBy: string;
  createdAt: string;
}

export interface FinalSubmissionInput {
  rootCause: string;
  supportingEvidenceIds: string[];
  remediation: string;
}

export interface ScoreBreakdown {
  rootCauseAccuracy: number;
  evidenceQuality: number;
  remediationQuality: number;
  efficiency: number;
  collaboration: number;
  total: number;
}

export interface Debrief {
  score: ScoreBreakdown;
  rootCauseSummary: string;
  expectedRemediation: string;
  timeline: TimelineStep[];
  keyEvidenceFound: string[];
  keyEvidenceMissed: string[];
  redHerringsEncountered: string[];
  hypothesesConsidered: { text: string; status: HypothesisStatus }[];
  collaborationNote: string;
  coachingNotes: string[];
}

export type GameEventBroadcast =
  | { kind: "chat"; message: ChatMessage }
  | { kind: "known_fact"; fact: KnownFact }
  | { kind: "timeline_step"; step: TimelineStep };

export interface GameSnapshot {
  gameId: string;
  roomId: string;
  scenarioId: string;
  phase: GamePhase;
  serverNowMs: number;
  startedAtMs: number | null;
  endsAtMs: number | null;
  simulationSeconds: number;
  myRole: Role | null;
  briefing: string;
  severity: ScenarioDefinition["severity"];
  difficulty: Difficulty;
  timeline: TimelineStep[];
  tools: ToolDefinition[];
  evidence: PublicEvidence[];
  knownFacts: KnownFact[];
  hypotheses: Hypothesis[];
  chat: ChatMessage[];
  version: number;
  debrief: Debrief | null;
}
