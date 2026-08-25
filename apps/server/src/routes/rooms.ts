import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { setSessionCookie } from "../domain/session.js";
import { RaidError } from "../domain/errors.js";
import * as roomService from "../services/roomService.js";
import { findRoomByCode } from "../repositories/roomsRepo.js";
import { getRoomLeaderboard } from "../services/resultsService.js";
import { isValidRoomCode } from "@raid/shared";

export const roomsRouter = Router();

const CreateRoomBody = z.object({ displayName: z.string().trim().min(1).max(40) });
const JoinRoomBody = z.object({ displayName: z.string().trim().min(1).max(40) });

roomsRouter.post("/", async (req, res, next) => {
  try {
    const { displayName } = CreateRoomBody.parse(req.body);
    const identity = await roomService.createRoom(db, displayName);
    setSessionCookie(res, { playerId: identity.playerId, token: identity.sessionToken });
    res.status(201).json({ roomCode: identity.code, playerId: identity.playerId });
  } catch (err) {
    next(err);
  }
});

roomsRouter.post("/:code/join", async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    if (!isValidRoomCode(code)) throw new RaidError("ROOM_NOT_FOUND", "Invalid room code");
    const { displayName } = JoinRoomBody.parse(req.body);
    const identity = await roomService.joinRoom(db, code, displayName);
    setSessionCookie(res, { playerId: identity.playerId, token: identity.sessionToken });
    res.status(200).json({ roomCode: code, playerId: identity.playerId });
  } catch (err) {
    next(err);
  }
});

roomsRouter.get("/:code", async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    if (!isValidRoomCode(code)) throw new RaidError("ROOM_NOT_FOUND", "Invalid room code");
    const room = await findRoomByCode(db, code);
    if (!room) throw new RaidError("ROOM_NOT_FOUND", "No room with that code");
    const snapshot = await roomService.getRoomSnapshot(db, room.id);
    res.status(200).json(snapshot);
  } catch (err) {
    next(err);
  }
});

/** V0.6.5: room-scoped leaderboard - not authenticated beyond knowing the room code, same posture
 * as every other room-lookup route here. Empty array (not an error) for a room with no completed
 * games yet. */
roomsRouter.get("/:code/leaderboard", async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    if (!isValidRoomCode(code)) throw new RaidError("ROOM_NOT_FOUND", "Invalid room code");
    const entries = await getRoomLeaderboard(db, code);
    res.status(200).json({ entries });
  } catch (err) {
    next(err);
  }
});
