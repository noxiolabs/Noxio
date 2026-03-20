/**
 * @file installer.js
 * @description Silent installation of Noxio's background service dependencies:
 * Ollama, Python (for LiteLLM/Whisper/Kokoro), and ComfyUI. Runs without
 * showing any terminal to the user. Emits 'install-progress' events to the
 * renderer during installation so the wizard progress bar stays accurate.
 *
 * Installation strategy:
 *   Ollama  → download OllamaSetup.exe, run with /S (silent) flag
 *   Python  → check for existing Python 3.11+, download if missing
 *   LiteLLM → pip install litellm
 *   Whisper → pip install faster-whisper
 *   Kokoro  → pip install kokoro-fastapi
 *   ComfyUI → git clone + pip install requirements
 *
 * TODO Phase 3: implement full installation logic.
 */

'use strict';

const logger = require('../utils/logger');

/**
 * Runs the full installation sequence based on the wizard config.
 * Emits 'install-progress' events throughout.
 * TODO Phase 3: implement each step with real download + silent exec logic.
 *
 * @param {Object} config - Selected capabilities and models from the wizard
 * @param {import('electron').BrowserWindow} mainWindow
 * @returns {Promise<void>}
 */
async function runInstallation(config, mainWindow) {
  logger.info('installer: runInstallation() — stub (Phase 3)');
  mainWindow.webContents.send('install-progress', {
    step: 'stub',
    percent: 0,
    message: 'Installation not yet implemented — Phase 3',
  });
  // TODO Phase 3: implement step-by-step installation
}

module.exports = { runInstallation };
