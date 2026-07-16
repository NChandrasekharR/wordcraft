    /* =======================================================================
       Measurement layer — the SEMANTIC distance track.

       computeDiffStats() (util.js) measures SURFACE change: word-level LCS.
       That over-counts reordering and under-counts meaning flips ("not").
       This module adds a model-judged MEANING distance: a cheap Haiku judge
       rates how different two texts are in information content, ignoring
       wording, ordering and style. The Controlled Experiment runs both tracks
       side by side so "your edit changed the words" and "your edit changed the
       meaning" become separable verdicts.

       Public contract (other workstreams depend on these exact names):
         semanticDistancePairs(pairs, {signal}) -> Promise<number[]>   (uncached)
         cachedSemanticDistance(pairs, {signal}) -> Promise<number[]>  (cached)
       Both take pairs = [[textA, textB], ...] and resolve distances in 0..1,
       ordered like the input. All pairs are judged in ONE batched API call.
       ===================================================================== */

    const JUDGE_MODEL = 'claude-haiku-4-5';
    const JUDGE_MAX_TOKENS = 1000;
    const JUDGE_MAX_CHARS = 1500;

    // Structured-output schema: one {pair, distance} object per numbered pair.
    // additionalProperties:false + required everywhere keeps the model honest.
    const SEMANTIC_JUDGE_SCHEMA = {
      type: 'object',
      additionalProperties: false,
      required: ['scores'],
      properties: {
        scores: {
          type: 'array',
          description: 'Exactly one entry per numbered pair below.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['pair', 'distance'],
            properties: {
              pair: { type: 'integer', description: 'The 1-based pair number being scored.' },
              distance: {
                type: 'integer',
                description: 'How different the two texts are in MEANING: 0 = same meaning, 100 = entirely different content.',
              },
            },
          },
        },
      },
    };

    // djb2 string hash → stable short key. Same algorithm the experiment pool
    // uses, kept local so measure.js has no cross-file dependency.
    function djb2Hash(str) {
      let h = 5381;
      const s = str == null ? '' : String(str);
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
      }
      return h.toString(36);
    }

    // Order-normalized pair key: hash the sorted pair so key(a,b) === key(b,a).
    // The two baselines in a "noise" pair are interchangeable, so their cached
    // semantic distance must not depend on which one we list first.
    function semanticPairKey(a, b) {
      const x = a == null ? '' : String(a);
      const y = b == null ? '' : String(b);
      const [lo, hi] = x <= y ? [x, y] : [y, x];
      return djb2Hash(lo + ' ' + hi);
    }

    // Truncate a single text for the prompt, flagging when we cut it so the
    // judge (and reader) knows the tail is missing.
    function truncateForJudge(text) {
      const t = text == null ? '' : String(text);
      if (t.length <= JUDGE_MAX_CHARS) return { text: t, truncated: false };
      return { text: t.slice(0, JUDGE_MAX_CHARS), truncated: true };
    }

    // Build the batched judge prompt: instruction + every numbered pair.
    function buildJudgePrompt(pairs) {
      const lines = [];
      lines.push('You are a precise semantic-distance judge.');
      lines.push('');
      lines.push('For each numbered pair of texts below, rate how different the two texts are in MEANING and information content — NOT in wording, ordering, phrasing, or style.');
      lines.push('');
      lines.push('Scale: 0 = the two texts convey the same meaning and the same information; 100 = they convey entirely different content. Two texts that say the same thing in different words score near 0. If a fact is negated, added, dropped, or changed (e.g. inserting or removing "not"), the distance is high even when few words differ.');
      lines.push('');
      lines.push(`Score all ${pairs.length} pair${pairs.length === 1 ? '' : 's'} below. Return exactly one object per pair, using the pair numbers shown.`);
      pairs.forEach(([a, b], idx) => {
        const ta = truncateForJudge(a);
        const tb = truncateForJudge(b);
        lines.push('');
        lines.push(`=== Pair ${idx + 1} ===`);
        lines.push(`Text A${ta.truncated ? ' (truncated)' : ''}:`);
        lines.push(ta.text);
        lines.push(`Text B${tb.truncated ? ' (truncated)' : ''}:`);
        lines.push(tb.text);
      });
      return lines.join('\n');
    }

    // Validate + normalize the judge response into distances in 0..1, ordered
    // to match the input pairs. Throws (so callers can degrade gracefully) if a
    // pair is missing or a distance is out of range.
    function normalizeJudgeScores(scores, count) {
      if (!Array.isArray(scores)) throw new Error('Judge returned no scores array');
      const byPair = new Map();
      for (const s of scores) {
        if (!s || typeof s.pair !== 'number' || typeof s.distance !== 'number') {
          throw new Error('Judge returned a malformed score entry');
        }
        byPair.set(s.pair, s.distance);
      }
      const out = [];
      for (let i = 1; i <= count; i++) {
        if (!byPair.has(i)) throw new Error(`Judge omitted pair ${i}`);
        const d = byPair.get(i);
        if (Number.isNaN(d) || d < 0 || d > 100) {
          throw new Error(`Judge distance out of range for pair ${i}`);
        }
        out.push(Math.max(0, Math.min(1, d / 100)));
      }
      return out;
    }

    // --- API-calling entry point (uncached) ---------------------------------
    // Judges ALL pairs in one batched call. Resolves [] with no API call when
    // there is nothing to judge.
    async function semanticDistancePairs(pairs, opts = {}) {
      if (!Array.isArray(pairs) || pairs.length === 0) return [];
      const prompt = buildJudgePrompt(pairs);
      const result = await callClaudeJson(prompt, {
        model: JUDGE_MODEL,
        maxTokens: JUDGE_MAX_TOKENS,
        schema: SEMANTIC_JUDGE_SCHEMA,
        signal: opts.signal,
      });
      return normalizeJudgeScores(result && result.scores, pairs.length);
    }

    // --- localStorage cache -------------------------------------------------
    // Order-normalized so (a,b) and (b,a) share an entry. Keys are prefixed so
    // an all-digits djb2 hash can never be reordered as an integer property —
    // insertion order is what the LRU-ish cap relies on.
    const SEMANTIC_CACHE_STORE = 'wordcraft_semantic_cache_v1';
    const SEMANTIC_CACHE_CAP = 200;
    const SEMANTIC_CACHE_PREFIX = 'p';

    function loadSemanticCache() {
      try {
        const raw = localStorage.getItem(SEMANTIC_CACHE_STORE);
        const obj = raw ? JSON.parse(raw) : {};
        return (obj && typeof obj === 'object') ? obj : {};
      } catch (e) {
        return {};
      }
    }
    function saveSemanticCache(cache) {
      try {
        // Cap: keep newest SEMANTIC_CACHE_CAP entries in insertion order,
        // dropping the oldest. Prefixed keys preserve insertion order.
        const keys = Object.keys(cache);
        if (keys.length > SEMANTIC_CACHE_CAP) {
          const trimmed = {};
          for (const k of keys.slice(keys.length - SEMANTIC_CACHE_CAP)) trimmed[k] = cache[k];
          cache = trimmed;
        }
        localStorage.setItem(SEMANTIC_CACHE_STORE, JSON.stringify(cache));
      } catch (e) {
        /* quota / serialization errors are non-fatal */
      }
    }

    // Cached sibling of semanticDistancePairs. Only uncached pairs hit the
    // judge; results are written back and the cache is capped.
    async function cachedSemanticDistance(pairs, opts = {}) {
      if (!Array.isArray(pairs) || pairs.length === 0) return [];
      const cache = loadSemanticCache();
      const keys = pairs.map(([a, b]) => SEMANTIC_CACHE_PREFIX + semanticPairKey(a, b));
      const results = new Array(pairs.length);
      const missPairs = [];
      const missIndices = [];
      keys.forEach((k, i) => {
        if (Object.prototype.hasOwnProperty.call(cache, k) && typeof cache[k] === 'number') {
          results[i] = cache[k];
        } else {
          missPairs.push(pairs[i]);
          missIndices.push(i);
        }
      });
      if (missPairs.length) {
        const judged = await semanticDistancePairs(missPairs, opts);
        judged.forEach((v, j) => {
          const idx = missIndices[j];
          results[idx] = v;
          // Re-insert so freshly-touched keys count as newest for the cap.
          delete cache[keys[idx]];
          cache[keys[idx]] = v;
        });
        saveSemanticCache(cache);
      }
      return results;
    }

    // Node shim: export the pure, testable helpers (the API-calling functions
    // need a browser, so they stay out of the shim — like util.js).
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        djb2Hash,
        semanticPairKey,
        truncateForJudge,
        buildJudgePrompt,
        normalizeJudgeScores,
        SEMANTIC_JUDGE_SCHEMA,
        JUDGE_MODEL,
        JUDGE_MAX_CHARS,
      };
    }
