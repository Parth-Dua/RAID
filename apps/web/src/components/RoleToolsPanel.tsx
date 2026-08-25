import { useState } from "react";
import { useGame } from "../state/GameProvider.js";

interface ToolLogEntry {
  output: string;
  unlockedCount: number;
  atSeconds: number;
}

export function RoleToolsPanel() {
  const { gameSnapshot, actions } = useGame();
  const [log, setLog] = useState<Record<string, ToolLogEntry>>({});
  const [running, setRunning] = useState<string | null>(null);

  if (!gameSnapshot) return null;

  if (gameSnapshot.myRole === "incident_commander") {
    return <IncidentCommanderPanel />;
  }

  if (gameSnapshot.tools.length === 0) {
    return <div className="text-ink-400 text-sm">No role assigned yet.</div>;
  }

  async function run(toolId: string) {
    setRunning(toolId);
    try {
      const result = await actions.executeTool(toolId);
      setLog((prev) => ({
        ...prev,
        [toolId]: { output: result.output, unlockedCount: result.unlockedEvidenceIds.length, atSeconds: gameSnapshot!.simulationSeconds },
      }));
    } catch {
      // surfaced via global error toast
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {gameSnapshot.tools.map((tool) => {
        const entry = log[tool.id];
        return (
          <div key={tool.id} className="border border-ink-700 rounded-md overflow-hidden">
            <button
              onClick={() => run(tool.id)}
              disabled={running === tool.id}
              className="w-full flex items-center justify-between px-3 py-2 bg-ink-800 hover:bg-ink-700 disabled:opacity-50 text-left transition-colors"
            >
              <span>
                <div className="text-sm font-medium">{tool.name}</div>
                <div className="text-xs text-ink-400">{tool.description}</div>
              </span>
              <span className="text-xs text-accent shrink-0 ml-2">{running === tool.id ? "Running..." : "Run"}</span>
            </button>
            {entry && (
              <pre className="text-xs font-mono whitespace-pre-wrap px-3 py-2 bg-ink-950 text-ink-200 border-t border-ink-700 leading-relaxed">
                {entry.output}
                {entry.unlockedCount > 0 && (
                  <div className="mt-1.5 text-ok">+{entry.unlockedCount} new evidence unlocked</div>
                )}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

function IncidentCommanderPanel() {
  return (
    <p className="text-xs text-ink-400 leading-relaxed">
      You have no simulated tools. Coordinate the team via chat, watch the shared incident board, and submit the
      final diagnosis (below, in Shared Incident) when the team has converged on a root cause.
    </p>
  );
}
