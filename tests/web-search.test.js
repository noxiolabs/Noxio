import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// web-search.js uses globalThis.fetch. We mock it in tests.
const mockFetchSuccess = (body) => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
};

const mockFetchError = (err) => {
  globalThis.fetch = vi.fn().mockRejectedValue(err);
};

describe('web-search', () => {
  let webSearch;

  beforeEach(async () => {
    vi.resetModules();
    webSearch = await import('../main/services/web-search.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns results from SearXNG response', async () => {
    mockFetchSuccess({
      results: [
        { title: 'Node.js', url: 'https://nodejs.org', content: 'A JS runtime built on V8.' },
        { title: 'npm', url: 'https://npmjs.com', content: 'Package manager for Node.js.' },
      ],
    });

    const result = await webSearch.search('nodejs');
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      title: 'Node.js',
      snippet: 'A JS runtime built on V8.',
      url: 'https://nodejs.org',
    });
    expect(result.results[1]).toEqual({
      title: 'npm',
      snippet: 'Package manager for Node.js.',
      url: 'https://npmjs.com',
    });
  });

  it('returns empty results when SearXNG has no hits', async () => {
    mockFetchSuccess({ results: [] });

    const result = await webSearch.search('xyzzy no results');
    expect(result.results).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('caps results at 5', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      content: `Snippet ${i}`,
    }));
    mockFetchSuccess({ results: items });

    const result = await webSearch.search('overflow');
    expect(result.results).toHaveLength(5);
  });

  it('handles missing title/content/url gracefully', async () => {
    mockFetchSuccess({
      results: [{ title: null, url: undefined, content: undefined }],
    });

    const result = await webSearch.search('partial');
    expect(result.results[0]).toEqual({ title: '', snippet: '', url: '' });
  });

  it('returns error object on network failure', async () => {
    mockFetchError(new Error('Network error'));
    const result = await webSearch.search('fail');
    expect(result.error).toBeDefined();
  });

  it('returns error object on timeout', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('AbortError'), { name: 'AbortError' })
    );
    const result = await webSearch.search('timeout');
    expect(result.error).toMatch(/timeout/i);
  });

  it('returns error when query is empty string', async () => {
    const result = await webSearch.search('');
    expect(result.error).toBe('query required');
    expect(globalThis.fetch).not.toHaveBeenCalled?.();
  });

  it('returns error when query is not a string', async () => {
    const result = await webSearch.search(null);
    expect(result.error).toBe('query required');
  });

  it('returns error on non-ok HTTP response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const result = await webSearch.search('down');
    expect(result.error).toMatch(/503/);
  });
});

describe('checkHealth', () => {
  let webSearch;

  beforeEach(async () => {
    vi.resetModules();
    webSearch = await import('../main/services/web-search.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns running:true when SearXNG responds ok', async () => {
    mockFetchSuccess({ results: [] });
    const result = await webSearch.checkHealth();
    expect(result).toEqual({ running: true });
  });

  it('returns running:false when fetch fails', async () => {
    mockFetchError(new Error('ECONNREFUSED'));
    const result = await webSearch.checkHealth();
    expect(result).toEqual({ running: false });
  });

  it('returns running:false on timeout', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('AbortError'), { name: 'AbortError' })
    );
    const result = await webSearch.checkHealth();
    expect(result).toEqual({ running: false });
  });
});

// IPC handler integration — tests handler wiring separately from service
describe('search-web IPC handler (service integration)', () => {
  let webSearch;

  beforeEach(async () => {
    vi.resetModules();
    webSearch = await import('../main/services/web-search.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns results from the service', async () => {
    mockFetchSuccess({
      results: [{ title: 'Test', url: 'https://test.com', content: 'A test result.' }],
    });

    const result = await webSearch.search('test ipc');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Test');
  });

  it('returns error shape when query is missing', async () => {
    const result = await webSearch.search('');
    expect(result.error).toBe('query required');
  });
});
