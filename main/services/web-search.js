'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SEARXNG_URL = 'http://localhost:8080/search';
const SEARXNG_ROOT = 'http://localhost:8080/';
const CONTAINER_NAME = 'noxio-searxng';
const TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_MS = 2000;
const START_WAIT_MS = 30_000;

/** Headers required by SearXNG's bot detection when called from localhost. */
const SEARXNG_HEADERS = {
  'X-Forwarded-For': '127.0.0.1',
  'X-Real-IP': '127.0.0.1',
};

/** settings.yml written into the container volume mount. */
const SETTINGS_YML = [
  'use_default_settings: true',
  '',
  'server:',
  '  # Override the default "ultrasecretkey" — newer SearXNG refuses to start without this.',
  '  secret_key: "noxio-local-not-public"',
  '',
  'search:',
  '  formats:',
  '    - html',
  '    - json',
  '',
  '# Disable engines that fail to initialise on the default Docker image.',
  'engines:',
  '  - name: wikidata',
  '    disabled: true',
  '  - name: ahmia',
  '    disabled: true',
  '  - name: torch',
  '    disabled: true',
  '',
].join('\n');

/**
 * Checks if SearXNG is reachable at localhost:8080.
 * @returns {Promise<{ running: boolean }>}
 */
async function checkHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(SEARXNG_ROOT, {
      signal: controller.signal,
      headers: SEARXNG_HEADERS,
    });
    return { running: response.ok };
  } catch (_) {
    return { running: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs a docker command and resolves on success, rejects on failure.
 * @param {string[]} args
 * @param {number} [timeout]
 * @returns {Promise<void>}
 */
function runDocker(args, timeout = 15_000) {
  return new Promise((resolve, reject) =>
    execFile(
      'docker',
      args,
      { timeout, windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) {
          // Prefer stderr — that's where Docker writes "Error response from daemon: No such container: …"
          // Fall back to err.message if stderr is empty.
          const detail = (stderr?.trim() || err.message).split('\n')[0];
          reject(new Error(detail));
        } else {
          resolve();
        }
      }
    )
  );
}

/**
 * Attempts to start the existing noxio-searxng Docker container.
 * @returns {Promise<void>}
 */
function startContainer() {
  return runDocker(['start', CONTAINER_NAME]);
}

/**
 * Creates and starts the noxio-searxng container for the first time.
 * @param {string} searxngDir - Directory already prepared by ensureRunning (settings.yml written)
 * @returns {Promise<void>}
 */
function createContainer(searxngDir) {
  return runDocker(
    [
      'run', '-d',
      '--name', CONTAINER_NAME,
      '-p', '8080:8080',
      '--restart', 'unless-stopped',
      '-v', `${searxngDir}:/etc/searxng`,
      'searxng/searxng',
    ],
    60_000
  );
}

/**
 * Polls SearXNG until it responds or the deadline is reached.
 * @returns {Promise<boolean>}
 */
async function waitUntilReady() {
  const deadline = Date.now() + START_WAIT_MS;
  while (Date.now() < deadline) {
    const { running } = await checkHealth();
    if (running) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Ensures SearXNG is running.
 * - If the container is stopped: starts it.
 * - If the container doesn't exist: creates it with correct settings.yml, then starts it.
 *
 * @param {string|null} [configDir] - Base install directory used to locate/create settings.yml
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function ensureRunning(configDir) {
  const { running } = await checkHealth();
  if (running) return { ok: true };

  const searxngDir = configDir
    ? path.join(configDir, 'searxng')
    : path.join(os.tmpdir(), 'noxio-searxng');

  // Always write a fresh settings.yml with the correct secret_key.
  try {
    fs.mkdirSync(searxngDir, { recursive: true });
    fs.writeFileSync(path.join(searxngDir, 'settings.yml'), SETTINGS_YML, 'utf8');
  } catch (_) { /* non-fatal */ }

  let needsCreate = false;

  // Try starting the existing (stopped) container
  try {
    await startContainer();

    // `docker start` exits 0 the moment the container process begins — SearXNG can
    // still crash a second or two later (e.g. bad secret_key in the mounted config).
    // Poll briefly to detect an immediate crash before falling through to waitUntilReady.
    await new Promise((r) => setTimeout(r, 3000));
    const { running: upNow } = await checkHealth();
    if (!upNow) {
      // Container started but crashed — force-remove it so we can recreate with the
      // correct volume mount pointing at our freshly-written settings.yml.
      needsCreate = true;
      await runDocker(['rm', '-f', CONTAINER_NAME]).catch(() => {});
    }
  } catch (err) {
    const msg = err.message.toLowerCase();
    if (msg.includes('no such container') || msg.includes('error response from daemon')) {
      needsCreate = true;
    } else {
      return { ok: false, error: `Failed to start SearXNG container: ${err.message}` };
    }
  }

  if (needsCreate) {
    try {
      await createContainer(searxngDir);
    } catch (createErr) {
      return { ok: false, error: `Failed to create SearXNG container: ${createErr.message}` };
    }
  }

  const ready = await waitUntilReady();
  return ready
    ? { ok: true }
    : { ok: false, error: 'SearXNG is starting but not yet ready — try again in a moment' };
}

/** Strip HTML tags and decode common entities. */
function stripHtml(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Queries SearXNG directly. Assumes it is already running — does NOT start it.
 * @param {string} query
 * @returns {Promise<Array<{ title: string, snippet: string, url: string }>>}
 */
async function searchSearXNG(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(SEARXNG_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'en');
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: SEARXNG_HEADERS,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return (data.results ?? []).slice(0, 5).map((item) => ({
      title: item.title ?? '',
      snippet: item.content ?? '',
      url: item.url ?? '',
    }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scrapes DuckDuckGo HTML results. No API key or Docker required.
 * @param {string} query
 * @returns {Promise<Array<{ title: string, snippet: string, url: string }>>}
 */
async function searchDDG(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      body: new URLSearchParams({ q: query }).toString(),
      signal: controller.signal,
    });
    const html = await resp.text();

    const results = [];
    const titleRe = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const titles = [];
    const urls = [];
    let m;

    while ((m = titleRe.exec(html)) !== null && titles.length < 5) {
      const rawHref = m[1];
      const title = stripHtml(m[2]);
      // DDG wraps URLs — extract uddg param if present
      const uddg = new URLSearchParams(rawHref.includes('?') ? rawHref.split('?')[1] : '').get('uddg');
      urls.push(uddg ? decodeURIComponent(uddg) : rawHref);
      titles.push(title);
    }

    const snippets = [];
    while ((m = snippetRe.exec(html)) !== null && snippets.length < 5) {
      snippets.push(stripHtml(m[1]));
    }

    for (let i = 0; i < titles.length; i++) {
      if (!urls[i]) continue;
      results.push({ title: titles[i], url: urls[i], snippet: snippets[i] ?? '' });
    }

    if (results.length === 0) throw new Error('no results');
    return results;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Falls back to the Wikipedia search API. Always available, no auth required.
 * @param {string} query
 * @returns {Promise<Array<{ title: string, snippet: string, url: string }>>}
 */
async function searchWikipedia(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5`;
    const resp = await fetch(url, { signal: controller.signal });
    const data = await resp.json();
    const hits = data?.query?.search ?? [];
    if (hits.length === 0) throw new Error('no results');
    return hits.map((h) => ({
      title: h.title ?? '',
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title ?? '')}`,
      snippet: stripHtml(h.snippet ?? ''),
    }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Searches the web using a tiered fallback:
 *   1. SearXNG (if already running — no container startup wait)
 *   2. DuckDuckGo HTML scraping (no Docker, no API key)
 *   3. Wikipedia API (last resort)
 *
 * @param {string} query
 * @param {string|null} [_configDir] - Unused; kept for API compatibility
 * @returns {Promise<{
 *   results: Array<{ title: string, snippet: string, url: string }>,
 *   source: 'searxng' | 'ddg' | 'wikipedia',
 * } | { error: string }>}
 */
async function search(query, _configDir) {
  if (typeof query !== 'string' || !query.trim()) {
    return { error: 'query required' };
  }
  const q = query.trim();

  // Tier 1: SearXNG — only if already running, no blocking startup wait
  const { running } = await checkHealth();
  if (running) {
    try {
      const results = await searchSearXNG(q);
      if (results.length > 0) return { results, source: 'searxng' };
    } catch (_) { /* fall through */ }
  }

  // Tier 2: DuckDuckGo HTML scraping
  try {
    const results = await searchDDG(q);
    return { results, source: 'ddg' };
  } catch (_) { /* fall through */ }

  // Tier 3: Wikipedia
  try {
    const results = await searchWikipedia(q);
    return { results, source: 'wikipedia' };
  } catch (_) { /* fall through */ }

  return { error: 'All search methods failed' };
}

module.exports = { search, checkHealth, ensureRunning };
