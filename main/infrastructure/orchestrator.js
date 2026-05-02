/**
 * @file orchestrator.js
 * @description VRAM-aware mode orchestrator. When the user switches between Chat,
 * Create, Voice, and Agent modes, this module coordinates pausing and resuming
 * services to avoid VRAM conflicts on single-GPU setups.
 *
 * Key rules (16GB VRAM / RTX 5080):
 *   Chat → Create : stop Ollama, start ComfyUI
 *   Create → Chat : stop ComfyUI, start Ollama
 *   /image in chat: stop Ollama, generate image via ComfyUI, start Ollama
 *   Voice panel   : Whisper (1.5GB) + Kokoro (CPU only) — no LLM conflict
 *   Gaming mode   : stop ALL services, release all VRAM
 *
 * All mode transitions emit 'mode-ready' to the renderer on success. If a
 * transition fails, 'mode-ready' is still emitted (with the target mode) so the
 * UI never hangs — the error is logged and the status bar's health dots will
 * surface the broken state to the user.
 *
 * Process lifecycle is delegated entirely to process-manager.js — the orchestrator
 * never spawns processes directly.
 */

'use strict';

const logger = require('../utils/logger');
const processManager = require('./process-manager');
const healthChecker = require('./health-checker');
const comfyui = require('../services/comfyui');

/** Timeout in ms for waiting on a service to become healthy after starting */
const SERVICE_READY_TIMEOUT_MS = 60_000;

/** Poll interval in ms when waiting for a service health check to pass */
const HEALTH_POLL_INTERVAL_MS = 1000;

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Waits for a service to reach 'running' status in the process manager.
 * Resolves when the service becomes running, or rejects after a timeout.
 *
 * @param {string} name - Service name (e.g. 'ollama', 'comfyui')
 * @param {number} [timeoutMs=60000] - Timeout in milliseconds
 * @returns {Promise<void>}
 */
function waitForService(name, timeoutMs = SERVICE_READY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function poll() {
      const pmStatus = processManager.getServiceStates()[name]?.status;

      // Fast-fail on process-level terminal states
      if (pmStatus === 'crashed') {
        reject(new Error(`Service "${name}" crashed while waiting for it to start`));
        return;
      }

      if (pmStatus === 'not-installed') {
        reject(new Error(`Service "${name}" is not installed — skipping wait`));
        return;
      }

      // Use health-checker's HTTP-based status for the running check.
      // Process-manager marks a service 'running' as soon as it spawns, but
      // ComfyUI (and others) need extra time to open their HTTP port.
      // Health-checker only sets 'running' after a real HTTP 200 response.
      const httpStatus = healthChecker.getHealthStates()[name];
      if (httpStatus === 'running') {
        resolve();
        return;
      }

      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for service "${name}" to become running`));
        return;
      }

      setTimeout(poll, HEALTH_POLL_INTERVAL_MS);
    }

    poll();
  });
}

/**
 * Emits a 'mode-ready' event to the renderer.
 * Safe to call even if the BrowserWindow is being destroyed.
 *
 * @param {string} mode - The mode that is now ready
 * @param {import('electron').BrowserWindow} mainWindow
 */
function emitModeReady(mode, mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mode-ready', mode);
    logger.info(`orchestrator: mode-ready emitted → ${mode}`);
  }
}

// ─── Mode Transitions ─────────────────────────────────────────────────────────

/**
 * Handles the Chat → Create transition.
 * Stops Ollama to free VRAM, then starts ComfyUI.
 *
 * @returns {Promise<void>}
 */
async function transitionToCreate() {
  logger.info('orchestrator: transition → create (stopping Ollama, starting ComfyUI)');

  // Only stop Ollama if it was actually running — it may have never been started
  // (e.g. user skipped LLM capability during setup).
  const ollamaStatus = processManager.getServiceStates().ollama?.status;
  if (ollamaStatus === 'running') {
    await processManager.stopService('ollama');
    logger.info('orchestrator: Ollama stopped');
  } else {
    logger.info(`orchestrator: Ollama not running (status: ${ollamaStatus}) — skipping stop`);
  }

  // Start ComfyUI
  await comfyui.start();
  logger.info('orchestrator: ComfyUI starting — waiting for service to become ready');

  try {
    await waitForService('comfyui', SERVICE_READY_TIMEOUT_MS);
    logger.info('orchestrator: ComfyUI ready');
  } catch (err) {
    logger.warn(`orchestrator: ComfyUI did not reach running state — ${err.message}`);
    // Non-fatal: emit mode-ready anyway so the UI doesn't hang. The status bar's
    // health dots will show ComfyUI as stopped/crashed.
  }
}

/**
 * Handles the Create → Chat transition.
 * Stops ComfyUI to free VRAM, then starts Ollama.
 *
 * @returns {Promise<void>}
 */
async function transitionToChat() {
  logger.info('orchestrator: transition → chat (stopping ComfyUI, starting Ollama)');

  // Stop ComfyUI first
  await comfyui.stop();
  logger.info('orchestrator: ComfyUI stopped');

  // Resume Ollama
  await processManager.startService('ollama');
  logger.info('orchestrator: Ollama starting — waiting for service to become ready');

  try {
    await waitForService('ollama', SERVICE_READY_TIMEOUT_MS);
    logger.info('orchestrator: Ollama ready');
  } catch (err) {
    logger.warn(`orchestrator: Ollama did not reach running state — ${err.message}`);
  }
}

/**
 * Handles transitions to Gaming mode: stops all services to free maximum VRAM.
 *
 * @returns {Promise<void>}
 */
async function transitionToGaming() {
  logger.info('orchestrator: transition → gaming (stopping all services)');
  await processManager.stopAll();
  logger.info('orchestrator: all services stopped for gaming mode');
}

/**
 * Handles the Gaming → Chat transition: restarts Ollama.
 *
 * @returns {Promise<void>}
 */
async function transitionFromGamingToChat() {
  logger.info('orchestrator: transition gaming → chat (starting Ollama)');
  await processManager.startService('ollama');
  try {
    await waitForService('ollama', SERVICE_READY_TIMEOUT_MS);
  } catch (err) {
    logger.warn(`orchestrator: Ollama startup after gaming mode: ${err.message}`);
  }
}

/**
 * Handles the Gaming → Create transition: starts ComfyUI (no Ollama needed).
 *
 * @returns {Promise<void>}
 */
async function transitionFromGamingToCreate() {
  logger.info('orchestrator: transition gaming → create (starting ComfyUI)');
  await comfyui.start();
  try {
    await waitForService('comfyui', SERVICE_READY_TIMEOUT_MS);
  } catch (err) {
    logger.warn(`orchestrator: ComfyUI startup after gaming mode: ${err.message}`);
  }
}

/** Concurrency guard — prevents two simultaneous inline image generation calls */
let _imageGenerating = false;

/** Abort signal object shared with the active generateImage call. Mutated to cancel mid-poll. */
let _abortSignal = { cancelled: false };

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Switches the active mode, coordinating VRAM-aware service transitions.
 * Emits 'mode-ready' to the renderer when the transition is complete (or on
 * non-fatal failure, so the UI never hangs).
 *
 * Supported transitions with VRAM management:
 *   chat   → create  : stop Ollama, start ComfyUI
 *   create → chat    : stop ComfyUI, start Ollama
 *   *      → gaming  : stop all services
 *   gaming → chat    : start Ollama
 *   gaming → create  : start ComfyUI
 *   *      → voice   : no-op (Whisper 1.5GB + Kokoro CPU — no LLM conflict)
 *   *      → agent   : no-op (agent uses chat backend, no additional VRAM needed)
 *
 * @param {string} targetMode - 'chat' | 'create' | 'voice' | 'agent' | 'gaming'
 * @param {string} currentMode - Currently active mode
 * @param {import('electron').BrowserWindow} mainWindow
 * @returns {Promise<void>}
 */
async function switchMode(targetMode, currentMode, mainWindow) {
  logger.info(`orchestrator: switchMode ${currentMode} → ${targetMode}`);

  if (targetMode === currentMode) {
    logger.info('orchestrator: target mode === current mode — no transition needed');
    emitModeReady(targetMode, mainWindow);
    return;
  }

  try {
    if (targetMode === 'gaming') {
      await transitionToGaming();

    } else if (currentMode === 'gaming') {
      // Exiting gaming mode: restart the appropriate service
      if (targetMode === 'chat' || targetMode === 'voice' || targetMode === 'agent') {
        await transitionFromGamingToChat();
      } else if (targetMode === 'create') {
        await transitionFromGamingToCreate();
      }

    } else if (targetMode === 'create') {
      // Any mode → create: need to free VRAM from Ollama
      await transitionToCreate();

    } else if (targetMode === 'chat') {
      // Create → chat: need to stop ComfyUI and restart Ollama
      if (currentMode === 'create') {
        await transitionToChat();
      }
      // voice/agent → chat: Ollama should already be running, no action needed

    } else if (targetMode === 'voice' || targetMode === 'agent') {
      // No VRAM conflict: Whisper is 1.5GB, Kokoro is CPU-only.
      // Ollama and voice can coexist on 16GB VRAM. No service restart needed.
      logger.info(`orchestrator: transition → ${targetMode} — no VRAM action required`);
    }

  } catch (err) {
    logger.error(`orchestrator: switchMode ${currentMode} → ${targetMode} failed — ${err.message}\n${err.stack}`);
    // Fall through: always emit mode-ready so the UI doesn't hang
  }

  emitModeReady(targetMode, mainWindow);
}

/**
 * Generates an image inline from Chat (via the /image shortcut).
 * Temporarily stops Ollama to free VRAM for ComfyUI, generates the image,
 * then restarts Ollama so chat can continue.
 *
 * Progress is reported via the onProgress callback (0–100).
 *
 * @param {string} prompt - Image generation prompt
 * @param {'photorealistic'|'artistic'|'abstract'|'anime'} style - Style preset
 * @param {'draft'|'standard'|'high'} quality - Quality preset
 * @param {Function} onProgress - Called with percent (0–100) during generation
 * @param {string|null} [referenceImageData] - Base64 data URL for img2img, or null for txt2img
 * @param {number} [strength=0.75] - Denoise strength for img2img
 * @param {string|null} [imageModel] - Model ID from settings (e.g. 'FLUX.2-klein-4b-fp8')
 * @returns {Promise<string>} Base64 data URL of the generated image
 * @throws {Error} If ComfyUI fails to start or generation fails
 */
async function generateImageWithVRAMSwap(prompt, style, quality, onProgress, referenceImageData = null, strength = 0.75, imageModel = null) {
  if (_imageGenerating) {
    throw new Error('Image generation already in progress — please wait for the current job to finish');
  }

  _imageGenerating = true;
  _abortSignal = { cancelled: false };
  logger.info(`orchestrator: generateImageWithVRAMSwap — style=${style}, quality=${quality}, model=${imageModel ?? 'default'}, img2img=${!!referenceImageData}`);

  try {
  // Stop Ollama to free VRAM
  logger.info('orchestrator: stopping Ollama for inline image generation');
  await processManager.stopService('ollama');

  // Start ComfyUI
  await comfyui.start();
  try {
    await waitForService('comfyui', SERVICE_READY_TIMEOUT_MS);
  } catch (err) {
    // ComfyUI didn't start — restart Ollama and rethrow
    logger.error(`orchestrator: ComfyUI failed to start for inline gen — ${err.message}`);
    await processManager.startService('ollama');
    throw new Error(`ComfyUI failed to start: ${err.message}`);
  }

  let imageDataUrl;
  try {
    imageDataUrl = await comfyui.generateImage({ prompt, style, quality, onProgress, abortSignal: _abortSignal, referenceImageData, strength, imageModel });
  } finally {
    if (_abortSignal.cancelled) {
      // Cancelled by game mode — don't restart services; caller handles service state
      logger.info('orchestrator: inline gen cancelled — skipping service restore');
      await comfyui.stop().catch(() => {});
    } else {
      // Normal completion or error — stop ComfyUI and resume Ollama
      logger.info('orchestrator: inline gen done — stopping ComfyUI, resuming Ollama');
      await comfyui.stop();
      await processManager.startService('ollama');
      try {
        await waitForService('ollama', SERVICE_READY_TIMEOUT_MS);
      } catch (err) {
        logger.warn(`orchestrator: Ollama did not resume cleanly after inline gen — ${err.message}`);
      }
    }
  }

  return imageDataUrl;

  } finally {
    _imageGenerating = false;
    _abortSignal = { cancelled: false };
  }
}

/**
 * Cancels an in-progress image generation. Called by game mode before stopping services.
 * Sets the abort signal so the polling loop exits on the next iteration (~1s).
 * The orchestrator's finally block will skip the Ollama restart since game mode owns services.
 */
function cancelImageGeneration() {
  if (_imageGenerating) {
    _abortSignal.cancelled = true;
    logger.info('orchestrator: image generation cancelled (game mode)');
  }
}

module.exports = { switchMode, generateImageWithVRAMSwap, cancelImageGeneration };
