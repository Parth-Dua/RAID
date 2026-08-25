import { useState } from "react";
import { useGame } from "../state/GameProvider.js";

export function FinalSubmitForm() {
  const { gameSnapshot, actions } = useGame();
  const [rootCause, setRootCause] = useState("");
  const [remediation, setRemediation] = useState("");
  const [selectedEvidence, setSelectedEvidence] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!gameSnapshot) return null;
  const citableFacts = gameSnapshot.knownFacts.filter((f) => f.sourceEvidenceId);

  function toggle(evidenceId: string) {
    setSelectedEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(evidenceId)) next.delete(evidenceId);
      else next.add(evidenceId);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    try {
      await actions.submitFinal(rootCause.trim(), [...selectedEvidence], remediation.trim());
      setSubmitted(true);
    } catch {
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return <div className="text-sm text-ok">Final diagnosis submitted. Evaluating...</div>;
  }

  const valid = rootCause.trim().length >= 10 && remediation.trim().length >= 5;

  return (
    <div className="border border-ink-700 rounded-md p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-300">Final diagnosis</div>
      <textarea
        value={rootCause}
        onChange={(e) => setRootCause(e.target.value)}
        placeholder="Root cause: what happened, and why?"
        rows={4}
        maxLength={1500}
        className="bg-ink-800 border border-ink-600 rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent resize-none"
      />
      <textarea
        value={remediation}
        onChange={(e) => setRemediation(e.target.value)}
        placeholder="Remediation: what would fix / prevent this?"
        rows={2}
        maxLength={800}
        className="bg-ink-800 border border-ink-600 rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent resize-none"
      />

      {citableFacts.length > 0 && (
        <div>
          <div className="text-[10px] text-ink-400 uppercase tracking-wide mb-1">Cite known facts</div>
          <div className="flex flex-col gap-1 max-h-24 overflow-y-auto scrollbar-thin">
            {citableFacts.map((f) => (
              <label key={f.id} className="flex items-start gap-1.5 text-xs text-ink-300">
                <input
                  type="checkbox"
                  checked={selectedEvidence.has(f.sourceEvidenceId!)}
                  onChange={() => toggle(f.sourceEvidenceId!)}
                  className="mt-0.5"
                />
                <span>{f.text}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          disabled={!valid}
          className="mt-1 bg-sev-1 hover:bg-sev-1/90 disabled:opacity-30 text-white text-xs font-semibold py-2 rounded-md transition-colors"
        >
          Submit final diagnosis
        </button>
      ) : (
        <div className="flex flex-col gap-1.5 mt-1">
          <div className="text-xs text-warn">This ends the incident for everyone. Are you sure?</div>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 bg-sev-1 hover:bg-sev-1/90 disabled:opacity-50 text-white text-xs font-semibold py-2 rounded-md"
            >
              {busy ? "Submitting..." : "Yes, submit"}
            </button>
            <button onClick={() => setConfirming(false)} className="flex-1 bg-ink-700 text-ink-100 text-xs py-2 rounded-md">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
