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

## ⬜ Outstanding

### Pre-existing bugs from the initial review (not yet fixed)
- [ ] Fragile regex + `JSON.parse` for analysis/critique — prefer structured output / tool use

### High-impact improvements
- [ ] API key hardening (sessionStorage option + in-UI warning)
- [ ] **Streaming** responses
- [ ] Undo for card deletion

### UX
- [ ] Mobile / responsive layout + touch pan-zoom
- [ ] Batch / parametric sweep generation
- [ ] Replace `alert()` / `confirm()` with inline styled messaging

### Code health
- [ ] Split inline CSS/JS into separate files
- [ ] Tests for `lcsParts` / `computeDiffStats` and JSON extraction; linting
- [ ] Remove or relocate root `CHAT_LOG.md`; drop the unused large `logo.png`

### Swarm — next steps
- [ ] Model-tool-use loop (agents call `create_card` / `read_card` themselves)
- [ ] Streaming + cheaper models for Critic/Judge (Haiku)
- [ ] Cost-estimate readout on the token meter
- [ ] Observability L1: expandable per-agent I/O traces
- [ ] Config-as-data (declarative swarm definition) + graph visualization + single-step mode

### Controlled Experiment — next steps
- [ ] One-knob isolation (vary a single parameter; let the user pick which)
- [ ] N-sample distributions / effect size for a more trustworthy verdict (cache baseline samples per source to accumulate a noise distribution cheaply)
- [ ] Adaptive modal width (narrow for intro/loading, wide for results)

### Verification
- [ ] **Smoke-test the Swarm and Controlled Experiment against the live API** — not yet
      exercised in this environment (no API key available here)
