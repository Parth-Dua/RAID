/**
 * End-to-end bot-player regression script (spec section 35). Drives a full
 * 4-player game through the REAL REST + Socket.IO API (no shortcuts, no
 * direct DB access) from room creation through debrief. Run against a
 * running server:
 *
 *   pnpm --filter @raid/server dev &   # or: pnpm dev
 *   pnpm bots
 *
 * Uses AI_PROVIDER=mock by default (whatever the running server is
 * configured with) and the "instant" duration preset (60s) so the full
 * time-gated evidence pipeline exercises in well under a minute instead of
 * the real 5-25 minute game length.
 */
import { io, type Socket } from "socket.io-client";

const BASE_URL = process.env.RAID_SERVER_URL ?? "http://localhost:4000";
const SCENARIO_ID = process.env.RAID_SCENARIO_ID ?? "checkout-degradation";
const DIFFICULTY = process.env.RAID_DIFFICULTY ?? "NORMAL";

/** Root-cause submission this script sends for each scenario (V0.3: 3 scenarios exist now, so
 * the previously-hardcoded checkout-degradation submission needed a lookup keyed by scenario). */
const FINAL_SUBMISSIONS: Record<string, { rootCause: string; supportingEvidenceIds: string[]; remediation: string }> = {
  "checkout-degradation": {
    rootCause:
      "The v2.14.0 deploy added a per-item loyalty_history lookup causing N+1 query volume, which saturated the fixed 20-connection database pool and caused request timeouts.",
    supportingEvidenceIds: ["be_deploy_log", "db_pool_saturation", "sre_cpu_mem_flat"],
    remediation: "Batch the loyalty_history lookup into a single query per cart and roll back if needed while it's fixed.",
  },
  "lock-contention": {
    rootCause:
      "The v4.2.0 deploy launched a backfill job that updates loyalty_tier across the whole orders table inside one long-running, uncommitted transaction, holding row locks that block every normal order-write transaction.",
    supportingEvidenceIds: ["oc_backfill_deploy", "oc_blocking_chain", "oc_cpu_mem_flat"],
    remediation: "Kill/pause the backfill job and rewrite it to run in small batches with commits and explicit lock timeouts.",
  },
  "memory-leak": {
    rootCause:
      "The v3.4.0 deploy added an in-process cache keyed by a fresh per-request ID instead of user ID, so cache entries are never reused or evicted and pod memory grows without bound until Kubernetes OOM-kills each pod.",
    supportingEvidenceIds: ["reco_deploy_note", "reco_cache_growth", "reco_cpu_mem_sawtooth"],
    remediation: "Roll back or feature-flag off the cache; fix it to key on userId with a bounded LRU eviction policy.",
  },
};

interface BotIdentity {
  name: string;
  playerId: string;
  cookie: string;
  socket?: Socket;
  role?: string | null;
  tools?: { id: string; name: string }[];
}

function log(label: string, ...rest: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(`[bots] ${label}`, ...rest);
}

function extractCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("No Set-Cookie header in response");
  return setCookie.split(";")[0]!;
}

async function createRoom(displayName: string): Promise<{ roomCode: string; bot: BotIdentity }> {
  const res = await fetch(`${BASE_URL}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error(`createRoom failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { roomCode: string; playerId: string };
  return { roomCode: body.roomCode, bot: { name: displayName, playerId: body.playerId, cookie: extractCookie(res) } };
}

async function joinRoom(roomCode: string, displayName: string): Promise<BotIdentity> {
  const res = await fetch(`${BASE_URL}/api/rooms/${roomCode}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error(`joinRoom failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { playerId: string };
  return { name: displayName, playerId: body.playerId, cookie: extractCookie(res) };
}

function connectSocket(bot: BotIdentity, roomCode: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, {
      transports: ["websocket"],
      extraHeaders: { Cookie: bot.cookie },
      auth: { roomCode },
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(new Error(`${bot.name} connect_error: ${err.message}`)));
    socket.on("error", (e) => log(`${bot.name} server error`, e));
  });
}

function emitAck<T = unknown>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, payload, (err: Error | null, response: { ok: boolean; data?: T; error?: { code: string; message: string } }) => {
      if (err) return reject(new Error(`${event} ack timeout: ${err.message}`));
      if (!response.ok) return reject(new Error(`${event} rejected: ${response.error?.code} ${response.error?.message}`));
      resolve(response.data as T);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForEvent<T>(socket: Socket, event: string, predicate: (v: T) => boolean, timeoutMs = 15000): Promise<T> {
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

async function main() {
  log("creating room...");
  const { roomCode, bot: host } = await createRoom("Bot-Host");
  log("room created", roomCode);

  const others = await Promise.all([joinRoom(roomCode, "Bot-Ada"), joinRoom(roomCode, "Bot-Grace"), joinRoom(roomCode, "Bot-Linus")]);
  const bots: BotIdentity[] = [host, ...others];

  for (const bot of bots) {
    bot.socket = await connectSocket(bot, roomCode);
    log(`${bot.name} connected`, bot.socket.id);
  }
  await sleep(300);

  for (const bot of bots) {
    await emitAck(bot.socket!, "player:ready", { ready: true });
  }
  log("all players ready");

  const snapshotPromises = bots.map((bot) =>
    waitForEvent<any>(bot.socket!, "game:snapshot", () => true, 10000).then((snap) => {
      bot.role = snap.myRole;
      bot.tools = snap.tools;
      log(`${bot.name} assigned role`, bot.role, "tools:", (bot.tools ?? []).map((t) => t.id).join(","));
    }),
  );
  const { gameId } = await emitAck<{ gameId: string }>(host.socket!, "game:start", {
    durationPreset: "instant",
    scenarioId: SCENARIO_ID,
    difficulty: DIFFICULTY,
  });
  log("game started", gameId, "scenario:", SCENARIO_ID, "difficulty:", DIFFICULTY);
  await Promise.all(snapshotPromises);

  const investigators = bots.filter((b) => b.tools && b.tools.length > 0);
  const ic = bots.find((b) => b.role === "incident_commander");
  const submitter = ic ?? bots.find((b) => b.role) ?? host;

  log("running first tool pass...");
  for (const bot of investigators) {
    for (const tool of bot.tools!) {
      const result = await emitAck<{ output: string; unlockedEvidenceIds: string[] }>(bot.socket!, "tool:execute", { toolId: tool.id });
      log(`${bot.name} executed ${tool.id} -> unlocked [${result.unlockedEvidenceIds.join(",")}]`);
      await sleep(150);
    }
  }

  log("waiting for time-gated evidence thresholds...");
  await sleep(15000);

  log("running second tool pass (should surface time-gated evidence)...");
  for (const bot of investigators) {
    for (const tool of bot.tools!) {
      const result = await emitAck<{ output: string; unlockedEvidenceIds: string[] }>(bot.socket!, "tool:execute", { toolId: tool.id });
      if (result.unlockedEvidenceIds.length > 0) {
        log(`${bot.name} re-executed ${tool.id} -> newly unlocked [${result.unlockedEvidenceIds.join(",")}]`);
      }
      await sleep(150);
    }
  }

  for (const bot of investigators) {
    await emitAck(bot.socket!, "chat:send", { text: `${bot.name} here, checking in with what I've found.`, clientMsgId: crypto.randomUUID() });
  }

  log("submitting a hypothesis...");
  const author = investigators[0]!;
  const { hypothesisId } = await emitAck<{ hypothesisId: string }>(author.socket!, "hypothesis:create", {
    text: "The recent deploy added a repeated per-item lookup causing connection pool exhaustion.",
    clientMsgId: crypto.randomUUID(),
  });
  await waitForEvent<any>(author.socket!, "hypothesis:updated", (h) => h.id === hypothesisId && h.status !== "OPEN", 10000).then((h) =>
    log("hypothesis evaluated:", h.status, "-", h.aiRationale),
  );

  if (investigators[1]) {
    await emitAck(investigators[1].socket!, "hypothesis:support", { hypothesisId });
    log(`${investigators[1].name} supported the hypothesis`);
  }

  log(`${submitter.name} submitting final diagnosis...`);
  // Both listeners must be registered BEFORE the ack round-trip: the server emits
  // final:evaluated and game:completed as part of handling final:submit, both
  // arriving before (or interleaved with) the ack packet itself.
  const finalPromise = waitForEvent<any>(submitter.socket!, "final:evaluated", () => true, 20000);
  const completedPromise = waitForEvent(submitter.socket!, "game:completed", () => true, 20000);
  const finalSubmission = FINAL_SUBMISSIONS[SCENARIO_ID];
  if (!finalSubmission) throw new Error(`No FINAL_SUBMISSIONS entry for scenario ${SCENARIO_ID}`);
  await emitAck(submitter.socket!, "final:submit", {
    ...finalSubmission,
    clientMsgId: crypto.randomUUID(),
  });
  const debrief = await finalPromise;
  log("FINAL SCORE:", debrief.score.total, JSON.stringify(debrief.score));
  log("coaching notes:", debrief.coachingNotes);

  await completedPromise;
  log("game:completed received - full loop verified end to end.");

  for (const bot of bots) bot.socket?.disconnect();
  log("SUCCESS: bot simulation completed the full game loop.");
  process.exit(0);
}

main().catch((err) => {
  log("FAILURE", err);
  process.exit(1);
});
