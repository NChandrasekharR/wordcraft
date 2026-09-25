# Wordcraft — notes for agents

No-build browser app: `index.html` + `css/styles.css` + 8 classic scripts in
`js/` loaded in this order: util, api, measure, app, swarm, ablation,
experiment, sensitivity. All scripts share one global scope — prefix new
top-level names per module. Calls the Anthropic API directly from the browser
(BYOK). GitHub Pages deploys `main` as-is.

## Start here
- **What to work on:** `docs/roadmap.md` — prioritized, checkbox list. Work top-down, tick items with the commit hash.
- **Why:** `docs/audit-2026-09.md` — every finding with evidence and `file:line`.
- **Product intent:** `docs/agent-lab-thesis.md`. History: `docs/session-transcript*.md`.

## Tests (run both before and after every change)
```bash
node --test tests/                 # unit tests for pure helpers (no deps)
npm i --prefix tests/e2e           # once: axe-core for the a11y probe
node tests/e2e/smoke.js            # browser suite; or: node tests/e2e/smoke.js B X02
```
- `B**` = core flows, must be `PASS` (exit code 1 otherwise).
- `X**` = probes for audited bugs: `CONFIRMED` = still broken, `FIXED` = done. Keep fixed probes as regression tests; add a probe before fixing a new bug.
- Output goes to `tests/e2e/results/latest/` (gitignored). Commit a dated snapshot (`WORDCRAFT_OUT=tests/e2e/results/<date>`) when a batch of fixes lands.
- Playwright uses the preinstalled Chromium; see `.claude/skills/verify/SKILL.md` for mock-API details.

## Conventions
- Escape every user/model string (`escapeHtml` or `textContent`); never `innerHTML` model output.
- Verdict copy must state sample sizes and never claim significance; P1 statistics changes need owner sign-off (see roadmap).
- Keep docs in sync when a change alters behaviour (README, DEVELOPMENT.md, roadmap).
