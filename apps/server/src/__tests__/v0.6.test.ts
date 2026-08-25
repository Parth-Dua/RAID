import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { listScenarioCatalog } from "@raid/game-engine";
import { emitAck, resetDatabase, setupActiveGame, setupCompletedGame, startTestServer, waitForEvent, type TestServerHandle } from "./testHarness.js";

let server: TestServerHandle;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
afterEach(async () => {
  await resetDatabase();
});

describe("V0.6.1: debrief upgrade", () => {
  it("the debrief carries real scenario/difficulty/completion-time fields and per-player role contributions computed from real actions", async () => {
    const { bots, gameId } = await setupActiveGame(server.url, 3, "instant", { scenarioId: "lock-contention", difficulty: "HARD" });
    const toolUser = bots.find((b) => (b.tools ?? []).length > 0)!;

    const finalPromise = waitForEvent<any>(bots[0]!.socket, "final:evaluated", () => true, 15000);

    await emitAck(toolUser.socket, "tool:execute", { toolId: toolUser.tools![0]!.id });
    await emitAck(toolUser.socket, "knownfact:add", { text: "A real fact added during this game.", category: "fact", sourceEvidenceId: null });
    await emitAck(toolUser.socket, "hypothesis:create", { text: "A real hypothesis.", clientMsgId: randomUUID() });

    await emitAck(bots[0]!.socket, "final:submit", {
      rootCause: "Lock contention on the order writer.",
      supportingEvidenceIds: [],
      remediation: "Shorten the transaction.",
      clientMsgId: randomUUID(),
    });
    const debrief = await finalPromise;

    expect(debrief.scenarioId).toBe("lock-contention");
    expect(debrief.scenarioTitle).toBeTruthy();
    expect(debrief.difficulty).toBe("HARD");
    expect(debrief.severity).toMatch(/^SEV-\d$/);
    expect(debrief.completionSeconds).toBeGreaterThanOrEqual(0);

    expect(debrief.roleContributions).toHaveLength(3);
    for (const rc of debrief.roleContributions) {
      expect(bots.some((b) => b.playerId === rc.playerId)).toBe(true);
      expect(rc.displayName).toBeTruthy();
      expect(rc.role).toBeTruthy();
    }

    const contributorRow = debrief.roleContributions.find((rc: any) => rc.playerId === toolUser.playerId);
    expect(contributorRow.toolsExecuted).toBeGreaterThanOrEqual(1);
    expect(contributorRow.knownFactsAdded).toBe(1);
    expect(contributorRow.hypothesesProposed).toBe(1);

    // Adversarial: a player who did nothing gets real zeros, never a fabricated non-zero count.
    const idleBot = bots.find((b) => b.playerId !== toolUser.playerId)!;
    const idleRow = debrief.roleContributions.find((rc: any) => rc.playerId === idleBot.playerId);
    expect(idleRow.toolsExecuted).toBe(0);
    expect(idleRow.knownFactsAdded).toBe(0);
    expect(idleRow.hypothesesProposed).toBe(0);
    void gameId;
  });
});

describe("V0.6.4: shareable results", () => {
  it("GET /api/games/:gameId/result publicly returns the same debrief a player already saw, with no auth/cookie required", async () => {
    const { gameId } = await setupCompletedGame(server.url, 3);
    const res = await fetch(`${server.url}/api/games/${gameId}/result`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gameId: string; completedAt: string; debrief: any };
    expect(body.gameId).toBe(gameId);
    expect(body.completedAt).toBeTruthy();
    expect(body.debrief.score.total).toBeGreaterThanOrEqual(0);
    expect(body.debrief.scenarioTitle).toBeTruthy();
  });

  it("404s (never a fabricated/partial result) for a game that hasn't finished yet - adversarial case", async () => {
    const { gameId } = await setupActiveGame(server.url, 3);
    const res = await fetch(`${server.url}/api/games/${gameId}/result`);
    expect(res.status).toBe(404);
  });

  it("404s for an unknown gameId", async () => {
    const res = await fetch(`${server.url}/api/games/${randomUUID()}/result`);
    expect(res.status).toBe(404);
  });
});

describe("V0.6.5: room-scoped leaderboard", () => {
  it("is empty for a room with no completed games, and never errors", async () => {
    const { roomCode } = await setupActiveGame(server.url, 3);
    const res = await fetch(`${server.url}/api/rooms/${roomCode}/leaderboard`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });

  it("404s for an unknown room code", async () => {
    const res = await fetch(`${server.url}/api/rooms/ZZZZZZ/leaderboard`);
    expect(res.status).toBe(404);
  });

  it("reflects a completed game with its real score, scenario, and players - and after a rematch, the new game's row never leaks the old game's role-contribution counts", async () => {
    const first = await setupCompletedGame(server.url, 3, { scenarioId: "memory-leak" });

    const board1 = (await (await fetch(`${server.url}/api/rooms/${first.roomCode}/leaderboard`)).json()) as { entries: any[] };
    expect(board1.entries).toHaveLength(1);
    expect(board1.entries[0].gameId).toBe(first.gameId);
    expect(board1.entries[0].scenarioTitle).toBeTruthy();
    expect(board1.entries[0].players).toHaveLength(3);
    expect(board1.entries[0].players.every((p: any) => p.displayName && p.role)).toBe(true);

    const lobbyPromise = waitForEvent<any>(first.bots[0]!.socket, "room:snapshot", (s) => s.phase === "LOBBY", 10000);
    await emitAck(first.bots[0]!.socket, "game:rematch", {});
    await lobbyPromise;

    const secondActive = await setupActiveGame(server.url, 3, "instant", {
      scenarioId: "checkout-degradation",
      bots: first.bots,
      roomCode: first.roomCode,
    });
    const finalPromise = waitForEvent<any>(secondActive.bots[0]!.socket, "final:evaluated", () => true, 15000);
    await emitAck(secondActive.bots[0]!.socket, "final:submit", {
      rootCause: "N+1 query against the product catalog.",
      supportingEvidenceIds: [],
      remediation: "Batch the lookup.",
      clientMsgId: randomUUID(),
    });
    const secondDebrief = await finalPromise;
    // Nobody touched a tool/hypothesis/fact in the fresh game - every contributor row must be a
    // real zero, not a carry-over of whatever the first (now-unrelated) game's players did.
    expect(secondDebrief.roleContributions.every((rc: any) => rc.toolsExecuted === 0 && rc.hypothesesProposed === 0 && rc.knownFactsAdded === 0)).toBe(
      true,
    );

    const board2 = (await (await fetch(`${server.url}/api/rooms/${first.roomCode}/leaderboard`)).json()) as { entries: any[] };
    expect(board2.entries).toHaveLength(2);
    const gameIds = board2.entries.map((e) => e.gameId).sort();
    expect(gameIds).toEqual([first.gameId, secondActive.gameId].sort());
  });
});

describe("V0.6: scenario catalog sanity (regression guard for scenarioTitle lookups above)", () => {
  it("every built-in scenario id used above is a real catalog entry", () => {
    const ids = listScenarioCatalog().map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["lock-contention", "memory-leak", "checkout-degradation"]));
  });
});
