/**
 * @file python-installer.js
 * @description Detects whether Python 3.11+ is already installed and, if not,
 * installs it silently via winget (Windows Package Manager, always available on
 * Windows 11). After install, probes known install paths directly because the
 * current process's PATH is not refreshed by winget.
 */

'use strict';

const { execFile } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const logger = require('../utils/logger');

/** winget install timeout — Python is ~25 MB but winget itself can be slow */
const INSTALL_TIMEOUT_MS = 5 * 60 * 1_000;

/**
 * Ordered list of paths where Python 3.11–3.13 is commonly installed on Windows.
 * Used to find python.exe after a winget install (PATH is not refreshed in-process).
 */
const PYTHON_KNOWN_PATHS = [
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
  'C:\\Python311\\python.exe',
  'C:\\Python312\\python.exe',
  'C:\\Python313\\python.exe',
];

/**
 * Tries to run a Python candidate and returns its executable path if it is 3.11+.
 * @param {string} candidate - Command or absolute path
 * @returns {Promise<string|null>} Absolute exe path, or null if unsuitable
 */
function probePython(candidate) {
  return new Promise((resolve) => {
    execFile(
      candidate,
      ['-c', 'import sys; print(sys.version_info[0], sys.version_info[1]); print(sys.executable)'],
      { windowsHide: true, timeout: 5_000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const lines = stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) return resolve(null);
        const [major, minor] = lines[0].split(' ').map(Number);
        const exePath = lines[1];
        if (exePath && !exePath.includes('WindowsApps') && (major > 3 || (major === 3 && minor >= 11))) {
          resolve(exePath);
        } else {
          resolve(null);
        }
      }
    );
  });
}

/**
 * Checks whether a suitable Python 3.11+ is already available (PATH + known paths).
 * @returns {Promise<{installed: boolean, path: string|null}>}
 */
async function isPythonInstalled() {
  for (const candidate of ['python', 'python3', 'py']) {
    const result = await probePython(candidate);
    if (result) return { installed: true, path: result };
  }
  for (const knownPath of PYTHON_KNOWN_PATHS) {
    if (!fs.existsSync(knownPath)) continue;
    const result = await probePython(knownPath);
    if (result) return { installed: true, path: result };
  }
  return { installed: false, path: null };
}

/**
 * Silently installs Python 3.11 via winget, then probes known paths to find
 * the executable (PATH is not refreshed within a running process).
 *
 * @param {function(number): void} onProgress - Receives percent 0–100
 * @returns {Promise<string>} Absolute path to the installed python.exe
 * @throws {Error} If winget fails or Python still cannot be found after install
 */
async function installPython(onProgress) {
  onProgress(0);
  logger.info('python-installer: running winget install Python.Python.3.11');

  await new Promise((resolve, reject) => {
    execFile(
      'winget',
      [
        'install',
        '--id', 'Python.Python.3.11',
        '--silent',
        '--accept-package-agreements',
        '--accept-source-agreements',
      ],
      { windowsHide: true, timeout: INSTALL_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          // winget exit code for "already installed" — treat as success
          const alreadyInstalled =
            (stdout && stdout.includes('already installed')) ||
            err.code === 0;
          if (alreadyInstalled) return resolve();
          reject(new Error(`python-installer: winget failed — ${err.message}`));
        } else {
          resolve();
        }
      }
    );
  });

  onProgress(80);
  logger.info('python-installer: winget completed — probing for python.exe');

  // PATH is not refreshed; probe known install locations directly
  for (const knownPath of PYTHON_KNOWN_PATHS) {
    if (!fs.existsSync(knownPath)) continue;
    const result = await probePython(knownPath);
    if (result) {
      onProgress(100);
      logger.info(`python-installer: found Python at "${result}"`);
      return result;
    }
  }

  // Also retry PATH-based candidates in case the shell session updated
  for (const candidate of ['py', 'python', 'python3']) {
    const result = await probePython(candidate);
    if (result) {
      onProgress(100);
      logger.info(`python-installer: found Python via "${candidate}" at "${result}"`);
      return result;
    }
  }

  throw new Error(
    'python-installer: Python was installed by winget but could not be located. ' +
    'Please restart the Noxio app to pick up the updated PATH.'
  );
}

module.exports = { isPythonInstalled, installPython };
