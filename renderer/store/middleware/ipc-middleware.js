/**
 * @file ipc-middleware.js
 * @description Redux middleware that bridges IPC events from the Electron main
 * process into Redux actions, and forwards specific Redux actions to the main
 * process via IPC invoke.
 *
 * Two responsibilities:
 *   1. setupIpcListeners(store) — subscribes to all main→renderer IPC events and
 *      dispatches the corresponding Redux actions. Called once at app startup.
 *   2. ipcMiddleware — intercepts Redux actions tagged with `meta.ipc = true`
 *      and forwards them to main via window.electronAPI.
 */

import {
  updateServiceStatus,
  updateVram,
  setCurrentMode,
  setLastRouting,
} from '../slices/infrastructure';
import { appendStreamToken, appendThinkingToken, finaliseStream, hydrateConversations, setSelectedModel } from '../slices/chat';
import { setManifest } from '../slices/manifest';
import { setPullProgress, clearPullProgress, hydrateSettings, updateChatSettings, updateVoiceSettings, updateUI, setGameMode } from '../slices/settings';

/**
 * Sets up all main→renderer IPC event listeners and wires them to Redux actions.
 * Must be called once after the Redux store is created, before the app renders.
 *
 * @param {import('@reduxjs/toolkit').EnhancedStore} store
 */
export function setupIpcListeners(store) {
  const api = window.electronAPI;
  if (!api) {
    // Will be undefined in browser-only test environments
    return;
  }

  /** service-status → infrastructure.updateServiceStatus */
  api.on('service-status', (data) => {
    store.dispatch(updateServiceStatus(data));
  });

  /** stream-token → chat.appendStreamToken */
  api.on('stream-token', (token) => {
    store.dispatch(appendStreamToken(token));
  });

  /** stream-thinking → chat.appendThinkingToken (native Ollama think API) */
  api.on('stream-thinking', (token) => {
    store.dispatch(appendThinkingToken(token));
  });

  /** stream-complete → chat.finaliseStream */
  api.on('stream-complete', () => {
    store.dispatch(finaliseStream());
  });

  /** vram-update → infrastructure.updateVram */
  api.on('vram-update', (data) => {
    store.dispatch(updateVram(data));
  });

  /** mode-ready → infrastructure.setCurrentMode */
  api.on('mode-ready', (mode) => {
    store.dispatch(setCurrentMode(mode));
  });

  /**
   * routing-decision → infrastructure.setLastRouting
   * Emitted by the main process at the start of each chat stream with
   * { provider, model, conversationId }. Only provider and model are needed here.
   */
  api.on('routing-decision', ({ provider, model } = {}) => {
    store.dispatch(setLastRouting({ provider, model }));
  });

  /** manifest-verified → manifest.setManifest */
  api.on('manifest-verified', (data) => {
    if (data) store.dispatch(setManifest(data));
  });

  /**
   * model-pull-progress → settings.setPullProgress
   * Emitted periodically during an Ollama model pull with { model, percent }.
   */
  api.on('model-pull-progress', (data) => {
    if (data) store.dispatch(setPullProgress(data));
  });

  /**
   * model-pull-complete → settings.clearPullProgress
   * Emitted when a pull finishes successfully. Clears transient pull state.
   * The ModelsSection component is responsible for refreshing its model list.
   */
  api.on('model-pull-complete', () => {
    store.dispatch(clearPullProgress());
  });

  /**
   * model-pull-error → settings.clearPullProgress
   * Emitted when a pull fails. Clears transient pull state so the UI unblocks.
   * The ModelsSection component surfaces the error via its own local state.
   */
  api.on('model-pull-error', () => {
    store.dispatch(clearPullProgress());
  });

  /**
   * game-mode-changed → settings.setGameMode
   * Emitted by the main process when game mode is toggled (via UI or tray menu).
   */
  api.on('game-mode-changed', (active) => {
    store.dispatch(setGameMode(active));
  });

  // install-progress and download-progress are handled directly by the wizard
  // component via one-time listeners, not Redux — no action needed here.

  // ─── Game mode initial state ─────────────────────────────────────────────

  // Game mode always starts as false on app launch (services restart fresh each time)
  // No need to load from main process — default false is correct.

  // ─── Conversation persistence (C3) ───────────────────────────────────────

  // Load persisted conversations once on app startup
  api.loadChatHistory().then((data) => {
    if (data?.conversations?.length) {
      store.dispatch(hydrateConversations(data.conversations));
    }
  }).catch(() => {
    // Non-fatal — start with empty conversation list
  });

  // Save conversations to disk whenever chat state changes, debounced 500ms
  let _saveChatTimer = null;
  let _lastSavedConversations = null;
  store.subscribe(() => {
    const conversations = store.getState().chat.conversations;
    if (conversations === _lastSavedConversations) return;
    _lastSavedConversations = conversations;
    clearTimeout(_saveChatTimer);
    _saveChatTimer = setTimeout(() => {
      api.saveChatHistory({ conversations }).catch(() => {});
    }, 500);
  });

  // ─── Settings persistence ────────────────────────────────────────────────

  // Load persisted settings once on app startup
  api.getSettings().then((data) => {
    if (data && typeof data === 'object' && !data.error) {
      store.dispatch(hydrateSettings(data));
      if (data.models?.chat) {
        store.dispatch(setSelectedModel(data.models.chat));
      }
    }
  }).catch(() => {
    // Non-fatal — defaults are already in initialState
  });

  // Save settings to disk whenever they change, debounced 500ms
  // Only persists user-configurable settings: chat, voice, ui, models, selectedCapabilities
  // Excludes transient/setup state: _settingsPanel, setupComplete, servicePaths, installedServices, installDir
  let _saveSettingsTimer = null;
  let _lastSavedSettings = null;
  store.subscribe(() => {
    const settings = store.getState().settings;
    // Only track user-configurable settings, not transient state
    const settingsToSave = {
      chat: settings.chat,
      voice: settings.voice,
      ui: settings.ui,
      models: settings.models,
      selectedCapabilities: settings.selectedCapabilities,
    };
    const settingsJson = JSON.stringify(settingsToSave);
    if (settingsJson === _lastSavedSettings) return;
    _lastSavedSettings = settingsJson;
    clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = setTimeout(() => {
      // Save chat and voice via their dedicated handlers, which validate and persist
      if (settings.chat) {
        api.saveChatSettings(settings.chat.contextWindow, settings.chat.systemPrompt).catch(() => {});
      }
      if (settings.voice) {
        api.saveVoiceSettings(settings.voice.sttLanguage, settings.voice.ttsVoice).catch(() => {});
      }
      if (settings.ui) {
        api.saveUiSettings(settings.ui.theme, settings.ui.fontSize).catch(() => {});
      }
    }, 500);
  });
}

/**
 * Redux middleware that forwards actions with `meta.ipc = true` to the main
 * process via window.electronAPI. The action still passes through to Redux
 * normally — IPC is fire-and-forget from the middleware's perspective; responses
 * come back as IPC events handled by setupIpcListeners.
 *
 * Example usage in a component:
 *   dispatch({ type: 'ipc/switchMode', payload: 'create', meta: { ipc: true } })
 *
 * @param {import('@reduxjs/toolkit').MiddlewareAPI} _api
 */
export const ipcMiddleware = (_api) => (next) => (action) => {
  if (action?.meta?.ipc && window.electronAPI) {
    const { channel, args } = action.meta;
    if (!channel) {
      // Programmer error — flag it clearly rather than silently discarding the call
      console.error(`ipcMiddleware: action "${action.type}" has meta.ipc=true but no channel specified`);
    } else {
      window.electronAPI[channel]?.(...(args || []));
    }
  }
  return next(action);
};
