/**
 * @file health-checker.js
 * @description Polls each background service's HTTP health endpoint every 5 seconds
 * and emits 'service-status' events to the renderer only on state transitions. Also
 * polls VRAM usage via nvidia-smi on every tick and emits 'vram-update' events.
 *
 * This is how the StatusBar stays accurate — it reflects real HTTP reachability,
 * not just whether a process was spawned.
 *
 * Uses only Node built-in http module — no fetch, no axios.
 */

'use strict';

const http = require('http');
const { execFile } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');
const processManager = require('./process-manager');

/** Poll interval in milliseconds */
const POLL_INTERVAL_MS = 5000;

/** HTTP check timeout in milliseconds */
const HTTP_TIMEOUT_MS = 3000;

/**
 * Health endpoint URLs keyed by service name.
 * Spec requires 127.0.0.1 (not localhost) to avoid IPv6 resolution on some Windows configs.
 */
const SERVICE_ENDPOINTS = {
  ollama:  'http://127.0.0.1:11434/',
  comfyui: 'http://127.0.0.1:8188/system_stats',
  whisper: 'http://127.0.0.1:10300/health',
  kokoro:  'http://127.0.0.1:8880/health',
};

/** @type {import('electron').BrowserWindow|null} */
let _win = null;

/** @type {NodeJS.Timeout|null} */
let _pollTimer = null;

/**
 * Last known health status per service — used for transition detection.
 * @type {Object.<string, string>}
 */
const _lastKnownStatus = {
  ollama:  'unknown',
  comfyui: 'unknown',
  whisper: 'unknown',
  kokoro:  'unknown',
};

/**
 * Makes a GET request to a URL using Node's built-in http module.
 * Resolves with { statusCode } on any response, rejects on error or timeout.
 * @param {string} url
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{statusCode: number}>}
 */
function httpGet(url, timeoutMs = HTTP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      resolve({ statusCode: res.statusCode });
      res.resume(); // drain body to free socket
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

/**
 * Checks a single service's HTTP health endpoint.
 * Returns 'running' (HTTP 200), 'starting' (process up but HTTP not ready), or 'stopped'.
 * @param {string} name - Service name
 * @returns {Promise<string>}
 */
async function checkService(name) {
  // Short-circuit: if the process manager says this service was never installed,
  // report that directly instead of attempting an HTTP check that will always fail.
  const procState = processManager.getServiceStates()[name];
  if (procState?.status === 'not-installed') {
    return 'not-installed';
  }

  try {
    const result = await httpGet(SERVICE_ENDPOINTS[name]);
    if (result.statusCode === 200) {
      return 'running';
    }
    // Non-200 — still starting or degraded
    return procState?.status === 'starting' ? 'starting' : 'stopped';
  } catch (_err) {
    // Connection refused or timeout — check if process is still starting
    if (procState?.status === 'starting') {
      return 'starting';
    }
    return 'stopped';
  }
}

/**
 * Runs a single nvidia-smi VRAM query and emits a vram-update event.
 * Silently skips if nvidia-smi is unavailable or fails.
 */
function pollVram() {
  const candidates = [
    path.join('C:', 'Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
    'nvidia-smi',
  ];

  function tryCandidate(index) {
    if (index >= candidates.length) return;
    const candidate = candidates[index];

    execFile(
      candidate,
      ['--query-gpu=memory.used,memory.free', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) {
          tryCandidate(index + 1);
          return;
        }

        try {
          const rows = stdout
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
            .map((line) => {
              const parts = line.split(',').map((p) => p.trim());
              return {
                usedMB: parseInt(parts[0], 10) || 0,
                freeMB: parseInt(parts[1], 10) || 0,
              };
            });

          if (rows.length === 0) return;

          // Pick GPU with highest combined memory (same primary GPU as detector.js)
          const primary = rows.reduce((best, row) =>
            row.usedMB + row.freeMB > best.usedMB + best.freeMB ? row : best
          );

          if (_win && !_win.isDestroyed()) {
            _win.webContents.send('vram-update', {
              usedGB: parseFloat((primary.usedMB / 1024).toFixed(2)),
              availableGB: parseFloat((primary.freeMB / 1024).toFixed(2)),
            });
          }
        } catch (parseErr) {
          logger.warn(`health-checker: VRAM parse error — ${parseErr.message}`);
        }
      }
    );
  }

  tryCandidate(0);
}

/**
 * Runs one full poll cycle: checks all service HTTP endpoints and updates VRAM.
 * Only emits service-status events when a service's status has changed.
 */
async function runPollCycle() {
  const names = Object.keys(SERVICE_ENDPOINTS);

  await Promise.all(
    names.map(async (name) => {
      try {
        const status = await checkService(name);
        if (status !== _lastKnownStatus[name]) {
          _lastKnownStatus[name] = status;
          const pid = processManager.getServiceStates()[name].pid;
          if (_win && !_win.isDestroyed()) {
            _win.webContents.send('service-status', { service: name, status, pid });
          }
          logger.info(`health-checker: [${name}] health transition → ${status}`);
        }
      } catch (err) {
        logger.warn(`health-checker: [${name}] poll error — ${err.message}`);
      }
    })
  );

  pollVram();
}

/**
 * Starts the health polling loop. Idempotent — returns early if already polling.
 * @param {import('electron').BrowserWindow} win
 */
function startPolling(win) {
  if (_pollTimer) {
    logger.info('health-checker: already polling — skipping startPolling()');
    return;
  }

  _win = win;
  logger.info('health-checker: starting poll loop (interval 5s)');

  // Run immediately on start, then on interval
  runPollCycle();
  _pollTimer = setInterval(runPollCycle, POLL_INTERVAL_MS);
}

/**
 * Stops the health polling loop and releases the timer.
 */
function stopPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
    logger.info('health-checker: polling stopped');
  }
}

/**
 * Returns a snapshot of the last known health status for all services.
 * @returns {Object.<string, string>}
 */
function getHealthStates() {
  return { ..._lastKnownStatus };
}

module.exports = { startPolling, stopPolling, getHealthStates, SERVICE_ENDPOINTS };
