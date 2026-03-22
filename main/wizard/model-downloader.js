/**
 * @file model-downloader.js
 * @description Downloads AI models via Ollama (for GGUF LLMs). Calls onProgress on each
 * update so callers can forward progress to the renderer as needed.
 *
 * Model format → backend mapping:
 *   GGUF (LLMs)             → Ollama  (ollama pull <model>)
 *   SafeTensors (FLUX/SDXL) → HuggingFace CLI — Phase 5
 *   CTranslate2 (Whisper)   → HuggingFace CLI — Phase 6
 *   ONNX/PyTorch (Kokoro)   → HuggingFace CLI — Phase 6
 */

'use strict';

const logger = require('../utils/logger');
const ollama = require('../services/ollama');

/**
 * Downloads an Ollama model (GGUF), streaming progress via onProgress.
 * @param {string} model - Model tag e.g. 'qwen2.5:14b'
 * @param {function({model: string, percent: number, status: string}): void} [onProgress]
 * @returns {Promise<void>}
 */
async function downloadOllamaModel(model, onProgress) {
  logger.info(`model-downloader: pulling "${model}" via Ollama`);

  await ollama.pullModel(model, ({ status, percent }) => {
    if (onProgress) onProgress({ model, percent, status });
  });

  if (onProgress) onProgress({ model, percent: 100, status: 'success' });
}

/**
 * Downloads a model. Routes to Ollama for GGUF LLMs.
 * HuggingFace (image/voice models) is deferred to Phase 5/6.
 *
 * @param {Object} params
 * @param {string} params.model - Model identifier
 * @param {'ollama'|'huggingface'} params.source - Download backend
 * @param {function({model: string, percent: number, status: string}): void} [params.onProgress]
 * @returns {Promise<void>}
 */
async function downloadModel({ model, source, onProgress }) {
  if (source === 'ollama') {
    return downloadOllamaModel(model, onProgress);
  }

  // HuggingFace (image/voice models) — Phase 5/6
  logger.warn(`model-downloader: HuggingFace downloads not implemented in v0.1 — skipping "${model}"`);
  if (onProgress) onProgress({ model, percent: 100, status: 'skipped' });
}

module.exports = { downloadModel };
