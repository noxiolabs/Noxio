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
 *   get-settings              → Settings panel: returns persisted settings                  ✓
 *   set-default-model         → Settings panel: validates + persists per-capability model  ✓
 *   pull-model                → Settings panel: ollama.pullModel with progress events       ✓
 *   delete-model              → Settings panel: ollama.deleteModel                         ✓
 *   save-voice-settings       → Settings panel: persists STT language + TTS voice          ✓
 *   save-chat-settings        → Settings panel: persists context window + system prompt    ✓
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
const { recommend, getAlternatives } = require('../wizard/model-recommender');
const { runInstallation } = require('../infrastructure/installer');
const manifest = require('../infrastructure/manifest');

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
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('mode-ready', targetMode ?? 'chat');
      return;
    }
    try {
      await orchestrator.switchMode(targetMode, currentMode ?? 'chat', mainWindow);
    } catch (err) {
      // switchMode is already non-fatal internally, but guard here as a final safety net
      logger.error(`IPC: switch-mode failed — ${err.message}\n${err.stack}`);
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('mode-ready', targetMode);
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
   * Each capability entry includes the recommended model plus an `alternatives` array
   * of all models from equal-or-lower VRAM tiers so the wizard can show a swap dropdown.
   * Wired to hardware-scan.js + model-recommender.js — Phase 3.
   *
   * Shape of each capability value:
   *   { model, sizeGB, alternatives: [{ model, sizeGB, tier }] }
   *   Voice entry is unchanged: { stt, tts, sizeGB, alternatives: [] }
   */
  ipcMain.handle('get-model-recommendations', async (_event, capabilities) => {
    try {
      logger.info(`IPC: get-model-recommendations — capabilities: ${capabilities}`);
      const hardware = await scanHardware();
      const recs = recommend(hardware.vramTier, capabilities);

      // Attach alternatives to every capability entry so the renderer can render
      // a swap dropdown without a second IPC round-trip.
      const enriched = {};
      for (const [cap, rec] of Object.entries(recs)) {
        enriched[cap] = {
          ...rec,
          alternatives: getAlternatives(hardware.vramTier, cap),
        };
      }

      return enriched;
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
      // Normalise to an absolute path to prevent traversal tricks
      const resolvedDir = path.resolve(dir);
      logger.info(`IPC: validate-install-dir "${resolvedDir}"`);

      // Reject system-reserved directories
      const BLOCKED_ROOTS = [
        path.normalize('C:\\Windows'),
        path.normalize('C:\\Program Files'),
        path.normalize('C:\\Program Files (x86)'),
        path.normalize('C:\\Windows\\System32'),
      ];
      if (BLOCKED_ROOTS.some((blocked) => resolvedDir.toLowerCase().startsWith(blocked.toLowerCase()))) {
        return { ok: false, reason: 'Cannot install inside a system directory. Please choose a different location.', freeGB: 0 };
      }

      // Re-bind dir to the resolved path for all subsequent checks
      dir = resolvedDir;

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
      return { success: true };
    } catch (err) {
      logger.error(`IPC: complete-setup failed — ${err.message}`);
      return { success: false, error: err.message };
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
   * Sends the full conversation messages array to local Ollama and streams tokens back.
   * Always routes to local Ollama — no cloud routing in alpha.
   * Emits a 'routing-decision' event before streaming begins.
   *
   * @param {{
   *   messages: Array<{role: string, content: string}>,
   *   model: string,
   *   conversationId: string,
   * }} payload
   */
  ipcMain.handle('send-chat-message', async (_event, { messages, model, conversationId } = {}) => {
    try {
      logger.info(`IPC: send-chat-message — model: ${model}, conv: ${conversationId}, turns: ${messages?.length}`);

      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('routing-decision', {
          provider: 'local',
          model,
          conversationId,
        });
      }

      await ollama.generateStream(model, messages, mainWindow);
    } catch (err) {
      logger.error(`IPC: send-chat-message error — ${err.message}\n${err.stack}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stream-complete');
      }
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

  // ─── Install Manifest ────────────────────────────────────────────────────

  /**
   * Returns the full install state manifest from electron-store.
   * The manifest tracks which services and models are installed, where they
   * live on disk, and when they were last verified.
   * @returns {Promise<Object|null>} The manifest object, or null on failure.
   */
  ipcMain.handle('get-install-manifest', async () => {
    try {
      return manifest.getManifest(store);
    } catch (err) {
      logger.error('IPC: get-install-manifest failed', { err });
      return null;
    }
  });

  /**
   * Runs a full verification pass over the manifest — checks that installed
   * service executables and model files still exist on disk, and that
   * Ollama-managed models are still present in the Ollama model list.
   * Emits 'manifest-verified' after the pass completes.
   * @returns {Promise<Object|null>} The updated manifest object, or null on failure.
   */
  ipcMain.handle('verify-install-manifest', async () => {
    try {
      const ollamaList = await ollama.listModels().catch(() => []);
      // listModels returns objects with a .name property — extract to string array
      const modelNames = Array.isArray(ollamaList)
        ? ollamaList.map((m) => (typeof m === 'string' ? m : m.name))
        : [];
      return await manifest.verifyManifest(store, () => Promise.resolve(modelNames));
    } catch (err) {
      logger.error('IPC: verify-install-manifest failed', { err });
      return null;
    }
  });

  // ─── Settings ─────────────────────────────────────────────────────────────

  /**
   * Returns the full persisted settings object from electron-store.
   * @returns {Object} Settings object
   */
  ipcMain.handle('get-settings', () => {
    try {
      logger.info('IPC: get-settings');
      const settings = store.get('settings', {});
      return settings;
    } catch (err) {
      logger.error(`IPC: get-settings failed — ${err.message}\n${err.stack}`);
      return { error: err.message };
    }
  });


  /**
   * Sets the default model for a given capability. Validates the model exists in
   * Ollama before persisting (skipped for 'image' — image models are not in Ollama).
   * @param {{ capability: 'chat'|'coding'|'image', model: string }} payload
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('set-default-model', async (_event, { capability, model } = {}) => {
    try {
      logger.info(`IPC: set-default-model — capability: ${capability}, model: ${model}`);

      const validCapabilities = ['chat', 'coding', 'image'];
      if (!validCapabilities.includes(capability)) {
        return { success: false, error: `Unknown capability: ${capability}` };
      }

      if (!model || typeof model !== 'string') {
        return { success: false, error: 'Model name is required' };
      }

      // Validate the model exists in Ollama — skip for image (SafeTensors, not in Ollama)
      if (capability !== 'image') {
        const models = await ollama.listModels();
        const modelNames = models.map((m) => (typeof m === 'string' ? m : m.name));
        if (!modelNames.includes(model)) {
          return { success: false, error: `Model not found: ${model}` };
        }
      }

      store.set(`settings.models.${capability}`, model);

      return { success: true };
    } catch (err) {
      logger.error(`IPC: set-default-model failed — ${err.message}\n${err.stack}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Pulls an Ollama model. Progress is emitted as 'model-pull-progress' events.
   * Completion fires 'model-pull-complete', errors fire 'model-pull-error'.
   * Returns void — the renderer tracks progress via events.
   * @param {{ model: string }} payload
   */
  ipcMain.handle('pull-model', async (_event, { model } = {}) => {
    logger.info(`IPC: pull-model — model: ${model}`);

    if (!model || typeof model !== 'string') {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('model-pull-error', { model, error: 'Model name is required' });
      }
      return;
    }

    try {
      let lastPercent = -1;

      await ollama.pullModel(model, ({ status, percent }) => {
        // Throttle: only emit when percent changes (avoids flooding IPC)
        if (percent !== lastPercent && !mainWindow.isDestroyed()) {
          lastPercent = percent;
          mainWindow.webContents.send('model-pull-progress', { model, percent, status });
        }
      });

      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('model-pull-complete', { model });
      }
    } catch (err) {
      logger.error(`IPC: pull-model failed — ${err.message}\n${err.stack}`);
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('model-pull-error', { model, error: err.message });
      }
    }
  });

  /**
   * Deletes a model from local Ollama storage.
   * @param {{ model: string }} payload
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('delete-model', async (_event, { model } = {}) => {
    try {
      logger.info(`IPC: delete-model — model: ${model}`);

      if (!model || typeof model !== 'string') {
        return { success: false, error: 'Model name is required' };
      }

      await ollama.deleteModel(model);

      return { success: true };
    } catch (err) {
      logger.error(`IPC: delete-model failed — ${err.message}\n${err.stack}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Persists voice settings (STT language and TTS voice) to electron-store.
   * @param {{ sttLanguage: string, ttsVoice: string }} payload
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('save-voice-settings', (_event, { sttLanguage, ttsVoice } = {}) => {
    try {
      logger.info('IPC: save-voice-settings');

      store.set('settings.voice', {
        sttLanguage: sttLanguage ?? '',
        ttsVoice: ttsVoice ?? '',
      });

      return { success: true };
    } catch (err) {
      logger.error(`IPC: save-voice-settings failed — ${err.message}\n${err.stack}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Persists chat settings (context window size and system prompt) to electron-store.
   * contextWindow must be between 512 and 32768 (inclusive).
   * @param {{ contextWindow: number, systemPrompt: string }} payload
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('save-chat-settings', (_event, { contextWindow, systemPrompt } = {}) => {
    try {
      logger.info('IPC: save-chat-settings');

      const ctx = Number(contextWindow);
      if (!Number.isFinite(ctx) || ctx < 512 || ctx > 32768) {
        return {
          success: false,
          error: `contextWindow must be between 512 and 32768 (received ${contextWindow})`,
        };
      }

      store.set('settings.chat', {
        contextWindow: ctx,
        systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : '',
      });

      return { success: true };
    } catch (err) {
      logger.error(`IPC: save-chat-settings failed — ${err.message}\n${err.stack}`);
      return { success: false, error: err.message };
    }
  });

  // ─── UI helpers ─────────────────────────────────────────────────────────

  /**
   * Opens the settings overlay on a specific section. Sends an event to the renderer
   * so the Redux settings slice can open the correct tab.
   * @param {{ section: string }} payload
   */
  ipcMain.handle('open-settings', (_event, { section } = {}) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-settings', { section: section ?? 'models' });
    }
  });

  // ─── Chat Persistence ────────────────────────────────────────────────────

  /**
   * Persists the chat history (conversations and messages) to electron-store
   * so it survives app restarts.
   * @param {{ conversations: Array, messages?: Object }} payload
   * @returns {{ success: boolean }}
   */
  ipcMain.handle('save-chat-history', (_event, { conversations } = {}) => {
    try {
      store.set('chat-history', { conversations: conversations ?? [] });
      return { success: true };
    } catch (err) {
      logger.error(`IPC: save-chat-history failed — ${err.message}`);
      return { success: false };
    }
  });

  /**
   * Loads persisted chat history from electron-store.
   * @returns {{ conversations: Array }|null}
   */
  ipcMain.handle('load-chat-history', () => {
    try {
      return store.get('chat-history', null);
    } catch (err) {
      logger.error(`IPC: load-chat-history failed — ${err.message}`);
      return null;
    }
  });

  logger.info('IPC handlers registered (Phase 5)');
}

module.exports = { registerHandlers };
