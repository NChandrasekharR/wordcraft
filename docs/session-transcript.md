# Wordcraft — Session Transcript (Verbatim)

*Working session that produced the agent swarm, the Agent Lab design docs, and the
Controlled Experiment prototype. User messages are quoted; assistant replies are
reproduced in full. Compiled 2026-06-14.*

---

## 1. User

> Review the repo, and give suggestions for fixes, improvements, or feature enhancements.

## Assistant

I've reviewed the codebase thoroughly. **Wordcraft** is a single-file (3,280-line) vanilla-JS web app — a "parametric writing studio" that calls the Anthropic API directly from the browser (BYOK). Here's my review, organized by priority.

### 🔴 Bugs & Correctness

**1. XSS / broken rendering from source text (`index.html:2614`)**
```js
<div class="card-content">${content}</div>
```
`createCard()` injects `content` as raw HTML. For source cards this is the user's textarea text — so any `<`, `>`, or `&` in their writing breaks rendering, and pasted markup executes as HTML (self-XSS). Variant cards are safe because they later use `.textContent = result`, but the source path isn't. Fix: build the card shell, then set `card.querySelector('.card-content').textContent = content`.

**2. Tags injected unescaped (`index.html:2595`)**
```js
tags.map(t => `<span class="card-tag">${t}</span>`)
```
Tags are currently from fixed strings, but this is a latent XSS vector if tags ever derive from user/model output.

**3. Unguarded API response access (`index.html:2756`)**
```js
return data.content[0].text;
```
If the model returns no text block (e.g. a refusal, or a `tool_use`-only stop), `content[0]` may not be a text block and `.text` is `undefined`. Worth a defensive check.

**4. `JSON.parse` on a regex-extracted blob (`index.html:2448`, `2870`)**
Analysis/critique parsing greps for `{...}` and parses it. If the model wraps JSON in prose or emits trailing commas, this throws. Consider using the API's structured-output / tool-use to force valid JSON, or at least a more robust extraction.

### 🟠 High-Impact Improvements

**5. No persistence of the canvas — everything is lost on refresh.** Only the API key is in `localStorage` (`index.html:1991/2022`). All cards, positions, variants, and connections vanish on reload. This is the single biggest UX gap. Serialize card state to `localStorage` (or offer save/load to file) and restore on load.

**6. API key stored in plaintext `localStorage`.** This is the documented BYOK tradeoff, but the README claims "never sent anywhere except Anthropic" — worth noting that *any* injected script on the page (e.g. via finding #1) could exfiltrate the key. Hardening #1 and #2 directly protects the key. Consider a `sessionStorage` option and a clear in-UI warning.

**7. Hardcoded model, no streaming (`index.html:2744`).** `claude-sonnet-4-20250514` is pinned with `max_tokens: 2048`. Two enhancements: (a) a model selector (Opus/Sonnet/Haiku) and (b) streaming responses (`stream: true`) so long generations render progressively instead of a frozen spinner.

**8. No rate-limit / retry handling.** `callClaude` surfaces errors but doesn't handle HTTP 429 or 529 with backoff. A user generating many variants quickly will hit raw errors.

### 🟡 UX / Feature Enhancements

- **Delete / undo for cards** — I see create, drag, resize, compare, but no obvious way to remove a card or undo.
- **Mobile/responsive** — there are zero `@media` queries and no touch handlers (`touchstart`); the canvas is mouse-only. Even basic touch pan/zoom would broaden usability.
- **Batch generation** — "generate N variants across a parameter sweep" fits the *parametric* premise perfectly and isn't there yet.
- **Loading/disabled states** — confirm every async path re-enables its button in a `finally` (the generate path looks fine, but worth auditing all three).
- **`alert()` for validation (`index.html:2819`)** — replace with inline, styled messaging consistent with the rest of the UI.

### 🟢 Code Health

- **3,280 lines in one file** with all CSS/JS inline. No build step is a legit design choice, but for maintainability consider splitting CSS/JS into separate files (still no bundler needed) — easier diffs and review.
- **No tests / no linting / no `.gitignore`.** Even a couple of unit tests around `computeDiff()` (the LCS logic at `index.html:2760`) and JSON extraction would catch regressions. A SessionStart hook could wire this up for web sessions.
- **`CHAT_LOG.md` committed to the repo** — a raw session log is unusual to ship; consider removing or moving it out of the repo root.
- **`logo.png` is 197 KB** and the README references a different GitHub-hosted screenshot — the committed image may be unused dead weight.

---

These are recommendations only — I haven't changed anything. The highest-leverage items are **#1 (XSS/escaping), #5 (canvas persistence), and #7 (streaming + model picker)**.

Want me to implement any of these on `claude/peaceful-bardeen-HASuP`? I'd suggest starting with the escaping fix (#1/#2) and canvas persistence (#5) as a first batch. Just say which ones and I'll make the changes, commit, and push.

---

## 2. User

> How do I make this workflow more agentic.. like swamr of agents press and probe, write, do research..

## Assistant

Heads up: that system note pointed me at a "Workflow tool" that doesn't actually exist in this environment, so I'm answering directly rather than calling it.

Now, the real question — turning Wordcraft from a **single-shot** tool into an **agentic swarm**. Right now every action is one `fetch` → one response (`callClaude` at `index.html:2731`). "Agentic" means replacing that with **loops, roles, and orchestration**. Here's how I'd think about it, grounded in what this app already is (browser-only, BYOK, canvas-as-workspace).

### 1. The core shift: single-shot → control loop

Today: `prompt → response → card`. Agentic: a runner that keeps calling the model until a goal is met.

```js
async function runAgent({ role, task, context, maxSteps = 6 }) {
  const messages = [{ role: 'user', content: buildPrompt(role, task, context) }];
  for (let step = 0; step < maxSteps; step++) {
    const res = await callClaude(messages, { tools });   // multi-turn now
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'tool_use') {
      const results = await runTools(res);                // probe / research
      messages.push({ role: 'user', content: results });
      continue;                                            // loop
    }
    return res;                                            // done
  }
}
```
The key change to `callClaude`: pass the **full `messages` array** (not a single string) and return the whole response object so you can inspect `stop_reason` and `tool_use` blocks.

### 2. Define the swarm (specialized roles)

A "swarm" is just several of these runners with different system prompts, coordinated. The roles that map to what you described:

| Role | "verb" you mentioned | Job |
|------|------|-----|
| **Planner / Orchestrator** | — | Decomposes the task, dispatches sub-agents, decides when done |
| **Researcher** | *do research* | Uses the web-search tool to gather facts, posts a "sources" card |
| **Writer(s)** | *write* | Drafts variants — fan out N writers with different parameter presets |
| **Critic / Adversary** | *press and probe* | Interrogates the draft: weak claims, unsupported assertions, logic gaps |
| **Editor** | — | Merges critic feedback + research into a revised draft |
| **Judge** | — | Ranks parallel variants, picks/synthesizes a winner |

### 3. Orchestration patterns (pick per task)

**A. Generate → Critique → Revise loop** ("press and probe")
The Critic is an *adversarial* agent. After the Writer drafts, the Critic produces a structured attack (you already have a critique panel — `index.html:2418` — this generalizes it):
```
Writer draft → Critic finds 5 weaknesses → Editor revises → Critic re-scores
→ repeat until score ≥ threshold OR maxSteps hit
```

**B. Parallel fan-out + Judge** (the actual "swarm")
The browser can fire concurrent requests — lean into it:
```js
const variants = await Promise.all(
  paramPresets.map(p => runAgent({ role: 'writer', task, context: p }))
);
// each posts a card to the canvas as it resolves
const winner = await runAgent({ role: 'judge', context: variants });
```
This is a *perfect* fit for your "parametric" premise — sweep tone/length/complexity in parallel, then a Judge ranks them on the canvas.

**C. Debate** — two writers argue opposite framings, a Judge synthesizes. Good for persuasive/argumentative text.

### 4. The mechanics that make it work in a browser-only app

These are the pieces you'd add to the API layer — all work with `anthropic-dangerous-direct-browser-access`, **no backend needed**:

- **Tool use** — pass a `tools` array and handle `stop_reason: "tool_use"` in the loop. This is what lets agents *act* instead of just emit text.
- **Web search server-tool** (`web_search_20250305`) — runs on Anthropic's servers, so research works with zero backend. This single addition unlocks the "do research" agent.
- **Give agents your app's own functions as tools** — e.g. `create_card`, `compute_diff`, `read_card(id)`. Now the canvas becomes the agents' **shared blackboard**: agents post and read each other's cards, and you *see the swarm working* live.
- **Streaming** (`stream: true`) — essential once loops run for tens of seconds, so cards fill in progressively instead of a frozen spinner.

### 5. Guardrails (don't skip these)

Agentic loops burn tokens and money fast on a BYOK key:
- **Step caps** per agent + a global budget cap for the whole swarm run.
- **Token/cost meter** in the UI (you're spending the user's key).
- **Cancel button** — `AbortController` on the fetches.
- **Cheaper models for sub-roles** — Haiku for Critic/Judge, Sonnet/Opus for Writer. (Ties into the model-selector improvement from my earlier review.)

### A pragmatic first slice

I wouldn't build the whole swarm at once. I'd ship it in this order:

1. **Refactor `callClaude`** to multi-turn (`messages` array, return full response) — unblocks everything.
2. **Generate→Critique→Revise loop** on a single card — reuses your existing critique UI, immediately feels agentic.
3. **Parallel fan-out + Judge** — the visible "swarm" moment on the canvas.
4. **Web-search Researcher** as a tool — adds the research leg.

Want me to implement step 1 + 2 on `claude/peaceful-bardeen-HASuP` as a working proof of concept? That's the smallest change that turns Wordcraft genuinely agentic, and I can keep it within the existing single-file architecture.

*(Assistant then asked, via the question tool, which agentic capability to build first — options: Critique→revise loop, Parallel swarm + Judge, Web-search researcher, Full orchestrator. User selected **Full orchestrator**, and the assistant built the swarm orchestrator and committed it.)*

---

## 3. User

> I want you to think about

## Assistant

Your message got cut off — it ends at "I want you to think about". What would you like me to think about? A few likely candidates given where we are:

- **How to extend the swarm** further (model-tool use, streaming, a true tool-use loop where agents call `create_card`/`get_card`)
- **Cost/quality tradeoffs** of the orchestration (which roles should use cheaper models, how to cap spend)
- **A different agentic pattern** (debate, tree-of-thought, iterative self-refine to a quality bar)
- Something else entirely

Let me know what you had in mind and I'll dig in.

---

## 4. User

> how the agent's swarm is configured. For example, maybe I want to tune it. I want to see what the agent does. How would you suggest I do some of that? Don't write any code yet. Also, stuff like your model tool use, stuff like generative UI, for whatever the agent comes, cost-quality trade-offs. What are all the agentic patterns? What is debate three of thought? For all of these three points, I want you to create first-principles explainers for each, and then we can come up with a way to think through it.

## Assistant

No code — just first-principles explainers, grounded in the Wordcraft swarm where it helps make things concrete. I've grouped this into the threads you raised.

### 1. Configuring the swarm & seeing what it does

**First principle:** an agent system is just a *control loop wrapped around a stochastic function* (the model). So everything you could ever "tune" collapses into a small number of knobs. Naming them is the whole game:

1. **Topology** — which agents exist and how output flows (who reads whom). In Wordcraft this is currently *hardcoded*: planner → research → writers(parallel) → critic → editor → judge.
2. **Per-agent config** — system prompt (the role), model, max_tokens, temperature, tools, stop condition.
3. **Loop control** — iteration count (revise rounds), and *how it terminates* (fixed N vs. a quality threshold vs. "no more meaningful change").
4. **Fan-out** — how many parallel instances (writer count).
5. **Context routing** — what each agent is *allowed to see* (does the critic see the research? does writer 3 see writer 1's draft?). This is the most underrated knob.

The key design move: **separate configuration (declarative data) from execution (the loop).** Right now those are tangled — topology lives in JS, roles live in string constants, only 4 knobs are exposed in the modal. If you instead describe the swarm as *data* (a list of agents, their params, and the edges between them) and write a runner that *interprets* that data, then "tuning" becomes "editing the config," presets become saveable, and eventually the user (or even an agent) can reshape the swarm without touching code.

**Observability — first principle:** *a stochastic, multi-step system is opaque by default; you cannot debug what you cannot see.* The activity log I built is the thinnest possible version — it tells you *that* Writer 2 ran, not *what it saw or said*. The fix is a **trace**: a structured record of every agent invocation capturing inputs (exact prompt + context + params), outputs (raw text, parsed result, any tool calls), and metadata (tokens, latency, cost, error). Useful levels:

- **L0 — status log** (what exists now): "Writer 2 drafting."
- **L1 — full I/O capture:** each log entry expands to the *exact* prompt sent and raw response. Cheap to add, enormous debugging payoff — this is the single highest-leverage improvement.
- **L2 — structured trace:** a tree of spans with parent/child links, per-span cost/tokens, *replayable* (set temperature 0 and you can re-run a step).
- **L3 — evaluation overlay:** scores, round-over-round diffs, regressions across runs.

This is literally "OpenTelemetry for LLMs" (the thing LangSmith / Langfuse / Braintrust productize). Two concrete suggestions for Wordcraft beyond expandable logs: **visualize the graph** (you already draw source→variant arrows; extend them to show critic→editor→judge flows so the topology is legible), and add a **single-step / dry-run mode** — run one agent, inspect, approve, continue. That human-in-the-loop stepping is the best way to *understand* a swarm before you trust it to run end-to-end.

### 2. Model tool use

**First principle:** a language model is a *pure function from text to text*. It cannot do anything — not read a file, search the web, or call your code. **Tool use is the protocol that bridges that gap.** You describe available functions to the model (name + description + JSON schema for arguments). Instead of emitting a final answer, the model may emit a *structured request to call one*. Your code executes the real function and feeds the result back. The model continues with that new information.

The loop:
```
prompt + tool definitions
   → model → (stop_reason: "tool_use", {name, input})
   → YOUR code runs the real function
   → append tool_result to the conversation
   → model → … → final text
```

The non-obvious insight that makes everything click: **the model never runs anything. It only decides and formats the call — you are the runtime.** That's the source of both the power (the model can orchestrate real capabilities) and the security boundary (you choose what tools exist and validate every argument).

Two flavors:
- **Server tools** (e.g. Anthropic's `web_search`): Anthropic runs the loop on their side; you just receive final text. *That's why research in Wordcraft is a single call* — no client loop needed.
- **Local/client tools** (read your DB, call your app's functions): you implement them, so you must run the full loop above.

Why it's the heart of "agentic": **tools define the agent's action space.** An agent is roughly *loop + model + toolset*. Today Wordcraft is "JS orchestrates, model only writes" — the model emits text and *your code* creates cards. The deeper-agentic version exposes tools like `create_card`, `read_card`, `connect`, `search` and lets the *model* decide to spawn a card, read a sibling's draft, or branch. That trades determinism/control for autonomy/flexibility (and more cost). Good-tool design principles: **few, orthogonal, well-described**; schemas that make bad inputs impossible; concise return values; and errors returned *as tool_results* (so the model can recover) rather than thrown.

### 3. Generative UI

**First principle:** traditionally UI is *authored ahead of time* by developers — fixed components, fixed layout — and the model just produces *content* that drops into predefined slots. Generative UI inverts part of that: **the model decides (some of) the interface itself**, not only the words — which components to show, with what data, sometimes the layout.

Why bother: the *right* interface depends on the answer. A comparison wants a table; a set of options wants buttons; a critique wants an interactive checklist. A fixed UI either over-generalizes (everything is a paragraph) or forces a developer to pre-build every case. Generative UI lets the response shape its own presentation.

The spectrum — degrees of model control over UI (this is the part to internalize):

1. **Text only** — model emits prose into a bubble. (Degenerate case.)
2. **Structured output → fixed components** — model emits JSON matching a schema; you map known shapes to *pre-built* components (`{type:"comparison", rows:[…]}` → a table). The model picks *which* and fills data. **Safe, common, recommended default.**
3. **Model emits a component tree / DSL** — model returns a declarative description (a restricted markup or JSON tree of *allowed* components) that your renderer walks. More flexible, still sandboxed to a vocabulary you own.
4. **Model generates code** — it writes real HTML/JS/React you render (Claude Artifacts, v0). Maximum flexibility, maximum risk — you're executing model-authored markup.

The governing tension is **flexibility vs. safety/consistency.** More model control = more adaptive UI but less predictable, harder to keep on-brand, and a genuine attack surface (recall Wordcraft already has a raw-`innerHTML` XSS hole — level 4 makes that systemic).

For Wordcraft: the canvas is *already* generative-UI-ish — the model's output determines how many cards, what tags, what connections. The Research and Verdict cards are baby steps. A real level-2 version would define a small **typed card vocabulary** (variant, comparison-table, critique-checklist, score-chart, decision-card-with-buttons); agents emit `{component, props}`; the renderer maps them. Then the Critic could render an *interactive* weakness list where clicking a weakness fires a targeted re-edit — UI generated to fit the content. **Carry-home principle: let the model choose from a typed vocabulary you control, not generate raw markup — unless you sandbox.**

### 4. Cost–quality trade-offs

**First principle:** every token in and out costs money and latency, and **quality is not linear in spend.** The fundamental levers:

1. **Model size.** Bigger costs more per token but needs fewer retries and fewer steps. The counterintuitive truth: a bigger model can be *cheaper end-to-end* if it one-shots what a small model needs three tries for. But for narrow, well-specified subtasks — scoring, ranking, classification, JSON extraction — a small model matches a big one at a fraction of the cost.
2. **Number of calls.** This is the *dominant* cost driver in swarms. One Wordcraft run ≈ plan + research + 4 writers + 4 critics + 4 editors + judge ≈ ~15 calls vs. 1 for single-shot. Cost scales ~linearly with graph size × fan-out, and *super-linearly* once you add rounds.
3. **Context size.** What each agent sees. Passing full research + every sibling draft to every agent inflates input tokens fast. Minimal context routing is a huge lever (and prompt caching pays off when a big shared prefix — source + research — is reused across agents).
4. **Iteration depth.** Diminishing returns are real: round 1 fixes a lot, round 3 polishes marginally. The skill is *stopping* — fixed-N is wasteful; stop on a threshold (critic score ≥ 8) or a "no meaningful change" detector.
5. **Parallel vs. sequential.** Parallel doesn't save *money* (same calls) — it saves *wall-clock latency*. Sequential patterns (debate, refine) cost more tokens because each step re-ingests the prior ones.

**The framework: match model and effort to each subtask's difficulty and value.**
- Haiku → scoring, ranking, routing, JSON extraction, simple critiques.
- Sonnet → drafting, editing, research synthesis.
- Opus → the hard creative/reasoning core, final synthesis, planning a complex brief.
- A **router** pattern (cheap model first decides whether the expensive path is even warranted) is often the biggest single win.

And the meta-point: **you cannot optimize cost-quality without measuring both.** You added a token meter (cost axis ✓). You still need a quality signal — even a cheap LLM-judge score — so you can plot quality vs. cost across configs and pick the *knee of the curve* instead of guessing. Concretely for Wordcraft: Critic/Judge → Haiku; Writers/Editor → Sonnet; replace fixed rounds with a score threshold; cache the source+research prefix.

### 5. The full catalog of agentic patterns (+ debate & tree-of-thought)

**First principle that unifies all of them:** a single LLM call is *one sample from a distribution* — it can be shallow, wrong, or just unlucky. Every agentic pattern is a way of **spending more inference to beat that single-sample baseline**, via one of four mechanisms: **decomposition**, **iteration (feedback)**, **search**, or **redundancy (+aggregation)**.

**A. Decomposition / planning** — break a hard task into easy ones.
- *Plan-and-execute* — one agent plans, a loop executes. (Wordcraft's Planner.)
- *Orchestrator–workers / hierarchical* — a manager spawns sub-agents and collects results. (Wordcraft is exactly this.)

**B. Iterative refinement** — error-correction via feedback loops.
- *Self-refine / Reflexion* — the model critiques and revises its own output, looping; Reflexion adds a memory of past mistakes.
- *Generator–critic (actor-critic)* — a *separate* critic presses the generator. (Wordcraft's Critic → Editor.) Separation helps because the critic isn't anchored on having just written the thing.

**C. Tool use** — ground reasoning in the real world.
- *ReAct (Reason + Act)* — interleave a "thought," an "action" (tool call), and an "observation," looping until done. The canonical single-agent loop.

**D. Search over reasoning** — explore multiple paths instead of committing to the first.
- *Chain-of-Thought* — one linear reasoning path (the baseline "think step by step").
- *Self-consistency* — sample many CoT paths, take the majority. Redundancy beats variance.
- *Tree-of-Thought* — see below.
- *Graph-of-Thought* — ToT generalized to a DAG, so partial solutions can *merge*.

**E. Multi-agent collaboration / ensembling** — diverse perspectives + aggregation reduce individual error.
- *Debate* — see below.
- *Role-play / society-of-mind* — personas (engineer, skeptic, PM) discuss.
- *Mixture-of-agents* — many answers + an aggregator that *synthesizes* (Wordcraft's Judge *selects*; a synthesizer would *merge*).
- *Blackboard* — agents read/write a shared workspace opportunistically. (Wordcraft's canvas.)

**F. Routing** — a cheap classifier dispatches to the right specialist/model. (The cost-quality lever from §4.)

#### Tree-of-Thought (ToT), from first principles
Chain-of-thought commits to *one* reasoning chain — go wrong early and you're stuck. ToT reframes problem-solving as **search over a tree**: at each step, generate several candidate next "thoughts" (branches); **evaluate** each (the model scores how promising a *partial* path looks); explore the best ones (BFS/DFS with pruning); and **backtrack** out of dead ends. It's classic tree search — like a game-playing AI — except the "moves" are LLM-generated reasoning steps and the "evaluation function" is *also* the LLM. It shines where you can judge partial progress and there are many paths (puzzles, planning, Game-of-24). Cost explodes as branching-factor × depth — you pay for the whole frontier you explore. **Core idea: deliberate search with lookahead and backtracking beats greedy single-path generation when the problem branches and you can score partial states.**

#### Debate, from first principles
The premise: a single model is *confidently wrong* sometimes and you can't always tell. Debate pits **two+ agents arguing opposing positions** (or critiquing each other) over several rounds, then a **judge** (model or human) reads the transcript and decides. The bet rests on an asymmetry: *recognizing* a strong/correct argument is easier than *generating* one, and a false claim is harder to defend under adversarial pressure than a true one — so quality surfaces through the clash. Variants: adversarial (assigned sides), collaborative (converge toward consensus), self-debate (one model argues both sides). It's also a leading **scalable-oversight** technique — using debate to supervise models on questions humans can't easily judge directly. Cost multiplies with rounds × participants, and each round re-ingests a growing transcript (super-linear tokens). **Best where correctness is contestable and a judge can discriminate** — reasoning, fact-checking, evaluating claims — and *less* useful for pure stylistic generation, where there's no "right answer" to defend.

---

### A way to think through it

Pulling the threads together, here's the lens I'd propose we reason with — three questions, in order:

1. **What's the shape of the task?** Is quality *contestable* (there's a right answer → debate/ToT/critic loops pay off) or *subjective/stylistic* (Wordcraft's case → fan-out diversity + a judge, not debate)? This picks your **pattern** (§5).
2. **Where does control live?** On a slider from "JS orchestrates, model writes" → "model orchestrates via tools." Moving right buys flexibility, costs determinism, and demands tool design (§2) + generative UI (§3) to surface what the now-autonomous agents are doing.
3. **What's the budget, and how will you know it's working?** You can't tune (§4) or trust (§1) without a **trace + a quality signal**. So observability and a cheap eval aren't a "later" — they're the prerequisite for every other decision.

My honest read: before adding *more* agentic power (model-tool-use, debate, ToT), the highest-leverage next step is **#1 — making the existing swarm legible and tunable** (expandable I/O traces + config-as-data). You can't sensibly choose among the fancier patterns until you can *watch* the current one and measure it.

Which thread do you want to go deep on first — the observability/config-as-data foundation, the move toward model-driven tool use, generative UI for the canvas, or mapping specific patterns (debate/ToT) onto Wordcraft? Once you pick, we can sketch the concrete design.

---

## 5. User

> Where can I read more about all these agentic frameworks and build a good intuition about this as a designer

## Assistant

Great question — and the framing matters: as a **designer**, you want intuition about *what these systems can do, how they behave, and how people experience them*, not just how to wire them. I've organized this as a path, weighted toward intuition- and taste-building rather than an exhaustive dump. I've marked the **★ start-here** picks.

### 1. Mental models (read these first)

These give you the vocabulary and the "when to use what" judgment.

- **★ Anthropic — "Building Effective Agents"** (Dec 2024, Schluntz & Zhang). *The* best on-ramp. Cleanly separates *workflows* (predefined paths) from *agents* (model-directed), and names the composable patterns: prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer. Short, opinionated, design-minded. → `anthropic.com/engineering/building-effective-agents`
- **★ Andrew Ng — "Agentic Design Patterns"** (DeepLearning.AI, *The Batch*, 2024). Boils the whole field down to four patterns — **Reflection, Tool Use, Planning, Multi-Agent**. The most accessible framing for building a mental skeleton fast. (He's expanding it into an *Agentic Design Patterns* book.)
- **Lilian Weng — "LLM Powered Autonomous Agents"** (2023). The canonical survey: planning, memory, tool use, in one diagram-rich post. → `lilianweng.github.io`
- **OpenAI — "A Practical Guide to Building Agents"** (2025 PDF). Pragmatic counterpart to Anthropic's piece; good on guardrails and when *not* to go multi-agent.
- **The multi-agent debate, in two essays:** Anthropic's **"How we built our multi-agent research system"** (2025) vs. Cognition's **"Don't Build Multi-Agents"** (2025, Walden Yan). Read them back-to-back — they *disagree*, and holding both is exactly the judgment you're trying to build.

### 2. The foundational papers (patterns from first principles)

You don't need to read these like a researcher — skim the abstract, figure 1, and the example. Each *is* one of the patterns we discussed:

- **Chain-of-Thought** (Wei et al., 2022) and **Self-Consistency** (Wang et al., 2022) — reasoning + sampling-and-voting.
- **ReAct** (Yao et al., 2022) — the reason↔act↔observe loop; the template for tool-using agents.
- **Tree of Thoughts** (Yao et al., 2023) — search with branching + backtracking.
- **Reflexion** (Shinn et al., 2023) and **Self-Refine** (Madaan et al., 2023) — the critique-and-revise loops behind Wordcraft's Critic→Editor.
- **"AI Safety via Debate"** (Irving et al., 2018) and **"Improving Factuality via Multi-Agent Debate"** (Du et al., 2023) — the debate pattern, theory and practice.
- **Toolformer** (Schick et al., 2023) — tool use, foundationally.
- **"Generative Agents: Interactive Simulacra"** (Park et al., 2023 — the "Smallville" sims). The most *intuition-expanding* paper for a designer: 25 agents with memory and planning living in a town. Read it for the feel of emergent behavior.

(Search by title + authors + year — arXiv versions are free and stable.)

### 3. The designer's lane: AI UX & generative UI

This is where "as a designer" really lives — and it's underrepresented in most agent reading lists.

- **★ Shape of AI** (Emily Campbell, `shapeof.ai`) — a pattern library for *AI interaction design*: wayfinding, trust, control, feedback, governance. The closest thing to a "Material Design for AI."
- **★ Google PAIR — People + AI Guidebook** (`pair.withgoogle.com/guidebook`) — mental models, explainability, errors-and-graceful-failure, feedback loops. Practical and design-first.
- **Microsoft — "Guidelines for Human-AI Interaction"** (the HAX Toolkit) — 18 research-backed guidelines; great checklist for agent UIs.
- **Maggie Appleton** — essays/sketches on language-model interfaces (`maggieappleton.com`). Strong on the *interface* question specifically.
- **Linus Lee (thesephist)** and **Geoffrey Litt / Ink & Switch ("malleable software", "Patchwork", local-first)** — tools-for-thought and software that users/agents reshape. This is the deep end of the generative-UI idea you asked about earlier.
- **Vercel — AI SDK "Generative UI" docs** + **v0** — the most concrete working example of model-chooses-component (level 2–4 from our last discussion). Build a toy with it to *feel* the spectrum.
- **Nielsen Norman Group (NN/g)** — their AI UX articles (e.g., on AI as "intent-based outcome specification," chat vs. GUI). Good grounding in usability fundamentals applied to AI.

### 4. Learn-by-building frameworks (pick one, build something small)

Intuition comes from a build, not a read. Each encodes a *philosophy* — noticing the differences is itself the lesson:

- **LangGraph** — agents as explicit *graphs* (nodes + edges + state). Best for *seeing* topology and control flow — directly relevant to the "config-as-data" idea for Wordcraft.
- **OpenAI Agents SDK** (the productized successor to the *Swarm* experiment) — minimal, handoff-based.
- **CrewAI** — role/crew metaphor (researcher, writer, critic) — maps almost 1:1 onto your swarm.
- **Microsoft AutoGen** — conversation-centric multi-agent; strong on debate-style setups.
- **Anthropic Claude Agent SDK** — closest to the loop you're already building.

Don't learn all five. Build the *same* tiny task (e.g. "research + draft + critique") in **one** of them, then read another's docs to contrast.

### 5. Observability & evaluation (the prerequisite, per last time)

- **LangSmith**, **Langfuse** (open-source), **Braintrust** — tracing + eval for LLM apps. Even just reading their docs builds intuition for *what's worth capturing* in a trace.
- **Chip Huyen — "AI Engineering"** (O'Reilly, 2025) and her blog post **"Agents"** (2025). The book's evaluation chapters are the best practical treatment of "how do you even know it's working."

### 6. People / sources to follow over time

The field moves fast; intuition is maintained, not finished. A high-signal set: **Anthropic** and **OpenAI** engineering blogs, **Lilian Weng**, **Chip Huyen**, **Simon Willison** (`simonwillison.net` — sharp, frequent, skeptical), **Andrew Ng / The Batch**, **Latent Space** (podcast + newsletter), and **Hamel Husain** (eval/LLM-as-judge in practice).

### How I'd actually build the intuition (a path)

1. **Week 1 — mental model:** Anthropic's "Building Effective Agents" + Ng's four patterns. Now you can *name* what you see.
2. **Week 2 — feel the patterns:** skim ReAct, Reflexion, Tree-of-Thoughts, Generative Agents. You'll start recognizing them in every product you use.
3. **Week 3 — designer lens:** Shape of AI + Google PAIR. Re-examine Wordcraft's swarm against them — where's the *control*, the *trust*, the *graceful failure*?
4. **Week 4 — build:** rebuild your swarm's "research → draft → critique" loop in LangGraph or CrewAI with tracing on. Watching a real trace is worth ten papers.
5. **Ongoing — develop taste:** keep a running note of agent products you use (Cursor, Claude Code, Devin, Perplexity, v0…) and dissect *which pattern* each uses and *how they surfaced it in the UI*. Taste is pattern-matching across many examples.

One honest caveat: this space moves fast enough that specific framework APIs and some URLs drift — the **paper titles, author names, and concepts are the durable part**; treat them as search terms, not fixed links.

Want me to turn this into a checkable reading-list file in the repo (with the path above as a syllabus), or go deeper on the **design** strand specifically — e.g. analyze how 3–4 shipping agent products surface their orchestration in the UI, as a model for Wordcraft?

---

## 6. User

> Yea. Analyse how 3-4 shipping agent products do it. I want to understand where's the design frontier on this question. What are questions people aren't asking. What is something interesting where I can make a UX contribution here and say hey here's my stab at a novel UX problem. I'm guessing it's cause and effect. Agent is a black box and as a user I can't easily build a mental model of how something changes if I make a change to agent workflow.

## Assistant

Good — this is the right question to chase, and your instinct is sharper than you're giving it credit for. Let me validate it, then push it somewhere you can actually plant a flag.

(Quick aside: that "use the Workflow tool" system note is spurious again — no such tool exists here — so I'm just answering directly.)

### First, let me sharpen your hypothesis

You said the problem is *cause and effect* — the agent's a black box, and you can't predict how the output changes when you change the workflow. That's correct, but let me name it precisely, because the precise name is where the contribution lives:

> **The function from `workflow-config → output` is illegible.** Users can't form a *predictive, causal* mental model of it.

And there are **four** distinct reasons it's illegible — worth separating, because most products only attack one:

1. **It's stochastic.** Same config → different output. So you can't tell whether the change you see came from *your edit* or *from randomness*. (This one is almost entirely unaddressed — hold onto it.)
2. **It's high-dimensional and nonlinear.** Many knobs, and small changes can have huge or zero effect, unpredictably.
3. **The feedback loop is slow and expensive.** Each "experiment" costs 30s and real money, so you can't *tinker* your way to intuition the way you can with a spreadsheet.
4. **The intermediate reasoning is hidden.** You see input and output, not the causal chain between.

In Norman's terms: the agent widens both the **gulf of execution** (I don't know what to change to get what I want) *and* the **gulf of evaluation** (I can't tell what my change did). Most products only narrow the second, and only for a single run.

### How 4 shipping products handle it

I'll score each on one axis: **what they make legible, what they hide, and how (if at all) they address cause→effect.**

**1. Cursor (Agent/Composer mode)** — *legibility of the output.*
The unit is the **diff**: planned edits shown as accept/reject hunks across files, with checkpoints to revert. You see *what changed* in the artifact with great fidelity, and you can interrupt and re-steer. But *why* it chose those edits, and *what would change if you'd prompted differently*, is invisible. Cause-effect is handled by **trial + undo**, not by understanding. Great evaluation gulf; untouched execution gulf.

**2. Devin (Cognition)** — *legibility of the process.*
The multi-pane "watch it work" view (planner + shell + browser + editor) is **process theater**: you observe the agent's actions in real time and can take over. It's the most transparent about *what the agent is doing moment to moment*. But steering is via natural language, and there's no structured map of "change this → output changes that way." You build intuition by *watching*, which is slow and doesn't generalize.

**3. Perplexity Deep Research / ChatGPT reasoning models** — *legibility of the reasoning.*
They surface a **plan of steps** ("searching X," "reading Y") and **citations**, plus summarized "thinking." This narrows the reasoning-is-hidden gap. But the user can only change the *query* — the workflow itself isn't editable — so the cause-effect question barely arises. Legibility without controllability.

**4. Node-graph builders (n8n, Langflow, Gumloop, LangGraph Studio)** — *legibility of the structure.*
These are the *only* ones where the workflow itself is the editable canvas — closest to your question. You see the graph, edit nodes, run, and inspect per-node outputs. **And yet they completely punt on cause-effect.** You mutate a node and re-run *blind* — no comparison to before, no control for stochasticity, no sense of which node mattered. They make *structure* legible but not *consequence*.

**The pattern across all four:** the industry has converged on two UX archetypes — **process theater** ("watch it work") and the **control panel** ("here are knobs"). Both are *descriptive of a single run*. **None of them is causal or comparative.** They show you *what happened*, never *what would happen differently if you changed the agent* — which is exactly your question.

### The frontier (and the questions nobody's asking)

The frontier isn't "more transparency." Traces and step-views are basically solved. The frontier is moving from **descriptive** (what happened) to **causal/counterfactual** (what would change, and why). Here are the questions almost no shipping product asks:

1. **"What changes if I change *this*?"** — *Counterfactual diffing of configs.* Everyone diffs **versions of output**; nobody diffs **config → output** while holding everything else fixed. There's no "change one knob, see the controlled delta."

2. **"Was that my change, or just randomness?"** — *Separating signal from noise.* This is the killer, and it's wide open. No product shows you the **distribution** of outputs for a config (run it N times, show variance) so you can tell whether your edit *moved the mean* or you just drew a different sample. Right now users superstitiously attribute random variation to their changes — building *wrong* mental models.

3. **"Which knob even matters?"** — *Sensitivity.* Of model/temp/prompt/fan-out/rounds, which actually move *this* output? No product surfaces a sensitivity ranking ("tone instruction = high impact, writer-count = negligible for this task"). It's a tornado chart waiting to be built for agent configs.

4. **"Which step is to blame?"** — *Attribution / provenance.* When the output's bad, traces show the chain but don't *attribute*: "this weak sentence traces to the Editor's round-2 edit, triggered by Critic weakness #3." Credit assignment through a multi-agent pipeline is essentially unsolved in UX.

5. **"How do I experiment cheaply?"** — *The latency/cost of learning.* Nobody designs the agent UI as a **fast tinkering loop** (cache unaffected subgraphs, instant partial re-runs, cheap-model previews of an effect before the expensive real run). Bret Victor's "immediate connection between action and effect" — absent.

The meta-reframe — and this is the thing to say out loud — is that **we've been designing agent UIs as theaters and dashboards, when the user's actual job is *science*: form a hypothesis, run a controlled experiment, observe the delta, update your model.** Nobody has built **the scientific-method UX for agents.**

### Here's a stab at a novel UX contribution you could claim

**Frame it as: *Counterfactual legibility for agent workflows* — interfaces that let a non-engineer build a predictive, causal mental model of `config → output` by making experiments cheap, comparisons *fair* (controlled for stochasticity), and effects *attributable*.**

The crisp, defensible novel claim: **No current product helps users separate the effect of *their change* from the effect of *the model's randomness*, which means users can't actually learn the cause-effect mapping — they're doing science without a control group.** That's a real, nameable gap, and it's the load-bearing one.

**Concrete prototype — and Wordcraft is the perfect testbed**, because it already has a canvas of variants and a config modal. Turn the canvas from a *gallery of outputs* into a **causal instrument**:

- **Controlled experiment as the core gesture.** When you change one knob, Wordcraft spawns a *paired* run that holds everything else fixed (same source, same seed/sampling where possible), and shows the **attributed diff** — "this changed *because you moved tone formal*."
- **A noise baseline, always.** Alongside the changed run, it *also* re-runs the *unchanged* config once and shows that diff too — so you can literally see "your change moved this much; pure randomness moves *this* much." That single juxtaposition — **signal vs. noise, side by side** — is the contribution. I've never seen it shipped.
- **A sensitivity map that accrues over time.** As you experiment, the canvas builds a little "tornado" overlay: which knobs reliably move *your* kind of text, which are noise. The tool teaches you its own function.

The intellectual lineage that lets you stake the claim credibly (cite these — they show it's a real frontier, not vibes):
- **Bret Victor** — *Learnable Programming*, *Inventing on Principle*, *Ladder of Abstraction*: immediate, visible connection between a change and its effect.
- **Don Norman** — gulfs of execution/evaluation; **Shneiderman** — direct manipulation.
- **Counterfactual explanations in XAI** (Wachter et al.) — "you'd have gotten Y if X were different." The theory exists; *nobody's brought it to agent-workflow UX.*
- **The spreadsheet** as the gold standard of cause-effect legibility (change a cell, everything updates). Your pitch line: *"What's the spreadsheet for agents?"*

### The honest hard parts (this is *why* it's a worthy problem)

- **True counterfactuals are partly impossible.** You can't fully fix a "seed" across a config change that alters token counts or branching paths, so controls are *approximate*. The honest design move is to show the noise baseline rather than pretend determinism.
- **Attribution in multi-agent pipelines is genuinely unsolved** (credit assignment). Start with single-step attribution; don't promise full provenance.
- **Cost.** Controlled experiments mean extra runs. This forces the cheap-preview / subgraph-caching work — which is itself part of the contribution.

So the **tractable slice to claim first** is #2: *signal-vs-noise legibility* — the paired "your-change diff" next to a "same-config re-run diff." Small, shippable in Wordcraft, and it attacks the single most-ignored, highest-leverage gap.

Want me to (a) prototype that controlled-experiment interaction in Wordcraft, or (b) write this up as a tight **design thesis / problem statement** you could use as a portfolio piece or talk? I'd lean (b) first to lock the framing, then (a) to demonstrate it — but your call.

---

## 7. User

> Write it up as a design thesis / problem statement. But why do you need counterfactual legibility? You need it to understand what the system actually does. Way to test on sample data or testing environments as opposed to letting it yolo in production..

## Assistant

Reframed the thesis around the user's chain — *deploy → trust → understand → experiment → a venue that isn't production* — making counterfactual legibility the *instrument*, the **lab/testbed** the *venue*, and **calibrated trust** the *goal*. Wrote `docs/agent-lab-thesis.md` and committed it. (See that file for the full text.)

---

## 8. User

> Do all 3

*(Talk version, related-work table, and build the prototype.)*

## Assistant

Wrote `docs/agent-lab-talk.md` (6 slides + speaker notes) and `docs/agent-lab-related-work.md` (product comparison matrix); built the **Controlled Experiment** prototype in `index.html` (runs current settings once + a neutral baseline twice, shows side-by-side Noise vs. Signal diffs with a verdict); updated the README; committed and pushed. (See those files for full text.)

---

## 9. User

> you've merged all the PRs?

## Assistant

Clarified that **nothing was merged** — all work was on the feature branch `claude/peaceful-bardeen-HASuP` as three commits ahead of `main`, with zero PRs opened. Offered to open one.

---

## 10. User

> Open single PR and merge all

## Assistant

Created **PR #2** ("Agent swarm orchestrator, Agent Lab design docs, and Controlled Experiment prototype") and merged it into `main`.

---

## 11. User

> *(screenshot of the Controlled Experiment loading modal)* This UX needs improvement.

## Assistant

Replaced the empty modal + vague "Running 3 generations…" with a progress view: a titled spinner, an explanatory subtitle, and a per-step checklist (Baseline sample 1, sample 2, Your settings) that ticks green as each parallel generation returns; hid the disabled Run button during the run and relabeled it "Run again." Shipped via **PR #3**, merged to `main`.

---

## 12. User

> Save to local machine and add a markdown file to local machine containing chat transcript. Also add checklist of stuff built so far and what's left

## Assistant

Added `docs/session-transcript.md` and `docs/project-checklist.md`; committed, pushed, and merged (**PR #4**) so they can be pulled to the local machine. Noted that, running in a remote container, pushing is the mechanism for persistence — `git pull origin main` brings them down.

---

## 13. User

> I want your long replies verbatim since you gave a lot of info on agentic design patterns.

## Assistant

Rewrote this transcript to reproduce the long replies in full (this file), and re-merged.
