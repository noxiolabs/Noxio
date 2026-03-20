/**
 * @file model-downloader.js
 * @description Downloads AI models via Ollama CLI (for GGUF LLMs) and
 * HuggingFace CLI (for SafeTensors image/video models). Emits 'download-progress'
 * events to the renderer so the wizard progress bar stays accurate.
 *
 * Model format → backend mapping:
 *   GGUF (LLMs)         → Ollama  (ollama pull <model>)
 *   SafeTensors (FLUX)  → HuggingFace CLI (hf download)
 *   CTranslate2 (Whisper) → HuggingFace CLI
 *   ONNX/PyTorch (Kokoro) → HuggingFace CLI
 *
 * TODO Phase 3: implement download logic with progress streaming.
 */

'use strict';

const logger = require('../utils/logger');

/**
 * Downloads a model. Routes to Ollama or HuggingFace based on model type.
 * Emits 'download-progress' events via mainWindow.
 * TODO Phase 3: implement.
 *
 * @param {Object} params
 * @param {string} params.model     - Model identifier
 * @param {'ollama'|'huggingface'} params.source
 * @param {import('electron').BrowserWindow} params.mainWindow
 * @returns {Promise<void>}
 */
async function downloadModel({ model, source, mainWindow }) {
  logger.info(`model-downloader: downloadModel(${model}, source=${source}) — stub`);
  mainWindow.webContents.send('download-progress', { model, percent: 100 });
  // TODO Phase 3: implement real download with progress
}

module.exports = { downloadModel };
