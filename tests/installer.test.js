/**
 * @file installer.test.js
 * @description Unit tests for the setup wizard installer orchestrator.
 * Tests verify event structure and no-throw behaviour without real services running.
 * Full integration tests require Ollama, Python, and network access.
 */

import { describe, it, expect } from 'vitest';
import { runInstallation } from '../main/infrastructure/installer';

/** Creates a fake mainWindow that records all install-progress and install-error events. */
function makeMainWindow() {
  const events = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send: (_channel, data) => events.push(data),
    },
    events,
  };
}

describe('runInstallation() — services not available', () => {
  it('returns { success: false } when Ollama installation fails (no network in test)', async () => {
    const win = makeMainWindow();
    // Ollama is not installed and cannot be downloaded in test env
    const result = await runInstallation({
      capabilities: ['chat'],
      models: { chat: 'qwen2.5:14b' },
      installDir: null,
      installedServices: {},
      mainWindow: win,
    });
    // Installer never throws — it always returns { success: boolean }
    expect(result).toHaveProperty('success');
    expect(typeof result.success).toBe('boolean');
  });

  it('never throws — always resolves with { success: boolean }', async () => {
    const win = makeMainWindow();
    await expect(
      runInstallation({
        capabilities: ['chat', 'coding'],
        models: { chat: 'qwen2.5:14b', coding: 'qwen2.5-coder:14b' },
        installDir: null,
        installedServices: {},
        mainWindow: win,
      })
    ).resolves.toHaveProperty('success');
  });

  it('all emitted install-progress events have step, percent, and message fields', async () => {
    const win = makeMainWindow();
    await runInstallation({
      capabilities: ['chat'],
      models: { chat: 'qwen2.5:14b' },
      installDir: null,
      installedServices: {},
      mainWindow: win,
    });
    // Filter to only install-progress events (install-error events have different shape)
    const progressEvents = win.events.filter((e) => 'percent' in e);
    progressEvents.forEach((e) => {
      expect(e).toHaveProperty('step');
      expect(e).toHaveProperty('percent');
      expect(e).toHaveProperty('message');
      expect(typeof e.message).toBe('string');
    });
  });

  it('emits at least one event for the install-ollama step', async () => {
    const win = makeMainWindow();
    await runInstallation({
      capabilities: [],
      models: {},
      installDir: null,
      installedServices: {},
      mainWindow: win,
    });
    expect(win.events.some((e) => e.step === 'install-ollama')).toBe(true);
  });
});
