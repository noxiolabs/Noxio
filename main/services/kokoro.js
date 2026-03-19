/**
 * @file kokoro.js
 * @description Manages the Kokoro FastAPI process and wraps its text-to-speech API.
 * Kokoro runs natively on Windows at http://localhost:8880.
 * Runs on CPU only — zero VRAM cost, no conflict with LLM or image gen workloads.
 *
 * TODO Phase 6: implement process management and TTS API.
 */

'use strict';

const logger = require('../utils/logger');

const KOKORO_BASE_URL = 'http://localhost:8880';

/**
 * Starts the Kokoro FastAPI process.
 * TODO Phase 6: implement via process-manager.js.
 * @returns {Promise<void>}
 */
async function start() {
  logger.info('kokoro: start() — stub');
}

/**
 * Stops the Kokoro process.
 * TODO Phase 6: implement via process-manager.js.
 * @returns {Promise<void>}
 */
async function stop() {
  logger.info('kokoro: stop() — stub');
}

/**
 * Synthesises speech from text and returns an audio buffer.
 * TODO Phase 6: implement — POST to Kokoro API, stream audio back.
 * @param {string} text
 * @param {string} [voice='af_heart'] - Kokoro voice ID
 * @returns {Promise<Buffer>} Audio data (WAV or MP3)
 */
async function synthesise(text, voice = 'af_heart') {
  logger.info(`kokoro: synthesise(voice=${voice}) — stub`);
  return Buffer.alloc(0);
}

module.exports = { start, stop, synthesise, KOKORO_BASE_URL };
