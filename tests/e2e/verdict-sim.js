// Monte Carlo of experiment.js verdictFor() (logic copied verbatim; the file
// has no Node export). Texts are points x ~ N(mu, I) in d dims; distance is
// ||a-b|| scaled so pure-noise pairs average ~0.15 (a plausible meaning score).
const expMedian = xs => { const s = xs.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function verdictFor(signal, pr) {
  const pairs = pr.length, mx = Math.max(...pr), med = expMedian(pr);
  if (pairs < 3) return signal > mx + 0.10 ? 'real' : 'marginal';
  if (signal >= mx && (signal - med) > 0.05) return 'real';
  if (signal <= med) return 'noise';
  return 'marginal';
}
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const D = 8, SCALE = 0.15 / Math.sqrt(2 * D);
const pt = shift => Array.from({ length: D }, (_, i) => gauss() + (i === 0 ? shift : 0));
const dist = (a, b) => Math.min(1, SCALE * Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0)));
function run(k, shift, trials = 4000) {
  const c = { real: 0, marginal: 0, noise: 0 };
  for (let t = 0; t < trials; t++) {
    const pool = Array.from({ length: k }, () => pt(0)), cand = pt(shift), pr = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pr.push(dist(pool[i], pool[j]));
    c[verdictFor(pool.reduce((s, b) => s + dist(cand, b), 0) / k, pr)]++;
  }
  return c;
}
const pctS = (c, n) => `${Math.round(100 * c.real / n)}% real / ${Math.round(100 * c.marginal / n)}% marginal / ${Math.round(100 * c.noise / n)}% noise`;
for (const [label, shift] of [['NO real effect (candidate = baseline config)', 0], ['modest real effect', 3], ['large real effect', 6]]) {
  console.log(`\n${label}:`);
  for (const k of [2, 3, 4, 6, 8]) { const c = run(k, shift); console.log(`  pool ${k} (${k * (k - 1) / 2} noise pairs): ${pctS(c, 4000)}`); }
}
