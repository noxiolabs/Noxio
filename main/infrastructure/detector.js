/**
 * @file detector.js
 * @description Detects GPU model, VRAM (total + free), system RAM, OS version,
 * and NVIDIA driver version on the host machine. Used by the setup wizard and
 * at startup to determine which services and models can run.
 *
 * Windows: uses nvidia-smi for GPU/VRAM, wmic for RAM.
 * Returns a structured HardwareInfo object consumed by the wizard and Redux store.
 *
 * TODO Phase 2: implement full detection logic.
 */

'use strict';

const logger = require('../utils/logger');

/**
 * @typedef {Object} HardwareInfo
 * @property {string} gpu             - GPU model name (e.g. "NVIDIA GeForce RTX 5080")
 * @property {number} vramTotalGB     - Total VRAM in GB
 * @property {number} vramFreeGB      - Currently free VRAM in GB
 * @property {number} ramGB           - Total system RAM in GB
 * @property {string} os              - OS description (e.g. "Windows 11 23H2")
 * @property {string} driver          - NVIDIA driver version (e.g. "572.70")
 * @property {string} cudaVersion     - CUDA version reported by nvidia-smi
 */

/**
 * Detects all hardware relevant to running Noxio.
 * @returns {Promise<HardwareInfo>}
 */
async function detectHardware() {
  logger.info('detector: detectHardware() called (stub — Phase 2)');
  // TODO Phase 2: spawn nvidia-smi, parse output, detect RAM via wmic
  return {
    gpu: 'Detection pending',
    vramTotalGB: 0,
    vramFreeGB: 0,
    ramGB: 0,
    os: process.platform,
    driver: 'Unknown',
    cudaVersion: 'Unknown',
  };
}

/**
 * Returns the usable VRAM tier for model recommendation purposes.
 * Subtracts display overhead (~1GB on Windows with dedicated display GPU).
 * @param {HardwareInfo} hardware
 * @returns {'18+' | '10-18' | '6-10' | '3-6' | '<3'}
 */
function getVramTier(hardware) {
  const usable = Math.max(0, hardware.vramTotalGB - 1);
  if (usable >= 18) return '18+';
  if (usable >= 10) return '10-18';
  if (usable >= 6) return '6-10';
  if (usable >= 3) return '3-6';
  return '<3';
}

module.exports = { detectHardware, getVramTier };
