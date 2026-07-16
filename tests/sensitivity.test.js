'use strict';

// Unit tests for js/sensitivity.js — Node built-ins only (node:test,
// node:assert/strict). Covers the PURE helpers of the Sensitivity Map:
// sweep-point definitions, threshold classification, per-knob verdicts, the
// honest summary line, store pruning, relative time, and the rough cost
// estimate. The browser-only run/render wiring needs a DOM and is exercised by
// the e2e harness (verify-s.js).
// Run with: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sensHash, sensPoolKey,
  sensMean, sensMedian, sensMax,
  sensSweepPoints, SENS_KNOB_ORDER, SENS_NEUTRAL,
  sensClassify, sensKnobVerdict, sensJoinNames, sensSummaryLine, sensBuildModel,
  sensPruneStore, sensRelativeTime, sensCostEstimate, sensFormatCost,
  SENS_STORE_CAP, SENS_JUDGE_MODEL,
} = require('../js/sensitivity.js');

const { toneLabel, lengthLabel, complexityLabel } = require('../js/util.js');
const fmt = { toneLabel, lengthLabel, complexityLabel };

// ---------------------------------------------------------------------------
// sensHash / sensPoolKey — must match experiment.js djb2(model+'\0'+source)
// ---------------------------------------------------------------------------

test('sensPoolKey: stable + depends on model and source', () => {
  assert.equal(sensPoolKey('m', 's'), sensPoolKey('m', 's'));
  assert.notEqual(sensPoolKey('m1', 's'), sensPoolKey('m2', 's'));
  assert.notEqual(sensPoolKey('m', 's1'), sensPoolKey('m', 's2'));
});

test('sensHash: replicates the djb2 the experiment pool uses', () => {
  // Recompute djb2 independently and compare.
  const djb2 = (str) => {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };
  assert.equal(sensHash('claude-opus-4-8\0hello'), djb2('claude-opus-4-8\0hello'));
  assert.equal(sensPoolKey('claude-opus-4-8', 'hello'), djb2('claude-opus-4-8\0hello'));
});

// ---------------------------------------------------------------------------
// stats helpers
// ---------------------------------------------------------------------------

test('sensMean / sensMedian / sensMax: basic + empty', () => {
  assert.equal(sensMean([]), 0);
  assert.equal(sensMean([2, 4]), 3);
  assert.equal(sensMedian([]), 0);
  assert.equal(sensMedian([3, 1, 2]), 2);
  assert.equal(sensMedian([1, 2, 3, 4]), 2.5);
  assert.equal(sensMax([]), 0);
  assert.equal(sensMax([0.1, 0.9, 0.3]), 0.9);
});

// ---------------------------------------------------------------------------
// sensSweepPoints — 10 points, one knob off neutral each, grouped by knob
// ---------------------------------------------------------------------------

test('sensSweepPoints: exactly 10 points across the 5 knobs', () => {
  const pts = sensSweepPoints(fmt);
  assert.equal(pts.length, 10);
  for (const knob of SENS_KNOB_ORDER) {
    assert.equal(pts.filter(p => p.knob === knob).length, 2, `2 points for ${knob}`);
  }
});

test('sensSweepPoints: each point moves exactly ONE knob off neutral', () => {
  for (const p of sensSweepPoints(fmt)) {
    let moved = 0;
    for (const k of Object.keys(SENS_NEUTRAL)) {
      if (p.params[k] !== SENS_NEUTRAL[k]) moved++;
    }
    assert.equal(moved, 1, `${p.label} moves one knob`);
    assert.equal(p.params[p.key], p.value);
  }
});

test('sensSweepPoints: labels read like "Tone → Very Casual" / "Audience → technical"', () => {
  const pts = sensSweepPoints(fmt);
  const labels = pts.map(p => p.label);
  assert.ok(labels.includes('Tone → Very Casual'));
  assert.ok(labels.includes('Tone → Very Formal'));
  assert.ok(labels.includes('Length → Much Shorter'));
  assert.ok(labels.includes('Length → Much Longer'));
  assert.ok(labels.includes('Complexity → Very Simple'));
  assert.ok(labels.includes('Complexity → Very Elaborate'));
  assert.ok(labels.includes('Audience → technical'));
  assert.ok(labels.includes('Audience → academic'));
  assert.ok(labels.includes('Intent → persuade'));
  assert.ok(labels.includes('Intent → inspire'));
});

test('sensSweepPoints: tolerates a missing fmt (no throw)', () => {
  assert.equal(sensSweepPoints().length, 10);
  assert.equal(sensSweepPoints(undefined).length, 10);
});

// ---------------------------------------------------------------------------
// sensClassify — threshold classification vs the noise floor
// ---------------------------------------------------------------------------

test('sensClassify: strong clears the band AND beats median by >5 pts', () => {
  // noiseMax 0.20, median 0.10. impact 0.30 clears + margin 0.20 > 0.05.
  assert.equal(sensClassify(0.30, 0.20, 0.10), 'strong');
});

test('sensClassify: at/below median is noise', () => {
  assert.equal(sensClassify(0.10, 0.20, 0.10), 'noise');
  assert.equal(sensClassify(0.05, 0.20, 0.10), 'noise');
});

test('sensClassify: above median but inside the band is moderate', () => {
  assert.equal(sensClassify(0.15, 0.20, 0.10), 'moderate');
});

test('sensClassify: clears the band but only by <=5 pts is moderate, not strong', () => {
  // impact 0.22 >= max 0.20 but 0.22 - median 0.20 = 0.02 <= 0.05.
  assert.equal(sensClassify(0.22, 0.20, 0.20), 'moderate');
});

// ---------------------------------------------------------------------------
// sensKnobVerdict — folds both tracks into one headline category
// ---------------------------------------------------------------------------

const NOISE = { semMax: 0.20, semMedian: 0.10, surfMax: 0.30, surfMedian: 0.15 };

test('sensKnobVerdict: strong meaning → meaning', () => {
  assert.equal(sensKnobVerdict(0.40, 0.10, NOISE), 'meaning');
});

test('sensKnobVerdict: meaning in noise but surface clears → wording', () => {
  // sem 0.08 <= median 0.10 (noise); surf 0.60 clears surf band → wording.
  assert.equal(sensKnobVerdict(0.08, 0.60, NOISE), 'wording');
});

test('sensKnobVerdict: meaning in noise and surface in noise → noise', () => {
  assert.equal(sensKnobVerdict(0.08, 0.10, NOISE), 'noise');
});

test('sensKnobVerdict: meaning above median but not clear → marginal', () => {
  assert.equal(sensKnobVerdict(0.15, 0.10, NOISE), 'marginal');
});

test('sensKnobVerdict: judge unavailable (sem null) falls back to surface', () => {
  assert.equal(sensKnobVerdict(null, 0.60, NOISE), 'meaning');
  assert.equal(sensKnobVerdict(null, 0.10, NOISE), 'noise');
  assert.equal(sensKnobVerdict(null, 0.20, NOISE), 'marginal');
});

// ---------------------------------------------------------------------------
// sensJoinNames + sensSummaryLine — the honest voice
// ---------------------------------------------------------------------------

test('sensJoinNames: 1/2/3 name joining', () => {
  assert.equal(sensJoinNames(['A']), 'A');
  assert.equal(sensJoinNames(['A', 'B']), 'A and B');
  assert.equal(sensJoinNames(['A', 'B', 'C']), 'A, B and C');
  assert.equal(sensJoinNames([]), '');
});

test('sensSummaryLine: matches the thesis-style example wording', () => {
  const line = sensSummaryLine([
    { knob: 'Length', verdict: 'meaning' },
    { knob: 'Intent', verdict: 'meaning' },
    { knob: 'Tone', verdict: 'wording' },
    { knob: 'Complexity', verdict: 'noise' },
  ]);
  assert.equal(
    line,
    'For this text: Length and Intent move meaning well beyond noise; Tone is mostly wording; Complexity sits inside the noise band.'
  );
});

test('sensSummaryLine: singular verb agreement + marginal group', () => {
  const line = sensSummaryLine([
    { knob: 'Tone', verdict: 'meaning' },
    { knob: 'Audience', verdict: 'marginal' },
  ]);
  assert.equal(line, 'For this text: Tone moves meaning well beyond noise; Audience is marginal.');
});

test('sensSummaryLine: all-noise still returns an honest sentence', () => {
  const line = sensSummaryLine([
    { knob: 'Tone', verdict: 'noise' },
    { knob: 'Length', verdict: 'noise' },
  ]);
  assert.equal(line, 'For this text: Tone and Length sit inside the noise band.');
});

test('sensSummaryLine: empty verdicts → hedge', () => {
  assert.match(sensSummaryLine([]), /not enough signal/);
});

// ---------------------------------------------------------------------------
// sensBuildModel — knob impact = strongest direction; strongest knob; summary
// ---------------------------------------------------------------------------

function pt(knob, label, sem, surf) { return { knob, label, sem, surf }; }

test('sensBuildModel: knob impact is the strongest of its two directions', () => {
  const points = [
    pt('Tone', 'Tone → Very Casual', 0.05, 0.20),
    pt('Tone', 'Tone → Very Formal', 0.40, 0.30),
    pt('Length', 'Length → Much Shorter', 0.12, 0.10),
    pt('Length', 'Length → Much Longer', 0.14, 0.12),
    pt('Complexity', 'Complexity → Very Simple', 0.06, 0.10),
    pt('Complexity', 'Complexity → Very Elaborate', 0.07, 0.11),
    pt('Audience', 'Audience → technical', 0.30, 0.20),
    pt('Audience', 'Audience → academic', 0.25, 0.18),
    pt('Intent', 'Intent → persuade', 0.50, 0.40),
    pt('Intent', 'Intent → inspire', 0.45, 0.35),
  ];
  const noise = { semMax: 0.15, semMedian: 0.08, surfMax: 0.22, surfMedian: 0.12 };
  const m = sensBuildModel(points, noise, false);
  const tone = m.knobs.find(k => k.knob === 'Tone');
  assert.equal(tone.semImpact, 0.40); // max(0.05, 0.40)
  assert.equal(m.strongest, 'Intent'); // 0.50 is the highest primary impact
  // Intent + Audience + Tone clear the band; Length/Complexity are noise-ish.
  const byKnob = Object.fromEntries(m.verdicts.map(v => [v.knob, v.verdict]));
  assert.equal(byKnob.Intent, 'meaning');
  assert.equal(byKnob.Complexity, 'noise');
  assert.match(m.summary, /^For this text:/);
});

test('sensBuildModel: judgeUnavailable → semImpact null, surface drives everything', () => {
  const points = [
    pt('Tone', 'a', null, 0.40), pt('Tone', 'b', null, 0.10),
    pt('Length', 'a', null, 0.05), pt('Length', 'b', null, 0.06),
    pt('Complexity', 'a', null, 0.05), pt('Complexity', 'b', null, 0.04),
    pt('Audience', 'a', null, 0.08), pt('Audience', 'b', null, 0.07),
    pt('Intent', 'a', null, 0.09), pt('Intent', 'b', null, 0.08),
  ];
  const noise = { semMax: 0, semMedian: 0, surfMax: 0.12, surfMedian: 0.07 };
  const m = sensBuildModel(points, noise, true);
  assert.equal(m.knobs.find(k => k.knob === 'Tone').semImpact, null);
  assert.equal(m.strongest, 'Tone'); // 0.40 surface is the biggest mover
});

// ---------------------------------------------------------------------------
// sensPruneStore — keep newest CAP by ts
// ---------------------------------------------------------------------------

test('sensPruneStore: under cap is unchanged (copy)', () => {
  const store = { a: { ts: 1 }, b: { ts: 2 } };
  const out = sensPruneStore(store, 10);
  assert.deepEqual(out, store);
  assert.notEqual(out, store); // fresh object
});

test('sensPruneStore: drops the oldest entries by ts, keeps newest cap', () => {
  const store = { a: { ts: 10 }, b: { ts: 30 }, c: { ts: 20 }, d: { ts: 40 } };
  const out = sensPruneStore(store, 2);
  assert.deepEqual(Object.keys(out).sort(), ['b', 'd']); // ts 30 + 40
});

test('sensPruneStore: missing ts treated as oldest', () => {
  const store = { a: {}, b: { ts: 5 }, c: { ts: 9 } };
  const out = sensPruneStore(store, 2);
  assert.deepEqual(Object.keys(out).sort(), ['b', 'c']);
});

test('sensPruneStore: cap constant is 10', () => {
  assert.equal(SENS_STORE_CAP, 10);
});

// ---------------------------------------------------------------------------
// sensRelativeTime
// ---------------------------------------------------------------------------

test('sensRelativeTime: buckets seconds/minutes/hours/days', () => {
  const now = 1000000000000;
  assert.equal(sensRelativeTime(now, now), 'just now');
  assert.equal(sensRelativeTime(now - 30 * 1000, now), 'just now');
  assert.equal(sensRelativeTime(now - 60 * 1000, now), '1 minute ago');
  assert.equal(sensRelativeTime(now - 5 * 60 * 1000, now), '5 minutes ago');
  assert.equal(sensRelativeTime(now - 60 * 60 * 1000, now), '1 hour ago');
  assert.equal(sensRelativeTime(now - 3 * 60 * 60 * 1000, now), '3 hours ago');
  assert.equal(sensRelativeTime(now - 2 * 24 * 60 * 60 * 1000, now), '2 days ago');
});

// ---------------------------------------------------------------------------
// sensCostEstimate / sensFormatCost
// ---------------------------------------------------------------------------

test('sensCostEstimate: scales with generation count and is model-sensitive', () => {
  const opus = sensCostEstimate('claude-opus-4-8', 12, 2);
  const haiku = sensCostEstimate('claude-haiku-4-5', 12, 2);
  assert.ok(opus > haiku, 'opus costs more than haiku');
  assert.ok(sensCostEstimate('claude-opus-4-8', 24, 2) > opus, 'more gens cost more');
  assert.ok(opus > 0);
});

test('sensCostEstimate: judge model is haiku regardless of gen model', () => {
  assert.equal(SENS_JUDGE_MODEL, 'claude-haiku-4-5');
  // Two runs differing only in judge count differ by the haiku judge cost.
  const one = sensCostEstimate('claude-opus-4-8', 12, 1);
  const two = sensCostEstimate('claude-opus-4-8', 12, 2);
  assert.ok(two > one);
});

test('sensCostEstimate: unknown model falls back without throwing', () => {
  assert.ok(sensCostEstimate('mystery-model', 12, 2) > 0);
});

test('sensFormatCost: sub-cent uses 3 decimals, else 2', () => {
  assert.equal(sensFormatCost(0.008), '$0.008');
  assert.equal(sensFormatCost(0.18), '$0.18');
  assert.equal(sensFormatCost(1.2), '$1.20');
});
