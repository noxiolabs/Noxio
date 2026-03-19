import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration for the Noxio renderer process.
 * Builds the React app from renderer/ into dist/ for Electron to load.
 */
export default defineConfig({
  plugins: [react()],
  root: 'renderer',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  base: './',
});
