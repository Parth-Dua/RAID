import { io, type Socket } from "socket.io-client";
import { SERVER_URL } from "./http.js";

export function createGameSocket(roomCode: string): Socket {
  return io(SERVER_URL, {
    withCredentials: true,
    auth: { roomCode },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  });
}

export type AckResponse<T = unknown> = { ok: true; data?: T } | { ok: false; error: { code: string; message: string } };

export function emitAck<T = unknown>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, payload, (err: Error | null, response: AckResponse<T>) => {
      if (err) return reject(new Error("Request timed out. Check your connection."));
      if (!response.ok) return reject(new Error(response.error.message));
      resolve(response.data as T);
    });
  });
}
