    /* =======================================================================
       Agent Swarm — an orchestrator that decomposes a goal and dispatches a
       swarm of role agents (planner, researcher, writers, critic, editor,
       judge) onto the canvas. The canvas itself is the shared blackboard:
       every agent posts its output as a card.
       ===================================================================== */

    const swarmModal = document.getElementById('swarmModal');
    const swarmBtn = document.getElementById('swarmBtn');
    const swarmGoal = document.getElementById('swarmGoal');
    const swarmWriters = document.getElementById('swarmWriters');
    const swarmRounds = document.getElementById('swarmRounds');
    const swarmResearch = document.getElementById('swarmResearch');
    const swarmStart = document.getElementById('swarmStart');
    const swarmCancel = document.getElementById('swarmCancel');
    const agentPanel = document.getElementById('agentPanel');
    const agentLog = document.getElementById('agentLog');
    const agentPhase = document.getElementById('agentPhase');
    const agentStats = document.getElementById('agentStats');
    const agentClose = document.getElementById('agentClose');
    const agentCancelBtn = document.getElementById('agentCancelBtn');

    const swarm = { running: false, controller: null, steps: 0, tokensIn: 0, tokensOut: 0 };

    // Multi-turn / tool-capable API call used by the swarm; goes through the
    // same retrying request core as callClaude() and tracks swarm usage.
    async function callClaudeRaw({ system, messages, tools, model, maxTokens, signal }) {
      const body = {
        model: model || getModel(),
        max_tokens: maxTokens || 2048,
        messages
      };
      if (system) body.system = system;
      if (tools) body.tools = tools;
      const data = await anthropicRequest(body, signal);
      if (data.usage) {
        swarm.tokensIn += data.usage.input_tokens || 0;
        swarm.tokensOut += data.usage.output_tokens || 0;
      }
      swarm.steps++;
      updateSwarmStats();
      return data;
    }

    function extractText(data) {
      return (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
    }

    // One agent turn that returns text.
    async function agentText({ system, prompt, tools, maxTokens }) {
      if (swarm.controller?.signal.aborted) throw new Error('Swarm stopped');
      const data = await callClaudeRaw({
        system,
        messages: [{ role: 'user', content: prompt }],
        tools,
        maxTokens,
        signal: swarm.controller?.signal
      });
      return extractText(data);
    }

    function updateSwarmStats() {
      agentStats.textContent = `${swarm.steps} steps · ${(swarm.tokensIn + swarm.tokensOut).toLocaleString()} tokens`;
    }

    // Append an entry to the live activity log; returns a handle to update it.
    function logAgent(role, msg, status = 'active') {
      const entry = document.createElement('div');
      entry.className = `agent-entry ${status}`;
      entry.innerHTML = `<span class="agent-dot"></span><div><div class="agent-role"></div><div class="agent-msg"></div></div>`;
      entry.querySelector('.agent-role').textContent = role;
      entry.querySelector('.agent-msg').textContent = msg;
      agentLog.appendChild(entry);
      agentLog.scrollTop = agentLog.scrollHeight;
      return {
        update(text, st) {
          entry.querySelector('.agent-msg').textContent = text;
          if (st) entry.className = `agent-entry ${st}`;
          agentLog.scrollTop = agentLog.scrollHeight;
        }
      };
    }

    const ROLES = {
      planner: `You are the Planner in a writing swarm. Given a creative brief and source text, produce a concise JSON plan. Choose DISTINCT angles for each writer so the variants meaningfully differ. Respond with JSON ONLY:
{
  "summary": "one sentence describing the strategy",
  "research_query": "a web search query if external facts would help, else empty string",
  "writers": [ { "angle": "short label", "instruction": "specific guidance for this writer" } ]
}
Produce exactly N writer entries where N is given.`,
      researcher: `You are the Researcher. Use web search to gather current, relevant facts for the brief. Return a tight bulleted brief of findings, each with its source. Be factual and concise.`,
      writer: `You are a Writer in a swarm. Write the BEST version of the text for the given brief and angle. Output ONLY the finished prose — no preamble, no explanation, no surrounding quotes.`,
      critic: `You are the Critic — adversarial and rigorous. Press and probe the draft against the brief: find the weakest claim, the vaguest sentence, unsupported assertions, tonal mismatches, and structural gaps. Respond with JSON ONLY:
{ "score": <1-10>, "weaknesses": ["..."], "fix_instructions": ["concrete, actionable edits"] }`,
      editor: `You are the Editor. Revise the draft so it resolves every fix instruction while honoring the brief and any research provided. Output ONLY the revised prose — no preamble.`,
      judge: `You are the Judge. Compare the candidate variants against the brief and pick the strongest. Respond with JSON ONLY:
{ "winner": <1-based index>, "rationale": "2-3 sentences", "ranking": [indices best-to-worst] }`
    };

    async function runSwarm({ goal, writerCount, rounds, useResearch }) {
      const source = (currentSourceCard ? getCardText(currentSourceCard) : sourceText.value).trim();
      if (!source) { alert('Add some source text first.'); return; }

      swarm.running = true;
      swarm.controller = new AbortController();
      swarm.steps = 0; swarm.tokensIn = 0; swarm.tokensOut = 0;
      agentLog.innerHTML = '';
      agentPanel.classList.add('visible');
      agentCancelBtn.style.display = '';
      updateSwarmStats();
      swarmBtn.disabled = true;

      const sourceCard = currentSourceCard || getOrCreateSourceCard(source);
      currentSourceCard = sourceCard;
      const aborted = () => swarm.controller.signal.aborted;

      try {
        // 1. PLAN
        agentPhase.textContent = 'Planning';
        const planLog = logAgent('Planner', 'Decomposing the brief…');
        let plan;
        try {
          const raw = await agentText({
            system: ROLES.planner,
            prompt: `Brief/goal:\n${goal || '(none given — produce strong, distinct general variations)'}\n\nSource text:\n${source}\n\nProduce exactly ${writerCount} writer entries.`,
            maxTokens: 1024
          });
          plan = parseJsonLoose(raw);
        } catch (e) {
          plan = { summary: 'Using default plan', research_query: '', writers: [] };
        }
        if (!Array.isArray(plan.writers) || plan.writers.length === 0) {
          plan.writers = Array.from({ length: writerCount }, (_, i) => ({ angle: `Variant ${i + 1}`, instruction: 'Produce a strong, distinct rewrite.' }));
        }
        plan.writers = plan.writers.slice(0, writerCount);
        planLog.update(plan.summary || `${plan.writers.length} writers planned`, 'done');

        // 2. RESEARCH (optional, server-side web search tool)
        let research = '';
        const query = useResearch ? (plan.research_query || goal || '') : '';
        if (useResearch && query && !aborted()) {
          agentPhase.textContent = 'Researching';
          const rLog = logAgent('Researcher', `Searching: ${query}`);
          try {
            research = await agentText({
              system: ROLES.researcher,
              prompt: `Brief: ${goal}\nSearch focus: ${query}\nGather and summarize the most useful findings.`,
              // Haiku only supports the basic web-search variant; newer models
              // get the version with dynamic filtering.
              tools: [{
                type: getModel() === 'claude-haiku-4-5' ? 'web_search_20250305' : 'web_search_20260209',
                name: 'web_search',
                max_uses: 4
              }],
              maxTokens: 1500
            });
            const rCard = createCard(['Research'], 'Generating', 'generating');
            rCard.classList.remove('generating'); rCard.classList.add('research');
            rCard.querySelector('.card-content').textContent = research;
            connections.push({ from: sourceCard.id, to: rCard.id });
            requestAnimationFrame(updateConnections);
            rLog.update('Posted research brief to canvas', 'done');
          } catch (e) {
            rLog.update(`Research skipped: ${e.message}`, 'fail');
          }
        }

        // 3. WRITERS (parallel fan-out — the swarm)
        agentPhase.textContent = 'Writing';
        const ctx = research ? `\n\nResearch brief to draw on:\n${research}` : '';
        const writerJobs = plan.writers.map((w, i) => (async () => {
          const wLog = logAgent(`Writer ${i + 1}`, `Drafting: ${w.angle}`);
          const card = createCard([w.angle || `Variant ${i + 1}`], 'Generating', 'generating');
          connections.push({ from: sourceCard.id, to: card.id });
          requestAnimationFrame(updateConnections);
          try {
            const draft = await agentText({
              system: ROLES.writer,
              prompt: `Brief/goal:\n${goal}\n\nYour angle: ${w.angle}\nGuidance: ${w.instruction}${ctx}\n\nSource text:\n${source}`,
              maxTokens: 1500
            });
            card.classList.remove('generating'); card.classList.add('variant');
            card.dataset.rawText = draft;
            card.querySelector('.card-content').textContent = draft;
            wLog.update(`Draft ready (${draft.split(/\s+/).filter(Boolean).length} words)`, 'done');
            return { card, angle: w.angle, text: draft };
          } catch (e) {
            card.classList.remove('generating'); card.classList.add('error');
            card.querySelector('.card-content').textContent = `Error: ${e.message}`;
            wLog.update(`Failed: ${e.message}`, 'fail');
            return null;
          }
        })());
        let variants = (await Promise.all(writerJobs)).filter(Boolean);
        requestAnimationFrame(() => { updateConnections(); zoomToFit(); });
        if (variants.length === 0) throw new Error('All writers failed');

        // 4. CRITIQUE → EDIT loop (press and probe, then revise)
        for (let round = 1; round <= rounds && !aborted(); round++) {
          agentPhase.textContent = `Refining (round ${round})`;
          await Promise.all(variants.map(async (v) => {
            const cLog = logAgent('Critic', `Pressing "${v.angle}"…`);
            let critique;
            try {
              const raw = await agentText({
                system: ROLES.critic,
                prompt: `Brief:\n${goal}\n\nDraft:\n${v.text}`,
                maxTokens: 800
              });
              critique = parseJsonLoose(raw);
            } catch (e) { cLog.update(`Critic error: ${e.message}`, 'fail'); return; }
            cLog.update(`Score ${critique.score}/10 · ${(critique.weaknesses || []).length} weaknesses`, 'done');

            const fixes = (critique.fix_instructions || []).join('\n- ');
            if (!fixes || aborted()) return;
            const eLog = logAgent('Editor', `Revising "${v.angle}"…`);
            try {
              const revised = await agentText({
                system: ROLES.editor,
                prompt: `Brief:\n${goal}\n\nFix instructions:\n- ${fixes}${ctx}\n\nCurrent draft:\n${v.text}`,
                maxTokens: 1500
              });
              const diffHtml = computeDiff(v.text, revised);
              v.card.dataset.rawText = revised;
              v.card.dataset.diffHtml = diffHtml;
              v.card.dataset.viewMode = 'text';
              v.text = revised;
              v.card.querySelector('.card-content').textContent = revised;
              addDiffToggle(v.card);
              eLog.update('Applied edits', 'done');
            } catch (e) { eLog.update(`Editor error: ${e.message}`, 'fail'); }
          }));
          requestAnimationFrame(() => { updateConnections(); zoomToFit(); });
        }

        // 5. JUDGE
        if (variants.length > 1 && !aborted()) {
          agentPhase.textContent = 'Judging';
          const jLog = logAgent('Judge', 'Ranking variants…');
          try {
            const list = variants.map((v, i) => `[${i + 1}] (${v.angle})\n${v.text}`).join('\n\n');
            const verdict = parseJsonLoose(await agentText({
              system: ROLES.judge,
              prompt: `Brief:\n${goal}\n\nCandidates:\n${list}`,
              maxTokens: 600
            }));
            const winner = variants[(verdict.winner || 1) - 1];
            if (winner) winner.card.classList.add('winner');
            const winnerLabel = winner ? winner.angle : `#${verdict.winner}`;
            const vCard = createCard(['Verdict'], 'Generating', 'generating');
            vCard.classList.remove('generating'); vCard.classList.add('verdict');
            vCard.querySelector('.card-content').textContent = `Winner: ${winnerLabel}\n\n${verdict.rationale || ''}`;
            if (winner) connections.push({ from: winner.card.id, to: vCard.id });
            requestAnimationFrame(() => { updateConnections(); zoomToFit(); });
            jLog.update(`Winner: ${winnerLabel}`, 'done');
          } catch (e) { jLog.update(`Judge error: ${e.message}`, 'fail'); }
        }

        agentPhase.textContent = aborted() ? 'Stopped' : 'Complete';
        logAgent('Swarm', aborted() ? 'Run stopped by user.' : 'Run complete.', aborted() ? 'fail' : 'done');
      } catch (e) {
        agentPhase.textContent = 'Error';
        logAgent('Swarm', e.message, 'fail');
      } finally {
        swarm.running = false;
        swarmBtn.disabled = false;
        agentCancelBtn.style.display = 'none';
      }
    }

    // Swarm UI wiring
    function openSwarmModal() {
      swarmModal.classList.add('visible');
      swarmGoal.focus();
    }
    swarmBtn.addEventListener('click', () => {
      if (swarm.running) { agentPanel.classList.add('visible'); return; }
      requireApiKey(openSwarmModal);
    });
    swarmCancel.addEventListener('click', () => swarmModal.classList.remove('visible'));
    swarmModal.addEventListener('click', (e) => { if (e.target === swarmModal) swarmModal.classList.remove('visible'); });
    swarmStart.addEventListener('click', () => {
      swarmModal.classList.remove('visible');
      runSwarm({
        goal: swarmGoal.value.trim(),
        writerCount: parseInt(swarmWriters.value),
        rounds: parseInt(swarmRounds.value),
        useResearch: swarmResearch.checked
      });
    });
    agentCancelBtn.addEventListener('click', () => { if (swarm.controller) swarm.controller.abort(); });
    agentClose.addEventListener('click', () => agentPanel.classList.remove('visible'));
