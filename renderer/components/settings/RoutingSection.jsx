/**
 * @file RoutingSection.jsx
 * @description Settings section for LiteLLM routing preferences. A segmented
 * mode selector lets non-technical users pick a preset, while three toggles
 * remain visible for fine-grained control. Changes are not persisted until the
 * user clicks "Save preferences".
 */

import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateRouting } from '../../store/slices/settings';

/**
 * Routing mode presets. Each mode maps to a specific combination of toggle values.
 *
 * @type {Array<{ id: string, label: string, description: string, values: Object }>}
 */
const ROUTING_MODES = [
  {
    id: 'local',
    label: 'Always Local',
    description: 'Never use cloud — everything runs on your GPU.',
    values: { preferLocal: true, allowCloudForLongContext: false, allowCloudForComplexReasoning: false },
  },
  {
    id: 'smart',
    label: 'Smart (recommended)',
    description: 'Use local by default, cloud only when your GPU can\'t handle it.',
    values: { preferLocal: true, allowCloudForLongContext: true, allowCloudForComplexReasoning: false },
  },
  {
    id: 'quality',
    label: 'Best Quality',
    description: 'Use the best available model for each task, local or cloud.',
    values: { preferLocal: false, allowCloudForLongContext: true, allowCloudForComplexReasoning: true },
  },
];

const ROUTING_OPTIONS = [
  {
    key: 'preferLocal',
    label: 'Prefer local models',
    description:
      'When a local model has comparable capability, always use it instead of cloud. Cloud is only used when local cannot satisfy the request.',
  },
  {
    key: 'allowCloudForLongContext',
    label: 'Use cloud for long context',
    description:
      'Automatically route to cloud when the conversation exceeds the local model\'s context window. Requires at least one cloud provider to be enabled.',
  },
  {
    key: 'allowCloudForComplexReasoning',
    label: 'Use cloud for complex reasoning',
    description:
      'Allow the router to escalate hard reasoning tasks (multi-step logic, long-form analysis) to a more powerful cloud model. Off by default.',
  },
];

/**
 * Reads the current toggle values and returns which preset they match, or
 * 'custom' if they don't match any preset exactly.
 *
 * @param {{ preferLocal: boolean, allowCloudForLongContext: boolean, allowCloudForComplexReasoning: boolean }} routing
 * @returns {'local' | 'smart' | 'quality' | 'custom'}
 */
function detectMode(routing) {
  for (const mode of ROUTING_MODES) {
    const v = mode.values;
    if (
      routing.preferLocal === v.preferLocal &&
      routing.allowCloudForLongContext === v.allowCloudForLongContext &&
      routing.allowCloudForComplexReasoning === v.allowCloudForComplexReasoning
    ) {
      return mode.id;
    }
  }
  return 'custom';
}

/**
 * @returns {JSX.Element}
 */
export default function RoutingSection() {
  const dispatch  = useDispatch();
  const routing   = useSelector((s) => s.settings.routing);
  const [local,   setLocal]   = useState(routing);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState('');

  const activeMode = detectMode(local);

  /**
   * Applies a preset's toggle values to local state without persisting.
   *
   * @param {string} modeId
   */
  function handleModeSelect(modeId) {
    const mode = ROUTING_MODES.find((m) => m.id === modeId);
    if (mode) setLocal((prev) => ({ ...prev, ...mode.values }));
  }

  function handleToggle(key) {
    setLocal((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await window.electronAPI?.saveRoutingPrefs(local);
      dispatch(updateRouting(local));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-white mb-1">Routing Preferences</h2>
        <p className="text-xs text-zinc-500">
          Control how Noxio decides between local models and cloud providers.
          Local always takes priority unless you opt in below.
        </p>
      </div>

      {/* Routing mode segmented control */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-800 border border-zinc-700/60">
            {ROUTING_MODES.map((mode) => (
              <button
                key={mode.id}
                onClick={() => handleModeSelect(mode.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeMode === mode.id
                    ? 'bg-violet-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title={mode.description}
              >
                {mode.label}
              </button>
            ))}
          </div>
          {activeMode === 'custom' && (
            <span className="text-xs text-zinc-500 bg-zinc-800 border border-zinc-700/60 px-2 py-0.5 rounded-full">
              Custom
            </span>
          )}
        </div>
        {activeMode !== 'custom' && (
          <p className="text-xs text-zinc-500 pl-1">
            {ROUTING_MODES.find((m) => m.id === activeMode)?.description}
          </p>
        )}
      </div>

      {/* Individual toggles */}
      <div className="flex flex-col gap-4">
        {ROUTING_OPTIONS.map(({ key, label, description }) => (
          <div
            key={key}
            className="flex items-start justify-between gap-4 p-4 rounded-xl bg-zinc-800 border border-zinc-700/60"
          >
            <div className="flex-1">
              <p className="text-sm font-medium text-white mb-0.5">{label}</p>
              <p className="text-xs text-zinc-500 leading-relaxed">{description}</p>
            </div>
            <button
              role="switch"
              aria-checked={local[key]}
              onClick={() => handleToggle(key)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors mt-0.5 ${
                local[key] ? 'bg-violet-600' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  local[key] ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
