# Wordcraft Development Documentation

## What Is Wordcraft?

Wordcraft is a **parametric writing studio** — a spatial tool for exploring text variations through AI-powered generation. It treats rewriting as parameter adjustment rather than starting from scratch.

**Live:** https://nchandrasekharr.github.io/wordcraft/
**Repo:** https://github.com/NChandrasekharR/wordcraft

## Architecture

### Single-File Design
- **One HTML file** (~3300 lines) containing all CSS and JavaScript inline
- **No build step** — open `index.html` directly in browser
- **No backend** — client-side only, requests go directly to Anthropic API
- **BYOK (Bring Your Own Key)** — users provide their own Anthropic API key

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
├── index.html      # Main application (all-in-one)
├── logo.png        # App icon (terracotta branching arrows)
├── README.md       # User-facing documentation
└── DEVELOPMENT.md  # This file
```

## Code Organization (within index.html)

### CSS Sections (~1100 lines)
- CSS variables (color palette, fonts)
- Layout (sidebar, canvas container)
- Components (cards, buttons, sliders, modals)
- Card variants (source, variant, critique, generating, error)
- Comparison panel styles
- Responsive adjustments

### HTML Structure (~100 lines)
- Sidebar with logo, source input, parameters, actions
- Canvas container with zoom controls
- Comparison panel (hidden by default)
- API key modal
- Canvas toolbar (API key, Export buttons)

### JavaScript (~2100 lines)
- State variables (scale, pan, connections, selectedCard, etc.)
- Canvas transform and zoom functions
- Card creation and management
- Drag, resize, and selection handling
- Multi-select and comparison panel
- API calls to Claude (callClaude function)
- Diff computation (LCS algorithm)
- Export functions (Markdown generation)
- Event listeners

## Key Functions Reference

| Function | Purpose |
|----------|---------|
| `createCard(tags, content, type)` | Creates and positions a new card |
| `callClaude(prompt)` | Makes API request to Anthropic |
| `computeDiff(original, modified)` | LCS-based diff with HTML markup |
| `generateVariant()` | Main generation flow |
| `analyzeSource()` | Analyzes source text structure |
| `critiqueCard(card)` | Generates critique for selected card |
| `toggleMultiSelect(card)` | Adds/removes card from comparison |
| `renderCompareColumns()` | Updates comparison panel content |
| `exportToMarkdown()` | Exports full session |
| `downloadCardAsMarkdown(card)` | Exports single card |
| `requireApiKey(action)` | Deferred API key pattern |
| `zoomToFit()` | Auto-frames all cards in view |
| `updateConnections()` | Redraws SVG arrows |

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

### High Priority
- [ ] **Keyboard shortcuts** — More shortcuts beyond Cmd+click and Escape
- [ ] **Undo/Redo** — State history for canvas operations
- [ ] **Save/Load sessions** — Persist canvas state to localStorage or file
- [ ] **Mobile responsiveness** — Current design is desktop-focused

### Features to Consider
- [ ] **Card linking** — Manually connect any two cards
- [ ] **Branching variants** — Generate variant from variant (not just source)
- [ ] **Custom parameters** — User-defined sliders/options
- [ ] **Prompt templates** — Save and reuse parameter combinations
- [ ] **Batch generation** — Generate multiple variants at once
- [ ] **Version history per card** — Track edits within a card
- [ ] **Collaborative editing** — Real-time multiplayer (would need backend)

### Polish
- [ ] **Loading states** — Better skeleton/shimmer while generating
- [ ] **Error recovery** — Retry failed generations
- [ ] **Card search** — Find cards by content or tags
- [ ] **Canvas minimap** — Overview navigation for large canvases
- [ ] **Themes** — Dark mode, custom color schemes
- [ ] **Accessibility** — Screen reader support, keyboard navigation

### Technical Debt
- [ ] Consider breaking into modules if file grows much larger
- [ ] Add TypeScript for better maintainability
- [ ] Unit tests for diff algorithm and core functions

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

---

*Last updated: December 2024*
*Built with Claude Code*
