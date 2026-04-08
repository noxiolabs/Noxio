/**
 * @file ollama-installer.js
 * @description Detects whether Ollama is already installed and, if not, downloads
 * and silently installs it from the official release URL. Used by the installer
 * orchestrator during the setup wizard so users never need to install Ollama manually.
 *
 * Ollama uses an NSIS silent installer flag `/S` for unattended installation.
 * After install, this module polls the Ollama HTTP API until it confirms the service
 * is up before resolving, so callers can proceed to the model-download step immediately.
 */

'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const logger = require('../utils/logger');

/** Ordered list of candidate paths where Ollama might be installed. */
const OLLAMA_CANDIDATES = [
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
  path.join('C:', 'Program Files', 'Ollama', 'ollama.exe'),
  'ollama',
];

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download/OllamaSetup.exe';
/** How long to wait (ms) for the silent installer to complete. */
const INSTALLER_TIMEOUT_MS = 120_000;
/** How long (ms) to poll Ollama after install before giving up. */
const POST_INSTALL_POLL_TIMEOUT_MS = 15_000;
const POST_INSTALL_POLL_INTERVAL_MS = 1_000;

/**
 * Checks whether Ollama is already installed by probing each candidate path.
 * @returns {Promise<{installed: boolean, path: string|null}>}
 */
async function isOllamaInstalled() {
  for (const candidate of OLLAMA_CANDIDATES) {
    try {
      await new Promise((resolve, reject) => {
        execFile(
          candidate,
          ['--version'],
          { windowsHide: true, timeout: 5_000 },
          (err) => (err ? reject(err) : resolve())
        );
      });
      logger.info(`ollama-installer: found Ollama at "${candidate}"`);
      return { installed: true, path: candidate };
    } catch (_) {
      // Candidate not found or failed — try next
    }
  }
  return { installed: false, path: null };
}

/**
 * Downloads a file over HTTPS, streaming it to disk.
 * Reports download progress via onProgress whenever the percent changes by >= 2.
 *
 * @param {string} url - HTTPS URL to download
 * @param {string} destPath - Absolute path to write the file to
 * @param {function(number): void} onProgress - Receives percent complete (0–100)
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const request = https.get(url, { timeout: INSTALLER_TIMEOUT_MS }, (response) => {
      // Handle HTTP redirects (Ollama CDN may use them)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        downloadFile(response.headers.location, destPath, onProgress).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`ollama-installer: download failed with HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let receivedBytes = 0;
      let lastReportedPercent = -1;

      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = Math.floor((receivedBytes / totalBytes) * 100);
          if (percent >= lastReportedPercent + 2) {
            lastReportedPercent = percent;
            try { onProgress(percent); } catch (_) { /* non-fatal */ }
          }
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(new Error(`ollama-installer: download request error — ${err.message}`));
    });

    file.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(new Error(`ollama-installer: file write error — ${err.message}`));
    });
  });
}

/**
 * Polls the Ollama API endpoint until it responds 200 or the timeout elapses.
 * @returns {Promise<boolean>} True if Ollama came up within the timeout window.
 */
function pollOllamaReady() {
  return new Promise((resolve) => {
    const deadline = Date.now() + POST_INSTALL_POLL_TIMEOUT_MS;

    function check() {
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      const req = http.get(
        { hostname: '127.0.0.1', port: 11434, path: '/api/tags', timeout: 2_000 },
        (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            res.resume();
            resolve(true);
          } else {
            res.resume();
            setTimeout(check, POST_INSTALL_POLL_INTERVAL_MS);
          }
        }
      );
      req.on('error', () => setTimeout(check, POST_INSTALL_POLL_INTERVAL_MS));
      req.on('timeout', () => { req.destroy(); setTimeout(check, POST_INSTALL_POLL_INTERVAL_MS); });
    }

    check();
  });
}

/**
 * Downloads and silently installs Ollama from the official release URL.
 * Polls the Ollama API after install to confirm it is ready before resolving.
 *
 * @param {function(number): void} onProgress - Receives overall percent 0–100
 * @returns {Promise<void>}
 * @throws {Error} If download fails, installer exits non-zero, or Ollama doesn't start
 */
async function installOllama(onProgress) {
  const tmpExePath = path.join(os.tmpdir(), `noxio-ollama-setup-${Date.now()}.exe`);

  try {
    logger.info(`ollama-installer: downloading Ollama installer to "${tmpExePath}"`);
    onProgress(0);

    // Download — occupies 0–80% of the step
    await downloadFile(OLLAMA_DOWNLOAD_URL, tmpExePath, (dlPercent) => {
      onProgress(Math.floor(dlPercent * 0.8));
    });

    onProgress(80);
    logger.info('ollama-installer: download complete — running silent installer');

    // Run silent installer
    await new Promise((resolve, reject) => {
      execFile(
        tmpExePath,
        ['/S'],
        { windowsHide: true, timeout: INSTALLER_TIMEOUT_MS },
        (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`ollama-installer: installer exited with error — ${err.message}${stderr ? ` | ${stderr}` : ''}`));
          } else {
            resolve();
          }
        }
      );
    });

    onProgress(90);
    logger.info('ollama-installer: installer completed — waiting for Ollama to come up');

    // Poll for Ollama API readiness
    const ready = await pollOllamaReady();
    if (!ready) {
      throw new Error('ollama-installer: Ollama did not start within 15s after install');
    }

    onProgress(100);
    logger.info('ollama-installer: Ollama is running and ready');
  } finally {
    // Always clean up the temp installer exe
    try {
      fs.unlinkSync(tmpExePath);
    } catch (_) {
      // File may not exist if download failed — ignore
    }
  }
}

/**
 * Returns the currently installed Ollama version string (e.g. '0.6.2'), or null
 * if Ollama is not installed or the version cannot be determined.
 * @returns {Promise<string|null>}
 */
async function getOllamaVersion() {
  for (const candidate of OLLAMA_CANDIDATES) {
    try {
      const stdout = await new Promise((resolve, reject) => {
        execFile(
          candidate,
          ['--version'],
          { windowsHide: true, timeout: 5_000 },
          (err, out) => (err ? reject(err) : resolve(out.trim()))
        );
      });
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    } catch (_) {
      // Try next candidate
    }
  }
  return null;
}

/**
 * Fetches the latest published Ollama version from the GitHub Releases API.
 * Returns null if the request fails or the response cannot be parsed.
 * @returns {Promise<string|null>}
 */
async function getLatestOllamaVersion() {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: '/repos/ollama/ollama/releases/latest',
        headers: { 'User-Agent': 'Noxio-App' },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve((data.tag_name ?? '').replace(/^v/, '') || null);
          } catch (_) {
            resolve(null);
          }
        });
      }
    );
    req.setTimeout(10_000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

module.exports = { isOllamaInstalled, installOllama, getOllamaVersion, getLatestOllamaVersion };
