/**
 * @file PrereqScreen.jsx
 * @description Setup wizard — Screen 1. Checks prerequisites before proceeding.
 * Shows a status row for each:
 *
 *   • Ollama        — Optional. Will be installed automatically if missing.
 *   • Python 3.11+  — Informational only. Noxio creates its own isolated venvs;
 *                     system Python is not required.
 *   • NVIDIA GPU    — Informational. Local AI needs a GPU.
 *
 * The Continue button is never blocked on Python — Noxio sets up its own
 * Python environment under the user's chosen install directory.
 */

import React, { useEffect, useState, useCallback } from 'react';

/** Status icon for each check row. */
function StatusIcon({ state }) {
  if (state === 'checking') {
    return (
      <div className="w-5 h-5 border-2 border-zinc-600 border-t-violet-500 rounded-full animate-spin flex-shrink-0" />
    );
  }
  if (state === 'ok') {
    return (
      <div className="w-5 h-5 rounded-full bg-green-500/20 border border-green-500/50 flex items-center justify-center flex-shrink-0">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round">
          <polyline points="2,5 4,7 8,3" />
        </svg>
      </div>
    );
  }
  if (state === 'info') {
    return (
      <div className="w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/50 flex items-center justify-center flex-shrink-0">
        <span className="text-blue-400 text-[10px] font-bold leading-none">i</span>
      </div>
    );
  }
  if (state === 'warn') {
    return (
      <div className="w-5 h-5 rounded-full bg-yellow-500/20 border border-yellow-500/50 flex items-center justify-center flex-shrink-0">
        <span className="text-yellow-400 text-[10px] font-bold leading-none">!</span>
      </div>
    );
  }
  // error
  return (
    <div className="w-5 h-5 rounded-full bg-red-500/20 border border-red-500/50 flex items-center justify-center flex-shrink-0">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round">
        <line x1="3" y1="3" x2="7" y2="7" />
        <line x1="7" y1="3" x2="3" y2="7" />
      </svg>
    </div>
  );
}

/** A single prerequisite row. */
function PrereqRow({ label, note, state, link, required }) {
  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-lg border ${
      state === 'ok'
        ? 'border-zinc-800 bg-zinc-900/40'
        : state === 'info'
        ? 'border-blue-800/40 bg-blue-900/10'
        : state === 'warn'
        ? 'border-yellow-800/40 bg-yellow-900/10'
        : state === 'error'
        ? 'border-red-800/40 bg-red-900/10'
        : 'border-zinc-800 bg-zinc-900/40'
    }`}>
      <StatusIcon state={state} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-100">{label}</span>
          {required && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/40 border border-red-800/50 text-red-400 font-medium tracking-wide uppercase">
              Required
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-0.5">{note}</p>
      </div>
      {link && state !== 'ok' && state !== 'checking' && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="flex-shrink-0 text-xs text-violet-400 hover:text-violet-300 underline underline-offset-2"
        >
          Download
        </a>
      )}
    </div>
  );
}

/**
 * @param {{ onNext: () => void, selectedCapabilities: string[] }} props
 */
export default function PrereqScreen({ onNext, selectedCapabilities = [] }) {
  const [results, setResults]   = useState(null);
  const [checking, setChecking] = useState(true);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setResults(null);
    try {
      const data = await window.electronAPI.checkPrerequisites();
      setResults(data);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { runCheck(); }, [runCheck]);

  // Continue is never blocked on Python — Noxio installs its own venvs.
  const canProceed  = !checking;

  const rowState = (key) => {
    if (checking || !results) return 'checking';
    const r = results[key];
    if (!r) return 'warn';
    if (r.ok) return 'ok';
    return 'warn';
  };

  return (
    <div className="flex flex-col items-center h-full gap-8 px-8 overflow-y-auto py-8">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white">Before we begin</h2>
        <p className="mt-1 text-zinc-500 text-sm">
          Noxio needs these installed on your PC. Install anything missing, then click Retry.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-2">
        <PrereqRow
          label={results?.ollama?.label ?? 'Ollama'}
          note={
            checking
              ? 'Checking…'
              : results?.ollama?.ok
              ? (results.ollama.note ?? 'Found')
              : 'Ollama will be installed automatically — no action needed'
          }
          state={results?.ollama?.ok ? 'ok' : checking ? 'checking' : 'info'}
          link={null}
          required={false}
        />
        <PrereqRow
          label={results?.gpu?.label ?? 'NVIDIA GPU'}
          note={checking ? 'Checking…' : (results?.gpu?.note ?? '')}
          state={rowState('gpu')}
          link={null}
          required={false}
        />

        {!checking && results && !results.gpu?.ok && (
          <p className="text-xs text-zinc-500 text-center pt-1">
            No NVIDIA GPU detected. Local AI requires a supported GPU to run.
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={runCheck}
          disabled={checking}
          className="px-6 py-3 rounded-lg border border-zinc-700 hover:border-zinc-600 disabled:opacity-40 text-zinc-300 text-sm transition-colors"
        >
          {checking ? 'Checking…' : 'Retry'}
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="px-8 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
