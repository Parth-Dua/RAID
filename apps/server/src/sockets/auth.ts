import type { Socket } from "socket.io";
import { db } from "../db/client.js";
import { parseSessionCookie, safeTokenEquals } from "../domain/session.js";
import * as playersRepo from "../repositories/playersRepo.js";
import * as roomsRepo from "../repositories/roomsRepo.js";
import { logger } from "../logger.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SocketAuthData {
  playerId: string;
  roomId: string;
  displayName: string;
}

/**
 * Socket.IO handshake middleware. The session cookie set by POST /api/rooms
 * or /api/rooms/:code/join is the only credential — see docs/DECISIONS.md
 * anonymous-session ADR. `auth.roomCode` disambiguates when a browser holds
 * a session for a different room than the one being connected to (e.g. an
 * old tab left open); on mismatch the client is expected to fall back to
 * the join-by-name flow rather than silently reusing the wrong identity.
 */
export async function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    const cookieHeader = socket.request.headers.cookie;
    const parsed = parseSessionCookie(cookieHeader);
    if (!parsed || !UUID_RE.test(parsed.playerId)) return next(new Error("NOT_AUTHORIZED"));

    const player = await playersRepo.findPlayerById(db, parsed.playerId);
    if (!player || !safeTokenEquals(parsed.token, player.sessionToken)) {
      return next(new Error("NOT_AUTHORIZED"));
    }

    const requestedRoomCode = (socket.handshake.auth as { roomCode?: string } | undefined)?.roomCode;
    if (requestedRoomCode) {
      const room = await roomsRepo.findRoomById(db, player.roomId);
      if (!room || room.code.toUpperCase() !== requestedRoomCode.toUpperCase()) {
        return next(new Error("ROOM_NOT_FOUND"));
      }
    }

    const data: SocketAuthData = { playerId: player.id, roomId: player.roomId, displayName: player.displayName };
    socket.data = data;
    next();
  } catch (err) {
    logger.error({ err }, "socket auth middleware failed");
    next(new Error("SERVER_ERROR"));
  }
}
