'use strict';

// Unit tests for js/util.js — Node built-ins only (node:test, node:assert/strict).
// Run with: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escapeHtml,
  toneLabel,
  lengthLabel,
  complexityLabel,
  buildParamPrompt,
  lcsParts,
  computeDiff,
  computeDiffStats,
  parseJsonLoose,
} = require('../js/util.js');

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

test('escapeHtml: escapes all five special characters', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
});

test('escapeHtml: escapes a mix of all special characters in one string', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('escapeHtml: ampersand is escaped first, so literal "&lt;" does not double-unescape', () => {
  // If '<' were escaped before '&', "&lt;" would incorrectly become "&amp;lt;"
  // read back as a real '<' by an HTML parser only if & were escaped after.
  // The important invariant is that the literal text "&lt;" survives as
  // "&amp;lt;" (the ampersand escaped, the rest untouched) and never regresses
  // to a bare "&lt;" (which a browser would render as a real '<').
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('escapeHtml: null and undefined coerce to empty string', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml: non-string input is stringified', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(0), '0');
});

// ---------------------------------------------------------------------------
// lcsParts
// ---------------------------------------------------------------------------

test('lcsParts: identical texts yield an all-"same" sequence', () => {
  const text = 'the quick brown fox jumps';
  const parts = lcsParts(text, text);
  assert.ok(parts.length > 0);
  assert.ok(parts.every((p) => p.type === 'same'));
  assert.equal(parts.map((p) => p.text).join(''), text);
});

test('lcsParts: fully disjoint texts yield only removed/added (no same)', () => {
  // Single words with no shared whitespace tokens, so nothing can match.
  const parts = lcsParts('apple', 'banana');
  assert.ok(parts.every((p) => p.type === 'removed' || p.type === 'added'));
  assert.ok(parts.some((p) => p.type === 'removed'));
  assert.ok(parts.some((p) => p.type === 'added'));
});

test('lcsParts: a single middle-word change produces the expected same/removed/added sequence', () => {
  const parts = lcsParts('the quick brown fox', 'the quick red fox');
  assert.deepEqual(parts, [
    { type: 'same', text: 'the' },
    { type: 'same', text: ' ' },
    { type: 'same', text: 'quick' },
    { type: 'same', text: ' ' },
    { type: 'removed', text: 'brown' },
    { type: 'added', text: 'red' },
    { type: 'same', text: ' ' },
    { type: 'same', text: 'fox' },
  ]);
});

test('lcsParts: whitespace tokens are preserved as their own parts', () => {
  const parts = lcsParts('a  b', 'a  b'); // two spaces between words
  const whitespaceParts = parts.filter((p) => /^\s+$/.test(p.text));
  assert.ok(whitespaceParts.length > 0);
  assert.ok(whitespaceParts.every((p) => p.text === '  '));
});

test('lcsParts round-trip invariant: same+removed reconstructs oldText, same+added reconstructs newText', () => {
  const cases = [
    ['the quick brown fox', 'the quick red fox'],
    ['hello world', 'hello world'],
    ['apple', 'banana'],
    ['', ''],
    ['one two three', 'one two three four five'],
    ['a b c d e', 'a c e'],
    ['  leading and trailing  ', '  leading and trailing  '],
    ['completely different sentence here', 'nothing at all in common'],
  ];

  for (const [oldText, newText] of cases) {
    const parts = lcsParts(oldText, newText);
    const rebuiltOld = parts
      .filter((p) => p.type === 'same' || p.type === 'removed')
      .map((p) => p.text)
      .join('');
    const rebuiltNew = parts
      .filter((p) => p.type === 'same' || p.type === 'added')
      .map((p) => p.text)
      .join('');
    assert.equal(rebuiltOld, oldText, `old reconstruction failed for ${JSON.stringify(oldText)}`);
    assert.equal(rebuiltNew, newText, `new reconstruction failed for ${JSON.stringify(newText)}`);
  }
});

// ---------------------------------------------------------------------------
// computeDiff
// ---------------------------------------------------------------------------

test('computeDiff: wraps additions and removals in the expected spans', () => {
  const html = computeDiff('the quick brown fox', 'the quick red fox');
  assert.equal(
    html,
    'the quick <span class="diff-removed">brown</span><span class="diff-added">red</span> fox'
  );
  assert.match(html, /<span class="diff-removed">brown<\/span>/);
  assert.match(html, /<span class="diff-added">red<\/span>/);
});

test('computeDiff: identical input produces no diff spans', () => {
  const html = computeDiff('nothing changed here', 'nothing changed here');
  assert.doesNotMatch(html, /diff-added/);
  assert.doesNotMatch(html, /diff-removed/);
  assert.equal(html, 'nothing changed here');
});

test('computeDiff: escapes HTML markup so it can never appear unescaped in the output', () => {
  const html = computeDiff('hello', '<script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;\/script&gt;/);
});

// ---------------------------------------------------------------------------
// computeDiffStats
// ---------------------------------------------------------------------------

test('computeDiffStats: identical texts have ratio 0 and no changes', () => {
  const stats = computeDiffStats('a b c', 'a b c');
  assert.equal(stats.added, 0);
  assert.equal(stats.removed, 0);
  assert.equal(stats.same, 3);
  assert.equal(stats.changed, 0);
  assert.equal(stats.ratio, 0);
});

test('computeDiffStats: completely different single-word texts have ratio 1', () => {
  const stats = computeDiffStats('apple', 'banana');
  assert.equal(stats.same, 0);
  assert.equal(stats.added, 1);
  assert.equal(stats.removed, 1);
  assert.equal(stats.ratio, 1);
});

test('computeDiffStats: a known small edit produces hand-computed counts', () => {
  // 'brown' -> 'red' is a 1-word removal + 1-word addition, with 3 words
  // ('the', 'quick', 'fox') unchanged. Whitespace tokens are excluded from
  // the word counts by computeDiffStats' isWord() filter.
  const stats = computeDiffStats('the quick brown fox', 'the quick red fox');
  assert.equal(stats.same, 3);
  assert.equal(stats.removed, 1);
  assert.equal(stats.added, 1);
  assert.equal(stats.changed, 2);
  assert.equal(stats.ratio, 2 / 5);
});

test('computeDiffStats: a pure addition produces hand-computed counts', () => {
  // 'a b c' -> 'a b c d e': 3 words unchanged, 2 words added, 0 removed.
  const stats = computeDiffStats('a b c', 'a b c d e');
  assert.equal(stats.same, 3);
  assert.equal(stats.added, 2);
  assert.equal(stats.removed, 0);
  assert.equal(stats.changed, 2);
  assert.equal(stats.ratio, 2 / 5);
});

test('computeDiffStats: ratio is always within [0, 1]', () => {
  const cases = [
    ['', ''],
    ['a', 'a'],
    ['a', 'b'],
    ['the quick brown fox', 'the quick red fox'],
    ['one two three', 'one two three four five'],
    ['a b c d e', 'a c e'],
    ['completely different sentence here', 'nothing at all in common'],
    ['   ', '   '],
  ];
  for (const [oldText, newText] of cases) {
    const stats = computeDiffStats(oldText, newText);
    assert.ok(stats.ratio >= 0, `ratio underflow for ${JSON.stringify([oldText, newText])}`);
    assert.ok(stats.ratio <= 1, `ratio overflow for ${JSON.stringify([oldText, newText])}`);
  }
});

test('computeDiffStats: empty vs empty text does not divide by zero', () => {
  const stats = computeDiffStats('', '');
  assert.equal(stats.changed, 0);
  assert.equal(stats.ratio, 0);
});

// ---------------------------------------------------------------------------
// parseJsonLoose
// ---------------------------------------------------------------------------

test('parseJsonLoose: extracts an object from prose-wrapped text', () => {
  const result = parseJsonLoose('Sure, here is the JSON: {"a":1,"b":[1,2]} — hope that helps!');
  assert.deepEqual(result, { a: 1, b: [1, 2] });
});

test('parseJsonLoose: passes through clean JSON unchanged', () => {
  const result = parseJsonLoose('{"clean":true,"n":42}');
  assert.deepEqual(result, { clean: true, n: 42 });
});

test('parseJsonLoose: throws a clear error when no object is present', () => {
  assert.throws(() => parseJsonLoose('no json here at all'), /Model did not return JSON/);
});

test('parseJsonLoose: extracts the FIRST object when two JSON objects are present', () => {
  const text = 'first: {"a":1} and second: {"b":2}';
  assert.deepEqual(parseJsonLoose(text), { a: 1 });
});

test('parseJsonLoose: braces inside string values do not break the balance scan', () => {
  const text = 'note {"msg":"has a } brace and a \\" quote","ok":true} trailing';
  assert.deepEqual(parseJsonLoose(text), { msg: 'has a } brace and a " quote', ok: true });
});

test('parseJsonLoose: nested objects are extracted whole', () => {
  const text = 'x {"outer":{"inner":[1,2]}} y {"other":0}';
  assert.deepEqual(parseJsonLoose(text), { outer: { inner: [1, 2] } });
});

// ---------------------------------------------------------------------------
// toneLabel / lengthLabel / complexityLabel boundary values
// ---------------------------------------------------------------------------

const BOUNDARY_VALUES = [-100, -60, -21, -20, 0, 19, 20, 59, 60, 100];

test('toneLabel: boundary values map to the labels defined in util.js', () => {
  const expected = [
    'Very Casual', // -100
    'Very Casual', // -60 (v <= -60)
    'Casual',      // -21
    'Casual',      // -20 (v <= -20)
    'Neutral',     // 0
    'Neutral',     // 19 (v < 20)
    'Formal',      // 20
    'Formal',      // 59 (v < 60)
    'Very Formal', // 60
    'Very Formal', // 100
  ];
  assert.deepEqual(BOUNDARY_VALUES.map(toneLabel), expected);
});

test('lengthLabel: boundary values map to the labels defined in util.js', () => {
  const expected = [
    'Much Shorter',
    'Much Shorter',
    'Shorter',
    'Shorter',
    'Same',
    'Same',
    'Longer',
    'Longer',
    'Much Longer',
    'Much Longer',
  ];
  assert.deepEqual(BOUNDARY_VALUES.map(lengthLabel), expected);
});

test('complexityLabel: boundary values map to the labels defined in util.js', () => {
  const expected = [
    'Very Simple',
    'Very Simple',
    'Simple',
    'Simple',
    'Moderate',
    'Moderate',
    'Elaborate',
    'Elaborate',
    'Very Elaborate',
    'Very Elaborate',
  ];
  assert.deepEqual(BOUNDARY_VALUES.map(complexityLabel), expected);
});

// ---------------------------------------------------------------------------
// buildParamPrompt
// ---------------------------------------------------------------------------

test('buildParamPrompt: includes original text, labels, and audience/intent', () => {
  const prompt = buildParamPrompt('Hello world', 50, -50, 0, 'general readers', 'inform');

  // Original text is included verbatim.
  assert.match(prompt, /Hello world/);

  // Correct label words for the given slider values.
  assert.match(prompt, /Tone: Formal/);
  assert.match(prompt, /Length: Shorter/);
  assert.match(prompt, /Complexity: Moderate/);

  // Audience/intent values are included.
  assert.match(prompt, /Audience: general readers/);
  assert.match(prompt, /Intent: inform/);
});

test('buildParamPrompt: directive phrasing follows the sign of each slider', () => {
  const positive = buildParamPrompt('x', 10, 10, 10, 'a', 'i');
  assert.match(positive, /more formal/);
  assert.match(positive, /expand and elaborate/);
  assert.match(positive, /use more sophisticated vocabulary/);

  const negative = buildParamPrompt('x', -10, -10, -10, 'a', 'i');
  assert.match(negative, /more casual/);
  assert.match(negative, /condense and shorten/);
  assert.match(negative, /use simpler words/);

  const zero = buildParamPrompt('x', 0, 0, 0, 'a', 'i');
  assert.match(zero, /keep similar\)/);
  assert.match(zero, /keep similar length/);
  assert.match(zero, /keep similar complexity/);
});
