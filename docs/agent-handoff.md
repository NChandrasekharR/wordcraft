# Handoff prompt for the next coding agent

*Paste everything below the line into a new Claude Code session on
`NChandrasekharR/wordcraft`. Last updated 2026-09-28, after PR #9 merged.*

---

You are picking up **Wordcraft**, a no-build browser app (BYOK Anthropic API)
that is part writing studio, part "Agent Lab": it runs controlled experiments to
tell a user whether a knob changed an AI rewrite or they are looking at sampling
noise. The owner is Chandra, a Lead Product Designer who also authored the product
thesis. Calibrate to a senior practitioner; don't explain basics.

## 1. Read first, in this order
1. `CLAUDE.md`: architecture in one paragraph, test commands, conventions. Follow it.
2. `docs/roadmap.md`: **your work queue**. Checkbox list, P0 is done; P1/P2 are open.
3. `docs/audit-2026-09.md`: evidence and `file:line` for every roadmap ID (C1, H2, M5…).
4. `docs/agent-lab-thesis.md`: product intent. The verdict logic exists to serve it.
5. Skim `docs/session-transcript-2026-09-review.md` for how the audit was done.
6. `.claude/skills/verify/SKILL.md` for how the API mock works.

## 2. Current state (verify, don't trust)
- `main` @ `e25cdfb` (PR #9 merged): P0 fixes plus the P1 correctness subset (H5, M1, M8).
- Last e2e snapshot `tests/e2e/results/2026-09-25-after-p1-partial/`:
  **11 PASS, 16 FIXED, 4 CONFIRMED** (X14, X15, X16, X17: accessibility + card layout).
- Unit tests: 106/106.
- Before any change, run both suites and confirm you get the same numbers:
  ```bash
  node --test tests/
  npm i --prefix tests/e2e && node tests/e2e/smoke.js
  ```

## 3. How to work
- Branch from the latest `main` (the previous branch's PR is merged; don't stack on it).
- Work the roadmap **top-down**. For each item: add or adjust an `X**` probe in
  `tests/e2e/smoke.js` that reproduces it (CONFIRMED), fix, and see it flip to FIXED.
  Core `B**` flows must stay PASS. Tick the box with the commit hash.
- One commit per coherent batch; commit a dated results snapshot
  (`WORDCRAFT_OUT=tests/e2e/results/<date>-<label>`) when a batch lands.
- Keep README / DEVELOPMENT.md / roadmap / audit in sync with behaviour changes.

## 4. Open questions: ask Chandra, don't decide alone
1. **H2/H3/H4 (verdict statistics) need sign-off before implementation.** They
   change user-facing labels and unit-test expectations. Proposed:
   - H2 Ablation: label from an exact one-sided sign test (binomial tail), not from N.
   - H3 Experiment: replace "mean vs max of all baseline pairs" (power *drops* as the
     pool grows: 34% → 16%, see `tests/e2e/verdict-sim.js`) with a like-for-like
     leave-one-out comparison, or a permutation / energy-distance test with ≥3
     candidate samples (costs +2 generations per run). Which one, and is the extra
     cost acceptable?
   - H4 Sensitivity Map: hedge below 3 noise pairs, *or* draw a 3rd baseline (+1 call)?
   Present the options with cost and copy changes; wait for a decision.
2. **Product: pair every Generate with the noise pool?** The audit's main product
   finding is that the default action (Generate Variant) is a blind single re-run,
   which is the pattern the thesis criticises. A "meaning moved X% · noise Y–Z%" chip on
   each card is proposed but not agreed. Don't build it unasked.
3. **Slider quantization (M10):** 201 slider positions map to 7 prompts. Stepped
   5-stop knobs, or send the numeric value? This is a design call.
4. **Model picker:** Opus 5 exists at the same price as the default Opus 4.8 but can
   return `stop_reason: "refusal"` (now handled as an error). Add it? Change the default?

## 5. Safe to do without asking (in roadmap order)
- **P1:** M8b (`pause_turn` for the web-search researcher), H10-part (cap the
  baseline store, LRU by text). M9 (judge `max_tokens` vs 80-pair batches) needs a
  live API key to verify; implement the scaling but say it's unverified.
- **P2:** CI first (GitHub Actions: unit tests, e2e with the mocked API, eslint +
  stylelint; commit the lint configs, and note `AbortSignal` must be a declared
  browser global). Then M5 accessibility (probes X14/X17), M4 cards (X15/X16), M6
  diff off the main thread, L2–L6 hygiene, strict CSP meta tag (M2 rest).

## 6. Gotchas learned the hard way
- **Playwright auto-scrolls before clicking**, so it hides layout bugs. Assert
  `getBoundingClientRect()` against `innerHeight` (see probe X18).
- All 8 scripts share **one global scope**; prefix new top-level names per module.
  Lint by concatenating `js/*.js` in `index.html` load order.
- No API key or live site in the cloud environment by default: `api.anthropic.com`
  is mocked, and `nchandrasekharr.github.io` is blocked by the network policy
  (`main` served locally is identical to what Pages deploys). Any claim about real
  model behaviour is *unverified* unless a key is provided.
- Use the `claude-api` skill before touching model IDs, pricing, or request shapes.
  Don't answer those from memory.
- The mock routes requests by structured-output schema / system prompt
  (`classify()` in `smoke.js`); extend it when you add a new request type.
- `tests/e2e/results/latest/` is gitignored; only dated snapshots are committed.

## 7. Done looks like
Roadmap items ticked with hashes, probes flipped to FIXED, 11/11 core flows PASS,
unit tests green, a results snapshot committed, docs in sync, and a short summary
to Chandra listing what changed, what's verified, what isn't, and which open
questions still need an answer.
