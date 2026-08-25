import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { io as ioc } from "socket.io-client";
import { connectSocket, emitAckRaw, resetDatabase, setupActiveGame, startTestServer, waitForEvent, type TestServerHandle } from "./testHarness.js";

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

describe("security: socket authentication", () => {
  it("rejects a socket connection with no session cookie", async () => {
    const result = await new Promise<string>((resolve) => {
      const socket = ioc(server.url, { transports: ["websocket"] });
      socket.on("connect_error", (err) => resolve(err.message));
      socket.on("connect", () => resolve("CONNECTED_UNEXPECTEDLY"));
    });
    expect(result).toBe("NOT_AUTHORIZED");
  });

  it("rejects a socket connection with a garbage cookie", async () => {
    const result = await new Promise<string>((resolve) => {
      const socket = ioc(server.url, {
        transports: ["websocket"],
        extraHeaders: { Cookie: "raid_session=not-a-real-id.not-a-real-token" },
      });
      socket.on("connect_error", (err) => resolve(err.message));
      socket.on("connect", () => resolve("CONNECTED_UNEXPECTEDLY"));
    });
    expect(result).toBe("NOT_AUTHORIZED");
  });
});

describe("security: role-based evidence isolation", () => {
  it("a player's game:snapshot never contains another role's evidence, even after it unlocks", async () => {
    const { bots, roomCode } = await setupActiveGame(server.url, 4);
    const backend = bots.find((b) => b.role === "backend_engineer")!;
    const dbEngineer = bots.find((b) => b.role === "database_engineer")!;

    // DB engineer unlocks DB-only evidence (db_pool_config, visible only to database_engineer).
    await emitAckRaw(dbEngineer.socket, "tool:execute", { toolId: "active_connections" });
    // Backend engineer also unlocks their own evidence in parallel.
    await emitAckRaw(backend.socket, "tool:execute", { toolId: "deployments" });

    // Reconnecting resends a fresh, server-computed game:snapshot for backend's identity/role.
    backend.socket.disconnect();
    const freshSocket = await connectSocket(server.url, backend, roomCode);
    const snap = await waitForEvent<any>(freshSocket, "game:snapshot", () => true, 10000);

    const evidenceIds: string[] = snap.evidence.map((e: any) => e.id);
    expect(evidenceIds).toContain("be_deploy_log");
    expect(evidenceIds.some((id) => id.startsWith("db_"))).toBe(false);
    expect(snap.myRole).toBe("backend_engineer");
    freshSocket.disconnect();
  });

  it("rejects a player executing a tool belonging to another role", async () => {
    const { bots } = await setupActiveGame(server.url, 4);
    const backend = bots.find((b) => b.role === "backend_engineer")!;

    const result = await emitAckRaw(backend.socket, "tool:execute", { toolId: "active_connections" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("WRONG_ROLE");
  });

  it("rejects attaching evidence that has not been unlocked yet, even with a guessed valid id", async () => {
    const { bots } = await setupActiveGame(server.url, 4);
    const backend = bots.find((b) => b.role === "backend_engineer")!;

    const { hypothesisId } = (
      await emitAckRaw<{ hypothesisId: string }>(backend.socket, "hypothesis:create", {
        text: "Guessing an evidence id before it unlocked",
        clientMsgId: crypto.randomUUID(),
      })
    ).data!;

    // be_deploy_log is a real evidence id in the scenario, but it hasn't been unlocked
    // yet (deployments tool hasn't been executed) - guessing the id must not work.
    const result = await emitAckRaw(backend.socket, "evidence:attach", { hypothesisId, evidenceId: "be_deploy_log" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_AUTHORIZED");
  });

  it("rejects attaching evidence visible only to a different role, even once unlocked for that role", async () => {
    const { bots } = await setupActiveGame(server.url, 4);
    const backend = bots.find((b) => b.role === "backend_engineer")!;
    const dbEngineer = bots.find((b) => b.role === "database_engineer")!;

    await emitAckRaw(dbEngineer.socket, "tool:execute", { toolId: "active_connections" }); // unlocks db_pool_config for DB role only

    const { hypothesisId } = (
      await emitAckRaw<{ hypothesisId: string }>(backend.socket, "hypothesis:create", {
        text: "Trying to cite DB evidence I cannot see",
        clientMsgId: crypto.randomUUID(),
      })
    ).data!;

    const result = await emitAckRaw(backend.socket, "evidence:attach", { hypothesisId, evidenceId: "db_pool_config" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_AUTHORIZED");
  });

  it("rejects an unknown/hallucinated evidence id outright", async () => {
    const { bots } = await setupActiveGame(server.url, 4);
    const backend = bots.find((b) => b.role === "backend_engineer")!;
    const { hypothesisId } = (
      await emitAckRaw<{ hypothesisId: string }>(backend.socket, "hypothesis:create", {
        text: "Attaching a made up evidence id",
        clientMsgId: crypto.randomUUID(),
      })
    ).data!;

    const result = await emitAckRaw(backend.socket, "evidence:attach", { hypothesisId, evidenceId: "totally_not_real" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PAYLOAD");
  });
});

describe("security: final diagnosis authority", () => {
  it("only the Incident Commander may submit the final diagnosis in a 4-player game", async () => {
    const { bots } = await setupActiveGame(server.url, 4);
    const nonIc = bots.find((b) => b.role !== "incident_commander")!;

    const result = await emitAckRaw(nonIc.socket, "final:submit", {
      rootCause: "Attempting to submit without authority, with enough length to pass validation.",
      supportingEvidenceIds: [],
      remediation: "n/a - should be rejected before this even matters",
      clientMsgId: crypto.randomUUID(),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_AUTHORIZED");
  });
});

describe("security: abandoned 'ghost' joins cannot deny service", () => {
  it("an unready player who never connected does not block Start for the connected players", async () => {
    const { createRoomHttp, joinRoomHttp } = await import("./testHarness.js");
    const { roomCode, ...host } = await createRoomHttp(server.url, "RealHost");
    const p2 = await joinRoomHttp(server.url, roomCode, "Real2");
    const p3 = await joinRoomHttp(server.url, roomCode, "Real3");
    // A 4th player joins over REST but never opens a socket and never readies up.
    await joinRoomHttp(server.url, roomCode, "GhostWhoNeverConnects");

    const sockets = [];
    for (const identity of [host, p2, p3]) {
      const s = await connectSocket(server.url, identity, roomCode);
      await emitAckRaw(s, "player:ready", { ready: true });
      sockets.push(s);
    }

    // Before the fix this failed with "All players must be ready" - the ghost held the room hostage.
    const result = await emitAckRaw(sockets[0]!, "game:start", { durationPreset: "instant" });
    expect(result.ok).toBe(true);
    for (const s of sockets) s.disconnect();
  });

  it("still enforces the 4-player cap against recent joins (grace window respected)", async () => {
    const { createRoomHttp, joinRoomHttp } = await import("./testHarness.js");
    const { roomCode } = await createRoomHttp(server.url, "RealHost");
    for (const name of ["P2", "P3", "P4"]) {
      await joinRoomHttp(server.url, roomCode, name);
    }
    await expect(joinRoomHttp(server.url, roomCode, "P5")).rejects.toThrow(/ROOM_FULL/);
  });
});

describe("security: malformed payloads", () => {
  it("rejects an oversized chat message", async () => {
    const { bots } = await setupActiveGame(server.url, 3);
    const result = await emitAckRaw(bots[0]!.socket, "chat:send", { text: "x".repeat(5000), clientMsgId: crypto.randomUUID() });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PAYLOAD");
  });

  it("rejects a non-UUID clientMsgId", async () => {
    const { bots } = await setupActiveGame(server.url, 3);
    const result = await emitAckRaw(bots[0]!.socket, "chat:send", { text: "hi", clientMsgId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PAYLOAD");
  });
});
