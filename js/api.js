    // API Key management
    const MODEL_OPTIONS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'];
    const DEFAULT_MODEL = 'claude-opus-4-8';

    // Single source of truth for $/MTok (input / output), used by every cost
    // estimate. Anthropic first-party list prices.
    const MODEL_PRICING = {
      'claude-opus-4-8': { in: 5, out: 25 },
      'claude-sonnet-5': { in: 2, out: 10 },
      'claude-haiku-4-5': { in: 1, out: 5 }
    };

    function getModel() {
      const stored = localStorage.getItem('wordcraft_model');
      return MODEL_OPTIONS.includes(stored) ? stored : DEFAULT_MODEL;
    }

    function getApiKey() {
      try {
        const sessionKey = sessionStorage.getItem('anthropic_api_key');
        if (sessionKey) return sessionKey;
      } catch (e) {
        // sessionStorage may be unavailable (e.g. private browsing); fall through
      }
      return localStorage.getItem('anthropic_api_key') || '';
    }

    // API call. Shared request core with retry/backoff and abort support;
    // callClaude(), callClaudeJson() and callClaudeRaw() all go through it.
    const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504, 529];
    const MAX_RETRIES = 3;
    const REQUEST_TIMEOUT_MS = 180000; // non-streaming calls only
    const MAX_RETRY_AFTER_MS = 30000;
    const API_URL = 'https://api.anthropic.com/v1/messages';

    // Shared request headers. Throws if no API key is set.
    function anthropicHeaders() {
      const apiKey = getApiKey();
      if (!apiKey) throw new Error('Please set your Anthropic API key');
      return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
    }

    // Exponential backoff between retries (or the server's retry-after hint,
    // capped), abortable via signal.
    function backoffDelay(attempt, signal, retryAfterMs) {
      return new Promise((resolve, reject) => {
        if (signal && signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        const wait = retryAfterMs != null ? retryAfterMs : 1000 * Math.pow(2, attempt - 1);
        const timer = setTimeout(resolve, wait);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        }
      });
    }

    // Attach a structured-output schema to a request body so the model returns
    // valid JSON as its first text block (Anthropic structured outputs).
    function applyOutputSchema(body, schema) {
      if (schema) body.output_config = { format: { type: 'json_schema', schema } };
      return body;
    }

    // retry-after is in seconds; returns ms (capped) or null when absent.
    function retryAfterMs(response) {
      const v = parseFloat(response.headers.get('retry-after'));
      return Number.isFinite(v) && v >= 0 ? Math.min(v * 1000, MAX_RETRY_AFTER_MS) : null;
    }

    // Caller's signal plus a per-attempt timeout (where AbortSignal.any exists).
    function withTimeout(signal) {
      if (typeof AbortSignal === 'undefined' || !AbortSignal.any || !AbortSignal.timeout) return signal;
      const t = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      return signal ? AbortSignal.any([signal, t]) : t;
    }

    async function anthropicRequest(body, signal) {
      const headers = anthropicHeaders();

      let lastError;
      let waitMs = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) await backoffDelay(attempt, signal, waitMs);
        waitMs = null;

        let response;
        try {
          response = await fetch(API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: withTimeout(signal)
          });
        } catch (err) {
          if (signal && signal.aborted) throw err; // the caller cancelled
          lastError = new Error(err.name === 'TimeoutError' ? 'The request timed out' : 'Network error — check your connection');
          continue;
        }

        if (response.ok) {
          const data = await response.json();
          if (data.stop_reason === 'refusal') throw new Error('The model declined this request');
          return data;
        }

        const error = await response.json().catch(() => ({}));
        lastError = new Error(error.error?.message || `API request failed (${response.status})`);
        if (!RETRYABLE_STATUSES.includes(response.status)) throw lastError;
        waitMs = retryAfterMs(response);
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

    // Structured-output sibling of callClaude(): pass opts.schema and get the
    // parsed object back. The response's first text block is guaranteed valid
    // JSON, so JSON.parse is the fast path (parseJson falls back to a loose
    // extraction only if parsing fails).
    async function callClaudeJson(prompt, opts = {}) {
      const body = applyOutputSchema({
        model: opts.model || getModel(),
        max_tokens: opts.maxTokens || 4096,
        messages: [{ role: 'user', content: prompt }]
      }, opts.schema);

      const data = await anthropicRequest(body, opts.signal);
      const text = extractText(data);
      if (!text) throw new Error('The model returned an empty response');
      if (data.stop_reason === 'max_tokens') {
        console.warn('Wordcraft: the response hit the token limit and may be truncated');
      }
      return parseJson(text);
    }

    // Streaming rewrite call. Streams Server-Sent Events, invoking
    // onText(fullTextSoFar) as text_delta chunks arrive, and resolves with the
    // final text. Retries with backoff ONLY while no bytes have been received;
    // once the stream has started, errors fail through.
    async function streamClaude(prompt, opts = {}) {
      const { maxTokens = 4096, signal, onText } = opts;
      const headers = anthropicHeaders();
      const body = {
        model: getModel(),
        max_tokens: maxTokens,
        stream: true,
        messages: [{ role: 'user', content: prompt }]
      };

      let lastError;
      let waitMs = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) await backoffDelay(attempt, signal, waitMs);
        waitMs = null;

        let response;
        try {
          response = await fetch(API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal
          });
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          lastError = new Error('Network error — check your connection');
          continue;
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          lastError = new Error(error.error?.message || `API request failed (${response.status})`);
          if (!RETRYABLE_STATUSES.includes(response.status)) throw lastError;
          waitMs = retryAfterMs(response);
          continue;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let full = '';
        let receivedBytes = false;
        let sawMessageStop = false;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedBytes = true;
            buffer += decoder.decode(value, { stream: true });

            let sep;
            while ((sep = buffer.indexOf('\n\n')) !== -1) {
              const rawEvent = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              const dataStr = rawEvent
                .split('\n')
                .filter(l => l.startsWith('data:'))
                .map(l => l.slice(5).trim())
                .join('');
              if (!dataStr || dataStr === '[DONE]') continue;

              let evt;
              try { evt = JSON.parse(dataStr); } catch (e) { continue; }

              if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
                full += evt.delta.text;
                if (onText) onText(full);
              } else if (evt.type === 'message_delta' && evt.delta && evt.delta.stop_reason === 'max_tokens') {
                console.warn('Wordcraft: the response hit the token limit and may be truncated');
              } else if (evt.type === 'message_delta' && evt.delta && evt.delta.stop_reason === 'refusal') {
                throw new Error('The model declined this request');
              } else if (evt.type === 'message_stop') {
                sawMessageStop = true;
              } else if (evt.type === 'error') {
                // Errors can arrive mid-stream (e.g. overloaded_error) over an
                // HTTP 200. Partial text must not be passed off as complete.
                throw new Error(`API error mid-response: ${(evt.error && evt.error.message) || 'unknown error'}`);
              }
            }
          }
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          // Once streaming has started we cannot safely retry (would replay
          // partial text); only retry if nothing arrived yet.
          if (receivedBytes) throw err;
          lastError = err;
          continue;
        }

        if (!sawMessageStop) throw new Error('The response was cut off before it finished (connection interrupted)');
        if (!full) throw new Error('The model returned an empty response');
        return full;
      }
      throw lastError;
    }
