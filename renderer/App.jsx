/**
 * @file App.jsx
 * @description Root application component. Handles top-level routing between the
 * setup wizard and the main app shell. On first launch (setupComplete = false),
 * shows the Setup wizard. Once complete, shows the main layout with Sidebar and
 * the active panel.
 *
 * Phase 1: renders a shell confirmation screen.
 * Phase 3: wire in React Router + Setup wizard pages.
 * Phase 4: wire in Chat, Create, Voice, Agent panels + Sidebar + StatusBar.
 */

import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setHardware } from './store/slices/infrastructure';

/**
 * Minimal status dot shown for each service in the Phase 1 shell.
 */
function ServiceDot({ status }) {
  const colors = {
    running:  'bg-green-500',
    starting: 'bg-yellow-500 animate-pulse',
    stopped:  'bg-zinc-600',
    error:    'bg-red-500',
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || colors.stopped}`} />
  );
}

export default function App() {
  const dispatch = useDispatch();
  const services = useSelector((state) => state.infrastructure.services);
  const hardware = useSelector((state) => state.infrastructure.hardware);

  // On mount: fetch hardware info and service statuses from main process
  useEffect(() => {
    async function init() {
      if (!window.electronAPI) return;
      const [hw, statuses] = await Promise.all([
        window.electronAPI.getHardwareInfo(),
        window.electronAPI.getServiceStatuses(),
      ]);
      dispatch(setHardware(hw));
      // Service statuses come back as a map — dispatch individual updates
      // (health-checker will take over in Phase 2, this is just for startup)
      Object.entries(statuses).forEach(([service, state]) => {
        dispatch({ type: 'infrastructure/updateServiceStatus', payload: { service, ...state } });
      });
    }
    init();
  }, [dispatch]);

  return (
    <div className="flex flex-col h-screen bg-[#0f0f11] text-zinc-100">
      {/* Phase 1 shell — replaced with full layout in Phase 4 */}
      <div className="flex flex-col items-center justify-center h-full gap-8">

        {/* Wordmark */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white">Noxio</h1>
          <p className="mt-1 text-sm text-zinc-500">Your personal AI. Runs locally.</p>
        </div>

        {/* Phase badge */}
        <div className="px-3 py-1 rounded-full bg-violet-600/20 border border-violet-600/40 text-violet-400 text-xs font-medium">
          Phase 1 — Electron Shell ✓
        </div>

        {/* Hardware summary */}
        {hardware && (
          <div className="text-xs text-zinc-500 text-center space-y-1">
            <p>GPU: {hardware.gpu?.name ?? 'Unknown'}</p>
            <p>VRAM: {((hardware.gpu?.vramTotalMB ?? 0) / 1024).toFixed(1)}GB &nbsp;·&nbsp; RAM: {((hardware.ram?.totalMB ?? 0) / 1024).toFixed(0)}GB</p>
          </div>
        )}

        {/* Service status dots */}
        <div className="flex flex-col gap-2 text-xs text-zinc-400">
          {Object.entries(services).map(([name, svc]) => (
            <div key={name} className="flex items-center gap-2">
              <ServiceDot status={svc.status} />
              <span className="capitalize w-16">{name}</span>
              <span className="text-zinc-600">{svc.status}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-zinc-700 mt-4">
          IPC bridge active · Redux store loaded · Build continues in Phase 2
        </p>
      </div>
    </div>
  );
}
