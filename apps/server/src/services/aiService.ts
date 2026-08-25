import { DeepSeekProvider, MockAIProvider, type AIInvocationMeta, type AIProvider } from "@raid/ai";
import { env } from "../env.js";
import { logger } from "../logger.js";

/**
 * The ONLY place an AIProvider is constructed and the ONLY place model calls
 * are made from. Route handlers and socket handlers call gameService, which
 * calls this module — never the provider directly (spec section 12/44).
 * All invocations are logged with operation/latency/success/fallback so AI
 * cost and reliability are observable without ever logging the API key.
 */
function buildProvider(): AIProvider {
  if (env.AI_PROVIDER === "mock") {
    logger.info({ aiProvider: "mock" }, "AI provider initialized");
    return new MockAIProvider();
  }
  logger.info({ aiProvider: "deepseek", model: env.DEEPSEEK_MODEL }, "AI provider initialized");
  return new DeepSeekProvider({
    apiKey: env.DEEPSEEK_API_KEY!,
    baseUrl: env.DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL,
    timeoutMs: env.AI_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    onInvocation: logInvocation,
  });
}

function logInvocation(meta: AIInvocationMeta): void {
  const level = meta.success ? "info" : "warn";
  logger[level](
    {
      aiOperation: meta.operation,
      aiRequestId: meta.requestId,
      aiProvider: meta.provider,
      aiLatencyMs: meta.latencyMs,
      aiSuccess: meta.success,
      aiUsedFallback: meta.usedFallback,
      aiError: meta.errorMessage,
    },
    "AI invocation",
  );
}

export const aiProvider: AIProvider = buildProvider();
