import { useGame } from "../state/GameProvider.js";
import { LobbyView } from "./LobbyView.js";
import { GameView } from "./GameView.js";
import { DebriefView } from "./DebriefView.js";
import { ErrorToasts } from "../components/ErrorToasts.js";

export function RoomShell({ roomCode }: { roomCode: string }) {
  const { connectionStatus, roomSnapshot } = useGame();

  return (
    <div className="min-h-screen flex flex-col">
      <ErrorToasts />
      {connectionStatus !== "connected" && (
        <div className="bg-warn/20 text-warn text-xs text-center py-1 font-medium">
          {connectionStatus === "connecting" ? "Connecting..." : "Reconnecting..."}
        </div>
      )}
      <Body roomCode={roomCode} phase={roomSnapshot?.phase} />
    </div>
  );
}

function Body({ roomCode, phase }: { roomCode: string; phase: string | undefined }) {
  if (!phase) {
    return <div className="flex-1 flex items-center justify-center text-ink-300 text-sm">Loading room...</div>;
  }
  if (phase === "LOBBY" || phase === "STARTING") {
    return <LobbyView roomCode={roomCode} />;
  }
  if (phase === "COMPLETED") {
    return <DebriefView roomCode={roomCode} />;
  }
  return <GameView roomCode={roomCode} />;
}
