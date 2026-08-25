import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.NODE_ENV === "development" ? { target: "pino-pretty", options: { colorize: true } } : undefined,
  redact: ["DEEPSEEK_API_KEY", "*.apiKey", "*.sessionToken", "*.token"],
});

export type Logger = typeof logger;

/** Scoped child logger helper so call sites don't repeat context fields. */
export function scopedLogger(fields: Record<string, unknown>) {
  return logger.child(fields);
}
