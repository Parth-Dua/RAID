import { useState } from "react";
import { useGame } from "../state/GameProvider.js";
import type { PublicEvidence } from "@raid/shared";

const CATEGORY_LABEL: Record<PublicEvidence["category"], string> = {
  log: "Log",
  metric: "Metric",
  trace: "Trace",
  deployment: "Deployment",
  chat_note: "Note",
  incident_fact: "Fact",
};

export function PrivateFindingsPanel() {
  const { gameSnapshot, actions } = useGame();
  const [sharedIds, setSharedIds] = useState<Set<string>>(new Set());

  if (!gameSnapshot) return null;

  if (gameSnapshot.evidence.length === 0) {
    return <div className="text-xs text-ink-500">Run tools on the left to start unlocking evidence.</div>;
  }

  async function share(evidence: PublicEvidence) {
    await actions.addKnownFact(`${evidence.title}: ${summarize(evidence.content)}`, "fact", evidence.id);
    setSharedIds((prev) => new Set(prev).add(evidence.id));
  }

  return (
    <div className="flex flex-col gap-2">
      {gameSnapshot.evidence.map((e) => (
        <div key={e.id} className={`border rounded-md p-2.5 ${e.isRedHerring ? "border-ink-700" : "border-ink-600"}`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wide text-ink-400">{CATEGORY_LABEL[e.category]}</span>
            <button
              onClick={() => share(e)}
              disabled={sharedIds.has(e.id)}
              className="text-[10px] text-accent disabled:text-ink-500"
            >
              {sharedIds.has(e.id) ? "Shared" : "Share as fact"}
            </button>
          </div>
          <div className="text-xs font-medium text-ink-100 mb-1">{e.title}</div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap text-ink-300 leading-relaxed">{e.content}</pre>
        </div>
      ))}
    </div>
  );
}

function summarize(content: string): string {
  const firstLine = content.split("\n")[0] ?? content;
  return firstLine.length > 140 ? `${firstLine.slice(0, 140)}...` : firstLine;
}
