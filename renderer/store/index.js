/**
 * @file index.js
 * @description Redux store configuration. Combines all slices and applies the
 * IPC middleware. Also exports setupIpcListeners so index.jsx can wire up
 * main→renderer event handling before the app first renders.
 */

import { configureStore } from '@reduxjs/toolkit';
import infrastructureReducer from './slices/infrastructure';
import chatReducer from './slices/chat';
import createReducer from './slices/create';
import voiceReducer from './slices/voice';
import settingsReducer from './slices/settings';
import { ipcMiddleware } from './middleware/ipc-middleware';

export const store = configureStore({
  reducer: {
    infrastructure: infrastructureReducer,
    chat: chatReducer,
    create: createReducer,
    voice: voiceReducer,
    settings: settingsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // Allow non-serializable values in IPC meta fields
      serializableCheck: {
        ignoredActionPaths: ['meta.ipc', 'meta.channel', 'meta.args'],
      },
    }).concat(ipcMiddleware),
});

export { setupIpcListeners } from './middleware/ipc-middleware';
