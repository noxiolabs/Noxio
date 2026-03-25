/**
 * @file preload.js
 * @description Security bridge between the Electron main process and the React
 * renderer. Exposes a minimal, explicitly-allowlisted API surface via
 * contextBridge so the renderer can trigger IPC calls without ever touching
 * Node.js directly. All channels must be explicitly listed here — no wildcards.
 *
 * Renderer access: window.electronAPI.<method>()
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Channels the renderer is allowed to listen to from main.
 * Any channel not in this list is silently ignored.
 */
const VALID_RECEIVE_CHANNELS = [
  'service-status',           // { service: string, status: string, pid: number|null }
  'stream-token',             // token: string
  'stream-complete',          // void
  'install-progress',         // { step: string, percent: number, message: string }
  'install-error',            // { step: string, message: string, retryable: boolean }
  'install-service-complete', // { service: string, executablePath: string|null }
  'mode-ready',               // mode: string
  'vram-update',              // { usedGB: number, availableGB: number }
  'download-progress',        // { model: string, percent: number }
  'image-progress',           // percent: number (0–100) — emitted during image generation
  'manifest-verified',        // Object — updated manifest after a verification pass
  'model-pull-progress',      // { model: string, percent: number, status: string }
  'model-pull-complete',      // { model: string }
  'model-pull-error',         // { model: string, error: string }
  'routing-decision',         // { provider: string, model: string, conversationId: string, fallbackReason?: string }
  'budget-warning',           // { provider: string, usedUSD: number, budgetUSD: number, percentUsed: number }
  'cloud-usage-update',       // { provider: string, usedUSD: number }
];

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Renderer → Main (invoke/response) ──────────────────────────────────

  /**
   * Returns detected hardware info: GPU name, VRAM, RAM, OS, driver version.
   * @returns {Promise<HardwareInfo>}
   */
  getHardwareInfo: () => ipcRenderer.invoke('get-hardware-info'),

  /**
   * Returns current status of all managed background services.
   * @returns {Promise<ServiceStatusMap>}
   */
  getServiceStatuses: () => ipcRenderer.invoke('get-service-statuses'),

  /**
   * Switches the active mode (chat | create | voice | agent | gaming).
   * Triggers VRAM orchestration in the main process.
   * Result arrives via 'mode-ready' event.
   * @param {string} targetMode - Mode to switch to
   * @param {string} currentMode - Currently active mode (needed for VRAM decisions)
   * @returns {Promise<void>}
   */
  switchMode: (targetMode, currentMode) =>
    ipcRenderer.invoke('switch-mode', { targetMode, currentMode }),

  /**
   * Checks whether required and recommended prerequisites are installed.
   * Returns a map of { ok, required, label, note, link } per requirement.
   * @returns {Promise<Record<string, {ok: boolean, required: boolean, label: string, note: string, link: string|null}>>}
   */
  checkPrerequisites: () => ipcRenderer.invoke('check-prerequisites'),

  /**
   * Returns enriched hardware info for the setup wizard (VRAM tier, capability flags).
   * @returns {Promise<WizardHardware>}
   */
  scanWizardHardware: () => ipcRenderer.invoke('scan-wizard-hardware'),

  /**
   * Returns model recommendations based on selected capabilities and available VRAM.
   * @param {string[]} capabilities - e.g. ['chat', 'coding', 'image', 'voice']
   * @returns {Promise<ModelRecommendationMap>}
   */
  getModelRecommendations: (capabilities) =>
    ipcRenderer.invoke('get-model-recommendations', capabilities),

  /**
   * Starts the installation sequence. Progress arrives via 'install-progress' events.
   * Errors arrive via 'install-error' events.
   * Service completions arrive via 'install-service-complete' events.
   * @param {InstallConfig} config
   * @returns {Promise<{success: boolean}>}
   */
  startInstallation: (config) => ipcRenderer.invoke('start-installation', config),

  /**
   * Returns available filesystem drives with size information.
   * @returns {Promise<Array<{letter: string, label: string, totalGB: number, freeGB: number}>>}
   */
  getAvailableDrives: () => ipcRenderer.invoke('get-available-drives'),

  /**
   * Validates that a directory is writable and has sufficient free space (25 GB).
   * @param {string} dir - Absolute path to validate
   * @returns {Promise<{ok: boolean, reason: string|null, freeGB: number}>}
   */
  validateInstallDir: (dir) => ipcRenderer.invoke('validate-install-dir', { dir }),

  /**
   * Returns the recommended default install directory (E:\Noxio or %LOCALAPPDATA%\Noxio).
   * @returns {Promise<{dir: string}>}
   */
  getDefaultInstallDir: () => ipcRenderer.invoke('get-default-install-dir'),

  /**
   * Opens a native folder picker dialog so the user can choose an install location.
   * @returns {Promise<{dir: string|null}>}
   */
  pickInstallDirectory: () => ipcRenderer.invoke('pick-install-directory'),

  /**
   * Returns resume data for a partially completed installation.
   * @returns {Promise<{installedServices: Object, servicePaths: Object, installDir: string|null}>}
   */
  checkInstallResume: () => ipcRenderer.invoke('check-install-resume'),

  /**
   * Marks setup as complete in electron-store so the wizard is skipped on next launch.
   * Must be called by ReadyScreen before dispatching completeSetup() to Redux.
   * @returns {Promise<void>}
   */
  completeSetup: () => ipcRenderer.invoke('complete-setup'),

  /**
   * Returns all locally available Ollama models.
   * @returns {Promise<Array<{name: string, size: number, modifiedAt: string}>>}
   */
  listModels: () => ipcRenderer.invoke('list-models'),

  // ─── Settings panel ─────────────────────────────────────────────────────

  /**
   * Returns persisted settings. API keys are replaced by { apiKeySet, apiKeyMasked }
   * — the raw key is never sent to the renderer.
   * @returns {Promise<Object>}
   */
  getSettings: () => ipcRenderer.invoke('get-settings'),

  /**
   * Saves a cloud provider configuration. The API key is held in main-process memory
   * only and is never written to disk. `enabled` and `monthlyBudgetUSD` are persisted.
   * @param {string} provider - 'openai' | 'anthropic' | 'google'
   * @param {string} apiKey
   * @param {boolean} enabled
   * @param {number} monthlyBudgetUSD
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  saveCloudProvider: (provider, apiKey, enabled, monthlyBudgetUSD) =>
    ipcRenderer.invoke('save-cloud-provider', { provider, apiKey, enabled, monthlyBudgetUSD }),

  /**
   * Persists LiteLLM routing preferences.
   * @param {boolean} preferLocal
   * @param {boolean} allowCloudForLongContext
   * @param {boolean} allowCloudForComplexReasoning
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  saveRoutingPrefs: (preferLocal, allowCloudForLongContext, allowCloudForComplexReasoning) =>
    ipcRenderer.invoke('save-routing-prefs', { preferLocal, allowCloudForLongContext, allowCloudForComplexReasoning }),

  /**
   * Sets the default model for a capability. Validates the model exists in Ollama
   * unless the capability is 'image'.
   * @param {'chat'|'coding'|'image'} capability
   * @param {string} model
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  setDefaultModel: (capability, model) =>
    ipcRenderer.invoke('set-default-model', { capability, model }),

  /**
   * Pulls a model from the Ollama registry. Progress arrives via 'model-pull-progress'
   * events, completion via 'model-pull-complete', errors via 'model-pull-error'.
   * @param {string} model
   * @returns {Promise<void>}
   */
  pullModel: (model) => ipcRenderer.invoke('pull-model', { model }),

  /**
   * Deletes a model from local Ollama storage.
   * @param {string} model
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  deleteModel: (model) => ipcRenderer.invoke('delete-model', { model }),

  /**
   * Returns cloud provider spend totals (USD used this month) from the persisted store.
   * @returns {Promise<{openai: number, anthropic: number, google: number}>}
   */
  getCloudUsage: () => ipcRenderer.invoke('get-cloud-usage'),

  /**
   * Verifies a cloud provider API key with a lightweight live HTTP check.
   * The key is used for this call only and is not stored.
   * @param {{ provider: 'openai'|'anthropic'|'google', apiKey: string }} payload
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  verifyCloudProvider: (payload) => ipcRenderer.invoke('verify-cloud-provider', payload),

  /**
   * Persists voice settings (STT language and TTS voice).
   * @param {string} sttLanguage
   * @param {string} ttsVoice
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  saveVoiceSettings: (sttLanguage, ttsVoice) =>
    ipcRenderer.invoke('save-voice-settings', { sttLanguage, ttsVoice }),

  /**
   * Persists chat settings. contextWindow must be 512–32768.
   * @param {number} contextWindow
   * @param {string} systemPrompt
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  saveChatSettings: (contextWindow, systemPrompt) =>
    ipcRenderer.invoke('save-chat-settings', { contextWindow, systemPrompt }),

  /**
   * Sends the full conversation messages array to the LLM. Response tokens
   * arrive via 'stream-token' events, completion via 'stream-complete'.
   * A 'routing-decision' event fires before streaming begins, indicating which
   * provider and model handled the request.
   * @param {{ messages: Array<{role:string,content:string}>, model: string, conversationId: string, forceCloud?: boolean, cloudProvider?: string|null }} payload
   * @returns {Promise<void>}
   */
  sendChatMessage: (payload) => ipcRenderer.invoke('send-chat-message', payload),

  /**
   * Stops an active streaming response.
   * @returns {Promise<void>}
   */
  stopStream: () => ipcRenderer.invoke('stop-stream'),

  /**
   * Starts image generation. Progress arrives via 'install-progress' events,
   * result via a completion event.
   * @param {string} prompt
   * @param {string} style
   * @param {string} quality
   * @returns {Promise<void>}
   */
  generateImage: (prompt, style, quality) =>
    ipcRenderer.invoke('generate-image', { prompt, style, quality }),

  /**
   * Starts microphone recording for voice input.
   * @returns {Promise<void>}
   */
  startRecording: () => ipcRenderer.invoke('start-recording'),

  /**
   * Stops recording and returns transcribed text.
   * @returns {Promise<string>} Transcribed text
   */
  stopRecording: () => ipcRenderer.invoke('stop-recording'),

  /**
   * Returns the current install state manifest from electron-store.
   * Contains service and model install status, paths, and last-verified timestamps.
   * @returns {Promise<Object|null>}
   */
  getInstallManifest: () => ipcRenderer.invoke('get-install-manifest'),

  /**
   * Runs a full verification pass over the manifest, checking that installed
   * executables and model files still exist on disk.
   * Completion also fires the 'manifest-verified' event.
   * @returns {Promise<Object|null>} The updated manifest object
   */
  verifyInstallManifest: () => ipcRenderer.invoke('verify-install-manifest'),

  // ─── Main → Renderer (event subscriptions) ──────────────────────────────

  /**
   * Subscribe to an event from the main process.
   * Only channels in VALID_RECEIVE_CHANNELS are permitted.
   * @param {string} channel
   * @param {Function} callback
   */
  on: (channel, callback) => {
    if (!VALID_RECEIVE_CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },

  /**
   * Unsubscribe a previously registered event listener.
   * @param {string} channel
   * @param {Function} callback
   */
  off: (channel, callback) => {
    if (!VALID_RECEIVE_CHANNELS.includes(channel)) return;
    ipcRenderer.removeListener(channel, callback);
  },

  /**
   * Subscribe to an event that fires at most once.
   * @param {string} channel
   * @param {Function} callback
   */
  once: (channel, callback) => {
    if (!VALID_RECEIVE_CHANNELS.includes(channel)) return;
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
  },
});
