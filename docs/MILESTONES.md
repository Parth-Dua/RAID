# Milestones

Per-version acceptance conditions, tests, and results for the V0.1 → V0.6 roadmap. Each entry is
written after the phase's tests actually ran, not before — this is a record of what happened, not a
plan. See `README.md` for the roadmap summary and `docs/REVIEW_NOTES.md` for deep-dive bug writeups
that are too long to repeat here.

## DeepSeek API budget

Hard ceiling for all work in the V0.2-V0.6 roadmap: **$8.00 USD**. Tracked cumulatively below at the
end of every phase that makes live calls. `deepseek-v4-flash` via `AI_PROVIDER=deepseek`; all
automated tests use `AI_PROVIDER=mock` (zero cost) unless a phase's acceptance conditions specifically
require live-integration evidence mocks can't provide.

| Phase | Live requests | Est. input tokens | Est. output tokens | Est. cost | Cumulative |
|---|---|---|---|---|---|
| V0.1 (prior session) | 3 (all failed at network layer — sandbox egress blocked `api.deepseek.com`) | 0 (never reached the model) | 0 | $0.00 | $0.00 |

Running total: **$0.00 of $8.00**.

---

## V0.1 — Core multiplayer incident simulator (prior session)

Full build from an empty repository: monorepo, domain/game-engine, AI provider abstraction, backend
(rooms/sessions/sockets/services), frontend, one scenario, 68 automated tests, 19 ADRs, 10 rendered
Mermaid diagrams. Complete writeup in the initial commit and `docs/REVIEW_NOTES.md`/`docs/EVALUATION.md`.
Summarized here for continuity; not re-litigated.

**Status**: shipped, committed (`278f95b`, `953ecc7`).

---

(V0.2 onward recorded below as each phase completes.)
