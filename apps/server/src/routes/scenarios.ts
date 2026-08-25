import { Router } from "express";
import { listScenarioCatalog } from "@raid/game-engine";

export const scenariosRouter = Router();

/** Read-only scenario catalog for the lobby's scenario-picker UI (V0.3.1). No auth required -
 * this is not room- or player-scoped, just static content describing what's playable. */
scenariosRouter.get("/", (_req, res) => {
  res.status(200).json({ scenarios: listScenarioCatalog() });
});
