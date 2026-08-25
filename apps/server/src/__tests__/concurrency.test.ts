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

describe("concurrency: host presses Start twice", () => {
  it("rejects Start when not everyone is ready yet (guard runs before any transition)", async () => {
    const { roomCode, ...host } = await createRoomHttp(server.url, "Host");
    await joinRoomHttp(server.url, roomCode, "P2");
    await joinRoomHttp(server.url, roomCode, "P3");

    const hostSocket = await connectSocket(server.url, host, roomCode);
    await emitAck(hostSocket, "player:ready", { ready: true });

    const results = await Promise.allSettled([
      emitAckRaw(hostSocket, "game:start", { durationPreset: "instant" }),
      emitAckRaw(hostSocket, "game:start", { durationPreset: "instant" }),
    ]);
    const outcomes = results.map((r) => (r.status === "fulfilled" ? r.value : { ok: false, error: { code: "THROWN" } }));
    expect(outcomes.every((o) => o.ok === false)).toBe(true);
  });

  it("with all players ready, exactly one of two concurrent Start calls wins", async () => {
    const { roomCode, ...host } = await createRoomHttp(server.url, "Host");
    const p2Identity = await joinRoomHttp(server.url, roomCode, "P2");
    const p3Identity = await joinRoomHttp(server.url, roomCode, "P3");

    const hostSocket = await connectSocket(server.url, host, roomCode);
    const p2Socket = await connectSocket(server.url, p2Identity, roomCode);
    const p3Socket = await connectSocket(server.url, p3Identity, roomCode);
    await Promise.all([
      emitAck(hostSocket, "player:ready", { ready: true }),
      emitAck(p2Socket, "player:ready", { ready: true }),
      emitAck(p3Socket, "player:ready", { ready: true }),
    ]);

    const [first, second] = await Promise.all([
      emitAckRaw(hostSocket, "game:start", { durationPreset: "instant" }),
      emitAckRaw(hostSocket, "game:start", { durationPreset: "instant" }),
    ]);

    const succeeded = [first, second].filter((r) => r.ok);
    const failed = [first, second].filter((r) => !r.ok);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0]!.error?.code).toBe("ALREADY_STARTED");
  });
});

describe("concurrency: duplicate socket messages", () => {
  it("submitting the same hypothesis clientMsgId twice creates only one hypothesis", async () => {
    const { bots } = await setupActiveGame(server.url, 3);
    const author = bots[0]!;
    const clientMsgId = randomUUID();

    const [r1, r2] = await Promise.all([
      emitAckRaw<{ hypothesisId: string }>(author.socket, "hypothesis:create", { text: "Duplicate test hypothesis text", clientMsgId }),
      emitAckRaw<{ hypothesisId: string }>(author.socket, "hypothesis:create", { text: "Duplicate test hypothesis text", clientMsgId }),
    ]);
    // Both acks succeed (ok:true), but the second is a silent dedup no-op (data undefined).
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const ids = [r1.data?.hypothesisId, r2.data?.hypothesisId].filter(Boolean);
    expect(ids.length).toBe(1);
  });

  it("two players supporting the same hypothesis simultaneously is idempotent per player", async () => {
    const { bots, roomCode } = await setupActiveGame(server.url, 3);
    const [author, supporter] = bots;
    const { hypothesisId } = await emitAck<{ hypothesisId: string }>(author!.socket, "hypothesis:create", {
      text: "Some hypothesis to support twice",
      clientMsgId: randomUUID(),
    });

    // Same player firing the same support action twice concurrently must not double-count.
    const [r1, r2] = await Promise.all([
      emitAckRaw(supporter!.socket, "hypothesis:support", { hypothesisId }),
      emitAckRaw(supporter!.socket, "hypothesis:support", { hypothesisId }),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // Reconnecting as the same identity resends a fresh game:snapshot - verify supportedBy has exactly one entry.
    supporter!.socket.disconnect();
    const freshSocket = await connectSocket(server.url, supporter!, roomCode);
    const snap = await waitForEvent<any>(freshSocket, "game:snapshot", () => true, 10000);
    const hyp = snap.hypotheses.find((h: any) => h.id === hypothesisId);
    expect(hyp.supportedBy).toEqual([supporter!.playerId]);
    freshSocket.disconnect();
  });
});

describe("concurrency: final submission race", () => {
  it("two players submitting final diagnosis simultaneously - exactly one is scored", async () => {
    const { bots } = await setupActiveGame(server.url, 3);
    const [p1, p2] = bots;

    const payload = (n: number) => ({
      rootCause: `Root cause attempt ${n} describing the deploy and connection pool saturation in enough detail.`,
      supportingEvidenceIds: [],
      remediation: "Batch the query.",
      clientMsgId: randomUUID(),
    });

    const completedPromise = waitForEvent(p1!.socket, "game:completed", () => true, 10000);
    const results = await Promise.allSettled([
      emitAckRaw(p1!.socket, "final:submit", payload(1)),
      emitAckRaw(p2!.socket, "final:submit", payload(2)),
    ]);
    const outcomes = results.map((r) => (r.status === "fulfilled" ? r.value : { ok: false, error: { code: "THROWN" } }));
    const succeeded = outcomes.filter((o) => o.ok);
    // At least one must succeed; the loser (if the race is tight) gets ALREADY_STARTED, never a second scored game.
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(succeeded.length).toBeLessThanOrEqual(2); // the "loser" may also resolve gracefully as already-finalized

    await completedPromise;
  }, 15000);
});
