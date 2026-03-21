/**
 * @file installer.test.js
 * @description Unit tests for the setup wizard installer.
 * Tests run against real Ollama connection (not available in CI) — so only
 * the error path (Ollama not running) and structural behaviour are verified.
 * Full integration tests require Ollama running on port 11434.
 */

import { describe, it, expect } from 'vitest';
import { runInstallation } from '../main/infrastructure/installer';

/** Creates a fake mainWindow that records all emitted install-progress events. */
function makeMainWindow() {
  const events = [];
  return {
    webContents: { send: (_channel, data) => events.push(data) },
    events,
  };
}

describe('runInstallation() — Ollama not running', () => {
  it('throws when Ollama is not reachable', async () => {
    const win = makeMainWindow();
    await expect(
      runInstallation({ capabilities: ['chat'], models: { chat: 'qwen2.5:14b' } }, win)
    ).rejects.toThrow();
  });

  it('emits a check-ollama step before throwing', async () => {
    const win = makeMainWindow();
    await runInstallation({ capabilities: [], models: {} }, win).catch(() => {});
    expect(win.events.some((e) => e.step === 'check-ollama')).toBe(true);
  });

  it('emits an error step with a descriptive message', async () => {
    const win = makeMainWindow();
    await runInstallation({ capabilities: ['chat'], models: { chat: 'qwen2.5:14b' } }, win).catch(() => {});
    const errorEvent = win.events.find((e) => e.step === 'error');
    expect(errorEvent).toBeDefined();
    expect(typeof errorEvent.message).toBe('string');
    expect(errorEvent.message.length).toBeGreaterThan(0);
  });

  it('all emitted events have step, percent, and message fields', async () => {
    const win = makeMainWindow();
    await runInstallation({ capabilities: ['chat'], models: { chat: 'qwen2.5:14b' } }, win).catch(() => {});
    win.events.forEach((e) => {
      expect(e).toHaveProperty('step');
      expect(e).toHaveProperty('percent');
      expect(e).toHaveProperty('message');
      expect(typeof e.message).toBe('string');
    });
  });
});
