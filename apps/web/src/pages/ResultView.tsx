import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { PublicGameResult } from "@raid/shared";
import { ApiError, getGameResult } from "../api/http.js";
import { formatClock, roleLabel } from "../lib/format.js";

/**
 * V0.6.4: public, read-only shareable result page. No socket connection, no session/cookie
 * requirement - anyone with the link (or gameId) can view a finished game's real debrief. Renders
 * the same Debrief data every player already saw; never derives a percentile or ranking that
 * isn't backed by real stored data.
 */
export function ResultView() {
  const { gameId } = useParams<{ gameId: string }>();
  const [result, setResult] = useState<PublicGameResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gameId) return;
    getGameResult(gameId)
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Something went wrong."))
      .finally(() => setLoading(false));
  }, [gameId]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-ink-300 text-sm">Loading result...</div>;
  }

  if (error || !result) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
        <div className="text-ink-300 text-sm">{error ?? "This game result isn't available."}</div>
        <a href="/" className="text-accent text-sm hover:underline">
          Back to home
        </a>
      </div>
    );
  }

  const { debrief: d } = result;

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <header className="text-center">
          <div className="text-ink-400 text-xs uppercase tracking-widest mb-1">Shared RAID result</div>
          <div className="text-6xl font-bold tabular-nums">{d.score.total}</div>
          <div className="text-ink-400 text-sm">out of 100</div>
          <div className="mt-3 flex items-center justify-center flex-wrap gap-2 text-xs">
            <span className="px-2 py-0.5 rounded border border-sev-1/40 text-sev-1 bg-sev-1/10 font-semibold uppercase tracking-wide">
              {d.severity}
            </span>
            <span className="px-2 py-0.5 rounded border border-ink-600 text-ink-300 bg-ink-800 uppercase tracking-wide">
              {d.difficulty}
            </span>
            <span className="text-ink-400">{d.scenarioTitle}</span>
            <span className="text-ink-500">&bull;</span>
            <span className="text-ink-400 font-mono">{formatClock(d.completionSeconds)} elapsed</span>
          </div>
        </header>

        <div className="bg-ink-900 border border-ink-700 rounded-lg p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-500 mb-2.5">Root cause</div>
          <p className="text-sm text-ink-200 leading-relaxed">{d.rootCauseSummary}</p>
        </div>

        <div className="bg-ink-900 border border-ink-700 rounded-lg p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-500 mb-2.5">Team</div>
          <div className="flex flex-col gap-1.5">
            {d.roleContributions.map((rc) => (
              <div key={rc.playerId} className="text-xs flex justify-between text-ink-300">
                <span>{rc.displayName}</span>
                <span className="text-ink-500">{roleLabel(rc.role)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center pt-2">
          <a href="/" className="text-accent text-sm hover:underline">
            Play RAID yourself
          </a>
        </div>
      </div>
    </div>
  );
}
