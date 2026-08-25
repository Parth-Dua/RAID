import type { GamePhase } from "@raid/shared";

/**
 * Explicit game phase state machine. This is the single authority on which
 * phase transitions are legal. The server calls `assertTransition` before
 * ever writing a new phase to the database — nothing else may change phase.
 */

const LEGAL_TRANSITIONS: Record<GamePhase, GamePhase[]> = {
  LOBBY: ["STARTING", "ABANDONED"],
  STARTING: ["ACTIVE", "ABANDONED"],
  ACTIVE: ["FINALIZING", "ABANDONED"],
  FINALIZING: ["COMPLETED", "ABANDONED"],
  COMPLETED: [],
  ABANDONED: [],
};

export class IllegalPhaseTransitionError extends Error {
  constructor(
    public readonly from: GamePhase,
    public readonly to: GamePhase,
  ) {
    super(`Illegal phase transition: ${from} -> ${to}`);
    this.name = "IllegalPhaseTransitionError";
  }
}

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: GamePhase, to: GamePhase): void {
  if (!canTransition(from, to)) {
    throw new IllegalPhaseTransitionError(from, to);
  }
}
