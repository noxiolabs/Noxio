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
  'stream-thinking',          // token: string — reasoning tokens from think-capable models
  'routing-decision',         // { provider: string, model: string, conversationId: string, fallbackReason?: string }
  'open-settings',            // { section: string } — opens settings overlay from main process or external trigger
  'game-mode-changed',        // boolean — true when game mode activates, false when it deactivates
  'service-update-progress',  // { service: string, percent: number, message: string }
  'service-update-complete',  // { service: string }
  'service-update-error',     // { service: string, error: string }
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
   * Installs a capability not selected during the initial setup wizard.
   * Reuses the full installer with idempotency — already-installed services are skipped.
   * Progress arrives via 'install-progress' events, errors via 'install-error'.
   * @param {string} capability - e.g. 'image', 'chat', 'coding'
   * @param {string} [model] - Required for LLM capabilities; not needed for 'image'
   * @returns {Promise<{success: boolean}>}
   */
  installAdditionalCapability: (capability, model) =>
    ipcRenderer.invoke('install-additional-capability', { capability, model }),

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
   * Returns persisted settings.
   * @returns {Promise<Object>}
   */
  getSettings: () => ipcRenderer.invoke('get-settings'),

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
   * Persists chat conversation history to electron-store.
   * @param {{ conversations: Array }} payload
   * @returns {Promise<{success: boolean}>}
   */
  saveChatHistory: (payload) => ipcRenderer.invoke('save-chat-history', payload),

  /**
   * Loads persisted chat conversation history from electron-store.
   * @returns {Promise<{conversations: Array}|null>}
   */
  loadChatHistory: () => ipcRenderer.invoke('load-chat-history'),

  /**
   * Opens the settings overlay on a specific section tab.
   * Dispatches openSettingsPanel action via the main window.
   * @param {string} section - e.g. 'models', 'cloud', 'chat'
   */
  openSettings: (section) => ipcRenderer.invoke('open-settings', { section }),

  /**
   * Sends the full conversation messages array to local Ollama. Response tokens
   * arrive via 'stream-token' events, completion via 'stream-complete'.
   * A 'routing-decision' event fires before streaming begins.
   * @param {{ messages: Array<{role:string,content:string}>, model: string, conversationId: string }} payload
   * @returns {Promise<void>}
   */
  sendChatMessage: (payload) => ipcRenderer.invoke('send-chat-message', payload),

  /**
   * Stops an active streaming response.
   * @returns {Promise<void>}
   */
  stopStream: () => ipcRenderer.invoke('stop-stream'),

  /**
   * Extracts plain text from a PDF buffer.
   * @param {number[]} buffer - PDF file as a plain number array
   * @returns {Promise<{ text: string }|{ error: string }>}
   */
  extractPdfText: (buffer) => ipcRenderer.invoke('extract-pdf-text', { buffer }),

  /**
   * Searches via local SearXNG at localhost:8080 and returns up to 5 results.
   * @param {string} query
   * @returns {Promise<{ results: Array }|{ error: string }>}
   */
  searchWeb: (query) => ipcRenderer.invoke('search-web', { query }),

  /**
   * Checks whether the local SearXNG Docker container is running.
   * @returns {Promise<{ running: boolean }>}
   */
  checkSearxngHealth: () => ipcRenderer.invoke('check-searxng-health'),

  /**
   * Starts the SearXNG Docker container.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  startSearxng: () => ipcRenderer.invoke('start-searxng'),

  /**
   * Pulls the latest SearXNG image and restarts the container.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  updateSearxng: () => ipcRenderer.invoke('update-searxng'),

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
   * Signals the main process that recording has started.
   * @returns {Promise<{ok: boolean}>}
   */
  startRecording: () => ipcRenderer.invoke('start-recording'),

  /**
   * Sends recorded WAV audio to the main process for Whisper transcription.
   * @param {number[]} audioData - WAV audio as a plain number array
   * @returns {Promise<{transcript: string}>}
   */
  stopRecording: (audioData) => ipcRenderer.invoke('stop-recording', { audioData }),

  /**
   * Synthesises text via Kokoro TTS and returns WAV audio bytes.
   * @param {string} text - Text to speak
   * @param {string} [voice='af_heart'] - Kokoro voice ID
   * @returns {Promise<{audioData: number[]}>} WAV audio as a plain number array
   */
  speakText: (text, voice = 'af_heart') =>
    ipcRenderer.invoke('speak-text', { text, voice }),

  /**
   * Toggles game mode. Stops all AI services when activating, restarts them when deactivating.
   * Result arrives via 'game-mode-changed' event.
   * @returns {Promise<{ gameModeActive: boolean }>}
   */
  toggleGameMode: () => ipcRenderer.invoke('toggle-game-mode'),

  /**
   * Returns the current game mode state.
   * @returns {Promise<{ gameModeActive: boolean }>}
   */
  getGameMode: () => ipcRenderer.invoke('get-game-mode'),

  /**
   * Returns the current install state manifest from electron-store.
   * Contains service and model install status, paths, and last-verified timestamps.
   * @returns {Promise<Object|null>}
   */
  getInstallManifest: () => ipcRenderer.invoke('get-install-manifest'),

  /**
   * Checks installed vs latest version for all managed services (Ollama).
   * @returns {Promise<{ ollama: { currentVersion: string|null, latestVersion: string|null, updateAvailable: boolean } }>}
   */
  checkServiceUpdates: () => ipcRenderer.invoke('check-service-updates'),

  /**
   * Downloads and installs the latest version of a service.
   * Progress arrives via 'service-update-progress', completion via 'service-update-complete',
   * errors via 'service-update-error'.
   * @param {string} service - e.g. 'ollama'
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  updateService: (service) => ipcRenderer.invoke('update-service', { service }),

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
