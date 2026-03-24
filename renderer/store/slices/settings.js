/**
 * @file settings.js
 * @description Redux slice for application settings: setup state, cloud provider
 * API keys and budgets, model routing preferences, and selected models.
 *
 * SECURITY NOTE: API keys are stored in Redux state (renderer memory) only for
 * display/editing purposes. The actual keys used for API calls are held in the
 * main process — never sent to any renderer-accessible storage unencrypted.
 * When the user saves settings, keys are forwarded to main via IPC, which stores
 * them in Electron's safeStorage.
 */

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  /** True after the setup wizard has completed successfully */
  setupComplete: false,

  /**
   * Cloud provider configuration.
   * apiKey is masked in the UI after saving (show last 4 chars only).
   */
  cloudProviders: {
    openai: {
      apiKey: '',
      enabled: false,
      monthlyBudgetUSD: 0,
      usedUSD: 0,
    },
    anthropic: {
      apiKey: '',
      enabled: false,
      monthlyBudgetUSD: 0,
      usedUSD: 0,
    },
    google: {
      apiKey: '',
      enabled: false,
      monthlyBudgetUSD: 0,
      usedUSD: 0,
    },
  },

  /**
   * LiteLLM routing preferences.
   * preferLocal: always use local when capability is comparable.
   * allowCloudForLongContext: route to cloud when message exceeds local context window.
   * allowCloudForComplexReasoning: user opts into cloud for hard reasoning tasks.
   */
  routing: {
    preferLocal: true,
    allowCloudForLongContext: true,
    allowCloudForComplexReasoning: false,
  },

  /** Selected models per capability — set during wizard, editable in settings */
  models: {
    chat: null,
    coding: null,
    image: null,
  },

  /**
   * Root directory chosen by the user during setup for ComfyUI, venvs, and models.
   * Null until the user confirms in the wizard InstallDir screen.
   */
  installDir: null,

  /**
   * Filesystem paths to each installed service's launch executable or script.
   * Persisted to electron-store so process-manager can resolve them on next launch.
   */
  servicePaths: {
    comfyui:  null,
    litellm:  null,
    whisper:  null,
    kokoro:   null,
  },

  /**
   * Tracks which services have been successfully installed.
   * Used to skip already-installed steps on resume and to gate service startup.
   */
  installedServices: {
    ollama:   false,
    comfyui:  false,
    litellm:  false,
    whisper:  false,
    kokoro:   false,
  },

  /**
   * Capabilities the user selected during the wizard (e.g. ['chat', 'coding', 'voice']).
   * Used to determine which services to start and which install steps to run.
   */
  selectedCapabilities: [],
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    /**
     * Marks setup as complete. Called after the wizard's final health check passes.
     */
    completeSetup(state) {
      state.setupComplete = true;
    },

    /**
     * Updates a cloud provider's configuration.
     * @param {Object} action.payload
     * @param {'openai'|'anthropic'|'google'} action.payload.provider
     * @param {Partial<typeof initialState.cloudProviders.openai>} action.payload.config
     */
    updateCloudProvider(state, action) {
      const { provider, config } = action.payload;
      if (!state.cloudProviders[provider]) return;
      const sanitised = { ...config };
      // Guard: budget and usage must never be negative
      if (sanitised.monthlyBudgetUSD !== undefined) {
        sanitised.monthlyBudgetUSD = Math.max(0, Number(sanitised.monthlyBudgetUSD) || 0);
      }
      if (sanitised.usedUSD !== undefined) {
        sanitised.usedUSD = Math.max(0, Number(sanitised.usedUSD) || 0);
      }
      Object.assign(state.cloudProviders[provider], sanitised);
    },

    /**
     * Updates cloud spend for a provider (from LiteLLM usage polling).
     * @param {Object} action.payload
     * @param {'openai'|'anthropic'|'google'} action.payload.provider
     * @param {number} action.payload.usedUSD
     */
    updateCloudUsage(state, action) {
      const { provider, usedUSD } = action.payload;
      if (state.cloudProviders[provider]) {
        state.cloudProviders[provider].usedUSD = usedUSD;
      }
    },

    /**
     * Updates routing preferences.
     */
    updateRouting(state, action) {
      Object.assign(state.routing, action.payload);
    },

    /**
     * Updates the selected model for a capability.
     * @param {Object} action.payload
     * @param {'chat'|'coding'|'image'} action.payload.capability
     * @param {string} action.payload.model
     */
    setModel(state, action) {
      const { capability, model } = action.payload;
      if (capability in state.models) {
        state.models[capability] = model;
      }
    },

    /**
     * Sets the root install directory chosen by the user in the wizard.
     * @param {Object} action.payload - The absolute directory path string
     */
    setInstallDir(state, action) {
      state.installDir = action.payload ?? null;
    },

    /**
     * Records the filesystem path for a specific installed service.
     * @param {Object} action.payload
     * @param {'comfyui'|'litellm'|'whisper'|'kokoro'} action.payload.service
     * @param {string} action.payload.executablePath
     */
    setServicePath(state, action) {
      const { service, executablePath } = action.payload;
      if (service in state.servicePaths) {
        state.servicePaths[service] = executablePath ?? null;
      }
    },

    /**
     * Marks a service as successfully installed.
     * @param {Object} action.payload
     * @param {'ollama'|'comfyui'|'litellm'|'whisper'|'kokoro'} action.payload.service
     * @param {boolean} [action.payload.installed=true]
     */
    markServiceInstalled(state, action) {
      const { service, installed = true } = action.payload;
      if (service in state.installedServices) {
        state.installedServices[service] = installed;
      }
    },

    /**
     * Sets the capabilities selected by the user during the wizard.
     * @param {Object} action.payload - Array of capability strings e.g. ['chat', 'coding']
     */
    setSelectedCapabilities(state, action) {
      state.selectedCapabilities = Array.isArray(action.payload) ? [...action.payload] : [];
    },
  },
});

export const {
  completeSetup,
  updateCloudProvider,
  updateCloudUsage,
  updateRouting,
  setModel,
  setInstallDir,
  setServicePath,
  markServiceInstalled,
  setSelectedCapabilities,
} = settingsSlice.actions;

export default settingsSlice.reducer;
