# Wordcraft — Parametric Writing Studio

A spatial writing tool for exploring text variations through AI-powered parametric generation. Generate, compare, and refine multiple versions of your text on an infinite canvas.

![Wordcraft](logo.png)

## Live Demo

**[Try Wordcraft →](https://nchandrasekharr.github.io/wordcraft/)**

## Features

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
Click the **API Key** button in the top-right toolbar. Enter your Anthropic API key. The key is stored locally in your browser and never sent anywhere except directly to Anthropic's API.

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

Wordcraft is a single HTML file with no build step required.

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
- **Single HTML file** — All CSS and JavaScript inline
- **No dependencies** — Pure vanilla JavaScript
- **BYOK (Bring Your Own Key)** — Uses your Anthropic API key
- **Local storage** — API key persists between sessions
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
