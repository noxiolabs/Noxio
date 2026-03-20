/**
 * @file comfyui.js
 * @description Manages the ComfyUI process and wraps its image generation API.
 * ComfyUI runs natively on Windows at http://localhost:8188. The Noxio UI never
 * exposes ComfyUI's node graph — all generation is driven by pre-built workflow
 * JSON templates that map to Noxio's style/quality presets.
 *
 * Supported models (per VRAM tier):
 *   18GB+     → FLUX.1-dev-fp8
 *   10–18GB   → FLUX.1-schnell-fp8
 *   6–10GB    → SDXL-lightning
 *   3–6GB     → SDXL 4-bit
 *
 * TODO Phase 5: implement process management and image generation API calls.
 */

'use strict';

const logger = require('../utils/logger');

const COMFYUI_BASE_URL = 'http://localhost:8188';

/**
 * Starts the ComfyUI process.
 * TODO Phase 5: implement via process-manager.js.
 * @returns {Promise<void>}
 */
async function start() {
  logger.info('comfyui: start() — stub');
}

/**
 * Stops the ComfyUI process.
 * TODO Phase 5: implement via process-manager.js.
 * @returns {Promise<void>}
 */
async function stop() {
  logger.info('comfyui: stop() — stub');
}

/**
 * Generates an image using a pre-built ComfyUI workflow.
 * TODO Phase 5: implement workflow selection, API call, progress polling.
 *
 * @param {Object} params
 * @param {string} params.prompt
 * @param {'photorealistic'|'artistic'|'abstract'|'anime'} params.style
 * @param {'draft'|'balanced'|'high'} params.quality
 * @param {Function} params.onProgress - called with percent 0–100
 * @returns {Promise<string>} Path to the generated image file
 */
async function generateImage({ prompt, style, quality, onProgress }) {
  logger.info(`comfyui: generateImage(style=${style}, quality=${quality}) — stub`);
  onProgress(100);
  return '';
}

module.exports = { start, stop, generateImage, COMFYUI_BASE_URL };
