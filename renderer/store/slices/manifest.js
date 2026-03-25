/**
 * @file manifest.js
 * @description Redux slice for the install state manifest. Mirrors the manifest
 * stored in electron-store on the main process side, making it available to UI
 * components without additional IPC calls.
 *
 * Populated on startup via the 'manifest-verified' IPC event (emitted by
 * main/index.js after the startup verification pass). Can also be refreshed
 * on demand by invoking the 'verify-install-manifest' IPC channel.
 *
 * State shape mirrors the manifest stored by main/infrastructure/manifest.js.
 */

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  /** True once the manifest has been loaded from the main process */
  loaded: false,

  /**
   * Service install state keyed by service name.
   * Each entry: { installed, executablePath, version, lastVerifiedAt, installCompletedAt }
   */
  services: {},

  /**
   * Model install state keyed by modelId.
   * Each entry: { modelId, backend, capability, installed, sizeGB, filePath, installedAt, lastVerifiedAt }
   */
  models: {},

  /** ISO timestamp of the last time the manifest was synced from the main process */
  lastCheckedAt: null,
};

const manifestSlice = createSlice({
  name: 'manifest',
  initialState,
  reducers: {
    /**
     * Replaces the full manifest state with data received from the main process.
     * Sets `loaded: true` and `lastCheckedAt` to the current time.
     *
     * @param {Object} action.payload - The manifest object from the main process
     * @param {Object} action.payload.services
     * @param {Object} action.payload.models
     */
    setManifest(state, action) {
      const { services = {}, models = {} } = action.payload ?? {};
      state.loaded = true;
      state.services = services;
      state.models = models;
      state.lastCheckedAt = new Date().toISOString();
    },

    /**
     * Merges a partial update into a single service entry.
     * Used for incremental updates without replacing the entire manifest.
     *
     * @param {Object} action.payload
     * @param {string} action.payload.name - Service name e.g. 'ollama'
     * @param {Object} action.payload.entry - Partial service entry to merge
     */
    updateServiceEntry(state, action) {
      const { name, entry } = action.payload;
      if (!name || !entry) return;
      state.services[name] = {
        ...(state.services[name] ?? {}),
        ...entry,
      };
    },

    /**
     * Merges a partial update into a single model entry.
     * Used for incremental updates without replacing the entire manifest.
     *
     * @param {Object} action.payload
     * @param {string} action.payload.modelId - Model identifier e.g. 'qwen2.5:14b'
     * @param {Object} action.payload.entry - Partial model entry to merge
     */
    updateModelEntry(state, action) {
      const { modelId, entry } = action.payload;
      if (!modelId || !entry) return;
      state.models[modelId] = {
        ...(state.models[modelId] ?? {}),
        ...entry,
      };
    },
  },
});

export const { setManifest, updateServiceEntry, updateModelEntry } = manifestSlice.actions;

export default manifestSlice.reducer;
