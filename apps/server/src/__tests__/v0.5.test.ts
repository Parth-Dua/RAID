import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  connectSocket,
  createRoomHttp,
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

async function generate(description: string, difficulty?: "NORMAL" | "HARD") {
  const res = await fetch(`${server.url}/api/scenarios/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, difficulty }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function save(candidate: unknown, requestedDescription?: string) {
  const res = await fetch(`${server.url}/api/scenarios/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate, requestedDescription }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("V0.5: scenario generation", () => {
  it("generates a candidate that is structurally valid and eligible to save", async () => {
    const { status, body } = await generate("Create an intermediate Kubernetes incident caused by a broken readiness configuration");
    expect(status).toBe(200);
    expect(body.validation.valid).toBe(true);
    expect(body.validation.errors).toEqual([]);
    expect(body.eligibleToSave).toBe(true);
    expect(body.semanticReview.passed).toBe(true);
    expect(body.candidate.title).toBeTruthy();
    expect(body.candidate.evidence.length).toBeGreaterThan(0);
  });

  it("rejects an empty description", async () => {
    const { status, body } = await generate("");
    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_PAYLOAD");
  });

  it("rejects an overlong description", async () => {
    const { status } = await generate("x".repeat(501));
    expect(status).toBe(400);
  });

  it("does not save anything as a side effect of generating", async () => {
    await generate("A stale DNS cache causing intermittent 502s");
    const catalog = (await (await fetch(`${server.url}/api/scenarios`)).json()) as { scenarios: { id: string }[] };
    // Only the 3 built-in scenarios exist - nothing was persisted by /generate alone.
    expect(catalog.scenarios.length).toBe(3);
  });
});

describe("V0.5: scenario save + catalog", () => {
  it("saves a valid candidate and it appears in the scenario catalog", async () => {
    const { body: genBody } = await generate("A broken cache invalidation strategy in the recommendations service");
    const { status, body } = await save(genBody.candidate, "A broken cache invalidation strategy in the recommendations service");
    expect(status).toBe(201);
    expect(body.scenarioId).toBeTruthy();
    expect(body.catalogEntry.title).toBe(genBody.candidate.title);

    const catalog = (await (await fetch(`${server.url}/api/scenarios`)).json()) as { scenarios: { id: string }[] };
    expect(catalog.scenarios.some((s) => s.id === body.scenarioId)).toBe(true);
    expect(catalog.scenarios.length).toBe(4); // 3 built-in + 1 saved
  });

  it("disambiguates a scenario id collision rather than overwriting", async () => {
    const { body: gen1 } = await generate("A load balancer health check misconfiguration");
    const { body: save1 } = await save(gen1.candidate);
    const { body: gen2 } = await generate("A load balancer health check misconfiguration");
    const { body: save2 } = await save(gen2.candidate);
    expect(save1.scenarioId).not.toBe(save2.scenarioId);

    const catalog = (await (await fetch(`${server.url}/api/scenarios`)).json()) as { scenarios: { id: string }[] };
    expect(catalog.scenarios.filter((s) => s.id === save1.scenarioId || s.id === save2.scenarioId)).toHaveLength(2);
  });

  it("rejects (with re-validation) a candidate that references missing evidence - adversarial case", async () => {
    const { body: genBody } = await generate("A misconfigured retry policy causing a thundering herd");
    const tampered = { ...genBody.candidate, rootCause: { ...genBody.candidate.rootCause, keyEvidenceIds: ["not_a_real_evidence_id"] } };
    const { status, body } = await save(tampered);
    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_PAYLOAD");
  });

  it("rejects (with re-validation) a candidate with a broken unlock graph - adversarial case", async () => {
    const { body: genBody } = await generate("A broken circuit breaker configuration");
    const tampered = { ...genBody.candidate, evidence: [...genBody.candidate.evidence] };
    tampered.evidence[0] = { ...tampered.evidence[0], unlock: { toolId: "not_a_real_tool_id" } };
    const { status, body } = await save(tampered);
    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_PAYLOAD");
  });

  it("rejects a save payload that doesn't match the strict generation schema at all", async () => {
    const { status } = await save({ garbage: true });
    expect(status).toBe(400);
  });
});

describe("V0.5: a saved generated scenario is actually playable", () => {
  it("can be started, played through tool execution, and completed with a real score", async () => {
    const { body: genBody } = await generate("A broken readiness probe path after a Kubernetes deploy");
    const { body: saveBody } = await save(genBody.candidate);
    const scenarioId: string = saveBody.scenarioId;

    const { bots, gameId } = await setupActiveGame(server.url, 3, "instant", { scenarioId });
    expect(bots.every((b) => (b.tools?.length ?? 0) > 0)).toBe(true);

    const investigator = bots.find((b) => (b.tools?.length ?? 0) > 0)!;
    const tool = investigator.tools![0]!;
    const result = await emitAck<{ output: string; unlockedEvidenceIds: string[] }>(investigator.socket, "tool:execute", { toolId: tool.id });
    expect(result.output).toBeTruthy();

    const submitter = bots[0]!;
    const finalPromise = waitForEvent<any>(submitter.socket, "final:evaluated", () => true, 15000);
    const completedPromise = waitForEvent(submitter.socket, "game:completed", () => true, 15000);
    await emitAck(submitter.socket, "final:submit", {
      rootCause: genBody.candidate.rootCause.summary,
      remediation: genBody.candidate.rootCause.remediation,
      supportingEvidenceIds: [],
      clientMsgId: randomUUID(),
    });
    const debrief = await finalPromise;
    await completedPromise;

    expect(debrief.score.total).toBeGreaterThanOrEqual(0);
    expect(debrief.score.total).toBeLessThanOrEqual(100);
    void gameId;
  });

  it("rejects starting a game with a scenario id that was never generated or saved", async () => {
    const { roomCode, ...host } = await createRoomHttp(server.url, "Host");
    const socket = await connectSocket(server.url, host, roomCode);
    await waitForEvent(socket, "room:snapshot", () => true, 5000);
    await emitAck(socket, "player:ready", { ready: true });
    const result = await emitAckRaw(socket, "game:start", { scenarioId: "never-generated-scenario" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_PAYLOAD");
    socket.disconnect();
  });
});
