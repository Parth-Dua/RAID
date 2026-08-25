import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type {
  ChatMessage,
  Debrief,
  GameSnapshot,
  Hypothesis,
  KnownFact,
  PublicEvidence,
  RoomSnapshot,
  ServerErrorPayload,
  TimelineStep,
} from "@raid/shared";
import { createGameSocket, emitAck } from "../api/socket.js";

interface ToastError {
  id: string;
  message: string;
}

interface GameContextValue {
  connectionStatus: "connecting" | "connected" | "disconnected";
  roomSnapshot: RoomSnapshot | null;
  gameSnapshot: GameSnapshot | null;
  remainingSeconds: number | null;
  debrief: Debrief | null;
  errors: ToastError[];
  dismissError: (id: string) => void;
  myPlayerId: string | null;
  actions: {
    setReady: (ready: boolean) => Promise<void>;
    leaveRoom: () => Promise<void>;
    startGame: (durationPreset?: "standard" | "demo") => Promise<{ gameId: string }>;
    sendChat: (text: string) => Promise<void>;
    executeTool: (toolId: string) => Promise<{ output: string; unlockedEvidenceIds: string[] }>;
    createHypothesis: (text: string) => Promise<void>;
    supportHypothesis: (hypothesisId: string) => Promise<void>;
    challengeHypothesis: (hypothesisId: string) => Promise<void>;
    attachEvidence: (hypothesisId: string, evidenceId: string) => Promise<void>;
    addKnownFact: (text: string, category?: "fact" | "question", sourceEvidenceId?: string | null) => Promise<void>;
    submitFinal: (rootCause: string, supportingEvidenceIds: string[], remediation: string) => Promise<void>;
  };
}

const GameContext = createContext<GameContextValue | null>(null);

function uuid(): string {
  return crypto.randomUUID();
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const copy = [...list];
  copy[idx] = item;
  return copy;
}

export function GameProvider({ roomCode, playerId, children }: { roomCode: string; playerId: string; children: React.ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<GameContextValue["connectionStatus"]>("connecting");
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [gameSnapshot, setGameSnapshot] = useState<GameSnapshot | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [errors, setErrors] = useState<ToastError[]>([]);

  const pushError = useCallback((message: string) => {
    setErrors((prev) => [...prev, { id: uuid(), message }]);
  }, []);

  useEffect(() => {
    const socket = createGameSocket(roomCode);
    socketRef.current = socket;

    socket.on("connect", () => setConnectionStatus("connected"));
    socket.on("disconnect", () => setConnectionStatus("disconnected"));
    socket.on("connect_error", (err) => {
      setConnectionStatus("disconnected");
      pushError(`Connection failed: ${err.message}`);
    });

    socket.on("room:snapshot", (snap: RoomSnapshot) => setRoomSnapshot(snap));
    socket.on("game:snapshot", (snap: GameSnapshot) => {
      setGameSnapshot(snap);
      if (snap.endsAtMs) setRemainingSeconds(Math.max(0, Math.round((snap.endsAtMs - Date.now()) / 1000)));
      if (snap.debrief) setDebrief(snap.debrief);
    });
    socket.on("timer:update", ({ remainingSeconds: rs }: { remainingSeconds: number }) => setRemainingSeconds(rs));
    socket.on("evidence:unlocked", (evidence: PublicEvidence[]) => {
      setGameSnapshot((prev) => {
        if (!prev) return prev;
        let next = prev.evidence;
        for (const e of evidence) next = upsertById(next, e);
        return { ...prev, evidence: next };
      });
    });
    socket.on("hypothesis:updated", (hyp: Hypothesis) => {
      setGameSnapshot((prev) => (prev ? { ...prev, hypotheses: upsertById(prev.hypotheses, hyp) } : prev));
    });
    socket.on("game:event", (event: { kind: "chat"; message: ChatMessage } | { kind: "known_fact"; fact: KnownFact } | { kind: "timeline_step"; step: TimelineStep }) => {
      setGameSnapshot((prev) => {
        if (!prev) return prev;
        if (event.kind === "chat") return { ...prev, chat: upsertById(prev.chat, event.message) };
        if (event.kind === "known_fact") return { ...prev, knownFacts: upsertById(prev.knownFacts, event.fact) };
        if (event.kind === "timeline_step") {
          if (prev.timeline.some((t) => t.atSeconds === event.step.atSeconds && t.headline === event.step.headline)) return prev;
          return { ...prev, timeline: [...prev.timeline, event.step].sort((a, b) => a.atSeconds - b.atSeconds) };
        }
        return prev;
      });
    });
    socket.on("final:evaluated", (d: Debrief) => setDebrief(d));
    socket.on("error", (payload: ServerErrorPayload) => pushError(payload.message));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, pushError]);

  const dismissError = useCallback((id: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const guarded = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        pushError(err instanceof Error ? err.message : "Something went wrong.");
        throw err;
      }
    },
    [pushError],
  );

  const actions = useMemo<GameContextValue["actions"]>(
    () => ({
      setReady: (ready) => guarded(() => emitAck(socketRef.current!, "player:ready", { ready })),
      leaveRoom: () =>
        guarded(async () => {
          await emitAck(socketRef.current!, "player:leave", {});
          socketRef.current?.disconnect();
        }),
      startGame: (durationPreset) => guarded(() => emitAck(socketRef.current!, "game:start", { durationPreset })),
      sendChat: (text) => guarded(() => emitAck(socketRef.current!, "chat:send", { text, clientMsgId: uuid() })),
      executeTool: (toolId) => guarded(() => emitAck(socketRef.current!, "tool:execute", { toolId })),
      createHypothesis: (text) => guarded(() => emitAck(socketRef.current!, "hypothesis:create", { text, clientMsgId: uuid() })),
      supportHypothesis: (hypothesisId) => guarded(() => emitAck(socketRef.current!, "hypothesis:support", { hypothesisId })),
      challengeHypothesis: (hypothesisId) => guarded(() => emitAck(socketRef.current!, "hypothesis:challenge", { hypothesisId })),
      attachEvidence: (hypothesisId, evidenceId) =>
        guarded(() => emitAck(socketRef.current!, "evidence:attach", { hypothesisId, evidenceId })),
      addKnownFact: (text, category, sourceEvidenceId) =>
        guarded(() =>
          emitAck(socketRef.current!, "knownfact:add", { text, category: category ?? "fact", sourceEvidenceId: sourceEvidenceId ?? null }),
        ),
      submitFinal: (rootCause, supportingEvidenceIds, remediation) =>
        guarded(() =>
          emitAck(socketRef.current!, "final:submit", { rootCause, supportingEvidenceIds, remediation, clientMsgId: uuid() }),
        ),
    }),
    [guarded],
  );

  const value: GameContextValue = {
    connectionStatus,
    roomSnapshot,
    gameSnapshot,
    remainingSeconds,
    debrief,
    errors,
    dismissError,
    myPlayerId: playerId,
    actions,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
