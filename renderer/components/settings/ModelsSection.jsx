/**
 * @file ModelsSection.jsx
 * @description Settings section for model management. Lists installed Ollama
 * models from the install manifest, allows deletion, and lets the user pull
 * new models by name. Also shows installed/not-installed status for all services.
 *
 * Pull progress is driven by the 'model-pull-progress' IPC event, which the
 * ipc-middleware wires into settings._settingsPanel.pullInProgress / pullPercent.
 */

import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setPullProgress, setHfToken } from '../../store/slices/settings';

/**
 * @returns {JSX.Element}
 */
export default function ModelsSection() {
  const dispatch       = useDispatch();
  const pullInProgress = useSelector((s) => s.settings._settingsPanel.pullInProgress);
  const pullPercent    = useSelector((s) => s.settings._settingsPanel.pullPercent);
  // Live service statuses from health checker — always accurate, no manifest needed
  const liveServices   = useSelector((s) => s.infrastructure.services);
  const ollamaStatus   = useSelector((s) => s.infrastructure.services?.ollama?.status);

  const storedHfToken = useSelector((s) => s.settings.hfToken ?? '');
  const [hfTokenInput, setHfTokenInput] = useState(storedHfToken);
  const [hfSaving,     setHfSaving]     = useState(false);
  const [hfSaved,      setHfSaved]      = useState(false);
  const [hfError,      setHfError]      = useState('');

  const [models,        setModels]        = useState([]);
  const [pullInput,     setPullInput]     = useState('');
  const [pullError,     setPullError]     = useState('');
  const [deleteError,   setDeleteError]   = useState('');
  const [loading,       setLoading]       = useState(true);
  const [deletingModel, setDeletingModel] = useState(null);

  // Image model reinstall state
  const [imageModelId,       setImageModelId]       = useState(null);
  const [reinstalling,       setReinstalling]       = useState(false);
  const [reinstallPercent,   setReinstallPercent]   = useState(0);
  const [reinstallMessage,   setReinstallMessage]   = useState('');
  const [reinstallError,     setReinstallError]     = useState('');
  const [reinstallDone,      setReinstallDone]      = useState(false);

  async function handleSaveHfToken() {
    setHfSaving(true);
    setHfError('');
    setHfSaved(false);
    try {
      await window.electronAPI?.saveHfToken(hfTokenInput.trim());
      dispatch(setHfToken(hfTokenInput.trim()));
      setHfSaved(true);
      setTimeout(() => setHfSaved(false), 2000);
    } catch (err) {
      setHfError(err?.message ?? 'Save failed');
    } finally {
      setHfSaving(false);
    }
  }

  /** Fetches models directly from Ollama (live list). */
  async function loadManifest() {
    setLoading(true);
    try {
      // Use live Ollama list as the authoritative model source — the manifest only
      // tracks models installed through the wizard, so pre-existing installs won't
      // appear there. listModels() queries Ollama directly and always reflects reality.
      const liveModels = await window.electronAPI?.listModels().catch(() => []);

      const ollamaModels = (liveModels ?? []).map((m) => {
        // m may be a string tag or an object { name, size }
        const modelId = typeof m === 'string' ? m : (m.name ?? String(m));
        const sizeGB   = typeof m === 'object' && m.size
          ? (m.size / 1e9).toFixed(1)
          : null;
        return { modelId, sizeGB };
      });

      setModels(ollamaModels);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadManifest();
  }, []);

  // Refresh model list once a pull completes (pullInProgress transitions to null)
  const prevPullRef = React.useRef(pullInProgress);
  useEffect(() => {
    if (prevPullRef.current !== null && pullInProgress === null) {
      loadManifest();
    }
    prevPullRef.current = pullInProgress;
  }, [pullInProgress]);

  // Auto-refresh model list when Ollama transitions to 'running' — covers the case where
  // Ollama was still starting when the settings panel was opened and the list came back empty.
  const prevOllamaRef = React.useRef(ollamaStatus);
  useEffect(() => {
    if (prevOllamaRef.current !== 'running' && ollamaStatus === 'running') {
      loadManifest();
    }
    prevOllamaRef.current = ollamaStatus;
  }, [ollamaStatus]);

  // Show pull errors surfaced via IPC event (the pull-model invoke doesn't rethrow)
  // Payload is { model, error } — note: key is 'error', not 'message'
  useEffect(() => {
    function onPullError({ error }) {
      setPullError(`Pull failed: ${error ?? 'unknown error'}`);
    }
    window.electronAPI?.on('model-pull-error', onPullError);
    return () => window.electronAPI?.off('model-pull-error', onPullError);
  }, []);

  // Load the persisted image model ID from settings
  useEffect(() => {
    window.electronAPI?.getSettings?.().then((s) => {
      setImageModelId(s?.models?.image ?? null);
    }).catch(() => {});
  }, []);

  // Wire reinstall progress events
  useEffect(() => {
    function onProgress({ percent, message }) {
      setReinstallPercent(percent);
      setReinstallMessage(message ?? '');
    }
    window.electronAPI?.on('image-model-reinstall-progress', onProgress);
    return () => window.electronAPI?.off('image-model-reinstall-progress', onProgress);
  }, []);

  async function handleReinstallImageModel() {
    setReinstalling(true);
    setReinstallError('');
    setReinstallDone(false);
    setReinstallPercent(0);
    setReinstallMessage('Starting download…');
    try {
      const result = await window.electronAPI?.reinstallImageModel();
      if (result?.success === false) {
        setReinstallError(result.error ?? 'Reinstall failed');
      } else {
        setReinstallDone(true);
        setTimeout(() => setReinstallDone(false), 3000);
      }
    } catch (err) {
      setReinstallError(err?.message ?? 'Reinstall failed');
    } finally {
      setReinstalling(false);
    }
  }

  /** Sends a delete-model IPC request and refreshes the list on success. */
  async function handleDelete(modelId) {
    setDeleteError('');
    setDeletingModel(modelId);
    try {
      const result = await window.electronAPI?.deleteModel(modelId);
      if (result && !result.success) {
        setDeleteError(`Failed to delete ${modelId}: ${result.error ?? 'unknown error'}`);
      } else {
        // Pre-fill the pull input so the user can re-download with one click
        setPullInput(modelId);
        await loadManifest();
      }
    } catch (err) {
      setDeleteError(`Failed to delete ${modelId}: ${err?.message ?? 'unknown error'}`);
    } finally {
      setDeletingModel(null);
    }
  }

  /** Initiates a model pull. Progress arrives via IPC events → Redux. */
  async function handlePull() {
    const modelName = pullInput.trim();
    if (!modelName || pullInProgress) return;
    setPullError('');
    // Show the bar immediately — don't wait for the first IPC event
    dispatch(setPullProgress({ model: modelName, percent: 0 }));
    try {
      await window.electronAPI?.pullModel(modelName);
      setPullInput('');
    } catch (err) {
      // pull-model invoke doesn't rethrow; this is a fallback
      setPullError(`Pull failed: ${err?.message ?? 'unknown error'}`);
    }
  }

  function handlePullKeyDown(e) {
    if (e.key === 'Enter') handlePull();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Image model — reinstall companion files if missing */}
      {imageModelId && (
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-fg mb-1">Image Model</h2>
          <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-card border border-stroke/60">
            <span className="text-sm text-fg font-medium">{imageModelId}</span>
            <button
              onClick={handleReinstallImageModel}
              disabled={reinstalling}
              className="text-xs text-violet-400 hover:text-violet-300 transition-colors px-2 py-1 rounded hover:bg-violet-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {reinstalling ? 'Downloading…' : 'Reinstall'}
            </button>
          </div>
          {reinstalling && (
            <div className="mt-1">
              <div className="flex justify-between text-xs text-fg-muted mb-1">
                <span className="truncate">{reinstallMessage}</span>
                <span className="flex-shrink-0 ml-2">{reinstallPercent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-card overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${reinstallPercent}%` }}
                />
              </div>
            </div>
          )}
          {reinstallDone && <p className="text-xs text-emerald-400">Download complete</p>}
          {reinstallError && <p className="text-xs text-red-400">{reinstallError}</p>}
        </div>
      )}

      {/* HuggingFace token — required for gated models like FLUX.2 Klein */}
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-fg mb-1">HuggingFace Access Token</h2>
        <p className="text-xs text-fg-dim">
          Required to download gated models (e.g. FLUX.2 Klein). Get yours at{' '}
          <span className="text-fg-dim font-mono">huggingface.co/settings/tokens</span>.
        </p>
        <input
          type="password"
          value={hfTokenInput}
          onChange={(e) => setHfTokenInput(e.target.value)}
          placeholder="hf_••••••••••••••••••••••••••••••••••••"
          className="bg-card border border-stroke rounded-lg px-3 py-2 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent font-mono"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveHfToken}
            disabled={hfSaving}
            className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent/80 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {hfSaving ? 'Saving…' : 'Save token'}
          </button>
          {hfSaved && <span className="text-xs text-emerald-400">Saved</span>}
          {hfError && <span className="text-xs text-red-400">{hfError}</span>}
        </div>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-fg mb-1">Installed Models</h2>
          <p className="text-xs text-fg-dim">
            Ollama models installed on this machine. Delete to free disk space.
          </p>
        </div>
        <button
          onClick={loadManifest}
          disabled={loading}
          title="Refresh model list"
          className="mt-0.5 p-1.5 rounded-lg text-fg-dim hover:text-fg hover:bg-card transition-colors disabled:opacity-40"
        >
          <RefreshIcon spinning={loading} />
        </button>
      </div>

      {/* Model list */}
      <div className="flex flex-col gap-2">
        {loading && (
          <p className="text-sm text-fg-dim">Loading…</p>
        )}
        {!loading && models.length === 0 && (
          <p className="text-sm text-fg-dim">No Ollama models found.</p>
        )}
        {models.map(({ modelId, sizeGB }) => (
          <div
            key={modelId}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-card border border-stroke/60"
          >
            <div>
              <span className="text-sm text-fg font-medium">{modelId}</span>
              {sizeGB != null && (
                <span className="ml-2 text-xs text-fg-dim">{sizeGB} GB</span>
              )}
            </div>
            <button
              onClick={() => handleDelete(modelId)}
              disabled={deletingModel === modelId || !!pullInProgress}
              className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deletingModel === modelId ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        ))}
        {deleteError && (
          <p className="text-xs text-red-400 mt-1">{deleteError}</p>
        )}
      </div>

      {/* Pull new model */}
      <div>
        <h3 className="text-sm font-semibold text-fg mb-2">
          {pullInput ? 'Re-download model' : 'Pull a model'}
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={pullInput}
            onChange={(e) => setPullInput(e.target.value)}
            onKeyDown={handlePullKeyDown}
            placeholder="e.g. qwen2.5:7b"
            disabled={!!pullInProgress}
            className="flex-1 bg-card border border-stroke rounded-lg px-3 py-2 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            onClick={handlePull}
            disabled={!pullInput.trim() || !!pullInProgress}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            Pull
          </button>
        </div>
        {pullInProgress && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-fg-muted mb-1">
              <span>Pulling {pullInProgress}…</span>
              <span>{pullPercent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-card overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${pullPercent}%` }}
              />
            </div>
          </div>
        )}
        {pullError && (
          <p className="text-xs text-red-400 mt-2">{pullError}</p>
        )}
      </div>

      {/* Services status — sourced from live health checker, always accurate */}
      <div>
        <h3 className="text-sm font-semibold text-fg mb-2">Services</h3>
        <div className="flex flex-col gap-2">
          {Object.entries(liveServices).map(([name, entry]) => {
            const status = entry.status;
            const isRunning = status === 'running';
            const isStarting = status === 'starting';
            const isNotInstalled = status === 'not-installed';
            return (
              <div
                key={name}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-card border border-stroke/60"
              >
                <span className="text-sm text-fg capitalize">{name}</span>
                {isRunning ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                    Running
                  </span>
                ) : isStarting ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">
                    Starting
                  </span>
                ) : isNotInstalled ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-card text-fg-dim font-medium">
                    Not installed
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-card text-fg-muted font-medium capitalize">
                    {status}
                  </span>
                )}
              </div>
            );
          })}
        </div>
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
