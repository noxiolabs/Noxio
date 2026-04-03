/**
 * @file CapabilitiesSection.jsx
 * @description Settings section for managing installed capabilities.
 * Shows which capabilities are installed and lets the user add new ones
 * that weren't selected during the initial setup wizard.
 *
 * Install progress reuses the same 'install-progress' and 'install-error'
 * IPC events as the wizard — no new channels needed.
 */

import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setSelectedCapabilities, markServiceInstalled, hydrateSettings } from '../../store/slices/settings';

const CAPABILITIES = [
  {
    id: 'chat',
    label: 'Chat',
    description: 'Ask questions, reason, and write — powered by a local LLM via Ollama.',
    requiresServices: ['ollama'],
  },
  {
    id: 'coding',
    label: 'Code',
    description: 'Coding-optimised model routing using qwen2.5-coder.',
    requiresServices: ['ollama'],
  },
  {
    id: 'image',
    label: 'Images',
    description: 'Generate images with FLUX.1 via ComfyUI. Requires ~9 GB download.',
    requiresServices: ['comfyui'],
  },
  {
    id: 'voice',
    label: 'Voice',
    description: 'Speech-to-text (Whisper) and text-to-speech (Kokoro).',
    comingSoon: true,
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Autonomous agent with sandboxed workspace.',
    comingSoon: true,
  },
];

/**
 * @returns {JSX.Element}
 */
export default function CapabilitiesSection() {
  const dispatch = useDispatch();
  const selectedCapabilities = useSelector((s) => s.settings.selectedCapabilities);
  const installedServices    = useSelector((s) => s.settings.installedServices);

  const [installing, setInstalling]   = useState(null);   // capability id being installed
  const [progress,   setProgress]     = useState(0);
  const [stepMsg,    setStepMsg]      = useState('');
  const [error,      setError]        = useState('');
  const [done,       setDone]         = useState(null);   // capability id just completed

  function isInstalled(cap) {
    if (cap.comingSoon) return false;
    return selectedCapabilities.includes(cap.id);
  }

  async function handleAdd(cap) {
    setInstalling(cap.id);
    setProgress(0);
    setStepMsg('Starting installation...');
    setError('');
    setDone(null);

    // Listen to install-progress events for this install session
    function onProgress({ percent, message }) {
      setProgress(percent ?? 0);
      setStepMsg(message ?? '');
    }
    function onError({ message }) {
      setError(message ?? 'Installation failed');
      window.electronAPI.off('install-progress', onProgress);
      window.electronAPI.off('install-error', onError);
      setInstalling(null);
    }

    window.electronAPI.on('install-progress', onProgress);
    window.electronAPI.on('install-error', onError);

    try {
      const result = await window.electronAPI.installAdditionalCapability(cap.id);

      window.electronAPI.off('install-progress', onProgress);
      window.electronAPI.off('install-error', onError);

      if (result?.success) {
        // Re-hydrate settings from electron-store to pick up updated
        // installedServices + selectedCapabilities the IPC handler persisted.
        const fresh = await window.electronAPI.getSettings();
        if (fresh && !fresh.error) {
          dispatch(hydrateSettings(fresh));
        } else {
          // Fallback: update Redux manually
          dispatch(setSelectedCapabilities([...selectedCapabilities, cap.id]));
        }
        setDone(cap.id);
      } else {
        setError('Installation failed. Check logs for details.');
      }
    } catch (err) {
      window.electronAPI.off('install-progress', onProgress);
      window.electronAPI.off('install-error', onError);
      setError(err?.message ?? 'Installation failed');
    } finally {
      setInstalling(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white">Capabilities</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Manage which AI capabilities are installed on this machine.
        </p>
      </div>

      <div className="space-y-2">
        {CAPABILITIES.map((cap) => {
          const installed  = isInstalled(cap);
          const isActive   = installing === cap.id;
          const justDone   = done === cap.id;

          return (
            <div
              key={cap.id}
              className={`flex items-start gap-4 p-4 rounded-lg border ${
                cap.comingSoon
                  ? 'border-zinc-800/50 opacity-40'
                  : installed || justDone
                  ? 'border-zinc-700/60 bg-zinc-900/40'
                  : 'border-zinc-800'
              }`}
            >
              {/* Status icon */}
              <div className="mt-0.5 flex-shrink-0">
                {cap.comingSoon ? (
                  <ClockIcon />
                ) : installed || justDone ? (
                  <CheckIcon />
                ) : (
                  <EmptyIcon />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-zinc-100">{cap.label}</p>
                  {cap.comingSoon && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 font-medium tracking-wide uppercase">
                      Coming soon
                    </span>
                  )}
                  {(installed || justDone) && !cap.comingSoon && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700/40 text-emerald-400 font-medium tracking-wide uppercase">
                      Installed
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">{cap.description}</p>

                {/* Progress bar — shown while installing this capability */}
                {isActive && (
                  <div className="mt-3 space-y-1.5">
                    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-violet-500 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-zinc-500">{stepMsg}</p>
                  </div>
                )}

                {/* Error */}
                {error && installing !== cap.id && done !== cap.id && (
                  <p className="mt-2 text-xs text-red-400">{error}</p>
                )}
              </div>

              {/* Action */}
              {!cap.comingSoon && !installed && !justDone && (
                <button
                  onClick={() => handleAdd(cap)}
                  disabled={!!installing}
                  className="flex-shrink-0 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white"
                >
                  {isActive ? 'Installing…' : 'Add'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Global error (shown below the list when not tied to a specific cap) */}
      {error && !installing && (
        <p className="text-sm text-red-400">{error}</p>
      )}
    </div>
  );
}

// ─── Inline SVG icons ────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  );
}
