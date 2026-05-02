'use strict';

const logger = require('../utils/logger');

/** @type {AbortController|null} */
let _abortController = null;

/**
 * Streams a chat completion from an OpenAI-compatible endpoint (LM Studio, Jan, etc.)
 * to the renderer via IPC events. Sends 'stream-token' for each content chunk and
 * 'stream-complete' when done.
 *
 * @param {string} model
 * @param {Array<{role: string, content: string}>} messages
 * @param {import('electron').BrowserWindow} win
 * @param {{systemPrompt?: string}} options
 * @param {string} baseUrl - e.g. 'http://localhost:1234'
 * @returns {Promise<void>}
 */
async function generateStream(model, messages, win, options = {}, baseUrl = 'http://localhost:1234') {
  if (_abortController) {
    _abortController.abort();
  }
  _abortController = new AbortController();
  const { signal } = _abortController;

  let messagesWithSystem = messages;
  if (options.systemPrompt?.trim()) {
    messagesWithSystem = [{ role: 'system', content: options.systemPrompt }, ...messages];
  }

  let completeSent = false;
  function sendComplete() {
    if (completeSent) return;
    completeSent = true;
    if (win && !win.isDestroyed()) win.webContents.send('stream-complete');
    _abortController = null;
  }

  try {
    logger.info(`openai-compat: generateStream — model: ${model}, endpoint: ${baseUrl}`);
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: messagesWithSystem, stream: true }),
      signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const obj = JSON.parse(trimmed.slice(6));
          const content = obj.choices?.[0]?.delta?.content;
          if (content && win && !win.isDestroyed()) {
            win.webContents.send('stream-token', content);
          }
        } catch (_) { /* skip malformed lines */ }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      logger.error(`openai-compat: generateStream error — ${err.message}`);
    }
  } finally {
    sendComplete();
  }
}

/**
 * Lists models available at the given OpenAI-compatible endpoint.
 * @param {string} baseUrl
 * @returns {Promise<Array<{name: string, size: number, modifiedAt: string}>>}
 */
async function listModels(baseUrl = 'http://localhost:1234') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data ?? []).map((m) => ({ name: m.id, size: 0, modifiedAt: '' }));
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Aborts the currently active generateStream request, if any.
 */
function stopGeneration() {
  if (_abortController) {
    logger.info('openai-compat: stopGeneration() called');
    _abortController.abort();
    _abortController = null;
  }
}

module.exports = { generateStream, listModels, stopGeneration };
