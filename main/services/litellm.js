/**
 * @file litellm.js
 * @description Phase 2 stub for LiteLLM process management. Writes a minimal local-only
 * LiteLLM config.yaml and starts the process via process-manager.js. Full routing logic
 * (privacy flag, budget enforcement, cloud fallback) is deferred to Phase 4.
 *
 * Phase 2 config routes all requests to Ollama's local qwen2.5:14b model only.
 * The config file is written to Electron's userData directory so it persists across
 * sessions and is OS-user-scoped.
 *
 * LiteLLM sits at http://127.0.0.1:4000 and presents an OpenAI-compatible API.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const logger = require('../utils/logger');
const processManager = require('../infrastructure/process-manager');

const LITELLM_BASE_URL = 'http://127.0.0.1:4000';

/**
 * Generates the Phase 2 LiteLLM config YAML (local-only, single Ollama model).
 * Writes the file to Electron's userData directory.
 *
 * @param {Object} _settings - Redux settings slice state (unused in Phase 2 stub)
 * @returns {Promise<string>} Absolute path to the written config file
 */
async function generateConfig(_settings) {
  const configPath = path.join(app.getPath('userData'), 'litellm-config.yaml');

  const yaml = `model_list:
  - model_name: "local/default"
    litellm_params:
      model: "ollama/qwen2.5:14b"
      api_base: "http://127.0.0.1:11434"

router_settings:
  routing_strategy: "simple-shuffle"
`;

  await fs.promises.writeFile(configPath, yaml, 'utf8');
  logger.info(`litellm: config written to "${configPath}"`);
  return configPath;
}

/**
 * Writes the LiteLLM config and starts the LiteLLM process via process-manager.
 * Failures are logged as warnings but do not throw — LiteLLM is optional in Phase 2.
 * Direct Ollama access via ollama.js is used for all chat in Phase 2.
 *
 * @param {Object} settings - Redux settings slice state
 * @returns {Promise<void>}
 */
async function startLiteLLM(settings) {
  try {
    const configPath = await generateConfig(settings);

    // Inject the resolved config path into the litellm args list
    // SERVICE_CONFIG.litellm.args = ['-m', 'litellm', '--config', null, '--port', '4000']
    // Replace the null placeholder (index 3) with the actual path
    const config = processManager.SERVICE_CONFIG.litellm;
    config.args = ['-m', 'litellm', '--config', configPath, '--port', '4000'];

    await processManager.startService('litellm');
  } catch (err) {
    logger.warn(`litellm: startLiteLLM failed (optional in Phase 2) — ${err.message}`);
  }
}

/**
 * Stops the LiteLLM process via process-manager.
 * @returns {Promise<void>}
 */
async function stopLiteLLM() {
  try {
    await processManager.stopService('litellm');
  } catch (err) {
    logger.warn(`litellm: stopLiteLLM error — ${err.message}`);
  }
}

module.exports = {
  startLiteLLM,
  stopLiteLLM,
  generateConfig,
  LITELLM_BASE_URL,
};
