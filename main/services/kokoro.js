/**
 * @file kokoro.js
 * @description HTTP API wrapper for kokoro_server.py (kokoro-onnx TTS).
 * The server runs on CPU at http://localhost:8880 — zero VRAM cost.
 * Started/stopped by process-manager.js — this module only wraps the HTTP API.
 */

'use strict';

const http   = require('http');
const logger = require('../utils/logger');

const KOKORO_BASE_URL = 'http://localhost:8880';

// ─── Custom Error Classes ─────────────────────────────────────────────────────

class KokoroNotRunningError extends Error {
  constructor() {
    super('Kokoro service not running');
    this.code = 'KOKORO_NOT_RUNNING';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Makes a raw HTTP request to the Kokoro server.
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
      port: 8880,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(options, (res) => resolve(res));
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') reject(new KokoroNotRunningError());
      else reject(err);
    });

    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Reads a full response body as a Buffer.
 * @param {http.IncomingMessage} res
 * @returns {Promise<Buffer>}
 */
function readBodyBuffer(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether the Kokoro server is reachable.
 * @returns {Promise<boolean>}
 */
async function checkRunning() {
  try {
    const res = await makeRequest('GET', '/health');
    res.resume();
    return res.statusCode === 200;
  } catch (_) {
    return false;
  }
}

/**
 * Synthesises text to speech and returns WAV audio bytes.
 * @param {string} text - Text to synthesise
 * @param {string} [voice='af_heart'] - Kokoro voice ID
 * @returns {Promise<Buffer>} WAV audio data
 */
async function synthesise(text, voice = 'af_heart') {
  logger.info(`kokoro: synthesise() — ${text.length} chars, voice=${voice}`);

  const res    = await makeRequest('POST', '/synthesise', { text, voice });
  const buffer = await readBodyBuffer(res);

  if (res.statusCode !== 200) {
    logger.error(`kokoro: synthesise returned HTTP ${res.statusCode}`);
    throw new Error(`Kokoro synthesis failed (HTTP ${res.statusCode})`);
  }

  logger.info(`kokoro: synthesise() — received ${buffer.length} WAV bytes`);
  return buffer;
}

module.exports = { checkRunning, synthesise, KOKORO_BASE_URL, KokoroNotRunningError };
