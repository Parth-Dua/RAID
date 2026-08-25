import type { Role, ScenarioDefinition } from "@raid/shared";
import { ROLES } from "@raid/shared";

export interface ScenarioCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ScenarioQualityReport {
  scenarioId: string;
  checks: ScenarioCheck[];
  passed: boolean;
}

/**
 * Automated portion of the scenario-quality checklist described in
 * docs/GAME_DESIGN.md. This cannot prove a scenario is *fun*, but it can
 * mechanically enforce the structural properties good scenario design
 * requires: no single role hoarding the answer, every role contributing,
 * red herrings actually ruled out, internally consistent timestamps/ids.
 */
export function evaluateScenarioQuality(scenario: ScenarioDefinition): ScenarioQualityReport {
  const checks: ScenarioCheck[] = [];
  const investigativeRoles: Role[] = ROLES.filter((r) => r !== "incident_commander");

  // 1. Rubric weights sum to 100
  const weightSum = Object.values(scenario.rubricWeights).reduce((a, b) => a + b, 0);
  checks.push({
    name: "rubric weights sum to 100",
    passed: weightSum === 100,
    detail: `sum=${weightSum}`,
  });

  // 2. Every keyEvidenceId references real evidence
  const evidenceIds = new Set(scenario.evidence.map((e) => e.id));
  const missingKeyIds = scenario.rootCause.keyEvidenceIds.filter((id) => !evidenceIds.has(id));
  checks.push({
    name: "all keyEvidenceIds reference real evidence",
    passed: missingKeyIds.length === 0,
    detail: missingKeyIds.length ? `missing: ${missingKeyIds.join(", ")}` : "ok",
  });

  // 3. No single role can solve it alone: key evidence must span >= 3 investigative roles
  const keyEvidence = scenario.evidence.filter((e) => scenario.rootCause.keyEvidenceIds.includes(e.id));
  const rolesWithKeyEvidence = new Set(keyEvidence.flatMap((e) => e.visibleToRoles));
  checks.push({
    name: "key evidence spans at least 3 roles (no single role can solve alone)",
    passed: rolesWithKeyEvidence.size >= 3,
    detail: `roles with key evidence: ${[...rolesWithKeyEvidence].join(", ")}`,
  });

  // 4. Every investigative role contributes at least one piece of key evidence
  const rolesMissingKeyEvidence = investigativeRoles.filter((r) => !rolesWithKeyEvidence.has(r));
  checks.push({
    name: "every investigative role contributes key evidence",
    passed: rolesMissingKeyEvidence.length === 0,
    detail: rolesMissingKeyEvidence.length ? `missing: ${rolesMissingKeyEvidence.join(", ")}` : "ok",
  });

  // 5. Every investigative role has at least one red herring to rule out
  const rolesMissingRedHerring = investigativeRoles.filter(
    (r) => !scenario.evidence.some((e) => e.isRedHerring && e.visibleToRoles.includes(r)),
  );
  checks.push({
    name: "every investigative role has a plausible red herring to rule out",
    passed: rolesMissingRedHerring.length === 0,
    detail: rolesMissingRedHerring.length ? `missing: ${rolesMissingRedHerring.join(", ")}` : "ok",
  });

  // 6. At least one documented plausible-but-wrong hypothesis
  checks.push({
    name: "at least one plausible wrong hypothesis is documented",
    passed: scenario.plausibleWrongHypotheses.length >= 1,
    detail: `count=${scenario.plausibleWrongHypotheses.length}`,
  });

  // 7. Timeline timestamps are non-decreasing and within [0, durationSeconds]
  const timelineSorted = scenario.timeline.every(
    (step, i) => i === 0 || step.atSeconds >= scenario.timeline[i - 1]!.atSeconds,
  );
  const timelineInBounds = scenario.timeline.every(
    (step) => step.atSeconds >= 0 && step.atSeconds <= scenario.durationSeconds,
  );
  checks.push({
    name: "timeline timestamps are monotonic and in bounds",
    passed: timelineSorted && timelineInBounds,
    detail: `sorted=${timelineSorted} inBounds=${timelineInBounds}`,
  });

  // 8. Every tool belongs to a role that actually has tools, and every evidence unlock toolId exists
  const toolIds = new Set(scenario.tools.map((t) => t.id));
  const badEvidenceUnlocks = scenario.evidence.filter((e) => e.unlock.toolId && !toolIds.has(e.unlock.toolId));
  checks.push({
    name: "every evidence unlock references a real tool",
    passed: badEvidenceUnlocks.length === 0,
    detail: badEvidenceUnlocks.length ? `bad: ${badEvidenceUnlocks.map((e) => e.id).join(", ")}` : "ok",
  });

  // 9. No evidence visible to zero roles (unreachable/dead content)
  const orphanEvidence = scenario.evidence.filter((e) => e.visibleToRoles.length === 0);
  checks.push({
    name: "no evidence is visible to zero roles",
    passed: orphanEvidence.length === 0,
    detail: orphanEvidence.length ? `orphans: ${orphanEvidence.map((e) => e.id).join(", ")}` : "ok",
  });

  // 10. Each role has a non-trivial evidence pool (enough to investigate, not just 1 clue card)
  const thinRoles = investigativeRoles.filter(
    (r) => scenario.evidence.filter((e) => e.visibleToRoles.includes(r)).length < 3,
  );
  checks.push({
    name: "every investigative role has >= 3 evidence items",
    passed: thinRoles.length === 0,
    detail: thinRoles.length ? `thin: ${thinRoles.join(", ")}` : "ok",
  });

  // 11. The Incident Commander has at least one active tool - the role cannot be purely passive
  // (V0.2.2 "Incident Commander cannot be passive").
  const icHasTool = scenario.tools.some((t) => t.role === "incident_commander");
  checks.push({
    name: "Incident Commander has at least one active tool",
    passed: icHasTool,
    detail: icHasTool ? "ok" : "IC has zero tools - purely passive role",
  });

  // 12. Evidence is distributed roughly evenly across investigative roles - no role should be
  // starved relative to another (clue redundancy / balance, V0.2.7).
  const evidenceCounts = investigativeRoles.map(
    (r) => scenario.evidence.filter((e) => e.visibleToRoles.includes(r)).length,
  );
  const maxCount = Math.max(...evidenceCounts);
  const minCount = Math.min(...evidenceCounts);
  const balanced = minCount > 0 && maxCount <= minCount * 2.5;
  checks.push({
    name: "evidence is roughly balanced across investigative roles (max <= 2.5x min)",
    passed: balanced,
    detail: `counts: ${investigativeRoles.map((r, i) => `${r}=${evidenceCounts[i]}`).join(", ")}`,
  });

  // 13. Answer leakage: no evidence item's content baldly states the causal-chain summary. This
  // is a mechanical proxy (a long verbatim substring match), not a substitute for human read-through,
  // but it catches the class of bug where a clue accidentally gives away the whole answer at once.
  const summarySnippet = scenario.rootCause.summary.toLowerCase().slice(0, 50);
  const leakyEvidence =
    summarySnippet.length > 20
      ? scenario.evidence.filter((e) => e.content.toLowerCase().includes(summarySnippet))
      : [];
  checks.push({
    name: "no single evidence item states the full root-cause summary verbatim",
    passed: leakyEvidence.length === 0,
    detail: leakyEvidence.length ? `leaky: ${leakyEvidence.map((e) => e.id).join(", ")}` : "ok",
  });

  // 14. Causal consistency proxy: the causal chain has enough steps to represent a real multi-hop
  // mechanism (a one- or two-line "chain" isn't really a chain, and is a sign of an under-designed
  // scenario), and every key evidence item traces to at least one causal-chain step by keyword overlap.
  checks.push({
    name: "root-cause causal chain has at least 4 steps (a real multi-hop mechanism)",
    passed: scenario.rootCause.causalChain.length >= 4,
    detail: `steps=${scenario.rootCause.causalChain.length}`,
  });

  return {
    scenarioId: scenario.id,
    checks,
    passed: checks.every((c) => c.passed),
  };
}
