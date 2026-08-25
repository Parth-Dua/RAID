import { buildGeneratedScenario, buildScenario, computeSimulationSeconds, listScenarioIds } from "@raid/game-engine";
import type { Difficulty, GeneratedScenarioDefinition, ScenarioDefinition } from "@raid/shared";
import type { Database } from "../db/client.js";
import { RaidError } from "../domain/errors.js";
import * as roomsRepo from "../repositories/roomsRepo.js";
import * as gamesRepo from "../repositories/gamesRepo.js";
import * as generatedScenariosRepo from "../repositories/generatedScenariosRepo.js";

/** Resolves a scenario id against the built-in registry first, then falls back to a saved
 * AI-generated scenario (V0.5) — the one place server code distinguishes the two sources; every
 * caller downstream (gameService, sockets, scoring) works from the resulting `ScenarioDefinition`
 * with zero awareness of where it came from. */
async function resolveScenario(db: Database, scenarioId: string, durationSeconds: number, difficulty: Difficulty): Promise<ScenarioDefinition> {
  if (listScenarioIds().includes(scenarioId)) {
    return buildScenario(scenarioId, durationSeconds, difficulty);
  }
  const row = await generatedScenariosRepo.findGeneratedScenarioByScenarioId(db, scenarioId);
  if (!row) throw new RaidError("ROOM_NOT_FOUND", `Unknown scenario: ${scenarioId}`);
  return buildGeneratedScenario(row.definition as GeneratedScenarioDefinition, durationSeconds, difficulty);
}

export interface LoadedGame {
  gameRow: NonNullable<Awaited<ReturnType<typeof gamesRepo.findGameById>>>;
  roomRow: NonNullable<Awaited<ReturnType<typeof roomsRepo.findRoomById>>>;
  scenario: ScenarioDefinition;
  elapsedSeconds: number;
}

export async function loadActiveGame(db: Database, gameId: string): Promise<LoadedGame> {
  const gameRow = await gamesRepo.findGameById(db, gameId);
  if (!gameRow) throw new RaidError("ROOM_NOT_FOUND", "Game not found");
  const roomRow = await roomsRepo.findRoomById(db, gameRow.roomId);
  if (!roomRow) throw new RaidError("ROOM_NOT_FOUND", "Room not found");
  const scenario = await resolveScenario(db, gameRow.scenarioId, gameRow.durationSeconds, gameRow.difficulty as Difficulty);
  const elapsedSeconds = gameRow.startedAt
    ? Math.min(gameRow.durationSeconds, computeSimulationSeconds(gameRow.startedAt.getTime(), Date.now()))
    : 0;
  return { gameRow, roomRow, scenario, elapsedSeconds };
}
