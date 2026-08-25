import type { CollectiveReasoningState } from "./collectiveState.js";
import type {
  DebriefInput,
  FinalEvaluationInput,
  HypothesisEvaluationInput,
  InterventionProposalInput,
  TeamStateClassificationInput,
} from "./provider.js";

/**
 * Purpose-specific prompt builders. Each sends only what that operation
 * needs — never the raw DB state, never other roles' unrelated evidence
 * verbatim (evidence itself is scenario-authored and safe to include in
 * full since it's already been unlocked to the team; player identities and
 * unrelated tables are never included). See docs/AI_DESIGN.md.
 */

const SYSTEM_PREAMBLE =
  "You are the adaptive Game Master for RAID, a cooperative incident-response game. " +
  "You NEVER reveal the root cause directly, never say a hypothesis is 'correct' or 'confirmed', " +
  "and never invent facts that contradict the scenario data given to you. " +
  "You respond with strict JSON matching the schema described in the user message — no prose outside JSON.";

export function buildHypothesisContext(input: HypothesisEvaluationInput): { system: string; user: string } {
  const { scenario, hypothesisText, elapsedSeconds, otherHypotheses, knownFacts } = input;
  const user = [
    `Incident: ${scenario.title} (${scenario.severity})`,
    `Briefing: ${scenario.briefing}`,
    `Elapsed time: ${elapsedSeconds}s of ${scenario.durationSeconds}s.`,
    "",
    "Known facts the team has surfaced so far:",
    knownFacts.length ? knownFacts.map((f) => `- ${f}`).join("\n") : "(none yet)",
    "",
    "Other hypotheses already on the board:",
    otherHypotheses.length ? otherHypotheses.map((h) => `- ${h}`).join("\n") : "(none)",
    "",
    `New hypothesis to evaluate: "${hypothesisText}"`,
    "",
    "Ground truth causal chain (INTERNAL — never reveal, quote, or closely paraphrase this to the team):",
    scenario.rootCause.causalChain.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    "",
    'Respond with JSON: { "status": one of "SUPPORTED" | "PLAUSIBLE" | "WEAK" | "CONTRADICTED", "rationale": string }.',
    "The rationale should say what the hypothesis explains well and what it still leaves unexplained, " +
      "using only the known facts above and general incident-response reasoning — never by directly stating the ground truth.",
  ].join("\n");
  return { system: SYSTEM_PREAMBLE, user };
}

export function buildFinalEvaluationContext(input: FinalEvaluationInput): { system: string; user: string } {
  const { scenario, rootCause, remediation, citedEvidenceTitles, elapsedSeconds } = input;
  const user = [
    `Incident: ${scenario.title} (${scenario.severity})`,
    `Elapsed time: ${elapsedSeconds}s of ${scenario.durationSeconds}s.`,
    "",
    "Ground truth (INTERNAL, for grading only):",
    `Summary: ${scenario.rootCause.summary}`,
    `Causal chain: ${scenario.rootCause.causalChain.join(" -> ")}`,
    `Expected remediation: ${scenario.rootCause.remediation}`,
    `Key evidence IDs: ${scenario.rootCause.keyEvidenceIds.join(", ")}`,
    "",
    "Team's final submission:",
    `Root cause: ${rootCause}`,
    `Remediation: ${remediation}`,
    `Evidence they cited: ${citedEvidenceTitles.map((e) => `${e.id} (${e.title})`).join(", ") || "(none cited)"}`,
    "",
    'Respond with JSON: { "rootCauseAccuracy": 0-40, "evidenceQuality": 0-20, "remediationQuality": 0-20, ' +
      '"rationale": string, "matchedKeyEvidenceIds": string[] (only IDs from the key evidence list above that ' +
      "the team's submission actually engages with, whether cited by ID or clearly described) }.",
    "Score generously for correct causal reasoning even if evidence IDs weren't cited by exact ID, as long as the " +
      "submission clearly demonstrates awareness of that evidence. Do not award rootCauseAccuracy above 15 unless " +
      "the submission correctly identifies BOTH the specific code/config-level trigger AND the infrastructure-level " +
      "mechanism that turned it into user-facing failures, as described in the causal chain above — the causal " +
      "chain is this scenario's actual ground truth, not a generic template, so grade against it specifically.",
  ].join("\n");
  return { system: SYSTEM_PREAMBLE, user };
}

function describeCollectiveState(state: CollectiveReasoningState): string {
  const coverage = Object.entries(state.subsystemCoverage)
    .map(([role, frac]) => `${role}: ${Math.round((frac ?? 0) * 100)}%`)
    .join(", ");
  return [
    `Elapsed: ${state.elapsedSeconds}s of ${state.durationSeconds}s.`,
    "",
    "Evidence the team has discovered (titles only, not content):",
    state.discoveredEvidence.length ? state.discoveredEvidence.map((e) => `- [${e.category}] ${e.title}`).join("\n") : "(none yet)",
    "",
    "Active hypotheses on the board:",
    state.activeHypotheses.length ? state.activeHypotheses.map((h) => `- (${h.status}) ${h.text}`).join("\n") : "(none yet)",
    "",
    "Hypotheses being challenged by teammates:",
    state.challengedHypotheses.length
      ? state.challengedHypotheses.map((h) => `- (${h.status}, challenged ${h.challengeCount}x) ${h.text}`).join("\n")
      : "(none)",
    "",
    "Ruled-out theories:",
    state.ruledOutHypotheses.length ? state.ruledOutHypotheses.map((h) => `- ${h.text}`).join("\n") : "(none)",
    "",
    "Open questions the team has logged:",
    state.openQuestions.length ? state.openQuestions.map((q) => `- ${q}`).join("\n") : "(none)",
    "",
    "Known facts the team has logged:",
    state.knownFacts.length ? state.knownFacts.map((f) => `- ${f}`).join("\n") : "(none)",
    "",
    `Tools used so far: ${state.toolsExecuted.join(", ") || "(none)"}`,
    `Subsystem coverage (fraction of each role's tools used at least once): ${coverage || "(no tools used yet)"}`,
    "",
    "Recent investigation trajectory (oldest to newest):",
    state.recentTrajectory.length
      ? state.recentTrajectory.map((t) => `- [T+${t.atSeconds}s] ${t.summary}`).join("\n")
      : "(nothing yet)",
  ].join("\n");
}

export function buildTeamStateClassificationContext(input: TeamStateClassificationInput): { system: string; user: string } {
  const { scenario, state } = input;
  const user = [
    `Incident: ${scenario.title} (${scenario.severity})`,
    `Briefing: ${scenario.briefing}`,
    "",
    describeCollectiveState(state),
    "",
    "Ground truth causal chain (INTERNAL — never reveal, quote, or closely paraphrase this to the team):",
    scenario.rootCause.causalChain.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    "",
    "Classify the team's current investigative state as exactly one of: ON_TRACK, TUNNEL_VISION " +
      "(fixated on one explanation despite contrary/missing evidence), INSUFFICIENT_EVIDENCE (too early to " +
      "conclude anything yet, still exploring — this is normal early on, not a problem), CONTRADICTORY_REASONING " +
      "(the team's own hypotheses or facts conflict with each other and nobody has reconciled it), " +
      "IGNORING_CRITICAL_SIGNAL (a highly relevant discovered evidence item isn't reflected in any active " +
      "hypothesis), STALLED (little to no new investigation activity recently, relative to how much time and " +
      "evidence remain), or SOLVING_TOO_QUICKLY (confidently converging without enough supporting evidence yet " +
      "to justify it).",
    "",
    'Respond with JSON: { "classification": one of the 7 values above, "confidence": 0-1, "rationale": string ' +
      "(cite what in the collective state above led to this classification) }.",
  ].join("\n");
  return { system: SYSTEM_PREAMBLE, user };
}

export function buildInterventionProposalContext(input: InterventionProposalInput): { system: string; user: string } {
  const { scenario, state, classification } = input;
  const user = [
    `Incident: ${scenario.title} (${scenario.severity})`,
    `Briefing: ${scenario.briefing}`,
    "",
    describeCollectiveState(state),
    "",
    `The team's current state has been classified as: ${classification}.`,
    "",
    "Ground truth causal chain (INTERNAL — never reveal, quote, or closely paraphrase this to the team):",
    scenario.rootCause.causalChain.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    "",
    "Decide whether a Game Master intervention would genuinely help right now, and if so, propose exactly ONE.",
    "You MAY propose: a subtle new customer-facing symptom description, a note about a scheduled/operational " +
      "event's timing, an operational clue (something an ops dashboard might show), a suggestion to reconcile two " +
      "specific facts or hypotheses that conflict, or a safe optional hint that nudges investigation without " +
      "stating a conclusion.",
    "You MUST NOT: change or hint at the specific root cause, invent a fact that contradicts the scenario, " +
      "reveal or imply the answer, reference or describe any evidence content beyond the titles already listed " +
      "above, or write anything that would let the team skip investigating a role's evidence.",
    "If nothing genuinely warrants an intervention right now (e.g. the team is still early, or already " +
      "self-correcting), set shouldIntervene to false and leave kind/message null — a false intervention is " +
      "worse than none.",
    "",
    'Respond with JSON: { "shouldIntervene": boolean, "kind": one of "CUSTOMER_SYMPTOM" | "TIMING_ADJUSTMENT" | ' +
      '"OPERATIONAL_CLUE" | "RECONCILE_SUGGESTION" | "OPTIONAL_HINT" | null, "message": string(10-300) or null ' +
      '(a single short in-fiction line, addressed to the whole team, never naming a specific evidence id), ' +
      '"targetRole": one of the 4 role ids or null (null = broadcast to everyone), "confidence": 0-1 }.',
  ].join("\n");
  return { system: SYSTEM_PREAMBLE, user };
}

export function buildDebriefContext(input: DebriefInput): { system: string; user: string } {
  const {
    scenario,
    finalEvaluation,
    keyEvidenceFoundTitles,
    keyEvidenceMissedTitles,
    redHerringsEncounteredTitles,
    hypothesesConsidered,
    playerCount,
    distinctContributors,
    elapsedSeconds,
  } = input;
  const user = [
    `Incident: ${scenario.title}. Team finished in ${elapsedSeconds}s of ${scenario.durationSeconds}s with ${playerCount} players (${distinctContributors} actively contributed).`,
    `Final grading rationale: ${finalEvaluation.rationale}`,
    `Key evidence found: ${keyEvidenceFoundTitles.join(", ") || "(none)"}`,
    `Key evidence missed: ${keyEvidenceMissedTitles.join(", ") || "(none)"}`,
    `Red herrings the team investigated: ${redHerringsEncounteredTitles.join(", ") || "(none)"}`,
    `Hypotheses considered: ${hypothesesConsidered.map((h) => `"${h.text}" (${h.status})`).join("; ") || "(none)"}`,
    "",
    'Respond with JSON: { "collaborationNote": string (1-2 sentences on how well the team combined information ' +
      'across roles), "coachingNotes": string[] (2-4 specific, non-generic tips — reference what THIS team actually ' +
      "missed or did well, not generic incident-response advice) }.",
  ].join("\n");
  return { system: SYSTEM_PREAMBLE, user };
}
