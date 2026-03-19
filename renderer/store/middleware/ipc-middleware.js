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
} from '../slices/infrastructure';
import { appendStreamToken, finaliseStream } from '../slices/chat';

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

  // install-progress and download-progress are handled directly by the wizard
  // component via one-time listeners, not Redux — no action needed here.
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
    if (channel) {
      window.electronAPI[channel]?.(...(args || []));
    }
  }
  return next(action);
};
