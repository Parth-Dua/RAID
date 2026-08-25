import { Router } from "express";
import { env } from "../env.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.status(200).json({ status: "ok", aiProvider: env.AI_PROVIDER, env: env.NODE_ENV });
});
