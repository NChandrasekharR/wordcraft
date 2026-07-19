    // State
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let cardCount = 0;
    let nextCardX = 80;
    let nextCardY = 80;
    let draggedCard = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let selectedCard = null;
    let isDragging = false;
    let mouseDownTime = 0;

    // Resize state
    let resizingCard = null;
    let resizeDirection = null;
    let resizeStartX = 0;
    let resizeStartY = 0;
    let resizeStartWidth = 0;
    let resizeStartHeight = 0;
    const MIN_CARD_WIDTH = 200;
    const MIN_CARD_HEIGHT = 100;
    let currentCritique = null;
    const critiqueCache = new Map(); // Cache critiques by card ID
    const analysisByCard = new Map(); // Persistent source-text analysis by card ID
    const connections = []; // Track card connections {from: cardId, to: cardId}

    // Multi-select state
    let multiSelectedCards = []; // Array of card elements in selection order

    // Structured-output JSON schemas (Anthropic structured outputs). Every
    // object needs additionalProperties:false and a required list; only basic
    // JSON Schema types are supported (no minLength/minimum constraints).
    const ANALYSIS_SCHEMA = {
      type: 'object',
      additionalProperties: false,
      required: ['tone', 'audience', 'intent', 'summary', 'suggestions'],
      properties: {
        tone: { type: 'string' },
        audience: { type: 'string' },
        intent: { type: 'string' },
        summary: { type: 'string' },
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'detail', 'prompt_instruction'],
            properties: {
              action: { type: 'string' },
              detail: { type: 'string' },
              prompt_instruction: { type: 'string' }
            }
          }
        }
      }
    };
    const CRITIQUE_SCHEMA = {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'verdict_summary', 'strengths', 'weaknesses', 'suggestions', 'best_fix'],
      properties: {
        verdict: { type: 'string', enum: ['good', 'needs-work', 'poor'] },
        verdict_summary: { type: 'string' },
        strengths: { type: 'array', items: { type: 'string' } },
        weaknesses: { type: 'array', items: { type: 'string' } },
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'detail'],
            properties: {
              action: { type: 'string' },
              detail: { type: 'string' }
            }
          }
        },
        best_fix: { type: 'string' }
      }
    };

    // Elements
    const canvasContainer = document.getElementById('canvasContainer');
    const canvas = document.getElementById('canvas');
    const canvasHint = document.getElementById('canvasHint');
    const emptyState = document.getElementById('emptyState');
    const zoomLevel = document.getElementById('zoomLevel');
    const sourceText = document.getElementById('sourceText');
    const audienceSelect = document.getElementById('audience');
    const intentSelect = document.getElementById('intent');
    const toneValue = document.getElementById('toneValue');
    const lengthValue = document.getElementById('lengthValue');
    const complexityValue = document.getElementById('complexityValue');
    const generateBtn = document.getElementById('generateBtn');
    const addSourceBtn = document.getElementById('addSourceBtn');
    const generationPanel = document.getElementById('generationPanel');
    const analysisPanel = document.getElementById('analysisPanel');
    const analysisContent = document.getElementById('analysisContent');
    const suggestionsSection = document.getElementById('suggestionsSection');
    const suggestionsList = document.getElementById('suggestionsList');
    const analysisClose = document.getElementById('analysisClose');
    const generateFromSuggestionBtn = document.getElementById('generateFromSuggestionBtn');

    // State for current source card and analysis
    let currentSourceCard = null;
    let currentAnalysis = null;
    let selectedSuggestions = []; // Array for multiple selections
    const critiquePanel = document.getElementById('critiquePanel');
    const critiqueContent = document.getElementById('critiqueContent');
    const critiqueClose = document.getElementById('critiqueClose');
    const regenCritiqueBtn = document.getElementById('regenCritiqueBtn');
    const applySuggestionBtn = document.getElementById('applySuggestionBtn');

    // API Key Modal elements
    const apiKeyModal = document.getElementById('apiKeyModal');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const apiKeyBtn = document.getElementById('apiKeyBtn');
    const apiKeyStatus = document.getElementById('apiKeyStatus');
    const apiKeyCancel = document.getElementById('apiKeyCancel');
    const apiKeySave = document.getElementById('apiKeySave');
    const apiKeyRemember = document.getElementById('apiKeyRemember');
    const modelSelect = document.getElementById('modelSelect');

    // Comparison Panel elements
    const comparePanel = document.getElementById('comparePanel');
    const compareCount = document.getElementById('compareCount');
    const compareBody = document.getElementById('compareBody');
    const compareClose = document.getElementById('compareClose');
    const compareDiffToggle = document.getElementById('compareDiffToggle');

    /* =======================================================================
       Toast notifications — replaces alert()/confirm() for in-app messaging.
       Kept as a top-level (global) function so other classic scripts loaded
       after this one (js/swarm.js, js/experiment.js) can call it too.
       ===================================================================== */
    const toastContainer = document.getElementById('toastContainer');

    // showToast(message, opts): opts = { actionLabel, onAction, duration, tone }
    // tone: 'info' (default) | 'error'. duration defaults to 5000ms.
    // Returns { dismiss } so callers can dismiss it programmatically.
    function showToast(message, opts = {}) {
      const { actionLabel, onAction, duration = 5000, tone = 'info' } = opts;
      if (!toastContainer) return { dismiss: () => {} };

      const toast = document.createElement('div');
      toast.className = `toast toast-${tone === 'error' ? 'error' : 'info'}`;

      const messageEl = document.createElement('span');
      messageEl.className = 'toast-message';
      messageEl.textContent = message;
      toast.appendChild(messageEl);

      let dismissed = false;
      let timer = null;
      function dismiss() {
        if (dismissed) return;
        dismissed = true;
        clearTimeout(timer);
        toast.classList.add('toast-leaving');
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        // Fallback in case transitionend doesn't fire (e.g. display:none ancestor)
        setTimeout(() => toast.remove(), 400);
      }

      if (actionLabel && typeof onAction === 'function') {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'toast-action';
        actionBtn.textContent = actionLabel;
        actionBtn.addEventListener('click', () => {
          dismiss();
          onAction();
        });
        toast.appendChild(actionBtn);
      }

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'toast-close';
      closeBtn.textContent = '×';
      closeBtn.setAttribute('aria-label', 'Dismiss notification');
      closeBtn.addEventListener('click', dismiss);
      toast.appendChild(closeBtn);

      toastContainer.appendChild(toast);
      // Animate in on the next frame (so the initial state applies first)
      requestAnimationFrame(() => toast.classList.add('toast-visible'));
      timer = setTimeout(dismiss, duration);

      return { dismiss };
    }

    // Pending action to run after API key is set
    let pendingApiAction = null;

    function hasApiKey() {
      return !!getApiKey();
    }

    function updateApiKeyStatus() {
      if (hasApiKey()) {
        apiKeyStatus.textContent = 'API Key Set';
        apiKeyBtn.classList.add('has-key');
      } else {
        apiKeyStatus.textContent = 'Set API Key';
        apiKeyBtn.classList.remove('has-key');
      }
    }

    function showApiKeyModal() {
      apiKeyInput.value = getApiKey();
      modelSelect.value = getModel();
      // Reflect where the current key lives: unchecked only if it's a
      // session-only key; checked (the default) if it's in localStorage or
      // there's no key yet.
      let inSessionOnly = false;
      try { inSessionOnly = !!sessionStorage.getItem('anthropic_api_key'); } catch (e) {}
      apiKeyRemember.checked = !inSessionOnly;
      apiKeyModal.classList.add('visible');
      apiKeyInput.focus();
    }

    function hideApiKeyModal() {
      apiKeyModal.classList.remove('visible');
      pendingApiAction = null;
    }

    function saveApiKey() {
      localStorage.setItem('wordcraft_model', modelSelect.value);
      const key = apiKeyInput.value.trim();
      if (key) {
        if (apiKeyRemember.checked) {
          localStorage.setItem('anthropic_api_key', key);
          try { sessionStorage.removeItem('anthropic_api_key'); } catch (e) {}
        } else {
          try { sessionStorage.setItem('anthropic_api_key', key); } catch (e) {}
          localStorage.removeItem('anthropic_api_key');
        }
        updateApiKeyStatus();
        hideApiKeyModal();
        // Execute pending action if any
        if (pendingApiAction) {
          const action = pendingApiAction;
          pendingApiAction = null;
          action();
        }
      }
    }

    // Ensure API key before running an action
    function requireApiKey(action) {
      if (hasApiKey()) {
        action();
      } else {
        pendingApiAction = action;
        showApiKeyModal();
      }
    }

    // Initialize API key status
    updateApiKeyStatus();

    // API Key modal event listeners
    apiKeyBtn.addEventListener('click', showApiKeyModal);
    apiKeyCancel.addEventListener('click', hideApiKeyModal);
    apiKeySave.addEventListener('click', saveApiKey);
    apiKeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveApiKey();
      if (e.key === 'Escape') hideApiKeyModal();
    });
    apiKeyModal.addEventListener('click', (e) => {
      if (e.target === apiKeyModal) hideApiKeyModal();
    });

    // Parameter sliders
    const toneSlider = document.getElementById('toneSlider');
    const lengthSlider = document.getElementById('lengthSlider');
    const complexitySlider = document.getElementById('complexitySlider');

    function updateSliderLabels() {
      toneValue.textContent = toneLabel(parseInt(toneSlider.value));
      lengthValue.textContent = lengthLabel(parseInt(lengthSlider.value));
      complexityValue.textContent = complexityLabel(parseInt(complexitySlider.value));
    }

    toneSlider.addEventListener('input', updateSliderLabels);
    lengthSlider.addEventListener('input', updateSliderLabels);
    complexitySlider.addEventListener('input', updateSliderLabels);

    // Canvas transform
    function updateCanvasTransform() {
      canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
      canvas.style.transformOrigin = '0 0';
      zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    }

    function zoomIn() {
      scale = Math.min(scale * 1.2, 3);
      updateCanvasTransform();
    }

    function zoomOut() {
      scale = Math.max(scale / 1.2, 0.25);
      updateCanvasTransform();
    }

    function zoomToFit() {
      const cards = canvas.querySelectorAll('.card');
      if (cards.length === 0) {
        scale = 1;
        panX = 0;
        panY = 0;
        updateCanvasTransform();
        return;
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      cards.forEach(card => {
        const x = parseInt(card.style.left);
        const y = parseInt(card.style.top);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + card.offsetWidth);
        maxY = Math.max(maxY, y + card.offsetHeight);
      });

      const contentWidth = maxX - minX + 160;
      const contentHeight = maxY - minY + 160;
      const containerWidth = canvasContainer.offsetWidth;
      const containerHeight = canvasContainer.offsetHeight;

      scale = Math.min(containerWidth / contentWidth, containerHeight / contentHeight, 1.5);
      scale = Math.max(scale, 0.25);

      panX = (containerWidth - contentWidth * scale) / 2 - minX * scale + 80;
      panY = (containerHeight - contentHeight * scale) / 2 - minY * scale + 80;

      updateCanvasTransform();
    }

    document.getElementById('zoomIn').addEventListener('click', zoomIn);
    document.getElementById('zoomOut').addEventListener('click', zoomOut);
    document.getElementById('zoomFit').addEventListener('click', zoomToFit);

    // Mouse wheel zoom
    canvasContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.25, Math.min(3, scale * delta));

      const rect = canvasContainer.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const scaleChange = newScale / scale;
      panX = mouseX - (mouseX - panX) * scaleChange;
      panY = mouseY - (mouseY - panY) * scaleChange;

      scale = newScale;
      updateCanvasTransform();
    }, { passive: false });

    // Panning
    canvasContainer.addEventListener('mousedown', (e) => {
      if (e.target === canvasContainer || e.target === canvas || e.target === emptyState || e.target.closest('.empty-state')) {
        isPanning = true;
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        canvasContainer.style.cursor = 'grabbing';
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (isPanning) {
        panX = e.clientX - panStartX;
        panY = e.clientY - panStartY;
        updateCanvasTransform();
      }
      if (draggedCard) {
        isDragging = true;
        const canvasRect = canvasContainer.getBoundingClientRect();
        const x = (e.clientX - canvasRect.left - panX) / scale - dragOffsetX;
        const y = (e.clientY - canvasRect.top - panY) / scale - dragOffsetY;
        draggedCard.style.left = `${Math.max(0, x)}px`;
        draggedCard.style.top = `${Math.max(0, y)}px`;
        // Update arrows while dragging
        updateConnections();
      }
      // Handle resizing
      if (resizingCard) {
        const deltaX = (e.clientX - resizeStartX) / scale;
        const deltaY = (e.clientY - resizeStartY) / scale;

        if (resizeDirection.includes('e')) {
          const newWidth = Math.max(MIN_CARD_WIDTH, resizeStartWidth + deltaX);
          resizingCard.style.width = `${newWidth}px`;
        }
        if (resizeDirection.includes('s')) {
          const newHeight = Math.max(MIN_CARD_HEIGHT, resizeStartHeight + deltaY);
          resizingCard.style.height = `${newHeight}px`;
        }
        updateConnections();
      }
    });

    document.addEventListener('mouseup', () => {
      isPanning = false;
      canvasContainer.style.cursor = '';
      if (draggedCard) {
        draggedCard.classList.remove('dragging');
        // Update arrows after card is dropped
        requestAnimationFrame(updateConnections);
        draggedCard = null;
      }
      if (resizingCard) {
        resizingCard.classList.remove('resizing');
        requestAnimationFrame(updateConnections);
        resizingCard = null;
        resizeDirection = null;
      }
    });

    // Card selection
    function selectCard(card) {
      if (selectedCard) selectedCard.classList.remove('selected');
      selectedCard = card;
      card.classList.add('selected');

      // Different behavior for source vs generated cards
      if (card.classList.contains('source')) {
        // Source cards always surface their analysis: from the persistent
        // store when we have it (no API call), generated on the spot if not.
        critiquePanel.classList.remove('visible');
        currentSourceCard = card;
        const storedAnalysis = analysisByCard.get(card.id);
        if (storedAnalysis) {
          wlog('analysis served from store for', card.id);
          currentAnalysis = storedAnalysis;
          selectedSuggestions = []; // fresh render — no stale selections
          generateFromSuggestionBtn.disabled = true;
          renderAnalysis(storedAnalysis);
          analysisPanel.classList.add('visible');
        } else {
          analyzeSource(card);
        }
      } else {
        // For generated/variant cards, show the critique panel
        analysisPanel.classList.remove('visible');
        critiquePanel.classList.add('visible');

        // Check cache first
        const cachedCritique = critiqueCache.get(card.id);
        if (cachedCritique) {
          wlog('critique served from cache for', card.id);
          currentCritique = cachedCritique;
          renderCritique(cachedCritique);
        } else {
          analyzeCard(card);
        }
      }
    }

    function deselectCard() {
      if (selectedCard) {
        selectedCard.classList.remove('selected');
        selectedCard = null;
      }
      critiquePanel.classList.remove('visible');
      analysisPanel.classList.remove('visible');
      currentCritique = null;
    }

    // Multi-select functions
    function toggleMultiSelect(card) {
      const index = multiSelectedCards.indexOf(card);
      if (index > -1) {
        // Remove from selection
        multiSelectedCards.splice(index, 1);
        card.classList.remove('multi-selected');
        const badge = card.querySelector('.select-badge');
        if (badge) badge.remove();
      } else {
        // Add to selection
        multiSelectedCards.push(card);
        card.classList.add('multi-selected');
        const badge = document.createElement('div');
        badge.className = 'select-badge';
        badge.textContent = multiSelectedCards.length;
        card.appendChild(badge);
      }
      // Update all badges to reflect current order
      updateMultiSelectBadges();
      updateComparePanel();
    }

    function updateMultiSelectBadges() {
      multiSelectedCards.forEach((card, index) => {
        const badge = card.querySelector('.select-badge');
        if (badge) {
          badge.textContent = index + 1;
        }
      });
    }

    function clearMultiSelect() {
      multiSelectedCards.forEach(card => {
        card.classList.remove('multi-selected');
        const badge = card.querySelector('.select-badge');
        if (badge) badge.remove();
      });
      multiSelectedCards = [];
      updateComparePanel();
    }

    // Comparison panel functions
    function updateComparePanel() {
      if (multiSelectedCards.length >= 2) {
        showComparePanel();
      } else {
        hideComparePanel();
      }
    }

    function showComparePanel() {
      compareCount.textContent = `${multiSelectedCards.length} variants`;
      renderCompareColumns();
      comparePanel.classList.add('visible');
    }

    function hideComparePanel() {
      comparePanel.classList.remove('visible');
    }

    function renderCompareColumns() {
      const showDiff = compareDiffToggle.checked;
      const baselineText = getCardText(multiSelectedCards[0]);

      compareBody.innerHTML = multiSelectedCards.map((card, index) => {
        const tags = Array.from(card.querySelectorAll('.card-tag')).map(t => t.textContent);
        const text = getCardText(card);
        const wordCount = text.split(/\s+/).filter(w => w).length;
        const isSource = card.classList.contains('source');

        let displayText = text;
        if (showDiff && index > 0) {
          displayText = computeDiff(baselineText, text);
        }

        return `
          <div class="compare-column">
            <div class="compare-column-header">
              <div class="compare-column-tags">
                ${tags.map(tag => `<span class="compare-column-tag ${isSource ? 'source' : ''}">${escapeHtml(tag)}</span>`).join('')}
              </div>
              <div class="compare-column-meta">${wordCount} words</div>
            </div>
            <div class="compare-column-content">${showDiff && index > 0 ? displayText : escapeHtml(displayText)}</div>
          </div>
        `;
      }).join('');
    }

    function getCardText(card) {
      return card.dataset.rawText || card.querySelector('.card-content').textContent.trim();
    }

    function downloadCardAsMarkdown(card) {
      const tags = Array.from(card.querySelectorAll('.card-tag')).map(t => t.textContent);
      const text = getCardText(card);
      const isSource = card.classList.contains('source');
      const wordCount = text.split(/\s+/).filter(w => w).length;

      let markdown = `# ${isSource ? 'Source Text' : 'Variant'}\n\n`;
      markdown += `**Tags:** ${tags.join(', ')}\n`;
      markdown += `**Words:** ${wordCount}\n\n`;
      markdown += `---\n\n`;
      markdown += text;
      markdown += `\n\n---\n*Exported from Wordcraft*\n`;

      const filename = isSource
        ? 'source-text.md'
        : `variant-${tags.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '')}.md`;

      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // Compare panel event listeners
    compareClose.addEventListener('click', () => {
      clearMultiSelect();
    });

    compareDiffToggle.addEventListener('change', () => {
      renderCompareColumns();
    });

    // Click on canvas to deselect
    canvasContainer.addEventListener('click', (e) => {
      if (e.target === canvasContainer || e.target === canvas || e.target === emptyState || e.target.closest('.empty-state')) {
        deselectCard();
        clearMultiSelect();
      }
    });

    critiqueClose.addEventListener('click', deselectCard);

    // Card critique
    async function analyzeCard(card) {
      // Use raw text if available (for variants with diff markup), otherwise use textContent
      const content = card.dataset.rawText || card.querySelector('.card-content').textContent;
      critiqueContent.innerHTML = `
        <div class="critique-loading">
          <div class="spinner"></div>
          <span>Analyzing...</span>
        </div>
      `;
      currentCritique = null;

      const prompt = `Analyze this text and provide a critique. Give an overall verdict (good, needs-work, or poor), a one-sentence verdict summary, the key strengths, the weaknesses, concrete suggestions (each with a brief action and a detail on how to implement it), and best_fix — the single most impactful fully rewritten version of the text.

Text to analyze:
${content}`;

      try {
        currentCritique = await callClaudeJson(prompt, { schema: CRITIQUE_SCHEMA, maxTokens: 8192 });
        critiqueCache.set(card.id, currentCritique); // Cache the result
        renderCritique(currentCritique);
      } catch (err) {
        critiqueContent.innerHTML = `<p style="color: var(--accent-error); padding: 20px;">Error: ${escapeHtml(err.message)}</p>`;
      }
    }

    function renderCritique(critique) {
      const verdictIcons = { 'good': '✓', 'needs-work': '◐', 'poor': '✗' };
      const verdictClass = ['good', 'needs-work', 'poor'].includes(critique.verdict) ? critique.verdict : 'needs-work';

      const strengthsHtml = critique.strengths?.length
        ? critique.strengths.map(s => `<li><span class="icon plus">+</span><span>${escapeHtml(s)}</span></li>`).join('')
        : '<li><span class="icon">—</span><span>None identified</span></li>';

      const weaknessesHtml = critique.weaknesses?.length
        ? critique.weaknesses.map(w => `<li><span class="icon minus">−</span><span>${escapeHtml(w)}</span></li>`).join('')
        : '<li><span class="icon">—</span><span>None identified</span></li>';

      const suggestionsHtml = critique.suggestions?.length
        ? critique.suggestions.map((s, i) => `
            <li data-index="${i}">
              <span class="icon arrow">→</span>
              <span><strong>${escapeHtml(s.action)}</strong><br>${escapeHtml(s.detail)}</span>
            </li>
          `).join('')
        : '<li><span class="icon">—</span><span>No suggestions</span></li>';

      critiqueContent.innerHTML = `
        <div class="verdict ${verdictClass}">
          <span class="verdict-icon">${verdictIcons[critique.verdict] || '?'}</span>
          <span class="verdict-text">${escapeHtml(critique.verdict_summary || '')}</span>
        </div>

        <div class="critique-section">
          <h3>Strengths</h3>
          <ul class="critique-list">${strengthsHtml}</ul>
        </div>

        <div class="critique-section">
          <h3>Weaknesses</h3>
          <ul class="critique-list">${weaknessesHtml}</ul>
        </div>

        <div class="critique-section">
          <h3>Suggestions</h3>
          <ul class="critique-list">${suggestionsHtml}</ul>
        </div>
      `;
    }

    function applyBestFix() {
      if (!currentCritique?.best_fix || !selectedCard) return;

      const tags = ['Refined'];
      const card = createCard(tags, currentCritique.best_fix, 'variant');

      const selectedX = parseInt(selectedCard.style.left);
      const selectedY = parseInt(selectedCard.style.top);
      card.style.left = `${selectedX}px`;
      card.style.top = `${selectedY + selectedCard.offsetHeight + 24}px`;

      zoomToFit();
    }

    regenCritiqueBtn.addEventListener('click', () => {
      if (selectedCard) {
        critiqueCache.delete(selectedCard.id); // Clear cache to force re-analysis
        analyzeCard(selectedCard);
      }
    });
    applySuggestionBtn.addEventListener('click', applyBestFix);

    // Card dragging
    function makeDraggable(card) {
      card.addEventListener('mousedown', (e) => {
        // Check if clicking on a resize handle
        if (e.target.classList.contains('resize-handle')) {
          e.stopPropagation();
          resizingCard = card;
          resizeDirection = e.target.dataset.resize;
          resizeStartX = e.clientX;
          resizeStartY = e.clientY;
          resizeStartWidth = card.offsetWidth;
          resizeStartHeight = card.offsetHeight;
          card.classList.add('resizing');
          return;
        }

        // Don't start drag on action buttons
        if (e.target.closest('.card-action-btn') || e.target.closest('.card-actions')) {
          return;
        }

        // Don't start drag on card-content (allows text selection), but still track for click
        if (e.target.classList.contains('card-content')) {
          mouseDownTime = Date.now();
          return;
        }

        e.stopPropagation();
        draggedCard = card;
        isDragging = false;
        mouseDownTime = Date.now();
        draggedCard.classList.add('dragging');
        const rect = card.getBoundingClientRect();
        dragOffsetX = (e.clientX - rect.left) / scale;
        dragOffsetY = (e.clientY - rect.top) / scale;
      });

      card.addEventListener('click', (e) => {
        if (!isDragging && Date.now() - mouseDownTime < 200) {
          e.stopPropagation();
          // Cmd/Ctrl + click for multi-select
          if (e.metaKey || e.ctrlKey) {
            // Clear single selection when starting multi-select
            if (selectedCard && multiSelectedCards.length === 0) {
              deselectCard();
            }
            toggleMultiSelect(card);
          } else {
            // Normal click - clear multi-select and do single select
            if (multiSelectedCards.length > 0) {
              clearMultiSelect();
            }
            selectCard(card);
          }
        }
      });
    }

    // Create card. opts ({id, x, y, width, height}) is used when restoring a
    // saved canvas so ids and positions survive a reload.
    function createCard(tags, content, type = 'variant', opts = {}) {
      if (opts.id) {
        const num = parseInt(String(opts.id).replace('card-', ''), 10);
        if (!isNaN(num)) cardCount = Math.max(cardCount, num);
      } else {
        cardCount++;
      }
      emptyState.style.display = 'none';

      const card = document.createElement('div');
      card.className = `card ${type}`;
      card.id = opts.id || `card-${cardCount}`;
      card.style.left = `${opts.x != null ? opts.x : nextCardX}px`;
      card.style.top = `${opts.y != null ? opts.y : nextCardY}px`;
      if (opts.width) card.style.width = `${opts.width}px`;
      if (opts.height) card.style.height = `${opts.height}px`;
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px)';

      const tagsHtml = tags.map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('');

      card.innerHTML = `
        <div class="card-actions">
          <button class="card-action-btn copy-btn" title="Copy to clipboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="card-action-btn download-btn" title="Download as Markdown">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          <button class="card-action-btn delete-btn" title="Delete card">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="card-header">${tagsHtml}</div>
        <div class="card-content">${escapeHtml(content)}</div>
        <div class="resize-handle resize-handle-e" data-resize="e"></div>
        <div class="resize-handle resize-handle-s" data-resize="s"></div>
        <div class="resize-handle resize-handle-se" data-resize="se"></div>
      `;

      canvas.appendChild(card);
      makeDraggable(card);

      // Setup card action buttons
      const copyBtn = card.querySelector('.copy-btn');
      const downloadBtn = card.querySelector('.download-btn');
      const deleteBtn = card.querySelector('.delete-btn');

      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = getCardText(card);
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 1500);
        });
      });

      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadCardAsMarkdown(card);
      });

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCard(card);
      });

      // Animate in
      requestAnimationFrame(() => {
        card.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      });

      if (!opts.id) {
        // Position next card
        nextCardX += 360;
        if (nextCardX > 1100) {
          nextCardX = 80;
          nextCardY += 300;
        }

        // Show hint
        canvasHint.classList.add('visible');
        setTimeout(() => canvasHint.classList.remove('visible'), 2000);
      }

      return card;
    }

    function deleteCard(card) {
      // Snapshot the card and the connections touching it before removing
      // anything, so the "Undo" toast action can fully restore it.
      const snapshot = {
        id: card.id,
        classes: Array.from(card.classList).filter(c => !TRANSIENT_CLASSES.includes(c)),
        tags: Array.from(card.querySelectorAll('.card-tag')).map(t => t.textContent),
        text: getCardText(card),
        diffHtml: card.dataset.diffHtml || null,
        viewMode: card.dataset.viewMode || 'text',
        x: parseInt(card.style.left) || 0,
        y: parseInt(card.style.top) || 0,
        width: card.style.width ? parseInt(card.style.width) : null,
        height: card.style.height ? parseInt(card.style.height) : null,
        analysis: analysisByCard.get(card.id) || null
      };
      const removedConnections = connections
        .filter(conn => conn.from === card.id || conn.to === card.id)
        .map(conn => ({ from: conn.from, to: conn.to }));

      if (selectedCard === card) deselectCard();
      const msIndex = multiSelectedCards.indexOf(card);
      if (msIndex > -1) {
        multiSelectedCards.splice(msIndex, 1);
        updateMultiSelectBadges();
        updateComparePanel();
      }
      if (currentSourceCard === card) currentSourceCard = null;
      critiqueCache.delete(card.id);
      analysisByCard.delete(card.id);
      for (let i = connections.length - 1; i >= 0; i--) {
        if (connections[i].from === card.id || connections[i].to === card.id) {
          connections.splice(i, 1);
        }
      }
      card.remove();
      updateConnections();
      if (!canvas.querySelector('.card')) emptyState.style.display = '';

      showToast('Card deleted', {
        tone: 'info',
        duration: 6000,
        actionLabel: 'Undo',
        onAction: () => undoDeleteCard(snapshot, removedConnections)
      });
    }

    // Recreate a card that was just deleted (via the "Undo" toast action).
    // If a new card has since taken the same id (ids only ever grow, so this
    // is unlikely), fall back to a fresh id.
    function undoDeleteCard(snapshot, removedConnections) {
      const idTaken = !!document.getElementById(snapshot.id);
      const data = idTaken ? Object.assign({}, snapshot, { id: null }) : snapshot;
      const card = materializeCard(data);

      removedConnections.forEach(conn => {
        connections.push({
          from: conn.from === snapshot.id ? card.id : conn.from,
          to: conn.to === snapshot.id ? card.id : conn.to
        });
      });

      requestAnimationFrame(() => {
        updateConnections();
        zoomToFit();
      });
    }

    // Create SVG container for arrows
    const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgContainer.classList.add('connection-arrow');
    svgContainer.style.width = '20000px';
    svgContainer.style.height = '20000px';
    svgContainer.style.position = 'absolute';
    svgContainer.style.top = '0';
    svgContainer.style.left = '0';
    canvas.insertBefore(svgContainer, canvas.firstChild);

    // Draw connection arrow between two cards
    function drawConnection(fromCard, toCard) {
      const fromRect = {
        x: parseInt(fromCard.style.left),
        y: parseInt(fromCard.style.top),
        width: fromCard.offsetWidth,
        height: fromCard.offsetHeight
      };
      const toRect = {
        x: parseInt(toCard.style.left),
        y: parseInt(toCard.style.top),
        width: toCard.offsetWidth,
        height: toCard.offsetHeight
      };

      // Calculate connection points (from right edge of source to left edge of target)
      const fromX = fromRect.x + fromRect.width;
      const fromY = fromRect.y + fromRect.height / 2;
      const toX = toRect.x;
      const toY = toRect.y + toRect.height / 2;

      // Create line element
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', fromX);
      line.setAttribute('y1', fromY);
      line.setAttribute('x2', toX - 8); // Leave room for arrowhead
      line.setAttribute('y2', toY);
      line.dataset.from = fromCard.id;
      line.dataset.to = toCard.id;

      // Create arrowhead
      const arrowHead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      const arrowSize = 8;
      arrowHead.setAttribute('points', `${toX},${toY} ${toX - arrowSize},${toY - arrowSize / 2} ${toX - arrowSize},${toY + arrowSize / 2}`);
      arrowHead.dataset.from = fromCard.id;
      arrowHead.dataset.to = toCard.id;

      svgContainer.appendChild(line);
      svgContainer.appendChild(arrowHead);
    }

    // Update all connection arrows (called when cards move)
    function updateConnections() {
      // Clear existing arrows
      while (svgContainer.firstChild) {
        svgContainer.removeChild(svgContainer.firstChild);
      }

      // Redraw all connections
      for (const conn of connections) {
        const fromCard = document.getElementById(conn.from);
        const toCard = document.getElementById(conn.to);
        if (fromCard && toCard) {
          drawConnection(fromCard, toCard);
        }
      }
    }

    // Add source to canvas and trigger analysis
    async function addSourceToCanvas() {
      const text = sourceText.value.trim();
      if (!text) {
        showToast('Please enter some source text', { tone: 'error' });
        return;
      }

      // Create source card
      currentSourceCard = createCard(['Source'], text, 'source');
      zoomToFit();

      // Show generation panel in sidebar; analysis panel comes via analyzeSource
      generationPanel.classList.add('visible');

      addSourceBtn.disabled = true;
      try {
        await analyzeSource(currentSourceCard);
      } finally {
        addSourceBtn.disabled = false;
      }
    }

    // Analyze a source card's text and store the result persistently on the
    // card (survives reloads via serializeCanvas). Reused by addSourceToCanvas
    // and by selecting a source card that has no stored analysis yet.
    async function analyzeSource(card) {
      const text = getCardText(card);

      analysisPanel.classList.add('visible');
      currentAnalysis = null;
      selectedSuggestions = [];
      suggestionsList.innerHTML = '';
      generateFromSuggestionBtn.disabled = true;
      analysisContent.innerHTML = `
        <div class="critique-loading">
          <div class="spinner"></div>
          <span>Analyzing your text...</span>
        </div>
      `;

      try {
        const prompt = `Analyze this text and provide feedback. Identify the tone (casual, neutral, or formal), the audience it seems written for, the intent (inform, persuade, entertain, instruct, or inspire), a one-sentence summary of what it is about, and three concrete improvement suggestions — each with a brief action title, a detail on how to implement it, and a specific prompt_instruction for rewriting.

Text to analyze:
${text}`;

        const analysis = await callClaudeJson(prompt, { schema: ANALYSIS_SCHEMA });
        analysisByCard.set(card.id, analysis);
        wlog('analysis generated and stored for', card.id);
        if (currentSourceCard === card) {
          currentAnalysis = analysis;
          renderAnalysis(analysis);
        }
        scheduleSave();
      } catch (err) {
        analysisContent.innerHTML = `<p style="color: var(--accent-error); padding: 20px;">Error: ${escapeHtml(err.message)}</p>`;
      }
    }

    // Close analysis panel
    function closeAnalysisPanel() {
      analysisPanel.classList.remove('visible');
      selectedSuggestions = [];
    }

    analysisClose.addEventListener('click', closeAnalysisPanel);

    // Render analysis results
    function renderAnalysis(analysis) {
      analysisContent.innerHTML = `
        <div class="analysis-result">
          <div class="analysis-meta">
            <span class="analysis-tag">${escapeHtml(analysis.tone)}</span>
            <span class="analysis-tag">${escapeHtml(analysis.audience)}</span>
            <span class="analysis-tag">${escapeHtml(analysis.intent)}</span>
          </div>
          <p class="analysis-summary">${escapeHtml(analysis.summary)}</p>
        </div>
      `;

      // Render suggestions with checkboxes
      if (analysis.suggestions && analysis.suggestions.length > 0) {
        suggestionsList.innerHTML = analysis.suggestions.map((s, i) => `
          <div class="suggestion-item" data-index="${i}">
            <div class="suggestion-checkbox"></div>
            <div class="suggestion-content">
              <div class="suggestion-action">${escapeHtml(s.action)}</div>
              <div class="suggestion-detail">${escapeHtml(s.detail)}</div>
            </div>
          </div>
        `).join('');

        // Add click handlers for suggestions (toggle selection)
        suggestionsList.querySelectorAll('.suggestion-item').forEach(item => {
          item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            const suggestion = currentAnalysis.suggestions[index];

            // Toggle selection
            if (item.classList.contains('selected')) {
              item.classList.remove('selected');
              selectedSuggestions = selectedSuggestions.filter(s => s !== suggestion);
            } else {
              item.classList.add('selected');
              selectedSuggestions.push(suggestion);
            }

            // Enable button if any suggestions selected
            generateFromSuggestionBtn.disabled = selectedSuggestions.length === 0;
          });
        });
      }
    }

    // Add the Text/Diff view toggle to a card header (idempotent).
    function addDiffToggle(card) {
      const header = card.querySelector('.card-header');
      if (!header || header.querySelector('.view-toggle')) return;

      const toggleDiv = document.createElement('div');
      toggleDiv.className = 'view-toggle';
      toggleDiv.innerHTML = `
        <button class="toggle-text active" data-mode="text">Text</button>
        <button class="toggle-diff" data-mode="diff">Diff</button>
      `;
      header.appendChild(toggleDiv);

      toggleDiv.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const mode = btn.dataset.mode;
          const cardEl = btn.closest('.card');
          const content = cardEl.querySelector('.card-content');
          toggleDiv.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (mode === 'diff') {
            content.innerHTML = cardEl.dataset.diffHtml;
          } else {
            content.textContent = cardEl.dataset.rawText;
          }
          cardEl.dataset.viewMode = mode;
        });
      });
    }

    // Turn a placeholder "generating" card into a finished variant card with
    // raw text, a diff against baselineText, and the view toggle.
    function finishVariantCard(card, baselineText, result) {
      card.classList.remove('generating');
      card.classList.add('variant');
      card.dataset.rawText = result;
      card.dataset.diffHtml = computeDiff(baselineText, result);
      card.dataset.viewMode = 'text';
      card.querySelector('.card-content').textContent = result;
      addDiffToggle(card);
    }

    // Build the generation request from the CURRENT sidebar parameters plus any
    // selected analysis suggestions — the two compose rather than being
    // either/or, so you can match suggestions AND tone in one variant.
    function buildGenerationRequest(text) {
      const tone = parseInt(toneSlider.value);
      const length = parseInt(lengthSlider.value);
      const complexity = parseInt(complexitySlider.value);

      let prompt = buildParamPrompt(text, tone, length, complexity, audienceSelect.value, intentSelect.value);
      let tags = [toneLabel(tone), complexityLabel(complexity), audienceSelect.value];

      if (selectedSuggestions.length > 0) {
        const instructions = selectedSuggestions.map((s, i) => `${i + 1}. ${s.prompt_instruction}`).join('\n');
        prompt = prompt.replace(
          'Provide ONLY the rewritten text, no explanations or preamble.',
          `Additionally, apply ALL of these improvements in the same coherent rewrite:\n${instructions}\n\nProvide ONLY the rewritten text, no explanations or preamble.`
        );
        tags = selectedSuggestions.map(s => s.action).concat(tags).slice(0, 5);
      }

      return { prompt, tags, maxTokens: length > 20 ? 8192 : 4096 };
    }

    // Generate from selected suggestions (multiple)
    async function generateFromSuggestions() {
      if (selectedSuggestions.length === 0 || !currentSourceCard) return;

      const text = sourceText.value.trim();

      // Suggestions compose with the current parameter sliders/selects.
      const { prompt, tags, maxTokens } = buildGenerationRequest(text);
      const card = createCard(tags, 'Generating', 'generating');

      // Store connection for arrow
      connections.push({ from: currentSourceCard.id, to: card.id });
      zoomToFit();

      generateFromSuggestionBtn.disabled = true;

      try {
        const contentEl = card.querySelector('.card-content');
        const result = await streamClaude(prompt, {
          maxTokens,
          onText: (soFar) => { contentEl.textContent = soFar; }
        });
        finishVariantCard(card, text, result);

        requestAnimationFrame(() => {
          updateConnections();
          zoomToFit();
        });
      } catch (err) {
        card.classList.remove('generating');
        card.classList.add('error');
        card.querySelector('.card-content').textContent = `Error: ${err.message}`;
        requestAnimationFrame(updateConnections);
      } finally {
        generateFromSuggestionBtn.disabled = selectedSuggestions.length === 0;
      }
    }

    generateFromSuggestionBtn.addEventListener('click', generateFromSuggestions);

    // Find or create source card for given text
    function getOrCreateSourceCard(text) {
      // Check if we already have a source card with this text
      const existingSource = Array.from(canvas.querySelectorAll('.card.source')).find(card => {
        const content = card.querySelector('.card-content');
        return content && content.textContent.trim() === text.trim();
      });

      if (existingSource) {
        return existingSource;
      }

      // Create new source card
      return createCard(['Source'], text, 'source');
    }

    // Generate variant
    async function generateVariant() {
      const text = sourceText.value.trim();
      if (!text) {
        showToast('Please enter some source text', { tone: 'error' });
        return;
      }

      // Use existing source card or create one
      const sourceCard = currentSourceCard || getOrCreateSourceCard(text);

      // Parameters and any selected suggestions compose into one request.
      const { prompt, tags, maxTokens } = buildGenerationRequest(text);

      const card = createCard(tags, 'Generating', 'generating');

      // Store connection for arrow
      connections.push({ from: sourceCard.id, to: card.id });

      zoomToFit();

      generateBtn.disabled = true;

      try {
        const contentEl = card.querySelector('.card-content');
        const result = await streamClaude(prompt, {
          maxTokens,
          onText: (soFar) => { contentEl.textContent = soFar; }
        });
        finishVariantCard(card, text, result);

        // Update connection arrows after card content is set
        requestAnimationFrame(() => {
          updateConnections();
          zoomToFit();
        });
      } catch (err) {
        card.classList.remove('generating');
        card.classList.add('error');
        card.querySelector('.card-content').textContent = `Error: ${err.message}`;
        // Still update arrows even on error
        requestAnimationFrame(updateConnections);
      } finally {
        generateBtn.disabled = false;
      }
    }

    // Export to Markdown
    const exportBtn = document.getElementById('exportBtn');

    function exportToMarkdown() {
      const cards = canvas.querySelectorAll('.card');
      if (cards.length === 0) {
        showToast('No cards to export. Add some text to the canvas first.', { tone: 'error' });
        return;
      }

      // Group cards by source
      const sourceCards = [];
      const variantCards = [];

      cards.forEach(card => {
        if (card.classList.contains('source')) {
          sourceCards.push(card);
        } else {
          variantCards.push(card);
        }
      });

      // Build markdown content
      let markdown = `# Wordcraft Session Export\n\n`;
      markdown += `*Exported on ${new Date().toLocaleString()}*\n\n`;
      markdown += `---\n\n`;

      // Process each source card and its variants
      sourceCards.forEach((sourceCard, sourceIndex) => {
        const sourceContent = sourceCard.querySelector('.card-content').textContent.trim();
        const sourceTags = Array.from(sourceCard.querySelectorAll('.card-tag')).map(t => t.textContent);
        const sourceWordCount = sourceContent.split(/\s+/).filter(w => w).length;

        markdown += `## Source ${sourceCards.length > 1 ? sourceIndex + 1 : ''}\n\n`;
        if (sourceTags.length > 0 && sourceTags[0] !== 'Source') {
          markdown += `**Tags:** ${sourceTags.join(', ')}\n\n`;
        }
        markdown += `*${sourceWordCount} words*\n\n`;
        markdown += `${sourceContent}\n\n`;

        // Find variants connected to this source
        const sourceId = sourceCard.id;
        const connectedVariants = connections
          .filter(conn => conn.from === sourceId)
          .map(conn => document.getElementById(conn.to))
          .filter(card => card && !card.classList.contains('source'));

        if (connectedVariants.length > 0) {
          markdown += `### Variants\n\n`;

          connectedVariants.forEach((variantCard, variantIndex) => {
            const tags = Array.from(variantCard.querySelectorAll('.card-tag')).map(t => t.textContent);
            const rawText = variantCard.dataset.rawText || variantCard.querySelector('.card-content').textContent.trim();
            const wordCount = rawText.split(/\s+/).filter(w => w).length;

            markdown += `#### ${variantIndex + 1}. ${tags.join(' + ')}\n\n`;
            markdown += `*${wordCount} words*\n\n`;
            markdown += `${rawText}\n\n`;
          });
        }

        markdown += `---\n\n`;
      });

      // Also include any orphaned variants (not connected to a source)
      const connectedVariantIds = new Set(connections.map(c => c.to));
      const orphanedVariants = variantCards.filter(card => !connectedVariantIds.has(card.id));

      if (orphanedVariants.length > 0) {
        markdown += `## Other Variants\n\n`;

        orphanedVariants.forEach((variantCard, variantIndex) => {
          const tags = Array.from(variantCard.querySelectorAll('.card-tag')).map(t => t.textContent);
          const rawText = variantCard.dataset.rawText || variantCard.querySelector('.card-content').textContent.trim();
          const wordCount = rawText.split(/\s+/).filter(w => w).length;

          markdown += `### ${variantIndex + 1}. ${tags.join(' + ')}\n\n`;
          markdown += `*${wordCount} words*\n\n`;
          markdown += `${rawText}\n\n`;
        });
      }

      // Create and download the file
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `wordcraft-export-${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    exportBtn.addEventListener('click', exportToMarkdown);

    // Event listeners
    generateBtn.addEventListener('click', () => requireApiKey(generateVariant));
    addSourceBtn.addEventListener('click', () => requireApiKey(addSourceToCanvas));

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape to clear selection
      if (e.key === 'Escape') {
        if (multiSelectedCards.length > 0) {
          clearMultiSelect();
        } else if (selectedCard) {
          deselectCard();
        }
      }
    });

    /* =======================================================================
       Canvas persistence — the canvas (cards, connections, source text) is
       serialized to localStorage on change and restored on load, so a page
       refresh no longer loses the session.
       ===================================================================== */

    const STORAGE_KEY = 'wordcraft_canvas_v1';
    const TRANSIENT_CLASSES = ['card', 'dragging', 'resizing', 'selected', 'multi-selected', 'generating'];

    function serializeCanvas() {
      const cards = [];
      canvas.querySelectorAll('.card').forEach(card => {
        if (card.classList.contains('generating')) return; // skip in-flight placeholders
        cards.push({
          id: card.id,
          classes: Array.from(card.classList).filter(c => !TRANSIENT_CLASSES.includes(c)),
          tags: Array.from(card.querySelectorAll('.card-tag')).map(t => t.textContent),
          text: getCardText(card),
          diffHtml: card.dataset.diffHtml || null,
          viewMode: card.dataset.viewMode || 'text',
          x: parseInt(card.style.left) || 0,
          y: parseInt(card.style.top) || 0,
          width: card.style.width ? parseInt(card.style.width) : null,
          height: card.style.height ? parseInt(card.style.height) : null,
          analysis: analysisByCard.get(card.id) || null
        });
      });
      const cardIds = new Set(cards.map(c => c.id));
      return {
        version: 1,
        cards,
        connections: connections.filter(c => cardIds.has(c.from) && cardIds.has(c.to)),
        cardCount,
        nextCardX,
        nextCardY,
        sourceText: sourceText.value,
        currentSourceCardId: currentSourceCard ? currentSourceCard.id : null
      };
    }

    function saveCanvasState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeCanvas()));
      } catch (e) {
        // localStorage may be full or unavailable; persistence is best-effort
      }
    }

    let saveTimer = null;
    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveCanvasState, 400);
    }

    // Recreate a card DOM element from a snapshot shaped like serializeCanvas()'s
    // per-card entries: {id, classes, tags, text, diffHtml, viewMode, x, y,
    // width, height}. Shared by restoreCanvasState() (page load) and
    // undoDeleteCard() (the delete-toast "Undo" action).
    function materializeCard(data) {
      const type = (data.classes && data.classes[0]) || 'variant';
      const card = createCard(data.tags || [], data.text || '', type, {
        id: data.id, x: data.x, y: data.y, width: data.width, height: data.height
      });
      (data.classes || []).slice(1).forEach(c => card.classList.add(c));
      if (data.analysis) analysisByCard.set(card.id, data.analysis);
      card.dataset.rawText = data.text || '';
      if (data.diffHtml) {
        card.dataset.diffHtml = data.diffHtml;
        card.dataset.viewMode = data.viewMode || 'text';
        addDiffToggle(card);
        if (data.viewMode === 'diff') {
          card.querySelector('.card-content').innerHTML = data.diffHtml;
          const toggle = card.querySelector('.view-toggle');
          toggle.querySelector('.toggle-text').classList.remove('active');
          toggle.querySelector('.toggle-diff').classList.add('active');
        }
      }
      return card;
    }

    function restoreCanvasState() {
      let saved;
      try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      } catch (e) {
        return false;
      }
      if (!saved || !Array.isArray(saved.cards) || saved.cards.length === 0) return false;

      sourceText.value = saved.sourceText || '';

      for (const data of saved.cards) {
        materializeCard(data);
      }

      connections.push(...(saved.connections || []));
      cardCount = Math.max(cardCount, saved.cardCount || 0);
      if (typeof saved.nextCardX === 'number') nextCardX = saved.nextCardX;
      if (typeof saved.nextCardY === 'number') nextCardY = saved.nextCardY;
      currentSourceCard = (saved.currentSourceCardId && document.getElementById(saved.currentSourceCardId))
        || canvas.querySelector('.card.source');
      if (currentSourceCard || sourceText.value.trim()) {
        generationPanel.classList.add('visible');
      }
      const restoredAnalysis = currentSourceCard && analysisByCard.get(currentSourceCard.id);
      if (restoredAnalysis) {
        currentAnalysis = restoredAnalysis;
        renderAnalysis(restoredAnalysis);
        analysisPanel.classList.add('visible');
        wlog('analysis restored from saved session for', currentSourceCard.id);
      }
      wlog(`session restored: ${saved.cards.length} cards, ${(saved.connections || []).length} connections`);

      requestAnimationFrame(() => {
        updateConnections();
        zoomToFit();
      });
      return true;
    }

    function clearCanvas() {
      showToast('Clear the canvas and saved session?', {
        tone: 'error',
        duration: 6000,
        actionLabel: 'Confirm clear',
        onAction: () => performClearCanvas()
      });
    }

    function performClearCanvas() {
      deselectCard();
      clearMultiSelect();
      canvas.querySelectorAll('.card').forEach(card => card.remove());
      connections.length = 0;
      critiqueCache.clear();
      currentSourceCard = null;
      currentAnalysis = null;
      cardCount = 0;
      nextCardX = 80;
      nextCardY = 80;
      emptyState.style.display = '';
      updateConnections();
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      scale = 1;
      panX = 0;
      panY = 0;
      updateCanvasTransform();
    }

    document.getElementById('clearBtn').addEventListener('click', clearCanvas);

    // Persist on any canvas change (card add/remove/move/resize/content) and
    // on source-text edits.
    new MutationObserver(scheduleSave).observe(canvas, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
    sourceText.addEventListener('input', scheduleSave);

    // Initialize
    updateCanvasTransform();
    restoreCanvasState();
