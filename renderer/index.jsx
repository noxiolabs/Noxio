/**
 * @file index.jsx
 * @description React app entry point. Sets up the Redux Provider, wires IPC
 * event listeners to the store, and mounts the root App component.
 * Must be kept minimal — all logic belongs in App.jsx or child components.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store, setupIpcListeners } from './store';
import App from './App';
import './index.css';

// Wire main→renderer IPC events to Redux before first render
setupIpcListeners(store);

const root = createRoot(document.getElementById('root'));
root.render(
  <Provider store={store}>
    <App />
  </Provider>
);
