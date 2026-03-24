/**
 * @file service-installer.js
 * @description Installs Python-based background services (ComfyUI, LiteLLM, Whisper, Kokoro)
 * and downloads their required AI models. Each function is idempotent — re-running after a
 * partial install picks up where it left off rather than re-doing completed steps.
 *
 * Installation strategies by service:
 *   - ComfyUI: Download portable Windows package (zip), extract via PowerShell.
 *   - LiteLLM / Whisper / Kokoro: Create isolated Python venvs, pip-install packages.
 *   - FLUX model: Stream download from HuggingFace with .part rename on completion.
 *   - Whisper model: Execute a small Python bootstrap script inside the whisper venv.
 *   - Kokoro model: Execute a small Python bootstrap script inside the kokoro venv.
 *
 * All subprocess calls use execFile / spawn — never shell:true, always windowsHide:true.
 */

'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const logger = require('../utils/logger');

const COMFYUI_ZIP_URL =
  'https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia_cu128.zip';

const FLUX_MODEL_URL =
  'https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors';

const FLUX_MIN_SIZE_BYTES = 9_000_000_000;

// ─── Python resolution ───────────────────────────────────────────────────────

/**
 * Finds a system Python 3.11+ installation, rejecting Windows App Store stubs.
 * Tries `python` then `python3`.
 * @returns {Promise<string>} Absolute path to a valid Python executable
 * @throws {Error} If no suitable Python is found
 */
async function resolveSystemPython() {
  // Ask Python itself for its version and executable path.
  // This is more reliable than PowerShell Get-Command which can resolve
  // to the WindowsApps stub even when a real Python is first on PATH.
  for (const candidate of ['python', 'python3']) {
    try {
      const output = await new Promise((resolve, reject) => {
        execFile(
          candidate,
          ['-c', 'import sys; print(sys.version_info[0], sys.version_info[1]); print(sys.executable)'],
          { windowsHide: true, timeout: 5_000 },
          (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))
        );
      });

      // Output is two lines: "3 14\nC:\...\python.exe"
      const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      const [major, minor] = lines[0].split(' ').map(Number);
      const exePath = lines[1];

      if (!exePath || exePath.includes('WindowsApps')) {
        logger.info(`service-installer: skipping WindowsApps Python stub at "${exePath}"`);
        continue;
      }

      if (major > 3 || (major === 3 && minor >= 11)) {
        logger.info(`service-installer: found Python ${major}.${minor} at "${exePath}"`);
        return exePath;
      }
      logger.info(`service-installer: Python at "${exePath}" is ${major}.${minor} — need 3.11+`);
    } catch (_) {
      // Candidate not available — try next
    }
  }
  throw new Error('Python 3.11+ not found on PATH (tried python and python3)');
}

// ─── ComfyUI installation ────────────────────────────────────────────────────

/**
 * Downloads a file over HTTPS with progress reporting. Follows redirects.
 * @param {string} url
 * @param {string} destPath
 * @param {function(number): void} onProgress - Receives percent 0–100
 * @returns {Promise<void>}
 */
function downloadFileWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const get = (targetUrl) => {
      const req = https.get(targetUrl, { timeout: 60_000 }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlink(destPath, () => {});
          // Re-open and retry with redirect target
          downloadFileWithProgress(response.headers.location, destPath, onProgress)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          reject(new Error(`service-installer: HTTP ${response.statusCode} for ${targetUrl}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let received = 0;
        let lastPercent = -1;

        response.on('data', (chunk) => {
          received += chunk.length;
          if (totalBytes > 0) {
            const pct = Math.floor((received / totalBytes) * 100);
            if (pct >= lastPercent + 2) {
              lastPercent = pct;
              try { onProgress(pct); } catch (_) { /* non-fatal */ }
            }
          }
        });

        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      });

      req.on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`service-installer: download error — ${err.message}`));
      });

      file.on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`service-installer: file write error — ${err.message}`));
      });
    };

    get(url);
  });
}

/**
 * Downloads the ComfyUI portable Windows package and extracts it.
 * Idempotent — if the .bat already exists the zip is not downloaded again.
 *
 * @param {string} installDir - Root install directory chosen by the user
 * @param {function(number): void} onProgress - Receives percent 0–100
 * @returns {Promise<string>} Absolute path to run_nvidia_gpu.bat
 * @throws {Error} On download, extraction, or verification failure
 */
async function installComfyUI(installDir, onProgress) {
  const comfyDir = path.join(installDir, 'comfyui');
  const zipPath = path.join(comfyDir, 'comfyui-portable.zip');
  const batPath = path.join(comfyDir, 'ComfyUI_windows_portable', 'run_nvidia_gpu.bat');

  // Idempotent — skip if already extracted
  if (fs.existsSync(batPath)) {
    logger.info('service-installer: ComfyUI already extracted — skipping download');
    onProgress(100);
    return batPath;
  }

  fs.mkdirSync(comfyDir, { recursive: true });

  logger.info(`service-installer: downloading ComfyUI to "${zipPath}"`);
  onProgress(0);

  // Download occupies 0–70% of the step
  await downloadFileWithProgress(COMFYUI_ZIP_URL, zipPath, (pct) => {
    onProgress(Math.floor(pct * 0.7));
  });

  onProgress(70);
  logger.info('service-installer: extracting ComfyUI zip via PowerShell');

  // Extract via PowerShell Expand-Archive
  await new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -Path "${zipPath}" -DestinationPath "${comfyDir}" -Force`,
      ],
      { windowsHide: true, timeout: 120_000 },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`service-installer: extraction failed — ${err.message}${stderr ? ` | ${stderr}` : ''}`));
        } else {
          resolve();
        }
      }
    );
  });

  onProgress(90);

  // Verify the expected .bat exists
  if (!fs.existsSync(batPath)) {
    throw new Error(
      `service-installer: ComfyUI extraction succeeded but expected file not found: "${batPath}"`
    );
  }

  // Clean up zip
  try {
    fs.unlinkSync(zipPath);
  } catch (_) {
    // Non-fatal — extra disk usage but not a blocker
  }

  onProgress(100);
  logger.info(`service-installer: ComfyUI ready at "${batPath}"`);
  return batPath;
}

// ─── Python venv creation ────────────────────────────────────────────────────

/**
 * Creates an isolated Python venv for a service and installs the required packages.
 * Idempotent — if the venv python.exe already exists, creation is skipped and only
 * pip install is re-run to ensure packages are present.
 *
 * @param {Object} params
 * @param {'litellm'|'whisper'|'kokoro'} params.service - Service name (used for venv directory)
 * @param {string} params.installDir - Root install directory
 * @param {string} params.pythonExe - Absolute path to the system Python executable
 * @param {string[]} params.packages - Package specifiers to pip-install
 * @param {function(number): void} params.onProgress - Receives percent 0–100
 * @returns {Promise<string>} Absolute path to the venv's python.exe
 * @throws {Error} If venv creation or pip install fails
 */
async function createVenv({ service, installDir, pythonExe, packages, onProgress }) {
  const venvPath = path.join(installDir, 'venvs', service);
  const venvPython = path.join(venvPath, 'Scripts', 'python.exe');

  onProgress(0);

  if (!fs.existsSync(venvPython)) {
    logger.info(`service-installer: creating venv for "${service}" at "${venvPath}"`);
    fs.mkdirSync(venvPath, { recursive: true });

    await new Promise((resolve, reject) => {
      execFile(
        pythonExe,
        ['-m', 'venv', venvPath],
        { windowsHide: true, timeout: 60_000 },
        (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`service-installer: venv creation failed for "${service}" — ${err.message}${stderr ? ` | ${stderr}` : ''}`));
          } else {
            resolve();
          }
        }
      );
    });
    onProgress(30);
  } else {
    logger.info(`service-installer: venv for "${service}" already exists — skipping creation`);
    onProgress(30);
  }

  logger.info(`service-installer: installing packages for "${service}": ${packages.join(', ')}`);

  await new Promise((resolve, reject) => {
    execFile(
      venvPython,
      ['-m', 'pip', 'install', '--upgrade', ...packages],
      { windowsHide: true, timeout: 300_000 },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`service-installer: pip install failed for "${service}" — ${err.message}${stderr ? ` | ${stderr}` : ''}`));
        } else {
          resolve();
        }
      }
    );
  });

  onProgress(100);
  logger.info(`service-installer: "${service}" venv ready at "${venvPython}"`);
  return venvPython;
}

// ─── Model downloads ─────────────────────────────────────────────────────────

/**
 * Downloads the FLUX.1-schnell fp8 SafeTensors model for ComfyUI.
 * Uses a .part file during download and renames on completion for atomicity.
 * Skips if the file already exists and is larger than the minimum expected size.
 *
 * @param {string} installDir - Root install directory
 * @param {function(number): void} onProgress - Receives percent 0–100
 * @returns {Promise<void>}
 * @throws {Error} On download failure
 */
async function downloadFluxModel(installDir, onProgress) {
  const destPath = path.join(
    installDir,
    'comfyui',
    'ComfyUI_windows_portable',
    'ComfyUI',
    'models',
    'checkpoints',
    'flux1-schnell-fp8.safetensors'
  );
  const partPath = destPath + '.part';

  // Idempotent — skip if already downloaded with expected minimum size
  if (fs.existsSync(destPath)) {
    try {
      const { size } = fs.statSync(destPath);
      if (size > FLUX_MIN_SIZE_BYTES) {
        logger.info('service-installer: FLUX model already downloaded — skipping');
        onProgress(100);
        return;
      }
    } catch (_) { /* fall through to re-download */ }
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  logger.info(`service-installer: downloading FLUX model to "${destPath}"`);
  onProgress(0);

  await downloadFileWithProgress(FLUX_MODEL_URL, partPath, (pct) => {
    onProgress(pct);
  });

  // Atomic rename: .part → final filename
  fs.renameSync(partPath, destPath);
  onProgress(100);
  logger.info('service-installer: FLUX model download complete');
}

/**
 * Executes a temporary Python script in a service venv to trigger model download.
 * The script is written to os.tmpdir(), executed, then deleted.
 *
 * @param {string} venvPython - Absolute path to the venv python.exe
 * @param {string} scriptContent - Python source to execute
 * @param {string[]} scriptArgs - Arguments passed to the script (sys.argv[1..])
 * @param {number} timeoutMs - Max execution time in ms
 * @returns {Promise<void>}
 * @throws {Error} If the script exits with a non-zero code
 */
async function runPythonDownloadScript(venvPython, scriptContent, scriptArgs, timeoutMs) {
  const scriptPath = path.join(os.tmpdir(), `noxio-dl-${Date.now()}.py`);
  fs.writeFileSync(scriptPath, scriptContent, 'utf8');

  try {
    await new Promise((resolve, reject) => {
      execFile(
        venvPython,
        [scriptPath, ...scriptArgs],
        { windowsHide: true, timeout: timeoutMs },
        (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(
              `service-installer: model download script failed — ${err.message}${stderr ? ` | ${stderr}` : ''}`
            ));
          } else {
            resolve();
          }
        }
      );
    });
  } finally {
    try { fs.unlinkSync(scriptPath); } catch (_) { /* non-fatal */ }
  }
}

/**
 * Downloads the faster-whisper "medium" model into the whisper venv's cache.
 * Executes a bootstrap script inside the venv so the model is fetched via
 * faster-whisper's own download mechanism.
 *
 * @param {string} installDir - Root install directory
 * @param {function(number): void} onProgress - Receives percent 0–100
 * @returns {Promise<void>}
 * @throws {Error} If the venv is missing or the download script fails
 */
async function downloadWhisperModel(installDir, onProgress) {
  const venvPython = path.join(installDir, 'venvs', 'whisper', 'Scripts', 'python.exe');

  if (!fs.existsSync(venvPython)) {
    throw new Error(
      'service-installer: whisper venv not found — run createVenv for whisper first'
    );
  }

  const downloadRoot = path.join(installDir, 'venvs', 'whisper', 'models');
  fs.mkdirSync(downloadRoot, { recursive: true });

  onProgress(0);
  logger.info('service-installer: downloading Whisper medium model');

  const script = `from faster_whisper import WhisperModel
import sys
WhisperModel("medium", device="cpu", compute_type="int8", download_root=sys.argv[1])
print("DONE")
`;

  await runPythonDownloadScript(venvPython, script, [downloadRoot], 300_000);

  onProgress(100);
  logger.info('service-installer: Whisper model ready');
}

/**
 * Downloads the Kokoro TTS ONNX model and voices file directly from GitHub releases.
 * kokoro-onnx takes explicit model_path and voices_path constructor args — it has no
 * built-in download mechanism. The two required files are:
 *   - kokoro-v1.0.onnx   (~335 MB)
 *   - voices-v1.0.bin    (~73 MB)
 *
 * URLs sourced from the package's own config.py error messages.
 *
 * @param {string} installDir - Root install directory
 * @param {function(number): void} onProgress - Receives percent 0–100
 * @returns {Promise<void>}
 * @throws {Error} On download failure
 */
async function downloadKokoroModel(installDir, onProgress) {
  const KOKORO_BASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
  const modelsDir = path.join(installDir, 'venvs', 'kokoro', 'models');
  fs.mkdirSync(modelsDir, { recursive: true });

  const files = [
    { name: 'kokoro-v1.0.onnx', minBytes: 300_000_000 },
    { name: 'voices-v1.0.bin',  minBytes: 50_000_000  },
  ];

  for (let i = 0; i < files.length; i++) {
    const { name, minBytes } = files[i];
    const destPath = path.join(modelsDir, name);
    const partPath = destPath + '.part';
    const rangeStart = Math.round((i / files.length) * 100);
    const rangeEnd   = Math.round(((i + 1) / files.length) * 100);

    if (fs.existsSync(destPath)) {
      try {
        if (fs.statSync(destPath).size > minBytes) {
          logger.info(`service-installer: Kokoro file "${name}" already downloaded — skipping`);
          onProgress(rangeEnd);
          continue;
        }
      } catch (_) { /* fall through */ }
    }

    logger.info(`service-installer: downloading Kokoro file "${name}"`);
    await downloadFileWithProgress(`${KOKORO_BASE}/${name}`, partPath, (pct) => {
      onProgress(Math.round(rangeStart + (pct / 100) * (rangeEnd - rangeStart)));
    });
    fs.renameSync(partPath, destPath);
    logger.info(`service-installer: Kokoro file "${name}" ready`);
  }

  onProgress(100);
  logger.info('service-installer: Kokoro model ready');
}

module.exports = {
  resolveSystemPython,
  installComfyUI,
  createVenv,
  downloadFluxModel,
  downloadWhisperModel,
  downloadKokoroModel,
};
