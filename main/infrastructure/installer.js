/**
 * @file installer.js
 * @description Orchestrates the full Noxio setup wizard installation sequence.
 * Installs Ollama, Python-based services (LiteLLM, Whisper, Kokoro), ComfyUI, and
 * downloads all required AI models in the correct order.
 *
 * Design principles:
 *   - Never throws — all errors are caught and emitted as 'install-error' events
 *   - Each step is skipped if the service is already marked installed (idempotent)
 *   - Only steps relevant to the user's selected capabilities are executed
 *   - Progress is scaled per-step and emitted as 'install-progress' events (0–100 overall)
 *
 * Events emitted to renderer:
 *   install-progress        { step, percent, message }
 *   install-error           { step, message, retryable }
 *   install-service-complete { service, executablePath }
 */

'use strict';

const logger = require('../utils/logger');
const { downloadModel } = require('../wizard/model-downloader');
const { isOllamaInstalled, installOllama } = require('../wizard/ollama-installer');
const ollama = require('../services/ollama');
const processManager = require('./process-manager');
const {
  resolveSystemPython,
  installComfyUI,
  createVenv,
  downloadFluxModel,
  downloadWhisperModel,
  downloadKokoroModel,
} = require('../wizard/service-installer');

// ─── Per-step weight table ────────────────────────────────────────────────────
// Higher weights = more overall-percent budget allocated to the step.
const STEP_WEIGHTS = {
  'install-ollama':        5,
  'verify-python':         2,
  'install-comfyui':      12,
  'install-litellm':       5,
  'install-whisper':       5,
  'install-kokoro':        5,
  'download-flux':        20,
  'download-whisper-model': 8,
  'download-kokoro-model':  3,
  // LLM models: 20 points each (applied per capability)
};
const LLM_WEIGHT_PER_MODEL = 20;

// ─── Event emitters ───────────────────────────────────────────────────────────

/**
 * Emits an install-progress event to the renderer.
 * @param {import('electron').BrowserWindow} win
 * @param {string} step
 * @param {number} percent - Overall install progress 0–100
 * @param {string} message
 */
function emitProgress(win, step, percent, message) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('install-progress', { step, percent, message });
  }
}

/**
 * Emits an install-error event to the renderer.
 * @param {import('electron').BrowserWindow} win
 * @param {string} step
 * @param {string} message
 * @param {boolean} retryable
 */
function emitError(win, step, message, retryable) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('install-error', { step, message, retryable });
  }
}

/**
 * Emits an install-service-complete event to the renderer.
 * @param {import('electron').BrowserWindow} win
 * @param {string} service
 * @param {string|null} executablePath
 */
function emitServiceComplete(win, service, executablePath) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('install-service-complete', { service, executablePath: executablePath ?? null });
  }
}

// ─── Step progress scaler ─────────────────────────────────────────────────────

/**
 * Returns a progress callback that scales a step's 0–100 into the overall
 * percent range [rangeStart, rangeEnd] and emits an install-progress event.
 *
 * @param {import('electron').BrowserWindow} win
 * @param {string} stepName
 * @param {number} rangeStart - Overall percent where this step starts
 * @param {number} rangeEnd - Overall percent where this step ends
 * @param {string} message - Human-readable status message prefix
 * @returns {function(number): void}
 */
function makeStepProgress(win, stepName, rangeStart, rangeEnd, message) {
  return (stepPercent) => {
    const clamped = Math.min(100, Math.max(0, stepPercent));
    const overall = Math.round(rangeStart + (clamped / 100) * (rangeEnd - rangeStart));
    emitProgress(win, stepName, overall, `${message} ${clamped}%`);
  };
}

// ─── Step range calculator ────────────────────────────────────────────────────

/**
 * Computes [start, end] overall-percent ranges for each active step based on weights.
 *
 * @param {string[]} activeSteps - Ordered list of step keys
 * @param {Object.<string, number>} weights - Weight per step key
 * @returns {Object.<string, {start: number, end: number}>}
 */
function computeStepRanges(activeSteps, weights) {
  const totalWeight = activeSteps.reduce((sum, s) => sum + (weights[s] ?? 1), 0);
  const ranges = {};
  let cursor = 0;
  for (const step of activeSteps) {
    const weight = weights[step] ?? 1;
    const portion = (weight / totalWeight) * 100;
    ranges[step] = { start: Math.round(cursor), end: Math.round(cursor + portion) };
    cursor += portion;
  }
  return ranges;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Runs the full installation sequence for the selected capabilities and models.
 *
 * @param {Object} config
 * @param {string[]} config.capabilities - Selected capabilities e.g. ['chat', 'coding', 'image', 'voice']
 * @param {Object.<string, string>} config.models - { chat: 'qwen2.5:14b', coding: 'qwen2.5-coder:14b', ... }
 * @param {string} config.installDir - Absolute path to the chosen install root
 * @param {Object.<string, boolean>} [config.installedServices={}] - Already-installed services to skip
 * @param {import('electron').BrowserWindow} config.mainWindow
 * @returns {Promise<{success: boolean}>}
 */
async function runInstallation({ capabilities = [], models = {}, installDir, installedServices = {}, mainWindow: win }) {
  logger.info('installer: starting full installation', { capabilities, installDir });

  const hasImage = capabilities.includes('image');
  const hasVoice = capabilities.includes('voice');
  const llmCaps  = ['chat', 'coding'].filter((c) => capabilities.includes(c) && models[c]);

  // ── Build ordered list of active steps ──────────────────────────────────
  /** @type {string[]} */
  const activeSteps = [];

  activeSteps.push('install-ollama');
  activeSteps.push('verify-python');
  if (hasImage) activeSteps.push('install-comfyui');
  activeSteps.push('install-litellm');
  if (hasVoice) activeSteps.push('install-whisper');
  if (hasVoice) activeSteps.push('install-kokoro');
  if (hasImage) activeSteps.push('download-flux');
  if (hasVoice) activeSteps.push('download-whisper-model');
  if (hasVoice) activeSteps.push('download-kokoro-model');
  for (const cap of llmCaps) {
    activeSteps.push(`download-llm-${cap}`);
  }

  // Build weights map including dynamic LLM steps
  const weights = { ...STEP_WEIGHTS };
  for (const cap of llmCaps) {
    weights[`download-llm-${cap}`] = LLM_WEIGHT_PER_MODEL;
  }

  const ranges = computeStepRanges(activeSteps, weights);

  /** Python executable resolved in verify-python step, used by later venv steps */
  let pythonExe = null;

  // ── Step: install-ollama ─────────────────────────────────────────────────
  {
    const stepName = 'install-ollama';
    const { start, end } = ranges[stepName];
    const stepProgress = makeStepProgress(win, stepName, start, end, 'Installing Ollama...');

    try {
      if (installedServices.ollama) {
        logger.info('installer: Ollama already installed — skipping');
        emitProgress(win, stepName, end, 'Ollama already installed ✓');
      } else {
        const { installed } = await isOllamaInstalled();
        if (installed) {
          logger.info('installer: Ollama already present — skipping download');
          emitProgress(win, stepName, end, 'Ollama already installed ✓');
        } else {
          emitProgress(win, stepName, start, 'Downloading and installing Ollama...');
          await installOllama(stepProgress);
          emitProgress(win, stepName, end, 'Ollama installed ✓');
        }
        emitServiceComplete(win, 'ollama', null);
      }
    } catch (err) {
      logger.error(`installer: install-ollama failed — ${err.message}`);
      emitError(win, stepName, `Failed to install Ollama: ${err.message}`, true);
      return { success: false };
    }
  }

  // ── Ensure Ollama HTTP API is running before model downloads ────────────
  // Ollama may be installed but not yet running (e.g. first launch after install,
  // or the user has it installed but hasn't started it). We must have the API up
  // before any ollama pull calls, otherwise they fail with ECONNREFUSED.
  {
    const isRunning = await ollama.checkRunning();
    if (!isRunning) {
      emitProgress(win, 'install-ollama', ranges['install-ollama'].end, 'Starting Ollama...');
      try {
        await processManager.startService('ollama');
        // Poll up to 30s for the HTTP API to come up
        const deadline = Date.now() + 30_000;
        let up = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1_000));
          up = await ollama.checkRunning();
          if (up) break;
        }
        if (!up) {
          emitError(win, 'install-ollama', 'Ollama was installed but could not be started. Please start Ollama manually and retry.', true);
          return { success: false };
        }
        logger.info('installer: Ollama is now running');
      } catch (err) {
        logger.error(`installer: failed to start Ollama — ${err.message}`);
        emitError(win, 'install-ollama', `Could not start Ollama: ${err.message}`, true);
        return { success: false };
      }
    }
  }

  // ── Step: verify-python ──────────────────────────────────────────────────
  {
    const stepName = 'verify-python';
    const { start, end } = ranges[stepName];

    try {
      emitProgress(win, stepName, start, 'Checking Python installation...');
      pythonExe = await resolveSystemPython();
      emitProgress(win, stepName, end, 'Python 3.11+ found ✓');
    } catch (err) {
      logger.error(`installer: verify-python failed — ${err.message}`);
      if (hasImage || hasVoice) {
        emitError(
          win,
          stepName,
          'Python 3.11+ not found. Please install Python from python.org and restart the wizard.',
          false
        );
        return { success: false };
      }
      // No image/voice needed — Python is optional, continue without it
      logger.warn('installer: Python not found but image/voice not selected — continuing');
      emitProgress(win, stepName, end, 'Python not found — skipping (not needed for selected capabilities)');
    }
  }

  // ── Step: install-comfyui ────────────────────────────────────────────────
  if (hasImage) {
    const stepName = 'install-comfyui';
    const { start, end } = ranges[stepName];
    const stepProgress = makeStepProgress(win, stepName, start, end, 'Installing ComfyUI...');

    try {
      if (installedServices.comfyui) {
        logger.info('installer: ComfyUI already installed — skipping');
        emitProgress(win, stepName, end, 'ComfyUI already installed ✓');
      } else {
        emitProgress(win, stepName, start, 'Downloading ComfyUI portable package...');
        const batPath = await installComfyUI(installDir, stepProgress);
        emitProgress(win, stepName, end, 'ComfyUI installed ✓');
        emitServiceComplete(win, 'comfyui', batPath);
      }
    } catch (err) {
      logger.error(`installer: install-comfyui failed — ${err.message}`);
      emitError(win, stepName, `Failed to install ComfyUI: ${err.message}`, true);
      return { success: false };
    }
  }

  // ── Step: install-litellm ────────────────────────────────────────────────
  {
    const stepName = 'install-litellm';
    const { start, end } = ranges[stepName];
    const stepProgress = makeStepProgress(win, stepName, start, end, 'Installing LiteLLM...');

    try {
      if (installedServices.litellm) {
        logger.info('installer: LiteLLM already installed — skipping');
        emitProgress(win, stepName, end, 'LiteLLM already installed ✓');
      } else if (!pythonExe) {
        logger.warn('installer: no Python — skipping LiteLLM venv');
        emitProgress(win, stepName, end, 'LiteLLM skipped (Python not available)');
      } else {
        emitProgress(win, stepName, start, 'Creating LiteLLM virtual environment...');
        await createVenv({
          service: 'litellm',
          installDir,
          pythonExe,
          packages: ['litellm[proxy]'],
          onProgress: stepProgress,
        });
        const litellmExe = require('path').join(installDir, 'venvs', 'litellm', 'Scripts', 'litellm.exe');
        emitProgress(win, stepName, end, 'LiteLLM installed ✓');
        emitServiceComplete(win, 'litellm', litellmExe);
      }
    } catch (err) {
      logger.error(`installer: install-litellm failed — ${err.message}`);
      emitError(win, stepName, `Failed to install LiteLLM: ${err.message}`, true);
      // LiteLLM failure is not fatal for chat/coding — continue
    }
  }

  // ── Step: install-whisper ────────────────────────────────────────────────
  if (hasVoice) {
    const stepName = 'install-whisper';
    const { start, end } = ranges[stepName];
    const stepProgress = makeStepProgress(win, stepName, start, end, 'Installing Whisper...');

    try {
      if (installedServices.whisper) {
        logger.info('installer: Whisper already installed — skipping');
        emitProgress(win, stepName, end, 'Whisper already installed ✓');
      } else {
        emitProgress(win, stepName, start, 'Creating Whisper virtual environment...');
        const venvPython = await createVenv({
          service: 'whisper',
          installDir,
          pythonExe,
          packages: ['faster-whisper'],
          onProgress: stepProgress,
        });
        emitProgress(win, stepName, end, 'Whisper installed ✓');
        emitServiceComplete(win, 'whisper', venvPython);
      }
    } catch (err) {
      logger.error(`installer: install-whisper failed — ${err.message}`);
      emitError(win, stepName, `Failed to install Whisper: ${err.message}`, true);
      return { success: false };
    }
  }

  // ── Step: install-kokoro ─────────────────────────────────────────────────
  if (hasVoice) {
    const stepName = 'install-kokoro';
    const { start, end } = ranges[stepName];
    const stepProgress = makeStepProgress(win, stepName, start, end, 'Installing Kokoro TTS...');

    try {
      if (installedServices.kokoro) {
        logger.info('installer: Kokoro already installed — skipping');
        emitProgress(win, stepName, end, 'Kokoro already installed ✓');
      } else {
        emitProgress(win, stepName, start, 'Creating Kokoro virtual environment...');
        const venvPython = await createVenv({
          service: 'kokoro',
          installDir,
          pythonExe,
          packages: ['kokoro-onnx', 'soundfile'],
          onProgress: stepProgress,
        });
        emitProgress(win, stepName, end, 'Kokoro installed ✓');
        emitServiceComplete(win, 'kokoro', venvPython);
      }
    } catch (err) {
      logger.error(`installer: install-kokoro failed — ${err.message}`);
      emitError(win, stepName, `Failed to install Kokoro: ${err.message}`, true);
      return { success: false };
    }
  }

  // ── Step: download-flux ──────────────────────────────────────────────────
  if (hasImage) {
    const stepName = 'download-flux';
    const { start, end } = ranges[stepName];
    const stepProgress = makeStepProgress(win, stepName, start, end, 'Downloading FLUX model...');

    try {
      emitProgress(win, stepName, start, 'Downloading FLUX.1-schnell model (≈9 GB)...');
      await downloadFluxModel(installDir, stepProgress);
      emitProgress(win, stepName, end, 'FLUX model ready ✓');
    } catch (err) {
      logger.error(`installer: download-flux failed — ${err.message}`);
      emitError(win, stepName, `Failed to download FLUX model: ${err.message}`, true);
      return { success: false };
    }
  }

  // ── Step: download-whisper-model ─────────────────────────────────────────
  if (hasVoice) {
    const stepName = 'download-whisper-model';
    const { start, end } = ranges[stepName];
    const stepProgress = makeStepProgress(win, stepName, start, end, 'Downloading Whisper model...');

    try {
      emitProgress(win, stepName, start, 'Downloading Whisper medium model...');
      await downloadWhisperModel(installDir, stepProgress);
      emitProgress(win, stepName, end, 'Whisper model ready ✓');
    } catch (err) {
      logger.error(`installer: download-whisper-model failed — ${err.message}`);
      emitError(win, stepName, `Failed to download Whisper model: ${err.message}`, true);
      return { success: false };
    }
  }

  // ── Step: download-kokoro-model ──────────────────────────────────────────
  if (hasVoice) {
    const stepName = 'download-kokoro-model';
    const { start, end } = ranges[stepName];
    const stepProgress = makeStepProgress(win, stepName, start, end, 'Downloading Kokoro model...');

    try {
      emitProgress(win, stepName, start, 'Downloading Kokoro TTS model...');
      await downloadKokoroModel(installDir, stepProgress);
      emitProgress(win, stepName, end, 'Kokoro model ready ✓');
    } catch (err) {
      logger.error(`installer: download-kokoro-model failed — ${err.message}`);
      emitError(win, stepName, `Failed to download Kokoro model: ${err.message}`, true);
      return { success: false };
    }
  }

  // ── Steps: download-llm-{cap} ────────────────────────────────────────────
  // Fetch the list of already-pulled models once before looping.
  // This lets us skip pulls for models the user already has, even if they were
  // pulled outside of Noxio (e.g. via the Ollama CLI directly).
  let pulledModels = [];
  try {
    const listed = await ollama.listModels();
    pulledModels = listed.map((m) => m.name);
  } catch (_) { /* non-fatal — proceed and let the pull succeed or fail naturally */ }

  for (const cap of llmCaps) {
    const stepName = `download-llm-${cap}`;
    const { start, end } = ranges[stepName];
    const model = models[cap];

    try {
      // Check if already present (exact tag match or same base name without tag)
      const alreadyPulled = pulledModels.some(
        (m) => m === model || m.startsWith(model.split(':')[0] + ':')
      );

      if (alreadyPulled) {
        logger.info(`installer: model "${model}" already pulled — skipping`);
        emitProgress(win, stepName, end, `${model} already available ✓`);
        continue;
      }

      emitProgress(win, stepName, start, `Downloading ${model}...`);
      await downloadModel({
        model,
        source: 'ollama',
        onProgress: ({ percent }) => {
          const overall = Math.round(start + (percent / 100) * (end - start));
          emitProgress(win, stepName, overall, `Downloading ${model}... ${percent}%`);
        },
      });
      emitProgress(win, stepName, end, `${model} ready ✓`);
    } catch (err) {
      logger.error(`installer: download-llm-${cap} failed — ${err.message}`);
      emitError(win, stepName, `Failed to download ${model}: ${err.message}`, true);
      return { success: false };
    }
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  emitProgress(win, 'complete', 100, 'Installation complete ✓');
  logger.info('installer: all steps complete');
  return { success: true };
}

module.exports = { runInstallation };
