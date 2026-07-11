    /* =======================================================================
       Controlled Experiment — the "noise baseline" / control-group prototype.
       Runs the user's current settings once and re-runs a neutral baseline
       twice, then shows two diffs side by side: NOISE (baseline vs. a second
       baseline sample) and SIGNAL (baseline vs. the user's settings). This
       separates "what your change did" from "what randomness does anyway."
       ===================================================================== */

    const experimentBtn = document.getElementById('experimentBtn');
    const experimentModal = document.getElementById('experimentModal');
    const expRun = document.getElementById('expRun');
    const expClose = document.getElementById('expClose');
    const expResult = document.getElementById('expResult');
    const expLoading = document.getElementById('expLoading');
    const expIntro = document.getElementById('expIntro');
    const expVerdict = document.getElementById('expVerdict');
    const expNoiseDiff = document.getElementById('expNoiseDiff');
    const expSignalDiff = document.getElementById('expSignalDiff');
    const expNoiseMetric = document.getElementById('expNoiseMetric');
    const expSignalMetric = document.getElementById('expSignalMetric');
    const expSteps = document.getElementById('expSteps');

    function resetExpSteps() {
      expSteps.querySelectorAll('.exp-step').forEach(el => el.className = 'exp-step pending');
    }
    function markExpStep(id) {
      const el = expSteps.querySelector(`[data-step="${id}"]`);
      if (el) el.className = 'exp-step done';
    }

    function renderVerdict(signal, noise) {
      const s = Math.round(signal * 100), nz = Math.round(noise * 100);
      let cls, label, msg;
      if (signal - noise > 0.10 && signal > noise * 1.4) {
        cls = 'real'; label = 'Likely real effect';
        msg = `Your settings moved the output well beyond this run's random variation (${s}% vs ${nz}% from noise). One sample isn't proof — re-run the experiment to confirm the effect holds.`;
      } else if (signal <= noise * 1.1) {
        cls = 'noise'; label = 'Within the noise';
        msg = `Your settings barely move the output more than chance does (${s}% vs ${nz}%). The difference you're seeing may just be randomness — don't trust it without more samples.`;
      } else {
        cls = 'marginal'; label = 'Marginal';
        msg = `Your settings have some effect, but it sits close to the noise floor (${s}% vs ${nz}%). Treat the change as weak evidence — this comparison is based on a single sample of each condition.`;
      }
      expVerdict.className = `exp-verdict ${cls}`;
      expVerdict.innerHTML = `<strong>${escapeHtml(label)}</strong><br>${escapeHtml(msg)}`;
    }

    function postExperimentCard(source, text, tags) {
      const sourceCard = currentSourceCard || getOrCreateSourceCard(source);
      currentSourceCard = sourceCard;
      const card = createCard(tags, 'Generating', 'generating');
      finishVariantCard(card, source, text);
      connections.push({ from: sourceCard.id, to: card.id });
      requestAnimationFrame(() => { updateConnections(); zoomToFit(); });
    }

    let expController = null;

    async function runControlledExperiment() {
      const source = (currentSourceCard ? getCardText(currentSourceCard) : sourceText.value).trim();
      if (!source) { alert('Add some source text first.'); return; }

      const cTone = parseInt(toneSlider.value), cLen = parseInt(lengthSlider.value), cCom = parseInt(complexitySlider.value);
      const cAud = audienceSelect.value, cInt = intentSelect.value;
      const candidatePrompt = buildParamPrompt(source, cTone, cLen, cCom, cAud, cInt);
      const baselinePrompt = buildParamPrompt(source, 0, 0, 0, 'general', 'inform');

      expController = new AbortController();
      const signal = expController.signal;

      expIntro.style.display = 'none';
      expResult.style.display = 'none';
      resetExpSteps();
      expLoading.style.display = 'flex';
      expRun.style.display = 'none';
      try {
        // Two baseline samples (for the noise diff) + one candidate, in parallel.
        // Tick each step as its generation returns so progress is visible.
        const [baseA, baseB, cand] = await Promise.all([
          callClaude(baselinePrompt, { signal }).then(r => { markExpStep('baseA'); return r; }),
          callClaude(baselinePrompt, { signal }).then(r => { markExpStep('baseB'); return r; }),
          callClaude(candidatePrompt, { signal }).then(r => { markExpStep('cand'); return r; })
        ]);
        const noiseStats = computeDiffStats(baseA, baseB);
        const signalStats = computeDiffStats(baseA, cand);
        expNoiseDiff.innerHTML = computeDiff(baseA, baseB);
        expSignalDiff.innerHTML = computeDiff(baseA, cand);
        const fmt = st => `${st.changed} words differ (${Math.round(st.ratio * 100)}%)`;
        expNoiseMetric.textContent = fmt(noiseStats);
        expSignalMetric.textContent = fmt(signalStats);
        renderVerdict(signalStats.ratio, noiseStats.ratio);
        expLoading.style.display = 'none';
        expResult.style.display = 'flex';
        // Persist the candidate output so the experiment isn't throwaway.
        postExperimentCard(source, cand, [toneLabel(cTone), complexityLabel(cCom), 'experiment']);
      } catch (err) {
        expLoading.style.display = 'none';
        expIntro.style.display = 'block';
        if (err.name === 'AbortError') {
          expIntro.textContent = 'Experiment cancelled.';
        } else {
          expIntro.innerHTML = `<span style="color:var(--accent-error)">Error: ${escapeHtml(err.message)}</span>`;
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
      expIntro.style.display = 'block';
      expIntro.innerHTML = 'Signal vs. noise: this runs your <strong>current settings</strong> once and re-runs a <strong>neutral baseline</strong> twice — so you can see how much of the change is your edit versus the model\'s randomness. (3 API calls.)';
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
