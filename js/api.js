    /* =======================================================================
       API layer — model + key storage and the single request core every
       feature goes through.

       Every request streams (SSE) and is accumulated into a full Message, so
       thinking plus output never runs into an HTTP timeout, and a fan-out of
       requests that share a cacheable prefix can wait for the first one's
       prompt-cache entry instead of each paying full price (see "Prefix
       gates" below).
       ===================================================================== */

    // Models offered in the picker (current generation).
    const MODEL_OPTIONS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
    const DEFAULT_MODEL = 'claude-opus-5-5';
    // Cheap, fast model for the scoring roles (semantic judge, critic, swarm judge).
    const CHEAP_MODEL = 'claude-haiku-5-5';

    // Picks saved before the upgrade keep their tier.
    const LEGACY_MODEL_MAP = {
      'claude-opus-4-8': 'claude-opus-5-5',
      'claude-sonnet-5': 'claude-sonnet-5-5',
      'claude-haiku-4-5': 'claude-haiku-5-5'
    };

    // Single source of truth for $/MTok, used by every cost estimate and the
    // live cost readout. Anthropic first-party list prices. cacheWrite is the
    // 5-minute cache write, cacheRead a cache hit. Haiku 5.5 bills prompts
    // over 100K tokens on a higher rate card (`long`). The last three are the
    // models a server-side refusal fallback can hand a request to.
    const MODEL_PRICING = {
      'claude-opus-5-5': { in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2 },
      'claude-sonnet-5-5': { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
      'claude-haiku-5-5': {
        in: 0.1, out: 0.5, cacheWrite: 0.125, cacheRead: 0.01,
        longPromptOver: 100000, long: { in: 0.5, out: 2.5, cacheWrite: 0.625, cacheRead: 0.05 }
      },
      'claude-opus-5': { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
      'claude-opus-4-8': { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 },
      'claude-sonnet-5': { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 }
    };

    // Effort per kind of call. Thinking is always on for the current models
    // and counts toward max_tokens, so effort is the main lever on latency
    // and cost. Each route pins one value: a different effort renders a
    // different prompt, which would miss the prompt cache.
    const EFFORT = {
      rewrite: 'low',     // short, constrained rewrites the user watches stream in
      score: 'low',       // schema-bound scoring (semantic judge)
      standard: 'medium'  // analysis, critique, swarm and ablation roles
    };

    // Server-side refusal fallback (beta): Opus 5.5 and Sonnet 5.5 re-run a
    // classifier decline on the model Anthropic recommends for that refusal
    // category. Haiku 5.5 has no server-side fallback.
    const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
    const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];

    // Web search with dynamic filtering runs on Opus 5.5 / Sonnet 5.5; other
    // models take the basic tool.
    const DYNAMIC_SEARCH_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
    function webSearchTool(model, maxUses = 4) {
      return {
        type: DYNAMIC_SEARCH_MODELS.includes(model) ? 'web_search_20260209' : 'web_search_20250305',
        name: 'web_search',
        max_uses: maxUses
      };
    }

    function resolveModel(stored) {
      if (MODEL_OPTIONS.includes(stored)) return stored;
      return LEGACY_MODEL_MAP[stored] || DEFAULT_MODEL;
    }

    function getModel() {
      return resolveModel(localStorage.getItem('wordcraft_model'));
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

    // Workspace ID for keys that aren't scoped to one workspace: the API then
    // requires an anthropic-workspace-id header. Stored next to the key, with
    // the same remember-on-this-device choice.
    const WORKSPACE_ID_RE = /^wrkspc_[A-Za-z0-9]+$/;
    function getWorkspaceId() {
      try {
        const sessionId = sessionStorage.getItem('anthropic_workspace_id');
        if (sessionId) return sessionId;
      } catch (e) {
        // sessionStorage may be unavailable (e.g. private browsing); fall through
      }
      return localStorage.getItem('anthropic_workspace_id') || '';
    }

    // Turn API errors the user can fix in Wordcraft into instructions.
    function explainApiError(message) {
      if (/not scoped to a workspace/i.test(message)) {
        return 'This API key isn\'t tied to a workspace. Open API Key and add your workspace ID (it starts with wrkspc_), or use a key created inside a workspace.';
      }
      if (/anthropic-workspace-id/i.test(message) && /valid workspace ID/i.test(message)) {
        return 'The workspace ID isn\'t valid. Open API Key and check it; it starts with wrkspc_01.';
      }
      return message;
    }

    // Cost of one response's usage in dollars. Cache writes and reads are
    // priced separately from uncached input. For a server-side fallback the
    // top-level usage covers the attempt that produced the message, priced at
    // the model that produced it.
    function usageCost(usage, model) {
      const base = MODEL_PRICING[model];
      if (!base || !usage) return 0;
      const input = usage.input_tokens || 0;
      const write = usage.cache_creation_input_tokens || 0;
      const read = usage.cache_read_input_tokens || 0;
      const p = base.long && input + write + read > base.longPromptOver ? base.long : base;
      return (input * p.in + write * p.cacheWrite + read * p.cacheRead + (usage.output_tokens || 0) * p.out) / 1e6;
    }

    // Visible answer text. Adjacent text blocks are one passage (citations
    // split a passage into several blocks); text separated by tool calls or
    // results gets a paragraph break. Thinking blocks and fallback markers
    // don't break a passage.
    function extractText(data) {
      let out = '';
      let gap = false;
      for (const b of (data && data.content) || []) {
        if (!b) continue;
        if (b.type === 'text') {
          if (gap && out) out += '\n\n';
          out += b.text || '';
          gap = false;
        } else if (b.type !== 'thinking' && b.type !== 'redacted_thinking' && b.type !== 'fallback') {
          gap = true;
        }
      }
      return out.trim();
    }

    // ---- request shape ------------------------------------------------------
    const EPHEMERAL = { type: 'ephemeral' };

    // A user turn. `cached` is the shared, stable part of the prompt (source
    // text, brief): it goes first and carries the cache breakpoint, so every
    // request with the same model, system, effort and `cached` text reads it
    // from the prompt cache. `prompt` is the per-request tail.
    function cachedUserTurn(prompt, cached) {
      if (!cached) return { role: 'user', content: prompt };
      const content = [{ type: 'text', text: cached, cache_control: EPHEMERAL }];
      if (prompt) content.push({ type: 'text', text: prompt });
      return { role: 'user', content };
    }

    function buildRequestBody({ model, system, messages, tools, schema, maxTokens, effort }) {
      const body = {
        model,
        max_tokens: maxTokens,
        stream: true,
        output_config: { effort: effort || EFFORT.standard }
      };
      if (schema) body.output_config.format = { type: 'json_schema', schema };
      if (system) body.system = system;
      if (tools) body.tools = tools;
      body.messages = messages;
      if (FALLBACK_MODELS.includes(model)) body.fallbacks = 'default';
      return body;
    }

    // Shared request headers. Throws if no API key is set.
    function anthropicHeaders(body) {
      const apiKey = getApiKey();
      if (!apiKey) throw new Error('Please set your Anthropic API key');
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
      const workspaceId = getWorkspaceId();
      if (workspaceId) headers['anthropic-workspace-id'] = workspaceId;
      if (body && body.fallbacks) headers['anthropic-beta'] = FALLBACK_BETA;
      return headers;
    }

    // ---- prefix gates -------------------------------------------------------
    // A cache entry becomes readable only once the response that writes it
    // starts streaming, so N parallel requests with the same prefix would all
    // pay full price. The first request with a given cacheable prefix goes
    // out at once; requests arriving while it is still in prefill wait for its
    // message_start (or its failure, or API_GATE_WAIT_MS) and then read the
    // entry. Within API_CACHE_WARM_MS of a start, requests go straight out.
    const CACHE_MIN_TOKENS = 512;           // minimum cacheable prefix on the current models
    const API_GATE_WAIT_MS = 15000;
    const API_CACHE_WARM_MS = 4 * 60 * 1000; // inside the 5-minute cache TTL
    const apiGates = new Map();

    function apiHash(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
      return h.toString(36);
    }

    function blockText(content) {
      if (typeof content === 'string') return content;
      return (content || []).map(b => b.text || '').join('');
    }

    // Everything up to and including the first cache breakpoint, as a stable
    // string, plus its text length. null when the body has no breakpoint.
    function cachePrefixInfo(body) {
      const msgs = body.messages || [];
      for (let i = 0; i < msgs.length; i++) {
        const content = msgs[i].content;
        if (!Array.isArray(content)) continue;
        const j = content.findIndex(b => b && b.cache_control);
        if (j === -1) continue;
        const head = content.slice(0, j + 1);
        const earlier = msgs.slice(0, i);
        const chars = blockText(body.system) + earlier.map(m => blockText(m.content)).join('') + blockText(head);
        const key = JSON.stringify([body.model, body.output_config, body.system || '', body.tools || null, earlier, head]);
        return { key, chars: chars.length };
      }
      return null;
    }

    // Gate key, or null when the prefix is too short to cache. ~4 characters
    // per token for English; newer tokenizers produce more tokens per
    // character, so this estimate errs low.
    function prefixGateKey(body) {
      const info = cachePrefixInfo(body);
      if (!info || info.chars / 4 < CACHE_MIN_TOKENS) return null;
      return apiHash(info.key);
    }

    function apiGateFor(key) {
      const none = { wait: null, started() {}, failed() {} };
      if (!key) return none;
      const now = Date.now();
      for (const [k, g] of apiGates) if (!g.pending && g.warmUntil < now) apiGates.delete(k);
      const markWarm = () => {
        const g = apiGates.get(key);
        if (g && !g.pending) g.warmUntil = Date.now() + API_CACHE_WARM_MS;
      };
      const existing = apiGates.get(key);
      if (existing && existing.pending) return { wait: existing.ready, started: markWarm, failed() {} };
      if (existing && existing.warmUntil > now) return { wait: null, started: markWarm, failed() {} };
      let release;
      const gate = { pending: true, warmUntil: 0, ready: new Promise(r => (release = r)) };
      apiGates.set(key, gate);
      return {
        wait: null,
        started() {
          gate.pending = false;
          gate.warmUntil = Date.now() + API_CACHE_WARM_MS;
          release();
        },
        failed() {
          if (!gate.pending) return;
          gate.pending = false;
          if (apiGates.get(key) === gate) apiGates.delete(key);
          release();
        }
      };
    }

    function abortError() { return new DOMException('Aborted', 'AbortError'); }

    // Resolve when `promise` settles or after `ms`; reject if `signal` aborts.
    function apiWaitFor(promise, ms, signal) {
      return new Promise((resolve, reject) => {
        if (signal && signal.aborted) return reject(abortError());
        const finish = () => {
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => { clearTimeout(timer); reject(abortError()); };
        const timer = setTimeout(finish, ms);
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        promise.then(finish);
      });
    }

    // ---- stream accumulation -------------------------------------------------
    // Folds SSE events into a full Message (content blocks, stop reason,
    // usage). push() returns true when visible text changed.
    function createMessageAccumulator() {
      let msg = null;
      let complete = false;
      const partialJson = {};
      return {
        push(evt) {
          switch (evt.type) {
            case 'message_start':
              msg = Object.assign({}, evt.message, { content: [], usage: Object.assign({}, evt.message && evt.message.usage) });
              return false;
            case 'content_block_start':
              msg.content[evt.index] = Object.assign({}, evt.content_block);
              return !!(evt.content_block && evt.content_block.type === 'text' && evt.content_block.text);
            case 'content_block_delta': {
              const b = msg.content[evt.index];
              const d = evt.delta || {};
              if (!b) return false;
              if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; return true; }
              if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
              else if (d.type === 'signature_delta') b.signature = d.signature;
              else if (d.type === 'input_json_delta') partialJson[evt.index] = (partialJson[evt.index] || '') + d.partial_json;
              else if (d.type === 'citations_delta') (b.citations || (b.citations = [])).push(d.citation);
              return false;
            }
            case 'content_block_stop':
              if (partialJson[evt.index] != null) {
                try { msg.content[evt.index].input = JSON.parse(partialJson[evt.index] || '{}'); } catch (e) { /* keep the start-block input */ }
                delete partialJson[evt.index];
              }
              return false;
            case 'message_delta':
              Object.assign(msg, evt.delta);
              if (evt.usage) Object.assign(msg.usage, evt.usage);
              return false;
            case 'message_stop':
              complete = true;
              return false;
            default:
              return false;
          }
        },
        get complete() { return complete; },
        message() { return msg; },
        text() { return msg ? extractText(msg) : ''; }
      };
    }

    // Read an SSE body, calling onEvent(parsed) per data event. Cancels the
    // stream (which stops generation) if onEvent throws.
    async function readSse(stream, onEvent) {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { finished = true; break; }
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const data = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
            if (!data || data === '[DONE]') continue;
            let evt;
            try { evt = JSON.parse(data); } catch (e) { continue; }
            onEvent(evt);
          }
        }
      } finally {
        if (!finished) reader.cancel().catch(() => {});
      }
    }

    // ---- request core ----------------------------------------------------------
    const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504, 529];
    const MAX_RETRIES = 3;
    const IDLE_TIMEOUT_MS = 120000; // abort an attempt after this long with no bytes
    const MAX_RETRY_AFTER_MS = 30000;
    const MAX_PAUSE_RESUMES = 3;
    const DEFAULT_MAX_TOKENS = 8192;
    const API_URL = 'https://api.anthropic.com/v1/messages';

    // Exponential backoff between retries (or the server's retry-after hint,
    // capped), abortable via signal.
    function backoffDelay(attempt, signal, retryAfterMs) {
      return new Promise((resolve, reject) => {
        if (signal && signal.aborted) return reject(abortError());
        const wait = retryAfterMs != null ? retryAfterMs : 1000 * Math.pow(2, attempt - 1);
        const timer = setTimeout(resolve, wait);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(abortError());
          }, { once: true });
        }
      });
    }

    // retry-after is in seconds; returns ms (capped) or null when absent.
    function retryAfterMs(response) {
      const v = parseFloat(response.headers.get('retry-after'));
      return Number.isFinite(v) && v >= 0 ? Math.min(v * 1000, MAX_RETRY_AFTER_MS) : null;
    }

    // Per-attempt abort: follows the caller's signal and fires after
    // IDLE_TIMEOUT_MS without a byte (kick() resets the clock).
    function attemptController(signal) {
      const ctl = new AbortController();
      const onAbort = () => ctl.abort(abortError());
      if (signal && signal.aborted) onAbort();
      else if (signal) signal.addEventListener('abort', onAbort, { once: true });
      let timer = null;
      return {
        signal: ctl.signal,
        kick() {
          clearTimeout(timer);
          timer = setTimeout(() => ctl.abort(new DOMException('Timed out', 'TimeoutError')), IDLE_TIMEOUT_MS);
        },
        done() {
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
        }
      };
    }

    // One HTTP request, streamed. Retries with backoff while nothing has been
    // shown to the user; once text has reached onText, a failure is final
    // (replaying would show different text). opts.onText(fullTextSoFar)
    // receives visible text as it streams; opts.onStart() fires on
    // message_start.
    async function anthropicRequest(body, signal, opts = {}) {
      const { onText, onStart } = opts;
      const headers = anthropicHeaders(body);
      const gate = apiGateFor(prefixGateKey(body));
      try {
        if (gate.wait) await apiWaitFor(gate.wait, API_GATE_WAIT_MS, signal);

        let lastError;
        let waitMs = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (attempt > 0) await backoffDelay(attempt, signal, waitMs);
          waitMs = null;

          const ctl = attemptController(signal);
          let response;
          try {
            ctl.kick();
            response = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
          } catch (err) {
            ctl.done();
            if (signal && signal.aborted) throw abortError();
            gate.failed();
            lastError = new Error(err.name === 'TimeoutError' ? 'The request timed out' : 'Network error — check your connection');
            continue;
          }

          if (!response.ok) {
            ctl.done();
            gate.failed();
            const error = await response.json().catch(() => ({}));
            lastError = new Error(explainApiError((error.error && error.error.message) || `API request failed (${response.status})`));
            if (!RETRYABLE_STATUSES.includes(response.status)) throw lastError;
            waitMs = retryAfterMs(response);
            continue;
          }

          const acc = createMessageAccumulator();
          let shown = false;
          let refused = false;
          try {
            await readSse(response.body, evt => {
              ctl.kick();
              if (evt.type === 'error') {
                // Errors can arrive mid-stream (e.g. overloaded_error) over an
                // HTTP 200. Partial text must not be passed off as complete.
                throw new Error(`API error mid-response: ${(evt.error && evt.error.message) || 'unknown error'}`);
              }
              const changed = acc.push(evt);
              if (evt.type === 'message_start') {
                gate.started();
                if (onStart) onStart();
              } else if (evt.type === 'message_delta' && evt.delta && evt.delta.stop_reason === 'refusal') {
                refused = true;
                throw new Error('The model declined this request');
              }
              if (changed && onText) {
                shown = true;
                onText(acc.text());
              }
            });
          } catch (err) {
            if (signal && signal.aborted) throw abortError();
            gate.failed();
            if (refused || shown) throw err.name === 'TimeoutError' ? new Error('The response stalled and was cut off') : err;
            lastError = err.name === 'TimeoutError' ? new Error('The request timed out') : err;
            continue;
          } finally {
            ctl.done();
          }

          if (!acc.complete) {
            const cut = new Error('The response was cut off before it finished (connection interrupted)');
            if (shown) throw cut;
            gate.failed();
            lastError = cut;
            continue;
          }
          return acc.message();
        }
        throw lastError;
      } finally {
        gate.failed(); // no-op once started; releases waiters if this request never started
      }
    }

    // Combine a paused turn with its continuation.
    function mergeSegments(a, b) {
      const usage = Object.assign({}, a.usage);
      for (const [k, v] of Object.entries(b.usage || {})) {
        if (typeof v === 'number') usage[k] = (usage[k] || 0) + v;
      }
      return Object.assign({}, b, { content: (a.content || []).concat(b.content || []), usage });
    }

    // One logical call. A server-tool turn (web search) that the API pauses
    // with stop_reason "pause_turn" is resumed by sending the paused
    // assistant turn back unchanged; the returned message carries the content
    // of every segment and their summed usage.
    async function requestMessage(spec, opts = {}) {
      const { system, prompt, cached } = typeof spec === 'string' ? { prompt: spec } : spec;
      const model = opts.model || getModel();
      const base = [cachedUserTurn(prompt, cached)];
      let merged = null;
      for (let i = 0; ; i++) {
        const messages = merged ? [...base, { role: 'assistant', content: merged.content }] : base;
        const body = buildRequestBody({
          model,
          system,
          messages,
          tools: opts.tools,
          schema: opts.schema,
          maxTokens: opts.maxTokens || DEFAULT_MAX_TOKENS,
          effort: opts.effort
        });
        const data = await anthropicRequest(body, opts.signal, { onText: opts.onText, onStart: opts.onStart });
        merged = merged ? mergeSegments(merged, data) : data;
        if (data.stop_reason !== 'pause_turn' || i >= MAX_PAUSE_RESUMES) return merged;
      }
    }

    function responseText(data) {
      const text = extractText(data);
      if (!text) {
        throw new Error(data.stop_reason === 'max_tokens'
          ? 'The response ran out of tokens before it produced any text'
          : 'The model returned an empty response');
      }
      if (data.stop_reason === 'max_tokens') {
        console.warn('Wordcraft: the response hit the token limit and may be truncated');
      }
      return text;
    }

    // Text call. `spec` is a prompt string or { system, cached, prompt }
    // (see cachedUserTurn). opts: model, effort, maxTokens, signal, onText,
    // onStart.
    async function callClaude(spec, opts = {}) {
      return responseText(await requestMessage(spec, opts));
    }

    // Structured-output sibling of callClaude(): pass opts.schema and get the
    // parsed object back. The response's text is guaranteed valid JSON, so
    // JSON.parse is the fast path (parseJson falls back to a loose extraction
    // only if parsing fails).
    async function callClaudeJson(spec, opts = {}) {
      return parseJson(responseText(await requestMessage(spec, opts)));
    }

    // Rewrite that streams into the UI: callClaude with opts.onText.
    function streamClaude(spec, opts = {}) {
      return callClaude(spec, opts);
    }

    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        MODEL_OPTIONS, DEFAULT_MODEL, CHEAP_MODEL, MODEL_PRICING, EFFORT, FALLBACK_BETA,
        WORKSPACE_ID_RE, explainApiError,
        resolveModel, webSearchTool, usageCost, extractText,
        cachedUserTurn, buildRequestBody, anthropicHeaders, cachePrefixInfo, prefixGateKey,
        apiGateFor, createMessageAccumulator, mergeSegments
      };
    }
