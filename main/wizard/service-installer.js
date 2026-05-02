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
const sevenBin = require('7zip-bin');
const { extractFull } = require('node-7z');
const logger = require('../utils/logger');

// cu128 (CUDA 12.8) doesn't ship yet — cu126 is the newest variant and works
// on Blackwell (RTX 5080) via CUDA's backwards-compatibility guarantees.
const COMFYUI_ZIP_URL =
  'https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia_cu126.7z';

/**
 * Download catalog for ComfyUI image models.
 * Keys match the model IDs used in model-recommender.js and comfyui.js MODEL_FILENAMES.
 *   filename   — local safetensors filename
 *   subfolder  — ComfyUI models subfolder (default: 'checkpoints')
 *   url        — HuggingFace download URL
 *   minBytes   — minimum expected file size for idempotency check
 *   sizeGB     — approximate size shown in progress messages
 *   gated      — requires HuggingFace auth token
 *   companions — additional files required alongside the main model (e.g. VAE, text encoder)
 */

// Per-variant companion files for FLUX.2 Klein (VAE + text encoder).
// 4B and 9B use different text encoders — mixing them causes a shape mismatch crash.
const KLEIN_4B_COMPANIONS = [
  {
    filename: 'flux2-vae.safetensors',
    subfolder: 'vae',
    url:       'https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/vae/flux2-vae.safetensors',
    minBytes:  100_000_000,
    sizeGB:    0.2,
  },
  {
    filename: 'qwen_3_4b_fp4_flux2.safetensors',
    subfolder: 'text_encoders',
    url:       'https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/text_encoders/qwen_3_4b_fp4_flux2.safetensors',
    minBytes:  2_000_000_000,
    sizeGB:    2.3,
  },
];

// 9B uses Qwen3-8B text encoder (12288-dim) — the 4B encoder (7680-dim) causes a crash.
const KLEIN_9B_COMPANIONS = [
  {
    filename: 'flux2-vae.safetensors',
    subfolder: 'vae',
    url:       'https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/vae/flux2-vae.safetensors',
    minBytes:  100_000_000,
    sizeGB:    0.2,
  },
  {
    filename: 'qwen_3_8b_fp8mixed.safetensors',
    subfolder: 'text_encoders',
    url:       'https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors',
    minBytes:  5_000_000_000,
    sizeGB:    8,
  },
];

const IMAGE_CHECKPOINT_CATALOG = {
  'FLUX.1-schnell-fp8': {
    filename: 'flux1-schnell-fp8.safetensors',
    url:      'https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors',
    minBytes: 9_000_000_000,
    sizeGB:   9,
  },
  'FLUX.1-dev-fp8': {
    filename: 'flux1-dev-fp8.safetensors',
    url:      'https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors',
    minBytes: 17_000_000_000,
    sizeGB:   17,
  },
  'FLUX.2-klein-9b-fp8': {
    filename:   'flux-2-klein-9b-fp8.safetensors',
    subfolder:  'diffusion_models',
    url:        'https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors',
    minBytes:   8_000_000_000,
    sizeGB:     9,
    gated:      true,
    companions: KLEIN_9B_COMPANIONS,
  },
  'FLUX.2-klein-4b-fp8': {
    filename:   'flux-2-klein-4b-fp8.safetensors',
    subfolder:  'diffusion_models',
    url:        'https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/resolve/main/flux-2-klein-4b-fp8.safetensors',
    minBytes:   3_500_000_000,
    sizeGB:     4,
    companions: KLEIN_4B_COMPANIONS,
  },
  'SDXL-lightning': {
    filename: 'sdxl-lightning-4step.safetensors',
    url:      'https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step_unet.safetensors',
    minBytes: 6_000_000_000,
    sizeGB:   6.5,
  },
  'SDXL-4bit': {
    filename: 'sdxl-4bit.safetensors',
    url:      'https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl_vae.safetensors',
    minBytes: 3_000_000_000,
    sizeGB:   3.5,
  },
};

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
  for (const candidate of ['python', 'python3', 'py']) {
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
  throw new Error('Python 3.11+ not found on PATH (tried python, python3, and py)');
}

// ─── ComfyUI installation ────────────────────────────────────────────────────

/**
 * Downloads a file over HTTPS with progress reporting. Follows redirects.
 * @param {string} url
 * @param {string} destPath
 * @param {function(number): void} onProgress - Receives percent 0–100
 * @returns {Promise<void>}
 */
function downloadFileWithProgress(url, destPath, onProgress, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const get = (targetUrl) => {
      const options = { timeout: 60_000, headers: extraHeaders };
      const req = https.get(targetUrl, options, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlink(destPath, () => {});
          // Re-open and retry with redirect target
          downloadFileWithProgress(response.headers.location, destPath, onProgress, extraHeaders)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
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
  const archivePath = path.join(comfyDir, 'comfyui-portable.7z');
  const batPath = path.join(comfyDir, 'ComfyUI_windows_portable', 'run_nvidia_gpu.bat');

  // Idempotent — skip if already extracted
  if (fs.existsSync(batPath)) {
    logger.info('service-installer: ComfyUI already extracted — skipping download');
    onProgress(100);
    return batPath;
  }

  fs.mkdirSync(comfyDir, { recursive: true });

  logger.info(`service-installer: downloading ComfyUI to "${archivePath}"`);
  onProgress(0);

  // Download occupies 0–70% of the step
  await downloadFileWithProgress(COMFYUI_ZIP_URL, archivePath, (pct) => {
    onProgress(Math.floor(pct * 0.7));
  });

  onProgress(70);
  logger.info('service-installer: extracting ComfyUI .7z archive via 7zip-bin');

  // Extract via bundled 7z binary — Expand-Archive doesn't support .7z
  await new Promise((resolve, reject) => {
    const stream = extractFull(archivePath, comfyDir, {
      $bin: sevenBin.path7za,
      $progress: false,
    });
    stream.on('end', resolve);
    stream.on('error', (err) => {
      reject(new Error(`service-installer: extraction failed — ${err.message}`));
    });
  });

  onProgress(90);

  // Verify the expected .bat exists
  if (!fs.existsSync(batPath)) {
    throw new Error(
      `service-installer: ComfyUI extraction succeeded but expected file not found: "${batPath}"`
    );
  }

  // Clean up archive
  try {
    fs.unlinkSync(archivePath);
  } catch (_) {
    // Non-fatal — extra disk usage but not a blocker
  }

  onProgress(100);
  logger.info(`service-installer: ComfyUI ready at "${batPath}"`);
  return batPath;
}

// ─── Blackwell PyTorch upgrade ───────────────────────────────────────────────

/**
 * Upgrades PyTorch inside ComfyUI's python_embeded to a CUDA 12.8 (cu128) build.
 *
 * The ComfyUI portable package ships PyTorch compiled for cu126. RTX 5080 and
 * other Blackwell (sm_100) GPUs require sm_100 kernels which are only present in
 * the cu128 build — cu126 throws cudaErrorNoKernelImageForDevice at runtime.
 *
 * Idempotent: a marker file is written on success so re-runs are instant.
 *
 * @param {string} installDir - Root install directory
 * @param {function(number): void} onProgress - Receives percent 0–100
 * @returns {Promise<void>}
 * @throws {Error} If pip install fails
 */
async function upgradeTorchForBlackwell(installDir, onProgress) {
  const comfyPortableDir = path.join(installDir, 'comfyui', 'ComfyUI_windows_portable');
  const embeddedPython = path.join(comfyPortableDir, 'python_embeded', 'python.exe');
  const markerPath = path.join(comfyPortableDir, '.torch_cu128_upgraded');

  // Idempotent — skip if already upgraded
  if (fs.existsSync(markerPath)) {
    logger.info('service-installer: PyTorch cu128 already upgraded — skipping');
    onProgress(100);
    return;
  }

  if (!fs.existsSync(embeddedPython)) {
    throw new Error(
      `service-installer: ComfyUI python_embeded not found at "${embeddedPython}" — run installComfyUI first`
    );
  }

  logger.info('service-installer: upgrading PyTorch to cu128 for Blackwell (sm_100) support');
  onProgress(0);

  await new Promise((resolve, reject) => {
    execFile(
      embeddedPython,
      [
        '-m', 'pip', 'install',
        'torch', 'torchvision', 'torchaudio',
        '--index-url', 'https://download.pytorch.org/whl/cu128',
        '--upgrade',
      ],
      { windowsHide: true, timeout: 900_000 }, // 15 min — PyTorch is ~2.5 GB
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(
            `service-installer: PyTorch cu128 upgrade failed — ${err.message}${stderr ? ` | ${stderr.slice(0, 200)}` : ''}`
          ));
        } else {
          resolve();
        }
      }
    );
  });

  // Write marker so subsequent runs skip this step
  fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
  onProgress(100);
  logger.info('service-installer: PyTorch cu128 upgrade complete');
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
 * Downloads a ComfyUI image checkpoint by model ID.
 * Uses a .part file during download and renames on completion for atomicity.
 * Skips if the file already exists and exceeds the catalog minimum size.
 *
 * @param {string} installDir - Root install directory
 * @param {string} modelId - Key from IMAGE_CHECKPOINT_CATALOG (e.g. 'FLUX.1-schnell-fp8')
 * @param {function(number): void} onProgress - Receives percent 0–100
 * @param {string|null} [hfToken] - HuggingFace access token for gated models
 * @returns {Promise<{filename: string, sizeGB: number}>} Resolved catalog entry metadata
 * @throws {Error} If modelId is unknown or download fails
 */
async function downloadImageCheckpoint(installDir, modelId, onProgress, hfToken = null) {
  const entry = IMAGE_CHECKPOINT_CATALOG[modelId];
  if (!entry) {
    throw new Error(`service-installer: unknown image model "${modelId}" — not in catalog`);
  }

  const modelsBase = path.join(
    installDir, 'comfyui', 'ComfyUI_windows_portable', 'ComfyUI', 'models'
  );
  const subfolder = entry.subfolder ?? 'checkpoints';
  const destPath = path.join(modelsBase, subfolder, entry.filename);
  const partPath = destPath + '.part';

  // Main model download occupies 0–90% of progress; companions fill 90–100%.
  const hasCompanions = Array.isArray(entry.companions) && entry.companions.length > 0;
  const mainCeiling = hasCompanions ? 90 : 100;

  let mainAlreadyPresent = false;
  if (fs.existsSync(destPath)) {
    try {
      const { size } = fs.statSync(destPath);
      if (size > entry.minBytes) {
        logger.info(`service-installer: "${entry.filename}" already downloaded — skipping`);
        mainAlreadyPresent = true;
      }
    } catch (_) { /* fall through to re-download */ }
  }

  if (!mainAlreadyPresent) {
    if (entry.gated && !hfToken) {
      throw new Error(
        `service-installer: "${modelId}" is a gated HuggingFace model — ` +
        'go to Settings → Models, enter your HuggingFace access token, and click Save token'
      );
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    try { fs.unlinkSync(partPath); } catch (_) { /* no stale .part file — fine */ }
    logger.info(
      `service-installer: downloading "${modelId}" (≈${entry.sizeGB} GB) to "${destPath}" ` +
      `[token: ${hfToken ? 'present' : 'none'}]`
    );
    onProgress(0);

    const headers = hfToken ? { Authorization: `Bearer ${hfToken}` } : {};
    await downloadFileWithProgress(entry.url, partPath, (pct) => {
      onProgress(Math.floor(pct * mainCeiling / 100));
    }, headers);

    fs.renameSync(partPath, destPath);
    logger.info(`service-installer: "${modelId}" download complete`);
  }

  // Download companion files (VAE, text encoder) required alongside the main model.
  if (hasCompanions) {
    for (let i = 0; i < entry.companions.length; i++) {
      const companion = entry.companions[i];
      const companionDest = path.join(modelsBase, companion.subfolder, companion.filename);
      const companionPart = companionDest + '.part';

      let skip = false;
      if (fs.existsSync(companionDest)) {
        try {
          const { size } = fs.statSync(companionDest);
          if (size > companion.minBytes) {
            logger.info(`service-installer: companion "${companion.filename}" already present — skipping`);
            skip = true;
          }
        } catch (_) { /* fall through */ }
      }

      if (!skip) {
        fs.mkdirSync(path.dirname(companionDest), { recursive: true });
        try { fs.unlinkSync(companionPart); } catch (_) { /* no stale .part file — fine */ }
        logger.info(
          `service-installer: downloading companion "${companion.filename}" (≈${companion.sizeGB} GB)`
        );
        const companionStart = mainCeiling + (i / entry.companions.length) * (100 - mainCeiling);
        const companionEnd   = mainCeiling + ((i + 1) / entry.companions.length) * (100 - mainCeiling);
        await downloadFileWithProgress(companion.url, companionPart, (pct) => {
          onProgress(Math.floor(companionStart + (pct / 100) * (companionEnd - companionStart)));
        }, {});
        fs.renameSync(companionPart, companionDest);
        logger.info(`service-installer: companion "${companion.filename}" download complete`);
      }

      // Mark companion range complete
      onProgress(Math.floor(mainCeiling + ((i + 1) / entry.companions.length) * (100 - mainCeiling)));
    }
  }

  onProgress(100);
  return { filename: entry.filename, sizeGB: entry.sizeGB };
}

/** @deprecated Use downloadImageCheckpoint('FLUX.1-schnell-fp8', ...) instead */
async function downloadFluxModel(installDir, onProgress) {
  return downloadImageCheckpoint(installDir, 'FLUX.1-schnell-fp8', onProgress);
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
  upgradeTorchForBlackwell,
  createVenv,
  downloadImageCheckpoint,
  downloadFluxModel,
  downloadWhisperModel,
  downloadKokoroModel,
  IMAGE_CHECKPOINT_CATALOG,
};
