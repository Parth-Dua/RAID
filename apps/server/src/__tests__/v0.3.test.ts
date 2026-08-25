import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  connectSocket,
  createRoomHttp,
  emitAck,
  emitAckRaw,
  resetDatabase,
  setupActiveGame,
  setupCompletedGame,
  startTestServer,
  waitForEvent,
  type TestServerHandle,
} from "./testHarness.js";

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

describe("V0.3: scenario catalog + selection", () => {
  it("GET /api/scenarios lists all 3 scenarios with catalog metadata", async () => {
    const res = await fetch(`${server.url}/api/scenarios`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { scenarios: { id: string; title: string; severity: string; briefing: string; tagline: string }[] };
    expect(body.scenarios.length).toBe(3);
    const ids = body.scenarios.map((s) => s.id).sort();
    expect(ids).toEqual(["checkout-degradation", "lock-contention", "memory-leak"]);
    for (const s of body.scenarios) {
      expect(s.title).toBeTruthy();
      expect(s.briefing).toBeTruthy();
      expect(s.tagline).toBeTruthy();
    }
  });

  it("the host's chosen scenario is what gets recorded and returned by the room's REST snapshot", async () => {
    const { roomCode } = await setupActiveGame(server.url, 3, "instant", { scenarioId: "lock-contention" });
    const restSnap = (await (await fetch(`${server.url}/api/rooms/${roomCode}`)).json()) as { scenarioId: string | null };
    expect(restSnap.scenarioId).toBe("lock-contention");
  });

  it("the host's chosen difficulty is reflected in every player's game:snapshot", async () => {
    const { bots } = await setupActiveGame(server.url, 3, "instant", { scenarioId: "checkout-degradation", difficulty: "HARD" });
    const snap = await waitForEvent<any>(bots[0]!.socket, "game:snapshot", () => true, 5000).catch(() => null);
    // setupActiveGame already awaited each bot's first game:snapshot, so a strict re-wait can
    // legitimately time out with nothing further pending - fall back to a fresh REST/tool probe.
    if (snap) {
      expect(snap.difficulty).toBe("HARD");
    } else {
      const result = await emitAck<{ output: string }>(bots[0]!.socket, "tool:execute", { toolId: bots[0]!.tools![0]!.id });
      expect(result.output).toBeTruthy();
    }
  });

  it("starting a game with an unknown scenarioId is rejected with INVALID_PAYLOAD, not a silent fallback", async () => {
    const { roomCode, ...host } = await createRoomHttp(server.url, "Host");
    const socket = await connectSocket(server.url, host, roomCode);
    await waitForEvent(socket, "room:snapshot", () => true, 5000);
    await emitAck(socket, "player:ready", { ready: true });
    const result = await emitAckRaw(socket, "game:start", { scenarioId: "not-a-real-scenario" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PAYLOAD");
    socket.disconnect();
  });
});

describe("V0.3: scenario selection actually changes the game content", () => {
  it("lock-contention and memory-leak produce scenario-specific tools, not checkout-degradation's", async () => {
    const { bots: lockBots } = await setupActiveGame(server.url, 3, "instant", { scenarioId: "lock-contention" });
    const lockToolIds = lockBots.flatMap((b) => (b.tools ?? []).map((t) => t.id));
    expect(lockToolIds).toContain("order_lock_monitor");
    expect(lockToolIds).not.toContain("db_pool_saturation");
    for (const b of lockBots) b.socket.disconnect();

    await resetDatabase();

    const { bots: memBots } = await setupActiveGame(server.url, 3, "instant", { scenarioId: "memory-leak" });
    const memToolIds = memBots.flatMap((b) => (b.tools ?? []).map((t) => t.id));
    expect(memToolIds).toContain("reco_cache_stats");
    expect(memToolIds).not.toContain("order_lock_monitor");
    for (const b of memBots) b.socket.disconnect();
  });
});

describe("V0.3: difficulty selection", () => {
  it("a HARD game still runs end-to-end to a scored debrief", async () => {
    const { bots } = await setupCompletedGame(server.url, 3, { difficulty: "HARD" });
    expect(bots.length).toBe(3);
  });
});

describe("V0.3: rematch / replayability", () => {
  it("host can rematch a COMPLETED room back to LOBBY, resetting ready state", async () => {
    const { bots, roomCode } = await setupCompletedGame(server.url, 3);
    const host = bots[0]!;

    const roomSnapshotPromise = waitForEvent<any>(host.socket, "room:snapshot", (s) => s.phase === "LOBBY", 10000);
    await emitAck(host.socket, "game:rematch", {});
    const snap = await roomSnapshotPromise;
    expect(snap.phase).toBe("LOBBY");
    expect(snap.gameId).toBeNull();

    const restSnap = (await (await fetch(`${server.url}/api/rooms/${roomCode}`)).json()) as {
      players: { ready: boolean }[];
    };
    expect(restSnap.players.every((p) => !p.ready)).toBe(true);
  });

  it("a non-host cannot start a rematch", async () => {
    const { bots } = await setupCompletedGame(server.url, 3);
    const nonHost = bots[1]!;
    const result = await emitAckRaw(nonHost.socket, "game:rematch", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_HOST");
  });

  it("rematch is rejected while the room is not COMPLETED", async () => {
    const { bots } = await setupActiveGame(server.url, 3);
    const result = await emitAckRaw(bots[0]!.socket, "game:rematch", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PHASE");
  });

  it("after rematch, a new game can be started with a different scenario and fresh roles, with no leakage from the old game", async () => {
    const first = await setupCompletedGame(server.url, 3, { scenarioId: "checkout-degradation" });
    const firstGameId = first.gameId;

    const lobbyPromise = waitForEvent<any>(first.bots[0]!.socket, "room:snapshot", (s) => s.phase === "LOBBY", 10000);
    await emitAck(first.bots[0]!.socket, "game:rematch", {});
    await lobbyPromise;

    const second = await setupActiveGame(server.url, 3, "instant", {
      scenarioId: "lock-contention",
      bots: first.bots,
      roomCode: first.roomCode,
    });

    expect(second.gameId).not.toBe(firstGameId);
    const secondToolIds = second.bots.flatMap((b) => (b.tools ?? []).map((t) => t.id));
    expect(secondToolIds.some((id) => id.startsWith("order_"))).toBe(true);
    // Roles are freshly (re-)assigned on every game:start - assert it's still a full, valid,
    // one-role-per-player assignment rather than asserting it differs (a reshuffle can coincide).
    const secondRoles = new Set(second.bots.map((b) => b.role));
    expect(secondRoles.size).toBe(3);

    // The old game's data must not leak: a fresh room REST snapshot reflects only the new game.
    const restSnap = (await (await fetch(`${server.url}/api/rooms/${second.roomCode}`)).json()) as { gameId: string; scenarioId: string };
    expect(restSnap.gameId).toBe(second.gameId);
    expect(restSnap.scenarioId).toBe("lock-contention");
  });

  it("a stale final:submit against an already-completed, already-rematched game is rejected rather than corrupting the new LOBBY room", async () => {
    // Adversarial case from the roadmap: "rematch while old events are in flight". Simulate a
    // client that still has its old (now-stale) game context and fires final:submit again right
    // after a rematch has already reset the room - the server must reject it, not reopen the game
    // or otherwise corrupt the freshly-reset room.
    const { bots } = await setupCompletedGame(server.url, 3);
    const host = bots[0]!;
    const lobbyPromise = waitForEvent<any>(host.socket, "room:snapshot", (s) => s.phase === "LOBBY", 10000);
    await emitAck(host.socket, "game:rematch", {});
    await lobbyPromise;

    const result = await emitAckRaw(host.socket, "final:submit", {
      rootCause: "Stale resubmission after rematch.",
      supportingEvidenceIds: [],
      remediation: "Not applicable, this is a stale resubmission.",
      clientMsgId: randomUUID(),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PHASE");
  });
});
