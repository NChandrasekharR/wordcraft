# Related Work — How Shipping Agent Products Handle Legibility

*A one-page comparison of representative products against the capabilities a "lab"
for agent workflows would need. The point is not to rank products — each is good at
what it set out to do — but to show that the field has converged on **observability of a
single run** and left **comparability of alternatives** almost entirely unaddressed.*

## Legend

✓ = first-class · ◐ = partial / implicit · ✗ = absent

## The matrix

| Capability | Cursor (Agent) | Devin | Deep Research¹ | Node builders² | Eval/trace tools³ | **The Agent Lab (proposed)** |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| **Editable workflow** (change the agent, not just the prompt) | ◐ | ◐ | ✗ | ✓ | ◐ | ✓ |
| **Single-run observability** (trace / steps / actions) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Output legibility** (diffs / accept-reject / versions) | ✓ | ◐ | ✗ | ◐ | ◐ | ✓ |
| **Counterfactual comparison** (change → *attributed* delta) | ✗ | ✗ | ✗ | ✗ | ◐⁴ | ✓ |
| **Control group / noise baseline** (signal vs. randomness) | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **Safe testbed** (fixtures, non-prod, no real stakes) | ◐⁵ | ◐⁶ | ✗ | ◐ | ✓ | ✓ |
| **Sensitivity surfacing** (which knobs actually matter) | ✗ | ✗ | ✗ | ✗ | ◐ | ✓ |
| **Attribution / provenance** (which step caused this output?) | ◐ | ◐ | ◐ | ◐ | ◐ | ◐⁷ |
| **Progressive trust / promotion** (lab → production path) | ✗ | ✗ | ✗ | ✗ | ◐ | ✓ |
| **Dominant archetype** | control panel + diffs | process theater | process theater | control panel | instrument (dev-facing) | **lab** |

¹ Perplexity Deep Research / ChatGPT Deep Research & reasoning models.
² n8n, Langflow, Flowise, Gumloop, LangGraph Studio.
³ LangSmith, Langfuse, Braintrust.
⁴ These support A/B over *outputs* and dataset evals, but not live "change one knob, see the controlled delta" for an end user.
⁵ Checkpoints/branches let you revert, but experiments still run against your real working tree.
⁶ Sandboxed VM, but the task is the live task, not a representative fixture you understand.
⁷ Honest ◐ even for the proposal: single-step attribution is tractable; full multi-agent credit assignment is an open problem.

## What the matrix shows

1. **The solved column is observability.** Every serious product can show you *what
   happened in one run* — traces, steps, diffs, actions. This is no longer a
   differentiator.

2. **The empty row is the control group.** *No* user-facing product separates the effect
   of your change from the effect of the model's randomness. This is the single most
   ignored capability and the highest-leverage one: without it, every other form of
   legibility teaches users a *wrong* causal model with full confidence.

3. **Counterfactual comparison is essentially absent.** Products diff *versions of
   output*; almost none diff *config → output* as a controlled experiment. The closest
   are dev-facing eval tools, and even they frame it as offline A/B over datasets, not as
   an interactive "what changes if I change this?" loop.

4. **The testbed is conflated with production.** Even tools with sandboxes (Devin's VM,
   Cursor's checkpoints) run experiments against the *real* task, not against
   representative fixtures chosen so the user can read quality. The discipline of
   "test on sample data before you ship" has no first-class home in agent UX.

5. **Promotion is undesigned.** There is no standard path from "I understand this
   configuration in the lab" to "I've deployed it with calibrated confidence." Trust is
   assumed, not earned and recorded.

## The gap, stated plainly

The industry has built excellent rear-view mirrors — perfect records of where the agent
*has been*. It has not built the instrument a user actually needs: one that answers
*"what would happen differently if I changed this — and is that difference real or
just noise?"* That instrument is a **lab**, and its load-bearing, unshipped primitive is
a **control group**.
