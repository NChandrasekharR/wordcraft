# Wordcraft — Parametric Writing Studio

A spatial writing tool for exploring text variations through AI-powered parametric generation. Generate, compare, and refine multiple versions of your text on an infinite canvas.

<img width="1919" height="993" alt="Screenshot 2025-12-28 at 4 09 36 PM" src="https://github.com/user-attachments/assets/54c9f6f0-5d64-43a7-bd6f-b8009a9fa127" />


## Live Demo

**[Try Wordcraft →](https://nchandrasekharr.github.io/wordcraft/)**

## Features

### Agent Swarm (Orchestrated)
Click **Swarm** in the toolbar to launch a multi-agent run from a single brief:
- **Planner** decomposes your goal into distinct writing angles
- **Researcher** (optional) gathers facts via web search and posts a research card
- **Writers** draft variants in parallel — each appears as a card on the canvas
- **Critic** presses and probes every draft for weaknesses
- **Editor** revises drafts to resolve the critique (configurable rounds)
- **Judge** ranks the variants and highlights a winner

A live activity panel shows each agent's progress, running step/token counts, and a **Stop Swarm** button to cancel mid-run.

### Controlled Experiment (Signal vs. Noise)
Click **Controlled Experiment** in the generation panel to test whether your parameter changes actually move the output — or whether you're just seeing the model's randomness. It runs your chosen configuration against a pool of neutral-baseline samples that is **cached across runs** (2–3 API calls per run), so the noise estimate is a real distribution over all baseline pairs rather than a single sample:
- **Noise** — how much pooled baseline samples differ from each other (min–max, median, pair count)
- **Signal** — how much your candidate differs from the pooled baselines (mean)

A percentile-based verdict tells you whether your change is a *likely real effect*, *marginal*, or *within the noise*, always stating how many samples back it — on **two tracks**: *Meaning* (a cheap model judges semantic distance, so a flipped "not" counts and reshuffled wording doesn't) and *Wording* (surface word-diff). A **Test** selector isolates a single knob (tone, length, complexity, audience, or intent) against the neutral baseline. This is a working implementation of the "control group for agents" idea explored in the design docs below.

### Sensitivity Map
Click **Sensitivity Map** to sweep every knob against the neutral baseline for your current text (~12 generations) and see a per-knob impact chart drawn against the noise floor: which knobs actually move *meaning*, which only move *wording*, and which sit inside the noise band. Results are cached per text, so reopening is free — the tool learns, and shows you, its own transfer function.

### Ablation Lab
Click **Ablate** in the toolbar to answer the question agent tools never answer: *does a pipeline stage actually earn its cost?* It runs the same brief through two arms (e.g. with vs. without the critic→editor round, or with vs. without web research), N trials each, then judges the outputs **blind** in randomized pairs and reports the win rate — with sample sizes stated and no significance theater.

### Design Notes
The `docs/` folder contains a design exploration on agentic UX:
- [`agent-lab-thesis.md`](docs/agent-lab-thesis.md) — the full thesis on counterfactual legibility and testable workflows
- [`agent-lab-talk.md`](docs/agent-lab-talk.md) — a talk-length version (slides + speaker notes)
- [`agent-lab-related-work.md`](docs/agent-lab-related-work.md) — how shipping agent products compare
- [`agent-lab-deck.html`](docs/agent-lab-deck.html) — a self-contained slide deck (open in a browser; ← / → to navigate)
- [`teaser.html`](docs/teaser.html) — a 50-second motion teaser of the app's capabilities, with a scrubbable storyboard (open in a browser; Space plays or pauses)

### Parametric Text Generation
- **Tone** — Slide from casual to formal
- **Length** — Compress or expand your text
- **Complexity** — Simple words or sophisticated vocabulary
- **Audience** — General, technical, academic, or young readers
- **Intent** — Inform, persuade, entertain, instruct, or inspire

### Infinite Canvas
- Pan and zoom to organize your variants spatially
- Visual arrows connect source text to generated variants
- Drag cards to arrange your workspace
- Resize cards to fit your content

### Quick Compare
- **Cmd/Ctrl + Click** to multi-select cards
- Side-by-side comparison panel slides up from bottom
- Toggle diff view to see changes highlighted against baseline
- First selected card becomes the comparison baseline

### Diff View
- Toggle between plain text and diff view on any variant card
- Additions highlighted in green
- Deletions shown with strikethrough

### AI Analysis
- Get structural analysis of your source text
- AI-powered suggestions for improvement
- One-click to apply suggested fixes

### Export Options
- **Copy** — Click the copy icon on any card to copy to clipboard
- **Download** — Download individual cards as formatted Markdown
- **Export Session** — Export all cards with word counts and tags

## Getting Started

### 1. Open Wordcraft
Visit [nchandrasekharr.github.io/wordcraft](https://nchandrasekharr.github.io/wordcraft/) or open `index.html` locally.

### 2. Add Your API Key
Click the **API Key** button in the top-right toolbar. Enter your Anthropic API key and pick a model (Claude Opus 5.5, Sonnet 5.5, or Haiku 5.5). Scoring roles (the semantic judge, the swarm critic and judge) always run on Haiku 5.5. The key is stored only in your browser and never sent anywhere except directly to Anthropic's API — uncheck "Remember key on this device" on shared machines to keep it for the current tab session only.

> **Get an API key:** Visit [console.anthropic.com](https://console.anthropic.com/) to create an account and generate an API key.

### 3. Enter Source Text
Paste or type your text in the left panel. This is the text you want to generate variations of.

### 4. Analyze (Optional)
Click **Analyze** to get AI-powered insights about your text's structure, readability, and suggestions for improvement.

### 5. Set Parameters
Adjust the sliders and dropdowns to define how you want your variant:
- Move **Tone** toward Casual or Formal
- Adjust **Length** to make it Shorter or Longer
- Set **Complexity** from Simple to Elaborate
- Choose your target **Audience**
- Select your writing **Intent**

### 6. Generate Variant
Click **Generate Variant**. A new card appears on the canvas with your transformed text. The card shows tags indicating which parameters were applied.

### 7. Compare & Iterate
- Generate multiple variants with different parameters
- Use **Cmd/Ctrl + Click** to select cards for comparison
- Toggle **Diff** view to see exactly what changed
- Copy your favorite version or export the entire session

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Click` | Multi-select cards for comparison |
| `Escape` | Clear selection |
| Scroll | Zoom canvas |
| Click + Drag (on canvas) | Pan view |
| Click + Drag (on card) | Move card |

## Local Development

Wordcraft has no build step — plain HTML, CSS, and classic scripts.

```bash
# Clone the repository
git clone https://github.com/NChandrasekharR/wordcraft.git
cd wordcraft

# Open in browser
open index.html
# or
python -m http.server 8000  # then visit localhost:8000
```

## How It Works

Wordcraft uses the Anthropic Claude API directly from the browser using the `anthropic-dangerous-direct-browser-access` header. Your API key is stored in localStorage and requests go directly to Anthropic's servers—no backend required.

### Architecture
- **No build step** — `index.html` + `css/styles.css` + eight plain scripts under `js/` (util, api, measure, app, swarm, ablation, experiment, sensitivity); open the file or serve the folder
- **No dependencies** — Pure vanilla JavaScript
- **BYOK (Bring Your Own Key)** — Uses your Anthropic API key
- **Streaming + structured outputs** — every request streams (rewrites fill their cards live); analysis, critique, judge and planner roles get schema-guaranteed JSON
- **Prompt caching** — stable content comes first: the system prompt and your source text (or the swarm's brief) form a cached prefix that every rewrite of the same text reads at a fraction of the input price. When several requests share that prefix (an experiment, a sensitivity sweep, swarm writers), the first goes out alone and the rest wait until it starts streaming, so they read its cache entry instead of each paying full price
- **Token budget** — effort is pinned per kind of call (`low` for rewrites and scoring, `medium` elsewhere), since thinking counts toward output tokens; the swarm panel shows tokens, how many came from cache, and the running cost
- **Refusal fallback** — Opus 5.5 and Sonnet 5.5 requests opt into server-side fallback, so a safety-classifier false positive is re-run on another model instead of failing
- **Local storage** — API key (opt-out to session-only), canvas, and experiment baselines persist in your browser
- **Client-side only** — No server, no tracking, no data collection

## Privacy

- Your API key is stored only in your browser's localStorage
- Text is sent directly to Anthropic's API (nowhere else)
- No analytics, tracking, or data collection
- Fully open source

## License

MIT

---

Built with Claude by [@NChandrasekharR](https://github.com/NChandrasekharR)
