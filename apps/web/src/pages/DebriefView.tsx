import { useEffect, useRef, useState } from "react";
import { useGame } from "../state/GameProvider.js";
import { formatClock, roleLabel } from "../lib/format.js";
import { recordCompletedGame } from "../lib/sessionStats.js";
import { requestDifferentScenario } from "../lib/lastPlayed.js";

export function DebriefView({ roomCode }: { roomCode: string }) {
  const { debrief, gameSnapshot, roomSnapshot, myPlayerId, actions } = useGame();
  const d = debrief ?? gameSnapshot?.debrief ?? null;
  const gameId = gameSnapshot?.gameId ?? roomSnapshot?.gameId ?? null;
  const [rematching, setRematching] = useState(false);
  const [copied, setCopied] = useState(false);
  const isHost = roomSnapshot?.players.find((p) => p.id === myPlayerId)?.isHost ?? false;
  const recordedGameIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!d || !gameId || recordedGameIdRef.current === gameId) return;
    recordedGameIdRef.current = gameId;
    recordCompletedGame({
      gameId,
      scenarioId: d.scenarioId,
      scenarioTitle: d.scenarioTitle,
      difficulty: d.difficulty,
      role: gameSnapshot?.myRole ?? null,
      total: d.score.total,
      completionSeconds: d.completionSeconds,
      playedAt: new Date().toISOString(),
    });
  }, [d, gameId, gameSnapshot?.myRole]);

  async function playAgain() {
    setRematching(true);
    try {
      await actions.rematch();
      // On success the room flips to LOBBY and RoomShell swaps this view out; on failure
      // (e.g. NOT_HOST from a stale click) the guarded action surfaces a toast and we just
      // stop spinning here rather than getting stuck.
    } finally {
      setRematching(false);
    }
  }

  async function newScenario() {
    if (d) requestDifferentScenario(d.scenarioId);
    await playAgain();
  }

  function copyResultLink() {
    if (!gameId) return;
    const url = `${window.location.origin}/result/${gameId}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!d) {
    return <div className="flex-1 min-h-screen flex items-center justify-center text-ink-300 text-sm">Finalizing debrief...</div>;
  }

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        <header className="text-center">
          <div className="text-ink-400 text-xs uppercase tracking-widest mb-1">RAID #{roomCode} — Debrief</div>
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
          {gameId && (
            <button onClick={copyResultLink} className="mt-3 text-xs text-accent hover:underline">
              {copied ? "Link copied!" : "Copy shareable result link"}
            </button>
          )}
        </header>

        <ScoreBreakdown score={d.score} />

        <Card title="Root cause">
          <p className="text-sm text-ink-200 leading-relaxed">{d.rootCauseSummary}</p>
        </Card>

        <Card title="Expected remediation">
          <p className="text-sm text-ink-200 leading-relaxed">{d.expectedRemediation}</p>
        </Card>

        <Card title="Incident timeline">
          <div className="flex flex-col gap-1.5">
            {d.timeline.map((t, i) => (
              <div key={i} className="text-xs flex gap-2">
                <span className="text-ink-500 font-mono shrink-0">T+{t.atSeconds}s</span>
                <span className="text-ink-300">{t.headline}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card title="Key evidence found">
            <List items={d.keyEvidenceFound} empty="None found" tone="ok" />
          </Card>
          <Card title="Key evidence missed">
            <List items={d.keyEvidenceMissed} empty="Nothing missed" tone="warn" />
          </Card>
        </div>

        <Card title="Red herrings investigated">
          <List items={d.redHerringsEncountered} empty="None — the team avoided every red herring" tone="neutral" />
        </Card>

        <Card title="Hypotheses considered">
          <div className="flex flex-col gap-2">
            {d.hypothesesConsidered.length === 0 && <div className="text-xs text-ink-500">No hypotheses were proposed.</div>}
            {d.hypothesesConsidered.map((h, i) => (
              <div key={i} className="text-xs flex items-start gap-2">
                <span className="text-ink-500 shrink-0 uppercase tracking-wide">[{h.status}]</span>
                <span className="text-ink-300">{h.text}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Team collaboration">
          <p className="text-sm text-ink-200 leading-relaxed">{d.collaborationNote}</p>
        </Card>

        <Card title="Role contributions">
          <div className="flex flex-col gap-2">
            {d.roleContributions.map((rc) => (
              <div key={rc.playerId} className="flex items-center justify-between text-xs bg-ink-800 rounded px-3 py-2">
                <div>
                  <div className="text-ink-100 font-medium">{rc.displayName}</div>
                  <div className="text-ink-400">{roleLabel(rc.role)}</div>
                </div>
                <div className="flex gap-4 text-right">
                  <Stat label="Tools" value={rc.toolsExecuted} />
                  <Stat label="Evidence" value={rc.evidenceUnlocked} />
                  <Stat label="Hypotheses" value={rc.hypothesesProposed} />
                  <Stat label="Facts" value={rc.knownFactsAdded} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="What an experienced team might have done differently">
          <ul className="list-disc list-inside flex flex-col gap-1.5">
            {d.coachingNotes.map((note, i) => (
              <li key={i} className="text-sm text-ink-200 leading-relaxed">
                {note}
              </li>
            ))}
          </ul>
        </Card>

        <div className="text-center pt-4 flex flex-col items-center gap-3">
          {isHost ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-3">
                <button
                  onClick={playAgain}
                  disabled={rematching}
                  className="bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-sm font-semibold px-6 py-2.5 rounded-md transition-colors"
                >
                  {rematching ? "Starting rematch..." : "Play again"}
                </button>
                <button
                  onClick={newScenario}
                  disabled={rematching}
                  className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-ink-100 text-sm font-semibold px-6 py-2.5 rounded-md transition-colors"
                >
                  New scenario
                </button>
              </div>
              <div className="text-[11px] text-ink-500">Same group, same room code. Roles are reshuffled every game.</div>
            </div>
          ) : (
            <div className="text-xs text-ink-400">Waiting for the host to start a rematch, or leave to start your own room.</div>
          )}
          <a href="/" className="text-accent text-sm hover:underline">
            Back to home
          </a>
        </div>
      </div>
    </div>
  );
}

function ScoreBreakdown({ score }: { score: import("@raid/shared").ScoreBreakdown }) {
  const rows: [string, number, number][] = [
    ["Root cause accuracy", score.rootCauseAccuracy, 40],
    ["Evidence quality", score.evidenceQuality, 20],
    ["Remediation quality", score.remediationQuality, 20],
    ["Efficiency", score.efficiency, 10],
    ["Collaboration", score.collaboration, 10],
  ];
  return (
    <div className="bg-ink-900 border border-ink-700 rounded-lg p-4 flex flex-col gap-2.5">
      {rows.map(([label, value, max]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="text-xs text-ink-300 w-40 shrink-0">{label}</span>
          <div className="flex-1 h-1.5 bg-ink-800 rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full" style={{ width: `${(value / max) * 100}%` }} />
          </div>
          <span className="text-xs font-mono text-ink-300 w-12 text-right">
            {value}/{max}
          </span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-ink-100 font-mono font-semibold">{value}</div>
      <div className="text-ink-500 text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-ink-900 border border-ink-700 rounded-lg p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-500 mb-2.5">{title}</div>
      {children}
    </div>
  );
}

function List({ items, empty, tone }: { items: string[]; empty: string; tone: "ok" | "warn" | "neutral" }) {
  if (items.length === 0) return <div className="text-xs text-ink-500">{empty}</div>;
  const dot = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-ink-400";
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={i} className="text-xs text-ink-300 flex gap-1.5">
          <span className={dot}>&bull;</span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}
