    /* =======================================================================
       Ablation Lab — does a pipeline stage actually earn its cost?

       Agent tools show "process theater": you watch a swarm work but never
       learn whether a stage (a critic→editor round, a research pass) improves
       the output or just burns tokens. The Ablation Lab answers that as an
       experiment, not a vibe: run the SAME brief through two pipeline variants
       (arms) N times each, judge the outputs BLIND in randomized pairs, and
       report the win rate in honest, sample-count-stating language.

       A TRIAL is a stripped pipeline — no planner, ONE writer:
         Arm A (control): writer drafts from brief + source.
         Arm B, factor 'critic':   writer → critic (haiku) → editor.
         Arm B, factor 'research':  writer, but with a shared web-research
                                    brief injected into its prompt.
       The research pass runs ONCE per run (arm B only). Writer prompts are
       identical across the trials of an arm — sampling provides the variation.

       Everything reuses swarm.js's callClaudeRaw so the cost meter / step
       counter in the agent panel keep working. This file modifies no other
       js/* module; it only READS globals declared earlier (getModel,
       callClaudeRaw, swarm, SWARM_PRICING, CRITIC_SCHEMA, ROLES, createCard,
       finishVariantCard, connections, updateConnections, zoomToFit, logAgent,
       updateSwarmStats, escapeHtml, showToast, requireApiKey, …).
       ===================================================================== */

    // ---- PURE, TESTABLE HELPERS (no DOM / no network) ---------------------

    // The single blind-judge schema. Deliberately DISTINCT from the swarm judge
    // (winner + rationale + ranking) and the semantic judge (scores): this one
    // is winner + reason ONLY, so the e2e mock can identify it by shape.
    const ABL_JUDGE_SCHEMA = {
      type: 'object',
      additionalProperties: false,
      required: ['winner', 'reason'],
      properties: {
        winner: { type: 'integer', description: 'Which candidate better serves the brief: 1 or 2.' },
        reason: { type: 'string', description: 'One sentence on why it won.' }
      }
    };

    // Factor definitions: the human label + the two arms' tag labels.
    const ABL_FACTORS = {
      critic: { label: 'Critic + Editor round', armA: 'no critic', armB: 'with critic' },
      research: { label: 'Web research', armA: 'no research', armB: 'with research' }
    };

    // Rough per-stage token assumptions for the cost estimate (input/output).
    const ABL_TOKENS = {
      writer: { in: 450, out: 450 },
      critic: { in: 550, out: 220 },
      editor: { in: 700, out: 450 },
      judge: { in: 900, out: 120 },
      research: { in: 250, out: 600 }
    };

    // Map a blind judge's winner (1 or 2, referring to PRESENTED order) back to
    // the arm it belongs to. aFirst === true means arm A was shown as option 1.
    // This is the crux of blind judging and is unit-tested for both orderings.
    function ablWinnerToArm(winner, aFirst) {
      const w = Number(winner) === 2 ? 2 : 1; // guard: anything not 2 → 1
      if (aFirst) return w === 1 ? 'A' : 'B';
      return w === 1 ? 'B' : 'A';
    }

    // Tally wins per arm from the per-pair judge results.
    function ablCountWins(judgeResults) {
      let aWins = 0, bWins = 0;
      for (const r of judgeResults) {
        if (r.arm === 'A') aWins++;
        else if (r.arm === 'B') bWins++;
      }
      return { aWins, bWins };
    }

    // Best trial index for an arm: the one the judge preferred most often.
    // Each trial appears in exactly one pair, so a trial wins 0 or 1 times;
    // ties (and "won nothing") resolve to the FIRST such trial (index 0).
    function ablPickBest(arm, judgeResults) {
      const wins = judgeResults
        .filter(r => r.arm === arm)
        .map(r => r.i)
        .sort((a, b) => a - b);
      return wins.length ? wins[0] : 0;
    }

    // Honest verdict copy. States N explicitly and NEVER claims significance.
    //   N = 3            → "suggestive, not proof"
    //   N = 5            → "moderate"
    //   N = 8 & wins ≥ 7 → "strong for this brief"
    //   N = 8 & wins < 7 → "moderate"
    //   tie              → "too close to call"
    function ablVerdict(aWins, bWins, n, labelA, labelB) {
      let winnerArm, wWins, winLabel;
      if (bWins > aWins) { winnerArm = 'B'; wWins = bWins; winLabel = labelB; }
      else if (aWins > bWins) { winnerArm = 'A'; wWins = aWins; winLabel = labelA; }
      else { winnerArm = 'tie'; wWins = aWins; winLabel = null; }

      let strength;
      if (winnerArm === 'tie') strength = 'tie';
      else if (n >= 8 && wWins >= 7) strength = 'strong';
      else if (n >= 5) strength = 'moderate';
      else strength = 'suggestive';

      const comps = `${n} blind comparison${n === 1 ? '' : 's'}`;
      let label, sentence;
      if (winnerArm === 'tie') {
        label = 'Too close to call';
        sentence = `A dead heat — each arm took ${aWins} of ${comps}. No signal that the extra stage changes the outcome here.`;
      } else if (strength === 'strong') {
        label = 'Strong for this brief';
        sentence = `${winLabel} won ${wWins} of ${comps} — strong for this brief, though this is a sample of one brief, not a significance test.`;
      } else if (strength === 'moderate') {
        label = 'Moderate signal';
        sentence = `${winLabel} won ${wWins} of ${comps} — moderate evidence it helps here, not proof. Run more trials to firm it up.`;
      } else {
        label = 'Suggestive, not proof';
        sentence = `${winLabel} won ${wWins} of ${comps} — suggestive, not proof. ${comps.charAt(0).toUpperCase() + comps.slice(1)} can't separate a real edge from luck.`;
      }
      return { winnerArm, wWins, aWins, bWins, n, strength, cls: strength, label, sentence, winLabel };
    }

    // Rough cost estimate from SWARM_PRICING + per-stage token assumptions.
    // Pure: pricing is passed in so it is testable without the browser global.
    function ablCostEstimate(pricing, model, trials, factor) {
      const HAIKU = 'claude-haiku-4-5';
      const gen = pricing[model] || { in: 0, out: 0 };
      const cheap = pricing[HAIKU] || { in: 0, out: 0 };
      const t = ABL_TOKENS;
      const c = (stage, p) => (stage.in / 1e6) * p.in + (stage.out / 1e6) * p.out;

      let total = 0;
      total += trials * c(t.writer, gen); // arm A: N writers
      total += trials * c(t.writer, gen); // arm B: N writers
      if (factor === 'critic') {
        total += trials * c(t.critic, cheap); // N critics (haiku)
        total += trials * c(t.editor, gen);   // N editors
      } else if (factor === 'research') {
        total += c(t.research, gen);          // one shared research pass
      }
      total += trials * c(t.judge, gen);      // N blind judge calls
      return total;
    }

    // ---- BROWSER-ONLY: DOM, network, orchestration ------------------------
    // Guarded so this file can be require()d in Node for the pure-helper tests.
    if (typeof document !== 'undefined') {
      const ablBtn = document.getElementById('ablBtn');
      const ablModal = document.getElementById('ablModal');
      const ablGoal = document.getElementById('ablGoal');
      const ablFactor = document.getElementById('ablFactor');
      const ablTrials = document.getElementById('ablTrials');
      const ablCost = document.getElementById('ablCost');
      const ablStart = document.getElementById('ablStart');
      const ablCancel = document.getElementById('ablCancel');
      const ablResults = document.getElementById('ablResults');
      const ablBars = document.getElementById('ablBars');
      const ablVerdictLine = document.getElementById('ablVerdictLine');
      const ablPairs = document.getElementById('ablPairs');

      // Reuse the swarm's agent panel for live progress.
      const ablAgentPanel = document.getElementById('agentPanel');
      const ablAgentLog = document.getElementById('agentLog');
      const ablAgentPhase = document.getElementById('agentPhase');
      const ablAgentTitle = ablAgentPanel.querySelector('.critique-header h2');
      const ablAgentCancelBtn = document.getElementById('agentCancelBtn');
      const ablSwarmBtn = document.getElementById('swarmBtn');

      const ablState = { running: false, controller: null };

      // -- system prompts for the ablation roles ---------------------------
      const ABL_WRITER_SYS = 'You are the Writer in an ablation trial. Write the best possible version of the text for the given brief and source. Output ONLY the finished prose — no preamble, no explanation, no surrounding quotes.';
      const ABL_EDITOR_SYS = 'You are the Editor in an ablation trial. Revise the draft so it resolves every fix instruction while honoring the brief. Output ONLY the revised prose — no preamble.';
      const ABL_JUDGE_SYS = 'You are a blind judge in an ablation study. You see two anonymized candidate texts and the brief they must serve. You do NOT know which pipeline produced which text. Pick the ONE that better serves the brief. Output only the winner (1 or 2) and a one-sentence reason.';

      // -- thin wrappers over callClaudeRaw (tracks swarm.usage / steps) ----
      function ablExtractText(data) {
        return (data.content || [])
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();
      }
      async function ablText({ system, prompt, model, tools, maxTokens, signal }) {
        const data = await callClaudeRaw({
          system, messages: [{ role: 'user', content: prompt }],
          tools, model, maxTokens, signal
        });
        return ablExtractText(data);
      }
      async function ablJson({ system, prompt, model, schema, maxTokens, signal }) {
        const data = await callClaudeRaw({
          system, messages: [{ role: 'user', content: prompt }],
          model, maxTokens, signal, outputSchema: schema
        });
        return parseJson(ablExtractText(data));
      }

      // -- pipeline stages --------------------------------------------------
      async function ablWriter(goal, source, research, signal) {
        const ctx = research ? `\n\nResearch brief to draw on:\n${research}` : '';
        return ablText({
          system: ABL_WRITER_SYS,
          prompt: `Brief/goal:\n${goal || '(none given — produce a strong, faithful rewrite)'}${ctx}\n\nSource text:\n${source}`,
          model: getModel(), maxTokens: 1200, signal
        });
      }
      async function ablCritic(goal, draft, signal) {
        return ablJson({
          system: ROLES.critic,
          prompt: `Brief:\n${goal}\n\nDraft:\n${draft}`,
          model: 'claude-haiku-4-5', schema: CRITIC_SCHEMA, maxTokens: 700, signal
        });
      }
      async function ablEditor(goal, draft, fixes, signal) {
        return ablText({
          system: ABL_EDITOR_SYS,
          prompt: `Brief:\n${goal}\n\nFix instructions:\n- ${fixes}\n\nCurrent draft:\n${draft}`,
          model: getModel(), maxTokens: 1200, signal
        });
      }
      async function ablResearch(goal, source, signal) {
        const rm = getModel();
        return ablText({
          system: ROLES.researcher,
          prompt: `Brief: ${goal || '(general improvement)'}\nSource context:\n${source}\n\nGather and summarize the most useful current facts for this brief.`,
          model: rm,
          tools: [{
            type: rm === 'claude-haiku-4-5' ? 'web_search_20250305' : 'web_search_20260209',
            name: 'web_search', max_uses: 4
          }],
          maxTokens: 1200, signal
        });
      }
      async function ablJudge(goal, first, second, signal) {
        const prompt = `Brief / goal:\n${goal || '(none given — judge on general quality)'}\n\nTwo candidate texts serve the same brief. Decide which one better serves it.\n\n--- OPTION 1 ---\n${first}\n\n--- OPTION 2 ---\n${second}\n\nReturn the winner (1 or 2) and a one-sentence reason.`;
        return ablJson({
          system: ABL_JUDGE_SYS, prompt, model: getModel(),
          schema: ABL_JUDGE_SCHEMA, maxTokens: 400, signal
        });
      }

      // -- one arm-B trial (control arm A is just ablWriter) ---------------
      async function ablArmBTrial(goal, source, research, useCritic, signal) {
        // factor 'research' injects the shared research into arm B's writer;
        // factor 'critic' keeps the writer research-free but adds critic+editor.
        let text = await ablWriter(goal, source, useCritic ? '' : research, signal);
        if (useCritic) {
          const critique = await ablCritic(goal, text, signal);
          const fixes = (critique.fix_instructions || []).join('\n- ');
          if (fixes) text = await ablEditor(goal, text, fixes, signal);
        }
        return text;
      }

      // -- bounded-concurrency pool over task thunks -----------------------
      async function ablPool(tasks, limit) {
        const results = new Array(tasks.length);
        let next = 0;
        async function worker() {
          while (next < tasks.length) {
            const idx = next++;
            results[idx] = await tasks[idx]();
          }
        }
        const n = Math.min(limit, tasks.length) || 0;
        await Promise.all(Array.from({ length: n }, worker));
        return results;
      }

      // -- cost line -------------------------------------------------------
      function ablRenderCost() {
        const est = ablCostEstimate(SWARM_PRICING, getModel(), parseInt(ablTrials.value, 10), ablFactor.value);
        ablCost.textContent = `Rough estimate: ~$${est.toFixed(2)} for this run (${parseInt(ablTrials.value, 10)} trials/arm). Actual cost depends on text length.`;
      }

      // -- results in the modal (bars + verdict + per-pair reasons) --------
      function ablRenderResults(verdict, judgeResults, factor) {
        const f = ABL_FACTORS[factor];
        ablBars.textContent = '';
        [['A', verdict.aWins, f.armA], ['B', verdict.bWins, f.armB]].forEach(([arm, wins, lbl]) => {
          const row = document.createElement('div');
          row.className = 'abl-bar-row';
          const name = document.createElement('span');
          name.className = 'abl-bar-label';
          name.textContent = lbl;
          const track = document.createElement('div');
          track.className = 'abl-bar-track';
          const fill = document.createElement('div');
          fill.className = 'abl-bar-fill' + (verdict.winnerArm === arm ? ' win' : '');
          fill.style.width = (verdict.n ? Math.round((wins / verdict.n) * 100) : 0) + '%';
          const cnt = document.createElement('span');
          cnt.className = 'abl-bar-count';
          cnt.textContent = `${wins} / ${verdict.n}`;
          track.appendChild(fill);
          row.appendChild(name);
          row.appendChild(track);
          row.appendChild(cnt);
          ablBars.appendChild(row);
        });

        ablVerdictLine.className = `abl-verdict-line ${verdict.cls}`;
        ablVerdictLine.textContent = '';
        const strong = document.createElement('strong');
        strong.textContent = verdict.label;
        ablVerdictLine.appendChild(strong);
        ablVerdictLine.appendChild(document.createTextNode(' — ' + verdict.sentence));

        ablPairs.textContent = '';
        const summary = document.createElement('summary');
        summary.textContent = `Per-pair blind judgments (${judgeResults.length})`;
        ablPairs.appendChild(summary);
        judgeResults.slice().sort((a, b) => a.i - b.i).forEach(r => {
          const wrap = document.createElement('div');
          wrap.className = 'abl-pair';
          const head = document.createElement('div');
          head.className = 'abl-pair-head';
          head.textContent = `Pair ${r.i + 1}: ${r.arm === 'A' ? f.armA : f.armB} preferred`;
          const reason = document.createElement('div');
          reason.className = 'abl-pair-reason';
          reason.textContent = r.reason || '(no reason given)';
          wrap.appendChild(head);
          wrap.appendChild(reason);
          ablPairs.appendChild(wrap);
        });
        ablResults.style.display = '';
      }

      // -- the run ----------------------------------------------------------
      async function runAblation({ goal, factor, trials }) {
        const source = (currentSourceCard ? getCardText(currentSourceCard) : sourceText.value).trim();
        if (!source) { showToast('Add some source text first.', { tone: 'error' }); return; }
        if (ablState.running || swarm.running) { ablAgentPanel.classList.add('visible'); return; }

        // Guards: block Swarm, and wire the panel's Stop button to OUR
        // controller (swarm.controller) with zero edits to swarm.js — the
        // existing agentCancelBtn handler calls swarm.controller.abort().
        ablState.running = true;
        ablState.controller = new AbortController();
        swarm.running = true;
        swarm.controller = ablState.controller;
        swarm.steps = 0; swarm.tokensIn = 0; swarm.tokensOut = 0; swarm.usage = {};
        const signal = ablState.controller.signal;
        const aborted = () => signal.aborted;
        const useCritic = factor === 'critic';
        const useResearch = factor === 'research';

        // UI
        ablModal.classList.remove('visible');
        ablAgentLog.innerHTML = '';
        if (ablAgentTitle) ablAgentTitle.textContent = 'Ablation Lab';
        ablAgentPhase.textContent = 'Ablation: preparing';
        ablAgentPanel.classList.add('visible');
        ablAgentCancelBtn.style.display = '';
        ablAgentCancelBtn.textContent = 'Stop Ablation';
        ablSwarmBtn.disabled = true;
        ablBtn.disabled = true;
        updateSwarmStats();

        const sourceCard = currentSourceCard || getOrCreateSourceCard(source);
        currentSourceCard = sourceCard;
        logAgent('Ablation', `Factor: ${ABL_FACTORS[factor].label} · ${trials} trials/arm · blind paired judging`, 'done');

        try {
          // 1. Shared research (once, arm B only) for the 'research' factor.
          let research = '';
          if (useResearch && !aborted()) {
            ablAgentPhase.textContent = 'Researching (shared, arm B)';
            const rLog = logAgent('Researcher', `Searching for: ${goal || 'the brief'}`);
            try {
              research = await ablResearch(goal, source, signal);
              rLog.update('Research brief ready — injected into arm B writers only', 'done');
            } catch (e) {
              if (aborted()) throw e;
              rLog.update(`Research failed: ${e.message}`, 'fail');
            }
          }

          // 2. Trials — both arms, one flat pool, concurrency ≤ 4.
          ablAgentPhase.textContent = `Drafting ${trials * 2} trials`;
          const trialTasks = [];
          for (let i = 0; i < trials; i++) {
            const idx = i;
            trialTasks.push(async () => {
              const log = logAgent('Writer', `Arm A · trial ${idx + 1} (${ABL_FACTORS[factor].armA})`);
              const text = await ablWriter(goal, source, '', signal);
              log.update(`Arm A trial ${idx + 1} drafted`, 'done');
              return { arm: 'A', i: idx, text };
            });
            trialTasks.push(async () => {
              const log = logAgent('Pipeline', `Arm B · trial ${idx + 1} (${ABL_FACTORS[factor].armB})`);
              const text = await ablArmBTrial(goal, source, research, useCritic, signal);
              log.update(`Arm B trial ${idx + 1} ready`, 'done');
              return { arm: 'B', i: idx, text };
            });
          }
          const trialResults = await ablPool(trialTasks, 4);
          if (aborted()) throw new Error('Ablation stopped');

          const aByIndex = {}, bByIndex = {};
          for (const r of trialResults) (r.arm === 'A' ? aByIndex : bByIndex)[r.i] = r.text;

          // 3. Blind paired judging — pair trial i of A with trial i of B,
          //    randomize which is shown first, map the winner back to its arm.
          ablAgentPhase.textContent = 'Judging (blind, randomized pairs)';
          const judgeTasks = [];
          for (let i = 0; i < trials; i++) {
            const idx = i;
            const aFirst = Math.random() < 0.5;
            const first = aFirst ? aByIndex[idx] : bByIndex[idx];
            const second = aFirst ? bByIndex[idx] : aByIndex[idx];
            judgeTasks.push(async () => {
              const log = logAgent('Judge', `Pair ${idx + 1} — blind comparison`);
              const v = await ablJudge(goal, first, second, signal);
              const arm = ablWinnerToArm(v.winner, aFirst);
              log.update(`Pair ${idx + 1}: ${arm === 'A' ? ABL_FACTORS[factor].armA : ABL_FACTORS[factor].armB} preferred`, 'done');
              return { i: idx, arm, reason: v.reason || '', aFirst };
            });
          }
          const judgeResults = await ablPool(judgeTasks, 4);
          if (aborted()) throw new Error('Ablation stopped');

          // 4. Tally + verdict.
          const { aWins, bWins } = ablCountWins(judgeResults);
          const verdict = ablVerdict(aWins, bWins, trials, ABL_FACTORS[factor].armA, ABL_FACTORS[factor].armB);

          // 5. Canvas artifacts — exactly TWO output cards (best of each arm)
          //    + ONE verdict card. Posted only here, at the very end, so an
          //    abort anywhere above leaves the canvas untouched.
          const bestA = aByIndex[ablPickBest('A', judgeResults)];
          const bestB = bByIndex[ablPickBest('B', judgeResults)];

          const cardA = createCard([ABL_FACTORS[factor].armA, 'ablation'], 'Generating', 'generating');
          finishVariantCard(cardA, source, bestA);
          connections.push({ from: sourceCard.id, to: cardA.id });

          const cardB = createCard([ABL_FACTORS[factor].armB, 'ablation'], 'Generating', 'generating');
          finishVariantCard(cardB, source, bestB);
          connections.push({ from: sourceCard.id, to: cardB.id });

          const winnerCard = verdict.winnerArm === 'A' ? cardA : cardB;
          if (verdict.winnerArm !== 'tie') winnerCard.classList.add('winner');

          const vCard = createCard(['Verdict', 'ablation'], 'Generating', 'generating');
          vCard.classList.remove('generating');
          vCard.classList.add('verdict');
          vCard.querySelector('.card-content').textContent =
            `${ABL_FACTORS[factor].label} — ${verdict.label}\n\n${verdict.sentence}`;
          connections.push({ from: winnerCard.id, to: vCard.id });

          requestAnimationFrame(() => { updateConnections(); zoomToFit(); });

          // 6. Results in the modal too.
          ablRenderResults(verdict, judgeResults, factor);
          ablModal.classList.add('visible');

          ablAgentPhase.textContent = 'Complete';
          logAgent('Ablation', `${verdict.label}: ${verdict.sentence}`, 'done');
        } catch (e) {
          if (e.name === 'AbortError' || aborted()) {
            ablAgentPhase.textContent = 'Stopped';
            logAgent('Ablation', 'Run stopped by user — no cards posted.', 'fail');
          } else {
            ablAgentPhase.textContent = 'Error';
            logAgent('Ablation', e.message, 'fail');
          }
        } finally {
          ablState.running = false;
          ablState.controller = null;
          swarm.running = false;
          swarm.controller = null;
          ablSwarmBtn.disabled = false;
          ablBtn.disabled = false;
          ablAgentCancelBtn.style.display = 'none';
          ablAgentCancelBtn.textContent = 'Stop Swarm';
        }
      }

      // -- modal wiring -----------------------------------------------------
      function openAblModal() {
        ablResults.style.display = 'none';
        ablRenderCost();
        ablModal.classList.add('visible');
        ablGoal.focus();
      }
      ablBtn.addEventListener('click', () => {
        if (ablState.running || swarm.running) { ablAgentPanel.classList.add('visible'); return; }
        requireApiKey(openAblModal);
      });
      ablCancel.addEventListener('click', () => ablModal.classList.remove('visible'));
      ablModal.addEventListener('click', (e) => { if (e.target === ablModal) ablModal.classList.remove('visible'); });
      ablFactor.addEventListener('change', ablRenderCost);
      ablTrials.addEventListener('change', ablRenderCost);
      ablStart.addEventListener('click', () => {
        runAblation({
          goal: ablGoal.value.trim(),
          factor: ablFactor.value,
          trials: parseInt(ablTrials.value, 10)
        });
      });
    }

    // ---- Node shim: export the pure helpers for tests/ablation.test.js ----
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        ablWinnerToArm,
        ablCountWins,
        ablPickBest,
        ablVerdict,
        ablCostEstimate,
        ABL_JUDGE_SCHEMA,
        ABL_FACTORS,
        ABL_TOKENS
      };
    }
