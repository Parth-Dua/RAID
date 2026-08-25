const STORAGE_KEY = "raid:identity:v1";

export interface StoredIdentity {
  roomCode: string;
  playerId: string;
}

/**
 * The httpOnly session cookie is the actual credential (see docs/DECISIONS.md
 * anonymous-session ADR) - this localStorage entry is NOT a credential, just
 * a client-side memory of "which room/player am I currently" so a page
 * refresh can skip straight back into the game instead of showing the join
 * form again. A single value only, matching the single-cookie design: this
 * browser can be "in" one room at a time.
 */
export function loadIdentity(): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredIdentity;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: StoredIdentity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export function clearIdentity(): void {
  localStorage.removeItem(STORAGE_KEY);
}
