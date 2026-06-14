# The Agent Lab — Talk Version

*Approx. 12–15 min. Six slides. Speaker notes below each.*
*(Slides delimited by `---`. Notes are the prose under each slide's bullets.)*

---

## Slide 1 — Title

# What Is the Spreadsheet for Agents?

### Building tools that let you understand an agent before you trust it

*A control group for stochastic systems · the case against YOLO-in-production*

> **Speaker notes.** Open with the question, not the answer. "Raise your hand if
> you've changed a prompt or a setting in an AI workflow, re-run it, seen a different
> result — and genuinely couldn't tell whether *your change* did that or whether the
> model just rolled different dice." Pause. That confusion is the entire talk. We
> shipped agents that act in the world before we built the instruments to understand
> what they do. I want to name that gap and show the smallest move that closes it.

---

## Slide 2 — The problem: the function is illegible

- An agent workflow is a function: **config → output**
- Your job is to shape that function. You can't, because:
  1. It's **stochastic** — same config, different output
  2. It's **high-dimensional & nonlinear** — small change, huge or zero effect
  3. The loop is **slow and expensive** — you can't tinker
  4. The reasoning is **hidden** — you see ends, not the middle
- Norman's two gulfs, both widened: *what do I change?* and *what did my change do?*

> **Speaker notes.** Be concrete about the function framing — prompts, model, tools,
> fan-out, refine rounds, context routing, all on the input side; the artifact on the
> output side. The four reasons compound: #1 is the quiet killer, because it
> contaminates your ability to learn from #2, #3, and #4. If you can't tell signal
> from noise, every other improvement to legibility is built on sand. End on Norman:
> we have decades of HCI vocabulary for exactly this failure, and we're not using it.

---

## Slide 3 — Why it matters: the trust chain

- **Deploy → requires Trust → requires Understanding → requires Experimentation → requires a venue that isn't production**
- Every arrow is load-bearing. The last one is the one we skip.
- Software learned this: dev/staging/prod, tests, CI. Aviation: simulators, wind tunnels.
- **You don't debug in production.** We forgot this the moment the program was made of language.
- Agents make the discipline *harder* (open-ended inputs, fuzzy success, randomness) — so it needs *design*, not just borrowed convention.

> **Speaker notes.** This is the spine — slow down here. Walk the chain left to right,
> then right to left. The punchline is that the industry's default is to let agents
> "YOLO in production" and call the resulting confusion "iteration." Name the three
> reasons the old discipline doesn't transfer cleanly — that's *why this is a design
> problem and not just an engineering one*. "What's a unit test for 'write me
> something good'? What's a fixture for an open-ended task?" Those aren't rhetorical;
> they're the open problems that make this worth working on.

---

## Slide 4 — Why today's agent UX fails

- Two archetypes have eaten the space:
  - **Process theater** — "watch it work" (transparent, but you learn by spectating)
  - **The control panel** — "here are the knobs" (you can change it, but you re-run *blind*)
- Both are **descriptive, not causal**: they show what happened, never what would happen *differently*
- Both have **no control group**: nothing separates *your change* from *the model's randomness*
- Even node-graph *builders* — made for editing workflows — make you mutate and run blind

> **Speaker notes.** Show one screenshot of each archetype if you have them (a coding
> agent's diff view; a node-graph builder). Credit them — they're good at what they do:
> observability of a *single run* is basically solved. The gap is the *comparability of
> alternatives*. The most damning example is the node-graph builders: the one category
> built explicitly so you can change the workflow still gives you zero help predicting
> or comparing the effect of a change. Structure is legible; consequence is not.

---

## Slide 5 — The idea: a lab, and a control group

- Stop building theaters and dashboards. Build a **lab.**
- The user's real activity is **science**: hypothesis → controlled experiment → observe delta → update model.
- A lab has two halves:
  - **Counterfactual legibility** (epistemics): change one thing, hold the rest fixed, show the *attributed delta*
  - **A testbed** (venue): representative fixtures, no real-world stakes, then *promote* to prod
- **The one move nobody ships:** on every change, run the **changed** config *and re-run the **unchanged** config* — show both deltas side by side.
  - One delta is **signal** (your edit). One is **noise** (randomness). Now you can calibrate.

> **Speaker notes.** This is the reveal. The reframe (theater/dashboard → lab) is the
> intellectual contribution; the side-by-side signal/noise diff is the *embarrassingly
> simple* concrete move that, as far as I can find, no product ships. It's a **control
> group for a creative stochastic system.** Make the analogy explicit: you'd never trust
> a drug trial without a placebo arm; we trust agent changes without a noise arm every
> day. The two halves are inseparable — legibility without a safe venue is just
> debugging in prod with better graphics; a venue without counterfactuals is a sandbox
> you still can't learn from.

---

## Slide 6 — Demo + call to action

- **Wordcraft** as testbed: the canvas becomes a *causal instrument*
  - Change a knob → a **paired** result + an **attributed diff**
  - Beside it, a **noise-baseline** re-run → signal vs. chance at a glance
  - A **sensitivity map** accrues: which knobs actually move *your* output
- The hard parts (the moat): approximate counterfactuals, attribution, what *is* a fixture, qualitative success, doubled cost
- **What is the spreadsheet for agents?** — change a cell, watch everything recompute, *understand the model.*

> **Speaker notes.** Run the live demo here if you have it: set a parameter, hit
> "Controlled Experiment," and let the audience *see* the noise column move on its own.
> The gasp moment is when the noise diff is almost as big as the signal diff — "your
> change barely did anything; you've been fooling yourself." Close by returning to the
> opening question and answering it: the spreadsheet for agents is the tool that makes
> the function legible enough to trust — built in a lab, not in production. End with the
> invitation: this is unclaimed ground; the simplest slice (the noise baseline) is
> shippable this week.
