/**
 * @file process-manager.js
 * @description Spawns, monitors, restarts, and gracefully shuts down all 5 background
 * services (Ollama, LiteLLM, ComfyUI, Whisper, Kokoro). Tracks PIDs, handles unexpected
 * crashes with exponential backoff restarts, and emits service-status events to the
 * renderer via the BrowserWindow reference.
 *
 * All service spawning in Noxio must go through this module — never spawn services
 * directly from IPC handlers or service wrapper modules.
 *
 * Shutdown order: kokoro → whisper → comfyui → litellm → ollama (sequential).
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
  litellm: {
    executable: null,
    args: ['--config', null, '--port', '4000'],
    cwd: null,
    env: {},
    maxRestarts: 5,
    restartDelayBaseMs: 1000,
  },
  comfyui: {
    executable: null,
    args: ['main.py', '--listen', '0.0.0.0', '--port', '8188'],
    cwd: null,
    env: {},
    maxRestarts: 5,
    restartDelayBaseMs: 1000,
  },
  whisper: {
    executable: null,
    args: ['server.py', '--port', '10300'],
    cwd: null,
    env: {},
    maxRestarts: 5,
    restartDelayBaseMs: 1000,
  },
  kokoro: {
    executable: null,
    args: ['app.py', '--port', '8880'],
    cwd: null,
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
  litellm: { status: 'stopped', pid: null, restartCount: 0, lastExitCode: null, startedAt: null },
  comfyui: { status: 'stopped', pid: null, restartCount: 0, lastExitCode: null, startedAt: null },
  whisper: { status: 'stopped', pid: null, restartCount: 0, lastExitCode: null, startedAt: null },
  kokoro:  { status: 'stopped', pid: null, restartCount: 0, lastExitCode: null, startedAt: null },
};

/** Live child process references keyed by service name */
const _children = {};

/** Intentional stop flags — prevents restart loop after an explicit stopService() */
const _intentionalStop = {};

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
 * Resolves the litellm CLI executable from the Python Scripts directory.
 * litellm does not support `python -m litellm` — must be run as the CLI entry point.
 * @returns {Promise<string>} Full path to litellm.exe
 */
async function resolveLiteLLMPath() {
  // First try: litellm.exe directly on PATH
  for (const candidate of ['litellm', 'litellm.exe']) {
    try {
      const fullPath = await new Promise((resolve, reject) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', `(Get-Command ${candidate} -ErrorAction SilentlyContinue)?.Source`],
          { windowsHide: true, timeout: 5000 },
          (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))
        );
      });
      if (fullPath && fullPath.endsWith('.exe')) {
        logger.info(`process-manager: resolved litellm CLI at "${fullPath}"`);
        return fullPath;
      }
    } catch (_) {
      // Try next
    }
  }

  // Second try: derive Scripts dir from Python location
  try {
    const pythonPath = await resolvePythonPath();
    const scriptsDir = path.join(path.dirname(pythonPath), 'Scripts');
    const litellmExe = path.join(scriptsDir, 'litellm.exe');
    await new Promise((resolve, reject) => {
      execFile(litellmExe, ['--version'], { windowsHide: true, timeout: 5000 }, (err) =>
        err ? reject(err) : resolve()
      );
    });
    logger.info(`process-manager: resolved litellm CLI at "${litellmExe}"`);
    return litellmExe;
  } catch (_) {
    // Fall through
  }

  throw new Error('litellm CLI not found — run: pip install litellm');
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

  // For litellm, replace the null config path placeholder before spawning
  const args = config.args.map((a) => (a === null ? '' : a));

  const child = spawn(config.executable, args, {
    cwd: config.cwd || undefined,
    env: { ...process.env, ...config.env },
    windowsHide: true,
    // shell: false — explicitly never use shell
  });

  _children[name] = child;
  serviceStates[name].startedAt = new Date().toISOString();

  emitStatus(name, 'running', child.pid);

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
      { hostname: '127.0.0.1', port: 11434, path: '/api/tags', timeout: 2000 },
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
 * Starts a named background service. Resolves executable paths on first call.
 * @param {string} name - 'ollama' | 'litellm' | 'comfyui' | 'whisper' | 'kokoro'
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

  emitStatus(name, 'starting');
  serviceStates[name].restartCount = 0;
  _intentionalStop[name] = false;

  // If Ollama is already serving externally, adopt it rather than spawning a second instance.
  if (name === 'ollama') {
    const alreadyRunning = await checkOllamaAlreadyRunning();
    if (alreadyRunning) {
      logger.info('process-manager: [ollama] detected existing instance on port 11434 — adopting, skipping spawn');
      emitStatus(name, 'running');
      return;
    }
  }

  // Resolve executable on first start
  if (!SERVICE_CONFIG[name].executable) {
    try {
      if (name === 'ollama') {
        SERVICE_CONFIG[name].executable = await resolveOllamaPath();
      } else if (name === 'litellm') {
        // litellm has a dedicated CLI entry point — cannot be run via `python -m litellm`
        SERVICE_CONFIG[name].executable = await resolveLiteLLMPath();
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
  if (!child || serviceStates[name].status === 'stopped') {
    logger.info(`process-manager: [${name}] not running — skipping stop`);
    return;
  }

  _intentionalStop[name] = true;

  return new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      logger.warn(`process-manager: [${name}] did not exit in 8s — force killing`);
      try { child.kill(); } catch (_) { /* already dead */ }
      resolve();
    }, 8000);

    child.once('close', () => {
      clearTimeout(forceKillTimer);
      resolve();
    });

    try {
      child.kill('SIGTERM');
    } catch (err) {
      logger.warn(`process-manager: [${name}] kill(SIGTERM) failed: ${err.message}`);
      clearTimeout(forceKillTimer);
      resolve();
    }
  });
}

/**
 * Stops all services in the reverse startup order to avoid dependency issues.
 * Sequential — awaits each before moving to the next.
 * Order: kokoro → whisper → comfyui → litellm → ollama
 * @returns {Promise<void>}
 */
async function stopAll() {
  logger.info('process-manager: stopping all services');
  const order = ['kokoro', 'whisper', 'comfyui', 'litellm', 'ollama'];
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
  startService,
  stopService,
  stopAll,
  getServiceStates,
  SERVICE_CONFIG,
};
