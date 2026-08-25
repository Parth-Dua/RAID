import type { ScenarioDefinition } from "@raid/shared";

const CONFIRMATORY_PHRASES = [
  "that's correct",
  "that is correct",
  "you are correct",
  "you're correct",
  "the root cause is",
  "confirmed root cause",
  "this is the root cause",
  "you have solved it",
  "you've solved it",
  "you got it",
  "correct diagnosis",
];

/**
 * Mid-game hypothesis feedback must never confirm or leak the answer outright
 * (spec section 29/14). This is a defense-in-depth heuristic check run on
 * every hypothesis-evaluation response before it is accepted — it does not
 * replace prompt-level instructions, it backstops them.
 */
export function containsRootCauseLeak(rationale: string, scenario: ScenarioDefinition): boolean {
  const lower = rationale.toLowerCase();

  for (const phrase of CONFIRMATORY_PHRASES) {
    if (lower.includes(phrase)) return true;
  }

  const summarySnippet = scenario.rootCause.summary.toLowerCase().slice(0, 60);
  if (summarySnippet.length > 20 && lower.includes(summarySnippet)) return true;

  // Catch a rationale that strings together several of the causal-chain's
  // distinguishing terms verbatim — a single shared term (e.g. "checkout")
  // is expected and fine, but reciting the mechanism is a leak. Reads each
  // scenario's authored `scoringHints.distinctiveTerms` (see domain.ts) so
  // this check is scenario-specific by data, not a hardcoded term list tied
  // to one scenario — every scenario gets equal leak protection.
  const distinctiveTerms = scenario.scoringHints.distinctiveTerms;
  const hits = distinctiveTerms.filter((t) => lower.includes(t)).length;
  if (hits >= 2) return true;

  return false;
}
