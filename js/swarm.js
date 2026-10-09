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

    const swarm = { running: false, controller: null, steps: 0, tokensIn: 0, tokensOut: 0, tokensCached: 0, cost: 0 };

    function resetSwarmUsage() {
      swarm.steps = 0; swarm.tokensIn = 0; swarm.tokensOut = 0; swarm.tokensCached = 0; swarm.cost = 0;
    }

    // Per-role model selection. Critic and judge only score/rank, so a cheap
    // fast model is sufficient; the generative roles use the user's chosen
    // model. roleModel() is a function so it always reflects the current pick.
    function roleModel(role) {
      if (role === 'critic' || role === 'judge') return CHEAP_MODEL;
      return getModel();
    }

    // Pricing lives in api.js (MODEL_PRICING); alias kept for ablation.js.
    const SWARM_PRICING = MODEL_PRICING;

    // One swarm/ablation agent call through the shared request core, tracking
    // usage for the live cost readout. `cached` is the part of the prompt
    // sibling calls share (brief, source, research); it goes first and is
    // read from the prompt cache by every call after the first.
    async function callClaudeRaw({ system, prompt, cached, tools, model, maxTokens, signal, outputSchema, effort }) {
      const usedModel = model || getModel();
      const data = await requestMessage({ system, prompt, cached }, {
        model: usedModel,
        tools,
        schema: outputSchema,
        maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
        effort: effort || EFFORT.standard,
        signal
      });
      if (data.usage) {
        const u = data.usage;
        const cachedIn = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        swarm.tokensIn += (u.input_tokens || 0) + cachedIn;
        swarm.tokensCached += u.cache_read_input_tokens || 0;
        swarm.tokensOut += u.output_tokens || 0;
        swarm.cost += usageCost(u, data.model || usedModel);
      }
      swarm.steps++;
      updateSwarmStats();
      return data;
    }

    // One agent turn that returns text.
    async function agentText({ system, prompt, cached, tools, maxTokens, model }) {
      if (swarm.controller?.signal.aborted) throw new Error('Swarm stopped');
      const data = await callClaudeRaw({ system, prompt, cached, tools, maxTokens, model, signal: swarm.controller?.signal });
      return extractText(data);
    }

    // One agent turn that returns parsed JSON via structured outputs.
    async function agentJson({ system, prompt, cached, maxTokens, model, schema }) {
      if (swarm.controller?.signal.aborted) throw new Error('Swarm stopped');
      const data = await callClaudeRaw({ system, prompt, cached, maxTokens, model, signal: swarm.controller?.signal, outputSchema: schema });
      return parseJson(extractText(data));
    }

    function updateSwarmStats() {
      const total = swarm.tokensIn + swarm.tokensOut;
      const cached = swarm.tokensCached ? ` (${swarm.tokensCached.toLocaleString()} from cache)` : '';
      agentStats.textContent = `${swarm.steps} steps · ${total.toLocaleString()} tokens${cached} · ~$${swarm.cost.toFixed(2)}`;
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
      planner: `You are the Planner in a writing swarm. Given a creative brief and source text, produce a concise plan. Choose DISTINCT angles for each writer so the variants meaningfully differ. Provide: a one-sentence summary of the strategy, a research_query (a web search query if external facts would help, else an empty string), and a writers list with one entry per writer, each giving a short angle label and specific instruction. Produce exactly N writer entries where N is given.`,
      researcher: `You are the Researcher. Use web search to gather current, relevant facts for the brief. Return a tight bulleted brief of findings, each with its source. Be factual and concise.`,
      writer: `You are a Writer in a swarm. Write the BEST version of the text for the given brief and angle. Output ONLY the finished prose — no preamble, no explanation, no surrounding quotes.`,
      critic: `You are the Critic — adversarial and rigorous. Press and probe the draft against the brief: find the weakest claim, the vaguest sentence, unsupported assertions, tonal mismatches, and structural gaps. Provide a score from 1 to 10, a list of weaknesses, and a list of concrete, actionable fix_instructions.`,
      editor: `You are the Editor. Revise the draft so it resolves every fix instruction while honoring the brief and any research provided. Output ONLY the revised prose — no preamble.`,
      judge: `You are the Judge. Compare the candidate variants against the brief and pick the strongest. Provide the winner (1-based index), a 2-3 sentence rationale, and a ranking of all candidate indices from best to worst.`
    };

    // Research prompts carry today's date so the model searches for anything
    // that may have changed since its training data ends.
    function researchPrompt(task) {
      return `Today's date is ${new Date().toISOString().slice(0, 10)}.\n${task}`;
    }

    // Structured-output schemas for the swarm's JSON roles.
    const PLANNER_SCHEMA = {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'research_query', 'writers'],
      properties: {
        summary: { type: 'string' },
        research_query: { type: 'string' },
        writers: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['angle', 'instruction'],
            properties: {
              angle: { type: 'string' },
              instruction: { type: 'string' }
            }
          }
        }
      }
    };
    const CRITIC_SCHEMA = {
      type: 'object',
      additionalProperties: false,
      required: ['score', 'weaknesses', 'fix_instructions'],
      properties: {
        score: { type: 'integer' },
        weaknesses: { type: 'array', items: { type: 'string' } },
        fix_instructions: { type: 'array', items: { type: 'string' } }
      }
    };
    const JUDGE_SCHEMA = {
      type: 'object',
      additionalProperties: false,
      required: ['winner', 'rationale', 'ranking'],
      properties: {
        winner: { type: 'integer' },
        rationale: { type: 'string' },
        ranking: { type: 'array', items: { type: 'integer' } }
      }
    };

    async function runSwarm({ goal, writerCount, rounds, useResearch }) {
      const source = (currentSourceCard ? getCardText(currentSourceCard) : sourceText.value).trim();
      if (!source) { showToast('Add some source text first.', { tone: 'error' }); return; }

      swarm.running = true;
      swarm.controller = trackedController();
      resetSwarmUsage();
      agentLog.innerHTML = '';
      agentPanel.querySelector('.critique-header h2').textContent = 'Agent Swarm';
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
          plan = await agentJson({
            system: ROLES.planner,
            prompt: `Brief/goal:\n${goal || '(none given — produce strong, distinct general variations)'}\n\nSource text:\n${source}\n\nProduce exactly ${writerCount} writer entries.`,
            maxTokens: 4096,
            model: roleModel('planner'),
            schema: PLANNER_SCHEMA
          });
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
            const researcherModel = roleModel('researcher');
            research = await agentText({
              system: ROLES.researcher,
              // Cached so each server-side search iteration (and a resumed
              // pause_turn) reads the prompt from cache.
              cached: researchPrompt(`Brief: ${goal}\nSearch focus: ${query}\nGather and summarize the most useful findings.`),
              model: researcherModel,
              tools: [webSearchTool(researcherModel)],
              maxTokens: 8192
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

        // 3. WRITERS (parallel fan-out — the swarm). Every writer shares the
        //    brief, research and source (cached); only the angle differs.
        agentPhase.textContent = 'Writing';
        const ctx = research ? `\n\nResearch brief to draw on:\n${research}` : '';
        const writerContext = `Brief/goal:\n${goal}${ctx}\n\nSource text:\n${source}`;
        const writerJobs = plan.writers.map((w, i) => (async () => {
          const wLog = logAgent(`Writer ${i + 1}`, `Drafting: ${w.angle}`);
          const card = createCard([w.angle || `Variant ${i + 1}`], 'Generating', 'generating');
          connections.push({ from: sourceCard.id, to: card.id });
          requestAnimationFrame(updateConnections);
          try {
            const draft = await agentText({
              system: ROLES.writer,
              cached: writerContext,
              prompt: `Your angle: ${w.angle}\nGuidance: ${w.instruction}`,
              model: roleModel('writer'),
              maxTokens: 8192
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
              critique = await agentJson({
                system: ROLES.critic,
                cached: `Brief:\n${goal}`,
                prompt: `Draft:\n${v.text}`,
                maxTokens: 4096,
                model: roleModel('critic'),
                schema: CRITIC_SCHEMA
              });
            } catch (e) { cLog.update(`Critic error: ${e.message}`, 'fail'); return; }
            cLog.update(`Score ${critique.score}/10 · ${(critique.weaknesses || []).length} weaknesses`, 'done');

            const fixes = (critique.fix_instructions || []).join('\n- ');
            if (!fixes || aborted()) return;
            const eLog = logAgent('Editor', `Revising "${v.angle}"…`);
            try {
              const revised = await agentText({
                system: ROLES.editor,
                cached: `Brief:\n${goal}${ctx}`,
                prompt: `Fix instructions:\n- ${fixes}\n\nCurrent draft:\n${v.text}`,
                model: roleModel('editor'),
                maxTokens: 8192
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
            const verdict = await agentJson({
              system: ROLES.judge,
              prompt: `Brief:\n${goal}\n\nCandidates:\n${list}`,
              maxTokens: 4096,
              model: roleModel('judge'),
              schema: JUDGE_SCHEMA
            });
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
        releaseController(swarm.controller);
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
