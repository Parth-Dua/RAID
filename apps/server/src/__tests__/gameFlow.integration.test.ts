import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  connectSocket,
  emitAck,
  emitAckRaw,
  resetDatabase,
  setupActiveGame,
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

describe("full game loop", () => {
  it("goes from room creation to a scored, completed game", async () => {
    const { bots } = await setupActiveGame(server.url, 4);
    expect(new Set(bots.map((b) => b.role)).size).toBe(4); // every role assigned exactly once

    for (const bot of bots) {
      for (const tool of bot.tools ?? []) {
        await emitAck(bot.socket, "tool:execute", { toolId: tool.id });
      }
    }

    const author = bots[0]!;
    const { hypothesisId } = await emitAck<{ hypothesisId: string }>(author.socket, "hypothesis:create", {
      text: "The deploy caused repeated per-item queries overloading the connection pool.",
      clientMsgId: randomUUID(),
    });
    await waitForEvent<any>(author.socket, "hypothesis:updated", (h) => h.id === hypothesisId && h.status !== "OPEN", 10000);

    const ic = bots.find((b) => b.role === "incident_commander")!;
    const finalPromise = waitForEvent<any>(ic.socket, "final:evaluated", () => true, 15000);
    const completedPromise = waitForEvent(ic.socket, "game:completed", () => true, 15000);
    await emitAck(ic.socket, "final:submit", {
      rootCause: "The deploy added a per-item loyalty lookup, saturating the connection pool and causing 5xx errors.",
      supportingEvidenceIds: [],
      remediation: "Batch the query.",
      clientMsgId: randomUUID(),
    });
    const debrief = await finalPromise;
    await completedPromise;

    expect(debrief.score.total).toBeGreaterThanOrEqual(0);
    expect(debrief.score.total).toBeLessThanOrEqual(100);
    expect(debrief.rootCauseSummary).toBeTruthy();
    expect(debrief.timeline.length).toBeGreaterThan(0);
  });
});

describe("reconnect / session restoration", () => {
  it("a reconnecting player keeps their identity, role, and previously unlocked evidence", async () => {
    const { bots, roomCode } = await setupActiveGame(server.url, 4);
    const backend = bots.find((b) => b.role === "backend_engineer")!;

    await emitAck(backend.socket, "tool:execute", { toolId: "deployments" });

    backend.socket.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    const freshSocket = await connectSocket(server.url, backend, roomCode);
    const roomSnap = await waitForEvent<any>(freshSocket, "room:snapshot", () => true, 10000);
    const me = roomSnap.players.find((p: any) => p.id === backend.playerId);
    expect(me.connected).toBe(true);

    const gameSnap = await waitForEvent<any>(freshSocket, "game:snapshot", () => true, 10000);
    expect(gameSnap.myRole).toBe("backend_engineer");
    expect(gameSnap.evidence.some((e: any) => e.id === "be_deploy_log")).toBe(true);
    freshSocket.disconnect();
  });

  it("host disconnecting in the lobby transfers host to another connected player", async () => {
    const { createRoomHttp, joinRoomHttp } = await import("./testHarness.js");
    const { roomCode, ...host } = await createRoomHttp(server.url, "Host");
    const p2Identity = await joinRoomHttp(server.url, roomCode, "P2");

    const hostSocket = await connectSocket(server.url, host, roomCode);
    const p2Socket = await connectSocket(server.url, p2Identity, roomCode);
    // Wait for each socket's own post-connect room:snapshot so we know their handleConnection
    // (which joins the Socket.IO room server-side) has actually completed before disconnecting.
    await waitForEvent(hostSocket, "room:snapshot", () => true, 10000);
    await waitForEvent(p2Socket, "room:snapshot", () => true, 10000);

    const snapPromise = waitForEvent<any>(p2Socket, "room:snapshot", (s) => s.players.find((p: any) => p.id === p2Identity.playerId)?.isHost, 10000);
    hostSocket.disconnect();
    const snap = await snapPromise;
    const newHost = snap.players.find((p: any) => p.isHost);
    expect(newHost.id).toBe(p2Identity.playerId);
    p2Socket.disconnect();
  }, 15000);
});

describe("timer-driven auto-finalization", () => {
  it("finalizes the game automatically when the instant-preset timer runs out with no submission", async () => {
    const { bots } = await setupActiveGame(server.url, 3, "instant");
    const someone = bots[0]!;

    const completed = await waitForEvent(someone.socket, "game:completed", () => true, 75000);
    expect(completed).toBeTruthy();

    const debrief = await waitForEvent<any>(someone.socket, "final:evaluated", () => true, 1000).catch(() => null);
    // final:evaluated may have already been delivered before this listener attached (it fires
    // just before game:completed) - either way, game:completed proves auto-finalization ran.
    void debrief;
  }, 80000);
});
