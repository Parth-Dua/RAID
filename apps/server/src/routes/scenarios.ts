import { Router } from "express";
import { z } from "zod";
import { listScenarioCatalog } from "@raid/game-engine";
import { GeneratedScenarioSchema } from "@raid/ai";
import { db } from "../db/client.js";
import { generateScenario, listGeneratedScenarioCatalog, saveGeneratedScenario } from "../services/scenarioGenerationService.js";

export const scenariosRouter = Router();

/** Read-only scenario catalog for the lobby's scenario-picker UI (V0.3.1, extended V0.5 to include
 * saved AI-generated scenarios alongside the 3 built-in ones). No auth required - this is not
 * room- or player-scoped, just content describing what's playable. */
scenariosRouter.get("/", async (_req, res, next) => {
  try {
    const generated = await listGeneratedScenarioCatalog(db);
    res.status(200).json({ scenarios: [...listScenarioCatalog(), ...generated] });
  } catch (err) {
    next(err);
  }
});

const GenerateBody = z.object({
  description: z.string().trim().min(1).max(500),
  difficulty: z.enum(["NORMAL", "HARD"]).optional(),
});

/**
 * V0.5.7 step 1-3: generate a candidate, run it through the deterministic validator and (if that
 * passes) one semantic review call, and return everything for the authoring UI to display - never
 * saves anything itself. Not room-scoped, not authenticated, same posture as the read-only catalog
 * endpoint above; see docs/AI_DESIGN.md "known limitations" for why this is acceptable at MVP scope.
 */
scenariosRouter.post("/generate", async (req, res, next) => {
  try {
    const { description, difficulty } = GenerateBody.parse(req.body);
    const outcome = await generateScenario(description, difficulty);
    res.status(200).json(outcome);
  } catch (err) {
    next(err);
  }
});

const SaveBody = z.object({
  candidate: GeneratedScenarioSchema,
  requestedDescription: z.string().max(500).optional(),
});

/** V0.5.7 step 4: persist a candidate the client already has (from a prior /generate call).
 * Re-validates deterministically server-side before saving - never trusts the client payload as-is,
 * and never re-spends AI budget re-reviewing it (see scenarioGenerationService.ts). */
scenariosRouter.post("/save", async (req, res, next) => {
  try {
    const { candidate, requestedDescription } = SaveBody.parse(req.body);
    const result = await saveGeneratedScenario(db, candidate, requestedDescription);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
