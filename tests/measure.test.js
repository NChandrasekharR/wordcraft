'use strict';

// Unit tests for js/measure.js — Node built-ins only (node:test, node:assert/strict).
// Covers the PURE helpers of the semantic-distance measurement layer. The
// API-calling functions need a browser and are exercised by the e2e harness.
// Run with: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  djb2Hash,
  semanticPairKey,
  truncateForJudge,
  buildJudgePrompt,
  normalizeJudgeScores,
  JUDGE_MAX_CHARS,
} = require('../js/measure.js');

// ---------------------------------------------------------------------------
// semanticPairKey — order normalization
// ---------------------------------------------------------------------------

test('semanticPairKey: key(a,b) === key(b,a) (order-normalized)', () => {
  assert.equal(
    semanticPairKey('the cat sat', 'a dog ran'),
    semanticPairKey('a dog ran', 'the cat sat')
  );
});

test('semanticPairKey: different content yields different keys', () => {
  assert.notEqual(
    semanticPairKey('alpha', 'beta'),
    semanticPairKey('alpha', 'gamma')
  );
});

test('semanticPairKey: identical texts still produce a stable key', () => {
  assert.equal(semanticPairKey('same', 'same'), semanticPairKey('same', 'same'));
});

test('semanticPairKey: null/undefined coerce without throwing and stay symmetric', () => {
  assert.equal(semanticPairKey(null, 'x'), semanticPairKey('x', null));
  assert.equal(typeof semanticPairKey(null, undefined), 'string');
});

test('djb2Hash: deterministic and stringy', () => {
  assert.equal(djb2Hash('hello'), djb2Hash('hello'));
  assert.equal(typeof djb2Hash('hello'), 'string');
  assert.notEqual(djb2Hash('hello'), djb2Hash('world'));
});

// ---------------------------------------------------------------------------
// truncateForJudge — truncation flag
// ---------------------------------------------------------------------------

test('truncateForJudge: short text is untouched and not flagged', () => {
  const r = truncateForJudge('short enough');
  assert.equal(r.text, 'short enough');
  assert.equal(r.truncated, false);
});

test('truncateForJudge: long text is cut to the cap and flagged', () => {
  const long = 'x'.repeat(JUDGE_MAX_CHARS + 500);
  const r = truncateForJudge(long);
  assert.equal(r.truncated, true);
  assert.equal(r.text.length, JUDGE_MAX_CHARS);
});

test('truncateForJudge: text exactly at the cap is NOT flagged', () => {
  const exact = 'y'.repeat(JUDGE_MAX_CHARS);
  const r = truncateForJudge(exact);
  assert.equal(r.truncated, false);
  assert.equal(r.text.length, JUDGE_MAX_CHARS);
});

test('truncateForJudge: null/undefined become empty string, not flagged', () => {
  assert.deepEqual(truncateForJudge(null), { text: '', truncated: false });
  assert.deepEqual(truncateForJudge(undefined), { text: '', truncated: false });
});

// ---------------------------------------------------------------------------
// buildJudgePrompt — truncation note + pair enumeration
// ---------------------------------------------------------------------------

test('buildJudgePrompt: enumerates every pair with A/B texts', () => {
  const prompt = buildJudgePrompt([
    ['first a', 'first b'],
    ['second a', 'second b'],
  ]);
  assert.match(prompt, /=== Pair 1 ===/);
  assert.match(prompt, /=== Pair 2 ===/);
  assert.match(prompt, /first a/);
  assert.match(prompt, /second b/);
  // Instruction stresses MEANING, not wording.
  assert.match(prompt, /MEANING/);
});

test('buildJudgePrompt: flags a truncated text with "(truncated)"', () => {
  const long = 'z'.repeat(JUDGE_MAX_CHARS + 10);
  const prompt = buildJudgePrompt([[long, 'short']]);
  assert.match(prompt, /\(truncated\)/);
  // The short side is not flagged.
  assert.match(prompt, /Text B:/);
});

test('buildJudgePrompt: no "(truncated)" note when everything fits', () => {
  const prompt = buildJudgePrompt([['a', 'b']]);
  assert.doesNotMatch(prompt, /\(truncated\)/);
});

// ---------------------------------------------------------------------------
// normalizeJudgeScores — normalization + validation
// ---------------------------------------------------------------------------

test('normalizeJudgeScores: maps 0..100 to 0..1 in input order by pair number', () => {
  const out = normalizeJudgeScores(
    [
      { pair: 2, distance: 100 },
      { pair: 1, distance: 0 },
      { pair: 3, distance: 50 },
    ],
    3
  );
  assert.deepEqual(out, [0, 1, 0.5]);
});

test('normalizeJudgeScores: clamps into [0,1]', () => {
  const out = normalizeJudgeScores([{ pair: 1, distance: 0 }, { pair: 2, distance: 100 }], 2);
  assert.ok(out.every((v) => v >= 0 && v <= 1));
});

test('normalizeJudgeScores: throws when a pair is missing', () => {
  assert.throws(
    () => normalizeJudgeScores([{ pair: 1, distance: 10 }], 2),
    /omitted pair 2/
  );
});

test('normalizeJudgeScores: throws on out-of-range distance (high)', () => {
  assert.throws(
    () => normalizeJudgeScores([{ pair: 1, distance: 101 }], 1),
    /out of range/
  );
});

test('normalizeJudgeScores: throws on out-of-range distance (negative)', () => {
  assert.throws(
    () => normalizeJudgeScores([{ pair: 1, distance: -1 }], 1),
    /out of range/
  );
});

test('normalizeJudgeScores: throws when scores is not an array', () => {
  assert.throws(() => normalizeJudgeScores(null, 1), /no scores array/);
  assert.throws(() => normalizeJudgeScores(undefined, 1), /no scores array/);
});

test('normalizeJudgeScores: throws on a malformed entry (non-numeric fields)', () => {
  assert.throws(
    () => normalizeJudgeScores([{ pair: '1', distance: 10 }], 1),
    /malformed score entry/
  );
  assert.throws(
    () => normalizeJudgeScores([{ pair: 1, distance: 'x' }], 1),
    /malformed score entry/
  );
});

test('normalizeJudgeScores: ignores extra pairs as long as required ones are present', () => {
  const out = normalizeJudgeScores(
    [{ pair: 1, distance: 20 }, { pair: 2, distance: 40 }, { pair: 5, distance: 90 }],
    2
  );
  assert.deepEqual(out, [0.2, 0.4]);
});
