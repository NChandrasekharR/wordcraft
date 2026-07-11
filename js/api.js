    // API Key management
    const MODEL_OPTIONS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'];
    const DEFAULT_MODEL = 'claude-opus-4-8';

    function getModel() {
      const stored = localStorage.getItem('wordcraft_model');
      return MODEL_OPTIONS.includes(stored) ? stored : DEFAULT_MODEL;
    }

    function getApiKey() {
      return localStorage.getItem('anthropic_api_key') || '';
    }

    // API call. Shared request core with retry/backoff and abort support;
    // callClaude() and callClaudeRaw() both go through it.
    const RETRYABLE_STATUSES = [429, 500, 502, 503, 529];
    const MAX_RETRIES = 3;

    async function anthropicRequest(body, signal) {
      const apiKey = getApiKey();
      if (!apiKey) throw new Error('Please set your Anthropic API key');

      let lastError;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 1000 * Math.pow(2, attempt - 1));
            if (signal) {
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              }, { once: true });
            }
          });
        }

        let response;
        try {
          response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(body),
            signal
          });
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          lastError = new Error('Network error — check your connection');
          continue;
        }

        if (response.ok) return response.json();

        const error = await response.json().catch(() => ({}));
        lastError = new Error(error.error?.message || `API request failed (${response.status})`);
        if (!RETRYABLE_STATUSES.includes(response.status)) throw lastError;
      }
      throw lastError;
    }

    async function callClaude(prompt, opts = {}) {
      const data = await anthropicRequest({
        model: getModel(),
        max_tokens: opts.maxTokens || 4096,
        messages: [{ role: 'user', content: prompt }]
      }, opts.signal);

      const text = extractText(data);
      if (!text) throw new Error('The model returned an empty response');
      if (data.stop_reason === 'max_tokens') {
        console.warn('Wordcraft: the response hit the token limit and may be truncated');
      }
      return text;
    }
