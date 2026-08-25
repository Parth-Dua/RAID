import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { AIInvocationMeta } from "@raid/ai";
import { db } from "../db/client.js";
import { aiProvider } from "../services/aiService.js";
import { runGameMasterCheck } from "../services/gameMasterService.js";
import * as interventionsRepo from "../repositories/interventionsRepo.js";
import { resetDatabase, setupActiveGame, startTestServer, type TestServerHandle } from "./testHarness.js";

/** Pushes a game's recorded start time further into the past, so `elapsedSeconds` (computed as
 * now - startedAt) jumps forward without the test having to actually wait in real time. Used only
 * to space out intervention timestamps far enough apart to clear the cooldown window. */
async function shiftGameStartBack(gameId: string, seconds: number): Promise<void> {
  await db.execute(sql`UPDATE games SET started_at = started_at - make_interval(secs => ${seconds}) WHERE id = ${gameId}`);
}

let server: TestServerHandle;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});

function meta(operation: AIInvocationMeta["operation"]): AIInvocationMeta {
  return { requestId: "test", operation, latencyMs: 1, provider: "mock", success: true, usedFallback: false };
}

function mockClassification(classification: string, confidence = 0.8) {
  return vi.spyOn(aiProvider, "classifyTeamState").mockResolvedValue({
    result: { classification: classification as never, confidence, rationale: "forced for test" },
    meta: meta("classifyTeamState"),
  });
}

function mockIntervention(overrides: Partial<{ shouldIntervene: boolean; kind: string | null; message: string | null; confidence: number }>) {
  return vi.spyOn(aiProvider, "proposeIntervention").mockResolvedValue({
    result: {
      shouldIntervene: true,
      kind: "CUSTOMER_SYMPTOM",
      message: "Support just flagged a fresh customer report worth a look.",
      targetRole: null,
      confidence: 0.7,
      ...overrides,
    } as never,
    meta: meta("proposeIntervention"),
  });
}

describe("V0.4: adaptive Game Master orchestration", () => {
  it("does not call proposeIntervention at all for a non-eligible classification (ON_TRACK)", async () => {
    const { gameId } = await setupActiveGame(server.url, 3, "instant");
    mockClassification("ON_TRACK");
    const proposeSpy = vi.spyOn(aiProvider, "proposeIntervention");

    const outcome = await runGameMasterCheck(db, gameId);

    expect(outcome.intervened).toBe(false);
    expect(outcome.classification).toBe("ON_TRACK");
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  it("does not intervene for SOLVING_TOO_QUICKLY or INSUFFICIENT_EVIDENCE either", async () => {
    for (const classification of ["SOLVING_TOO_QUICKLY", "INSUFFICIENT_EVIDENCE"]) {
      const { gameId } = await setupActiveGame(server.url, 3, "instant");
      mockClassification(classification);
      const outcome = await runGameMasterCheck(db, gameId);
      expect(outcome.intervened).toBe(false);
      await resetDatabase();
    }
  });

  it("delivers a valid intervention as an ai_intervention chat message and records it in history", async () => {
    const { gameId, bots } = await setupActiveGame(server.url, 3, "instant");
    mockClassification("STALLED");
    mockIntervention({});

    const outcome = await runGameMasterCheck(db, gameId);

    expect(outcome.intervened).toBe(true);
    expect(outcome.chatMessage?.kind).toBe("ai_intervention");
    expect(outcome.chatMessage?.text).toContain("Support just flagged");

    const history = await interventionsRepo.findInterventionsForGame(db, gameId);
    expect(history).toHaveLength(1);
    expect(history[0]!.classification).toBe("STALLED");

    void bots;
  });

  it("discards (does not deliver) an intervention proposal that leaks the root cause - adversarial case", async () => {
    const { gameId } = await setupActiveGame(server.url, 3, "instant");
    mockClassification("STALLED");
    mockIntervention({
      message: "This is an N+1 issue hitting loyalty_history causing connection pool exhaustion.",
    });

    const outcome = await runGameMasterCheck(db, gameId);

    expect(outcome.intervened).toBe(false);
    expect(outcome.reason).toContain("validation");
    const history = await interventionsRepo.findInterventionsForGame(db, gameId);
    expect(history).toHaveLength(0);
  });

  it("discards a proposal below the minimum confidence threshold", async () => {
    const { gameId } = await setupActiveGame(server.url, 3, "instant");
    mockClassification("STALLED");
    mockIntervention({ confidence: 0.1 });

    const outcome = await runGameMasterCheck(db, gameId);

    expect(outcome.intervened).toBe(false);
    const history = await interventionsRepo.findInterventionsForGame(db, gameId);
    expect(history).toHaveLength(0);
  });

  it("respects the AI's own decision not to intervene (shouldIntervene: false)", async () => {
    const { gameId } = await setupActiveGame(server.url, 3, "instant");
    mockClassification("TUNNEL_VISION");
    mockIntervention({ shouldIntervene: false, kind: null, message: null });

    const outcome = await runGameMasterCheck(db, gameId);
    expect(outcome.intervened).toBe(false);
    expect(outcome.reason).toContain("declined");
  });

  it("enforces the per-game intervention budget (max 3)", async () => {
    // "standard" duration (1200s) so there's enough headroom to space 3 deliveries >60s apart in
    // elapsedSeconds without colliding with the scenario's own duration cap.
    const { gameId } = await setupActiveGame(server.url, 3, "standard");
    mockClassification("STALLED");

    for (let i = 0; i < 3; i++) {
      if (i > 0) await shiftGameStartBack(gameId, 70); // clears the 60s cooldown before each repeat check
      mockIntervention({ message: `Support flagged report number ${i} worth a look right now.` });
      const outcome = await runGameMasterCheck(db, gameId);
      expect(outcome.intervened).toBe(true);
    }

    await shiftGameStartBack(gameId, 70);
    mockIntervention({ message: "One more nudge that should be blocked by the budget cap." });
    const fourth = await runGameMasterCheck(db, gameId);
    expect(fourth.intervened).toBe(false);
    expect(fourth.reason).toContain("budget");

    const history = await interventionsRepo.findInterventionsForGame(db, gameId);
    expect(history.length).toBeLessThanOrEqual(3);
  });

  it("enforces the cooldown between interventions", async () => {
    const { gameId } = await setupActiveGame(server.url, 3, "instant");
    mockClassification("STALLED");
    mockIntervention({});

    const first = await runGameMasterCheck(db, gameId);
    expect(first.intervened).toBe(true);

    // Immediately re-check (elapsed time has barely moved) - the cooldown should block a second
    // delivery even though budget still has room.
    mockIntervention({});
    const second = await runGameMasterCheck(db, gameId);
    expect(second.intervened).toBe(false);
    expect(second.reason).toContain("cooldown");

    const history = await interventionsRepo.findInterventionsForGame(db, gameId);
    expect(history).toHaveLength(1);
  });
});
