/**
 * @file settings.js
 * @description Redux slice for application settings: setup state, selected models,
 * and UI/voice/chat preferences.
 */

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  /** True after the setup wizard has completed successfully */
  setupComplete: false,

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
   * Whether game mode is active. When true, all AI services are stopped to
   * free VRAM for gaming, and all app tabs are disabled.
   * NOT persisted — resets to false on restart (services restart on next launch).
   */
  gameModeActive: false,

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
     * @param {'comfyui'|'whisper'|'kokoro'} action.payload.service
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
     * @param {'ollama'|'comfyui'|'whisper'|'kokoro'} action.payload.service
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
     * Sets game mode active state. Dispatched by ipc-middleware when the
     * 'game-mode-changed' event arrives from the main process.
     * @param {Object} action.payload - boolean
     */
    setGameMode(state, action) {
      state.gameModeActive = Boolean(action.payload);
    },

    /**
     * Hydrates all persisted user settings from electron-store.
     * Merges loaded settings with defaults, preserving any unset fields.
     * Dispatched once at app startup by ipc-middleware after calling get-settings.
     * @param {Object} action.payload - Settings object from electron-store
     */
    hydrateSettings(state, action) {
      const loaded = action.payload ?? {};

      // Merge loaded settings with defaults, only updating fields that were persisted
      if (loaded.models) Object.assign(state.models, loaded.models);
      if (loaded.installDir !== undefined) state.installDir = loaded.installDir;
      if (loaded.servicePaths) Object.assign(state.servicePaths, loaded.servicePaths);
      if (loaded.installedServices) Object.assign(state.installedServices, loaded.installedServices);
      if (loaded.selectedCapabilities) state.selectedCapabilities = loaded.selectedCapabilities;
      if (loaded.ui) Object.assign(state.ui, loaded.ui);
      if (loaded.voice) Object.assign(state.voice, loaded.voice);
      if (loaded.chat) Object.assign(state.chat, loaded.chat);
      if (loaded.setupComplete !== undefined) state.setupComplete = loaded.setupComplete;
    },

  },
});

export const {
  completeSetup,
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
  hydrateSettings,
  setGameMode,
} = settingsSlice.actions;

export default settingsSlice.reducer;
