import type { GeneratedScenarioDefinition, Role } from "@raid/shared";
import { ROLES } from "@raid/shared";

export interface ScenarioGenerationValidationResult {
  valid: boolean;
  errors: string[];
}

const INVESTIGATIVE_ROLES: Role[] = ROLES.filter((r) => r !== "incident_commander");

/**
 * Deterministic structural validation for an AI-generated scenario candidate (V0.5.3) — runs
 * BEFORE the candidate is ever materialized into a real, playable `ScenarioDefinition`. This is
 * "is this well-formed and executable at all" (real roles, real ids, no dangling references, no
 * duplicates), distinct from `evaluateScenarioQuality` (game-DESIGN quality: role balance, red
 * herrings actually ruled out, etc.) which the generation pipeline also runs, after materializing,
 * against the exact same 14-check bar every hand-authored scenario must clear.
 *
 * Deliberately has zero dependency on which AI provider produced the candidate — it validates data,
 * not provenance, so the exact same function protects a live DeepSeek generation, a MockAIProvider
 * generation (tests), and a human-submitted "save" payload alike.
 */
export function validateGeneratedScenario(candidate: GeneratedScenarioDefinition): ScenarioGenerationValidationResult {
  const errors: string[] = [];

  if (!candidate.id || candidate.id.trim().length === 0) errors.push("id is empty");
  if (!candidate.title || candidate.title.trim().length < 3) errors.push("title is missing or too short");
  if (!candidate.briefing || candidate.briefing.trim().length < 20) errors.push("briefing is missing or too short");
  if (!["SEV-1", "SEV-2", "SEV-3"].includes(candidate.severity)) errors.push(`severity "${candidate.severity}" is not a valid severity`);

  const toolIds = new Set<string>();
  for (const tool of candidate.tools) {
    if (!ROLES.includes(tool.role)) errors.push(`tool "${tool.id}" has invalid role "${tool.role}"`);
    if (!tool.id) errors.push("a tool has an empty id");
    else if (toolIds.has(tool.id)) errors.push(`duplicate tool id "${tool.id}"`);
    else toolIds.add(tool.id);
    if (!tool.name || !tool.description || !tool.resultSummary) errors.push(`tool "${tool.id}" is missing name/description/resultSummary`);
  }

  const evidenceIds = new Set<string>();
  for (const e of candidate.evidence) {
    if (!e.id) errors.push("an evidence item has an empty id");
    else if (evidenceIds.has(e.id)) errors.push(`duplicate evidence id "${e.id}"`);
    else evidenceIds.add(e.id);

    if (!e.title || !e.content) errors.push(`evidence "${e.id}" is missing title/content`);
    if (e.visibleToRoles.length === 0) errors.push(`evidence "${e.id}" is visible to zero roles`);
    for (const role of e.visibleToRoles) {
      if (!ROLES.includes(role)) errors.push(`evidence "${e.id}" has invalid visibleToRoles entry "${role}"`);
    }
    if (e.unlock.toolId && !toolIds.has(e.unlock.toolId)) {
      errors.push(`evidence "${e.id}" unlock references unknown tool id "${e.unlock.toolId}"`);
    }
    if (e.unlock.atFraction !== undefined && (e.unlock.atFraction < 0 || e.unlock.atFraction > 1)) {
      errors.push(`evidence "${e.id}" unlock.atFraction ${e.unlock.atFraction} is outside [0,1]`);
    }
  }

  let lastFraction = -Infinity;
  for (const step of candidate.timeline) {
    if (step.atFraction < 0 || step.atFraction > 1) errors.push(`timeline step "${step.headline}" atFraction ${step.atFraction} is outside [0,1]`);
    if (step.atFraction < lastFraction) errors.push(`timeline is not monotonically ordered at step "${step.headline}"`);
    lastFraction = step.atFraction;
    if (!step.headline) errors.push("a timeline step has an empty headline");
  }

  if (!candidate.rootCause?.summary || candidate.rootCause.summary.trim().length < 20) {
    errors.push("rootCause.summary is missing or too short");
  }
  if (!candidate.rootCause?.remediation || candidate.rootCause.remediation.trim().length < 10) {
    errors.push("rootCause.remediation is missing or too short");
  }
  if (!candidate.rootCause?.causalChain || candidate.rootCause.causalChain.length < 4) {
    errors.push("rootCause.causalChain must have at least 4 steps");
  }
  for (const id of candidate.rootCause?.keyEvidenceIds ?? []) {
    if (!evidenceIds.has(id)) errors.push(`rootCause.keyEvidenceIds references unknown evidence id "${id}"`);
  }
  if ((candidate.rootCause?.keyEvidenceIds ?? []).length === 0) errors.push("rootCause.keyEvidenceIds is empty");

  if (!candidate.plausibleWrongHypotheses || candidate.plausibleWrongHypotheses.length === 0) {
    errors.push("plausibleWrongHypotheses is empty");
  }

  const weightSum = candidate.rubricWeights
    ? Object.values(candidate.rubricWeights).reduce((a, b) => a + b, 0)
    : 0;
  if (weightSum !== 100) errors.push(`rubricWeights sum to ${weightSum}, not 100`);

  const hints = candidate.scoringHints;
  if (!hints || hints.causalTerms.length === 0) errors.push("scoringHints.causalTerms is empty");
  if (!hints || hints.redHerringTerms.length === 0) errors.push("scoringHints.redHerringTerms is empty");
  if (!hints || hints.remediationTerms.length === 0) errors.push("scoringHints.remediationTerms is empty");
  if (!hints || hints.distinctiveTerms.length < 2) errors.push("scoringHints.distinctiveTerms needs at least 2 terms (used pairwise by the leak guard)");

  for (const role of INVESTIGATIVE_ROLES) {
    if (!candidate.tools.some((t) => t.role === role)) errors.push(`investigative role "${role}" has zero tools - scenario is not executable for that role`);
  }

  return { valid: errors.length === 0, errors };
}
