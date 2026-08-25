import type { RoomSnapshot } from "@raid/shared";

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

export { SERVER_URL };
