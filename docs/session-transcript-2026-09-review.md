# Wordcraft — Session Transcript: Engineering Review & Smoke Test (2026-09-25)

*Verbatim user messages and assistant replies (the assistant's user-visible
text). Tool calls and their raw output are omitted; the artifacts they produced
live in `tests/e2e/` and `tests/e2e/results/`. Findings are consolidated in
[`docs/audit-2026-09.md`](audit-2026-09.md) and the fix order in
[`docs/roadmap.md`](roadmap.md).*

---

## 1. User

> Review this thoroughly as an engineering expert, ensure best in class engineering practices are applied. Smoke test it remotely and confirm if any issues. Read the entire repo, explain it to me from first principles from a UX and Product perspective what it is and what it does.

## Assistant (progress messages, in order)

> I'll start by getting the lay of the land.

> The repo is ~10.8K lines across 27 files, small enough to read all of it myself. I'll start with the docs and the project's own verify skill.

> Now the app itself, in script load order. Markup first, then the pure helpers and API layer.

> Note: `api.js` calls `extractText()`, which isn't defined in that file. I'll confirm where it lives. Next, the measurement layer and the main app.

> `app.js` is read. Several suspects to verify later: panel scrolling vs. the canvas wheel handler, critiques on in-flight cards, and textarea/source-card lineage. Next, the four feature modules.

> All eight JS modules are read. The feature code has real findings, including two in the statistics that the product's "honest verdict" pitch depends on; I'll verify those empirically. Next: CSS (2.4K lines) and the tests.

> Status: I've read all the app code (HTML, 8 JS modules, 2.4K lines of CSS) and have a list of suspected bugs. One is already confirmed: a leftover git merge-conflict marker (`=======`) at `css/styles.css:2301`. Next I'll read the tests and docs, then smoke-test in a real browser.

> The tests cover pure helpers only. `experiment.js` (the flagship verdict logic) has no unit tests, `api.js` (retry and SSE parsing) has none either, and the 100-check e2e harness the skill mentions isn't in the repo. Now the design docs, which I need for the product explanation.

> Update: I've now read every file in the repo, docs included. Next I'll run the test suite, check the environment for a browser and an API key, and look up the current Claude API reference, so I can confirm whether the app's model IDs and request shapes are valid.

> The skill confirms several facts. I'll pull the specific sections for pause_turn, retryable errors, mid-stream SSE errors, and structured-output model support.

> API facts are verified. Two concrete corrections came out of it: Sonnet 5 is priced at $2/$10, while the code hardcodes $3/$15 in two tables, and the web-search tool versions and `output_config` shape the app uses are correct. Next I'll check network access and whether the live site matches `main`, then build the browser harness.

> The live GitHub Pages site isn't reachable from this container; the npm registry is. I'll check why github.io is blocked before deciding whether to test the deployed build or only `main`.

> The environment's network policy blocks `nchandrasekharr.github.io` (a policy 403). GitHub Pages serves the `main` root with no build step, so serving the `main` checkout locally tests the same files, and I'll use that as the workaround. I'll pull the network-settings doc so you can allow the host if you want a live-site pass later.

> The environment's network policy blocked `nchandrasekharr.github.io`. To test the live site directly, open the cloud environment menu in the session title bar, choose Edit, and under Network access either raise the access level or add that domain. For now, `HEAD` is identical to `origin/main`, so the local server serves exactly what Pages deploys.
>
> Now the numeric checks. These are pure-function claims I can prove in Node before touching the browser.

> Several claims are now confirmed:
>
> - The Ablation verdict label depends on sample size, not the margin. A 3–2 split, which is a coin flip (p = 0.50), is labelled "Moderate signal". A 3–0 sweep has stronger evidence (p = 0.125) yet gets the weaker label.
> - The sliders have 201 positions but produce only 7 distinct prompts. At +10 the prompt contradicts itself ("Neutral (more formal)").
> - The diff algorithm costs about 0.1s per pair at 1,000 words and 1.3s per pair at 3,000 words, all on the main thread.
>
> Now the browser harness.

> Playwright 1.56.1 and Chromium are installed. I'll add axe-core from npm (reachable) for an authoritative accessibility scan, then write one harness that covers two groups: the core user flows, which should pass, and a probe for each suspected bug.

> I'll write the harness now: a local static server for the repo, a mocked Anthropic API that routes each request by its schema (the approach the repo's verify skill describes), and one scenario per claim. Each result prints PASS or FAIL for a core flow and CONFIRMED or NOT-REPRODUCED for a suspected bug, with the evidence.

> The harness is written: 11 core-flow tests and 17 bug probes. Running it now.

> All 11 core flows pass. 16 of the 17 suspected bugs reproduced in the real UI. X11 reported "not reproduced", but the evidence contradicts that: the card was still gone after reload. My check tested for a missing storage key, while the app had left a stale empty-canvas save in place. I'll tighten that probe and re-run it, then pull the accessibility details.

> X11 is confirmed too: the save threw a quota error, no warning was shown, and the card was gone after reload. That's 17 of 17 suspected bugs reproduced. The accessibility scan found that primary buttons are 3.66:1 contrast (below the 4.5:1 WCAG AA minimum) and that the sliders and selects have no accessible names.
>
> Two more checks remain. First, a simulation of the Controlled Experiment's verdict rule, because its calibration is the product's core promise. Second, a lint pass over all scripts concatenated in load order, so cross-file globals resolve correctly.

> Lint is clean apart from one unused variable. No undefined cross-file globals and no redeclarations, which is good discipline given all eight scripts share one global scope.
>
> The simulation surfaced the most important product finding. With no real effect, the Experiment wrongly reports a real effect only 1–6% of the time, so false alarms are rare. But for a modest real effect, the chance of it saying "real" falls from 34% to 16% as the baseline pool grows from 3 to 8. The tool gets less able to detect the same effect the more you use it, while its own copy says "run again to tighten the noise estimate". Next I'll pin exact line numbers for the write-up.

> All line numbers are pinned. Next I'll look at the overlap screenshot to check the rendered UI matches the numbers.

> The screenshot confirms the overlapping cards. It also shows something I didn't expect: the top-right toolbar and the sidebar logo have both scrolled out of view, even though the page sets `overflow: hidden`. That could be a harness artifact or a real layout bug, so I'll measure it directly rather than guess.

> The Tab probe didn't reproduce focus-scrolling. It did turn up something more important: at both 900px and 768px viewport heights, `.sidebar-content` is 968px tall and can't scroll (scrollHeight equals clientHeight). That suggests the grid row grows past the viewport once the Parameters panel appears. If so, anything pinned to the bottom of the canvas area (zoom controls, toasts, the compare panel) could end up below the visible screen. I'll measure that directly at common laptop heights.

> This is the most serious finding so far. Once a user clicks "Add to Canvas", the layout's single grid row stretches to 1,111px no matter the screen height. On anything shorter than that (most laptops, and even a full-HD monitor once browser chrome takes its share) this happens:
>
> - **Toasts render below the visible screen.** Undo, errors, and the "Confirm clear" button all live there, so Clear effectively can't be completed with a mouse.
> - **Zoom controls and the compare panel sit off-screen.**
> - **At 900px and below, the Controlled Experiment and Sensitivity Map buttons are unreachable.** The page sets `overflow: hidden`, so mouse users can't scroll to them.
>
> My harness missed this earlier because Playwright auto-scrolls elements into view before clicking. I'll confirm the root cause by testing a one-line CSS fix, and look at what a user actually sees.

> The fix works. With `grid-template-rows: minmax(0, 1fr)` on `.app`, toasts, zoom controls and the compare panel are back on screen at every height, and the sidebar scrolls normally. The screenshot matches the numbers: at 900px, the toast and compare panel I opened aren't visible, and the flagship buttons are cut off below "Generate Variant". One last check: whether a mouse user can scroll the page to reach the cut-off buttons at all.

## Assistant (final reply)

I read all 27 files in the repo and smoke-tested `main` in a headless browser against a mocked Anthropic API. Everything that works is below, plus 18 issues I reproduced in the real UI.

**Bottom line:** the core writing loop and all four experiment features work end to end. But one layout bug hides key controls on most laptop screens, and several statistics bugs undercut the product's central promise: honest verdicts. The code is cleaner than a no-build app usually is. What's missing is a safety net: there's no CI, and the end-to-end test harness was never committed. That's how a leftover git merge-conflict marker reached the live CSS.

### What Wordcraft is, from first principles

**The problem.** An AI rewrite is a *sample*: what comes out depends on your text and instructions, plus randomness. Turn a knob, regenerate, and you see a difference, but you can't tell how much of it came from the knob. Every "control panel" AI tool leaves users crediting randomness to their edits and building confident, wrong mental models.

**The core idea is a control group.** Re-run the *unchanged* settings to measure how much the output drifts by chance alone (the noise floor). A knob only "did something" if its effect clears that floor. Everything distinctive in Wordcraft applies this one idea at a different scale:

| Tool | Question | Method |
|---|---|---|
| Controlled Experiment | Did *my* change do anything? | One rewrite with your settings vs a saved pool of neutral rewrites |
| Sensitivity Map | Which knobs matter *for this text*? | 10 one-knob changes vs the same pool, charted per knob |
| Ablation Lab | Does a pipeline *stage* earn its cost? | N runs per variant, blind randomized judging, win rate |

It measures change two ways, because "different" is ambiguous:
- **Wording** is a local word-level diff. It's free, but it counts paraphrase as change and barely registers a flipped "not".
- **Meaning** is a distance score from a cheap model (Haiku). It drives the headline verdict.

Cost, the constraint your thesis names, is spread out: the neutral rewrites and their scores are saved per model and text, so repeat experiments cost 2 generations plus 1–2 cheap judge calls.

**The studio around it.**
- Paste text, then *Add to Canvas*, which triggers an automatic analysis with 3 suggestions.
- Knobs produce variants that stream into cards, with arrows back to the source and a Text/Diff toggle.
- Clicking a card gives a critique with an "Apply Fix" button.
- Cmd-click compares cards; you can export everything as Markdown.

The canvas works as spatial memory: arrows record where each variant came from. The Swarm (planner, writers, critic, editor, judge) is deliberately the "process theater" your thesis criticizes, and the thing the Ablation Lab puts on trial.

**Where the build and the thesis diverge:**
- **The default action is the thing the thesis criticizes.** Generate Variant is a blind single re-run. The control group is opt-in and costs extra (and at 900px-tall windows and below, its button is currently off-screen, see #1). The saved pool already makes pairing cheap. Put a small "meaning moved 62% · noise 10–18%" badge on every generated card, and the thesis becomes the default experience.
- **The knobs are coarser than they look.** The sliders have 201 positions but produce only 7 distinct prompts. At +10 the prompt literally reads "Tone: Neutral (more formal)". For a tool about readable cause and effect, the controls overstate their own precision.
- **Verdicts aren't calibrated the way the copy claims** (#3–5 below). Where a variant came from can also be wrong (#9).
- **The Swarm's judge isn't blind** (it always sees candidates in the same order) while the Ablation judge is. The lesson isn't applied inside the theater.
- **Today it's an instrument for one paragraph, not yet a lab.** There's no set of test texts yet (to check "does this help in general?") and no path from experiment to trusted setting.

### Smoke test

**Setup:**
- I served `main` locally; it's identical to what GitHub Pages deploys.
- I drove it with Playwright and mocked `api.anthropic.com`, returning realistic responses for every request type, including streamed rewrites.
- No API key exists in this environment, so nothing hit the live API.
- This environment's network policy blocked `nchandrasekharr.github.io`, so I couldn't test the live site. To allow it, open the cloud environment menu in the session title bar, choose Edit, and add that host under Network access.

**All 11 core flows pass:**
- page load and API key storage (remembered vs session-only)
- Add to Canvas with analysis
- Generate Variant, including a forced overload error → retry → streaming → Diff toggle → reload restores everything
- delete with Undo, and the two-step Clear
- malicious-HTML (XSS) payloads rendered as plain text everywhere
- Controlled Experiment: 3 generations cold, 2 warm
- Sensitivity Map: 12 generations, free to reopen
- Ablation Lab: 15 calls, blind judging
- Swarm, Quick Compare and Markdown export

All 106 unit tests pass. Lint across all scripts in load order: 0 undefined globals, 1 unused variable.

### Issues found (18 reproduced in the browser, plus numeric checks)

#### Critical
**1. Once a source is added, key controls render off-screen on most laptops.** The page layout's single grid row stretches to the sidebar's full height (1,111px) regardless of window size. I measured at 768, 800, 900 and 1080px:
- Toasts land around y≈1,083px. They hold Undo, error messages, and **"Confirm clear"**, so Clear appears to do nothing.
- The zoom controls sit at about y≈1,087px, and the compare panel's bottom edge at 1,111px.
- At 900px and below, the **Controlled Experiment and Sensitivity Map buttons can't be reached**. The page sets `overflow: hidden`, so the scroll wheel and PageDown don't help.

Returning users hit this on page load, because restoring a saved canvas shows the panel. My harness initially missed it because Playwright auto-scrolls before clicking. **One-line fix, verified at all four heights:** `.app { grid-template-rows: minmax(0, 1fr); }` in the `.app` rule at `css/styles.css:52`.

#### High
2. **Scrolling over any side panel zooms the canvas instead of scrolling the panel.** A critique panel with 780px of hidden content stayed at scroll position 0 while zoom went from 90% to 81% (`js/app.js:351`).
3. **The Ablation verdict label depends on sample size, not the margin.**
   - A 3–2 split in 5 comparisons is a coin flip (p=0.50) but reads "Moderate signal".
   - A 3–0 sweep has stronger evidence (p=0.125) but reads the weaker "Suggestive".
   - 5–0 (p=0.03) gets the same label as 3–2.

   See `js/ablation.js:99-103`.
4. **The Experiment's verdict compares an average against the most extreme noise pair.** I simulated the shipped rule. A modest real effect is detected 34% of the time with 3 saved rewrites, dropping to 16% with 8, so running more makes it *less* able to detect a real effect, the opposite of what "run again to tighten" promises. With no real effect, roughly half of runs say "Marginal" (`js/experiment.js:139`).
5. **The Sensitivity Map says "move meaning well beyond noise" based on one noise comparison.** The chart footer says "noise from 1 pair". The Experiment's own rule hedges below 3 pairs (`js/sensitivity.js:113, 437`).
6. **Ablation "research" test: if the web research fails, both arms are identical, yet a "Web research — …" verdict is still posted.** I found exactly 1 distinct writer prompt across both arms (`js/ablation.js:370-376`).
7. **Critique race.** A slow critique for card A renders while card B is selected, and **Apply Fix then creates a card from A's text under B** (`js/app.js:609-631`).
8. **Clicking a card that is still generating critiques the placeholder text "Generating".** That critique is cached for the session; only Re-analyze clears it (`js/app.js:447-452`).
9. **Variants can point at the wrong source.** Generate Variant rewrites whatever is in the text box, but draws the arrow and diff from the *old* source card. In my test it rewrote the "BRAVO" text but linked to the "ALPHA" card. The Experiment, Swarm and Ablation use the card's text instead (`js/app.js:1212-1219`).
10. **If the API errors mid-stream, the cut-off text is saved as a finished variant with no error shown.** The streaming code ignores error events and never checks that the response completed (`js/api.js:162-207`).
11. **When browser storage is full, saving fails silently and work is lost on reload.** The store of saved baseline rewrites has no limit on how many texts it covers, so this is reachable in normal use (`js/app.js:1433-1439`, `js/experiment.js:66-74`).

#### Medium
12. **Wasted API spend:**
    - Parallel runs don't stop their siblings when one fails. The Sensitivity Map showed its error after 5 calls, then fired 7 more (`js/sensitivity.js:297`, `js/ablation.js:257`).
    - Clear doesn't cancel requests already in flight (`js/app.js:1513`).
13. **API key handling:**
    - A remembered key can't be removed from the UI; saving an empty field silently does nothing (`js/app.js:236`).
    - All your `nchandrasekharr.github.io` Pages sites share one browser origin, so any other page you publish there can read the stored key.
    - There's no Content Security Policy, even though a strict one would be nearly free here because all scripts are external files.
14. **Suggestions get out of sync.**
    - Closing the Analysis panel clears the selection internally but leaves the checkmarks; on reopen, "Generate from Suggestion" is enabled but does nothing.
    - While any suggestion is selected, the main Generate button silently ignores the sliders (`js/app.js:1044`, `1226`).
15. **Card problems:**
    - Text inside cards can't be selected.
    - A resized card cuts off its content with no scrolling.
    - Automatic placement uses fixed 300px rows, so long cards overlap each other (`css/styles.css:756-758`, `js/app.js:846`).
16. **Accessibility:**
    - An automated scan (axe-core) found 16 contrast failures; the orange primary buttons are 3.66:1 against the 4.5:1 minimum.
    - The 3 sliders and 2–3 dropdowns have no accessible names.
    - Dialogs don't close on Escape and keyboard focus escapes them.
    - Card actions appear only on hover.
17. **The diff algorithm blocks the page on longer texts.** One comparison takes 0.1s and 33MB at 1,000 words, and 1.3s and 290MB at 3,000 words. An Experiment with a full saved pool runs 36 comparisons, and the Sensitivity Map about 108, so longer texts freeze the page for seconds (`js/util.js:30-63`).
18. **The Ablation Lab borrows the Swarm's activity panel and never restores its title**, so later Swarm runs are labelled "Ablation Lab" (`js/ablation.js:351`).
19. **API details:**
    - Sonnet 5 is priced at $3/$15 per million tokens in code; the actual price is $2/$10, so cost estimates are 50% high. It appears in `js/swarm.js:36`, `js/sensitivity.js:35` and the test file.
    - Retries skip timeout errors (408 and 504), ignore the server's retry-after hint, and have no timeout.
    - Two rarer response types from the API aren't handled: a paused web search (`pause_turn`) and a model refusal.
    - Verified correct: the model IDs, the structured-output request format, and which web-search tool version each model gets.
20. **Two risks I couldn't verify without a key:**
    - With a full saved pool, the Sensitivity Map asks the cheap judge to score 80 pairs in one call with a 1,000-token output cap (~12.5 tokens per score). That likely truncates, silently dropping to wording-only (`js/measure.js:20`).
    - Sonnet 5 thinks by default when the request doesn't say otherwise, which can eat small token budgets (400 for the Ablation judge).

#### Low / hygiene
- **Leftover merge-conflict marker** `=======` at `css/styles.css:2301` silently drops the styling for the Ablation cost line. A comment at line 2080 was mangled in the same merge. Impact is trivial; the signal that nothing checks `main` before it goes live is not.
- **Code structure:**
  - The API layer calls `extractText()`, which is defined in the Swarm file (`js/swarm.js:68`). Delete that file and the API layer breaks.
  - The same hash function is copied 3 times and the pricing table twice.
  - The rendered diff HTML is saved to storage and inserted back as HTML (`js/app.js:1463`); saving the original texts and recomputing would be safer.
- **Stale docs:**
  - The README lists 5 scripts (there are 8) and the wrong audience options.
  - DEVELOPMENT.md has an outdated load order and says "Last updated Dec 2024".
  - The "100-check" end-to-end harness mentioned in the checklist isn't in the repo.

### Engineering practices vs best in class
**What's solid:**
- All 8 scripts share one global scope, yet lint finds no conflicts.
- Escaping is consistent; every XSS probe rendered as plain text.
- Strict output formats for every model call, with graceful fallback when the judge fails.
- Saved baselines are only committed after a run fully succeeds.
- Unit tests even enforce the honest wording.

**What's missing:**
- **No CI.** Pages publishes `main` directly, with nothing checking it first.
- **No committed browser tests.**
- **No lint or formatting config.**
- **The riskiest code is untested:** the retry and streaming logic, the Experiment's verdict function, and persistence.
- **Failures are silent across the board.**

### Recommended order
- **P0 (about a day, all mechanical):**
  - the one-line layout fix
  - stop the zoom handler from capturing scrolls over panels
  - remove the merge marker
  - only render a critique if its card is still selected, and skip cards that are still generating or failed
  - make the source card the single source of truth for rewrites
  - treat stream errors as failures
  - show a warning when saving fails
- **P1 (statistics and trust):**
  - an exact sign test for the Ablation verdict
  - a like-for-like comparison or permutation test for the Experiment, ideally with 3 or more candidate rewrites
  - hedge the Sensitivity Map below 3 noise pairs
  - stop the Ablation run when research fails
  - cancel parallel calls on the first error and on Clear
  - a "Forget key" button
  - one shared pricing table
- **P2 (safety net):**
  - GitHub Actions running the unit tests, the browser suite and lint on every PR
  - the accessibility fixes
  - moving the diff off the main thread

I haven't changed any code. The harness, test results and screenshots are in `/tmp/claude-0/-home-user-wordcraft/49f75b72-888d-5c67-84d5-7cdabc6c99a4/scratchpad/` (`smoke.js`, `results.json`, `axe.json`). That folder is temporary; I can commit the harness as `tests/e2e/` so it becomes your missing browser test suite. My recommendation is that I do P0 plus that commit on `claude/hopeful-rubin-844cwo`. P1 changes verdict copy and tests, so it's worth a quick conversation first. I can also publish this review as a shareable page if that's useful.

---

## 2. User

> Save the harness test results and screesnhots to the repo, and commit the harness so that it's my test suite. Save the verbatim session transcript, and audit findings as md, and recommended order of items as md. So future agents know what to do in the repo. Then start making the fixes.

## Assistant

Committed the harness as `tests/e2e/` (portable paths, configurable output dir, an X18 layout probe, exit 1 on core-flow failure), the baseline results and screenshots under `tests/e2e/results/baseline-2026-09-25/`, this transcript, `docs/audit-2026-09.md`, `docs/roadmap.md`, and a `CLAUDE.md` that points future agents at them — then started on the P0 fixes, one commit per verified batch (see `git log` and the ticked items in `docs/roadmap.md`).
