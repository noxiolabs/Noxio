/**
 * @file App.jsx
 * @description Root application component. Routes between the setup wizard
 * (setupComplete = false) and the main app shell (setupComplete = true).
 *
 * Main shell layout:
 *   [Sidebar 60px] | [Active panel flex-1]
 *   [StatusBar 32px — full width]
 *
 * Chat and Create panels are live. Voice and Agent are coming in a future release.
 */

import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setHardware } from './store/slices/infrastructure';
import SetupWizard from './pages/Setup';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import ChatPanel from './pages/Chat';
import CreatePanel from './pages/Create';
import ErrorBoundary from './components/ErrorBoundary';
import SettingsOverlay from './components/SettingsOverlay';

/** Placeholder shown for panels not yet released. */
function ComingSoon({ label, description }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
      <p className="text-zinc-400 font-medium">{label}</p>
      <p className="text-zinc-600 text-sm max-w-xs">{description ?? 'Coming in a future release'}</p>
    </div>
  );
}

export default function App() {
  const dispatch = useDispatch();
  const setupComplete = useSelector((s) => s.settings.setupComplete);
  const [activeMode, setActiveMode] = useState('chat');

  /**
   * Handles a mode change from the Sidebar. Invokes the IPC switch-mode channel
   * so the main process can handle VRAM orchestration before the UI switches over.
   * The mode-ready event (handled by ipc-middleware → setCurrentMode) confirms the
   * switch completed on the backend. We update the UI immediately for responsiveness —
   * the StatusBar health dots will surface any backend issues.
   *
   * @param {string} newMode
   */
  function handleModeChange(newMode) {
    if (newMode === activeMode) return;
    if (window.electronAPI) {
      window.electronAPI.switchMode(newMode, activeMode);
    }
    setActiveMode(newMode);
  }

  useEffect(() => {
    async function init() {
      if (!window.electronAPI) return;
      const [hw, statuses] = await Promise.all([
        window.electronAPI.getHardwareInfo(),
        window.electronAPI.getServiceStatuses(),
      ]);
      // Only dispatch hardware if the main process returned a valid result.
      // handlers.js returns { error: string } on failure — don't store that
      // shape in the infrastructure slice.
      if (hw && !hw.error) {
        dispatch(setHardware(hw));
      }
      if (statuses && !statuses.error) {
        Object.entries(statuses).forEach(([service, state]) => {
          dispatch({ type: 'infrastructure/updateServiceStatus', payload: { service, ...state } });
        });
      }
    }
    init();
  }, [dispatch]);

  if (!setupComplete) {
    return (
      <ErrorBoundary>
        <SetupWizard />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-[#0f0f11] text-zinc-100 overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          <Sidebar activeMode={activeMode} onModeChange={handleModeChange} />

          <main className="flex-1 overflow-hidden">
            {activeMode === 'chat'   && <ErrorBoundary panel><ChatPanel /></ErrorBoundary>}
            {activeMode === 'create' && <ErrorBoundary panel><CreatePanel /></ErrorBoundary>}
            {activeMode === 'voice'  && <ComingSoon label="Voice" description="Voice input and output are coming in a future release." />}
            {activeMode === 'agent'  && <ComingSoon label="Agent" description="Agent automation is coming in a future release." />}
          </main>
        </div>

        <StatusBar />
      </div>

      {/* Settings overlay — sits above the full app shell */}
      <SettingsOverlay />
    </ErrorBoundary>
  );
}
