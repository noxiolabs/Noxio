/**
 * @file infrastructure.js
 * @description Redux slice for infrastructure state: background service statuses,
 * detected hardware, VRAM usage, and current active mode. Updated by IPC events
 * from the main process via ipc-middleware.js.
 */

import { createSlice } from '@reduxjs/toolkit';

/**
 * @typedef {'stopped'|'starting'|'running'|'error'} ServiceStatus
 * @typedef {{ status: ServiceStatus, pid: number|null }} ServiceState
 */

const initialState = {
  /** Background service health — updated by 'service-status' IPC events */
  services: {
    ollama:  { status: 'stopped', pid: null },
    litellm: { status: 'stopped', pid: null },
    comfyui: { status: 'stopped', pid: null },
    whisper: { status: 'stopped', pid: null },
    kokoro:  { status: 'stopped', pid: null },
  },

  /** Detected hardware — populated on startup via get-hardware-info IPC */
  hardware: null,

  /** Live VRAM usage — updated by 'vram-update' IPC events */
  vram: {
    usedGB: 0,
    availableGB: 0,
  },

  /** Active workload mode — drives VRAM orchestration */
  currentMode: 'chat',

  /**
   * Last routing decision received from the main process via 'routing-decision' event.
   * Cleared (reset to local) when streaming ends.
   */
  lastRouting: {
    provider: 'local', // 'local' | 'openai' | 'anthropic' | 'google'
    model: null,       // model name string, or null when local
  },
};

const infrastructureSlice = createSlice({
  name: 'infrastructure',
  initialState,
  reducers: {
    /**
     * Updates a single service's status and PID.
     * Triggered by 'service-status' IPC event.
     * @param {Object} action.payload
     * @param {string} action.payload.service
     * @param {ServiceStatus} action.payload.status
     * @param {number|null} action.payload.pid
     */
    updateServiceStatus(state, action) {
      const { service, status, pid } = action.payload;
      if (state.services[service]) {
        state.services[service] = { status, pid };
      }
    },

    /**
     * Sets the detected hardware info object.
     * Called once on startup after get-hardware-info resolves.
     */
    setHardware(state, action) {
      state.hardware = action.payload;
    },

    /**
     * Updates live VRAM usage figures.
     * Triggered by 'vram-update' IPC event.
     */
    updateVram(state, action) {
      state.vram = action.payload;
    },

    /**
     * Sets the current active mode.
     * Updated after 'mode-ready' IPC event confirms the switch is complete.
     */
    setCurrentMode(state, action) {
      state.currentMode = action.payload;
    },

    /**
     * Records the last routing decision from the main process.
     * Triggered by 'routing-decision' IPC event at the start of each stream.
     * @param {Object} action.payload
     * @param {'local'|'openai'|'anthropic'|'google'} action.payload.provider
     * @param {string|null} action.payload.model
     */
    setLastRouting(state, action) {
      const { provider, model } = action.payload;
      state.lastRouting = { provider: provider ?? 'local', model: model ?? null };
    },
  },
});

export const { updateServiceStatus, setHardware, updateVram, setCurrentMode, setLastRouting } =
  infrastructureSlice.actions;

export default infrastructureSlice.reducer;
