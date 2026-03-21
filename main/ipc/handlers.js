/**
 * @file handlers.js
 * @description Registers all IPC channel handlers for the Electron main process.
 * This is the single source of truth for every channel — every channel used in
 * preload.js must have a corresponding handler registered here.
 *
 * Phase 2: hardware detection, service status, and chat streaming are wired to
 * their real implementations. Remaining channels retain Phase 1 stubs with TODO
 * markers for the phases that implement them.
 *
 * Channels (Renderer → Main, invoke):
 *   get-hardware-info         → Phase 2: detector.js          ✓
 *   get-service-statuses      → Phase 2: process-manager.js   ✓
 *   switch-mode               → Phase 5: orchestrator.js
 *   get-model-recommendations → Phase 3: model-recommender.js
 *   start-installation        → Phase 3: installer.js + model-downloader.js
 *   send-chat-message         → Phase 2: ollama.js            ✓
 *   stop-stream               → Phase 2: ollama.js            ✓
 *   generate-image            → Phase 5: comfyui.js
 *   start-recording           → Phase 6: whisper.js
 *   stop-recording            → Phase 6: whisper.js
 */

'use strict';

const { ipcMain } = require('electron');
const logger = require('../utils/logger');
const { detectHardware } = require('../infrastructure/detector');
const processManager = require('../infrastructure/process-manager');
const ollama = require('../services/ollama');
const { scanHardware } = require('../wizard/hardware-scan');
const { recommend } = require('../wizard/model-recommender');
const { runInstallation } = require('../infrastructure/installer');

/**
 * Registers all IPC handlers. Must be called once after the BrowserWindow is created
 * so that mainWindow is available for push events (main → renderer).
 *
 * @param {import('electron').BrowserWindow} mainWindow
 */
function registerHandlers(mainWindow) {
  // ─── Hardware & Service Info ─────────────────────────────────────────────

  /**
   * Returns detected hardware information (GPU, RAM, CPU, OS).
   * Wired to detector.js — Phase 2.
   */
  ipcMain.handle('get-hardware-info', async () => {
    try {
      logger.info('IPC: get-hardware-info');
      return await detectHardware();
    } catch (err) {
      logger.error(`IPC: get-hardware-info failed — ${err.message}`);
      return { error: err.message };
    }
  });

  /**
   * Returns current process-level status of all background services.
   * Wired to process-manager.js — Phase 2.
   */
  ipcMain.handle('get-service-statuses', () => {
    try {
      logger.info('IPC: get-service-statuses');
      return processManager.getServiceStates();
    } catch (err) {
      logger.error(`IPC: get-service-statuses failed — ${err.message}`);
      return { error: err.message };
    }
  });

  // ─── Mode Switching ──────────────────────────────────────────────────────

  /**
   * Switches the active workload mode. Triggers VRAM orchestration as needed.
   * Emits 'mode-ready' event back to renderer when the switch is complete.
   * TODO Phase 5: wire to main/infrastructure/orchestrator.js
   */
  ipcMain.handle('switch-mode', async (_event, mode) => {
    logger.info(`IPC: switch-mode → ${mode} (stub)`);
    const validModes = ['chat', 'create', 'voice', 'agent', 'gaming'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    // Stub: immediately report mode as ready
    mainWindow.webContents.send('mode-ready', mode);
  });

  // ─── Setup Wizard ────────────────────────────────────────────────────────

  /**
   * Returns enriched hardware info for the wizard hardware screen.
   * Includes VRAM tier and capability flags (canRunChat, canRunImage, etc.).
   * Phase 3.
   */
  ipcMain.handle('scan-wizard-hardware', async () => {
    try {
      logger.info('IPC: scan-wizard-hardware');
      return await scanHardware();
    } catch (err) {
      logger.error(`IPC: scan-wizard-hardware failed — ${err.message}`);
      return { error: err.message };
    }
  });

  /**
   * Returns model recommendations based on selected capabilities and available VRAM.
   * Wired to hardware-scan.js + model-recommender.js — Phase 3.
   */
  ipcMain.handle('get-model-recommendations', async (_event, capabilities) => {
    try {
      logger.info(`IPC: get-model-recommendations — capabilities: ${capabilities}`);
      const hardware = await scanHardware();
      return recommend(hardware.vramTier, capabilities);
    } catch (err) {
      logger.error(`IPC: get-model-recommendations failed — ${err.message}`);
      return { error: err.message };
    }
  });

  /**
   * Starts the installation sequence for selected services and models.
   * Emits 'install-progress' events during installation.
   * Wired to installer.js + model-downloader.js — Phase 3.
   */
  ipcMain.handle('start-installation', async (_event, config) => {
    try {
      logger.info('IPC: start-installation', config);
      await runInstallation(config, mainWindow);
    } catch (err) {
      logger.error(`IPC: start-installation failed — ${err.message}`);
    }
  });

  // ─── Chat ────────────────────────────────────────────────────────────────

  /**
   * Sends a message to the LLM via Ollama and streams tokens to the renderer.
   * Phase 2: routes directly to Ollama, bypassing LiteLLM routing.
   * Phase 4 will load conversation history from Redux and route via litellm.js.
   * @param {{ message: string, model: string, conversationId: string }} payload
   */
  ipcMain.handle('send-chat-message', async (_event, { message, model, conversationId }) => {
    logger.info(`IPC: send-chat-message — model: ${model}, conv: ${conversationId}`);
    try {
      // Phase 2: minimal single-turn messages array.
      // Phase 4 will load the full conversation history from Redux state.
      const messages = [{ role: 'user', content: message }];
      await ollama.generateStream(model, messages, mainWindow);
    } catch (err) {
      logger.error(`IPC: send-chat-message error — ${err.message}`);
      // Always send stream-complete so the renderer doesn't hang in streaming state
      mainWindow.webContents.send('stream-complete');
    }
  });

  /**
   * Aborts the currently active streaming response.
   * Wired to ollama.stopGeneration() — Phase 2.
   */
  ipcMain.handle('stop-stream', () => {
    logger.info('IPC: stop-stream');
    try {
      ollama.stopGeneration();
    } catch (err) {
      logger.error(`IPC: stop-stream error — ${err.message}`);
    }
  });

  // ─── Image Generation ────────────────────────────────────────────────────

  /**
   * Triggers image generation via ComfyUI.
   * TODO Phase 5: wire to main/services/comfyui.js
   */
  ipcMain.handle('generate-image', async (_event, { prompt, style, quality }) => {
    logger.info(`IPC: generate-image (stub) — style: ${style}, quality: ${quality}`);
    mainWindow.webContents.send('install-progress', {
      step: 'image-gen',
      percent: 100,
      message: `Image generation stub — prompt: "${prompt}"`,
    });
  });

  // ─── Voice ───────────────────────────────────────────────────────────────

  /**
   * Starts microphone recording for speech-to-text.
   * TODO Phase 6: wire to main/services/whisper.js
   */
  ipcMain.handle('start-recording', async () => {
    logger.info('IPC: start-recording (stub)');
  });

  /**
   * Stops recording and returns transcribed text.
   * TODO Phase 6: wire to main/services/whisper.js
   * @returns {Promise<string>} Transcribed text
   */
  ipcMain.handle('stop-recording', async () => {
    logger.info('IPC: stop-recording (stub)');
    return '[Voice transcription stub — wire up Phase 6]';
  });

  logger.info('IPC handlers registered (Phase 3)');
}

module.exports = { registerHandlers };
