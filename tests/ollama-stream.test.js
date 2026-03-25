/**
 * @file ollama-stream.test.js
 * @description Unit tests for ollama.js generateStream(). Focuses on the
 * stream-complete deduplication fix: regardless of exit path (done flag,
 * res.end, res.error, req.error, HTTP 404), stream-complete must fire
 * exactly once per request.
 *
 * Uses Node's built-in http module mocked via vi.mock so no real network
 * calls are made. Each test replays a specific response scenario.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { EventEmitter } from 'events';

// ─── Mock http.request ───────────────────────────────────────────────────────

/**
 * Builds a fake ClientRequest / IncomingMessage pair.
 * @returns {{ req: EventEmitter & { write: Function, end: Function },
 *             res: EventEmitter & { statusCode: number } }}
 */
function makeFakeHttp() {
  const res = new EventEmitter();
  res.statusCode = 200;

  const req = new EventEmitter();
  req.write = vi.fn();
  req.end = vi.fn();
  req.destroy = vi.fn(() => req.emit('error', Object.assign(new Error('destroyed'), { code: 'ECONNRESET' })));

  return { req, res };
}

/** Minimal fake win.webContents.send tracker */
function makeFakeWin() {
  const sent = [];
  return {
    events: sent,
    win: {
      isDestroyed: () => false,
      webContents: {
        send: (event, ...args) => sent.push({ event, args }),
      },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ollama.generateStream — stream-complete fires exactly once', () => {
  let requestSpy;

  beforeEach(() => {
    // Replace http.request with our fake so no real socket is opened
    requestSpy = vi.spyOn(http, 'request').mockImplementation((_options, callback) => {
      const { req, res } = makeFakeHttp();
      // Call the response callback asynchronously (mimics real http behaviour)
      if (callback) setImmediate(() => callback(res));
      return req;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset module state so _currentController doesn't leak between tests
    vi.resetModules();
  });

  it('sends stream-complete once when obj.done=true is received', async () => {
    const { req, res } = makeFakeHttp();
    requestSpy.mockImplementationOnce((_opts, cb) => {
      setImmediate(() => {
        cb(res);
        // Emit a done:true NDJSON line
        res.emit('data', Buffer.from(JSON.stringify({ message: { content: 'Hello' }, done: true }) + '\n'));
        // Followed by res.end — would be a second stream-complete without the fix
        res.emit('end');
      });
      return req;
    });

    const { default: ollama } = await import('../main/services/ollama');
    const { win, events } = makeFakeWin();

    await ollama.generateStream('qwen2.5:14b', [{ role: 'user', content: 'Hi' }], win);

    const completions = events.filter((e) => e.event === 'stream-complete');
    expect(completions).toHaveLength(1);
  });

  it('sends stream-complete once when only res.end fires (no done flag)', async () => {
    const { req, res } = makeFakeHttp();
    requestSpy.mockImplementationOnce((_opts, cb) => {
      setImmediate(() => {
        cb(res);
        res.emit('data', Buffer.from(JSON.stringify({ message: { content: 'Hi' }, done: false }) + '\n'));
        res.emit('end');
      });
      return req;
    });

    const { default: ollama } = await import('../main/services/ollama');
    const { win, events } = makeFakeWin();

    await ollama.generateStream('qwen2.5:14b', [{ role: 'user', content: 'Hi' }], win);

    const completions = events.filter((e) => e.event === 'stream-complete');
    expect(completions).toHaveLength(1);
  });

  it('sends stream-complete once on HTTP 404 (model not found)', async () => {
    const { req, res } = makeFakeHttp();
    res.statusCode = 404;
    requestSpy.mockImplementationOnce((_opts, cb) => {
      setImmediate(() => cb(res));
      return req;
    });

    const { default: ollama } = await import('../main/services/ollama');
    const { win, events } = makeFakeWin();

    // 404 causes a ModelNotFoundError rejection — catch it
    await ollama.generateStream('missing:model', [{ role: 'user', content: 'Hi' }], win).catch(() => {});

    const completions = events.filter((e) => e.event === 'stream-complete');
    expect(completions).toHaveLength(1);
  });

  it('sends stream-complete once on response error', async () => {
    const { req, res } = makeFakeHttp();
    requestSpy.mockImplementationOnce((_opts, cb) => {
      setImmediate(() => {
        cb(res);
        res.emit('error', new Error('socket hang up'));
      });
      return req;
    });

    const { default: ollama } = await import('../main/services/ollama');
    const { win, events } = makeFakeWin();

    await ollama.generateStream('qwen2.5:14b', [{ role: 'user', content: 'Hi' }], win);

    const completions = events.filter((e) => e.event === 'stream-complete');
    expect(completions).toHaveLength(1);
  });

  it('forwards stream tokens before stream-complete', async () => {
    const { req, res } = makeFakeHttp();
    requestSpy.mockImplementationOnce((_opts, cb) => {
      setImmediate(() => {
        cb(res);
        res.emit('data', Buffer.from(JSON.stringify({ message: { content: 'Hello' }, done: false }) + '\n'));
        res.emit('data', Buffer.from(JSON.stringify({ message: { content: ' world' }, done: true }) + '\n'));
        res.emit('end');
      });
      return req;
    });

    const { default: ollama } = await import('../main/services/ollama');
    const { win, events } = makeFakeWin();

    await ollama.generateStream('qwen2.5:14b', [{ role: 'user', content: 'Hi' }], win);

    const tokens = events.filter((e) => e.event === 'stream-token').map((e) => e.args[0]);
    expect(tokens).toEqual(['Hello', ' world']);
    expect(events.filter((e) => e.event === 'stream-complete')).toHaveLength(1);
  });
});
