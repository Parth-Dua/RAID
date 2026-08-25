import { FormEvent, useState } from "react";
import { useGame } from "../state/GameProvider.js";
import { FinalSubmitForm } from "./FinalSubmitForm.js";
import { TeamRoster } from "./TeamRoster.js";
import type { Hypothesis, HypothesisStatus, KnowledgeBoardCategory } from "@raid/shared";

const STATUS_STYLE: Record<HypothesisStatus, string> = {
  OPEN: "text-ink-400 border-ink-500 bg-ink-800",
  SUPPORTED: "text-ok border-ok/40 bg-ok/10",
  PLAUSIBLE: "text-accent border-accent/40 bg-accent-soft",
  WEAK: "text-warn border-warn/40 bg-warn/10",
  CONTRADICTED: "text-sev-1 border-sev-1/40 bg-sev-1/10",
};

export function SharedIncidentPanel() {
  const { gameSnapshot, roomSnapshot } = useGame();
  if (!gameSnapshot) return null;

  // Mirrors the server's role-assignment rule (packages/game-engine roomService.assignRoles):
  // a 4-player game always includes an Incident Commander, who alone may submit the final
  // diagnosis; a 3-player game has no IC, so any assigned player may submit. Roles ARE visible
  // to everyone once the game starts (RoomSnapshot.players[].role) - only evidence CONTENT is
  // private - so the team always knows who to ask, even though this rule is inferred from
  // player count rather than read off a specific teammate's role.
  const canSubmitFinal = gameSnapshot.myRole === "incident_commander" || (roomSnapshot?.players.length ?? 0) === 3;

  const activeHypotheses = gameSnapshot.hypotheses.filter((h) => h.status !== "CONTRADICTED");
  const ruledOut = gameSnapshot.hypotheses.filter((h) => h.status === "CONTRADICTED");
  const facts = gameSnapshot.knownFacts.filter((f) => f.category !== "question");
  const questions = gameSnapshot.knownFacts.filter((f) => f.category === "question");

  return (
    <div className="flex flex-col gap-5">
      <Section title="Team">
        <TeamRoster />
      </Section>

      <Section title="Timeline">
        <div className="flex flex-col gap-1.5">
          {gameSnapshot.timeline.map((step, i) => (
            <div key={i} className="text-xs flex gap-2">
              <span className="text-ink-500 font-mono shrink-0">T+{step.atSeconds}s</span>
              <span className="text-ink-200">{step.headline}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Known facts">
        <NotesList notes={facts} category="fact" empty="No facts added yet. Share something you've found." />
      </Section>

      <Section title="Open questions">
        <NotesList notes={questions} category="question" empty="No open questions yet. What don't you understand yet?" />
      </Section>

      <Section title={`Active hypotheses (${activeHypotheses.length})`}>
        <HypothesesBoard hypotheses={activeHypotheses} />
      </Section>

      {ruledOut.length > 0 && (
        <Section title={`Ruled out (${ruledOut.length})`}>
          <div className="flex flex-col gap-2">
            {ruledOut.map((h) => (
              <HypothesisCard key={h.id} hypothesis={h} />
            ))}
          </div>
        </Section>
      )}

      {canSubmitFinal && (
        <Section title="Final diagnosis">
          <FinalSubmitForm />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-500 mb-2">{title}</div>
      {children}
    </div>
  );
}

function NotesList({
  notes,
  category,
  empty,
}: {
  notes: { id: string; text: string }[];
  category: KnowledgeBoardCategory;
  empty: string;
}) {
  const { actions } = useGame();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await actions.addKnownFact(text.trim(), category);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {notes.length === 0 && <div className="text-xs text-ink-500">{empty}</div>}
      {notes.map((f) => (
        <div key={f.id} className="text-xs text-ink-200 flex gap-1.5">
          <span className={category === "question" ? "text-accent" : "text-ok"}>{category === "question" ? "?" : "•"}</span>
          <span>{f.text}</span>
        </div>
      ))}
      <form onSubmit={submit} className="flex gap-1.5 mt-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={category === "question" ? "What's still unclear?" : "Add a fact for the team..."}
          maxLength={300}
          className="flex-1 bg-ink-800 border border-ink-600 rounded px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <button disabled={busy || !text.trim()} className="text-xs px-2 py-1 bg-ink-700 rounded disabled:opacity-40">
          Add
        </button>
      </form>
    </div>
  );
}

function HypothesesBoard({ hypotheses }: { hypotheses: Hypothesis[] }) {
  const { actions } = useGame();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < 5) return;
    setBusy(true);
    try {
      await actions.createHypothesis(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {hypotheses.length === 0 && <div className="text-xs text-ink-500">No active hypotheses yet.</div>}
      {hypotheses
        .slice()
        .reverse()
        .map((h) => (
          <HypothesisCard key={h.id} hypothesis={h} />
        ))}
      <form onSubmit={submit} className="flex gap-1.5 mt-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Propose a hypothesis..."
          maxLength={600}
          className="flex-1 bg-ink-800 border border-ink-600 rounded px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <button disabled={busy || text.trim().length < 5} className="text-xs px-2 py-1 bg-accent text-white rounded disabled:opacity-40">
          Propose
        </button>
      </form>
    </div>
  );
}

function HypothesisCard({ hypothesis }: { hypothesis: Hypothesis }) {
  const { myPlayerId, actions } = useGame();
  const iSupported = myPlayerId ? hypothesis.supportedBy.includes(myPlayerId) : false;
  const iChallenged = myPlayerId ? hypothesis.challengedBy.includes(myPlayerId) : false;

  return (
    <div className="border border-ink-700 rounded-md p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-ink-100 flex-1">{hypothesis.text}</p>
        <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${STATUS_STYLE[hypothesis.status]}`}>
          {hypothesis.status === "OPEN" ? "Evaluating..." : hypothesis.status}
        </span>
      </div>
      {hypothesis.aiRationale && <p className="text-[11px] text-ink-400 mt-1.5 italic">{hypothesis.aiRationale}</p>}
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={() => actions.supportHypothesis(hypothesis.id)}
          disabled={iSupported}
          className={`text-[11px] ${iSupported ? "text-ok" : "text-ink-400 hover:text-ok"}`}
        >
          &#9650; Support ({hypothesis.supportedBy.length})
        </button>
        <button
          onClick={() => actions.challengeHypothesis(hypothesis.id)}
          disabled={iChallenged}
          className={`text-[11px] ${iChallenged ? "text-sev-1" : "text-ink-400 hover:text-sev-1"}`}
        >
          &#9660; Challenge ({hypothesis.challengedBy.length})
        </button>
      </div>
    </div>
  );
}
