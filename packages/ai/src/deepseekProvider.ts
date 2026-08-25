import { randomUUID } from "node:crypto";
import type {
  AIInvocationMeta,
  AIProvider,
  DebriefInput,
  FinalEvaluationInput,
  HypothesisEvaluationInput,
  InterventionProposalInput,
  TeamStateClassificationInput,
} from "./provider.js";
import {
  DebriefContentSchema,
  FinalEvaluationSchema,
  HypothesisEvaluationSchema,
  InterventionProposalSchema,
  TeamStateClassificationSchema,
  type DebriefContent,
  type FinalEvaluation,
  type HypothesisEvaluation,
  type InterventionProposal,
  type TeamStateClassificationResult,
} from "./schemas.js";
import {
  buildDebriefContext,
  buildFinalEvaluationContext,
  buildHypothesisContext,
  buildInterventionProposalContext,
  buildTeamStateClassificationContext,
} from "./contextBuilders.js";
import { containsRootCauseLeak } from "./leakGuard.js";
import { validateIntervention } from "./interventionValidator.js";
import { MockAIProvider } from "./mockProvider.js";

export interface DeepSeekProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  /** Structured observability hook. Never receives the API key. */
  onInvocation?: (meta: AIInvocationMeta) => void;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/**
 * DeepSeek OpenAI-compatible chat-completions provider. Every call goes
 * through the same pipeline: build minimal context -> call -> parse JSON ->
 * zod schema validation -> operation-specific semantic validation (leak
 * guard / evidence-id hallucination check) -> on failure, one repair-prompt
 * retry -> on continued failure or network error, fall back to
 * MockAIProvider so a DeepSeek outage never corrupts or stalls a live game.
 * See docs/AI_DESIGN.md "AI request lifecycle".
 */
export class DeepSeekProvider implements AIProvider {
  private readonly fallback = new MockAIProvider();

  constructor(private readonly config: DeepSeekProviderConfig) {}

  async evaluateHypothesis(
    input: HypothesisEvaluationInput,
  ): Promise<{ result: HypothesisEvaluation; meta: AIInvocationMeta }> {
    const { system, user } = buildHypothesisContext(input);
    return this.run(
      "evaluateHypothesis",
      system,
      user,
      HypothesisEvaluationSchema,
      (parsed) => {
        if (containsRootCauseLeak(parsed.rationale, input.scenario)) {
          return { valid: false, reason: "rationale appears to leak the root cause" };
        }
        return { valid: true, sanitized: parsed };
      },
      () => this.fallback.evaluateHypothesis(input),
    );
  }

  async evaluateFinalDiagnosis(
    input: FinalEvaluationInput,
  ): Promise<{ result: FinalEvaluation; meta: AIInvocationMeta }> {
    const { system, user } = buildFinalEvaluationContext(input);
    const realEvidenceIds = new Set(input.scenario.evidence.map((e) => e.id));
    return this.run(
      "evaluateFinalDiagnosis",
      system,
      user,
      FinalEvaluationSchema,
      (parsed) => {
        const hallucinated = parsed.matchedKeyEvidenceIds.filter((id) => !realEvidenceIds.has(id));
        if (hallucinated.length > 0) {
          return { valid: false, reason: `hallucinated evidence ids: ${hallucinated.join(", ")}` };
        }
        return { valid: true, sanitized: parsed };
      },
      () => this.fallback.evaluateFinalDiagnosis(input),
    );
  }

  async classifyTeamState(
    input: TeamStateClassificationInput,
  ): Promise<{ result: TeamStateClassificationResult; meta: AIInvocationMeta }> {
    const { system, user } = buildTeamStateClassificationContext(input);
    return this.run(
      "classifyTeamState",
      system,
      user,
      TeamStateClassificationSchema,
      (parsed) => {
        if (containsRootCauseLeak(parsed.rationale, input.scenario)) {
          return { valid: false, reason: "rationale appears to leak the root cause" };
        }
        return { valid: true, sanitized: parsed };
      },
      () => this.fallback.classifyTeamState(input),
    );
  }

  async proposeIntervention(input: InterventionProposalInput): Promise<{ result: InterventionProposal; meta: AIInvocationMeta }> {
    const { system, user } = buildInterventionProposalContext(input);
    return this.run(
      "proposeIntervention",
      system,
      user,
      InterventionProposalSchema,
      (parsed) => {
        const validation = validateIntervention(parsed, input.scenario);
        if (!validation.valid) {
          return { valid: false, reason: validation.reason ?? "intervention failed backend validation" };
        }
        return { valid: true, sanitized: parsed };
      },
      () => this.fallback.proposeIntervention(input),
    );
  }

  async generateDebrief(input: DebriefInput): Promise<{ result: DebriefContent; meta: AIInvocationMeta }> {
    const { system, user } = buildDebriefContext(input);
    return this.run(
      "generateDebrief",
      system,
      user,
      DebriefContentSchema,
      (parsed) => ({ valid: true, sanitized: parsed }),
      () => this.fallback.generateDebrief(input),
    );
  }

  private async run<T>(
    operation: AIInvocationMeta["operation"],
    system: string,
    user: string,
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
    semanticValidate: (parsed: T) => { valid: true; sanitized: T } | { valid: false; reason: string },
    fallback: () => Promise<{ result: T; meta: AIInvocationMeta }>,
  ): Promise<{ result: T; meta: AIInvocationMeta }> {
    const requestId = randomUUID();
    const start = Date.now();
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    let lastError = "unknown error";

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const raw = await this.callChatCompletion(messages, requestId);
        const parsed = safeJsonParse(raw);
        if (parsed === undefined) {
          lastError = "response was not valid JSON";
          messages.push({ role: "user", content: repairPrompt(lastError) });
          continue;
        }

        const schemaResult = schema.safeParse(parsed);
        if (!schemaResult.success || schemaResult.data === undefined) {
          lastError = "response failed schema validation";
          messages.push({ role: "user", content: repairPrompt(lastError) });
          continue;
        }

        const semantic = semanticValidate(schemaResult.data);
        if (!semantic.valid) {
          lastError = semantic.reason;
          messages.push({ role: "user", content: repairPrompt(lastError) });
          continue;
        }

        const meta: AIInvocationMeta = {
          requestId,
          operation,
          latencyMs: Date.now() - start,
          provider: "deepseek",
          success: true,
          usedFallback: false,
        };
        this.config.onInvocation?.(meta);
        return { result: semantic.sanitized, meta };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < this.config.maxRetries) {
          await sleep(2 ** attempt * 300);
        }
      }
    }

    const meta: AIInvocationMeta = {
      requestId,
      operation,
      latencyMs: Date.now() - start,
      provider: "deepseek",
      success: false,
      usedFallback: true,
      errorMessage: lastError,
    };
    this.config.onInvocation?.(meta);
    const fallbackResult = await fallback();
    return { result: fallbackResult.result, meta };
  }

  private async callChatCompletion(messages: ChatMessage[], requestId: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "X-Request-Id": requestId,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.4,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`DeepSeek API error ${res.status}: ${body.slice(0, 300)}`);
      }

      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("DeepSeek response had no message content");
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function repairPrompt(reason: string): string {
  return (
    `Your previous response was rejected: ${reason}. ` +
    "Respond again with ONLY a single valid JSON object matching the requested schema, no markdown fences, no extra text."
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
