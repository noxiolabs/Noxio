/**
 * @file logger.js
 * @description Simple structured logger for the main process. Wraps console
 * methods so they can be suppressed in production or replaced with a file-based
 * logger (e.g. electron-log) later without touching call sites.
 *
 * Usage: const logger = require('./utils/logger');
 *        logger.info('Service started');
 *        logger.error('Failed to spawn process', err);
 */

'use strict';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Formats a log message with timestamp and level prefix.
 * @param {string} level
 * @param {string} message
 * @returns {string}
 */
function format(level, message) {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
}

const logger = {
  /**
   * Logs an informational message.
   * @param {string} message
   * @param {...any} args
   */
  info(message, ...args) {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.log(format('info', message), ...args);
    }
  },

  /**
   * Logs a warning.
   * @param {string} message
   * @param {...any} args
   */
  warn(message, ...args) {
    // eslint-disable-next-line no-console
    console.warn(format('warn', message), ...args);
  },

  /**
   * Logs an error. Always emitted regardless of environment.
   * @param {string} message
   * @param {...any} args
   */
  error(message, ...args) {
    // eslint-disable-next-line no-console
    console.error(format('error', message), ...args);
  },
};

module.exports = logger;
