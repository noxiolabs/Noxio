/**
 * @file ollama.js
 * @description HTTP API wrapper for Ollama. Handles model management (list, pull, delete)
 * and streaming LLM inference. Ollama runs natively on Windows at http://127.0.0.1:11434.
 *
 * CRITICAL: All chat requests must include num_ctx: 4096 in options. Omitting this causes
 * the default (32768) to be used, which requires ~48GB for a 14B model and will OOM on
 * 16GB VRAM + 32GB RAM.
 *
 * Streaming is implemented via http.request() reading NDJSON lines. An AbortController
 * is held at module level so the active stream can be cancelled via stopGeneration().
 *
 * Environment variables expected (set at OS level, not here):
 *   OLLAMA_HOST=0.0.0.0, OLLAMA_KEEP_ALIVE=-1, OLLAMA_NUM_GPU=999, OLLAMA_FLASH_ATTENTION=1
 */

'use strict';

const http = require('http');
const logger = require('../utils/logger');

const OLLAMA_BASE = 'http://127.0.0.1:11434';

// ─── Custom Error Classes ─────────────────────────────────────────────────────

class OllamaNotInstalledError extends Error {
  constructor() {
    super('Ollama not installed');
    this.code = 'OLLAMA_NOT_INSTALLED';
  }
}

class ModelNotFoundError extends Error {
  constructor(name) {
    super(`Model not found: ${name}`);
    this.code = 'MODEL_NOT_FOUND';
  }
}

class OllamaOOMError extends Error {
  constructor() {
    super('Ollama out of memory');
    this.code = 'OLLAMA_OOM';
  }
}

// ─── Module-level abort state ─────────────────────────────────────────────────

/** @type {{ abort: Function }|null} Current in-flight request controller */
let _currentController = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Makes a raw HTTP request and returns the ClientRequest so the caller can read
 * the response as a stream. Rejects if the connection is refused.
 * @param {string} method
 * @param {string} urlPath
 * @param {Object|null} body
 * @returns {Promise<http.IncomingMessage>}
 */
function makeRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: '127.0.0.1',
      port: 11434,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(options, (res) => resolve(res));
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new OllamaNotInstalledError());
      } else {
        reject(err);
      }
    });

    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Reads a full response body as a string.
 * @param {http.IncomingMessage} res
 * @returns {Promise<string>}
 */
function readBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether the Ollama service is reachable.
 * @returns {Promise<boolean>}
 */
async function checkRunning() {
  try {
    const res = await makeRequest('GET', '/');
    res.resume();
    return res.statusCode === 200;
  } catch (_err) {
    return false;
  }
}

/**
 * Lists all locally available Ollama models.
 * @returns {Promise<Array<{name: string, size: number, modifiedAt: string}>>}
 */
async function listModels() {
  try {
    const res = await makeRequest('GET', '/api/tags');
    const body = await readBody(res);

    if (res.statusCode !== 200) {
      logger.warn(`ollama: listModels returned HTTP ${res.statusCode}`);
      return [];
    }

    const parsed = JSON.parse(body);
    return (parsed.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at,
    }));
  } catch (err) {
    logger.error(`ollama: listModels failed — ${err.message}`);
    return [];
  }
}

/**
 * Pulls a model from the Ollama registry, streaming download progress.
 * Resolves when the pull reports 'success'. Calls onProgress on each update.
 * @param {string} name - Model name e.g. 'qwen2.5:14b'
 * @param {function({status: string, percent: number, digest: string|undefined}): void} onProgress
 * @returns {Promise<void>}
 */
async function pullModel(name, onProgress) {
  logger.info(`ollama: pulling model "${name}"`);

  const res = await makeRequest('POST', '/api/pull', { name, stream: true });

  if (res.statusCode === 404) {
    throw new ModelNotFoundError(name);
  }

  return new Promise((resolve, reject) => {
    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const obj = JSON.parse(trimmed);

          if (obj.error) {
            logger.error(`ollama: pullModel stream error for "${name}" — ${obj.error}`);
            reject(new Error(obj.error));
            return; // stop processing further lines in this chunk
          }

          const percent =
            obj.total && obj.total > 0
              ? Math.round((obj.completed / obj.total) * 100)
              : 0;

          if (typeof onProgress === 'function') {
            onProgress({ status: obj.status || '', percent, digest: obj.digest });
          }

          if (obj.status === 'success') {
            logger.info(`ollama: pull complete for "${name}"`);
            resolve();
          }
        } catch (parseErr) {
          logger.warn(`ollama: pullModel parse error — ${parseErr.message}`);
        }
      }
    });

    res.on('end', () => resolve());
    res.on('error', reject);
  });
}

/**
 * Deletes a model from local Ollama storage.
 * @param {string} name - Model name to delete
 * @returns {Promise<void>}
 */
async function deleteModel(name) {
  logger.info(`ollama: deleting model "${name}"`);

  const res = await makeRequest('DELETE', '/api/delete', { name });
  const body = await readBody(res);

  if (res.statusCode === 404) {
    throw new ModelNotFoundError(name);
  }

  if (res.statusCode !== 200) {
    throw new Error(`ollama: deleteModel failed with HTTP ${res.statusCode}: ${body}`);
  }
}

/**
 * Streams a chat completion from Ollama directly to the renderer via IPC events.
 * Sends 'stream-token' for each content chunk and 'stream-complete' when done.
 *
 * CRITICAL: always passes num_ctx with a minimum safe value (default 4096) to prevent OOM
 * on 16GB VRAM + 14B models. Respects user-configured contextWindow if provided and safe.
 *
 * @param {string} model - Model name e.g. 'qwen2.5:14b'
 * @param {Array<{role: string, content: string}>} messages - Conversation history
 * @param {import('electron').BrowserWindow} win - Window to send IPC events to
 * @param {{systemPrompt?: string, contextWindow?: number}} options - Chat settings
 * @returns {Promise<void>}
 */
async function generateStream(model, messages, win, options = {}) {
  // Abort any in-flight stream
  if (_currentController) {
    _currentController.abort();
  }

  let aborted = false;
  _currentController = {
    abort() {
      aborted = true;
      if (req) {
        try { req.destroy(); } catch (_) { /* ignore */ }
      }
    },
  };

  let req = null;

  logger.info(`ollama: generateStream — model: ${model}, messages: ${messages.length}`);

  // Sanitize context window: clamp between 512 and 32768, default to 4096 if not provided
  const contextWindow = options.contextWindow ?? 4096;
  const safeContextWindow = Math.max(512, Math.min(32768, contextWindow));

  // Build messages array with optional system prompt prepended
  let messagesWithSystem = messages;
  if (options.systemPrompt && typeof options.systemPrompt === 'string' && options.systemPrompt.trim()) {
    messagesWithSystem = [
      { role: 'system', content: options.systemPrompt },
      ...messages,
    ];
  }

  const body = JSON.stringify({
    model,
    messages: messagesWithSystem,
    stream: true,
    options: { num_ctx: safeContextWindow },
    ...(options.think ? { think: true } : {}),
  });

  return new Promise((resolve, reject) => {
    // Guard: ensure stream-complete is sent to the renderer exactly once,
    // regardless of which exit path (done flag, res.end, error, abort) fires.
    let completeSent = false;
    function sendComplete() {
      if (completeSent) return;
      completeSent = true;
      if (win && !win.isDestroyed()) {
        win.webContents.send('stream-complete');
      }
      _currentController = null;
    }

    const options = {
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    req = http.request(options, (res) => {
      if (res.statusCode === 404) {
        sendComplete();
        reject(new ModelNotFoundError(model));
        return;
      }

      let buffer = '';

      res.on('data', (chunk) => {
        if (aborted) return;
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const obj = JSON.parse(trimmed);

            if (obj.message?.thinking) {
              if (win && !win.isDestroyed()) {
                win.webContents.send('stream-thinking', obj.message.thinking);
              }
            }

            if (obj.message?.content) {
              if (win && !win.isDestroyed()) {
                win.webContents.send('stream-token', obj.message.content);
              }
            }

            if (obj.done === true) {
              sendComplete();
              resolve();
            }
          } catch (parseErr) {
            logger.warn(`ollama: generateStream parse error — ${parseErr.message}`);
          }
        }
      });

      res.on('end', () => {
        // Fires after all data events. If obj.done already called sendComplete,
        // this is a no-op. Covers models that don't send a done:true line.
        sendComplete();
        resolve();
      });

      res.on('error', (err) => {
        logger.error(`ollama: generateStream response error — ${err.message}`);
        sendComplete();
        resolve(); // resolve (not reject) so the IPC handler doesn't throw to renderer
      });
    });

    req.on('error', (err) => {
      if (aborted) {
        sendComplete();
        resolve();
        return;
      }

      logger.error(`ollama: generateStream request error — ${err.message}`);
      sendComplete();

      if (err.code === 'ECONNREFUSED') {
        reject(new OllamaNotInstalledError());
      } else {
        resolve();
      }
    });

    req.write(body);
    req.end();
  });
}

/**
 * Aborts the currently active generateStream request, if any.
 * The stream-complete event will be sent by the abort handler inside generateStream.
 */
function stopGeneration() {
  if (_currentController) {
    logger.info('ollama: stopGeneration() called — aborting active stream');
    _currentController.abort();
    _currentController = null;
  }
}

module.exports = {
  checkRunning,
  listModels,
  pullModel,
  deleteModel,
  generateStream,
  stopGeneration,
  OllamaNotInstalledError,
  ModelNotFoundError,
  OllamaOOMError,
};
