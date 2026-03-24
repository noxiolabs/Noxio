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
  'service-status',    // { service: string, status: string, pid: number|null }
  'stream-token',      // token: string
  'stream-complete',   // void
  'install-progress',  // { step: string, percent: number, message: string }
  'mode-ready',        // mode: string
  'vram-update',       // { usedGB: number, availableGB: number }
  'download-progress', // { model: string, percent: number }
  'image-progress',    // percent: number (0–100) — emitted during image generation
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
   * @param {InstallConfig} config
   * @returns {Promise<void>}
   */
  startInstallation: (config) => ipcRenderer.invoke('start-installation', config),

  /**
   * Returns all locally available Ollama models.
   * @returns {Promise<Array<{name: string, size: number, modifiedAt: string}>>}
   */
  listModels: () => ipcRenderer.invoke('list-models'),

  /**
   * Sends the full conversation messages array to the LLM. Response tokens
   * arrive via 'stream-token' events, completion via 'stream-complete'.
   * @param {Array<{role: string, content: string}>} messages - Full conversation history
   * @param {string} model
   * @param {string} conversationId
   * @returns {Promise<void>}
   */
  sendChatMessage: (messages, model, conversationId) =>
    ipcRenderer.invoke('send-chat-message', { messages, model, conversationId }),

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
