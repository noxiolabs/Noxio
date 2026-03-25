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
   * apiKeySet: true if a key has been saved in the main process.
   * apiKeyMasked: display string e.g. '••••••••abcd'.
   */
  cloudProviders: {
    openai: {
      apiKey: '',
      apiKeySet: false,
      apiKeyMasked: '',
      enabled: false,
      monthlyBudgetUSD: 0,
      usedUSD: 0,
    },
    anthropic: {
      apiKey: '',
      apiKeySet: false,
      apiKeyMasked: '',
      enabled: false,
      monthlyBudgetUSD: 0,
      usedUSD: 0,
    },
    google: {
      apiKey: '',
      apiKeySet: false,
      apiKeyMasked: '',
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

  /**
   * UI appearance preferences. Reserved for future use — not yet applied to the UI.
   * theme: colour scheme preference.
   * fontSize: global font size scale.
   */
  ui: {
    theme: 'dark',
    fontSize: 'medium',
  },

  /**
   * Voice feature settings.
   * sttLanguage: BCP-47 language code or 'auto' for automatic detection.
   * ttsVoice: Kokoro voice identifier.
   */
  voice: {
    sttLanguage: 'auto',
    ttsVoice: 'af_sky',
  },

  /**
   * Chat panel settings.
   * contextWindow: Ollama num_ctx value sent with each request.
   * systemPrompt: Optional system message prepended to every conversation.
   */
  chat: {
    contextWindow: 4096,
    systemPrompt: '',
  },

  /**
   * Transient settings panel UI state. NOT persisted to disk.
   * open: whether the settings overlay is visible.
   * activeSection: which tab is selected inside the overlay.
   * pullInProgress: model name currently being pulled, or null.
   * pullPercent: 0–100 progress for the active pull.
   */
  _settingsPanel: {
    open: false,
    activeSection: 'models',
    pullInProgress: null,
    pullPercent: 0,
  },
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

    /**
     * Merges partial updates into the UI appearance preferences.
     * @param {Object} action.payload - Partial ui object e.g. { theme: 'light' }
     */
    updateUI(state, action) {
      Object.assign(state.ui, action.payload);
    },

    /**
     * Merges partial updates into the voice settings.
     * @param {Object} action.payload - Partial voice object e.g. { sttLanguage: 'en' }
     */
    updateVoiceSettings(state, action) {
      Object.assign(state.voice, action.payload);
    },

    /**
     * Merges partial updates into the chat settings.
     * @param {Object} action.payload - Partial chat object e.g. { contextWindow: 8192 }
     */
    updateChatSettings(state, action) {
      Object.assign(state.chat, action.payload);
    },

    /**
     * Opens the settings overlay and navigates to the given section.
     * @param {Object} action.payload - Section key string e.g. 'models'
     */
    openSettingsPanel(state, action) {
      state._settingsPanel.open = true;
      state._settingsPanel.activeSection = action.payload ?? 'models';
    },

    /**
     * Closes the settings overlay. Active section is preserved for next open.
     */
    closeSettingsPanel(state) {
      state._settingsPanel.open = false;
    },

    /**
     * Updates the in-progress model pull state.
     * @param {Object} action.payload
     * @param {string} action.payload.model - Model name being pulled
     * @param {number} action.payload.percent - Pull progress 0–100
     */
    setPullProgress(state, action) {
      const { model, percent } = action.payload ?? {};
      state._settingsPanel.pullInProgress = model ?? null;
      state._settingsPanel.pullPercent = typeof percent === 'number' ? percent : 0;
    },

    /**
     * Clears pull progress state once a pull finishes or errors out.
     */
    clearPullProgress(state) {
      state._settingsPanel.pullInProgress = null;
      state._settingsPanel.pullPercent = 0;
    },

    /**
     * Updates the display state for a cloud provider's API key after saving.
     * The actual key is stored in the main process; only the masked form is
     * kept in Redux for display purposes.
     * @param {Object} action.payload
     * @param {'openai'|'anthropic'|'google'} action.payload.provider
     * @param {boolean} action.payload.apiKeySet
     * @param {string} action.payload.apiKeyMasked - e.g. '••••••••abcd'
     */
    setCloudApiKeySet(state, action) {
      const { provider, apiKeySet, apiKeyMasked } = action.payload ?? {};
      if (!provider || !state.cloudProviders[provider]) return;
      state.cloudProviders[provider].apiKeySet = Boolean(apiKeySet);
      state.cloudProviders[provider].apiKeyMasked = apiKeyMasked ?? '';
      // Clear the plaintext key from state — it has been handed off to main
      state.cloudProviders[provider].apiKey = '';
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
  updateUI,
  updateVoiceSettings,
  updateChatSettings,
  openSettingsPanel,
  closeSettingsPanel,
  setPullProgress,
  clearPullProgress,
  setCloudApiKeySet,
} = settingsSlice.actions;

export default settingsSlice.reducer;
