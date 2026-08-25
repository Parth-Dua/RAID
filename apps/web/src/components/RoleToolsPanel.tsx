import { useState } from "react";
import { useGame } from "../state/GameProvider.js";
import type { Role } from "@raid/shared";

interface ToolLogEntry {
  output: string;
  unlockedCount: number;
  atSeconds: number;
}

const ROLE_OBJECTIVE: Record<Role, string> = {
  backend_engineer:
    "Investigate the application layer: recent deploys, logs, traces, and per-endpoint stats. Look for what changed right before symptoms began.",
  database_engineer:
    "Investigate the database layer: connection pool health, query volume, locks, and replication. Distinguish a slow query from a volume problem.",
  sre: "Investigate infrastructure: CPU/memory, pod health, request rate, and network. Rule out (or confirm) that this is a capacity or infra issue.",
  incident_commander:
    "You have no raw evidence of your own. Track the big picture, ask your team what they're finding, and submit the final diagnosis once the team has converged.",
};

export function RoleToolsPanel() {
  const { gameSnapshot, actions } = useGame();
  const [log, setLog] = useState<Record<string, ToolLogEntry>>({});
  const [running, setRunning] = useState<string | null>(null);

  if (!gameSnapshot) return null;

  if (!gameSnapshot.myRole) {
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
      <p className="text-[11px] text-ink-400 leading-relaxed border-l-2 border-ink-700 pl-2">
        {ROLE_OBJECTIVE[gameSnapshot.myRole]}
      </p>

      {gameSnapshot.tools.length === 0 && (
        <div className="text-xs text-ink-500">No tools of your own - use chat and the shared incident board.</div>
      )}

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
