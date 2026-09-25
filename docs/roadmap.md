# Wordcraft — Recommended Fix Order

Source of findings: [`docs/audit-2026-09.md`](audit-2026-09.md). Each item
names the audit ID and, where one exists, the harness probe that proves it
(`node tests/e2e/smoke.js <probe>` — `CONFIRMED` = still broken, `FIXED` = done).

**Rules for agents working this list**
1. Work top to bottom. Tick the box and add the commit hash when done.
2. Before and after each change run `node --test tests/` and `node tests/e2e/smoke.js`. Core flows (`B**`) must stay `PASS`.
3. When a probe flips to `FIXED`, keep it — it is now a regression test.
4. P1 items change user-facing verdict copy and unit-test expectations: confirm with the owner (Chandra) before merging.

## P0 — mechanical, high-impact (≈1 day)

- [ ] **C1** Layout overflow — `.app { grid-template-rows: minmax(0, 1fr); }` · probe X18
- [ ] **H1** Wheel over panels zooms canvas — ignore wheel events whose target is inside an overlay panel · probe X02
- [ ] **L1** Remove the `=======` merge marker and repair the mangled comment · probe X01
- [ ] **H6/H7** Critiques: render only if the card is still selected; don't critique `generating`/`error` cards · probes X03, X04
- [ ] **H8** Source card is the single source of truth for Generate Variant / suggestions (textarea edits create a new source card) · probe X05
- [ ] **H9** Treat SSE `error` events and a stream without `message_stop` as failures · probe X08
- [ ] **H10** Toast when canvas persistence fails · probe X11
- [ ] **M7** Restore the agent panel title after Ablation / set it in Swarm · probe X06
- [ ] **M3** Clear suggestion checkmarks + button state when the Analysis panel closes · probe X13
- [ ] **M2 (part)** Empty key + Save = forget the key (with a toast) · probe X12

## P1 — statistics & trust (confirm copy with owner)

- [ ] **H2** Ablation verdict from an exact one-sided sign test (binomial tail), not from N
- [ ] **H3** Experiment verdict: compare like with like (leave-one-out mean distance of each baseline vs the rest) or a permutation / energy-distance test with ≥3 candidates; export `verdictFor` for unit tests
- [ ] **H4** Sensitivity Map hedges below 3 noise pairs (or draws a 3rd baseline)
- [ ] **H5** Ablation aborts (or labels the run invalid) when research fails · probe X07
- [ ] **M1** Pools abort siblings on first error; Clear aborts in-flight requests · probes X09, X10
- [ ] **M8** Single pricing table in `api.js` with Sonnet 5 at $2/$10; retry 408/504, honour `retry-after`, add a request timeout; handle `refusal` / `pause_turn`
- [ ] **M9** Scale judge `max_tokens` with pair count or chunk batches (verify with a live key)
- [ ] **H10 (part)** Cap the baseline store (LRU by text)

## P2 — safety net & polish

- [ ] CI: GitHub Actions running `node --test tests/`, `node tests/e2e/smoke.js`, eslint + stylelint on every PR
- [ ] **M5** Accessibility: contrast tokens, labels for sliders/selects, dialog role + Esc + focus trap, keyboard-reachable card actions · probe X14, X17
- [ ] **M4** Selectable card text, scrollable resized cards, collision-aware placement · probes X15, X16
- [ ] **M6** Diff off the main thread (Worker) or an O(ND) algorithm; cap tokens
- [ ] **M10** Stepped (5-stop) knobs or send the numeric value; remove the contradictory dead-zone wording
- [ ] **L2/L3/L4/L5/L6** Move `extractText`/hash/pricing to `util.js`/`api.js`; stop persisting `diffHtml`; randomize Swarm judge order; docs refresh; move canvas hint
- [ ] **M2 (rest)** Strict CSP meta tag; consider a dedicated origin for the app
- [ ] Product: pair every Generate with the cached noise pool and show a noise chip on the card
