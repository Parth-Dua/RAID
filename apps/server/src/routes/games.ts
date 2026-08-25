import { Router } from "express";
import { db } from "../db/client.js";
import { getPublicGameResult } from "../services/resultsService.js";

export const gamesRouter = Router();

/** V0.6.4: public, read-only shareable result page data. Not room- or session-scoped - gameId
 * itself (an unguessable UUID) is the access control, same posture as every other unauthenticated
 * read in this MVP. 404s (rather than a partial payload) for an unknown or not-yet-finished game. */
gamesRouter.get("/:gameId/result", async (req, res, next) => {
  try {
    const result = await getPublicGameResult(db, req.params.gameId);
    if (!result) {
      res.status(404).json({ code: "NOT_FOUND", message: "No finished game with that id" });
      return;
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
