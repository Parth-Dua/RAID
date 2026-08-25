/**
 * Minimal in-memory per-player-per-action rate limiter. A single process
 * MVP does not need a distributed limiter (see docs/DECISIONS.md Redis
 * ADR) — this exists purely to stop chat/tool spam from one misbehaving
 * client, not as a security boundary.
 */
const WINDOW_MS = 3000;
const MAX_PER_WINDOW = 8;

const buckets = new Map<string, number[]>();

export function isRateLimited(playerId: string, action: string): boolean {
  const key = `${playerId}:${action}`;
  const now = Date.now();
  const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  buckets.set(key, timestamps);
  return timestamps.length > MAX_PER_WINDOW;
}

export function clearRateLimiterState(): void {
  buckets.clear();
}
