/**
 * @file detector.js
 * @description Detects GPU model, VRAM (total, used, available), system RAM, CPU info,
 * and OS version on Windows. Used by the setup wizard and at startup to determine which
 * services and models can run. Returns a structured HardwareInfo object consumed by the
 * wizard, Redux store (infrastructure slice), and the model recommendation algorithm.
 *
 * Detection strategy:
 *   GPU/VRAM   → nvidia-smi (NVSMI path, then PATH fallback)
 *   RAM        → PowerShell Get-CimInstance Win32_OperatingSystem (WMIC removed on modern Win11)
 *   CPU        → PowerShell Get-CimInstance Win32_Processor (WMIC removed on modern Win11)
 *   OS         → Node built-in os module
 *
 * Never throws — every detection step degrades gracefully on failure.
 */

'use strict';

const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const logger = require('../utils/logger');

/** Timeout for each subprocess in milliseconds */
const SUBPROCESS_TIMEOUT_MS = 10000;

/**
 * Wraps execFile in a Promise with a fixed timeout.
 * @param {string} file - Executable path or name
 * @param {string[]} args - Arguments to pass
 * @param {Object} [options] - execFile options
 * @returns {Promise<string>} stdout output on success
 */
function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { windowsHide: true, timeout: SUBPROCESS_TIMEOUT_MS, ...options },
      (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          resolve(stdout);
        }
      }
    );
    // Belt-and-suspenders: if timeout option is not honoured by the OS
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* ignore */ }
      reject(new Error(`execFile timed out: ${file}`));
    }, SUBPROCESS_TIMEOUT_MS + 500);
    child.on('close', () => clearTimeout(timer));
  });
}

/**
 * Attempts to run nvidia-smi from known installation paths then falls back to PATH.
 * @param {string[]} args - Arguments to pass to nvidia-smi
 * @returns {Promise<string>} stdout output
 */
async function runNvidiaSmi(args) {
  const candidates = [
    path.join('C:', 'Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
    'nvidia-smi',
  ];

  for (const candidate of candidates) {
    try {
      const output = await execFileAsync(candidate, args);
      return output;
    } catch (err) {
      logger.info(`detector: nvidia-smi attempt failed for "${candidate}": ${err.message}`);
    }
  }
  throw new Error('nvidia-smi not found or failed on all candidate paths');
}

/**
 * Detects the primary GPU using nvidia-smi.
 * Picks the GPU with the highest total VRAM when multiple GPUs are present.
 * @returns {Promise<{name: string, vendor: string, vramTotalMB: number, vramUsedMB: number, vramAvailableMB: number, driverVersion: string|null, nvidiaSmiAvailable: boolean}>}
 */
async function detectGpu() {
  const fallback = {
    name: 'Unknown GPU',
    vendor: 'unknown',
    vramTotalMB: 0,
    vramUsedMB: 0,
    vramAvailableMB: 0,
    driverVersion: null,
    nvidiaSmiAvailable: false,
  };

  try {
    const raw = await runNvidiaSmi([
      '--query-gpu=name,memory.total,memory.used,driver_version',
      '--format=csv,noheader,nounits',
    ]);

    const rows = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split(',').map((p) => p.trim());
        return {
          name: parts[0] || 'Unknown',
          vramTotalMB: parseInt(parts[1], 10) || 0,
          vramUsedMB: parseInt(parts[2], 10) || 0,
          driverVersion: parts[3] || null,
        };
      });

    if (rows.length === 0) {
      logger.warn('detector: nvidia-smi returned no GPU rows');
      return fallback;
    }

    // Pick GPU with highest total VRAM
    const primary = rows.reduce((best, row) =>
      row.vramTotalMB > best.vramTotalMB ? row : best
    );

    return {
      name: primary.name,
      vendor: 'nvidia',
      vramTotalMB: primary.vramTotalMB,
      vramUsedMB: primary.vramUsedMB,
      vramAvailableMB: Math.max(0, primary.vramTotalMB - primary.vramUsedMB),
      driverVersion: primary.driverVersion,
      nvidiaSmiAvailable: true,
    };
  } catch (err) {
    logger.warn(`detector: GPU detection failed — ${err.message}`);
    return fallback;
  }
}

/**
 * Runs a PowerShell command and returns trimmed stdout.
 * Used as fallback for WMIC which is removed in newer Windows 11 builds.
 * @param {string} script - PowerShell script to run
 * @returns {Promise<string>}
 */
function runPowerShell(script) {
  return execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
}

/**
 * Detects total and available system RAM.
 * Tries PowerShell Get-CimInstance (works on all modern Windows 11 builds).
 * WMIC is deprecated/removed on newer Windows 11 — not used.
 * @returns {Promise<{totalMB: number, availableMB: number}>}
 */
async function detectRam() {
  const fallback = { totalMB: 0, availableMB: 0 };

  try {
    const raw = await runPowerShell(
      '(Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json -Compress)'
    );
    const data = JSON.parse(raw.trim());
    const totalKB = data.TotalVisibleMemorySize || 0;
    const freeKB = data.FreePhysicalMemory || 0;
    return {
      totalMB: Math.round(totalKB / 1024),
      availableMB: Math.round(freeKB / 1024),
    };
  } catch (err) {
    logger.warn(`detector: RAM detection failed — ${err.message}`);
    return fallback;
  }
}

/**
 * Detects the CPU name and logical core count.
 * Tries PowerShell Get-CimInstance (works on all modern Windows 11 builds).
 * WMIC is deprecated/removed on newer Windows 11 — not used.
 * @returns {Promise<{name: string, coreCount: number}>}
 */
async function detectCpu() {
  const fallback = { name: 'Unknown CPU', coreCount: os.cpus().length };

  try {
    const raw = await runPowerShell(
      '(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfLogicalProcessors | ConvertTo-Json -Compress)'
    );
    const data = JSON.parse(raw.trim());
    return {
      name: data.Name || 'Unknown CPU',
      coreCount: data.NumberOfLogicalProcessors || os.cpus().length,
    };
  } catch (err) {
    logger.warn(`detector: CPU detection failed — ${err.message}`);
    return fallback;
  }
}

/**
 * Detects all hardware relevant to running Noxio. Never throws — each
 * sub-detection degrades gracefully and returns safe defaults on failure.
 *
 * @returns {Promise<{
 *   gpu: { name: string, vendor: string, vramTotalMB: number, vramUsedMB: number, vramAvailableMB: number, driverVersion: string|null, nvidiaSmiAvailable: boolean },
 *   ram: { totalMB: number, availableMB: number },
 *   cpu: { name: string, coreCount: number },
 *   os: { platform: string, version: string, arch: string },
 *   detectedAt: string
 * }>}
 */
async function detectHardware() {
  logger.info('detector: starting hardware detection');

  const [gpu, ram, cpu] = await Promise.all([
    detectGpu(),
    detectRam(),
    detectCpu(),
  ]);

  const hardware = {
    gpu,
    ram,
    cpu,
    os: {
      platform: os.platform(),
      version: os.release(),
      arch: os.arch(),
    },
    detectedAt: new Date().toISOString(),
  };

  logger.info(
    `detector: detection complete — GPU: ${gpu.name}, VRAM: ${gpu.vramTotalMB}MB, RAM: ${ram.totalMB}MB`
  );

  return hardware;
}

/**
 * Returns the usable VRAM tier for model recommendation purposes.
 * Subtracts display overhead (~989MiB on Windows with dedicated display GPU).
 * @param {{ gpu: { vramTotalMB: number } }} hardware
 * @returns {'18+' | '10-18' | '6-10' | '3-6' | '<3'}
 */
function getVramTier(hardware) {
  const usableGB = Math.max(0, hardware.gpu.vramTotalMB / 1024 - 1);
  if (usableGB >= 18) return '18+';
  if (usableGB >= 10) return '10-18';
  if (usableGB >= 6) return '6-10';
  if (usableGB >= 3) return '3-6';
  return '<3';
}

module.exports = { detectHardware, getVramTier };
