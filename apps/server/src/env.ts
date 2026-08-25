import dotenv from "dotenv";
import { z } from "zod";

// NODE_ENV=test loads .env.test so integration tests never touch the dev database.
dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  SESSION_COOKIE_NAME: z.string().default("raid_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),

  AI_PROVIDER: z.enum(["mock", "deepseek"]).default("mock"),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-flash"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).default(2),

  LOG_LEVEL: z.string().default("info"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

if (parsed.data.AI_PROVIDER === "deepseek" && !parsed.data.DEEPSEEK_API_KEY) {
  throw new Error("AI_PROVIDER=deepseek requires DEEPSEEK_API_KEY to be set");
}

export const env = parsed.data;
