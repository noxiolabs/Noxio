/**
 * @file InstallingScreen.jsx
 * @description Setup wizard — Screen 5. Triggers installation via IPC and displays
 * a step-by-step progress list driven by 'install-progress' and 'install-error' events.
 * Includes automatic Ollama installation if not already present.
 * Supports retry on retryable errors and pre-marks already-installed steps as done.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import StepRow from './StepRow';

const STEP_DEFS = [
  { step: 'install-ollama',         label: 'Installing Ollama',         always: true },
  { step: 'verify-python',          label: 'Verifying Python',          always: true },
  { step: 'install-comfyui',           label: 'Installing ComfyUI',          cap: 'image' },
  { step: 'upgrade-torch-blackwell',   label: 'Upgrading GPU drivers (PyTorch)', cap: 'image' },
  { step: 'install-searxng',        label: 'Installing SearXNG',        cap: 'web-search' },
  { step: 'install-whisper',        label: 'Installing Whisper',        cap: 'voice' },
  { step: 'install-kokoro',         label: 'Installing Kokoro',         cap: 'voice' },
  { step: 'download-flux',          label: 'Downloading image model',   cap: 'image' },
  { step: 'download-whisper-model', label: 'Downloading Whisper model', cap: 'voice' },
  { step: 'download-kokoro-model',  label: 'Downloading Kokoro model',  cap: 'voice' },
  { step: 'download-llm',           label: 'Downloading AI models',     always: true },
];

/**
 * Returns steps applicable for the given capabilities.
 * @param {string[]} capabilities
 */
function buildSteps(capabilities) {
  return STEP_DEFS.filter((def) => def.always || (def.cap && capabilities.includes(def.cap)));
}

/**
 * Maps an incoming event step string to a known step key.
 * 'download-llm-*' variants map to 'download-llm'.
 * @param {string} eventStep
 * @param {{ step: string }[]} stepList
 * @returns {string|null}
 */
function resolveStepKey(eventStep, stepList) {
  const direct = stepList.find((s) => s.step === eventStep);
  if (direct) return direct.step;
  const prefix = stepList.find((s) => eventStep.startsWith(s.step));
  return prefix ? prefix.step : null;
}

/**
 * @param {{
 *   capabilities: string[],
 *   models: Object,
 *   installDir: string,
 *   installedServices: Object,
 *   onDone: () => void,
 * }} props
 */
export default function InstallingScreen({ capabilities, models, installDir, installedServices, onDone }) {
  const steps = buildSteps(capabilities);

  function buildInitialStatuses() {
    const map = {};
    steps.forEach(({ step }) => {
      const serviceKey = step.replace('install-', '');
      map[step] = installedServices?.[serviceKey] === true ? 'done' : 'pending';
    });
    return map;
  }

  const [progress, setProgress]         = useState(0);
  const [stepMsg, setStepMsg]           = useState({});
  const [statuses, setStatuses]         = useState(buildInitialStatuses);
  const [installError, setInstallError] = useState(null);
  const started                         = useRef(false);

  const startInstallation = useCallback(() => {
    window.electronAPI
      .startInstallation({ capabilities, models, installDir, installedServices })
      .catch((err) => {
        setInstallError({ message: err.message ?? 'Installation failed', retryable: true });
      });
  }, [capabilities, models, installDir, installedServices]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    function handleProgress({ step, percent, message: msg }) {
      setProgress(percent ?? 0);
      if (step === 'complete') {
        setStatuses((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((k) => { if (next[k] !== 'error') next[k] = 'done'; });
          return next;
        });
        setTimeout(onDone, 900);
        return;
      }
      const key = resolveStepKey(step, steps);
      setStatuses((prev) => {
        const next = { ...prev };
        let found = false;
        steps.forEach(({ step: s }) => {
          if (found) return;
          if (s === key) { found = true; next[s] = 'in-progress'; return; }
          if (next[s] !== 'error') next[s] = 'done';
        });
        return next;
      });
      if (key) setStepMsg((prev) => ({ ...prev, [key]: msg ?? '' }));
    }

    function handleError({ step, message: msg, retryable }) {
      const key = resolveStepKey(step ?? '', steps);
      if (key) {
        setStatuses((prev) => ({ ...prev, [key]: 'error' }));
        setStepMsg((prev) => ({ ...prev, [key]: msg ?? '' }));
      }
      setInstallError({ message: msg ?? 'An error occurred during installation.', retryable: !!retryable });
    }

    window.electronAPI.on('install-progress', handleProgress);
    window.electronAPI.on('install-error', handleError);
    startInstallation();

    return () => {
      window.electronAPI.off('install-progress', handleProgress);
      window.electronAPI.off('install-error', handleError);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRetry() {
    setInstallError(null);
    setStatuses(buildInitialStatuses());
    setProgress(0);
    setStepMsg({});
    started.current = true;
    startInstallation();
  }

  return (
    <div className="flex flex-col h-full min-h-0 px-8">
      {/* Pinned header — always visible */}
      <div className="flex-shrink-0 pt-8 pb-4 text-center w-full max-w-sm mx-auto">
        <h2 className="text-2xl font-semibold text-white">Setting things up</h2>
        <p className="text-zinc-500 text-sm mt-1">This may take a while depending on your connection.</p>
        <div className="mt-4 space-y-2">
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-violet-600 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-zinc-600 text-right tabular-nums">{progress}%</p>
        </div>
      </div>

      {/* Scrollable step list */}
      <div className="flex-1 min-h-0 overflow-y-auto w-full max-w-sm mx-auto divide-y divide-zinc-800/60">
        {steps.map(({ step, label }) => (
          <StepRow
            key={step}
            label={label}
            status={statuses[step] ?? 'pending'}
            message={stepMsg[step] ?? ''}
          />
        ))}
      </div>

      {/* Pinned footer — always visible */}
      <div className="flex-shrink-0 pb-8 pt-4 w-full max-w-sm mx-auto">
        {installError && (
          <div className="rounded-lg border border-red-800/40 bg-red-900/10 p-4 space-y-3">
            <p className="text-sm text-red-400">{installError.message}</p>
            {installError.retryable ? (
              <button
                type="button"
                onClick={handleRetry}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
              >
                Retry
              </button>
            ) : (
              <p className="text-xs text-zinc-500">Fix the issue externally, then restart Noxio to try again.</p>
            )}
          </div>
        )}
        {!installError && (
          <div className="flex justify-center">
            <div className="w-5 h-5 border-2 border-violet-600/40 border-t-violet-600 rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
