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

const { ipcMain, app, dialog } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { detectHardware } = require('../infrastructure/detector');
const processManager = require('../infrastructure/process-manager');
const ollama = require('../services/ollama');
const { isOllamaInstalled } = require('../wizard/ollama-installer');
const orchestrator = require('../infrastructure/orchestrator');
const { scanHardware } = require('../wizard/hardware-scan');
const { recommend } = require('../wizard/model-recommender');
const { runInstallation } = require('../infrastructure/installer');

// electron-store — persists settings across app restarts
const Store = require('electron-store');
const store = new Store({ name: 'noxio-settings' });

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
   * Switches the active workload mode. Triggers VRAM orchestration via orchestrator.js.
   * Emits 'mode-ready' event back to renderer when the switch is complete.
   * Non-fatal: on failure, still emits 'mode-ready' so the UI doesn't hang.
   * Phase 5.
   * @param {{ targetMode: string, currentMode: string }} payload
   */
  ipcMain.handle('switch-mode', async (_event, { targetMode, currentMode } = {}) => {
    logger.info(`IPC: switch-mode ${currentMode} → ${targetMode}`);
    const validModes = ['chat', 'create', 'voice', 'agent', 'gaming'];
    if (!validModes.includes(targetMode)) {
      logger.warn(`IPC: switch-mode — invalid targetMode "${targetMode}"`);
      mainWindow.webContents.send('mode-ready', targetMode ?? 'chat');
      return;
    }
    try {
      await orchestrator.switchMode(targetMode, currentMode ?? 'chat', mainWindow);
    } catch (err) {
      // switchMode is already non-fatal internally, but guard here as a final safety net
      logger.error(`IPC: switch-mode failed — ${err.message}\n${err.stack}`);
      mainWindow.webContents.send('mode-ready', targetMode);
    }
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

    // ── Ollama ────────────────────────────────────────────────────────────
    // Check both binary presence and whether the HTTP API is reachable.
    // Installed-but-not-running is different from not-installed-at-all.
    const [ollamaRunning, ollamaInstallResult] = await Promise.all([
      ollama.checkRunning(),
      isOllamaInstalled(),
    ]);
    const ollamaInstalled = ollamaInstallResult.installed;

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
        ok: ollamaRunning || ollamaInstalled,
        required: false,
        label: 'Ollama',
        note: ollamaRunning
          ? 'Running on port 11434'
          : ollamaInstalled
            ? 'Installed — will be started automatically'
            : 'Not installed — will be installed automatically',
        link: null,
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
   * Starts the full installation sequence for selected services and models.
   * Accepts installDir in the payload. Passes installedServices from electron-store
   * so already-completed steps are skipped on resume.
   * Emits 'install-progress', 'install-error', and 'install-service-complete' events.
   * Phase real-installer.
   *
   * @param {{ capabilities: string[], models: Object, installDir: string }} config
   * @returns {Promise<{success: boolean}>}
   */
  ipcMain.handle('start-installation', async (_event, config) => {
    try {
      logger.info('IPC: start-installation', config);
      const installedServices = store.get('settings.installedServices', {});
      return await runInstallation({
        capabilities: config.capabilities,
        models: config.models,
        installDir: config.installDir,
        installedServices,
        mainWindow,
      });
    } catch (err) {
      logger.error(`IPC: start-installation failed — ${err.message}\n${err.stack}`);
      return { success: false };
    }
  });

  // ─── Install directory helpers ────────────────────────────────────────────

  /**
   * Returns available filesystem drives with size information.
   * Uses PowerShell Get-PSDrive to enumerate FileSystem providers.
   * Filters out zero-size drives (virtual/network drives with no reported size).
   * @returns {Promise<Array<{letter: string, label: string, totalGB: number, freeGB: number}>>}
   */
  ipcMain.handle('get-available-drives', async () => {
    try {
      logger.info('IPC: get-available-drives');
      const raw = await new Promise((resolve, reject) => {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-PSDrive -PSProvider FileSystem | Select-Object Name,Description,Used,Free | ConvertTo-Json',
          ],
          { windowsHide: true, timeout: 10_000 },
          (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))
        );
      });

      /** @type {Array<{Name: string, Description: string, Used: number, Free: number}>} */
      const parsed = JSON.parse(raw);
      const drives = Array.isArray(parsed) ? parsed : [parsed];

      return drives
        .filter((d) => (d.Used || 0) + (d.Free || 0) > 0)
        .map((d) => ({
          letter: d.Name,
          label: d.Description || d.Name,
          totalGB: Math.round(((d.Used || 0) + (d.Free || 0)) / 1024 / 1024 / 1024),
          freeGB: Math.round((d.Free || 0) / 1024 / 1024 / 1024),
        }));
    } catch (err) {
      logger.error(`IPC: get-available-drives failed — ${err.message}`);
      return [];
    }
  });

  /**
   * Validates that a chosen install directory is writable and has enough free space (25 GB).
   * @param {{ dir: string }} payload
   * @returns {Promise<{ok: boolean, reason: string|null, freeGB: number}>}
   */
  ipcMain.handle('validate-install-dir', async (_event, { dir }) => {
    try {
      logger.info(`IPC: validate-install-dir "${dir}"`);

      // 1. Ensure directory can be created/accessed
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        return { ok: false, reason: `Cannot create directory: ${err.message}`, freeGB: 0 };
      }

      // 2. Verify write permission via a temp file
      const testFile = path.join(dir, `noxio-write-test-${Date.now()}.tmp`);
      try {
        fs.writeFileSync(testFile, 'noxio-write-test');
        fs.unlinkSync(testFile);
      } catch (err) {
        return { ok: false, reason: `Directory is not writable: ${err.message}`, freeGB: 0 };
      }

      // 3. Check free space
      const driveLetter = path.parse(dir).root.replace('\\', '').replace(':', '');
      let freeBytes = 0;
      try {
        const freeRaw = await new Promise((resolve, reject) => {
          execFile(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `(Get-PSDrive ${driveLetter} -ErrorAction SilentlyContinue).Free`,
            ],
            { windowsHide: true, timeout: 5_000 },
            (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))
          );
        });
        freeBytes = parseInt(freeRaw, 10) || 0;
      } catch (_) {
        // Can't determine free space — be permissive
        return { ok: true, reason: null, freeGB: 0 };
      }

      const freeGB = Math.round(freeBytes / 1024 / 1024 / 1024);
      const REQUIRED_BYTES = 25 * 1024 * 1024 * 1024;

      if (freeBytes < REQUIRED_BYTES) {
        return {
          ok: false,
          reason: `Insufficient disk space: ${freeGB} GB free, 25 GB required`,
          freeGB,
        };
      }

      return { ok: true, reason: null, freeGB };
    } catch (err) {
      logger.error(`IPC: validate-install-dir failed — ${err.message}`);
      return { ok: false, reason: err.message, freeGB: 0 };
    }
  });

  /**
   * Returns the recommended default install directory.
   * Prefers E:\Noxio if E: exists and has >= 30 GB free; otherwise uses %LOCALAPPDATA%\Noxio.
   * @returns {Promise<{dir: string}>}
   */
  ipcMain.handle('get-default-install-dir', async () => {
    try {
      logger.info('IPC: get-default-install-dir');

      // Check if E: drive exists and has >= 30 GB free
      let eFreeBytes = 0;
      try {
        const freeRaw = await new Promise((resolve, reject) => {
          execFile(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              '(Get-PSDrive E -ErrorAction SilentlyContinue).Free',
            ],
            { windowsHide: true, timeout: 5_000 },
            (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))
          );
        });
        eFreeBytes = parseInt(freeRaw, 10) || 0;
      } catch (_) {
        eFreeBytes = 0;
      }

      const PREFERRED_MIN_BYTES = 30 * 1024 * 1024 * 1024;
      if (eFreeBytes >= PREFERRED_MIN_BYTES) {
        return { dir: 'E:\\Noxio' };
      }

      return { dir: path.join(app.getPath('appData'), '..', 'Local', 'Noxio') };
    } catch (err) {
      logger.error(`IPC: get-default-install-dir failed — ${err.message}`);
      return { dir: path.join(app.getPath('appData'), '..', 'Local', 'Noxio') };
    }
  });

  /**
   * Opens a native OS folder picker dialog so the user can choose the install directory.
   * @returns {Promise<{dir: string|null}>}
   */
  ipcMain.handle('pick-install-directory', async () => {
    try {
      logger.info('IPC: pick-install-directory');
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose Noxio install location',
        buttonLabel: 'Select Folder',
      });
      return { dir: result.filePaths[0] ?? null };
    } catch (err) {
      logger.error(`IPC: pick-install-directory failed — ${err.message}`);
      return { dir: null };
    }
  });

  /**
   * Marks setup as complete. Writes setupComplete=true to electron-store so the app
   * skips the wizard on next launch. Called by ReadyScreen when the user clicks "Open Noxio".
   * @returns {Promise<void>}
   */
  ipcMain.handle('complete-setup', () => {
    try {
      logger.info('IPC: complete-setup');
      store.set('settings.setupComplete', true);
    } catch (err) {
      logger.error(`IPC: complete-setup failed — ${err.message}`);
    }
  });

  /**
   * Returns resume data for a partially completed installation.
   * Reads installed services, service paths, and install directory from electron-store.
   * @returns {{installedServices: Object, servicePaths: Object, installDir: string|null}}
   */
  ipcMain.handle('check-install-resume', () => {
    try {
      logger.info('IPC: check-install-resume');
      return {
        installedServices: store.get('settings.installedServices', {}),
        servicePaths: store.get('settings.servicePaths', {}),
        installDir: store.get('settings.installDir', null),
      };
    } catch (err) {
      logger.error(`IPC: check-install-resume failed — ${err.message}`);
      return { installedServices: {}, servicePaths: {}, installDir: null };
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
   * Triggers image generation via ComfyUI with VRAM-aware service switching.
   * Pauses Ollama, generates the image, then resumes Ollama.
   * Progress events are emitted as 'image-progress' with percent 0–100.
   * Phase 5.
   *
   * @param {{ prompt: string, style: string, quality: string }} payload
   * @returns {Promise<{ imagePath: string }|{ error: string }>}
   */
  ipcMain.handle('generate-image', async (_event, { prompt, style, quality }) => {
    logger.info(`IPC: generate-image — style: ${style}, quality: ${quality}, prompt: "${prompt?.slice(0, 80)}"`);

    if (!prompt || !prompt.trim()) {
      return { error: 'Prompt is required for image generation' };
    }

    const validStyles = ['photorealistic', 'artistic', 'abstract', 'anime'];
    const validQualities = ['draft', 'standard', 'high'];

    const safeStyle = validStyles.includes(style) ? style : 'photorealistic';
    const safeQuality = validQualities.includes(quality) ? quality : 'standard';

    try {
      const onProgress = (percent) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('image-progress', percent);
        }
      };

      const imageDataUrl = await orchestrator.generateImageWithVRAMSwap(
        prompt.trim(),
        safeStyle,
        safeQuality,
        onProgress
      );

      return { imagePath: imageDataUrl };
    } catch (err) {
      logger.error(`IPC: generate-image failed — ${err.message}\n${err.stack}`);
      return { error: err.message };
    }
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

  logger.info('IPC handlers registered (Phase 5)');
}

module.exports = { registerHandlers };
