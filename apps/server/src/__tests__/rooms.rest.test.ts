import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRoomHttp, joinRoomHttp, resetDatabase, startTestServer, type TestServerHandle } from "./testHarness.js";

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

describe("REST: room lifecycle", () => {
  it("creates a room and returns a session cookie", async () => {
    const { roomCode, playerId, cookie } = await createRoomHttp(server.url, "Alice");
    expect(roomCode).toMatch(/^[A-Z0-9]{5}$/);
    expect(playerId).toBeTruthy();
    expect(cookie).toContain("raid_session=");
  });

  it("allows a second player to join and both appear in the snapshot", async () => {
    const { roomCode } = await createRoomHttp(server.url, "Alice");
    await joinRoomHttp(server.url, roomCode, "Bob");

    const res = await fetch(`${server.url}/api/rooms/${roomCode}`);
    const snapshot = (await res.json()) as { players: { displayName: string }[] };
    expect(snapshot.players.map((p) => p.displayName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("rejects joining a nonexistent room", async () => {
    const res = await fetch(`${server.url}/api/rooms/ZZZZZ/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Nobody" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ROOM_NOT_FOUND");
  });

  it("rejects a 5th player joining a full room", async () => {
    const { roomCode } = await createRoomHttp(server.url, "P1");
    await joinRoomHttp(server.url, roomCode, "P2");
    await joinRoomHttp(server.url, roomCode, "P3");
    await joinRoomHttp(server.url, roomCode, "P4");

    const res = await fetch(`${server.url}/api/rooms/${roomCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "P5" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ROOM_FULL");
  });

  it("rejects an empty display name", async () => {
    const res = await fetch(`${server.url}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "" }),
    });
    expect(res.status).toBe(400);
  });
});
