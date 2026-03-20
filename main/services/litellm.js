/**
 * @file litellm.js
 * @description Manages the LiteLLM proxy process and handles all LLM routing
 * decisions. LiteLLM sits in front of Ollama and any configured cloud providers,
 * presenting a unified OpenAI-compatible API at http://localhost:4000.
 *
 * Routing logic (priority order):
 *   1. Privacy flag set → local only, no cloud
 *   2. Provider budget exhausted → local fallback
 *   3. Task complexity + cloud enabled + budget available → cloud
 *   4. Default → local (preferLocal = true)
 *
 * LiteLLM config is auto-generated from Redux settings on startup and
 * regenerated whenever cloud provider settings change.
 *
 * TODO Phase 2: implement config generation, process management, and routing.
 */

'use strict';

const logger = require('../utils/logger');

const LITELLM_BASE_URL = 'http://localhost:4000';

/**
 * Generates a LiteLLM config.yaml from the current settings.
 * Includes local Ollama models and any enabled cloud providers with budget caps.
 * TODO Phase 2: implement config generation and write to disk.
 *
 * @param {Object} settings - Redux settings slice state
 * @returns {string} YAML config string
 */
function generateConfig(settings) {
  logger.info('litellm: generateConfig() — stub');
  return '';
}

/**
 * Starts the LiteLLM process with the generated config.
 * TODO Phase 2: implement process spawn via process-manager.js.
 * @param {Object} settings
 * @returns {Promise<void>}
 */
async function start(settings) {
  logger.info('litellm: start() — stub');
}

/**
 * Stops the LiteLLM process.
 * TODO Phase 2: implement via process-manager.js.
 * @returns {Promise<void>}
 */
async function stop() {
  logger.info('litellm: stop() — stub');
}

/**
 * Sends a chat completion request through LiteLLM with routing applied.
 * Streams tokens back via onToken callback.
 * TODO Phase 2: implement with fetch + SSE streaming.
 *
 * @param {Object} params
 * @param {string} params.model
 * @param {Array<{role: string, content: string}>} params.messages
 * @param {boolean} [params.private=false]  - if true, forces local routing
 * @param {Function} params.onToken
 * @param {Function} params.onDone
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<void>}
 */
async function chatStream({ model, messages, private: isPrivate = false, onToken, onDone, signal }) {
  logger.info(`litellm: chatStream(${model}, private=${isPrivate}) — stub`);
  onDone();
}

module.exports = { generateConfig, start, stop, chatStream, LITELLM_BASE_URL };
