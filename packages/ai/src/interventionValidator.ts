import type { ScenarioDefinition } from "@raid/shared";
import type { InterventionProposal } from "./schemas.js";
import { containsRootCauseLeak } from "./leakGuard.js";

export interface InterventionValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Backend validation of an AI-proposed intervention (V0.4.3), run unconditionally before any
 * intervention is delivered to players — the AI's own instructions are a request, not a guarantee.
 * This is defense-in-depth on top of `InterventionProposalSchema`'s shape validation: it checks
 * the *content* is actually safe, not just well-formed.
 *
 * What this structurally guarantees, by construction, regardless of what the model returns:
 *  - Never changes the root cause / fabricates contradicting facts: an intervention is never
 *    merged into scenario or game state — the caller only ever turns a validated proposal into a
 *    read-only chat message (gameMasterService.ts), so there is nothing here to mutate even if the
 *    model tried.
 *  - Never reveals the answer: `containsRootCauseLeak` (the same check DeepSeekProvider runs on
 *    hypothesis rationales) is run against the proposed message.
 *  - Never exposes private role evidence: the model was never given evidence content in the first
 *    place (only titles — see collectiveState.ts), and this validator additionally rejects a
 *    message that references a real evidence id verbatim, closing off id-smuggling.
 *  - Never mutates score or bypasses the game engine: not possible by construction — see above.
 */
export function validateIntervention(proposal: InterventionProposal, scenario: ScenarioDefinition): InterventionValidationResult {
  if (!proposal.shouldIntervene) return { valid: true };

  if (!proposal.kind || !proposal.message) {
    return { valid: false, reason: "shouldIntervene is true but kind/message is missing" };
  }

  if (containsRootCauseLeak(proposal.message, scenario)) {
    return { valid: false, reason: "message appears to leak the root cause" };
  }

  if (proposal.targetRole && !scenario.tools.some((t) => t.role === proposal.targetRole)) {
    return { valid: false, reason: `targetRole "${proposal.targetRole}" has no tools in this scenario` };
  }

  const mentionsRawEvidenceId = scenario.evidence.some((e) => proposal.message!.includes(e.id));
  if (mentionsRawEvidenceId) {
    return { valid: false, reason: "message references an internal evidence id verbatim" };
  }

  const mentionsRawToolId = scenario.tools.some((t) => proposal.message!.includes(t.id));
  if (mentionsRawToolId) {
    return { valid: false, reason: "message references an internal tool id verbatim" };
  }

  return { valid: true };
}
