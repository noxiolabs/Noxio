/**
 * @file ollama.js
 * @description Wrapper for the Ollama API. Handles model management (pull, list,
 * delete) and LLM inference (streaming generate, stop). Ollama runs natively on
 * Windows at http://localhost:11434.
 *
 * Key Ollama environment vars (set at system level before Electron starts):
 *   OLLAMA_HOST=0.0.0.0          → allows LiteLLM and other services to reach it
 *   OLLAMA_KEEP_ALIVE=-1         → keeps model warm between requests
 *   OLLAMA_NUM_GPU=999           → maximises GPU layers loaded
 *   OLLAMA_FLASH_ATTENTION=1     → speed improvement
 *
 * Context note: always use num_ctx 4096 in Modelfiles. Default 32768 on a 14B
 * model requires ~48GB total — will OOM on 16GB VRAM + 32GB RAM.
 *
 * TODO Phase 2: implement all methods.
 */

'use strict';

const logger = require('../utils/logger');

const OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Lists all locally available Ollama models.
 * TODO Phase 2: implement.
 * @returns {Promise<Array<{name: string, size: number}>>}
 */
async function listModels() {
  logger.info('ollama: listModels() — stub');
  return [];
}

/**
 * Pulls a model from the Ollama registry. Streams download progress.
 * TODO Phase 2: implement with SSE streaming and progress events.
 * @param {string} modelName - e.g. 'qwen2.5:14b'
 * @param {Function} onProgress - called with progress percentage
 * @returns {Promise<void>}
 */
async function pullModel(modelName, onProgress) {
  logger.info(`ollama: pullModel(${modelName}) — stub`);
}

/**
 * Sends a chat completion request to Ollama and streams tokens back.
 * TODO Phase 2: implement with fetch + ReadableStream parsing.
 * @param {Object} params
 * @param {string} params.model
 * @param {Array<{role: string, content: string}>} params.messages
 * @param {Function} params.onToken  - called with each streamed token string
 * @param {Function} params.onDone   - called when stream completes
 * @param {AbortSignal} [params.signal] - to cancel the stream
 * @returns {Promise<void>}
 */
async function generateStream({ model, messages, onToken, onDone, signal }) {
  logger.info(`ollama: generateStream(${model}) — stub`);
  onDone();
}

/**
 * Deletes a model from local storage.
 * TODO Phase 2: implement.
 * @param {string} modelName
 * @returns {Promise<void>}
 */
async function deleteModel(modelName) {
  logger.info(`ollama: deleteModel(${modelName}) — stub`);
}

module.exports = { listModels, pullModel, generateStream, deleteModel, OLLAMA_BASE_URL };
