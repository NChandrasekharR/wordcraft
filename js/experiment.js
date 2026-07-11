    /* =======================================================================
       Controlled Experiment — the "noise baseline" / control-group prototype.
       Runs the user's chosen configuration once (SIGNAL) against a pool of
       neutral-baseline samples (NOISE). The noise distribution is built from
       ALL pairs of cached baselines and grows across runs, so the verdict is
       a percentile of the signal within a real distribution rather than a
       single-sample guess. This separates "what your change did" from "what
       randomness does anyway."
       ===================================================================== */

    const experimentBtn = document.getElementById('experimentBtn');
    const experimentModal = document.getElementById('experimentModal');
    const experimentBox = experimentModal.querySelector('.experiment-modal');
    const expRun = document.getElementById('expRun');
    const expClose = document.getElementById('expClose');
    const expResult = document.getElementById('expResult');
    const expLoading = document.getElementById('expLoading');
    const expIntro = document.getElementById('expIntro');
    const expTestRow = document.getElementById('expTestRow');
    const expTest = document.getElementById('expTest');
    const expVerdict = document.getElementById('expVerdict');
    const expNoiseDiff = document.getElementById('expNoiseDiff');
    const expSignalDiff = document.getElementById('expSignalDiff');
    const expNoiseMetric = document.getElementById('expNoiseMetric');
    const expSignalMetric = document.getElementById('expSignalMetric');
    const expNoiseSub = document.getElementById('expNoiseSub');
    const expSignalSub = document.getElementById('expSignalSub');
    const expProgressSub = document.getElementById('expProgressSub');
    const expSteps = document.getElementById('expSteps');

    const EXP_BASELINE_STORE = 'wordcraft_exp_baselines_v1';
    const EXP_POOL_CAP = 8;

    // --- cached baseline pool ------------------------------------------------
    // djb2 string hash → stable short key per (model + source text).
    function expHash(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
      }
      return h.toString(36);
    }
    function expPoolKey(model, source) {
      return expHash(model + '\0' + source);
    }
    function loadBaselineStore() {
      try {
        const raw = localStorage.getItem(EXP_BASELINE_STORE);
        const obj = raw ? JSON.parse(raw) : {};
        return (obj && typeof obj === 'object') ? obj : {};
      } catch (e) { return {}; }
    }
    function saveBaselineStore(store) {
      try { localStorage.setItem(EXP_BASELINE_STORE, JSON.stringify(store)); }
      catch (e) { /* quota / serialization errors are non-fatal */ }
    }
    function getBaselinePool(key) {
      const arr = loadBaselineStore()[key];
      return Array.isArray(arr) ? arr.slice() : [];
    }
    // Append one baseline, newest last, cap at EXP_POOL_CAP (drop oldest).
    // Called only after a generation has FULLY succeeded, so aborted/partial
    // runs never poison the pool. Returns the updated pool.
    function addBaselineToPool(key, text) {
      const store = loadBaselineStore();
      const arr = Array.isArray(store[key]) ? store[key] : [];
      arr.push(text);
      while (arr.length > EXP_POOL_CAP) arr.shift();
      store[key] = arr;
      saveBaselineStore(store);
      return arr.slice();
    }

    // --- small stats helpers -------------------------------------------------
    function expMean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
    function expMedian(xs) {
      if (!xs.length) return 0;
      const s = xs.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    const pct = x => Math.round(x * 100);

    // --- loading steps (1–3 items, rebuilt per run) --------------------------
    function buildExpSteps(newBaselines, candLabel) {
      expSteps.innerHTML = '';
      for (let i = 0; i < newBaselines; i++) {
        addExpStep('base' + i, `Baseline · fresh sample ${i + 1} (cached pool)`);
      }
      addExpStep('cand', candLabel);
    }
    function addExpStep(id, label) {
      const li = document.createElement('li');
      li.className = 'exp-step pending';
      li.setAttribute('data-step', id);
      const icon = document.createElement('span');
      icon.className = 'exp-step-icon';
      li.appendChild(icon);
      li.appendChild(document.createTextNode(label));
      expSteps.appendChild(li);
    }
    function markExpStep(id) {
      const el = expSteps.querySelector(`[data-step="${id}"]`);
      if (el) el.className = 'exp-step done';
    }

    // --- verdict -------------------------------------------------------------
    // Percentile of the signal within the noise-pair distribution.
    // Thresholds (shipped):
    //   < 3 noise pairs  → hedge. 'real' only if signal > max(pairs) + 0.10,
    //                      else 'marginal'.
    //   >= 3 noise pairs → 'real'    if signal >= max(pairs) AND
    //                                   signal - median(pairs) > 0.05
    //                      'noise'   if signal <= median(pairs)
    //                      'marginal' otherwise.
    function renderVerdict(signal, pairRatios, nSamples) {
      const pairs = pairRatios.length;
      const mx = pairs ? Math.max(...pairRatios) : 0;
      const mn = pairs ? Math.min(...pairRatios) : 0;
      const med = expMedian(pairRatios);
      const s = pct(signal);
      const band = `${pct(mn)}–${pct(mx)}%`;
      const stat = `Signal ${s}% vs noise ${band} across ${pairs} baseline pair${pairs === 1 ? '' : 's'} (${nSamples} cached sample${nSamples === 1 ? '' : 's'}).`;

      let cls, label, msg;
      if (pairs < 3) {
        if (signal > mx + 0.10) {
          cls = 'real'; label = 'Likely real effect';
          msg = `${stat} Early signal — run again to tighten the noise estimate.`;
        } else {
          cls = 'marginal'; label = 'Marginal';
          msg = `${stat} Too few baseline pairs to be sure — run again to grow the noise distribution.`;
        }
      } else if (signal >= mx && (signal - med) > 0.05) {
        cls = 'real'; label = 'Likely real effect';
        msg = `${stat} Your edit clears the whole noise band and beats its median by more than 5 points — re-run to keep it honest.`;
      } else if (signal <= med) {
        cls = 'noise'; label = 'Within the noise';
        msg = `${stat} It sits at or below the median of pure randomness — treat this as noise, not your edit.`;
      } else {
        cls = 'marginal'; label = 'Marginal';
        msg = `${stat} It rises above the noise median but not clear of the band — weak evidence, add more samples.`;
      }
      expVerdict.className = `exp-verdict ${cls}`;
      expVerdict.textContent = '';
      const strong = document.createElement('strong');
      strong.textContent = label;
      expVerdict.appendChild(strong);
      expVerdict.appendChild(document.createElement('br'));
      expVerdict.appendChild(document.createTextNode(msg));
    }

    function postExperimentCard(source, text, tags) {
      const sourceCard = currentSourceCard || getOrCreateSourceCard(source);
      currentSourceCard = sourceCard;
      const card = createCard(tags, 'Generating', 'generating');
      finishVariantCard(card, source, text);
      connections.push({ from: sourceCard.id, to: card.id });
      requestAnimationFrame(() => { updateConnections(); zoomToFit(); });
    }

    // --- one-knob isolation --------------------------------------------------
    // Candidate = neutral baseline with ONLY the chosen knob taken from the
    // sidebar. 'all' keeps every current sidebar setting. The baseline pool is
    // always fully neutral, which is what makes it reusable across knob choices.
    const EXP_NEUTRAL = { tone: 0, length: 0, complexity: 0, audience: 'general', intent: 'inform' };
    function currentSidebarParams() {
      return {
        tone: parseInt(toneSlider.value),
        length: parseInt(lengthSlider.value),
        complexity: parseInt(complexitySlider.value),
        audience: audienceSelect.value,
        intent: intentSelect.value,
      };
    }
    function candidateParams(test, cur) {
      if (test === 'all') return Object.assign({}, cur);
      const p = Object.assign({}, EXP_NEUTRAL);
      p[test] = cur[test];
      return p;
    }
    function candidateTags(test, cur) {
      switch (test) {
        case 'tone': return [toneLabel(cur.tone), 'tone-only', 'experiment'];
        case 'length': return [lengthLabel(cur.length), 'length-only', 'experiment'];
        case 'complexity': return [complexityLabel(cur.complexity), 'complexity-only', 'experiment'];
        case 'audience': return [cur.audience, 'audience-only', 'experiment'];
        case 'intent': return [cur.intent, 'intent-only', 'experiment'];
        default: return [toneLabel(cur.tone), complexityLabel(cur.complexity), 'experiment'];
      }
    }
    function candidateStepLabel(test) {
      return test === 'all' ? 'Your settings' : `${test.charAt(0).toUpperCase() + test.slice(1)} only · your setting`;
    }

    let expController = null;

    async function runControlledExperiment() {
      const source = (currentSourceCard ? getCardText(currentSourceCard) : sourceText.value).trim();
      if (!source) { alert('Add some source text first.'); return; }

      const test = expTest.value;
      const cur = currentSidebarParams();
      const cp = candidateParams(test, cur);
      const candidatePrompt = buildParamPrompt(source, cp.tone, cp.length, cp.complexity, cp.audience, cp.intent);
      const baselinePrompt = buildParamPrompt(source, 0, 0, 0, 'general', 'inform');

      // Decide how many fresh baselines to draw: reach 2 when the pool is thin,
      // otherwise add exactly 1 (keeps the pool honest against drift + grows it).
      const key = expPoolKey(getModel(), source);
      const existingPool = getBaselinePool(key);
      const newBaselines = existingPool.length < 2 ? (2 - existingPool.length) : 1;

      expController = new AbortController();
      const signal = expController.signal;

      expIntro.style.display = 'none';
      expTestRow.style.display = 'none';
      expResult.style.display = 'none';
      experimentBox.classList.remove('has-results');
      buildExpSteps(newBaselines, candidateStepLabel(test));
      const totalCalls = newBaselines + 1;
      expProgressSub.textContent = `Generating ${totalCalls} rewrite${totalCalls === 1 ? '' : 's'} in parallel (${newBaselines} fresh baseline${newBaselines === 1 ? '' : 's'} + 1 candidate) to separate your change from the model's random variation.`;
      expLoading.style.display = 'flex';
      expRun.style.display = 'none';
      try {
        // All generations in parallel with shared abort. Baseline results are
        // only committed to the pool after the whole batch succeeds.
        const baselineTasks = [];
        for (let i = 0; i < newBaselines; i++) {
          baselineTasks.push(callClaude(baselinePrompt, { signal }).then(r => { markExpStep('base' + i); return r; }));
        }
        const candTask = callClaude(candidatePrompt, { signal }).then(r => { markExpStep('cand'); return r; });
        const settled = await Promise.all([...baselineTasks, candTask]);
        const freshBaselines = settled.slice(0, newBaselines);
        const cand = settled[settled.length - 1];

        // Success → commit fresh baselines to the pool (newest last).
        let pool = existingPool.slice();
        freshBaselines.forEach(b => { pool = addBaselineToPool(key, b); });

        // Noise distribution: ratio over ALL pairs of pooled baselines.
        const pairRatios = [];
        for (let i = 0; i < pool.length; i++) {
          for (let j = i + 1; j < pool.length; j++) {
            pairRatios.push(computeDiffStats(pool[i], pool[j]).ratio);
          }
        }
        // Signal: mean ratio of candidate vs each pooled baseline.
        const signalRatios = pool.map(b => computeDiffStats(cand, b).ratio);
        const signalMean = expMean(signalRatios);

        // Rendered diffs: noise = newest two baselines; signal = candidate vs newest.
        const newest = pool[pool.length - 1];
        const prev = pool.length >= 2 ? pool[pool.length - 2] : newest;
        expNoiseDiff.innerHTML = computeDiff(prev, newest);
        expSignalDiff.innerHTML = computeDiff(newest, cand);

        const mn = pairRatios.length ? Math.min(...pairRatios) : 0;
        const mx = pairRatios.length ? Math.max(...pairRatios) : 0;
        const med = expMedian(pairRatios);
        expNoiseMetric.textContent = `${pct(mn)}–${pct(mx)}% · median ${pct(med)}% · ${pairRatios.length} pair${pairRatios.length === 1 ? '' : 's'}`;
        expSignalMetric.textContent = `${pct(signalMean)}% mean vs ${pool.length} baseline${pool.length === 1 ? '' : 's'}`;
        expNoiseSub.textContent = `Cached across runs · noise estimated from ${pool.length} sample${pool.length === 1 ? '' : 's'}`;
        expSignalSub.textContent = 'Your candidate vs the pooled baselines';

        renderVerdict(signalMean, pairRatios, pool.length);
        expLoading.style.display = 'none';
        expResult.style.display = 'flex';
        experimentBox.classList.add('has-results');
        // Persist the candidate output so the experiment isn't throwaway.
        postExperimentCard(source, cand, candidateTags(test, cur));
      } catch (err) {
        expLoading.style.display = 'none';
        experimentBox.classList.remove('has-results');
        expTestRow.style.display = 'flex';
        expIntro.style.display = 'block';
        if (err.name === 'AbortError') {
          expIntro.textContent = 'Experiment cancelled.';
        } else {
          expIntro.textContent = '';
          const span = document.createElement('span');
          span.style.color = 'var(--accent-error)';
          span.textContent = `Error: ${err.message}`;
          expIntro.appendChild(span);
        }
      } finally {
        expController = null;
        expRun.style.display = '';
        expRun.disabled = false;
        expRun.textContent = 'Run again';
      }
    }

    function openExperimentModal() {
      expRun.textContent = 'Run Experiment';
      expResult.style.display = 'none';
      expLoading.style.display = 'none';
      experimentBox.classList.remove('has-results');
      expTestRow.style.display = 'flex';
      expIntro.style.display = 'block';
      expIntro.innerHTML = 'Signal vs. noise: this runs your <strong>chosen configuration</strong> once and re-runs a <strong>neutral baseline</strong>, comparing it against a pool of baselines cached across runs — so the noise estimate is a real distribution, not one sample. (2–3 API calls per run.)';
      experimentModal.classList.add('visible');
    }
    function closeExperimentModal() {
      if (expController) expController.abort(); // cancel in-flight generations
      experimentModal.classList.remove('visible');
    }
    experimentBtn.addEventListener('click', () => requireApiKey(openExperimentModal));
    expClose.addEventListener('click', closeExperimentModal);
    experimentModal.addEventListener('click', (e) => { if (e.target === experimentModal) closeExperimentModal(); });
    expRun.addEventListener('click', runControlledExperiment);
