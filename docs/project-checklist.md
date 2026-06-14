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

## ⬜ Outstanding

### Pre-existing bugs from the initial review (not yet fixed)
- [ ] **XSS / escaping:** source content injected via `innerHTML` in `createCard` — escape it
- [ ] Tags injected unescaped (latent XSS)
- [ ] Unguarded `data.content[0].text` in the single-shot `callClaude` (fixed only in `callClaudeRaw`)
- [ ] Fragile regex + `JSON.parse` for analysis/critique — prefer structured output / tool use

### High-impact improvements
- [ ] **Canvas persistence** to localStorage (biggest UX gap — work is lost on refresh)
- [ ] API key hardening (sessionStorage option + in-UI warning)
- [ ] **Model picker** (Opus/Sonnet/Haiku) + **streaming** responses
- [ ] Rate-limit / 429 / 529 handling with exponential backoff

### UX
- [ ] Delete / undo for cards
- [ ] Mobile / responsive layout + touch pan-zoom
- [ ] Batch / parametric sweep generation
- [ ] Replace `alert()` with inline styled messaging

### Code health
- [ ] Split inline CSS/JS into separate files
- [ ] Tests for `computeDiff` / `computeDiffStats` and JSON extraction; linting; `.gitignore`
- [ ] Remove or relocate root `CHAT_LOG.md`; drop the unused large `logo.png`

### Swarm — next steps
- [ ] Model-tool-use loop (agents call `create_card` / `read_card` themselves)
- [ ] Streaming + cheaper models for Critic/Judge (Haiku)
- [ ] Cost-estimate readout on the token meter
- [ ] Observability L1: expandable per-agent I/O traces
- [ ] Config-as-data (declarative swarm definition) + graph visualization + single-step mode

### Controlled Experiment — next steps
- [ ] One-knob isolation (vary a single parameter; let the user pick which)
- [ ] N-sample distributions / effect size for a more trustworthy verdict
- [ ] Real cancel mid-run (`AbortController` for `callClaude`)
- [ ] Adaptive modal width (narrow for intro/loading, wide for results)

### Verification
- [ ] **Smoke-test the Swarm and Controlled Experiment against the live API** — not yet
      exercised in this environment (no API key available here)
