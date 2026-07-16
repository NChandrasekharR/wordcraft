    /* =======================================================================
       Sensitivity Map — the "which knobs actually matter" instrument.

       The Controlled Experiment answers "did MY change beat noise?" for one
       knob at a time. The Sensitivity Map answers the broader question the
       thesis (§6 "Sensitivity surfacing", §7 "a sensitivity map accrues") asks:
       over a fixed source text, WHICH generation knobs move the output beyond
       the model's own random variation, and which are noise?

       It sweeps every knob against the SAME neutral baseline pool the
       Controlled Experiment builds (shared storage key + djb2), measures each
       sweep variant's distance from that baseline on two tracks — model-judged
       MEANING (primary) and word-level SURFACE (secondary) — and renders a
       per-knob impact chart against the noise floor. Results persist per
       (model + source) so re-opening shows the last map instantly.

       Everything here is prefixed sens/SENS_ because classic-script top-level
       scope is shared across every js/*.js file. It reads existing globals
       (expPoolKey/getBaselinePool/addBaselineToPool from experiment.js,
       semanticDistancePairs/cachedSemanticDistance from measure.js,
       callClaude/getModel from api.js, buildParamPrompt/computeDiffStats/
       escapeHtml/toneLabel… from util.js, currentSourceCard/sourceText/
       getCardText/showToast/requireApiKey from app.js) and never mutates them.
       ===================================================================== */

    // --- pure constants ------------------------------------------------------
    const SENS_STORE = 'wordcraft_sensitivity_v1';
    const SENS_STORE_CAP = 10;
    const SENS_CONCURRENCY = 4;
    const SENS_JUDGE_MODEL = 'claude-haiku-4-5';
    // Per-MTok pricing (input/output). Local + rough on purpose — do NOT import
    // swarm.js's table. Only used for the "rough cost" hint in the intro.
    const SENS_PRICING = {
      'claude-opus-4-8': { in: 5, out: 25 },
      'claude-sonnet-5': { in: 3, out: 15 },
      'claude-haiku-4-5': { in: 1, out: 5 },
    };
    // Rough per-call token assumptions for the cost estimate (labelled "rough").
    const SENS_GEN_IN_TOK = 400;
    const SENS_GEN_OUT_TOK = 500;   // ~500 tokens per generation, per the brief
    const SENS_JUDGE_IN_TOK = 3000; // one batched judge call carries many pairs
    const SENS_JUDGE_OUT_TOK = 400;

    // Classification thresholds (mirror experiment.js verdictFor's spirit):
    //   impact clears the whole noise band AND beats its median by >5 pts → strong
    //   impact at or below the noise median                              → noise
    //   in between                                                       → moderate
    const SENS_CLEAR_MARGIN = 0.05;

    // Neutral baseline params — identical to experiment.js's EXP_NEUTRAL and to
    // buildParamPrompt(source,0,0,0,'general','inform').
    const SENS_NEUTRAL = { tone: 0, length: 0, complexity: 0, audience: 'general', intent: 'inform' };

    // --- pure helpers (exported via the Node shim; unit-tested) --------------

    // djb2 → stable short key. Byte-for-byte the algorithm experiment.js and
    // measure.js use, so the sensitivity store key and the reused baseline pool
    // key agree. Kept local so this file has no hard cross-file dependency.
    function sensHash(str) {
      let h = 5381;
      const s = str == null ? '' : String(str);
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
      }
      return h.toString(36);
    }
    function sensPoolKey(model, source) {
      return sensHash(model + '\0' + source);
    }

    function sensMean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
    function sensMedian(xs) {
      if (!xs.length) return 0;
      const s = xs.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    function sensMax(xs) { return xs.length ? Math.max(...xs) : 0; }
    const sensPct = x => Math.round(x * 100);

    // The 10 sweep points, grouped by knob. Each holds a full param object with
    // exactly ONE knob moved off neutral, plus a human label. `fmt` supplies the
    // slider→word helpers (toneLabel/lengthLabel/complexityLabel) so this stays
    // pure and testable without pulling in util.js's browser globals.
    function sensSweepPoints(fmt) {
      fmt = fmt || {};
      const toneLbl = fmt.toneLabel || (v => 'Tone ' + v);
      const lenLbl = fmt.lengthLabel || (v => 'Length ' + v);
      const cxLbl = fmt.complexityLabel || (v => 'Complexity ' + v);
      const raw = [
        { knob: 'Tone', key: 'tone', value: -80, label: 'Tone → ' + toneLbl(-80) },
        { knob: 'Tone', key: 'tone', value: 80, label: 'Tone → ' + toneLbl(80) },
        { knob: 'Length', key: 'length', value: -80, label: 'Length → ' + lenLbl(-80) },
        { knob: 'Length', key: 'length', value: 80, label: 'Length → ' + lenLbl(80) },
        { knob: 'Complexity', key: 'complexity', value: -80, label: 'Complexity → ' + cxLbl(-80) },
        { knob: 'Complexity', key: 'complexity', value: 80, label: 'Complexity → ' + cxLbl(80) },
        { knob: 'Audience', key: 'audience', value: 'technical', label: 'Audience → technical' },
        { knob: 'Audience', key: 'audience', value: 'academic', label: 'Audience → academic' },
        { knob: 'Intent', key: 'intent', value: 'persuade', label: 'Intent → persuade' },
        { knob: 'Intent', key: 'intent', value: 'inspire', label: 'Intent → inspire' },
      ];
      return raw.map(p => {
        const params = Object.assign({}, SENS_NEUTRAL);
        params[p.key] = p.value;
        return { knob: p.knob, key: p.key, value: p.value, label: p.label, params };
      });
    }
    // Fixed knob order for grouping in the chart.
    const SENS_KNOB_ORDER = ['Tone', 'Length', 'Complexity', 'Audience', 'Intent'];

    // Classify one impact against the noise floor. PURE.
    function sensClassify(impact, noiseMax, noiseMedian) {
      if (impact >= noiseMax && (impact - noiseMedian) > SENS_CLEAR_MARGIN) return 'strong';
      if (impact <= noiseMedian) return 'noise';
      return 'moderate';
    }

    // A knob's headline category, folding both tracks together. PURE.
    //   'meaning'  — meaning impact clears the noise band (the real movers)
    //   'wording'  — meaning sits in noise but surface clears its band
    //                (the knob changed the words, not the message)
    //   'noise'    — meaning sits in the noise band and surface doesn't rescue it
    //   'marginal' — meaning rises above noise median but not clear of the band
    function sensKnobVerdict(knobSem, knobSurf, noise) {
      const semCls = knobSem == null ? null : sensClassify(knobSem, noise.semMax, noise.semMedian);
      const surfCls = sensClassify(knobSurf, noise.surfMax, noise.surfMedian);
      if (semCls === 'strong') return 'meaning';
      if (semCls === null) {
        // Judge unavailable — fall back to the surface track alone.
        if (surfCls === 'strong') return 'meaning';
        if (surfCls === 'noise') return 'noise';
        return 'marginal';
      }
      if (semCls === 'noise') return surfCls === 'strong' ? 'wording' : 'noise';
      return 'marginal';
    }

    // Join knob names with human "and": [A] → "A"; [A,B] → "A and B";
    // [A,B,C] → "A, B and C". PURE.
    function sensJoinNames(names) {
      if (names.length === 0) return '';
      if (names.length === 1) return names[0];
      if (names.length === 2) return names[0] + ' and ' + names[1];
      return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    }

    // Build the honest one-line summary from per-knob verdicts. PURE.
    // e.g. "For this text: Length and Intent move meaning well beyond noise;
    //       Tone is mostly wording; Complexity sits inside the noise band."
    function sensSummaryLine(knobVerdicts) {
      const groups = { meaning: [], wording: [], marginal: [], noise: [] };
      knobVerdicts.forEach(kv => { (groups[kv.verdict] || groups.noise).push(kv.knob); });
      const clauses = [];
      const plural = arr => arr.length > 1;
      if (groups.meaning.length) {
        clauses.push(`${sensJoinNames(groups.meaning)} ${plural(groups.meaning) ? 'move' : 'moves'} meaning well beyond noise`);
      }
      if (groups.wording.length) {
        clauses.push(`${sensJoinNames(groups.wording)} ${plural(groups.wording) ? 'are' : 'is'} mostly wording`);
      }
      if (groups.marginal.length) {
        clauses.push(`${sensJoinNames(groups.marginal)} ${plural(groups.marginal) ? 'are' : 'is'} marginal`);
      }
      if (groups.noise.length) {
        clauses.push(`${sensJoinNames(groups.noise)} ${plural(groups.noise) ? 'sit' : 'sits'} inside the noise band`);
      }
      if (!clauses.length) return 'For this text: not enough signal to separate any knob from noise yet.';
      return 'For this text: ' + clauses.join('; ') + '.';
    }

    // Fold raw sweep points + noise floor into a render-ready model. PURE, so
    // live runs and re-opened stored maps render identically. A knob's impact is
    // the STRONGEST of its two sweep directions (a knob "matters" if either
    // direction moves the output).
    function sensBuildModel(points, noise, judgeUnavailable) {
      const knobs = SENS_KNOB_ORDER.map(knob => {
        const pts = points.filter(p => p.knob === knob);
        const sems = pts.map(p => p.sem).filter(v => typeof v === 'number');
        const surfs = pts.map(p => p.surf).filter(v => typeof v === 'number');
        const semImpact = (!judgeUnavailable && sems.length) ? sensMax(sems) : null;
        const surfImpact = surfs.length ? sensMax(surfs) : 0;
        return { knob, points: pts, semImpact, surfImpact };
      });
      const verdicts = knobs.map(k => ({
        knob: k.knob,
        verdict: sensKnobVerdict(k.semImpact, k.surfImpact, noise),
      }));
      // Strongest knob = highest primary impact (meaning when available).
      let strongest = null, best = -1;
      knobs.forEach(k => {
        const primary = (!judgeUnavailable && k.semImpact != null) ? k.semImpact : k.surfImpact;
        if (primary > best) { best = primary; strongest = k.knob; }
      });
      return { knobs, verdicts, strongest, summary: sensSummaryLine(verdicts) };
    }

    // Drop all but the newest `cap` entries (by ts). PURE.
    function sensPruneStore(store, cap) {
      const entries = Object.keys(store).map(k => [k, store[k]]);
      if (entries.length <= cap) return Object.assign({}, store);
      entries.sort((a, b) => (a[1] && a[1].ts || 0) - (b[1] && b[1].ts || 0));
      const kept = {};
      for (const [k, v] of entries.slice(entries.length - cap)) kept[k] = v;
      return kept;
    }

    // "just now" / "5 minutes ago" / "3 hours ago" / "2 days ago". PURE.
    function sensRelativeTime(ts, now) {
      const diff = Math.max(0, (now == null ? Date.now() : now) - ts);
      const sec = Math.floor(diff / 1000);
      if (sec < 45) return 'just now';
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
      const day = Math.floor(hr / 24);
      return `${day} day${day === 1 ? '' : 's'} ago`;
    }

    // Rough $ estimate for a full run. PURE.
    function sensCostEstimate(genModel, genCount, judgeCount) {
      const g = SENS_PRICING[genModel] || SENS_PRICING['claude-opus-4-8'];
      const j = SENS_PRICING[SENS_JUDGE_MODEL];
      const genCost = genCount * (SENS_GEN_IN_TOK * g.in + SENS_GEN_OUT_TOK * g.out) / 1e6;
      const judgeCost = judgeCount * (SENS_JUDGE_IN_TOK * j.in + SENS_JUDGE_OUT_TOK * j.out) / 1e6;
      return genCost + judgeCost;
    }
    function sensFormatCost(v) {
      if (v < 0.01) return '$' + v.toFixed(3);
      return '$' + v.toFixed(2);
    }

    // --- Node shim: export the pure, testable helpers ------------------------
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        sensHash, sensPoolKey,
        sensMean, sensMedian, sensMax,
        sensSweepPoints, SENS_KNOB_ORDER, SENS_NEUTRAL,
        sensClassify, sensKnobVerdict, sensJoinNames, sensSummaryLine, sensBuildModel,
        sensPruneStore, sensRelativeTime, sensCostEstimate, sensFormatCost,
        SENS_STORE, SENS_STORE_CAP, SENS_PRICING, SENS_JUDGE_MODEL, SENS_CLEAR_MARGIN,
      };
    }

    // ========================================================================
    // Everything below is browser-only wiring. It is skipped under Node (the
    // shim above already returned the pure helpers). `document` is the guard.
    // ========================================================================
    if (typeof document !== 'undefined' && typeof window !== 'undefined') (function () {
      const sensitivityBtn = document.getElementById('sensitivityBtn');
      const sensitivityModal = document.getElementById('sensitivityModal');
      if (!sensitivityBtn || !sensitivityModal) return; // markup absent → no-op
      const sensBox = sensitivityModal.querySelector('.sensitivity-modal');
      const sensRun = document.getElementById('sensRun');
      const sensClose = document.getElementById('sensClose');
      const sensIntro = document.getElementById('sensIntro');
      const sensStoredNote = document.getElementById('sensStoredNote');
      const sensLoading = document.getElementById('sensLoading');
      const sensProgressSub = document.getElementById('sensProgressSub');
      const sensSteps = document.getElementById('sensSteps');
      const sensResult = document.getElementById('sensResult');
      const sensSummaryEl = document.getElementById('sensSummary');
      const sensChart = document.getElementById('sensChart');
      const sensChartFoot = document.getElementById('sensChartFoot');

      let sensController = null;

      // --- storage (all guarded) --------------------------------------------
      function sensLoadStore() {
        try {
          const raw = localStorage.getItem(SENS_STORE);
          const obj = raw ? JSON.parse(raw) : {};
          return (obj && typeof obj === 'object') ? obj : {};
        } catch (e) { return {}; }
      }
      function sensSaveEntry(key, entry) {
        try {
          const store = sensLoadStore();
          store[key] = entry;
          localStorage.setItem(SENS_STORE, JSON.stringify(sensPruneStore(store, SENS_STORE_CAP)));
        } catch (e) { /* quota / serialization errors are non-fatal */ }
      }
      function sensGetEntry(key) {
        const e = sensLoadStore()[key];
        return (e && typeof e === 'object') ? e : null;
      }

      // --- source resolution (same as the experiment) -----------------------
      function sensResolveSource() {
        return (currentSourceCard ? getCardText(currentSourceCard) : sourceText.value).trim();
      }

      // --- concurrency-capped task pool -------------------------------------
      // factories: array of () => Promise. Runs at most `cap` at once, preserves
      // order in the result array, and fails fast (rejects) on the first error —
      // callClaude rejects with AbortError when the shared signal aborts.
      async function sensRunPool(factories, cap, signal) {
        const results = new Array(factories.length);
        let next = 0;
        async function worker() {
          while (next < factories.length) {
            if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const idx = next++;
            results[idx] = await factories[idx]();
          }
        }
        const n = Math.max(1, Math.min(cap, factories.length));
        const workers = [];
        for (let i = 0; i < n; i++) workers.push(worker());
        await Promise.all(workers);
        return results;
      }

      // --- progress steps ---------------------------------------------------
      function sensAddStep(id, label) {
        const li = document.createElement('li');
        li.className = 'sens-step pending';
        li.setAttribute('data-step', id);
        const icon = document.createElement('span');
        icon.className = 'sens-step-icon';
        li.appendChild(icon);
        li.appendChild(document.createTextNode(label));
        sensSteps.appendChild(li);
      }
      function sensMarkStep(id) {
        const el = sensSteps.querySelector(`[data-step="${id}"]`);
        if (el) el.className = 'sens-step done';
      }
      function sensBuildSteps(newBaselines) {
        sensSteps.innerHTML = '';
        for (let i = 0; i < newBaselines; i++) {
          sensAddStep('base' + i, `Baseline · fresh sample ${i + 1} (shared pool)`);
        }
        sensAddStep('sweep', 'Sweeping 10 knob settings');
        sensAddStep('judge', 'Judging meaning distance');
      }

      // --- chart rendering --------------------------------------------------
      function sensEl(tag, cls, text) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        return el;
      }
      function sensClamp(pct) { return Math.max(0, Math.min(100, pct)); }

      // Render one already-computed data object (live OR stored) into the modal.
      function sensRenderResults(data) {
        const noise = data.noise;
        const model = sensBuildModel(data.points, noise, data.judgeUnavailable);

        sensSummaryEl.textContent = model.summary;

        sensChart.innerHTML = '';
        // Chart-wide noise reference: a shaded band out to the noise max and a
        // line at the noise median, drawn across the plot column behind the bars.
        const noiseRefPct = data.judgeUnavailable
          ? { band: sensPct(noise.surfMax), line: sensPct(noise.surfMedian) }
          : { band: sensPct(noise.semMax), line: sensPct(noise.semMedian) };
        const overlay = sensEl('div', 'sens-noise-overlay sens-noise-ref');
        const band = sensEl('div', 'sens-noise-band');
        band.style.width = sensClamp(noiseRefPct.band) + '%';
        const line = sensEl('div', 'sens-noise-line');
        line.style.left = sensClamp(noiseRefPct.line) + '%';
        const noiseLabel = sensEl('span', 'sens-noise-tag', 'noise');
        band.appendChild(noiseLabel);
        overlay.appendChild(band);
        overlay.appendChild(line);
        sensChart.appendChild(overlay);

        model.knobs.forEach(k => {
          const group = sensEl('div', 'sens-knob-group' + (k.knob === model.strongest ? ' sens-strong' : ''));
          const head = sensEl('div', 'sens-knob-head');
          head.appendChild(sensEl('span', 'sens-knob-name', k.knob));
          if (k.knob === model.strongest) head.appendChild(sensEl('span', 'sens-badge', 'strongest'));
          group.appendChild(head);

          k.points.forEach(p => {
            const primary = data.judgeUnavailable ? null : (typeof p.sem === 'number' ? p.sem : null);
            const surf = typeof p.surf === 'number' ? p.surf : 0;
            const row = sensEl('div', 'sens-row');
            row.appendChild(sensEl('div', 'sens-row-label', p.label));
            const track = sensEl('div', 'sens-track');
            // primary (semantic) bar
            const bar = sensEl('div', 'sens-bar' + (primary == null ? ' sens-bar-surface-only' : ''));
            const barVal = primary == null ? surf : primary;
            bar.style.width = sensClamp(sensPct(barVal)) + '%';
            track.appendChild(bar);
            // secondary (surface) tick — only when we have a distinct meaning bar
            if (primary != null) {
              const tick = sensEl('div', 'sens-surf-tick');
              tick.style.left = sensClamp(sensPct(surf)) + '%';
              tick.title = `wording ${sensPct(surf)}%`;
              track.appendChild(tick);
            }
            row.appendChild(track);
            const valTxt = primary == null
              ? `${sensPct(surf)}% wording`
              : `${sensPct(primary)}% · ${sensPct(surf)}% wording`;
            row.appendChild(sensEl('div', 'sens-row-value', valTxt));
            group.appendChild(row);
          });
          sensChart.appendChild(group);
        });

        const nb = data.nBaselines;
        const pairs = data.noisePairs;
        const footBits = [`vs ${nb} baseline${nb === 1 ? '' : 's'} · noise from ${pairs} pair${pairs === 1 ? '' : 's'}`];
        if (data.judgeUnavailable) footBits.push('meaning-level judging was unavailable — showing wording only');
        sensChartFoot.textContent = footBits.join(' · ');
      }

      function sensShowResults(data, storedTs) {
        sensIntro.style.display = 'none';
        sensLoading.style.display = 'none';
        if (storedTs != null) {
          sensStoredNote.style.display = 'block';
          sensStoredNote.textContent = `Last run ${sensRelativeTime(storedTs)}. Re-run to refresh against a fresh baseline draw.`;
        } else {
          sensStoredNote.style.display = 'none';
        }
        sensRenderResults(data);
        sensResult.style.display = 'flex';
        sensBox.classList.add('has-results');
      }

      // --- the run ----------------------------------------------------------
      async function runSensitivityMap() {
        const source = sensResolveSource();
        if (!source) { showToast('Add some source text first.', { tone: 'error' }); return; }

        const model = getModel();
        const poolKey = expPoolKey(model, source);      // shared with experiment.js
        const storeKey = sensPoolKey(model, source);     // sensitivity persistence
        const existingPool = getBaselinePool(poolKey);
        // Ensure >=2 pooled baselines; generate at most 2 fresh this run.
        const newBaselines = Math.max(0, 2 - existingPool.length);

        const points = sensSweepPoints({ toneLabel, lengthLabel, complexityLabel });
        const baselinePrompt = buildParamPrompt(source, 0, 0, 0, 'general', 'inform');

        sensController = new AbortController();
        const signal = sensController.signal;

        sensIntro.style.display = 'none';
        sensStoredNote.style.display = 'none';
        sensResult.style.display = 'none';
        sensBox.classList.remove('has-results');
        sensBuildSteps(newBaselines);
        sensProgressSub.textContent = `Sweeping 10 knob settings against the neutral baseline${newBaselines ? ` (+${newBaselines} fresh baseline${newBaselines === 1 ? '' : 's'})` : ''}, ${SENS_CONCURRENCY} at a time, then judging how far each moved the meaning.`;
        sensLoading.style.display = 'flex';
        sensRun.style.display = 'none';

        try {
          // 1. Generations: all sweep variants + any fresh baselines, one shared
          //    signal, concurrency-capped. Baselines are committed to the pool
          //    only after the WHOLE batch succeeds (abort/partial never poisons).
          const baseFactories = [];
          for (let i = 0; i < newBaselines; i++) {
            baseFactories.push(() => callClaude(baselinePrompt, { signal }).then(r => { sensMarkStep('base' + i); return r; }));
          }
          const sweepFactories = points.map(p =>
            () => callClaude(buildParamPrompt(source, p.params.tone, p.params.length, p.params.complexity, p.params.audience, p.params.intent), { signal }));

          const gen = await sensRunPool([...baseFactories, ...sweepFactories], SENS_CONCURRENCY, signal);
          sensMarkStep('sweep');
          const freshBaselines = gen.slice(0, newBaselines);
          const variantTexts = gen.slice(newBaselines);

          // Success → commit fresh baselines to the shared pool (newest last).
          let pool = existingPool.slice();
          freshBaselines.forEach(b => { pool = addBaselineToPool(poolKey, b); });

          // 2. SURFACE track (free, local). Impact = mean ratio vs each baseline.
          const surfImpacts = variantTexts.map(v => sensMean(pool.map(b => computeDiffStats(v, b).ratio)));
          const surfNoise = [];
          for (let i = 0; i < pool.length; i++) {
            for (let j = i + 1; j < pool.length; j++) surfNoise.push(computeDiffStats(pool[i], pool[j]).ratio);
          }

          // 3. SEMANTIC track (model-judged). ALL variant×baseline pairs in one
          //    uncached batched call; noise floor over baseline pairs is cached
          //    across runs. Judge failure degrades to surface-only.
          const variantPairs = [];
          variantTexts.forEach(v => pool.forEach(b => variantPairs.push([v, b])));
          const noisePairs = [];
          for (let i = 0; i < pool.length; i++) {
            for (let j = i + 1; j < pool.length; j++) noisePairs.push([pool[i], pool[j]]);
          }

          let semImpacts = null, semNoise = null, judgeUnavailable = false;
          try {
            const [variantSem, noiseSem] = await Promise.all([
              semanticDistancePairs(variantPairs, { signal }),
              cachedSemanticDistance(noisePairs, { signal }),
            ]);
            semImpacts = variantTexts.map((_, vi) => sensMean(pool.map((__, bi) => variantSem[vi * pool.length + bi])));
            semNoise = noiseSem;
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            judgeUnavailable = true;
          }
          sensMarkStep('judge');

          const noise = {
            semMedian: semNoise ? sensMedian(semNoise) : 0,
            semMax: semNoise ? sensMax(semNoise) : 0,
            surfMedian: sensMedian(surfNoise),
            surfMax: sensMax(surfNoise),
          };
          const outPoints = points.map((p, i) => ({
            knob: p.knob, key: p.key, label: p.label,
            sem: semImpacts ? semImpacts[i] : null,
            surf: surfImpacts[i],
          }));
          const data = {
            ts: Date.now(), model,
            nBaselines: pool.length, noisePairs: noisePairs.length,
            judgeUnavailable, noise, points: outPoints,
          };

          // Persist (only on full success) + render.
          sensSaveEntry(storeKey, data);
          sensShowResults(data, null);
        } catch (err) {
          sensLoading.style.display = 'none';
          sensBox.classList.remove('has-results');
          if (err.name === 'AbortError') {
            // Aborted: nothing committed anywhere. Return to whatever the modal
            // showed before (stored map if any, else intro).
            sensPresentInitial();
          } else {
            sensResult.style.display = 'none';
            sensStoredNote.style.display = 'none';
            sensIntro.style.display = 'block';
            sensIntro.textContent = '';
            const span = document.createElement('span');
            span.style.color = 'var(--accent-error)';
            span.textContent = `Error: ${err.message}`;
            sensIntro.appendChild(span);
          }
        } finally {
          sensController = null;
          sensRun.style.display = '';
          sensRun.disabled = false;
        }
      }

      // --- intro / stored presentation --------------------------------------
      function sensPresentInitial() {
        sensResult.style.display = 'none';
        sensLoading.style.display = 'none';
        sensBox.classList.remove('has-results');
        const source = sensResolveSource();
        const model = getModel();
        const stored = source ? sensGetEntry(sensPoolKey(model, source)) : null;
        if (stored && Array.isArray(stored.points) && stored.points.length) {
          sensRun.textContent = 'Re-run';
          sensShowResults(stored, stored.ts);
          return;
        }
        // Fresh intro with a rough cost estimate.
        sensRun.textContent = 'Run Sensitivity Map';
        sensStoredNote.style.display = 'none';
        sensIntro.style.display = 'block';
        const cost = sensFormatCost(sensCostEstimate(model, 12, 2));
        sensIntro.textContent = '';
        sensIntro.appendChild(document.createTextNode('Which knobs actually move the output for this text? This sweeps every generation knob against the neutral baseline and charts each one’s impact — meaning (model-judged) and wording — against the model’s own noise floor. '));
        const strong = document.createElement('strong');
        strong.textContent = `~12 generations + 1–2 cheap judge calls · rough cost ${cost}.`;
        sensIntro.appendChild(strong);
      }

      function openSensitivityModal() {
        sensPresentInitial();
        sensitivityModal.classList.add('visible');
      }
      function closeSensitivityModal() {
        if (sensController) sensController.abort(); // cancel in-flight generations
        sensitivityModal.classList.remove('visible');
      }

      sensitivityBtn.addEventListener('click', () => requireApiKey(openSensitivityModal));
      sensClose.addEventListener('click', closeSensitivityModal);
      sensitivityModal.addEventListener('click', (e) => { if (e.target === sensitivityModal) closeSensitivityModal(); });
      sensRun.addEventListener('click', runSensitivityMap);
    })();
