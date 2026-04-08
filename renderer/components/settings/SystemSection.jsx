/**
 * @file SystemSection.jsx
 * @description Settings section for system-level service management. Displays the
 * currently installed and latest available version of each managed service (Ollama)
 * and lets the user trigger an in-place update with a live progress bar — same
 * download-and-silent-install flow used by the setup wizard.
 *
 * Progress arrives via 'service-update-progress' IPC events.
 * Completion arrives via 'service-update-complete'.
 * Errors arrive via 'service-update-error'.
 */

import React, { useEffect, useState } from 'react';

const SERVICES = [
  { key: 'ollama', label: 'Ollama', description: 'Local LLM inference engine. Powers Chat and Code.' },
];

/**
 * @returns {JSX.Element}
 */
export default function SystemSection() {
  /** @type {[Record<string, {currentVersion:string|null,latestVersion:string|null,updateAvailable:boolean}>, Function]} */
  const [versions,   setVersions]   = useState({});
  const [checking,   setChecking]   = useState(false);
  const [checkError, setCheckError] = useState('');

  /** service key currently being updated, or null */
  const [updating,       setUpdating]       = useState(null);
  const [updatePercent,  setUpdatePercent]  = useState(0);
  const [updateMessage,  setUpdateMessage]  = useState('');
  const [updateError,    setUpdateError]    = useState('');
  const [updateDone,     setUpdateDone]     = useState(null); // service key just completed

  async function checkUpdates() {
    setChecking(true);
    setCheckError('');
    setUpdateDone(null);
    try {
      const result = await window.electronAPI?.checkServiceUpdates();
      if (result) {
        setVersions(result);
      }
    } catch (err) {
      setCheckError(`Check failed: ${err?.message ?? 'unknown error'}`);
    } finally {
      setChecking(false);
    }
  }

  // Check on mount
  useEffect(() => {
    checkUpdates();
  }, []);

  async function handleUpdate(serviceKey) {
    setUpdating(serviceKey);
    setUpdatePercent(0);
    setUpdateMessage('Starting...');
    setUpdateError('');
    setUpdateDone(null);

    function onProgress({ service, percent, message }) {
      if (service !== serviceKey) return;
      setUpdatePercent(percent ?? 0);
      setUpdateMessage(message ?? '');
    }
    function onComplete({ service }) {
      if (service !== serviceKey) return;
      setUpdating(null);
      setUpdateDone(serviceKey);
      // Re-check versions so the UI reflects the new version
      checkUpdates();
      cleanup();
    }
    function onError({ service, error }) {
      if (service !== serviceKey) return;
      setUpdating(null);
      setUpdateError(`Update failed: ${error ?? 'unknown error'}`);
      cleanup();
    }
    function cleanup() {
      window.electronAPI?.off('service-update-progress', onProgress);
      window.electronAPI?.off('service-update-complete', onComplete);
      window.electronAPI?.off('service-update-error', onError);
    }

    window.electronAPI?.on('service-update-progress', onProgress);
    window.electronAPI?.on('service-update-complete', onComplete);
    window.electronAPI?.on('service-update-error', onError);

    try {
      await window.electronAPI?.updateService(serviceKey);
    } catch (err) {
      // updateService invoke doesn't rethrow — this is a fallback
      setUpdating(null);
      setUpdateError(`Update failed: ${err?.message ?? 'unknown error'}`);
      cleanup();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-white mb-1">System</h2>
          <p className="text-xs text-zinc-500">
            Check for and install updates to local AI services.
          </p>
        </div>
        <button
          onClick={checkUpdates}
          disabled={checking || !!updating}
          title="Check for updates"
          className="mt-0.5 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-40"
        >
          <RefreshIcon spinning={checking} />
        </button>
      </div>

      {checkError && (
        <p className="text-xs text-red-400">{checkError}</p>
      )}

      <div className="flex flex-col gap-3">
        {SERVICES.map(({ key, label, description }) => {
          const info = versions[key];
          const isUpdating = updating === key;
          const justDone   = updateDone === key;

          return (
            <div
              key={key}
              className="rounded-lg bg-zinc-800 border border-zinc-700/60 p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-100">{label}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{description}</p>

                  {info && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                      <span>
                        Installed:{' '}
                        <span className="text-zinc-200 font-mono">
                          {info.currentVersion ?? '—'}
                        </span>
                      </span>
                      <span>
                        Latest:{' '}
                        <span className="text-zinc-200 font-mono">
                          {info.latestVersion ?? '—'}
                        </span>
                      </span>
                    </div>
                  )}
                  {!info && !checking && (
                    <p className="mt-1.5 text-xs text-zinc-600">Click refresh to check versions.</p>
                  )}
                </div>

                <div className="flex-shrink-0">
                  {justDone ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                      Updated
                    </span>
                  ) : info?.updateAvailable && !isUpdating ? (
                    <button
                      onClick={() => handleUpdate(key)}
                      disabled={!!updating || checking}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      Update
                    </button>
                  ) : info && !info.updateAvailable && !isUpdating ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-zinc-700 text-zinc-400 font-medium">
                      Up to date
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Update progress bar */}
              {isUpdating && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>{updateMessage}</span>
                    <span>{updatePercent}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all duration-300"
                      style={{ width: `${updatePercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Per-service error */}
              {updateError && !isUpdating && updateDone !== key && (
                <p className="text-xs text-red-400">{updateError}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
