'use strict';

const { execFile } = require('child_process');

const SEARXNG_URL = 'http://localhost:8080/search';
const SEARXNG_ROOT = 'http://localhost:8080/';
const CONTAINER_NAME = 'noxio-searxng';
const TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_MS = 2000;
const START_WAIT_MS = 20_000;

/** Headers required by SearXNG's bot detection when called from localhost. */
const SEARXNG_HEADERS = {
  'X-Forwarded-For': '127.0.0.1',
  'X-Real-IP': '127.0.0.1',
};

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
 * Attempts to start the noxio-searxng Docker container.
 * @returns {Promise<void>}
 */
function startContainer() {
  return new Promise((resolve, reject) =>
    execFile(
      'docker',
      ['start', CONTAINER_NAME],
      { timeout: 15_000, windowsHide: true },
      (err) => (err ? reject(new Error(err.message.split('\n')[0])) : resolve())
    )
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
 * Ensures SearXNG is running. Starts the Docker container if it is not.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function ensureRunning() {
  const { running } = await checkHealth();
  if (running) return { ok: true };

  try {
    await startContainer();
  } catch (err) {
    return { ok: false, error: `Failed to start SearXNG container: ${err.message}` };
  }

  const ready = await waitUntilReady();
  return ready
    ? { ok: true }
    : { ok: false, error: 'SearXNG did not become ready in time' };
}

/**
 * Searches via local SearXNG and returns up to 5 results.
 * Automatically starts the Docker container if it is not already running.
 *
 * @param {string} query
 * @returns {Promise<{
 *   results: Array<{ title: string, snippet: string, url: string }>,
 * } | { error: string }>}
 */
async function search(query) {
  if (typeof query !== 'string' || !query.trim()) {
    return { error: 'query required' };
  }

  const { ok, error: startError } = await ensureRunning();
  if (!ok) return { error: startError ?? 'SearXNG is not running' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = new URL(SEARXNG_URL);
    url.searchParams.set('q', query.trim());
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'en');

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: SEARXNG_HEADERS,
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    const results = (data.results ?? []).slice(0, 5).map((item) => ({
      title: item.title ?? '',
      snippet: item.content ?? '',
      url: item.url ?? '',
    }));

    return { results };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { error: 'timeout' };
    }
    return { error: err.message ?? 'search failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { search, checkHealth, ensureRunning };
