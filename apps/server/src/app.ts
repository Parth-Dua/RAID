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
  app.use(express.json({ limit: "64kb" }));

  app.use("/api/health", healthRouter);
  app.use("/api/rooms", roomsRouter);
  app.use("/api/scenarios", scenariosRouter);

  app.use(errorHandler);
  return app;
}
