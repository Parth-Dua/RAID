import type { CollectiveReasoningState } from "./collectiveState.js";
import type {
  DebriefInput,
  FinalEvaluationInput,
  HypothesisEvaluationInput,
  InterventionProposalInput,
  ScenarioGenerationInput,
  SemanticReviewInput,
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

const SCENARIO_AUTHOR_PREAMBLE =
  "You are a scenario author for RAID, a cooperative incident-response game. You write realistic, " +
  "internally-consistent production-incident scenarios for a 3-4 player team split into up to 4 " +
  "roles (backend_engineer, database_engineer, sre, incident_commander). You respond with strict " +
  "JSON matching the schema described in the user message — no prose outside JSON.";

export function buildScenarioGenerationContext(input: ScenarioGenerationInput): { system: string; user: string } {
  const { description, difficulty } = input;
  const user = [
    `Incident request: "${description}"`,
    difficulty ? `Target difficulty: ${difficulty} (author the scenario itself difficulty-neutral regardless — ` +
      "difficulty is applied separately by the game engine from your `hint` fields and unlock timing; just " +
      "author every evidence item's optional `hint` normally)." : "",
    "",
    "Design requirements, matching the same bar every hand-authored RAID scenario meets:",
    "- Exactly one true root cause with a causal chain of AT LEAST 4 concrete mechanical steps (deploy/config " +
      "change -> intermediate effect -> intermediate effect -> user-facing symptom). No hand-waving steps.",
    "- Each of backend_engineer, database_engineer, and sre needs at least 3-5 tools and at least 3-5 evidence " +
      "items visible only to that role. incident_commander (optional - used only in 4-player games) should get " +
      "1-2 coarse tools/evidence that say WHICH systems look unhealthy, never WHY.",
    "- Key evidence (rootCause.keyEvidenceIds) must span AT LEAST 3 different roles - no single role's evidence " +
      "alone should be enough to confidently diagnose the incident.",
    "- Include 4-6 red herrings (isRedHerring: true): plausible-sounding wrong explanations, each with a " +
      "specific evidence item that actively RULES IT OUT (not just silence on the topic).",
    "- Evidence unlock: most evidence unlocks on a tool being run (unlock.toolId); some of the more revealing " +
      "items should ALSO require a fraction of the incident's duration to have passed (unlock.atFraction, 0-1) " +
      "so the investigation has pacing rather than everything being available from t=0.",
    "- Timeline: 3-6 deterministic story beats (atFraction 0-1, ascending) describing how the incident visibly " +
      "worsens over time, independent of what the players do.",
    "- scoringHints: causalTerms (words/phrases that indicate genuine understanding of the mechanism), " +
      "redHerringTerms (words associated with the wrong explanations), remediationTerms (words indicating the " +
      "correct fix), and distinctiveTerms (2+ SHORT, mutually non-overlapping phrases specific enough that " +
      "using 2 of them together would be reciting the mechanism verbatim - used to detect answer leakage).",
    "- rubricWeights must be exactly {rootCauseAccuracy:40, evidenceQuality:20, remediationQuality:20, " +
      "efficiency:10, collaboration:10}.",
    "- id: a short lowercase-hyphen slug derived from the title (e.g. \"broken-readiness-probe\").",
    "",
    "Respond with JSON matching this exact shape (all fields required unless marked optional):",
    "{",
    '  "id": string, "title": string, "severity": "SEV-1"|"SEV-2"|"SEV-3", "briefing": string,',
    '  "tools": [{ "id": string, "role": "backend_engineer"|"database_engineer"|"sre"|"incident_commander",',
    '             "name": string, "description": string, "resultSummary": string, "baselineOutput"?: string }],',
    '  "evidence": [{ "id": string, "visibleToRoles": [role,...], "title": string,',
    '                "category": "log"|"metric"|"trace"|"deployment"|"chat_note"|"incident_fact",',
    '                "content": string, "hint"?: string,',
    '                "unlock": { "toolId"?: string, "atFraction"?: number }, "isRedHerring": boolean, "isKeyEvidence": boolean }],',
    '  "timeline": [{ "atFraction": number, "headline": string, "detail"?: string }],',
    '  "rootCause": { "summary": string, "causalChain": string[], "remediation": string, "keyEvidenceIds": string[] },',
    '  "plausibleWrongHypotheses": string[],',
    '  "rubricWeights": { "rootCauseAccuracy": 40, "evidenceQuality": 20, "remediationQuality": 20, "efficiency": 10, "collaboration": 10 },',
    '  "scoringHints": { "causalTerms": string[], "redHerringTerms": string[], "remediationTerms": string[], "distinctiveTerms": string[] }',
    "}",
  ]
    .filter(Boolean)
    .join("\n");
  return { system: SCENARIO_AUTHOR_PREAMBLE, user };
}

export function buildSemanticReviewContext(input: SemanticReviewInput): { system: string; user: string } {
  const { candidate } = input;
  const user = [
    `Review this generated scenario candidate for: (title) ${candidate.title}`,
    `Briefing: ${candidate.briefing}`,
    `Root cause: ${candidate.rootCause.summary}`,
    `Causal chain: ${candidate.rootCause.causalChain.join(" -> ")}`,
    `Remediation: ${candidate.rootCause.remediation}`,
    `Evidence titles by role: ${candidate.evidence.map((e) => `${e.visibleToRoles.join("/")}: ${e.title}${e.isRedHerring ? " (red herring)" : ""}`).join("; ")}`,
    `Key evidence ids: ${candidate.rootCause.keyEvidenceIds.join(", ")}`,
    `Plausible wrong hypotheses: ${candidate.plausibleWrongHypotheses.join("; ")}`,
    "",
    "This candidate has ALREADY passed strict structural/schema validation (every id/reference is real, no " +
      "dangling links). Your job is a semantic/design coherence review only, checking:",
    "1. Causal consistency - does the causal chain actually explain the briefing's symptoms, with no logical gaps?",
    "2. Role balance - is there a genuine reason for each investigative role to be involved, not just padding?",
    "3. Answer leakage - does any evidence title/content or the briefing itself give away the root cause outright " +
      "rather than requiring investigation?",
    "4. Red-herring plausibility - are the wrong hypotheses genuinely plausible-sounding, not obviously fake?",
    "5. Remediation validity - does the proposed remediation actually address the stated root cause?",
    "6. Scenario coherence - is this internally consistent, or does something contradict something else?",
    "",
    'Respond with JSON: { "passed": boolean, "issues": string[] (0-10 items; empty if passed is true; each ' +
      "issue should name which of the 6 checks above failed and specifically why, e.g. " +
      '"answer leakage: evidence \'DB Migration Notes\' states the exact root cause in its content") }.',
  ].join("\n");
  return { system: SCENARIO_AUTHOR_PREAMBLE, user };
}
