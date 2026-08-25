import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  connectSocket,
  createRoomHttp,
  emitAck,
  emitAckRaw,
  joinRoomHttp,
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

describe("V0.2: leave room", () => {
  it("a player can leave the lobby, freeing their seat immediately", async () => {
    const { roomCode, ...host } = await createRoomHttp(server.url, "Host");
    const p2Identity = await joinRoomHttp(server.url, roomCode, "P2");
    const p3Identity = await joinRoomHttp(server.url, roomCode, "P3");
    const p4Identity = await joinRoomHttp(server.url, roomCode, "P4");

    const p3Socket = await connectSocket(server.url, p3Identity, roomCode);
    await waitForEvent(p3Socket, "room:snapshot", () => true, 10000);

    await emitAck(p3Socket, "player:leave", {});

    // Seat freed immediately (not waiting on the 60s ghost-join grace window).
    const rejoined = await joinRoomHttp(server.url, roomCode, "P3-again");
    expect(rejoined.playerId).toBeTruthy();

    const snap = (await (await fetch(`${server.url}/api/rooms/${roomCode}`)).json()) as { players: { displayName: string }[] };
    expect(snap.players.map((p) => p.displayName).sort()).toEqual(["Host", "P2", "P3-again", "P4"].sort());

    p3Socket.disconnect();
  });

  it("the host leaving the lobby transfers host to another connected player", async () => {
    const { roomCode, ...host } = await createRoomHttp(server.url, "Host");
    const p2Identity = await joinRoomHttp(server.url, roomCode, "P2");

    const hostSocket = await connectSocket(server.url, host, roomCode);
    const p2Socket = await connectSocket(server.url, p2Identity, roomCode);
    await waitForEvent(hostSocket, "room:snapshot", () => true, 10000);
    await waitForEvent(p2Socket, "room:snapshot", () => true, 10000);

    const snapPromise = waitForEvent<any>(p2Socket, "room:snapshot", (s) => s.players.length === 1 && s.players[0].isHost, 10000);
    await emitAck(hostSocket, "player:leave", {});
    const snap = await snapPromise;
    expect(snap.players[0].id).toBe(p2Identity.playerId);
    p2Socket.disconnect();
  });

  it("cannot leave once the game has started - must disconnect instead", async () => {
    const { bots } = await setupActiveGame(server.url, 3);
    const result = await emitAckRaw(bots[0]!.socket, "player:leave", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PHASE");
  });
});

describe("V0.2: Incident Commander is active, not passive", () => {
  it("in a 4-player game, the IC has tools and can unlock their own evidence", async () => {
    const { bots } = await setupActiveGame(server.url, 4);
    const ic = bots.find((b) => b.role === "incident_commander")!;
    expect(ic.tools!.length).toBeGreaterThan(0);

    const result = await emitAckRaw<{ output: string; unlockedEvidenceIds: string[] }>(ic.socket, "tool:execute", {
      toolId: ic.tools![0]!.id,
    });
    expect(result.ok).toBe(true);
  });

  it("a non-IC player cannot execute the IC's tools", async () => {
    const { bots } = await setupActiveGame(server.url, 4);
    const nonIc = bots.find((b) => b.role !== "incident_commander")!;
    const result = await emitAckRaw(nonIc.socket, "tool:execute", { toolId: "service_status_board" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("WRONG_ROLE");
  });
});

describe("V0.2: knowledge board categories", () => {
  it("known facts and open questions are stored and returned with their category", async () => {
    const { bots, roomCode } = await setupActiveGame(server.url, 3);
    const author = bots[0]!;

    await emitAck(author.socket, "knownfact:add", { text: "Latency rose sharply at T+24s", category: "fact" });
    await emitAck(author.socket, "knownfact:add", { text: "Why did it start exactly then?", category: "question" });

    // Reconnecting resends a fresh, server-computed game:snapshot - read the stored categories back.
    author.socket.disconnect();
    const freshSocket = await connectSocket(server.url, author, roomCode);
    const snap = await waitForEvent<any>(freshSocket, "game:snapshot", () => true, 10000);
    const fact = snap.knownFacts.find((f: any) => f.text === "Latency rose sharply at T+24s");
    const question = snap.knownFacts.find((f: any) => f.text === "Why did it start exactly then?");
    expect(fact.category).toBe("fact");
    expect(question.category).toBe("question");
    freshSocket.disconnect();
  });

  it("defaults to category 'fact' when omitted", async () => {
    const { bots } = await setupActiveGame(server.url, 3);
    const author = bots[0]!;
    const result = await emitAckRaw(author.socket, "knownfact:add", { text: "Defaulted category test fact" });
    expect(result.ok).toBe(true);
  });
});
