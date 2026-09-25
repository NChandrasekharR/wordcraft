// Wordcraft smoke test + bug probes. Serves the repo locally, mocks the
// Anthropic Messages API (routing by structured-output schema / system prompt),
// and drives the real UI in headless Chromium.
//
//   node tests/e2e/smoke.js [scenarioIdPrefix...]      e.g.  node tests/e2e/smoke.js B X02
//
// B** scenarios are core flows: PASS / FAIL (FAIL makes the process exit 1).
// X** scenarios are probes for known bugs (docs/audit-2026-09.md): CONFIRMED
// means the bug is still present, FIXED means the probe no longer reproduces it.
// Env: WORDCRAFT_PORT (default 8123), WORDCRAFT_OUT (default tests/e2e/results/latest),
//      PLAYWRIGHT_PATH / AXE_PATH to override module locations.
function requireFirst(cands) { for (const c of cands) { try { return require(c); } catch (e) {} } throw new Error('Cannot load any of: ' + cands.join(', ')); }
const { chromium } = requireFirst([process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean));
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = process.env.WORDCRAFT_REPO || path.resolve(__dirname, '../..');
const SP = process.env.WORDCRAFT_OUT || path.join(__dirname, 'results', 'latest');
fs.mkdirSync(SP, { recursive: true });
function axePath() { for (const c of [process.env.AXE_PATH, path.join(__dirname, 'node_modules/axe-core/axe.min.js')].filter(Boolean)) if (fs.existsSync(c)) return c; try { return require.resolve('axe-core/axe.min.js'); } catch (e) { return null; } }
const PORT = +(process.env.WORDCRAFT_PORT || 8123);
const BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.argv.slice(2);

// ---------------------------------------------------------------- server
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, BASE).pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(REPO, p);
  if (!f.startsWith(REPO)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- mock API
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const SENTENCES = [
  'Wordcraft turns rewriting into parameter adjustment.',
  'Each variant lands on the canvas as a card you can drag.',
  'The noise baseline shows how much randomness moves the text.',
  'Writers compare drafts side by side before choosing one.',
  'A good edit changes meaning on purpose, not by accident.',
  'Small knobs can have large effects, or none at all.',
  'The experiment names its sample size in every verdict.',
  'Teams learn which settings actually matter for their text.',
];
let seedCounter = 1;
function makeText(marker, nSent = 4) {
  let x = (seedCounter++ * 7919) % 233280;
  const rnd = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  const out = [];
  for (let i = 0; i < nSent; i++) out.push(SENTENCES[Math.floor(rnd() * SENTENCES.length)]);
  return `${marker} ${out.join(' ')}`;
}
function classify(body) {
  const props = (body.output_config && body.output_config.format && body.output_config.format.schema && body.output_config.format.schema.properties) || {};
  const sys = typeof body.system === 'string' ? body.system : '';
  if (props.tone && props.suggestions) return 'analysis';
  if (props.verdict && props.best_fix) return 'critique';
  if (props.scores) return 'judge-semantic';
  if (props.winner && props.reason && !props.ranking) return 'judge-ablation';
  if (props.winner && props.ranking) return 'judge-swarm';
  if (props.score && props.fix_instructions) return 'critic';
  if (props.writers) return 'planner';
  if ((body.tools || []).some(t => /web_search/.test(t.type))) return 'research';
  if (body.stream) return 'rewrite-stream';
  if (/ablation trial/i.test(sys)) return /Editor/.test(sys) ? 'abl-editor' : 'abl-writer';
  if (/Writer in a swarm/.test(sys)) return 'swarm-writer';
  if (/You are the Editor/.test(sys)) return 'swarm-editor';
  return 'rewrite';
}
function knobsMoved(prompt) {
  if (!/Rewrite the following text with these parameters/.test(prompt)) return null;
  const moved = [];
  if (!/Tone: Neutral \(keep similar\)/.test(prompt)) moved.push('tone');
  if (!/Length: Same \(keep similar length\)/.test(prompt)) moved.push('length');
  if (!/Complexity: Moderate \(keep similar complexity\)/.test(prompt)) moved.push('complexity');
  if (!/Audience: general\b/.test(prompt)) moved.push('audience');
  if (!/Intent: inform\b/.test(prompt)) moved.push('intent');
  return moved;
}
function markerFor(prompt) {
  const moved = knobsMoved(prompt);
  if (moved === null) return 'suggestion-sample';
  return moved.length ? `knob-${moved.join('+')}` : 'neutral-sample';
}
const KNOB_DIST = { tone: 62, length: 41, complexity: 16, audience: 9, intent: 74 };
function judgeScores(prompt) {
  const parts = prompt.split(/=== Pair (\d+) ===/).slice(1);
  const scores = [];
  for (let i = 0; i < parts.length; i += 2) {
    const n = +parts[i], blk = parts[i + 1];
    const neutral = (blk.match(/neutral-sample/g) || []).length;
    let d;
    if (neutral >= 2) d = 10 + (n * 7) % 9;
    else { const m = blk.match(/knob-([a-z]+)/); d = m ? (KNOB_DIST[m[1]] ?? 50) : 50; }
    scores.push({ pair: n, distance: d });
  }
  return { scores };
}
function textToAnalyze(prompt) { const m = prompt.split('Text to analyze:\n')[1] || ''; return m.slice(0, 40).replace(/\s+/g, ' ').trim(); }
function jsonMsg(model, text, extra = {}) {
  return { id: 'msg_' + Math.random().toString(36).slice(2), type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 120, output_tokens: 80 }, ...extra };
}
function sse(text, { midstreamError = false } = {}) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  let s = ev('message_start', { type: 'message_start', message: { id: 'msg_s', type: 'message', role: 'assistant', model: 'm', content: [], stop_reason: null, usage: { input_tokens: 50, output_tokens: 1 } } });
  s += ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  const words = text.split(' ');
  const chunks = [];
  for (let i = 0; i < words.length; i += 4) chunks.push(words.slice(i, i + 4).join(' ') + (i + 4 < words.length ? ' ' : ''));
  const upto = midstreamError ? Math.ceil(chunks.length / 3) : chunks.length;
  for (let i = 0; i < upto; i++) s += ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunks[i] } });
  if (midstreamError) return s + ev('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
  s += ev('content_block_stop', { type: 'content_block_stop', index: 0 });
  s += ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } });
  return s + ev('message_stop', { type: 'message_stop' });
}
function defaultResponse(kind, body, prompt, opts) {
  const model = body.model;
  const J = obj => ({ json: jsonMsg(model, JSON.stringify(obj)) });
  switch (kind) {
    case 'analysis': return J({ tone: 'neutral', audience: 'product teams', intent: 'inform', summary: opts.analysisSummary || 'A short explainer about parametric rewriting.', suggestions: [
      { action: 'Tighten the opening', detail: 'Lead with the benefit.', prompt_instruction: 'Rewrite the first sentence to lead with the user benefit.' },
      { action: 'Add an example', detail: 'Show one concrete case.', prompt_instruction: 'Add one concrete example.' },
      { action: 'Cut jargon', detail: 'Replace insider terms.', prompt_instruction: 'Replace jargon with plain words.' }] });
    case 'critique': {
      const who = textToAnalyze(prompt);
      const n = opts.longCritique ? 14 : 2;
      return J({ verdict: 'needs-work', verdict_summary: `Critique of: "${who}"`, strengths: Array.from({ length: n }, (_, i) => `Strength ${i + 1}: clear structure and a confident, readable voice throughout.`), weaknesses: ['Could be more specific.'], suggestions: [{ action: 'Be concrete', detail: 'Add a number.' }], best_fix: `BEST FIX derived from: "${who}"` });
    }
    case 'judge-semantic': return J(judgeScores(prompt));
    case 'judge-ablation': return J({ winner: opts.ablWinner ? opts.ablWinner() : 1, reason: 'Clearer and more persuasive for the brief.' });
    case 'judge-swarm': return J({ winner: 2, rationale: 'Most specific and on-brief.', ranking: [2, 1, 3] });
    case 'critic': return J({ score: 6, weaknesses: ['Vague claim in sentence 2'], fix_instructions: ['Make sentence 2 specific.'] });
    case 'planner': { const n = +((prompt.match(/exactly (\d+) writer/) || [])[1] || 3); return J({ summary: `Plan: ${n} distinct angles.`, research_query: '', writers: Array.from({ length: n }, (_, i) => ({ angle: `Angle ${i + 1}`, instruction: `Write angle ${i + 1}.` })) }); }
    case 'research': return { json: jsonMsg(model, '- Finding one (source: example.com)\n- Finding two (source: example.org)') };
    case 'rewrite-stream': return { sse: sse(opts.rewriteText ? opts.rewriteText(prompt) : makeText(markerFor(prompt), opts.longText ? 22 : 4)) };
    default: return { json: jsonMsg(model, opts.rewriteText ? opts.rewriteText(prompt) : makeText(kind === 'rewrite' ? markerFor(prompt) : kind, opts.longText ? 22 : 4)) };
  }
}
function makeMock(opts = {}) {
  const log = [];
  let n = 0;
  async function handler(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    const kind = classify(body);
    const prompt = body.messages && typeof body.messages[0].content === 'string' ? body.messages[0].content : '';
    const entry = { idx: n++, kind, model: body.model, max_tokens: body.max_tokens, t: Date.now(), prompt, system: typeof body.system === 'string' ? body.system : '', done: false, aborted: false };
    log.push(entry);
    let resp = opts.override ? await opts.override({ body, kind, entry, prompt, log }) : null;
    if (!resp) resp = defaultResponse(kind, body, prompt, opts);
    if (resp.delay) await sleep(resp.delay);
    if (opts.delay) { const d = opts.delay({ kind, entry, prompt }); if (d) await sleep(d); }
    try {
      if (resp.status) await route.fulfill({ status: resp.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: resp.errType || 'api_error', message: resp.message || `mock ${resp.status}` } }) });
      else if (resp.sse) await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: resp.sse });
      else await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(resp.json) });
      entry.done = true;
    } catch (e) { entry.aborted = true; }
  }
  return { log, handler, count: k => log.filter(e => (typeof k === 'function' ? k(e) : e.kind === k)).length };
}

// ---------------------------------------------------------------- helpers
const results = [];
function record(id, name, status, evidence) {
  results.push({ id, name, status, evidence });
  console.log(`[${status}] ${id} ${name}\n        ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
}
const SOURCE = 'Wordcraft is a spatial writing studio. You paste a paragraph, turn a few knobs, and compare the rewrites side by side on a canvas. The goal is to learn which knobs actually change the message.';
async function setKey(page, remember = true) {
  await page.click('#apiKeyBtn');
  await page.fill('#apiKeyInput', 'sk-ant-test-0000');
  if (!remember) await page.uncheck('#apiKeyRemember');
  await page.click('#apiKeySave');
}
async function addSource(page, text = SOURCE) {
  await page.fill('#sourceText', text);
  await page.click('#addSourceBtn');
  await page.waitForSelector('#analysisContent .analysis-result, #analysisContent p', { timeout: 10000 });
}
async function closeAnalysis(page) { if (await page.isVisible('#analysisPanel')) await page.click('#analysisClose'); }
async function generate(page) {
  const before = await page.$$eval('.card', els => els.length);
  await page.click('#generateBtn');
  await page.waitForFunction(n => document.querySelectorAll('.card').length > n && !document.querySelector('.card.generating'), before, { timeout: 15000 });
  return page.evaluate(() => { const c = [...document.querySelectorAll('.card')].pop(); return c.id; });
}
async function setSlider(page, id, v) { await page.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); }, [id, v]); }
async function clickCard(page, id, opts = {}) { await page.click(`#${id} .card-content`, opts); }
async function hoverThenClick(page, cardId, sel) {
  await page.hover(`#${cardId} .card-header`);
  await page.waitForTimeout(400);
  await page.click(`#${cardId} ${sel}`);
}
const zoomText = page => page.textContent('#zoomLevel');

let browser;
async function scenario(id, name, opts, fn) {
  if (ONLY.length && !ONLY.some(p => id.startsWith(p))) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const mock = makeMock(opts);
  await context.route('https://api.anthropic.com/**', mock.handler);
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, headers: { 'content-type': 'text/css' }, body: '' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(BASE);
  try { await fn({ page, context, mock, errors }); }
  catch (e) { record(id, name, 'HARNESS-ERROR', e.message.split('\n')[0]); }
  finally { await context.close(); }
}

// ---------------------------------------------------------------- scenarios
(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  browser = await chromium.launch();

  // ======================= CORE FLOWS (expect PASS) =======================
  await scenario('B01', 'Page load: scripts, no errors', {}, async ({ page, errors }) => {
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ title: document.title, scripts: [...document.scripts].map(x => x.getAttribute('src')), fns: ['escapeHtml', 'callClaude', 'streamClaude', 'cachedSemanticDistance', 'createCard', 'runSwarm', 'runControlledExperiment', 'ablVerdict', 'sensBuildModel'].filter(f => typeof window[f] !== 'function'), empty: getComputedStyle(document.getElementById('emptyState')).display }));
    const ok = s.scripts.length === 8 && s.fns.length === 0 && errors.length === 0 && s.empty !== 'none';
    record('B01', 'Page load', ok ? 'PASS' : 'FAIL', { title: s.title, scripts: s.scripts.length, missingGlobals: s.fns, errors });
  });

  await scenario('B02', 'API key storage (remember vs session-only)', {}, async ({ page }) => {
    await setKey(page, true);
    const a = await page.evaluate(() => ({ ls: !!localStorage.getItem('anthropic_api_key'), ss: !!sessionStorage.getItem('anthropic_api_key'), label: document.getElementById('apiKeyStatus').textContent }));
    await setKey(page, false);
    const b = await page.evaluate(() => ({ ls: !!localStorage.getItem('anthropic_api_key'), ss: !!sessionStorage.getItem('anthropic_api_key') }));
    record('B02', 'API key storage', (a.ls && !a.ss && !b.ls && b.ss) ? 'PASS' : 'FAIL', { remembered: a, sessionOnly: b });
  });

  await scenario('B03', 'Add source + analysis panel', {}, async ({ page, mock }) => {
    await setKey(page); await addSource(page);
    const s = await page.evaluate(() => ({ source: document.querySelectorAll('.card.source').length, tags: document.querySelectorAll('.analysis-tag').length, sugg: document.querySelectorAll('.suggestion-item').length, genPanel: document.getElementById('generationPanel').classList.contains('visible') }));
    record('B03', 'Add source + analysis', (s.source === 1 && s.tags === 3 && s.sugg === 3 && s.genPanel && mock.count('analysis') === 1) ? 'PASS' : 'FAIL', s);
  });

  await scenario('B04', 'Generate Variant: 529 retry -> SSE stream -> Text/Diff toggle; reload restores', {
    override: ({ kind, log }) => (kind === 'rewrite-stream' && log.filter(e => e.kind === 'rewrite-stream').length === 1) ? { status: 529, errType: 'overloaded_error' } : null,
  }, async ({ page, mock, errors }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    const id = await generate(page);
    const card = await page.evaluate(id => { const c = document.getElementById(id); return { cls: c.className, text: c.querySelector('.card-content').textContent.slice(0, 40), hasToggle: !!c.querySelector('.view-toggle') }; }, id);
    await hoverThenClick(page, id, '.toggle-diff');
    const diffSpans = await page.$$eval(`#${id} .card-content span[class^="diff-"]`, e => e.length);
    await page.waitForTimeout(700);
    await page.reload(); await page.waitForTimeout(500);
    const after = await page.evaluate(id => ({ cards: document.querySelectorAll('.card').length, lines: document.querySelectorAll('svg.connection-arrow line').length, diffKept: !!document.querySelector(`#${id} .card-content span[class^="diff-"]`) }), id);
    const ok = mock.count('rewrite-stream') === 2 && /variant/.test(card.cls) && card.hasToggle && diffSpans > 0 && after.cards === 2 && after.lines === 1 && after.diffKept;
    record('B04', 'Generate+retry+diff+persist', ok ? 'PASS' : 'FAIL', { streamRequests: mock.count('rewrite-stream'), card, diffSpans, afterReload: after, errors });
  });

  await scenario('B05', 'Delete -> Undo restores card + connection; Clear is two-step', {}, async ({ page }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    const id = await generate(page);
    await hoverThenClick(page, id, '.delete-btn');
    const gone = await page.evaluate(id => !document.getElementById(id), id);
    await page.click('.toast-action');
    await page.waitForTimeout(300);
    const back = await page.evaluate(id => ({ exists: !!document.getElementById(id), lines: document.querySelectorAll('svg.connection-arrow line').length }), id);
    await page.click('#clearBtn');
    const stillThere = await page.$$eval('.card', e => e.length);
    await page.click('.toast-action:has-text("Confirm clear")');
    await page.waitForTimeout(300);
    const cleared = await page.evaluate(() => ({ cards: document.querySelectorAll('.card').length, stored: localStorage.getItem('wordcraft_canvas_v1') }));
    record('B05', 'Delete/Undo/Clear', (gone && back.exists && back.lines === 1 && stillThere === 2 && cleared.cards === 0 && cleared.stored === null) ? 'PASS' : 'FAIL', { gone, back, beforeConfirm: stillThere, cleared });
  });

  await scenario('B06', 'XSS payloads in source text and model output render inert', {
    analysisSummary: '<img src=z onerror="window.__xss_an=1">summary',
    rewriteText: () => '<script>window.__xss_out=1</script><img src=y onerror="window.__xss_out2=1"> plain words here',
  }, async ({ page }) => {
    await setKey(page); await addSource(page, '<img src=x onerror="window.__xss_src=1"> & <b>bold</b> source');
    await closeAnalysis(page);
    const id = await generate(page);
    await hoverThenClick(page, id, '.toggle-diff');
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ flags: ['__xss_src', '__xss_out', '__xss_out2', '__xss_an'].filter(k => window[k]), imgs: document.querySelectorAll('.card img, .analysis-panel img').length, literal: document.querySelector('.card.source .card-content').textContent.includes('<img') }));
    record('B06', 'XSS inert', (s.flags.length === 0 && s.imgs === 0 && s.literal) ? 'PASS' : 'FAIL', s);
  });

  await scenario('B07', 'Controlled Experiment: cold (3 gen) -> warm (2 gen), two-track verdict', {}, async ({ page, mock }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await setSlider(page, 'toneSlider', 80);
    await page.click('#experimentBtn'); await page.click('#expRun');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('expResult')).display === 'flex', null, { timeout: 15000 });
    const cold = { gen: mock.count('rewrite'), judge: mock.count('judge-semantic'), verdict: await page.textContent('#expVerdict') };
    await page.click('#expRun');
    await page.waitForFunction(() => document.getElementById('expRun').style.display === '' && getComputedStyle(document.getElementById('expResult')).display === 'flex', null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const warm = { gen: mock.count('rewrite') - cold.gen, judge: mock.count('judge-semantic') - cold.judge, verdict: await page.textContent('#expVerdict') };
    const cards = await page.$$eval('.card.variant', e => e.length);
    const ok = cold.gen === 3 && warm.gen === 2 && /Meaning/.test(warm.verdict) && /Wording/.test(warm.verdict) && /3 baseline pairs/.test(warm.verdict) && cards === 2;
    record('B07', 'Controlled Experiment', ok ? 'PASS' : 'FAIL', { cold: { ...cold, verdict: cold.verdict.slice(0, 140) }, warm: { ...warm, verdict: warm.verdict.slice(0, 160) }, experimentCards: cards });
  });

  await scenario('B08', 'Sensitivity Map: 12 gens + judge, chart, zero-cost reopen', {}, async ({ page, mock }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await page.click('#sensitivityBtn'); await page.click('#sensRun');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('sensResult')).display === 'flex', null, { timeout: 20000 });
    const s = await page.evaluate(() => ({ groups: document.querySelectorAll('.sens-knob-group').length, rows: document.querySelectorAll('.sens-row').length, summary: document.getElementById('sensSummary').textContent, foot: document.getElementById('sensChartFoot').textContent }));
    const calls = mock.log.length;
    await page.click('#sensClose'); await page.click('#sensitivityBtn'); await page.waitForTimeout(300);
    const reopen = { newCalls: mock.log.length - calls, note: await page.textContent('#sensStoredNote') };
    const ok = s.groups === 5 && s.rows === 10 && mock.count('rewrite') === 12 && reopen.newCalls === 0;
    record('B08', 'Sensitivity Map', ok ? 'PASS' : 'FAIL', { ...s, gens: mock.count('rewrite'), judgeCalls: mock.count('judge-semantic'), reopen });
  });

  await scenario('B09', 'Ablation Lab (critic factor, 3 trials): blind judging, verdict, cards', {}, async ({ page, mock }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await page.click('#ablBtn'); await page.fill('#ablGoal', 'Persuade skeptical engineers');
    await page.click('#ablStart');
    await page.waitForFunction(() => document.getElementById('ablModal').classList.contains('visible') && document.getElementById('ablResults').style.display === '', null, { timeout: 20000 });
    const s = await page.evaluate(() => ({ verdict: document.getElementById('ablVerdictLine').textContent, bars: document.querySelectorAll('.abl-bar-row').length, ablCards: [...document.querySelectorAll('.card')].filter(c => c.textContent.includes('ablation')).length }));
    const calls = { writers: mock.count('abl-writer'), critics: mock.count('critic'), editors: mock.count('abl-editor'), judges: mock.count('judge-ablation') };
    const ok = s.bars === 2 && s.ablCards === 3 && calls.writers === 6 && calls.critics === 3 && calls.editors === 3 && calls.judges === 3;
    record('B09', 'Ablation Lab', ok ? 'PASS' : 'FAIL', { ...s, calls });
  });

  await scenario('B10', 'Agent Swarm (3 writers, 1 round): plan->write->critic->edit->judge', {}, async ({ page, mock }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await page.click('#swarmBtn'); await page.fill('#swarmGoal', 'Punchy landing-page copy');
    await page.click('#swarmStart');
    await page.waitForFunction(() => document.getElementById('agentPhase').textContent === 'Complete', null, { timeout: 20000 });
    const s = await page.evaluate(() => ({ variants: document.querySelectorAll('.card.variant').length, verdict: document.querySelectorAll('.card.verdict').length, winner: document.querySelectorAll('.card.winner').length, stats: document.getElementById('agentStats').textContent }));
    const calls = ['planner', 'swarm-writer', 'critic', 'swarm-editor', 'judge-swarm'].map(k => `${k}:${mock.count(k)}`).join(' ');
    record('B10', 'Agent Swarm', (s.variants === 3 && s.verdict === 1 && s.winner === 1) ? 'PASS' : 'FAIL', { ...s, calls });
  });

  await scenario('B11', 'Quick Compare (Ctrl+click) + diff; Export Markdown download', {}, async ({ page }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    const a = await generate(page); const b = await generate(page);
    await clickCard(page, a, { modifiers: ['Control'] }); await clickCard(page, b, { modifiers: ['Control'] });
    const cols = await page.$$eval('.compare-column', e => e.length);
    await page.check('#compareDiffToggle');
    const spans = await page.$$eval('.compare-column-content span[class^="diff-"]', e => e.length);
    await page.keyboard.press('Escape');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
    const md = fs.readFileSync(await dl.path(), 'utf8');
    const ok = cols === 2 && spans > 0 && /# Wordcraft Session Export/.test(md) && (md.match(/^#### /gm) || []).length === 2;
    record('B11', 'Compare + Export', ok ? 'PASS' : 'FAIL', { cols, diffSpans: spans, file: dl.suggestedFilename(), variantsInExport: (md.match(/^#### /gm) || []).length });
  });

  // ======================= BUG PROBES (expect CONFIRMED) =======================
  await scenario('X01', 'Leftover merge-conflict marker drops the .abl-cost CSS rule', {}, async ({ page }) => {
    const s = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules]; } catch (e) { return []; } });
      const el = document.getElementById('ablCost'); el.textContent = 'probe';
      document.getElementById('ablModal').classList.add('visible');
      const cs = getComputedStyle(el);
      return { ruleExists: rules.some(r => r.selectorText === '.abl-cost'), nextRuleExists: rules.some(r => r.selectorText === '.abl-results'), fontFamily: cs.fontFamily, fontSize: cs.fontSize };
    });
    record('X01', 'CSS merge marker', (!s.ruleExists && s.nextRuleExists) ? 'CONFIRMED' : 'FIXED', s);
  });

  await scenario('X02', 'Mouse wheel over overlay panels zooms the canvas instead of scrolling', { longCritique: true }, async ({ page }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    const a = await generate(page); const b = await generate(page);
    await clickCard(page, a);
    await page.waitForSelector('#critiqueContent .verdict');
    const box = await page.locator('#critiqueContent').boundingBox();
    const before = { z: await zoomText(page), st: await page.$eval('#critiqueContent', e => e.scrollTop), overflow: await page.$eval('#critiqueContent', e => e.scrollHeight - e.clientHeight) };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400); await page.waitForTimeout(300);
    const after = { z: await zoomText(page), st: await page.$eval('#critiqueContent', e => e.scrollTop) };
    record('X02', 'Wheel over critique panel', (before.overflow > 0 && after.st === 0 && after.z !== before.z) ? 'CONFIRMED' : 'FIXED', { panelOverflowPx: before.overflow, scrollTopBefore: before.st, scrollTopAfter: after.st, zoomBefore: before.z, zoomAfter: after.z });
  });

  await scenario('X03', 'Clicking an in-flight card critiques the placeholder and caches it', {
    delay: ({ kind }) => kind === 'rewrite-stream' ? 1500 : 0,
  }, async ({ page, mock }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await page.click('#generateBtn');
    await page.waitForSelector('.card.generating');
    const id = await page.$eval('.card.generating', e => e.id);
    await clickCard(page, id);
    await page.waitForTimeout(400);
    const whileGenerating = (await page.textContent('#critiqueContent')).trim().slice(0, 60);
    await page.waitForFunction(() => !document.querySelector('.card.generating'), null, { timeout: 10000 });
    await page.click('#critiqueClose');
    await clickCard(page, id);
    await page.waitForSelector('#critiqueContent .verdict', { timeout: 5000 });
    const shown = await page.textContent('#critiqueContent .verdict-text');
    const realText = await page.$eval(`#${id} .card-content`, e => e.textContent.slice(0, 40));
    record('X03', 'Critique of in-flight card', /Generating/.test(shown) ? 'CONFIRMED' : 'FIXED', { critiqueRequests: mock.count('critique'), panelWhileGenerating: whileGenerating, shownAfterCompletion: shown, actualCardText: realText });
  });

  await scenario('X04', 'Critique race: slow response for card A overwrites card B\'s panel; Apply Fix uses A', {
    delay: ({ kind, prompt }) => kind === 'critique' ? (/knob-tone/.test(prompt) ? 1500 : 100) : 0,
  }, async ({ page }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await setSlider(page, 'toneSlider', 80); const a = await generate(page);
    await setSlider(page, 'toneSlider', 0); await setSlider(page, 'lengthSlider', 80); const b = await generate(page);
    await clickCard(page, a); await page.waitForTimeout(150); await clickCard(page, b);
    await page.waitForTimeout(2200);
    const shown = await page.textContent('#critiqueContent .verdict-text');
    const selected = await page.evaluate(() => document.querySelector('.card.selected')?.id);
    const bText = await page.$eval(`#${b} .card-content`, e => e.textContent.slice(0, 20));
    await page.click('#applySuggestionBtn'); await page.waitForTimeout(300);
    const fix = await page.evaluate(() => [...document.querySelectorAll('.card')].pop().querySelector('.card-content').textContent);
    record('X04', 'Critique race', (selected === b && /knob-tone/.test(shown) && /knob-tone/.test(fix)) ? 'CONFIRMED' : 'FIXED', { selectedCard: selected, selectedCardText: bText, panelShows: shown, appliedFix: fix.slice(0, 60) });
  });

  await scenario('X05', 'Edited textarea: variant uses new text but is linked to the old source card', {}, async ({ page, mock }) => {
    await setKey(page); await addSource(page, 'ALPHA source text about apples and orchards.'); await closeAnalysis(page);
    await page.fill('#sourceText', 'BRAVO a completely different paragraph about bridges.');
    const id = await generate(page);
    const s = await page.evaluate(id => ({ lineFrom: document.querySelector(`svg.connection-arrow line[data-to="${id}"]`)?.dataset.from, sources: [...document.querySelectorAll('.card.source')].map(c => ({ id: c.id, text: c.querySelector('.card-content').textContent.slice(0, 20) })) }), id);
    const genPrompt = mock.log.find(e => e.kind === 'rewrite-stream').prompt;
    await page.click('#experimentBtn'); await page.click('#expRun');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('expResult')).display === 'flex', null, { timeout: 15000 });
    const expPrompt = mock.log.find(e => e.kind === 'rewrite').prompt;
    const ok = /BRAVO/.test(genPrompt) && !/ALPHA/.test(genPrompt) && s.sources.length === 1 && /ALPHA/.test(s.sources[0].text) && s.lineFrom === s.sources[0].id && /ALPHA/.test(expPrompt);
    record('X05', 'Source lineage', ok ? 'CONFIRMED' : 'FIXED', { generateVariantRewrote: /BRAVO/.test(genPrompt) ? 'BRAVO (textarea)' : '?', arrowFrom: `${s.lineFrom} (${((s.sources.find(c => c.id === s.lineFrom) || {}).text) || '?'}…)`, sourceCards: s.sources.length, experimentRewrote: /ALPHA/.test(expPrompt) ? 'ALPHA (card)' : '?' });
  });

  await scenario('X06', 'Ablation leaves the shared agent panel titled "Ablation Lab" for later Swarm runs', {}, async ({ page }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await page.click('#ablBtn'); await page.click('#ablStart');
    await page.waitForFunction(() => document.getElementById('ablResults').style.display === '', null, { timeout: 20000 });
    await page.click('#ablCancel');
    await page.click('#swarmBtn'); await page.selectOption('#swarmWriters', '2'); await page.selectOption('#swarmRounds', '0');
    await page.click('#swarmStart');
    await page.waitForFunction(() => document.getElementById('agentPhase').textContent === 'Complete', null, { timeout: 20000 });
    const title = await page.textContent('#agentPanel .critique-header h2');
    record('X06', 'Stale agent panel title', title === 'Ablation Lab' ? 'CONFIRMED' : 'FIXED', { panelTitleDuringSwarm: title });
  });

  await scenario('X07', 'Ablation "research" factor: research fails, arms are identical, verdict still posted', {
    override: ({ kind }) => kind === 'research' ? { status: 400, errType: 'invalid_request_error', message: 'mock: web search unavailable' } : null,
  }, async ({ page, mock }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await page.click('#ablBtn'); await page.selectOption('#ablFactor', 'research'); await page.click('#ablStart');
    await page.waitForFunction(() => document.getElementById('ablResults').style.display === '' || /Error|Stopped/.test(document.getElementById('agentPhase').textContent), null, { timeout: 20000 });
    const writerPrompts = new Set(mock.log.filter(e => e.kind === 'abl-writer').map(e => e.prompt));
    const verdictCard = await page.evaluate(() => [...document.querySelectorAll('.card.verdict')].map(c => c.querySelector('.card-content').textContent.split('\n')[0])[0]);
    const armTags = await page.evaluate(() => [...document.querySelectorAll('.card .card-tag')].map(t => t.textContent).filter(t => /research/.test(t)));
    const logFail = await page.evaluate(() => [...document.querySelectorAll('.agent-entry.fail .agent-msg')].map(e => e.textContent));
    record('X07', 'Ablation with failed research', (verdictCard && /Web research/.test(verdictCard)) ? 'CONFIRMED' : 'FIXED', { writerCalls: mock.count('abl-writer'), distinctWriterPrompts: writerPrompts.size, verdictCard: verdictCard || null, armTags, agentLogFailures: logFail, phase: await page.textContent('#agentPhase') });
  });

  await scenario('X08', 'Mid-stream SSE error: truncated text is saved as a finished variant', {
    override: ({ kind, prompt }) => kind === 'rewrite-stream' ? { sse: sse('ONE two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty END', { midstreamError: true }) } : null,
  }, async ({ page, errors }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    const id = await generate(page);
    const s = await page.evaluate(id => { const c = document.getElementById(id); return { cls: c.className, text: c.querySelector('.card-content').textContent, errorToast: !!document.querySelector('.toast-error') }; }, id);
    record('X08', 'Mid-stream error swallowed', (/variant/.test(s.cls) && !/error/.test(s.cls) && !/END/.test(s.text)) ? 'CONFIRMED' : 'FIXED', { cardClass: s.cls, savedText: s.text, anyErrorUi: s.errorToast, pageErrors: errors });
  });

  await scenario('X09', 'Sensitivity pool keeps spending after the run has already failed', {
    delay: ({ kind }) => kind === 'rewrite' ? 250 : 0,
    override: ({ kind, log }) => (kind === 'rewrite' && log.filter(e => e.kind === 'rewrite').length === 3) ? { status: 400, errType: 'invalid_request_error', message: 'mock: bad request' } : null,
  }, async ({ page, mock }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await page.click('#sensitivityBtn'); await page.click('#sensRun');
    await page.waitForFunction(() => /Error/.test(document.getElementById('sensIntro').textContent), null, { timeout: 15000 });
    const atError = mock.count('rewrite');
    await page.waitForTimeout(3000);
    const total = mock.count('rewrite');
    record('X09', 'Pool fail-fast leak', total > atError ? 'CONFIRMED' : 'FIXED', { requestsWhenErrorShown: atError, requestsAfter3s: total, wastedCallsAfterFailure: total - atError, uiMessage: (await page.textContent('#sensIntro')).slice(0, 60) });
  });

  await scenario('X10', 'Clear during an in-flight generation does not cancel the request', {
    delay: ({ kind }) => kind === 'rewrite-stream' ? 2000 : 0,
  }, async ({ page, mock }) => {
    const failed = [];
    page.on('requestfailed', r => { if (/api\.anthropic\.com/.test(r.url())) failed.push(r.failure() && r.failure().errorText); });
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await page.click('#generateBtn'); await page.waitForSelector('.card.generating');
    await page.click('#clearBtn'); await page.click('.toast-action:has-text("Confirm clear")');
    await page.waitForTimeout(2600);
    const abortedByPage = failed.length > 0;
    record('X10', 'Clear does not abort', abortedByPage ? 'FIXED' : 'CONFIRMED', { abortedByPage, failures: failed, cardsNow: await page.$$eval('.card', e => e.length) });
  });

  await scenario('X11', 'Full localStorage: canvas save fails silently and work is lost on reload', {}, async ({ page }) => {
    await setKey(page);
    await page.waitForTimeout(600); // let the initial empty-canvas save land first
    const filled = await page.evaluate(() => {
      const orig = Storage.prototype.setItem; window.__saveFailures = 0;
      Storage.prototype.setItem = function (k, v) { try { return orig.call(this, k, v); } catch (e) { if (k === 'wordcraft_canvas_v1') window.__saveFailures++; throw e; } };
      let i = 0; for (const size of [1 << 20, 1 << 16, 1 << 12, 1 << 8]) { const s = 'x'.repeat(size); try { while (true) orig.call(localStorage, 'junk_' + (i++), s); } catch (e) {} } return i;
    });
    await addSource(page, SOURCE + ' ' + 'More detail. '.repeat(40)); await closeAnalysis(page);
    await page.waitForTimeout(800);
    const s = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('wordcraft_canvas_v1') || '{"cards":[]}'); return { storedCards: c.cards.length, saveFailures: window.__saveFailures, cardsOnScreen: document.querySelectorAll('.card').length, toasts: [...document.querySelectorAll('.toast-message')].map(t => t.textContent) }; });
    await page.reload(); await page.waitForTimeout(400);
    const cardsAfterReload = await page.$$eval('.card', e => e.length);
    record('X11', 'Silent persistence failure', (s.saveFailures > 0 && s.cardsOnScreen > 0 && cardsAfterReload === 0 && s.toasts.length === 0) ? 'CONFIRMED' : 'FIXED', { junkKeys: filled, ...s, cardsAfterReload });
  });

  await scenario('X12', 'A remembered API key cannot be removed from the UI', {}, async ({ page }) => {
    await setKey(page, true);
    await page.click('#apiKeyBtn'); await page.fill('#apiKeyInput', ''); await page.click('#apiKeySave');
    const s = await page.evaluate(() => ({ stillStored: !!localStorage.getItem('anthropic_api_key'), modalStillOpen: document.getElementById('apiKeyModal').classList.contains('visible'), status: document.getElementById('apiKeyStatus').textContent, anyFeedback: !!document.querySelector('.toast') }));
    record('X12', 'No way to forget key', (s.stillStored && s.modalStillOpen && !s.anyFeedback) ? 'CONFIRMED' : 'FIXED', s);
  });

  await scenario('X13', 'Suggestion selection desyncs after closing the Analysis panel', {}, async ({ page, mock }) => {
    await setKey(page); await addSource(page);
    await page.click('.suggestion-item >> nth=0');
    await page.click('#analysisClose');
    const src = await page.$eval('.card.source', e => e.id);
    await clickCard(page, src); await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ panelVisible: document.getElementById('analysisPanel').classList.contains('visible'), itemLooksSelected: document.querySelector('.suggestion-item').classList.contains('selected'), buttonEnabled: !document.getElementById('generateFromSuggestionBtn').disabled }));
    const cardsBefore = await page.$$eval('.card', e => e.length);
    if (s.buttonEnabled) { await page.click('#generateFromSuggestionBtn'); await page.waitForTimeout(500); }
    const cardsAfter = await page.$$eval('.card', e => e.length);
    record('X13', 'Suggestion desync', (s.panelVisible && s.itemLooksSelected && s.buttonEnabled && cardsAfter === cardsBefore && mock.count('rewrite-stream') === 0) ? 'CONFIRMED' : 'FIXED', { ...s, clickProducedCard: cardsAfter > cardsBefore, requestsSent: mock.count('rewrite-stream') });
  });

  await scenario('X14', 'Modals: Escape does not close them; focus is not trapped; no dialog semantics', {}, async ({ page }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    const out = {};
    for (const [btn, modal, focusSel] of [['#swarmBtn', '#swarmModal', '#swarmGoal'], ['#experimentBtn', '#experimentModal', '#expRun'], ['#ablBtn', '#ablModal', '#ablGoal'], ['#sensitivityBtn', '#sensitivityModal', '#sensRun']]) {
      await page.click(btn); await page.focus(focusSel); await page.keyboard.press('Escape');
      out[modal] = { openAfterEsc: await page.$eval(modal, e => e.classList.contains('visible')) };
      let escaped = false;
      for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(m => !document.querySelector(m).contains(document.activeElement), modal)) { escaped = true; break; } }
      out[modal].focusLeavesModal = escaped;
      out[modal].role = await page.$eval(`${modal} .modal`, e => e.getAttribute('role'));
      await page.evaluate(m => document.querySelector(m).classList.remove('visible'), modal);
    }
    const all = Object.values(out).every(v => v.openAfterEsc && v.focusLeavesModal && !v.role);
    record('X14', 'Modal keyboard/a11y', all ? 'CONFIRMED' : 'PARTIAL', out);
  });

  await scenario('X15', 'Card text cannot be selected; a resized card clips content with no scroll', { longText: true }, async ({ page }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    const id = await generate(page);
    await page.click(`#${id} .card-content`, { clickCount: 3 });
    const sel = await page.evaluate(() => window.getSelection().toString().length);
    const us = await page.$eval(`#${id} .card-content`, e => getComputedStyle(e).userSelect);
    const h = await page.locator(`#${id} .resize-handle-s`).boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y - 250, { steps: 5 }); await page.mouse.up();
    const clip = await page.$eval(`#${id}`, c => { const cc = c.querySelector('.card-content'); return { cardH: c.offsetHeight, contentH: cc.scrollHeight + cc.offsetTop, contentOverflowY: getComputedStyle(cc).overflowY, cardOverflow: getComputedStyle(c).overflow }; });
    record('X15', 'Selection + clipping', (sel === 0 && us === 'none' && clip.contentH > clip.cardH && clip.contentOverflowY === 'visible') ? 'CONFIRMED' : 'FIXED', { selectedChars: sel, userSelect: us, ...clip });
  });

  await scenario('X16', 'Long outputs: auto-placed cards overlap each other', { longText: true }, async ({ page }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    for (let i = 0; i < 4; i++) await generate(page);
    const overlaps = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.card')].map(c => ({ id: c.id, x: parseInt(c.style.left), y: parseInt(c.style.top), w: c.offsetWidth, h: c.offsetHeight }));
      const o = [];
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i], b = r[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) o.push(`${a.id}×${b.id}`); }
      return { heights: r.map(c => c.h), overlaps: o };
    });
    await page.screenshot({ path: path.join(SP, 'x16-overlap.png') });
    record('X16', 'Overlapping cards', overlaps.overlaps.length ? 'CONFIRMED' : 'FIXED', overlaps);
  });

  await scenario('X17', 'Accessibility scan (axe-core 4.13) of the working canvas and the API key modal', {}, async ({ page }) => {
    await setKey(page); await addSource(page);
    const id = await generate(page);
    const ap = axePath();
    if (!ap) return record('X17', 'axe-core violations', 'SKIPPED', 'axe-core not installed (npm i --prefix tests/e2e axe-core)');
    await page.addScriptTag({ path: ap });
    const scan = () => page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map(n => n.target.join(' ') + (n.any[0] && n.any[0].data && n.any[0].data.contrastRatio ? ` (ratio ${n.any[0].data.contrastRatio})` : '')) })));
    const canvasV = await scan();
    await page.click('#apiKeyBtn');
    const modalV = await scan();
    const summary = v => v.map(x => `${x.id}[${x.impact}]x${x.nodes}`).join(', ');
    record('X17', 'axe-core violations', (canvasV.length || modalV.length) ? 'CONFIRMED' : 'FIXED', { canvas: summary(canvasV), modal: summary(modalV) });
    fs.writeFileSync(path.join(SP, 'axe.json'), JSON.stringify({ canvas: canvasV, modal: modalV }, null, 2));
  });


  await scenario('X18', 'After Add to Canvas, toasts / zoom / compare / lab buttons render off-screen at laptop heights', {}, async ({ page }) => {
    const out = {};
    for (const h of [1080, 900, 768]) {
      await page.setViewportSize({ width: 1440, height: h });
      await page.goto(BASE);
      await page.evaluate(() => { document.getElementById('generationPanel').classList.add('visible'); const a = createCard(['Source'], 'Short source.', 'source'); const b = createCard(['Variant'], 'Short variant.', 'variant'); multiSelectedCards.push(a, b); showComparePanel(); showToast('probe', { duration: 60000 }); });
      await page.waitForTimeout(450);
      out[h] = await page.evaluate(() => {
        const on = s => { const r = document.querySelector(s).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; };
        const sc = document.querySelector('.sidebar-content');
        return { toast: on('.toast'), zoom: on('.zoom-controls'), compare: on('#comparePanel'), sidebarScrollable: sc.scrollHeight > sc.clientHeight || on('#sensitivityBtn') };
      });
      if (h === 900) await page.screenshot({ path: path.join(SP, 'x18-layout-900.png') });
    }
    const broken = Object.values(out).some(v => !v.toast || !v.zoom || !v.compare || !v.sidebarScrollable);
    record('X18', 'Layout overflow', broken ? 'CONFIRMED' : 'FIXED', out);
  });


  await scenario('X19', 'First use: action that prompted for the key does not continue after saving it', {}, async ({ page }) => {
    await page.fill('#sourceText', SOURCE);
    await page.click('#addSourceBtn');
    const modalOpened = await page.$eval('#apiKeyModal', e => e.classList.contains('visible'));
    await page.fill('#apiKeyInput', 'sk-ant-test-0000'); await page.click('#apiKeySave');
    await page.waitForTimeout(800);
    const cards = await page.$$eval('.card.source', e => e.length);
    record('X19', 'Deferred action after key entry', (modalOpened && cards === 0) ? 'CONFIRMED' : 'FIXED', { modalOpened, sourceCardsAfterSave: cards });
  });


  await scenario('X20', 'Ablation: one failed call is reported as the error and cancels the remaining calls', {
    delay: ({ kind }) => /abl-|critic/.test(kind) ? 250 : 0,
    override: ({ kind, log }) => (kind === 'abl-writer' && log.filter(e => e.kind === 'abl-writer').length === 2) ? { status: 400, errType: 'invalid_request_error', message: 'mock: writer failed' } : null,
  }, async ({ page, mock }) => {
    await setKey(page); await addSource(page); await closeAnalysis(page);
    await page.click('#ablBtn'); await page.selectOption('#ablTrials', '8'); await page.click('#ablStart');
    await page.waitForFunction(() => /Error|Stopped|Complete/.test(document.getElementById('agentPhase').textContent), null, { timeout: 20000 });
    const atEnd = mock.log.length; await page.waitForTimeout(2000);
    const last = await page.evaluate(() => [...document.querySelectorAll('.agent-entry .agent-msg')].pop().textContent);
    const phase = await page.textContent('#agentPhase');
    const ok = phase === 'Error' && /writer failed/.test(last) && mock.log.length === atEnd && mock.log.length < 24;
    record('X20', 'Ablation fail-fast', ok ? 'FIXED' : 'CONFIRMED', { phase, lastLog: last, callsMade: mock.log.length, callsAfterEnd: mock.log.length - atEnd, fullRunWouldBe: 1 + 16 + 8 * 3 });
  });

  await browser.close(); server.close();
  fs.writeFileSync(path.join(SP, 'results.json'), JSON.stringify(results, null, 2));
  const tally = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
  console.log('\nTALLY', JSON.stringify(tally));
  if (results.some(r => r.status === 'FAIL' || r.status === 'HARNESS-ERROR')) process.exitCode = 1;
})().catch(e => { console.error('FATAL', e); process.exit(1); });
