'use strict';

// Unit tests for js/ablation.js — Node built-ins only (node:test, node:assert).
// Covers the PURE helpers of the Ablation Lab: blind winner→arm mapping,
// win counting, best-trial selection, verdict-copy selection, and the rough
// cost estimate. The DOM/network orchestration needs a browser and is
// exercised by the e2e harness (verify-a.js).
// Run with: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ablWinnerToArm,
  ablCountWins,
  ablPickBest,
  ablVerdict,
  ablCostEstimate,
  ABL_JUDGE_SCHEMA,
  ABL_FACTORS,
} = require('../js/ablation.js');

// ---------------------------------------------------------------------------
// ablWinnerToArm — the crux of blind judging: a randomized presentation order
// must map back to the correct arm for BOTH orderings.
// ---------------------------------------------------------------------------

test('ablWinnerToArm: arm A shown first (aFirst=true)', () => {
  assert.equal(ablWinnerToArm(1, true), 'A', 'winner=option1 → arm A');
  assert.equal(ablWinnerToArm(2, true), 'B', 'winner=option2 → arm B');
});

test('ablWinnerToArm: arm B shown first (aFirst=false)', () => {
  assert.equal(ablWinnerToArm(1, false), 'B', 'winner=option1 → arm B (B was first)');
  assert.equal(ablWinnerToArm(2, false), 'A', 'winner=option2 → arm A');
});

test('ablWinnerToArm: same underlying winner maps consistently across orderings', () => {
  // If arm B genuinely wins, the mapping must yield "B" no matter which slot
  // it was presented in. aFirst=true → B is option 2; aFirst=false → B is option 1.
  assert.equal(ablWinnerToArm(2, true), 'B');
  assert.equal(ablWinnerToArm(1, false), 'B');
  // And arm A likewise.
  assert.equal(ablWinnerToArm(1, true), 'A');
  assert.equal(ablWinnerToArm(2, false), 'A');
});

test('ablWinnerToArm: malformed winner defaults to option 1', () => {
  assert.equal(ablWinnerToArm(0, true), 'A');
  assert.equal(ablWinnerToArm(3, true), 'A');
  assert.equal(ablWinnerToArm(undefined, false), 'B');
});

// ---------------------------------------------------------------------------
// ablCountWins
// ---------------------------------------------------------------------------

test('ablCountWins: tallies per-arm wins', () => {
  const jr = [{ i: 0, arm: 'B' }, { i: 1, arm: 'B' }, { i: 2, arm: 'A' }];
  assert.deepEqual(ablCountWins(jr), { aWins: 1, bWins: 2 });
});

test('ablCountWins: empty input is 0/0', () => {
  assert.deepEqual(ablCountWins([]), { aWins: 0, bWins: 0 });
});

test('ablCountWins: ignores unexpected arm labels', () => {
  const jr = [{ i: 0, arm: 'A' }, { i: 1, arm: 'X' }];
  assert.deepEqual(ablCountWins(jr), { aWins: 1, bWins: 0 });
});

// ---------------------------------------------------------------------------
// ablPickBest — best trial index per arm (most wins; ties → first)
// ---------------------------------------------------------------------------

test('ablPickBest: returns the first winning trial index for an arm', () => {
  const jr = [{ i: 0, arm: 'B' }, { i: 1, arm: 'A' }, { i: 2, arm: 'A' }];
  assert.equal(ablPickBest('A', jr), 1, 'arm A first won at trial index 1');
  assert.equal(ablPickBest('B', jr), 0);
});

test('ablPickBest: arm that won nothing falls back to trial 0', () => {
  const jr = [{ i: 0, arm: 'B' }, { i: 1, arm: 'B' }, { i: 2, arm: 'B' }];
  assert.equal(ablPickBest('A', jr), 0);
});

test('ablPickBest: picks the lowest winning index regardless of result order', () => {
  const jr = [{ i: 2, arm: 'A' }, { i: 0, arm: 'A' }, { i: 1, arm: 'B' }];
  assert.equal(ablPickBest('A', jr), 0);
});

// ---------------------------------------------------------------------------
// ablVerdict — honest, sample-count-stating copy. Never claims significance.
// ---------------------------------------------------------------------------

test('ablVerdict: N=3 is suggestive-not-proof and states the count', () => {
  const v = ablVerdict(1, 2, 3, 'no critic', 'with critic');
  assert.equal(v.winnerArm, 'B');
  assert.equal(v.strength, 'suggestive');
  assert.equal(v.label, 'Suggestive, not proof');
  assert.match(v.sentence, /3 blind comparisons/);
  assert.match(v.sentence, /with critic won 2 of/);
  assert.doesNotMatch(v.sentence, /significan/i);
});

test('ablVerdict: N=5 is moderate', () => {
  const v = ablVerdict(2, 3, 5, 'no critic', 'with critic');
  assert.equal(v.strength, 'moderate');
  assert.equal(v.label, 'Moderate signal');
  assert.match(v.sentence, /5 blind comparisons/);
});

test('ablVerdict: N=8 with >=7 wins is strong for this brief', () => {
  const v = ablVerdict(1, 7, 8, 'no critic', 'with critic');
  assert.equal(v.strength, 'strong');
  assert.equal(v.label, 'Strong for this brief');
  assert.match(v.sentence, /8 blind comparisons/);
  assert.match(v.sentence, /not a significance test/);
});

test('ablVerdict: N=8 with <7 wins stays moderate (not strong)', () => {
  const v = ablVerdict(2, 6, 8, 'no critic', 'with critic');
  assert.equal(v.strength, 'moderate');
});

test('ablVerdict: a tie is "too close to call" with no winner', () => {
  const v = ablVerdict(2, 2, 4, 'no critic', 'with critic');
  assert.equal(v.winnerArm, 'tie');
  assert.equal(v.strength, 'tie');
  assert.equal(v.winLabel, null);
  assert.match(v.sentence, /dead heat/);
});

test('ablVerdict: arm A can win too', () => {
  const v = ablVerdict(3, 0, 3, 'no critic', 'with critic');
  assert.equal(v.winnerArm, 'A');
  assert.match(v.sentence, /no critic won 3 of/);
});

test('ablVerdict: never asserts statistical significance in any branch', () => {
  for (const [a, b, n] of [[1, 2, 3], [2, 3, 5], [1, 7, 8], [2, 6, 8], [2, 2, 4]]) {
    const v = ablVerdict(a, b, n, 'A', 'B');
    assert.doesNotMatch(v.sentence, /statistically significant|proven|proof that/i,
      `n=${n} a=${a} b=${b}: ${v.sentence}`);
  }
});

// ---------------------------------------------------------------------------
// ablCostEstimate — rough, but structurally correct (more stages ⇒ more cost).
// ---------------------------------------------------------------------------

const PRICING = {
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

test('ablCostEstimate: returns a positive number', () => {
  const c = ablCostEstimate(PRICING, 'claude-sonnet-5', 3, 'critic');
  assert.equal(typeof c, 'number');
  assert.ok(c > 0);
});

test('ablCostEstimate: the critic factor costs more than the research factor (extra per-trial stages)', () => {
  const critic = ablCostEstimate(PRICING, 'claude-sonnet-5', 3, 'critic');
  const research = ablCostEstimate(PRICING, 'claude-sonnet-5', 3, 'research');
  assert.ok(critic > research, `critic ${critic} should exceed research ${research}`);
});

test('ablCostEstimate: cost scales up with more trials', () => {
  const three = ablCostEstimate(PRICING, 'claude-sonnet-5', 3, 'critic');
  const eight = ablCostEstimate(PRICING, 'claude-sonnet-5', 8, 'critic');
  assert.ok(eight > three);
});

test('ablCostEstimate: a pricier model costs more for the same run', () => {
  const sonnet = ablCostEstimate(PRICING, 'claude-sonnet-5', 3, 'critic');
  const opus = ablCostEstimate(PRICING, 'claude-opus-4-8', 3, 'critic');
  assert.ok(opus > sonnet);
});

test('ablCostEstimate: unknown model degrades to 0 for generative stages (no throw)', () => {
  // Only the haiku critic stage has a price; still returns a finite number.
  const c = ablCostEstimate(PRICING, 'no-such-model', 3, 'critic');
  assert.equal(typeof c, 'number');
  assert.ok(Number.isFinite(c));
});

// ---------------------------------------------------------------------------
// Schema / factor metadata sanity — the mock relies on this exact shape.
// ---------------------------------------------------------------------------

test('ABL_JUDGE_SCHEMA: winner + reason only, no ranking/scores (distinct from other judges)', () => {
  const props = ABL_JUDGE_SCHEMA.properties;
  assert.ok(props.winner && props.reason, 'has winner + reason');
  assert.ok(!props.ranking, 'no ranking (that is the swarm judge)');
  assert.ok(!props.scores, 'no scores (that is the semantic judge)');
  assert.deepEqual(ABL_JUDGE_SCHEMA.required.slice().sort(), ['reason', 'winner']);
});

test('ABL_FACTORS: both factors expose arm labels used for card tags', () => {
  assert.equal(ABL_FACTORS.critic.armA, 'no critic');
  assert.equal(ABL_FACTORS.critic.armB, 'with critic');
  assert.equal(ABL_FACTORS.research.armA, 'no research');
  assert.equal(ABL_FACTORS.research.armB, 'with research');
});
