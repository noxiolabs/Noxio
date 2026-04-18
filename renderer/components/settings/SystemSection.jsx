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
import { useSelector } from 'react-redux';

const SERVICES = [
  { key: 'ollama', label: 'Ollama', description: 'Local LLM inference engine. Powers Chat and Code.' },
];

/**
 * @returns {JSX.Element}
 */
export default function SystemSection() {
  const selectedCapabilities = useSelector((s) => s.settings.selectedCapabilities);
  const hasWebSearch = selectedCapabilities?.includes('web-search');
  /** @type {[Record<string, {currentVersion:string|null,latestVersion:string|null,updateAvailable:boolean}>, Function]} */
  const [versions,   setVersions]   = useState({});
  const [checking,   setChecking]   = useState(false);
  const [checkError, setCheckError] = useState('');

  // SearXNG-specific state
  const [searxngRunning,  setSearxngRunning]  = useState(null); // null=unknown, true/false
  const [searxngAction,   setSearxngAction]   = useState(null); // 'starting' | 'updating' | null
  const [searxngError,    setSearxngError]    = useState('');

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
      const [result] = await Promise.all([
        window.electronAPI?.checkServiceUpdates(),
        hasWebSearch ? checkSearxng() : Promise.resolve(),
      ]);
      if (result) {
        setVersions(result);
      }
    } catch (err) {
      setCheckError(`Check failed: ${err?.message ?? 'unknown error'}`);
    } finally {
      setChecking(false);
    }
  }

  async function checkSearxng() {
    try {
      const res = await window.electronAPI?.checkSearxngHealth?.();
      setSearxngRunning(res?.running ?? false);
    } catch {
      setSearxngRunning(false);
    }
  }

  async function handleStartSearxng() {
    setSearxngAction('starting');
    setSearxngError('');
    try {
      const result = await window.electronAPI?.startSearxng?.();
      if (result?.success) {
        setSearxngRunning(true);
      } else {
        setSearxngError(result?.error ?? 'Failed to start SearXNG');
      }
    } catch (err) {
      setSearxngError(err?.message ?? 'Failed to start SearXNG');
    } finally {
      setSearxngAction(null);
    }
  }

  async function handleUpdateSearxng() {
    setSearxngAction('updating');
    setSearxngError('');
    try {
      const result = await window.electronAPI?.updateSearxng?.();
      if (result?.success) {
        setSearxngRunning(true);
      } else {
        setSearxngError(result?.error ?? 'Update failed');
      }
    } catch (err) {
      setSearxngError(err?.message ?? 'Update failed');
    } finally {
      setSearxngAction(null);
    }
  }

  // Check on mount
  useEffect(() => {
    checkUpdates();
    if (hasWebSearch) checkSearxng();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          <h2 className="text-base font-semibold text-fg mb-1">System</h2>
          <p className="text-xs text-fg-dim">
            Check for and install updates to local AI services.
          </p>
        </div>
        <button
          onClick={checkUpdates}
          disabled={checking || !!updating}
          title="Check for updates"
          className="mt-0.5 p-1.5 rounded-lg text-fg-dim hover:text-fg hover:bg-card transition-colors disabled:opacity-40"
        >
          <RefreshIcon spinning={checking} />
        </button>
      </div>

      {checkError && (
        <p className="text-xs text-red-400">{checkError}</p>
      )}

      <div className="flex flex-col gap-3">
        {/* SearXNG card — only shown when web-search capability is installed */}
        {hasWebSearch && (
          <div className="rounded-lg bg-card border border-stroke/60 p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-fg">SearXNG</p>
                <p className="text-xs text-fg-dim mt-0.5">
                  Self-hosted web search engine. Runs via Docker on port 8080.
                </p>
                <div className="mt-2 flex items-center gap-1.5 text-xs">
                  {searxngRunning === null ? (
                    <span className="text-fg-dim">Checking status…</span>
                  ) : searxngRunning ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                      <span className="text-emerald-400">Running on port 8080</span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                      <span className="text-red-400">Not running</span>
                    </>
                  )}
                </div>
                {searxngError && (
                  <p className="mt-1.5 text-xs text-red-400">{searxngError}</p>
                )}
                {searxngAction && (
                  <p className="mt-1.5 text-xs text-fg-muted animate-pulse">
                    {searxngAction === 'starting' ? 'Starting container…' : 'Pulling latest image and restarting…'}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0 flex gap-2">
                {!searxngRunning && searxngRunning !== null && (
                  <button
                    onClick={handleStartSearxng}
                    disabled={!!searxngAction || !!updating}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    {searxngAction === 'starting' ? 'Starting…' : 'Start'}
                  </button>
                )}
                {searxngRunning && (
                  <button
                    onClick={handleUpdateSearxng}
                    disabled={!!searxngAction || !!updating}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-raise hover:bg-raise/80 disabled:opacity-40 disabled:cursor-not-allowed text-fg transition-colors"
                  >
                    {searxngAction === 'updating' ? 'Updating…' : 'Update'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {SERVICES.map(({ key, label, description }) => {
          const info = versions[key];
          const isUpdating = updating === key;
          const justDone   = updateDone === key;

          return (
            <div
              key={key}
              className="rounded-lg bg-card border border-stroke/60 p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg">{label}</p>
                  <p className="text-xs text-fg-dim mt-0.5">{description}</p>

                  {info && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                      <span>
                        Installed:{' '}
                        <span className="text-fg font-mono">
                          {info.currentVersion ?? '—'}
                        </span>
                      </span>
                      <span>
                        Latest:{' '}
                        <span className="text-fg font-mono">
                          {info.latestVersion ?? '—'}
                        </span>
                      </span>
                    </div>
                  )}
                  {!info && !checking && (
                    <p className="mt-1.5 text-xs text-fg-faint">Click refresh to check versions.</p>
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
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      Update
                    </button>
                  ) : info && !info.updateAvailable && !isUpdating ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-raise text-fg-muted font-medium">
                      Up to date
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Update progress bar */}
              {isUpdating && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-fg-muted">
                    <span>{updateMessage}</span>
                    <span>{updatePercent}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-raise overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-300"
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
