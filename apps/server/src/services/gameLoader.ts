import { buildScenario, computeSimulationSeconds } from "@raid/game-engine";
import type { ScenarioDefinition } from "@raid/shared";
import type { Database } from "../db/client.js";
import { RaidError } from "../domain/errors.js";
import * as roomsRepo from "../repositories/roomsRepo.js";
import * as gamesRepo from "../repositories/gamesRepo.js";

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
  const scenario = buildScenario(gameRow.scenarioId, gameRow.durationSeconds);
  const elapsedSeconds = gameRow.startedAt
    ? Math.min(gameRow.durationSeconds, computeSimulationSeconds(gameRow.startedAt.getTime(), Date.now()))
    : 0;
  return { gameRow, roomRow, scenario, elapsedSeconds };
}
