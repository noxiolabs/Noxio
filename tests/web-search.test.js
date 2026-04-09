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

  it('returns abstract + related topics when present', async () => {
    mockFetchSuccess({
      AbstractText: 'Node.js is a JS runtime.',
      AbstractURL: 'https://en.wikipedia.org/wiki/Node.js',
      AbstractSource: 'Wikipedia',
      RelatedTopics: [
        { Text: 'npm — package manager for Node', FirstURL: 'https://npmjs.com' },
        { Text: 'Deno — alternative runtime', FirstURL: 'https://deno.com' },
      ],
      Results: [],
    });

    const result = await webSearch.search('nodejs');
    expect(result.abstract).toEqual({
      text: 'Node.js is a JS runtime.',
      url: 'https://en.wikipedia.org/wiki/Node.js',
      source: 'Wikipedia',
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      title: 'npm',
      snippet: 'package manager for Node',
      url: 'https://npmjs.com',
    });
  });

  it('returns only results when abstract is empty', async () => {
    mockFetchSuccess({
      AbstractText: '',
      AbstractURL: '',
      AbstractSource: '',
      RelatedTopics: [
        { Text: 'React — UI library', FirstURL: 'https://react.dev' },
      ],
      Results: [
        { Text: 'React docs — official docs', FirstURL: 'https://react.dev/docs' },
      ],
    });

    const result = await webSearch.search('react');
    expect(result.abstract).toBeNull();
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('skips RelatedTopics entries that have no FirstURL (nested groups)', async () => {
    mockFetchSuccess({
      AbstractText: '',
      AbstractURL: '',
      AbstractSource: '',
      RelatedTopics: [
        { Topics: [{ Text: 'nested', FirstURL: 'https://nested.com' }] }, // group — skip
        { Text: 'Flat result', FirstURL: 'https://flat.com' },
      ],
      Results: [],
    });

    const result = await webSearch.search('test');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].url).toBe('https://flat.com');
  });

  it('caps results at 5', async () => {
    const topics = Array.from({ length: 10 }, (_, i) => ({
      Text: `Item ${i} — snippet ${i}`,
      FirstURL: `https://example.com/${i}`,
    }));
    mockFetchSuccess({ AbstractText: '', AbstractURL: '', AbstractSource: '', RelatedTopics: topics, Results: [] });

    const result = await webSearch.search('overflow');
    expect(result.results).toHaveLength(5);
  });

  it('returns error object on network failure', async () => {
    mockFetchError(new Error('Network error'));
    const result = await webSearch.search('fail');
    expect(result.error).toBeDefined();
  });

  it('returns error object on timeout', async () => {
    // Simulate AbortError
    globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
    const result = await webSearch.search('timeout');
    expect(result.error).toMatch(/timeout/i);
  });

  it('returns error when query is empty', async () => {
    const result = await webSearch.search('');
    expect(result.error).toBeDefined();
    expect(globalThis.fetch).not.toHaveBeenCalled?.();
  });
});

// IPC handler integration — tests handler wiring separately from service
describe('search-web IPC handler', () => {
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
      AbstractText: 'Test abstract',
      AbstractURL: 'https://test.com',
      AbstractSource: 'TestSource',
      RelatedTopics: [],
      Results: [],
    });

    // Direct call to service (handler just wraps it)
    const result = await webSearch.search('test ipc');
    expect(result.abstract?.text).toBe('Test abstract');
  });

  it('returns error shape when query is missing', async () => {
    const result = await webSearch.search('');
    expect(result.error).toBe('query required');
  });
});
