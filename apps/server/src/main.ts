import { createServer } from "node:http";
import { Server } from "socket.io";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { createApp } from "./app.js";
import { db } from "./db/client.js";
import { registerSocketHandlers } from "./sockets/index.js";
import { resumeActiveClocks } from "./sockets/clock.js";

const app = createApp();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: env.CORS_ORIGIN, credentials: true },
});

registerSocketHandlers(io);

httpServer.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, aiProvider: env.AI_PROVIDER }, "RAID server listening");
  await resumeActiveClocks(io, db);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  httpServer.close(() => process.exit(0));
});
