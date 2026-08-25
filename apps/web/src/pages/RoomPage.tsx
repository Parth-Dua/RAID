import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, getRoom, joinRoom } from "../api/http.js";
import { loadIdentity, saveIdentity, type StoredIdentity } from "../state/identity.js";
import { GameProvider } from "../state/GameProvider.js";
import { RoomShell } from "./RoomShell.js";

export function RoomPage() {
  const { code = "" } = useParams();
  const roomCode = code.toUpperCase();
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [roomExists, setRoomExists] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    getRoom(roomCode)
      .then(() => !cancelled && setRoomExists(true))
      .catch(() => !cancelled && setRoomExists(false))
      .finally(() => !cancelled && setChecking(false));

    const stored = loadIdentity();
    setIdentity(stored && stored.roomCode === roomCode ? stored : null);
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  if (checking) {
    return <CenteredMessage>Loading room...</CenteredMessage>;
  }
  if (!roomExists) {
    return <CenteredMessage>Room {roomCode} not found. Check the code and try again.</CenteredMessage>;
  }
  if (!identity) {
    return <JoinForm roomCode={roomCode} onJoined={setIdentity} />;
  }

  return (
    <GameProvider roomCode={roomCode} playerId={identity.playerId}>
      <RoomShell roomCode={roomCode} />
    </GameProvider>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center text-ink-300 text-sm">{children}</div>;
}

function JoinForm({ roomCode, onJoined }: { roomCode: string; onJoined: (identity: StoredIdentity) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await joinRoom(roomCode, name.trim());
      const identity = { roomCode, playerId: res.playerId };
      saveIdentity(identity);
      onJoined(identity);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-ink-900 border border-ink-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-1">Join room {roomCode}</h2>
        <p className="text-ink-300 text-sm mb-5">Enter a display name to join the incident.</p>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Display name"
            className="bg-ink-800 border border-ink-600 rounded-md px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {error && <div className="text-sm text-sev-1">{error}</div>}
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="mt-2 bg-accent hover:bg-accent/90 disabled:opacity-40 text-white text-sm font-medium py-2 rounded-md transition-colors"
          >
            {busy ? "Joining..." : "Join"}
          </button>
        </form>
      </div>
    </div>
  );
}
