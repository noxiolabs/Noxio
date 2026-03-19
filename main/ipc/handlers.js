/**
 * @file handlers.js
 * @description Registers all IPC channel handlers for the Electron main process.
 * This is the single source of truth for every channel — every channel used in
 * preload.js must have a corresponding handler registered here.
 *
 * Phase 1: All handlers are stubs that return safe placeholder data.
 * Each stub is marked with a TODO pointing to the Phase where it gets wired up.
 *
 * Channels (Renderer → Main, invoke):
 *   get-hardware-info         → Phase 2: detector.js
 *   get-service-statuses      → Phase 2: health-checker.js
 *   switch-mode               → Phase 5: orchestrator.js
 *   get-model-recommendations → Phase 3: model-recommender.js
 *   start-installation        → Phase 3: installer.js + model-downloader.js
 *   send-chat-message         → Phase 4: ollama.js via litellm.js
 *   stop-stream               → Phase 4: ollama.js
 *   generate-image            → Phase 5: comfyui.js
 *   start-recording           → Phase 6: whisper.js
 *   stop-recording            → Phase 6: whisper.js
 */

'use strict';

const { ipcMain } = require('electron');
const logger = require('../utils/logger');

/**
 * Registers all IPC handlers. Must be called once after the BrowserWindow is created
 * so that mainWindow is available for push events (main → renderer).
 *
 * @param {import('electron').BrowserWindow} mainWindow
 */
function registerHandlers(mainWindow) {
  // ─── Hardware & Service Info ─────────────────────────────────────────────

  /**
   * Returns detected hardware information.
   * TODO Phase 2: wire to main/infrastructure/detector.js
   */
  ipcMain.handle('get-hardware-info', async () => {
    logger.info('IPC: get-hardware-info (stub)');
    return {
      gpu: 'Detection pending',
      vramTotalGB: 0,
      vramFreeGB: 0,
      ramGB: 0,
      os: process.platform,
      driver: 'Unknown',
    };
  });

  /**
   * Returns current status of all background services.
   * TODO Phase 2: wire to main/infrastructure/health-checker.js
   */
  ipcMain.handle('get-service-statuses', async () => {
    logger.info('IPC: get-service-statuses (stub)');
    return {
      ollama: { status: 'stopped', pid: null },
      litellm: { status: 'stopped', pid: null },
      comfyui: { status: 'stopped', pid: null },
      whisper: { status: 'stopped', pid: null },
      kokoro: { status: 'stopped', pid: null },
    };
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
   * Returns model recommendations based on selected capabilities and available VRAM.
   * TODO Phase 3: wire to main/wizard/model-recommender.js
   */
  ipcMain.handle('get-model-recommendations', async (_event, capabilities) => {
    logger.info(`IPC: get-model-recommendations (stub) — capabilities: ${capabilities}`);
    // Stub returns the 10–18GB tier (RTX 5080 reference hardware)
    return {
      chat: { model: 'qwen2.5:14b', sizeGB: 8.5 },
      coding: { model: 'qwen2.5-coder:14b', sizeGB: 8.5 },
      image: { model: 'FLUX.1-schnell-fp8', sizeGB: 9.0 },
      voice: { stt: 'faster-whisper-large-v3', tts: 'kokoro', sizeGB: 1.5 },
    };
  });

  /**
   * Starts the installation sequence for selected services and models.
   * Emits 'install-progress' events during installation.
   * TODO Phase 3: wire to main/infrastructure/installer.js + main/wizard/model-downloader.js
   */
  ipcMain.handle('start-installation', async (_event, config) => {
    logger.info('IPC: start-installation (stub)', config);
    // Stub: emit a single progress event then complete
    mainWindow.webContents.send('install-progress', {
      step: 'stub',
      percent: 100,
      message: 'Installation stub — wire up Phase 3',
    });
  });

  // ─── Chat ────────────────────────────────────────────────────────────────

  /**
   * Sends a message to the LLM via LiteLLM → Ollama (or cloud fallback).
   * Streams tokens back via 'stream-token' events. Signals completion via
   * 'stream-complete'.
   * TODO Phase 4: wire to main/services/litellm.js (which routes to ollama.js or cloud)
   */
  ipcMain.handle('send-chat-message', async (_event, { message, model, conversationId }) => {
    logger.info(`IPC: send-chat-message (stub) — model: ${model}, conv: ${conversationId}`);
    // Stub: echo the message back as a fake streamed response
    const words = `[Stub] You said: "${message}". Wire up Phase 4 to get real responses.`.split(' ');
    for (const word of words) {
      mainWindow.webContents.send('stream-token', word + ' ');
      await new Promise((r) => setTimeout(r, 40));
    }
    mainWindow.webContents.send('stream-complete');
  });

  /**
   * Stops an active streaming response.
   * TODO Phase 4: wire to main/services/ollama.js abort logic
   */
  ipcMain.handle('stop-stream', async () => {
    logger.info('IPC: stop-stream (stub)');
    mainWindow.webContents.send('stream-complete');
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

  logger.info('IPC handlers registered (Phase 1 stubs)');
}

module.exports = { registerHandlers };
