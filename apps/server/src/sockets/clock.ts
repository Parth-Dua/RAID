import type { Server } from "socket.io";
import type { Database } from "../db/client.js";
import { loadActiveGame } from "../services/gameLoader.js";
import { finalizeGame, systemChatMessage } from "../services/gameService.js";
import { runGameMasterCheck } from "../services/gameMasterService.js";
import { emitFinalEvaluated, emitGameCompleted, emitGameEvent, emitGameSnapshotToRoom, emitTimerUpdate } from "./emit.js";
import { logger } from "../logger.js";

const TICK_MS = 5000;

/** How often (in simulation seconds) the adaptive Game Master re-classifies the team's state.
 * Deliberately coarse — this is an AI call (mock or live) on every fire, not a per-tick check.
 * Scaled to the scenario's duration so a 5-minute demo and a 20-minute standard game both get a
 * handful of checks rather than one config value being too frequent for one and too sparse for
 * the other; floored so even the 60s "instant" bot-simulation preset gets at least one check. */
function gameMasterIntervalSeconds(durationSeconds: number): number {
  return Math.max(15, Math.round(durationSeconds * 0.15));
}

interface ClockState {
  interval: NodeJS.Timeout;
  lastTimelineIndex: number;
  lastGameMasterCheckSeconds: number;
}

const clocks = new Map<string, ClockState>();

/**
 * Server-authoritative timer (spec step 13/section 18/45). Lives in-process
 * per active game; see docs/DECISIONS.md "Redis in MVP or not" for why a
 * single-process in-memory timer is sufficient at this scale and what would
 * force a change. If the process restarts mid-game the timer is lost —
 * `loadActiveGame`'s elapsedSeconds is still computed from `startedAt`, so
 * any subsequent player action self-heals the client's view of time even
 * though the auto-finalize-on-expiry side effect would need a fresh
 * `startClock` call (done on server boot for any room found ACTIVE).
 */
export function startClock(io: Server, db: Database, roomId: string, gameId: string): void {
  if (clocks.has(gameId)) return;
  const state: ClockState = { interval: undefined as unknown as NodeJS.Timeout, lastTimelineIndex: 0, lastGameMasterCheckSeconds: 0 };
  state.interval = setInterval(() => void tick(io, db, roomId, gameId, state), TICK_MS);
  clocks.set(gameId, state);
}

export function stopClock(gameId: string): void {
  const state = clocks.get(gameId);
  if (state) {
    clearInterval(state.interval);
    clocks.delete(gameId);
  }
}

async function tick(io: Server, db: Database, roomId: string, gameId: string, state: ClockState): Promise<void> {
  try {
    const { roomRow, scenario, elapsedSeconds, gameRow } = await loadActiveGame(db, gameId);
    if (roomRow.phase !== "ACTIVE") {
      stopClock(gameId);
      return;
    }

    const remainingSeconds = Math.max(0, scenario.durationSeconds - elapsedSeconds);
    emitTimerUpdate(io, roomId, remainingSeconds);

    while (
      state.lastTimelineIndex < scenario.timeline.length &&
      scenario.timeline[state.lastTimelineIndex]!.atSeconds <= elapsedSeconds
    ) {
      const step = scenario.timeline[state.lastTimelineIndex]!;
      emitGameEvent(io, roomId, { kind: "timeline_step", step });
      const msg = await systemChatMessage(db, gameId, `[T+${step.atSeconds}s] ${step.headline}`);
      if (msg) emitGameEvent(io, roomId, { kind: "chat", message: msg });
      state.lastTimelineIndex++;
    }

    const gmInterval = gameMasterIntervalSeconds(scenario.durationSeconds);
    if (elapsedSeconds - state.lastGameMasterCheckSeconds >= gmInterval) {
      state.lastGameMasterCheckSeconds = elapsedSeconds;
      try {
        const outcome = await runGameMasterCheck(db, gameId);
        logger.info({ gameId, classification: outcome.classification, intervened: outcome.intervened, reason: outcome.reason }, "game master check");
        if (outcome.intervened && outcome.chatMessage) {
          emitGameEvent(io, roomId, { kind: "chat", message: outcome.chatMessage });
        }
      } catch (err) {
        // The adaptive Game Master is a nice-to-have on top of the core game loop, never a
        // dependency of it - a classification/AI failure here must never stall the timer, evidence
        // unlocks, or finalization, so it's caught and logged rather than propagated.
        logger.error({ err, gameId }, "game master check failed");
      }
    }

    if (remainingSeconds <= 0) {
      stopClock(gameId);
      const outcome = await finalizeGame(db, gameId, null);
      emitFinalEvaluated(io, roomId, outcome.debrief);
      emitGameCompleted(io, roomId);
      await emitGameSnapshotToRoom(io, db, roomId, gameId);
    }
  } catch (err) {
    logger.error({ err, gameId }, "game clock tick failed");
  }
}

/** Resume clocks for any game left ACTIVE across a server restart. */
export async function resumeActiveClocks(io: Server, db: Database): Promise<void> {
  const { rooms } = await import("../db/schema.js");
  const { eq } = await import("drizzle-orm");
  const activeRooms = await db.select().from(rooms).where(eq(rooms.phase, "ACTIVE"));
  for (const room of activeRooms) {
    if (room.currentGameId) {
      logger.info({ roomId: room.id, gameId: room.currentGameId }, "resuming game clock after restart");
      startClock(io, db, room.id, room.currentGameId);
    }
  }
}
