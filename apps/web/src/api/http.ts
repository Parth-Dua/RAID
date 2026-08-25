import type { Difficulty, GeneratedScenarioDefinition, RoomSnapshot, ScenarioCatalogEntry } from "@raid/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ code: "SERVER_ERROR", message: "Something went wrong." }));
    throw new ApiError(body.code ?? "SERVER_ERROR", body.message ?? "Something went wrong.");
  }
  return res.json() as Promise<T>;
}

export function createRoom(displayName: string) {
  return request<{ roomCode: string; playerId: string }>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
}

export function joinRoom(roomCode: string, displayName: string) {
  return request<{ roomCode: string; playerId: string }>(`/api/rooms/${roomCode}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
}

export function getRoom(roomCode: string) {
  return request<RoomSnapshot>(`/api/rooms/${roomCode}`);
}

export function getScenarioCatalog() {
  return request<{ scenarios: ScenarioCatalogEntry[] }>("/api/scenarios");
}

export interface GenerateScenarioResponse {
  candidate: GeneratedScenarioDefinition;
  validation: { valid: boolean; errors: string[] };
  semanticReview: { passed: boolean; issues: string[] } | null;
  eligibleToSave: boolean;
}

/** V0.5.1: generate a scenario candidate from a free-text description. Never saves anything. */
export function generateScenario(description: string, difficulty?: Difficulty) {
  return request<GenerateScenarioResponse>("/api/scenarios/generate", {
    method: "POST",
    body: JSON.stringify({ description, difficulty }),
  });
}

/** V0.5.7: persist a candidate already returned by `generateScenario`. */
export function saveGeneratedScenario(candidate: GeneratedScenarioDefinition, requestedDescription?: string) {
  return request<{ scenarioId: string; catalogEntry: ScenarioCatalogEntry }>("/api/scenarios/save", {
    method: "POST",
    body: JSON.stringify({ candidate, requestedDescription }),
  });
}

export { SERVER_URL };
