/**
 * @file whisper.js
 * @description HTTP API wrapper for whisper_server.py (faster-whisper).
 * The server runs natively on Windows at http://localhost:10300.
 * Started/stopped by process-manager.js — this module only wraps the HTTP API.
 *
 * Audio must be 16 kHz mono WAV. The renderer handles resampling and WAV encoding
 * before sending via IPC, so this module receives a ready-to-transcribe Buffer.
 */

'use strict';

const http   = require('http');
const logger = require('../utils/logger');

const WHISPER_BASE_URL = 'http://localhost:10300';

// ─── Custom Error Classes ─────────────────────────────────────────────────────

class WhisperNotRunningError extends Error {
  constructor() {
    super('Whisper service not running');
    this.code = 'WHISPER_NOT_RUNNING';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Makes a raw HTTP request to the whisper server.
 * @param {string} method
 * @param {string} urlPath
 * @param {Buffer|null} body
 * @param {string} contentType
 * @returns {Promise<http.IncomingMessage>}
 */
function makeRequest(method, urlPath, body = null, contentType = 'application/octet-stream') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 10300,
      path: urlPath,
      method,
      headers: {
        'Content-Type': contentType,
        ...(body ? { 'Content-Length': body.length } : {}),
      },
    };

    const req = http.request(options, (res) => resolve(res));
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') reject(new WhisperNotRunningError());
      else reject(err);
    });

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Reads a full response body as a UTF-8 string.
 * @param {http.IncomingMessage} res
 * @returns {Promise<string>}
 */
function readBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether the whisper server is reachable.
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
 * Transcribes a WAV audio buffer to text.
 * @param {Buffer} audioBuffer - 16 kHz mono WAV data
 * @returns {Promise<string>} Transcribed text
 */
async function transcribe(audioBuffer) {
  logger.info(`whisper: transcribe() — ${audioBuffer.length} bytes`);

  const res  = await makeRequest('POST', '/transcribe', audioBuffer, 'audio/wav');
  const body = await readBody(res);

  if (res.statusCode !== 200) {
    logger.error(`whisper: transcribe returned HTTP ${res.statusCode}: ${body}`);
    throw new Error(`Whisper transcription failed (HTTP ${res.statusCode}): ${body}`);
  }

  const parsed = JSON.parse(body);
  logger.info(`whisper: transcript — "${(parsed.text || '').slice(0, 80)}"`);
  return parsed.text || '';
}

module.exports = { checkRunning, transcribe, WHISPER_BASE_URL, WhisperNotRunningError };
