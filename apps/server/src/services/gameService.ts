import { randomUUID } from "node:crypto";
import { computeToolResult, isToolAuthorizedForRole, toPublicEvidence, visibleEvidenceForRole } from "@raid/game-engine";
import type { ChatMessage, Debrief, GameSnapshot, Hypothesis, KnownFact, Role } from "@raid/shared";
import type { Database } from "../db/client.js";
import { RaidError } from "../domain/errors.js";
import { toChatMessage, toKnownFact } from "../domain/mappers.js";
import * as gamesRepo from "../repositories/gamesRepo.js";
import * as contentRepo from "../repositories/gameContentRepo.js";
import * as hypothesesRepo from "../repositories/hypothesesRepo.js";
import * as finalRepo from "../repositories/finalRepo.js";
import { appendEvent } from "../repositories/eventsRepo.js";
import { aiProvider } from "./aiService.js";
import { loadActiveGame } from "./gameLoader.js";
import { logger } from "../logger.js";

export { loadActiveGame } from "./gameLoader.js";

function requireRole(roleByPlayerId: Map<string, Role>, playerId: string): Role {
  const role = roleByPlayerId.get(playerId);
  if (!role) throw new RaidError("NOT_AUTHORIZED", "You are not assigned a role in this game");
  return role;
}

async function getRoleMap(db: Database, gameId: string): Promise<Map<string, Role>> {
  const gamePlayers = await gamesRepo.findGamePlayers(db, gameId);
  return new Map(gamePlayers.map((gp) => [gp.playerId, gp.role as Role]));
}

export async function buildGameSnapshotForPlayer(db: Database, gameId: string, playerId: string): Promise<GameSnapshot> {
  const { gameRow, roomRow, scenario, elapsedSeconds } = await loadActiveGame(db, gameId);
  const roleMap = await getRoleMap(db, gameId);
  const myRole = roleMap.get(playerId) ?? null;

  const unlockedIds = await contentRepo.findUnlockedEvidenceIds(db, gameId);
  const unlockedEvidenceDefs = scenario.evidence.filter((e) => unlockedIds.has(e.id));
  const visible = myRole ? visibleEvidenceForRole(unlockedEvidenceDefs, myRole) : [];
  const publicEvidence = visible.map((e) => toPublicEvidence(e, elapsedSeconds));

  const knownFactRows = await contentRepo.findKnownFacts(db, gameId);
  const chatRows = await contentRepo.findChatMessages(db, gameId);
  const hypotheses = await loadHypotheses(db, gameId);

  let debrief: Debrief | null = null;
  if (roomRow.phase === "COMPLETED") {
    const result = await finalRepo.findGameResultByGame(db, gameId);
    if (result) debrief = result.debrief as Debrief;
  }

  const snapshot: GameSnapshot = {
    gameId,
    roomId: roomRow.id,
    scenarioId: scenario.id,
    difficulty: scenario.difficulty,
    phase: roomRow.phase as GameSnapshot["phase"],
    serverNowMs: Date.now(),
    startedAtMs: gameRow.startedAt?.getTime() ?? null,
    endsAtMs: gameRow.endsAt?.getTime() ?? null,
    simulationSeconds: elapsedSeconds,
    myRole,
    briefing: scenario.briefing,
    severity: scenario.severity,
    timeline: scenario.timeline.filter((t) => t.atSeconds <= elapsedSeconds),
    tools: myRole ? scenario.tools.filter((t) => t.role === myRole) : [],
    evidence: publicEvidence,
    knownFacts: knownFactRows.map(toKnownFact),
    hypotheses,
    chat: chatRows.map(toChatMessage),
    version: gameRow.startedAt ? gameRow.startedAt.getTime() : 0,
    debrief,
  };
  return snapshot;
}

async function loadHypotheses(db: Database, gameId: string): Promise<Hypothesis[]> {
  const rows = await hypothesesRepo.findHypothesesForGame(db, gameId);
  const reactions = await hypothesesRepo.findReactionsForGame(db, gameId);
  const evidenceLinks = await hypothesesRepo.findEvidenceForGameHypotheses(db, gameId);

  return rows.map((h) => ({
    id: h.id,
    gameId: h.gameId,
    authorId: h.authorId,
    authorName: "", // filled in by caller with a name map when needed for UI; kept out of hot path here
    text: h.text,
    status: h.status as Hypothesis["status"],
    aiRationale: h.aiRationale,
    supportedBy: reactions.filter((r) => r.hypothesisId === h.id && r.kind === "support").map((r) => r.playerId),
    challengedBy: reactions.filter((r) => r.hypothesisId === h.id && r.kind === "challenge").map((r) => r.playerId),
    evidenceIds: evidenceLinks.filter((e) => e.hypothesisId === h.id).map((e) => e.evidenceId),
    createdAt: h.createdAt.toISOString(),
    version: h.version,
  }));
}

// ---------------- Tool execution ----------------

export interface ToolExecutionResult {
  toolId: string;
  output: string;
  unlockedEvidenceIds: string[];
}

export async function executeTool(db: Database, gameId: string, playerId: string, toolId: string): Promise<ToolExecutionResult> {
  const { roomRow, scenario, elapsedSeconds } = await loadActiveGame(db, gameId);
  if (roomRow.phase !== "ACTIVE") throw new RaidError("INVALID_PHASE", "The incident is not active");

  const roleMap = await getRoleMap(db, gameId);
  const role = requireRole(roleMap, playerId);
  if (!isToolAuthorizedForRole(scenario, toolId, role)) {
    throw new RaidError("WRONG_ROLE", "This tool is not available to your role");
  }

  const executedIds = await contentRepo.findExecutedToolIds(db, gameId);
  executedIds.add(toolId);
  const toolResult = computeToolResult(scenario, toolId, executedIds, elapsedSeconds);

  await contentRepo.insertToolAction(db, {
    gameId,
    playerId,
    toolId,
    executedAtSeconds: elapsedSeconds,
    output: toolResult.output,
  });
  const newlyUnlocked = await contentRepo.insertUnlockedEvidence(db, gameId, toolResult.unlockedEvidenceIds, elapsedSeconds, playerId);

  await appendEvent(db, { roomId: roomRow.id, gameId, type: "TOOL_EXECUTED", payload: { toolId, elapsedSeconds }, actorPlayerId: playerId });
  for (const evidenceId of newlyUnlocked) {
    await appendEvent(db, { roomId: roomRow.id, gameId, type: "EVIDENCE_UNLOCKED", payload: { evidenceId, elapsedSeconds }, actorPlayerId: playerId });
  }

  return { toolId, output: toolResult.output, unlockedEvidenceIds: newlyUnlocked };
}

// ---------------- Hypotheses ----------------

export async function createHypothesis(db: Database, gameId: string, playerId: string, text: string, clientMsgId: string) {
  const { roomRow } = await loadActiveGame(db, gameId);
  if (roomRow.phase !== "ACTIVE") throw new RaidError("INVALID_PHASE", "The incident is not active");

  const row = await hypothesesRepo.insertHypothesis(db, { gameId, authorId: playerId, text, clientMsgId });
  if (!row) {
    // duplicate submit (dedup by clientMsgId) - not an error, just return the existing state via caller re-read
    return null;
  }
  await appendEvent(db, { roomId: roomRow.id, gameId, type: "HYPOTHESIS_CREATED", payload: { hypothesisId: row.id }, actorPlayerId: playerId });
  return row;
}

export async function evaluateHypothesisAsync(db: Database, gameId: string, hypothesisId: string): Promise<void> {
  try {
    const { scenario, elapsedSeconds } = await loadActiveGame(db, gameId);
    const hypothesis = await hypothesesRepo.findHypothesisById(db, hypothesisId);
    if (!hypothesis) return;

    const otherRows = await hypothesesRepo.findHypothesesForGame(db, gameId);
    const knownFactRows = await contentRepo.findKnownFacts(db, gameId);

    const { result } = await aiProvider.evaluateHypothesis({
      scenario,
      hypothesisText: hypothesis.text,
      elapsedSeconds,
      otherHypotheses: otherRows.filter((h) => h.id !== hypothesisId).map((h) => h.text),
      knownFacts: knownFactRows.map((f) => f.text),
    });

    const updated = await hypothesesRepo.applyHypothesisEvaluation(db, hypothesisId, hypothesis.version, result.status, result.rationale);
    if (!updated) {
      logger.info({ hypothesisId }, "hypothesis evaluation dropped: stale version (game moved on)");
      return;
    }
    await appendEvent(db, {
      roomId: (await gamesRepo.findGameById(db, gameId))!.roomId,
      gameId,
      type: "HYPOTHESIS_EVALUATED",
      payload: { hypothesisId, status: result.status },
    });
  } catch (err) {
    logger.error({ err, gameId, hypothesisId }, "hypothesis evaluation failed unexpectedly");
  }
}

export async function reactToHypothesis(
  db: Database,
  gameId: string,
  playerId: string,
  hypothesisId: string,
  kind: "support" | "challenge",
): Promise<boolean> {
  const { roomRow } = await loadActiveGame(db, gameId);
  if (roomRow.phase !== "ACTIVE") throw new RaidError("INVALID_PHASE", "The incident is not active");
  const hypothesis = await hypothesesRepo.findHypothesisById(db, hypothesisId);
  if (!hypothesis || hypothesis.gameId !== gameId) throw new RaidError("INVALID_PAYLOAD", "Unknown hypothesis");

  const applied = await hypothesesRepo.insertReaction(db, { hypothesisId, playerId, kind });
  if (applied) {
    await appendEvent(db, { roomId: roomRow.id, gameId, type: "HYPOTHESIS_REACTION", payload: { hypothesisId, kind }, actorPlayerId: playerId });
  }
  return applied;
}

export async function attachEvidenceToHypothesis(
  db: Database,
  gameId: string,
  playerId: string,
  hypothesisId: string,
  evidenceId: string,
): Promise<boolean> {
  const { roomRow, scenario } = await loadActiveGame(db, gameId);
  if (roomRow.phase !== "ACTIVE") throw new RaidError("INVALID_PHASE", "The incident is not active");

  const roleMap = await getRoleMap(db, gameId);
  const role = requireRole(roleMap, playerId);

  const evidenceDef = scenario.evidence.find((e) => e.id === evidenceId);
  if (!evidenceDef) throw new RaidError("INVALID_PAYLOAD", "Unknown evidence id");
  if (!evidenceDef.visibleToRoles.includes(role)) {
    throw new RaidError("NOT_AUTHORIZED", "You cannot attach evidence you don't have access to");
  }
  const unlocked = await contentRepo.findUnlockedEvidenceIds(db, gameId);
  if (!unlocked.has(evidenceId)) throw new RaidError("NOT_AUTHORIZED", "That evidence has not been unlocked yet");

  const hypothesis = await hypothesesRepo.findHypothesisById(db, hypothesisId);
  if (!hypothesis || hypothesis.gameId !== gameId) throw new RaidError("INVALID_PAYLOAD", "Unknown hypothesis");

  return hypothesesRepo.insertHypothesisEvidence(db, { hypothesisId, evidenceId, attachedBy: playerId });
}

// ---------------- Known facts ----------------

export async function addKnownFact(
  db: Database,
  gameId: string,
  playerId: string,
  text: string,
  category: "fact" | "question",
  sourceEvidenceId: string | null,
): Promise<KnownFact> {
  const { roomRow, scenario } = await loadActiveGame(db, gameId);
  if (roomRow.phase !== "ACTIVE") throw new RaidError("INVALID_PHASE", "The incident is not active");

  if (sourceEvidenceId) {
    const roleMap = await getRoleMap(db, gameId);
    const role = requireRole(roleMap, playerId);
    const evidenceDef = scenario.evidence.find((e) => e.id === sourceEvidenceId);
    if (!evidenceDef || !evidenceDef.visibleToRoles.includes(role)) {
      throw new RaidError("NOT_AUTHORIZED", "You cannot cite evidence you don't have access to");
    }
    const unlocked = await contentRepo.findUnlockedEvidenceIds(db, gameId);
    if (!unlocked.has(sourceEvidenceId)) throw new RaidError("NOT_AUTHORIZED", "That evidence has not been unlocked yet");
  }

  const row = await contentRepo.insertKnownFact(db, { gameId, text, category, sourceEvidenceId, addedBy: playerId });
  if (!row) throw new RaidError("SERVER_ERROR", "Failed to add known fact");
  await appendEvent(db, { roomId: roomRow.id, gameId, type: "KNOWN_FACT_ADDED", payload: { factId: row.id }, actorPlayerId: playerId });
  return toKnownFact(row);
}

// ---------------- Chat ----------------

export async function sendChatMessage(
  db: Database,
  gameId: string,
  playerId: string,
  displayName: string,
  text: string,
  clientMsgId: string,
): Promise<ChatMessage | null> {
  const { roomRow } = await loadActiveGame(db, gameId);
  if (roomRow.phase !== "ACTIVE" && roomRow.phase !== "FINALIZING") {
    throw new RaidError("INVALID_PHASE", "Chat is only available during the incident");
  }
  const row = await contentRepo.insertChatMessage(db, {
    gameId,
    authorId: playerId,
    authorName: displayName,
    text,
    kind: "player",
    clientMsgId,
  });
  return row ? toChatMessage(row) : null;
}

export async function systemChatMessage(db: Database, gameId: string, text: string): Promise<ChatMessage | null> {
  const row = await contentRepo.insertChatMessage(db, {
    gameId,
    authorId: null,
    authorName: "RAID",
    text,
    kind: "system",
    clientMsgId: randomUUID(),
  });
  return row ? toChatMessage(row) : null;
}

// ---------------- Final diagnosis ----------------

export { finalizeGame } from "./finalizationService.js";
