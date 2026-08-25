import type { Difficulty, ScenarioDefinition } from "@raid/shared";

/**
 * Applies difficulty uniformly to any scenario's canonical (NORMAL-authored) definition. This is
 * the one and only place difficulty logic lives - individual scenario modules never branch on
 * difficulty, which is what keeps "difficulty" a data/rule transform rather than N copies of
 * scenario content (V0.3.3 "scenario engine generalization").
 *
 * NORMAL: every evidence item's interpretive `hint` (if authored) is appended to its content -
 * the reader gets the raw data AND a one-line steer on what it means.
 *
 * HARD: hints are withheld entirely (same raw data, no steer - the player has to draw the
 * conclusion themselves), and every time-gated evidence item's unlock threshold is pushed later
 * (x1.35, capped at 95% of the game's duration) - discovery takes longer and requires more
 * patience/re-checking, not just a shorter clock. Both changes are real reasoning-complexity
 * changes, not a timer adjustment (V0.3.2).
 */
export function applyDifficulty(scenario: ScenarioDefinition, difficulty: Difficulty): ScenarioDefinition {
  const evidence = scenario.evidence.map((e) => {
    const content = difficulty === "NORMAL" && e.hint ? `${e.content}\n  ${e.hint}` : e.content;
    const unlock =
      difficulty === "HARD" && e.unlock.atSeconds !== undefined
        ? { ...e.unlock, atSeconds: Math.min(Math.round(scenario.durationSeconds * 0.95), Math.round(e.unlock.atSeconds * 1.35)) }
        : e.unlock;
    return { ...e, content, unlock };
  });

  return { ...scenario, difficulty, evidence };
}
