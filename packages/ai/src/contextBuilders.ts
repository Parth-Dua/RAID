import type { DebriefInput, FinalEvaluationInput, HypothesisEvaluationInput } from "./provider.js";

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
      "the submission correctly identifies BOTH the code-level cause (the N+1-style repeated lookup introduced by " +
      "the deploy) AND the infrastructure-level mechanism (connection pool exhaustion) that turned it into 5xx errors.",
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
