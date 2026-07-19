    // API Key management
    const MODEL_OPTIONS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'];
    const DEFAULT_MODEL = 'claude-opus-4-8';

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
    const RETRYABLE_STATUSES = [429, 500, 502, 503, 529];
    const MAX_RETRIES = 3;
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

    // Exponential backoff between retries, abortable via signal.
    function backoffDelay(attempt, signal) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000 * Math.pow(2, attempt - 1));
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

    async function anthropicRequest(body, signal) {
      const headers = anthropicHeaders();
      const started = Date.now();

      let lastError;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          wlog(`retrying request (attempt ${attempt + 1}/${MAX_RETRIES + 1})`, lastError && lastError.message);
          await backoffDelay(attempt, signal);
        }

        let response;
        try {
          response = await fetch(API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal
          });
        } catch (err) {
          if (err.name === 'AbortError') { wlog('request aborted', body.model); throw err; }
          lastError = new Error('Network error — check your connection');
          continue;
        }

        if (response.ok) {
          const data = await response.json();
          wlog(`${body.model} → ${data.stop_reason} in ${Date.now() - started}ms`,
            data.usage ? `(${data.usage.input_tokens} in / ${data.usage.output_tokens} out)` : '');
          return data;
        }

        const error = await response.json().catch(() => ({}));
        lastError = new Error(error.error?.message || `API request failed (${response.status})`);
        wlog(`request failed: HTTP ${response.status}`, lastError.message);
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

    // Structured-output sibling of callClaude(): pass opts.schema and get the
    // parsed object back. The response's first text block is guaranteed valid
    // JSON, so JSON.parse is the fast path (parseJson falls back to a loose
    // extraction only if parsing fails). A response cut off by max_tokens is
    // retried once with double the budget — a truncated JSON body is useless.
    async function callClaudeJson(prompt, opts = {}) {
      const baseTokens = opts.maxTokens || 4096;

      const attempt = async (tokens) => {
        const body = applyOutputSchema({
          model: opts.model || getModel(),
          max_tokens: tokens,
          messages: [{ role: 'user', content: prompt }]
        }, opts.schema);
        const data = await anthropicRequest(body, opts.signal);
        const text = extractText(data);
        if (!text) throw new Error('The model returned an empty response');
        return { text, truncated: data.stop_reason === 'max_tokens' };
      };

      let result = await attempt(baseTokens);
      if (result.truncated) {
        const retryTokens = Math.min(baseTokens * 2, 16000);
        wlog(`JSON response truncated at ${baseTokens} tokens — retrying with ${retryTokens}`);
        result = await attempt(retryTokens);
        if (result.truncated) {
          wlog('JSON response still truncated after retry — parsing may fail');
        }
      }
      return parseJson(result.text);
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
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) await backoffDelay(attempt, signal);

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
          continue;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let full = '';
        let receivedBytes = false;

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

        if (!full) throw new Error('The model returned an empty response');
        wlog(`stream complete: ${full.length} chars`);
        return full;
      }
      throw lastError;
    }
