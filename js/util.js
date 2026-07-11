    function escapeHtml(text) {
      return (text == null ? '' : String(text))
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function toneLabel(v) { return v <= -60 ? 'Very Casual' : v <= -20 ? 'Casual' : v < 20 ? 'Neutral' : v < 60 ? 'Formal' : 'Very Formal'; }
    function lengthLabel(v) { return v <= -60 ? 'Much Shorter' : v <= -20 ? 'Shorter' : v < 20 ? 'Same' : v < 60 ? 'Longer' : 'Much Longer'; }
    function complexityLabel(v) { return v <= -60 ? 'Very Simple' : v <= -20 ? 'Simple' : v < 20 ? 'Moderate' : v < 60 ? 'Elaborate' : 'Very Elaborate'; }

    function buildParamPrompt(text, tone, length, complexity, audience, intent) {
      return `Rewrite the following text with these parameters:
- Tone: ${toneLabel(tone)} (${tone > 0 ? 'more formal' : tone < 0 ? 'more casual' : 'keep similar'})
- Length: ${lengthLabel(length)} (${length > 0 ? 'expand and elaborate' : length < 0 ? 'condense and shorten' : 'keep similar length'})
- Complexity: ${complexityLabel(complexity)} (${complexity > 0 ? 'use more sophisticated vocabulary and elaborate sentence structures' : complexity < 0 ? 'use simpler words and shorter sentences' : 'keep similar complexity'})
- Audience: ${audience}
- Intent: ${intent}

Original text:
${text}

Provide ONLY the rewritten text, no explanations or preamble.`;
    }

    // Simple word-level diff (LCS). lcsParts() is the shared core;
    // computeDiff() renders HTML and computeDiffStats() derives magnitudes.
    function lcsParts(oldText, newText) {
      const oldWords = oldText.split(/(\s+)/);
      const newWords = newText.split(/(\s+)/);
      const m = oldWords.length;
      const n = newWords.length;

      const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          if (oldWords[i - 1] === newWords[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1] + 1;
          } else {
            dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
          }
        }
      }

      const result = [];
      let i = m, j = n;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
          result.unshift({ type: 'same', text: oldWords[i - 1] });
          i--;
          j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          result.unshift({ type: 'added', text: newWords[j - 1] });
          j--;
        } else {
          result.unshift({ type: 'removed', text: oldWords[i - 1] });
          i--;
        }
      }
      return result;
    }

    function computeDiff(oldText, newText) {
      let html = '';
      for (const part of lcsParts(oldText, newText)) {
        const escaped = escapeHtml(part.text);
        if (part.type === 'added') {
          html += `<span class="diff-added">${escaped}</span>`;
        } else if (part.type === 'removed') {
          html += `<span class="diff-removed">${escaped}</span>`;
        } else {
          html += escaped;
        }
      }
      return html;
    }

    // Word-level change magnitude (counts non-whitespace tokens), derived from
    // the same lcsParts() core as computeDiff so the metric matches the diff.
    function computeDiffStats(oldText, newText) {
      let added = 0, removed = 0, same = 0;
      const isWord = t => t && t.trim() !== '';
      for (const part of lcsParts(oldText, newText)) {
        if (!isWord(part.text)) continue;
        if (part.type === 'same') same++;
        else if (part.type === 'added') added++;
        else removed++;
      }
      const changed = added + removed;
      const denom = (added + removed + same) || 1;
      return { added, removed, same, changed, ratio: changed / denom };
    }

    function parseJsonLoose(text) {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Model did not return JSON');
      return JSON.parse(match[0]);
    }

    if (typeof module !== 'undefined' && module.exports) { module.exports = { escapeHtml, toneLabel, lengthLabel, complexityLabel, buildParamPrompt, lcsParts, computeDiff, computeDiffStats, parseJsonLoose }; }
