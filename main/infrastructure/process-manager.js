/**
 * @file process-manager.js
 * @description Spawns, monitors, restarts, and gracefully shuts down all 4 background
 * services (Ollama, ComfyUI, Whisper, Kokoro). Tracks PIDs, handles unexpected
 * crashes with exponential backoff restarts, and emits service-status events to the
 * renderer via the BrowserWindow reference.
 *
 * All service spawning in Noxio must go through this module — never spawn services
 * directly from IPC handlers or service wrapper modules.
 *
 * Shutdown order: kokoro → whisper → comfyui → ollama (sequential).
 */

'use strict';

const { spawn, execFile } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const logger = require('../utils/logger');

/** @type {import('electron').BrowserWindow|null} */
let _win = null;

/**
 * Service executable paths persisted from a previous install.
 * Loaded at startup from electron-store via setPersistedPaths().
 * @type {Object.<string, string|null>}
 */
let _servicePaths = {};

/**
 * Tracks which services were successfully installed.
 * Services not marked installed will emit 'not-installed' status instead of starting.
 * @type {Object.<string, boolean>}
 */
let _installedServices = {};

/**
 * Registry of service configurations. Executable paths and some args are resolved
 * at init/startService time — null entries are filled in dynamically.
 * @type {Object.<string, {executable: string|null, args: string[], cwd: string|null, env: Object, maxRestarts: number, restartDelayBaseMs: number}>}
 */
const SERVICE_CONFIG = {
  ollama: {
    executable: null,
    args: ['serve'],
    cwd: null,
    env: {
      OLLAMA_HOST: '0.0.0.0',
      OLLAMA_KEEP_ALIVE: '-1',
      OLLAMA_NUM_GPU: '999',
      OLLAMA_FLASH_ATTENTION: '1',
    },
    maxRestarts: 5,
    restartDelayBaseMs: 1000,
  },
  comfyui: {
    executable: null,
    // run_nvidia_gpu.bat is a self-contained launcher — no extra args needed
    args: [],
    cwd: null,
    env: {},
    maxRestarts: 5,
    restartDelayBaseMs: 1000,
  },
  whisper: {
    executable: null,
    // Absolute path so the Python executable finds the script regardless of cwd
    args: [path.join(__dirname, '..', 'scripts', 'whisper_server.py'), '--port', '10300'],
    cwd: path.join(__dirname, '..', 'scripts'),
    env: {},
    maxRestarts: 5,
    restartDelayBaseMs: 1000,
  },
  kokoro: {
    executable: null,
    args: [path.join(__dirname, '..', 'scripts', 'kokoro_server.py'), '--port', '8880'],
    cwd: path.join(__dirname, '..', 'scripts'),
    env: {},
    maxRestarts: 5,
    restartDelayBaseMs: 1000,
  },
};

/**
 * Runtime state per service.
 * @type {Object.<string, {status: string, pid: number|null, restartCount: number, lastExitCode: number|null, startedAt: string|null}>}
 */
const serviceStates = {
  ollama:  { status: 'stopped', pid: null, restartCount: 0, lastExitCode: null, startedAt: null },
  comfyui: { status: 'stopped', pid: null, restartCount: 0, lastExitCode: null, startedAt: null },
  whisper: { status: 'stopped', pid: null, restartCount: 0, lastExitCode: null, startedAt: null },
  kokoro:  { status: 'stopped', pid: null, restartCount: 0, lastExitCode: null, startedAt: null },
};

/** Live child process references keyed by service name */
const _children = {};

/**
 * Timers used to reset restartCount after 30s of stable running.
 * Cleared if the service crashes before the 30s window expires.
 * @type {Object.<string, NodeJS.Timeout|null>}
 */
const _stableTimers = {};

/** Intentional stop flags — prevents restart loop after an explicit stopService() */
const _intentionalStop = {};

/**
 * Tracks services that were adopted (already running externally) rather than spawned.
 * These have no _children entry but must still be killed on shutdown.
 */
const _adopted = {};

/**
 * Emits a service-status event to the renderer. Safe to call before window is shown.
 * @param {string} name - Service name
 * @param {string} status
 * @param {number|null} pid
 */
function emitStatus(name, status, pid = null) {
  serviceStates[name].status = status;
  serviceStates[name].pid = pid;
  if (_win && !_win.isDestroyed()) {
    _win.webContents.send('service-status', { service: name, status, pid });
  }
  logger.info(`process-manager: [${name}] status → ${status}${pid ? ` (pid ${pid})` : ''}`);
}

/**
 * Attempts to resolve the Ollama executable path.
 * Tries the standard AppData install location, then Program Files, then PATH.
 * @returns {Promise<string>} Resolved path
 */
async function resolveOllamaPath() {
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
    path.join('C:', 'Program Files', 'Ollama', 'ollama.exe'),
    'ollama',
  ];

  for (const candidate of candidates) {
    try {
      await new Promise((resolve, reject) => {
        execFile(
          candidate,
          ['--version'],
          { windowsHide: true, timeout: 5000 },
          (err) => (err ? reject(err) : resolve())
        );
      });
      logger.info(`process-manager: resolved Ollama at "${candidate}"`);
      return candidate;
    } catch (_) {
      // Try next candidate
    }
  }
  throw new Error('Ollama executable not found on any candidate path');
}

/**
 * Resolves the Python executable path (python or python3) on PATH.
 * Returns the full path so we can derive the Scripts directory for pip-installed CLIs.
 * @returns {Promise<string>} Full path to python executable
 */
async function resolvePythonPath() {
  for (const candidate of ['python', 'python3']) {
    try {
      const fullPath = await new Promise((resolve, reject) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', `(Get-Command ${candidate} -ErrorAction SilentlyContinue)?.Source`],
          { windowsHide: true, timeout: 5000 },
          (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))
        );
      });
      if (fullPath && !fullPath.includes('WindowsApps')) {
        logger.info(`process-manager: resolved Python at "${fullPath}"`);
        return fullPath;
      }
    } catch (_) {
      // Try next
    }
  }
  throw new Error('Python not found on PATH (tried python and python3)');
}

/**
 * Initialises the process manager with a BrowserWindow reference so it can push
 * service-status events to the renderer. Must be called once after window creation.
 * @param {import('electron').BrowserWindow} win
 */
function init(win) {
  _win = win;
  logger.info('process-manager: initialised');
}

/**
 * Loads persisted service paths and installed-service flags from the electron-store
 * snapshot. Must be called before startService() so that custom executables are used.
 *
 * @param {Object.<string, string|null>} servicePaths - Map of service name → executable path
 * @param {Object.<string, boolean>} installedServices - Map of service name → installed flag
 */
function setPersistedPaths(servicePaths, installedServices) {
  _servicePaths = servicePaths || {};
  _installedServices = installedServices || {};
  logger.info('process-manager: persisted paths loaded', { servicePaths, installedServices });
}

/**
 * Spawns a service process, attaches crash detection, and manages auto-restart
 * with exponential backoff. Internal — called by startService and by the restart loop.
 * @param {string} name - Service name key in SERVICE_CONFIG
 */
function spawnService(name) {
  const config = SERVICE_CONFIG[name];

  if (!config.executable) {
    logger.error(`process-manager: no executable resolved for "${name}" — cannot spawn`);
    emitStatus(name, 'crashed');
    return;
  }

  const child = spawn(config.executable, config.args, {
    cwd: config.cwd || undefined,
    env: { ...process.env, ...config.env },
    windowsHide: true,
    // shell: false — explicitly never use shell
  });

  _children[name] = child;
  serviceStates[name].startedAt = new Date().toISOString();

  // For Ollama: defer the 'running' emit until the HTTP API is actually ready,
  // so that ModelSelector's retry effect fires only after /api/tags is reachable.
  // For all other services, emit immediately as before.
  if (name === 'ollama') {
    pollOllamaReady(name, child.pid, () => emitStatus(name, 'running', child.pid));
  } else {
    emitStatus(name, 'running', child.pid);
  }

  // Reset restartCount after 30 seconds of stable running so a previously-crashed
  // service that recovers gets the full 5 restart chances again.
  if (_stableTimers[name]) clearTimeout(_stableTimers[name]);
  _stableTimers[name] = setTimeout(() => {
    if (serviceStates[name].status === 'running') {
      serviceStates[name].restartCount = 0;
      logger.info(`process-manager: [${name}] running stably for 30s — restartCount reset to 0`);
    }
    _stableTimers[name] = null;
  }, 30_000);

  child.stdout.on('data', (data) => {
    logger.info(`[${name}] ${data.toString().trim()}`);
  });

  child.stderr.on('data', (data) => {
    logger.info(`[${name}] stderr: ${data.toString().trim()}`);
  });

  child.on('error', (err) => {
    if (err.code === 'ENOENT' || err.code === 'EACCES') {
      logger.error(`process-manager: [${name}] spawn error (${err.code}): ${err.message}`);
      emitStatus(name, 'crashed');
    } else {
      logger.error(`process-manager: [${name}] process error: ${err.message}`);
      emitStatus(name, 'crashed');
    }
  });

  child.on('close', (code) => {
    serviceStates[name].lastExitCode = code;
    _children[name] = null;
    // Cancel the stability timer — the process is no longer running
    if (_stableTimers[name]) {
      clearTimeout(_stableTimers[name]);
      _stableTimers[name] = null;
    }

    if (_intentionalStop[name]) {
      _intentionalStop[name] = false;
      emitStatus(name, 'stopped');
      return;
    }

    if (code !== 0) {
      const { restartCount, maxRestarts, restartDelayBaseMs } = {
        restartCount: serviceStates[name].restartCount,
        ...config,
      };

      if (restartCount >= config.maxRestarts) {
        logger.error(
          `process-manager: [${name}] crashed ${restartCount} times — max retries exceeded`
        );
        emitStatus(name, 'crashed');
        if (_win && !_win.isDestroyed()) {
          _win.webContents.send('service-status', {
            service: name,
            status: 'crashed',
            pid: null,
            maxRetriesExceeded: true,
          });
        }
        return;
      }

      const delay = Math.min(config.restartDelayBaseMs * 2 ** restartCount, 30000);
      serviceStates[name].restartCount += 1;
      emitStatus(name, 'restarting');

      logger.warn(
        `process-manager: [${name}] exited with code ${code} — restarting in ${delay}ms ` +
        `(attempt ${serviceStates[name].restartCount}/${config.maxRestarts})`
      );

      setTimeout(() => spawnService(name), delay);
    } else {
      // Clean exit
      emitStatus(name, 'stopped');
    }
  });
}

/**
 * Checks if Ollama is already serving on port 11434 before we try to spawn it.
 * Returns true if an existing instance is detected, false otherwise.
 * @returns {Promise<boolean>}
 */
function checkOllamaAlreadyRunning() {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: 11434, path: '/api/tags', timeout: 5000 },
      (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 300);
        res.resume(); // drain the response
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Polls Ollama's HTTP API until it responds successfully, then calls onReady.
 * Stops polling if the child process has already exited (name no longer in _children).
 * Used to defer the 'running' status emit until Ollama is actually ready to serve.
 *
 * @param {string} name        - Service name (used to check if process is still alive)
 * @param {number} pid         - Child PID (for logging)
 * @param {Function} onReady   - Called when Ollama is confirmed ready
 * @param {number} [attempt=0] - Internal retry counter
 */
function pollOllamaReady(name, pid, onReady, attempt = 0) {
  const MAX_ATTEMPTS = 30; // 30 × 1 s = 30 s max wait
  const INTERVAL_MS  = 1_000;

  if (attempt >= MAX_ATTEMPTS) {
    logger.warn(`process-manager: [${name}] API not ready after ${MAX_ATTEMPTS}s — emitting running anyway`);
    onReady();
    return;
  }

  // If the process died before it became ready, stop polling
  if (_children[name] === null || _children[name] === undefined) {
    logger.warn(`process-manager: [${name}] process exited before API became ready — aborting poll`);
    return;
  }

  const req = http.get(
    { hostname: '127.0.0.1', port: 11434, path: '/api/tags', timeout: 2000 },
    (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logger.info(`process-manager: [${name}] API ready (pid ${pid}) after ${attempt + 1} probe(s)`);
        onReady();
      } else {
        setTimeout(() => pollOllamaReady(name, pid, onReady, attempt + 1), INTERVAL_MS);
      }
    }
  );
  req.on('error', () => {
    setTimeout(() => pollOllamaReady(name, pid, onReady, attempt + 1), INTERVAL_MS);
  });
  req.on('timeout', () => {
    req.destroy();
    setTimeout(() => pollOllamaReady(name, pid, onReady, attempt + 1), INTERVAL_MS);
  });
}

/**
 * Starts a named background service. Resolves executable paths on first call.
 * If the service is not yet installed (per _installedServices), emits 'not-installed'
 * and returns without spawning.
 * @param {string} name - 'ollama' | 'comfyui' | 'whisper' | 'kokoro'
 * @returns {Promise<void>}
 */
async function startService(name) {
  if (!SERVICE_CONFIG[name]) {
    throw new Error(`process-manager: unknown service "${name}"`);
  }

  if (serviceStates[name].status === 'running' || serviceStates[name].status === 'starting') {
    logger.info(`process-manager: [${name}] already running or starting — skipping`);
    return;
  }

  // Non-Ollama services require successful installation before they can be started.
  // Ollama is managed separately (adopt-or-spawn) so this check doesn't apply to it.
  // Treat both explicit false AND missing/undefined as not-installed — undefined means the
  // wizard was never run for that capability, or the service was never selected.
  if (name !== 'ollama' && !_installedServices[name] && !_servicePaths[name]) {
    logger.info(`process-manager: [${name}] not installed — emitting not-installed`);
    emitStatus(name, 'not-installed');
    return;
  }

  emitStatus(name, 'starting');
  serviceStates[name].restartCount = 0;
  _intentionalStop[name] = false;

  // If Ollama is already serving externally, adopt it rather than spawning a second instance.
  // Mark it as adopted so stopService can kill it on shutdown even without a _children ref.
  if (name === 'ollama') {
    const alreadyRunning = await checkOllamaAlreadyRunning();
    if (alreadyRunning) {
      logger.info('process-manager: [ollama] detected existing instance on port 11434 — adopting, skipping spawn');
      _adopted[name] = true;
      emitStatus(name, 'running');
      return;
    }
  }

  // Check persisted path first — set by installer via setPersistedPaths()
  if (!SERVICE_CONFIG[name].executable && _servicePaths[name]) {
    if (name === 'comfyui') {
      // Bypass the bat launcher and run python_embeded directly so we can pass
      // --disable-auto-launch (the bat uses --windows-standalone-build which
      // opens a browser window on startup, which we don't want).
      const comfyDir = path.dirname(_servicePaths[name]);
      const embeddedPython = path.join(comfyDir, 'python_embeded', 'python.exe');
      const mainScript = path.join(comfyDir, 'ComfyUI', 'main.py');
      SERVICE_CONFIG[name].executable = embeddedPython;
      SERVICE_CONFIG[name].args = ['-s', mainScript, '--windows-standalone-build', '--disable-auto-launch'];
      SERVICE_CONFIG[name].cwd = comfyDir;
    } else {
      SERVICE_CONFIG[name].executable = _servicePaths[name];
    }
    logger.info(`process-manager: [${name}] using persisted path "${_servicePaths[name]}"`);
  }

  // Resolve executable on first start (fallback dynamic resolution)
  if (!SERVICE_CONFIG[name].executable) {
    try {
      if (name === 'ollama') {
        SERVICE_CONFIG[name].executable = await resolveOllamaPath();
      } else {
        // comfyui, whisper, kokoro — run via Python
        SERVICE_CONFIG[name].executable = await resolvePythonPath();
      }
    } catch (err) {
      logger.warn(`process-manager: [${name}] executable not found — ${err.message} (install required)`);
      emitStatus(name, 'crashed');
      return;
    }
  }

  spawnService(name);
}

/**
 * Stops a named service gracefully. Sends SIGTERM, waits up to 8 seconds,
 * then force-kills if still running.
 * @param {string} name - Service name
 * @returns {Promise<void>}
 */
async function stopService(name) {
  const child = _children[name];

  // If we adopted an external instance rather than spawning it, we still need to kill
  // it on shutdown — otherwise the model stays loaded in VRAM after Noxio exits.
  if (!child && _adopted[name]) {
    _adopted[name] = false;
    logger.info(`process-manager: [${name}] killing adopted instance by process name`);
    await new Promise((resolve) => {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/F', '/IM', 'ollama.exe', '/T'], { windowsHide: true }, () => resolve());
      } else {
        execFile('pkill', ['-x', 'ollama'], () => resolve());
      }
    });
    emitStatus(name, 'stopped');
    return;
  }

  if (!child || serviceStates[name].status === 'stopped') {
    logger.info(`process-manager: [${name}] not running — skipping stop`);
    return;
  }

  _intentionalStop[name] = true;

  return new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      logger.warn(`process-manager: [${name}] did not exit in 8s — force killing`);
      try {
        if (process.platform === 'win32' && child.pid) {
          execFile('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true }, () => {});
        } else {
          child.kill();
        }
      } catch (_) { /* already dead */ }
      resolve();
    }, 8000);

    child.once('close', () => {
      clearTimeout(forceKillTimer);
      resolve();
    });

    try {
      if (process.platform === 'win32' && child.pid) {
        // On Windows, child.kill('SIGTERM') only terminates the root process.
        // Ollama spawns a llama_server child that holds GPU memory — use
        // taskkill /T to kill the entire process tree so VRAM is freed.
        execFile(
          'taskkill',
          ['/F', '/T', '/PID', String(child.pid)],
          { windowsHide: true },
          (err) => {
            if (err) {
              logger.warn(`process-manager: [${name}] taskkill /T failed: ${err.message} — falling back to kill()`);
              try { child.kill(); } catch (_) { /* already dead */ }
            }
          }
        );
      } else {
        child.kill('SIGTERM');
      }
    } catch (err) {
      logger.warn(`process-manager: [${name}] kill failed: ${err.message}`);
      clearTimeout(forceKillTimer);
      resolve();
    }
  });
}

/**
 * Stops all services in the reverse startup order to avoid dependency issues.
 * Sequential — awaits each before moving to the next.
 * Order: kokoro → whisper → comfyui → ollama
 * @returns {Promise<void>}
 */
async function stopAll() {
  logger.info('process-manager: stopping all services');
  const order = ['kokoro', 'whisper', 'comfyui', 'ollama'];
  for (const name of order) {
    await stopService(name);
  }
  logger.info('process-manager: all services stopped');
}

/**
 * Returns a deep clone of the current service state map so callers cannot
 * mutate internal state.
 * @returns {Object.<string, {status: string, pid: number|null, restartCount: number, lastExitCode: number|null, startedAt: string|null}>}
 */
function getServiceStates() {
  return JSON.parse(JSON.stringify(serviceStates));
}

module.exports = {
  init,
  setPersistedPaths,
  startService,
  stopService,
  stopAll,
  getServiceStates,
  SERVICE_CONFIG,
};
