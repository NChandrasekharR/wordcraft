# Wordcraft — Project Checklist

*Status as of 2026-06-14. Tracks what's been built this session and what's outstanding.*

## ✅ Built & merged to `main`

- [x] **Repo review** — documented bugs, improvements, and code-health findings
- [x] **Agent Swarm orchestrator** (`index.html`)
  - [x] Planner → Researcher → Writers (parallel) → Critic → Editor → Judge
  - [x] Multi-turn, tool-capable `callClaudeRaw()` with `AbortController`
  - [x] `web_search` server tool for the Researcher
  - [x] Live activity panel (per-agent status, step/token meter, stop button)
  - [x] Swarm config modal (goal, writer count, revise rounds, web research)
  - [x] Card styles for research / verdict / winning variant
- [x] **Design docs** (`docs/`)
  - [x] `agent-lab-thesis.md` — counterfactual legibility & testable workflows
  - [x] `agent-lab-talk.md` — talk version (slides + speaker notes)
  - [x] `agent-lab-related-work.md` — shipping-product comparison matrix
- [x] **Controlled Experiment prototype** (`index.html`) — the "noise baseline"
  - [x] Runs current settings once + neutral baseline twice (parallel)
  - [x] Side-by-side Noise vs. Signal diffs + magnitude metrics
  - [x] Verdict: Real effect / Marginal / Within the noise
  - [x] `computeDiffStats()` change-magnitude helper
  - [x] Persists the candidate output as a card
  - [x] Per-step progress loading UX (PR #3)
- [x] **README** updated; **PR #2** and **PR #3** merged to `main`

## ✅ Fixed in the 2026-07 hardening pass

- [x] **XSS / escaping:** all user text and model output now routed through `escapeHtml` (`createCard` content + tags, critique/analysis rendering, compare-panel tags, error messages, diff output incl. `&`)
- [x] Unguarded `data.content[0].text` — `callClaude` now extracts all text blocks and throws on empty responses; warns on `max_tokens` truncation
- [x] **Canvas persistence** to localStorage (cards, connections, diffs, source text; restored on load) + **Clear** toolbar button
- [x] **Card deletion** (per-card delete button with connection/cache/selection cleanup)
- [x] **Model picker** (Opus 4.8 default / Sonnet 5 / Haiku 4.5) in the API key modal; deprecated hardcoded `claude-sonnet-4-20250514` removed
- [x] Rate-limit / 429 / 5xx / network retry with exponential backoff, shared by `callClaude` and `callClaudeRaw`
- [x] Real cancel mid-run for the Controlled Experiment (`AbortController`; closing the modal aborts in-flight calls)
- [x] Verdict copy no longer overclaims — labels/explanations note the single-sample basis
- [x] Deduplicated: single LCS core (`lcsParts`) behind `computeDiff`/`computeDiffStats`; shared slider-label fns; `buildParamPrompt` reused by Generate Variant; shared `finishVariantCard`/`addDiffToggle` (swarm-revised cards now get the Diff toggle too)
- [x] `--text-muted` undefined CSS variable fixed (`--text-tertiary`)
- [x] `.gitignore` added

## ✅ Done in the 2026-07 roadmap pass (multi-agent)

- [x] **Modular split** — `index.html` + `css/styles.css` + `js/{util,api,app,swarm,experiment}.js` as classic scripts (file:// keeps working); Node export shim on util
- [x] **Structured outputs** for all five JSON surfaces (analysis, critique, planner, critic, judge) — schema-guaranteed JSON, regex extraction demoted to fallback; `parseJsonLoose` rewritten as a balanced-brace scanner
- [x] **Streaming rewrites** — `streamClaude` (SSE) fills variant cards live; retry only before first byte
- [x] **Experiment: cached baseline pool → noise distribution** — baselines cached per (source, model) in localStorage (cap 8), noise = all pairwise diff ratios, percentile-based verdicts that state sample counts; 2–3 calls per run
- [x] **Experiment: one-knob isolation** (Test selector) + adaptive modal width
- [x] **Swarm: per-role models** (Haiku for critic/judge) + **cost readout** on the token meter
- [x] **Undo for card deletion** (toast action, persists correctly)
- [x] **Toasts replace every `alert()`/`confirm()`** (incl. two-step Clear confirmation)
- [x] **API key hardening** — "Remember key on this device" checkbox; unchecked = sessionStorage only
- [x] **Unit tests** — `tests/util.test.js`, 30 tests via `node --test tests/`
- [x] `CHAT_LOG.md` moved into `docs/`; end-to-end harness grown to 49 checks

## ⬜ Outstanding

### UX
- [ ] Mobile / responsive layout + touch pan-zoom
- [ ] Batch / parametric sweep generation
- [ ] Redo / broader undo (currently deletion only)

### Swarm — next steps
- [ ] Model-tool-use loop (agents call `create_card` / `read_card` themselves)
- [ ] Streaming for swarm writers/editor
- [ ] Observability L1: expandable per-agent I/O traces
- [ ] Config-as-data (declarative swarm definition) + graph visualization + single-step mode

### Controlled Experiment — next steps
- [ ] Sensitivity map — accumulate per-knob impact across experiments (thesis §7)
- [ ] Pool inspection UI (view/evict cached baselines)

### Code health
- [ ] Linting
- [ ] `logo.png` is large for a favicon — compress or replace

### Verification
- [ ] **Smoke-test the Swarm and Controlled Experiment against the live API** — not yet
      exercised in this environment (no API key available here)
