/**
 * @file InstallingScreen.jsx
 * @description Setup wizard — Screen 5. Triggers the installation via IPC and
 * displays a progress bar with step messages streamed from 'install-progress' events.
 * Advances to the next screen automatically on completion.
 */

import React, { useEffect, useState, useRef } from 'react';

/**
 * @param {{
 *   capabilities: string[],
 *   models: Object,
 *   onDone: () => void,
 * }} props
 */
export default function InstallingScreen({ capabilities, models, onDone }) {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Starting...');
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    function handleProgress({ step, percent, message: msg }) {
      setProgress(percent);
      setMessage(msg);
      if (step === 'complete') {
        setTimeout(onDone, 900);
      }
      if (step === 'error') {
        setError(msg);
      }
    }

    window.electronAPI.on('install-progress', handleProgress);

    window.electronAPI.startInstallation({ capabilities, models }).catch((err) => {
      setError(err.message ?? 'Installation failed');
    });

    return () => {
      window.electronAPI.off('install-progress', handleProgress);
    };
  }, [capabilities, models, onDone]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center">
        <div className="text-3xl text-yellow-500">⚠</div>
        <div className="space-y-1">
          <p className="text-white font-medium">Installation failed</p>
          <p className="text-zinc-500 text-sm">{error}</p>
        </div>
        <p className="text-xs text-zinc-600 max-w-xs">
          Make sure Ollama is installed and running, then restart Noxio to try again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-8 text-center">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold text-white">Setting things up</h2>
        <p className="text-zinc-500 text-sm">This may take a while depending on your connection.</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-violet-600 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-sm text-zinc-400">{message}</p>
        <p className="text-xs text-zinc-600">{progress}% complete</p>
      </div>

      <div className="w-5 h-5 border-2 border-violet-600/40 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );
}
