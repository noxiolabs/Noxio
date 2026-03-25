/**
 * @file vitest.config.js
 * @description Vitest configuration for Noxio. Runs unit tests in a Node.js
 * environment so main-process modules (CommonJS) can be tested directly.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,jsx}'],
  },
});
