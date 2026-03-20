/**
 * @file hardware-scan.js
 * @description Wraps detector.js to produce the structured hardware object used
 * by the setup wizard (Screen 2 — Hardware). Adds derived fields like VRAM tier
 * and capability flags so the wizard UI doesn't need to do any logic itself.
 *
 * TODO Phase 3: implement — call detector.js and enrich the result.
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
 * TODO Phase 3: implement — currently returns stub data.
 * @returns {Promise<WizardHardware>}
 */
async function scanHardware() {
  logger.info('hardware-scan: scanHardware() — stub');
  const raw = await detectHardware();
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
