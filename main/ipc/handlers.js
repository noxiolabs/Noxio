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
const { execFile } = require('child_process');
const logger = require('../utils/logger');
const { detectHardware } = require('../infrastructure/detector');
const processManager = require('../infrastructure/process-manager');
const ollama = require('../services/ollama');
const { scanHardware } = require('../wizard/hardware-scan');
const { recommend } = require('../wizard/model-recommender');
const { runInstallation } = require('../infrastructure/installer');

/**
 * Checks if a command is available on PATH by attempting to run it.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<boolean>}
 */
function commandExists(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err) => resolve(!err));
  });
}

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
      logger.error(`IPC: get-hardware-info failed — ${err.message}\n${err.stack}`);
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
      logger.error(`IPC: get-service-statuses failed — ${err.message}\n${err.stack}`);
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
   * Checks whether the required and recommended prerequisites are installed.
   * Returns a map of { ok, version?, note? } per requirement.
   * Used by the wizard PrereqScreen (Screen 1) to show what needs installing.
   * Phase 3.5 (prerequisite checker).
   */
  ipcMain.handle('check-prerequisites', async () => {
    logger.info('IPC: check-prerequisites');

    // ── Ollama (required) ─────────────────────────────────────────────────
    const ollamaRunning = await ollama.checkRunning();

    // ── Python (recommended — needed for LiteLLM/Whisper/Kokoro) ─────────
    const pythonOk = (await commandExists('python', ['--version']))
      || (await commandExists('python3', ['--version']));

    // ── GPU (informational) ───────────────────────────────────────────────
    let gpuName = null;
    let gpuOk = false;
    try {
      const hw = await detectHardware();
      gpuOk  = (hw.gpu?.vramTotalMB ?? 0) > 0;
      gpuName = hw.gpu?.name ?? null;
    } catch (_) { /* non-fatal */ }

    return {
      ollama: {
        ok: ollamaRunning,
        required: true,
        label: 'Ollama',
        note: ollamaRunning ? 'Running on port 11434' : 'Not detected — download and start Ollama',
        link: 'https://ollama.com/download',
      },
      python: {
        ok: pythonOk,
        required: false,
        label: 'Python 3.11+',
        note: pythonOk ? 'Found on PATH' : 'Not found — needed for LiteLLM, Whisper, and Kokoro',
        link: 'https://www.python.org/downloads/',
      },
      gpu: {
        ok: gpuOk,
        required: false,
        label: gpuName ?? 'NVIDIA GPU',
        note: gpuOk ? `${gpuName} detected` : 'No NVIDIA GPU detected — local AI will be slow or unavailable',
        link: null,
      },
    };
  });

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
      logger.error(`IPC: scan-wizard-hardware failed — ${err.message}\n${err.stack}`);
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
      logger.error(`IPC: get-model-recommendations failed — ${err.message}\n${err.stack}`);
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
      logger.error(`IPC: start-installation failed — ${err.message}\n${err.stack}`);
    }
  });

  // ─── Chat ────────────────────────────────────────────────────────────────

  /**
   * Returns all locally available Ollama models.
   * Used by the model selector in the chat panel.
   * Phase 4.
   */
  ipcMain.handle('list-models', async () => {
    try {
      logger.info('IPC: list-models');
      return await ollama.listModels();
    } catch (err) {
      logger.error(`IPC: list-models failed — ${err.message}\n${err.stack}`);
      return [];
    }
  });

  /**
   * Sends the full conversation messages array to Ollama and streams tokens back.
   * Phase 4: accepts full messages array for multi-turn context.
   * Phase 5 will route via LiteLLM for hybrid cloud support.
   * @param {{ messages: Array<{role: string, content: string}>, model: string, conversationId: string }} payload
   */
  ipcMain.handle('send-chat-message', async (_event, { messages, model, conversationId }) => {
    logger.info(`IPC: send-chat-message — model: ${model}, conv: ${conversationId}, turns: ${messages?.length}`);
    try {
      await ollama.generateStream(model, messages, mainWindow);
    } catch (err) {
      // generateStream guarantees stream-complete is sent exactly once via its
      // internal completeSent flag, so no need to send it again here.
      logger.error(`IPC: send-chat-message error — ${err.message}\n${err.stack}`);
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
    logger.info(`IPC: generate-image (stub) — style: ${style}, quality: ${quality}, prompt: "${prompt}"`);
    // Return an explicit not-implemented error so callers can handle it gracefully
    // rather than receiving a misleading install-progress event.
    return { error: 'Image generation is not yet available — coming in Phase 5' };
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

  logger.info('IPC handlers registered (Phase 4)');
}

module.exports = { registerHandlers };
