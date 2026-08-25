import { randomUUID } from "node:crypto";
import type { Role } from "@raid/shared";
import { ROLES } from "@raid/shared";
import type {
  AIInvocationMeta,
  AIProvider,
  DebriefInput,
  FinalEvaluationInput,
  HypothesisEvaluationInput,
  InterventionProposalInput,
  ScenarioGenerationInput,
  SemanticReviewInput,
  TeamStateClassificationInput,
} from "./provider.js";
import type {
  DebriefContent,
  FinalEvaluation,
  GeneratedScenario,
  HypothesisEvaluation,
  InterventionProposal,
  SemanticReview,
  TeamStateClassificationResult,
} from "./schemas.js";

/**
 * Deterministic, network-free provider. Used whenever AI_PROVIDER=mock
 * (the default), which is what tests and day-to-day development run
 * against — RAID must be fully playable and testable without spending any
 * DeepSeek credits. The heuristics here are intentionally simple keyword
 * matching, not a re-implementation of language understanding; they exist
 * to make the mock's behavior *plausible* for manual playtesting, not to
 * be a substitute for the real model's judgment.
 */
export class MockAIProvider implements AIProvider {
  async evaluateHypothesis(
    input: HypothesisEvaluationInput,
  ): Promise<{ result: HypothesisEvaluation; meta: AIInvocationMeta }> {
    const start = Date.now();
    const text = input.hypothesisText.toLowerCase();

    const supportiveTerms = input.scenario.scoringHints.causalTerms;
    const redHerringTerms = input.scenario.scoringHints.redHerringTerms;

    const supportiveHits = supportiveTerms.filter((t) => text.includes(t)).length;
    const redHerringHits = redHerringTerms.filter((t) => text.includes(t)).length;

    let result: HypothesisEvaluation;
    if (redHerringHits > 0 && supportiveHits === 0) {
      result = {
        status: "CONTRADICTED",
        rationale:
          "The metrics the team has gathered don't support this direction — check the role-specific tools that " +
          "would confirm or rule this out before pursuing it further.",
      };
    } else if (supportiveHits >= 2) {
      result = {
        status: "SUPPORTED",
        rationale:
          "This is consistent with multiple signals the team has found. Make sure you can account for every " +
          "anomalous reading the team has surfaced, not just the ones that fit this theory, and cite specific " +
          "evidence when you submit a final diagnosis.",
      };
    } else if (supportiveHits === 1) {
      result = {
        status: "PLAUSIBLE",
        rationale:
          "This points in a reasonable direction but isn't fully backed yet — you likely need corroborating " +
          "evidence from another role before this explains the full picture.",
      };
    } else {
      result = {
        status: "WEAK",
        rationale:
          "There isn't much evidence on the board yet connecting this hypothesis to what's actually been observed. " +
          "Consider what each role's tools could confirm or rule out.",
      };
    }

    return { result, meta: mockMeta("evaluateHypothesis", start) };
  }

  async evaluateFinalDiagnosis(
    input: FinalEvaluationInput,
  ): Promise<{ result: FinalEvaluation; meta: AIInvocationMeta }> {
    const start = Date.now();
    const text = (input.rootCause + " " + input.remediation).toLowerCase();

    const { causalTerms, remediationTerms } = input.scenario.scoringHints;
    const hits = causalTerms.filter((t) => text.includes(t)).length;
    const fraction = Math.min(1, hits / 4);

    const citedKeyIds = input.citedEvidenceTitles
      .map((e) => e.id)
      .filter((id) => input.scenario.rootCause.keyEvidenceIds.includes(id));

    const result: FinalEvaluation = {
      rootCauseAccuracy: Math.round(fraction * 40),
      evidenceQuality: Math.round(Math.min(1, citedKeyIds.length / 4) * 20),
      remediationQuality: remediationTerms.some((t) => text.includes(t)) ? 16 : 8,
      rationale:
        fraction >= 0.75
          ? "The submission correctly identifies the scenario's actual causal mechanism."
          : "The submission captures part of the picture but doesn't fully connect the code-level change to the infrastructure-level failure mode.",
      matchedKeyEvidenceIds: citedKeyIds,
    };

    return { result, meta: mockMeta("evaluateFinalDiagnosis", start) };
  }

  /**
   * Deterministic classification ladder, checked in priority order. Not a substitute for the real
   * model's judgment (same caveat as every other mock heuristic here) — it exists so V0.4's
   * adaptive-Game-Master pipeline (classify -> maybe intervene -> deliver) is fully exercisable,
   * deterministically, in tests and free local play.
   */
  async classifyTeamState(
    input: TeamStateClassificationInput,
  ): Promise<{ result: TeamStateClassificationResult; meta: AIInvocationMeta }> {
    const start = Date.now();
    const { scenario, state } = input;
    const progressFraction = state.durationSeconds > 0 ? state.elapsedSeconds / state.durationSeconds : 0;

    let result: TeamStateClassificationResult;
    if (state.recentTrajectory.length === 0 && progressFraction > 0.25) {
      result = {
        classification: "STALLED",
        confidence: 0.75,
        rationale: "No investigation activity has been logged recently despite meaningful time having passed.",
      };
    } else if (state.discoveredEvidence.length < 3) {
      result = {
        classification: "INSUFFICIENT_EVIDENCE",
        confidence: 0.8,
        rationale: "Very little evidence has been discovered yet — normal for early in the investigation.",
      };
    } else if (
      state.challengedHypotheses.length > 0 &&
      state.activeHypotheses.some((h) => state.challengedHypotheses.some((c) => c.text === h.text))
    ) {
      result = {
        classification: "CONTRADICTORY_REASONING",
        confidence: 0.65,
        rationale: "A hypothesis still active on the board has been challenged by a teammate and never reconciled.",
      };
    } else if (
      progressFraction > 0.4 &&
      Object.values(state.subsystemCoverage).filter((f) => (f ?? 0) > 0).length <= 1 &&
      Object.keys(state.subsystemCoverage).length > 1
    ) {
      result = {
        classification: "TUNNEL_VISION",
        confidence: 0.6,
        rationale: "Investigation has stayed within a single subsystem despite meaningful time having passed and other subsystems being available.",
      };
    } else if (
      state.discoveredEvidence.length > 0 &&
      !state.activeHypotheses.some((h) => scenario.scoringHints.causalTerms.some((t) => h.text.toLowerCase().includes(t)))
    ) {
      result = {
        classification: "IGNORING_CRITICAL_SIGNAL",
        confidence: 0.55,
        rationale: "Evidence has been discovered but no active hypothesis appears to engage with it.",
      };
    } else if (
      state.activeHypotheses.some((h) => h.status === "SUPPORTED") &&
      state.discoveredEvidence.length < Math.max(3, Math.ceil(scenario.rootCause.keyEvidenceIds.length / 2))
    ) {
      result = {
        classification: "SOLVING_TOO_QUICKLY",
        confidence: 0.6,
        rationale: "A hypothesis is already marked supported despite the team having gathered less than half the scenario's key evidence.",
      };
    } else {
      result = {
        classification: "ON_TRACK",
        confidence: 0.7,
        rationale: "The team is actively investigating, evidence is accumulating, and hypotheses on the board are reasonably well-supported.",
      };
    }

    return { result, meta: mockMeta("classifyTeamState", start) };
  }

  /**
   * Only ON_TRACK/SOLVING_TOO_QUICKLY are treated as "nothing to fix"; the other 5 classifications
   * get a templated, kind-appropriate nudge. Messages never reference specific evidence content —
   * only evidence titles ever reach this provider (see collectiveState.ts), so there is nothing to
   * leak even if the mock tried.
   */
  async proposeIntervention(input: InterventionProposalInput): Promise<{ result: InterventionProposal; meta: AIInvocationMeta }> {
    const start = Date.now();
    const { state, classification } = input;

    let result: InterventionProposal;
    switch (classification) {
      case "TUNNEL_VISION": {
        const leastCovered = (Object.entries(state.subsystemCoverage) as [Role, number][]).sort((a, b) => a[1] - b[1])[0];
        result = {
          shouldIntervene: true,
          kind: "OPERATIONAL_CLUE",
          message: "Ops note: incidents like this usually touch more than one part of the stack — has every role's tooling been checked yet?",
          targetRole: leastCovered ? leastCovered[0] : null,
          confidence: 0.65,
        };
        break;
      }
      case "CONTRADICTORY_REASONING":
        result = {
          shouldIntervene: true,
          kind: "RECONCILE_SUGGESTION",
          message: "Two things the team has found don't fully agree with each other yet — worth reconciling before committing to a direction.",
          targetRole: null,
          confidence: 0.6,
        };
        break;
      case "IGNORING_CRITICAL_SIGNAL":
        result = {
          shouldIntervene: true,
          kind: "OPTIONAL_HINT",
          message: "One of the readings already on the board might matter more than it first looked — worth a second look.",
          targetRole: null,
          confidence: 0.55,
        };
        break;
      case "STALLED":
        result = {
          shouldIntervene: true,
          kind: "CUSTOMER_SYMPTOM",
          message: "Support just flagged a fresh customer report on this incident — might be worth revisiting what's changed recently.",
          targetRole: null,
          confidence: 0.6,
        };
        break;
      default:
        result = { shouldIntervene: false, kind: null, message: null, targetRole: null, confidence: 0.9 };
    }

    return { result, meta: mockMeta("proposeIntervention", start) };
  }

  /**
   * Deterministic, always-structurally-valid scenario generator (V0.5.5's "mock mode"). Not an
   * attempt at real language generation — it's a fixed, parameterized template (4 tools/evidence
   * per investigative role, 2 for IC, a 4-step causal chain, red herrings, a materializable
   * fractional timeline) with a handful of keywords lifted from the free-text `description` slotted
   * in, so different requests produce visibly different (but always valid) candidates. This is what
   * makes the full generate -> validate -> review -> save pipeline exercisable, deterministically,
   * in every automated test without a live call.
   */
  async generateScenario(input: ScenarioGenerationInput): Promise<{ result: GeneratedScenario; meta: AIInvocationMeta }> {
    const start = Date.now();
    const result = buildMockGeneratedScenario(input.description);
    return { result, meta: mockMeta("generateScenario", start) };
  }

  /** The mock generator always produces a coherent, non-leaking candidate by construction (it never
   * has "real" language-model creativity to go wrong), so this always passes - it exists so the
   * review step itself is exercised in tests without needing a live call, not to simulate a model
   * finding real design problems. */
  async semanticReviewScenario(_input: SemanticReviewInput): Promise<{ result: SemanticReview; meta: AIInvocationMeta }> {
    const start = Date.now();
    const result: SemanticReview = { passed: true, issues: [] };
    return { result, meta: mockMeta("semanticReviewScenario", start) };
  }

  async generateDebrief(input: DebriefInput): Promise<{ result: DebriefContent; meta: AIInvocationMeta }> {
    const start = Date.now();
    const result: DebriefContent = {
      collaborationNote:
        input.distinctContributors >= Math.max(2, input.playerCount - 1)
          ? "Most of the team actively contributed evidence and hypotheses — that spread of investigation is what made the diagnosis possible."
          : "Investigation leaned heavily on a subset of the team; wider participation tends to surface evidence faster.",
      coachingNotes: [
        input.keyEvidenceMissedTitles.length > 0
          ? `Next time, prioritize checking: ${input.keyEvidenceMissedTitles.slice(0, 3).join(", ")}.`
          : "The team found all of the key evidence — strong investigation coverage.",
        input.redHerringsEncounteredTitles.length > 0
          ? `Time was spent ruling out ${input.redHerringsEncounteredTitles.slice(0, 2).join(", ")}; confirming/denying leads quickly with a specific tool call keeps the team moving.`
          : "The team didn't get pulled into major red herrings — good filtering of hypotheses.",
        "Cross-role callouts in chat as soon as a metric looks abnormal tend to shorten time-to-diagnosis more than solo digging.",
      ],
    };
    return { result, meta: mockMeta("generateDebrief", start) };
  }
}

function mockMeta(operation: AIInvocationMeta["operation"], start: number): AIInvocationMeta {
  return {
    requestId: randomUUID(),
    operation,
    latencyMs: Date.now() - start,
    provider: "mock",
    success: true,
    usedFallback: false,
  };
}

const GENERATION_STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "to", "for", "with", "by", "is", "was", "are", "that", "this",
  "causing", "cause", "caused", "broken", "incident", "create", "creates", "intermediate", "advanced",
  "beginner", "difficulty", "and", "or", "due", "from",
]);

function slugify(text: string, maxLen = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "generated-incident";
}

function extractKeywords(description: string, max = 6): string[] {
  const words = description.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const filtered = words.filter((w) => w.length > 3 && !GENERATION_STOPWORDS.has(w));
  const unique = [...new Set(filtered)];
  const picked = unique.slice(0, max);
  // Guarantee at least 2 keywords even for a very short/generic description, so downstream text
  // generation (which assumes keywords[0]/keywords[1] exist) never has to special-case an empty list.
  while (picked.length < 2) picked.push(["service", "dependency", "component"][picked.length] ?? "system");
  return picked;
}

const GENERATION_ROLE_LABELS: Record<Role, string> = {
  backend_engineer: "Backend Engineer",
  database_engineer: "Database Engineer",
  sre: "SRE",
  incident_commander: "Incident Commander",
};

/** Builds one investigative role's tools/evidence for the mock generator template. Returns the key
 * evidence id for that role so the caller can assemble `rootCause.keyEvidenceIds` spanning all 3
 * investigative roles (satisfying the same "no single role can solve it alone" bar every
 * hand-authored scenario meets). */
function buildMockRoleContent(
  role: Role,
  keyword: string,
  redHerringKeyword: string,
): { tools: GeneratedScenario["tools"]; evidence: GeneratedScenario["evidence"]; keyEvidenceId: string } {
  const label = GENERATION_ROLE_LABELS[role];
  const prefix = role.slice(0, 3);
  const isIC = role === "incident_commander";
  const toolCount = isIC ? 2 : 4;

  const tools: GeneratedScenario["tools"] = Array.from({ length: toolCount }, (_, i) => ({
    id: `${prefix}_tool_${i}`,
    role,
    name: `${label} Tool ${i + 1}`,
    description: `Inspect ${label.toLowerCase()}-side signals related to ${keyword}.`,
    resultSummary: `${label} diagnostic output.`,
    baselineOutput: "Nothing unusual yet.",
  }));

  const evidence: GeneratedScenario["evidence"] = tools.map((tool, i) => {
    const isRedHerring = !isIC && i === toolCount - 1;
    return {
      id: `${prefix}_ev_${i}`,
      visibleToRoles: [role],
      title: isRedHerring ? `${label}: ${redHerringKeyword} check (ruled out)` : `${label}: ${keyword} signal ${i + 1}`,
      category: (["log", "metric", "trace", "deployment"] as const)[i % 4]!,
      content: isRedHerring
        ? `${label} confirms ${redHerringKeyword}-related systems are nominal - this is not the cause.`
        : `${label} observes an anomaly consistent with ${keyword} affecting this incident.`,
      unlock: i === 0 ? { toolId: tool.id } : { toolId: tool.id, atFraction: Math.min(0.9, 0.1 * i) },
      isRedHerring,
      isKeyEvidence: !isIC && i === 0,
    };
  });

  return { tools, evidence, keyEvidenceId: evidence[0]!.id };
}

function buildMockGeneratedScenario(description: string): GeneratedScenario {
  const keywords = extractKeywords(description);
  const [primary, secondary] = keywords as [string, string];
  const title = `${primary[0]!.toUpperCase()}${primary.slice(1)} ${secondary} Incident`.slice(0, 90);
  const id = slugify(`${primary}-${secondary}-incident`);

  const investigativeRoles = ROLES.filter((r) => r !== "incident_commander");
  const roleContents = investigativeRoles.map((role, i) =>
    buildMockRoleContent(role, keywords[i % keywords.length]!, keywords[(i + 1) % keywords.length]!),
  );
  const icContent = buildMockRoleContent("incident_commander", primary, secondary);

  const allTools = [...roleContents.flatMap((r) => r.tools), ...icContent.tools];
  const allEvidence = [...roleContents.flatMap((r) => r.evidence), ...icContent.evidence];
  const keyEvidenceIds = roleContents.map((r) => r.keyEvidenceId);

  return {
    id,
    title,
    severity: "SEV-2",
    briefing: `Based on the request "${description.slice(0, 300)}", ${primary} appears to be degrading, with symptoms related to ${secondary} spreading across the system. Find the root cause and propose a remediation before the incident window closes.`,
    tools: allTools,
    evidence: allEvidence,
    timeline: [
      { atFraction: 0, headline: `First signs of ${primary} degradation appear` },
      { atFraction: 0.25, headline: `${secondary}-related symptoms become visible to users` },
      { atFraction: 0.55, headline: "Impact widens across the affected system" },
      { atFraction: 0.8, headline: "Support tickets escalate" },
    ],
    rootCause: {
      summary: `A change related to ${primary} introduced a defect that, combined with ${secondary}, produced the observed incident. Each investigative role's evidence captures one part of the mechanism; no single role's evidence alone fully explains it.`,
      causalChain: [
        `A change related to ${primary} was introduced`,
        `This altered how the system handles ${secondary} under normal load`,
        `The altered behavior compounds over time, degrading the affected component`,
        `The degradation surfaces to users as the incident's reported symptoms`,
      ],
      remediation: `Revert or fix the ${primary} change, address the ${secondary} handling defect directly, and add monitoring that would have caught this earlier.`,
      keyEvidenceIds,
    },
    plausibleWrongHypotheses: [
      `A sudden traffic spike is responsible (ruled out by the SRE's request-rate evidence).`,
      `An unrelated third-party dependency is failing (ruled out by the backend engineer's dependency-health evidence).`,
    ],
    rubricWeights: { rootCauseAccuracy: 40, evidenceQuality: 20, remediationQuality: 20, efficiency: 10, collaboration: 10 },
    scoringHints: {
      causalTerms: [primary, secondary, `${primary} ${secondary}`],
      redHerringTerms: ["traffic spike", "third-party dependency", "network"],
      remediationTerms: ["revert", "fix", "monitoring"],
      distinctiveTerms: [`${primary} defect`, `${secondary} handling`],
    },
  };
}
