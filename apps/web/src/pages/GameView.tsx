import { useGame } from "../state/GameProvider.js";
import { RoleToolsPanel } from "../components/RoleToolsPanel.js";
import { SharedIncidentPanel } from "../components/SharedIncidentPanel.js";
import { PrivateFindingsPanel } from "../components/PrivateFindingsPanel.js";
import { ChatPanel } from "../components/ChatPanel.js";
import { formatClock, roleLabel } from "../lib/format.js";

export function GameView({ roomCode }: { roomCode: string }) {
  const { gameSnapshot, remainingSeconds } = useGame();

  if (!gameSnapshot) {
    return <div className="flex-1 flex items-center justify-center text-ink-300 text-sm">Loading incident...</div>;
  }

  const urgent = remainingSeconds !== null && remainingSeconds < 120;

  return (
    <div className="flex-1 flex flex-col h-screen">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-ink-700 bg-ink-900">
        <div className="flex items-center gap-3">
          <span className="font-mono font-semibold text-sm tracking-wide">RAID #{roomCode}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border border-sev-1/40 text-sev-1 bg-sev-1/10">
            {gameSnapshot.severity}
          </span>
          {gameSnapshot.phase === "FINALIZING" && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border border-warn/40 text-warn bg-warn/10">
              Finalizing
            </span>
          )}
        </div>
        <div className={`font-mono text-sm font-semibold tabular-nums ${urgent ? "text-sev-1" : "text-ink-200"}`}>
          {remainingSeconds !== null ? `${formatClock(remainingSeconds)} REMAINING` : "--:--"}
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 grid-rows-[1fr_1fr] lg:grid-rows-2 min-h-0 overflow-hidden">
        <PanelBox title={roleLabel(gameSnapshot.myRole)}>
          <RoleToolsPanel />
        </PanelBox>
        <PanelBox title="Shared incident">
          <SharedIncidentPanel />
        </PanelBox>
        <PanelBox title="Private findings">
          <PrivateFindingsPanel />
        </PanelBox>
        <PanelBox title="Team chat">
          <ChatPanel />
        </PanelBox>
      </div>
    </div>
  );
}

function PanelBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-r border-ink-700 flex flex-col min-h-0">
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-400 border-b border-ink-800 bg-ink-900/50 shrink-0">
        {title}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 min-h-0">{children}</div>
    </div>
  );
}
