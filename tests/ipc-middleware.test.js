/**
 * @file ipc-middleware.test.js
 * @description Unit tests for ipc-middleware.js. Covers:
 *   - ipcMiddleware: forwards actions with meta.ipc to window.electronAPI
 *   - ipcMiddleware: logs an error when meta.ipc=true but channel is missing
 *   - ipcMiddleware: action still passes through to Redux next() regardless
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMiddleware } from '../renderer/store/middleware/ipc-middleware';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Runs an action through the middleware and returns what next() received.
 * @param {Object} action - Redux action
 * @returns {Object} The action passed to next()
 */
function runMiddleware(action) {
  let received;
  const next = (a) => { received = a; };
  ipcMiddleware({})(next)(action);
  return received;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

let mockListModels;
let mockSendChatMessage;

beforeEach(() => {
  mockListModels = vi.fn();
  mockSendChatMessage = vi.fn();

  // Simulate window.electronAPI being present (Electron preload bridge)
  global.window = {
    electronAPI: {
      listModels: mockListModels,
      sendChatMessage: mockSendChatMessage,
    },
  };
});

afterEach(() => {
  delete global.window;
  vi.restoreAllMocks();
});

// ─── ipcMiddleware ────────────────────────────────────────────────────────────

describe('ipcMiddleware', () => {
  it('always passes the action through to next()', () => {
    const action = { type: 'test/action', payload: 42 };
    const result = runMiddleware(action);
    expect(result).toEqual(action);
  });

  it('calls the matching electronAPI method when meta.ipc=true', () => {
    runMiddleware({ type: 'chat/list', meta: { ipc: true, channel: 'listModels', args: [] } });
    expect(mockListModels).toHaveBeenCalledOnce();
  });

  it('passes args correctly to the channel method', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    runMiddleware({
      type: 'chat/send',
      meta: { ipc: true, channel: 'sendChatMessage', args: [messages, 'qwen2.5:14b', 'conv-1'] },
    });
    expect(mockSendChatMessage).toHaveBeenCalledWith(messages, 'qwen2.5:14b', 'conv-1');
  });

  it('does nothing when meta.ipc is false', () => {
    runMiddleware({ type: 'chat/list', meta: { ipc: false, channel: 'listModels' } });
    expect(mockListModels).not.toHaveBeenCalled();
  });

  it('does nothing when meta is absent', () => {
    runMiddleware({ type: 'chat/list' });
    expect(mockListModels).not.toHaveBeenCalled();
  });

  it('does nothing when window.electronAPI is absent', () => {
    delete global.window.electronAPI;
    // Should not throw even without the API bridge
    expect(() => {
      runMiddleware({ type: 'x', meta: { ipc: true, channel: 'listModels' } });
    }).not.toThrow();
  });

  it('logs an error and skips the call when channel is missing (validation fix)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    runMiddleware({ type: 'broken/action', meta: { ipc: true } });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('no channel specified');
    expect(mockListModels).not.toHaveBeenCalled();
  });

  it('does not throw when channel is not on electronAPI (optional chaining)', () => {
    expect(() => {
      runMiddleware({ type: 'x', meta: { ipc: true, channel: 'nonExistentMethod' } });
    }).not.toThrow();
  });
});
