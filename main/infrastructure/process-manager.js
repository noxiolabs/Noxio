/**
 * @file process-manager.js
 * @description Spawns, monitors, and restarts background service processes
 * (Ollama, LiteLLM, ComfyUI, Whisper, Kokoro). Tracks PIDs, handles unexpected
 * crashes with exponential backoff restarts, and emits status events to the
 * renderer via the mainWindow reference.
 *
 * All service spawning in Noxio goes through this module — never spawn processes
 * directly from IPC handlers or service modules.
 *
 * TODO Phase 2: implement spawn/monitor/restart logic.
 */

'use strict';

const logger = require('../utils/logger');

/**
 * @typedef {'stopped'|'starting'|'running'|'error'} ServiceStatus
 *
 * @typedef {Object} ManagedService
 * @property {string}        name    - Service identifier
 * @property {number|null}   pid     - OS process ID, null if not running
 * @property {ServiceStatus} status
 * @property {number}        restarts - Consecutive restart count (reset on clean uptime)
 */

/** @type {Map<string, ManagedService>} */
const services = new Map();

/** @type {import('electron').BrowserWindow|null} */
let _mainWindow = null;

/**
 * Initialises the process manager with a reference to the main window so it
 * can push service-status events to the renderer.
 * @param {import('electron').BrowserWindow} mainWindow
 */
function init(mainWindow) {
  _mainWindow = mainWindow;
  logger.info('process-manager: initialised');
}

/**
 * Emits a service-status event to the renderer.
 * @param {string} service
 * @param {ServiceStatus} status
 * @param {number|null} pid
 */
function emitStatus(service, status, pid = null) {
  if (_mainWindow) {
    _mainWindow.webContents.send('service-status', { service, status, pid });
  }
}

/**
 * Starts a named service process.
 * TODO Phase 2: implement spawn with crash detection and restart backoff.
 * @param {string} serviceName
 * @param {string} executablePath
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function startService(serviceName, executablePath, args = []) {
  logger.info(`process-manager: startService(${serviceName}) — stub`);
  emitStatus(serviceName, 'starting', null);
  // TODO Phase 2: spawn process, track PID, set up crash handler
}

/**
 * Stops a named service process gracefully, then force-kills if it doesn't exit.
 * TODO Phase 2: implement graceful stop + force kill fallback.
 * @param {string} serviceName
 * @returns {Promise<void>}
 */
async function stopService(serviceName) {
  logger.info(`process-manager: stopService(${serviceName}) — stub`);
  emitStatus(serviceName, 'stopped', null);
  // TODO Phase 2: send SIGTERM, wait, then SIGKILL
}

/**
 * Returns the current status of all tracked services.
 * @returns {Map<string, ManagedService>}
 */
function getStatuses() {
  return services;
}

module.exports = { init, startService, stopService, getStatuses };
