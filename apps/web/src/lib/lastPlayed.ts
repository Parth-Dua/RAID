import type { Difficulty } from "@raid/shared";

/**
 * V0.6.3: low-friction rematch. Persists the host's last scenario/difficulty/duration choice in
 * this browser's localStorage so the lobby can pre-fill it after a rematch instead of making the
 * host reconfigure from scratch every round. Deliberately does NOT bypass the server-side
 * ready-reset on rematch (see roomService.rematchRoom) - everyone still has to consciously
 * re-ready, this only removes the "reconfigure the game" friction, not the "everyone agrees to
 * play again" step.
 */
export interface LastPlayed {
  scenarioId: string;
  difficulty: Difficulty;
  duration: "standard" | "demo";
}

const LAST_PLAYED_KEY = "raid:lastPlayed:v1";
const FORCE_DIFFERENT_KEY = "raid:forceDifferentScenario:v1";

export function saveLastPlayed(v: LastPlayed): void {
  try {
    localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(v));
  } catch {
    // Non-fatal: the lobby just falls back to its default picker state next time.
  }
}

export function loadLastPlayed(): LastPlayed | null {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY);
    return raw ? (JSON.parse(raw) as LastPlayed) : null;
  } catch {
    return null;
  }
}

/** "New scenario" on the debrief screen: remember which scenario just finished so the lobby's
 * catalog picker can deliberately land on a different one instead of repeating it. */
export function requestDifferentScenario(currentScenarioId: string): void {
  try {
    sessionStorage.setItem(FORCE_DIFFERENT_KEY, currentScenarioId);
  } catch {
    // Non-fatal: the lobby just falls back to its normal default (which may repeat the scenario).
  }
}

export function consumeForceDifferentScenario(): string | null {
  try {
    const v = sessionStorage.getItem(FORCE_DIFFERENT_KEY);
    sessionStorage.removeItem(FORCE_DIFFERENT_KEY);
    return v;
  } catch {
    return null;
  }
}
