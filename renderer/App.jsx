/**
 * @file App.jsx
 * @description Root application component. Routes between the setup wizard and the
 * main app shell based on whether setup has been completed (settings.setupComplete).
 *
 * Phase 3: shows SetupWizard on first launch; shows a placeholder main shell after setup.
 * Phase 4: the placeholder is replaced with Sidebar + active panel + StatusBar.
 */

import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setHardware } from './store/slices/infrastructure';
import SetupWizard from './pages/Setup';

export default function App() {
  const dispatch = useDispatch();
  const setupComplete = useSelector((state) => state.settings.setupComplete);

  // Fetch hardware info and service statuses on mount so Redux is populated
  // regardless of whether the wizard or main app is shown.
  useEffect(() => {
    async function init() {
      if (!window.electronAPI) return;
      const [hw, statuses] = await Promise.all([
        window.electronAPI.getHardwareInfo(),
        window.electronAPI.getServiceStatuses(),
      ]);
      dispatch(setHardware(hw));
      Object.entries(statuses).forEach(([service, state]) => {
        dispatch({ type: 'infrastructure/updateServiceStatus', payload: { service, ...state } });
      });
    }
    init();
  }, [dispatch]);

  if (!setupComplete) {
    return <SetupWizard />;
  }

  // ── Main app shell — Phase 4 will replace this placeholder ────────────────
  return (
    <div className="flex flex-col h-screen bg-[#0f0f11] text-zinc-100">
      <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
        Main app — Phase 4
      </div>
    </div>
  );
}
