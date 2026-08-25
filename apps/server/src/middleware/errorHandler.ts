import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { RaidError } from "../domain/errors.js";
import { logger } from "../logger.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof RaidError) {
    const status = statusForCode(err.code);
    res.status(status).json({ code: err.code, message: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ code: "INVALID_PAYLOAD", message: err.issues.map((i) => i.message).join("; ") });
    return;
  }
  logger.error({ err, path: req.path }, "unhandled request error");
  res.status(500).json({ code: "SERVER_ERROR", message: "Something went wrong." });
};

function statusForCode(code: RaidError["code"]): number {
  switch (code) {
    case "ROOM_NOT_FOUND":
      return 404;
    case "ROOM_FULL":
    case "ALREADY_STARTED":
    case "INVALID_PHASE":
      return 409;
    case "NOT_AUTHORIZED":
    case "NOT_HOST":
    case "WRONG_ROLE":
      return 403;
    case "INVALID_PAYLOAD":
      return 400;
    case "RATE_LIMITED":
      return 429;
    case "UNKNOWN_TOOL":
      return 404;
    default:
      return 500;
  }
}
