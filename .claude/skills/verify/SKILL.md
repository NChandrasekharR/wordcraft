---
name: verify
description: Build/launch/drive recipe for verifying Wordcraft (no-build browser app) end-to-end with Playwright and a mocked Anthropic API.
---

# Verifying Wordcraft

Wordcraft is `index.html` + `css/styles.css` + five classic scripts under `js/`
(no build step). The surface is a browser GUI that calls
`https://api.anthropic.com/v1/messages` directly (BYOK).

## Launch

```bash
python3 -m http.server 8123 --directory /path/to/wordcraft
```

## Unit tests (pure helpers)

```bash
node --test tests/    # js/util.js via its module.exports shim
```

## Drive (Playwright)

- `npm install playwright` in a scratch dir. The npm package may want a newer
  Chromium than the pre-installed one — launch with
  `chromium.launch({ executablePath: '/opt/pw-browsers/chromium-<rev>/chrome-linux/chrome' })`
  (find it with `ls /opt/pw-browsers`).
- A maintained harness usually exists at the session scratchpad as `verify.js`
  (49 checks). It reads `WORDCRAFT_REPO` (repo/worktree to serve) and
  `WORDCRAFT_PORT` env vars, so parallel runs don't collide.
- **Mock the API** with `context.route('**/api.anthropic.com/**', ...)`:
  - Request kind is detected from the structured-output schema:
    `body.output_config.format.schema.properties.tone` → analysis,
    `...properties.verdict` → critique; everything else is a rewrite.
  - Rewrites are requested with `body.stream === true` → respond with
    `contentType: 'text/event-stream'` and a proper SSE body
    (message_start, content_block_start, several content_block_delta
    text_delta chunks, content_block_stop, message_delta, message_stop).
  - Non-streaming JSON calls → `{ content: [{type:'text', text}], stop_reason,
    usage }`.
- Set a fake key via the API Key modal (`#apiKeyBtn` → `#apiKeyInput` →
  `#apiKeySave`) before any generation. The modal also has `#modelSelect` and
  the `#apiKeyRemember` checkbox (unchecked → sessionStorage).

## Gotchas

- The analysis/critique side panels overlay the canvas — click `#analysisClose`
  before interacting with cards on the right side.
- Card action buttons and the Text/Diff toggle are hover-revealed with CSS
  transitions: hover `.card .card-header`, `waitForTimeout(500)`, then click.
- Persistence saves are debounced ~400ms — wait ~700ms before reloading.
  localStorage keys: `wordcraft_canvas_v1`, `wordcraft_model`,
  `wordcraft_exp_baselines_v1`, `anthropic_api_key` (+ sessionStorage).
- There are NO native dialogs anymore — Clear and errors use toasts
  (`.toast`, `.toast-message`, `.toast-action`). Clear is two-step: click
  `#clearBtn`, then the toast's "Confirm clear" action.
- The experiment caches baselines: first run on a source = 3 API calls,
  subsequent runs = 2. Clear localStorage between runs if you need cold-pool
  behavior.

## Flows worth driving

1. XSS payloads in source text and model output render as literal text.
2. Generate Variant (mock a 529 first) → streams into the card → Text/Diff toggle.
3. Reload → cards, connections, diff state, source text restored.
4. Delete a card → Undo toast restores it (incl. connection + diff state);
   delete without undo persists after reload.
5. Experiment: cold run 3 calls → warm run 2 calls; verdict names its pair
   count; modal narrow → wide; cancel mid-run adds no card and no pool entry.
6. Clear via two-step toast → canvas + storage empty.
7. API key: checkbox checked → localStorage; unchecked → sessionStorage only.
