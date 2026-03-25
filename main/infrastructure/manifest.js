/**
 * @file manifest.js
 * @description Install state manifest — single source of truth for what services and
 * models are installed, where they live, and when they were last verified.
 * Stored in electron-store under the 'manifest' key alongside 'settings'.
 * Written by installer.js during setup; verified at app startup.
 *
 * All writes go through this module — callers must never mutate the store's
 * manifest key directly. All public functions are safe to call concurrently;
 * each does a discrete read-modify-write against the electron-store instance.
 */

'use strict';

const fs = require('fs');
const { execFile } = require('child_process');
const logger = require('../utils/logger');

// ─── Default manifest shape ────────────────────────────────────────────────────

/**
 * Builds the default empty manifest. Used when no manifest exists in the store yet.
 * @returns {Object} A fresh manifest with all services marked not-installed.
 */
function buildDefaultManifest() {
  return {
    version: 1,
    services: {
      ollama:  { installed: false, executablePath: null, version: null, lastVerifiedAt: null, installCompletedAt: null },
      comfyui: { installed: false, executablePath: null, version: null, lastVerifiedAt: null, installCompletedAt: null },
      litellm: { installed: false, executablePath: null, version: null, lastVerifiedAt: null, installCompletedAt: null },
      whisper: { installed: false, executablePath: null, version: null, lastVerifiedAt: null, installCompletedAt: null },
      kokoro:  { installed: false, executablePath: null, version: null, lastVerifiedAt: null, installCompletedAt: null },
    },
    models: {},
  };
}

// ─── Version detection helpers ─────────────────────────────────────────────────

/**
 * Attempts to detect the installed version of a service by running its executable
 * with `--version`. Fire-and-forget — resolves with a version string or null.
 * Never rejects.
 *
 * @param {string} executablePath - Absolute path to the executable
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<string|null>}
 */
function detectVersion(executablePath, timeoutMs = 5000) {
  return new Promise((resolve) => {
    execFile(
      executablePath,
      ['--version'],
      { windowsHide: true, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          resolve(null);
          return;
        }
        // stdout or stderr may carry the version — try both
        const raw = (stdout || stderr || '').trim();
        resolve(raw || null);
      }
    );
  });
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialises the manifest key in the electron-store if it is missing.
 * Must be called once at startup before any other manifest operation.
 *
 * @param {import('electron-store')} store - The electron-store instance
 */
function initManifest(store) {
  if (!store.has('manifest')) {
    store.set('manifest', buildDefaultManifest());
    logger.info('manifest: initialised fresh manifest in store');
  } else {
    logger.info('manifest: existing manifest found in store');
  }
}

/**
 * Returns the full manifest object from the store.
 *
 * @param {import('electron-store')} store
 * @returns {Object} The manifest object
 */
function getManifest(store) {
  return store.get('manifest', buildDefaultManifest());
}

/**
 * Marks a service as successfully installed. Sets `installed: true`,
 * `executablePath`, and `installCompletedAt`. Attempts version detection
 * asynchronously and writes it back if found — never blocks the caller.
 *
 * @param {import('electron-store')} store
 * @param {string} serviceName - One of: ollama, comfyui, litellm, whisper, kokoro
 * @param {string|null} executablePath - Absolute path to the executable, or null for Ollama
 */
function markServiceInstalled(store, serviceName, executablePath) {
  const now = new Date().toISOString();
  const key = `manifest.services.${serviceName}`;

  const current = store.get(key, {});
  store.set(key, {
    ...current,
    installed: true,
    executablePath: executablePath ?? null,
    installCompletedAt: now,
    lastVerifiedAt: now,
  });

  logger.info(`manifest: marked ${serviceName} as installed (path: ${executablePath ?? 'null'})`);

  // Fire-and-forget version detection for services that support --version
  if (executablePath && (serviceName === 'ollama' || serviceName === 'litellm')) {
    detectVersion(executablePath).then((version) => {
      if (version) {
        store.set(`${key}.version`, version);
        logger.info(`manifest: detected ${serviceName} version: ${version}`);
      }
    }).catch(() => {
      // Never let this bubble — version detection is purely informational
    });
  }
}

/**
 * Upserts a model entry into `manifest.models[modelId]` with `installed: true`.
 *
 * @param {import('electron-store')} store
 * @param {Object} modelEntry
 * @param {string} modelEntry.modelId - Unique identifier e.g. 'qwen2.5:14b'
 * @param {string} modelEntry.backend - 'ollama' | 'comfyui' | 'whisper' | 'kokoro'
 * @param {string} modelEntry.capability - 'chat' | 'coding' | 'image' | 'stt' | 'tts'
 * @param {number} [modelEntry.sizeGB] - Approximate download size in GB
 * @param {string|null} [modelEntry.filePath] - Absolute path for file-based models; null for Ollama-managed
 */
function markModelInstalled(store, modelEntry) {
  const { modelId, backend, capability, sizeGB = null, filePath = null } = modelEntry;
  const now = new Date().toISOString();

  const key = `manifest.models.${modelId}`;
  const existing = store.get(key, {});

  store.set(key, {
    ...existing,
    modelId,
    backend,
    capability,
    installed: true,
    sizeGB,
    filePath: filePath ?? null,
    installedAt: existing.installedAt ?? now,
    lastVerifiedAt: now,
  });

  logger.info(`manifest: marked model ${modelId} as installed (backend: ${backend})`);
}

/**
 * Runs a full verification pass over the manifest — checks that every installed
 * service executable and every file-based model still exists on disk, and that
 * Ollama-managed models are still in the Ollama model list.
 *
 * Never throws. Errors are caught and logged internally.
 * Saves the updated manifest back to the store and returns it.
 *
 * @param {import('electron-store')} store
 * @param {function(): Promise<string[]>} ollamaListFn - Async function returning an array of model name strings
 * @returns {Promise<Object>} The updated manifest object
 */
async function verifyManifest(store, ollamaListFn) {
  logger.info('manifest: starting verification pass');

  let manifest;
  try {
    manifest = store.get('manifest', buildDefaultManifest());
  } catch (err) {
    logger.error(`manifest: could not read manifest for verification — ${err.message}`);
    return buildDefaultManifest();
  }

  const now = new Date().toISOString();

  // ── Verify services ────────────────────────────────────────────────────────
  for (const [name, entry] of Object.entries(manifest.services ?? {})) {
    try {
      if (!entry.installed) continue;

      if (entry.executablePath === null) {
        // Ollama: no path to check — assume still valid (Ollama manages itself)
        manifest.services[name] = { ...entry, lastVerifiedAt: now };
        continue;
      }

      const exists = fs.existsSync(entry.executablePath);
      if (exists) {
        manifest.services[name] = { ...entry, lastVerifiedAt: now };
      } else {
        logger.warn(`manifest: service "${name}" executable not found at "${entry.executablePath}" — marking not-installed`);
        manifest.services[name] = { ...entry, installed: false };
      }
    } catch (err) {
      logger.error(`manifest: error verifying service "${name}" — ${err.message}`);
    }
  }

  // ── Gather Ollama model list (once) ───────────────────────────────────────
  let ollamaModels = [];
  try {
    ollamaModels = await ollamaListFn();
    if (!Array.isArray(ollamaModels)) ollamaModels = [];
  } catch (err) {
    logger.warn(`manifest: could not list Ollama models during verification — ${err.message}`);
  }

  // ── Verify models ─────────────────────────────────────────────────────────
  for (const [modelId, entry] of Object.entries(manifest.models ?? {})) {
    try {
      if (!entry.installed) continue;

      if (entry.backend === 'ollama') {
        // Verify via the Ollama model list
        const present = ollamaModels.some(
          (m) => m === modelId || m.startsWith(modelId.split(':')[0] + ':')
        );
        if (present) {
          manifest.models[modelId] = { ...entry, lastVerifiedAt: now };
        } else {
          logger.warn(`manifest: Ollama model "${modelId}" not found in model list — marking not-installed`);
          manifest.models[modelId] = { ...entry, installed: false };
        }
        continue;
      }

      if (entry.filePath !== null) {
        // File-based model — check disk presence
        const exists = fs.existsSync(entry.filePath);
        if (exists) {
          manifest.models[modelId] = { ...entry, lastVerifiedAt: now };
        } else {
          logger.warn(`manifest: model "${modelId}" file not found at "${entry.filePath}" — marking not-installed`);
          manifest.models[modelId] = { ...entry, installed: false };
        }
        continue;
      }

      // filePath is null and backend is not ollama — no way to verify; leave as-is
      manifest.models[modelId] = { ...entry, lastVerifiedAt: now };
    } catch (err) {
      logger.error(`manifest: error verifying model "${modelId}" — ${err.message}`);
    }
  }

  // ── Persist updated manifest ───────────────────────────────────────────────
  try {
    store.set('manifest', manifest);
    logger.info('manifest: verification complete, manifest saved');
  } catch (err) {
    logger.error(`manifest: failed to save manifest after verification — ${err.message}`);
  }

  return manifest;
}

module.exports = {
  initManifest,
  getManifest,
  markServiceInstalled,
  markModelInstalled,
  verifyManifest,
};
