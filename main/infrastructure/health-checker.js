/**
 * @file health-checker.js
 * @description Polls each background service's HTTP endpoint at a fixed interval
 * and emits 'service-status' events to the renderer when status changes. This is
 * how the StatusBar stays accurate — it reflects real service health, not just
 * whether a process was spawned.
 *
 * Poll endpoints:
 *   Ollama    → GET http://localhost:11434/api/tags (200 = healthy)
 *   LiteLLM   → GET http://localhost:4000/health   (200 = healthy)
 *   ComfyUI   → GET http://localhost:8188/system_stats (200 = healthy)
 *   Whisper   → GET http://localhost:10300/health  (200 = healthy)
 *   Kokoro    → GET http://localhost:8880/health   (200 = healthy)
 *
 * TODO Phase 2: implement polling loop and HTTP health checks.
 */

'use strict';

const logger = require('../utils/logger');

const SERVICE_ENDPOINTS = {
  ollama: 'http://localhost:11434/api/tags',
  litellm: 'http://localhost:4000/health',
  comfyui: 'http://localhost:8188/system_stats',
  whisper: 'http://localhost:10300/health',
  kokoro: 'http://localhost:8880/health',
};

const POLL_INTERVAL_MS = 5000;

/** @type {NodeJS.Timeout|null} */
let pollTimer = null;

/** @type {import('electron').BrowserWindow|null} */
let _mainWindow = null;

/**
 * Starts the health polling loop.
 * TODO Phase 2: implement HTTP checks and status diffing.
 * @param {import('electron').BrowserWindow} mainWindow
 */
function startPolling(mainWindow) {
  _mainWindow = mainWindow;
  logger.info('health-checker: startPolling() — stub (Phase 2)');
  // TODO Phase 2: poll each endpoint, diff against last known status, emit events
}

/**
 * Stops the health polling loop.
 */
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info('health-checker: polling stopped');
  }
}

module.exports = { startPolling, stopPolling, SERVICE_ENDPOINTS };
