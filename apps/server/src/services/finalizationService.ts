import { assembleFinalScore, assertTransition, computeCollaborationScore, computeEfficiencyScore } from "@raid/game-engine";
import type { Debrief, FinalSubmissionInput, Role, RoleContribution, ScenarioDefinition } from "@raid/shared";
import type { Database } from "../db/client.js";
import { RaidError } from "../domain/errors.js";
import * as roomsRepo from "../repositories/roomsRepo.js";
import * as playersRepo from "../repositories/playersRepo.js";
import * as gamesRepo from "../repositories/gamesRepo.js";
import * as contentRepo from "../repositories/gameContentRepo.js";
import * as hypothesesRepo from "../repositories/hypothesesRepo.js";
import * as finalRepo from "../repositories/finalRepo.js";
import { appendEvent } from "../repositories/eventsRepo.js";
import { aiProvider } from "./aiService.js";
import { loadActiveGame } from "./gameLoader.js";
import { logger } from "../logger.js";

export interface FinalizeOutcome {
  debrief: Debrief;
  alreadyFinalized: boolean;
}

/**
 * Handles BOTH real player submissions and timer-driven auto-finalization
 * (submission === null). Concurrency guard, in order:
 *  1. optimistic room-phase transition ACTIVE -> FINALIZING (rooms.version)
 *  2. unique(final_submissions.game_id)
 * Together these make "two players submit simultaneously" and "timer
 * expires during final submission" resolve to exactly one finalization,
 * never zero and never two. See docs/DECISIONS.md concurrency ADR.
 */
export async function finalizeGame(
  db: Database,
  gameId: string,
  submission: { playerId: string; input: FinalSubmissionInput; clientMsgId: string } | null,
): Promise<FinalizeOutcome> {
  const { gameRow, roomRow, scenario, elapsedSeconds } = await loadActiveGame(db, gameId);

  if (roomRow.phase === "COMPLETED") {
    const existing = await finalRepo.findGameResultByGame(db, gameId);
    if (existing) return { debrief: existing.debrief as Debrief, alreadyFinalized: true };
  }
  if (roomRow.phase !== "ACTIVE") {
    throw new RaidError("INVALID_PHASE", "The incident is not currently active");
  }

  if (submission) {
    const gamePlayers = await gamesRepo.findGamePlayers(db, gameId);
    const ic = gamePlayers.find((gp) => gp.role === "incident_commander");
    // With an IC assigned (4-player games), only the IC may submit the final diagnosis -
    // that authority is the point of the role. In a 3-player game (no IC), any assigned
    // player may submit since the team has no dedicated coordinator.
    if (ic && ic.playerId !== submission.playerId) {
      throw new RaidError("NOT_AUTHORIZED", "Only the Incident Commander can submit the final diagnosis");
    }
    if (!gamePlayers.some((gp) => gp.playerId === submission.playerId)) {
      throw new RaidError("NOT_AUTHORIZED", "You are not part of this game");
    }
  }

  assertTransition("ACTIVE", "FINALIZING");
  const finalizingRoom = await roomsRepo.tryTransitionRoomPhase(db, roomRow.id, "ACTIVE", roomRow.version, "FINALIZING");
  if (!finalizingRoom) {
    // Someone else (another submission, or the timer) already moved the game past ACTIVE.
    const existing = await finalRepo.findGameResultByGame(db, gameId);
    if (existing) return { debrief: existing.debrief as Debrief, alreadyFinalized: true };
    throw new RaidError("ALREADY_STARTED", "Final diagnosis is already being evaluated");
  }

  if (submission) {
    const inserted = await finalRepo.insertFinalSubmission(db, {
      gameId,
      submittedBy: submission.playerId,
      rootCause: submission.input.rootCause,
      supportingEvidenceIds: submission.input.supportingEvidenceIds,
      remediation: submission.input.remediation,
      clientMsgId: submission.clientMsgId,
    });
    if (!inserted) {
      logger.warn({ gameId }, "final submission unique-constraint race: a submission already existed");
    } else {
      await appendEvent(db, {
        roomId: roomRow.id,
        gameId,
        type: "FINAL_SUBMITTED",
        payload: { submissionId: inserted.id },
        actorPlayerId: submission.playerId,
      });
    }
  }

  const debrief = await evaluateAndBuildDebrief(db, gameId, roomRow.id, scenario, elapsedSeconds, submission?.input ?? null);

  await finalRepo.insertGameResult(db, {
    gameId,
    rootCauseAccuracy: debrief.score.rootCauseAccuracy,
    evidenceQuality: debrief.score.evidenceQuality,
    remediationQuality: debrief.score.remediationQuality,
    efficiency: debrief.score.efficiency,
    collaboration: debrief.score.collaboration,
    total: debrief.score.total,
    debrief,
  });

  assertTransition("FINALIZING", "COMPLETED");
  await roomsRepo.tryTransitionRoomPhase(db, roomRow.id, "FINALIZING", finalizingRoom.version, "COMPLETED");
  await appendEvent(db, { roomId: roomRow.id, gameId, type: "GAME_COMPLETED", payload: { total: debrief.score.total } });

  return { debrief, alreadyFinalized: false };
}

async function evaluateAndBuildDebrief(
  db: Database,
  gameId: string,
  roomId: string,
  scenario: ScenarioDefinition,
  elapsedSeconds: number,
  input: FinalSubmissionInput | null,
): Promise<Debrief> {
  const unlockedIds = await contentRepo.findUnlockedEvidenceIds(db, gameId);
  const citedEvidenceTitles = (input?.supportingEvidenceIds ?? [])
    .map((id) => scenario.evidence.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => ({ id: e.id, title: e.title }));

  const { result: finalEval } = await aiProvider.evaluateFinalDiagnosis({
    scenario,
    rootCause: input?.rootCause ?? "(no diagnosis submitted before time ran out)",
    remediation: input?.remediation ?? "(none submitted)",
    citedEvidenceTitles,
    elapsedSeconds,
  });
  const rootCauseAccuracy = input ? finalEval.rootCauseAccuracy : 0;
  const evidenceQuality = input ? finalEval.evidenceQuality : 0;
  const remediationQuality = input ? finalEval.remediationQuality : 0;

  const gamePlayers = await gamesRepo.findGamePlayers(db, gameId);
  const playerCount = gamePlayers.length;
  const toolExecutorIds = await contentRepo.findDistinctToolExecutorIds(db, gameId);
  const hypothesesRows = await hypothesesRepo.findHypothesesForGame(db, gameId);
  const reactions = await hypothesesRepo.findReactionsForGame(db, gameId);
  const knownFacts = await contentRepo.findKnownFacts(db, gameId);
  const chat = await contentRepo.findChatMessages(db, gameId);

  const supporterCounts = new Map<string, number>();
  for (const r of reactions) {
    if (r.kind !== "support") continue;
    supporterCounts.set(r.hypothesisId, (supporterCounts.get(r.hypothesisId) ?? 0) + 1);
  }
  const hypothesesWithMultipleSupporters = [...supporterCounts.values()].filter((c) => c >= 2).length;

  const contributorIds = new Set<string>([
    ...toolExecutorIds,
    ...chat.filter((c) => c.authorId).map((c) => c.authorId as string),
    ...hypothesesRows.map((h) => h.authorId),
    ...knownFacts.map((f) => f.addedBy),
  ]);
  const distinctContributors = contributorIds.size;

  const efficiency = assembleClampable(() =>
    computeEfficiencyScore({ scenario, elapsedSeconds, playerCount, distinctToolExecutions: toolExecutorIds.length }),
  );
  const collaboration = assembleClampable(() =>
    computeCollaborationScore({
      scenario,
      playerCount,
      distinctContributors,
      hypothesesWithMultipleSupporters,
      totalHypotheses: hypothesesRows.length,
    }),
  );

  const score = assembleFinalScore(scenario.rubricWeights, {
    rootCauseAccuracy,
    evidenceQuality,
    remediationQuality,
    efficiency,
    collaboration,
  });

  const keyEvidenceFound = scenario.rootCause.keyEvidenceIds.filter((id) => unlockedIds.has(id));
  const keyEvidenceMissed = scenario.rootCause.keyEvidenceIds.filter((id) => !unlockedIds.has(id));
  const redHerringsEncountered = scenario.evidence.filter((e) => e.isRedHerring && unlockedIds.has(e.id)).map((e) => e.id);

  const titleOf = (id: string) => scenario.evidence.find((e) => e.id === id)?.title ?? id;

  const { result: debriefContent } = await aiProvider.generateDebrief({
    scenario,
    finalEvaluation: finalEval,
    keyEvidenceFoundTitles: keyEvidenceFound.map(titleOf),
    keyEvidenceMissedTitles: keyEvidenceMissed.map(titleOf),
    redHerringsEncounteredTitles: redHerringsEncountered.map(titleOf),
    hypothesesConsidered: hypothesesRows.map((h) => ({ text: h.text, status: h.status })),
    playerCount,
    distinctContributors,
    elapsedSeconds,
  });

  const roleContributions = await buildRoleContributions(db, roomId, gameId, gamePlayers, hypothesesRows, knownFacts);

  return {
    score,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    severity: scenario.severity,
    difficulty: scenario.difficulty,
    completionSeconds: elapsedSeconds,
    rootCauseSummary: scenario.rootCause.summary,
    expectedRemediation: scenario.rootCause.remediation,
    timeline: scenario.timeline,
    keyEvidenceFound: keyEvidenceFound.map(titleOf),
    keyEvidenceMissed: keyEvidenceMissed.map(titleOf),
    redHerringsEncountered: redHerringsEncountered.map(titleOf),
    hypothesesConsidered: hypothesesRows.map((h) => ({ text: h.text, status: h.status as Debrief["hypothesesConsidered"][number]["status"] })),
    collaborationNote: debriefContent.collaborationNote,
    coachingNotes: debriefContent.coachingNotes,
    roleContributions,
  };
}

/** V0.6.1: real per-player contribution counts, computed entirely from recorded actions
 * (tool_actions, game_evidence, hypotheses, known_facts) - never estimated. */
async function buildRoleContributions(
  db: Database,
  roomId: string,
  gameId: string,
  gamePlayers: { playerId: string; role: string }[],
  hypothesesRows: { authorId: string }[],
  knownFactRows: { addedBy: string }[],
): Promise<RoleContribution[]> {
  const playersInRoom = await playersRepo.findPlayersInRoom(db, roomId);
  const nameById = new Map(playersInRoom.map((p) => [p.id, p.displayName]));

  const toolActionRows = await contentRepo.findToolActionsForGame(db, gameId);
  const toolCountByPlayer = new Map<string, number>();
  for (const row of toolActionRows) toolCountByPlayer.set(row.playerId, (toolCountByPlayer.get(row.playerId) ?? 0) + 1);

  const evidenceRows = await contentRepo.findUnlockedEvidenceRows(db, gameId);
  const evidenceCountByPlayer = new Map<string, number>();
  for (const row of evidenceRows) {
    if (!row.unlockedByPlayerId) continue;
    evidenceCountByPlayer.set(row.unlockedByPlayerId, (evidenceCountByPlayer.get(row.unlockedByPlayerId) ?? 0) + 1);
  }

  const hypothesisCountByPlayer = new Map<string, number>();
  for (const h of hypothesesRows) hypothesisCountByPlayer.set(h.authorId, (hypothesisCountByPlayer.get(h.authorId) ?? 0) + 1);

  const factCountByPlayer = new Map<string, number>();
  for (const f of knownFactRows) factCountByPlayer.set(f.addedBy, (factCountByPlayer.get(f.addedBy) ?? 0) + 1);

  return gamePlayers.map((gp) => ({
    playerId: gp.playerId,
    displayName: nameById.get(gp.playerId) ?? "Unknown",
    role: gp.role as Role,
    toolsExecuted: toolCountByPlayer.get(gp.playerId) ?? 0,
    evidenceUnlocked: evidenceCountByPlayer.get(gp.playerId) ?? 0,
    hypothesesProposed: hypothesisCountByPlayer.get(gp.playerId) ?? 0,
    knownFactsAdded: factCountByPlayer.get(gp.playerId) ?? 0,
  }));
}

function assembleClampable(fn: () => number): number {
  try {
    return fn();
  } catch {
    return 0;
  }
}
