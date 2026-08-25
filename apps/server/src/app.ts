import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { roomsRouter } from "./routes/rooms.js";
import { healthRouter } from "./routes/health.js";
import { scenariosRouter } from "./routes/scenarios.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  // 512kb: every other route's payloads are tiny, but V0.5's POST /api/scenarios/save round-trips
  // a full generated-scenario definition (up to ~30 evidence items with full content each) back
  // from the client, which can approach 64kb in the worst case authored against the schema's max
  // bounds - this stays a small, deliberate limit, not "accept large uploads."
  app.use(express.json({ limit: "512kb" }));

  app.use("/api/health", healthRouter);
  app.use("/api/rooms", roomsRouter);
  app.use("/api/scenarios", scenariosRouter);

  app.use(errorHandler);
  return app;
}
