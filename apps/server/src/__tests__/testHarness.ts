import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as ioc, type Socket } from "socket.io-client";
import { sql } from "drizzle-orm";
import { createApp } from "../app.js";
import { db } from "../db/client.js";
import { registerSocketHandlers } from "../sockets/index.js";

export interface TestServerHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServerHandle> {
  const app = createApp();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: "*", credentials: true } });
  registerSocketHandlers(io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}

export async function resetDatabase(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      game_results, final_submissions, hypothesis_evidence, hypothesis_reactions,
      hypotheses, known_facts, chat_messages, tool_actions, game_evidence,
      game_players, games, game_events, players, rooms
    RESTART IDENTITY CASCADE
  `);
}

export interface TestIdentity {
  playerId: string;
  cookie: string;
}

export async function createRoomHttp(url: string, displayName: string): Promise<{ roomCode: string } & TestIdentity> {
  const res = await fetch(`${url}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error(`createRoom failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { roomCode: string; playerId: string };
  return { roomCode: body.roomCode, playerId: body.playerId, cookie: extractCookie(res) };
}

export async function joinRoomHttp(url: string, roomCode: string, displayName: string): Promise<TestIdentity> {
  const res = await fetch(`${url}/api/rooms/${roomCode}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error(`joinRoom failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { playerId: string };
  return { playerId: body.playerId, cookie: extractCookie(res) };
}

function extractCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("No Set-Cookie header in response");
  return setCookie.split(";")[0]!;
}

export function connectSocket(url: string, identity: TestIdentity, roomCode: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioc(url, {
      transports: ["websocket"],
      extraHeaders: { Cookie: identity.cookie },
      auth: { roomCode },
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

export function emitAck<T = unknown>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket
      .timeout(10000)
      .emit(event, payload, (err: Error | null, response: { ok: boolean; data?: T; error?: { code: string; message: string } }) => {
        if (err) return reject(new Error(`${event} ack timeout: ${err.message}`));
        if (!response.ok) return reject(Object.assign(new Error(`${event} rejected`), { code: response.error?.code }));
        resolve(response.data as T);
      });
  });
}

export function emitAckRaw<T = unknown>(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, payload, (err: Error | null, response: any) => {
      if (err) return reject(new Error(`${event} ack timeout: ${err.message}`));
      resolve(response);
    });
  });
}

export function waitForEvent<T>(socket: Socket, event: string, predicate: (v: T) => boolean = () => true, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (v: T) => {
      if (predicate(v)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(v);
      }
    };
    socket.on(event, handler);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface TestBot extends TestIdentity {
  name: string;
  socket: Socket;
  role?: string | null;
  tools?: { id: string; name: string }[];
}

/** Spins up a room with N ready, connected, role-assigned players and starts the game. */
export async function setupActiveGame(
  url: string,
  playerCount: 3 | 4,
  durationPreset: "instant" | "demo" | "standard" = "instant",
): Promise<{ roomCode: string; gameId: string; bots: TestBot[] }> {
  const names = ["Host", "Ada", "Grace", "Linus"].slice(0, playerCount);
  const { roomCode, ...hostIdentity } = await createRoomHttp(url, names[0]!);
  const identities: (TestIdentity & { name: string })[] = [{ ...hostIdentity, name: names[0]! }];
  for (const name of names.slice(1)) {
    const identity = await joinRoomHttp(url, roomCode, name);
    identities.push({ ...identity, name });
  }

  const bots: TestBot[] = [];
  for (const identity of identities) {
    const socket = await connectSocket(url, identity, roomCode);
    bots.push({ ...identity, socket });
  }
  for (const bot of bots) {
    await emitAck(bot.socket, "player:ready", { ready: true });
  }

  const snapshotPromises = bots.map((bot) =>
    waitForEvent<any>(bot.socket, "game:snapshot", () => true, 10000).then((snap) => {
      bot.role = snap.myRole;
      bot.tools = snap.tools;
    }),
  );
  const { gameId } = await emitAck<{ gameId: string }>(bots[0]!.socket, "game:start", { durationPreset });
  await Promise.all(snapshotPromises);

  return { roomCode, gameId, bots };
}
