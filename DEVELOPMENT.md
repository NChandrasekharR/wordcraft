# Wordcraft Development Documentation

## What Is Wordcraft?

Wordcraft is a **parametric writing studio** — a spatial tool for exploring text variations through AI-powered generation. It treats rewriting as parameter adjustment rather than starting from scratch.

**Live:** https://nchandrasekharr.github.io/wordcraft/
**Repo:** https://github.com/NChandrasekharR/wordcraft

## Architecture

### Modular No-Build Design
- **index.html** (markup) + **css/styles.css** + eight classic scripts loaded in order: `js/util.js`, `js/api.js`, `js/measure.js`, `js/app.js`, `js/swarm.js`, `js/experiment.js`, `js/sensitivity.js`, `js/ablation.js` (see File Structure below)
- **No build step** — classic script tags (not ES modules), so opening `index.html` via `file://` still works
- **No backend** — client-side only, requests go directly to Anthropic API
- **BYOK (Bring Your Own Key)** — users provide their own Anthropic API key (localStorage, or sessionStorage-only via the modal checkbox)

### Key Technical Decisions
- Uses `anthropic-dangerous-direct-browser-access` header for direct browser API calls
- API key stored in `localStorage` (persists between sessions)
- Canvas uses CSS transforms for pan/zoom (not SVG or canvas element)
- Cards store state in `dataset` attributes (`rawText`, `diffHtml`, `viewMode`)
- LCS (Longest Common Subsequence) algorithm for diff computation

## Features Built

### Core Features
1. **Source Text Input** — Left panel textarea for entering text to transform
2. **Parametric Controls**
   - Tone slider: Casual ↔ Formal (5 levels)
   - Length slider: Shorter ↔ Longer (5 levels)
   - Complexity slider: Simple ↔ Elaborate (5 levels)
   - Audience dropdown: General, Technical, Academic, Young
   - Intent dropdown: Inform, Persuade, Entertain, Instruct, Inspire

3. **Infinite Canvas**
   - Pan: Click and drag on empty space
   - Zoom: Scroll wheel or +/- buttons
   - Auto zoom-to-fit when cards are added
   - Dot grid background pattern

4. **Cards**
   - Source cards (terracotta accent border)
   - Variant cards (generated text)
   - Critique cards (AI analysis, blue accent)
   - Draggable and resizable
   - Tags showing applied parameters

5. **Visual Connections**
   - SVG arrows connecting source → variants
   - Arrows update when cards are moved

6. **Diff View**
   - Toggle between plain text and diff on variant cards
   - Green highlights for additions
   - Strikethrough for deletions

### Analysis & Critique
- **Analyze button** — AI analyzes source text structure
- **Critique on selection** — Right panel shows AI critique when card selected
- **Best Fix suggestion** — One-click to apply AI-suggested improvement

### Quick Compare (Multi-Select)
- **Cmd/Ctrl + Click** to select multiple cards
- Numbered badges show selection order
- Floating comparison panel slides up from bottom
- Side-by-side columns with word counts
- Diff toggle compares against first selected card as baseline
- Escape key clears selection

### Export Options
1. **Copy button** — On each card, copies text to clipboard
2. **Download button** — Downloads individual card as formatted Markdown
3. **Export Session** — Top-right toolbar, exports all cards with metadata

### Onboarding UX
- API key entry deferred to first use (modal appears when needed)
- API Key button in toolbar shows status (green dot when set)
- Actions that need API prompt for key, then continue after saved

## File Structure

```
wordcraft/
├── index.html          # Markup only (panels, modals, toolbar)
├── css/styles.css      # All styles
├── js/util.js          # Pure helpers (escapeHtml, LCS diff, labels, prompt
│                       #   builder, JSON extraction) — Node-testable
├── js/api.js           # API/storage layer: model + key storage, retrying
│                       #   request core, callClaude/callClaudeJson/streamClaude
├── js/app.js           # Canvas, cards, panels, generate flows, persistence,
│                       #   toasts, undo, API-key modal wiring
├── js/measure.js       # Semantic-distance measurement layer (batched
│                       #   Haiku judge + order-normalized cache)
├── js/swarm.js         # Agent Swarm (planner/researcher/writers/critic/
│                       #   editor/judge, per-role models, cost readout)
├── js/experiment.js    # Controlled Experiment (baseline pool, Meaning +
│                       #   Wording verdicts, one-knob isolation)
├── js/sensitivity.js   # Sensitivity Map (per-knob impact vs noise floor)
├── js/ablation.js      # Ablation Lab (blind A/B pipeline-stage comparison)
├── tests/              # Unit tests (node --test tests/)
├── logo.png            # App icon (terracotta branching arrows)
├── README.md           # User-facing documentation
├── DEVELOPMENT.md      # This file
└── docs/               # Design thesis, talk, related work, checklist, logs
```

## Key Functions Reference

| Function | Where | Purpose |
|----------|-------|---------|
| `createCard(tags, content, type, opts)` | app.js | Creates/positions a card (opts for restore) |
| `deleteCard(card)` / `undoDeleteCard(...)` | app.js | Delete with toast-based undo |
| `materializeCard(data)` | app.js | Rehydrate a card from a snapshot (restore + undo) |
| `showToast(message, opts)` | app.js | Inline notifications (replaces alert/confirm) |
| `callClaude(prompt, opts)` | api.js | Non-streaming text request (retry/backoff/abort) |
| `callClaudeJson(prompt, {schema})` | api.js | Structured outputs → parsed JSON |
| `streamClaude(prompt, {onText})` | api.js | SSE streaming rewrite |
| `computeDiff` / `computeDiffStats` / `lcsParts` | util.js | LCS diff rendering + magnitude |
| `generateVariant()` | app.js | Main generation flow (streams into the card) |
| `runSwarm(config)` | swarm.js | Multi-agent orchestration |
| `runControlledExperiment()` | experiment.js | Signal-vs-noise run against the baseline pool |
| `serializeCanvas()` / `restoreCanvasState()` | app.js | localStorage persistence |
| `requireApiKey(action)` | app.js | Deferred API key pattern |

## Styling Details

### Color Palette
```css
--bg-deep: #f5f3f0        /* Page background */
--bg-surface: #ffffff      /* Cards, panels */
--accent-warm: #c45d35     /* Terracotta (primary) */
--accent-cool: #4a7c8c     /* Teal (critique cards) */
--accent-success: #2d8a5f  /* Green (diff additions) */
```

### Fonts
- **Fraunces** — Display headings (variable optical size)
- **Source Serif 4** — Body text, card content
- **JetBrains Mono** — Code, tags, UI labels

## Git History

```
af09392 Add copy/download buttons to cards and Quick Compare feature
abb57b8 Add export to Markdown and improve onboarding UX
e45d3b8 Move analysis to right side panel
df27536 Add source-first workflow with auto-analysis
[earlier commits for initial build]
```

## Next Steps / Future Ideas

Done in the 2026-07 passes: persistence (save/load), undo for deletion,
streaming with live card fill, retry/backoff error recovery, modular split,
unit tests, structured outputs, experiment noise distributions + one-knob
isolation, per-role swarm models + cost readout, toasts, API-key session
option, model picker. Still open (see also docs/project-checklist.md):

### High Priority
- [ ] **Keyboard shortcuts** — More shortcuts beyond Cmd+click and Escape
- [ ] **Redo / broader undo** — Undo currently covers card deletion only
- [ ] **Mobile responsiveness** — Current design is desktop/mouse-focused

### Features to Consider
- [ ] **Card linking** — Manually connect any two cards
- [ ] **Branching variants** — Generate variant from variant (not just source)
- [ ] **Custom parameters** — User-defined sliders/options
- [ ] **Prompt templates** — Save and reuse parameter combinations
- [ ] **Batch generation** — Parametric sweeps across parameter values
- [ ] **Swarm as data** — Declarative swarm config + graph view + single-step mode

### Polish
- [ ] **Card search** — Find cards by content or tags
- [ ] **Canvas minimap** — Overview navigation for large canvases
- [ ] **Themes** — Dark mode, custom color schemes
- [ ] **Accessibility** — Screen reader support, keyboard navigation

## Development Notes

### Running Locally
```bash
# Just open the file
open index.html

# Or serve it (for consistent behavior)
python -m http.server 8000
# Visit localhost:8000
```

### Making Changes
1. Edit `index.html` directly
2. Refresh browser to see changes
3. Test all features (generation, comparison, export)
4. Commit with descriptive message

### Deployment
GitHub Pages is configured to serve from `main` branch root. Push to `main` and changes go live within ~1 minute.

### Testing
Unit tests for the pure helpers in `js/util.js` (escaping, diffing, label
mapping, prompt building, loose JSON parsing) live in `tests/util.test.js`
and use only Node's built-in test runner — no dependencies, no `package.json`.

```bash
node --test tests/
```

This also works with no path (auto-discovers `tests/*.test.js`) or pointed at
a single file, e.g. `node --test tests/util.test.js`.

---

*Last updated: December 2024*
*Built with Claude Code*
