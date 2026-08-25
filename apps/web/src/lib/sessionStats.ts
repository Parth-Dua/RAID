import type { Difficulty, Role } from "@raid/shared";

/**
 * V0.6.2: session-level stats, tracked entirely client-side in this browser's localStorage.
 * There are no accounts in this MVP, so this is explicitly NOT a validated skill score or a
 * cross-device profile - just a running tally of games this browser has completed, to give a
 * returning player a sense of progress. Every field here is a real recorded fact about a real
 * completed game (never estimated), sourced straight from that game's Debrief.
 */
export interface SessionGameRecord {
  gameId: string;
  scenarioId: string;
  scenarioTitle: string;
  difficulty: Difficulty;
  role: Role | null;
  total: number;
  completionSeconds: number;
  playedAt: string;
}

export interface SessionStatsSummary {
  gamesCompleted: number;
  averageScore: number | null;
  fastestDiagnosisSeconds: number | null;
  rolesPlayed: Role[];
  scenariosCompleted: string[];
}

const KEY = "raid:sessionStats:v1";
const MAX_RECORDS = 500;

function readAll(): SessionGameRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Idempotent per gameId - a debrief re-render or reconnect must never double-count a game. */
export function recordCompletedGame(record: SessionGameRecord): void {
  try {
    const existing = readAll();
    if (existing.some((r) => r.gameId === record.gameId)) return;
    const next = [...existing, record].slice(-MAX_RECORDS);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing / storage disabled: stats just don't persist. Never block the game on this.
  }
}

export function summarizeSessionStats(): SessionStatsSummary {
  const all = readAll();
  if (all.length === 0) {
    return { gamesCompleted: 0, averageScore: null, fastestDiagnosisSeconds: null, rolesPlayed: [], scenariosCompleted: [] };
  }
  const averageScore = Math.round((all.reduce((sum, r) => sum + r.total, 0) / all.length) * 10) / 10;
  const fastestDiagnosisSeconds = Math.min(...all.map((r) => r.completionSeconds));
  const rolesPlayed = [...new Set(all.map((r) => r.role).filter((r): r is Role => !!r))];
  const scenariosCompleted = [...new Set(all.map((r) => r.scenarioTitle))];
  return { gamesCompleted: all.length, averageScore, fastestDiagnosisSeconds, rolesPlayed, scenariosCompleted };
}
