/**
 * @file installer.js
 * @description Runs the setup wizard installation sequence. Checks that required
 * services are running, then downloads selected LLM models via Ollama. Emits
 * 'install-progress' events throughout so the wizard progress bar stays accurate.
 *
 * v0.1 scope:
 *   - Verify Ollama is reachable (must already be installed by the user)
 *   - Download selected chat/coding models via Ollama pull
 *
 * Deferred to later phases:
 *   - ComfyUI model downloads (Phase 5)
 *   - Whisper / Kokoro model downloads (Phase 6)
 *   - Silent service installation (Ollama, Python, LiteLLM)
 */

'use strict';

const logger = require('../utils/logger');
const ollama = require('../services/ollama');
const { downloadModel } = require('../wizard/model-downloader');

/**
 * Sends an install-progress event to the renderer.
 * @param {import('electron').BrowserWindow} mainWindow
 * @param {string} step
 * @param {number} percent
 * @param {string} message
 */
function emitProgress(mainWindow, step, percent, message) {
  mainWindow.webContents.send('install-progress', { step, percent, message });
}

/**
 * Runs the wizard installation sequence for the selected capabilities and models.
 *
 * Steps:
 *   1. Verify Ollama is reachable
 *   2. Download each LLM model (chat + coding) via Ollama pull
 *   3. Emit completion
 *
 * @param {Object} config
 * @param {string[]} config.capabilities - e.g. ['chat', 'coding', 'voice']
 * @param {Object} config.models - { chat: 'qwen2.5:14b', coding: 'qwen2.5-coder:14b', ... }
 * @param {import('electron').BrowserWindow} mainWindow
 * @returns {Promise<void>}
 */
async function runInstallation(config, mainWindow) {
  logger.info('installer: starting', config);
  const { capabilities = [], models = {} } = config;

  // ── Step 1: Verify Ollama is running ──────────────────────────────────────
  emitProgress(mainWindow, 'check-ollama', 5, 'Checking Ollama...');

  const running = await ollama.checkRunning();
  if (!running) {
    const msg = 'Ollama is not running. Please install and start Ollama, then retry.';
    emitProgress(mainWindow, 'error', 5, msg);
    throw new Error(msg);
  }

  emitProgress(mainWindow, 'check-ollama', 10, 'Ollama is running ✓');

  // ── Step 2: Download LLM models ───────────────────────────────────────────
  // Only chat and coding are Ollama (GGUF) in v0.1.
  // Image = ComfyUI (Phase 5). Voice = Whisper/Kokoro (Phase 6).
  const llmCaps = ['chat', 'coding'].filter(
    (cap) => capabilities.includes(cap) && models[cap]
  );

  const progressRange = 85; // spans 10% → 95%
  const perModel = llmCaps.length > 0 ? progressRange / llmCaps.length : 0;

  for (let i = 0; i < llmCaps.length; i++) {
    const cap = llmCaps[i];
    const model = models[cap];
    const basePercent = 10 + i * perModel;

    emitProgress(mainWindow, `download-${cap}`, Math.round(basePercent), `Downloading ${model}...`);

    try {
      await downloadModel({
        model,
        source: 'ollama',
        onProgress: ({ percent }) => {
          const scaled = Math.round(basePercent + (percent / 100) * perModel);
          emitProgress(mainWindow, `download-${cap}`, scaled, `Downloading ${model}... ${percent}%`);
        },
      });

      emitProgress(
        mainWindow,
        `download-${cap}`,
        Math.round(basePercent + perModel),
        `${model} ready ✓`
      );
    } catch (err) {
      logger.error(`installer: download failed for "${model}" — ${err.message}`);
      emitProgress(mainWindow, 'error', Math.round(basePercent), `Failed to download ${model}: ${err.message}`);
      throw err;
    }
  }

  // ── Step 3: Done ──────────────────────────────────────────────────────────
  emitProgress(mainWindow, 'complete', 100, 'Installation complete ✓');
  logger.info('installer: complete');
}

module.exports = { runInstallation };
