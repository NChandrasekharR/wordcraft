---
name: verify
description: Build/launch/drive recipe for verifying Wordcraft (single-file browser app) end-to-end with Playwright and a mocked Anthropic API.
---

# Verifying Wordcraft

Wordcraft is a single `index.html` — no build step. The surface is a browser GUI
that calls `https://api.anthropic.com/v1/messages` directly (BYOK).

## Launch

```bash
# Serve the repo (opening via file:// also works, but http is consistent)
python3 -m http.server 8123 --directory /path/to/wordcraft
```

## Drive (Playwright)

- `npm install playwright` in a scratch dir. The npm package may want a newer
  Chromium than the pre-installed one — launch with
  `chromium.launch({ executablePath: '/opt/pw-browsers/chromium-<rev>/chrome-linux/chrome' })`
  (find it with `ls /opt/pw-browsers`).
- **Mock the API** with `context.route('**/api.anthropic.com/**', ...)`. Distinguish
  request kinds by prompt content: source analysis asks for `"tone": "casual" | ...`,
  card critique says `provide a critique`, everything else is a plain rewrite →
  return `{ content: [{type:'text', text}], stop_reason:'end_turn', usage:{...} }`.
- Set a fake key via the API Key modal (`#apiKeyBtn` → `#apiKeyInput` → `#apiKeySave`)
  before any generation.

## Gotchas

- The analysis/critique side panels overlay the canvas — click `#analysisClose`
  before interacting with cards on the right side.
- Card action buttons and the Text/Diff toggle are hover-revealed with CSS
  transitions: hover `.card .card-header`, `waitForTimeout(500)`, then click.
- Persistence saves are debounced ~400ms — wait ~700ms before reloading to test
  restore (`localStorage` key `wordcraft_canvas_v1`).
- `page.on('dialog', d => d.accept())` is needed for the Clear button's confirm().

## Flows worth driving

1. Add source with an XSS payload (`<img onerror=...>`, model output with
   `<script>`) → must render as literal text, no `window.__xss*` set.
2. Generate Variant (mock one 529 first to exercise retry) → variant card +
   Text/Diff toggle.
3. Reload → cards, connections, diff state, source text restored.
4. Delete a card → persists after reload; connections cleaned.
5. Controlled Experiment → verdict renders after 3 calls; closing the modal
   mid-run aborts (no card posted).
6. Clear button → empty canvas + storage removed.
