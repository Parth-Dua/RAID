import { useEffect, useState } from "react";
import type { LeaderboardEntry } from "@raid/shared";
import { getRoomLeaderboard } from "../api/http.js";
import { roleLabel } from "../lib/format.js";

/** V0.6.5: room-scoped leaderboard - every completed game played in this room so far, most recent
 * first. Sourced entirely from real game_results rows; never a global/cross-room ranking. */
export function LeaderboardPanel({ roomCode }: { roomCode: string }) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRoomLeaderboard(roomCode)
      .then(({ entries: list }) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  if (!entries || entries.length === 0) return null;

  return (
    <div className="bg-ink-900 border border-ink-700 rounded-lg p-4">
      <div className="text-xs text-ink-300 uppercase tracking-wide mb-2">This room's games</div>
      <div className="flex flex-col gap-1.5">
        {entries.map((e) => (
          <div key={e.gameId} className="flex items-center justify-between text-xs bg-ink-800 rounded px-3 py-2">
            <div>
              <div className="text-ink-100 font-medium">{e.scenarioTitle}</div>
              <div className="text-ink-500">
                {e.difficulty} &bull; {e.players.map((p) => `${p.displayName} (${roleLabel(p.role)})`).join(", ")}
              </div>
            </div>
            <div className="text-right shrink-0 pl-3">
              <div className="font-mono font-semibold text-ink-100">{e.total}/100</div>
              <div className="text-ink-500">{new Date(e.completedAt).toLocaleTimeString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
