import { useState } from "react";
import type { Difficulty, GeneratedScenarioDefinition, ScenarioCatalogEntry } from "@raid/shared";
import { ApiError, generateScenario, saveGeneratedScenario, type GenerateScenarioResponse } from "../api/http.js";

/**
 * V0.5.7: a deliberately lightweight scenario-authoring UI — a description box, a Generate button,
 * a compact preview + validation readout, and a Save button. Not a no-code scenario editor: nothing
 * here is hand-editable field-by-field. If a generation attempt isn't good enough, the fix is to
 * regenerate with a clearer description, not to tweak individual fields in this UI.
 */
export function ScenarioGeneratorPanel({
  difficulty,
  onSaved,
}: {
  difficulty: Difficulty;
  onSaved: (entry: ScenarioCatalogEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<GenerateScenarioResponse | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!description.trim()) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    setSavedId(null);
    try {
      const res = await generateScenario(description.trim(), difficulty);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function save(candidate: GeneratedScenarioDefinition) {
    setSaving(true);
    setError(null);
    try {
      const { scenarioId, catalogEntry } = await saveGeneratedScenario(candidate, description.trim());
      setSavedId(scenarioId);
      onSaved(catalogEntry);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-xs text-accent hover:underline text-left mb-3"
      >
        + Generate a custom scenario with AI
      </button>
    );
  }

  return (
    <div className="bg-ink-950 border border-ink-700 rounded-lg p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-ink-300 uppercase tracking-wide">Generate a custom scenario</div>
        <button onClick={() => setExpanded(false)} className="text-xs text-ink-500 hover:text-ink-300">
          Close
        </button>
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder='e.g. "An intermediate Kubernetes incident caused by a broken readiness configuration"'
        className="w-full bg-ink-800 border border-ink-600 rounded px-2 py-1.5 text-xs outline-none focus:border-accent mb-2 resize-none"
      />
      <button
        onClick={generate}
        disabled={generating || !description.trim()}
        className="text-xs px-3 py-1.5 bg-ink-700 hover:bg-ink-600 rounded disabled:opacity-40"
      >
        {generating ? "Generating..." : "Generate"}
      </button>

      {error && <div className="text-xs text-sev-1 mt-2">{error}</div>}

      {result && (
        <div className="mt-3 border-t border-ink-800 pt-3">
          {!result.validation.valid ? (
            <div className="text-xs text-sev-1">
              <div className="font-semibold mb-1">Generation failed structural validation:</div>
              <ul className="list-disc list-inside space-y-0.5 text-ink-300">
                {result.validation.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              <div className="mt-2 text-ink-400">Try regenerating, possibly with a more specific description.</div>
            </div>
          ) : result.semanticReview && !result.semanticReview.passed ? (
            <div className="text-xs text-warn">
              <div className="font-semibold mb-1">Passed structural checks, but the design review flagged issues:</div>
              <ul className="list-disc list-inside space-y-0.5 text-ink-300">
                {result.semanticReview.issues.slice(0, 5).map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <div className="text-xs text-ok font-semibold mb-1">✓ Valid — passed structural checks and design review</div>
              <div className="bg-ink-900 rounded p-2 mb-2">
                <div className="text-sm font-semibold">{result.candidate.title}</div>
                <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">{result.candidate.severity}</div>
                <div className="text-xs text-ink-300">{result.candidate.briefing}</div>
                <div className="text-[10px] text-ink-500 mt-1.5">
                  {result.candidate.tools.length} tools · {result.candidate.evidence.length} evidence items ·{" "}
                  {result.candidate.evidence.filter((e) => e.isRedHerring).length} red herrings
                </div>
              </div>
              {savedId ? (
                <div className="text-xs text-ok">Saved — now available in the scenario list above.</div>
              ) : (
                <button
                  onClick={() => save(result.candidate)}
                  disabled={saving}
                  className="text-xs px-3 py-1.5 bg-accent hover:bg-accent/90 text-white rounded disabled:opacity-40"
                >
                  {saving ? "Saving..." : "Save & add to scenario list"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
