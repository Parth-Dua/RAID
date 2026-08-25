import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Difficulty, ScenarioCatalogEntry } from "@raid/shared";
import { useGame } from "../state/GameProvider.js";
import { clearIdentity } from "../state/identity.js";
import { getScenarioCatalog } from "../api/http.js";

export function LobbyView({ roomCode }: { roomCode: string }) {
  const { roomSnapshot, myPlayerId, actions } = useGame();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState<"standard" | "demo">("demo");
  const [copied, setCopied] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioCatalogEntry[]>([]);
  const [scenarioId, setScenarioId] = useState<string>("");
  const [difficulty, setDifficulty] = useState<Difficulty>("NORMAL");

  useEffect(() => {
    getScenarioCatalog()
      .then(({ scenarios: list }) => {
        setScenarios(list);
        setScenarioId((prev) => prev || list[0]?.id || "");
      })
      .catch(() => {
        // Non-fatal: the host-only picker just stays empty and startGame falls back to the
        // server's default scenario, so this never blocks anyone from starting a game.
      });
  }, []);

  if (!roomSnapshot) return null;
  const me = roomSnapshot.players.find((p) => p.id === myPlayerId);
  const isHost = me?.isHost ?? false;
  const allReady = roomSnapshot.players.length >= 3 && roomSnapshot.players.every((p) => p.ready);
  const inviteUrl = `${window.location.origin}/r/${roomCode}`;

  async function toggleReady() {
    if (!me) return;
    setBusy(true);
    try {
      await actions.setReady(!me.ready);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      await actions.startGame(duration, scenarioId || undefined, difficulty);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await actions.leaveRoom();
      clearIdentity();
      navigate("/");
    } catch {
      setBusy(false);
    }
  }

  function copyInvite() {
    navigator.clipboard?.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="text-ink-300 text-xs uppercase tracking-widest mb-1">Room</div>
          <div className="text-4xl font-mono font-semibold tracking-[0.2em]">{roomCode}</div>
          <button onClick={copyInvite} className="mt-2 text-xs text-accent hover:underline">
            {copied ? "Copied!" : "Copy invite link"}
          </button>
        </div>

        <div className="bg-ink-900 border border-ink-700 rounded-lg p-4 mb-5 text-xs text-ink-300 leading-relaxed">
          Once the incident starts, each of you gets a <strong className="text-ink-100">different role</strong> with
          private tools and evidence — nobody sees the whole picture alone. Investigate, share what you find on the
          shared board, propose hypotheses, and submit a diagnosis before the clock runs out.
        </div>

        <div className="bg-ink-900 border border-ink-700 rounded-lg divide-y divide-ink-700">
          {roomSnapshot.players.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${p.connected ? "bg-ok" : "bg-ink-500"}`} />
                <span className="text-sm font-medium">{p.displayName}</span>
                {p.isHost && <span className="text-[10px] uppercase tracking-wide text-accent bg-accent-soft px-1.5 py-0.5 rounded">Host</span>}
                {p.id === myPlayerId && <span className="text-[10px] text-ink-400">(you)</span>}
              </div>
              <span className={`text-xs font-medium ${p.ready ? "text-ok" : "text-ink-400"}`}>{p.ready ? "Ready" : "Not ready"}</span>
            </div>
          ))}
          {roomSnapshot.players.length < 4 && (
            <div className="px-4 py-3 text-xs text-ink-400">Waiting for more players (3-4 total)...</div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <button
            onClick={toggleReady}
            disabled={busy}
            className={`w-full py-2 rounded-md text-sm font-medium transition-colors ${
              me?.ready ? "bg-ink-700 text-ink-100 hover:bg-ink-600" : "bg-ok text-ink-950 hover:bg-ok/90"
            }`}
          >
            {me?.ready ? "Not ready" : "I'm ready"}
          </button>

          {isHost && (
            <div className="bg-ink-900 border border-ink-700 rounded-lg p-4">
              <div className="text-xs text-ink-300 uppercase tracking-wide mb-2">Scenario (host only)</div>
              <div className="flex flex-col gap-1.5 mb-3">
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setScenarioId(s.id)}
                    className={`text-left px-3 py-2 rounded text-xs ${
                      scenarioId === s.id ? "bg-accent text-white" : "bg-ink-800 text-ink-300 hover:bg-ink-700"
                    }`}
                  >
                    <div className="font-semibold">{s.title}</div>
                    <div className={scenarioId === s.id ? "text-white/80" : "text-ink-400"}>{s.tagline}</div>
                  </button>
                ))}
                {scenarios.length === 0 && <div className="text-xs text-ink-500">Loading scenarios...</div>}
              </div>

              <div className="text-xs text-ink-300 uppercase tracking-wide mb-2">Difficulty</div>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setDifficulty("NORMAL")}
                  className={`flex-1 text-sm py-1.5 rounded ${difficulty === "NORMAL" ? "bg-accent text-white" : "bg-ink-800 text-ink-300"}`}
                >
                  Normal
                </button>
                <button
                  onClick={() => setDifficulty("HARD")}
                  className={`flex-1 text-sm py-1.5 rounded ${difficulty === "HARD" ? "bg-accent text-white" : "bg-ink-800 text-ink-300"}`}
                >
                  Hard
                </button>
              </div>

              <div className="text-xs text-ink-300 uppercase tracking-wide mb-2">Incident duration</div>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setDuration("demo")}
                  className={`flex-1 text-sm py-1.5 rounded ${duration === "demo" ? "bg-accent text-white" : "bg-ink-800 text-ink-300"}`}
                >
                  Demo (~5 min)
                </button>
                <button
                  onClick={() => setDuration("standard")}
                  className={`flex-1 text-sm py-1.5 rounded ${duration === "standard" ? "bg-accent text-white" : "bg-ink-800 text-ink-300"}`}
                >
                  Standard (~20 min)
                </button>
              </div>
              <button
                onClick={start}
                disabled={busy || !allReady}
                className="w-full bg-sev-1 hover:bg-sev-1/90 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-md transition-colors"
              >
                {allReady ? "Start incident" : "Waiting for everyone to be ready"}
              </button>
            </div>
          )}

          <button onClick={leave} disabled={busy} className="text-xs text-ink-500 hover:text-sev-1 transition-colors">
            Leave room
          </button>
        </div>
      </div>
    </div>
  );
}
