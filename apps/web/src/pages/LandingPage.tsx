import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom, joinRoom, ApiError } from "../api/http.js";
import { saveIdentity } from "../state/identity.js";

export function LandingPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        const res = await createRoom(name.trim());
        saveIdentity({ roomCode: res.roomCode, playerId: res.playerId });
        navigate(`/r/${res.roomCode}`);
      } else {
        const roomCode = code.trim().toUpperCase();
        const res = await joinRoom(roomCode, name.trim());
        saveIdentity({ roomCode, playerId: res.playerId });
        navigate(`/r/${roomCode}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="text-sev-1 font-mono text-sm px-2 py-0.5 rounded border border-sev-1/40 bg-sev-1/10">SEV-1</span>
            <h1 className="text-3xl font-semibold tracking-tight">RAID</h1>
          </div>
          <p className="text-ink-300 text-sm">
            A real-time incident-response game. 3-4 players, asymmetric evidence, one deadline.
          </p>
        </div>

        <div className="bg-ink-900 border border-ink-700 rounded-lg p-6">
          <div className="flex gap-1 mb-5 bg-ink-800 rounded-md p-1">
            <button
              type="button"
              onClick={() => setMode("create")}
              className={`flex-1 text-sm py-1.5 rounded ${mode === "create" ? "bg-ink-700 text-ink-100" : "text-ink-300"}`}
            >
              Create room
            </button>
            <button
              type="button"
              onClick={() => setMode("join")}
              className={`flex-1 text-sm py-1.5 rounded ${mode === "join" ? "bg-ink-700 text-ink-100" : "text-ink-300"}`}
            >
              Join room
            </button>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label className="text-xs text-ink-300 uppercase tracking-wide">Display name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="e.g. Priya"
              className="bg-ink-800 border border-ink-600 rounded-md px-3 py-2 text-sm outline-none focus:border-accent"
            />

            {mode === "join" && (
              <>
                <label className="text-xs text-ink-300 uppercase tracking-wide mt-1">Room code</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={8}
                  placeholder="e.g. XUB9Q"
                  className="bg-ink-800 border border-ink-600 rounded-md px-3 py-2 text-sm font-mono tracking-widest outline-none focus:border-accent"
                />
              </>
            )}

            {error && <div className="text-sm text-sev-1">{error}</div>}

            <button
              type="submit"
              disabled={busy || !name.trim() || (mode === "join" && !code.trim())}
              className="mt-2 bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-md transition-colors"
            >
              {busy ? "Working..." : mode === "create" ? "Create room" : "Join room"}
            </button>
          </form>
        </div>

        <p className="text-center text-ink-400 text-xs mt-6">
          No signup. Your session is a browser cookie tied to this room only.
        </p>
      </div>
    </div>
  );
}
