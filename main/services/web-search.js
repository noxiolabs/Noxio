'use strict';

const DDG_URL = 'https://api.duckduckgo.com/';
const TIMEOUT_MS = 3000;

/**
 * Parses a DDG Text field ("Title — snippet") into { title, snippet }.
 * If no em-dash separator found, the whole text is used as title.
 * @param {string} text
 * @returns {{ title: string, snippet: string }}
 */
function parseText(text) {
  const sep = ' \u2014 '; // ' — '
  const idx = text.indexOf(sep);
  if (idx === -1) return { title: text.trim(), snippet: '' };
  return {
    title: text.slice(0, idx).trim(),
    snippet: text.slice(idx + sep.length).trim(),
  };
}

/**
 * Searches DuckDuckGo using the Instant Answers API.
 * Uses Node 20 / Electron 33 built-in fetch with a 3-second timeout.
 *
 * @param {string} query
 * @returns {Promise<{
 *   abstract: { text: string, url: string, source: string } | null,
 *   results: Array<{ title: string, snippet: string, url: string }>,
 * } | { error: string }>}
 */
async function search(query) {
  if (!query || !query.trim()) {
    return { error: 'query required' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = new URL(DDG_URL);
    url.searchParams.set('q', query.trim());
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_redirect', '1');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');

    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    // Abstract
    const abstract =
      data.AbstractText?.trim()
        ? { text: data.AbstractText.trim(), url: data.AbstractURL || '', source: data.AbstractSource || '' }
        : null;

    // Flat results: Results[] then RelatedTopics[] (skip nested group entries)
    const flatItems = [
      ...(data.Results ?? []),
      ...(data.RelatedTopics ?? []).filter((t) => t.Text && t.FirstURL),
    ];

    const results = flatItems.slice(0, 5).map((item) => {
      const { title, snippet } = parseText(item.Text ?? '');
      return { title, snippet, url: item.FirstURL ?? '' };
    });

    return { abstract, results };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return { error: 'timeout' };
    }
    return { error: err.message ?? 'search failed' };
  }
}

module.exports = { search };
