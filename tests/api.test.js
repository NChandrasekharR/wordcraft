'use strict';

// Unit tests for the pure parts of js/api.js — Node built-ins only.
// The network path (fetch + SSE) is exercised by the e2e harness against a
// mocked API; these cover request shape, cache keys, prefix gates, stream
// accumulation and pricing.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODEL_OPTIONS, DEFAULT_MODEL, CHEAP_MODEL, MODEL_PRICING, EFFORT, FALLBACK_BETA,
  WORKSPACE_ID_RE, explainApiError,
  resolveModel, webSearchTool, usageCost, extractText,
  cachedUserTurn, buildRequestBody, anthropicHeaders, cachePrefixInfo, prefixGateKey,
  apiGateFor, createMessageAccumulator, mergeSegments,
} = require('../js/api.js');

const LONG = 'The quick brown fox jumps over the lazy dog. '.repeat(60); // ~2700 chars

// ---------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------

test('models: current generation, Opus 5.5 by default, Haiku 5.5 for scoring', () => {
  assert.deepEqual(MODEL_OPTIONS, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  assert.equal(DEFAULT_MODEL, 'claude-opus-5-5');
  assert.equal(CHEAP_MODEL, 'claude-haiku-5-5');
  for (const m of MODEL_OPTIONS) assert.ok(MODEL_PRICING[m], `${m} is priced`);
});

test('resolveModel: keeps current picks, maps saved picks to the same tier, defaults otherwise', () => {
  assert.equal(resolveModel('claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(resolveModel('claude-opus-4-8'), 'claude-opus-5-5');
  assert.equal(resolveModel('claude-sonnet-5'), 'claude-sonnet-5-5');
  assert.equal(resolveModel('claude-haiku-4-5'), 'claude-haiku-5-5');
  assert.equal(resolveModel(null), DEFAULT_MODEL);
  assert.equal(resolveModel('nonsense'), DEFAULT_MODEL);
});

test('webSearchTool: dynamic filtering on Opus/Sonnet 5.5, basic tool on Haiku 5.5', () => {
  assert.equal(webSearchTool('claude-opus-5-5').type, 'web_search_20260209');
  assert.equal(webSearchTool('claude-sonnet-5-5').type, 'web_search_20260209');
  assert.equal(webSearchTool('claude-haiku-5-5').type, 'web_search_20250305');
  assert.equal(webSearchTool('claude-opus-5-5').name, 'web_search');
  assert.equal(webSearchTool('claude-opus-5-5', 2).max_uses, 2);
});

// ---------------------------------------------------------------------------
// request body + headers
// ---------------------------------------------------------------------------

test('buildRequestBody: streams, pins effort, puts the schema in output_config', () => {
  const body = buildRequestBody({
    model: 'claude-haiku-5-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }],
    schema: { type: 'object' }, maxTokens: 4096, effort: EFFORT.score,
  });
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.output_config.effort, 'low');
  assert.deepEqual(body.output_config.format, { type: 'json_schema', schema: { type: 'object' } });
  assert.equal(body.system, 'sys');
  // Never sends parameters the current models reject.
  for (const k of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice']) assert.ok(!(k in body), k);
});

test('buildRequestBody: effort defaults to medium when a route sets none', () => {
  const body = buildRequestBody({ model: 'claude-opus-5-5', messages: [], maxTokens: 10 });
  assert.equal(body.output_config.effort, EFFORT.standard);
  assert.equal(EFFORT.standard, 'medium');
});

test('buildRequestBody: refusal fallback on Opus/Sonnet 5.5 only', () => {
  const mk = model => buildRequestBody({ model, messages: [], maxTokens: 10 });
  assert.equal(mk('claude-opus-5-5').fallbacks, 'default');
  assert.equal(mk('claude-sonnet-5-5').fallbacks, 'default');
  assert.ok(!('fallbacks' in mk('claude-haiku-5-5')));
});

// Minimal Web Storage stand-ins for the browser-only getters.
function withStorage(local, session, fn) {
  global.localStorage = { getItem: k => (k in local ? local[k] : null) };
  global.sessionStorage = { getItem: k => (k in session ? session[k] : null) };
  try { return fn(); } finally { delete global.localStorage; delete global.sessionStorage; }
}

test('anthropicHeaders: beta header only when the body opts into fallbacks', () => {
  withStorage({ anthropic_api_key: 'sk-ant-test' }, {}, () => {
    const withFb = anthropicHeaders(buildRequestBody({ model: 'claude-opus-5-5', messages: [], maxTokens: 1 }));
    const without = anthropicHeaders(buildRequestBody({ model: 'claude-haiku-5-5', messages: [], maxTokens: 1 }));
    assert.equal(withFb['anthropic-beta'], FALLBACK_BETA);
    assert.equal(FALLBACK_BETA, 'server-side-fallback-2026-07-01');
    assert.ok(!('anthropic-beta' in without));
    assert.equal(withFb['x-api-key'], 'sk-ant-test');
    assert.ok(!('anthropic-workspace-id' in withFb), 'no workspace header without a workspace ID');
  });
});

test('anthropicHeaders: sends the stored workspace ID (session copy wins, like the key)', () => {
  const body = buildRequestBody({ model: 'claude-haiku-5-5', messages: [], maxTokens: 1 });
  withStorage({ anthropic_api_key: 'k', anthropic_workspace_id: 'wrkspc_01Local' }, {}, () => {
    assert.equal(anthropicHeaders(body)['anthropic-workspace-id'], 'wrkspc_01Local');
  });
  withStorage({ anthropic_api_key: 'k', anthropic_workspace_id: 'wrkspc_01Local' }, { anthropic_workspace_id: 'wrkspc_01Session' }, () => {
    assert.equal(anthropicHeaders(body)['anthropic-workspace-id'], 'wrkspc_01Session');
  });
});

test('WORKSPACE_ID_RE: accepts wrkspc_ IDs, rejects typos and whitespace', () => {
  assert.ok(WORKSPACE_ID_RE.test('wrkspc_01XFDUDYJgAACzvnptvVoYEL'));
  for (const bad of ['', 'wrkspc_', 'wrkspc_01 abc', ' wrkspc_01abc', 'workspace_01abc', 'sk-ant-api03-x']) {
    assert.ok(!WORKSPACE_ID_RE.test(bad), bad);
  }
});

test('explainApiError: workspace errors become in-app instructions; others pass through', () => {
  const unscoped = explainApiError('This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.');
  assert.match(unscoped, /Open API Key and add your workspace ID/);
  assert.match(explainApiError('anthropic-workspace-id header must be a valid workspace ID.'), /workspace ID isn't valid/);
  assert.equal(explainApiError('Overloaded'), 'Overloaded');
});

test('cachedUserTurn: shared text first with the breakpoint, tail after it', () => {
  assert.deepEqual(cachedUserTurn('plain'), { role: 'user', content: 'plain' });
  const turn = cachedUserTurn('tail', 'shared');
  assert.equal(turn.content[0].text, 'shared');
  assert.deepEqual(turn.content[0].cache_control, { type: 'ephemeral' });
  assert.equal(turn.content[1].text, 'tail');
  assert.ok(!turn.content[1].cache_control);
  assert.equal(cachedUserTurn('', 'shared').content.length, 1);
});

// ---------------------------------------------------------------------------
// cache prefix + gate keys
// ---------------------------------------------------------------------------

const bodyFor = (opts = {}) => buildRequestBody({
  model: opts.model || 'claude-opus-5-5',
  system: opts.system || 'You rewrite text.',
  messages: [cachedUserTurn(opts.tail || 'tail A', opts.cached === undefined ? LONG : opts.cached)],
  maxTokens: 100,
  effort: opts.effort || 'low',
});

test('prefixGateKey: same prefix, different tail -> same key', () => {
  const a = prefixGateKey(bodyFor({ tail: 'make it formal' }));
  const b = prefixGateKey(bodyFor({ tail: 'make it shorter' }));
  assert.ok(a);
  assert.equal(a, b);
});

test('prefixGateKey: model, effort, system or shared text change the key', () => {
  const base = prefixGateKey(bodyFor());
  assert.notEqual(prefixGateKey(bodyFor({ model: 'claude-sonnet-5-5' })), base);
  assert.notEqual(prefixGateKey(bodyFor({ effort: 'medium' })), base);
  assert.notEqual(prefixGateKey(bodyFor({ system: 'Other system.' })), base);
  assert.notEqual(prefixGateKey(bodyFor({ cached: LONG + 'x' })), base);
});

test('prefixGateKey: null without a breakpoint or below the cacheable minimum', () => {
  assert.equal(prefixGateKey(bodyFor({ cached: 'short source' })), null);
  const noBreakpoint = buildRequestBody({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: LONG }], maxTokens: 1 });
  assert.equal(prefixGateKey(noBreakpoint), null);
  assert.equal(cachePrefixInfo(noBreakpoint), null);
});

test('apiGateFor: followers wait for the leader to start, then the prefix is warm', async () => {
  const key = 'gate-test-' + Math.random();
  const leader = apiGateFor(key);
  assert.equal(leader.wait, null);
  const follower = apiGateFor(key);
  assert.ok(follower.wait instanceof Promise);
  let released = false;
  follower.wait.then(() => { released = true; });
  await Promise.resolve();
  assert.equal(released, false);
  leader.started();
  await follower.wait;
  assert.equal(released, true);
  assert.equal(apiGateFor(key).wait, null, 'warm prefix: no wait');
});

test('apiGateFor: a leader that fails before starting releases followers and gives up the lead', async () => {
  const key = 'gate-fail-' + Math.random();
  const leader = apiGateFor(key);
  const follower = apiGateFor(key);
  leader.failed();
  await follower.wait;
  assert.equal(apiGateFor(key).wait, null, 'next request leads');
  assert.deepEqual(Object.keys(apiGateFor(null)), ['wait', 'started', 'failed']);
});

// ---------------------------------------------------------------------------
// stream accumulation + text extraction
// ---------------------------------------------------------------------------

const start = (usage = { input_tokens: 10, cache_read_input_tokens: 900, output_tokens: 1 }) =>
  ({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage } });

test('accumulator: rebuilds thinking + text, stop reason and cumulative usage', () => {
  const acc = createMessageAccumulator();
  const changes = [
    start(),
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello ' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'world' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 42 } },
  ].map(e => acc.push(e));
  assert.equal(acc.complete, false);
  acc.push({ type: 'message_stop' });
  assert.equal(acc.complete, true);
  assert.deepEqual(changes.map((c, i) => c ? i : -1).filter(i => i >= 0), [6, 7], 'only text deltas change visible text');
  const msg = acc.message();
  assert.equal(msg.content[0].signature, 'sig');
  assert.equal(acc.text(), 'Hello world');
  assert.equal(msg.stop_reason, 'end_turn');
  assert.equal(msg.usage.output_tokens, 42);
  assert.equal(msg.usage.cache_read_input_tokens, 900);
});

test('accumulator: parses streamed tool input and keeps server tool results', () => {
  const acc = createMessageAccumulator();
  acc.push(start());
  acc.push({ type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} } });
  acc.push({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":' } });
  acc.push({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"wordcraft"}' } });
  acc.push({ type: 'content_block_stop', index: 0 });
  acc.push({ type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 's1', content: [] } });
  acc.push({ type: 'content_block_stop', index: 1 });
  acc.push({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } });
  acc.push({ type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation: { cited_text: 'x' } } });
  acc.push({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Found it.' } });
  const msg = acc.message();
  assert.deepEqual(msg.content[0].input, { query: 'wordcraft' });
  assert.equal(msg.content[1].type, 'web_search_tool_result');
  assert.equal(msg.content[2].citations.length, 1);
});

test('extractText: joins a passage split by citations, breaks around tool use, ignores thinking/fallback', () => {
  assert.equal(extractText({ content: [{ type: 'text', text: 'A cited ' }, { type: 'text', text: 'passage.' }] }), 'A cited passage.');
  assert.equal(extractText({ content: [
    { type: 'text', text: 'Searching.' },
    { type: 'server_tool_use', id: 's', name: 'web_search', input: {} },
    { type: 'web_search_tool_result', content: [] },
    { type: 'text', text: 'Findings.' },
  ] }), 'Searching.\n\nFindings.');
  // A mid-stream refusal fallback continues the same passage.
  assert.equal(extractText({ content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'Partial ' },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    { type: 'text', text: 'continued.' },
  ] }), 'Partial continued.');
  assert.equal(extractText({ content: [{ type: 'thinking', thinking: '' }] }), '');
  assert.equal(extractText(null), '');
});

test('mergeSegments: concatenates a paused turn with its continuation and sums usage', () => {
  const a = { content: [{ type: 'server_tool_use' }], stop_reason: 'pause_turn', usage: { input_tokens: 10, output_tokens: 5 } };
  const b = { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 100 } };
  const m = mergeSegments(a, b);
  assert.equal(m.content.length, 2);
  assert.equal(m.stop_reason, 'end_turn');
  assert.deepEqual(m.usage, { input_tokens: 13, output_tokens: 12, cache_read_input_tokens: 100 });
});

// ---------------------------------------------------------------------------
// pricing
// ---------------------------------------------------------------------------

test('usageCost: prices uncached input, cache writes, cache reads and output separately', () => {
  const usage = { input_tokens: 1e6, cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6, output_tokens: 1e6 };
  // Opus 5.5: $4 in, $5 5-minute write, $0.20 read, $20 out.
  assert.equal(usageCost(usage, 'claude-opus-5-5'), 4 + 5 + 0.2 + 20);
  // A cache hit costs a fraction of uncached input.
  const hit = usageCost({ cache_read_input_tokens: 1e6 }, 'claude-opus-5-5');
  const miss = usageCost({ input_tokens: 1e6 }, 'claude-opus-5-5');
  assert.ok(hit < miss / 10);
});

test('usageCost: Haiku 5.5 long-prompt rate card above 100K tokens; unknown model is 0', () => {
  const short = usageCost({ input_tokens: 100000, output_tokens: 0 }, 'claude-haiku-5-5');
  const long = usageCost({ input_tokens: 100001, output_tokens: 0 }, 'claude-haiku-5-5');
  assert.ok(Math.abs(short - 0.01) < 1e-9);
  assert.ok(long > 4 * short);
  assert.equal(usageCost({ input_tokens: 5 }, 'mystery'), 0);
  assert.equal(usageCost(null, 'claude-opus-5-5'), 0);
});
