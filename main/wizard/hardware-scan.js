/**
 * @file hardware-scan.js
 * @description Wraps detector.js to produce the structured hardware object used
 * by the setup wizard (Screen 2 — Hardware). Adds derived fields like VRAM tier
 * and capability flags so the wizard UI doesn't need to do any logic itself.
 */

'use strict';

const { detectHardware, getVramTier } = require('../infrastructure/detector');
const logger = require('../utils/logger');

/**
 * @typedef {Object} WizardHardware
 * @property {import('../infrastructure/detector').HardwareInfo} raw  - Raw detector output
 * @property {string} vramTier   - '18+' | '10-18' | '6-10' | '3-6' | '<3'
 * @property {boolean} canRunChat    - Has enough VRAM for a useful chat model
 * @property {boolean} canRunImage   - Has enough VRAM for image generation
 * @property {boolean} canRunVoice   - Voice always works (CPU TTS + small Whisper)
 * @property {boolean} needsCloud    - True if VRAM < 3GB
 */

/**
 * Runs a hardware scan and returns enriched results for the wizard.
 * Falls back to zeroed defaults if detection fails so the wizard always
 * gets a valid object and can display a "detection failed" state instead
 * of crashing.
 * @returns {Promise<WizardHardware>}
 */
async function scanHardware() {
  logger.info('hardware-scan: scanHardware() — starting');

  let raw;
  try {
    raw = await detectHardware();
  } catch (err) {
    logger.error(`hardware-scan: detectHardware() failed — ${err.message}`);
    // Return a safe fallback matching the detectHardware() output shape so
    // downstream consumers (getVramTier, wizard screens) never crash.
    return {
      raw: {
        gpu: { name: 'Unknown', vendor: 'unknown', vramTotalMB: 0, vramUsedMB: 0, vramAvailableMB: 0, driverVersion: null, nvidiaSmiAvailable: false },
        ram: { totalMB: 0, availableMB: 0 },
        cpu: { name: 'Unknown', coreCount: 0 },
        os:  { platform: 'unknown', version: 'unknown', arch: 'unknown' },
        detectedAt: new Date().toISOString(),
      },
      vramTier: '<3',
      canRunChat: false,
      canRunImage: false,
      canRunVoice: true,
      needsCloud: true,
    };
  }

  const tier = getVramTier(raw);
  return {
    raw,
    vramTier: tier,
    canRunChat: tier !== '<3',
    canRunImage: ['18+', '10-18', '6-10'].includes(tier),
    canRunVoice: true,
    needsCloud: tier === '<3',
  };
}

module.exports = { scanHardware };
