import type { EvidenceDefinition, GeneratedScenarioDefinition, ScenarioDefinition, TimelineStep } from "@raid/shared";

/**
 * The "author once as fractions of the eventual duration, scale at build time" pattern every
 * scenario (hand-authored or, as of V0.5, AI-generated) uses for time-gated evidence and timeline
 * steps — factored out here so it exists in exactly one place rather than being reimplemented
 * per-scenario-file (it was duplicated 3x across the hand-authored scenarios before this existed;
 * see the scenario files under ./scenarios for the FractionalEvidence/FractionalTimelineStep shapes
 * that feed these functions).
 */

interface FractionalUnlockLike {
  toolId?: string;
  atFraction?: number;
}

interface FractionalEvidenceLike extends Omit<EvidenceDefinition, "unlock"> {
  unlock: FractionalUnlockLike;
}

interface FractionalTimelineStepLike extends Omit<TimelineStep, "atSeconds"> {
  atFraction: number;
}

export function materializeFractionalEvidence(evidence: FractionalEvidenceLike[], durationSeconds: number): EvidenceDefinition[] {
  return evidence.map((e) => ({
    ...e,
    unlock: {
      toolId: e.unlock.toolId,
      atSeconds: e.unlock.atFraction !== undefined ? Math.round(e.unlock.atFraction * durationSeconds) : undefined,
    },
  }));
}

export function materializeFractionalTimeline(timeline: FractionalTimelineStepLike[], durationSeconds: number): TimelineStep[] {
  return timeline.map((t) => ({
    atSeconds: Math.round(t.atFraction * durationSeconds),
    headline: t.headline,
    detail: t.detail,
  }));
}

/** V0.5: materializes a full AI-generated (or human-authored-as-generated-shape) scenario into the
 * same `Omit<ScenarioDefinition, "difficulty">` shape `buildScenario` expects from every built-in
 * scenario builder — so a generated scenario is played through the exact same engine code path
 * (`applyDifficulty`, `isEvidenceUnlocked`, scoring, ...) as a hand-authored one, with zero special
 * casing anywhere downstream. */
export function materializeGeneratedScenario(
  generated: GeneratedScenarioDefinition,
  durationSeconds: number,
): Omit<ScenarioDefinition, "difficulty"> {
  return {
    id: generated.id,
    title: generated.title,
    severity: generated.severity,
    briefing: generated.briefing,
    durationSeconds,
    timeline: materializeFractionalTimeline(generated.timeline, durationSeconds),
    tools: generated.tools,
    evidence: materializeFractionalEvidence(generated.evidence, durationSeconds),
    rootCause: generated.rootCause,
    plausibleWrongHypotheses: generated.plausibleWrongHypotheses,
    rubricWeights: generated.rubricWeights,
    scoringHints: generated.scoringHints,
  };
}
