# Wordcraft — Session Transcript

*A reconstructed transcript of the working session that produced the agent swarm,
the Agent Lab design docs, and the Controlled Experiment prototype. User messages are
quoted; assistant responses are summarized for length. Reconstructed 2026-06-14.*

---

### 1. User
> Review the repo, and give suggestions for fixes, improvements, or feature enhancements.

**Assistant.** Reviewed Wordcraft (a single ~3,300-line `index.html`, vanilla JS, BYOK
calling the Anthropic API directly from the browser). Findings:
- **Bugs:** source content injected via `innerHTML` (XSS / breaks on `<`,`>`); tags
  injected unescaped; unguarded `data.content[0].text`; fragile regex+`JSON.parse` for
  analysis/critique.
- **High-impact:** no canvas persistence (everything lost on refresh); API key in
  plaintext localStorage; hardcoded model + no streaming; no rate-limit/retry handling.
- **UX:** no delete/undo; no mobile/touch; no batch/parametric sweep; `alert()` for
  validation.
- **Code health:** one giant file; no tests/lint/.gitignore; `CHAT_LOG.md` and a large
  unused `logo.png` shipped.

Offered to implement, recommending escaping + persistence + streaming first.

---

### 2. User
> How do I make this workflow more agentic.. like swarm of agents press and probe, write, do research..

**Assistant.** Explained the shift from single-shot to a control loop; defined swarm
roles (Planner, Researcher, Writer×N, Critic, Editor, Judge); orchestration patterns
(generate→critique→revise, parallel fan-out + judge, debate); the mechanics that work
in a browser-only app (tool use, the `web_search` server tool, canvas-as-blackboard,
streaming); and guardrails (step caps, budget, cancel, cheaper models for sub-roles).
Asked which capability to build first.

*User selected:* **Full orchestrator.**

**Assistant.** Built the **Agent Swarm orchestrator** in `index.html` and committed it.

---

### 3. User
> I want you to think about

**Assistant.** Flagged the message looked cut off and asked what to think about.

---

### 4. User
> how the agent's swarm is configured … I want to see what the agent does … model tool use … generative UI … cost-quality trade-offs. What are all the agentic patterns? What is debate, tree of thought? Create first-principles explainers for each.

**Assistant.** Wrote first-principles explainers for: (1) configuring & observing the
swarm (the tunable knobs; trace levels L0–L3); (2) model tool use (model as pure
text→text function; the tool loop; server vs. local tools); (3) generative UI (the
text→fixed-components→DSL→code spectrum; flexibility vs. safety); (4) cost–quality
trade-offs (model size, call count, context, iteration depth, parallel vs. sequential);
(5) the full catalog of agentic patterns, including **debate** and **tree-of-thought**.
Closed with a 3-question lens for choosing among them.

---

### 5. User
> Where can I read more about all these agentic frameworks and build a good intuition about this as a designer

**Assistant.** Curated, designer-weighted reading list: mental-model reads (Anthropic's
"Building Effective Agents," Ng's four patterns, Lilian Weng's survey); foundational
papers (ReAct, ToT, Reflexion, Self-Refine, Debate, Generative Agents); AI-UX resources
(Shape of AI, Google PAIR, Microsoft HAX, Bret Victor, Ink & Switch); learn-by-building
frameworks (LangGraph, CrewAI, AutoGen, OpenAI Agents SDK); observability/eval tools; and
a four-week learning path.

---

### 6. User
> Analyse how 3-4 shipping agent products do it. Where's the design frontier? What questions aren't people asking? … I'm guessing it's cause and effect — agent is a black box and I can't build a mental model of how something changes if I change the workflow.

**Assistant.** Analyzed Cursor, Devin, Deep Research tools, and node-graph builders.
Named the two dominant archetypes (**process theater** + **control panel**), both
descriptive not causal, both lacking a control group. Listed the unasked questions
(signal-vs-noise, counterfactual diffing, sensitivity, attribution, latency-of-learning).
Sharpened the user's hypothesis into **"counterfactual legibility"** and the claim that
users are *doing science without a control group*. Gave intellectual lineage (Victor,
Norman, XAI counterfactuals, the spreadsheet). Offered (a) prototype or (b) thesis.

---

### 7. User
> Write it up as a design thesis / problem statement. But why do you need counterfactual legibility? … to understand what the system actually does. Way to test on sample data or testing environments as opposed to letting it yolo in production.

**Assistant.** Reframed the thesis around the user's chain — *deploy → trust →
understand → experiment → a venue that isn't production* — making the **lab/testbed**
and **calibrated trust** the spine, with counterfactual legibility as the instrument.
Wrote `docs/agent-lab-thesis.md` and committed it.

---

### 8. User
> Do all 3

(Talk version, related-work table, and build the prototype.)

**Assistant.** Wrote `docs/agent-lab-talk.md` (6 slides + speaker notes) and
`docs/agent-lab-related-work.md` (product comparison matrix); built the **Controlled
Experiment** prototype in `index.html` (runs current settings once + neutral baseline
twice, shows side-by-side Noise vs. Signal diffs with a verdict); updated the README;
committed.

---

### 9. User
> you've merged all the PRs?

**Assistant.** Clarified that **nothing was merged** — all work was on the feature
branch `claude/peaceful-bardeen-HASuP` as three commits ahead of `main`, with zero PRs.
Offered to open one.

---

### 10. User
> Open single PR and merge all

**Assistant.** Created **PR #2** and merged it into `main`.

---

### 11. User
> *(screenshot of the Controlled Experiment loading modal)* This UX needs improvement.

**Assistant.** Replaced the empty modal + vague "Running 3 generations…" with a progress
view: titled spinner, explanatory subtitle, and a per-step checklist (Baseline sample 1,
sample 2, Your settings) that ticks as each parallel generation returns; hid the disabled
Run button during the run and relabeled it "Run again." Shipped via **PR #3**, merged to
`main`.

---

### 12. User
> Save to local machine and add a markdown file to local machine containing chat transcript. Also add checklist of stuff built so far and what's left.

**Assistant.** Added this transcript (`docs/session-transcript.md`) and a status
checklist (`docs/project-checklist.md`); committed, pushed, and merged so they can be
pulled to the local machine.
