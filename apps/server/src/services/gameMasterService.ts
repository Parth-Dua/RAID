import type { ChatMessage, TeamStateClassification } from "@raid/shared";
import { validateIntervention } from "@raid/ai";
import type { Database } from "../db/client.js";
import { aiProvider } from "./aiService.js";
import { loadActiveGame } from "./gameLoader.js";
import { buildCollectiveStateForGame, deliverInterventionChatMessage } from "./gameService.js";
import * as interventionsRepo from "../repositories/interventionsRepo.js";
import { logger } from "../logger.js";

/**
 * V0.4 adaptive Game Master budget/policy. Deliberately conservative and hardcoded rather than
 * per-scenario/per-difficulty tunable at MVP scope (V0.4.4): a fixed small cap, a fixed cooldown,
 * and a minimum confidence floor below which a proposal is discarded rather than delivered.
 */
const MAX_INTERVENTIONS_PER_GAME = 3;
const INTERVENTION_COOLDOWN_SECONDS = 60;
const MIN_CONFIDENCE_TO_DELIVER = 0.5;

/** Only these classifications describe something actually worth nudging. ON_TRACK and
 * SOLVING_TOO_QUICKLY never trigger an intervention; INSUFFICIENT_EVIDENCE is expected early-game
 * behavior, not a problem to correct. Skipping proposeIntervention entirely for ineligible
 * classifications also saves an AI call (mock or live) that would only ever come back declined. */
const INTERVENTION_ELIGIBLE_CLASSIFICATIONS: ReadonlySet<TeamStateClassification> = new Set([
  "TUNNEL_VISION",
  "CONTRADICTORY_REASONING",
  "IGNORING_CRITICAL_SIGNAL",
  "STALLED",
]);

export interface GameMasterCheckOutcome {
  classification: TeamStateClassification;
  intervened: boolean;
  reason: string;
  chatMessage?: ChatMessage;
}

/**
 * The full classify -> (maybe) propose -> validate -> budget-gate -> deliver pipeline for one
 * game, at one point in time. Called periodically from the game clock (see sockets/clock.ts) at a
 * coarse cadence — never on every tick. Read-only except for the two writes an actual delivered
 * intervention causes: one `game_interventions` row (budget/history) and one chat message (the
 * only way an intervention is ever visible to players). Every other outcome is a pure decision
 * with no side effects.
 */
export async function runGameMasterCheck(db: Database, gameId: string): Promise<GameMasterCheckOutcome> {
  const { roomRow, scenario } = await loadActiveGame(db, gameId);
  if (roomRow.phase !== "ACTIVE") {
    return { classification: "ON_TRACK", intervened: false, reason: "game is not ACTIVE" };
  }

  const { state, elapsedSeconds } = await buildCollectiveStateForGame(db, gameId);
  const { result: classificationResult } = await aiProvider.classifyTeamState({ scenario, state });
  const classification = classificationResult.classification;

  if (!INTERVENTION_ELIGIBLE_CLASSIFICATIONS.has(classification)) {
    return { classification, intervened: false, reason: "classification is not intervention-eligible" };
  }

  const deliveredCount = await interventionsRepo.countInterventionsForGame(db, gameId);
  if (deliveredCount >= MAX_INTERVENTIONS_PER_GAME) {
    return { classification, intervened: false, reason: "intervention budget exhausted for this game" };
  }

  const last = await interventionsRepo.findLastInterventionForGame(db, gameId);
  if (last && elapsedSeconds - last.elapsedSeconds < INTERVENTION_COOLDOWN_SECONDS) {
    return { classification, intervened: false, reason: "cooldown still active since the last intervention" };
  }

  const { result: proposal } = await aiProvider.proposeIntervention({ scenario, state, classification });
  if (!proposal.shouldIntervene) {
    return { classification, intervened: false, reason: "AI declined to intervene" };
  }

  const validation = validateIntervention(proposal, scenario);
  if (!validation.valid) {
    logger.warn({ gameId, classification, reason: validation.reason }, "AI intervention proposal failed backend validation, discarding");
    return { classification, intervened: false, reason: `failed backend validation: ${validation.reason}` };
  }

  if (proposal.confidence < MIN_CONFIDENCE_TO_DELIVER) {
    return { classification, intervened: false, reason: "confidence below the minimum delivery threshold" };
  }

  await interventionsRepo.insertIntervention(db, {
    gameId,
    classification,
    kind: proposal.kind!,
    message: proposal.message!,
    targetRole: proposal.targetRole,
    confidence: proposal.confidence,
    elapsedSeconds,
  });

  const chatMessage = await deliverInterventionChatMessage(db, gameId, proposal.message!);
  return { classification, intervened: true, reason: "delivered", chatMessage: chatMessage ?? undefined };
}
