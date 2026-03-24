/**
 * @file ReadyScreen.jsx
 * @description Setup wizard — Screen 6. Confirms setup is complete and shows
 * current service health. The "Open Noxio" button dispatches completeSetup(),
 * which causes App.jsx to switch to the main application shell.
 */

import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { completeSetup } from '../../store/slices/settings';

const STATUS_COLORS = {
  running:  'bg-green-500',
  starting: 'bg-yellow-500 animate-pulse',
  stopped:  'bg-zinc-600',
  error:    'bg-red-500',
};

/**
 * Displays the service health dots at the bottom of the ready screen.
 */
function ServiceList() {
  const services = useSelector((state) => state.infrastructure.services);

  return (
    <div className="w-full max-w-xs bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-2">
      {Object.entries(services).map(([name, svc]) => (
        <div key={name} className="flex items-center justify-between text-sm">
          <span className="text-zinc-400 capitalize">{name}</span>
          <div className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[svc.status] ?? STATUS_COLORS.stopped}`}
            />
            <span className="text-zinc-600 text-xs">{svc.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ReadyScreen() {
  const dispatch = useDispatch();

  async function handleOpen() {
    // Persist setupComplete to electron-store first so the app skips the wizard on next launch.
    // Then update Redux so App.jsx switches to the main shell in this session.
    await window.electronAPI.completeSetup();
    dispatch(completeSetup());
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 text-center px-8">
      <div className="space-y-3">
        <div className="text-4xl text-violet-400 mb-2">✦</div>
        <h2 className="text-3xl font-bold text-white">Your AI is ready</h2>
        <p className="text-zinc-500 text-sm">Everything is running locally on your machine.</p>
      </div>

      <ServiceList />

      <button
        onClick={handleOpen}
        className="px-10 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors"
      >
        Open Noxio →
      </button>
    </div>
  );
}
