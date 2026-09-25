const path = require('path').resolve(__dirname, '../../js') + '/';
const { ablVerdict } = require(path + 'ablation.js');
const { buildParamPrompt, computeDiff, computeDiffStats, lcsParts } = require(path + 'util.js');

// 1. Ablation verdict labels vs exact one-sided binomial sign-test p-values
function binomTail(k, n) { // P(X >= k | n, 0.5)
  let c = 1, s = 0; const C = [];
  for (let i = 0; i <= n; i++) { C.push(c); c = c * (n - i) / (i + 1); }
  for (let i = k; i <= n; i++) s += C[i];
  return s / Math.pow(2, n);
}
console.log('=== Ablation verdict label vs evidence (one-sided sign test) ===');
for (const [a, b, n] of [[1,2,3],[0,3,3],[2,3,5],[1,4,5],[0,5,5],[3,5,8],[2,6,8],[1,7,8]]) {
  const v = ablVerdict(a, b, n, 'no critic', 'with critic');
  console.log(`  B wins ${b}/${n}: label="${v.label}"  p(>=${b}|chance)=${binomTail(b, n).toFixed(3)}`);
}

// 2. Slider label vs directive contradiction in the prompt
console.log('\n=== buildParamPrompt at slider value 10 ===');
console.log(buildParamPrompt('x', 10, 10, 10, 'general', 'inform').split('\n').slice(1, 4).join('\n'));
console.log('Distinct tone prompts across 201 slider positions:',
  new Set(Array.from({length: 201}, (_, i) => buildParamPrompt('x', i - 100, 0, 0, 'g', 'i'))).size);

// 3. LCS diff cost vs text size (main-thread blocking in the browser)
const words = n => Array.from({length: n}, (_, i) => ['alpha','beta','gamma','delta','the','of','and','signal','noise','model'][(i * 7 + (i % 13)) % 10] + (i % 97)).join(' ');
console.log('\n=== computeDiffStats cost (one pair) ===');
for (const n of [300, 1000, 2000, 3000]) {
  const a = words(n), b = words(n).split(' ').reverse().join(' ');
  global.gc && global.gc();
  const m0 = process.memoryUsage().heapUsed; const t0 = process.hrtime.bigint();
  computeDiffStats(a, b);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6; const mb = (process.memoryUsage().heapUsed - m0) / 1e6;
  console.log(`  ${n} words each: ${ms.toFixed(0)} ms, heap +${mb.toFixed(0)} MB (full pool = 28 noise + 8 signal diffs)`);
}

// 4. Sensitivity judge output budget at full pool
const pool = 8, variants = 10, pairs = variants * pool;
console.log(`\n=== Sensitivity judge batch at full pool ===\n  ${pairs} pairs in ONE call, JUDGE_MAX_TOKENS=1000 → ${(1000/pairs).toFixed(1)} output tokens per {"pair":N,"distance":D} entry`);
console.log(`  input: ${pairs} pairs x 2 texts x up to 1500 chars = ~${(pairs*2*1500/4/1000).toFixed(0)}K tokens`);
