/**
 * @file whisper.js
 * @description Manages the faster-whisper process and wraps its transcription API.
 * faster-whisper runs natively on Windows at http://localhost:10300.
 * Uses CTranslate2 format — NOT the same as OpenAI Whisper ONNX files.
 *
 * VRAM cost: ~1.5GB for large-v3. Compatible with simultaneous LLM usage on 16GB.
 *
 * TODO Phase 6: implement process management and transcription API.
 */

'use strict';

const logger = require('../utils/logger');

const WHISPER_BASE_URL = 'http://localhost:10300';

/**
 * Starts the faster-whisper process.
 * TODO Phase 6: implement via process-manager.js.
 * @returns {Promise<void>}
 */
async function start() {
  logger.info('whisper: start() — stub');
}

/**
 * Stops the faster-whisper process.
 * TODO Phase 6: implement via process-manager.js.
 * @returns {Promise<void>}
 */
async function stop() {
  logger.info('whisper: stop() — stub');
}

/**
 * Transcribes an audio buffer to text.
 * TODO Phase 6: implement — record audio via Electron, POST to whisper API.
 * @param {Buffer} audioBuffer - Raw PCM or WAV audio data
 * @returns {Promise<string>} Transcribed text
 */
async function transcribe(audioBuffer) {
  logger.info('whisper: transcribe() — stub');
  return '';
}

module.exports = { start, stop, transcribe, WHISPER_BASE_URL };
